"""NCBI Entrez E-Utilities & bioRxiv / medRxiv Preprint API Client.

Complements EuropePMCClient with:
1. Direct Cold Spring Harbor Laboratory bioRxiv & medRxiv API lookup for
   preprints with DOI prefix `10.1101/*` (extracting preprint abstract and
   official published journal DOI when available).
2. NCBI Entrez E-Utilities (`esearch.fcgi`, `esummary.fcgi`, `efetch.fcgi`)
   for PubMed PMIDs, biomedical literature, and clinical abstracts.

Rate limit: 3 req/s without API key (10 req/s with optional NCBI_API_KEY).
Docs:
- https://api.biorxiv.org/
- https://www.ncbi.nlm.nih.gov/books/NBK25500/
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


class NcbiBiorxivClient(BaseScholarClient):
    """Combined bioRxiv/medRxiv API + NCBI Entrez E-Utilities client."""

    BIORXIV_BASE_URL = "https://api.biorxiv.org"
    NCBI_BASE_URL = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils"
    name = "ncbi_biorxiv"

    def __init__(
        self,
        contact_email: str | None = None,
        timeout: float = 10.0,
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
        self.api_key = api_key or os.getenv("NCBI_API_KEY", "")
        self._headers = {
            "User-Agent": (
                f"EssayIntegrityChecker/1.0 (mailto:{self.contact_email})"
                if self.contact_email
                else "EssayIntegrityChecker/1.0"
            ),
            "Accept": "application/json",
        }

    @classmethod
    def is_biorxiv_doi(cls, doi: str | None) -> bool:
        """Return True if DOI has Cold Spring Harbor Laboratory prefix (10.1101/)."""
        norm = normalize_doi(doi)
        return bool(norm and norm.lower().startswith("10.1101/"))

    async def lookup(self, citation: Citation) -> SourceCandidate:
        """Route 10.1101/* DOIs to bioRxiv/medRxiv API first, then NCBI Entrez E-Utilities."""
        self._reset_http_telemetry()
        doi_norm = normalize_doi(citation.doi) if citation.doi else None
        if doi_norm and self.is_biorxiv_doi(doi_norm):
            bio_cand = await self._lookup_biorxiv_doi(doi_norm, citation=citation)
            if bio_cand and bio_cand.found:
                return bio_cand

        ncbi_cand = await self._lookup_ncbi(citation, doi_norm=doi_norm)
        if ncbi_cand and ncbi_cand.found:
            return ncbi_cand

        query_preview = (citation.title or doi_norm or citation.raw_text or "")[:60]
        return self._build_miss_or_error_candidate("NCBI/bioRxiv", query_preview)

    async def _lookup_biorxiv_doi(
        self,
        doi: str,
        citation: Citation | None = None,
    ) -> SourceCandidate | None:
        """Query bioRxiv/medRxiv details endpoint for a 10.1101/* DOI."""
        for server in ("biorxiv", "medrxiv"):
            url = f"{self.BIORXIV_BASE_URL}/details/{server}/{quote(doi, safe='/')}/na/json"
            data = await self._fetch_json(url)
            if self._last_status_code == 429:
                return None
            collection = (data or {}).get("collection") or []
            if isinstance(collection, list) and collection:
                item = collection[-1]  # Latest version of preprint
                if not isinstance(item, dict):
                    continue
                cand = self._biorxiv_item_to_candidate(item, server=server)
                if cand.title or cand.doi:
                    if (
                        citation
                        and citation.title
                        and len(title_tokens(citation.title)) >= 3
                        and cand.title
                        and title_similarity(citation.title, cand.title) < 0.65
                    ):
                        continue
                    cand.found = True
                    cand.confidence = 0.97
                    return cand
        return None

    def _biorxiv_item_to_candidate(
        self,
        item: dict[str, Any],
        server: str = "biorxiv",
    ) -> SourceCandidate:
        doi = normalize_doi(str(item.get("doi") or ""))
        title = self._clean_text(item.get("title"))
        raw_authors = str(item.get("authors") or "")
        authors: list[str] = []
        for part in raw_authors.split(";"):
            part = part.strip()
            if not part:
                continue
            if "," in part:
                sub = [s.strip() for s in part.split(",", 1)]
                if len(sub) == 2 and sub[0] and sub[1]:
                    part = f"{sub[1]} {sub[0]}"
            authors.append(part)

        date_str = str(item.get("date") or "")
        year = date_str[:4] if len(date_str) >= 4 and date_str[:4].isdigit() else None
        abstract = self._clean_text(item.get("abstract"))
        published_doi = normalize_doi(str(item.get("published") or ""))

        ext_ids: dict[str, str] = {"preprint_server": server}
        if doi:
            ext_ids["doi"] = doi
        if published_doi:
            ext_ids["published_doi"] = published_doi

        return SourceCandidate(
            source_name=self.name,
            found=False,
            doi=doi,
            title=title,
            authors=authors,
            year=year,
            venue="bioRxiv" if server == "biorxiv" else "medRxiv",
            url=f"https://doi.org/{doi}" if doi else None,
            abstract=abstract,
            external_ids=ext_ids,
        )

    async def _lookup_ncbi(
        self,
        citation: Citation,
        doi_norm: str | None = None,
    ) -> SourceCandidate | None:
        raw_title = (citation.title or "").strip()
        if not raw_title and citation.raw_text:
            raw_title = " ".join(title_tokens(citation.raw_text)[:12])

        if doi_norm:
            term = f"{doi_norm}[LID]"
        elif raw_title and len(raw_title) >= 4:
            term = f"{raw_title}[Title]"
        else:
            return None

        base_params: dict[str, Any] = {
            "db": "pubmed",
            "retmode": "json",
            "retmax": 5,
            "term": term,
        }
        if self.contact_email:
            base_params["email"] = self.contact_email
        if self.api_key:
            base_params["api_key"] = self.api_key

        search_data = await self._fetch_json(f"{self.NCBI_BASE_URL}/esearch.fcgi", params=base_params)
        id_list = ((search_data or {}).get("esearchresult") or {}).get("idlist") or []
        if (
            (not isinstance(id_list, list) or not id_list)
            and self._last_status_code != 429
            and doi_norm
            and raw_title
            and len(raw_title) >= 4
        ):
            # Fallback to PubMed title search if the preprint/regional DOI is not indexed as [LID]
            fallback_params = dict(base_params)
            fallback_params["term"] = f"{raw_title}[Title]"
            search_data = await self._fetch_json(f"{self.NCBI_BASE_URL}/esearch.fcgi", params=fallback_params)
            id_list = ((search_data or {}).get("esearchresult") or {}).get("idlist") or []
        if not isinstance(id_list, list) or not id_list:
            return None

        summary_params: dict[str, Any] = {
            "db": "pubmed",
            "retmode": "json",
            "id": ",".join(str(i) for i in id_list[:5]),
        }
        if self.contact_email:
            summary_params["email"] = self.contact_email
        if self.api_key:
            summary_params["api_key"] = self.api_key

        summary_data = await self._fetch_json(f"{self.NCBI_BASE_URL}/esummary.fcgi", params=summary_params)
        result_map = (summary_data or {}).get("result") or {}
        if not isinstance(result_map, dict):
            return None

        candidates: list[SourceCandidate] = []
        for pmid in id_list[:5]:
            doc = result_map.get(str(pmid))
            if isinstance(doc, dict):
                candidates.append(self._ncbi_doc_to_candidate(doc, str(pmid)))

        if not candidates:
            return None

        best_cand: SourceCandidate | None = None
        best_sim = -1.0
        best_rank = -1.0
        cit_year = str(citation.year)[:4] if citation.year else None

        for cand in candidates:
            if doi_norm and cand.doi and cand.doi.lower() == doi_norm.lower():
                best_cand = cand
                best_sim = 1.0
                break
            if not cand.title or not raw_title:
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
            return None

        # Enrich abstract via efetch XML if missing
        pmid = best_cand.external_ids.get("pmid")
        if pmid and not best_cand.abstract and self._last_status_code != 429:
            best_cand.abstract = await self._fetch_pubmed_abstract(pmid)

        best_cand.found = True
        best_cand.confidence = round(min(0.96, max(0.65, best_sim)), 4)
        return best_cand

    def _ncbi_doc_to_candidate(self, doc: dict[str, Any], pmid: str) -> SourceCandidate:
        title = self._clean_text(doc.get("title"))
        if title:
            title = title.rstrip(".")

        authors: list[str] = []
        for a in doc.get("authors") or []:
            if isinstance(a, dict) and a.get("name"):
                authors.append(str(a["name"]).strip())

        pubdate = str(doc.get("pubdate") or doc.get("epubdate") or "")
        yr_m = re.search(r"\b(19|20)\d{2}\b", pubdate)
        year = yr_m.group(0) if yr_m else None

        venue = self._clean_text(doc.get("fulljournalname") or doc.get("source"))

        doi: str | None = None
        for aid in doc.get("articleids") or []:
            if isinstance(aid, dict) and str(aid.get("idtype", "")).lower() == "doi":
                doi = normalize_doi(str(aid.get("value") or ""))
                if doi:
                    break

        ext_ids: dict[str, str] = {"pmid": pmid}
        if doi:
            ext_ids["doi"] = doi
        pubtypes = [str(pt).lower() for pt in (doc.get("pubtype") or [])]
        if any("retracted" in pt for pt in pubtypes):
            ext_ids["is_retracted"] = "true"

        return SourceCandidate(
            source_name=self.name,
            found=False,
            doi=doi,
            title=title,
            authors=authors,
            year=year,
            venue=venue,
            url=f"https://pubmed.ncbi.nlm.nih.gov/{pmid}/",
            abstract=None,
            external_ids=ext_ids,
        )

    async def _fetch_pubmed_abstract(self, pmid: str) -> str | None:
        params: dict[str, Any] = {
            "db": "pubmed",
            "retmode": "xml",
            "id": pmid,
        }
        if self.contact_email:
            params["email"] = self.contact_email
        if self.api_key:
            params["api_key"] = self.api_key
        try:
            client = get_shared_http_client(follow_redirects=True)
            resp = await client.get(
                f"{self.NCBI_BASE_URL}/efetch.fcgi",
                params=params,
                headers=self._headers,
                timeout=self.timeout,
            )
            self._record_http_response(resp)
            if resp.status_code != 200:
                return None
            matches = re.findall(
                r"<AbstractText[^>]*>(.*?)</AbstractText>",
                resp.text,
                flags=re.DOTALL | re.IGNORECASE,
            )
            if matches:
                joined = " ".join(self._clean_text(m) or "" for m in matches).strip()
                return joined if len(joined) >= 25 else None
        except Exception as exc:  # noqa: BLE001
            logger.debug(f"NCBI efetch abstract failed for PMID {pmid}: {exc}")
        return None

    @staticmethod
    def _clean_text(text: Any) -> str | None:
        if not text:
            return None
        cleaned = html.unescape(str(text))
        cleaned = re.sub(r"<[^>]+>", " ", cleaned)
        cleaned = re.sub(r"\s+", " ", cleaned).strip()
        return cleaned or None

    async def _fetch_json(
        self,
        url: str,
        params: dict[str, Any] | None = None,
    ) -> dict[str, Any] | None:
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
            logger.debug(f"NCBI/bioRxiv request failed for {url}: {exc}")
            return None
