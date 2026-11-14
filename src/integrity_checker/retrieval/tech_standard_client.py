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
import unicodedata
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

_REPO_ROOT = Path(__file__).resolve().parents[3]
_VN_REGISTRY_PATH = _REPO_ROOT / "data" / "registries" / "vn_standards_and_textbooks.json"
_VN_REGISTRY_FALLBACK_PATH = (
    _REPO_ROOT / "configs" / "registries" / "vn_standards_and_textbooks.json"
)
_VN_REGISTRY_CANDIDATE_PATHS: tuple[Path, ...] = (
    _VN_REGISTRY_PATH,
    _VN_REGISTRY_FALLBACK_PATH,
)


@functools.lru_cache(maxsize=1)
def _load_vn_registry() -> dict[str, Any]:
    raw: dict[str, Any] | None = None
    last_exc: Exception | None = None
    for cand_path in _VN_REGISTRY_CANDIDATE_PATHS:
        try:
            if not cand_path.is_file():
                continue
            raw = json.loads(cand_path.read_text(encoding="utf-8"))
            break
        except Exception as exc:  # noqa: BLE001
            last_exc = exc

    if raw is None:
        logger.warning(
            f"Failed to load VN standards/textbooks registry from {_VN_REGISTRY_CANDIDATE_PATHS}: {last_exc or 'file not found'}"
        )
        return {
            "ministry_codes": {},
            "standards_by_code": {},
            "standards_by_base_code": {},
            "textbooks": [],
        }

    standards_by_code: dict[str, dict[str, Any]] = {}
    standards_by_base_code: dict[str, list[dict[str, Any]]] = {}
    for item in raw.get("standards") or []:
        if isinstance(item, dict) and item.get("code"):
            norm_code = re.sub(r"\s+", " ", str(item["code"]).strip().upper())
            standards_by_code[norm_code] = item
            if ":" in norm_code:
                prefix, rest = norm_code.split(":", 1)
                prefix_clean = prefix.strip()
                if "/" in rest:
                    # QCVN sequence numbers are scoped per ministry (e.g. QCVN 01/BXD vs QCVN 01/BCT);
                    # never index QCVN entries under a ministry-agnostic key like "QCVN 01".
                    _, min_part = rest.split("/", 1)
                    base_with_ministry = f"{prefix_clean}/{min_part.strip()}"
                    standards_by_base_code.setdefault(base_with_ministry, []).append(item)
                else:
                    standards_by_base_code.setdefault(prefix_clean, []).append(item)

    return {
        "ministry_codes": dict(raw.get("ministry_codes") or {}),
        "standards_by_code": standards_by_code,
        "standards_by_base_code": standards_by_base_code,
        "textbooks": list(raw.get("textbooks") or []),
    }


_VN_STD_CODE_STRIP_RE = re.compile(
    r"\b(?:"
    r"QCVN\s+[A-ZĐ0-9]{1,6}(?:-[A-ZĐ0-9]{1,4})*(?:\s*:\s*(?:19|20)\d{2}(?:\s*/\s*B[A-ZĐ]+)?)?"
    r"|TCVN\s+(?:ISO(?:/IEC)?\s+)?\d{3,5}(?:-\d+)*(?:\s*:\s*(?:19|20)\d{2})?"
    r")\b",
    re.IGNORECASE,
)

_VN_STD_FOLDED_BOILERPLATE_PREFIX_RE = re.compile(
    r"^[\s:.,;()\-–—]*(?:"
    r"quy\s+chuan\s+ky\s+thuat\s+quoc\s+gia(?:\s+viet\s+nam)?(?:\s*\(\s*qcvn\s*\))?"
    r"|tieu\s+chuan\s+quoc\s+gia(?:\s+viet\s+nam)?(?:\s*\(\s*tcvn\s*\))?"
    r"|tieu\s+chuan\s+viet\s+nam(?:\s*\(\s*tcvn\s*\))?"
    r"|national\s+technical\s+regulation"
    r"|vietnam\s+national\s+standard"
    r")\b",
    re.IGNORECASE,
)

_VN_STD_FOLDED_LEADING_CONNECTOR_RE = re.compile(
    r"^[\s:.,;()\-–—]*(?:ve|on)\b",
    re.IGNORECASE,
)

