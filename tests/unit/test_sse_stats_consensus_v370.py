"""Unit tests for v3.70.0 Backend Agent 1B features:
- SSE ProgressTracker `quota_charged` & `document_diagnostics` snapshot delivery + live Step 5 badges
- `POST /api/essays/{id}/reanalyze` quota contracts & in-flight idempotency
- Multi-source consensus provenance (`_corroborating_records` / `_agreed_sources` / `_pristine_candidates`)
- `GET /api/essays/stats`, `Repository._essay_quality`, `GET /api/essays/shared/{token}`, `/sandbox/verify`
- `DELETE /api/cache`, `GET /api/cache/stats`, `POST /api/system/circuit-breakers/reset`, `GET /api/audit/stats`
"""

from __future__ import annotations

import asyncio
import json
import secrets
import threading
import time
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from typing import Any
from unittest.mock import patch

import jwt
import pytest
from fastapi.testclient import TestClient

from integrity_checker.api import deps
from integrity_checker.api.main import create_app
from integrity_checker.api.progress import (
    ProgressTracker,
    get_pipeline_admission_controller,
    get_tracker,
)
from integrity_checker.api.routes import essays as essays_route
from integrity_checker.api.routes.essays import create_essay_share_token
from integrity_checker.billing.plans import ensure_user_quota_current
from integrity_checker.config import get_settings
from integrity_checker.db.models import (
    ApiKey,
    AuditLog,
    AuthToken,
    CitationCache,
    CitationRecord,
    EssayRecord,
    User,
    VerdictRecord,
)
from integrity_checker.db.models import (
    Session as SessionModel,
)
from integrity_checker.db.repository import Repository
from integrity_checker.db.session import get_session
from integrity_checker.models.citation import Citation, CitationStyle, CitationType
from integrity_checker.models.source import SourceCandidate, SourceResult
from integrity_checker.models.validation import CitationVerdict, ValidationLabel
from integrity_checker.pipeline.integrity_pipeline import (
    IntegrityPipeline,
    _serialize_matched_sources,
    _summarize_sources_queried,
)
from integrity_checker.retrieval.circuit_breaker import (
    get_circuit_breaker_registry,
    reset_circuit_breaker_registry,
)
from integrity_checker.retrieval.html_meta_verifier import HtmlPageMeta
from integrity_checker.retrieval.persistent_cache import (
    POSITIVE_MATCH_TTL_SECONDS,
    PersistentVerificationCache,
    build_verification_cache_key,
)
from integrity_checker.retrieval.retrieval_orchestrator import RetrievalOrchestrator


@pytest.fixture()
def clean_env():
    """Clean SQLite test tables, ProgressTracker, and CircuitBreakerRegistry per test."""
    tracker = get_tracker()
    tracker._states.clear()
    tracker._retry_counts.clear()
    tracker._subscribers.clear()
    reset_circuit_breaker_registry()

    session = get_session()
    for model in (
        AuditLog,
        CitationCache,
        VerdictRecord,
        CitationRecord,
        EssayRecord,
        ApiKey,
        AuthToken,
        SessionModel,
        User,
    ):
        session.query(model).delete()
    session.commit()
    try:
        yield session
    finally:
        tracker._states.clear()
        tracker._retry_counts.clear()
        tracker._subscribers.clear()
        reset_circuit_breaker_registry()
        session.close()
        cleanup = get_session()
        for model in (
            AuditLog,
            CitationCache,
            VerdictRecord,
            CitationRecord,
            EssayRecord,
            ApiKey,
            AuthToken,
            SessionModel,
            User,
        ):
            cleanup.query(model).delete()
        cleanup.commit()
        cleanup.close()


def _create_user_with_headers(
    session,
    *,
    username: str,
    role: str = "user",
    plan_tier: str = "basic",
    monthly_uploads_used: int = 0,
) -> tuple[User, dict[str, str]]:
    now = datetime.now(UTC)
    user = User(
        username=username,
        password_hash="hashed_pw",
        role=role,
        email=f"{username}@example.com",
        is_active=1,
        email_verified=1,
        plan_tier=plan_tier,
    )
    ensure_user_quota_current(user)
    user.monthly_uploads_used = monthly_uploads_used
    session.add(user)
    session.flush()

    expires_at = now + timedelta(hours=2)
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
    return user, {"Authorization": f"Bearer {token}"}


# ---------------------------------------------------------------------------
# 1. SSE ProgressTracker `quota_charged` & `document_diagnostics` + Step 5 badges
# ---------------------------------------------------------------------------


