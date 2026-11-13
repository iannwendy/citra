"""AMA (American Medical Association) citation format patterns and parser.

This module provides AMA citation format implementation for the
modular citation pattern system.

AMA Style Citations:
    In-text:
        - Superscript numbers: ^1, ^2
        - Bracketed numbers: [1], [2]
        - Can also be: (1), (2)

    Reference list:
        - Numbered list: 1. Authors. Title. Journal. Year;Volume(Issue):Pages.
        - Format: Authors. Title. Source. YEAR;Volume:Pages.
        - Abbreviated journal names
        - Semicolon separator between elements

Key characteristics:
    - Numeric citations with superscripts
    - Journals use abbreviated names
    - Reference list uses numbered entries with period

Reference:
    https://www.amamanualofstyle.com/
    https://www.nlm.nih.gov/bsd/uniform_requirements.html
"""

from __future__ import annotations

import re

from integrity_checker.extraction.patterns.base import CompiledPattern, PatternType
from integrity_checker.extraction.patterns.registry import register_format
from integrity_checker.matching.author_parser import parse_authors
from integrity_checker.models.citation import Citation, CitationStyle, CitationType

# =============================================================================
# AMA Pattern Definitions
# =============================================================================

# --- In-text AMA patterns ---

# Superscript numbers: ^1, ^2 (math-safe)
_AMA_SUPERSCRIPT = CompiledPattern.create(
    name="ama_superscript",
    pattern=r"(?:(?<=^)|(?<=[A-Za-zÀ-ÿ]{2})|(?<=[A-Za-zÀ-ÿ]{2}[.,;:\])]))\^(?!(?:\d{1,3}\s*[,–-]\s*\^*)*\d{1,3}[a-z](?![A-Za-z0-9]))(\d{1,3}(?:\s*[,–-]\s*\d{1,3})*)(?![0-9A-Za-z]|\s*[,–-]\s*(?:\d{1,3}[a-z]|[a-z]\b))",
    pattern_type=PatternType.IN_TEXT,
    description="AMA superscript: ^1 | ^2",
)

# Bracketed numbers: [1], [2]
_AMA_BRACKETED = CompiledPattern.create(
    name="ama_bracketed",
    pattern=r"\[(\d+)\]",
    pattern_type=PatternType.IN_TEXT,
    description="AMA bracketed: [1] | [2]",
)

# Parenthesized numbers: (1), (2) — kept only as utility/reference marker, NOT in in_text_patterns
_AMA_PARENTHESIZED = CompiledPattern.create(
    name="ama_parenthesized",
    pattern=r"\((\d+)\)",
    pattern_type=PatternType.UTILITY,
    description="AMA parenthesized: (1) | (2)",
)

# FIX: removed _AMA_COMMA_SEPARATED — same issue as ACS: pattern matches data like
# 100,000 / 1,371, not just citation [1,2].

# --- Reference list AMA patterns ---

# AMA numbered article:
# 1. Authors. Title. Journal. YEAR;Volume(Issue):Pages.
_AMA_REFERENCE_ARTICLE = CompiledPattern.create(
    name="ama_reference_article",
    pattern=(
        r"^"
        r"(?:(?P<index>\d+)\.\s*)?"  # Optional Number.
        r"(?P<authors>[^;\"“]+?)\.\s+"  # Authors.
        r"(?P<title>[^\"“]+?)\.\s+"  # Title.
        r"(?P<venue>[^;\"“]+?)\.\s*"  # Journal.
        r"(?P<year>(?:19|20)\d{2})"  # Year
        r"(?:;(?P<volume>\d+)"  # ;Volume
        r"(?:\((?P<issue>[^)]+)\))?"  # (Issue)
        r"(?::(?P<pages>[\d–-]+))?)?"  # :Pages
        r"(?:\.\s*(?P<rest>(?:doi:\s*\S+|(?:(?:Available\s+from|URL)\s*:?\s*)?https?://\S+)?\.?)|\.?)$"
    ),
    pattern_type=PatternType.REFERENCE_ENTRY,
    description="AMA article: N. Authors. Title. Journal. YEAR;Vol(Issue):Pages.",
)

