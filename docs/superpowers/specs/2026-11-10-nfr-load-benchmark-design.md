# Non-Functional Performance & Deadline Load Benchmark — Design Specification

- **Date:** 2026-11-10
- **Status:** Approved (User selected Approach A with real repo PDFs + Local SQLite FTS5 + GROBID cache + real Sentence-BERT + deterministic API latency/429 simulation)
- **Target Components:**
  - `src/integrity_checker/extraction/document_parser.py`
  - `src/integrity_checker/api/progress.py`
  - `src/integrity_checker/evaluation/performance_benchmark.py`
  - `src/integrity_checker/evaluation/__init__.py`
  - `scripts/benchmark_pipeline_performance.py`
  - `tests/unit/test_pipeline_performance_benchmark.py`

---

## 1. Intent & Why

For a Software Engineering Capstone Defense (Hội đồng ĐATN Kỹ thuật Phần mềm), Chapter 5 of the thesis report (`TDTU-MidtermReport/chapter5_rewritten.tex`) requires reproducible, empirical Non-Functional Requirements (NFR) and stress-testing evidence across two critical dimensions:

1. **8-Step Pipeline Latency Percentiles ($P_{50}, P_{90}, P_{99}$) & Memory Footprint by Document Scale:**
   - Measure wall-clock latency (`ms`) and memory consumption (`tracemalloc` peak heap allocation in `MB` + process RSS high-water mark via `resource.getrusage` in `MB`) for each of the 8 processing steps (`parsing`, `style_detection`, `extracting`, `linking`, `retrieving`, `comparing`, `checking`, `scoring`) across three manuscript scales:
     - **Short Research Paper (~10 pages):** `TDTU_PDF/098_uit_vnuhcm_Vietnamese_Hate_Speech_Detection_in_Gaming_Domain_Edited_Report.pdf` (12 pages, 31 in-text citations, 24 references, cached GROBID TEI)
     - **Undergraduate Graduation Thesis (~50 pages):** `20-theses/109.pdf` (50 pages, 108 in-text citations, 32 references, cached GROBID TEI)
     - **Full Thesis / Dissertation (100+ pages):** `VN_UNI_PDF_BATCH2/088_ou_hcm_KLTN_IEEE_FULL_PAPER_VN.pdf` (156 pages, 101 in-text citations, 87 references, cached GROBID TEI; fallback `thesis.pdf` 104 pages)
2. **Throughput & Burst Load Resilience of `DeadlineQueueManager` (20–50 Concurrent Student Submissions):**
   - Simulate 20 and 50 students simultaneously submitting manuscripts right before a classroom deadline against `DeadlineQueueManager` (`PipelineAdmissionController` in `src/integrity_checker/api/progress.py`), a real file-backed SQLite database (`NullPool`, `PRAGMA busy_timeout=30000`, `PRAGMA synchronous=NORMAL`), and the 4-layer HTTP 429 protection stack (`_CrossLoopAsyncSemaphore`, singleflight coalescing, AIMD `RateLimiter`, Tier-2 rescue).
   - Prove empirically that all 20–50 submissions queue smoothly in FIFO order with live `queue_position` updates, achieving **100% completion**, **`0` `SQLite database is locked` errors**, and **`0` unhandled `HTTP 502/429` failures**.

---

## 2. Goals, Non-Goals, and Anti-Goals

