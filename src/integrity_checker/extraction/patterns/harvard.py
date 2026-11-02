"""Harvard citation format patterns and parser.

This module provides Harvard citation format implementation for the
modular citation pattern system.

Harvard Style Citations:
    In-text:
        - (Author 2020) or (Author, 2020)
        - (Author 2020, p. 25) or (Author, 2020, p. 25)
        - (Author1 and Author2 2020)
        - (Author et al. 2020)
        - Some variants: (Author, op. cit., 2020)

    Reference list:
        - Books: Author, A.A. and Author, B.B., Year. Title. Place: Publisher.
        - Articles: Author, A.A. and Author, B.B., Year. Title. Journal, Volume(Issue), Pages.
        - Chapters: Author, A.A., Year. Chapter title. In: Editor, A.A. (ed.) Title. Place: Publisher, Pages.

Key characteristics:
    - Similar to APA but may omit comma after author
    - Uses 'and' instead of '&' in references
    - Year comes after author(s)

Reference:
    https://www.citethisforme.com/harvard-referencing
    https://www.library.manchester.ac.uk/using-the-library/staff/library-teaching/support-for-departments/academic-essentials/referencing/harvard/
"""

from __future__ import annotations

import re
from typing import Optional

from integrity_checker.extraction.patterns.base import CompiledPattern, PatternType
from integrity_checker.extraction.patterns.registry import register_format
from integrity_checker.matching.author_parser import parse_authors
from integrity_checker.models.citation import Citation, CitationStyle, CitationType

# =============================================================================
# Harvard Pattern Definitions
# =============================================================================

# --- In-text Harvard patterns ---

# Parenthetical with comma: (Author, 2020), (Author et al., 2020), (Author, 2020: 25)
_HARVARD_PARENTHETICAL_COMMA = CompiledPattern.create(
    name="harvard_parenthetical_comma",
    pattern=r"\(([^)]+),\s*(\d{4}[a-z]?)(?:\s*[:,]\s*(?:pp?\.?\s*)?(\d+(?:[-–]\d+)?|[ivxlcdm]+|n\.?\s*p\.?)(?:\s*[;,]\s*[^)]*)?)?\)",
    pattern_type=PatternType.IN_TEXT,
    description="Harvard parenthetical with comma: (Author, 2020) | (Author, 2020, p. 25)",
)

# Parenthetical without comma: (Author 2020), (Author et al. 2020), (Author 2020: 25)
_HARVARD_PARENTHETICAL = CompiledPattern.create(
    name="harvard_parenthetical",
    pattern=(
        r"\((?!(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|"
        r"Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?|"
        r"Spring|Summer|Fall|Autumn|Winter|In|From|Since|Until|Before|After|During|"
        r"Between|Around|Circa|See|Table|Figure|Fig|Section|Chapter|Part|Page|Vol|No)\b)"
        r"([A-ZÀ-Ý][a-zà-ÿ'\u2019-]+(?:[A-ZÀ-Ý][a-zà-ÿ'\u2019-]+)*(?:\s+(?:and|&|và)\s+[A-ZÀ-Ý][a-zà-ÿ'\u2019-]+(?:[A-ZÀ-Ý][a-zà-ÿ'\u2019-]+)*|\s+et\s+al\.?)?)\s+"
        r"((?:18|19|20)\d{2}[a-z]?)(?:\s*[:,]\s*(?:pp?\.?\s*)?(\d+(?:[-–]\d+)?|[ivxlcdm]+|n\.?\s*p\.?)(?:\s*[;,]\s*[^)]*)?)?\)"
    ),
    pattern_type=PatternType.IN_TEXT,
    description="Harvard parenthetical: (Author 2020) | (Author 2020, p. 25)",
)

