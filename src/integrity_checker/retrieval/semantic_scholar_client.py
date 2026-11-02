"""Semantic Scholar API client — supplement với citation graph.

Rate limit: 1 req/s (anonymized), 100 req/s với API key.
Docs: https://api.semanticscholar.org/api-docs/
"""

from __future__ import annotations

import os
import re
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
from integrity_checker.retrieval.normalization import title_similarity

logger = get_logger(__name__)

MIN_TITLE_SIMILARITY = 0.50
_ARXIV_ID_RE = re.compile(r"\b(\d{4}\.\d{4,5})(?:v\d+)?\b")


class SemanticScholarClient(BaseScholarClient):
    """Semantic Scholar Graph API client.

    Implements:
        - DOI lookup (GET /paper/DOI:{doi}).
        - arXiv lookup (GET /paper/ARXIV:{id}).
        - Title search (GET /paper/search?query=...).
        - Tenacity retry + exponential backoff.
        - Optional API key qua S2_API_KEY env (tăng rate limit).
    """

    BASE_URL = "https://api.semanticscholar.org/graph/v1"
    name = "semantic_scholar"

    # Fields trả về từ /paper/search và /paper/{id}
    PAPER_FIELDS = "title,authors,year,externalIds,venue,url,abstract"

    def __init__(
        self,
        api_key: str | None = None,
        timeout: float = 30.0,  # FIX: Increased from 10.0 to 30.0 for better resilience
        max_retries: int | None = None,
    ) -> None:
        super().__init__(timeout=timeout)
        settings = get_settings()
        self.api_key = api_key or os.getenv("S2_API_KEY", "") or settings.s2_api_key
        self.max_retries = max_retries or settings.retrieval.retry.max_attempts
        self._backoff = settings.retrieval.retry.backoff
        self._headers = {"x-api-key": self.api_key} if self.api_key else {}
        self._last_status_code: int | None = None
        self._rate_limited_until: float = 0.0

    async def lookup(self, citation: Citation) -> SourceCandidate:
        """Lookup bằng DOI / arXiv ID exact; fallback bằng search."""
        self._last_status_code = None

        # 1. DOI exact (skip DataCite arXiv DOIs 10.48550/arXiv.* as S2 only resolves them via ARXIV:{id})
        if citation.doi:
            doi_norm = self._normalize_doi(citation.doi)
            if not doi_norm.startswith("10.48550/arxiv."):
                result = await self._lookup_by_id(f"DOI:{doi_norm}")
                if result and result.found:
                    return result
                if self._last_status_code == 429:
                    return SourceCandidate(
                        source_name=self.name,
                        found=False,
                        error=f"S2: rate limited (429) for DOI:{doi_norm}",
                    )

        # 2. arXiv ID exact (từ URL, arXiv DOI 10.48550/arXiv.*, hoặc raw_text)
        arxiv_id = self._extract_arxiv_id(citation)
        if arxiv_id:
            result = await self._lookup_by_id(f"ARXIV:{arxiv_id}")
            if result and result.found:
                if not result.doi and citation.doi and self._normalize_doi(citation.doi).startswith("10.48550/arxiv."):
                    result.doi = self._normalize_doi(citation.doi)
                return result
            if self._last_status_code == 429:
                return SourceCandidate(
                    source_name=self.name,
                    found=False,
                    error=f"S2: rate limited (429) for ARXIV:{arxiv_id}",
                )

        # 3. Title search fallback
        return await self._lookup_by_search(citation)

    async def _lookup_by_id(self, paper_id: str) -> SourceCandidate | None:
        """GET /paper/{id}?fields=..."""
        path = f"/paper/{paper_id}"
        params = {"fields": self.PAPER_FIELDS}
        data = await self._fetch_json_with_retry(path, params=params)
        if not data or not data.get("paperId"):
            return None

        cand = self._paper_to_candidate(data)
        cand.found = True
        cand.confidence = 1.0  # ID exact = highest confidence
        return cand

    async def _lookup_by_search(self, citation: Citation) -> SourceCandidate:
        """GET /paper/search?query={title}&limit=5."""
        if not citation.title:
            return SourceCandidate(
                source_name=self.name,
                found=False,
                error="S2: no title for search",
            )

        params = {
            "query": citation.title[:200],
            "limit": 5,
            "fields": self.PAPER_FIELDS,
        }
        # Optional year filter
        if citation.year:
            params["year"] = f"{citation.year}-{citation.year}"

        data = await self._fetch_json_with_retry("/paper/search", params=params)
        if not data:
            if self._last_status_code == 429:
                return SourceCandidate(
                    source_name=self.name,
                    found=False,
                    error=f"S2: rate limited (429) for '{citation.title[:60]}'",
                )
            return SourceCandidate(
                source_name=self.name,
                found=False,
                error=f"S2: no response for '{citation.title[:60]}'",
            )

        results = data.get("data") or []
        if not results:
            return SourceCandidate(
                source_name=self.name,
                found=False,
                error=f"S2: no results for '{citation.title[:60]}'",
            )

        best_cand: SourceCandidate | None = None
        best_sim = -1.0
        for item in results:
            cand = self._paper_to_candidate(item)
            sim = title_similarity(citation.title, cand.title) if cand.title else 0.0
            if sim > best_sim:
                best_sim = sim
                best_cand = cand

        if best_cand is None or (citation.title and best_sim < MIN_TITLE_SIMILARITY):
            return SourceCandidate(
                source_name=self.name,
                found=False,
                error=f"S2: no title match ({best_sim:.2f}) for '{citation.title[:60]}'",
            )

        best_cand.found = True
        best_cand.confidence = 0.7 if best_sim >= 0.85 else round(0.7 * best_sim, 4)
        return best_cand

    async def _fetch_json_with_retry(
        self, path: str, params: dict[str, Any] | None = None
    ) -> dict | None:
        """GET với tenacity retry + exponential backoff.

        Backoff config từ settings: initial=5s, max=60s, multiplier=2.0
        """
        url = f"{self.BASE_URL}{path}"
        if not self.api_key and time.monotonic() < self._rate_limited_until:
            self._last_status_code = 429
            return None

        # FIX: Use correct httpx timeout exception types
        retry = AsyncRetrying(
            stop=stop_after_attempt(self.max_retries),
            wait=wait_exponential(
                multiplier=self._backoff.multiplier,
                min=self._backoff.initial_seconds,
                max=self._backoff.max_seconds,
            ),
            retry=retry_if_exception_type((
                httpx.HTTPError,
                httpx.ConnectTimeout,
                httpx.ReadTimeout,
                httpx.WriteTimeout,
                httpx.PoolTimeout,
            )),
            reraise=False,
        )
        try:
            async for attempt in retry:
                with attempt:
                    async with httpx.AsyncClient(timeout=self.timeout) as client:
                        resp = await client.get(
                            url, headers=self._headers, params=params or {}
                        )
                        self._last_status_code = resp.status_code
                        if resp.status_code == 404:
                            return None
                        if resp.status_code == 429:
                            if not self.api_key:
                                # Without an API key, S2 public pool 429s persist for minutes;
                                # fast-fail and cooldown for 30s to avoid stalling the pipeline.
                                self._rate_limited_until = time.monotonic() + 30.0
                                logger.warning(f"S2 anonymous 429 rate limit on {path}; cooling down 30s")
                                return None
                            resp.raise_for_status()
                        if resp.status_code >= 500:
                            resp.raise_for_status()
                        if resp.status_code != 200:
                            logger.warning(
                                f"S2 {resp.status_code}: {url}"
                            )
                            return None
                        return resp.json()
            return None
        except RetryError:
            logger.error(f"S2 retry exhausted: {url}")
            return None
        except httpx.HTTPError as e:
            logger.error(f"S2 HTTP error: {e}")
            return None

    @staticmethod
    def _normalize_doi(doi: str) -> str:
        """Normalize DOI: lowercase, strip 'doi:' prefix, strip trailing period."""
        d = doi.strip().lower()
        if d.startswith("doi:"):
            d = d[4:].strip()
        if d.startswith("https://doi.org/"):
            d = d[16:].strip()
        return d.rstrip(".")

    @staticmethod
    def _extract_arxiv_id(citation: Citation) -> str | None:
        """Extract arXiv ID từ URL, DOI (10.48550/arXiv.*), hoặc raw_text."""
        # 1. Check URL field
        if citation.url and "arxiv.org" in citation.url.lower():
            # Format: https://arxiv.org/abs/2106.12345 hoặc /pdf/2106.12345
            for marker in ("/abs/", "/pdf/"):
                idx = citation.url.find(marker)
                if idx >= 0:
                    arxiv_id = citation.url[idx + len(marker):]
                    # Strip version suffix (v1, v2) and .pdf extension
                    arxiv_id = arxiv_id.split("v")[0] if "v" in arxiv_id else arxiv_id
                    arxiv_id = arxiv_id.replace(".pdf", "")
                    return arxiv_id.rstrip("/")
            m = _ARXIV_ID_RE.search(citation.url)
            if m:
                return m.group(1)

        # 2. Check DOI field (e.g. 10.48550/arXiv.1706.03762)
        if citation.doi and "arxiv" in citation.doi.lower():
            m = _ARXIV_ID_RE.search(citation.doi)
            if m:
                return m.group(1)

        # 3. Check raw_text if it mentions arXiv
        if citation.raw_text and "arxiv" in citation.raw_text.lower():
            m = _ARXIV_ID_RE.search(citation.raw_text)
            if m:
                return m.group(1)

        return None

    @staticmethod
    def _paper_to_candidate(paper: dict) -> SourceCandidate:
        """Convert S2 paper → SourceCandidate."""
        # External IDs
        ext_ids = paper.get("externalIds") or {}
        doi = ext_ids.get("DOI")
        arxiv_id = ext_ids.get("ArXiv")

        # Title
        title = paper.get("title")

        # Authors
        authors: list[str] = []
        for a in paper.get("authors") or []:
            name = a.get("name")
            if name:
                authors.append(name)

        # Year
        year = paper.get("year")
        year_str = str(year) if year else None

        # Venue
        venue = paper.get("venue")

        # URL
        url = paper.get("url")

        # Abstract
        raw_abs = paper.get("abstract")
        abstract = str(raw_abs).strip() if raw_abs and str(raw_abs).strip() else None

        filtered_ext_ids = {
            k: str(v)
            for k, v in ext_ids.items()
            if k in ("DOI", "ArXiv", "MAG", "PMID", "PMCID") and v is not None
        }
        if arxiv_id and "arxiv" not in filtered_ext_ids:
            filtered_ext_ids["arxiv"] = str(arxiv_id)

        return SourceCandidate(
            source_name="semantic_scholar",
            doi=doi.lower() if doi else None,
            title=title,
            authors=authors,
            year=year_str,
            venue=venue,
            url=url,
            abstract=abstract,
            external_ids=filtered_ext_ids,
        )
