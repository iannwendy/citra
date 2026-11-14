"""Unit tests for Task 9 (B4-Part 2): Real-Time SSE Progress Stream & Unbuffered GZip/Nginx Bypass."""

from __future__ import annotations

import asyncio
import json
import re
import secrets
import threading
import time
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
import jwt
import pytest
from fastapi.testclient import TestClient

from integrity_checker.api.main import create_app
from integrity_checker.api.progress import ProgressTracker, get_tracker
from integrity_checker.api.routes import essays as essays_route
from integrity_checker.config import PROJECT_ROOT, get_settings
from integrity_checker.db.models import (
    ApiKey,
    AuthToken,
    CitationRecord,
    EssayRecord,
    User,
    VerdictRecord,
)
from integrity_checker.db.models import Session as SessionModel
from integrity_checker.db.repository import Repository
from integrity_checker.db.session import get_session


@pytest.fixture()
def clean_db():
    """Provide a clean in-memory DB session and clean ProgressTracker for each test."""
    tracker = get_tracker()
    tracker._states.clear()
    tracker._retry_counts.clear()
    if hasattr(tracker, "_subscribers"):
        tracker._subscribers.clear()

    session = get_session()
    session.query(VerdictRecord).delete()
    session.query(CitationRecord).delete()
    session.query(EssayRecord).delete()
    session.query(ApiKey).delete()
    session.query(AuthToken).delete()
    session.query(SessionModel).delete()
    session.query(User).delete()
    session.commit()
    try:
        yield session
    finally:
        tracker._states.clear()
        tracker._retry_counts.clear()
        if hasattr(tracker, "_subscribers"):
            tracker._subscribers.clear()
        session.close()
        cleanup = get_session()
        cleanup.query(VerdictRecord).delete()
        cleanup.query(CitationRecord).delete()
        cleanup.query(EssayRecord).delete()
        cleanup.query(ApiKey).delete()
        cleanup.query(AuthToken).delete()
        cleanup.query(SessionModel).delete()
        cleanup.query(User).delete()
        cleanup.commit()
        cleanup.close()


def _create_user_with_token(
    session,
    *,
    username: str,
    role: str = "user",
) -> tuple[User, str]:
    user = User(
        username=username,
        password_hash="hashed_pw",
        role=role,
        email=f"{username}@example.com",
        is_active=1,
        email_verified=1,
        plan_tier="pro",
    )
    session.add(user)
    session.flush()

    expires_at = datetime.now(UTC) + timedelta(hours=2)
    token = jwt.encode(
        {
            "sub": str(user.id),
            "exp": expires_at,
            "jti": secrets.token_hex(8),
        },
        get_settings().auth.jwt_secret,
        algorithm="HS256",
    )
    Repository(session).create_session(user_id=user.id, token=token, expires_at=expires_at)
    session.commit()
    session.refresh(user)
    return user, token


def _parse_sse_data_frames(raw_body: str) -> list[dict[str, Any]]:
    frames: list[dict[str, Any]] = []
    for block in raw_body.replace("\r\n", "\n").split("\n\n"):
        data_lines = [
            line[5:].lstrip()
            for line in block.split("\n")
            if line.startswith("data:")
        ]
        if data_lines:
            frames.append(json.loads("\n".join(data_lines)))
    return frames


def test_sse_events_rejects_unauthenticated_and_query_string_token(clean_db) -> None:
    """GET /api/essays/{id}/events rejects unauthenticated requests (401) and never accepts ?token=."""
    owner, owner_token = _create_user_with_token(clean_db, username="student_owner")
    essay = EssayRecord(filename="thesis.pdf", num_pages=5, user_id=owner.id, job_status="queued")
    clean_db.add(essay)
    clean_db.commit()

    app = create_app()
    client = TestClient(app)

    # 1. Missing Authorization header -> 401
    resp_unauth = client.get(f"/api/essays/{essay.id}/events")
    assert resp_unauth.status_code == 401

    # 2. JWT leaked in ?token= query parameter without Authorization header -> MUST still be 401
    resp_query_token = client.get(f"/api/essays/{essay.id}/events?token={owner_token}")
    assert resp_query_token.status_code == 401


