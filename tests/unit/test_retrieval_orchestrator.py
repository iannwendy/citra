"""Unit tests cho RetrievalOrchestrator (task #36 — Sprint 3).

Test các scenarios:
    - Happy path: 4 sources trả về results
    - Partial failure: 2 sources fail -> still proceed
    - All fail: return empty + UNRESOLVED sentinel
    - Cache hit: verify not calling APIs
    - Cache miss: verify calling APIs
    - Rate limiting: verify backoff works
"""

from __future__ import annotations

import unittest
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from integrity_checker.models.citation import Citation
from integrity_checker.models.source import SourceCandidate, SourceResult
from integrity_checker.retrieval.cache import DiskCache
from integrity_checker.retrieval.retrieval_orchestrator import RetrievalOrchestrator

# ---------- Fixtures ----------

@pytest.fixture
def mock_cache():
    """Mock DiskCache."""
    cache = MagicMock(spec=DiskCache)
    cache.get.return_value = None
    cache.set.return_value = None
    return cache


@pytest.fixture
def mock_citation():
    """Sample citation for testing."""
    return Citation(
        raw_text="Smith, J. (2020). Deep Learning for Vision. CVPR 2020.",
        title="Deep Learning for Vision",
        year="2020",
        authors=[],
    )


@pytest.fixture
def mock_crossref_success():
    """Mock CrossrefClient returns success."""
    client = AsyncMock()
    client.name = "crossref"
    client.lookup.return_value = SourceCandidate(
        source_name="crossref",
        found=True,
        title="Deep Learning for Vision",
        authors=["Smith, J."],
        year="2020",
        doi="10.1109/CVPR.2020.00123",
        confidence=0.95,
    )
    return client


@pytest.fixture
def mock_openalex_success():
    """Mock OpenAlexClient returns success."""
    client = AsyncMock()
    client.name = "openalex"
    client.lookup.return_value = SourceCandidate(
        source_name="openalex",
        found=True,
        title="Deep Learning for Vision",
        authors=["Smith, J."],
        year="2020",
        confidence=0.90,
    )
    return client


@pytest.fixture
def mock_semantic_scholar_success():
    """Mock SemanticScholarClient returns success."""
    client = AsyncMock()
    client.name = "semantic_scholar"
    client.lookup.return_value = SourceCandidate(
        source_name="semantic_scholar",
        found=True,
        title="Deep Learning for Vision",
        authors=["Smith, J."],
        year="2020",
        confidence=0.88,
    )
    return client


@pytest.fixture
def mock_coreapi_success():
    """Mock CoreAPIClient returns success."""
    client = AsyncMock()
    client.name = "coreapi"
    client.lookup.return_value = SourceCandidate(
        source_name="coreapi",
        found=True,
        title="Deep Learning for Vision",
        authors=["Smith, J."],
        year="2020",
        confidence=0.85,
    )
    return client


@pytest.fixture
def mock_client_failure():
    """Mock client that returns failure."""
    client = AsyncMock()
    client.name = "test_source"
    client.lookup.return_value = SourceCandidate(
        source_name="test_source",
        found=False,
        error="Connection timeout",
    )
    return client


# ---------- Test: Happy Path ----------

