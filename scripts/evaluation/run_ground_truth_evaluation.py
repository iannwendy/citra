#!/usr/bin/env python3
"""Run evaluation on ground truth dataset using the ACTUAL pipeline.

This evaluates the REAL system behavior, NOT a simplified version.
The evaluation should use the SAME code paths as the real PDF pipeline.

Usage:
    python scripts/evaluation/run_ground_truth_evaluation.py [--limit N]
"""

from __future__ import annotations

import asyncio
import json
import sys
import time
from pathlib import Path
from typing import Optional

# Add repository source to path (this file now lives under scripts/evaluation/).
REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "src"))

from evaluation.evaluator import FakeDetectionEvaluator

from integrity_checker.logic.neuro_symbolic_checker import NeuroSymbolicChecker
from integrity_checker.models.citation import Citation
from integrity_checker.models.validation import ValidationLabel
from integrity_checker.retrieval.retrieval_orchestrator import RetrievalOrchestrator


def load_ground_truth() -> list[dict]:
    """Load ground truth dataset."""
    gt_path = REPO_ROOT / "evaluation" / "ground_truth.json"
    with open(gt_path, encoding="utf-8") as f:
        return json.load(f)


async def evaluate_single_citation(
    citation: Citation,
    orchestrator: RetrievalOrchestrator,
    checker: NeuroSymbolicChecker,
) -> tuple[str, float, dict]:
    """Evaluate a single citation using the ACTUAL pipeline.

    This uses the SAME code paths as real PDF pipeline:
    1. RetrievalOrchestrator.retrieve() - gọi APIs
    2. NeuroSymbolicChecker.check() - apply rules

    Returns:
        (label, confidence, metadata)
    """
    try:
        # Step 1: Retrieve sources (SAME as real pipeline)
        source_result = await orchestrator.retrieve(citation)

        # Step 2: Run neuro-symbolic checker (SAME as real pipeline)
        verdict = checker.check(
            citation=citation,
            source=source_result,
            mapping_status=None,
            style_profile=None,
            citation_context=None,
        )

        # Map ValidationLabel to evaluation label
        label_map = {
            ValidationLabel.VERIFIED: "REAL",
            ValidationLabel.METADATA_ERROR: "METADATA_ERROR",
            ValidationLabel.SUSPECTED_HALLUCINATION: "HALLUCINATED",
            ValidationLabel.UNRESOLVED: "UNRESOLVED",
            ValidationLabel.RESOURCE: "RESOURCE",
        }

        mapped_label = label_map.get(verdict.label, "UNRESOLVED")

        metadata = {
            "confidence": verdict.confidence,
            "triggered_rules": verdict.triggered_rules,
            "mismatched_fields": verdict.mismatched_fields,
            "sources_succeeded": verdict.sources_succeeded,
            "sources_failed": verdict.sources_failed,
        }

        return mapped_label, verdict.confidence, metadata

    except Exception as e:
        return "UNRESOLVED", 0.0, {"error": str(e)}


