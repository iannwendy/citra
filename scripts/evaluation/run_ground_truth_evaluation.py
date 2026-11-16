#!/usr/bin/env python3
"""Run evaluation on ground truth dataset using the ACTUAL pipeline.

Evaluates `RetrievalOrchestrator` + `NeuroSymbolicChecker` end-to-end and
reports canonical 4-class metrics & calibration via `integrity_checker.evaluation`.

Usage:
    python scripts/evaluation/run_ground_truth_evaluation.py [--limit N] [--dataset PATH]
"""

from __future__ import annotations

import argparse
import asyncio
import dataclasses
import json
import sys
import time
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT / "src") not in sys.path:
    sys.path.insert(0, str(REPO_ROOT / "src"))

from integrity_checker.evaluation.metrics import MetricsCalculator  # noqa: E402
from integrity_checker.evaluation.report import EvaluationReport  # noqa: E402
from integrity_checker.logic.calibration import CalibrationCalculator  # noqa: E402
from integrity_checker.logic.neuro_symbolic_checker import NeuroSymbolicChecker  # noqa: E402
from integrity_checker.models.citation import Citation  # noqa: E402
from integrity_checker.models.validation import ValidationLabel  # noqa: E402
from integrity_checker.retrieval.retrieval_orchestrator import RetrievalOrchestrator  # noqa: E402

_LABEL_ALIASES: dict[str, str] = {
    "real": "verified",
    "verified": "verified",
    "metadata_error": "metadata_error",
    "hallucinated": "suspected_hallucination",
    "hallucination": "suspected_hallucination",
    "suspected_hallucination": "suspected_hallucination",
    "unresolved": "unresolved",
    "resource": "verified",
}


def _normalize_eval_label(raw_label: str) -> str:
    key = str(raw_label or "").strip().lower()
    return _LABEL_ALIASES.get(key, "unresolved")


def load_ground_truth(gt_path: Path | None = None) -> list[dict[str, Any]]:
    """Load ground truth dataset from `data/essays/adversarial_ground_truth.json` or custom JSON."""
    candidates = (
        [gt_path]
        if gt_path is not None
        else [
            REPO_ROOT / "data" / "essays" / "adversarial_ground_truth.json",
            REPO_ROOT / "evaluation" / "ground_truth.json",
        ]
    )
    resolved = next((p for p in candidates if p is not None and p.is_file()), None)
    if resolved is None:
        raise FileNotFoundError(
            f"Ground truth dataset not found. Checked: {[str(p) for p in candidates]}"
        )

    raw_data = json.loads(resolved.read_text(encoding="utf-8"))
    samples: list[dict[str, Any]] = []

    for entry_idx, entry in enumerate(raw_data):
        if isinstance(entry, dict) and "references" in entry:
            fname = str(entry.get("filename") or f"doc_{entry_idx}")
            for ref in entry.get("references") or []:
                ref_idx = ref.get("index", len(samples) + 1)
                raw_ref = str(ref.get("raw_reference") or "").strip()
                if not raw_ref:
                    continue
                samples.append(
                    {
                        "citation_id": f"{fname}#{ref_idx}",
                        "citation_formatted": raw_ref,
                        "citation_raw": str(ref.get("intext_marker") or raw_ref),
                        "ground_truth": _normalize_eval_label(
                            str(ref.get("expected_label") or "unresolved")
                        ),
                    }
                )
        elif isinstance(entry, dict):
            cid = str(entry.get("citation_id") or f"sample_{entry_idx + 1}")
            raw_fmt = str(entry.get("citation_formatted") or entry.get("citation_raw") or "")
            samples.append(
                {
                    "citation_id": cid,
                    "citation_formatted": raw_fmt,
                    "citation_raw": str(entry.get("citation_raw") or raw_fmt),
                    "ground_truth": _normalize_eval_label(
                        str(entry.get("ground_truth") or entry.get("expected_label") or "unresolved")
                    ),
                }
            )
    return samples


async def evaluate_single_citation(
    citation: Citation,
    orchestrator: RetrievalOrchestrator,
    checker: NeuroSymbolicChecker,
) -> tuple[str, float, dict[str, Any]]:
    """Evaluate a single citation using the production `RetrievalOrchestrator` + `NeuroSymbolicChecker`."""
    try:
        source_result = await orchestrator.retrieve(citation)
        verdict = checker.check(
            citation=citation,
            source=source_result,
            mapping_status=None,
            style_profile=None,
            citation_context=None,
        )
        mapped_label = (
            "verified"
            if verdict.label == ValidationLabel.RESOURCE
            else verdict.label.value
        )
        metadata = {
            "confidence": verdict.confidence,
            "triggered_rules": verdict.triggered_rules,
            "mismatched_fields": verdict.mismatched_fields,
            "sources_succeeded": source_result.sources_succeeded,
            "sources_failed": source_result.sources_failed,
        }
        return mapped_label, verdict.confidence, metadata
    except Exception as exc:
        return "unresolved", 0.0, {"error": str(exc)}


