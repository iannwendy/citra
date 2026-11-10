"""Database schema migration primitives, security validators, checksum engine, and Alembic runner."""

from __future__ import annotations

import argparse
import gc
import hashlib
import os
import re
import sqlite3
import time
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import inspect, text
from sqlalchemy.engine import Connection, Engine
from sqlalchemy.engine.reflection import Inspector
from sqlalchemy.exc import OperationalError

from integrity_checker.db.models import SchemaMigrationRecord

_SQL_IDENTIFIER_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
_REVISION_ID_RE = re.compile(r"^[0-9]{4}$")
_BACKUP_LABEL_RE = re.compile(r"^[A-Za-z0-9_.-]{1,64}$")
_SQLITE_HEADER_MAGIC = b"SQLite format 3\x00"

_CORE_BASE_TABLES: tuple[str, ...] = ("citations", "users", "essays", "verdicts")


class MigrationError(RuntimeError):
    """Base error raised when a database schema migration fails."""


class MigrationIntegrityError(MigrationError):
    """Raised when an applied migration checksum or revision chain fails verification."""


def validate_sql_identifier(identifier: str) -> str:
    """Validate that a SQL table/column/index identifier is safe from injection."""
    if not isinstance(identifier, str) or not _SQL_IDENTIFIER_RE.fullmatch(identifier):
        raise ValueError(f"Invalid SQL identifier: {identifier!r}")
    return identifier


def validate_revision_id(version: str) -> str:
    """Validate that a migration version is a canonical 4-digit revision ID."""
    if not isinstance(version, str) or not _REVISION_ID_RE.fullmatch(version):
        raise ValueError(f"Invalid migration version: {version!r}")
    return version


@dataclass(frozen=True)
class MigrationStep:
    """A single versioned, reversible database schema migration step."""

    version: str
    name: str
    description: str
    upgrade: Callable[[Connection, Operations], None]
    downgrade: Callable[[Connection, Operations], None]

    @property
    def checksum(self) -> str:
        """Compute deterministic SHA-256 hex digest for this migration step."""
        payload = f"{self.version}:{self.name}:{self.description}"
        return hashlib.sha256(payload.encode("utf-8")).hexdigest()


@dataclass(frozen=True)
class MigrationStatus:
    """Snapshot of the database schema migration ledger state."""

    current_version: str | None
    latest_version: str
    applied_versions: tuple[str, ...]
    pending_versions: tuple[str, ...]
    is_up_to_date: bool
    checksum_verified: bool


# ---------------------------------------------------------------------------
# Internal schema inspection & DDL helpers
# ---------------------------------------------------------------------------


def _table_exists(conn: Connection, table_name: str) -> bool:
    validate_sql_identifier(table_name)
    return table_name in set(inspect(conn).get_table_names())


def _column_names(conn: Connection, table_name: str) -> set[str]:
    validate_sql_identifier(table_name)
    inspector = inspect(conn)
    if table_name not in set(inspector.get_table_names()):
        return set()
    return {col["name"] for col in inspector.get_columns(table_name)}


def _add_column_if_missing(
    conn: Connection,
    op: Operations,
    table_name: str,
    column: sa.Column,
) -> bool:
    """Add a column via Alembic Operations only when it does not already exist."""
    validate_sql_identifier(table_name)
    validate_sql_identifier(column.name)
    existing = _column_names(conn, table_name)
    if column.name in existing:
        return False
    op.add_column(table_name, column)
    return True


def _drop_index_if_exists(conn: Connection, index_name: str) -> None:
    safe_idx = validate_sql_identifier(index_name)
    conn.exec_driver_sql(f"DROP INDEX IF EXISTS {safe_idx}")


def _drop_columns_safe(
    conn: Connection,
    op: Operations,
    table_name: str,
    columns: Sequence[str],
    *,
    extra_indexes: Sequence[str] = (),
) -> None:
    """Drop indexes referencing target columns, then drop columns via Alembic batch_alter_table."""
    safe_table = validate_sql_identifier(table_name)
    for col in columns:
        validate_sql_identifier(col)
    for idx_name in extra_indexes:
        _drop_index_if_exists(conn, idx_name)

    inspector = inspect(conn)
    if safe_table not in set(inspector.get_table_names()):
        return

    target_set = set(columns)
    for idx in inspector.get_indexes(safe_table):
        idx_name = idx.get("name")
        idx_cols = set(idx.get("column_names") or ())
        if idx_name and (idx_cols & target_set):
            _drop_index_if_exists(conn, idx_name)

    existing_cols = {col["name"] for col in inspector.get_columns(safe_table)}
    cols_to_drop = [col for col in columns if col in existing_cols]
    if not cols_to_drop:
        return

    with op.batch_alter_table(safe_table) as batch_op:
        for col in cols_to_drop:
            batch_op.drop_column(col)


