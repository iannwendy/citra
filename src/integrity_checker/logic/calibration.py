"""Calibration metrics — v1.2 §2.6 (task #34).

Đo 3 metrics theo đề cương §3.10.2:
    1. **Brier score** — mean squared error giữa predicted probability +
       ground truth (0.0 = perfect, 1.0 = worst).
    2. **ECE (Expected Calibration Error)** — weighted mean of |accuracy -
       confidence| per bin. 0.0 = perfect calibration.
    3. **Coverage-accuracy curve** — accuracy tại các coverage thresholds
       (top-K% highest confidence → accuracy trên subset đó).

Use cases:
    - Đánh giá SymbolicRules sau khi deploy.
    - Tune abstention band (lower bound = "too uncertain to decide").
    - So sánh với baselines B0-B5.

API:
    - ``compute_brier(predictions, ground_truth) -> float``
    - ``compute_ece(predictions, ground_truth, *, n_bins=10) -> float``
    - ``compute_coverage_accuracy(predictions, ground_truth, *,
        coverages=[0.5, 0.7, 0.9, 0.95, 1.0]) -> dict[float, float]``
    - ``CalibrationReport.to_dict()`` — serialize cho JSON output.

v1.2 §2.6 — Sprint 2.
"""

from __future__ import annotations

import json
import math
from collections import defaultdict
from collections.abc import Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


def compute_brier(
    predictions: Sequence[float],
    ground_truth: Sequence[int],
) -> float:
    """Brier score: mean squared error giữa predicted prob + ground truth.

    Args:
        predictions: list of predicted probabilities (0.0–1.0).
        ground_truth: list of 0/1 labels.

    Returns:
        Brier score (0.0 = perfect, 1.0 = worst possible).

    Raises:
        ValueError: nếu 2 lists khác length.
    """
    if len(predictions) != len(ground_truth):
        raise ValueError(
            f"predictions ({len(predictions)}) and ground_truth "
            f"({len(ground_truth)}) must have same length"
        )
    if not predictions:
        return 0.0
    n = len(predictions)
    s = 0.0
    for p, y in zip(predictions, ground_truth):
        p_clamped = max(0.0, min(1.0, p))
        s += (p_clamped - y) ** 2
    return s / n


def compute_ece(
    predictions: Sequence[float],
    ground_truth: Sequence[int],
    *,
    n_bins: int = 10,
) -> float:
    """Expected Calibration Error.

    Chia predictions thành ``n_bins`` equal-width bins [0, 1/n_bins), [1/n_bins, 2/n_bins), ...
    Tính accuracy và mean confidence trong mỗi bin, weighted theo số samples.

    Args:
        predictions: list of predicted probabilities.
        ground_truth: list of 0/1 labels.
        n_bins: số bins (default 10).

    Returns:
        ECE (0.0 = perfect calibration).
    """
    if len(predictions) != len(ground_truth):
        raise ValueError(
            f"predictions ({len(predictions)}) and ground_truth "
            f"({len(ground_truth)}) must have same length"
        )
    if not predictions:
        return 0.0
    if n_bins <= 0:
        raise ValueError(f"n_bins must be > 0, got {n_bins}")

    n = len(predictions)
    bin_sums_pred: list[float] = [0.0] * n_bins
    bin_correct: list[int] = [0] * n_bins
    bin_counts: list[int] = [0] * n_bins

    for p, y in zip(predictions, ground_truth):
        p_clamped = max(0.0, min(1.0, p))
        # Find bin (last bin includes 1.0)
        bin_idx = min(int(p_clamped * n_bins), n_bins - 1)
        bin_sums_pred[bin_idx] += p_clamped
        bin_correct[bin_idx] += int(y)
        bin_counts[bin_idx] += 1

    ece = 0.0
    for i in range(n_bins):
        if bin_counts[i] == 0:
            continue
        bin_acc = bin_correct[i] / bin_counts[i]
        bin_conf = bin_sums_pred[i] / bin_counts[i]
        ece += (bin_counts[i] / n) * abs(bin_acc - bin_conf)

    return ece