### Goals
- Separate sub-step timing and heap allocation measurements inside `DocumentParser.parse()` (`src/integrity_checker/extraction/document_parser.py`) so Step 1 (`parsing`: PDF/DOCX text load + GROBID TEI parse + `SectionSegmenter`) and Step 3 (`extracting`: `CitationExtractor` + `ReferenceListParser` + guided footnote/MLA extraction + GROBID TEI link enrichment) report their true individual latencies and memory deltas.
- Export `DeadlineQueueManager = PipelineAdmissionController` and `get_deadline_queue_manager = get_pipeline_admission_controller` in `src/integrity_checker/api/progress.py` so the thesis terminology (`DeadlineQueueManager`) maps directly to an importable symbol in the codebase.
- Implement a reusable benchmark engine in `src/integrity_checker/evaluation/performance_benchmark.py` using Python standard-library profiling (`time.perf_counter`, `tracemalloc`, `resource`) with zero new external dependencies.
- Use real repository PDFs, real `data/local_papers.db` SQLite FTS5 lookups, real cached GROBID TEI XML (`data/cache/grobid/`), and real Sentence-BERT (`all-MiniLM-L6-v2`) batch inference paired with a seeded `ControlledApiSimulator` (deterministic network latency + controlled HTTP 429 injection and recovery) for 100% reproducible $P_{50}/P_{90}/P_{99}$ statistics.
- Provide `scripts/benchmark_pipeline_performance.py` to execute both benchmarks and export:
  - `reports/benchmarks/pipeline_performance_benchmark.json`
  - `reports/benchmarks/pipeline_performance_benchmark.md`
  - `reports/benchmarks/chapter5_nfr_tables.tex` (ready-to-include LaTeX `longtable` tables for Chapter 5).

### Non-Goals
- Adding third-party profiling libraries (`psutil`, `memory_profiler`, `locust`) to `pyproject.toml` or `requirements.txt`.
- Making live uncached external HTTP calls during benchmark runs (which would make $P_{50}/P_{90}/P_{99}$ non-deterministic and subject to external internet jitter).

### Anti-Goals
- Breaking any of the 1,683+ existing unit tests (especially `tests/unit/test_performance_optimizations.py` and `tests/unit/test_deadline_rate_limit_resilience.py`).
- Reporting a synthetic `0.05 ms` duration for Step 3 (`extracting`) caused by `DocumentParser.parse()` bundling citation extraction inside Step 1 (`parsing`).

---

## 3. Approaches Considered

| Approach | Description | Trade-offs | Decision |
| :--- | :--- | :--- | :--- |
| **A. Core Telemetry Module (`evaluation/performance_benchmark.py`) + `DocumentParser` Sub-step Instrumentation + CLI Runner (`scripts/benchmark_pipeline_performance.py`)** | Instruments `DocumentParser._merge()` to record `_step_telemetry` (`parsing` vs `extracting`), aliases `DeadlineQueueManager` in `progress.py`, builds a deterministic benchmark & stress-test engine in `evaluation/performance_benchmark.py`, and provides a CLI script exporting JSON/Markdown/LaTeX tables. | Accurate per-step latency and RAM across all 8 steps; zero new dependencies; unit-testable in `pytest`; directly exports Chapter 5 LaTeX tables. | **Selected (Approved by User)** |
| **B. External Monkey-Patching Script Only (`scripts/benchmark_pipeline_performance.py`)** | Leaves `src/` untouched and monkey-patches private `DocumentParser` methods inside the script. | Brittle if extraction internals are refactored; `DeadlineQueueManager` is missing from `src/integrity_checker/api/progress.py`. | Rejected |
| **C. External HTTP Load Generator (`Locust` / `k6`)** | Runs external HTTP load against a live Uvicorn process. | Cannot measure internal 8-step $P_{50}/P_{90}/P_{99}$ latencies or per-step RAM deltas; requires external dependencies. | Rejected |

---

## 4. Technical Design Details

### 4.1. Sub-step Telemetry in `DocumentParser` (`src/integrity_checker/extraction/document_parser.py`)
- Inside `DocumentParser.parse()` and `DocumentParser._merge()`:
  - Measure wall-clock time (`time.perf_counter()`) and heap allocation (`tracemalloc` if tracing is active) for:
    1. **Layout & Section Parsing (`parsing`):** `_load_pdf_text`, GROBID TEI XML loading/parsing (`parse_tei` / `_load_grobid_tei`), and `self._section_segmenter.segment(text_doc)`.
    2. **Citation & Reference Extraction (`extracting`):** `_extract_body_citations`, `_extract_references`, MLA/Chicago/VN-legal/superscript/alpha-bracket guided extraction, `link_body_citations_to_grobid`, and `_extract_appendix_citations`.
  - Store these metrics in `text_doc.metadata["_step_telemetry"] = {"parsing_ms": ..., "extracting_ms": ..., "parsing_peak_mb": ..., "extracting_peak_mb": ...}`.
  - When `PipelineStepProfiler` profiles an `IntegrityPipeline.analyze_async` run, it reconciles the `DocumentParser` sub-step breakdown with the 8-step `progress_callback` boundary timestamps so that:
    - Step 1 (`parsing`) reflects true PDF/GROBID layout + section segmentation latency and RAM.
    - Step 3 (`extracting`) reflects true in-text + reference extraction + `_filter_body_pages_for_discovery` latency and RAM.
    - The sum of all 8 step latencies equals the total end-to-end pipeline execution time.

