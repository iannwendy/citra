from __future__ import annotations

import asyncio
import io
import json
import logging as stdlib_logging
import zipfile
from datetime import UTC, datetime, timedelta
from pathlib import Path
from unittest.mock import MagicMock, patch

import bcrypt
import httpx
import jwt
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import sessionmaker

from integrity_checker.api.main import create_app
from integrity_checker.api.progress import (
    MAX_TRACKED_STATES,
    ProgressTracker,
    get_pipeline_admission_controller,
)
from integrity_checker.api.routes import auth as auth_mod
from integrity_checker.api.routes import billing as billing_mod
from integrity_checker.api.routes import essays as essays_mod
from integrity_checker.api.routes import report as report_mod
from integrity_checker.billing.vnpay import VNPayService
from integrity_checker.config import PROJECT_ROOT, PathsConfig, get_settings
from integrity_checker.db import session as session_mod
from integrity_checker.db.migrations import (
    LATEST_SCHEMA_VERSION,
    _downgrade_0012,
    _downgrade_0013,
)
from integrity_checker.db.models import (
    AuthToken,
    Base,
    BillingTransaction,
    Class,
    ClassMembership,
    EssayRecord,
    PromoCode,
    User,
    VerdictRecord,
)
from integrity_checker.db.models import (
    Session as DbSessionModel,
)
from integrity_checker.db.repository import Repository
from integrity_checker.export.bibliography_formatter import format_canonical_entry
from integrity_checker.export.docx_exporter import _docx_xml_is_safe
from integrity_checker.logging import InterceptHandler, configure_logging


@pytest.fixture()
def isolated_app_env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """Provide an isolated file-backed SQLite DB + data/cache dirs with clean teardown."""
    data_dir = tmp_path / "data"
    cache_dir = data_dir / "cache"
    avatars_dir = data_dir / "avatars"
    uploads_dir = data_dir / "essays" / "uploads"
    db_path = data_dir / "test_track3.db"
    data_dir.mkdir(parents=True, exist_ok=True)
    cache_dir.mkdir(parents=True, exist_ok=True)
    avatars_dir.mkdir(parents=True, exist_ok=True)
    uploads_dir.mkdir(parents=True, exist_ok=True)

    monkeypatch.setenv("DATA_DIR", str(data_dir))
    monkeypatch.setenv("CACHE_DIR", str(cache_dir))
    monkeypatch.setenv("ESSAYS_DIR", str(data_dir / "essays"))
    monkeypatch.setenv("AVATARS_DIR", str(avatars_dir))
    monkeypatch.setattr(essays_mod, "UPLOADS_DIR", uploads_dir)
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{db_path}")
    monkeypatch.setenv("JWT_SECRET", "track3-unit-test-jwt-secret-key-0123456789abcdef")
    monkeypatch.setenv("APP_ENV", "development")
    monkeypatch.setenv("DEMO_USERS_ENABLED", "true")
    get_settings.cache_clear()

    prev_engine = session_mod._engine
    prev_url = session_mod._engine_url
    prev_factory = session_mod._SessionLocal
    if prev_engine is not None:
        prev_engine.dispose()
    session_mod._engine = None
    session_mod._engine_url = None
    session_mod._SessionLocal = None

    session_mod.init_db()
    auth_mod._login_rate_limiter.clear_all()
    essays_mod._sandbox_verify_rate_buckets.clear()
    essays_mod.get_tracker()._states.clear()
    essays_mod.get_tracker()._retry_counts.clear()

    app = create_app()
    try:
        with TestClient(app) as client:
            yield client, tmp_path
    finally:
        auth_mod._login_rate_limiter.clear_all()
        essays_mod._sandbox_verify_rate_buckets.clear()
        essays_mod.get_tracker()._states.clear()
        essays_mod.get_tracker()._retry_counts.clear()
        if session_mod._engine is not None:
            session_mod._engine.dispose()
        session_mod._engine = prev_engine
        session_mod._engine_url = prev_url
        session_mod._SessionLocal = prev_factory
        get_settings.cache_clear()


def _create_user_and_headers(
    username: str = "student1",
    role: str = "user",
    plan_tier: str = "basic",
    email: str | None = None,
) -> tuple[int, dict[str, str]]:
    s = session_mod.get_session()
    try:
        repo = Repository(s)
        pw_hash = auth_mod._hash_password("ValidPass123!")
        user = repo.create_user(
            username=username,
            password_hash=pw_hash,
            role=role,
            email=email or f"{username}@example.edu",
            full_name=f"User {username}",
            is_active=True,
            email_verified=True,
        )
        user.plan_tier = plan_tier
        if plan_tier in ("pro", "ultra"):
            user.subscription_status = "active"
        token, expires_at = auth_mod._create_token(user)
        repo.create_session(user.id, token, expires_at)
        repo.commit()
        return int(user.id), {"Authorization": f"Bearer {token}"}
    finally:
        s.close()


# ==============================================================================
# API-01 & QA-02: Stripe Direct httpx Checkout, Prod Closed-Fail, Promo Lock & VNPay Retry/IPN
# ==============================================================================


def test_api01_qa02_stripe_httpx_checkout_and_prod_closed_fail(
    isolated_app_env, monkeypatch: pytest.MonkeyPatch
) -> None:
    client, _ = isolated_app_env
    _, headers = _create_user_and_headers("billing_u1")

    # 1. Direct httpx Stripe session creation (zero stripe SDK import needed)
    monkeypatch.setenv("STRIPE_SECRET_KEY", "sk_test_direct_httpx_key")
    mock_stripe_post = MagicMock()
    mock_stripe_post.status_code = 200
    mock_stripe_post.json.return_value = {
        "id": "cs_test_httpx_session_001",
        "url": "https://checkout.stripe.com/c/pay/cs_test_httpx_session_001",
    }
    with patch("httpx.post", return_value=mock_stripe_post) as mocked_post:
        res = client.post(
            "/api/billing/create-checkout-session",
            json={"plan_tier": "pro", "billing_cycle": "monthly"},
            headers=headers,
        )
        assert res.status_code == 200, res.text
        body = res.json()
        assert body["mode"] == "stripe_test"
        assert body["session_id"] == "cs_test_httpx_session_001"
        assert body["checkout_url"] == "https://checkout.stripe.com/c/pay/cs_test_httpx_session_001"
        mocked_post.assert_called_once()
        called_url = mocked_post.call_args.args[0]
        assert called_url == "https://api.stripe.com/v1/checkout/sessions"

    # 2. In production with sk_live_*: force_demo=True -> 403; Stripe httpx failure -> 502 closed-fail
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("STRIPE_SECRET_KEY", "sk_live_prod_secret_key")
    monkeypatch.delenv("ALLOW_DEMO_CHECKOUT_IN_PROD", raising=False)
    get_settings.cache_clear()

    with patch.object(billing_mod, "is_test_runtime", return_value=False):
        res_demo = client.post(
            "/api/billing/create-checkout-session",
            json={"plan_tier": "pro", "billing_cycle": "monthly", "force_demo": True},
            headers=headers,
        )
        assert res_demo.status_code == 403

        with patch(
            "httpx.post",
            side_effect=httpx.ConnectError("internal proxy 10.0.0.9:8443 unreachable"),
        ):
            res_fail = client.post(
                "/api/billing/create-checkout-session",
                json={"plan_tier": "pro", "billing_cycle": "monthly"},
                headers=headers,
            )
            assert res_fail.status_code == 502
            assert "10.0.0.9" not in res_fail.text
            assert "Payment gateway is temporarily unavailable" in res_fail.json()["detail"]

        # 3. In production when STRIPE_SECRET_KEY is unset: pending transaction created for VNPay,
        # while /verify-session still blocks stripe_demo card completion with 403
        monkeypatch.delenv("STRIPE_SECRET_KEY", raising=False)
        res_vnpay_ready = client.post(
            "/api/billing/create-checkout-session",
            json={"plan_tier": "pro", "billing_cycle": "monthly"},
            headers=headers,
        )
        assert res_vnpay_ready.status_code == 200
        demo_sid = res_vnpay_ready.json()["session_id"]
        res_verify_demo = client.post(
            "/api/billing/verify-session",
            json={"session_id": demo_sid},
            headers=headers,
        )
        assert res_verify_demo.status_code == 403


