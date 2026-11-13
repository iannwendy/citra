"""OpenAlex API client — wide coverage, title/author/year search.

Rate limit: 10 req/s (polite pool nếu có email).
Docs: https://docs.openalex.org/
"""

from __future__ import annotations

import asyncio
import os
import random
import re
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
from integrity_checker.retrieval.normalization import (
    author_match_score,
    is_book_review_mismatch,
    normalize_doi,
    title_similarity,
    title_tokens,
)

logger = get_logger(__name__)

MIN_TITLE_SIMILARITY = 0.55


class OpenAlexClient(BaseScholarClient):
    """OpenAlex REST API client.

    Implements:
        - DOI exact lookup (GET /works/doi:{doi}).
        - Title/author/year search (GET /works?search=...).
        - Tenacity retry + exponential backoff.
        - Polite pool headers với CONTACT_EMAIL.
    """

    BASE_URL = "https://api.openalex.org"
    name = "openalex"

    def __init__(
        self,
        contact_email: str | None = None,
        timeout: float = 10.0,
        max_retries: int | None = None,
        api_key: str | None = None,
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

        # Get API key from env or settings
        self.api_key = api_key or os.environ.get("OPENALEX_API_KEY", "")

        self._headers = {
            "User-Agent": (
                f"EssayIntegrityChecker/0.1 (mailto:{self.contact_email})"
                if self.contact_email
                else "EssayIntegrityChecker/0.1"
            ),
        }

        # Add Authorization header if API key is available
        if self.api_key:
            self._headers["Authorization"] = f"Bearer {self.api_key}"

    async def lookup(self, citation: Citation) -> SourceCandidate:
        """Lookup bằng DOI exact; fallback bằng search.

        OpenAlex DOI URL convention: https://api.openalex.org/works/doi:{doi}
        Falls back to /works?search={title} nếu không có DOI.
        """
        self._last_status_code = None

        # 1. DOI exact lookup
        if citation.doi:
            doi_norm = self._normalize_doi(citation.doi)
            result = await self._lookup_by_doi(doi_norm, citation=citation)
            if result and result.found:
                return result
            if self._last_status_code == 429:
                return SourceCandidate(
                    source_name=self.name,
                    found=False,
                    error=f"OpenAlex: rate limited (429) for DOI '{doi_norm}'",
                )

        # 2. Title-based search
        return await self._lookup_by_search(citation)

    async def _lookup_by_doi(
        self,
        doi: str,
        citation: Citation | None = None,
    ) -> SourceCandidate | None:
        """GET /works/doi:{doi}."""
        path = f"/works/doi:{doi}"
        data = await self._fetch_json_with_retry(path)
        if not data:
            return None
        cand = self._work_to_candidate(data)
        if not cand.doi and not cand.title:
            return None
        # Guard against OpenAlex resolving an arXiv/external DOI to an unrelated work DOI
        if cand.doi and cand.doi.lower() != doi.lower():
            if citation and citation.title and cand.title:
                if title_similarity(citation.title, cand.title) < 0.75:
                    return None
            else:
                return None
        cand.found = True
        cand.confidence = 1.0
        return cand

    async def lookup_dois_batch(self, dois: list[str]) -> dict[str, SourceCandidate]:
        """Batch-resolve DOIs via ``GET /works?filter=doi:https://doi.org/{d1}|...&per_page=50``.

        Chunks up to 40 DOIs per HTTP GET to stay safely under query-string URL limits,
        mapping normalized DOIs back to ``SourceCandidate`` records with reconstructed abstracts.
        """
        self._reset_http_telemetry()
        self._last_status_code = None

        norm_dois: list[str] = []
        seen: set[str] = set()
        for raw in dois or []:
            cleaned = re.sub(r"^\s*doi\s*:\s*", "", str(raw or ""), flags=re.IGNORECASE)
            nd = normalize_doi(cleaned)
            if nd and nd not in seen:
                seen.add(nd)
                norm_dois.append(nd)

        if not norm_dois:
            return {}

        out: dict[str, SourceCandidate] = {}
        chunk_size = 40
        for idx in range(0, len(norm_dois), chunk_size):
            chunk = norm_dois[idx : idx + chunk_size]
            doi_filter = "|".join(f"https://doi.org/{d}" for d in chunk)
            data = await self._fetch_json_with_retry(
                "/works",
                params={"filter": f"doi:{doi_filter}", "per_page": 50},
            )
            if not data:
                if (
                    self._last_status_code == 429
                    or (self._last_status_code is not None and self._last_status_code >= 500)
                    or self._last_transport_error
                ):
                    break
                continue

            for work in data.get("results") or []:
                cand = self._work_to_candidate(work)
                raw_cand_doi = cand.doi or ((work.get("ids") or {}).get("doi") if isinstance(work, dict) else None)
                cleaned_cand_doi = re.sub(
                    r"^\s*doi\s*:\s*",
                    "",
                    str(raw_cand_doi or ""),
                    flags=re.IGNORECASE,
                )
                norm_cand_doi = normalize_doi(cleaned_cand_doi)
                if not norm_cand_doi or (not cand.title and not cand.doi):
                    continue
                cand.doi = norm_cand_doi
                cand.found = True
                cand.confidence = 1.0
                cand.score = float(work.get("relevance_score", 0) or 1.0)
                out[norm_cand_doi] = cand

        return out

    def _pick_best_search_result(
        self,
        results: list[dict],
        query_title: str,
        query_authors: list | None = None,
        query_year: str | None = None,
    ) -> tuple[SourceCandidate | None, dict | None, float]:
        """Select the result from OpenAlex /works list with the best title + author + year match."""
        best_cand: SourceCandidate | None = None
        best_raw: dict | None = None
        best_sim = -1.0
        best_rank = -1.0
        cit_year = str(query_year)[:4] if query_year else None
        for item in results:
            cand = self._work_to_candidate(item)
            if is_book_review_mismatch(query_title, query_authors, cand.title, cand.authors):
                continue
            sim = title_similarity(query_title, cand.title) if cand.title else 0.0
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
            rank = sim + (0.15 * auth_sim if sim >= MIN_TITLE_SIMILARITY else 0.0) + yr_bonus
            if rank > best_rank:
                best_rank = rank
                best_sim = sim
                best_cand = cand
                best_raw = item
        if best_cand is not None and not best_cand.abstract and best_sim >= 0.85:
            for item in results:
                alt = self._work_to_candidate(item)
                if alt.abstract and alt.title and title_similarity(query_title, alt.title) >= 0.90:
                    best_cand.abstract = alt.abstract
                    break
        return best_cand, best_raw, best_sim

    async def _lookup_by_search(self, citation: Citation) -> SourceCandidate:
        """GET /works?search={title}&per_page=5."""
        if not citation.title:
            return SourceCandidate(
                source_name=self.name,
                found=False,
                error="OpenAlex: no title for search",
            )

        # Truncate title để URL không quá dài
        title = citation.title[:200]
        params: dict[str, Any] = {"search": title, "per_page": 5}

        # Thêm filter nếu có year
        filters: list[str] = []
        if citation.year:
            filters.append(f"publication_year:{citation.year}")
        if filters:
            params["filter"] = ",".join(filters)

        data = await self._fetch_json_with_retry("/works", params=params)
        if not data:
            if self._last_status_code == 429:
                return SourceCandidate(
                    source_name=self.name,
                    found=False,
                    error=f"OpenAlex: rate limited (429) for '{title[:60]}'",
                )
            return SourceCandidate(
                source_name=self.name,
                found=False,
                error=f"OpenAlex: no response for '{title[:60]}'",
            )

        results = data.get("results") or []
        best_cand, best_raw, best_sim = self._pick_best_search_result(
            results, citation.title, citation.authors, citation.year
        )

        # Fallback without year filter if strict publication_year filter missed or returned wrong/derivative paper
        best_auth_sim = (
            author_match_score(citation.authors, best_cand.authors)
            if (citation.authors and best_cand and best_cand.authors)
            else 1.0
        )
        if (
            "filter" in params
            and self._last_status_code not in (429, 500, 502, 503, 504)
            and (
                best_cand is None
                or best_sim < 0.90
                or (citation.authors and best_auth_sim == 0.0)
            )
        ):
            unfiltered_data = await self._fetch_json_with_retry(
                "/works",
                params={"search": title, "per_page": 5},
            )
            if unfiltered_data:
                unfiltered_results = unfiltered_data.get("results") or []
                alt_cand, alt_raw, alt_sim = self._pick_best_search_result(
                    unfiltered_results, citation.title, citation.authors, citation.year
                )
                alt_auth_sim = (
                    author_match_score(citation.authors, alt_cand.authors)
                    if (citation.authors and alt_cand and alt_cand.authors)
                    else 0.0
                )
                if alt_cand is not None and (
                    alt_sim > best_sim
                    or (alt_sim >= MIN_TITLE_SIMILARITY and alt_auth_sim > best_auth_sim)
                ):
                    results = unfiltered_results
                    best_cand, best_raw, best_sim = alt_cand, alt_raw, alt_sim

        if not results or best_cand is None or best_raw is None:
            if self._last_status_code == 429:
                return SourceCandidate(
                    source_name=self.name,
                    found=False,
                    error=f"OpenAlex: rate limited (429) for '{title[:60]}'",
                )
            return SourceCandidate(
                source_name=self.name,
                found=False,
                error=f"OpenAlex: no results for '{title[:60]}'",
            )

        if best_sim < MIN_TITLE_SIMILARITY:
            return SourceCandidate(
                source_name=self.name,
                found=False,
                error=f"OpenAlex: no title match ({best_sim:.2f}) for '{title[:60]}'",
            )
        if (
            citation.title
            and citation.authors
            and len(title_tokens(citation.title)) <= 3
            and author_match_score(citation.authors, best_cand.authors) == 0.0
        ):
            return SourceCandidate(
                source_name=self.name,
                found=False,
                error=f"OpenAlex: short title '{citation.title}' matched different author",
            )

        best_cand.found = True
        # Confidence: relevance_score 0–∞, normalize về 0–1 (kèm kiểm tra title_similarity)
        relevance = float(best_raw.get("relevance_score", 0) or 0)
        best_cand.score = relevance
        base_conf = min(relevance, 1.0) if relevance > 0 else 0.75
        if best_sim < 0.85:
            best_cand.confidence = round(base_conf * best_sim, 4)
        else:
            best_cand.confidence = base_conf
        return best_cand

    async def _fetch_json_with_retry(
        self, path: str, params: dict[str, Any] | None = None
    ) -> dict | None:
        """GET với shared Keep-Alive HTTP pool, Retry-After, và bounded retry."""
        url = f"{self.BASE_URL}{path}"
        seen_429 = 0
        retry = AsyncRetrying(
            stop=stop_after_attempt(min(self.max_retries, 3)),
            wait=wait_exponential(
                multiplier=self._backoff.multiplier,
                min=self._backoff.initial_seconds,
                max=min(self._backoff.max_seconds, 12.0),
            ),
            retry=retry_if_exception_type(
                (httpx.HTTPError, httpx.TimeoutException)
            ),
            reraise=False,
        )
        try:
            async for attempt in retry:
                with attempt:
                    client = get_shared_http_client(follow_redirects=True)
                    resp = await client.get(
                        url,
                        headers=self._headers,
                        params=params or {},
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
                        if getattr(resp, "_request", None) is None:
                            resp._request = httpx.Request("GET", url)
                        resp.raise_for_status()
                    if resp.status_code >= 500:
                        if getattr(resp, "_request", None) is None:
                            resp._request = httpx.Request("GET", url)
                        resp.raise_for_status()
                    if resp.status_code != 200:
                        logger.warning(f"OpenAlex {resp.status_code}: {url}")
                        return None
                    return resp.json()
            return None
        except RetryError as exc:
            self._record_transport_error(exc)
            logger.error(f"OpenAlex retry exhausted: {url}")
            return None
        except httpx.HTTPError as e:
            self._record_transport_error(e)
            logger.error(f"OpenAlex HTTP error: {e}")
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
    def _is_boilerplate_citation_abstract(text: str | None) -> bool:
        """Detect publisher landing-page meta descriptions that are only bibliographic
        strings (e.g., 'Author1, Author2. Proceedings of the ... 2019.') rather than an abstract.
        """
        if not text:
            return True
        s = text.strip()
        if len(s) < 340 and re.search(
            r"\.\s*(?:In\s+)?(?:Proceedings\s+of\s+the|Findings\s+of\s+the\s+Association|Transactions\s+of\s+the\s+Association)\b.*?\b(?:19|20)\d{2}\.?\s*$",
            s,
            re.IGNORECASE,
        ):
            return True
        return False

    @staticmethod
    def _reconstruct_abstract(inverted_index: dict | None) -> str | None:
        """Reconstruct plain-text abstract from OpenAlex abstract_inverted_index."""
        if not inverted_index or not isinstance(inverted_index, dict):
            return None
        positions: list[tuple[int, str]] = []
        for token, pos_list in inverted_index.items():
            if not isinstance(pos_list, list):
                continue
            for pos in pos_list:
                if isinstance(pos, int):
                    positions.append((pos, str(token)))
        if not positions:
            return None
        positions.sort(key=lambda item: item[0])
        text = " ".join(tok for _, tok in positions).strip()
        return text if text else None

    @staticmethod
    def _work_to_candidate(work: dict) -> SourceCandidate:
        """Convert OpenAlex /works response → SourceCandidate."""
        # DOI — strip https://doi.org/ prefix
        doi_raw = work.get("doi") or ""
        doi = doi_raw.replace("https://doi.org/", "").lower() if doi_raw else None

        # Title (OpenAlex dùng 'display_name' hoặc 'title')
        title = work.get("title") or work.get("display_name")
        is_retracted_title = False
        if isinstance(title, str) and re.match(
            r"^\s*(?:\[?RETRACTED(?:\s+ARTICLE)?\]?|WITHDRAWN)\s*[:\-–—]\s*",
            title,
            re.IGNORECASE,
        ):
            is_retracted_title = True
            title = re.sub(
                r"^\s*(?:\[?RETRACTED(?:\s+ARTICLE)?\]?|WITHDRAWN)\s*[:\-–—]\s*",
                "",
                title,
                flags=re.IGNORECASE,
            ).strip()

        # Authors — từ 'authorships'
        authors: list[str] = []
        for auth in work.get("authorships") or []:
            author = auth.get("author") or {}
            name = author.get("display_name")
            if name:
                authors.append(name)

        # Year — từ 'publication_year' (chuẩn hóa năm số hóa muộn của AAAI OJS 10.1609/)
        year = work.get("publication_year")
        year_str = str(year) if year else None
        if doi and year_str:
            from integrity_checker.retrieval.crossref_client import CrossrefClient

            year_str = CrossrefClient.normalize_aaai_ojs_year(doi, year_str)

        # Venue — từ 'primary_location.source.display_name'
        venue: str | None = None
        loc = work.get("primary_location") or {}
        src = loc.get("source") or {}
        if src:
            venue = src.get("display_name")

        # URL
        url = work.get("id")  # OpenAlex ID URL

        # Abstract — plain text or reconstructed from OpenAlex inverted index
        raw_abs = work.get("abstract")
        if isinstance(raw_abs, str) and raw_abs.strip():
            abstract: str | None = raw_abs.strip()
        else:
            abstract = OpenAlexClient._reconstruct_abstract(
                work.get("abstract_inverted_index")
            )
        if OpenAlexClient._is_boilerplate_citation_abstract(abstract):
            abstract = None

        ext_ids: dict[str, str] = {"doi": doi} if doi else {}
        if bool(work.get("is_retracted", False)) or is_retracted_title:
            ext_ids["is_retracted"] = "true"

        return SourceCandidate(
            source_name="openalex",
            doi=doi,
            title=title,
            authors=authors,
            year=year_str,
            venue=venue,
            url=url,
            abstract=abstract,
            external_ids=ext_ids,
        )
