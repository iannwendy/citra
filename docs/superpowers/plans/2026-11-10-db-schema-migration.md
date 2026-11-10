# Database Schema Migration Standardization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the inline `ALTER TABLE` startup block in `src/integrity_checker/db/session.py` with a formal, tamper-evident `schema_migrations` ledger and Alembic `Operations` (`batch_alter_table`) migration runner supporting safe production upgrades, rollbacks, online SQLite backups, and CLI management.

**Architecture:** Introduce `SchemaMigrationRecord` in `src/integrity_checker/db/models.py` and a dedicated migration engine in `src/integrity_checker/db/migrations.py` backed by `alembic.migration.MigrationContext` and `alembic.operations.Operations`. All 9 historical schema evolutions (`0001`–`0009`) are encapsulated as deterministic `MigrationStep` objects with SHA-256 checksums, forward `upgrade(conn, op)` handlers, and reverse `downgrade(conn, op)` handlers, while `_run_inline_migrations(engine)` in `session.py` delegates to `run_migrations(engine)` for 100% backward compatibility.

**Tech Stack:** Python 3.11+, SQLAlchemy 2.0 (`Engine`, `Connection`, `inspect`, `text`), Alembic 1.13+ (`MigrationContext`, `Operations`, `batch_alter_table`), SQLite3 online backup API (`sqlite3.Connection.backup`), `pytest`, `ruff`.

**Spec:** `docs/superpowers/specs/2026-11-10-db-schema-migration-design.md`

## Global Constraints

- Python `>=3.11`, SQLAlchemy `>=2.0,<3.0`, Alembic `>=1.13,<2.0` (no new external dependencies added to `pyproject.toml` or `requirements.txt`).
- All SQL queries against data or metadata tables in `src/integrity_checker/db/migrations.py` MUST use parameterized `sqlalchemy.text` bindings or validated SQL identifiers (`validate_sql_identifier` matching `^[A-Za-z_][A-Za-z0-9_]*$`).
- Backup files created by `create_sqlite_backup` MUST enforce `0o600` permissions and validate path containment via `Path.resolve()` to prevent path traversal (`CWE-22`) and unauthorized file access (`CWE-732`).
- `_run_inline_migrations(engine: Engine) -> None` MUST remain importable from `integrity_checker.db.session` so existing tests in `tests/unit/test_teacher_role.py` and `tests/unit/test_performance_optimizations.py` pass without modification.
- Running `ruff check src/ tests/` and `pytest tests/unit/ -q` MUST pass with zero warnings/errors.

## Review Focus

1. **Uninitialized database (`create_all` skipped before `run_migrations`):** Calling `run_migrations(engine)` or `_run_inline_migrations(engine)` when core tables (`citations`, `users`, `essays`, `verdicts`) do not exist must raise `sqlalchemy.exc.OperationalError` with `"no such table"` (tested in `test_run_migrations_on_uninitialized_db_raises_no_such_table`).
2. **Legacy pre-v1.8 database upgrade with data backfills & orphan cleanup:** Upgrading a legacy SQLite database containing only baseline v1.0 columns plus un-backfilled rows (`classes.join_code IS NULL`, `users.role = 'admin'`, orphan `citations`) must apply `0001`–`0009` in order, backfill values accurately, delete orphans, and record all 9 versions (tested in `test_legacy_database_upgrades_to_latest_and_backfills_data`).
3. **Tampered `schema_migrations` checksum drift:** Modifying a recorded checksum in `schema_migrations` must cause `verify_migrations(engine)` and `run_migrations(engine)` to raise `MigrationIntegrityError` (tested in `test_tampered_checksum_raises_migration_integrity_error`).
4. **Path traversal & insecure permissions on SQLite backup/restore:** Supplying `../` or invalid characters in backup labels or restoring from an unvalidated path must raise `ValueError`, and valid backups must have mode `0o600` (tested in `test_backup_security_rejects_traversal_and_enforces_0600_mode`).
5. **SQLite `downgrade` on columns with partial/unique indexes or foreign keys:** Rolling back revisions `0009` → `0006` (which include `idx_classes_join_code`, `idx_users_google_id`, and `idx_billing_transactions_vnp_txn_ref`) must drop dependent indexes before `batch_alter_table` drops the columns so SQLite never raises an index error, and re-upgrading to `0009` must restore the full schema (tested in `test_downgrade_and_reupgrade_roundtrip_on_sqlite`).

