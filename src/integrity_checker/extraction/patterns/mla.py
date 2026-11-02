"""MLA citation format patterns and parser.

This module provides MLA (Modern Language Association) citation format
implementation for the modular citation pattern system.

MLA Style Citations:
    In-text:
        - Parenthetical: (Author Page) or (Author)
        - Narrative: Author argues... (Page)

    Reference list:
        - Articles: Author Last, First. "Title." Journal, vol. X, no. Y, Year, pp. XX-YY.
        - Books: Author Last, First. Title. Publisher, Year.
        - Websites: Author Last, First. "Title." Website, Day Month Year, URL.

Key difference from APA:
    - In-text citations use page numbers, NOT year
    - (Author Page) instead of (Author, Year)
    - Title in reference is NOT italicized, just quoted

Reference:
    https://style.mla.org/
"""

from __future__ import annotations

import re

from integrity_checker.extraction.patterns.base import CompiledPattern, PatternType
from integrity_checker.extraction.patterns.registry import register_format
from integrity_checker.extraction.patterns.utils import extract_publication_year
from integrity_checker.matching.author_parser import parse_authors
from integrity_checker.models.citation import Citation, CitationStyle, CitationType

# =============================================================================
# MLA Pattern Definitions
# =============================================================================

# --- In-text MLA patterns ---

# Parenthetical with page: (Nguyen 25), (Nguyen 25-27), (Smith and Doe 42), (Smith et al. 105),
# (L'Engle 72-73), (O'Connor 157), (Longman III 57), (Lewis XXII), (Mulvey et al. 17, 19)
# Requires a capitalized surname (not Table/Figure/Section/etc.) and a page number/range (not a 4-digit year 19xx/20xx)
_MLA_INTEXT_PARENTHETICAL_PAGE = CompiledPattern.create(
    name="mla_intext_parenthetical_page",
    pattern=(
        r"\((?!(?:Table|Figure|Fig|Section|Chapter|Part|Page|Eq|Equation|Appendix|"
        r"Stage|Step|Phase|Round|Cycle|Iteration|Pass|Tier|Split|Cluster|Topic|Task|"
        r"Level|Grade|Group|Type|Class|Model|Case|Test|Rule|Item|Itemset|Optimization|Site|Point|Edge|Head|"
        r"Prompt|Query|Sample|User|Comment|Label|Draft|Scheme|Chart|Compound|Reaction|"
        r"Pathway|Experiment|Theorem|Lemma|Proposition|Corollary|Definition|Example|"
        r"Algorithm|Listing|Supplement|Note|Clause|Scope|VLAN|VTP|OSPF|DHCP|LLaMA|VNER|VLSP|XML|"
        r"Trang|Hình|Ảnh|Bảng|Mục|Chương|Phần|Bước|Nhóm|Loại|Câu|Bài|Đoạn|Dòng|Cột|Top|STT|MSSV|JavaScript|TypeScript|"
        r"Line|Row|Col|Column|Version|Ver|Vol|No|Issue|Series|Set|Run|Trial|Block|"
        r"Layer|Node|Fold|Epoch|Batch|Seed|Score|Rank|Rate|Ratio|Index|Value|Limit|"
        r"Code|Error|Port|Pin|LED|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec|"
        r"January|February|March|April|June|July|August|September|October|November|December)s?\b)"
        r"(?:"
        r"([A-ZÀ-Ý][a-zA-Zà-ÿ'\u2019]{2,}(?:\s+(?:III|II|IV|Jr\.?|Sr\.?))?"
        r"(?:\s+(?:and|&|và)\s+[A-ZÀ-Ý][a-zA-Zà-ÿ'\u2019]{2,}|\s+et\s+al\.)?)"
        r"(?:\s*,\s*pp?\.\s*|\s+)"
        r"(?!(?:19|20)\d{2}\b)(\d{1,4}(?:[-–]\d{1,4})?(?:,\s*\d{1,4}(?:[-–]\d{1,4})?)*|(?!(?:LM|ML|DL|CV|ID|IC|VM|VL|IL|LC|DM|LD)\b)[IVXLCDM]{1,7})"
        r"|[A-ZÀ-Ý][a-zA-Zà-ÿ'\u2019]{2,}\s+et\s+al\.(?:\s*;\s*[A-ZÀ-Ý][a-zA-Zà-ÿ'\u2019]{2,}\s+et\s+al\.)*"
        r")\)"
    ),
    pattern_type=PatternType.IN_TEXT,
    description="MLA in-text parenthetical: (Author Page) | (Author 25-27)",
)

