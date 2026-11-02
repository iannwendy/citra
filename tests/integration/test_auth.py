"""Auth integration tests."""
import os

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

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
from integrity_checker.db.session import get_session

# Test credentials - intentionally simple for testing per plan spec
TEST_ADMIN_USER = os.environ.get("TEST_ADMIN_USER", "admin")
TEST_ADMIN_PASS = os.environ.get("TEST_ADMIN_PASS", "admin123")
TEST_USER_USER = os.environ.get("TEST_USER_USER", "user")
TEST_USER_PASS = os.environ.get("TEST_USER_PASS", "user123")


def get_clean_session() -> Session:
    """Get a fresh session for each test."""
    session = get_session()
    # Clean all data in FK dependency order
    session.query(AuditLog).delete()
    session.query(VerdictRecord).delete()
    session.query(CitationRecord).delete()
    session.query(EssayRecord).delete()
    session.query(ClassMembership).delete()
    session.query(ClassModel).delete()
    session.query(SessionModel).delete()
    session.query(User).delete()
    session.commit()
    return session


@pytest.fixture
def client():
    """Create a test client with clean database."""
    session = get_clean_session()
    session.close()
    return TestClient(app)


def test_login_invalid_credentials(client):
    """Test login with wrong credentials returns 401."""
    resp = client.post("/api/auth/login", json={"username": "wrong", "password": "wrong"})
    assert resp.status_code == 401
    assert "Invalid" in resp.json()["detail"]


def test_login_valid_admin(client):
    """Test login with admin credentials returns token."""
    resp = client.post("/api/auth/login", json={"username": TEST_ADMIN_USER, "password": TEST_ADMIN_PASS})
    assert resp.status_code == 200
    data = resp.json()
    assert "token" in data
    assert data["user"]["username"] == "admin"
    assert data["user"]["role"] == "admin"


def test_login_valid_user(client):
    """Test login with user credentials returns token."""
    resp = client.post("/api/auth/login", json={"username": TEST_USER_USER, "password": TEST_USER_PASS})
    assert resp.status_code == 200
    data = resp.json()
    assert "token" in data
    assert data["user"]["username"] == "user"
    assert data["user"]["role"] == "user"


def test_get_me_authenticated(client):
    """Test GET /auth/me returns user info."""
    # Login first
    login_resp = client.post("/api/auth/login", json={"username": TEST_ADMIN_USER, "password": TEST_ADMIN_PASS})
    token = login_resp.json()["token"]

    # Get me
    resp = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["username"] == "admin"
    assert data["role"] == "admin"


def test_get_me_unauthenticated(client):
    """Test GET /auth/me without token returns 422."""
    resp = client.get("/api/auth/me")
    assert resp.status_code == 422  # Missing required header


def test_admin_list_users(client):
    """Test admin can list all users."""
    login_resp = client.post("/api/auth/login", json={"username": TEST_ADMIN_USER, "password": TEST_ADMIN_PASS})
    token = login_resp.json()["token"]

    resp = client.get("/api/users", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)


def test_user_cannot_list_users(client):
    """Test regular user cannot list users."""
    login_resp = client.post("/api/auth/login", json={"username": TEST_USER_USER, "password": TEST_USER_PASS})
    token = login_resp.json()["token"]

    resp = client.get("/api/users", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 403


def test_cache_stats_requires_admin(client):
    """Test cache stats requires admin."""
    login_resp = client.post("/api/auth/login", json={"username": TEST_USER_USER, "password": TEST_USER_PASS})
    token = login_resp.json()["token"]

    resp = client.get("/api/cache/stats", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 403


def test_cache_stats_admin(client):
    """Test admin can get cache stats."""
    login_resp = client.post("/api/auth/login", json={"username": TEST_ADMIN_USER, "password": TEST_ADMIN_PASS})
    token = login_resp.json()["token"]

    resp = client.get("/api/cache/stats", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    data = resp.json()
    assert "total" in data
    assert "by_source" in data


def test_export_report_requires_admin(client):
    """Test export report requires admin."""
    login_resp = client.post("/api/auth/login", json={"username": TEST_USER_USER, "password": TEST_USER_PASS})
    token = login_resp.json()["token"]

    resp = client.get("/api/export/report", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 403


def test_create_user():
    """Test basic user creation."""
    session = get_session()
    user = User(username="testuser", password_hash="hashed", role="user")
    session.add(user)
    session.commit()
    assert user.id is not None
    assert user.username == "testuser"
    session.close()
