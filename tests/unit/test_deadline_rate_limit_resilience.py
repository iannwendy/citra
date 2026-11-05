"""Comprehensive test suite for Deadline Upload Burst & HTTP 429 Rate-Limit Resilience.

Covers all 4 architectural layers:
    Layer 1: Process-wide FIFO PipelineAdmissionController (live queue_position & cancellation),
             bounded GROBID semaphore, and cross-loop global retrieval semaphore.
    Layer 2: Cross-event-loop Singleflight request coalescing & verified clean-miss TTL Negative Cache.
    Layer 3: Adaptive AIMD RateLimiter, Retry-After header parsing, shared Keep-Alive HTTP pools,
             task-isolated ContextVar HTTP telemetry, and explicit 429 reporting across all clients.
    Layer 4: Tier-2 backup rescue on 429, Smart Quota Guard under partial secondary 429s,
             and SymbolicRules R-RATE-LIMITED-ABSTAIN anti-false-hallucination protection.
"""

from __future__ import annotations

import asyncio
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from email.utils import format_datetime
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from integrity_checker.api.progress import PipelineAdmissionController, ProgressTracker
from integrity_checker.config import GrobidConfig
from integrity_checker.extraction.grobid_parser import call_grobid_fulltext
from integrity_checker.logic.rules import SymbolicRules
from integrity_checker.models.citation import Citation, CitationStyle, CitationType
from integrity_checker.models.source import SourceCandidate, SourceResult
from integrity_checker.models.validation import MatchFeatures, ValidationLabel
from integrity_checker.pipeline.integrity_pipeline import _CrossLoopAsyncSemaphore
from integrity_checker.retrieval.datacite_client import DataCiteClient
from integrity_checker.retrieval.doaj_client import DOAJClient
from integrity_checker.retrieval.doi_ra_client import DoiRaClient
from integrity_checker.retrieval.europepmc_client import EuropePMCClient
from integrity_checker.retrieval.http_pool import (
    close_loop_http_clients,
    get_shared_http_client,
    parse_retry_after,
)
from integrity_checker.retrieval.huggingface_client import HuggingFaceClient
from integrity_checker.retrieval.ncbi_biorxiv_client import NcbiBiorxivClient
from integrity_checker.retrieval.openaire_hal_client import OpenAIREHalClient
from integrity_checker.retrieval.openalex_client import OpenAlexClient
from integrity_checker.retrieval.openlibrary_client import OpenLibraryClient
from integrity_checker.retrieval.rate_limiter import RateLimiter
from integrity_checker.retrieval.retrieval_orchestrator import (
    RetrievalOrchestrator,
    _TTLNegativeCache,
)
from integrity_checker.retrieval.tech_standard_client import TechStandardClient
from integrity_checker.retrieval.wikidata_opencitations_client import (
    WikidataOpenCitationsClient,
)


def _http_response(
    status_code: int,
    *,
    json_data: object | None = None,
    text: str = "",
    headers: dict[str, str] | None = None,
    url: str = "https://api.example.org/test",
) -> httpx.Response:
    req = httpx.Request("GET", url)
    if json_data is not None:
        return httpx.Response(
            status_code,
            json=json_data,
            headers=headers,
            request=req,
        )
    return httpx.Response(
        status_code,
        text=text,
        headers=headers,
        request=req,
    )


# ===========================================================================
# LAYER 1: Bounded Job Queue, GROBID Semaphore & Cross-Loop Retrieval Gate
# ===========================================================================