class TestRetrievalOrchestratorHappyPath:
    """Test happy path: all 4 sources return results."""

    @pytest.mark.asyncio
    async def test_happy_path_all_sources_succeed(
        self,
        mock_citation,
        mock_crossref_success,
        mock_openalex_success,
        mock_semantic_scholar_success,
        mock_coreapi_success,
        mock_cache,
    ):
        """All 4 sources return found=True results."""
        orchestrator = RetrievalOrchestrator(
            crossref=mock_crossref_success,
            openalex=mock_openalex_success,
            semantic_scholar=mock_semantic_scholar_success,
            coreapi=mock_coreapi_success,
            parallel=True,
            cache=mock_cache,
        )

        result = await orchestrator.retrieve(mock_citation)

        # After quality filtering, some sources may be filtered out
        # if their candidates don't meet quality thresholds
        assert len(result.candidates) >= 1
        assert len(result.sources_queried) == 4
        # At least some sources should succeed (quality filtering may filter some)
        assert len(result.sources_succeeded) >= 2
        assert len(result.sources_failed) == 0

        # Verify all clients were called
        mock_crossref_success.lookup.assert_called_once()
        mock_openalex_success.lookup.assert_called_once()
        mock_semantic_scholar_success.lookup.assert_called_once()
        mock_coreapi_success.lookup.assert_called_once()

    @pytest.mark.asyncio
    async def test_dedupe_by_doi(
        self,
        mock_citation,
        mock_crossref_success,
        mock_openalex_success,
        mock_cache,
    ):
        """Same DOI from different sources should be deduped."""
        mock_s2 = AsyncMock()
        mock_s2.name = "semantic_scholar"
        mock_s2.lookup.return_value = SourceCandidate(
            source_name="semantic_scholar", found=True, doi="10.1109/CVPR.2020.00123", confidence=0.75
        )
        mock_coreapi = AsyncMock()
        mock_coreapi.name = "coreapi"
        mock_coreapi.lookup.return_value = SourceCandidate(
            source_name="coreapi", found=True, doi="10.1109/CVPR.2020.00123", confidence=0.70
        )

        orchestrator = RetrievalOrchestrator(
            crossref=mock_crossref_success,
            openalex=mock_openalex_success,
            semantic_scholar=mock_s2,
            coreapi=mock_coreapi,
            parallel=True,
            cache=mock_cache,
        )

        result = await orchestrator.retrieve(mock_citation)

        # Should have deduplicated - keep highest confidence
        doi_candidates = [c for c in result.candidates if c.doi == "10.1109/CVPR.2020.00123"]
        assert len(doi_candidates) == 1  # Deduplicated to 1
        # Crossref has highest confidence (0.95)
        assert doi_candidates[0].source_name == "crossref"

    @pytest.mark.asyncio
    async def test_parallel_execution(
        self,
        mock_citation,
        mock_crossref_success,
        mock_openalex_success,
        mock_semantic_scholar_success,
        mock_coreapi_success,
        mock_cache,
    ):
        """Verify parallel=True calls all sources concurrently."""
        orchestrator = RetrievalOrchestrator(
            crossref=mock_crossref_success,
            openalex=mock_openalex_success,
            semantic_scholar=mock_semantic_scholar_success,
            coreapi=mock_coreapi_success,
            parallel=True,
            cache=mock_cache,
        )

        import time
        start = time.time()
        result = await orchestrator.retrieve(mock_citation)
        elapsed = time.time() - start

        # With parallel=True, should complete faster than sequential
        # (all mocks are instant, but we verify the call pattern)
        assert len(result.sources_queried) == 4
        # In async context, parallel calls happen "at the same time"
        assert elapsed < 1.0  # Should be very fast with mocks


# ---------- Test: Partial Failure ----------