async def test_sse_tracker_complete_diagnostics_and_fail_quota_charged_delivery() -> None:
    """ProgressTracker.complete(..., document_diagnostics=...) and fail(..., quota_charged=False)
    mutate state BEFORE broadcasting terminal SSE snapshots to live subscribers."""
    tracker = ProgressTracker()

    # 1. Complete path with OCR / TCVN3 diagnostics
    essay_ok = 701
    init_state = tracker.init(essay_ok)
    assert init_state.to_snapshot()["quota_charged"] is True
    assert init_state.to_snapshot()["document_diagnostics"] is None

    diag_payload = {
        "ocr_applied": True,
        "legacy_encoding_repaired": "TCVN3",
        "repaired_spans": 14,
    }
    received_ok: list[dict[str, Any]] = []

    def _complete_worker() -> None:
        deadline = time.monotonic() + 2.0
        while not tracker._subscribers.get(essay_ok) and time.monotonic() < deadline:
            time.sleep(0.005)
        time.sleep(0.01)
        tracker.complete(essay_ok, document_diagnostics=diag_payload)

    t1 = threading.Thread(target=_complete_worker, daemon=True)
    t1.start()
    async for snap in tracker.subscribe(essay_ok, poll_interval=0.05):
        received_ok.append(snap)
    t1.join(timeout=2.0)

    assert received_ok[-1]["status"] == "completed"
    assert received_ok[-1]["quota_charged"] is True
    assert received_ok[-1]["document_diagnostics"] == diag_payload

    # 2. Fail path with refunded monthly upload slot (`quota_charged=False`)
    essay_fail = 702
    tracker.init(essay_fail)
    received_fail: list[dict[str, Any]] = []

    def _fail_worker() -> None:
        deadline = time.monotonic() + 2.0
        while not tracker._subscribers.get(essay_fail) and time.monotonic() < deadline:
            time.sleep(0.005)
        time.sleep(0.01)
        tracker.fail(essay_fail, "Document file is corrupted or unreadable.", quota_charged=False)

    t2 = threading.Thread(target=_fail_worker, daemon=True)
    t2.start()
    async for snap in tracker.subscribe(essay_fail, poll_interval=0.05):
        received_fail.append(snap)
    t2.join(timeout=2.0)

    assert received_fail[-1]["status"] == "failed"
    assert received_fail[-1]["quota_charged"] is False
    assert "corrupted" in (received_fail[-1]["error"] or "")


async def test_pipeline_background_task_emits_diagnostics_and_refunded_quota_charged(
    clean_env,
    tmp_path,
) -> None:
    """_run_pipeline_task passes document_diagnostics on completion and quota_charged=False on refund."""
    student, _ = _create_user_with_headers(
        clean_env,
        username="sse_bg_student",
        plan_tier="basic",
        monthly_uploads_used=2,
    )

    # Case A: Successful completion propagates document_diagnostics to tracker
    ok_essay = EssayRecord(
        filename="ocr_scan.pdf",
        num_pages=4,
        user_id=student.id,
        job_status="queued",
        quota_charged=1,
    )
    clean_env.add(ok_essay)
    clean_env.commit()
    ok_id = ok_essay.id

    dummy_pdf_ok = tmp_path / "ok.pdf"
    dummy_pdf_ok.write_bytes(b"%PDF-1.4\n%%EOF\n")
    tracker = get_tracker()
    tracker.init(ok_id)

    expected_diag = {"ocr_used": True, "legacy_font_detected": "VNI-Times"}

    class _SuccessPipeline:
        async def run_async(self, *_args, **_kwargs):
            return SimpleNamespace(
                num_pages=4,
                citations=[],
                extracted_citations=[],
                verdicts=[],
                style_profile={
                    "style": "APA",
                    "confidence": 0.95,
                    "document_diagnostics": expected_diag,
                },
                cis={"score": 100.0, "components": {}, "num_citations": 0, "num_unresolved": 0},
            )

    await essays_route._run_pipeline_task(
        ok_id,
        str(dummy_pdf_ok),
        student.id,
        _SuccessPipeline(),  # type: ignore[arg-type]
        cleanup_file=False,
    )
    ok_state = tracker.get(ok_id)
    assert ok_state is not None
    ok_snap = ok_state.to_snapshot()
    assert ok_snap["status"] == "completed"
    assert ok_snap["document_diagnostics"] == expected_diag
    assert ok_snap["quota_charged"] is True

    # Case B: Failure refunds monthly slot and emits quota_charged=False on tracker
    fail_essay = EssayRecord(
        filename="broken_scan.pdf",
        num_pages=3,
        user_id=student.id,
        job_status="queued",
        quota_charged=1,
    )
    clean_env.add(fail_essay)
    clean_env.commit()
    fail_id = fail_essay.id
    tracker.init(fail_id)

    class _FailingPipeline:
        async def run_async(self, *_args, **_kwargs):
            raise RuntimeError("Document file is corrupted or unreadable")

    await essays_route._run_pipeline_task(
        fail_id,
        str(dummy_pdf_ok),
        student.id,
        _FailingPipeline(),  # type: ignore[arg-type]
        cleanup_file=False,
    )
    fail_state = tracker.get(fail_id)
    assert fail_state is not None
    fail_snap = fail_state.to_snapshot()
    assert fail_snap["status"] == "failed"
    assert fail_snap["quota_charged"] is False

    clean_env.expire_all()
    refreshed_student = clean_env.get(User, student.id)
    refreshed_essay = clean_env.get(EssayRecord, fail_id)
    assert refreshed_student is not None and refreshed_student.monthly_uploads_used == 1
    assert refreshed_essay is not None and bool(refreshed_essay.quota_charged) is False


