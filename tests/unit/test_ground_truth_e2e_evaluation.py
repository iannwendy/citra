"""Unit & End-to-End tests for `scripts/evaluation/run_ground_truth_evaluation.py`
and the 120-citation Multi-Domain Raw-Reference Gold Benchmark.
"""

from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path
from typing import Any

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPT_PATH = REPO_ROOT / "scripts" / "evaluation" / "run_ground_truth_evaluation.py"
GOLD_BENCHMARK_PATH = REPO_ROOT / "data" / "essays" / "end_to_end_gold_benchmark.json"
ADVERSARIAL_GT_PATH = REPO_ROOT / "data" / "essays" / "adversarial_ground_truth.json"


def _load_eval_module() -> Any:
    spec = importlib.util.spec_from_file_location("run_ground_truth_evaluation_e2e", SCRIPT_PATH)
    assert spec is not None and spec.loader is not None
    mod = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = mod
    spec.loader.exec_module(mod)
    return mod


EXPECTED_7_STYLES = {
    "APA 7th",
    "IEEE",
    "Vancouver",
    "Chicago",
    "Harvard",
    "MLA 9th",
    "TDTU Vietnamese",
}

EXPECTED_6_DOMAINS = {
    "Computer Science & AI/NLP",
    "Biomedical & Clinical",
    "Economics, Finance & Social Sciences",
    "Engineering & Physics",
    "Vietnamese Legal Statutes",
    "Technical Standards & Software",
}

EXPECTED_5_LABELS = {
    "verified",
    "metadata_error",
    "suspected_hallucination",
    "unresolved",
    "resource",
}

FORBIDDEN_TOY_TOKENS = (
    "fabricatedauthor",
    "ghostwriter",
    "interplanetary",
    "journal of synthetic ai hallucinations",
    "john doe",
    "jane roe",
)


class TestGroundTruthParserAndTaxonomy:
    """Verify real parser integration and strict 5-class / 4-class label taxonomy."""

    def test_parse_raw_bibliography_extracts_structured_fields_across_styles(self) -> None:
        mod = _load_eval_module()

        apa_cit = mod.parse_raw_bibliography(
            "Vaswani, A., Shazeer, N., & Parmar, N. (2017). Attention is all you need. "
            "Advances in Neural Information Processing Systems, 30. "
            "https://doi.org/10.48550/arXiv.1706.03762"
        )
        assert len(apa_cit.authors) >= 3
        assert apa_cit.year == "2017"
        assert "attention is all you need" in (apa_cit.title or "").lower()
        assert "neural information processing" in (apa_cit.venue or "").lower()
        assert apa_cit.doi == "10.48550/arXiv.1706.03762"
        assert getattr(apa_cit, "arxiv_id", None) == "1706.03762"

        ieee_cit = mod.parse_raw_bibliography(
            '[1] K. He, X. Zhang, S. Ren, and J. Sun, "Deep residual learning for image recognition," '
            "in Proc. IEEE Conf. Comput. Vis. Pattern Recognit. (CVPR), Jun. 2016, pp. 770-778, "
            "doi: 10.1109/CVPR.2016.90."
        )
        assert len(ieee_cit.authors) == 4
        assert ieee_cit.year == "2016"
        assert "deep residual learning" in (ieee_cit.title or "").lower()
        assert ieee_cit.doi == "10.1109/CVPR.2016.90"

        legal_cit = mod.parse_raw_bibliography(
            "[1] Bộ luật Dân sự (Bộ luật số 91/2015/QH13) ngày 24/11/2015 của Quốc hội."
        )
        assert legal_cit.matched_pattern == "vn_legal_document"
        assert legal_cit.year == "2015"
        assert legal_cit.venue == "Quốc hội"

    def test_resource_is_never_collapsed_into_verified(self) -> None:
        mod = _load_eval_module()
        assert mod._normalize_eval_label("resource") == "resource"
        assert mod._normalize_eval_label("RESOURCE") == "resource"
        assert mod._normalize_eval_label("verified") == "verified"

        y_true = ["verified", "metadata_error", "suspected_hallucination", "unresolved", "resource"]
        y_pred = ["verified", "metadata_error", "suspected_hallucination", "unresolved", "resource"]
        m5 = mod.compute_label_metrics(y_true, y_pred, mod.CANONICAL_5_LABELS)
        assert m5["accuracy"] == 1.0
        assert m5["macro_f1"] == 1.0
        assert m5["support"]["resource"] == 1
        assert m5["support"]["verified"] == 1

        # Misclassifying a resource as verified must penalize BOTH classes
        y_pred_bad = ["verified", "metadata_error", "suspected_hallucination", "unresolved", "verified"]
        m5_bad = mod.compute_label_metrics(y_true, y_pred_bad, mod.CANONICAL_5_LABELS)
        assert m5_bad["accuracy"] == pytest.approx(0.80)
        assert m5_bad["per_class"]["resource"]["recall"] == 0.0
        assert m5_bad["per_class"]["verified"]["precision"] == pytest.approx(0.50)