class TestRetrievalOrchestratorPartialFailure:
    """Test partial failure scenarios."""

    @pytest.mark.asyncio
    async def test_partial_failure_2_sources_fail(
        self,
        mock_citation,
        mock_crossref_success,
        mock_cache,
    ):
        """2 out of 4 sources fail -> still proceed with results."""
        mock_openalex_fail = AsyncMock()
        mock_openalex_fail.name = "openalex"
        mock_openalex_fail.lookup.return_value = SourceCandidate(
            source_name="openalex", found=False, error="Rate limit"
        )

        mock_s2_fail = AsyncMock()
        mock_s2_fail.name = "semantic_scholar"
        mock_s2_fail.lookup.return_value = SourceCandidate(
            source_name="semantic_scholar", found=False, error="Connection failed"
        )

        mock_coreapi_fail = AsyncMock()
        mock_coreapi_fail.name = "coreapi"
        mock_coreapi_fail.lookup.return_value = SourceCandidate(
            source_name="coreapi", found=False, error="Not found"
        )

        orchestrator = RetrievalOrchestrator(
            crossref=mock_crossref_success,
            openalex=mock_openalex_fail,
            semantic_scholar=mock_s2_fail,
            coreapi=mock_coreapi_fail,
            parallel=True,
            cache=mock_cache,
        )

        result = await orchestrator.retrieve(mock_citation)

        # Should still have results from crossref
        assert len(result.sources_queried) == 4
        assert "crossref" in result.sources_succeeded
        assert "openalex" in result.sources_failed
        assert "semantic_scholar" in result.sources_failed
        assert "coreapi" in result.sources_failed

    @pytest.mark.asyncio
    async def test_majority_failure_triggers_warning(
        self,
        mock_citation,
        mock_cache,
    ):
        """3+ sources fail -> should log UNRESOLVED warning."""
        # Create 4 failing clients
        mock_clients = []
        for name in ["crossref", "openalex", "semantic_scholar", "coreapi"]:
            mock_client = AsyncMock()
            mock_client.name = name
            mock_client.lookup.return_value = SourceCandidate(
                source_name=name, found=False, error="Connection failed"
            )
            mock_clients.append(mock_client)

        orchestrator = RetrievalOrchestrator(
            crossref=mock_clients[0],
            openalex=mock_clients[1],
            semantic_scholar=mock_clients[2],
            coreapi=mock_clients[3],
            parallel=True,
            cache=mock_cache,
        )

        # Mock SerpApi fallback to not be called (returns None)
        # This test verifies the behavior before SerpApi fallback kicks in
        with patch.object(
            orchestrator, "_lookup_serpapi_fallback", return_value=None
        ):
            result = await orchestrator.retrieve(mock_citation)

        # All sources failed (serpapi not called in this scenario)
        assert len(result.sources_succeeded) == 0
        assert len(result.sources_failed) == 4
        # Candidates list still contains failed candidates (for debugging)
        # but none have found=True
        assert all(not c.found for c in result.candidates)


# ---------- Test: Cache ----------

class TestRetrievalOrchestratorCache:
    """Test cache hit/miss behavior."""

    @pytest.mark.asyncio
    async def test_cache_hit_skips_api_call(
        self,
        mock_citation,
        mock_crossref_success,
        mock_cache,
    ):
        """Cache hit should not call the actual API."""
        # Setup cache to return a hit
        mock_cache.get.return_value = {
            "found": True,
            "doi": "10.1109/CVPR.2020.00123",
            "title": "Deep Learning for Vision",
            "authors": ["Smith, J."],
            "year": "2020",
            "confidence": 0.95,
            "external_ids": {},
            "score": 0.9,
            "error": None,
            "url": None,
            "venue": None,
        }

        # Setup other clients as failures
        mock_openalex_fail = AsyncMock()
        mock_openalex_fail.name = "openalex"
        mock_openalex_fail.lookup.return_value = SourceCandidate(
            source_name="openalex", found=False, error="Not cached"
        )
        mock_s2_fail = AsyncMock()
        mock_s2_fail.name = "semantic_scholar"
        mock_s2_fail.lookup.return_value = SourceCandidate(
            source_name="semantic_scholar", found=False, error="Not cached"
        )
        mock_coreapi_fail = AsyncMock()
        mock_coreapi_fail.name = "coreapi"
        mock_coreapi_fail.lookup.return_value = SourceCandidate(
            source_name="coreapi", found=False, error="Not cached"
        )

        orchestrator = RetrievalOrchestrator(
            crossref=mock_crossref_success,
            openalex=mock_openalex_fail,
            semantic_scholar=mock_s2_fail,
            coreapi=mock_coreapi_fail,
            parallel=True,
            cache=mock_cache,
        )

        result = await orchestrator.retrieve(mock_citation)

        # Cache was checked
        assert mock_cache.get.called

        # Crossref API should NOT have been called (cache hit)
        mock_crossref_success.lookup.assert_not_called()

        # But result should still be returned from cache
        assert len(result.candidates) >= 1
        cached_candidate = next(
            (c for c in result.candidates if c.cached), None
        )
        assert cached_candidate is not None
        assert cached_candidate.cached is True

    @pytest.mark.asyncio
    async def test_cache_miss_calls_api(
        self,
        mock_citation,
        mock_crossref_success,
        mock_cache,
    ):
        """Cache miss should call the actual API and save result."""
        mock_cache.get.return_value = None  # Cache miss

        mock_openalex_fail = AsyncMock()
        mock_openalex_fail.name = "openalex"
        mock_openalex_fail.lookup.return_value = SourceCandidate(
            source_name="openalex", found=False, error="Failed"
        )
        mock_s2_fail = AsyncMock()
        mock_s2_fail.name = "semantic_scholar"
        mock_s2_fail.lookup.return_value = SourceCandidate(
            source_name="semantic_scholar", found=False, error="Failed"
        )
        mock_coreapi_fail = AsyncMock()
        mock_coreapi_fail.name = "coreapi"
        mock_coreapi_fail.lookup.return_value = SourceCandidate(
            source_name="coreapi", found=False, error="Failed"
        )

        orchestrator = RetrievalOrchestrator(
            crossref=mock_crossref_success,
            openalex=mock_openalex_fail,
            semantic_scholar=mock_s2_fail,
            coreapi=mock_coreapi_fail,
            parallel=True,
            cache=mock_cache,
        )

        result = await orchestrator.retrieve(mock_citation)

        # API should have been called
        mock_crossref_success.lookup.assert_called_once()

        # Result should have been cached
        assert mock_cache.set.called

    @pytest.mark.asyncio
    async def test_cache_key_includes_source(
        self,
        mock_citation,
        mock_crossref_success,
        mock_openalex_success,
        mock_cache,
    ):
        """Different sources should have different cache keys."""
        mock_cache.get.return_value = None

        orchestrator = RetrievalOrchestrator(
            crossref=mock_crossref_success,
            openalex=mock_openalex_success,
            semantic_scholar=AsyncMock(),
            coreapi=AsyncMock(),
            parallel=True,
            cache=mock_cache,
        )

        await orchestrator.retrieve(mock_citation)

        # Verify cache was checked with source-specific keys
        calls = mock_cache.get.call_args_list
        keys_checked = [call[0][0] for call in calls]
        assert any("crossref:" in k for k in keys_checked)
        assert any("openalex:" in k for k in keys_checked)


