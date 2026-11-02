"""Unit tests cho FuzzyMatcher."""

from __future__ import annotations

from integrity_checker.matching import FuzzyMatcher


def test_token_set_ratio_identical() -> None:
    m = FuzzyMatcher()
    assert m.token_set_ratio("Attention is all you need", "Attention is all you need") == 1.0


def test_token_set_ratio_different_order() -> None:
    m = FuzzyMatcher()
    sim = m.token_set_ratio("Attention is all you need", "All you need is attention")
    assert sim > 0.5  # token set robust


def test_token_set_ratio_empty() -> None:
    m = FuzzyMatcher()
    assert m.token_set_ratio("", "test") == 0.0
    assert m.token_set_ratio("test", "") == 0.0
    assert m.token_set_ratio("", "") == 0.0


def test_partial_ratio_substring() -> None:
    m = FuzzyMatcher()
    sim = m.partial_ratio("Attention is all you need", "Transformer attention")
    assert sim > 0
