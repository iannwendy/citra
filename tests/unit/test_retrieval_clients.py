"""Unit tests cho core retrieval HTTP clients (Crossref, OpenAlex).

Mock HTTP responses via httpx.MockTransport để tránh gọi API thật.
Reference: v1.2 §3.6 — tuần 8.
"""

from __future__ import annotations

from unittest.mock import patch

import httpx
import pytest

from integrity_checker.matching.author_parser import Author
from integrity_checker.models.citation import Citation
from integrity_checker.retrieval.crossref_client import CrossrefClient
from integrity_checker.retrieval.openalex_client import OpenAlexClient

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
    """Test abstract extraction and deduplication across active clients."""

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

    def test_serper_scholar_extracts_snippet_abstract(self):
        from integrity_checker.retrieval.serpapi_client import GoogleScholarFallbackClient

        cand = GoogleScholarFallbackClient._serper_result_to_candidate(
            {
                "title": "BERT: Pre-training of Deep Bidirectional Transformers",
                "publicationInfo": "J Devlin, MW Chang, K Lee - NAACL, 2019 - aclanthology.org",
                "year": 2019,
                "snippet": "We introduce a new language representation model called BERT.",
                "link": "https://aclanthology.org/N19-1423/",
            }
        )
        assert cand.abstract == "We introduce a new language representation model called BERT."

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
        c_openalex = SourceCandidate(
            source_name="openalex",
            found=True,
            doi="10.1038/nature14539",
            title="Deep learning",
            confidence=0.85,
            abstract="Deep learning allows computational models that are composed of multiple processing layers.",
        )
        deduped = RetrievalOrchestrator._dedupe_candidates([c_crossref, c_openalex])
        assert len(deduped) == 1
        assert deduped[0].source_name == "crossref"
        assert deduped[0].abstract == c_openalex.abstract
