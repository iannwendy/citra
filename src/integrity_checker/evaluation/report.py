"""Evaluation report — formatter cho bảng so sánh."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass
class EvaluationReport:
    """Báo cáo cuối — hiển thị bảng so sánh baselines."""

    results: dict[str, dict]  # baseline_name → metrics

    def to_markdown(self) -> str:
        if not self.results:
            return "_No results yet_"
        lines = ["| Baseline | Precision | Recall | F1 | Accuracy | Macro-F1 |", "|---|---|---|---|---|---|"]
        for name, m in self.results.items():
            lines.append(
                f"| {name} | {m.get('precision', 0):.2%} | {m.get('recall', 0):.2%} | "
                f"{m.get('f1', 0):.2%} | {m.get('accuracy', 0):.2%} | "
                f"{m.get('macro_f1', 0):.2%} |"
            )
        return "\n".join(lines)