def test_summarize_sources_queried_maps_rate_limited_and_circuit_open() -> None:
    """Rate-limit backoff / HTTP 429 map to 'rate_limited' and breaker skips map to 'circuit_open'."""
    results = [
        SourceResult(
            citation_raw="[1] Test",
            candidates=[],
            sources_queried=["openalex", "crossref", "arxiv", "dblp", "europepmc"],
            sources_succeeded=["arxiv"],
            sources_failed={
                "openalex": "openalex: skipped (rate-limit backoff active)",
                "crossref": "HTTP 429: Too Many Requests",
                "dblp": "circuit_open (42s remaining)",
                "europepmc": "skipped (circuit-breaker open)",
            },
        ),
        SourceResult(
            citation_raw="[2] Test",
            candidates=[],
            sources_queried=["datacite", "doaj"],
            sources_succeeded=[],
            sources_failed={
                "datacite": "not found",
                "doaj": "HTTP 502: Bad Gateway",
            },
        ),
    ]
    status_map, hits_map = _summarize_sources_queried(results)
    assert hits_map == {"arxiv": 1}
    assert status_map["arxiv"] == "ok"
    assert status_map["openalex"] == "rate_limited"
    assert status_map["crossref"] == "rate_limited"
    assert status_map["dblp"] == "circuit_open"
    assert status_map["europepmc"] == "circuit_open"
    assert status_map["datacite"] == "queried:1"
    assert status_map["doaj"] == "failed:1"


# ---------------------------------------------------------------------------
# 2. `POST /api/essays/{id}/reanalyze` quota & idempotency contracts
# ---------------------------------------------------------------------------


def test_reanalyze_completed_essay_at_3_of_3_quota_does_not_fail_with_402(
    clean_env,
    tmp_path,
    monkeypatch,
) -> None:
    """Reanalyzing an already-completed essay at 3/3 quota MUST NOT consume an extra slot or 402."""
    monkeypatch.setattr(essays_route, "UPLOADS_DIR", tmp_path)
    student, headers = _create_user_with_headers(
        clean_env,
        username="basic_full_quota",
        plan_tier="basic",
        monthly_uploads_used=3,  # Basic limit is 3/3!
    )
    completed_essay = EssayRecord(
        filename="completed_thesis.pdf",
        num_pages=6,
        user_id=student.id,
        job_status="completed",
        quota_charged=1,
        cis_json=json.dumps({"score": 92.5, "components": {}, "num_citations": 5, "num_unresolved": 0}),
    )
    clean_env.add(completed_essay)
    clean_env.commit()
    (tmp_path / f"{completed_essay.id}.pdf").write_bytes(b"%PDF-1.4\n%%EOF\n")

    app = create_app()
    client = TestClient(app)

    async def _noop_task(*_args, **_kwargs) -> None:
        s = get_session()
        try:
            row = s.get(EssayRecord, completed_essay.id)
            if row is not None:
                row.job_status = "completed"
                s.commit()
        finally:
            s.close()

    monkeypatch.setattr(essays_route, "_run_pipeline_task", _noop_task)
    resp = client.post(f"/api/essays/{completed_essay.id}/reanalyze", headers=headers)
    assert resp.status_code == 200, resp.text
    assert resp.json()["essay_id"] == completed_essay.id

    clean_env.expire_all()
    refreshed_user = clean_env.get(User, student.id)
    assert refreshed_user is not None
    assert refreshed_user.monthly_uploads_used == 3


def test_reanalyze_failed_refunded_essay_reclaims_slot_and_402s_when_zero_remaining(
    clean_env,
    tmp_path,
    monkeypatch,
) -> None:
    """Failed + refunded initial upload re-claims 1 monthly slot on reanalyze, and 402s at 3/3."""
    monkeypatch.setattr(essays_route, "UPLOADS_DIR", tmp_path)
    monkeypatch.setenv("CITRA_WORKER_MODE", "web_only")
    student, headers = _create_user_with_headers(
        clean_env,
        username="basic_reclaim_student",
        plan_tier="basic",
        monthly_uploads_used=2,  # 1 slot remaining out of 3
    )

    failed_1 = EssayRecord(
        filename="failed_attempt_1.pdf",
        num_pages=4,
        user_id=student.id,
        job_status="failed",
        quota_charged=0,
        cis_json=None,
    )
    failed_2 = EssayRecord(
        filename="failed_attempt_2.pdf",
        num_pages=4,
        user_id=student.id,
        job_status="failed",
        quota_charged=0,
        cis_json=None,
    )
    clean_env.add_all([failed_1, failed_2])
    clean_env.commit()
    (tmp_path / f"{failed_1.id}.pdf").write_bytes(b"%PDF-1.4\n%%EOF\n")
    (tmp_path / f"{failed_2.id}.pdf").write_bytes(b"%PDF-1.4\n%%EOF\n")

    app = create_app()
    client = TestClient(app)

    # First reanalyze consumes the last remaining slot (2 -> 3) and marks quota_charged=1
    r1 = client.post(f"/api/essays/{failed_1.id}/reanalyze", headers=headers)
    assert r1.status_code == 200, r1.text
    assert r1.json() == {"status": "queued", "essay_id": failed_1.id}

    clean_env.expire_all()
    u_after_1 = clean_env.get(User, student.id)
    e1_after = clean_env.get(EssayRecord, failed_1.id)
    assert u_after_1 is not None and u_after_1.monthly_uploads_used == 3
    assert e1_after is not None and bool(e1_after.quota_charged) is True

    # Second failed+refunded essay now hits 3/3 -> HTTP 402 structured MONTHLY_QUOTA_EXCEEDED
    r2 = client.post(f"/api/essays/{failed_2.id}/reanalyze", headers=headers)
    assert r2.status_code == 402
    detail = r2.json()["detail"]
    assert isinstance(detail, dict)
    assert detail["code"] == "MONTHLY_QUOTA_EXCEEDED"
    assert detail["used"] == 3
    assert detail["limit"] == 3


