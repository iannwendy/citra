"""Unit tests for Task 3 (B2): Schema Migration 0010, Startup Orphan Job Recovery & Atomic Quota Refund."""

from __future__ import annotations

import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from io import BytesIO
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import fitz
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import Session, sessionmaker

from integrity_checker.api.routes import essays as essays_route
from integrity_checker.api.routes.essays import (
    _claim_monthly_upload_slot_and_create_essay,
    _run_pipeline_task,
)
from integrity_checker.db.migrations import (
    LATEST_SCHEMA_VERSION,
    downgrade_migrations,
    get_migration_status,
    run_migrations,
    verify_migrations,
)
from integrity_checker.db.models import Base, EssayRecord, User
from integrity_checker.models.citation import Citation, CitationStyle, CitationType
from integrity_checker.models.validation import CitationVerdict, ValidationLabel


def _make_valid_pdf_bytes() -> bytes:
    doc = fitz.open()
    try:
        page = doc.new_page()
        page.insert_text((72, 72), "Sample academic manuscript with citation (Vaswani et al., 2017).")
        return doc.tobytes()
    finally:
        doc.close()


def _make_stub_report() -> SimpleNamespace:
    cit = Citation(
        raw_text="Vaswani, A. et al. (2017). Attention Is All You Need. NeurIPS.",
        citation_type=CitationType.REFERENCE_LIST,
        style=CitationStyle.APA,
        authors=["Vaswani, A."],
        year="2017",
        title="Attention Is All You Need",
        venue="NeurIPS",
        page_num=1,
    )
    verdict = CitationVerdict(
        citation=cit,
        label=ValidationLabel.VERIFIED,
        confidence=0.96,
        reasoning="Verified via Crossref.",
    )
    return SimpleNamespace(
        num_pages=1,
        extracted_citations=[cit],
        verdicts=[verdict],
        style_profile={"style": "APA", "confidence": 0.95},
        cis={
            "score": 95.0,
            "components": {
                "verified_ratio": 1.0,
                "metadata_accuracy": 1.0,
                "in_text_bib_consistency": 1.0,
                "format_consistency": 1.0,
                "identifier_validity": 1.0,
            },
            "weights_used": {},
            "num_citations": 1,
            "num_unresolved": 0,
            "disclaimer": "Decision support only.",
        },
    )


def _seed_student(session: Session, *, username: str = "student_b2", used: int = 0) -> User:
    user = User(
        username=username,
        password_hash="hashed_pw",
        role="user",
        email=f"{username}@example.com",
        is_active=1,
        email_verified=1,
        plan_tier="basic",
        monthly_uploads_used=used,
        quota_reset_at=datetime.now(UTC) + timedelta(days=30),
    )
    session.add(user)
    session.commit()
    session.refresh(user)
    return user


