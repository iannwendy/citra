"""Billing & Subscription routes — Plans catalog, Stripe Checkout, VNPay Gateway v2.1.0, Promo Codes & Admin Management."""

from __future__ import annotations

import logging
import os
import re
import secrets
from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy.orm import Session

from integrity_checker.api.deps import (
    get_current_user,
    get_current_user_optional,
    get_db,
    require_admin,
)
from integrity_checker.api.routes.auth import _to_response_dict
from integrity_checker.billing.plans import (
    BILLING_CYCLES,
    PLAN_CATALOG,
    PLAN_TIERS,
    ensure_user_quota_current,
    get_plan_catalog_list,
    get_plan_policy,
    get_user_subscription_summary,
)
from integrity_checker.billing.vnpay import (
    VNPAY_SANDBOX_TEST_CARDS,
    VNPAY_SUPPORTED_BANKS,
    VNPAY_VALID_BANK_CODES,
    VNPAY_VERSION,
    IpnFailChecksum,
    IpnInvalidAmount,
    IpnOrderAlreadyConfirmed,
    IpnOrderNotFound,
    IpnSuccess,
    IpnUnknownError,
    VNPayService,
    get_vnpay_response_message,
)
from integrity_checker.config import get_settings, is_test_runtime
from integrity_checker.db.models import BillingTransaction, PromoCode, User
from integrity_checker.db.repository import Repository

logger = logging.getLogger(__name__)

router = APIRouter()

PROMO_CODE_RE = re.compile(r"^[A-Z0-9]{6}$")
VALID_PAYMENT_METHODS = ("card", "apple_pay", "google_pay", "vnpay")
VALID_CARD_BRANDS = (
    "visa",
    "mastercard",
    "amex",
    "jcb",
    "discover",
    "apple_pay",
    "google_pay",
    "promo_waiver",
    "vnpay",
    "vnpay_qr",
    "vnpay_vnbank",
    "vnpay_intcard",
    "ncb",
    "vietcombank",
    "techcombank",
    "bidv",
    "vietinbank",
    "mbbank",
    "acb",
    "vpbank",
    "tpbank",
    "agribank",
)
VALID_DISCOUNT_TYPES = ("percent", "fixed")
VALID_APPLICABLE_TIERS = ("all", "pro", "ultra")
VALID_APPLICABLE_CYCLES = ("all", "monthly", "annual")


def _ensure_utc(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=UTC)
    return dt


# ---------- Schemas ----------


class CreateCheckoutSessionRequest(BaseModel):
    plan_tier: str = Field(..., description="Target tier: 'pro' or 'ultra'")
    billing_cycle: str = Field(default="monthly", description="'monthly' or 'annual'")
    force_demo: bool = Field(default=False, description="Force built-in Stripe demo sandbox")
    promo_code: str | None = Field(default=None, max_length=16, description="Optional 6-char promo code")


class ValidatePromoCodeRequest(BaseModel):
    code: str = Field(..., min_length=1, max_length=16, description="6-character promo code")
    plan_tier: str = Field(default="pro", description="'pro' or 'ultra'")
    billing_cycle: str = Field(default="annual", description="'monthly' or 'annual'")


class ApplySessionPromoRequest(BaseModel):
    code: str | None = Field(
        default=None,
        max_length=16,
        description="6-character promo code to apply, or empty/null to remove",
    )


class VerifyCheckoutSessionRequest(BaseModel):
    """PCI-DSS compliant verification payload — strictly forbids raw PAN/CVV fields."""

    model_config = ConfigDict(extra="forbid")

    session_id: str = Field(..., min_length=5, max_length=120)
    payment_method: str = Field(default="card", max_length=30)
    card_last4: str = Field(default="4242", max_length=4)
    card_brand: str = Field(default="visa", max_length=20)
    billing_country: str = Field(default="VN", max_length=10)
    billing_zip: str | None = Field(default=None, max_length=20)
    promo_code: str | None = Field(default=None, max_length=16)

    @field_validator("payment_method")
    @classmethod
    def _validate_payment_method(cls, v: str) -> str:
        normalized = (v or "card").strip().lower()
        if normalized not in VALID_PAYMENT_METHODS:
            raise ValueError(f"Invalid payment_method. Must be one of {VALID_PAYMENT_METHODS}.")
        return normalized

    @field_validator("card_last4")
    @classmethod
    def _validate_card_last4(cls, v: str) -> str:
        raw = (v or "4242").strip().upper()
        if len(raw) > 4:
            raise ValueError("PCI-DSS violation: Only last 4 digits of card may be sent.")
        if raw in ("VNQR", "QR00", "FREE"):
            return raw
        digits = "".join(ch for ch in raw if ch.isdigit())
        if len(digits) > 4:
            raise ValueError("PCI-DSS violation: Only last 4 digits of card may be sent.")
        return digits if len(digits) == 4 else "4242"


class CreateVNPayPaymentUrlRequest(BaseModel):
    """Request payload to build a cryptographically signed VNPay v2.1.0 Payment URL."""

    model_config = ConfigDict(extra="forbid")

    session_id: str = Field(..., min_length=5, max_length=120)
    bank_code: str = Field(
        default="NCB",
        max_length=32,
        description="VNPay bank/channel code: NCB, VNPAYQR, VNBANK, INTCARD, VIETCOMBANK, etc.",
    )
    locale: str = Field(default="vn", max_length=5, description="'vn' or 'en'")
    return_url: str | None = Field(default=None, max_length=500)


class VNPaySandboxAuthorizeRequest(BaseModel):
    """Interactive VNPay v2.1.0 Sandbox authorization request (simulates NCB ATM / VNPAY-QR)."""

    model_config = ConfigDict(extra="forbid")

    session_id: str = Field(..., min_length=5, max_length=120)
    bank_code: str = Field(default="NCB", max_length=32)
    payment_channel: str = Field(default="atm", max_length=20, description="'atm', 'qr', or 'intcard'")
    card_number: str | None = Field(default=None, max_length=32)
    card_holder: str | None = Field(default=None, max_length=80)
    issue_date: str | None = Field(default=None, max_length=10)
    otp_code: str | None = Field(default=None, max_length=10)
    simulate_response_code: str | None = Field(default=None, max_length=10)


class VNPayVerifyReturnRequest(BaseModel):
    """Payload containing VNPay ReturnURL query parameters to verify via HMAC-SHA512."""

    session_id: str | None = Field(default=None, max_length=120)
    vnp_params: dict[str, Any] = Field(default_factory=dict)


class CancelSubscriptionRequest(BaseModel):
    immediate: bool = Field(
        default=False,
        description="If True, immediately downgrade to basic; otherwise cancel at period end.",
    )


class PromoCodeCreateRequest(BaseModel):
    code: str | None = Field(
        default=None,
        description="6-character uppercase alphanumeric code (auto-generated if omitted)",
    )
    description: str | None = Field(default=None, max_length=255)
    discount_type: str = Field(default="percent", description="'percent' or 'fixed'")
    discount_value: float = Field(..., gt=0)
    max_discount_usd: float | None = Field(default=None, ge=0)
    min_amount_usd: float = Field(default=0.0, ge=0)
    applicable_tiers: str = Field(default="all", description="'all', 'pro', or 'ultra'")
    applicable_cycles: str = Field(default="all", description="'all', 'monthly', or 'annual'")
    max_uses: int | None = Field(default=None, ge=1)
    max_uses_per_user: int = Field(default=1, ge=1, le=100)
    is_active: bool = Field(default=True)
    expires_at: datetime | None = Field(default=None)