---

### Task 1: `SchemaMigrationRecord` ORM Model, Migration Types, Security Guards & Checksum Engine

**Files:**
- Modify: `src/integrity_checker/db/models.py:420-439`
- Create: `src/integrity_checker/db/migrations.py`
- Test: `tests/unit/test_db_migrations.py`

**Interfaces:**
- Consumes: `Base` from `integrity_checker.db.models`
- Produces:
  - `SchemaMigrationRecord` in `integrity_checker.db.models` (`__tablename__ = "schema_migrations"`)
  - `MigrationError(RuntimeError)`, `MigrationIntegrityError(MigrationError)` in `integrity_checker.db.migrations`
  - `MigrationStep` dataclass (`version: str`, `name: str`, `description: str`, `upgrade: Callable[[Connection, Operations], None]`, `downgrade: Callable[[Connection, Operations], None]`, `checksum: str` property)
  - `MigrationStatus` dataclass (`current_version: str | None`, `latest_version: str`, `applied_versions: tuple[str, ...]`, `pending_versions: tuple[str, ...]`, `is_up_to_date: bool`, `checksum_verified: bool`)
  - `validate_sql_identifier(identifier: str) -> str` and `validate_revision_id(version: str) -> str`

- [ ] **Step 1: Write the failing test in `tests/unit/test_db_migrations.py`**

```python
from __future__ import annotations

import pytest

from integrity_checker.db.migrations import (
    MigrationIntegrityError,
    MigrationStep,
    validate_revision_id,
    validate_sql_identifier,
)
from integrity_checker.db.models import Base, SchemaMigrationRecord


def test_schema_migration_record_in_metadata() -> None:
    assert "schema_migrations" in Base.metadata.tables
    cols = set(Base.metadata.tables["schema_migrations"].columns.keys())
    assert {"version", "name", "checksum", "execution_ms", "applied_at"}.issubset(cols)
    rec = SchemaMigrationRecord(
        version="0001",
        name="v1_8_citations_linking_columns",
        checksum="a" * 64,
        execution_ms=1.5,
    )
    assert rec.version == "0001"


def test_sql_identifier_and_revision_validation_security() -> None:
    assert validate_sql_identifier("users") == "users"
    assert validate_sql_identifier("idx_users_email") == "idx_users_email"
    for malicious in ("users; DROP TABLE users;--", "users' OR '1'='1", "../etc/passwd", "123bad", ""):
        with pytest.raises(ValueError, match="Invalid SQL identifier"):
            validate_sql_identifier(malicious)

    assert validate_revision_id("0001") == "0001"
    for bad_rev in ("1", "0001; DROP", "../0001", "abcd", ""):
        with pytest.raises(ValueError, match="Invalid migration version"):
            validate_revision_id(bad_rev)


def test_migration_step_deterministic_sha256_checksum() -> None:
    step = MigrationStep(
        version="0001",
        name="v1_8_citations_linking_columns",
        description="Add linking columns to citations",
        upgrade=lambda conn, op: None,
        downgrade=lambda conn, op: None,
    )
    assert len(step.checksum) == 64
    int(step.checksum, 16)  # valid hex SHA-256
    assert issubclass(MigrationIntegrityError, RuntimeError)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/unit/test_db_migrations.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'integrity_checker.db.migrations'`

- [ ] **Step 3: Add `SchemaMigrationRecord` to `src/integrity_checker/db/models.py` and create `src/integrity_checker/db/migrations.py` with core types, validators, and checksum computation**

In `src/integrity_checker/db/models.py`, define `SchemaMigrationRecord(Base)` with `__tablename__ = "schema_migrations"`, `version: Mapped[str] = mapped_column(String(32), primary_key=True)`, `name: Mapped[str] = mapped_column(String(120), nullable=False)`, `checksum: Mapped[str] = mapped_column(String(64), nullable=False)`, `execution_ms: Mapped[float] = mapped_column(Float, default=0.0)`, and `applied_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(UTC))`.

