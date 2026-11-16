"""Wave 1–3 Track 1 regression tests: Retrieval, Concurrency, SSRF/DoS & Extraction Hardening.

Covers:
1. DoiRaClient non-Crossref RA (JaLC/DataCite) with failing CSL-JSON returning found=False +
   doi_ra_status="registered_no_csl" without echoing citation metadata, preserved by RetrievalOrchestrator.
2. RetrievalOrchestrator._enrich_missing_abstract on ACL Anthology DOI 10.18653/v1/N19-1423
   succeeding without get_shared_http_client TypeError.
3. _CrossLoopSingleflight leader cancellation NOT raising CancelledError in concurrent follower thread.
4. LinkValidator & ArxivClient loop-primitive WeakKeyDictionary cleanup across repeated asyncio.run()
   loops + Wayback cache thread safety.
5. SourceResult.consensus_count() & has_retracted_candidate() scoped strictly to candidates matching
   best_candidate().
6. DocxParser.parse() rejecting a crafted ZIP bomb (uncompressed > 100 MB) before docx.Document()
   loads XML into RAM.
7. GrobidParser consolidate_header config mapping (list -> "1", "0"/False/[] -> "0").
8. TechStandardClient 64 KB CITATION.cff cap, EuropePMCClient "retracted publication" + _backoff_lock,
   SerpApiClient _state_lock + bounded quota cooldown, DiskCache & GrobidServiceManager UUID .tmp
   atomic writes + singleton lock, and StyleDetector sample-size confidence scaling.
"""

from __future__ import annotations

import asyncio
import gc
import threading
import weakref
import zipfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest
import yaml

from integrity_checker.config import GrobidConfig
from integrity_checker.extraction import grobid_service
from integrity_checker.extraction.docx_parser import DocxParser
from integrity_checker.extraction.grobid_parser import call_grobid_fulltext
from integrity_checker.extraction.style_detector import StyleDetector
from integrity_checker.models.citation import Citation, CitationStyle, CitationType
from integrity_checker.models.source import SourceCandidate, SourceResult
from integrity_checker.retrieval import arxiv_client, link_validator
from integrity_checker.retrieval.arxiv_client import ArxivClient
from integrity_checker.retrieval.cache import DiskCache
from integrity_checker.retrieval.doi_ra_client import DoiRaClient
from integrity_checker.retrieval.europepmc_client import EuropePMCClient
from integrity_checker.retrieval.http_pool import close_loop_http_clients
from integrity_checker.retrieval.link_validator import LinkStatus, LinkValidator
from integrity_checker.retrieval.retrieval_orchestrator import (
    RetrievalOrchestrator,
    _CrossLoopSingleflight,
)
from integrity_checker.retrieval.serpapi_client import SerpApiClient
from integrity_checker.retrieval.tech_standard_client import TechStandardClient

# ============================================================================
# 1. DoiRaClient non-Crossref RA without CSL-JSON (Pinned Interface #1)
# ============================================================================


