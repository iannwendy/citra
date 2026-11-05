"""Unit tests cho RetrievalOrchestrator.

Test các scenarios:
    - Happy path: Tier-1 active sources trả về results & consensus
    - Partial failure: Một số sources fail -> vẫn tiếp tục với kết quả hợp lệ
    - All fail: Escalation Tier 1 -> Tier 2 -> UNRESOLVED / Scholar Fallback
    - Cache hit / Cache miss / Source-scoped cache keys
    - Rate limiting: verify backoff works
    - arXiv DOI routing: skip Crossref, route sang arXiv + DBLP + OpenAlex
    - Tier-3 Google Scholar Fallback Router integration (Serper.dev primary -> SerpApi secondary)
"""

from __future__ import annotations

import time
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from integrity_checker.models.citation import Citation
from integrity_checker.models.source import SourceCandidate
from integrity_checker.retrieval.cache import DiskCache
from integrity_checker.retrieval.retrieval_orchestrator import RetrievalOrchestrator
from integrity_checker.retrieval.serpapi_client import (
    GoogleScholarFallbackClient,
    SerpApiClient,
)

# ---------- Helpers & Fixtures ----------


def _make_mock_client(
    name: str,
    *,
    found: bool = False,
    title: str | None = None,
    authors: list[str] | None = None,
    year: str | None = None,
    doi: str | None = None,
    abstract: str | None = None,
    confidence: float = 0.0,
    error: str | None = "No results",
) -> AsyncMock:
    client = AsyncMock()
    client.name = name
    client.lookup.return_value = SourceCandidate(
        source_name=name,
        found=found,
        title=title,
        authors=authors or [],
        year=year,
        doi=doi,
        abstract=abstract,
        confidence=confidence,
        error=None if found else error,
    )
    return client


@pytest.fixture
def mock_cache():
    """Mock DiskCache."""
    cache = MagicMock(spec=DiskCache)
    cache.get.return_value = None
    cache.set.return_value = None
    return cache


@pytest.fixture
def mock_citation():
    """Sample CS/AI citation for testing."""
    return Citation(
        raw_text="Smith, J. (2020). Deep Learning for Vision. CVPR 2020.",
        title="Deep Learning for Vision",
        year="2020",
        authors=[],
    )


@pytest.fixture
def mock_crossref_success():
    """Mock CrossrefClient returns success."""
    return _make_mock_client(
        "crossref",
        found=True,
        title="Deep Learning for Vision",
        authors=["Smith, J."],
        year="2020",
        doi="10.1109/CVPR.2020.00123",
        confidence=0.95,
    )


@pytest.fixture
def mock_openalex_success():
    """Mock OpenAlexClient returns success with abstract."""
    return _make_mock_client(
        "openalex",
        found=True,
        title="Deep Learning for Vision",
        authors=["Smith, J."],
        year="2020",
        abstract="We propose a deep learning architecture for computer vision tasks.",
        confidence=0.90,
    )


@pytest.fixture
def mock_dblp_success():
    """Mock DBLPClient returns success."""
    return _make_mock_client(
        "dblp",
        found=True,
        title="Deep Learning for Vision",
        authors=["Smith, J."],
        year="2020",
        confidence=0.88,
    )


@pytest.fixture
def mock_arxiv_empty():
    return _make_mock_client("arxiv", found=False, error="arXiv: no results")


@pytest.fixture
def mock_openlibrary_empty():
    return _make_mock_client("openlibrary", found=False, error="OpenLibrary: no results")


@pytest.fixture
def mock_europepmc_empty():
    return _make_mock_client("europepmc", found=False, error="EuropePMC: no results")


# ---------- Test: Happy Path ----------


