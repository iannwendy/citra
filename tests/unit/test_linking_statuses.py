"""Unit tests cho linking/statuses.py — CitationMappingStatus enum (v1.2 §3.5)."""

from __future__ import annotations

from integrity_checker.linking.statuses import (
    MAPPING_PENALTIES,
    CitationMappingStatus,
    LinkingResult,
)


class TestCitationMappingStatus:
    """Test enum có đúng 8 trạng thái."""

    def test_all_8_statuses_present(self):
        assert len(CitationMappingStatus) == 8

    def test_status_values(self):
        values = [s.value for s in CitationMappingStatus]
        assert "matched" in values
        assert "missing_reference" in values
        assert "uncited_reference" in values
        assert "in_text_mismatch" in values
        assert "duplicate_reference" in values
        assert "ambiguous_mapping" in values
        assert "style_inconsistent" in values
        assert "unresolved" in values

    def test_is_integrity_issue(self):
        issues = [
            CitationMappingStatus.MISSING_REFERENCE,
            CitationMappingStatus.UNCITED_REFERENCE,
            CitationMappingStatus.IN_TEXT_MISMATCH,
            CitationMappingStatus.DUPLICATE_REFERENCE,
            CitationMappingStatus.AMBIGUOUS_MAPPING,
            CitationMappingStatus.STYLE_INCONSISTENT,
        ]
        for s in issues:
            assert s.is_integrity_issue is True, f"{s} should be issue"
        assert CitationMappingStatus.MATCHED.is_integrity_issue is False
        assert CitationMappingStatus.UNRESOLVED.is_integrity_issue is False

    def test_is_verified(self):
        assert CitationMappingStatus.MATCHED.is_verified is True
        for s in CitationMappingStatus:
            if s != CitationMappingStatus.MATCHED:
                assert s.is_verified is False

    def test_is_neutral(self):
        assert CitationMappingStatus.UNRESOLVED.is_neutral is True
        for s in CitationMappingStatus:
            if s != CitationMappingStatus.UNRESOLVED:
                assert s.is_neutral is False

    def test_penalty_values(self):
        assert CitationMappingStatus.MATCHED.penalty == 0.0
        assert CitationMappingStatus.MISSING_REFERENCE.penalty == 1.0
        assert CitationMappingStatus.IN_TEXT_MISMATCH.penalty == 0.8
        assert CitationMappingStatus.DUPLICATE_REFERENCE.penalty == 0.6
        assert CitationMappingStatus.UNCITED_REFERENCE.penalty == 0.5
        assert CitationMappingStatus.AMBIGUOUS_MAPPING.penalty == 0.4
        assert CitationMappingStatus.STYLE_INCONSISTENT.penalty == 0.2
        assert CitationMappingStatus.UNRESOLVED.penalty == 0.0

    def test_labels(self):
        assert "Matched" in CitationMappingStatus.MATCHED.label
        assert "Missing" in CitationMappingStatus.MISSING_REFERENCE.label
        assert "Uncited" in CitationMappingStatus.UNCITED_REFERENCE.label

    def test_mapping_penalties_dict(self):
        """MAPPING_PENALTIES dict match enum penalties."""
        for s in CitationMappingStatus:
            assert MAPPING_PENALTIES[s] == s.penalty

    def test_string_creation(self):
        """Enum có thể tạo từ string."""
        assert CitationMappingStatus("matched") == CitationMappingStatus.MATCHED
        assert CitationMappingStatus("missing_reference") == CitationMappingStatus.MISSING_REFERENCE
        assert CitationMappingStatus("unresolved") == CitationMappingStatus.UNRESOLVED


class TestLinkingResult:
    def test_empty_result(self):
        result = LinkingResult(total_citations=5, total_references=3)
        assert result.total_citations == 5
        assert result.total_references == 3
        assert result.match_rate == 0.0
        assert result.matched_count == 0

    def test_match_rate(self):
        result = LinkingResult(total_citations=4, total_references=3)
        assert result.match_rate == 0.0
        result.matched_count = 2
        assert result.match_rate == 0.5

    def test_add_link_matched(self):
        from integrity_checker.models.validation import CitationLink, MappingMethod
        result = LinkingResult(total_citations=2, total_references=2)
        link = CitationLink(
            occurrence_id="occ-0", reference_id="ref-0",
            status=CitationMappingStatus.MATCHED, confidence=0.9,
            method=MappingMethod.AUTHOR_YEAR
        )
        result.add_link(link)
        assert result.matched_count == 1
        assert result.match_rate == 0.5
        assert result.status_counts[CitationMappingStatus.MATCHED] == 1

    def test_add_link_missing(self):
        from integrity_checker.models.validation import CitationLink, MappingMethod
        result = LinkingResult(total_citations=1, total_references=1)
        link = CitationLink(
            occurrence_id="occ-0", reference_id=None,
            status=CitationMappingStatus.MISSING_REFERENCE, confidence=0.0,
            method=MappingMethod.NO_KEYS
        )
        result.add_link(link)
        assert result.matched_count == 0
        assert result.status_counts[CitationMappingStatus.MISSING_REFERENCE] == 1

    def test_to_dict(self):
        result = LinkingResult(total_citations=1, total_references=1)
        result.unmatched_reference_ids = ["ref-0"]
        d = result.to_dict()
        assert d["total_citations"] == 1
        assert d["total_references"] == 1
        assert d["unmatched_reference_ids"] == ["ref-0"]
        assert d["match_rate"] == 0.0
        assert "links" in d
        assert "status_counts" in d