def test_sse_events_enforces_ownership_403_and_missing_404(clean_db) -> None:
    """GET /api/essays/{id}/events returns 404 for unknown essay and 403 for another student's essay."""
    owner, _ = _create_user_with_token(clean_db, username="student_a")
    _, intruder_token = _create_user_with_token(clean_db, username="student_b")
    essay = EssayRecord(filename="private_essay.pdf", num_pages=8, user_id=owner.id, job_status="queued")
    clean_db.add(essay)
    clean_db.commit()

    app = create_app()
    client = TestClient(app)

    resp_404 = client.get(
        "/api/essays/999999/events",
        headers={"Authorization": f"Bearer {intruder_token}"},
    )
    assert resp_404.status_code == 404

    resp_403 = client.get(
        f"/api/essays/{essay.id}/events",
        headers={"Authorization": f"Bearer {intruder_token}"},
    )
    assert resp_403.status_code == 403


def test_sse_events_headers_and_gzip_bypass_above_1kb_payload(clean_db) -> None:
    """Review Focus #2: SSE responses carry text/event-stream, X-Accel-Buffering: no, security headers,
    and NO Content-Encoding: gzip even when payload > 1000 bytes and client sends Accept-Encoding: gzip."""
    owner, owner_token = _create_user_with_token(clean_db, username="gzip_tester")
    essay = EssayRecord(filename="large_payload.pdf", num_pages=10, user_id=owner.id, job_status="completed")
    clean_db.add(essay)
    clean_db.commit()

    tracker = get_tracker()
    tracker.init(essay.id)
    # Build > 1,800 bytes of telemetry so standard GZipMiddleware(minimum_size=1000) would compress it
    big_sources = {f"scholarly_provider_{idx:02d}": "ok_verified_batch_lookup" for idx in range(45)}
    tracker.update(
        essay.id,
        sources_queried=big_sources,
        citations_found=42,
        references_found=38,
        linked=36,
    )
    tracker.complete(essay.id)

    app = create_app()
    client = TestClient(app)

    # Test even without explicit Accept: text/event-stream (path ends with /events) AND with Accept-Encoding: gzip
    resp = client.get(
        f"/api/essays/{essay.id}/events",
        headers={
            "Authorization": f"Bearer {owner_token}",
            "Accept-Encoding": "gzip, deflate",
        },
    )
    assert resp.status_code == 200
    assert len(resp.content) > 1200
    assert "text/event-stream" in resp.headers.get("content-type", "")
    assert resp.headers.get("x-accel-buffering") == "no"
    cache_ctrl = resp.headers.get("cache-control", "")
    assert "no-cache" in cache_ctrl and "no-transform" in cache_ctrl
    assert resp.headers.get("x-content-type-options") == "nosniff"
    assert resp.headers.get("x-frame-options") == "SAMEORIGIN"
    assert resp.headers.get("referrer-policy") == "strict-origin-when-cross-origin"
    assert "content-encoding" not in {k.lower() for k in resp.headers}

    frames = _parse_sse_data_frames(resp.text)
    assert len(frames) == 1
    assert frames[0]["status"] == "completed"
    assert frames[0]["citations_found"] == 42

    # Meanwhile, regular large JSON endpoints MUST still be compressed with GZip!
    openapi_resp = client.get("/openapi.json", headers={"Accept-Encoding": "gzip"})
    assert openapi_resp.status_code == 200
    assert openapi_resp.headers.get("content-encoding") == "gzip"


