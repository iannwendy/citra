"""Tests for Vancouver citation format patterns.

Tests covering:
- Vancouver numeric in-text citations: [1], [1,2], [1-5]
- Vancouver parenthetical citations: (Author, 2020)
- Vancouver reference entry parsing
- Vancouver standard format: Authors. Title. Venue. YEAR;Vol(Issue):Pages.
- Vancouver year-first variant (NLM style): Authors. YEAR. Title. Venue.
- Period-numbered reference entries: 1. Authors. Title. ...
- Reference list marker detection
"""

from __future__ import annotations

from integrity_checker.extraction.patterns import (
    VancouverFormat,
    get_format,
    get_in_text_patterns,
    get_reference_patterns,
)
from integrity_checker.extraction.patterns.vancouver import (
    _VANCOUVER_BRACKET_RE,
    _VANCOUVER_NARRATIVE,
    _VANCOUVER_NUMERIC,
    _VANCOUVER_PARENTHETICAL,
    _VANCOUVER_PERIOD_NUMBERED,
    _VANCOUVER_REFERENCE_ENTRY,
    _VANCOUVER_YEAR_FIRST,
)
from integrity_checker.models.citation import Citation, CitationStyle, CitationType


class TestVancouverNumericInText:
    """Tests for Vancouver numeric in-text citation patterns."""

    def test_single_number(self):
        """Test single bracketed number [1]."""
        match = _VANCOUVER_NUMERIC.search("[1]")
        assert match is not None
        assert match.group(1) == "1"

    def test_multiple_numbers(self):
        """Test multiple bracketed numbers [1,2,3]."""
        match = _VANCOUVER_NUMERIC.search("[1,2,3]")
        assert match is not None
        assert match.group(1) == "1,2,3"

    def test_range_numbers(self):
        """Test range bracketed numbers [1-5]."""
        match = _VANCOUVER_NUMERIC.search("[1-5]")
        assert match is not None
        assert match.group(1) == "1-5"

    def test_mixed_numbers(self):
        """Test mixed format bracketed numbers [1, 2, 3]."""
        match = _VANCOUVER_NUMERIC.search("[1, 2, 3]")
        assert match is not None
        assert match.group(1) == "1, 2, 3"

    def test_single_in_context(self):
        """Test single number in context sentence."""
        text = "As shown in [1], deep learning has improved significantly."
        match = _VANCOUVER_NUMERIC.search(text)
        assert match is not None
        assert match.group(1) == "1"


class TestVancouverParentheticalInText:
    """Tests for Vancouver parenthetical in-text citation patterns."""

    def test_single_author(self):
        """Test single author parenthetical: (Smith, 2020)."""
        match = _VANCOUVER_PARENTHETICAL.search("(Smith, 2020)")
        assert match is not None
        assert "Smith" in match.group(1)
        assert "2020" in match.group(2)

    def test_et_al(self):
        """Test et al. parenthetical: (Smith et al., 2020)."""
        match = _VANCOUVER_PARENTHETICAL.search("(Smith et al., 2020)")
        assert match is not None
        assert "Smith" in match.group(1)

    def test_multiple_authors(self):
        """Test multiple authors parenthetical: (Smith and Jones, 2020)."""
        match = _VANCOUVER_PARENTHETICAL.search("(Smith and Jones, 2020)")
        assert match is not None


class TestVancouverNarrativeInText:
    """Tests for Vancouver narrative in-text citation patterns."""

    def test_single_author(self):
        """Test single author narrative: Smith (2020)."""
        match = _VANCOUVER_NARRATIVE.search("Smith (2020)")
        assert match is not None
        assert "Smith" in match.group(1)
        assert "2020" in match.group(2)

    def test_et_al(self):
        """Test et al. narrative: Smith et al. (2020)."""
        match = _VANCOUVER_NARRATIVE.search("Smith et al. (2020)")
        assert match is not None