class TestDoiRaNonCrossrefNoEcho:
    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        ("doi_str", "ra_name", "csl_mode"),
        [
            ("10.11499/sicejl.58.123", "JaLC", "406"),
            ("10.5281/zenodo.7654321", "DataCite", "timeout"),
        ],
    )
    async def test_non_crossref_ra_failing_csl_returns_registered_no_csl_without_echo(
        self,
        doi_str: str,
        ra_name: str,
        csl_mode: str,
    ) -> None:
        client = DoiRaClient(contact_email="test@citra.edu.vn", timeout=2.0)

        async def _mock_get(self_http: httpx.AsyncClient, url: str, **kwargs):
            req = httpx.Request("GET", url, headers=kwargs.get("headers"))
            if "/doiRA/" in str(url):
                return httpx.Response(
                    200,
                    json=[{"DOI": doi_str, "RA": ra_name}],
                    request=req,
                )
            if csl_mode == "timeout":
                raise httpx.ReadTimeout("CSL negotiation timed out", request=req)
            return httpx.Response(406, text="Not Acceptable", request=req)

        cit = Citation(
            raw_text=(
                f"Hallucinated Author (2025). Quantum Mind Reading in LLMs. "
                f"Fake Venue. https://doi.org/{doi_str}"
            ),
            title="Quantum Mind Reading in LLMs",
            authors=["Hallucinated Author"],
            year="2025",
            venue="Fake Venue",
            doi=doi_str,
        )

        with patch.object(httpx.AsyncClient, "get", new=_mock_get):
            cand = await client.lookup(cit)
        await close_loop_http_clients()

        assert cand.source_name == "doi_ra"
        assert cand.found is False
        assert cand.doi == doi_str.lower()
        assert cand.url == f"https://doi.org/{doi_str.lower()}"
        assert cand.external_ids == {
            "doi": doi_str.lower(),
            "doi_ra": ra_name,
            "doi_ra_status": "registered_no_csl",
        }
        assert cand.error == f"DOI RA: CSL metadata unavailable for '{doi_str.lower()}' (RA={ra_name})"
        # Must NEVER echo student-supplied metadata
        assert cand.title is None
        assert cand.authors == []
        assert cand.year is None
        assert cand.venue is None

    @pytest.mark.asyncio
    async def test_csl_json_missing_author_uses_ra_not_citation_authors(self) -> None:
        client = DoiRaClient(contact_email="test@citra.edu.vn", timeout=2.0)
        doi_str = "10.11499/sicejl.58.123"

        async def _mock_get(self_http: httpx.AsyncClient, url: str, **kwargs):
            req = httpx.Request("GET", url, headers=kwargs.get("headers"))
            if "/doiRA/" in str(url):
                return httpx.Response(200, json=[{"DOI": doi_str, "RA": "JaLC"}], request=req)
            return httpx.Response(
                200,
                json={"DOI": doi_str, "title": "Industrial Control Benchmarks", "issued": {"date-parts": [[2019]]}},
                request=req,
            )

        cit = Citation(
            raw_text=f"Fake Student Author (2019). Industrial Control Benchmarks. https://doi.org/{doi_str}",
            title="Industrial Control Benchmarks",
            authors=["Fake Student Author"],
            year="2019",
            doi=doi_str,
        )
        with patch.object(httpx.AsyncClient, "get", new=_mock_get):
            cand = await client.lookup(cit)
        await close_loop_http_clients()

        assert cand.found is True
        assert cand.authors == ["JaLC"]
        assert "Fake Student Author" not in cand.authors

    @pytest.mark.asyncio
    async def test_orchestrator_preserves_registered_no_csl_sentinel_on_source_result(self) -> None:
        doi_str = "10.11499/sicejl.58.123"

        def _miss_client(name: str) -> MagicMock:
            m = MagicMock()
            m.name = name
            m.lookup = AsyncMock(
                return_value=SourceCandidate(
                    source_name=name,
                    found=False,
                    error=f"{name}: no results for '{doi_str}'",
                )
            )
            return m

        doi_ra = DoiRaClient(contact_email="test@citra.edu.vn", timeout=2.0)

        async def _mock_get(self_http: httpx.AsyncClient, url: str, **kwargs):
            req = httpx.Request("GET", url, headers=kwargs.get("headers"))
            if "/doiRA/" in str(url):
                return httpx.Response(200, json=[{"DOI": doi_str, "RA": "JaLC"}], request=req)
            return httpx.Response(406, text="Not Acceptable", request=req)

        orch = RetrievalOrchestrator(
            crossref=_miss_client("crossref"),
            openalex=_miss_client("openalex"),
            dblp=_miss_client("dblp"),
            arxiv=_miss_client("arxiv"),
            datacite=_miss_client("datacite"),
            openaire_hal=_miss_client("openaire_hal"),
            wikidata_opencitations=_miss_client("wikidata_opencitations"),
            doi_ra=doi_ra,
            use_local_db=False,
            enable_link_validation=False,
        )
        cit = Citation(
            raw_text=f"Fake, A. (2024). Quantum Mind Reading in LLMs. https://doi.org/{doi_str}",
            title="Quantum Mind Reading in LLMs",
            authors=["Fake, A."],
            year="2024",
            doi=doi_str,
        )
        with patch.object(httpx.AsyncClient, "get", new=_mock_get):
            res = await orch.retrieve(cit, allow_serpapi=False)
        await close_loop_http_clients()

        assert res.best_candidate() is None
        assert any(
            not c.found and (c.external_ids or {}).get("doi_ra_status") == "registered_no_csl"
            for c in res.candidates
        )


