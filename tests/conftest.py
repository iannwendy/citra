"""Test fixtures and deterministic test-environment isolation."""

from __future__ import annotations

import atexit
import os
import shutil
import tempfile
import weakref
from pathlib import Path
from types import SimpleNamespace

import dotenv
import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.engine import Connection, Engine
from sqlalchemy.orm import close_all_sessions, sessionmaker

_TRACKED_TEST_ENGINES: list[weakref.ReferenceType[Engine]] = []


@event.listens_for(Engine, "engine_connect")
def _track_test_engine_connect(conn: Connection) -> None:
    _TRACKED_TEST_ENGINES.append(weakref.ref(conn.engine))

TEST_DATA_DIR = Path(__file__).parent / "fixtures"
TEST_DB_URL = "sqlite:///:memory:"
REPO_ROOT = Path(__file__).resolve().parent.parent
REPO_GROBID_CACHE_DIR = (REPO_ROOT / "data" / "cache" / "grobid").resolve()

_LIVE_SECRET_ENV_VARS: tuple[str, ...] = (
    "SERPAPI_API_KEY",
    "SERPER_API_KEY",
    "OPENALEX_API_KEY",
    "STRIPE_SECRET_KEY",
)

_PROTECTED_TEST_ENV_VARS: frozenset[str] = frozenset(
    {
        "APP_ENV",
        "APP_DEBUG",
        "APP_LOG_LEVEL",
        "DATABASE_URL",
        "DATA_DIR",
        "CACHE_DIR",
        "AVATARS_DIR",
        "ESSAYS_DIR",
        "GROBID_OUTPUT_DIR",
    }
)

# Snapshot & strip live secrets at import time BEFORE any module-level `create_app()`
# or `get_settings()` runs during pytest collection, and neutralize `dotenv.load_dotenv`
# so `.env` never mutates process-wide `os.environ` outside `monkeypatch`.
_BOOT_AMBIENT_SECRETS: dict[str, str] = {
    k: os.environ.pop(k) for k in _LIVE_SECRET_ENV_VARS if k in os.environ
}
dotenv.load_dotenv = lambda *_a, **_kw: False  # type: ignore[assignment]

# Boot-time isolated directories so module-level `create_app()` calls during
# pytest collection never write to repository `./data/logs` or `./data/cache`.
_BOOT_TMP_DIR = Path(tempfile.mkdtemp(prefix="citra_pytest_boot_"))
atexit.register(shutil.rmtree, _BOOT_TMP_DIR, ignore_errors=True)

os.environ["APP_ENV"] = "test"
os.environ["APP_DEBUG"] = "false"
os.environ["APP_LOG_LEVEL"] = "WARNING"
os.environ["DATABASE_URL"] = TEST_DB_URL
os.environ["DATA_DIR"] = str(_BOOT_TMP_DIR / "data")
os.environ["CACHE_DIR"] = str(_BOOT_TMP_DIR / "cache")
os.environ["AVATARS_DIR"] = str(_BOOT_TMP_DIR / "avatars")

from integrity_checker.config import (  # noqa: E402 - env vars must be set first
    Settings,
    get_settings,
)

get_settings.cache_clear()


def make_stopped_grobid_manager_stub() -> SimpleNamespace:
    """Return a lightweight GROBID manager stub that avoids host Docker socket probes."""
    from integrity_checker.extraction import GROBID_STATUS

    return SimpleNamespace(
        check_health=lambda: GROBID_STATUS.STOPPED,
        is_container_running=lambda: False,
        get_stats=lambda: {},
        stats=SimpleNamespace(container_id=None),
    )


