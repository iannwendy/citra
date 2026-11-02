"""Unit tests cho 4 retrieval HTTP clients (Crossref, OpenAlex, S2, CoreAPI).

Mock HTTP responses via httpx.MockTransport để tránh gọi API thật.
Reference: v1.2 §3.6 — tuần 8.
"""

from __future__ import annotations

from unittest.mock import patch

import httpx
import pytest

from integrity_checker.matching.author_parser import Author
from integrity_checker.models.citation import Citation
from integrity_checker.retrieval.coreapi_client import CoreAPIClient
from integrity_checker.retrieval.crossref_client import CrossrefClient
from integrity_checker.retrieval.openalex_client import OpenAlexClient
from integrity_checker.retrieval.semantic_scholar_client import SemanticScholarClient

# ---------- Mock helpers ----------

def _patch_httpx(handler):
    """Patch httpx.AsyncClient.get để trả mock response.

    Strategy: patch `httpx.AsyncClient.get` thay vì patch AsyncClient constructor
    (patching constructor gây infinite recursion trong venv). Handler nhận URL,
    trả httpx.Response.

    Handler signature: handler(request: httpx.Request, **kwargs) -> httpx.Response
    Headers và params từ kwargs được set trên Request trước khi gọi handler.
    """
    async def mock_get(self, url, **kwargs):
        # Build Request với headers từ kwargs
        headers = kwargs.get("headers") or {}
        params = kwargs.get("params") or {}
        req = httpx.Request("GET", url, headers=headers, params=params)
        return handler(req)
    return patch.object(httpx.AsyncClient, "get", mock_get)


def _make_citation(**kwargs) -> Citation:
    """Helper build Citation cho test."""
    defaults = dict(
        raw_text="Smith, J. (2020). A study of X. Journal A, 10, 1-10.",
        title="A study of X",
        year="2020",
        doi=None,
        url=None,
    )
    defaults.update(kwargs)
    return Citation(**defaults)


# ============================================================
# Crossref tests
# ============================================================

class TestCrossrefClient:
    """Test CrossrefClient với mocked HTTP."""

    @pytest.fixture
    def client(self):
        return CrossrefClient(contact_email="test@example.com")

    @pytest.mark.asyncio
    async def test_lookup_by_doi_success(self, client):
        """DOI exact lookup trả về candidate với confidence=1.0."""
        def handler(request: httpx.Request) -> httpx.Response:
            assert "/works/" in str(request.url)
            return httpx.Response(
                200,
                json={
                    "status": "ok",
                    "message": {
                        "DOI": "10.1234/abc",
                        "title": ["A study of X"],
                        "author": [
                            {"given": "John", "family": "Smith"}
                        ],
                        "published-print": {"date-parts": [[2020]]},
                        "container-title": ["Journal A"],
                        "URL": "https://example.com/paper",
                    },
                },
            )

        with _patch_httpx(handler):
            cit = _make_citation(doi="10.1234/abc")
            result = await client.lookup(cit)

        assert result.found is True
        assert result.confidence == 1.0
        assert result.doi == "10.1234/abc"
        assert result.title == "A study of X"
        assert result.authors == ["John Smith"]
        assert result.year == "2020"
        assert result.venue == "Journal A"

    @pytest.mark.asyncio
    async def test_lookup_doi_not_found_falls_back_to_bibliographic(self, client):
        """DOI 404 → fallback bibliographic search."""
        call_count = {"n": 0}

        def handler(request: httpx.Request) -> httpx.Response:
            call_count["n"] += 1
            url = str(request.url)
            if "/works/10.1234" in url:
                return httpx.Response(404, json={"status": "not_found"})
            return httpx.Response(
                200,
                json={
                    "status": "ok",
                    "message": {
                        "items": [
                            {
                                "DOI": "10.1234/abc",
                                "title": ["A study of X"],
                                "author": [{"given": "J.", "family": "Smith"}],
                                "published-print": {"date-parts": [[2020]]},
                                "container-title": ["Journal A"],
                                "score": 95.0,
                            }
                        ]
                    },
                },
            )

        with _patch_httpx(handler):
            cit = _make_citation(doi="10.1234/abc")
            cit.authors = [
                Author(last_name="Smith", initials=["j"],
                       full_first_names=[], normalized="smith|j", raw="Smith, J.")
            ]
            result = await client.lookup(cit)

        assert result.found is True
        # 95 score → 0.95 confidence
        assert 0.9 < result.confidence <= 1.0
        assert call_count["n"] >= 2  # DOI 404 + fallback

    def test_normalize_doi(self, client):
        """_normalize_doi lowercase + strip 'doi:' + strip trailing period."""
        assert client._normalize_doi("DOI:10.1234/ABC.") == "10.1234/abc"
        assert client._normalize_doi("10.1234/abc") == "10.1234/abc"

    def test_message_to_candidate_minimal(self, client):
        """_message_to_candidate handles missing fields gracefully."""
        cand = client._message_to_candidate({})
        assert cand.doi is None
        assert cand.title is None
        assert cand.authors == []


