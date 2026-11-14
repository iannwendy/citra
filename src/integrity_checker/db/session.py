"""SQLAlchemy session factory."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from sqlalchemy import create_engine, event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import NullPool, StaticPool

from integrity_checker.config import get_settings, is_main_app_db_url, is_test_runtime
from integrity_checker.db import sqlite_tuning as _sqlite_tuning
from integrity_checker.db.migrations import run_migrations
from integrity_checker.db.models import (  # noqa: F401
    ApiKey,
    Base,
    PromoCode,
    SchemaMigrationRecord,
    User,
)
from integrity_checker.db.sqlite_tuning import (
    apply_sqlite_connection_pragmas,
    detect_sqlite_filesystem_type,
    resolve_sqlite_journal_mode,
)


@dataclass(frozen=True)
class SqliteTuningReport:
    """Telemetry snapshot of adaptive SQLite WAL/PRAGMA tuning for `/api/system/health`."""

    db_path: str
    filesystem_type: str
    requested_journal_mode: str
    journal_mode: str
    effective_journal_mode: str
    wal_enabled: bool
    fallback_degraded: bool
    busy_timeout_ms: int = 30000
    synchronous: str = "NORMAL"
    mmap_bytes: int = 0
    wal_autocheckpoint: int = 1000

    def to_dict(self) -> dict[str, Any]:
        return {
            "db_path": self.db_path,
            "filesystem_type": self.filesystem_type,
            "requested_journal_mode": self.requested_journal_mode,
            "journal_mode": self.journal_mode,
            "effective_journal_mode": self.effective_journal_mode,
            "wal_enabled": self.wal_enabled,
            "fallback_degraded": self.fallback_degraded,
            "busy_timeout_ms": self.busy_timeout_ms,
            "synchronous": self.synchronous,
            "mmap_bytes": self.mmap_bytes,
            "wal_autocheckpoint": self.wal_autocheckpoint,
        }


_engine: Engine | None = None
_engine_url: str | None = None
_SessionLocal: sessionmaker[Session] | None = None
_LAST_APP_DB_TUNING_REPORT: Any | None = None


def get_app_db_tuning_report() -> dict[str, Any] | None:
    """Return the most recent SQLite WAL/PRAGMA tuning report for `app.db`, if available."""
    report = _LAST_APP_DB_TUNING_REPORT
    if report is None:
        return None
    to_dict_fn = getattr(report, "to_dict", None)
    if callable(to_dict_fn):
        return dict(to_dict_fn())
    if isinstance(report, dict):
        return dict(report)
    return None


def _apply_and_capture_app_db_pragmas(
    dbapi_connection: Any,
    db_path: Path,
    journal_mode: str,
    *,
    mmap_bytes: int = 0,
) -> None:
    global _LAST_APP_DB_TUNING_REPORT
    adaptive_fn = getattr(_sqlite_tuning, "apply_adaptive_sqlite_pragmas", None)
    if callable(adaptive_fn):
        _LAST_APP_DB_TUNING_REPORT = adaptive_fn(
            dbapi_connection,
            db_path,
            mmap_bytes=mmap_bytes,
        )
        return

    raw_req = (os.getenv("SQLITE_JOURNAL_MODE", "AUTO") or "AUTO").strip().upper() or "AUTO"
    fstype = detect_sqlite_filesystem_type(db_path)
    effective = apply_sqlite_connection_pragmas(
        dbapi_connection,
        journal_mode,
        mmap_bytes=mmap_bytes,
    )
    eff_upper = str(effective or journal_mode).strip().upper()
    _LAST_APP_DB_TUNING_REPORT = SqliteTuningReport(
        db_path=str(db_path),
        filesystem_type=fstype,
        requested_journal_mode=raw_req,
        journal_mode=eff_upper,
        effective_journal_mode=eff_upper,
        wal_enabled=(eff_upper == "WAL"),
        fallback_degraded=(raw_req in ("AUTO", "WAL") and eff_upper != "WAL"),
        busy_timeout_ms=30000,
        synchronous="NORMAL",
        mmap_bytes=int(mmap_bytes),
        wal_autocheckpoint=1000 if eff_upper == "WAL" else 0,
    )


def get_engine() -> Engine:
    """Lazy singleton engine — automatically rebinds if database.url changes."""
    global _engine, _engine_url, _SessionLocal, _LAST_APP_DB_TUNING_REPORT
    settings = get_settings()
    url = settings.database.url

    # Hard safety guard: never let pytest or test mode touch the main app.db
    if is_test_runtime() and is_main_app_db_url(url):
        url = "sqlite:///:memory:"

    if _engine is None or _engine_url != url:
        is_sqlite = url.startswith("sqlite")
        is_memory = url in ("sqlite://", "sqlite:///", "sqlite:///:memory:") or ":memory:" in url
        raw_path = ""
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
        if is_sqlite and is_memory:
            _LAST_APP_DB_TUNING_REPORT = SqliteTuningReport(
                db_path=":memory:",
                filesystem_type="memory",
                requested_journal_mode="MEMORY",
                journal_mode="MEMORY",
                effective_journal_mode="MEMORY",
                wal_enabled=False,
                fallback_degraded=False,
                busy_timeout_ms=30000,
                synchronous="NORMAL",
                mmap_bytes=0,
                wal_autocheckpoint=0,
            )
        elif is_sqlite and not is_memory and raw_path:
            db_path_obj = Path(raw_path)
            journal_mode = resolve_sqlite_journal_mode(db_path_obj)

            @event.listens_for(_engine, "connect")
            def _set_sqlite_pragma(dbapi_connection, _connection_record) -> None:
                _apply_and_capture_app_db_pragmas(
                    dbapi_connection,
                    db_path_obj,
                    journal_mode,
                )

            try:
                with _engine.connect():
                    pass
            except Exception:
                pass

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
    """Apply incremental schema migrations not covered by create_all.

    Delegates to the versioned, SHA-256 checksum-verified migration runner in
    ``integrity_checker.db.migrations.run_migrations`` (revisions ``0001``–``0010``).

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
    run_migrations(engine)


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
    if is_test_runtime():
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
