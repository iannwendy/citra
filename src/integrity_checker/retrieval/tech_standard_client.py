"""IETF Datatracker RFC, PyPI, NPM Registry & GitHub Repository Verification Client.

Verifies technical standards and open-source software repositories/packages commonly cited
in Computer Science, Networking, Cybersecurity, AI, and Software Engineering theses:
1. IETF RFC Standards (`RFC 2616`, `RFC 6749`, `RFC 9110`, `10.17487/RFC*`) via
   RFC Editor JSON API & IETF Datatracker REST API v1.
2. Python Package Index (`pypi.org/project/{pkg}`) via PyPI JSON API.
3. NPM Package Registry (`npmjs.com/package/{pkg}` including `@scope/pkg`) via
   `https://registry.npmjs.org/{pkg}`.
4. GitHub Public Repositories (`github.com/{owner}/{repo}`) via GitHub REST API
   (`https://api.github.com/repos/{owner}/{repo}`) + `CITATION.cff` metadata enrichment.

Rate limit: 5 req/s (free public REST APIs, no API key required).
Docs:
- https://www.rfc-editor.org/
- https://datatracker.ietf.org/api/v1/
- https://warehouse.pypa.io/api-reference/json.html
- https://github.com/npm/registry/blob/main/docs/REGISTRY-API.md
- https://docs.github.com/en/rest/repos/repos
"""

from __future__ import annotations

import functools
import html
import json
import os
import re
from datetime import datetime
from pathlib import Path
from typing import Any
from urllib.parse import quote

import yaml

from integrity_checker.config import get_settings
from integrity_checker.logging import get_logger
from integrity_checker.models.citation import Citation
from integrity_checker.models.source import SourceCandidate
from integrity_checker.retrieval.base import BaseScholarClient
from integrity_checker.retrieval.http_pool import get_shared_http_client
from integrity_checker.retrieval.normalization import (
    author_match_score,
    normalize_doi,
    normalize_text,
    title_similarity,
)

logger = get_logger(__name__)

_RFC_PATTERN = re.compile(
    r"(?:\bRFC\s*[-#:]?\s*(?P<num>\d{3,5})\b|10\.17487/RFC(?P<doi_num>\d{3,5})\b|rfc-editor\.org/rfc/rfc(?P<url_num>\d{3,5})\b|datatracker\.ietf\.org/doc/(?:html/)?rfc(?P<dt_num>\d{3,5})\b)",
    re.IGNORECASE,
)

_PYPI_URL_PATTERN = re.compile(
    r"https?://(?:www\.)?pypi\.org/project/(?P<pkg>[A-Za-z0-9_.-]+)",
    re.IGNORECASE,
)

_NPM_URL_PATTERN = re.compile(
    r"https?://(?:www\.)?npmjs\.(?:com|org)/package/(?P<pkg>(?:@[A-Za-z0-9_.-]+/)?[A-Za-z0-9_.-]+)",
    re.IGNORECASE,
)

_GITHUB_URL_PATTERN = re.compile(
    r"https?://(?:www\.)?github\.com/(?P<owner>[A-Za-z0-9_.-]+)/(?P<repo>[A-Za-z0-9_.-]+)",
    re.IGNORECASE,
)

_TCVN_PATTERN = re.compile(
    r"\bTCVN\s+(?P<num>(?:ISO(?:/IEC)?\s+)?\d{3,5}(?:-\d+)*)\s*:\s*(?P<year>(?:19|20)\d{2})\b",
    re.IGNORECASE,
)

_QCVN_PATTERN = re.compile(
    r"\bQCVN\s+(?P<num>[A-ZĐ0-9]{1,6}(?:-[A-ZĐ0-9]{1,4})*)\s*:\s*(?P<year>(?:19|20)\d{2})\s*/\s*(?P<ministry>B[A-ZĐ]+)\b",
    re.IGNORECASE,
)

_VN_REGISTRY_PATH = (
    Path(__file__).resolve().parents[3] / "data" / "registries" / "vn_standards_and_textbooks.json"
)