# Narrative: Author (2020) or Author (2020, p. 25) or Author (2020: 25)
_HARVARD_NARRATIVE = CompiledPattern.create(
    name="harvard_narrative",
    pattern=r"([A-Z][a-zA-ZÀ-žÀ-ž]+(?:\s+(?:and|&)\s+[A-Z][a-zA-ZÀ-žÀ-ž]+)?(?:\s+et\s+al\.?)?)\s+\((\d{4}[a-z]?)(?:\s*[:,]\s*(?:pp?\.?\s*)?(\d+(?:[-–]\d+)?|[ivxlcdm]+|n\.?\s*p\.?)(?:\s*[;,]\s*[^)]*)?)?\)",
    pattern_type=PatternType.IN_TEXT,
    description="Harvard narrative: Author (2020) | Author (2020, p. 25)",
)

# --- Reference list Harvard patterns ---

# Harvard article with single/double quoted title (UK/AU Harvard standard):
# Smith, J. A. and Doe, B. (2020) 'Deep learning in medicine', Nature Medicine, 26(3), pp. 123-135.
# or Smith, J., 2020. 'Deep learning in medicine', Nature Medicine, 26(3), pp. 123-135.
# or Acker, A 2015, 'How cells paved the way...', Information & Culture...
_HARVARD_ARTICLE_QUOTED = CompiledPattern.create(
    name="harvard_article_quoted",
    pattern=(
        r"^(?:\[\s*(?P<index>\d+)\s*\]\s*)?"
        r"(?P<authors>.+?)(?:\s+\(\s*(?P<year>(?:18|19|20)\d{2}[a-z]?)\s*\)\.?\s*|(?:,\s*|\s+)(?P<year2>(?:18|19|20)\d{2}[a-z]?)[.,:]?\s*)"
        r"['\u2018\u2019\"\u201c](?P<title>.+?)['\u2018\u2019\"\u201d][.,]?\s+"
        r"(?P<venue>.+)$"
    ),
    pattern_type=PatternType.REFERENCE_ENTRY,
    description="Harvard quoted article: Author (Year) 'Title', Journal, Vol(Issue), pp. X-Y.",
)

# Harvard book:
# Author, A.A. and Author, B.B. (Year) Title. [2nd edn.] Place: Publisher.
# or Author, A.A., Year. Title. Place: Publisher.
_HARVARD_BOOK = CompiledPattern.create(
    name="harvard_book",
    pattern=(
        r"^"
        r"(?P<authors>.+?)(?:\s+\(\s*(?P<year>(?:18|19|20)\d{2}[a-z]?)\s*\)\.?\s+|(?:,\s*|\s+)(?P<year2>(?:18|19|20)\d{2}[a-z]?)[.,:]?\s+)"
        r"(?P<title>[^.]+?)[.,]\s+"
        r"(?:(?:\d+(?:st|nd|rd|th)\s+edn?\.?|[A-Za-z]+\s+edn?\.?)\s+)?"
        r"(?P<place_pub>[^.:]+:\s*[^.]+)\.?$"
    ),
    pattern_type=PatternType.REFERENCE_ENTRY,
    description="Harvard book: Author (Year) Title. Place: Publisher.",
)

# Harvard article:
# Author, A.A. and Author, B.B. (Year) Title. Journal, Volume(Issue), Pages.
# or Author, A.A., Year. Title. Journal, Volume(Issue), Pages.
_HARVARD_ARTICLE = CompiledPattern.create(
    name="harvard_article",
    pattern=(
        r"^"
        r"(?P<authors>.+?)(?:\s+\(\s*(?P<year>(?:18|19|20)\d{2}[a-z]?)\s*\)\.?\s+|(?:,\s*|\s+)(?P<year2>(?:18|19|20)\d{2}[a-z]?)[.,:]?\s+)"
        r"(?P<title>[^.]+?)[.,]\s+"
        r"(?P<venue>.+)$"
    ),
    pattern_type=PatternType.REFERENCE_ENTRY,
    description="Harvard article: Author (Year) Title. Journal, Vol(Issue), Pages.",
)

