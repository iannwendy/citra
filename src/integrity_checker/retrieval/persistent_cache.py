"""Persistent cross-essay SQLite verification cache backed by ``CitationCache``."""

from __future__ import annotations

import hashlib
import json
import re
import time
from collections.abc import Callable, Iterable, Iterator
from contextlib import contextmanager
from datetime import UTC, datetime
from typing import TYPE_CHECKING
from urllib.parse import urlsplit, urlunsplit

from loguru import logger
from sqlalchemy.exc import IntegrityError, OperationalError
from sqlalchemy.orm import Session

from integrity_checker.config import get_settings, is_test_runtime
from integrity_checker.models.citation import Citation
from integrity_checker.models.source import SourceCandidate, SourceResult
from integrity_checker.retrieval.arxiv_client import ArxivClient
from integrity_checker.retrieval.normalization import (
    author_key,
    normalize_arxiv_id,
    normalize_doi,
    normalize_text,
)

if TYPE_CHECKING:
    from integrity_checker.db.models import CitationCache

POSITIVE_MATCH_TTL_SECONDS = 2_592_000  # 30 days
URL_CHECK_TTL_SECONDS = 604_800  # 7 days
CLEAN_MISS_TTL_SECONDS = 86_400  # 24 hours

_YEAR_RE = re.compile(r"\b(1[89]\d{2}|20\d{2})\b")
_TRANSIENT_STATUS_RE = re.compile(r"\b429\b|\b(?:http[\s/_-]*)?5\d{2}\b|\b5xx\b", re.IGNORECASE)
_TRAILING_FOR_QUERY_RE = re.compile(
    r"\bfor\s+(?:query\s+|doi\s+|id\s+)?'.*'$",
    re.IGNORECASE | re.DOTALL,
)

_CLEAN_MISS_MARKERS = (
    "no results",
    "no title match",
    "does not exist",
    "no matching",
)

_DNS_NOT_FOUND_MARKERS = (
    "host not found",
    "server not found",
    "dns",
)

_TRANSIENT_FAILURE_MARKERS = (
    "rate limit",
    "rate-limit",
    "too many requests",
    "timeout",
    "timed out",
    "connect",
    "backoff",
    "skipped",
    "circuit_open",
    "unavailable",
    "bad gateway",
    "gateway timeout",
    "internal server error",
    "quota",
    "credits",
    "request failed",
    "retry exhausted",
    "no response",
    "unreachable",
    "reset by peer",
    "server disconnected",
    "protocol error",
    "host not found",
    "server not found",
    "network",
)


def _strip_quoted_query(err: str | None) -> str:
    """Strip single-quoted citation titles/queries before matching status or error markers."""
    raw = (err or "").strip()
    if not raw:
        return ""
    stripped = _TRAILING_FOR_QUERY_RE.sub("for ''", raw)
    return re.sub(r"'[^']*'", "''", stripped).lower()


def _is_clean_miss_error(err_no_quotes: str) -> bool:
    if any(cm in err_no_quotes for cm in _CLEAN_MISS_MARKERS):
        return True
    if "not found" in err_no_quotes and not any(
        h in err_no_quotes for h in _DNS_NOT_FOUND_MARKERS
    ):
        return True
    return False


def _is_memory_db_url(url: str) -> bool:
    u = (url or "").strip()
    return u in ("sqlite://", "sqlite:///", "sqlite:///:memory:") or ":memory:" in u


def _clean_url_for_key(raw_url: str | None) -> str | None:
    if not raw_url:
        return None
    u = raw_url.strip().rstrip(".,;")
    while u.endswith(")") and u.count(")") > u.count("("):
        u = u[:-1].rstrip(".,;")
    if not u:
        return None
    try:
        parts = urlsplit(u)
        if parts.scheme and parts.netloc:
            return urlunsplit(
                (
                    parts.scheme.lower(),
                    parts.netloc.lower(),
                    parts.path,
                    parts.query,
                    "",
                )
            )
    except ValueError:
        pass
    return u.lower()


