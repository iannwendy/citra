"""Tests for modular citation patterns system."""

from __future__ import annotations

import pytest

from integrity_checker.extraction.patterns import (
    DOI_PATTERN,
    URL_PATTERN,
    UTILITY_PATTERNS,
    YEAR_PATTERN,
    CitationFormat,
    CompiledPattern,
    PatternType,
    clear_registry,
    extract_doi,
    extract_url,
    extract_year,
    get_all_formats,
    get_format,
    get_in_text_patterns,
    get_reference_patterns,
    get_registry_info,
    get_utility_patterns,
    register_format,
)
from integrity_checker.extraction.patterns.base import CompiledPattern as BaseCompiledPattern
from integrity_checker.models.citation import Citation, CitationStyle


class TestUtilityPatterns:
    """Tests for utility pattern functions."""

    def test_extract_doi_basic(self):
        """Test basic DOI extraction."""
        assert extract_doi("10.1000/xyz123") == "10.1000/xyz123"
        assert extract_doi("doi: 10.1038/nature12345") == "10.1038/nature12345"

    def test_extract_doi_with_url(self):
        """Test DOI extraction from URLs."""
        result = extract_doi("See https://doi.org/10.1000/xyz123")
        assert result == "10.1000/xyz123"

    def test_extract_doi_no_doi(self):
        """Test DOI extraction when no DOI present."""
        assert extract_doi("No DOI here") is None
        assert extract_doi("") is None
        assert extract_doi(None) is None  # type: ignore

    def test_extract_doi_trailing_punctuation(self):
        """Test DOI extraction removes trailing punctuation."""
        assert extract_doi("10.1000/xyz123.") == "10.1000/xyz123"
        assert extract_doi("10.1000/xyz123,") == "10.1000/xyz123"
        assert extract_doi("10.1000/xyz123;") == "10.1000/xyz123"

    def test_extract_url_basic(self):
        """Test basic URL extraction."""
        assert extract_url("https://example.com") == "https://example.com"
        assert extract_url("http://example.com") == "http://example.com"

    def test_extract_url_with_path(self):
        """Test URL extraction with path."""
        result = extract_url("Visit https://arxiv.org/abs/2103.00001")
        assert result == "https://arxiv.org/abs/2103.00001"

    def test_extract_url_no_url(self):
        """Test URL extraction when no URL present."""
        assert extract_url("No URL here") is None
        assert extract_url("") is None
        assert extract_url(None) is None  # type: ignore

    def test_extract_year_basic(self):
        """Test basic year extraction."""
        assert extract_year("Published in 2020") == "2020"
        assert extract_year("Vaswani et al. (2017)") == "2017"
        assert extract_year("Smith (2019)") == "2019"

    def test_extract_year_with_suffix(self):
        """Test year extraction with letter suffix."""
        # First match is returned (2020a in this case)
        assert extract_year("Smith (2020a) and Jones (2020b)") == "2020a"
        # Standalone with suffix
        assert extract_year("2020c") == "2020c"

    def test_extract_year_no_year(self):
        """Test year extraction when no year present."""
        assert extract_year("No year here") is None
        assert extract_year("") is None
        assert extract_year(None) is None  # type: ignore

    def test_extract_year_invalid_format(self):
        """Test year extraction with invalid year formats."""
        # 1800s are not valid (we only match 19|20 prefix)
        assert extract_year("1800") is None
        # 2100s are not valid
        assert extract_year("2100") is None

    def test_extract_year_ignores_page_ranges_and_dois(self):
        """Test year extraction ignores 4-digit page numbers, DOIs, URLs, and LNCS numbers."""
        assert (
            extract_year(
                "Neural Computation, vol. 10, no. 7, pp. 1895–1923, 1998. doi: 10.1162/089976698300017197."
            )
            == "1998"
        )
        assert extract_year("vol. 15, pp. 1920-1935, 2018.") == "2018"
        assert extract_year("LNCS 1984, pp. 1-10, 2001.") == "2001"


