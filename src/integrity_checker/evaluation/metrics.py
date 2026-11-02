"""Metrics — precision, recall, F1, macro-F1, confusion matrix."""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass


@dataclass
class MetricsResult:
    precision: float
    recall: float
    f1: float
    accuracy: float
    macro_f1: float
    confusion_matrix: dict[str, dict[str, int]]  # {true_label: {pred_label: count}}
    support: dict[str, int]  # số sample thật cho mỗi label
    num_samples: int


class MetricsCalculator:
    """Tính per-class + macro metrics cho 4 nhãn taxonomy."""

    LABELS = ["verified", "metadata_error", "suspected_hallucination", "unresolved"]

    @classmethod
    def compute(cls, y_true: list[str], y_pred: list[str]) -> MetricsResult:
        assert len(y_true) == len(y_pred), "Mismatched lengths"
        n = len(y_true)
        if n == 0:
            return MetricsResult(0, 0, 0, 0, 0, {}, {}, 0)

        # Per-class
        per_class: dict[str, dict[str, float]] = {}
        cm: dict[str, dict[str, int]] = {lbl: {p: 0 for p in cls.LABELS} for lbl in cls.LABELS}
        support: dict[str, int] = Counter()

        for t, p in zip(y_true, y_pred, strict=False):
            if t in cm:
                cm[t][p] = cm.get(t, {}).get(p, 0) + 1
            support[t] += 1

        for label in cls.LABELS:
            tp = cm[label][label]
            fp = sum(cm[other][label] for other in cls.LABELS if other != label)
            fn = sum(cm[label][other] for other in cls.LABELS if other != label)
            prec = tp / (tp + fp) if (tp + fp) > 0 else 0.0
            rec = tp / (tp + fn) if (tp + fn) > 0 else 0.0
            f1 = 2 * prec * rec / (prec + rec) if (prec + rec) > 0 else 0.0
            per_class[label] = {"precision": prec, "recall": rec, "f1": f1}

        # Macro
        macro_f1 = sum(per_class[lbl]["f1"] for lbl in cls.LABELS) / len(cls.LABELS)
        # Accuracy
        correct = sum(1 for t, p in zip(y_true, y_pred, strict=False) if t == p)
        accuracy = correct / n

        # Micro (precision = recall = accuracy khi đếm per-sample)
        # dùng macro F1 làm headline metric
        return MetricsResult(
            precision=sum(per_class[lbl]["precision"] for lbl in cls.LABELS) / len(cls.LABELS),
            recall=sum(per_class[lbl]["recall"] for lbl in cls.LABELS) / len(cls.LABELS),
            f1=macro_f1,
            accuracy=accuracy,
            macro_f1=macro_f1,
            confusion_matrix=cm,
            support=dict(support),
            num_samples=n,
        )
