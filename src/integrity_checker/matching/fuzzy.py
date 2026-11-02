"""Fuzzy string matching với RapidFuzz.

v1.2 §2.5 (task #32): Pre-normalize trước khi compare để handle:
    - Punctuation (commas, periods, semicolons).
    - Whitespace.
    - Case.
    - Diacritics (configurable, off by default — Vietnamese names handled
      by author_matcher separately).

Threshold tuning:
    - ``token_set_ratio_threshold`` (default 0.85): minimum score to count
      as fuzzy match for title matching.
    - ``partial_ratio_threshold`` (default 0.80): minimum for short-string
      partial matching (e.g. author last names).
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field

from rapidfuzz import fuzz

_PUNCT_RE = re.compile(r"[^\w\s]", re.UNICODE)
_WS_RE = re.compile(r"\s+", re.UNICODE)


def _fold_diacritics(text: str) -> str:
    """NFC + strip combining marks + Đ/đ: 'Nguyễn' → 'Nguyen', 'Đặng' → 'Dang'."""
    nfd = unicodedata.normalize("NFD", text.replace("đ", "d").replace("Đ", "D"))
    return "".join(c for c in nfd if unicodedata.category(c) != "Mn")


def normalize_for_fuzzy(text: str, *, fold_diacritics: bool = False) -> str:
    """Pre-normalize text trước khi fuzzy match.

    Args:
        text: input string.
        fold_diacritics: True nếu muốn fold 'Nguyễn' → 'Nguyen'
            (recommended cho Vietnamese names).

    Returns:
        Lowercase, no punctuation, collapsed whitespace.
    """
    if not text:
        return ""
    s = text.lower().strip()
    if fold_diacritics:
        s = _fold_diacritics(s)
    s = _PUNCT_RE.sub(" ", s)
    s = _WS_RE.sub(" ", s).strip()
    return s


@dataclass
class FuzzyScore:
    """Output chi tiết của fuzzy_score() — cho threshold tuning."""

    token_set: float = 0.0
    partial: float = 0.0
    levenshtein: float = 0.0
    best_method: str = ""
    best_score: float = 0.0
    normalized_s1: str = ""
    normalized_s2: str = ""


@dataclass
class TuningResult:
    """Output của FuzzyTuner.evaluate() — cho threshold tuning."""

    pairs_evaluated: int = 0
    true_positives: int = 0
    false_positives: int = 0
    true_negatives: int = 0
    false_negatives: int = 0
    precision: float = 0.0
    recall: float = 0.0
    f1: float = 0.0
    accuracy: float = 0.0
    threshold_used: float = 0.0
    score_distribution: list[float] = field(default_factory=list)


class FuzzyMatcher:
    """Wrapper RapidFuzz với pre-normalization.

    v1.2 §2.5 (task #32): auto-normalize inputs trước khi tính
    token_set_ratio/partial_ratio. Tunable threshold qua constructor.
    """

    def __init__(
        self,
        *,
        token_set_ratio_threshold: float = 0.85,
        partial_ratio_threshold: float = 0.80,
        fold_diacritics: bool = False,
    ) -> None:
        self.token_set_ratio_threshold = token_set_ratio_threshold
        self.partial_ratio_threshold = partial_ratio_threshold
        self.fold_diacritics = fold_diacritics

    # --- public scoring methods ---

    def token_set_ratio(self, s1: str, s2: str) -> float:
        """Trả về 0.0–1.0 (đã chia 100), pre-normalized."""
        if not s1 or not s2:
            return 0.0
        n1 = normalize_for_fuzzy(s1, fold_diacritics=self.fold_diacritics)
        n2 = normalize_for_fuzzy(s2, fold_diacritics=self.fold_diacritics)
        return fuzz.token_set_ratio(n1, n2) / 100.0

    def partial_ratio(self, s1: str, s2: str) -> float:
        """Trả về 0.0–1.0, pre-normalized."""
        if not s1 or not s2:
            return 0.0
        n1 = normalize_for_fuzzy(s1, fold_diacritics=self.fold_diacritics)
        n2 = normalize_for_fuzzy(s2, fold_diacritics=self.fold_diacritics)
        return fuzz.partial_ratio(n1, n2) / 100.0

    def levenshtein_ratio(self, s1: str, s2: str) -> float:
        if not s1 or not s2:
            return 0.0
        n1 = normalize_for_fuzzy(s1, fold_diacritics=self.fold_diacritics)
        n2 = normalize_for_fuzzy(s2, fold_diacritics=self.fold_diacritics)
        return fuzz.ratio(n1, n2) / 100.0

    def fuzzy_score(self, s1: str, s2: str) -> FuzzyScore:
        """Tính 3 scores cùng lúc + best method.

        Returns:
            FuzzyScore với token_set/partial/levenshtein + best_method
            (method có score cao nhất vượt threshold).
        """
        n1 = normalize_for_fuzzy(s1, fold_diacritics=self.fold_diacritics)
        n2 = normalize_for_fuzzy(s2, fold_diacritics=self.fold_diacritics)
        if not n1 or not n2:
            return FuzzyScore(normalized_s1=n1, normalized_s2=n2)

        token_set = fuzz.token_set_ratio(n1, n2) / 100.0
        partial = fuzz.partial_ratio(n1, n2) / 100.0
        lev = fuzz.ratio(n1, n2) / 100.0

        # Best method: highest score above its threshold
        candidates = [
            ("token_set", token_set, self.token_set_ratio_threshold),
            ("partial", partial, self.partial_ratio_threshold),
            ("levenshtein", lev, self.token_set_ratio_threshold),
        ]
        best_method = ""
        best_score = 0.0
        for name, score, thr in candidates:
            if score >= thr and score > best_score:
                best_method = name
                best_score = score

        return FuzzyScore(
            token_set=token_set,
            partial=partial,
            levenshtein=lev,
            best_method=best_method,
            best_score=best_score,
            normalized_s1=n1,
            normalized_s2=n2,
        )

    def is_match(self, s1: str, s2: str, *, threshold: float | None = None) -> bool:
        """True nếu bất kỳ method nào vượt threshold."""
        thr = threshold if threshold is not None else self.token_set_ratio_threshold
        return self.fuzzy_score(s1, s2).best_score >= thr


class FuzzyTuner:
    """Threshold tuner — v1.2 §2.5.

    Dùng để tìm threshold tối ưu trên gold dataset:
        pairs = [(s1, s2, expected_match: bool), ...]
    """

    def __init__(self, matcher: FuzzyMatcher | None = None) -> None:
        self.matcher = matcher or FuzzyMatcher()

    def evaluate(
        self,
        pairs: list[tuple[str, str, bool]],
        *,
        threshold: float | None = None,
    ) -> TuningResult:
        """Evaluate matcher trên 1 tập (s1, s2, expected_match) pairs.

        Args:
            pairs: list of (s1, s2, expected_match_bool).
            threshold: optional override; default = matcher.token_set_ratio_threshold.

        Returns:
            TuningResult với precision/recall/F1/accuracy + score distribution.
        """
        thr = threshold if threshold is not None else self.matcher.token_set_ratio_threshold
        tp = fp = tn = fn = 0
        scores: list[float] = []

        for s1, s2, expected in pairs:
            score = self.matcher.fuzzy_score(s1, s2).best_score
            scores.append(score)
            predicted = score >= thr
            if expected and predicted:
                tp += 1
            elif expected and not predicted:
                fn += 1
            elif not expected and predicted:
                fp += 1
            else:
                tn += 1

        precision = tp / (tp + fp) if (tp + fp) > 0 else 0.0
        recall = tp / (tp + fn) if (tp + fn) > 0 else 0.0
        f1 = 2 * precision * recall / (precision + recall) if (precision + recall) > 0 else 0.0
        accuracy = (tp + tn) / len(pairs) if pairs else 0.0

        return TuningResult(
            pairs_evaluated=len(pairs),
            true_positives=tp,
            false_positives=fp,
            true_negatives=tn,
            false_negatives=fn,
            precision=precision,
            recall=recall,
            f1=f1,
            accuracy=accuracy,
            threshold_used=thr,
            score_distribution=sorted(scores),
        )
