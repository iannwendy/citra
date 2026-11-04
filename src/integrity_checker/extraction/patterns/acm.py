"""ACM (Association for Computing Machinery) citation format patterns and parser.

This module provides ACM citation format implementation for the
modular citation pattern system.

ACM Style Citations:
    In-text:
        - Numeric bracketed: [1], [2], [3]
        - Can also use APA-like: (Author, 2020) in some ACM templates

    Reference list:
        - Numbered list: [1] Authors. Title. Venue. Year.
        - Format: [N] Authors, "Title," Venue details, Year
        - Similar to IEEE but with different punctuation

Key characteristics:
    - Numeric bracketed citations
    - Similar to IEEE in many ways
    - Often uses full author names in references

Reference:
    https://www.acm.org/publications/proceedings-template
    https://doi.org/10.1145/3442188.3445922
"""

from __future__ import annotations

import re

from integrity_checker.extraction.patterns.base import CompiledPattern, PatternType
from integrity_checker.extraction.patterns.registry import register_format
from integrity_checker.extraction.patterns.utils import extract_publication_year
from integrity_checker.matching.author_parser import parse_authors
from integrity_checker.models.citation import Citation, CitationStyle, CitationType

# =============================================================================
# ACM Pattern Definitions
# =============================================================================

# --- In-text ACM patterns ---

# Numeric bracketed: [1], [2], [3]
_ACM_NUMERIC = CompiledPattern.create(
    name="acm_numeric",
    pattern=r"\[(\d+)\]",
    pattern_type=PatternType.IN_TEXT,
    description="ACM numeric in-text: [1] | [2] | [3]",
)

# Numeric with comma: [1], [2], [3]
_ACM_NUMERIC_COMMA = CompiledPattern.create(
    name="acm_numeric_comma",
    pattern=r"\[(\d+(?:[,\s]+\d+)*)\]",
    pattern_type=PatternType.IN_TEXT,
    description="ACM numeric: [1], [2], [3] | [1, 2, 3]",
)

# Numeric range: [1-5]
_ACM_NUMERIC_RANGE = CompiledPattern.create(
    name="acm_numeric_range",
    pattern=r"\[(\d+(?:[,\s\-–]+\d+)*)\]",
    pattern_type=PatternType.IN_TEXT,
    description="ACM numeric range: [1-5] | [1, 2-5]",
)

# --- Reference list ACM patterns ---

# ACM reference with quoted title:
# [1] Authors, "Title," Venue details, Year.
_ACM_REFERENCE_ENTRY = CompiledPattern.create(
    name="acm_reference_entry",
    pattern=(
        r'^\[\s*(?P<index>\d+)\s*\]\s*'  # [N]
        r'(?P<authors>.+?),?\s*'  # Authors
        r'"(?P<title>.+?)",?\s*'  # "title,"
        r'(?P<venue>.+?)(?:,?\s*\d{4}[a-z]?\.)?$'  # venue and optional year
    ),
    pattern_type=PatternType.REFERENCE_ENTRY,
    description="ACM reference: [N] Authors, \"Title,\" Venue, Year.",
)

# ACM conference paper:
# [N] Authors, "Title," in Conf. Name, Location, Year, pp. XX-XX.
_ACM_CONFERENCE = CompiledPattern.create(
    name="acm_conference",
    pattern=(
        r'^\[\s*(?P<index>\d+)\s*\]\s*'  # [N]
        r'(?P<authors>.+?),?\s*'  # Authors
        r'[""](?P<title>[^""]+)[""],?\s*'  # "title,"
        r'in\s+'  # in
        r'(?P<conference>[^,]+)'  # Conference name
        r'(?:,\s*(?P<location>[^,]+))?'  # Optional location
        r'(?:,\s*(?P<year>\d{4}))?'  # Optional year
        r'(?:,\s*pp?\.\s*(?P<pages>[\d–-]+))?'  # Optional pages
        r'\.?$'
    ),
    pattern_type=PatternType.REFERENCE_ENTRY,
    description="ACM conference: [N] Authors, \"Title,\" in Conf. Name, Year.",
)

# ACM book:
# [N] Authors, Book Title. Publisher, Year.
_ACM_BOOK = CompiledPattern.create(
    name="acm_book",
    pattern=(
        r'^\[\s*(?P<index>\d+)\s*\]\s*'  # [N]
        r'(?P<authors>[^.]+?),\s+'  # Authors,
        r'(?P<title>(?!and\b|&\s)[^,.]+?)[.,]\s+'  # Book title. or ,
        r'(?P<publisher>[^,.]+?),\s*'  # Publisher,
        r'(?P<year>(?:19|20)\d{2})'  # Required 4-digit year
        r'\.?$'
    ),
    pattern_type=PatternType.REFERENCE_ENTRY,
    description="ACM book: [N] Authors, Book Title. Publisher, Year.",
)

# ACM book chapter:
# [N] Authors, "Chapter title," in Book Title, Publisher, Year, pp. XX-XX.
_ACM_BOOK_CHAPTER = CompiledPattern.create(
    name="acm_book_chapter",
    pattern=(
        r'^\[\s*(?P<index>\d+)\s*\]\s*'  # [N]
        r'(?P<authors>.+?),?\s*'  # Authors
        r'[""\u201c](?P<title>[^""\u201d]+)[""\u201d],?\s*'  # "title,"
        r'in\s+'  # in
        r'(?P<book_title>[^,]+)'  # Book title
        r'(?:,\s*(?P<publisher>[^,]+))?'  # Optional publisher
        r'(?:,\s*(?P<year>\d{4}))?'  # Optional year
        r'(?:,\s*pp?\.\s*(?P<pages>[\d–-]+))?'  # Optional pages
        r'\.?$'
    ),
    pattern_type=PatternType.REFERENCE_ENTRY,
    description="ACM book chapter: [N] Authors, \"Title,\" in Book, Publisher, Year.",
)

