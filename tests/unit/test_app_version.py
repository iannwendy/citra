"""Version single-source-of-truth tests (task 0.5).

`/api/health` and the FastAPI app metadata must report
`integrity_checker.__version__` rather than a stale hardcoded `app.version`
from YAML configs. `APP_VERSION` env is the only sanctioned override.
"""

from __future__ import annotations

from pathlib import Path

import pytest
import yaml
from fastapi.testclient import TestClient

from integrity_checker import __version__
from integrity_checker.config import AppConfig, Settings, get_settings, resolve_app_version

REPO_ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture
def fresh_settings():
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def test_settings_version_matches_package_version(fresh_settings, monkeypatch):
    monkeypatch.delenv("APP_VERSION", raising=False)
    assert get_settings().app.version == __version__


def test_app_config_default_is_package_version():
    assert AppConfig().version == __version__


def test_stale_yaml_version_is_ignored(monkeypatch):
    monkeypatch.delenv("APP_VERSION", raising=False)
    s = Settings(app={"name": "X", "version": "0.2.0"})
    assert s.app.version == __version__
    assert s.app.version != "0.2.0"


def test_app_version_env_override(monkeypatch):
    monkeypatch.setenv("APP_VERSION", "9.9.9-rc1")
    assert resolve_app_version() == "9.9.9-rc1"
    s = Settings(app={"version": "0.2.0"})
    assert s.app.version == "9.9.9-rc1"


def test_blank_app_version_env_falls_back_to_package(monkeypatch):
    monkeypatch.setenv("APP_VERSION", "   ")
    assert resolve_app_version() == __version__


def test_health_endpoint_reports_package_version(fresh_settings, monkeypatch):
    monkeypatch.delenv("APP_VERSION", raising=False)
    from integrity_checker.api.main import app

    resp = TestClient(app).get("/api/health")
    assert resp.status_code == 200
    assert resp.json()["version"] == __version__


def test_fastapi_app_metadata_reports_package_version(fresh_settings, monkeypatch):
    monkeypatch.delenv("APP_VERSION", raising=False)
    from integrity_checker.api.main import create_app

    app = create_app()
    assert app.version == __version__


@pytest.mark.parametrize(
    "cfg", ["configs/config.yaml", "configs/config.example.yaml", "configs/config.docker.yaml"]
)
def test_configs_do_not_hardcode_app_version(cfg):
    path = REPO_ROOT / cfg
    if not path.exists():
        pytest.skip(f"{cfg} not present")
    data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    assert "version" not in (data.get("app") or {}), f"{cfg} still hardcodes app.version"