async def test_reanalyze_inflight_idempotent_and_saturated_returns_queued(
    clean_env,
    tmp_path,
    monkeypatch,
) -> None:
    """In-flight queued/processing essays return idempotently without spawning duplicate tasks,
    and saturated inline admission returns status='queued' instead of hardcoded 'processing'."""
    monkeypatch.setattr(essays_route, "UPLOADS_DIR", tmp_path)
    student, headers = _create_user_with_headers(
        clean_env,
        username="idempotent_user",
        plan_tier="pro",
        monthly_uploads_used=1,
    )
    queued_essay = EssayRecord(
        filename="already_queued.pdf",
        num_pages=5,
        user_id=student.id,
        job_status="queued",
        quota_charged=1,
    )
    proc_essay = EssayRecord(
        filename="already_processing.pdf",
        num_pages=5,
        user_id=student.id,
        job_status="processing",
        quota_charged=1,
    )
    done_essay = EssayRecord(
        filename="done_requeue.pdf",
        num_pages=5,
        user_id=student.id,
        job_status="completed",
        quota_charged=1,
        cis_json=json.dumps({"score": 88.0, "components": {}}),
    )
    clean_env.add_all([queued_essay, proc_essay, done_essay])
    clean_env.commit()
    (tmp_path / f"{done_essay.id}.pdf").write_bytes(b"%PDF-1.4\n%%EOF\n")

    spawned_ids: list[int] = []

    async def _spy_task(eid: int, *_args, **_kwargs) -> None:
        spawned_ids.append(eid)

    monkeypatch.setattr(essays_route, "_run_pipeline_task", _spy_task)

    app = create_app()
    client = TestClient(app)

    rq = client.post(f"/api/essays/{queued_essay.id}/reanalyze", headers=headers)
    assert rq.status_code == 200
    assert rq.json() == {"status": "queued", "essay_id": queued_essay.id}

    rp = client.post(f"/api/essays/{proc_essay.id}/reanalyze", headers=headers)
    assert rp.status_code == 200
    assert rp.json() == {"status": "processing", "essay_id": proc_essay.id}
    assert spawned_ids == []

    # Saturate admission controller and verify non-test-runtime inline reanalyze returns "queued"
    adm = get_pipeline_admission_controller()
    prev_max = adm._explicit_max
    adm._explicit_max = 1
    try:
        async with adm.acquire(888001):
            with patch.object(essays_route, "is_test_runtime", return_value=False):
                rd = await asyncio.to_thread(
                    client.post,
                    f"/api/essays/{done_essay.id}/reanalyze",
                    headers=headers,
                )
            assert rd.status_code == 200
            assert rd.json() == {"status": "queued", "essay_id": done_essay.id}
    finally:
        adm._explicit_max = prev_max


# ---------------------------------------------------------------------------
# 3. Multi-Source Consensus Provenance (`_agreed_sources` / `_corroborating_records`)
# ---------------------------------------------------------------------------


def test_consensus_provenance_survives_dedupe_and_persistent_sqlite_cache(clean_env) -> None:
    """Wave-0 / PersistentVerificationCache deduplicated candidates with 3 agreeing providers
    ('openalex', 'crossref', 'arxiv') expand all 3 sources in _serialize_matched_sources."""
    cit = Citation(
        raw_text="Vaswani, A., et al. (2017). Attention Is All You Need. NeurIPS. doi:10.48550/arXiv.1706.03762",
        citation_type=CitationType.REFERENCE_LIST,
        style=CitationStyle.APA,
        title="Attention Is All You Need",
        authors=["Ashish Vaswani", "Noam Shazeer"],
        year="2017",
        doi="10.48550/arXiv.1706.03762",
    )
    c_oa = SourceCandidate(
        source_name="openalex",
        found=True,
        doi="10.48550/arXiv.1706.03762",
        title="Attention Is All You Need",
        authors=["Ashish Vaswani", "Noam Shazeer"],
        year="2017",
        venue="NeurIPS",
        url="https://openalex.org/W2963403868",
        confidence=0.98,
        external_ids={"openalex": "W2963403868", "arxiv": "1706.03762"},
    )
    c_cr = SourceCandidate(
        source_name="crossref",
        found=True,
        doi="10.48550/arXiv.1706.03762",
        title="Attention Is All You Need",
        authors=["Ashish Vaswani", "Noam Shazeer"],
        year="2017",
        venue="Advances in Neural Information Processing Systems",
        url="https://doi.org/10.48550/arXiv.1706.03762",
        confidence=0.95,
        external_ids={"doi": "10.48550/arxiv.1706.03762"},
    )
    c_ax = SourceCandidate(
        source_name="arxiv",
        found=True,
        doi="10.48550/arXiv.1706.03762",
        title="Attention Is All You Need",
        authors=["Ashish Vaswani", "Noam Shazeer"],
        year="2017",
        venue="arXiv",
        url="https://arxiv.org/abs/1706.03762",
        confidence=0.96,
        external_ids={"arxiv": "1706.03762"},
    )

    deduped = RetrievalOrchestrator._dedupe_candidates([c_oa, c_cr, c_ax], citation=cit)
    assert len(deduped) == 1
    winner = deduped[0]
    assert getattr(winner, "_agreed_sources", []) == ["openalex", "crossref", "arxiv"]
    assert len(getattr(winner, "_corroborating_records", [])) == 3

    # Direct serialization after Wave-0 dedupe
    direct_res = SourceResult(
        citation_raw=cit.raw_text,
        candidates=deduped,
        sources_queried=["openalex", "crossref", "arxiv"],
        sources_succeeded=["openalex", "crossref", "arxiv"],
    )
    direct_serialized = _serialize_matched_sources(direct_res)
    assert [m["source"] for m in direct_serialized] == ["openalex", "crossref", "arxiv"]
    by_src = {m["source"]: m for m in direct_serialized}
    assert by_src["crossref"]["url"] == "https://doi.org/10.48550/arXiv.1706.03762"
    assert by_src["arxiv"]["url"] == "https://arxiv.org/abs/1706.03762"
    # Internal _* keys must not leak into public external_ids
    for item in direct_serialized:
        for k in item.get("external_ids", {}):
            assert not k.startswith("_")

    # Round-trip through SQLite PersistentVerificationCache (where only deduped winner was stored!)
    p_cache = PersistentVerificationCache(session_factory=get_session)
    cache_key = build_verification_cache_key(cit)
    assert p_cache.set(cache_key, direct_res, POSITIVE_MATCH_TTL_SECONDS) is True

    reloaded_raw = p_cache.get(cache_key)
    assert reloaded_raw is not None
    orch = RetrievalOrchestrator(use_local_db=False, enable_link_validation=False, persistent_cache=p_cache)
    materialized = orch._materialize_cached_result_for_citation(
        cit,
        reloaded_raw,
        is_shared_id_key=True,
        candidate_key=cache_key,
    )
    assert materialized is not None
    assert set(materialized.sources_succeeded) == {"openalex", "crossref", "arxiv"}
    cached_serialized = _serialize_matched_sources(materialized)
    assert [m["source"] for m in cached_serialized] == ["openalex", "crossref", "arxiv"]


