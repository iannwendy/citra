"""Tests cho v1.2 rules extension (task #33 — Sprint 2).

Test các rule mới:
    - R-STYLE-INCONSISTENT (penalty khi style MIXED/UNKNOWN)
    - R-AMBIGUOUS-MAPPING (cap confidence khi linker ambiguous)
    - R-DOMAIN-EXCEPTION (URL broken nhưng record exists)
"""

from __future__ import annotations

import pytest

from integrity_checker.extraction.style_detector import StyleProfile
from integrity_checker.linking.statuses import CitationMappingStatus
from integrity_checker.logic.rules import SymbolicRules
from integrity_checker.models.source import SourceCandidate, SourceResult
from integrity_checker.models.validation import MatchFeatures, ValidationLabel


def _make_source(
    *,
    doi: str | None = None,
    candidates: list[SourceCandidate] | None = None,
) -> SourceResult:
    """Helper: build SourceResult từ doi + candidates."""
    if candidates is None and doi:
        candidates = [SourceCandidate(source_name="crossref", found=True, doi=doi)]
    return SourceResult(citation_raw="test", candidates=candidates or [])


def _features(
    *,
    title_sim: float = 0.95,
    author_jaccard: float = 0.8,
    year_distance: int = 0,
    doi_match: bool = True,
    consensus: int = 1,
) -> MatchFeatures:
    return MatchFeatures(
        title_sim_fuzzy=title_sim,
        title_sim_semantic=title_sim,
        author_jaccard=author_jaccard,
        year_distance=year_distance,
        doi_exact_match=doi_match,
        source_consensus=consensus,
    )


def _style(*, style: str = "APA-LIKE", confidence: float = 0.8) -> StyleProfile:
    return StyleProfile(style=style, confidence=confidence)


class TestStyleInconsistentPenalty:
    """R-STYLE-INCONSISTENT: confidence bị penalty khi style MIXED/UNKNOWN."""

    def test_mixed_style_lowers_confidence(self) -> None:
        rules = SymbolicRules()
        source = _make_source(doi="10.1234/abc")
        feats = _features(doi_match=True, title_sim=0.95)
        # Baseline (APA-like, no penalty)
        baseline = rules.apply(feats, source, style_profile=_style(style="APA-LIKE"))
        # With MIXED → penalty applied
        mixed = rules.apply(
            feats, source, style_profile=_style(style="MIXED")
        )
        assert "R-STYLE-INCONSISTENT" in mixed.triggered_rules
        assert mixed.confidence < baseline.confidence
        assert mixed.style_penalty > 0

    def test_unknown_style_with_low_conf(self) -> None:
        rules = SymbolicRules()
        source = _make_source(doi="10.1234/abc")
        feats = _features(doi_match=True, title_sim=0.95)
        unknown_weak = rules.apply(
            feats,
            source,
            style_profile=_style(style="UNKNOWN", confidence=0.1),
        )
        # Weak penalty (0.5x)
        assert "R-STYLE-INCONSISTENT" in unknown_weak.triggered_rules
        assert unknown_weak.style_penalty > 0
        assert unknown_weak.style_penalty < rules.style_inconsistent_penalty

    def test_clean_style_no_penalty(self) -> None:
        rules = SymbolicRules()
        source = _make_source(doi="10.1234/abc")
        feats = _features(doi_match=True, title_sim=0.95)
        clean = rules.apply(feats, source, style_profile=_style(style="APA-LIKE"))
        assert clean.style_penalty == 0
        assert "R-STYLE-INCONSISTENT" not in clean.triggered_rules