def test_api01_stripe_verify_amount_currency_and_promo_lock(
    isolated_app_env, monkeypatch: pytest.MonkeyPatch
) -> None:
    client, _ = isolated_app_env
    uid, headers = _create_user_and_headers("billing_u2")

    s = session_mod.get_session()
    try:
        repo = Repository(s)
        s.add(
            PromoCode(
                code="SAVE10",
                description="10% off test",
                discount_type="percent",
                discount_value=10.0,
                is_active=True,
            )
        )
        s.flush()
        repo.create_billing_transaction(
            user_id=uid,
            stripe_session_id="cs_live_tamper_check_001",
            plan_tier="pro",
            billing_cycle="monthly",
            subtotal_usd=20.0,
            discount_usd=2.0,
            promo_code="SAVE10",
            amount_usd=18.0,
            status="pending",
            payment_mode="stripe_live",
        )
        repo.commit()
    finally:
        s.close()

    # Mutating or clearing promo on stripe_live / stripe_test session must fail 400
    res_promo = client.post(
        "/api/billing/checkout-session/cs_live_tamper_check_001/promo",
        json={"code": ""},
        headers=headers,
    )
    assert res_promo.status_code == 400

    monkeypatch.setenv("STRIPE_SECRET_KEY", "sk_live_key_abc")

    # Wrong amount_total (100 cents vs expected 1800 cents) -> rejected (400 or 402)
    mock_wrong_amt = MagicMock(status_code=200)
    mock_wrong_amt.json.return_value = {
        "id": "cs_live_tamper_check_001",
        "payment_status": "paid",
        "amount_total": 100,
        "currency": "usd",
    }
    with patch("httpx.get", return_value=mock_wrong_amt):
        r1 = client.post(
            "/api/billing/verify-session",
            json={"session_id": "cs_live_tamper_check_001"},
            headers=headers,
        )
        assert r1.status_code in (400, 402)

    # Wrong currency ("vnd" vs "usd") -> rejected
    mock_wrong_cur = MagicMock(status_code=200)
    mock_wrong_cur.json.return_value = {
        "id": "cs_live_tamper_check_001",
        "payment_status": "paid",
        "amount_total": 1800,
        "currency": "vnd",
    }
    with patch("httpx.get", return_value=mock_wrong_cur):
        r2 = client.post(
            "/api/billing/verify-session",
            json={"session_id": "cs_live_tamper_check_001"},
            headers=headers,
        )
        assert r2.status_code in (400, 402)

    # Matching amount_total (1800) & currency ("usd") -> 200
    mock_ok = MagicMock(status_code=200)
    mock_ok.json.return_value = {
        "id": "cs_live_tamper_check_001",
        "payment_status": "paid",
        "amount_total": 1800,
        "currency": "usd",
    }
    with patch("httpx.get", return_value=mock_ok):
        r3 = client.post(
            "/api/billing/verify-session",
            json={"session_id": "cs_live_tamper_check_001"},
            headers=headers,
        )
        assert r3.status_code == 200
        assert r3.json()["subscription"]["plan_tier"] == "pro"


def test_api01_vnpay_retry_fresh_txn_ref_and_ipn_upgrade(
    isolated_app_env, monkeypatch: pytest.MonkeyPatch
) -> None:
    client, _ = isolated_app_env
    uid, headers = _create_user_and_headers("vnpay_u1")
    monkeypatch.setenv("VNPAY_TMN_CODE", "CITRATEST")
    monkeypatch.setenv("VNPAY_HASH_SECRET", "0123456789abcdef0123456789abcdef")

    create_res = client.post(
        "/api/billing/create-checkout-session",
        json={"plan_tier": "pro", "billing_cycle": "monthly"},
        headers=headers,
    )
    assert create_res.status_code == 200
    sid = create_res.json()["session_id"]

    url_res_1 = client.post(
        "/api/billing/vnpay/create-payment-url",
        json={"session_id": sid, "bank_code": "NCB"},
        headers=headers,
    )
    assert url_res_1.status_code == 200
    first_txn_ref = url_res_1.json()["vnp_txn_ref"]

    # Simulate user cancelling attempt #1
    s = session_mod.get_session()
    try:
        tx = (
            s.query(BillingTransaction)
            .filter(BillingTransaction.stripe_session_id == sid)
            .one()
        )
        tx.status = "canceled"
        tx.vnp_response_code = "24"
        s.commit()
    finally:
        s.close()

    # Retry attempt #2 -> must mint a FRESH vnp_txn_ref and reset status="pending"
    url_res_2 = client.post(
        "/api/billing/vnpay/create-payment-url",
        json={"session_id": sid, "bank_code": "NCB"},
        headers=headers,
    )
    assert url_res_2.status_code == 200
    second_txn_ref = url_res_2.json()["vnp_txn_ref"]
    assert second_txn_ref != first_txn_ref

    s = session_mod.get_session()
    try:
        tx = (
            s.query(BillingTransaction)
            .filter(BillingTransaction.stripe_session_id == sid)
            .one()
        )
        assert tx.status == "pending"
        assert tx.vnp_response_code is None
        amount_vnd = int(tx.amount_vnd or 0)
        # Even if marked canceled by an out-of-order return callback, a valid paid IPN must upgrade!
        tx.status = "canceled"
        s.commit()
    finally:
        s.close()

    vnp_svc = VNPayService()
    ipn_params = {
        "vnp_Amount": str(amount_vnd * 100),
        "vnp_BankCode": "NCB",
        "vnp_BankTranNo": "VNP999888",
        "vnp_CardType": "ATM",
        "vnp_OrderInfo": f"CITRA Pro {second_txn_ref}",
        "vnp_PayDate": "20261121150000",
        "vnp_ResponseCode": "00",
        "vnp_TmnCode": "CITRATEST",
        "vnp_TransactionNo": "14999888",
        "vnp_TransactionStatus": "00",
        "vnp_TxnRef": second_txn_ref,
    }
    ipn_params["vnp_SecureHash"] = vnp_svc.compute_hmac_sha512(
        vnp_svc.hash_secret, vnp_svc.build_sorted_query_string(ipn_params)
    )
    ipn_res = client.get("/api/billing/vnpay/ipn", params=ipn_params)
    assert ipn_res.status_code == 200
    assert ipn_res.json()["RspCode"] == "00"

    s = session_mod.get_session()
    try:
        user = s.get(User, uid)
        assert user is not None and user.plan_tier == "pro"
    finally:
        s.close()