class TestLayer1AdmissionQueueAndSemaphores:
    """Verify bounded concurrency & FIFO admission under 50-student deadline upload storms."""

    @pytest.mark.asyncio
    async def test_50_student_deadline_burst_fifo_admission_and_live_queue_positions(self) -> None:
        controller = PipelineAdmissionController(max_concurrent=3)
        tracker = ProgressTracker()
        tracker._persist_snapshot = lambda *_args, **_kwargs: None  # type: ignore[method-assign]

        total_students = 50
        for eid in range(1, total_students + 1):
            tracker.init(eid)

        active_now = 0
        peak_active = 0
        admitted_order: list[int] = []
        hold_first_wave = asyncio.Event()
        first_wave_ready = asyncio.Event()
        all_queued_ready = asyncio.Event()
        lock = threading.Lock()

        async def _student_job(essay_id: int) -> None:
            nonlocal active_now, peak_active
            async with controller.acquire(essay_id, tracker=tracker) as admitted:
                assert admitted is True
                with lock:
                    active_now += 1
                    peak_active = max(peak_active, active_now)
                    admitted_order.append(essay_id)
                    if len(admitted_order) == 3:
                        first_wave_ready.set()

                snap = tracker.get(essay_id)
                assert snap is not None
                assert snap.status == "processing"
                assert snap.queue_position is None

                if essay_id <= 3:
                    await hold_first_wave.wait()
                else:
                    await asyncio.sleep(0.002)

                with lock:
                    active_now -= 1
            tracker.complete(essay_id)

        tasks: list[asyncio.Task[None]] = []
        for eid in range(1, total_students + 1):
            tasks.append(asyncio.create_task(_student_job(eid)))
            await asyncio.sleep(0)  # preserve submission order across event-loop ticks
            if eid == total_students:
                all_queued_ready.set()

        await first_wave_ready.wait()
        await all_queued_ready.wait()
        await asyncio.sleep(0.01)

        # Exactly 3 running, 47 waiting in FIFO order with 1-indexed queue positions 1..47
        assert controller.active_count == 3
        assert controller.waiting_count == 47
        for idx, eid in enumerate(range(4, total_students + 1), start=1):
            st = tracker.get(eid)
            assert st is not None
            assert st.status == "queued"
            assert st.queue_position == idx

        # Release the first wave and let all 50 finish
        hold_first_wave.set()
        await asyncio.gather(*tasks)

        assert peak_active == 3
        assert controller.active_count == 0
        assert controller.waiting_count == 0
        assert admitted_order == list(range(1, total_students + 1))
        for eid in range(1, total_students + 1):
            st = tracker.get(eid)
            assert st is not None
            assert st.status == "completed"
            assert st.queue_position is None

    @pytest.mark.asyncio
    async def test_queued_essay_cancellation_wakes_immediately_and_shifts_queue_positions(self) -> None:
        controller = PipelineAdmissionController(max_concurrent=2)
        tracker = ProgressTracker()
        tracker._persist_snapshot = lambda *_args, **_kwargs: None  # type: ignore[method-assign]

        for eid in range(1, 7):
            tracker.init(eid)

        release_active = asyncio.Event()
        executed_ids: list[int] = []

        async def _worker(eid: int) -> bool:
            async with controller.acquire(eid, tracker=tracker) as admitted:
                if not admitted:
                    return False
                executed_ids.append(eid)
                if eid <= 2:
                    await release_active.wait()
                return True

        t_list: list[asyncio.Task[bool]] = []
        for eid in range(1, 7):
            t_list.append(asyncio.create_task(_worker(eid)))
            await asyncio.sleep(0)

        await asyncio.sleep(0.01)
        # Essays 1, 2 active; Essays 3, 4, 5, 6 queued at positions 1, 2, 3, 4
        assert tracker.get(3).queue_position == 1  # type: ignore[union-attr]
        assert tracker.get(4).queue_position == 2  # type: ignore[union-attr]
        assert tracker.get(5).queue_position == 3  # type: ignore[union-attr]
        assert tracker.get(6).queue_position == 4  # type: ignore[union-attr]

        # Delete/cancel queued Essay #4 -> wakes immediately with admitted=False and shifts #5->2, #6->3
        cancelled = controller.cancel(4)
        assert cancelled is True
        res_4 = await asyncio.wait_for(t_list[3], timeout=1.0)
        assert res_4 is False
        assert tracker.get(3).queue_position == 1  # type: ignore[union-attr]
        assert tracker.get(5).queue_position == 2  # type: ignore[union-attr]
        assert tracker.get(6).queue_position == 3  # type: ignore[union-attr]

        release_active.set()
        outcomes = await asyncio.gather(*t_list)
        assert outcomes == [True, True, True, False, True, True]
        assert executed_ids == [1, 2, 3, 5, 6]

    def test_grobid_bounded_semaphore_caps_concurrent_pdf_extractions(self, tmp_path) -> None:
        pdf_file = tmp_path / "sample.pdf"
        pdf_file.write_bytes(b"%PDF-1.4 dummy pdf content")

        active = 0
        peak = 0
        lock = threading.Lock()

        def _fake_grobid_post(url, files, data, timeout):
            nonlocal active, peak
            with lock:
                active += 1
                peak = max(peak, active)
            time.sleep(0.025)
            with lock:
                active -= 1
            resp = MagicMock()
            resp.status_code = 200
            resp.text = "<TEI></TEI>"
            return resp

        fake_settings = MagicMock()
        fake_settings.retrieval.max_concurrent_grobid = 2

        with patch("integrity_checker.config.get_settings", return_value=fake_settings):
            with ThreadPoolExecutor(max_workers=10) as pool:
                cfg = GrobidConfig(enabled=True, url="http://localhost:8070")
                futures = [
                    pool.submit(call_grobid_fulltext, str(pdf_file), cfg, _fake_grobid_post)
                    for _ in range(10)
                ]
                results = [f.result(timeout=5.0) for f in futures]

        assert all(r == "<TEI></TEI>" for r in results)
        assert peak == 2

    def test_global_cross_loop_retrieval_semaphore_caps_multi_thread_event_loops(self) -> None:
        sem = _CrossLoopAsyncSemaphore(limit=4)
        active = 0
        peak = 0
        completed = 0
        lock = threading.Lock()

        def _thread_runner() -> None:
            async def _batch() -> None:
                nonlocal active, peak, completed

                async def _one() -> None:
                    nonlocal active, peak, completed
                    async with sem.acquire():
                        with lock:
                            active += 1
                            peak = max(peak, active)
                        await asyncio.sleep(0.015)
                        with lock:
                            active -= 1
                            completed += 1

                await asyncio.gather(*(_one() for _ in range(6)))

            asyncio.run(_batch())

        with ThreadPoolExecutor(max_workers=4) as pool:
            futs = [pool.submit(_thread_runner) for _ in range(4)]
            for f in futs:
                f.result(timeout=10.0)

        assert completed == 24
        assert peak <= 4
        assert sem.active_count == 0

    @pytest.mark.asyncio
    async def test_api_status_and_delete_endpoints_expose_queue_position_and_cancel_queued_essay(
        self,
    ) -> None:
        from fastapi import BackgroundTasks
        from sqlalchemy import create_engine
        from sqlalchemy.orm import sessionmaker

        from integrity_checker.api.routes.essays import delete_essay, get_essay_status
        from integrity_checker.db.models import Base, EssayRecord, User

        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine)
        session = sessionmaker(bind=engine)()

        student = User(
            username="student_deadline",
            email="student_deadline@citra.io.vn",
            password_hash="x",
            full_name="Student Deadline",
            role="user",
            email_verified=True,
        )
        session.add(student)
        session.commit()
        session.refresh(student)

        essays: list[EssayRecord] = []
        for idx in range(1, 5):
            e = EssayRecord(
                filename=f"thesis_{idx}.pdf",
                num_pages=10,
                user_id=student.id,
            )
            session.add(e)
            session.commit()
            session.refresh(e)
            essays.append(e)

        custom_controller = PipelineAdmissionController(max_concurrent=1)
        custom_tracker = ProgressTracker()
        custom_tracker._persist_snapshot = lambda *_a, **_kw: None  # type: ignore[method-assign]
        for e in essays:
            custom_tracker.init(e.id)

        hold_slot = asyncio.Event()

        async def _slot_worker(eid: int) -> bool:
            async with custom_controller.acquire(eid, tracker=custom_tracker) as admitted:
                if not admitted:
                    return False
                if eid == essays[0].id:
                    await hold_slot.wait()
                return True

        with (
            patch(
                "integrity_checker.api.routes.essays.get_pipeline_admission_controller",
                return_value=custom_controller,
            ),
            patch(
                "integrity_checker.api.routes.essays.get_tracker",
                return_value=custom_tracker,
            ),
        ):
            worker_tasks = []
            for e in essays:
                worker_tasks.append(asyncio.create_task(_slot_worker(e.id)))
                await asyncio.sleep(0)
            await asyncio.sleep(0.01)

            bg = BackgroundTasks()
            st_1 = get_essay_status(essays[0].id, bg, current_user=student, db=session)
            st_2 = get_essay_status(essays[1].id, bg, current_user=student, db=session)
            st_3 = get_essay_status(essays[2].id, bg, current_user=student, db=session)
            st_4 = get_essay_status(essays[3].id, bg, current_user=student, db=session)

            assert st_1["status"] == "processing"
            assert st_1["queue_position"] is None
            assert st_2["status"] == "queued" and st_2["queue_position"] == 1
            assert st_3["status"] == "queued" and st_3["queue_position"] == 2
            assert st_4["status"] == "queued" and st_4["queue_position"] == 3

            # Student cancels queued essay #3 via DELETE /api/essays/{id}
            del_resp = delete_essay(essays[2].id, current_user=student, db=session)
            assert "deleted" in del_resp["message"]
            assert await asyncio.wait_for(worker_tasks[2], timeout=1.0) is False

            # Essay #4 immediately shifts from queue_position 3 -> 2 on GET /status!
            st_4_after = get_essay_status(essays[3].id, bg, current_user=student, db=session)
            assert st_4_after["status"] == "queued"
            assert st_4_after["queue_position"] == 2

            hold_slot.set()
            outcomes = await asyncio.gather(*worker_tasks)
            assert outcomes == [True, True, False, True]

        session.close()


