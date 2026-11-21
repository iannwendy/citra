"""Track 2 SE Audit Remediation Regression Suite (RET-01 .. RET-15).

Covers:
- RET-01: DoiRaClient manual redirect SSRF defense + 262,144-byte streaming cap,
          DBLPClient Refresh origin validation, and http_pool trust_env=False.
- RET-02: Bare-DOI/arXiv 5xx & timeout telemetry preservation across all 6 primary clients,
          SourceResult.api_exhausted=True on outages, and zero 24h negative-cache poisoning.
- RET-03 & RET-09: Periodic orphan job recovery + asyncio.to_thread sync DB offloading +
          HTTP pool teardown in worker.py, non-blocking Semaphore(2) _drain in job_recovery.py,
          and lock-guarded stats + 300s write throttling in PersistentVerificationCache.
- RET-04: OpenAlex DOI URL-encoding & year_key sanitization, Crossref/OpenAlex DOI normalization,
          strict ACL ID validation + 262,144-byte stream cap, and '.'/'..' repo segment rejection.
- RET-05: DBLPClient WeakKeyDictionary per event loop and zero shared client.cookies mutation.
- RET-06: Zero unverified student title echoing in HuggingFaceClient and zero non-release year
          echoing in TechStandardClient (PyPI, NPM, GitHub).
- RET-07 & RET-12: Mixed-case DOI upsert without UNIQUE(arxiv_id) IntegrityError, zero nested
          connections in add_papers_bulk, LocalDatabase.update_paper_abstract() WAL invalidation,
          and non-conflicting DOI + author overlap + rate-limited OpenAlex in _enrich_missing_abstract.
- RET-08: RateLimiter.report_success() active backoff preservation and stripped '429' title quotes.
- RET-10: is_retracted preserved on local_db hits + DataCite/DoiRa/bioRxiv/Crossref retraction markers.
- RET-11: CircuitBreaker HALF_OPEN positive remaining cooldown and coordinated private breaker resets.
- RET-13: Serper HTTP 400 non-quota handling, SerpApi best-item selection + TTL negative cache,
          and NPM /{pkg}/latest query when citation.year is absent.
- RET-14: LinkValidator non-standard port DNS validation, Wayback trust_env=False, clean client
          lifecycle, and SafeHtmlMetaVerifier(client=...) SSRF transport enforcement.
- RET-15: SQL LIKE wildcard escaping in LocalDatabase, query_log/citation_cache retention pruning,
          and DiskCache 12-char SHA-256 key digest.
"""

from __future__ import annotations

import asyncio
import gc
import json
import socket
import threading
import time
import weakref
from collections.abc import AsyncIterator
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from pathlib import Path
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import fitz
import httpx
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from integrity_checker.api import job_recovery
from integrity_checker.database.local_db import (
    _PAPERS_COUNTS_CACHE,
    LocalDatabase,
    clear_local_query_cache,
)
from integrity_checker.database.models import Paper
from integrity_checker.db.migrations import run_migrations
from integrity_checker.db.models import Base, CitationCache, EssayRecord, User
from integrity_checker.models.citation import Citation
from integrity_checker.models.source import SourceCandidate, SourceResult
from integrity_checker.retrieval import dblp_client
from integrity_checker.retrieval.arxiv_client import ArxivClient
from integrity_checker.retrieval.cache import DiskCache
from integrity_checker.retrieval.circuit_breaker import (
    CircuitBreakerRegistry,
    CircuitState,
    reset_circuit_breaker_registry,
)
from integrity_checker.retrieval.crossref_client import CrossrefClient
from integrity_checker.retrieval.datacite_client import DataCiteClient
from integrity_checker.retrieval.dblp_client import DBLPClient
from integrity_checker.retrieval.doaj_client import DOAJClient
from integrity_checker.retrieval.doi_ra_client import DoiRaClient
from integrity_checker.retrieval.europepmc_client import EuropePMCClient
from integrity_checker.retrieval.html_meta_verifier import (
    SafeHtmlMetaVerifier,
    SSRFBlockedError,
)
from integrity_checker.retrieval.http_pool import (
    close_loop_http_clients,
    get_shared_http_client,
)
from integrity_checker.retrieval.huggingface_client import HuggingFaceClient
from integrity_checker.retrieval.link_validator import LinkStatus, LinkValidator
from integrity_checker.retrieval.ncbi_biorxiv_client import NcbiBiorxivClient
from integrity_checker.retrieval.openalex_client import OpenAlexClient
from integrity_checker.retrieval.persistent_cache import (
    _CLEAN_MISS_MARKERS,
    POSITIVE_MATCH_TTL_SECONDS,
    PersistentVerificationCache,
)
from integrity_checker.retrieval.rate_limiter import RateLimiter
from integrity_checker.retrieval.retrieval_orchestrator import RetrievalOrchestrator
from integrity_checker.retrieval.serpapi_client import SerpApiClient
from integrity_checker.retrieval.tech_standard_client import TechStandardClient
from integrity_checker.worker import run_worker_loop


def _make_addrinfo(ip: str, port: int = 443) -> list[tuple]:
    family = socket.AF_INET6 if ":" in ip else socket.AF_INET
    sockaddr = (ip, port, 0, 0) if family == socket.AF_INET6 else (ip, port)
    return [(family, socket.SOCK_STREAM, socket.IPPROTO_TCP, "", sockaddr)]


class _OversizedByteStream(httpx.AsyncByteStream):
    def __init__(self, prefix: bytes, *, chunk_size: int = 16_384, max_allowed: int = 262_144) -> None:
        self.prefix = prefix
        self.chunk_size = chunk_size
        self.max_allowed = max_allowed
        self.bytes_yielded = 0
        self.closed = False

    async def __aiter__(self) -> AsyncIterator[bytes]:
        if self.prefix:
            self.bytes_yielded += len(self.prefix)
            yield self.prefix
        block = b"X" * self.chunk_size
        for _ in range(128):
            self.bytes_yielded += len(block)
            yield block
            if self.bytes_yielded > self.max_allowed * 3:
                raise AssertionError(
                    f"Stream failed to stop near {self.max_allowed} bytes (read {self.bytes_yielded})!"
                )

    async def aclose(self) -> None:
        self.closed = True


# ============================================================================
# RET-01: Redirect SSRF & Streaming Body Cap + trust_env=False + DBLP Origin
# ============================================================================