class TestAmbiguousMappingRule:
    """R-AMBIGUOUS-MAPPING: cap confidence khi linker ambiguous."""

    def test_ambiguous_forces_unresolved(self) -> None:
        rules = SymbolicRules()
        source = _make_source(doi="10.1234/abc")
        # title_sim thấp để không trigger Rule 1 (DOI-TITLE-AUTHOR)
        # AMBIGUOUS rule chỉ fire khi chưa có rule nào match trước
        feats = _features(doi_match=False, title_sim=0.5, author_jaccard=0.3)
        outcome = rules.apply(
            feats,
            source,
            mapping_status=CitationMappingStatus.AMBIGUOUS_MAPPING,
        )
        assert outcome.label == ValidationLabel.UNRESOLVED
        assert "R-AMBIGUOUS-MAPPING" in outcome.triggered_rules
        assert outcome.confidence <= rules.ambiguous_confidence_cap

    def test_ambiguous_does_not_override_verified(self) -> None:
        """Khi đã có DOI match + high title_sim, Rule 1 wins → VERIFIED."""
        rules = SymbolicRules()
        source = _make_source(doi="10.1234/abc")
        feats = _features(doi_match=True, title_sim=0.95)
        outcome = rules.apply(
            feats,
            source,
            mapping_status=CitationMappingStatus.AMBIGUOUS_MAPPING,
        )
        # Rule ordering: Rule 1 fires first → VERIFIED (đúng rule order)
        assert outcome.label == ValidationLabel.VERIFIED
        assert "R-AMBIGUOUS-MAPPING" not in outcome.triggered_rules

    def test_matched_status_no_ambiguous_rule(self) -> None:
        rules = SymbolicRules()
        source = _make_source(doi="10.1234/abc")
        feats = _features(doi_match=True, title_sim=0.95)
        outcome = rules.apply(
            feats,
            source,
            mapping_status=CitationMappingStatus.MATCHED,
        )
        # Should fall through to Rule 1 (DOI-TITLE-AUTHOR) → VERIFIED
        assert outcome.label == ValidationLabel.VERIFIED
        assert "R-AMBIGUOUS-MAPPING" not in outcome.triggered_rules

    def test_missing_reference_not_ambiguous(self) -> None:
        rules = SymbolicRules()
        source = _make_source(doi="10.1234/abc")
        feats = _features(doi_match=True, title_sim=0.95)
        outcome = rules.apply(
            feats,
            source,
            mapping_status=CitationMappingStatus.MISSING_REFERENCE,
        )
        # Không trigger AMBIGUOUS rule (đó là rule cho AMBIGUOUS_MAPPING only)
        assert "R-AMBIGUOUS-MAPPING" not in outcome.triggered_rules


class TestDomainException:
    """R-DOMAIN-EXCEPTION: URL broken + scholarly record exists."""

    def test_doi_match_low_title_high_consensus_triggers(self) -> None:
        rules = SymbolicRules()
        source = _make_source(
            candidates=[
                SourceCandidate(source_name="crossref", found=True, doi="10.1234/abc"),
                SourceCandidate(source_name="openalex", found=True, doi="10.1234/abc"),
            ]
        )
        # title_sim thấp + DOI match + consensus ≥ 2 → DOMAIN-EXCEPTION
        feats = _features(doi_match=True, title_sim=0.3, consensus=2)
        outcome = rules.apply(feats, source)
        assert "R-DOMAIN-EXCEPTION" in outcome.triggered_rules
        assert outcome.domain_exception is True
        assert outcome.label == ValidationLabel.METADATA_ERROR
        assert "url" in outcome.mismatched_fields

    def test_low_consensus_no_domain_exception(self) -> None:
        rules = SymbolicRules()
        source = _make_source(
            candidates=[
                SourceCandidate(source_name="crossref", found=True, doi="10.1234/abc"),
            ]
        )
        # consensus = 1, title_sim thấp → không trigger DOMAIN-EXCEPTION
        feats = _features(doi_match=True, title_sim=0.3, consensus=1)
        outcome = rules.apply(feats, source)
        assert "R-DOMAIN-EXCEPTION" not in outcome.triggered_rules
        assert outcome.domain_exception is False

    def test_high_title_no_domain_exception(self) -> None:
        rules = SymbolicRules()
        source = _make_source(
            candidates=[
                SourceCandidate(source_name="crossref", found=True, doi="10.1234/abc"),
                SourceCandidate(source_name="openalex", found=True, doi="10.1234/abc"),
            ]
        )
        # title_sim cao + DOI match → fall through Rule 1 → VERIFIED
        feats = _features(doi_match=True, title_sim=0.95, consensus=2)
        outcome = rules.apply(feats, source)
        assert "R-DOMAIN-EXCEPTION" not in outcome.triggered_rules
        assert outcome.label == ValidationLabel.VERIFIED


class TestRuleOutcomeDataclass:
    """RuleOutcome has new fields (style_penalty, domain_exception)."""

    def test_default_values(self) -> None:
        from integrity_checker.logic.rules import RuleOutcome
        outcome = RuleOutcome(
            label=ValidationLabel.VERIFIED,
            confidence=0.9,
            reasoning="test",
            triggered_rules=[],
            mismatched_fields=[],
        )
        assert outcome.style_penalty == 0.0
        assert outcome.domain_exception is False


class TestRulesAcceptNewArgs:
    """SymbolicRules.apply() accepts mapping_status + style_profile."""

    def test_apply_with_both_args(self) -> None:
        rules = SymbolicRules()
        source = _make_source(doi="10.1234/abc")
        feats = _features()
        # Should not raise
        outcome = rules.apply(
            feats,
            source,
            mapping_status=CitationMappingStatus.MATCHED,
            style_profile=_style(),
        )
        assert outcome is not None

    def test_apply_without_new_args(self) -> None:
        rules = SymbolicRules()
        source = _make_source(doi="10.1234/abc")
        feats = _features()
        # Backward compat — no new args
        outcome = rules.apply(feats, source)
        assert outcome is not None
        assert outcome.style_penalty == 0.0