# ============================================================
# OpenAlex tests
# ============================================================

class TestOpenAlexClient:
    """Test OpenAlexClient với mocked HTTP."""

    @pytest.fixture
    def client(self):
        return OpenAlexClient(contact_email="test@example.com")

    @pytest.mark.asyncio
    async def test_lookup_by_doi_success(self, client):
        """DOI lookup qua /works/doi:{doi}."""
        def handler(request: httpx.Request) -> httpx.Response:
            assert "/works/doi:10.1234/abc" in str(request.url)
            return httpx.Response(
                200,
                json={
                    "id": "https://openalex.org/W123",
                    "doi": "https://doi.org/10.1234/abc",
                    "title": "A study of X",
                    "authorships": [
                        {"author": {"display_name": "John Smith"}}
                    ],
                    "publication_year": 2020,
                    "primary_location": {
                        "source": {"display_name": "Journal A"}
                    },
                },
            )

        with _patch_httpx(handler):
            cit = _make_citation(doi="10.1234/abc")
            result = await client.lookup(cit)

        assert result.found is True
        assert result.doi == "10.1234/abc"  # stripped https://doi.org/
        assert result.title == "A study of X"
        assert result.authors == ["John Smith"]
        assert result.year == "2020"
        assert result.venue == "Journal A"

    @pytest.mark.asyncio
    async def test_lookup_by_search_with_year_filter(self, client):
        """Search fallback với publication_year filter."""
        captured_params = {}

        def handler(request: httpx.Request) -> httpx.Response:
            captured_params.update(dict(request.url.params))
            return httpx.Response(
                200,
                json={
                    "results": [
                        {
                            "id": "https://openalex.org/W123",
                            "title": "A study of X",
                            "authorships": [],
                            "publication_year": 2020,
                            "relevance_score": 150.0,
                        }
                    ]
                },
            )

        with _patch_httpx(handler):
            cit = _make_citation(doi=None, title="A study of X", year="2020")
            result = await client.lookup(cit)

        assert result.found is True
        # 150 relevance → cap at 1.0
        assert result.confidence == 1.0
        assert captured_params.get("filter") == "publication_year:2020"

    @pytest.mark.asyncio
    async def test_no_title_no_doi(self, client):
        """Citation không có title + DOI → trả found=False với error message."""
        cit = _make_citation(title=None, doi=None)
        result = await client.lookup(cit)
        assert result.found is False
        assert "no title" in result.error


# ============================================================
# Semantic Scholar tests
# ============================================================