class TestRet01RedirectSsrfAndStreamingBounds:
    @pytest.mark.asyncio
    async def test_http_pool_disables_trust_env(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("HTTP_PROXY", "http://127.0.0.1:9999")
        monkeypatch.setenv("HTTPS_PROXY", "http://127.0.0.1:9999")
        await close_loop_http_clients()
        try:
            client = get_shared_http_client(follow_redirects=True)
            assert client._trust_env is False
            assert len(client._mounts) == 0
        finally:
            await close_loop_http_clients()

    @pytest.mark.asyncio
    async def test_doi_ra_csl_json_blocks_redirect_to_loopback_and_metadata_ips(self) -> None:
        opened_urls: list[str] = []

        def _resolver(host: str, port: int = 443, *_a, **_kw):
            if host in ("doi.org", "public.ra.example"):
                return _make_addrinfo("93.184.216.34", port)
            if host == "metadata.rebind.example":
                return _make_addrinfo("169.254.169.254", port)
            raise socket.gaierror("NXDOMAIN")

        def _handler(request: httpx.Request) -> httpx.Response:
            opened_urls.append(str(request.url))
            if "10.5555/loopback" in request.url.path:
                return httpx.Response(
                    302,
                    headers={"Location": "http://127.0.0.1:80/internal-admin"},
                    request=request,
                )
            if "10.5555/rebind" in request.url.path:
                return httpx.Response(
                    302,
                    headers={"Location": "https://metadata.rebind.example/latest/meta-data/"},
                    request=request,
                )
            raise AssertionError(f"Forbidden SSRF socket opened to {request.url}")

        client = DoiRaClient(
            contact_email="sec@citra.io.vn",
            timeout=2.0,
            resolver=_resolver,
            transport=httpx.MockTransport(_handler),
        )
        assert await client._fetch_csl_json("10.5555/loopback", ra_name="JaLC") is None
        assert await client._fetch_csl_json("10.5555/rebind", ra_name="JaLC") is None
        assert all("127.0.0.1" not in u and "metadata.rebind" not in u for u in opened_urls)

    @pytest.mark.asyncio
    async def test_doi_ra_csl_json_caps_stream_at_262144_bytes(self) -> None:
        giant_stream = _OversizedByteStream(b'{"title": "', chunk_size=32_768, max_allowed=262_144)

        def _handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(
                200,
                headers={"Content-Type": "application/vnd.citationstyles.csl+json"},
                stream=giant_stream,
                request=request,
            )

        client = DoiRaClient(
            contact_email="sec@citra.io.vn",
            timeout=2.0,
            resolver=lambda host, port=443, *_a, **_kw: _make_addrinfo("93.184.216.34", port),
            transport=httpx.MockTransport(_handler),
        )
        cand = await client._fetch_csl_json("10.5555/giant", ra_name="DataCite")
        assert cand is None
        assert giant_stream.bytes_yielded <= 262_144 + 32_768
        assert giant_stream.closed is True

    @pytest.mark.asyncio
    async def test_dblp_execute_get_rejects_off_origin_refresh_challenge(self) -> None:
        visited: list[str] = []

        async def _mock_get(self_http: httpx.AsyncClient, url: str, **kwargs):
            visited.append(str(url))
            req = httpx.Request("GET", str(url))
            if len(visited) == 1:
                return httpx.Response(
                    202,
                    headers={"Refresh": "0;url=//evil.attacker.example/anubis"},
                    request=req,
                )
            return httpx.Response(200, json={"result": {"hits": {}}}, request=req)

        client = DBLPClient(contact_email="sec@citra.io.vn", timeout=2.0)
        with (
            patch.object(dblp_client, "_DBLP_MIN_INTERVAL", 0.0),
            patch.object(httpx.AsyncClient, "get", new=_mock_get),
        ):
            resp = await client._execute_dblp_get({"q": "transformers", "format": "json"})
        await close_loop_http_clients()

        assert resp.status_code == 202
        assert visited == [DBLPClient.BASE_URL]


# ============================================================================
# RET-02: Bare-DOI/arXiv Outage Telemetry, api_exhausted & Zero Cache Poisoning
# ============================================================================


class TestRet02OutageTelemetryAndCacheProtection:
    @pytest.mark.asyncio
    async def test_six_clients_preserve_503_and_timeout_on_bare_identifiers(self) -> None:
        reset_circuit_breaker_registry()
        bare_doi_cit = Citation(raw_text="https://doi.org/10.1038/nature14539", doi="10.1038/nature14539")
        bare_arxiv_cit = Citation(raw_text="arXiv:1706.03762", url="https://arxiv.org/abs/1706.03762")

        async def _503_get(self_http: httpx.AsyncClient, url: str, **kwargs):
            return httpx.Response(503, text="Service Unavailable", request=httpx.Request("GET", str(url)))

        async def _timeout_get(self_http: httpx.AsyncClient, url: str, **kwargs):
            raise httpx.ReadTimeout("upstream timed out", request=httpx.Request("GET", str(url)))

        clients = [
            (CrossrefClient(max_retries=1), bare_doi_cit),
            (OpenAlexClient(max_retries=1), bare_doi_cit),
            (EuropePMCClient(max_retries=1), bare_doi_cit),
            (DataCiteClient(max_retries=1), bare_doi_cit),
            (DOAJClient(), bare_doi_cit),
            (ArxivClient(max_retries=1), bare_arxiv_cit),
        ]

        skip_phrases = (
            "no title for search",
            "empty bibliographic query",
            "empty search query",
            "no title or",
            "empty title",
        )
        for mock_fn in (_503_get, _timeout_get):
            reset_circuit_breaker_registry()
            with (
                patch("integrity_checker.retrieval.arxiv_client._ARXIV_MIN_INTERVAL", 0.0),
                patch.object(httpx.AsyncClient, "get", new=mock_fn),
            ):
                for cl, cit in clients:
                    cand = await cl.lookup(cit)
                    assert cand.found is False
                    err_low = (cand.error or "").lower()
                    assert not any(sp in err_low for sp in skip_phrases), (
                        f"{cl.name} masked outage as skip error: {cand.error!r}"
                    )
                    assert any(
                        tok in err_low
                        for tok in ("503", "unavailable", "timeout", "timed out", "request failed", "retryerror")
                    ), f"{cl.name} lost outage marker: {cand.error!r}"
        await close_loop_http_clients()

    @pytest.mark.asyncio
    async def test_orchestrator_sets_api_exhausted_and_prevents_24h_negative_cache_poisoning(
        self, tmp_path: Path
    ) -> None:
        for skip_m in (
            "empty title",
            "empty search query",
            "empty bibliographic query",
            "no title for search",
            "no title or",
        ):
            assert skip_m not in _CLEAN_MISS_MARKERS

        engine = create_engine(f"sqlite:///{tmp_path / 'ret02_cache.db'}")
        Base.metadata.create_all(bind=engine)
        SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
        pcache = PersistentVerificationCache(session_factory=SessionLocal)

        try:
            def _stub(name: str, err: str) -> MagicMock:
                m = MagicMock()
                m.name = name
                m.lookup = AsyncMock(return_value=SourceCandidate(source_name=name, found=False, error=err))
                return m

            # Scenario 1: Bare DOI during 503/timeout outage while specialist clients skip for no title
            orch_bare = RetrievalOrchestrator(
                crossref=_stub("crossref", "Crossref: service unavailable (503) for '10.1038/nature14539'"),
                openalex=_stub("openalex", "OpenAlex: request failed (ReadTimeout) for '10.1038/nature14539'"),
                dblp=_stub("dblp", "DBLP: no title or searchable metadata"),
                arxiv=_stub("arxiv", "arXiv: no title for search"),
                datacite=_stub("datacite", "DataCite: service unavailable (503) for '10.1038/nature14539'"),
                doi_ra=_stub("doi_ra", "DOI RA: service unavailable (503) for '10.1038/nature14539'"),
                doaj=_stub("doaj", "DOAJ: empty title query"),
                europepmc=_stub("europepmc", "EuropePMC: no title or DOI for lookup"),
                wikidata_opencitations=_stub(
                    "wikidata_opencitations",
                    "Wikidata/OpenCitations: service unavailable (503) for '10.1038/nature14539'",
                ),
                use_local_db=False,
                enable_link_validation=False,
                persistent_cache=pcache,
            )
            bare_cit = Citation(raw_text="10.1038/nature14539", doi="10.1038/nature14539")
            res_bare = await orch_bare.retrieve(bare_cit, allow_serpapi=False)
            assert res_bare.api_exhausted is True
            assert pcache.resolve_ttl_seconds(res_bare) is None
            assert pcache.get("doi:10.1038/nature14539") is None

            # Scenario 2: Titled citation where Crossref + OpenAlex fail with 503/timeout and only arXiv returns "no results"
            orch_titled = RetrievalOrchestrator(
                crossref=_stub("crossref", "Crossref: service unavailable (503)"),
                openalex=_stub("openalex", "OpenAlex: request failed (ReadTimeout)"),
                dblp=_stub("dblp", "DBLP: rate limited (429)"),
                arxiv=_stub("arxiv", "arXiv: no results for 'Medical Study'"),
                openlibrary=_stub("openlibrary", "OpenLibrary: service unavailable (503)"),
                europepmc=_stub("europepmc", "EuropePMC: service unavailable (503)"),
                use_local_db=False,
                enable_link_validation=False,
                persistent_cache=pcache,
            )
            titled_cit = Citation(
                raw_text="Smith, J. (2023). Medical Study on Clinical Cohort.",
                title="Medical Study on Clinical Cohort",
                authors=["Smith, J."],
                year="2023",
            )
            res_titled = await orch_titled.retrieve(titled_cit, allow_serpapi=False)
            assert res_titled.api_exhausted is True
        finally:
            engine.dispose()


# ============================================================================
# RET-03 & RET-09: Worker Periodic Recovery, Non-Blocking Drain & Cache Throttle
# ============================================================================


class TestRet03AndRet09WorkerAndAsyncLifecycle:
    @pytest.mark.asyncio
    async def test_worker_loop_periodically_recovers_stale_processing_job(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        engine = create_engine(
            f"sqlite:///{tmp_path / 'worker_periodic.db'}",
            connect_args={"check_same_thread": False, "timeout": 30},
        )
        Base.metadata.create_all(bind=engine)
        run_migrations(engine)
        SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)

        from integrity_checker.api.routes import essays as essays_route

        uploads_dir = tmp_path / "uploads"
        uploads_dir.mkdir(parents=True, exist_ok=True)
        monkeypatch.setattr(essays_route, "UPLOADS_DIR", uploads_dir)
        monkeypatch.setattr("integrity_checker.db.session.get_session", SessionLocal)

        doc = fitz.open()
        page = doc.new_page()
        page.insert_text((72, 72), "Sample text (Vaswani et al., 2017).")
        pdf_bytes = doc.tobytes()
        doc.close()

        sess = SessionLocal()
        try:
            user = User(
                username="worker_u",
                password_hash="x",
                role="user",
                email="worker_u@example.com",
                is_active=1,
                email_verified=1,
                monthly_uploads_used=1,
            )
            sess.add(user)
            sess.commit()
            sess.refresh(user)
            # Fresh heartbeat at startup (simulating 1s container restart after SIGKILL)
            essay = EssayRecord(
                filename="wedged.pdf",
                num_pages=1,
                user_id=user.id,
                job_status="processing",
                job_attempt_count=0,
                quota_charged=1,
                job_heartbeat_at=datetime.now(UTC).replace(tzinfo=None),
            )
            sess.add(essay)
            sess.commit()
            sess.refresh(essay)
            eid = int(essay.id)
        finally:
            sess.close()

        (uploads_dir / f"{eid}.pdf").write_bytes(pdf_bytes)

        stub_report = SimpleNamespace(
            num_pages=1,
            extracted_citations=[],
            verdicts=[],
            style_profile={"style": "APA"},
            cis={
                "score": 100.0,
                "components": {},
                "weights_used": {},
                "num_citations": 0,
                "num_unresolved": 0,
                "disclaimer": "Decision support.",
            },
        )
        stub_pipeline = MagicMock()
        stub_pipeline.run_async = AsyncMock(return_value=stub_report)

        try:
            # Startup sees fresh heartbeat -> skips; after ~0.06s heartbeat ages past stale_heartbeat_seconds=0.05
            stats = await run_worker_loop(
                pipeline_factory=lambda: stub_pipeline,
                session_factory=SessionLocal,
                uploads_dir=uploads_dir,
                poll_interval=0.03,
                max_iterations=5,
                recover_on_startup=True,
                stale_heartbeat_seconds=0.05,
                orphan_recovery_interval=0.04,
            )
            assert stats["processed"] == 1
            verify = SessionLocal()
            try:
                done = verify.get(EssayRecord, eid)
                assert done is not None
                assert done.job_status == "completed"
                assert done.job_attempt_count == 1
            finally:
                verify.close()
        finally:
            engine.dispose()

    @pytest.mark.asyncio
    async def test_job_recovery_bounds_drain_concurrency_without_blocking_running_loop(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        engine = create_engine(
            f"sqlite:///{tmp_path / 'nonblock_drain.db'}",
            connect_args={"check_same_thread": False, "timeout": 30},
        )
        Base.metadata.create_all(bind=engine)
        run_migrations(engine)
        SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
        from integrity_checker.api.routes import essays as essays_route

        uploads_dir = tmp_path / "uploads"
        uploads_dir.mkdir(parents=True, exist_ok=True)

        sess = SessionLocal()
        eids: list[int] = []
        try:
            for i in range(4):
                e = EssayRecord(
                    filename=f"job_{i}.pdf",
                    num_pages=1,
                    user_id=1,
                    job_status="processing",
                    job_attempt_count=0,
                    quota_charged=1,
                )
                sess.add(e)
                sess.commit()
                sess.refresh(e)
                eids.append(int(e.id))
                (uploads_dir / f"{e.id}.pdf").write_bytes(b"%PDF-1.4\n")
        finally:
            sess.close()

        active = 0
        peak_active = 0
        release_gate = asyncio.Event()
        finished = asyncio.Event()
        done_count = 0

        async def _fake_pipeline_task(eid: int, *_a, **_kw) -> None:
            nonlocal active, peak_active, done_count
            active += 1
            peak_active = max(peak_active, active)
            await release_gate.wait()
            await asyncio.sleep(0.01)
            active -= 1
            done_count += 1
            if done_count == 4:
                finished.set()

        monkeypatch.setattr(essays_route, "_run_pipeline_task", _fake_pipeline_task)
        try:
            summary = job_recovery.recover_orphaned_essay_jobs(
                lambda: MagicMock(),
                session_factory=SessionLocal,
                uploads_dir=uploads_dir,
                run_rescheduled=True,
            )
            assert summary["rescheduled"] == 4
            # Deterministic non-blocking proof: recover_orphaned_essay_jobs returned before release_gate opened!
            assert done_count == 0
            release_gate.set()
            await asyncio.wait_for(finished.wait(), timeout=2.0)
            assert done_count == 4
            assert peak_active <= 2
        finally:
            engine.dispose()

    def test_persistent_cache_locks_stats_and_throttles_hit_commits(self, tmp_path: Path) -> None:
        engine = create_engine(
            f"sqlite:///{tmp_path / 'throttle_cache.db'}",
            connect_args={"check_same_thread": False, "timeout": 30},
        )
        Base.metadata.create_all(bind=engine)
        SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
        clock = [1_700_000_000.0]
        pcache = PersistentVerificationCache(session_factory=SessionLocal, now_fn=lambda: clock[0])

        try:
            assert hasattr(pcache, "_stats_lock")
            res = SourceResult(
                citation_raw="Test",
                candidates=[
                    SourceCandidate(
                        source_name="openalex",
                        found=True,
                        doi="10.1038/nature14539",
                        title="Deep learning",
                        authors=["Yann LeCun"],
                        year="2015",
                        confidence=0.98,
                    )
                ],
                sources_queried=["openalex", "crossref"],
                sources_succeeded=["openalex", "crossref"],
                sources_failed={},
            )
            assert pcache.set("doi:10.1038/nature14539", res, POSITIVE_MATCH_TTL_SECONDS) is True

            commit_count = 0
            orig_scope = pcache._session_scope

            from contextlib import contextmanager

            @contextmanager
            def _spy_scope():
                nonlocal commit_count
                with orig_scope() as s:
                    orig_commit = s.commit

                    def _counted_commit():
                        nonlocal commit_count
                        commit_count += 1
                        return orig_commit()

                    s.commit = _counted_commit  # type: ignore[method-assign]
                    yield s

            with patch.object(pcache, "_session_scope", _spy_scope):
                # 1st hit (last_hit_at was None) -> commits once
                assert pcache.get("doi:10.1038/nature14539") is not None
                assert commit_count == 1

                # Next 10 hits within 300s -> 0 commits!
                for _ in range(10):
                    clock[0] += 5.0
                    assert pcache.get("doi:10.1038/nature14539") is not None
                assert commit_count == 1
                assert pcache.hits == 11

                # Advance >= 300s -> flushes accumulated hit_count in 1 commit!
                clock[0] += 305.0
                assert pcache.get("doi:10.1038/nature14539") is not None
                assert commit_count == 2

            with SessionLocal() as check_s:
                row = check_s.query(CitationCache).filter_by(cache_key="doi:10.1038/nature14539").one()
                assert row.hit_count == 12
        finally:
            engine.dispose()


# ============================================================================
# RET-04: URL Escaping, DOI Normalization, ACL Stream Cap & Repo Traversal Guard
# ============================================================================


class TestRet04UrlEscapingAndPathValidation:
    @pytest.mark.asyncio
    async def test_openalex_and_crossref_doi_normalization_encoding_and_year_key(self) -> None:
        assert OpenAlexClient._normalize_doi("http://doi.org/10.1000/test,") == "10.1000/test"
        assert OpenAlexClient._normalize_doi("https://dx.doi.org/10.1000/test)") == "10.1000/test"
        assert CrossrefClient._normalize_doi("http://dx.doi.org/10.1000/test;") == "10.1000/test"

        seen_urls: list[str] = []
        seen_params: list[dict] = []

        async def _mock_get(self_http: httpx.AsyncClient, url: str, **kwargs):
            seen_urls.append(str(url))
            seen_params.append(dict(kwargs.get("params") or {}))
            return httpx.Response(200, json={"results": []}, request=httpx.Request("GET", str(url)))

        oa = OpenAlexClient(contact_email="sec@citra.io.vn", max_retries=1)
        with patch.object(httpx.AsyncClient, "get", new=_mock_get):
            await oa._lookup_by_doi("10.1002/sici#frag?inject=1")
            await oa._lookup_by_search(Citation(raw_text="Smith (2020a). Paper.", title="Paper", year="2020a"))
        await close_loop_http_clients()

        assert "%23frag%3Finject%3D1" in seen_urls[0]
        assert "#" not in seen_urls[0] and "?" not in seen_urls[0]
        assert seen_params[1].get("filter") == "publication_year:2020"

    @pytest.mark.asyncio
    async def test_acl_enrichment_validates_acl_id_and_caps_stream_at_262kb(self) -> None:
        orch = RetrievalOrchestrator(
            openalex=MagicMock(name="disabled_oa"),
            use_local_db=False,
            enable_link_validation=False,
        )
        called_urls: list[str] = []

        async def _unexpected_get(self_http: httpx.AsyncClient, url: str, **kwargs):
            called_urls.append(str(url))
            return httpx.Response(200, text="", request=httpx.Request("GET", str(url)))

        with patch.object(httpx.AsyncClient, "get", new=_unexpected_get):
            for bad_doi in ("10.18653/v1/../../admin", "10.18653/v1/N19-1423.pdf", "10.18653/v1/N19?x=1"):
                c = SourceCandidate(source_name="crossref", found=True, doi=bad_doi, title="Paper")
                await orch._enrich_missing_abstract(
                    Citation(raw_text="Paper", title="Paper", doi=bad_doi), [c], extra_clients=[]
                )
        assert called_urls == []

        acl_prefix = (
            b'<html><body><div class="card-body acl-abstract"><span>'
            b"We present a bounded streaming abstract extraction test for ACL Anthology papers."
            b"</span></div>"
        )
        big_stream = _OversizedByteStream(acl_prefix, chunk_size=32_768, max_allowed=262_144)
        transport = httpx.MockTransport(
            lambda req: httpx.Response(200, headers={"Content-Type": "text/html"}, stream=big_stream, request=req)
        )
        async with httpx.AsyncClient(transport=transport) as mock_client:
            with patch(
                "integrity_checker.retrieval.retrieval_orchestrator.get_shared_http_client",
                return_value=mock_client,
            ):
                cand = SourceCandidate(
                    source_name="crossref",
                    found=True,
                    doi="10.18653/v1/N19-1423",
                    title="ACL Paper",
                )
                abs_out = await orch._enrich_missing_abstract(
                    Citation(raw_text="ACL Paper", title="ACL Paper", doi="10.18653/v1/N19-1423"),
                    [cand],
                    extra_clients=[],
                )
        assert abs_out is not None
        assert big_stream.bytes_yielded <= 262_144 + 32_768

    def test_tech_standard_and_huggingface_reject_dot_segments(self) -> None:
        for bad_gh in ("https://github.com/org/..", "https://github.com/../repo", "https://github.com/./repo"):
            assert TechStandardClient.extract_github_repo(Citation(raw_text=bad_gh, url=bad_gh)) is None
        for bad_pypi in ("https://pypi.org/project/..", "https://pypi.org/project/."):
            assert TechStandardClient.extract_pypi_package(Citation(raw_text=bad_pypi, url=bad_pypi)) is None
        for bad_npm in ("https://www.npmjs.com/package/..", "https://www.npmjs.com/package/@scope/.."):
            assert TechStandardClient.extract_npm_package(Citation(raw_text=bad_npm, url=bad_npm)) is None
        for bad_hf in (
            "https://huggingface.co/org/..",
            "https://huggingface.co/../model",
            "https://huggingface.co/datasets/..",
        ):
            assert HuggingFaceClient.extract_hf_target(Citation(raw_text=bad_hf, url=bad_hf)) == (None, None)


# ============================================================================
# RET-05: DBLP WeakKeyDictionary Loop Isolation & Cookie Isolation
# ============================================================================


class TestRet05DblpWeakKeyDictAndCookies:
    def test_dblp_loop_dicts_are_weak_and_shared_client_cookies_never_mutated(self) -> None:
        assert isinstance(dblp_client._DBLP_LOOP_LOCKS, weakref.WeakKeyDictionary)
        assert isinstance(dblp_client._DBLP_LOOP_COOKIES, weakref.WeakKeyDictionary)
        assert isinstance(dblp_client._LAST_DBLP_REQ_AT, weakref.WeakKeyDictionary)
        assert isinstance(dblp_client._DBLP_CONSECUTIVE_FAILURES, weakref.WeakKeyDictionary)
        assert isinstance(dblp_client._DBLP_CIRCUIT_OPEN_UNTIL, weakref.WeakKeyDictionary)

        loop_refs: list[weakref.ReferenceType[asyncio.AbstractEventLoop]] = []

        async def _mock_get(self_http: httpx.AsyncClient, url: str, **kwargs):
            req = httpx.Request("GET", str(url), headers=kwargs.get("headers"))
            return httpx.Response(
                200,
                headers={"Set-Cookie": "dblp_anubis=tok123; Path=/"},
                json={"result": {"hits": {}}},
                request=req,
            )

        def _run_one() -> int:
            async def _inner() -> int:
                loop_refs.append(weakref.ref(asyncio.get_running_loop()))
                cl = DBLPClient(timeout=2.0)
                await cl.lookup(Citation(raw_text="Test (2023). Paper.", title="Paper", year="2023"))
                shared = get_shared_http_client(follow_redirects=True)
                shared_cookie_len = len(shared.cookies)
                await close_loop_http_clients()
                return shared_cookie_len

            return asyncio.run(_inner())

        with (
            patch.object(dblp_client, "_DBLP_MIN_INTERVAL", 0.0),
            patch.object(httpx.AsyncClient, "get", new=_mock_get),
        ):
            with ThreadPoolExecutor(max_workers=2) as pool:
                cookie_counts = list(pool.map(lambda _: _run_one(), range(6)))

        assert cookie_counts == [0] * 6
        gc.collect()
        assert all(r() is None for r in loop_refs)


# ============================================================================
# RET-06: Zero Unverified Student Title/Year Echoing
# ============================================================================


class TestRet06NoUnverifiedTitleOrYearEchoing:
    @pytest.mark.asyncio
    async def test_huggingface_never_echoes_fabricated_student_title(self) -> None:
        async def _mock_get(self_http: httpx.AsyncClient, url: str, **kwargs):
            req = httpx.Request("GET", str(url))
            if "/datasets/squad" in str(url):
                return httpx.Response(
                    200,
                    json={
                        "id": "squad",
                        "author": "rajpurkar",
                        "createdAt": "2022-03-02T00:00:00Z",
                        "cardData": {"pretty_name": "Stanford Question Answering Dataset"},
                    },
                    request=req,
                )
            return httpx.Response(404, request=req)

        hf = HuggingFaceClient(timeout=2.0)
        fake_title = "Fabricated Quantum Blockchain Survey on SQuAD Benchmarks"
        cit = Citation(
            raw_text=f"Fake, A. (2024). {fake_title}. https://huggingface.co/datasets/squad",
            title=fake_title,
            authors=["Fake, A."],
            year="2024",
            url="https://huggingface.co/datasets/squad",
        )
        with patch.object(httpx.AsyncClient, "get", new=_mock_get):
            cand = await hf.lookup(cit)
        await close_loop_http_clients()

        assert cand.found is True
        assert cand.title != fake_title
        assert "Quantum Blockchain" not in (cand.title or "")

    @pytest.mark.asyncio
    async def test_tech_standard_pypi_npm_github_never_echo_non_release_years(self) -> None:
        async def _mock_get(self_http: httpx.AsyncClient, url: str, **kwargs):
            u = str(url)
            req = httpx.Request("GET", u)
            if "pypi.org/pypi/samplepkg/json" in u:
                return httpx.Response(
                    200,
                    json={
                        "info": {"name": "samplepkg", "summary": "Sample tool", "author": "Dev"},
                        "releases": {
                            "1.0.0": [{"upload_time_iso_8601": "2019-05-01T00:00:00Z"}],
                            "2.0.0": [{"upload_time_iso_8601": "2024-05-01T00:00:00Z"}],
                        },
                    },
                    request=req,
                )
            if "registry.npmjs.org/samplepkg" in u:
                return httpx.Response(
                    200,
                    json={
                        "name": "samplepkg",
                        "description": "Sample JS tool",
                        "time": {"1.0.0": "2019-01-01T00:00:00Z", "2.0.0": "2024-01-01T00:00:00Z"},
                    },
                    request=req,
                )
            if "api.github.com/repos/org/samplepkg" in u:
                return httpx.Response(
                    200,
                    json={
                        "full_name": "org/samplepkg",
                        "name": "samplepkg",
                        "created_at": "2019-02-01T00:00:00Z",
                        "updated_at": "2024-02-01T00:00:00Z",
                        "pushed_at": "2024-02-01T00:00:00Z",
                        "owner": {"login": "org"},
                    },
                    request=req,
                )
            return httpx.Response(404, request=req)

        ts = TechStandardClient(timeout=2.0)
        with patch.object(httpx.AsyncClient, "get", new=_mock_get):
            pypi_cand = await ts.lookup(
                Citation(raw_text="https://pypi.org/project/samplepkg", year="2021", url="https://pypi.org/project/samplepkg")
            )
            npm_cand = await ts.lookup(
                Citation(raw_text="https://www.npmjs.com/package/samplepkg", year="2021", url="https://www.npmjs.com/package/samplepkg")
            )
            gh_cand = await ts.lookup(
                Citation(raw_text="https://github.com/org/samplepkg", year="2018", url="https://github.com/org/samplepkg")
            )
        await close_loop_http_clients()

        assert pypi_cand.year in {"2019", "2024"} and pypi_cand.year != "2021"
        assert npm_cand.year in {"2019", "2024"} and npm_cand.year != "2021"
        assert gh_cand.year in {"2019", "2024"} and gh_cand.year != "2018"


# ============================================================================
# RET-07 & RET-12: LocalDatabase Mixed-Case DOI, WAL Cache & Abstract Enrichment
# ============================================================================


class TestRet07AndRet12LocalDbAndEnrichment:
    def test_mixed_case_existing_doi_with_arxiv_id_updates_cleanly_without_integrity_error(
        self, tmp_path: Path
    ) -> None:
        db = LocalDatabase(tmp_path / "mixed_doi.db")
        try:
            with db._get_conn() as conn:
                conn.execute(
                    "INSERT INTO papers (doi, arxiv_id, title, authors, year, source) VALUES (?, ?, ?, ?, ?, ?)",
                    (
                        "10.48550/arXiv.1706.03762",
                        "1706.03762",
                        "Attention Is All You Need",
                        json.dumps(["Ashish Vaswani"]),
                        2017,
                        "acl",
                    ),
                )
                conn.commit()

            row_id = db.add_paper(
                Paper(
                    doi="10.48550/arXiv.1706.03762",
                    arxiv_id="1706.03762",
                    title="Attention Is All You Need",
                    authors=["Ashish Vaswani", "Noam Shazeer"],
                    year=2017,
                    abstract="Transformer architecture abstract.",
                    source="arxiv",
                )
            )
            assert row_id is not None
            fetched = db.find_by_doi("10.48550/arxiv.1706.03762")
            assert fetched is not None
            assert fetched.abstract == "Transformer architecture abstract."

            # Also verify add_papers_bulk handles no-DOI duplicates in 1 connection without nested _get_conn
            conn_opens = 0
            orig_get_conn = db._get_conn

            from contextlib import contextmanager

            @contextmanager
            def _counting_conn():
                nonlocal conn_opens
                conn_opens += 1
                with orig_get_conn() as c:
                    yield c

            with patch.object(db, "_get_conn", _counting_conn):
                added = db.add_papers_bulk(
                    [
                        Paper(title="Unique Monograph One", authors=["Alice Smith"], year=2021),
                        Paper(
                            title="Unique Monograph One",
                            authors=["Alice Smith"],
                            year=2021,
                            abstract="Enriched monograph abstract.",
                        ),
                    ]
                )
            assert added == 2
            assert conn_opens == 1
        finally:
            if hasattr(db, "close"):
                db.close()

    def test_update_paper_abstract_invalidates_query_cache_and_clears_counts_cache(
        self, tmp_path: Path
    ) -> None:
        db = LocalDatabase(tmp_path / "wal_abs.db")
        try:
            db.add_paper(
                Paper(
                    doi="10.18653/v1/n19-1423",
                    title="BERT: Pre-training of Deep Bidirectional Transformers",
                    authors=["Jacob Devlin"],
                    year=2019,
                    abstract=None,
                )
            )
            before = db.find_by_doi("10.18653/v1/n19-1423")
            assert before is not None and before.abstract is None

            updated = db.update_paper_abstract(
                doi="10.18653/v1/N19-1423",
                abstract="We introduce a new language representation model called BERT.",
            )
            assert updated is True

            after = db.find_by_doi("10.18653/v1/n19-1423")
            assert after is not None
            assert after.abstract == "We introduce a new language representation model called BERT."

            # Verify -wal mtime is part of _cache_key file signature and clear_local_query_cache clears counts
            db.get_stats()
            assert len(_PAPERS_COUNTS_CACHE) >= 1
            clear_local_query_cache()
            assert len(_PAPERS_COUNTS_CACHE) == 0
        finally:
            if hasattr(db, "close"):
                db.close()

    @pytest.mark.asyncio
    async def test_enrich_missing_abstract_enforces_doi_and_author_match_and_rate_limiter(self) -> None:
        wrong_doi_client = MagicMock()
        wrong_doi_client.name = "datacite"
        wrong_doi_client.lookup = AsyncMock(
            return_value=SourceCandidate(
                source_name="datacite",
                found=True,
                doi="10.5281/zenodo.999999",
                title="Deep Learning for Vision",
                authors=["John Smith"],
                year="2020",
                abstract="Unrelated paper abstract from a conflicting DOI.",
                confidence=0.90,
            )
        )
        wrong_author_client = MagicMock()
        wrong_author_client.name = "doaj"
        wrong_author_client.lookup = AsyncMock(
            return_value=SourceCandidate(
                source_name="doaj",
                found=True,
                doi=None,
                title="Deep Learning for Vision: A Comprehensive Study",
                authors=["Completely Different Author"],
                year="2020",
                abstract="Unrelated paper abstract from a different author.",
                confidence=0.90,
            )
        )

        oa = OpenAlexClient(contact_email="sec@citra.io.vn", max_retries=1)
        oa._lookup_by_search = AsyncMock(  # type: ignore[method-assign]
            return_value=SourceCandidate(
                source_name="openalex",
                found=True,
                doi=None,
                title="Deep Learning for Vision",
                authors=["John Smith"],
                year="2020",
                abstract="Verified abstract for John Smith's paper.",
                confidence=0.92,
            )
        )

        orch = RetrievalOrchestrator(openalex=oa, use_local_db=False, enable_link_validation=False)
        spy_rl = AsyncMock(wraps=orch._lookup_with_ratelimit)
        orch._lookup_with_ratelimit = spy_rl  # type: ignore[method-assign]

        cit = Citation(
            raw_text="Smith, J. (2020). Deep Learning for Vision. https://doi.org/10.1109/cvpr.2020.1",
            title="Deep Learning for Vision",
            authors=["John Smith"],
            year="2020",
            doi="10.1109/cvpr.2020.1",
        )
        base_cand = SourceCandidate(
            source_name="crossref",
            found=True,
            doi="10.1109/cvpr.2020.1",
            title="Deep Learning for Vision",
            authors=["John Smith"],
            year="2020",
            abstract=None,
            confidence=0.98,
        )

        enriched = await orch._enrich_missing_abstract(
            cit, [base_cand], extra_clients=[wrong_doi_client, wrong_author_client]
        )
        assert enriched == "Verified abstract for John Smith's paper."
        assert any(call.args[0] is oa for call in spy_rl.await_args_list)


# ============================================================================
# RET-08, RET-10, RET-11, RET-13, RET-14, RET-15
# ============================================================================


class TestRet08Ret10Ret11Ret13Ret14Ret15:
    @pytest.mark.asyncio
    async def test_ret08_rate_limiter_preserves_backoff_and_ignores_quoted_429_in_title(self) -> None:
        limiter = RateLimiter(calls_per_second=10.0)
        pre_429_mono = time.monotonic()
        limiter.report_rate_limited(retry_after=20.0)
        assert limiter.is_in_backoff() is True
        # In-flight sibling started at/before 429 must NOT zero active backoff!
        limiter.report_success(started_at=pre_429_mono)
        assert limiter.is_in_backoff() is True
        assert limiter.remaining_backoff() >= 15.0
        # Direct unguarded report_success() (started_at=None) smoothly recovers effective rate
        for _ in range(40):
            limiter.report_success()
        assert limiter.effective_calls_per_second == pytest.approx(10.0, abs=0.5)

        # Quoted "429" or "rate limit" inside citation title must NOT trip orchestrator rate limiter
        miss_client = MagicMock()
        miss_client.name = "crossref"
        miss_client.lookup = AsyncMock(
            return_value=SourceCandidate(
                source_name="crossref",
                found=False,
                error="Crossref: no results for 'HTTP 429 Rate Limit Resilience in Cloud APIs'",
            )
        )
        orch = RetrievalOrchestrator(crossref=miss_client, use_local_db=False, enable_link_validation=False)
        await orch._lookup_with_ratelimit(
            miss_client,
            Citation(
                raw_text="Doe (2024). HTTP 429 Rate Limit Resilience in Cloud APIs.",
                title="HTTP 429 Rate Limit Resilience in Cloud APIs",
                year="2024",
            ),
        )
        assert orch._rate_limiters["crossref"].is_in_backoff() is False
        assert orch._rate_limiters["crossref"].consecutive_failures == 0

    def test_ret10_is_retracted_preserved_on_local_db_and_detected_across_clients(
        self, tmp_path: Path
    ) -> None:
        db = LocalDatabase(tmp_path / "retracted_local.db")
        try:
            db.add_paper(
                Paper(
                    doi="10.1016/s0140-6736(97)11096-0",
                    arxiv_id="1901.99999",
                    title="Retracted Clinical Cohort Trial",
                    authors=["Andrew Wakefield"],
                    year=1998,
                    external_ids={"is_retracted": "true"},
                )
            )
            orch = RetrievalOrchestrator(local_db=db, use_local_db=True, enable_link_validation=False)

            r_doi = orch._lookup_local_db(Citation(raw_text="x", doi="10.1016/s0140-6736(97)11096-0"))
            r_ax = orch._lookup_local_db(Citation(raw_text="arXiv:1901.99999", url="https://arxiv.org/abs/1901.99999"))
            r_fts = orch._lookup_local_db(
                Citation(
                    raw_text="Wakefield (1998). Retracted Clinical Cohort Trial.",
                    title="Retracted Clinical Cohort Trial",
                    authors=["Andrew Wakefield"],
                    year="1998",
                )
            )
            assert r_doi is not None and r_doi.is_retracted is True
            assert r_ax is not None and r_ax.is_retracted is True
            assert r_fts is not None and r_fts.is_retracted is True
        finally:
            if hasattr(db, "close"):
                db.close()

        dc_cand = DataCiteClient()._item_to_candidate(
            {
                "attributes": {
                    "doi": "10.5281/zenodo.111",
                    "titles": [{"title": "Dataset X"}],
                    "relatedIdentifiers": [
                        {"relationType": "IsRetractedBy", "relatedIdentifier": "10.5281/zenodo.222"}
                    ],
                }
            }
        )
        assert dc_cand.is_retracted is True

        ra_cand = DoiRaClient()._csl_to_candidate(
            {"DOI": "10.11499/jalc.1", "title": "RETRACTED: Faulty Sensor Study"},
            default_doi="10.11499/jalc.1",
            ra_name="JaLC",
        )
        assert ra_cand.is_retracted is True

        bio_cand = NcbiBiorxivClient()._biorxiv_item_to_candidate(
            {"doi": "10.1101/2023.01.01.111", "title": "Preprint Study", "category": "withdrawn"}
        )
        assert bio_cand.is_retracted is True

        cr_cand = CrossrefClient._message_to_candidate(
            {"DOI": "10.1000/ret.1", "title": [" questionable clinical findings [Retracted]"]}
        )
        assert cr_cand.is_retracted is True

    def test_ret11_half_open_positive_remaining_and_private_breaker_coordination(self) -> None:
        clock = [100.0]
        reg = CircuitBreakerRegistry(failure_threshold=2, recovery_timeout_seconds=45.0, now_fn=lambda: clock[0])
        reg.record_infra_failure("crossref", "HTTP 503")
        reg.record_infra_failure("crossref", "HTTP 503")
        assert reg.snapshot_all()["crossref"]["state"] == CircuitState.OPEN.value

        clock[0] = 145.0
        assert reg.allow_request("crossref") == (True, 0.0)
        clock[0] = 150.0
        allowed_second, rem_second = reg.allow_request("crossref")
        assert allowed_second is False
        assert rem_second == pytest.approx(40.0)

        # Instantiating EuropePMCClient must NOT wipe active _backoff_until, while reset_circuit_breaker_registry DOES
        with EuropePMCClient._backoff_lock:
            EuropePMCClient._backoff_until = time.monotonic() + 30.0
        _ = EuropePMCClient()
        with EuropePMCClient._backoff_lock:
            assert EuropePMCClient._backoff_until > time.monotonic()
        reset_circuit_breaker_registry()
        with EuropePMCClient._backoff_lock:
            assert EuropePMCClient._backoff_until == 0.0

    @pytest.mark.asyncio
    async def test_ret13_serper_400_non_quota_serpapi_best_item_ttl_and_npm_latest(self) -> None:
        SerpApiClient.reset_circuit_breakers()
        try:
            serper_client = SerpApiClient(serper_api_key="serper-test", api_key="")

            async def _mock_post_400(self_http: httpx.AsyncClient, url: str, **kwargs):
                return httpx.Response(
                    400,
                    json={"message": "Query length exceeded maximum allowed characters"},
                    request=httpx.Request("POST", str(url)),
                )

            with patch.object(httpx.AsyncClient, "post", new=_mock_post_400):
                cand_400 = await serper_client.lookup(
                    Citation(raw_text="Long query (2023).", title="Long query", year="2023")
                )
            await close_loop_http_clients()
            assert cand_400.found is False
            assert SerpApiClient._is_serper_quota_exhausted() is False

            # SerpApi _sync_search with title_query=True selects rank-2 exact match over rank-0 mismatch
            serpapi_only = SerpApiClient(api_key="serpapi-test", serper_api_key="")

            class _FakeScholar:
                def __init__(self, params):
                    self.params = params

                def get_dict(self):
                    return {
                        "search_metadata": {"status": "Success"},
                        "organic_results": [
                            {"title": "Unrelated Broad Textbook on Persuasion", "publication_info": {"summary": "2017"}},
                            {"title": "Attention Is All You Need", "publication_info": {"summary": "A Vaswani - 2017"}},
                        ],
                    }

            with patch("serpapi.GoogleScholarSearch", _FakeScholar):
                picked = serpapi_only._sync_search("Attention Is All You Need", year="2017", title_query=True)
            assert picked is not None
            assert picked["title"] == "Attention Is All You Need"
        finally:
            SerpApiClient.reset_circuit_breakers()

        # NPM queries /{pkg}/latest when citation.year is absent
        npm_urls: list[str] = []

        async def _mock_npm_get(self_http: httpx.AsyncClient, url: str, **kwargs):
            npm_urls.append(str(url))
            return httpx.Response(
                200,
                json={"name": "express", "version": "4.19.2", "description": "Fast web framework"},
                request=httpx.Request("GET", str(url)),
            )

        ts = TechStandardClient(timeout=2.0)
        with patch.object(httpx.AsyncClient, "get", new=_mock_npm_get):
            npm_cand = await ts.lookup(
                Citation(raw_text="https://www.npmjs.com/package/express", url="https://www.npmjs.com/package/express")
            )
        await close_loop_http_clients()
        assert npm_cand.found is True
        assert any(u.endswith("/express/latest") for u in npm_urls)

    @pytest.mark.asyncio
    async def test_ret14_link_validator_nonstandard_port_dns_and_safe_html_client_guard(self) -> None:
        lv = LinkValidator(
            enable_wayback_fallback=False,
            resolver=lambda host, port=80, *_a, **_kw: _make_addrinfo("10.0.0.15", port),
        )
        res_internal = await lv.validate_url("http://postgres:5432/")
        res_private_port = await lv.validate_url("http://internal.corp.example:8443/health")
        assert res_internal.status == LinkStatus.FAKE_DOMAIN
        assert res_private_port.status == LinkStatus.FAKE_DOMAIN

        unpinned = httpx.AsyncClient()
        try:
            with pytest.raises((SSRFBlockedError, ValueError)):
                SafeHtmlMetaVerifier(client=unpinned)
        finally:
            await unpinned.aclose()

    def test_ret15_like_wildcard_escape_and_disk_cache_sha256_digest(self, tmp_path: Path) -> None:
        db = LocalDatabase(tmp_path / "like_escape.db")
        try:
            db.add_paper(
                Paper(
                    doi="10.1000/wild.1",
                    title="Special Underscore Paper Alpha",
                    authors=["Nguyen Van A"],
                    year=2023,
                )
            )
            # '%' and '_' in author filter must be treated literally, NOT as SQL wildcards matching 'Nguyen Van A'!
            assert db.search_by_title("Special Underscore Paper Alpha", author="%") == []
            assert db.search_by_title("Special Underscore Paper Alpha", author="Nguyen_Van_A") == []
            assert len(db.search_by_title("Special Underscore Paper Alpha", author="Nguyen Van A")) == 1
        finally:
            if hasattr(db, "close"):
                db.close()

        dc = DiskCache(tmp_path / "dcache")
        shared_prefix = "k" * 130
        k1 = f"{shared_prefix}_one"
        k2 = f"{shared_prefix}_two"
        dc.set(k1, {"which": 1})
        dc.set(k2, {"which": 2})
        assert dc._key_to_path(k1) != dc._key_to_path(k2)
        assert dc.get(k1) == {"which": 1}
        assert dc.get(k2) == {"which": 2}


# ============================================================================
# Round 1 Review & Critic Regressions (CRITIC-RET-01 .. CRITIC-RET-06)
# ============================================================================


class TestRound1ReviewAndCriticRegressions:
    def test_round1_local_db_evicts_and_closes_exited_worker_thread_connections(
        self, tmp_path: Path
    ) -> None:
        db = LocalDatabase(tmp_path / "thread_evict.db")
        try:
            db.add_paper(
                Paper(
                    doi="10.1000/thread.1",
                    title="Thread Pool Connection Eviction Study",
                    authors=["Alice Nguyen"],
                    year=2024,
                )
            )
            errors: list[Exception] = []

            def _worker() -> None:
                try:
                    hit = db.find_by_doi("10.1000/thread.1")
                    assert hit is not None
                except Exception as exc:  # noqa: BLE001
                    errors.append(exc)

            threads = [threading.Thread(target=_worker) for _ in range(10)]
            for t in threads:
                t.start()
            for t in threads:
                t.join()

            assert errors == []
            gc.collect()
            # Only the main thread's connection (at most 1) may remain in _conn_box.conns!
            assert len(db._conn_box.conns) <= 1
        finally:
            db.close()

    def test_round1_persistent_cache_allows_aux_input_skip_with_two_misses_and_resets_hit_count(
        self, tmp_path: Path
    ) -> None:
        from integrity_checker.retrieval.persistent_cache import CLEAN_MISS_TTL_SECONDS

        # 2 real HTTP-200 misses (1 clean + 1 quality-filtered) + 1 input-skip -> CLEAN_MISS_TTL_SECONDS
        mixed_clean_res = SourceResult(
            citation_raw="Author (2023).",
            candidates=[],
            sources_queried=["crossref", "openalex", "doaj"],
            sources_succeeded=[],
            sources_failed={
                "openalex": "OpenAlex: no results for 'Author'",
                "doaj": "DOAJ: empty title query",
            },
        )
        assert PersistentVerificationCache.resolve_ttl_seconds(mixed_clean_res) == CLEAN_MISS_TTL_SECONDS

        # Only 1 clean miss + 2 input-skips -> must NOT cache for 24h!
        mostly_skipped_res = SourceResult(
            citation_raw="10.1000/bare.1",
            candidates=[],
            sources_queried=["crossref", "doaj", "dblp"],
            sources_succeeded=[],
            sources_failed={
                "crossref": "Crossref: no results for '10.1000/bare.1'",
                "doaj": "DOAJ: empty title query",
                "dblp": "DBLP: empty title query",
            },
        )
        assert PersistentVerificationCache.resolve_ttl_seconds(mostly_skipped_res) is None

        # IntegrityError conflict path resets hit_count=0 and last_hit_at=None
        engine = create_engine(
            f"sqlite:///{tmp_path / 'conflict_reset.db'}",
            connect_args={"check_same_thread": False, "timeout": 30},
        )
        Base.metadata.create_all(bind=engine)
        SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
        pcache = PersistentVerificationCache(session_factory=SessionLocal)
        key = "doi:10.1038/nature14539"
        pos_res = SourceResult(
            citation_raw="10.1038/nature14539",
            candidates=[
                SourceCandidate(
                    source_name="crossref",
                    found=True,
                    doi="10.1038/nature14539",
                    title="Deep learning",
                    authors=["Yann LeCun"],
                    year="2015",
                    confidence=0.98,
                )
            ],
            sources_queried=["crossref"],
            sources_succeeded=["crossref"],
        )
        try:
            assert pcache.set(key, pos_res) is True
            assert pcache.get(key) is not None

            orig_query = sessionmaker.__call__

            def _racing_session_factory():
                sess = orig_query(SessionLocal)
                real_filter = sess.query(CitationCache).filter
                first_call = [True]

                class _QueryProxy:
                    def __init__(self, q):
                        self._q = q

                    def filter(self, *args, **kwargs):
                        f = real_filter(*args, **kwargs)
                        if first_call[0]:
                            first_call[0] = False

                            class _EmptyFirst:
                                def first(self):
                                    return None

                            return _EmptyFirst()
                        return f

                orig_sess_query = sess.query

                def _patched_query(model):
                    q = orig_sess_query(model)
                    return _QueryProxy(q) if model is CitationCache else q

                sess.query = _patched_query  # type: ignore[method-assign]
                return sess

            race_cache = PersistentVerificationCache(session_factory=_racing_session_factory)
            assert race_cache.set(key, pos_res) is True
            check_sess = SessionLocal()
            try:
                row = check_sess.query(CitationCache).filter(CitationCache.cache_key == key).first()
                assert row is not None
                assert row.hit_count == 0
                assert row.last_hit_at is None
            finally:
                check_sess.close()
        finally:
            engine.dispose()

    @pytest.mark.asyncio
    async def test_round1_doi_ra_blocks_dotless_redirect_and_html_200_does_not_trip_breaker(
        self,
    ) -> None:
        reset_circuit_breaker_registry()
        opened_urls: list[str] = []

        def _resolver(host: str, port: int = 443, *_a, **_kw):
            if host == "doi.org":
                return _make_addrinfo("93.184.216.34", port)
            if host == "landing.jalc.example":
                return _make_addrinfo("93.184.216.34", port)
            raise socket.gaierror("NXDOMAIN")

        def _handler(request: httpx.Request) -> httpx.Response:
            opened_urls.append(str(request.url))
            u = str(request.url)
            if "/doiRA/10.11499/dotless.1" in u:
                return httpx.Response(200, json=[{"DOI": "10.11499/dotless.1", "RA": "JaLC"}], request=request)
            if u.endswith("/10.11499/dotless.1"):
                return httpx.Response(302, headers={"Location": "//internal-host/secret"}, request=request)
            if "/doiRA/10.11499/html.1" in u:
                return httpx.Response(200, json=[{"DOI": "10.11499/html.1", "RA": "JaLC"}], request=request)
            if u.endswith("/10.11499/html.1"):
                return httpx.Response(
                    302, headers={"Location": "https://landing.jalc.example/article"}, request=request
                )
            if u == "https://landing.jalc.example/article":
                return httpx.Response(
                    200,
                    headers={"Content-Type": "text/html; charset=utf-8"},
                    content=b"<!doctype html><html><head><title>Article Landing</title></head></html>",
                    request=request,
                )
            raise AssertionError(f"Forbidden socket opened to {u}!")

        ra_client = DoiRaClient(resolver=_resolver, transport=httpx.MockTransport(_handler))
        cand_dotless = await ra_client.lookup(Citation(raw_text="10.11499/dotless.1", doi="10.11499/dotless.1"))
        assert cand_dotless.found is False
        assert not any("internal-host" in u for u in opened_urls)

        # HTML 200 landing page must NOT record a transport error or trip circuit breaker after 5 calls
        orch = RetrievalOrchestrator(doi_ra=ra_client, use_local_db=False, enable_link_validation=False)
        for _ in range(5):
            c = await orch._lookup_with_ratelimit(
                ra_client, Citation(raw_text="10.11499/html.1", doi="10.11499/html.1")
            )
            assert c.found is False
            assert c.external_ids.get("doi_ra_status") == "registered_no_csl"
        snap = orch._circuit_breakers.snapshot_all()
        assert snap.get("doi_ra", {}).get("state", CircuitState.CLOSED.value) == CircuitState.CLOSED.value

    @pytest.mark.asyncio
    async def test_round1_api_exhausted_handles_dual_and_majority_outage_and_skip_only_misses(
        self,
    ) -> None:
        reset_circuit_breaker_registry()

        def _stub(name: str, err: str) -> Any:
            return SimpleNamespace(
                name=name,
                lookup=AsyncMock(return_value=SourceCandidate(source_name=name, found=False, error=err)),
            )

        # 1. Dual wide-graph outage (Crossref 503 + OpenAlex timeout) + 3 narrow clean misses -> api_exhausted=True!
        orch_dual = RetrievalOrchestrator(
            crossref=_stub("crossref", "Crossref: HTTP 503 for 'Novel Vietnamese Study'"),
            openalex=_stub("openalex", "OpenAlex: timeout/network error for 'Novel Vietnamese Study'"),
            doaj=_stub("doaj", "DOAJ: no results for 'Novel Vietnamese Study'"),
            arxiv=_stub("arxiv", "arXiv: no results for 'Novel Vietnamese Study'"),
            wikidata_opencitations=_stub("wikidata_opencitations", "Wikidata: no results for 'Novel Vietnamese Study'"),
            dblp=_stub("dblp", "DBLP: timeout/network error"),
            europepmc=_stub("europepmc", "EuropePMC: HTTP 502"),
            openlibrary=_stub("openlibrary", "OpenLibrary: timeout"),
            datacite=_stub("datacite", "DataCite: timeout"),
            openaire_hal=_stub("openaire_hal", "OpenAIRE: timeout"),
            ncbi_biorxiv=_stub("ncbi_biorxiv", "NCBI: timeout"),
            use_local_db=False,
            use_persistent_cache=False,
            enable_link_validation=False,
        )
        res_dual = await orch_dual.retrieve(
            Citation(
                raw_text="Nguyen (2024). Novel Vietnamese Study on Coastal Hydrology.",
                title="Novel Vietnamese Study on Coastal Hydrology",
                authors=["Van A Nguyen"],
                year="2024",
            )
        )
        assert res_dual.api_exhausted is True

        # 2. Input-skip-only failures with 0 transient errors -> api_exhausted=False!
        orch_skip = RetrievalOrchestrator(
            crossref=_stub("crossref", "Crossref: empty query"),
            openalex=_stub("openalex", "OpenAlex: empty query"),
            doaj=_stub("doaj", "DOAJ: empty title query"),
            dblp=_stub("dblp", "DBLP: empty title query"),
            arxiv=_stub("arxiv", "arXiv: empty query"),
            europepmc=_stub("europepmc", "EuropePMC: empty query"),
            openlibrary=_stub("openlibrary", "OpenLibrary: empty query"),
            use_local_db=False,
            use_persistent_cache=False,
            enable_link_validation=False,
        )
        res_skip = await orch_skip.retrieve(Citation(raw_text="...", title=None))
        assert res_skip.api_exhausted is False

    @pytest.mark.asyncio
    async def test_round1_worker_periodic_wait_and_drain_exception_isolation(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        engine = create_engine(
            f"sqlite:///{tmp_path / 'worker_wait.db'}",
            connect_args={"check_same_thread": False, "timeout": 30},
        )
        Base.metadata.create_all(bind=engine)
        run_migrations(engine)
        SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
        uploads_dir = tmp_path / "uploads"
        uploads_dir.mkdir(parents=True, exist_ok=True)

        recovery_calls = 0
        orig_recover = job_recovery.recover_orphaned_essay_jobs

        def _spy_recover(*args, **kwargs):
            nonlocal recovery_calls
            recovery_calls += 1
            return orig_recover(*args, **kwargs)

        monkeypatch.setattr(job_recovery, "recover_orphaned_essay_jobs", _spy_recover)
        try:
            # With recover_on_startup=False and max_iterations=1, iteration 1 must NOT fire immediate recovery!
            await run_worker_loop(
                pipeline_factory=lambda: MagicMock(),
                session_factory=SessionLocal,
                uploads_dir=uploads_dir,
                poll_interval=0.005,
                max_iterations=1,
                recover_on_startup=False,
                orphan_recovery_interval=10.0,
            )
            assert recovery_calls == 0
        finally:
            engine.dispose()