class TestVancouverReferenceEntry:
    """Tests for Vancouver reference entry patterns."""

    def test_standard_vancouver_pattern(self):
        """Test standard Vancouver reference entry regex."""
        text = "Smith J, Jones A. Article title. J Clin Med. 2020;10(2):123-145."
        match = _VANCOUVER_REFERENCE_ENTRY.search(text)
        assert match is not None
        assert "Smith" in match.group("authors")
        assert match.group("year") == "2020"

    def test_vancouver_without_volume(self):
        """Test Vancouver entry without volume."""
        text = "Smith J. Article title. J Clin Med. 2020."
        match = _VANCOUVER_REFERENCE_ENTRY.search(text)
        assert match is not None
        assert match.group("year") == "2020"

    def test_year_first_pattern(self):
        """Test year-first Vancouver regex."""
        text = "Smith J, Jones A. 2020. Article title. J Clin Med. 10:123-145."
        match = _VANCOUVER_YEAR_FIRST.search(text)
        assert match is not None
        assert match.group("year") == "2020"
        assert "Article title" in match.group("title")

    def test_period_numbered_pattern(self):
        """Test period-numbered Vancouver regex."""
        text = "1. Smith J, Jones A. Article title. J Clin Med. 2020;10(2):123-145."
        match = _VANCOUVER_PERIOD_NUMBERED.search(text)
        assert match is not None
        assert "Smith" in match.group("authors")


class TestVancouverReferenceListMarker:
    """Tests for Vancouver reference list marker detection."""

    def test_bracket_marker(self):
        """Test [N] reference list marker detection."""
        match = _VANCOUVER_BRACKET_RE.search("[1]")
        assert match is not None

    def test_bracket_marker_with_space(self):
        """Test [N] marker with trailing space."""
        match = _VANCOUVER_BRACKET_RE.search("[42] ")
        assert match is not None


class TestVancouverFormatClass:
    """Tests for VancouverFormat class."""

    def test_name(self):
        """Test format name."""
        format_obj = VancouverFormat()
        assert format_obj.name == "Vancouver"

    def test_priority(self):
        """Test format priority."""
        format_obj = VancouverFormat()
        assert format_obj.priority == 80

    def test_in_text_patterns(self):
        """Test in-text patterns list."""
        format_obj = VancouverFormat()
        patterns = format_obj.in_text_patterns
        assert len(patterns) >= 3
        assert any(p.name == "vancouver_numeric" for p in patterns)
        assert any(p.name == "vancouver_parenthetical" for p in patterns)

    def test_reference_patterns(self):
        """Test reference patterns list."""
        format_obj = VancouverFormat()
        patterns = format_obj.reference_patterns
        assert len(patterns) >= 4

    def test_is_valid_citation_bracket(self):
        """Test is_valid_citation with bracketed number."""
        format_obj = VancouverFormat()
        assert format_obj.is_valid_citation("[1]") is True
        assert format_obj.is_valid_citation("[1,2]") is True
        assert format_obj.is_valid_citation("[1-5]") is True

    def test_is_valid_citation_period_numbered(self):
        """Test is_valid_citation with period-numbered entry."""
        format_obj = VancouverFormat()
        assert format_obj.is_valid_citation("1. Smith J. Title. Journal. 2020.") is True

    def test_is_valid_citation_standard_vancouver(self):
        """Test is_valid_citation with standard Vancouver format."""
        format_obj = VancouverFormat()
        text = "Smith J. Article title. J Clin Med. 2020;10(2):123-145."
        assert format_obj.is_valid_citation(text) is True

    def test_is_valid_citation_invalid(self):
        """Test is_valid_citation with invalid text."""
        format_obj = VancouverFormat()
        assert format_obj.is_valid_citation("This is not a citation") is False
        assert format_obj.is_valid_citation("") is False

    def test_is_reference_list_marker(self):
        """Test is_reference_list_marker method."""
        format_obj = VancouverFormat()
        # Standalone markers
        assert format_obj.is_reference_list_marker("[1]") is True
        assert format_obj.is_reference_list_marker("[42]") is True
        # Period-numbered markers
        assert format_obj.is_reference_list_marker("1.") is True
        assert format_obj.is_reference_list_marker("10.") is True
        # Not markers
        assert format_obj.is_reference_list_marker("Not a marker") is False