# ---------------------------------------------------------------------------
# Versioned Migration Steps (0001 - 0009)
# ---------------------------------------------------------------------------


def _upgrade_0001(conn: Connection, op: Operations) -> None:
    _add_column_if_missing(
        conn, op, "citations", sa.Column("mapping_status", sa.String(), nullable=True)
    )
    _add_column_if_missing(
        conn,
        op,
        "citations",
        sa.Column("mapping_confidence", sa.Float(), nullable=True, server_default=sa.text("0")),
    )
    _add_column_if_missing(
        conn, op, "citations", sa.Column("citation_link_json", sa.Text(), nullable=True)
    )


def _downgrade_0001(conn: Connection, op: Operations) -> None:
    _drop_columns_safe(
        conn,
        op,
        "citations",
        ("citation_link_json", "mapping_confidence", "mapping_status"),
    )


def _upgrade_0002(conn: Connection, op: Operations) -> None:
    _add_column_if_missing(
        conn, op, "users", sa.Column("email", sa.String(255), nullable=True)
    )
    conn.exec_driver_sql(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email) WHERE email IS NOT NULL"
    )
    _add_column_if_missing(
        conn, op, "users", sa.Column("full_name", sa.String(120), nullable=True)
    )
    _add_column_if_missing(
        conn, op, "users", sa.Column("avatar_path", sa.String(500), nullable=True)
    )
    _add_column_if_missing(
        conn,
        op,
        "users",
        sa.Column("is_active", sa.Integer(), nullable=True, server_default=sa.text("1")),
    )
    _add_column_if_missing(
        conn, op, "users", sa.Column("last_login_at", sa.DateTime(), nullable=True)
    )


def _downgrade_0002(conn: Connection, op: Operations) -> None:
    _drop_columns_safe(
        conn,
        op,
        "users",
        ("last_login_at", "is_active", "avatar_path", "full_name", "email"),
        extra_indexes=("idx_users_email", "ix_users_email"),
    )


def _upgrade_0003(conn: Connection, op: Operations) -> None:
    _add_column_if_missing(
        conn, op, "users", sa.Column("institution", sa.String(255), nullable=True)
    )
    _add_column_if_missing(
        conn,
        op,
        "users",
        sa.Column(
            "can_override_verdicts", sa.Integer(), nullable=True, server_default=sa.text("0")
        ),
    )
    _add_column_if_missing(
        conn, op, "essays", sa.Column("class_id", sa.Integer(), nullable=True)
    )


def _downgrade_0003(conn: Connection, op: Operations) -> None:
    _drop_columns_safe(
        conn,
        op,
        "essays",
        ("class_id",),
        extra_indexes=("idx_essays_class_uploaded", "ix_essays_class_id"),
    )
    _drop_columns_safe(
        conn,
        op,
        "users",
        ("can_override_verdicts", "institution"),
    )


def _upgrade_0004(conn: Connection, op: Operations) -> None:
    _add_column_if_missing(
        conn, op, "citations", sa.Column("context", sa.Text(), nullable=True)
    )
    _add_column_if_missing(
        conn, op, "verdicts", sa.Column("context", sa.Text(), nullable=True)
    )


def _downgrade_0004(conn: Connection, op: Operations) -> None:
    _drop_columns_safe(conn, op, "verdicts", ("context",))
    _drop_columns_safe(conn, op, "citations", ("context",))


def _upgrade_0005(conn: Connection, op: Operations) -> None:
    _add_column_if_missing(
        conn,
        op,
        "users",
        sa.Column("email_verified", sa.Integer(), nullable=True, server_default=sa.text("1")),
    )


def _downgrade_0005(conn: Connection, op: Operations) -> None:
    _drop_columns_safe(conn, op, "users", ("email_verified",))


