"""Unit tests for BaselineRunner evaluation baselines."""

from __future__ import annotations

import pytest

from integrity_checker.evaluation.baselines import BaselineRunner

SAMPLE_DATASET = [
    {
        "id": "c1",
        "true_label": "verified",
        "doi_exact_match": True,
        "title_sim_fuzzy": 0.96,
        "title_sim_semantic": 0.95,
        "author_jaccard": 1.0,
        "year_distance": 0,
        "source_consensus": 2,
        "crossref_matched": True,
    },
    {
        "id": "c2",
        "true_label": "metadata_error",
        "doi_exact_match": False,
        "title_sim_fuzzy": 0.78,
        "title_sim_semantic": 0.80,
        "author_jaccard": 0.25,
        "year_distance": 2,
        "source_consensus": 1,
        "crossref_matched": True,
    },
    {
        "id": "c3",
        "true_label": "suspected_hallucination",
        "doi_exact_match": False,
        "title_sim_fuzzy": 0.15,
        "title_sim_semantic": 0.20,
        "author_jaccard": 0.0,
        "year_distance": 5,
        "source_consensus": 0,
        "crossref_matched": False,
    },
    {
        "id": "c4",
        "true_label": "unresolved",
        "doi_exact_match": False,
        "title_sim_fuzzy": 0.50,
        "title_sim_semantic": 0.52,
        "author_jaccard": 0.40,
        "year_distance": 1,
        "source_consensus": 0,
        "crossref_matched": False,
    },
]


def test_baseline_runner_supports_all_baselines():
    runner = BaselineRunner()
    for name in [
        "B0",
        "B1",
        "B2",
        "B3",
        "B4",
        "proposed",
        "doi_only",
        "single_source_crossref",
        "fuzzy_only",
        "no_calibration",
    ]:
        res = runner.run(name, SAMPLE_DATASET)
        assert res["num_samples"] == 4
        assert len(res["predictions"]) == 4
        assert res["metrics"] is not None
        assert 0.0 <= res["metrics"]["macro_f1"] <= 1.0


def test_baseline_runner_proposed_outperforms_doi_only():
    runner = BaselineRunner()
    b0 = runner.run("doi_only", SAMPLE_DATASET)
    proposed = runner.run("proposed", SAMPLE_DATASET)
    assert proposed["predictions"] == [
        "verified",
        "metadata_error",
        "suspected_hallucination",
        "unresolved",
    ]
    assert proposed["metrics"]["macro_f1"] > b0["metrics"]["macro_f1"]


def test_baseline_runner_rejects_unknown_baseline():
    runner = BaselineRunner()
    with pytest.raises(ValueError, match="Unknown baseline"):
        runner.run("invalid_baseline", SAMPLE_DATASET)