class TestAdversarialGroundTruth15Suite:
    """Verify 15/15 (100%) accuracy on `data/essays/adversarial_ground_truth.json`."""

    def test_adversarial_ground_truth_catches_all_15_traps(self, tmp_path: Path) -> None:
        import asyncio

        mod = _load_eval_module()
        result = asyncio.run(
            mod.run_evaluation(
                dataset_path=ADVERSARIAL_GT_PATH,
                output_dir=tmp_path,
                mode="offline",
                use_local_db=True,
            )
        )
        preds = result["predictions"]
        gt = result["ground_truth"]
        assert len(preds) == 15
        assert result["errors"] == [], f"Unexpected adversarial errors: {result['errors']}"
        assert result["metrics"]["end_to_end_5class"]["accuracy"] == 1.0
        assert result["metrics"]["scholarly_4class"]["accuracy"] == 1.0

        # Explicit checks for the named traps in Step 1.3
        assert preds["essay_06_chimeric_and_buzzword_traps.pdf#2"] == "suspected_hallucination"
        assert preds["essay_06_chimeric_and_buzzword_traps.pdf#3"] == "suspected_hallucination"
        assert preds["essay_07_subtle_metadata_and_preprint_conflicts.pdf#2"] == "metadata_error"
        assert preds["essay_07_subtle_metadata_and_preprint_conflicts.pdf#3"] == "metadata_error"
        assert preds["essay_08_vn_legal_cross_lingual_and_url_traps.pdf#1"] == "resource"
        assert gt["essay_08_vn_legal_cross_lingual_and_url_traps.pdf#1"] == "resource"
        assert preds["essay_08_vn_legal_cross_lingual_and_url_traps.pdf#2"] == "metadata_error"
        assert (
            preds["essay_08_vn_legal_cross_lingual_and_url_traps.pdf#5"]
            == "suspected_hallucination"
        )


