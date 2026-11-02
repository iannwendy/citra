"""Database module — SQLAlchemy persistence."""

from integrity_checker.db.models import (
    AuditLog,
    Base,
    CitationRecord,
    EssayRecord,
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
    "get_engine",
    "get_session",
    "init_db",
    "Repository",
]
