"""Tests for GET /api/teacher/classes/{id}/pending-reviews (Phase 4 — Task 3).

Returns all non-overridden verdicts in essays owned by students enrolled in
the class, limited to labels that need review (``metadata_error`` or
``suspected_hallucination``). Verifies:

- Positive case: ``metadata_error`` verdict is returned; ``verified`` is not.
- Override exclusion: once a verdict is overridden, it disappears.
- Cross-tenant: a different teacher (not the class owner) gets 403.
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
    """Look up the user_id of the hardcoded 'teacher' account."""
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
    user_id: int,
    filename: str = "test_essay.pdf",
    label: str = "metadata_error",
    is_overridden: int = 0,
) -> tuple[int, int]:
    """Create an essay (owned by user_id) with one VerdictRecord. Returns (essay_id, verdict_id)."""
    from integrity_checker.db.repository import Repository
    from integrity_checker.db.session import get_session

    session = get_session()
    try:
        repo = Repository(session)
        essay = repo.create_essay_with_user(
            filename=filename, num_pages=1, user_id=user_id,
        )
        verdict = VerdictRecord(
            essay_id=essay.id,
            citation_raw="Smith, J. (2020). Some title. Some venue.",
            label=label,
            confidence=0.5,
            reasoning="mismatched DOI",
            triggered_rules="[]",
            mismatched_fields="[]",
            features="{}",
            mapping_status="matched",
            mapping_confidence=0.0,
            is_overridden=is_overridden,
        )
        session.add(verdict)
        session.commit()
        return essay.id, verdict.id
    finally:
        session.close()


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_list_pending_reviews_for_class(clean_db):
    """Class with two essays: one metadata_error verdict (returned) and one
    verified verdict (excluded). Endpoint should return exactly 1 item.
    """
    from integrity_checker.db.repository import Repository
    from integrity_checker.db.session import get_session

    # setup: hardcoded teacher owns a class with a student who has 2 essays
    teacher_id = _hardcoded_teacher_id()
    student_id = _make_user("pr_student", role="user")

    session = get_session()
    try:
        repo = Repository(session)
        cls = repo.create_class(name="PendingClass", teacher_id=teacher_id)
        class_id = cls.id
        repo.add_student_to_class(cls.id, student_id)
        session.commit()
    finally:
        session.close()

    # essay A: metadata_error (not overridden) -> SHOULD appear
    # essay B: verified -> SHOULD NOT appear
    essay_a_id, verdict_a_id = _create_essay_with_verdict(
        student_id, filename="needs_review.pdf", label="metadata_error",
    )
    essay_b_id, verdict_b_id = _create_essay_with_verdict(
        student_id, filename="all_good.pdf", label="verified",
    )

    # act
    token = get_teacher_token()
    client = TestClient(app)
    resp = client.get(
        f"/api/teacher/classes/{class_id}/pending-reviews", headers=auth_header(token),
    )

    # assert
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert len(data) == 1, f"expected 1 pending review, got {len(data)}: {data}"
    item = data[0]
    assert item["verdict_id"] == verdict_a_id
    assert item["essay_id"] == essay_a_id
    assert item["filename"] == "needs_review.pdf"
    assert item["student_username"] == "pr_student"
    assert item["label"] == "metadata_error"
    assert item["confidence"] == 0.5
    assert item["reasoning"] == "mismatched DOI"
    assert item["validated_at"]  # non-empty ISO string


def test_pending_reviews_excludes_overridden(clean_db):
    """Once a verdict is overridden, it must be excluded from pending-reviews."""
    from integrity_checker.db.repository import Repository
    from integrity_checker.db.session import get_session

    teacher_id = _hardcoded_teacher_id()
    student_id = _make_user("pr_ovr_student", role="user")

    session = get_session()
    try:
        repo = Repository(session)
        cls = repo.create_class(name="OverrideClass", teacher_id=teacher_id)
        class_id = cls.id
        repo.add_student_to_class(cls.id, student_id)
        session.commit()
    finally:
        session.close()

    # essay with metadata_error verdict
    essay_id, verdict_id = _create_essay_with_verdict(
        student_id, label="metadata_error", is_overridden=0,
    )

    # act: override the verdict to verified via the existing override endpoint
    token = get_teacher_token()
    client = TestClient(app)
    override_resp = client.post(
        f"/api/essays/{essay_id}/verdicts/{verdict_id}/override",
        json={
            "verdict_id": str(verdict_id),
            "new_label": "verified",
            "new_mapping_status": "matched",
            "reason": "manually confirmed",
        },
        headers=auth_header(token),
    )
    assert override_resp.status_code == 200, override_resp.text

    # now query pending-reviews — should be empty
    resp = client.get(
        f"/api/teacher/classes/{class_id}/pending-reviews", headers=auth_header(token),
    )
    assert resp.status_code == 200, resp.text
    assert resp.json() == [], f"expected empty list, got {resp.json()}"


def test_teacher_cannot_view_other_teachers_class_pending(clean_db):
    """Teacher B (not the owner of the class) must get 403 on a class owned
    by teacher A.
    """
    from integrity_checker.db.repository import Repository
    from integrity_checker.db.session import get_session

    teacher_a_id = _hardcoded_teacher_id()
    teacher_b_id = _make_user("pr_teacher_b", role="teacher")
    student_id = _make_user("pr_loner", role="user")

    session = get_session()
    try:
        repo = Repository(session)
        # Class A owned by hardcoded teacher, student enrolled
        class_a = repo.create_class(name="ClassA", teacher_id=teacher_a_id)
        repo.add_student_to_class(class_a.id, student_id)
        # Class B owned by teacher_b (separate teacher)
        class_b = repo.create_class(name="ClassB", teacher_id=teacher_b_id)
        class_b_id = class_b.id
        session.commit()
    finally:
        session.close()

    # essay with metadata_error verdict
    _create_essay_with_verdict(student_id, label="metadata_error")

    # act: hardcoded teacher (teacher A) tries to view class B (not theirs)
    token = get_teacher_token()
    client = TestClient(app)
    resp = client.get(
        f"/api/teacher/classes/{class_b_id}/pending-reviews", headers=auth_header(token),
    )

    # assert: 403 (not your class)
    assert resp.status_code == 403, f"expected 403, got {resp.status_code}: {resp.text}"
    assert "Not your class" in resp.json()["detail"]


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