class TestEndToEndGoldBenchmark120:
    """Verify schema, domain/style/label diversity, anti-oracle blindness, and >= 95% E2E accuracy."""

    def test_gold_benchmark_120_schema_and_diversity(self) -> None:
        assert GOLD_BENCHMARK_PATH.is_file(), f"Missing {GOLD_BENCHMARK_PATH}"
        items = json.loads(GOLD_BENCHMARK_PATH.read_text(encoding="utf-8"))
        assert isinstance(items, list)
        assert len(items) == 120

        ids = [it["id"] for it in items]
        raw_refs = [it["raw_reference"].strip() for it in items]
        assert len(set(ids)) == 120, "Duplicate item IDs found"
        assert len(set(raw_refs)) == 120, "Duplicate raw_reference strings found"

        styles = {it["style"] for it in items}
        domains = {it["domain"] for it in items}
        labels = {it["expected_label"] for it in items}
        assert styles == EXPECTED_7_STYLES
        assert domains == EXPECTED_6_DOMAINS
        assert labels == EXPECTED_5_LABELS

        for dom in EXPECTED_6_DOMAINS:
            dom_count = sum(1 for it in items if it["domain"] == dom)
            assert dom_count >= 15, f"Domain {dom} under-represented: {dom_count}"

        for st in EXPECTED_7_STYLES:
            st_count = sum(1 for it in items if it["style"] == st)
            assert st_count >= 10, f"Style {st} under-represented: {st_count}"

        ctx_count = sum(1 for it in items if it.get("citation_context"))
        assert ctx_count >= 8, f"Expected citation_context coverage, got {ctx_count}"

        for it in items:
            assert it.get("error_subtype"), f"Missing error_subtype on {it['id']}"
            assert it.get("notes"), f"Missing notes on {it['id']}"
            combined_low = f"{it['raw_reference']} {it['notes']}".lower()
            for forbidden in FORBIDDEN_TOY_TOKENS:
                assert forbidden not in combined_low, (
                    f"Forbidden toy string {forbidden!r} in {it['id']}"
                )

    def test_gold_benchmark_120_e2e_accuracy_and_zero_oracle_blindness(
        self, tmp_path: Path
    ) -> None:
        import asyncio

        mod = _load_eval_module()

        # 1. Standard offline run (with LocalDatabase when present)
        res_with_db = asyncio.run(
            mod.run_evaluation(
                dataset_path=GOLD_BENCHMARK_PATH,
                output_dir=tmp_path / "with_db",
                mode="offline",
                use_local_db=True,
            )
        )
        m5 = res_with_db["metrics"]["end_to_end_5class"]
        m4 = res_with_db["metrics"]["scholarly_4class"]
        assert m5["num_samples"] == 120
        assert m5["accuracy"] >= 0.95, (
            f"5-class E2E accuracy {m5['accuracy']:.4f} < 0.95; errors={res_with_db['errors']}"
        )
        assert m4["accuracy"] >= 0.95, (
            f"4-class scholarly accuracy {m4['accuracy']:.4f} < 0.95"
        )
        assert set(res_with_db["metrics"]["per_style"].keys()) == EXPECTED_7_STYLES
        assert set(res_with_db["metrics"]["per_domain"].keys()) == EXPECTED_6_DOMAINS
        assert 0.0 <= res_with_db["metrics"]["calibration"]["ece"] <= 0.25

        # 2. CI parity run (without local_papers.db)
        res_no_db = asyncio.run(
            mod.run_evaluation(
                dataset_path=GOLD_BENCHMARK_PATH,
                output_dir=tmp_path / "no_db",
                mode="offline",
                use_local_db=False,
            )
        )
        assert res_no_db["metrics"]["end_to_end_5class"]["accuracy"] >= 0.95, (
            f"CI no-local-db accuracy {res_no_db['metrics']['end_to_end_5class']['accuracy']:.4f} < 0.95; "
            f"errors={res_no_db['errors']}"
        )

        # 3. Anti-Oracle Blindness Proof: scramble every expected_label in a temp JSON copy
        # and verify 120/120 predicted labels are 100% bit-for-bit identical!
        raw_items = json.loads(GOLD_BENCHMARK_PATH.read_text(encoding="utf-8"))
        scrambled_items = []
        label_cycle = list(mod.CANONICAL_5_LABELS)
        for idx, item in enumerate(raw_items):
            mutated = dict(item)
            mutated["expected_label"] = label_cycle[(idx + 2) % len(label_cycle)]
            mutated["error_subtype"] = "scrambled_blind_probe"
            mutated["notes"] = "blindness check"
            scrambled_items.append(mutated)

        scrambled_path = tmp_path / "scrambled_gold.json"
        scrambled_path.write_text(json.dumps(scrambled_items), encoding="utf-8")
        res_scrambled = asyncio.run(
            mod.run_evaluation(
                dataset_path=scrambled_path,
                output_dir=tmp_path / "scrambled_out",
                mode="offline",
                use_local_db=True,
            )
        )
        assert res_scrambled["predictions"] == res_with_db["predictions"], (
            "Predictor output changed when expected_label was scrambled — oracle leak detected!"
        )