In `src/integrity_checker/db/migrations.py`, implement `MigrationError`, `MigrationIntegrityError`, `validate_sql_identifier`, `validate_revision_id`, `MigrationStep` (computing SHA-256 from `f"{self.version}:{self.name}:{self.description}"`), and `MigrationStatus`.

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/python -m pytest tests/unit/test_db_migrations.py -v`
Expected: PASS (3 passed)

- [ ] **Step 5: Commit**

```bash
git add src/integrity_checker/db/models.py src/integrity_checker/db/migrations.py tests/unit/test_db_migrations.py
git commit -m "feat(db): add SchemaMigrationRecord model and migration security primitives"
```

---

### Task 2: Versioned Migration Registry (`0001`–`0009`) with Alembic `Operations` Upgrade & Downgrade

**Files:**
- Modify: `src/integrity_checker/db/migrations.py`
- Test: `tests/unit/test_db_migrations.py`

**Interfaces:**
- Consumes: `MigrationStep`, `MigrationStatus`, `MigrationIntegrityError`, `validate_sql_identifier`, `validate_revision_id` from Task 1
- Produces:
  - `MIGRATIONS: tuple[MigrationStep, ...]` (`0001` through `0009`)
  - `LATEST_SCHEMA_VERSION: str` (`"0009"`)
  - `run_migrations(engine: Engine, target_version: str | None = None) -> list[str]`
  - `downgrade_migrations(engine: Engine, target_version: str, *, create_backup: bool = True, backup_dir: Path | None = None) -> list[str]`
  - `get_migration_status(engine: Engine) -> MigrationStatus`
  - `verify_migrations(engine: Engine) -> bool`

- [ ] **Step 1: Write the failing tests in `tests/unit/test_db_migrations.py` covering `0001`–`0009` upgrade, uninitialized DB guard, legacy DB backfill, checksum tamper detection, and SQLite downgrade/re-upgrade**

```python
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.exc import OperationalError

from integrity_checker.db.migrations import (
    LATEST_SCHEMA_VERSION,
    MIGRATIONS,
    MigrationIntegrityError,
    downgrade_migrations,
    get_migration_status,
    run_migrations,
    verify_migrations,
)
from integrity_checker.db.models import Base


def test_run_migrations_on_uninitialized_db_raises_no_such_table(tmp_path) -> None:
    engine = create_engine(f"sqlite:///{tmp_path / 'empty.db'}")
    with pytest.raises(OperationalError, match="no such table"):
        run_migrations(engine)


def test_fresh_db_create_all_then_run_migrations_is_idempotent(tmp_path) -> None:
    engine = create_engine(f"sqlite:///{tmp_path / 'fresh.db'}")
    Base.metadata.create_all(bind=engine)
    applied_first = run_migrations(engine)
    assert applied_first == [m.version for m in MIGRATIONS]
    assert LATEST_SCHEMA_VERSION == "0009"

    status = get_migration_status(engine)
    assert status.is_up_to_date is True
    assert status.current_version == "0009"
    assert status.pending_versions == ()
    assert status.checksum_verified is True
    assert verify_migrations(engine) is True

    # Second run is a fast no-op
    applied_second = run_migrations(engine)
    assert applied_second == []