def _upgrade_0006(conn: Connection, op: Operations) -> None:
    added_plan_tier = _add_column_if_missing(
        conn,
        op,
        "users",
        sa.Column("plan_tier", sa.String(20), nullable=True, server_default=sa.text("'basic'")),
    )
    if added_plan_tier:
        conn.execute(text("UPDATE users SET plan_tier = 'ultra' WHERE role = 'admin'"))
        conn.execute(text("UPDATE users SET plan_tier = 'pro' WHERE role = 'teacher'"))
    else:
        conn.execute(
            text(
                "UPDATE users SET plan_tier = 'ultra' WHERE role = 'admin' AND (plan_tier IS NULL OR plan_tier = 'basic')"
            )
        )
        conn.execute(
            text(
                "UPDATE users SET plan_tier = 'pro' WHERE role = 'teacher' AND (plan_tier IS NULL OR plan_tier = 'basic')"
            )
        )

    _add_column_if_missing(
        conn, op, "users", sa.Column("billing_cycle", sa.String(20), nullable=True)
    )
    _add_column_if_missing(
        conn,
        op,
        "users",
        sa.Column(
            "subscription_status",
            sa.String(30),
            nullable=True,
            server_default=sa.text("'active'"),
        ),
    )
    _add_column_if_missing(
        conn, op, "users", sa.Column("stripe_customer_id", sa.String(120), nullable=True)
    )
    _add_column_if_missing(
        conn, op, "users", sa.Column("stripe_subscription_id", sa.String(120), nullable=True)
    )
    _add_column_if_missing(
        conn, op, "users", sa.Column("current_period_start", sa.DateTime(), nullable=True)
    )
    _add_column_if_missing(
        conn, op, "users", sa.Column("current_period_end", sa.DateTime(), nullable=True)
    )
    _add_column_if_missing(
        conn,
        op,
        "users",
        sa.Column(
            "cancel_at_period_end", sa.Integer(), nullable=True, server_default=sa.text("0")
        ),
    )
    _add_column_if_missing(
        conn,
        op,
        "users",
        sa.Column(
            "monthly_uploads_used", sa.Integer(), nullable=True, server_default=sa.text("0")
        ),
    )
    _add_column_if_missing(
        conn, op, "users", sa.Column("quota_reset_at", sa.DateTime(), nullable=True)
    )


def _downgrade_0006(conn: Connection, op: Operations) -> None:
    _drop_columns_safe(
        conn,
        op,
        "users",
        (
            "quota_reset_at",
            "monthly_uploads_used",
            "cancel_at_period_end",
            "current_period_end",
            "current_period_start",
            "stripe_subscription_id",
            "stripe_customer_id",
            "subscription_status",
            "billing_cycle",
            "plan_tier",
        ),
        extra_indexes=("ix_users_stripe_customer_id",),
    )


def _upgrade_0007(conn: Connection, op: Operations) -> None:
    if _table_exists(conn, "classes"):
        _add_column_if_missing(
            conn, op, "classes", sa.Column("join_code", sa.String(20), nullable=True)
        )
        conn.exec_driver_sql(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_classes_join_code ON classes(join_code) WHERE join_code IS NOT NULL"
        )
        rows = conn.execute(
            text("SELECT id FROM classes WHERE join_code IS NULL OR join_code = ''")
        ).fetchall()
        for (cid,) in rows:
            code = f"CITRA-{1000 + int(cid):04d}"
            conn.execute(
                text("UPDATE classes SET join_code = :code WHERE id = :cid"),
                {"code": code, "cid": int(cid)},
            )

    _add_column_if_missing(
        conn, op, "users", sa.Column("google_id", sa.String(255), nullable=True)
    )
    conn.exec_driver_sql(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id) WHERE google_id IS NOT NULL"
    )
    _add_column_if_missing(
        conn,
        op,
        "users",
        sa.Column(
            "auth_provider", sa.String(30), nullable=True, server_default=sa.text("'local'")
        ),
    )
    added_customized = _add_column_if_missing(
        conn,
        op,
        "users",
        sa.Column(
            "username_customized", sa.Integer(), nullable=True, server_default=sa.text("1")
        ),
    )
    if added_customized:
        conn.execute(
            text("UPDATE users SET username_customized = 0 WHERE auth_provider = 'google'")
        )
    added_onboarded = _add_column_if_missing(
        conn,
        op,
        "users",
        sa.Column("google_onboarded", sa.Integer(), nullable=True, server_default=sa.text("1")),
    )
    if added_onboarded:
        conn.execute(
            text(
                "UPDATE users SET google_onboarded = 0, username_customized = 0, auth_provider = 'google' WHERE google_id IS NOT NULL"
            )
        )


