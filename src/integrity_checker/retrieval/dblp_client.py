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
import weakref
from typing import Any
from urllib.parse import urljoin, urlsplit

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
class _DblpCookieStore(dict[str, str]):
    """Per-event-loop isolated cookie dict supporting httpx.Cookies.set(k, v) ergonomics."""

    def set(self, name: str, value: str, **_kwargs: Any) -> None:
        self[str(name)] = str(value)


_SHARED_DBLP_COOKIES: _DblpCookieStore = _DblpCookieStore()
_DBLP_LOOP_COOKIES: weakref.WeakKeyDictionary[
    asyncio.AbstractEventLoop, _DblpCookieStore
] = weakref.WeakKeyDictionary()
_DBLP_LOOP_LOCKS: weakref.WeakKeyDictionary[
    asyncio.AbstractEventLoop, tuple[asyncio.Semaphore, asyncio.Lock, asyncio.Lock]
] = weakref.WeakKeyDictionary()
_DBLP_GLOBAL_SLOT_LOCK = threading.Lock()
_LAST_DBLP_REQ_AT: weakref.WeakKeyDictionary[asyncio.AbstractEventLoop, float] = (
    weakref.WeakKeyDictionary()
)
_LAST_DBLP_GLOBAL_AT: float = 0.0
_DBLP_MIN_INTERVAL = 0.65
_DBLP_CONSECUTIVE_FAILURES: weakref.WeakKeyDictionary[asyncio.AbstractEventLoop, int] = (
    weakref.WeakKeyDictionary()
)
_DBLP_CIRCUIT_OPEN_UNTIL: weakref.WeakKeyDictionary[asyncio.AbstractEventLoop, float] = (
    weakref.WeakKeyDictionary()
)
_DBLP_CIRCUIT_COOLDOWN_SEC = 45.0
_ALLOWED_DBLP_HOSTS = frozenset({"dblp.uni-trier.de", "dblp.org"})


def _get_dblp_cookies() -> _DblpCookieStore:
    loop = asyncio.get_running_loop()
    with _DBLP_GLOBAL_SLOT_LOCK:
        cookies = _DBLP_LOOP_COOKIES.get(loop)
        if cookies is None:
            cookies = _DblpCookieStore(_SHARED_DBLP_COOKIES)
            _DBLP_LOOP_COOKIES[loop] = cookies
        elif not cookies and _SHARED_DBLP_COOKIES:
            cookies.update(_SHARED_DBLP_COOKIES)
        return cookies


