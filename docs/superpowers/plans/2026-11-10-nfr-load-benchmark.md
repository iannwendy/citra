# Non-Functional Pipeline Performance & Deadline Load Benchmark Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a deterministic, self-contained Non-Functional Requirements (NFR) and Deadline Burst Load Benchmark suite (`src/integrity_checker/evaluation/performance_benchmark.py` and `scripts/benchmark_pipeline_performance.py`) that measures per-step $P_{50}/P_{90}/P_{99}$ latency and RAM footprint across the 8 pipeline steps for 10-page, 50-page, and 100+ page manuscripts, stress-tests `DeadlineQueueManager` under 20–50 concurrent deadline uploads against file-backed SQLite, and exports JSON, Markdown, and Chapter 5 LaTeX `longtable` artifacts.

**Architecture:** Instrument `DocumentParser._merge()` (`src/integrity_checker/extraction/document_parser.py`) to record distinct `parsing` (PyMuPDF/GROBID layout + `SectionSegmenter`) vs. `extracting` (`CitationExtractor` + `ReferenceListParser` + guided footnote/TEI link extraction) sub-step timings and heap allocations in `document.metadata["_step_telemetry"]`, and expose `DeadlineQueueManager` as a canonical alias of `PipelineAdmissionController` in `src/integrity_checker/api/progress.py`. Implement `PipelineStepProfiler`, `ControlledDeterministicOrchestrator` (combining real `data/local_papers.db` SQLite FTS5 + cached GROBID TEI XML + real Sentence-BERT batch inference with seeded API latency and controlled HTTP 429 recovery), `DeadlineBurstBenchmarkRunner`, and LaTeX/Markdown/JSON exporters in `src/integrity_checker/evaluation/performance_benchmark.py`, driven by `scripts/benchmark_pipeline_performance.py`.

**Tech Stack:** Python 3.11+ standard profiling (`time.perf_counter`, `tracemalloc`, `resource`), `asyncio`, SQLAlchemy 2.0 (`NullPool`, SQLite `busy_timeout=30000`), SQLite FTS5 (`LocalDatabase`), PyMuPDF (`fitz`), GROBID TEI cache, Sentence-BERT (`all-MiniLM-L6-v2`), `pytest`, `ruff`.

**Spec:** `docs/superpowers/specs/2026-11-10-nfr-load-benchmark-design.md`

## Global Constraints

- Zero new external dependencies in `pyproject.toml` or `requirements.txt`; all memory and latency profiling MUST use Python standard-library modules (`time`, `tracemalloc`, `resource`, `statistics`, `math`).
- Existing behavior and signatures of `DocumentParser.parse()`, `IntegrityPipeline.analyze_async()`, `ProgressTracker`, and `PipelineAdmissionController` MUST remain 100% backward-compatible so all 1,683+ unit tests pass without modification.
- Step 1 (`parsing`) and Step 3 (`extracting`) latencies and memory metrics MUST be separated via `document.metadata["_step_telemetry"]` so Step 3 reflects real citation/reference extraction rather than just `_filter_body_pages_for_discovery`.
- All benchmark runs MUST be 100% deterministic offline (using real `data/local_papers.db` FTS5 + GROBID TEI cache + real Sentence-BERT + seeded `ControlledDeterministicOrchestrator` without uncached external network calls).
- Running `ruff check src/ tests/ scripts/benchmark_pipeline_performance.py` and `.venv/bin/python -m pytest tests/unit/ -q` MUST pass with zero errors.

## Review Focus

