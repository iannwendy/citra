"""Utility patterns for citation extraction — SINGLE SOURCE OF TRUTH.

This module provides compiled regex patterns and extraction functions for:
- DOI: Digital Object Identifier
- URL: Uniform Resource Locator
- Year: Publication year (1900-2099)

All regex patterns in this module are compiled once at import time
for performance. Use these functions throughout the codebase instead
of duplicating regex patterns.
"""

from __future__ import annotations

import re

from integrity_checker.extraction.patterns.base import CompiledPattern, PatternType

# =============================================================================
# DOI Pattern
# =============================================================================
# DOI format: 10.prefix/suffix
# - Prefix: 4-9 digits (10.XXXX or 10.XXXXX)
# - Suffix: Any characters except whitespace, ], ), comma, semicolon
#
# Common DOI examples:
# - 10.1000/xyz123
# - 10.1038/nature12345
# - 10.1145/3442188.3445922

DOI_PATTERN = CompiledPattern.create(
    name="doi",
    pattern=r"10\.\d{4,9}/(?:[^\s\]\)\,;()]|\([^\s\]\)\,;()]*\))+",
    pattern_type=PatternType.UTILITY,
    description="DOI: Matches 10.xxxx/yyyy format (Digital Object Identifier)",
)

# Pre-compiled regex for direct use
_DOI_REGEX = re.compile(r"10\.\d{4,9}/(?:[^\s\]\)\,;()]|\([^\s\]\)\,;()]*\))+")


def extract_doi(text: str) -> str | None:
    """Extract DOI from text.

    Args:
        text: Input text containing potential DOI

    Returns:
        DOI string if found, None otherwise

    Examples:
        >>> extract_doi("See https://doi.org/10.1000/xyz123")
        '10.1000/xyz123'
        >>> extract_doi("DOI: 10.1038/nature12345")
        '10.1038/nature12345'
        >>> extract_doi("No DOI here")
        None
    """
    if not text:
        return None
    match = _DOI_REGEX.search(text)
    if match:
        doi = match.group(0)
        # Clean trailing punctuation
        return doi.rstrip(".,;:")
    return None


# =============================================================================
# URL Pattern
# =============================================================================
# URL format: http(s)://host/path
# - Protocol: http:// or https://
# - Host: Non-whitespace characters
# - Path: Any characters except whitespace, ], ), comma, semicolon
#
# Common URL examples:
# - https://arxiv.org/abs/2103.00001
# - http://example.com/paper.pdf
# - https://github.com/user/repo

URL_PATTERN = CompiledPattern.create(
    name="url",
    pattern=r"https?://(?:[^\s\]\)\,;()]|\([^\s\]\)\,;()]*\))+",
    pattern_type=PatternType.UTILITY,
    description="URL: Matches http(s)://... format (Uniform Resource Locator)",
)

# Pre-compiled regex for direct use
_URL_REGEX = re.compile(r"https?://(?:[^\s\]\)\,;()]|\([^\s\]\)\,;()]*\))+")


def extract_url(text: str) -> str | None:
    """Extract URL from text.

    Args:
        text: Input text containing potential URL

    Returns:
        URL string if found, None otherwise

    Examples:
        >>> extract_url("Visit https://example.com for more")
        'https://example.com'
        >>> extract_url("See http://arxiv.org/abs/1234.5678")
        'http://arxiv.org/abs/1234.5678'
        >>> extract_url("No URL here")
        None
    """
    if not text:
        return None
    repaired_text = re.sub(
        r"\b(https?://)\s+(?=[A-Za-z0-9][^\s/]*\.[a-z]{2,})",
        r"\1",
        text,
        flags=re.IGNORECASE,
    )
    match = _URL_REGEX.search(repaired_text)
    if match:
        url = match.group(0)
        # Split concatenated URLs (e.g. "https://github.com/a/b-https://github.com/c/d" or "...pdfhttps://...")
        scheme_end = url.find("://") + 3
        second_url_m = re.search(
            r"(?<!=[a-zA-Z0-9])(?<!\?url=)(?<!&url=)-?(?=https?://)",
            url[scheme_end:],
            flags=re.IGNORECASE,
        )
        if second_url_m:
            url = url[: scheme_end + second_url_m.start()]
        url = re.sub(
            r"[\(\[](?:ac-?\s*cessed|re-?\s*trieved|truy\s*cập)\b.*$",
            "",
            url,
            flags=re.IGNORECASE,
        )
        # Clean trailing punctuation while preserving balanced parentheses in URL path
        url = url.rstrip(".,;:'\"\u2019\u201d")
        while url.endswith(")") and url.count(")") > url.count("("):
            url = url[:-1].rstrip(".,;:'\"\u2019\u201d")
        host_m = re.match(r"^https?://([^/\s]+)", url, re.IGNORECASE)
        if not host_m or ("." not in host_m.group(1) and host_m.group(1).lower() != "localhost"):
            return None
        return url
    return None