# ---------------------------------------------------------------------------
# 4. `get_essay_stats`, `Repository._essay_quality`, `shared/{token}`, `/sandbox/verify`
# ---------------------------------------------------------------------------


def test_essay_stats_excludes_non_completed_and_exposes_incomplete_metadata_and_dedupe_rank(
    clean_env,
) -> None:
    """Repository._essay_quality ranks completed > processing/queued > failed, and GET /api/essays/stats
    excludes failed/queued/processing essays while exposing incomplete_metadata."""
    student, headers = _create_user_with_headers(
        clean_env,
        username="stats_student",
        plan_tier="pro",
    )
    t_base = datetime(2026, 11, 10, 9, 0, tzinfo=UTC)

    # Same filename uploaded 3 times: older completed report MUST beat newer queued & failed rows!
    e_completed = EssayRecord(
        filename="capstone.pdf",
        num_pages=10,
        user_id=student.id,
        uploaded_at=t_base,
        job_status="completed",
        cis_json=json.dumps({"score": 85.0, "components": {}}),
        style_profile_json=json.dumps(
            {
                "style": "APA",
                "confidence": 0.9,
                "document_diagnostics": {"ocr_applied": True, "legacy_encoding": "TCVN3"},
            }
        ),
    )
    e_queued_dup = EssayRecord(
        filename="capstone.pdf",
        num_pages=10,
        user_id=student.id,
        uploaded_at=t_base + timedelta(hours=1),
        job_status="queued",
    )
    e_failed_dup = EssayRecord(
        filename="capstone.pdf",
        num_pages=10,
        user_id=student.id,
        uploaded_at=t_base + timedelta(hours=2),
        job_status="failed",
    )
    # Standalone failed & queued essays with distinct filenames -> MUST be excluded from stats!
    e_standalone_failed = EssayRecord(
        filename="broken_upload.pdf",
        num_pages=3,
        user_id=student.id,
        uploaded_at=t_base + timedelta(hours=3),
        job_status="failed",
    )
    e_standalone_queued = EssayRecord(
        filename="waiting_upload.pdf",
        num_pages=4,
        user_id=student.id,
        uploaded_at=t_base + timedelta(hours=4),
        job_status="queued",
    )
    clean_env.add_all(
        [e_completed, e_queued_dup, e_failed_dup, e_standalone_failed, e_standalone_queued]
    )
    clean_env.flush()

    clean_env.add_all(
        [
            VerdictRecord(
                essay_id=e_completed.id,
                citation_raw="[1] Valid Paper (2022)",
                label="verified",
                confidence=0.95,
                triggered_rules=json.dumps(["R-CONSENSUS-FULL"]),
                mismatched_fields="[]",
            ),
            VerdictRecord(
                essay_id=e_completed.id,
                citation_raw="[2] Incomplete Fragment",
                label="metadata_error",
                confidence=0.75,
                triggered_rules=json.dumps(["R-INCOMPLETE-METADATA"]),
                mismatched_fields=json.dumps(["year", "venue"]),
            ),
            VerdictRecord(
                essay_id=e_completed.id,
                citation_raw="[3] Wrong Year (2020)",
                label="metadata_error",
                confidence=0.80,
                triggered_rules=json.dumps(["R-YEAR-MISMATCH"]),
                mismatched_fields=json.dumps(["year"]),
            ),
            # Verdict attached to standalone failed essay should be ignored by /stats
            VerdictRecord(
                essay_id=e_standalone_failed.id,
                citation_raw="[X] Should Not Count",
                label="suspected_hallucination",
                confidence=0.99,
                triggered_rules=json.dumps(["R-TOTAL-MISS"]),
                mismatched_fields="[]",
            ),
        ]
    )
    clean_env.commit()

    repo = Repository(clean_env)
    deduped = repo.get_all_essays_deduped(user_id=student.id, completed_only=True)
    by_fname = {canon.filename: canon for canon, _ in deduped}
    assert by_fname["capstone.pdf"].id == e_completed.id

    app = create_app()
    client = TestClient(app)

    stats_resp = client.get("/api/essays/stats", headers=headers)
    assert stats_resp.status_code == 200
    stats = stats_resp.json()
    assert stats["total_essays"] == 1
    assert stats["total_citations"] == 3
    assert stats["verified"] == 1
    assert stats["metadata_error"] == 2
    assert stats["incomplete_metadata"] == 1
    assert stats["suspected_hallucination"] == 0

    # Shared report includes verdict_counts.incomplete_metadata and top-level document_diagnostics
    share_token = create_essay_share_token(e_completed.id)["share_token"]
    shared_resp = client.get(f"/api/essays/shared/{share_token}")
    assert shared_resp.status_code == 200
    shared_data = shared_resp.json()
    assert shared_data["verdict_counts"]["incomplete_metadata"] == 1
    assert shared_data["verdict_counts"]["metadata_error"] == 2
    assert shared_data["document_diagnostics"] == {
        "ocr_applied": True,
        "legacy_encoding": "TCVN3",
    }


