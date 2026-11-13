"""Unit tests for Per-Source 3-State Circuit Breaker & Upstream Health Telemetry (Task 2 / B4-Part 1)."""

from __future__ import annotations

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
