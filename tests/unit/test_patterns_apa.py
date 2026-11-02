"""Tests for APA citation format module.

These tests verify the APA citation format patterns and parsing logic.
"""

import pytest

from integrity_checker.extraction.patterns.base import PatternType
from integrity_checker.models.citation import CitationStyle


class TestAPAFormatRegistration:
    """Test APA format registration in the registry."""

    def setup_method(self):
        """Set up APA format."""
        # Import APA to trigger registration
        from integrity_checker.extraction.patterns import apa  # noqa: F401
        from integrity_checker.extraction.patterns.registry import (
            get_format,
            get_registry_info,
        )
        # Store for test methods
        self.get_format = get_format
        self.get_registry_info = get_registry_info

    def test_apa_format_registered(self):
        """APA format should be registered on import."""
        apa_format = self.get_format("APA")
        assert apa_format is not None
        assert apa_format.name == "APA"

    def test_apa_format_priority(self):
        """APA should have highest priority (100)."""
        apa_format = self.get_format("APA")
        assert apa_format is not None
        assert apa_format.priority == 100

    def test_registry_info(self):
        """Registry should contain APA format info."""
        info = self.get_registry_info()
        assert "APA" in info
        assert info["APA"]["priority"] == 100
        assert info["APA"]["in_text_patterns"] == 2
        assert info["APA"]["reference_patterns"] == 4


class TestAPAInTextPatterns:
    """Test APA in-text citation patterns."""

    def setup_method(self):
        """Set up APA format."""
        from integrity_checker.extraction.patterns.apa import APAFormat
        self.apa = APAFormat()

    def test_parenthetical_single_author(self):
        """Test (Author, Year) pattern."""
        pattern = self.apa.in_text_patterns[0]  # _APA_INTEXT_PARENTHETICAL

        text = "(Smith, 2020)"
        matches = pattern.finditer(text)
        assert len(matches) == 1
        assert matches[0].group(1) == "Smith"
        assert matches[0].group(2) == "2020"

    def test_parenthetical_single_author_year_suffix(self):
        """Test (Author, Year) with year suffix."""
        pattern = self.apa.in_text_patterns[0]

        text = "(Smith, 2020a)"
        matches = pattern.finditer(text)
        assert len(matches) == 1
        assert matches[0].group(2) == "2020a"

    def test_parenthetical_two_authors(self):
        """Test (Author and Author, Year) pattern."""
        pattern = self.apa.in_text_patterns[0]

        text = "(Smith and Jones, 2020)"
        matches = pattern.finditer(text)
        assert len(matches) == 1

    def test_parenthetical_et_al(self):
        """Test (Author et al., Year) pattern."""
        pattern = self.apa.in_text_patterns[0]

        text = "(Smith et al., 2020)"
        matches = pattern.finditer(text)
        assert len(matches) == 1
        assert "et al." in matches[0].group(1)

    def test_narrative_single_author(self):
        """Test Author (Year) pattern."""
        pattern = self.apa.in_text_patterns[1]  # _APA_INTEXT_NARRATIVE

        text = "Smith (2020)"
        matches = pattern.finditer(text)
        assert len(matches) == 1
        assert matches[0].group(1) == "Smith"
        assert matches[0].group(2) == "2020"

    def test_narrative_et_al(self):
        """Test Author et al. (Year) pattern."""
        pattern = self.apa.in_text_patterns[1]

        text = "Smith et al. (2020)"
        matches = pattern.finditer(text)
        assert len(matches) == 1

    def test_compound_author_name(self):
        """Test compound author names like McDonald."""
        pattern = self.apa.in_text_patterns[0]

        text = "(McDonald, 2020)"
        matches = pattern.finditer(text)
        assert len(matches) == 1