# =============================================================================
# Year Pattern
# =============================================================================
# Year format: 4-digit number starting with 19 or 20
# - 1900-1999: 19XX
# - 2000-2099: 20XX
# - Optional lowercase suffix: 2020a, 2020b for multiple papers in same year
#
# Common year examples:
# - 2020, 2019, 1985
# - 2020a (multiple papers by same author in 2020)

YEAR_PATTERN = CompiledPattern.create(
    name="year",
    pattern=r"\b(19|20)\d{2}[a-z]?\b",
    pattern_type=PatternType.UTILITY,
    description="Year: Matches 1900-2099 with optional letter suffix (e.g., 2020a)",
)

# Pre-compiled regex for direct use
_YEAR_REGEX = re.compile(r"\b(19|20)\d{2}[a-z]?\b")
_YEAR_CAPTURE_REGEX = re.compile(r"\b((?:19|20)\d{2})([a-z]?)\b")
_YEAR_CAPTURE_1800_REGEX = re.compile(r"\b((?:18|19|20)\d{2})([a-z]?)\b")

# Numeric spans in bibliographic strings that contain 4-digit numbers (19xx/20xx)
# which are NOT publication years: URLs, DOIs, arXiv IDs, open-ended founding
# years "(1974-)", explicit page numbers/ranges ("pp. 1895–1923"), volume/issue/
# article/series numbers ("LNCS 1984", "art. no. 2021"), and colon page numbers
# ("10(7): 1895–1923").
_NON_YEAR_SPAN_REGEX = re.compile(
    r"(?:"
    r"https?://\S+|www\.\S+"
    r"|\b10\.\d{4,9}/\S+"
    r"|\barxiv\s*:\s*(?:[a-z\-]+/\d+|\d{4}\.\d+(?:v\d+)?)"
    r"|\(\s*(?:18|19|20)\d{2}\s*[-–—‑\u2212]\s*\)"
    r"|\b(?:pp?\.?|pages?|tr(?:ang|\.)?)\s*[A-Za-z]?\d+(?:\s*[-–—‑\u2212/]\s*[A-Za-z]?\d+)?\b"
    r"|\b(?:vol(?:ume)?|no|number|iss(?:ue)?|art(?:icle)?(?:\s+(?:no|id)\.?)?|lncs|lnai|lnbip|ccis|spie|isbn|issn|pmid|pmcid)\.?\s*[A-Za-z]?\d+(?:\s*[-–—‑\u2212/]\s*[A-Za-z]?\d+)?\b"
    r"|(?<=[\d\)])\s*:\s*\d+(?:\s*[-–—‑\u2212]\s*\d+)?\b"
    r")",
    re.IGNORECASE,
)

# Access / retrieval date clauses (used only as fallback when no publication year exists)
_ACCESS_DATE_SPAN_REGEX = re.compile(
    r"(?:"
    r"[\(\[]\s*(?:ac-?\s*cessed|re-?\s*trieved|truy\s+cập|ngày\s+truy\s+cập|last\s+accessed)\b[^)\]]*[\)\]]"
    r"|\b(?:ac-?\s*cessed|re-?\s*trieved(?:\s+on|\s+from)?|truy\s+cập(?:\s+ngày)?|last\s+accessed)\s*:?\s*(?:(?:\d{1,2}\s+[A-Za-zÀ-ỹ.]+\s+|[A-Za-zÀ-ỹ.]+\s+\d{1,2}\s*,?\s*|\d{1,2}\s*[/-]\s*\d{1,2}\s*[/-]\s*)(?:19|20)\d{2}|(?:19|20)\d{2})\b"
    r")",
    re.IGNORECASE,
)

# Bare 3-to-5 digit hyphenated/en-dash ranges (e.g. "1895–1923", "1920-1935")
_BARE_PAGE_RANGE_REGEX = re.compile(r"\b[A-Za-z]?\d{3,5}\s*[-–—‑\u2212]\s*[A-Za-z]?\d{3,5}\b")