# ============================================================================
# 2. RetrievalOrchestrator ACL Anthology Abstract Enrichment
# ============================================================================


class TestOrchestratorAclAnthologyEnrichment:
    @pytest.mark.asyncio
    async def test_enrich_missing_abstract_acl_anthology_succeeds_without_type_error(self) -> None:
        acl_html = (
            "<html><body>"
            '<div class="card-body acl-abstract"><h5>Abstract</h5>'
            "<span>We introduce a new language representation model called BERT, which stands for "
            "Bidirectional Encoder Representations from Transformers.</span></div>"
            "</body></html>"
        )
        requested_urls: list[str] = []

        async def _mock_get(self_http: httpx.AsyncClient, url: str, **kwargs):
            requested_urls.append(str(url))
            req = httpx.Request("GET", url)
            if "aclanthology.org/" in str(url):
                return httpx.Response(200, text=acl_html, request=req)
            return httpx.Response(404, text="Not Found", request=req)

        orch = RetrievalOrchestrator(
            use_local_db=False,
            enable_link_validation=False,
        )
        cit = Citation(
            raw_text="Devlin, J. et al. (2019). BERT: Pre-training of Deep Bidirectional Transformers. NAACL. https://doi.org/10.18653/v1/N19-1423",
            title="BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding",
            authors=["Jacob Devlin"],
            year="2019",
            doi="10.18653/v1/N19-1423",
        )
        cand = SourceCandidate(
            source_name="crossref",
            found=True,
            doi="10.18653/v1/N19-1423",
            title=cit.title,
            authors=["Jacob Devlin"],
            year="2019",
            abstract=None,
            confidence=0.98,
        )

        with patch.object(httpx.AsyncClient, "get", new=_mock_get):
            enriched = await orch._enrich_missing_abstract(cit, [cand], extra_clients=[])
        await close_loop_http_clients()

        assert enriched is not None
        assert "Bidirectional Encoder Representations from Transformers" in enriched
        assert cand.abstract == enriched
        assert any("aclanthology.org/" in u and "n19-1423" in u.lower() for u in requested_urls)


# ============================================================================
# 3. _CrossLoopSingleflight Leader Cancellation Isolation
# ============================================================================


class TestCrossLoopSingleflightCancellationIsolation:
    def test_leader_cancellation_does_not_raise_cancelled_error_in_follower_thread(self) -> None:
        sf = _CrossLoopSingleflight()
        leader_entered = threading.Event()
        follower_attached = threading.Event()
        leader_cancelled_done = threading.Event()

        def _run_leader() -> str:
            async def _main() -> str:
                async def _leader_coro() -> SourceResult:
                    leader_entered.set()
                    await asyncio.sleep(10.0)
                    return SourceResult(citation_raw="leader")

                task = asyncio.create_task(sf.run("shared-cit-key", _leader_coro))
                await asyncio.to_thread(follower_attached.wait, 3.0)
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    leader_cancelled_done.set()
                    return "leader_cancelled_cleanly"
                return "unexpected_success"

            return asyncio.run(_main())

        def _run_follower() -> tuple[SourceResult, bool]:
            assert leader_entered.wait(timeout=3.0)

            async def _main() -> tuple[SourceResult, bool]:
                async def _follower_coro() -> SourceResult:
                    return SourceResult(
                        citation_raw="recovered-by-follower",
                        candidates=[
                            SourceCandidate(
                                source_name="openalex",
                                found=True,
                                title="Attention Is All You Need",
                                authors=["Ashish Vaswani"],
                                year="2017",
                                confidence=0.98,
                            )
                        ],
                    )

                run_task = asyncio.create_task(sf.run("shared-cit-key", _follower_coro))
                for _ in range(50):
                    if sf.coalesced_hits >= 1 or run_task.done():
                        break
                    await asyncio.sleep(0.002)
                follower_attached.set()
                return await run_task

            return asyncio.run(_main())

        with ThreadPoolExecutor(max_workers=2) as pool:
            f_leader = pool.submit(_run_leader)
            f_follower = pool.submit(_run_follower)
            leader_outcome = f_leader.result(timeout=5.0)
            follower_res, _was_coalesced = f_follower.result(timeout=5.0)

        assert leader_outcome == "leader_cancelled_cleanly"
        assert leader_cancelled_done.is_set()
        assert follower_res.best_candidate() is not None
        assert follower_res.best_candidate().title == "Attention Is All You Need"
        assert sf.inflight_count == 0


