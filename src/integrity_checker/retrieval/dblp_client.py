"""DBLP Search API client — Computer Science, AI, ML, NLP publications.

Docs: https://dblp.org/faq/How+to+use+the+dblp+search+API.html
Endpoint: https://dblp.org/search/publ/api?q=...&format=json
No API key required. Fast response (<200ms) and clean metadata for IEEE, ACM,
NeurIPS, ICML, ICLR, CVPR, ACL, EMNLP, NAACL, AAAI, IJCAI, CoRR (arXiv CS).
"""

from __future__ import annotations

import asyncio
import html
import os
import re
import threading
import time
from typing import Any

import httpx
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
from integrity_checker.retrieval.normalization import (
    author_key,
    author_match_score,
    normalize_doi,
    title_similarity,
    title_tokens,
)

logger = get_logger(__name__)

MIN_TITLE_SIMILARITY = 0.55
_DBLP_DISAMBIG_RE = re.compile(r"\s+\d{4}$")
_CORR_VOL_RE = re.compile(r"abs/(\d{4}\.\d{4,5})", re.IGNORECASE)
_SHARED_DBLP_COOKIES = httpx.Cookies()
_DBLP_LOOP_COOKIES: dict[int, httpx.Cookies] = {}
_DBLP_LOOP_LOCKS: dict[int, tuple[asyncio.Semaphore, asyncio.Lock, asyncio.Lock]] = {}
_DBLP_GLOBAL_SLOT_LOCK = threading.Lock()
_LAST_DBLP_REQ_AT: dict[int, float] = {}
_DBLP_MIN_INTERVAL = 0.65
_DBLP_CONSECUTIVE_FAILURES: dict[int, int] = {}
_DBLP_CIRCUIT_OPEN_UNTIL: dict[int, float] = {}
_DBLP_CIRCUIT_COOLDOWN_SEC = 45.0


def _get_dblp_cookies() -> httpx.Cookies:
    loop_id = id(asyncio.get_running_loop())
    cookies = _DBLP_LOOP_COOKIES.get(loop_id)
    if cookies is None:
        cookies = httpx.Cookies()
        if len(_SHARED_DBLP_COOKIES) > 0:
            cookies.update(_SHARED_DBLP_COOKIES)
        _DBLP_LOOP_COOKIES[loop_id] = cookies
    elif len(cookies) == 0 and len(_SHARED_DBLP_COOKIES) > 0:
        cookies.update(_SHARED_DBLP_COOKIES)
    return cookies


def _get_dblp_sync_primitives() -> tuple[asyncio.Semaphore, asyncio.Lock, asyncio.Lock]:
    loop = asyncio.get_running_loop()
    loop_id = id(loop)
    if loop_id not in _DBLP_LOOP_LOCKS:
        _DBLP_LOOP_LOCKS[loop_id] = (asyncio.Semaphore(2), asyncio.Lock(), asyncio.Lock())
    return _DBLP_LOOP_LOCKS[loop_id]