def _get_dblp_sync_primitives() -> tuple[asyncio.Semaphore, asyncio.Lock, asyncio.Lock]:
    loop = asyncio.get_running_loop()
    with _DBLP_GLOBAL_SLOT_LOCK:
        prims = _DBLP_LOOP_LOCKS.get(loop)
        if prims is None:
            prims = (asyncio.Semaphore(2), asyncio.Lock(), asyncio.Lock())
            _DBLP_LOOP_LOCKS[loop] = prims
        return prims


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

    @classmethod
    def reset_circuit_state(cls) -> None:
        """Reset per-loop DBLP circuit state and request pacing timestamps."""
        global _LAST_DBLP_GLOBAL_AT
        with _DBLP_GLOBAL_SLOT_LOCK:
            _DBLP_CONSECUTIVE_FAILURES.clear()
            _DBLP_CIRCUIT_OPEN_UNTIL.clear()
            _LAST_DBLP_REQ_AT.clear()
            _LAST_DBLP_GLOBAL_AT = 0.0

    async def lookup(self, citation: Citation) -> SourceCandidate:
        """Search DBLP by title (and optional author/year)."""
        self._reset_http_telemetry()

        query = self._build_query(citation)
        if not query:
            return SourceCandidate(
                source_name=self.name,
                found=False,
                error="DBLP: no title or searchable metadata",
            )

        data = await self._fetch_json_with_retry({"q": query, "h": 10, "format": "json"})
        if not data:
            return self._build_miss_or_error_candidate(
                "DBLP",
                query[:60],
                clean_miss_error=f"DBLP: no response for '{query[:60]}'",
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

        loop = asyncio.get_running_loop()
        now = time.monotonic()
        with _DBLP_GLOBAL_SLOT_LOCK:
            open_until = _DBLP_CIRCUIT_OPEN_UNTIL.get(loop, 0.0)
        if now < open_until:
            self._record_transport_error(RuntimeError("DBLP local circuit open"))
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
                                _DBLP_CONSECUTIVE_FAILURES[loop] = 0
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
                            _DBLP_CONSECUTIVE_FAILURES[loop] = 0
                        return resp.json()
        except RetryError as exc:
            self._record_transport_error(exc)
            with _DBLP_GLOBAL_SLOT_LOCK:
                fails = _DBLP_CONSECUTIVE_FAILURES.get(loop, 0) + 1
                _DBLP_CONSECUTIVE_FAILURES[loop] = fails
                if fails >= 2:
                    _DBLP_CIRCUIT_OPEN_UNTIL[loop] = time.monotonic() + _DBLP_CIRCUIT_COOLDOWN_SEC
            logger.warning(f"DBLP retry exhausted: {exc}")
            return None
        except Exception as exc:  # noqa: BLE001
            self._record_transport_error(exc)
            logger.warning(f"DBLP error: {exc}")
            return None
        return None

    @staticmethod
    def _is_valid_dblp_challenge_url(url: str) -> bool:
        try:
            parsed = urlsplit(url)
        except ValueError:
            return False
        if (parsed.scheme or "").lower() != "https":
            return False
        if parsed.username is not None or parsed.password is not None or "@" in (parsed.netloc or ""):
            return False
        try:
            port = parsed.port
        except ValueError:
            return False
        if port not in (None, 443):
            return False
        return (parsed.hostname or "").lower() in _ALLOWED_DBLP_HOSTS

    @staticmethod
    def _capture_response_cookies(
        resp: httpx.Response,
        client: httpx.AsyncClient,
        loop_cookies: dict[str, str],
    ) -> None:
        from http.cookies import SimpleCookie

        headers = getattr(resp, "headers", None)
        if headers is None:
            return
        get_list_fn = getattr(headers, "get_list", None)
        if callable(get_list_fn):
            raw_set_cookies = list(get_list_fn("set-cookie"))
        else:
            single = headers.get("set-cookie") or headers.get("Set-Cookie")
            raw_set_cookies = [single] if single else []
        if not raw_set_cookies:
            return

        extracted: dict[str, str] = {}
        for header_val in raw_set_cookies:
            if not header_val:
                continue
            jar = SimpleCookie()
            try:
                jar.load(str(header_val))
                for k, morsel in jar.items():
                    if k and morsel.value is not None:
                        extracted[str(k)] = str(morsel.value)
            except Exception:  # noqa: BLE001
                continue
        if not extracted:
            return
        with _DBLP_GLOBAL_SLOT_LOCK:
            loop_cookies.update(extracted)
            _SHARED_DBLP_COOKIES.update(extracted)
        # Ensure shared httpx.AsyncClient cookie jar stays unmutated across tenants/loops
        if len(client.cookies) > 0:
            for k in extracted:
                client.cookies.delete(k)

    def _build_dblp_headers(self, loop_cookies: dict[str, str]) -> dict[str, str]:
        with _DBLP_GLOBAL_SLOT_LOCK:
            cookie_header = (
                "; ".join(f"{k}={v}" for k, v in loop_cookies.items())
                if loop_cookies
                else ""
            )
        headers = dict(self._headers)
        if cookie_header:
            headers["Cookie"] = cookie_header
        return headers

    async def _execute_dblp_get(self, params: dict[str, Any]) -> httpx.Response:
        global _LAST_DBLP_GLOBAL_AT, _LAST_DBLP_REQ_AT
        from integrity_checker.retrieval.http_pool import get_shared_http_client

        loop = asyncio.get_running_loop()
        loop_cookies = _get_dblp_cookies()
        with _DBLP_GLOBAL_SLOT_LOCK:
            now = time.monotonic()
            req_map: Any = _LAST_DBLP_REQ_AT
            if not isinstance(req_map, weakref.WeakKeyDictionary):
                scalar_at = float(req_map) if isinstance(req_map, (int, float)) else 0.0
                _LAST_DBLP_REQ_AT = weakref.WeakKeyDictionary()
                if scalar_at <= 0.0:
                    _LAST_DBLP_GLOBAL_AT = 0.0
                    last_at = 0.0
                else:
                    _LAST_DBLP_GLOBAL_AT = scalar_at
                    last_at = scalar_at
            elif loop in _LAST_DBLP_REQ_AT and _LAST_DBLP_REQ_AT[loop] == 0.0:
                _LAST_DBLP_REQ_AT.clear()
                _LAST_DBLP_GLOBAL_AT = 0.0
                last_at = 0.0
            else:
                last_at = (
                    max(_LAST_DBLP_GLOBAL_AT, *_LAST_DBLP_REQ_AT.values())
                    if _LAST_DBLP_REQ_AT
                    else _LAST_DBLP_GLOBAL_AT
                )
            scheduled = max(now, last_at + _DBLP_MIN_INTERVAL) if last_at > 0 else now
            _LAST_DBLP_GLOBAL_AT = scheduled
            _LAST_DBLP_REQ_AT[loop] = scheduled
            wait_sec = scheduled - now
        if wait_sec > 0:
            await asyncio.sleep(wait_sec)

        req_headers = self._build_dblp_headers(loop_cookies)
        client = get_shared_http_client(follow_redirects=True)
        resp = await client.get(
            self.BASE_URL,
            params=params,
            headers=req_headers,
            timeout=self.timeout,
        )
        self._capture_response_cookies(resp, client, loop_cookies)

        refresh = resp.headers.get("refresh") if hasattr(resp, "headers") else None
        if resp.status_code == 202 and refresh and "url=" in refresh:
            try:
                wait_str, next_part = refresh.split(";", 1)
                wait_sec_c = min(max(0.0, float(wait_str.strip())), 3.0)
                next_path = next_part.split("url=", 1)[1].strip().strip("'\"")
                challenge_url = urljoin(f"{self.BASE_ORIGIN}/", next_path)
                if not self._is_valid_dblp_challenge_url(challenge_url):
                    logger.warning(
                        f"DBLP blocked off-origin Refresh challenge URL: {challenge_url!r}"
                    )
                    return resp
                await asyncio.sleep(wait_sec_c + 0.5)
                resp = await client.get(
                    challenge_url,
                    headers=self._build_dblp_headers(loop_cookies),
                    timeout=self.timeout,
                )
                self._capture_response_cookies(resp, client, loop_cookies)
                if resp.status_code == 202:
                    await asyncio.sleep(0.6)
                    resp = await client.get(
                        self.BASE_URL,
                        params=params,
                        headers=self._build_dblp_headers(loop_cookies),
                        timeout=self.timeout,
                    )
                    self._capture_response_cookies(resp, client, loop_cookies)
            except Exception as chal_exc:  # noqa: BLE001
                logger.debug(f"DBLP challenge follow failed: {chal_exc}")
        return resp