def test_sandbox_verify_summary_counts_consensus_and_soft_404_html_meta(
    clean_env,
    monkeypatch,
) -> None:
    """POST /api/essays/sandbox/verify exposes incomplete_metadata/unresolved/resource in summary,
    expands multi-source consensus, and serializes soft-404 html_meta while excluding it from matched_sources."""
    _, headers = _create_user_with_headers(
        clean_env,
        username="sandbox_tester",
        plan_tier="pro",
    )

    consensus_cand = SourceCandidate(
        source_name="openalex",
        found=True,
        doi="10.18653/v1/N19-1423",
        title="BERT: Pre-training of Deep Bidirectional Transformers",
        authors=["Jacob Devlin"],
        year="2019",
        venue="NAACL",
        url="https://openalex.org/W2963341956",
        confidence=0.97,
        external_ids={
            "arxiv": "1810.04805",
            "_agreed_sources": ["openalex", "crossref", "arxiv"],
            "_corroborating_records": [
                {
                    "source_name": "openalex",
                    "title": "BERT: Pre-training of Deep Bidirectional Transformers",
                    "authors": ["Jacob Devlin"],
                    "year": "2019",
                    "venue": "NAACL",
                    "doi": "10.18653/v1/N19-1423",
                    "url": "https://openalex.org/W2963341956",
                    "confidence": 0.97,
                    "external_ids": {"arxiv": "1810.04805"},
                },
                {
                    "source_name": "crossref",
                    "title": "BERT: Pre-training of Deep Bidirectional Transformers",
                    "authors": ["Jacob Devlin"],
                    "year": "2019",
                    "venue": "Proceedings of NAACL-HLT",
                    "doi": "10.18653/v1/N19-1423",
                    "url": "https://doi.org/10.18653/v1/N19-1423",
                    "confidence": 0.95,
                    "external_ids": {},
                },
                {
                    "source_name": "arxiv",
                    "title": "BERT: Pre-training of Deep Bidirectional Transformers",
                    "authors": ["Jacob Devlin"],
                    "year": "2019",
                    "venue": "arXiv",
                    "url": "https://arxiv.org/abs/1810.04805",
                    "confidence": 0.96,
                    "external_ids": {"arxiv": "1810.04805"},
                },
            ],
        },
    )
    soft_404_meta = HtmlPageMeta(
        page_title="404 - Article Not Found",
        site_name="Publisher Portal",
        canonical_url="https://publisher.example.org/missing",
        is_soft_404=True,
    )

    class _FakeOrch:
        async def prefetch_identifiers(self, _cits):
            return {}

        async def retrieve(self, cit: Citation, **_kwargs) -> SourceResult:
            if "BERT" in (cit.raw_text or ""):
                return SourceResult(
                    citation_raw=cit.raw_text,
                    candidates=[consensus_cand],
                    sources_queried=["openalex", "crossref", "arxiv"],
                    sources_succeeded=["openalex", "crossref", "arxiv"],
                )
            return SourceResult(
                citation_raw=cit.raw_text,
                candidates=[],
                sources_queried=["openalex", "crossref"],
                sources_succeeded=[],
                url_status="dead",
                url_status_code=200,
                html_meta=soft_404_meta,
            )

    class _FakeChecker:
        def check(self, citation: Citation, source: SourceResult, **_kwargs) -> CitationVerdict:
            if "BERT" in (citation.raw_text or ""):
                return CitationVerdict(
                    citation=citation,
                    label=ValidationLabel.VERIFIED,
                    confidence=0.98,
                    reasoning="Verified by 3 databases.",
                    triggered_rules=["R-CONSENSUS-FULL"],
                    matched_source=source,
                )
            return CitationVerdict(
                citation=citation,
                label=ValidationLabel.METADATA_ERROR,
                confidence=0.72,
                reasoning="Incomplete metadata & soft-404 landing page.",
                triggered_rules=["R-INCOMPLETE-METADATA"],
                mismatched_fields=["year"],
                matched_source=source,
            )

    fake_pipeline = IntegrityPipeline(orchestrator=_FakeOrch(), checker=_FakeChecker())  # type: ignore[arg-type]
    app = create_app()
    app.dependency_overrides[deps.get_pipeline] = lambda: fake_pipeline
    try:
        client = TestClient(app)
        resp = client.post(
            "/api/essays/sandbox/verify",
            headers=headers,
            json={
                "references_text": (
                    "[1] Devlin, J. (2019). BERT: Pre-training of Deep Bidirectional Transformers. NAACL.\n"
                    "[2] Broken Entry https://publisher.example.org/missing"
                ),
                "style": "IEEE",
            },
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        summary = body["summary"]
        assert summary["verified"] == 1
        assert summary["metadata_error"] == 1
        assert summary["incomplete_metadata"] == 1
        assert "unresolved" in summary
        assert "resource" in summary

        res_bert = body["results"][0]
        assert [m["source"] for m in res_bert["matched_sources"]] == [
            "openalex",
            "crossref",
            "arxiv",
        ]

        res_soft404 = body["results"][1]
        assert res_soft404["html_meta"] is not None
        assert res_soft404["html_meta"]["is_soft_404"] is True
        assert res_soft404["matched_sources"] == []
    finally:
        app.dependency_overrides.clear()


# ---------------------------------------------------------------------------
# 5. Admin Cache Clear, Circuit Breaker Reset & Audit Totals (>25 rows)
# ---------------------------------------------------------------------------


def test_admin_cache_clear_circuit_breaker_reset_and_audit_stats_over_25_rows(
    clean_env,
    monkeypatch,
) -> None:
    """DELETE /api/cache resets SQLite + runtime caches (leaving local_papers_count separate),
    POST /api/system/circuit-breakers/reset resets single/all breakers, and GET /api/audit/stats
    returns exact SQL totals across >25 rows while GET /api/audit/log remains a plain list."""
    admin, admin_headers = _create_user_with_headers(
        clean_env,
        username="admin_v370",
        role="admin",
        plan_tier="ultra",
    )
    del admin

    # 1. Seed SQLite CitationCache + live orchestrator Wave-0/Negative/Session metrics
    now_ts = datetime.now(UTC).timestamp()
    clean_env.add_all(
        [
            CitationCache(
                cache_key="doi:10.1038/nature14539",
                source="openalex",
                hit_count=7,
                raw_response=json.dumps({"expires_at": now_ts + 3600}),
            ),
            CitationCache(
                cache_key="doi:10.1145/expired",
                source="crossref",
                hit_count=2,
                raw_response=json.dumps({"expires_at": now_ts - 60}),
            ),
        ]
    )
    clean_env.commit()

    orch = RetrievalOrchestrator(use_local_db=False, enable_link_validation=False)
    sample_res = SourceResult(
        citation_raw="Sample",
        candidates=[],
        sources_queried=["openalex", "crossref", "arxiv"],
        sources_succeeded=[],
    )
    orch._put_wave0_memory_hit("doi:10.1038/nature14539", sample_res)
    orch._negative_cache.set("neg_key_1", sample_res)
    orch._record_session_cache_hit(6)
    orch._record_session_cache_miss(2)
    orch._singleflight.coalesced_hits = 3
    monkeypatch.setattr(deps, "_pipeline_singleton", SimpleNamespace(orchestrator=orch))

    app = create_app()
    client = TestClient(app)

    stats_before = client.get("/api/cache/stats", headers=admin_headers)
    assert stats_before.status_code == 200
    sb = stats_before.json()
    assert sb["dynamic_entries"] == 2  # Dynamic SQLite entries separated from static local corpus!
    assert sb["total"] == 2 + sb["local_papers_count"]
    assert sb["persistent_entries"] == 1
    assert sb["expired_entries"] == 1
    assert sb["persistent_hits"] == 9
    assert sb["session_hits"] == 6
    assert sb["session_misses"] == 2
    assert sb["session_hit_rate_percent"] == 75.0
    assert sb["wave0_entries"] == 1
    assert sb["negative_cache_entries"] == 1
    assert sb["singleflight_coalesced"] == 3
    assert "local_papers_count" in sb

    health_before = client.get("/api/system/health", headers=admin_headers)
    assert health_before.status_code == 200
    hb_cache = health_before.json()["cache_stats"]
    assert hb_cache["session_hits"] == 6
    assert hb_cache["wave0_entries"] == 1
    assert hb_cache["persistent_entries"] == 1

    clear_resp = client.delete("/api/cache", headers=admin_headers)
    assert clear_resp.status_code == 200
    assert clear_resp.json()["deleted_count"] == 2

    stats_after = client.get("/api/cache/stats", headers=admin_headers).json()
    assert stats_after["dynamic_entries"] == 0
    assert stats_after["persistent_entries"] == 0
    assert stats_after["expired_entries"] == 0
    assert stats_after["persistent_hits"] == 0
    assert stats_after["session_hits"] == 0
    assert stats_after["session_misses"] == 0
    assert stats_after["wave0_entries"] == 0
    assert stats_after["negative_cache_entries"] == 0
    assert stats_after["singleflight_coalesced"] == 0

    # 2. Circuit breaker trip + targeted reset + reset-all
    cb_reg = get_circuit_breaker_registry()
    for _ in range(5):
        cb_reg.record_infra_failure("openalex", "HTTP 429: rate limit")
        cb_reg.record_infra_failure("crossref", "HTTP 503: service unavailable")
    snap_tripped = cb_reg.snapshot_all()
    assert snap_tripped["openalex"]["state"] == "open"
    assert snap_tripped["openalex"]["opened_at"] is not None
    assert snap_tripped["crossref"]["state"] == "open"

    reset_one = client.post(
        "/api/system/circuit-breakers/reset",
        headers=admin_headers,
        json={"source": "openalex"},
    )
    assert reset_one.status_code == 200
    assert reset_one.json() == {"status": "ok", "reset_sources": ["openalex"]}
    snap_mid = cb_reg.snapshot_all()
    assert snap_mid["openalex"]["state"] == "closed"
    assert snap_mid["openalex"]["consecutive_failures"] == 0
    assert snap_mid["openalex"]["opened_at"] is None
    assert snap_mid["crossref"]["state"] == "open"

    reset_all = client.post(
        "/api/system/circuit-breakers/reset",
        headers=admin_headers,
        json={},
    )
    assert reset_all.status_code == 200
    assert "crossref" in reset_all.json()["reset_sources"]
    assert cb_reg.snapshot_all()["crossref"]["state"] == "closed"
    assert cb_reg.snapshot_all()["crossref"]["consecutive_failures"] == 0

    # 3. Audit log >25 rows: /api/audit/log stays plain list, /api/audit/stats gives exact SQL totals
    essay = EssayRecord(filename="audit_target.pdf", num_pages=2, job_status="completed")
    clean_env.add(essay)
    clean_env.flush()
    verdict = VerdictRecord(
        essay_id=essay.id,
        citation_raw="[1] Audited Ref",
        label="verified",
        confidence=0.9,
        triggered_rules="[]",
        mismatched_fields="[]",
    )
    clean_env.add(verdict)
    clean_env.flush()

    actors = ["teacher_alpha", "teacher_beta", "teacher_gamma", "admin_root"]
    for i in range(32):
        clean_env.add(
            AuditLog(
                verdict_id=verdict.id,
                original_label="metadata_error",
                new_label="verified",
                user=actors[i % len(actors)],
                note=f"Override #{i + 1}",
            )
        )
    clean_env.commit()

    audit_list_resp = client.get("/api/audit/log?limit=25", headers=admin_headers)
    assert audit_list_resp.status_code == 200
    audit_list = audit_list_resp.json()
    assert isinstance(audit_list, list)
    assert len(audit_list) == 25

    audit_stats_resp = client.get("/api/audit/stats", headers=admin_headers)
    assert audit_stats_resp.status_code == 200
    assert audit_stats_resp.json() == {"total_events": 32, "unique_actors": 4}

    filtered_stats_resp = client.get(
        "/api/audit/stats?user=teacher_alpha",
        headers=admin_headers,
    )
    assert filtered_stats_resp.status_code == 200
    assert filtered_stats_resp.json() == {"total_events": 8, "unique_actors": 1}


async def test_pipeline_step5_emits_progressive_sources_queried_callbacks(tmp_path) -> None:
    """IntegrityPipeline.run_async emits incremental Step 5 ('retrieving') progress_callback
    updates with partial sources_queried as Wave-0 and individual citation retrievals finish."""
    bib_file = tmp_path / "refs.bib"
    bib_file.write_text(
        "@article{vaswani2017,\n"
        "  title={Attention Is All You Need},\n"
        "  author={Vaswani, Ashish and Shazeer, Noam},\n"
        "  year={2017},\n"
        "  doi={10.48550/arXiv.1706.03762}\n"
        "}\n"
        "@article{devlin2019,\n"
        "  title={BERT: Pre-training of Deep Bidirectional Transformers},\n"
        "  author={Devlin, Jacob},\n"
        "  year={2019}\n"
        "}\n",
        encoding="utf-8",
    )

    class _ProgressiveOrch:
        async def prefetch_identifiers(self, cits: list[Citation]) -> dict[int, SourceResult]:
            for c in cits:
                if c.doi:
                    return {
                        id(c): SourceResult(
                            citation_raw=c.raw_text,
                            candidates=[
                                SourceCandidate(
                                    source_name="openalex",
                                    found=True,
                                    doi=c.doi,
                                    title=c.title,
                                    authors=list(c.authors or []),
                                    year=c.year,
                                    confidence=0.96,
                                )
                            ],
                            sources_queried=["openalex"],
                            sources_succeeded=["openalex"],
                        )
                    }
            return {}

        async def retrieve(self, cit: Citation, **_kwargs) -> SourceResult:
            return SourceResult(
                citation_raw=cit.raw_text,
                candidates=[],
                sources_queried=["crossref"],
                sources_succeeded=[],
                sources_failed={"crossref": "crossref: skipped (rate-limit backoff active)"},
            )

    class _FastChecker:
        def check(self, citation: Citation, source: SourceResult, **_kwargs) -> CitationVerdict:
            return CitationVerdict(
                citation=citation,
                label=ValidationLabel.VERIFIED if source.candidates else ValidationLabel.UNRESOLVED,
                confidence=0.9,
                reasoning="ok",
                triggered_rules=[],
                matched_source=source,
            )

    pipeline = IntegrityPipeline(orchestrator=_ProgressiveOrch(), checker=_FastChecker())  # type: ignore[arg-type]
    emitted: list[tuple[str, int, dict[str, Any]]] = []

    await pipeline.run_async(
        bib_file,
        progress_callback=lambda step, idx, stats: emitted.append((step, idx, dict(stats))),
    )

    step5_with_sources = [
        stats["sources_queried"]
        for step, idx, stats in emitted
        if step == "retrieving" and idx == 4 and stats.get("sources_queried")
    ]
    assert len(step5_with_sources) >= 2
    assert step5_with_sources[0] == {"openalex": "ok"}
    assert step5_with_sources[-1] == {"openalex": "ok", "crossref": "rate_limited"}
