"""Non-Functional Pipeline Performance & Deadline Load Benchmark Engine.

Provides:
1. ``PercentileStats`` & ``compute_percentiles`` ($P_{50}, P_{90}, P_{99}$, mean, std, min, max).
2. ``PipelineStepProfiler`` measuring per-step latency (ms), heap peak allocation (MB via
   ``tracemalloc``), and process RSS high-water mark (MB via ``resource.getrusage``) across all
   8 ``STEP_KEYS`` of ``IntegrityPipeline``.
"""

from __future__ import annotations

import asyncio
import math
import resource
import statistics
import sys
import time
import tracemalloc
from collections.abc import Sequence
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

from integrity_checker.api.progress import STEP_KEYS
from integrity_checker.pipeline.integrity_pipeline import IntegrityPipeline

STEP_DISPLAY_LABELS: dict[str, str] = {
    "parsing": "1. Document Parsing & Section Segmentation",
    "style_detection": "2. Style Profile Detection & Diagnostics",
    "extracting": "3. Citation & Bibliography Extraction",
    "linking": "4. Bidirectional In-Text <-> Reference Linking",
    "retrieving": "5. Multi-Source Tiered Scholarly Retrieval",
    "comparing": "6. Lexical & Neural Semantic Evidence Alignment",
    "checking": "7. Neuro-Symbolic Rules & Platt Calibration",
    "scoring": "8. CIS Calculation & Report Generation",
}


def _get_process_rss_mb() -> float:
    """Return process maximum resident set size (RSS) in megabytes."""
    usage = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    if sys.platform == "darwin":
        # macOS reports ru_maxrss in bytes
        return round(float(usage) / (1024.0 * 1024.0), 2)
    # Linux/BSD report ru_maxrss in kilobytes
    return round(float(usage) / 1024.0, 2)


@dataclass
class PercentileStats:
    """Summary statistics with continuous linear-interpolated percentiles."""

    p50: float
    p90: float
    p99: float
    mean: float
    std: float
    min: float
    max: float
    samples: int

    def to_dict(self) -> dict[str, float | int]:
        return asdict(self)


def _linear_percentile(sorted_vals: list[float], q: float) -> float:
    n = len(sorted_vals)
    if n == 0:
        return 0.0
    if n == 1:
        return float(sorted_vals[0])
    pos = (q / 100.0) * (n - 1)
    lo = int(math.floor(pos))
    hi = int(math.ceil(pos))
    if lo == hi:
        return float(sorted_vals[lo])
    frac = pos - lo
    return float(sorted_vals[lo] + frac * (sorted_vals[hi] - sorted_vals[lo]))


def compute_percentiles(values: Sequence[float]) -> PercentileStats:
    """Compute P50, P90, P99, mean, std, min, and max from numeric samples."""
    clean = [
        float(v)
        for v in values
        if v is not None and not math.isnan(float(v)) and not math.isinf(float(v))
    ]
    if not clean:
        return PercentileStats(
            p50=0.0,
            p90=0.0,
            p99=0.0,
            mean=0.0,
            std=0.0,
            min=0.0,
            max=0.0,
            samples=0,
        )
    s = sorted(clean)
    n = len(s)
    p50 = round(_linear_percentile(s, 50.0), 3)
    p90 = round(_linear_percentile(s, 90.0), 3)
    p99 = round(_linear_percentile(s, 99.0), 3)
    mean_v = round(statistics.fmean(s), 3)
    std_v = round(statistics.stdev(s), 3) if n > 1 else 0.0
    return PercentileStats(
        p50=p50,
        p90=max(p50, p90),
        p99=max(p90, p99),
        mean=mean_v,
        std=std_v,
        min=round(s[0], 3),
        max=round(s[-1], 3),
        samples=n,
    )


