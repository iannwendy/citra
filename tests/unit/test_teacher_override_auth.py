"""Tests for teacher override auth on class essays (Phase 4 — Task 2).

Verifies that POST /api/essays/{id}/verdicts/{verdict_id}/override allows
a teacher to override verdicts on essays that belong to students enrolled
in one of the teacher's classes. Teachers whose classes do not contain
the essay's owner must still get 403.
"""

from __future__ import annotations

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


def get_user_token() -> str:
    client = TestClient(app)
    resp = client.post(
        "/api/auth/login", json={"username": "user", "password": "user123"},
    )
    assert resp.status_code == 200, f"User login failed: {resp.text}"
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


def _hardcoded_teacher_id() -> int:
    """Look up the user_id of the hardcoded 'teacher' account so tests can
    attribute classes to it. The hardcoded teacher is created lazily on
    first login, so we trigger a login to ensure the user row exists.
    """
    from integrity_checker.db.session import get_session

    # Trigger lazy creation of the hardcoded teacher user via login.
    get_teacher_token()

    session = get_session()
    try:
        teacher = session.query(User).filter(User.username == "teacher").first()
        assert teacher is not None, "hardcoded 'teacher' user not seeded"
        return teacher.id
    finally:
        session.close()


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


def test_teacher_can_override_verdict_on_class_essay(clean_db):
    """A teacher may override a verdict on an essay belonging to a student
    enrolled in one of the teacher's classes.
    """
    from integrity_checker.db.repository import Repository
    from integrity_checker.db.session import get_session

    # setup: hardcoded teacher owns a class, a new student is enrolled in it,
    # and the student uploads an essay with one verdict.
    teacher_id = _hardcoded_teacher_id()
    student_id = _make_user("ovr_student", role="user")

    session = get_session()
    try:
        repo = Repository(session)
        cls = repo.create_class(name="TeacherClass", teacher_id=teacher_id)
        repo.add_student_to_class(cls.id, student_id)
        session.commit()
    finally:
        session.close()

    essay_id, verdict_id = _create_essay_with_verdict(student_id, label="metadata_error")

    # act: login as the teacher and POST /override
    token = get_teacher_token()
    client = TestClient(app)
    resp = client.post(
        f"/api/essays/{essay_id}/verdicts/{verdict_id}/override",
        json={
            "verdict_id": str(verdict_id),
            "new_label": "verified",
            "new_mapping_status": "matched",
            "reason": "manually confirmed by teacher",
        },
        headers=auth_header(token),
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["is_overridden"] is True


def test_teacher_cannot_override_essay_outside_their_class(clean_db):
    """A teacher must NOT be able to override a verdict on an essay that
    belongs to a student who is not in any of the teacher's classes.
    """
    from integrity_checker.db.repository import Repository
    from integrity_checker.db.session import get_session

    # setup: the hardcoded teacher owns class X. A new teacher (B) owns
    # class Y. A new student is enrolled in class Y (NOT class X) and
    # uploads an essay. The hardcoded teacher's classes do not contain
    # the student, so they must not be allowed to override.
    teacher_a_id = _hardcoded_teacher_id()
    teacher_b_id = _make_user("ovr_teacher_b", role="teacher")
    student_id = _make_user("ovr_loner_student", role="user")

    session = get_session()
    try:
        repo = Repository(session)
        class_x = repo.create_class(name="Class X", teacher_id=teacher_a_id)
        class_y = repo.create_class(name="Class Y", teacher_id=teacher_b_id)
        repo.add_student_to_class(class_y.id, student_id)
        # student is intentionally NOT in class_x
        session.commit()
        _ = class_x.id  # silence unused
    finally:
        session.close()

    # sanity: hardcoded teacher has no class containing this student
    session = get_session()
    try:
        teacher_classes = {c.id for c in Repository(session).list_classes_for_teacher(teacher_a_id)}
        student_classes = {c.id for c in Repository(session).list_classes_for_student(student_id)}
        assert not (teacher_classes & student_classes), (
            "test setup invariant: hardcoded teacher must not own a class the student is in"
        )
    finally:
        session.close()

    essay_id, verdict_id = _create_essay_with_verdict(student_id, label="metadata_error")

    # act: the hardcoded teacher (teacher A) attempts to override
    token = get_teacher_token()
    client = TestClient(app)
    resp = client.post(
        f"/api/essays/{essay_id}/verdicts/{verdict_id}/override",
        json={
            "verdict_id": str(verdict_id),
            "new_label": "verified",
            "new_mapping_status": "matched",
            "reason": "should be denied",
        },
        headers=auth_header(token),
    )
    assert resp.status_code == 403, (
        f"expected 403, got {resp.status_code}: {resp.text}"
    )


def test_student_cannot_override_own_essay_verdict(clean_db):
    """A student (role == 'user') must NOT be able to override verdicts,
    even on their own uploaded essay.
    """
    from integrity_checker.db.session import get_session

    token = get_user_token()
    session = get_session()
    try:
        student = session.query(User).filter(User.username == "user").first()
        assert student is not None
        student_id = student.id
    finally:
        session.close()

    essay_id, verdict_id = _create_essay_with_verdict(student_id, label="suspected_hallucination")

    client = TestClient(app)
    resp = client.post(
        f"/api/essays/{essay_id}/verdicts/{verdict_id}/override",
        json={
            "verdict_id": str(verdict_id),
            "new_label": "verified",
            "new_mapping_status": "matched",
            "reason": "student trying to self-verify",
        },
        headers=auth_header(token),
    )
    assert resp.status_code == 403


def test_can_override_verdicts_flag_enforced(clean_db):
    """When can_override_verdicts is False on a teacher account, override returns 403."""
    from integrity_checker.db.repository import Repository
    from integrity_checker.db.session import get_session

    teacher_id = _hardcoded_teacher_id()
    student_id = _make_user("flag_student", role="user")

    session = get_session()
    try:
        repo = Repository(session)
        cls = repo.create_class(name="FlagClass", teacher_id=teacher_id)
        repo.add_student_to_class(cls.id, student_id)
        teacher = session.get(User, teacher_id)
        assert teacher is not None
        teacher.can_override_verdicts = False
        session.commit()
    finally:
        session.close()

    essay_id, verdict_id = _create_essay_with_verdict(student_id, label="metadata_error")

    token = get_teacher_token()
    client = TestClient(app)
    resp = client.post(
        f"/api/essays/{essay_id}/verdicts/{verdict_id}/override",
        json={
            "verdict_id": str(verdict_id),
            "new_label": "verified",
            "reason": "override disabled",
        },
        headers=auth_header(token),
    )
    assert resp.status_code == 403


def test_cross_essay_verdict_override_idor_blocked(clean_db):
    """A teacher who has access to essay_a must NOT be able to pass essay_a in the URL
    and verdict_b (belonging to another essay_b) to modify verdict_b (IDOR protection).
    """
    from integrity_checker.db.session import get_session

    teacher_id = _hardcoded_teacher_id()
    other_user_id = _make_user("other_owner", role="user")

    essay_a, _verdict_a = _create_essay_with_verdict(teacher_id, label="metadata_error")
    _essay_b, verdict_b = _create_essay_with_verdict(other_user_id, label="suspected_hallucination")

    token = get_teacher_token()
    client = TestClient(app)
    resp = client.post(
        f"/api/essays/{essay_a}/verdicts/{verdict_b}/override",
        json={
            "verdict_id": str(verdict_b),
            "new_label": "verified",
            "reason": "cross-essay IDOR attempt",
        },
        headers=auth_header(token),
    )
    assert resp.status_code == 404

    # Verify verdict_b was NOT modified in the database
    session = get_session()
    try:
        v_row = session.get(VerdictRecord, verdict_b)
        assert v_row is not None
        assert v_row.label == "suspected_hallucination"
        assert bool(v_row.is_overridden) is False
    finally:
        session.close()


def test_override_rejects_invalid_label_and_mapping_status(clean_db):
    """OverrideRequest must reject arbitrary strings for new_label or new_mapping_status."""
    teacher_id = _hardcoded_teacher_id()
    essay_id, verdict_id = _create_essay_with_verdict(teacher_id, label="metadata_error")

    token = get_teacher_token()
    client = TestClient(app)

    bad_label_resp = client.post(
        f"/api/essays/{essay_id}/verdicts/{verdict_id}/override",
        json={
            "verdict_id": str(verdict_id),
            "new_label": "arbitrary_injected_label",
            "reason": "test",
        },
        headers=auth_header(token),
    )
    assert bad_label_resp.status_code == 422

    bad_status_resp = client.post(
        f"/api/essays/{essay_id}/verdicts/{verdict_id}/override",
        json={
            "verdict_id": str(verdict_id),
            "new_label": "verified",
            "new_mapping_status": "arbitrary_injected_status",
            "reason": "test",
        },
        headers=auth_header(token),
    )
    assert bad_status_resp.status_code == 422


# ---------------------------------------------------------------------------
# Fixture — extends clean_db to also wipe VerdictRecord + AuditLog
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def clean_db():
    """Wipe all tables touched by these tests (extends the existing
    test_teacher_role pattern to include VerdictRecord and AuditLog so
    Task 1's log_audit doesn't leak between tests).
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
