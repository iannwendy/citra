"""Vancouver citation format patterns and parser.

This module provides Vancouver citation format implementation for the modular
citation pattern system.

Vancouver Style Citations:
    In-text:
        - Numeric: [1], [1,2], [1-5]
        - Can also use APA-style: (Author, 2020), Author (2020)

    Reference list:
        - Numbered list (1., 2., 3.)
        - Format: Authors. Title. Source. YEAR;Volume(Issue):Pages.
        - Year-first variant (NLM style): Authors. YEAR. Title. Source. Volume:Pages.

Common in:
    - Medical/health sciences
    - Biomedical journals
    - Many clinical journals follow Vancouver style

Reference:
    https://www.nlm.nih.gov/bsd/uniform_requirements.html
    https://www.ncbi.nlm.nih.gov/books/NBK7272/
"""

from __future__ import annotations

import re

from integrity_checker.extraction.patterns.base import CompiledPattern, PatternType
from integrity_checker.extraction.patterns.registry import register_format
from integrity_checker.extraction.patterns.utils import extract_publication_year
from integrity_checker.matching.author_parser import parse_authors
from integrity_checker.models.citation import Citation, CitationStyle, CitationType

# =============================================================================
# Vancouver Pattern Definitions
# =============================================================================

# --- In-text Vancouver patterns ---

# Numeric in-text: [1], [1,2], [1-5]
_VANCOUVER_NUMERIC = CompiledPattern.create(
    name="vancouver_numeric",
    pattern=r"\[(\d+(?:[,\s\-]+\d+)*)\]",
    pattern_type=PatternType.IN_TEXT,
    description="Vancouver numeric in-text: [1] | [1,2] | [1-5]",
)

# Parenthetical: (Author, 2020)
_VANCOUVER_PARENTHETICAL = CompiledPattern.create(
    name="vancouver_parenthetical",
    pattern=r"\(([^)]+),\s*(\d{4}[a-z]?)\)",
    pattern_type=PatternType.IN_TEXT,
    description="Vancouver parenthetical: (Author, 2020) | (Author et al., 2020)",
)

# Narrative: Author (2020) - supports "et al."
_VANCOUVER_NARRATIVE = CompiledPattern.create(
    name="vancouver_narrative",
    pattern=r"([A-Z][a-zA-ZÀ-žÀ-ž]+(?:\s+et\s+al\.?)?(?:[\s,][A-Z][a-zA-ZÀ-žÀ-ž]*)*)\s+\((\d{4}[a-z]?)\)",
    pattern_type=PatternType.IN_TEXT,
    description="Vancouver narrative: Author (2020) | Author et al. (2020)",
)

# --- Reference list Vancouver patterns ---

# Standard Vancouver reference entry:
# Format: Authors. Title. Source. YEAR;Volume(Issue):Pages.
# Example: Smith J, Jones A. Article title. J Clin Med. 2020;10(2):123-145.
_VANCOUVER_REFERENCE_ENTRY = CompiledPattern.create(
    name="vancouver_reference_entry",
    pattern=(
        r"^(?!\d+\.\s)(?!\[\s*\d+\s*\])(?!\(\s*\d+\s*\))"
        r"(?P<authors>[^;\"“]+?)\.\s+"  # Authors (ends with period, no semicolons/quotes)
        r"(?P<title>[^\"“]+?)\.\s+"  # Title (ends with period)
        r"(?P<venue>[^;\"“]+?)\.\s*"  # Venue (ends with period)
        r"(?P<year>(?:19|20)\d{2})"  # Year (19xx/20xx)
        r"(?:;(?P<volume>\d+)"  # Volume (after semicolon)
        r"(?:\((?P<issue>[^)]+)\))?"  # Optional issue in parens
        r"(?::(?P<pages>[\d–-]+))?"  # Optional pages
        r")?"
        r"(?:\.\s*(?P<rest>(?:doi:\s*\S+|https?://\S+)?)|\.?)$"
    ),
    pattern_type=PatternType.REFERENCE_ENTRY,
    description="Vancouver reference: Authors. Title. Venue. YEAR;Vol(Issue):Pages.",
)

