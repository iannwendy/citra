"""Evaluation module — metrics, baselines, report, performance benchmark (tuần 16–17)."""

from integrity_checker.evaluation.baselines import BaselineRunner
from integrity_checker.evaluation.metrics import MetricsCalculator
from integrity_checker.evaluation.performance_benchmark import (
    DEFAULT_DOCUMENT_SCALE_TIERS,
    ControlledDeterministicOrchestrator,
    DeadlineBurstStressResult,
    DocumentScaleBenchmarkResult,
    DocumentScaleTierSpec,
    PercentileStats,
    PipelineStepProfiler,
    SinglePipelineRunProfile,
    SingleRunStepRecord,
    StepBenchmarkMetrics,
    compute_percentiles,
    resolve_or_synthesize_tier_pdf,
    run_deadline_burst_benchmark,
    run_document_scale_benchmark,
)
from integrity_checker.evaluation.report import EvaluationReport

__all__ = [
    "MetricsCalculator",
    "BaselineRunner",
    "EvaluationReport",
    "DEFAULT_DOCUMENT_SCALE_TIERS",
    "ControlledDeterministicOrchestrator",
    "DeadlineBurstStressResult",
    "DocumentScaleBenchmarkResult",
    "DocumentScaleTierSpec",
    "PercentileStats",
    "PipelineStepProfiler",
    "SinglePipelineRunProfile",
    "SingleRunStepRecord",
    "StepBenchmarkMetrics",
    "compute_percentiles",
    "resolve_or_synthesize_tier_pdf",
    "run_deadline_burst_benchmark",
    "run_document_scale_benchmark",
]