@dataclass
class SingleRunStepRecord:
    """Latency and memory profile for a single pipeline step in one execution."""

    step_key: str
    step_index: int
    step_label: str
    latency_ms: float
    peak_alloc_mb: float
    rss_mb: float

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class SinglePipelineRunProfile:
    """Complete 8-step profile for a single manuscript execution."""

    file_path: str
    num_pages: int
    in_text_citations: int
    references: int
    steps: list[SingleRunStepRecord]
    total_latency_ms: float
    peak_rss_mb: float
    peak_heap_alloc_mb: float

    def to_dict(self) -> dict[str, Any]:
        return {
            "file_path": self.file_path,
            "num_pages": self.num_pages,
            "in_text_citations": self.in_text_citations,
            "references": self.references,
            "steps": [s.to_dict() for s in self.steps],
            "total_latency_ms": self.total_latency_ms,
            "peak_rss_mb": self.peak_rss_mb,
            "peak_heap_alloc_mb": self.peak_heap_alloc_mb,
        }


class PipelineStepProfiler:
    """Profiles wall-clock latency and memory consumption across all 8 pipeline steps."""

    async def profile_run_async(
        self,
        pipeline: IntegrityPipeline,
        file_path: str | Path,
        *,
        essay_id: str = "bench",
    ) -> SinglePipelineRunProfile:
        started_tracemalloc = False
        if not tracemalloc.is_tracing():
            tracemalloc.start()
            started_tracemalloc = True

        step_start_times: dict[int, float] = {}
        step_end_times: dict[int, float] = {}
        step_peak_mb: dict[int, float] = {idx: 0.0 for idx in range(len(STEP_KEYS))}
        step_rss_mb: dict[int, float] = {idx: _get_process_rss_mb() for idx in range(len(STEP_KEYS))}
        current_step_idx: int | None = None
        current_mem_base: int = 0
        captured_doc_telemetry: dict[str, float] = {}

        orig_doc_parse = getattr(pipeline.document_parser, "parse", None)

        def _wrapped_doc_parse(*args: Any, **kwargs: Any) -> Any:
            nonlocal captured_doc_telemetry
            res = orig_doc_parse(*args, **kwargs)
            doc_obj = getattr(res, "document", None)
            meta = getattr(doc_obj, "metadata", None) if doc_obj is not None else None
            if isinstance(meta, dict) and isinstance(meta.get("_step_telemetry"), dict):
                captured_doc_telemetry = dict(meta["_step_telemetry"])
            return res

        def _close_active_step(now: float) -> None:
            nonlocal current_step_idx, current_mem_base
            if current_step_idx is None:
                return
            step_end_times[current_step_idx] = now
            if tracemalloc.is_tracing():
                _, peak_bytes = tracemalloc.get_traced_memory()
                delta_mb = max(0.0, (peak_bytes - current_mem_base) / (1024.0 * 1024.0))
                step_peak_mb[current_step_idx] = max(step_peak_mb.get(current_step_idx, 0.0), delta_mb)
            step_rss_mb[current_step_idx] = max(
                step_rss_mb.get(current_step_idx, 0.0),
                _get_process_rss_mb(),
            )

        def _progress_cb(step_key: str, step_index: int, _stats: dict[str, Any]) -> None:
            nonlocal current_step_idx, current_mem_base
            if step_index < 0 or step_index >= len(STEP_KEYS):
                return
            now = time.perf_counter()
            if current_step_idx != step_index:
                _close_active_step(now)
                current_step_idx = step_index
                step_start_times.setdefault(step_index, now)
                if tracemalloc.is_tracing():
                    tracemalloc.reset_peak()
                    current_mem_base, _ = tracemalloc.get_traced_memory()
                step_rss_mb[step_index] = _get_process_rss_mb()

        t_run_start = time.perf_counter()
        if orig_doc_parse is not None:
            pipeline.document_parser.parse = _wrapped_doc_parse  # type: ignore[method-assign]
        try:
            report = await pipeline.run_async(
                str(file_path),
                essay_id=essay_id,
                progress_callback=_progress_cb,
            )
            t_run_end = time.perf_counter()
            _close_active_step(t_run_end)
        finally:
            if orig_doc_parse is not None:
                pipeline.document_parser.parse = orig_doc_parse  # type: ignore[method-assign]
            if started_tracemalloc and tracemalloc.is_tracing():
                tracemalloc.stop()

        raw_latencies: list[float] = []
        for idx in range(len(STEP_KEYS)):
            t0 = step_start_times.get(idx)
            t1 = step_end_times.get(idx)
            if t0 is not None and t1 is not None and t1 > t0:
                raw_latencies.append((t1 - t0) * 1000.0)
            else:
                raw_latencies.append(0.01)

        # Reconcile DocumentParser sub-step telemetry so Step 0 (parsing) and Step 2 (extracting)
        # report their true separate latencies and heap peaks while preserving total latency.
        if captured_doc_telemetry:
            ext_ms = float(captured_doc_telemetry.get("extracting_ms", 0.0))
            parse_ms = float(captured_doc_telemetry.get("parsing_ms", 0.0))
            if ext_ms > 0.0 and raw_latencies[0] > ext_ms:
                raw_latencies[0] = max(0.05, raw_latencies[0] - ext_ms)
                raw_latencies[2] = raw_latencies[2] + ext_ms
            elif ext_ms > 0.0 and (parse_ms + ext_ms) > 0.0:
                ratio = ext_ms / (parse_ms + ext_ms)
                transfer = raw_latencies[0] * min(0.85, max(0.05, ratio))
                raw_latencies[0] = max(0.05, raw_latencies[0] - transfer)
                raw_latencies[2] = raw_latencies[2] + transfer

            step_peak_mb[0] = max(
                step_peak_mb[0],
                float(captured_doc_telemetry.get("parsing_peak_mb", 0.0)),
            )
            step_peak_mb[2] = max(
                step_peak_mb[2],
                float(captured_doc_telemetry.get("extracting_peak_mb", 0.0)),
            )

        step_records: list[SingleRunStepRecord] = []
        for idx, key in enumerate(STEP_KEYS):
            step_records.append(
                SingleRunStepRecord(
                    step_key=key,
                    step_index=idx,
                    step_label=STEP_DISPLAY_LABELS.get(key, key),
                    latency_ms=round(max(0.01, raw_latencies[idx]), 3),
                    peak_alloc_mb=round(max(0.0, step_peak_mb.get(idx, 0.0)), 4),
                    rss_mb=round(max(0.01, step_rss_mb.get(idx, _get_process_rss_mb())), 2),
                )
            )

        total_latency_ms = round(sum(s.latency_ms for s in step_records), 3)
        peak_rss = round(max((s.rss_mb for s in step_records), default=_get_process_rss_mb()), 2)
        peak_heap = round(max((s.peak_alloc_mb for s in step_records), default=0.0), 4)

        extracted = list(getattr(report, "extracted_citations", None) or [])
        in_text_cnt = sum(
            1
            for c in extracted
            if getattr(getattr(c, "citation_type", None), "value", "") != "reference_list"
        )
        ref_cnt = sum(
            1
            for c in extracted
            if getattr(getattr(c, "citation_type", None), "value", "") == "reference_list"
        )

        return SinglePipelineRunProfile(
            file_path=str(file_path),
            num_pages=int(getattr(report, "num_pages", 0) or 0),
            in_text_citations=in_text_cnt,
            references=ref_cnt or int(getattr(report, "num_citations", 0) or 0),
            steps=step_records,
            total_latency_ms=total_latency_ms,
            peak_rss_mb=peak_rss,
            peak_heap_alloc_mb=peak_heap,
        )

    def profile_run(
        self,
        pipeline: IntegrityPipeline,
        file_path: str | Path,
        *,
        essay_id: str = "bench",
    ) -> SinglePipelineRunProfile:
        return asyncio.run(
            self.profile_run_async(pipeline, file_path, essay_id=essay_id)
        )