def test_legacy_database_upgrades_to_latest_and_backfills_data(tmp_path) -> None:
    engine = create_engine(f"sqlite:///{tmp_path / 'legacy.db'}")
    with engine.begin() as conn:
        conn.exec_driver_sql(
            "CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username VARCHAR(50) NOT NULL, password_hash VARCHAR(255) NOT NULL, role VARCHAR(20) DEFAULT 'user', created_at DATETIME, updated_at DATETIME)"
        )
        conn.exec_driver_sql(
            "CREATE TABLE classes (id INTEGER PRIMARY KEY AUTOINCREMENT, name VARCHAR(120) NOT NULL, description TEXT, teacher_id INTEGER NOT NULL, created_at DATETIME, updated_at DATETIME)"
        )
        conn.exec_driver_sql(
            "CREATE TABLE essays (id INTEGER PRIMARY KEY AUTOINCREMENT, filename VARCHAR NOT NULL, num_pages INTEGER DEFAULT 0, uploaded_at DATETIME, user_id INTEGER, style_profile_json TEXT, cis_json TEXT)"
        )
        conn.exec_driver_sql(
            "CREATE TABLE citations (id INTEGER PRIMARY KEY AUTOINCREMENT, essay_id INTEGER NOT NULL, raw_text TEXT NOT NULL, citation_type VARCHAR, style VARCHAR, authors TEXT, year VARCHAR, title TEXT, venue VARCHAR, doi VARCHAR, url TEXT, page_num INTEGER, confidence FLOAT)"
        )
        conn.exec_driver_sql(
            "CREATE TABLE verdicts (id INTEGER PRIMARY KEY AUTOINCREMENT, essay_id INTEGER NOT NULL, citation_raw TEXT NOT NULL, label VARCHAR NOT NULL, confidence FLOAT, reasoning TEXT, triggered_rules TEXT, mismatched_fields TEXT, features TEXT, validated_at DATETIME, mapping_status VARCHAR, mapping_confidence FLOAT, style_penalty FLOAT, domain_exception INTEGER, is_overridden INTEGER, override_note TEXT, overridden_by VARCHAR)"
        )
        conn.exec_driver_sql(
            "CREATE TABLE audit_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, verdict_id INTEGER NOT NULL, original_label VARCHAR NOT NULL, new_label VARCHAR NOT NULL, user VARCHAR NOT NULL, note TEXT, logged_at DATETIME)"
        )
        conn.exec_driver_sql(
            "CREATE TABLE billing_transactions (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, stripe_session_id VARCHAR(120) NOT NULL, stripe_payment_intent_id VARCHAR(120), plan_tier VARCHAR(20) NOT NULL, billing_cycle VARCHAR(20) NOT NULL, amount_usd FLOAT NOT NULL, currency VARCHAR(10), status VARCHAR(30), payment_mode VARCHAR(20), card_brand VARCHAR(20), card_last4 VARCHAR(4), created_at DATETIME, paid_at DATETIME)"
        )
        conn.exec_driver_sql(
            "CREATE TABLE promo_redemptions (id INTEGER PRIMARY KEY AUTOINCREMENT, promo_code_id INTEGER NOT NULL, user_id INTEGER NOT NULL, transaction_id INTEGER NOT NULL, code VARCHAR(6) NOT NULL, discount_usd FLOAT NOT NULL, redeemed_at DATETIME)"
        )
        # Seed legacy data needing backfill + orphan citation
        conn.exec_driver_sql(
            "INSERT INTO users (id, username, password_hash, role) VALUES (1, 'admin', 'hash', 'admin'), (2, 't1', 'hash', 'teacher')"
        )
        conn.exec_driver_sql(
            "INSERT INTO classes (id, name, teacher_id) VALUES (1, 'SE Capstone', 2)"
        )
        conn.exec_driver_sql(
            "INSERT INTO billing_transactions (id, user_id, stripe_session_id, plan_tier, billing_cycle, amount_usd) VALUES (1, 1, 'sess_1', 'pro', 'monthly', 19.99)"
        )
        conn.exec_driver_sql(
            "INSERT INTO citations (id, essay_id, raw_text) VALUES (1, 999, 'Orphan citation')"
        )

    applied = run_migrations(engine)
    assert len(applied) == 9

    with engine.connect() as conn:
        admin_tier = conn.execute(text("SELECT plan_tier FROM users WHERE id = 1")).scalar_one()
        teacher_tier = conn.execute(text("SELECT plan_tier FROM users WHERE id = 2")).scalar_one()
        join_code = conn.execute(text("SELECT join_code FROM classes WHERE id = 1")).scalar_one()
        subtotal = conn.execute(text("SELECT subtotal_usd FROM billing_transactions WHERE id = 1")).scalar_one()
        orphan_count = conn.execute(text("SELECT COUNT(*) FROM citations WHERE essay_id = 999")).scalar_one()

    assert admin_tier == "ultra"
    assert teacher_tier == "pro"
    assert join_code == "CITRA-1001"
    assert subtotal == pytest.approx(19.99)
    assert orphan_count == 0


