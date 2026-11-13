"""Unit tests for Per-Source 3-State Circuit Breaker & Upstream Health Telemetry (Task 2 / B4-Part 1)."""

from __future__ import annotations

import asyncio
import threading
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest
from fastapi.testclient import TestClient

from integrity_checker.api.main import app
from integrity_checker.models.citation import Citation
from integrity_checker.models.source import SourceCandidate, SourceResult
from integrity_checker.retrieval.circuit_breaker import (
    CircuitBreakerRegistry,
    CircuitState,
    get_circuit_breaker_registry,
    reset_circuit_breaker_registry,
)
from integrity_checker.retrieval.crossref_client import CrossrefClient
from integrity_checker.retrieval.http_pool import close_loop_http_clients
from integrity_checker.retrieval.retrieval_orchestrator import RetrievalOrchestrator


def _http_response(
    status_code: int,
    *,
    json_data: object | None = None,
    headers: dict[str, str] | None = None,
    url: str = "https://api.crossref.org/works",
) -> httpx.Response:
    req = httpx.Request("GET", url)
    if json_data is not None:
        return httpx.Response(status_code, json=json_data, headers=headers, request=req)
    return httpx.Response(status_code, text="", headers=headers, request=req)


class TestCircuitBreakerStateMachine:
    """Verify CLOSED -> OPEN -> HALF_OPEN -> CLOSED/OPEN state transitions & telemetry."""

    def test_four_consecutive_infra_failures_trip_circuit_open_and_fast_fail_fifth_call(self) -> None:
        now = [100.0]
        registry = CircuitBreakerRegistry(
            failure_threshold=4,
            recovery_timeout_seconds=45.0,
            now_fn=lambda: now[0],
        )

        assert registry.allow_request("crossref") == (True, 0.0)

        registry.record_infra_failure("crossref", "TimeoutException: read timed out", latency_ms=1500.0)
        assert registry.snapshot_all()["crossref"]["state"] == CircuitState.CLOSED.value

        registry.record_infra_failure("crossref", "HTTP 503 Service Unavailable", latency_ms=400.0)
        assert registry.snapshot_all()["crossref"]["state"] == CircuitState.CLOSED.value

        registry.record_infra_failure("crossref", "httpx.ReadTimeout", latency_ms=1500.0)
        assert registry.snapshot_all()["crossref"]["state"] == CircuitState.CLOSED.value

        # 4th consecutive infra failure trips CLOSED -> OPEN
        registry.record_infra_failure("crossref", "Crossref: service unavailable (503)", latency_ms=300.0)
        snap = registry.snapshot_all()["crossref"]
        assert snap["state"] == CircuitState.OPEN.value
        assert snap["consecutive_failures"] == 4
        assert snap["total_calls"] == 4
        assert snap["success_count"] == 0
        assert snap["timeout_count"] == 2
        assert snap["http_5xx_count"] == 2
        assert snap["http_429_count"] == 0
        assert snap["ema_latency_ms"] > 0.0
        assert snap["open_remaining_seconds"] == pytest.approx(45.0)

        # 5th call immediately fast-fails with remaining > 0
        now[0] = 112.5
        allowed, remaining = registry.allow_request("crossref")
        assert allowed is False
        assert remaining == pytest.approx(32.5)
        assert remaining > 0.0

    @pytest.mark.asyncio
    async def test_orchestrator_trips_open_on_4_consecutive_timeouts_or_503s_and_skips_5th_http_call(
        self,
    ) -> None:
        now = [1000.0]
        registry = CircuitBreakerRegistry(
            failure_threshold=4,
            recovery_timeout_seconds=45.0,
            now_fn=lambda: now[0],
        )
        cr_client = CrossrefClient(contact_email="test@citra.io.vn", max_retries=1)
        orch = RetrievalOrchestrator(
            crossref=cr_client,
            circuit_breakers=registry,
            use_local_db=False,
            enable_link_validation=False,
        )

        http_calls = 0

        async def _flaky_upstream(self_http: httpx.AsyncClient, url: str, **kwargs) -> httpx.Response:
            nonlocal http_calls
            http_calls += 1
            if http_calls % 2 == 1:
                raise httpx.ReadTimeout("upstream read timed out")
            return _http_response(503, url=url)

        cit = Citation(
            raw_text="Le, V. (2024). Distributed Verification Benchmark.",
            title="Distributed Verification Benchmark",
            authors=["Le, V."],
            year="2024",
        )

        with patch.object(httpx.AsyncClient, "get", new=_flaky_upstream):
            for i in range(4):
                cand = await orch._lookup_with_ratelimit(cr_client, cit)
                assert cand.found is False, f"Attempt {i + 1} should fail"

            assert http_calls == 4
            snap = registry.snapshot_all()["crossref"]
            assert snap["state"] == CircuitState.OPEN.value
            assert snap["timeout_count"] == 2
            assert snap["http_5xx_count"] == 2

            # 5th call must fast-fail BEFORE touching httpx.AsyncClient.get
            cand_5 = await orch._lookup_with_ratelimit(cr_client, cit)
            assert cand_5.found is False
            assert cand_5.error == "circuit_open (45s remaining)"
            assert http_calls == 4

        await close_loop_http_clients()

    @pytest.mark.asyncio
    async def test_clean_404_and_no_results_scholarly_misses_record_success_and_stay_closed(
        self,
    ) -> None:
        registry = CircuitBreakerRegistry(failure_threshold=4, recovery_timeout_seconds=45.0)
        cr_client = CrossrefClient(contact_email="test@citra.io.vn", max_retries=1)
        orch = RetrievalOrchestrator(
            crossref=cr_client,
            circuit_breakers=registry,
            use_local_db=False,
            enable_link_validation=False,
        )
        orch._rate_limiters["crossref"]._base_min_interval = 0.0
        orch._rate_limiters["crossref"]._effective_interval = 0.0

        async def _clean_404_and_empty_200(
            self_http: httpx.AsyncClient, url: str, **kwargs
        ) -> httpx.Response:
            if "/works/10." in url:
                return _http_response(404, url=url)
            return _http_response(200, json_data={"message": {"items": []}}, url=url)

        with patch.object(httpx.AsyncClient, "get", new=_clean_404_and_empty_200):
            # 6 DOI-only 404 misses + 6 bibliographic empty HTTP 200 misses = 12 clean misses (>= 3x threshold)
            for idx in range(6):
                doi_only_cit = Citation(
                    raw_text=f"10.9999/nonexistent.{idx}",
                    doi=f"10.9999/nonexistent.{idx}",
                )
                cand_doi = await orch._lookup_with_ratelimit(cr_client, doi_only_cit)
                assert cand_doi.found is False

                bib_cit = Citation(
                    raw_text=f"Author {idx} (2023). Nonexistent Study {idx}.",
                    title=f"Nonexistent Study {idx}",
                    authors=[f"Author {idx}"],
                    year="2023",
                    doi=f"10.1000/missing.{idx}",
                )
                cand_bib = await orch._lookup_with_ratelimit(cr_client, bib_cit)
                assert cand_bib.found is False
                assert "no results for" in (cand_bib.error or "").lower()

        snap = registry.snapshot_all()["crossref"]
        assert snap["state"] == CircuitState.CLOSED.value
        assert snap["consecutive_failures"] == 0
        assert snap["total_calls"] == 12
        assert snap["success_count"] == 12
        assert registry.allow_request("crossref") == (True, 0.0)

        await close_loop_http_clients()

    def test_half_open_single_probe_guard_recovers_on_success_and_reopens_on_failure(self) -> None:
        now = [500.0]
        registry = CircuitBreakerRegistry(
            failure_threshold=4,
            recovery_timeout_seconds=45.0,
            now_fn=lambda: now[0],
        )

        for _ in range(4):
            registry.record_infra_failure("crossref", "HTTP 429 Too Many Requests", latency_ms=80.0)

        assert registry.snapshot_all()["crossref"]["state"] == CircuitState.OPEN.value
        assert registry.snapshot_all()["crossref"]["http_429_count"] == 4

        # Advance past cooldown -> 16 concurrent threads race to call allow_request("crossref")
        now[0] = 545.0
        barrier = threading.Barrier(16)

        def _contend() -> tuple[bool, float]:
            barrier.wait(timeout=5.0)
            return registry.allow_request("crossref")

        with ThreadPoolExecutor(max_workers=16) as pool:
            futs = [pool.submit(_contend) for _ in range(16)]
            outcomes = [f.result(timeout=5.0) for f in futs]

        admitted = [o for o in outcomes if o[0] is True]
        rejected = [o for o in outcomes if o[0] is False]
        assert len(admitted) == 1
        assert admitted[0] == (True, 0.0)
        assert len(rejected) == 15
        assert registry.snapshot_all()["crossref"]["state"] == CircuitState.HALF_OPEN.value

        # Case A: Failed probe immediately re-opens circuit for another 45s cooldown window
        now[0] = 546.0
        registry.record_infra_failure("crossref", "TimeoutException", latency_ms=2000.0)
        snap_reopened = registry.snapshot_all()["crossref"]
        assert snap_reopened["state"] == CircuitState.OPEN.value
        assert snap_reopened["open_remaining_seconds"] == pytest.approx(45.0)
        assert registry.allow_request("crossref") == (False, pytest.approx(45.0))

        # Advance another 45s -> admit single HALF_OPEN probe -> succeed -> resets to CLOSED
        now[0] = 591.0
        assert registry.allow_request("crossref") == (True, 0.0)
        assert registry.allow_request("crossref")[0] is False
        assert registry.snapshot_all()["crossref"]["state"] == CircuitState.HALF_OPEN.value

        registry.record_success("crossref", latency_ms=95.0)
        snap_closed = registry.snapshot_all()["crossref"]
        assert snap_closed["state"] == CircuitState.CLOSED.value
        assert snap_closed["consecutive_failures"] == 0
        assert snap_closed["success_count"] == 1
        assert snap_closed["open_remaining_seconds"] == 0.0
        assert registry.allow_request("crossref") == (True, 0.0)

    @pytest.mark.asyncio
    async def test_half_open_probe_cancelled_during_limiter_wait_releases_probe_and_avoids_deadlock(
        self,
    ) -> None:
        now = [200.0]
        registry = CircuitBreakerRegistry(
            failure_threshold=4,
            recovery_timeout_seconds=45.0,
            now_fn=lambda: now[0],
        )
        for _ in range(4):
            registry.record_infra_failure("crossref", "HTTP 503")
        assert registry.snapshot_all()["crossref"]["state"] == CircuitState.OPEN.value

        # Advance past cooldown so next caller becomes the single HALF_OPEN probe
        now[0] = 245.0

        entered_wait = asyncio.Event()
        hold_wait = asyncio.Event()

        async def _blocking_wait() -> None:
            entered_wait.set()
            await hold_wait.wait()

        mock_cr = MagicMock()
        mock_cr.name = "crossref"
        mock_cr.lookup = AsyncMock(
            return_value=SourceCandidate(
                source_name="crossref",
                found=True,
                title="Recovered Title",
                confidence=0.95,
            )
        )
        orch = RetrievalOrchestrator(
            crossref=mock_cr,
            circuit_breakers=registry,
            use_local_db=False,
            enable_link_validation=False,
        )
        orch._rate_limiters["crossref"].should_fast_fail = lambda: False  # type: ignore[method-assign]
        orch._rate_limiters["crossref"].wait = _blocking_wait  # type: ignore[method-assign]

        cit = Citation(raw_text="Test (2024). Probe Cancellation.", title="Probe Cancellation", year="2024")
        probe_task = asyncio.create_task(orch._lookup_with_ratelimit(mock_cr, cit))
        await entered_wait.wait()

        # While blocked in limiter.wait(), circuit is HALF_OPEN and blocks concurrent probes
        assert registry.snapshot_all()["crossref"]["state"] == CircuitState.HALF_OPEN.value
        assert registry.allow_request("crossref")[0] is False

        # Cancel probe during limiter.wait() -> must release probe_in_flight in finally!
        probe_task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await probe_task

        mock_cr.lookup.assert_not_called()
        assert registry.allow_request("crossref") == (True, 0.0)
        # Also verify safety lease expiry if a direct caller forgets to call release_probe
        assert registry.allow_request("crossref")[0] is False
        now[0] += 45.0
        assert registry.allow_request("crossref") == (True, 0.0)
        registry.record_success("crossref", latency_ms=50.0)
        assert registry.snapshot_all()["crossref"]["state"] == CircuitState.CLOSED.value

    @pytest.mark.asyncio
    async def test_local_rate_limiter_fast_fail_does_not_trip_circuit_or_reopen_half_open_probe(
        self,
    ) -> None:
        from integrity_checker.retrieval.openalex_client import OpenAlexClient

        now = [300.0]
        registry = CircuitBreakerRegistry(
            failure_threshold=4,
            recovery_timeout_seconds=45.0,
            now_fn=lambda: now[0],
        )
        oa_client = OpenAlexClient(contact_email="test@citra.io.vn", max_retries=1)
        orch = RetrievalOrchestrator(
            openalex=oa_client,
            circuit_breakers=registry,
            use_local_db=False,
            enable_link_validation=False,
        )

        http_calls = 0

        async def _429_long_retry_after(
            self_http: httpx.AsyncClient, url: str, **kwargs
        ) -> httpx.Response:
            nonlocal http_calls
            http_calls += 1
            return _http_response(429, headers={"Retry-After": "60"}, url=url)

        cit = Citation(
            raw_text="Pham, Q. (2024). Rate Limit Fast-Fail Isolation.",
            title="Rate Limit Fast-Fail Isolation",
            authors=["Pham, Q."],
            year="2024",
        )

        with patch.object(httpx.AsyncClient, "get", new=_429_long_retry_after):
            # 1st call hits real upstream HTTP 429 (Retry-After=60s > 8s fast-fail threshold)
            cand_1 = await orch._lookup_with_ratelimit(oa_client, cit)
            assert cand_1.found is False
            assert http_calls == 1
            assert orch._rate_limiters["openalex"].should_fast_fail() is True

            # Next 4 calls hit local RateLimiter fast-fail without touching the network
            for _ in range(4):
                cand_skip = await orch._lookup_with_ratelimit(oa_client, cit)
                assert cand_skip.found is False
                assert "skipped (rate-limit backoff active)" in (cand_skip.error or "")

            assert http_calls == 1
            snap = registry.snapshot_all()["openalex"]
            assert snap["state"] == CircuitState.CLOSED.value
            assert snap["total_calls"] == 1
            assert snap["http_429_count"] == 1
            assert snap["consecutive_failures"] == 1

            # Now trip circuit OPEN via 3 more real infra failures -> OPEN until t=345.0
            for _ in range(3):
                registry.record_infra_failure("openalex", "HTTP 503", latency_ms=100.0)
            assert registry.snapshot_all()["openalex"]["state"] == CircuitState.OPEN.value

            # At t=345.0, circuit cooldown elapsed, but local RateLimiter still has Retry-After=60s active.
            # Skipping via local limiter must release the HALF_OPEN probe rather than re-opening for 45s!
            now[0] = 345.0
            cand_half_skip = await orch._lookup_with_ratelimit(oa_client, cit)
            assert "skipped (rate-limit backoff active)" in (cand_half_skip.error or "")
            assert registry.snapshot_all()["openalex"]["state"] == CircuitState.HALF_OPEN.value
            assert registry.allow_request("openalex") == (True, 0.0)

        await close_loop_http_clients()

    @pytest.mark.asyncio
    async def test_non_404_client_4xx_responses_stay_closed_and_cloudflare_522_counts_as_5xx(
        self,
    ) -> None:
        registry = CircuitBreakerRegistry(failure_threshold=4, recovery_timeout_seconds=45.0)
        cr_client = CrossrefClient(contact_email="test@citra.io.vn", max_retries=1)
        orch = RetrievalOrchestrator(
            crossref=cr_client,
            circuit_breakers=registry,
            use_local_db=False,
            enable_link_validation=False,
        )
        orch._rate_limiters["crossref"]._base_min_interval = 0.0
        orch._rate_limiters["crossref"]._effective_interval = 0.0

        status_seq = [400, 422, 410, 400, 422, 400]
        call_idx = 0

        async def _malformed_4xx(self_http: httpx.AsyncClient, url: str, **kwargs) -> httpx.Response:
            nonlocal call_idx
            code = status_seq[call_idx % len(status_seq)]
            call_idx += 1
            return _http_response(code, url=url)

        with patch.object(httpx.AsyncClient, "get", new=_malformed_4xx):
            for idx in range(6):
                cit = Citation(
                    raw_text=f"Corrupted OCR Query {idx} %%%",
                    title=f"Corrupted OCR Query {idx}",
                    year="2023",
                )
                cand = await orch._lookup_with_ratelimit(cr_client, cit)
                assert cand.found is False

        snap_4xx = registry.snapshot_all()["crossref"]
        assert snap_4xx["state"] == CircuitState.CLOSED.value
        assert snap_4xx["consecutive_failures"] == 0
        assert snap_4xx["success_count"] == 6
        assert snap_4xx["http_5xx_count"] == 0

        # Also verify direct httpx.HTTPStatusError on 400 Bad Request does not trip or increment 5xx
        mock_400_client = MagicMock()
        mock_400_client.name = "dblp"
        req_400 = httpx.Request("GET", "https://dblp.org/search/publ/api")
        resp_400 = httpx.Response(400, request=req_400)
        mock_400_client.lookup = AsyncMock(
            side_effect=httpx.HTTPStatusError("400 Bad Request", request=req_400, response=resp_400)
        )
        orch._rate_limiters["dblp"]._base_min_interval = 0.0
        orch._rate_limiters["dblp"]._effective_interval = 0.0
        for _ in range(4):
            with pytest.raises(httpx.HTTPStatusError):
                await orch._lookup_with_ratelimit(
                    mock_400_client,
                    Citation(raw_text="Bad Query", title="Bad Query", year="2023"),
                )
        snap_dblp = registry.snapshot_all()["dblp"]
        assert snap_dblp["state"] == CircuitState.CLOSED.value
        assert snap_dblp["consecutive_failures"] == 0
        assert snap_dblp["http_5xx_count"] == 0

        # Verify Cloudflare 520 / 522 / 524 server errors count under http_5xx_count and trip circuit OPEN
        for code in (520, 522, 524, 522):
            registry.record_infra_failure("europepmc", f"HTTP {code} Origin Unreachable")
        snap_522 = registry.snapshot_all()["europepmc"]
        assert snap_522["state"] == CircuitState.OPEN.value
        assert snap_522["http_5xx_count"] == 4

        await close_loop_http_clients()