def test_migration_0010_upgrades_from_0009_backfills_job_status_and_downgrades_with_checksum(
    tmp_path: Path,
) -> None:
    """Invariant 1: Migration 0010 upgrades cleanly from 0009 (backfilling completed vs failed)
    and downgrades back to 0009 with verified SHA-256 checksum."""
    engine = create_engine(f"sqlite:///{tmp_path / 'mig_0010.db'}")
    try:
        with engine.begin() as conn:
            conn.exec_driver_sql(
                "CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username VARCHAR(50) NOT NULL, "
                "password_hash VARCHAR(255) NOT NULL, role VARCHAR(20) DEFAULT 'user', created_at DATETIME, updated_at DATETIME)"
            )
            conn.exec_driver_sql(
                "CREATE TABLE classes (id INTEGER PRIMARY KEY AUTOINCREMENT, name VARCHAR(120) NOT NULL, "
                "description TEXT, teacher_id INTEGER NOT NULL, created_at DATETIME, updated_at DATETIME)"
            )
            conn.exec_driver_sql(
                "CREATE TABLE essays (id INTEGER PRIMARY KEY AUTOINCREMENT, filename VARCHAR NOT NULL, "
                "num_pages INTEGER DEFAULT 0, uploaded_at DATETIME, user_id INTEGER, style_profile_json TEXT, cis_json TEXT)"
            )
            conn.exec_driver_sql(
                "CREATE TABLE citations (id INTEGER PRIMARY KEY AUTOINCREMENT, essay_id INTEGER NOT NULL, "
                "raw_text TEXT NOT NULL, citation_type VARCHAR, style VARCHAR, authors TEXT, year VARCHAR, "
                "title TEXT, venue VARCHAR, doi VARCHAR, url TEXT, page_num INTEGER, confidence FLOAT)"
            )
            conn.exec_driver_sql(
                "CREATE TABLE verdicts (id INTEGER PRIMARY KEY AUTOINCREMENT, essay_id INTEGER NOT NULL, "
                "citation_raw TEXT NOT NULL, label VARCHAR NOT NULL, confidence FLOAT, reasoning TEXT, "
                "triggered_rules TEXT, mismatched_fields TEXT, features TEXT, validated_at DATETIME, "
                "mapping_status VARCHAR, mapping_confidence FLOAT, style_penalty FLOAT, "
                "domain_exception INTEGER, is_overridden INTEGER, override_note TEXT, overridden_by VARCHAR)"
            )
            conn.exec_driver_sql(
                "CREATE TABLE audit_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, verdict_id INTEGER NOT NULL, "
                "original_label VARCHAR NOT NULL, new_label VARCHAR NOT NULL, user VARCHAR NOT NULL, note TEXT, logged_at DATETIME)"
            )
            conn.exec_driver_sql(
                "CREATE TABLE promo_redemptions (id INTEGER PRIMARY KEY AUTOINCREMENT, promo_code_id INTEGER NOT NULL, "
                "user_id INTEGER NOT NULL, transaction_id INTEGER NOT NULL, code VARCHAR(6) NOT NULL, "
                "discount_usd FLOAT NOT NULL, redeemed_at DATETIME)"
            )

        applied_to_0009 = run_migrations(engine, target_version="0009")
        assert applied_to_0009[-1] == "0009"

        # Seed one completed essay (cis_json IS NOT NULL) and one historical orphaned essay (cis_json IS NULL)
        with engine.begin() as conn:
            conn.exec_driver_sql(
                "INSERT INTO essays (id, filename, num_pages, cis_json) VALUES "
                "(1, 'completed_thesis.pdf', 12, '{\"score\": 91.5}'), "
                "(2, 'orphaned_crash.pdf', 8, NULL)"
            )

        assert LATEST_SCHEMA_VERSION >= "0010"
        applied_0010 = run_migrations(engine, target_version="0010")
        assert applied_0010 == ["0010"]
        assert verify_migrations(engine) is True

        status_up = get_migration_status(engine)
        assert status_up.current_version == "0010"
        assert status_up.checksum_verified is True

        inspector = inspect(engine)
        essay_cols = {c["name"] for c in inspector.get_columns("essays")}
        assert {
            "job_status",
            "job_attempt_count",
            "job_heartbeat_at",
            "job_error",
            "quota_charged",
        }.issubset(essay_cols)
        idx_names = {idx["name"] for idx in inspector.get_indexes("essays")}
        assert "ix_essays_job_status" in idx_names

        with engine.connect() as conn:
            rows = conn.execute(
                text(
                    "SELECT id, job_status, job_attempt_count, quota_charged "
                    "FROM essays ORDER BY id ASC"
                )
            ).fetchall()
        assert rows == [
            (1, "completed", 0, 0),
            (2, "failed", 0, 0),
        ]

        # Downgrade 0010 -> 0009 and verify schema + checksum ledger
        reverted = downgrade_migrations(engine, "0009", create_backup=False)
        assert reverted == ["0010"]
        assert verify_migrations(engine) is True

        status_down = get_migration_status(engine)
        assert status_down.current_version == "0009"
        assert "0010" in status_down.pending_versions
        assert status_down.checksum_verified is True

        inspector_after = inspect(engine)
        cols_after = {c["name"] for c in inspector_after.get_columns("essays")}
        for dropped_col in (
            "job_status",
            "job_attempt_count",
            "job_heartbeat_at",
            "job_error",
            "quota_charged",
        ):
            assert dropped_col not in cols_after
        idx_after = {idx["name"] for idx in inspector_after.get_indexes("essays")}
        assert "ix_essays_job_status" not in idx_after
    finally:
        engine.dispose()


def test_claim_monthly_upload_slot_sets_job_status_queued_and_quota_charged_one(
    tmp_path: Path,
) -> None:
    """Invariant 2: _claim_monthly_upload_slot_and_create_essay sets job_status='queued' and quota_charged=1."""
    engine = create_engine(f"sqlite:///{tmp_path / 'claim.db'}")
    Base.metadata.create_all(bind=engine)
    run_migrations(engine)
    SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    session = SessionLocal()
    try:
        user = _seed_student(session, used=0)
        essay = _claim_monthly_upload_slot_and_create_essay(
            session,
            user,
            filename="student_draft.pdf",
            num_pages=5,
        )
        assert essay.job_status == "queued"
        assert essay.quota_charged == 1
        assert essay.job_attempt_count == 0
        assert user.monthly_uploads_used == 1
    finally:
        session.close()
        engine.dispose()


