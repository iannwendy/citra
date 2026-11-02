"""Unit tests cho 4 scholarly/book API clients mới:
- DBLPClient (dblp.org)
- ArxivClient (export.arxiv.org)
- OpenLibraryClient (openlibrary.org + Google Books fallback)
- EuropePMCClient (ebi.ac.uk/europepmc)
"""

from __future__ import annotations

from unittest.mock import patch

import httpx
import pytest

from integrity_checker.models.citation import Citation
from integrity_checker.retrieval.arxiv_client import ArxivClient
from integrity_checker.retrieval.dblp_client import DBLPClient
from integrity_checker.retrieval.europepmc_client import EuropePMCClient
from integrity_checker.retrieval.openlibrary_client import OpenLibraryClient


def _patch_httpx(handler):
    async def mock_get(self, url, **kwargs):
        headers = kwargs.get("headers") or {}
        params = kwargs.get("params") or {}
        req = httpx.Request("GET", url, headers=headers, params=params)
        return handler(req)

    return patch.object(httpx.AsyncClient, "get", mock_get)


# ============================================================
# 1. DBLPClient Tests
# ============================================================


class TestDBLPClient:
    @pytest.fixture
    def client(self):
        return DBLPClient(contact_email="test@citra.edu.vn")

    @pytest.mark.asyncio
    async def test_dblp_lookup_conference_paper_success(self, client):
        """DBLP resolves CS conference paper, strips trailing period and 4-digit author disambiguation."""
        def handler(request: httpx.Request) -> httpx.Response:
            assert "/search/publ/api" in str(request.url)
            return httpx.Response(
                200,
                json={
                    "result": {
                        "hits": {
                            "hit": [
                                {
                                    "info": {
                                        "title": "Deep Residual Learning for Image Recognition.",
                                        "authors": {
                                            "author": [
                                                {"text": "Kaiming He"},
                                                {"text": "Xiangyu Zhang 0001"},
                                                {"text": "Shaoqing Ren"},
                                                {"text": "Jian Sun 0001"},
                                            ]
                                        },
                                        "venue": "CVPR",
                                        "year": "2016",
                                        "doi": "10.1109/CVPR.2016.90",
                                        "ee": "https://doi.org/10.1109/CVPR.2016.90",
                                        "key": "conf/cvpr/HeZRS16",
                                    }
                                }
                            ]
                        }
                    }
                },
            )

        with _patch_httpx(handler):
            cit = Citation(
                raw_text="He et al. (2016). Deep Residual Learning for Image Recognition. CVPR.",
                title="Deep Residual Learning for Image Recognition",
                authors=["Kaiming He"],
                year="2016",
            )
            res = await client.lookup(cit)

        assert res.found is True
        assert res.source_name == "dblp"
        assert res.title == "Deep Residual Learning for Image Recognition"
        assert res.authors == ["Kaiming He", "Xiangyu Zhang", "Shaoqing Ren", "Jian Sun"]
        assert res.year == "2016"
        assert res.venue == "CVPR"
        assert res.doi == "10.1109/cvpr.2016.90"
        assert res.external_ids.get("dblp_key") == "conf/cvpr/HeZRS16"

    @pytest.mark.asyncio
    async def test_dblp_corr_extracts_arxiv_id(self, client):
        """DBLP CoRR entry with volume='abs/2404.06395' synthesizes arXiv ID and DOI."""
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(
                200,
                json={
                    "result": {
                        "hits": {
                            "hit": {
                                "info": {
                                    "title": "MiniCPM: Unveiling the Potential of Small Language Models.",
                                    "authors": {"author": {"text": "Shengding Hu"}},
                                    "venue": "CoRR",
                                    "volume": "abs/2404.06395",
                                    "year": "2024",
                                    "key": "journals/corr/abs-2404-06395",
                                }
                            }
                        }
                    }
                },
            )

        with _patch_httpx(handler):
            cit = Citation(
                raw_text="Hu, S. (2024). MiniCPM: Unveiling the Potential of Small Language Models.",
                title="MiniCPM: Unveiling the Potential of Small Language Models",
                authors=["Shengding Hu"],
                year="2024",
            )
            res = await client.lookup(cit)

        assert res.found is True
        assert res.external_ids.get("arxiv") == "2404.06395"
        assert res.doi == "10.48550/arxiv.2404.06395"


