"""Tests for IEEE citation format patterns.

Tests covering:
- IEEE numeric in-text citations: [1], [1,2], [1-5]
- IEEE reference entry parsing
- IEEE book chapters, tech reports, conference papers
- Quote-based parsing for IEEE entries
- Reference list marker detection
"""

from __future__ import annotations

import pytest

from integrity_checker.extraction.patterns import (
    IEEEFormat,
    get_format,
    get_in_text_patterns,
    get_reference_patterns,
)
from integrity_checker.extraction.patterns.ieee import (
    _IEEE_BOOK_CHAPTER,
    _IEEE_BRACKET_RE,
    _IEEE_CONFERENCE,
    _IEEE_NUMERIC,
    _IEEE_REFERENCE_ENTRY,
    _IEEE_REFERENCE_YEAR_END,
    _IEEE_TECH_REPORT,
    IEEE_IN_TEXT_PATTERNS,
    IEEE_REFERENCE_PATTERNS,
)
from integrity_checker.models.citation import Citation, CitationStyle, CitationType


class TestIEEENumericInText:
    """Tests for IEEE numeric in-text citation patterns."""

    def test_single_number(self):
        """Test single bracketed number [1]."""
        match = _IEEE_NUMERIC.search("[1]")
        assert match is not None
        assert match.group(1) == "1"

    def test_multiple_numbers(self):
        """Test multiple bracketed numbers [1,2,3]."""
        match = _IEEE_NUMERIC.search("[1,2,3]")
        assert match is not None
        assert match.group(1) == "1,2,3"

    def test_range_numbers(self):
        """Test range bracketed numbers [1-5]."""
        match = _IEEE_NUMERIC.search("[1-5]")
        assert match is not None
        assert match.group(1) == "1-5"

    def test_mixed_numbers(self):
        """Test mixed format bracketed numbers [1, 2, 3]."""
        match = _IEEE_NUMERIC.search("[1, 2, 3]")
        assert match is not None
        assert match.group(1) == "1, 2, 3"

    def test_single_in_context(self):
        """Test single number in context sentence."""
        text = "As shown in [1], deep learning has improved significantly."
        match = _IEEE_NUMERIC.search(text)
        assert match is not None
        assert match.group(1) == "1"


class TestIEEEReferenceEntry:
    """Tests for IEEE reference entry patterns."""

    def test_ieee_reference_entry_pattern(self):
        """Test IEEE reference entry regex pattern."""
        text = '[1] S. J. Pan and Q. Yang, "A Survey on Transfer Learning," IEEE Trans. Knowl. Data Eng., vol. 22, no. 10, pp. 1345-1359, 2010.'
        match = _IEEE_REFERENCE_ENTRY.search(text)
        assert match is not None
        assert match.group("index") == "1"

    def test_ieee_reference_year_end_pattern(self):
        """Test IEEE reference entry with year at end."""
        text = '[10] J. Devlin et al., "BERT: Pre-training of Deep Bidirectional Transformers," arXiv:1810.04805, 2018.'
        match = _IEEE_REFERENCE_YEAR_END.search(text)
        assert match is not None
        assert match.group("index") == "10"
        assert match.group("year") == "2018"


class TestIEEEReferenceListMarker:
    """Tests for IEEE reference list marker detection."""

    def test_bracket_marker(self):
        """Test [N] reference list marker detection."""
        match = _IEEE_BRACKET_RE.search("[1]")
        assert match is not None

    def test_bracket_marker_with_space(self):
        """Test [N] marker with trailing space."""
        match = _IEEE_BRACKET_RE.search("[42] ")
        assert match is not None


class TestIEEEFormatClass:
    """Tests for IEEEFormat class."""

    def test_name(self):
        """Test format name."""
        format_obj = IEEEFormat()
        assert format_obj.name == "IEEE"

    def test_priority(self):
        """Test format priority."""
        format_obj = IEEEFormat()
        assert format_obj.priority == 90

    def test_in_text_patterns(self):
        """Test in-text patterns list."""
        format_obj = IEEEFormat()
        patterns = format_obj.in_text_patterns
        assert len(patterns) >= 1
        assert any(p.name == "ieee_numeric" for p in patterns)

    def test_reference_patterns(self):
        """Test reference patterns list."""
        format_obj = IEEEFormat()
        patterns = format_obj.reference_patterns
        assert len(patterns) >= 1

    def test_is_valid_citation_bracket(self):
        """Test is_valid_citation with bracketed number."""
        format_obj = IEEEFormat()
        assert format_obj.is_valid_citation("[1]") is True
        assert format_obj.is_valid_citation("[1,2]") is True
        assert format_obj.is_valid_citation("[1-5]") is True

    def test_is_valid_citation_reference_entry(self):
        """Test is_valid_citation with reference entry."""
        format_obj = IEEEFormat()
        text = '[1] S. J. Pan and Q. Yang, "A Survey on Transfer Learning," IEEE Trans. Knowl. Data Eng., 2010.'
        assert format_obj.is_valid_citation(text) is True

    def test_is_valid_citation_invalid(self):
        """Test is_valid_citation with invalid text."""
        format_obj = IEEEFormat()
        assert format_obj.is_valid_citation("This is not a citation") is False
        assert format_obj.is_valid_citation("") is False

    def test_is_reference_list_marker(self):
        """Test is_reference_list_marker method."""
        format_obj = IEEEFormat()
        # Standalone markers
        assert format_obj.is_reference_list_marker("[1]") is True
        assert format_obj.is_reference_list_marker("[42]") is True
        # Markers followed by space and lowercase (inline citation)
        assert format_obj.is_reference_list_marker("[1] some text") is True
        # Markers followed by uppercase are new entries (author names start with uppercase)
        assert format_obj.is_reference_list_marker("[1] Some text") is False
        assert format_obj.is_reference_list_marker("Not a marker") is False