class TestVancouverParseReferenceEntry:
    """Tests for VancouverFormat.parse_reference_entry method."""

    def test_parse_standard_journal_article(self):
        """Test parsing standard Vancouver journal article."""
        format_obj = VancouverFormat()
        text = "Smith J, Jones A. Article title. J Clin Med. 2020;10(2):123-145."

        citation = format_obj.parse_reference_entry(text)
        assert citation is not None
        assert citation.style == CitationStyle.VANCOUVER
        assert citation.citation_type == CitationType.REFERENCE_LIST
        assert citation.year == "2020"
        assert citation.title == "Article title"
        assert len(citation.authors) == 2
        assert citation.volume == "10"
        assert citation.issue == "2"
        assert citation.pages == "123-145"

    def test_parse_year_first_variant(self):
        """Test parsing year-first Vancouver variant (NLM style)."""
        format_obj = VancouverFormat()
        text = "Smith J, Jones A. 2020. Article title. J Clin Med. 10:123-145."

        citation = format_obj.parse_reference_entry(text)
        assert citation is not None
        assert citation.style == CitationStyle.VANCOUVER
        assert citation.year == "2020"
        assert citation.title == "Article title"

    def test_parse_numbered_standard(self):
        """Test parsing numbered standard Vancouver entry."""
        format_obj = VancouverFormat()
        text = "[1] Smith J, Jones A. Article title. J Clin Med. 2020;10(2):123-145."

        citation = format_obj.parse_reference_entry(text)
        assert citation is not None
        assert citation.style == CitationStyle.VANCOUVER
        assert citation.numeric_index == 1
        assert citation.year == "2020"

    def test_parse_numbered_year_first(self):
        """Test parsing numbered year-first Vancouver entry."""
        format_obj = VancouverFormat()
        text = "[1] Smith J, Jones A. 2020. Article title. J Clin Med. 10:123-145."

        citation = format_obj.parse_reference_entry(text)
        assert citation is not None
        assert citation.style == CitationStyle.VANCOUVER
        assert citation.numeric_index == 1
        assert citation.year == "2020"

    def test_parse_period_numbered(self):
        """Test parsing period-numbered Vancouver entry."""
        format_obj = VancouverFormat()
        text = "1. Smith J, Jones A. Article title. J Clin Med. 2020;10(2):123-145."

        citation = format_obj.parse_reference_entry(text)
        assert citation is not None
        assert citation.style == CitationStyle.VANCOUVER
        assert citation.year == "2020"

    def test_parse_without_volume(self):
        """Test parsing entry without volume."""
        format_obj = VancouverFormat()
        text = "Smith J. Article title. J Clin Med. 2020."

        citation = format_obj.parse_reference_entry(text)
        assert citation is not None
        assert citation.style == CitationStyle.VANCOUVER
        assert citation.year == "2020"
        assert citation.title == "Article title"

    def test_parse_with_doi(self):
        """Test parsing entry with DOI."""
        format_obj = VancouverFormat()
        text = "Smith J. Article title. J Clin Med. 2020;10(2):123-145. doi: 10.1234/jcm.2020.12345"

        citation = format_obj.parse_reference_entry(text)
        assert citation is not None
        assert citation.doi is not None
        assert citation.doi.startswith("10.1234")

    def test_parse_multiple_authors(self):
        """Test parsing entry with multiple authors."""
        format_obj = VancouverFormat()
        text = "Smith J, Jones A, Brown B, Davis C. Article title. J Clin Med. 2020;10:1-10."

        citation = format_obj.parse_reference_entry(text)
        assert citation is not None
        assert len(citation.authors) == 4

    def test_parse_confidence(self):
        """Test that confidence is calculated correctly."""
        format_obj = VancouverFormat()
        text = "Smith J, Jones A. Article title. J Clin Med. 2020;10(2):123-145."

        citation = format_obj.parse_reference_entry(text)
        assert citation is not None
        assert citation.confidence > 0
        assert citation.confidence <= 1.0


