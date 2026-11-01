"""Unit & Integration tests for Premium Subscription Tiers, Quotas & Stripe Demo Billing."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
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
    Class as ClassModel,
    ClassMembership,
    EssayRecord,
    PromoCode,
    PromoRedemption,
    Session as SessionModel,
    User,
    VerdictRecord,
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
    db_user.quota_reset_at = datetime.now(timezone.utc) + timedelta(days=20)
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
            "expires_at": (datetime.now(timezone.utc) - timedelta(days=1)).isoformat(),
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

