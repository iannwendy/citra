"""Unit tests for ExplanationGenerator — Task 1.2."""

from dataclasses import dataclass, field

import pytest

from integrity_checker.linking.statuses import CitationMappingStatus
from integrity_checker.logic.explanation import ExplanationGenerator
from integrity_checker.models.source import SourceCandidate, SourceResult
from integrity_checker.models.validation import CitationVerdict, MatchFeatures, ValidationLabel

# =============================================================================
# Fixtures
# =============================================================================

@pytest.fixture
def sample_citation():
    """Sample Citation object for testing."""
    from integrity_checker.models.citation import Citation
    return Citation(
        raw_text="Smith et al. (2020)",
        page_num=5,
        paragraph_num=1,
        citation_type="in_text",
        authors=["Smith"],
        year="2020",
    )


@pytest.fixture
def sample_features():
    """Sample MatchFeatures for testing."""
    return MatchFeatures(
        title_sim_fuzzy=0.85,
        title_sim_semantic=0.78,
        author_jaccard=1.0,
        year_distance=0,
        doi_exact_match=False,
        source_consensus=2,
    )


@pytest.fixture
def sample_source_result():
    """Sample SourceResult for testing."""
    candidate = SourceCandidate(
        source_name="Crossref",
        found=True,
        title="Deep Learning for Computer Vision",
        authors=["Smith, J.", "Doe, A."],
        year="2020",
        venue="Journal of AI",
        doi="10.1234/test.5678",
        confidence=0.92,
    )
    return SourceResult(
        citation_raw="Smith et al. (2020)",
        candidates=[candidate],
        sources_queried=["Crossref", "OpenAlex"],
        sources_succeeded=["Crossref"],
        sources_failed={},
    )


# =============================================================================
# Test: LABEL_VI translations
# =============================================================================

class TestLabelTranslations:
    """Test ValidationLabel Vietnamese translations."""

    def test_label_vi_all_labels(self):
        """All 4 ValidationLabels have Vietnamese translations."""
        assert ValidationLabel.VERIFIED in ExplanationGenerator.LABEL_VI
        assert ValidationLabel.METADATA_ERROR in ExplanationGenerator.LABEL_VI
        assert ValidationLabel.SUSPECTED_HALLUCINATION in ExplanationGenerator.LABEL_VI
        assert ValidationLabel.UNRESOLVED in ExplanationGenerator.LABEL_VI

    def test_label_vi_long_all_labels(self):
        """All 4 ValidationLabels have long Vietnamese translations."""
        assert ValidationLabel.VERIFIED in ExplanationGenerator.LABEL_VI_LONG
        assert ValidationLabel.METADATA_ERROR in ExplanationGenerator.LABEL_VI_LONG
        assert ValidationLabel.SUSPECTED_HALLUCINATION in ExplanationGenerator.LABEL_VI_LONG
        assert ValidationLabel.UNRESOLVED in ExplanationGenerator.LABEL_VI_LONG


# =============================================================================
# Test: MAPPING_VI translations
# =============================================================================

class TestMappingTranslations:
    """Test CitationMappingStatus Vietnamese translations."""

    def test_mapping_vi_all_statuses(self):
        """All 8 CitationMappingStatuses have Vietnamese translations."""
        for status in CitationMappingStatus:
            assert status.value in ExplanationGenerator.MAPPING_VI
            assert status.value in ExplanationGenerator.MAPPING_VI_LONG

    def test_mapping_vi_values(self):
        """Verify specific mapping translations."""
        assert ExplanationGenerator.MAPPING_VI["matched"] == "khớp"
        assert ExplanationGenerator.MAPPING_VI["missing_reference"] == "thiếu reference"
        assert ExplanationGenerator.MAPPING_VI["uncited_reference"] == "reference không được trích"
        assert ExplanationGenerator.MAPPING_VI_LONG["matched"] == "In-text và reference entry khớp nhau"


# =============================================================================
# Test: short() method
# =============================================================================