class TestSemanticScholarClient:
    """Test SemanticScholarClient với mocked HTTP."""

    @pytest.fixture
    def client(self):
        return SemanticScholarClient(api_key="test-key")

    @pytest.mark.asyncio
    async def test_lookup_by_doi(self, client):
        """DOI exact lookup qua /paper/DOI:{doi}."""
        def handler(request: httpx.Request) -> httpx.Response:
            assert "/paper/DOI:10.1234/abc" in str(request.url)
            assert request.headers.get("x-api-key") == "test-key"
            return httpx.Response(
                200,
                json={
                    "paperId": "abc123",
                    "title": "A study of X",
                    "authors": [{"name": "John Smith"}],
                    "year": 2020,
                    "venue": "Journal A",
                    "externalIds": {"DOI": "10.1234/abc"},
                    "url": "https://semanticscholar.org/paper/abc123",
                },
            )

        with _patch_httpx(handler):
            cit = _make_citation(doi="10.1234/abc")
            result = await client.lookup(cit)

        assert result.found is True
        assert result.confidence == 1.0
        assert result.doi == "10.1234/abc"
        assert result.external_ids.get("DOI") == "10.1234/abc"

    def test_extract_arxiv_id_from_url(self, client):
        """arXiv ID extraction từ URL, DOI, và raw_text."""
        assert client._extract_arxiv_id(_make_citation(
            url="https://arxiv.org/abs/2106.12345"
        )) == "2106.12345"
        # Version suffix stripped
        assert client._extract_arxiv_id(_make_citation(
            url="https://arxiv.org/abs/2106.12345v2"
        )) == "2106.12345"
        # pdf URL
        assert client._extract_arxiv_id(_make_citation(
            url="https://arxiv.org/pdf/2106.12345.pdf"
        )) == "2106.12345"
        # DataCite arXiv DOI
        assert client._extract_arxiv_id(_make_citation(
            doi="10.48550/arXiv.1706.03762"
        )) == "1706.03762"
        # raw_text with arXiv ID
        assert client._extract_arxiv_id(_make_citation(
            raw_text="Devlin et al. (2019). BERT. arXiv:1810.04805."
        )) == "1810.04805"
        # No arXiv
        assert client._extract_arxiv_id(_make_citation(
            url="https://example.com/paper"
        )) is None

    @pytest.mark.asyncio
    async def test_arxiv_doi_uses_arxiv_endpoint_directly(self, client):
        """10.48550/arXiv.* DOI skips /paper/DOI: and calls /paper/ARXIV:{id}."""
        called_urls: list[str] = []

        def handler(request: httpx.Request) -> httpx.Response:
            called_urls.append(str(request.url))
            assert "/paper/ARXIV:1706.03762" in str(request.url)
            return httpx.Response(
                200,
                json={
                    "paperId": "204e3073870fae3d05bcbc2f6a8e263d9b72e776",
                    "title": "Attention is All you Need",
                    "authors": [{"name": "Ashish Vaswani"}],
                    "year": 2017,
                    "venue": "Neural Information Processing Systems",
                    "externalIds": {"ArXiv": "1706.03762"},
                    "url": "https://www.semanticscholar.org/paper/204e3073870fae3d05bcbc2f6a8e263d9b72e776",
                },
            )

        with _patch_httpx(handler):
            cit = _make_citation(
                doi="10.48550/arXiv.1706.03762",
                title="Attention Is All You Need",
            )
            result = await client.lookup(cit)

        assert len(called_urls) == 1
        assert result.found is True
        assert result.confidence == 1.0
        assert result.doi == "10.48550/arxiv.1706.03762"
        assert result.external_ids.get("arxiv") == "1706.03762"


# ============================================================
# CoreAPI tests
# ============================================================

class TestCoreAPIClient:
    """Test CoreAPIClient với mocked HTTP."""

    @pytest.fixture
    def client(self):
        return CoreAPIClient(api_key="test-key", contact_email="test@example.com")

    @pytest.mark.asyncio
    async def test_lookup_by_doi_success(self, client):
        """DOI exact lookup trả về candidate với confidence=1.0."""
        def handler(request: httpx.Request) -> httpx.Response:
            url_str = str(request.url)
            assert "/search/works/" in url_str
            # doi: gets URL-encoded as doi%3A in the query string
            assert "doi%3A" in url_str or "doi:" in url_str
            return httpx.Response(
                200,
                json={
                    "totalHits": 1,
                    "results": [
                        {
                            "id": 148303725,
                            "title": "Attention Is All You Need",
                            "doi": "10.48550/arXiv.1706.03762",
                            "authors": [{"name": "Vaswani"}],
                            "yearPublished": 2017,
                            "journals": [{"title": "NeurIPS"}],
                            "downloadUrl": "https://arxiv.org/abs/1706.03762",
                        }
                    ],
                },
            )

        with _patch_httpx(handler):
            cit = _make_citation(doi="10.48550/arXiv.1706.03762")
            result = await client.lookup(cit)

        assert result.found is True
        assert result.confidence == 1.0
        assert result.title == "Attention Is All You Need"
        assert result.year == "2017"
        assert result.venue == "NeurIPS"

    @pytest.mark.asyncio
    async def test_lookup_by_title(self, client):
        """Title search fallback."""
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(
                200,
                json={
                    "totalHits": 1,
                    "results": [
                        {
                            "title": "BERT: Pre-training of Deep Bidirectional Transformers",
                            "doi": "10.48550/arXiv.1810.04805",
                            "authors": [{"name": "Devlin"}],
                            "yearPublished": 2018,
                        }
                    ],
                },
            )

        with _patch_httpx(handler):
            cit = _make_citation(title="BERT Pre-training")
            result = await client.lookup(cit)

        assert result.found is True
        assert result.confidence == 0.7  # Search match

    @pytest.mark.asyncio
    async def test_lookup_by_title_rejects_unrelated_result(self, client):
        """Unrelated search hit with low title similarity returns found=False."""
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(
                200,
                json={
                    "totalHits": 1,
                    "results": [
                        {
                            "title": "Completely Unrelated Agricultural Survey in Brazil",
                            "doi": "10.1000/unrelated",
                            "authors": [{"name": "Other Author"}],
                            "yearPublished": 2020,
                        }
                    ],
                },
            )

        with _patch_httpx(handler):
            cit = _make_citation(title="Deep Residual Learning for Image Recognition")
            result = await client.lookup(cit)

        assert result.found is False
        assert "no title match" in (result.error or "")

    def test_sanitize_query_removes_lucene_special_chars(self, client):
        """_sanitize_query strips colons and hyphens that cause CORE API 500 errors."""
        q = client._sanitize_query("RoBERTa: A Robustly Optimized BERT Pretraining Approach (Low-Rank)")
        assert ":" not in q
        assert "-" not in q
        assert "(" not in q
        assert "RoBERTa" in q
        assert "Low Rank" in q

    def test_normalize_doi(self, client):
        """_normalize_doi handles various DOI formats."""
        assert client._normalize_doi("10.1234/ABC") == "10.1234/abc"
        assert client._normalize_doi("doi:10.1234/abc") == "10.1234/abc"
        assert client._normalize_doi("https://doi.org/10.1234/abc") == "10.1234/abc"

    @pytest.mark.asyncio
    async def test_no_results(self, client):
        """No results returns found=False."""
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(
                200,
                json={"total": 0, "results": []},
            )

        with _patch_httpx(handler):
            cit = _make_citation(title="Nonexistent Paper Title XYZ123")
            result = await client.lookup(cit)

        assert result.found is False
        assert "no results" in result.error