# ===========================================================================
# LAYER 2: Cross-Loop Singleflight Coalescing & TTL Negative Cache
# ===========================================================================


class TestLayer2SingleflightAndNegativeCache:
    """Verify Singleflight coalesces concurrent identical citations and Negative Cache stores only clean misses."""

    @pytest.mark.asyncio
    async def test_singleflight_coalesces_30_concurrent_coroutines_into_one_api_call(self) -> None:
        crossref_calls = 0
        openalex_calls = 0

        async def _slow_crossref(_cit: Citation) -> SourceCandidate:
            nonlocal crossref_calls
            crossref_calls += 1
            await asyncio.sleep(0.04)
            return SourceCandidate(
                source_name="crossref",
                found=True,
                doi="10.1145/3394486.3403043",
                title="Graph Neural Networks for Academic Citation Verification",
                authors=["Nguyen, A.", "Tran, B."],
                year="2023",
                venue="KDD",
                confidence=0.95,
            )

        async def _slow_openalex(_cit: Citation) -> SourceCandidate:
            nonlocal openalex_calls
            openalex_calls += 1
            await asyncio.sleep(0.04)
            return SourceCandidate(
                source_name="openalex",
                found=True,
                doi="10.1145/3394486.3403043",
                title="Graph Neural Networks for Academic Citation Verification",
                authors=["Nguyen, A.", "Tran, B."],
                year="2023",
                venue="KDD",
                abstract="We present a scalable architecture for citation verification.",
                confidence=0.94,
            )

        mock_cr = MagicMock(name="crossref_mock")
        mock_cr.name = "crossref"
        mock_cr.lookup = AsyncMock(side_effect=_slow_crossref)

        mock_oa = MagicMock(name="openalex_mock")
        mock_oa.name = "openalex"
        mock_oa.lookup = AsyncMock(side_effect=_slow_openalex)

        mock_dblp = MagicMock(name="dblp_mock")
        mock_dblp.name = "dblp"
        mock_dblp.lookup = AsyncMock(
            return_value=SourceCandidate(source_name="dblp", found=False, error="DBLP: no results")
        )

        orch = RetrievalOrchestrator(
            crossref=mock_cr,
            openalex=mock_oa,
            dblp=mock_dblp,
            use_local_db=False,
            enable_link_validation=False,
        )

        # 30 classmates citing the exact same paper with different bibliography numbering [1]..[30]
        citations = [
            Citation(
                raw_text=f"[{i}] Nguyen, A., & Tran, B. (2023). Graph Neural Networks for Academic Citation Verification. KDD.",
                title="Graph Neural Networks for Academic Citation Verification",
                authors=["Nguyen, A.", "Tran, B."],
                year="2023",
                doi="10.1145/3394486.3403043",
            )
            for i in range(1, 31)
        ]

        results = await asyncio.gather(*(orch.retrieve(c) for c in citations))

        assert crossref_calls == 1
        assert openalex_calls == 1
        assert orch._singleflight.coalesced_hits == 29
        assert len(results) == 30
        for idx, res in enumerate(results, start=1):
            assert len(res.candidates) == 1
            assert res.citation_raw.startswith(f"[{idx}]")

        # Verify deep-copy isolation across followers
        results[0].candidates[0].title = "MUTATED_BY_STUDENT_1"
        assert results[1].candidates[0].title == "Graph Neural Networks for Academic Citation Verification"
        assert results[29].candidates[0].title == "Graph Neural Networks for Academic Citation Verification"

    def test_singleflight_coalesces_across_multiple_worker_threads_and_event_loops(self) -> None:
        call_count = 0
        lock = threading.Lock()
        barrier = threading.Barrier(8)

        async def _crossref_lookup(_cit: Citation) -> SourceCandidate:
            nonlocal call_count
            with lock:
                call_count += 1
            await asyncio.sleep(0.06)
            return SourceCandidate(
                source_name="crossref",
                found=True,
                doi="10.1109/TSE.2022.3189012",
                title="Resilient Distributed Rate Control in Scholarly Pipelines",
                authors=["Le, H.", "Pham, Q."],
                year="2022",
                venue="IEEE TSE",
                confidence=0.95,
            )

        async def _openalex_lookup(_cit: Citation) -> SourceCandidate:
            await asyncio.sleep(0.05)
            return SourceCandidate(
                source_name="openalex",
                found=True,
                doi="10.1109/TSE.2022.3189012",
                title="Resilient Distributed Rate Control in Scholarly Pipelines",
                authors=["Le, H.", "Pham, Q."],
                year="2022",
                abstract="Distributed rate control abstract.",
                confidence=0.93,
            )

        mock_cr = MagicMock()
        mock_cr.name = "crossref"
        mock_cr.lookup = AsyncMock(side_effect=_crossref_lookup)

        mock_oa = MagicMock()
        mock_oa.name = "openalex"
        mock_oa.lookup = AsyncMock(side_effect=_openalex_lookup)

        mock_dblp = MagicMock()
        mock_dblp.name = "dblp"
        mock_dblp.lookup = AsyncMock(
            return_value=SourceCandidate(source_name="dblp", found=False, error="DBLP: no results")
        )

        orch = RetrievalOrchestrator(
            crossref=mock_cr,
            openalex=mock_oa,
            dblp=mock_dblp,
            use_local_db=False,
            enable_link_validation=False,
        )

        def _worker_thread(idx: int) -> SourceResult:
            cit = Citation(
                raw_text=f"[{idx}] Le, H., & Pham, Q. (2022). Resilient Distributed Rate Control in Scholarly Pipelines.",
                title="Resilient Distributed Rate Control in Scholarly Pipelines",
                authors=["Le, H.", "Pham, Q."],
                year="2022",
                doi="10.1109/TSE.2022.3189012",
            )
            barrier.wait(timeout=5.0)
            return asyncio.run(orch.retrieve(cit))

        with ThreadPoolExecutor(max_workers=8) as pool:
            futs = [pool.submit(_worker_thread, i) for i in range(1, 9)]
            thread_results = [f.result(timeout=10.0) for f in futs]

        assert call_count == 1
        assert all(len(r.candidates) == 1 for r in thread_results)
        assert {r.citation_raw.split(" ")[0] for r in thread_results} == {
            f"[{i}]" for i in range(1, 9)
        }

    @pytest.mark.asyncio
    async def test_ttl_negative_cache_stores_verified_clean_miss_and_never_caches_http_429(self) -> None:
        cr_responses = [
            # Attempt 1: HTTP 429 transient storm -> MUST NOT be cached
            SourceCandidate(source_name="crossref", found=False, error="Crossref: rate limited (429)"),
            # Attempt 2: Clean HTTP 200 miss -> MUST be cached
            SourceCandidate(source_name="crossref", found=False, error="Crossref: no results for 'Nonexistent Paper'"),
        ]
        cr_idx = 0

        async def _cr_lookup(_c: Citation) -> SourceCandidate:
            nonlocal cr_idx
            out = cr_responses[min(cr_idx, len(cr_responses) - 1)]
            cr_idx += 1
            return out

        def _clean_miss_client(name: str):
            m = MagicMock()
            m.name = name
            m.lookup = AsyncMock(
                return_value=SourceCandidate(
                    source_name=name,
                    found=False,
                    error=f"{name}: no results for 'Nonexistent Paper'",
                )
            )
            return m

        mock_cr = MagicMock()
        mock_cr.name = "crossref"
        mock_cr.lookup = AsyncMock(side_effect=_cr_lookup)

        oa_client = _clean_miss_client("openalex")
        dblp_client = _clean_miss_client("dblp")
        arxiv_client = _clean_miss_client("arxiv")
        dc_client = _clean_miss_client("datacite")
        oa_hal_client = _clean_miss_client("openaire_hal")
        wk_client = _clean_miss_client("wikidata_opencitations")
        ol_client = _clean_miss_client("openlibrary")

        orch = RetrievalOrchestrator(
            crossref=mock_cr,
            openalex=oa_client,
            dblp=dblp_client,
            arxiv=arxiv_client,
            datacite=dc_client,
            openaire_hal=oa_hal_client,
            wikidata_opencitations=wk_client,
            openlibrary=ol_client,
            use_local_db=False,
            enable_link_validation=False,
        )

        fake_cit = Citation(
            raw_text="Vance, R. (2023). Quantum Hyper-Attention for Imaginary Graphs. Journal of AI.",
            title="Quantum Hyper-Attention for Imaginary Graphs",
            authors=["Vance, R."],
            year="2023",
            venue="Journal of AI",
        )

        # 1st lookup suffers 429 on Crossref -> NOT cached in _negative_cache
        res_1 = await orch.retrieve(fake_cit, allow_serpapi=False)
        assert res_1.candidates == []
        assert len(orch._negative_cache) == 0

        # Clear Crossref's short transient backoff so 2nd lookup queries Crossref again
        orch._rate_limiters["crossref"] = RateLimiter(25.0)

        # 2nd lookup gets clean HTTP 200 misses across all queried APIs -> cached in _negative_cache!
        res_2 = await orch.retrieve(fake_cit, allow_serpapi=False)
        assert res_2.candidates == []
        assert len(orch._negative_cache) == 1
        oa_calls_after_2 = oa_client.lookup.await_count

        # Next 15 students submitting the same fabricated citation hit Negative Cache with 0 API calls
        for idx in range(15):
            dup_cit = Citation(
                raw_text=f"[{idx + 1}] Vance, R. (2023). Quantum Hyper-Attention for Imaginary Graphs.",
                title="Quantum Hyper-Attention for Imaginary Graphs",
                authors=["Vance, R."],
                year="2023",
                venue="Journal of AI",
            )
            cached_res = await orch.retrieve(dup_cit, allow_serpapi=False)
            assert cached_res.candidates == []
            assert cached_res.citation_raw.startswith(f"[{idx + 1}]")

        assert oa_client.lookup.await_count == oa_calls_after_2
        assert orch._negative_cache.hits == 15

        # Verify TTL expiry evicts cleanly
        tiny_cache = _TTLNegativeCache(ttl_seconds=1, max_entries=2)
        tiny_cache.set("k1", res_2)
        assert tiny_cache.get("k1") is not None
        # Force monotonic expiry check
        key_only, (_, stored_val) = next(iter(tiny_cache._store.items()))
        tiny_cache._store[key_only] = (time.monotonic() - 0.1, stored_val)
        assert tiny_cache.get("k1") is None


