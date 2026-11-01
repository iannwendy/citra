"""SQLAlchemy session factory."""

from __future__ import annotations

import os
from pathlib import Path

from sqlalchemy import create_engine, event, inspect
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import NullPool, StaticPool

from integrity_checker.config import get_settings, is_main_app_db_url, is_test_runtime
from integrity_checker.db.models import Base, PromoCode, User


_engine: Engine | None = None
_engine_url: str | None = None
_SessionLocal: sessionmaker[Session] | None = None


def get_engine() -> Engine:
    """Lazy singleton engine — automatically rebinds if database.url changes."""
    global _engine, _engine_url, _SessionLocal
    settings = get_settings()
    url = settings.database.url

    # Hard safety guard: never let pytest or test mode touch the main app.db
    if is_test_runtime() and is_main_app_db_url(url):
        url = "sqlite:///:memory:"

    if _engine is None or _engine_url != url:
        is_sqlite = url.startswith("sqlite")
        is_memory = url == "sqlite:///:memory:" or ":memory:" in url
        if is_sqlite and not is_memory and url.startswith("sqlite:///"):
            raw_path = url.removeprefix("sqlite:///").split("?", 1)[0]
            if raw_path:
                Path(raw_path).parent.mkdir(parents=True, exist_ok=True)

        connect_args = {"check_same_thread": False, "timeout": 30} if is_sqlite else {}
        kwargs: dict = {
            "echo": settings.database.echo,
            "connect_args": connect_args,
        }
        if is_memory:
            kwargs["poolclass"] = StaticPool
        elif is_sqlite:
            # Use NullPool for file-backed SQLite so connections are not kept open
            # across requests over Docker VirtioFS bind mounts.
            kwargs["poolclass"] = NullPool
        _engine = create_engine(url, **kwargs)
        if is_sqlite and not is_memory:
            @event.listens_for(_engine, "connect")
            def _set_sqlite_pragma(dbapi_connection, _connection_record) -> None:
                cursor = dbapi_connection.cursor()
                cursor.execute("PRAGMA journal_mode=DELETE")
                cursor.execute("PRAGMA synchronous=NORMAL")
                cursor.execute("PRAGMA busy_timeout=30000")
                cursor.close()

        _engine_url = url
        _SessionLocal = None
    return _engine


def get_session() -> Session:
    """Trả về session mới. Caller chịu trách nhiệm close."""
    global _SessionLocal
    engine = get_engine()
    if _SessionLocal is None:
        _ensure_db_initialized()
        _SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    return _SessionLocal()


