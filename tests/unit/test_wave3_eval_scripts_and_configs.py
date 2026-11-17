"""Wave 3 / Track 6 Regression Suite: 120K Benchmark Integrity, Scripts, Configs, CI & Docs."""

from __future__ import annotations

import importlib.util
import inspect
import sqlite3
import subprocess
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import numpy as np
import yaml

from integrity_checker.__version__ import __version__
from integrity_checker.config import RateLimitsConfig, SourceToggleConfig
from integrity_checker.database.local_db import LocalDatabase
from integrity_checker.database.schemas import INIT_STATEMENTS
from integrity_checker.evaluation.baselines import BaselineRunner
from integrity_checker.evaluation.performance_benchmark import (
    DocumentScaleTierSpec,
    FullPerformanceBenchmarkReport,
    format_benchmark_markdown,
    run_deadline_burst_benchmark,
    run_document_scale_benchmark,
)
from integrity_checker.evaluation.report import EvaluationReport
from integrity_checker.logic.rules import SymbolicRules
from integrity_checker.models.citation import Citation, CitationType
from integrity_checker.models.source import SourceCandidate, SourceResult
from integrity_checker.models.validation import CitationVerdict, MatchFeatures, ValidationLabel

REPO_ROOT = Path(__file__).resolve().parents[2]