# Vancouver with numbered prefix: [1] Authors. Title. Venue. YEAR.
_VANCOUVER_NUMBERED_REFERENCE = CompiledPattern.create(
    name="vancouver_numbered_reference",
    pattern=(
        r"^\[\s*(?P<index>\d+)\s*\]\s*"  # [N]
        r"(?P<authors>[^;\"“]+?)\.\s+"  # Authors
        r"(?P<title>[^\"“]+?)\.\s+"  # Title
        r"(?P<venue>[^;\"“]+?)\.\s*"  # Venue
        r"(?P<year>(?:19|20)\d{2})"  # Year
        r"(?:;(?P<volume>\d+)"
        r"(?:\((?P<issue>[^)]+)\))?"
        r"(?::(?P<pages>[\d–-]+))?)?"
        r"(?:\.\s*(?P<rest>(?:doi:\s*\S+|https?://\S+)?)|\.?)$"
    ),
    pattern_type=PatternType.REFERENCE_ENTRY,
    description="Numbered Vancouver: [1] Authors. Title. Venue. YEAR.",
)

# Year-first variant (NLM / ACL style):
# Format: Authors. YEAR[a-z]?. Title[.?!] [Source. Volume:Pages.]
# Example: Smith J, Jones A. 2020. Article title. J Clin Med. 10:123-145.
_VANCOUVER_YEAR_FIRST = CompiledPattern.create(
    name="vancouver_year_first",
    pattern=(
        r"^(?!\d+\.\s)(?!\[\s*\d+\s*\])(?!\(\s*\d+\s*\))"
        r"(?P<authors>[^\"“()]+?)\.\s*"  # Authors (ends with period)
        r"(?P<year>(?:18|19|20)\d{2}[a-z]?)\.\s+"  # Year
        r"(?P<title>(?:[^.?!\"“]|\b(?:vs|dr|mr|mrs|ms|st|fig|eq|al|e\.g|i\.e|\d)\.|(?:^|[\s\-])[A-ZÀ-Ý]\.)+?)"  # Title
        r"(?:[.?!]\s+(?P<venue>.+?))?[.?!]?$"  # Optional Venue (rest)
    ),
    pattern_type=PatternType.REFERENCE_ENTRY,
    description="Vancouver year-first: Authors. YEAR. Title. Venue.",
)

# Year-first with numbered prefix: [1] Authors. YEAR. Title. Venue.
_VANCOUVER_YEAR_FIRST_NUMBERED = CompiledPattern.create(
    name="vancouver_year_first_numbered",
    pattern=(
        r"^\[\s*(?P<index>\d+)\s*\]\s*"  # [N]
        r"(?P<authors>[^\"“()]+?)\.\s*"  # Authors
        r"(?P<year>(?:18|19|20)\d{2}[a-z]?)\.\s+"  # Year
        r"(?P<title>(?:[^.?!\"“]|\b(?:vs|dr|mr|mrs|ms|st|fig|eq|al|e\.g|i\.e|\d)\.|(?:^|[\s\-])[A-ZÀ-Ý]\.)+?)"  # Title
        r"(?:[.?!]\s+(?P<venue>.+?))?[.?!]?$"  # Optional Venue
    ),
    pattern_type=PatternType.REFERENCE_ENTRY,
    description="Numbered Vancouver year-first: [1] Authors. YEAR. Title. Venue.",
)

# Vancouver with period-numbered list (1. Authors. Title. ...)
# This handles entries like: "1. Smith J, Jones A. Article title..."
_VANCOUVER_PERIOD_NUMBERED = CompiledPattern.create(
    name="vancouver_period_numbered",
    pattern=(
        r"^(?P<index>\d+)\.\s*"  # N. prefix
        r"(?P<authors>[^;\"“]+?)\.\s+"  # Authors
        r"(?P<title>[^\"“]+?)\.\s+"  # Title
        r"(?P<venue>[^;\"“]+?)\.\s*"  # Venue
        r"(?P<year>(?:19|20)\d{2})"  # Year
        r"(?:;(?P<volume>\d+)"
        r"(?:\((?P<issue>[^)]+)\))?"
        r"(?::(?P<pages>[\d–-]+))?)?"
        r"(?:\.\s*(?P<rest>(?:doi:\s*\S+|https?://\S+)?)|\.?)$"
    ),
    pattern_type=PatternType.REFERENCE_ENTRY,
    description="Period-numbered Vancouver: 1. Authors. Title. Venue. YEAR.",
)