# ============================================================================
# 4. LinkValidator & ArxivClient WeakKeyDictionary Loop Cleanup + Thread Safety
# ============================================================================


class TestLoopPrimitivesAndWaybackThreadSafety:
    def test_link_validator_and_arxiv_client_clean_up_closed_event_loops(self) -> None:
        assert isinstance(link_validator._WAYBACK_SEMS, weakref.WeakKeyDictionary)
        assert isinstance(link_validator._WAYBACK_LOCKS, weakref.WeakKeyDictionary)
        assert isinstance(link_validator._WAYBACK_LAST_AT, weakref.WeakKeyDictionary)
        assert hasattr(link_validator, "_WAYBACK_CACHE_LOCK")

        assert isinstance(arxiv_client._ARXIV_LOOP_SEMS, weakref.WeakKeyDictionary)
        assert isinstance(arxiv_client._ARXIV_SLOT_LOCKS, weakref.WeakKeyDictionary)
        assert isinstance(arxiv_client._LAST_ARXIV_REQ_AT, weakref.WeakKeyDictionary)
        assert isinstance(arxiv_client._ARXIV_CONSECUTIVE_TIMEOUTS, weakref.WeakKeyDictionary)
        assert isinstance(arxiv_client._ARXIV_CIRCUIT_OPEN_UNTIL, weakref.WeakKeyDictionary)

        LinkValidator.clear_wayback_cache()

        def _mock_transport_handler(request: httpx.Request) -> httpx.Response:
            u = str(request.url)
            if "archive.org/wayback/available" in u:
                return httpx.Response(
                    200,
                    json={
                        "archived_snapshots": {
                            "closest": {
                                "available": True,
                                "url": "https://web.archive.org/web/20230101000000/https://journal-archive-test.edu/p",
                                "timestamp": "20230101000000",
                            }
                        }
                    },
                )
            if "web.archive.org/web/" in u:
                return httpx.Response(
                    200,
                    text="<html><head><title>Archived Paper</title></head></html>",
                    headers={"content-type": "text/html; charset=utf-8"},
                )
            if "export.arxiv.org/api/query" in u:
                return httpx.Response(
                    200,
                    text='<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom"></feed>',
                )
            return httpx.Response(404, text="Not Found")

        transport = httpx.MockTransport(_mock_transport_handler)
        orig_async_get = httpx.AsyncClient.get

        async def _routed_get(self_http: httpx.AsyncClient, url, **kwargs):
            if "export.arxiv.org" in str(url):
                req = httpx.Request("GET", str(url))
                return httpx.Response(
                    200,
                    text='<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom"></feed>',
                    request=req,
                )
            return await orig_async_get(self_http, url, **kwargs)

        tracked_weak_dicts = (
            link_validator._WAYBACK_SEMS,
            link_validator._WAYBACK_LOCKS,
            link_validator._WAYBACK_LAST_AT,
            arxiv_client._ARXIV_LOOP_SEMS,
            arxiv_client._ARXIV_SLOT_LOCKS,
            arxiv_client._LAST_ARXIV_REQ_AT,
            arxiv_client._ARXIV_CONSECUTIVE_TIMEOUTS,
            arxiv_client._ARXIV_CIRCUIT_OPEN_UNTIL,
        )
        pre_existing_loops: weakref.WeakSet[asyncio.AbstractEventLoop] = weakref.WeakSet()
        for wd in tracked_weak_dicts:
            for existing_loop in list(wd.keys()):
                pre_existing_loops.add(existing_loop)

        refs_lock = threading.Lock()
        worker_loop_refs: list[weakref.ReferenceType[asyncio.AbstractEventLoop]] = []

        def _worker(idx: int) -> tuple[LinkStatus, bool]:
            async def _main() -> tuple[LinkStatus, bool]:
                with refs_lock:
                    worker_loop_refs.append(weakref.ref(asyncio.get_running_loop()))
                lv = LinkValidator(
                    timeout=2.0,
                    enable_wayback_fallback=True,
                    resolver=lambda host, port: ["93.184.216.34"],
                    transport=transport,
                )
                link_res = await lv.validate_url(
                    f"https://journal-archive-test.edu/paper-{idx}"
                )

                arx = ArxivClient(timeout=2.0, max_retries=1)
                cand = await arx.lookup(
                    Citation(raw_text="Test Paper", title="Test Paper", year="2023")
                )
                await close_loop_http_clients()
                return link_res.status, cand.found

            return asyncio.run(_main())

        with patch.object(link_validator, "_WAYBACK_MIN_INTERVAL", 0.0), patch.object(
            arxiv_client, "_ARXIV_MIN_INTERVAL", 0.0
        ), patch.object(httpx.AsyncClient, "get", new=_routed_get):
            with ThreadPoolExecutor(max_workers=4) as pool:
                outcomes = list(pool.map(_worker, range(8)))

        assert all(st == LinkStatus.ARCHIVED_ALIVE and found is False for st, found in outcomes)
        assert len(worker_loop_refs) == 8

        gc.collect()
        assert all(ref() is None for ref in worker_loop_refs)
        surviving_pre_existing = set(pre_existing_loops)
        for wd in tracked_weak_dicts:
            assert set(wd.keys()) <= surviving_pre_existing


