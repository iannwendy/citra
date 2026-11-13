"""CSE (Council of Science Editors) citation format patterns and parser.

This module provides CSE citation format implementation for the
modular citation pattern system.

CSE Style Citations:
    Three systems:
        1. Citation-Sequence (C-S): References numbered in order of appearance
        2. Citation-Name (C-N): References alphabetized, numbered
        3. Name-Year (N-Y): (Author Year) similar to APA

    In-text (Citation-Sequence/Citation-Name):
        - Superscript numbers: ^1
        - Bracketed numbers: [1]

    In-text (Name-Year):
        - (Author Year) or (Author, Year)
        - (Author Year, p. XX)

    Reference list:
        - Numbered: 1. Authors. Title. Journal. Year;Vol(Issue):Pages.
        - Format varies by system used

Key characteristics:
    - Three different citation systems
    - Scientific writing
    - Flexible journal formatting

Reference:
    https://www.councilscienceeditors.org/
    https://www.scientificstyleandformat.org/
"""

from __future__ import annotations

import re

from integrity_checker.extraction.patterns.base import CompiledPattern, PatternType
from integrity_checker.extraction.patterns.registry import register_format
from integrity_checker.matching.author_parser import parse_authors
from integrity_checker.models.citation import Citation, CitationStyle, CitationType

# =============================================================================
# CSE Pattern Definitions
# =============================================================================

# --- In-text CSE patterns (Citation-Sequence / Citation-Name) ---

# Superscript numbers: ^1, ^2 (math-safe)
_CSE_SUPERSCRIPT = CompiledPattern.create(
    name="cse_superscript",
    pattern=r"(?:(?<=^)|(?<=[A-Za-zÀ-ÿ]{2})|(?<=[A-Za-zÀ-ÿ]{2}[.,;:\])]))\^(\d{1,3}(?:\s*[,–-]\s*\d{1,3})*)(?![0-9A-Za-z]|\s*[,–-]\s*(?:\d{1,3}[a-z]|[a-z]\b))",
    pattern_type=PatternType.IN_TEXT,
    description="CSE superscript: ^1 | ^2",
)

# Bracketed numbers: [1], [2]
_CSE_BRACKETED = CompiledPattern.create(
    name="cse_bracketed",
    pattern=r"\[(\d+)\]",
    pattern_type=PatternType.IN_TEXT,
    description="CSE bracketed: [1] | [2]",
)

# Parenthesized numbers: (1), (2)
_CSE_PARENTHESIZED = CompiledPattern.create(
    name="cse_parenthesized",
    pattern=r"\((\d+)\)",
    pattern_type=PatternType.IN_TEXT,
    description="CSE parenthesized: (1) | (2)",
)

# --- In-text CSE patterns (Name-Year) ---

# Parenthetical with comma: (Author, 2020), (Author et al., 2020)
_CSE_NAMEYEAR_PARENTHETICAL = CompiledPattern.create(
    name="cse_nameyear_parenthetical",
    pattern=r"\(([^)]+),\s*(\d{4}[a-z]?)\)",
    pattern_type=PatternType.IN_TEXT,
    description="CSE Name-Year parenthetical: (Author, 2020)",
)

# Parenthetical without comma: (Author 2020)
_CSE_NAMEYEAR_PARENTHETICAL_NOCOMMA = CompiledPattern.create(
    name="cse_nameyear_parenthetical_nocomma",
    pattern=(
        r"\((?!(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|"
        r"Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?|"
        r"Spring|Summer|Fall|Autumn|Winter|In|From|Since|Until|Before|After|During|"
        r"Between|Around|Circa|See|Table|Figure|Fig|Section|Chapter|Part|Page|Vol|No)\b)"
        r"([A-ZÀ-Ý][a-zà-ÿ'\u2019-]+(?:[A-ZÀ-Ý][a-zà-ÿ'\u2019-]+)*(?:\s+(?:and|&|và)\s+[A-ZÀ-Ý][a-zà-ÿ'\u2019-]+(?:[A-ZÀ-Ý][a-zà-ÿ'\u2019-]+)*|\s+et\s+al\.?)?)\s+"
        r"((?:19|20)\d{2}[a-z]?)\)"
    ),
    pattern_type=PatternType.IN_TEXT,
    description="CSE Name-Year: (Author 2020)",
)

# --- Reference list CSE patterns (Citation-Sequence) ---