class TestNegativeCacheCircuitOpenGuard:
    """Verify Review Focus #5: never negative-cache partial results degraded by an open circuit."""

    @pytest.mark.asyncio
    async def test_is_cacheable_clean_miss_rejects_circuit_open_and_skips_negative_cache(self) -> None:
        cit = Citation(
            raw_text="Phantom, A. (2023). Unverified Study Under Degraded Upstream. NeurIPS.",
            title="Unverified Study Under Degraded Upstream",
            authors=["Phantom, A."],
            year="2023",
            venue="NeurIPS",
        )
        degraded_result = SourceResult(
            citation_raw=cit.raw_text,
            candidates=[],
            sources_queried=["crossref", "openalex", "dblp", "arxiv"],
            sources_succeeded=[],
            sources_failed={
                "crossref": "circuit_open (42s remaining)",
                "openalex": "OpenAlex: no results for 'Unverified Study'",
                "dblp": "DBLP: no results for 'Unverified Study'",
                "arxiv": "arXiv: no results for 'Unverified Study'",
            },
        )
        assert RetrievalOrchestrator._is_cacheable_clean_miss(cit, degraded_result) is False

        # Also verify live RetrievalOrchestrator.retrieve() does NOT populate _negative_cache when circuit is OPEN
        registry = CircuitBreakerRegistry(failure_threshold=4, recovery_timeout_seconds=45.0)
        for _ in range(4):
            registry.record_infra_failure("crossref", "HTTP 503")

        def _clean_miss_mock(name: str) -> MagicMock:
            m = MagicMock()
            m.name = name
            m.lookup = AsyncMock(
                return_value=SourceCandidate(
                    source_name=name,
                    found=False,
                    error=f"{name}: no results for 'Unverified Study'",
                )
            )
            return m

        mock_cr = _clean_miss_mock("crossref")
        orch = RetrievalOrchestrator(
            crossref=mock_cr,
            openalex=_clean_miss_mock("openalex"),
            dblp=_clean_miss_mock("dblp"),
            arxiv=_clean_miss_mock("arxiv"),
            datacite=_clean_miss_mock("datacite"),
            openaire_hal=_clean_miss_mock("openaire_hal"),
            wikidata_opencitations=_clean_miss_mock("wikidata_opencitations"),
            openlibrary=_clean_miss_mock("openlibrary"),
            circuit_breakers=registry,
            use_local_db=False,
            enable_link_validation=False,
        )

        res = await orch.retrieve(cit, allow_serpapi=False)
        mock_cr.lookup.assert_not_called()
        assert "circuit_open" in (res.sources_failed.get("crossref") or "")
        assert len(orch._negative_cache) == 0