class TestRetrievalOrchestratorHappyPath:
    """Test happy path: active Tier-1 sources return results."""

    @pytest.mark.asyncio
    async def test_happy_path_all_sources_succeed(
        self,
        mock_citation,
        mock_crossref_success,
        mock_openalex_success,
        mock_dblp_success,
        mock_arxiv_empty,
        mock_openlibrary_empty,
        mock_europepmc_empty,
        mock_cache,
    ):
        """All Tier-1 CS/AI sources (crossref, openalex, dblp) return found=True results."""
        orchestrator = RetrievalOrchestrator(
            crossref=mock_crossref_success,
            openalex=mock_openalex_success,
            dblp=mock_dblp_success,
            arxiv=mock_arxiv_empty,
            openlibrary=mock_openlibrary_empty,
            europepmc=mock_europepmc_empty,
            parallel=True,
            cache=mock_cache,
        )

        result = await orchestrator.retrieve(mock_citation)

        assert len(result.candidates) >= 1
        assert set(result.sources_queried) == {"crossref", "openalex", "dblp"}
        assert len(result.sources_succeeded) >= 2
        assert len(result.sources_failed) == 0

        mock_crossref_success.lookup.assert_called_once()
        mock_openalex_success.lookup.assert_called_once()
        mock_dblp_success.lookup.assert_called_once()
        # Tier 2 skipped due to strong Tier 1 consensus
        mock_arxiv_empty.lookup.assert_not_called()

    @pytest.mark.asyncio
    async def test_dedupe_by_doi(
        self,
        mock_citation,
        mock_crossref_success,
        mock_openalex_success,
        mock_arxiv_empty,
        mock_openlibrary_empty,
        mock_europepmc_empty,
        mock_cache,
    ):
        """Same DOI from different sources should be deduped, keeping highest confidence."""
        mock_dblp = _make_mock_client(
            "dblp",
            found=True,
            title="Deep Learning for Vision",
            authors=["Smith, J."],
            year="2020",
            doi="10.1109/CVPR.2020.00123",
            confidence=0.75,
        )

        orchestrator = RetrievalOrchestrator(
            crossref=mock_crossref_success,
            openalex=mock_openalex_success,
            dblp=mock_dblp,
            arxiv=mock_arxiv_empty,
            openlibrary=mock_openlibrary_empty,
            europepmc=mock_europepmc_empty,
            parallel=True,
            cache=mock_cache,
        )

        result = await orchestrator.retrieve(mock_citation)

        doi_candidates = [c for c in result.candidates if c.doi == "10.1109/CVPR.2020.00123"]
        assert len(doi_candidates) == 1
        assert doi_candidates[0].source_name == "crossref"

    @pytest.mark.asyncio
    async def test_parallel_execution(
        self,
        mock_citation,
        mock_crossref_success,
        mock_openalex_success,
        mock_dblp_success,
        mock_arxiv_empty,
        mock_openlibrary_empty,
        mock_europepmc_empty,
        mock_cache,
    ):
        """Verify parallel=True calls Tier-1 sources concurrently."""
        orchestrator = RetrievalOrchestrator(
            crossref=mock_crossref_success,
            openalex=mock_openalex_success,
            dblp=mock_dblp_success,
            arxiv=mock_arxiv_empty,
            openlibrary=mock_openlibrary_empty,
            europepmc=mock_europepmc_empty,
            parallel=True,
            cache=mock_cache,
        )

        start = time.time()
        result = await orchestrator.retrieve(mock_citation)
        elapsed = time.time() - start

        assert len(result.sources_queried) == 3
        assert elapsed < 1.0


# ---------- Test: Partial Failure ----------