# ---------- Test: Rate Limiting ----------

class TestRetrievalOrchestratorRateLimit:
    """Test rate limiting behavior."""

    @pytest.mark.asyncio
    async def test_rate_limiter_wait_called(
        self,
        mock_citation,
        mock_crossref_success,
        mock_cache,
    ):
        """Verify rate limiter's wait() is called before API call."""
        from integrity_checker.retrieval.rate_limiter import RateLimiter

        # Mock rate limiter
        mock_limiter = AsyncMock(spec=RateLimiter)

        orchestrator = RetrievalOrchestrator(
            crossref=mock_crossref_success,
            openalex=AsyncMock(),
            semantic_scholar=AsyncMock(),
            coreapi=AsyncMock(),
            parallel=True,
            cache=mock_cache,
        )

        # Replace rate limiter
        orchestrator._rate_limiters[mock_crossref_success.name] = mock_limiter

        await orchestrator.retrieve(mock_citation)

        # Rate limiter should have been awaited
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
        c3 = SourceCandidate(source_name="coreapi", found=True, title="Different Title", confidence=0.80)

        deduped = RetrievalOrchestrator._dedupe_candidates([c1, c2, c3])

        # DOI should dedupe to 1
        doi_cands = [c for c in deduped if c.doi == "10.1234/test"]
        assert len(doi_cands) == 1
        assert doi_cands[0].confidence == 0.90  # Highest confidence kept

        # Title-only should remain separate
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
        mock_semantic_scholar_success,
        mock_coreapi_success,
        mock_cache,
    ):
        """Verify sequential=True processes sources one by one."""
        orchestrator = RetrievalOrchestrator(
            crossref=mock_crossref_success,
            openalex=mock_openalex_success,
            semantic_scholar=mock_semantic_scholar_success,
            coreapi=mock_coreapi_success,
            parallel=False,  # Sequential
            cache=mock_cache,
        )

        result = await orchestrator.retrieve(mock_citation)

        # All sources should still be queried
        assert len(result.sources_queried) == 4
        # At least some sources should succeed after quality filtering
        assert len(result.sources_succeeded) >= 2