# ACM 2017+ official reference format (year after authors):
# [N] Authors. Year. Title. Venue...
_ACM_YEAR_FIRST = CompiledPattern.create(
    name="acm_year_first",
    pattern=(
        r'^\[\s*(?P<index>\d+)\s*\]\s*'  # [N]
        r'(?P<authors>.+?)\.\s+'  # Authors.
        r'(?P<year>(?:19|20)\d{2}[a-z]?)\.\s+'  # Year.
        r'(?P<title>[^.?!]+?)[.?!]\s+'  # Title.
        r'(?P<venue>.+?)'  # Venue
        r'\.?$'
    ),
    pattern_type=PatternType.REFERENCE_ENTRY,
    description="ACM 2017+ format: [N] Authors. Year. Title. Venue.",
)

# ACM journal article:
# [N] Authors. Title. Journal, vol. X, no. Y, pp. Z-Z, Year.
# OR [N] Authors. Title. J. ACM 63, 4 (2020), 100-110.
_ACM_JOURNAL = CompiledPattern.create(
    name="acm_journal",
    pattern=(
        r'^\[\s*(?P<index>\d+)\s*\]\s*'  # [N]
        r'(?P<authors>.+?)(?<!\b[Vv]ol)(?<!\b[Nn]o)(?<!\b[Pp]p)\.\s+(?!(?:[A-ZÀ-Ý][.,]\s|[A-ZÀ-Ý][a-zà-ÿ\'-]+(?:\s+[A-ZÀ-Ý][a-zà-ÿ\'-]+)?(?:[.,]\s|\s+and\s+[A-ZÀ-Ý]|\s*&|\s+et\s+al\b)|and\b|&|et\s+al\.))'  # Authors (don't stop at initial).
        r'(?P<title>(?:[^.?!]|\.(?!\s))*[A-Za-z]{3,}(?:[^.?!]|\.(?!\s))*?)(?<!\b[Vv]ol)(?<!\b[Nn]o)(?<!\b[Pp]p)[.?!]\s+'  # Title.
        r'(?P<venue>.+?)'  # Venue
        r'(?:,\s*(?P<year>(?:18|19|20)\d{2}[a-z]?))?'  # Optional trailing year
        r'\.?$'
    ),
    pattern_type=PatternType.REFERENCE_ENTRY,
    description="ACM journal: [N] Authors. Title. Journal, Year.",
)

# ACM tech report:
# [N] Authors, "Title," Tech. Rep., Institution, Year.
_ACM_TECH_REPORT = CompiledPattern.create(
    name="acm_tech_report",
    pattern=(
        r'^\[\s*(?P<index>\d+)\s*\]\s*'  # [N]
        r'(?P<authors>.+?),?\s*'  # Authors
        r'[""\u201c](?P<title>[^""\u201d]+)[""\u201d],?\s*'  # "title,"
        r'(?P<type>Tech\.\s*Rep\.?|Technical\s+Report)'  # Type
        r'(?:,\s*(?P<institution>[^,]+))?'  # Optional institution
        r'(?:,\s*(?P<year>\d{4}))?'  # Optional year
        r'\.?$'
    ),
    pattern_type=PatternType.REFERENCE_ENTRY,
    description="ACM tech report: [N] Authors, \"Title,\" Tech. Rep., Institution.",
)

# ACM with full name format (different from IEEE):
# [N] FirstName LastName and FirstName LastName. Title. Venue. Year.
_ACM_FULL_NAME = CompiledPattern.create(
    name="acm_full_name",
    pattern=(
        r'^\[\s*(?P<index>\d+)\s*\]\s*'  # [N]
        r'(?P<authors>.+?)(?<!\b[Vv]ol)(?<!\b[Nn]o)(?<!\b[Pp]p)\.\s+(?!(?:[A-ZÀ-Ý][.,]\s|[A-ZÀ-Ý][a-zà-ÿ\'-]+(?:\s+[A-ZÀ-Ý][a-zà-ÿ\'-]+)?(?:[.,]\s|\s+and\s+[A-ZÀ-Ý]|\s*&|\s+et\s+al\b)|and\b|&|et\s+al\.))'  # Authors (ends with surname).
        r'(?P<title>(?:[^.?!]|\.(?!\s))*[A-Za-z]{3,}(?:[^.?!]|\.(?!\s))*?)(?<!\b[Vv]ol)(?<!\b[Nn]o)(?<!\b[Pp]p)(?:[.?!]\s+(?P<venue>.+?)|,\s*(?:[A-Za-z]+\.?\s+)?(?P<year_direct>(?:18|19|20)\d{2}[a-z]?)(?:\.\s*(?P<trailing_url>(?:URL\s+)?https?://\S+|\bdoi:\s*\S+))?)'  # Title. Venue OR Title, Year.
        r'(?:\s+(?P<year>(?:18|19|20)\d{2}[a-z]?))?'  # Optional year
        r'\.?$'
    ),
    pattern_type=PatternType.REFERENCE_ENTRY,
    description="ACM full name: [N] FirstName LastName. Title. Venue. Year.",
)

