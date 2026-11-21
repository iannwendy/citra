"""Track 3 TDD Regression Suite: Auth Security, Billing/VNPay/Quota, SQLite FK/PostgreSQL & Worker Startup."""

from __future__ import annotations

import subprocess
import sys
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.dialects import postgresql
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker

from integrity_checker.api.main import app, create_app
from integrity_checker.api.services.email_service import get_email_service
from integrity_checker.billing.plans import ensure_user_quota_current, get_user_plan_policy
from integrity_checker.billing.vnpay import (
    VNPAY_DEFAULT_HASH_SECRET,
    VNPayService,
    validate_vnpay_production_secret,
)
from integrity_checker.config import Settings, get_settings
from integrity_checker.db.migrations import LATEST_SCHEMA_VERSION, run_migrations
from integrity_checker.db.models import (
    ApiKey,
    AuditLog,
    AuthToken,
    Base,
    BillingTransaction,
    CitationRecord,
    Class,
    ClassMembership,
    EssayRecord,
    PromoCode,
    PromoRedemption,
    User,
    VerdictRecord,
)
from integrity_checker.db.models import Session as SessionModel
from integrity_checker.db.repository import Repository
from integrity_checker.db.session import get_engine, get_session


@pytest.fixture(autouse=True)
def clean_track3_db():
    """Reset in-memory DB state and email outbox around every test."""
    email_svc = get_email_service()
    email_svc.clear_outbox()
    session = get_session()
    try:
        session.query(PromoRedemption).delete()
        session.query(PromoCode).delete()
        session.query(BillingTransaction).delete()
        session.query(AuditLog).delete()
        session.query(VerdictRecord).delete()
        session.query(CitationRecord).delete()
        session.query(EssayRecord).delete()
        session.query(ClassMembership).delete()
        session.query(Class).delete()
        session.query(ApiKey).delete()
        session.query(AuthToken).delete()
        session.query(SessionModel).delete()
        session.query(User).delete()
        session.commit()
    finally:
        session.close()
    yield
    email_svc.clear_outbox()