class TestVancouverAuthorsParsing:
    """Tests for Vancouver author string parsing."""

    def test_single_author(self):
        """Test parsing single author."""
        format_obj = VancouverFormat()
        authors = format_obj._parse_authors("Smith J")
        assert len(authors) == 1
        assert authors[0].raw == "Smith J"

    def test_two_authors_comma(self):
        """Test parsing two authors with comma."""
        format_obj = VancouverFormat()
        authors = format_obj._parse_authors("Smith J, Jones A")
        assert len(authors) == 2
        assert authors[0].raw == "Smith J"
        assert authors[1].raw == "Jones A"

    def test_two_authors_and(self):
        """Test parsing two authors with 'and'."""
        format_obj = VancouverFormat()
        authors = format_obj._parse_authors("Smith J and Jones A")
        assert len(authors) == 2

    def test_multiple_authors(self):
        """Test parsing multiple authors."""
        format_obj = VancouverFormat()
        authors = format_obj._parse_authors("Smith J, Jones A, Brown B")
        assert len(authors) == 3


class TestVancouverTitleNormalization:
    """Tests for Vancouver title normalization."""

    def test_normalize_title(self):
        """Test title normalization."""
        format_obj = VancouverFormat()
        normalized = format_obj._normalize_title("Article Title About Machine Learning")
        assert normalized == "article title about machine learning"

    def test_normalize_title_with_punctuation(self):
        """Test title normalization with punctuation."""
        format_obj = VancouverFormat()
        normalized = format_obj._normalize_title("Attention Is All You Need!")
        assert normalized == "attention is all you need"

    def test_normalize_title_case_insensitive(self):
        """Test title normalization is case insensitive."""
        format_obj = VancouverFormat()
        norm1 = format_obj._normalize_title("Deep Learning Methods")
        norm2 = format_obj._normalize_title("deep learning methods")
        assert norm1 == norm2


class TestVancouverVenueParsing:
    """Tests for Vancouver venue parsing."""

    def test_parse_journal_with_volume_issue_pages(self):
        """Test parsing journal with volume, issue, and pages."""

        format_obj = VancouverFormat()
        citation = Citation(
            raw_text="test",
            citation_type=CitationType.REFERENCE_LIST,
            style=CitationStyle.VANCOUVER,
        )
        venue_text = "J Clin Med. 10(2):123-145"

        format_obj._parse_venue(citation, venue_text)
        assert citation.venue is not None
        assert "J Clin Med" in citation.venue

    def test_parse_journal_with_pages_only(self):
        """Test parsing journal with pages only."""

        format_obj = VancouverFormat()
        citation = Citation(
            raw_text="test",
            citation_type=CitationType.REFERENCE_LIST,
            style=CitationStyle.VANCOUVER,
        )
        venue_text = "J Clin Med. 10:123-145"

        format_obj._parse_venue(citation, venue_text)
        assert citation.venue is not None


class TestVancouverRealWorldExamples:
    """Tests with real-world Vancouver citation examples."""

    def test_standard_vancouver_medical_journal(self):
        """Test parsing real medical journal citation."""
        format_obj = VancouverFormat()
        text = "Smith J, Jones A. Effects of exercise on cardiovascular health. N Engl J Med. 2020;382(15):1-10."

        citation = format_obj.parse_reference_entry(text)
        assert citation is not None
        assert citation.title == "Effects of exercise on cardiovascular health"
        assert citation.year == "2020"
        assert "N Engl J Med" in citation.venue

    def test_vancouver_year_first_nlm_style(self):
        """Test parsing year-first NLM style citation."""
        format_obj = VancouverFormat()
        text = "Smith J, Jones A. 2020. Effects of exercise on cardiovascular health. N Engl J Med. 382(15):1-10."

        citation = format_obj.parse_reference_entry(text)
        assert citation is not None
        assert citation.title == "Effects of exercise on cardiovascular health"
        assert citation.year == "2020"

    def test_multi_author_vancouver(self):
        """Test parsing multi-author Vancouver citation."""
        format_obj = VancouverFormat()
        text = "Brown B, Chen D, Davis E, Frank F, Garcia H. New findings in clinical research. Lancet. 2021;396(10248):1-15."

        citation = format_obj.parse_reference_entry(text)
        assert citation is not None
        assert citation.title == "New findings in clinical research"
        assert citation.year == "2021"
        assert len(citation.authors) == 5

    def test_vancouver_preprint(self):
        """Test parsing Vancouver citation with preprint."""
        format_obj = VancouverFormat()
        text = "Smith J, Jones A. Preprint article title. medRxiv. 2020."

        citation = format_obj.parse_reference_entry(text)
        assert citation is not None
        assert citation.year == "2020"


