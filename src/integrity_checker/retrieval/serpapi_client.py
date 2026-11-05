"""Tier-3 Google Scholar Fallback Router — Serper.dev (/scholar) primary + SerpApi fallback.

Architecture:
    1. Priority 1: Serper.dev Google Scholar API (`POST https://google.serper.dev/scholar`)
       via native async `httpx.AsyncClient` (2,500 free queries, low latency, no sync thread pool).
    2. Priority 2: SerpApi Google Scholar API (`engine=google_scholar`)
       automatic fallback when `SERPER_API_KEY` is unconfigured, out of credits/quota,
       or encounters a transient API/network error.

Preserves `source_name="serpapi"` ("Google Scholar" in UI & DB analytics) for full
backward compatibility across pipeline, rules, and database statistics.
"""

from __future__ import annotations

import asyncio
import os
import random
import re
from contextvars import ContextVar
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
from integrity_checker.retrieval.http_pool import get_shared_http_client
from integrity_checker.retrieval.normalization import title_similarity

# Minimum title similarity để chấp nhận một organic result.
# Google Scholar xếp hạng theo độ liên quan mờ, nên kết quả top-1 có thể là bài
# hoàn toàn khác chủ đề (vd. "Persuasion: Theory and research" cho "Attention Is
# All You Need"). Chỉ nhận result nếu title khớp được với citation.
MIN_TITLE_SIMILARITY = 0.60

# Số organic result tối đa được duyệt từ SerpApi / Serper Scholar.
MAX_FALLBACK_RESULTS = 5
MAX_SERPER_RESULTS = 10

_SERPER_QUOTA_KEYWORDS = (
    "not enough credits",
    "out of credits",
    "insufficient credits",
    "credits",
    "quota",
    "exceeded",
    "unauthorized",
    "invalid api key",
    "forbidden",
    "upgrade",
)

_SERPAPI_QUOTA_KEYWORDS = (
    "run out of searches",
    "quota",
    "searches per month",
    "exceeded",
    "forbidden",
)

_DOMAIN_ONLY_TOKEN_RE = re.compile(r"^[a-z0-9.-]+\.[a-z]{2,6}$", re.IGNORECASE)
_PURE_YEAR_RE = re.compile(r"^\d{4}$")

_LAST_SERPER_ERR_VAR: ContextVar[str | None] = ContextVar("_LAST_SERPER_ERR_VAR", default=None)
_LAST_SERPAPI_ERR_VAR: ContextVar[str | None] = ContextVar("_LAST_SERPAPI_ERR_VAR", default=None)

logger = get_logger(__name__)