def test_tampered_checksum_raises_migration_integrity_error(tmp_path) -> None:
    engine = create_engine(f"sqlite:///{tmp_path / 'tamper.db'}")
    Base.metadata.create_all(bind=engine)
    run_migrations(engine)

    with engine.begin() as conn:
        conn.execute(
            text("UPDATE schema_migrations SET checksum = '0000badchecksum' WHERE version = '0003'")
        )

    with pytest.raises(MigrationIntegrityError, match="0003"):
        verify_migrations(engine)

    with pytest.raises(MigrationIntegrityError, match="0003"):
        run_migrations(engine)


def test_downgrade_and_reupgrade_roundtrip_on_sqlite(tmp_path) -> None:
    engine = create_engine(f"sqlite:///{tmp_path / 'rollback.db'}")
    Base.metadata.create_all(bind=engine)
    run_migrations(engine)

    reverted = downgrade_migrations(engine, "0006", create_backup=True, backup_dir=tmp_path)
    assert reverted == ["0009", "0008", "0007"]

    status = get_migration_status(engine)
    assert status.current_version == "0006"
    assert status.pending_versions == ("0007", "0008", "0009")

    inspector = inspect(engine)
    user_cols = {c["name"] for c in inspector.get_columns("users")}
    assert "privacy_consented_at" not in user_cols
    assert "google_id" not in user_cols
    assert "plan_tier" in user_cols

    # Re-apply pending migrations back to 0009
    reapplied = run_migrations(engine)
    assert reapplied == ["0007", "0008", "0009"]
    user_cols_after = {c["name"] for c in inspector.get_columns("users")}
    assert {"privacy_consented_at", "google_id", "plan_tier"}.issubset(user_cols_after)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/unit/test_db_migrations.py -v`
Expected: FAIL with `ImportError: cannot import name 'LATEST_SCHEMA_VERSION'`

- [ ] **Step 3: Implement `MIGRATIONS` (`0001`–`0009`), `run_migrations`, `downgrade_migrations`, `get_migration_status`, and `verify_migrations` in `src/integrity_checker/db/migrations.py`**

Use `alembic.migration.MigrationContext.configure(conn)` and `alembic.operations.Operations(mc)` for every migration step:
- Before running migrations, check that core base tables (`citations`, `users`, `essays`, `verdicts`) exist via `inspect(conn)`; if any is missing, raise `OperationalError("no such table: citations", params=None, orig=Exception("no such table: citations"))` so uninitialized databases fail fast even if `schema_migrations` exists.
- Ensure `schema_migrations` table exists (`SchemaMigrationRecord.__table__.create(bind=conn, checkfirst=True)`).
- Verify all applied rows in `schema_migrations` against `MIGRATIONS` SHA-256 checksums before applying or rolling back; raise `MigrationIntegrityError` on any mismatch or unknown revision.
- In `downgrade(conn, op)`, drop any indexes referencing columns before opening `with op.batch_alter_table(table_name) as batch_op: batch_op.drop_column(...)` so SQLite table recreation succeeds cleanly.

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/python -m pytest tests/unit/test_db_migrations.py -v`
Expected: PASS (8 passed)

- [ ] **Step 5: Commit**

```bash
git add src/integrity_checker/db/migrations.py tests/unit/test_db_migrations.py
git commit -m "feat(db): implement versioned 0001-0009 Alembic migrations with upgrade and downgrade"
```

---

### Task 3: Atomic Online SQLite Backup/Restore & Hardened CLI Entrypoint

**Files:**
- Modify: `src/integrity_checker/db/migrations.py`
- Test: `tests/unit/test_db_migrations.py`

**Interfaces:**
- Consumes: `run_migrations`, `downgrade_migrations`, `get_migration_status`, `verify_migrations` from Task 2
- Produces:
  - `create_sqlite_backup(engine: Engine, label: str = "manual", backup_dir: Path | None = None) -> Path | None`
  - `restore_sqlite_backup(engine: Engine, backup_path: Path, allowed_dir: Path | None = None) -> None`
  - `main(argv: list[str] | None = None) -> int` (CLI supporting `status`, `upgrade`, `downgrade`, `verify`, `history`)