# --- Utility pattern ---

_ACM_BRACKET_RE = CompiledPattern.create(
    name="acm_bracket_marker",
    pattern=r'^\s*\[\d+\]\s*',
    pattern_type=PatternType.UTILITY,
    description="ACM reference list marker: [N]",
)


# =============================================================================
# ACM Format Implementation
# =============================================================================


class ACMFormat:
    """ACM citation format implementation.

    ACM style is commonly used in:
        - Computer Science
        - Information Technology
        - Software Engineering
        - Computing conferences and journals

    Key characteristics:
        - Numeric bracketed citations
        - Similar to IEEE in many ways
        - Reference list uses [N] numbering
        - Can have full author names in references

    This implementation handles:
        - In-text numeric citations: [1], [2], [3]
        - Reference list entries for conferences, journals, books, tech reports
        - Both abbreviated and full name author formats
    """

    @property
    def name(self) -> str:
        """Format name."""
        return "ACM"

    @property
    def priority(self) -> int:
        """Priority for format resolution (higher = try first).

        ACM is common in CS but similar to IEEE.
        Priority 88 (slightly lower than IEEE since IEEE is more common).
        """
        return 88

    @property
    def in_text_patterns(self) -> list[CompiledPattern]:
        """Patterns for extracting ACM in-text citations."""
        return [
            _ACM_NUMERIC_RANGE,
            _ACM_NUMERIC_COMMA,
            _ACM_NUMERIC,
        ]

    @property
    def reference_patterns(self) -> list[CompiledPattern]:
        """Patterns for extracting ACM reference list entries."""
        return [
            _ACM_YEAR_FIRST,
            _ACM_REFERENCE_ENTRY,
            _ACM_CONFERENCE,
            _ACM_JOURNAL,
            _ACM_FULL_NAME,
            _ACM_BOOK_CHAPTER,
            _ACM_BOOK,
            _ACM_TECH_REPORT,
        ]

    @staticmethod
    def _is_non_acm_structure(text: str) -> bool:
        """Reject Nature (`... 580, 100-105 (2020).`) and Vancouver (`... 2020;395...`)."""
        # Nature: Volume, Pages (Year). at end
        if re.search(r'\b\d+\s*,\s*(?:[\d–-]+|[a-zA-Z]?\d+)\s*\(\s*(?:19|20)\d{2}[a-z]?\s*\)\.?$', text):
            return True
        # Vancouver / CSE / AMA: Year;Volume
        if re.search(r'\b(?:19|20)\d{2};\s*\d+', text):
            return True
        return False

    def parse_reference_entry(self, text: str) -> Citation | None:
        """Parse ACM reference entry into Citation object.

        Args:
            text: Raw reference entry text

        Returns:
            Citation object if successfully parsed, None otherwise

        Examples:
            >>> text = '[1] John Smith and Jane Doe. 2020. Article title. Journal 10, 2, 1-15.'
            >>> citation = ACMFormat().parse_reference_entry(text)
            >>> citation.authors
            ['John Smith', 'Jane Doe']
            >>> citation.year
            '2020'
        """
        # Normalize whitespace
        text = re.sub(r'\s+', ' ', text.strip())

        if self._is_non_acm_structure(text):
            return None

        # Extract numeric index first
        numeric_index = None
        idx_match = re.search(r'\[\s*(\d+)\s*\]', text)
        if idx_match:
            numeric_index = int(idx_match.group(1))

        # Try ACM 2017+ official year-first format first ([N] Authors. Year. Title. Venue.)
        citation = self._try_parse_year_first(text)
        if citation:
            if numeric_index and citation.numeric_index is None:
                citation.numeric_index = numeric_index
            return citation

        # Try quote-based parsing first (most reliable for ACM with titles)
        citation = self._parse_acm_quote_based(text)
        if citation:
            if numeric_index and citation.numeric_index is None:
                citation.numeric_index = numeric_index
            return citation

        # Try conference format
        citation = self._try_parse_conference(text)
        if citation:
            if numeric_index and citation.numeric_index is None:
                citation.numeric_index = numeric_index
            return citation

        # Try journal format
        citation = self._try_parse_journal(text)
        if citation:
            if numeric_index and citation.numeric_index is None:
                citation.numeric_index = numeric_index
            return citation

        # Try full name format
        citation = self._try_parse_full_name(text)
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

        # Try unquoted comma-separated journal/conference format (e.g. [6] Surname, Given, ..., Title, Journal ..., Year)
        citation = self._try_parse_comma_separated_journal(text)
        if citation:
            if numeric_index and citation.numeric_index is None:
                citation.numeric_index = numeric_index
            return citation

        # Fallback
        return self._parse_acm_fallback(text)

    def _try_parse_year_first(self, text: str) -> Citation | None:
        """Try to parse ACM 2017+ official year-first format."""
        match = _ACM_YEAR_FIRST.search(text)
        if not match:
            return None
        year_raw = match.group('year')
        year = year_raw[:4]
        year_suffix = year_raw[4:] if len(year_raw) > 4 else None
        title = match.group('title').strip().rstrip('.')
        citation = Citation(
            raw_text=text,
            citation_type=CitationType.REFERENCE_LIST,
            style=CitationStyle.ACM,
            matched_pattern='acm_year_first',
            numeric_index=int(match.group('index')),
            authors=self._parse_authors(match.group('authors')),
            year=year,
            year_suffix=year_suffix,
            title=title,
            title_normalized=self._normalize_title(title),
        )
        venue = match.group('venue').strip()
        self._parse_venue(citation, venue)
        doi_m = re.search(r'10\.\d{4,9}/[^\s\]\)\,;]+', text)
        if doi_m:
            citation.doi = doi_m.group(0).rstrip('.')
        citation.confidence = self._estimate_confidence(citation)
        return citation

    def _parse_acm_quote_based(self, text: str) -> Citation | None:
        """Parse ACM entry using quote-based heuristic."""
        # Match [N] at start
        idx_m = re.match(r'\[\s*(\d+)\s*\]\s*', text)
        if not idx_m:
            return None
        numeric_index = int(idx_m.group(1))
        remainder = text[idx_m.end():]

        # Find first quote pair (supports " and unicode "")
        quote_chars_open = ['"', '"', '"']

        first_q = None
        for i, c in enumerate(remainder):
            if c in quote_chars_open:
                first_q = i
                break

        if first_q is None:
            return None

        close_q = None
        quote_close_chars = ['"', '"', '"']
        for j in range(first_q + 1, len(remainder)):
            if remainder[j] in quote_close_chars:
                close_q = j
                break

        if close_q is None:
            return None

        authors_part = remainder[:first_q].strip().rstrip(',').rstrip()
        title_raw = remainder[first_q + 1:close_q].strip().rstrip(',').strip()

        # Strip quotes and trailing period from title
        for q in ['"', '"', '"', '"', '"', '"']:
            if title_raw.startswith(q) and title_raw.endswith(q):
                title_raw = title_raw[len(q):-len(q)]
                break
        title_raw = title_raw.rstrip('.')

        venue_year = remainder[close_q + 1:].strip().lstrip(',').strip()

        # Year usually at end (ignore page numbers/ranges, DOIs, URLs, etc.)
        year, year_suffix = extract_publication_year(venue_year, prefer_last=True)

        citation = Citation(
            raw_text=text.strip(),
            citation_type=CitationType.REFERENCE_LIST,
            style=CitationStyle.ACM,
            matched_pattern='acm_quote_based',
            numeric_index=numeric_index,
            title=title_raw,
            title_normalized=self._normalize_title(title_raw),
            year=year,
            year_suffix=year_suffix,
            venue=venue_year,
            authors=self._parse_authors(authors_part),
        )

        # Extract DOI if present
        doi_m = re.search(r'10\.\d{4,9}/[^\s\]\)\,;]+', text)
        if doi_m:
            citation.doi = doi_m.group(0).rstrip('.')

        # Parse venue components
        self._parse_venue(citation, venue_year)

        citation.confidence = self._estimate_confidence(citation)
        return citation

    def _try_parse_conference(self, text: str) -> Citation | None:
        """Try to parse ACM conference format."""
        match = _ACM_CONFERENCE.search(text)
        if match:
            return self._parse_conference_entry(match, text)
        return None

    def _try_parse_journal(self, text: str) -> Citation | None:
        """Try to parse ACM journal format."""
        match = _ACM_JOURNAL.search(text)
        if match:
            return self._parse_journal_entry(match, text)
        return None

    def _try_parse_full_name(self, text: str) -> Citation | None:
        """Try to parse ACM full name format."""
        match = _ACM_FULL_NAME.search(text)
        if match:
            return self._parse_full_name_entry(match, text)
        return None

    def _try_parse_book(self, text: str) -> Citation | None:
        """Try to parse ACM book format."""
        match = _ACM_BOOK.search(text)
        if match:
            return self._parse_book_entry(match, text)
        return None

    def _try_parse_book_chapter(self, text: str) -> Citation | None:
        """Try to parse ACM book chapter format."""
        match = _ACM_BOOK_CHAPTER.search(text)
        if match:
            return self._parse_book_chapter_entry(match, text)
        return None

    def _try_parse_tech_report(self, text: str) -> Citation | None:
        """Try to parse ACM tech report format."""
        match = _ACM_TECH_REPORT.search(text)
        if match:
            return self._parse_tech_report_entry(match, text)
        return None

    def _parse_conference_entry(
        self, match: re.Match, text: str
    ) -> Citation | None:
        """Parse ACM conference entry."""
        citation = Citation(
            raw_text=text,
            citation_type=CitationType.REFERENCE_LIST,
            style=CitationStyle.ACM,
            matched_pattern='acm_conference',
        )

        # Extract numeric index
        index = match.group('index')
        if index:
            citation.numeric_index = int(index)

        # Extract authors
        authors_str = match.group('authors')
        if authors_str:
            citation.authors = self._parse_authors(authors_str)
        if not citation.authors:
            return None

        # Extract title (remove quotes and trailing period)
        title = match.group('title').strip()
        # Strip ASCII and curly quotes
        for q in ['"', '"', '"', '"', '"', '"']:
            if title.startswith(q) and title.endswith(q):
                title = title[len(q):-len(q)]
                break
        # Strip trailing period if present
        title = title.rstrip('.')
        # Extract trailing ", Year" from title when venue starts with URL/DOI (e.g. "Title, 2021. URL https://...")
        title_yr_m = re.search(
            r'^(?P<clean_title>.+?),\s*(?:[A-Za-z]+\.?\s+)?(?P<t_year>(?:18|19|20)\d{2}[a-z]?)$',
            title,
        )
        if title_yr_m:
            title = title_yr_m.group('clean_title').strip()
            t_yr = title_yr_m.group('t_year')
            citation.year = t_yr[:4]
            if len(t_yr) > 4:
                citation.year_suffix = t_yr[4:]
        citation.title = title
        citation.title_normalized = self._normalize_title(title)

        # Build venue from conference and location
        conference = match.group('conference').strip()
        location = match.group('location')
        year_str = match.group('year')
        pages = match.group('pages')

        citation.venue = conference
        if location:
            citation.venue += f', {location.strip()}'

        if year_str:
            citation.year = year_str
        if pages:
            citation.pages = pages

        # Extract DOI if present
        doi_m = re.search(r'10\.\d{4,9}/[^\s\]\)\,;]+', text)
        if doi_m:
            citation.doi = doi_m.group(0).rstrip('.')

        citation.confidence = self._estimate_confidence(citation)
        return citation

    def _parse_journal_entry(
        self, match: re.Match, text: str
    ) -> Citation | None:
        """Parse ACM journal entry."""
        citation = Citation(
            raw_text=text,
            citation_type=CitationType.REFERENCE_LIST,
            style=CitationStyle.ACM,
            matched_pattern='acm_journal',
        )

        # Extract numeric index
        index = match.group('index')
        if index:
            citation.numeric_index = int(index)

        # Extract authors
        authors_str = match.group('authors')
        title = match.group('title').strip()
        if re.search(r',\s*(?:vol|no|pp)\s*$', title, re.IGNORECASE):
            return None
        if re.search(r'\b(?:vol|no|pp)\b', authors_str or '', re.IGNORECASE):
            return None
        if authors_str:
            citation.authors = self._parse_authors(authors_str)
        if not citation.authors:
            return None

        # Extract title (remove quotes and trailing period)
        # Strip ASCII and curly quotes
        for q in ['"', '"', '"', '"', '"', '"']:
            if title.startswith(q) and title.endswith(q):
                title = title[len(q):-len(q)]
                break
        # Strip trailing period if present
        title = title.rstrip('.')
        # Extract trailing ", Year" from title when venue starts with URL/DOI (e.g. "Title, 2021. URL https://...")
        title_yr_m = re.search(
            r'^(?P<clean_title>.+?),\s*(?:[A-Za-z]+\.?\s+)?(?P<t_year>(?:18|19|20)\d{2}[a-z]?)$',
            title,
        )
        if title_yr_m:
            title = title_yr_m.group('clean_title').strip()
            t_yr = title_yr_m.group('t_year')
            citation.year = t_yr[:4]
            if len(t_yr) > 4:
                citation.year_suffix = t_yr[4:]
        citation.title = title
        citation.title_normalized = self._normalize_title(title)

        # Extract venue
        venue = (match.group('venue') or '').strip()
        if venue:
            self._parse_venue(citation, venue)

        # Extract year
        year_str = match.group('year')
        if year_str:
            citation.year = year_str[:4]
            if len(year_str) > 4:
                citation.year_suffix = year_str[4:]

        # Extract DOI if present
        doi_m = re.search(r'10\.\d{4,9}/[^\s\]\)\,;]+', text)
        if doi_m:
            citation.doi = doi_m.group(0).rstrip('.')
        url_m = re.search(r'https?://[^\s\]\)\,;]+', text)
        if url_m:
            citation.url = url_m.group(0).rstrip('.,;)')

        citation.confidence = self._estimate_confidence(citation)
        return citation

    def _parse_full_name_entry(
        self, match: re.Match, text: str
    ) -> Citation | None:
        """Parse ACM full name entry."""
        citation = Citation(
            raw_text=text,
            citation_type=CitationType.REFERENCE_LIST,
            style=CitationStyle.ACM,
            matched_pattern='acm_full_name',
        )

        # Extract numeric index
        index = match.group('index')
        if index:
            citation.numeric_index = int(index)

        # Extract authors
        authors_str = match.group('authors')
        title = match.group('title').strip()
        if re.search(r',\s*(?:vol|no|pp)\s*$', title, re.IGNORECASE):
            return None
        if re.search(r'\b(?:vol|no|pp)\b', authors_str or '', re.IGNORECASE):
            return None
        if authors_str:
            citation.authors = self._parse_authors(authors_str)
        if not citation.authors:
            return None

        # Extract title (remove quotes and trailing period)
        # Strip ASCII and curly quotes
        for q in ['"', '"', '"', '"', '"', '"']:
            if title.startswith(q) and title.endswith(q):
                title = title[len(q):-len(q)]
                break
        # Strip trailing period if present
        title = title.rstrip('.')
        # Extract trailing ", Year" from title when venue starts with URL/DOI (e.g. "Title, 2021. URL https://...")
        title_yr_m = re.search(
            r'^(?P<clean_title>.+?),\s*(?:[A-Za-z]+\.?\s+)?(?P<t_year>(?:18|19|20)\d{2}[a-z]?)$',
            title,
        )
        if title_yr_m:
            title = title_yr_m.group('clean_title').strip()
            t_yr = title_yr_m.group('t_year')
            citation.year = t_yr[:4]
            if len(t_yr) > 4:
                citation.year_suffix = t_yr[4:]
        citation.title = title
        citation.title_normalized = self._normalize_title(title)

        # Extract venue
        venue = (match.groupdict().get('venue') or '').strip()
        if venue:
            self._parse_venue(citation, venue)

        # Extract year
        year_str = match.groupdict().get('year') or match.groupdict().get('year_direct')
        if year_str:
            citation.year = year_str[:4]
            if len(year_str) > 4:
                citation.year_suffix = year_str[4:]

        # Extract DOI if present
        doi_m = re.search(r'10\.\d{4,9}/[^\s\]\)\,;]+', text)
        if doi_m:
            citation.doi = doi_m.group(0).rstrip('.')
        url_m = re.search(r'https?://[^\s\]\)\,;]+', text)
        if url_m:
            citation.url = url_m.group(0).rstrip('.,;)')

        citation.confidence = self._estimate_confidence(citation)
        return citation

    def _parse_book_entry(
        self, match: re.Match, text: str
    ) -> Citation | None:
        """Parse ACM book entry."""
        citation = Citation(
            raw_text=text,
            citation_type=CitationType.REFERENCE_LIST,
            style=CitationStyle.ACM,
            matched_pattern='acm_book',
        )

        # Extract numeric index
        index = match.group('index')
        if index:
            citation.numeric_index = int(index)

        # Extract authors
        authors_str = match.group('authors')
        if authors_str:
            citation.authors = self._parse_authors(authors_str)
        if not citation.authors:
            return None

        # Extract title (remove quotes and trailing period)
        title = match.group('title').strip()
        # Strip ASCII and curly quotes
        for q in ['"', '"', '"', '"', '"', '"']:
            if title.startswith(q) and title.endswith(q):
                title = title[len(q):-len(q)]
                break
        # Strip trailing period if present
        title = title.rstrip('.')
        # Extract trailing ", Year" from title when venue starts with URL/DOI (e.g. "Title, 2021. URL https://...")
        title_yr_m = re.search(
            r'^(?P<clean_title>.+?),\s*(?:[A-Za-z]+\.?\s+)?(?P<t_year>(?:18|19|20)\d{2}[a-z]?)$',
            title,
        )
        if title_yr_m:
            title = title_yr_m.group('clean_title').strip()
            t_yr = title_yr_m.group('t_year')
            citation.year = t_yr[:4]
            if len(t_yr) > 4:
                citation.year_suffix = t_yr[4:]
        citation.title = title
        citation.title_normalized = self._normalize_title(title)

        # Extract publisher and year
        publisher = match.group('publisher')
        year_str = match.group('year')

        if publisher:
            citation.venue = publisher.strip()
        if year_str:
            citation.year = year_str

        # Extract DOI if present
        doi_m = re.search(r'10\.\d{4,9}/[^\s\]\)\,;]+', text)
        if doi_m:
            citation.doi = doi_m.group(0).rstrip('.')

        citation.confidence = self._estimate_confidence(citation)
        return citation

    def _parse_book_chapter_entry(
        self, match: re.Match, text: str
    ) -> Citation | None:
        """Parse ACM book chapter entry."""
        citation = Citation(
            raw_text=text,
            citation_type=CitationType.REFERENCE_LIST,
            style=CitationStyle.ACM,
            matched_pattern='acm_book_chapter',
        )

        # Extract numeric index
        index = match.group('index')
        if index:
            citation.numeric_index = int(index)

        # Extract authors
        authors_str = match.group('authors')
        if authors_str:
            citation.authors = self._parse_authors(authors_str)
        if not citation.authors:
            return None

        # Extract chapter title
        title = match.group('title').strip()
        citation.title = title
        citation.title_normalized = self._normalize_title(title)

        # Extract book title (as venue)
        book_title = match.group('book_title').strip()
        publisher = match.group('publisher')
        year_str = match.group('year')
        pages = match.group('pages')

        citation.venue = book_title
        if publisher:
            citation.venue += f', {publisher.strip()}'
        if year_str:
            citation.year = year_str
        if pages:
            citation.pages = pages

        # Extract DOI if present
        doi_m = re.search(r'10\.\d{4,9}/[^\s\]\)\,;]+', text)
        if doi_m:
            citation.doi = doi_m.group(0).rstrip('.')

        citation.confidence = self._estimate_confidence(citation)
        return citation

    def _parse_tech_report_entry(
        self, match: re.Match, text: str
    ) -> Citation | None:
        """Parse ACM tech report entry."""
        citation = Citation(
            raw_text=text,
            citation_type=CitationType.REFERENCE_LIST,
            style=CitationStyle.ACM,
            matched_pattern='acm_tech_report',
        )

        # Extract numeric index
        index = match.group('index')
        if index:
            citation.numeric_index = int(index)

        # Extract authors
        authors_str = match.group('authors')
        if authors_str:
            citation.authors = self._parse_authors(authors_str)
        if not citation.authors:
            return None

        # Extract title (remove quotes and trailing period)
        title = match.group('title').strip()
        # Strip ASCII and curly quotes
        for q in ['"', '"', '"', '"', '"', '"']:
            if title.startswith(q) and title.endswith(q):
                title = title[len(q):-len(q)]
                break
        # Strip trailing period if present
        title = title.rstrip('.')
        # Extract trailing ", Year" from title when venue starts with URL/DOI (e.g. "Title, 2021. URL https://...")
        title_yr_m = re.search(
            r'^(?P<clean_title>.+?),\s*(?:[A-Za-z]+\.?\s+)?(?P<t_year>(?:18|19|20)\d{2}[a-z]?)$',
            title,
        )
        if title_yr_m:
            title = title_yr_m.group('clean_title').strip()
            t_yr = title_yr_m.group('t_year')
            citation.year = t_yr[:4]
            if len(t_yr) > 4:
                citation.year_suffix = t_yr[4:]
        citation.title = title
        citation.title_normalized = self._normalize_title(title)

        # Build venue from type and institution
        report_type = match.group('type').strip()
        institution = match.group('institution')
        year_str = match.group('year')

        citation.venue = report_type
        if institution:
            citation.venue += f', {institution.strip()}'
        if year_str:
            citation.year = year_str

        # Extract DOI if present
        doi_m = re.search(r'10\.\d{4,9}/[^\s\]\)\,;]+', text)
        if doi_m:
            citation.doi = doi_m.group(0).rstrip('.')

        citation.confidence = self._estimate_confidence(citation)
        return citation

    def _try_parse_comma_separated_journal(self, text: str) -> Citation | None:
        """Parse unquoted comma-separated '[N] Surname, Given, ..., Title, Journal ..., Year' entries."""
        if any(q in text for q in ('"', "\u201c", "\u201d")):
            return None
        m = re.match(r"^\[\s*(?P<index>\d+)\s*\]\s*(?P<body>.+)$", text)
        if not m:
            return None
        parts = [p.strip() for p in m.group("body").split(", ") if p.strip()]
        if len(parts) < 4:
            return None

        surname_re = re.compile(
            r"^(?:(?:and|&)\s+)?[A-ZÀ-Ý][A-Za-zÀ-ỹ'\-]+(?:\s+[A-ZÀ-Ý][A-Za-zÀ-ỹ'\-]+)?$"
        )
        given_re = re.compile(
            r"^(?:[A-ZÀ-Ý][a-zà-ỹ'\-]+|[A-ZÀ-Ý]\.?)(?:\s+(?:[A-ZÀ-Ý][a-zà-ỹ'\-]+|[A-ZÀ-Ý]\.?)){0,2}$"
        )
        venue_kw_re = re.compile(
            r"\b(?:Journal|Proceedings|Conference|Transactions|Symposium|Workshop|Review|Letters|Magazine|Volume|Vol\.?)\b",
            re.IGNORECASE,
        )

        author_items: list[str] = []
        idx = 0
        while idx + 1 < len(parts):
            s_cand = parts[idx]
            g_cand = parts[idx + 1]
            if (
                surname_re.match(s_cand)
                and given_re.match(g_cand)
                and not venue_kw_re.search(s_cand)
                and not venue_kw_re.search(g_cand)
            ):
                clean_s = re.sub(r"^(?:and|&)\s+", "", s_cand).strip()
                author_items.append(f"{clean_s}, {g_cand}")
                idx += 2
            else:
                break

        if not author_items or idx >= len(parts) - 1:
            return None

        title_cand = parts[idx].strip().rstrip(".")
        rest_venue = ", ".join(parts[idx + 1 :]).strip().rstrip(".")
        if len(title_cand.split()) < 4 or not venue_kw_re.search(rest_venue):
            return None

        yr, yr_suffix = extract_publication_year(rest_venue, prefer_last=True)
        if not yr:
            return None

        parsed_authors = [a for item in author_items for a in parse_authors(item)]
        if not parsed_authors:
            return None

        citation = Citation(
            raw_text=text,
            citation_type=CitationType.REFERENCE_LIST,
            style=CitationStyle.ACM,
            matched_pattern="acm_comma_journal",
            numeric_index=int(m.group("index")),
            authors=parsed_authors,
            year=yr,
            year_suffix=yr_suffix,
            title=title_cand,
            title_normalized=self._normalize_title(title_cand),
        )
        self._parse_venue(citation, rest_venue)
        if not citation.venue:
            citation.venue = rest_venue
        doi_m = re.search(r"10\.\d{4,9}/[^\s\]\)\,;]+", text)
        if doi_m:
            citation.doi = doi_m.group(0).rstrip(".")
        citation.confidence = self._estimate_confidence(citation)
        return citation

    def _parse_acm_fallback(self, text: str) -> Citation | None:
        """Fallback parser: extract whatever metadata possible."""
        idx_match = re.match(r'^\[\s*(\d+)\s*\]', text)
        if not idx_match:
            return None

        citation = Citation(
            raw_text=text,
            citation_type=CitationType.REFERENCE_LIST,
            style=CitationStyle.ACM,
            matched_pattern='acm_fallback',
            numeric_index=int(idx_match.group(1)),
        )

        # Try to extract year
        citation.year, citation.year_suffix = extract_publication_year(text, prefer_last=True)

        # Try to extract title from quoted text
        quote_m = re.search(r'["""\u201c]([^""""\u201d]+)["""\u201d]', text)
        if quote_m:
            title = quote_m.group(1).strip()
            citation.title = title
            citation.title_normalized = self._normalize_title(title)

        # Extract DOI
        doi_m = re.search(r'10\.\d{4,9}/[^\s\]\)\,;]+', text)
        if doi_m:
            citation.doi = doi_m.group(0).rstrip('.')

        citation.confidence = self._estimate_confidence(citation)
        return citation if citation.title or citation.year else None

    def _parse_authors(self, authors_str: str) -> list[str]:
        """Parse author string into list of authors.

        Args:
            authors_str: Author string

        Returns:
            List of author strings (via parse_authors)
        """
        return parse_authors(authors_str)

    def _parse_venue(self, citation: Citation, venue_text: str) -> None:
        """Parse venue information from remaining text."""
        if not venue_text:
            return

        venue_text = venue_text.strip()

        # ACM 2017+ / Classic journal style: "Commun. ACM 63, 4 (April 2020), 123-135." or "J. ACM 63, 4 (2020), 100-110."
        acm_j_m = re.search(
            r'^(?P<venue>.+?)\s+(?P<vol>\d+)(?:,\s*(?P<issue>\d+))?\s*\([^)]*?\b(?P<year>(?:19|20)\d{2}[a-z]?)\b[^)]*\)(?:,\s*(?:pp?\.\s*|Article\s+\d+,\s*)?(?P<pages>[\d–-]+))?',
            venue_text,
        )
        if acm_j_m:
            citation.venue = acm_j_m.group('venue').strip().rstrip('.,')
            citation.volume = acm_j_m.group('vol')
            if acm_j_m.group('issue'):
                citation.issue = acm_j_m.group('issue')
            if not citation.year and acm_j_m.group('year'):
                yr = acm_j_m.group('year')
                citation.year = yr[:4]
                if len(yr) > 4:
                    citation.year_suffix = yr[4:]
            if acm_j_m.group('pages'):
                citation.pages = acm_j_m.group('pages')
            return

        # Extract volume: "vol. 22" or "vol. 22, no. 10"
        vol_match = re.search(
            r'(?:^|,?\s*)vol\.\s*(?P<vol>\d+[A-Z]?)', venue_text, re.IGNORECASE
        )
        if vol_match:
            citation.volume = vol_match.group('vol')

        # Extract issue: "no. 10"
        issue_match = re.search(
            r'(?:^|,?\s*)no\.\s*(?P<issue>\d+)', venue_text, re.IGNORECASE
        )
        if issue_match:
            citation.issue = issue_match.group('issue')

        # Extract pages: "pp. 1345-1359" or "p. 42" or range "1-12" (do not match bare years/volumes)
        pages_match = re.search(
            r'(?:^|,?\s*)(?:pp?\.\s*(?P<pages>[\d–-]+)|(?<!vol\.\s)(?<!no\.\s)(?P<range>\d+\s*[-–]\s*\d+))',
            venue_text,
            re.IGNORECASE,
        )
        if pages_match:
            citation.pages = (pages_match.group('pages') or pages_match.group('range')).strip()

        # Extract year from venue if not already set
        if not citation.year:
            yr, yr_suf = extract_publication_year(venue_text, prefer_last=True)
            if yr:
                citation.year = yr
                if yr_suf and not citation.year_suffix:
                    citation.year_suffix = yr_suf

        # Extract venue name (before volume/issue/pages)
        venue_name_match = re.search(
            r'^(?:In\s+|in\s+)?(?P<venue>.+?)(?:,\s*(?:vol\.|no\.|pp?\.|\d+\s*[-–]\s*\d+))',
            venue_text,
            re.IGNORECASE,
        )
        if venue_name_match:
            citation.venue = venue_name_match.group('venue').strip().rstrip('.,')
        else:
            # Clean up venue
            clean_venue = re.sub(r'^(?:In\s+|in\s+)', '', venue_text).strip()
            clean_venue = re.sub(r',?\s*\d{4}[a-z]?\s*\.?$', '', clean_venue).strip()
            doi_match = re.search(r'10\.\d{4,9}/[^\s\]\)\,;]+', clean_venue)
            if doi_match:
                clean_venue = clean_venue[:doi_match.start()].strip()
            if clean_venue:
                citation.venue = clean_venue.rstrip('.,')

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
        if citation.year:
            score += 0.3
        if citation.authors:
            score += 0.2
        if citation.doi:
            score += 0.1
        return min(round(score, 2), 1.0)

    def is_valid_citation(self, text: str) -> bool:
        """Check if text is a valid ACM citation.

        Args:
            text: Text to validate

        Returns:
            True if text matches ACM citation pattern, False otherwise
        """
        # Check for bracketed number pattern
        bracket_pattern = r'\[\d+(?:[,\s\-]+\d+)*\]'
        if re.match(bracket_pattern, text.strip()):
            return True

        # Check for reference entry pattern
        if re.match(r'^\s*\[\d+\]\s*', text):
            return True

        return False

    def is_reference_list_marker(self, text: str) -> bool:
        """Check if text is a reference list marker.

        Args:
            text: Text to check

        Returns:
            True if text is a reference list marker, False otherwise
        """
        # Match standalone [N] at start of text
        if re.match(r'^\s*\[\d+\]\s*$', text):
            return True

        # Match [N] followed by space and lowercase (not a new entry)
        if re.match(r'^\s*\[\d+\]\s+[a-z]', text):
            return True

        return False


# =============================================================================
# Auto-registration
# =============================================================================

# Register ACM format when this module is imported
register_format(ACMFormat())


# =============================================================================
# Module-level pattern lists for convenience
# =============================================================================

ACM_IN_TEXT_PATTERNS = [
    _ACM_NUMERIC_RANGE,
    _ACM_NUMERIC_COMMA,
    _ACM_NUMERIC,
]

ACM_REFERENCE_PATTERNS = [
    _ACM_REFERENCE_ENTRY,
    _ACM_CONFERENCE,
    _ACM_JOURNAL,
    _ACM_FULL_NAME,
    _ACM_BOOK_CHAPTER,
    _ACM_BOOK,
    _ACM_TECH_REPORT,
]