# --- Utility pattern for detecting reference list marker [N] ---

_VANCOUVER_BRACKET_RE = CompiledPattern.create(
    name="vancouver_bracket_marker",
    pattern=r'^\s*\[\d+\]\s*',
    pattern_type=PatternType.UTILITY,
    description="Vancouver reference list marker: [N]",
)


# =============================================================================
# Vancouver Format Implementation
# =============================================================================


class VancouverFormat:
    """Vancouver citation format implementation.

    Vancouver style is commonly used in:
        - Medical/health sciences
        - Biomedical journals
        - Clinical research papers

    This implementation handles:
        - In-text numeric citations: [1], [1,2], [1-5]
        - In-text parenthetical citations: (Author, 2020)
        - In-text narrative citations: Author (2020)
        - Reference list entries with full metadata extraction
        - Standard Vancouver format: Authors. Title. Venue. YEAR;Vol:Pages.
        - Year-first variant (NLM style): Authors. YEAR. Title. Venue.
        - Numbered reference entries: [N] or N.
    """

    @property
    def name(self) -> str:
        """Format name."""
        return "Vancouver"

    @property
    def priority(self) -> int:
        """Priority for format resolution (higher = try first).

        Vancouver is common in medical/health sciences.
        Priority 80 (after APA at 100 and IEEE at 90).
        """
        return 80

    @property
    def in_text_patterns(self) -> list[CompiledPattern]:
        """Patterns for extracting Vancouver in-text citations."""
        return [
            _VANCOUVER_NUMERIC,
            _VANCOUVER_PARENTHETICAL,
            _VANCOUVER_NARRATIVE,
        ]

    @property
    def reference_patterns(self) -> list[CompiledPattern]:
        """Patterns for extracting Vancouver reference list entries."""
        return [
            _VANCOUVER_REFERENCE_ENTRY,
            _VANCOUVER_NUMBERED_REFERENCE,
            _VANCOUVER_YEAR_FIRST,
            _VANCOUVER_YEAR_FIRST_NUMBERED,
            _VANCOUVER_PERIOD_NUMBERED,
        ]

    def parse_reference_entry(self, text: str) -> Citation | None:
        """Parse Vancouver reference entry into Citation object.

        Args:
            text: Raw reference entry text

        Returns:
            Citation object if successfully parsed, None otherwise

        Examples:
            >>> text = "Smith J, Jones A. Article title. J Clin Med. 2020;10(2):123-145."
            >>> citation = VancouverFormat().parse_reference_entry(text)
            >>> citation.authors
            ['Smith J', 'Jones A']
            >>> citation.year
            '2020'
        """
        # Normalize whitespace
        text = re.sub(r'\s+', ' ', text.strip())

        if self._is_non_vancouver_structure(text):
            return None

        # Extract numeric index first
        numeric_index = None
        idx_match = re.search(r'\[\s*(\d+)\s*\]', text)
        if idx_match:
            numeric_index = int(idx_match.group(1))
        else:
            num_m = re.match(r'^(\d+)\.\s+', text)
            if num_m:
                numeric_index = int(num_m.group(1))

        # Try year-first variant first (more specific)
        citation = self._try_parse_year_first(text)
        if citation:
            if numeric_index and citation.numeric_index is None:
                citation.numeric_index = numeric_index
            return citation

        # Try period-numbered format BEFORE unnumbered standard format
        citation = self._try_parse_period_numbered(text)
        if citation:
            if numeric_index and citation.numeric_index is None:
                citation.numeric_index = numeric_index
            return citation

        # Try standard Vancouver format
        citation = self._try_parse_standard(text)
        if citation:
            if numeric_index and citation.numeric_index is None:
                citation.numeric_index = numeric_index
            return citation

        # Try plainnat / NeurIPS / ICLR / COLM / ICML unnumbered format ("Authors. Title. Venue, Year.")
        citation = self._try_parse_plainnat(text)
        if citation:
            return citation

        # Fallback: try to extract whatever we can
        return self._parse_vancouver_fallback(text)

    @staticmethod
    def _is_non_vancouver_structure(text: str) -> bool:
        """Reject entries that clearly belong to ACS, Nature, AMA book, Chicago, or MLA."""
        # ACS parenthesized number prefix: (1) ...
        if re.match(r'^\(\s*\d+\s*\)', text):
            return True
        # Quoted title right after author/year boundary (Chicago / MLA / IEEE / ACM),
        # unless the quote is only the prefix before a colon subtitle ("Quote": Subtitle.)
        if re.search(r'(?:[.,]|\b\d{4}\.)\s*["\u201c][^"\u201d]{4,}["\u201d](?!\s*:)', text):
            return True
        # Nature: (Year). or (Publisher, Year). at end of entry
        if re.search(r'\(\s*(?:[^()]{2,80},\s*)?(?:19|20)\d{2}[a-z]?\s*\)(?:,?\s*pp?\.\s*[\d–-]+)?\.?$', text):
            return True
        # ACS: Year, Volume (not preceded by comma ", Year, Pages")
        if re.search(r'(?<!,\s)\b(?:19|20)\d{2}\s*,\s*\d+', text) and not re.search(
            r'(?<!\bvol)(?<!\bno)(?<!\bpp)\.\s*(?:18|19|20)\d{2}[a-z]?\.\s+[A-ZÀ-Ý0-9]', text
        ):
            return True
        # AMA / Chicago / Harvard / CSE book with Place: Publisher; Year or Place: Publisher, Year (after Book Title.)
        if re.search(
            r'(?<!\b[A-ZÀ-Ý])\.\s+[^.]+(?<!\b[A-ZÀ-Ý])\.\s+[A-Z][A-Za-z.\s]{1,25}(?:,\s*[A-Z]{2})?:\s*[A-Z][A-Za-z\s&\'-]{2,40}(?:;\s*(?:19|20)\d{2}|,\s*(?:19|20)\d{2})\b',
            text,
        ):
            return True
        # Chicago / MLA author format: "Surname, Firstname" (full first name after comma)
        if re.match(r'^(?:\[\s*\d+\s*\]\s*|\d+\.\s*)?[A-ZÀ-Ý][a-zà-ÿ]+,\s+[A-ZÀ-Ý][a-zà-ÿ]{2,}', text):
            return True
        return False

    def _try_parse_plainnat(self, text: str) -> Citation | None:
        """Parse plainnat / NeurIPS / ICLR / COLM / ICML unnumbered reference entries."""
        s = text.strip()
        if re.match(r'^(?:\[\s*\d+\s*\]|\d+\.\s|\(\s*\d+\s*\))', s):
            return None
        if re.search(r'\(\s*(?:18|19|20)\d{2}[a-z]?\s*\)', s):
            return None

        is_inverted = bool(
            re.match(
                r'^(?:(?:van|de|der|den|von|le|la)\s+)*[A-ZÀ-Ý][a-zA-ZÀ-ÿ\'\u2019\-]+,\s+[A-ZÀ-Ý]\.',
                s,
            )
        )
        author_end_m = None
        for m in re.finditer(r'\.\s+(?=[A-ZÀ-Ý0-9"\u201c\u2018])', s):
            prefix = s[: m.start()]
            after = s[m.end() :]
            if re.search(
                r'\b(?:vol|no|pp|p|ed|eds|jr|sr|vs|dr|prof|mr|mrs|ms|st|fig|eq|sec|ch|dept|univ|proc|trans|intl|conf|symp|rev|lett|bull|ann|acad|sci|natl|soc|inst|tech|rep)$',
                prefix,
                re.I,
            ):
                continue
            if re.search(r'(?:^|[\s.\-])([A-ZÀ-Ý])$', prefix):
                if not is_inverted:
                    continue
                if re.match(
                    r'^(?:[A-ZÀ-Ý]\.|and\b|&|et\s+al\b|(?:(?:van|de|der|den|von)\s+)*[A-ZÀ-Ý][a-zA-ZÀ-ÿ\'\u2019\-]+,\s+[A-ZÀ-Ý]\.)',
                    after,
                ):
                    continue
            author_end_m = m
            break
        if not author_end_m:
            return None

        authors_str = s[: author_end_m.start()].strip()
        remainder = s[author_end_m.end() :].strip()
        if (
            not authors_str
            or len(authors_str) > 4000
            or ';' in authors_str
            or re.search(r'\b(?:18|19|20)\d{2}\b|https?://|doi:', authors_str, re.I)
        ):
            return None

        # Case 1: 2-segment short preprint / web report ("Authors. Title, [Month] YYYY[a-z]?. [URL/DOI]")
        m2 = re.match(
            r'^(?P<title>(?:[^.]|\.(?!\s+[A-Z])|\.\s+(?=[a-z][^.]*\s+\S+\s+\S+\s+\S+\s+\S+,\s*(?:18|19|20)\d{2}\b)){2,}?),\s*(?:[A-Za-z]+\.?\s+)?(?P<year>(?:18|19|20)\d{2})(?P<suffix>[a-z])?\.(?:\s*(?P<rest>(?:URL\s+)?https?://.+|doi:\s*\S+.*))?$',
            remainder,
            re.I,
        )
        if m2:
            title_str = m2.group('title').strip()
            citation = Citation(
                raw_text=s,
                citation_type=CitationType.REFERENCE_LIST,
                style=CitationStyle.VANCOUVER,
                matched_pattern='vancouver_reference_entry',
                authors=self._parse_authors(authors_str),
                title=title_str,
                title_normalized=self._normalize_title(title_str),
                year=m2.group('year'),
                year_suffix=m2.group('suffix'),
            )
            rest_str = (m2.group('rest') or '').strip()
            if rest_str:
                self._parse_venue(citation, rest_str)
            doi_m = re.search(r'10\.\d{4,9}/[^\s\]\)\,;]+', s)
            if doi_m:
                citation.doi = doi_m.group(0).rstrip('.')
            url_m = re.search(r'https?://[^\s\]\)\,;]+', s)
            if url_m:
                citation.url = url_m.group(0).rstrip('.')
            citation.confidence = self._estimate_confidence(citation)
            return citation

        # Case 2: 3-segment plainnat ("Authors. Title[.?!] Venue, YYYY[a-z]?. [URL/DOI]")
        title_end_m = None
        for tm in re.finditer(
            r'([.?!])\s+(?=[A-ZÀ-Ý0-9"\u201c\u2018]|in\s|arXiv\b|CoRR\b|abs/|http|doi:|[a-z][a-zA-Z&\s\-]{1,35},\s*(?:18|19|20)\d{2}\b)',
            remainder,
        ):
            t_pref = remainder[: tm.start()]
            if tm.group(1) == '.' and (
                re.search(r'(?:^|[\s.\-])[A-Za-zÀ-Ý]$', t_pref)
                or re.search(r'\b(?:vs|dr|mr|mrs|ms|st|fig|eq|al|etc|cf|e\.g|i\.e)$', t_pref, re.I)
            ):
                continue
            title_end_m = tm
            break
        if not title_end_m:
            return None

        title_str = remainder[
            : title_end_m.start() + (1 if title_end_m.group(1) in '?!' else 0)
        ].strip()
        venue_rest = remainder[title_end_m.end() :].strip()
        yr, yr_suf = extract_publication_year(venue_rest, prefer_last=True)
        if not yr and not re.match(r'^(?:URL\s+)?https?://\S+', venue_rest, re.I):
            return None

        citation = Citation(
            raw_text=s,
            citation_type=CitationType.REFERENCE_LIST,
            style=CitationStyle.VANCOUVER,
            matched_pattern='vancouver_reference_entry',
            authors=self._parse_authors(authors_str),
            title=title_str,
            title_normalized=self._normalize_title(title_str),
            year=yr,
            year_suffix=yr_suf,
        )
        self._parse_venue(citation, venue_rest)
        doi_m = re.search(r'10\.\d{4,9}/[^\s\]\)\,;]+', s)
        if doi_m:
            citation.doi = doi_m.group(0).rstrip('.')
        url_m = re.search(r'https?://[^\s\]\)\,;]+', s)
        if url_m:
            citation.url = url_m.group(0).rstrip('.')
        citation.confidence = self._estimate_confidence(citation)
        return citation

    def _try_parse_year_first(self, text: str) -> Citation | None:
        """Try to parse year-first Vancouver variant."""
        # Try numbered year-first first
        match = _VANCOUVER_YEAR_FIRST_NUMBERED.search(text)
        if match:
            return self._parse_year_first_entry(match, text, numbered=True)

        # Try non-numbered year-first
        match = _VANCOUVER_YEAR_FIRST.search(text)
        if match:
            return self._parse_year_first_entry(match, text, numbered=False)

        return None

    def _try_parse_standard(self, text: str) -> Citation | None:
        """Try to parse standard Vancouver format."""
        # Try numbered first
        match = _VANCOUVER_NUMBERED_REFERENCE.search(text)
        if match:
            return self._parse_standard_entry(match, text, numbered=True)

        # Try non-numbered
        match = _VANCOUVER_REFERENCE_ENTRY.search(text)
        if match:
            return self._parse_standard_entry(match, text, numbered=False)

        return None

    def _try_parse_period_numbered(self, text: str) -> Citation | None:
        """Try to parse period-numbered Vancouver format."""
        match = _VANCOUVER_PERIOD_NUMBERED.search(text)
        if match:
            return self._parse_period_numbered_entry(match, text)
        return None

    def _parse_year_first_entry(
        self, match: re.Match, text: str, numbered: bool
    ) -> Citation | None:
        """Parse year-first Vancouver entry."""
        citation = Citation(
            raw_text=text,
            citation_type=CitationType.REFERENCE_LIST,
            style=CitationStyle.VANCOUVER,
            matched_pattern="vancouver_year_first" if not numbered else "vancouver_year_first_numbered",
        )

        # Extract numeric index if numbered
        if numbered:
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
            citation.year = year_str[:4]
            if len(year_str) > 4:
                citation.year_suffix = year_str[4:]

        # Extract title
        title = match.group('title').strip()
        if re.match(r'^(?:URL\s+)?https?://', title, re.I):
            return None
        citation.title = title
        citation.title_normalized = self._normalize_title(title)

        # Extract venue
        venue = (match.group('venue') or '').strip()
        if venue:
            self._parse_venue(citation, venue)

        # Extract DOI if present
        doi_match = re.search(r'10\.\d{4,9}/[^\s\]\)\,;]+', text)
        if doi_match:
            citation.doi = doi_match.group(0).rstrip('.')
        url_match = re.search(r'https?://[^\s\]\)\,;]+', text)
        if url_match:
            citation.url = url_match.group(0).rstrip('.')

        citation.confidence = self._estimate_confidence(citation)
        return citation

    def _parse_standard_entry(
        self, match: re.Match, text: str, numbered: bool
    ) -> Citation | None:
        """Parse standard Vancouver reference entry."""
        citation = Citation(
            raw_text=text,
            citation_type=CitationType.REFERENCE_LIST,
            style=CitationStyle.VANCOUVER,
            matched_pattern="vancouver_reference_entry" if not numbered else "vancouver_numbered_reference",
        )

        # Extract numeric index if numbered
        if numbered:
            index = match.group('index')
            if index:
                citation.numeric_index = int(index)

        # Extract authors
        authors_str = match.group('authors')
        if authors_str:
            citation.authors = self._parse_authors(authors_str)

        # Extract title
        title = match.group('title').strip()
        if re.match(r'^(?:URL\s+)?https?://', title, re.I):
            return None
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

        citation.confidence = self._estimate_confidence(citation)
        return citation

    def _parse_period_numbered_entry(
        self, match: re.Match, text: str
    ) -> Citation | None:
        """Parse period-numbered Vancouver entry."""
        citation = Citation(
            raw_text=text,
            citation_type=CitationType.REFERENCE_LIST,
            style=CitationStyle.VANCOUVER,
            matched_pattern="vancouver_period_numbered",
        )

        idx = match.groupdict().get('index')
        if idx:
            citation.numeric_index = int(idx)

        # Extract authors
        authors_str = match.group('authors')
        if authors_str:
            citation.authors = self._parse_authors(authors_str)

        # Extract title
        title = match.group('title').strip()
        if re.match(r'^(?:URL\s+)?https?://', title, re.I):
            return None
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

        citation.confidence = self._estimate_confidence(citation)
        return citation

    def _parse_vancouver_fallback(self, text: str) -> Citation | None:
        """Fallback parser: extract whatever metadata possible from unstructured text."""
        citation = Citation(
            raw_text=text,
            citation_type=CitationType.REFERENCE_LIST,
            style=CitationStyle.VANCOUVER,
            matched_pattern="vancouver_fallback",
        )

        # Extract numeric index and strip it before splitting on periods
        idx_match = re.search(r'^\s*\[\s*(\d+)\s*\]', text)
        if idx_match:
            citation.numeric_index = int(idx_match.group(1))
        else:
            num_m = re.match(r'^\s*(?!(?:18|19|20)\d{2}\b)(\d{1,3})\s*[\.\)]\s*', text)
            if num_m:
                citation.numeric_index = int(num_m.group(1))

        clean_body = re.sub(r'^\s*(?:\[\s*\d+\s*\]\.?|\(\s*\d{1,3}\s*\)|(?!(?:18|19|20)\d{2}\b)\d{1,3}\s*[\.\)])\s*', '', text).strip()
        if re.match(r'^(?:https?://|www\.)', clean_body, re.IGNORECASE):
            return None

        # Extract URL if present
        url_m = re.search(r'https?://[^\s\]\)\,;]+|\bwww\.[a-zA-Z0-9.-]+\.[a-z]{2,}(?:/[^\s\]\)\,;]*)?', clean_body, re.IGNORECASE)
        if url_m:
            citation.url = url_m.group(0).rstrip('.,;)')

        # Try to extract year
        yr, yr_suf = extract_publication_year(clean_body, prefer_last=True)
        if yr:
            citation.year = yr
            citation.year_suffix = yr_suf

        # Remove URL before splitting on periods so domain dots (.com, .org) are not split as sentences
        text_no_url = re.sub(r'https?://\S+|\bwww\.\S+', '', clean_body).strip()
        parts = [p.strip() for p in text_no_url.split('.') if p.strip()]
        if len(parts) >= 2:
            # Title is usually the second segment (after authors)
            for part in parts[1:]:
                if 15 < len(part) < 220 and not re.match(r'^(?:accessed|retrieved|available|published)\b', part, re.IGNORECASE):
                    citation.title = part
                    citation.title_normalized = self._normalize_title(part)
                    break

        if parts:
            first_part = parts[0].strip()
            # If first_part is a web title ("Title - Site, accessed..."), use first_part as title
            if re.search(r'\b(?:accessed|retrieved)\b|\s+[\-|–]\s+', first_part, re.IGNORECASE):
                clean_t = re.split(r',\s*(?:accessed|retrieved)\b', first_part, maxsplit=1, flags=re.IGNORECASE)[0].strip()
                if len(clean_t) > 8:
                    citation.title = clean_t
                    citation.title_normalized = self._normalize_title(clean_t)
            elif not citation.title and re.match(r'^[A-ZÀ-Ý]{2,},\s+[A-ZÀ-Ý][a-zà-ỹ]+,\s+(?P<t>.+)$', first_part):
                m_comma = re.match(r'^(?P<a>[A-ZÀ-Ý]{2,},\s+[A-ZÀ-Ý][a-zà-ỹ]+),\s+(?P<t>.+)$', first_part)
                if m_comma:
                    citation.authors = self._parse_authors(m_comma.group('a'))
                    t_part = m_comma.group('t').split(',')[0].strip()
                    if len(t_part) > 5:
                        citation.title = t_part
                        citation.title_normalized = self._normalize_title(t_part)
            elif first_part and len(first_part) < 120:
                citation.authors = self._parse_authors(first_part)

        # Extract DOI
        doi_match = re.search(r'10\.\d{4,9}/[^\s\]\)\,;]+', text)
        if doi_match:
            citation.doi = doi_match.group(0).rstrip('.')

        citation.confidence = self._estimate_confidence(citation)
        # Only return if we have meaningful data
        return citation if citation.title or citation.year else None

    def _parse_authors(self, authors_str: str) -> list[str]:
        """Parse author string into list of authors.

        Args:
            authors_str: Author string like "Smith J, Jones A" or "Smith J and Jones A"

        Returns:
            List of author strings (via parse_authors)
        """
        return parse_authors(authors_str)

    def _parse_venue(self, citation: Citation, venue_text: str) -> None:
        """Parse venue information from remaining text.

        Handles:
        - Journal with volume and issue: "J Clin Med. 10(2):123-145"
        - Journal with pages: "J Clin Med. 10:123-145"
        - Publisher: "Publisher Name"
        """
        if not venue_text:
            return

        venue_text = venue_text.strip()

        # Extract volume:issue or volume(issue):pages
        vol_match = re.search(
            r'(?P<venue>.+?)\.\s*(?P<vol>\d+)',
            venue_text
        )
        if vol_match:
            citation.venue = vol_match.group('venue').strip()
            citation.volume = vol_match.group('vol')
            remaining = venue_text[vol_match.end():]

            # Check for (issue) or just pages
            issue_match = re.search(r'\((?P<issue>[^)]+)\)', remaining)
            if issue_match:
                citation.issue = issue_match.group('issue')

            # Extract pages
            pages_match = re.search(r':(?P<pages>[\d–-]+)', remaining)
            if pages_match:
                citation.pages = pages_match.group('pages')
        else:
            # No volume - just venue name
            # Clean up venue
            venue_clean = re.sub(r'\d{4}.*$', '', venue_text).strip()
            venue_clean = re.sub(r'10\.\d{4,9}/.*$', '', venue_clean).strip()
            citation.venue = venue_clean.rstrip('.,')

        # Extract DOI if not already done
        if not citation.doi:
            doi_match = re.search(r'10\.\d{4,9}/[^\s\]\)\,;]+', venue_text)
            if doi_match:
                citation.doi = doi_match.group(0).rstrip('.')

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
        """Check if text is a valid Vancouver citation.

        Args:
            text: Text to validate

        Returns:
            True if text matches Vancouver citation pattern, False otherwise
        """
        # Check for bracketed number pattern
        bracket_pattern = r'\[\d+(?:[,\s\-]+\d+)*\]'
        if re.match(bracket_pattern, text.strip()):
            return True

        # Check for period-numbered pattern
        if re.match(r'^\d+\.\s', text.strip()):
            return True

        # Check for year pattern: any 4-digit year in reasonable range
        if not re.search(r'\b(19|20)\d{2}\b', text):
            return False

        # Check for author name pattern (capitalized word)
        author_pattern = r'[A-Z][a-zÀ-ž]'
        if not re.search(author_pattern, text):
            return False

        # Check for Vancouver structure: Authors. Title. Venue.
        # At least two periods should be present
        if text.count('.') >= 2:
            return True

        return False

    def is_reference_list_marker(self, text: str) -> bool:
        """Check if text is a reference list marker.

        This is used for filtering out markers during citation extraction.

        Args:
            text: Text to check

        Returns:
            True if text is a reference list marker, False otherwise
        """
        # Match standalone [N] at start of text
        if re.match(r'^\s*\[\d+\]\s*$', text):
            return True

        # Match period-numbered: "1." at start
        if re.match(r'^\s*\d+\.\s*$', text):
            return True

        return False


# =============================================================================
# Auto-registration
# =============================================================================

# Register Vancouver format when this module is imported
register_format(VancouverFormat())


# =============================================================================
# Module-level pattern lists for convenience
# =============================================================================

VANCOUVER_IN_TEXT_PATTERNS = [
    _VANCOUVER_NUMERIC,
    _VANCOUVER_PARENTHETICAL,
    _VANCOUVER_NARRATIVE,
]

VANCOUVER_REFERENCE_PATTERNS = [
    _VANCOUVER_REFERENCE_ENTRY,
    _VANCOUVER_NUMBERED_REFERENCE,
    _VANCOUVER_YEAR_FIRST,
    _VANCOUVER_YEAR_FIRST_NUMBERED,
    _VANCOUVER_PERIOD_NUMBERED,
]

VANCOUVER_UTILITY_PATTERNS = [
    _VANCOUVER_BRACKET_RE,
]
