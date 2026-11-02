"""Tests for user management API — unit + integration patterns.

Covers:
- User model CRUD (admin)
- Self-service profile management (/me)
- Avatar upload + delete
- Session-level isolation via clean_db fixture
"""

from __future__ import annotations

import io

import pytest
from fastapi.testclient import TestClient

from integrity_checker.api.main import app
from integrity_checker.db.models import AuthToken, User
from integrity_checker.db.models import Session as SessionModel

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def get_admin_token() -> str:
    """Login as admin and return JWT token."""
    client = TestClient(app)
    resp = client.post(
        "/api/auth/login",
        json={"username": "admin", "password": "admin123"},
    )
    assert resp.status_code == 200, f"Admin login failed: {resp.text}"
    return resp.json()["token"]


def get_user_token() -> str:
    """Login as regular user and return JWT token."""
    client = TestClient(app)
    resp = client.post(
        "/api/auth/login",
        json={"username": "user", "password": "user123"},
    )
    assert resp.status_code == 200, f"User login failed: {resp.text}"
    return resp.json()["token"]


def auth_header(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


# ---------------------------------------------------------------------------
# User CRUD (admin)
# ---------------------------------------------------------------------------

class TestListUsers:
    def test_admin_lists_all_users(self, clean_db):
        token = get_admin_token()
        # Also login regular user so it's created in DB
        get_user_token()
        client = TestClient(app)
        resp = client.get("/api/users", headers=auth_header(token))
        assert resp.status_code == 200
        users = resp.json()
        assert isinstance(users, list)
        assert len(users) >= 2  # admin + user at minimum

    def test_non_admin_gets_403(self, clean_db):
        # Create both users first
        get_admin_token()
        token = get_user_token()
        client = TestClient(app)
        resp = client.get("/api/users", headers=auth_header(token))
        assert resp.status_code == 403

    def test_unauthenticated_gets_401_or_422(self, clean_db):
        client = TestClient(app)
        resp = client.get("/api/users")
        # FastAPI returns 422 when missing required auth header in test client
        assert resp.status_code in (401, 422)


class TestCreateUser:
    def test_admin_creates_user_success(self, clean_db):
        token = get_admin_token()
        client = TestClient(app)
        resp = client.post(
            "/api/users",
            json={
                "username": "newtestuser",
                "password": "securepass123",
                "email": "newtest@example.com",
                "full_name": "New Test User",
                "role": "user",
            },
            headers=auth_header(token),
        )
        assert resp.status_code == 200, f"Create failed: {resp.text}"
        data = resp.json()
        assert data["username"] == "newtestuser"
        assert data["email"] == "newtest@example.com"
        assert data["full_name"] == "New Test User"
        assert data["role"] == "user"
        assert data["is_active"] is True
        assert "avatar_url" in data
        assert "last_login_at" in data

    def test_create_duplicate_username_fails(self, clean_db):
        token = get_admin_token()
        client = TestClient(app)
        resp = client.post(
            "/api/users",
            json={
                "username": "newtestuser",
                "password": "securepass123",
                "role": "user",
            },
            headers=auth_header(token),
        )
        assert resp.status_code == 200  # first creation OK

        # Second creation with same username should fail
        resp2 = client.post(
            "/api/users",
            json={
                "username": "newtestuser",
                "password": "anotherpass",
                "role": "user",
            },
            headers=auth_header(token),
        )
        assert resp2.status_code == 400
        assert "already exists" in resp2.json()["detail"]

    def test_create_duplicate_email_fails(self, clean_db):
        token = get_admin_token()
        client = TestClient(app)
        # Create first user
        client.post(
            "/api/users",
            json={
                "username": "user_one",
                "password": "pass123456",
                "email": "dup@example.com",
                "role": "user",
            },
            headers=auth_header(token),
        )
        # Second user with same email should fail
        resp = client.post(
            "/api/users",
            json={
                "username": "user_two",
                "password": "pass123456",
                "email": "dup@example.com",
                "role": "user",
            },
            headers=auth_header(token),
        )
        assert resp.status_code == 400
        assert "already exists" in resp.json()["detail"]

    def test_create_invalid_role_fails(self, clean_db):
        token = get_admin_token()
        client = TestClient(app)
        resp = client.post(
            "/api/users",
            json={
                "username": "badrole",
                "password": "pass123456",
                "role": "superadmin",
            },
            headers=auth_header(token),
        )
        assert resp.status_code == 400
        assert "role" in resp.json()["detail"].lower()

    def test_non_admin_cannot_create_user(self, clean_db):
        get_admin_token()  # ensure DB has users
        token = get_user_token()
        client = TestClient(app)
        resp = client.post(
            "/api/users",
            json={"username": "hacker", "password": "pass123456", "role": "admin"},
            headers=auth_header(token),
        )
        assert resp.status_code == 403


class TestUpdateUser:
    def test_admin_updates_user(self, clean_db):
        token = get_admin_token()
        client = TestClient(app)

        # Create user
        create_resp = client.post(
            "/api/users",
            json={"username": "updateme", "password": "pass123456", "role": "user"},
            headers=auth_header(token),
        )
        assert create_resp.status_code == 200, f"Create failed: {create_resp.text}"
        user_id = create_resp.json()["id"]

        # Update
        resp = client.put(
            f"/api/users/{user_id}",
            json={"full_name": "Updated Name", "email": "updated@example.com"},
            headers=auth_header(token),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["full_name"] == "Updated Name"
        assert data["email"] == "updated@example.com"

    def test_admin_toggles_user_active(self, clean_db):
        token = get_admin_token()
        client = TestClient(app)

        create_resp = client.post(
            "/api/users",
            json={"username": "toggleme", "password": "pass123456", "role": "user"},
            headers=auth_header(token),
        )
        assert create_resp.status_code == 200
        user_id = create_resp.json()["id"]
        assert create_resp.json()["is_active"] is True

        resp = client.put(
            f"/api/users/{user_id}",
            json={"is_active": False},
            headers=auth_header(token),
        )
        assert resp.status_code == 200
        assert resp.json()["is_active"] is False

    def test_deactivated_user_active_session_revoked(self, clean_db):
        """An already-issued JWT token for a user must fail immediately after admin deactivates them."""
        admin_token = get_admin_token()
        client = TestClient(app)

        create_resp = client.post(
            "/api/users",
            json={"username": "activeuser", "password": "pass123456", "role": "user"},
            headers=auth_header(admin_token),
        )
        assert create_resp.status_code == 200
        user_id = create_resp.json()["id"]

        login_resp = client.post(
            "/api/auth/login",
            json={"username": "activeuser", "password": "pass123456"},
        )
        assert login_resp.status_code == 200
        user_token = login_resp.json()["token"]

        # Verify token works before deactivation
        me_before = client.get("/api/users/me", headers=auth_header(user_token))
        assert me_before.status_code == 200

        # Admin deactivates user
        deact_resp = client.put(
            f"/api/users/{user_id}",
            json={"is_active": False},
            headers=auth_header(admin_token),
        )
        assert deact_resp.status_code == 200

        # Token must now be rejected (session revoked / inactive user)
        me_after = client.get("/api/users/me", headers=auth_header(user_token))
        assert me_after.status_code in (401, 403)

    def test_update_password_hashes_it(self, clean_db):
        token = get_admin_token()
        client = TestClient(app)

        create_resp = client.post(
            "/api/users",
            json={"username": "pwchange", "password": "oldpass123", "role": "user"},
            headers=auth_header(token),
        )
        assert create_resp.status_code == 200
        user_id = create_resp.json()["id"]

        # Update password
        resp = client.put(
            f"/api/users/{user_id}",
            json={"password": "new_secure_pass"},
            headers=auth_header(token),
        )
        assert resp.status_code == 200

        # New password should work for login
        login = client.post(
            "/api/auth/login",
            json={"username": "pwchange", "password": "new_secure_pass"},
        )
        assert login.status_code == 200


class TestDeleteUser:
    def test_admin_deletes_user(self, clean_db):
        token = get_admin_token()
        client = TestClient(app)

        create_resp = client.post(
            "/api/users",
            json={"username": "deleteme", "password": "pass123456", "role": "user"},
            headers=auth_header(token),
        )
        assert create_resp.status_code == 200, f"Create failed: {create_resp.text}"
        user_id = create_resp.json()["id"]

        resp = client.delete(f"/api/users/{user_id}", headers=auth_header(token))
        assert resp.status_code == 200
        assert "deleted" in resp.json()["message"]

        # Verify user is gone
        list_resp = client.get("/api/users", headers=auth_header(token))
        user_ids = [u["id"] for u in list_resp.json()]
        assert user_id not in user_ids

    def test_admin_cannot_delete_self(self, clean_db):
        token = get_admin_token()
        client = TestClient(app)

        # Get admin user id
        me_resp = client.get("/api/users/me", headers=auth_header(token))
        admin_id = me_resp.json()["id"]

        resp = client.delete(f"/api/users/{admin_id}", headers=auth_header(token))
        assert resp.status_code == 400
        assert "cannot delete yourself" in resp.json()["detail"].lower()

    def test_non_admin_cannot_delete(self, clean_db):
        get_admin_token()  # create users
        token = get_user_token()
        client = TestClient(app)
        resp = client.delete("/api/users/999", headers=auth_header(token))
        assert resp.status_code == 403

    def test_delete_nonexistent_returns_404(self, clean_db):
        token = get_admin_token()
        client = TestClient(app)
        resp = client.delete("/api/users/99999", headers=auth_header(token))
        assert resp.status_code == 404

    def test_admin_deletes_teacher_with_class_and_essays(self, clean_db):
        """Deleting a teacher who owns a class and essays must not fail with IntegrityError."""
        from integrity_checker.api.deps import get_pipeline
        from integrity_checker.db.repository import Repository
        from integrity_checker.db.session import get_session

        assert get_pipeline() is get_pipeline()

        token = get_admin_token()
        client = TestClient(app)
        create_resp = client.post(
            "/api/users",
            json={
                "username": "teacher_to_del",
                "password": "password123",
                "role": "teacher",
                "email": "tdel@example.com",
            },
            headers=auth_header(token),
        )
        assert create_resp.status_code == 200
        teacher_id = create_resp.json()["id"]

        session = get_session()
        try:
            repo = Repository(session)
            cls = repo.create_class(name="TempClassToDelete", teacher_id=teacher_id)
            repo.create_essay_with_user(
                filename="teacher_essay.pdf",
                num_pages=1,
                user_id=teacher_id,
                class_id=cls.id,
            )
            session.commit()
        finally:
            session.close()

        del_resp = client.delete(f"/api/users/{teacher_id}", headers=auth_header(token))
        assert del_resp.status_code == 200


# ---------------------------------------------------------------------------
# Self-service endpoints
# ---------------------------------------------------------------------------

class TestGetMe:
    def test_get_me_returns_full_profile(self, clean_db):
        token = get_admin_token()
        client = TestClient(app)
        resp = client.get("/api/users/me", headers=auth_header(token))
        assert resp.status_code == 200
        data = resp.json()
        assert "id" in data
        assert "username" in data
        assert "email" in data
        assert "full_name" in data
        assert "is_active" in data
        assert "avatar_url" in data
        assert "last_login_at" in data
        assert "created_at" in data
        assert data["username"] == "admin"

    def test_unauthenticated_gets_401_or_422(self, clean_db):
        client = TestClient(app)
        resp = client.get("/api/users/me")
        assert resp.status_code in (401, 422)


class TestUpdateMe:
    def test_user_updates_own_profile(self, clean_db):
        get_admin_token()  # create DB entries
        token = get_user_token()
        client = TestClient(app)

        resp = client.patch(
            "/api/users/me",
            json={"full_name": "My Full Name", "email": "my@email.com"},
            headers=auth_header(token),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["full_name"] == "My Full Name"
        assert data["email"] == "my@email.com"

    def test_user_cannot_change_role_via_me(self, clean_db):
        get_admin_token()
        token = get_user_token()
        client = TestClient(app)

        resp = client.patch(
            "/api/users/me",
            json={"role": "admin"},
            headers=auth_header(token),
        )
        # Schema doesn't have role — it's ignored silently
        assert resp.status_code == 200
        data = resp.json()
        assert data["role"] == "user"

    def test_update_email_duplicate_fails(self, clean_db):
        token = get_admin_token()
        client = TestClient(app)

        # Set admin email
        client.patch(
            "/api/users/me",
            json={"email": "taken@email.com"},
            headers=auth_header(token),
        )

        # Regular user tries same email
        user_token = get_user_token()
        resp = client.patch(
            "/api/users/me",
            json={"email": "taken@email.com"},
            headers=auth_header(user_token),
        )
        assert resp.status_code == 400
        assert "already exists" in resp.json()["detail"]

    def test_changing_email_resets_email_verified_and_sends_activation_email(self, clean_db):
        from integrity_checker.api.services.email_service import get_email_service

        email_svc = get_email_service()
        email_svc.clear_outbox()

        token = get_user_token()
        client = TestClient(app)

        # Initially email_verified is True
        me_before = client.get("/api/users/me", headers=auth_header(token)).json()
        assert me_before["email_verified"] is True

        # Changing email resets email_verified=False and dispatches a new activation email
        resp = client.patch(
            "/api/users/me",
            json={"email": "NewAddress@Example.com"},
            headers=auth_header(token),
        )
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["email"] == "newaddress@example.com"
        assert data["email_verified"] is False

        assert len(email_svc.outbox) == 1
        sent = email_svc.outbox[-1]
        assert sent.to_email == "newaddress@example.com"
        assert sent.template_type == "activation"
        assert sent.token is not None

        # Activating with the new token restores email_verified=True
        act = client.post("/api/auth/activate", json={"token": sent.token})
        assert act.status_code == 200
        me_after = client.get("/api/users/me", headers=auth_header(token)).json()
        assert me_after["email_verified"] is True


class TestChangePassword:
    def test_user_changes_password(self, clean_db):
        get_admin_token()  # ensure DB setup
        token = get_user_token()  # get user token
        client = TestClient(app)

        resp = client.post(
            "/api/users/me/password",
            json={"current_password": "user123", "new_password": "new_user_pass"},
            headers=auth_header(token),  # user token → /me is the user account
        )
        assert resp.status_code == 200
        assert "success" in resp.json()["message"].lower()

        # New password should work (user is the hardcoded "user" account)
        login = client.post(
            "/api/auth/login",
            json={"username": "user", "password": "new_user_pass"},
        )
        assert login.status_code == 200

        # Old session token must be revoked after password change
        me_old = client.get("/api/auth/me", headers=auth_header(token))
        assert me_old.status_code == 401

    def test_admin_password_update_revokes_target_user_sessions(self, clean_db):
        admin_token = get_admin_token()
        user_token = get_user_token()
        client = TestClient(app)

        me_before = client.get("/api/auth/me", headers=auth_header(user_token))
        assert me_before.status_code == 200
        user_id = me_before.json()["id"]

        upd = client.put(
            f"/api/users/{user_id}",
            json={"password": "admin_reset_pass_123"},
            headers=auth_header(admin_token),
        )
        assert upd.status_code == 200

        # User's previous session must now be revoked
        me_after = client.get("/api/auth/me", headers=auth_header(user_token))
        assert me_after.status_code == 401

    def test_wrong_current_password_fails(self, clean_db):
        get_admin_token()
        token = get_user_token()
        client = TestClient(app)
        resp = client.post(
            "/api/users/me/password",
            json={"current_password": "wrongpassword", "new_password": "newpass123"},
            headers=auth_header(token),
        )
        assert resp.status_code == 400
        assert "incorrect" in resp.json()["detail"].lower()

    def test_new_password_same_as_current_fails(self, clean_db):
        get_admin_token()
        token = get_user_token()
        client = TestClient(app)
        resp = client.post(
            "/api/users/me/password",
            json={"current_password": "user123", "new_password": "user123"},
            headers=auth_header(token),
        )
        assert resp.status_code == 400
        assert "different" in resp.json()["detail"].lower()


# ---------------------------------------------------------------------------
# Avatar service
# ---------------------------------------------------------------------------

class TestAvatarUpload:
    def test_upload_valid_jpeg(self, clean_db):
        token = get_user_token()
        client = TestClient(app)

        # Minimal JPEG header (enough for MIME detection)
        jpeg_bytes = (
            b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00"
            b"\xff\xdb\x00C\x00\x08\x06\x06\x07\x06\x05\x08\x07\x07\x07\t\t\x08\n"
            b"\x0c\x14\r\x0c\x0b\x0b\x0c\x19\x12\x13\x0f\x14\x1d\x1a\x1f\x1e\x1d"
            b"\x1a\x1c\x1c $.' \",#\x1c\x1c(7),01444\x1f'9LI"
        )

        resp = client.post(
            "/api/users/me/avatar",
            files={"file": ("avatar.jpg", io.BytesIO(jpeg_bytes), "image/jpeg")},
            headers=auth_header(token),
        )
        assert resp.status_code == 200, f"Upload failed: {resp.text}"
        data = resp.json()
        assert data["avatar_url"] is not None
        assert "avatar" in data["avatar_url"]

    def test_upload_valid_png(self, clean_db):
        token = get_user_token()
        client = TestClient(app)

        # Minimal valid PNG (1x1 transparent pixel)
        png_bytes = (
            b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01"
            b"\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89"
            b"\x00\x00\x00\nIDATx\x9cc\x00\x01\x00\x00\x05\x00\x01\r\n-\xb4"
            b"\x00\x00\x00\x00IEND\xaeB`\x82"
        )

        resp = client.post(
            "/api/users/me/avatar",
            files={"file": ("avatar.png", io.BytesIO(png_bytes), "image/png")},
            headers=auth_header(token),
        )
        assert resp.status_code == 200
        assert ".png" in resp.json()["avatar_url"]

    def test_upload_webp(self, clean_db):
        token = get_user_token()
        client = TestClient(app)

        # Minimal WebP header
        webp_bytes = b"RIFF" + b"\x00\x00\x00\x00" + b"WEBP" + b"VP8 \x00\x00\x00\x00"

        resp = client.post(
            "/api/users/me/avatar",
            files={"file": ("avatar.webp", io.BytesIO(webp_bytes), "image/webp")},
            headers=auth_header(token),
        )
        assert resp.status_code == 200
        assert ".webp" in resp.json()["avatar_url"]

    def test_upload_rejects_invalid_mime(self, clean_db):
        token = get_user_token()
        client = TestClient(app)

        resp = client.post(
            "/api/users/me/avatar",
            files={"file": ("evil.txt", io.BytesIO(b"<script>alert(1)</script>"), "text/plain")},
            headers=auth_header(token),
        )
        assert resp.status_code == 400
        assert "unsupported" in resp.json()["detail"].lower() or "type" in resp.json()["detail"].lower()

    def test_upload_rejects_empty_file(self, clean_db):
        token = get_user_token()
        client = TestClient(app)

        resp = client.post(
            "/api/users/me/avatar",
            files={"file": ("empty.png", io.BytesIO(b""), "image/png")},
            headers=auth_header(token),
        )
        assert resp.status_code == 400
        assert "empty" in resp.json()["detail"].lower()

    def test_upload_rejects_spoofed_magic_bytes_xss(self, clean_db):
        token = get_user_token()
        client = TestClient(app)

        # HTML/SVG disguised with image/png Content-Type
        resp = client.post(
            "/api/users/me/avatar",
            files={"file": ("xss.png", io.BytesIO(b"<svg onload=alert(1)></svg>"), "image/png")},
            headers=auth_header(token),
        )
        assert resp.status_code == 400
        assert "does not match" in resp.json()["detail"].lower()

    def test_upload_rejects_oversized_avatar_stream(self, clean_db):
        token = get_user_token()
        client = TestClient(app)

        big_bytes = b"\x89PNG\r\n\x1a\n" + (b"A" * (2 * 1024 * 1024 + 100))
        resp = client.post(
            "/api/users/me/avatar",
            files={"file": ("huge.png", io.BytesIO(big_bytes), "image/png")},
            headers=auth_header(token),
        )
        assert resp.status_code == 400
        assert "too large" in resp.json()["detail"].lower()


class TestAvatarDelete:
    def test_delete_own_avatar(self, clean_db):
        token = get_user_token()
        client = TestClient(app)

        # Minimal PNG
        png_bytes = (
            b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01"
            b"\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89"
            b"\x00\x00\x00\nIDATx\x9cc\x00\x01\x00\x00\x05\x00\x01\r\n-\xb4"
            b"\x00\x00\x00\x00IEND\xaeB`\x82"
        )
        upload_resp = client.post(
            "/api/users/me/avatar",
            files={"file": ("avatar.png", io.BytesIO(png_bytes), "image/png")},
            headers=auth_header(token),
        )
        assert upload_resp.status_code == 200

        # Delete
        del_resp = client.delete("/api/users/me/avatar", headers=auth_header(token))
        assert del_resp.status_code == 200
        assert del_resp.json()["avatar_url"] is None


# ---------------------------------------------------------------------------
# New fields on User model
# ---------------------------------------------------------------------------

class TestUserNewFields:
    def test_user_has_all_new_fields(self, clean_db):
        token = get_admin_token()
        client = TestClient(app)

        resp = client.post(
            "/api/users",
            json={
                "username": "fieldtest",
                "password": "pass123456",
                "email": "fieldtest@example.com",
                "full_name": "Field Test",
                "role": "user",
                "is_active": False,
            },
            headers=auth_header(token),
        )
        assert resp.status_code == 200, f"Create failed: {resp.text}"
        data = resp.json()
        assert "email" in data
        assert "full_name" in data
        assert "is_active" in data
        assert "avatar_url" in data
        assert "last_login_at" in data
        assert "created_at" in data
        assert data["email"] == "fieldtest@example.com"
        assert data["full_name"] == "Field Test"
        assert data["is_active"] is False

    def test_login_sets_last_login_at(self, clean_db):
        client = TestClient(app)

        # First login (user auto-created)
        resp = client.post(
            "/api/auth/login",
            json={"username": "user", "password": "user123"},
        )
        assert resp.status_code == 200
        user_data = resp.json()["user"]
        assert user_data["last_login_at"] is not None

    def test_auth_me_returns_all_new_fields(self, clean_db):
        token = get_admin_token()
        client = TestClient(app)
        resp = client.get("/api/auth/me", headers=auth_header(token))
        assert resp.status_code == 200
        data = resp.json()
        assert "email" in data
        assert "full_name" in data
        assert "is_active" in data
        assert "avatar_url" in data
        assert "last_login_at" in data
        assert "created_at" in data


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(autouse=True)
def clean_db():
    """Wipe sessions and users before each test so they start fresh."""
    from integrity_checker.db.session import get_session

    session = get_session()
    session.query(AuthToken).delete()
    session.query(SessionModel).delete()
    session.query(User).delete()
    session.commit()
    session.close()
    yield
    # Cleanup after test too
    session = get_session()
    session.query(AuthToken).delete()
    session.query(SessionModel).delete()
    session.query(User).delete()
    session.commit()
    session.close()
