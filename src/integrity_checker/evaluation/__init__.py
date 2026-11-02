"""Evaluation module — metrics, baselines, report (tuần 16–17)."""

from integrity_checker.evaluation.baselines import BaselineRunner
from integrity_checker.evaluation.metrics import MetricsCalculator
from integrity_checker.evaluation.report import EvaluationReport

__all__ = ["MetricsCalculator", "BaselineRunner", "EvaluationReport"]
