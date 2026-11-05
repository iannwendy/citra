"""Global DOI Registration Agency (RA) & CSL-JSON Content Negotiation Client.

Verifies any DOI globally via https://doi.org/doiRA/{doi} and fetches canonical
CSL-JSON metadata via https://doi.org/{doi} (Accept: application/vnd.citationstyles.csl+json).

Covers regional & specialized DOI registration agencies outside Crossref:
- DataCite (Datasets, Zenodo, Figshare, arXiv)
- JaLC (Japan Link Center)
- mEDRA (Multilingual European DOI Registration Agency)
- CNKI / ISTIC (China Academic Journals)
- KISTI (Korea Institute of Science and Technology Information)
- Airiti (Taiwan Academic Literature)
- OP (Publications Office of the European Union)

Rate limit: 10 req/s (free public Handle/DOI proxy, no API key required).
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
    normalize_doi,
    title_similarity,
    title_tokens,
)

logger = get_logger(__name__)


class DoiRaClient(BaseScholarClient):
    """Global DOI Registration Agency & CSL-JSON resolver."""

    BASE_URL = "https://doi.org"
    name = "doi_ra"

    def __init__(
        self,
        contact_email: str | None = None,
        timeout: float = 8.0,
    ) -> None:
        super().__init__(timeout=timeout)
        settings = get_settings()
        self.contact_email = (
            contact_email
            or os.getenv("CONTACT_EMAIL", "")
            or settings.contact_email
            or settings.retrieval.contact_email
        )
        self._user_agent = (
            f"EssayIntegrityChecker/1.0 (mailto:{self.contact_email})"
            if self.contact_email
            else "EssayIntegrityChecker/1.0"
        )

    async def lookup(self, citation: Citation) -> SourceCandidate:
        """Verify DOI registration agency and fetch CSL-JSON metadata."""
        self._reset_http_telemetry()
        if not citation.doi:
            return SourceCandidate(
                source_name=self.name,
                found=False,
                error="DOI RA: citation has no DOI",
            )

        doi_norm = normalize_doi(citation.doi)
        if not doi_norm:
            return SourceCandidate(
                source_name=self.name,
                found=False,
                error="DOI RA: invalid DOI format",
            )

        ra_info = await self.check_registration_agency(doi_norm)
        if ra_info is None:
            if self._last_status_code == 429 or (
                self._last_status_code is not None and self._last_status_code >= 500
            ):
                return self._build_miss_or_error_candidate("DOI RA", doi_norm)
            return SourceCandidate(
                source_name=self.name,
                found=False,
                error=f"DOI RA: network error checking DOI '{doi_norm}'",
            )

        ra_name = ra_info.get("RA")
        status_msg = ra_info.get("status", "")
        if not ra_name:
            return SourceCandidate(
                source_name=self.name,
                found=False,
                error=f"DOI RA: no results for DOI '{doi_norm}' ({status_msg or 'DOI does not exist'})",
                external_ids={"doi_ra_status": "nonexistent"},
            )

        # Fetch canonical bibliographic metadata via CSL-JSON content negotiation
        csl_cand = await self._fetch_csl_json(doi_norm, ra_name=ra_name)
        if csl_cand and (csl_cand.title or csl_cand.doi):
            # Guard against mismatched work if citation has a substantive title
            if (
                citation.title
                and len(title_tokens(citation.title)) >= 3
                and csl_cand.title
                and csl_cand.doi
                and csl_cand.doi.lower() != doi_norm.lower()
            ):
                if title_similarity(citation.title, csl_cand.title) < 0.70:
                    return SourceCandidate(
                        source_name=self.name,
                        found=False,
                        error=f"DOI RA: CSL title mismatch for '{doi_norm}'",
                    )
            csl_cand.found = True
            if not csl_cand.authors:
                csl_cand.authors = list(citation.authors or [ra_name])
            csl_cand.confidence = 0.96
            return csl_cand

        # Even if CSL-JSON is not supported by a regional agency (e.g. CNKI/JaLC HTML landing),
        # return a verified RA record when the agency is a recognized non-Crossref regional registrar
        if ra_name not in ("Crossref",):
            return SourceCandidate(
                source_name=self.name,
                found=True,
                doi=doi_norm,
                title=citation.title or f"DOI {doi_norm} ({ra_name})",
                authors=list(citation.authors or [ra_name]),
                year=str(citation.year)[:4] if citation.year else None,
                venue=citation.venue or f"{ra_name} Registered Publication",
                url=f"https://doi.org/{doi_norm}",
                external_ids={"doi": doi_norm, "doi_ra": ra_name},
                confidence=0.88,
            )

        if self._last_status_code == 429 or (
            self._last_status_code is not None and self._last_status_code >= 500
        ):
            cand = self._build_miss_or_error_candidate("DOI RA", doi_norm)
            cand.external_ids = {"doi_ra": ra_name}
            return cand

        return SourceCandidate(
            source_name=self.name,
            found=False,
            error=f"DOI RA: CSL metadata unavailable for '{doi_norm}' (RA={ra_name})",
            external_ids={"doi_ra": ra_name},
        )

    async def check_registration_agency(self, doi: str) -> dict[str, str] | None:
        """GET https://doi.org/doiRA/{doi} -> returns {'DOI': ..., 'RA': ...} or {'status': ...}."""
        url = f"{self.BASE_URL}/doiRA/{quote(doi, safe='/')}"
        headers = {
            "User-Agent": self._user_agent,
            "Accept": "application/json",
        }
        try:
            client = get_shared_http_client(follow_redirects=True)
            resp = await client.get(url, headers=headers, timeout=self.timeout)
            self._record_http_response(resp)
            if resp.status_code == 404:
                return {"DOI": doi, "status": "DOI does not exist"}
            if resp.status_code != 200:
                return None
            data = resp.json()
            if isinstance(data, list) and data and isinstance(data[0], dict):
                return {str(k): str(v) for k, v in data[0].items() if v is not None}
        except Exception as exc:  # noqa: BLE001
            self._record_transport_error(exc)
            logger.debug(f"DOI RA lookup failed for '{doi}': {exc}")
            return None
        return None

    async def _fetch_csl_json(self, doi: str, ra_name: str) -> SourceCandidate | None:
        """Fetch CSL-JSON metadata via https://doi.org/{doi} content negotiation."""
        url = f"{self.BASE_URL}/{quote(doi, safe='/')}"
        headers = {
            "User-Agent": self._user_agent,
            "Accept": "application/vnd.citationstyles.csl+json, application/json",
        }
        try:
            client = get_shared_http_client(follow_redirects=True)
            resp = await client.get(url, headers=headers, timeout=self.timeout)
            self._record_http_response(resp)
            if resp.status_code != 200:
                return None
            data = resp.json()
            if not isinstance(data, dict):
                return None
            return self._csl_to_candidate(data, default_doi=doi, ra_name=ra_name)
        except Exception as exc:  # noqa: BLE001
            self._record_transport_error(exc)
            logger.debug(f"CSL-JSON lookup failed for '{doi}': {exc}")
            return None

    @staticmethod
    def _clean_text(text: Any) -> str | None:
        if not text:
            return None
        if isinstance(text, list):
            text = text[0] if text else ""
        cleaned = html.unescape(str(text))
        cleaned = re.sub(r"<[^>]+>", " ", cleaned)
        cleaned = re.sub(r"\s+", " ", cleaned).strip()
        return cleaned or None

    def _csl_to_candidate(
        self,
        data: dict[str, Any],
        default_doi: str,
        ra_name: str,
    ) -> SourceCandidate:
        doi = normalize_doi(str(data.get("DOI") or default_doi))
        title = self._clean_text(data.get("title"))

        authors: list[str] = []
        raw_authors = data.get("author") or []
        if isinstance(raw_authors, list):
            for a in raw_authors:
                if not isinstance(a, dict):
                    continue
                given = (a.get("given") or "").strip()
                family = (a.get("family") or "").strip()
                literal = (a.get("literal") or a.get("name") or "").strip()
                if given and family:
                    authors.append(f"{given} {family}")
                elif family:
                    authors.append(family)
                elif literal:
                    authors.append(literal)

        year: str | None = None
        for date_field in ("issued", "published", "published-print", "published-online", "created"):
            date_obj = data.get(date_field)
            if isinstance(date_obj, dict):
                parts = date_obj.get("date-parts")
                if isinstance(parts, list) and parts and isinstance(parts[0], list) and parts[0]:
                    yr = str(parts[0][0])[:4]
                    if yr.isdigit():
                        year = yr
                        break

        venue = self._clean_text(
            data.get("container-title") or data.get("publisher")
        )
        abstract = self._clean_text(data.get("abstract"))
        url = str(data.get("URL") or (f"https://doi.org/{doi}" if doi else "")) or None

        ext_ids: dict[str, str] = {"doi_ra": ra_name}
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
            url=url,
            abstract=abstract,
            external_ids=ext_ids,
        )
