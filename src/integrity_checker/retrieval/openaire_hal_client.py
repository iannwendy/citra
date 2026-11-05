"""OpenAIRE Graph & HAL Open Science Repository API Client.

Covers:
- Master's Theses & Doctoral Dissertations (Luận văn / Luận án / Theses)
- Institutional Repository Technical Reports & Working Papers
- European & International Open Science Publications (HAL + OpenAIRE Graph)

Rate limit: 3 req/s (free public REST APIs, no API key required).
Docs:
- HAL API: https://api.archives-ouvertes.fr/docs/search
- OpenAIRE Graph API: https://graph.openaire.eu/docs/apis/search-api/
"""

from __future__ import annotations

import html
import os
import re
from typing import Any

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


class OpenAIREHalClient(BaseScholarClient):
    """Combined HAL Open Science + OpenAIRE Graph client for theses, reports & repositories."""

    HAL_BASE_URL = "https://api.archives-ouvertes.fr/search/"
    OPENAIRE_BASE_URL = "https://api.openaire.eu/search/publications"
    name = "openaire_hal"

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
        """Query HAL Open Science first (fast Solr JSON), then fallback to OpenAIRE Graph."""
        self._reset_http_telemetry()
        hal_cand = await self._lookup_hal(citation)
        if hal_cand and hal_cand.found:
            return hal_cand

        oa_cand = await self._lookup_openaire(citation)
        if oa_cand and oa_cand.found:
            return oa_cand

        query_preview = (citation.title or citation.doi or citation.raw_text or "")[:60]
        return self._build_miss_or_error_candidate("OpenAIRE/HAL", query_preview)

    async def _lookup_hal(self, citation: Citation) -> SourceCandidate | None:
        """Search HAL Open Science API (`https://api.archives-ouvertes.fr/search/`)."""
        fl_fields = (
            "docid,halId_s,title_s,authFullName_s,producedDateY_i,"
            "doiId_s,abstract_s,journalTitle_s,bookTitle_s,conferenceTitle_s,uri_s,docType_s"
        )
        doi_norm = normalize_doi(citation.doi) if citation.doi else None
        if doi_norm:
            params = {
                "q": f'doiId_s:"{doi_norm}"',
                "fl": fl_fields,
                "rows": 3,
                "wt": "json",
            }
            data = await self._fetch_json(self.HAL_BASE_URL, params=params)
            docs = (data or {}).get("response", {}).get("docs") or []
            if isinstance(docs, list) and docs:
                cand = self._hal_doc_to_candidate(docs[0])
                if cand.title or cand.doi:
                    cand.found = True
                    cand.confidence = 0.96
                    return cand
            if self._last_status_code == 429:
                return None

        raw_title = (citation.title or "").strip()
        if not raw_title and citation.raw_text:
            raw_title = " ".join(title_tokens(citation.raw_text)[:12])
        clean_q = re.sub(r"[^\w\s-]", " ", raw_title)
        clean_q = re.sub(r"\s+", " ", clean_q).strip()
        if not clean_q or len(clean_q) < 4:
            return None

        params = {
            "q": f"title_t:({clean_q})",
            "fl": fl_fields,
            "rows": 5,
            "wt": "json",
        }
        data = await self._fetch_json(self.HAL_BASE_URL, params=params)
        docs = (data or {}).get("response", {}).get("docs") or []
        if not isinstance(docs, list) or not docs:
            return None

        best_cand, best_sim = self._rank_candidates(
            [self._hal_doc_to_candidate(d) for d in docs if isinstance(d, dict)],
            query_title=raw_title,
            query_authors=citation.authors,
            query_year=citation.year,
        )
        if best_cand and best_sim >= MIN_TITLE_SIMILARITY:
            best_cand.found = True
            best_cand.confidence = round(min(0.94, max(0.60, best_sim)), 4)
            return best_cand
        return None

    async def _lookup_openaire(self, citation: Citation) -> SourceCandidate | None:
        """Search OpenAIRE Graph API (`https://api.openaire.eu/search/publications`)."""
        doi_norm = normalize_doi(citation.doi) if citation.doi else None
        raw_title = (citation.title or "").strip()
        if not raw_title and citation.raw_text:
            raw_title = " ".join(title_tokens(citation.raw_text)[:12])

        params: dict[str, Any] = {"format": "json", "size": 5}
        if doi_norm:
            params["doi"] = doi_norm
        elif raw_title and len(raw_title) >= 4:
            params["title"] = raw_title
        else:
            return None

        data = await self._fetch_json(self.OPENAIRE_BASE_URL, params=params)
        if not data:
            return None

        results_node = (
            (data.get("response") or {}).get("results") or {}
        ).get("result")
        if isinstance(results_node, dict):
            results_list = [results_node]
        elif isinstance(results_node, list):
            results_list = results_node
        else:
            return None

        parsed_cands = [
            self._openaire_item_to_candidate(item)
            for item in results_list
            if isinstance(item, dict)
        ]
        parsed_cands = [c for c in parsed_cands if c is not None and (c.title or c.doi)]
        if not parsed_cands:
            return None

        if doi_norm:
            for c in parsed_cands:
                if c.doi and c.doi.lower() == doi_norm.lower():
                    c.found = True
                    c.confidence = 0.96
                    return c

        if not raw_title:
            return None

        best_cand, best_sim = self._rank_candidates(
            parsed_cands,
            query_title=raw_title,
            query_authors=citation.authors,
            query_year=citation.year,
        )
        if best_cand and best_sim >= MIN_TITLE_SIMILARITY:
            best_cand.found = True
            best_cand.confidence = round(min(0.94, max(0.60, best_sim)), 4)
            return best_cand
        return None

    def _rank_candidates(
        self,
        candidates: list[SourceCandidate],
        query_title: str,
        query_authors: list[str] | None = None,
        query_year: str | None = None,
    ) -> tuple[SourceCandidate | None, float]:
        best_cand: SourceCandidate | None = None
        best_sim = -1.0
        best_rank = -1.0
        cit_year = str(query_year)[:4] if query_year else None

        for cand in candidates:
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

    @staticmethod
    def _clean_text(text: Any) -> str | None:
        if not text:
            return None
        if isinstance(text, list):
            text = text[0] if text else ""
        if isinstance(text, dict):
            text = text.get("$") or text.get("content") or ""
        cleaned = html.unescape(str(text))
        cleaned = re.sub(r"<[^>]+>", " ", cleaned)
        cleaned = re.sub(r"\s+", " ", cleaned).strip()
        return cleaned or None

    def _hal_doc_to_candidate(self, doc: dict[str, Any]) -> SourceCandidate:
        title = self._clean_text(doc.get("title_s"))
        authors_raw = doc.get("authFullName_s") or []
        authors = [str(a).strip() for a in authors_raw if str(a).strip()] if isinstance(authors_raw, list) else []
        year_raw = doc.get("producedDateY_i")
        year = str(year_raw)[:4] if year_raw else None
        doi = normalize_doi(str(doc.get("doiId_s"))) if doc.get("doiId_s") else None
        venue = self._clean_text(
            doc.get("journalTitle_s") or doc.get("conferenceTitle_s") or doc.get("bookTitle_s")
        )
        abstract = self._clean_text(doc.get("abstract_s"))
        url = str(doc.get("uri_s") or "") or None
        ext_ids: dict[str, str] = {}
        if doi:
            ext_ids["doi"] = doi
        if doc.get("halId_s"):
            ext_ids["hal_id"] = str(doc["halId_s"])
        if doc.get("docType_s"):
            ext_ids["doc_type"] = str(doc["docType_s"])

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

    def _openaire_item_to_candidate(self, item: dict[str, Any]) -> SourceCandidate | None:
        meta = (
            ((item.get("metadata") or {}).get("oaf:entity") or {}).get("oaf:result")
            or item
        )
        if not isinstance(meta, dict):
            return None

        title = self._clean_text(meta.get("title"))
        creators_raw = meta.get("creator") or []
        if isinstance(creators_raw, dict):
            creators_raw = [creators_raw]
        authors: list[str] = []
        if isinstance(creators_raw, list):
            for c in creators_raw:
                name_str = self._clean_text(c)
                if name_str:
                    if "," in name_str:
                        parts = [p.strip() for p in name_str.split(",", 1)]
                        if len(parts) == 2 and parts[0] and parts[1]:
                            name_str = f"{parts[1]} {parts[0]}"
                    authors.append(name_str)

        date_str = self._clean_text(meta.get("dateofacceptance")) or ""
        year = date_str[:4] if len(date_str) >= 4 and date_str[:4].isdigit() else None
        venue = self._clean_text(meta.get("journal") or meta.get("publisher"))
        abstract = self._clean_text(meta.get("description"))

        doi: str | None = None
        pids = meta.get("pid") or []
        if isinstance(pids, dict):
            pids = [pids]
        if isinstance(pids, list):
            for p in pids:
                if isinstance(p, dict) and str(p.get("@classid", "")).lower() == "doi":
                    doi = normalize_doi(str(p.get("$") or ""))
                    if doi:
                        break

        ext_ids: dict[str, str] = {"repository": "OpenAIRE"}
        if doi:
            ext_ids["doi"] = doi

        return SourceCandidate(
            source_name=self.name,
            found=False,
            doi=doi,
            title=title,
            authors=authors,
            year=year,
            venue=venue,
            url=f"https://doi.org/{doi}" if doi else None,
            abstract=abstract,
            external_ids=ext_ids,
        )

    async def _fetch_json(
        self,
        url: str,
        params: dict[str, Any] | None = None,
    ) -> dict[str, Any] | None:
        try:
            req_timeout = min(self.timeout, 2.5) if "openaire.eu" in url else self.timeout
            client = get_shared_http_client(follow_redirects=True)
            resp = await client.get(
                url,
                params=params,
                headers=self._headers,
                timeout=req_timeout,
            )
            self._record_http_response(resp)
            if resp.status_code != 200:
                return None
            return resp.json()
        except Exception as exc:  # noqa: BLE001
            self._record_transport_error(exc)
            logger.debug(f"OpenAIRE/HAL request failed for {url}: {exc}")
            return None