@functools.lru_cache(maxsize=1)
def _load_vn_registry() -> dict[str, Any]:
    try:
        raw = json.loads(_VN_REGISTRY_PATH.read_text(encoding="utf-8"))
    except Exception as exc:  # noqa: BLE001
        logger.warning(f"Failed to load VN standards/textbooks registry at {_VN_REGISTRY_PATH}: {exc}")
        return {"ministry_codes": {}, "standards_by_code": {}, "textbooks": []}

    standards_by_code: dict[str, dict[str, Any]] = {}
    for item in raw.get("standards") or []:
        if isinstance(item, dict) and item.get("code"):
            norm_code = re.sub(r"\s+", " ", str(item["code"]).strip().upper())
            standards_by_code[norm_code] = item

    return {
        "ministry_codes": dict(raw.get("ministry_codes") or {}),
        "standards_by_code": standards_by_code,
        "textbooks": list(raw.get("textbooks") or []),
    }

_GITHUB_RESERVED_OWNERS = frozenset({
    "orgs",
    "topics",
    "trending",
    "settings",
    "login",
    "pricing",
    "features",
    "about",
    "marketplace",
    "sponsors",
    "events",
    "collections",
    "security",
    "enterprise",
    "readme",
    "search",
    "pulls",
    "issues",
    "notifications",
    "blog",
    "docs",
    "site",
    "customer-stories",
    "team",
    "join",
})