# ===========================================================================
# LAYER 3: Adaptive AIMD RateLimiter, HTTP Pool, & Race-Free 429 Telemetry
# ===========================================================================


class TestLayer3AdaptiveRateLimiterAndClientTelemetry:
    """Verify Retry-After parsing, AIMD rate control, shared HTTP pool, and race-free 429 telemetry."""

    def test_parse_retry_after_delta_seconds_http_date_and_ratelimit_reset(self) -> None:
        assert parse_retry_after({"Retry-After": "12"}) == 12.0
        assert parse_retry_after({"retry-after": "2.5"}) == 2.5
        assert parse_retry_after({"Retry-After": "9999"}) == 120.0
        assert parse_retry_after({"RateLimit-Reset": "7"}) == 7.0

        future_dt = datetime.now(UTC) + timedelta(seconds=15)
        http_date = format_datetime(future_dt, usegmt=True)
        parsed_date = parse_retry_after({"Retry-After": http_date})
        assert parsed_date is not None
        assert 12.0 <= parsed_date <= 17.0

    @pytest.mark.asyncio
    async def test_adaptive_aimd_rate_limiter_halves_rate_honors_retry_after_and_recovers(self) -> None:
        limiter = RateLimiter(calls_per_second=10.0)
        assert limiter.effective_calls_per_second == 10.0
        assert limiter.should_fast_fail() is False

        # First 429 without Retry-After -> halves rate to 5.0 and sets ~2s backoff (<=2.5s: no fast-fail)
        limiter.report_rate_limited()
        assert limiter.effective_calls_per_second == pytest.approx(5.0)
        assert limiter.consecutive_failures == 1
        assert limiter.is_in_backoff() is True
        assert limiter.should_fast_fail() is False

        # Second 429 with explicit Retry-After: 9.0 -> halves rate to 2.5 and sets >=9s backoff (fast-fail True!)
        limiter.report_rate_limited(retry_after=9.0)
        assert limiter.effective_calls_per_second == pytest.approx(2.5)
        assert limiter.consecutive_failures == 2
        assert limiter.remaining_backoff() >= 8.5
        assert limiter.should_fast_fail() is True

        # Sustained successes clear backoff and additively restore rate back up to 10.0 (never exceeding base)
        for _ in range(80):
            limiter.report_success()
        assert limiter.consecutive_failures == 0
        assert limiter.is_in_backoff() is False
        assert limiter.effective_calls_per_second == pytest.approx(10.0)

    @pytest.mark.asyncio
    async def test_shared_http_pool_reuses_keepalive_per_loop_and_isolates_across_loops(self) -> None:
        c1 = get_shared_http_client(follow_redirects=True)
        c2 = get_shared_http_client(follow_redirects=True)
        c_no_redirect = get_shared_http_client(follow_redirects=False)
        assert c1 is c2
        assert c1 is not c_no_redirect
        assert not c1.is_closed

        other_loop_client_id: list[int] = []

        def _in_other_thread() -> None:
            async def _grab() -> None:
                c_other = get_shared_http_client(follow_redirects=True)
                other_loop_client_id.append(id(c_other))
                await close_loop_http_clients()
                assert c_other.is_closed

            asyncio.run(_grab())

        t = threading.Thread(target=_in_other_thread)
        t.start()
        t.join(timeout=5.0)

        assert other_loop_client_id[0] != id(c1)
        assert not c1.is_closed  # closing worker thread's loop pool did NOT close main loop's pool!

        await close_loop_http_clients()
        assert c1.is_closed
        assert c_no_redirect.is_closed
        c3 = get_shared_http_client(follow_redirects=True)
        assert c3 is not c1
        await close_loop_http_clients()

    @pytest.mark.asyncio
    async def test_task_scoped_http_telemetry_has_zero_cross_coroutine_race_and_preserves_429(self) -> None:
        from integrity_checker.retrieval.http_pool import (
            get_task_http_status,
            record_task_http_status,
            reset_task_http_status,
        )

        # Verify parent -> child asyncio.create_task copy-on-write isolation
        reset_task_http_status("openalex")
        record_task_http_status("openalex", 429, retry_after=9.0)
        assert get_task_http_status("openalex")[0] == 429

        async def _child_task_check() -> tuple[int | None, int | None]:
            inherited = get_task_http_status("openalex")[0]
            record_task_http_status("openalex", 200)
            return inherited, get_task_http_status("openalex")[0]

        child_inherited, child_after = await asyncio.create_task(_child_task_check())
        assert child_inherited is None  # child starts clean despite parent's Context!
        assert child_after == 200
        assert get_task_http_status("openalex")[0] == 429  # parent's 429 untouched!
        # Verify 429 preservation across subsequent 200 within same task
        record_task_http_status("openalex", 200)
        assert get_task_http_status("openalex")[0] == 429
        reset_task_http_status("openalex")

        oa_client = OpenAlexClient(contact_email="test@citra.io.vn")

        async def _mock_get(self_http: httpx.AsyncClient, url: str, **kwargs) -> httpx.Response:
            params = kwargs.get("params") or {}
            search_q = str(params.get("search") or url)
            await asyncio.sleep(0.005)
            if "RATE_LIMITED_TASK" in search_q:
                # Retry-After: 10 prevents internal sleep retry while testing concurrent isolation
                return _http_response(429, headers={"Retry-After": "10"}, url=url)
            # Clean empty HTTP 200 response
            return _http_response(200, json_data={"results": []}, url=url)

        with patch.object(httpx.AsyncClient, "get", new=_mock_get):
            tasks = []
            for i in range(20):
                is_429_task = i % 2 == 0
                marker = f"RATE_LIMITED_TASK_{i}" if is_429_task else f"CLEAN_EMPTY_TASK_{i}"
                cit = Citation(
                    raw_text=f"Author {i} (2023). {marker} Study.",
                    title=f"{marker} Study",
                    authors=[f"Author{i}"],
                    year="2023",
                )
                tasks.append((is_429_task, oa_client.lookup(cit)))

            outcomes = await asyncio.gather(*(coro for _, coro in tasks))

        for (expected_429, _), cand in zip(tasks, outcomes, strict=True):
            assert cand.found is False
            if expected_429:
                assert cand.error is not None
                assert "429" in cand.error
            else:
                assert cand.error is not None
                assert "no results" in cand.error.lower()
                assert "429" not in cand.error

        # Multi-step preservation check: DOI lookup (/works/doi:...) returns 429 -> reports 429!
        async def _doi_429_then_search_200(self_http: httpx.AsyncClient, url: str, **kwargs) -> httpx.Response:
            if "/works/doi:" in url:
                return _http_response(429, headers={"Retry-After": "10"}, url=url)
            return _http_response(200, json_data={"results": []}, url=url)

        with patch.object(httpx.AsyncClient, "get", new=_doi_429_then_search_200):
            cit_multi = Citation(
                raw_text="Smith, J. (2023). Multi-step Preservation Test. https://doi.org/10.1000/test429",
                title="Multi-step Preservation Test",
                authors=["Smith, J."],
                year="2023",
                doi="10.1000/test429",
            )
            cand_multi = await oa_client.lookup(cit_multi)
            assert cand_multi.found is False
            assert cand_multi.error is not None
            assert "429" in cand_multi.error

        await close_loop_http_clients()

    @pytest.mark.asyncio
    async def test_previously_silent_clients_explicitly_report_429_instead_of_no_results(self) -> None:
        async def _always_429_get(self_http: httpx.AsyncClient, url: str, **kwargs) -> httpx.Response:
            return _http_response(429, headers={"Retry-After": "10"}, url=url)

        clients_and_citations = [
            (
                DOAJClient(),
                Citation(raw_text="Tran (2023). Open Access Study.", title="Open Access Study", year="2023"),
            ),
            (
                OpenAIREHalClient(),
                Citation(raw_text="Dupont (2023). Distributed Thesis.", title="Distributed Thesis", year="2023"),
            ),
            (
                NcbiBiorxivClient(),
                Citation(
                    raw_text="Lee (2023). Preprint Study. 10.1101/2023.01.01.123456",
                    title="Preprint Study",
                    doi="10.1101/2023.01.01.123456",
                    year="2023",
                ),
            ),
            (
                WikidataOpenCitationsClient(),
                Citation(
                    raw_text="ISO/IEC 27001:2022 Information Security Management",
                    title="Information Security Management",
                    doi="10.1000/wk429",
                    year="2022",
                ),
            ),
            (
                HuggingFaceClient(),
                Citation(
                    raw_text="bert-base-uncased https://huggingface.co/bert-base-uncased",
                    title="bert-base-uncased",
                    url="https://huggingface.co/bert-base-uncased",
                ),
            ),
            (
                DoiRaClient(),
                Citation(
                    raw_text="Regional DOI Paper 10.5555/jalc.2023.01",
                    title="Regional DOI Paper",
                    doi="10.5555/jalc.2023.01",
                ),
            ),
            (
                TechStandardClient(),
                Citation(
                    raw_text="Fielding, R. RFC 9110: HTTP Semantics. https://www.rfc-editor.org/rfc/rfc9110",
                    title="RFC 9110: HTTP Semantics",
                    url="https://www.rfc-editor.org/rfc/rfc9110",
                ),
            ),
            (
                DataCiteClient(),
                Citation(
                    raw_text="Zenodo Dataset 10.5281/zenodo.7654321",
                    title="Zenodo Dataset",
                    doi="10.5281/zenodo.7654321",
                ),
            ),
            (
                EuropePMCClient(),
                Citation(raw_text="Clinical Trial Study (2023).", title="Clinical Trial Study", year="2023"),
            ),
            (
                OpenLibraryClient(),
                Citation(raw_text="Goodfellow (2016). Deep Learning Textbook.", title="Deep Learning Textbook", year="2016"),
            ),
        ]

        with patch.object(httpx.AsyncClient, "get", new=_always_429_get):
            for client, cit in clients_and_citations:
                cand = await client.lookup(cit)
                assert cand.found is False, f"{client.name} unexpectedly returned found=True"
                assert cand.error is not None, f"{client.name} returned None error on HTTP 429"
                err_l = cand.error.lower()
                assert "429" in err_l or "rate limit" in err_l, (
                    f"{client.name} masked HTTP 429 as '{cand.error}'"
                )
                assert "does not exist" not in err_l
                if isinstance(client, DoiRaClient):
                    assert (cand.external_ids or {}).get("doi_ra_status") != "nonexistent"

        await close_loop_http_clients()

    @pytest.mark.asyncio
    async def test_instant_429_callback_trips_orchestrator_limiter_immediately(self) -> None:
        oa_client = OpenAlexClient(contact_email="test@citra.io.vn")
        orch = RetrievalOrchestrator(
            openalex=oa_client,
            use_local_db=False,
            enable_link_validation=False,
        )

        http_calls = 0

        async def _429_with_retry_after(self_http: httpx.AsyncClient, url: str, **kwargs) -> httpx.Response:
            nonlocal http_calls
            http_calls += 1
            return _http_response(429, headers={"Retry-After": "20"}, url=url)

        cit = Citation(
            raw_text="Kim, S. (2023). Callback Fast Fail Verification.",
            title="Callback Fast Fail Verification",
            authors=["Kim, S."],
            year="2023",
        )

        with patch.object(httpx.AsyncClient, "get", new=_429_with_retry_after):
            cand_1 = await orch._lookup_with_ratelimit(oa_client, cit)
            assert cand_1.found is False
            assert "429" in (cand_1.error or "")
            assert http_calls == 1

            # Verify no double-reporting (consecutive_failures == 1, not 2) and fast-fail active
            oa_limiter = orch._rate_limiters["openalex"]
            assert oa_limiter.consecutive_failures == 1
            assert oa_limiter.should_fast_fail() is True

            # Immediate next call fast-fails in 0 HTTP requests!
            cand_2 = await orch._lookup_with_ratelimit(oa_client, cit)
            assert cand_2.found is False
            assert "skipped (rate-limit backoff active)" in (cand_2.error or "")
            assert http_calls == 1

        await close_loop_http_clients()