# AMA article with DOI:
# 1. Authors. Title. Journal. YEAR;Volume:Pages. doi:...
_AMA_REFERENCE_ARTICLE_DOI = CompiledPattern.create(
    name="ama_reference_article_doi",
    pattern=(
        r"^"
        r"(?:(?P<index>\d+)\.\s*)?"  # Optional Number.
        r"(?P<authors>[^;\"“]+?)\.\s+"  # Authors.
        r"(?P<title>[^\"“]+?)\.\s+"  # Title.
        r"(?P<venue>[^;\"“]+?)\.\s*"  # Journal.
        r"(?P<year>(?:19|20)\d{2})"  # Year
        r"(?:;(?P<volume>\d+)"  # ;Volume
        r"(?:\((?P<issue>[^)]+)\))?"  # (Issue)
        r"(?::(?P<pages>[\d–-]+))?)?"  # :Pages
        r"\.?\s*doi:\s*(?P<doi>\S+?)\.?"  # doi:...
        r"$"
    ),
    pattern_type=PatternType.REFERENCE_ENTRY,
    description="AMA article with DOI: N. Authors. Title. Journal. YEAR. doi:...",
)

# AMA book:
# [2.] Authors. Title. [3rd ed.] Place: Publisher; Year.
_AMA_BOOK = CompiledPattern.create(
    name="ama_book",
    pattern=(
        r"^(?:(?:\[\s*(?P<b_idx>\d+)\s*\]|(?P<index>\d+)\.)\s*)?"
        r"(?P<authors>[^;\"“]+?)\.\s+"  # Authors.
        r"(?P<title>[^.\"“]+?)\.\s+"  # Title.
        r"(?:(?:\d+(?:st|nd|rd|th)\s+ed\.?|[A-Za-z]+\s+ed\.?)\s+)?"  # Optional edition
        r"(?P<place_pub>[^;]+?)"  # Place: Publisher
        r";\s*(?P<year>(?:19|20)\d{2})\.?"  # ; Year (required for AMA book)
        r"(?P<rest>.*)$"
    ),
    pattern_type=PatternType.REFERENCE_ENTRY,
    description="AMA book: Authors. Title. Place: Publisher; Year.",
)

# AMA book chapter:
# Authors. Chapter title. In: Editor, ed(s). Book title. Place: Publisher; Year:Pages.
_AMA_BOOK_CHAPTER = CompiledPattern.create(
    name="ama_book_chapter",
    pattern=(
        r"^(?:(?:\[\s*(?P<b_idx>\d+)\s*\]|(?P<index>\d+)\.)\s*)?"
        r"(?P<authors>[^;\"“]+?)\.\s+"  # Authors.
        r"(?P<chapter_title>[^.\"“]+?)\.\s+"  # Chapter title.
        r"In:\s*"  # In:
        r"(?P<editor>[^.]+?)"  # Editor
        r"(?:,\s*\(?eds?\.?\)?\.?\s*|\.\s+)"  # ed(s).
        r"(?P<book_title>.+?)"  # Book title
        r";\s*(?P<year>(?:19|20)\d{2})"  # ; Year
        r"(?:[:;,]\s*(?:pp?\.\s*)?(?P<pages>[\d–-]+))?\.?"  # :Pages
        r"(?P<rest>.*)$"
    ),
    pattern_type=PatternType.REFERENCE_ENTRY,
    description="AMA book chapter: Authors. Chapter. In: Editor. Book. Year. Pages.",
)

# AMA numbered prefix variant:
# [1] Authors. Title. Journal. YEAR;Vol:Pages.
_AMA_NUMBERED = CompiledPattern.create(
    name="ama_numbered",
    pattern=(
        r"^\[\s*(?P<index>\d+)\s*\]\s*"  # [N]
        r"(?P<authors>[^;\"“]+?)\.\s+"  # Authors.
        r"(?P<title>[^\"“]+?)\.\s+"  # Title.
        r"(?P<venue>[^;\"“]+?)\.\s*"  # Journal.
        r"(?P<year>(?:19|20)\d{2})"  # Year
        r"(?:;(?P<volume>\d+)"  # ;Volume
        r"(?:\((?P<issue>[^)]+)\))?"  # (Issue)
        r"(?::(?P<pages>[\d–-]+))?)?"  # :Pages
        r"(?:\.\s*(?P<rest>(?:doi:\s*\S+|https?://\S+)?)|\.?)$"
    ),
    pattern_type=PatternType.REFERENCE_ENTRY,
    description="AMA numbered: [1] Authors. Title. Journal. YEAR.",
)