# ============================================================
# Integration: error handling
# ============================================================

class TestRetryBehavior:
    """Test retry + exponential backoff behavior."""

    @pytest.mark.asyncio
    async def test_crossref_404_returns_none(self):
        """404 → trả None (không retry)."""
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(404)

        client = CrossrefClient()
        with _patch_httpx(handler):
            cit = _make_citation(doi="10.1234/missing")
            result = await client.lookup(cit)

        assert result.found is False
        # Có error message
        assert result.error is not None


class TestClientAbstractExtraction:
    """Test abstract extraction and deduplication across all 4 clients (Phase 2)."""

    def test_crossref_strips_jats_xml_from_abstract(self):
        cand = CrossrefClient._message_to_candidate(
            {
                "DOI": "10.1038/nature14539",
                "title": ["Deep learning"],
                "abstract": "<jats:p>Deep learning allows computational models to learn representations.</jats:p>",
            }
        )
        assert cand.abstract == "Deep learning allows computational models to learn representations."

    def test_openalex_reconstructs_abstract_from_inverted_index(self):
        cand = OpenAlexClient._work_to_candidate(
            {
                "doi": "https://doi.org/10.48550/arXiv.1706.03762",
                "title": "Attention Is All You Need",
                "abstract_inverted_index": {
                    "The": [0],
                    "dominant": [1],
                    "sequence": [2],
                    "transduction": [3],
                    "models": [4],
                },
            }
        )
        assert cand.abstract == "The dominant sequence transduction models"

    def test_semantic_scholar_extracts_abstract(self):
        cand = SemanticScholarClient._paper_to_candidate(
            {
                "title": "BERT",
                "abstract": "We introduce a new language representation model called BERT.",
                "externalIds": {"DOI": "10.18653/v1/N19-1423"},
            }
        )
        assert cand.abstract == "We introduce a new language representation model called BERT."

    def test_coreapi_extracts_abstract(self):
        cand = CoreAPIClient._work_to_candidate(
            {
                "title": "RoBERTa",
                "abstract": "Language model pretraining has led to significant performance gains.",
                "doi": "10.48550/arXiv.1907.11692",
            }
        )
        assert cand.abstract == "Language model pretraining has led to significant performance gains."

    def test_dedupe_candidates_preserves_abstract_when_merging_doi(self):
        from integrity_checker.models.source import SourceCandidate
        from integrity_checker.retrieval.retrieval_orchestrator import RetrievalOrchestrator

        c_crossref = SourceCandidate(
            source_name="crossref",
            found=True,
            doi="10.1038/nature14539",
            title="Deep learning",
            confidence=0.95,
            abstract=None,
        )
        c_s2 = SourceCandidate(
            source_name="semantic_scholar",
            found=True,
            doi="10.1038/nature14539",
            title="Deep learning",
            confidence=0.85,
            abstract="Deep learning allows computational models that are composed of multiple processing layers.",
        )
        deduped = RetrievalOrchestrator._dedupe_candidates([c_crossref, c_s2])
        assert len(deduped) == 1
        assert deduped[0].source_name == "crossref"
        assert deduped[0].abstract == c_s2.abstract