# ===========================================================================
# LAYER 4: Tier-2 Backup Rescue, Smart Quota Guard, & R-RATE-LIMITED-ABSTAIN
# ===========================================================================


class TestLayer4QuotaGuardAndAntiFalseHallucination:
    """Verify zero false SUSPECTED_HALLUCINATION verdicts and smart quota protection under 429 storms."""

    @pytest.mark.asyncio
    async def test_book_tier1_429_escalates_to_healthy_tier2_backup_sources(self) -> None:
        def _err_client(name: str, err: str):
            m = MagicMock()
            m.name = name
            m.lookup = AsyncMock(return_value=SourceCandidate(source_name=name, found=False, error=err))
            return m

        mock_datacite = MagicMock()
        mock_datacite.name = "datacite"
        mock_datacite.lookup = AsyncMock(
            return_value=SourceCandidate(
                source_name="datacite",
                found=True,
                title="Modern Distributed Systems, 2nd Edition",
                authors=["Tanenbaum, A."],
                year="2021",
                venue="Pearson",
                confidence=0.92,
            )
        )

        orch = RetrievalOrchestrator(
            openlibrary=_err_client("openlibrary", "OpenLibrary: rate limited (429)"),
            crossref=_err_client("crossref", "Crossref: rate limited (429)"),
            openalex=_err_client("openalex", "OpenAlex: rate limited (429)"),
            datacite=mock_datacite,
            doaj=_err_client("doaj", "DOAJ: no results"),
            use_local_db=False,
            enable_link_validation=False,
        )

        book_cit = Citation(
            raw_text="Tanenbaum, A. (2021). Modern Distributed Systems, 2nd Edition. Pearson.",
            title="Modern Distributed Systems, 2nd Edition",
            authors=["Tanenbaum, A."],
            year="2021",
            venue="Pearson",
        )

        res = await orch.retrieve(book_cit, allow_serpapi=False)
        mock_datacite.lookup.assert_awaited_once()
        assert len(res.candidates) == 1
        assert "datacite" in res.sources_succeeded

    @pytest.mark.asyncio
    async def test_smart_quota_guard_skips_serpapi_when_primary_wide_graphs_clean_despite_secondary_429(
        self,
    ) -> None:
        def _make_client(name: str, err: str):
            m = MagicMock()
            m.name = name
            m.lookup = AsyncMock(return_value=SourceCandidate(source_name=name, found=False, error=err))
            return m

        mock_serp = MagicMock()
        mock_serp.name = "serpapi"
        mock_serp.lookup = AsyncMock(
            return_value=SourceCandidate(source_name="serpapi", found=False, error="SerpApi: no results")
        )

        # Crossref + OpenAlex + DataCite + OpenAIRE + Wikidata all return HTTP 200 clean misses (5 clean misses),
        # while DBLP suffers HTTP 429 during peak CS deadline traffic -> SerpApi quota MUST be protected!
        orch = RetrievalOrchestrator(
            crossref=_make_client("crossref", "Crossref: no results for 'Hallucinated Transformer'"),
            openalex=_make_client("openalex", "OpenAlex: no results for 'Hallucinated Transformer'"),
            dblp=_make_client("dblp", "DBLP: rate limited (429)"),
            arxiv=_make_client("arxiv", "arXiv: no results for 'Hallucinated Transformer'"),
            datacite=_make_client("datacite", "DataCite: no results for 'Hallucinated Transformer'"),
            openaire_hal=_make_client("openaire_hal", "OpenAIRE: no results"),
            wikidata_opencitations=_make_client("wikidata_opencitations", "Wikidata: no results"),
            openlibrary=_make_client("openlibrary", "OpenLibrary: no results"),
            serpapi=mock_serp,
            use_local_db=False,
            enable_link_validation=False,
        )

        hallucinated = Citation(
            raw_text="nobody, Z. (2023). Hallucinated Transformer Architecture for Nothing. ICML.",
            title="Hallucinated Transformer Architecture for Nothing",
            authors=["Nobody, Z."],
            year="2023",
            venue="ICML",
        )
        res = await orch.retrieve(hallucinated, allow_serpapi=True)
        assert res.candidates == []
        mock_serp.lookup.assert_not_called()

    def test_symbolic_rules_never_flag_suspected_hallucination_under_429_storm(self) -> None:
        rules = SymbolicRules()
        cit = Citation(
            raw_text="Nguyen, T. H., & Le, M. Q. (2023). Deep Citation Verification in Vietnamese Theses. IEEE Access. https://doi.org/10.1109/ACCESS.2023.9988776",
            citation_type=CitationType.REFERENCE_LIST,
            style=CitationStyle.APA,
            title="Deep Citation Verification in Vietnamese Theses",
            authors=["Nguyen, T. H.", "Le, M. Q."],
            year="2023",
            venue="IEEE Access",
            doi="10.1109/ACCESS.2023.9988776",
        )
        empty_features = MatchFeatures()

        # Case 1: Every queried source failed with HTTP 429 / backoff -> UNRESOLVED + R-FAIL-ALL + R-RATE-LIMITED-ABSTAIN
        all_429_source = SourceResult(
            citation_raw=cit.raw_text,
            candidates=[],
            sources_queried=["crossref", "openalex", "dblp", "arxiv"],
            sources_succeeded=[],
            sources_failed={
                "crossref": "Crossref: rate limited (429)",
                "openalex": "OpenAlex: rate limited (429)",
                "dblp": "dblp: skipped (rate-limit backoff active)",
                "arxiv": "arXiv: rate limited (429)",
            },
            api_exhausted=True,
        )
        outcome_all_429 = rules.apply(
            empty_features,
            all_429_source,
            citation_raw=cit.raw_text,
            citation_doi=cit.doi,
            citation_authors=cit.authors,
            citation_year=cit.year,
        )
        assert outcome_all_429.label == ValidationLabel.UNRESOLVED
        assert outcome_all_429.label != ValidationLabel.SUSPECTED_HALLUCINATION
        assert "R-FAIL-ALL" in outcome_all_429.triggered_rules
        assert "R-RATE-LIMITED-ABSTAIN" in outcome_all_429.triggered_rules

        # Case 2: Only 1 API returned clean "no results" while 3 primary APIs suffered HTTP 429
        # (len(clean_empty_sources) == 1 < 2) -> MUST still abstain (UNRESOLVED), NEVER flag SUSPECTED_HALLUCINATION!
        partial_429_source = SourceResult(
            citation_raw=cit.raw_text,
            candidates=[],
            sources_queried=["crossref", "openalex", "dblp", "arxiv"],
            sources_succeeded=[],
            sources_failed={
                "crossref": "Crossref: rate limited (429)",
                "openalex": "OpenAlex: rate limited (429)",
                "dblp": "dblp: skipped (rate-limit backoff active)",
                "arxiv": "arXiv: no results for 'Deep Citation Verification'",
            },
            api_exhausted=False,
        )
        outcome_partial_429 = rules.apply(
            empty_features,
            partial_429_source,
            citation_raw=cit.raw_text,
            citation_doi=cit.doi,
            citation_authors=cit.authors,
            citation_year=cit.year,
        )
        assert outcome_partial_429.label == ValidationLabel.UNRESOLVED
        assert outcome_partial_429.label != ValidationLabel.SUSPECTED_HALLUCINATION
        assert "R-RATE-LIMITED-ABSTAIN" in outcome_partial_429.triggered_rules