async def test_sse_events_streams_ordered_frames_from_worker_thread_and_closes_cleanly(clean_db) -> None:
    """Pushing tracker.update + tracker.complete from a worker thread streams ordered SSE frames immediately."""
    owner, owner_token = _create_user_with_token(clean_db, username="realtime_user")
    essay = EssayRecord(filename="live_stream.pdf", num_pages=15, user_id=owner.id, job_status="processing")
    clean_db.add(essay)
    clean_db.commit()
    essay_id = essay.id

    tracker = get_tracker()
    tracker.init(essay_id)

    app = create_app()
    received_frames: list[dict[str, Any]] = []

    def _worker_updates() -> None:
        # Wait until SSE subscriber registers on the tracker
        deadline = time.monotonic() + 2.0
        while not tracker._subscribers.get(essay_id) and time.monotonic() < deadline:
            time.sleep(0.005)
        time.sleep(0.015)
        tracker.update(
            essay_id,
            step="retrieving",
            step_index=4,
            message="Querying Crossref & OpenAlex...",
            citations_found=24,
            references_found=20,
            linked=19,
        )
        time.sleep(0.015)
        tracker.complete(essay_id)

    worker = threading.Thread(target=_worker_updates, daemon=True)
    worker.start()

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as ac:
        resp = await ac.get(
            f"/api/essays/{essay_id}/events",
            headers={
                "Authorization": f"Bearer {owner_token}",
                "Accept": "text/event-stream",
                "Accept-Encoding": "gzip",
            },
        )
        assert resp.status_code == 200
        assert "content-encoding" not in {k.lower() for k in resp.headers}
        received_frames.extend(_parse_sse_data_frames(resp.text))

    worker.join(timeout=2.0)

    assert [f["step"] for f in received_frames] == ["parsing", "retrieving", "done"]
    assert [f["status"] for f in received_frames] == ["processing", "processing", "completed"]
    assert received_frames[1]["step_index"] == 4
    assert received_frames[1]["citations_found"] == 24
    assert tracker._subscribers.get(essay_id) is None