1. **Non-PDF inputs (`.bib`, `.ris`) or unreadable/empty PDFs in `DocumentParser.parse()`:** `document.metadata["_step_telemetry"]` must still be populated with valid non-negative `parsing_ms`, `extracting_ms`, `parsing_peak_mb`, and `extracting_peak_mb` floats without raising `KeyError` or `AttributeError` (tested in `test_document_parser_bib_ris_and_corrupted_pdf_still_populate_safe_step_telemetry`).
2. **Degenerate sample sequences in `compute_percentiles()`:** Passing an empty sequence `[]`, a single-element sequence `[12.5]`, or unsorted values with duplicates must return well-formed `PercentileStats` with `p50 <= p90 <= p99` and never raise `ZeroDivisionError` or `StatisticsError` (tested in `test_compute_percentiles_exact_interpolation_and_edge_cases`).
3. **Pre-existing `tracemalloc` session before calling `PipelineStepProfiler`:** If the caller already started `tracemalloc` before `profile_run()`, the profiler must measure deltas and peak allocations without calling `tracemalloc.stop()` on exit (tested in `test_pipeline_step_profiler_preserves_preexisting_tracemalloc_session`).
4. **Missing optional thesis PDF directories in clean CI environments:** When a configured real PDF path for a scale tier (`10p`, `50p`, `100+p`) is absent on disk, `resolve_or_synthesize_tier_pdf()` must deterministically generate a multi-page academic PDF with matching page and reference counts in a temporary/cache directory so the benchmark never crashes with `FileNotFoundError` (tested in `test_resolve_tier_pdf_falls_back_to_synthetic_pdf_when_candidate_files_missing`).
5. **Global SQLAlchemy engine / settings leak after `run_deadline_burst_benchmark()`:** Temporarily pointing `settings.database.url` to an isolated file-backed SQLite stress database must always restore the prior `database.url` and reset the engine singleton inside a `finally` block even if an exception occurs (tested in `test_deadline_burst_benchmark_restores_original_database_url_after_completion`).

---

### Task 1: `DeadlineQueueManager` Canonical Alias & `DocumentParser` Sub-Step Telemetry (`parsing` vs. `extracting`)

**Files:**
- Modify: `src/integrity_checker/api/progress.py:245-451`
- Modify: `src/integrity_checker/extraction/document_parser.py:180-561`
- Create: `tests/unit/test_pipeline_performance_benchmark.py`

**Interfaces:**
- Consumes: `PipelineAdmissionController`, `get_pipeline_admission_controller` in `integrity_checker.api.progress`; `DocumentParser` in `integrity_checker.extraction.document_parser`
- Produces:
  - `DeadlineQueueManager = PipelineAdmissionController` in `integrity_checker.api.progress`
  - `get_deadline_queue_manager() -> DeadlineQueueManager` in `integrity_checker.api.progress`
  - `parsed.document.metadata["_step_telemetry"]` dict with keys `{"parsing_ms": float, "extracting_ms": float, "parsing_peak_mb": float, "extracting_peak_mb": float}` on every `ParsedDocument` returned by `DocumentParser.parse()`

- [ ] **Step 1: Write the failing tests in `tests/unit/test_pipeline_performance_benchmark.py`**

```python
from __future__ import annotations

from pathlib import Path

from integrity_checker.api.progress import (
    DeadlineQueueManager,
    PipelineAdmissionController,
    get_deadline_queue_manager,
    get_pipeline_admission_controller,
)
from integrity_checker.extraction.document_parser import DocumentParser


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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/unit/test_pipeline_performance_benchmark.py -v`
Expected: FAIL with `ImportError: cannot import name 'DeadlineQueueManager' from 'integrity_checker.api.progress'`

- [ ] **Step 3: Export `DeadlineQueueManager` in `src/integrity_checker/api/progress.py` and instrument `DocumentParser` in `src/integrity_checker/extraction/document_parser.py`**

In `src/integrity_checker/api/progress.py`, add `DeadlineQueueManager = PipelineAdmissionController` and `def get_deadline_queue_manager() -> PipelineAdmissionController: return _admission_controller`.