class TechStandardClient(BaseScholarClient):
    """IETF RFC, PyPI, NPM & GitHub Repository metadata client for CS / Software citations."""

    RFC_EDITOR_BASE = "https://www.rfc-editor.org/rfc"
    IETF_API_BASE = "https://datatracker.ietf.org/api/v1/doc/document"
    PYPI_BASE = "https://pypi.org/pypi"
    NPM_BASE = "https://registry.npmjs.org"
    GITHUB_API_BASE = "https://api.github.com/repos"
    GITHUB_RAW_BASE = "https://raw.githubusercontent.com"
    name = "tech_standard"

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
        self._headers = {
            "User-Agent": (
                f"EssayIntegrityChecker/1.0 (mailto:{self.contact_email})"
                if self.contact_email
                else "EssayIntegrityChecker/1.0"
            ),
            "Accept": "application/json",
        }

    @classmethod
    def extract_rfc_number(cls, citation: Citation) -> int | None:
        """Extract integer RFC number if citation references an IETF RFC standard."""
        combined = " ".join(
            part
            for part in (
                citation.doi or "",
                citation.url or "",
                citation.title or "",
                citation.venue or "",
                citation.raw_text or "",
            )
            if part
        )
        m = _RFC_PATTERN.search(combined)
        if not m:
            return None
        raw_num = m.group("num") or m.group("doi_num") or m.group("url_num") or m.group("dt_num")
        if raw_num and raw_num.isdigit():
            return int(raw_num)
        return None

    @classmethod
    def extract_pypi_package(cls, citation: Citation) -> str | None:
        """Extract PyPI package name if citation references pypi.org."""
        combined = " ".join(
            part
            for part in (citation.url or "", citation.raw_text or "", citation.venue or "")
            if part
        )
        m = _PYPI_URL_PATTERN.search(combined)
        if m:
            return m.group("pkg").strip().rstrip(".,;:)\"'/")
        return None

    @classmethod
    def extract_npm_package(cls, citation: Citation) -> str | None:
        """Extract NPM package name (including `@scope/pkg`) if citation references npmjs.com."""
        combined = " ".join(
            part
            for part in (citation.url or "", citation.raw_text or "", citation.venue or "")
            if part
        )
        m = _NPM_URL_PATTERN.search(combined)
        if m:
            return m.group("pkg").strip().rstrip(".,;:)\"'/")
        return None

    @classmethod
    def extract_github_repo(cls, citation: Citation) -> str | None:
        """Extract `owner/repo` slug if citation references a GitHub repository."""
        combined = " ".join(
            part
            for part in (citation.url or "", citation.raw_text or "", citation.venue or "")
            if part
        )
        for m in _GITHUB_URL_PATTERN.finditer(combined):
            owner = m.group("owner").strip().rstrip(".,;:)\"'/")
            repo = m.group("repo").strip().rstrip(".,;:)\"'/")
            if repo.lower().endswith(".git"):
                repo = repo[:-4]
            if (
                owner
                and repo
                and owner.lower() not in _GITHUB_RESERVED_OWNERS
                and repo.lower() not in ("issues", "pulls", "discussions", "wiki", "releases", "actions")
            ):
                return f"{owner}/{repo}"
        return None

    @classmethod
    def extract_vn_standard_code(
        cls, citation: Citation
    ) -> tuple[str, str, str, str | None] | None:
        """Extract ``(kind, canonical_code, year, ministry_code)`` for TCVN / QCVN standards."""
        combined = " ".join(
            part
            for part in (
                citation.title or "",
                citation.venue or "",
                citation.raw_text or "",
            )
            if part
        )
        m_qcvn = _QCVN_PATTERN.search(combined)
        if m_qcvn:
            num = re.sub(r"\s+", " ", m_qcvn.group("num").strip().upper())
            year = m_qcvn.group("year").strip()
            ministry = m_qcvn.group("ministry").strip().upper()
            return ("QCVN", f"QCVN {num}:{year}/{ministry}", year, ministry)

        m_tcvn = _TCVN_PATTERN.search(combined)
        if m_tcvn:
            num = re.sub(r"\s+", " ", m_tcvn.group("num").strip().upper())
            year = m_tcvn.group("year").strip()
            return ("TCVN", f"TCVN {num}:{year}", year, None)

        return None

    @classmethod
    def match_vn_textbook(cls, citation: Citation) -> dict[str, Any] | None:
        """Match a citation against the curated Vietnamese university textbook registry."""
        if citation.doi and str(citation.doi).strip():
            return None

        registry = _load_vn_registry()
        textbooks = registry.get("textbooks") or []
        if not textbooks:
            return None

        cit_title = (citation.title or "").strip()
        raw_text = (citation.raw_text or "").strip()
        if not cit_title and not raw_text:
            return None

        norm_cit_title = normalize_text(cit_title) if cit_title else ""
        norm_raw = normalize_text(raw_text)

        for entry in textbooks:
            all_titles = [entry.get("title") or "", *(entry.get("aliases") or [])]
            matched_title: str | None = None
            best_sim = 0.0
            for cand_t in all_titles:
                if not cand_t:
                    continue
                if cit_title:
                    sim = title_similarity(cit_title, cand_t)
                    if normalize_text(cand_t) == norm_cit_title:
                        sim = 1.0
                    if sim >= 0.85 and sim > best_sim:
                        best_sim = sim
                        matched_title = str(cand_t)
                else:
                    norm_cand = normalize_text(cand_t)
                    if len(norm_cand) >= 12 and norm_cand in norm_raw:
                        best_sim = 0.95
                        matched_title = str(cand_t)
                        break

            if matched_title is None:
                continue

            entry_authors = list(entry.get("authors") or [])
            if citation.authors:
                a_score = author_match_score(citation.authors, entry_authors)
                cit_auth_tokens = set(normalize_text(" ".join(str(a) for a in citation.authors)).split())
                entry_auth_tokens = set(normalize_text(" ".join(entry_authors)).split())
                shared_auth_tokens = len(cit_auth_tokens & entry_auth_tokens)
                if a_score < 0.50 and shared_auth_tokens < 2:
                    continue
                if len(cit_auth_tokens) >= 2 and len(entry_auth_tokens) >= 2 and shared_auth_tokens < 2:
                    continue
            else:
                has_author_in_raw = any(
                    normalize_text(a) in norm_raw for a in entry_authors if a
                )
                publishers = [entry.get("publisher") or "", *(entry.get("publisher_aliases") or [])]
                has_pub_in_raw = any(
                    normalize_text(p) in norm_raw for p in publishers if p
                )
                if not (has_author_in_raw or has_pub_in_raw):
                    continue

            return {**entry, "_matched_title": matched_title}

        return None

    @classmethod
    def has_tech_target(cls, citation: Citation) -> bool:
        """Return True if citation references an IETF RFC, PyPI/NPM package, GitHub repo,
        Vietnamese national standard (TCVN/QCVN), or curated VN university textbook."""
        return bool(
            cls.extract_rfc_number(citation) is not None
            or cls.extract_pypi_package(citation)
            or cls.extract_npm_package(citation)
            or cls.extract_github_repo(citation)
            or cls.extract_vn_standard_code(citation) is not None
            or cls.match_vn_textbook(citation) is not None
        )

    async def lookup(self, citation: Citation) -> SourceCandidate:
        """Lookup IETF RFC, TCVN/QCVN standard, VN textbook, PyPI/NPM package, or GitHub repo."""
        self._reset_http_telemetry()
        vn_std = self.extract_vn_standard_code(citation)
        if vn_std is not None:
            vn_std_cand = self._lookup_vn_standard(*vn_std, citation=citation)
            if vn_std_cand is not None:
                return vn_std_cand

        vn_tb = self.match_vn_textbook(citation)
        if vn_tb is not None:
            return self._build_vn_textbook_candidate(vn_tb, citation=citation)

        rfc_num = self.extract_rfc_number(citation)
        if rfc_num is not None:
            rfc_cand = await self._lookup_rfc(rfc_num, citation=citation)
            if rfc_cand and rfc_cand.found:
                return rfc_cand

        pypi_pkg = self.extract_pypi_package(citation)
        if pypi_pkg:
            pypi_cand = await self._lookup_pypi(pypi_pkg, citation=citation)
            if pypi_cand is not None:
                return pypi_cand

        npm_pkg = self.extract_npm_package(citation)
        if npm_pkg:
            npm_cand = await self._lookup_npm(npm_pkg, citation=citation)
            if npm_cand is not None:
                return npm_cand

        gh_repo = self.extract_github_repo(citation)
        if gh_repo:
            gh_cand = await self._lookup_github_repo(gh_repo, citation=citation)
            if gh_cand is not None:
                return gh_cand

        preview = (citation.title or citation.url or citation.raw_text or "")[:60]
        return self._build_miss_or_error_candidate("TechStandard", preview)

    def _lookup_vn_standard(
        self,
        kind: str,
        canonical_code: str,
        code_year: str,
        ministry_code: str | None,
        *,
        citation: Citation | None = None,
    ) -> SourceCandidate | None:
        registry = _load_vn_registry()
        standards_by_code = registry.get("standards_by_code") or {}
        ministry_codes = registry.get("ministry_codes") or {}

        exact = standards_by_code.get(canonical_code)
        if exact is not None:
            base_titles = [str(exact.get("title") or ""), *(str(a) for a in (exact.get("aliases") or []) if a)]
            title_variants: list[str] = []
            for bt in base_titles:
                if bt:
                    title_variants.extend([f"{canonical_code} {bt}", f"{canonical_code}: {bt}", bt])
            title_variants.append(canonical_code)

            chosen_title = f"{canonical_code}: {base_titles[0]}" if base_titles and base_titles[0] else canonical_code
            if citation and citation.title:
                best_variant = max(
                    title_variants,
                    key=lambda v: title_similarity(citation.title, v),
                )
                if title_similarity(citation.title, best_variant) >= 0.45:
                    chosen_title = best_variant

            authors = list(exact.get("authors") or []) or ["Bộ Khoa học và Công nghệ"]
            venue = str(
                exact.get("venue")
                or (
                    "Quy chuẩn Kỹ thuật Quốc gia Việt Nam (QCVN)"
                    if kind == "QCVN"
                    else "Tiêu chuẩn Quốc gia Việt Nam (TCVN)"
                )
            )
            return SourceCandidate(
                source_name=self.name,
                found=True,
                title=chosen_title,
                authors=authors,
                year=str(exact.get("year") or code_year),
                venue=venue,
                external_ids={
                    "vn_standard_code": canonical_code,
                    "standard_type": kind,
                },
                confidence=0.97,
                cached=True,
            )

        current_year = datetime.now().year
        if not code_year.isdigit() or not (1960 <= int(code_year) <= current_year):
            return None

        if kind == "QCVN":
            if not ministry_code or ministry_code not in ministry_codes:
                return None
            authors = [str(ministry_codes[ministry_code])]
            venue = "Quy chuẩn Kỹ thuật Quốc gia Việt Nam (QCVN)"
        else:
            authors = ["Bộ Khoa học và Công nghệ"]
            venue = "Tiêu chuẩn Quốc gia Việt Nam (TCVN)"

        cit_t = (citation.title or "").strip() if citation else ""
        chosen_title = (
            cit_t
            if (cit_t and len(cit_t) >= 8 and canonical_code.split(":")[0].lower() in cit_t.lower())
            else canonical_code
        )
        return SourceCandidate(
            source_name=self.name,
            found=True,
            title=chosen_title,
            authors=authors,
            year=code_year,
            venue=venue,
            external_ids={
                "vn_standard_code": canonical_code,
                "standard_type": kind,
            },
            confidence=0.93,
            cached=True,
        )

    def _build_vn_textbook_candidate(
        self,
        entry: dict[str, Any],
        *,
        citation: Citation | None = None,
    ) -> SourceCandidate:
        title = str(entry.get("_matched_title") or entry.get("title") or "").strip()
        authors = [str(a) for a in (entry.get("authors") or []) if a]
        publisher = str(entry.get("publisher") or "NXB Đại học Việt Nam").strip()
        known_years = [
            int(y)
            for y in (entry.get("years") or [entry.get("year")])
            if y and str(y).isdigit()
        ]
        default_year = str(entry.get("year") or (max(known_years) if known_years else ""))
        resolved_year = default_year
        if citation and citation.year:
            m_yr = re.search(r"\b((?:19|20)\d{2})\b", str(citation.year))
            if m_yr and known_years:
                cit_yr_int = int(m_yr.group(1))
                if min(known_years) - 1 <= cit_yr_int <= max(known_years) + 2:
                    resolved_year = str(cit_yr_int)

        return SourceCandidate(
            source_name=self.name,
            found=True,
            title=title,
            authors=authors,
            year=resolved_year or None,
            venue=publisher,
            external_ids={
                "vn_textbook_id": str(entry.get("id") or title),
                "publisher": publisher,
            },
            confidence=0.95,
            cached=True,
        )

    async def _lookup_rfc(
        self,
        rfc_num: int,
        citation: Citation | None = None,
    ) -> SourceCandidate | None:
        """Lookup RFC via RFC Editor JSON API first, then IETF Datatracker API."""
        url = f"{self.RFC_EDITOR_BASE}/rfc{rfc_num}.json"
        data = await self._fetch_json(url)
        if isinstance(data, dict) and (data.get("title") or data.get("doc_id")):
            title = self._clean_text(data.get("title"))
            if (
                title
                and citation
                and citation.title
                and re.search(rf"\bRFC\s*[-#:]?\s*{rfc_num}\b", citation.title, re.IGNORECASE)
                and not re.search(rf"\bRFC\s*[-#:]?\s*{rfc_num}\b", title, re.IGNORECASE)
            ):
                title = f"RFC {rfc_num}: {title}"
            authors = [
                re.sub(r",?\s*Ed\.?$", "", str(a).strip(), flags=re.IGNORECASE).strip()
                for a in (data.get("authors") or [])
                if str(a).strip()
            ] or ["IETF"]
            pub_date = str(data.get("pub_date") or "")
            yr_m = re.search(r"\b(19|20)\d{2}\b", pub_date)
            year = yr_m.group(0) if yr_m else None
            abstract = self._clean_text(data.get("abstract"))
            doi = normalize_doi(str(data.get("doi") or f"10.17487/rfc{rfc_num}"))

            ext_ids: dict[str, str] = {
                "rfc_number": str(rfc_num),
                "doi": doi or f"10.17487/rfc{rfc_num}",
            }
            obsoleted = data.get("obsoleted_by") or []
            if isinstance(obsoleted, list) and obsoleted:
                ext_ids["obsoleted_by"] = ", ".join(str(x).strip() for x in obsoleted if x)

            return SourceCandidate(
                source_name=self.name,
                found=True,
                doi=doi,
                title=title,
                authors=authors,
                year=year,
                venue=f"IETF RFC {rfc_num}",
                url=f"https://www.rfc-editor.org/rfc/rfc{rfc_num}",
                abstract=abstract,
                external_ids=ext_ids,
                confidence=0.98,
            )

        # Fallback: IETF Datatracker REST API v1
        dt_url = f"{self.IETF_API_BASE}/rfc{rfc_num}/?format=json"
        dt_data = await self._fetch_json(dt_url)
        if isinstance(dt_data, dict) and dt_data.get("title"):
            title = self._clean_text(dt_data.get("title"))
            if (
                title
                and citation
                and citation.title
                and re.search(rf"\bRFC\s*[-#:]?\s*{rfc_num}\b", citation.title, re.IGNORECASE)
                and not re.search(rf"\bRFC\s*[-#:]?\s*{rfc_num}\b", title, re.IGNORECASE)
            ):
                title = f"RFC {rfc_num}: {title}"
            time_str = str(dt_data.get("time") or "")
            year = time_str[:4] if len(time_str) >= 4 and time_str[:4].isdigit() else None
            abstract = self._clean_text(dt_data.get("abstract"))
            doi = f"10.17487/rfc{rfc_num}"
            return SourceCandidate(
                source_name=self.name,
                found=True,
                doi=doi,
                title=title,
                authors=["IETF"],
                year=year,
                venue=f"IETF RFC {rfc_num}",
                url=f"https://datatracker.ietf.org/doc/html/rfc{rfc_num}",
                abstract=abstract,
                external_ids={"rfc_number": str(rfc_num), "doi": doi},
                confidence=0.95,
            )
        return None

    async def _lookup_pypi(
        self,
        pkg_name: str,
        citation: Citation | None = None,
    ) -> SourceCandidate | None:
        url = f"{self.PYPI_BASE}/{quote(pkg_name, safe='')}/json"
        data = await self._fetch_json(url)
        if not isinstance(data, dict) or not isinstance(data.get("info"), dict):
            if self._last_status_code == 404:
                return SourceCandidate(
                    source_name=self.name,
                    found=False,
                    error=f"TechStandard: PyPI package '{pkg_name}' does not exist (404)",
                    external_ids={"pypi_status": "nonexistent"},
                )
            return None

        info = data["info"]
        name = str(info.get("name") or pkg_name).strip()
        summary = self._clean_text(info.get("summary"))
        full_api_title = f"{name}: {summary}" if summary else name
        title = full_api_title
        if citation and citation.title and summary:
            if title_similarity(citation.title, name) > title_similarity(citation.title, full_api_title):
                title = name

        authors: list[str] = []
        for field_name in ("author", "maintainer"):
            val = str(info.get(field_name) or "").strip()
            if val and val not in authors:
                authors.append(val)
        for email_field in ("author_email", "maintainer_email"):
            raw_em = str(info.get(email_field) or "").strip()
            if raw_em:
                for part in raw_em.split(","):
                    clean_name = re.sub(r"<[^>]+>", "", part).strip().strip("\"'")
                    if clean_name and "@" not in clean_name and clean_name not in authors:
                        authors.append(clean_name)
        if not authors:
            authors = ["PyPI Contributors"]

        # Determine release years (both latest and historical releases)
        release_years: set[str] = set()
        urls_list = data.get("urls") or []
        if isinstance(urls_list, list) and urls_list:
            upload_time = str(urls_list[0].get("upload_time_iso_8601") or urls_list[0].get("upload_time") or "")
            if len(upload_time) >= 4 and upload_time[:4].isdigit():
                release_years.add(upload_time[:4])
        releases_map = data.get("releases") or {}
        if isinstance(releases_map, dict):
            for rel_files in releases_map.values():
                if isinstance(rel_files, list):
                    for rf in rel_files[:1]:
                        if isinstance(rf, dict):
                            ut = str(rf.get("upload_time_iso_8601") or rf.get("upload_time") or "")
                            if len(ut) >= 4 and ut[:4].isdigit():
                                release_years.add(ut[:4])

        year: str | None = max(release_years) if release_years else None
        if citation and citation.year:
            cit_yr = str(citation.year)[:4]
            if cit_yr in release_years or (
                release_years and cit_yr.isdigit() and min(release_years) <= cit_yr <= max(release_years)
            ):
                year = cit_yr

        pkg_url = str(info.get("package_url") or info.get("project_url") or f"https://pypi.org/project/{name}/")
        return SourceCandidate(
            source_name=self.name,
            found=True,
            doi=None,
            title=title,
            authors=authors,
            year=year,
            venue="Python Package Index (PyPI)",
            url=pkg_url,
            abstract=summary,
            external_ids={"pypi_package": name},
            confidence=0.95,
        )

    async def _lookup_npm(
        self,
        pkg_name: str,
        citation: Citation | None = None,
    ) -> SourceCandidate | None:
        """Lookup NPM package metadata via `https://registry.npmjs.org/{pkg}`."""
        url = f"{self.NPM_BASE}/{quote(pkg_name, safe='@/')}"
        data = await self._fetch_json(url)
        if not isinstance(data, dict) or not (data.get("name") or data.get("_id")):
            if self._last_status_code == 404:
                return SourceCandidate(
                    source_name=self.name,
                    found=False,
                    error=f"TechStandard: NPM package '{pkg_name}' does not exist (404)",
                    external_ids={"npm_status": "nonexistent"},
                )
            return None

        name = str(data.get("name") or data.get("_id") or pkg_name).strip()
        description = self._clean_text(data.get("description"))
        full_api_title = f"{name}: {description}" if description else name
        title = full_api_title
        if citation and citation.title and description:
            if title_similarity(citation.title, name) > title_similarity(citation.title, full_api_title):
                title = name

        authors: list[str] = []
        raw_author = data.get("author")
        if isinstance(raw_author, dict) and raw_author.get("name"):
            authors.append(str(raw_author["name"]).strip())
        elif isinstance(raw_author, str) and raw_author.strip():
            clean_a = re.sub(r"<[^>]+>|\([^)]+\)", "", raw_author).strip()
            if clean_a:
                authors.append(clean_a)

        for maint in data.get("maintainers") or []:
            if isinstance(maint, dict) and maint.get("name"):
                m_name = str(maint["name"]).strip()
                if m_name and m_name not in authors:
                    authors.append(m_name)
        if not authors:
            authors = ["NPM Contributors"]

        release_years: set[str] = set()
        time_map = data.get("time") or {}
        if isinstance(time_map, dict):
            for ts_val in time_map.values():
                ts_str = str(ts_val or "")
                if len(ts_str) >= 4 and ts_str[:4].isdigit():
                    release_years.add(ts_str[:4])

        year: str | None = max(release_years) if release_years else None
        if citation and citation.year:
            cit_yr = str(citation.year)[:4]
            if cit_yr.isdigit() and release_years:
                min_yr = min(release_years)
                max_yr = max(release_years)
                if min_yr <= cit_yr <= max_yr:
                    year = cit_yr
                elif int(cit_yr) < int(min_yr):
                    year = min_yr

        homepage = str(data.get("homepage") or f"https://www.npmjs.com/package/{name}")
        return SourceCandidate(
            source_name=self.name,
            found=True,
            doi=None,
            title=title,
            authors=authors[:6],
            year=year,
            venue="NPM Package Registry (npmjs.com)",
            url=f"https://www.npmjs.com/package/{name}" if "npmjs.com" not in homepage else homepage,
            abstract=description,
            external_ids={"npm_package": name},
            confidence=0.95,
        )

    async def _lookup_github_repo(
        self,
        repo_slug: str,
        citation: Citation | None = None,
    ) -> SourceCandidate | None:
        """Verify GitHub repository via GitHub REST API + optional `CITATION.cff` enrichment."""
        headers = dict(self._headers)
        headers["Accept"] = "application/vnd.github+json, application/json"
        gh_token = os.getenv("GITHUB_TOKEN", "").strip()
        if gh_token:
            headers["Authorization"] = f"Bearer {gh_token}"

        api_url = f"{self.GITHUB_API_BASE}/{repo_slug}"
        data = await self._fetch_json(api_url, extra_headers=headers)
        status_code = self._last_status_code

        # Also attempt CITATION.cff fetch (helps enrich academic authors/DOI and works even if REST API is rate-limited)
        cff_meta = await self._fetch_github_citation_cff(repo_slug)

        if not isinstance(data, dict) or not (data.get("full_name") or data.get("name")):
            if status_code == 404:
                return SourceCandidate(
                    source_name=self.name,
                    found=False,
                    error=f"TechStandard: GitHub repository '{repo_slug}' does not exist (404)",
                    external_ids={"github_status": "nonexistent"},
                )
            if cff_meta:
                return self._build_github_candidate_from_cff(repo_slug, cff_meta, citation=citation)
            return None

        full_name = str(data.get("full_name") or repo_slug).strip()
        repo_name = str(data.get("name") or full_name.split("/")[-1]).strip()
        owner_obj = data.get("owner") or {}
        owner_login = str(owner_obj.get("login") if isinstance(owner_obj, dict) else full_name.split("/")[0]).strip()
        repo_desc = self._clean_text(data.get("description"))
        cff_abs = cff_meta.get("abstract") if cff_meta else None
        description = cff_abs or repo_desc

        # Build title strictly from CITATION.cff or GitHub repository metadata
        cff_title = cff_meta.get("title") if cff_meta else None
        api_title_candidates = [
            t
            for t in (
                cff_title,
                f"{repo_name}: {repo_desc}" if repo_desc else None,
                f"{full_name}: {repo_desc}" if repo_desc else None,
                repo_name,
                full_name,
            )
            if t
        ]
        title = api_title_candidates[0] if api_title_candidates else full_name
        if citation and citation.title and api_title_candidates:
            title = max(
                api_title_candidates,
                key=lambda cand_t: title_similarity(citation.title, cand_t),
            )

        # Build authors list strictly from CITATION.cff authors + GitHub repository owner
        authors: list[str] = []
        if cff_meta and cff_meta.get("authors"):
            authors.extend(cff_meta["authors"])
        if owner_login and owner_login not in authors:
            authors.append(owner_login)
        if not authors:
            authors = [owner_login or "GitHub Contributors"]

        # Active repository years from created_at, updated_at, pushed_at, and CITATION.cff date-released
        active_years: set[str] = set()
        for dt_field in ("created_at", "updated_at", "pushed_at"):
            dt_val = str(data.get(dt_field) or "")
            if len(dt_val) >= 4 and dt_val[:4].isdigit():
                active_years.add(dt_val[:4])
        if cff_meta and cff_meta.get("year"):
            active_years.add(str(cff_meta["year"])[:4])

        created_yr = str(data.get("created_at") or "")[:4]
        year: str | None = (cff_meta.get("year") if cff_meta else None) or (max(active_years) if active_years else None)
        if citation and citation.year:
            cit_yr = str(citation.year)[:4]
            if cit_yr.isdigit() and active_years:
                min_yr = min(active_years)
                max_yr = max(active_years)
                if int(min_yr) - 1 <= int(cit_yr) <= int(max_yr) + 1:
                    year = cit_yr
                elif created_yr.isdigit():
                    year = created_yr

        doi = normalize_doi(cff_meta.get("doi")) if (cff_meta and cff_meta.get("doi")) else None
        ext_ids: dict[str, str] = {"github_repo": full_name}
        if doi:
            ext_ids["doi"] = doi
        if data.get("stargazers_count") is not None:
            ext_ids["stars"] = str(data.get("stargazers_count"))

        html_url = str(data.get("html_url") or f"https://github.com/{full_name}")
        return SourceCandidate(
            source_name=self.name,
            found=True,
            doi=doi,
            title=title,
            authors=authors[:6],
            year=year,
            venue="GitHub Repository",
            url=html_url,
            abstract=description,
            external_ids=ext_ids,
            confidence=0.95,
        )

    async def _fetch_github_citation_cff(self, repo_slug: str) -> dict[str, Any] | None:
        """Fetch and parse `CITATION.cff` from `raw.githubusercontent.com/{owner}/{repo}/HEAD/CITATION.cff`."""
        cff_url = f"{self.GITHUB_RAW_BASE}/{repo_slug}/HEAD/CITATION.cff"
        try:
            client = get_shared_http_client(follow_redirects=True)
            resp = await client.get(
                cff_url,
                headers={"User-Agent": self._headers["User-Agent"]},
                timeout=min(self.timeout, 3.5),
            )
            if resp.status_code != 200 or not resp.text:
                return None
            parsed = yaml.safe_load(resp.text)
            if not isinstance(parsed, dict):
                return None

            title = self._clean_text(parsed.get("title"))
            abstract = self._clean_text(parsed.get("abstract") or parsed.get("message"))
            doi = normalize_doi(str(parsed.get("doi") or ""))
            date_rel = str(parsed.get("date-released") or "")
            yr_m = re.search(r"\b(19|20)\d{2}\b", date_rel)
            year = yr_m.group(0) if yr_m else None

            authors: list[str] = []
            for a in parsed.get("authors") or []:
                if isinstance(a, dict):
                    given = str(a.get("given-names") or "").strip()
                    family = str(a.get("family-names") or "").strip()
                    name_str = str(a.get("name") or "").strip()
                    if given and family:
                        authors.append(f"{given} {family}")
                    elif family:
                        authors.append(family)
                    elif name_str:
                        authors.append(name_str)

            return {
                "title": title,
                "abstract": abstract,
                "doi": doi,
                "year": year,
                "authors": authors,
            }
        except Exception as exc:  # noqa: BLE001
            logger.debug(f"GitHub CITATION.cff lookup skipped for {repo_slug}: {exc}")
            return None

    def _build_github_candidate_from_cff(
        self,
        repo_slug: str,
        cff_meta: dict[str, Any],
        citation: Citation | None = None,
    ) -> SourceCandidate:
        title = cff_meta.get("title") or repo_slug
        authors = cff_meta.get("authors") or [repo_slug.split("/")[0]]
        year = cff_meta.get("year")
        doi = cff_meta.get("doi")
        ext_ids: dict[str, str] = {"github_repo": repo_slug}
        if doi:
            ext_ids["doi"] = doi
        return SourceCandidate(
            source_name=self.name,
            found=True,
            doi=doi,
            title=title,
            authors=authors,
            year=year,
            venue="GitHub Repository (CITATION.cff)",
            url=f"https://github.com/{repo_slug}",
            abstract=cff_meta.get("abstract"),
            external_ids=ext_ids,
            confidence=0.95,
        )

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
        extra_headers: dict[str, str] | None = None,
    ) -> dict[str, Any] | None:
        req_headers = extra_headers or self._headers
        try:
            client = get_shared_http_client(follow_redirects=True)
            resp = await client.get(
                url,
                headers=req_headers,
                timeout=self.timeout,
            )
            self._record_http_response(resp)
            if resp.status_code != 200:
                return None
            return resp.json()
        except Exception as exc:  # noqa: BLE001
            self._record_transport_error(exc)
            logger.debug(f"TechStandard request failed for {url}: {exc}")
            return None
