"""Nature citation format patterns and parser.

This module provides Nature citation format implementation for the
modular citation pattern system.

Nature Style Citations:
    In-text:
        - Superscript numbers: ^1, ^2
        - Sometimes bracketed: [1], [2]

    Reference list:
        - Numbered list: 1. Authors, Title, Journal Volume, Pages (Year).
        - Compact format: Authors, Title, Journal Volume, Pages (Year).
        - Abbreviated journal names
        - No period after journal name before year

Key characteristics:
    - Superscript citations preferred
    - Compact reference format
    - Journal name usually abbreviated
    - Year in parentheses at end

Reference:
    https://www.nature.com/nature-authors
    https://www.nature.com/srep/author-instructions
"""

from __future__ import annotations

import re
from typing import Optional

from integrity_checker.extraction.patterns.base import CompiledPattern, PatternType
from integrity_checker.extraction.patterns.registry import register_format
from integrity_checker.matching.author_parser import parse_authors
from integrity_checker.models.citation import Citation, CitationStyle, CitationType


# =============================================================================
# Nature Pattern Definitions
# =============================================================================

# --- In-text Nature patterns ---

# Superscript numbers: ^1, ^2 (math-safe: must follow word/punctuation, not digit/single var)
_NATURE_SUPERSCRIPT = CompiledPattern.create(
    name="nature_superscript",
    pattern=r"(?:(?<=^)|(?<=[A-Za-zÀ-ÿ]{2})|(?<=[A-Za-zÀ-ÿ]{2}[.,;:\])]))\^(\d{1,3}(?:\s*[,–-]\s*\d{1,3})*)",
    pattern_type=PatternType.IN_TEXT,
    description="Nature superscript: ^1 | ^2",
)

# Bracketed numbers: [1], [2]
_NATURE_BRACKETED = CompiledPattern.create(
    name="nature_bracketed",
    pattern=r"\[(\d+)\]",
    pattern_type=PatternType.IN_TEXT,
    description="Nature bracketed: [1] | [2]",
)

# Comma-separated superscripts: ^1,^2,^3
_NATURE_SUPERSCRIPT_COMMA = CompiledPattern.create(
    name="nature_superscript_comma",
    pattern=r"(?:(?<=^)|(?<=[A-Za-zÀ-ÿ]{2})|(?<=[A-Za-zÀ-ÿ]{2}[.,;:\])]))\^(\d+(?:,\s*\^*\d+)+)",
    pattern_type=PatternType.IN_TEXT,
    description="Nature superscript comma: ^1,^2 | ^1, ^2",
)

# --- Reference list Nature patterns ---

# Nature compact article:
# 1. Authors. Title. Journal Volume, Pages (Year).
# or 1. Authors. Title, Journal Volume, Pages (Year).
_NATURE_REFERENCE_COMPACT = CompiledPattern.create(
    name="nature_reference_compact",
    pattern=(
        r"^"
        r"(?:(?P<index>\d+)\.\s*)?"  # Optional number.
        r"(?P<authors>.+?)\.\s+(?!(?:[A-ZÀ-Ý]\.|[A-ZÀ-Ý][a-zà-ÿ'\u2019\-]+(?:[.,]\s|\s+and\b|\s*&|\s+et\s+al\b)|&|and\b|et\s+al\.))"  # Authors. (don't stop at initial/et al.)
        r"(?P<title>[^.]+?)[.,]\s+"  # Title. or Title,
        r"(?P<venue>[^0-9,;]+?)\s+"  # Journal (no numbers)
        r"(?P<volume>\d+)"  # Volume
        r"(?:,\s*(?P<pages>[\d–-]+|[a-zA-Z]?\d+))?"  # , Pages
        r"\s*\(\s*(?P<year>(?:19|20)\d{2}[a-z]?)\s*\)\.?"  # (Year)
        r"(?P<rest>.*)$"
    ),
    pattern_type=PatternType.REFERENCE_ENTRY,
    description="Nature compact: Authors. Title. Journal Volume, Pages (Year).",
)