def test_api01_seed_default_promo_codes_skipped_in_production(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("JWT_SECRET", "prod-seed-test-jwt-secret-0123456789abcdef012345")
    get_settings.cache_clear()
    engine = create_engine(f"sqlite:///{tmp_path / 'prod_seed.db'}")
    try:
        Base.metadata.create_all(bind=engine)
        factory = sessionmaker(bind=engine)
        prev_factory = session_mod._SessionLocal
        session_mod._SessionLocal = factory
        try:
            with patch.object(session_mod, "is_test_runtime", return_value=False):
                session_mod._seed_default_promo_codes(engine)
            with factory() as s:
                assert s.query(PromoCode).count() == 0
        finally:
            session_mod._SessionLocal = prev_factory
            get_settings.cache_clear()
    finally:
        engine.dispose()


# ==============================================================================
# API-02 & API-03: Auth Bounds, IP Spray Defense, Dummy Bcrypt & Google Prod Guard
# ==============================================================================


def test_api02_login_bounds_password_72b_ip_rate_limit_and_dummy_bcrypt(
    isolated_app_env, monkeypatch: pytest.MonkeyPatch
) -> None:
    client, _ = isolated_app_env
    _create_user_and_headers("real_target")

    # 1. LoginRequest bounds (>255 username, >256 password -> 422)
    assert (
        client.post(
            "/api/auth/login", json={"username": "u" * 260, "password": "pw"}
        ).status_code
        == 422
    )
    assert (
        client.post(
            "/api/auth/login", json={"username": "real_target", "password": "p" * 260}
        ).status_code
        == 422
    )

    # 2. _verify_password rejects >72 UTF-8 bytes cleanly
    valid_hash = auth_mod._hash_password("ShortValidPass1!")
    assert auth_mod._verify_password("x" * 73, valid_hash) is False

    # 3. Unknown username executes dummy bcrypt.checkpw
    monkeypatch.setenv("DEMO_USERS_ENABLED", "false")
    with patch.object(auth_mod.bcrypt, "checkpw", wraps=bcrypt.checkpw) as spy_checkpw:
        r_unknown = client.post(
            "/api/auth/login",
            json={"username": "nonexistent_person_xyz", "password": "WrongPassword1!"},
        )
        assert r_unknown.status_code == 401
        assert spy_checkpw.call_count >= 1

    # 4. Per-IP _login_ip_rate_limiter blocks horizontal spraying (>30 distinct usernames)
    monkeypatch.setattr(auth_mod._login_rate_limiter, "enforce_in_tests", True)
    auth_mod._login_rate_limiter.clear_all()
    try:
        statuses = []
        for idx in range(35):
            resp = client.post(
                "/api/auth/login",
                json={"username": f"spray_victim_{idx}", "password": "BadPassword1!"},
            )
            statuses.append(resp.status_code)
        assert 429 in statuses
        assert statuses[-1] == 429
    finally:
        auth_mod._login_rate_limiter.clear_all()
        monkeypatch.setattr(auth_mod._login_rate_limiter, "enforce_in_tests", False)


def test_api03_google_client_config_no_prod_fallback(
    isolated_app_env, monkeypatch: pytest.MonkeyPatch
) -> None:
    client, _ = isolated_app_env
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("GOOGLE_CLIENT_ID", "")
    get_settings.cache_clear()

    with patch.object(auth_mod, "is_test_runtime", return_value=False):
        cid, csec = auth_mod._get_google_client_config()
        assert cid == ""
        assert csec == ""

        resp = client.post("/api/auth/google", json={"credential": "fake.id.token"})
        assert resp.status_code == 503
        assert "GOOGLE_NOT_CONFIGURED" in resp.json()["detail"]


# ==============================================================================
# API-05: PATCH /api/users/me Email Flood Defense & Google Pre-Squat Isolation
# ==============================================================================


def test_api05_update_me_email_rate_limit_and_google_presquat_isolation(
    isolated_app_env, monkeypatch: pytest.MonkeyPatch
) -> None:
    client, _ = isolated_app_env
    squatter_id, squatter_headers = _create_user_and_headers(
        "squatter_local", email="squatter_orig@example.edu"
    )

    # Give squatter an existing essay so account is non-empty
    s = session_mod.get_session()
    try:
        repo = Repository(s)
        essay = repo.create_essay("squatter_paper.pdf", num_pages=3)
        essay.user_id = squatter_id
        essay_id = essay.id
        repo.commit()
    finally:
        s.close()

    # 1. Squatter sets unverified email to victim@uni.edu
    r_patch = client.patch(
        "/api/users/me",
        json={"email": "victim@uni.edu"},
        headers=squatter_headers,
    )
    assert r_patch.status_code == 200

    # 2. Enforce rate limiter on repeated email changes
    monkeypatch.setattr(auth_mod._login_rate_limiter, "enforce_in_tests", True)
    auth_mod._login_rate_limiter.clear_all()
    try:
        patch_codes = []
        for idx in range(7):
            resp = client.patch(
                "/api/users/me",
                json={"email": f"flood_{idx}@uni.edu"},
                headers=squatter_headers,
            )
            patch_codes.append(resp.status_code)
        assert 429 in patch_codes
    finally:
        auth_mod._login_rate_limiter.clear_all()
        monkeypatch.setattr(auth_mod._login_rate_limiter, "enforce_in_tests", False)

    # Reset squatter email to victim@uni.edu (unverified) for pre-squat Google test
    s = session_mod.get_session()
    try:
        sq = s.get(User, squatter_id)
        assert sq is not None
        sq.email = "victim@uni.edu"
        sq.email_verified = False
        sq.auth_provider = "local"
        s.commit()
    finally:
        s.close()

    monkeypatch.setenv("GOOGLE_CLIENT_ID", "test-google-cid.apps.googleusercontent.com")
    fake_google_claims = {
        "sub": "google-uid-victim-999",
        "email": "victim@uni.edu",
        "email_verified": True,
        "name": "Real Victim",
        "picture": "",
    }
    with patch.object(auth_mod, "_verify_google_payload", return_value=fake_google_claims):
        g_res = client.post("/api/auth/google", json={"credential": "valid.mock.token"})
        assert g_res.status_code == 200, g_res.text
        victim_user = g_res.json()["user"]
        assert victim_user["id"] != squatter_id
        assert victim_user["email"] == "victim@uni.edu"

    s = session_mod.get_session()
    try:
        sq_after = s.get(User, squatter_id)
        essay_after = s.get(EssayRecord, essay_id)
        assert sq_after is not None and sq_after.email is None
        assert essay_after is not None and essay_after.user_id == squatter_id
    finally:
        s.close()


# ==============================================================================
# API-06, API-07, API-08, API-09, API-10: Zip-Bomb, Sandbox Limits, PDF Layout, Tracker & Retry
# ==============================================================================


def test_api06_docx_spoofed_file_size_zip_bomb_blocked(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import integrity_checker.export.docx_exporter as docx_mod

    monkeypatch.setattr(docx_mod, "_MAX_DOCX_PART_BYTES", 16 * 1024)
    monkeypatch.setattr(docx_mod, "_MAX_DOCX_TOTAL_UNCOMPRESSED_BYTES", 32 * 1024)

    buf = io.BytesIO()
    big_xml = (
        b'<?xml version="1.0" encoding="UTF-8"?>'
        b'<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        + (b"<w:p><w:r><w:t>" + (b"A" * 1024) + b"</w:t></w:r></w:p>") * 40
        + b"</w:document>"
    )
    content_types_xml = (
        b'<?xml version="1.0" encoding="UTF-8"?>'
        b'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        b'<Default Extension="xml" ContentType="application/xml"/>'
        b"</Types>"
    )
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("[Content_Types].xml", content_types_xml)
        zf.writestr("word/document.xml", big_xml)
    valid_zip_bytes = buf.getvalue()

    # Simulate a spoofed Central Directory ZipInfo claiming file_size=512 while zf.open streams >40KB
    orig_open = zipfile.ZipFile.open

    def _spoofed_infolist(self: zipfile.ZipFile) -> list[zipfile.ZipInfo]:
        infos = list(self.filelist)
        for inf in infos:
            inf.file_size = 512
        return infos

    def _full_stream_open(
        self: zipfile.ZipFile,
        name: object,
        mode: str = "r",
        pwd: bytes | None = None,
    ):
        fname = name.filename if isinstance(name, zipfile.ZipInfo) else str(name)
        if fname.lower() == "[content_types].xml":
            return orig_open(self, name, mode, pwd)  # type: ignore[arg-type]
        return io.BytesIO(big_xml)

    with (
        patch.object(zipfile.ZipFile, "infolist", _spoofed_infolist),
        patch.object(zipfile.ZipFile, "open", _full_stream_open),
    ):
        assert _docx_xml_is_safe(io.BytesIO(valid_zip_bytes)) is False
    _ = orig_open


def test_api07_sandbox_generate_pdf_limits_and_async_offload(
    isolated_app_env, monkeypatch: pytest.MonkeyPatch
) -> None:
    client, _ = isolated_app_env
    _, basic_headers = _create_user_and_headers("sandbox_basic", plan_tier="basic")

    # Force low page limit (1 page) on basic policy to verify download_only=True still enforces plan cap
    orig_get_policy = essays_mod.get_user_plan_policy

    def _small_page_policy(user):
        pol = orig_get_policy(user)
        from dataclasses import replace

        return replace(pol, max_pages_per_pdf=1)

    monkeypatch.setattr(essays_mod, "get_user_plan_policy", _small_page_policy)

    many_items = [
        {
            "title": f"Paper Title {i} " + ("X" * 400),
            "authors_text": "Smith, J.; Doe, A.",
            "year": "2023",
            "venue": "Journal of Testing",
            "in_text_context": "Detailed discussion sentence. " * 25,
            "cite_in_text": True,
            "include_in_references": True,
        }
        for i in range(25)
    ]
    res_pages = client.post(
        "/api/essays/sandbox/generate-pdf",
        json={
            "title": "T" * 500,
            "author_name": "A" * 300,
            "style": "apa",
            "download_only": True,
            "items": many_items,
        },
        headers=basic_headers,
    )
    assert res_pages.status_code == 402


def test_api08_report_pdf_long_citation_and_ctrl_chars_no_layout_error(
    isolated_app_env,
) -> None:
    s = session_mod.get_session()
    try:
        repo = Repository(s)
        essay = repo.create_essay("runon_citations.pdf", num_pages=4)
        verdict = VerdictRecord(
            essay_id=essay.id,
            citation_raw=("Run-on merged reference text \x00\x01\x02\x07\x1f " * 220),
            label="metadata_error",
            confidence=0.88,
            reasoning="Detected concatenated reference metadata.",
            triggered_rules=json.dumps(["R-META-01"]),
            mismatched_fields=json.dumps(["title"]),
            features=json.dumps({}),
            mapping_status="matched",
            mapping_confidence=0.9,
        )
        s.add(verdict)
        s.commit()
        pdf_bytes = report_mod._generate_pdf_bytes(essay, [verdict])
        assert pdf_bytes.startswith(b"%PDF-")
        assert report_mod._sanitize_pdf_text("Alpha\x00\x07\x0b\x1fBeta") == "AlphaBeta"
    finally:
        s.close()


def test_api09_sandbox_rate_bucket_keyed_by_user_id_and_progress_tracker_cap() -> None:
    # 1. Keyed by user.id so changing username does not bypass per-user sandbox rate limit
    essays_mod._sandbox_verify_rate_buckets.clear()
    fake_user = User(id=777, username="handle_one", password_hash="x", role="user", plan_tier="basic")
    for _ in range(essays_mod.SANDBOX_VERIFY_MAX_REQUESTS):
        essays_mod._enforce_sandbox_verify_rate_limit(fake_user)
    fake_user.username = "handle_two"
    with pytest.raises(Exception) as exc_info:
        essays_mod._enforce_sandbox_verify_rate_limit(fake_user)
    assert getattr(exc_info.value, "status_code", None) == 429
    essays_mod._sandbox_verify_rate_buckets.clear()

    # 2. ProgressTracker caps terminal states at MAX_TRACKED_STATES even within TTL
    tracker = ProgressTracker()
    for eid in range(1, MAX_TRACKED_STATES + 40):
        tracker.init(eid)
        tracker.complete(eid)
    assert len(tracker._states) <= MAX_TRACKED_STATES


def test_api10_disk_io_in_process_retry_and_refund_under_sse(
    isolated_app_env, monkeypatch: pytest.MonkeyPatch
) -> None:
    _, tmp_path = isolated_app_env
    uid, _ = _create_user_and_headers("retry_student", plan_tier="pro")

    persisted_dir = tmp_path / "data" / "essays"
    persisted_dir.mkdir(parents=True, exist_ok=True)

    s = session_mod.get_session()
    try:
        repo = Repository(s)
        user = s.get(User, uid)
        assert user is not None
        user.monthly_uploads_used = 1
        essay = repo.create_essay("transient_io.pdf", num_pages=2)
        essay.user_id = uid
        essay.quota_charged = True
        essay.job_status = "processing"
        s.commit()
        eid = int(essay.id)
    finally:
        s.close()

    upload_file = essays_mod._get_persisted_upload_path(eid)
    upload_file.parent.mkdir(parents=True, exist_ok=True)
    upload_file.write_bytes(b"%PDF-1.4 dummy")

    attempts = {"count": 0}

    class _AlwaysDiskIoPipeline:
        async def run_async(self, *args, **kwargs):
            attempts["count"] += 1
            raise OperationalError("SELECT 1", {}, Exception("disk I/O error"))

    monkeypatch.setattr(essays_mod, "is_test_runtime", lambda: False)
    monkeypatch.setenv("CITRA_WORKER_MODE", "inline")
    monkeypatch.setattr(essays_mod, "get_pipeline", lambda: _AlwaysDiskIoPipeline())

    tracker = essays_mod.get_tracker()
    tracker.init(eid, is_retry=False)

    async def _exercise_sse_auto_retry() -> list[dict]:
        # Attempt 1 fails with transient disk I/O error -> quota preserved while retry budget remains
        await essays_mod._run_pipeline_task(
            essay_id=eid,
            tmp_path=str(upload_file),
            user_id=uid,
            pipeline=_AlwaysDiskIoPipeline(),
            cleanup_file=False,
        )
        assert attempts["count"] == 1
        assert tracker.can_auto_retry(eid) is True

        # SSE stream on /events must auto-schedule the single retry (instead of closing early!)
        fake_req = MagicMock()

        async def _not_disconnected() -> bool:
            return False

        fake_req.is_disconnected = _not_disconnected
        s_sse = session_mod.get_session()
        u_sse = s_sse.get(User, uid)
        assert u_sse is not None
        resp = await essays_mod.stream_essay_events(
            essay_id=eid,
            request=fake_req,
            current_user=u_sse,
            db=s_sse,
        )
        frames: list[dict] = []
        async for raw_chunk in resp.body_iterator:
            chunk_str = (
                raw_chunk.decode("utf-8") if isinstance(raw_chunk, bytes) else str(raw_chunk)
            )
            for line in chunk_str.splitlines():
                if line.startswith("data: "):
                    frames.append(json.loads(line[6:]))
        return frames

    try:
        frames = asyncio.run(_exercise_sse_auto_retry())
        # Must have retried once via SSE (2 attempts total), emitted final failed frame, and refunded upload quota!
        assert attempts["count"] == 2
        assert frames and frames[-1]["status"] == "failed"
        assert frames[-1].get("quota_charged") is False
        s = session_mod.get_session()
        try:
            refreshed_essay = s.get(EssayRecord, eid)
            refreshed_user = s.get(User, uid)
            assert refreshed_essay is not None and refreshed_essay.job_status == "failed"
            assert bool(refreshed_essay.quota_charged) is False
            assert refreshed_user is not None and refreshed_user.monthly_uploads_used == 0
        finally:
            s.close()
    finally:
        tracker.clear(eid)
        upload_file.unlink(missing_ok=True)


# ==============================================================================
# API-11..API-18, OPS-06, OPS-09, QA-08: Queries, Wildcards, Pruning, Headers, Health & Routes
# ==============================================================================


def test_api11_api12_batched_class_counts_revision_diff_and_wildcard_escape(
    isolated_app_env,
) -> None:
    _, _ = isolated_app_env
    teacher_id, _ = _create_user_and_headers("teacher_main", role="teacher", plan_tier="pro")
    enrolled_id, _ = _create_user_and_headers(
        "enrolled_stu", role="user", email="enrolled@cohort.edu"
    )
    outsider_id, _ = _create_user_and_headers(
        "outsider_stu", role="user", email="outsider@other.edu"
    )
    _ = outsider_id

    s = session_mod.get_session()
    try:
        repo = Repository(s)
        cls = Class(name="CS101", teacher_id=teacher_id, join_code="CITRA-7777")
        s.add(cls)
        s.flush()
        s.add(ClassMembership(class_id=cls.id, student_id=enrolled_id))
        e1 = repo.create_essay("thesis_v1.pdf", num_pages=5)
        e1.user_id = enrolled_id
        e1.class_id = cls.id
        e2 = repo.create_essay("unrelated_other.pdf", num_pages=5)
        e2.user_id = enrolled_id
        e3 = repo.create_essay("thesis_v2.pdf", num_pages=6)
        e3.user_id = enrolled_id
        s.commit()

        # API-11: batched class essay count matches get_class_essays parity
        counts = repo.count_essays_by_class_ids([cls.id])
        assert counts[cls.id] == len(repo.get_class_essays(cls.id)) == 3

        # API-11: _compute_revision_diff must NOT load verdicts on unrelated stem e2
        with (
            patch.object(repo, "get_verdicts", wraps=repo.get_verdicts) as spy_verdicts,
            patch.object(
                repo, "get_verdicts_by_essay_ids", wraps=repo.get_verdicts_by_essay_ids
            ) as spy_batch_verdicts,
        ):
            report_mod._compute_revision_diff(repo, e3, [])
            called_ids = [call.args[0] for call in spy_verdicts.call_args_list]
            batch_ids = [
                eid
                for call in spy_batch_verdicts.call_args_list
                for eid in (call.args[0] or [])
            ]
            assert e2.id not in called_ids
            assert e2.id not in batch_ids

        # API-12: wildcard injection "%%" and "__" must NOT leak outsider_stu
        res_pct = repo.search_students_for_teacher(teacher_id=teacher_id, q="%%")
        res_und = repo.search_students_for_teacher(teacher_id=teacher_id, q="__")
        assert [u.username for u in res_pct] == ["enrolled_stu"]
        assert [u.username for u in res_und] == ["enrolled_stu"]
    finally:
        s.close()


def test_api13_expired_session_commit_api_key_refresh_and_token_pruning(
    isolated_app_env,
) -> None:
    client, _ = isolated_app_env
    uid, _ = _create_user_and_headers("session_prune_u")

    s = session_mod.get_session()
    try:
        repo = Repository(s)
        # Seed an already-expired Session and AuthToken
        expired_tok = "expired_session_tok_001"
        s.add(
            DbSessionModel(
                user_id=uid,
                token=expired_tok,
                expires_at=datetime.now(UTC) - timedelta(hours=2),
            )
        )
        s.add(
            AuthToken(
                user_id=uid,
                token_hash="expired_auth_hash_001",
                token_type="activation",
                expires_at=datetime.now(UTC) - timedelta(hours=2),
            )
        )
        s.commit()

        # Creating a new session & auth_token opportunistically purges expired rows
        repo.create_session(uid, "fresh_session_tok_002", datetime.now(UTC) + timedelta(hours=2))
        repo.create_auth_token(uid, "activation", datetime.now(UTC) + timedelta(hours=1))
        repo.commit()

        rem_sessions = [
            row.token for row in s.query(DbSessionModel).filter(DbSessionModel.user_id == uid).all()
        ]
        rem_tokens = [
            row.token_hash for row in s.query(AuthToken).filter(AuthToken.user_id == uid).all()
        ]
        assert "expired_session_tok_001" not in rem_sessions
        assert "expired_auth_hash_001" not in rem_tokens

        # Seed valid JWT whose DB session row is expired -> get_current_user must commit deletion!
        settings = get_settings()
        valid_jwt = jwt.encode(
            {
                "sub": str(uid),
                "username": "session_prune_u",
                "role": "user",
                "exp": datetime.now(UTC) + timedelta(hours=1),
                "iat": datetime.now(UTC),
                "jti": "db-exp-check",
            },
            settings.auth.jwt_secret,
            algorithm="HS256",
        )
        s.add(
            DbSessionModel(
                user_id=uid,
                token=valid_jwt,
                expires_at=datetime.now(UTC) - timedelta(minutes=5),
            )
        )
        raw_key, _ = repo.create_api_key(uid, "CLI Key")
        s.commit()
    finally:
        s.close()

    r_exp = client.get("/api/auth/me", headers={"Authorization": f"Bearer {valid_jwt}"})
    assert r_exp.status_code == 401

    s = session_mod.get_session()
    try:
        assert (
            s.query(DbSessionModel).filter(DbSessionModel.token == valid_jwt).first() is None
        )
    finally:
        s.close()

    # API key auth works cleanly after commit + refresh
    r_key = client.get("/api/auth/me", headers={"X-API-Key": raw_key})
    assert r_key.status_code == 200


def test_api14_sanitized_gateway_errors_and_stripped_progress_snapshot(
    isolated_app_env, monkeypatch: pytest.MonkeyPatch
) -> None:
    client, _ = isolated_app_env
    uid, headers = _create_user_and_headers("snap_user", plan_tier="pro")

    # 1. VNPay verify_return_url must not leak env var / constant names in message_en
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.delenv("VNPAY_HASH_SECRET", raising=False)
    vnp = VNPayService(hash_secret="")
    vres = vnp.verify_return_url({"vnp_TxnRef": "REF1", "vnp_ResponseCode": "00"})
    assert vres.is_verified is False
    assert "VNPAY_HASH_SECRET" not in vres.message_en
    assert "VNPAY_DEFAULT_HASH_SECRET" not in vres.message_en
    monkeypatch.setenv("APP_ENV", "development")

    # 2. _progress_snapshot stripped from JSON report and public shared report
    s = session_mod.get_session()
    try:
        repo = Repository(s)
        essay = repo.create_essay("snap_doc.pdf", num_pages=2)
        essay.user_id = uid
        essay.style_profile_json = json.dumps(
            {
                "detected_style": "apa",
                "_progress_snapshot": {"stage": "completed", "internal_debug": True},
            }
        )
        s.commit()
        eid = int(essay.id)
    finally:
        s.close()

    share_tok = essays_mod.create_essay_share_token(eid)["share_token"]

    r_rep = client.get(f"/api/essays/{eid}/report?format=json", headers=headers)
    assert r_rep.status_code == 200
    assert "_progress_snapshot" not in (r_rep.json().get("style_profile") or {})

    r_shared = client.get(f"/api/essays/shared/{share_tok}")
    assert r_shared.status_code == 200
    assert "_progress_snapshot" not in (r_shared.json().get("style_profile") or {})


def test_api15_delete_user_cancels_admission_admin_username_api_key_cap_and_healed_docx_gate(
    isolated_app_env,
) -> None:
    client, _ = isolated_app_env
    _, admin_headers = _create_user_and_headers("root_admin", role="admin", plan_tier="ultra")
    del_uid, _ = _create_user_and_headers("to_delete_u")
    key_uid, key_headers = _create_user_and_headers("key_hoarder", plan_tier="pro")
    teacher_basic_uid, teacher_basic_headers = _create_user_and_headers(
        "downgraded_teacher", role="teacher", plan_tier="basic"
    )
    _ = key_uid

    # 1. Admin username format validation on POST /api/users & PUT /api/users/{id}
    r_bad_create = client.post(
        "/api/users",
        json={"username": "invalid space!", "password": "ValidPassword1!", "role": "user"},
        headers=admin_headers,
    )
    assert r_bad_create.status_code == 400

    r_bad_update = client.put(
        f"/api/users/{del_uid}",
        json={"username": "bad$handle!"},
        headers=admin_headers,
    )
    assert r_bad_update.status_code == 400

    # 2. Repository.delete_user cancels admission controller waiters
    s = session_mod.get_session()
    try:
        repo = Repository(s)
        e_del = repo.create_essay("queued_del.pdf", num_pages=2)
        e_del.user_id = del_uid
        e_teacher = repo.create_essay("teacher_basic.pdf", num_pages=2)
        e_teacher.user_id = teacher_basic_uid
        s.commit()
        del_eid = int(e_del.id)
        teacher_eid = int(e_teacher.id)

        controller = get_pipeline_admission_controller()
        with patch.object(controller, "cancel", wraps=controller.cancel) as spy_cancel:
            repo.delete_user(del_uid)
            repo.commit()
            spy_cancel.assert_any_call(del_eid)
    finally:
        s.close()

    # 3. API keys capped at 25 active keys per user
    for idx in range(25):
        rk = client.post(
            "/api/users/me/api-keys",
            json={"name": f"Key-{idx}"},
            headers=key_headers,
        )
        assert rk.status_code in (200, 201), rk.text
    rk_26 = client.post(
        "/api/users/me/api-keys",
        json={"name": "Key-26"},
        headers=key_headers,
    )
    assert rk_26.status_code == 400

    # 4. Downgraded basic teacher blocked from export-healed-docx (402)
    r_docx = client.get(
        f"/api/essays/{teacher_eid}/export-healed-docx",
        headers=teacher_basic_headers,
    )
    assert r_docx.status_code == 402


def test_api16_api17_api18_ops06_ops09_headers_health_request_id_paths_logging_bibtex(
    isolated_app_env, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    client, _ = isolated_app_env

    # 1. API-18 + OPS-09: SecurityHeadersMiddleware + X-Request-ID + /api/health DB probe
    fake_grobid_mgr = MagicMock()
    fake_grobid_mgr.check_health.return_value = MagicMock(value="stopped")
    fake_grobid_mgr.is_container_running.return_value = False
    with patch(
        "integrity_checker.api.routes.health.get_grobid_manager",
        return_value=fake_grobid_mgr,
    ):
        r_health = client.get("/api/health", headers={"X-Request-ID": "req-trace-abc-123"})
        assert r_health.status_code == 200
        assert (
            r_health.headers.get("permissions-policy")
            == "camera=(), microphone=(), geolocation=()"
        )
        assert r_health.headers.get("cross-origin-resource-policy") == "same-site"
        assert r_health.headers.get("x-request-id") == "req-trace-abc-123"
        h_json = r_health.json()
        assert h_json["status"] == "ok"
        assert h_json["database"]["ok"] is True

        # Generated X-Request-ID when omitted
        r_gen = client.get("/api/health")
        assert len(r_gen.headers.get("x-request-id") or "") >= 16

        # Degraded 503 when DB SELECT 1 fails
        broken_engine = MagicMock()
        broken_engine.connect.side_effect = OperationalError(
            "SELECT 1", {}, Exception("db locked")
        )
        with patch("integrity_checker.api.routes.health.get_engine", return_value=broken_engine):
            r_deg = client.get("/api/health")
            assert r_deg.status_code == 503
            assert r_deg.json()["status"] == "degraded"
            assert r_deg.json()["database"]["ok"] is False

    # 2. API-16: PathsConfig anchored to PROJECT_ROOT / "data"
    paths = PathsConfig()
    assert paths.data_dir == PROJECT_ROOT / "data"
    assert paths.data_dir.is_absolute()

    # 3. API-04: Session.token is String(512) and LATEST_SCHEMA_VERSION == "0013"
    assert LATEST_SCHEMA_VERSION == "0013"
    assert DbSessionModel.__table__.c.token.type.length == 512

    # 4. API-04: _downgrade_0012 drops constraint before index on PostgreSQL
    events: list[str] = []
    mock_conn = MagicMock()
    mock_conn.dialect.name = "postgresql"
    mock_op = MagicMock()
    mock_op.drop_constraint.side_effect = lambda *a, **k: events.append("drop_constraint")
    mock_inspector = MagicMock()
    mock_inspector.get_unique_constraints.return_value = [
        {"name": "uq_classes_teacher_name", "column_names": ["teacher_id", "name"]}
    ]
    with (
        patch("integrity_checker.db.migrations._table_exists", return_value=True),
        patch("integrity_checker.db.migrations.inspect", return_value=mock_inspector),
        patch(
            "integrity_checker.db.migrations._drop_index_if_exists",
            side_effect=lambda *a, **k: events.append("drop_index"),
        ),
    ):
        _downgrade_0012(mock_conn, mock_op)
    assert events.index("drop_constraint") < events.index("drop_index")

    # 5. OPS-06: create_app warns when inline worker mode + UVICORN_WORKERS > 1
    monkeypatch.setenv("CITRA_WORKER_MODE", "inline")
    monkeypatch.setenv("UVICORN_WORKERS", "4")
    with patch("integrity_checker.api.main.logger.warning") as spy_warn:
        _ = create_app()
        assert any("inline" in str(c.args).lower() for c in spy_warn.call_args_list)
    monkeypatch.delenv("UVICORN_WORKERS", raising=False)

    # 6. API-17 & OPS-09: logging.py colorize=not is_prod, enqueue=True, InterceptHandler
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("DATA_DIR", str(tmp_path / "prod_logs_data"))
    get_settings.cache_clear()
    with patch("integrity_checker.logging._loguru.add") as spy_add:
        configure_logging()
        assert spy_add.call_count == 2
        stderr_kwargs = spy_add.call_args_list[0].kwargs
        file_kwargs = spy_add.call_args_list[1].kwargs
        assert stderr_kwargs.get("colorize") is False
        assert file_kwargs.get("enqueue") is True
    handler = InterceptHandler()
    record = stdlib_logging.LogRecord(
        name="uvicorn.access",
        level=stdlib_logging.INFO,
        pathname=__file__,
        lineno=10,
        msg="Test intercepted message",
        args=(),
        exc_info=None,
    )
    handler.emit(record)
    monkeypatch.setenv("APP_ENV", "development")
    get_settings.cache_clear()

    # 7. API-17: BibTeX sanitization escapes % and unbalanced braces
    bib_bundle = format_canonical_entry(
        {
            "authors": ["Jane Doe"],
            "year": "2024",
            "title": "100% Gain with {Unbalanced Brace",
            "venue": "Proc. 50% Conf }",
            "doi": "10.1000/test_bib",
            "url": None,
        },
        index=1,
        style="bibtex",
    )
    bib = bib_bundle["bibtex"]
    assert r"\%" in bib
    # Braces inside BibTeX entry must be balanced overall
    assert bib.count("{") == bib.count("}")


def test_qa08_previously_untested_routes(isolated_app_env) -> None:
    client, _ = isolated_app_env
    _, admin_headers = _create_user_and_headers("qa08_admin", role="admin", plan_tier="ultra")
    pro_uid, pro_headers = _create_user_and_headers("qa08_pro", role="user", plan_tier="pro")
    teacher_uid, teacher_headers = _create_user_and_headers(
        "qa08_teacher", role="teacher", plan_tier="pro"
    )

    s = session_mod.get_session()
    try:
        repo = Repository(s)
        s.add(
            PromoCode(
                code="QA8PRO",
                description="50% off test",
                discount_type="percent",
                discount_value=50.0,
                is_active=True,
            )
        )
        essay = repo.create_essay("qa08_manuscript.docx", num_pages=2)
        essay.user_id = pro_uid
        cls = Class(name="QA08 Seminar", teacher_id=teacher_uid, join_code="CITRA-1111")
        s.add(cls)
        s.commit()
        eid = int(essay.id)
        cid = int(cls.id)
    finally:
        s.close()

    # 1. GET /api/billing/subscription & POST /api/billing/promo/validate
    r_sub = client.get("/api/billing/subscription", headers=pro_headers)
    assert r_sub.status_code == 200
    assert r_sub.json()["subscription"]["plan_tier"] == "pro"

    r_val = client.post(
        "/api/billing/promo/validate",
        json={"code": "QA8PRO", "plan_tier": "pro", "billing_cycle": "monthly"},
        headers=pro_headers,
    )
    assert r_val.status_code == 200
    assert r_val.json()["valid"] is True

    # 2. GET /api/essays/all (admin 200 vs user 403) & GET /api/essays/sandbox/acl-sample
    assert client.get("/api/essays/all", headers=pro_headers).status_code == 403
    assert client.get("/api/essays/all", headers=admin_headers).status_code == 200

    mock_local_db = MagicMock()
    mock_local_db.sample_random_papers.return_value = []
    mock_local_db.get_stats.return_value = {"total_papers": 0}
    with patch("integrity_checker.database.LocalDatabase", return_value=mock_local_db):
        r_sample = client.get("/api/essays/sandbox/acl-sample?count=5", headers=pro_headers)
        assert r_sample.status_code == 200
        assert "items" in r_sample.json()

    # 3. GET /api/health/grobid, POST /api/health/grobid/start, POST /api/health/grobid/stop
    fake_mgr = MagicMock()
    fake_mgr.status.value = "running"
    fake_mgr.check_health.return_value = MagicMock(value="available")
    fake_mgr.is_container_running.return_value = True
    fake_mgr.stop.return_value = True
    with patch("integrity_checker.api.routes.health.get_grobid_manager", return_value=fake_mgr):
        assert client.get("/api/health/grobid").status_code == 200
        assert client.post("/api/health/grobid/start", headers=pro_headers).status_code == 403
        assert client.post("/api/health/grobid/stop", headers=pro_headers).status_code == 403
        assert client.post("/api/health/grobid/start", headers=admin_headers).status_code == 200
        assert client.post("/api/health/grobid/stop", headers=admin_headers).status_code == 200

    # 4. GET /api/essays/{essay_id}/export-healed-docx (Pro 200)
    r_healed = client.get(f"/api/essays/{eid}/export-healed-docx", headers=pro_headers)
    assert r_healed.status_code == 200

    # 5. POST /api/teacher/classes/{class_id}/regenerate-code
    r_regen = client.post(f"/api/teacher/classes/{cid}/regenerate-code", headers=teacher_headers)
    assert r_regen.status_code == 200
    assert r_regen.json()["join_code"] != "CITRA-1111"

    # 6. POST /api/auth/logout revokes session token
    r_logout = client.post("/api/auth/logout", headers=pro_headers)
    assert r_logout.status_code == 200
    assert client.get("/api/auth/me", headers=pro_headers).status_code == 401


# ==============================================================================
# ROUND-1 CRITIC & REVIEWER REGRESSION TESTS (CRITIC-BE-01..07 + #65 SPEC/STD)
# ==============================================================================


def test_round1_critic_be_01_02_07_billing_promo_vnpay_stripe_guards(
    isolated_app_env, monkeypatch: pytest.MonkeyPatch
) -> None:
    client, _ = isolated_app_env
    uid_alice, alice_headers = _create_user_and_headers("r1_alice")
    uid_bob, bob_headers = _create_user_and_headers("r1_bob")
    _ = uid_bob

    s = session_mod.get_session()
    try:
        repo = Repository(s)
        s.add_all(
            [
                PromoCode(
                    code="HALF50",
                    description="Single-use 50% off",
                    discount_type="percent",
                    discount_value=50.0,
                    max_uses=1,
                    is_active=True,
                ),
                PromoCode(
                    code="TINY10",
                    description="10% decoy promo",
                    discount_type="percent",
                    discount_value=10.0,
                    is_active=True,
                ),
                PromoCode(
                    code="FREE99",
                    description="100% waiver promo",
                    discount_type="percent",
                    discount_value=100.0,
                    is_active=True,
                ),
            ]
        )
        s.flush()
        repo.create_billing_transaction(
            user_id=uid_alice,
            stripe_session_id="cs_live_half50_locked",
            plan_tier="pro",
            billing_cycle="monthly",
            subtotal_usd=20.0,
            discount_usd=10.0,
            promo_code="HALF50",
            amount_usd=10.0,
            status="pending",
            payment_mode="stripe_live",
        )
        s.commit()
    finally:
        s.close()

    # 1. CRITIC-BE-01: verify-session must reject promo_code override (TINY10 or 100% FREE99)
    # on stripe_live / stripe_test sessions so single-use HALF50 cannot be bypassed!
    monkeypatch.setenv("STRIPE_SECRET_KEY", "rk_live_restricted_key_ok")
    paid_1000_resp = MagicMock()
    paid_1000_resp.status_code = 200
    paid_1000_resp.json.return_value = {
        "id": "cs_live_half50_locked",
        "payment_status": "paid",
        "amount_total": 1000,
        "currency": "usd",
    }
    with patch("httpx.get", return_value=paid_1000_resp):
        r_swap = client.post(
            "/api/billing/verify-session",
            json={"session_id": "cs_live_half50_locked", "promo_code": "TINY10"},
            headers=alice_headers,
        )
        assert r_swap.status_code == 400

        r_waiver_bypass = client.post(
            "/api/billing/verify-session",
            json={"session_id": "cs_live_half50_locked", "promo_code": "FREE99"},
            headers=alice_headers,
        )
        assert r_waiver_bypass.status_code == 400

        # Legitimate verification without override (using rk_live_* key!) succeeds & increments HALF50
        r_legit = client.post(
            "/api/billing/verify-session",
            json={"session_id": "cs_live_half50_locked"},
            headers=alice_headers,
        )
        assert r_legit.status_code == 200, r_legit.text

    s = session_mod.get_session()
    try:
        half50 = s.query(PromoCode).filter(PromoCode.code == "HALF50").first()
        tiny10 = s.query(PromoCode).filter(PromoCode.code == "TINY10").first()
        assert half50 is not None and half50.used_count == 1
        assert tiny10 is not None and tiny10.used_count == 0
    finally:
        s.close()

    # On stripe_demo session, non-waiver promo_code override without /promo update first -> 400
    monkeypatch.delenv("STRIPE_SECRET_KEY", raising=False)
    demo_create = client.post(
        "/api/billing/create-checkout-session",
        json={"plan_tier": "pro", "billing_cycle": "monthly", "force_demo": True},
        headers=bob_headers,
    ).json()
    r_demo_mismatch = client.post(
        "/api/billing/verify-session",
        json={"session_id": demo_create["session_id"], "promo_code": "TINY10"},
        headers=bob_headers,
    )
    assert r_demo_mismatch.status_code == 400

    # 2. CRITIC-BE-02 & #65 Spec Defect 2.1: VNPay ReturnURL must NEVER fall back to session_id_hint
    vnpay = VNPayService()
    amount_vnd = vnpay.usd_to_vnd(20.0)
    orphan_paid_params = vnpay.build_signed_return_params(
        txn_ref="CITRA_DELETED_OLD_REF_999",
        amount_vnd=amount_vnd,
        order_info="Orphaned paid receipt",
        bank_code="NCB",
        card_type="ATM",
        response_code="00",
    )
    r_orphan_replay = client.post(
        "/api/billing/vnpay/verify-return",
        json={"session_id": demo_create["session_id"], "vnp_params": orphan_paid_params},
        headers=bob_headers,
    )
    assert r_orphan_replay.status_code == 404

    # Also test retry isolation on ReturnURL + mismatched session_id_hint -> 400
    u1 = client.post(
        "/api/billing/vnpay/create-payment-url",
        json={"session_id": demo_create["session_id"], "bank_code": "NCB"},
        headers=bob_headers,
    ).json()
    ref1 = u1["vnp_txn_ref"]
    stale_cancel_params = vnpay.build_signed_return_params(
        txn_ref=ref1,
        amount_vnd=amount_vnd,
        order_info=f"Cancel {ref1}",
        bank_code="NCB",
        card_type="ATM",
        response_code="24",
    )
    assert (
        client.post(
            "/api/billing/vnpay/verify-return",
            json={"session_id": demo_create["session_id"], "vnp_params": stale_cancel_params},
            headers=bob_headers,
        ).status_code
        == 400
    )
    # Mint ref2 -> tx.status becomes pending
    u2 = client.post(
        "/api/billing/vnpay/create-payment-url",
        json={"session_id": demo_create["session_id"], "bank_code": "NCB"},
        headers=bob_headers,
    ).json()
    ref2 = u2["vnp_txn_ref"]
    assert ref2 != ref1
    # Stale ref1 ReturnURL must 404 and NOT clobber tx.status back to canceled!
    r_stale_ret = client.post(
        "/api/billing/vnpay/verify-return",
        json={"session_id": demo_create["session_id"], "vnp_params": stale_cancel_params},
        headers=bob_headers,
    )
    assert r_stale_ret.status_code == 404
    s = session_mod.get_session()
    try:
        bob_tx = Repository(s).get_billing_transaction_by_session(demo_create["session_id"])
        assert bob_tx is not None and bob_tx.status == "pending"
    finally:
        s.close()

    # Valid ref2 with wrong session_id_hint -> 400
    ref2_paid_params = vnpay.build_signed_return_params(
        txn_ref=ref2,
        amount_vnd=amount_vnd,
        order_info=f"Pay {ref2}",
        bank_code="NCB",
        card_type="ATM",
        response_code="00",
    )
    r_wrong_hint = client.post(
        "/api/billing/vnpay/verify-return",
        json={"session_id": "cs_wrong_session_id", "vnp_params": ref2_paid_params},
        headers=bob_headers,
    )
    assert r_wrong_hint.status_code == 400

    # 3. CRITIC-BE-07 & #65 Spec Defect 2.2/2.3:
    # - rk_test_* works in create-checkout-session
    monkeypatch.setenv("STRIPE_SECRET_KEY", "rk_test_restricted_key_ok")
    mock_rk_post = MagicMock()
    mock_rk_post.status_code = 200
    mock_rk_post.json.return_value = {
        "id": "cs_test_rk_001",
        "url": "https://checkout.stripe.com/c/pay/cs_test_rk_001",
    }
    with patch("httpx.post", return_value=mock_rk_post):
        r_rk = client.post(
            "/api/billing/create-checkout-session",
            json={"plan_tier": "pro", "billing_cycle": "monthly"},
            headers=bob_headers,
        )
        assert r_rk.status_code == 200
        assert r_rk.json()["mode"] == "stripe_test"

    # - sandbox-authorize rejects stripe_test / stripe_live and already-succeeded sessions (400)
    assert (
        client.post(
            "/api/billing/vnpay/sandbox-authorize",
            json={"session_id": "cs_test_rk_001", "bank_code": "NCB", "payment_channel": "qr"},
            headers=bob_headers,
        ).status_code
        == 400
    )
    assert (
        client.post(
            "/api/billing/vnpay/sandbox-authorize",
            json={
                "session_id": "cs_live_half50_locked",
                "bank_code": "NCB",
                "payment_channel": "qr",
            },
            headers=alice_headers,
        ).status_code
        == 400
    )
    # - create_vnpay_payment_url conflict message mentions Stripe/VNPay, NOT promo codes
    r_vnp_conflict = client.post(
        "/api/billing/vnpay/create-payment-url",
        json={"session_id": "cs_test_rk_001", "bank_code": "NCB"},
        headers=bob_headers,
    )
    assert r_vnp_conflict.status_code == 400
    assert "promo" not in r_vnp_conflict.json()["detail"].lower()

    # - Production guards: force_demo=True -> 403 even without sk_live_; bad key prefix -> 503;
    #   verify-session missing key in prod -> 503 WITHOUT leaking "STRIPE_SECRET_KEY"
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.delenv("ALLOW_DEMO_CHECKOUT_IN_PROD", raising=False)
    get_settings.cache_clear()
    with patch.object(billing_mod, "is_test_runtime", return_value=False):
        monkeypatch.delenv("STRIPE_SECRET_KEY", raising=False)
        r_prod_force_demo = client.post(
            "/api/billing/create-checkout-session",
            json={"plan_tier": "pro", "billing_cycle": "monthly", "force_demo": True},
            headers=bob_headers,
        )
        assert r_prod_force_demo.status_code == 403

        monkeypatch.setenv("STRIPE_SECRET_KEY", "invalid_prefix_secret")
        r_bad_prefix = client.post(
            "/api/billing/create-checkout-session",
            json={"plan_tier": "pro", "billing_cycle": "monthly"},
            headers=bob_headers,
        )
        assert r_bad_prefix.status_code == 503
        assert "STRIPE_SECRET_KEY" not in r_bad_prefix.text

        r_unpaid_verify_prod = client.post(
            "/api/billing/verify-session",
            json={"session_id": "cs_test_rk_001"},
            headers=bob_headers,
        )
        assert r_unpaid_verify_prod.status_code == 503
        assert "STRIPE_SECRET_KEY" not in r_unpaid_verify_prod.text

    # - PostgreSQL _downgrade_0013 deletes >255-char session tokens before alter_column
    pg_events: list[str] = []
    pg_conn = MagicMock()
    pg_conn.dialect.name = "postgresql"
    pg_conn.exec_driver_sql.side_effect = lambda sql, *a, **k: pg_events.append(str(sql))
    pg_op = MagicMock()
    pg_op.alter_column.side_effect = lambda *a, **k: pg_events.append("alter_column")
    with patch("integrity_checker.db.migrations._table_exists", return_value=True):
        _downgrade_0013(pg_conn, pg_op)
    del_idx = next(
        i for i, e in enumerate(pg_events) if "DELETE FROM sessions WHERE LENGTH(token) > 255" in e
    )
    alt_idx = pg_events.index("alter_column")
    assert del_idx < alt_idx


def test_round1_critic_be_03_constant_time_verify_password() -> None:
    valid_hash = bcrypt.hashpw(b"CorrectPass1!", bcrypt.gensalt(rounds=4)).decode("utf-8")

    # Every failure branch (empty hash, >72 UTF-8 bytes, malformed hash) MUST execute 1 bcrypt.checkpw
    for pw, hsh in (
        ("NormalPassword1!", ""),
        ("A" * 100, valid_hash),
        ("NormalPassword1!", "not-a-valid-bcrypt-hash"),
    ):
        with patch("integrity_checker.api.routes.auth.bcrypt.checkpw", wraps=bcrypt.checkpw) as spy:
            assert auth_mod._verify_password(pw, hsh) is False
            assert spy.call_count == 1, f"Expected 1 bcrypt.checkpw call for ({len(pw)}B, {hsh!r})"


def test_round1_critic_be_04_05_docx_content_types_xxe_and_bibtex_percent_urls() -> None:
    valid_doc_xml = (
        b'<?xml version="1.0"?>'
        b'<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>'
    )
    valid_ct_xml = (
        b'<?xml version="1.0"?>'
        b'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        b'<Default Extension="xml" ContentType="application/xml"/>'
        b"</Types>"
    )

    # Baseline sanity: valid minimal [Content_Types].xml + word/document.xml -> True
    ok_buf = io.BytesIO()
    with zipfile.ZipFile(ok_buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("[Content_Types].xml", valid_ct_xml)
        zf.writestr("word/document.xml", valid_doc_xml)
    assert _docx_xml_is_safe(io.BytesIO(ok_buf.getvalue())) is True

    # 1. CRITIC-BE-04: missing [Content_Types].xml -> False
    no_ct_buf = io.BytesIO()
    with zipfile.ZipFile(no_ct_buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("word/document.xml", valid_doc_xml)
    assert _docx_xml_is_safe(io.BytesIO(no_ct_buf.getvalue())) is False

    # 2. CRITIC-BE-04: > 2048 archive entries -> False
    many_buf = io.BytesIO()
    with zipfile.ZipFile(many_buf, "w", zipfile.ZIP_STORED) as zf:
        zf.writestr("[Content_Types].xml", valid_ct_xml)
        zf.writestr("word/document.xml", valid_doc_xml)
        for idx in range(2050):
            zf.writestr(f"media/f{idx}.bin", b"x")
    assert _docx_xml_is_safe(io.BytesIO(many_buf.getvalue())) is False

    # 3. CRITIC-BE-04: /word/comments.bin declared as XML in [Content_Types].xml with DTD/ENTITY -> False
    disguised_buf = io.BytesIO()
    with zipfile.ZipFile(disguised_buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(
            "[Content_Types].xml",
            b'<?xml version="1.0"?>'
            b'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
            b'<Default Extension="xml" ContentType="application/xml"/>'
            b'<Override PartName="/word/comments.bin" '
            b'ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/>'
            b"</Types>",
        )
        zf.writestr("word/document.xml", valid_doc_xml)
        zf.writestr(
            "word/comments.bin",
            b'<?xml version="1.0"?><!DOCTYPE bomb [<!ENTITY a "lol">]>'
            b'<w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">&a;</w:comments>',
        )
    assert _docx_xml_is_safe(io.BytesIO(disguised_buf.getvalue())) is False

    # 4. CRITIC-BE-04: undeclared .dat entry starting with BOM + whitespace + <?xml/<!DOCTYPE -> False
    magic_buf = io.BytesIO()
    with zipfile.ZipFile(magic_buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("[Content_Types].xml", valid_ct_xml)
        zf.writestr("word/document.xml", valid_doc_xml)
        zf.writestr(
            "custom/payload.dat",
            b'\xef\xbb\xbf  \n<?xml version="1.0"?><!DOCTYPE foo [<!ENTITY xxe "bar">]><root>&xxe;</root>',
        )
    assert _docx_xml_is_safe(io.BytesIO(magic_buf.getvalue())) is False

    # 4. CRITIC-BE-05: BibTeX escapes % in title/venue while preserving %20 in url & doi
    bundle = format_canonical_entry(
        {
            "authors": ["Jane Doe"],
            "year": "2024",
            "title": "100% Gain Study",
            "venue": "50% Conf",
            "doi": "10.1000/sici%20code",
            "url": "https://example.org/papers/My%20Paper%20(2024).pdf",
        },
        index=1,
        style="bibtex",
    )
    bib = bundle["bibtex"]
    assert r"title = {100\% Gain Study}" in bib
    assert r"journal = {50\% Conf}" in bib
    assert "doi = {10.1000/sici%20code}" in bib
    assert "url = {https://example.org/papers/My%20Paper%20(2024).pdf}" in bib
    assert r"\%20" not in bib


def test_round1_critic_be_06_teacher_join_code_batch_reload_and_lazy_main_app(
    isolated_app_env,
) -> None:
    import subprocess
    import sys

    from sqlalchemy import event

    client, _ = isolated_app_env
    teacher_id, teacher_headers = _create_user_and_headers(
        "r1_teacher_n1", role="teacher", plan_tier="ultra"
    )

    s = session_mod.get_session()
    try:
        for idx in range(12):
            s.add(
                Class(
                    name=f"BatchClass-{idx}",
                    teacher_id=teacher_id,
                    join_code=None if idx == 0 else f"CITRA-90{idx:02d}",
                )
            )
        s.commit()
    finally:
        s.close()

    # 1. CRITIC-BE-06: list_my_classes with 1 missing join_code across 12 classes must NOT trigger
    #    11 per-row lazy SELECTs on classes after repo.commit()!
    select_class_by_pk_count = 0
    eng = session_mod.get_engine()

    def _count_sql(_conn, _cursor, statement, _parameters, _context, _executemany) -> None:
        nonlocal select_class_by_pk_count
        norm = " ".join(str(statement).split()).upper()
        if norm.startswith("SELECT") and "FROM CLASSES WHERE CLASSES.ID =" in norm:
            select_class_by_pk_count += 1

    event.listen(eng, "before_cursor_execute", _count_sql)
    try:
        res_cls = client.get("/api/teacher/classes", headers=teacher_headers)
        assert res_cls.status_code == 200
        assert len(res_cls.json()) == 12
        assert all(item["join_code"] for item in res_cls.json())
        assert select_class_by_pk_count <= 1, (
            f"Expected batch reload (<=1 per-PK SELECT), got {select_class_by_pk_count}"
        )
    finally:
        event.remove(eng, "before_cursor_execute", _count_sql)

    # 2. #65 Standards Breach 1 & Spec Defect 3:
    #    - Unrequested GET / endpoint removed (404)
    assert client.get("/").status_code == 404

    #    - Importing integrity_checker.api.main in a clean subprocess has ZERO _app_instance
    #      eager creation until main.app or main.get_app() is accessed!
    proc = subprocess.run(
        [
            sys.executable,
            "-c",
            (
                "import integrity_checker.api.main as m; "
                "assert m._app_instance is None, f'Expected lazy None, got {m._app_instance!r}'"
            ),
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    assert proc.returncode == 0, f"Lazy import check failed: {proc.stderr or proc.stdout}"


# ==============================================================================
# ROUND-2 CRITIC & REVIEWER REGRESSION TESTS (CRITIC-BE-R1-01 & CRITIC-BE-R1-02)
# ==============================================================================


def test_round2_critic_be_r1_01_docx_duplicate_content_types_shadowing_and_comment_dtd() -> None:
    import warnings

    valid_doc_xml = (
        b'<?xml version="1.0"?>'
        b'<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>'
    )
    clean_ct_xml = (
        b'<?xml version="1.0"?>'
        b'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        b'<Default Extension="xml" ContentType="application/xml"/>'
        b"</Types>"
    )
    shadow_ct_xml = (
        b'<?xml version="1.0"?>'
        b'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        b'<Default Extension="xml" ContentType="application/xml"/>'
        b'<Override PartName="/word/comments.bin" '
        b'ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/>'
        b"</Types>"
    )
    long_comment_dtd_payload = (
        b"<!-- " + (b"padding-" * 90) + b" -->\n"
        b'<!DOCTYPE bomb [<!ENTITY a "lollollol">]>'
        b'<w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        b"&a;</w:comments>"
    )

    # 1. Duplicate [Content_Types].xml central-directory shadowing + >600B comment before <!DOCTYPE
    shadow_buf = io.BytesIO()
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", UserWarning)
        with zipfile.ZipFile(shadow_buf, "w", zipfile.ZIP_DEFLATED) as zf:
            zf.writestr("[Content_Types].xml", clean_ct_xml)
            zf.writestr("word/document.xml", valid_doc_xml)
            zf.writestr("word/comments.bin", long_comment_dtd_payload)
            zf.writestr("[Content_Types].xml", shadow_ct_xml)
    assert _docx_xml_is_safe(io.BytesIO(shadow_buf.getvalue())) is False

    # 2. Single [Content_Types].xml + disguised non-.xml entry starting with >600B <!-- comment --> + <!DOCTYPE
    comment_buf = io.BytesIO()
    with zipfile.ZipFile(comment_buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("[Content_Types].xml", clean_ct_xml)
        zf.writestr("word/document.xml", valid_doc_xml)
        zf.writestr("word/unindexed_part.bin", long_comment_dtd_payload)
    assert _docx_xml_is_safe(io.BytesIO(comment_buf.getvalue())) is False

    # 3. Cross-chunk-boundary (>64KB) <!DOCTYPE / <!ENTITY inside an unindexed entry -> False
    boundary_buf = io.BytesIO()
    cross_chunk_payload = (b"X" * 65532) + b'<!DOCTYPE foo [<!ENTITY e "1">]><r/>'
    with zipfile.ZipFile(boundary_buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("[Content_Types].xml", clean_ct_xml)
        zf.writestr("word/document.xml", valid_doc_xml)
        zf.writestr("custom/chunk_boundary.dat", cross_chunk_payload)
    assert _docx_xml_is_safe(io.BytesIO(boundary_buf.getvalue())) is False


def test_round2_critic_be_r1_02_dual_sse_subscribers_converge_on_auto_retry(
    isolated_app_env, monkeypatch: pytest.MonkeyPatch
) -> None:
    _, tmp_path = isolated_app_env
    uid, _ = _create_user_and_headers("r2_dual_sse_user", plan_tier="pro")

    # Verify isolated_app_env redirected UPLOADS_DIR into tmp_path (QA-04)
    assert str(tmp_path) in str(essays_mod.UPLOADS_DIR)

    s = session_mod.get_session()
    try:
        repo = Repository(s)
        user = s.get(User, uid)
        assert user is not None
        user.monthly_uploads_used = 2
        e_recover = repo.create_essay("dual_sse_recover.pdf", num_pages=2)
        e_recover.user_id = uid
        e_recover.quota_charged = True
        e_recover.job_status = "processing"
        e_fail2 = repo.create_essay("dual_sse_fail_twice.pdf", num_pages=2)
        e_fail2.user_id = uid
        e_fail2.quota_charged = True
        e_fail2.job_status = "processing"
        s.commit()
        eid_recover = int(e_recover.id)
        eid_fail2 = int(e_fail2.id)
    finally:
        s.close()

    for eid in (eid_recover, eid_fail2):
        up = essays_mod._get_persisted_upload_path(eid)
        up.parent.mkdir(parents=True, exist_ok=True)
        up.write_bytes(b"%PDF-1.4 dummy")
        assert str(tmp_path) in str(up)

    monkeypatch.setattr(essays_mod, "is_test_runtime", lambda: False)
    monkeypatch.setenv("CITRA_WORKER_MODE", "inline")
    tracker = essays_mod.get_tracker()

    async def _collect_sse_frames(eid: int) -> list[dict]:
        fake_req = MagicMock()

        async def _not_disconnected() -> bool:
            return False

        fake_req.is_disconnected = _not_disconnected
        s_sse = session_mod.get_session()
        u_sse = s_sse.get(User, uid)
        assert u_sse is not None
        resp = await essays_mod.stream_essay_events(
            essay_id=eid,
            request=fake_req,
            current_user=u_sse,
            db=s_sse,
        )
        frames: list[dict] = []
        async for raw_chunk in resp.body_iterator:
            chunk_str = (
                raw_chunk.decode("utf-8") if isinstance(raw_chunk, bytes) else str(raw_chunk)
            )
            for line in chunk_str.splitlines():
                if line.startswith("data: "):
                    frames.append(json.loads(line[6:]))
        return frames

    # Sub-case A: Attempt #1 fails with disk I/O error, Attempt #2 SUCCEEDS -> BOTH concurrent SSE
    # subscribers must converge on status=="completed" (neither may emit a false terminal "failed"!)
    recover_calls = {"count": 0}

    class _FailOnceThenSucceedPipeline:
        async def run_async(self, *args, **kwargs):
            recover_calls["count"] += 1
            if recover_calls["count"] == 1:
                raise OperationalError("SELECT 1", {}, Exception("disk I/O error"))
            rep = MagicMock()
            rep.num_pages = 2
            rep.extracted_citations = []
            rep.verdicts = []
            rep.style_profile = {"style": "APA", "confidence": 1.0}
            rep.cis = {"score": 95.0, "components": {}, "num_citations": 0, "num_unresolved": 0}
            rep.document_diagnostics = None
            return rep

    monkeypatch.setattr(essays_mod, "get_pipeline", lambda: _FailOnceThenSucceedPipeline())
    tracker.init(eid_recover, is_retry=False)

    async def _run_subcase_a() -> tuple[list[dict], list[dict]]:
        t1 = asyncio.create_task(_collect_sse_frames(eid_recover))
        t2 = asyncio.create_task(_collect_sse_frames(eid_recover))
        await asyncio.sleep(0.02)
        await essays_mod._run_pipeline_task(
            essay_id=eid_recover,
            tmp_path=str(essays_mod._get_persisted_upload_path(eid_recover)),
            user_id=uid,
            pipeline=_FailOnceThenSucceedPipeline(),
            cleanup_file=False,
        )
        return await asyncio.gather(t1, t2)

    try:
        frames_a1, frames_a2 = asyncio.run(_run_subcase_a())
        assert recover_calls["count"] == 2
        assert frames_a1[-1]["status"] == "completed"
        assert frames_a2[-1]["status"] == "completed"
        assert all(f["status"] != "failed" for f in frames_a1)
        assert all(f["status"] != "failed" for f in frames_a2)
    finally:
        tracker.clear(eid_recover)

    # Sub-case B: Attempt #1 AND Attempt #2 both fail with disk I/O error -> BOTH concurrent SSE
    # subscribers must converge on post-retry "failed" with quota_charged==False & 1x refund!
    fail2_calls = {"count": 0}

    class _AlwaysDiskIoPipeline2:
        async def run_async(self, *args, **kwargs):
            fail2_calls["count"] += 1
            raise OperationalError("SELECT 1", {}, Exception("disk I/O error"))

    monkeypatch.setattr(essays_mod, "get_pipeline", lambda: _AlwaysDiskIoPipeline2())
    tracker.init(eid_fail2, is_retry=False)

    async def _run_subcase_b() -> tuple[list[dict], list[dict]]:
        t1 = asyncio.create_task(_collect_sse_frames(eid_fail2))
        t2 = asyncio.create_task(_collect_sse_frames(eid_fail2))
        await asyncio.sleep(0.02)
        await essays_mod._run_pipeline_task(
            essay_id=eid_fail2,
            tmp_path=str(essays_mod._get_persisted_upload_path(eid_fail2)),
            user_id=uid,
            pipeline=_AlwaysDiskIoPipeline2(),
            cleanup_file=False,
        )
        return await asyncio.gather(t1, t2)

    try:
        frames_b1, frames_b2 = asyncio.run(_run_subcase_b())
        assert fail2_calls["count"] == 2
        assert frames_b1[-1]["status"] == "failed"
        assert frames_b2[-1]["status"] == "failed"
        assert frames_b1[-1].get("quota_charged") is False
        assert frames_b2[-1].get("quota_charged") is False
        s_check = session_mod.get_session()
        try:
            u_after = s_check.get(User, uid)
            assert u_after is not None and u_after.monthly_uploads_used == 1
        finally:
            s_check.close()
    finally:
        tracker.clear(eid_fail2)


