"""Bibliographic completeness assessment for Subsystem A1 (`R-INCOMPLETE-METADATA`).

Distinguishes incomplete / under-formatted student bibliography entries
(e.g., `[2] Making a robot vacuum cleaner to avoid falling down the stairs`)
from genuine AI-hallucinated scholarly claims (`Author (Year). Title. Journal...`
or fabricated DOIs / fake URLs).
"""

from __future__ import annotations

import datetime
import re
from dataclasses import dataclass
from typing import Any

from integrity_checker.models.citation import CitationType

_KNOWN_FAKE_DOMAINS: frozenset[str] = frozenset(
    {
        "example.com",
        "example.org",
        "example.net",
        "example.edu",
        "test.com",
        "fake.com",
        "localhost",
    }
)

_RESERVED_FAKE_TLDS: tuple[str, ...] = (
    ".invalid",
    ".test",
    ".example",
    ".localhost",
    ".fake",
)

_DOI_RE = re.compile(r"\b10\.\d{4,9}/\S+", re.IGNORECASE)
_ARXIV_RE = re.compile(
    r"\barXiv\s*:\s*(?:\d{4}\.\d{4,5}(?:v\d+)?|[a-z\-]+(?:\.[A-Z]{2})?/\d{7})\b",
    re.IGNORECASE,
)
_ISBN_RE = re.compile(
    r"(?:\bISBN(?:-1[03])?\s*:?\s*[0-9Xx\- ]{10,20}\b|\b97[89][-\s]?(?:\d[-\s]?){9}[\dXx]\b)",
    re.IGNORECASE,
)
_PMID_RE = re.compile(r"\b(?:PMID\s*:?\s*\d{5,10}|PMC\d{5,10})\b", re.IGNORECASE)
_VN_LEGAL_OR_STANDARD_ID_RE = re.compile(
    r"\b(?:"
    r"TCVN\s+(?:ISO(?:/IEC)?\s+)?\d+|"
    r"QCVN\s+[A-ZĐ0-9]+|"
    r"Nghị\s+định(?:\s+số)?\s+\d+|"
    r"Luật\s+số\s+\d+|"
    r"Thông\s+tư(?:\s+số)?\s+\d+|"
    r"Quyết\s+định(?:\s+số)?\s+\d+|"
    r"Nghị\s+định|Luật\s+số|Thông\s+tư|Quyết\s+định"
    r")\b",
    re.IGNORECASE,
)
_URL_IN_RAW_RE = re.compile(r"https?://[^\s\]\)\,;]+", re.IGNORECASE)
_YEAR_TOKEN_RE = re.compile(r"(?<![\d\-–—])\b((?:18|19|20)\d{2})[a-z]?\b(?![\s]*[-–—][\s]*\d)")

_REF_MARKER_PREFIX_RE = re.compile(
    r"^\s*(?:\[\s*\d+[a-z]?\s*\]|\(\s*\d+[a-z]?\s*\)|\d+[a-z]?[.)])\s*"
)
_BARE_INTEXT_RE = re.compile(
    r"^\s*(?:"
    r"\(\s*[A-ZÀ-Ỹ][^()]{1,70},\s*(?:18|19|20)\d{2}[a-z]?(?:\s*,\s*pp?\.\s*\d+(?:[-–]\d+)?)?\s*\)|"
    r"\[\s*\d+[a-z]?(?:\s*[-–,]\s*\d+[a-z]?)*\s*\]"
    r")\s*$"
)

# Spurious single-word tokens frequently sliced off the start of a bare student title
# when GROBID or fallback regex assumes the first capitalized word is an author surname.
_SPURIOUS_SINGLE_WORD_AUTHOR_TOKENS: frozenset[str] = frozenset(
    {
        # English gerunds / participles / title-starters / determiners / generic nouns
        "making",
        "building",
        "designing",
        "using",
        "understanding",
        "developing",
        "implementing",
        "improving",
        "exploring",
        "investigating",
        "analyzing",
        "evaluating",
        "applying",
        "learning",
        "teaching",
        "creating",
        "modeling",
        "modelling",
        "optimizing",
        "measuring",
        "testing",
        "predicting",
        "detecting",
        "recognizing",
        "classifying",
        "comparing",
        "studying",
        "towards",
        "toward",
        "beyond",
        "modern",
        "advanced",
        "practical",
        "introduction",
        "overview",
        "guide",
        "tutorial",
        "chapter",
        "section",
        "lecture",
        "report",
        "whitepaper",
        "manual",
        "handbook",
        "survey",
        "review",
        "analysis",
        "design",
        "development",
        "implementation",
        "application",
        "research",
        "study",
        "system",
        "method",
        "approach",
        "framework",
        "algorithm",
        "the",
        "a",
        "an",
        "on",
        "in",
        "for",
        "how",
        "why",
        "what",
        "when",
        "where",
        "unknown",
        "anonymous",
        "unnamed",
        "none",
        # Vietnamese common bare-title starters
        "hướng",
        "tìm",
        "nghiên",
        "xây",
        "thiết",
        "ứng",
        "giới",
        "tổng",
        "báo",
        "tài",
        "phân",
        "đánh",
        "khảo",
        "phát",
        "triển",
        "giải",
        "pháp",
        "quy",
        "trình",
        "hệ",
        "thống",
        "mô",
        "hình",
        "bài",
        "giảng",
        "chương",
        "phần",
        "luận",
        "án",
        "đồ",
    }
)