class TestRetrievalOrchestratorPartialFailure:
    """Test partial failure scenarios."""

    @pytest.mark.asyncio
    async def test_partial_failure_2_sources_fail(
        self,
        mock_citation,
        mock_crossref_success,
        mock_arxiv_empty,
        mock_openlibrary_empty,
        mock_europepmc_empty,
        mock_cache,
    ):
        """2 out of 3 Tier-1 sources fail -> still proceed with Crossref result."""
        mock_openalex_fail = _make_mock_client("openalex", found=False, error="Rate limit")
        mock_dblp_fail = _make_mock_client("dblp", found=False, error="Connection failed")

        orchestrator = RetrievalOrchestrator(
            crossref=mock_crossref_success,
            openalex=mock_openalex_fail,
            dblp=mock_dblp_fail,
            arxiv=mock_arxiv_empty,
            openlibrary=mock_openlibrary_empty,
            europepmc=mock_europepmc_empty,
            parallel=True,
            cache=mock_cache,
        )

        result = await orchestrator.retrieve(mock_citation)

        assert "crossref" in result.sources_succeeded
        assert "openalex" in result.sources_failed
        assert "dblp" in result.sources_failed

    @pytest.mark.asyncio
    async def test_majority_failure_triggers_warning(
        self,
        mock_citation,
        mock_cache,
    ):
        """All active sources fail -> returns 0 succeeded sources when Scholar fallback returns None."""
        mock_clients = {
            name: _make_mock_client(name, found=False, error="Connection failed")
            for name in ("crossref", "openalex", "dblp", "arxiv", "openlibrary", "europepmc")
        }

        orchestrator = RetrievalOrchestrator(
            crossref=mock_clients["crossref"],
            openalex=mock_clients["openalex"],
            dblp=mock_clients["dblp"],
            arxiv=mock_clients["arxiv"],
            openlibrary=mock_clients["openlibrary"],
            europepmc=mock_clients["europepmc"],
            parallel=True,
            cache=mock_cache,
        )

        with patch.object(orchestrator, "_lookup_serpapi_fallback", return_value=None):
            result = await orchestrator.retrieve(mock_citation)

        assert len(result.sources_succeeded) == 0
        assert len(result.sources_failed) >= 4
        assert all(not c.found for c in result.candidates)


# ---------- Test: Cache ----------


class TestRetrievalOrchestratorCache:
    """Test cache hit/miss behavior."""

    @pytest.mark.asyncio
    async def test_cache_hit_skips_api_call(
        self,
        mock_citation,
        mock_crossref_success,
        mock_arxiv_empty,
        mock_openlibrary_empty,
        mock_europepmc_empty,
        mock_cache,
    ):
        """Cache hit should not call the actual API."""
        mock_cache.get.return_value = {
            "found": True,
            "doi": "10.1109/CVPR.2020.00123",
            "title": "Deep Learning for Vision",
            "authors": ["Smith, J."],
            "year": "2020",
            "abstract": "Cached abstract text.",
            "confidence": 0.95,
            "external_ids": {},
            "score": 0.9,
            "error": None,
            "url": None,
            "venue": None,
        }

        mock_openalex_fail = _make_mock_client("openalex", found=False, error="Not cached")
        mock_dblp_fail = _make_mock_client("dblp", found=False, error="Not cached")

        orchestrator = RetrievalOrchestrator(
            crossref=mock_crossref_success,
            openalex=mock_openalex_fail,
            dblp=mock_dblp_fail,
            arxiv=mock_arxiv_empty,
            openlibrary=mock_openlibrary_empty,
            europepmc=mock_europepmc_empty,
            parallel=True,
            cache=mock_cache,
        )

        result = await orchestrator.retrieve(mock_citation)

        assert mock_cache.get.called
        mock_crossref_success.lookup.assert_not_called()

        assert len(result.candidates) >= 1
        cached_candidate = next((c for c in result.candidates if c.cached), None)
        assert cached_candidate is not None
        assert cached_candidate.cached is True

    @pytest.mark.asyncio
    async def test_cache_miss_calls_api(
        self,
        mock_citation,
        mock_crossref_success,
        mock_arxiv_empty,
        mock_openlibrary_empty,
        mock_europepmc_empty,
        mock_cache,
    ):
        """Cache miss should call the actual API and save result."""
        mock_cache.get.return_value = None

        mock_openalex_fail = _make_mock_client("openalex", found=False, error="Failed")
        mock_dblp_fail = _make_mock_client("dblp", found=False, error="Failed")

        orchestrator = RetrievalOrchestrator(
            crossref=mock_crossref_success,
            openalex=mock_openalex_fail,
            dblp=mock_dblp_fail,
            arxiv=mock_arxiv_empty,
            openlibrary=mock_openlibrary_empty,
            europepmc=mock_europepmc_empty,
            parallel=True,
            cache=mock_cache,
        )

        result = await orchestrator.retrieve(mock_citation)
        assert result is not None
        mock_crossref_success.lookup.assert_called_once()
        assert mock_cache.set.called

    @pytest.mark.asyncio
    async def test_cache_key_includes_source(
        self,
        mock_citation,
        mock_crossref_success,
        mock_openalex_success,
        mock_dblp_success,
        mock_arxiv_empty,
        mock_openlibrary_empty,
        mock_europepmc_empty,
        mock_cache,
    ):
        """Different sources should have different cache keys."""
        mock_cache.get.return_value = None

        orchestrator = RetrievalOrchestrator(
            crossref=mock_crossref_success,
            openalex=mock_openalex_success,
            dblp=mock_dblp_success,
            arxiv=mock_arxiv_empty,
            openlibrary=mock_openlibrary_empty,
            europepmc=mock_europepmc_empty,
            parallel=True,
            cache=mock_cache,
        )

        await orchestrator.retrieve(mock_citation)

        calls = mock_cache.get.call_args_list
        keys_checked = [call[0][0] for call in calls]
        assert any("crossref:" in k for k in keys_checked)
        assert any("openalex:" in k for k in keys_checked)
        assert any("dblp:" in k for k in keys_checked)