async def test_sse_events_keepalive_heartbeat_and_subscriber_cleanup_on_disconnect(
    clean_db,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Idle SSE stream flushes live unbuffered ASGI chunks, emits ': keepalive', and cleans up on http.disconnect."""
    monkeypatch.setattr(essays_route, "SSE_HEARTBEAT_INTERVAL_SECONDS", 0.04, raising=False)
    monkeypatch.setattr(essays_route, "SSE_DISCONNECT_CHECK_SECONDS", 0.02, raising=False)
    monkeypatch.setattr(essays_route, "SSE_POLL_INTERVAL_SECONDS", 0.2, raising=False)

    owner, owner_token = _create_user_with_token(clean_db, username="heartbeat_user")
    essay = EssayRecord(filename="idle_essay.pdf", num_pages=6, user_id=owner.id, job_status="processing")
    clean_db.add(essay)
    clean_db.commit()
    essay_id = essay.id

    tracker = get_tracker()
    tracker.init(essay_id)

    app = create_app()
    recv_queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
    sent_queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
    await recv_queue.put({"type": "http.request", "body": b"", "more_body": False})

    scope = {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": "GET",
        "scheme": "http",
        "path": f"/api/essays/{essay_id}/events",
        "raw_path": f"/api/essays/{essay_id}/events".encode(),
        "query_string": b"",
        "headers": [
            (b"host", b"testserver"),
            (b"authorization", f"Bearer {owner_token}".encode()),
            (b"accept", b"text/event-stream"),
            (b"accept-encoding", b"gzip"),
        ],
        "client": ("127.0.0.1", 50000),
        "server": ("testserver", 80),
    }

    app_task = asyncio.create_task(app(scope, recv_queue.get, sent_queue.put))
    saw_initial_data = False
    saw_keepalive = False
    start_headers: dict[bytes, bytes] = {}

    try:
        while not (saw_initial_data and saw_keepalive):
            msg = await asyncio.wait_for(sent_queue.get(), timeout=1.5)
            if msg["type"] == "http.response.start":
                assert msg["status"] == 200
                start_headers = {k.lower(): v for k, v in msg.get("headers", [])}
                assert b"content-encoding" not in start_headers
                assert start_headers.get(b"x-accel-buffering") == b"no"
            elif msg["type"] == "http.response.body":
                text_chunk = msg.get("body", b"").decode("utf-8")
                if "data:" in text_chunk:
                    saw_initial_data = True
                if ": keepalive" in text_chunk:
                    saw_keepalive = True

        # Client disconnects while stream is still open
        await recv_queue.put({"type": "http.disconnect"})
        await asyncio.wait_for(app_task, timeout=1.5)
    finally:
        if not app_task.done():
            app_task.cancel()
            try:
                await app_task
            except asyncio.CancelledError:
                pass

    assert saw_initial_data is True
    assert saw_keepalive is True
    assert tracker._subscribers.get(essay_id) is None


async def test_progress_tracker_bounded_queue_drops_oldest_and_preserves_terminal() -> None:
    """Rapid updates exceeding maxsize=16 never block and never drop terminal failed/completed frame."""
    tracker = ProgressTracker()
    essay_id = 505
    tracker.init(essay_id)

    sub_gen = tracker.subscribe(essay_id, poll_interval=0.5).__aiter__()
    try:
        first = await sub_gen.__anext__()
        assert first["step"] == "parsing"

        # Flood 25 updates + 1 terminal fail before reading from queue (maxsize=16)
        for i in range(25):
            tracker.update(essay_id, step="retrieving", step_index=4, citations_found=i + 1)
        tracker.fail(essay_id, "Upstream Fatal Error")

        collected: list[dict[str, Any]] = []
        async for snap in sub_gen:
            collected.append(snap)

        assert len(collected) <= 16
        assert collected[-1]["status"] == "failed"
        assert collected[-1]["error"] == "Upstream Fatal Error"
    finally:
        await sub_gen.aclose()

    assert tracker._subscribers.get(essay_id) is None


async def test_sse_multi_worker_db_fallback_deduplicates_and_detects_sql_failure(
    clean_db,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """When in-memory state is absent (e.g. CITRA_WORKER_MODE=web_only), subscribe polls SQLite,
    deduplicates unchanged snapshots, and terminates when EssayRecord.job_status becomes failed."""
    monkeypatch.setenv("CITRA_WORKER_MODE", "web_only")
    monkeypatch.setattr(essays_route, "SSE_POLL_INTERVAL_SECONDS", 0.03, raising=False)
    monkeypatch.setattr(essays_route, "SSE_HEARTBEAT_INTERVAL_SECONDS", 5.0, raising=False)

    owner, owner_token = _create_user_with_token(clean_db, username="multiworker_user")
    essay = EssayRecord(
        filename="web_only_job.pdf",
        num_pages=9,
        user_id=owner.id,
        job_status="queued",
    )
    clean_db.add(essay)
    clean_db.commit()
    essay_id = essay.id

    async def _simulate_external_worker() -> None:
        await asyncio.sleep(0.08)
        s1 = get_session()
        try:
            row = s1.get(EssayRecord, essay_id)
            assert row is not None
            row.job_status = "processing"
            row.style_profile_json = json.dumps(
                {
                    "_progress_snapshot": {
                        "status": "processing",
                        "step": "comparing",
                        "step_index": 5,
                        "total_steps": 8,
                        "message": "Comparing candidate metadata...",
                        "citations_found": 11,
                        "references_found": 10,
                        "linked": 10,
                        "sources_queried": {"openalex": "ok"},
                        "elapsed_seconds": 3.1,
                        "finished_at": None,
                        "error": None,
                        "queue_position": None,
                    }
                }
            )
            s1.commit()
        finally:
            s1.close()

        # Wait > 2 poll intervals without changing DB to prove duplicate frames are suppressed
        await asyncio.sleep(0.09)
        s2 = get_session()
        try:
            row2 = s2.get(EssayRecord, essay_id)
            assert row2 is not None
            # Simulate refund_upload_quota_once marking job_status="failed" in SQL without _progress_snapshot
            row2.job_status = "failed"
            row2.job_error = "Worker crash recovered; upload quota refunded."
            s2.commit()
        finally:
            s2.close()

    worker_task = asyncio.create_task(_simulate_external_worker())

    app = create_app()
    frames: list[dict[str, Any]] = []
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as ac:
        async with ac.stream(
            "GET",
            f"/api/essays/{essay_id}/events",
            headers={"Authorization": f"Bearer {owner_token}"},
        ) as resp:
            assert resp.status_code == 200
            buffer = ""
            async for chunk in resp.aiter_text():
                buffer += chunk
                while "\n\n" in buffer:
                    block, buffer = buffer.split("\n\n", 1)
                    for line in block.split("\n"):
                        if line.startswith("data:"):
                            frames.append(json.loads(line[5:].lstrip()))

    await worker_task

    assert [f["status"] for f in frames] == ["queued", "processing", "failed"]
    assert frames[1]["step"] == "comparing"
    assert frames[2]["error"] == "Worker crash recovered; upload quota refunded."


async def test_sse_db_fallback_reanalysis_prefers_active_processing_over_prior_cis(
    clean_db,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """During re-analysis on web_only, prior cis_json must not prematurely close SSE while job_status=='processing'."""
    monkeypatch.setenv("CITRA_WORKER_MODE", "web_only")

    owner, _ = _create_user_with_token(clean_db, username="reanalyze_user")
    essay = EssayRecord(
        filename="reanalyzed.pdf",
        num_pages=10,
        user_id=owner.id,
        job_status="processing",
        cis_json=json.dumps({"score": 82.0, "components": {}, "num_citations": 5, "num_unresolved": 0}),
        style_profile_json=json.dumps(
            {
                "_progress_snapshot": {
                    "status": "processing",
                    "step": "linking",
                    "step_index": 3,
                    "total_steps": 8,
                    "message": "Linking citations...",
                    "citations_found": 9,
                    "references_found": 7,
                    "linked": 7,
                    "sources_queried": {},
                    "elapsed_seconds": 1.1,
                    "finished_at": None,
                    "error": None,
                    "queue_position": None,
                }
            }
        ),
    )
    clean_db.add(essay)
    clean_db.commit()
    essay_id = essay.id

    tracker = get_tracker()
    snap = tracker.load_db_fallback_snapshot(essay_id)
    assert snap is not None
    assert snap["status"] == "processing"
    assert snap["step"] == "linking"


async def test_sse_inline_queued_reanalysis_never_emits_stale_sql_completed_on_poll_timeout(
    clean_db,
    tmp_path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Fix Round 1 regression: When an already-completed essay is re-analyzed under a saturated
    admission queue in inline mode:
    1. POST /api/essays/{id}/reanalyze immediately resets SQLite job_status to 'queued' and clears job_error.
    2. While in-memory tracker state is active ('queued'/'processing'), subscribe() does NOT poll SQLite
       on poll_interval TimeoutError and NEVER prematurely emits stale 'completed'/'failed' from run #1,
       waiting cleanly for the new run's live updates and completion."""
    from unittest.mock import patch

    from integrity_checker.api.progress import get_pipeline_admission_controller

    monkeypatch.setenv("CITRA_WORKER_MODE", "inline")
    uploads_dir = tmp_path / "uploads"
    uploads_dir.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(essays_route, "UPLOADS_DIR", uploads_dir)

    owner, owner_token = _create_user_with_token(clean_db, username="queued_reanalyze_owner")
    essay = EssayRecord(
        filename="already_completed.pdf",
        num_pages=6,
        user_id=owner.id,
        job_status="completed",
        job_error="old transient note",
        cis_json=json.dumps({"score": 91.0, "components": {}, "num_citations": 4, "num_unresolved": 0}),
        style_profile_json=json.dumps(
            {
                "style": "APA_LIKE",
                "_progress_snapshot": {
                    "status": "completed",
                    "step": "done",
                    "step_index": 7,
                },
            }
        ),
    )
    clean_db.add(essay)
    clean_db.commit()
    essay_id = essay.id
    (uploads_dir / f"{essay_id}.pdf").write_bytes(b"%PDF-1.4\n%stub\n")

    # Saturate admission controller so tracker.init() enters 'queued' state
    adm = get_pipeline_admission_controller()
    orig_explicit_max = adm._explicit_max
    adm._explicit_max = 1
    try:
        async with adm.acquire(999901):
            app = create_app()
            client = TestClient(app)
            with (
                patch.object(essays_route, "is_test_runtime", return_value=False),
                patch.object(essays_route, "_run_pipeline_task", return_value=None),
            ):
                re_resp = client.post(
                    f"/api/essays/{essay_id}/reanalyze",
                    headers={"Authorization": f"Bearer {owner_token}"},
                )
            assert re_resp.status_code == 200

            verify_s = get_session()
            try:
                refreshed = verify_s.get(EssayRecord, essay_id)
                assert refreshed is not None
                assert refreshed.job_status == "queued"
                assert refreshed.job_error is None
            finally:
                verify_s.close()

            # Even if SQLite still held stale job_status='completed' + cis_json while in-memory is 'queued',
            # subscribe() must trust in-memory state, perform zero SQLite polls while in-memory is active,
            # and wait for the new run's updates!
            stale_s = get_session()
            try:
                stale_row = stale_s.get(EssayRecord, essay_id)
                assert stale_row is not None
                stale_row.job_status = "completed"
                stale_s.commit()
            finally:
                stale_s.close()

            tracker = get_tracker()
            in_mem = tracker.get(essay_id)
            assert in_mem is not None and in_mem.status == "queued"

            with patch.object(
                tracker,
                "load_db_fallback_snapshot",
                wraps=tracker.load_db_fallback_snapshot,
            ) as spy_db_fallback:
                sub_iter = tracker.subscribe(essay_id, poll_interval=0.02).__aiter__()
                try:
                    first_snap = await sub_iter.__anext__()
                    assert first_snap["status"] == "queued"

                    async def _delayed_new_run() -> None:
                        # Sleep past > 3 poll_interval timeouts while queued
                        await asyncio.sleep(0.08)
                        tracker.update(
                            essay_id,
                            status="processing",
                            queue_position=None,
                            step="retrieving",
                            step_index=4,
                            message="Re-querying Crossref...",
                        )
                        await asyncio.sleep(0.02)
                        tracker.complete(essay_id)

                    producer = asyncio.create_task(_delayed_new_run())
                    subsequent: list[dict[str, Any]] = []
                    async for snap in sub_iter:
                        subsequent.append(snap)
                    await producer
                finally:
                    await sub_iter.aclose()

                assert spy_db_fallback.call_count == 0
                assert [s["status"] for s in subsequent] == ["processing", "completed"]
                assert [s["step"] for s in subsequent] == ["retrieving", "done"]
    finally:
        adm._explicit_max = orig_explicit_max


def test_nginx_prod_conf_defines_unbuffered_sse_locations_before_api_proxy() -> None:
    """Both Nginx server blocks proxying /api/ must define unbuffered SSE location before location /api/."""
    nginx_conf_path = PROJECT_ROOT / "web" / "nginx.prod.conf"
    content = nginx_conf_path.read_text(encoding="utf-8")

    sse_matches = list(
        re.finditer(
            r"location\s+~\s+\^/api/essays/\[0-9\]\+/events\$\s*\{([^}]*)\}",
            content,
            flags=re.DOTALL,
        )
    )
    assert len(sse_matches) == 2, "Expected unbuffered SSE location block in both HTTP (:80) and HTTPS (:443) servers"

    for match in sse_matches:
        block_body = match.group(1)
        assert "proxy_http_version 1.1;" in block_body
        assert 'proxy_set_header Connection "";' in block_body
        assert "proxy_buffering off;" in block_body
        assert "proxy_cache off;" in block_body
        assert "chunked_transfer_encoding on;" in block_body
        assert "proxy_read_timeout 600s;" in block_body

    # Verify each SSE location appears immediately prior to its server's `location /api/ {`
    api_matches = list(re.finditer(r"location\s+/api/\s*\{", content))
    assert len(api_matches) == 2
    assert sse_matches[0].start() < api_matches[0].start()
    assert api_matches[0].start() < sse_matches[1].start() < api_matches[1].start()
