"""Unit tests for algorithmic, statistical, and UI-analytics fixes from doctoral thesis review."""

from __future__ import annotations

import importlib.util
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from integrity_checker.linking.citation_linker import CitationLinker
from integrity_checker.linking.statuses import CitationMappingStatus, StyleProfile
from integrity_checker.logic.calibration import HybridMLScorer
from integrity_checker.logic.rules import SymbolicRules, ValidationLabel
from integrity_checker.matching.semantic import SemanticMatcher
from integrity_checker.models.citation import Citation, CitationType
from integrity_checker.models.source import SourceResult
from integrity_checker.models.validation import MappingMethod


def test_citation_linker_matches_arxiv_exact_version_normalized() -> None:
    linker = CitationLinker(detect_duplicates=False)
    body = [
        Citation(
            raw_text="See preprint arXiv:1706.03762v7 for transformer attention.",
            citation_type=CitationType.IN_TEXT,
            reference_id="occ-0001",
        )
    ]
    bib = [
        Citation(
            raw_text="Vaswani et al. (2017). Attention Is All You Need. https://arxiv.org/abs/1706.03762",
            citation_type=CitationType.REFERENCE_LIST,
            reference_id="ref-0001",
            url="https://arxiv.org/abs/1706.03762",
            title="Attention Is All You Need",
            year="2017",
        )
    ]
    res = linker.link(body, bib)
    assert len(res.links) == 1
    assert res.links[0].status == CitationMappingStatus.MATCHED
    assert res.links[0].method == MappingMethod.ARXIV_EXACT
    assert res.links[0].reference_id == "ref-0001"
    assert res.links[0].confidence == pytest.approx(0.95)


def test_fake_url_and_fabricated_doi_apply_style_penalty_without_double_add() -> None:
    rules = SymbolicRules()
    rules.style_inconsistent_penalty = 0.10
    mixed = StyleProfile(style="MIXED", confidence=0.80)
    scorer = HybridMLScorer()

    src_url = SourceResult(citation_raw="Fake Web Ref https://example.com/paper.pdf")
    out_clean = rules.apply(
        features=SimpleNamespace(),
        source=src_url,
        citation_url="https://example.com/paper.pdf",
    )
    out_mixed = rules.apply(
        features=SimpleNamespace(),
        source=src_url,
        citation_url="https://example.com/paper.pdf",
        style_profile=mixed,
    )
    assert out_clean.label == ValidationLabel.SUSPECTED_HALLUCINATION
    assert out_mixed.confidence == pytest.approx(out_clean.confidence - 0.10)

    cal_clean = scorer.calibrate_verdict_confidence(
        out_clean.label.value,
        out_clean.confidence,
        features=None,
        has_candidate=False,
        style_penalty=out_clean.style_penalty,
        triggered_rules=out_clean.triggered_rules,
    )
    cal_mixed = scorer.calibrate_verdict_confidence(
        out_mixed.label.value,
        out_mixed.confidence,
        features=None,
        has_candidate=False,
        style_penalty=out_mixed.style_penalty,
        triggered_rules=out_mixed.triggered_rules,
    )
    assert cal_mixed < cal_clean


def test_semantic_matcher_fallback_uses_065_035_sentence_pooling() -> None:
    matcher = SemanticMatcher()
    mock_model = MagicMock()
    # Force batch path failure so fallback runs
    mock_model.encode.side_effect = RuntimeError("force fallback")

    # Return predictable similarities: title=0.50, whole_abs=0.40, sent1=0.80, sent2=0.20
    sim_values = iter([0.50, 0.40, 0.80, 0.20])
    matcher._compute_similarity = MagicMock(side_effect=lambda *args, **kwargs: next(sim_values))
    matcher._load_model = MagicMock(return_value=mock_model)
    matcher.classify_citation_intent = MagicMock(return_value=("background", 0.5))

    result = matcher.check_content_alignment(
        cited_context="Transformers replace recurrent layers with self-attention.",
        source_title="Attention Is All You Need",
        source_abstract=(
            "Recurrent models are slow to parallelize. "
            "We propose a new simple network architecture based solely on attention mechanisms."
        ),
    )
    # 0.65 * 0.80 + 0.35 * 0.40 = 0.52 + 0.14 = 0.66
    assert result.abstract_context_sim == pytest.approx(0.66, abs=1e-4)


def test_holm_bonferroni_step_down_adjustment() -> None:
    script_path = Path(__file__).resolve().parents[2] / "scripts" / "train_neuro_symbolic_model.py"
    spec = importlib.util.spec_from_file_location("train_ns_mod", script_path)
    assert spec is not None and spec.loader is not None
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)

    adj = mod._holm_bonferroni_adjust({"a": 0.001, "b": 0.02, "c": 0.03, "d": 0.5})
    assert adj["a"] == pytest.approx(0.004)
    assert adj["b"] == pytest.approx(0.06)
    assert adj["c"] == pytest.approx(0.06)
    assert adj["d"] == pytest.approx(0.5)