# Nature with numbered prefix:
# [1] Authors. Title. Journal Volume, Pages (Year).
_NATURE_NUMBERED = CompiledPattern.create(
    name="nature_numbered",
    pattern=(
        r"^\[\s*(?P<index>\d+)\s*\]\s*"  # [N]
        r"(?P<authors>.+?)\.\s+(?!(?:[A-ZÀ-Ý]\.|[A-ZÀ-Ý][a-zà-ÿ'\u2019\-]+(?:[.,]\s|\s+and\b|\s*&|\s+et\s+al\b)|&|and\b|et\s+al\.))"  # Authors.
        r"(?P<title>[^.]+?)[.,]\s+"  # Title. or Title,
        r"(?P<venue>[^0-9,;]+?)\s+"  # Journal (no numbers)
        r"(?P<volume>\d+)"  # Volume
        r"(?:,\s*(?P<pages>[\d–-]+|[a-zA-Z]?\d+))?"  # , Pages
        r"\s*\(\s*(?P<year>(?:19|20)\d{2}[a-z]?)\s*\)\.?"  # (Year)
        r"(?P<rest>.*)$"
    ),
    pattern_type=PatternType.REFERENCE_ENTRY,
    description="Nature numbered: [1] Authors. Title. Journal Volume, Pages (Year).",
)

# Nature article with DOI:
# 1. Authors. Title. Journal Volume, Pages (Year). doi:...
_NATURE_REFERENCE_DOI = CompiledPattern.create(
    name="nature_reference_doi",
    pattern=(
        r"^"
        r"(?:(?P<index>\d+)\.\s*)?"  # Optional number.
        r"(?P<authors>.+?)\.\s+(?!(?:[A-ZÀ-Ý]\.|[A-ZÀ-Ý][a-zà-ÿ'\u2019\-]+(?:[.,]\s|\s+and\b|\s*&|\s+et\s+al\b)|&|and\b|et\s+al\.))"  # Authors.
        r"(?P<title>[^.]+?)[.,]\s+"  # Title. or Title,
        r"(?P<venue>[^0-9,;]+?)\s+"  # Journal (no numbers)
        r"(?P<volume>\d+)"  # Volume
        r"(?:,\s*(?P<pages>[\d–-]+|[a-zA-Z]?\d+))?"  # , Pages
        r"\s*\(\s*(?P<year>(?:19|20)\d{2}[a-z]?)\s*\)"  # (Year)
        r"(?:\.\s*)?doi:\s*(?P<doi>\S+?)\.?"  # . doi:...
        r"$"
    ),
    pattern_type=PatternType.REFERENCE_ENTRY,
    description="Nature with DOI: Authors. Title, Journal Volume, Pages (Year). doi:...",
)

# Nature book:
# 1. Authors. Book Title (Publisher, Year). OR Authors, Book Title, Publisher, Year.
_NATURE_BOOK = CompiledPattern.create(
    name="nature_book",
    pattern=(
        r"^"
        r"(?:(?P<index>\d+)\.\s*)?"  # Optional number.
        r"(?P<authors>.+?)\.\s+(?!(?:[A-ZÀ-Ý]\.|[A-ZÀ-Ý][a-zà-ÿ'\u2019\-]+(?:[.,]\s|\s+and\b|\s*&|\s+et\s+al\b)|&|and\b|et\s+al\.))"  # Authors.
        r"(?P<title>[^.(]*[A-Za-z]{3,}[^.(]*?)\s*"
        r"\(\s*(?P<publisher>[^,()]+),\s*(?P<year>(?:19|20)\d{2})\s*\)\.?"
        r"(?P<rest>.*)$"
    ),
    pattern_type=PatternType.REFERENCE_ENTRY,
    description="Nature book: Authors. Book Title (Publisher, Year).",
)