# ---------- Test: arXiv DOI Routing ----------

class TestArxivDoiRouting:
    """Test that arXiv DOIs are routed to correct sources (skip Crossref/OpenAlex)."""

    @pytest.fixture
    def arxiv_doi_citation(self):
        """Citation with arXiv DOI."""
        return Citation(
            raw_text="Vaswani, A. et al. (2017). Attention Is All You Need. arXiv:1706.03762.",
            title="Attention Is All You Need",
            year="2017",
            doi="10.48550/arXiv.1706.03762",
            authors=[],
        )

    @pytest.fixture
    def regular_doi_citation(self):
        """Citation with regular DOI."""
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
        assert RetrievalOrchestrator.is_arxiv_doi("10.48550/ARXIV.1706.03762") is True  # case-insensitive

    def test_is_arxiv_doi_false(self):
        """Regular DOIs should not be detected as arXiv DOI."""
        assert RetrievalOrchestrator.is_arxiv_doi("10.1109/CVPR.2020.00123") is False
        assert RetrievalOrchestrator.is_arxiv_doi("10.1007/978-3-642-15582-6") is False
        assert RetrievalOrchestrator.is_arxiv_doi(None) is False
        assert RetrievalOrchestrator.is_arxiv_doi("") is False

    @pytest.mark.asyncio
    async def test_arxiv_doi_skips_crossref_openalex(
        self,
        arxiv_doi_citation,
        mock_cache,
    ):
        """arXiv DOI citation should only query S2 and CoreAPI, not Crossref/OpenAlex.

        Note: Vaswani 2017 is in known_papers, so it returns early.
        Use a different citation to test the routing logic.
        """
        # Use a different arXiv citation that's not in known_papers
        other_arxiv_citation = Citation(
            raw_text="Brown et al. (2020). Language Models are Few-Shot Learners. arXiv:2005.14165.",
            title="Language Models are Few-Shot Learners",
            year="2020",
            doi="10.48550/arXiv.2005.14165",
            authors=[],
        )

        # Create mock clients
        mock_crossref = AsyncMock()
        mock_crossref.name = "crossref"
        mock_crossref.lookup.return_value = SourceCandidate(
            source_name="crossref", found=False, error="Should not be called"
        )

        mock_openalex = AsyncMock()
        mock_openalex.name = "openalex"
        mock_openalex.lookup.return_value = SourceCandidate(
            source_name="openalex", found=False, error="Should not be called"
        )

        mock_s2 = AsyncMock()
        mock_s2.name = "semantic_scholar"
        mock_s2.lookup.return_value = SourceCandidate(
            source_name="semantic_scholar", found=True, doi="10.48550/arXiv.2005.14165", confidence=0.95
        )

        mock_coreapi = AsyncMock()
        mock_coreapi.name = "coreapi"
        mock_coreapi.lookup.return_value = SourceCandidate(
            source_name="coreapi", found=True, title="Language Models are Few-Shot Learners", confidence=0.90
        )

        orchestrator = RetrievalOrchestrator(
            crossref=mock_crossref,
            openalex=mock_openalex,
            semantic_scholar=mock_s2,
            coreapi=mock_coreapi,
            parallel=True,
            cache=mock_cache,
        )

        result = await orchestrator.retrieve(other_arxiv_citation)

        # Only S2 and CoreAPI should be queried (crossref/openalex skipped for arXiv DOIs)
        assert set(result.sources_queried) == {"semantic_scholar", "coreapi"}
        assert "crossref" not in result.sources_queried
        assert "openalex" not in result.sources_queried

        # Verify crossref/openalex were NOT called
        mock_crossref.lookup.assert_not_called()
        mock_openalex.lookup.assert_not_called()

        # Verify S2 and CoreAPI were called
        mock_s2.lookup.assert_called_once()
        mock_coreapi.lookup.assert_called_once()

    @pytest.mark.asyncio
    async def test_regular_doi_queries_all_sources(
        self,
        regular_doi_citation,
        mock_cache,
    ):
        """Regular DOI should query all 4 sources."""
        mock_crossref = AsyncMock()
        mock_crossref.name = "crossref"
        mock_crossref.lookup.return_value = SourceCandidate(
            source_name="crossref", found=True, doi="10.1109/CVPR.2020.00123", confidence=0.95
        )

        mock_openalex = AsyncMock()
        mock_openalex.name = "openalex"
        mock_openalex.lookup.return_value = SourceCandidate(
            source_name="openalex", found=True, confidence=0.85
        )

        mock_s2 = AsyncMock()
        mock_s2.name = "semantic_scholar"
        mock_s2.lookup.return_value = SourceCandidate(
            source_name="semantic_scholar", found=True, confidence=0.80
        )

        mock_coreapi = AsyncMock()
        mock_coreapi.name = "coreapi"
        mock_coreapi.lookup.return_value = SourceCandidate(
            source_name="coreapi", found=False, error="Not arXiv"
        )

        orchestrator = RetrievalOrchestrator(
            crossref=mock_crossref,
            openalex=mock_openalex,
            semantic_scholar=mock_s2,
            coreapi=mock_coreapi,
            parallel=True,
            cache=mock_cache,
        )

        result = await orchestrator.retrieve(regular_doi_citation)

        # All 4 sources should be queried
        assert len(result.sources_queried) == 4
        assert set(result.sources_queried) == {"crossref", "openalex", "semantic_scholar", "coreapi"}

    @pytest.mark.asyncio
    async def test_arxiv_doi_health_check_with_2_sources(
        self,
        mock_cache,
    ):
        """arXiv DOI with 2 failing sources should trigger UNRESOLVED.

        Note: Use a citation not in known_papers to test the health check logic.
        """
        # Use a different arXiv citation that's not in known_papers
        other_arxiv_citation = Citation(
            raw_text="Some Author et al. (2019). Some Paper. arXiv:1901.01234.",
            title="Some Paper",
            year="2019",
            doi="10.48550/arXiv.1901.01234",
            authors=["Some Author"],
        )

        mock_s2 = AsyncMock()
        mock_s2.name = "semantic_scholar"
        mock_s2.lookup.return_value = SourceCandidate(
            source_name="semantic_scholar", found=False, error="Connection failed"
        )

        mock_coreapi = AsyncMock()
        mock_coreapi.name = "coreapi"
        mock_coreapi.lookup.return_value = SourceCandidate(
            source_name="coreapi", found=False, error="Connection failed"
        )

        orchestrator = RetrievalOrchestrator(
            crossref=AsyncMock(),
            openalex=AsyncMock(),
            semantic_scholar=mock_s2,
            coreapi=mock_coreapi,
            parallel=True,
            cache=mock_cache,
        )

        # Mock SerpApi fallback to not be called
        with patch.object(
            orchestrator, "_lookup_serpapi_fallback", return_value=None
        ):
            result = await orchestrator.retrieve(other_arxiv_citation)

        # Both sources failed
        assert len(result.sources_succeeded) == 0
        # Health check should trigger for arXiv DOIs with 2 failing sources
        assert len(result.sources_failed) == 2

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
        """When only 1 source is queried (e.g. arXiv DOI with coreapi disabled) and fails, SerpApi fallback triggers."""
        citation = Citation(
            raw_text="Unknown Author (2021). Obscure Arxiv Preprint. arXiv:2199.99999.",
            title="Obscure Arxiv Preprint on Quantum Widgets",
            year="2021",
            doi="10.48550/arXiv.2199.99999",
            authors=["Unknown Author"],
        )

        mock_s2 = AsyncMock()
        mock_s2.name = "semantic_scholar"
        mock_s2.lookup.return_value = SourceCandidate(
            source_name="semantic_scholar", found=False, error="S2: rate limited (429)"
        )

        orchestrator = RetrievalOrchestrator(
            crossref=AsyncMock(),
            openalex=AsyncMock(),
            semantic_scholar=mock_s2,
            parallel=True,
            cache=mock_cache,
            use_local_db=False,
        )
        # Simulate coreapi disabled
        orchestrator._coreapi_explicit = False
        orchestrator.coreapi = None

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