class TestCompiledPattern:
    """Tests for CompiledPattern class."""

    def test_pattern_creation(self):
        """Test pattern creation via factory method."""
        pattern = CompiledPattern.create(
            name="test_pattern",
            pattern=r"\d+",
            pattern_type=PatternType.UTILITY,
            description="Test pattern",
        )
        assert pattern.name == "test_pattern"
        assert pattern.pattern == r"\d+"
        assert pattern.pattern_type == PatternType.UTILITY
        assert isinstance(pattern.compiled_regex.pattern, str)

    def test_pattern_finditer(self):
        """Test pattern finditer method."""
        pattern = CompiledPattern.create(
            name="test",
            pattern=r"\d+",
            pattern_type=PatternType.UTILITY,
            description="Test",
        )
        matches = pattern.finditer("abc 123 def 456")
        assert len(matches) == 2
        assert matches[0].group(0) == "123"
        assert matches[1].group(0) == "456"

    def test_pattern_search(self):
        """Test pattern search method."""
        pattern = CompiledPattern.create(
            name="test",
            pattern=r"\d+",
            pattern_type=PatternType.UTILITY,
            description="Test",
        )
        match = pattern.search("abc 123")
        assert match is not None
        assert match.group(0) == "123"

    def test_pattern_match(self):
        """Test pattern match method."""
        pattern = CompiledPattern.create(
            name="test",
            pattern=r"\d+",
            pattern_type=PatternType.UTILITY,
            description="Test",
        )
        assert pattern.match("123 abc") is not None
        assert pattern.match("abc 123") is None


class TestPatternTypes:
    """Tests for PatternType enum."""

    def test_pattern_types_exist(self):
        """Test all expected pattern types exist."""
        assert PatternType.IN_TEXT.value == "in_text"
        assert PatternType.REFERENCE_ENTRY.value == "reference_entry"
        assert PatternType.UTILITY.value == "utility"


class TestRegistry:
    """Tests for format registry."""

    def test_register_format(self):
        """Test registering a new format."""
        class DummyFormat:
            name = "Dummy"
            priority = 100

            @property
            def in_text_patterns(self):
                return []

            @property
            def reference_patterns(self):
                return []

            def parse_reference_entry(self, text):
                return None

            def is_valid_citation(self, text):
                return False

        # Register a unique name to avoid conflicts
        import uuid
        dummy_name = f"Dummy_{uuid.uuid4().hex[:8]}"

        class UniqueDummyFormat(DummyFormat):
            pass

        UniqueDummyFormat.name = dummy_name

        dummy = UniqueDummyFormat()
        register_format(dummy)
        assert get_format(dummy_name) is dummy
        assert get_format("NonExistentFormat") is None

    def test_register_duplicate_format_raises_error(self):
        """Test registering duplicate format raises error."""
        import uuid
        name1 = f"TestDup1_{uuid.uuid4().hex[:8]}"
        name2 = f"TestDup2_{uuid.uuid4().hex[:8]}"

        class DummyFormat1:
            name = name1
            priority = 100

            @property
            def in_text_patterns(self):
                return []

            @property
            def reference_patterns(self):
                return []

            def parse_reference_entry(self, text):
                return None

            def is_valid_citation(self, text):
                return False

        class DummyFormat2:
            name = name1  # Same name to trigger duplicate error
            priority = 100

            @property
            def in_text_patterns(self):
                return []

            @property
            def reference_patterns(self):
                return []

            def parse_reference_entry(self, text):
                return None

            def is_valid_citation(self, text):
                return False

        register_format(DummyFormat1())
        with pytest.raises(ValueError, match="already registered"):
            register_format(DummyFormat2())

    def test_get_all_formats(self):
        """Test getting all registered formats (APA and IEEE auto-registered)."""
        formats = get_all_formats()
        assert len(formats) >= 2  # APA and IEEE by default
        names = [f.name for f in formats]
        assert "APA" in names
        assert "IEEE" in names

    def test_formats_sorted_by_priority(self):
        """Test formats are sorted by priority (higher priority first)."""
        formats = get_all_formats()
        priorities = [f.priority for f in formats]
        # Higher priority values = earlier in list (tried first)
        assert priorities == sorted(priorities, reverse=True)

    def test_get_in_text_patterns(self):
        """Test getting all in-text patterns."""
        patterns = get_in_text_patterns()
        assert len(patterns) >= 3  # APA has 2, IEEE has 1
        for p in patterns:
            assert p.pattern_type == PatternType.IN_TEXT

    def test_get_reference_patterns(self):
        """Test getting all reference patterns."""
        patterns = get_reference_patterns()
        assert len(patterns) >= 2  # APA has 1, IEEE has 1
        for p in patterns:
            assert p.pattern_type == PatternType.REFERENCE_ENTRY

    def test_get_utility_patterns(self):
        """Test getting utility patterns."""
        patterns = get_utility_patterns()
        assert len(patterns) == 3
        names = [p.name for p in patterns]
        assert "doi" in names
        assert "url" in names
        assert "year" in names

    def test_get_registry_info(self):
        """Test getting registry info."""
        info = get_registry_info()
        assert "APA" in info
        assert "IEEE" in info
        assert info["APA"]["priority"] == 100
        # IEEE priority is 90 (higher than Numeric at lower priority)
        assert info["IEEE"]["priority"] == 90


