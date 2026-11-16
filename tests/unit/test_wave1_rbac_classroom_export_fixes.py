"""Wave 1–3 Regression Suite for Track 4:
Essays, RBAC/IDOR, Sandbox, Verdicts/CIS, Classroom CRUD & Exporters.

Strictly tests real endpoints, real SQLite persistence, real ReportLab/PyMuPDF PDF rendering,
real python-docx XML serialization, and real ZIP/CSV byte streams without weak mocks.
"""

from __future__ import annotations

import csv
import inspect
import io
import json
import secrets
import zipfile
from datetime import UTC, datetime, timedelta
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import fitz
import jwt
import pytest
from docx import Document as WordDocument
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session, sessionmaker

from integrity_checker.api import deps
from integrity_checker.api.main import create_app
from integrity_checker.api.progress import get_tracker
from integrity_checker.api.routes import essays as essays_route
from integrity_checker.api.routes import export as export_route
from integrity_checker.api.routes.report import _compute_revision_diff
from integrity_checker.billing.plans import ensure_user_quota_current
from integrity_checker.config import get_settings
from integrity_checker.db import session as db_session_mod
from integrity_checker.db.models import (
    AuditLog,
    Base,
    CitationRecord,
    Class,
    ClassMembership,
    EssayRecord,
    User,
    VerdictRecord,
)
from integrity_checker.db.models import Session as SessionModel
from integrity_checker.db.repository import Repository
from integrity_checker.export.docx_exporter import (
    export_auto_healed_docx,
    export_report_to_docx,
)
from integrity_checker.models.citation import Citation
from integrity_checker.models.source import SourceCandidate, SourceResult
from integrity_checker.models.validation import CitationVerdict, ValidationLabel
from integrity_checker.pipeline.integrity_pipeline import IntegrityPipeline


@pytest.fixture()
def isolated_env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """Create an isolated file-backed SQLite database and uploads directory per test."""
    db_path = tmp_path / "track4_test.db"
    uploads_dir = tmp_path / "uploads"
    uploads_dir.mkdir(parents=True, exist_ok=True)

    engine = create_engine(
        f"sqlite:///{db_path}",
        connect_args={"check_same_thread": False},
    )

    @event.listens_for(engine, "connect")
    def _set_sqlite_pragma(dbapi_conn, _conn_record):
        cursor = dbapi_conn.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    Base.metadata.create_all(bind=engine)
    session_factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    def _get_session() -> Session:
        return session_factory()

    def _override_get_db():
        db = session_factory()
        try:
            yield db
        finally:
            db.close()

    monkeypatch.setattr(db_session_mod, "get_session", _get_session)
    monkeypatch.setattr(essays_route, "UPLOADS_DIR", uploads_dir)
    if hasattr(essays_route, "_sandbox_verify_rate_buckets"):
        essays_route._sandbox_verify_rate_buckets.clear()

    tracker = get_tracker()
    tracker._states.clear()
    tracker._retry_counts.clear()
    tracker._subscribers.clear()

    app = create_app()
    app.dependency_overrides[deps.get_db] = _override_get_db

    session = session_factory()
    try:
        yield SimpleNamespace(
            app=app,
            client=TestClient(app),
            session=session,
            session_factory=session_factory,
            uploads_dir=uploads_dir,
            tmp_path=tmp_path,
        )
    finally:
        app.dependency_overrides.clear()
        tracker._states.clear()
        tracker._retry_counts.clear()
        tracker._subscribers.clear()
        session.close()
        engine.dispose()


def _make_auth_user(
    session: Session,
    *,
    username: str,
    role: str = "user",
    plan_tier: str | None = None,
    monthly_uploads_used: int = 0,
    full_name: str | None = None,
) -> tuple[User, dict[str, str]]:
    resolved_tier = plan_tier or (
        "ultra" if role == "admin" else ("pro" if role == "teacher" else "basic")
    )
    user = User(
        username=username,
        password_hash="hashed_test_pw",
        role=role,
        email=f"{username}@citra.edu.vn",
        full_name=full_name or username.title(),
        is_active=1,
        email_verified=1,
        can_override_verdicts=1 if role in ("teacher", "admin") else 0,
        plan_tier=resolved_tier,
    )
    ensure_user_quota_current(user)
    user.monthly_uploads_used = monthly_uploads_used
    session.add(user)
    session.flush()

    expires_at = datetime.now(UTC) + timedelta(hours=2)
    token = jwt.encode(
        {"sub": str(user.id), "exp": expires_at, "jti": secrets.token_hex(8)},
        get_settings().auth.jwt_secret,
        algorithm="HS256",
    )
    session.add(SessionModel(user_id=user.id, token=token, expires_at=expires_at))
    session.commit()
    session.refresh(user)
    return user, {"Authorization": f"Bearer {token}"}


def _build_minimal_pdf_bytes(text: str = "Sample PDF content", pages: int = 1) -> bytes:
    doc = fitz.open()
    try:
        for idx in range(max(1, pages)):
            page = doc.new_page(width=595, height=842)
            page.insert_text(fitz.Point(72, 100), f"{text} (Page {idx + 1})", fontsize=12)
        return doc.tobytes()
    finally:
        doc.close()


# ---------------------------------------------------------------------------
# 1. Cross-user PDF preview rglob leak + Decision-Support badge + Sandbox PDF
# ---------------------------------------------------------------------------