def test_refund_upload_quota_once_sequential_idempotency_and_zero_floor(
    tmp_path: Path,
) -> None:
    """Invariant 3a: Calling refund_upload_quota_once twice in a row decrements monthly_uploads_used
    strictly once (never 2 -> 0 on a single essay refund, and never negative)."""
    from integrity_checker.api.job_recovery import refund_upload_quota_once

    engine = create_engine(f"sqlite:///{tmp_path / 'refund_seq.db'}")
    Base.metadata.create_all(bind=engine)
    run_migrations(engine)
    SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    session = SessionLocal()
    try:
        user = _seed_student(session, used=0)
        essay_1 = _claim_monthly_upload_slot_and_create_essay(
            session, user, filename="one.pdf", num_pages=2
        )
        essay_2 = _claim_monthly_upload_slot_and_create_essay(
            session, user, filename="two.pdf", num_pages=2
        )
        assert user.monthly_uploads_used == 2

        # Refund essay_1 twice in a row: must go 2 -> 1 on first call, stay 1 on second call!
        first_refund = refund_upload_quota_once(session, essay_1.id, "Internal IO error")
        second_refund = refund_upload_quota_once(session, essay_1.id, "Internal IO error")

        assert first_refund is True
        assert second_refund is False

        session.refresh(user)
        session.refresh(essay_1)
        assert user.monthly_uploads_used == 1
        assert essay_1.quota_charged == 0
        assert essay_1.job_status == "failed"
        assert essay_1.job_error == "Internal IO error"

        # Simulate monthly quota reset setting monthly_uploads_used=0 before essay_2 fails: must clamp at 0
        user.monthly_uploads_used = 0
        session.commit()

        clamped_refund = refund_upload_quota_once(session, essay_2.id, "Corrupt upload")
        assert clamped_refund is True
        session.refresh(user)
        session.refresh(essay_2)
        assert user.monthly_uploads_used == 0
        assert essay_2.quota_charged == 0
        assert essay_2.job_status == "failed"
    finally:
        session.close()
        engine.dispose()


def test_refund_upload_quota_once_concurrent_sessions_decrements_strictly_once(
    tmp_path: Path,
) -> None:
    """Invariant 3b: Concurrent refund_upload_quota_once calls across multiple sessions refund strictly once."""
    from integrity_checker.api.job_recovery import refund_upload_quota_once

    engine = create_engine(
        f"sqlite:///{tmp_path / 'refund_concurrent.db'}",
        connect_args={"check_same_thread": False, "timeout": 30},
    )
    Base.metadata.create_all(bind=engine)
    run_migrations(engine)
    SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    setup_session = SessionLocal()
    try:
        user = _seed_student(setup_session, used=0)
        essay = _claim_monthly_upload_slot_and_create_essay(
            setup_session, user, filename="race.pdf", num_pages=3
        )
        # Charge a second upload so monthly_uploads_used == 2; concurrent refund of `essay` MUST leave 1!
        _claim_monthly_upload_slot_and_create_essay(
            setup_session, user, filename="keep_charged.pdf", num_pages=3
        )
        assert user.monthly_uploads_used == 2
        essay_id = essay.id
        user_id = user.id
    finally:
        setup_session.close()

    workers = 6
    barrier = threading.Barrier(workers)

    def _worker_refund() -> bool:
        sess = SessionLocal()
        try:
            # Pre-open a read snapshot on each session to verify stale-snapshot safety too
            _ = sess.get(User, user_id)
            barrier.wait(timeout=5.0)
            return refund_upload_quota_once(sess, essay_id, "Concurrent worker failure")
        finally:
            sess.close()

    try:
        with ThreadPoolExecutor(max_workers=workers) as pool:
            futures = [pool.submit(_worker_refund) for _ in range(workers)]
            outcomes = [f.result(timeout=10.0) for f in futures]

        assert outcomes.count(True) == 1
        assert outcomes.count(False) == workers - 1

        verify_sess = SessionLocal()
        try:
            fresh_user = verify_sess.get(User, user_id)
            fresh_essay = verify_sess.get(EssayRecord, essay_id)
            assert fresh_user is not None
            assert fresh_essay is not None
            assert fresh_user.monthly_uploads_used == 1
            assert fresh_essay.quota_charged == 0
            assert fresh_essay.job_status == "failed"
            assert fresh_essay.job_error == "Concurrent worker failure"
        finally:
            verify_sess.close()
    finally:
        engine.dispose()