# ============================================================
# 2. ArxivClient Tests
# ============================================================


SAMPLE_ARXIV_ATOM = """<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom">
  <entry>
    <id>http://arxiv.org/abs/2303.08774v4</id>
    <published>2023-03-15T17:00:00Z</published>
    <title>GPT-4 Technical
      Report</title>
    <summary>We report the development of GPT-4, a large-scale multimodal model.</summary>
    <author><name>OpenAI</name></author>
    <author><name>Josh Achiam</name></author>
  </entry>
</feed>
"""


class TestArxivClient:
    @pytest.fixture
    def client(self):
        return ArxivClient(contact_email="test@citra.edu.vn")

    @pytest.mark.asyncio
    async def test_arxiv_lookup_by_id_from_doi(self, client):
        """ArxivClient extracts arXiv ID from 10.48550/arXiv.* DOI and queries id_list."""
        captured_params = {}

        def handler(request: httpx.Request) -> httpx.Response:
            captured_params.update(dict(request.url.params))
            return httpx.Response(200, text=SAMPLE_ARXIV_ATOM)

        with _patch_httpx(handler):
            cit = Citation(
                raw_text="OpenAI (2023). GPT-4 Technical Report. arXiv:2303.08774.",
                title="GPT-4 Technical Report",
                doi="10.48550/arXiv.2303.08774",
                year="2023",
            )
            res = await client.lookup(cit)

        assert captured_params.get("id_list") == "2303.08774"
        assert res.found is True
        assert res.title == "GPT-4 Technical Report"
        assert res.year == "2023"
        assert res.doi == "10.48550/arxiv.2303.08774"
        assert res.external_ids.get("arxiv") == "2303.08774"
        assert "large-scale multimodal model" in (res.abstract or "")

    @pytest.mark.asyncio
    async def test_arxiv_lookup_by_title_search(self, client):
        """ArxivClient searches by title when no arXiv ID is present."""
        def handler(request: httpx.Request) -> httpx.Response:
            assert "search_query" in dict(request.url.params)
            return httpx.Response(200, text=SAMPLE_ARXIV_ATOM)

        with _patch_httpx(handler):
            cit = Citation(
                raw_text="OpenAI (2023). GPT-4 Technical Report.",
                title="GPT-4 Technical Report",
                authors=["OpenAI"],
                year="2023",
            )
            res = await client.lookup(cit)

        assert res.found is True
        assert res.title == "GPT-4 Technical Report"
        assert res.confidence >= 0.90

    def test_arxiv_build_search_queries_filters_lucene_stopwords_and_deduplicates(self, client):
        """ArxivClient._build_search_queries filters out 'not'/'andnot' and deduplicates tokens."""
        cit = Citation(
            raw_text="Matthew Peters et al. (2019). To Tune or Not to Tune? Adapting Pretrained Representations to Diverse Tasks.",
            title="To Tune or Not to Tune? Adapting Pretrained Representations to Diverse Tasks",
            authors=["Matthew Peters", "Sebastian Ruder", "Noah A. Smith"],
            year="2019",
        )
        queries = client._build_search_queries(cit)
        assert len(queries) == 2
        # Keyword fallback query should not contain ti:Not or duplicate ti:Tune
        kw_query = queries[1]
        assert "ti:Not" not in kw_query
        assert "ti:not" not in kw_query
        assert kw_query.count("ti:Tune") == 1
        assert "au:peters" in kw_query


# ============================================================
# 3. OpenLibraryClient Tests
# ============================================================