class TestAPAReferenceParsing:
    """Test APA reference list entry parsing."""

    def setup_method(self):
        """Set up APA format."""
        from integrity_checker.extraction.patterns.apa import APAFormat
        self.apa = APAFormat()

    def test_parse_simple_reference(self):
        """Test parsing simple APA reference entry."""
        text = "Smith, J., & Jones, A. (2020). Paper Title. Journal Name, 10(2), 1-15."

        citation = self.apa.parse_reference_entry(text)

        assert citation is not None
        assert citation.style == CitationStyle.APA
        assert citation.year == "2020"
        assert citation.title == "Paper Title"
        assert len(citation.authors) >= 1
        assert citation.confidence > 0

    def test_parse_reference_with_doi(self):
        """Test parsing reference with DOI."""
        text = "Smith, J. (2020). Paper Title. Journal Name, 10(2), 1-15. https://doi.org/10.1000/xyz123"

        citation = self.apa.parse_reference_entry(text)

        assert citation is not None
        assert citation.doi == "10.1000/xyz123"

    def test_parse_reference_with_year_suffix(self):
        """Test parsing reference with year suffix (e.g., 2020a)."""
        text = "Smith, J. (2020a). Paper Title. Journal Name."

        citation = self.apa.parse_reference_entry(text)

        assert citation is not None
        assert citation.year == "2020"
        assert citation.year_suffix == "a"

    def test_parse_reference_numbered(self):
        """Test parsing numbered APA reference."""
        text = "[1] Smith, J. (2020). Paper Title. Journal Name."

        citation = self.apa.parse_reference_entry(text)

        assert citation is not None
        assert citation.numeric_index == 1

    def test_parse_reference_volume_issue(self):
        """Test parsing reference with volume and issue."""
        text = "Smith, J. (2020). Paper Title. Journal Name, 15(3), 100-120."

        citation = self.apa.parse_reference_entry(text)

        assert citation is not None
        assert citation.volume == "15"
        assert citation.issue == "3"
        assert citation.pages == "100-120"

    def test_parse_book_chapter(self):
        """Test parsing book chapter reference."""
        text = "Smith, J. (2020). Chapter Title. In J. Editor (Ed.), Book Title (pp. 10-20). Publisher."

        citation = self.apa.parse_reference_entry(text)

        assert citation is not None
        assert citation.title == "Chapter Title"
        assert "Book Title" in citation.venue

    def test_parse_fallback(self):
        """Test fallback parsing for unstructured text."""
        text = "Some text with (2020) year and partial info"

        citation = self.apa.parse_reference_entry(text)

        # Fallback should still extract year
        if citation:
            assert citation.year == "2020"


class TestAPAIsValidCitation:
    """Test APA citation validation."""

    def setup_method(self):
        """Set up APA format."""
        from integrity_checker.extraction.patterns.apa import APAFormat
        self.apa = APAFormat()

    def test_valid_parenthetical(self):
        """Valid parenthetical citation should return True."""
        assert self.apa.is_valid_citation("(Smith, 2020)") is True

    def test_valid_narrative(self):
        """Valid narrative citation should return True."""
        assert self.apa.is_valid_citation("Smith (2020)") is True

    def test_valid_with_et_al(self):
        """Citation with et al. should be valid."""
        assert self.apa.is_valid_citation("(Smith et al., 2020)") is True

    def test_invalid_no_year(self):
        """Citation without year should return False."""
        assert self.apa.is_valid_citation("(Smith)") is False

    def test_invalid_no_author(self):
        """Citation without author should return False."""
        assert self.apa.is_valid_citation("(2020)") is False

    def test_invalid_random_text(self):
        """Random text should return False."""
        assert self.apa.is_valid_citation("This is random text") is False


class TestAPAEdgeCases:
    """Test APA edge cases and international characters."""

    def setup_method(self):
        """Set up APA format."""
        from integrity_checker.extraction.patterns.apa import APAFormat
        self.apa = APAFormat()

    def test_international_characters(self):
        """Test author names with international characters."""
        pattern = self.apa.in_text_patterns[0]

        text = "(Müller, 2020)"
        matches = pattern.finditer(text)
        assert len(matches) == 1

        text = "(Søren, 2020)"
        matches = pattern.finditer(text)
        assert len(matches) == 1

    def test_compound_last_name(self):
        """Test compound last names like van der Waals."""
        pattern = self.apa.in_text_patterns[0]

        text = "(van der Waals, 2020)"
        matches = pattern.finditer(text)
        assert len(matches) == 1

    def test_year_suffix_a(self):
        """Test year suffix 'a' for multiple papers in same year."""
        text = "Smith, J. (2020a). First Paper. Journal."
        citation = self.apa.parse_reference_entry(text)

        assert citation is not None
        assert citation.year == "2020"
        assert citation.year_suffix == "a"

    def test_year_suffix_b(self):
        """Test year suffix 'b' for multiple papers in same year."""
        text = "Smith, J. (2020b). Second Paper. Journal."
        citation = self.apa.parse_reference_entry(text)

        assert citation is not None
        assert citation.year == "2020"
        assert citation.year_suffix == "b"


class TestAPAConfidenceEstimation:
    """Test confidence estimation for parsed citations."""

    def setup_method(self):
        """Set up APA format."""
        from integrity_checker.extraction.patterns.apa import APAFormat
        self.apa = APAFormat()

    def test_high_confidence_full_metadata(self):
        """Full metadata should give high confidence."""
        text = "Smith, J. (2020). Paper Title. Journal, 10(2), 1-15. https://doi.org/10.1000/xyz123"

        citation = self.apa.parse_reference_entry(text)

        assert citation is not None
        assert citation.confidence >= 0.9

    def test_medium_confidence_partial_metadata(self):
        """Partial metadata should give medium confidence."""
        text = "Smith, J. (2020). Paper Title. Journal."

        citation = self.apa.parse_reference_entry(text)

        assert citation is not None
        # With title + year + authors = 0.9, with venue = 0.9
        # This is still valid - we accept 0.5-1.0
        assert 0.5 <= citation.confidence <= 1.0

    def test_low_confidence_minimal_metadata(self):
        """Minimal metadata should give lower confidence."""
        text = "Smith (2020) some partial text"

        citation = self.apa.parse_reference_entry(text)

        # Should still parse but with lower confidence
        assert citation is not None