async def run_evaluation(limit: int | None = None) -> dict:
    """Run full evaluation on ground truth dataset."""
    print("=" * 70)
    print("GROUND TRUTH EVALUATION - ACTUAL PIPELINE")
    print("=" * 70)

    # Load ground truth
    dataset = load_ground_truth()
    if limit:
        dataset = dataset[:limit]

    print(f"\n📁 Loaded {len(dataset)} ground truth samples")

    # Count distribution
    counts = {}
    for item in dataset:
        label = item["ground_truth"]
        counts[label] = counts.get(label, 0) + 1
    for label, count in sorted(counts.items()):
        print(f"   - {label}: {count}")

    # Initialize components (SAME as real pipeline)
    print("\n🔧 Initializing pipeline components...")
    orchestrator = RetrievalOrchestrator()
    checker = NeuroSymbolicChecker()
    print("✓ Components initialized")

    # Run evaluation
    predictions = {}
    confidences = {}
    metadata = {}
    ground_truth = {}

    print(f"\n🔄 Running evaluation on {len(dataset)} citations...")
    print("   (Using actual RetrievalOrchestrator + NeuroSymbolicChecker)")
    print()

    start_time = time.time()

    for i, item in enumerate(dataset):
        citation_id = item["citation_id"]
        # FIX v1.5: Use citation_formatted if available (contains title for METADATA_ERROR detection)
        # citation_raw is short form without title
        raw_text = item.get("citation_formatted") or item.get("citation_raw")
        truth_label = item["ground_truth"]

        # Create citation using from_raw() - same as real pipeline parses from PDF
        # This extracts year, doi, url, AND title (if in formatted citation)
        citation = Citation.from_raw(raw_text)

        # Evaluate using ACTUAL pipeline
        label, confidence, meta = await evaluate_single_citation(
            citation, orchestrator, checker
        )

        predictions[citation_id] = label
        confidences[citation_id] = confidence
        metadata[citation_id] = meta
        ground_truth[citation_id] = truth_label

        # Progress
        if (i + 1) % 20 == 0 or i == 0:
            elapsed = time.time() - start_time
            rate = (i + 1) / elapsed if elapsed > 0 else 0
            remaining = (len(dataset) - i - 1) / rate if rate > 0 else 0
            print(f"   Progress: {i+1}/{len(dataset)} ({(i+1)*100//len(dataset)}%) "
                  f"- {rate:.1f} citations/sec - ETA: {remaining:.0f}s")

    elapsed = time.time() - start_time
    print(f"\n✓ Evaluation complete in {elapsed:.1f}s")

    # Compute metrics
    print("\n📊 Computing evaluation metrics...")
    evaluator = FakeDetectionEvaluator()
    result = evaluator.evaluate(predictions, ground_truth, confidences)

    # Print report
    evaluator.print_report(result)

    # Save results
    output_dir = REPO_ROOT / "evaluation"
    output_dir.mkdir(exist_ok=True)

    # Save predictions
    pred_path = output_dir / "pipeline_predictions.json"
    with open(pred_path, "w", encoding="utf-8") as f:
        json.dump({
            "predictions": predictions,
            "confidences": confidences,
            "metadata": metadata,
            "ground_truth": ground_truth,
            "mode": "actual_pipeline",
            "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
        }, f, indent=2, ensure_ascii=False)
    print(f"\n✓ Predictions saved to: {pred_path}")

    # Save metrics
    metrics_path = output_dir / "pipeline_evaluation_results.json"
    evaluator.save_report(result, str(metrics_path))

    # Error analysis
    errors = []
    for cid in predictions:
        if predictions[cid] != ground_truth[cid]:
            errors.append({
                "citation_id": cid,
                "ground_truth": ground_truth[cid],
                "predicted": predictions[cid],
                "confidence": confidences[cid],
                "metadata": metadata[cid],
                "raw": next((item["citation_raw"] for item in dataset if item["citation_id"] == cid), ""),
            })

    error_path = output_dir / "pipeline_error_analysis.json"
    with open(error_path, "w", encoding="utf-8") as f:
        json.dump(errors, f, indent=2, ensure_ascii=False)
    print(f"✓ Error analysis saved to: {error_path}")

    # Summary
    print("\n" + "=" * 70)
    print("EVALUATION SUMMARY")
    print("=" * 70)
    print(f"  Total samples: {len(dataset)}")
    print(f"  F1 Score: {result.binary.f1:.4f}")
    print(f"  Accuracy: {result.binary.accuracy:.4f}")
    print(f"  Precision: {result.binary.precision:.4f}")
    print(f"  Recall: {result.binary.recall:.4f}")
    print(f"  Total errors: {len(errors)}")
    print("=" * 70)

    return {
        "predictions": predictions,
        "ground_truth": ground_truth,
        "result": result,
        "errors": errors,
    }


def main():
    import argparse
    parser = argparse.ArgumentParser(
        description="Run evaluation on ground truth dataset"
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Limit number of samples for quick testing"
    )

    args = parser.parse_args()

    # Run async evaluation
    asyncio.run(run_evaluation(limit=args.limit))


if __name__ == "__main__":
    main()
