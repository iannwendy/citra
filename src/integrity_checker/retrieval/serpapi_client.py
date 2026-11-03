"""SerpApi Google Scholar client — fallback khi các API free thất bại.

Use case: Citation count verification, author lookup, venue ranking.
Không dùng làm nguồn chính vì có rate limits và chi phí.

Rate limit: Tùy gói subscription (100 searches/month free).
Docs: https://serpapi.com/google-scholar-api
"""

from __future__ import annotations

import os
import re

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
from integrity_checker.retrieval.normalization import title_similarity

# Minimum title similarity để chấp nhận một organic result.
# Google Scholar xếp hạng theo độ liên quan mờ, nên kết quả top-1 có thể là bài
# hoàn toàn khác chủ đề (vd. "Persuasion: Theory and research" cho "Attention Is
# All You Need"). Chỉ nhận result nếu title khớp được với citation.
MIN_TITLE_SIMILARITY = 0.60

# Số organic result tối đa được dùng khi query bằng author + year
# (gần như luôn lệch, cần duyệt thêm vài kết quả).
MAX_FALLBACK_RESULTS = 5

logger = get_logger(__name__)


class SerpApiClient(BaseScholarClient):
    """SerpApi Google Scholar API client.

    Features:
        - Title search (primary)
        - Author search with author: prefix
        - Year range filtering (as_ylo, as_yhi)
        - Citation count extraction
        - Author profile links
        - Quota exhaustion circuit breaker & negative query cache

    Usage: Fallback khi Crossref/OpenAlex/Semantic Scholar thất bại.
    """

    BASE_URL = "https://serpapi.com"
    name = "serpapi"
    MAX_NEGATIVE_CACHE_SIZE = 2048
    _quota_exhausted: bool = False
    _negative_query_cache: set[tuple[str, str]] = set()

    def __init__(
        self,
        api_key: str | None = None,
        timeout: float = 30.0,
        max_retries: int | None = None,
    ) -> None:
        super().__init__(timeout=timeout)
        settings = get_settings()
        # Priority: explicit api_key > env var > settings
        env_key = os.getenv("SERPAPI_API_KEY", "")
        self.api_key = api_key or env_key or settings.serpapi_api_key
        self.max_retries = max_retries or settings.retrieval.retry.max_attempts
        self._backoff = settings.retrieval.retry.backoff
        self._last_api_error: str | None = None

        if not self.api_key:
            logger.warning("SerpApi: No API key found. Set SERPAPI_API_KEY in .env")

    @classmethod
    def _record_negative_cache(cls, cache_key: tuple[str, str]) -> None:
        if len(cls._negative_query_cache) >= cls.MAX_NEGATIVE_CACHE_SIZE:
            # Evict an arbitrary half when full to bound memory in long-lived workers
            for _ in range(cls.MAX_NEGATIVE_CACHE_SIZE // 2):
                try:
                    cls._negative_query_cache.pop()
                except KeyError:
                    break
        cls._negative_query_cache.add(cache_key)

    async def lookup(self, citation: Citation) -> SourceCandidate:
        """Lookup paper trên Google Scholar qua SerpApi.

        Flow:
            1. Title search (primary)
            2. Extract citation count, authors, year

        Returns:
            SourceCandidate với found=True nếu tìm thấy kết quả.
        """
        if not self.api_key:
            return SourceCandidate(
                source_name=self.name,
                found=False,
                error="SerpApi: No API key configured",
            )

        if self.__class__._quota_exhausted:
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

        # Build search query
        query = self._build_search_query(citation)
        if not query:
            return SourceCandidate(
                source_name=self.name,
                found=False,
                error="SerpApi: Empty search query",
            )

        cache_key = (query.strip().lower(), str(citation.year or "").strip())
        if cache_key in self.__class__._negative_query_cache:
            return SourceCandidate(
                source_name=self.name,
                found=False,
                error=f"SerpApi: Cached negative result for '{query[:60]}'",
            )

        # Execute search với retry
        self._last_api_error = None
        result = await self._search_with_retry(query, citation)

        if self.__class__._quota_exhausted:
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

        # Lọc theo title: không nhận kết quả tìm bằng title nhưng lệch chủ đề
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
            return citation.title[:300]  # SerpApi query limit

        # Fallback: author + year
        if citation.authors and citation.year:
            first_author = citation.authors[0]
            # Extract last name
            if hasattr(first_author, 'last_name'):
                author_name = first_author.last_name
            else:
                author_name = first_author.split()[-1] if isinstance(first_author, str) else str(first_author)
            return f"{author_name} {citation.year}"

        # Last resort: raw text
        return citation.raw_text[:300] if citation.raw_text else ""

    async def _search_with_retry(
        self,
        query: str,
        citation: Citation,
    ) -> dict | None:
        """Execute SerpApi search với tenacity retry.

        Retry on network errors và temporary failures.
        """
        import asyncio


        # FIX: Be explicit about which exceptions to retry
        # Don't catch KeyboardInterrupt, SystemExit, MemoryError, etc.
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

        try:
            async for attempt in retry:
                with attempt:
                    # SerpApi client is sync, run in thread pool
                    result = await asyncio.get_running_loop().run_in_executor(
                        None,
                        self._sync_search,
                        query,
                        citation.year,
                        bool(citation.title),
                    )
                    return result
            return None
        except RetryError:
            logger.error(f"SerpApi retry exhausted for query: {query[:60]}")
            return None
        except Exception as e:
            logger.error(f"SerpApi error: {e}")
            return None

    def _sync_search(
        self,
        query: str,
        year: str | None = None,
        title_query: bool = True,
    ) -> dict | None:
        """Sync search wrapper cho asyncio executor.

        Returns:
            First matching organic_result dict hoặc None.
        """
        from serpapi import GoogleScholarSearch  # Local import

        from integrity_checker.retrieval.normalization import title_similarity

        params: dict = {
            "engine": "google_scholar",
            "q": query,
            "api_key": self.api_key,
        }

        # Exact-phrase search: Google Scholar xếp hạng từ khóa rời (bag-of-words)
        # nên "Attention Is All You Need" trả về bài không liên quan trước.
        # as_epq ép khớp nguyên cụm, cho kết quả chính xác hơn nhiều.
        if title_query:
            params["as_epq"] = query

        # NOTE: Không dùng as_ylo/as_yhi khi đã có as_epq — Google Scholar (qua
        # SerpApi) bỏ qua exact-phrase và trả kết quả rác khi kết hợp hai tham
        # số này. Lọc theo năm ở client thay vào đó (xem _filter_by_year).
        year_int = int(year) if year and year.isdigit() else None

        try:
            search = GoogleScholarSearch(params)
            data = search.get_dict()

            # Check for API errors or quota exhaustion
            if "error" in data and not data.get("organic_results"):
                err_str = str(data.get("error") or "")
                err_lower = err_str.lower()
                if any(
                    kw in err_lower
                    for kw in ("run out of searches", "quota", "searches per month", "exceeded", "forbidden")
                ):
                    self.__class__._quota_exhausted = True
                    logger.warning(f"SerpApi quota circuit breaker tripped: {err_str}")
                elif "hasn't returned any results" not in err_lower and "no results" not in err_lower:
                    self._last_api_error = err_str
                return None

            if "search_metadata" in data:
                status = data["search_metadata"].get("status")
                if status != "Success":
                    error_msg = str(data.get("error", "Unknown SerpApi error"))
                    if any(
                        kw in error_msg.lower()
                        for kw in ("run out of searches", "quota", "searches per month", "exceeded", "forbidden")
                    ):
                        self.__class__._quota_exhausted = True
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

            # Query bằng author + year gần như luôn lệch: chọn kết quả khớp
            # title tốt nhất trong các ứng viên.
            best = None
            best_sim = 0.0
            for r in candidates:
                sim = title_similarity(query, r.get("title"))
                if sim > best_sim:
                    best, best_sim = r, sim
            return best

        except Exception as e:
            self._last_api_error = str(e)
            logger.error(f"SerpApi sync search failed: {e}")
            return None

    @staticmethod
    def _result_year(result: dict) -> int | None:
        """Extract năm xuất bản từ một organic result, None nếu không rõ."""
        candidates = [
            result.get("snippet", ""),
            (result.get("publication_info") or {}).get("summary", ""),
            result.get("title", ""),
        ]
        for text in candidates:
            if text:
                m = re.search(r"\b(19|20)\d{2}\b", text)
                if m:
                    return int(m.group(0))
        return None

    @classmethod
    def _filter_by_year(cls, results: list[dict], year: int) -> list[dict]:
        """Giữ kết quả trong khoảng [year-1, year+1] hoặc không rõ năm."""
        return [
            r for r in results
            if (y := cls._result_year(r)) is None or abs(y - year) <= 1
        ]

    @staticmethod
    def _result_to_candidate(result: dict) -> SourceCandidate:
        """Convert SerpApi organic_result → SourceCandidate.

        Extracts:
            - Title, snippet
            - Authors (from publication_info)
            - Citation count (from cited_by)
            - Year (from snippet if present)
            - Result ID (for cite link)
        """
        # Title
        title = result.get("title")

        # Result ID - unique identifier from SerpApi
        result_id = result.get("result_id")

        # Publication info
        pub_info = result.get("publication_info", {})
        summary = pub_info.get("summary", "")

        # Authors
        authors: list[str] = []
        for a in pub_info.get("authors", []) or []:
            name = a.get("name")
            if name:
                authors.append(name)

        # Alternative: extract from summary
        # Summary format: "Author1, Author2 - Year - Venue" hoặc "Author1 - Year"
        if not authors and summary:
            author_part = summary.split(" - ")[0] if " - " in summary else summary
            # Split by comma or "and"
            for part in author_part.replace(" and ", ", ").split(","):
                part = part.strip()
                if part and len(part) < 50:  # Filter out venue info
                    authors.append(part)

        # Year - try to extract from snippet, title, or summary
        # Priority: snippet > summary > title
        year: str | None = None
        text_sources = [
            result.get("snippet", ""),
            summary,
            result.get("title", ""),
        ]

        for text in text_sources:
            if text:
                year_match = re.search(r"\b(19|20)\d{2}\b", text)
                if year_match:
                    year = year_match.group(0)
                    break

        # Citation count
        cited_by = result.get("cited_by", {})
        citation_count = 0
        if isinstance(cited_by, dict):
            citation_count = cited_by.get("total", 0)
        elif isinstance(cited_by, int):
            citation_count = cited_by

        # Links
        links = result.get("links", []) or []
        link = links[0].get("link") if links else None

        # SerpApi cite link
        serpapi_cite_link = result.get("serpapi_cite_link", "")

        # Extract Google Scholar snippet as fallback abstract
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
                "serpapi_result_id": result_id or "",
                "serpapi_cite_link": serpapi_cite_link or "",
                "citation_count": str(citation_count) if citation_count else "",
            },
            # SerpApi không trả DOI/venue trực tiếp → confidence thấp
            confidence=0.5,
        )