def _canonical_doi(raw_doi: str | None) -> str | None:
    if not raw_doi:
        return None
    cleaned = re.sub(r"^\s*doi\s*:\s*", "", str(raw_doi), flags=re.IGNORECASE)
    return normalize_doi(cleaned)


def build_verification_cache_key(citation: Citation) -> str:
    """Build canonical cross-essay verification cache key for a citation.

    Priority:
        1. ``doi:{norm_doi}``
        2. ``arxiv:{norm_arxiv}``
        3. ``url:{clean_url}``
        4. ``meta:{sha256(norm_title + '|' + first_author_key + '|' + norm_year)}``
    """
    if citation.doi:
        norm_doi = _canonical_doi(citation.doi)
        if norm_doi:
            return f"doi:{norm_doi}"

    raw_arxiv = ArxivClient.extract_arxiv_id(citation)
    if raw_arxiv:
        norm_arxiv = normalize_arxiv_id(raw_arxiv)
        if norm_arxiv:
            return f"arxiv:{norm_arxiv}"

    clean_url = _clean_url_for_key(citation.url)
    if clean_url:
        return f"url:{clean_url}"

    norm_title = normalize_text(citation.title or citation.raw_text or "")
    first_author = author_key(citation.authors[0]) if citation.authors else ""
    raw_year = str(citation.year or "").strip()
    m_year = _YEAR_RE.search(raw_year)
    norm_year = m_year.group(1) if m_year else raw_year
    payload = f"{norm_title}|{first_author}|{norm_year}".encode()
    digest = hashlib.sha256(payload).hexdigest()
    return f"meta:{digest}"


def build_metadata_bound_cache_key(citation: Citation) -> str:
    """Build a metadata-bound key incorporating both bibliographic fields and identifiers.

    Used to isolate titled ``url:`` citations (e.g. shared proceedings URLs) and
    0-candidate / chimeric identifier results from poisoning bare ``doi:``/``arxiv:``/``url:`` keys.
    """
    norm_doi = _canonical_doi(citation.doi) or ""
    raw_arxiv = ArxivClient.extract_arxiv_id(citation)
    norm_arxiv = (normalize_arxiv_id(raw_arxiv) if raw_arxiv else None) or ""
    clean_url = _clean_url_for_key(citation.url) or ""

    if not norm_doi and not norm_arxiv and not clean_url:
        return build_verification_cache_key(citation)

    norm_title = normalize_text(citation.title or citation.raw_text or "")
    first_author = author_key(citation.authors[0]) if citation.authors else ""
    raw_year = str(citation.year or "").strip()
    m_year = _YEAR_RE.search(raw_year)
    norm_year = m_year.group(1) if m_year else raw_year
    payload = (
        f"{norm_title}|{first_author}|{norm_year}|{norm_doi}|{norm_arxiv}|{clean_url}".encode()
    )
    digest = hashlib.sha256(payload).hexdigest()
    return f"meta:{digest}"


def _serialize_candidate(cand: SourceCandidate) -> dict:
    agreed = getattr(cand, "_agreed_sources", None)
    consensus = getattr(cand, "_consensus_count", None)
    return {
        "source_name": cand.source_name,
        "found": bool(cand.found),
        "doi": cand.doi,
        "title": cand.title,
        "authors": list(cand.authors or []),
        "year": cand.year,
        "venue": cand.venue,
        "url": cand.url,
        "abstract": cand.abstract,
        "external_ids": dict(cand.external_ids or {}),
        "score": float(cand.score or 0.0),
        "confidence": float(cand.confidence or 0.0),
        "error": cand.error,
        "paper_id": cand.paper_id,
        "_agreed_sources": list(agreed) if agreed else None,
        "_consensus_count": int(consensus) if isinstance(consensus, int) else None,
    }