def _load_script_module(module_name: str, rel_path: str):
    script_path = REPO_ROOT / rel_path
    spec = importlib.util.spec_from_file_location(module_name, script_path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class TestTrainNeuroSymbolicIntegrity:
    """Verify zero target leakage, pre-split title dedupe, and real rule inputs in 120K trainer."""

    def test_build_split_dataset_has_zero_label_conditioned_clamping(self) -> None:
        trainer = _load_script_module(
            "train_neuro_symbolic_model", "scripts/train_neuro_symbolic_model.py"
        )
        src = inspect.getsource(trainer.build_split_dataset)
        assert "np.clip" not in src, (
            "build_split_dataset must not clamp similarity features with np.clip"
        )

        # Build a small 20-paper pool so every class (verified, metadata_error, hallucination, unresolved) is populated
        pool_papers = [
            {
                "paper_id": 1000 + idx,
                "title": f"Distinct Empirical Study Number {idx:03d}: Neural Sequence Transduction Models",
                "authors": [f"Researcher{idx}, A.", f"Collaborator{idx}, B."],
                "year": 2020 + (idx % 5),
                "venue": "Proceedings of ACL",
                "doi": f"10.18653/v1/2020.acl-main.{idx}" if idx % 2 == 0 else "",
                "abstract": (
                    f"Sentence one for paper {idx} investigates transformer attention mechanisms in detail. "
                    f"Sentence two for paper {idx} reports empirical perplexity improvements on translation."
                ),
                "has_full_abstract": True,
            }
            for idx in range(20)
        ]

        # Force _encode_texts_fast to return orthogonal unit vectors for cited vs candidate titles
        # on verified items (dot product = 0.22) and collinear vectors on hallucination items (dot product = 0.91)
        # to prove there is ZERO label-conditioned interval clamping!
        def _fake_encode(texts: list[str], batch_size: int = 256) -> np.ndarray:
            n_block = len(texts) // 5
            out = np.zeros((len(texts), 4), dtype=np.float32)
            for i in range(n_block):
                # Default: cited=[0.22, sqrt(1-0.22^2), 0, 0], cand=[1, 0, 0, 0] -> cos = 0.22
                out[i] = [0.22, float(np.sqrt(1.0 - 0.22**2)), 0.0, 0.0]
                out[n_block + i] = [1.0, 0.0, 0.0, 0.0]
                out[2 * n_block + i] = [0.31, float(np.sqrt(1.0 - 0.31**2)), 0.0, 0.0]
                out[3 * n_block + i] = [1.0, 0.0, 0.0, 0.0]
                out[4 * n_block + i] = [1.0, 0.0, 0.0, 0.0]
            return out

        with patch.object(trainer, "_encode_texts_fast", side_effect=_fake_encode):
            records = trainer.build_split_dataset(pool_papers, split_name="unit", seed=42)

        verified_records = [r for r in records if r["true_label"] == "verified"]
        assert len(verified_records) > 0
        # Under oracle clamping, verified title_sim_semantic was forced >= 0.65 / >= 0.86.
        # Without clamping, genuine cosine similarity 0.22 must be preserved untouched!
        assert all(abs(r["title_sim_semantic"] - 0.22) < 1e-3 for r in verified_records)

    def test_partition_stratified_pools_deduplicates_normalized_titles_across_splits(self) -> None:
        trainer = _load_script_module(
            "train_neuro_symbolic_model_dedupe", "scripts/train_neuro_symbolic_model.py"
        )
        # Include duplicate titles differing only in punctuation/case across abstract & metadata pools
        with_abs = [
            {
                "paper_id": i,
                "title": (
                    "Attention Is All You Need: Transformer Networks!"
                    if i in (1, 14, 19)
                    else f"Unique Full Abstract Paper Title {i:03d} in Computational Linguistics"
                ),
                "authors": ["Vaswani, A."],
                "year": 2017,
                "venue": "NeurIPS",
                "doi": f"10.1000/abs.{i}",
                "abstract": "Substantive abstract exceeding eighty characters for neural alignment evaluation in tests.",
                "has_full_abstract": True,
            }
            for i in range(1, 25)
        ]
        meta_only = [
            {
                "paper_id": 100 + j,
                "title": (
                    "attention is all you need transformer networks"
                    if j in (2, 9)
                    else f"Unique Metadata Only Paper Title {j:03d} in Software Engineering"
                ),
                "authors": ["Smith, J."],
                "year": 2021,
                "venue": "ICSE",
                "doi": "",
                "abstract": "",
                "has_full_abstract": False,
            }
            for j in range(1, 15)
        ]

        train_p, val_p, test_p, audit = trainer._partition_stratified_pools(with_abs, meta_only)

        def _norm(t: str) -> str:
            return " ".join("".join(ch if (ch.isalnum() or ch.isspace()) else " " for ch in t.casefold()).split())

        train_t = {_norm(p["title"]) for p in train_p}
        val_t = {_norm(p["title"]) for p in val_p}
        test_t = {_norm(p["title"]) for p in test_p}

        assert len(train_t) == len(train_p)
        assert len(val_t) == len(val_p)
        assert len(test_t) == len(test_p)
        assert len(train_t & val_t) == 0
        assert len(train_t & test_t) == 0
        assert len(val_t & test_t) == 0
        assert audit.get("train_test_title_overlap", -1) == 0

    def test_run_symbolic_rule_on_item_passes_real_titles_and_venues_and_fair_crossref(self) -> None:
        trainer = _load_script_module(
            "train_neuro_symbolic_model_rules", "scripts/train_neuro_symbolic_model.py"
        )
        pool_papers = [
            {
                "paper_id": 500 + idx,
                "title": f"Authentic Graph Neural Network Architecture Paper {idx:03d}",
                "authors": [f"Nguyen, V.{idx}"],
                "year": 2022,
                "venue": "Transactions on Machine Learning Research",
                "doi": "10.5555/real.doi.1" if idx == 0 else "",
                "abstract": (
                    "Graph neural networks aggregate neighborhood representations iteratively across layers. "
                    "Experiments demonstrate strong inductive generalization across molecular benchmarks."
                ),
                "has_full_abstract": True,
            }
            for idx in range(20)
        ]

        def _fake_encode(texts: list[str], batch_size: int = 256) -> np.ndarray:
            embs = np.zeros((len(texts), 4), dtype=np.float32)
            embs[:, 0] = 1.0
            return embs

        with patch.object(trainer, "_encode_texts_fast", side_effect=_fake_encode):
            records = trainer.build_split_dataset(pool_papers, split_name="test", seed=7)

        # Verify crossref_matched fairness: paper without DOI must NOT get crossref_matched=True just from consensus>=2
        no_doi_high_consensus = [
            r
            for r in records
            if r["has_candidate"]
            and not r["doi_exact_match"]
            and not r.get("cand_doi")
            and r["source_consensus"] >= 2
        ]
        assert len(no_doi_high_consensus) > 0
        assert all(r["crossref_matched"] is False for r in no_doi_high_consensus)

        sample = next(r for r in records if r["has_candidate"])
        assert "cited_title" in sample and "cand_title" in sample and "cited_venue" in sample

        real_rules = SymbolicRules()
        with patch.object(real_rules, "apply", wraps=real_rules.apply) as spy_apply:
            trainer._run_symbolic_rule_on_item(real_rules, sample)
            assert spy_apply.call_count == 1
            _, kwargs = spy_apply.call_args
            passed_source: SourceResult = spy_apply.call_args[0][1]
            assert kwargs.get("citation_title") == sample["cited_title"]
            assert kwargs.get("citation_venue") == sample["cited_venue"]
            assert passed_source.candidates[0].title == sample["cand_title"]
            assert passed_source.candidates[0].title != "Candidate Title"

    def test_u1_and_u2_grey_zone_scenarios_use_real_metadata_without_oracle_clamping(self) -> None:
        trainer = _load_script_module(
            "train_neuro_symbolic_model_u1_u2", "scripts/train_neuro_symbolic_model.py"
        )
        pool_papers = [
            {
                "paper_id": 2000 + idx,
                "title": f"Empirical Neural Sequence Transduction for Low Resource Translation {idx:03d}",
                "authors": [
                    f"LeadScholar{idx}, A.",
                    f"CoAuthorB{idx}, B.",
                    f"CoAuthorC{idx}, C.",
                    f"CoAuthorD{idx}, D.",
                ],
                "year": 2021,
                "venue": "Proceedings of EMNLP",
                "doi": f"10.18653/v1/2021.emnlp.{idx}" if idx % 2 == 0 else "",
                "abstract": (
                    "We study neural sequence transduction under low-resource bilingual settings. "
                    "Experiments confirm substantial gains across morphological benchmarks."
                ),
                "has_full_abstract": True,
            }
            for idx in range(50)
        ]

        def _fake_encode(texts: list[str], batch_size: int = 256) -> np.ndarray:
            n_quarter = len(texts) // 4
            out = np.zeros((len(texts), 4), dtype=np.float32)
            for i in range(n_quarter):
                out[i] = [0.42, float(np.sqrt(1.0 - 0.42**2)), 0.0, 0.0]
                out[n_quarter + i] = [1.0, 0.0, 0.0, 0.0]
                out[2 * n_quarter + i] = [0.35, float(np.sqrt(1.0 - 0.35**2)), 0.0, 0.0]
                out[3 * n_quarter + i] = [1.0, 0.0, 0.0, 0.0]
            return out

        with patch.object(trainer, "_encode_texts_fast", side_effect=_fake_encode):
            records = trainer.build_split_dataset(pool_papers, split_name="u1u2", seed=123)

        u1_records = [r for r in records if r["sub_type"] == "U1"]
        u2_records = [r for r in records if r["sub_type"] == "U2"]
        assert len(u1_records) >= 3
        assert len(u2_records) >= 2

        rules = SymbolicRules()
        for r in u1_records:
            assert r["true_label"] == "unresolved"
            assert "AmbiguousAuthor, T." not in r["cited_authors"]
            assert "UnknownColleague, R." not in r["cited_authors"]
            assert r["cited_authors"][0] == r["cand_authors"][0]
            assert r["author_jaccard"] >= 0.20
            assert r["year_distance"] in {0, 1, 2}
            assert r["doi_exact_match"] is False
            assert r["source_consensus"] == 1
            assert r["has_candidate"] is True
            _, outcome = trainer._run_symbolic_rule_on_item(rules, r)
            assert outcome.label == ValidationLabel.UNRESOLVED
            assert "R-ABSTENTION-BORDER" in outcome.triggered_rules

        seen_ra = False
        seen_rate_limit = False
        for r in u2_records:
            assert r["true_label"] == "unresolved"
            assert r["has_candidate"] is False
            _, outcome = trainer._run_symbolic_rule_on_item(rules, r)
            assert outcome.label == ValidationLabel.UNRESOLVED
            if r.get("doi_ra_status") == "registered_no_csl":
                seen_ra = True
                assert str(r.get("cited_doi", "")).startswith(("10.11499/", "10.5109/"))
                assert "R-DOI-RA-NO-CSL" in outcome.triggered_rules
            if r.get("api_exhausted") is True:
                seen_rate_limit = True
                assert "R-RATE-LIMITED-ABSTAIN" in outcome.triggered_rules
        assert seen_ra and seen_rate_limit

    def test_four_class_content_alignment_no_toy_strings_and_reviewer2_proofs(self) -> None:
        import json
        import re

        script_path = REPO_ROOT / "scripts" / "train_neuro_symbolic_model.py"
        script_text = script_path.read_text(encoding="utf-8")
        for forbidden_toy in (
            "FabricatedAuthor",
            "ImaginaryScholar",
            "GhostWriter",
            "SyntheticResearcher",
            "NonExistentName",
            "Journal of Synthetic AI Hallucinations",
            "Interplanetary",
            "UnrelatedCoAuthorX",
            "Collaborator, R.",
            "[true_auth] if has_stat_cand",
        ):
            assert forbidden_toy not in script_text, (
                f"Forbidden template/override '{forbidden_toy}' must not exist in train_neuro_symbolic_model.py"
            )
        assert "parse_vn_legal_reference(variant_raw)" in script_text

        trainer = _load_script_module(
            "train_neuro_symbolic_model_r2", "scripts/train_neuro_symbolic_model.py"
        )
        pool_papers = [
            {
                "paper_id": 3000 + idx,
                "title": (
                    f"ADaPT: Token-Level Decoupling and its Analysis (Part {idx:03d}) for [in French]"
                    if idx % 3 == 0
                    else f"Empirical Multilingual Representation Alignment for Syntactic Parsing {idx:03d}"
                ),
                "authors": [
                    f"ScholarAlpha{idx}, A.",
                    f"ScholarBeta{idx}, B.",
                    f"ScholarGamma{idx}, C.",
                    f"ScholarDelta{idx}, D.",
                ],
                "year": 2022 + (idx % 5),
                "venue": "Proceedings of the Annual Meeting of the Association for Computational Linguistics",
                "doi": f"10.18653/v1/2021.acl-long.{idx}" if idx % 2 == 0 else "",
                "abstract": (
                    f"Paper {idx} proposes multilingual representation alignment for dependency parsing. "
                    f"Experiments across twelve typologically diverse languages show consistent UAS gains."
                ),
                "has_full_abstract": True,
            }
            for idx in range(100)
        ]

        def _fake_encode(texts: list[str], batch_size: int = 256) -> np.ndarray:
            n_quarter = len(texts) // 4
            out = np.zeros((len(texts), 4), dtype=np.float32)
            for i in range(n_quarter):
                out[i] = [0.38, float(np.sqrt(1.0 - 0.38**2)), 0.0, 0.0]
                out[n_quarter + i] = [1.0, 0.0, 0.0, 0.0]
                out[2 * n_quarter + i] = [0.41, float(np.sqrt(1.0 - 0.41**2)), 0.0, 0.0]
                out[3 * n_quarter + i] = [1.0, 0.0, 0.0, 0.0]
            return out

        with patch.object(trainer, "_encode_texts_fast", side_effect=_fake_encode):
            records = trainer.build_split_dataset(pool_papers, split_name="r2", seed=99)

        # (a) Non-zero content_alignment_score MUST exist across ALL 4 canonical classes
        for cls_name in ("verified", "metadata_error", "suspected_hallucination", "unresolved"):
            cls_nonzero = [
                r for r in records if r["true_label"] == cls_name and r["content_alignment_score"] > 0.0
            ]
            assert len(cls_nonzero) > 0, (
                f"Class '{cls_name}' must contain records with content_alignment_score > 0"
            )

        # (b) Strict year upper-bound (<= 2026) and clean title splicing (zero 'for for', balanced brackets)
        for rec in records:
            assert 1950 <= int(rec["cited_year"]) <= 2026
            if int(rec["year_distance"]) < 100 and rec["has_candidate"]:
                assert abs(int(rec["cited_year"]) - int(rec["cand_year"])) == int(rec["year_distance"])
            ct = str(rec["cited_title"])
            assert not re.search(r"\b([A-Za-z]+)\s+\1\b", ct, re.IGNORECASE), f"Duplicate adjacent word in {ct!r}"
            assert not re.search(
                r"\b(?:its|their|our|his|her)\s+(?:for|via|with|in|under)\b", ct, re.IGNORECASE
            ), f"Possessive-connector collision in {ct!r}"
            assert ct.count("(") == ct.count(")"), f"Unbalanced parentheses in {ct!r}"
            assert ct.count("[") == ct.count("]"), f"Unbalanced brackets in {ct!r}"

        # (c) BaselineRunner("proposed") MUST match SymbolicRules 100% on full-metadata preview records
        summary_path = REPO_ROOT / "data" / "models" / "neuro_symbolic_dataset_summary.json"
        report_path = REPO_ROOT / "data" / "models" / "neuro_symbolic_benchmark_report.json"
        summary = json.loads(summary_path.read_text(encoding="utf-8"))
        preview = summary["sample_preview"]
        assert len(preview) >= 10
        for item in preview:
            assert 1950 <= int(item["cited_year"]) <= 2026, f"Future cited_year in sample_preview: {item}"
            ct_prev = str(item["cited_title"])
            assert not re.search(r"\bfor\s+for\b", ct_prev, re.IGNORECASE), f"for-for artifact in {ct_prev!r}"
            assert not re.search(
                r"\b(?:its|their|our|his|her)\s+(?:for|via|with|in|under)\b", ct_prev, re.IGNORECASE
            ), f"Possessive-connector artifact in {ct_prev!r}"
            assert ct_prev.count("(") == ct_prev.count(")"), f"Unbalanced parentheses in {ct_prev!r}"
            assert ct_prev.count("[") == ct_prev.count("]"), f"Unbalanced brackets in {ct_prev!r}"

        rules = SymbolicRules()
        runner = BaselineRunner(symbolic_rules=rules)
        proposed_res = runner.run("proposed", preview)
        direct_rule_preds = [
            trainer._run_symbolic_rule_on_item(rules, item)[1].label.value for item in preview
        ]
        assert proposed_res["predictions"] == direct_rule_preds

        # (d) Benchmark report JSON MUST include OOD stress suite, paired p-values & CIS sensitivity
        report = json.loads(report_path.read_text(encoding="utf-8"))
        assert report["baselines_on_test_set"]["proposed"]["accuracy"] == (
            report["neuro_symbolic_platt_calibrated"]["classification"]["accuracy"]
        )
        assert report["baselines_on_test_set"]["proposed"]["macro_f1"] == (
            report["neuro_symbolic_platt_calibrated"]["classification"]["macro_f1"]
        )

        ood = report["ood_guardrail_stress_test"]
        assert ood["total_samples"] == 2400
        assert ood["zero_train_val_overlap_verified"] is True
        assert (
            ood["overall"]["neuro_symbolic_proposed"]["accuracy"]
            > ood["overall"]["pure_ml_b5"]["accuracy"] + 0.45
        )
        assert ood["overall"]["mcnemar_ns_vs_b5"]["p_value"] < 1e-200
        assert ood["categories"]["retracted_papers"]["neuro_symbolic_accuracy"] == 1.0
        assert ood["categories"]["retracted_papers"]["pure_ml_b5_accuracy"] < 0.05
        assert ood["categories"]["vn_statutory_authority_mismatch"]["neuro_symbolic_accuracy"] == 1.0

        sig = report["statistical_significance_tests"]
        for b_key in ("B0", "B1", "B2", "B3", "B4", "B5"):
            pair = sig["pairwise_vs_baselines"][f"proposed_vs_{b_key}"]
            assert pair["mcnemar_test"]["p_value"] < 0.001
            assert pair["paired_bootstrap"]["one_sided_p_value_macro_f1"] <= 0.001
        platt_sig = sig["platt_calibration_vs_uncalibrated"]
        assert platt_sig["delta_ece"] < 0.0
        assert platt_sig["delta_brier"] < 0.0
        assert platt_sig["ece_one_sided_bootstrap_p_value"] <= 0.001

        cis_sens = report["cis_weight_sensitivity"]
        assert cis_sens["n_manuscripts"] == 300
        assert cis_sens["n_weight_perturbations"] == 20
        assert cis_sens["summary"]["mean_spearman_rho"] >= 0.98
        assert cis_sens["summary"]["min_kendall_tau"] >= 0.90


class TestEvaluationReportAndBaselines:
    """Unit coverage for EvaluationReport and CitationVerdict feature extraction in BaselineRunner."""

    def test_evaluation_report_markdown_formatting_and_empty_state(self) -> None:
        assert EvaluationReport(results={}).to_markdown() == "_No results yet_"

        report = EvaluationReport(
            results={
                "B0": {
                    "precision": 0.25,
                    "recall": 0.40,
                    "f1": 0.30,
                    "accuracy": 0.35,
                    "macro_f1": 0.28,
                },
                "proposed": {
                    "precision": 0.95,
                    "recall": 0.96,
                    "f1": 0.955,
                    "accuracy": 0.97,
                    "macro_f1": 0.955,
                },
            }
        )
        md = report.to_markdown()
        assert "| Baseline | Precision | Recall | F1 | Accuracy | Macro-F1 |" in md
        assert "| B0 | 25.00% | 40.00% | 30.00% | 35.00% | 28.00% |" in md
        assert "| proposed | 95.00% | 96.00% | 95.50% | 97.00% | 95.50% |" in md

    def test_baseline_runner_extracts_source_result_from_citation_verdict(self) -> None:
        cit = Citation(
            raw_text="Vaswani et al. (2017). Attention Is All You Need.",
            citation_type=CitationType.REFERENCE_LIST,
            title="Attention Is All You Need",
            doi="10.48550/arXiv.1706.03762",
        )
        src = SourceResult(
            citation_raw=cit.raw_text,
            candidates=[
                SourceCandidate(
                    source_name="crossref",
                    found=True,
                    title="Attention Is All You Need",
                    confidence=0.98,
                )
            ],
            sources_queried=["crossref"],
            sources_succeeded=["crossref"],
        )
        verdict = CitationVerdict(
            citation=cit,
            label=ValidationLabel.VERIFIED,
            confidence=0.98,
            matched_source=src,
            features=MatchFeatures(
                title_sim_fuzzy=0.98,
                title_sim_semantic=0.97,
                author_jaccard=1.0,
                year_distance=0,
                doi_exact_match=False,
                source_consensus=1,
            ),
        )
        extracted = BaselineRunner._extract_features(verdict)
        assert extracted["crossref_matched"] is True
        assert extracted["has_candidate"] is True
        assert extracted["cited_doi"] == "10.48550/arXiv.1706.03762"


class TestUtilityScriptsRemediation:
    """Verify utility scripts under scripts/ work with current domain models and zero ruff errors."""

    def test_sync_from_api_uses_external_ids_arxiv_without_attribute_error(
        self, tmp_path: Path
    ) -> None:
        sync_mod = _load_script_module("sync_from_api", "scripts/sync_from_api.py")
        db = LocalDatabase(tmp_path / "sync_test.db")
        cand = SourceCandidate(
            source_name="arxiv",
            found=True,
            title="FlashAttention: Fast and Memory-Efficient Exact Attention",
            authors=["Tri Dao", "Daniel Y. Fu"],
            year="2022",
            venue="NeurIPS",
            abstract="We propose FlashAttention, an IO-aware exact attention algorithm.",
            external_ids={"arxiv": "2205.14135"},
        )
        assert sync_mod.sync_paper_to_db(db, cand, source="arxiv") is True
        stored = db.find_by_arxiv_id("2205.14135")
        assert stored is not None
        assert stored.arxiv_id == "2205.14135"
        assert sync_mod.sync_paper_to_db(db, cand, source="arxiv") is False

    def test_import_openalex_cursor_pagination_abstract_reconstruction_and_fts_sync(
        self, tmp_path: Path
    ) -> None:
        oa_mod = _load_script_module("import_openalex", "scripts/import_openalex.py")

        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {
            "results": [{"id": "https://openalex.org/W1", "title": "Test Paper"}],
            "meta": {"next_cursor": "cursor_token_2"},
        }
        with patch.object(oa_mod.requests, "get", return_value=mock_resp) as mock_get:
            results = oa_mod.search_papers("transformers", field="cs", limit=50, page=2)
            assert len(results) == 1
            called_params = mock_get.call_args.kwargs["params"]
            assert "offset" not in called_params
            assert called_params.get("page") == 2 or "cursor" in called_params

        work = {
            "id": "https://openalex.org/W2963403868",
            "title": "Attention Is All You Need",
            "publication_year": 2017,
            "doi": "https://doi.org/10.5555/3295222.3295349",
            "authorships": [{"author": {"display_name": "Ashish Vaswani"}}],
            "primary_location": {"source": {"display_name": "NeurIPS"}},
            "concepts": [{"display_name": "Deep learning", "score": 0.85}],
            "abstract_inverted_index": {
                "Dominant": [0],
                "sequence": [1],
                "transduction": [2],
                "models": [3],
            },
        }
        paper_dict = oa_mod.paper_to_dict(work)
        assert paper_dict["abstract"] == "Dominant sequence transduction models"

        db_file = tmp_path / "oa_fts.db"
        conn = sqlite3.connect(str(db_file))
        for stmt in INIT_STATEMENTS:
            conn.executescript(stmt)
        row_id = oa_mod.insert_paper(conn, paper_dict)
        conn.commit()
        assert row_id is not None

        fts_hits = conn.execute(
            "SELECT rowid FROM papers_fts WHERE papers_fts MATCH 'transduction'"
        ).fetchall()
        conn.close()
        assert len(fts_hits) == 1

    def test_demo_content_alignment_and_ground_truth_eval_scripts_clean(self) -> None:
        demo_src = (REPO_ROOT / "scripts" / "demo_content_alignment_e2e.py").read_text(
            encoding="utf-8"
        )
        assert "sources_failed={}" in demo_src
        assert "sources_failed=[]" not in demo_src

        gt_mod = _load_script_module(
            "run_ground_truth_evaluation",
            "scripts/evaluation/run_ground_truth_evaluation.py",
        )
        samples = gt_mod.load_ground_truth()
        assert isinstance(samples, list) and len(samples) > 0

    def test_shell_scripts_use_docker_compose_api_health_and_respect_docker_context(self) -> None:
        docker_start = (REPO_ROOT / "scripts" / "docker-start.sh").read_text(encoding="utf-8")
        assert "docker-compose " not in docker_start
        assert "docker compose " in docker_start
        assert "http://localhost:8000/api/health" in docker_start
        assert "http://localhost:8000/health" not in docker_start

        grobid_setup = (REPO_ROOT / "scripts" / "grobid_docker_setup.sh").read_text(
            encoding="utf-8"
        )
        assert "DOCKER_CONTEXT=desktop-linux" not in grobid_setup

    def test_ruff_check_scripts_exits_zero(self) -> None:
        proc = subprocess.run(
            [sys.executable, "-m", "ruff", "check", "scripts/"],
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
            check=False,
        )
        assert proc.returncode == 0, f"ruff check scripts/ failed:\n{proc.stdout}\n{proc.stderr}"


class TestConfigsPackagingCiAndDocsParity:
    """Verify configs, packaging, Makefile, CI workflow, E2E mocks, and v3.76.0 documentation."""

    def test_configs_yaml_parity_with_source_toggle_and_rate_limits(self) -> None:
        cfg_main = yaml.safe_load((REPO_ROOT / "configs" / "config.yaml").read_text("utf-8"))
        cfg_example = yaml.safe_load(
            (REPO_ROOT / "configs" / "config.example.yaml").read_text("utf-8")
        )
        expected_sources = set(SourceToggleConfig.model_fields.keys())
        expected_rates = set(RateLimitsConfig.model_fields.keys())

        assert set(cfg_main["retrieval"]["sources"].keys()) == expected_sources
        assert set(cfg_example["retrieval"]["sources"].keys()) == expected_sources
        assert set(cfg_main["retrieval"]["rate_limits"].keys()) == expected_rates
        assert set(cfg_example["retrieval"]["rate_limits"].keys()) == expected_rates

    def test_env_example_uses_safe_vnpay_placeholder(self) -> None:
        env_example = (REPO_ROOT / ".env.example").read_text(encoding="utf-8")
        assert "CITRAVNPSANDBOXSECRETKEY2026HMAC512" not in env_example
        assert "VNPAY_HASH_SECRET=" in env_example

    def test_pyproject_and_requirements_declare_ml_deps_and_dev_extra(self) -> None:
        pyproject_text = (REPO_ROOT / "pyproject.toml").read_text(encoding="utf-8")
        req_text = (REPO_ROOT / "requirements.txt").read_text(encoding="utf-8")

        for pkg in ("numpy", "scipy", "scikit-learn"):
            assert pkg in pyproject_text, f"{pkg} missing from pyproject.toml"
            assert pkg in req_text, f"{pkg} missing from requirements.txt"

        assert "dev = [" in pyproject_text
        assert "Development Status :: 3 - Alpha" not in pyproject_text

    def test_makefile_and_ci_workflow_updated(self) -> None:
        makefile = (REPO_ROOT / "Makefile").read_text(encoding="utf-8")
        assert "black " not in makefile and "isort " not in makefile
        assert "ruff check src/ tests/ scripts/" in makefile
        assert "-m integration" not in makefile

        ci_yml = (REPO_ROOT / ".github" / "workflows" / "ci-cd.yml").read_text(encoding="utf-8")
        assert "npm run lint" in ci_yml
        assert "ruff check src/ tests/ scripts/" in ci_yml
        assert "pytest tests/ -q" in ci_yml
        assert "citra-api:ci" in ci_yml

    def test_responsive_e2e_spec_mocks_real_api_routes(self) -> None:
        spec_ts = (REPO_ROOT / "web" / "tests" / "e2e" / "responsive.spec.ts").read_text(
            encoding="utf-8"
        )
        assert "/api/teacher/classes" in spec_ts
        assert "/api/audit/logs" in spec_ts
        assert "/api/system/health" in spec_ts
        assert "/api/admin/system-health" not in spec_ts
        assert "/api/admin/audit-log" not in spec_ts

    def test_performance_benchmark_and_docs_sync_v376(self, tmp_path: Path) -> None:
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
            concurrency_levels=(10,),
            max_concurrent_workers=2,
            citations_per_submission=3,
            simulated_api_latency_ms=(0.5, 1.0),
            db_dir=tmp_path,
        )
        md = format_benchmark_markdown(
            FullPerformanceBenchmarkReport(
                generated_at="2026-11-16T00:00:00Z",
                environment={"python": "3.11"},
                scale_benchmarks=scale_res,
                deadline_stress_benchmarks=stress_res,
            )
        )
        assert "SQLite WAL" in md

        progress_doc = (
            REPO_ROOT / "docs" / "reports" / "BAO_CAO_TIEN_DO_01_11_15_11.md"
        ).read_text(encoding="utf-8")
        assert "I/O" in progress_doc and "SQLite WAL" in progress_doc

        readme = (REPO_ROOT / "README.md").read_text(encoding="utf-8")
        claude = (REPO_ROOT / "CLAUDE.md").read_text(encoding="utf-8")
        bench_report_md = (
            REPO_ROOT / "docs" / "reports" / "BENCHMARK_120K_NEURO_SYMBOLIC_REPORT.md"
        ).read_text(encoding="utf-8")
        train_script_src = (
            REPO_ROOT / "scripts" / "train_neuro_symbolic_model.py"
        ).read_text(encoding="utf-8")
        assert __version__ in readme
        assert __version__ in claude
        assert __version__ in bench_report_md
        assert "_extract_distinctive_stems" not in train_script_src
        import json

        bench_json = json.loads(
            (REPO_ROOT / "data" / "models" / "neuro_symbolic_benchmark_report.json").read_text(
                encoding="utf-8"
            )
        )
        prop_acc_pct = f"{bench_json['baselines_on_test_set']['proposed']['accuracy'] * 100:.2f}"
        prop_ece_str = f"{bench_json['neuro_symbolic_platt_calibrated']['calibration']['ece']:.4f}"
        b5_id_acc_pct = f"{bench_json['baselines_on_test_set']['B5']['accuracy'] * 100:.2f}%"
        b5_ood_acc_pct = f"{bench_json['ood_guardrail_stress_test']['overall']['pure_ml_b5']['accuracy'] * 100:.2f}%"
        assert f"{prop_acc_pct}%25_Neuro--Symbolic" in readme
        assert f"{prop_ece_str}_ECE" in readme
        assert b5_id_acc_pct in readme
        assert b5_ood_acc_pct in readme
        for stale_tok in ("99.01%", "99.01%25", "0.9881", "0.0394"):
            assert stale_tok not in readme
            assert stale_tok not in bench_report_md
        assert "/api/auth/token" not in readme
        assert "/api/verify" not in readme
        assert "src/integrity_checker/ingestion" not in readme
        assert "2,100+" in readme or "2,085+" in readme
        assert "340+" in readme
        assert "2,100+" in claude or "2,085+" in claude
        assert "340+" in claude