def test_cross_user_pdf_preview_rglob_blocked_and_decision_support_virtual_badge(
    isolated_env,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """User B naming an essay '{victim_id}.pdf' must NEVER trigger data/essays.rglob()
    to render User A's private uploaded PDF, and virtual preview badges must use
    non-accusatory decision-support wording ('NGHI VẤN NGUỒN BỊA ĐẶT')."""
    fake_project_root = isolated_env.tmp_path / "project_root"
    nested_essays_dir = fake_project_root / "data" / "essays" / "uploads"
    nested_essays_dir.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(essays_route, "PROJECT_ROOT", fake_project_root)
    monkeypatch.setattr(essays_route, "UPLOADS_DIR", nested_essays_dir)

    user_a, headers_a = _make_auth_user(isolated_env.session, username="victim_alice")
    user_b, headers_b = _make_auth_user(isolated_env.session, username="attacker_bob")

    essay_a = EssayRecord(
        filename="alice_private.pdf",
        num_pages=1,
        user_id=user_a.id,
        job_status="completed",
    )
    isolated_env.session.add(essay_a)
    isolated_env.session.commit()

    # Persist User A's private PDF at data/essays/uploads/{essay_a.id}.pdf
    secret_pdf = _build_minimal_pdf_bytes("CONFIDENTIAL MANUSCRIPT OF ALICE 9912")
    (nested_essays_dir / f"{essay_a.id}.pdf").write_bytes(secret_pdf)

    # User B has an essay (e.g. .bib or missing .pdf) whose filename collides with "{essay_a.id}.pdf"
    essay_b = EssayRecord(
        filename=f"{essay_a.id}.pdf",
        num_pages=1,
        user_id=user_b.id,
        job_status="completed",
    )
    isolated_env.session.add(essay_b)
    isolated_env.session.flush()
    isolated_env.session.add(
        VerdictRecord(
            essay_id=essay_b.id,
            citation_raw="Fabricated, X. (2025). Non-existent Study.",
            label="suspected_hallucination",
            confidence=0.85,
            triggered_rules="[]",
            mismatched_fields="[]",
        )
    )
    isolated_env.session.commit()

    resp_a = isolated_env.client.get(
        f"/api/essays/{essay_a.id}/page-preview/1", headers=headers_a
    )
    resp_b = isolated_env.client.get(
        f"/api/essays/{essay_b.id}/page-preview/1", headers=headers_b
    )
    assert resp_a.status_code == 200
    assert resp_b.status_code == 200
    # Attacker MUST NOT receive Alice's rendered PDF bytes!
    assert resp_b.content != resp_a.content

    preview_src = inspect.getsource(essays_route.get_essay_page_preview)
    assert "rglob" not in preview_src
    assert "NGHI VẤN NGUỒN BỊA ĐẶT" in preview_src
    assert "[NGUỒN BỊA ĐẶT /" not in preview_src


def test_sandbox_generate_pdf_sanitizes_custom_filename_rfc5987_and_renders_vietnamese_unicode(
    isolated_env,
) -> None:
    """POST /api/essays/sandbox/generate-pdf must sanitize custom_filename against path traversal
    and header injection, include RFC 5987 UTF-8 filename*, and embed a Unicode TTF font so
    Vietnamese diacritics survive cleanly in the generated PDF."""
    _, headers = _make_auth_user(
        isolated_env.session, username="sandbox_vn_author", plan_tier="pro"
    )

    resp = isolated_env.client.post(
        "/api/essays/sandbox/generate-pdf",
        headers=headers,
        json={
            "title": "Đánh giá Độ tin cậy Trích dẫn Học thuật Tiếng Việt bằng Mô hình Lai",
            "author_name": "Nguyễn Văn Ánh & Đặng Thị Ước",
            "style": "apa",
            "download_only": True,
            "run_verification": False,
            "filename": '../../evil"\r\nX-Injected: 1_Khóa_luận_ThS_Nguyễn_Văn_Ánh.pdf',
            "items": [
                {
                    "title": "Nghiên cứu Xử lý Ngôn ngữ Tự nhiên tại Trường Đại học Tôn Đức Thắng",
                    "authors": ["Nguyễn Văn Ánh", "Trần Quốc Bảo"],
                    "year": "2024",
                    "venue": "Tạp chí Khoa học Công nghệ Việt Nam",
                    "doi": "10.18653/v1/2024.acl-long.1",
                    "cite_in_text": True,
                    "include_in_references": True,
                }
            ],
        },
    )
    assert resp.status_code == 200, resp.text
    cd = resp.headers.get("content-disposition", "")
    assert "\r" not in cd and "\n" not in cd
    assert ".." not in cd and "/" not in cd and "\\" not in cd
    assert "X-Injected" not in cd or 'filename="' in cd
    assert "filename*=UTF-8''" in cd

    doc = fitz.open(stream=resp.content, filetype="pdf")
    try:
        fonts_used = [f[3] for f in doc[0].get_fonts()]
        assert any(
            any(tag in fn for tag in ("CitraSans", "DejaVuSans", "Arial"))
            for fn in fonts_used
        ), f"Expected Unicode TTF font in sandbox PDF, got {fonts_used}"
        extracted = " ".join(" ".join(p.get_text().split()) for p in doc)
    finally:
        doc.close()

    assert "Đánh giá Độ tin cậy Trích dẫn" in extracted
    assert "Nguyễn Văn Ánh" in extracted
    assert "Đặng Thị Ước" in extracted
    assert "Đại học Tôn Đức Thắng" in extracted


# ---------------------------------------------------------------------------
# 2. /sandbox/verify rate limit + allow_serpapi policy + paid remediation gate
# ---------------------------------------------------------------------------


def test_sandbox_verify_enforces_rate_limit_serpapi_policy_and_paid_remediation_gate(
    isolated_env,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """/sandbox/verify must pass allow_serpapi=policy.allow_serpapi_fallback, gate full
    auto-remediation behind paid plans, and enforce per-user rate limiting (HTTP 429)."""
    _, basic_headers = _make_auth_user(
        isolated_env.session, username="basic_sandbox_u", role="user", plan_tier="basic"
    )
    _, ultra_headers = _make_auth_user(
        isolated_env.session, username="ultra_sandbox_u", role="user", plan_tier="ultra"
    )

    observed_serpapi_flags: list[bool | None] = []

    class _SpyOrch:
        async def retrieve(
            self, cit: Citation, *, allow_serpapi: bool | None = None
        ) -> SourceResult:
            observed_serpapi_flags.append(allow_serpapi)
            return SourceResult(
                citation_raw=cit.raw_text,
                candidates=[
                    SourceCandidate(
                        source_name="openalex",
                        found=True,
                        doi="10.18653/v1/N19-1423",
                        title="BERT: Pre-training of Deep Bidirectional Transformers",
                        authors=["Jacob Devlin"],
                        year="2019",
                        venue="NAACL",
                        confidence=0.96,
                    )
                ],
                sources_queried=["openalex"],
                sources_succeeded=["openalex"],
            )

    class _SpyChecker:
        def check(self, citation: Citation, source: SourceResult, **_kw) -> CitationVerdict:
            return CitationVerdict(
                citation=citation,
                label=ValidationLabel.METADATA_ERROR,
                confidence=0.82,
                reasoning="Year mismatch (cited 2021 vs 2019).",
                triggered_rules=["R-YEAR-MISMATCH"],
                mismatched_fields=["year"],
                matched_source=source,
            )

    fake_pipeline = IntegrityPipeline(
        orchestrator=_SpyOrch(),  # type: ignore[arg-type]
        checker=_SpyChecker(),  # type: ignore[arg-type]
    )
    isolated_env.app.dependency_overrides[deps.get_pipeline] = lambda: fake_pipeline

    payload = {
        "references_text": "Devlin, J. (2021). BERT: Pre-training of Deep Bidirectional Transformers. NAACL.",
        "style": "apa",
    }

    # 1. Basic user: allow_serpapi=False AND remediation is gated (None)
    r_basic = isolated_env.client.post(
        "/api/essays/sandbox/verify", headers=basic_headers, json=payload
    )
    assert r_basic.status_code == 200, r_basic.text
    assert observed_serpapi_flags[-1] is False
    assert r_basic.json().get("remediation") is None

    # 2. Ultra user: allow_serpapi=True AND full remediation is unlocked
    r_ultra = isolated_env.client.post(
        "/api/essays/sandbox/verify", headers=ultra_headers, json=payload
    )
    assert r_ultra.status_code == 200, r_ultra.text
    assert observed_serpapi_flags[-1] is True
    rem = r_ultra.json().get("remediation")
    assert isinstance(rem, dict) and len(rem.get("entries") or []) == 1

    # 3. Burst requests from Basic user exceed per-user rate limit -> HTTP 429
    monkeypatch.setattr(essays_route, "SANDBOX_VERIFY_MAX_REQUESTS", 3, raising=False)
    statuses = []
    for _ in range(5):
        resp = isolated_env.client.post(
            "/api/essays/sandbox/verify", headers=basic_headers, json=payload
        )
        statuses.append(resp.status_code)
    assert 429 in statuses, f"Expected 429 rate-limit response, got {statuses}"


# ---------------------------------------------------------------------------
# 3. Queued essay delete refund, .docx XML/page-cap & atomic persistence, reanalyze
# ---------------------------------------------------------------------------


def test_delete_queued_essay_refunds_monthly_upload_quota(isolated_env) -> None:
    """Deleting a 'queued' essay with quota_charged == 1 must refund 1 monthly upload slot."""
    student, headers = _make_auth_user(
        isolated_env.session,
        username="queued_refund_student",
        plan_tier="basic",
        monthly_uploads_used=3,
    )
    queued_essay = EssayRecord(
        filename="waiting_in_queue.pdf",
        num_pages=4,
        user_id=student.id,
        job_status="queued",
        quota_charged=1,
        cis_json=None,
    )
    isolated_env.session.add(queued_essay)
    isolated_env.session.commit()
    eid = queued_essay.id

    del_resp = isolated_env.client.delete(f"/api/essays/{eid}", headers=headers)
    assert del_resp.status_code == 200, del_resp.text

    isolated_env.session.expire_all()
    assert isolated_env.session.get(EssayRecord, eid) is None
    refreshed_student = isolated_env.session.get(User, student.id)
    assert refreshed_student is not None
    assert refreshed_student.monthly_uploads_used == 2


def test_docx_upload_enforces_xml_safety_and_estimated_page_cap_and_atomic_persistence(
    isolated_env,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """DOCX uploads must block DTD/XXE archives (400), enforce estimated page limits (402),
    and roll back quota deduction if persisting upload bytes raises OSError."""
    student, headers = _make_auth_user(
        isolated_env.session,
        username="docx_guard_student",
        plan_tier="basic",  # max_pages_per_pdf = 15
        monthly_uploads_used=0,
    )

    # 1. Malicious DOCX with DTD entity declaration inside word/document.xml -> 400
    xxe_buf = io.BytesIO()
    with zipfile.ZipFile(xxe_buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(
            "word/document.xml",
            b'<?xml version="1.0"?>'
            b'<!DOCTYPE lolz [<!ENTITY lol "lol">]>'
            b'<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
            b"<w:body><w:p><w:r><w:t>&lol;</w:t></w:r></w:p></w:body></w:document>",
        )
    r_xxe = isolated_env.client.post(
        "/api/essays",
        headers=headers,
        files={
            "file": (
                "malicious.docx",
                xxe_buf.getvalue(),
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            )
        },
    )
    assert r_xxe.status_code == 400, r_xxe.text

    # 2. Oversized 20-page DOCX on Basic plan (max 15 pages) -> 402
    big_doc = WordDocument()
    for p_idx in range(20):
        big_doc.add_paragraph(f"Chapter {p_idx + 1}: Academic text content.")
        if p_idx < 19:
            big_doc.add_page_break()
    big_buf = io.BytesIO()
    big_doc.save(big_buf)

    r_pages = isolated_env.client.post(
        "/api/essays",
        headers=headers,
        files={
            "file": (
                "long_thesis.docx",
                big_buf.getvalue(),
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            )
        },
    )
    assert r_pages.status_code == 402, r_pages.text

    # 3. Simulated disk-full OSError while persisting bytes -> quota NOT deducted!
    valid_pdf = _build_minimal_pdf_bytes("Short valid paper", pages=2)

    def _disk_full(*_args, **_kwargs):
        raise OSError("Simulated disk full error")

    monkeypatch.setattr(essays_route, "_persist_upload_bytes", _disk_full)
    with pytest.raises(OSError, match="Simulated disk full"):
        isolated_env.client.post(
            "/api/essays",
            headers=headers,
            files={"file": ("valid.pdf", valid_pdf, "application/pdf")},
        )

    isolated_env.session.expire_all()
    refreshed = isolated_env.session.get(User, student.id)
    assert refreshed is not None
    assert refreshed.monthly_uploads_used == 0
    assert isolated_env.session.query(EssayRecord).count() == 0


def test_reanalyze_passes_bypass_report_cache_charges_essay_owner_and_refreshes_heartbeat(
    isolated_env,
) -> None:
    """reanalyze must pass bypass_report_cache=True, refresh job_heartbeat_at on progress
    callbacks, and charge/refund essay.user_id (never drifting teacher vs student quotas)."""
    teacher, teacher_headers = _make_auth_user(
        isolated_env.session,
        username="prof_reanalyze",
        role="teacher",
        plan_tier="pro",
        monthly_uploads_used=0,
    )
    student, _ = _make_auth_user(
        isolated_env.session,
        username="stu_reanalyze",
        role="user",
        plan_tier="basic",
        monthly_uploads_used=0,
    )

    cls = Class(name="Thesis Lab", teacher_id=teacher.id, join_code="CITRA-RLAB")
    isolated_env.session.add(cls)
    isolated_env.session.flush()
    isolated_env.session.add(ClassMembership(class_id=cls.id, student_id=student.id))

    stale_hb = datetime.now(UTC) - timedelta(hours=2)
    essay_ok = EssayRecord(
        filename="student_completed.pdf",
        num_pages=2,
        user_id=student.id,
        class_id=cls.id,
        job_status="completed",
        quota_charged=1,
        cis_json=json.dumps({"score": 80.0, "components": {}}),
        job_heartbeat_at=stale_hb,
    )
    essay_failed = EssayRecord(
        filename="student_failed.pdf",
        num_pages=2,
        user_id=student.id,
        class_id=cls.id,
        job_status="failed",
        quota_charged=0,  # Refunded after initial failure
        cis_json=None,
    )
    isolated_env.session.add_all([essay_ok, essay_failed])
    isolated_env.session.commit()

    pdf_bytes = _build_minimal_pdf_bytes("Reanalyze test manuscript")
    (isolated_env.uploads_dir / f"{essay_ok.id}.pdf").write_bytes(pdf_bytes)
    (isolated_env.uploads_dir / f"{essay_failed.id}.pdf").write_bytes(pdf_bytes)

    captured_kwargs: dict[str, Any] = {}
    heartbeat_during_step: list[datetime | None] = []

    class _InspectPipeline:
        async def run_async(
            self,
            pdf_path: str,
            *,
            essay_id: int | None = None,
            progress_callback: Any = None,
            max_citations: int | None = None,
            allow_serpapi: bool | None = None,
            bypass_report_cache: bool = False,
        ):
            captured_kwargs["bypass_report_cache"] = bypass_report_cache
            if str(pdf_path).endswith(f"{essay_failed.id}.pdf"):
                raise RuntimeError("Transient parser crash during reanalyze")
            # Reset heartbeat to stale right before step callback to prove callback refreshes it
            check_s = isolated_env.session_factory()
            try:
                row = check_s.get(EssayRecord, essay_id)
                if row is not None:
                    row.job_heartbeat_at = stale_hb
                    check_s.commit()
            finally:
                check_s.close()

            if callable(progress_callback):
                progress_callback("retrieving", 4, {"citations_found": 3})

            verify_s = isolated_env.session_factory()
            try:
                row2 = verify_s.get(EssayRecord, essay_id)
                heartbeat_during_step.append(
                    row2.job_heartbeat_at if row2 is not None else None
                )
            finally:
                verify_s.close()

            return SimpleNamespace(
                num_pages=2,
                citations=[],
                extracted_citations=[],
                verdicts=[],
                style_profile={"style": "APA", "confidence": 0.9},
                cis={"score": 95.0, "components": {}, "num_citations": 0, "num_unresolved": 0},
            )

    isolated_env.app.dependency_overrides[deps.get_pipeline] = _InspectPipeline

    # A. Reanalyze completed essay -> bypass_report_cache=True & heartbeat refreshed on step callback
    r_ok = isolated_env.client.post(
        f"/api/essays/{essay_ok.id}/reanalyze", headers=teacher_headers
    )
    assert r_ok.status_code == 200, r_ok.text
    assert captured_kwargs.get("bypass_report_cache") is True
    assert heartbeat_during_step and heartbeat_during_step[0] is not None
    hb_val = heartbeat_during_step[0]
    hb_utc = hb_val if hb_val.tzinfo else hb_val.replace(tzinfo=UTC)
    assert hb_utc > stale_hb + timedelta(hours=1)

    # B. Teacher reanalyzes student's failed+refunded essay, and it fails again:
    # Teacher's monthly_uploads_used MUST remain 0, and student's MUST remain 0 (no cross-user drift!)
    r_fail = isolated_env.client.post(
        f"/api/essays/{essay_failed.id}/reanalyze", headers=teacher_headers
    )
    assert r_fail.status_code == 200, r_fail.text

    isolated_env.session.expire_all()
    t_after = isolated_env.session.get(User, teacher.id)
    s_after = isolated_env.session.get(User, student.id)
    assert t_after is not None and t_after.monthly_uploads_used == 0
    assert s_after is not None and s_after.monthly_uploads_used == 0


# ---------------------------------------------------------------------------
# 4. Teacher RBAC: class_id isolation + unenrolled override + RevisionDiff guard
# ---------------------------------------------------------------------------


def test_teacher_rbac_class_isolation_unenrolled_override_and_revision_diff_guard(
    isolated_env,
) -> None:
    """Essay submitted to class_id=C1 CANNOT be viewed/listed/diffed/overridden by Teacher B (C2),
    CAN still be viewed and overridden by Teacher A (C1) even after student leaves C1,
    and _compute_revision_diff never leaks all essays when essay.user_id is None."""
    teacher_a, headers_ta = _make_auth_user(
        isolated_env.session, username="teacher_alpha", role="teacher"
    )
    teacher_b, headers_tb = _make_auth_user(
        isolated_env.session, username="teacher_beta", role="teacher"
    )
    student_s, headers_s = _make_auth_user(
        isolated_env.session, username="shared_student", role="user", plan_tier="pro"
    )
    stranger_u, _ = _make_auth_user(
        isolated_env.session, username="stranger_owner", role="user", plan_tier="pro"
    )

    c1 = Class(name="Alpha Cohort", teacher_id=teacher_a.id, join_code="CITRA-ALP1")
    c2 = Class(name="Beta Cohort", teacher_id=teacher_b.id, join_code="CITRA-BET2")
    isolated_env.session.add_all([c1, c2])
    isolated_env.session.flush()
    isolated_env.session.add_all(
        [
            ClassMembership(class_id=c1.id, student_id=student_s.id),
            ClassMembership(class_id=c2.id, student_id=student_s.id),
        ]
    )

    essay_c1 = EssayRecord(
        filename="Capstone_v1.pdf",
        num_pages=10,
        user_id=student_s.id,
        class_id=c1.id,
        cis_json=json.dumps({"score": 72.0}),
        job_status="completed",
    )
    essay_draft = EssayRecord(
        filename="Capstone_v2.pdf",
        num_pages=11,
        user_id=student_s.id,
        class_id=None,  # Unscoped essay remains visible to enrolled teachers
        cis_json=json.dumps({"score": 88.0}),
        job_status="completed",
    )
    essay_stranger = EssayRecord(
        filename="Private_Secret_Thesis.pdf",
        num_pages=15,
        user_id=stranger_u.id,
        class_id=None,
        cis_json=json.dumps({"score": 99.0}),
        job_status="completed",
    )
    essay_anon = EssayRecord(
        filename="Seeded_Demo_v2.pdf",
        num_pages=5,
        user_id=None,
        class_id=None,
        cis_json=json.dumps({"score": 81.0}),
        job_status="completed",
    )
    isolated_env.session.add_all([essay_c1, essay_draft, essay_stranger, essay_anon])
    isolated_env.session.flush()

    v_c1 = VerdictRecord(
        essay_id=essay_c1.id,
        citation_raw="Smith, J. (2020). Alpha Submission Citation.",
        label="metadata_error",
        confidence=0.6,
        triggered_rules="[]",
        mismatched_fields="[]",
    )
    v_stranger = VerdictRecord(
        essay_id=essay_stranger.id,
        citation_raw="Secret, S. (2024). Confidential Research.",
        label="verified",
        confidence=0.99,
        triggered_rules="[]",
        mismatched_fields="[]",
    )
    isolated_env.session.add_all([v_c1, v_stranger])
    isolated_env.session.commit()

    # 1. Teacher B (C2) CANNOT view or override essay_c1 (submitted to C1)!
    assert (
        isolated_env.client.get(f"/api/essays/{essay_c1.id}", headers=headers_tb).status_code
        == 403
    )
    assert (
        isolated_env.client.get(
            f"/api/essays/{essay_c1.id}/verdicts", headers=headers_tb
        ).status_code
        == 403
    )
    assert (
        isolated_env.client.post(
            f"/api/essays/{essay_c1.id}/verdicts/{v_c1.id}/override",
            headers=headers_tb,
            json={"new_label": "verified", "reason": "cross-class attempt"},
        ).status_code
        == 403
    )
    tb_essay_ids = {
        e["id"]
        for e in isolated_env.client.get("/api/essays", headers=headers_tb).json()
    }
    assert essay_c1.id not in tb_essay_ids
    assert essay_draft.id in tb_essay_ids

    # 2. Teacher B calling revision-diff on essay_draft with ?compare_with=essay_c1.id MUST NOT leak essay_c1
    diff_tb = isolated_env.client.get(
        f"/api/essays/{essay_draft.id}/revision-diff?compare_with={essay_c1.id}",
        headers=headers_tb,
    )
    assert diff_tb.status_code == 200
    assert diff_tb.json().get("previous_essay_id") != essay_c1.id

    # 3. Student leaves C1 -> Teacher A (owner of C1) CAN STILL view & override essay_c1!
    leave_resp = isolated_env.client.delete(
        f"/api/teacher/classes/{c1.id}/leave", headers=headers_s
    )
    assert leave_resp.status_code == 200, leave_resp.text
    assert leave_resp.json() == {"status": "left", "class_id": c1.id}

    ovr_ta = isolated_env.client.post(
        f"/api/essays/{essay_c1.id}/verdicts/{v_c1.id}/override",
        headers=headers_ta,
        json={"new_label": "verified", "reason": "Graded after student left cohort"},
    )
    assert ovr_ta.status_code == 200, ovr_ta.text
    assert ovr_ta.json()["is_overridden"] is True

    # 4. _compute_revision_diff with essay.user_id is None NEVER calls get_all_essays() or leaks stranger essay
    repo = Repository(isolated_env.session)
    anon_diff = _compute_revision_diff(
        repo, essay_anon, [], compare_with_id=essay_stranger.id
    )
    assert anon_diff is None


# ---------------------------------------------------------------------------
# 5. Override to suspected_hallucination counts + resource-only CIS + override_record & AuditLog
# ---------------------------------------------------------------------------


def test_override_to_suspected_hallucination_counts_and_resource_only_cis_and_audit_mapping(
    isolated_env,
) -> None:
    """Overriding an unresolved citation to 'suspected_hallucination' must NOT inflate
    num_verified or analytics verified count; overriding a resource-only legal essay must
    preserve non-zero CIS; override_record exposes both legacy and TS keys; AuditLog records mapping changes."""
    teacher, headers_t = _make_auth_user(
        isolated_env.session, username="prof_cis_ovr", role="teacher", plan_tier="ultra"
    )
    student, _ = _make_auth_user(
        isolated_env.session, username="stu_law", role="user", plan_tier="pro"
    )

    cls = Class(name="Law & AI", teacher_id=teacher.id, join_code="CITRA-LAW1")
    isolated_env.session.add(cls)
    isolated_env.session.flush()
    isolated_env.session.add(ClassMembership(class_id=cls.id, student_id=student.id))

    # Essay 1: 1 verified + 1 unresolved -> teacher overrides unresolved to suspected_hallucination
    e_acad = EssayRecord(
        filename="AI_Paper.pdf",
        num_pages=6,
        user_id=student.id,
        class_id=cls.id,
        cis_json=json.dumps({"score": 50.0}),
        job_status="completed",
    )
    # Essay 2: ONLY Vietnamese legal statute resources -> CIS initially 95.0%
    e_legal = EssayRecord(
        filename="Tieu_Luan_Luat_Doanh_Nghiep.pdf",
        num_pages=8,
        user_id=student.id,
        class_id=cls.id,
        cis_json=json.dumps(
            {
                "score": 95.0,
                "components": {
                    "verified_ratio": 1.0,
                    "metadata_accuracy": 1.0,
                    "in_text_bib_consistency": 0.9,
                    "format_consistency": 0.9,
                    "identifier_validity": 1.0,
                },
            }
        ),
        job_status="completed",
    )
    isolated_env.session.add_all([e_acad, e_legal])
    isolated_env.session.flush()

    v_ok = VerdictRecord(
        essay_id=e_acad.id,
        citation_raw="Vaswani et al. (2017). Attention Is All You Need.",
        label="verified",
        confidence=0.98,
        mapping_status="matched",
    )
    v_unres = VerdictRecord(
        essay_id=e_acad.id,
        citation_raw="Ghost, A. (2024). Fabricated Neural Theorem.",
        label="unresolved",
        confidence=0.45,
        mapping_status="matched",
    )
    v_law_1 = VerdictRecord(
        essay_id=e_legal.id,
        citation_raw="Quốc hội (2020). Luật Doanh nghiệp số 59/2020/QH14.",
        label="resource",
        confidence=0.95,
        mapping_status="uncited_reference",
        triggered_rules=json.dumps(["R-VN-LEGAL-VERIFIED"]),
    )
    v_law_2 = VerdictRecord(
        essay_id=e_legal.id,
        citation_raw="Chính phủ (2025). Nghị định 356/2025/NĐ-CP.",
        label="resource",
        confidence=0.95,
        mapping_status="matched",
        triggered_rules=json.dumps(["R-VN-LEGAL-VERIFIED"]),
    )
    isolated_env.session.add_all([v_ok, v_unres, v_law_1, v_law_2])
    isolated_env.session.commit()

    # Override v_unres -> suspected_hallucination
    r_ovr_hal = isolated_env.client.post(
        f"/api/essays/{e_acad.id}/verdicts/{v_unres.id}/override",
        headers=headers_t,
        json={
            "new_label": "suspected_hallucination",
            "reason": "Confirmed non-existent paper",
        },
    )
    assert r_ovr_hal.status_code == 200, r_ovr_hal.text
    ovr_rec = r_ovr_hal.json()["override_record"]
    assert ovr_rec["original_label"] == "unresolved"
    assert ovr_rec["overridden_label"] == "suspected_hallucination"
    assert ovr_rec["previous_label"] == "unresolved"
    assert ovr_rec["new_label"] == "suspected_hallucination"

    # Check /api/essays num_verified == 1 (NOT 2!)
    essays_list = isolated_env.client.get("/api/essays", headers=headers_t).json()
    acad_summary = next(item for item in essays_list if item["id"] == e_acad.id)
    assert acad_summary["num_verified"] == 1

    # Check /api/teacher/classes/{id}/analytics verdict_breakdown
    analytics = isolated_env.client.get(
        f"/api/teacher/classes/{cls.id}/analytics", headers=headers_t
    ).json()
    assert analytics["verdict_breakdown"]["verified"] == 1
    assert analytics["verdict_breakdown"]["suspected_hallucination"] == 1

    # Override mapping_status on resource-only legal essay -> CIS MUST NOT crash to 0.0%!
    r_ovr_law = isolated_env.client.post(
        f"/api/essays/{e_legal.id}/verdicts/{v_law_1.id}/override",
        headers=headers_t,
        json={
            "new_label": "resource",
            "new_mapping_status": "matched",
            "reason": "Cited in footnote 2",
        },
    )
    assert r_ovr_law.status_code == 200, r_ovr_law.text
    law_rec = r_ovr_law.json()["override_record"]
    assert law_rec["previous_status"] == "uncited_reference"
    assert law_rec["new_status"] == "matched"

    rep_law = isolated_env.client.get(
        f"/api/essays/{e_legal.id}/report?format=json", headers=headers_t
    ).json()
    assert rep_law["cis"]["score"] >= 85.0
    rep_law_v1 = next(v for v in rep_law["verdicts"] if v["citation_id"] == f"v{v_law_1.id}")
    assert rep_law_v1["override_record"]["previous_status"] == "uncited_reference"
    assert rep_law_v1["override_record"]["new_status"] == "matched"

    # AuditLog recorded the mapping_status change
    isolated_env.session.expire_all()
    law_audits = (
        isolated_env.session.query(AuditLog)
        .filter(AuditLog.verdict_id == v_law_1.id)
        .all()
    )
    assert len(law_audits) == 1
    assert "uncited_reference" in (law_audits[0].note or "")
    assert "matched" in (law_audits[0].note or "")

    # Also verify recalculate_essay_cis URL validity & multi-edge citation_link_json consistency
    e_url = EssayRecord(
        filename="URL_Validity_Check.pdf",
        num_pages=3,
        user_id=student.id,
        class_id=cls.id,
        job_status="completed",
    )
    isolated_env.session.add(e_url)
    isolated_env.session.flush()
    isolated_env.session.add(
        CitationRecord(
            essay_id=e_url.id,
            raw_text="[1, 99]",
            citation_type="numeric",
            mapping_status="matched",
            citation_link_json=json.dumps(
                [
                    {"occurrence_id": "occ-1", "reference_id": "ref-0001", "status": "matched"},
                    {"occurrence_id": "occ-1", "reference_id": None, "status": "missing_reference"},
                ]
            ),
        )
    )
    isolated_env.session.add(
        VerdictRecord(
            essay_id=e_url.id,
            citation_raw="[1] Valid Paper (2023). https://fake-domain.example.invalid/paper",
            label="metadata_error",
            confidence=0.7,
            mapping_status="matched",
            triggered_rules=json.dumps(["R-FAKE-URL"]),
            features=json.dumps({"url_status": "fake_domain"}),
        )
    )
    isolated_env.session.commit()
    recalc_url = Repository(isolated_env.session).recalculate_essay_cis(e_url.id)
    assert recalc_url is not None
    # R-FAKE-URL + fake_domain -> identifier_validity == 0.0, and [1, 99] missing_reference penalized
    assert recalc_url["components"]["identifier_validity"] == 0.0
    assert recalc_url["components"]["in_text_bib_consistency"] < 1.0


# ---------------------------------------------------------------------------
# 6. Classroom CRUD, Class ZIP Export, CSV BOM/formula guard, DOCX ctrl chars, Admin export
# ---------------------------------------------------------------------------


def test_classroom_crud_zip_export_csv_formula_bom_docx_ctrl_chars_and_admin_report(
    isolated_env,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """End-to-end verification of:
    - Per-teacher duplicate class names (two teachers can both create 'Graduation Thesis')
    - Dashboard pending_reviews alignment with class pending-reviews queue ('unresolved' included)
    - PATCH /api/teacher/classes/{id}, DELETE /api/teacher/classes/{id} (freeing quota), DELETE .../leave
    - GET /api/teacher/classes/{id}/export.zip (UTF-8-BOM gradebook_summary.csv + verdicts_detail.csv w/ cis_score + JSON)
    - Leading-whitespace/pipe/newline CSV formula neutralization + UTF-8 BOM on report CSV
    - docx_exporter stripping XML-illegal ASCII control chars (\\x0c, \\x00, \\x0b)
    - GET /api/export/report using SQL GROUP BY aggregation + including 'teachers' count
    """
    admin, headers_admin = _make_auth_user(
        isolated_env.session, username="sys_admin", role="admin"
    )
    del admin
    t1, headers_t1 = _make_auth_user(
        isolated_env.session, username="lecturer_one", role="teacher", plan_tier="pro"
    )
    _, headers_t2 = _make_auth_user(
        isolated_env.session, username="lecturer_two", role="teacher", plan_tier="pro"
    )
    stu, _ = _make_auth_user(
        isolated_env.session,
        username="grad_student",
        role="user",
        plan_tier="pro",
        full_name="  =CMD|' /C calc'!A0 Nguyễn Sinh Viên",
    )

    # 1. Two different teachers can create a class with the exact same name 'Graduation Thesis'
    c1_resp = isolated_env.client.post(
        "/api/teacher/classes",
        headers=headers_t1,
        json={"name": "Graduation Thesis", "description": "Semester 1"},
    )
    assert c1_resp.status_code == 201, c1_resp.text
    c1_id = c1_resp.json()["id"]

    # Same teacher creating 'Graduation Thesis' again -> 400
    dup_resp = isolated_env.client.post(
        "/api/teacher/classes",
        headers=headers_t1,
        json={"name": "Graduation Thesis"},
    )
    assert dup_resp.status_code == 400

    # Different teacher creating 'Graduation Thesis' -> 201!
    c2_resp = isolated_env.client.post(
        "/api/teacher/classes",
        headers=headers_t2,
        json={"name": "Graduation Thesis", "description": "Teacher 2 Cohort"},
    )
    assert c2_resp.status_code == 201, c2_resp.text

    # 2. PATCH /api/teacher/classes/{id} rename, blank 400, non-owner 403
    assert (
        isolated_env.client.patch(
            f"/api/teacher/classes/{c1_id}",
            headers=headers_t2,
            json={"name": "Hijack"},
        ).status_code
        == 403
    )
    assert (
        isolated_env.client.patch(
            f"/api/teacher/classes/{c1_id}",
            headers=headers_t1,
            json={"name": "   "},
        ).status_code
        == 400
    )
    patch_ok = isolated_env.client.patch(
        f"/api/teacher/classes/{c1_id}",
        headers=headers_t1,
        json={"name": "Graduation Thesis 2026", "description": "Updated syllabus"},
    )
    assert patch_ok.status_code == 200, patch_ok.text
    assert patch_ok.json()["name"] == "Graduation Thesis 2026"
    assert patch_ok.json()["description"] == "Updated syllabus"

    # 3. Pro teacher max_classes=3 -> create 2 more classes, hit 402 on 4th, DELETE one -> frees slot!
    c_extra_1 = isolated_env.client.post(
        "/api/teacher/classes", headers=headers_t1, json={"name": "Extra 1"}
    )
    c_extra_2 = isolated_env.client.post(
        "/api/teacher/classes", headers=headers_t1, json={"name": "Extra 2"}
    )
    assert c_extra_1.status_code == 201 and c_extra_2.status_code == 201
    assert (
        isolated_env.client.post(
            "/api/teacher/classes", headers=headers_t1, json={"name": "Fourth Blocked"}
        ).status_code
        == 402
    )

    extra_id = c_extra_2.json()["id"]
    del_cls = isolated_env.client.delete(
        f"/api/teacher/classes/{extra_id}", headers=headers_t1
    )
    assert del_cls.status_code == 200, del_cls.text
    assert del_cls.json() == {"status": "deleted", "id": extra_id}

    freed_create = isolated_env.client.post(
        "/api/teacher/classes", headers=headers_t1, json={"name": "Replacement Class"}
    )
    assert freed_create.status_code == 201, freed_create.text

    # 4. Enroll student in c1_id, add essay with unresolved verdict + leading-space/pipe formulas
    isolated_env.session.add(ClassMembership(class_id=c1_id, student_id=stu.id))
    essay = EssayRecord(
        filename="  =HYPERLINK(\"http://evil\")_Khóa_Luận.pdf",
        num_pages=12,
        user_id=stu.id,
        class_id=c1_id,
        cis_json=json.dumps({"score": 87.5}),
        job_status="completed",
    )
    isolated_env.session.add(essay)
    isolated_env.session.flush()
    isolated_env.session.add(
        VerdictRecord(
            essay_id=essay.id,
            citation_raw=" \t+SUM(1,2) Nguyễn Văn A (2024).",
            label="unresolved",
            confidence=0.55,
            reasoning="|calc.exe",
            triggered_rules="[]",
            mismatched_fields="[]",
            mapping_status="matched",
        )
    )
    isolated_env.session.commit()
    del t1

    # Dashboard pending_reviews MUST match class pending-reviews queue (1 'unresolved' item)
    dash = isolated_env.client.get("/api/teacher/dashboard", headers=headers_t1).json()
    queue = isolated_env.client.get(
        f"/api/teacher/classes/{c1_id}/pending-reviews", headers=headers_t1
    ).json()
    assert dash["pending_reviews"] == len(queue) == 1

    # 5. Essay report CSV has UTF-8 BOM \ufeff and neutralizes leading-whitespace & pipe formulas
    rep_csv = isolated_env.client.get(
        f"/api/essays/{essay.id}/report?format=csv", headers=headers_t1
    )
    assert rep_csv.status_code == 200
    assert rep_csv.content.startswith(b"\xef\xbb\xbf")
    rep_rows = list(csv.reader(io.StringIO(rep_csv.content.decode("utf-8-sig"))))
    assert rep_rows[1][0].startswith("' \t+SUM(1,2)")
    assert rep_rows[1][5].startswith("'|calc.exe")

    # 6. Class ZIP export: UTF-8-BOM gradebook_summary.csv + verdicts_detail.csv (w/ cis_score) + JSON
    zip_resp = isolated_env.client.get(
        f"/api/teacher/classes/{c1_id}/export.zip", headers=headers_t1
    )
    assert zip_resp.status_code == 200, zip_resp.text
    assert zip_resp.headers["content-type"].startswith("application/zip")
    assert (
        f'filename="class_{c1_id}_export.zip"'
        in zip_resp.headers.get("content-disposition", "")
    )

    with zipfile.ZipFile(io.BytesIO(zip_resp.content), "r") as zf:
        names = set(zf.namelist())
        assert "gradebook_summary.csv" in names
        assert "verdicts_detail.csv" in names
        assert f"essays/{essay.id}_summary.json" in names

        gb_bytes = zf.read("gradebook_summary.csv")
        vd_bytes = zf.read("verdicts_detail.csv")
        assert gb_bytes.startswith(b"\xef\xbb\xbf")
        assert vd_bytes.startswith(b"\xef\xbb\xbf")

        gb_rows = list(csv.reader(io.StringIO(gb_bytes.decode("utf-8-sig"))))
        gb_hdr = gb_rows[0]
        gb_data = dict(zip(gb_hdr, gb_rows[1], strict=False))
        # Leading-space formula in student full_name MUST be neutralized
        assert any(cell.startswith("'  =CMD") for cell in gb_rows[1])
        assert float(gb_data["avg_cis_score"]) == pytest.approx(87.5)

        vd_rows = list(csv.reader(io.StringIO(vd_bytes.decode("utf-8-sig"))))
        vd_hdr = vd_rows[0]
        assert "cis_score" in vd_hdr
        vd_data = dict(zip(vd_hdr, vd_rows[1], strict=False))
        assert float(vd_data["cis_score"]) == pytest.approx(87.5)
        assert vd_data["filename"].startswith("'  =HYPERLINK")

        summary_json = json.loads(zf.read(f"essays/{essay.id}_summary.json").decode("utf-8"))
        assert summary_json["essay_id"] == essay.id
        assert summary_json["cis_score"] == pytest.approx(87.5)

    # 7. docx_exporter strips XML-illegal ASCII control chars (\x0c, \x00, \x0b, \x1f) without crashing
    ctrl_verdicts = [
        {
            "citation_raw": "Nguyễn\x0c Văn\x00 B (2023).\x0b Giáo trình AI\x1f.",
            "citation_type": "reference_list",
            "label": "suspected_hallucination",
            "confidence": 0.91,
            "reasoning": "Page break\x0c and vertical tab\x0b in extracted PDF text.",
            "triggered_rules": ["R-NO-SCHOLARLY-RECORD"],
            "mismatched_fields": ["title\x0c"],
            "matched_sources": [],
            "features": {"best_evidence_sentence": "Evidence\x0c sentence."},
        }
    ]
    report_docx = export_report_to_docx(
        filename="ctrl\x0c_file.pdf",
        cis_score=50.0,
        num_citations=1,
        num_verified=0,
        num_metadata_error=0,
        num_suspected=1,
        num_unresolved=0,
        num_resource=0,
        verdicts=ctrl_verdicts,
    )
    healed_docx = export_auto_healed_docx(
        essay_filename="ctrl\x0c_file.docx",
        verdicts=ctrl_verdicts,
        style="apa",
    )
    assert WordDocument(io.BytesIO(report_docx)).paragraphs
    assert WordDocument(io.BytesIO(healed_docx)).paragraphs

    # 8. Admin /api/export/report includes 'teachers' count and uses SQL GROUP BY aggregation
    export_src = inspect.getsource(export_route.get_system_report)
    assert "group_by" in export_src
    assert "VerdictRecord).all()" not in export_src

    exp_resp = isolated_env.client.get("/api/export/report", headers=headers_admin)
    assert exp_resp.status_code == 200, exp_resp.text
    exp_json = exp_resp.json()
    assert exp_json["users"]["teachers"] == 2
    assert exp_json["users"]["admins"] == 1
    assert exp_json["users"]["users"] == 1
    assert exp_json["users"]["total"] == 4
    assert exp_json["verdicts"]["by_label"]["unresolved"] == 1
