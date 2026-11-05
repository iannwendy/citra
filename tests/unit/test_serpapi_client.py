"""Tests cho Tier-3 Google Scholar Fallback Router (`GoogleScholarFallbackClient` / `SerpApiClient`).

Covers:
    1. Priority 1: Async `httpx.AsyncClient.post` -> Serper.dev `/scholar`
    2. Priority 2: Automatic circuit-breaker failover -> SerpApi `google_scholar`
    3. Independent circuit breakers (`_serper_quota_exhausted`, `_quota_exhausted`)
    4. Shared negative query cache (only on clean HTTP 200 misses/mismatches)
    5. Author/year/snippet normalization & backward-compatible `source_name="serpapi"`
"""

from __future__ import annotations

import os
from unittest.mock import patch

import httpx
import pytest

from integrity_checker.models.citation import Citation
from integrity_checker.retrieval.serpapi_client import (
    GoogleScholarFallbackClient,
    SerpApiClient,
)

# Integration tests cần SerpApi/Serper key thật — đọc từ env, KHÔNG hardcode.
SERPAPI_KEY = os.environ.get("SERPAPI_API_KEY")

requires_serpapi_key = pytest.mark.skipif(
    not SERPAPI_KEY,
    reason="SERPAPI_API_KEY không được set — bỏ qua integration test",
)


def _patch_httpx_post(handler):
    """Patch `httpx.AsyncClient.post` deterministically without live network access."""

    async def mock_post(self, url, **kwargs):
        headers = kwargs.get("headers") or {}
        json_body = kwargs.get("json")
        req = httpx.Request("POST", url, headers=headers, json=json_body)
        resp = handler(req, json_body)
        resp._request = req
        return resp

    return patch.object(httpx.AsyncClient, "post", mock_post)