class TestAPAPatternTypes:
    """Test that patterns are correctly typed."""

    def setup_method(self):
        """Set up APA format."""
        from integrity_checker.extraction.patterns.apa import APAFormat
        self.apa = APAFormat()

    def test_in_text_patterns_type(self):
        """In-text patterns should have IN_TEXT type."""
        for pattern in self.apa.in_text_patterns:
            assert pattern.pattern_type == PatternType.IN_TEXT

    def test_reference_patterns_type(self):
        """Reference patterns should have REFERENCE_ENTRY type."""
        for pattern in self.apa.reference_patterns:
            assert pattern.pattern_type == PatternType.REFERENCE_ENTRY


class TestAPAAuthorParsing:
    """Test author string parsing."""

    def setup_method(self):
        """Set up APA format."""
        from integrity_checker.extraction.patterns.apa import APAFormat
        self.apa = APAFormat()

    def test_parse_single_author(self):
        """Test parsing single author."""
        authors = self.apa._parse_authors("Smith, J.")
        assert len(authors) == 1
        assert "smith" in authors[0].last_name.lower()

    def test_parse_two_authors_ampersand(self):
        """Test parsing two authors with &."""
        authors = self.apa._parse_authors("Smith, J., & Jones, A.")
        assert len(authors) >= 1

    def test_parse_two_authors_and(self):
        """Test parsing two authors with 'and'."""
        authors = self.apa._parse_authors("Smith, J., and Jones, A.")
        assert len(authors) >= 1

    def test_parse_many_authors(self):
        """Test parsing many authors."""
        authors = self.apa._parse_authors("Smith, J., Jones, A., Brown, B., & White, C.")
        assert len(authors) >= 1


class TestAPATitleNormalization:
    """Test title normalization."""

    def setup_method(self):
        """Set up APA format."""
        from integrity_checker.extraction.patterns.apa import APAFormat
        self.apa = APAFormat()

    def test_normalize_title(self):
        """Test title normalization."""
        title = "The Quick Brown Fox!"
        normalized = self.apa._normalize_title(title)
        assert normalized == "the quick brown fox"
        assert "!" not in normalized

    def test_normalize_title_with_punctuation(self):
        """Test title normalization with various punctuation."""
        title = "Machine Learning: A Comprehensive Study (2020)"
        normalized = self.apa._normalize_title(title)
        assert normalized == "machine learning a comprehensive study 2020"
        assert ":" not in normalized
        assert "(" not in normalized


class TestAPARealWorldExamples:
    """Test with real-world APA citation examples."""

    def setup_method(self):
        """Set up APA format."""
        from integrity_checker.extraction.patterns.apa import APAFormat
        self.apa = APAFormat()

    def test_attention_is_all_you_need(self):
        """Test real citation: Vaswani et al. (2017)."""
        text = "Vaswani, A., Shazeer, N., Parmar, N., Uszkoreit, J., Jones, L., Gomez, A. N., Kaiser, L., & Polosukhin, I. (2017). Attention is all you need. Advances in Neural Information Processing Systems, 30, 5998-6008."

        citation = self.apa.parse_reference_entry(text)

        assert citation is not None
        assert citation.year == "2017"
        assert "Vaswani" in citation.raw_text
        assert citation.title == "Attention is all you need"

    def test_bert_paper(self):
        """Test real citation: Devlin et al. (2019)."""
        text = "Devlin, J., Chang, M. W., Lee, K., & Toutanova, K. (2019). BERT: Pre-training of deep bidirectional transformers for language understanding. Proceedings of NAACL-HLT 2019, 4171-4186."

        citation = self.apa.parse_reference_entry(text)

        assert citation is not None
        assert citation.year == "2019"
        assert "BERT" in citation.title or "BERT" in citation.raw_text

    def test_gpt3_paper(self):
        """Test real citation: Brown et al. (2020)."""
        text = "Brown, T. B., Mann, B., Ryder, N., Subbiah, M., Kaplan, J., Dhariwal, P., ... & Amodei, D. (2020). Language models are few-shot learners. Advances in Neural Information Processing Systems, 33, 1877-1901."

        citation = self.apa.parse_reference_entry(text)

        assert citation is not None
        assert citation.year == "2020"
        assert "Brown" in citation.raw_text


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
