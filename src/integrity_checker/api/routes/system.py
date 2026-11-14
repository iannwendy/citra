"""System health endpoint (admin only) — Phase 4."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlalchemy.orm import Session

from integrity_checker.api.deps import get_db, require_admin
from integrity_checker.api.routes.health import _get_grobid_health
from integrity_checker.config import get_settings
from integrity_checker.database.local_db import get_local_papers_tuning_report
from integrity_checker.db.models import EssayRecord, User, VerdictRecord
from integrity_checker.db.repository import Repository
from integrity_checker.db.session import get_app_db_tuning_report
from integrity_checker.retrieval.circuit_breaker import get_circuit_breaker_registry
from integrity_checker.retrieval.retrieval_orchestrator import ensure_enabled_sources_registered

router = APIRouter()


@router.get("/health")
def get_system_health(
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> dict:
    repo = Repository(db)
    role_counts: dict[str, int] = {}
    for role, cnt in (
        db.query(User.role, func.count(User.id)).group_by(User.role).all()
    ):
        if role:
            role_counts[str(role)] = int(cnt or 0)
    total_users = sum(role_counts.values())
    total_essays = int(db.query(func.count(EssayRecord.id)).scalar() or 0)

    label_counts: dict[str, int] = {}
    for label, cnt in (
        db.query(VerdictRecord.label, func.count(VerdictRecord.id))
        .group_by(VerdictRecord.label)
        .all()
    ):
        if label:
            label_counts[str(label)] = int(cnt or 0)
    total_verdicts = sum(label_counts.values())

    cache_stats = repo.get_cache_stats()
    grobid_health = _get_grobid_health()

    services: dict[str, str] = {
        "database": "ok",
        "cache": "ok",
        "parser": "ok",
    }
    # Only flag grobid as degraded when a GROBID container IS running on the host
    # yet its HTTP endpoint is unresponsive; normal built-in regex fallback is healthy.
    if not grobid_health.available and grobid_health.container_running:
        services["grobid"] = "degraded"

    registry = ensure_enabled_sources_registered(
        get_circuit_breaker_registry(),
        get_settings(),
    )

    return {
        "status": "degraded" if "grobid" in services else "ok",
        "services": services,
        "parser_mode": grobid_health.parser_mode,
        "grobid_available": grobid_health.available,
        "totals": {
            "users": total_users,
            "admins": role_counts.get("admin", 0),
            "teachers": role_counts.get("teacher", 0),
            "students": role_counts.get("user", 0),
            "essays": total_essays,
            "verdicts": total_verdicts,
        },
        "verdict_label_counts": label_counts,
        "cache_stats": cache_stats,
        "upstream_sources": registry.snapshot_all(),
        "sqlite_wal": {
            "app_db": get_app_db_tuning_report(),
            "local_papers_db": get_local_papers_tuning_report(),
        },
    }
