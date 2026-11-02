"""Guard tests: the backend must stay lint-clean and keep its public re-exports.

These tests fail if new ruff violations are introduced under ``src/`` or
``tests/`` and protect the backward-compatible re-exports that the lint
cleanup intentionally preserved (``__all__`` / ``# noqa: F401  re-export``).
"""

from __future__ import annotations

import importlib
import importlib.util
import subprocess
import sys
import warnings
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]

_ruff_available = importlib.util.find_spec("ruff") is not None


@pytest.mark.skipif(not _ruff_available, reason="ruff not installed in this environment")
def test_ruff_check_src_and_tests_is_clean():
    proc = subprocess.run(
        [sys.executable, "-m", "ruff", "check", "src/", "tests/", "--output-format", "concise"],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        timeout=120,
    )
    assert proc.returncode == 0, f"ruff reported violations:\n{proc.stdout}\n{proc.stderr}"


def test_extraction_package_reexports_grobid_service_api():
    extraction = importlib.import_module("integrity_checker.extraction")
    for name in (
        "GROBID_STATUS",
        "GrobidServiceManager",
        "GrobidStats",
        "get_grobid_manager",
        "reset_grobid_manager",
    ):
        assert name in extraction.__all__, name
        assert hasattr(extraction, name), name


def test_deprecated_regex_patterns_module_keeps_compat_surface():
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", DeprecationWarning)
        mod = importlib.import_module("integrity_checker.extraction.regex_patterns")
    for name in (
        "DOI_PATTERN",
        "URL_PATTERN",
        "YEAR_PATTERN",
        "CitationStyle",
        "CitationType",
        "CitationPattern",
        "CITATION_PATTERNS",
        "extract_doi",
        "get_all_patterns",
    ):
        assert name in mod.__all__, name
        assert getattr(mod, name) is not None, name


def test_semantic_and_statuses_private_reexports_still_importable():
    from integrity_checker.linking.statuses import MappingMethod
    from integrity_checker.matching.semantic import _VN_DIACRITIC_RE, _VN_EN_ACADEMIC_BRIDGE
    from integrity_checker.models.validation import MappingMethod as CanonicalMappingMethod

    assert MappingMethod is CanonicalMappingMethod
    assert len(_VN_EN_ACADEMIC_BRIDGE) > 0
    assert _VN_DIACRITIC_RE.search("Nguyễn") is not None


def test_repository_session_model_not_shadowed_by_orm_session():
    """`Repository.create_session` must build the ORM model, not a SQLAlchemy Session."""
    from integrity_checker.db import models
    from integrity_checker.db import repository as repo_mod

    assert repo_mod.Session is models.Session
