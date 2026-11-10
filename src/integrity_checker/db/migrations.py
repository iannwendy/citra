"""Database schema migration primitives, security validators, and checksum engine."""

from __future__ import annotations

import hashlib
import re
from collections.abc import Callable
from dataclasses import dataclass

from alembic.operations import Operations
from sqlalchemy.engine import Connection

_SQL_IDENTIFIER_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
_REVISION_ID_RE = re.compile(r"^[0-9]{4}$")


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
