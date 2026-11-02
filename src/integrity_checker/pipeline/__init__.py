"""Pipeline module — end-to-end orchestrator: PDF → AnalysisReport."""

from integrity_checker.pipeline.integrity_pipeline import (
    AnalysisReport,
    IntegrityPipeline,
    main,
)

__all__ = ["AnalysisReport", "IntegrityPipeline", "main"]
