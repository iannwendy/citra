"""Tests for ``scripts/backfill_citation_confidence.py``.

The reference-list parser used to leave ``Citation.confidence`` at its 0.0
default, so historical ``app.db`` rows stored no confidence.  The backfill
script re-derives the score with the same helper the parser now uses; these
tests lock in that the recomputed value matches the helper and that the
script only writes when ``--apply`` is passed.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest
from sqlalchemy import create_engine, text

from integrity_checker.extraction.reference_parser import (
    _estimate_reference_confidence,
)
from integrity_checker.models.citation import Citation

_REPO_ROOT = Path(__file__).resolve().parents[2]


def _load_backfill_module():
    spec = importlib.util.spec_from_file_location(
        "backfill_citation_confidence",
        _REPO_ROOT / "scripts" / "backfill_citation_confidence.py",
    )
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def test_recover_doi_from_arxiv_and_url():
    module = _load_backfill_module()
    assert (
        module._recover_doi('V. Ho, "Emotion recognition," arXiv:1911.09339, 2019.')
        == "10.48550/arXiv.1911.09339"
    )
    assert (
        module._recover_doi("See https://arxiv.org/abs/1907.11692 for details.")
        == "10.48550/arXiv.1907.11692"
    )
    assert (
        module._recover_doi("https://doi.org/10.18653/v1/N19-1423.")
        == "10.18653/v1/N19-1423"
    )
    assert module._recover_doi("no identifier here") is None


def test_recover_venue_between_commas():
    module = _load_backfill_module()
    assert (
        module._recover_venue(
            "[18] Scikit-learn, Journal of Machine Learning Research, vol. 12, pp. 2825-2830, 2011."
        )
        == "Journal of Machine Learning Research"
    )
    assert module._recover_venue("no venue, 2020") is None


def test_inline_surname_and_year_variants():
    module = _load_backfill_module()
    assert module._inline_surname_and_year("(WHO, 2023)") == ("WHO", "2023")
    assert module._inline_surname_and_year("Sennrich et al. (2016)") == (
        "Sennrich",
        "2016",
    )
    assert module._inline_surname_and_year("Hall (1989)") == ("Hall", "1989")


def test_match_reference_by_surname_and_year():
    module = _load_backfill_module()
    refs = [
        (1, '["sennrich", "haddow"]', "2016", "Neural Machine Translation", None, None),
        (2, '["hall"]', "1990", "Other Paper", None, None),
    ]
    assert module._match_reference("Sennrich", "2016", refs)[3] == (
        "Neural Machine Translation"
    )
    assert module._match_reference("Hall", "1989", refs) is None


def _make_db(tmp_path: Path):
    engine = create_engine(f"sqlite:///{tmp_path / 'app.db'}")
    with engine.begin() as conn:
        conn.execute(
            text(
                "CREATE TABLE citations ("
                "id INTEGER PRIMARY KEY, essay_id INTEGER NOT NULL, "
                "citation_type TEXT NOT NULL, raw_text TEXT NOT NULL, "
                "title TEXT, authors TEXT, year TEXT, "
                "doi TEXT, venue TEXT, confidence FLOAT NOT NULL)"
            )
        )
        conn.execute(
            text(
                "INSERT INTO citations (id, essay_id, citation_type, raw_text, "
                "title, authors, year, doi, venue, confidence) VALUES "
                "(1, 1, 'reference_list', 'Doe, J. (2020). A Real Paper.', "
                "'A Real Paper', '[\"Jane Doe\"]', '2020', '10.1/x', NULL, 0.0),"
                "(2, 1, 'in_text', '(WHO, 2023)', NULL, '[]', NULL, NULL, NULL, 0.0)"
            )
        )
    return engine


def test_backfill_recomputes_confidence_with_parser_helper(tmp_path, monkeypatch):
    module = _load_backfill_module()
    engine = _make_db(tmp_path)
    try:
        import integrity_checker.db.session as session_mod

        monkeypatch.setattr(
            module,
            "get_session",
            lambda: session_mod.Session(engine),
        )
        monkeypatch.setattr(sys, "argv", ["backfill", "--apply"])
        assert module.main() == 0

        with engine.begin() as conn:
            rows = dict(
                conn.execute(text("SELECT id, confidence FROM citations")).all()
            )

        expected_full = _estimate_reference_confidence(
            Citation(
                raw_text="",
                title="A Real Paper",
                authors=["Jane Doe"],
                year="2020",
                doi="10.1/x",
            )
        )
        assert rows[1] == pytest.approx(expected_full)
        # An inline short-form row has no resolvable reference, so it stays 0.0.
        assert rows[2] == pytest.approx(0.0)
    finally:
        engine.dispose()


def test_backfill_dry_run_does_not_write(tmp_path, monkeypatch):
    module = _load_backfill_module()
    engine = _make_db(tmp_path)
    try:
        import integrity_checker.db.session as session_mod

        monkeypatch.setattr(module, "get_session", lambda: session_mod.Session(engine))
        monkeypatch.setattr(sys, "argv", ["backfill"])
        assert module.main() == 0

        with engine.begin() as conn:
            rows = dict(conn.execute(text("SELECT id, confidence FROM citations")).all())
        assert rows[1] == pytest.approx(0.0)
        assert rows[2] == pytest.approx(0.0)
    finally:
        engine.dispose()