# Nature book chapter:
# Authors, Chapter title, in Book Title (ed. Editor), Publisher, Year.
_NATURE_BOOK_CHAPTER = CompiledPattern.create(
    name="nature_book_chapter",
    pattern=(
        r"^"
        r"(?:(?P<index>\d+)\.\s*)?"  # Optional number.
        r"(?P<authors>.+?)(?:\.\s+(?!(?:[A-ZÀ-Ý]\.|[A-ZÀ-Ý][a-zà-ÿ'\u2019\-]+(?:[.,]\s|\s+and\b|\s*&|\s+et\s+al\b)|&|and\b))|,\s+)"  # Authors.
        r"(?P<chapter_title>[^.]+?)[.,]\s+"  # Chapter title,
        r"in\s+"  # in
        r"(?P<book_title>[^()]+?)"  # Book title
        r"(?:\s*\(eds?\.?\s+(?P<editor>[^)]+?)\))?"  # (ed. Editor)
        r"(?:,\s*(?P<publisher>[^,()]+?))?"  # , Publisher
        r"\s*(?:,\s*|\(\s*)(?P<year>(?:19|20)\d{2})\)?\.?"  # , Year or (Year)
        r"(?P<rest>.*)$"
    ),
    pattern_type=PatternType.REFERENCE_ENTRY,
    description="Nature book chapter: Authors, Chapter, in Book (ed. Editor), Publisher.",
)

# Nature website:
# Authors, Title, URL (Year).
_NATURE_WEBSITE = CompiledPattern.create(
    name="nature_website",
    pattern=(
        r"^"
        r"(?:\d+\.?\s*)?"  # Optional number.
        r"(?P<authors>.+?),?\s+"  # Authors,
        r"(?P<title>.+?),?\s+"  # Title,
        r"(?P<url>https?://\S+?)"  # URL
        r"\s*\(\s*(?P<year>(?:19|20)\d{2}[a-z]?)\s*\)\.?"  # Required (Year)
        r"$"
    ),
    pattern_type=PatternType.REFERENCE_ENTRY,
    description="Nature website: Authors, Title, URL (Year).",
)

# --- Utility pattern ---

_NATURE_NUMBER_MARKER = CompiledPattern.create(
    name="nature_number_marker",
    pattern=r'^\s*(?:\[\d+\]|\d+\.|\^?\d+)\s*',
    pattern_type=PatternType.UTILITY,
    description="Nature number marker: [N] | N. | ^N",
)


# =============================================================================
# Nature Format Implementation
# =============================================================================