def extract_publication_year(
    text: str,
    *,
    prefer_last: bool = True,
    allow_1800s: bool = False,
) -> tuple[str | None, str | None]:
    """Extract (year, year_suffix) from reference/venue text while ignoring page numbers,
    volume/issue/article numbers, DOIs, URLs, arXiv IDs, and preferring publication
    dates over access/retrieval dates.
    """
    if not text:
        return None, None

    year_re = _YEAR_CAPTURE_1800_REGEX if allow_1800s else _YEAR_CAPTURE_REGEX

    # Step 1: Strip URLs, DOIs, arXiv IDs, explicit page/vol/issue/article numbers
    cleaned = _NON_YEAR_SPAN_REGEX.sub(" ", text)

    # Step 2: Strip access/retrieval date clauses for primary search
    non_accessed = _ACCESS_DATE_SPAN_REGEX.sub(" ", cleaned)

    # Step 3: Strip bare 3-5 digit ranges (e.g., "1895–1923") for primary search
    no_bare_ranges = _BARE_PAGE_RANGE_REGEX.sub(" ", non_accessed)

    for candidate_text in (no_bare_ranges, non_accessed, cleaned):
        matches = list(year_re.finditer(candidate_text))
        if not matches:
            continue
        if len(matches) == 1:
            m = matches[0]
            return m.group(1), (m.group(2) or None)

        # If multiple candidate years remain:
        # 1. Check for a standalone year near the end of the venue/entry (e.g., ", 1998.")
        trailing_m = re.search(
            r"(?:,\s*|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+)"
            + (r"((?:18|19|20)\d{2})([a-z]?)" if allow_1800s else r"((?:19|20)\d{2})([a-z]?)")
            + r"\s*[.;)]*\s*(?:\[online\].*)?$",
            candidate_text.strip(),
            re.IGNORECASE,
        )
        if trailing_m:
            return trailing_m.group(1), (trailing_m.group(2) or None)

        # 2. Check for an explicit parenthetical/bracketed year "(2020)" / "[2020]"
        paren_m = re.search(
            r"[\(\[]\s*"
            + (r"((?:18|19|20)\d{2})([a-z]?)" if allow_1800s else r"((?:19|20)\d{2})([a-z]?)")
            + r"\s*[\)\]]",
            candidate_text,
        )
        if paren_m:
            return paren_m.group(1), (paren_m.group(2) or None)

        chosen = matches[-1] if prefer_last else matches[0]
        return chosen.group(1), (chosen.group(2) or None)

    return None, None


def extract_year(text: str) -> str | None:
    """Extract publication year from text.

    Args:
        text: Input text containing potential year

    Returns:
        Year string (e.g., "2020", "2019a") if found, None otherwise

    Examples:
        >>> extract_year("Published in 2020")
        '2020'
        >>> extract_year("Vaswani et al. (2017)")
        '2017'
        >>> extract_year("Smith (2020a) and Jones (2020b)")
        '2020a'
        >>> extract_year("No year here")
        None
    """
    if not text:
        return None
    cleaned = _NON_YEAR_SPAN_REGEX.sub(" ", text)
    non_accessed = _ACCESS_DATE_SPAN_REGEX.sub(" ", cleaned)
    no_bare_ranges = _BARE_PAGE_RANGE_REGEX.sub(" ", non_accessed)
    for candidate_text in (no_bare_ranges, non_accessed, cleaned):
        if ";" not in candidate_text:
            prog_yr_m = re.match(
                r"^[\(\[]\s*[^,;()\]]+\s+\d{4}\s*,\s*((?:19|20)\d{2}[a-z]?)\s*[\)\]]$",
                candidate_text.strip(),
            )
            if prog_yr_m:
                return prog_yr_m.group(1)
        match = _YEAR_REGEX.search(candidate_text)
        if match:
            return match.group(0)
    return None


# =============================================================================
# All Utility Patterns (for registry)
# =============================================================================
UTILITY_PATTERNS: list[CompiledPattern] = [
    DOI_PATTERN,
    URL_PATTERN,
    YEAR_PATTERN,
]


# =============================================================================
# Re-export for convenience
# =============================================================================
__all__ = [
    "CompiledPattern",
    "PatternType",
    "DOI_PATTERN",
    "URL_PATTERN",
    "YEAR_PATTERN",
    "UTILITY_PATTERNS",
    "extract_doi",
    "extract_url",
    "extract_year",
    "extract_publication_year",
]
