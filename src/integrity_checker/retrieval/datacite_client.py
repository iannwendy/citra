"""DataCite REST API client — DOI resolution & dataset/software/preprint/thesis search.

Covers non-Crossref DOIs registered via DataCite:
- Zenodo (10.5281/zenodo.*)
- Figshare (10.6084/m9.figshare.*)
- Dryad (10.5061/dryad.*)
- OSF / Open Science Framework (10.17605/OSF.IO/*)
- arXiv DataCite DOIs (10.48550/arXiv.*)
- Hugging Face DOIs (10.57967/hf/*)
- University Theses, Dissertations, Datasets & Software releases

Rate limit: 5 req/s (free public REST API, no API key required).
Docs: https://support.datacite.org/docs/api
"""

from __future__ import annotations

import html
import os
import re
from typing import Any
from urllib.parse import quote

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
    author_match_score,
    is_book_review_mismatch,
    normalize_doi,
    title_similarity,
    title_tokens,
)

logger = get_logger(__name__)

MIN_TITLE_SIMILARITY = 0.55

_DATACITE_PREFIXES = (
    "10.5281/",   # Zenodo
    "10.6084/",   # Figshare
    "10.5061/",   # Dryad
    "10.17605/",  # OSF
    "10.48550/",  # arXiv
    "10.57967/",  # Hugging Face
    "10.7910/",   # Harvard Dataverse
    "10.17632/",  # Mendeley Data
    "10.21227/",  # IEEE DataPort
    "10.24433/",  # Code Ocean
    "10.13140/",  # ResearchGate
)


class _RetryableHTTPError(Exception):
    """Raised when HTTP response has retryable status (429, 5xx)."""


