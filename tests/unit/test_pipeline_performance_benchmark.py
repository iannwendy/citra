from __future__ import annotations

import json
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
from integrity_checker.config import get_settings
from integrity_checker.evaluation.performance_benchmark import (
    ColdVsWarmCacheBenchmarkResult,
    ControlledDeterministicOrchestrator,
    DocumentScaleTierSpec,
    FullPerformanceBenchmarkReport,
    HttpMultipartBurstResult,
    PipelineStepProfiler,
    compute_percentiles,
    format_benchmark_latex_tables,
    format_benchmark_markdown,
    resolve_or_synthesize_tier_pdf,
    run_cold_vs_warm_cache_benchmark,
    run_deadline_burst_benchmark,
    run_document_scale_benchmark,
    run_http_multipart_burst_benchmark,
)
from integrity_checker.extraction.document_parser import DocumentParser
from integrity_checker.models.citation import Citation, CitationType
from integrity_checker.models.source import SourceCandidate, SourceResult
from integrity_checker.pipeline.integrity_pipeline import IntegrityPipeline
from scripts.benchmark_pipeline_performance import main as benchmark_cli_main


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


@pytest.mark.asyncio
async def test_controlled_deterministic_orchestrator_uses_local_fts5_and_recovers_simulated_429() -> None:
    orch = ControlledDeterministicOrchestrator(
        seed=42,
        simulated_api_latency_ms=(2.0, 5.0),
        rate_limit_429_every_n=3,
    )
    citations = [
        Citation(
            raw_text=f"[{i}] Vaswani, A. et al. (2017). Attention Is All You Need. NeurIPS.",
            citation_type=CitationType.REFERENCE_LIST,
            title="Attention Is All You Need",
            authors=["Vaswani, A.", "Shazeer, N."],
            year=2017,
            doi=f"10.5555/test.{i}",
        )
        for i in range(1, 7)
    ]
    results = [await orch.retrieve(c) for c in citations]
    assert len(results) == 6
    assert all(r.best_candidate() is not None for r in results)
    assert orch.simulated_429_count >= 2
    assert orch.recovered_429_count == orch.simulated_429_count
    assert orch.unhandled_error_count == 0


def test_resolve_tier_pdf_falls_back_to_synthetic_pdf_when_candidate_files_missing(
    tmp_path: Path,
) -> None:
    import fitz

    missing_tier = DocumentScaleTierSpec(
        tier_id="synthetic_10p",
        label_vi="Bài báo ngắn (10 trang)",
        label_en="Short Paper (10 pages)",
        target_pages=10,
        target_refs=8,
        candidate_paths=("nonexistent_folder/missing_10p.pdf",),
    )
    resolved = resolve_or_synthesize_tier_pdf(missing_tier, fallback_dir=tmp_path)
    assert resolved.is_file()
    doc = fitz.open(str(resolved))
    assert len(doc) == 10
    doc.close()


def test_run_document_scale_benchmark_across_three_tiers_produces_monotonic_page_and_step_stats(
    tmp_path: Path,
) -> None:
    tiers = (
        DocumentScaleTierSpec(
            tier_id="short_10p",
            label_vi="Bài báo ngắn (10 trang)",
            label_en="Short Paper (10 pp.)",
            target_pages=10,
            target_refs=6,
            candidate_paths=("nonexistent/short_10p.pdf",),
        ),
        DocumentScaleTierSpec(
            tier_id="thesis_50p",
            label_vi="Khóa luận (50 trang)",
            label_en="Bachelor Thesis (50 pp.)",
            target_pages=50,
            target_refs=12,
            candidate_paths=("nonexistent/thesis_50p.pdf",),
        ),
    )
    results = run_document_scale_benchmark(
        tiers=tiers,
        iterations=2,
        warmup_runs=0,
        seed=42,
        use_real_sbert=False,
        fallback_dir=tmp_path,
    )
    assert len(results) == 2
    assert results[0].num_pages == 10
    assert results[1].num_pages == 50
    for res in results:
        assert len(res.steps) == 8
        assert res.total_latency_ms.p50 > 0.0
        assert res.total_latency_ms.p90 >= res.total_latency_ms.p50
        assert res.total_latency_ms.p99 >= res.total_latency_ms.p90
        assert res.peak_rss_mb > 0.0


def test_deadline_burst_benchmark_20_and_50_students_zero_sqlite_locks_and_zero_502_429(
    tmp_path: Path,
) -> None:
    results = run_deadline_burst_benchmark(
        concurrency_levels=(20, 50),
        max_concurrent_workers=3,
        citations_per_submission=6,
        simulated_api_latency_ms=(1.0, 2.5),
        db_dir=tmp_path,
        seed=42,
    )
    assert len(results) == 2

    res_20, res_50 = results[0], results[1]
    for res, expected_n in ((res_20, 20), (res_50, 50)):
        assert res.concurrency == expected_n
        assert res.total_submissions == expected_n
        assert res.completed_submissions == expected_n
        assert res.failed_submissions == 0
        assert res.success_rate_pct == 100.0
        assert res.peak_active_workers == 3
        assert res.peak_queue_depth == expected_n - 3
        assert res.fifo_order_preserved is True
        assert res.sqlite_locked_errors == 0
        assert res.http_429_simulated > 0
        assert res.http_429_recovered == res.http_429_simulated
        assert res.unhandled_http_502_429_errors == 0
        assert res.throughput_essays_per_sec > 0.0
        assert res.throughput_citations_per_sec > 0.0
        assert res.queue_wait_ms.p50 <= res.queue_wait_ms.p90 <= res.queue_wait_ms.p99