def compute_coverage_accuracy(
    predictions: Sequence[float],
    ground_truth: Sequence[int],
    *,
    coverages: Sequence[float] = (0.5, 0.7, 0.9, 0.95, 1.0),
    descending: bool = True,
) -> dict[float, float]:
    """Coverage-accuracy curve.

    Tại mỗi coverage threshold (0–1), giữ lại top-K% predictions có confidence
    cao nhất và tính accuracy trên subset đó.

    Args:
        predictions: list of predicted probabilities.
        ground_truth: list of 0/1 labels.
        coverages: list of coverage thresholds (default 50%, 70%, 90%, 95%, 100%).
        descending: True nếu sort theo confidence descending (default True).

    Returns:
        Dict mapping coverage → accuracy. Coverage = 1.0 → accuracy trên toàn bộ.
    """
    if len(predictions) != len(ground_truth):
        raise ValueError("predictions and ground_truth must have same length")
    if not predictions:
        return {c: 0.0 for c in coverages}

    paired = sorted(
        zip(predictions, ground_truth),
        key=lambda x: x[0],
        reverse=descending,
    )
    n = len(paired)
    results: dict[float, float] = {}
    for cov in coverages:
        if not 0.0 <= cov <= 1.0:
            continue
        k = max(1, int(round(n * cov)))
        subset = paired[:k]
        if not subset:
            results[cov] = 0.0
            continue
        correct = sum(int(y) for _, y in subset)
        results[cov] = correct / len(subset)
    return results


@dataclass
class CalibrationMetrics:
    """Output gộp của compute_calibration_metrics() — backward-compatible.

    v1.2 §2.6 (task #34) — extends prior stub với:
        - coverage_accuracy (dict mapping coverage thresholds → accuracy).
        - abstention_band (lowest coverage + accuracy).
    """

    ece: float = 0.0
    brier: float = 0.0
    coverage: float = 0.0           # tỉ lệ verdict ≠ UNRESOLVED
    num_buckets: int = 10
    coverage_accuracy: dict[float, float] = field(default_factory=dict)
    abstention_band: tuple[float, float] = (0.0, 0.0)
    n_samples: int = 0

    def summary(self) -> dict[str, float]:
        return {
            "ece": self.ece,
            "brier": self.brier,
            "coverage": self.coverage,
            "n_samples": self.n_samples,
        }

    def to_dict(self) -> dict:
        return {
            "ece": round(self.ece, 4),
            "brier": round(self.brier, 4),
            "coverage": round(self.coverage, 4),
            "n_samples": self.n_samples,
            "coverage_accuracy": {
                str(k): round(v, 4) for k, v in self.coverage_accuracy.items()
            },
            "abstention_band": [self.abstention_band[0], round(self.abstention_band[1], 4)],
        }


class CalibrationCalculator:
    """Tính calibration metrics từ predictions + ground-truth labels.

    v1.2 §2.6 (task #34) — full implementation, replaces prior placeholder stub.
    """

    @staticmethod
    def compute(
        predictions: list[tuple[float, int]],  # (confidence, is_correct)
        num_buckets: int = 10,
        coverages: Sequence[float] = (0.5, 0.7, 0.9, 0.95, 1.0),
        abstention_threshold: float = 0.5,
    ) -> CalibrationMetrics:
        """Compute ECE + Brier + coverage-accuracy.

        Args:
            predictions: list of (confidence, is_correct) pairs.
                is_correct ∈ {0, 1}.
            num_buckets: số bins cho ECE (default 10).
            coverages: coverage thresholds cho accuracy curve.
            abstention_threshold: threshold để tính coverage
                (default 0.5 — confidence ≥ 0.5 = non-abstained).

        Returns:
            CalibrationMetrics với ece, brier, coverage, coverage_accuracy.
        """
        if not predictions:
            return CalibrationMetrics(
                ece=0.0,
                brier=0.0,
                coverage=0.0,
                num_buckets=num_buckets,
                coverage_accuracy={c: 0.0 for c in coverages},
                n_samples=0,
            )

        # Unpack
        confs = [p[0] for p in predictions]
        labels = [p[1] for p in predictions]
        n = len(predictions)

        # ECE
        ece = compute_ece(confs, labels, n_bins=num_buckets)

        # Brier
        brier = compute_brier(confs, labels)

        # Coverage (default: confidence ≥ abstention_threshold = non-abstained)
        coverage = sum(1 for c in confs if c >= abstention_threshold) / n

        # Coverage-accuracy curve
        coverage_acc = compute_coverage_accuracy(
            confs, labels, coverages=coverages
        )

        # Abstention band (lowest coverage + accuracy)
        if coverage_acc:
            min_cov = min(coverage_acc.keys())
            abstention_acc = coverage_acc[min_cov]
        else:
            min_cov = 0.0
            abstention_acc = 0.0

        return CalibrationMetrics(
            ece=ece,
            brier=brier,
            coverage=coverage,
            num_buckets=num_buckets,
            coverage_accuracy=coverage_acc,
            abstention_band=(min_cov, abstention_acc),
            n_samples=n,
        )


