"""arXiv API client — Preprints in CS, AI, ML, NLP, Math, Physics, Q-Bio.

Docs: https://info.arxiv.org/help/api/user-manual.html
Endpoint: https://export.arxiv.org/api/query
No API key required. Returns Atom XML with full Title, Authors, Year, Abstract,
arXiv ID, and optional publisher DOI / journal_ref.
"""

from __future__ import annotations

import asyncio
import os
import random
import re
import threading
import time
from contextvars import ContextVar
from typing import Any

import httpx
from defusedxml import DefusedXmlException
from defusedxml.ElementTree import ParseError
from defusedxml.ElementTree import fromstring as safe_fromstring
from tenacity import (
    AsyncRetrying,
    RetryError,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)

from integrity_checker.config import get_settings
from integrity_checker.logging import get_logger
from integrity_checker.models.citation import Citation
from integrity_checker.models.source import SourceCandidate
from integrity_checker.retrieval.base import BaseScholarClient
from integrity_checker.retrieval.http_pool import get_shared_http_client
from integrity_checker.retrieval.normalization import (
    author_key,
    author_match_score,
    normalize_arxiv_id,
    normalize_doi,
    title_similarity,
    title_tokens,
)

logger = get_logger(__name__)

MIN_TITLE_SIMILARITY = 0.55

_ATOM_NS = {
    "atom": "http://www.w3.org/2005/Atom",
    "arxiv": "http://arxiv.org/schemas/atom",
}

_ARXIV_ID_PATTERNS = [
    re.compile(r"10\.48550/arxiv\.(\d{4}\.\d{4,5})(?:v\d+)?", re.IGNORECASE),
    re.compile(r"arxiv\.org/(?:abs|pdf)/(\d{4}\.\d{4,5})(?:v\d+)?", re.IGNORECASE),
    re.compile(r"\barxiv\s*[:/]\s*(\d{4}\.\d{4,5})(?:v\d+)?\b", re.IGNORECASE),
    re.compile(r"\babs/(\d{4}\.\d{4,5})(?:v\d+)?\b", re.IGNORECASE),
]

_STOPWORDS = frozenset({
    "the", "and", "for", "with", "from", "into", "using", "via", "over",
    "under", "towards", "toward", "through", "based", "between", "about",
    "not", "andnot", "are", "was", "were", "can", "how", "what", "when",
    "where", "which", "who", "why", "will", "this", "that", "these", "those",
    "their", "there", "then", "than", "our", "you", "your",
})

_ARXIV_LOOP_SEMS: dict[int, asyncio.Semaphore] = {}
_ARXIV_SLOT_LOCKS: dict[int, asyncio.Lock] = {}
_ARXIV_GLOBAL_SLOT_LOCK = threading.Lock()
_LAST_ARXIV_REQ_AT: dict[int, float] = {}
_ARXIV_MIN_INTERVAL = 1.0
_ARXIV_CONSECUTIVE_TIMEOUTS: dict[int, int] = {}
_ARXIV_CIRCUIT_OPEN_UNTIL: dict[int, float] = {}
_ARXIV_CIRCUIT_COOLDOWN_SEC = 45.0
_ARXIV_TIMED_OUT: ContextVar[bool] = ContextVar("_ARXIV_TIMED_OUT", default=False)


def _get_arxiv_sem() -> asyncio.Semaphore:
    loop = asyncio.get_running_loop()
    loop_id = id(loop)
    if loop_id not in _ARXIV_LOOP_SEMS:
        _ARXIV_LOOP_SEMS[loop_id] = asyncio.Semaphore(2)
    return _ARXIV_LOOP_SEMS[loop_id]


def _get_arxiv_slot_lock() -> asyncio.Lock:
    loop_id = id(asyncio.get_running_loop())
    if loop_id not in _ARXIV_SLOT_LOCKS:
        _ARXIV_SLOT_LOCKS[loop_id] = asyncio.Lock()
    return _ARXIV_SLOT_LOCKS[loop_id]