class TestShort:
    """Test short() method."""

    def test_short_verified(self, sample_citation):
        """VERIFIED verdict returns short message with confidence."""
        verdict = CitationVerdict(
            citation=sample_citation,
            label=ValidationLabel.VERIFIED,
            confidence=0.92,
        )
        result = ExplanationGenerator.short(verdict)
        assert "Nguồn được xác minh" in result
        assert "92%" in result

    def test_short_metadata_error(self, sample_citation):
        """METADATA_ERROR verdict returns short message."""
        verdict = CitationVerdict(
            citation=sample_citation,
            label=ValidationLabel.METADATA_ERROR,
            confidence=0.75,
        )
        result = ExplanationGenerator.short(verdict)
        assert "Nguồn có lỗi metadata" in result
        assert "75%" in result

    def test_short_suspected_hallucination(self, sample_citation):
        """SUSPECTED_HALLUCINATION verdict returns short message."""
        verdict = CitationVerdict(
            citation=sample_citation,
            label=ValidationLabel.SUSPECTED_HALLUCINATION,
            confidence=0.15,
        )
        result = ExplanationGenerator.short(verdict)
        assert "Nghi ngờ ảo giác nguồn" in result
        assert "15%" in result

    def test_short_unresolved(self, sample_citation):
        """UNRESOLVED verdict returns short message."""
        verdict = CitationVerdict(
            citation=sample_citation,
            label=ValidationLabel.UNRESOLVED,
            confidence=0.50,
        )
        result = ExplanationGenerator.short(verdict)
        assert "Chưa đủ bằng chứng" in result
        assert "50%" in result

    def test_short_with_mapping_status(self, sample_citation):
        """Short includes mapping status when present."""
        verdict = CitationVerdict(
            citation=sample_citation,
            label=ValidationLabel.VERIFIED,
            confidence=0.92,
            mapping_status=CitationMappingStatus.MATCHED,
            mapping_confidence=0.95,
        )
        result = ExplanationGenerator.short(verdict)
        assert "khớp" in result


# =============================================================================
# Test: _default_reasoning() method
# =============================================================================

class TestDefaultReasoning:
    """Test _default_reasoning() method."""

    def test_reasoning_verified(self, sample_citation):
        """VERIFIED generates correct reasoning."""
        verdict = CitationVerdict(
            citation=sample_citation,
            label=ValidationLabel.VERIFIED,
            confidence=0.92,
        )
        reasoning = ExplanationGenerator._default_reasoning(verdict)
        assert "tồn tại" in reasoning.lower() or "khớp" in reasoning.lower()

    def test_reasoning_metadata_error(self, sample_citation):
        """METADATA_ERROR generates reasoning about mismatched fields."""
        verdict = CitationVerdict(
            citation=sample_citation,
            label=ValidationLabel.METADATA_ERROR,
            confidence=0.75,
            mismatched_fields=["year", "venue"],
        )
        reasoning = ExplanationGenerator._default_reasoning(verdict)
        assert "year" in reasoning.lower() or "metadata" in reasoning.lower()

    def test_reasoning_suspected_hallucination(self, sample_citation):
        """SUSPECTED_HALLUCINATION generates reasoning about not found."""
        verdict = CitationVerdict(
            citation=sample_citation,
            label=ValidationLabel.SUSPECTED_HALLUCINATION,
            confidence=0.15,
            matched_source=SourceResult(
                citation_raw="Smith et al. (2020)",
                sources_queried=["Crossref", "OpenAlex", "Semantic Scholar"],
                sources_succeeded=[],
            ),
        )
        reasoning = ExplanationGenerator._default_reasoning(verdict)
        assert "không tìm thấy" in reasoning.lower() or "Crossref" in reasoning

    def test_reasoning_unresolved_with_failed_sources(
        self, sample_citation
    ):
        """UNRESOLVED with failed sources generates appropriate reasoning."""
        verdict = CitationVerdict(
            citation=sample_citation,
            label=ValidationLabel.UNRESOLVED,
            confidence=0.50,
            matched_source=SourceResult(
                citation_raw="Smith et al. (2020)",
                sources_queried=["Crossref", "OpenAlex"],
                sources_succeeded=[],
                sources_failed={"Crossref": "timeout", "OpenAlex": "rate limit"},
            ),
        )
        reasoning = ExplanationGenerator._default_reasoning(verdict)
        assert "Crossref" in reasoning or "không phản hồi" in reasoning.lower()


# =============================================================================
# Test: detailed() method
# =============================================================================