In `src/integrity_checker/extraction/document_parser.py`:
- Measure `t_parse_start = time.perf_counter()` around text/GROBID loading in `parse()` and `self._section_segmenter.segment(text_doc)` in `_merge()`.
- Measure `t_extract_start = time.perf_counter()` around `_extract_body_citations`, `_extract_references`, MLA/Chicago/VN-legal/superscript/alpha-bracket extraction, `link_body_citations_to_grobid`, and `_extract_appendix_citations` in `_merge()`.
- If `tracemalloc.is_tracing()` is True, record peak heap deltas in MB (`(peak - current_base) / (1024 * 1024)`), else `0.0`.
- Populate `text_doc.metadata["_step_telemetry"] = {"parsing_ms": ..., "extracting_ms": ..., "parsing_peak_mb": ..., "extracting_peak_mb": ...}` in both `_merge()` and `_parse_bib_or_ris_document()`.

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/python -m pytest tests/unit/test_pipeline_performance_benchmark.py -v`
Expected: PASS (3 passed)

- [ ] **Step 5: Commit**

```bash
git add src/integrity_checker/api/progress.py src/integrity_checker/extraction/document_parser.py tests/unit/test_pipeline_performance_benchmark.py
git commit -m "feat(telemetry): add DeadlineQueueManager alias and DocumentParser sub-step telemetry"
```

---

### Task 2: Percentile Statistics, Memory Tracking & 8-Step `PipelineStepProfiler` Engine

**Files:**
- Create: `src/integrity_checker/evaluation/performance_benchmark.py`
- Modify: `src/integrity_checker/evaluation/__init__.py`
- Test: `tests/unit/test_pipeline_performance_benchmark.py`

**Interfaces:**
- Consumes: `STEP_KEYS` from `integrity_checker.api.progress`, `IntegrityPipeline` from `integrity_checker.pipeline.integrity_pipeline`
- Produces in `integrity_checker.evaluation.performance_benchmark`:
  - `STEP_DISPLAY_LABELS: dict[str, str]` mapping each of the 8 `STEP_KEYS` to its formal Software Engineering step name
  - `PercentileStats` dataclass (`p50: float`, `p90: float`, `p99: float`, `mean: float`, `std: float`, `min: float`, `max: float`, `samples: int`, `to_dict() -> dict[str, float | int]`)
  - `compute_percentiles(values: Sequence[float]) -> PercentileStats`
  - `SingleRunStepRecord` dataclass (`step_key: str`, `step_index: int`, `step_label: str`, `latency_ms: float`, `peak_alloc_mb: float`, `rss_mb: float`)
  - `SinglePipelineRunProfile` dataclass (`file_path: str`, `num_pages: int`, `in_text_citations: int`, `references: int`, `steps: list[SingleRunStepRecord]`, `total_latency_ms: float`, `peak_rss_mb: float`, `peak_heap_alloc_mb: float`)
  - `PipelineStepProfiler` with `async profile_run_async(pipeline: IntegrityPipeline, file_path: str | Path, *, essay_id: str = "bench") -> SinglePipelineRunProfile` and sync wrapper `profile_run(...)`

- [ ] **Step 1: Append failing tests for `compute_percentiles` and `PipelineStepProfiler` to `tests/unit/test_pipeline_performance_benchmark.py`**

```python
import tracemalloc
from unittest.mock import AsyncMock, MagicMock

import pytest

from integrity_checker.api.progress import STEP_KEYS
from integrity_checker.evaluation.performance_benchmark import (
    PipelineStepProfiler,
    compute_percentiles,
)
from integrity_checker.models.source import SourceCandidate, SourceResult
from integrity_checker.pipeline.integrity_pipeline import IntegrityPipeline


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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/unit/test_pipeline_performance_benchmark.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'integrity_checker.evaluation.performance_benchmark'`

- [ ] **Step 3: Implement `PercentileStats`, `compute_percentiles`, and `PipelineStepProfiler` in `src/integrity_checker/evaluation/performance_benchmark.py`**

Implement `compute_percentiles(values)` using linear interpolation (`idx = (q / 100.0) * (n - 1)`), a cross-platform helper `_get_process_rss_mb() -> float` using `resource.getrusage(resource.RUSAGE_SELF).ru_maxrss` (dividing by `1024 * 1024` on macOS/Darwin where `ru_maxrss` is in bytes and by `1024` on Linux where `ru_maxrss` is in kilobytes), and `PipelineStepProfiler` which hooks `progress_callback` across all 8 `STEP_KEYS` and splits `DocumentParser`'s `_step_telemetry["extracting_ms"]` out of Step 0 (`parsing`) into Step 2 (`extracting`) so every step's latency and heap peak are exact.

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/python -m pytest tests/unit/test_pipeline_performance_benchmark.py -v`
Expected: PASS (6 passed)

- [ ] **Step 5: Commit**

```bash
git add src/integrity_checker/evaluation/performance_benchmark.py src/integrity_checker/evaluation/__init__.py tests/unit/test_pipeline_performance_benchmark.py
git commit -m "feat(evaluation): add PercentileStats and 8-step PipelineStepProfiler engine"
```

---

### Task 3: Deterministic Hybrid Retrieval Simulator & Multi-Tier Document Scale Benchmark Runner (`10p`, `50p`, `100+p`)