# ============================================================================
# 5. SourceResult Scoped consensus_count() & has_retracted_candidate()
# ============================================================================


class TestSourceResultScopedConsensusAndRetraction:
    def test_unrelated_candidates_do_not_inflate_consensus_or_leak_retraction(self) -> None:
        best_clean = SourceCandidate(
            source_name="crossref",
            found=True,
            doi="10.1038/nature14539",
            title="Deep learning",
            authors=["Yann LeCun", "Yoshua Bengio", "Geoffrey Hinton"],
            year="2015",
            confidence=0.96,
        )
        unrelated_1 = SourceCandidate(
            source_name="openalex",
            found=True,
            doi="10.1016/j.retracted.2020.001",
            title="Completely Unrelated Retracted Paper on Clinical Fraud",
            authors=["John Fraudster"],
            year="2020",
            external_ids={"is_retracted": "true"},
            confidence=0.62,
        )
        unrelated_2 = SourceCandidate(
            source_name="europepmc",
            found=True,
            doi="10.1016/j.retracted.2020.001",
            title="Completely Unrelated Retracted Paper on Clinical Fraud",
            authors=["John Fraudster"],
            year="2020",
            external_ids={"is_retracted": "true"},
            confidence=0.61,
        )

        res = SourceResult(
            citation_raw="LeCun, Y., Bengio, Y., & Hinton, G. (2015). Deep learning. Nature.",
            candidates=[best_clean, unrelated_1, unrelated_2],
            sources_queried=["crossref", "openalex", "europepmc"],
            sources_succeeded=["crossref", "openalex", "europepmc"],
        )

        assert res.best_candidate() is best_clean
        assert res.consensus_count() == 1
        assert res.has_retracted_candidate() is False

    def test_matching_candidates_contribute_to_consensus_and_retraction(self) -> None:
        c1 = SourceCandidate(
            source_name="crossref",
            found=True,
            doi="10.1016/s0140-6736(97)11096-0",
            title="Retracted Clinical Study",
            authors=["A. Wakefield"],
            year="1998",
            confidence=0.97,
        )
        c2 = SourceCandidate(
            source_name="europepmc",
            found=True,
            doi="10.1016/s0140-6736(97)11096-0",
            title="Retracted Clinical Study",
            authors=["A. Wakefield"],
            year="1998",
            external_ids={"is_retracted": "true"},
            confidence=0.90,
        )
        c3_no_doi_same_title = SourceCandidate(
            source_name="dblp",
            found=True,
            doi=None,
            title="Retracted Clinical Study",
            authors=["A. Wakefield"],
            year="1998",
            confidence=0.85,
        )
        res = SourceResult(
            citation_raw="Wakefield (1998). Retracted Clinical Study.",
            candidates=[c1, c2, c3_no_doi_same_title],
            sources_queried=["crossref", "europepmc", "dblp"],
            sources_succeeded=["crossref", "europepmc", "dblp"],
        )
        assert res.best_candidate() is c1
        assert res.consensus_count() == 3
        assert res.has_retracted_candidate() is True