def _downgrade_0007(conn: Connection, op: Operations) -> None:
    if _table_exists(conn, "classes"):
        _drop_columns_safe(
            conn,
            op,
            "classes",
            ("join_code",),
            extra_indexes=("idx_classes_join_code", "ix_classes_join_code"),
        )
    _drop_columns_safe(
        conn,
        op,
        "users",
        ("google_onboarded", "username_customized", "auth_provider", "google_id"),
        extra_indexes=("idx_users_google_id", "ix_users_google_id"),
    )


def _upgrade_0008(conn: Connection, op: Operations) -> None:
    _add_column_if_missing(
        conn, op, "users", sa.Column("privacy_consented_at", sa.DateTime(), nullable=True)
    )
    _add_column_if_missing(
        conn, op, "users", sa.Column("privacy_policy_version", sa.String(20), nullable=True)
    )

    if _table_exists(conn, "billing_transactions"):
        _add_column_if_missing(
            conn,
            op,
            "billing_transactions",
            sa.Column("subtotal_usd", sa.Float(), nullable=True, server_default=sa.text("0")),
        )
        conn.execute(
            text(
                "UPDATE billing_transactions SET subtotal_usd = amount_usd WHERE subtotal_usd IS NULL OR subtotal_usd = 0"
            )
        )
        _add_column_if_missing(
            conn,
            op,
            "billing_transactions",
            sa.Column("discount_usd", sa.Float(), nullable=True, server_default=sa.text("0")),
        )
        _add_column_if_missing(
            conn,
            op,
            "billing_transactions",
            sa.Column("promo_code", sa.String(10), nullable=True),
        )
        _add_column_if_missing(
            conn,
            op,
            "billing_transactions",
            sa.Column(
                "payment_method", sa.String(30), nullable=True, server_default=sa.text("'card'")
            ),
        )
        _add_column_if_missing(
            conn,
            op,
            "billing_transactions",
            sa.Column(
                "billing_country", sa.String(10), nullable=True, server_default=sa.text("'VN'")
            ),
        )
        _add_column_if_missing(
            conn,
            op,
            "billing_transactions",
            sa.Column("billing_zip", sa.String(20), nullable=True),
        )
        _add_column_if_missing(
            conn,
            op,
            "billing_transactions",
            sa.Column("amount_vnd", sa.Integer(), nullable=True),
        )
        _add_column_if_missing(
            conn,
            op,
            "billing_transactions",
            sa.Column("vnp_txn_ref", sa.String(120), nullable=True),
        )
        conn.exec_driver_sql(
            "CREATE INDEX IF NOT EXISTS idx_billing_transactions_vnp_txn_ref ON billing_transactions(vnp_txn_ref)"
        )
        _add_column_if_missing(
            conn,
            op,
            "billing_transactions",
            sa.Column("vnp_transaction_no", sa.String(64), nullable=True),
        )
        _add_column_if_missing(
            conn,
            op,
            "billing_transactions",
            sa.Column("vnp_bank_code", sa.String(32), nullable=True),
        )
        _add_column_if_missing(
            conn,
            op,
            "billing_transactions",
            sa.Column("vnp_card_type", sa.String(32), nullable=True),
        )
        _add_column_if_missing(
            conn,
            op,
            "billing_transactions",
            sa.Column("vnp_response_code", sa.String(10), nullable=True),
        )


def _downgrade_0008(conn: Connection, op: Operations) -> None:
    if _table_exists(conn, "billing_transactions"):
        _drop_columns_safe(
            conn,
            op,
            "billing_transactions",
            (
                "vnp_response_code",
                "vnp_card_type",
                "vnp_bank_code",
                "vnp_transaction_no",
                "vnp_txn_ref",
                "amount_vnd",
                "billing_zip",
                "billing_country",
                "payment_method",
                "promo_code",
                "discount_usd",
                "subtotal_usd",
            ),
            extra_indexes=(
                "idx_billing_transactions_vnp_txn_ref",
                "ix_billing_transactions_vnp_txn_ref",
                "ix_billing_transactions_promo_code",
            ),
        )
    _drop_columns_safe(
        conn,
        op,
        "users",
        ("privacy_policy_version", "privacy_consented_at"),
    )