- [ ] **Step 1: Write the failing tests in `tests/unit/test_db_migrations.py` for backup security (`0o600`, path traversal protection), online backup/restore recovery, and CLI subcommands**

```python
import stat
from sqlalchemy import create_engine, text

from integrity_checker.db.migrations import (
    create_sqlite_backup,
    main as migrations_cli_main,
    restore_sqlite_backup,
    run_migrations,
)
from integrity_checker.db.models import Base


def test_backup_security_rejects_traversal_and_enforces_0600_mode(tmp_path) -> None:
    db_file = tmp_path / "app.db"
    engine = create_engine(f"sqlite:///{db_file}")
    Base.metadata.create_all(bind=engine)
    run_migrations(engine)

    for bad_label in ("../evil", "a/b", "a\\b", "bad;label", ""):
        with pytest.raises(ValueError, match="Invalid backup label"):
            create_sqlite_backup(engine, label=bad_label, backup_dir=tmp_path)

    bak_path = create_sqlite_backup(engine, label="pre_rollback_0006", backup_dir=tmp_path)
    assert bak_path is not None and bak_path.exists()
    mode = stat.S_IMODE(bak_path.stat().st_mode)
    assert mode == 0o600

    # Mutate DB, then restore from backup and verify state recovered
    with engine.begin() as conn:
        conn.execute(text("DELETE FROM schema_migrations WHERE version = '0009'"))
    restore_sqlite_backup(engine, bak_path, allowed_dir=tmp_path)
    with engine.connect() as conn:
        v9 = conn.execute(
            text("SELECT version FROM schema_migrations WHERE version = '0009'")
        ).scalar_one_or_none()
    assert v9 == "0009"

    # Reject restore from outside allowed_dir
    outside_file = tmp_path.parent / "outside.bak"
    outside_file.write_bytes(b"not a valid backup")
    try:
        with pytest.raises(ValueError, match="outside allowed backup directory"):
            restore_sqlite_backup(engine, outside_file, allowed_dir=tmp_path)
    finally:
        outside_file.unlink(missing_ok=True)


def test_migrations_cli_status_verify_history_upgrade_downgrade(tmp_path, monkeypatch, capsys) -> None:
    db_file = tmp_path / "cli.db"
    engine = create_engine(f"sqlite:///{db_file}")
    Base.metadata.create_all(bind=engine)
    monkeypatch.setattr("integrity_checker.db.session.get_engine", lambda: engine)

    assert migrations_cli_main(["upgrade"]) == 0
    assert migrations_cli_main(["status"]) == 0
    out = capsys.readouterr().out
    assert "0009" in out and "up_to_date=True" in out

    assert migrations_cli_main(["verify"]) == 0
    assert migrations_cli_main(["history"]) == 0
    assert migrations_cli_main(["downgrade", "--to", "0008", "--no-backup"]) == 0
    assert migrations_cli_main(["upgrade", "--to", "0009"]) == 0
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/unit/test_db_migrations.py -v`
Expected: FAIL with `ImportError: cannot import name 'create_sqlite_backup'`

- [ ] **Step 3: Implement `create_sqlite_backup`, `restore_sqlite_backup`, and `main(argv)` in `src/integrity_checker/db/migrations.py`**

