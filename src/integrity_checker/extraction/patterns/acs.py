"""ACS (American Chemical Society) citation format patterns and parser.

This module provides ACS citation format implementation for the
modular citation pattern system.

ACS Style Citations:
    In-text:
        - Superscript numbers: ^1
        - Author-date: Smith^1 or Smith (1)
        - Numbered: (1), (2)

    Reference list:
        - Numbered: (1) Authors. Title. Journal Year, Volume, Pages.
        - Format: Authors. Title. Journal Abbrev. Year, Volume, Pages.
        - Semicolon between author segments

Key characteristics:
    - Superscript citations common
    - Journal abbreviations
    - Semicolon separators between author names
    - Title not in quotes

Reference:
    https://pubs.acs.org/referencing
    https://www.acsorg/content/acs/en/about/governance/committees/resources/guidedtour.html
"""

from __future__ import annotations

import re

from integrity_checker.extraction.patterns.base import CompiledPattern, PatternType
from integrity_checker.extraction.patterns.registry import register_format
from integrity_checker.matching.author_parser import Author, normalize_author, parse_authors
from integrity_checker.models.citation import Citation, CitationStyle, CitationType

# =============================================================================
# ACS Pattern Definitions
# =============================================================================

# --- In-text ACS patterns ---

# Superscript numbers: ^1, ^2, ^14b (math-safe)
_ACS_SUPERSCRIPT = CompiledPattern.create(
    name="acs_superscript",
    pattern=r"(?:(?<=^)|(?<=[A-Za-zÀ-ÿ]{2})|(?<=[A-Za-zÀ-ÿ]{2}[.,;:\])]))\^(\d{1,3}[a-z]?(?:\s*[,–-]\s*(?:\d{1,3}[a-z]?|[a-z]))*)(?![A-Za-z0-9])",
    pattern_type=PatternType.IN_TEXT,
    description="ACS superscript: ^1 | ^2 | ^14b",
)

# Superscript with author: Smith^1, Smith^14b, Zhang^14c
_ACS_AUTHOR_SUPERSCRIPT = CompiledPattern.create(
    name="acs_author_superscript",
    pattern=(
        r"(?!(?:However|Moreover|Furthermore|Therefore|Nevertheless|Consequently|Previously|"
        r"Recently|Although|Whereas|Notably|Specifically|Similarly|Meanwhile|Table|Figure|"
        r"Scheme|Equation|Section|Chapter|Appendix|Entry|Step|Part|Compound|Catalysis|"
        r"Synthesis|Reaction|Method|Results|Discussion|Conclusion|Introduction)\^)"
        r"\b([A-Z][a-zA-ZÀ-ž'-]+)\^(\d{1,3}[a-z]?(?:\s*[,–-]\s*(?:\d{1,3}[a-z]?|[a-z]))*)(?![A-Za-z0-9])"
    ),
    pattern_type=PatternType.IN_TEXT,
    description="ACS author-superscript: Smith^1 | Smith^14b",
)

# Parenthesized numbers: (1), (2) — kept only as reference marker, NOT in in_text_patterns
_ACS_PARENTHESIZED = CompiledPattern.create(
    name="acs_parenthesized",
    pattern=r"\((\d+)\)",
    pattern_type=PatternType.UTILITY,
    description="ACS parenthesized: (1) | (2)",
)

# FIX: removed _ACS_COMMA_SEPARATED — pattern `(\d+)(?:,\s*\d+)+` matches data like
# 100,000 / 1,371 (population numbers), not just citation [1,2]. IEEE/Vancouver
# brackets already cover legitimate comma-separated citations.

# --- Reference list ACS patterns ---

_ACS_SUB_PREFIX = r"(?:(?:\(\s*[a-z]\s*\)|[a-z]\))\s+)?"
_ACS_PREFIX = (
    r"^(?:(?:\(\s*(?P<index>\d+)\s*\)|(?P<num>\d+)\.|\[\s*(?P<b_idx>\d+)\s*\])\s*"
    + _ACS_SUB_PREFIX
    + r"|(?!\s*(?:\(\s*\d+\s*\)|\d+\.\s|\[\s*\d+\s*\]))"
    + _ACS_SUB_PREFIX
    + r")"
)

_JZ_STARTS_JOURNAL_LOOKAHEAD = (
    r"\s+(?:[A-Z][a-z]+|of\b|f[uü]r\b|de\b|la\b)"
    r"(?!(?:(?!(?:18|19|20)\d{2}\b)[^;])*?\b[A-Za-zÀ-ÿ'\u2019\-]{2,}\s+[A-Za-zÀ-ÿ'\u2019\-]{4,}\.\s+[A-Z])"
    r"(?!(?:(?!(?:18|19|20)\d{2}\b)[^;])*?\s+(?!(?:of|the|and|in|on|for|to|a|an|de|la|le|du|des|et|f[uü]r|und|der)\b)[a-zà-ÿ]{3,}\b)"
)

_ACS_AUTHOR_STOP_GUARD = (
    r"(?!(?:[JZ]\.(?!" + _JZ_STARTS_JOURNAL_LOOKAHEAD + r")"
    r"|[A-IK-YÀ-Ý]\."
    r"|(?:(?:van|de|den|der|von|del|da|di|le|la|du|al|el)\s+)?[A-ZÀ-Ý][a-zà-ÿ'\u2019\-]+(?:\s*[,;]|\s+(?:and|&|et\s+al)\b)"
    r"|;|and\b|&|et\s+al\.))"
)

_RSC_INIT_TOKEN = r"(?:[A-ZÀ-Ý]\.?-[A-ZÀ-Ý]\.\s*|[A-ZÀ-Ý]\.\s*)+"
_RSC_SURNAME_TOKEN = (
    r"(?:(?:de|van|den|der|von|del|da|di|le|la|du|al|el)(?:\s+|-)|d'|St\.\s+|Mc\s+|Mac\s+)?"
    r"[A-ZÀ-Ý][A-Za-zÀ-ÿ'\u2019\-]+(?!\.)"
)
_RSC_SINGLE_AUTHOR = rf"{_RSC_INIT_TOKEN}{_RSC_SURNAME_TOKEN}"
_RSC_AUTHORS_GROUP = (
    rf"(?P<authors>{_RSC_SINGLE_AUTHOR}"
    rf"(?:\s*(?:,\s*(?:and\s+|&\s*)?|;\s*(?:and\s+|&\s*)?|\s+(?:and|&)\s+){_RSC_SINGLE_AUTHOR})*"
    rf"(?:,?\s+et\s+al\.?)?)"
)

