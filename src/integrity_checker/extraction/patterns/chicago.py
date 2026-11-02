"""Chicago citation format patterns and parser.

This module provides Chicago citation format implementation for the
modular citation pattern system.

Chicago Style Citations:
    In-text (Author-Date):
        - (Author Year) or (Author, Year)
        - (Author Year, Page) or (Author, Year, Page)
        - (Author1 and Author2 Year) or (Author1 & Author2, Year)

    In-text (Notes-Bibliography):
        - Superscript numbers: ^1
        - Footnote markers

    Reference list (Author-Date):
        - Author Last, First. Year. Title. Place: Publisher.
        - Author Last, First, and First Last. Year. Title. Journal Volume (Issue): Pages.

    Reference list (Notes-Bibliography):
        - Books: Author Last, First. Title. Place: Publisher, Year.
        - Articles: Author Last, First. "Title." Journal Volume, no. Issue (Year): Pages.
        - Websites: Author Last, First. "Title." Website Name. Accessed Date. URL.

Reference:
    https://www.chicagomanualofstyle.org/

Chicago offers two systems:
    1. Notes-Bibliography (most common in humanities)
    2. Author-Date (common in social/natural sciences)
"""

from __future__ import annotations

import re
from typing import Optional

from integrity_checker.extraction.patterns.base import CompiledPattern, PatternType
from integrity_checker.extraction.patterns.registry import register_format
from integrity_checker.extraction.patterns.utils import extract_publication_year
from integrity_checker.matching.author_parser import parse_authors
from integrity_checker.models.citation import Citation, CitationStyle, CitationType

# =============================================================================
# Chicago Pattern Definitions
# =============================================================================

# --- In-text Chicago Author-Date patterns ---

# Parenthetical: (Author, 2020), (Author, 2020, p. 25), (Author, 2020: 25)
_CHICAGO_AD_PARENTHETICAL = CompiledPattern.create(
    name="chicago_ad_parenthetical",
    pattern=r"\(([^)]+),\s*(\d{4}[a-z]?)(?:\s*[:,]\s*(?:pp?\.?\s*)?(\d+(?:[-–]\d+)?|[ivxlcdm]+|n\.?\s*p\.?)(?:\s*[;,]\s*[^)]*)?)?\)",
    pattern_type=PatternType.IN_TEXT,
    description="Chicago Author-Date parenthetical: (Author, 2020) | (Author, 2020, p. 25)",
)

# Parenthetical without comma: (Author 2020), (Author 2020, 25), (Author 2020: 25)
_CHICAGO_AD_PARENTHETICAL_NOCOMMA = CompiledPattern.create(
    name="chicago_ad_parenthetical_nocomma",
    pattern=r"\((?!(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec|january|february|march|april|june|july|august|september|october|november|december|spring|summer|fall|autumn|winter|in|since|from|until|before|after|circa|ca|table|figure|fig|section|chapter|part|version|ver|vol|no|issue)\b)([A-ZÀ-Ý][a-zà-ÿ'.\u2019\-]+(?:[A-ZÀ-Ý][a-zà-ÿ'.\u2019\-]+)*(?:\s+(?:and|&|và)\s+[A-ZÀ-Ý][a-zà-ÿ'.\u2019\-]+(?:[A-ZÀ-Ý][a-zà-ÿ'.\u2019\-]+)*|\s+et\s+al\.?)?)\s+((?:18|19|20)\d{2}[a-z]?)(?:\s*[:,]\s*(?:pp?\.?\s*)?(\d+(?:[-–]\d+)?|[ivxlcdm]+|n\.?\s*p\.?)(?:\s*[;,]\s*[^)]*)?)?\)",
    pattern_type=PatternType.IN_TEXT,
    description="Chicago Author-Date: (Author 2020) | (Author 2020, 25)",
)