def test_recover_orphaned_essay_jobs_reschedules_interrupted_job_without_extra_quota_charge(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Invariant 4a: recover_orphaned_essay_jobs re-schedules an interrupted EssayRecord
    (job_status='processing', cis_json=None, job_attempt_count=0, PDF present on disk)
    without incrementing monthly_uploads_used."""
    from integrity_checker.api.job_recovery import recover_orphaned_essay_jobs

    engine = create_engine(
        f"sqlite:///{tmp_path / 'orphan_resume.db'}",
        connect_args={"check_same_thread": False, "timeout": 30},
    )
    Base.metadata.create_all(bind=engine)
    run_migrations(engine)
    SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    uploads_dir = tmp_path / "uploads"
    uploads_dir.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(essays_route, "UPLOADS_DIR", uploads_dir)
    monkeypatch.setattr("integrity_checker.db.session.get_session", SessionLocal)

    setup = SessionLocal()
    try:
        user = _seed_student(setup, used=0)
        essay = _claim_monthly_upload_slot_and_create_essay(
            setup, user, filename="interrupted.pdf", num_pages=1
        )
        essay.job_status = "processing"
        essay.cis_json = None
        essay.job_attempt_count = 0
        setup.commit()
        essay_id = essay.id
        user_id = user.id
    finally:
        setup.close()

    pdf_path = uploads_dir / f"{essay_id}.pdf"
    pdf_path.write_bytes(_make_valid_pdf_bytes())

    stub_pipeline = MagicMock()
    stub_pipeline.run_async = AsyncMock(return_value=_make_stub_report())

    try:
        summary = recover_orphaned_essay_jobs(lambda: stub_pipeline)
        assert summary["rescheduled"] == 1
        assert summary["failed"] == 0
        assert summary["refunded"] == 0
        stub_pipeline.run_async.assert_awaited_once()

        check = SessionLocal()
        try:
            recovered_essay = check.get(EssayRecord, essay_id)
            recovered_user = check.get(User, user_id)
            assert recovered_essay is not None
            assert recovered_user is not None
            assert recovered_essay.job_attempt_count == 1
            assert recovered_essay.job_status == "completed"
            assert recovered_essay.cis_json is not None
            assert recovered_essay.quota_charged == 1
            # Strictly NO extra quota charge during orphan recovery!
            assert recovered_user.monthly_uploads_used == 1
            # Persisted upload file must NOT be deleted by recovery
            assert pdf_path.is_file()
        finally:
            check.close()
    finally:
        engine.dispose()


def test_recover_orphaned_essay_jobs_refunds_when_max_attempts_reached_or_file_missing(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Invariant 4b: When job_attempt_count >= 2 or the upload file is missing on disk,
    recover_orphaned_essay_jobs marks job_status='failed' and refunds quota strictly once."""
    from integrity_checker.api.job_recovery import (
        MAX_ORPHAN_RECOVERY_ATTEMPTS,
        recover_orphaned_essay_jobs,
    )

    assert MAX_ORPHAN_RECOVERY_ATTEMPTS == 2

    engine = create_engine(
        f"sqlite:///{tmp_path / 'orphan_fail.db'}",
        connect_args={"check_same_thread": False, "timeout": 30},
    )
    Base.metadata.create_all(bind=engine)
    run_migrations(engine)
    SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    uploads_dir = tmp_path / "uploads"
    uploads_dir.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(essays_route, "UPLOADS_DIR", uploads_dir)
    monkeypatch.setattr("integrity_checker.db.session.get_session", SessionLocal)

    setup = SessionLocal()
    try:
        user = _seed_student(setup, used=0)
        essay_maxed = _claim_monthly_upload_slot_and_create_essay(
            setup, user, filename="crashed_twice.pdf", num_pages=2
        )
        essay_maxed.job_status = "processing"
        essay_maxed.job_attempt_count = 2
        essay_maxed.cis_json = None

        essay_missing = _claim_monthly_upload_slot_and_create_essay(
            setup, user, filename="lost_file.pdf", num_pages=2
        )
        essay_missing.job_status = "queued"
        essay_missing.job_attempt_count = 0
        essay_missing.cis_json = None
        setup.commit()

        assert user.monthly_uploads_used == 2
        maxed_id = essay_maxed.id
        missing_id = essay_missing.id
        user_id = user.id
    finally:
        setup.close()

    # Only essay_maxed has its file on disk; essay_missing has no file
    (uploads_dir / f"{maxed_id}.pdf").write_bytes(_make_valid_pdf_bytes())

    factory_called = False

    def _unexpected_factory():
        nonlocal factory_called
        factory_called = True
        return MagicMock()

    try:
        first_summary = recover_orphaned_essay_jobs(_unexpected_factory)
        assert first_summary == {"rescheduled": 0, "failed": 2, "refunded": 2}
        assert factory_called is False

        # Running recovery a second time is completely idempotent (0 refunds, 0 failures)
        second_summary = recover_orphaned_essay_jobs(_unexpected_factory)
        assert second_summary == {"rescheduled": 0, "failed": 0, "refunded": 0}

        check = SessionLocal()
        try:
            fresh_user = check.get(User, user_id)
            e_max = check.get(EssayRecord, maxed_id)
            e_miss = check.get(EssayRecord, missing_id)
            assert fresh_user is not None and e_max is not None and e_miss is not None
            assert fresh_user.monthly_uploads_used == 0
            assert e_max.job_status == "failed"
            assert e_max.quota_charged == 0
            assert e_max.job_error
            assert e_miss.job_status == "failed"
            assert e_miss.quota_charged == 0
            assert e_miss.job_error
        finally:
            check.close()
    finally:
        engine.dispose()


@pytest.mark.asyncio
async def test_run_pipeline_task_unrecoverable_error_marks_failed_and_refunds_quota(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """When _run_pipeline_task hits an unrecoverable system/corrupt error, quota is refunded once."""
    engine = create_engine(
        f"sqlite:///{tmp_path / 'task_fail.db'}",
        connect_args={"check_same_thread": False, "timeout": 30},
    )
    Base.metadata.create_all(bind=engine)
    run_migrations(engine)
    SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    monkeypatch.setattr("integrity_checker.db.session.get_session", SessionLocal)

    setup = SessionLocal()
    try:
        user = _seed_student(setup, used=0)
        essay = _claim_monthly_upload_slot_and_create_essay(
            setup, user, filename="broken.pdf", num_pages=1
        )
        essay_id = essay.id
        user_id = user.id
        assert user.monthly_uploads_used == 1
    finally:
        setup.close()

    pdf_file = tmp_path / "broken.pdf"
    pdf_file.write_bytes(_make_valid_pdf_bytes())

    crashing_pipeline = MagicMock()
    crashing_pipeline.run_async = AsyncMock(side_effect=OSError("disk I/O error while reading PDF"))

    try:
        await _run_pipeline_task(
            essay_id=essay_id,
            tmp_path=str(pdf_file),
            user_id=user_id,
            pipeline=crashing_pipeline,
            cleanup_file=True,
        )

        check = SessionLocal()
        try:
            fresh_user = check.get(User, user_id)
            fresh_essay = check.get(EssayRecord, essay_id)
            assert fresh_user is not None and fresh_essay is not None
            assert fresh_user.monthly_uploads_used == 0
            assert fresh_essay.quota_charged == 0
            assert fresh_essay.job_status == "failed"
            assert fresh_essay.job_error is not None
        finally:
            check.close()
    finally:
        engine.dispose()


@pytest.mark.asyncio
async def test_web_only_mode_and_standalone_worker_atomic_cas_claim(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """CITRA_WORKER_MODE='web_only' leaves uploaded essays queued without in-process execution,
    and worker.claim_next_queued_essay atomically claims each queued job once in FIFO order."""
    from integrity_checker.api.deps import get_db
    from integrity_checker.api.main import create_app
    from integrity_checker.worker import claim_next_queued_essay, run_worker_loop

    engine = create_engine(
        f"sqlite:///{tmp_path / 'worker_mode.db'}",
        connect_args={"check_same_thread": False, "timeout": 30},
    )
    Base.metadata.create_all(bind=engine)
    run_migrations(engine)
    SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    uploads_dir = tmp_path / "uploads"
    uploads_dir.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(essays_route, "UPLOADS_DIR", uploads_dir)
    monkeypatch.setattr("integrity_checker.db.session.get_session", SessionLocal)
    monkeypatch.setenv("CITRA_WORKER_MODE", "web_only")

    def _override_db():
        db = SessionLocal()
        try:
            yield db
        finally:
            db.close()

    setup = SessionLocal()
    try:
        import bcrypt

        pw_hash = bcrypt.hashpw(b"Secret123!", bcrypt.gensalt()).decode()
        student = User(
            username="web_student",
            password_hash=pw_hash,
            role="user",
            email="web_student@example.com",
            is_active=1,
            email_verified=1,
            plan_tier="pro",
            monthly_uploads_used=0,
            quota_reset_at=datetime.now(UTC) + timedelta(days=30),
        )
        setup.add(student)
        setup.commit()
    finally:
        setup.close()

    web_app = create_app()
    web_app.dependency_overrides[get_db] = _override_db
    pdf_bytes = _make_valid_pdf_bytes()

    try:
        with patch("integrity_checker.api.routes.essays._run_pipeline_task") as spy_inline_task:
            client = TestClient(web_app)
            login_resp = client.post(
                "/api/auth/login",
                json={"username": "web_student", "password": "Secret123!"},
            )
            assert login_resp.status_code == 200
            token = login_resp.json()["token"]
            headers = {"Authorization": f"Bearer {token}"}

            r1 = client.post(
                "/api/essays",
                files={"file": ("first.pdf", BytesIO(pdf_bytes), "application/pdf")},
                headers=headers,
            )
            r2 = client.post(
                "/api/essays",
                files={"file": ("second.pdf", BytesIO(pdf_bytes), "application/pdf")},
                headers=headers,
            )
            assert r1.status_code == 200 and r2.status_code == 200
            eid_1 = r1.json()["essay_id"]
            eid_2 = r2.json()["essay_id"]
            # In web_only mode, _run_pipeline_task is NOT scheduled in the web process!
            spy_inline_task.assert_not_called()

            st_resp = client.get(f"/api/essays/{eid_1}/status", headers=headers)
            assert st_resp.status_code == 200
            assert st_resp.json()["status"] == "queued"

        # 4 concurrent workers race to claim 1 queued essay; only 2 exist so exactly 2 succeed in FIFO order!
        barrier = threading.Barrier(4)

        def _claim_one() -> int | None:
            sess = SessionLocal()
            try:
                barrier.wait(timeout=5.0)
                claimed = claim_next_queued_essay(sess)
                return claimed.id if claimed is not None else None
            finally:
                sess.close()

        with ThreadPoolExecutor(max_workers=4) as pool:
            claim_futures = [pool.submit(_claim_one) for _ in range(4)]
            claimed_ids = [f.result(timeout=10.0) for f in claim_futures]

        non_none_ids = [cid for cid in claimed_ids if cid is not None]
        assert sorted(non_none_ids) == [eid_1, eid_2]
        assert claimed_ids.count(None) == 2

        # Reset eid_1 back to queued and verify run_worker_loop processes it end-to-end
        reset_sess = SessionLocal()
        try:
            e1 = reset_sess.get(EssayRecord, eid_1)
            e2 = reset_sess.get(EssayRecord, eid_2)
            assert e1 is not None and e2 is not None
            assert e1.job_status == "processing"
            assert e2.job_status == "processing"
            e1.job_status = "queued"
            e2.job_status = "completed"
            e2.cis_json = '{"score": 100.0}'
            reset_sess.commit()
        finally:
            reset_sess.close()

        stub_pipeline = MagicMock()
        stub_pipeline.run_async = AsyncMock(return_value=_make_stub_report())

        worker_stats = await run_worker_loop(
            pipeline_factory=lambda: stub_pipeline,
            session_factory=SessionLocal,
            uploads_dir=uploads_dir,
            poll_interval=0.01,
            max_iterations=2,
            recover_on_startup=False,
        )
        assert worker_stats["processed"] == 1

        verify_sess = SessionLocal()
        try:
            done_e1 = verify_sess.get(EssayRecord, eid_1)
            assert done_e1 is not None
            assert done_e1.job_status == "completed"
            assert done_e1.cis_json is not None
        finally:
            verify_sess.close()
    finally:
        web_app.dependency_overrides.clear()
        engine.dispose()


def test_app_startup_orphan_recovery_gating_and_worker_cli_entrypoint(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """create_app() runs startup orphan recovery only when not test runtime and not web_only,
    and worker.main() executes cleanly with --max-iterations."""
    from integrity_checker.api.main import create_app
    from integrity_checker.database import LocalDatabase
    from integrity_checker.matching.semantic import SemanticMatcher
    from integrity_checker.worker import main as worker_main

    recovery_event = threading.Event()
    recovery_calls: list[object] = []

    def _fake_recover(factory, **_kwargs):
        recovery_calls.append(factory)
        recovery_event.set()
        return {"rescheduled": 0, "failed": 0, "refunded": 0}

    monkeypatch.setattr("integrity_checker.api.main.init_db", lambda: None)
    monkeypatch.setattr("integrity_checker.api.main.is_test_runtime", lambda: False)
    monkeypatch.setattr(LocalDatabase, "get_stats", lambda self: {})
    monkeypatch.setattr(
        SemanticMatcher,
        "get_instance",
        classmethod(lambda cls: SimpleNamespace(_get_model=lambda: None)),
    )
    monkeypatch.setattr(
        "integrity_checker.api.job_recovery.recover_orphaned_essay_jobs", _fake_recover
    )

    # 1) web_only mode MUST NOT spawn orphan recovery
    monkeypatch.setenv("CITRA_WORKER_MODE", "web_only")
    create_app()
    assert not recovery_event.wait(timeout=0.15)
    assert len(recovery_calls) == 0

    # 2) inline mode (non-test runtime) MUST invoke recover_orphaned_essay_jobs(get_pipeline)
    monkeypatch.setenv("CITRA_WORKER_MODE", "inline")
    create_app()
    assert recovery_event.wait(timeout=3.0)
    assert len(recovery_calls) == 1

    # 3) worker CLI main() runs cleanly with bounded --max-iterations
    engine = create_engine(f"sqlite:///{tmp_path / 'cli_worker.db'}")
    Base.metadata.create_all(bind=engine)
    run_migrations(engine)
    SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    monkeypatch.setattr("integrity_checker.db.session.init_db", lambda: None)
    monkeypatch.setattr("integrity_checker.db.session.get_session", SessionLocal)
    try:
        rc = worker_main(["--poll-interval", "0.01", "--max-iterations", "1"])
        assert rc == 0
    finally:
        engine.dispose()


@pytest.mark.asyncio
async def test_refund_upload_quota_once_skips_refund_on_completed_essay_reanalyze_failure(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Fix 1: Failed re-analysis on an already-completed essay (cis_json IS NOT NULL) must NOT
    refund monthly_uploads_used or leave job_status='failed'."""
    from integrity_checker.api.job_recovery import refund_upload_quota_once

    engine = create_engine(
        f"sqlite:///{tmp_path / 'reanalyze_no_refund.db'}",
        connect_args={"check_same_thread": False, "timeout": 30},
    )
    Base.metadata.create_all(bind=engine)
    run_migrations(engine)
    SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    monkeypatch.setattr("integrity_checker.db.session.get_session", SessionLocal)

    setup = SessionLocal()
    try:
        user = _seed_student(setup, used=0)
        essay = _claim_monthly_upload_slot_and_create_essay(
            setup, user, filename="completed_first.pdf", num_pages=2
        )
        essay_id = essay.id
        user_id = user.id
        assert user.monthly_uploads_used == 1
    finally:
        setup.close()

    pdf_file = tmp_path / "completed_first.pdf"
    pdf_file.write_bytes(_make_valid_pdf_bytes())

    ok_pipeline = MagicMock()
    ok_pipeline.run_async = AsyncMock(return_value=_make_stub_report())
    crashing_pipeline = MagicMock()
    crashing_pipeline.run_async = AsyncMock(side_effect=RuntimeError("Upstream transient crash"))

    try:
        # Initial upload completes cleanly
        await _run_pipeline_task(
            essay_id=essay_id,
            tmp_path=str(pdf_file),
            user_id=user_id,
            pipeline=ok_pipeline,
            cleanup_file=False,
        )

        # Subsequent re-analysis fails mid-run after setting job_status='processing'
        await _run_pipeline_task(
            essay_id=essay_id,
            tmp_path=str(pdf_file),
            user_id=user_id,
            pipeline=crashing_pipeline,
            cleanup_file=False,
        )

        check = SessionLocal()
        try:
            direct_res = refund_upload_quota_once(check, essay_id, "Direct reanalyze error")
            assert direct_res is False
            fresh_user = check.get(User, user_id)
            fresh_essay = check.get(EssayRecord, essay_id)
            assert fresh_user is not None and fresh_essay is not None
            assert fresh_user.monthly_uploads_used == 1
            assert fresh_essay.quota_charged == 1
            assert fresh_essay.cis_json is not None
            assert fresh_essay.job_status == "completed"
            assert fresh_essay.job_error == "Direct reanalyze error"
        finally:
            check.close()
    finally:
        engine.dispose()


def test_web_only_reanalyze_clears_stale_snapshot_and_reports_queued_status(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Fix 2: In CITRA_WORKER_MODE=web_only, POST /reanalyze clears stale _progress_snapshot
    and GET /status returns 'queued' instead of stale 'completed' or 'failed'."""
    import json

    import bcrypt

    from integrity_checker.api.deps import get_db
    from integrity_checker.api.main import create_app
    from integrity_checker.db.models import VerdictRecord

    engine = create_engine(
        f"sqlite:///{tmp_path / 'web_only_reanalyze.db'}",
        connect_args={"check_same_thread": False, "timeout": 30},
    )
    Base.metadata.create_all(bind=engine)
    run_migrations(engine)
    SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    uploads_dir = tmp_path / "uploads"
    uploads_dir.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(essays_route, "UPLOADS_DIR", uploads_dir)
    monkeypatch.setattr("integrity_checker.db.session.get_session", SessionLocal)
    monkeypatch.setenv("CITRA_WORKER_MODE", "web_only")

    def _override_db():
        db = SessionLocal()
        try:
            yield db
        finally:
            db.close()

    setup = SessionLocal()
    try:
        pw_hash = bcrypt.hashpw(b"Secret123!", bcrypt.gensalt()).decode()
        student = User(
            username="reanalyze_student",
            password_hash=pw_hash,
            role="user",
            email="reanalyze_student@example.com",
            is_active=1,
            email_verified=1,
            plan_tier="pro",
            monthly_uploads_used=2,
            quota_reset_at=datetime.now(UTC) + timedelta(days=30),
        )
        setup.add(student)
        setup.flush()

        done_essay = EssayRecord(
            filename="prev_completed.pdf",
            num_pages=3,
            user_id=student.id,
            job_status="completed",
            quota_charged=1,
            cis_json='{"score": 88.0}',
            style_profile_json=json.dumps(
                {
                    "style": "APA",
                    "_progress_snapshot": {"status": "completed", "step": "done", "step_index": 7},
                }
            ),
        )
        failed_essay = EssayRecord(
            filename="prev_failed.pdf",
            num_pages=2,
            user_id=student.id,
            job_status="failed",
            job_error="Prior failure",
            quota_charged=0,
            cis_json=None,
            style_profile_json=json.dumps(
                {
                    "_progress_snapshot": {
                        "status": "failed",
                        "step": "parsing",
                        "step_index": 0,
                        "error": "Prior failure",
                    }
                }
            ),
        )
        setup.add_all([done_essay, failed_essay])
        setup.flush()
        setup.add(
            VerdictRecord(
                essay_id=done_essay.id,
                citation_raw="Vaswani et al. (2017)",
                label="verified",
                confidence=0.95,
                reasoning="OK",
            )
        )
        setup.commit()
        done_id = done_essay.id
        failed_id = failed_essay.id
    finally:
        setup.close()

    pdf_bytes = _make_valid_pdf_bytes()
    (uploads_dir / f"{done_id}.pdf").write_bytes(pdf_bytes)
    (uploads_dir / f"{failed_id}.pdf").write_bytes(pdf_bytes)

    web_app = create_app()
    web_app.dependency_overrides[get_db] = _override_db
    try:
        client = TestClient(web_app)
        token = client.post(
            "/api/auth/login",
            json={"username": "reanalyze_student", "password": "Secret123!"},
        ).json()["token"]
        headers = {"Authorization": f"Bearer {token}"}

        for eid in (done_id, failed_id):
            re_resp = client.post(f"/api/essays/{eid}/reanalyze", headers=headers)
            assert re_resp.status_code == 200
            assert re_resp.json()["status"] == "queued"

            st_resp = client.get(f"/api/essays/{eid}/status", headers=headers)
            assert st_resp.status_code == 200
            assert st_resp.json()["status"] == "queued"

        verify = SessionLocal()
        try:
            e_done = verify.get(EssayRecord, done_id)
            assert e_done is not None and e_done.style_profile_json is not None
            parsed_sp = json.loads(e_done.style_profile_json)
            assert "_progress_snapshot" not in parsed_sp
            assert parsed_sp.get("style") == "APA"
        finally:
            verify.close()
    finally:
        web_app.dependency_overrides.clear()
        engine.dispose()


def test_refund_upload_quota_once_rolls_back_session_on_mid_transaction_error(
    tmp_path: Path,
) -> None:
    """Fix 3: If an error occurs mid-transaction inside refund_upload_quota_once, session is
    rolled back cleanly so quota_charged remains 1 and session stays usable without PendingRollbackError."""
    from integrity_checker.api.job_recovery import refund_upload_quota_once

    engine = create_engine(f"sqlite:///{tmp_path / 'rollback_guard.db'}")
    Base.metadata.create_all(bind=engine)
    run_migrations(engine)
    SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    session = SessionLocal()
    try:
        user = _seed_student(session, used=0)
        essay = _claim_monthly_upload_slot_and_create_essay(
            session, user, filename="tx_error.pdf", num_pages=1
        )
        essay_id = essay.id

        real_commit = session.commit
        commit_calls = 0

        def _failing_commit() -> None:
            nonlocal commit_calls
            commit_calls += 1
            # Fail on the final transaction commit after UPDATE essays + UPDATE users ran
            if not session.in_transaction():
                return real_commit()
            raise RuntimeError("Simulated SQLite commit IO failure")

        # Ensure clean no-transaction state before patching commit so pre-commit isn't triggered
        session.commit()
        with patch.object(session, "commit", side_effect=_failing_commit):
            with pytest.raises(RuntimeError, match="Simulated SQLite commit IO failure"):
                refund_upload_quota_once(session, essay_id, "Crash")

        # Session must be usable immediately (no PendingRollbackError) and write must have rolled back!
        reloaded_essay = session.get(EssayRecord, essay_id)
        reloaded_user = session.get(User, user.id)
        assert reloaded_essay is not None and reloaded_user is not None
        assert reloaded_essay.quota_charged == 1
        assert reloaded_essay.job_status == "queued"
        assert reloaded_user.monthly_uploads_used == 1
    finally:
        session.close()
        engine.dispose()


@pytest.mark.asyncio
async def test_worker_startup_recovery_preserves_fresh_queued_and_active_peer_processing_jobs(
    tmp_path: Path,
) -> None:
    """Fix 4: run_worker_loop startup recovery leaves queued jobs at job_attempt_count=0 and
    ignores active peer processing jobs with fresh job_heartbeat_at, while recovering stale processing jobs."""
    from integrity_checker.worker import run_worker_loop

    engine = create_engine(
        f"sqlite:///{tmp_path / 'worker_startup_hb.db'}",
        connect_args={"check_same_thread": False, "timeout": 30},
    )
    Base.metadata.create_all(bind=engine)
    run_migrations(engine)
    SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    uploads_dir = tmp_path / "uploads"
    uploads_dir.mkdir(parents=True, exist_ok=True)

    setup = SessionLocal()
    try:
        user = _seed_student(setup, used=0)
        e_queued = _claim_monthly_upload_slot_and_create_essay(
            setup, user, filename="fresh_queued.pdf", num_pages=1
        )
        e_queued.job_status = "queued"
        e_queued.job_attempt_count = 0

        e_active_peer = _claim_monthly_upload_slot_and_create_essay(
            setup, user, filename="peer_processing.pdf", num_pages=1
        )
        e_active_peer.job_status = "processing"
        e_active_peer.job_attempt_count = 0
        e_active_peer.job_heartbeat_at = datetime.now(UTC)

        e_stale_dead = _claim_monthly_upload_slot_and_create_essay(
            setup, user, filename="dead_worker.pdf", num_pages=1
        )
        e_stale_dead.job_status = "processing"
        e_stale_dead.job_attempt_count = 0
        e_stale_dead.job_heartbeat_at = datetime.now(UTC) - timedelta(minutes=15)

        setup.commit()
        queued_id = e_queued.id
        active_id = e_active_peer.id
        stale_id = e_stale_dead.id
    finally:
        setup.close()

    pdf_bytes = _make_valid_pdf_bytes()
    for eid in (queued_id, active_id, stale_id):
        (uploads_dir / f"{eid}.pdf").write_bytes(pdf_bytes)

    try:
        await run_worker_loop(
            pipeline_factory=MagicMock,
            session_factory=SessionLocal,
            uploads_dir=uploads_dir,
            poll_interval=0.01,
            max_iterations=0,
            recover_on_startup=True,
        )

        check = SessionLocal()
        try:
            q_row = check.get(EssayRecord, queued_id)
            a_row = check.get(EssayRecord, active_id)
            s_row = check.get(EssayRecord, stale_id)
            assert q_row is not None and a_row is not None and s_row is not None
            # Freshly queued job untouched (attempt count stays 0)
            assert q_row.job_status == "queued"
            assert q_row.job_attempt_count == 0
            # Active peer processing job untouched (stays processing, attempt count stays 0)
            assert a_row.job_status == "processing"
            assert a_row.job_attempt_count == 0
            # Stale dead processing job recovered back to queued with attempt count incremented to 1
            assert s_row.job_status == "queued"
            assert s_row.job_attempt_count == 1
        finally:
            check.close()
    finally:
        engine.dispose()