_VN_STD_FOLDED_TAIL_RE = re.compile(
    r"(?:\b(?:truy\s+cap|retrieved|available\s+at|co\s+tai)\b.*$"
    r"|https?://\S+.*$"
    r"|(?:[.;]\s*|\s+[-–—]\s+)(?:(?:ha\s+noi|tp\.?\s*hcm|tp\.?\s*ho\s+chi\s+minh)\s*[:.,;-]*\s*)?(?:nxb|nha\s+xuat\s+ban)\b.*$"
    r"|[.,;]\s*(?:tieu\s+chuan\s+quoc\s+gia\s+viet\s+nam\s*\(|quy\s+chuan\s+ky\s+thuat\s+quoc\s+gia\s+viet\s+nam\s*\().*$"
    r"|[.,;]\s*(?:19|20)\d{2}[a-z]?\s*\.?$)",
    re.IGNORECASE,
)

_VN_STD_FOLDED_PURE_PUBLISHER_RE = re.compile(
    r"^[\s:.,;()\-–—]*(?:"
    r"(?:(?:ha\s+noi|tp\.?\s*hcm|tp\.?\s*ho\s+chi\s+minh|viet\s+nam)[\s:.,;\-–—]+)?(?:nxb|nha\s+xuat\s+ban)\b.*$"
    r"|(?:ha\s+noi|tp\.?\s*hcm|tp\.?\s*ho\s+chi\s+minh)(?:[\s:.,;\-–—]+(?:19|20)\d{2}[a-z]?)?$"
    r"|(?:19|20)\d{2}[a-z]?$"
    r")",
    re.IGNORECASE,
)

_VN_STD_PRE_CODE_YEAR_HEADER_RE = re.compile(
    r"^[^\(\n]{1,140}?\(\s*(?:19|20)\d{2}[a-z]?\s*\)\s*[.,:;–—-]*\s*"
    r"|^[^\n]{1,120}?[.,;]\s*(?:19|20)\d{2}[a-z]?\s*[.,:;–—-]+\s*",
    re.IGNORECASE,
)

_VN_STD_SUBJECT_STOPWORDS = frozenset({
    "ve", "va", "cua", "doi", "voi", "cac", "mot", "nhung", "la", "duoc",
    "cho", "trong", "theo", "tai", "phan", "yeu", "cau", "quy", "dinh", "chung",
    "the", "of", "in", "and", "for", "on", "to", "with", "at", "by", "from",
})

_VN_EXTRA_STANDARD_ISSUERS = (
    "bo khoa hoc cong nghe va moi truong",
    "vien khoa hoc cong nghe xay dung",
    "tong cuc tieu chuan do luong chat luong",
)


def _fold_vn_ascii(text: str, *, keep_punct: bool = False) -> str:
    """Fold Vietnamese diacritics (including ``đ/Đ -> d``) to clean lowercase ASCII."""
    if not text:
        return ""
    replaced = str(text).replace("đ", "d").replace("Đ", "D")
    decomposed = unicodedata.normalize("NFD", replaced)
    ascii_chars = "".join(
        ch for ch in decomposed if unicodedata.category(ch) != "Mn"
    ).lower()
    if keep_punct:
        return re.sub(r"\s+", " ", ascii_chars).strip()
    cleaned = re.sub(r"[^a-z0-9\s]+", " ", ascii_chars)
    return re.sub(r"\s+", " ", cleaned).strip()


def _vn_standard_base_key(
    kind: str,
    canonical_code: str,
    ministry_code: str | None,
) -> str | None:
    prefix = canonical_code.split(":", 1)[0].strip()
    if kind == "QCVN":
        if not ministry_code:
            return None
        return f"{prefix}/{ministry_code.strip().upper()}"
    return prefix


def _strip_vn_std_subject_fragment(
    fragment: str | None,
    *,
    is_venue_or_raw: bool = False,
) -> str:
    if not fragment or not str(fragment).strip():
        return ""
    stripped_code = _VN_STD_CODE_STRIP_RE.sub(" ", str(fragment))
    folded = _fold_vn_ascii(stripped_code, keep_punct=True).strip(" :.,;()-–—[]{}")
    if not folded:
        return ""
    if is_venue_or_raw:
        folded = _VN_STD_FOLDED_TAIL_RE.sub("", folded).strip(" :.,;()-–—[]{}")
        if not folded or _VN_STD_FOLDED_PURE_PUBLISHER_RE.match(folded):
            return ""
    for _ in range(4):
        next_s = _VN_STD_FOLDED_BOILERPLATE_PREFIX_RE.sub("", folded).strip()
        next_s = _VN_STD_FOLDED_LEADING_CONNECTOR_RE.sub("", next_s).strip(" :.,;()-–—[]{}")
        if next_s == folded:
            break
        folded = next_s
    if not folded or (is_venue_or_raw and _VN_STD_FOLDED_PURE_PUBLISHER_RE.match(folded)):
        return ""
    cleaned = _fold_vn_ascii(folded, keep_punct=False)
    return cleaned if len(cleaned) >= 4 else ""