class DBLPClient(BaseScholarClient):
    """DBLP publication search client for Computer Science & AI literature."""

    BASE_URL = "https://dblp.uni-trier.de/search/publ/api"
    BASE_ORIGIN = "https://dblp.uni-trier.de"
    name = "dblp"

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
        self._last_status_code: int | None = None
        self._headers = {
            "Accept": "application/json",
        }

    async def lookup(self, citation: Citation) -> SourceCandidate:
        """Search DBLP by title (and optional author/year)."""
        self._last_status_code = None

        query = self._build_query(citation)
        if not query:
            return SourceCandidate(
                source_name=self.name,
                found=False,
                error="DBLP: no title or searchable metadata",
            )

        data = await self._fetch_json_with_retry({"q": query, "h": 10, "format": "json"})
        if not data:
            if self._last_status_code == 429:
                return SourceCandidate(
                    source_name=self.name,
                    found=False,
                    error=f"DBLP: rate limited (429) for '{query[:60]}'",
                )
            return SourceCandidate(
                source_name=self.name,
                found=False,
                error=f"DBLP: no response for '{query[:60]}'",
            )

        hits = self._extract_hits(data)
        # If strict title+author query returned 0 hits and we had author in query, retry with title-only
        if not hits and citation.title and citation.authors:
            title_only_query = self._clean_query_text(citation.title)
            if title_only_query and title_only_query != query:
                data = await self._fetch_json_with_retry(
                    {"q": title_only_query, "h": 10, "format": "json"}
                )
                if data:
                    hits = self._extract_hits(data)

        if not hits:
            return SourceCandidate(
                source_name=self.name,
                found=False,
                error=f"DBLP: no results for '{query[:60]}'",
            )

        query_title = citation.title or query
        best_cand: SourceCandidate | None = None
        best_sim = -1.0
        best_rank_score = -1.0

        cit_doi = normalize_doi(citation.doi) if citation.doi else None
        cit_year = str(citation.year)[:4] if citation.year else None
        cit_first_author = author_key(citation.authors[0]) if citation.authors else None
        is_short_title = len(title_tokens(query_title)) <= 3

        for hit in hits:
            info = hit.get("info") if isinstance(hit, dict) else None
            if not isinstance(info, dict):
                continue
            cand = self._info_to_candidate(info)
            if not cand.title:
                continue

            # Exact DOI match check
            if cit_doi and cand.doi and normalize_doi(cand.doi) == cit_doi:
                cand.found = True
                cand.confidence = 1.0
                cand.score = 1.0
                return cand

            sim = title_similarity(query_title, cand.title)
            rank_score = sim
            # Prefer peer-reviewed venue over CoRR preprint when titles are nearly identical
            if cand.venue and cand.venue.lower() != "corr":
                rank_score += 0.02
            if cit_year and cand.year == cit_year:
                rank_score += 0.03
            if cit_first_author and cand.authors:
                auth_sc = author_match_score(citation.authors, cand.authors)
                if auth_sc > 0.0:
                    rank_score += 0.03 * auth_sc
                elif is_short_title:
                    continue

            if rank_score > best_rank_score:
                best_rank_score = rank_score
                best_sim = sim
                best_cand = cand

        if best_cand is None or best_sim < MIN_TITLE_SIMILARITY:
            return SourceCandidate(
                source_name=self.name,
                found=False,
                error=(
                    f"DBLP: no title match above {MIN_TITLE_SIMILARITY:.2f} "
                    f"(best={best_sim:.2f}) for '{query_title[:60]}'"
                ),
            )

        best_cand.found = True
        best_cand.score = best_sim
        best_cand.confidence = min(0.95, max(0.60, best_sim))
        return best_cand

    @staticmethod
    def _extract_hits(data: dict[str, Any]) -> list[dict[str, Any]]:
        result = data.get("result", {})
        if not isinstance(result, dict):
            return []
        hits_obj = result.get("hits", {})
        if not isinstance(hits_obj, dict):
            return []
        raw_hits = hits_obj.get("hit")
        if isinstance(raw_hits, list):
            return [h for h in raw_hits if isinstance(h, dict)]
        if isinstance(raw_hits, dict):
            return [raw_hits]
        return []

    @classmethod
    def _clean_query_text(cls, text: str) -> str:
        """Clean punctuation that breaks DBLP token prefix matching."""
        cleaned = html.unescape(text or "")
        cleaned = re.sub(r"[^\w\s]", " ", cleaned, flags=re.UNICODE)
        words = [w for w in cleaned.split() if len(w) >= 2]
        return " ".join(words[:14])

    @classmethod
    def _build_query(cls, citation: Citation) -> str:
        if citation.title:
            title_q = cls._clean_query_text(citation.title)
            if title_q:
                # If title is relatively short (< 5 words), append first author surname
                if len(title_q.split()) < 5 and citation.authors:
                    surname = author_key(citation.authors[0])
                    if surname and surname.lower() not in title_q.lower():
                        return f"{title_q} {surname}"
                return title_q

        # Fallback if only raw_text/authors/year available
        parts: list[str] = []
        if citation.authors:
            surname = author_key(citation.authors[0])
            if surname:
                parts.append(surname)
        if citation.year:
            parts.append(str(citation.year)[:4])
        if citation.venue:
            parts.append(cls._clean_query_text(citation.venue))
        return " ".join(p for p in parts if p).strip()

    @classmethod
    def _info_to_candidate(cls, info: dict[str, Any]) -> SourceCandidate:
        raw_title = info.get("title") or ""
        if isinstance(raw_title, list):
            raw_title = raw_title[0] if raw_title else ""
        title = html.unescape(str(raw_title)).strip()
        if title.endswith("."):
            title = title[:-1].strip()

        # Authors in DBLP: info.authors.author can be dict or list of dicts/strings
        authors: list[str] = []
        authors_container = info.get("authors")
        if isinstance(authors_container, dict):
            raw_authors = authors_container.get("author", [])
            if isinstance(raw_authors, (dict, str)):
                raw_authors = [raw_authors]
            if isinstance(raw_authors, list):
                for a in raw_authors:
                    name_str = ""
                    if isinstance(a, dict):
                        name_str = str(a.get("text") or a.get("#text") or "").strip()
                    elif isinstance(a, str):
                        name_str = a.strip()
                    if name_str:
                        name_str = html.unescape(_DBLP_DISAMBIG_RE.sub("", name_str).strip())
                        if name_str:
                            authors.append(name_str)

        year_raw = info.get("year")
        year = str(year_raw).strip()[:4] if year_raw else None

        venue_raw = info.get("venue")
        if isinstance(venue_raw, list):
            venue = ", ".join(str(v) for v in venue_raw if v) or None
        elif venue_raw:
            venue = str(venue_raw).strip()
        else:
            venue = None

        doi_raw = info.get("doi")
        doi = normalize_doi(str(doi_raw)) if doi_raw else None

        ee_raw = info.get("ee")
        if isinstance(ee_raw, list):
            url = str(ee_raw[0]) if ee_raw else None
        elif ee_raw:
            url = str(ee_raw)
        else:
            url = str(info.get("url")) if info.get("url") else None

        external_ids: dict[str, str] = {}
        if info.get("key"):
            external_ids["dblp_key"] = str(info["key"])
        if doi:
            external_ids["doi"] = doi

        # Extract arXiv ID for CoRR preprints
        vol = str(info.get("volume") or "")
        m_corr = _CORR_VOL_RE.search(vol)
        if m_corr:
            arxiv_id = m_corr.group(1)
            external_ids["arxiv"] = arxiv_id
            if not doi:
                doi = f"10.48550/arxiv.{arxiv_id}"

        return SourceCandidate(
            source_name=cls.name,
            found=False,
            doi=doi,
            title=title or None,
            authors=authors,
            year=year,
            venue=venue,
            url=url,
            external_ids=external_ids,
        )

    async def _fetch_json_with_retry(self, params: dict[str, Any]) -> dict[str, Any] | None:
        import random

        loop_id = id(asyncio.get_running_loop())
        now = time.monotonic()
        with _DBLP_GLOBAL_SLOT_LOCK:
            open_until = _DBLP_CIRCUIT_OPEN_UNTIL.get(loop_id, 0.0)
        if now < open_until:
            self._last_status_code = 503
            return None

        sem, challenge_lock, _ = _get_dblp_sync_primitives()
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
                        loop_cookies = _get_dblp_cookies()
                        # Serialize initial request when DBLP Anubis cookie has not been acquired yet
                        if len(loop_cookies) == 0:
                            async with challenge_lock:
                                resp = await self._execute_dblp_get(params)
                        else:
                            resp = await self._execute_dblp_get(params)
                        retry_after = self._record_http_response(resp)
                        if resp.status_code == 404:
                            with _DBLP_GLOBAL_SLOT_LOCK:
                                _DBLP_CONSECUTIVE_FAILURES[loop_id] = 0
                            return None
                        if resp.status_code == 429:
                            seen_429 += 1
                            if seen_429 >= 2 or (retry_after is not None and retry_after > 3.0):
                                return None
                            await asyncio.sleep(
                                (retry_after or random.uniform(0.7, 1.4))
                                + random.uniform(0.05, 0.25)
                            )
                        if resp.status_code == 429 or resp.status_code >= 500:
                            if getattr(resp, "_request", None) is None:
                                resp._request = httpx.Request("GET", self.BASE_URL)
                            resp.raise_for_status()
                        if resp.status_code != 200:
                            return None
                        with _DBLP_GLOBAL_SLOT_LOCK:
                            _DBLP_CONSECUTIVE_FAILURES[loop_id] = 0
                        return resp.json()
        except RetryError as exc:
            self._record_transport_error(exc)
            with _DBLP_GLOBAL_SLOT_LOCK:
                fails = _DBLP_CONSECUTIVE_FAILURES.get(loop_id, 0) + 1
                _DBLP_CONSECUTIVE_FAILURES[loop_id] = fails
                if fails >= 2:
                    _DBLP_CIRCUIT_OPEN_UNTIL[loop_id] = time.monotonic() + _DBLP_CIRCUIT_COOLDOWN_SEC
            logger.warning(f"DBLP retry exhausted: {exc}")
            return None
        except Exception as exc:  # noqa: BLE001
            self._record_transport_error(exc)
            logger.warning(f"DBLP error: {exc}")
            return None
        return None

    async def _execute_dblp_get(self, params: dict[str, Any]) -> httpx.Response:
        from integrity_checker.retrieval.http_pool import get_shared_http_client

        loop_id = id(asyncio.get_running_loop())
        loop_cookies = _get_dblp_cookies()
        with _DBLP_GLOBAL_SLOT_LOCK:
            now = time.monotonic()
            if isinstance(_LAST_DBLP_REQ_AT, dict):
                if loop_id in _LAST_DBLP_REQ_AT and _LAST_DBLP_REQ_AT[loop_id] == 0.0:
                    _LAST_DBLP_REQ_AT.clear()
                    last_at = 0.0
                else:
                    last_at = max(_LAST_DBLP_REQ_AT.values(), default=0.0)
                scheduled = max(now, last_at + _DBLP_MIN_INTERVAL) if last_at > 0 else now
                _LAST_DBLP_REQ_AT[loop_id] = scheduled
            else:
                last_at = float(_LAST_DBLP_REQ_AT or 0.0)
                scheduled = max(now, last_at + _DBLP_MIN_INTERVAL) if last_at > 0 else now
            wait_sec = scheduled - now
        if wait_sec > 0:
            await asyncio.sleep(wait_sec)
        client = get_shared_http_client(follow_redirects=True)
        if len(loop_cookies) > 0:
            client.cookies.update(loop_cookies)
        resp = await client.get(
            self.BASE_URL,
            params=params,
            headers=self._headers,
            timeout=self.timeout,
        )
        refresh = resp.headers.get("refresh") if hasattr(resp, "headers") else None
        if resp.status_code == 202 and refresh and "url=" in refresh:
            try:
                wait_str, next_part = refresh.split(";", 1)
                wait_sec_c = min(float(wait_str.strip()), 3.0)
                next_path = next_part.split("url=", 1)[1].strip()
                await asyncio.sleep(wait_sec_c + 0.5)
                challenge_url = (
                    f"{self.BASE_ORIGIN}{next_path}"
                    if next_path.startswith("/")
                    else next_path
                )
                resp = await client.get(
                    challenge_url, headers=self._headers, timeout=self.timeout
                )
                if resp.status_code == 202:
                    await asyncio.sleep(0.6)
                    resp = await client.get(
                        self.BASE_URL,
                        params=params,
                        headers=self._headers,
                        timeout=self.timeout,
                    )
                loop_cookies.update(client.cookies)
                with _DBLP_GLOBAL_SLOT_LOCK:
                    _SHARED_DBLP_COOKIES.update(client.cookies)
            except Exception as chal_exc:  # noqa: BLE001
                logger.debug(f"DBLP challenge follow failed: {chal_exc}")
        else:
            loop_cookies.update(client.cookies)
            with _DBLP_GLOBAL_SLOT_LOCK:
                _SHARED_DBLP_COOKIES.update(client.cookies)
        return resp