_NAME_PARTICLES: frozenset[str] = frozenset(
    {"van", "de", "der", "den", "von", "del", "della", "du", "di", "da", "le", "la", "al", "el", "ibn", "bin"}
)

_INSTITUTIONAL_AUTHOR_RE = re.compile(
    r"(?:"
    r"\b(?:WHO|IEEE|ACM|OECD|UNESCO|UNICEF|UNHCR|IMF|WTO|ILO|FAO|IPCC|ISO|IEC|ITU|NIST|IETF|W3C|OWASP|CDC|FDA|EPA|NIH|NASA)\b|"
    r"\b(?:World\s+Health\s+Organization|World\s+Bank|United\s+Nations|European\s+Commission|"
    r"European\s+Union|Ministry\s+of|Department\s+of|National\s+Institute|Bureau\s+of|"
    r"Centers?\s+for\s+Disease\s+Control|Association|Organization|Organisation|Institute|"
    r"Institution|Society|Council|Commission|Committee|Administration|Agency|Foundation|"
    r"Federation|University|College|Academy|Consortium|Board|Corporation|Advisors)\b|"
    r"\b(?:Bộ\s+[A-ZÀ-Ỹa-zà-ỹ]+|Tổng\s+cục\s+[A-ZÀ-Ỹa-zà-ỹ]+|Ủy\s+ban\s+[A-ZÀ-Ỹa-zà-ỹ]+|"
    r"Chính\s+phủ|Quốc\s+hội|Ngân\s+hàng\s+Nhà\s+nước|Viện\s+[A-ZÀ-Ỹa-zà-ỹ]+|"
    r"Trường\s+Đại\s+học|Đại\s+học\s+[A-ZÀ-Ỹa-zà-ỹ]+|Tổ\s+chức\s+Y\s+tế\s+Thế\s+giới)\b"
    r")"
)

_PERIODICAL_VENUE_SIGNAL_RE = re.compile(
    r"(?:"
    r"\b(?:Journal|Transactions|Proceedings|Conference|Symposium|Workshop|Letters|Reviews|"
    r"Annals|Bulletin|Archives|Lancet|JAMA|BMJ|PLOS|Nature|Science|Sensors|Energies|"
    r"Sustainability|arXiv|bioRxiv|medRxiv|SSRN)\b|"
    r"(?:^|[\s,;])(?:J\.|Trans\.|Proc\.|Conf\.|Symp\.|Lett\.|Rev\.|Vol\.|vol\.|No\.|no\.|pp\.)(?=\s|\d|$)|"
    r"\b(?:Tạp\s+chí|Hội\s+nghị|Hội\s+thảo|Kỷ\s+yếu)\b|"
    r"\b\d{1,4}\s*\(\s*\d{1,3}\s*\)\s*,\s*(?:e?\d+|\d+\s*[-–—]\s*\d+)\b"
    r")",
    re.IGNORECASE,
)

_BOOK_PUBLISHER_VENUE_SIGNAL_RE = re.compile(
    r"\b(?:"
    r"Publisher|Publishers|Publishing|Press|Springer|Elsevier|Wiley|Routledge|"
    r"O['’]Reilly|McGraw-Hill|Pearson|Addison-Wesley|Prentice\s+Hall|Morgan\s+Kaufmann|"
    r"Palgrave|Macmillan|Penguin|HarperCollins|HarperOne|Crossway|Zondervan|Eerdmans|"
    r"Baker\s+Academic|Oxford\s+University|Cambridge\s+University|MIT\s+Press|"
    r"NXB|Nhà\s+xuất\s+bản"
    r")\b",
    re.IGNORECASE,
)