def test_oauth_pre_hijacking_unverified_local_account_clears_password_and_revokes_credentials(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Google OAuth against a pre-registered unverified email must wipe password_hash,
    set auth_provider='google', and revoke any prior Sessions, ApiKeys, and AuthTokens."""
    client = TestClient(app)
    monkeypatch.setenv("GOOGLE_CLIENT_ID", "12345-citra.apps.googleusercontent.com")

    # 1. Attacker pre-registers victim@uni.edu.vn without verifying email
    reg = client.post(
        "/api/auth/register",
        json={
            "username": "victim_handle",
            "email": "victim@uni.edu.vn",
            "password": "EvilPassword1!",
            "privacy_consent": True,
        },
    )
    assert reg.status_code == 200
    attacker_activation_tok = get_email_service().outbox[-1].token
    assert attacker_activation_tok is not None

    # Simulate an existing pre-hijack session & API key attached to that unverified user row
    session = get_session()
    try:
        repo = Repository(session)
        unverified_user = repo.get_user_by_email("victim@uni.edu.vn")
        assert unverified_user is not None
        assert bool(unverified_user.email_verified) is False
        hijack_jwt = "pre_hijack_session_token"
        repo.create_session(
            unverified_user.id,
            hijack_jwt,
            datetime.now(UTC) + timedelta(hours=12),
        )
        raw_api_key, _ = repo.create_api_key(unverified_user.id, "Attacker Backdoor Key")
        session.commit()
    finally:
        session.close()

    # 2. Real victim signs in via Google OAuth
    monkeypatch.setattr(
        "integrity_checker.api.routes.auth._verify_google_payload",
        lambda req, cid, csec: {
            "sub": "google-victim-sub-001",
            "email": "victim@uni.edu.vn",
            "email_verified": True,
            "name": "Real Victim Scholar",
        },
    )
    g_resp = client.post("/api/auth/google", json={"credential": "valid_google_id_token"})
    assert g_resp.status_code == 200, g_resp.text
    g_user = g_resp.json()["user"]
    assert g_user["auth_provider"] == "google"
    assert g_user["has_password"] is False
    assert g_user["email_verified"] is True
    assert g_user["is_active"] is True

    # 3. Attacker's password MUST fail with 401, and prior session / API key / activation token must fail
    attacker_login = client.post(
        "/api/auth/login",
        json={"username": "victim_handle", "password": "EvilPassword1!"},
    )
    assert attacker_login.status_code == 401

    attacker_email_login = client.post(
        "/api/auth/login",
        json={"username": "victim@uni.edu.vn", "password": "EvilPassword1!"},
    )
    assert attacker_email_login.status_code == 401

    api_key_probe = client.get("/api/auth/me", headers={"X-API-Key": raw_api_key})
    assert api_key_probe.status_code == 401

    old_tok_probe = client.post("/api/auth/activate", json={"token": attacker_activation_tok})
    assert old_tok_probe.status_code == 400

    check_sess = get_session()
    try:
        db_user = Repository(check_sess).get_user_by_email("victim@uni.edu.vn")
        assert db_user is not None
        assert db_user.password_hash == ""
        assert db_user.auth_provider == "google"
        assert (
            check_sess.query(SessionModel)
            .filter(SessionModel.token == hijack_jwt)
            .count()
            == 0
        )
        assert check_sess.query(ApiKey).filter(ApiKey.user_id == db_user.id).count() == 0
    finally:
        check_sess.close()

    # 4. Companion invariant: an ALREADY verified local user keeps 'local,google' & password
    get_email_service().clear_outbox()
    reg_v = client.post(
        "/api/auth/register",
        json={
            "username": "verified_local",
            "email": "verified_local@uni.edu.vn",
            "password": "MyVerifiedPassword1!",
            "privacy_consent": True,
        },
    )
    assert reg_v.status_code == 200
    v_tok = get_email_service().outbox[-1].token
    assert client.post("/api/auth/activate", json={"token": v_tok}).status_code == 200

    monkeypatch.setattr(
        "integrity_checker.api.routes.auth._verify_google_payload",
        lambda req, cid, csec: {
            "sub": "google-verified-sub-002",
            "email": "verified_local@uni.edu.vn",
            "email_verified": True,
            "name": "Verified Local Scholar",
        },
    )
    g_verified = client.post("/api/auth/google", json={"credential": "valid_tok_2"})
    assert g_verified.status_code == 200
    assert g_verified.json()["user"]["auth_provider"] == "local,google"
    assert (
        client.post(
            "/api/auth/login",
            json={"username": "verified_local", "password": "MyVerifiedPassword1!"},
        ).status_code
        == 200
    )


def test_email_change_revokes_other_sessions_and_google_claim_revokes_changer(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Changing email via PATCH /api/users/me revokes other active sessions immediately,
    and if the target email's Google owner signs in before activation, the changer loses all access."""
    client = TestClient(app)
    monkeypatch.setenv("GOOGLE_CLIENT_ID", "12345-citra.apps.googleusercontent.com")

    reg = client.post(
        "/api/auth/register",
        json={
            "username": "changer_user",
            "email": "changer@uni.edu.vn",
            "password": "ChangerPass123!",
            "privacy_consent": True,
        },
    )
    assert reg.status_code == 200
    act_tok = get_email_service().outbox[-1].token
    assert client.post("/api/auth/activate", json={"token": act_tok}).status_code == 200

    tok_other = client.post(
        "/api/auth/login",
        json={"username": "changer_user", "password": "ChangerPass123!"},
    ).json()["token"]
    tok_current = client.post(
        "/api/auth/login",
        json={"username": "changer_user", "password": "ChangerPass123!"},
    ).json()["token"]
    assert tok_other != tok_current

    patch_resp = client.patch(
        "/api/users/me",
        json={"email": "real_prof@uni.edu.vn"},
        headers={"Authorization": f"Bearer {tok_current}"},
    )
    assert patch_resp.status_code == 200
    assert patch_resp.json()["email_verified"] is False

    # Other session is immediately revoked; current session remains active pending verification
    assert (
        client.get("/api/users/me", headers={"Authorization": f"Bearer {tok_other}"}).status_code
        == 401
    )
    assert (
        client.get("/api/users/me", headers={"Authorization": f"Bearer {tok_current}"}).status_code
        == 200
    )

    # Real Google owner of real_prof@uni.edu.vn signs in -> changer's remaining session & password revoked!
    monkeypatch.setattr(
        "integrity_checker.api.routes.auth._verify_google_payload",
        lambda req, cid, csec: {
            "sub": "google-real-prof-999",
            "email": "real_prof@uni.edu.vn",
            "email_verified": True,
            "name": "Prof Real Owner",
        },
    )
    g_claim = client.post("/api/auth/google", json={"credential": "prof_id_token"})
    assert g_claim.status_code == 200
    assert (
        client.get("/api/users/me", headers={"Authorization": f"Bearer {tok_current}"}).status_code
        == 401
    )
    assert (
        client.post(
            "/api/auth/login",
            json={"username": "changer_user", "password": "ChangerPass123!"},
        ).status_code
        == 401
    )


def test_spoofed_xff_rate_limiting_uniform_resend_and_google_disabled_sentinel(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Verify X-Forwarded-For spoofing does not bypass rate limits when X-Real-IP or client host
    is fixed, /register & /resend-activation & /forgot-password enforce rate limits,
    /resend-activation is non-enumerating, and GOOGLE_CLIENT_ID='disabled' disables OAuth."""
    from integrity_checker.api.routes import auth as auth_mod

    auth_mod._login_rate_limiter.clear_all()
    monkeypatch.setattr(auth_mod._login_rate_limiter, "enforce_in_tests", True)
    monkeypatch.setattr(auth_mod._login_rate_limiter, "max_attempts", 3)

    client = TestClient(app)
    try:
        # 1. Spoofing X-Forwarded-For behind Nginx (fixed X-Real-IP) MUST hit 429 on 4th attempt
        for i in range(3):
            r = client.post(
                "/api/auth/login",
                json={"username": "target_scholar", "password": "wrong"},
                headers={
                    "X-Real-IP": "203.0.113.55",
                    "X-Forwarded-For": f"10.20.30.{i + 1}, 203.0.113.55",
                },
            )
            assert r.status_code == 401

        r_blocked = client.post(
            "/api/auth/login",
            json={"username": "target_scholar", "password": "wrong"},
            headers={
                "X-Real-IP": "203.0.113.55",
                "X-Forwarded-For": "10.20.30.250, 203.0.113.55",
            },
        )
        assert r_blocked.status_code == 429

        # Direct public client (untrusted peer) spoofing X-Forwarded-For MUST also hit 429
        direct_client = TestClient(app, client=("198.51.100.88", 54321))
        for i in range(3):
            rd = direct_client.post(
                "/api/auth/login",
                json={"username": "direct_target", "password": "wrong"},
                headers={"X-Forwarded-For": f"1.2.3.{i + 1}"},
            )
            assert rd.status_code == 401
        rd_blocked = direct_client.post(
            "/api/auth/login",
            json={"username": "direct_target", "password": "wrong"},
            headers={"X-Forwarded-For": "9.9.9.9"},
        )
        assert rd_blocked.status_code == 429
    finally:
        auth_mod._login_rate_limiter.clear_all()

    # 2. Uniform non-enumerating response on /api/auth/resend-activation
    monkeypatch.setattr(auth_mod._login_rate_limiter, "enforce_in_tests", False)
    email_svc = get_email_service()
    email_svc.clear_outbox()

    # Unknown user -> 200 (not 404!), 0 emails sent
    unknown_resend = client.post(
        "/api/auth/resend-activation",
        json={"identifier": "nonexistent_person@uni.edu.vn"},
    )
    assert unknown_resend.status_code == 200
    assert len(email_svc.outbox) == 0

    # Pending user -> 200 with identical message, 1 email sent
    client.post(
        "/api/auth/register",
        json={
            "username": "pending_u",
            "email": "pending_u@uni.edu.vn",
            "password": "Password123!",
            "privacy_consent": True,
        },
    )
    email_svc.clear_outbox()
    pending_resend = client.post(
        "/api/auth/resend-activation",
        json={"identifier": "pending_u@uni.edu.vn"},
    )
    assert pending_resend.status_code == 200
    assert pending_resend.json()["message"] == unknown_resend.json()["message"]
    assert len(email_svc.outbox) == 1

    # Activate user, then resend again -> uniform 200 with identical message, 0 emails sent
    act_tok = email_svc.outbox[-1].token
    assert client.post("/api/auth/activate", json={"token": act_tok}).status_code == 200
    email_svc.clear_outbox()
    active_resend = client.post(
        "/api/auth/resend-activation",
        json={"identifier": "pending_u@uni.edu.vn"},
    )
    assert active_resend.status_code == 200
    assert active_resend.json()["message"] == unknown_resend.json()["message"]
    assert len(email_svc.outbox) == 0

    # 3. Rate limiting on /register, /resend-activation, and /forgot-password
    monkeypatch.setattr(auth_mod._login_rate_limiter, "enforce_in_tests", True)
    try:
        reg_statuses = [
            client.post(
                "/api/auth/register",
                json={
                    "username": f"spam_u_{idx}",
                    "email": f"spam_{idx}@uni.edu.vn",
                    "password": "Password123!",
                    "privacy_consent": True,
                },
                headers={"X-Real-IP": "198.51.100.201"},
            ).status_code
            for idx in range(8)
        ]
        assert 429 in reg_statuses

        resend_statuses = [
            client.post(
                "/api/auth/resend-activation",
                json={"identifier": "anyone@uni.edu.vn"},
                headers={"X-Real-IP": "198.51.100.202"},
            ).status_code
            for _ in range(8)
        ]
        assert 429 in resend_statuses

        forgot_statuses = [
            client.post(
                "/api/auth/forgot-password",
                json={"email": "anyone@uni.edu.vn"},
                headers={"X-Real-IP": "198.51.100.203"},
            ).status_code
            for _ in range(8)
        ]
        assert 429 in forgot_statuses
    finally:
        auth_mod._login_rate_limiter.clear_all()
        monkeypatch.setattr(auth_mod._login_rate_limiter, "enforce_in_tests", False)

    # 4. GOOGLE_CLIENT_ID="disabled" disables OAuth even outside test runtime
    monkeypatch.setenv("GOOGLE_CLIENT_ID", "disabled")
    with patch("integrity_checker.api.routes.auth.is_test_runtime", return_value=False):
        g_cfg = client.get("/api/auth/google/config")
        assert g_cfg.status_code == 200
        assert g_cfg.json() == {"enabled": False, "client_id": None}
        g_post = client.post("/api/auth/google", json={"access_token": "tok"})
        assert g_post.status_code == 503


def test_vnpay_production_secret_enforced_unconditionally_and_return_url_allowlisted(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """In production, missing or default VNPAY_HASH_SECRET must be rejected even when
    VNPAY_EXTERNAL_REDIRECT=false across create-payment-url, verify-return, return, and IPN,
    and external untrusted return_url origins must be blocked."""
    client = TestClient(app)
    login_resp = client.post("/api/auth/login", json={"username": "user", "password": "user123"})
    assert login_resp.status_code == 200
    token = login_resp.json()["token"]
    headers = {"Authorization": f"Bearer {token}"}

    checkout = client.post(
        "/api/billing/create-checkout-session",
        json={"plan_tier": "pro", "billing_cycle": "monthly", "force_demo": True},
        headers=headers,
    ).json()
    session_id = checkout["session_id"]

    # Initialize a txn_ref in dev first so we can test forged ReturnURL & IPN attacks in prod
    monkeypatch.setenv("FRONTEND_URL", "https://citra.io.vn")
    dev_url_resp = client.post(
        "/api/billing/vnpay/create-payment-url",
        json={"session_id": session_id, "bank_code": "NCB"},
        headers=headers,
    )
    assert dev_url_resp.status_code == 200
    txn_ref = dev_url_resp.json()["vnp_txn_ref"]

    # External untrusted return_url must be rejected (400)
    for evil_url in (
        "https://evil.attacker.com/callback",
        "https://evil.attacker.com@citra.io.vn/billing/success",
        "javascript:alert(1)",
    ):
        bad_ret = client.post(
            "/api/billing/vnpay/create-payment-url",
            json={"session_id": session_id, "bank_code": "NCB", "return_url": evil_url},
            headers=headers,
        )
        assert bad_ret.status_code == 400, f"Expected 400 for untrusted return_url={evil_url!r}"

    # Trusted FRONTEND_URL origin succeeds
    good_ret = client.post(
        "/api/billing/vnpay/create-payment-url",
        json={
            "session_id": session_id,
            "bank_code": "NCB",
            "return_url": f"https://citra.io.vn/billing/success?session_id={session_id}",
        },
        headers=headers,
    )
    assert good_ret.status_code == 200

    # Craft callback params signed with the publicly-known VNPAY_DEFAULT_HASH_SECRET
    forged_params = VNPayService(hash_secret=VNPAY_DEFAULT_HASH_SECRET).build_signed_return_params(
        vnp_txn_ref=txn_ref,
        amount_vnd=500000,
        response_code="00",
    )

    # Switch to production with VNPAY_EXTERNAL_REDIRECT=false and default/missing secret
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("VNPAY_EXTERNAL_REDIRECT", "false")

    for bad_secret in ("", VNPAY_DEFAULT_HASH_SECRET):
        if bad_secret:
            monkeypatch.setenv("VNPAY_HASH_SECRET", bad_secret)
        else:
            monkeypatch.delenv("VNPAY_HASH_SECRET", raising=False)

        with pytest.raises(ValueError, match="VNPAY_HASH_SECRET"):
            validate_vnpay_production_secret("production")

        with patch("integrity_checker.api.routes.billing.is_test_runtime", return_value=False):
            create_prod = client.post(
                "/api/billing/vnpay/create-payment-url",
                json={"session_id": session_id, "bank_code": "NCB"},
                headers=headers,
            )
            assert create_prod.status_code >= 400

            verify_prod = client.post(
                "/api/billing/vnpay/verify-return",
                json={"session_id": session_id, "vnp_params": forged_params},
                headers=headers,
            )
            assert verify_prod.status_code >= 400

            get_ret_prod = client.get(
                "/api/billing/vnpay/return",
                params=forged_params,
                follow_redirects=False,
            )
            assert get_ret_prod.status_code == 302
            assert "canceled=1" in get_ret_prod.headers["location"]

            ipn_prod = client.get("/api/billing/vnpay/ipn", params=forged_params)
            assert ipn_prod.status_code == 200
            assert ipn_prod.json()["RspCode"] != "00"

    # Confirm user was NEVER upgraded to pro
    me_after = client.get("/api/users/me", headers=headers)
    assert me_after.json()["plan_tier"] == "basic"


def test_ensure_user_quota_current_expires_paid_plan_when_cancel_at_period_end_is_zero() -> None:
    """Paid subscriptions (e.g. one-time VNPay) must downgrade to basic once now >= current_period_end
    even when cancel_at_period_end == 0."""
    expired_user = User(
        username="expired_vnpay_student",
        password_hash="hashed",
        role="user",
        plan_tier="pro",
        billing_cycle="monthly",
        subscription_status="active",
        cancel_at_period_end=0,
        current_period_start=datetime.now(UTC) - timedelta(days=35),
        current_period_end=datetime.now(UTC) - timedelta(minutes=5),
        monthly_uploads_used=12,
        quota_reset_at=datetime.now(UTC) + timedelta(days=10),
    )
    # Effective policy immediately reflects basic even before mutation
    assert get_user_plan_policy(expired_user).tier == "basic"

    mutated = ensure_user_quota_current(expired_user)
    assert mutated is True
    assert expired_user.plan_tier == "basic"
    assert expired_user.billing_cycle is None
    assert expired_user.subscription_status in ("expired", "canceled")

    # MagicMock / duck-typed test user objects without real datetime attributes must not raise TypeError
    mock_user = MagicMock(id=1)
    assert get_user_plan_policy(mock_user).tier == "basic"
    assert isinstance(ensure_user_quota_current(mock_user), bool)


def test_vip100_promo_waiver_succeeds_in_production_and_atomic_per_user_redemption(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """VIP100 (100% promo waiver) must return mode='promo_waiver' and upgrade cleanly in production
    without hitting stripe_demo 403, and concurrent redemptions must enforce max_uses_per_user=1 atomically."""
    # Use a file-backed SQLite DB so multi-threaded verify-session calls share real connections
    db_file = tmp_path / "promo_race.db"
    engine = create_engine(
        f"sqlite:///{db_file}",
        connect_args={"check_same_thread": False, "timeout": 30},
    )
    Base.metadata.create_all(bind=engine)
    run_migrations(engine)
    SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)

    from integrity_checker.api.deps import get_db

    def _override_db():
        s = SessionLocal()
        try:
            yield s
        finally:
            s.close()

    app.dependency_overrides[get_db] = _override_db
    try:
        client = TestClient(app)
        admin_tok = client.post(
            "/api/auth/login", json={"username": "admin", "password": "admin123"}
        ).json()["token"]
        user_tok = client.post(
            "/api/auth/login", json={"username": "user", "password": "user123"}
        ).json()["token"]
        admin_headers = {"Authorization": f"Bearer {admin_tok}"}
        user_headers = {"Authorization": f"Bearer {user_tok}"}

        # Seed VIP100 (100% off Pro Monthly, max_uses=50, max_uses_per_user=1)
        create_promo = client.post(
            "/api/billing/admin/promos",
            json={
                "code": "VIP100",
                "description": "100% Fellowship Waiver",
                "discount_type": "percent",
                "discount_value": 100.0,
                "max_discount_usd": 20.0,
                "applicable_tiers": "pro",
                "applicable_cycles": "monthly",
                "max_uses": 50,
                "max_uses_per_user": 1,
            },
            headers=admin_headers,
        )
        assert create_promo.status_code == 201

        # Create 4 pending sessions BEFORE redeeming so we can race them concurrently in production!
        monkeypatch.setenv("APP_ENV", "production")
        monkeypatch.delenv("ALLOW_DEMO_CHECKOUT_IN_PROD", raising=False)
        monkeypatch.delenv("STRIPE_SECRET_KEY", raising=False)

        with patch("integrity_checker.api.routes.billing.is_test_runtime", return_value=False):
            session_ids: list[str] = []
            for _ in range(4):
                cs = client.post(
                    "/api/billing/create-checkout-session",
                    json={"plan_tier": "pro", "billing_cycle": "monthly", "promo_code": "VIP100"},
                    headers=user_headers,
                )
                assert cs.status_code == 200, cs.text
                body = cs.json()
                assert body["mode"] == "promo_waiver"
                assert body["amount_usd"] == 0.0
                session_ids.append(body["session_id"])

            barrier = threading.Barrier(len(session_ids))

            def _verify_one(sid: str) -> int:
                local_client = TestClient(app)
                barrier.wait(timeout=5.0)
                r = local_client.post(
                    "/api/billing/verify-session",
                    json={"session_id": sid, "card_brand": "promo_waiver", "card_last4": "FREE"},
                    headers=user_headers,
                )
                return r.status_code

            with ThreadPoolExecutor(max_workers=len(session_ids)) as pool:
                statuses = list(pool.map(_verify_one, session_ids))

        assert statuses.count(200) == 1, f"Expected exactly 1 success in race, got {statuses}"
        assert statuses.count(400) == len(session_ids) - 1

        me_resp = client.get("/api/users/me", headers=user_headers)
        assert me_resp.json()["plan_tier"] == "pro"

        with SessionLocal() as check_s:
            redemptions = check_s.query(PromoRedemption).filter(PromoRedemption.code == "VIP100").count()
            promo_row = check_s.query(PromoCode).filter(PromoCode.code == "VIP100").one()
            assert redemptions == 1
            assert promo_row.used_count == 1
    finally:
        app.dependency_overrides.pop(get_db, None)
        engine.dispose()


def test_sqlite_foreign_keys_on_cascades_essay_children_with_zero_orphans(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """PRAGMA foreign_keys=ON must be active on SQLite connections so deleting an EssayRecord
    cascades CitationRecord, VerdictRecord, and AuditLog rows with 0 orphans."""
    import integrity_checker.db.session as session_mod

    # 1. Default in-memory test engine must have foreign_keys=1
    mem_engine = get_engine()
    with mem_engine.connect() as conn:
        assert int(conn.execute(text("PRAGMA foreign_keys")).scalar_one()) == 1

    # 2. File-backed engine via get_engine() must also have foreign_keys=1 and cascade deletes
    prev_engine = session_mod._engine
    prev_url = session_mod._engine_url
    prev_session_local = session_mod._SessionLocal
    fk_db = tmp_path / "fk_cascade.db"
    try:
        monkeypatch.setenv("DATABASE_URL", f"sqlite:///{fk_db}")
        get_settings.cache_clear()
        session_mod._engine = None
        session_mod._engine_url = None
        session_mod._SessionLocal = None

        s = session_mod.get_session()
        try:
            fk_flag = s.execute(text("PRAGMA foreign_keys")).scalar_one()
            assert int(fk_flag) == 1

            essay = EssayRecord(filename="cascade_me.pdf", num_pages=3)
            s.add(essay)
            s.flush()
            cit = CitationRecord(essay_id=essay.id, raw_text="[1] Test Citation")
            verdict = VerdictRecord(
                essay_id=essay.id,
                citation_raw="[1] Test Citation",
                label="verified",
                confidence=0.95,
            )
            s.add_all([cit, verdict])
            s.flush()
            audit = AuditLog(
                verdict_id=verdict.id,
                original_label="verified",
                new_label="metadata_error",
                user="teacher",
            )
            s.add(audit)
            s.commit()
            eid, vid = essay.id, verdict.id

            # ORM delete on EssayRecord relies on passive_deletes=True -> DB ON DELETE CASCADE!
            s.delete(essay)
            s.commit()

            assert s.query(CitationRecord).filter(CitationRecord.essay_id == eid).count() == 0
            assert s.query(VerdictRecord).filter(VerdictRecord.essay_id == eid).count() == 0
            assert s.query(AuditLog).filter(AuditLog.verdict_id == vid).count() == 0
        finally:
            s.close()
    finally:
        if session_mod._engine is not None and session_mod._engine is not prev_engine:
            session_mod._engine.dispose()
        session_mod._engine = prev_engine
        session_mod._engine_url = prev_url
        session_mod._SessionLocal = prev_session_local
        get_settings.cache_clear()


def test_migration_0012_scopes_class_uniqueness_per_teacher_and_postgres_int_coercion(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Migration 0012 replaces global classes.name uniqueness with uq_classes_teacher_name,
    and integer flag columns coerce bool -> int with pool_pre_ping=True for PostgreSQL."""
    assert LATEST_SCHEMA_VERSION == "0013"

    # Simulate an existing pre-0012 SQLite DB where classes had inline UNIQUE (name)
    legacy_db = tmp_path / "pre_0012.db"
    engine = create_engine(f"sqlite:///{legacy_db}")
    try:
        with engine.begin() as conn:
            conn.exec_driver_sql(
                "CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username VARCHAR(50) NOT NULL, "
                "password_hash VARCHAR(255) NOT NULL, role VARCHAR(20) DEFAULT 'user', created_at DATETIME, updated_at DATETIME)"
            )
            conn.exec_driver_sql(
                "CREATE TABLE classes (id INTEGER PRIMARY KEY AUTOINCREMENT, name VARCHAR(120) NOT NULL UNIQUE, "
                "description TEXT, teacher_id INTEGER NOT NULL, created_at DATETIME, updated_at DATETIME)"
            )
            conn.exec_driver_sql(
                "CREATE TABLE essays (id INTEGER PRIMARY KEY AUTOINCREMENT, filename VARCHAR NOT NULL, "
                "num_pages INTEGER DEFAULT 0, uploaded_at DATETIME, user_id INTEGER, style_profile_json TEXT, cis_json TEXT)"
            )
            conn.exec_driver_sql(
                "CREATE TABLE citations (id INTEGER PRIMARY KEY AUTOINCREMENT, essay_id INTEGER NOT NULL, "
                "raw_text TEXT NOT NULL, citation_type VARCHAR)"
            )
            conn.exec_driver_sql(
                "CREATE TABLE verdicts (id INTEGER PRIMARY KEY AUTOINCREMENT, essay_id INTEGER NOT NULL, "
                "citation_raw TEXT NOT NULL, label VARCHAR NOT NULL, is_overridden INTEGER DEFAULT 0)"
            )
            conn.exec_driver_sql(
                "CREATE TABLE audit_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, verdict_id INTEGER NOT NULL, original_label VARCHAR NOT NULL, new_label VARCHAR NOT NULL, user VARCHAR NOT NULL, logged_at DATETIME)"
            )
            conn.exec_driver_sql(
                "CREATE TABLE promo_redemptions (id INTEGER PRIMARY KEY AUTOINCREMENT, promo_code_id INTEGER NOT NULL, user_id INTEGER NOT NULL, transaction_id INTEGER NOT NULL, code VARCHAR(6) NOT NULL, discount_usd FLOAT NOT NULL)"
            )
            conn.exec_driver_sql(
                "INSERT INTO users (id, username, password_hash, role) VALUES "
                "(1, 'teacher_a', 'h', 'teacher'), (2, 'teacher_b', 'h', 'teacher')"
            )
            conn.exec_driver_sql(
                "INSERT INTO classes (id, name, teacher_id) VALUES (1, 'Graduation Thesis', 1)"
            )

        applied = run_migrations(engine)
        assert "0012" in applied

        uqs = inspect(engine).get_unique_constraints("classes")
        assert any(
            uq.get("name") == "uq_classes_teacher_name"
            and list(uq.get("column_names") or []) == ["teacher_id", "name"]
            for uq in uqs
        )

        with SessionModel.metadata.bind if False else sessionmaker(bind=engine)() as s:
            # Teacher 2 CAN create a class with the exact same name "Graduation Thesis"
            c2 = Class(name="Graduation Thesis", teacher_id=2, join_code="CITRA-2002")
            s.add(c2)
            s.commit()
            assert c2.id is not None

            # Teacher 1 CANNOT create a duplicate "Graduation Thesis"
            s.add(Class(name="Graduation Thesis", teacher_id=1, join_code="CITRA-2003"))
            with pytest.raises(IntegrityError):
                s.commit()
            s.rollback()
    finally:
        engine.dispose()

    # Verify PostgreSQL dialect bind processors coerce Python bool -> int (not bool!)
    pg_dialect = postgresql.dialect()
    flag_cols = [
        User.__table__.c.is_active,
        User.__table__.c.can_override_verdicts,
        User.__table__.c.email_verified,
        User.__table__.c.username_customized,
        User.__table__.c.google_onboarded,
        User.__table__.c.cancel_at_period_end,
        ApiKey.__table__.c.is_active,
        VerdictRecord.__table__.c.domain_exception,
        VerdictRecord.__table__.c.is_overridden,
        PromoCode.__table__.c.is_active,
    ]
    for col in flag_cols:
        bp = col.type.bind_processor(pg_dialect)
        assert bp is not None, f"Column {col} missing PostgreSQL bool->int bind processor"
        res_true = bp(True)
        res_false = bp(False)
        assert res_true == 1 and type(res_true) is int, f"{col} bound True as {res_true!r}"
        assert res_false == 0 and type(res_false) is int, f"{col} bound False as {res_false!r}"

    # Verify get_engine() sets pool_pre_ping=True for PostgreSQL URLs
    import integrity_checker.db.session as session_mod

    captured_kwargs: dict = {}

    def _fake_create_engine(url: str, **kw):
        captured_kwargs["url"] = url
        captured_kwargs.update(kw)
        return MagicMock()

    prev_engine = session_mod._engine
    prev_url = session_mod._engine_url
    try:
        monkeypatch.setenv("DATABASE_URL", "postgresql://citra:secret@localhost:5432/citra")
        get_settings.cache_clear()
        session_mod._engine = None
        session_mod._engine_url = None
        with patch.object(session_mod, "create_engine", side_effect=_fake_create_engine):
            session_mod.get_engine()
        assert captured_kwargs.get("pool_pre_ping") is True
    finally:
        session_mod._engine = prev_engine
        session_mod._engine_url = prev_url
        get_settings.cache_clear()


@pytest.mark.asyncio
async def test_worker_import_does_not_load_main_app_and_refreshes_job_heartbeat(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Importing integrity_checker.api.deps or integrity_checker.worker must NOT import
    integrity_checker.api.main or spawn _startup_background_maintenance, create_app() in
    worker_only mode must NOT spawn maintenance, and worker refreshes job_heartbeat_at."""
    # 1. Fresh Python subprocess check for import-time cleanliness
    import asyncio

    probe = await asyncio.to_thread(
        subprocess.run,
        [
            sys.executable,
            "-c",
            (
                "import os, sys; "
                "os.environ['CITRA_WORKER_MODE'] = 'worker_only'; "
                "import integrity_checker.api.deps, integrity_checker.worker; "
                "assert 'integrity_checker.api.main' not in sys.modules, "
                "f'api.main eagerly loaded: {list(sys.modules)}'"
            ),
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    assert probe.returncode == 0, f"Subprocess failed: {probe.stderr or probe.stdout}"

    # 2. create_app() with CITRA_WORKER_MODE='worker_only' MUST NOT spawn _startup_background_maintenance
    spawned = threading.Event()
    with monkeypatch.context() as mp:
        mp.setattr("integrity_checker.api.main.init_db", lambda: None)
        mp.setattr("integrity_checker.api.main.is_test_runtime", lambda: False)
        mp.setattr(
            "integrity_checker.api.job_recovery.recover_orphaned_essay_jobs",
            lambda *_a, **_kw: spawned.set() or {"rescheduled": 0, "failed": 0, "refunded": 0},
        )
        mp.setenv("CITRA_WORKER_MODE", "worker_only")
        create_app()
        assert not spawned.wait(timeout=0.15)

    # 3. Periodic job_heartbeat_at helper & worker loop heartbeat refresh
    from integrity_checker.api.job_recovery import refresh_job_heartbeat
    from integrity_checker.worker import run_worker_loop

    hb_db = tmp_path / "heartbeat.db"
    engine = create_engine(
        f"sqlite:///{hb_db}",
        connect_args={"check_same_thread": False, "timeout": 30},
    )
    Base.metadata.create_all(bind=engine)
    run_migrations(engine)
    SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    uploads_dir = tmp_path / "uploads"
    uploads_dir.mkdir(parents=True, exist_ok=True)

    old_hb = datetime.now(UTC).replace(tzinfo=None) - timedelta(minutes=10)
    with SessionLocal() as s:
        u = User(username="hb_u", password_hash="h", role="user", is_active=1, email_verified=1)
        s.add(u)
        s.flush()
        e = EssayRecord(
            filename="long_thesis.pdf",
            num_pages=20,
            user_id=u.id,
            job_status="processing",
            job_heartbeat_at=old_hb,
        )
        s.add(e)
        s.commit()
        eid = e.id

    assert refresh_job_heartbeat(eid, session_factory=SessionLocal) is True
    with SessionLocal() as s:
        updated_hb = s.get(EssayRecord, eid).job_heartbeat_at
        assert updated_hb is not None and updated_hb > old_hb

    # Also verify run_worker_loop refreshes heartbeat while _run_pipeline_task runs
    with SessionLocal() as s:
        e_row = s.get(EssayRecord, eid)
        e_row.job_status = "queued"
        s.commit()
    (uploads_dir / f"{eid}.pdf").write_bytes(b"%PDF-1.4 dummy")

    observed_heartbeats: list[datetime] = []

    async def _slow_pipeline_task(essay_id: int, *_args, **_kwargs) -> None:
        import asyncio

        with SessionLocal() as s:
            observed_heartbeats.append(s.get(EssayRecord, essay_id).job_heartbeat_at)
        await asyncio.sleep(0.08)
        with SessionLocal() as s:
            observed_heartbeats.append(s.get(EssayRecord, essay_id).job_heartbeat_at)
            row = s.get(EssayRecord, essay_id)
            row.job_status = "completed"
            row.cis_json = '{"score": 95.0}'
            s.commit()

    try:
        with patch(
            "integrity_checker.api.routes.essays._run_pipeline_task",
            side_effect=_slow_pipeline_task,
        ):
            stats = await run_worker_loop(
                pipeline_factory=lambda: SimpleNamespace(),  # type: ignore[return-value]
                session_factory=SessionLocal,
                uploads_dir=uploads_dir,
                poll_interval=0.01,
                max_iterations=1,
                recover_on_startup=False,
                heartbeat_interval=0.02,
            )
        assert stats["processed"] == 1
        assert len(observed_heartbeats) == 2
        assert observed_heartbeats[1] > observed_heartbeats[0]
    finally:
        engine.dispose()


def test_config_wires_data_dir_cache_dir_config_file_and_thresholds(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """DATA_DIR, CACHE_DIR, CONFIG_FILE, and threshold env vars in .env.example map into Settings."""
    custom_cfg = tmp_path / "custom_config.yaml"
    custom_cfg.write_text("app:\n  name: Custom CITRA\n", encoding="utf-8")

    monkeypatch.setenv("DATA_DIR", str(tmp_path / "custom_data"))
    monkeypatch.setenv("CACHE_DIR", str(tmp_path / "custom_cache"))
    monkeypatch.setenv("CONFIG_FILE", str(custom_cfg))
    monkeypatch.setenv("ABSTENTION_LOW", "0.35")
    monkeypatch.setenv("ABSTENTION_HIGH", "0.65")
    monkeypatch.setenv("TITLE_SIM_VERIFIED", "0.92")
    monkeypatch.setenv("TITLE_SIM_METADATA_ERROR", "0.58")

    get_settings.cache_clear()
    try:
        settings = get_settings()
        assert settings.app.name == "Custom CITRA"
        assert settings.config_file == custom_cfg
        assert settings.paths.data_dir == tmp_path / "custom_data"
        assert settings.paths.cache_dir == tmp_path / "custom_cache"
        assert settings.logic.abstention_low == pytest.approx(0.35)
        assert settings.logic.abstention_high == pytest.approx(0.65)
        assert settings.matching.title_sim_verified == pytest.approx(0.92)
        assert settings.matching.title_sim_metadata_error == pytest.approx(0.58)
    finally:
        get_settings.cache_clear()
        _ = Settings()