- Validate `label` against `^[A-Za-z0-9_.-]{1,64}$` (rejecting `..`, `/`, `\`).
- For in-memory SQLite (`:memory:`) or non-SQLite engines, `create_sqlite_backup` returns `None`.
- For file-backed SQLite engines, open the file via `sqlite3.connect`, create the destination file with `os.open(..., os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)` and `os.chmod(dest, 0o600)`, and copy pages atomically via `src_conn.backup(dst_conn)`.
- In `restore_sqlite_backup`, verify `backup_path.resolve().is_relative_to(allowed_dir.resolve())`, verify SQLite header magic bytes (`b"SQLite format 3\x00"`), and copy back via `src_conn.backup(dst_conn)`.
- Implement `main(argv)` with `argparse` subcommands: `status`, `upgrade [--to VERSION]`, `downgrade --to VERSION [--no-backup]`, `verify`, `history`.

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/python -m pytest tests/unit/test_db_migrations.py -v`
Expected: PASS (10 passed)

- [ ] **Step 5: Commit**

```bash
git add src/integrity_checker/db/migrations.py tests/unit/test_db_migrations.py
git commit -m "feat(db): add atomic 0600 SQLite backup/restore and migration CLI"
```

---

### Task 4: Wire `session.py` & `__init__.py` Facade and Verify Full Regression & Security Suite

**Files:**
- Modify: `src/integrity_checker/db/session.py:84-361`
- Modify: `src/integrity_checker/db/__init__.py`
- Test: `tests/unit/test_db_migrations.py`, `tests/unit/test_teacher_role.py`, `tests/unit/test_performance_optimizations.py`, `tests/unit/test_lint_clean.py`

**Interfaces:**
- Consumes: `run_migrations`, `downgrade_migrations`, `get_migration_status`, `verify_migrations`, `SchemaMigrationRecord` from Tasks 1–3
- Produces:
  - `_run_inline_migrations(engine: Engine) -> None` in `src/integrity_checker/db/session.py` delegating to `run_migrations(engine)`
  - Re-exports in `src/integrity_checker/db/__init__.py`: `SchemaMigrationRecord`, `run_migrations`, `downgrade_migrations`, `get_migration_status`, `verify_migrations`

- [ ] **Step 1: Write the failing test in `tests/unit/test_db_migrations.py` verifying `session._run_inline_migrations` and `db.__init__` re-exports**

```python
import integrity_checker.db as db_pkg
from integrity_checker.db.session import _run_inline_migrations, init_db


def test_session_inline_migrations_delegates_to_versioned_runner(tmp_path) -> None:
    from sqlalchemy import create_engine

    from integrity_checker.db.migrations import get_migration_status
    from integrity_checker.db.models import Base

    engine = create_engine(f"sqlite:///{tmp_path / 'session_delegate.db'}")
    Base.metadata.create_all(bind=engine)
    _run_inline_migrations(engine)

    status = get_migration_status(engine)
    assert status.is_up_to_date is True
    assert status.current_version == "0009"

    for symbol in (
        "SchemaMigrationRecord",
        "run_migrations",
        "downgrade_migrations",
        "get_migration_status",
        "verify_migrations",
    ):
        assert symbol in db_pkg.__all__
        assert hasattr(db_pkg, symbol)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/unit/test_db_migrations.py::test_session_inline_migrations_delegates_to_versioned_runner -v`
Expected: FAIL with `AssertionError: assert 'SchemaMigrationRecord' in db_pkg.__all__`

- [ ] **Step 3: Refactor `_run_inline_migrations` in `src/integrity_checker/db/session.py` to call `run_migrations(engine)` and export migration APIs in `src/integrity_checker/db/__init__.py`**

In `src/integrity_checker/db/session.py`:
- Import `run_migrations` from `integrity_checker.db.migrations` and `SchemaMigrationRecord` in `integrity_checker.db.models` import list.
- Replace the 275-line inline `ALTER TABLE` body of `_run_inline_migrations(engine: Engine) -> None` with a clean delegation to `run_migrations(engine)` while keeping the docstring reference to `integrity_checker.db.migrations`.

In `src/integrity_checker/db/__init__.py`:
- Export `SchemaMigrationRecord`, `run_migrations`, `downgrade_migrations`, `get_migration_status`, and `verify_migrations` in `__all__`.

- [ ] **Step 4: Run targeted and full test & lint suites to verify 100% pass rate**

Run:
```bash
.venv/bin/python -m pytest tests/unit/test_db_migrations.py tests/unit/test_teacher_role.py tests/unit/test_performance_optimizations.py tests/unit/test_lint_clean.py -v
.venv/bin/python -m ruff check src/ tests/
.venv/bin/python -m pytest tests/unit/ -q
```
Expected: All unit tests (`1,690+` tests) and `ruff check` PASS with 0 errors and 0 warnings.

- [ ] **Step 5: Commit**

```bash
git add src/integrity_checker/db/session.py src/integrity_checker/db/__init__.py tests/unit/test_db_migrations.py
git commit -m "refactor(db): replace inline ALTER TABLE startup block with versioned schema_migrations runner"
```