# Parenthetical without page (kept for direct reference, not in default in_text_patterns to avoid matching (Term))
_MLA_INTEXT_PARENTHETICAL = CompiledPattern.create(
    name="mla_intext_parenthetical",
    pattern=r"\(([A-Z][a-zA-ZÀ-ž]+(?:\s+(?:and|&)\s+[A-Z][a-zA-ZÀ-ž]+)?(?:\s+et\s+al\.?))\)",
    pattern_type=PatternType.IN_TEXT,
    description="MLA in-text parenthetical: (Smith et al.) | (Smith and Jones)",
)

# Narrative with explicit p./pp.: Author (p. 25) or Author (pp. 25-27)
_MLA_INTEXT_NARRATIVE = CompiledPattern.create(
    name="mla_intext_narrative",
    pattern=r"([A-Z][a-zA-ZÀ-žÀ-ž]+(?:\s+(?:and|&)\s+[A-Z][a-zA-ZÀ-žÀ-ž]+)?(?:\s+et\s+al\.?)?)\s+\(pp?\.\s*(\d+(?:[-–]\d+)?)\)",
    pattern_type=PatternType.IN_TEXT,
    description="MLA narrative: Author (p. 25) | Author (pp. 25-27)",
)

# --- Reference list MLA patterns ---

# MLA Article:
# Author Last, First. "Title." Journal, vol. X, no. Y, Year, pp. XX-YY.
_MLA_ARTICLE = CompiledPattern.create(
    name="mla_article",
    pattern=(
        r"^"
        r"(?P<authors>[A-ZÀ-Ý].+?)\.\s+"  # Authors.
        r'["\u201c](?P<title>.+?)["\u201d]\.?\s*'  # "Title." or "Title".
        r"(?P<venue>[^(\n]*(?:vol\.|no\.|pp?\.)[^(\n]*)"  # Venue with vol./no./pp. (not Chicago (Year))
        r"$"
    ),
    pattern_type=PatternType.REFERENCE_ENTRY,
    description='MLA article: Author. "Title." Journal, vol. X, no. Y, Year, pp. XX-YY.',
)

# MLA Book:
# Author Last, First. Title. Publisher, Year.
_MLA_BOOK = CompiledPattern.create(
    name="mla_book",
    pattern=(
        r"^"
        r"(?P<authors>[A-ZÀ-Ý][^\"“\n]+?,\s+[A-ZÀ-Ý][^\"“\n]*?|[A-ZÀ-Ý][a-zA-ZÀ-ÿ'-]{2,})\.\s+"  # Author Last, First. or Mononym.
        r"(?P<title>[^\"“:\n]+?)\.\s+"  # Title (unquoted, no Place: Publisher colon)
        r"(?:(?:Translated|Edited|Compiled)\s+by\s+[^,]+,\s+)?"  # Optional translator/editor
        r"(?P<publisher_year>[^.:\n]+?,\s*(?:19|20)\d{2})\.?"  # Publisher, Year.
        r"(?:\s*(?P<rest>.*))?"
        r"$"
    ),
    pattern_type=PatternType.REFERENCE_ENTRY,
    description="MLA book: Author. Title. Publisher, Year.",
)

# MLA Book Chapter:
# Author Last, First. "Chapter Title." Title of Book, edited by Editor, Publisher, Year, pp. XX-YY.
_MLA_BOOK_CHAPTER = CompiledPattern.create(
    name="mla_book_chapter",
    pattern=(
        r"^"
        r"(?P<authors>[A-ZÀ-Ý].+?)\.\s+"  # Authors.
        r'["\u201c](?P<chapter_title>.+?)["\u201d]\.?\s*'  # "Chapter Title."
        r"(?P<book_title>[^,]+?)"  # Book Title
        r",\s+edited\s+by\s+(?P<editor>[^,]+)"  # edited by Editor
        r"(?:,\s*(?P<publisher_year>[^,]+,\s*(?:19|20)\d{2}))?"  # Publisher, Year
        r"(?:,\s*pp?\.\s*(?P<pages>[\d–-]+))?\.?"  # Optional pages
        r"(?:\s*(?P<rest>.*))?"
        r"$"
    ),
    pattern_type=PatternType.REFERENCE_ENTRY,
    description='MLA book chapter: Author. "Chapter." Book Title, edited by Editor, Publisher.',
)

