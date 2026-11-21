"""Live integration tests for SerpApi Google Scholar fallback (requires real SERPAPI_API_KEY).

Excluded from default `pytest` runs via `-m 'not slow and not integration'`.
Run explicitly with:
    SERPAPI_API_KEY=<your-key> pytest -m integration tests/integration/test_serpapi_live.py -v
"""

from __future__ import annotations

import os

import pytest

from integrity_checker.config import get_settings
from integrity_checker.models.citation import Citation
from integrity_checker.retrieval.serpapi_client import SerpApiClient


@pytest.fixture(autouse=True)
def reset_serpapi_state():
    """Reset SerpApi circuit breakers before and after each live test."""
    SerpApiClient.reset_circuit_breakers()
    yield
    SerpApiClient.reset_circuit_breakers()


@pytest.fixture
def live_serpapi_key() -> str:
    """Resolve SERPAPI_API_KEY at test execution time without import-time leakage."""
    key = (os.environ.get("SERPAPI_API_KEY") or get_settings().serpapi_api_key or "").strip()
    if not key:
        pytest.skip("SERPAPI_API_KEY is not set — skipping live SerpApi integration test")
    return key


@pytest.mark.asyncio
@pytest.mark.integration
async def test_lookup_known_paper(live_serpapi_key: str) -> None:
    """Live lookup against SerpApi for a canonical paper (skips cleanly if monthly quota exhausted)."""
    client = SerpApiClient(api_key=live_serpapi_key)
    citation = Citation(
        raw_text="Vaswani et al. (2017)",
        title="Attention Is All You Need",
        authors=["Vaswani"],
        year="2017",
    )

    result = await client.lookup(citation)
    if SerpApiClient._quota_exhausted or "quota exhausted" in (result.error or "").lower():
        pytest.skip("Configured SERPAPI_API_KEY has exhausted its monthly search quota")

    assert result.found is True
    assert result.error is None
    assert result.title is not None
    assert "attention" in result.title.lower()
    assert result.confidence == 0.5
    assert len(result.authors) > 0


@pytest.mark.asyncio
@pytest.mark.integration
async def test_lookup_obscure_paper(live_serpapi_key: str) -> None:
    """Live lookup against SerpApi for a synthetic non-existent title."""
    client = SerpApiClient(api_key=live_serpapi_key)
    citation = Citation(
        raw_text="Smith (2021)",
        title="Novel Research Methods for Complex Systems Analysis XYZ123",
        authors=["Smith"],
        year="2021",
    )

    result = await client.lookup(citation)
    if SerpApiClient._quota_exhausted or "quota exhausted" in (result.error or "").lower():
        pytest.skip("Configured SERPAPI_API_KEY has exhausted its monthly search quota")

    assert result.source_name == "serpapi"
    if result.found:
        assert result.error is None
        assert result.title is not None
    else:
        assert result.error is not None
        assert "quota" not in result.error.lower()