def _reset_runtime_singletons() -> None:
    """Dispose SQLite engines and clear in-memory singletons/rate-limiters across tests."""
    import sys

    from integrity_checker.database.local_db import (
        _atexit_close_all_local_db_pools,
        clear_local_query_cache,
    )
    from integrity_checker.db import session as db_session
    from integrity_checker.retrieval.circuit_breaker import reset_circuit_breaker_registry
    from integrity_checker.retrieval.serpapi_client import SerpApiClient

    get_settings.cache_clear()
    reset_circuit_breaker_registry()
    SerpApiClient.reset_circuit_breakers()
    clear_local_query_cache()
    _atexit_close_all_local_db_pools()

    deps_mod = sys.modules.get("integrity_checker.api.deps")
    if deps_mod is not None and hasattr(deps_mod, "reset_pipeline"):
        deps_mod.reset_pipeline()

    main_mod = sys.modules.get("integrity_checker.api.main")
    if main_mod is not None:
        app_inst = getattr(main_mod, "_app_instance", None)
        if app_inst is not None and hasattr(app_inst, "dependency_overrides"):
            app_inst.dependency_overrides.clear()

    health_mod = sys.modules.get("integrity_checker.api.routes.health")
    if health_mod is not None and hasattr(health_mod, "_invalidate_grobid_health_cache"):
        health_mod._invalidate_grobid_health_cache()

    grobid_service = sys.modules.get("integrity_checker.extraction.grobid_service")
    if grobid_service is not None:
        mgr = getattr(grobid_service, "_grobid_manager", None)
        if mgr is not None:
            docker_client = getattr(mgr, "_client", None)
            if docker_client is not None and hasattr(docker_client, "close"):
                try:
                    docker_client.close()
                except Exception:
                    pass
        if hasattr(grobid_service, "reset_grobid_manager"):
            grobid_service.reset_grobid_manager()

    for mod_name, attr_names in (
        (
            "integrity_checker.api.routes.auth",
            (
                "_login_rate_limiter",
                "_login_ip_rate_limiter",
                "_register_rate_limiter",
                "_resend_activation_rate_limiter",
                "_forgot_password_rate_limiter",
                "_email_change_rate_limiter",
            ),
        ),
        (
            "integrity_checker.api.routes.users",
            (
                "_email_change_rate_limiter",
                "_email_change_cooldowns",
            ),
        ),
        (
            "integrity_checker.api.routes.essays",
            (
                "_sandbox_verify_rate_buckets",
                "_sandbox_pdf_rate_buckets",
                "_sandbox_pdf_rate_limiter",
            ),
        ),
    ):
        mod_obj = sys.modules.get(mod_name)
        if mod_obj is None:
            continue
        for attr_name in attr_names:
            obj = getattr(mod_obj, attr_name, None)
            if obj is None:
                continue
            if hasattr(obj, "clear_all"):
                obj.clear_all()
            elif isinstance(obj, dict):
                obj.clear()
            if hasattr(obj, "enforce_in_tests"):
                obj.enforce_in_tests = False

    try:
        close_all_sessions()
    except Exception:
        pass
    engine_refs = list(_TRACKED_TEST_ENGINES)
    _TRACKED_TEST_ENGINES.clear()
    for eng_ref in engine_refs:
        eng = eng_ref()
        if eng is not None:
            try:
                eng.dispose()
            except Exception:
                pass
    if db_session._engine is not None:
        db_session._engine.dispose()
    db_session._engine = None
    db_session._engine_url = None
    db_session._SessionLocal = None


