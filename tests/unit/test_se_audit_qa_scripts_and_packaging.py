"""TDD regression suite for SE Holistic Audit Track 5 (QA, Packaging, Determinism & Scripts).

Covers:
- QA-01: TLS certificate verification enforced in dataset collectors (zero verify=False / disable_warnings)
- QA-02: Dependency & SemVer parity across pyproject.toml, requirements.txt, requirements-dev.txt, web/package-lock.json
- QA-03 & QA-13: Zero @pytest.mark.integration in tests/unit/, lazy GROBID check, non-vacuous assertions
- QA-04: conftest.py isolates DATA_DIR/CACHE_DIR to tmp_path, strips live API keys, resets singletons & DB engine
- QA-05: test_acl_retrieval_accuracy.py honors use_external_apis=False, tracks false_positives & partial_matches, guards empty DB, seeds sampling
- QA-06: populate_venues.py word-boundary matching (no blanket source overwrites), import_s2orc.py None-line & category/limit fixes, import_openalex.py bounded retries, backfill_citation_confidence.py orig_doi/orig_venue tracking & session cleanup
- QA-07: bump_version.py syncs web/package-lock.json, validates ISO --date, and aborts --post-commit on dirty unstaged version files
- QA-09: [tool.mypy] config in pyproject.toml (no hardcoded python_version="3.11", check_untyped_defs, no_implicit_optional)
- QA-12: Zero hardcoded /Users/iannwendy paths in scripts/, non-vacuous CLI exits in build_local_db.py & sync_from_api.py, BibTeX key disambiguation
"""

from __future__ import annotations

import ast
import importlib.util
import json
import os
import re
import subprocess
import sys
import tomllib
from pathlib import Path
from types import ModuleType
from unittest.mock import MagicMock, patch

import pytest
import requests

from integrity_checker.config import get_settings
from integrity_checker.database import LocalDatabase, Paper
from integrity_checker.models.source import SourceCandidate, SourceResult

REPO_ROOT = Path(__file__).resolve().parents[2]