def _save_evaluation_artifacts(
    output_dir: Path,
    predictions_payload: dict[str, Any],
    metrics_payload: dict[str, Any],
    errors: list[dict[str, Any]],
) -> tuple[Path, Path, Path]:
    """Persist evaluation JSON artifacts synchronously."""
    output_dir.mkdir(parents=True, exist_ok=True)
    pred_path = output_dir / "pipeline_predictions.json"
    metrics_path = output_dir / "pipeline_evaluation_results.json"
    error_path = output_dir / "pipeline_error_analysis.json"

    pred_path.write_text(
        json.dumps(predictions_payload, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    metrics_path.write_text(
        json.dumps(metrics_payload, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    error_path.write_text(json.dumps(errors, indent=2, ensure_ascii=False), encoding="utf-8")
    return pred_path, metrics_path, error_path


async def run_evaluation(
    limit: int | None = None,
    dataset_path: Path | None = None,
    output_dir: Path | None = None,
) -> dict[str, Any]:
    """Run full ground-truth evaluation using current `integrity_checker.evaluation` APIs."""
    print("=" * 70)
    print("GROUND TRUTH EVALUATION - ACTUAL PIPELINE")
    print("=" * 70)

    dataset = load_ground_truth(dataset_path)
    if limit:
        dataset = dataset[:limit]

    print(f"\nLoaded {len(dataset)} ground truth samples")
    counts: dict[str, int] = {}
    for item in dataset:
        lbl = item["ground_truth"]
        counts[lbl] = counts.get(lbl, 0) + 1
    for lbl, cnt in sorted(counts.items()):
        print(f"   - {lbl}: {cnt}")

    orchestrator = RetrievalOrchestrator()
    checker = NeuroSymbolicChecker()

    predictions: dict[str, str] = {}
    confidences: dict[str, float] = {}
    metadata: dict[str, dict[str, Any]] = {}
    ground_truth: dict[str, str] = {}
    y_true: list[str] = []
    y_pred: list[str] = []
    cal_pairs: list[tuple[float, int]] = []

    start_time = time.time()
    for i, item in enumerate(dataset):
        citation_id = item["citation_id"]
        raw_text = item.get("citation_formatted") or item.get("citation_raw") or ""
        truth_label = item["ground_truth"]
        citation = Citation.from_raw(raw_text)

        pred_label, confidence, meta = await evaluate_single_citation(
            citation, orchestrator, checker
        )
        predictions[citation_id] = pred_label
        confidences[citation_id] = confidence
        metadata[citation_id] = meta
        ground_truth[citation_id] = truth_label
        y_true.append(truth_label)
        y_pred.append(pred_label)
        cal_pairs.append((confidence, 1 if pred_label == truth_label else 0))

        if (i + 1) % 20 == 0 or i == 0:
            elapsed = time.time() - start_time
            rate = (i + 1) / elapsed if elapsed > 0 else 0.0
            print(f"   Progress: {i + 1}/{len(dataset)} - {rate:.2f} citations/sec")

    cls_result = MetricsCalculator.compute(y_true, y_pred)
    cal_result = CalibrationCalculator.compute(cal_pairs)
    cls_dict = dataclasses.asdict(cls_result)
    md_table = EvaluationReport({"actual_pipeline": cls_dict}).to_markdown()
    print("\n" + md_table)

    errors = [
        {
            "citation_id": cid,
            "ground_truth": ground_truth[cid],
            "predicted": predictions[cid],
            "confidence": confidences[cid],
            "metadata": metadata[cid],
            "raw": next(
                (it["citation_formatted"] for it in dataset if it["citation_id"] == cid), ""
            ),
        }
        for cid in predictions
        if predictions[cid] != ground_truth[cid]
    ]

    target_out = output_dir or (REPO_ROOT / "data" / "cache" / "evaluation")
    metrics_payload = {
        "classification": cls_dict,
        "calibration": cal_result.to_dict(),
    }
    predictions_payload = {
        "predictions": predictions,
        "confidences": confidences,
        "metadata": metadata,
        "ground_truth": ground_truth,
        "mode": "actual_pipeline",
        "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
    }
    pred_path, metrics_path, error_path = await asyncio.to_thread(
        _save_evaluation_artifacts,
        target_out,
        predictions_payload,
        metrics_payload,
        errors,
    )
    print(f"\nSaved predictions: {pred_path}")
    print(f"Saved metrics:     {metrics_path}")
    print(f"Saved errors:      {error_path}")

    return {
        "predictions": predictions,
        "ground_truth": ground_truth,
        "metrics": metrics_payload,
        "errors": errors,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Run evaluation on ground truth dataset")
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Limit number of samples for quick testing",
    )
    parser.add_argument(
        "--dataset",
        type=Path,
        default=None,
        help="Optional custom ground-truth JSON path",
    )
    args = parser.parse_args()
    asyncio.run(run_evaluation(limit=args.limit, dataset_path=args.dataset))


if __name__ == "__main__":
    main()