# Narrative: Author (2020) or Author (2020, p. 25) or Author (2020: 25)
_CHICAGO_AD_NARRATIVE = CompiledPattern.create(
    name="chicago_ad_narrative",
    pattern=r"([A-Z][a-zA-ZÀ-žÀ-ž]+(?:\s+(?:and|&)\s+[A-Z][a-zA-ZÀ-žÀ-ž]+)?(?:\s+et\s+al\.?)?)\s+\((\d{4}[a-z]?)(?:\s*[:,]\s*(?:pp?\.?\s*)?(\d+(?:[-–]\d+)?|[ivxlcdm]+|n\.?\s*p\.?)(?:\s*[;,]\s*[^)]*)?)?\)",
    pattern_type=PatternType.IN_TEXT,
    description="Chicago Author-Date narrative: Author (2020) | Author (2020, p. 25)",
)

# --- In-text Chicago Notes patterns (superscript/footnote) ---

# Superscript footnote: ^1, ^2 (math-safe: requires 2+ letters before ^)
_CHICAGO_NOTES_SUPERSCRIPT = CompiledPattern.create(
    name="chicago_notes_superscript",
    pattern=r"(?:(?<=^)|(?<=[A-Za-zÀ-ÿ]{2})|(?<=[A-Za-zÀ-ÿ]{2}[.,;:\])\"\u201d]))\^(\d{1,3}(?:[,-]\d{1,3})*)\b",
    pattern_type=PatternType.IN_TEXT,
    description="Chicago Notes superscript: ^1 | ^2",
)

# Footnote marker in text: [1], [2]
_CHICAGO_NOTES_BRACKETED = CompiledPattern.create(
    name="chicago_notes_bracketed",
    pattern=r"\[(\d+)\]",
    pattern_type=PatternType.IN_TEXT,
    description="Chicago Notes bracketed: [1] | [2]",
)

# --- Reference list Chicago Author-Date patterns ---

# Standard Chicago Author-Date book:
# Author Last, First. Year. Title. Place: Publisher.
_CHICAGO_AD_BOOK = CompiledPattern.create(
    name="chicago_ad_book",
    pattern=(
        r"^"
        r"(?P<authors>[A-ZÀ-Ý].+?)\.\s+"  # Authors
        r"(?P<year>(?:19|20)\d{2}[a-z]?)\.\s+"  # Year
        r"(?P<title>[^\"“\n]+?)\.\s+"  # Title (not quoted)
        r"(?P<place_pub>[^.:]+:\s*[^.]+)\.?"  # Required Place: Publisher
        r"(?P<rest>.*)$"
    ),
    pattern_type=PatternType.REFERENCE_ENTRY,
    description="Chicago Author-Date book: Author. Year. Title. Place: Publisher.",
)

# Chicago Author-Date article:
# Author Last, First. Year. "Title." Journal Volume (Issue): Pages.
_CHICAGO_AD_ARTICLE = CompiledPattern.create(
    name="chicago_ad_article",
    pattern=(
        r"^"
        r"(?P<authors>.+?)\.\s+"  # Authors.
        r"(?P<year>(?:19|20)\d{2}[a-z]?)\.\s+"  # Year.
        r'["\u201c](?P<title>.+?)["\u201d]\.?\s*'  # "Title." or "Title".
        r"(?P<venue>.+)"  # Venue with volume/issue/pages
        r"$"
    ),
    pattern_type=PatternType.REFERENCE_ENTRY,
    description='Chicago Author-Date article: Author. Year. "Title." Journal Vol (Issue): Pages.',
)

# Chicago Author-Date with numbered prefix: [1] Author. Year. Title.
_CHICAGO_AD_NUMBERED = CompiledPattern.create(
    name="chicago_ad_numbered",
    pattern=(
        r"^\[\s*(?P<index>\d+)\s*\]\s*"  # [N]
        r"(?P<authors>.+?)\.\s+"  # Authors
        r"(?P<year>(?:19|20)\d{2}[a-z]?)\.\s+"  # Year
        r"(?P<title>.+?)(?:\.\s*)"  # Title
        r"(?P<rest>(?:.+$)?)"  # Rest (optional)
        r"$"
    ),
    pattern_type=PatternType.REFERENCE_ENTRY,
    description="Chicago Author-Date numbered: [1] Author. Year. Title.",
)

# --- Reference list Chicago Notes-Bibliography patterns ---

