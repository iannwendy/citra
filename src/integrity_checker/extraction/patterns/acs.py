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
from integrity_checker.matching.author_parser import parse_authors
from integrity_checker.models.citation import Citation, CitationStyle, CitationType

# =============================================================================
# ACS Pattern Definitions
# =============================================================================

# --- In-text ACS patterns ---

# Superscript numbers: ^1, ^2 (math-safe)
_ACS_SUPERSCRIPT = CompiledPattern.create(
    name="acs_superscript",
    pattern=r"(?:(?<=^)|(?<=[A-Za-zÀ-ÿ]{2})|(?<=[A-Za-zÀ-ÿ]{2}[.,;:\])]))\^(\d{1,3}(?:\s*[,–-]\s*\d{1,3})*)",
    pattern_type=PatternType.IN_TEXT,
    description="ACS superscript: ^1 | ^2",
)

# Superscript with author: Smith^1
_ACS_AUTHOR_SUPERSCRIPT = CompiledPattern.create(
    name="acs_author_superscript",
    pattern=r"([A-Z][a-zA-ZÀ-žÀ-ž]+)\^(\d{1,3}(?:\s*[,–-]\s*\d{1,3})*)",
    pattern_type=PatternType.IN_TEXT,
    description="ACS author-superscript: Smith^1",
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

_ACS_PREFIX = r"^(?:(?:\(\s*(?P<index>\d+)\s*\)|(?P<num>\d+)\.|\[\s*(?P<b_idx>\d+)\s*\])\s*)?"

# ACS article:
# (1) Authors. Title. Journal Abbrev. Year, Volume (Issue), Pages.
# or 1. Authors. Title. Journal Year, Volume, Pages.
_ACS_REFERENCE_ARTICLE = CompiledPattern.create(
    name="acs_reference_article",
    pattern=(
        _ACS_PREFIX
        + r"(?P<authors>.+?)\.\s+(?!(?:[A-ZÀ-Ý]\.(?!\s+[A-Z][a-z]+\.)|;|and\b|et\s+al\.))"  # Authors. (don't stop at initial)
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
        + r"(?P<authors>.+?)\.\s+(?!(?:[A-ZÀ-Ý]\.(?!\s+[A-Z][a-z]+\.)|;|and\b|et\s+al\.))"
        + r"(?:(?P<title>[^.]{5,}?)\.\s+)?"
        + r"(?P<venue>[A-Z][^;0-9]+?)\.\s*"
        + r"(?P<year>(?:19|20)\d{2})(?!\s*;)"
        + r"(?:,\s*(?P<volume>\d+))"
        + r"(?:\s*\((?P<issue>[^)]+)\))?"
        + r"(?:,\s*(?:pp?\.\s*)?(?P<pages>[\d–-]+))?"
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
        + r"(?P<authors>.+?)\.\s+(?!(?:[A-ZÀ-Ý]\.(?!\s+[A-Z][a-z]+\.)|;|and\b|et\s+al\.))"
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
            _ACS_SUPERSCRIPT,
            _ACS_AUTHOR_SUPERSCRIPT,
            # FIX: removed _ACS_PARENTHESIZED and _ACS_COMMA_SEPARATED — matches (1), (2)
            # and numbers with commas in body text.
        ]

    @property
    def reference_patterns(self) -> list[CompiledPattern]:
        """Patterns for extracting ACS reference list entries."""
        return [
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

    def _parse_article_entry(
        self, match: re.Match, text: str
    ) -> Citation | None:
        """Parse ACS article entry."""
        citation = Citation(
            raw_text=text,
            citation_type=CitationType.REFERENCE_LIST,
            style=CitationStyle.ACS,
            matched_pattern="acs_reference_article",
        )

        # Extract numeric index
        index = match.groupdict().get('index') or match.groupdict().get('num') or match.groupdict().get('b_idx')
        if index:
            citation.numeric_index = int(index)

        # Extract authors
        authors_str = match.group('authors')
        if authors_str:
            citation.authors = self._parse_authors(authors_str)

        # Extract venue
        venue = match.group('venue').strip()
        citation.venue = venue

        # Extract title (optional in ACS journal citations)
        raw_title = match.groupdict().get('title')
        if raw_title and raw_title.strip():
            title = raw_title.strip()
            citation.title = title
            citation.title_normalized = self._normalize_title(title)
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
        citation = Citation(
            raw_text=text,
            citation_type=CitationType.REFERENCE_LIST,
            style=CitationStyle.ACS,
            matched_pattern="acs_reference_doi",
        )

        # Extract numeric index
        index = match.groupdict().get('index') or match.groupdict().get('num') or match.groupdict().get('b_idx')
        if index:
            citation.numeric_index = int(index)

        # Extract authors
        authors_str = match.group('authors')
        if authors_str:
            citation.authors = self._parse_authors(authors_str)

        # Extract venue
        venue = match.group('venue').strip()
        citation.venue = venue

        # Extract title (optional in ACS journal citations)
        raw_title = match.groupdict().get('title')
        if raw_title and raw_title.strip():
            title = raw_title.strip()
            citation.title = title
            citation.title_normalized = self._normalize_title(title)
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
        citation = Citation(
            raw_text=text,
            citation_type=CitationType.REFERENCE_LIST,
            style=CitationStyle.ACS,
            matched_pattern="acs_reference_journal_abbrev",
        )

        # Extract numeric index
        index = match.groupdict().get('index') or match.groupdict().get('num') or match.groupdict().get('b_idx')
        if index:
            citation.numeric_index = int(index)

        # Extract authors
        authors_str = match.group('authors')
        if authors_str:
            citation.authors = self._parse_authors(authors_str)

        # Extract venue
        venue = match.group('venue').strip()
        citation.venue = venue

        # Extract title (optional in ACS journal citations)
        raw_title = match.groupdict().get('title')
        if raw_title and raw_title.strip():
            title = raw_title.strip()
            citation.title = title
            citation.title_normalized = self._normalize_title(title)
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
    _ACS_SUPERSCRIPT,
    _ACS_AUTHOR_SUPERSCRIPT,
    # FIX: removed _ACS_PARENTHESIZED and _ACS_COMMA_SEPARATED
]

ACS_REFERENCE_PATTERNS = [
    _ACS_REFERENCE_DOI,
    _ACS_REFERENCE_ARTICLE,
    _ACS_REFERENCE_JOURNAL_ABBREV,
    _ACS_BOOK_CHAPTER,
    _ACS_BOOK,
    _ACS_TECH_REPORT,
]