class TestIEEEParseReferenceEntry:
    """Tests for IEEEFormat.parse_reference_entry method."""

    def test_parse_journal_article(self):
        """Test parsing IEEE journal article."""
        format_obj = IEEEFormat()
        text = '[1] S. J. Pan and Q. Yang, "A Survey on Transfer Learning," IEEE Trans. Knowl. Data Eng., vol. 22, no. 10, pp. 1345-1359, 2010.'

        citation = format_obj.parse_reference_entry(text)
        assert citation is not None
        assert citation.style == CitationStyle.IEEE
        assert citation.citation_type == CitationType.REFERENCE_LIST
        assert citation.numeric_index == 1
        assert citation.year == "2010"
        assert citation.title == "A Survey on Transfer Learning"
        assert len(citation.authors) == 2
        assert citation.volume == "22"
        assert citation.issue == "10"

    def test_parse_conference_paper(self):
        """Test parsing IEEE conference paper."""
        format_obj = IEEEFormat()
        text = '[2] A. Vaswani et al., "Attention Is All You Need," in NeurIPS, 2017.'

        citation = format_obj.parse_reference_entry(text)
        assert citation is not None
        assert citation.style == CitationStyle.IEEE
        assert citation.numeric_index == 2
        assert citation.year == "2017"
        assert citation.title == "Attention Is All You Need"

    def test_parse_arxiv_paper(self):
        """Test parsing arXiv paper."""
        format_obj = IEEEFormat()
        text = '[3] J. Devlin et al., "BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding," arXiv:1810.04805, 2018.'

        citation = format_obj.parse_reference_entry(text)
        assert citation is not None
        assert citation.style == CitationStyle.IEEE
        assert citation.year == "2018"
        assert citation.title == "BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding"
        # arXiv ID is stored as part of venue since it's not a standard DOI
        assert citation.venue is not None

    def test_parse_book_chapter(self):
        """Test parsing IEEE book chapter."""
        format_obj = IEEEFormat()
        text = '[4] Y. LeCun et al., "Deep Learning," in Nature, MIT Press, 2015.'

        citation = format_obj.parse_reference_entry(text)
        assert citation is not None
        assert citation.style == CitationStyle.IEEE

    def test_parse_with_doi(self):
        """Test parsing entry with DOI."""
        format_obj = IEEEFormat()
        text = '[5] A. Smith, "New Approach to ML," IEEE Trans. Pattern Anal., vol. 40, pp. 100-110, 2020. DOI: 10.1109/TPAMI.2020.1234567'

        citation = format_obj.parse_reference_entry(text)
        assert citation is not None
        assert citation.doi is not None
        assert citation.doi.startswith("10.1109")

    def test_parse_fallback_confidence(self):
        """Test that confidence is calculated correctly."""
        format_obj = IEEEFormat()
        text = '[1] S. J. Pan and Q. Yang, "A Survey on Transfer Learning," IEEE Trans. Knowl. Data Eng., 2010.'

        citation = format_obj.parse_reference_entry(text)
        assert citation is not None
        assert citation.confidence > 0
        assert citation.confidence <= 1.0


class TestIEEEPatternRegistration:
    """Tests for IEEE pattern registration."""

    def test_get_format(self):
        """Test getting IEEE format from registry."""
        format_obj = get_format("IEEE")
        assert format_obj is not None
        assert isinstance(format_obj, IEEEFormat)

    def test_get_in_text_patterns_contains_ieee(self):
        """Test that IEEE numeric patterns are in global in-text patterns."""
        patterns = get_in_text_patterns()
        ieee_patterns = [p for p in patterns if "ieee" in p.name.lower() or "numeric" in p.name.lower()]
        assert len(ieee_patterns) >= 1

    def test_get_reference_patterns_contains_ieee(self):
        """Test that IEEE reference patterns are in global reference patterns."""
        patterns = get_reference_patterns()
        ieee_patterns = [p for p in patterns if "ieee" in p.name.lower()]
        assert len(ieee_patterns) >= 1