_TITLE_CONNECTORS: frozenset[str] = frozenset(
    {
        "of", "the", "and", "in", "on", "for", "to", "a", "an",
        "de", "la", "le", "du", "des", "et", "fur", "für", "und", "der", "&",
    }
)

_COMMA_VENUE_SUBTITLE_RE = re.compile(
    r"^(?:"
    r"International\s+Edition(?:\s+in\s+English)?|"
    r"Int\.\s*Ed\.(?:\s*Engl\.)?|"
    r"(?:Dalton|Perkin|Faraday)\s+Trans(?:actions|\.)?(?:\s+[I12]+)?|"
    r"Chem(?:ical|\.)\s+Commun(?:ications|\.)?|"
    r"(?:Part|Series|Ser\.|Section|Sect\.)\s+[A-Z0-9]+(?:\b|:)"
    r")$",
    flags=re.IGNORECASE,
)

_COMMA_JOURNAL_HEAD_RE = re.compile(
    r"^(?:"
    r"Angewandte\s+Chemie\b|"
    r"Journal\s+(?:of|f[uü]r|de)\b|"
    r"Proceedings\s+of\b|"
    r"Transactions\s+of\b|"
    r"Bulletin\s+(?:of|de|des)\b|"
    r"Annals\s+of\b|"
    r"Annales\s+de\b|"
    r"Comptes\s+Rendus\b|"
    r"Acta\s+[A-Z][a-z]+|"
    r"Zeitschrift\s+f[uü]r\b|"
    r"Philosophical\s+Transactions\b"
    r")",
    flags=re.IGNORECASE,
)

# RSC / Wiley / Angewandte initials-first comma-delimited journal article:
# 14. Y. Zhang and X. Liu, Chem. Sci., 2020, 11, 1234–1240, DOI: 10.1039/D0SC00111A.
# [14] Y. Zhang, X. Liu, Angew. Chem. Int. Ed. 2020, 59, e202201234.
_ACS_REFERENCE_RSC_WILEY = CompiledPattern.create(
    name="acs_reference_rsc_wiley",
    pattern=(
        _ACS_PREFIX
        + _RSC_AUTHORS_GROUP
        + r",\s+"
        + r"(?P<mid>[A-Z\"\u201c'\u2018][^;]{1,260}?)(?:,\s*|\s+)"
        + r"(?P<year>(?:18|19|20)\d{2})\s*,\s*"
        + r"(?P<volume>[A-Za-z]?\d+)"
        + r"(?:\s*\((?P<issue>[^)]+)\))?"
        + r"(?:\s*,\s*(?:pp?\.\s*)?(?P<pages>[A-Za-z]?\d{1,12}(?:\s*[-–—]\s*[A-Za-z]?\d{1,12})?))?"
        + r"\.?\s*(?P<rest>.*)$"
    ),
    pattern_type=PatternType.REFERENCE_ENTRY,
    description="RSC/Wiley journal: N. I. Surname, [Title,] Journal, Year, Vol, Pages.",
)

# APS / AIP initials-first compact physics article:
# [14] Y. Zhang and X. Liu, Phys. Rev. Lett. 124, 123001 (2020).
_ACS_REFERENCE_APS_COMPACT = CompiledPattern.create(
    name="acs_reference_aps_compact",
    pattern=(
        _ACS_PREFIX
        + _RSC_AUTHORS_GROUP
        + r",\s+"
        + r"(?P<mid>[A-Z\"\u201c'\u2018][^;]{1,260}?)(?:,\s*|\s+)"
        + r"(?P<volume>\d+)"
        + r"(?:\s*\((?P<issue>[^)]+)\))?\s*,\s*"
        + r"(?:pp?\.\s*)?(?P<pages>[A-Za-z]?\d{1,12}(?:\s*[-–—]\s*[A-Za-z]?\d{1,12})?)\s*"
        + r"\(\s*(?P<year>(?:18|19|20)\d{2}[a-z]?)\s*\)"
        + r"\.?\s*(?P<rest>.*)$"
    ),
    pattern_type=PatternType.REFERENCE_ENTRY,
    description="APS compact journal: [N] I. Surname, [Title,] Journal Vol, Pages (Year).",
)

# ACS article:
# (1) Authors. Title. Journal Abbrev. Year, Volume (Issue), Pages.
# or 1. Authors. Title. Journal Year, Volume, Pages.
_ACS_REFERENCE_ARTICLE = CompiledPattern.create(
    name="acs_reference_article",
    pattern=(
        _ACS_PREFIX
        + r"(?P<authors>.+?)\.\s+"
        + _ACS_AUTHOR_STOP_GUARD  # Authors. (don't stop at initial)
        + r"(?P<title>[^.]{5,}?)\.\s+"  # Title (at least 5 chars, not an abbrev token like J. or Am.).
        + r"(?P<venue>[^;]+?)\.?\s+"  # Journal (with or without abbreviation period)
        + r"(?P<year>(?:19|20)\d{2})\s*,\s*"  # Year,
        + r"(?P<volume>\d+)"  # Volume
        + r"(?:\s*\((?P<issue>[^)]+)\))?"  # Optional (Issue)
        + r"(?:\s*,\s*(?:pp?\.\s*)?(?P<pages>[\d–-]+|[a-zA-Z]?\d+))?"  # , Pages
        + r"\.?\s*(?P<rest>.*)$"
    ),
    pattern_type=PatternType.REFERENCE_ENTRY,
    description="ACS article: (N) Authors. Title. Journal Year, Vol, Pages.",
)

