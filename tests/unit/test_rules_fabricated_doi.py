"""Tests cho fabricated DOI detection (2026-09-15).

Priority 5.3: Thêm tests cho fabricated DOI detection.
Tests các pattern:
    - 10.1234/ncr.2022.0456 → fabricated (non-existent journal code)
    - 10.9999/jmle.2023.4567 → fabricated (fake publisher prefix)
    - 10.48550/arXiv.XXX → valid (real arXiv)
    - 10.1038/nature14539 → valid (real DOI)
"""

from __future__ import annotations

import pytest

from integrity_checker.logic.rules import _FABRICATED_DOI_PATTERNS, SymbolicRules, _is_fake_url
from integrity_checker.models.source import SourceResult
from integrity_checker.models.validation import MatchFeatures, ValidationLabel


class TestFabricatedDOIRegex:
    """Direct regex tests for fabricated DOI patterns."""

    def test_pattern_10_1234_ncr_matches(self):
        """10.1234/ncr.xxx should match fabricated pattern."""
        doi = "10.1234/ncr.2022.0456"
        assert any(p.search(doi.lower()) for p in _FABRICATED_DOI_PATTERNS)

    def test_pattern_10_9999_jmle_matches(self):
        """10.9999/jmle.xxx should match fabricated pattern."""
        doi = "10.9999/jmle.2023.4567"
        assert any(p.search(doi.lower()) for p in _FABRICATED_DOI_PATTERNS)

    def test_pattern_10_999_jmle_matches(self):
        """10.999/jmle.xxx should also match (single 9)."""
        doi = "10.999/jmle.2023.4567"
        assert any(p.search(doi.lower()) for p in _FABRICATED_DOI_PATTERNS)

    def test_pattern_10_1234_fake_matches(self):
        """10.1234/fake.xxx should match."""
        doi = "10.1234/fake.1234"
        assert any(p.search(doi.lower()) for p in _FABRICATED_DOI_PATTERNS)

    def test_pattern_10_0000_matches(self):
        """10.0000 prefix should match."""
        doi = "10.0000/journal.2023"
        assert any(p.search(doi.lower()) for p in _FABRICATED_DOI_PATTERNS)

    def test_pattern_paper_suffix_matches(self):
        """10.xxxx/paper-123 should match fabricated pattern."""
        doi = "10.5678/paper-123"
        assert any(p.search(doi.lower()) for p in _FABRICATED_DOI_PATTERNS)

    def test_real_doi_10_1038_not_fabricated(self):
        """Real DOI 10.1038/nature should NOT match fabricated pattern."""
        doi = "10.1038/nature14539"
        assert not any(p.search(doi.lower()) for p in _FABRICATED_DOI_PATTERNS)

    def test_real_doi_10_48550_arxiv_not_fabricated(self):
        """Real arXiv DOI should NOT match fabricated pattern."""
        doi = "10.48550/arXiv.2103.14030"
        assert not any(p.search(doi.lower()) for p in _FABRICATED_DOI_PATTERNS)

    def test_real_doi_10_1145_acm_not_fabricated(self):
        """Real ACM DOI should NOT match fabricated pattern."""
        doi = "10.1145/3442188.3445922"
        assert not any(p.search(doi.lower()) for p in _FABRICATED_DOI_PATTERNS)

    def test_real_doi_10_18653_acl_not_fabricated(self):
        """Real ACL/anthology DOI should NOT match fabricated pattern."""
        doi = "10.18653/v1/N19-1423"
        assert not any(p.search(doi.lower()) for p in _FABRICATED_DOI_PATTERNS)