# MLA Website:
# Author Last, First. "Title." Website Name, Day Month Year, URL.
_MLA_WEBSITE = CompiledPattern.create(
    name="mla_website",
    pattern=(
        r"^"
        r"(?P<authors>[A-ZÀ-Ý].+?)\.\s+"  # Authors.
        r'["\u201c](?P<title>.+?)["\u201d]\.?\s*'  # "Title."
        r"(?P<website>[^,]+?)"  # Website
        r"(?:,\s*(?P<date>[^,]*\b(?:19|20)\d{2}\b[^,]*))?"  # Optional date
        r",\s*(?P<url>https?://\S+)\.?"  # Required URL
        r"$"
    ),
    pattern_type=PatternType.REFERENCE_ENTRY,
    description='MLA website: Author. "Title." Website, Day Month Year, URL.',
)

# --- Utility pattern ---

_MLA_BRACKET_RE = CompiledPattern.create(
    name="mla_bracket_marker",
    pattern=r'^\s*\[\d+\]\s*',
    pattern_type=PatternType.UTILITY,
    description="MLA reference list marker: [N]",
)


# =============================================================================
# MLA Format Implementation
# =============================================================================


class MLAFormat:
    """MLA citation format implementation.

    MLA style is commonly used in:
        - Literature
        - Languages
        - Cultural studies
        - Humanities

    Key characteristics (differentiating from APA):
        - In-text citations use page numbers, NOT year
        - Reference list title is quoted, not italicized
        - Comma usage differs slightly

    This implementation handles:
        - In-text parenthetical citations: (Author Page)
        - In-text narrative citations: Author (Page)
        - Reference list entries for articles, books, chapters, websites
    """

    @property
    def name(self) -> str:
        """Format name."""
        return "MLA"

    @property
    def priority(self) -> int:
        """Priority for format resolution (higher = try first).

        MLA is common in humanities but less frequent in scientific papers.
        Priority 70 (same as Chicago, lower than APA/IEEE/Vancouver).
        """
        return 70

    @property
    def in_text_patterns(self) -> list[CompiledPattern]:
        """Patterns for extracting MLA in-text citations."""
        return [
            _MLA_INTEXT_PARENTHETICAL_PAGE,
            _MLA_INTEXT_NARRATIVE,
        ]

    @property
    def reference_patterns(self) -> list[CompiledPattern]:
        """Patterns for extracting MLA reference list entries."""
        return [
            _MLA_ARTICLE,
            _MLA_BOOK_CHAPTER,
            _MLA_BOOK,
            _MLA_WEBSITE,
        ]

    def parse_reference_entry(self, text: str) -> Citation | None:
        """Parse MLA reference entry into Citation object.

        Args:
            text: Raw reference entry text

        Returns:
            Citation object if successfully parsed, None otherwise

        Examples:
            >>> text = 'Smith, John. "Article Title." Journal of Example 10, no. 2, 2020, pp. 25-45.'
            >>> citation = MLAFormat().parse_reference_entry(text)
            >>> citation.authors
            ['Smith, John']
            >>> citation.title
            'Article Title'
        """
        # Normalize whitespace
        text = re.sub(r'\s+', ' ', text.strip())

        # Extract numeric index first
        numeric_index = None
        idx_match = re.search(r'\[\s*(\d+)\s*\]', text)
        if idx_match:
            numeric_index = int(idx_match.group(1))

        # Try article format first (most specific with quoted title)
        citation = self._try_parse_article(text)
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
        return self._parse_mla_fallback(text)

    def _try_parse_article(self, text: str) -> Citation | None:
        """Try to parse MLA article format."""
        match = _MLA_ARTICLE.search(text)
        if match:
            return self._parse_article_entry(match, text)
        return None

    def _try_parse_book(self, text: str) -> Citation | None:
        """Try to parse MLA book format."""
        match = _MLA_BOOK.search(text)
        if match:
            return self._parse_book_entry(match, text)
        return None

    def _try_parse_book_chapter(self, text: str) -> Citation | None:
        """Try to parse MLA book chapter format."""
        match = _MLA_BOOK_CHAPTER.search(text)
        if match:
            return self._parse_book_chapter_entry(match, text)
        return None

    def _try_parse_website(self, text: str) -> Citation | None:
        """Try to parse MLA website format."""
        match = _MLA_WEBSITE.search(text)
        if match:
            return self._parse_website_entry(match, text)
        return None

    def _parse_article_entry(
        self, match: re.Match, text: str
    ) -> Citation | None:
        """Parse MLA article entry."""
        citation = Citation(
            raw_text=text,
            citation_type=CitationType.REFERENCE_LIST,
            style=CitationStyle.MLA,
            matched_pattern="mla_article",
        )

        # Extract authors
        authors_str = match.group('authors')
        if authors_str:
            citation.authors = self._parse_authors(authors_str)

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

        # Extract venue (rest of text contains journal info)
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
        """Parse MLA book entry."""
        citation = Citation(
            raw_text=text,
            citation_type=CitationType.REFERENCE_LIST,
            style=CitationStyle.MLA,
            matched_pattern="mla_book",
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
        pub_year = match.group('publisher_year')
        if pub_year:
            pub_year = pub_year.strip()
            yr, yr_suf = extract_publication_year(pub_year, prefer_last=True)
            if yr:
                citation.year = yr
                if yr_suf:
                    citation.year_suffix = yr_suf
                year_m = re.search(rf'\b{re.escape(yr + (yr_suf or ""))}\b', pub_year)
                pub = pub_year[:year_m.start()].strip().rstrip(',') if year_m else pub_year
                if pub:
                    citation.venue = pub

        # Extract pages if present
        pages_m = re.search(r'pp\.\s*([\d–-]+)', text)
        if pages_m:
            citation.pages = pages_m.group(1)

        # Extract DOI if present
        doi_match = re.search(r'10\.\d{4,9}/[^\s\]\)\,;]+', text)
        if doi_match:
            citation.doi = doi_match.group(0).rstrip('.')

        citation.confidence = self._estimate_confidence(citation)
        return citation

    def _parse_book_chapter_entry(
        self, match: re.Match, text: str
    ) -> Citation | None:
        """Parse MLA book chapter entry."""
        citation = Citation(
            raw_text=text,
            citation_type=CitationType.REFERENCE_LIST,
            style=CitationStyle.MLA,
            matched_pattern="mla_book_chapter",
        )

        # Extract authors
        authors_str = match.group('authors')
        if authors_str:
            citation.authors = self._parse_authors(authors_str)

        # Extract chapter title
        chapter_title = match.group('chapter_title').strip()
        # Extract chapter title (remove quotes and trailing period)
        chapter_title = match.group('chapter_title').strip()
        # Strip ASCII and curly quotes
        for q in ['"', '"', '"', '"', '"', '"']:
            if chapter_title.startswith(q) and chapter_title.endswith(q):
                chapter_title = chapter_title[len(q):-len(q)]
                break
        # Strip trailing period if present
        chapter_title = chapter_title.rstrip('.')
        citation.title = chapter_title
        citation.title = chapter_title
        citation.title_normalized = self._normalize_title(chapter_title)

        # Extract book title (as venue)
        book_title = match.group('book_title').strip()
        citation.venue = book_title

        # Extract editor if present
        editor = match.group('editor')
        if editor:
            citation.venue = f"{book_title}, edited by {editor.strip()}"

        # Extract pages if present
        pages = match.group('pages')
        if pages:
            citation.pages = pages

        # Extract year
        pub_year = match.group('publisher_year')
        if pub_year:
            year_m = re.search(r'\b((?:19|20)\d{2})\b', pub_year)
            if year_m:
                citation.year = year_m.group(1)

        # Extract DOI if present
        doi_match = re.search(r'10\.\d{4,9}/[^\s\]\)\,;]+', text)
        if doi_match:
            citation.doi = doi_match.group(0).rstrip('.')

        citation.confidence = self._estimate_confidence(citation)
        return citation

    def _parse_website_entry(
        self, match: re.Match, text: str
    ) -> Citation | None:
        """Parse MLA website entry."""
        citation = Citation(
            raw_text=text,
            citation_type=CitationType.REFERENCE_LIST,
            style=CitationStyle.MLA,
            matched_pattern="mla_website",
        )

        # Extract authors
        authors_str = match.group('authors')
        if authors_str:
            citation.authors = self._parse_authors(authors_str)

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

        # Extract website name (as venue)
        website = match.group('website')
        if website:
            citation.venue = website.strip()

        # Extract URL
        url = match.group('url')
        if url:
            citation.url = url.strip()

        # Extract date if present
        date = match.group('date')
        if date:
            # Try to extract year from date
            year_m = re.search(r'\b((?:19|20)\d{2})\b', date)
            if year_m:
                citation.year = year_m.group(1)

        # Extract DOI if present
        doi_match = re.search(r'10\.\d{4,9}/[^\s\]\)\,;]+', text)
        if doi_match:
            citation.doi = doi_match.group(0).rstrip('.')

        citation.confidence = self._estimate_confidence(citation)
        return citation

    def _parse_mla_fallback(self, text: str) -> Citation | None:
        """Fallback parser: only match when MLA-specific cues exist."""
        if not (
            re.search(r'["\u201c][^"\u201d]+["\u201d]', text)
            and re.search(r'\b(?:vol\.|no\.|pp?\.)\s*\d+', text)
        ):
            return None

        citation = Citation(
            raw_text=text,
            citation_type=CitationType.REFERENCE_LIST,
            style=CitationStyle.MLA,
            matched_pattern="mla_fallback",
        )

        # Extract numeric index
        idx_match = re.search(r'\[\s*(\d+)\s*\]', text)
        if idx_match:
            citation.numeric_index = int(idx_match.group(1))

        # Try to extract year
        citation.year, _ = extract_publication_year(text, prefer_last=True)

        # Try to extract title (text between quotes)
        quote_m = re.search(r'["\u201c]([^"\u201d]+)["\u201d]', text)
        if quote_m:
            title = quote_m.group(1).strip().rstrip('.,')
            citation.title = title
            citation.title_normalized = self._normalize_title(title)

        # Extract DOI
        doi_m = re.search(r'10\.\d{4,9}/[^\s\]\)\,;]+', text)
        if doi_m:
            citation.doi = doi_m.group(0).rstrip('.')

        # Extract URL
        url_m = re.search(r'https?://[^\s\]\)\,;]+', text)
        if url_m:
            citation.url = url_m.group(0)

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

        # Extract vol., no., year, pp. explicitly
        vol_m = re.search(r'\bvol\.\s*(\d+)', venue_text, re.IGNORECASE)
        if vol_m:
            citation.volume = vol_m.group(1)

        issue_m = re.search(r'\bno\.\s*([\d–-]+)', venue_text, re.IGNORECASE)
        if issue_m:
            citation.issue = issue_m.group(1)

        yr, _ = extract_publication_year(venue_text, prefer_last=True)
        if yr:
            citation.year = yr

        pages_m = re.search(r'\bpp?\.\s*([\d–-]+)', venue_text, re.IGNORECASE)
        if pages_m:
            citation.pages = pages_m.group(1)

        # Extract journal name as the segment before vol./no./year/pp.
        journal_m = re.split(
            r',\s*(?:vol\.|no\.|(?:19|20)\d{2}\b|pp?\.)',
            venue_text,
            maxsplit=1,
            flags=re.IGNORECASE,
        )
        if journal_m and journal_m[0].strip():
            citation.venue = journal_m[0].strip()
        else:
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
        if citation.doi or citation.url:
            score += 0.1
        return min(round(score, 2), 1.0)

    def is_valid_citation(self, text: str) -> bool:
        """Check if text is a valid MLA citation.

        Args:
            text: Text to validate

        Returns:
            True if text matches MLA citation pattern, False otherwise
        """
        # Check for quoted title (MLA distinctive feature)
        if re.search(r'["""].+["""]', text):
            return True

        # Check for MLA in-text pattern: (Author Page)
        # This uses page numbers instead of year (key difference from APA)
        if re.search(r'\([A-Z][a-z]+.*\s+\d+\)', text):
            return True

        # Check for Author. Title. Publisher pattern
        if text.count('.') >= 2:
            return True

        return False


# =============================================================================
# Auto-registration
# =============================================================================

# Register MLA format when this module is imported
register_format(MLAFormat())


# =============================================================================
# Module-level pattern lists for convenience
# =============================================================================

MLA_IN_TEXT_PATTERNS = [
    _MLA_INTEXT_PARENTHETICAL_PAGE,
    _MLA_INTEXT_NARRATIVE,
]

MLA_REFERENCE_PATTERNS = [
    _MLA_ARTICLE,
    _MLA_BOOK_CHAPTER,
    _MLA_BOOK,
    _MLA_WEBSITE,
]