def test_deadline_burst_benchmark_restores_original_database_url_after_completion(
    tmp_path: Path,
) -> None:
    settings = get_settings()
    original_url = settings.database.url

    _ = run_deadline_burst_benchmark(
        concurrency_levels=(5,),
        max_concurrent_workers=2,
        citations_per_submission=4,
        simulated_api_latency_ms=(0.5, 1.0),
        db_dir=tmp_path,
        seed=99,
    )
    assert get_settings().database.url == original_url


def test_format_benchmark_markdown_and_latex_tables_contain_all_steps_and_labels(
    tmp_path: Path,
) -> None:
    tiers = (
        DocumentScaleTierSpec(
            tier_id="short_10p",
            label_vi="Bài báo ngắn (10 trang)",
            label_en="Short Paper (10 pp.)",
            target_pages=10,
            target_refs=5,
            candidate_paths=("nonexistent/short.pdf",),
        ),
    )
    scale_res = run_document_scale_benchmark(
        tiers=tiers,
        iterations=1,
        warmup_runs=0,
        use_real_sbert=False,
        fallback_dir=tmp_path,
    )
    stress_res = run_deadline_burst_benchmark(
        concurrency_levels=(20,),
        max_concurrent_workers=3,
        citations_per_submission=4,
        simulated_api_latency_ms=(0.5, 1.0),
        db_dir=tmp_path,
    )
    report = FullPerformanceBenchmarkReport(
        generated_at="2026-11-10T14:00:00Z",
        environment={"python": "3.11", "platform": "macOS"},
        scale_benchmarks=scale_res,
        deadline_stress_benchmarks=stress_res,
    )

    md = format_benchmark_markdown(report)
    assert "P50" in md and "P90" in md and "P99" in md
    assert "DeadlineQueueManager" in md
    for key in STEP_KEYS:
        assert key in md

    latex = format_benchmark_latex_tables(report)
    assert r"\begin{longtable}" in latex
    assert r"\label{tab:nfr-step-latency}" in latex
    assert r"\label{tab:nfr-deadline-stress}" in latex
    assert r"$P_{50}$" in latex and r"$P_{90}$" in latex and r"$P_{99}$" in latex


def test_cli_benchmark_script_quick_mode_writes_json_md_and_tex_artifacts(
    tmp_path: Path,
) -> None:
    out_dir = tmp_path / "bench_out"
    rc = benchmark_cli_main(
        [
            "--quick",
            "--output-dir",
            str(out_dir),
        ]
    )
    assert rc == 0
    json_file = out_dir / "pipeline_performance_benchmark.json"
    md_file = out_dir / "pipeline_performance_benchmark.md"
    tex_file = out_dir / "chapter5_nfr_tables.tex"

    assert json_file.is_file()
    assert md_file.is_file()
    assert tex_file.is_file()

    payload = json.loads(json_file.read_text(encoding="utf-8"))
    assert len(payload["scale_benchmarks"]) == 3
    assert len(payload["deadline_stress_benchmarks"]) == 2
    assert payload.get("cold_vs_warm_cache") is not None
    assert len(payload.get("http_multipart_stress_benchmarks", [])) == 2


def test_run_cold_vs_warm_cache_benchmark_computes_speedup_and_handles_wan_or_fallback(
    tmp_path: Path,
) -> None:
    tier = DocumentScaleTierSpec(
        tier_id="short_10p",
        label_vi="Bài báo ngắn (~10 trang)",
        label_en="Short Research Article (~10 pp.)",
        target_pages=8,
        target_refs=6,
        candidate_paths=("nonexistent/short.pdf",),
    )
    res: ColdVsWarmCacheBenchmarkResult = run_cold_vs_warm_cache_benchmark(
        tier=tier,
        use_live_wan=False,
        simulated_wan_latency_ms=(35.0, 55.0),
        use_real_sbert=False,
        fallback_dir=tmp_path,
        seed=42,
    )
    assert res.tier_id == "short_10p"
    assert res.num_pages >= 8
    assert res.num_references >= 4
    assert res.cold_retrieving_ms > res.warm_retrieving_ms
    assert res.cold_total_ms > res.warm_total_ms
    assert res.retrieval_speedup_x > 1.2
    assert res.end_to_end_speedup_x > 1.05
    assert res.wan_queries_executed > 0


def test_run_http_multipart_burst_benchmark_20_and_50_students_via_fastapi_routes(
    tmp_path: Path,
) -> None:
    results: list[HttpMultipartBurstResult] = run_http_multipart_burst_benchmark(
        concurrency_levels=(20, 50),
        max_concurrent_workers=3,
        use_real_sbert=False,
        simulated_api_latency_ms=(0.5, 1.5),
        db_dir=tmp_path,
        seed=42,
    )
    assert len(results) == 2
    for res, expected_n in ((results[0], 20), (results[1], 50)):
        assert res.concurrency == expected_n
        assert res.total_http_uploads == expected_n
        assert res.http_200_uploads == expected_n
        assert res.completed_background_essays == expected_n
        assert res.http_5xx_or_429_errors == 0
        assert res.sqlite_locked_errors == 0
        assert res.verdicts_persisted_in_db >= expected_n
        assert res.http_upload_handler_ms.p50 > 0.0
        assert res.http_status_poll_ms.p50 > 0.0
        assert res.http_e2e_completion_ms.p50 >= res.http_upload_handler_ms.p50
        assert res.throughput_http_uploads_per_sec > 0.0