# ============================================================================
# 6. DocxParser ZIP Bomb Rejection (> 100 MB uncompressed) Before docx.Document
# ============================================================================


class TestDocxParserZipBombGuard:
    def test_rejects_zip_bomb_exceeding_100mb_before_docx_document_loads(
        self, tmp_path: Path
    ) -> None:
        import docx

        base_docx = tmp_path / "base.docx"
        d = docx.Document()
        d.add_paragraph("Normal paragraph (Smith, 2020).")
        d.save(str(base_docx))

        bomb_docx = tmp_path / "bomb_105mb.docx"
        # ~105 MB highly compressible XML payload (~100 KB on disk)
        padding = b" " * (105 * 1024 * 1024)
        oversized_xml = (
            b'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            b'<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
            b"<w:body><w:p><w:r><w:t>"
            + padding
            + b"</w:t></w:r></w:p></w:body></w:document>"
        )

        with zipfile.ZipFile(base_docx, "r") as src, zipfile.ZipFile(
            bomb_docx, "w", compression=zipfile.ZIP_DEFLATED
        ) as dst:
            for info in src.infolist():
                if info.filename == "word/document.xml":
                    continue
                dst.writestr(info, src.read(info))
            dst.writestr("word/document.xml", oversized_xml)

        assert bomb_docx.stat().st_size < 1024 * 1024  # < 1 MB compressed on disk

        with patch("docx.Document") as spy_doc_open:
            with pytest.raises(ValueError, match=r"100\s*MB|uncompressed|oversized|exceeds"):
                DocxParser().parse(bomb_docx)
            spy_doc_open.assert_not_called()


# ============================================================================
# 7. GrobidParser consolidate_header Config Mapping
# ============================================================================


class TestGrobidConsolidateHeaderMapping:
    def test_consolidate_header_handles_lists_scalars_and_booleans_without_type_error(
        self, tmp_path: Path
    ) -> None:
        pdf_file = tmp_path / "sample.pdf"
        pdf_file.write_bytes(b"%PDF-1.4\n%test\n")

        captured: list[dict[str, str]] = []

        class _Resp:
            status_code = 200
            text = "<TEI><teiHeader></teiHeader></TEI>"

        def _post(url, files, data, timeout):
            captured.append(dict(data))
            return _Resp()

        # Default GrobidConfig section-name list ["abstract", "body", ...] -> "0" (no outbound Crossref in GROBID)
        call_grobid_fulltext(str(pdf_file), GrobidConfig(), http_post_fn=_post)
        assert captured[-1]["consolidateHeader"] == "0"

        # Explicit numeric code in list -> preserved
        call_grobid_fulltext(
            str(pdf_file),
            GrobidConfig(consolidate_header=["2"]),
            http_post_fn=_post,
        )
        assert captured[-1]["consolidateHeader"] == "2"

        # Empty list and ["0"] -> "0"
        call_grobid_fulltext(
            str(pdf_file),
            GrobidConfig(consolidate_header=[]),
            http_post_fn=_post,
        )
        assert captured[-1]["consolidateHeader"] == "0"

        call_grobid_fulltext(
            str(pdf_file),
            GrobidConfig(consolidate_header=["0"]),
            http_post_fn=_post,
        )
        assert captured[-1]["consolidateHeader"] == "0"

        # Scalar bool/int/str overrides on config attribute (previously raised TypeError or misparsed)
        for raw_val, expected in [
            (True, "1"),
            (False, "0"),
            (1, "1"),
            (3, "3"),
            (0, "0"),
            (" 2 ", "2"),
            ("true", "1"),
            ("0", "0"),
        ]:
            cfg_override = GrobidConfig()
            object.__setattr__(cfg_override, "consolidate_header", raw_val)
            call_grobid_fulltext(str(pdf_file), cfg_override, http_post_fn=_post)
            assert captured[-1]["consolidateHeader"] == expected


# ============================================================================
# 8. Step 3 Hardening: CITATION.cff 64KB cap, EuropePMC, SerpApi, Atomic Cache, StyleDetector
# ============================================================================


