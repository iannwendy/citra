from __future__ import annotations

import tracemalloc
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest

from integrity_checker.api.progress import (
    STEP_KEYS,
    DeadlineQueueManager,
    PipelineAdmissionController,
    get_deadline_queue_manager,
    get_pipeline_admission_controller,
)
from integrity_checker.evaluation.performance_benchmark import (
    PipelineStepProfiler,
    compute_percentiles,
)
from integrity_checker.extraction.document_parser import DocumentParser
from integrity_checker.models.source import SourceCandidate, SourceResult
from integrity_checker.pipeline.integrity_pipeline import IntegrityPipeline


def test_deadline_queue_manager_alias_and_singleton() -> None:
    assert DeadlineQueueManager is PipelineAdmissionController
    assert get_deadline_queue_manager() is get_pipeline_admission_controller()
    mgr = DeadlineQueueManager(max_concurrent=4)
    assert mgr.max_concurrent == 4
    assert mgr.active_count == 0
    assert mgr.waiting_count == 0


def test_document_parser_records_distinct_parsing_and_extracting_telemetry(
    tmp_path: Path,
) -> None:
    import fitz

    pdf_path = tmp_path / "sample_telemetry.pdf"
    doc = fitz.open()
    p1 = doc.new_page()
    p1.insert_text(
        (72, 72),
        "1. Introduction\nTransformers rely on self-attention (Vaswani et al., 2017).\n",
    )
    p2 = doc.new_page()
    p2.insert_text(
        (72, 72),
        "References\nVaswani, A., Shazeer, N., Parmar, N., et al. (2017). Attention Is All You Need. NeurIPS.\n",
    )
    doc.save(str(pdf_path))
    doc.close()

    parser = DocumentParser()
    parser.config.extraction.grobid.enabled = False
    parsed = parser.parse(str(pdf_path), use_service_manager=False)

    telemetry = (parsed.document.metadata or {}).get("_step_telemetry")
    assert isinstance(telemetry, dict)
    assert telemetry["parsing_ms"] > 0.0
    assert telemetry["extracting_ms"] > 0.0
    assert telemetry["parsing_peak_mb"] >= 0.0
    assert telemetry["extracting_peak_mb"] >= 0.0


def test_document_parser_bib_ris_and_corrupted_pdf_still_populate_safe_step_telemetry(
    tmp_path: Path,
) -> None:
    bib_path = tmp_path / "refs.bib"
    bib_path.write_text(
        "@article{vaswani2017,\n  title={Attention Is All You Need},\n  author={Vaswani, Ashish},\n  year={2017}\n}\n",
        encoding="utf-8",
    )
    bad_pdf = tmp_path / "corrupted.pdf"
    bad_pdf.write_bytes(b"not-a-valid-pdf-binary")

    parser = DocumentParser()
    parser.config.extraction.grobid.enabled = False

    parsed_bib = parser.parse(str(bib_path), use_service_manager=False)
    bib_tel = (parsed_bib.document.metadata or {}).get("_step_telemetry")
    assert isinstance(bib_tel, dict)
    assert set(bib_tel.keys()) == {
        "parsing_ms",
        "extracting_ms",
        "parsing_peak_mb",
        "extracting_peak_mb",
    }
    assert all(isinstance(v, float) and v >= 0.0 for v in bib_tel.values())

    parsed_bad = parser.parse(str(bad_pdf), use_service_manager=False)
    bad_tel = (parsed_bad.document.metadata or {}).get("_step_telemetry")
    assert isinstance(bad_tel, dict)
    assert all(isinstance(v, float) and v >= 0.0 for v in bad_tel.values())


