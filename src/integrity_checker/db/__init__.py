"""Database module — SQLAlchemy persistence."""

from integrity_checker.db.migrations import (
    downgrade_migrations,
    get_migration_status,
    run_migrations,
    verify_migrations,
)
from integrity_checker.db.models import (
    AuditLog,
    Base,
    CitationRecord,
    EssayRecord,
    SchemaMigrationRecord,
    VerdictRecord,
)
from integrity_checker.db.repository import Repository
from integrity_checker.db.session import get_engine, get_session, init_db

__all__ = [
    "Base",
    "EssayRecord",
    "CitationRecord",
    "VerdictRecord",
    "AuditLog",
    "SchemaMigrationRecord",
    "get_engine",
    "get_session",
    "init_db",
    "run_migrations",
    "downgrade_migrations",
    "get_migration_status",
    "verify_migrations",
    "Repository",
]
