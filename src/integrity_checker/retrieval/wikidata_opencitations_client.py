"""Wikidata Knowledge Graph (WikiCite) & OpenCitations Index (COCI) API Client.

Provides 100% free, no-key verification across two complementary global authorities:
1. OpenCitations Index API v2 (`https://opencitations.net/index/api/v2/metadata/doi:{doi}`):
   - Independent open bibliographic & citation-count verification for DOIs.
2. Wikidata Action & Entity API (`https://www.wikidata.org/w/api.php`):
   - International Technical & Cybersecurity Standards (`ISO/IEC 27001`, `ISO 9001`,
     `NIST SP 800-53`, `IEEE 802.11`, `W3C WCAG`, `OWASP Top 10`)
   - Clinical & Psychological Manuals / Scales (`DSM-5`, `ICD-10`, `ICD-11`, `PHQ-9`, `LIWC`)
   - Global Institutional Reports (`WHO`, `World Bank`, `UNESCO`, `IPCC`) & 40M+ WikiCite works.

Rate limit: 5 req/s (free public APIs, no API key required).
Docs:
- https://opencitations.net/index/api/v2
- https://www.wikidata.org/w/api.php
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

MIN_TITLE_SIMILARITY = 0.60

_STANDARD_CODE_RE = re.compile(
    r"\b(?:"
    r"ISO(?:/IEC)?\s*\d{3,5}(?:-\d+)?(?::\d{4})?"
    r"|NIST\s+(?:SP|Special\s+Publication|FIPS)\s*\d{2,4}(?:-\d+[A-Za-z]?)?"
    r"|IEEE\s+(?:Std\s+)?802\.\d+(?:[a-z]{1,2})?"
    r"|DSM-(?:IV(?:-TR)?|5(?:-TR)?|V)"
    r"|ICD-(?:10|11)"
    r"|OWASP\s+Top\s+10"
    r"|WCAG\s+2\.\d"
    r")\b",
    re.IGNORECASE,
)

_STANDARD_OR_MANUAL_RE = re.compile(
    r"\b(?:"
    r"Diagnostic\s+and\s+Statistical\s+Manual\s+of\s+Mental\s+Disorders"
    r"|International\s+Classification\s+of\s+Diseases"
    r")\b",
    re.IGNORECASE,
)


class WikidataOpenCitationsClient(BaseScholarClient):
    """Combined OpenCitations Meta/Index + Wikidata Knowledge Graph / WikiCite client."""

    OPENCITATIONS_META_BASE = "https://api.opencitations.net/meta/v1"
    OPENCITATIONS_BASE = "https://opencitations.net/index/api/v2"
    WIKIDATA_API_URL = "https://www.wikidata.org/w/api.php"
    name = "wikidata_opencitations"

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
            or "contact@citra.edu.vn"
        )
        self._headers = {
            "User-Agent": (
                f"EssayIntegrityChecker/1.0 "
                f"(https://github.com/iannwendy/essay-integrity-checker; mailto:{self.contact_email})"
            ),
            "Accept": "application/json",
        }

    @classmethod
    def extract_standard_or_manual_code(cls, citation: Citation) -> str | None:
        """Extract canonical technical standard or clinical manual identifier if present."""
        combined = " ".join(
            part
            for part in (
                citation.title or "",
                citation.venue or "",
                citation.raw_text or "",
            )
            if part
        )
        m_code = _STANDARD_CODE_RE.search(combined)
        if m_code:
            return re.sub(r"\s+", " ", m_code.group(0)).strip()
        m = _STANDARD_OR_MANUAL_RE.search(combined)
        if m:
            return re.sub(r"\s+", " ", m.group(0)).strip()
        return None

    @classmethod
    def is_knowledge_graph_target(cls, citation: Citation) -> bool:
        """Return True if citation references an international standard, clinical manual, or Wikidata entity."""
        if cls.extract_standard_or_manual_code(citation) is not None:
            return True
        combined = " ".join(
            part
            for part in (
                citation.title or "",
                citation.venue or "",
                citation.raw_text or "",
                citation.url or "",
            )
            if part
        )
        return bool(
            re.search(
                r"\b(?:wikidata\.org/wiki/Q\d+|american\s+psychiatric\s+association|international\s+organization\s+for\s+standardization)\b",
                combined,
                re.IGNORECASE,
            )
        )

    async def lookup(self, citation: Citation) -> SourceCandidate:
        """Lookup DOI via OpenCitations Index v2 first, then query Wikidata Knowledge Graph."""
        self._reset_http_telemetry()
        doi_norm = normalize_doi(citation.doi) if citation.doi else None
        if doi_norm:
            oc_cand = await self._lookup_opencitations_doi(doi_norm, citation=citation)
            if oc_cand and oc_cand.found:
                return oc_cand

        wd_cand = await self._lookup_wikidata(citation, doi_norm=doi_norm)
        if wd_cand and wd_cand.found:
            return wd_cand

        preview = (citation.title or doi_norm or citation.raw_text or "")[:60]
        return self._build_miss_or_error_candidate("Wikidata/OpenCitations", preview)

    async def _lookup_opencitations_doi(
        self,
        doi: str,
        citation: Citation | None = None,
    ) -> SourceCandidate | None:
        """Query OpenCitations Meta v1 (with Index v2 fallback) for `/metadata/doi:{doi}`."""
        encoded_doi = quote(doi, safe="/")
        data = await self._fetch_json(f"{self.OPENCITATIONS_META_BASE}/metadata/doi:{encoded_doi}")
        if (
            (not isinstance(data, list) or not data or not isinstance(data[0], dict))
            and self._last_status_code != 429
        ):
            data = await self._fetch_json(f"{self.OPENCITATIONS_BASE}/metadata/doi:{encoded_doi}")
        if not isinstance(data, list) or not data or not isinstance(data[0], dict):
            return None

        row = data[0]
        title = self._clean_text(row.get("title"))
        if not title:
            return None

        if (
            citation
            and citation.title
            and len(title_tokens(citation.title)) >= 3
            and title_similarity(citation.title, title) < 0.65
        ):
            return None

        authors = self._parse_opencitations_authors(str(row.get("author") or ""))

        pub_date = str(row.get("year") or row.get("pub_date") or "")
        yr_m = re.search(r"\b(19|20)\d{2}\b", pub_date)
        year = yr_m.group(0) if yr_m else None
        raw_venue = str(row.get("source_title") or row.get("venue") or "")
        venue = self._clean_text(re.sub(r"\[[^\]]*\]", "", raw_venue))
        cit_count = str(row.get("citation_count") or "").strip()

        ext_ids: dict[str, str] = {
            "doi": doi,
            "authority": "OpenCitations",
        }
        if cit_count and cit_count.isdigit():
            ext_ids["citation_count"] = cit_count

        return SourceCandidate(
            source_name=self.name,
            found=True,
            doi=doi,
            title=title,
            authors=authors,
            year=year,
            venue=venue,
            url=f"https://doi.org/{doi}",
            abstract=None,
            external_ids=ext_ids,
            confidence=0.96,
        )

    @staticmethod
    def _parse_opencitations_authors(raw_author_field: str) -> list[str]:
        """Parse OpenCitations author string: `'Family, Given [omid:... orcid:...]; ...'`."""
        authors: list[str] = []
        if not raw_author_field:
            return authors
        for segment in raw_author_field.split(";"):
            cleaned = re.sub(r"\[[^\]]*\]", "", segment).strip()
            if not cleaned:
                continue
            if "," in cleaned:
                parts = [p.strip() for p in cleaned.split(",", 1)]
                if len(parts) == 2 and parts[0] and parts[1]:
                    cleaned = f"{parts[1]} {parts[0]}"
            authors.append(cleaned)
        return authors

    async def _lookup_wikidata(
        self,
        citation: Citation,
        doi_norm: str | None = None,
    ) -> SourceCandidate | None:
        """Search Wikidata Knowledge Graph (`wbsearchentities` + `wbgetentities`)."""
        std_code = self.extract_standard_or_manual_code(citation)
        raw_title = (citation.title or "").strip()
        if not raw_title and citation.raw_text:
            raw_title = " ".join(title_tokens(citation.raw_text)[:12])

        search_queries: list[str] = []
        if std_code:
            # Strip year suffix like ':2022' from ISO/IEC 27001:2022 for broader entity match
            base_std = re.sub(r":\d{4}$", "", std_code).strip()
            search_queries.append(base_std)
        if raw_title and len(raw_title) >= 4:
            clean_t = re.sub(r"\s+", " ", raw_title).strip()[:180]
            if clean_t not in search_queries:
                search_queries.append(clean_t)

        if not search_queries:
            return None

        qids: list[str] = []
        for q in search_queries[:2]:
            params = {
                "action": "wbsearchentities",
                "search": q,
                "language": "en",
                "format": "json",
                "limit": 5,
            }
            search_res = await self._fetch_json(self.WIKIDATA_API_URL, params=params)
            if search_res is None and self._last_status_code == 429:
                break
            items = (search_res or {}).get("search") if isinstance(search_res, dict) else None
            if isinstance(items, list):
                for it in items:
                    if isinstance(it, dict) and it.get("id"):
                        qid = str(it["id"]).strip()
                        if qid not in qids:
                            qids.append(qid)
            if qids:
                break

        if not qids:
            return None

        ent_params = {
            "action": "wbgetentities",
            "ids": "|".join(qids[:5]),
            "props": "labels|descriptions|claims|aliases",
            "languages": "en|vi",
            "format": "json",
        }
        ent_data = await self._fetch_json(self.WIKIDATA_API_URL, params=ent_params)
        entities_map = (ent_data or {}).get("entities") if isinstance(ent_data, dict) else None
        if not isinstance(entities_map, dict) or not entities_map:
            return None

        candidates: list[SourceCandidate] = []
        for qid in qids[:5]:
            ent = entities_map.get(qid)
            if isinstance(ent, dict):
                cand = self._entity_to_candidate(qid, ent, citation=citation, std_code=std_code)
                if cand is not None:
                    candidates.append(cand)

        if not candidates:
            return None

        best_cand: SourceCandidate | None = None
        best_sim = -1.0
        best_rank = -1.0
        target_title = raw_title or std_code or ""
        cit_year = str(citation.year)[:4] if citation.year else None

        for cand in candidates:
            if not cand.title:
                continue
            if is_book_review_mismatch(target_title, citation.authors, cand.title, cand.authors):
                continue
            sim = title_similarity(target_title, cand.title)
            if cand.abstract:
                sim = max(sim, title_similarity(target_title, f"{cand.title}: {cand.abstract}"))
            auth_sim = (
                author_match_score(citation.authors, cand.authors)
                if citation.authors and cand.authors
                else 0.0
            )
            yr_bonus = (
                0.08
                if (cit_year and cand.year and str(cand.year)[:4] == cit_year)
                else (0.03 if cand.year else -0.05)
            )
            rank_score = sim * 0.80 + auth_sim * 0.15 + yr_bonus
            if rank_score > best_rank:
                best_rank = rank_score
                best_sim = sim
                best_cand = cand

        if best_cand is None or best_sim < MIN_TITLE_SIMILARITY:
            return None

        best_cand.found = True
        best_cand.confidence = round(min(0.95, max(0.65, best_sim)), 4)
        return best_cand

    def _entity_to_candidate(
        self,
        qid: str,
        ent: dict[str, Any],
        citation: Citation | None = None,
        std_code: str | None = None,
    ) -> SourceCandidate | None:
        labels = ent.get("labels") or {}
        label_val = (
            ((labels.get("en") or {}).get("value"))
            or ((labels.get("vi") or {}).get("value"))
        )
        descriptions = ent.get("descriptions") or {}
        desc_val = (
            ((descriptions.get("en") or {}).get("value"))
            or ((descriptions.get("vi") or {}).get("value"))
        )

        claims = ent.get("claims") or {}
        p1476_title = self._extract_claim_string(claims, "P1476")
        clean_label = self._clean_text(label_val)
        clean_p1476 = self._clean_text(p1476_title)

        # Combine Wikidata label (e.g., "ISO/IEC 27001") and official P1476 title
        # (e.g., "Information security, cybersecurity and privacy protection...") strictly from Wikidata
        if clean_label and clean_p1476 and clean_label.lower() not in clean_p1476.lower():
            title = f"{clean_label}: {clean_p1476}"
        else:
            title = clean_p1476 or clean_label
        if not title:
            return None

        # Collect official Wikidata aliases (e.g., full name of DSM-5 on Q3064664)
        aliases_map = ent.get("aliases") or {}
        alias_strings: list[str] = []
        for lang_key in ("en", "vi"):
            for al in aliases_map.get(lang_key) or []:
                if isinstance(al, dict) and al.get("value"):
                    alias_strings.append(str(al["value"]).strip())

        if not clean_p1476 and clean_label and alias_strings:
            longest_alias = max(alias_strings, key=len)
            if len(longest_alias) > len(clean_label) + 10 and clean_label.lower() not in longest_alias.lower():
                title = f"{clean_label}: {longest_alias}"

        # Extract DOI (P356)
        raw_doi = self._extract_claim_string(claims, "P356")
        doi = normalize_doi(raw_doi) if raw_doi else None

        # Extract publication/inception years strictly from Wikidata (P577, P571, and official aliases/descriptions)
        years = self._extract_claim_years(claims, ("P577", "P571"))
        for text_blob in [label_val, desc_val] + alias_strings:
            if text_blob:
                for ym in re.findall(r"\b(?:19|20)\d{2}\b", str(text_blob)):
                    years.add(ym)

        year: str | None = max(years) if years else None
        if citation and citation.year and years:
            cit_yr = str(citation.year)[:4]
            if cit_yr in years:
                year = cit_yr

        # Extract authors strictly from Wikidata P2093 (author name string)
        authors = self._extract_claim_strings(claims, "P2093")
        if not authors and clean_label:
            org_m = re.match(r"^(ISO(?:/IEC)?|NIST|IEEE|W3C|OWASP|IETF|WHO|UNESCO)\b", clean_label, re.IGNORECASE)
            if org_m:
                authors = [org_m.group(1).upper()]
        if not authors:
            authors = ["Wikidata Knowledge Graph"]

        ext_ids: dict[str, str] = {"wikidata_qid": qid}
        if doi:
            ext_ids["doi"] = doi
        if std_code:
            ext_ids["standard_code"] = std_code

        return SourceCandidate(
            source_name=self.name,
            found=False,
            doi=doi,
            title=title,
            authors=authors[:6],
            year=year,
            venue="Wikidata Knowledge Graph",
            url=f"https://www.wikidata.org/wiki/{qid}",
            abstract=self._clean_text(desc_val),
            external_ids=ext_ids,
        )

    @staticmethod
    def _extract_claim_string(claims: dict[str, Any], prop: str) -> str | None:
        for stmt in claims.get(prop) or []:
            if not isinstance(stmt, dict):
                continue
            dv = ((stmt.get("mainsnak") or {}).get("datavalue") or {}).get("value")
            if isinstance(dv, str) and dv.strip():
                return dv.strip()
            if isinstance(dv, dict) and dv.get("text"):
                return str(dv["text"]).strip()
        return None

    @staticmethod
    def _extract_claim_strings(claims: dict[str, Any], prop: str) -> list[str]:
        out: list[str] = []
        for stmt in claims.get(prop) or []:
            if not isinstance(stmt, dict):
                continue
            dv = ((stmt.get("mainsnak") or {}).get("datavalue") or {}).get("value")
            val_str = None
            if isinstance(dv, str):
                val_str = dv.strip()
            elif isinstance(dv, dict) and dv.get("text"):
                val_str = str(dv["text"]).strip()
            if val_str and val_str not in out:
                out.append(val_str)
        return out

    @staticmethod
    def _extract_claim_years(claims: dict[str, Any], props: tuple[str, ...]) -> set[str]:
        years: set[str] = set()
        for prop in props:
            for stmt in claims.get(prop) or []:
                if not isinstance(stmt, dict):
                    continue
                dv = ((stmt.get("mainsnak") or {}).get("datavalue") or {}).get("value")
                if isinstance(dv, dict) and dv.get("time"):
                    time_str = str(dv["time"]).lstrip("+-")
                    if len(time_str) >= 4 and time_str[:4].isdigit():
                        years.add(time_str[:4])
        return years

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
    ) -> Any:
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
            logger.debug(f"Wikidata/OpenCitations request failed for {url}: {exc}")
            return None