def _extract_pre_code_subject(
    before_raw: str,
    *,
    authors: list[Any] | None = None,
) -> str:
    s = re.sub(r"^\s*(?:\[\d+\]|\(\d+\)|\d+[.)])\s*", "", str(before_raw or ""))
    s = re.sub(r"[\s(\[{:.,;\-–—]+$", "", s)
    if not s:
        return ""
    m_yr_hdr = _VN_STD_PRE_CODE_YEAR_HEADER_RE.match(s)
    if m_yr_hdr:
        s = s[m_yr_hdr.end() :].strip()
    else:
        folded_before = _fold_vn_ascii(s, keep_punct=True)
        issuer_phrases: list[str] = []
        for a in authors or []:
            raw_a = getattr(a, "raw", None) or str(a)
            folded_a = _fold_vn_ascii(raw_a, keep_punct=False)
            if len(folded_a) >= 3:
                issuer_phrases.append(folded_a)
        for m_name in (_load_vn_registry().get("ministry_codes") or {}).values():
            folded_m = _fold_vn_ascii(str(m_name), keep_punct=False)
            if folded_m:
                issuer_phrases.append(folded_m)
        issuer_phrases.extend(_VN_EXTRA_STANDARD_ISSUERS)

        for phrase in sorted(set(issuer_phrases), key=len, reverse=True):
            pat = r"^" + r"[\s,;-]+".join(re.escape(tok) for tok in phrase.split()) + r"(?:$|[.,:;–—-]+)\s*"
            new_fb = re.sub(pat, "", folded_before, count=1, flags=re.IGNORECASE).strip()
            if new_fb != folded_before:
                folded_before = new_fb
                break
        s = folded_before
    return _strip_vn_std_subject_fragment(s, is_venue_or_raw=True)


def extract_vn_standard_core_subject(
    title: str | None,
    *,
    venue: str | None = None,
    raw_text: str | None = None,
    authors: list[Any] | None = None,
) -> str:
    """Extract the ASCII-folded core technical subject of a ``TCVN``/``QCVN`` citation after
    stripping standard codes and regulatory boilerplate across ``title``, ``venue``, and ``raw_text``."""
    if title and str(title).strip():
        from_title = _strip_vn_std_subject_fragment(title, is_venue_or_raw=False)
        if from_title:
            return from_title

    if venue and str(venue).strip():
        from_venue = _strip_vn_std_subject_fragment(venue, is_venue_or_raw=True)
        if from_venue:
            return from_venue

    if raw_text and str(raw_text).strip():
        raw_str = str(raw_text).strip()
        m_code = _QCVN_PATTERN.search(raw_str) or _TCVN_PATTERN.search(raw_str)
        if m_code:
            from_after = _strip_vn_std_subject_fragment(
                raw_str[m_code.end() :],
                is_venue_or_raw=True,
            )
            if from_after:
                return from_after
            from_before = _extract_pre_code_subject(
                raw_str[: m_code.start()],
                authors=authors,
            )
            if from_before:
                return from_before

    return ""


def compute_vn_standard_core_subject_similarity(
    cited_subject: str | None,
    official_subjects: list[str],
) -> float:
    """Return best ``[0, 1]`` similarity between ``cited_subject`` and ``official_subjects`` on
    ASCII-folded representations with Vietnamese stopword removal and strict subset containment."""
    c_fold = _fold_vn_ascii(cited_subject or "")
    if not c_fold:
        return 1.0
    valid_official = [_fold_vn_ascii(s) for s in official_subjects if s and _fold_vn_ascii(s)]
    if not valid_official:
        return 1.0

    c_toks = {
        t
        for t in c_fold.split()
        if (len(t) >= 2 or t.isdigit()) and t not in _VN_STD_SUBJECT_STOPWORDS
    }
    best = 0.0
    for o_fold in valid_official:
        seq_sim = title_similarity(c_fold, o_fold)
        o_toks = {
            t
            for t in o_fold.split()
            if (len(t) >= 2 or t.isdigit()) and t not in _VN_STD_SUBJECT_STOPWORDS
        }
        if c_toks and o_toks:
            inter = len(c_toks & o_toks)
            union = len(c_toks | o_toks)
            jacc = inter / union if union else 0.0
            cited_precision = inter / len(c_toks)
            official_recall = inter / len(o_toks)
            containment = inter / min(len(c_toks), len(o_toks))
            eligible_for_subset = cited_precision >= 0.60 and (
                len(c_toks) >= 3 or official_recall >= 0.60
            )
            if eligible_for_subset:
                pair_sim = max(seq_sim, jacc, containment * 0.90)
            else:
                pair_sim = min(seq_sim, jacc)
        elif not c_toks and o_toks:
            pair_sim = 0.0
        else:
            pair_sim = seq_sim
        if pair_sim > best:
            best = pair_sim
    return min(1.0, best)