# --- Utility pattern ---

_AMA_NUMBER_MARKER = CompiledPattern.create(
    name="ama_number_marker",
    pattern=r'^\s*(?:\[\d+\]|\d+\.|\^?\d+)\s*',
    pattern_type=PatternType.UTILITY,
    description="AMA number marker: [N] | N. | ^N",
)


# =============================================================================
# AMA Format Implementation
# =============================================================================


class AMAFormat:
    """AMA citation format implementation.

    AMA style is commonly used in:
        - Medical journals
        - Health sciences
        - Biomedical research

    Key characteristics:
        - Numeric citations (superscripts preferred)
        - Numbered reference list
        - Abbreviated journal names
        - Semicolon separators in references

    This implementation handles:
        - In-text numeric citations: ^1, [1]
        - Reference list entries for articles, books, chapters
        - Both numbered and bracketed formats
    """

    @property
    def name(self) -> str:
        """Format name."""
        return "AMA"

    @property
    def priority(self) -> int:
        """Priority for format resolution (higher = try first).

        AMA is common in medical/health sciences.
        Priority 75 (similar to Vancouver, lower than IEEE).
        """
        return 75

    @property
    def in_text_patterns(self) -> list[CompiledPattern]:
        """Patterns for extracting AMA in-text citations."""
        return [
            _AMA_SUPERSCRIPT,
            _AMA_BRACKETED,
            # FIX: removed _AMA_PARENTHESIZED and _AMA_COMMA_SEPARATED
        ]

    @property
    def reference_patterns(self) -> list[CompiledPattern]:
        """Patterns for extracting AMA reference list entries."""
        return [
            _AMA_REFERENCE_ARTICLE,
            _AMA_REFERENCE_ARTICLE_DOI,
            _AMA_NUMBERED,
            _AMA_BOOK,
            _AMA_BOOK_CHAPTER,
        ]

    def parse_reference_entry(self, text: str) -> Citation | None:
        """Parse AMA reference entry into Citation object.

        Args:
            text: Raw reference entry text

        Returns:
            Citation object if successfully parsed, None otherwise

        Examples:
            >>> text = "1. Smith J, Jones A. Article title. J Clin Med. 2020;10(2):123-145."
            >>> citation = AMAFormat().parse_reference_entry(text)
            >>> citation.authors
            ['Smith J', 'Jones A']
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
        else:
            # Try period-numbered: "1. Authors..."
            num_match = re.match(r'^(\d+)\.?\s', text)
            if num_match:
                numeric_index = int(num_match.group(1))

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

        # Try numbered variant
        citation = self._try_parse_numbered(text)
        if citation:
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

        # Fallback
        return self._parse_ama_fallback(text)

    def _try_parse_article(self, text: str) -> Citation | None:
        """Try to parse AMA article format."""
        match = _AMA_REFERENCE_ARTICLE.search(text)
        if match:
            return self._parse_article_entry(match, text)
        return None

    def _try_parse_article_doi(self, text: str) -> Citation | None:
        """Try to parse AMA article with DOI format."""
        match = _AMA_REFERENCE_ARTICLE_DOI.search(text)
        if match:
            return self._parse_article_doi_entry(match, text)
        return None

    def _try_parse_numbered(self, text: str) -> Citation | None:
        """Try to parse AMA numbered format."""
        match = _AMA_NUMBERED.search(text)
        if match:
            return self._parse_numbered_entry(match, text)
        return None

    def _try_parse_book(self, text: str) -> Citation | None:
        """Try to parse AMA book format."""
        match = _AMA_BOOK.search(text)
        if match:
            return self._parse_book_entry(match, text)
        return None

    def _try_parse_book_chapter(self, text: str) -> Citation | None:
        """Try to parse AMA book chapter format."""
        match = _AMA_BOOK_CHAPTER.search(text)
        if match:
            return self._parse_book_chapter_entry(match, text)
        return None

    def _parse_article_entry(
        self, match: re.Match, text: str
    ) -> Citation | None:
        """Parse AMA article entry."""
        citation = Citation(
            raw_text=text,
            citation_type=CitationType.REFERENCE_LIST,
            style=CitationStyle.AMA,
            matched_pattern="ama_reference_article",
        )

        # Extract authors
        authors_str = match.group('authors')
        if authors_str:
            citation.authors = self._parse_authors(authors_str)

        # Extract title
        title = match.group('title').strip()
        citation.title = title
        citation.title_normalized = self._normalize_title(title)

        # Extract venue
        venue = match.group('venue').strip()
        citation.venue = venue

        # Extract year
        year_str = match.group('year')
        if year_str:
            citation.year = year_str

        # Extract volume/issue/pages
        volume = match.group('volume')
        if volume:
            citation.volume = volume
            issue = match.group('issue')
            if issue:
                citation.issue = issue
            pages = match.group('pages')
            if pages:
                citation.pages = pages

        # Extract DOI if present
        doi_match = re.search(r'10\.\d{4,9}/[^\s\]\)\,;]+', text)
        if doi_match:
            citation.doi = doi_match.group(0).rstrip('.')
        url_match = re.search(r'https?://[^\s\]\)\,;]+', text)
        if url_match:
            citation.url = url_match.group(0).rstrip('.')

        citation.confidence = self._estimate_confidence(citation)
        return citation

    def _parse_article_doi_entry(
        self, match: re.Match, text: str
    ) -> Citation | None:
        """Parse AMA article with DOI entry."""
        citation = self._parse_article_entry(match, text)
        if citation:
            citation.matched_pattern = "ama_reference_article_doi"
            # Extract DOI
            doi = match.group('doi')
            if doi:
                citation.doi = doi.strip()
        return citation

    def _parse_numbered_entry(
        self, match: re.Match, text: str
    ) -> Citation | None:
        """Parse AMA numbered entry."""
        citation = Citation(
            raw_text=text,
            citation_type=CitationType.REFERENCE_LIST,
            style=CitationStyle.AMA,
            matched_pattern="ama_numbered",
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

        # Extract venue
        venue = match.group('venue').strip()
        citation.venue = venue

        # Extract year
        year_str = match.group('year')
        if year_str:
            citation.year = year_str

        # Extract volume/issue/pages
        volume = match.group('volume')
        if volume:
            citation.volume = volume
            issue = match.group('issue')
            if issue:
                citation.issue = issue
            pages = match.group('pages')
            if pages:
                citation.pages = pages

        # Extract DOI if present
        doi_match = re.search(r'10\.\d{4,9}/[^\s\]\)\,;]+', text)
        if doi_match:
            citation.doi = doi_match.group(0).rstrip('.')
        url_match = re.search(r'https?://[^\s\]\)\,;]+', text)
        if url_match:
            citation.url = url_match.group(0).rstrip('.')

        citation.confidence = self._estimate_confidence(citation)
        return citation

    def _parse_book_entry(
        self, match: re.Match, text: str
    ) -> Citation | None:
        """Parse AMA book entry."""
        citation = Citation(
            raw_text=text,
            citation_type=CitationType.REFERENCE_LIST,
            style=CitationStyle.AMA,
            matched_pattern="ama_book",
        )

        idx = match.groupdict().get('index') or match.groupdict().get('b_idx')
        if idx:
            citation.numeric_index = int(idx)

        # Extract authors
        authors_str = match.group('authors')
        if authors_str:
            citation.authors = self._parse_authors(authors_str)

        # Extract title
        title = match.group('title').strip()
        citation.title = title
        citation.title_normalized = self._normalize_title(title)

        # Extract place, publisher, and year
        place_pub = match.group('place_pub')
        year_str = match.group('year')

        if year_str:
            citation.year = year_str

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
        url_match = re.search(r'https?://[^\s\]\)\,;]+', text)
        if url_match:
            citation.url = url_match.group(0).rstrip('.')

        citation.confidence = self._estimate_confidence(citation)
        return citation

    def _parse_book_chapter_entry(
        self, match: re.Match, text: str
    ) -> Citation | None:
        """Parse AMA book chapter entry."""
        citation = Citation(
            raw_text=text,
            citation_type=CitationType.REFERENCE_LIST,
            style=CitationStyle.AMA,
            matched_pattern="ama_book_chapter",
        )

        idx = match.groupdict().get('index') or match.groupdict().get('b_idx')
        if idx:
            citation.numeric_index = int(idx)

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
        pages = match.group('pages')
        year_str = match.group('year')

        citation.venue = book_title
        if editor:
            citation.venue = f"{book_title}, {editor.strip()}"
        if pages:
            citation.pages = pages
        if year_str:
            citation.year = year_str

        # Extract DOI if present
        doi_match = re.search(r'10\.\d{4,9}/[^\s\]\)\,;]+', text)
        if doi_match:
            citation.doi = doi_match.group(0).rstrip('.')
        url_match = re.search(r'https?://[^\s\]\)\,;]+', text)
        if url_match:
            citation.url = url_match.group(0).rstrip('.')

        citation.confidence = self._estimate_confidence(citation)
        return citation

    def _parse_ama_fallback(self, text: str) -> Citation | None:
        """Fallback parser: extract whatever metadata possible."""
        # AMA fallback only applies if entry has AMA semicolon-year / year-semicolon-vol structure
        if not re.search(r'(?:;\s*(?:19|20)\d{2}|\b(?:19|20)\d{2};\d+)', text):
            return None

        citation = Citation(
            raw_text=text,
            citation_type=CitationType.REFERENCE_LIST,
            style=CitationStyle.AMA,
            matched_pattern="ama_fallback",
        )

        # Extract numeric index
        idx_match = re.search(r'\[\s*(\d+)\s*\]', text)
        if idx_match:
            citation.numeric_index = int(idx_match.group(1))
        else:
            num_match = re.match(r'^(\d+)\.?\s', text)
            if num_match:
                citation.numeric_index = int(num_match.group(1))

        # Try to extract year
        year_m = re.search(r'\b((?:19|20)\d{2})\b', text)
        if year_m:
            citation.year = year_m.group(1)

        # Try to extract title (text between periods)
        parts = text.split('.')
        if len(parts) >= 2:
            for part in parts[1:]:
                part = part.strip()
                if len(part) > 20 and len(part) < 200:
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

        Args:
            authors_str: Author string

        Returns:
            List of author strings (via parse_authors)
        """
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
        """Check if text is a valid AMA citation.

        Args:
            text: Text to validate

        Returns:
            True if text matches AMA citation pattern, False otherwise
        """
        # Check for superscript pattern
        if re.match(r'^\^?\s*\d+', text.strip()):
            return True

        # Check for bracketed number pattern
        bracket_pattern = r'^\[\s*\d+\s*\]'
        if re.match(bracket_pattern, text.strip()):
            return True

        # Check for numbered reference list: "1. Authors. Title..."
        if re.match(r'^\d+\.?\s+[A-Z]', text):
            return True

        return False

    def is_reference_list_marker(self, text: str) -> bool:
        """Check if text is a reference list marker.

        Args:
            text: Text to check

        Returns:
            True if text is a reference list marker, False otherwise
        """
        # Match standalone [N] or N. at start
        if re.match(r'^\s*\[\d+\]\s*$', text):
            return True
        if re.match(r'^\s*\d+\.\s*$', text):
            return True
        if re.match(r'^\s*\^\d+\s*$', text):
            return True

        return False


# =============================================================================
# Auto-registration
# =============================================================================

# Register AMA format when this module is imported
register_format(AMAFormat())


# =============================================================================
# Module-level pattern lists for convenience
# =============================================================================

AMA_IN_TEXT_PATTERNS = [
    _AMA_SUPERSCRIPT,
    _AMA_BRACKETED,
    # FIX: removed _AMA_PARENTHESIZED and _AMA_COMMA_SEPARATED
]

AMA_REFERENCE_PATTERNS = [
    _AMA_REFERENCE_ARTICLE,
    _AMA_REFERENCE_ARTICLE_DOI,
    _AMA_NUMBERED,
    _AMA_BOOK,
    _AMA_BOOK_CHAPTER,
]