def _run_inline_migrations(engine: Engine) -> None:
    """Apply incremental ALTER TABLE migrations not covered by create_all.

    History:
        2026-09-30 (v1.8) — citations table gained mapping_status,
            mapping_confidence, citation_link_json so the UI Citations tab can
            show the real linking verdict for each in-text occurrence (these
            fields were previously attached in-memory only).
        2026-10-03 (v1.10) — users table gained email, full_name, avatar_path,
            is_active, last_login_at to support account management (admin CRUD,
            self-profile edit, avatar upload).
        2026-10-15 (v1.15) — users table gained institution, can_override_verdicts
            for teacher support. classes + class_memberships tables are created
            by Base.metadata.create_all (no ALTER needed — fresh tables).
        2026-10-21 (v1.16) — citations + verdicts tables gained context, the
            surrounding PDF text of a citation, so the Document Inspector can
            render the sentence a citation appears in.
    """
    with engine.begin() as conn:
        inspector = inspect(conn)

        def _col_names(table_name: str) -> set[str]:
            try:
                return {col["name"] for col in inspector.get_columns(table_name)}
            except Exception:
                return set()

        # --- citations ---
        cit_cols = _col_names("citations")
        if "mapping_status" not in cit_cols:
            conn.exec_driver_sql(
                "ALTER TABLE citations ADD COLUMN mapping_status VARCHAR"
            )
        if "mapping_confidence" not in cit_cols:
            conn.exec_driver_sql(
                "ALTER TABLE citations ADD COLUMN mapping_confidence FLOAT DEFAULT 0"
            )
        if "citation_link_json" not in cit_cols:
            conn.exec_driver_sql(
                "ALTER TABLE citations ADD COLUMN citation_link_json TEXT"
            )
        if "context" not in cit_cols:
            conn.exec_driver_sql(
                "ALTER TABLE citations ADD COLUMN context TEXT"
            )

        # --- verdicts (v1.16 citation context) ---
        verdict_cols = _col_names("verdicts")
        if "context" not in verdict_cols:
            conn.exec_driver_sql(
                "ALTER TABLE verdicts ADD COLUMN context TEXT"
            )

        # --- essays (class_id assignment) ---
        essay_cols = _col_names("essays")
        if "class_id" not in essay_cols:
            conn.exec_driver_sql(
                "ALTER TABLE essays ADD COLUMN class_id INTEGER REFERENCES classes(id)"
            )

        # --- classes (v2.3 — student self-enrollment join_code) ---
        class_cols = _col_names("classes")
        if class_cols and "join_code" not in class_cols:
            conn.exec_driver_sql(
                "ALTER TABLE classes ADD COLUMN join_code VARCHAR(20)"
            )
            conn.exec_driver_sql(
                "CREATE UNIQUE INDEX IF NOT EXISTS idx_classes_join_code ON classes(join_code) WHERE join_code IS NOT NULL"
            )
        if class_cols:
            rows = conn.exec_driver_sql(
                "SELECT id FROM classes WHERE join_code IS NULL OR join_code = ''"
            ).fetchall()
            for (cid,) in rows:
                code = f"CITRA-{1000 + int(cid):04d}"
                conn.exec_driver_sql(
                    "UPDATE classes SET join_code = ? WHERE id = ?",
                    (code, cid),
                )

        # --- users (v1.10 account management) ---
        user_cols = _col_names("users")
        if "email" not in user_cols:
            conn.exec_driver_sql("ALTER TABLE users ADD COLUMN email VARCHAR(255)")
            # Unique index (separate from column unique=True so existing DBs migrate)
            conn.exec_driver_sql(
                "CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email) WHERE email IS NOT NULL"
            )
        if "full_name" not in user_cols:
            conn.exec_driver_sql("ALTER TABLE users ADD COLUMN full_name VARCHAR(120)")
        if "avatar_path" not in user_cols:
            conn.exec_driver_sql("ALTER TABLE users ADD COLUMN avatar_path VARCHAR(500)")
        if "is_active" not in user_cols:
            conn.exec_driver_sql("ALTER TABLE users ADD COLUMN is_active INTEGER DEFAULT 1")
        if "last_login_at" not in user_cols:
            conn.exec_driver_sql("ALTER TABLE users ADD COLUMN last_login_at DATETIME")

        # --- users (v1.15 — teacher support) ---
        if "institution" not in user_cols:
            conn.exec_driver_sql("ALTER TABLE users ADD COLUMN institution VARCHAR(255)")
        if "can_override_verdicts" not in user_cols:
            conn.exec_driver_sql(
                "ALTER TABLE users ADD COLUMN can_override_verdicts INTEGER DEFAULT 0"
            )
        # --- users (v1.17 — email verification) ---
        if "email_verified" not in user_cols:
            conn.exec_driver_sql(
                "ALTER TABLE users ADD COLUMN email_verified INTEGER DEFAULT 1"
            )

        # --- users (v2.3 — Google OAuth2 account linking) ---
        if "google_id" not in user_cols:
            conn.exec_driver_sql(
                "ALTER TABLE users ADD COLUMN google_id VARCHAR(255)"
            )
            conn.exec_driver_sql(
                "CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id) WHERE google_id IS NOT NULL"
            )
        if "auth_provider" not in user_cols:
            conn.exec_driver_sql(
                "ALTER TABLE users ADD COLUMN auth_provider VARCHAR(30) DEFAULT 'local'"
            )
        if "username_customized" not in user_cols:
            conn.exec_driver_sql(
                "ALTER TABLE users ADD COLUMN username_customized INTEGER DEFAULT 1"
            )
            conn.exec_driver_sql(
                "UPDATE users SET username_customized = 0 WHERE auth_provider = 'google'"
            )
        if "google_onboarded" not in user_cols:
            conn.exec_driver_sql(
                "ALTER TABLE users ADD COLUMN google_onboarded INTEGER DEFAULT 1"
            )
            conn.exec_driver_sql(
                "UPDATE users SET google_onboarded = 0, username_customized = 0, auth_provider = 'google' WHERE google_id IS NOT NULL"
            )

        # --- users (v2.2 — Premium Subscription & Quota fields) ---
        if "plan_tier" not in user_cols:
            conn.exec_driver_sql(
                "ALTER TABLE users ADD COLUMN plan_tier VARCHAR(20) DEFAULT 'basic'"
            )
            conn.exec_driver_sql(
                "UPDATE users SET plan_tier = 'ultra' WHERE role = 'admin'"
            )
            conn.exec_driver_sql(
                "UPDATE users SET plan_tier = 'pro' WHERE role = 'teacher'"
            )
        if "billing_cycle" not in user_cols:
            conn.exec_driver_sql(
                "ALTER TABLE users ADD COLUMN billing_cycle VARCHAR(20)"
            )
        if "subscription_status" not in user_cols:
            conn.exec_driver_sql(
                "ALTER TABLE users ADD COLUMN subscription_status VARCHAR(30) DEFAULT 'active'"
            )
        if "stripe_customer_id" not in user_cols:
            conn.exec_driver_sql(
                "ALTER TABLE users ADD COLUMN stripe_customer_id VARCHAR(120)"
            )
        if "stripe_subscription_id" not in user_cols:
            conn.exec_driver_sql(
                "ALTER TABLE users ADD COLUMN stripe_subscription_id VARCHAR(120)"
            )
        if "current_period_start" not in user_cols:
            conn.exec_driver_sql(
                "ALTER TABLE users ADD COLUMN current_period_start DATETIME"
            )
        if "current_period_end" not in user_cols:
            conn.exec_driver_sql(
                "ALTER TABLE users ADD COLUMN current_period_end DATETIME"
            )
        if "cancel_at_period_end" not in user_cols:
            conn.exec_driver_sql(
                "ALTER TABLE users ADD COLUMN cancel_at_period_end INTEGER DEFAULT 0"
            )
        if "monthly_uploads_used" not in user_cols:
            conn.exec_driver_sql(
                "ALTER TABLE users ADD COLUMN monthly_uploads_used INTEGER DEFAULT 0"
            )
        if "quota_reset_at" not in user_cols:
            conn.exec_driver_sql(
                "ALTER TABLE users ADD COLUMN quota_reset_at DATETIME"
            )

        # --- billing_transactions (v2.4 — Promo Code & Multi-Payment Method fields) ---
        bt_cols = _col_names("billing_transactions")
        if bt_cols:
            if "subtotal_usd" not in bt_cols:
                conn.exec_driver_sql(
                    "ALTER TABLE billing_transactions ADD COLUMN subtotal_usd FLOAT DEFAULT 0"
                )
                conn.exec_driver_sql(
                    "UPDATE billing_transactions SET subtotal_usd = amount_usd WHERE subtotal_usd IS NULL OR subtotal_usd = 0"
                )
            if "discount_usd" not in bt_cols:
                conn.exec_driver_sql(
                    "ALTER TABLE billing_transactions ADD COLUMN discount_usd FLOAT DEFAULT 0"
                )
            if "promo_code" not in bt_cols:
                conn.exec_driver_sql(
                    "ALTER TABLE billing_transactions ADD COLUMN promo_code VARCHAR(10)"
                )
            if "payment_method" not in bt_cols:
                conn.exec_driver_sql(
                    "ALTER TABLE billing_transactions ADD COLUMN payment_method VARCHAR(30) DEFAULT 'card'"
                )
            if "billing_country" not in bt_cols:
                conn.exec_driver_sql(
                    "ALTER TABLE billing_transactions ADD COLUMN billing_country VARCHAR(10) DEFAULT 'VN'"
                )
            if "billing_zip" not in bt_cols:
                conn.exec_driver_sql(
                    "ALTER TABLE billing_transactions ADD COLUMN billing_zip VARCHAR(20)"
                )

        # --- Clean up any historical orphan rows ---
        conn.exec_driver_sql(
            "DELETE FROM citations WHERE essay_id NOT IN (SELECT id FROM essays)"
        )
        conn.exec_driver_sql(
            "DELETE FROM verdicts WHERE essay_id NOT IN (SELECT id FROM essays)"
        )

        # --- Strategic Composite B-Tree Indexes for existing databases ---
        for idx_sql in (
            "CREATE INDEX IF NOT EXISTS idx_users_role_username ON users(role, username)",
            "CREATE INDEX IF NOT EXISTS idx_essays_user_uploaded ON essays(user_id, uploaded_at)",
            "CREATE INDEX IF NOT EXISTS idx_essays_class_uploaded ON essays(class_id, uploaded_at)",
            "CREATE INDEX IF NOT EXISTS idx_essays_user_filename ON essays(user_id, filename)",
            "CREATE INDEX IF NOT EXISTS idx_essays_uploaded_at ON essays(uploaded_at)",
            "CREATE INDEX IF NOT EXISTS idx_citations_essay_type ON citations(essay_id, citation_type)",
            "CREATE INDEX IF NOT EXISTS idx_verdicts_essay_override_label ON verdicts(essay_id, is_overridden, label)",
            "CREATE INDEX IF NOT EXISTS idx_verdicts_label ON verdicts(label)",
            "CREATE INDEX IF NOT EXISTS idx_audit_logs_user_logged ON audit_logs(user, logged_at)",
            "CREATE INDEX IF NOT EXISTS idx_audit_logs_logged_at ON audit_logs(logged_at)",
            "CREATE INDEX IF NOT EXISTS idx_promo_redemptions_promo_user ON promo_redemptions(promo_code_id, user_id)",
        ):
            conn.exec_driver_sql(idx_sql)