def _install_readonly_grobid_cache_fallback(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    """Allow isolated default GROBID cache lookups to fall back read-only to pre-cached
    `data/cache/grobid/*.tei.xml` without writing to or deleting from `./data/`.
    """
    from integrity_checker.extraction.grobid_service import GrobidServiceManager

    orig_get_from_cache = GrobidServiceManager.get_from_cache
    orig_invalidate_cache = GrobidServiceManager.invalidate_cache
    isolated_grobid_dir = (tmp_path / "cache" / "grobid").resolve()
    invalidated_all = False
    invalidated_names: set[str] = set()

    def _isolated_get_from_cache(self: GrobidServiceManager, pdf_path: str) -> str | None:
        res = orig_get_from_cache(self, pdf_path)
        if res is not None or not self.config.cache_by_file_sha256 or invalidated_all:
            return res
        cache_path = self.get_cache_path(pdf_path)
        if cache_path.parent.resolve() != isolated_grobid_dir:
            return None
        if cache_path.name in invalidated_names:
            return None
        fallback_file = REPO_GROBID_CACHE_DIR / cache_path.name
        if fallback_file.is_file():
            try:
                content = fallback_file.read_text(encoding="utf-8")
            except Exception:
                return None
            lock = getattr(self, "_stats_lock", None)
            if lock is not None:
                with lock:
                    self.stats.cache_misses = max(0, self.stats.cache_misses - 1)
                    self.stats.cache_hits += 1
            else:
                self.stats.cache_misses = max(0, self.stats.cache_misses - 1)
                self.stats.cache_hits += 1
            return content
        return None

    def _isolated_invalidate_cache(
        self: GrobidServiceManager, pdf_path: str | None = None
    ) -> int:
        nonlocal invalidated_all
        removed = orig_invalidate_cache(self, pdf_path)
        settings = get_settings()
        if settings.paths.grobid_output_dir.resolve() == isolated_grobid_dir:
            if pdf_path:
                cache_path = self.get_cache_path(pdf_path)
                was_active_fallback = (
                    not invalidated_all
                    and cache_path.name not in invalidated_names
                    and (REPO_GROBID_CACHE_DIR / cache_path.name).is_file()
                )
                invalidated_names.add(cache_path.name)
                if removed == 0 and was_active_fallback:
                    removed = 1
            else:
                invalidated_all = True
        return removed

    monkeypatch.setattr(GrobidServiceManager, "get_from_cache", _isolated_get_from_cache)
    monkeypatch.setattr(GrobidServiceManager, "invalidate_cache", _isolated_invalidate_cache)


@pytest.fixture(autouse=True)
def set_test_env(
    request: pytest.FixtureRequest,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
):
    """Set test-env defaults, isolate filesystem/DB state, and scope live API keys."""
    from loguru import logger as _loguru

    monkeypatch.setenv("APP_ENV", "test")
    monkeypatch.setenv("APP_DEBUG", "false")
    monkeypatch.setenv("APP_LOG_LEVEL", "WARNING")
    monkeypatch.setenv("DATABASE_URL", TEST_DB_URL)
    monkeypatch.setenv("DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("CACHE_DIR", str(tmp_path / "cache"))
    monkeypatch.setenv("AVATARS_DIR", str(tmp_path / "avatars"))
    monkeypatch.setattr("dotenv.load_dotenv", lambda *_a, **_kw: False)
    monkeypatch.setitem(Settings.model_config, "env_file", None)

    if request.node.get_closest_marker("integration") is None:
        for env_key in _LIVE_SECRET_ENV_VARS:
            monkeypatch.delenv(env_key, raising=False)
    else:
        for env_key, env_val in _BOOT_AMBIENT_SECRETS.items():
            monkeypatch.setenv(env_key, env_val)
        dotenv_file = REPO_ROOT / ".env"
        if dotenv_file.is_file():
            for k, v in dotenv.dotenv_values(dotenv_file).items():
                if (
                    k
                    and v is not None
                    and k not in _PROTECTED_TEST_ENV_VARS
                    and k not in os.environ
                ):
                    monkeypatch.setenv(k, v)

    _install_readonly_grobid_cache_fallback(monkeypatch, tmp_path)
    _reset_runtime_singletons()
    try:
        yield
    finally:
        _reset_runtime_singletons()
        # Close any loguru file sinks opened inside tmp_path during create_app()
        _loguru.remove()


@pytest.fixture
def test_engine():
    """In-memory SQLite engine with deterministic connection disposal."""
    from integrity_checker.db.models import Base

    engine = create_engine(TEST_DB_URL, connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine)
    try:
        yield engine
    finally:
        Base.metadata.drop_all(bind=engine)
        engine.dispose()


@pytest.fixture
def test_session(test_engine):
    """Session bound to in-memory engine."""
    Session = sessionmaker(bind=test_engine)
    session = Session()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def sample_citation():
    """Citation for matching tests."""
    from integrity_checker.models.citation import Citation, CitationStyle, CitationType

    return Citation(
        raw_text="Vaswani, A., Shazeer, N., Parmar, N., et al. (2017). Attention is all you need. NeurIPS.",
        citation_type=CitationType.REFERENCE_LIST,
        style=CitationStyle.APA,
        authors=["Vaswani, A.", "Shazeer, N.", "Parmar, N."],
        year="2017",
        title="Attention is all you need",
        venue="NeurIPS",
    )