class TestDetailed:
    """Test detailed() method."""

    def test_detailed_basic_structure(self, sample_citation):
        """detailed() returns multi-line string with proper sections."""
        verdict = CitationVerdict(
            citation=sample_citation,
            label=ValidationLabel.VERIFIED,
            confidence=0.92,
            reasoning="Nguồn tồn tại trên Crossref.",
        )
        result = ExplanationGenerator.detailed(verdict)

        assert "Nhãn:" in result
        assert "Lý do:" in result
        assert "Bằng chứng:" in result
        assert "Nguồn:" in result
        assert "\n" in result  # Multi-line

    def test_detailed_with_features(
        self, sample_citation, sample_features
    ):
        """detailed() includes feature scores in evidence."""
        verdict = CitationVerdict(
            citation=sample_citation,
            label=ValidationLabel.VERIFIED,
            confidence=0.92,
            features=sample_features,
            triggered_rules=["R-VERIFIED"],
        )
        result = ExplanationGenerator.detailed(verdict)

        assert "title_sim=" in result
        assert "author_match=" in result
        assert "R-VERIFIED" in result

    def test_detailed_with_matched_source(
        self, sample_citation, sample_source_result
    ):
        """detailed() includes matched source info."""
        verdict = CitationVerdict(
            citation=sample_citation,
            label=ValidationLabel.VERIFIED,
            confidence=0.92,
            matched_source=sample_source_result,
        )
        result = ExplanationGenerator.detailed(verdict)

        assert "Crossref" in result
        assert "Deep Learning" in result

    def test_detailed_with_mapping_status(
        self, sample_citation, sample_features
    ):
        """detailed() includes mapping status when present."""
        verdict = CitationVerdict(
            citation=sample_citation,
            label=ValidationLabel.VERIFIED,
            confidence=0.92,
            mapping_status=CitationMappingStatus.MATCHED,
            mapping_confidence=0.95,
            features=sample_features,
        )
        result = ExplanationGenerator.detailed(verdict)

        assert "Mapping:" in result


# =============================================================================
# Test: suggestions() method
# =============================================================================

class TestSuggestions:
    """Test suggestions() method."""

    def test_suggestions_verified(self, sample_citation):
        """VERIFIED returns suggestion to not act."""
        verdict = CitationVerdict(
            citation=sample_citation,
            label=ValidationLabel.VERIFIED,
            confidence=0.92,
        )
        suggestions = ExplanationGenerator.suggestions(verdict)
        assert len(suggestions) > 0
        assert any("không cần" in s.lower() for s in suggestions)

    def test_suggestions_metadata_error(self, sample_citation):
        """METADATA_ERROR returns suggestions about checking fields."""
        verdict = CitationVerdict(
            citation=sample_citation,
            label=ValidationLabel.METADATA_ERROR,
            confidence=0.75,
        )
        suggestions = ExplanationGenerator.suggestions(verdict)
        assert len(suggestions) > 0
        assert any("kiểm tra" in s.lower() for s in suggestions)

    def test_suggestions_suspected_hallucination(self, sample_citation):
        """SUSPECTED_HALLUCINATION returns suggestions about manual check."""
        verdict = CitationVerdict(
            citation=sample_citation,
            label=ValidationLabel.SUSPECTED_HALLUCINATION,
            confidence=0.15,
        )
        suggestions = ExplanationGenerator.suggestions(verdict)
        assert len(suggestions) > 0
        assert any("thủ công" in s.lower() or "kiểm tra" in s.lower() for s in suggestions)

    def test_suggestions_unresolved(self, sample_citation):
        """UNRESOLVED returns suggestions about retry."""
        verdict = CitationVerdict(
            citation=sample_citation,
            label=ValidationLabel.UNRESOLVED,
            confidence=0.50,
        )
        suggestions = ExplanationGenerator.suggestions(verdict)
        assert len(suggestions) > 0
        assert any("thử lại" in s.lower() or "chưa đủ" in s.lower() for s in suggestions)

    def test_suggestions_with_mapping_status(self, sample_citation):
        """Suggestions include both source and mapping suggestions."""
        verdict = CitationVerdict(
            citation=sample_citation,
            label=ValidationLabel.VERIFIED,
            confidence=0.92,
            mapping_status=CitationMappingStatus.MISSING_REFERENCE,
        )
        suggestions = ExplanationGenerator.suggestions(verdict)
        # Should have both source and mapping suggestions
        assert len(suggestions) >= 2

    def test_suggestions_missing_reference_mapping(self, sample_citation):
        """MISSING_REFERENCE mapping suggests adding reference."""
        verdict = CitationVerdict(
            citation=sample_citation,
            label=ValidationLabel.VERIFIED,
            confidence=0.92,
            mapping_status=CitationMappingStatus.MISSING_REFERENCE,
        )
        suggestions = ExplanationGenerator.suggestions(verdict)
        assert any("bổ sung" in s.lower() for s in suggestions)