**Files:**
- Modify: `src/integrity_checker/evaluation/performance_benchmark.py`
- Test: `tests/unit/test_pipeline_performance_benchmark.py`

**Interfaces:**
- Consumes: `LocalDatabase` from `integrity_checker.database.local_db`, `VNLegalVerifier` from `integrity_checker.retrieval.vn_legal_verifier`, `RateLimiter` from `integrity_checker.retrieval.rate_limiter`, `PipelineStepProfiler`, `PercentileStats`
- Produces in `integrity_checker.evaluation.performance_benchmark`:
  - `DocumentScaleTierSpec` dataclass (`tier_id: str`, `label_vi: str`, `label_en: str`, `target_pages: int`, `target_refs: int`, `candidate_paths: tuple[str, ...]`)
  - `DEFAULT_DOCUMENT_SCALE_TIERS: tuple[DocumentScaleTierSpec, ...]` covering:
    1. `short_paper_10p`: `TDTU_PDF/098_uit_vnuhcm_Vietnamese_Hate_Speech_Detection_in_Gaming_Domain_Edited_Report.pdf` (12 pages, 24 refs)
    2. `bachelor_thesis_50p`: `20-theses/109.pdf` (50 pages, 32 refs)
    3. `dissertation_100p`: `VN_UNI_PDF_BATCH2/088_ou_hcm_KLTN_IEEE_FULL_PAPER_VN.pdf` (156 pages, 87 refs; fallback `thesis.pdf` 104 pages)
  - `resolve_or_synthesize_tier_pdf(tier: DocumentScaleTierSpec, fallback_dir: Path | None = None) -> Path`
  - `ControlledDeterministicOrchestrator` class with `retrieve(citation: Citation, *, allow_serpapi: bool | None = None) -> SourceResult`, `simulated_429_count: int`, `recovered_429_count: int`, `unhandled_error_count: int`
  - `StepBenchmarkMetrics` and `DocumentScaleBenchmarkResult` dataclasses
  - `run_document_scale_benchmark(*, tiers: Sequence[DocumentScaleTierSpec] | None = None, iterations: int = 5, warmup_runs: int = 1, seed: int = 42, use_real_sbert: bool = True, fallback_dir: Path | None = None) -> list[DocumentScaleBenchmarkResult]`

- [ ] **Step 1: Append failing tests for `ControlledDeterministicOrchestrator`, `resolve_or_synthesize_tier_pdf`, and `run_document_scale_benchmark` to `tests/unit/test_pipeline_performance_benchmark.py`**

```python
from integrity_checker.evaluation.performance_benchmark import (
    ControlledDeterministicOrchestrator,
    DocumentScaleTierSpec,
    resolve_or_synthesize_tier_pdf,
    run_document_scale_benchmark,
)
from integrity_checker.models.citation import Citation, CitationType


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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/unit/test_pipeline_performance_benchmark.py -v`
Expected: FAIL with `ImportError: cannot import name 'ControlledDeterministicOrchestrator'`

- [ ] **Step 3: Implement `ControlledDeterministicOrchestrator`, `resolve_or_synthesize_tier_pdf`, and `run_document_scale_benchmark` in `src/integrity_checker/evaluation/performance_benchmark.py`**