class TestSerpApiClient:
    """Test SerpApi secondary path & backward compatibility."""

    @pytest.fixture(autouse=True)
    def reset_circuit_breaker_state(self):
        """Isolate class-level circuit breakers and negative cache across unit tests."""
        prev_exhausted = SerpApiClient._quota_exhausted
        prev_serper_exhausted = SerpApiClient._serper_quota_exhausted
        prev_cache = set(SerpApiClient._negative_query_cache)
        SerpApiClient.reset_circuit_breakers()
        yield
        SerpApiClient._quota_exhausted = prev_exhausted
        SerpApiClient._serper_quota_exhausted = prev_serper_exhausted
        SerpApiClient._negative_query_cache = prev_cache

    @pytest.fixture
    def client(self) -> SerpApiClient:
        """Create client với explicit SerpApi test key (isolated from .env)."""
        return SerpApiClient(api_key="test_key")

    @pytest.fixture
    def known_citation(self) -> Citation:
        """Citation với title nổi tiếng."""
        return Citation(
            raw_text="Vaswani et al. (2017)",
            title="Attention Is All You Need",
            authors=["Vaswani", "Shazeer"],
            year="2017",
        )

    @pytest.fixture
    def obscure_citation(self) -> Citation:
        """Citation obscure - để test fallback."""
        return Citation(
            raw_text="Smith (2021)",
            title="Novel Research Methods for Complex Systems",
            authors=["Smith"],
            year="2021",
        )

    def test_client_init_explicit_key_isolation(self, client: SerpApiClient) -> None:
        """Explicit `api_key` isolates client from ambient SERPER_API_KEY in .env."""
        assert client.api_key == "test_key"
        assert client.serper_api_key == ""
        assert client.name == "serpapi"
        assert client.timeout == 30.0

    def test_build_search_query_with_title(self, client: SerpApiClient, known_citation: Citation) -> None:
        """Test query building với title."""
        query = client._build_search_query(known_citation)
        assert "Attention Is All You Need" in query
        assert len(query) <= 300

    def test_build_search_query_without_title(self, client: SerpApiClient) -> None:
        """Test query building khi không có title."""
        citation = Citation(raw_text="Unknown paper", authors=[], year=None)
        query = client._build_search_query(citation)
        assert query == "Unknown paper"[:300]

    def test_build_search_query_empty(self, client: SerpApiClient) -> None:
        """Test query building khi không có gì."""
        citation = Citation(raw_text="", authors=[], year=None)
        query = client._build_search_query(citation)
        assert query == ""

    @pytest.mark.asyncio
    async def test_lookup_without_api_key(self) -> None:
        """Test lookup khi cả 2 API key đều rỗng."""
        client = SerpApiClient(serper_api_key="", api_key="")
        citation = Citation(raw_text="Test citation", title="Some Title", authors=["Author"])

        result = await client.lookup(citation)

        assert result.source_name == "serpapi"
        assert result.found is False
        assert "no api key" in (result.error or "").lower()

    @pytest.mark.asyncio
    async def test_lookup_empty_query(self, client: SerpApiClient) -> None:
        """Test lookup với empty query."""
        citation = Citation(raw_text="", authors=[], year=None)

        result = await client.lookup(citation)

        assert result.found is False
        assert "no title or author" in (result.error or "").lower()

    @pytest.mark.asyncio
    async def test_lookup_known_paper_mocked(
        self,
        client: SerpApiClient,
        known_citation: Citation,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Deterministic unit test for lookup() parsing when SerpApi returns an organic result."""
        monkeypatch.setattr(
            client,
            "_sync_search",
            lambda query, year=None, title_query=True: {
                "title": "Attention Is All You Need",
                "result_id": "vaswani2017",
                "snippet": "The dominant sequence transduction models are based on complex recurrent or convolutional neural networks (2017).",
                "publication_info": {
                    "summary": "A Vaswani, N Shazeer - Advances in neural information processing systems, 2017",
                    "authors": [{"name": "A Vaswani"}, {"name": "N Shazeer"}],
                },
                "cited_by": {"total": 120000},
                "links": [{"link": "https://arxiv.org/abs/1706.03762"}],
            },
        )
        result = await client.lookup(known_citation)
        assert result.found is True
        assert result.source_name == "serpapi"
        assert result.title == "Attention Is All You Need"
        assert result.confidence == 0.5
        assert len(result.authors) == 2
        assert result.external_ids.get("scholar_provider") == "serpapi"

    @pytest.mark.asyncio
    async def test_quota_circuit_breaker_does_not_poison_negative_cache(
        self,
        client: SerpApiClient,
        known_citation: Citation,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Quota exhaustion must trip circuit breaker cleanly without caching paper as non-existent."""

        def _trip_quota(query: str, year: str | None = None, title_query: bool = True):
            SerpApiClient._quota_exhausted = True
            return None

        monkeypatch.setattr(client, "_sync_search", _trip_quota)
        result = await client.lookup(known_citation)
        assert result.found is False
        assert "quota exhausted" in (result.error or "").lower()
        assert len(SerpApiClient._negative_query_cache) == 0

    @pytest.mark.asyncio
    @pytest.mark.integration
    @requires_serpapi_key
    async def test_lookup_known_paper(self) -> None:
        """Integration test với paper nổi tiếng (bỏ qua nếu tài khoản hết quota tháng)."""
        client = SerpApiClient(api_key=SERPAPI_KEY)
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
        assert result.title is not None
        assert "attention" in result.title.lower()
        assert result.confidence == 0.5
        assert len(result.authors) > 0

    @pytest.mark.asyncio
    @pytest.mark.integration
    @requires_serpapi_key
    async def test_lookup_obscure_paper(self) -> None:
        """Integration test với paper ít known."""
        client = SerpApiClient(api_key=SERPAPI_KEY)
        citation = Citation(
            raw_text="Smith (2021)",
            title="Novel Research Methods for Complex Systems Analysis XYZ123",
            authors=["Smith"],
            year="2021",
        )

        result = await client.lookup(citation)

        assert result.source_name == "serpapi"
        assert result.found in [True, False]

    def test_result_to_candidate_structure(self) -> None:
        """Test _result_to_candidate tạo đúng structure."""
        mock_result = {
            "title": "Test Paper",
            "result_id": "abc123",
            "snippet": "This is a test paper published in 2023 with sufficient abstract length.",
            "publication_info": {
                "summary": "J Smith, A Jones - 2023 - Nature",
                "authors": [
                    {"name": "J Smith"},
                    {"name": "A Jones"},
                ],
            },
            "cited_by": {"total": 42},
            "links": [{"link": "https://example.com/paper"}],
            "serpapi_cite_link": "https://serpapi.com/cite",
        }

        candidate = SerpApiClient._result_to_candidate(mock_result)

        assert candidate.found is True
        assert candidate.source_name == "serpapi"
        assert candidate.title == "Test Paper"
        assert candidate.authors == ["J Smith", "A Jones"]
        assert candidate.year == "2023"
        assert candidate.confidence == 0.5
        assert candidate.external_ids["scholar_provider"] == "serpapi"
        assert candidate.external_ids["serpapi_result_id"] == "abc123"
        assert candidate.external_ids["citation_count"] == "42"

    def test_result_to_candidate_missing_fields(self) -> None:
        """Test _result_to_candidate với missing fields."""
        mock_result = {
            "title": "Minimal Paper",
        }

        candidate = SerpApiClient._result_to_candidate(mock_result)

        assert candidate.found is True
        assert candidate.title == "Minimal Paper"
        assert candidate.authors == []
        assert candidate.year is None
        assert candidate.confidence == 0.5


class TestGoogleScholarFallbackRouter:
    """Comprehensive tests for `GoogleScholarFallbackClient` (Serper.dev `/scholar` -> SerpApi)."""

    @pytest.fixture(autouse=True)
    def reset_router_state(self):
        SerpApiClient.reset_circuit_breakers()
        yield
        SerpApiClient.reset_circuit_breakers()

    @pytest.fixture
    def citation(self) -> Citation:
        return Citation(
            raw_text="Vaswani, A., Shazeer, N., et al. (2017). Attention Is All You Need. NeurIPS.",
            title="Attention Is All You Need",
            authors=["Vaswani", "Shazeer"],
            year="2017",
        )

    @pytest.mark.asyncio
    async def test_serper_primary_hit_skips_serpapi_completely(
        self,
        citation: Citation,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """When Serper `/scholar` returns a valid match, SerpApi is never called."""
        router = GoogleScholarFallbackClient(
            serper_api_key="serper-key-123",
            api_key="serpapi-key-456",
        )

        serpapi_called = False

        def _fail_if_serpapi_called(*args, **kwargs):
            nonlocal serpapi_called
            serpapi_called = True
            raise AssertionError("SerpApi must NOT be called when Serper primary succeeds")

        monkeypatch.setattr(router, "_sync_search", _fail_if_serpapi_called)

        def handler(req: httpx.Request, body: dict) -> httpx.Response:
            assert str(req.url) == "https://google.serper.dev/scholar"
            assert req.headers.get("x-api-key") == "serper-key-123"
            assert body == {"q": "Attention Is All You Need"}
            return httpx.Response(
                200,
                json={
                    "organic": [
                        {
                            "id": "serper_vaswani_17",
                            "title": "Attention is all you need",
                            "publicationInfo": "A Vaswani, N Shazeer, N Parmar… - Advances in neural information processing systems, 2017 - proceedings.neurips.cc",
                            "snippet": "The dominant sequence transduction models are based on complex recurrent or convolutional neural networks.",
                            "year": 2017,
                            "citedBy": 135000,
                            "pdfUrl": "https://proceedings.neurips.cc/paper/7181-attention-is-all-you-need.pdf",
                        }
                    ]
                },
            )

        with _patch_httpx_post(handler):
            cand = await router.lookup(citation)

        assert serpapi_called is False
        assert cand.found is True
        assert cand.source_name == "serpapi"  # Preserves UI & DB contract ("Google Scholar")
        assert cand.external_ids["scholar_provider"] == "serper"
        assert cand.external_ids["serpapi_result_id"] == "serper_vaswani_17"
        assert cand.external_ids["citation_count"] == "135000"
        assert cand.year == "2017"
        assert cand.authors == ["A Vaswani", "N Shazeer", "N Parmar"]
        assert cand.url == "https://proceedings.neurips.cc/paper/7181-attention-is-all-you-need.pdf"
        assert cand.abstract is not None and "sequence transduction" in cand.abstract
        assert cand.confidence == 0.5

    @pytest.mark.asyncio
    async def test_serper_filters_year_and_selects_best_title_match(
        self,
        citation: Citation,
    ) -> None:
        """Serper filters out wrong-year entries (> ±1 yr) and selects highest title similarity."""
        router = GoogleScholarFallbackClient(serper_api_key="serper-only-key")

        def handler(req: httpx.Request, body: dict) -> httpx.Response:
            return httpx.Response(
                200,
                json={
                    "organic": [
                        {
                            "title": "Attention Is All You Need: A Retrospective Survey",
                            "publicationInfo": "J Doe - ACM Computing Surveys, 2023",
                            "year": 2023,
                        },
                        {
                            "title": "Persuasion: Theory and research",
                            "publicationInfo": "DJ O'Keefe - 2016 - books.google.com",
                            "year": 2016,
                        },
                        {
                            "title": "Attention Is All You Need",
                            "publicationInfo": "A Vaswani, N Shazeer - NeurIPS, 2017",
                            "year": 2017,
                            "link": "https://arxiv.org/abs/1706.03762",
                        },
                    ]
                },
            )

        with _patch_httpx_post(handler):
            cand = await router.lookup(citation)

        assert cand.found is True
        assert cand.title == "Attention Is All You Need"
        assert cand.year == "2017"

    @pytest.mark.asyncio
    async def test_serper_clean_200_empty_caches_negative_without_calling_serpapi(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Clean HTTP 200 empty response from Serper caches negative query and does NOT waste SerpApi quota."""
        router = GoogleScholarFallbackClient(
            serper_api_key="serper-key",
            api_key="serpapi-key",
        )
        fake_cit = Citation(
            raw_text="Fake Author (2023). Totally Fabricated Quantum Paper XYZ999.",
            title="Totally Fabricated Quantum Paper XYZ999",
            authors=["Fake Author"],
            year="2023",
        )

        serper_calls = 0

        def handler(req: httpx.Request, body: dict) -> httpx.Response:
            nonlocal serper_calls
            serper_calls += 1
            return httpx.Response(200, json={"organic": []})

        monkeypatch.setattr(
            router,
            "_sync_search",
            lambda *a, **kw: (_ for _ in ()).throw(AssertionError("SerpApi must not be called on clean 0-hit")),
        )

        with _patch_httpx_post(handler):
            res1 = await router.lookup(fake_cit)
            res2 = await router.lookup(fake_cit)

        assert res1.found is False
        assert "no results" in (res1.error or "").lower()
        assert serper_calls == 1  # Second call served from negative cache!
        assert res2.found is False
        assert "cached negative" in (res2.error or "").lower()

    @pytest.mark.asyncio
    async def test_serper_clean_200_title_mismatch_caches_negative_without_calling_serpapi(
        self,
        citation: Citation,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Clean HTTP 200 with unrelated Scholar fuzzy hit records negative cache and skips SerpApi."""
        router = GoogleScholarFallbackClient(
            serper_api_key="serper-key",
            api_key="serpapi-key",
        )
        monkeypatch.setattr(
            router,
            "_sync_search",
            lambda *a, **kw: (_ for _ in ()).throw(AssertionError("SerpApi must not be called on clean mismatch")),
        )

        def handler(req: httpx.Request, body: dict) -> httpx.Response:
            return httpx.Response(
                200,
                json={
                    "organic": [
                        {
                            "title": "Agricultural Soil Irrigation Patterns in Tropical River Basins",
                            "publicationInfo": "B Tran - Journal of Agronomy, 2017",
                            "year": 2017,
                        }
                    ]
                },
            )

        with _patch_httpx_post(handler):
            res = await router.lookup(citation)

        assert res.found is False
        assert "no title match" in (res.error or "").lower()
        assert len(SerpApiClient._negative_query_cache) == 1

    @pytest.mark.asyncio
    async def test_serper_out_of_credits_trips_breaker_and_seamlessly_falls_back_to_serpapi(
        self,
        citation: Citation,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """HTTP 400 'Not enough credits' on Serper trips `_serper_quota_exhausted` and falls back to SerpApi."""
        router = GoogleScholarFallbackClient(
            serper_api_key="exhausted-serper-key",
            api_key="backup-serpapi-key",
        )

        serper_http_calls = 0

        def handler(req: httpx.Request, body: dict) -> httpx.Response:
            nonlocal serper_http_calls
            serper_http_calls += 1
            return httpx.Response(400, json={"message": "Not enough credits", "statusCode": 400})

        serpapi_calls = 0

        def _mock_serpapi_sync(query: str, year: str | None = None, title_query: bool = True):
            nonlocal serpapi_calls
            serpapi_calls += 1
            return {
                "title": "Attention Is All You Need",
                "result_id": "serpapi_fallback_hit",
                "snippet": "The dominant sequence transduction models are based on attention mechanisms (2017).",
                "publication_info": {
                    "summary": "A Vaswani, N Shazeer - NeurIPS, 2017",
                    "authors": [{"name": "A Vaswani"}, {"name": "N Shazeer"}],
                },
                "cited_by": {"total": 120000},
                "links": [{"link": "https://arxiv.org/abs/1706.03762"}],
            }

        monkeypatch.setattr(router, "_sync_search", _mock_serpapi_sync)

        other_citation = Citation(
            raw_text="Devlin et al. (2019). Attention Is All You Need.",
            title="Attention Is All You Need",
            authors=["Vaswani"],
            year="2018",
        )

        with _patch_httpx_post(handler):
            first = await router.lookup(citation)
            second = await router.lookup(other_citation)

        assert SerpApiClient._serper_quota_exhausted is True
        assert SerpApiClient._quota_exhausted is False
        assert serper_http_calls == 1  # Second lookup bypassed Serper completely!
        assert serpapi_calls == 2
        assert first.found is True
        assert first.source_name == "serpapi"
        assert first.external_ids["scholar_provider"] == "serpapi"
        assert second.found is True

    @pytest.mark.asyncio
    async def test_serper_transient_500_retries_then_falls_back_without_tripping_permanent_breaker(
        self,
        citation: Citation,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Transient HTTP 500 retries on Serper, leaves `_serper_quota_exhausted=False`, and falls back to SerpApi."""
        router = GoogleScholarFallbackClient(
            serper_api_key="serper-key",
            api_key="serpapi-key",
            max_retries=2,
        )
        router._backoff.initial_seconds = 0.01
        router._backoff.max_seconds = 0.02

        serper_attempts = 0

        def handler(req: httpx.Request, body: dict) -> httpx.Response:
            nonlocal serper_attempts
            serper_attempts += 1
            return httpx.Response(503, json={"message": "Service temporarily unavailable"})

        monkeypatch.setattr(
            router,
            "_sync_search",
            lambda query, year=None, title_query=True: {
                "title": "Attention Is All You Need",
                "result_id": "rescued_by_serpapi",
                "publication_info": {"authors": [{"name": "A Vaswani"}]},
            },
        )

        with _patch_httpx_post(handler):
            cand = await router.lookup(citation)

        assert serper_attempts == 2
        assert SerpApiClient._serper_quota_exhausted is False
        assert cand.found is True
        assert cand.external_ids["scholar_provider"] == "serpapi"

    @pytest.mark.asyncio
    async def test_serper_only_key_exhausted_returns_circuit_breaker_error_cleanly(
        self,
        citation: Citation,
    ) -> None:
        """When only SERPER_API_KEY is configured and runs out of credits, returns quota exhausted cleanly."""
        router = GoogleScholarFallbackClient(serper_api_key="serper-only", api_key="")

        def handler(req: httpx.Request, body: dict) -> httpx.Response:
            return httpx.Response(403, json={"message": "Unauthorized or Invalid API Key"})

        with _patch_httpx_post(handler):
            res = await router.lookup(citation)

        assert res.found is False
        assert SerpApiClient._serper_quota_exhausted is True
        assert "quota exhausted" in (res.error or "").lower()
        assert len(SerpApiClient._negative_query_cache) == 0

    def test_default_constructor_loads_both_env_keys(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Default constructor (no args) loads both SERPER_API_KEY and SERPAPI_API_KEY from environment."""
        monkeypatch.setenv("SERPER_API_KEY", "env-serper-111")
        monkeypatch.setenv("SERPAPI_API_KEY", "env-serpapi-222")

        router = GoogleScholarFallbackClient()
        assert router.serper_api_key == "env-serper-111"
        assert router.api_key == "env-serpapi-222"

    def test_parse_publication_authors_strips_ellipsis_and_domains(self) -> None:
        """Verify Google Scholar author summary parser strips `…`, `...`, years, and domain tokens."""
        authors = GoogleScholarFallbackClient._parse_publication_authors(
            "A Vaswani, N Shazeer, N Parmar… - NeurIPS, 2017 - arxiv.org"
        )
        assert authors == ["A Vaswani", "N Shazeer", "N Parmar"]

        authors_no_dash = GoogleScholarFallbackClient._parse_publication_authors(
            "aclanthology.org, 2020, J Devlin and MW Chang..."
        )
        assert authors_no_dash == ["J Devlin", "MW Chang"]
