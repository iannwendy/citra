#!/usr/bin/env python3
"""Automated Non-Functional Performance & Deadline Load Benchmark CLI for Chapter 5.

Measures:
1. Per-step latency percentiles (P50, P90, P99) and RAM footprint (Heap Peak Delta & RSS)
   across the 8 processing steps for 3 manuscript scales (10p, 50p, 100+p).
2. DeadlineQueueManager & SQLite concurrency stress testing under 20 and 50 simultaneous
   student uploads near a submission deadline.

Outputs:
- <output_dir>/pipeline_performance_benchmark.json
- <output_dir>/pipeline_performance_benchmark.md
- <output_dir>/chapter5_nfr_tables.tex
"""

from __future__ import annotations

import argparse
import json
import platform
import sys
from collections.abc import Sequence
from datetime import UTC, datetime
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
SRC_DIR = REPO_ROOT / "src"
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))

from integrity_checker.evaluation.performance_benchmark import (  # noqa: E402
    DEFAULT_DOCUMENT_SCALE_TIERS,
    DocumentScaleTierSpec,
    FullPerformanceBenchmarkReport,
    format_benchmark_latex_tables,
    format_benchmark_markdown,
    run_cold_vs_warm_cache_benchmark,
    run_deadline_burst_benchmark,
    run_document_scale_benchmark,
    run_http_multipart_burst_benchmark,
)

QUICK_SCALE_TIERS: tuple[DocumentScaleTierSpec, ...] = (
    DocumentScaleTierSpec(
        tier_id="short_paper_10p",
        label_vi="Bài báo khoa học ngắn (~10 trang)",
        label_en="Short Research Article (~10 pp.)",
        target_pages=10,
        target_refs=6,
        candidate_paths=("__synthetic__/quick_10p.pdf",),
    ),
    DocumentScaleTierSpec(
        tier_id="bachelor_thesis_50p",
        label_vi="Khóa luận tốt nghiệp (~50 trang)",
        label_en="Undergraduate Thesis (~50 pp.)",
        target_pages=50,
        target_refs=12,
        candidate_paths=("__synthetic__/quick_50p.pdf",),
    ),
    DocumentScaleTierSpec(
        tier_id="dissertation_100p",
        label_vi="Luận văn / Đồ án quy mô lớn (100+ trang)",
        label_en="Large Thesis / Dissertation (100+ pp.)",
        target_pages=100,
        target_refs=18,
        candidate_paths=("__synthetic__/quick_100p.pdf",),
    ),
)


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Run CITRA Non-Functional 8-Step Pipeline & Deadline Queue Benchmarks."
    )
    parser.add_argument(
        "--iterations",
        type=int,
        default=5,
        help="Measured iterations per document scale tier (default: 5).",
    )
    parser.add_argument(
        "--warmup",
        type=int,
        default=1,
        help="Warmup iterations per document scale tier (default: 1).",
    )
    parser.add_argument(
        "--concurrency",
        type=int,
        nargs="+",
        default=[20, 50],
        help="Concurrent student burst sizes for DeadlineQueueManager stress test (default: 20 50).",
    )
    parser.add_argument(
        "--max-workers",
        type=int,
        default=3,
        help="Max concurrent active pipelines in DeadlineQueueManager (default: 3).",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=REPO_ROOT / "reports" / "benchmarks",
        help="Directory to write JSON, Markdown, and LaTeX benchmark artifacts.",
    )
    parser.add_argument(
        "--seed",
        type=int,
        default=42,
        help="Random seed for deterministic API latency/429 simulation (default: 42).",
    )
    parser.add_argument(
        "--quick",
        action="store_true",
        help="Fast smoke mode for CI/unit testing (1 iteration, lightweight synthetic tiers).",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    parser = build_arg_parser()
    args = parser.parse_args(list(argv) if argv is not None else None)

    out_dir: Path = Path(args.output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    if args.quick:
        tiers = QUICK_SCALE_TIERS
        iterations = 1
        warmup = 0
        use_real_sbert = False
        citations_per_sub = 4
        api_latency = (0.5, 1.5)
    else:
        tiers = DEFAULT_DOCUMENT_SCALE_TIERS
        iterations = max(1, int(args.iterations))
        warmup = max(0, int(args.warmup))
        use_real_sbert = True
        citations_per_sub = 15
        api_latency = (3.0, 8.0)

    scale_results = run_document_scale_benchmark(
        tiers=tiers,
        iterations=iterations,
        warmup_runs=warmup,
        seed=int(args.seed),
        use_real_sbert=use_real_sbert,
        fallback_dir=out_dir / "_synthetic_pdfs" if args.quick else None,
    )

    stress_results = run_deadline_burst_benchmark(
        concurrency_levels=tuple(int(c) for c in args.concurrency),
        max_concurrent_workers=int(args.max_workers),
        citations_per_submission=citations_per_sub,
        simulated_api_latency_ms=api_latency,
        seed=int(args.seed),
    )

    cold_vs_warm = run_cold_vs_warm_cache_benchmark(
        tier=tiers[0],
        use_live_wan=not args.quick,
        max_live_wan_queries=8,
        simulated_wan_latency_ms=(35.0, 55.0),
        use_real_sbert=use_real_sbert,
        fallback_dir=out_dir / "_synthetic_pdfs" if args.quick else None,
        seed=int(args.seed),
    )

    http_multipart_results = run_http_multipart_burst_benchmark(
        concurrency_levels=tuple(int(c) for c in args.concurrency),
        max_concurrent_workers=int(args.max_workers),
        use_real_sbert=False,
        simulated_api_latency_ms=api_latency,
        seed=int(args.seed),
    )

    report = FullPerformanceBenchmarkReport(
        generated_at=datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        environment={
            "python_version": platform.python_version(),
            "platform": platform.platform(),
            "machine": platform.machine(),
            "processor": platform.processor(),
            "iterations": iterations,
            "warmup_runs": warmup,
            "sbert_enabled": use_real_sbert,
        },
        scale_benchmarks=scale_results,
        deadline_stress_benchmarks=stress_results,
        cold_vs_warm_cache=cold_vs_warm,
        http_multipart_stress_benchmarks=http_multipart_results,
    )

    json_path = out_dir / "pipeline_performance_benchmark.json"
    md_path = out_dir / "pipeline_performance_benchmark.md"
    tex_path = out_dir / "chapter5_nfr_tables.tex"

    json_path.write_text(
        json.dumps(report.to_dict(), indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    md_content = format_benchmark_markdown(report)
    md_path.write_text(md_content, encoding="utf-8")
    tex_content = format_benchmark_latex_tables(report)
    tex_path.write_text(tex_content, encoding="utf-8")

    print(md_content)
    print(f"[OK] Saved JSON report  -> {json_path}")
    print(f"[OK] Saved MD report    -> {md_path}")
    print(f"[OK] Saved LaTeX tables -> {tex_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