# Harvard with numbered prefix: [1] Author (Year) Title. Place: Publisher.
_HARVARD_NUMBERED = CompiledPattern.create(
    name="harvard_numbered",
    pattern=(
        r"^\[\s*(?P<index>\d+)\s*\]\s*"  # [N]
        r"(?P<authors>.+?)\s+\("  # Authors (
        r"(?P<year>\d{4})"  # Year
        r"\)\.?\s*"  # ).
        r"(?P<title>[^.]+?)\.?\s*"  # Title
        r"(?P<rest>(?:.+$)?)"  # Rest (optional)
        r"$"
    ),
    pattern_type=PatternType.REFERENCE_ENTRY,
    description="Harvard numbered: [1] Author (Year) Title.",
)

# Harvard book chapter:
# Author, A.A. (Year) Chapter title. In: Editor, A.A. (ed.) Book title, pp. XX-XX.
_HARVARD_BOOK_CHAPTER = CompiledPattern.create(
    name="harvard_book_chapter",
    pattern=(
        r"^"
        r"(?P<authors>.+?)(?:\s+\(\s*(?P<year>(?:18|19|20)\d{2}[a-z]?)\s*\)\.?\s+|(?:,\s*|\s+)(?P<year2>(?:18|19|20)\d{2}[a-z]?)[.,:]?\s+)"
        r"['\u2018\u2019\"\u201c]?(?P<chapter_title>[^.'\u2019\"\u201d]+?)['\u2018\u2019\"\u201d]?[.,]?\s+"
        r"[Ii]n:?\s+"
        r"(?P<editor>.+?)"
        r"(?:\s*\(eds?\.?\)|\(ed\.?\)),?\s*"
        r"(?P<book_title>[^,]+?)"
        r"(?:,\s*pp?\.\s*(?P<pages>[\d–-]+))?"
        r"(?:\.\s*(?P<rest>.*))?"
        r"$"
    ),
    pattern_type=PatternType.REFERENCE_ENTRY,
    description="Harvard book chapter: Author (Year) Chapter. In: Editor (ed.) Book.",
)

# --- Utility pattern ---

_HARVARD_BRACKET_RE = CompiledPattern.create(
    name="harvard_bracket_marker",
    pattern=r'^\s*\[\d+\]\s*',
    pattern_type=PatternType.UTILITY,
    description="Harvard reference list marker: [N]",
)


# =============================================================================
# Harvard Format Implementation
# =============================================================================