class TestSystemHealthUpstreamTelemetry:
    """Verify GET /api/system/health exposes upstream_sources without breaking existing payload."""

    def test_system_health_includes_upstream_sources_snapshot(self) -> None:
        from integrity_checker.db.models import (
            CitationRecord,
            ClassMembership,
            EssayRecord,
            User,
            VerdictRecord,
        )
        from integrity_checker.db.models import (
            Class as ClassModel,
        )
        from integrity_checker.db.models import (
            Session as SessionModel,
        )
        from integrity_checker.db.session import get_session

        reset_circuit_breaker_registry()
        reg = get_circuit_breaker_registry()
        reg.record_success("openalex", latency_ms=140.0)
        reg.record_infra_failure("crossref", "HTTP 429 rate limit", latency_ms=210.0)

        session = get_session()
        try:
            session.query(VerdictRecord).delete()
            session.query(CitationRecord).delete()
            session.query(EssayRecord).delete()
            session.query(ClassMembership).delete()
            session.query(ClassModel).delete()
            session.query(SessionModel).delete()
            session.query(User).delete()
            session.commit()

            client = TestClient(app)
            login_resp = client.post(
                "/api/auth/login",
                json={"username": "admin", "password": "admin123"},
            )
            assert login_resp.status_code == 200, login_resp.text
            token = login_resp.json()["token"]

            resp = client.get(
                "/api/system/health",
                headers={"Authorization": f"Bearer {token}"},
            )
            assert resp.status_code == 200, resp.text
            data = resp.json()

            # Preserve all existing keys
            for required_key in (
                "status",
                "services",
                "parser_mode",
                "grobid_available",
                "totals",
                "verdict_label_counts",
                "cache_stats",
                "upstream_sources",
            ):
                assert required_key in data, f"Missing key '{required_key}' in /api/system/health"

            upstream = data["upstream_sources"]
            assert upstream["openalex"]["state"] == "closed"
            assert upstream["openalex"]["success_count"] == 1
            assert upstream["openalex"]["ema_latency_ms"] == pytest.approx(140.0)
            assert upstream["crossref"]["http_429_count"] == 1
            assert upstream["crossref"]["consecutive_failures"] == 1
        finally:
            session.query(VerdictRecord).delete()
            session.query(CitationRecord).delete()
            session.query(EssayRecord).delete()
            session.query(ClassMembership).delete()
            session.query(ClassModel).delete()
            session.query(SessionModel).delete()
            session.query(User).delete()
            session.commit()
            session.close()
            reset_circuit_breaker_registry()