class TestOpenLibraryClient:
    @pytest.fixture
    def client(self):
        return OpenLibraryClient(contact_email="test@citra.edu.vn")

    @pytest.mark.asyncio
    async def test_openlibrary_matches_edition_year_and_strips_edition_suffix(self, client):
        """OpenLibrary resolves 'Learning PHP, MySQL & JavaScript, 5th Edition' (2018) using publish_year list."""
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(
                200,
                json={
                    "docs": [
                        {
                            "key": "/works/OL15000000W",
                            "title": "Learning PHP, MySQL & JavaScript",
                            "author_name": ["Robin Nixon"],
                            "first_publish_year": 2009,
                            "publish_year": [2009, 2012, 2014, 2018, 2021],
                            "publisher": ["O'Reilly Media"],
                            "isbn": ["9781491978917"],
                        }
                    ]
                },
            )

        with _patch_httpx(handler):
            cit = Citation(
                raw_text="Robin Nixon (2018). Learning PHP, MySQL & JavaScript, 5th Edition. O'Reilly Media.",
                title="Learning PHP, MySQL & JavaScript, 5th Edition",
                authors=["Robin Nixon"],
                year="2018",
            )
            res = await client.lookup(cit)

        assert res.found is True
        assert res.source_name == "openlibrary"
        assert res.year == "2018"  # Matched 5th edition year from publish_year!
        assert res.authors == ["Robin Nixon"]
        assert res.venue == "O'Reilly Media"
        assert res.external_ids.get("isbn") == "9781491978917"

    @pytest.mark.asyncio
    async def test_openlibrary_falls_back_to_google_books(self, client):
        """When OpenLibrary returns empty docs, OpenLibraryClient falls back to Google Books API."""
        def handler(request: httpx.Request) -> httpx.Response:
            url = str(request.url)
            if "openlibrary.org" in url:
                return httpx.Response(200, json={"docs": []})
            return httpx.Response(
                200,
                json={
                    "items": [
                        {
                            "id": "gb-flanagan-7e",
                            "volumeInfo": {
                                "title": "JavaScript: The Definitive Guide",
                                "authors": ["David Flanagan"],
                                "publishedDate": "2020-05-14",
                                "publisher": "O'Reilly Media",
                                "infoLink": "https://books.google.com/books?id=gb-flanagan-7e",
                                "industryIdentifiers": [
                                    {"type": "ISBN_13", "identifier": "9781491952023"}
                                ],
                            },
                        }
                    ]
                },
            )

        with _patch_httpx(handler):
            cit = Citation(
                raw_text="Flanagan, D. (2020). JavaScript: The Definitive Guide, 7th Edition.",
                title="JavaScript: The Definitive Guide, 7th Edition",
                authors=["David Flanagan"],
                year="2020",
            )
            res = await client.lookup(cit)

        assert res.found is True
        assert res.title == "JavaScript: The Definitive Guide"
        assert res.authors == ["David Flanagan"]
        assert res.year == "2020"
        assert res.external_ids.get("isbn") == "9781491952023"


# ============================================================
# 4. EuropePMCClient Tests
# ============================================================