# ACS article with abbreviation (title optional, since ACS style allows omitting article titles):
# (1) Authors. Title. J. Abbrev. Year, Volume, Pages.
# or (1) Authors. J. Abbrev. Year, Volume, Pages.
_ACS_REFERENCE_JOURNAL_ABBREV = CompiledPattern.create(
    name="acs_reference_journal_abbrev",
    pattern=(
        _ACS_PREFIX
        + r"(?P<authors>.+?)\.\s+"
        + _ACS_AUTHOR_STOP_GUARD
        + r"(?:(?P<title>[^.]{5,}?)\.\s+)?"
        + r"(?P<venue>[A-Z][^;0-9]+?)(?:\.\s*|\s+)"
        + r"(?P<year>(?:19|20)\d{2})(?!\s*;)"
        + r"(?:,\s*(?P<volume>\d+))"
        + r"(?:\s*\((?P<issue>[^)]+)\))?"
        + r"(?:,\s*(?:pp?\.\s*)?(?P<pages>[A-Za-z]?[\d–-]+))?"
        + r"\.?\s*(?P<rest>.*)$"
    ),
    pattern_type=PatternType.REFERENCE_ENTRY,
    description="ACS journal: (N) Authors. [Title.] J. Abbrev. Year, Vol, Pages.",
)

# ACS article with DOI:
# (1) Authors. Title. Journal Year, Volume, Pages. doi:...
_ACS_REFERENCE_DOI = CompiledPattern.create(
    name="acs_reference_doi",
    pattern=(
        _ACS_PREFIX
        + r"(?P<authors>.+?)\.\s+"
        + _ACS_AUTHOR_STOP_GUARD
        + r"(?P<title>[^.]{5,}?)\.\s+"
        + r"(?P<venue>[^;]+?)\.?\s+"
        + r"(?P<year>(?:19|20)\d{2})(?!\s*;)"
        + r"(?:\s*,\s*(?P<volume>\d+))?"
        + r"(?:\s*\((?P<issue>[^)]+)\))?"
        + r"(?:\s*,\s*(?:pp?\.\s*)?(?P<pages>[\d–-]+))?"
        + r"\.?\s*doi:\s*(?P<doi>\S+?)\.?"
        + r"$"
    ),
    pattern_type=PatternType.REFERENCE_ENTRY,
    description="ACS with DOI: (N) Authors. Title. Journal. Year. doi:...",
)

# ACS book:
# (1) Authors. Book Title; Publisher: Place, Year.
_ACS_BOOK = CompiledPattern.create(
    name="acs_book",
    pattern=(
        _ACS_PREFIX
        + r"(?P<authors>.+?)\.\s+(?!(?:[A-ZÀ-Ý]\.|;|and\b))"
        + r"(?P<title>[^;]+?);\s*"
        + r"(?P<publisher>[A-Za-zÀ-ÿ][^:;]{1,80}?):\s*"
        + r"(?P<place>(?!https?://)[A-Za-zÀ-ÿ][^,;:]{1,60}?),\s*"
        + r"(?P<year>(?:19|20)\d{2})\.?"
        + r"(?P<rest>.*)$"
    ),
    pattern_type=PatternType.REFERENCE_ENTRY,
    description="ACS book: (N) Authors. Title; Publisher: Place, Year.",
)

# ACS book chapter:
# (1) Authors. Chapter Title. In Book Title; Editor, Ed.; Publisher: Place, Year; pp. XX-XX.
_ACS_BOOK_CHAPTER = CompiledPattern.create(
    name="acs_book_chapter",
    pattern=(
        _ACS_PREFIX
        + r"(?P<authors>[A-ZÀ-Ý][^\n]{2,120}?)\.\s+(?!(?:[A-ZÀ-Ý]\.|;|and\b))"
        + r"(?P<chapter_title>[^.]{3,200}?)\.\s+"
        + r"In\s+"
        + r"(?P<book_title>[^;]+?)(?:;\s*|,\s*)"
        + r"(?:(?P<editor>[^;]+),\s*(?:Eds?\.?|eds?\.?))?"
        + r"(?:;\s*(?P<publisher>[^:;]+?))?"
        + r"(?::\s*(?P<place>[^,;]+?))?"
        + r",\s*(?P<year>(?:19|20)\d{2})\b"
        + r"(?:;\s*pp?\.\s*(?P<pages>[\d–-]+))?"
        + r"(?P<rest>.*)$"
    ),
    pattern_type=PatternType.REFERENCE_ENTRY,
    description="ACS book chapter: (N) Authors. Chapter. In Book; Editor, Ed.; Publisher, Year.",
)

# ACS tech report:
# (1) Authors. Title; Tech. Rep. / Technical Report / Patent, Institution, Year.
_ACS_TECH_REPORT = CompiledPattern.create(
    name="acs_tech_report",
    pattern=(
        r"^\(\s*(?P<index>\d+)\s*\)\s*"
        r"(?P<authors>.+?)\.\s+(?!(?:[A-ZÀ-Ý]\.|;|and\b))"
        r"(?P<title>[^;]+?);\s*"
        r"(?P<rest>(?:Tech\.\s*Rep\.|Technical\s+Report|Patent|Abstract).+)"
        r"$"
    ),
    pattern_type=PatternType.REFERENCE_ENTRY,
    description="ACS tech report: (N) Authors. Title; Institution, Year.",
)

# --- Utility pattern ---

_ACS_NUMBER_MARKER = CompiledPattern.create(
    name="acs_number_marker",
    pattern=r'^\s*\(\d+\)\s*',
    pattern_type=PatternType.UTILITY,
    description="ACS number marker: (N)",
)


# =============================================================================
# ACS Format Implementation
# =============================================================================