class SerpApiClient(BaseScholarClient):
    """Google Scholar Fallback Router (Serper.dev `/scholar` -> SerpApi `google_scholar`).

    Features:
        - Async `httpx.AsyncClient` primary lookup via Serper.dev `/scholar` (`SERPER_API_KEY`)
        - Seamless fallback to SerpApi (`SERPAPI_API_KEY`) when Serper is unconfigured,
          exhausts credits, or fails with HTTP/network errors
        - Independent circuit breakers for Serper (`_serper_quota_exhausted`) and
          SerpApi (`_quota_exhausted`) + shared negative query cache
        - Year-consistent filtering (±1 year) & fuzzy title verification
    """

    BASE_URL = "https://serpapi.com"
    SERPER_SCHOLAR_URL = "https://google.serper.dev/scholar"
    name = "serpapi"
    MAX_NEGATIVE_CACHE_SIZE = 2048
    _quota_exhausted: bool = False
    _serper_quota_exhausted: bool = False
    _negative_query_cache: set[tuple[str, str]] = set()

    def __init__(
        self,
        api_key: str | None = None,
        timeout: float = 30.0,
        max_retries: int | None = None,
        *,
        serper_api_key: str | None = None,
    ) -> None:
        super().__init__(timeout=timeout)
        settings = get_settings()

        if api_key is None and serper_api_key is None:
            # Production default: load both Serper (primary) and SerpApi (secondary) from env/settings
            self.serper_api_key = (
                os.getenv("SERPER_API_KEY", "") or getattr(settings, "serper_api_key", "") or ""
            ).strip()
            self.api_key = (
                os.getenv("SERPAPI_API_KEY", "") or settings.serpapi_api_key or ""
            ).strip()
        else:
            # Explicit injection: isolate keys to only what the caller explicitly supplied
            self.serper_api_key = (serper_api_key or "").strip()
            self.api_key = (api_key or "").strip()

        self.max_retries = max_retries or settings.retrieval.retry.max_attempts
        self._backoff = settings.retrieval.retry.backoff
        self._last_api_error = None
        self._last_serper_error = None

        if not self.serper_api_key and not self.api_key:
            logger.warning(
                "Google Scholar fallback: No API key found. "
                "Set SERPER_API_KEY (primary) or SERPAPI_API_KEY (fallback) in .env"
            )

    @property
    def _last_serper_error(self) -> str | None:
        return _LAST_SERPER_ERR_VAR.get()

    @_last_serper_error.setter
    def _last_serper_error(self, value: str | None) -> None:
        _LAST_SERPER_ERR_VAR.set(value)

    @property
    def _last_api_error(self) -> str | None:
        return _LAST_SERPAPI_ERR_VAR.get()

    @_last_api_error.setter
    def _last_api_error(self, value: str | None) -> None:
        _LAST_SERPAPI_ERR_VAR.set(value)

    @classmethod
    def reset_circuit_breakers(cls) -> None:
        """Reset both Serper and SerpApi quota circuit breakers and negative query cache."""
        SerpApiClient._quota_exhausted = False
        SerpApiClient._serper_quota_exhausted = False
        SerpApiClient._negative_query_cache.clear()

    @classmethod
    def _record_negative_cache(cls, cache_key: tuple[str, str]) -> None:
        if len(SerpApiClient._negative_query_cache) >= cls.MAX_NEGATIVE_CACHE_SIZE:
            # Evict an arbitrary half when full to bound memory in long-lived workers
            for _ in range(cls.MAX_NEGATIVE_CACHE_SIZE // 2):
                try:
                    SerpApiClient._negative_query_cache.pop()
                except KeyError:
                    break
        SerpApiClient._negative_query_cache.add(cache_key)

    async def lookup(self, citation: Citation) -> SourceCandidate:
        """Lookup paper trên Google Scholar qua Serper.dev (ưu tiên 1) -> SerpApi (dự phòng 2)."""
        self._reset_http_telemetry()
        has_serper = bool(self.serper_api_key)
        has_serpapi = bool(self.api_key)

        if not has_serper and not has_serpapi:
            return SourceCandidate(
                source_name=self.name,
                found=False,
                error="SerpApi: No API key configured",
            )

        serper_available = has_serper and not SerpApiClient._serper_quota_exhausted
        serpapi_available = has_serpapi and not SerpApiClient._quota_exhausted

        if not serper_available and not serpapi_available:
            return SourceCandidate(
                source_name=self.name,
                found=False,
                error="SerpApi: Quota exhausted (circuit breaker active)",
            )

        if not citation.title and not citation.authors:
            return SourceCandidate(
                source_name=self.name,
                found=False,
                error="SerpApi: No title or author for search",
            )

        query = self._build_search_query(citation)
        if not query:
            return SourceCandidate(
                source_name=self.name,
                found=False,
                error="SerpApi: Empty search query",
            )

        cache_key = (query.strip().lower(), str(citation.year or "").strip())
        if cache_key in SerpApiClient._negative_query_cache:
            return SourceCandidate(
                source_name=self.name,
                found=False,
                error=f"SerpApi: Cached negative result for '{query[:60]}'",
            )

        # ===== Priority 1: Serper.dev (/scholar) async HTTP =====
        if serper_available:
            self._last_serper_error = None
            serper_item, serper_clean_ok = await self._search_serper_with_retry(query, citation)

            if serper_clean_ok:
                if not serper_item:
                    self._record_negative_cache(cache_key)
                    return SourceCandidate(
                        source_name=self.name,
                        found=False,
                        error=f"SerpApi: No results for '{query[:60]}'",
                    )

                if citation.title:
                    similarity = title_similarity(citation.title, serper_item.get("title"))
                    if similarity < MIN_TITLE_SIMILARITY:
                        self._record_negative_cache(cache_key)
                        logger.info(
                            f"Serper Scholar: title mismatch ({similarity:.2f}) for '{query[:60]}' "
                            f"→ '{str(serper_item.get('title'))[:60]}'"
                        )
                        return SourceCandidate(
                            source_name=self.name,
                            found=False,
                            error=f"SerpApi: No title match for '{query[:60]}'",
                        )

                return self._serper_result_to_candidate(serper_item)

            # Serper encountered quota exhaustion or HTTP/network error -> try SerpApi if available
            if has_serpapi and not SerpApiClient._quota_exhausted:
                logger.warning(
                    f"Serper Scholar unavailable ({self._last_serper_error or 'quota/error'}); "
                    f"falling back to SerpApi for '{query[:60]}'"
                )
            else:
                if SerpApiClient._serper_quota_exhausted:
                    return SourceCandidate(
                        source_name=self.name,
                        found=False,
                        error="SerpApi: Quota exhausted (circuit breaker active)",
                    )
                return SourceCandidate(
                    source_name=self.name,
                    found=False,
                    error=f"SerpApi: {self._last_serper_error or 'Serper Scholar request failed'}",
                )

        # ===== Priority 2: SerpApi Google Scholar fallback =====
        if not has_serpapi:
            return SourceCandidate(
                source_name=self.name,
                found=False,
                error="SerpApi: Quota exhausted (circuit breaker active)",
            )

        if SerpApiClient._quota_exhausted:
            return SourceCandidate(
                source_name=self.name,
                found=False,
                error="SerpApi: Quota exhausted (circuit breaker active)",
            )

        self._last_api_error = None
        result = await self._search_with_retry(query, citation)

        if SerpApiClient._quota_exhausted:
            return SourceCandidate(
                source_name=self.name,
                found=False,
                error="SerpApi: Quota exhausted (circuit breaker active)",
            )

        if not result:
            if self._last_api_error:
                return SourceCandidate(
                    source_name=self.name,
                    found=False,
                    error=f"SerpApi: {self._last_api_error}",
                )
            self._record_negative_cache(cache_key)
            return SourceCandidate(
                source_name=self.name,
                found=False,
                error=f"SerpApi: No results for '{query[:60]}'",
            )

        if citation.title:
            similarity = title_similarity(citation.title, result.get("title"))
            if similarity < MIN_TITLE_SIMILARITY:
                self._record_negative_cache(cache_key)
                logger.info(
                    f"SerpApi: title mismatch ({similarity:.2f}) for '{query[:60]}' "
                    f"→ '{str(result.get('title'))[:60]}'"
                )
                return SourceCandidate(
                    source_name=self.name,
                    found=False,
                    error=f"SerpApi: No title match for '{query[:60]}'",
                )

        return self._result_to_candidate(result)

    def _build_search_query(self, citation: Citation) -> str:
        """Build Google Scholar search query từ citation.

        Priority: title > author + year > raw text
        """
        if citation.title:
            return citation.title[:300]  # Scholar query limit

        # Fallback: author + year
        if citation.authors and citation.year:
            first_author = citation.authors[0]
            if hasattr(first_author, "last_name"):
                author_name = first_author.last_name
            else:
                author_name = (
                    first_author.split()[-1]
                    if isinstance(first_author, str) and first_author.split()
                    else str(first_author)
                )
            return f"{author_name} {citation.year}"

        # Last resort: raw text
        return citation.raw_text[:300] if citation.raw_text else ""

    async def _search_serper_with_retry(
        self,
        query: str,
        citation: Citation,
    ) -> tuple[dict[str, Any] | None, bool]:
        """Execute async POST to Serper.dev `/scholar` with tenacity retry on transient errors.

        Returns:
            (best_organic_item, clean_http_200_ok)
            - If `clean_http_200_ok` is True, Google Scholar responded cleanly via Serper
              (no fallback to SerpApi needed even if `best_organic_item` is None).
            - If `clean_http_200_ok` is False, Serper failed (quota/auth/timeout/5xx) and
              caller should fall back to SerpApi if configured.
        """
        year_str = str(citation.year or "").strip()
        year_int = int(year_str[:4]) if len(year_str) >= 4 and year_str[:4].isdigit() else None
        headers = {
            "X-API-KEY": self.serper_api_key,
            "Content-Type": "application/json",
        }
        payload: dict[str, Any] = {"q": query}
        seen_429 = 0

        retry = AsyncRetrying(
            stop=stop_after_attempt(min(self.max_retries, 3)),
            wait=wait_exponential(
                multiplier=self._backoff.multiplier,
                min=self._backoff.initial_seconds,
                max=min(self._backoff.max_seconds, 10.0),
            ),
            retry=retry_if_exception_type((
                httpx.HTTPStatusError,
                httpx.TimeoutException,
                httpx.ConnectTimeout,
                httpx.ReadTimeout,
                httpx.WriteTimeout,
                httpx.PoolTimeout,
                httpx.NetworkError,
                ConnectionError,
                OSError,
            )),
            reraise=False,
        )

        try:
            async for attempt in retry:
                with attempt:
                    http_client = get_shared_http_client()
                    resp = await http_client.post(
                        self.SERPER_SCHOLAR_URL,
                        headers=headers,
                        json=payload,
                        timeout=self.timeout,
                    )
                    retry_after = self._record_http_response(resp)

                    status = resp.status_code
                    if status == 200:
                        try:
                            data = resp.json()
                        except ValueError as exc:
                            self._last_serper_error = f"Invalid JSON from Serper: {exc}"
                            return None, False

                        if not isinstance(data, dict):
                            self._last_serper_error = "Unexpected response format from Serper"
                            return None, False

                        # Detect body-level error without organic list
                        if ("message" in data or "error" in data) and "organic" not in data and "organic_results" not in data:
                            err_msg = str(data.get("message") or data.get("error") or "Serper error")
                            if any(kw in err_msg.lower() for kw in _SERPER_QUOTA_KEYWORDS):
                                SerpApiClient._serper_quota_exhausted = True
                                logger.warning(f"Serper Scholar quota circuit breaker tripped: {err_msg}")
                            self._last_serper_error = err_msg
                            return None, False

                        organic = (data.get("organic") or data.get("organic_results") or [])[:MAX_SERPER_RESULTS]
                        candidates = (
                            self._filter_serper_by_year(organic, year_int)
                            if year_int is not None
                            else organic
                        )
                        if not candidates:
                            return None, True

                        best = self._select_best_scholar_item(
                            candidates,
                            target_title=citation.title or query,
                        )
                        return best, True

                    # Extract error body for non-200 responses
                    err_body = ""
                    try:
                        err_json = resp.json()
                        if isinstance(err_json, dict):
                            err_body = str(err_json.get("message") or err_json.get("error") or "")
                    except ValueError:
                        err_body = (resp.text or "").strip()[:200]
                    err_summary = err_body or f"HTTP {status}"

                    # Permanent client/quota/auth errors -> trip circuit breaker & do NOT retry
                    if status in (400, 401, 402, 403):
                        if status in (401, 402, 403) or any(
                            kw in err_summary.lower() for kw in _SERPER_QUOTA_KEYWORDS
                        ):
                            SerpApiClient._serper_quota_exhausted = True
                            logger.warning(
                                f"Serper Scholar circuit breaker tripped (HTTP {status}): {err_summary}"
                            )
                        self._last_serper_error = f"Serper HTTP {status}: {err_summary}"
                        return None, False

                    if status == 429 and any(
                        kw in err_summary.lower()
                        for kw in ("not enough credits", "out of credits", "insufficient credits", "quota exceeded")
                    ):
                        SerpApiClient._serper_quota_exhausted = True
                        logger.warning(
                            f"Serper Scholar quota exhausted (HTTP 429): {err_summary}"
                        )
                        self._last_serper_error = f"Serper HTTP 429: {err_summary}"
                        return None, False

                    if status == 429:
                        self._last_serper_error = f"Serper HTTP 429: {err_summary}"
                        seen_429 += 1
                        if seen_429 >= 2 or (retry_after is not None and retry_after > 3.0):
                            return None, False
                        await asyncio.sleep(
                            (retry_after or random.uniform(0.6, 1.2))
                            + random.uniform(0.05, 0.25)
                        )
                        raise httpx.HTTPStatusError(
                            self._last_serper_error,
                            request=resp.request,
                            response=resp,
                        )

                    if status >= 500:
                        self._last_serper_error = f"Serper HTTP {status}: {err_summary}"
                        raise httpx.HTTPStatusError(
                            self._last_serper_error,
                            request=resp.request,
                            response=resp,
                        )

                    self._last_serper_error = f"Serper HTTP {status}: {err_summary}"
                    return None, False

            return None, False
        except RetryError as exc:
            self._record_transport_error(exc)
            logger.warning(f"Serper Scholar retry exhausted for query: {query[:60]}")
            if not self._last_serper_error:
                self._last_serper_error = "Serper retry exhausted"
            return None, False
        except httpx.HTTPError as exc:
            self._record_transport_error(exc)
            self._last_serper_error = str(exc) or exc.__class__.__name__
            logger.warning(f"Serper Scholar HTTP error: {self._last_serper_error}")
            return None, False
        except Exception as exc:  # noqa: BLE001
            self._record_transport_error(exc)
            self._last_serper_error = str(exc) or exc.__class__.__name__
            logger.error(f"Serper Scholar unexpected error: {exc}")
            return None, False

    @staticmethod
    def _select_best_scholar_item(
        candidates: list[dict[str, Any]],
        target_title: str,
    ) -> dict[str, Any] | None:
        """Select the organic result with highest title similarity (preserving rank order on ties)."""
        if not candidates:
            return None
        if not target_title:
            return candidates[0]

        best: dict[str, Any] | None = None
        best_sim = -1.0
        for item in candidates:
            cand_title = item.get("title")
            sim = title_similarity(target_title, cand_title) if cand_title else 0.0
            if sim > best_sim:
                best = item
                best_sim = sim
        return best or candidates[0]

    async def _search_with_retry(
        self,
        query: str,
        citation: Citation,
    ) -> dict | None:
        """Execute SerpApi search với tenacity retry on network/temporary failures."""
        retry = AsyncRetrying(
            stop=stop_after_attempt(self.max_retries),
            wait=wait_exponential(
                multiplier=self._backoff.multiplier,
                min=self._backoff.initial_seconds,
                max=self._backoff.max_seconds,
            ),
            retry=retry_if_exception_type((
                httpx.HTTPError,
                httpx.TimeoutException,
                httpx.ConnectTimeout,
                httpx.ReadTimeout,
                httpx.WriteTimeout,
                httpx.PoolTimeout,
                ConnectionError,
                OSError,
            )),
            reraise=False,
        )

        def _run_sync_in_thread() -> tuple[dict | None, str | None]:
            self._last_api_error = None
            res = self._sync_search(query, citation.year, bool(citation.title))
            return res, self._last_api_error

        try:
            async for attempt in retry:
                with attempt:
                    # SerpApi SDK client is sync, run in thread pool and propagate task-local error
                    result, api_err = await asyncio.get_running_loop().run_in_executor(
                        None,
                        _run_sync_in_thread,
                    )
                    self._last_api_error = api_err
                    return result
            return None
        except RetryError:
            logger.error(f"SerpApi retry exhausted for query: {query[:60]}")
            return None
        except Exception as e:  # noqa: BLE001
            logger.error(f"SerpApi error: {e}")
            return None

    def _sync_search(
        self,
        query: str,
        year: str | None = None,
        title_query: bool = True,
    ) -> dict | None:
        """Sync search wrapper cho SerpApi SDK trong asyncio executor."""
        from serpapi import GoogleScholarSearch  # Local import

        params: dict[str, Any] = {
            "engine": "google_scholar",
            "q": query,
            "api_key": self.api_key,
        }

        # Exact-phrase search cho SerpApi Google Scholar
        if title_query:
            params["as_epq"] = query

        year_str = str(year or "").strip()
        year_int = int(year_str[:4]) if len(year_str) >= 4 and year_str[:4].isdigit() else None

        try:
            search = GoogleScholarSearch(params)
            data = search.get_dict()

            # Check for API errors or quota exhaustion
            if "error" in data and not data.get("organic_results"):
                err_str = str(data.get("error") or "")
                err_lower = err_str.lower()
                if any(kw in err_lower for kw in _SERPAPI_QUOTA_KEYWORDS):
                    SerpApiClient._quota_exhausted = True
                    logger.warning(f"SerpApi quota circuit breaker tripped: {err_str}")
                elif "hasn't returned any results" not in err_lower and "no results" not in err_lower:
                    self._last_api_error = err_str
                return None

            if "search_metadata" in data:
                status = data["search_metadata"].get("status")
                if status != "Success":
                    error_msg = str(data.get("error", "Unknown SerpApi error"))
                    if any(kw in error_msg.lower() for kw in _SERPAPI_QUOTA_KEYWORDS):
                        SerpApiClient._quota_exhausted = True
                    else:
                        self._last_api_error = error_msg
                    logger.warning(f"SerpApi status={status}: {error_msg}")
                    return None

            organic = data.get("organic_results", []) or []
            candidates = organic[:MAX_FALLBACK_RESULTS]

            # Lọc theo năm ở client (±1 năm), giữ kết quả không rõ năm
            if year_int:
                candidates = self._filter_by_year(candidates, year_int)

            if title_query:
                return candidates[0] if candidates else None

            best = None
            best_sim = 0.0
            for r in candidates:
                sim = title_similarity(query, r.get("title"))
                if sim > best_sim:
                    best, best_sim = r, sim
            return best

        except Exception as e:  # noqa: BLE001
            self._last_api_error = str(e)
            logger.error(f"SerpApi sync search failed: {e}")
            return None

    @staticmethod
    def _result_year(result: dict[str, Any]) -> int | None:
        """Extract năm xuất bản từ một organic result (hỗ trợ cả Serper và SerpApi)."""
        explicit_year = result.get("year")
        if explicit_year is not None:
            year_s = str(explicit_year).strip()
            if len(year_s) >= 4 and year_s[:4].isdigit():
                y_val = int(year_s[:4])
                if 1900 <= y_val <= 2099:
                    return y_val

        pub_info = result.get("publicationInfo") or result.get("publication_info")
        pub_summary = pub_info.get("summary", "") if isinstance(pub_info, dict) else str(pub_info or "")

        candidates = [
            result.get("snippet", ""),
            pub_summary,
            result.get("title", ""),
        ]
        for text in candidates:
            if text:
                m = re.search(r"\b(19|20)\d{2}\b", str(text))
                if m:
                    return int(m.group(0))
        return None

    @classmethod
    def _filter_by_year(cls, results: list[dict[str, Any]], year: int) -> list[dict[str, Any]]:
        """Giữ kết quả trong khoảng [year-1, year+1] hoặc không rõ năm."""
        return [
            r for r in results
            if (y := cls._result_year(r)) is None or abs(y - year) <= 1
        ]

    @classmethod
    def _filter_serper_by_year(cls, results: list[dict[str, Any]], year: int) -> list[dict[str, Any]]:
        """Filter Serper `/scholar` organic items to [year-1, year+1] or unknown year."""
        return cls._filter_by_year(results, year)

    @staticmethod
    def _parse_publication_authors(summary: str) -> list[str]:
        """Parse author list from Google Scholar summary string (e.g. 'A Vaswani, N Shazeer… - NeurIPS, 2017')."""
        if not summary:
            return []
        author_part = summary.split(" - ")[0] if " - " in summary else summary
        # Strip Google Scholar truncation ellipses ('…' or '...')
        author_part = author_part.replace("…", "").replace("...", "").strip()
        if not author_part:
            return []

        authors: list[str] = []
        for raw_part in author_part.replace(" and ", ", ").split(","):
            part = raw_part.strip(" \t\r\n-–—·•")
            if not part or len(part) >= 50:
                continue
            if _PURE_YEAR_RE.match(part):
                continue
            if " " not in part and _DOMAIN_ONLY_TOKEN_RE.match(part):
                continue
            authors.append(part)
        return authors

    @classmethod
    def _serper_result_to_candidate(cls, result: dict[str, Any]) -> SourceCandidate:
        """Convert Serper.dev `/scholar` organic item -> `SourceCandidate(source_name="serpapi")`."""
        title = result.get("title")
        result_id = str(result.get("id") or result.get("result_id") or "")

        pub_info = result.get("publicationInfo") or result.get("publication_info") or ""
        summary = pub_info.get("summary", "") if isinstance(pub_info, dict) else str(pub_info or "")

        # Extract authors
        authors: list[str] = []
        raw_authors = result.get("authors")
        if isinstance(raw_authors, list):
            for entry in raw_authors:
                if isinstance(entry, dict) and entry.get("name"):
                    authors.append(str(entry["name"]).strip())
                elif isinstance(entry, str) and entry.strip():
                    authors.append(entry.strip())
        elif isinstance(pub_info, dict):
            for entry in pub_info.get("authors", []) or []:
                if isinstance(entry, dict) and entry.get("name"):
                    authors.append(str(entry["name"]).strip())
                elif isinstance(entry, str) and entry.strip():
                    authors.append(entry.strip())

        if not authors and summary:
            authors = cls._parse_publication_authors(summary)

        # Extract year
        year_int = cls._result_year(result)
        year = str(year_int) if year_int is not None else None

        # Citation count
        cited_by = result.get("citedBy") if "citedBy" in result else result.get("cited_by", 0)
        citation_count = 0
        if isinstance(cited_by, dict):
            citation_count = int(cited_by.get("total", 0) or 0)
        elif isinstance(cited_by, (int, float)) or (isinstance(cited_by, str) and cited_by.isdigit()):
            citation_count = int(cited_by)

        # URL
        link = result.get("link") or result.get("pdfUrl") or result.get("htmlUrl")
        if not link:
            links = result.get("links", []) or []
            if links and isinstance(links[0], dict):
                link = links[0].get("link")

        raw_snippet = result.get("snippet")
        snippet_abstract = (
            re.sub(r"\s+", " ", str(raw_snippet)).strip()
            if raw_snippet and len(str(raw_snippet).strip()) >= 25
            else None
        )

        return SourceCandidate(
            source_name="serpapi",
            found=True,
            title=title,
            authors=authors,
            year=year,
            url=link,
            abstract=snippet_abstract,
            external_ids={
                "scholar_provider": "serper",
                "serpapi_result_id": result_id,
                "serpapi_cite_link": "",
                "citation_count": str(citation_count) if citation_count else "",
            },
            confidence=0.5,
        )

    @classmethod
    def _result_to_candidate(cls, result: dict[str, Any]) -> SourceCandidate:
        """Convert SerpApi organic_result → SourceCandidate."""
        title = result.get("title")
        result_id = result.get("result_id")

        pub_info = result.get("publication_info", {}) or {}
        summary = pub_info.get("summary", "") if isinstance(pub_info, dict) else str(pub_info)

        authors: list[str] = []
        if isinstance(pub_info, dict):
            for a in pub_info.get("authors", []) or []:
                name = a.get("name") if isinstance(a, dict) else str(a)
                if name:
                    authors.append(name)

        if not authors and summary:
            authors = cls._parse_publication_authors(summary)

        year: str | None = None
        text_sources = [
            result.get("snippet", ""),
            summary,
            result.get("title", ""),
        ]
        for text in text_sources:
            if text:
                year_match = re.search(r"\b(19|20)\d{2}\b", str(text))
                if year_match:
                    year = year_match.group(0)
                    break

        cited_by = result.get("cited_by", {})
        citation_count = 0
        if isinstance(cited_by, dict):
            citation_count = cited_by.get("total", 0)
        elif isinstance(cited_by, int):
            citation_count = cited_by

        links = result.get("links", []) or []
        link = links[0].get("link") if links else result.get("link")

        serpapi_cite_link = result.get("serpapi_cite_link", "")

        raw_snippet = result.get("snippet")
        snippet_abstract = (
            re.sub(r"\s+", " ", str(raw_snippet)).strip()
            if raw_snippet and len(str(raw_snippet).strip()) >= 25
            else None
        )

        return SourceCandidate(
            source_name="serpapi",
            found=True,
            title=title,
            authors=authors,
            year=year,
            url=link,
            abstract=snippet_abstract,
            external_ids={
                "scholar_provider": "serpapi",
                "serpapi_result_id": result_id or "",
                "serpapi_cite_link": serpapi_cite_link or "",
                "citation_count": str(citation_count) if citation_count else "",
            },
            # Google Scholar không trả DOI/venue chuẩn trực tiếp → confidence=0.5
            confidence=0.5,
        )


class GoogleScholarFallbackClient(SerpApiClient):
    """Explicit alias subclass for Tier-3 Google Scholar Fallback Router (Serper.dev -> SerpApi)."""
