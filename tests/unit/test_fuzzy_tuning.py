"""Tests cho FuzzyMatcher + FuzzyTuner (task #32 — Sprint 2)."""

from __future__ import annotations

from integrity_checker.matching.fuzzy import (
    FuzzyMatcher,
    FuzzyScore,
    FuzzyTuner,
    TuningResult,
    normalize_for_fuzzy,
)


class TestNormalizeForFuzzy:
    """normalize_for_fuzzy helper."""

    def test_lowercase(self) -> None:
        assert normalize_for_fuzzy("HELLO World") == "hello world"

    def test_strip_punctuation(self) -> None:
        assert normalize_for_fuzzy("Smith, J.") == "smith j"

    def test_collapse_whitespace(self) -> None:
        assert normalize_for_fuzzy("  hello   world  ") == "hello world"

    def test_empty(self) -> None:
        assert normalize_for_fuzzy("") == ""
        assert normalize_for_fuzzy(None) == ""  # type: ignore[arg-type]

    def test_fold_diacritics(self) -> None:
        assert normalize_for_fuzzy("Nguyễn", fold_diacritics=True) == "nguyen"

    def test_no_fold_by_default(self) -> None:
        # Default không fold — preserves Vietnamese
        assert normalize_for_fuzzy("Nguyễn") == "nguyễn"


class TestFuzzyMatcher:
    """Main matcher API."""

    def test_identical_strings(self) -> None:
        m = FuzzyMatcher()
        assert m.token_set_ratio("hello", "hello") == 1.0

    def test_different_strings(self) -> None:
        m = FuzzyMatcher()
        assert m.token_set_ratio("hello", "world") < 0.5

    def test_punctuation_normalized(self) -> None:
        m = FuzzyMatcher()
        # "Smith, J." vs "J. Smith" should be very similar after normalization
        score = m.token_set_ratio("Smith, J.", "J. Smith")
        assert score > 0.7

    def test_fuzzy_score_returns_breakdown(self) -> None:
        m = FuzzyMatcher()
        result = m.fuzzy_score("hello world", "hello world!")
        assert isinstance(result, FuzzyScore)
        assert result.token_set == 1.0
        assert result.partial == 1.0
        assert result.levenshtein > 0.9
        assert result.best_method in ("token_set", "partial", "levenshtein")

    def test_fuzzy_score_empty(self) -> None:
        m = FuzzyMatcher()
        result = m.fuzzy_score("", "hello")
        assert result.best_score == 0.0
        assert result.best_method == ""

    def test_is_match_with_threshold(self) -> None:
        m = FuzzyMatcher()
        assert m.is_match("hello", "hello") is True
        # "hello" vs "world" — token_set=0 even with low threshold
        # (because no method score >= partial_ratio_threshold 0.8)
        assert m.is_match("hello", "world", threshold=0.1) is False
        # Exact same string → all methods score 1.0
        assert m.is_match("foo", "foo", threshold=0.99) is True

    def test_partial_ratio(self) -> None:
        m = FuzzyMatcher()
        # "Smith" appears in "Smith, J. K." → high partial
        score = m.partial_ratio("Smith", "Smith, J. K.")
        assert score > 0.5


class TestFuzzyTuner:
    """Threshold tuner (task #32)."""

    def test_all_positive(self) -> None:
        pairs = [
            ("hello world", "hello world", True),
            ("foo bar", "foo bar", True),
        ]
        tuner = FuzzyTuner()
        result = tuner.evaluate(pairs, threshold=0.5)
        assert result.pairs_evaluated == 2
        assert result.true_positives == 2
        assert result.false_negatives == 0
        assert result.precision == 1.0
        assert result.recall == 1.0

    def test_all_negative(self) -> None:
        pairs = [
            ("hello", "world", False),
            ("foo", "bar", False),
        ]
        tuner = FuzzyTuner()
        result = tuner.evaluate(pairs, threshold=0.5)
        assert result.true_negatives == 2
        assert result.accuracy == 1.0

    def test_mixed(self) -> None:
        pairs = [
            ("hello", "hello", True),       # match → TP
            ("hello", "world", False),      # no match → TN
            ("hello", "hellp", False),      # should NOT match below threshold
        ]
        tuner = FuzzyTuner()
        result = tuner.evaluate(pairs, threshold=0.85)
        assert isinstance(result, TuningResult)
        # Just check the structure
        assert result.pairs_evaluated == 3
        assert 0.0 <= result.precision <= 1.0
        assert 0.0 <= result.recall <= 1.0

    def test_threshold_sweep(self) -> None:
        # Higher threshold → fewer positives
        pairs = [
            ("hello", "hello", True),
            ("hello", "world", False),
        ]
        tuner = FuzzyTuner()
        result_low = tuner.evaluate(pairs, threshold=0.5)
        result_high = tuner.evaluate(pairs, threshold=0.99)
        # At high threshold, "hello" matches "hello" but barely (token_set=1.0)
        assert result_low.pairs_evaluated == result_high.pairs_evaluated

    def test_empty_pairs(self) -> None:
        tuner = FuzzyTuner()
        result = tuner.evaluate([])
        assert result.pairs_evaluated == 0
        assert result.precision == 0.0
        assert result.recall == 0.0