class TestVancouverPatternRegistration:
    """Tests for Vancouver pattern registration."""

    def test_get_format(self):
        """Test getting Vancouver format from registry."""
        format_obj = get_format("Vancouver")
        assert format_obj is not None
        assert isinstance(format_obj, VancouverFormat)

    def test_get_in_text_patterns_contains_vancouver(self):
        """Test that Vancouver patterns are in global in-text patterns."""
        patterns = get_in_text_patterns()
        vancouver_patterns = [p for p in patterns if "vancouver" in p.name.lower()]
        assert len(vancouver_patterns) >= 3

    def test_get_reference_patterns_contains_vancouver(self):
        """Test that Vancouver patterns are in global reference patterns."""
        patterns = get_reference_patterns()
        vancouver_patterns = [p for p in patterns if "vancouver" in p.name.lower()]
        assert len(vancouver_patterns) >= 4


class TestVancouverErrorHandling:
    """Tests for Vancouver format error handling."""

    def test_parse_invalid_entry_returns_none(self):
        """Test parsing invalid entry returns None."""
        format_obj = VancouverFormat()
        citation = format_obj.parse_reference_entry("Not a valid Vancouver entry")
        # Should return None or fallback with low confidence
        assert citation is None or citation.confidence < 0.5

    def test_parse_empty_string_returns_none(self):
        """Test parsing empty string returns None."""
        format_obj = VancouverFormat()
        citation = format_obj.parse_reference_entry("")
        assert citation is None

    def test_parse_very_long_title(self):
        """Test parsing entry with very long title."""
        format_obj = VancouverFormat()
        long_title = "A Very Long Paper Title About Machine Learning and Neural Networks That Spans Multiple Topics"
        text = f"Smith J. {long_title}. J Clin Med. 2020."

        citation = format_obj.parse_reference_entry(text)
        assert citation is not None
        assert citation.title is not None

    def test_parse_entry_without_year(self):
        """Test parsing entry without year returns None."""
        format_obj = VancouverFormat()
        text = "Smith J. Article title. J Clin Med."
        citation = format_obj.parse_reference_entry(text)
        # Should return None because year is required
        assert citation is None


class TestVancouverEdgeCases:
    """Tests for edge cases in Vancouver format."""

    def test_entry_with_et_al_in_authors(self):
        """Test entry where et al. appears in author field."""
        format_obj = VancouverFormat()
        text = "Smith J, et al. Article title. J Clin Med. 2020."

        citation = format_obj.parse_reference_entry(text)
        # Should still parse the author part
        assert citation is not None

    def test_entry_with_hyphenated_title(self):
        """Test entry with hyphenated words in title."""
        format_obj = VancouverFormat()
        text = "Smith J. Machine-learning based approach. J Clin Med. 2020."

        citation = format_obj.parse_reference_entry(text)
        assert citation is not None
        assert "Machine-learning based approach" in citation.title

    def test_entry_with_colon_in_title(self):
        """Test entry with colon in title."""
        format_obj = VancouverFormat()
        text = "Smith J. Deep learning: A comprehensive review. J Clin Med. 2020."

        citation = format_obj.parse_reference_entry(text)
        assert citation is not None

    def test_entry_with_special_characters_in_title(self):
        """Test entry with special characters in title."""
        format_obj = VancouverFormat()
        text = "Smith J. Neural networks: α, β, and γ analysis. J Clin Med. 2020."

        citation = format_obj.parse_reference_entry(text)
        assert citation is not None