Implement:
- `ControlledDeterministicOrchestrator`: Queries real `LocalDatabase` (`data/local_papers.db`) when available (with an automatic in-memory FTS5 fallback seeded with canonical ACL/NeurIPS papers if `data/local_papers.db` is absent), applies deterministic seeded sleep (`simulated_api_latency_ms`), and every `rate_limit_429_every_n` queries simulates a primary `HTTP 429 Too Many Requests` (`Retry-After: 0.01`) recorded via `RateLimiter.on_rate_limited()` and rescued cleanly by Tier-2 (`openalex` / `datacite`) so `recovered_429_count` increments and `unhandled_error_count == 0`.
- `resolve_or_synthesize_tier_pdf`: Checks `candidate_paths` relative to repo root; if none exist, generates a realistic multi-page PDF via `fitz` with `target_pages` pages of academic prose, in-text citations, and a final `References` section containing `target_refs` structured entries.
- `run_document_scale_benchmark`: Runs `warmup_runs` followed by `iterations` measured runs per tier through `PipelineStepProfiler`, aggregating `p50`, `p90`, `p99`, `mean`, `std` for latency (`ms`), `peak_alloc_mb`, and `rss_mb` across all 8 steps.

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/python -m pytest tests/unit/test_pipeline_performance_benchmark.py -v`
Expected: PASS (9 passed)

- [ ] **Step 5: Commit**

```bash
git add src/integrity_checker/evaluation/performance_benchmark.py tests/unit/test_pipeline_performance_benchmark.py
git commit -m "feat(evaluation): add deterministic hybrid orchestrator and 3-tier document scale benchmark"
```

---

### Task 4: `DeadlineQueueManager` 20–50 Student Burst Concurrency & SQLite Stress Benchmark Runner

**Files:**
- Modify: `src/integrity_checker/evaluation/performance_benchmark.py`
- Test: `tests/unit/test_pipeline_performance_benchmark.py`

**Interfaces:**
- Consumes: `DeadlineQueueManager`, `ProgressTracker` from `integrity_checker.api.progress`; `get_engine`, `get_session` from `integrity_checker.db.session`; `Base`, `EssayRecord` from `integrity_checker.db.models`; `Repository` from `integrity_checker.db.repository`
- Produces in `integrity_checker.evaluation.performance_benchmark`:
  - `DeadlineBurstStressResult` dataclass
  - `run_deadline_burst_benchmark(*, concurrency_levels: Sequence[int] = (20, 50), max_concurrent_workers: int = 3, citations_per_submission: int = 12, simulated_api_latency_ms: tuple[float, float] = (3.0, 8.0), db_dir: Path | None = None, seed: int = 42) -> list[DeadlineBurstStressResult]`

- [ ] **Step 1: Append failing tests for `run_deadline_burst_benchmark` and database URL restoration to `tests/unit/test_pipeline_performance_benchmark.py`**

```python
from integrity_checker.config import get_settings
from integrity_checker.evaluation.performance_benchmark import (
    run_deadline_burst_benchmark,
)


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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/unit/test_pipeline_performance_benchmark.py -v`
Expected: FAIL with `ImportError: cannot import name 'run_deadline_burst_benchmark'`

- [ ] **Step 3: Implement `DeadlineBurstStressResult` and `run_deadline_burst_benchmark` in `src/integrity_checker/evaluation/performance_benchmark.py`**

For each concurrency level $N \in \text{concurrency\_levels}$:
1. Create a fresh file-backed SQLite database `sqlite:///{db_file}` inside `db_dir` (or `tempfile.TemporaryDirectory()`), save and restore `settings.database.url` in a `try...finally` block, and call `Base.metadata.create_all(bind=get_engine())`.
2. Pre-create a teacher user, classroom, $N$ student users, and $N$ `EssayRecord` rows in SQLite.
3. Instantiate `DeadlineQueueManager(max_concurrent=max_concurrent_workers)` and `ProgressTracker()` (using real SQLite `_persist_snapshot` writes on every step/queue update!).
4. Launch $N$ concurrent student coroutines simultaneously (`asyncio.gather`), where each coroutine:
   - Records `t_submit = time.perf_counter()`
   - Enters `async with queue_mgr.acquire(essay_id, tracker=tracker) as admitted:`
   - Records `t_admitted = time.perf_counter()` (`queue_wait_ms = (t_admitted - t_submit) * 1000.0`), tracks `peak_active_workers`, `peak_queue_depth`, and admission order (`admitted_order`)
   - Steps through the 8 pipeline progress updates (`STEP_KEYS`) on `tracker.update(...)` (triggering concurrent SQLite writes to `EssayRecord.style_profile_json`), executes bounded concurrent citation retrievals via `ControlledDeterministicOrchestrator`, and persists `CitationRecord` + `VerdictRecord` rows to the file-backed SQLite DB via `Repository` inside `asyncio.to_thread`
   - Catches any `sqlite3.OperationalError` containing `"locked"` to increment `sqlite_locked_errors`
   - Calls `tracker.complete(essay_id)` and records `t_done = time.perf_counter()`