# Chicago Notes-Bibliography book:
# Author Last, First. Title. Place: Publisher, Year.
# or footnote style: 1. First Last, Title (Place: Publisher, Year), Page.
_CHICAGO_NB_BOOK = CompiledPattern.create(
    name="chicago_nb_book",
    pattern=(
        r"^(?:(?:\[\s*(?P<index>\d+)\s*\]|(?P<num>\d+)\.)\s*)?"
        r"(?P<authors>[A-ZÀ-Ý][^\"“\n]+?)\.\s+(?!(?:[A-ZÀ-Ý]\.|and\b|&|et\s+al\.))"  # Authors.
        r"(?P<title>(?!https?://|www\.)[^\"“(\n]+?)(?:\.\s+|\s+\(\s*)"  # Title. or Title (
        r"(?P<place_pub>(?!(?:Accessed|Retrieved|Last\s+accessed)\b)[^.:()]+:\s*[^,()]+),\s*"  # Place: Publisher,
        r"(?P<year>(?:18|19|20)\d{2}[a-z]?)\)?\.?"  # Year
        r"(?:\s*(?P<rest>.*))?"
        r"$"
    ),
    pattern_type=PatternType.REFERENCE_ENTRY,
    description="Chicago Notes-Bibliography book: Author. Title. Place: Publisher, Year.",
)

# Chicago Notes-Bibliography article:
# Author Last, First. "Title." Journal Volume, no. Issue (Year): Pages.
# Also supports footnote style: 1. First Last, "Title," Journal Volume, no. Issue (Year): Pages.
_CHICAGO_NB_ARTICLE = CompiledPattern.create(
    name="chicago_nb_article",
    pattern=(
        r"^(?:(?:\[\s*(?P<index>\d+)\s*\]|(?P<num>\d+)\.)\s*)?"
        r"(?P<authors>[A-ZÀ-Ý].+?)[.,]?\s+"  # Authors. or Authors,
        r'["\u201c\u2018\'](?P<title>.+?)["\u201d\u2019\'][.,]?\s*'  # "Title." or 'Title,'
        r"(?P<venue>.*\(\s*(?:18|19|20)\d{2}[a-z]?\s*\).*)"  # Venue with (Year)
        r"$"
    ),
    pattern_type=PatternType.REFERENCE_ENTRY,
    description='Chicago Notes-Bibliography article: Author. "Title." Journal Vol, no. Issue (Year): Pages.',
)

# --- Utility pattern for detecting footnote/footnote markers ---

_CHICAGO_FOOTNOTE_MARKER = CompiledPattern.create(
    name="chicago_footnote_marker",
    pattern=r"^\^?\s*\[?\d+\]?\s*$",
    pattern_type=PatternType.UTILITY,
    description="Chicago footnote marker: ^1 | [1]",
)


# =============================================================================
# Chicago Format Implementation
# =============================================================================