# ---------- Test: Rate Limiting ----------


class TestRetrievalOrchestratorRateLimit:
    """Test rate limiting behavior."""

    @pytest.mark.asyncio
    async def test_rate_limiter_wait_called(
        self,
        mock_citation,
        mock_crossref_success,
        mock_openalex_success,
        mock_dblp_success,
        mock_arxiv_empty,
        mock_openlibrary_empty,
        mock_europepmc_empty,
        mock_cache,
    ):
        """Verify rate limiter's wait() is called before API call."""
        from integrity_checker.retrieval.rate_limiter import RateLimiter

        mock_limiter = AsyncMock(spec=RateLimiter)

        orchestrator = RetrievalOrchestrator(
            crossref=mock_crossref_success,
            openalex=mock_openalex_success,
            dblp=mock_dblp_success,
            arxiv=mock_arxiv_empty,
            openlibrary=mock_openlibrary_empty,
            europepmc=mock_europepmc_empty,
            parallel=True,
            cache=mock_cache,
        )

        orchestrator._rate_limiters[mock_crossref_success.name] = mock_limiter

        await orchestrator.retrieve(mock_citation)

        mock_limiter.wait.assert_called_once()


# ---------- Test: Serialization ----------


class TestRetrievalOrchestratorSerialization:
    """Test cache serialization/deserialization."""

    def test_candidate_to_cache(self):
        """SourceCandidate should serialize correctly for caching."""
        cand = SourceCandidate(
            source_name="crossref",
            found=True,
            doi="10.1109/CVPR.2020.00123",
            title="Deep Learning",
            authors=["Smith, J."],
            year="2020",
            venue="CVPR",
            url="https://example.com",
            external_ids={"arxiv": "1234.5678"},
            score=0.9,
            confidence=0.95,
            error=None,
        )

        data = RetrievalOrchestrator._candidate_to_cache(cand)

        assert data["found"] is True
        assert data["doi"] == "10.1109/CVPR.2020.00123"
        assert data["title"] == "Deep Learning"
        assert data["authors"] == ["Smith, J."]
        assert data["year"] == "2020"
        assert data["external_ids"] == {"arxiv": "1234.5678"}

    def test_candidate_from_cache(self):
        """Cached data should deserialize correctly."""
        data = {
            "found": True,
            "doi": "10.1109/CVPR.2020.00123",
            "title": "Deep Learning",
            "authors": ["Smith, J."],
            "year": "2020",
            "venue": "CVPR",
            "url": "https://example.com",
            "external_ids": {"arxiv": "1234.5678"},
            "score": 0.9,
            "confidence": 0.95,
            "error": None,
        }

        cand = RetrievalOrchestrator._candidate_from_cache("crossref", data)

        assert cand.source_name == "crossref"
        assert cand.found is True
        assert cand.doi == "10.1109/CVPR.2020.00123"
        assert cand.cached is True

    def test_cache_key_format(self):
        """Cache key should include source name and citation hash."""
        citation = Citation(
            raw_text="Test",
            title="Test Title",
            year="2020",
            doi="10.1234/test",
        )

        key = RetrievalOrchestrator._cache_key("crossref", citation)

        assert key.startswith("crossref:")
        assert len(key) > len("crossref:")

    def test_dedupe_candidates(self):
        """Candidates with same DOI should be deduped, keeping highest confidence."""
        c1 = SourceCandidate(source_name="crossref", found=True, doi="10.1234/test", confidence=0.90)
        c2 = SourceCandidate(source_name="openalex", found=True, doi="10.1234/test", confidence=0.85)
        c3 = SourceCandidate(source_name="dblp", found=True, title="Different Title", confidence=0.80)

        deduped = RetrievalOrchestrator._dedupe_candidates([c1, c2, c3])

        doi_cands = [c for c in deduped if c.doi == "10.1234/test"]
        assert len(doi_cands) == 1
        assert doi_cands[0].confidence == 0.90

        title_cands = [c for c in deduped if c.title == "Different Title"]
        assert len(title_cands) == 1