# =============================================================================
# Test: structured() method
# =============================================================================

class TestStructured:
    """Test structured() method for UI consumption."""

    def test_structured_basic_fields(
        self, sample_citation, sample_features
    ):
        """structured() returns all required fields."""
        verdict = CitationVerdict(
            citation=sample_citation,
            label=ValidationLabel.VERIFIED,
            confidence=0.92,
            features=sample_features,
        )
        result = ExplanationGenerator.structured(verdict)

        # Check top-level fields
        assert "label" in result
        assert "label_vi" in result
        assert "label_color" in result
        assert "mapping_status" in result
        assert "mapping_status_vi" in result
        assert "confidence" in result
        assert "reasoning" in result
        assert "evidence" in result
        assert "source_info" in result
        assert "suggestions" in result
        assert "formatted" in result

    def test_structured_label_values(
        self, sample_citation, sample_features
    ):
        """structured() returns correct label values."""
        verdict = CitationVerdict(
            citation=sample_citation,
            label=ValidationLabel.SUSPECTED_HALLUCINATION,
            confidence=0.15,
            features=sample_features,
        )
        result = ExplanationGenerator.structured(verdict)

        assert result["label"] == "suspected_hallucination"
        assert "Nghi ngờ ảo giác" in result["label_vi"]
        assert "#dc2626" in result["label_color"]  # Red for suspected

    def test_structured_mapping_values(
        self, sample_citation, sample_features
    ):
        """structured() returns correct mapping values."""
        verdict = CitationVerdict(
            citation=sample_citation,
            label=ValidationLabel.VERIFIED,
            confidence=0.92,
            mapping_status=CitationMappingStatus.MISSING_REFERENCE,
            mapping_confidence=0.80,
            features=sample_features,
        )
        result = ExplanationGenerator.structured(verdict)

        assert result["mapping_status"] == "missing_reference"
        assert "In-text không có reference" in result["mapping_status_vi"]
        assert "#dc2626" in result["mapping_color"]  # Red for missing
        assert result["mapping_confidence"] == 0.80

    def test_structured_evidence(
        self, sample_citation, sample_features
    ):
        """structured() includes all evidence fields."""
        verdict = CitationVerdict(
            citation=sample_citation,
            label=ValidationLabel.VERIFIED,
            confidence=0.92,
            features=sample_features,
            triggered_rules=["R-VERIFIED", "R-CONSENSUS"],
            mismatched_fields=["year"],
        )
        result = ExplanationGenerator.structured(verdict)

        evidence = result["evidence"]
        assert evidence["title_sim_fuzzy"] == 0.85
        assert evidence["author_jaccard"] == 1.0
        assert evidence["source_consensus"] == 2
        assert "R-VERIFIED" in evidence["triggered_rules"]
        assert "year" in evidence["mismatched_fields"]

    def test_structured_formatted(
        self, sample_citation, sample_features
    ):
        """structured() includes formatted short and detailed."""
        verdict = CitationVerdict(
            citation=sample_citation,
            label=ValidationLabel.VERIFIED,
            confidence=0.92,
            features=sample_features,
        )
        result = ExplanationGenerator.structured(verdict)

        assert "short" in result["formatted"]
        assert "detailed" in result["formatted"]
        assert "Nguồn được xác minh" in result["formatted"]["short"]
        assert "Nhãn:" in result["formatted"]["detailed"]


# =============================================================================
# Test: Edge cases
# =============================================================================