def _load_script(module_name: str, rel_path: str) -> ModuleType:
    script_path = REPO_ROOT / rel_path
    spec = importlib.util.spec_from_file_location(module_name, script_path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


def _parse_req_names_and_specs(req_text: str) -> dict[str, str]:
    out: dict[str, str] = {}
    for raw_line in req_text.splitlines():
        line = raw_line.split("#", 1)[0].strip()
        if not line or line.startswith("-"):
            continue
        m = re.match(r"^([A-Za-z0-9_.-]+)(?:\[[^\]]+\])?(.*)$", line)
        if m:
            out[m.group(1).lower()] = m.group(2).strip()
    return out


# ============================================================================
# QA-01: TLS Verification in Dataset Collectors
# ============================================================================


class TestQA01DatasetCollectorTlsSecurity:
    """Verify dataset collectors never disable TLS verification or warnings."""

    @pytest.mark.parametrize(
        "rel_path",
        [
            "scripts/collect_dataset/collect_tdtu_idiscovery.py",
            "scripts/collect_dataset/collect_200_open_theses.py",
        ],
    )
    def test_zero_verify_false_or_disable_warnings_in_collectors(self, rel_path: str) -> None:
        src = (REPO_ROOT / rel_path).read_text(encoding="utf-8")
        assert "disable_warnings" not in src
        assert "InsecureRequestWarning" not in src

        tree = ast.parse(src, filename=rel_path)
        for node in ast.walk(tree):
            if isinstance(node, ast.Call):
                for kw in node.keywords:
                    if kw.arg in ("verify", "ignore_https_errors"):
                        assert not (
                            isinstance(kw.value, ast.Constant) and kw.value.value is False
                            if kw.arg == "verify"
                            else isinstance(kw.value, ast.Constant) and kw.value.value is True
                        ), f"Forbidden {kw.arg}={ast.unparse(kw.value)} in {rel_path}:{node.lineno}"

    def test_tdtu_collector_defaults_to_verify_true_and_supports_ca_bundle(self) -> None:
        mod = _load_script(
            "qa01_tdtu",
            "scripts/collect_dataset/collect_tdtu_idiscovery.py",
        )
        captured_verify: list[object] = []

        class _DummySession:
            def __init__(self) -> None:
                self.headers: dict[str, str] = {}
                self.closed: bool = False

            def __enter__(self) -> _DummySession:
                return self

            def __exit__(self, *_exc: object) -> None:
                self.closed = True

            def get(self, _url: str, **kwargs: object) -> MagicMock:
                captured_verify.append(kwargs.get("verify", True))
                resp = MagicMock()
                resp.status_code = 200
                resp.text = '<input name="execution" value="e1s1">'
                return resp

            def post(self, _url: str, **kwargs: object) -> MagicMock:
                captured_verify.append(kwargs.get("verify", True))
                resp = MagicMock()
                resp.status_code = 200
                resp.text = "pds_handle=987654"
                return resp

        ca_pem = Path(__file__).resolve()  # Existing file on disk for CA path validation
        with patch.object(mod.requests, "Session", _DummySession):
            handle = mod.get_cas_pds_handle("student_id", "secret_pw")
            assert handle == "987654"
            assert captured_verify == [True, True]

            captured_verify.clear()
            mod.get_cas_pds_handle("student_id", "secret_pw", ca_bundle=str(ca_pem))
            assert captured_verify == [str(ca_pem), str(ca_pem)]

        for bad_ca in (False, "   ", "/nonexistent/custom/university-ca.pem"):
            with pytest.raises(ValueError):
                mod.get_cas_pds_handle("student_id", "secret_pw", ca_bundle=bad_ca)  # type: ignore[arg-type]

    def test_200_theses_collector_threads_ca_bundle_to_all_discovery_endpoints(self) -> None:
        mod = _load_script("qa01_200_theses", "scripts/collect_dataset/collect_200_open_theses.py")
        ca_pem = str(Path(__file__).resolve())

        for bad_ca in (False, "   ", "/nonexistent/ca-bundle.pem"):
            with pytest.raises(ValueError):
                mod._resolve_tls_verify(bad_ca)  # type: ignore[arg-type]

        seen_verify: list[object] = []

        class _TrackingSession:
            def __init__(self) -> None:
                self.headers: dict[str, str] = {}
                self.closed = False

            def __enter__(self) -> _TrackingSession:
                return self

            def __exit__(self, *_exc: object) -> None:
                self.closed = True

            def get(self, _url: str, **kwargs: object) -> MagicMock:
                seen_verify.append(kwargs.get("verify"))
                r = MagicMock(status_code=200)
                r.json.return_value = {"_embedded": {"searchResult": {"_embedded": {"objects": []}}}}
                return r

        def _fake_get(_url: str, **kwargs: object) -> MagicMock:
            seen_verify.append(kwargs.get("verify"))
            r = MagicMock(status_code=200)
            r.json.return_value = {"hits": {"hits": []}, "results": []}
            return r

        with (
            patch.object(mod.requests, "Session", _TrackingSession),
            patch.object(mod.requests, "get", side_effect=_fake_get),
        ):
            mod.fetch_dspace7_candidates("Repo", "https://example.edu/server/api", ["thesis"], max_pages=1, ca_bundle=ca_pem)
            mod.fetch_zenodo_thesis_candidates(max_pages=1, ca_bundle=ca_pem)
            mod.fetch_openalex_thesis_candidates(ca_bundle=ca_pem)

        assert len(seen_verify) >= 3
        assert all(v == ca_pem for v in seen_verify)


# ============================================================================
# QA-02 & QA-09: Packaging Parity & [tool.mypy] Config
# ============================================================================


class TestQA02AndQA09PackagingAndMypyParity:
    """Verify dependency manifests, lockfile version, and [tool.mypy] configuration."""

    def test_runtime_and_dev_dependencies_parity(self) -> None:
        pyproject = tomllib.loads((REPO_ROOT / "pyproject.toml").read_text(encoding="utf-8"))
        req_specs = _parse_req_names_and_specs(
            (REPO_ROOT / "requirements.txt").read_text(encoding="utf-8")
        )
        dev_specs = _parse_req_names_and_specs(
            (REPO_ROOT / "requirements-dev.txt").read_text(encoding="utf-8")
        )
        pyproject_deps = _parse_req_names_and_specs("\n".join(pyproject["project"]["dependencies"]))
        pyproject_dev = _parse_req_names_and_specs(
            "\n".join(pyproject["project"]["optional-dependencies"]["dev"])
        )

        # Direct imports in src/ and training scripts must be declared explicitly,
        # and runtime manifests must match 1-to-1 with zero version-specifier drift.
        for required_pkg in ("httpcore", "torch", "numpy", "scipy", "scikit-learn"):
            assert required_pkg in pyproject_deps, f"{required_pkg} missing in pyproject.toml"
            assert required_pkg in req_specs, f"{required_pkg} missing in requirements.txt"
        assert pyproject_deps == req_specs

        # Dead unused dependencies removed
        for dead_pkg in ("aiohttp", "aiofiles", "arxiv"):
            assert dead_pkg not in pyproject_deps, f"Dead {dead_pkg} still in pyproject.toml"
            assert dead_pkg not in req_specs, f"Dead {dead_pkg} still in requirements.txt"

        # Unused formatters removed (Ruff is the sole linter/formatter)
        assert "black" not in dev_specs
        assert "isort" not in dev_specs
        assert "black" not in pyproject.get("tool", {})
        assert "isort" not in pyproject.get("tool", {})

        # Dev test runner upper bounds aligned between requirements-dev.txt and pyproject.toml
        for test_pkg in ("pytest", "pytest-asyncio", "pytest-cov"):
            assert dev_specs[test_pkg] == pyproject_dev[test_pkg]

    def test_web_package_lock_version_synced_with_package_json(self) -> None:
        pkg_json = json.loads((REPO_ROOT / "web" / "package.json").read_text(encoding="utf-8"))
        lock_json = json.loads(
            (REPO_ROOT / "web" / "package-lock.json").read_text(encoding="utf-8")
        )
        expected_ver = pkg_json["version"]
        assert lock_json["version"] == expected_ver
        assert lock_json["packages"][""]["version"] == expected_ver

    def test_mypy_config_supports_ci_and_local_python_without_hardcoded_311(self) -> None:
        pyproject = tomllib.loads((REPO_ROOT / "pyproject.toml").read_text(encoding="utf-8"))
        mypy_cfg = pyproject["tool"]["mypy"]
        assert "python_version" not in mypy_cfg
        assert mypy_cfg["strict"] is False
        assert mypy_cfg["no_implicit_optional"] is True
        assert mypy_cfg["check_untyped_defs"] is True
        assert mypy_cfg["warn_return_any"] is False
        assert mypy_cfg["warn_unused_configs"] is True
        assert mypy_cfg["ignore_missing_imports"] is True


# ============================================================================
# QA-03, QA-04 & QA-13: Test Suite Isolation, Marker Filtering & Conftest Hygiene
# ============================================================================


class TestQA03QA04QA13SuiteIsolationAndConftest:
    """Verify unit tests never carry integration markers, block on import, or leak .env keys."""

    def test_pyproject_excludes_slow_and_integration_by_default(self) -> None:
        pyproject = tomllib.loads((REPO_ROOT / "pyproject.toml").read_text(encoding="utf-8"))
        addopts = pyproject["tool"]["pytest"]["ini_options"]["addopts"]
        assert "not slow and not integration" in addopts

    def test_zero_integration_markers_inside_tests_unit(self) -> None:
        offenders: list[str] = []
        for py_file in sorted((REPO_ROOT / "tests" / "unit").rglob("*.py")):
            if py_file.name == Path(__file__).name:
                continue
            src = py_file.read_text(encoding="utf-8")
            if "pytest.mark.integration" in src:
                offenders.append(str(py_file.relative_to(REPO_ROOT)))
        assert offenders == [], f"Integration-marked tests found inside tests/unit/: {offenders}"

        live_serp = REPO_ROOT / "tests" / "integration" / "test_serpapi_live.py"
        assert live_serp.exists(), "Live SerpApi tests must live in tests/integration/test_serpapi_live.py"
        live_src = live_serp.read_text(encoding="utf-8")
        assert "pytest.mark.integration" in live_src
        assert "result.found in [True, False]" not in live_src
        assert "result.error is None" in live_src

    def test_grobid_integration_has_zero_import_time_http_and_non_vacuous_report_assert(
        self,
    ) -> None:
        grobid_test_path = REPO_ROOT / "tests" / "integration" / "test_grobid_integration.py"
        src = grobid_test_path.read_text(encoding="utf-8")
        assert "isinstance(report, type(report))" not in src
        assert "isinstance(report, AnalysisReport)" in src

        with patch.object(
            requests,
            "get",
            side_effect=AssertionError("Import-time HTTP call is forbidden during collection!"),
        ):
            _load_script("qa03_grobid_import_check", "tests/integration/test_grobid_integration.py")

    def test_conftest_strips_live_api_keys_and_isolates_data_and_cache_dirs(self) -> None:
        for secret_env in (
            "SERPAPI_API_KEY",
            "SERPER_API_KEY",
            "OPENALEX_API_KEY",
            "STRIPE_SECRET_KEY",
        ):
            assert os.environ.get(secret_env) is None, f"{secret_env} leaked into test environment"

        get_settings.cache_clear()
        settings = get_settings()
        # Even after get_settings() runs, live keys from developer .env must not re-enter os.environ!
        assert os.environ.get("SERPAPI_API_KEY") is None
        assert os.environ.get("SERPER_API_KEY") is None
        assert settings.serpapi_api_key == ""
        assert settings.serper_api_key == ""

        repo_data = (REPO_ROOT / "data").resolve()
        assert settings.paths.data_dir.resolve() != repo_data
        assert settings.paths.cache_dir.resolve() != (repo_data / "cache").resolve()

    def test_conftest_grobid_cache_readonly_fallback_preserves_precomputed_tei_and_invalidation(
        self, tmp_path: Path
    ) -> None:
        from integrity_checker.extraction.grobid_service import GrobidServiceManager

        repo_grobid_dir = REPO_ROOT / "data" / "cache" / "grobid"
        sample_cached = next(repo_grobid_dir.glob("*.tei.xml"), None) if repo_grobid_dir.exists() else None
        if sample_cached is None:
            pytest.skip("No pre-cached .tei.xml in data/cache/grobid")

        dummy_pdf = tmp_path / "dummy.pdf"
        dummy_pdf.write_bytes(b"%PDF-1.4\n")
        with (
            patch.object(GrobidServiceManager, "_check_docker_available"),
            patch.object(GrobidServiceManager, "_check_docker_sdk", return_value=False),
        ):
            mgr = GrobidServiceManager(config=get_settings().extraction.grobid)

        # Force get_cache_path to map dummy_pdf to an existing repo SHA filename inside isolated tmp_path cache
        isolated_target = get_settings().paths.grobid_output_dir / sample_cached.name
        with patch.object(mgr, "get_cache_path", return_value=isolated_target):
            content = mgr.get_from_cache(str(dummy_pdf))
            assert content is not None and "<TEI" in content
            assert mgr.stats.cache_hits == 1
            assert mgr.stats.cache_misses == 0
            # Read-only fallback must NOT copy into tmp_path or mutate repo file
            assert not isolated_target.exists()

            # Invalidating inside test suppresses read-only fallback for the remainder of the test
            assert mgr.invalidate_cache(str(dummy_pdf)) == 1
            assert sample_cached.exists(), "Repo cache file must never be deleted!"
            assert mgr.get_from_cache(str(dummy_pdf)) is None
            assert mgr.stats.cache_misses == 1

    def test_conftest_integration_dotenv_scoping_does_not_leak_to_unit_env(
        self, tmp_path: Path
    ) -> None:
        import dotenv

        from tests import conftest as conftest_mod

        assert dotenv.load_dotenv() is False
        assert hasattr(conftest_mod, "_BOOT_AMBIENT_SECRETS")

        fake_env = tmp_path / ".env"
        fake_env.write_text(
            "SERPAPI_API_KEY=from_dotenv_live_key\nCONTACT_EMAIL=dotenv_test@example.org\nDATA_DIR=/should/not/override\n",
            encoding="utf-8",
        )
        fake_req = MagicMock()
        fake_req.node.get_closest_marker.side_effect = (
            lambda name: True if name == "integration" else None
        )
        mp = pytest.MonkeyPatch()
        try:
            with patch.object(conftest_mod, "REPO_ROOT", tmp_path), patch.dict(
                conftest_mod._BOOT_AMBIENT_SECRETS, {}, clear=True
            ):
                gen = conftest_mod.set_test_env.__wrapped__(fake_req, mp, tmp_path / "run_tmp")
                next(gen)
                assert os.environ.get("SERPAPI_API_KEY") == "from_dotenv_live_key"
                assert os.environ.get("CONTACT_EMAIL") == "dotenv_test@example.org"
                assert os.environ.get("DATA_DIR") != "/should/not/override"
                with pytest.raises(StopIteration):
                    next(gen)
        finally:
            mp.undo()

        # After monkeypatch undo, neither SERPAPI_API_KEY nor CONTACT_EMAIL leaks into os.environ
        assert os.environ.get("SERPAPI_API_KEY") is None
        assert os.environ.get("CONTACT_EMAIL") != "dotenv_test@example.org"


# ============================================================================
# QA-05: Scientific Evaluation Integrity in scripts/test_acl_retrieval_accuracy.py
# ============================================================================


class TestQA05AclRetrievalAccuracyScript:
    """Verify offline mode, false-positive precision accounting, partial match bucket, and seed."""

    @pytest.mark.asyncio
    async def test_offline_mode_precision_partial_matches_and_empty_report(
        self, tmp_path: Path
    ) -> None:
        mod = _load_script("qa05_acl_eval", "scripts/test_acl_retrieval_accuracy.py")
        db_path = tmp_path / "acl_eval.db"
        db = LocalDatabase(db_path)
        db.add_paper(
            Paper(
                doi="10.18653/v1/N19-1423",
                title="BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding",
                authors=["Jacob Devlin", "Ming-Wei Chang"],
                year=2019,
                venue="NAACL",
                source="acl",
            )
        )

        # 1. Verify use_external_apis=False disables all external clients so misses never touch WAN
        created_orchs: list[object] = []
        orig_orch = mod.RetrievalOrchestrator

        class _SpyOrch(orig_orch):
            def __init__(self, *args: object, **kwargs: object) -> None:
                super().__init__(*args, **kwargs)
                created_orchs.append(self)

        miss_case = mod.TestCase(
            paper_id=999,
            doi=None,
            title="Nonexistent Completely Unrelated Quantum Paper ZZZ",
            authors='["Jane Roe"]',
            year=2024,
            venue="ACL",
            has_doi=False,
        )
        with patch.object(mod, "RetrievalOrchestrator", _SpyOrch):
            _, miss_metrics = await mod.run_retrieval_test(
                [miss_case], db_path=str(db_path), use_external_apis=False
            )
        assert len(created_orchs) == 1
        assert created_orchs[0].clients() == []  # type: ignore[attr-defined]
        assert miss_metrics.false_negatives == 1

        # 2. Wrong top candidate must increment false_positives (< 100% precision)
        #    and 0.85..0.95 similarity must go to partial_matches (not title_matches)
        tp_exact = mod.TestCase(
            paper_id=1,
            doi="10.18653/v1/N19-1423",
            title="BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding",
            authors='["Jacob Devlin"]',
            year=2019,
            venue="NAACL",
        )
        tp_partial = mod.TestCase(
            paper_id=2,
            doi=None,
            title="Neural Machine Translation of Rare Words with Subword Units",
            authors='["Rico Sennrich"]',
            year=2016,
            venue="ACL",
            has_doi=False,
        )
        fp_wrong = mod.TestCase(
            paper_id=3,
            doi=None,
            title="Attention Is All You Need",
            authors='["Ashish Vaswani"]',
            year=2017,
            venue="ACL",
            has_doi=False,
        )

        class _ControlledOrch:
            def __init__(self, **_kwargs: object) -> None:
                pass

            async def retrieve(self, citation: object) -> SourceResult:
                t = getattr(citation, "title", "") or ""
                if "BERT" in t:
                    return SourceResult(
                        citation_raw=t,
                        candidates=[
                            SourceCandidate(
                                source_name="local_db",
                                found=True,
                                doi="10.18653/v1/N19-1423",
                                title=t,
                                confidence=0.99,
                            )
                        ],
                    )
                if "Neural Machine Translation" in t:
                    # ~0.88-0.91 similarity -> partial_matches (85-95%), NOT high_title_sim (>=95%)
                    return SourceResult(
                        citation_raw=t,
                        candidates=[
                            SourceCandidate(
                                source_name="local_db",
                                found=True,
                                title="Neural Machine Translation of Rare Words with Subword",
                                confidence=0.88,
                            )
                        ],
                    )
                # Wrong top candidate returned!
                return SourceResult(
                    citation_raw=t,
                    candidates=[
                        SourceCandidate(
                            source_name="local_db",
                            found=True,
                            title="Agricultural Soil Chemistry in Rice Paddies",
                            confidence=0.65,
                        )
                    ],
                )

        with patch.object(mod, "RetrievalOrchestrator", _ControlledOrch):
            _, metrics = await mod.run_retrieval_test(
                [tp_exact, tp_partial, fp_wrong],
                db_path=str(db_path),
                use_external_apis=False,
            )

        assert metrics.true_positives == 2
        assert metrics.false_positives == 1
        assert metrics.precision == pytest.approx(2 / 3)
        assert metrics.exact_matches == 1
        assert metrics.partial_matches == 1
        assert metrics.title_matches == 0

        # 3. Empty DB must not crash print_report with ZeroDivisionError
        mod.print_report(mod.EvaluationMetrics(total_cases=0), [], 0.01)

        # 4. Top-1 wrong + Rank-2 exact match MUST count as 1 FP + 1 FN (never TP+FP > total_cases!)
        #    and whitespace-only authors must not raise IndexError.
        rank2_case = mod.TestCase(
            paper_id=4,
            doi="10.18653/v1/N19-1423",
            title="BERT: Pre-training of Deep Bidirectional Transformers",
            authors='["   "]',
            year=2019,
            venue="NAACL",
            citation_type="partial",
        )
        cit_ws = mod.create_citation_from_paper(rank2_case)
        assert "Unknown et al." in cit_ws.raw_text

        class _Rank2Orch:
            def __init__(self, **_kw: object) -> None:
                pass

            async def retrieve(self, _cit: object, **_kw: object) -> SourceResult:
                return SourceResult(
                    citation_raw="test",
                    candidates=[
                        SourceCandidate(
                            source_name="local_db",
                            found=True,
                            title="Completely Unrelated Agronomy Paper",
                            confidence=0.90,
                        ),
                        SourceCandidate(
                            source_name="local_db",
                            found=True,
                            doi="10.18653/v1/N19-1423",
                            title="BERT: Pre-training of Deep Bidirectional Transformers",
                            confidence=0.85,
                        ),
                    ],
                )

        with patch.object(mod, "RetrievalOrchestrator", _Rank2Orch):
            r2_cases, r2_metrics = await mod.run_retrieval_test(
                [rank2_case], db_path=str(db_path), use_external_apis=False
            )
        assert r2_metrics.total_cases == 1
        assert r2_metrics.true_positives == 0
        assert r2_metrics.false_positives == 1
        assert r2_metrics.false_negatives == 1
        assert r2_metrics.true_positives + r2_metrics.false_positives <= r2_metrics.total_cases
        out_json = tmp_path / "r2_out.json"
        mod.save_results(r2_cases, r2_metrics, str(out_json))
        saved_payload = json.loads(out_json.read_text(encoding="utf-8"))
        assert saved_payload["cases"][0]["false_positive"] is True

    def test_load_acl_papers_is_deterministic_with_seed(self, tmp_path: Path) -> None:
        mod = _load_script("qa05_acl_seed", "scripts/test_acl_retrieval_accuracy.py")
        db_path = tmp_path / "seed_test.db"
        db = LocalDatabase(db_path)
        for i in range(10):
            db.add_paper(
                Paper(
                    doi=f"10.18653/v1/P20-{1000 + i}",
                    title=f"ACL Deterministic Paper Number {i}",
                    authors=[f"Author {i}"],
                    year=2020,
                    venue="ACL",
                    source="acl",
                )
            )
        sample_a = [p.title for p in mod.load_acl_papers(str(db_path), limit=4, seed=123)]
        sample_b = [p.title for p in mod.load_acl_papers(str(db_path), limit=4, seed=123)]
        assert len(sample_a) == 4
        assert sample_a == sample_b


# ============================================================================
# QA-06: Data Integrity & Resilience in DB/Maintenance Scripts
# ============================================================================


class TestQA06MaintenanceScriptsReliability:
    """Verify populate_venues, import_s2orc, import_openalex, and backfill_citation_confidence."""

    def test_populate_venues_word_boundaries_and_no_blanket_source_overwrite(self) -> None:
        mod = _load_script("qa06_venues", "scripts/populate_venues.py")
        # False-positive substrings, homographs, hyphenated affixes & blanket source overwrites must return None
        for non_nlp_title, src in (
            ("Robert Frost and Modern American Poetry", "known_papers"),
            ("On Gradient Clipping in Deep Networks", "openalex"),
            ("Sustainable Palm Oil Supply Chains", "crossref"),
            ("Superglue Adhesive Bonding Strength", "serpapi"),
            ("Roberta Flack and the Evolution of Soul Music", "openalex"),
            ("Cochlear Mechanics in the Chinchilla Ear", "openalex"),
            ("Population Dynamics of Wild Vicuna in the Peruvian Andes", "openalex"),
            ("Sophocles Electra and Feminist Classical Reception", "openalex"),
            ("HITS-CLIP reveals functional miRNA-mRNA interaction maps", "openalex"),
            ("TITANIUM CLIP CLOSURE IN LAPAROSCOPIC SURGERY", "crossref"),
        ):
            assert mod._infer_venue(non_nlp_title, src) is None, f"False positive on {non_nlp_title!r}"

        # Genuine canonical NLP/ML titles (including Sentence-BERT before BERT) infer accurately
        assert (
            mod._infer_venue(
                "Sentence-BERT: Sentence Embeddings using Siamese BERT-Networks", "known_papers"
            )
            == "EMNLP"
        )
        assert (
            mod._infer_venue(
                "BERT: Pre-training of Deep Bidirectional Transformers", "known_papers"
            )
            == "NAACL"
        )
        assert (
            mod._infer_venue(
                "RoBERTa: A Robustly Optimized BERT Pretraining Approach", "known_papers"
            )
            == "EMNLP"
        )
        assert (
            mod._infer_venue(
                "ELECTRA: Pre-training Text Encoders as Discriminators Rather Than Generators",
                "known_papers",
            )
            == "ICLR"
        )
        assert (
            mod._infer_venue(
                "Learning Transferable Visual Models From Natural Language Supervision",
                "known_papers",
            )
            == "ICML"
        )
        assert mod._infer_venue("Attention Is All You Need", "known_papers") == "NeurIPS"

    def test_import_s2orc_handles_bad_json_categories_and_cross_file_limit(
        self, tmp_path: Path
    ) -> None:
        mod = _load_script("qa06_s2orc", "scripts/import_s2orc.py")
        f1 = tmp_path / "part1.jsonl"
        f2 = tmp_path / "part2.jsonl"

        f1.write_text(
            "\n".join(
                [
                    "{malformed json line",
                    json.dumps(
                        {
                            "paper_id": "p_bio",
                            "title": "Pure Biology Paper Outside Requested Categories",
                            "authors": [{"name": "Bio Author"}],
                            "year": 2021,
                            "arxiv_categories": ["q-bio.BM"],
                        }
                    ),
                    json.dumps(
                        {
                            "paper_id": "p_cl_1",
                            "title": "First NLP Paper in Requested Category",
                            "authors": [{"name": "NLP One"}],
                            "year": 2021,
                            "arxiv_categories": ["cs.CL"],
                        }
                    ),
                    json.dumps(
                        {
                            "paper_id": "p_cl_2",
                            "title": "Second NLP Paper in Requested Category",
                            "authors": [{"name": "NLP Two"}],
                            "year": 2022,
                            "arxiv_categories": ["cs.CL"],
                        }
                    ),
                ]
            ),
            encoding="utf-8",
        )
        f2.write_text(
            json.dumps(
                {
                    "paper_id": "p_cl_3",
                    "title": "Third NLP Paper in Second File",
                    "authors": [{"name": "NLP Three"}],
                    "year": 2023,
                    "arxiv_categories": ["cs.CL"],
                }
            )
            + "\n",
            encoding="utf-8",
        )

        db_path = tmp_path / "s2orc.db"
        with patch.object(
            sys,
            "argv",
            [
                "import_s2orc.py",
                "--s2orc-path",
                str(tmp_path),
                "--db-path",
                str(db_path),
                "--categories",
                "cs.CL",
                "--limit",
                "2",
            ],
        ):
            mod.main()

        db = LocalDatabase(db_path)
        all_papers = db.get_all_papers(limit=10)
        titles = {p.title for p in all_papers}
        assert len(all_papers) == 2
        assert "Pure Biology Paper Outside Requested Categories" not in titles

    def test_import_openalex_caps_consecutive_request_errors(self, tmp_path: Path) -> None:
        mod = _load_script("qa06_openalex", "scripts/import_openalex.py")
        db_path = tmp_path / "oa_err.db"
        call_count = 0

        def _always_fail(*_args: object, **_kwargs: object) -> object:
            nonlocal call_count
            call_count += 1
            if call_count > 20:
                raise RuntimeError("Infinite retry loop detected (>20 consecutive errors)")
            raise requests.exceptions.ConnectionError("Simulated network outage")

        with (
            patch.object(mod, "search_papers_cursor", side_effect=_always_fail),
            patch.object(mod.time, "sleep", lambda _s: None),
            patch.object(
                sys,
                "argv",
                ["import_openalex.py", "--db", str(db_path), "--limit", "50"],
            ),
            pytest.raises(SystemExit) as exc_info,
        ):
            mod.main()

        assert exc_info.value.code != 0
        assert 1 <= call_count <= 10

    def test_backfill_citation_confidence_tracks_inline_doi_venue_and_closes_session(
        self, tmp_path: Path
    ) -> None:
        from sqlalchemy import create_engine, text
        from sqlalchemy.orm import sessionmaker

        from integrity_checker.db.models import Base, CitationRecord, EssayRecord
        from integrity_checker.extraction.reference_parser import _estimate_reference_confidence
        from integrity_checker.models.citation import Citation

        mod = _load_script("qa06_backfill", "scripts/backfill_citation_confidence.py")
        db_file = tmp_path / "backfill.db"
        engine = create_engine(f"sqlite:///{db_file}")
        try:
            Base.metadata.create_all(bind=engine)
            factory = sessionmaker(bind=engine)

            # Construct a reference row AND an inline row where pre-existing confidence
            # ALREADY equals the post-resolution confidence, so ONLY doi/venue/title changed!
            resolved_cit = Citation(
                raw_text="",
                title="Neural Machine Translation of Rare Words",
                authors=["Rico Sennrich"],
                year="2016",
                doi="10.18653/v1/P16-1162",
                venue="ACL",
            )
            exact_conf = _estimate_reference_confidence(resolved_cit)

            with factory() as seed:
                seed.add(EssayRecord(id=1, filename="t.pdf", num_pages=3))
                seed.flush()
                seed.add_all(
                    [
                        CitationRecord(
                            id=1,
                            essay_id=1,
                            raw_text="Sennrich, R. (2016). Neural Machine Translation of Rare Words. ACL.",
                            citation_type="reference_list",
                            authors='["Rico Sennrich"]',
                            year="2016",
                            title="Neural Machine Translation of Rare Words",
                            doi="10.18653/v1/P16-1162",
                            venue="ACL",
                            confidence=exact_conf,
                        ),
                        CitationRecord(
                            id=2,
                            essay_id=1,
                            raw_text="Sennrich et al. (2016)",
                            citation_type="author_year",
                            authors='["Rico Sennrich"]',
                            year="2016",
                            title=None,
                            doi=None,
                            venue=None,
                            confidence=exact_conf,
                        ),
                    ]
                )
                seed.commit()

            closed_flag = {"closed": False}

            def _tracked_get_session():
                raw_sess = factory()
                orig_close = raw_sess.close

                def _close_wrapper() -> None:
                    closed_flag["closed"] = True
                    orig_close()

                raw_sess.close = _close_wrapper  # type: ignore[method-assign]
                return raw_sess

            with (
                patch.object(mod, "get_session", _tracked_get_session),
                patch.object(sys, "argv", ["backfill_citation_confidence.py", "--apply"]),
            ):
                rc = mod.main()

            assert rc == 0
            assert closed_flag["closed"] is True

            with factory() as check_sess:
                row = check_sess.execute(
                    text("SELECT doi, venue, title FROM citations WHERE id = 2")
                ).one()
                assert row[0] == "10.18653/v1/P16-1162"
                assert row[1] == "ACL"
                assert row[2] == "Neural Machine Translation of Rare Words"
        finally:
            engine.dispose()


# ============================================================================
# QA-07: scripts/bump_version.py Lockfile Sync, Date Validation & Dirty Guard
# ============================================================================


class TestQA07BumpVersionSafety:
    """Verify bump_version.py updates package-lock.json, validates --date, and guards unstaged edits."""

    def test_update_all_version_files_syncs_package_lock_and_validates_iso_date(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        mod = _load_script("qa07_bump", "scripts/bump_version.py")

        # Redirect file constants into tmp_path sandbox
        (tmp_path / "web" / "src").mkdir(parents=True)
        v_ts = tmp_path / "web" / "src" / "version.ts"
        v_ts.write_text(
            "export const APP_VERSION = '3.89.5';\nexport const APP_BUILD_DATE = '2026-11-20';\n",
            encoding="utf-8",
        )
        w_pkg = tmp_path / "web" / "package.json"
        w_pkg.write_text('{\n  "version": "3.89.5"\n}\n', encoding="utf-8")
        w_lock = tmp_path / "web" / "package-lock.json"
        w_lock.write_text(
            json.dumps(
                {
                    "name": "essay-integrity-checker-web",
                    "version": "3.82.4",
                    "lockfileVersion": 3,
                    "packages": {"": {"name": "essay-integrity-checker-web", "version": "3.82.4"}},
                },
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )
        r_pkg = tmp_path / "package.json"
        r_pkg.write_text('{\n  "version": "3.89.5"\n}\n', encoding="utf-8")
        pyproj = tmp_path / "pyproject.toml"
        pyproj.write_text('[project]\nversion = "3.89.5"\n', encoding="utf-8")
        py_ver = tmp_path / "version.py"
        py_ver.write_text('__version__ = "3.89.5"\n', encoding="utf-8")

        monkeypatch.setattr(mod, "WEB_VERSION_TS", v_ts)
        monkeypatch.setattr(mod, "WEB_PACKAGE_JSON", w_pkg)
        monkeypatch.setattr(mod, "WEB_PACKAGE_LOCK_JSON", w_lock, raising=False)
        monkeypatch.setattr(mod, "ROOT_PACKAGE_JSON", r_pkg)
        monkeypatch.setattr(mod, "PYPROJECT_TOML", pyproj)
        monkeypatch.setattr(mod, "PY_VERSION_FILE", py_ver)
        monkeypatch.setattr(mod, "README_MD", tmp_path / "README.md")
        claude_md = tmp_path / "CLAUDE.md"
        claude_md.write_text(
            "- **Version:** v3.89.5 (15+ Scholarly & Technical APIs — 2026-11-20)\n",
            encoding="utf-8",
        )
        monkeypatch.setattr(mod, "CLAUDE_MD", claude_md)
        monkeypatch.setattr(mod, "BENCHMARK_REPORT_MD", tmp_path / "BENCHMARK.md")

        # Invalid ISO date must raise ValueError before writing
        with pytest.raises(ValueError):
            mod.update_all_version_files("3.90.0", "2026-99-99")

        mod.update_all_version_files("3.90.0", "2026-11-21")
        updated_lock = json.loads(w_lock.read_text(encoding="utf-8"))
        assert updated_lock["version"] == "3.90.0"
        assert updated_lock["packages"][""]["version"] == "3.90.0"
        updated_claude = claude_md.read_text(encoding="utf-8")
        assert "v3.90.0" in updated_claude and "2026-11-21)" in updated_claude

    def test_post_commit_aborts_when_version_files_have_unstaged_edits_or_any_staged_index_files(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        mod = _load_script("qa07_bump_hook", "scripts/bump_version.py")
        monkeypatch.delenv("CITRA_SKIP_VERSION_BUMP", raising=False)
        monkeypatch.setattr(mod, "_version_already_changed_in_head", lambda: False)

        # Case A: Non-version file staged in index (`git add src/wip.py` during partial `git commit src/fix.py`)
        def _fake_git_staged_non_version(*args: str) -> str:
            if args[:2] == ("rev-parse", "--git-dir"):
                return ".git"
            if args[:2] == ("log", "-1"):
                return "fix: surgical patch"
            if args[:3] == ("diff", "--cached", "--name-only") and len(args) == 3:
                return "src/wip.py"
            return ""

        wrote_files = {"called": False}
        monkeypatch.setattr(mod, "_git_output", _fake_git_staged_non_version)
        monkeypatch.setattr(
            mod,
            "update_all_version_files",
            lambda *_a, **_kw: wrote_files.__setitem__("called", True),
        )
        assert mod.handle_post_commit() == 0
        assert wrote_files["called"] is False


# ============================================================================
# QA-12: Script Portability & Non-Vacuous CLI Behavior
# ============================================================================


class TestQA12ScriptPortabilityAndCliUx:
    """Verify zero hardcoded /Users/iannwendy paths and honest CLI exit codes."""

    def test_zero_hardcoded_author_paths_across_owned_scripts(self) -> None:
        for script_file in sorted((REPO_ROOT / "scripts").rglob("*.py")):
            src = script_file.read_text(encoding="utf-8")
            assert "/Users/iannwendy" not in src, (
                f"Hardcoded machine path in {script_file.relative_to(REPO_ROOT)}"
            )

        corpora_mod = _load_script(
            "qa12_corpora", "scripts/collect_dataset/collect_style_corpora.py"
        )
        with patch.object(sys, "argv", ["collect_style_corpora.py"]):
            parsed = corpora_mod.parse_args()
        assert Path(parsed.output).resolve() == (REPO_ROOT / "style_corpora").resolve()

    def test_build_local_db_exits_nonzero_on_missing_acl_dir_and_wires_acl_bibtex(
        self, tmp_path: Path
    ) -> None:
        mod = _load_script("qa12_build_db", "scripts/build_local_db.py")
        missing_xml = tmp_path / "nonexistent_acl_xml"
        db_path = tmp_path / "local.db"

        with (
            patch.object(
                sys,
                "argv",
                [
                    "build_local_db.py",
                    "--db-path",
                    str(db_path),
                    "--acl-data-dir",
                    str(missing_xml),
                ],
            ),
            pytest.raises(SystemExit) as exc_info,
        ):
            mod.main()
        assert exc_info.value.code != 0

        # --acl-bibtex invokes build_acl_database()
        called_bibtex = {"count": 0}
        with (
            patch.object(
                mod,
                "build_acl_database",
                side_effect=lambda *_a, **_kw: called_bibtex.__setitem__("count", 1) or 5,
            ),
            patch.object(
                sys,
                "argv",
                ["build_local_db.py", "--db-path", str(db_path), "--acl-bibtex"],
            ),
        ):
            mod.main()
        assert called_bibtex["count"] == 1

        # Directory --s2orc-path and --limit 0 work without IsADirectoryError
        s2_dir = tmp_path / "s2_dir"
        s2_dir.mkdir()
        (s2_dir / "shard1.jsonl").write_text(
            json.dumps(
                {
                    "paper_id": "s2_dir_1",
                    "title": "Directory Imported S2ORC Paper",
                    "authors": [{"name": "Ada Lovelace"}],
                    "year": 2022,
                    "arxiv_categories": ["cs.LG"],
                }
            )
            + "\n",
            encoding="utf-8",
        )
        assert mod.build_s2orc_database(db_path, s2_dir, limit=0) == 0
        assert mod.build_s2orc_database(db_path, s2_dir, limit=5) == 1

    def test_sync_from_api_requires_action_flag_and_disambiguates_bibtex_keys(
        self, tmp_path: Path
    ) -> None:
        mod = _load_script("qa12_sync_api", "scripts/sync_from_api.py")

        # Running with zero action flags must exit non-zero instead of silently doing nothing
        proc = subprocess.run(
            [sys.executable, str(REPO_ROOT / "scripts" / "sync_from_api.py")],
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
            check=False,
        )
        assert proc.returncode != 0

        # Duplicate Author+Year entries (>26 collisions), "2020a" year, and whitespace-only author
        db_path = tmp_path / "bib_dedup.db"
        db = LocalDatabase(db_path)
        cand_2020a = SourceCandidate(
            source_name="openalex",
            found=True,
            doi="10.1000/year-2020a",
            title="Suffixed Year Candidate",
            authors=["   "],
            year="2020a",
            venue="ACL",
        )
        assert mod.sync_paper_to_db(db, cand_2020a, source="openalex") is True

        for idx in range(28):
            db.add_paper(
                Paper(
                    doi=f"10.1000/smith2020-{idx}",
                    title=f"Smith 2020 Paper #{idx}",
                    authors=["John Smith"],
                    year=2020,
                    venue="ACL",
                    source="acl",
                )
            )
        out_bib = tmp_path / "exported.bib"
        count = mod.export_to_bibtex(db, out_bib, limit=50)
        assert count == 29
        bib_text = out_bib.read_text(encoding="utf-8")
        cite_keys = re.findall(r"@article\{([^,]+),", bib_text)
        assert len(cite_keys) == 29
        assert len(set(cite_keys)) == 29
        assert "Smith2020aa" in cite_keys
        assert "Smith2020_27" not in cite_keys
        assert "Unknown2020" in cite_keys