# ---------- Test: Sequential Mode ----------


class TestRetrievalOrchestratorSequential:
    """Test sequential (non-parallel) execution."""

    @pytest.mark.asyncio
    async def test_sequential_mode(
        self,
        mock_citation,
        mock_crossref_success,
        mock_openalex_success,
        mock_dblp_success,
        mock_arxiv_empty,
        mock_openlibrary_empty,
        mock_europepmc_empty,
        mock_cache,
    ):
        """Verify parallel=False processes sources sequentially."""
        orchestrator = RetrievalOrchestrator(
            crossref=mock_crossref_success,
            openalex=mock_openalex_success,
            dblp=mock_dblp_success,
            arxiv=mock_arxiv_empty,
            openlibrary=mock_openlibrary_empty,
            europepmc=mock_europepmc_empty,
            parallel=False,
            cache=mock_cache,
        )

        result = await orchestrator.retrieve(mock_citation)

        assert set(result.sources_queried) == {"crossref", "openalex", "dblp"}
        assert len(result.sources_succeeded) >= 2


# ---------- Test: arXiv DOI Routing ----------


class TestArxivDoiRouting:
    """Test that arXiv DOIs skip Crossref and route to arXiv, DBLP, and OpenAlex."""

    @pytest.fixture
    def regular_doi_citation(self):
        """Citation with regular CS/CVPR DOI."""
        return Citation(
            raw_text="Smith, J. (2020). Regular Paper. DOI: 10.1109/CVPR.2020.00123.",
            title="Regular Paper",
            year="2020",
            doi="10.1109/CVPR.2020.00123",
            authors=[],
        )

    def test_is_arxiv_doi_true(self):
        """DOI containing 'arxiv' should be detected as arXiv DOI."""
        assert RetrievalOrchestrator.is_arxiv_doi("10.48550/arXiv.1706.03762") is True
        assert RetrievalOrchestrator.is_arxiv_doi("10.48550/ARXIV.1706.03762") is True

    def test_is_arxiv_doi_false(self):
        """Regular DOIs should not be detected as arXiv DOI."""
        assert RetrievalOrchestrator.is_arxiv_doi("10.1109/CVPR.2020.00123") is False
        assert RetrievalOrchestrator.is_arxiv_doi("10.1007/978-3-642-15582-6") is False
        assert RetrievalOrchestrator.is_arxiv_doi(None) is False
        assert RetrievalOrchestrator.is_arxiv_doi("") is False

    @pytest.mark.asyncio
    async def test_arxiv_doi_skips_crossref(self, mock_cache):
        """arXiv DOI (10.48550/arXiv.*) skips Crossref and queries arXiv, DBLP, and OpenAlex."""
        other_arxiv_citation = Citation(
            raw_text="Zhang et al. (2022). Novel Quantum Preprint Architecture. arXiv:2209.54321.",
            title="Novel Quantum Preprint Architecture",
            year="2022",
            doi="10.48550/arXiv.2209.54321",
            authors=["Zhang"],
        )

        mock_crossref = _make_mock_client("crossref", found=False, error="Should not be called")
        mock_arxiv = _make_mock_client(
            "arxiv",
            found=True,
            title="Novel Quantum Preprint Architecture",
            authors=["Zhang"],
            year="2022",
            doi="10.48550/arXiv.2209.54321",
            abstract="Preprint abstract from arXiv.",
            confidence=0.95,
        )
        mock_dblp = _make_mock_client(
            "dblp",
            found=True,
            title="Novel Quantum Preprint Architecture",
            authors=["Zhang"],
            year="2022",
            confidence=0.90,
        )
        mock_openalex = _make_mock_client(
            "openalex",
            found=True,
            title="Novel Quantum Preprint Architecture",
            authors=["Zhang"],
            year="2022",
            confidence=0.88,
        )

        orchestrator = RetrievalOrchestrator(
            crossref=mock_crossref,
            openalex=mock_openalex,
            dblp=mock_dblp,
            arxiv=mock_arxiv,
            openlibrary=_make_mock_client("openlibrary"),
            europepmc=_make_mock_client("europepmc"),
            parallel=True,
            cache=mock_cache,
        )

        result = await orchestrator.retrieve(other_arxiv_citation)

        assert set(result.sources_queried) == {"arxiv", "dblp", "openalex"}
        assert "crossref" not in result.sources_queried
        mock_crossref.lookup.assert_not_called()
        mock_arxiv.lookup.assert_called_once()
        mock_dblp.lookup.assert_called_once()
        mock_openalex.lookup.assert_called_once()

    @pytest.mark.asyncio
    async def test_regular_doi_queries_crossref_tier1(
        self,
        regular_doi_citation,
        mock_cache,
    ):
        """Regular DOI queries Crossref + OpenAlex + DBLP in Tier 1."""
        mock_crossref = _make_mock_client(
            "crossref",
            found=True,
            title="Regular Paper",
            year="2020",
            doi="10.1109/CVPR.2020.00123",
            confidence=0.95,
        )
        mock_openalex = _make_mock_client(
            "openalex",
            found=True,
            title="Regular Paper",
            year="2020",
            doi="10.1109/CVPR.2020.00123",
            abstract="Abstract text.",
            confidence=0.90,
        )
        mock_dblp = _make_mock_client(
            "dblp",
            found=True,
            title="Regular Paper",
            year="2020",
            confidence=0.85,
        )

        orchestrator = RetrievalOrchestrator(
            crossref=mock_crossref,
            openalex=mock_openalex,
            dblp=mock_dblp,
            arxiv=_make_mock_client("arxiv"),
            openlibrary=_make_mock_client("openlibrary"),
            europepmc=_make_mock_client("europepmc"),
            parallel=True,
            cache=mock_cache,
        )

        result = await orchestrator.retrieve(regular_doi_citation)

        assert set(result.sources_queried) == {"crossref", "openalex", "dblp"}
        mock_crossref.lookup.assert_called_once()

    @pytest.mark.asyncio
    async def test_arxiv_doi_health_check_when_sources_fail(self, mock_cache):
        """arXiv DOI with failing sources records all failures cleanly."""
        other_arxiv_citation = Citation(
            raw_text="Some Author et al. (2019). Some Paper. arXiv:1901.01234.",
            title="Some Paper",
            year="2019",
            doi="10.48550/arXiv.1901.01234",
            authors=["Some Author"],
        )

        mock_arxiv = _make_mock_client("arxiv", found=False, error="Connection failed")
        mock_dblp = _make_mock_client("dblp", found=False, error="Connection failed")
        mock_openalex = _make_mock_client("openalex", found=False, error="Connection failed")

        orchestrator = RetrievalOrchestrator(
            crossref=_make_mock_client("crossref"),
            openalex=mock_openalex,
            dblp=mock_dblp,
            arxiv=mock_arxiv,
            openlibrary=_make_mock_client("openlibrary"),
            europepmc=_make_mock_client("europepmc"),
            parallel=True,
            cache=mock_cache,
        )

        with patch.object(orchestrator, "_lookup_serpapi_fallback", return_value=None):
            result = await orchestrator.retrieve(other_arxiv_citation)

        assert len(result.sources_succeeded) == 0
        assert set(result.sources_failed) == {"arxiv", "dblp", "openalex"}

    def test_filter_quality_candidates_removes_suspicious_doi(self, mock_cache):
        """Candidates with placeholder DOIs (10.1234, 10.9999) must be filtered out."""
        orchestrator = RetrievalOrchestrator(cache=mock_cache)
        citation = Citation(raw_text="Test citation", title="Valid Academic Paper Title")
        candidates = [
            SourceCandidate(
                source_name="crossref",
                found=True,
                doi="10.1234/fake.2023",
                title="Valid Academic Paper Title",
                authors=["Smith, J."],
            ),
            SourceCandidate(
                source_name="openalex",
                found=True,
                doi="10.1109/real.2023",
                title="Valid Academic Paper Title",
                authors=["Smith, J."],
            ),
        ]
        filtered, succeeded = orchestrator._filter_quality_candidates(
            candidates, ["crossref", "openalex"], citation
        )
        assert len(filtered) == 1
        assert filtered[0].doi == "10.1109/real.2023"
        assert succeeded == ["openalex"]

    @pytest.mark.asyncio
    async def test_serpapi_fallback_triggers_on_single_source_arxiv_failure(
        self,
        mock_cache,
    ):
        """When only 1 source is queried and fails (429), Scholar fallback triggers."""
        citation = Citation(
            raw_text="Unknown Author (2021). Obscure Arxiv Preprint. arXiv:2199.99999.",
            title="Obscure Arxiv Preprint on Quantum Widgets",
            year="2021",
            doi="10.48550/arXiv.2199.99999",
            authors=["Unknown Author"],
        )

        mock_arxiv = _make_mock_client("arxiv", found=False, error="arXiv: rate limited (429)")

        orchestrator = RetrievalOrchestrator(
            crossref=_make_mock_client("crossref"),
            openalex=_make_mock_client("openalex"),
            dblp=_make_mock_client("dblp"),
            arxiv=mock_arxiv,
            openlibrary=_make_mock_client("openlibrary"),
            europepmc=_make_mock_client("europepmc"),
            parallel=True,
            cache=mock_cache,
            use_local_db=False,
        )
        # Simulate only arXiv enabled for arXiv DOI
        orchestrator.dblp = None  # type: ignore[assignment]
        orchestrator.openalex = None  # type: ignore[assignment]

        serpapi_cand = SourceCandidate(
            source_name="serpapi",
            found=True,
            title="Obscure Arxiv Preprint on Quantum Widgets",
            authors=["Unknown Author"],
            year="2021",
            confidence=0.5,
        )

        with patch.object(
            orchestrator, "_lookup_serpapi_fallback", return_value=serpapi_cand
        ) as mock_serp:
            result = await orchestrator.retrieve(citation)

        mock_serp.assert_called_once()
        assert "serpapi" in result.sources_succeeded
        assert any(c.source_name == "serpapi" and c.found for c in result.candidates)

    def test_extract_arxiv_id_from_doi(self):
        """RetrievalOrchestrator._extract_arxiv_id extracts arXiv ID from 10.48550/arXiv.* DOI."""
        cit = Citation(
            raw_text="Vaswani et al. (2017). Attention Is All You Need.",
            doi="10.48550/arXiv.1706.03762",
        )
        assert RetrievalOrchestrator._extract_arxiv_id(cit) == "1706.03762"