# ----- Convenience: list-based API -----


def compute_calibration_metrics(
    predictions: Sequence[float],
    ground_truth: Sequence[int],
    *,
    n_bins: int = 10,
    coverages: Sequence[float] = (0.5, 0.7, 0.9, 0.95, 1.0),
) -> CalibrationMetrics:
    """List-based wrapper cho CalibrationCalculator.compute().

    Args:
        predictions: list of predicted probabilities.
        ground_truth: list of 0/1 labels.

    Returns:
        CalibrationMetrics.
    """
    pairs = list(zip(predictions, ground_truth))
    return CalibrationCalculator.compute(
        pairs,  # type: ignore[arg-type]
        num_buckets=n_bins,
        coverages=coverages,
    )


def find_optimal_abstention_threshold(
    predictions: Sequence[float],
    ground_truth: Sequence[int],
    *,
    target_coverage: float = 0.8,
) -> tuple[float, float]:
    """Find abstention threshold để đạt target_coverage.

    Tìm threshold T sao cho ≥target_coverage % predictions có confidence ≥ T.

    Args:
        predictions: list of predicted probabilities.
        ground_truth: list of 0/1 labels.
        target_coverage: target coverage (default 0.8 = 80%).

    Returns:
        Tuple (threshold, actual_coverage).
    """
    if not predictions:
        return 0.0, 0.0
    n = len(predictions)
    sorted_preds = sorted(predictions, reverse=True)
    k = max(1, int(round(n * target_coverage)))
    threshold = sorted_preds[k - 1]
    actual_cov = sum(1 for p in predictions if p >= threshold) / n
    return threshold, actual_cov


# =============================================================================
# Phase 4: Platt Scaling Calibrator & Hybrid Neuro-Symbolic ML Scorer
# =============================================================================


def _sigmoid(x: float) -> float:
    """Numerically stable logistic sigmoid."""
    if x >= 0:
        z = math.exp(-min(x, 60.0))
        return 1.0 / (1.0 + z)
    z = math.exp(max(x, -60.0))
    return z / (1.0 + z)


def _logit(p: float, eps: float = 1e-4) -> float:
    """Clamped log-odds transform."""
    p_c = max(eps, min(1.0 - eps, float(p)))
    return math.log(p_c / (1.0 - p_c))


