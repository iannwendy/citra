"""DOAJ (Directory of Open Access Journals) REST API Client.

Provides verification and abstract enrichment for peer-reviewed Open Access
journals worldwide, with strong coverage of regional, Asian/Vietnamese,
Social Sciences, Humanities, Law, Economics, and Education journals.

Rate limit: 2 req/s (free public API, no API key required).
Docs: https://doaj.org/api/v4/docs
"""

from __future__ import annotations

import html
import os
import re
from typing import Any
from urllib.parse import quote

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


class DOAJClient(BaseScholarClient):
    """DOAJ REST API client for Open Access scholarly articles."""

    BASE_URL = "https://doaj.org/api"
    name = "doaj"

    def __init__(
        self,
        contact_email: str | None = None,
        timeout: float = 10.0,
    ) -> None:
        super().__init__(timeout=timeout)
        settings = get_settings()
        self.contact_email = (
            contact_email
            or os.getenv("CONTACT_EMAIL", "")
            or settings.contact_email
            or settings.retrieval.contact_email
        )
        self._headers = {
            "User-Agent": (
                f"EssayIntegrityChecker/1.0 (mailto:{self.contact_email})"
                if self.contact_email
                else "EssayIntegrityChecker/1.0"
            ),
            "Accept": "application/json",
        }

    async def lookup(self, citation: Citation) -> SourceCandidate:
        """Lookup article in DOAJ by DOI first, then by title search."""
        self._reset_http_telemetry()
        if citation.doi:
            doi_norm = normalize_doi(citation.doi)
            if doi_norm:
                by_doi = await self._lookup_by_doi(doi_norm, citation=citation)
                if by_doi and by_doi.found:
                    return by_doi
                if self._last_status_code == 429:
                    return self._build_miss_or_error_candidate("DOAJ", doi_norm)

        return await self._lookup_by_title(citation)

    async def _lookup_by_doi(
        self,
        doi: str,
        citation: Citation | None = None,
    ) -> SourceCandidate | None:
        encoded = quote(f'doi:"{doi}"', safe="")
        data = await self._fetch_json(f"/search/articles/{encoded}", params={"pageSize": 3})
        if not data:
            return None
        results = data.get("results") or []
        if not isinstance(results, list) or not results:
            return None
        cand = self._item_to_candidate(results[0])
        if not cand.doi and not cand.title:
            return None
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
        cand.confidence = 0.96
        return cand

    async def _lookup_by_title(self, citation: Citation) -> SourceCandidate:
        raw_title = (citation.title or "").strip()
        if not raw_title and citation.raw_text:
            raw_title = " ".join(title_tokens(citation.raw_text)[:12])
        clean_query = re.sub(r"[^\w\s-]", " ", raw_title)
        clean_query = re.sub(r"\s+", " ", clean_query).strip()
        if not clean_query or len(clean_query) < 4:
            return SourceCandidate(
                source_name=self.name,
                found=False,
                error="DOAJ: empty title query",
            )

        encoded_q = quote(f'bibjson.title:"{clean_query}"', safe="")
        data = await self._fetch_json(
            f"/search/articles/{encoded_q}",
            params={"pageSize": 5},
        )
        results = (data or {}).get("results") if isinstance(data, dict) else None
        if (not isinstance(results, list) or not results) and self._last_status_code != 429:
            toks = [t for t in title_tokens(clean_query) if len(t) >= 3][:8]
            if len(toks) >= 2:
                and_expr = " AND ".join(toks)
                encoded_and = quote(f"bibjson.title:({and_expr})", safe="")
                data = await self._fetch_json(
                    f"/search/articles/{encoded_and}",
                    params={"pageSize": 5},
                )
        if not data:
            return self._build_miss_or_error_candidate(
                "DOAJ",
                clean_query,
                clean_miss_error=f"DOAJ: no response for '{clean_query[:60]}'",
            )

        results = data.get("results") or []
        if not isinstance(results, list) or not results:
            return SourceCandidate(
                source_name=self.name,
                found=False,
                error=f"DOAJ: no results for '{clean_query[:60]}'",
            )

        best_cand: SourceCandidate | None = None
        best_sim = -1.0
        best_rank = -1.0
        cit_year = str(citation.year)[:4] if citation.year else None

        for item in results:
            if not isinstance(item, dict):
                continue
            cand = self._item_to_candidate(item)
            if not cand.title:
                continue
            if is_book_review_mismatch(raw_title, citation.authors, cand.title, cand.authors):
                continue
            sim = title_similarity(raw_title, cand.title)
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
            rank_score = sim * 0.80 + auth_sim * 0.15 + yr_bonus
            if rank_score > best_rank:
                best_rank = rank_score
                best_sim = sim
                best_cand = cand

        if best_cand is None or best_sim < MIN_TITLE_SIMILARITY:
            return SourceCandidate(
                source_name=self.name,
                found=False,
                error=f"DOAJ: no title match >= {MIN_TITLE_SIMILARITY} (best={max(0.0, best_sim):.2f}) for '{clean_query[:60]}'",
            )

        best_cand.found = True
        best_cand.confidence = round(min(0.94, max(0.60, best_sim)), 4)
        return best_cand

    @staticmethod
    def _clean_text(text: str | None) -> str | None:
        if not text:
            return None
        cleaned = html.unescape(str(text))
        cleaned = re.sub(r"<[^>]+>", " ", cleaned)
        cleaned = re.sub(r"\s+", " ", cleaned).strip()
        return cleaned or None

    def _item_to_candidate(self, item: dict[str, Any]) -> SourceCandidate:
        bib = item.get("bibjson") or {}
        title = self._clean_text(bib.get("title"))

        authors: list[str] = []
        for a in bib.get("author") or []:
            if isinstance(a, dict) and a.get("name"):
                name_str = str(a["name"]).strip()
                if name_str:
                    authors.append(name_str)

        year_raw = bib.get("year")
        year = str(year_raw)[:4] if year_raw and str(year_raw)[:4].isdigit() else None

        journal = bib.get("journal") or {}
        venue = self._clean_text(journal.get("title")) if isinstance(journal, dict) else None

        doi: str | None = None
        for ident in bib.get("identifier") or []:
            if isinstance(ident, dict) and str(ident.get("type", "")).lower() == "doi":
                doi = normalize_doi(str(ident.get("id") or ""))
                if doi:
                    break

        url: str | None = None
        for lnk in bib.get("link") or []:
            if isinstance(lnk, dict) and lnk.get("url"):
                url = str(lnk["url"]).strip()
                if str(lnk.get("type", "")).lower() == "fulltext":
                    break
        if not url and item.get("id"):
            url = f"https://doaj.org/article/{item['id']}"

        abstract = self._clean_text(bib.get("abstract"))
        ext_ids: dict[str, str] = {}
        if doi:
            ext_ids["doi"] = doi
        if item.get("id"):
            ext_ids["doaj_id"] = str(item["id"])

        return SourceCandidate(
            source_name=self.name,
            found=False,
            doi=doi,
            title=title,
            authors=authors,
            year=year,
            venue=venue,
            url=url,
            abstract=abstract,
            external_ids=ext_ids,
        )

    async def _fetch_json(
        self,
        path: str,
        params: dict[str, Any] | None = None,
    ) -> dict[str, Any] | None:
        url = f"{self.BASE_URL}{path}"
        try:
            client = get_shared_http_client(follow_redirects=True)
            resp = await client.get(
                url,
                params=params,
                headers=self._headers,
                timeout=self.timeout,
            )
            self._record_http_response(resp)
            if resp.status_code != 200:
                return None
            return resp.json()
        except Exception as exc:  # noqa: BLE001
            self._record_transport_error(exc)
            logger.debug(f"DOAJ request failed for {url}: {exc}")
            return None