# ---------- Test: Google Scholar Fallback Router Integration ----------


class TestScholarFallbackRouterIntegration:
    """Verify RetrievalOrchestrator._lookup_serpapi_fallback wires GoogleScholarFallbackClient."""

    @pytest.fixture(autouse=True)
    def _reset_breakers(self):
        SerpApiClient.reset_circuit_breakers()
        yield
        SerpApiClient.reset_circuit_breakers()

    @pytest.mark.asyncio
    async def test_skips_when_both_serper_and_serpapi_keys_empty(self, mock_cache):
        orch = RetrievalOrchestrator(
            crossref=_make_mock_client("crossref"),
            openalex=_make_mock_client("openalex"),
            dblp=_make_mock_client("dblp"),
            arxiv=_make_mock_client("arxiv"),
            openlibrary=_make_mock_client("openlibrary"),
            europepmc=_make_mock_client("europepmc"),
            cache=mock_cache,
        )
        fake_settings = SimpleNamespace(
            serper_api_key="",
            serpapi_api_key="",
            retrieval=SimpleNamespace(
                rate_limits=SimpleNamespace(serper_per_sec=5.0, serpapi_per_sec=1.0)
            ),
        )
        cit = Citation(raw_text="Test (2021). Paper Title.", title="Paper Title", year="2021")
        with patch(
            "integrity_checker.retrieval.retrieval_orchestrator.get_settings",
            return_value=fake_settings,
        ):
            res = await orch._lookup_serpapi_fallback(cit)

        assert res is None
        assert orch.serpapi is None

    @pytest.mark.asyncio
    async def test_initializes_with_serper_key_only_and_steps_down_rate_limit(self, mock_cache):
        orch = RetrievalOrchestrator(
            crossref=_make_mock_client("crossref"),
            openalex=_make_mock_client("openalex"),
            dblp=_make_mock_client("dblp"),
            arxiv=_make_mock_client("arxiv"),
            openlibrary=_make_mock_client("openlibrary"),
            europepmc=_make_mock_client("europepmc"),
            cache=mock_cache,
        )
        fake_settings = SimpleNamespace(
            serper_api_key="serper-live-key",
            serpapi_api_key="serpapi-backup-key",
            retrieval=SimpleNamespace(
                rate_limits=SimpleNamespace(serper_per_sec=5.0, serpapi_per_sec=1.0)
            ),
        )
        cit = Citation(raw_text="Test (2021). Paper Title.", title="Paper Title", year="2021")
        expected = SourceCandidate(
            source_name="serpapi",
            found=True,
            title="Paper Title",
            year="2021",
            external_ids={"scholar_provider": "serper"},
            confidence=0.8,
        )
        with (
            patch(
                "integrity_checker.retrieval.retrieval_orchestrator.get_settings",
                return_value=fake_settings,
            ),
            patch.object(GoogleScholarFallbackClient, "lookup", AsyncMock(return_value=expected)),
        ):
            res = await orch._lookup_serpapi_fallback(cit)
            assert res is expected
            assert isinstance(orch.serpapi, GoogleScholarFallbackClient)
            assert orch.serpapi.serper_api_key == "serper-live-key"
            assert orch.serpapi.api_key == "serpapi-backup-key"
            assert orch._serpapi_limiter_mode == "serper"

            # Simulate Serper exhausting credits mid-run -> next call steps down limiter to serpapi_per_sec
            SerpApiClient._serper_quota_exhausted = True
            await orch._lookup_serpapi_fallback(cit)
            assert orch._serpapi_limiter_mode == "serpapi"