class TestEuropePMCClient:
    @pytest.fixture
    def client(self):
        return EuropePMCClient(contact_email="test@citra.edu.vn")

    @pytest.mark.asyncio
    async def test_europepmc_lookup_by_doi(self, client):
        """EuropePMC resolves biomedical/psychology paper by DOI with abstract and PMID."""
        def handler(request: httpx.Request) -> httpx.Response:
            assert 'DOI:"10.1046/j.1525-1497.2001.016009606.x"' in str(request.url.params.get("query"))
            return httpx.Response(
                200,
                json={
                    "resultList": {
                        "result": [
                            {
                                "id": "11556941",
                                "pmid": "11556941",
                                "doi": "10.1046/j.1525-1497.2001.016009606.x",
                                "title": "The PHQ-9: validity of a brief depression severity measure.",
                                "authorList": {
                                    "author": [
                                        {"fullName": "Kroenke K"},
                                        {"fullName": "Spitzer RL"},
                                        {"fullName": "Williams JB"},
                                    ]
                                },
                                "pubYear": "2001",
                                "journalTitle": "Journal of General Internal Medicine",
                                "abstractText": "<p>The Patient Health Questionnaire (PHQ-9) is a 9-item depression module.</p>",
                            }
                        ]
                    }
                },
            )

        with _patch_httpx(handler):
            cit = Citation(
                raw_text="Kroenke, K., Spitzer, R. L., & Williams, J. B. (2001). The PHQ-9: validity of a brief depression severity measure.",
                title="The PHQ-9: validity of a brief depression severity measure",
                doi="10.1046/j.1525-1497.2001.016009606.x",
                year="2001",
            )
            res = await client.lookup(cit)

        assert res.found is True
        assert res.confidence == 1.0
        assert res.title == "The PHQ-9: validity of a brief depression severity measure"
        assert res.year == "2001"
        assert res.external_ids.get("pmid") == "11556941"
        assert "<p>" not in (res.abstract or "")


# ============================================================
# 5. Smart Domain-Aware & Tiered Orchestrator Routing Tests
# ============================================================