def _seed_default_users(engine: Engine) -> None:
    """Ensure default demo accounts (admin, teacher, user) exist in the main DB (dev/test only)."""
    if is_test_runtime() or not is_main_app_db_url(str(engine.url)):
        return
    settings = get_settings()
    app_env = (os.getenv("APP_ENV") or settings.app.env or "").strip().lower()
    if app_env in ("production", "prod", "live"):
        return
    demo_enabled = os.getenv("DEMO_USERS_ENABLED", "").strip().lower()
    if demo_enabled in ("false", "0", "no"):
        return
    if app_env not in ("development", "dev", "test", "testing") and demo_enabled not in (
        "true",
        "1",
        "yes",
    ):
        return

    import bcrypt

    defaults = [
        ("admin", "admin123", "admin", "admin@example.com", "Administrator", 1, "ultra"),
        ("teacher", "teacher123", "teacher", "teacher@example.com", "Demo Teacher", 1, "pro"),
        ("user", "user123", "user", "user@example.com", "Demo User", 0, "basic"),
    ]
    with Session(bind=engine) as session:
        existing_by_username = {u.username: u for u in session.query(User).all()}
        existing_emails = {u.email for u in existing_by_username.values() if u.email}
        added = False
        for username, password, role, email, full_name, can_override, default_tier in defaults:
            if username in existing_by_username:
                existing_user = existing_by_username[username]
                if can_override and not existing_user.can_override_verdicts:
                    existing_user.can_override_verdicts = can_override
                    added = True
                if not getattr(existing_user, "plan_tier", None):
                    existing_user.plan_tier = default_tier
                    added = True
                continue
            pwd_hash = bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()
            session.add(
                User(
                    username=username,
                    password_hash=pwd_hash,
                    role=role,
                    email=email if email not in existing_emails else None,
                    full_name=full_name,
                    is_active=1,
                    can_override_verdicts=can_override,
                    plan_tier=default_tier,
                )
            )
            added = True
        if added:
            session.commit()