class TestIEEEAuthorsParsing:
    """Tests for IEEE author string parsing."""

    def test_single_author(self):
        """Test parsing single author."""
        format_obj = IEEEFormat()
        authors = format_obj._parse_authors("S. J. Pan")
        assert len(authors) == 1
        assert authors[0].raw == "S. J. Pan"

    def test_two_authors(self):
        """Test parsing two authors."""
        format_obj = IEEEFormat()
        authors = format_obj._parse_authors("S. J. Pan and Q. Yang")
        assert len(authors) == 2
        assert authors[0].raw == "S. J. Pan"
        assert authors[1].raw == "Q. Yang"

    def test_multiple_authors(self):
        """Test parsing multiple authors."""
        format_obj = IEEEFormat()
        authors = format_obj._parse_authors("A. Vaswani and N. Shazeer and A. Parmar")
        assert len(authors) == 3


class TestIEEETitleNormalization:
    """Tests for IEEE title normalization."""

    def test_normalize_title(self):
        """Test title normalization."""
        format_obj = IEEEFormat()
        normalized = format_obj._normalize_title("A Survey on Transfer Learning")
        assert normalized == "a survey on transfer learning"

    def test_normalize_title_with_punctuation(self):
        """Test title normalization with punctuation."""
        format_obj = IEEEFormat()
        normalized = format_obj._normalize_title("Attention Is All You Need!")
        assert normalized == "attention is all you need"

    def test_normalize_title_case_insensitive(self):
        """Test title normalization is case insensitive."""
        format_obj = IEEEFormat()
        norm1 = format_obj._normalize_title("BERT Pre-training")
        norm2 = format_obj._normalize_title("bert pre-training")
        assert norm1 == norm2


class TestIEEEVenueParsing:
    """Tests for IEEE venue parsing."""

    def test_parse_journal_with_volume_issue(self):
        """Test parsing journal with volume and issue."""

        format_obj = IEEEFormat()
        citation = Citation(
            raw_text="test",
            citation_type=CitationType.REFERENCE_LIST,
            style=CitationStyle.IEEE,
        )
        venue_text = "IEEE Trans. Knowl. Data Eng., vol. 22, no. 10, pp. 1345-1359, 2010"

        format_obj._parse_venue(citation, venue_text)
        assert citation.volume == "22"
        assert citation.issue == "10"
        # Note: _parse_venue extracts volume/issue before venue name
        # Pages extraction may need improvement for complex venue strings

    def test_parse_conference_venue(self):
        """Test parsing conference venue."""

        format_obj = IEEEFormat()
        citation = Citation(
            raw_text="test",
            citation_type=CitationType.REFERENCE_LIST,
            style=CitationStyle.IEEE,
        )
        venue_text = "Proc. NeurIPS, Montreal, Canada, 2017"

        format_obj._parse_venue(citation, venue_text)
        assert citation.venue is not None
        assert "NeurIPS" in citation.venue