### 4.2. `DeadlineQueueManager` Alias (`src/integrity_checker/api/progress.py`)
- Export `DeadlineQueueManager = PipelineAdmissionController` and `get_deadline_queue_manager = get_pipeline_admission_controller` in `src/integrity_checker/api/progress.py` and `__all__`.

### 4.3. Benchmark & Stress Test Engine (`src/integrity_checker/evaluation/performance_benchmark.py`)
- **`compute_percentiles(samples: Sequence[float]) -> PercentileStats`:**
  - Computes `p50`, `p90`, `p99` (using continuous linear interpolation on sorted samples), `mean`, `std`, `min`, and `max`.
- **`PipelineStepProfiler`:**
  - Starts `tracemalloc` (if not already running), records baseline RSS (`resource.getrusage`), attaches a `progress_callback` to `IntegrityPipeline.analyze_async`, tracks high-water allocations per step (`STEP_KEYS`), reconciles `DocumentParser` `_step_telemetry`, and produces a `SingleRunProfile` containing per-step `latency_ms`, `peak_alloc_mb`, and `rss_mb`.
- **`ControlledDeterministicOrchestrator`:**
  - Queries real `LocalDatabase` (`data/local_papers.db` FTS5) + `VNLegalVerifier` + `SeminalWhitelist` first.
  - Simulates deterministic Tier-1/Tier-2 API latency (seeded via `random.Random(seed)`) and controlled transient `HTTP 429` responses with `Retry-After` headers handled via `RateLimiter` and Tier-2 fallback so every run is 100% deterministic offline while exercising the full retrieval/rate-limit code path.
- **`DeadlineBurstBenchmarkRunner`:**
  - Creates an isolated file-backed SQLite database (`tmp_path / "deadline_stress.db"`) via `get_engine()` (`NullPool`, `busy_timeout=30000`) and initializes `User`, `ClassRecord`, and `EssayRecord` rows.
  - Spawns $N \in \{20, 50\}$ concurrent student tasks submitting essays simultaneously through `DeadlineQueueManager(max_concurrent=max_concurrent)` and `ProgressTracker` (with real SQLite `_persist_snapshot` writes + `Repository` verdict/citation persistence).
  - Collects:
    - `concurrency`: $N$ (e.g., 20, 50)
    - `max_concurrent_workers`: worker slots (default 3)
    - `completed_submissions` & `success_rate_pct` (target: `100.0%`)
    - `peak_active_workers` (invariant: $\le \text{max\_concurrent\_workers}$)
    - `peak_queue_depth` (invariant: $N - \text{max\_concurrent\_workers}$)
    - `fifo_order_preserved` (`True`)
    - `queue_wait_ms` (`PercentileStats`: $P_{50}, P_{90}, P_{99}$)
    - `processing_ms` (`PercentileStats`: $P_{50}, P_{90}, P_{99}$)
    - `end_to_end_ms` (`PercentileStats`: $P_{50}, P_{90}, P_{99}$)
    - `throughput_essays_per_sec` & `throughput_citations_per_sec`
    - `sqlite_locked_errors` (`0`)
    - `http_429_intercepted_and_recovered` (count of simulated 429s gracefully handled by AIMD/Tier-2 fallback)
    - `unhandled_http_502_429_errors` (`0`)

### 4.4. CLI Script & Report Exporters (`scripts/benchmark_pipeline_performance.py`)
- Exports:
  1. `reports/benchmarks/pipeline_performance_benchmark.json`
  2. `reports/benchmarks/pipeline_performance_benchmark.md`
  3. `reports/benchmarks/chapter5_nfr_tables.tex` (containing `\begin{longtable}...\label{tab:nfr-step-latency}` and `\begin{longtable}...\label{tab:nfr-deadline-stress}`).
