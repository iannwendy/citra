from __future__ import annotations

import stat

import pytest
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.exc import OperationalError

from integrity_checker.db.migrations import (
    LATEST_SCHEMA_VERSION,
    MIGRATIONS,
    MigrationIntegrityError,
    MigrationStep,
    create_sqlite_backup,
    downgrade_migrations,
    get_migration_status,
    restore_sqlite_backup,
    run_migrations,
    validate_revision_id,
    validate_sql_identifier,
    verify_migrations,
)
from integrity_checker.db.migrations import (
    main as migrations_cli_main,
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


def test_backup_security_rejects_traversal_and_enforces_0600_mode(tmp_path) -> None:
    db_file = tmp_path / "app.db"
    engine = create_engine(f"sqlite:///{db_file}")
    Base.metadata.create_all(bind=engine)
    run_migrations(engine)

    for bad_label in ("../evil", "a..b", "a/b", "a\\b", "bad;label", ""):
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

    # Reject restore of non-SQLite file inside allowed_dir
    corrupt_file = tmp_path / "corrupt.bak"
    corrupt_file.write_bytes(b"not a valid sqlite header")
    with pytest.raises(ValueError, match="Invalid SQLite backup file header"):
        restore_sqlite_backup(engine, corrupt_file, allowed_dir=tmp_path)

    # Reject restore from outside allowed_dir
    outside_file = tmp_path.parent / "outside.bak"
    outside_file.write_bytes(b"not a valid backup")
    try:
        with pytest.raises(ValueError, match="outside allowed backup directory"):
            restore_sqlite_backup(engine, outside_file, allowed_dir=tmp_path)
    finally:
        outside_file.unlink(missing_ok=True)


def test_migrations_cli_status_verify_history_upgrade_downgrade(
    tmp_path, monkeypatch, capsys
) -> None:
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