_COMPOSITE_INDEXES_0009: tuple[tuple[str, str], ...] = (
    (
        "idx_users_role_username",
        "CREATE INDEX IF NOT EXISTS idx_users_role_username ON users(role, username)",
    ),
    (
        "idx_essays_user_uploaded",
        "CREATE INDEX IF NOT EXISTS idx_essays_user_uploaded ON essays(user_id, uploaded_at)",
    ),
    (
        "idx_essays_class_uploaded",
        "CREATE INDEX IF NOT EXISTS idx_essays_class_uploaded ON essays(class_id, uploaded_at)",
    ),
    (
        "idx_essays_user_filename",
        "CREATE INDEX IF NOT EXISTS idx_essays_user_filename ON essays(user_id, filename)",
    ),
    (
        "idx_essays_uploaded_at",
        "CREATE INDEX IF NOT EXISTS idx_essays_uploaded_at ON essays(uploaded_at)",
    ),
    (
        "idx_citations_essay_type",
        "CREATE INDEX IF NOT EXISTS idx_citations_essay_type ON citations(essay_id, citation_type)",
    ),
    (
        "idx_verdicts_essay_override_label",
        "CREATE INDEX IF NOT EXISTS idx_verdicts_essay_override_label ON verdicts(essay_id, is_overridden, label)",
    ),
    (
        "idx_verdicts_label",
        "CREATE INDEX IF NOT EXISTS idx_verdicts_label ON verdicts(label)",
    ),
    (
        "idx_audit_logs_user_logged",
        "CREATE INDEX IF NOT EXISTS idx_audit_logs_user_logged ON audit_logs(user, logged_at)",
    ),
    (
        "idx_audit_logs_logged_at",
        "CREATE INDEX IF NOT EXISTS idx_audit_logs_logged_at ON audit_logs(logged_at)",
    ),
    (
        "idx_promo_redemptions_promo_user",
        "CREATE INDEX IF NOT EXISTS idx_promo_redemptions_promo_user ON promo_redemptions(promo_code_id, user_id)",
    ),
)


def _upgrade_0009(conn: Connection, _op: Operations) -> None:
    conn.execute(
        text("DELETE FROM citations WHERE essay_id NOT IN (SELECT id FROM essays)")
    )
    conn.execute(
        text("DELETE FROM verdicts WHERE essay_id NOT IN (SELECT id FROM essays)")
    )
    for _idx_name, idx_sql in _COMPOSITE_INDEXES_0009:
        conn.exec_driver_sql(idx_sql)


def _downgrade_0009(conn: Connection, _op: Operations) -> None:
    for idx_name, _idx_sql in reversed(_COMPOSITE_INDEXES_0009):
        _drop_index_if_exists(conn, idx_name)


MIGRATIONS: tuple[MigrationStep, ...] = (
    MigrationStep(
        version="0001",
        name="v1_8_citations_linking_columns",
        description="Add mapping_status, mapping_confidence, and citation_link_json columns to citations",
        upgrade=_upgrade_0001,
        downgrade=_downgrade_0001,
    ),
    MigrationStep(
        version="0002",
        name="v1_10_users_account_management",
        description="Add email, full_name, avatar_path, is_active, and last_login_at columns to users",
        upgrade=_upgrade_0002,
        downgrade=_downgrade_0002,
    ),
    MigrationStep(
        version="0003",
        name="v1_15_teacher_and_class_assignment",
        description="Add teacher fields to users and class_id assignment column to essays",
        upgrade=_upgrade_0003,
        downgrade=_downgrade_0003,
    ),
    MigrationStep(
        version="0004",
        name="v1_16_citation_and_verdict_context",
        description="Add surrounding PDF text context column to citations and verdicts",
        upgrade=_upgrade_0004,
        downgrade=_downgrade_0004,
    ),
    MigrationStep(
        version="0005",
        name="v1_17_users_email_verified",
        description="Add email_verified status column to users",
        upgrade=_upgrade_0005,
        downgrade=_downgrade_0005,
    ),
    MigrationStep(
        version="0006",
        name="v2_2_users_subscription_and_quota",
        description="Add subscription plan_tier, Stripe billing, and monthly quota columns to users",
        upgrade=_upgrade_0006,
        downgrade=_downgrade_0006,
    ),
    MigrationStep(
        version="0007",
        name="v2_3_google_oauth_and_class_join_code",
        description="Add Google OAuth2 columns to users and student join_code to classes",
        upgrade=_upgrade_0007,
        downgrade=_downgrade_0007,
    ),
    MigrationStep(
        version="0008",
        name="v2_4_privacy_consent_and_billing_vnpay",
        description="Add privacy consent columns to users and promo/VNPay columns to billing_transactions",
        upgrade=_upgrade_0008,
        downgrade=_downgrade_0008,
    ),
    MigrationStep(
        version="0009",
        name="v2_4_orphan_cleanup_and_composite_indexes",
        description="Clean up orphan citation and verdict rows and create composite B-Tree indexes",
        upgrade=_upgrade_0009,
        downgrade=_downgrade_0009,
    ),
)

