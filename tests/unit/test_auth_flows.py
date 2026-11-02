"""Unit & Integration tests for Register, Account Activation, Forgot Password, and Reset Password."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from integrity_checker.api.main import app
from integrity_checker.api.services.email_service import get_email_service
from integrity_checker.db.models import AuthToken, User
from integrity_checker.db.models import Session as SessionModel
from integrity_checker.db.repository import Repository
from integrity_checker.db.session import get_session


@pytest.fixture(autouse=True)
def clean_auth_db():
    """Ensure clean DB and email outbox before and after each test."""
    email_svc = get_email_service()
    email_svc.clear_outbox()
    session = get_session()
    session.query(AuthToken).delete()
    session.query(SessionModel).delete()
    session.query(User).delete()
    session.commit()
    session.close()
    yield
    email_svc.clear_outbox()
    session = get_session()
    session.query(AuthToken).delete()
    session.query(SessionModel).delete()
    session.query(User).delete()
    session.commit()
    session.close()


class TestRegisterAndActivateFlow:
    def test_register_creates_inactive_user_and_sends_html_email(self):
        client = TestClient(app)
        email_svc = get_email_service()

        resp = client.post(
            "/api/auth/register",
            json={
                "username": "student_minh",
                "email": "Minh.Student@example.com",
                "password": "StrongPassword123",
                "full_name": "Nguyễn Bảo Minh",
                "institution": "Ton Duc Thang University",
                "lang": "vi",
            },
        )
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["username"] == "student_minh"
        assert data["email"] == "minh.student@example.com"
        assert data["requires_activation"] is True
        assert data["email_sent"] is True

        # Check HTML activation email in outbox
        assert len(email_svc.outbox) == 1
        sent = email_svc.outbox[0]
        assert sent.template_type == "activation"
        assert sent.to_email == "minh.student@example.com"
        assert sent.token is not None
        assert "Kích hoạt Tài khoản Ngay" in sent.html_body

        # Cannot log in before activating
        login_before = client.post(
            "/api/auth/login",
            json={"username": "student_minh", "password": "StrongPassword123"},
        )
        assert login_before.status_code == 403
        assert "ACCOUNT_NOT_ACTIVATED" in login_before.json()["detail"]

        # Activate account using token from email
        act_resp = client.post("/api/auth/activate", json={"token": sent.token})
        assert act_resp.status_code == 200, act_resp.text
        act_data = act_resp.json()
        assert act_data["activated"] is True
        assert act_data["already_active"] is False
        assert act_data["username"] == "student_minh"

        # Clicking the activation link a second time is idempotent when already active
        act_again = client.post("/api/auth/activate", json={"token": sent.token})
        assert act_again.status_code == 200
        assert act_again.json()["already_active"] is True

        # Can now log in by username AND by email
        login_after = client.post(
            "/api/auth/login",
            json={"username": "student_minh", "password": "StrongPassword123"},
        )
        assert login_after.status_code == 200
        assert login_after.json()["user"]["email_verified"] is True

        login_by_email = client.post(
            "/api/auth/login",
            json={"username": "minh.student@example.com", "password": "StrongPassword123"},
        )
        assert login_by_email.status_code == 200
        assert login_by_email.json()["user"]["username"] == "student_minh"

    def test_register_rejects_duplicate_username_or_email_or_bad_username(self):
        client = TestClient(app)

        # Invalid characters in username
        bad_user = client.post(
            "/api/auth/register",
            json={
                "username": "bad user space",
                "email": "a@example.com",
                "password": "password123",
            },
        )
        assert bad_user.status_code == 400

        # Valid registration
        ok = client.post(
            "/api/auth/register",
            json={
                "username": "scholar1",
                "email": "scholar1@example.com",
                "password": "password123",
            },
        )
        assert ok.status_code == 200

        # Duplicate username
        dup_u = client.post(
            "/api/auth/register",
            json={
                "username": "scholar1",
                "email": "other@example.com",
                "password": "password123",
            },
        )
        assert dup_u.status_code == 400
        assert "username" in dup_u.json()["detail"].lower()

        # Duplicate email (case-insensitive)
        dup_e = client.post(
            "/api/auth/register",
            json={
                "username": "scholar2",
                "email": "SCHOLAR1@EXAMPLE.COM",
                "password": "password123",
            },
        )
        assert dup_e.status_code == 400
        assert "email" in dup_e.json()["detail"].lower()

    def test_resend_activation_invalidates_old_token_and_issues_new(self):
        client = TestClient(app)
        email_svc = get_email_service()

        client.post(
            "/api/auth/register",
            json={
                "username": "resend_user",
                "email": "resend@example.com",
                "password": "password123",
            },
        )
        first_token = email_svc.outbox[-1].token
        assert first_token is not None

        # Resend activation using username
        resend_resp = client.post(
            "/api/auth/resend-activation",
            json={"identifier": "resend_user", "lang": "en"},
        )
        assert resend_resp.status_code == 200
        second_token = email_svc.outbox[-1].token
        assert second_token is not None
        assert second_token != first_token

        # Old token should now be rejected
        old_act = client.post("/api/auth/activate", json={"token": first_token})
        assert old_act.status_code == 400

        # New token activates the account
        new_act = client.post("/api/auth/activate", json={"token": second_token})
        assert new_act.status_code == 200
        assert new_act.json()["activated"] is True

        # Resending when already active returns 400
        already_resp = client.post(
            "/api/auth/resend-activation",
            json={"identifier": "resend@example.com"},
        )
        assert already_resp.status_code == 400

    def test_expired_or_invalid_activation_token_rejected(self):
        client = TestClient(app)
        email_svc = get_email_service()

        # Totally invalid token
        bad = client.post("/api/auth/activate", json={"token": "nonexistent_token"})
        assert bad.status_code == 400

        # Expired token
        client.post(
            "/api/auth/register",
            json={
                "username": "exp_user",
                "email": "exp@example.com",
                "password": "password123",
            },
        )
        tok = email_svc.outbox[-1].token
        assert tok is not None

        session = get_session()
        repo = Repository(session)
        row = repo.get_auth_token(tok, "activation")
        assert row is not None
        row.expires_at = datetime.now(UTC) - timedelta(hours=1)
        session.commit()
        session.close()

        exp_resp = client.post("/api/auth/activate", json={"token": tok})
        assert exp_resp.status_code == 400
        assert "expired" in exp_resp.json()["detail"].lower()


class TestForgotPasswordAndResetFlow:
    def test_full_forgot_and_reset_password_flow_revokes_sessions(self):
        client = TestClient(app)
        email_svc = get_email_service()

        # Register & activate user
        client.post(
            "/api/auth/register",
            json={
                "username": "prof_lan",
                "email": "lan@example.com",
                "password": "OldPassword123",
                "full_name": "PGS.TS Nguyễn Thị Lan",
            },
        )
        act_tok = email_svc.outbox[-1].token
        client.post("/api/auth/activate", json={"token": act_tok})

        # Login to create an active JWT session
        login1 = client.post(
            "/api/auth/login",
            json={"username": "prof_lan", "password": "OldPassword123"},
        )
        assert login1.status_code == 200
        old_jwt = login1.json()["token"]

        # Request forgot password
        email_svc.clear_outbox()
        forgot_resp = client.post(
            "/api/auth/forgot-password",
            json={"email": "lan@example.com", "lang": "vi"},
        )
        assert forgot_resp.status_code == 200
        assert len(email_svc.outbox) == 1
        reset_email = email_svc.outbox[0]
        assert reset_email.template_type == "password_reset"
        reset_token = reset_email.token
        assert reset_token is not None

        # Verify reset token endpoint
        verify_resp = client.get(f"/api/auth/verify-reset-token?token={reset_token}")
        assert verify_resp.status_code == 200
        vdata = verify_resp.json()
        assert vdata["valid"] is True
        assert vdata["username"] == "prof_lan"
        assert vdata["email"] == "lan@example.com"

        # Reset password
        reset_resp = client.post(
            "/api/auth/reset-password",
            json={
                "token": reset_token,
                "new_password": "NewSecurePassword456",
                "lang": "vi",
            },
        )
        assert reset_resp.status_code == 200

        # Password changed notification email sent
        assert email_svc.outbox[-1].template_type == "password_changed"

        # Token cannot be reused
        reuse_verify = client.get(f"/api/auth/verify-reset-token?token={reset_token}")
        assert reuse_verify.json()["valid"] is False
        assert reuse_verify.json()["reason"] == "used"

        reuse_reset = client.post(
            "/api/auth/reset-password",
            json={"token": reset_token, "new_password": "AnotherPassword789"},
        )
        assert reuse_reset.status_code == 400

        # Old JWT session should be revoked (401 on /api/auth/me)
        me_old = client.get(
            "/api/auth/me",
            headers={"Authorization": f"Bearer {old_jwt}"},
        )
        assert me_old.status_code == 401

        # Old password no longer works
        old_login = client.post(
            "/api/auth/login",
            json={"username": "prof_lan", "password": "OldPassword123"},
        )
        assert old_login.status_code == 401

        # New password works
        new_login = client.post(
            "/api/auth/login",
            json={"username": "prof_lan", "password": "NewSecurePassword456"},
        )
        assert new_login.status_code == 200

    def test_forgot_password_unknown_email_does_not_leak_existence(self):
        client = TestClient(app)
        email_svc = get_email_service()

        resp = client.post(
            "/api/auth/forgot-password",
            json={"email": "nobody@example.com"},
        )
        assert resp.status_code == 200
        assert len(email_svc.outbox) == 0


class TestProductionSecurityGuards:
    def test_dev_latest_email_blocked_in_production_even_when_debug_true(self, monkeypatch):
        client = TestClient(app)
        email_svc = get_email_service()
        email_svc.send_activation_email(
            to_email="victim@example.com",
            username="victim",
            full_name="Victim",
            raw_token="secret_tok_999",
        )
        # In test mode, dev endpoint works
        dev_resp = client.get("/api/auth/dev/latest-email?email=victim@example.com")
        assert dev_resp.status_code == 200
        assert dev_resp.json()["token"] == "secret_tok_999"

        # In production mode (even if debug=True), endpoint must return 404
        monkeypatch.setenv("APP_ENV", "production")
        prod_resp = client.get("/api/auth/dev/latest-email?email=victim@example.com")
        assert prod_resp.status_code == 404

    def test_email_outbox_not_populated_in_production(self, monkeypatch):
        email_svc = get_email_service()
        email_svc.clear_outbox()
        monkeypatch.setenv("APP_ENV", "production")

        email_svc.send_activation_email(
            to_email="produser@example.com",
            username="produser",
            full_name="Prod User",
            raw_token="prod_tok_123",
        )
        assert len(email_svc.outbox) == 0

    def test_demo_users_disabled_in_production(self, monkeypatch):
        from integrity_checker.api.routes.auth import _is_demo_enabled

        monkeypatch.setenv("APP_ENV", "production")
        monkeypatch.setenv("DEMO_USERS_ENABLED", "true")
        assert _is_demo_enabled() is False

    def test_login_rate_limiter_blocks_brute_force(self, monkeypatch):
        from integrity_checker.api.routes.auth import _login_rate_limiter

        _login_rate_limiter.clear_all()
        monkeypatch.setattr(_login_rate_limiter, "enforce_in_tests", True)
        monkeypatch.setattr(_login_rate_limiter, "max_attempts", 3)

        client = TestClient(app)
        try:
            for _ in range(3):
                r = client.post(
                    "/api/auth/login",
                    json={"username": "brute_target", "password": "wrong"},
                )
                assert r.status_code == 401

            blocked = client.post(
                "/api/auth/login",
                json={"username": "brute_target", "password": "wrong"},
            )
            assert blocked.status_code == 429
            assert "too many" in blocked.json()["detail"].lower()
        finally:
            _login_rate_limiter.clear_all()


class TestGoogleOAuthFlow:
    def test_google_config_endpoint_reflects_client_id(self, monkeypatch):
        client = TestClient(app)
        monkeypatch.setenv("GOOGLE_CLIENT_ID", "")
        r1 = client.get("/api/auth/google/config")
        assert r1.status_code == 200
        assert r1.json() == {"enabled": False, "client_id": None}

        unconfigured_login = client.post(
            "/api/auth/google",
            json={"access_token": "dummy_tok"},
        )
        assert unconfigured_login.status_code == 503
        assert "GOOGLE_NOT_CONFIGURED" in unconfigured_login.json()["detail"]

        monkeypatch.setenv("GOOGLE_CLIENT_ID", "12345-citra.apps.googleusercontent.com")
        r2 = client.get("/api/auth/google/config")
        assert r2.status_code == 200
        assert r2.json() == {
            "enabled": True,
            "client_id": "12345-citra.apps.googleusercontent.com",
        }

    def test_google_login_creates_new_user_and_returns_jwt(self, monkeypatch):
        client = TestClient(app)
        monkeypatch.setenv("GOOGLE_CLIENT_ID", "12345-citra.apps.googleusercontent.com")
        monkeypatch.setattr(
            "integrity_checker.api.routes.auth._verify_google_payload",
            lambda req, cid, csec: {
                "sub": "google-sub-998877",
                "email": "Minh.Scholar@tdtu.edu.vn",
                "email_verified": True,
                "name": "Nguyễn Bảo Minh",
                "picture": "https://lh3.googleusercontent.com/a/avatar123",
            },
        )

        resp = client.post(
            "/api/auth/google",
            json={"access_token": "valid_google_access_token"},
        )
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["token"]
        user = data["user"]
        assert user["username"] == "minh.scholar"
        assert user["email"] == "minh.scholar@tdtu.edu.vn"
        assert user["full_name"] == "Nguyễn Bảo Minh"
        assert user["avatar_url"] == "https://lh3.googleusercontent.com/a/avatar123"
        assert user["auth_provider"] == "google"
        assert user["google_linked"] is True
        assert user["email_verified"] is True
        assert user["is_active"] is True

        # Verify session token works with /api/auth/me
        me_resp = client.get(
            "/api/auth/me",
            headers={"Authorization": f"Bearer {data['token']}"},
        )
        assert me_resp.status_code == 200
        assert me_resp.json()["username"] == "minh.scholar"

    def test_google_login_links_existing_unactivated_user_and_activates_account(
        self, monkeypatch
    ):
        client = TestClient(app)
        # Register local user (unactivated)
        reg = client.post(
            "/api/auth/register",
            json={
                "username": "custom_handle",
                "email": "linked@tdtu.edu.vn",
                "password": "LocalPassword123",
            },
        )
        assert reg.status_code == 200

        monkeypatch.setenv("GOOGLE_CLIENT_ID", "12345-citra.apps.googleusercontent.com")
        monkeypatch.setattr(
            "integrity_checker.api.routes.auth._verify_google_payload",
            lambda req, cid, csec: {
                "sub": "google-sub-linked-001",
                "email": "linked@tdtu.edu.vn",
                "email_verified": "true",
                "name": "Linked Scholar",
                "picture": "https://lh3.googleusercontent.com/a/linked",
            },
        )

        g_resp = client.post(
            "/api/auth/google",
            json={"credential": "valid_google_id_token"},
        )
        assert g_resp.status_code == 200, g_resp.text
        g_user = g_resp.json()["user"]
        # Preserves original username, activates account, and links Google
        assert g_user["username"] == "custom_handle"
        assert g_user["is_active"] is True
        assert g_user["email_verified"] is True
        assert g_user["google_linked"] is True
        assert g_user["auth_provider"] == "local,google"
        assert g_user["full_name"] == "Linked Scholar"

        # Original local password still works after Google account linking
        local_login = client.post(
            "/api/auth/login",
            json={"username": "custom_handle", "password": "LocalPassword123"},
        )
        assert local_login.status_code == 200

    def test_google_login_blocks_deactivated_user(self, monkeypatch):
        client = TestClient(app)
        session = get_session()
        repo = Repository(session)
        u = repo.create_user(
            username="deactivated_scholar",
            password_hash="hash",
            role="user",
            email="blocked@tdtu.edu.vn",
            is_active=False,
            email_verified=True,
        )
        session.commit()
        session.close()

        monkeypatch.setenv("GOOGLE_CLIENT_ID", "12345-citra.apps.googleusercontent.com")
        monkeypatch.setattr(
            "integrity_checker.api.routes.auth._verify_google_payload",
            lambda req, cid, csec: {
                "sub": "google-sub-blocked",
                "email": "blocked@tdtu.edu.vn",
                "email_verified": True,
                "name": "Blocked User",
            },
        )

        resp = client.post(
            "/api/auth/google",
            json={"access_token": "tok"},
        )
        assert resp.status_code == 403
        assert "ACCOUNT_DEACTIVATED" in resp.json()["detail"]

    def test_google_login_rejects_mismatched_google_id_on_existing_email(self, monkeypatch):
        client = TestClient(app)
        session = get_session()
        repo = Repository(session)
        repo.create_user(
            username="existing_google_user",
            password_hash="hash",
            role="user",
            email="conflict@tdtu.edu.vn",
            is_active=True,
            email_verified=True,
            google_id="original-google-sub-111",
            auth_provider="google",
        )
        session.commit()
        session.close()

        monkeypatch.setenv("GOOGLE_CLIENT_ID", "12345-citra.apps.googleusercontent.com")
        monkeypatch.setattr(
            "integrity_checker.api.routes.auth._verify_google_payload",
            lambda req, cid, csec: {
                "sub": "different-google-sub-222",
                "email": "conflict@tdtu.edu.vn",
                "email_verified": True,
                "name": "Conflict User",
            },
        )

        resp = client.post(
            "/api/auth/google",
            json={"access_token": "tok"},
        )
        assert resp.status_code == 403
        assert "linked to a different Google account" in resp.json()["detail"]

    def test_google_login_filters_non_https_avatar_and_rejects_unverified_email(
        self, monkeypatch
    ):
        client = TestClient(app)
        monkeypatch.setenv("GOOGLE_CLIENT_ID", "12345-citra.apps.googleusercontent.com")

        # Unverified Google email must be rejected
        monkeypatch.setattr(
            "integrity_checker.api.routes.auth._verify_google_payload",
            lambda req, cid, csec: {
                "sub": "google-sub-unverified",
                "email": "unverified@tdtu.edu.vn",
                "email_verified": False,
                "name": "Unverified",
            },
        )
        r_unverified = client.post(
            "/api/auth/google",
            json={"access_token": "tok"},
        )
        assert r_unverified.status_code == 403
        assert "not verified" in r_unverified.json()["detail"]

        # Non-https avatar URL must be ignored
        monkeypatch.setattr(
            "integrity_checker.api.routes.auth._verify_google_payload",
            lambda req, cid, csec: {
                "sub": "google-sub-http-avatar",
                "email": "httpavatar@tdtu.edu.vn",
                "email_verified": True,
                "name": "HTTP Avatar",
                "picture": "javascript:alert(1)",
            },
        )
        r_avatar = client.post(
            "/api/auth/google",
            json={"access_token": "tok"},
        )
        assert r_avatar.status_code == 200
        assert r_avatar.json()["user"]["avatar_url"] is None

    def test_google_user_first_time_username_and_password_setup_flows(self, monkeypatch):
        client = TestClient(app)
        email_svc = get_email_service()
        email_svc.clear_outbox()

        monkeypatch.setenv("GOOGLE_CLIENT_ID", "12345-citra.apps.googleusercontent.com")
        monkeypatch.setattr(
            "integrity_checker.api.routes.auth._verify_google_payload",
            lambda req, cid, csec: {
                "sub": "google-sub-onboarding-001",
                "email": "wendyxsausage@example.com",
                "email_verified": True,
                "name": "Nguyễn Bảo Minh",
            },
        )

        # 1. First Google login creates user, sends welcome + password setup email, and enables onboarding
        g_resp = client.post(
            "/api/auth/google",
            json={"access_token": "valid_tok"},
        )
        assert g_resp.status_code == 200
        token = g_resp.json()["token"]
        user = g_resp.json()["user"]
        assert user["username"] == "wendyxsausage"
        assert user["has_password"] is False
        assert user["can_set_username"] is True
        assert user["needs_onboarding"] is True

        # Welcome email with password setup token was dispatched automatically
        assert len(email_svc.outbox) == 1
        welcome_mail = email_svc.outbox[-1]
        assert welcome_mail.template_type == "google_welcome"
        assert welcome_mail.token is not None

        # 2. User sets custom username for the first time via PATCH /api/users/me
        patch_resp = client.patch(
            "/api/users/me",
            json={"username": "baominh_scholar"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert patch_resp.status_code == 200, patch_resp.text
        updated = patch_resp.json()
        assert updated["username"] == "baominh_scholar"
        assert updated["can_set_username"] is False
        assert updated["needs_onboarding"] is False

        # Attempting to change username a second time is rejected
        second_patch = client.patch(
            "/api/users/me",
            json={"username": "another_handle"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert second_patch.status_code == 400

        # 3. User can also request a fresh password setup email link from Profile page
        email_svc.clear_outbox()
        mail_req = client.post(
            "/api/users/me/password-setup-email",
            json={"lang": "vi"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert mail_req.status_code == 200
        assert len(email_svc.outbox) == 1
        assert email_svc.outbox[-1].token is not None

        # 4. User sets initial password directly via POST /api/users/me/password WITHOUT current_password
        pw_resp = client.post(
            "/api/users/me/password",
            json={"new_password": "InitialGooglePass123!"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert pw_resp.status_code == 200, pw_resp.text
        new_session_token = pw_resp.json()["token"]
        assert new_session_token

        # Verify profile now shows has_password=True and auth_provider="local,google"
        me_after = client.get(
            "/api/users/me",
            headers={"Authorization": f"Bearer {new_session_token}"},
        )
        assert me_after.status_code == 200
        assert me_after.json()["has_password"] is True
        assert me_after.json()["auth_provider"] == "local,google"

        # 5. User can now sign in with their custom username + new password!
        local_login = client.post(
            "/api/auth/login",
            json={"username": "baominh_scholar", "password": "InitialGooglePass123!"},
        )
        assert local_login.status_code == 200
        assert local_login.json()["user"]["username"] == "baominh_scholar"


class TestAmbiguousAndAdversarialAuthEdgeCases:
    """Tests for subtle, ambiguous, and adversarial security edge cases."""

    def test_get_auth_me_preserves_google_onboarding_and_password_flags_on_reload(
        self, monkeypatch
    ):
        client = TestClient(app)
        monkeypatch.setenv("GOOGLE_CLIENT_ID", "12345-citra.apps.googleusercontent.com")
        monkeypatch.setattr(
            "integrity_checker.api.routes.auth._verify_google_payload",
            lambda req, cid, csec: {
                "sub": "google-sub-reload-check",
                "email": "reload_check@tdtu.edu.vn",
                "email_verified": True,
                "name": "Reload Check",
            },
        )

        g_resp = client.post("/api/auth/google", json={"access_token": "tok"})
        assert g_resp.status_code == 200
        token = g_resp.json()["token"]

        # GET /api/auth/me must return has_password, can_set_username, and needs_onboarding
        auth_me = client.get(
            "/api/auth/me",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert auth_me.status_code == 200
        me_data = auth_me.json()
        assert me_data["has_password"] is False
        assert me_data["can_set_username"] is True
        assert me_data["needs_onboarding"] is True
        assert me_data["google_linked"] is True

    def test_case_insensitive_username_collision_and_login(self, monkeypatch):
        client = TestClient(app)
        email_svc = get_email_service()
        email_svc.clear_outbox()

        # 1. Register user with mixed-case username "Scholar_Alpha"
        reg = client.post(
            "/api/auth/register",
            json={
                "username": "Scholar_Alpha",
                "email": "alpha1@tdtu.edu.vn",
                "password": "SafePassword123!",
            },
        )
        assert reg.status_code == 200
        act_tok = email_svc.outbox[-1].token
        client.post("/api/auth/activate", json={"token": act_tok})

        # 2. Another user cannot register "scholar_alpha" or "SCHOLAR_ALPHA"
        dup_lower = client.post(
            "/api/auth/register",
            json={
                "username": "scholar_alpha",
                "email": "alpha2@tdtu.edu.vn",
                "password": "SafePassword123!",
            },
        )
        assert dup_lower.status_code == 400
        assert "already exists" in dup_lower.json()["detail"].lower()

        dup_upper = client.post(
            "/api/auth/register",
            json={
                "username": "SCHOLAR_ALPHA",
                "email": "alpha3@tdtu.edu.vn",
                "password": "SafePassword123!",
            },
        )
        assert dup_upper.status_code == 400

        # 3. User A can log in using lowercase or uppercase variant of their username
        login_lower = client.post(
            "/api/auth/login",
            json={"username": "scholar_alpha", "password": "SafePassword123!"},
        )
        assert login_lower.status_code == 200

        # 4. A new Google user cannot claim "SCHOLAR_ALPHA", but CAN change casing of their own handle
        monkeypatch.setenv("GOOGLE_CLIENT_ID", "12345-citra.apps.googleusercontent.com")
        monkeypatch.setattr(
            "integrity_checker.api.routes.auth._verify_google_payload",
            lambda req, cid, csec: {
                "sub": "google-sub-case-test",
                "email": "auto_handle@tdtu.edu.vn",
                "email_verified": True,
                "name": "Case Tester",
            },
        )
        g_resp = client.post("/api/auth/google", json={"access_token": "tok"})
        g_token = g_resp.json()["token"]

        collision_patch = client.patch(
            "/api/users/me",
            json={"username": "SCHOLAR_ALPHA"},
            headers={"Authorization": f"Bearer {g_token}"},
        )
        assert collision_patch.status_code == 400

        own_case_patch = client.patch(
            "/api/users/me",
            json={"username": "Auto_Handle"},
            headers={"Authorization": f"Bearer {g_token}"},
        )
        assert own_case_patch.status_code == 200
        assert own_case_patch.json()["username"] == "Auto_Handle"
        assert own_case_patch.json()["can_set_username"] is False

    def test_reserved_usernames_blocked_even_when_demo_mode_disabled_in_production(
        self, monkeypatch
    ):
        client = TestClient(app)
        monkeypatch.setenv("APP_ENV", "production")
        monkeypatch.setenv("DEMO_USERS_ENABLED", "false")
        monkeypatch.setenv("GOOGLE_CLIENT_ID", "12345-citra.apps.googleusercontent.com")

        for reserved in ("Admin", "TEACHER", "root", "System", "support", "CITRA"):
            r = client.post(
                "/api/auth/register",
                json={
                    "username": reserved,
                    "email": f"{reserved.lower()}@tdtu.edu.vn",
                    "password": "SafePassword123!",
                },
            )
            assert r.status_code == 400, f"Reserved username {reserved} should be blocked"

        # Google user with email admin@gmail.com gets auto-suffixed to admin_1, not "admin"
        monkeypatch.setattr(
            "integrity_checker.api.routes.auth._verify_google_payload",
            lambda req, cid, csec: {
                "sub": "google-sub-admin-email",
                "email": "admin@gmail.com",
                "email_verified": True,
                "name": "Google User",
            },
        )
        g_resp = client.post("/api/auth/google", json={"access_token": "tok"})
        assert g_resp.status_code == 200
        assert g_resp.json()["user"]["username"] == "admin_1"
        g_token = g_resp.json()["token"]

        # Google user cannot rename their handle to "Admin" or "root"
        for reserved in ("Admin", "root", "teacher"):
            patch_r = client.patch(
                "/api/users/me",
                json={"username": reserved},
                headers={"Authorization": f"Bearer {g_token}"},
            )
            assert patch_r.status_code == 400

    def test_malformed_and_boundary_usernames_rejected_and_degenerate_google_emails_sanitized(
        self, monkeypatch
    ):
        client = TestClient(app)
        monkeypatch.setenv("GOOGLE_CLIENT_ID", "12345-citra.apps.googleusercontent.com")
        monkeypatch.setattr(
            "integrity_checker.api.routes.auth._verify_google_payload",
            lambda req, cid, csec: {
                "sub": "google-sub-degenerate-1",
                "email": "...@gmail.com",
                "email_verified": True,
                "name": "!!!",
            },
        )
        # Degenerate Google email local part "...@gmail.com" + symbol-only name -> falls back to "scholar"
        g_resp = client.post("/api/auth/google", json={"access_token": "tok"})
        assert g_resp.status_code == 200
        assert g_resp.json()["user"]["username"] == "scholar"
        g_token = g_resp.json()["token"]

        # Single-char Google email local part "a@gmail.com" with no name -> "user_a"
        monkeypatch.setattr(
            "integrity_checker.api.routes.auth._verify_google_payload",
            lambda req, cid, csec: {
                "sub": "google-sub-degenerate-2",
                "email": "a@gmail.com",
                "email_verified": True,
                "name": "",
            },
        )
        g_resp2 = client.post("/api/auth/google", json={"access_token": "tok"})
        assert g_resp2.status_code == 200
        assert g_resp2.json()["user"]["username"] == "user_a"

        # Malformed usernames must be rejected on both register and PATCH /api/users/me
        malformed_handles = [
            "...",
            "---",
            "___",
            ".scholar",
            "scholar.",
            "-scholar",
            "scholar-",
            "ab..cd",
            "user name",
            "<script>",
        ]
        for bad in malformed_handles:
            reg_r = client.post(
                "/api/auth/register",
                json={
                    "username": bad,
                    "email": "valid_test@tdtu.edu.vn",
                    "password": "SafePassword123!",
                },
            )
            assert reg_r.status_code in (400, 422), f"Expected {bad!r} to fail registration"

            patch_r = client.patch(
                "/api/users/me",
                json={"username": bad},
                headers={"Authorization": f"Bearer {g_token}"},
            )
            assert patch_r.status_code in (400, 422), f"Expected {bad!r} to fail PATCH /api/users/me"

    def test_password_edge_cases_null_byte_whitespace_and_72_byte_utf8_limit(
        self, monkeypatch
    ):
        client = TestClient(app)
        monkeypatch.setenv("GOOGLE_CLIENT_ID", "12345-citra.apps.googleusercontent.com")
        monkeypatch.setattr(
            "integrity_checker.api.routes.auth._verify_google_payload",
            lambda req, cid, csec: {
                "sub": "google-sub-pw-edge",
                "email": "pw_edge@tdtu.edu.vn",
                "email_verified": True,
                "name": "PW Edge",
            },
        )
        g_resp = client.post("/api/auth/google", json={"access_token": "tok"})
        g_token = g_resp.json()["token"]

        # 1. Null-byte password ("Pass\x00word123") -> 400 (never 500 ValueError)
        # 2. Whitespace-only password ("        ") -> 400
        # 3. Multi-byte UTF-8 password > 72 bytes ("Nguyễn Bảo Minh Trường Học " * 3) -> 400 (never 500 ValueError)
        adversarial_passwords = [
            "Pass\x00word123",
            "        ",
            "Nguyễn Bảo Minh Trường Học " * 3,
        ]
        for bad_pw in adversarial_passwords:
            r_reg = client.post(
                "/api/auth/register",
                json={
                    "username": "pw_tester",
                    "email": "pw_tester@tdtu.edu.vn",
                    "password": bad_pw,
                },
            )
            assert r_reg.status_code == 400, f"Expected 400 on register for {bad_pw!r}, got {r_reg.status_code}"

            r_me_pw = client.post(
                "/api/users/me/password",
                json={"new_password": bad_pw},
                headers={"Authorization": f"Bearer {g_token}"},
            )
            assert r_me_pw.status_code == 400, f"Expected 400 on password change for {bad_pw!r}, got {r_me_pw.status_code}"

    def test_google_linked_user_cannot_change_bound_email_and_second_password_requires_current(
        self, monkeypatch
    ):
        client = TestClient(app)
        monkeypatch.setenv("GOOGLE_CLIENT_ID", "12345-citra.apps.googleusercontent.com")
        monkeypatch.setattr(
            "integrity_checker.api.routes.auth._verify_google_payload",
            lambda req, cid, csec: {
                "sub": "google-sub-bound-email",
                "email": "bound_owner@tdtu.edu.vn",
                "email_verified": True,
                "name": "Bound Owner",
            },
        )
        g_resp = client.post("/api/auth/google", json={"access_token": "tok"})
        assert g_resp.status_code == 200
        first_token = g_resp.json()["token"]

        # 1. Google user cannot change their bound email to another address via PATCH /api/users/me
        email_change = client.patch(
            "/api/users/me",
            json={"email": "victim@tdtu.edu.vn"},
            headers={"Authorization": f"Bearer {first_token}"},
        )
        assert email_change.status_code == 400
        assert "google" in email_change.json()["detail"].lower()

        # 2. First password setup without current_password succeeds and invalidates old session token
        pw1 = client.post(
            "/api/users/me/password",
            json={"new_password": "FirstGooglePassword123!"},
            headers={"Authorization": f"Bearer {first_token}"},
        )
        assert pw1.status_code == 200
        second_token = pw1.json()["token"]
        assert second_token and second_token != first_token

        # Old token must be invalidated immediately
        old_me = client.get(
            "/api/users/me",
            headers={"Authorization": f"Bearer {first_token}"},
        )
        assert old_me.status_code == 401

        # 3. Second password change WITHOUT current_password must be rejected (400)
        pw2_no_current = client.post(
            "/api/users/me/password",
            json={"new_password": "HijackAttemptPassword123!"},
            headers={"Authorization": f"Bearer {second_token}"},
        )
        assert pw2_no_current.status_code == 400
        assert "current password" in pw2_no_current.json()["detail"].lower()

        # 4. Second password change WITH current_password succeeds
        pw2_with_current = client.post(
            "/api/users/me/password",
            json={
                "current_password": "FirstGooglePassword123!",
                "new_password": "SecondGooglePassword456!",
            },
            headers={"Authorization": f"Bearer {second_token}"},
        )
        assert pw2_with_current.status_code == 200

    def test_google_welcome_reset_link_upgrades_provider_while_preserving_one_time_username_setup(
        self, monkeypatch
    ):
        client = TestClient(app)
        email_svc = get_email_service()
        email_svc.clear_outbox()

        monkeypatch.setenv("GOOGLE_CLIENT_ID", "12345-citra.apps.googleusercontent.com")
        monkeypatch.setattr(
            "integrity_checker.api.routes.auth._verify_google_payload",
            lambda req, cid, csec: {
                "sub": "google-sub-email-first",
                "email": "email_first@tdtu.edu.vn",
                "email_verified": True,
                "name": "Email First User",
            },
        )
        g_resp = client.post("/api/auth/google", json={"access_token": "tok"})
        assert g_resp.status_code == 200
        welcome_token = email_svc.outbox[-1].token
        assert welcome_token

        # User sets password via the welcome email reset link BEFORE customizing their @username
        reset_resp = client.post(
            "/api/auth/reset-password",
            json={
                "token": welcome_token,
                "new_password": "EmailLinkPassword123!",
            },
        )
        assert reset_resp.status_code == 200

        # Reusing the welcome token a second time is blocked
        reuse_resp = client.post(
            "/api/auth/reset-password",
            json={
                "token": welcome_token,
                "new_password": "AnotherPassword123!",
            },
        )
        assert reuse_resp.status_code == 400

        # User logs in with email + newly set password; can_set_username is STILL True!
        login_resp = client.post(
            "/api/auth/login",
            json={
                "username": "email_first@tdtu.edu.vn",
                "password": "EmailLinkPassword123!",
            },
        )
        assert login_resp.status_code == 200
        user_data = login_resp.json()["user"]
        assert user_data["has_password"] is True
        assert user_data["can_set_username"] is True
        tok = login_resp.json()["token"]

        # User can still customize their @username once
        patch_resp = client.patch(
            "/api/users/me",
            json={"username": "email_first_custom"},
            headers={"Authorization": f"Bearer {tok}"},
        )
        assert patch_resp.status_code == 200
        assert patch_resp.json()["username"] == "email_first_custom"
        assert patch_resp.json()["can_set_username"] is False