class PromoCodeUpdateRequest(BaseModel):
    description: str | None = Field(default=None, max_length=255)
    discount_type: str | None = Field(default=None)
    discount_value: float | None = Field(default=None, gt=0)
    max_discount_usd: float | None = Field(default=None, ge=0)
    min_amount_usd: float | None = Field(default=None, ge=0)
    applicable_tiers: str | None = Field(default=None)
    applicable_cycles: str | None = Field(default=None)
    max_uses: int | None = Field(default=None, ge=1)
    max_uses_per_user: int | None = Field(default=None, ge=1, le=100)
    is_active: bool | None = Field(default=None)
    expires_at: datetime | None = Field(default=None)


# ---------- Helpers ----------


def _serialize_promo(promo: PromoCode) -> dict[str, Any]:
    now = datetime.now(UTC)
    expires_at = _ensure_utc(promo.expires_at)
    is_expired = bool(expires_at is not None and now >= expires_at)
    is_exhausted = bool(
        promo.max_uses is not None and int(promo.used_count or 0) >= int(promo.max_uses)
    )
    effective_status = (
        "inactive"
        if not bool(promo.is_active)
        else "expired"
        if is_expired
        else "exhausted"
        if is_exhausted
        else "active"
    )
    return {
        "id": promo.id,
        "code": promo.code,
        "description": promo.description,
        "discount_type": promo.discount_type,
        "discount_value": float(promo.discount_value),
        "max_discount_usd": float(promo.max_discount_usd) if promo.max_discount_usd is not None else None,
        "min_amount_usd": float(promo.min_amount_usd or 0.0),
        "applicable_tiers": promo.applicable_tiers or "all",
        "applicable_cycles": promo.applicable_cycles or "all",
        "max_uses": promo.max_uses,
        "max_uses_per_user": int(promo.max_uses_per_user or 1),
        "used_count": int(promo.used_count or 0),
        "is_active": bool(promo.is_active),
        "is_expired": is_expired,
        "is_exhausted": is_exhausted,
        "effective_status": effective_status,
        "expires_at": expires_at.isoformat() if expires_at else None,
        "created_by": promo.created_by,
        "created_at": _ensure_utc(promo.created_at).isoformat() if promo.created_at else None,
        "updated_at": _ensure_utc(promo.updated_at).isoformat() if promo.updated_at else None,
    }


def _validate_and_calculate_promo(
    repo: Repository,
    raw_code: str,
    user_id: int,
    plan_tier: str,
    billing_cycle: str,
    subtotal_usd: float,
    current_tx_id: int | None = None,
) -> tuple[PromoCode, float, float]:
    """Validate a 6-char promo code against all business rules and return (promo, discount_usd, final_amount_usd)."""
    normalized = (raw_code or "").strip().upper()
    if not PROMO_CODE_RE.match(normalized):
        raise HTTPException(
            status_code=400,
            detail="Promo code must be exactly 6 alphanumeric characters (A-Z, 0-9).",
        )

    promo = repo.get_promo_code_by_code(normalized)
    if not promo:
        raise HTTPException(
            status_code=404,
            detail=f"Promo code '{normalized}' was not found.",
        )

    if not bool(promo.is_active):
        raise HTTPException(
            status_code=400,
            detail=f"Promo code '{normalized}' is currently inactive.",
        )

    now = datetime.now(UTC)
    expires_at = _ensure_utc(promo.expires_at)
    if expires_at is not None and now >= expires_at:
        raise HTTPException(
            status_code=400,
            detail=f"Promo code '{normalized}' has expired.",
        )

    allowed_tier = (promo.applicable_tiers or "all").lower()
    if allowed_tier != "all" and allowed_tier != plan_tier.lower():
        raise HTTPException(
            status_code=400,
            detail=f"Promo code '{normalized}' is only valid for the CITRA {allowed_tier.capitalize()} plan.",
        )

    allowed_cycle = (promo.applicable_cycles or "all").lower()
    if allowed_cycle != "all" and allowed_cycle != billing_cycle.lower():
        raise HTTPException(
            status_code=400,
            detail=f"Promo code '{normalized}' is only valid for {allowed_cycle} billing.",
        )

    min_amount = float(promo.min_amount_usd or 0.0)
    if subtotal_usd < min_amount:
        raise HTTPException(
            status_code=400,
            detail=f"Promo code '{normalized}' requires a minimum order of ${min_amount:.2f} USD.",
        )

    # Check if already redeemed on this exact transaction (idempotent re-verify)
    already_redeemed_on_tx = (
        current_tx_id is not None
        and repo.get_promo_redemption_by_tx(promo.id, current_tx_id) is not None
    )

    if not already_redeemed_on_tx:
        if promo.max_uses is not None and int(promo.used_count or 0) >= int(promo.max_uses):
            raise HTTPException(
                status_code=400,
                detail=f"Promo code '{normalized}' has reached its maximum redemption limit ({promo.max_uses}).",
            )

        user_uses = repo.count_user_promo_redemptions(promo.id, user_id)
        max_per_user = max(1, int(promo.max_uses_per_user or 1))
        if user_uses >= max_per_user:
            raise HTTPException(
                status_code=400,
                detail=f"You have already used promo code '{normalized}' ({user_uses}/{max_per_user} limit).",
            )

    if promo.discount_type == "percent":
        raw_discount = round(subtotal_usd * (float(promo.discount_value) / 100.0), 2)
        if promo.max_discount_usd is not None and float(promo.max_discount_usd) > 0:
            raw_discount = min(raw_discount, round(float(promo.max_discount_usd), 2))
    else:
        raw_discount = round(float(promo.discount_value), 2)

    discount_usd = round(min(subtotal_usd, max(0.0, raw_discount)), 2)
    final_amount_usd = round(max(0.0, subtotal_usd - discount_usd), 2)
    return promo, discount_usd, final_amount_usd


def _serialize_transaction(tx: BillingTransaction) -> dict[str, Any]:
    policy = get_plan_policy(tx.plan_tier)
    subtotal = float(tx.subtotal_usd if tx.subtotal_usd and tx.subtotal_usd > 0 else tx.amount_usd)
    discount = float(tx.discount_usd or 0.0)
    vnpay = VNPayService()
    amount_vnd = (
        int(tx.amount_vnd)
        if getattr(tx, "amount_vnd", None) is not None
        else vnpay.usd_to_vnd(float(tx.amount_usd))
    )
    return {
        "id": tx.id,
        "user_id": tx.user_id,
        "stripe_session_id": tx.stripe_session_id,
        "stripe_payment_intent_id": tx.stripe_payment_intent_id,
        "plan_tier": tx.plan_tier,
        "plan_name": policy.name,
        "billing_cycle": tx.billing_cycle,
        "subtotal_usd": round(subtotal, 2),
        "discount_usd": round(discount, 2),
        "promo_code": tx.promo_code,
        "amount_usd": round(float(tx.amount_usd), 2),
        "amount_vnd": amount_vnd,
        "currency": tx.currency,
        "status": tx.status,
        "payment_mode": tx.payment_mode,
        "payment_method": getattr(tx, "payment_method", None) or "card",
        "card_brand": tx.card_brand,
        "card_last4": tx.card_last4,
        "billing_country": getattr(tx, "billing_country", None) or "VN",
        "billing_zip": getattr(tx, "billing_zip", None),
        "vnp_txn_ref": getattr(tx, "vnp_txn_ref", None),
        "vnp_transaction_no": getattr(tx, "vnp_transaction_no", None),
        "vnp_bank_code": getattr(tx, "vnp_bank_code", None),
        "vnp_card_type": getattr(tx, "vnp_card_type", None),
        "vnp_response_code": getattr(tx, "vnp_response_code", None),
        "created_at": tx.created_at.isoformat() if tx.created_at else None,
        "paid_at": tx.paid_at.isoformat() if tx.paid_at else None,
    }