class ACSFormat:
    """ACS citation format implementation.

    ACS style is commonly used in:
        - Chemistry
        - Chemical engineering
        - Materials science
        - Biochemistry

    Key characteristics:
        - Superscript citations common
        - Journal abbreviations
        - Semicolon separators between author names
        - Title not in quotes

    This implementation handles:
        - In-text numeric citations: ^1, (1)
        - Reference list entries for articles, books, chapters, tech reports
        - Parenthesized number format: (1)
    """

    @property
    def name(self) -> str:
        """Format name."""
        return "ACS"

    @property
    def priority(self) -> int:
        """Priority for format resolution (higher = try first).

        ACS is common in chemistry but similar to other numeric styles.
        Priority 76 (similar to AMA, Nature).
        """
        return 76

    @property
    def in_text_patterns(self) -> list[CompiledPattern]:
        """Patterns for extracting ACS in-text citations."""
        return [
            _ACS_AUTHOR_SUPERSCRIPT,
            _ACS_SUPERSCRIPT,
            # FIX: removed _ACS_PARENTHESIZED and _ACS_COMMA_SEPARATED — matches (1), (2)
            # and numbers with commas in body text.
        ]

    @property
    def reference_patterns(self) -> list[CompiledPattern]:
        """Patterns for extracting ACS reference list entries."""
        return [
            _ACS_REFERENCE_RSC_WILEY,
            _ACS_REFERENCE_APS_COMPACT,
            _ACS_REFERENCE_DOI,
            _ACS_REFERENCE_ARTICLE,
            _ACS_REFERENCE_JOURNAL_ABBREV,
            _ACS_BOOK_CHAPTER,
            _ACS_BOOK,
            _ACS_TECH_REPORT,
        ]

    def parse_reference_entry(self, text: str) -> Citation | None:
        """Parse ACS reference entry into Citation object.

        Args:
            text: Raw reference entry text

        Returns:
            Citation object if successfully parsed, None otherwise

        Examples:
            >>> text = "(1) Smith, J.; Jones, A. Article Title. J. Chem. 2020, 10, 123-145."
            >>> citation = ACSFormat().parse_reference_entry(text)
            >>> citation.authors
            ['Smith, J.', 'Jones, A.']
            >>> citation.year
            '2020'
        """
        # Normalize whitespace
        text = re.sub(r'\s+', ' ', text.strip())

        # Extract numeric index first: (1), 1., or [1]
        numeric_index = None
        idx_match = re.match(r'^(?:\(\s*(\d+)\s*\)|(\d+)\.|\[\s*(\d+)\s*\])\s*', text)
        if idx_match:
            numeric_index = int(idx_match.group(1) or idx_match.group(2) or idx_match.group(3))

        # Try RSC / Wiley / APS initials-first comma-delimited journal formats first
        citation = self._try_parse_rsc_wiley(text)
        if citation:
            if numeric_index and citation.numeric_index is None:
                citation.numeric_index = numeric_index
            return citation

        # Try article with DOI format first (most specific)
        citation = self._try_parse_article_doi(text)
        if citation:
            if numeric_index and citation.numeric_index is None:
                citation.numeric_index = numeric_index
            return citation

        # Try standard article format
        citation = self._try_parse_article(text)
        if citation:
            if numeric_index and citation.numeric_index is None:
                citation.numeric_index = numeric_index
            return citation

        # Try journal abbreviation format
        citation = self._try_parse_journal_abbrev(text)
        if citation:
            if numeric_index and citation.numeric_index is None:
                citation.numeric_index = numeric_index
            return citation

        # Try book chapter format
        citation = self._try_parse_book_chapter(text)
        if citation:
            if numeric_index and citation.numeric_index is None:
                citation.numeric_index = numeric_index
            return citation

        # Try book format
        citation = self._try_parse_book(text)
        if citation:
            if numeric_index and citation.numeric_index is None:
                citation.numeric_index = numeric_index
            return citation

        # Try tech report format
        citation = self._try_parse_tech_report(text)
        if citation:
            if numeric_index and citation.numeric_index is None:
                citation.numeric_index = numeric_index
            return citation

        # Fallback
        return self._parse_acs_fallback(text)

    def _try_parse_rsc_wiley(self, text: str) -> Citation | None:
        """Try to parse RSC / Wiley / APS initials-first comma-delimited journal formats."""
        for compiled, pattern_name in (
            (_ACS_REFERENCE_RSC_WILEY, "acs_reference_rsc_wiley"),
            (_ACS_REFERENCE_APS_COMPACT, "acs_reference_aps_compact"),
        ):
            match = compiled.search(text)
            if match:
                parsed = self._parse_rsc_wiley_entry(match, text, pattern_name=pattern_name)
                if parsed is not None:
                    return parsed
        return None

    def _try_parse_article(self, text: str) -> Citation | None:
        """Try to parse ACS article format."""
        match = _ACS_REFERENCE_ARTICLE.search(text)
        if match:
            return self._parse_article_entry(match, text)
        return None

    def _try_parse_article_doi(self, text: str) -> Citation | None:
        """Try to parse ACS article with DOI format."""
        match = _ACS_REFERENCE_DOI.search(text)
        if match:
            return self._parse_article_doi_entry(match, text)
        return None

    def _try_parse_journal_abbrev(self, text: str) -> Citation | None:
        """Try to parse ACS journal abbreviation format."""
        match = _ACS_REFERENCE_JOURNAL_ABBREV.search(text)
        if match:
            return self._parse_journal_abbrev_entry(match, text)
        return None

    def _try_parse_book(self, text: str) -> Citation | None:
        """Try to parse ACS book format."""
        match = _ACS_BOOK.search(text)
        if match:
            return self._parse_book_entry(match, text)
        return None

    def _try_parse_book_chapter(self, text: str) -> Citation | None:
        """Try to parse ACS book chapter format."""
        match = _ACS_BOOK_CHAPTER.search(text)
        if match:
            return self._parse_book_chapter_entry(match, text)
        return None

    def _try_parse_tech_report(self, text: str) -> Citation | None:
        """Try to parse ACS tech report format."""
        match = _ACS_TECH_REPORT.search(text)
        if match:
            return self._parse_tech_report_entry(match, text)
        return None

    @staticmethod
    def _has_incomplete_author_segment(authors_str: str) -> bool:
        """Return True when ``authors_str`` stopped prematurely on a bare initial or swallowed a title/venue."""
        cleaned = (authors_str or "").strip()
        if not cleaned or not re.search(r"[A-Za-zÀ-ÿ]{2,}", cleaned):
            return True
        if re.match(r"^(?:\(\s*[a-z]\s*\)|[a-z]\))\s+", cleaned):
            return True
        _init_only_re = r"(?:[A-ZÀ-Ý]\.?-[A-ZÀ-Ý]\.?\s*|[A-ZÀ-Ý]\.?\s*)+"
        _surname_init_swallowed_re = re.compile(
            r"^(?:(?:van|de|den|der|von|del|da|di|le|la|du|al|el)\s+)?"
            r"[A-ZÀ-Ý][a-zà-ÿ'\u2019\-]+\s*,\s*"
            r"(?:[A-ZÀ-Ý]\.?-[A-ZÀ-Ý]\.\s*|[A-ZÀ-Ý]\.\s*)+"
            r"(?!Jr\.?\b|Sr\.?\b|II\b|III\b|IV\b)[A-Za-zÀ-ÿ]{2,}"
        )
        for seg in re.split(r"\s*(?:;|\band\b|&)\s*", cleaned):
            seg_s = seg.strip()
            if not seg_s:
                continue
            if re.fullmatch(_init_only_re, seg_s):
                return True
            if _surname_init_swallowed_re.match(seg_s):
                return True
        for cseg in [s.strip() for s in cleaned.split(",") if s.strip()]:
            if re.match(r"^(?:and\b|&|et\s+al\.?|Jr\.?|Sr\.?|II|III|IV)", cseg, re.IGNORECASE):
                continue
            c_words = [w for w in cseg.split() if w.lower() not in _TITLE_CONNECTORS]
            if len(c_words) >= 3 and not re.search(r"[A-ZÀ-Ý]\.|;", cseg):
                return True
        if re.match(rf"^{_RSC_INIT_TOKEN}[A-ZÀ-Ý][a-zà-ÿ'\u2019\-]+", cleaned):
            for cseg in [s.strip() for s in cleaned.split(",") if s.strip()]:
                if re.match(r"^et\s+al\.?$", cseg, re.IGNORECASE):
                    continue
                if re.fullmatch(_init_only_re, cseg):
                    return True
                if not re.search(r"[A-ZÀ-Ý]\.", cseg):
                    return True
        return False

    @staticmethod
    def _parse_rsc_authors(authors_str: str) -> list[Author]:
        """Parse RSC / Wiley / APS initials-first author list without Oxford-comma ambiguity."""
        cleaned = re.sub(r",?\s+et\s+al\.?\s*$", "", (authors_str or "").strip(), flags=re.I)
        if not cleaned:
            return []
        segments = [
            s.strip()
            for s in re.split(
                r"\s*(?:[,;]\s*(?:(?:and|&)\s+)?|\s+(?:and|&)\s+)\s*",
                cleaned,
            )
            if s.strip()
        ]
        if not segments:
            return []

        single_re = re.compile(rf"^(?P<inits>{_RSC_INIT_TOKEN})(?P<surname>{_RSC_SURNAME_TOKEN})$")
        parsed: list[Author] = []
        for seg in segments:
            m_seg = single_re.match(seg)
            if not m_seg:
                return []
            inits_raw = m_seg.group("inits").strip()
            surname_raw = m_seg.group("surname").strip()
            inits_norm = re.sub(r"\.?-", ". ", inits_raw)
            a_obj = normalize_author(f"{surname_raw}, {inits_norm}")
            if not a_obj.last_name.strip():
                return []
            parsed.append(
                Author(
                    last_name=a_obj.last_name,
                    initials=a_obj.initials,
                    full_first_names=a_obj.full_first_names,
                    normalized=a_obj.normalized,
                    raw=seg,
                )
            )
        return parsed

    @staticmethod
    def _is_unquoted_title_split(left_full: str, right: str | None = None) -> bool:
        """Structural ISO-4 vs unquoted sentence/article title detector (allowlist-free).

        In any ISO-4 abbreviated journal (``Org. Biomol. Chem.``, ``ACS Cent. Sci.``,
        ``ACS Sustain. Chem. Eng.``, ``Proc. Natl. Acad. Sci. U. S. A.``,
        ``Bioorg. Med. Chem. Lett.``, ``Chin. J. Chem.``), every non-connector word
        before a ``. `` either ends with ``.`` or is an all-caps acronym. An unquoted
        article title before ``. Journal`` has >= 2 words in the clause before ``.``
        where at least one prior non-connector word neither ends with ``.`` nor is an
        all-caps acronym, or contains lowercase non-connector content words.
        """
        if right is not None:
            right_clean = right.strip().rstrip(",").strip()
            if not right_clean or not re.match(r"^[A-Z]", right_clean):
                return False
            if re.fullmatch(r"[A-Za-z]{1,6}\.", right_clean):
                return False

        parts = re.split(r"(?<=\.)\s+", (left_full or "").strip())
        clause = parts[-1].strip() if parts else ""
        tokens = [
            t.strip(",:()\"'\u201c\u201d[]")
            for t in clause.split()
            if t.strip(",:()\"'\u201c\u201d[]")
        ]
        if len(tokens) < 2:
            return False
        last_stem = re.sub(r"[^A-Za-zÀ-ÿ]", "", tokens[-1].rstrip("."))
        if len(last_stem) < 4:
            return False

        non_conn = [t for t in tokens if t.rstrip(".").lower() not in _TITLE_CONNECTORS]
        if len(non_conn) < 2:
            return False
        if any(t[0].islower() for t in non_conn if t[0].isalpha()):
            return True

        if (
            parts[:-1]
            and all(
                all(
                    w.endswith(".")
                    or bool(re.fullmatch(r"[A-Z0-9]{1,8}", w))
                    or w.lower() in _TITLE_CONNECTORS
                    for w in p.split()
                )
                for p in parts[:-1]
            )
            and len(tokens) == 2
            and len(last_stem) <= 5
        ):
            return False

        prior_tokens = [t for t in tokens[:-1] if t.rstrip(".").lower() not in _TITLE_CONNECTORS]
        unabbrev_prior = [
            t
            for t in prior_tokens
            if not t.endswith(".") and not re.fullmatch(r"[A-Z0-9]{2,8}", t)
        ]
        return len(unabbrev_prior) >= 1

    @classmethod
    def _split_rsc_title_and_venue(cls, mid_raw: str) -> tuple[str | None, str | None]:
        """Split RSC/Wiley/APS ``mid`` field into ``(title, venue)`` without swallowing titles."""
        mid = (mid_raw or "").strip().rstrip(",").strip()
        if not mid or len(mid) < 2:
            return None, None

        # 1. Quoted title: "Title," Chem. Sci.
        q_m = re.match(
            r"^[\"\u201c'\u2018](?P<qt>[^\"\u201d'\u2019]{4,})[\"\u201d'\u2019][,.]?\s+(?P<qv>.+)$",
            mid,
        )
        if q_m:
            qt = q_m.group("qt").strip().rstrip(",.")
            qv = q_m.group("qv").strip().rstrip(",").strip()
            if not qv or re.search(r"\bvol\.\s*$", qv, re.I):
                return None, None
            return qt, qv

        # 2. Period-separated unquoted title: "Quantum Gravity Hallucination. Chem. Sci."
        for m_dot in reversed(list(re.finditer(r"\.\s+", mid))):
            left = mid[: m_dot.start()].strip()
            left_with_dot = mid[: m_dot.start() + 1].strip()
            right = mid[m_dot.end() :].strip().rstrip(",").strip()
            if not left or not right or not re.match(r"^[A-Z]", right):
                continue
            if cls._is_unquoted_title_split(left_with_dot, right):
                if re.search(r"\bvol\.\s*$", right, re.I) or len(right) > 85:
                    return None, None
                return left.rstrip(",."), right

        # 3. Unquoted comma-delimited RSC title: "Nickel-Catalyzed Cross-Coupling..., Chem. Sci."
        # Preserve legitimate comma-containing journals such as "Angew. Chem., Int. Ed.",
        # "Angewandte Chemie, International Edition", and
        # "Journal of the Chemical Society, Dalton Transactions".
        comma_parts = [p.strip() for p in re.split(r",\s+", mid) if p.strip()]
        if len(comma_parts) >= 2:
            for idx in range(len(comma_parts) - 1, 0, -1):
                cand_title = ", ".join(comma_parts[:idx]).strip()
                cand_venue = ", ".join(comma_parts[idx:]).strip().rstrip(",").strip()
                if cand_title.endswith(".") or len(cand_title) < 8:
                    continue
                if _COMMA_VENUE_SUBTITLE_RE.match(cand_venue) or _COMMA_JOURNAL_HEAD_RE.match(
                    cand_title
                ):
                    continue
                unabbrev_words = re.findall(r"\b[A-Za-zÀ-ÿ'\u2019\-]{3,}\b(?!\.)", cand_title)
                if (
                    len(unabbrev_words) >= 2
                    and re.match(r"^[A-Z]", cand_venue)
                    and len(cand_venue) <= 85
                    and not re.search(r"\bvol\.\s*$", cand_venue, re.I)
                ):
                    return cand_title.rstrip(",."), cand_venue

        # 4. Title-less journal venue
        if (
            len(mid) > 85
            or re.search(r"\bvol\.\s*$", mid, re.I)
            or re.search(r"[;:?!]", mid)
        ):
            return None, None
        return None, mid

    def _parse_rsc_wiley_entry(
        self,
        match: re.Match,
        text: str,
        *,
        pattern_name: str = "acs_reference_rsc_wiley",
    ) -> Citation | None:
        """Parse RSC / Wiley / APS initials-first comma-delimited journal entry."""
        authors_str = (match.group("authors") or "").strip()
        if not authors_str:
            return None
        authors = self._parse_rsc_authors(authors_str)
        if not authors:
            return None

        parsed_title, venue_raw = self._split_rsc_title_and_venue(
            match.groupdict().get("mid") or ""
        )
        if not venue_raw or len(venue_raw) < 2:
            return None

        citation = Citation(
            raw_text=text,
            citation_type=CitationType.REFERENCE_LIST,
            style=CitationStyle.ACS,
            matched_pattern=pattern_name,
            authors=authors,
            venue=venue_raw,
        )

        index = (
            match.groupdict().get("index")
            or match.groupdict().get("num")
            or match.groupdict().get("b_idx")
        )
        if index:
            citation.numeric_index = int(index)

        if parsed_title:
            citation.title = parsed_title
            citation.title_normalized = self._normalize_title(parsed_title)
        else:
            citation.title = None
            citation.title_normalized = None

        year_str = match.groupdict().get("year")
        if year_str:
            yr_m = re.match(r"(\d{4})([a-z]?)", year_str.strip())
            if yr_m:
                citation.year = yr_m.group(1)
                if yr_m.group(2):
                    citation.year_suffix = yr_m.group(2)
            else:
                citation.year = year_str.strip()

        volume = match.groupdict().get("volume")
        if volume:
            citation.volume = volume.strip()
        issue = match.groupdict().get("issue")
        if issue:
            citation.issue = issue.strip()
        pages = match.groupdict().get("pages")
        if pages:
            citation.pages = re.sub(r"\s+", "", pages.strip())

        doi_match = re.search(r"10\.\d{4,9}/[^\s\]\)\,;]+", text)
        if doi_match:
            citation.doi = doi_match.group(0).rstrip(".")

        citation.confidence = self._estimate_confidence(citation)
        return citation

    def _parse_article_entry(
        self, match: re.Match, text: str
    ) -> Citation | None:
        """Parse ACS article entry."""
        authors_str = match.group('authors')
        if not authors_str or self._has_incomplete_author_segment(authors_str):
            return None
        venue = match.group('venue').strip()
        raw_title = (match.groupdict().get('title') or '').strip()
        if raw_title and not self._is_unquoted_title_split(f"{raw_title}.", venue):
            return None
        parsed_authors = self._parse_authors(authors_str)
        if not parsed_authors:
            return None

        citation = Citation(
            raw_text=text,
            citation_type=CitationType.REFERENCE_LIST,
            style=CitationStyle.ACS,
            matched_pattern="acs_reference_article",
            authors=parsed_authors,
        )

        # Extract numeric index
        index = match.groupdict().get('index') or match.groupdict().get('num') or match.groupdict().get('b_idx')
        if index:
            citation.numeric_index = int(index)

        # Extract venue
        citation.venue = venue

        # Extract title (optional in ACS journal citations)
        if raw_title:
            citation.title = raw_title
            citation.title_normalized = self._normalize_title(raw_title)
        elif venue:
            citation.title = venue
            citation.title_normalized = self._normalize_title(venue)

        # Extract year
        year_str = match.group('year')
        if year_str:
            citation.year = year_str

        # Extract volume, issue, and pages
        volume = match.group('volume')
        if volume:
            citation.volume = volume
            issue = match.groupdict().get('issue')
            if issue:
                citation.issue = issue
            pages = match.group('pages')
            if pages:
                citation.pages = pages

        # Extract DOI if present
        doi_match = re.search(r'10\.\d{4,9}/[^\s\]\)\,;]+', text)
        if doi_match:
            citation.doi = doi_match.group(0).rstrip('.')

        citation.confidence = self._estimate_confidence(citation)
        return citation

    def _parse_article_doi_entry(
        self, match: re.Match, text: str
    ) -> Citation | None:
        """Parse ACS article with DOI entry."""
        authors_str = match.group('authors')
        if not authors_str or self._has_incomplete_author_segment(authors_str):
            return None
        venue = match.group('venue').strip()
        raw_title = (match.groupdict().get('title') or '').strip()
        if raw_title and not self._is_unquoted_title_split(f"{raw_title}.", venue):
            venue = f"{raw_title}. {venue}"
            raw_title = ""
        parsed_authors = self._parse_authors(authors_str)
        if not parsed_authors:
            return None

        citation = Citation(
            raw_text=text,
            citation_type=CitationType.REFERENCE_LIST,
            style=CitationStyle.ACS,
            matched_pattern="acs_reference_doi",
            authors=parsed_authors,
        )

        # Extract numeric index
        index = match.groupdict().get('index') or match.groupdict().get('num') or match.groupdict().get('b_idx')
        if index:
            citation.numeric_index = int(index)

        # Extract venue
        citation.venue = venue

        # Extract title (optional in ACS journal citations)
        if raw_title:
            citation.title = raw_title
            citation.title_normalized = self._normalize_title(raw_title)
        elif venue and match.groupdict().get('index'):
            citation.title = venue
            citation.title_normalized = self._normalize_title(venue)

        # Extract year
        year_str = match.group('year')
        if year_str:
            citation.year = year_str

        # Extract volume, issue, and pages
        volume = match.group('volume')
        if volume:
            citation.volume = volume
            issue = match.groupdict().get('issue')
            if issue:
                citation.issue = issue
            pages = match.group('pages')
            if pages:
                citation.pages = pages

        # Extract DOI
        doi = match.group('doi')
        if doi:
            citation.doi = doi.strip().rstrip('.')
        else:
            doi_match = re.search(r'10\.\d{4,9}/[^\s\]\)\,;]+', text)
            if doi_match:
                citation.doi = doi_match.group(0).rstrip('.')

        citation.confidence = self._estimate_confidence(citation)
        return citation

    def _parse_journal_abbrev_entry(
        self, match: re.Match, text: str
    ) -> Citation | None:
        """Parse ACS journal abbreviation entry."""
        authors_str = match.group('authors')
        if not authors_str or self._has_incomplete_author_segment(authors_str):
            return None
        parsed_authors = self._parse_authors(authors_str)
        if not parsed_authors:
            return None

        citation = Citation(
            raw_text=text,
            citation_type=CitationType.REFERENCE_LIST,
            style=CitationStyle.ACS,
            matched_pattern="acs_reference_journal_abbrev",
            authors=parsed_authors,
        )

        # Extract numeric index
        index = match.groupdict().get('index') or match.groupdict().get('num') or match.groupdict().get('b_idx')
        if index:
            citation.numeric_index = int(index)

        # Extract venue and optional title without splitting ISO-4 journal stems
        venue = match.group('venue').strip()
        raw_title = (match.groupdict().get('title') or '').strip()
        if raw_title and not self._is_unquoted_title_split(f"{raw_title}.", venue):
            venue = f"{raw_title}. {venue}"
            raw_title = ""
        citation.venue = venue

        has_sub_prefix = bool(
            re.match(
                r"^\s*(?:(?:\(\s*\d+\s*\)|\d+\.|\[\s*\d+\s*\])\s*)?(?:\(\s*[a-z]\s*\)|[a-z]\))\s+",
                text,
            )
        )
        if raw_title:
            citation.title = raw_title
            citation.title_normalized = self._normalize_title(raw_title)
        elif venue and match.groupdict().get('index') and not has_sub_prefix:
            citation.title = venue
            citation.title_normalized = self._normalize_title(venue)
        else:
            citation.title = None
            citation.title_normalized = None

        # Extract year
        year_str = match.group('year')
        if year_str:
            citation.year = year_str

        # Extract volume, issue, and pages
        volume = match.group('volume')
        if volume:
            citation.volume = volume
            issue = match.groupdict().get('issue')
            if issue:
                citation.issue = issue
            pages = match.group('pages')
            if pages:
                citation.pages = pages

        # Extract DOI if present
        doi_match = re.search(r'10\.\d{4,9}/[^\s\]\)\,;]+', text)
        if doi_match:
            citation.doi = doi_match.group(0).rstrip('.')

        citation.confidence = self._estimate_confidence(citation)
        return citation

    def _parse_book_entry(
        self, match: re.Match, text: str
    ) -> Citation | None:
        """Parse ACS book entry."""
        citation = Citation(
            raw_text=text,
            citation_type=CitationType.REFERENCE_LIST,
            style=CitationStyle.ACS,
            matched_pattern="acs_book",
        )

        # Extract numeric index
        index = match.group('index')
        if index:
            citation.numeric_index = int(index)

        # Extract authors
        authors_str = match.group('authors')
        if authors_str:
            citation.authors = self._parse_authors(authors_str)

        # Extract title
        title = match.group('title').strip()
        citation.title = title
        citation.title_normalized = self._normalize_title(title)

        # Extract publisher, place, and year
        publisher = match.group('publisher')
        place = match.group('place')
        year_str = match.group('year')

        venue_parts = []
        if publisher:
            venue_parts.append(publisher.strip())
        if place:
            venue_parts.append(place.strip())
        if venue_parts:
            citation.venue = ": ".join(venue_parts)
        if year_str:
            citation.year = year_str

        # Extract DOI if present
        doi_match = re.search(r'10\.\d{4,9}/[^\s\]\)\,;]+', text)
        if doi_match:
            citation.doi = doi_match.group(0).rstrip('.')

        citation.confidence = self._estimate_confidence(citation)
        return citation

    def _parse_book_chapter_entry(
        self, match: re.Match, text: str
    ) -> Citation | None:
        """Parse ACS book chapter entry."""
        citation = Citation(
            raw_text=text,
            citation_type=CitationType.REFERENCE_LIST,
            style=CitationStyle.ACS,
            matched_pattern="acs_book_chapter",
        )

        # Extract numeric index
        index = match.group('index')
        if index:
            citation.numeric_index = int(index)

        # Extract authors
        authors_str = match.group('authors')
        if authors_str:
            citation.authors = self._parse_authors(authors_str)

        # Extract chapter title
        chapter_title = match.group('chapter_title').strip()
        citation.title = chapter_title
        citation.title_normalized = self._normalize_title(chapter_title)

        # Extract book title (as venue)
        book_title = match.group('book_title').strip()
        editor = match.group('editor')
        publisher = match.group('publisher')
        place = match.group('place')
        year_str = match.group('year')
        pages = match.group('pages')

        venue_parts = [book_title]
        if editor:
            venue_parts.append(f"{editor.strip()}, Ed.")
        if publisher:
            venue_parts.append(publisher.strip())
        if place:
            venue_parts.append(place.strip())
        citation.venue = "; ".join(venue_parts)

        if year_str:
            citation.year = year_str
        if pages:
            citation.pages = pages

        # Extract DOI if present
        doi_match = re.search(r'10\.\d{4,9}/[^\s\]\)\,;]+', text)
        if doi_match:
            citation.doi = doi_match.group(0).rstrip('.')

        citation.confidence = self._estimate_confidence(citation)
        return citation

    def _parse_tech_report_entry(
        self, match: re.Match, text: str
    ) -> Citation | None:
        """Parse ACS tech report entry."""
        citation = Citation(
            raw_text=text,
            citation_type=CitationType.REFERENCE_LIST,
            style=CitationStyle.ACS,
            matched_pattern="acs_tech_report",
        )

        # Extract numeric index
        index = match.group('index')
        if index:
            citation.numeric_index = int(index)

        # Extract authors
        authors_str = match.group('authors')
        if authors_str:
            citation.authors = self._parse_authors(authors_str)

        # Extract title
        title = match.group('title').strip()
        citation.title = title
        citation.title_normalized = self._normalize_title(title)

        # Extract rest as venue
        rest = match.group('rest')
        if rest:
            # Try to extract year
            year_m = re.search(r'\b((?:19|20)\d{2})\b', rest)
            if year_m:
                citation.year = year_m.group(1)
            citation.venue = rest

        # Extract DOI if present
        doi_match = re.search(r'10\.\d{4,9}/[^\s\]\)\,;]+', text)
        if doi_match:
            citation.doi = doi_match.group(0).rstrip('.')

        citation.confidence = self._estimate_confidence(citation)
        return citation

    def _parse_acs_fallback(self, text: str) -> Citation | None:
        """Fallback parser: extract whatever metadata possible."""
        # ACS fallback only applies if entry starts with (N)
        idx_match = re.match(r'^\(\s*(\d+)\s*\)', text)
        if not idx_match:
            return None

        citation = Citation(
            raw_text=text,
            citation_type=CitationType.REFERENCE_LIST,
            style=CitationStyle.ACS,
            matched_pattern="acs_fallback",
            numeric_index=int(idx_match.group(1)),
        )

        # Try to extract year
        year_m = re.search(r'\b((?:19|20)\d{2})\b', text)
        if year_m:
            citation.year = year_m.group(1)

        # Try to extract title
        # In ACS, title is usually after first period and before second period
        parts = text.split('.')
        if len(parts) >= 2:
            for part in parts[1:]:
                part = part.strip()
                if len(part) > 10 and len(part) < 200:
                    citation.title = part
                    citation.title_normalized = self._normalize_title(part)
                    break

        # Extract DOI
        doi_m = re.search(r'10\.\d{4,9}/[^\s\]\)\,;]+', text)
        if doi_m:
            citation.doi = doi_m.group(0).rstrip('.')

        citation.confidence = self._estimate_confidence(citation)
        return citation if citation.title or citation.year else None

    def _parse_authors(self, authors_str: str) -> list[str]:
        """Parse author string into list of authors.

        Handles semicolon separators common in ACS.

        Args:
            authors_str: Author string

        Returns:
            List of author strings
        """
        # ACS uses semicolons between authors
        # "Smith, J.; Jones, A.; Brown, B."
        authors_str = authors_str.replace(';', ',')
        return parse_authors(authors_str)

    def _normalize_title(self, title: str) -> str:
        """Normalize title for comparison: lowercase, remove punctuation."""
        if not title:
            return ''
        t = title.lower()
        t = re.sub(r'[^\w\s]', ' ', t)
        t = re.sub(r'\s+', ' ', t)
        return t.strip()

    def _estimate_confidence(self, citation: Citation) -> float:
        """Estimate parse confidence based on extracted fields."""
        score = 0.0
        if citation.title:
            score += 0.4
        elif citation.venue and citation.volume:
            score += 0.35
        if citation.year:
            score += 0.3
        if citation.authors:
            score += 0.2
        if citation.doi:
            score += 0.1
        return min(round(score, 2), 1.0)

    def is_valid_citation(self, text: str) -> bool:
        """Check if text is a valid ACS citation.

        Args:
            text: Text to validate

        Returns:
            True if text matches ACS citation pattern, False otherwise
        """
        # Check for parenthesized number pattern
        if re.match(r'^\(\s*\d+\s*\)', text.strip()):
            return True

        # Check for superscript pattern
        if re.match(r'^\^?\s*\d+', text.strip()):
            return True

        # Check for ACS reference pattern: (N) Authors. Title. Journal.
        if re.match(r'\(\s*\d+\s*\)\s*[A-Z]', text):
            return True

        return False

    def is_reference_list_marker(self, text: str) -> bool:
        """Check if text is a reference list marker.

        Args:
            text: Text to check

        Returns:
            True if text is a reference list marker, False otherwise
        """
        # Match standalone (N) at start
        if re.match(r'^\s*\(\d+\)\s*$', text):
            return True

        return False


# =============================================================================
# Auto-registration
# =============================================================================

# Register ACS format when this module is imported
register_format(ACSFormat())


# =============================================================================
# Module-level pattern lists for convenience
# =============================================================================

ACS_IN_TEXT_PATTERNS = [
    _ACS_AUTHOR_SUPERSCRIPT,
    _ACS_SUPERSCRIPT,
    # FIX: removed _ACS_PARENTHESIZED and _ACS_COMMA_SEPARATED
]

ACS_REFERENCE_PATTERNS = [
    _ACS_REFERENCE_RSC_WILEY,
    _ACS_REFERENCE_APS_COMPACT,
    _ACS_REFERENCE_DOI,
    _ACS_REFERENCE_ARTICLE,
    _ACS_REFERENCE_JOURNAL_ABBREV,
    _ACS_BOOK_CHAPTER,
    _ACS_BOOK,
    _ACS_TECH_REPORT,
]