_CLASSICAL_BIBLE_EXEMPT_RE = re.compile(
    r"\b(?:"
    r"holy\s+bible|the\s+bible|english\s+standard\s+version|king\s+james\s+version|"
    r"new\s+international\s+version|\besv\b|\bniv\b|\bkjv\b|"
    r"plato|aristotle|augustine|aquinas|shakespeare|homer"
    r")\b",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class BibliographicCompleteness:
    """Structured result of bibliographic completeness evaluation."""

    is_incomplete: bool
    has_resolvable_id: bool
    has_valid_year: bool
    has_real_authors: bool
    has_academic_venue: bool
    missing_fields: list[str]


def _is_fake_domain_url(url: str | None) -> bool:
    if not url:
        return False
    lower = url.strip().lower()
    if "localhost" in lower or "127.0.0.1" in lower:
        return True
    from urllib.parse import urlparse

    try:
        parsed = urlparse(lower)
        host = (parsed.netloc or "").split(":")[0]
        if not host:
            return False
        bare = host[4:] if host.startswith("www.") else host
        if bare in _KNOWN_FAKE_DOMAINS or any(bare.endswith("." + d) for d in _KNOWN_FAKE_DOMAINS):
            return True
        if bare.endswith(_RESERVED_FAKE_TLDS):
            return True
        if bare.startswith(("fake-", "placeholder-")):
            return True
    except Exception:  # noqa: BLE001
        return False
    return False


def _is_real_author_entry(author_item: Any, raw_after_marker: str) -> bool:
    """Return True when ``author_item`` represents a genuine person or institution."""
    if author_item is None:
        return False

    has_initials = False
    if isinstance(author_item, str):
        surface = author_item.strip()
    else:
        initials_val = getattr(author_item, "initials", None) or getattr(
            author_item, "forename", None
        )
        has_initials = bool(initials_val)
        surface = (
            getattr(author_item, "raw", "")
            or getattr(author_item, "full_name", "")
            or getattr(author_item, "last_name", "")
            or str(author_item)
        ).strip()

    surface_clean = surface.strip(" .,;:()[]{}\"'")
    if not surface_clean:
        return False

    if _INSTITUTIONAL_AUTHOR_RE.search(surface_clean):
        return True

    word_tokens = re.findall(r"[A-Za-zÀ-ỹ'\u2019\-]+", surface_clean)
    if not word_tokens:
        return False

    # Multi-word sentence fragments (e.g. a 6-word bare title mis-parsed as an author)
    if len(word_tokens) >= 5 and "," not in surface_clean and "." not in surface_clean:
        lower_non_particles = [
            t for t in word_tokens if t[0].islower() and t.lower() not in _NAME_PARTICLES
        ]
        if len(lower_non_particles) >= 2 or word_tokens[0].lower() in _SPURIOUS_SINGLE_WORD_AUTHOR_TOKENS:
            return False

    # Single initial-less token checks
    if len(word_tokens) == 1 and not has_initials and "," not in surface_clean and "." not in surface_clean:
        token_lower = word_tokens[0].lower()
        if len(token_lower) <= 1:
            return False
        if token_lower in _SPURIOUS_SINGLE_WORD_AUTHOR_TOKENS:
            return False

        # First-word bare-title slice guard: if this single initial-less word is the very first
        # word of `citation_raw` (after `[N]`/`N.`) and is immediately followed by lowercase prose
        # words rather than `,`, `.`, initials, `(Year)`, or `et al.`, it is a title token.
        if raw_after_marker:
            m_first = re.match(r"^([A-Za-zÀ-ỹ'\u2019\-]+)(.*)$", raw_after_marker)
            if m_first and m_first.group(1).lower() == token_lower:
                rest = m_first.group(2)
                has_author_punctuation_or_cue = bool(
                    re.match(
                        r"^(?:"
                        r"\s*[,.;:]|"
                        r"\s+[A-ZÀ-Ỹ]\.|"
                        r"\s*\(\s*(?:18|19|20)\d{2}|"
                        r"\s+(?:18|19|20)\d{2}\b|"
                        r"\s+et\s+al\b|"
                        r"\s+(?:&|and|và)\s+[A-ZÀ-Ỹ]"
                        r")",
                        rest,
                    )
                )
                if not has_author_punctuation_or_cue and re.match(r"^\s+[a-zà-ỹ]", rest):
                    first_rest_word = re.findall(r"^\s+([a-zà-ỹ]+)", rest)
                    if not first_rest_word or first_rest_word[0] not in _NAME_PARTICLES:
                        return False

    return True


def assess_bibliographic_completeness(
    citation_raw: str | None,
    citation_authors: list[Any] | None = None,
    citation_year: str | int | None = None,
    citation_venue: str | None = None,
    citation_doi: str | None = None,
    citation_url: str | None = None,
    arxiv_id: str | None = None,
    isbn: str | None = None,
    pmid: str | None = None,
    url_status: str | None = None,
    citation_type: CitationType | str | None = None,
    citation_title: str | None = None,
) -> BibliographicCompleteness:
    """Evaluate whether a bibliography entry lacks minimum scholarly citation metadata."""
    raw = (citation_raw or "").strip()
    title_str = (citation_title or "").strip()

    # 1. Scope check: apply only to bibliography entries (never in-text parenthetical/numeric markers
    #    or synthetic 1-word unit-test stubs such as `citation_raw="test"`).
    in_scope = True
    if citation_type is not None:
        ct_val = citation_type.value if hasattr(citation_type, "value") else str(citation_type)
        if ct_val in {
            CitationType.IN_TEXT.value,
            CitationType.NUMERIC.value,
            CitationType.DOI.value,
            CitationType.URL.value,
        }:
            in_scope = False
    if raw and _BARE_INTEXT_RE.match(raw):
        in_scope = False

    raw_after_marker = _REF_MARKER_PREFIX_RE.sub("", raw).strip()
    has_ref_marker = raw_after_marker != raw
    alpha_words = re.findall(r"[A-Za-zÀ-ỹ]{2,}", raw_after_marker or title_str)
    if not title_str and not has_ref_marker and len(alpha_words) < 3:
        in_scope = False

    # 2. Identifier & fake-URL detection
    has_doi = bool((citation_doi and str(citation_doi).strip()) or _DOI_RE.search(raw))
    effective_url = (citation_url or "").strip()
    if not effective_url and raw:
        m_url = _URL_IN_RAW_RE.search(raw)
        if m_url:
            effective_url = m_url.group(0)

    is_fake_url = url_status == "fake_domain" or _is_fake_domain_url(effective_url)
    is_dead_url = url_status == "dead_link"
    has_live_or_resolvable_url = bool(effective_url) and not is_fake_url and not is_dead_url

    has_arxiv = bool((arxiv_id and str(arxiv_id).strip()) or _ARXIV_RE.search(raw))
    has_isbn = bool((isbn and str(isbn).strip()) or _ISBN_RE.search(raw))
    has_pmid = bool((pmid and str(pmid).strip()) or _PMID_RE.search(raw))
    has_vn_statutory_or_std = bool(_VN_LEGAL_OR_STANDARD_ID_RE.search(raw))

    has_resolvable_id = bool(
        has_doi
        or has_arxiv
        or has_isbn
        or has_pmid
        or has_vn_statutory_or_std
        or has_live_or_resolvable_url
    )

    # 3. Valid publication year check (1800 .. current_year + 1)
    max_valid_year = max(2027, datetime.datetime.now(datetime.UTC).year + 1)
    has_valid_year = False
    if citation_year is not None and str(citation_year).strip():
        m_yr = re.search(r"(18|19|20)\d{2}", str(citation_year))
        if m_yr and 1800 <= int(m_yr.group(0)) <= max_valid_year:
            has_valid_year = True
    elif raw:
        for m_yr in _YEAR_TOKEN_RE.finditer(raw):
            yr_val = int(m_yr.group(1))
            if 1800 <= yr_val <= max_valid_year:
                has_valid_year = True
                break

    # 4. Real personal or institutional authors check
    has_real_authors = any(
        _is_real_author_entry(a, raw_after_marker) for a in (citation_authors or [])
    )
    if not has_real_authors and raw_after_marker and _INSTITUTIONAL_AUTHOR_RE.match(raw_after_marker):
        has_real_authors = True

    # 5. Academic venue or book publisher signal check
    has_academic_venue = bool(
        (citation_venue and citation_venue.strip())
        or _PERIODICAL_VENUE_SIGNAL_RE.search(raw)
        or _BOOK_PUBLISHER_VENUE_SIGNAL_RE.search(raw)
    )

    missing_fields: list[str] = []
    if not has_real_authors:
        missing_fields.append("authors")
    if not has_valid_year:
        missing_fields.append("year")
    if not has_academic_venue:
        missing_fields.append("venue")

    # 6. Final `is_incomplete` gate (Spec §2.1):
    #    - Never True when DOI is present, URL is fake/dead, or any resolvable ID exists
    #      (preserves 100% SUSPECTED_HALLUCINATION sensitivity on fabricated DOIs/URLs/laws).
    #    - Never True when `has_real_authors and has_valid_year` (preserves 100% sensitivity
    #      on AI-hallucinated `Author (Year). Title.` references).
    if (
        not in_scope
        or has_doi
        or is_fake_url
        or is_dead_url
        or has_resolvable_id
        or _CLASSICAL_BIBLE_EXEMPT_RE.search(raw)
    ):
        is_incomplete = False
    else:
        is_incomplete = bool(
            (not has_valid_year and not has_academic_venue)
            or (not has_real_authors and not has_valid_year)
            or (not has_real_authors and not has_academic_venue)
        )

    return BibliographicCompleteness(
        is_incomplete=is_incomplete,
        has_resolvable_id=has_resolvable_id,
        has_valid_year=has_valid_year,
        has_real_authors=has_real_authors,
        has_academic_venue=has_academic_venue,
        missing_fields=missing_fields,
    )