def _build_checkout_session_details(
    repo: Repository, tx: BillingTransaction, customer_user: User
) -> dict[str, Any]:
    policy = get_plan_policy(tx.plan_tier)
    vnpay = VNPayService()
    monthly_equiv = (
        policy.annual_monthly_equiv_usd
        if tx.billing_cycle == "annual"
        else policy.monthly_price_usd
    )
    savings_usd = policy.annual_savings_usd if tx.billing_cycle == "annual" else 0
    subtotal_usd = float(
        tx.subtotal_usd
        if tx.subtotal_usd is not None and tx.subtotal_usd > 0
        else (policy.annual_price_usd if tx.billing_cycle == "annual" else policy.monthly_price_usd)
    )
    discount_usd = float(tx.discount_usd or 0.0)
    amount_usd = round(float(tx.amount_usd), 2)
    subtotal_vnd = vnpay.usd_to_vnd(subtotal_usd)
    discount_vnd = vnpay.usd_to_vnd(discount_usd)
    amount_vnd = vnpay.usd_to_vnd(amount_usd)

    promo_details = None
    if tx.promo_code:
        promo_obj = repo.get_promo_code_by_code(tx.promo_code)
        if promo_obj:
            promo_details = {
                "code": promo_obj.code,
                "description": promo_obj.description,
                "discount_type": promo_obj.discount_type,
                "discount_value": float(promo_obj.discount_value),
                "max_discount_usd": float(promo_obj.max_discount_usd)
                if promo_obj.max_discount_usd is not None
                else None,
                "discount_usd": round(discount_usd, 2),
            }

    return {
        "session_id": tx.stripe_session_id,
        "status": tx.status,
        "payment_mode": tx.payment_mode,
        "merchant_name": "CITRA (SourceLogic) Inc.",
        "customer_email": customer_user.email or f"{customer_user.username}@citra.edu.vn",
        "customer_name": customer_user.full_name or customer_user.username,
        "plan_tier": tx.plan_tier,
        "plan_name": f"CITRA {policy.name}",
        "billing_cycle": tx.billing_cycle,
        "subtotal_usd": round(subtotal_usd, 2),
        "discount_usd": round(discount_usd, 2),
        "promo_code": tx.promo_code,
        "promo_details": promo_details,
        "amount_usd": amount_usd,
        "subtotal_vnd": subtotal_vnd,
        "discount_vnd": discount_vnd,
        "amount_vnd": amount_vnd,
        "usd_to_vnd_rate": vnpay.usd_to_vnd_rate,
        "monthly_equivalent_usd": monthly_equiv,
        "annual_savings_usd": savings_usd,
        "currency": tx.currency,
        "supported_payment_methods": list(VALID_PAYMENT_METHODS),
        "supported_card_brands": ["visa", "mastercard", "amex", "jcb"],
        "vnpay": {
            "enabled": True,
            "version": VNPAY_VERSION,
            "tmn_code": vnpay.tmn_code,
            "curr_code": "VND",
            "usd_to_vnd_rate": vnpay.usd_to_vnd_rate,
            "subtotal_vnd": subtotal_vnd,
            "discount_vnd": discount_vnd,
            "amount_vnd": amount_vnd,
            "vnp_amount": amount_vnd * 100,
            "vnp_txn_ref": getattr(tx, "vnp_txn_ref", None),
            "external_redirect": vnpay.external_redirect,
            "supported_banks": list(VNPAY_SUPPORTED_BANKS),
            "sandbox_test_cards": VNPAY_SANDBOX_TEST_CARDS,
        },
        "features_en": list(policy.features_en[:6]),
        "features_vi": list(policy.features_vi[:6]),
    }


# ---------- Public & Customer Endpoints ----------