class TestFabricatedDOIRule:
    """Tests for fabricated DOI in SymbolicRules.apply()."""

    @pytest.fixture
    def rules(self):
        return SymbolicRules()

    @pytest.fixture
    def empty_source(self):
        """Empty source result with no candidates."""
        return SourceResult(
            citation_raw="test citation",
            candidates=[],
            sources_queried=["crossref"],
            sources_succeeded=[],
            sources_failed={"crossref": "not found"},
        )

    @pytest.fixture
    def low_consensus_features(self):
        """Features with low consensus (important for fabricated DOI detection)."""
        return MatchFeatures(
            title_sim_fuzzy=0.0,
            title_sim_semantic=0.0,
            author_jaccard=0.0,
            year_distance=999,
            doi_exact_match=False,
            source_consensus=0,
        )

    def test_fabricated_doi_10_1234_ncr_returns_suspected(self, rules, empty_source, low_consensus_features):
        """10.1234/ncr.2022.0456 should be flagged as SUSPECTED_HALLUCINATION."""
        outcome = rules.apply(
            low_consensus_features,
            empty_source,
            citation_doi="10.1234/ncr.2022.0456",
        )
        assert outcome.label == ValidationLabel.SUSPECTED_HALLUCINATION
        assert "R-FABRICATED-DOI" in outcome.triggered_rules
        assert outcome.confidence >= 0.85  # High confidence for fabricated

    def test_fabricated_doi_10_9999_jmle_returns_suspected(self, rules, empty_source, low_consensus_features):
        """10.9999/jmle.2023.4567 should be flagged as SUSPECTED_HALLUCINATION."""
        outcome = rules.apply(
            low_consensus_features,
            empty_source,
            citation_doi="10.9999/jmle.2023.4567",
        )
        assert outcome.label == ValidationLabel.SUSPECTED_HALLUCINATION
        assert "R-FABRICATED-DOI" in outcome.triggered_rules

    def test_fabricated_doi_case_insensitive(self, rules, empty_source, low_consensus_features):
        """Fabricated DOI detection should be case-insensitive."""
        # Test uppercase
        outcome_upper = rules.apply(
            low_consensus_features,
            empty_source,
            citation_doi="10.1234/NCR.2022.0456",
        )
        assert outcome_upper.label == ValidationLabel.SUSPECTED_HALLUCINATION

    def test_real_doi_10_1038_not_flagged_as_fabricated(self, rules, empty_source, low_consensus_features):
        """Real DOI 10.1038/nature14539 should NOT be flagged as fabricated."""
        outcome = rules.apply(
            low_consensus_features,
            empty_source,
            citation_doi="10.1038/nature14539",
        )
        # Should NOT trigger R-FABRICATED-DOI
        assert "R-FABRICATED-DOI" not in outcome.triggered_rules

    def test_real_arxiv_doi_not_flagged(self, rules, empty_source, low_consensus_features):
        """Real arXiv DOI should NOT be flagged as fabricated."""
        outcome = rules.apply(
            low_consensus_features,
            empty_source,
            citation_doi="10.48550/arXiv.2103.14030",
        )
        assert "R-FABRICATED-DOI" not in outcome.triggered_rules

    def test_none_doi_not_flagged(self, rules, empty_source, low_consensus_features):
        """None/null DOI should NOT trigger fabricated detection."""
        outcome = rules.apply(
            low_consensus_features,
            empty_source,
            citation_doi=None,
        )
        assert "R-FABRICATED-DOI" not in outcome.triggered_rules

    def test_empty_doi_not_flagged(self, rules, empty_source, low_consensus_features):
        """Empty DOI should NOT trigger fabricated detection."""
        outcome = rules.apply(
            low_consensus_features,
            empty_source,
            citation_doi="",
        )
        assert "R-FABRICATED-DOI" not in outcome.triggered_rules


class TestFabricatedDOIWithConsensus:
    """Test that fabricated DOIs are still caught even with some consensus."""

    @pytest.fixture
    def rules(self):
        return SymbolicRules()

    @pytest.fixture
    def partial_source(self):
        """Source with partial (low quality) candidates."""
        from integrity_checker.models.source import SourceCandidate
        return SourceResult(
            citation_raw="test",
            candidates=[
                SourceCandidate(
                    source_name="crossref",
                    found=True,
                    title="Some unrelated paper",
                    authors=["Unknown, A."],
                    year="2022",
                    confidence=0.3,
                ),
            ],
            sources_queried=["crossref", "openalex"],
            sources_succeeded=["crossref"],
            sources_failed={"openalex": "not found"},
        )

    def test_fabricated_doi_low_consensus_flagged(self, rules, partial_source):
        """Fabricated DOI with consensus=1 should still be flagged."""
        features = MatchFeatures(
            title_sim_fuzzy=0.2,
            title_sim_semantic=0.2,
            author_jaccard=0.0,
            year_distance=5,
            doi_exact_match=True,
            source_consensus=1,
        )
        outcome = rules.apply(
            features,
            partial_source,
            citation_doi="10.1234/ncr.2022.0456",
        )
        assert outcome.label == ValidationLabel.SUSPECTED_HALLUCINATION
        assert "R-FABRICATED-DOI" in outcome.triggered_rules