def _clean_vn_author_role(name: str) -> str:
    cleaned = re.sub(
        r"\(\s*(?:chủ\s+biên|cb\.?|biên\s+soạn|đồng\s+chủ\s+biên)\s*\)",
        "",
        str(name or ""),
        flags=re.IGNORECASE,
    )
    cleaned = re.sub(
        r"\b(?:chủ\s+biên|biên\s+soạn)\b",
        "",
        cleaned,
        flags=re.IGNORECASE,
    )
    return cleaned.strip(" ,.;:-–—()")


def _matches_individual_vn_entry_author(
    cited_author: str,
    entry_authors: list[str],
) -> bool:
    """Verify ``cited_author`` matches at least one INDIVIDUAL entry author (never unioned)."""
    from integrity_checker.matching.author_matcher import (
        author_match_score as strict_author_match_score,
    )

    clean_cited = _clean_vn_author_role(cited_author)
    norm_cited = normalize_text(clean_cited)
    if not norm_cited:
        return False

    for entry_auth in entry_authors:
        if not entry_auth:
            continue
        clean_entry = _clean_vn_author_role(entry_auth)
        norm_entry = normalize_text(clean_entry)
        if not norm_entry:
            continue
        if norm_cited == norm_entry:
            return True
        if strict_author_match_score([clean_cited], [clean_entry]) >= 0.75:
            return True
    return False

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
    def is_curated_vn_standard(cls, citation: Citation) -> bool:
        """Return True iff ``citation`` cites a TCVN/QCVN code present (by exact or per-ministry base code) in the curated registry."""
        vn_std = cls.extract_vn_standard_code(citation)
        if vn_std is None:
            return False
        kind, canonical_code, _, ministry_code = vn_std
        registry = _load_vn_registry()
        standards_by_code = registry.get("standards_by_code") or {}
        if canonical_code in standards_by_code:
            return True
        standards_by_base = registry.get("standards_by_base_code") or {}
        base_key = _vn_standard_base_key(kind, canonical_code, ministry_code)
        return bool(base_key and standards_by_base.get(base_key))

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
        raw_no_idx = re.sub(r"^\s*(?:\[\s*\d+\s*\]\.?|\d{1,3}\s*[\.\)])\s*", "", raw_text).strip()
        norm_raw = normalize_text(raw_no_idx)

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
                    is_specific_title = (
                        len(norm_cand) >= 24 and len(norm_cand.split()) >= 5
                    ) or (
                        len(norm_cand) >= 12 and f"giao trinh {norm_cand}" in norm_raw
                    )
                    if is_specific_title and norm_cand in norm_raw:
                        best_sim = 0.95
                        matched_title = str(cand_t)
                        break

            if matched_title is None:
                continue

            entry_authors = [str(a) for a in (entry.get("authors") or []) if a]
            if citation.authors:
                has_valid_author = any(
                    _matches_individual_vn_entry_author(str(ca), entry_authors)
                    for ca in citation.authors
                    if ca and str(ca).strip()
                )
                if not has_valid_author:
                    continue
            else:
                norm_matched_title = normalize_text(matched_title)
                is_title_first = bool(
                    norm_matched_title and norm_raw.startswith(norm_matched_title)
                )
                author_prefix = ""
                if not is_title_first:
                    m_yr = re.match(
                        r"^([^\(\n]{3,90}?)\s*\(\s*(?:19|20)\d{2}[a-z]?\s*\)",
                        raw_no_idx,
                    )
                    if m_yr:
                        author_prefix = m_yr.group(1).strip(" .,;:-–—")
                    elif norm_matched_title and norm_matched_title in norm_raw:
                        title_pos = norm_raw.find(norm_matched_title)
                        if title_pos >= 4:
                            author_prefix = norm_raw[:title_pos].strip()

                if author_prefix:
                    prefix_parts = [
                        p.strip()
                        for p in re.split(
                            r"\s*(?:,|;|&|\bvà\b|\band\b)\s*",
                            author_prefix,
                            flags=re.IGNORECASE,
                        )
                        if p and len(p.strip()) >= 2
                    ]
                    author_ok = any(
                        _matches_individual_vn_entry_author(part, entry_authors)
                        for part in prefix_parts
                    ) or any(
                        normalize_text(ea) in normalize_text(author_prefix)
                        for ea in entry_authors
                    )
                    if not author_ok:
                        continue
                else:
                    has_author_in_raw = any(
                        normalize_text(a) in norm_raw for a in entry_authors if a
                    )
                    publishers = [
                        entry.get("publisher") or "",
                        *(entry.get("publisher_aliases") or []),
                    ]
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
        curated Vietnamese national standard (TCVN/QCVN), or curated VN university textbook."""
        return bool(
            cls.extract_rfc_number(citation) is not None
            or cls.extract_pypi_package(citation)
            or cls.extract_npm_package(citation)
            or cls.extract_github_repo(citation)
            or cls.is_curated_vn_standard(citation)
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
        standards_by_base = registry.get("standards_by_base_code") or {}

        matched_entry = standards_by_code.get(canonical_code)
        if matched_entry is None:
            base_key = _vn_standard_base_key(kind, canonical_code, ministry_code)
            base_matches = standards_by_base.get(base_key) or [] if base_key else []
            if not base_matches:
                # Uncurated TCVN/QCVN code (or different ministry namespace): never synthesize found=True.
                return None

            cited_yr_int = int(code_year) if code_year.isdigit() else 0

            def _closest_edition_key(item: dict[str, Any]) -> tuple[int, int]:
                y_raw = str(item.get("year") or "0")
                y_int = int(y_raw) if y_raw.isdigit() else 0
                dist = abs(y_int - cited_yr_int) if (y_int and cited_yr_int) else 9999
                return (dist, -y_int)

            matched_entry = min(base_matches, key=_closest_edition_key)

        official_code = re.sub(
            r"\s+",
            " ",
            str(matched_entry.get("code") or canonical_code).strip().upper(),
        )
        base_titles = [
            str(matched_entry.get("title") or ""),
            *(str(a) for a in (matched_entry.get("aliases") or []) if a),
        ]
        official_subjects = [
            subj
            for bt in base_titles
            if bt
            for subj in (extract_vn_standard_core_subject(bt),)
            if subj
        ]
        cited_subject = (
            extract_vn_standard_core_subject(
                citation.title,
                venue=citation.venue,
                raw_text=citation.raw_text,
                authors=citation.authors,
            )
            if citation is not None
            else ""
        )
        core_subject_sim = compute_vn_standard_core_subject_similarity(
            cited_subject,
            official_subjects,
        )

        title_variants: list[str] = []
        for bt in base_titles:
            if bt:
                title_variants.extend(
                    [f"{official_code} {bt}", f"{official_code}: {bt}", bt]
                )

        chosen_title = (
            f"{official_code}: {base_titles[0]}"
            if base_titles and base_titles[0]
            else official_code
        )
        if citation and citation.title:
            cit_title_fold = _fold_vn_ascii(citation.title)
            if cit_title_fold in {
                _fold_vn_ascii(official_code),
                _fold_vn_ascii(canonical_code),
            } and (not cited_subject or core_subject_sim >= 0.70):
                chosen_title = official_code
            elif title_variants and (not cited_subject or core_subject_sim >= 0.70):
                def _variant_sim(v: str) -> float:
                    return max(
                        title_similarity(citation.title, v),
                        title_similarity(cit_title_fold, _fold_vn_ascii(v)),
                    )

                best_variant = max(title_variants, key=_variant_sim)
                if _variant_sim(best_variant) >= 0.45:
                    chosen_title = best_variant

        authors = list(matched_entry.get("authors") or []) or ["Bộ Khoa học và Công nghệ"]
        venue = str(
            matched_entry.get("venue")
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
            year=str(matched_entry.get("year") or code_year),
            venue=venue,
            external_ids={
                "vn_standard_code": official_code,
                "cited_vn_standard_code": canonical_code,
                "vn_standard_subjects": " || ".join(official_subjects),
                "standard_type": kind,
            },
            confidence=0.97 if official_code == canonical_code else 0.90,
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