@router.get("/plans")
def list_billing_plans(
    current_user: User | None = Depends(get_current_user_optional),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Return full 3-tier pricing catalog (Basic, Pro, Ultra) and current user subscription if logged in."""
    current_sub = None
    if current_user is not None:
        if ensure_user_quota_current(current_user):
            db.commit()
        current_sub = get_user_subscription_summary(current_user)

    return {
        "plans": get_plan_catalog_list(),
        "current_subscription": current_sub,
    }


@router.get("/subscription")
def get_my_subscription(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Return authenticated user's current subscription, quota usage, and billing history."""
    repo = Repository(db)
    if ensure_user_quota_current(current_user):
        repo.commit()

    txs = repo.list_billing_transactions_for_user(current_user.id, limit=30)
    return {
        "subscription": get_user_subscription_summary(current_user),
        "transactions": [_serialize_transaction(t) for t in txs],
    }


@router.post("/promo/validate")
def validate_promo_code_endpoint(
    request: ValidatePromoCodeRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Validate a 6-character promo code for a target plan & billing cycle and return discount breakdown."""
    tier = request.plan_tier.strip().lower()
    cycle = request.billing_cycle.strip().lower()
    if tier not in PLAN_TIERS or tier == "basic":
        raise HTTPException(status_code=400, detail="Invalid paid plan_tier. Must be 'pro' or 'ultra'.")
    if cycle not in BILLING_CYCLES:
        raise HTTPException(status_code=400, detail="Invalid billing_cycle. Must be 'monthly' or 'annual'.")

    policy = PLAN_CATALOG[tier]
    subtotal_usd = float(policy.annual_price_usd if cycle == "annual" else policy.monthly_price_usd)
    repo = Repository(db)
    promo, discount_usd, final_amount_usd = _validate_and_calculate_promo(
        repo=repo,
        raw_code=request.code,
        user_id=current_user.id,
        plan_tier=tier,
        billing_cycle=cycle,
        subtotal_usd=subtotal_usd,
    )
    return {
        "valid": True,
        "code": promo.code,
        "description": promo.description,
        "discount_type": promo.discount_type,
        "discount_value": float(promo.discount_value),
        "max_discount_usd": float(promo.max_discount_usd) if promo.max_discount_usd is not None else None,
        "subtotal_usd": round(subtotal_usd, 2),
        "discount_usd": round(discount_usd, 2),
        "final_amount_usd": round(final_amount_usd, 2),
    }


@router.post("/create-checkout-session")
def create_checkout_session(
    request: CreateCheckoutSessionRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Create a Stripe Checkout Session (Real Stripe Test Mode if configured, else Built-in Stripe Demo Sandbox)."""
    tier = request.plan_tier.strip().lower()
    cycle = request.billing_cycle.strip().lower()

    if tier not in PLAN_TIERS or tier == "basic":
        raise HTTPException(
            status_code=400,
            detail="Invalid paid plan_tier. Must be 'pro' or 'ultra'.",
        )
    if cycle not in BILLING_CYCLES:
        raise HTTPException(
            status_code=400,
            detail="Invalid billing_cycle. Must be 'monthly' or 'annual'.",
        )

    policy = PLAN_CATALOG[tier]
    subtotal_usd = float(
        policy.annual_price_usd if cycle == "annual" else policy.monthly_price_usd
    )
    discount_usd = 0.0
    amount_usd = subtotal_usd
    applied_promo_code: str | None = None

    repo = Repository(db)
    if request.promo_code and request.promo_code.strip():
        promo, discount_usd, amount_usd = _validate_and_calculate_promo(
            repo=repo,
            raw_code=request.promo_code,
            user_id=current_user.id,
            plan_tier=tier,
            billing_cycle=cycle,
            subtotal_usd=subtotal_usd,
        )
        applied_promo_code = promo.code

    stripe_secret = os.getenv("STRIPE_SECRET_KEY", "").strip()
    frontend_url = os.getenv("FRONTEND_URL", "http://localhost:5173").rstrip("/")

    # Attempt Real Stripe Live / Test Mode if sk_live_ or sk_test_ key is provided and not force_demo
    if stripe_secret.startswith(("sk_live_", "sk_test_")) and not request.force_demo and amount_usd > 0:
        stripe_mode = "stripe_live" if stripe_secret.startswith("sk_live_") else "stripe_test"
        try:
            import stripe  # type: ignore

            stripe.api_key = stripe_secret
            interval = "year" if cycle == "annual" else "month"
            unit_amount_cents = int(round(amount_usd * 100))

            stripe_session = stripe.checkout.Session.create(
                payment_method_types=["card"],
                mode="subscription",
                customer_email=current_user.email or f"{current_user.username}@citra.edu.vn",
                line_items=[
                    {
                        "price_data": {
                            "currency": "usd",
                            "product_data": {
                                "name": f"CITRA {policy.name} Plan ({cycle.capitalize()})",
                                "description": policy.tagline_en,
                            },
                            "unit_amount": unit_amount_cents,
                            "recurring": {"interval": interval},
                        },
                        "quantity": 1,
                    }
                ],
                metadata={
                    "user_id": str(current_user.id),
                    "plan_tier": tier,
                    "billing_cycle": cycle,
                    "promo_code": applied_promo_code or "",
                },
                success_url=f"{frontend_url}/billing/success?session_id={{CHECKOUT_SESSION_ID}}",
                cancel_url=f"{frontend_url}/pricing?canceled=1",
            )
            tx = repo.create_billing_transaction(
                user_id=current_user.id,
                stripe_session_id=stripe_session.id,
                plan_tier=tier,
                billing_cycle=cycle,
                subtotal_usd=subtotal_usd,
                discount_usd=discount_usd,
                promo_code=applied_promo_code,
                amount_usd=amount_usd,
                status="pending",
                payment_mode=stripe_mode,
            )
            repo.commit()
            return {
                "session_id": stripe_session.id,
                "checkout_url": stripe_session.url,
                "mode": stripe_mode,
                "plan_tier": tier,
                "plan_name": policy.name,
                "billing_cycle": cycle,
                "subtotal_usd": subtotal_usd,
                "discount_usd": discount_usd,
                "promo_code": applied_promo_code,
                "amount_usd": amount_usd,
                "transaction_id": tx.id,
            }
        except Exception as exc:
            logger.warning(f"Stripe SDK fallback to built-in demo checkout: {exc}")

    # Built-in Interactive Stripe Demo Checkout Session (works 100% offline/local without external keys)
    session_id = f"cs_test_demo_{secrets.token_hex(16)}"
    vnpay = VNPayService()
    amount_vnd = vnpay.usd_to_vnd(amount_usd)
    tx = repo.create_billing_transaction(
        user_id=current_user.id,
        stripe_session_id=session_id,
        plan_tier=tier,
        billing_cycle=cycle,
        subtotal_usd=subtotal_usd,
        discount_usd=discount_usd,
        promo_code=applied_promo_code,
        amount_usd=amount_usd,
        amount_vnd=amount_vnd,
        status="pending",
        payment_mode="stripe_demo",
    )
    repo.commit()

    return {
        "session_id": session_id,
        "checkout_url": f"/billing/checkout?session_id={session_id}",
        "mode": "stripe_demo",
        "plan_tier": tier,
        "plan_name": policy.name,
        "billing_cycle": cycle,
        "subtotal_usd": subtotal_usd,
        "discount_usd": discount_usd,
        "promo_code": applied_promo_code,
        "amount_usd": amount_usd,
        "amount_vnd": amount_vnd,
        "usd_to_vnd_rate": vnpay.usd_to_vnd_rate,
        "transaction_id": tx.id,
    }


@router.get("/checkout-session/{session_id}")
def get_checkout_session_details(
    session_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Fetch checkout session summary for the Built-in Stripe Demo Checkout UI."""
    repo = Repository(db)
    tx = repo.get_billing_transaction_by_session(session_id)
    if not tx:
        raise HTTPException(status_code=404, detail="Checkout session not found")
    if tx.user_id != current_user.id and current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Access denied")

    customer_user = repo.get_user_by_id(tx.user_id) or current_user
    return _build_checkout_session_details(repo, tx, customer_user)


@router.post("/checkout-session/{session_id}/promo")
def apply_or_remove_session_promo(
    session_id: str,
    request: ApplySessionPromoRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Apply or remove a 6-character promo code on a pending checkout session."""
    repo = Repository(db)
    tx = repo.get_billing_transaction_by_session(session_id)
    if not tx:
        raise HTTPException(status_code=404, detail="Checkout session not found")
    if tx.user_id != current_user.id and current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Access denied")
    if tx.status == "succeeded":
        raise HTTPException(status_code=400, detail="Checkout session has already been paid.")

    policy = get_plan_policy(tx.plan_tier)
    subtotal_usd = float(
        policy.annual_price_usd if tx.billing_cycle == "annual" else policy.monthly_price_usd
    )
    tx.subtotal_usd = subtotal_usd

    raw_code = (request.code or "").strip()
    vnpay = VNPayService()
    if not raw_code:
        # Remove applied promo code
        tx.promo_code = None
        tx.discount_usd = 0.0
        tx.amount_usd = subtotal_usd
        tx.amount_vnd = vnpay.usd_to_vnd(subtotal_usd)
        repo.commit()
        db.refresh(tx)
    else:
        promo, discount_usd, final_amount_usd = _validate_and_calculate_promo(
            repo=repo,
            raw_code=raw_code,
            user_id=tx.user_id,
            plan_tier=tx.plan_tier,
            billing_cycle=tx.billing_cycle,
            subtotal_usd=subtotal_usd,
            current_tx_id=tx.id,
        )
        tx.promo_code = promo.code
        tx.discount_usd = discount_usd
        tx.amount_usd = final_amount_usd
        tx.amount_vnd = vnpay.usd_to_vnd(final_amount_usd)
        repo.commit()
        db.refresh(tx)

    customer_user = repo.get_user_by_id(tx.user_id) or current_user
    return _build_checkout_session_details(repo, tx, customer_user)


def _activate_paid_transaction(
    repo: Repository,
    db: Session,
    tx: BillingTransaction,
    target_user: User,
    *,
    payment_method: str = "card",
    payment_mode: str | None = None,
    card_brand: str = "visa",
    card_last4: str = "4242",
    billing_country: str = "VN",
    billing_zip: str | None = None,
    promo_code_override: str | None = None,
    vnp_txn_ref: str | None = None,
    vnp_transaction_no: str | None = None,
    vnp_bank_code: str | None = None,
    vnp_card_type: str | None = None,
    vnp_response_code: str | None = None,
    amount_vnd: int | None = None,
) -> None:
    """Idempotently activate a paid BillingTransaction, redeem promo code, and upgrade user subscription."""
    if tx.status == "succeeded":
        return

    now = datetime.now(UTC)
    vnpay = VNPayService()
    policy = get_plan_policy(tx.plan_tier)
    subtotal_usd = float(
        tx.subtotal_usd
        if tx.subtotal_usd is not None and tx.subtotal_usd > 0
        else (policy.annual_price_usd if tx.billing_cycle == "annual" else policy.monthly_price_usd)
    )
    tx.subtotal_usd = subtotal_usd

    effective_promo_code = (
        promo_code_override.strip().upper()
        if promo_code_override and promo_code_override.strip()
        else tx.promo_code
    )
    if effective_promo_code:
        promo, discount_usd, final_amount_usd = _validate_and_calculate_promo(
            repo=repo,
            raw_code=effective_promo_code,
            user_id=target_user.id,
            plan_tier=tx.plan_tier,
            billing_cycle=tx.billing_cycle,
            subtotal_usd=subtotal_usd,
            current_tx_id=tx.id,
        )
        tx.promo_code = promo.code
        tx.discount_usd = discount_usd
        tx.amount_usd = final_amount_usd
        repo.record_promo_redemption(
            promo=promo,
            user_id=target_user.id,
            transaction_id=tx.id,
            discount_usd=discount_usd,
        )
    else:
        tx.discount_usd = 0.0
        tx.amount_usd = subtotal_usd

    tx.amount_vnd = (
        int(amount_vnd)
        if amount_vnd is not None
        else vnpay.usd_to_vnd(float(tx.amount_usd))
    )
    tx.status = "succeeded"
    tx.paid_at = now
    if payment_mode:
        tx.payment_mode = payment_mode
    tx.payment_method = payment_method

    if payment_method == "vnpay":
        tx.stripe_payment_intent_id = (
            f"vnp_{vnp_transaction_no}"
            if vnp_transaction_no
            else f"vnp_{secrets.token_hex(8)}"
        )
    elif not tx.stripe_payment_intent_id:
        tx.stripe_payment_intent_id = f"pi_demo_{secrets.token_hex(12)}"

    raw_last4 = (card_last4 or "4242").strip().upper()
    if raw_last4 in ("VNQR", "QR00", "FREE"):
        tx.card_last4 = raw_last4
    else:
        clean_digits = "".join(ch for ch in raw_last4 if ch.isdigit())[-4:]
        tx.card_last4 = clean_digits if len(clean_digits) == 4 else "4242"

    raw_brand = (card_brand or "visa").strip().lower()[:20]
    tx.card_brand = raw_brand if raw_brand in VALID_CARD_BRANDS else "visa"
    tx.billing_country = (billing_country or "VN").strip().upper()[:10]
    if billing_zip is not None:
        tx.billing_zip = billing_zip.strip()[:20] or None

    if vnp_txn_ref:
        tx.vnp_txn_ref = vnp_txn_ref[:120]
    if vnp_transaction_no:
        tx.vnp_transaction_no = vnp_transaction_no[:64]
    if vnp_bank_code:
        tx.vnp_bank_code = vnp_bank_code.strip().upper()[:32]
    if vnp_card_type:
        tx.vnp_card_type = vnp_card_type.strip().upper()[:32]
    if vnp_response_code:
        tx.vnp_response_code = vnp_response_code.strip()[:10]

    period_days = 365 if tx.billing_cycle == "annual" else 30
    target_user.plan_tier = tx.plan_tier
    target_user.billing_cycle = tx.billing_cycle
    target_user.subscription_status = "active"
    target_user.cancel_at_period_end = 0
    target_user.current_period_start = now
    target_user.current_period_end = now + timedelta(days=period_days)
    if not target_user.stripe_customer_id:
        target_user.stripe_customer_id = f"cus_demo_{target_user.id}"
    target_user.stripe_subscription_id = (
        f"sub_vnp_{secrets.token_hex(8)}"
        if payment_method == "vnpay"
        else f"sub_demo_{secrets.token_hex(8)}"
    )
    if target_user.quota_reset_at is None:
        target_user.quota_reset_at = now + timedelta(days=30)

    repo.commit()
    db.refresh(target_user)
    db.refresh(tx)


def _is_production_runtime() -> bool:
    """Return True when APP_ENV / settings.app.env is production and not in test runtime."""
    settings = get_settings()
    env_val = (os.getenv("APP_ENV") or settings.app.env or "").strip().lower()
    return env_val in ("production", "prod", "live") and not is_test_runtime()


def _verify_stripe_session_paid(session_id: str, stripe_secret: str) -> dict[str, Any]:
    """Verify a Stripe Checkout Session via Stripe HTTP API and require payment_status == 'paid'."""
    import httpx

    try:
        resp = httpx.get(
            f"https://api.stripe.com/v1/checkout/sessions/{session_id}",
            auth=(stripe_secret, ""),
            timeout=10.0,
        )
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Failed to verify checkout session with Stripe: {exc}",
        ) from exc

    if resp.status_code != 200:
        raise HTTPException(
            status_code=400,
            detail="Unable to verify checkout session with Stripe.",
        )
    data = resp.json()
    if data.get("payment_status") != "paid":
        raise HTTPException(
            status_code=402,
            detail=f"Stripe checkout session is not paid (payment_status={data.get('payment_status')}).",
        )
    return data


@router.post("/verify-session")
def verify_checkout_session(
    request: VerifyCheckoutSessionRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Verify and finalize a Stripe Demo / Test checkout session, activating the user's paid plan."""
    repo = Repository(db)
    tx = repo.get_billing_transaction_by_session(request.session_id)
    if not tx:
        raise HTTPException(status_code=404, detail="Checkout session not found")
    if tx.user_id != current_user.id and current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Access denied")

    is_prod = _is_production_runtime()
    allow_demo_in_prod = os.getenv("ALLOW_DEMO_CHECKOUT_IN_PROD", "").strip().lower() in (
        "1",
        "true",
        "yes",
    )
    is_demo_session = (
        request.session_id.startswith(("cs_test_demo_", "cs_demo_"))
        or (tx.payment_mode or "").lower() in ("demo", "stripe_demo")
    )
    if is_prod and is_demo_session and not allow_demo_in_prod:
        raise HTTPException(
            status_code=403,
            detail="Demo checkout sessions are not allowed in production",
        )

    stripe_secret = os.getenv("STRIPE_SECRET_KEY", "").strip()
    if stripe_secret.startswith(("sk_live_", "sk_test_")) and not is_demo_session:
        _verify_stripe_session_paid(request.session_id, stripe_secret)
    elif is_prod and not is_demo_session:
        raise HTTPException(
            status_code=503,
            detail="STRIPE_SECRET_KEY is not configured in production.",
        )

    target_user = repo.get_user_by_id(tx.user_id)
    if not target_user:
        raise HTTPException(status_code=404, detail="User not found")

    _activate_paid_transaction(
        repo=repo,
        db=db,
        tx=tx,
        target_user=target_user,
        payment_method=request.payment_method,
        card_brand=request.card_brand,
        card_last4=request.card_last4,
        billing_country=request.billing_country,
        billing_zip=request.billing_zip,
        promo_code_override=request.promo_code,
    )

    return {
        "status": "succeeded",
        "message": f"Successfully upgraded to CITRA {get_plan_policy(target_user.plan_tier).name} ({tx.billing_cycle})!",
        "transaction": _serialize_transaction(tx),
        "subscription": get_user_subscription_summary(target_user),
        "user": _to_response_dict(target_user),
    }


# ---------- VNPay Payment Gateway v2.1.0 Endpoints (https://vnpay.js.org/en/) ----------


@router.post("/vnpay/create-payment-url")
def create_vnpay_payment_url(
    payload: CreateVNPayPaymentUrlRequest,
    http_request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Build a cryptographically signed VNPay v2.1.0 Payment URL (HMAC-SHA512) for a checkout session."""
    repo = Repository(db)
    tx = repo.get_billing_transaction_by_session(payload.session_id)
    if not tx:
        raise HTTPException(status_code=404, detail="Checkout session not found")
    if tx.user_id != current_user.id and current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Access denied")
    if tx.status == "succeeded":
        raise HTTPException(status_code=400, detail="Checkout session has already been paid.")

    bank_code = (payload.bank_code or "NCB").strip().upper()
    if bank_code not in VNPAY_VALID_BANK_CODES:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported VNPay bank_code '{bank_code}'. Supported codes: {sorted(VNPAY_VALID_BANK_CODES)}",
        )

    vnpay = VNPayService()
    policy = get_plan_policy(tx.plan_tier)
    amount_usd = float(tx.amount_usd)
    amount_vnd = vnpay.usd_to_vnd(amount_usd)

    # Generate or reuse unique vnp_TxnRef bound to this transaction
    if not tx.vnp_txn_ref:
        tx.vnp_txn_ref = f"CITRA{tx.id}VNP{secrets.token_hex(4).upper()}"
    tx.amount_vnd = amount_vnd
    tx.vnp_bank_code = bank_code
    repo.commit()
    db.refresh(tx)

    forwarded_for = http_request.headers.get("x-forwarded-for")
    client_ip = (
        forwarded_for.split(",")[0].strip()
        if forwarded_for
        else (http_request.client.host if http_request.client else "127.0.0.1")
    )

    frontend_url = os.getenv("FRONTEND_URL", "http://localhost:5173").rstrip("/")
    default_return_url = f"{frontend_url}/billing/success?session_id={tx.stripe_session_id}"
    return_url = (payload.return_url or "").strip() or default_return_url

    order_info = (
        f"Thanh toan goi CITRA {policy.name} {tx.billing_cycle} "
        f"Ref {tx.vnp_txn_ref}"
    )

    built = vnpay.build_payment_url(
        txn_ref=tx.vnp_txn_ref,
        amount_usd=amount_usd,
        order_info=order_info,
        ip_addr=client_ip,
        bank_code=bank_code,
        locale=payload.locale,
        return_url=return_url,
    )

    return {
        "session_id": tx.stripe_session_id,
        **built,
        "supported_banks": list(VNPAY_SUPPORTED_BANKS),
        "sandbox_test_cards": VNPAY_SANDBOX_TEST_CARDS,
    }


@router.post("/vnpay/sandbox-authorize")
def authorize_vnpay_sandbox_payment(
    payload: VNPaySandboxAuthorizeRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Authorize a payment in the Built-in Interactive VNPay v2.1.0 Sandbox Gateway and return signed ReturnURL params."""
    repo = Repository(db)
    tx = repo.get_billing_transaction_by_session(payload.session_id)
    if not tx:
        raise HTTPException(status_code=404, detail="Checkout session not found")
    if tx.user_id != current_user.id and current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Access denied")

    target_user = repo.get_user_by_id(tx.user_id)
    if not target_user:
        raise HTTPException(status_code=404, detail="User not found")

    bank_code = (payload.bank_code or "NCB").strip().upper()
    if bank_code not in VNPAY_VALID_BANK_CODES:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported VNPay bank_code '{bank_code}'.",
        )

    channel = (payload.payment_channel or "atm").strip().lower()
    if channel not in ("atm", "qr", "intcard"):
        raise HTTPException(
            status_code=400,
            detail="Invalid payment_channel. Must be 'atm', 'qr', or 'intcard'.",
        )

    response_code = "00"
    card_last4 = "VNQR" if channel == "qr" else "2198"
    card_type = "QRCODE" if channel == "qr" else ("CREDIT" if channel == "intcard" else "ATM")

    if payload.simulate_response_code and payload.simulate_response_code.strip():
        response_code = payload.simulate_response_code.strip()
    elif channel in ("atm", "intcard"):
        raw_card_digits = re.sub(r"\D", "", payload.card_number or "")
        if not raw_card_digits or len(raw_card_digits) < 12 or len(raw_card_digits) > 19:
            raise HTTPException(
                status_code=400,
                detail="Số thẻ ATM/Ngân hàng không hợp lệ. Vui lòng dùng thẻ test NCB 9704198526191432198.",
            )
        card_last4 = raw_card_digits[-4:]

        holder = (payload.card_holder or "").strip()
        if len(holder) < 2:
            raise HTTPException(
                status_code=400,
                detail="Vui lòng nhập đầy đủ họ tên chủ thẻ (VD: NGUYEN VAN A).",
            )

        issue = (payload.issue_date or "").strip()
        if not re.match(r"^\d{2}/\d{2}$", issue):
            raise HTTPException(
                status_code=400,
                detail="Ngày phát hành thẻ không hợp lệ (định dạng MM/YY, VD: 07/15).",
            )

        otp = (payload.otp_code or "").strip()
        if not otp or not otp.isdigit() or len(otp) != 6:
            raise HTTPException(
                status_code=400,
                detail="Mã xác thực OTP phải gồm đúng 6 chữ số (OTP Sandbox mặc định: 123456).",
            )

        # Match official VNPay Sandbox test card behaviors
        if raw_card_digits == VNPAY_SANDBOX_TEST_CARDS["insufficient_funds"]["card_number"]:
            response_code = "51"
        elif raw_card_digits == VNPAY_SANDBOX_TEST_CARDS["locked_card"]["card_number"]:
            response_code = "12"
        elif raw_card_digits == VNPAY_SANDBOX_TEST_CARDS["no_internet_banking"]["card_number"]:
            response_code = "09"
        elif otp != "123456":
            response_code = "13"
        else:
            response_code = "00"

    vnpay = VNPayService()
    policy = get_plan_policy(tx.plan_tier)
    amount_vnd = vnpay.usd_to_vnd(float(tx.amount_usd))
    if not tx.vnp_txn_ref:
        tx.vnp_txn_ref = f"CITRA{tx.id}VNP{secrets.token_hex(4).upper()}"
    tx.amount_vnd = amount_vnd
    tx.vnp_bank_code = bank_code
    tx.vnp_card_type = card_type
    tx.vnp_response_code = response_code

    order_info = (
        f"Thanh toan goi CITRA {policy.name} {tx.billing_cycle} "
        f"Ref {tx.vnp_txn_ref}"
    )
    signed_return_params = vnpay.build_signed_return_params(
        txn_ref=tx.vnp_txn_ref,
        amount_vnd=amount_vnd,
        order_info=order_info,
        bank_code=bank_code if channel != "qr" else "VNPAYQR",
        card_type=card_type,
        response_code=response_code,
    )

    msg_en, msg_vi = get_vnpay_response_message(response_code)
    if response_code != "00":
        repo.commit()
        db.refresh(tx)
        return {
            "status": "failed",
            "is_verified": True,
            "is_success": False,
            "vnp_response_code": response_code,
            "message_vi": msg_vi,
            "message_en": msg_en,
            "vnp_txn_ref": tx.vnp_txn_ref,
            "vnp_transaction_no": signed_return_params["vnp_TransactionNo"],
            "vnp_bank_code": signed_return_params["vnp_BankCode"],
            "vnp_card_type": card_type,
            "amount_vnd": amount_vnd,
            "vnp_params": signed_return_params,
            "vnp_return_params": signed_return_params,
            "return_url": f"/billing/checkout?session_id={tx.stripe_session_id}",
            "transaction": _serialize_transaction(tx),
            "subscription": get_user_subscription_summary(target_user),
            "user": _to_response_dict(target_user),
        }

    brand_key = "vnpay_qr" if channel == "qr" else bank_code.lower()
    if brand_key not in VALID_CARD_BRANDS:
        brand_key = "vnpay"

    _activate_paid_transaction(
        repo=repo,
        db=db,
        tx=tx,
        target_user=target_user,
        payment_method="vnpay",
        payment_mode="vnpay_sandbox",
        card_brand=brand_key,
        card_last4=card_last4,
        billing_country="VN",
        vnp_txn_ref=tx.vnp_txn_ref,
        vnp_transaction_no=signed_return_params["vnp_TransactionNo"],
        vnp_bank_code=signed_return_params["vnp_BankCode"],
        vnp_card_type=card_type,
        vnp_response_code="00",
        amount_vnd=amount_vnd,
    )

    query_str = "&".join(f"{k}={v}" for k, v in signed_return_params.items())
    return {
        "status": "succeeded",
        "is_verified": True,
        "is_success": True,
        "vnp_response_code": "00",
        "message_vi": msg_vi,
        "message_en": msg_en,
        "message": f"Successfully upgraded to CITRA {policy.name} via VNPay!",
        "session_id": tx.stripe_session_id,
        "vnp_txn_ref": tx.vnp_txn_ref,
        "vnp_transaction_no": signed_return_params["vnp_TransactionNo"],
        "vnp_bank_code": signed_return_params["vnp_BankCode"],
        "vnp_card_type": card_type,
        "amount_vnd": amount_vnd,
        "return_url": f"/billing/success?session_id={tx.stripe_session_id}&{query_str}",
        "vnp_params": signed_return_params,
        "vnp_return_params": signed_return_params,
        "transaction": _serialize_transaction(tx),
        "subscription": get_user_subscription_summary(target_user),
        "user": _to_response_dict(target_user),
    }


def _process_vnpay_return_verification(
    query_params: dict[str, Any],
    session_id_hint: str | None,
    current_user: User | None,
    db: Session,
) -> dict[str, Any]:
    """Cryptographically verify VNPay ReturnURL parameters via HMAC-SHA512 and finalize subscription."""
    vnpay = VNPayService()
    verify_result = vnpay.verify_return_url(query_params)
    if not verify_result.is_verified:
        raise HTTPException(
            status_code=400,
            detail=verify_result.message_en,
        )

    repo = Repository(db)
    tx = repo.get_billing_transaction_by_vnp_txn_ref(verify_result.txn_ref)
    if not tx and session_id_hint:
        tx = repo.get_billing_transaction_by_session(session_id_hint)
    if not tx:
        raise HTTPException(status_code=404, detail="Transaction for vnp_TxnRef not found")

    if current_user and tx.user_id != current_user.id and current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Access denied")

    expected_vnd = (
        int(tx.amount_vnd)
        if getattr(tx, "amount_vnd", None) is not None
        else vnpay.usd_to_vnd(float(tx.amount_usd))
    )
    if verify_result.raw_vnp_amount != int(expected_vnd * 100):
        raise HTTPException(
            status_code=400,
            detail=(
                f"VNPay amount mismatch: expected {expected_vnd * 100} "
                f"({expected_vnd:,} VND), got {verify_result.raw_vnp_amount}."
            ),
        )

    if not verify_result.is_success:
        if tx.status != "succeeded":
            tx.status = "canceled" if verify_result.response_code == "24" else "failed"
            tx.vnp_response_code = verify_result.response_code
            repo.commit()
        raise HTTPException(
            status_code=400,
            detail=(
                f"[VNPay Code {verify_result.response_code}] "
                f"{verify_result.message_vi} ({verify_result.message_en})"
            ),
        )

    target_user = repo.get_user_by_id(tx.user_id)
    if not target_user:
        raise HTTPException(status_code=404, detail="User not found")

    brand_key = (
        "vnpay_qr"
        if verify_result.card_type == "QRCODE" or verify_result.bank_code == "VNPAYQR"
        else verify_result.bank_code.lower()
    )
    if brand_key not in VALID_CARD_BRANDS:
        brand_key = "vnpay"

    default_last4 = (
        "VNQR"
        if brand_key == "vnpay_qr"
        else (tx.card_last4 if tx.card_last4 and tx.card_last4 != "4242" else "2198")
    )

    _activate_paid_transaction(
        repo=repo,
        db=db,
        tx=tx,
        target_user=target_user,
        payment_method="vnpay",
        payment_mode="vnpay_sandbox",
        card_brand=brand_key,
        card_last4=default_last4,
        billing_country="VN",
        vnp_txn_ref=verify_result.txn_ref,
        vnp_transaction_no=verify_result.transaction_no,
        vnp_bank_code=verify_result.bank_code,
        vnp_card_type=verify_result.card_type,
        vnp_response_code=verify_result.response_code,
        amount_vnd=verify_result.amount_vnd,
    )

    return {
        "status": "succeeded",
        "is_verified": True,
        "is_success": True,
        "vnp_response_code": verify_result.response_code,
        "message_vi": verify_result.message_vi,
        "message_en": verify_result.message_en,
        "message": f"Successfully upgraded to CITRA {get_plan_policy(target_user.plan_tier).name} ({tx.billing_cycle}) via VNPay!",
        "vnpay": verify_result.to_dict(),
        "transaction": _serialize_transaction(tx),
        "subscription": get_user_subscription_summary(target_user),
        "user": _to_response_dict(target_user),
    }


@router.post("/vnpay/verify-return")
def verify_vnpay_return_post(
    payload: VNPayVerifyReturnRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Verify VNPay ReturnURL parameters sent from the frontend callback handler."""
    return _process_vnpay_return_verification(
        query_params=payload.vnp_params,
        session_id_hint=payload.session_id,
        current_user=current_user,
        db=db,
    )


@router.get("/vnpay/return")
def verify_vnpay_return_get(
    http_request: Request,
    current_user: User | None = Depends(get_current_user_optional),
    db: Session = Depends(get_db),
) -> RedirectResponse:
    """Browser ReturnURL handler for VNPay redirects; verifies HMAC-SHA512 and redirects to /billing/success."""
    query_params = dict(http_request.query_params)
    session_id_hint = query_params.get("session_id")
    frontend_url = os.getenv("FRONTEND_URL", "").rstrip("/")

    try:
        res = _process_vnpay_return_verification(
            query_params=query_params,
            session_id_hint=session_id_hint,
            current_user=current_user,
            db=db,
        )
        sid = res["transaction"]["stripe_session_id"]
        qs = http_request.url.query
        target = f"{frontend_url}/billing/success?session_id={sid}&{qs}"
        return RedirectResponse(url=target, status_code=302)
    except HTTPException:
        target = f"{frontend_url}/pricing?canceled=1"
        return RedirectResponse(url=target, status_code=302)


@router.get("/vnpay/ipn")
def vnpay_ipn_webhook(
    http_request: Request,
    db: Session = Depends(get_db),
) -> dict[str, str]:
    """Official VNPay Server-to-Server Instant Payment Notification (IPN) Webhook.

    Strictly follows VNPay IPN specification (https://sandbox.vnpayment.vn/apis/ & vnpay.js.org):
    Always responds with HTTP 200 JSON {"RspCode": "...", "Message": "..."}:
    - 97: Invalid HMAC-SHA512 checksum signature
    - 01: Order (vnp_TxnRef) not found
    - 04: Invalid amount (vnp_Amount mismatch)
    - 02: Order already confirmed (idempotent replay guard)
    - 00: Confirm Success
    """
    try:
        query_params = dict(http_request.query_params)
        vnpay = VNPayService()
        verify_result = vnpay.verify_ipn_call(query_params)

        if not verify_result.is_verified:
            return dict(IpnFailChecksum)

        repo = Repository(db)
        tx = repo.get_billing_transaction_by_vnp_txn_ref(verify_result.txn_ref)
        if not tx:
            return dict(IpnOrderNotFound)

        expected_vnd = (
            int(tx.amount_vnd)
            if getattr(tx, "amount_vnd", None) is not None
            else vnpay.usd_to_vnd(float(tx.amount_usd))
        )
        if verify_result.raw_vnp_amount != int(expected_vnd * 100):
            return dict(IpnInvalidAmount)

        if tx.status in ("succeeded", "failed", "canceled"):
            return dict(IpnOrderAlreadyConfirmed)

        if verify_result.is_success:
            target_user = repo.get_user_by_id(tx.user_id)
            if not target_user:
                return dict(IpnOrderNotFound)

            brand_key = (
                "vnpay_qr"
                if verify_result.card_type == "QRCODE" or verify_result.bank_code == "VNPAYQR"
                else verify_result.bank_code.lower()
            )
            if brand_key not in VALID_CARD_BRANDS:
                brand_key = "vnpay"

            _activate_paid_transaction(
                repo=repo,
                db=db,
                tx=tx,
                target_user=target_user,
                payment_method="vnpay",
                payment_mode="vnpay_sandbox",
                card_brand=brand_key,
                card_last4="VNQR" if brand_key == "vnpay_qr" else "2198",
                billing_country="VN",
                vnp_txn_ref=verify_result.txn_ref,
                vnp_transaction_no=verify_result.transaction_no,
                vnp_bank_code=verify_result.bank_code,
                vnp_card_type=verify_result.card_type,
                vnp_response_code=verify_result.response_code,
                amount_vnd=verify_result.amount_vnd,
            )
        else:
            tx.status = "canceled" if verify_result.response_code == "24" else "failed"
            tx.vnp_response_code = verify_result.response_code
            if verify_result.transaction_no:
                tx.vnp_transaction_no = verify_result.transaction_no[:64]
            repo.commit()

        return dict(IpnSuccess)
    except Exception as exc:
        logger.error(f"VNPay IPN processing error: {exc}")
        return dict(IpnUnknownError)


@router.post("/cancel")
def cancel_subscription(
    request: CancelSubscriptionRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Cancel auto-renewal at period end or downgrade immediately to Basic."""
    repo = Repository(db)
    current_tier = (current_user.plan_tier or "basic").lower()
    if current_tier == "basic":
        raise HTTPException(
            status_code=400,
            detail="You are currently on the free Basic plan.",
        )

    if request.immediate:
        current_user.plan_tier = "basic"
        current_user.billing_cycle = None
        current_user.subscription_status = "canceled"
        current_user.cancel_at_period_end = 0
        current_user.current_period_end = None
        current_user.stripe_subscription_id = None
        msg = "Subscription canceled immediately. Your account is now on the Basic plan."
    else:
        current_user.cancel_at_period_end = 1
        msg = "Subscription auto-renewal canceled. You will retain paid benefits until the end of your billing period."

    repo.commit()
    db.refresh(current_user)

    return {
        "message": msg,
        "subscription": get_user_subscription_summary(current_user),
        "user": _to_response_dict(current_user),
    }


@router.post("/reactivate")
def reactivate_subscription(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Resume auto-renewal for a subscription scheduled to cancel at period end."""
    repo = Repository(db)
    if (current_user.plan_tier or "basic").lower() == "basic":
        raise HTTPException(
            status_code=400,
            detail="No active paid subscription to reactivate.",
        )

    current_user.cancel_at_period_end = 0
    current_user.subscription_status = "active"
    repo.commit()
    db.refresh(current_user)

    return {
        "message": "Subscription auto-renewal has been reactivated.",
        "subscription": get_user_subscription_summary(current_user),
        "user": _to_response_dict(current_user),
    }


# ---------- Admin Promo Code Management Endpoints ----------


def _validate_promo_fields(
    discount_type: str,
    discount_value: float,
    applicable_tiers: str,
    applicable_cycles: str,
) -> tuple[str, float, str, str]:
    dtype = (discount_type or "percent").strip().lower()
    if dtype not in VALID_DISCOUNT_TYPES:
        raise HTTPException(
            status_code=400,
            detail="Invalid discount_type. Must be 'percent' or 'fixed'.",
        )
    dval = float(discount_value)
    if dtype == "percent" and (dval <= 0 or dval > 100):
        raise HTTPException(
            status_code=400,
            detail="Percentage discount must be between 1% and 100%.",
        )
    if dtype == "fixed" and (dval <= 0 or dval > 2000):
        raise HTTPException(
            status_code=400,
            detail="Fixed discount must be between $0.01 and $2,000.00 USD.",
        )

    tiers = (applicable_tiers or "all").strip().lower()
    if tiers not in VALID_APPLICABLE_TIERS:
        raise HTTPException(
            status_code=400,
            detail="Invalid applicable_tiers. Must be 'all', 'pro', or 'ultra'.",
        )

    cycles = (applicable_cycles or "all").strip().lower()
    if cycles not in VALID_APPLICABLE_CYCLES:
        raise HTTPException(
            status_code=400,
            detail="Invalid applicable_cycles. Must be 'all', 'monthly', or 'annual'.",
        )
    return dtype, dval, tiers, cycles


@router.get("/admin/promos")
def admin_list_promo_codes(
    admin_user: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """List all promotional codes and redemption telemetry (Admin only)."""
    _ = admin_user
    repo = Repository(db)
    promos = repo.list_promo_codes()
    return {
        "stats": repo.get_promo_summary_stats(),
        "promos": [_serialize_promo(p) for p in promos],
    }


@router.get("/admin/promos/generate-code")
def admin_generate_promo_code(
    admin_user: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> dict[str, str]:
    """Generate a unique 6-character uppercase alphanumeric promo code (Admin only)."""
    _ = admin_user
    repo = Repository(db)
    return {"code": repo.generate_unique_promo_code()}


@router.post("/admin/promos", status_code=201)
def admin_create_promo_code(
    request: PromoCodeCreateRequest,
    admin_user: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Create a new 6-character promo code (Admin only)."""
    repo = Repository(db)
    raw_code = (request.code or "").strip().upper()
    if not raw_code:
        code = repo.generate_unique_promo_code()
    else:
        if not PROMO_CODE_RE.match(raw_code):
            raise HTTPException(
                status_code=400,
                detail="Promo code must be exactly 6 uppercase alphanumeric characters (A-Z, 0-9).",
            )
        code = raw_code

    if repo.get_promo_code_by_code(code) is not None:
        raise HTTPException(
            status_code=409,
            detail=f"Promo code '{code}' already exists.",
        )

    dtype, dval, tiers, cycles = _validate_promo_fields(
        request.discount_type,
        request.discount_value,
        request.applicable_tiers,
        request.applicable_cycles,
    )

    promo = repo.create_promo_code(
        code=code,
        description=(request.description or "").strip() or None,
        discount_type=dtype,
        discount_value=dval,
        max_discount_usd=request.max_discount_usd,
        min_amount_usd=request.min_amount_usd,
        applicable_tiers=tiers,
        applicable_cycles=cycles,
        max_uses=request.max_uses,
        max_uses_per_user=request.max_uses_per_user,
        is_active=request.is_active,
        expires_at=_ensure_utc(request.expires_at),
        created_by=admin_user.id,
    )
    repo.commit()
    db.refresh(promo)
    return _serialize_promo(promo)


@router.patch("/admin/promos/{promo_id}")
@router.put("/admin/promos/{promo_id}")
def admin_update_promo_code(
    promo_id: int,
    request: PromoCodeUpdateRequest,
    admin_user: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Update an existing promo code's status, limits, or discount settings (Admin only)."""
    _ = admin_user
    repo = Repository(db)
    promo = repo.get_promo_code_by_id(promo_id)
    if not promo:
        raise HTTPException(status_code=404, detail="Promo code not found")

    dtype, dval, tiers, cycles = _validate_promo_fields(
        request.discount_type if request.discount_type is not None else promo.discount_type,
        request.discount_value if request.discount_value is not None else float(promo.discount_value),
        request.applicable_tiers if request.applicable_tiers is not None else promo.applicable_tiers,
        request.applicable_cycles if request.applicable_cycles is not None else promo.applicable_cycles,
    )

    updates: dict[str, Any] = {
        "discount_type": dtype,
        "discount_value": dval,
        "applicable_tiers": tiers,
        "applicable_cycles": cycles,
    }
    fields_set = request.model_fields_set
    if "description" in fields_set:
        updates["description"] = (request.description or "").strip() or None
    if "max_discount_usd" in fields_set:
        updates["max_discount_usd"] = request.max_discount_usd
    if "min_amount_usd" in fields_set and request.min_amount_usd is not None:
        updates["min_amount_usd"] = float(request.min_amount_usd)
    if "max_uses" in fields_set:
        updates["max_uses"] = request.max_uses
    if "max_uses_per_user" in fields_set and request.max_uses_per_user is not None:
        updates["max_uses_per_user"] = int(request.max_uses_per_user)
    if "is_active" in fields_set and request.is_active is not None:
        updates["is_active"] = request.is_active
    if "expires_at" in fields_set:
        updates["expires_at"] = _ensure_utc(request.expires_at)

    updated = repo.update_promo_code(promo_id, **updates)
    repo.commit()
    assert updated is not None
    db.refresh(updated)
    return _serialize_promo(updated)


@router.delete("/admin/promos/{promo_id}")
def admin_delete_promo_code(
    promo_id: int,
    admin_user: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    """Delete a promo code (Admin only)."""
    _ = admin_user
    repo = Repository(db)
    promo = repo.get_promo_code_by_id(promo_id)
    if not promo:
        raise HTTPException(status_code=404, detail="Promo code not found")
    code = promo.code
    repo.delete_promo_code(promo_id)
    repo.commit()
    return {
        "message": f"Promo code '{code}' deleted.",
        "deleted_id": promo_id,
        "code": code,
    }