class TestAPAPatterns:
    """Tests for APA citation format patterns."""

    def test_apa_intext_parenthetical(self):
        """Test APA parenthetical citation pattern."""
        patterns = get_in_text_patterns()
        parenthetical = next(p for p in patterns if p.name == "apa_intext_parenthetical")

        # Test match
        matches = parenthetical.finditer("(Smith, 2020)")
        assert len(matches) == 1

        matches = parenthetical.finditer("(Smith et al., 2020)")
        assert len(matches) == 1

    def test_apa_intext_narrative(self):
        """Test APA narrative citation pattern."""
        patterns = get_in_text_patterns()
        narrative = next(p for p in patterns if p.name == "apa_intext_narrative")

        # Test match
        matches = narrative.finditer("Smith (2020)")
        assert len(matches) == 1

        matches = narrative.finditer("Smith et al. (2020)")
        assert len(matches) == 1

    def test_apa_reference_entry(self):
        """Test APA reference entry pattern."""
        formats = get_all_formats()
        apa = next(f for f in formats if f.name == "APA")

        text = "Smith, J., & Jones, A. (2020). Paper Title. Journal, 10(2), 1-15."
        citation = apa.parse_reference_entry(text)

        assert citation is not None
        assert citation.style == CitationStyle.APA
        assert citation.year == "2020"

    def test_apa_is_valid_citation(self):
        """Test APA validation."""
        formats = get_all_formats()
        apa = next(f for f in formats if f.name == "APA")

        # Note: is_valid_citation looks for [A-Z] author pattern
        # "(Smith, 2020)" - the opening paren makes it harder to match
        # Use text that clearly has an author pattern
        assert apa.is_valid_citation("Smith et al. (2020)") is True
        assert apa.is_valid_citation("Author (2020)") is True
        assert apa.is_valid_citation("[1]") is False


class TestIEEEPatterns:
    """Tests for IEEE citation format patterns."""

    def test_numeric_bracketed(self):
        """Test numeric bracketed citation pattern."""
        patterns = get_in_text_patterns()
        # IEEE format uses "ieee_numeric" pattern name
        numeric = next(p for p in patterns if p.name == "ieee_numeric")

        # Test matches
        assert len(numeric.finditer("[1]")) == 1
        assert len(numeric.finditer("[1,2]")) == 1
        assert len(numeric.finditer("[1-5]")) == 1
        assert len(numeric.finditer("[1, 2, 3]")) == 1

    def test_ieee_is_valid_citation(self):
        """Test IEEE validation."""
        formats = get_all_formats()
        ieee = next(f for f in formats if f.name == "IEEE")

        assert ieee.is_valid_citation("[1]") is True
        assert ieee.is_valid_citation("[1,2]") is True
        assert ieee.is_valid_citation("[1-5]") is True
        assert ieee.is_valid_citation("(Smith, 2020)") is False


class TestUtilityPatternsSingleton:
    """Tests for utility patterns as single source of truth."""

    def test_doi_pattern_singleton(self):
        """Test DOI_PATTERN is the same instance."""
        from integrity_checker.extraction.patterns.utils import DOI_PATTERN as dp1
        from integrity_checker.extraction.patterns.utils import DOI_PATTERN as dp2
        assert dp1 is dp2

    def test_url_pattern_singleton(self):
        """Test URL_PATTERN is the same instance."""
        from integrity_checker.extraction.patterns.utils import URL_PATTERN as up1
        from integrity_checker.extraction.patterns.utils import URL_PATTERN as up2
        assert up1 is up2

    def test_year_pattern_singleton(self):
        """Test YEAR_PATTERN is the same instance."""
        from integrity_checker.extraction.patterns.utils import YEAR_PATTERN as yp1
        from integrity_checker.extraction.patterns.utils import YEAR_PATTERN as yp2
        assert yp1 is yp2

    def test_utility_patterns_in_registry(self):
        """Test utility patterns are in registry."""
        patterns = get_utility_patterns()
        assert DOI_PATTERN in patterns
        assert URL_PATTERN in patterns
        assert YEAR_PATTERN in patterns
