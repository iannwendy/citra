"""Tests for AuditLog persistence on verdict override (Phase 4 — Task 1).

Verifies that POST /api/essays/{id}/verdicts/{verdict_id}/override writes an
append-only row to the ``audit_logs`` table capturing the original label,
the new label, the acting user, and the override reason.
"""

from __future__ import annotations

from datetime import UTC

import pytest
from fastapi.testclient import TestClient

from integrity_checker.api.main import app
from integrity_checker.db.models import (
    AuditLog,
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

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def get_admin_token() -> str:
    client = TestClient(app)
    resp = client.post(
        "/api/auth/login", json={"username": "admin", "password": "admin123"},
    )
    assert resp.status_code == 200, f"Admin login failed: {resp.text}"
    return resp.json()["token"]


def get_teacher_token() -> str:
    client = TestClient(app)
    resp = client.post(
        "/api/auth/login", json={"username": "teacher", "password": "teacher123"},
    )
    assert resp.status_code == 200, f"Teacher login failed: {resp.text}"
    return resp.json()["token"]


def auth_header(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _make_user(username: str, role: str = "user", email: str | None = None) -> int:
    """Create a user directly via DB and return id. Mirrors test_teacher_role helper."""
    import bcrypt

    from integrity_checker.db.repository import Repository
    from integrity_checker.db.session import get_session

    session = get_session()
    repo = Repository(session)
    user = repo.create_user(
        username=username,
        password_hash=bcrypt.hashpw(b"testpass123", bcrypt.gensalt()).decode(),
        role=role,
        email=email,
        full_name=username.title(),
        is_active=True,
    )
    session.commit()
    uid = user.id
    session.close()
    return uid


def _create_essay_with_verdict(
    user_id: int, label: str = "metadata_error",
) -> tuple[int, int]:
    """Create an essay (owned by user_id) with one VerdictRecord. Returns (essay_id, verdict_id)."""
    from integrity_checker.db.repository import Repository
    from integrity_checker.db.session import get_session

    session = get_session()
    try:
        repo = Repository(session)
        essay = repo.create_essay_with_user(
            filename="test_essay.pdf", num_pages=1, user_id=user_id,
        )
        verdict = VerdictRecord(
            essay_id=essay.id,
            citation_raw="Smith, J. (2020). Some title. Some venue.",
            label=label,
            confidence=0.5,
            reasoning="",
            triggered_rules="[]",
            mismatched_fields="[]",
            features="{}",
            mapping_status="matched",
            mapping_confidence=0.0,
        )
        session.add(verdict)
        session.commit()
        return essay.id, verdict.id
    finally:
        session.close()


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_override_writes_audit_log(clean_db):
    """Overriding a verdict must persist an AuditLog row with the original
    label, new label, the acting user's username, and the override reason.
    """
    from integrity_checker.db.session import get_session

    # setup: create a teacher (for ownership override), an essay owned by them,
    # and a verdict with label='metadata_error'
    teacher_id = _make_user(username="audit_teacher", role="user", email="audit_t@example.com")
    essay_id, verdict_id = _create_essay_with_verdict(teacher_id, label="metadata_error")

    # act: login as admin (admin can override any essay) and POST /override
    token = get_admin_token()
    client = TestClient(app)
    resp = client.post(
        f"/api/essays/{essay_id}/verdicts/{verdict_id}/override",
        json={
            "verdict_id": str(verdict_id),
            "new_label": "verified",
            "new_mapping_status": "matched",
            "reason": "manually confirmed via DOI check",
        },
        headers=auth_header(token),
    )
    assert resp.status_code == 200, resp.text

    # assert: an AuditLog row exists with the expected fields
    session = get_session()
    try:
        rows = list(session.query(AuditLog).all())
        assert len(rows) == 1, f"expected 1 audit row, got {len(rows)}"
        row = rows[0]
        assert row.verdict_id == verdict_id
        assert row.original_label == "metadata_error"
        assert row.new_label == "verified"
        assert row.user == "admin"
        assert row.note == "manually confirmed via DOI check"

        verdict_row = session.get(VerdictRecord, verdict_id)
        assert verdict_row is not None
        assert verdict_row.overridden_by == "admin"

        essay_row = session.get(EssayRecord, essay_id)
        assert essay_row is not None and essay_row.cis_json is not None
    finally:
        session.close()


def test_list_audit_log_requires_admin(clean_db):
    """Non-admin (teacher) calling GET /api/audit/log must be rejected (403)."""
    from integrity_checker.db.repository import Repository
    from integrity_checker.db.session import get_session

    # Seed one audit row so the test would pass if auth were bypassed.
    session = get_session()
    repo = Repository(session)
    repo.log_audit(
        verdict_id=1, original_label="metadata_error", new_label="verified",
        user="admin", note="seed",
    )
    session.commit()
    session.close()

    # Log in as teacher (not admin) and try to read the audit log.
    token = get_teacher_token()
    client = TestClient(app)
    resp = client.get("/api/audit/log", headers=auth_header(token))
    assert resp.status_code == 403, resp.text


def test_list_audit_log_returns_recent_first(clean_db):
    """GET /api/audit/log must return rows ordered by logged_at DESC."""
    from datetime import datetime, timedelta, timezone

    from integrity_checker.db.repository import Repository
    from integrity_checker.db.session import get_session

    # Seed three audit rows with explicit, distinct logged_at values.
    session = get_session()
    base = datetime(2026, 1, 1, 12, 0, 0, tzinfo=UTC)
    repo = Repository(session)
    repo.session.add(AuditLog(
        verdict_id=1, original_label="metadata_error", new_label="verified",
        user="admin", note="oldest", logged_at=base,
    ))
    repo.session.add(AuditLog(
        verdict_id=2, original_label="suspected_hallucination", new_label="verified",
        user="admin", note="middle", logged_at=base + timedelta(minutes=10),
    ))
    repo.session.add(AuditLog(
        verdict_id=3, original_label="metadata_error", new_label="suspected_hallucination",
        user="teacher1", note="newest", logged_at=base + timedelta(minutes=20),
    ))
    session.commit()
    session.close()

    token = get_admin_token()
    client = TestClient(app)
    resp = client.get("/api/audit/log", headers=auth_header(token))
    assert resp.status_code == 200, resp.text

    rows = resp.json()
    assert len(rows) == 3
    # Newest first
    assert rows[0]["note"] == "newest"
    assert rows[0]["user"] == "teacher1"
    assert rows[1]["note"] == "middle"
    assert rows[2]["note"] == "oldest"


# ---------------------------------------------------------------------------
# Fixture — extends clean_db to also wipe VerdictRecord + AuditLog
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def clean_db():
    """Wipe all tables touched by these tests (extends the existing
    test_teacher_role pattern to include VerdictRecord and AuditLog).
    """
    from integrity_checker.db.session import get_session

    session = get_session()
    session.query(AuditLog).delete()
    session.query(VerdictRecord).delete()
    session.query(CitationRecord).delete()
    session.query(EssayRecord).delete()
    session.query(ClassMembership).delete()
    session.query(ClassModel).delete()
    session.query(SessionModel).delete()
    session.query(User).delete()
    session.commit()
    session.close()
    yield
    session = get_session()
    session.query(AuditLog).delete()
    session.query(VerdictRecord).delete()
    session.query(CitationRecord).delete()
    session.query(EssayRecord).delete()
    session.query(ClassMembership).delete()
    session.query(ClassModel).delete()
    session.query(SessionModel).delete()
    session.query(User).delete()
    session.commit()
    session.close()