def test_compute_percentiles_exact_interpolation_and_edge_cases() -> None:
    empty = compute_percentiles([])
    assert empty.samples == 0
    assert empty.p50 == 0.0 and empty.p90 == 0.0 and empty.p99 == 0.0

    single = compute_percentiles([42.5])
    assert single.samples == 1
    assert single.p50 == 42.5 and single.p90 == 42.5 and single.p99 == 42.5
    assert single.std == 0.0

    stats = compute_percentiles([10.0, 20.0, 30.0, 40.0, 50.0, 60.0, 70.0, 80.0, 90.0, 100.0])
    assert stats.samples == 10
    assert stats.min == 10.0
    assert stats.max == 100.0
    assert stats.p50 == pytest.approx(55.0, rel=1e-3)
    assert stats.p90 == pytest.approx(91.0, rel=1e-3)
    assert stats.p99 == pytest.approx(99.1, rel=1e-3)
    assert stats.p50 <= stats.p90 <= stats.p99


def test_pipeline_step_profiler_captures_all_8_steps_and_reconciles_document_parser_telemetry(
    tmp_path: Path,
) -> None:
    import fitz

    pdf_path = tmp_path / "profile_8_steps.pdf"
    doc = fitz.open()
    p1 = doc.new_page()
    p1.insert_text(
        (72, 72),
        "1. Introduction\nDeep learning transformed NLP (Vaswani et al., 2017).\n",
    )
    p2 = doc.new_page()
    p2.insert_text(
        (72, 72),
        "References\nVaswani, A., Shazeer, N., & Parmar, N. (2017). Attention Is All You Need. NeurIPS.\n",
    )
    doc.save(str(pdf_path))
    doc.close()

    mock_orch = MagicMock()
    mock_orch.retrieve = AsyncMock(
        return_value=SourceResult(
            citation_raw="Vaswani et al. (2017)",
            candidates=[
                SourceCandidate(
                    source_name="local_db",
                    found=True,
                    title="Attention Is All You Need",
                    authors=["Ashish Vaswani", "Noam Shazeer", "Niki Parmar"],
                    year=2017,
                    abstract="We propose the Transformer, a model architecture eschewing recurrence and relying on attention.",
                    confidence=0.98,
                    score=0.98,
                )
            ],
            sources_queried=["local_db"],
            sources_succeeded=["local_db"],
        )
    )
    dp = DocumentParser()
    dp.config.extraction.grobid.enabled = False
    pipeline = IntegrityPipeline(
        document_parser=dp,
        orchestrator=mock_orch,
        use_report_cache=False,
    )

    profiler = PipelineStepProfiler()
    profile = profiler.profile_run(pipeline, pdf_path, essay_id="prof-1")

    assert profile.num_pages == 2
    assert len(profile.steps) == 8
    assert [s.step_key for s in profile.steps] == STEP_KEYS
    assert [s.step_index for s in profile.steps] == list(range(8))
    for step_rec in profile.steps:
        assert step_rec.latency_ms > 0.0
        assert step_rec.peak_alloc_mb >= 0.0
        assert step_rec.rss_mb > 0.0
    # Step 2 (extracting, index 2) must include the DocumentParser extraction sub-step latency
    assert profile.steps[2].latency_ms >= 0.05
    assert sum(s.latency_ms for s in profile.steps) == pytest.approx(
        profile.total_latency_ms, rel=0.05
    )


def test_pipeline_step_profiler_preserves_preexisting_tracemalloc_session(
    tmp_path: Path,
) -> None:
    import fitz

    pdf_path = tmp_path / "tracemalloc_preserve.pdf"
    doc = fitz.open()
    page = doc.new_page()
    page.insert_text((72, 72), "Short body text without citations.")
    doc.save(str(pdf_path))
    doc.close()

    dp = DocumentParser()
    dp.config.extraction.grobid.enabled = False
    pipeline = IntegrityPipeline(document_parser=dp, use_report_cache=False)

    was_tracing = tracemalloc.is_tracing()
    if not was_tracing:
        tracemalloc.start()
    try:
        profiler = PipelineStepProfiler()
        _ = profiler.profile_run(pipeline, pdf_path, essay_id="tm-preserve")
        assert tracemalloc.is_tracing() is True
    finally:
        if not was_tracing and tracemalloc.is_tracing():
            tracemalloc.stop()