def _seed_default_promo_codes(engine: Engine) -> None:
    """Seed starter 6-character promo codes on first initialization (non-test runtime)."""
    if is_test_runtime() or not is_main_app_db_url(str(engine.url)):
        return

    starter_promos = [
        {
            "code": "CITRA2",
            "description": "Welcome Academic Discount (20% Off Any Plan)",
            "discount_type": "percent",
            "discount_value": 20.0,
            "max_discount_usd": 100.0,
            "min_amount_usd": 0.0,
            "applicable_tiers": "all",
            "applicable_cycles": "all",
            "max_uses": 500,
            "max_uses_per_user": 1,
        },
        {
            "code": "TDTU50",
            "description": "TDTU Thesis & Research 50% Scholarship (Pro Plan)",
            "discount_type": "percent",
            "discount_value": 50.0,
            "max_discount_usd": 100.0,
            "min_amount_usd": 0.0,
            "applicable_tiers": "pro",
            "applicable_cycles": "all",
            "max_uses": 200,
            "max_uses_per_user": 1,
        },
        {
            "code": "SAVE10",
            "description": "Instant $10 USD Upgrade Voucher",
            "discount_type": "fixed",
            "discount_value": 10.0,
            "max_discount_usd": None,
            "min_amount_usd": 20.0,
            "applicable_tiers": "all",
            "applicable_cycles": "all",
            "max_uses": 300,
            "max_uses_per_user": 1,
        },
        {
            "code": "VIP100",
            "description": "Academic Fellowship 100% Full Fee Waiver (Pro Monthly)",
            "discount_type": "percent",
            "discount_value": 100.0,
            "max_discount_usd": 20.0,
            "min_amount_usd": 0.0,
            "applicable_tiers": "pro",
            "applicable_cycles": "monthly",
            "max_uses": 50,
            "max_uses_per_user": 1,
        },
    ]

    with Session(bind=engine) as session:
        if session.query(PromoCode).count() > 0:
            return
        for item in starter_promos:
            session.add(
                PromoCode(
                    code=item["code"],
                    description=item["description"],
                    discount_type=item["discount_type"],
                    discount_value=item["discount_value"],
                    max_discount_usd=item["max_discount_usd"],
                    min_amount_usd=item["min_amount_usd"],
                    applicable_tiers=item["applicable_tiers"],
                    applicable_cycles=item["applicable_cycles"],
                    max_uses=item["max_uses"],
                    max_uses_per_user=item["max_uses_per_user"],
                    used_count=0,
                    is_active=1,
                )
            )
        session.commit()


def _ensure_db_initialized() -> None:
    """Ensure all migrations have run and tables exist.

    Order matters: create_all FIRST so that any ALTER TABLE for fresh DBs
    (where tables don't exist yet) can find their target tables. Skipping
    this order causes "no such table: X" on first run with a clean DB.
    """
    engine = get_engine()
    Base.metadata.create_all(bind=engine)
    _run_inline_migrations(engine)
    _seed_default_users(engine)
    _seed_default_promo_codes(engine)


def init_db() -> None:
    """Public entry-point — used by FastAPI startup and CLI tools."""
    _ensure_db_initialized()