class TestSmartDomainOrchestratorRouting:
    """Verify RetrievalOrchestrator routes intelligently by domain and stops early when Tier 1 succeeds."""

    def _make_mock_client(self, name: str, found: bool = False, **kwargs):
        from unittest.mock import AsyncMock

        from integrity_checker.models.source import SourceCandidate

        client = AsyncMock()
        client.name = name
        client.lookup.return_value = SourceCandidate(
            source_name=name,
            found=found,
            **kwargs,
        )
        return client

    def test_classify_citation_domain_signals(self):
        from integrity_checker.retrieval.retrieval_orchestrator import RetrievalOrchestrator

        c_arxiv = Citation(
            raw_text="Hu et al. (2024). MiniCPM. arXiv:2404.06395.",
            title="MiniCPM",
            doi="10.48550/arXiv.2404.06395",
        )
        sig_arxiv = RetrievalOrchestrator.classify_citation_domain(c_arxiv)
        assert sig_arxiv["is_arxiv_doi"] is True
        assert sig_arxiv["is_arxiv"] is True

        c_book = Citation(
            raw_text="Flanagan, D. (2020). JavaScript: The Definitive Guide, 7th Edition. O'Reilly.",
            title="JavaScript: The Definitive Guide, 7th Edition",
            year="2020",
        )
        sig_book = RetrievalOrchestrator.classify_citation_domain(c_book)
        assert sig_book["is_book"] is True

        c_biomed = Citation(
            raw_text="Kroenke et al. (2001). The PHQ-9: validity of a brief depression severity measure.",
            title="The PHQ-9: validity of a brief depression severity measure",
            year="2001",
        )
        sig_biomed = RetrievalOrchestrator.classify_citation_domain(c_biomed)
        assert sig_biomed["is_biomed"] is True

        c_cs = Citation(
            raw_text="Beltagy et al. (2019). SciBERT: A Pretrained Language Model for Scientific Text. EMNLP.",
            title="SciBERT: A Pretrained Language Model for Scientific Text",
            venue="EMNLP",
            year="2019",
        )
        sig_cs = RetrievalOrchestrator.classify_citation_domain(c_cs)
        assert sig_cs["is_cs_ai"] is True

    @pytest.mark.asyncio
    async def test_tier1_consensus_skips_tier2_specialist_apis(self):
        """When Tier 1 (crossref + openalex + dblp) achieves strong consensus for a CS paper,
        Tier 2 (arxiv, openlibrary) and EuropePMC are NOT called (no blind fan-out).
        """
        from integrity_checker.retrieval.retrieval_orchestrator import RetrievalOrchestrator

        m_crossref = self._make_mock_client(
            "crossref",
            found=True,
            doi="10.18653/v1/d19-1371",
            title="SciBERT: A Pretrained Language Model for Scientific Text",
            authors=["Iz Beltagy", "Kyle Lo", "Arman Cohan"],
            year="2019",
            confidence=0.95,
        )
        m_openalex = self._make_mock_client(
            "openalex",
            found=True,
            doi="10.18653/v1/d19-1371",
            title="SciBERT: A Pretrained Language Model for Scientific Text",
            authors=["Iz Beltagy", "Kyle Lo", "Arman Cohan"],
            year="2019",
            abstract="We release SciBERT, a pretrained language model based on BERT.",
            confidence=0.92,
        )
        m_dblp = self._make_mock_client(
            "dblp",
            found=True,
            doi="10.18653/v1/d19-1371",
            title="SciBERT: A Pretrained Language Model for Scientific Text",
            authors=["Iz Beltagy", "Kyle Lo", "Arman Cohan"],
            year="2019",
            confidence=0.90,
        )
        m_arxiv = self._make_mock_client("arxiv", found=False, error="Should not be called")
        m_openlib = self._make_mock_client("openlibrary", found=False, error="Should not be called")
        m_epmc = self._make_mock_client("europepmc", found=False, error="Should not be called")

        orch = RetrievalOrchestrator(
            crossref=m_crossref,
            openalex=m_openalex,
            dblp=m_dblp,
            arxiv=m_arxiv,
            openlibrary=m_openlib,
            europepmc=m_epmc,
            use_local_db=False,
            enable_link_validation=False,
        )

        cit = Citation(
            raw_text="Beltagy et al. (2019). SciBERT: A Pretrained Language Model for Scientific Text. EMNLP.",
            title="SciBERT: A Pretrained Language Model for Scientific Text",
            authors=["Iz Beltagy"],
            year="2019",
            venue="EMNLP",
        )
        res = await orch.retrieve(cit)

        # Tier 1 called
        m_crossref.lookup.assert_called_once()
        m_openalex.lookup.assert_called_once()
        m_dblp.lookup.assert_called_once()
        # Tier 2 and unrelated domain APIs NOT called!
        m_arxiv.lookup.assert_not_called()
        m_openlib.lookup.assert_not_called()
        m_epmc.lookup.assert_not_called()

        # Consensus count preserved across deduplicated candidates
        assert res.consensus_count() == 3
        best = res.best_candidate()
        assert best is not None
        assert best.abstract == "We release SciBERT, a pretrained language model based on BERT."

    @pytest.mark.asyncio
    async def test_tier1_miss_escalates_to_tier2_and_rescues_preprint(self):
        """When Tier 1 fails to find a recent CS paper, Tier 2 (arXiv + OpenLibrary) is automatically triggered."""
        from integrity_checker.retrieval.retrieval_orchestrator import RetrievalOrchestrator

        m_crossref = self._make_mock_client("crossref", found=False, error="Crossref: no results for query")
        m_openalex = self._make_mock_client("openalex", found=False, error="OpenAlex: no results for query")
        m_dblp = self._make_mock_client("dblp", found=False, error="DBLP: no results for query")
        m_arxiv = self._make_mock_client(
            "arxiv",
            found=True,
            doi="10.48550/arxiv.2401.12345",
            title="A Novel LLM Hallucination Benchmark in 2024",
            authors=["Wei Jin"],
            year="2024",
            confidence=0.92,
        )
        m_openlib = self._make_mock_client("openlibrary", found=False, error="OpenLibrary: no results for query")
        m_epmc = self._make_mock_client("europepmc", found=False, error="Should not be called")

        orch = RetrievalOrchestrator(
            crossref=m_crossref,
            openalex=m_openalex,
            dblp=m_dblp,
            arxiv=m_arxiv,
            openlibrary=m_openlib,
            europepmc=m_epmc,
            use_local_db=False,
            enable_link_validation=False,
        )

        cit = Citation(
            raw_text="Jin, W. (2024). A Novel LLM Hallucination Benchmark in 2024.",
            title="A Novel LLM Hallucination Benchmark in 2024",
            authors=["Wei Jin"],
            year="2024",
        )
        res = await orch.retrieve(cit)

        # Both Tier 1 and Tier 2 were queried
        m_crossref.lookup.assert_called_once()
        m_arxiv.lookup.assert_called_once()
        assert "arxiv" in res.sources_succeeded
        assert res.best_candidate() is not None
        assert res.best_candidate().year == "2024"

    @pytest.mark.asyncio
    async def test_book_routing_merges_edition_year_from_openlibrary(self):
        """For a 5th-edition textbook, OpenLibrary's matched edition year (2018) overrides OpenAlex's 1st-edition year (2014)."""
        from integrity_checker.retrieval.retrieval_orchestrator import RetrievalOrchestrator

        m_openlib = self._make_mock_client(
            "openlibrary",
            found=True,
            title="Learning PHP, MySQL & JavaScript",
            authors=["Robin Nixon"],
            year="2018",
            venue="O'Reilly Media",
            confidence=0.88,
        )
        m_crossref = self._make_mock_client("crossref", found=False, error="Crossref: no results for query")
        m_openalex = self._make_mock_client(
            "openalex",
            found=True,
            title="Learning PHP, MySQL & JavaScript",
            authors=["Robin Nixon"],
            year="2014",
            confidence=0.92,
        )
        m_dblp = self._make_mock_client("dblp", found=False)
        m_arxiv = self._make_mock_client("arxiv", found=False)
        m_epmc = self._make_mock_client("europepmc", found=False)

        orch = RetrievalOrchestrator(
            crossref=m_crossref,
            openalex=m_openalex,
            dblp=m_dblp,
            arxiv=m_arxiv,
            openlibrary=m_openlib,
            europepmc=m_epmc,
            use_local_db=False,
            enable_link_validation=False,
        )

        cit = Citation(
            raw_text="Robin Nixon (2018). Learning PHP, MySQL & JavaScript, 5th Edition. O'Reilly.",
            title="Learning PHP, MySQL & JavaScript, 5th Edition",
            authors=["Robin Nixon"],
            year="2018",
        )
        res = await orch.retrieve(cit)

        best = res.best_candidate()
        assert best is not None
        assert best.year == "2018"
        assert res.consensus_count() == 2
        m_arxiv.lookup.assert_not_called()
        m_epmc.lookup.assert_not_called()

    @pytest.mark.asyncio
    async def test_zero_found_in_tier1_and_tier2_triggers_arxiv_fallback_before_serpapi(self):
        """When Tier 1 + Tier 2 find 0 candidates for a citation where arXiv was not in Tier 1/2,
        arXiv is queried as a last-resort fallback before SerpApi (and skips SerpApi on hit).
        """
        from integrity_checker.retrieval.retrieval_orchestrator import RetrievalOrchestrator

        m_crossref = self._make_mock_client("crossref", found=False, error="Crossref: no results for query")
        m_openalex = self._make_mock_client("openalex", found=False, error="OpenAlex: no results for query")
        m_dblp = self._make_mock_client("dblp", found=False, error="DBLP: no results for query")
        m_epmc = self._make_mock_client("europepmc", found=False, error="EuropePMC: no results for query")
        m_openlib = self._make_mock_client("openlibrary", found=False, error="OpenLibrary: no results for query")
        m_arxiv = self._make_mock_client(
            "arxiv",
            found=True,
            doi="10.48550/arxiv.2405.99999",
            title="Clinical Quantitative Biology Preprint on Metabolic Pathways",
            authors=["Alice Nguyen"],
            year="2024",
            abstract="Preprint abstract from arXiv.",
            confidence=0.91,
        )

        orch = RetrievalOrchestrator(
            crossref=m_crossref,
            openalex=m_openalex,
            dblp=m_dblp,
            arxiv=m_arxiv,
            openlibrary=m_openlib,
            europepmc=m_epmc,
            use_local_db=False,
            enable_link_validation=False,
        )

        # Citation with a regular DOI (where _plan_retrieval_tiers only puts crossref+openalex in Tier 1
        # and europepmc+dblp in Tier 2)
        cit = Citation(
            raw_text="Nguyen, A. (2024). Clinical Quantitative Biology Preprint on Metabolic Pathways. doi:10.1093/bio/2024.99",
            title="Clinical Quantitative Biology Preprint on Metabolic Pathways",
            authors=["Alice Nguyen"],
            year="2024",
            doi="10.1093/bio/2024.99",
        )

        with patch.object(orch, "_lookup_serpapi_fallback", return_value=None) as mock_serp:
            res = await orch.retrieve(cit)

        m_arxiv.lookup.assert_called_once()
        mock_serp.assert_not_called()
        assert "arxiv" in res.sources_queried
        assert "arxiv" in res.sources_succeeded
        assert res.best_candidate() is not None
        assert res.best_candidate().source_name == "arxiv"

    @pytest.mark.asyncio
    async def test_zero_found_in_arxiv_fallback_proceeds_to_serpapi(self):
        """When Tier 1 + Tier 2 AND the arXiv fallback all return 0 found, SerpApi fallback runs after arXiv."""
        from integrity_checker.models.source import SourceCandidate
        from integrity_checker.retrieval.retrieval_orchestrator import RetrievalOrchestrator

        m_crossref = self._make_mock_client("crossref", found=False, error="Crossref: no results for query")
        m_openalex = self._make_mock_client("openalex", found=False, error="OpenAlex: no results for query")
        m_dblp = self._make_mock_client("dblp", found=False, error="DBLP: no results for query")
        m_epmc = self._make_mock_client("europepmc", found=False, error="EuropePMC: no results for query")
        m_openlib = self._make_mock_client("openlibrary", found=False, error="OpenLibrary: no results for query")
        m_arxiv = self._make_mock_client("arxiv", found=False, error="arXiv: no results for query")

        orch = RetrievalOrchestrator(
            crossref=m_crossref,
            openalex=m_openalex,
            dblp=m_dblp,
            arxiv=m_arxiv,
            openlibrary=m_openlib,
            europepmc=m_epmc,
            use_local_db=False,
            enable_link_validation=False,
        )

        cit = Citation(
            raw_text="Nguyen, A. (2024). Obscure Clinical Study Not On Free APIs. doi:10.1093/bio/2024.00",
            title="Obscure Clinical Study Not On Free APIs",
            authors=["Alice Nguyen"],
            year="2024",
            doi="10.1093/bio/2024.00",
        )

        serp_cand = SourceCandidate(
            source_name="serpapi",
            found=True,
            title="Obscure Clinical Study Not On Free APIs",
            authors=["Alice Nguyen"],
            year="2024",
            confidence=0.5,
        )

        with patch.object(orch, "_lookup_serpapi_fallback", return_value=serp_cand) as mock_serp:
            res = await orch.retrieve(cit)

        m_arxiv.lookup.assert_called_once()
        mock_serp.assert_called_once()
        assert res.sources_queried[-2:] == ["arxiv", "serpapi"]
        assert "serpapi" in res.sources_succeeded

    @pytest.mark.asyncio
    async def test_arxiv_fallback_end_to_end_symbolic_rules_verdicts(self):
        """End-to-end check: when Tier 1 + Tier 2 return 0 found and arXiv fallback runs,
        NeuroSymbolicChecker assigns VERIFIED for exact match, METADATA_ERROR for year mismatch,
        and SUSPECTED_HALLUCINATION when arXiv and SerpApi also return 0 found.
        """
        from integrity_checker.logic.neuro_symbolic_checker import NeuroSymbolicChecker
        from integrity_checker.models.validation import ValidationLabel
        from integrity_checker.retrieval.retrieval_orchestrator import RetrievalOrchestrator

        checker = NeuroSymbolicChecker()

        # Case 1: Exact match via arXiv fallback -> VERIFIED
        orch_exact = RetrievalOrchestrator(
            crossref=self._make_mock_client("crossref", found=False, error="Crossref: no results for query"),
            openalex=self._make_mock_client("openalex", found=False, error="OpenAlex: no results for query"),
            dblp=self._make_mock_client("dblp", found=False, error="DBLP: no results for query"),
            europepmc=self._make_mock_client("europepmc", found=False, error="EuropePMC: no results for query"),
            openlibrary=self._make_mock_client("openlibrary", found=False, error="OpenLibrary: no results for query"),
            arxiv=self._make_mock_client(
                "arxiv",
                found=True,
                doi="10.48550/arxiv.2405.99999",
                title="Clinical Quantitative Biology Preprint on Metabolic Pathways",
                authors=["Alice Nguyen", "Bob Tran"],
                year="2024",
                abstract="Preprint abstract.",
                confidence=0.92,
            ),
            use_local_db=False,
            enable_link_validation=False,
        )
        cit_exact = Citation(
            raw_text="Nguyen, A. et al. (2024). Clinical Quantitative Biology Preprint on Metabolic Pathways.",
            title="Clinical Quantitative Biology Preprint on Metabolic Pathways",
            authors=["Alice Nguyen"],
            year="2024",
        )
        with patch.object(orch_exact, "_lookup_serpapi_fallback", return_value=None):
            res_exact = await orch_exact.retrieve(cit_exact)
        verdict_exact = checker.check(cit_exact, res_exact)
        assert verdict_exact.label == ValidationLabel.VERIFIED
        assert "R-SINGLE-SOURCE-VERIFIED" in verdict_exact.triggered_rules

        # Case 2: Year mismatch (cited 2021 vs arXiv 2024) via arXiv fallback -> METADATA_ERROR
        cit_year_err = Citation(
            raw_text="Nguyen, A. et al. (2021). Clinical Quantitative Biology Preprint on Metabolic Pathways.",
            title="Clinical Quantitative Biology Preprint on Metabolic Pathways",
            authors=["Alice Nguyen"],
            year="2021",
        )
        with patch.object(orch_exact, "_lookup_serpapi_fallback", return_value=None):
            res_year_err = await orch_exact.retrieve(cit_year_err)
        verdict_year_err = checker.check(cit_year_err, res_year_err)
        assert verdict_year_err.label == ValidationLabel.METADATA_ERROR
        assert "R-SINGLE-SOURCE-PARTIAL" in verdict_year_err.triggered_rules
        assert "year" in verdict_year_err.mismatched_fields

        # Case 3: 0 found across Tier 1 + Tier 2 + arXiv fallback (+ no SerpApi hit) -> SUSPECTED_HALLUCINATION
        orch_none = RetrievalOrchestrator(
            crossref=self._make_mock_client("crossref", found=False, error="Crossref: no results for query"),
            openalex=self._make_mock_client("openalex", found=False, error="OpenAlex: no results for query"),
            dblp=self._make_mock_client("dblp", found=False, error="DBLP: no results for query"),
            europepmc=self._make_mock_client("europepmc", found=False, error="EuropePMC: no results for query"),
            openlibrary=self._make_mock_client("openlibrary", found=False, error="OpenLibrary: no results for query"),
            arxiv=self._make_mock_client("arxiv", found=False, error="arXiv: no results for query"),
            use_local_db=False,
            enable_link_validation=False,
        )
        cit_fake = Citation(
            raw_text="Nguyen, A. (2024). Completely Fabricated Study on Quantum Metabolic Teleportation.",
            title="Completely Fabricated Study on Quantum Metabolic Teleportation",
            authors=["Alice Nguyen"],
            year="2024",
        )
        with patch.object(orch_none, "_lookup_serpapi_fallback", return_value=None):
            res_none = await orch_none.retrieve(cit_fake)
        verdict_none = checker.check(cit_fake, res_none)
        assert verdict_none.label == ValidationLabel.SUSPECTED_HALLUCINATION
        assert "R-NO-SCHOLARLY-RECORD" in verdict_none.triggered_rules



