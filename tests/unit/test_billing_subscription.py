"""Unit & Integration tests for Premium Subscription Tiers, Quotas & Stripe Demo Billing."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from io import BytesIO
from unittest.mock import patch

import fitz
import pytest
from fastapi.testclient import TestClient

from integrity_checker.api.main import app
from integrity_checker.db.models import (
    AuditLog,
    BillingTransaction,
    CitationRecord,
    ClassMembership,
    EssayRecord,
    PromoCode,
    PromoRedemption,
    User,
    VerdictRecord,
)
from integrity_checker.db.models import (
    Class as ClassModel,
)
from integrity_checker.db.models import (
    Session as SessionModel,
)
from integrity_checker.db.repository import Repository
from integrity_checker.db.session import get_session


def _make_pdf_bytes(num_pages: int = 1) -> bytes:
    """Create a valid in-memory PDF with the specified number of pages using PyMuPDF."""
    doc = fitz.open()
    for i in range(num_pages):
        page = doc.new_page()
        page.insert_text((72, 72), f"CITRA Test Manuscript Page {i + 1}\nVaswani et al. (2017)")
    pdf_bytes = doc.tobytes()
    doc.close()
    return pdf_bytes


@pytest.fixture(autouse=True)
def clean_db():
    """Ensure clean database state before each test."""
    session = get_session()
    session.query(PromoRedemption).delete()
    session.query(PromoCode).delete()
    session.query(BillingTransaction).delete()
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


def _login_user(client: TestClient, username: str = "user", password: str = "user123") -> tuple[str, dict]:
    resp = client.post("/api/auth/login", json={"username": username, "password": password})
    assert resp.status_code == 200, resp.text
    data = resp.json()
    return data["token"], data["user"]


def test_public_billing_plans_catalog() -> None:
    """GET /api/billing/plans returns Basic ($0), Pro ($20/mo, $192/yr), Ultra ($200/mo, $1920/yr)."""
    client = TestClient(app)
    resp = client.get("/api/billing/plans")
    assert resp.status_code == 200
    data = resp.json()
    plans = {p["tier"]: p for p in data["plans"]}
    assert list(plans.keys()) == ["basic", "pro", "ultra"]

    # Basic
    assert plans["basic"]["monthly_price_usd"] == 0
    assert plans["basic"]["max_uploads_per_month"] == 3
    assert plans["basic"]["max_file_size_mb"] == 5
    assert plans["basic"]["max_pages_per_pdf"] == 15
    assert plans["basic"]["allowed_export_formats"] == ["json"]

    # Pro ($20/mo, $16/mo annual = $192/yr, save $48 / 20%)
    assert plans["pro"]["monthly_price_usd"] == 20
    assert plans["pro"]["annual_price_usd"] == 192
    assert plans["pro"]["annual_monthly_equiv_usd"] == 16
    assert plans["pro"]["annual_savings_usd"] == 48
    assert plans["pro"]["annual_discount_pct"] == 20
    assert plans["pro"]["highlighted"] is True
    assert plans["pro"]["max_uploads_per_month"] == 50
    assert plans["pro"]["max_file_size_mb"] == 25
    assert plans["pro"]["max_pages_per_pdf"] == 100
    assert set(plans["pro"]["allowed_export_formats"]) == {"json", "csv", "pdf", "docx"}

    # Ultra ($200/mo, $160/mo annual = $1920/yr, save $480 / 20%)
    assert plans["ultra"]["monthly_price_usd"] == 200
    assert plans["ultra"]["annual_price_usd"] == 1920
    assert plans["ultra"]["annual_monthly_equiv_usd"] == 160
    assert plans["ultra"]["annual_savings_usd"] == 480
    assert plans["ultra"]["max_uploads_per_month"] == 1000
    assert plans["ultra"]["max_file_size_mb"] == 100
    assert plans["ultra"]["max_pages_per_pdf"] == 500


def test_default_user_starts_on_basic_plan() -> None:
    """Standard student ('user') logs in with plan_tier='basic' and 3 monthly uploads quota."""
    client = TestClient(app)
    token, user_data = _login_user(client, "user", "user123")
    assert user_data["plan_tier"] == "basic"
    assert user_data["quota"]["monthly_uploads_used"] == 0
    assert user_data["quota"]["monthly_uploads_limit"] == 3
    assert user_data["quota"]["max_file_size_mb"] == 5
    assert user_data["quota"]["max_pages_per_pdf"] == 15
    assert user_data["quota"]["allow_deep_inspector"] is False

    me_resp = client.get("/api/users/me", headers={"Authorization": f"Bearer {token}"})
    assert me_resp.status_code == 200
    assert me_resp.json()["plan_tier"] == "basic"


def test_basic_user_monthly_upload_quota_enforcement() -> None:
    """Basic user can upload 3 PDFs/month; the 4th upload is blocked with HTTP 402."""
    client = TestClient(app)
    token, _ = _login_user(client, "user", "user123")
    pdf_bytes = _make_pdf_bytes(num_pages=2)

    with patch("integrity_checker.api.routes.essays._run_pipeline_task"):
        for i in range(3):
            resp = client.post(
                "/api/essays",
                files={"file": (f"draft_{i + 1}.pdf", BytesIO(pdf_bytes), "application/pdf")},
                headers={"Authorization": f"Bearer {token}"},
            )
            assert resp.status_code == 200, f"Upload {i + 1} failed: {resp.text}"

        # 4th upload must be rejected with 402 Payment Required
        resp_4th = client.post(
            "/api/essays",
            files={"file": ("draft_4.pdf", BytesIO(pdf_bytes), "application/pdf")},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp_4th.status_code == 402
        assert "3/3" in resp_4th.json()["detail"]


def test_basic_user_file_size_and_page_limit_enforcement() -> None:
    """Basic user is limited to 5 MB and 15 pages per PDF."""
    client = TestClient(app)
    token, _ = _login_user(client, "user", "user123")

    # 1. 18-page PDF exceeds Basic 15-page limit -> HTTP 402
    pdf_18_pages = _make_pdf_bytes(num_pages=18)
    with patch("integrity_checker.api.routes.essays._run_pipeline_task"):
        resp_pages = client.post(
            "/api/essays",
            files={"file": ("long_thesis.pdf", BytesIO(pdf_18_pages), "application/pdf")},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp_pages.status_code == 402
        assert "18 pages" in resp_pages.json()["detail"]
        assert "15 pages" in resp_pages.json()["detail"]

        # 2. >5 MB file exceeds Basic 5 MB limit -> HTTP 413
        oversized_6mb = b"%PDF-1.4\n" + (b"0" * (6 * 1024 * 1024))
        resp_size = client.post(
            "/api/essays",
            files={"file": ("huge_6mb.pdf", BytesIO(oversized_6mb), "application/pdf")},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp_size.status_code == 413
        assert "5MB" in resp_size.json()["detail"]


def test_basic_user_export_format_gating() -> None:
    """Basic user can view JSON report (for web UI) but cannot export PDF, DOCX, or CSV."""
    client = TestClient(app)
    token, user_data = _login_user(client, "user", "user123")

    session = get_session()
    repo = Repository(session)
    essay = repo.create_essay_with_user("student_essay.pdf", 3, user_id=user_data["id"])
    session.add(
        VerdictRecord(
            essay_id=essay.id,
            citation_raw="Vaswani et al. (2017)",
            label="verified",
            confidence=0.95,
            reasoning="Confirmed in Crossref",
            triggered_rules="[]",
            mismatched_fields="[]",
            features="{}",
            mapping_status="matched",
            mapping_confidence=1.0,
        )
    )
    session.commit()
    essay_id = essay.id
    session.close()

    # JSON is allowed for web report rendering
    json_resp = client.get(
        f"/api/essays/{essay_id}/report?format=json",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert json_resp.status_code == 200

    # PDF, DOCX, CSV are locked for Basic users -> 402
    for fmt in ("pdf", "docx", "csv"):
        locked_resp = client.get(
            f"/api/essays/{essay_id}/report?format={fmt}",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert locked_resp.status_code == 402
        assert fmt.upper() in locked_resp.json()["detail"]


def test_stripe_demo_checkout_upgrade_to_pro_and_ultra() -> None:
    """End-to-end Stripe Demo flow: Basic user Exhausts Quota -> Upgrades to Pro Annual -> Unlocks 50 uploads & Exports."""
    client = TestClient(app)
    token, user_data = _login_user(client, "user", "user123")
    headers = {"Authorization": f"Bearer {token}"}

    # Exhaust 3 free uploads
    session = get_session()
    db_user = session.get(User, user_data["id"])
    assert db_user is not None
    db_user.monthly_uploads_used = 3
    db_user.quota_reset_at = datetime.now(UTC) + timedelta(days=20)
    essay = Repository(session).create_essay_with_user("essay.pdf", 5, user_id=db_user.id)
    essay_id = essay.id
    session.commit()
    session.close()

    # Step 1: Create Stripe Demo Checkout Session for Pro Annual ($192/yr)
    create_resp = client.post(
        "/api/billing/create-checkout-session",
        json={"plan_tier": "pro", "billing_cycle": "annual", "force_demo": True},
        headers=headers,
    )
    assert create_resp.status_code == 200
    checkout_data = create_resp.json()
    session_id = checkout_data["session_id"]
    assert session_id.startswith("cs_test_demo_")
    assert checkout_data["amount_usd"] == 192.0
    assert checkout_data["plan_tier"] == "pro"
    assert checkout_data["billing_cycle"] == "annual"

    # Step 2: Fetch Checkout Session Details (as rendered by StripeDemoCheckoutPage)
    details_resp = client.get(f"/api/billing/checkout-session/{session_id}", headers=headers)
    assert details_resp.status_code == 200
    details = details_resp.json()
    assert details["status"] == "pending"
    assert details["monthly_equivalent_usd"] == 16
    assert details["annual_savings_usd"] == 48

    # Step 3: Complete payment via verify-session with Visa 4242
    verify_resp = client.post(
        "/api/billing/verify-session",
        json={"session_id": session_id, "card_last4": "4242", "card_brand": "visa"},
        headers=headers,
    )
    assert verify_resp.status_code == 200
    verified = verify_resp.json()
    assert verified["status"] == "succeeded"
    assert verified["subscription"]["plan_tier"] == "pro"
    assert verified["subscription"]["billing_cycle"] == "annual"
    assert verified["subscription"]["quota"]["monthly_uploads_limit"] == 50
    assert verified["subscription"]["quota"]["allow_deep_inspector"] is True
    assert verified["transaction"]["card_last4"] == "4242"

    # Both /api/auth/me and /api/users/me return the updated subscription & quota on page reload
    for me_endpoint in ("/api/auth/me", "/api/users/me"):
        me_resp = client.get(me_endpoint, headers=headers)
        assert me_resp.status_code == 200
        me_json = me_resp.json()
        assert me_json["plan_tier"] == "pro"
        assert me_json["billing_cycle"] == "annual"
        assert me_json["quota"]["monthly_uploads_limit"] == 50
        assert me_json["quota"]["allow_deep_inspector"] is True

    # Step 4: Verify user can now upload a 20-page PDF (4th upload of the month) AND export PDF/DOCX/CSV
    pdf_20_pages = _make_pdf_bytes(num_pages=20)
    with patch("integrity_checker.api.routes.essays._run_pipeline_task"):
        upload_resp = client.post(
            "/api/essays",
            files={"file": ("pro_thesis.pdf", BytesIO(pdf_20_pages), "application/pdf")},
            headers=headers,
        )
        assert upload_resp.status_code == 200

    for fmt in ("pdf", "docx", "csv"):
        export_resp = client.get(f"/api/essays/{essay_id}/report?format={fmt}", headers=headers)
        assert export_resp.status_code == 200

    # Step 5: Upgrade to Ultra Monthly ($200/mo)
    ultra_checkout = client.post(
        "/api/billing/create-checkout-session",
        json={"plan_tier": "ultra", "billing_cycle": "monthly", "force_demo": True},
        headers=headers,
    ).json()
    assert ultra_checkout["amount_usd"] == 200.0
    ultra_verify = client.post(
        "/api/billing/verify-session",
        json={"session_id": ultra_checkout["session_id"], "card_last4": "5555", "card_brand": "mastercard"},
        headers=headers,
    ).json()
    assert ultra_verify["subscription"]["plan_tier"] == "ultra"
    assert ultra_verify["subscription"]["quota"]["monthly_uploads_limit"] == 1000
    assert ultra_verify["subscription"]["quota"]["max_pages_per_pdf"] == 500


def test_subscription_cancel_and_reactivate_lifecycle() -> None:
    """User can cancel at period end, reactivate auto-renewal, or cancel immediately."""
    client = TestClient(app)
    token, _ = _login_user(client, "user", "user123")
    headers = {"Authorization": f"Bearer {token}"}

    # Upgrade to Pro Monthly
    checkout = client.post(
        "/api/billing/create-checkout-session",
        json={"plan_tier": "pro", "billing_cycle": "monthly", "force_demo": True},
        headers=headers,
    ).json()
    client.post(
        "/api/billing/verify-session",
        json={"session_id": checkout["session_id"]},
        headers=headers,
    )

    # Cancel at period end (retains Pro benefits until period end)
    cancel_resp = client.post("/api/billing/cancel", json={"immediate": False}, headers=headers)
    assert cancel_resp.status_code == 200
    sub = cancel_resp.json()["subscription"]
    assert sub["plan_tier"] == "pro"
    assert sub["cancel_at_period_end"] is True

    # Reactivate auto-renewal
    react_resp = client.post("/api/billing/reactivate", headers=headers)
    assert react_resp.status_code == 200
    assert react_resp.json()["subscription"]["cancel_at_period_end"] is False

    # Immediate downgrade to Basic
    imm_resp = client.post("/api/billing/cancel", json={"immediate": True}, headers=headers)
    assert imm_resp.status_code == 200
    assert imm_resp.json()["subscription"]["plan_tier"] == "basic"
    assert imm_resp.json()["subscription"]["quota"]["monthly_uploads_limit"] == 3


def test_admin_promo_code_crud_and_rbac_enforcement() -> None:
    """Admin can generate, create, update, toggle, and delete 6-char promo codes; non-admins get 403."""
    client = TestClient(app)
    user_token, _ = _login_user(client, "user", "user123")
    admin_token, _ = _login_user(client, "admin", "admin123")

    user_headers = {"Authorization": f"Bearer {user_token}"}
    admin_headers = {"Authorization": f"Bearer {admin_token}"}

    # 1. Non-admin is strictly blocked with 403
    assert client.get("/api/billing/admin/promos", headers=user_headers).status_code == 403
    assert (
        client.post(
            "/api/billing/admin/promos",
            json={"code": "SAVE20", "discount_type": "percent", "discount_value": 20},
            headers=user_headers,
        ).status_code
        == 403
    )

    # 2. Admin can auto-generate a random 6-character code
    gen_resp = client.get("/api/billing/admin/promos/generate-code", headers=admin_headers)
    assert gen_resp.status_code == 200
    gen_code = gen_resp.json()["code"]
    assert len(gen_code) == 6
    assert gen_code.isalnum() and gen_code.isupper()

    # 3. Invalid code lengths (<6 or >6 or non-alphanumeric) are rejected with 400
    for invalid_code in ("SHORT", "TOOLONG7", "AB-123", "AB_123"):
        bad_resp = client.post(
            "/api/billing/admin/promos",
            json={"code": invalid_code, "discount_type": "percent", "discount_value": 20},
            headers=admin_headers,
        )
        assert bad_resp.status_code == 400
        assert "6" in bad_resp.json()["detail"]

    # 4. Admin creates a valid 6-char promo code 'SAVE25' (lowercase input normalized to uppercase)
    create_resp = client.post(
        "/api/billing/admin/promos",
        json={
            "code": "save25",
            "description": "Academic Spring 25% Discount",
            "discount_type": "percent",
            "discount_value": 25.0,
            "max_discount_usd": 40.0,
            "min_amount_usd": 15.0,
            "applicable_tiers": "all",
            "applicable_cycles": "all",
            "max_uses": 10,
            "max_uses_per_user": 1,
            "is_active": True,
        },
        headers=admin_headers,
    )
    assert create_resp.status_code == 201, create_resp.text
    promo = create_resp.json()
    promo_id = promo["id"]
    assert promo["code"] == "SAVE25"
    assert promo["discount_type"] == "percent"
    assert promo["discount_value"] == 25.0
    assert promo["max_discount_usd"] == 40.0
    assert promo["effective_status"] == "active"

    # 5. Duplicate code creation rejected with 409
    dup_resp = client.post(
        "/api/billing/admin/promos",
        json={"code": "SAVE25", "discount_type": "fixed", "discount_value": 10},
        headers=admin_headers,
    )
    assert dup_resp.status_code == 409

    # 6. Admin toggles is_active=False and updates description
    patch_resp = client.patch(
        f"/api/billing/admin/promos/{promo_id}",
        json={"is_active": False, "description": "Paused Campaign"},
        headers=admin_headers,
    )
    assert patch_resp.status_code == 200
    assert patch_resp.json()["is_active"] is False
    assert patch_resp.json()["effective_status"] == "inactive"
    assert patch_resp.json()["description"] == "Paused Campaign"

    # 7. Admin lists promos and deletes the code
    list_resp = client.get("/api/billing/admin/promos", headers=admin_headers)
    assert list_resp.status_code == 200
    assert list_resp.json()["stats"]["total_codes"] == 1

    del_resp = client.delete(f"/api/billing/admin/promos/{promo_id}", headers=admin_headers)
    assert del_resp.status_code == 200
    assert del_resp.json()["deleted_id"] == promo_id


def test_promo_code_checkout_redemption_and_business_rules() -> None:
    """Test applying/removing 6-char promo codes on checkout, discount caps, limits, expiry, and per-user caps."""
    client = TestClient(app)
    admin_token, _ = _login_user(client, "admin", "admin123")
    user_token, _ = _login_user(client, "user", "user123")
    admin_headers = {"Authorization": f"Bearer {admin_token}"}
    user_headers = {"Authorization": f"Bearer {user_token}"}

    # Admin creates:
    # 1) 'PRO50X' -> 50% off Pro plan, max_discount_usd=$60, max_uses=1, max_uses_per_user=1
    client.post(
        "/api/billing/admin/promos",
        json={
            "code": "PRO50X",
            "description": "50% off Pro capped at $60",
            "discount_type": "percent",
            "discount_value": 50,
            "max_discount_usd": 60,
            "applicable_tiers": "pro",
            "applicable_cycles": "all",
            "max_uses": 1,
            "max_uses_per_user": 1,
        },
        headers=admin_headers,
    )
    # 2) 'EXPRD1' -> already expired code
    client.post(
        "/api/billing/admin/promos",
        json={
            "code": "EXPRD1",
            "discount_type": "fixed",
            "discount_value": 10,
            "expires_at": (datetime.now(UTC) - timedelta(days=1)).isoformat(),
        },
        headers=admin_headers,
    )

    # User creates a Pro Annual checkout session ($192.00)
    session_resp = client.post(
        "/api/billing/create-checkout-session",
        json={"plan_tier": "pro", "billing_cycle": "annual", "force_demo": True},
        headers=user_headers,
    )
    assert session_resp.status_code == 200
    session_id = session_resp.json()["session_id"]
    assert session_resp.json()["subtotal_usd"] == 192.0
    assert session_resp.json()["amount_usd"] == 192.0

    # Expired promo code is rejected
    exp_apply = client.post(
        f"/api/billing/checkout-session/{session_id}/promo",
        json={"code": "EXPRD1"},
        headers=user_headers,
    )
    assert exp_apply.status_code == 400
    assert "expired" in exp_apply.json()["detail"].lower()

    # Apply 'PRO50X' on $192.00 -> 50% is $96, capped at $60.00 -> final $132.00
    apply_resp = client.post(
        f"/api/billing/checkout-session/{session_id}/promo",
        json={"code": "pro50x"},
        headers=user_headers,
    )
    assert apply_resp.status_code == 200
    details = apply_resp.json()
    assert details["promo_code"] == "PRO50X"
    assert details["subtotal_usd"] == 192.0
    assert details["discount_usd"] == 60.0
    assert details["amount_usd"] == 132.0

    # Remove promo code -> restores $192.00
    remove_resp = client.post(
        f"/api/billing/checkout-session/{session_id}/promo",
        json={"code": ""},
        headers=user_headers,
    )
    assert remove_resp.status_code == 200
    assert remove_resp.json()["promo_code"] is None
    assert remove_resp.json()["discount_usd"] == 0.0
    assert remove_resp.json()["amount_usd"] == 192.0

    # Re-apply 'PRO50X' and finalize payment via Apple Pay
    client.post(
        f"/api/billing/checkout-session/{session_id}/promo",
        json={"code": "PRO50X"},
        headers=user_headers,
    )
    verify_resp = client.post(
        "/api/billing/verify-session",
        json={
            "session_id": session_id,
            "payment_method": "apple_pay",
            "card_brand": "visa",
            "card_last4": "4242",
            "billing_country": "VN",
        },
        headers=user_headers,
    )
    assert verify_resp.status_code == 200
    tx = verify_resp.json()["transaction"]
    assert tx["promo_code"] == "PRO50X"
    assert tx["subtotal_usd"] == 192.0
    assert tx["discount_usd"] == 60.0
    assert tx["amount_usd"] == 132.0
    assert tx["payment_method"] == "apple_pay"

    # Trying to use 'PRO50X' again on a new session fails (exhausted / already used)
    session_2 = client.post(
        "/api/billing/create-checkout-session",
        json={"plan_tier": "pro", "billing_cycle": "monthly", "force_demo": True},
        headers=user_headers,
    ).json()["session_id"]
    second_try = client.post(
        f"/api/billing/checkout-session/{session_2}/promo",
        json={"code": "PRO50X"},
        headers=user_headers,
    )
    assert second_try.status_code == 400


def test_apple_pay_google_pay_and_pci_dss_security_guard() -> None:
    """Verify Google Pay, Apple Pay, and PCI-DSS guard against raw card numbers or CVV."""
    client = TestClient(app)
    token, _ = _login_user(client, "user", "user123")
    headers = {"Authorization": f"Bearer {token}"}

    checkout = client.post(
        "/api/billing/create-checkout-session",
        json={"plan_tier": "ultra", "billing_cycle": "monthly", "force_demo": True},
        headers=headers,
    ).json()
    session_id = checkout["session_id"]

    # 1. PCI-DSS violation: sending raw card_number or cvc in payload must be rejected (HTTP 422)
    pci_bad_1 = client.post(
        "/api/billing/verify-session",
        json={
            "session_id": session_id,
            "card_number": "4242424242424242",
            "cvc": "424",
        },
        headers=headers,
    )
    assert pci_bad_1.status_code == 422

    # 2. PCI-DSS violation: sending >4 digits in card_last4 must be rejected (HTTP 422)
    pci_bad_2 = client.post(
        "/api/billing/verify-session",
        json={
            "session_id": session_id,
            "card_last4": "4242424242424242",
        },
        headers=headers,
    )
    assert pci_bad_2.status_code == 422

    # 3. Valid Google Pay verification succeeds and records payment_method='google_pay'
    gpay_ok = client.post(
        "/api/billing/verify-session",
        json={
            "session_id": session_id,
            "payment_method": "google_pay",
            "card_brand": "mastercard",
            "card_last4": "4444",
            "billing_country": "US",
            "billing_zip": "94103",
        },
        headers=headers,
    )
    assert gpay_ok.status_code == 200
    tx = gpay_ok.json()["transaction"]
    assert tx["payment_method"] == "google_pay"
    assert tx["card_brand"] == "mastercard"
    assert tx["card_last4"] == "4444"
    assert tx["billing_country"] == "US"
    assert tx["billing_zip"] == "94103"


def test_vnpay_payment_url_cryptographic_signing_and_promo_vnd_conversion() -> None:
    """Verify VNPay v2.1.0 URL generation, HMAC-SHA512 checksum signing, and USD->VND conversion with promo codes."""
    from integrity_checker.billing.vnpay import get_vnpay_service

    client = TestClient(app)
    admin_token, _ = _login_user(client, "admin", "admin123")
    token, _ = _login_user(client, "user", "user123")
    admin_headers = {"Authorization": f"Bearer {admin_token}"}
    headers = {"Authorization": f"Bearer {token}"}

    # Seed 'CITRA2' (-20% off) via admin endpoint
    client.post(
        "/api/billing/admin/promos",
        json={
            "code": "CITRA2",
            "description": "20% off academic research plan",
            "discount_type": "percent",
            "discount_value": 20,
            "applicable_tiers": "all",
            "applicable_cycles": "all",
        },
        headers=admin_headers,
    )

    # 1. Create Pro Annual checkout session ($192.00 USD = 4,800,000 VND)
    checkout = client.post(
        "/api/billing/create-checkout-session",
        json={"plan_tier": "pro", "billing_cycle": "annual", "force_demo": True},
        headers=headers,
    ).json()
    session_id = checkout["session_id"]
    assert checkout["amount_usd"] == 192.0
    assert checkout["amount_vnd"] == 4800000

    # 2. Apply default seeded promo code 'CITRA2' (-20% off -> -$38.40 -> $153.60 USD = 3,840,000 VND)
    promo_resp = client.post(
        f"/api/billing/checkout-session/{session_id}/promo",
        json={"code": "CITRA2"},
        headers=headers,
    )
    assert promo_resp.status_code == 200
    promo_details = promo_resp.json()
    assert promo_details["amount_usd"] == 153.6
    assert promo_details["amount_vnd"] == 3840000
    assert promo_details["vnpay"]["vnp_amount"] == 384000000

    # 3. Generate signed VNPay Payment URL
    url_resp = client.post(
        "/api/billing/vnpay/create-payment-url",
        json={"session_id": session_id, "bank_code": "NCB", "locale": "vn"},
        headers=headers,
    )
    assert url_resp.status_code == 200, url_resp.text
    vnp_data = url_resp.json()
    assert vnp_data["amount_vnd"] == 3840000
    assert vnp_data["vnp_amount"] == 384000000
    assert vnp_data["bank_code"] == "NCB"
    assert vnp_data["vnp_txn_ref"].startswith("CITRA")
    assert vnp_data["payment_url"].startswith("https://sandbox.vnpayment.vn/paymentv2/vpcpay.html?")
    assert "vnp_SecureHash=" in vnp_data["payment_url"]
    assert len(vnp_data["vnp_params"]["vnp_SecureHash"]) == 128

    # 4. Verify signature authenticity using VNPayService
    vnpay = get_vnpay_service()
    check = vnpay.verify_return_url(vnp_data["vnp_params"])
    assert check.is_verified is True

    # 5. Tampering with vnp_Amount invalidates HMAC-SHA512 signature immediately
    tampered_params = dict(vnp_data["vnp_params"])
    tampered_params["vnp_Amount"] = "100000"
    tampered_check = vnpay.verify_return_url(tampered_params)
    assert tampered_check.is_verified is False


def test_vnpay_sandbox_authorize_cards_and_return_url_verification() -> None:
    """Test VNPay Sandbox ATM cards (00, 51, 12, wrong OTP 13), VNPAY-QR, ReturnURL verification, and PCI guard."""
    client = TestClient(app)
    token, user_data = _login_user(client, "user", "user123")
    headers = {"Authorization": f"Bearer {token}"}

    checkout = client.post(
        "/api/billing/create-checkout-session",
        json={"plan_tier": "pro", "billing_cycle": "monthly", "force_demo": True},
        headers=headers,
    ).json()
    session_id = checkout["session_id"]

    # Initialize VNPay payment URL first
    client.post(
        "/api/billing/vnpay/create-payment-url",
        json={"session_id": session_id, "bank_code": "NCB"},
        headers=headers,
    )

    # 1. Test NCB Insufficient Funds Card (9704195798621412 -> code '51')
    insufficient_resp = client.post(
        "/api/billing/vnpay/sandbox-authorize",
        json={
            "session_id": session_id,
            "bank_code": "NCB",
            "payment_channel": "atm",
            "card_number": "9704195798621412",
            "card_holder": "NGUYEN VAN A",
            "issue_date": "07/15",
            "otp_code": "123456",
        },
        headers=headers,
    )
    assert insufficient_resp.status_code == 200
    ins_data = insufficient_resp.json()
    assert ins_data["is_success"] is False
    assert ins_data["vnp_response_code"] == "51"
    assert ins_data["transaction"]["status"] == "pending"

    # 2. Test NCB Locked Card (9704193360968149 -> code '12')
    locked_resp = client.post(
        "/api/billing/vnpay/sandbox-authorize",
        json={
            "session_id": session_id,
            "bank_code": "NCB",
            "payment_channel": "atm",
            "card_number": "9704193360968149",
            "card_holder": "NGUYEN VAN A",
            "issue_date": "07/15",
            "otp_code": "123456",
        },
        headers=headers,
    )
    assert locked_resp.status_code == 200
    assert locked_resp.json()["is_success"] is False
    assert locked_resp.json()["vnp_response_code"] == "12"

    # 3. Test Wrong OTP ('999999' != '123456' -> code '13')
    wrong_otp_resp = client.post(
        "/api/billing/vnpay/sandbox-authorize",
        json={
            "session_id": session_id,
            "bank_code": "NCB",
            "payment_channel": "atm",
            "card_number": "9704198526191432198",
            "card_holder": "NGUYEN VAN A",
            "issue_date": "07/15",
            "otp_code": "999999",
        },
        headers=headers,
    )
    assert wrong_otp_resp.status_code == 200
    assert wrong_otp_resp.json()["is_success"] is False
    assert wrong_otp_resp.json()["vnp_response_code"] == "13"

    # 4. Test Official NCB Success Card (9704198526191432198 + OTP 123456 -> code '00')
    ok_resp = client.post(
        "/api/billing/vnpay/sandbox-authorize",
        json={
            "session_id": session_id,
            "bank_code": "NCB",
            "payment_channel": "atm",
            "card_number": "9704198526191432198",
            "card_holder": "NGUYEN VAN A",
            "issue_date": "07/15",
            "otp_code": "123456",
        },
        headers=headers,
    )
    assert ok_resp.status_code == 200, ok_resp.text
    ok_data = ok_resp.json()
    assert ok_data["is_verified"] is True
    assert ok_data["is_success"] is True
    assert ok_data["vnp_response_code"] == "00"
    assert ok_data["amount_vnd"] == 500000
    assert ok_data["transaction"]["status"] == "succeeded"
    assert ok_data["transaction"]["payment_method"] == "vnpay"
    assert ok_data["transaction"]["vnp_bank_code"] == "NCB"
    assert ok_data["transaction"]["card_last4"] == "2198"
    assert ok_data["subscription"]["plan_tier"] == "pro"

    # Ensure raw 19-digit ATM card number is NEVER persisted in DB
    db_session = get_session()
    db_tx = (
        db_session.query(BillingTransaction)
        .filter(BillingTransaction.stripe_session_id == session_id)
        .first()
    )
    assert db_tx is not None
    assert db_tx.card_last4 == "2198"
    assert "9704198526191432198" not in str(db_tx.__dict__)
    db_session.close()

    # 5. Verify signed ReturnURL parameters via POST /api/billing/vnpay/verify-return
    verify_ret = client.post(
        "/api/billing/vnpay/verify-return",
        json={"vnp_params": ok_data["vnp_params"], "session_id": session_id},
        headers=headers,
    )
    assert verify_ret.status_code == 200
    assert verify_ret.json()["status"] == "succeeded"
    assert verify_ret.json()["is_verified"] is True

    # 6. Verify GET /api/billing/vnpay/return redirects (302) to /billing/success
    get_ret = client.get(
        "/api/billing/vnpay/return",
        params=ok_data["vnp_params"],
        follow_redirects=False,
    )
    assert get_ret.status_code == 302
    assert "/billing/success" in get_ret.headers["location"]


def test_vnpay_ipn_webhook_security_tamper_and_idempotency_guards() -> None:
    """Verify VNPay IPN GET endpoint RspCodes: 97 (Checksum), 01 (NotFound), 04 (InvalidAmount), 00 (Success), 02 (AlreadyConfirmed)."""
    from integrity_checker.billing.vnpay import get_vnpay_service

    vnpay = get_vnpay_service()
    client = TestClient(app)
    token, _ = _login_user(client, "user", "user123")
    headers = {"Authorization": f"Bearer {token}"}

    # Create a Pro Monthly session ($20 = 500,000 VND -> vnp_Amount = 50000000)
    checkout = client.post(
        "/api/billing/create-checkout-session",
        json={"plan_tier": "pro", "billing_cycle": "monthly", "force_demo": True},
        headers=headers,
    ).json()
    session_id = checkout["session_id"]
    url_data = client.post(
        "/api/billing/vnpay/create-payment-url",
        json={"session_id": session_id, "bank_code": "NCB"},
        headers=headers,
    ).json()
    vnp_txn_ref = url_data["vnp_txn_ref"]

    # 1. Invalid Checksum -> RspCode '97'
    bad_hash_params = vnpay.build_signed_return_params(
        vnp_txn_ref=vnp_txn_ref,
        amount_vnd=500000,
        response_code="00",
    )
    bad_hash_params["vnp_SecureHash"] = "0" * 128
    ipn_97 = client.get("/api/billing/vnpay/ipn", params=bad_hash_params)
    assert ipn_97.status_code == 200
    assert ipn_97.json() == {"RspCode": "97", "Message": "Invalid Checksum"}

    # 2. Hash Algorithm Downgrade Attack (vnp_SecureHashType=MD5) -> RspCode '97'
    downgrade_params = vnpay.build_signed_return_params(
        vnp_txn_ref=vnp_txn_ref,
        amount_vnd=500000,
        response_code="00",
    )
    downgrade_params["vnp_SecureHashType"] = "MD5"
    ipn_downgrade = client.get("/api/billing/vnpay/ipn", params=downgrade_params)
    assert ipn_downgrade.status_code == 200
    assert ipn_downgrade.json()["RspCode"] == "97"

    # 3. Unknown Order vnp_TxnRef (with valid signature) -> RspCode '01'
    unknown_order_params = vnpay.build_signed_return_params(
        vnp_txn_ref="CITRA999999UNKNOWN",
        amount_vnd=500000,
        response_code="00",
    )
    ipn_01 = client.get("/api/billing/vnpay/ipn", params=unknown_order_params)
    assert ipn_01.status_code == 200
    assert ipn_01.json() == {"RspCode": "01", "Message": "Order not found"}

    # 4. Amount Tampering Attack (signed 10,000 VND instead of 500,000 VND) -> RspCode '04'
    wrong_amount_params = vnpay.build_signed_return_params(
        vnp_txn_ref=vnp_txn_ref,
        amount_vnd=10000,
        response_code="00",
    )
    ipn_04 = client.get("/api/billing/vnpay/ipn", params=wrong_amount_params)
    assert ipn_04.status_code == 200
    assert ipn_04.json() == {"RspCode": "04", "Message": "Invalid amount"}

    # 5. Valid IPN Call -> RspCode '00' and activates Pro subscription
    valid_ipn_params = vnpay.build_signed_return_params(
        vnp_txn_ref=vnp_txn_ref,
        amount_vnd=500000,
        response_code="00",
        bank_code="VIETCOMBANK",
        card_type="QRCODE",
    )
    ipn_00 = client.get("/api/billing/vnpay/ipn", params=valid_ipn_params)
    assert ipn_00.status_code == 200
    assert ipn_00.json() == {"RspCode": "00", "Message": "Confirm Success"}

    me_resp = client.get("/api/users/me", headers=headers)
    assert me_resp.json()["plan_tier"] == "pro"

    # 6. Duplicate/Replay IPN Call on already-confirmed order -> RspCode '02'
    ipn_02 = client.get("/api/billing/vnpay/ipn", params=valid_ipn_params)
    assert ipn_02.status_code == 200
    assert ipn_02.json() == {"RspCode": "02", "Message": "Order already confirmed"}


def test_production_rejects_demo_sessions_and_verifies_stripe_api(monkeypatch: pytest.MonkeyPatch) -> None:
    """In production runtime, demo checkout sessions are rejected with 403 and non-demo sessions verify with Stripe."""
    from unittest.mock import MagicMock

    client = TestClient(app)
    token, user_data = _login_user(client, "user", "user123")
    headers = {"Authorization": f"Bearer {token}"}

    # 1. Create a demo session
    checkout = client.post(
        "/api/billing/create-checkout-session",
        json={"plan_tier": "pro", "billing_cycle": "monthly", "force_demo": True},
        headers=headers,
    ).json()
    demo_session_id = checkout["session_id"]

    # Simulate production runtime
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.delenv("ALLOW_DEMO_CHECKOUT_IN_PROD", raising=False)
    with patch("integrity_checker.api.routes.billing.is_test_runtime", return_value=False):
        resp_demo = client.post(
            "/api/billing/verify-session",
            json={"session_id": demo_session_id},
            headers=headers,
        )
        assert resp_demo.status_code == 403
        assert "Demo checkout sessions are not allowed in production" in resp_demo.json()["detail"]

        # When ALLOW_DEMO_CHECKOUT_IN_PROD=true is explicitly set, demo session succeeds
        monkeypatch.setenv("ALLOW_DEMO_CHECKOUT_IN_PROD", "true")
        resp_demo_allowed = client.post(
            "/api/billing/verify-session",
            json={"session_id": demo_session_id},
            headers=headers,
        )
        assert resp_demo_allowed.status_code == 200

    # 2. Test Stripe API verification for non-demo session (sk_live_ / sk_test_)
    session = get_session()
    repo = Repository(session)
    live_tx = repo.create_billing_transaction(
        user_id=user_data["id"],
        stripe_session_id="cs_live_real_session_12345",
        plan_tier="ultra",
        billing_cycle="monthly",
        subtotal_usd=200.0,
        discount_usd=0.0,
        promo_code=None,
        amount_usd=200.0,
        status="pending",
        payment_mode="stripe_live",
    )
    session.commit()
    session.close()
    _ = live_tx

    monkeypatch.setenv("STRIPE_SECRET_KEY", "sk_live_testkey12345")

    mock_unpaid = MagicMock()
    mock_unpaid.status_code = 200
    mock_unpaid.json.return_value = {"id": "cs_live_real_session_12345", "payment_status": "unpaid"}

    with patch("httpx.get", return_value=mock_unpaid) as mock_get:
        resp_unpaid = client.post(
            "/api/billing/verify-session",
            json={"session_id": "cs_live_real_session_12345"},
            headers=headers,
        )
        assert resp_unpaid.status_code == 402
        mock_get.assert_called_once()

    mock_paid = MagicMock()
    mock_paid.status_code = 200
    mock_paid.json.return_value = {"id": "cs_live_real_session_12345", "payment_status": "paid"}

    with patch("httpx.get", return_value=mock_paid) as mock_get_paid:
        resp_paid = client.post(
            "/api/billing/verify-session",
            json={"session_id": "cs_live_real_session_12345"},
            headers=headers,
        )
        assert resp_paid.status_code == 200
        assert resp_paid.json()["subscription"]["plan_tier"] == "ultra"
        mock_get_paid.assert_called_once()


def test_vnpay_sandbox_disabled_in_prod_and_default_secret_rejected(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """In production, VNPay sandbox simulator is disabled (403) and default VNPay secret with external redirect is rejected."""
    from integrity_checker.billing.vnpay import (
        VNPAY_DEFAULT_HASH_SECRET,
        VNPayService,
        validate_vnpay_production_secret,
    )

    client = TestClient(app)
    token, _ = _login_user(client, "user", "user123")
    headers = {"Authorization": f"Bearer {token}"}

    checkout = client.post(
        "/api/billing/create-checkout-session",
        json={"plan_tier": "pro", "billing_cycle": "monthly", "force_demo": True},
        headers=headers,
    ).json()
    session_id = checkout["session_id"]

    # 1. Production runtime blocks /api/billing/vnpay/sandbox-authorize with 403
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.delenv("ALLOW_VNPAY_SANDBOX_IN_PROD", raising=False)
    with patch("integrity_checker.api.routes.billing.is_test_runtime", return_value=False):
        resp_sandbox = client.post(
            "/api/billing/vnpay/sandbox-authorize",
            json={
                "session_id": session_id,
                "bank_code": "NCB",
                "payment_channel": "qr",
            },
            headers=headers,
        )
        assert resp_sandbox.status_code == 403
        assert "VNPay sandbox simulator is disabled in production" in resp_sandbox.json()["detail"]

    # 2. validate_vnpay_production_secret raises ValueError when VNPAY_HASH_SECRET == VNPAY_DEFAULT_HASH_SECRET and VNPAY_EXTERNAL_REDIRECT=true
    monkeypatch.setenv("VNPAY_EXTERNAL_REDIRECT", "true")
    monkeypatch.setenv("VNPAY_HASH_SECRET", VNPAY_DEFAULT_HASH_SECRET)
    with pytest.raises(ValueError, match="VNPAY_HASH_SECRET"):
        validate_vnpay_production_secret("production")

    # Custom secret passes validation
    monkeypatch.setenv("VNPAY_HASH_SECRET", "CUSTOMPRODVNPAYSECRETKEY2026HMACSHA512OK")
    validate_vnpay_production_secret("production")

    # 3. Verify payment_mode is set to 'vnpay_live' when external_redirect=True
    vnpay_live = VNPayService()
    assert vnpay_live.external_redirect is True
    url_data = client.post(
        "/api/billing/vnpay/create-payment-url",
        json={"session_id": session_id, "bank_code": "NCB"},
        headers=headers,
    ).json()
    signed_params = vnpay_live.build_signed_return_params(
        vnp_txn_ref=url_data["vnp_txn_ref"],
        amount_vnd=500000,
        response_code="00",
    )
    ret_resp = client.post(
        "/api/billing/vnpay/verify-return",
        json={"vnp_params": signed_params, "session_id": session_id},
        headers=headers,
    )
    assert ret_resp.status_code == 200
    assert ret_resp.json()["transaction"]["payment_mode"] == "vnpay_live"


def test_sandbox_generate_pdf_enforces_upload_quota_and_reanalyze_uses_background_tasks() -> None:
    """POST /api/essays/sandbox/generate-pdf enforces monthly upload quota (402 MONTHLY_QUOTA_EXCEEDED) and increments usage; reanalyze uses BackgroundTasks outside test runtime."""
    client = TestClient(app)
    token, _ = _login_user(client, "user", "user123")
    headers = {"Authorization": f"Bearer {token}"}

    sandbox_payload = {
        "style": "apa",
        "title": "Sandbox Quota Test",
        "items": [
            {
                "title": "Attention Is All You Need",
                "authors": ["Vaswani, A.", "Shazeer, N."],
                "year": "2017",
                "venue": "NeurIPS",
                "cite_in_text": True,
                "include_in_references": True,
            }
        ],
    }

    with patch("integrity_checker.api.routes.essays._run_pipeline_task") as mock_pipe:
        # 1st, 2nd, 3rd sandbox PDF generation + verification succeed and increment monthly_uploads_used
        for _i in range(3):
            resp = client.post(
                "/api/essays/sandbox/generate-pdf",
                json=sandbox_payload,
                headers=headers,
            )
            assert resp.status_code == 200, resp.text
            last_essay_id = resp.json()["essay_id"]

        me_resp = client.get("/api/users/me", headers=headers)
        assert me_resp.json()["quota"]["monthly_uploads_used"] == 3

        # 4th sandbox PDF generation with verification must be rejected with HTTP 402 MONTHLY_QUOTA_EXCEEDED
        resp_4th = client.post(
            "/api/essays/sandbox/generate-pdf",
            json=sandbox_payload,
            headers=headers,
        )
        assert resp_4th.status_code == 402
        detail = resp_4th.json()["detail"]
        assert isinstance(detail, dict)
        assert detail["code"] == "MONTHLY_QUOTA_EXCEEDED"
        assert detail["used"] == 3
        assert detail["limit"] == 3

        # Reanalyze outside test runtime schedules background task and returns status="processing"
        with patch("integrity_checker.api.routes.essays.is_test_runtime", return_value=False):
            re_resp = client.post(f"/api/essays/{last_essay_id}/reanalyze", headers=headers)
            assert re_resp.status_code == 200
            assert re_resp.json()["status"] == "processing"
            assert mock_pipe.call_count == 4


@pytest.mark.asyncio
async def test_pipeline_enforces_max_citations_and_allow_serpapi_fallback(tmp_path) -> None:
    """IntegrityPipeline.run_async caps verifiable citations to max_citations and disables SerpApi when allow_serpapi=False."""
    from unittest.mock import AsyncMock, MagicMock

    from integrity_checker.extraction.base import Document, Page
    from integrity_checker.extraction.document_parser import ParsedDocument
    from integrity_checker.models.citation import Citation, CitationStyle, CitationType
    from integrity_checker.models.source import SourceCandidate, SourceResult
    from integrity_checker.models.validation import CitationVerdict, ValidationLabel
    from integrity_checker.pipeline.integrity_pipeline import IntegrityPipeline

    refs = [
        Citation(
            raw_text=f"[{idx}] Author{idx} (2020). Paper Title Number {idx}.",
            citation_type=CitationType.REFERENCE_LIST,
            style=CitationStyle.IEEE,
            authors=[f"Author{idx}"],
            year=2020,
            title=f"Paper Title Number {idx}",
            numeric_index=idx,
        )
        for idx in range(1, 6)
    ]
    body_cits = [
        Citation(
            raw_text=f"[{idx}]",
            citation_type=CitationType.IN_TEXT,
            style=CitationStyle.IEEE,
            numeric_index=idx,
            page_num=1,
        )
        for idx in range(1, 6)
    ]
    parsed_doc = ParsedDocument(
        document=Document(
            file_path=str(tmp_path / "test.pdf"),
            num_pages=1,
            pages=[Page(page_num=1, text="Body [1] [2] [3] [4] [5]")],
            parser_used="mupdf",
        ),
        body_citations=body_cits,
        references=refs,
        appendix_citations=[],
        parser_warnings=[],
    )

    mock_doc_parser = MagicMock()
    mock_doc_parser.parse.return_value = parsed_doc

    seen_allow_serpapi: list[bool | None] = []

    class DummyOrchestrator:
        async def retrieve(self, citation: Citation, *, allow_serpapi: bool | None = None) -> SourceResult:
            seen_allow_serpapi.append(allow_serpapi)
            return SourceResult(
                citation_raw=citation.raw_text,
                candidates=[
                    SourceCandidate(
                        source_name="crossref",
                        found=True,
                        title=citation.title,
                        authors=citation.authors or [],
                        year=str(citation.year or 2020),
                        confidence=0.95,
                    )
                ],
                sources_queried=["crossref"],
                sources_succeeded=["crossref"],
                sources_failed={},
            )

    mock_checker = MagicMock()
    mock_checker.check.side_effect = lambda cit, src, **kw: CitationVerdict(
        citation=cit,
        label=ValidationLabel.VERIFIED,
        confidence=0.95,
        matched_source=src,
    )

    pdf_file = tmp_path / "test.pdf"
    pdf_file.write_bytes(b"%PDF-1.4 dummy")

    pipeline = IntegrityPipeline(
        document_parser=mock_doc_parser,
        orchestrator=DummyOrchestrator(),  # type: ignore[arg-type]
        checker=mock_checker,
        use_document_parser=True,
        use_report_cache=False,
    )

    report = await pipeline.run_async(
        str(pdf_file),
        essay_id=1,
        max_citations=2,
        allow_serpapi=False,
    )

    # Verdicts are capped at max_citations=2, while extracted_citations retains all 10 (5 in-text + 5 refs)
    assert len(report.verdicts) == 2
    assert len(report.extracted_citations) == 10
    assert report.style_profile is not None
    assert report.style_profile["citations_truncated_by_plan"] is True
    assert report.style_profile["document_diagnostics"]["citations_truncated_by_plan"] is True
    assert report.style_profile["document_diagnostics"]["max_citations_limit"] == 2
    assert report.style_profile["document_diagnostics"]["total_verifiable_citations"] == 5
    assert seen_allow_serpapi == [False, False]

    # Also verify _run_pipeline_task forwards user plan policy max_citations & allow_serpapi
    from integrity_checker.api.routes.essays import _run_pipeline_task

    client = TestClient(app)
    _, user_data = _login_user(client, "user", "user123")
    user_id = user_data["id"]

    session = get_session()
    repo = Repository(session)
    essay_row = repo.create_essay_with_user("plan_cap.pdf", 1, user_id)
    session.commit()
    essay_id = essay_row.id
    session.close()

    spy_pipeline = MagicMock()
    spy_pipeline.run_async = AsyncMock(return_value=report)
    await _run_pipeline_task(
        essay_id=essay_id,
        tmp_path=str(pdf_file),
        user_id=user_id,
        pipeline=spy_pipeline,
        cleanup_file=False,
    )
    spy_pipeline.run_async.assert_called_once()
    call_kwargs = spy_pipeline.run_async.call_args.kwargs
    assert call_kwargs["max_citations"] == 30
    assert call_kwargs["allow_serpapi"] is False