_MIGRATION_MAP: dict[str, MigrationStep] = {step.version: step for step in MIGRATIONS}
LATEST_SCHEMA_VERSION: str = MIGRATIONS[-1].version


# ---------------------------------------------------------------------------
# Backup & Ledger Verification Helpers
# ---------------------------------------------------------------------------


def validate_backup_label(label: str) -> str:
    """Validate that a backup filename label is safe from path traversal and injection."""
    if (
        not isinstance(label, str)
        or not _BACKUP_LABEL_RE.fullmatch(label)
        or ".." in label
        or "/" in label
        or "\\" in label
    ):
        raise ValueError(f"Invalid backup label: {label!r}")
    return label


def _resolve_sqlite_db_path(engine: Engine) -> Path | None:
    if not str(engine.url).startswith("sqlite"):
        return None
    db_path_str = engine.url.database
    if not db_path_str or db_path_str == ":memory:" or ":memory:" in db_path_str:
        return None
    return Path(db_path_str)


def create_sqlite_backup(
    engine: Engine,
    label: str = "manual",
    backup_dir: Path | None = None,
) -> Path | None:
    """Create an online 0600-mode SQLite backup snapshot before destructive schema changes."""
    safe_label = validate_backup_label(label)
    db_path = _resolve_sqlite_db_path(engine)
    if db_path is None or not db_path.exists():
        return None

    target_dir = (
        Path(backup_dir) if backup_dir is not None else (db_path.parent / "backups")
    ).resolve()
    target_dir.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    backup_path = (target_dir / f"{db_path.stem}.{safe_label}.{timestamp}.sqlite3").resolve()
    if not backup_path.is_relative_to(target_dir) or backup_path.parent != target_dir:
        raise ValueError(f"Backup path escapes target directory: {backup_path}")

    fd = os.open(str(backup_path), os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    os.close(fd)
    os.chmod(backup_path, 0o600)

    with sqlite3.connect(str(db_path)) as src_conn, sqlite3.connect(str(backup_path)) as dst_conn:
        src_conn.backup(dst_conn)
    os.chmod(backup_path, 0o600)
    return backup_path


def restore_sqlite_backup(
    engine: Engine,
    backup_path: Path,
    allowed_dir: Path | None = None,
) -> None:
    """Atomically restore a verified SQLite backup snapshot into the active database."""
    db_path = _resolve_sqlite_db_path(engine)
    if db_path is None:
        raise MigrationError(
            "SQLite backup restore is only supported for file-backed SQLite databases"
        )

    raw_backup_path = Path(backup_path)
    allowed_base = (Path(allowed_dir) if allowed_dir is not None else db_path.parent).resolve()
    resolved_backup = raw_backup_path.resolve()
    if not resolved_backup.is_relative_to(allowed_base):
        raise ValueError("Backup path is outside allowed backup directory")
    if raw_backup_path.is_symlink():
        raise ValueError("Backup path must not be a symbolic link")
    if not resolved_backup.exists() or not resolved_backup.is_file():
        raise ValueError(f"Backup file does not exist: {resolved_backup}")

    with resolved_backup.open("rb") as fh:
        header = fh.read(len(_SQLITE_HEADER_MAGIC))
    if header != _SQLITE_HEADER_MAGIC:
        raise ValueError("Invalid SQLite backup file header")

    engine.dispose()
    with (
        sqlite3.connect(str(resolved_backup)) as src_conn,
        sqlite3.connect(str(db_path.resolve())) as dst_conn,
    ):
        src_conn.backup(dst_conn)
    _invalidate_engine_inspectors(engine)


def _ensure_core_tables_exist(conn: Connection) -> None:
    existing_tables = set(inspect(conn).get_table_names())
    for table_name in _CORE_BASE_TABLES:
        if table_name not in existing_tables:
            msg = f"no such table: {table_name}"
            raise OperationalError(msg, params=None, orig=Exception(msg))


def _read_ledger_rows(conn: Connection) -> list[tuple[str, str, str]]:
    if "schema_migrations" not in set(inspect(conn).get_table_names()):
        return []
    rows = conn.execute(
        text("SELECT version, name, checksum FROM schema_migrations ORDER BY version ASC")
    ).fetchall()
    return [(str(r[0]), str(r[1]), str(r[2])) for r in rows]


def _verify_ledger_rows(rows: Sequence[tuple[str, str, str]]) -> bool:
    for version, name, checksum in rows:
        step = _MIGRATION_MAP.get(version)
        if step is None:
            raise MigrationIntegrityError(
                f"Unknown migration revision {version!r} ({name!r}) recorded in schema_migrations"
            )
        if checksum != step.checksum:
            raise MigrationIntegrityError(
                f"Checksum mismatch for migration {version} ({name}): "
                f"expected {step.checksum}, found {checksum}"
            )
    return True


def _invalidate_engine_inspectors(engine: Engine) -> None:
    """Clear reflection caches on any live SQLAlchemy Inspector bound to engine."""
    for obj in gc.get_objects():
        if issubclass(type(obj), Inspector) and getattr(obj, "bind", None) is engine:
            obj.clear_cache()


# ---------------------------------------------------------------------------
# Public Migration API
# ---------------------------------------------------------------------------


def verify_migrations(engine: Engine) -> bool:
    """Verify that all applied migrations in schema_migrations match registry SHA-256 checksums."""
    with engine.connect() as conn:
        rows = _read_ledger_rows(conn)
        return _verify_ledger_rows(rows)


def get_migration_status(engine: Engine) -> MigrationStatus:
    """Return a structured snapshot of applied and pending schema migrations."""
    with engine.connect() as conn:
        rows = _read_ledger_rows(conn)
        try:
            checksum_verified = _verify_ledger_rows(rows)
        except MigrationIntegrityError:
            checksum_verified = False

        applied_versions = tuple(r[0] for r in rows)
        applied_set = set(applied_versions)
        pending_versions = tuple(
            step.version for step in MIGRATIONS if step.version not in applied_set
        )
        current_version = applied_versions[-1] if applied_versions else None
        is_up_to_date = (
            checksum_verified
            and len(pending_versions) == 0
            and current_version == LATEST_SCHEMA_VERSION
        )
        return MigrationStatus(
            current_version=current_version,
            latest_version=LATEST_SCHEMA_VERSION,
            applied_versions=applied_versions,
            pending_versions=pending_versions,
            is_up_to_date=is_up_to_date,
            checksum_verified=checksum_verified,
        )


def run_migrations(engine: Engine, target_version: str | None = None) -> list[str]:
    """Apply all pending migrations up to target_version (defaults to LATEST_SCHEMA_VERSION)."""
    if target_version is not None:
        validate_revision_id(target_version)
        if target_version not in _MIGRATION_MAP:
            raise MigrationError(f"Unknown target migration version: {target_version!r}")

    applied_now: list[str] = []
    with engine.begin() as conn:
        _ensure_core_tables_exist(conn)
        SchemaMigrationRecord.__table__.create(bind=conn, checkfirst=True)

        rows = _read_ledger_rows(conn)
        _verify_ledger_rows(rows)
        applied_set = {r[0] for r in rows}

        mc = MigrationContext.configure(conn)
        op = Operations(mc)

        for step in MIGRATIONS:
            if target_version is not None and step.version > target_version:
                break
            if step.version in applied_set:
                continue

            t0 = time.perf_counter()
            step.upgrade(conn, op)
            elapsed_ms = round((time.perf_counter() - t0) * 1000.0, 3)

            conn.execute(
                sa.insert(SchemaMigrationRecord.__table__).values(
                    version=step.version,
                    name=step.name,
                    checksum=step.checksum,
                    execution_ms=elapsed_ms,
                    # Store naive UTC datetime to match SQLite DATETIME column representation
                    applied_at=datetime.now(UTC).replace(tzinfo=None),
                )
            )
            applied_now.append(step.version)

    if applied_now:
        _invalidate_engine_inspectors(engine)
    return applied_now


def downgrade_migrations(
    engine: Engine,
    target_version: str,
    *,
    create_backup: bool = True,
    backup_dir: Path | None = None,
) -> list[str]:
    """Roll back applied migrations down to target_version in reverse order."""
    validate_revision_id(target_version)
    if target_version != "0000" and target_version not in _MIGRATION_MAP:
        raise MigrationError(f"Unknown target migration version: {target_version!r}")

    with engine.connect() as conn:
        _ensure_core_tables_exist(conn)
        rows = _read_ledger_rows(conn)
        _verify_ledger_rows(rows)
        applied_set = {r[0] for r in rows}

    steps_to_revert = [
        step
        for step in reversed(MIGRATIONS)
        if step.version in applied_set and step.version > target_version
    ]
    if not steps_to_revert:
        return []

    if create_backup:
        create_sqlite_backup(
            engine,
            label=f"pre_downgrade_{target_version}",
            backup_dir=backup_dir,
        )

    reverted: list[str] = []
    with engine.begin() as conn:
        _ensure_core_tables_exist(conn)
        rows = _read_ledger_rows(conn)
        _verify_ledger_rows(rows)
        tx_applied_set = {r[0] for r in rows}
        tx_steps_to_revert = [
            step
            for step in reversed(MIGRATIONS)
            if step.version in tx_applied_set and step.version > target_version
        ]

        mc = MigrationContext.configure(conn)
        op = Operations(mc)

        for step in tx_steps_to_revert:
            step.downgrade(conn, op)
            conn.execute(
                text("DELETE FROM schema_migrations WHERE version = :version"),
                {"version": step.version},
            )
            reverted.append(step.version)

    if reverted:
        _invalidate_engine_inspectors(engine)
    return reverted


# ---------------------------------------------------------------------------
# Hardened CLI Entrypoint
# ---------------------------------------------------------------------------


def _build_cli_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="python -m integrity_checker.db.migrations",
        description="CITRA database schema migration & verification CLI",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    subparsers.add_parser("status", help="Show current database schema migration status")

    upgrade_parser = subparsers.add_parser(
        "upgrade", help="Apply pending schema migrations up to target revision"
    )
    upgrade_parser.add_argument(
        "--to",
        dest="to_version",
        default=None,
        help="Target 4-digit revision ID (defaults to latest)",
    )

    downgrade_parser = subparsers.add_parser(
        "downgrade", help="Roll back applied schema migrations down to target revision"
    )
    downgrade_parser.add_argument(
        "--to",
        dest="to_version",
        required=True,
        help="Target 4-digit revision ID (or 0000 for base schema)",
    )
    downgrade_parser.add_argument(
        "--no-backup",
        action="store_true",
        help="Skip creating an automatic 0600 SQLite backup before rollback",
    )

    subparsers.add_parser("verify", help="Verify applied migration SHA-256 checksums")
    subparsers.add_parser("history", help="List all registered schema migration steps")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    """Execute the CITRA database migration CLI and return a POSIX exit code."""
    parser = _build_cli_parser()
    args = parser.parse_args(list(argv) if argv is not None else None)

    from integrity_checker.db.session import get_engine

    engine = get_engine()

    if args.command == "status":
        status = get_migration_status(engine)
        pending_str = ",".join(status.pending_versions) if status.pending_versions else "none"
        print(
            f"current_version={status.current_version} "
            f"latest_version={status.latest_version} "
            f"up_to_date={status.is_up_to_date} "
            f"checksum_verified={status.checksum_verified} "
            f"pending={pending_str}"
        )
        return 0

    if args.command == "upgrade":
        applied = run_migrations(engine, target_version=args.to_version)
        print(f"applied={','.join(applied) if applied else 'none'}")
        return 0

    if args.command == "downgrade":
        reverted = downgrade_migrations(
            engine,
            args.to_version,
            create_backup=not args.no_backup,
        )
        print(f"reverted={','.join(reverted) if reverted else 'none'}")
        return 0

    if args.command == "verify":
        try:
            verified = verify_migrations(engine)
        except MigrationIntegrityError:
            verified = False
        print(f"checksum_verified={verified}")
        return 0 if verified else 1

    if args.command == "history":
        status = get_migration_status(engine)
        applied_set = set(status.applied_versions)
        for step in MIGRATIONS:
            state = "applied" if step.version in applied_set else "pending"
            print(
                f"{step.version} [{state}] {step.name} ({step.checksum[:12]}) - {step.description}"
            )
        return 0

    return 1


if __name__ == "__main__":
    raise SystemExit(main())