def _deserialize_candidate(data: dict) -> SourceCandidate:
    cand = SourceCandidate(
        source_name=str(data.get("source_name") or "cache"),
        found=bool(data.get("found", False)),
        doi=data.get("doi"),
        title=data.get("title"),
        authors=list(data.get("authors") or []),
        year=data.get("year"),
        venue=data.get("venue"),
        url=data.get("url"),
        abstract=data.get("abstract"),
        external_ids=dict(data.get("external_ids") or {}),
        score=float(data.get("score") or 0.0),
        confidence=float(data.get("confidence") or 0.0),
        error=data.get("error"),
        cached=True,
        paper_id=data.get("paper_id"),
    )
    agreed = data.get("_agreed_sources")
    if isinstance(agreed, list) and agreed:
        cand._agreed_sources = [str(s) for s in agreed]  # type: ignore[attr-defined]
    consensus = data.get("_consensus_count")
    if isinstance(consensus, int) and consensus >= 1:
        cand._consensus_count = consensus  # type: ignore[attr-defined]
    elif isinstance(agreed, list) and agreed:
        cand._consensus_count = max(1, len(agreed))  # type: ignore[attr-defined]
    return cand


def _serialize_source_result(result: SourceResult) -> dict:
    return {
        "citation_raw": result.citation_raw,
        "candidates": [_serialize_candidate(c) for c in (result.candidates or [])],
        "sources_queried": list(result.sources_queried or []),
        "sources_succeeded": list(result.sources_succeeded or []),
        "sources_failed": dict(result.sources_failed or {}),
        "api_exhausted": bool(result.api_exhausted),
        "url_status": result.url_status,
        "url_status_code": result.url_status_code,
        "archive_url": result.archive_url,
        "is_retracted": bool(result.is_retracted),
    }


def _deserialize_source_result(data: dict) -> SourceResult:
    candidates = [_deserialize_candidate(item) for item in (data.get("candidates") or [])]
    return SourceResult(
        citation_raw=str(data.get("citation_raw") or ""),
        candidates=candidates,
        sources_queried=list(data.get("sources_queried") or []),
        sources_succeeded=list(data.get("sources_succeeded") or []),
        sources_failed=dict(data.get("sources_failed") or {}),
        api_exhausted=bool(data.get("api_exhausted", False)),
        url_status=data.get("url_status"),
        url_status_code=data.get("url_status_code"),
        archive_url=data.get("archive_url"),
        is_retracted=bool(data.get("is_retracted", False)),
    )


