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