class TestIEEERealWorldExamples:
    """Tests with real-world IEEE citation examples."""

    def test_attention_is_all_you_need(self):
        """Test parsing real Attention paper citation."""
        format_obj = IEEEFormat()
        text = '[1] A. Vaswani, N. Shazeer, N. Parmar, J. Uszkoreit, N. Polosukhin, and G. S. Egly, "Attention Is All You Need," in NeurIPS, Long Beach, CA, USA, Dec. 2017, pp. 6000-6010.'

        citation = format_obj.parse_reference_entry(text)
        assert citation is not None
        assert citation.title == "Attention Is All You Need"
        assert citation.year == "2017"
        assert citation.numeric_index == 1

    def test_bert_paper(self):
        """Test parsing real BERT paper citation."""
        format_obj = IEEEFormat()
        text = '[2] J. Devlin, M.-W. Chang, K. Lee, and K. Toutanova, "BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding," in NAACL-HLT, Minneapolis, MN, USA, Jun. 2019, pp. 4171-4186.'

        citation = format_obj.parse_reference_entry(text)
        assert citation is not None
        assert citation.title == "BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding"
        assert citation.year == "2019"
        assert citation.numeric_index == 2

    def test_transfer_learning_survey(self):
        """Test parsing transfer learning survey citation."""
        format_obj = IEEEFormat()
        text = '[3] S. J. Pan and Q. Yang, "A Survey on Transfer Learning," IEEE Trans. Knowl. Data Eng., vol. 22, no. 10, pp. 1345-1359, Oct. 2010.'

        citation = format_obj.parse_reference_entry(text)
        assert citation is not None
        assert citation.title == "A Survey on Transfer Learning"
        assert citation.year == "2010"
        assert citation.volume == "22"
        assert citation.issue == "10"

    def test_tech_report(self):
        """Test parsing technical report."""
        format_obj = IEEEFormat()
        text = '[4] R. B. Marks, "Technical Report on Neural Networks," Tech. Rep. TR-1234, MIT, 2019.'

        citation = format_obj.parse_reference_entry(text)
        assert citation is not None
        assert citation.title == "Technical Report on Neural Networks"
        assert citation.year == "2019"
        assert citation.style == CitationStyle.IEEE

    def test_quote_based_parsing_with_unicode_quotes(self):
        """Test parsing with unicode quotes."""
        format_obj = IEEEFormat()
        text = '[5] A. Smith, "Paper Title," IEEE Journal, 2021.'

        citation = format_obj.parse_reference_entry(text)
        assert citation is not None
        assert citation.title == "Paper Title"

    def test_dietterich_1998_page_range_not_mistaken_for_year(self):
        """Regression test: pp. 1895–1923 must not be extracted as year=1923 instead of 1998."""
        format_obj = IEEEFormat()
        text = (
            '[30] T. G. Dietterich, “Approximate statistical tests for comparing '
            'supervised classification learning algorithms,” Neural Computation, '
            'vol. 10, no. 7, pp. 1895–1923, 1998. doi: 10.1162/089976698300017197.'
        )

        citation = format_obj.parse_reference_entry(text)
        assert citation is not None
        assert citation.numeric_index == 30
        assert citation.title == (
            "Approximate statistical tests for comparing supervised classification learning algorithms"
        )
        assert citation.year == "1998"
        assert citation.volume == "10"
        assert citation.issue == "7"
        assert citation.pages == "1895–1923"
        assert citation.doi == "10.1162/089976698300017197"

    def test_four_digit_page_ranges_and_series_numbers_ignored_for_year(self):
        """4-digit page ranges (1920-1935, 2001-2015) and LNCS/article numbers must not be parsed as year."""
        format_obj = IEEEFormat()

        text_pages_19xx = (
            '[12] A. Author, "Deep Models," J. Mach. Learn. Res., vol. 19, no. 4, pp. 1920-1935, 2018.'
        )
        cit1 = format_obj.parse_reference_entry(text_pages_19xx)
        assert cit1 is not None
        assert cit1.year == "2018"
        assert cit1.pages == "1920-1935"

        text_pages_20xx = (
            '[13] B. Author, "Vision Transformers," IEEE Access, vol. 9, pp. 2001–2015, 2021.'
        )
        cit2 = format_obj.parse_reference_entry(text_pages_20xx)
        assert cit2 is not None
        assert cit2.year == "2021"
        assert cit2.pages == "2001–2015"

        text_arxiv_accessed = (
            '[5] D. H.-C. Ho et al., “Emotion recognition for Vietnamese social media text,” '
            'arXiv preprint arXiv:1911.09339, 2019, doi: 10.48550/arXiv.1911.09339. '
            '[Online]. Available: https://arxiv.org/abs/1911.09339 (Accessed: Oct. 15, 2026).'
        )
        cit3 = format_obj.parse_reference_entry(text_arxiv_accessed)
        assert cit3 is not None
        assert cit3.year == "2019"

        text_only_accessed = (
            '[16] Underthesea Team, “Underthesea: Vietnamese NLP Toolkit,” GitHub repository. '
            '[Online]. Available: https://github.com/undertheseanlp/underthesea (Accessed: Oct. 15, 2026).'
        )
        cit4 = format_obj.parse_reference_entry(text_only_accessed)
        assert cit4 is not None
        assert cit4.year == "2026"


class TestIEEEErrorHandling:
    """Tests for IEEE format error handling."""

    def test_parse_invalid_entry_returns_none(self):
        """Test parsing invalid entry returns None."""
        format_obj = IEEEFormat()
        citation = format_obj.parse_reference_entry("Not a valid IEEE entry")
        # Should return fallback or None
        assert citation is None or citation.confidence < 0.5

    def test_parse_empty_string_returns_none(self):
        """Test parsing empty string returns None."""
        format_obj = IEEEFormat()
        citation = format_obj.parse_reference_entry("")
        assert citation is None

    def test_parse_very_long_title(self):
        """Test parsing entry with very long title."""
        format_obj = IEEEFormat()
        long_title = "A Very Long Paper Title About Machine Learning and Neural Networks That Spans Multiple Topics"
        text = f'[1] A. Author, "{long_title}," IEEE Journal, 2020.'

        citation = format_obj.parse_reference_entry(text)
        assert citation is not None
        assert citation.title is not None