@dataclass
class PlattCalibrator:
    """Logit-space Platt Scaling Calibrator: P_cal = sigmoid(a * logit(p) + b).

    When a=1.0, b=0.0, calibrate(p) == p (exact identity mapping).
    When fitted on validation/training pairs (raw_confidence, is_correct),
    it minimizes Negative Log-Likelihood + Brier Score to reduce ECE.
    """

    a: float = 1.0
    b: float = 0.0
    min_prob: float = 0.01
    max_prob: float = 0.99

    def calibrate(self, score: float) -> float:
        """Return Platt-calibrated probability in [min_prob, max_prob]."""
        if score <= 0.0:
            return 0.0
        z = _logit(score)
        cal = _sigmoid(self.a * z + self.b)
        return max(self.min_prob, min(self.max_prob, cal))

    def calibrate_batch(self, scores: Sequence[float]) -> list[float]:
        """Calibrate a sequence of raw confidence scores."""
        return [self.calibrate(s) for s in scores]

    def fit(
        self,
        scores: Sequence[float],
        labels: Sequence[int],
        *,
        l2_reg: float = 0.05,
    ) -> PlattCalibrator:
        """Fit Platt scaling parameters (a, b) using L-BFGS-B optimization."""
        if len(scores) != len(labels):
            raise ValueError("scores and labels must have the same length")
        if not scores:
            return self

        import numpy as np
        from scipy.optimize import minimize

        z_arr = np.array([_logit(s) for s in scores], dtype=np.float64)
        y_arr = np.array([float(y) for y in labels], dtype=np.float64)

        def objective(params: np.ndarray) -> float:
            a_val, b_val = float(params[0]), float(params[1])
            logits = np.clip(a_val * z_arr + b_val, -30.0, 30.0)
            probs = 1.0 / (1.0 + np.exp(-logits))
            probs = np.clip(probs, 1e-6, 1.0 - 1e-6)
            nll = -np.mean(y_arr * np.log(probs) + (1.0 - y_arr) * np.log(1.0 - probs))
            brier = float(np.mean((probs - y_arr) ** 2))
            reg = l2_reg * ((a_val - 1.0) ** 2 + b_val ** 2)
            return float(0.7 * nll + 0.3 * brier + reg)

        res = minimize(
            objective,
            x0=np.array([1.0, 0.0], dtype=np.float64),
            bounds=[(0.2, 5.0), (-4.0, 4.0)],
            method="L-BFGS-B",
        )
        if res.success:
            self.a = round(float(res.x[0]), 6)
            self.b = round(float(res.x[1]), 6)
        return self

    def to_dict(self) -> dict[str, float]:
        return {
            "a": round(self.a, 6),
            "b": round(self.b, 6),
            "min_prob": self.min_prob,
            "max_prob": self.max_prob,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> PlattCalibrator:
        return cls(
            a=float(data.get("a", 1.0)),
            b=float(data.get("b", 0.0)),
            min_prob=float(data.get("min_prob", 0.01)),
            max_prob=float(data.get("max_prob", 0.99)),
        )


DEFAULT_WEIGHTS_PATH = (
    Path(__file__).resolve().parents[3] / "data" / "models" / "neuro_symbolic_weights.json"
)


class HybridMLScorer:
    """Hybrid Neuro-Symbolic Multinomial Logistic Regression + Platt Calibrator.

    Combines 15 neural, lexical, and symbolic-interaction features extracted from
    MatchFeatures to predict class probabilities across the 4 canonical labels:
        - verified
        - metadata_error
        - suspected_hallucination
        - unresolved

    Designed to work in tandem with SymbolicRules:
        1. Symbolic hard-kill rules act as strict guardrails (explainable rule IDs).
        2. HybridMLScorer provides continuous multi-class probability density
           P_ML(y | x) and Platt-calibrated confidence scores.
    """

    CLASSES: tuple[str, ...] = (
        "verified",
        "metadata_error",
        "suspected_hallucination",
        "unresolved",
    )

    FEATURE_NAMES: tuple[str, ...] = (
        "title_sim_fuzzy",
        "title_sim_semantic",
        "title_sim_max",
        "author_jaccard",
        "year_match_score",
        "doi_exact_match",
        "source_consensus_norm",
        "venue_sim",
        "content_alignment_signal",
        "has_candidate",
        "title_x_author",
        "title_x_year",
        "title_mismatch_author",
        "title_mismatch_year",
        "doi_mismatch_title",
        "abstention_zone_indicator",
    )

    def __init__(
        self,
        weights: list[list[float]] | None = None,
        bias: list[float] | None = None,
        classes: Sequence[str] | None = None,
        platt: PlattCalibrator | None = None,
        symbolic_blend_alpha: float = 0.72,
        training_metadata: dict[str, Any] | None = None,
    ) -> None:
        self.classes: list[str] = list(classes or self.CLASSES)
        self.weights: list[list[float]] = weights or self._default_weights()
        self.bias: list[float] = bias or self._default_bias()
        self.platt: PlattCalibrator = platt or PlattCalibrator(a=1.0, b=0.0)
        self.symbolic_blend_alpha: float = symbolic_blend_alpha
        self.training_metadata: dict[str, Any] = training_metadata or {}

    @classmethod
    def _default_weights(cls) -> list[list[float]]:
        """Prior analytical weights before fitting on empirical dataset."""
        # Order of features:
        # [0] title_fuzzy, [1] title_sem, [2] title_max, [3] author_jaccard,
        # [4] year_match, [5] doi_exact, [6] consensus_norm, [7] venue_sim,
        # [8] content_signal, [9] has_candidate, [10] title_x_author,
        # [11] title_x_year, [12] title_mismatch_author, [13] title_mismatch_year,
        # [14] doi_mismatch_title, [15] abstention_zone
        return [
            # verified
            [1.8, 2.0, 2.5, 2.2, 1.8, 3.2, 1.4, 0.8, 1.2, 1.5, 2.8, 2.5, -2.5, -2.5, -2.8, -3.0],
            # metadata_error
            [0.8, 1.0, 1.4, -0.8, -0.6, 0.4, 0.5, 0.2, -1.0, 1.5, -1.2, -1.0, 3.6, 3.6, 3.8, -1.5],
            # suspected_hallucination
            [-2.2, -2.4, -2.8, -2.0, -1.5, -4.0, -1.8, -0.8, -0.8, -2.2, -2.5, -2.2, -0.5, -0.5, -1.0, -2.0],
            # unresolved
            [-0.4, -0.4, -0.2, -0.5, -0.2, -2.5, -1.0, -0.2, 0.0, 0.2, -1.0, -0.8, 0.2, 0.2, -1.0, 4.5],
        ]

    @classmethod
    def _default_bias(cls) -> list[float]:
        return [-3.2, -1.2, 2.2, -0.8]

    @staticmethod
    def extract_feature_vector(
        features: Any,
        *,
        has_candidate: bool | None = None,
    ) -> list[float]:
        """Extract 16-dimensional normalized feature vector from MatchFeatures or dict."""
        if isinstance(features, dict):
            tf = float(features.get("title_sim_fuzzy", 0.0) or 0.0)
            ts = float(features.get("title_sim_semantic", 0.0) or 0.0)
            aj = float(features.get("author_jaccard", 0.0) or 0.0)
            yd_raw = features.get("year_distance", 999)
            yd = int(yd_raw if yd_raw is not None else 999)
            doi_ok = 1.0 if features.get("doi_exact_match", False) else 0.0
            consensus = int(features.get("source_consensus", 0) or 0)
            venue = float(features.get("venue_sim", 0.0) or 0.0)
            ca_score = float(features.get("content_alignment_score", 0.0) or 0.0)
            ca_conf = str(features.get("content_alignment_confidence", "") or "")
            ca_aligned = bool(features.get("content_is_aligned", False))
            if has_candidate is None:
                has_cand = 1.0 if (
                    features.get("has_candidate")
                    or consensus > 0
                    or tf > 0.0
                    or ts > 0.0
                    or doi_ok > 0.0
                ) else 0.0
            else:
                has_cand = 1.0 if has_candidate else 0.0
        else:
            tf = float(getattr(features, "title_sim_fuzzy", 0.0) or 0.0)
            ts = float(getattr(features, "title_sim_semantic", 0.0) or 0.0)
            aj = float(getattr(features, "author_jaccard", 0.0) or 0.0)
            yd_raw = getattr(features, "year_distance", 999)
            yd = int(yd_raw if yd_raw is not None else 999)
            doi_ok = 1.0 if getattr(features, "doi_exact_match", False) else 0.0
            consensus = int(getattr(features, "source_consensus", 0) or 0)
            venue = float(getattr(features, "venue_sim", 0.0) or 0.0)
            ca_score = float(getattr(features, "content_alignment_score", 0.0) or 0.0)
            ca_conf = str(getattr(features, "content_alignment_confidence", "") or "")
            ca_aligned = bool(getattr(features, "content_is_aligned", False))
            if has_candidate is None:
                has_cand = 1.0 if (consensus > 0 or tf > 0.0 or ts > 0.0 or doi_ok > 0.0) else 0.0
            else:
                has_cand = 1.0 if has_candidate else 0.0

        t_max = max(tf, ts)
        abs_yd = abs(yd)
        if abs_yd >= 50:
            year_match = 0.0
        else:
            year_match = math.exp(-0.5 * min(abs_yd, 10))

        consensus_norm = min(max(consensus, 0), 4) / 4.0

        content_signal = 0.0
        if ca_aligned and ca_score >= 0.45:
            content_signal = ca_score
        elif ca_conf == "high" and not ca_aligned and ca_score > 0.0 and ca_score < 0.25:
            content_signal = -0.6

        title_x_author = t_max * aj
        title_x_year = t_max * year_match
        title_mismatch_author = t_max * (1.0 - aj) if t_max >= 0.60 else 0.0
        title_mismatch_year = t_max * (1.0 - year_match) if t_max >= 0.60 else 0.0
        doi_mismatch_title = doi_ok * (1.0 - t_max)
        abstention_zone = 1.0 if (0.40 <= t_max < 0.60 and doi_ok == 0.0 and has_cand > 0.0) else 0.0

        return [
            round(tf, 6),
            round(ts, 6),
            round(t_max, 6),
            round(aj, 6),
            round(year_match, 6),
            round(doi_ok, 6),
            round(consensus_norm, 6),
            round(venue, 6),
            round(content_signal, 6),
            round(has_cand, 6),
            round(title_x_author, 6),
            round(title_x_year, 6),
            round(title_mismatch_author, 6),
            round(title_mismatch_year, 6),
            round(doi_mismatch_title, 6),
            round(abstention_zone, 6),
        ]

    def predict_proba(
        self,
        features: Any,
        *,
        has_candidate: bool | None = None,
    ) -> dict[str, float]:
        """Compute softmax class probability distribution over the 4 labels."""
        x = self.extract_feature_vector(features, has_candidate=has_candidate)
        logits: list[float] = []
        for row_w, b_val in zip(self.weights, self.bias):
            z = sum(w_i * x_i for w_i, x_i in zip(row_w, x)) + b_val
            logits.append(z)

        max_logit = max(logits) if logits else 0.0
        exps = [math.exp(max(-60.0, z - max_logit)) for z in logits]
        sum_exps = sum(exps) or 1.0
        probs = [e / sum_exps for e in exps]
        return {cls_name: probs[idx] for idx, cls_name in enumerate(self.classes)}

    def predict(
        self,
        features: Any,
        *,
        has_candidate: bool | None = None,
    ) -> tuple[str, float, dict[str, float]]:
        """Return (predicted_label, calibrated_confidence, probabilities_dict)."""
        probs = self.predict_proba(features, has_candidate=has_candidate)
        best_label = max(probs, key=lambda k: probs[k])
        raw_prob = probs[best_label]
        cal_conf = self.platt.calibrate(raw_prob)
        return best_label, cal_conf, probs

    def calibrate_verdict_confidence(
        self,
        symbolic_label: str,
        symbolic_confidence: float,
        features: Any,
        *,
        has_candidate: bool | None = None,
        style_penalty: float = 0.0,
    ) -> float:
        """Blend symbolic confidence with ML class probability and apply Platt scaling.

        Preserves deterministic boundary invariants:
            - Zero confidence (e.g. R-FAIL-ALL) stays 0.0.
            - Style penalty strictly reduces confidence compared to unpenalized baseline.
        """
        if symbolic_confidence <= 0.0:
            return 0.0

        # Recover unpenalized symbolic base confidence before blending
        base_sym = min(0.99, symbolic_confidence + max(0.0, style_penalty))
        probs = self.predict_proba(features, has_candidate=has_candidate)
        label_key = symbolic_label.lower()
        ml_prob = probs.get(label_key, base_sym)

        # If a hard-kill symbolic rule fired (e.g. fake URL/DOI/future year where
        # features may be empty), keep high symbolic confidence authority
        alpha = self.symbolic_blend_alpha
        if abs(base_sym - ml_prob) > 0.45 and base_sym >= 0.85:
            alpha = 0.90

        blended = alpha * base_sym + (1.0 - alpha) * ml_prob
        calibrated = self.platt.calibrate(blended)

        if style_penalty > 0.0:
            calibrated = max(0.05, calibrated - style_penalty)

        return round(calibrated, 4)

    def fit(
        self,
        feature_records: Sequence[Any],
        labels: Sequence[str],
        *,
        c_reg: float = 2.0,
        max_iter: int = 1000,
    ) -> HybridMLScorer:
        """Fit multinomial logistic regression weights + Platt calibrator on labeled samples."""
        if len(feature_records) != len(labels):
            raise ValueError("feature_records and labels must have the same length")
        if not feature_records:
            raise ValueError("Cannot fit HybridMLScorer on empty dataset")

        import numpy as np
        from sklearn.linear_model import LogisticRegression

        X = np.array(
            [self.extract_feature_vector(rec) for rec in feature_records],
            dtype=np.float64,
        )
        label_to_idx = {c: idx for idx, c in enumerate(self.classes)}
        y = np.array([label_to_idx[str(lbl).lower()] for lbl in labels], dtype=np.int64)

        clf = LogisticRegression(
            C=c_reg,
            max_iter=max_iter,
            class_weight="balanced",
            random_state=42,
        )
        clf.fit(X, y)

        n_classes = len(self.classes)
        n_features = X.shape[1]
        full_weights = np.zeros((n_classes, n_features), dtype=np.float64)
        full_bias = np.zeros(n_classes, dtype=np.float64)

        if len(clf.classes_) == 2:
            # Binary fallback if only 2 classes present in subset
            c0, c1 = int(clf.classes_[0]), int(clf.classes_[1])
            full_weights[c1] = clf.coef_[0]
            full_weights[c0] = -clf.coef_[0]
            full_bias[c1] = clf.intercept_[0]
            full_bias[c0] = -clf.intercept_[0]
        else:
            for idx_pos, cls_idx in enumerate(clf.classes_):
                full_weights[int(cls_idx)] = clf.coef_[idx_pos]
                full_bias[int(cls_idx)] = clf.intercept_[idx_pos]

        self.weights = [
            [round(float(v), 6) for v in row] for row in full_weights
        ]
        self.bias = [round(float(b), 6) for b in full_bias]

        # Fit PlattCalibrator on predicted max probabilities vs correctness
        raw_max_probs: list[float] = []
        is_correct_list: list[int] = []
        for rec, true_lbl in zip(feature_records, labels):
            probs = self.predict_proba(rec)
            pred_lbl = max(probs, key=lambda k: probs[k])
            raw_max_probs.append(probs[pred_lbl])
            is_correct_list.append(1 if pred_lbl == str(true_lbl).lower() else 0)

        self.platt = PlattCalibrator().fit(raw_max_probs, is_correct_list)
        return self

    def to_dict(self) -> dict[str, Any]:
        return {
            "version": "1.0",
            "model_type": "HybridMLScorer_MultinomialLogistic_Platt",
            "classes": self.classes,
            "feature_names": list(self.FEATURE_NAMES),
            "symbolic_blend_alpha": self.symbolic_blend_alpha,
            "weights": self.weights,
            "bias": self.bias,
            "platt_calibrator": self.platt.to_dict(),
            "training_metadata": self.training_metadata,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> HybridMLScorer:
        platt_data = data.get("platt_calibrator") or {}
        return cls(
            weights=data.get("weights"),
            bias=data.get("bias"),
            classes=data.get("classes") or cls.CLASSES,
            platt=PlattCalibrator.from_dict(platt_data),
            symbolic_blend_alpha=float(data.get("symbolic_blend_alpha", 0.72)),
            training_metadata=data.get("training_metadata") or {},
        )

    def save(self, path: Path | str = DEFAULT_WEIGHTS_PATH) -> Path:
        target = Path(path)
        target.parent.mkdir(parents=True, exist_ok=True)
        with open(target, "w", encoding="utf-8") as f:
            json.dump(self.to_dict(), f, indent=2, ensure_ascii=False)
        return target

    @classmethod
    def load(cls, path: Path | str = DEFAULT_WEIGHTS_PATH) -> HybridMLScorer:
        target = Path(path)
        with open(target, encoding="utf-8") as f:
            data = json.load(f)
        return cls.from_dict(data)

    @classmethod
    def load_default(cls, path: Path | str = DEFAULT_WEIGHTS_PATH) -> HybridMLScorer:
        target = Path(path)
        if target.exists():
            try:
                return cls.load(target)
            except Exception:
                return cls()
        return cls()
