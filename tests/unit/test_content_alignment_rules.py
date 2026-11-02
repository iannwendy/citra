"""Unit tests for content alignment integration in rules (v1.3 Neural layer)."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from integrity_checker.logic.rules import SymbolicRules
from integrity_checker.models.source import SourceCandidate, SourceResult
from integrity_checker.models.validation import MatchFeatures, ValidationLabel


class TestContentAlignmentRules:
    """Test Neural content alignment rules."""

    def _make_features(
        self,
        title_sim_fuzzy: float = 0.7,
        title_sim_semantic: float = 0.7,
        author_jaccard: float = 0.5,
        year_distance: int = 0,
        doi_exact_match: bool = False,
        source_consensus: int = 1,
        content_alignment_score: float = 0.0,
        content_is_aligned: bool = False,
    ) -> MatchFeatures:
        """Create MatchFeatures with content alignment."""
        return MatchFeatures(
            title_sim_fuzzy=title_sim_fuzzy,
            title_sim_semantic=title_sim_semantic,
            author_jaccard=author_jaccard,
            year_distance=year_distance,
            doi_exact_match=doi_exact_match,
            source_consensus=source_consensus,
            content_alignment_score=content_alignment_score,
            content_is_aligned=content_is_aligned,
        )

    def _make_source(self) -> SourceResult:
        """Create mock SourceResult."""
        candidate = SourceCandidate(
            source_name="test",
            found=True,
            title="Test Paper",
            authors=["Test Author"],
            year="2020",
            confidence=0.9,
            score=0.9,
        )
        return SourceResult(
            citation_raw="Test citation",
            candidates=[candidate],
            sources_queried=["test"],
            sources_succeeded=["test"],
            sources_failed=[],
        )

    def test_content_alignment_verified(self):
        """High content alignment + moderate title = VERIFIED."""
        rules = SymbolicRules()

        # Content aligned, title moderate
        features = self._make_features(
            title_sim_fuzzy=0.6,
            title_sim_semantic=0.6,
            content_alignment_score=0.8,
            content_is_aligned=True,
        )
        source = self._make_source()

        outcome = rules.apply(features, source)

        # Should return VERIFIED due to content alignment
        assert outcome.label == ValidationLabel.VERIFIED
        assert "R-CONTENT-ALIGNMENT" in outcome.triggered_rules

    def test_content_alignment_suspected_mismatch(self):
        """Title matches but content not aligned = SUSPECTED_HALLUCINATION."""
        rules = SymbolicRules()

        # Title matches but content doesn't
        features = self._make_features(
            title_sim_fuzzy=0.8,
            title_sim_semantic=0.8,
            content_alignment_score=0.4,  # Low content alignment
            content_is_aligned=False,
        )
        source = self._make_source()

        outcome = rules.apply(features, source)

        # Should return SUSPECTED_HALLUCINATION due to content mismatch
        assert outcome.label == ValidationLabel.SUSPECTED_HALLUCINATION
        assert "R-CONTENT-MISMATCH" in outcome.triggered_rules
        assert "content" in outcome.mismatched_fields

    def test_content_alignment_unresolved_uncertain(self):
        """Moderate content alignment = UNRESOLVED."""
        rules = SymbolicRules()

        # Moderate content alignment
        features = self._make_features(
            title_sim_fuzzy=0.5,
            title_sim_semantic=0.5,
            content_alignment_score=0.35,  # In the uncertain range
            content_is_aligned=False,
        )
        source = self._make_source()

        outcome = rules.apply(features, source)

        # Should return UNRESOLVED for uncertain content
        assert outcome.label == ValidationLabel.UNRESOLVED
        assert "R-CONTENT-ALIGNMENT" in outcome.triggered_rules

    def test_content_alignment_no_signal_when_disabled(self):
        """When content alignment is not provided, rules work normally."""
        rules = SymbolicRules()

        # No content alignment signal (score = 0)
        features = self._make_features(
            title_sim_fuzzy=0.5,
            title_sim_semantic=0.5,
            content_alignment_score=0.0,
            content_is_aligned=False,
        )
        source = self._make_source()

        outcome = rules.apply(features, source)

        # Should not trigger content alignment rule
        assert "R-CONTENT-ALIGNMENT" not in outcome.triggered_rules


class TestContentAlignmentEnhancesReasoning:
    """Test that content alignment enhances reasoning explanation."""

    def test_reasoning_includes_content_alignment(self):
        """Reasoning should include content alignment information."""
        rules = SymbolicRules()

        features = MatchFeatures(
            title_sim_fuzzy=0.7,
            title_sim_semantic=0.7,
            author_jaccard=0.5,
            year_distance=0,
            doi_exact_match=False,
            source_consensus=1,
            content_alignment_score=0.75,
            content_alignment_confidence="high",
            content_is_aligned=True,
        )
        source = SourceResult(
            citation_raw="Test",
            candidates=[
                SourceCandidate(
                    source_name="test",
                    found=True,
                    title="Test",
                    authors=["Author"],
                    year="2020",
                    confidence=0.9,
                    score=0.9,
                )
            ],
            sources_queried=["test"],
            sources_succeeded=["test"],
            sources_failed=[],
        )

        outcome = rules.apply(features, source)

        # Reasoning should mention content alignment
        assert "content" in outcome.reasoning.lower() or "Neural" in outcome.reasoning


class TestContentAlignmentWithWellLinked:
    """Test content alignment works with well-linked citations."""

    def _make_features(self, **kwargs) -> MatchFeatures:
        """Create MatchFeatures with content alignment."""
        defaults = {
            "title_sim_fuzzy": 0.7,
            "title_sim_semantic": 0.7,
            "author_jaccard": 0.5,
            "year_distance": 0,
            "doi_exact_match": False,
            "source_consensus": 1,
            "content_alignment_score": 0.0,
            "content_is_aligned": False,
        }
        defaults.update(kwargs)
        return MatchFeatures(**defaults)

    def test_well_linked_content_aligned(self):
        """Well-linked citation with content alignment = VERIFIED."""
        rules = SymbolicRules()

        features = self._make_features(
            title_sim_fuzzy=0.6,
            title_sim_semantic=0.6,
            content_alignment_score=0.85,
            content_is_aligned=True,
        )
        source = SourceResult(
            citation_raw="Test",
            candidates=[
                SourceCandidate(
                    source_name="test",
                    found=True,
                    title="Test",
                    authors=["Author"],
                    year="2020",
                    confidence=0.9,
                    score=0.9,
                )
            ],
            sources_queried=["test"],
            sources_succeeded=["test"],
            sources_failed=[],
        )

        outcome = rules.apply(features, source)

        # Should be VERIFIED
        assert outcome.label == ValidationLabel.VERIFIED