class DataCiteClient(BaseScholarClient):
    """DataCite REST API client for datasets, preprints, software, and theses."""

    BASE_URL = "https://api.datacite.org"
    name = "datacite"

    def __init__(
        self,
        contact_email: str | None = None,
        timeout: float = 10.0,
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
        self.max_retries = max_retries or settings.retrieval.retry.max_attempts
        self._backoff = settings.retrieval.retry.backoff
        self._last_status_code: int | None = None
        self._headers = {
            "User-Agent": (
                f"EssayIntegrityChecker/1.0 (mailto:{self.contact_email})"
                if self.contact_email
                else "EssayIntegrityChecker/1.0"
            ),
            "Accept": "application/vnd.api+json, application/json",
        }

    @classmethod
    def is_datacite_doi(cls, doi: str | None) -> bool:
        """Return True if DOI matches known DataCite repository prefixes."""
        norm = normalize_doi(doi)
        if not norm:
            return False
        return norm.lower().startswith(_DATACITE_PREFIXES)

    async def lookup(self, citation: Citation) -> SourceCandidate:
        """Lookup by exact DOI first, then fallback to query search."""
        self._last_status_code = None

        if citation.doi:
            doi_norm = normalize_doi(citation.doi)
            if doi_norm:
                result = await self._lookup_by_doi(doi_norm, citation=citation)
                if result and result.found:
                    return result
                if self._last_status_code == 429:
                    return SourceCandidate(
                        source_name=self.name,
                        found=False,
                        error=f"DataCite: rate limited (429) for DOI '{doi_norm}'",
                    )

        return await self._lookup_by_search(citation)

    async def _lookup_by_doi(
        self,
        doi: str,
        citation: Citation | None = None,
    ) -> SourceCandidate | None:
        """GET /dois/{doi}."""
        path = f"/dois/{quote(doi, safe='/')}"
        payload = await self._fetch_json_with_retry(path)
        if not payload or not isinstance(payload.get("data"), dict):
            return None
        cand = self._item_to_candidate(payload["data"])
        if not cand.doi and not cand.title:
            return None

        # Guard against unrelated title when citation explicitly provides a substantive title
        if (
            citation
            and citation.title
            and len(title_tokens(citation.title)) >= 3
            and cand.title
            and cand.doi
            and cand.doi.lower() != doi.lower()
        ):
            if title_similarity(citation.title, cand.title) < 0.70:
                return None

        cand.found = True
        cand.confidence = 0.98
        return cand

    async def _lookup_by_search(self, citation: Citation) -> SourceCandidate:
        """GET /dois?query=...&page[size]=5."""
        query = (citation.title or "").strip()
        if not query and citation.raw_text:
            tokens = title_tokens(citation.raw_text)
            query = " ".join(tokens[:14])
        if not query or len(query) < 4:
            return SourceCandidate(
                source_name=self.name,
                found=False,
                error="DataCite: empty search query",
            )

        params: dict[str, Any] = {
            "query": query,
            "page[size]": 5,
        }
        payload = await self._fetch_json_with_retry("/dois", params=params)
        if not payload:
            if self._last_status_code == 429:
                return SourceCandidate(
                    source_name=self.name,
                    found=False,
                    error=f"DataCite: rate limited (429) for '{query[:60]}'",
                )
            return SourceCandidate(
                source_name=self.name,
                found=False,
                error=f"DataCite: no response for '{query[:60]}'",
            )

        items = payload.get("data")
        if not isinstance(items, list) or not items:
            return SourceCandidate(
                source_name=self.name,
                found=False,
                error=f"DataCite: no results for '{query[:60]}'",
            )

        best_cand, best_sim = self._pick_best_candidate(
            items,
            query_title=query,
            query_authors=citation.authors,
            query_year=citation.year,
        )
        if best_cand is None or best_sim < MIN_TITLE_SIMILARITY:
            return SourceCandidate(
                source_name=self.name,
                found=False,
                error=f"DataCite: no title match >= {MIN_TITLE_SIMILARITY} (best={best_sim:.2f}) for '{query[:60]}'",
            )

        best_cand.found = True
        best_cand.confidence = round(min(0.95, max(0.60, best_sim)), 4)
        return best_cand

    def _pick_best_candidate(
        self,
        items: list[dict[str, Any]],
        query_title: str,
        query_authors: list[str] | None = None,
        query_year: str | None = None,
    ) -> tuple[SourceCandidate | None, float]:
        best_cand: SourceCandidate | None = None
        best_sim = -1.0
        best_rank = -1.0
        cit_year = str(query_year)[:4] if query_year else None

        for raw_item in items:
            if not isinstance(raw_item, dict):
                continue
            cand = self._item_to_candidate(raw_item)
            if not cand.title:
                continue
            if is_book_review_mismatch(query_title, query_authors, cand.title, cand.authors):
                continue
            sim = title_similarity(query_title, cand.title)
            auth_sim = (
                author_match_score(query_authors, cand.authors)
                if query_authors and cand.authors
                else 0.0
            )
            yr_bonus = (
                0.05
                if (cit_year and cand.year and str(cand.year)[:4] == cit_year)
                else 0.0
            )
            rank_score = sim * 0.80 + auth_sim * 0.15 + yr_bonus
            if rank_score > best_rank:
                best_rank = rank_score
                best_sim = sim
                best_cand = cand

        return best_cand, max(0.0, best_sim)

    @classmethod
    def _clean_text(cls, text: str | None) -> str | None:
        if not text:
            return None
        cleaned = html.unescape(str(text))
        cleaned = re.sub(r"<[^>]+>", " ", cleaned)
        cleaned = re.sub(r"\s+", " ", cleaned).strip()
        return cleaned or None

    def _item_to_candidate(self, item: dict[str, Any]) -> SourceCandidate:
        attrs = item.get("attributes") or {}
        raw_doi = attrs.get("doi") or item.get("id")
        doi = normalize_doi(str(raw_doi)) if raw_doi else None

        # Title
        title: str | None = None
        titles = attrs.get("titles") or []
        if isinstance(titles, list) and titles:
            first_title = titles[0]
            if isinstance(first_title, dict):
                title = self._clean_text(first_title.get("title"))

        # Creators / Authors
        authors: list[str] = []
        creators = attrs.get("creators") or []
        if isinstance(creators, list):
            for creator in creators:
                if not isinstance(creator, dict):
                    continue
                given = (creator.get("givenName") or "").strip()
                family = (creator.get("familyName") or "").strip()
                if given and family:
                    authors.append(f"{given} {family}")
                elif creator.get("name"):
                    name_str = str(creator["name"]).strip()
                    if "," in name_str:
                        parts = [p.strip() for p in name_str.split(",", 1)]
                        if len(parts) == 2 and parts[0] and parts[1]:
                            name_str = f"{parts[1]} {parts[0]}"
                    if name_str:
                        authors.append(name_str)

        # Year
        pub_year = attrs.get("publicationYear")
        year = str(pub_year)[:4] if pub_year else None

        # Venue / Publisher
        container = attrs.get("container") or {}
        venue = (
            (container.get("title") if isinstance(container, dict) else None)
            or attrs.get("publisher")
        )
        if isinstance(venue, dict):
            venue = venue.get("name")
        venue_str = self._clean_text(str(venue)) if venue else None

        # Abstract / Descriptions
        abstract_parts: list[str] = []
        descriptions = attrs.get("descriptions") or []
        if isinstance(descriptions, list):
            for desc in descriptions:
                if not isinstance(desc, dict):
                    continue
                desc_text = self._clean_text(desc.get("description"))
                desc_type = str(desc.get("descriptionType") or "").lower()
                if desc_text and len(desc_text) >= 25:
                    if desc_type in ("abstract", "summary", "other", ""):
                        abstract_parts.append(desc_text)
        abstract = " ".join(abstract_parts).strip() if abstract_parts else None

        url = attrs.get("url") or (f"https://doi.org/{doi}" if doi else None)
        types_info = attrs.get("types") or {}
        resource_type = (
            types_info.get("resourceTypeGeneral")
            if isinstance(types_info, dict)
            else None
        )
        ext_ids: dict[str, str] = {}
        if doi:
            ext_ids["doi"] = doi
            ext_ids["doi_ra"] = "DataCite"
        if resource_type:
            ext_ids["resource_type"] = str(resource_type)

        return SourceCandidate(
            source_name=self.name,
            found=False,
            doi=doi,
            title=title,
            authors=authors,
            year=year,
            venue=venue_str,
            url=url,
            abstract=abstract,
            external_ids=ext_ids,
        )

    async def _fetch_json_with_retry(
        self,
        path: str,
        params: dict[str, Any] | None = None,
    ) -> dict[str, Any] | None:
        import asyncio
        import random

        from integrity_checker.retrieval.http_pool import get_shared_http_client

        url = f"{self.BASE_URL}{path}"
        seen_429 = 0
        retryer = AsyncRetrying(
            stop=stop_after_attempt(min(self.max_retries, 3)),
            wait=wait_exponential(
                multiplier=self._backoff.initial_seconds,
                max=min(self._backoff.max_seconds, 10.0),
                exp_base=self._backoff.multiplier,
            ),
            retry=retry_if_exception_type(
                (httpx.TimeoutException, httpx.NetworkError, _RetryableHTTPError)
            ),
            reraise=True,
        )
        try:
            async for attempt in retryer:
                with attempt:
                    client = get_shared_http_client(follow_redirects=True)
                    resp = await client.get(
                        url,
                        params=params,
                        headers=self._headers,
                        timeout=self.timeout,
                    )
                    retry_after = self._record_http_response(resp)
                    if resp.status_code == 404:
                        return None
                    if resp.status_code == 429:
                        seen_429 += 1
                        if seen_429 >= 2 or (retry_after is not None and retry_after > 3.0):
                            return None
                        await asyncio.sleep(
                            (retry_after or random.uniform(0.6, 1.2))
                            + random.uniform(0.05, 0.25)
                        )
                        raise _RetryableHTTPError("HTTP 429")
                    if resp.status_code >= 500:
                        raise _RetryableHTTPError(f"HTTP {resp.status_code}")
                    if resp.status_code >= 400:
                        return None
                    return resp.json()
        except (RetryError, Exception) as exc:  # noqa: BLE001
            self._record_transport_error(exc)
            logger.debug(f"DataCite request failed for {url}: {exc}")
            return None
        return None