5. Compute `PercentileStats` for `queue_wait_ms`, `processing_ms`, and `end_to_end_ms`, plus `throughput_essays_per_sec` and `throughput_citations_per_sec`.

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/python -m pytest tests/unit/test_pipeline_performance_benchmark.py -v`
Expected: PASS (11 passed)

- [ ] **Step 5: Commit**

```bash
git add src/integrity_checker/evaluation/performance_benchmark.py tests/unit/test_pipeline_performance_benchmark.py
git commit -m "feat(evaluation): add DeadlineQueueManager 20-50 student burst and SQLite stress benchmark"
```

---

### Task 5: Report Exporters (JSON, Markdown, Chapter 5 LaTeX `longtable`) & CLI Runner (`scripts/benchmark_pipeline_performance.py`)

**Files:**
- Modify: `src/integrity_checker/evaluation/performance_benchmark.py`
- Create: `scripts/benchmark_pipeline_performance.py`
- Test: `tests/unit/test_pipeline_performance_benchmark.py`

**Interfaces:**
- Consumes: `DocumentScaleBenchmarkResult`, `DeadlineBurstStressResult`, `run_document_scale_benchmark`, `run_deadline_burst_benchmark`
- Produces:
  - `FullPerformanceBenchmarkReport` dataclass (`generated_at: str`, `environment: dict[str, Any]`, `scale_benchmarks: list[DocumentScaleBenchmarkResult]`, `deadline_stress_benchmarks: list[DeadlineBurstStressResult]`, `to_dict() -> dict[str, Any]`)
  - `format_benchmark_markdown(report: FullPerformanceBenchmarkReport) -> str`
  - `format_benchmark_latex_tables(report: FullPerformanceBenchmarkReport) -> str`
  - `main(argv: Sequence[str] | None = None) -> int` in `scripts/benchmark_pipeline_performance.py`

- [ ] **Step 1: Append failing tests for Markdown/LaTeX formatters and CLI runner to `tests/unit/test_pipeline_performance_benchmark.py`**

```python
import json

from integrity_checker.evaluation.performance_benchmark import (
    FullPerformanceBenchmarkReport,
    format_benchmark_latex_tables,
    format_benchmark_markdown,
)
from scripts.benchmark_pipeline_performance import main as benchmark_cli_main


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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/unit/test_pipeline_performance_benchmark.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'scripts.benchmark_pipeline_performance'`

- [ ] **Step 3: Implement `FullPerformanceBenchmarkReport`, `format_benchmark_markdown`, `format_benchmark_latex_tables`, and `scripts/benchmark_pipeline_performance.py`**

In `src/integrity_checker/evaluation/performance_benchmark.py`:
- Implement `FullPerformanceBenchmarkReport`, `format_benchmark_markdown`, and `format_benchmark_latex_tables` (producing two publication-ready LaTeX `longtable` blocks matching the exact column macros `L{...}`, `C{...}` used in `TDTU-MidtermReport/chapter5_rewritten.tex`).

In `scripts/benchmark_pipeline_performance.py`:
- Implement CLI argument parsing (`--iterations`, `--warmup`, `--concurrency`, `--max-workers`, `--output-dir`, `--quick`) that runs `run_document_scale_benchmark` across the 3 real repo PDFs (`10p`, `50p`, `100+p`) and `run_deadline_burst_benchmark` across `(20, 50)` concurrent students, prints a formatted console summary, and writes `pipeline_performance_benchmark.json`, `pipeline_performance_benchmark.md`, and `chapter5_nfr_tables.tex` to `reports/benchmarks/` (or `--output-dir`).

- [ ] **Step 4: Run tests, execute full benchmark to generate `reports/benchmarks/` artifacts, and run `ruff` lint check**

Run:
```bash
.venv/bin/python -m pytest tests/unit/test_pipeline_performance_benchmark.py -v
.venv/bin/python scripts/benchmark_pipeline_performance.py --iterations 5 --warmup 1
.venv/bin/python -m ruff check src/ tests/ scripts/benchmark_pipeline_performance.py
```
Expected: All unit tests PASS, `reports/benchmarks/pipeline_performance_benchmark.json`, `pipeline_performance_benchmark.md`, and `chapter5_nfr_tables.tex` generated with empirical metrics, and `ruff check` returns `All checks passed!`.

- [ ] **Step 5: Commit**

```bash
git add src/integrity_checker/evaluation/performance_benchmark.py scripts/benchmark_pipeline_performance.py tests/unit/test_pipeline_performance_benchmark.py
git commit -m "feat(benchmark): add CLI pipeline performance & deadline load benchmark script and LaTeX exporters"
```
