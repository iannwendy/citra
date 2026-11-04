"""Crossref API client — DOI exact + bibliographic search.

Rate limit: 50 req/s (polite pool nếu có email).
Docs: https://api.crossref.org/swagger-ui/index.html
"""

from __future__ import annotations

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
    title_similarity,
    title_tokens,
)

logger = get_logger(__name__)

MIN_TITLE_SIMILARITY = 0.50


class CrossrefClient(BaseScholarClient):
    """Crossref REST API client.

    Implements:
        - DOI exact lookup (GET /works/{doi}).
        - Bibliographic search fallback (GET /works?query.bibliographic=...).
        - Tenacity retry với exponential backoff (429, 5xx, network errors).
        - API key support via CROSSREF_API_KEY env variable.
        - Rate limit: 50 req/s (polite pool nếu có email + API key).
        - User-Agent header format: "MyResearchProject/1.0 (mailto:email@example.com)"
    """

    BASE_URL = "https://api.crossref.org"
    name = "crossref"

    def __init__(
        self,
        contact_email: str | None = None,
        timeout: float = 30.0,
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

        # Get API key from env
        self.api_key = api_key or os.environ.get("CROSSREF_API_KEY", "")

        # Build User-Agent header (required by Crossref for polite pool)
        self._headers = {
            "User-Agent": f"MyResearchProject/1.0 (mailto:{self.contact_email})",
        }

        # Add Authorization header if API key is available
        if self.api_key:
            self._headers["Authorization"] = f"Bearer {self.api_key}"

    async def lookup(self, citation: Citation) -> SourceCandidate:
        """Lookup bằng DOI exact; fallback bằng bibliographic query.

        Args:
            citation: Citation để tra cứu.

        Returns:
            SourceCandidate với found=True nếu tìm thấy, found=False + error nếu không.
        """
        self._last_status_code = None

        # 1. DOI exact lookup (priority)
        if citation.doi:
            doi_norm = self._normalize_doi(citation.doi)
            result = await self._lookup_by_doi(doi_norm)
            if result and result.found:
                return result
            if self._last_status_code == 429:
                return SourceCandidate(
                    source_name=self.name,
                    found=False,
                    error=f"Crossref: rate limited (429) for DOI '{doi_norm}'",
                )

        # 2. Bibliographic query fallback
        return await self._lookup_by_bibliographic(citation)

    async def _lookup_by_doi(self, doi: str) -> SourceCandidate | None:
        """GET /works/{doi}."""
        if not doi:
            return None
        path = f"/works/{quote(doi, safe='/')}"
        data = await self._fetch_json_with_retry(path)
        if not data:
            return None
        message = data.get("message")
        if not message:
            return None
        cand = self._message_to_candidate(message)
        cand.found = True
        cand.confidence = 1.0  # DOI exact = highest confidence
        return cand

    async def _lookup_by_bibliographic(self, citation: Citation) -> SourceCandidate:
        """GET /works?query.bibliographic=...&rows=3."""
        query = self._build_bibliographic_query(citation)
        if not query:
            return SourceCandidate(
                source_name=self.name,
                found=False,
                error="Crossref: empty bibliographic query (no title/author/year)",
            )

        params = {"query.bibliographic": query, "rows": 5}
        data = await self._fetch_json_with_retry("/works", params=params)
        if not data:
            if self._last_status_code == 429:
                return SourceCandidate(
                    source_name=self.name,
                    found=False,
                    error=f"Crossref: rate limited (429) for query '{query[:60]}'",
                )
            return SourceCandidate(
                source_name=self.name,
                found=False,
                error=f"Crossref: no response for query '{query[:60]}'",
            )

        items = data.get("message", {}).get("items", [])
        if not items:
            return SourceCandidate(
                source_name=self.name,
                found=False,
                error=f"Crossref: no results for '{query[:60]}'",
            )

        best_cand: SourceCandidate | None = None
        best_item: dict | None = None
        best_sim = -1.0
        best_rank = -1.0
        cit_year = str(citation.year)[:4] if citation.year else None
        for item in items:
            cand = self._message_to_candidate(item)
            if is_book_review_mismatch(citation.title, citation.authors, cand.title, cand.authors):
                continue
            if citation.title and cand.title:
                sim = title_similarity(citation.title, cand.title)
            else:
                sim = 1.0
            auth_sim = (
                author_match_score(citation.authors, cand.authors)
                if citation.authors and cand.authors
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
                best_item = item

        if best_cand is None or best_item is None:
            return SourceCandidate(
                source_name=self.name,
                found=False,
                error=f"Crossref: no results for '{query[:60]}'",
            )

        doi_matched = bool(
            citation.doi
            and best_cand.doi
            and self._normalize_doi(citation.doi) == self._normalize_doi(best_cand.doi)
        )
        if citation.title and not doi_matched and best_sim < MIN_TITLE_SIMILARITY:
            return SourceCandidate(
                source_name=self.name,
                found=False,
                error=f"Crossref: no title match ({best_sim:.2f}) for '{query[:60]}'",
            )
        if (
            citation.title
            and not doi_matched
            and citation.authors
            and best_cand.authors
            and (len(title_tokens(citation.title)) <= 3 or best_sim < 0.70)
            and author_match_score(citation.authors, best_cand.authors) == 0.0
        ):
            return SourceCandidate(
                source_name=self.name,
                found=False,
                error=f"Crossref: no title match ({best_sim:.2f}) for '{citation.title[:60]}' (different author)",
            )

        best_cand.found = True
        # Confidence: heuristic — Crossref score là relevance, không phải similarity.
        # Score 0–∞, normalize về 0–1 với cap.
        score = float(best_item.get("score", 0) or 0)
        best_cand.score = score
        best_cand.confidence = min(score / 100.0, 1.0)
        return best_cand

    async def _fetch_json_with_retry(
        self, path: str, params: dict[str, Any] | None = None
    ) -> dict | None:
        """GET với tenacity retry + exponential backoff.

        Retry on:
            - httpx.HTTPError (network)
            - 429 Too Many Requests
            - 5xx server errors

        Backoff config: initial=5s, max=60s, multiplier=2.0 (từ settings)
        """
        url = f"{self.BASE_URL}{path}"
        retry = AsyncRetrying(
            stop=stop_after_attempt(self.max_retries),
            wait=wait_exponential(
                multiplier=self._backoff.multiplier,
                min=self._backoff.initial_seconds,
                max=self._backoff.max_seconds,
            ),
            retry=retry_if_exception_type(
                (httpx.HTTPError, httpx.TimeoutException)
            ),
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
                            # 404 = not found, không retry
                            return None
                        if resp.status_code == 429 or resp.status_code >= 500:
                            # Retry-worthy
                            resp.raise_for_status()
                        if resp.status_code != 200:
                            logger.warning(
                                f"Crossref {resp.status_code}: {url}"
                            )
                            return None
                        return resp.json()
            return None
        except RetryError:
            logger.error(f"Crossref retry exhausted: {url}")
            return None
        except httpx.HTTPError as e:
            logger.error(f"Crossref HTTP error: {e}")
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
    def _build_bibliographic_query(citation: Citation) -> str:
        """Build Crossref query.bibliographic từ citation fields."""
        parts: list[str] = []
        if citation.title:
            parts.append(citation.title)
        if citation.authors:
            # Handle both Author objects and plain strings
            first_author = citation.authors[0]
            if hasattr(first_author, 'last_name'):
                # Author object
                last = first_author.last_name
                if last:
                    parts.append(last)
            elif isinstance(first_author, str):
                # Plain string - extract surname (handle "Surname, F." and "First Surname")
                if "," in first_author:
                    author_str = first_author.split(",")[0].strip().split()
                else:
                    author_str = first_author.strip().split()
                if author_str:
                    parts.append(author_str[-1])
        if citation.year:
            parts.append(citation.year)
        return " ".join(parts) if parts else ""

    @staticmethod
    def normalize_aaai_ojs_year(doi: str | None, raw_year: str | None) -> str | None:
        """Correct retroactive 2021+ OJS migration dates on AAAI 10.1609/ proceedings DOIs."""
        if not doi or not raw_year or not str(raw_year)[:4].isdigit():
            return raw_year
        y_int = int(str(raw_year)[:4])
        if y_int < 2021:
            return raw_year
        m = re.match(
            r"^10\.1609/(icwsm|aaai|hcomp|aiide|socs)\.v(\d+)",
            doi.strip().lower(),
        )
        if not m:
            return raw_year
        series, vol = m.group(1), int(m.group(2))
        base_offsets = {
            "icwsm": 2006,  # v1 = 2007, v7 = 2013
            "aaai": 1986,   # v24 = 2010, v34 = 2020
            "hcomp": 2012,  # v1 = 2013
            "aiide": 2004,  # v1 = 2005
            "socs": 2009,   # v1 = 2010
        }
        if series == "aaai" and vol < 24:
            return raw_year
        vol_year = base_offsets[series] + vol
        if 2005 <= vol_year < 2021:
            return str(vol_year)
        return raw_year

    @staticmethod
    def _message_to_candidate(message: dict) -> SourceCandidate:
        """Convert Crossref /works/{doi} message → SourceCandidate."""
        # DOI
        doi = message.get("DOI")

        # Title (join subtitle if present, e.g. Crossref stores "DBLP: some lessons learned"
        # as title=["DBLP"] + subtitle=["some lessons learned"])
        titles = message.get("title") or []
        title = titles[0].strip() if titles and titles[0] else None
        subtitles = message.get("subtitle") or []
        subtitle = subtitles[0].strip() if subtitles and subtitles[0] else None
        if title and subtitle and subtitle.lower() not in title.lower():
            title = f"{title.rstrip(':')}: {subtitle}"
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

        # Authors
        authors: list[str] = []
        for a in message.get("author", []) or []:
            given = a.get("given", "")
            family = a.get("family", "")
            full = f"{given} {family}".strip()
            if full:
                authors.append(full)

        # Year — ưu tiên event.start / container-title cho proceedings-article
        # (tránh lấy ngày số hóa muộn ở published-online như ICWSM 2013 -> 2021)
        year: str | None = None
        if message.get("type") == "proceedings-article":
            print_parts = message.get("published-print", {}).get("date-parts", [[None]])
            if print_parts and print_parts[0] and print_parts[0][0]:
                year = str(print_parts[0][0])
            if not year:
                event_parts = (
                    (message.get("event") or {})
                    .get("start", {})
                    .get("date-parts", [[None]])
                )
                if event_parts and event_parts[0] and event_parts[0][0]:
                    ev_y = int(event_parts[0][0])
                    if 1900 <= ev_y <= 2100:
                        year = str(ev_y)
            if not year:
                for c_title in (message.get("container-title") or []):
                    m_conf_year = re.search(r"\b(19\d{2}|20\d{2})\b", str(c_title))
                    if m_conf_year:
                        year = m_conf_year.group(1)
                        break

        if not year:
            for date_key in ("published-print", "published-online", "issued", "created"):
                date_parts = message.get(date_key, {}).get("date-parts", [[None]])
                if date_parts and date_parts[0] and date_parts[0][0]:
                    year = str(date_parts[0][0])
                    break

        year = CrossrefClient.normalize_aaai_ojs_year(doi, year)

        # Venue
        venue: str | None = None
        container = message.get("container-title") or []
        if container:
            venue = container[0]
        elif message.get("short-container-title"):
            venue = message["short-container-title"][0]

        # URL
        url = message.get("URL")

        # Abstract (Crossref sometimes includes JATS XML tags like <jats:p>)
        raw_abstract = message.get("abstract")
        abstract: str | None = None
        if raw_abstract and isinstance(raw_abstract, str):
            cleaned_abs = re.sub(r"<[^>]+>", " ", raw_abstract)
            cleaned_abs = " ".join(cleaned_abs.split()).strip()
            if cleaned_abs:
                abstract = cleaned_abs

        ext_ids: dict[str, str] = {"doi": doi.lower()} if doi else {}
        # Detect Retraction Watch / Publisher retraction metadata
        is_retracted = is_retracted_title
        retraction_doi: str | None = None
        relation = message.get("relation") or {}
        if isinstance(relation, dict):
            retracted_by = relation.get("is-retracted-by") or []
            if isinstance(retracted_by, list) and retracted_by:
                is_retracted = True
                first_rel = retracted_by[0]
                if isinstance(first_rel, dict) and first_rel.get("id"):
                    retraction_doi = str(first_rel["id"]).lower()
        for update_field in ("update-to", "updated-by"):
            updates = message.get(update_field) or []
            if isinstance(updates, list):
                for upd in updates:
                    if isinstance(upd, dict) and str(upd.get("type", "")).lower() in (
                        "retraction",
                        "withdrawal",
                        "removal",
                    ):
                        is_retracted = True
                        if upd.get("DOI") and not retraction_doi:
                            retraction_doi = str(upd["DOI"]).lower()
        if is_retracted:
            ext_ids["is_retracted"] = "true"
            if retraction_doi:
                ext_ids["retraction_doi"] = retraction_doi

        return SourceCandidate(
            source_name="crossref",
            doi=doi.lower() if doi else None,
            title=title,
            authors=authors,
            year=year,
            venue=venue,
            url=url,
            abstract=abstract,
            external_ids=ext_ids,
        )
