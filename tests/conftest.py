"""Test fixtures."""

from __future__ import annotations

import os
from pathlib import Path

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

TEST_DATA_DIR = Path(__file__).parent / "fixtures"
TEST_DB_URL = "sqlite:///:memory:"

# Set test environment variables at import time so module-level create_app()
# during pytest collection binds to the in-memory test DB instead of data/app.db.
os.environ["APP_ENV"] = "test"
os.environ["APP_DEBUG"] = "false"
os.environ["APP_LOG_LEVEL"] = "WARNING"
os.environ["DATABASE_URL"] = TEST_DB_URL

from integrity_checker.config import get_settings

get_settings.cache_clear()


@pytest.fixture(autouse=True)
def set_test_env(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    """Set test-env defaults and isolate DB/avatar paths from production data/."""
    monkeypatch.setenv("APP_ENV", "test")
    monkeypatch.setenv("APP_DEBUG", "false")
    monkeypatch.setenv("APP_LOG_LEVEL", "WARNING")
    monkeypatch.setenv("DATABASE_URL", TEST_DB_URL)
    monkeypatch.setenv("AVATARS_DIR", str(tmp_path / "avatars"))
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


@pytest.fixture
def test_engine():
    """In-memory SQLite engine."""
    from integrity_checker.db.models import Base

    engine = create_engine(TEST_DB_URL, connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine)
    yield engine
    Base.metadata.drop_all(bind=engine)


@pytest.fixture
def test_session(test_engine):
    """Session bound to in-memory engine."""
    Session = sessionmaker(bind=test_engine)
    session = Session()
    yield session
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