class HarvardFormat:
    """Harvard citation format implementation.

    Harvard style is commonly used in:
        - UK universities
        - Social sciences
        - Business and management
        - Many international academic contexts

    Key characteristics:
        - Year comes after author(s) in parentheses
        - In-text: (Author 2020) or (Author, 2020)
        - Reference: Author, A.A. (Year) Title. Venue.

    This implementation handles:
        - In-text parenthetical citations: (Author 2020), (Author, 2020)
        - In-text narrative citations: Author (2020)
        - Reference list entries for books, articles, book chapters
    """

    @property
    def name(self) -> str:
        """Format name."""
        return "Harvard"

    @property
    def priority(self) -> int:
        """Priority for format resolution (higher = try first).

        Harvard is common in UK and social sciences.
        Priority 85 (similar to APA, after IEEE).
        """
        return 85

    @property
    def in_text_patterns(self) -> list[CompiledPattern]:
        """Patterns for extracting Harvard in-text citations."""
        return [
            _HARVARD_PARENTHETICAL_COMMA,
            _HARVARD_PARENTHETICAL,
            _HARVARD_NARRATIVE,
        ]

    @property
    def reference_patterns(self) -> list[CompiledPattern]:
        """Patterns for extracting Harvard reference list entries."""
        return [
            _HARVARD_ARTICLE_QUOTED,
            _HARVARD_BOOK_CHAPTER,
            _HARVARD_BOOK,
            _HARVARD_ARTICLE,
            _HARVARD_NUMBERED,
        ]

    def parse_reference_entry(self, text: str) -> Citation | None:
        """Parse Harvard reference entry into Citation object.

        Args:
            text: Raw reference entry text

        Returns:
            Citation object if successfully parsed, None otherwise

        Examples:
            >>> text = "Smith, J. and Jones, A. (2020) Article title. Journal, 10(2), pp. 1-15."
            >>> citation = HarvardFormat().parse_reference_entry(text)
            >>> citation.authors
            ['Smith, J.', 'Jones, A.']
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

        # Try quoted article format first (UK Harvard: Author (Year) 'Title', Journal...)
        citation = self._try_parse_article_quoted(text)
        if citation:
            if numeric_index and citation.numeric_index is None:
                citation.numeric_index = numeric_index
            return citation

        # Try book chapter format (has "In:" marker)
        citation = self._try_parse_book_chapter(text)
        if citation:
            if numeric_index and citation.numeric_index is None:
                citation.numeric_index = numeric_index
            return citation

        # Try book format (has Place: Publisher)
        citation = self._try_parse_book(text)
        if citation:
            if numeric_index and citation.numeric_index is None:
                citation.numeric_index = numeric_index
            return citation

        # Try unquoted article format
        citation = self._try_parse_article(text)
        if citation:
            if numeric_index and citation.numeric_index is None:
                citation.numeric_index = numeric_index
            return citation

        # Try numbered format
        citation = self._try_parse_numbered(text)
        if citation:
            return citation

        # Fallback
        return self._parse_harvard_fallback(text)

    def _try_parse_article_quoted(self, text: str) -> Citation | None:
        """Try to parse Harvard quoted article format."""
        match = _HARVARD_ARTICLE_QUOTED.search(text)
        if match:
            citation = self._parse_article_entry(match, text)
            if citation:
                citation.matched_pattern = "harvard_article_quoted"
                idx = match.groupdict().get("index")
                if idx and citation.numeric_index is None:
                    citation.numeric_index = int(idx)
            return citation
        return None

    def _try_parse_article(self, text: str) -> Citation | None:
        """Try to parse Harvard article format."""
        match = _HARVARD_ARTICLE.search(text)
        if match:
            return self._parse_article_entry(match, text)
        return None

    def _try_parse_book(self, text: str) -> Citation | None:
        """Try to parse Harvard book format."""
        match = _HARVARD_BOOK.search(text)
        if match:
            return self._parse_book_entry(match, text)
        return None

    def _try_parse_book_chapter(self, text: str) -> Citation | None:
        """Try to parse Harvard book chapter format."""
        match = _HARVARD_BOOK_CHAPTER.search(text)
        if match:
            return self._parse_book_chapter_entry(match, text)
        return None

    def _try_parse_numbered(self, text: str) -> Citation | None:
        """Try to parse Harvard numbered format."""
        match = _HARVARD_NUMBERED.search(text)
        if match:
            return self._parse_numbered_entry(match, text)
        return None

    @staticmethod
    def _is_invalid_year2_match(authors_str: str, title_str: str) -> bool:
        """Reject 'Author, Year.' matches when authors_str crossed a sentence boundary or belongs to Chicago AD / MLA."""
        auth_s = (authors_str or "").strip()
        if not auth_s:
            return True
        # Reject if authors_str contains quotes or MLA/book markers ("Title." Handbook of AI, edited by...)
        if re.search(
            r'["\u201c\u201d\u2018\u2019]|\bedited\s+by\b|\btranslated\s+by\b|\bvol\.\b|\bpp?\.\b',
            auth_s,
            re.IGNORECASE,
        ):
            return True
        # Reject if authors_str has a full given name (e.g. "Smith, John A. 2020." or "... and Jane Doe. 2020.")
        # which is Chicago Author-Date, not Harvard ("Smith, J. A., 2020." or "Smith, JA 2020")
        if re.search(r"(?:,\s+|\band\s+)[A-ZÀ-Ý][a-zà-ÿ]{2,}\b", auth_s):
            return True
        if auth_s.endswith(".") and "," not in auth_s:
            return True
        if re.search(
            r"(?<!\b[A-ZÀ-Ý])(?<!\bet\sal)(?<!\bJr)(?<!\bSr)\.\s+[A-ZÀ-Ý0-9][a-zA-ZÀ-ÿ0-9]{1,}",
            auth_s,
        ):
            return True
        if re.match(r"^(?:URL\s+|https?://|doi:|arXiv:)", (title_str or "").strip(), re.IGNORECASE):
            return True
        return False

    def _parse_article_entry(
        self, match: re.Match, text: str
    ) -> Citation | None:
        """Parse Harvard article entry."""
        if match.groupdict().get("year2") and self._is_invalid_year2_match(
            match.group("authors"), match.group("title")
        ):
            return None
        citation = Citation(
            raw_text=text,
            citation_type=CitationType.REFERENCE_LIST,
            style=CitationStyle.HARVARD,
            matched_pattern="harvard_article",
        )

        # Extract authors
        authors_str = match.group('authors')
        if authors_str:
            citation.authors = self._parse_authors(authors_str)

        # Extract year
        year_str = match.group('year') or match.groupdict().get('year2')
        if year_str:
            citation.year = year_str[:4]
            if len(year_str) > 4:
                citation.year_suffix = year_str[4:]

        # Extract title
        title = match.group('title').strip().strip("'\"\u2018\u2019\u201c\u201d").rstrip('.')
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

    def _parse_book_entry(
        self, match: re.Match, text: str
    ) -> Citation | None:
        """Parse Harvard book entry."""
        if match.groupdict().get("year2") and self._is_invalid_year2_match(
            match.group("authors"), match.group("title")
        ):
            return None
        citation = Citation(
            raw_text=text,
            citation_type=CitationType.REFERENCE_LIST,
            style=CitationStyle.HARVARD,
            matched_pattern="harvard_book",
        )

        # Extract authors
        authors_str = match.group('authors')
        if authors_str:
            citation.authors = self._parse_authors(authors_str)

        # Extract year
        year_str = match.group('year') or match.groupdict().get('year2')
        if year_str:
            citation.year = year_str[:4]
            if len(year_str) > 4:
                citation.year_suffix = year_str[4:]

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

    def _parse_book_chapter_entry(
        self, match: re.Match, text: str
    ) -> Citation | None:
        """Parse Harvard book chapter entry."""
        if match.groupdict().get("year2") and self._is_invalid_year2_match(
            match.group("authors"), match.group("chapter_title")
        ):
            return None
        citation = Citation(
            raw_text=text,
            citation_type=CitationType.REFERENCE_LIST,
            style=CitationStyle.HARVARD,
            matched_pattern="harvard_book_chapter",
        )

        # Extract authors
        authors_str = match.group('authors')
        if authors_str:
            citation.authors = self._parse_authors(authors_str)

        # Extract year
        year_str = match.group('year') or match.groupdict().get('year2')
        if year_str:
            citation.year = year_str[:4]
            if len(year_str) > 4:
                citation.year_suffix = year_str[4:]

        # Extract chapter title
        chapter_title = match.group('chapter_title').strip()
        citation.title = chapter_title
        citation.title_normalized = self._normalize_title(chapter_title)

        # Extract book title (as venue)
        book_title = match.group('book_title').strip()
        editor = match.group('editor')
        pages = match.group('pages')

        citation.venue = book_title
        if editor:
            citation.venue = f"{book_title}, edited by {editor.strip()}"
        if pages:
            citation.pages = pages

        # Extract DOI if present
        doi_match = re.search(r'10\.\d{4,9}/[^\s\]\)\,;]+', text)
        if doi_match:
            citation.doi = doi_match.group(0).rstrip('.')

        citation.confidence = self._estimate_confidence(citation)
        return citation

    def _parse_numbered_entry(
        self, match: re.Match, text: str
    ) -> Citation | None:
        """Parse Harvard numbered entry."""
        citation = Citation(
            raw_text=text,
            citation_type=CitationType.REFERENCE_LIST,
            style=CitationStyle.HARVARD,
            matched_pattern="harvard_numbered",
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

    def _parse_harvard_fallback(self, text: str) -> Citation | None:
        """Fallback parser: extract whatever metadata possible."""
        citation = Citation(
            raw_text=text,
            citation_type=CitationType.REFERENCE_LIST,
            style=CitationStyle.HARVARD,
            matched_pattern="harvard_fallback",
        )

        # Extract numeric index ([N] or N.)
        idx_match = re.match(r'^\s*(?:\[\s*(\d+)\s*\]|(\d+)\.)', text)
        if idx_match:
            citation.numeric_index = int(idx_match.group(1) or idx_match.group(2))

        # Try to extract year (often in parentheses)
        year_m = re.search(r'\(((?:19|20)\d{2}[a-z]?)\)', text)
        if year_m:
            after_year_raw = text[year_m.end():].strip()
            # Reject if (Year) is at the end of a Chicago/Vancouver journal citation like "(2022): 19-27."
            if after_year_raw.startswith(":") or len(after_year_raw.rstrip(".")) < 12:
                return None
            citation.year = year_m.group(1)[:4]
            if len(year_m.group(1)) > 4:
                citation.year_suffix = year_m.group(1)[4:]

            before_year = re.sub(r'^\s*(?:\[\s*\d+\s*\]|\d+\.)\s*', '', text[:year_m.start()]).strip().rstrip('.,')
            if before_year and len(before_year) < 180 and '"' not in before_year and '\u201c' not in before_year:
                citation.authors = self._parse_authors(before_year)

        # Try to extract title
        # In Harvard, title often follows (Year)
        if year_m:
            after_year = text[year_m.end():]
            title_match = re.search(r'\.?\s*(.+?)\.', after_year)
            if title_match:
                title = title_match.group(1).strip()
                if len(title) > 5:
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

        # Extract volume and issue: "Journal, 10(2), pp. 1-15"
        vol_match = re.search(
            r'(?P<journal>.+?),?\s+'
            r'(?P<vol>\d+)\s*'
            r'(?:\((?P<issue>\d+)\))?'
            r'(?:,\s*(?:pp?\.\s*)?(?P<pages>[\d–-]+))?',
            venue_text
        )
        if vol_match:
            citation.venue = vol_match.group('journal').strip()
            if vol_match.group('vol'):
                citation.volume = vol_match.group('vol')
            if vol_match.group('issue'):
                citation.issue = vol_match.group('issue')
            if vol_match.group('pages'):
                citation.pages = vol_match.group('pages')
        else:
            # No volume - just journal name
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
        """Check if text is a valid Harvard citation.

        Args:
            text: Text to validate

        Returns:
            True if text matches Harvard citation pattern, False otherwise
        """
        # Check for (Year) pattern in references
        if re.search(r'\(\s*\d{4}\s*\)', text):
            return True

        # Check for in-text parenthetical: (Author Year) or (Author, Year)
        if re.search(r'\(\s*[A-Z][a-z]+.*\s+\d{4}', text):
            return True

        return False


# =============================================================================
# Auto-registration
# =============================================================================

# Register Harvard format when this module is imported
register_format(HarvardFormat())


# =============================================================================
# Module-level pattern lists for convenience
# =============================================================================

HARVARD_IN_TEXT_PATTERNS = [
    _HARVARD_PARENTHETICAL_COMMA,
    _HARVARD_PARENTHETICAL,
    _HARVARD_NARRATIVE,
]

HARVARD_REFERENCE_PATTERNS = [
    _HARVARD_ARTICLE,
    _HARVARD_BOOK,
    _HARVARD_NUMBERED,
    _HARVARD_BOOK_CHAPTER,
]