class ChicagoFormat:
    """Chicago citation format implementation.

    Chicago style is commonly used in:
        - History
        - Arts
        - Humanities
        - Some social sciences

    Chicago offers two systems:
        1. Notes-Bibliography (most common in humanities)
        2. Author-Date (common in sciences)

    This implementation handles both systems:
        - In-text parenthetical citations: (Author Year), (Author, Year)
        - In-text narrative citations: Author (Year)
        - In-text notes citations: ^1, [1]
        - Reference list entries with full metadata extraction
        - Book, article, and website reference formats
    """

    @property
    def name(self) -> str:
        """Format name."""
        return "Chicago"

    @property
    def priority(self) -> int:
        """Priority for format resolution (higher = try first).

        Chicago is common but less frequent than APA/MLA in CS papers.
        Priority 70 (after APA at 100, IEEE at 90, Vancouver at 80).
        """
        return 70

    @property
    def in_text_patterns(self) -> list[CompiledPattern]:
        """Patterns for extracting Chicago in-text citations."""
        return [
            _CHICAGO_AD_PARENTHETICAL,
            _CHICAGO_AD_PARENTHETICAL_NOCOMMA,
            _CHICAGO_AD_NARRATIVE,
            _CHICAGO_NOTES_SUPERSCRIPT,
            _CHICAGO_NOTES_BRACKETED,
        ]

    @property
    def reference_patterns(self) -> list[CompiledPattern]:
        """Patterns for extracting Chicago reference list entries."""
        return [
            _CHICAGO_AD_ARTICLE,
            _CHICAGO_AD_BOOK,
            _CHICAGO_AD_NUMBERED,
            _CHICAGO_NB_ARTICLE,
            _CHICAGO_NB_BOOK,
        ]

    def parse_reference_entry(self, text: str) -> Citation | None:
        """Parse Chicago reference entry into Citation object.

        Args:
            text: Raw reference entry text

        Returns:
            Citation object if successfully parsed, None otherwise

        Examples:
            >>> text = "Smith, John, and Jane Doe. 2020. \"Article Title.\" Journal 10 (2): 1-15."
            >>> citation = ChicagoFormat().parse_reference_entry(text)
            >>> citation.authors
            ['Smith, John', 'Jane Doe']
            >>> citation.year
            '2020'
        """
        # Normalize whitespace
        text = re.sub(r'\s+', ' ', text.strip())

        # Extract numeric index first
        numeric_index = None
        idx_match = re.search(r'\[\s*(\d+)\s*\]', text)
        if idx_match:
            numeric_index = int(idx_match.group(1))

        # Try Author-Date article format first (most specific)
        citation = self._try_parse_ad_article(text)
        if citation:
            if numeric_index and citation.numeric_index is None:
                citation.numeric_index = numeric_index
            return citation

        # Try Author-Date book format
        citation = self._try_parse_ad_book(text)
        if citation:
            if numeric_index and citation.numeric_index is None:
                citation.numeric_index = numeric_index
            return citation

        # Try Author-Date numbered format
        citation = self._try_parse_ad_numbered(text)
        if citation:
            return citation

        # Try Notes-Bibliography formats
        citation = self._try_parse_nb_article(text)
        if citation:
            if numeric_index and citation.numeric_index is None:
                citation.numeric_index = numeric_index
            return citation

        citation = self._try_parse_nb_book(text)
        if citation:
            if numeric_index and citation.numeric_index is None:
                citation.numeric_index = numeric_index
            return citation

        # Fallback
        return self._parse_chicago_fallback(text)

    def _try_parse_ad_article(self, text: str) -> Citation | None:
        """Try to parse Chicago Author-Date article format."""
        match = _CHICAGO_AD_ARTICLE.search(text)
        if match:
            return self._parse_ad_article_entry(match, text)
        return None

    def _try_parse_ad_book(self, text: str) -> Citation | None:
        """Try to parse Chicago Author-Date book format."""
        match = _CHICAGO_AD_BOOK.search(text)
        if match:
            return self._parse_ad_book_entry(match, text)
        return None

    def _try_parse_ad_numbered(self, text: str) -> Citation | None:
        """Try to parse Chicago Author-Date numbered format."""
        match = _CHICAGO_AD_NUMBERED.search(text)
        if match:
            return self._parse_ad_numbered_entry(match, text)
        return None

    def _try_parse_nb_article(self, text: str) -> Citation | None:
        """Try to parse Chicago Notes-Bibliography article format."""
        match = _CHICAGO_NB_ARTICLE.search(text)
        if match:
            return self._parse_nb_article_entry(match, text)
        return None

    def _try_parse_nb_book(self, text: str) -> Citation | None:
        """Try to parse Chicago Notes-Bibliography book format."""
        match = _CHICAGO_NB_BOOK.search(text)
        if match:
            return self._parse_nb_book_entry(match, text)
        return None

    def _parse_ad_article_entry(
        self, match: re.Match, text: str
    ) -> Citation | None:
        """Parse Chicago Author-Date article entry."""
        citation = Citation(
            raw_text=text,
            citation_type=CitationType.REFERENCE_LIST,
            style=CitationStyle.CHICAGO,
            matched_pattern="chicago_ad_article",
        )

        # Extract authors
        authors_str = match.group('authors')
        if authors_str:
            citation.authors = self._parse_authors(authors_str)

        # Extract year
        year_str = match.group('year')
        if year_str:
            citation.year = year_str

        # Extract title (remove quotes and trailing period)
        title = match.group('title').strip()
        # Strip ASCII and curly quotes
        for q in ['"', '"', '"', '"', '"', '"']:
            if title.startswith(q) and title.endswith(q):
                title = title[len(q):-len(q)]
                break
        # Strip trailing period if present
        title = title.rstrip('.')
        citation.title = title
        citation.title_normalized = self._normalize_title(title)

        # Extract venue
        venue = match.group('venue').strip()
        self._parse_venue(citation, venue)

        # Extract DOI if present
        doi_match = re.search(r'10\.\d{4,9}/[^\s\]\)\,;]+', text)
        if doi_match:
            citation.doi = doi_match.group(0).rstrip('.')

        citation.confidence = self._estimate_confidence(citation)
        return citation

    def _parse_ad_book_entry(
        self, match: re.Match, text: str
    ) -> Citation | None:
        """Parse Chicago Author-Date book entry."""
        citation = Citation(
            raw_text=text,
            citation_type=CitationType.REFERENCE_LIST,
            style=CitationStyle.CHICAGO,
            matched_pattern="chicago_ad_book",
        )

        # Extract authors
        authors_str = match.group('authors')
        if authors_str:
            citation.authors = self._parse_authors(authors_str)

        # Extract year
        year_str = match.group('year')
        if year_str:
            citation.year = year_str

        # Extract title
        title = match.group('title').strip()
        citation.title = title
        citation.title_normalized = self._normalize_title(title)

        # Extract place and publisher
        place_pub = match.group('place_pub')
        if place_pub:
            place_pub = place_pub.strip()
            if ':' in place_pub:
                parts = place_pub.split(':', 1)
                citation.venue = parts[1].strip() if len(parts) > 1 else place_pub
            else:
                citation.venue = place_pub

        # Extract DOI if present
        doi_match = re.search(r'10\.\d{4,9}/[^\s\]\)\,;]+', text)
        if doi_match:
            citation.doi = doi_match.group(0).rstrip('.')

        citation.confidence = self._estimate_confidence(citation)
        return citation

    def _parse_ad_numbered_entry(
        self, match: re.Match, text: str
    ) -> Citation | None:
        """Parse Chicago Author-Date numbered entry."""
        citation = Citation(
            raw_text=text,
            citation_type=CitationType.REFERENCE_LIST,
            style=CitationStyle.CHICAGO,
            matched_pattern="chicago_ad_numbered",
        )

        # Extract numeric index
        index = match.group('index')
        if index:
            citation.numeric_index = int(index)

        # Extract authors
        authors_str = match.group('authors')
        if authors_str:
            citation.authors = self._parse_authors(authors_str)

        # Extract year
        year_str = match.group('year')
        if year_str:
            citation.year = year_str

        # Extract title
        title = match.group('title').strip()
        citation.title = title
        citation.title_normalized = self._normalize_title(title)

        # Extract DOI if present
        doi_match = re.search(r'10\.\d{4,9}/[^\s\]\)\,;]+', text)
        if doi_match:
            citation.doi = doi_match.group(0).rstrip('.')

        citation.confidence = self._estimate_confidence(citation)
        return citation

    def _parse_nb_article_entry(
        self, match: re.Match, text: str
    ) -> Citation | None:
        """Parse Chicago Notes-Bibliography article entry."""
        citation = Citation(
            raw_text=text,
            citation_type=CitationType.REFERENCE_LIST,
            style=CitationStyle.CHICAGO,
            matched_pattern="chicago_nb_article",
        )

        # Extract numeric index if present
        index = match.groupdict().get('index') or match.groupdict().get('num')
        if index:
            citation.numeric_index = int(index)

        # Extract authors
        authors_str = match.group('authors')
        if authors_str:
            citation.authors = self._parse_authors(authors_str)

        # Extract title (remove quotes and trailing period/comma)
        title = match.group('title').strip()
        # Strip ASCII and curly quotes
        for q in ['"', '"', '"', '"', '"', '"']:
            if title.startswith(q) and title.endswith(q):
                title = title[len(q):-len(q)]
                break
        # Strip trailing period or comma if present
        title = title.rstrip('.,')
        citation.title = title
        citation.title_normalized = self._normalize_title(title)

        # Extract venue
        venue = match.group('venue').strip()
        self._parse_venue(citation, venue)

        # Extract DOI if present
        doi_match = re.search(r'10\.\d{4,9}/[^\s\]\)\,;]+', text)
        if doi_match:
            citation.doi = doi_match.group(0).rstrip('.')

        citation.confidence = self._estimate_confidence(citation)
        return citation

    def _parse_nb_book_entry(
        self, match: re.Match, text: str
    ) -> Citation | None:
        """Parse Chicago Notes-Bibliography book entry."""
        citation = Citation(
            raw_text=text,
            citation_type=CitationType.REFERENCE_LIST,
            style=CitationStyle.CHICAGO,
            matched_pattern="chicago_nb_book",
        )

        # Extract numeric index if present
        index = match.groupdict().get('index') or match.groupdict().get('num')
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

        # Extract place, publisher and year
        place_pub = match.group('place_pub')
        year_str = match.group('year')
        if year_str:
            # Remove leading comma
            citation.year = year_str.lstrip(',').strip()

        if place_pub:
            place_pub = place_pub.strip()
            # Remove year from place_pub
            if citation.year:
                import re as re_module
                place_pub = re_module.sub(r',\s*' + re.escape(citation.year), '', place_pub)
            if ':' in place_pub:
                parts = place_pub.split(':', 1)
                citation.venue = parts[1].strip() if len(parts) > 1 else place_pub
            else:
                citation.venue = place_pub

        # Extract DOI if present
        doi_match = re.search(r'10\.\d{4,9}/[^\s\]\)\,;]+', text)
        if doi_match:
            citation.doi = doi_match.group(0).rstrip('.')

        citation.confidence = self._estimate_confidence(citation)
        return citation

    def _parse_chicago_fallback(self, text: str) -> Citation | None:
        """Fallback parser: only match when Chicago-specific cues exist."""
        if not (
            re.search(r",\s*no\.\s*\d+\s*\((?:18|19|20)\d{2}\)", text)
            or re.search(r"[^.:]+:\s*[^,]+,\s*(?:18|19|20)\d{2}\b", text)
            or re.search(r'["\u201c\u2018\'][^"\u201d\u2019\']+["\u201d\u2019\'].*\b(?:18|19|20)\d{2}\b', text)
        ):
            return None

        citation = Citation(
            raw_text=text,
            citation_type=CitationType.REFERENCE_LIST,
            style=CitationStyle.CHICAGO,
            matched_pattern="chicago_fallback",
        )

        # Extract numeric index
        idx_match = re.search(r'^(?:\[\s*(\d+)\s*\]|(\d+)\.)', text)
        if idx_match:
            citation.numeric_index = int(idx_match.group(1) or idx_match.group(2))

        # Try to extract year
        yr, yr_suf = extract_publication_year(text, prefer_last=True)
        if yr:
            citation.year = yr
            citation.year_suffix = yr_suf

        # Try to extract title (text between quotes or before Place: Publisher)
        quote_m = re.search(r'["\u201c\u2018\']([^"\u201d\u2019\']{4,})["\u201d\u2019\']', text)
        if quote_m:
            title = quote_m.group(1).strip().rstrip('.,')
            citation.title = title
            citation.title_normalized = self._normalize_title(title)
            pre_quote = re.sub(r'^(?:\[\s*\d+\s*\]|\d+\.)\s*', '', text[:quote_m.start()]).strip().rstrip('.,:')
            if pre_quote:
                citation.authors = self._parse_authors(pre_quote)
        else:
            body_no_idx = re.sub(r'^(?:\[\s*\d+\s*\]|\d+\.)\s*', '', text).strip()
            pub_m = re.search(r'(?:\(\s*|\.\s+)([^.:()]+:\s*[^,()]+,\s*(?:18|19|20)\d{2})', body_no_idx)
            if pub_m:
                before_pub = body_no_idx[:pub_m.start()].strip().rstrip('.,')
                sep_m = re.search(r'(?<!\b[A-ZÀ-Ý])[.,]\s+', before_pub)
                if sep_m:
                    auth_part = before_pub[:sep_m.start()].strip()
                    title_part = before_pub[sep_m.end():].strip().rstrip('.,')
                    if auth_part:
                        citation.authors = self._parse_authors(auth_part)
                    if title_part:
                        citation.title = title_part
                        citation.title_normalized = self._normalize_title(title_part)

        # Extract DOI
        doi_m = re.search(r'10\.\d{4,9}/[^\s\]\)\,;]+', text)
        if doi_m:
            citation.doi = doi_m.group(0).rstrip('.')

        citation.confidence = self._estimate_confidence(citation)
        return citation if citation.title and citation.year else None

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

        # Extract volume, issue, optional (year), and pages:
        # "Journal 10 (2): 1-15" or "Journal 10, no. 2 (2020): 1-15" or "Journal 10, no. 2, 2020, 1-15"
        vol_match = re.search(
            r'(?P<journal>.+?)\s+(?P<vol>\d+)'
            r'(?:,\s*no\.\s*(?P<issue2>[\d–-]+)|\s*\((?P<issue>[\d–-]+)\))?'
            r'(?:\s*\((?P<year>(?:18|19|20)\d{2}[a-z]?)\)|,\s*(?P<year2>(?:18|19|20)\d{2}[a-z]?)\b)?'
            r'(?:(?::\s*|,\s*(?:pp?\.\s*)?)(?P<pages>[\d–-]+))?',
            venue_text
        )
        if vol_match:
            citation.venue = vol_match.group('journal').strip()
            citation.volume = vol_match.group('vol')
            issue = vol_match.group('issue') or vol_match.group('issue2')
            if issue:
                citation.issue = issue
            year = vol_match.group('year') or vol_match.groupdict().get('year2')
            if year and not citation.year:
                citation.year = year
            pages = vol_match.group('pages')
            if pages:
                citation.pages = pages
        else:
            # Check for (Year) or , Year even without volume
            year_m = re.search(r'(?:\(\s*((?:18|19|20)\d{2}[a-z]?)\s*\)|,\s*((?:18|19|20)\d{2}[a-z]?)\b)', venue_text)
            if year_m and not citation.year:
                citation.year = year_m.group(1) or year_m.group(2)
            citation.venue = venue_text

        # Clean up venue
        if citation.venue:
            # Remove DOI from venue
            citation.venue = re.sub(
                r'\s*https?://(?:dx\.)?doi\.org/\S+',
                "",
                citation.venue
            ).strip()
            citation.venue = re.sub(
                r'\s*10\.\d{4,9}/\S+',
                "",
                citation.venue
            ).strip()
            citation.venue = citation.venue.rstrip('.,')

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
        """Check if text is a valid Chicago citation.

        Args:
            text: Text to validate

        Returns:
            True if text matches Chicago citation pattern, False otherwise
        """
        # Check for Author-Date patterns
        if re.search(r'\(\s*[A-Z][a-z]+.*\d{4}', text):
            return True

        # Check for numbered reference
        if re.match(r'^\[\s*\d+\s*\]', text):
            return True

        # Check for footnote marker
        if re.match(r'^\^?\s*\[?\d+\]?\s*$', text.strip()):
            return True

        return False


# =============================================================================
# Auto-registration
# =============================================================================

# Register Chicago format when this module is imported
register_format(ChicagoFormat())


# =============================================================================
# Module-level pattern lists for convenience
# =============================================================================

CHICAGO_IN_TEXT_PATTERNS = [
    _CHICAGO_AD_PARENTHETICAL,
    _CHICAGO_AD_PARENTHETICAL_NOCOMMA,
    _CHICAGO_AD_NARRATIVE,
    _CHICAGO_NOTES_SUPERSCRIPT,
    _CHICAGO_NOTES_BRACKETED,
]

CHICAGO_REFERENCE_PATTERNS = [
    _CHICAGO_AD_ARTICLE,
    _CHICAGO_AD_BOOK,
    _CHICAGO_AD_NUMBERED,
    _CHICAGO_NB_ARTICLE,
    _CHICAGO_NB_BOOK,
]