class TestEdgeCases:
    """Test edge cases and error handling."""

    def test_empty_verdict(self, sample_citation):
        """Verdict with minimal fields still generates output."""
        verdict = CitationVerdict(
            citation=sample_citation,
            label=ValidationLabel.UNRESOLVED,
            confidence=0.0,
        )

        # All methods should handle empty verdict gracefully
        assert ExplanationGenerator.short(verdict)
        assert ExplanationGenerator.detailed(verdict)
        assert isinstance(ExplanationGenerator.suggestions(verdict), list)
        assert isinstance(ExplanationGenerator.structured(verdict), dict)

    def test_none_matched_source(self, sample_citation):
        """Verdict with None matched_source handles gracefully."""
        verdict = CitationVerdict(
            citation=sample_citation,
            label=ValidationLabel.SUSPECTED_HALLUCINATION,
            confidence=0.15,
            matched_source=None,
        )

        # Should not raise
        detailed = ExplanationGenerator.detailed(verdict)
        assert "Nguồn: Không có candidate" in detailed

    def test_empty_source_result(self, sample_citation):
        """Verdict with empty SourceResult handles gracefully."""
        verdict = CitationVerdict(
            citation=sample_citation,
            label=ValidationLabel.UNRESOLVED,
            confidence=0.50,
            matched_source=SourceResult(
                citation_raw="Smith et al. (2020)",
                sources_queried=[],
                sources_succeeded=[],
            ),
        )

        # Should not raise
        source_info = ExplanationGenerator._get_matched_source_info(verdict)
        assert "Không tìm thấy candidate" in source_info

    def test_long_title_in_source(self, sample_citation):
        """Long titles are truncated in output."""
        long_title = "A" * 100
        candidate = SourceCandidate(
            source_name="Crossref",
            found=True,
            title=long_title,
            confidence=0.92,
        )
        source_result = SourceResult(
            citation_raw="Smith et al. (2020)",
            candidates=[candidate],
            sources_queried=["Crossref"],
            sources_succeeded=["Crossref"],
        )
        verdict = CitationVerdict(
            citation=sample_citation,
            label=ValidationLabel.VERIFIED,
            confidence=0.92,
            matched_source=source_result,
        )

        source_info = ExplanationGenerator._get_matched_source_info(verdict)
        # Should be truncated with "..."
        assert len(source_info) <= 100 or "..." in source_info

    def test_mapping_status_string_value(self, sample_citation):
        """Mapping status as string (not enum) is handled."""
        # Simulate deserialization scenario where status is a string
        verdict = CitationVerdict(
            citation=sample_citation,
            label=ValidationLabel.VERIFIED,
            confidence=0.92,
            mapping_status="matched",  # String instead of enum
            mapping_confidence=0.95,
        )

        # Should not raise
        short = ExplanationGenerator.short(verdict)
        assert "khớp" in short


# =============================================================================
# Test: Source Suggestions
# =============================================================================

class TestSourceSuggestions:
    """Test SOURCE_SUGGESTIONS dict."""

    def test_all_labels_have_suggestions(self):
        """All ValidationLabels have suggestions."""
        for label in ValidationLabel:
            assert label in ExplanationGenerator.SOURCE_SUGGESTIONS
            assert len(ExplanationGenerator.SOURCE_SUGGESTIONS[label]) > 0

    def test_verified_suggestions_appropriate(self):
        """VERIFIED suggestions are appropriate (no action needed)."""
        suggestions = ExplanationGenerator.SOURCE_SUGGESTIONS[
            ValidationLabel.VERIFIED
        ]
        assert any("không cần" in s.lower() for s in suggestions)

    def test_suspected_hallucination_suggestions_appropriate(self):
        """SUSPECTED_HALLUCINATION suggestions suggest manual check."""
        suggestions = ExplanationGenerator.SOURCE_SUGGESTIONS[
            ValidationLabel.SUSPECTED_HALLUCINATION
        ]
        assert any("thủ công" in s.lower() for s in suggestions)
        assert any("DOI" in s or "URL" in s for s in suggestions)


# =============================================================================
# Test: Mapping Suggestions
# =============================================================================

class TestMappingSuggestions:
    """Test MAPPING_SUGGESTIONS dict."""

    def test_all_statuses_have_suggestions(self):
        """All CitationMappingStatuses have suggestions."""
        for status in CitationMappingStatus:
            assert status.value in ExplanationGenerator.MAPPING_SUGGESTIONS
            assert len(ExplanationGenerator.MAPPING_SUGGESTIONS[status.value]) > 0

    def test_missing_reference_suggestions(self):
        """MISSING_REFERENCE suggests adding reference."""
        suggestions = ExplanationGenerator.MAPPING_SUGGESTIONS[
            CitationMappingStatus.MISSING_REFERENCE.value
        ]
        assert any("bổ sung" in s.lower() for s in suggestions)

    def test_uncited_reference_suggestions(self):
        """UNCITED_REFERENCE suggests checking usage."""
        suggestions = ExplanationGenerator.MAPPING_SUGGESTIONS[
            CitationMappingStatus.UNCITED_REFERENCE.value
        ]
        assert any("kiểm tra" in s.lower() or "sử dụng" in s.lower() for s in suggestions)

    def test_duplicate_reference_suggestions(self):
        """DUPLICATE_REFERENCE suggests merging."""
        suggestions = ExplanationGenerator.MAPPING_SUGGESTIONS[
            CitationMappingStatus.DUPLICATE_REFERENCE.value
        ]
        assert any("gộp" in s.lower() for s in suggestions)