class PersistentVerificationCache:
    """SQLite-backed cross-essay TTL cache using the ``CitationCache`` ORM table."""

    def __init__(
        self,
        *,
        session_factory: Callable[[], Session] | None = None,
        now_fn: Callable[[], float] | None = None,
        require_isolated_test_db: bool = False,
    ) -> None:
        self._session_factory = session_factory
        self._now_fn = now_fn or time.time
        self._require_isolated_test_db = require_isolated_test_db
        self.hits: int = 0
        self.misses: int = 0

    def _is_storage_enabled(self) -> bool:
        if self._session_factory is not None:
            return True
        if self._require_isolated_test_db and is_test_runtime():
            if _is_memory_db_url(get_settings().database.url):
                return False
        return True

    @contextmanager
    def _session_scope(self) -> Iterator[Session]:
        from integrity_checker.db.session import get_engine, get_session

        if self._session_factory is not None:
            session = self._session_factory()
        elif is_test_runtime():
            # Do not auto-run init_db() in lightweight unit tests; if citation_cache
            # does not exist yet, OperationalError is handled as a clean miss.
            session = Session(bind=get_engine(), autoflush=False, autocommit=False)
        else:
            session = get_session()
        try:
            yield session
        finally:
            session.close()

    @staticmethod
    def has_transient_failure(result: SourceResult) -> bool:
        """Return True if any upstream source reported a transient/degraded error."""
        if result.api_exhausted:
            return True
        if result.url_status in {"timeout", "error"}:
            return True
        for err in (result.sources_failed or {}).values():
            err_no_quotes = _strip_quoted_query(err)
            if not err_no_quotes:
                continue
            if _TRANSIENT_STATUS_RE.search(err_no_quotes):
                return True
            if any(marker in err_no_quotes for marker in _TRANSIENT_FAILURE_MARKERS):
                return True
        return False

    @classmethod
    def resolve_ttl_seconds(cls, result: SourceResult) -> int | None:
        """Determine tiered TTL in seconds, or None if the result must NOT be cached."""
        if cls.has_transient_failure(result):
            return None

        has_positive = any(c.found for c in (result.candidates or []))
        if has_positive:
            return POSITIVE_MATCH_TTL_SECONDS

        if (
            not result.candidates
            and result.url_status is not None
            and result.url_status not in {"timeout", "error", "unknown", "skipped"}
        ):
            return URL_CHECK_TTL_SECONDS

        # Clean negative miss: require >= 3 queried sources all returning clean HTTP-200 misses
        if (
            not result.candidates
            and not result.sources_succeeded
            and result.url_status is None
            and len(result.sources_queried or []) >= 3
            and result.sources_failed
        ):
            clean_count = 0
            for err in result.sources_failed.values():
                err_no_quotes = _strip_quoted_query(err)
                if _is_clean_miss_error(err_no_quotes):
                    clean_count += 1
                else:
                    return None
            if clean_count >= 3:
                return CLEAN_MISS_TTL_SECONDS

        return None

    @staticmethod
    def _primary_source_label(result: SourceResult) -> str:
        if result.sources_succeeded:
            return str(result.sources_succeeded[0])[:20]
        if result.url_status is not None:
            return "url_check"
        return "clean_miss"

    def _decode_row(self, entry: CitationCache, now_ts: float) -> tuple[SourceResult | None, bool]:
        """Return (deserialized_result, is_expired_or_corrupt)."""
        try:
            envelope = json.loads(entry.raw_response)
            if not isinstance(envelope, dict):
                return None, True
            expires_at = envelope.get("expires_at")
            if isinstance(expires_at, (int, float)) and now_ts >= float(expires_at):
                return None, True
            payload = envelope.get("result")
            if not isinstance(payload, dict):
                return None, True
            return _deserialize_source_result(payload), False
        except Exception as exc:
            logger.debug(f"PersistentVerificationCache decode error for {entry.cache_key!r}: {exc}")
            return None, True

    def get(self, key: str) -> SourceResult | None:
        """Fetch a cached ``SourceResult`` if present and unexpired, updating hit stats."""
        if not key or not self._is_storage_enabled():
            self.misses += 1
            return None

        from integrity_checker.db.models import CitationCache

        now_ts = float(self._now_fn())
        try:
            with self._session_scope() as session:
                entry = (
                    session.query(CitationCache)
                    .filter(CitationCache.cache_key == key)
                    .first()
                )
                if entry is None:
                    self.misses += 1
                    return None

                decoded, expired = self._decode_row(entry, now_ts)
                if expired or decoded is None:
                    session.delete(entry)
                    session.commit()
                    self.misses += 1
                    return None

                entry.hit_count = int(entry.hit_count or 0) + 1
                entry.last_hit_at = datetime.now(UTC)
                session.commit()
                self.hits += 1
                return decoded
        except OperationalError as exc:
            logger.debug(f"PersistentVerificationCache get skipped (DB uninitialized/busy): {exc}")
            self.misses += 1
            return None
        except Exception as exc:
            logger.debug(f"PersistentVerificationCache get failed for {key!r}: {exc}")
            self.misses += 1
            return None

    def get_many(self, keys: Iterable[str]) -> dict[str, SourceResult]:
        """Batch-fetch unexpired ``SourceResult`` entries in a single SQLite round-trip."""
        unique_keys = [k for k in dict.fromkeys(keys) if k]
        if not unique_keys or not self._is_storage_enabled():
            self.misses += len(unique_keys)
            return {}

        from integrity_checker.db.models import CitationCache

        now_ts = float(self._now_fn())
        out: dict[str, SourceResult] = {}
        try:
            with self._session_scope() as session:
                rows: list[CitationCache] = []
                for idx in range(0, len(unique_keys), 200):
                    chunk = unique_keys[idx : idx + 200]
                    rows.extend(
                        session.query(CitationCache)
                        .filter(CitationCache.cache_key.in_(chunk))
                        .all()
                    )
                by_key = {row.cache_key: row for row in rows}
                mutated = False
                hit_dt = datetime.now(UTC)
                for key in unique_keys:
                    entry = by_key.get(key)
                    if entry is None:
                        self.misses += 1
                        continue
                    decoded, expired = self._decode_row(entry, now_ts)
                    if expired or decoded is None:
                        session.delete(entry)
                        mutated = True
                        self.misses += 1
                        continue
                    entry.hit_count = int(entry.hit_count or 0) + 1
                    entry.last_hit_at = hit_dt
                    mutated = True
                    self.hits += 1
                    out[key] = decoded
                if mutated:
                    session.commit()
        except OperationalError as exc:
            logger.debug(
                f"PersistentVerificationCache get_many skipped (DB uninitialized/busy): {exc}"
            )
            self.misses += len(unique_keys) - len(out)
            return {}
        except Exception as exc:
            logger.debug(f"PersistentVerificationCache get_many failed: {exc}")
            self.misses += len(unique_keys) - len(out)
            return {}
        return out

    def set(
        self,
        key: str,
        result: SourceResult,
        ttl_seconds: int | None = None,
    ) -> bool:
        """Persist a ``SourceResult`` with tiered TTL; refuses partial/transient-failure results.

        Returns ``True`` if persisted to ``CitationCache``, ``False`` otherwise.
        """
        if not key or not self._is_storage_enabled():
            return False

        policy_ttl = self.resolve_ttl_seconds(result)
        if policy_ttl is None:
            logger.debug(
                f"PersistentVerificationCache refused transient/degraded result for {key!r}"
            )
            return False

        from integrity_checker.db.models import CitationCache

        effective_ttl = (
            int(ttl_seconds)
            if ttl_seconds is not None and int(ttl_seconds) > 0
            else policy_ttl
        )
        now_ts = float(self._now_fn())
        expires_at = now_ts + float(effective_ttl)
        source_label = self._primary_source_label(result)

        raw_json = json.dumps(
            {
                "schema_version": 1,
                "cached_at": now_ts,
                "ttl_seconds": effective_ttl,
                "expires_at": expires_at,
                "result": _serialize_source_result(result),
            },
            ensure_ascii=False,
        )
        meta_json = json.dumps(
            {
                "ttl_seconds": effective_ttl,
                "expires_at": expires_at,
                "sources_succeeded": list(result.sources_succeeded or []),
                "consensus_count": result.consensus_count(),
            },
            ensure_ascii=False,
        )

        try:
            with self._session_scope() as session:
                try:
                    existing = (
                        session.query(CitationCache)
                        .filter(CitationCache.cache_key == key)
                        .first()
                    )
                    if existing is not None:
                        existing.source = source_label
                        existing.raw_response = raw_json
                        existing.matched_fields = meta_json
                        existing.created_at = datetime.now(UTC)
                    else:
                        session.add(
                            CitationCache(
                                cache_key=key,
                                source=source_label,
                                raw_response=raw_json,
                                matched_fields=meta_json,
                            )
                        )
                    session.commit()
                    return True
                except IntegrityError:
                    session.rollback()
                    existing = (
                        session.query(CitationCache)
                        .filter(CitationCache.cache_key == key)
                        .first()
                    )
                    if existing is not None:
                        existing.source = source_label
                        existing.raw_response = raw_json
                        existing.matched_fields = meta_json
                        existing.created_at = datetime.now(UTC)
                        session.commit()
                        return True
        except OperationalError as exc:
            logger.debug(f"PersistentVerificationCache set skipped (DB uninitialized/busy): {exc}")
        except Exception as exc:
            logger.debug(f"PersistentVerificationCache set failed for {key!r}: {exc}")
        return False
