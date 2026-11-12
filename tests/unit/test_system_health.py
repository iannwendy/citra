"""Tests for admin-only system health endpoint (Phase 4 — Task 4).

Covers:
- Non-admin token → 403
- Admin token → aggregates: totals, verdict_label_counts, cache_stats
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from integrity_checker.api.main import app
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
    """Create a user directly via DB and return id."""
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
    user_id: int,
    filename: str = "test_essay.pdf",
    label: str = "verified",
) -> tuple[int, int]:
    """Create an essay (owned by user_id) with one VerdictRecord."""
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
            confidence=0.9,
            reasoning="ok",
            triggered_rules="[]",
            mismatched_fields="[]",
            features="{}",
            mapping_status="matched",
            mapping_confidence=0.0,
            is_overridden=0,
        )
        session.add(verdict)
        session.commit()
        return essay.id, verdict.id
    finally:
        session.close()


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_system_health_requires_admin(clean_db):
    """Non-admin token → 403."""
    token = get_user_token()
    client = TestClient(app)
    resp = client.get("/api/system/health", headers=auth_header(token))
    assert resp.status_code == 403, f"expected 403, got {resp.status_code}: {resp.text}"
    assert "Admin" in resp.json()["detail"]


def test_system_health_returns_aggregates(clean_db):
    """Admin token with seeded data → response has all aggregates."""
    # Seed: 1 extra student + 2 essays (one verified, one metadata_error)
    student_id = _make_user("sh_student", role="user")
    _create_essay_with_verdict(student_id, filename="essay_one.pdf", label="verified")
    _create_essay_with_verdict(student_id, filename="essay_two.pdf", label="metadata_error")

    # Capture baseline counts BEFORE admin token login (which would create admin user)
    token = get_admin_token()
    client = TestClient(app)
    resp = client.get("/api/system/health", headers=auth_header(token))

    assert resp.status_code == 200, resp.text
    data = resp.json()

    # Top-level structure
    assert data["status"] == "ok"
    assert "totals" in data
    assert "verdict_label_counts" in data
    assert "cache_stats" in data

    # Totals — reflect the seeded data we control
    totals = data["totals"]
    assert totals["essays"] == 2
    assert totals["verdicts"] == 2
    # admin (auto-created on first login) + 1 student we seeded = 2
    assert totals["users"] == 2
    assert totals["admins"] == 1
    assert totals["students"] == 1
    assert totals["teachers"] == 0

    # Verdict label counts
    label_counts = data["verdict_label_counts"]
    assert label_counts.get("verified", 0) == 1
    assert label_counts.get("metadata_error", 0) == 1

    # Cache stats — at least the documented shape
    cache_stats = data["cache_stats"]
    assert "total" in cache_stats
    assert "by_source" in cache_stats
    assert "total_hits" in cache_stats
    assert "avg_hit_count" in cache_stats

    # Service telemetry and parser mode
    assert "services" in data
    assert data["services"]["database"] == "ok"
    assert data["services"]["cache"] == "ok"
    assert data["services"]["parser"] == "ok"
    assert data["parser_mode"] in ("grobid", "regex")
    assert isinstance(data["grobid_available"], bool)


def test_public_health_grobid_message_matches_container_state(monkeypatch, clean_db):
    """Regression (BUG-02): /api/health must not claim container is running when container_running is False."""
    from types import SimpleNamespace

    from integrity_checker.api.routes import health as health_mod
    from integrity_checker.extraction import GROBID_STATUS

    state = {"running": False}
    fake_manager = SimpleNamespace(
        check_health=lambda: GROBID_STATUS.UNHEALTHY,
        is_container_running=lambda: state["running"],
        get_stats=lambda: {},
        stats=SimpleNamespace(container_id=None),
    )
    monkeypatch.setattr(health_mod, "get_grobid_manager", lambda: fake_manager)

    # Case 1: Container is NOT running -> container_running=False, message must NOT say "container running"
    client = TestClient(app)
    resp = client.get("/api/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body["grobid"]["container_running"] is False
    assert "container running" not in body["grobid"]["message"].lower()
    assert "not running" in body["grobid"]["message"].lower()

    # Case 2: Container IS running, yet HTTP health check failed -> hung container
    state["running"] = True
    resp_hung = client.get("/api/health")
    assert resp_hung.status_code == 200
    body_hung = resp_hung.json()
    assert body_hung["grobid"]["container_running"] is True
    assert body_hung["grobid"]["message"] == "GROBID container running but API not responding"

    # And /api/system/health marks grobid service degraded when container is hung
    token = get_admin_token()
    sys_resp = client.get("/api/system/health", headers=auth_header(token))
    assert sys_resp.status_code == 200
    assert sys_resp.json()["services"].get("grobid") == "degraded"


def test_sandbox_verify_respects_language_for_layer1_notes(clean_db):
    """Regression (BUG-10): /api/essays/sandbox/verify returns English Layer 1 notes when lang='en'."""
    token = get_user_token()
    client = TestClient(app)

    en_resp = client.post(
        "/api/essays/sandbox/verify",
        headers=auth_header(token),
        json={
            "style": "apa",
            "lang": "en",
            "references_text": "Vaswani, A., Shazeer, N. (2017). Attention Is All You Need. NeurIPS.",
        },
    )
    assert en_resp.status_code == 200, en_resp.text
    en_note = en_resp.json()["results"][0]["mapping_note"]
    assert "Kiểm tra trực tiếp" not in en_note
    assert "Direct bibliography verification" in en_note

    vi_resp = client.post(
        "/api/essays/sandbox/verify",
        headers=auth_header(token),
        json={
            "style": "apa",
            "lang": "vi",
            "references_text": "Vaswani, A., Shazeer, N. (2017). Attention Is All You Need. NeurIPS.",
        },
    )
    assert vi_resp.status_code == 200, vi_resp.text
    vi_note = vi_resp.json()["results"][0]["mapping_note"]
    assert "Kiểm tra trực tiếp danh mục tham khảo" in vi_note


# ---------------------------------------------------------------------------
# Fixture
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def clean_db():
    """Wipe tables touched by these tests (Users + Essays + Verdicts)."""
    from integrity_checker.db.session import get_session

    session = get_session()
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
    session.query(VerdictRecord).delete()
    session.query(CitationRecord).delete()
    session.query(EssayRecord).delete()
    session.query(ClassMembership).delete()
    session.query(ClassModel).delete()
    session.query(SessionModel).delete()
    session.query(User).delete()
    session.commit()
    session.close()
