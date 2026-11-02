"""SQLAlchemy ORM models."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Literal

from sqlalchemy import (
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

# Role literals (v1.15 — Phase 3 teacher role).
# Backward compat: giữ "user" cho student, thêm "teacher" mới.
UserRoleLiteral = Literal["user", "teacher", "admin"]
VALID_USER_ROLES: tuple[str, ...] = ("user", "teacher", "admin")


class Base(DeclarativeBase):
    pass


class User(Base):
    """User model for authentication + account management."""

    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    username: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str] = mapped_column(String(20), default="user")
    # Account management fields (added v1.10 — see db/session.py migrations)
    email: Mapped[str | None] = mapped_column(String(255), unique=True, nullable=True, index=True)
    full_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    avatar_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    is_active: Mapped[bool] = mapped_column(Integer, default=1)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(UTC))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
    )
    # v1.15 (Phase 3) — teacher-specific fields
    institution: Mapped[str | None] = mapped_column(String(255), nullable=True)
    can_override_verdicts: Mapped[bool] = mapped_column(Integer, default=0)
    # v1.17 — email verification status (1 for admin/demo/verified, 0 for pending activation)
    email_verified: Mapped[bool] = mapped_column(Integer, default=1)
    # v2.3 — Google OAuth2 account linking & onboarding state
    google_id: Mapped[str | None] = mapped_column(String(255), unique=True, nullable=True, index=True)
    auth_provider: Mapped[str] = mapped_column(String(30), default="local")
    username_customized: Mapped[bool] = mapped_column(Integer, default=1)
    google_onboarded: Mapped[bool] = mapped_column(Integer, default=1)
    # v2.2 — Premium Subscription & Quota fields
    plan_tier: Mapped[str] = mapped_column(String(20), default="basic")
    billing_cycle: Mapped[str | None] = mapped_column(String(20), nullable=True)
    subscription_status: Mapped[str] = mapped_column(String(30), default="active")
    stripe_customer_id: Mapped[str | None] = mapped_column(String(120), nullable=True, index=True)
    stripe_subscription_id: Mapped[str | None] = mapped_column(String(120), nullable=True)
    current_period_start: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    current_period_end: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    cancel_at_period_end: Mapped[bool] = mapped_column(Integer, default=0)
    monthly_uploads_used: Mapped[int] = mapped_column(Integer, default=0)
    quota_reset_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    sessions: Mapped[list[Session]] = relationship(back_populates="user", cascade="all, delete-orphan")
    auth_tokens: Mapped[list[AuthToken]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    api_keys: Mapped[list[ApiKey]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    billing_transactions: Mapped[list[BillingTransaction]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    essays: Mapped[list[EssayRecord]] = relationship(back_populates="user")
    taught_classes: Mapped[list[Class]] = relationship(
        "Class", back_populates="teacher", foreign_keys="Class.teacher_id"
    )
    memberships: Mapped[list[ClassMembership]] = relationship(
        "ClassMembership", back_populates="student", foreign_keys="ClassMembership.student_id",
        cascade="all, delete-orphan",
    )


class Session(Base):
    """Session model for JWT token storage."""

    __tablename__ = "sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    token: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(UTC))

    user: Mapped[User] = relationship(back_populates="sessions")


class AuthToken(Base):
    """One-time cryptographic tokens for account activation and password reset."""

    __tablename__ = "auth_tokens"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    token_type: Mapped[str] = mapped_column(String(30), nullable=False)  # "activation" | "password_reset"
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    used_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=lambda: datetime.now(UTC)
    )

    user: Mapped[User] = relationship(back_populates="auth_tokens")


class ApiKey(Base):
    """Personal Developer API key (X-API-Key / citra_live_...) for programmatic access."""

    __tablename__ = "api_keys"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    key_prefix: Mapped[str] = mapped_column(String(24), nullable=False, index=True)
    key_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=lambda: datetime.now(UTC)
    )
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    is_active: Mapped[bool] = mapped_column(Integer, default=1)

    user: Mapped[User] = relationship(back_populates="api_keys")


class CitationCache(Base):
    """Citation cache model for API response caching."""

    __tablename__ = "citation_cache"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    cache_key: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    source: Mapped[str] = mapped_column(String(20), nullable=False)
    raw_response: Mapped[str] = mapped_column(Text, nullable=False)
    matched_fields: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(UTC))
    last_hit_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    hit_count: Mapped[int] = mapped_column(Integer, default=0)


# Indexes for CitationCache
Index("idx_cache_key", CitationCache.cache_key)
Index("idx_source", CitationCache.source)


class EssayRecord(Base):
    __tablename__ = "essays"
    __table_args__ = {"sqlite_autoincrement": True}

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    filename: Mapped[str] = mapped_column(String, nullable=False)
    num_pages: Mapped[int] = mapped_column(Integer, default=0)
    uploaded_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(UTC))
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    class_id: Mapped[int | None] = mapped_column(ForeignKey("classes.id", ondelete="SET NULL"), nullable=True, index=True)
    # v1.2 — full pipeline output (JSON serialized)
    style_profile_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    cis_json: Mapped[str | None] = mapped_column(Text, nullable=True)

    user: Mapped[User | None] = relationship(back_populates="essays")

    citations: Mapped[list[CitationRecord]] = relationship(
        back_populates="essay", cascade="all, delete-orphan", passive_deletes=True
    )
    verdicts: Mapped[list[VerdictRecord]] = relationship(
        back_populates="essay", cascade="all, delete-orphan", passive_deletes=True
    )


class CitationRecord(Base):
    __tablename__ = "citations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    essay_id: Mapped[int] = mapped_column(ForeignKey("essays.id", ondelete="CASCADE"), nullable=False, index=True)
    raw_text: Mapped[str] = mapped_column(Text, nullable=False)
    citation_type: Mapped[str] = mapped_column(String, default="unknown")
    style: Mapped[str] = mapped_column(String, default="unknown")
    authors: Mapped[str] = mapped_column(Text, default="[]")  # JSON array
    year: Mapped[str | None] = mapped_column(String, nullable=True)
    title: Mapped[str | None] = mapped_column(Text, nullable=True)
    venue: Mapped[str | None] = mapped_column(String, nullable=True)
    doi: Mapped[str | None] = mapped_column(String, nullable=True)
    url: Mapped[str | None] = mapped_column(Text, nullable=True)
    page_num: Mapped[int] = mapped_column(Integer, default=0)
    confidence: Mapped[float] = mapped_column(Float, default=0.0)

    # NEW v1.8 — linking layer persisted so the UI Citations tab can
    # display the real mapping_status / citation_link for every occurrence
    # (previously these were attached in-memory only and became null when
    # reloaded from the DB, which made every in-text render as "Linked").
    mapping_status: Mapped[str | None] = mapped_column(String, nullable=True)
    mapping_confidence: Mapped[float] = mapped_column(Float, default=0.0)
    citation_link_json: Mapped[str | None] = mapped_column(Text, nullable=True)

    # NEW v1.16 — surrounding text of the citation in the PDF, so the
    # Document Inspector can show the sentence the citation sits in.
    # Nullable: older rows (and citations with no extractable context) stay NULL.
    context: Mapped[str | None] = mapped_column(Text, nullable=True)

    essay: Mapped[EssayRecord] = relationship(back_populates="citations")


class VerdictRecord(Base):
    __tablename__ = "verdicts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    essay_id: Mapped[int] = mapped_column(ForeignKey("essays.id", ondelete="CASCADE"), nullable=False, index=True)
    citation_raw: Mapped[str] = mapped_column(Text, nullable=False)
    label: Mapped[str] = mapped_column(String, nullable=False)
    confidence: Mapped[float] = mapped_column(Float, default=0.0)
    reasoning: Mapped[str] = mapped_column(Text, default="")
    triggered_rules: Mapped[str] = mapped_column(Text, default="[]")  # JSON array
    mismatched_fields: Mapped[str] = mapped_column(Text, default="[]")
    features: Mapped[str] = mapped_column(Text, default="{}")  # JSON object
    validated_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(UTC))

    # v1.2 — Citation Integrity (linking layer)
    mapping_status: Mapped[str | None] = mapped_column(String, nullable=True, default="matched")
    mapping_confidence: Mapped[float] = mapped_column(Float, default=0.0)
    style_penalty: Mapped[float | None] = mapped_column(Float, nullable=True)
    domain_exception: Mapped[bool] = mapped_column(Integer, default=0)  # SQLite bool

    # v1.2 — Override
    is_overridden: Mapped[bool] = mapped_column(Integer, default=0)
    override_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    overridden_by: Mapped[str | None] = mapped_column(String, nullable=True)

    # NEW v1.16 — surrounding text of the citation in the PDF, so the
    # Document Inspector can show the sentence the citation sits in.
    context: Mapped[str | None] = mapped_column(Text, nullable=True)

    essay: Mapped[EssayRecord] = relationship(back_populates="verdicts")


class AuditLog(Base):
    """Override của giảng viên — log lại để minh bạch."""

    __tablename__ = "audit_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    verdict_id: Mapped[int] = mapped_column(ForeignKey("verdicts.id", ondelete="CASCADE"), nullable=False, index=True)
    original_label: Mapped[str] = mapped_column(String, nullable=False)
    new_label: Mapped[str] = mapped_column(String, nullable=False)
    user: Mapped[str] = mapped_column(String, nullable=False)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    logged_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(UTC))


# ---------------------------------------------------------------------------
# v1.15 (Phase 3) — Teacher / Class models
# ---------------------------------------------------------------------------


class Class(Base):
    """Một lớp học do 1 teacher phụ trách, có nhiều students (qua ClassMembership)."""

    __tablename__ = "classes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(120), unique=True, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    join_code: Mapped[str | None] = mapped_column(String(20), unique=True, nullable=True, index=True)
    teacher_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(UTC))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
    )

    teacher: Mapped[User] = relationship("User", foreign_keys=[teacher_id], back_populates="taught_classes")
    memberships: Mapped[list[ClassMembership]] = relationship(
        back_populates="class_", cascade="all, delete-orphan"
    )


class ClassMembership(Base):
    """Many-to-many User ↔ Class. Student enrolled in N classes."""

    __tablename__ = "class_memberships"
    __table_args__ = (
        UniqueConstraint("class_id", "student_id", name="uq_class_membership_class_student"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    class_id: Mapped[int] = mapped_column(ForeignKey("classes.id", ondelete="CASCADE"), nullable=False, index=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    joined_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(UTC))

    class_: Mapped[Class] = relationship(back_populates="memberships")
    student: Mapped[User] = relationship("User", foreign_keys=[student_id], back_populates="memberships")


class BillingTransaction(Base):
    """Stripe / VNPay / Demo billing transaction and invoice record (v2.2 / v2.5 Multi-Payment & VNPay)."""

    __tablename__ = "billing_transactions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    stripe_session_id: Mapped[str] = mapped_column(String(120), unique=True, nullable=False, index=True)
    stripe_payment_intent_id: Mapped[str | None] = mapped_column(String(120), nullable=True)
    plan_tier: Mapped[str] = mapped_column(String(20), nullable=False)  # "pro" | "ultra"
    billing_cycle: Mapped[str] = mapped_column(String(20), nullable=False)  # "monthly" | "annual"
    subtotal_usd: Mapped[float] = mapped_column(Float, default=0.0)
    discount_usd: Mapped[float] = mapped_column(Float, default=0.0)
    promo_code: Mapped[str | None] = mapped_column(String(10), nullable=True, index=True)
    amount_usd: Mapped[float] = mapped_column(Float, nullable=False)
    amount_vnd: Mapped[int | None] = mapped_column(Integer, nullable=True)
    currency: Mapped[str] = mapped_column(String(10), default="usd")
    status: Mapped[str] = mapped_column(String(30), default="pending")  # "pending" | "succeeded" | "canceled" | "failed"
    payment_mode: Mapped[str] = mapped_column(String(20), default="stripe_demo")  # "stripe_test" | "stripe_demo" | "vnpay_sandbox" | "vnpay_live"
    payment_method: Mapped[str] = mapped_column(String(30), default="card")  # "card" | "apple_pay" | "google_pay" | "vnpay"
    card_brand: Mapped[str | None] = mapped_column(String(20), default="visa")
    card_last4: Mapped[str | None] = mapped_column(String(4), default="4242")
    billing_country: Mapped[str | None] = mapped_column(String(10), default="VN")
    billing_zip: Mapped[str | None] = mapped_column(String(20), nullable=True)
    vnp_txn_ref: Mapped[str | None] = mapped_column(String(120), nullable=True, index=True)
    vnp_transaction_no: Mapped[str | None] = mapped_column(String(64), nullable=True)
    vnp_bank_code: Mapped[str | None] = mapped_column(String(32), nullable=True)
    vnp_card_type: Mapped[str | None] = mapped_column(String(32), nullable=True)
    vnp_response_code: Mapped[str | None] = mapped_column(String(10), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=lambda: datetime.now(UTC)
    )
    paid_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    user: Mapped[User] = relationship(back_populates="billing_transactions")


class PromoCode(Base):
    """6-character promotional discount code managed by Administrators."""

    __tablename__ = "promo_codes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    code: Mapped[str] = mapped_column(String(6), unique=True, nullable=False, index=True)
    description: Mapped[str | None] = mapped_column(String(255), nullable=True)
    discount_type: Mapped[str] = mapped_column(String(20), default="percent")  # "percent" | "fixed"
    discount_value: Mapped[float] = mapped_column(Float, nullable=False)
    max_discount_usd: Mapped[float | None] = mapped_column(Float, nullable=True)
    min_amount_usd: Mapped[float] = mapped_column(Float, default=0.0)
    applicable_tiers: Mapped[str] = mapped_column(String(20), default="all")  # "all" | "pro" | "ultra"
    applicable_cycles: Mapped[str] = mapped_column(String(20), default="all")  # "all" | "monthly" | "annual"
    max_uses: Mapped[int | None] = mapped_column(Integer, nullable=True)
    max_uses_per_user: Mapped[int] = mapped_column(Integer, default=1)
    used_count: Mapped[int] = mapped_column(Integer, default=0)
    is_active: Mapped[bool] = mapped_column(Integer, default=1)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_by: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=lambda: datetime.now(UTC)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
    )

    redemptions: Mapped[list[PromoRedemption]] = relationship(
        back_populates="promo", cascade="all, delete-orphan"
    )


class PromoRedemption(Base):
    """Audit record of a user redeeming a PromoCode on a BillingTransaction."""

    __tablename__ = "promo_redemptions"
    __table_args__ = (
        UniqueConstraint("promo_code_id", "transaction_id", name="uq_promo_redemption_tx"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    promo_code_id: Mapped[int] = mapped_column(
        ForeignKey("promo_codes.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    transaction_id: Mapped[int] = mapped_column(
        ForeignKey("billing_transactions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    code: Mapped[str] = mapped_column(String(6), nullable=False)
    discount_usd: Mapped[float] = mapped_column(Float, nullable=False)
    redeemed_at: Mapped[datetime] = mapped_column(
        DateTime, default=lambda: datetime.now(UTC)
    )

    promo: Mapped[PromoCode] = relationship(back_populates="redemptions")


# ---------------------------------------------------------------------------
# Strategic Composite B-Tree Indexes (Performance Optimization)
# ---------------------------------------------------------------------------
Index("idx_users_role_username", User.role, User.username)
Index("idx_essays_user_uploaded", EssayRecord.user_id, EssayRecord.uploaded_at)
Index("idx_essays_class_uploaded", EssayRecord.class_id, EssayRecord.uploaded_at)
Index("idx_essays_user_filename", EssayRecord.user_id, EssayRecord.filename)
Index("idx_essays_uploaded_at", EssayRecord.uploaded_at)
Index("idx_citations_essay_type", CitationRecord.essay_id, CitationRecord.citation_type)
Index(
    "idx_verdicts_essay_override_label",
    VerdictRecord.essay_id,
    VerdictRecord.is_overridden,
    VerdictRecord.label,
)
Index("idx_verdicts_label", VerdictRecord.label)
Index("idx_audit_logs_user_logged", AuditLog.user, AuditLog.logged_at)
Index("idx_audit_logs_logged_at", AuditLog.logged_at)
Index("idx_promo_redemptions_promo_user", PromoRedemption.promo_code_id, PromoRedemption.user_id)