class TestStep3HardeningInvariants:
    @pytest.mark.asyncio
    async def test_tech_standard_caps_github_citation_cff_at_64kb(self) -> None:
        client = TechStandardClient(contact_email="test@citra.edu.vn", timeout=2.0)
        oversized_cff = "cff-version: 1.2.0\ntitle: Oversized\nnotes: " + ("A" * (70 * 1024))

        async def _mock_get(self_http: httpx.AsyncClient, url: str, **kwargs):
            req = httpx.Request("GET", url)
            return httpx.Response(200, text=oversized_cff, request=req)

        with patch.object(httpx.AsyncClient, "get", new=_mock_get), patch.object(
            yaml, "safe_load", wraps=yaml.safe_load
        ) as spy_yaml:
            meta = await client._fetch_github_citation_cff("evil-org/giant-cff")
            spy_yaml.assert_not_called()
        await close_loop_http_clients()

        assert meta is None

        # Also verify the live streaming path (unpatched httpx.AsyncClient.get) aborts > 64 KB
        stream_transport = httpx.MockTransport(
            lambda req: httpx.Response(200, content=oversized_cff.encode("utf-8"))
        )
        async with httpx.AsyncClient(transport=stream_transport) as stream_http:
            with patch(
                "integrity_checker.retrieval.tech_standard_client.get_shared_http_client",
                return_value=stream_http,
            ), patch.object(yaml, "safe_load", wraps=yaml.safe_load) as spy_stream_yaml:
                meta_stream = await client._fetch_github_citation_cff("evil-org/giant-stream")
                spy_stream_yaml.assert_not_called()
        assert meta_stream is None

    @pytest.mark.asyncio
    async def test_europepmc_marks_retracted_publication_and_guards_backoff(self) -> None:
        assert hasattr(EuropePMCClient, "_backoff_lock")
        client = EuropePMCClient(contact_email="test@citra.edu.vn", timeout=2.0)

        async def _mock_get(self_http: httpx.AsyncClient, url: str, **kwargs):
            req = httpx.Request("GET", url)
            return httpx.Response(
                200,
                json={
                    "resultList": {
                        "result": [
                            {
                                "id": "999111",
                                "pmid": "999111",
                                "doi": "10.1016/s0140-6736(97)11096-0",
                                "title": "Retracted Biomedical Study.",
                                "authorString": "Wakefield AJ",
                                "pubYear": "1998",
                                "journalTitle": "The Lancet",
                                "pubTypeList": {
                                    "pubType": ["Retracted Publication", "research-article"]
                                },
                            }
                        ]
                    }
                },
                request=req,
            )

        with patch.object(httpx.AsyncClient, "get", new=_mock_get):
            cand = await client.lookup(
                Citation(
                    raw_text="Wakefield (1998). Retracted Biomedical Study.",
                    title="Retracted Biomedical Study",
                    doi="10.1016/s0140-6736(97)11096-0",
                    year="1998",
                )
            )
        await close_loop_http_clients()

        assert cand.found is True
        assert cand.is_retracted is True
        assert cand.external_ids.get("is_retracted") == "true"

    @pytest.mark.asyncio
    async def test_serpapi_state_lock_and_bounded_quota_cooldown_recovery(self) -> None:
        assert hasattr(SerpApiClient, "_state_lock")
        SerpApiClient.reset_circuit_breakers()
        try:
            clock = [1000.0]
            client = SerpApiClient(serper_api_key="test-serper-key", api_key="")

            calls = {"n": 0}

            async def _mock_post(self_http: httpx.AsyncClient, url: str, **kwargs):
                calls["n"] += 1
                req = httpx.Request("POST", url)
                if calls["n"] == 1:
                    return httpx.Response(
                        403,
                        json={"message": "Not enough credits"},
                        request=req,
                    )
                return httpx.Response(
                    200,
                    json={
                        "organic": [
                            {
                                "title": "Attention Is All You Need",
                                "publicationInfo": "A Vaswani - NeurIPS, 2017",
                                "year": 2017,
                                "link": "https://arxiv.org/abs/1706.03762",
                            }
                        ]
                    },
                    request=req,
                )

            cit = Citation(
                raw_text="Vaswani, A. (2017). Attention Is All You Need. NeurIPS.",
                title="Attention Is All You Need",
                authors=["Vaswani, A."],
                year="2017",
            )

            with patch("integrity_checker.retrieval.serpapi_client.time.monotonic", side_effect=lambda: clock[0]), patch.object(
                httpx.AsyncClient, "post", new=_mock_post
            ):
                first = await client.lookup(cit)
                assert first.found is False
                assert SerpApiClient._serper_quota_exhausted is True

                # During cooldown window -> fast-fails without HTTP call
                clock[0] += 60.0
                during_cooldown = await client.lookup(cit)
                assert during_cooldown.found is False
                assert calls["n"] == 1

                # Past bounded cooldown -> automatically recovers and succeeds
                cooldown_sec = getattr(SerpApiClient, "QUOTA_COOLDOWN_SECONDS", 900.0)
                clock[0] += cooldown_sec + 5.0
                recovered = await client.lookup(cit)
                assert recovered.found is True
                assert calls["n"] == 2
                assert SerpApiClient._serper_quota_exhausted is False
            await close_loop_http_clients()
        finally:
            SerpApiClient.reset_circuit_breakers()

    def test_disk_cache_and_grobid_service_use_uuid_tmp_and_manager_lock(
        self, tmp_path: Path
    ) -> None:
        assert hasattr(grobid_service, "_grobid_manager_lock")

        dc = DiskCache(tmp_path / "disk_cache")
        seen_tmp_names: list[str] = []
        orig_replace = Path.replace

        def _spy_replace(self_path: Path, target: Path) -> Path:
            seen_tmp_names.append(self_path.name)
            return orig_replace(self_path, target)

        with patch.object(Path, "replace", autospec=True, side_effect=_spy_replace):
            dc.set("same_key", {"v": 1})
            dc.set("same_key", {"v": 2})

        assert len(seen_tmp_names) == 2
        assert seen_tmp_names[0] != seen_tmp_names[1]
        assert all(name.endswith(".tmp") and name != "same_key.tmp" for name in seen_tmp_names)
        assert dc.get("same_key") == {"v": 2}

        pdf_file = tmp_path / "doc.pdf"
        pdf_file.write_bytes(b"%PDF-1.4\n")
        grobid_tmp_names: list[str] = []

        def _spy_grobid_replace(self_path: Path, target: Path) -> Path:
            grobid_tmp_names.append(self_path.name)
            return orig_replace(self_path, target)

        mgr = grobid_service.GrobidServiceManager.__new__(grobid_service.GrobidServiceManager)
        mgr.config = GrobidConfig(cache_by_file_sha256=True)
        mgr.stats = grobid_service.GrobidStats()
        with patch.object(
            mgr, "get_cache_path", return_value=tmp_path / "abc123.tei.xml"
        ), patch.object(Path, "replace", autospec=True, side_effect=_spy_grobid_replace):
            assert mgr.save_to_cache(str(pdf_file), "<TEI/>") is True
            assert mgr.save_to_cache(str(pdf_file), "<TEI><text/></TEI>") is True

        assert len(grobid_tmp_names) == 2
        assert grobid_tmp_names[0] != grobid_tmp_names[1]
        assert (tmp_path / "abc123.tei.xml").read_text(encoding="utf-8") == "<TEI><text/></TEI>"

    def test_style_detector_confidence_scales_with_bibliography_sample_size(self) -> None:
        # 4 APA + 1 IEEE -> body_apa = 0.80; with 100% APA bib -> apa_combined = 0.90 (< 1.0 cap)
        body = [
            Citation(raw_text="(Smith, 2020)", citation_type=CitationType.IN_TEXT),
            Citation(raw_text="(Doe, 2021)", citation_type=CitationType.IN_TEXT),
            Citation(raw_text="(Lee, 2019)", citation_type=CitationType.IN_TEXT),
            Citation(raw_text="(Chen, 2022)", citation_type=CitationType.IN_TEXT),
            Citation(raw_text="[1]", citation_type=CitationType.NUMERIC),
        ]
        bib_one = [
            Citation(raw_text="Smith, J. (2020). Paper.", citation_type=CitationType.REFERENCE_LIST, style=CitationStyle.APA)
        ]
        bib_ten = bib_one * 10

        det = StyleDetector()
        prof_one = det.detect(body, bib_one)
        prof_ten = det.detect(body, bib_ten)

        assert prof_one.label == "APA-like"
        assert prof_ten.label == "APA-like"
        assert prof_ten.confidence > prof_one.confidence