class NatureFormat:
    """Nature citation format implementation.

    Nature style is commonly used in:
        - Nature journals
        - Scientific research
        - Biology, physics, medicine

    Key characteristics:
        - Superscript citations preferred
        - Compact reference format
        - Journal name abbreviated
        - Year in parentheses at end

    This implementation handles:
        - In-text numeric citations: ^1, [1]
        - Reference list entries for articles, books, chapters, websites
        - Both numbered and unnumbered formats
    """

    @property
    def name(self) -> str:
        """Format name."""
        return "Nature"

    @property
    def priority(self) -> int:
        """Priority for format resolution (higher = try first).

        Nature is common in scientific journals.
        Priority 78 (similar to AMA).
        """
        return 78

    @property
    def in_text_patterns(self) -> list[CompiledPattern]:
        """Patterns for extracting Nature in-text citations."""
        return [
            _NATURE_SUPERSCRIPT,
            _NATURE_BRACKETED,
            _NATURE_SUPERSCRIPT_COMMA,
        ]

    @property
    def reference_patterns(self) -> list[CompiledPattern]:
        """Patterns for extracting Nature reference list entries."""
        return [
            _NATURE_REFERENCE_DOI,
            _NATURE_NUMBERED,
            _NATURE_REFERENCE_COMPACT,
            _NATURE_BOOK_CHAPTER,
            _NATURE_BOOK,
            _NATURE_WEBSITE,
        ]

    def parse_reference_entry(self, text: str) -> Optional[Citation]:
        """Parse Nature reference entry into Citation object.

        Args:
            text: Raw reference entry text

        Returns:
            Citation object if successfully parsed, None otherwise

        Examples:
            >>> text = "1. Smith, J. & Jones, A. Article title, Nature 10, 123-145 (2020)."
            >>> citation = NatureFormat().parse_reference_entry(text)
            >>> citation.authors
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

        # Try numbered variant
        citation = self._try_parse_numbered(text)
        if citation:
            return citation

        # Try compact format
        citation = self._try_parse_compact(text)
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

        # Try website format
        citation = self._try_parse_website(text)
        if citation:
            if numeric_index and citation.numeric_index is None:
                citation.numeric_index = numeric_index
            return citation

        # Fallback
        return self._parse_nature_fallback(text)

    def _try_parse_article_doi(self, text: str) -> Optional[Citation]:
        """Try to parse Nature article with DOI format."""
        match = _NATURE_REFERENCE_DOI.search(text)
        if match:
            return self._parse_article_doi_entry(match, text)
        return None

    def _try_parse_numbered(self, text: str) -> Optional[Citation]:
        """Try to parse Nature numbered format."""
        match = _NATURE_NUMBERED.search(text)
        if match:
            return self._parse_numbered_entry(match, text)
        return None

    def _try_parse_compact(self, text: str) -> Optional[Citation]:
        """Try to parse Nature compact format."""
        match = _NATURE_REFERENCE_COMPACT.search(text)
        if match:
            return self._parse_compact_entry(match, text)
        return None

    def _try_parse_book(self, text: str) -> Optional[Citation]:
        """Try to parse Nature book format."""
        match = _NATURE_BOOK.search(text)
        if match:
            return self._parse_book_entry(match, text)
        return None

    def _try_parse_book_chapter(self, text: str) -> Optional[Citation]:
        """Try to parse Nature book chapter format."""
        match = _NATURE_BOOK_CHAPTER.search(text)
        if match:
            return self._parse_book_chapter_entry(match, text)
        return None

    def _try_parse_website(self, text: str) -> Optional[Citation]:
        """Try to parse Nature website format."""
        match = _NATURE_WEBSITE.search(text)
        if match:
            return self._parse_website_entry(match, text)
        return None

    def _parse_article_doi_entry(
        self, match: re.Match, text: str
    ) -> Optional[Citation]:
        """Parse Nature article with DOI entry."""
        citation = Citation(
            raw_text=text,
            citation_type=CitationType.REFERENCE_LIST,
            style=CitationStyle.NATURE,
            matched_pattern="nature_reference_doi",
        )

        # Extract authors
        authors_str = match.group('authors')
        if authors_str:
            citation.authors = self._parse_authors(authors_str)

        # Extract title
        title = match.group('title').strip()
        citation.title = title
        citation.title_normalized = self._normalize_title(title)

        # Extract venue and volume
        venue = match.group('venue').strip().rstrip('.,')
        volume = match.group('volume')
        pages = match.group('pages')

        citation.venue = venue
        if volume:
            citation.volume = volume

        if pages:
            citation.pages = pages

        # Extract year
        year_str = match.group('year')
        if year_str:
            citation.year = year_str[:4]
            if len(year_str) > 4:
                citation.year_suffix = year_str[4:]

        # Extract DOI
        doi = match.group('doi')
        if doi:
            citation.doi = doi.strip().rstrip('.')

        citation.confidence = self._estimate_confidence(citation)
        return citation

    def _parse_numbered_entry(
        self, match: re.Match, text: str
    ) -> Optional[Citation]:
        """Parse Nature numbered entry."""
        citation = Citation(
            raw_text=text,
            citation_type=CitationType.REFERENCE_LIST,
            style=CitationStyle.NATURE,
            matched_pattern="nature_numbered",
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

        # Extract venue and volume
        venue = match.group('venue').strip().rstrip('.,')
        volume = match.group('volume')
        pages = match.group('pages')

        citation.venue = venue
        if volume:
            citation.volume = volume

        if pages:
            citation.pages = pages

        # Extract year
        year_str = match.group('year')
        if year_str:
            citation.year = year_str[:4]
            if len(year_str) > 4:
                citation.year_suffix = year_str[4:]

        # Extract DOI if present
        doi_match = re.search(r'10\.\d{4,9}/[^\s\]\)\,;]+', text)
        if doi_match:
            citation.doi = doi_match.group(0).rstrip('.')

        citation.confidence = self._estimate_confidence(citation)
        return citation

    def _parse_compact_entry(
        self, match: re.Match, text: str
    ) -> Optional[Citation]:
        """Parse Nature compact entry."""
        citation = Citation(
            raw_text=text,
            citation_type=CitationType.REFERENCE_LIST,
            style=CitationStyle.NATURE,
            matched_pattern="nature_reference_compact",
        )

        # Extract authors
        authors_str = match.group('authors')
        if authors_str:
            citation.authors = self._parse_authors(authors_str)

        # Extract title
        title = match.group('title').strip()
        citation.title = title
        citation.title_normalized = self._normalize_title(title)

        # Extract venue and volume
        venue = match.group('venue').strip().rstrip('.,')
        volume = match.group('volume')
        pages = match.group('pages')

        citation.venue = venue
        if volume:
            citation.volume = volume

        if pages:
            citation.pages = pages

        # Extract year
        year_str = match.group('year')
        if year_str:
            citation.year = year_str[:4]
            if len(year_str) > 4:
                citation.year_suffix = year_str[4:]

        # Extract DOI if present
        doi_match = re.search(r'10\.\d{4,9}/[^\s\]\)\,;]+', text)
        if doi_match:
            citation.doi = doi_match.group(0).rstrip('.')

        citation.confidence = self._estimate_confidence(citation)
        return citation

    def _parse_book_entry(
        self, match: re.Match, text: str
    ) -> Optional[Citation]:
        """Parse Nature book entry."""
        citation = Citation(
            raw_text=text,
            citation_type=CitationType.REFERENCE_LIST,
            style=CitationStyle.NATURE,
            matched_pattern="nature_book",
        )

        # Extract authors
        authors_str = match.group('authors')
        if authors_str:
            citation.authors = self._parse_authors(authors_str)

        # Extract title
        title = match.group('title').strip()
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
        doi_match = re.search(r'10\.\d{4,9}/[^\s\]\)\,;]+', text)
        if doi_match:
            citation.doi = doi_match.group(0).rstrip('.')

        citation.confidence = self._estimate_confidence(citation)
        return citation

    def _parse_book_chapter_entry(
        self, match: re.Match, text: str
    ) -> Optional[Citation]:
        """Parse Nature book chapter entry."""
        citation = Citation(
            raw_text=text,
            citation_type=CitationType.REFERENCE_LIST,
            style=CitationStyle.NATURE,
            matched_pattern="nature_book_chapter",
        )

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
        year_str = match.group('year')

        citation.venue = book_title
        if editor:
            citation.venue += f" (ed. {editor.strip()})"
        if publisher:
            citation.venue += f", {publisher.strip()}"
        if year_str:
            citation.year = year_str

        # Extract DOI if present
        doi_match = re.search(r'10\.\d{4,9}/[^\s\]\)\,;]+', text)
        if doi_match:
            citation.doi = doi_match.group(0).rstrip('.')

        citation.confidence = self._estimate_confidence(citation)
        return citation

    def _parse_website_entry(
        self, match: re.Match, text: str
    ) -> Optional[Citation]:
        """Parse Nature website entry."""
        citation = Citation(
            raw_text=text,
            citation_type=CitationType.REFERENCE_LIST,
            style=CitationStyle.NATURE,
            matched_pattern="nature_website",
        )

        # Extract authors
        authors_str = match.group('authors')
        if authors_str:
            citation.authors = self._parse_authors(authors_str)

        # Extract title
        title = match.group('title').strip()
        citation.title = title
        citation.title_normalized = self._normalize_title(title)

        # Extract URL
        url = match.group('url')
        if url:
            citation.url = url.strip()

        # Extract year
        year_str = match.group('year')
        if year_str:
            citation.year = year_str

        # Extract DOI if present
        doi_match = re.search(r'10\.\d{4,9}/[^\s\]\)\,;]+', text)
        if doi_match:
            citation.doi = doi_match.group(0).rstrip('.')

        citation.confidence = self._estimate_confidence(citation)
        return citation

    def _parse_nature_fallback(self, text: str) -> Optional[Citation]:
        """Fallback parser: extract whatever metadata possible."""
        # Strip trailing Springer LNCS running header ("8 Ide et al.", "Ide et al. 8", or "Ide et al.")
        cleaned_text = re.sub(
            r'\s+(?:\d{1,3}\s+)?[A-Z][A-Za-zÀ-ÿ\-]+\s+et\s+al\.(?:\s+\d{1,3})?\s*$',
            '',
            text,
        ).strip()
        # Strip trailing access/retrieval date clauses (e.g. "(Accessed: Oct. 31, 2026)")
        # so the access year is never mistaken for the publication year.
        cleaned_text = re.sub(
            r'\s*(?:[\(\[]\s*(?:Accessed|Retrieved|Last\s+accessed)\b[^)\]]*[\)\]]|\b(?:Accessed|Retrieved)\s*:?\s*[A-Za-z0-9.,\s\-/]+)\.?$',
            '',
            cleaned_text,
            flags=re.IGNORECASE,
        ).strip()
        # Nature fallback applies when (Year) or (Publisher, Year) appears at the end of the entry (optionally followed by pages or Accessed/URL)
        year_m = re.search(
            r'\(\s*(?:(?!(?:Accessed|Retrieved)\b)(?P<pub>[^()]{2,80}),\s*)?(?P<year>(?:18|19|20)\d{2}[a-z]?)\s*\)(?:,?\s*pp?\.\s*[\d–-]+|\.\s*Accessed\b[^()]*|(?:\.\s*|\s+)(?:https?://|doi:\s*)\S+(?:;\s*[A-Za-z0-9\s]+:\s*https?://\S+)*)?\.?$',
            cleaned_text,
            re.IGNORECASE,
        )
        if not year_m:
            return None

        year_raw = year_m.group('year')
        pub_raw = (year_m.group('pub') or '').strip()
        citation = Citation(
            raw_text=text,
            citation_type=CitationType.REFERENCE_LIST,
            style=CitationStyle.NATURE,
            matched_pattern="nature_fallback",
            year=year_raw[:4],
            year_suffix=year_raw[4:] if len(year_raw) > 4 else None,
        )

        # Extract numeric index
        idx_match = re.search(r'\[\s*(\d+)\s*\]', cleaned_text)
        if idx_match:
            citation.numeric_index = int(idx_match.group(1))
        else:
            num_match = re.match(r'^(\d+)\.?\s', cleaned_text)
            if num_match:
                citation.numeric_index = int(num_match.group(1))

        # Look for text between author and year
        before_year = re.sub(r'^\s*(?:\[\s*\d+\s*\]|\d+\.?)\s*', '', cleaned_text[:year_m.start()]).strip()
        # Springer LNCS format: "N. Authors: Title. Venue (Year)"
        lncs_m = re.match(
            r'^(?P<authors>[^:]{2,250}?):\s+(?P<rest>.+)$',
            before_year,
        )
        if lncs_m and not re.search(r'\b(?:https?|doi|arXiv)\b', lncs_m.group('authors'), re.I):
            authors_str = lncs_m.group('authors').strip()
            rest_str = lncs_m.group('rest').strip()
            citation.authors = self._parse_authors(authors_str)
            if citation.authors:
                if '. ' in rest_str:
                    t_part, v_part = rest_str.split('. ', 1)
                    citation.title = t_part.strip().rstrip('.')
                    citation.venue = v_part.strip().rstrip('.,')
                else:
                    citation.title = rest_str.rstrip('.')
                if citation.title:
                    citation.title_normalized = self._normalize_title(citation.title)
        parts = [p.strip() for p in before_year.split(',') if p.strip()]
        if not citation.title and len(parts) == 1 and '. ' in before_year:
            dot_parts = [
                dp.strip()
                for dp in re.split(r'(?<!\b[A-Z])\.\s+', before_year)
                if dp.strip()
            ]
            if len(dot_parts) >= 2:
                citation.authors = self._parse_authors(dot_parts[0])
                citation.title = dot_parts[1].rstrip('.')
                citation.title_normalized = self._normalize_title(citation.title)
                if len(dot_parts) >= 3:
                    citation.venue = ". ".join(dot_parts[2:]).rstrip('.,')
        if not citation.title and len(parts) >= 2:
            init_author_re = re.compile(
                r'^(?:and\s+|&\s*)?(?:[A-ZÀ-Ý]\.?\s*[-–]?\s*)+[A-ZÀ-Ýa-zà-ÿ\'\u2019\-]+(?:\s+[A-ZÀ-Ýa-zà-ÿ\'\u2019\-]+){0,3}$'
            )
            author_end_idx = 0
            for idx_p, p in enumerate(parts):
                if init_author_re.match(p) or re.match(r'^(?:and\s+)?et\s+al\.?$', p, re.I):
                    author_end_idx = idx_p + 1
                else:
                    break
            if author_end_idx == 0:
                author_end_idx = 1
            authors_str = ", ".join(parts[:author_end_idx]).strip()
            if authors_str:
                citation.authors = self._parse_authors(authors_str)
            for idx_p in range(author_end_idx, len(parts)):
                cand = parts[idx_p].strip()
                if len(cand) > 6 and not re.match(r'^(?:vol\.|no\.|pp?\.|\d+$)', cand, re.I):
                    citation.title = cand
                    citation.title_normalized = self._normalize_title(cand)
                    if idx_p + 1 < len(parts):
                        citation.venue = ", ".join(parts[idx_p + 1 :]).strip().rstrip('.,')
                    break
        if pub_raw and not citation.venue:
            citation.venue = pub_raw
        if citation.numeric_index is not None and citation.authors and citation.title:
            citation.matched_pattern = "nature_comma_separated"
            if not citation.title and len(parts) >= 2:
                for part in parts[1:]:
                    if len(part) > 10:
                        citation.title = part
                        citation.title_normalized = self._normalize_title(part)
                        break

        # Extract DOI & URL
        doi_m = re.search(r'10\.\d{4,9}/[^\s\]\)\,;]+', text)
        if doi_m:
            citation.doi = doi_m.group(0).rstrip('.')
        url_m = re.search(r'https?://[^\s\]\)\,;]+', text)
        if url_m:
            citation.url = url_m.group(0).rstrip('.,;)')

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
        """Check if text is a valid Nature citation.

        Args:
            text: Text to validate

        Returns:
            True if text matches Nature citation pattern, False otherwise
        """
        # Check for superscript pattern
        if re.match(r'^\^?\s*\d+', text.strip()):
            return True

        # Check for bracketed number pattern
        bracket_pattern = r'^\[\s*\d+\s*\]'
        if re.match(bracket_pattern, text.strip()):
            return True

        # Check for Nature reference pattern: Authors, Title, Journal Volume (Year)
        if re.search(r',\s+\d+\s+\(\d{4}\)', text):
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

# Register Nature format when this module is imported
register_format(NatureFormat())


# =============================================================================
# Module-level pattern lists for convenience
# =============================================================================

NATURE_IN_TEXT_PATTERNS = [
    _NATURE_SUPERSCRIPT,
    _NATURE_BRACKETED,
    _NATURE_SUPERSCRIPT_COMMA,
]

NATURE_REFERENCE_PATTERNS = [
    _NATURE_REFERENCE_DOI,
    _NATURE_NUMBERED,
    _NATURE_REFERENCE_COMPACT,
    _NATURE_BOOK_CHAPTER,
    _NATURE_BOOK,
    _NATURE_WEBSITE,
]