# CSE numbered article:
# 1. Authors. Title. Journal. Year;Vol(Issue):Pages.
_CSE_NUMBERED_ARTICLE = CompiledPattern.create(
    name="cse_numbered_article",
    pattern=(
        r"^"
        r"(?:\d+\.?\s*)?"  # Optional number.
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
    description="CSE article: N. Authors. Title. Journal. Year;Vol(Issue):Pages.",
)

# CSE numbered with bracketed prefix:
# [1] Authors. Title. Journal. Year;Vol(Issue):Pages.
_CSE_BRACKETED_REFERENCE = CompiledPattern.create(
    name="cse_bracketed_reference",
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
    description="CSE bracketed: [N] Authors. Title. Journal. Year;Vol:Pages.",
)

# CSE with DOI:
# 1. Authors. Title. Journal. Year;Vol:Pages. doi:...
_CSE_NUMBERED_DOI = CompiledPattern.create(
    name="cse_numbered_doi",
    pattern=(
        r"^"
        r"(?:\d+\.?\s*)?"  # Optional number.
        r"(?P<authors>[^;\"“]+?)\.\s+"  # Authors.
        r"(?P<title>[^\"“]+?)\.\s+"  # Title.
        r"(?P<venue>[^;\"“]+?)\.\s*"  # Journal.
        r"(?P<year>(?:19|20)\d{2})"  # Year
        r"(?:;(?P<volume>\d+)"  # ;Volume
        r"(?:\((?P<issue>[^)]+)\))?"  # (Issue)
        r"(?::(?P<pages>[\d–-]+))?)?"  # :Pages
        r"\.?\s*doi:\s*(?P<doi>\S+?)\.?"  # . doi:...
        r"$"
    ),
    pattern_type=PatternType.REFERENCE_ENTRY,
    description="CSE with DOI: N. Authors. Title. Journal. Year. doi:...",
)

# --- Reference list CSE patterns (Name-Year) ---

# CSE Name-Year book:
# Author AB. Year. Title. Place: Publisher.
_CSE_NAMEYEAR_BOOK = CompiledPattern.create(
    name="cse_nameyear_book",
    pattern=(
        r"^(?!\d+\.\s)(?!\[\s*\d+\s*\])(?!\(\s*\d+\s*\))"
        r"(?P<authors>[^;\"“]+?)\.\s+"  # Authors.
        r"(?P<year>(?:19|20)\d{2}[a-z]?)\.\s+"  # Year.
        r"(?P<title>[^.\"“]+?)\.\s+"  # Title.
        r"(?P<place_pub>[^.:]+:\s*[^.]+)\.?"  # Required Place: Publisher
        r"(?P<rest>.*)$"
    ),
    pattern_type=PatternType.REFERENCE_ENTRY,
    description="CSE Name-Year book: Author. Year. Title. Place: Publisher.",
)

# CSE Name-Year article:
# Author AB. Year. Title. Journal. Vol (Issue):Pages.
_CSE_NAMEYEAR_ARTICLE = CompiledPattern.create(
    name="cse_nameyear_article",
    pattern=(
        r"^(?!\d+\.\s)(?!\[\s*\d+\s*\])(?!\(\s*\d+\s*\))"
        r"(?P<authors>[^;\"“]+?)\.\s+"  # Authors.
        r"(?P<year>(?:19|20)\d{2}[a-z]?)\.\s+"  # Year.
        r"(?P<title>[^.\"“]+?)\.\s+"  # Title.
        r"(?P<venue>.+)"  # Venue
        r"$"
    ),
    pattern_type=PatternType.REFERENCE_ENTRY,
    description="CSE Name-Year article: Author. Year. Title. Journal.",
)

# --- Reference list CSE patterns (Books) ---

# CSE book:
# 1. Authors. Year. Title. Place: Publisher.
_CSE_BOOK = CompiledPattern.create(
    name="cse_book",
    pattern=(
        r"^"
        r"(?:\d+\.?\s*)?"  # Optional number.
        r"(?P<authors>[^;\"“]+?)\.\s+"  # Authors.
        r"(?P<year>(?:19|20)\d{2}[a-z]?)\.\s+"  # Year.
        r"(?P<title>[^.\"“]+?)\.\s+"  # Title.
        r"(?P<place_pub>[^.:]+:\s*[^.]+)\.?"  # Required Place: Publisher
        r"(?P<rest>.*)$"
    ),
    pattern_type=PatternType.REFERENCE_ENTRY,
    description="CSE book: Authors. Year. Title. Place: Publisher.",
)

# --- Utility pattern ---

_CSE_NUMBER_MARKER = CompiledPattern.create(
    name="cse_number_marker",
    pattern=r'^\s*(?:\[\d+\]|\d+\.|\^?\d+)\s*',
    pattern_type=PatternType.UTILITY,
    description="CSE number marker: [N] | N. | ^N",
)


# =============================================================================
# CSE Format Implementation
# =============================================================================


class CSEFormat:
    """CSE citation format implementation.

    CSE style is commonly used in:
        - Scientific journals
        - Biology
        - Medicine
        - Earth sciences

    CSE offers three citation systems:
        1. Citation-Sequence (C-S): References numbered in order of appearance
        2. Citation-Name (C-N): References alphabetized, numbered
        3. Name-Year (N-Y): (Author Year) similar to APA

    This implementation handles all three systems:
        - In-text numeric citations: ^1, [1], (1)
        - In-text Name-Year citations: (Author Year)
        - Reference list entries for articles, books
    """

    @property
    def name(self) -> str:
        """Format name."""
        return "CSE"

    @property
    def priority(self) -> int:
        """Priority for format resolution (higher = try first).

        CSE is common in scientific journals.
        Priority 77 (similar to AMA, Nature).
        """
        return 77

    @property
    def in_text_patterns(self) -> list[CompiledPattern]:
        """Patterns for extracting CSE in-text citations."""
        return [
            _CSE_SUPERSCRIPT,
            _CSE_BRACKETED,
            # FIX: removed _CSE_PARENTHESIZED — matches (1), (2) in body (equations/footnotes),
            # not legitimate in-text citations. CSE in-text uses [N] or ^N. Pattern kept for
            # reference list parsing via reference_patterns.
            _CSE_NAMEYEAR_PARENTHETICAL,
            _CSE_NAMEYEAR_PARENTHETICAL_NOCOMMA,
        ]

    @property
    def reference_patterns(self) -> list[CompiledPattern]:
        """Patterns for extracting CSE reference list entries."""
        return [
            _CSE_NUMBERED_DOI,
            _CSE_BRACKETED_REFERENCE,
            _CSE_NUMBERED_ARTICLE,
            _CSE_NAMEYEAR_ARTICLE,
            _CSE_NAMEYEAR_BOOK,
            _CSE_BOOK,
        ]

    def parse_reference_entry(self, text: str) -> Citation | None:
        """Parse CSE reference entry into Citation object.

        Args:
            text: Raw reference entry text

        Returns:
            Citation object if successfully parsed, None otherwise

        Examples:
            >>> text = "1. Smith J, Jones A. Article title. J Clin Med. 2020;10(2):123-145."
            >>> citation = CSEFormat().parse_reference_entry(text)
            >>> citation.authors
            ['Smith J', 'Jones A']
            >>> citation.year
            '2020'
        """
        # Normalize whitespace
        text = re.sub(r'\s+', ' ', text.strip())

        if self._is_non_cse_structure(text):
            return None

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

        # Try article with DOI format first
        citation = self._try_parse_numbered_doi(text)
        if citation:
            if numeric_index and citation.numeric_index is None:
                citation.numeric_index = numeric_index
            return citation

        # Try bracketed reference
        citation = self._try_parse_bracketed_reference(text)
        if citation:
            return citation

        # Try numbered article format
        citation = self._try_parse_numbered_article(text)
        if citation:
            if numeric_index and citation.numeric_index is None:
                citation.numeric_index = numeric_index
            return citation

        # Try Name-Year book format BEFORE Name-Year article (book requires Place: Publisher)
        citation = self._try_parse_nameyear_book(text)
        if citation:
            if numeric_index and citation.numeric_index is None:
                citation.numeric_index = numeric_index
            return citation

        # Try Name-Year article format (year comes before title)
        citation = self._try_parse_nameyear_article(text)
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
        return self._parse_cse_fallback(text)

    @staticmethod
    def _is_non_cse_structure(text: str) -> bool:
        """Reject entries belonging to ACS, Nature, Chicago, or MLA."""
        if re.match(r'^\(\s*\d+\s*\)', text):
            return True
        if re.search(r'["\u201c][^"\u201d]{4,}["\u201d]', text):
            return True
        if re.search(r'\b\d+\s*,\s*(?:[\d–-]+|[a-zA-Z]?\d+)\s*\(\s*(?:19|20)\d{2}[a-z]?\s*\)\.?$', text):
            return True
        if re.search(r'\b(?:19|20)\d{2}\s*,\s*\d+', text):
            return True
        if re.match(r'^(?:\[\s*\d+\s*\]\s*|\d+\.\s*)?[A-ZÀ-Ý][a-zà-ÿ]+,\s+[A-ZÀ-Ý][a-zà-ÿ]{2,}', text):
            return True
        return False

    def _try_parse_numbered_doi(self, text: str) -> Citation | None:
        """Try to parse CSE numbered with DOI format."""
        match = _CSE_NUMBERED_DOI.search(text)
        if match:
            return self._parse_numbered_doi_entry(match, text)
        return None

    def _try_parse_bracketed_reference(self, text: str) -> Citation | None:
        """Try to parse CSE bracketed reference."""
        match = _CSE_BRACKETED_REFERENCE.search(text)
        if match:
            return self._parse_bracketed_entry(match, text)
        return None

    def _try_parse_numbered_article(self, text: str) -> Citation | None:
        """Try to parse CSE numbered article format."""
        match = _CSE_NUMBERED_ARTICLE.search(text)
        if match:
            return self._parse_numbered_article_entry(match, text)
        return None

    def _try_parse_nameyear_article(self, text: str) -> Citation | None:
        """Try to parse CSE Name-Year article format."""
        match = _CSE_NAMEYEAR_ARTICLE.search(text)
        if match:
            return self._parse_nameyear_article_entry(match, text)
        return None

    def _try_parse_nameyear_book(self, text: str) -> Citation | None:
        """Try to parse CSE Name-Year book format."""
        match = _CSE_NAMEYEAR_BOOK.search(text)
        if match:
            return self._parse_nameyear_book_entry(match, text)
        return None

    def _try_parse_book(self, text: str) -> Citation | None:
        """Try to parse CSE book format."""
        match = _CSE_BOOK.search(text)
        if match:
            return self._parse_book_entry(match, text)
        return None

    def _parse_numbered_doi_entry(
        self, match: re.Match, text: str
    ) -> Citation | None:
        """Parse CSE numbered with DOI entry."""
        citation = Citation(
            raw_text=text,
            citation_type=CitationType.REFERENCE_LIST,
            style=CitationStyle.CSE,
            matched_pattern="cse_numbered_doi",
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

        # Extract volume, issue, pages
        volume = match.group('volume')
        if volume:
            citation.volume = volume
            issue = match.group('issue')
            if issue:
                citation.issue = issue
            pages = match.group('pages')
            if pages:
                citation.pages = pages

        # Extract DOI
        doi = match.group('doi')
        if doi:
            citation.doi = doi.strip()
        else:
            doi_match = re.search(r'10\.\d{4,9}/[^\s\]\)\,;]+', text)
            if doi_match:
                citation.doi = doi_match.group(0).rstrip('.')

        citation.confidence = self._estimate_confidence(citation)
        return citation

    def _parse_bracketed_entry(
        self, match: re.Match, text: str
    ) -> Citation | None:
        """Parse CSE bracketed entry."""
        citation = Citation(
            raw_text=text,
            citation_type=CitationType.REFERENCE_LIST,
            style=CitationStyle.CSE,
            matched_pattern="cse_bracketed_reference",
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

        # Extract volume, issue, pages
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

        citation.confidence = self._estimate_confidence(citation)
        return citation

    def _parse_numbered_article_entry(
        self, match: re.Match, text: str
    ) -> Citation | None:
        """Parse CSE numbered article entry."""
        citation = Citation(
            raw_text=text,
            citation_type=CitationType.REFERENCE_LIST,
            style=CitationStyle.CSE,
            matched_pattern="cse_numbered_article",
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

        # Extract volume, issue, pages
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

        citation.confidence = self._estimate_confidence(citation)
        return citation

    def _parse_nameyear_article_entry(
        self, match: re.Match, text: str
    ) -> Citation | None:
        """Parse CSE Name-Year article entry."""
        citation = Citation(
            raw_text=text,
            citation_type=CitationType.REFERENCE_LIST,
            style=CitationStyle.CSE,
            matched_pattern="cse_nameyear_article",
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

        # Extract venue
        venue = match.group('venue').strip()
        self._parse_venue(citation, venue)

        # Extract DOI if present
        doi_match = re.search(r'10\.\d{4,9}/[^\s\]\)\,;]+', text)
        if doi_match:
            citation.doi = doi_match.group(0).rstrip('.')

        citation.confidence = self._estimate_confidence(citation)
        return citation

    def _parse_nameyear_book_entry(
        self, match: re.Match, text: str
    ) -> Citation | None:
        """Parse CSE Name-Year book entry."""
        citation = Citation(
            raw_text=text,
            citation_type=CitationType.REFERENCE_LIST,
            style=CitationStyle.CSE,
            matched_pattern="cse_nameyear_book",
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

    def _parse_book_entry(
        self, match: re.Match, text: str
    ) -> Citation | None:
        """Parse CSE book entry."""
        citation = Citation(
            raw_text=text,
            citation_type=CitationType.REFERENCE_LIST,
            style=CitationStyle.CSE,
            matched_pattern="cse_book",
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

    def _parse_cse_fallback(self, text: str) -> Citation | None:
        """Fallback parser: extract whatever metadata possible."""
        citation = Citation(
            raw_text=text,
            citation_type=CitationType.REFERENCE_LIST,
            style=CitationStyle.CSE,
            matched_pattern="cse_fallback",
        )

        # Extract numeric index
        idx_match = re.search(r'^\s*\[\s*(\d+)\s*\]', text)
        if idx_match:
            citation.numeric_index = int(idx_match.group(1))
        else:
            num_match = re.match(r'^\s*(?!(?:18|19|20)\d{2}\b)(\d{1,3})\.?\s', text)
            if num_match:
                citation.numeric_index = int(num_match.group(1))

        clean_body = re.sub(r'^\s*(?:\[\s*\d+\s*\]\.?|\(\s*\d{1,3}\s*\)|(?!(?:18|19|20)\d{2}\b)\d{1,3}\s*[\.\)])\s*', '', text).strip()
        if re.match(r'^(?:https?://|www\.)', clean_body, re.IGNORECASE):
            return None

        text_no_url = re.sub(r'https?://\S+|\bwww\.\S+', '', clean_body).strip()

        # Try to extract year (outside URL paths)
        year_m = re.search(r'\b((?:19|20)\d{2})\b', text_no_url)
        if year_m:
            citation.year = year_m.group(1)

        # Try to extract title
        parts = text_no_url.split('.')
        if len(parts) >= 2:
            for part in parts[1:]:
                part = part.strip()
                if len(part) > 10 and len(part) < 200:
                    citation.title = part
                    citation.title_normalized = self._normalize_title(part)
                    break
        if not citation.title:
            body_no_idx = re.sub(
                r'^(?:\[\s*\d+\s*\]|\(\s*\d+\s*\)|\d+\.)\s*',
                '',
                text_no_url,
            ).strip().rstrip('.')
            if len(body_no_idx) >= 5:
                citation.title = body_no_idx
                citation.title_normalized = self._normalize_title(body_no_idx)

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

        # Extract volume and issue: "Journal 10 (2): 1-15" or "Nat Med. 26(3):123-135."
        vol_match = re.search(
            r'(?P<journal>.+?)\.?\s+'
            r'(?P<vol>\d+)\s*'
            r'(?:\((?P<issue>[^)]+)\))?'
            r'(?::\s*(?P<pages>[\d–-]+))?',
            venue_text
        )
        if vol_match:
            citation.venue = vol_match.group('journal').strip().rstrip('.')
            citation.volume = vol_match.group('vol')
            if vol_match.group('issue'):
                citation.issue = vol_match.group('issue')
            if vol_match.group('pages'):
                citation.pages = vol_match.group('pages')
        else:
            citation.venue = venue_text

        # Clean up venue
        if citation.venue:
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
        """Check if text is a valid CSE citation.

        Args:
            text: Text to validate

        Returns:
            True if text matches CSE citation pattern, False otherwise
        """
        # Check for superscript pattern
        if re.match(r'^\^?\s*\d+', text.strip()):
            return True

        # Check for bracketed number pattern
        if re.match(r'^\[\s*\d+\s*\]', text.strip()):
            return True

        # Check for CSE reference pattern: N. Authors. Title. Journal.
        if re.match(r'^\d+\.?\s+[A-Z]', text):
            return True

        # Check for Name-Year pattern
        if re.search(r'\(\s*[A-Z][a-z]+.*\s+\d{4}', text):
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

# Register CSE format when this module is imported
register_format(CSEFormat())


# =============================================================================
# Module-level pattern lists for convenience
# =============================================================================

CSE_IN_TEXT_PATTERNS = [
    _CSE_SUPERSCRIPT,
    _CSE_BRACKETED,
    _CSE_PARENTHESIZED,
    _CSE_NAMEYEAR_PARENTHETICAL,
    _CSE_NAMEYEAR_PARENTHETICAL_NOCOMMA,
]

CSE_REFERENCE_PATTERNS = [
    _CSE_NUMBERED_DOI,
    _CSE_BRACKETED_REFERENCE,
    _CSE_NUMBERED_ARTICLE,
    _CSE_NAMEYEAR_ARTICLE,
    _CSE_NAMEYEAR_BOOK,
    _CSE_BOOK,
]