class ArxivClient(BaseScholarClient):
    """arXiv Atom API client for exact arXiv ID lookup and preprint title/author search."""

    BASE_URL = "https://export.arxiv.org/api/query"
    name = "arxiv"

    def __init__(
        self,
        contact_email: str | None = None,
        timeout: float = 6.0,
        max_retries: int | None = None,
    ) -> None:
        super().__init__(timeout=timeout)
        settings = get_settings()
        self.contact_email = (
            contact_email
            or os.getenv("CONTACT_EMAIL", "")
            or settings.contact_email
            or settings.retrieval.contact_email
        )
        self.max_retries = max_retries or min(settings.retrieval.retry.max_attempts, 2)
        self._backoff = settings.retrieval.retry.backoff
        self._headers = {
            "User-Agent": (
                f"EssayIntegrityChecker/0.2 (mailto:{self.contact_email})"
                if self.contact_email
                else "EssayIntegrityChecker/0.2"
            ),
        }

    @property
    def _last_timed_out(self) -> bool:
        return _ARXIV_TIMED_OUT.get()

    @_last_timed_out.setter
    def _last_timed_out(self, value: bool) -> None:
        _ARXIV_TIMED_OUT.set(bool(value))

    async def lookup(self, citation: Citation) -> SourceCandidate:
        """Lookup by exact arXiv ID first; fallback to title/author search."""
        self._reset_http_telemetry()
        self._last_timed_out = False

        # 1. Exact arXiv ID lookup if present in DOI, URL, venue, or raw_text
        arxiv_id = self.extract_arxiv_id(citation)
        if arxiv_id:
            by_id = await self._lookup_by_id(arxiv_id, citation=citation)
            if by_id and by_id.found:
                return by_id
            if self._last_status_code == 429:
                return SourceCandidate(
                    source_name=self.name,
                    found=False,
                    error=f"arXiv: rate limited (429) for ID '{arxiv_id}'",
                )

        # 2. Title + Author search
        return await self._lookup_by_search(citation)

    @classmethod
    def extract_arxiv_id(cls, citation: Citation) -> str | None:
        """Extract canonical YYMM.NNNNN arXiv ID from citation fields."""
        fields = [
            citation.doi or "",
            citation.url or "",
            citation.venue or "",
            citation.raw_text or "",
        ]
        for text in fields:
            if not text:
                continue
            for pat in _ARXIV_ID_PATTERNS:
                m = pat.search(text)
                if m:
                    return m.group(1)
        return None

    async def _lookup_by_id(
        self,
        arxiv_id: str,
        citation: Citation | None = None,
    ) -> SourceCandidate | None:
        xml_text = await self._fetch_xml_with_retry({"id_list": arxiv_id, "max_results": 1})
        if not xml_text:
            return None
        entries = self._parse_atom_entries(xml_text)
        if not entries:
            return None
        cand = entries[0]
        if not cand.title:
            return None
        # Guard against mismatched ID if citation has an explicit title
        if citation and citation.title:
            if title_similarity(citation.title, cand.title) < 0.65:
                return None
        cand.found = True
        cand.confidence = 0.98
        cand.score = 1.0
        return cand

    async def lookup_arxiv_batch(self, arxiv_ids: list[str]) -> dict[str, SourceCandidate]:
        """Batch-resolve up to 40 normalized arXiv IDs per request via ``id_list={id1},{id2},...``."""
        self._reset_http_telemetry()
        self._last_timed_out = False

        norm_ids: list[str] = []
        seen: set[str] = set()
        for raw in arxiv_ids or []:
            text = str(raw or "").strip()
            if not text:
                continue
            extracted: str | None = None
            for pat in _ARXIV_ID_PATTERNS:
                m = pat.search(text)
                if m:
                    extracted = m.group(1)
                    break
            aid = normalize_arxiv_id(extracted or text)
            if aid and aid not in seen:
                seen.add(aid)
                norm_ids.append(aid)

        if not norm_ids:
            return {}

        out: dict[str, SourceCandidate] = {}
        chunk_size = 40
        for idx in range(0, len(norm_ids), chunk_size):
            chunk = norm_ids[idx : idx + chunk_size]
            xml_text = await self._fetch_xml_with_retry(
                {"id_list": ",".join(chunk), "max_results": 50}
            )
            if not xml_text:
                if (
                    self._last_status_code == 429
                    or (self._last_status_code is not None and self._last_status_code >= 500)
                    or self._last_transport_error
                    or self._last_timed_out
                ):
                    break
                continue

            self._reset_http_telemetry()
            self._last_status_code = 200

            for cand in self._parse_atom_entries(xml_text):
                if not cand.title:
                    continue
                raw_aid = (cand.external_ids or {}).get("arxiv")
                norm_aid = normalize_arxiv_id(raw_aid)
                if not norm_aid:
                    continue
                cand.external_ids["arxiv"] = norm_aid
                cand.found = True
                cand.confidence = 0.98
                cand.score = 1.0
                out[norm_aid] = cand

        return out

    async def _lookup_by_search(self, citation: Citation) -> SourceCandidate:
        if not citation.title:
            return SourceCandidate(
                source_name=self.name,
                found=False,
                error="arXiv: no title for search",
            )

        queries = self._build_search_queries(citation)
        if not queries:
            return SourceCandidate(
                source_name=self.name,
                found=False,
                error="arXiv: empty search query",
            )

        entries: list[SourceCandidate] = []
        had_successful_http = False
        for search_query in queries:
            xml_text = await self._fetch_xml_with_retry(
                {"search_query": search_query, "start": 0, "max_results": 5}
            )
            if not xml_text:
                if self._last_status_code == 429:
                    return SourceCandidate(
                        source_name=self.name,
                        found=False,
                        error=f"arXiv: rate limited (429) for '{citation.title[:50]}'",
                    )
                if self._last_timed_out:
                    break
                continue
            had_successful_http = True
            parsed = self._parse_atom_entries(xml_text)
            if parsed:
                entries.extend(parsed)
                # Stop querying fallback patterns if we already have a strong title match
                best_so_far = max(
                    (title_similarity(citation.title, c.title) for c in entries if c.title),
                    default=0.0,
                )
                if best_so_far >= 0.85:
                    break

        if not entries:
            if self._last_status_code == 429:
                return self._build_miss_or_error_candidate("arXiv", citation.title[:50])
            if self._last_status_code is not None and self._last_status_code >= 500:
                return self._build_miss_or_error_candidate("arXiv", citation.title[:60])
            if self._last_timed_out and not had_successful_http:
                return SourceCandidate(
                    source_name=self.name,
                    found=False,
                    error=f"arXiv: timeout/unavailable for '{citation.title[:60]}'",
                )
            return SourceCandidate(
                source_name=self.name,
                found=False,
                error=f"arXiv: no results for '{citation.title[:60]}'",
            )

        cit_year = str(citation.year)[:4] if citation.year else None
        cit_first_author = author_key(citation.authors[0]) if citation.authors else None
        is_short_title = len(title_tokens(citation.title)) <= 3

        best_cand: SourceCandidate | None = None
        best_sim = -1.0
        best_rank = -1.0

        for cand in entries:
            if not cand.title:
                continue
            sim = title_similarity(citation.title, cand.title)
            rank = sim
            if cit_year and cand.year == cit_year:
                rank += 0.02
            if cit_first_author and cand.authors:
                auth_sc = author_match_score(citation.authors, cand.authors)
                if auth_sc > 0.0:
                    rank += 0.03 * auth_sc
                elif is_short_title:
                    continue
            if rank > best_rank:
                best_rank = rank
                best_sim = sim
                best_cand = cand

        if best_cand is None or best_sim < MIN_TITLE_SIMILARITY:
            return SourceCandidate(
                source_name=self.name,
                found=False,
                error=(
                    f"arXiv: no title match above {MIN_TITLE_SIMILARITY:.2f} "
                    f"(best={best_sim:.2f}) for '{citation.title[:60]}'"
                ),
            )

        best_cand.found = True
        best_cand.score = best_sim
        best_cand.confidence = min(0.95, max(0.60, best_sim))
        return best_cand

    @classmethod
    def _build_search_queries(cls, citation: Citation) -> list[str]:
        """Build progressive arXiv search_query strings (exact phrase -> keyword + author)."""
        title = re.sub(r"\s+", " ", (citation.title or "")).strip()
        if not title:
            return []

        cleaned_phrase = re.sub(r'["\'\\():;!?]', " ", title)
        cleaned_phrase = re.sub(r"\s+", " ", cleaned_phrase).strip()

        queries: list[str] = []
        if cleaned_phrase:
            queries.append(f'ti:"{cleaned_phrase}"')

        # Keyword + first author fallback (handles hyphenation / subtitle differences)
        raw_words = [
            w
            for w in re.sub(r"[^\w\s]", " ", title).split()
            if len(w) >= 3 and w.lower() not in _STOPWORDS
        ]
        seen_words: set[str] = set()
        words: list[str] = []
        for w in raw_words:
            wl = w.lower()
            if wl not in seen_words:
                seen_words.add(wl)
                words.append(w)
        if words:
            ti_terms = " AND ".join(f"ti:{w}" for w in words[:7])
            if citation.authors:
                surname = author_key(citation.authors[0])
                if surname and len(surname) >= 2:
                    queries.append(f"({ti_terms}) AND au:{surname}")
            queries.append(ti_terms)

        # Deduplicate while preserving order
        seen: set[str] = set()
        unique: list[str] = []
        for q in queries:
            if q not in seen:
                seen.add(q)
                unique.append(q)
        return unique[:2]

    @classmethod
    def _parse_atom_entries(cls, xml_text: str) -> list[SourceCandidate]:
        try:
            # Remote (untrusted) XML: defusedxml blocks entity expansion / XXE.
            root = safe_fromstring(xml_text, forbid_dtd=True)
        except (ParseError, DefusedXmlException) as exc:
            logger.warning(f"arXiv XML parse error: {exc}")
            return []

        candidates: list[SourceCandidate] = []
        for entry in root.findall("atom:entry", _ATOM_NS):
            id_text = (entry.findtext("atom:id", default="", namespaces=_ATOM_NS) or "").strip()
            raw_title = (entry.findtext("atom:title", default="", namespaces=_ATOM_NS) or "").strip()
            title = re.sub(r"\s+", " ", raw_title).strip()
            if not title or title.lower() == "error":
                continue

            raw_summary = (entry.findtext("atom:summary", default="", namespaces=_ATOM_NS) or "").strip()
            abstract = re.sub(r"\s+", " ", raw_summary).strip() or None

            authors: list[str] = []
            for author_el in entry.findall("atom:author", _ATOM_NS):
                name = (author_el.findtext("atom:name", default="", namespaces=_ATOM_NS) or "").strip()
                if name:
                    authors.append(name)

            published = (entry.findtext("atom:published", default="", namespaces=_ATOM_NS) or "").strip()
            year = published[:4] if len(published) >= 4 and published[:4].isdigit() else None

            # Extract arXiv ID from <id>http://arxiv.org/abs/2404.06395v1</id>
            arxiv_id = None
            m_id = re.search(r"/abs/([^?\s]+?)(?:v\d+)?$", id_text)
            if m_id:
                arxiv_id = m_id.group(1)

            pub_doi = (entry.findtext("arxiv:doi", default="", namespaces=_ATOM_NS) or "").strip()
            if pub_doi:
                doi = normalize_doi(pub_doi)
            elif arxiv_id and re.match(r"^\d{4}\.\d{4,5}$", arxiv_id):
                doi = f"10.48550/arxiv.{arxiv_id}"
            else:
                doi = None

            journal_ref = (entry.findtext("arxiv:journal_ref", default="", namespaces=_ATOM_NS) or "").strip()
            venue = re.sub(r"\s+", " ", journal_ref).strip() if journal_ref else "arXiv"

            external_ids: dict[str, str] = {}
            if arxiv_id:
                external_ids["arxiv"] = arxiv_id
            if doi:
                external_ids["doi"] = doi

            candidates.append(
                SourceCandidate(
                    source_name=cls.name,
                    found=False,
                    doi=doi,
                    title=title,
                    authors=authors,
                    year=year,
                    venue=venue,
                    url=id_text or (f"https://arxiv.org/abs/{arxiv_id}" if arxiv_id else None),
                    abstract=abstract,
                    external_ids=external_ids,
                )
            )
        return candidates

    async def _fetch_xml_with_retry(self, params: dict[str, Any]) -> str | None:
        self._last_timed_out = False
        loop_id = id(asyncio.get_running_loop())
        now = time.monotonic()
        with _ARXIV_GLOBAL_SLOT_LOCK:
            open_until = _ARXIV_CIRCUIT_OPEN_UNTIL.get(loop_id, 0.0)
        if open_until > now:
            self._last_timed_out = True
            logger.debug("arXiv circuit breaker open — skipping request")
            return None

        sem = _get_arxiv_sem()
        slot_lock = _get_arxiv_slot_lock()
        seen_429 = 0
        retryer = AsyncRetrying(
            stop=stop_after_attempt(min(self.max_retries, 2)),
            wait=wait_exponential(
                multiplier=self._backoff.multiplier,
                min=min(self._backoff.initial_seconds, 1.0),
                max=min(self._backoff.max_seconds, 4.0),
            ),
            retry=retry_if_exception_type((httpx.RequestError, httpx.HTTPStatusError)),
            reraise=False,
        )
        try:
            async for attempt in retryer:
                with attempt:
                    async with sem:
                        async with slot_lock:
                            with _ARXIV_GLOBAL_SLOT_LOCK:
                                now_slot = time.monotonic()
                                if loop_id in _LAST_ARXIV_REQ_AT and _LAST_ARXIV_REQ_AT[loop_id] == 0.0:
                                    _LAST_ARXIV_REQ_AT.clear()
                                    last_at = 0.0
                                else:
                                    last_at = max(_LAST_ARXIV_REQ_AT.values(), default=0.0)
                                scheduled = (
                                    max(now_slot, last_at + _ARXIV_MIN_INTERVAL)
                                    if last_at > 0
                                    else now_slot
                                )
                                _LAST_ARXIV_REQ_AT[loop_id] = scheduled
                                wait_sec = scheduled - now_slot
                        if wait_sec > 0:
                            await asyncio.sleep(wait_sec)
                        client = get_shared_http_client(follow_redirects=True)
                        resp = await client.get(
                            self.BASE_URL,
                            params=params,
                            headers=self._headers,
                            timeout=self.timeout,
                        )
                    retry_after = self._record_http_response(resp)
                    with _ARXIV_GLOBAL_SLOT_LOCK:
                        _ARXIV_CONSECUTIVE_TIMEOUTS[loop_id] = 0
                    if resp.status_code == 404:
                        return None
                    if resp.status_code == 429:
                        seen_429 += 1
                        if seen_429 >= 2 or (retry_after is not None and retry_after > 3.0):
                            return None
                        await asyncio.sleep(
                            (retry_after or random.uniform(0.8, 1.5))
                            + random.uniform(0.05, 0.25)
                        )
                    if resp.status_code == 429 or resp.status_code >= 500:
                        if getattr(resp, "_request", None) is None:
                            resp._request = httpx.Request("GET", self.BASE_URL)
                        resp.raise_for_status()
                    if resp.status_code != 200:
                        return None
                    return resp.text
        except RetryError as exc:
            self._last_timed_out = True
            self._record_transport_error(exc)
            with _ARXIV_GLOBAL_SLOT_LOCK:
                fails = _ARXIV_CONSECUTIVE_TIMEOUTS.get(loop_id, 0) + 1
                _ARXIV_CONSECUTIVE_TIMEOUTS[loop_id] = fails
                if fails >= 2:
                    _ARXIV_CIRCUIT_OPEN_UNTIL[loop_id] = time.monotonic() + _ARXIV_CIRCUIT_COOLDOWN_SEC
                    logger.warning(
                        f"arXiv retry exhausted ({fails} consecutive failures); opening circuit breaker for {_ARXIV_CIRCUIT_COOLDOWN_SEC:.0f}s: {exc}"
                    )
                else:
                    logger.warning(f"arXiv retry exhausted: {exc}")
            return None
        except Exception as exc:  # noqa: BLE001
            self._last_timed_out = True
            self._record_transport_error(exc)
            logger.warning(f"arXiv error: {exc}")
            return None
        return None