# =============================================================================
# Integration test with CitationVerdict
# =============================================================================

class TestIntegration:
    """Integration tests with full CitationVerdict objects."""

    def test_full_verified_with_all_fields(
        self, sample_citation, sample_features, sample_source_result
    ):
        """Test VERIFIED verdict with all fields populated."""
        verdict = CitationVerdict(
            citation=sample_citation,
            label=ValidationLabel.VERIFIED,
            confidence=0.92,
            mapping_status=CitationMappingStatus.MATCHED,
            mapping_confidence=0.95,
            matched_source=sample_source_result,
            features=sample_features,
            reasoning="Nguồn khớp trên Crossref.",
            triggered_rules=["R-VERIFIED", "R-CONSENSUS"],
            mismatched_fields=[],
        )

        # All methods should work
        short = ExplanationGenerator.short(verdict)
        assert "xác minh" in short.lower() or "khớp" in short.lower()

        detailed = ExplanationGenerator.detailed(verdict)
        assert "Crossref" in detailed
        assert "confidence" in detailed.lower()

        suggestions = ExplanationGenerator.suggestions(verdict)
        assert len(suggestions) >= 2  # Both source and mapping

        structured = ExplanationGenerator.structured(verdict)
        assert structured["confidence"] == 0.92
        assert structured["mapping_status"] == "matched"
        assert len(structured["evidence"]) > 0

    def test_full_suspected_hallucination_scenario(
        self, sample_citation
    ):
        """Test realistic SUSPECTED_HALLUCINATION verdict."""
        verdict = CitationVerdict(
            citation=sample_citation,
            label=ValidationLabel.SUSPECTED_HALLUCINATION,
            confidence=0.10,
            mapping_status=CitationMappingStatus.MATCHED,
            mapping_confidence=0.88,
            matched_source=SourceResult(
                citation_raw="Smith et al. (2020)",
                sources_queried=["Crossref", "OpenAlex", "Semantic Scholar", "arXiv"],
                sources_succeeded=[],
                sources_failed={
                    "Crossref": "not found",
                    "OpenAlex": "not found",
                    "Semantic Scholar": "not found",
                    "arXiv": "not found",
                },
            ),
            features=MatchFeatures(
                title_sim_fuzzy=0.15,
                author_jaccard=0.0,
                source_consensus=0,
            ),
            reasoning="",
            triggered_rules=["R-NOT-FOUND", "R-LOW-CONSENSUS"],
        )

        short = ExplanationGenerator.short(verdict)
        assert "ảo giác" in short.lower()

        detailed = ExplanationGenerator.detailed(verdict)
        assert "không tìm thấy" in detailed.lower()

        structured = ExplanationGenerator.structured(verdict)
        assert structured["label_color"] == "#dc2626"  # Red

    def test_full_metadata_error_scenario(self, sample_citation):
        """Test realistic METADATA_ERROR verdict."""
        verdict = CitationVerdict(
            citation=sample_citation,
            label=ValidationLabel.METADATA_ERROR,
            confidence=0.68,
            mapping_status=CitationMappingStatus.MATCHED,
            mapping_confidence=0.92,
            matched_source=SourceResult(
                citation_raw="Smith et al. (2020)",
                sources_queried=["Crossref"],
                sources_succeeded=["Crossref"],
                candidates=[
                    SourceCandidate(
                        source_name="Crossref",
                        found=True,
                        title="Deep Learning for Computer Vision",
                        authors=["Smith, J."],
                        year="2019",  # Different year
                        venue="Journal of AI",
                        confidence=0.88,
                    )
                ],
            ),
            features=MatchFeatures(
                title_sim_fuzzy=0.82,
                author_jaccard=1.0,
                year_distance=1,
                source_consensus=1,
            ),
            reasoning="",
            triggered_rules=["R-METADATA-MISMATCH"],
            mismatched_fields=["year"],
        )

        structured = ExplanationGenerator.structured(verdict)
        assert "year" in str(structured["evidence"]["mismatched_fields"])

        suggestions = ExplanationGenerator.suggestions(verdict)
        assert any("kiểm tra" in s.lower() for s in suggestions)
