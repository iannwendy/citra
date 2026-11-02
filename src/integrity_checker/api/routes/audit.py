"""Audit log endpoint (admin only) — Phase 4."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from integrity_checker.api.deps import get_db, require_admin
from integrity_checker.db.models import User, VerdictRecord
from integrity_checker.db.repository import Repository

router = APIRouter()


@router.get("/log")
def list_audit(
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    user: str | None = Query(None),
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> list[dict]:
    repo = Repository(db)
    rows = repo.list_audit_log(limit=limit, offset=offset, user_filter=user)
    verdict_ids = {r.verdict_id for r in rows if r.verdict_id is not None}
    essay_id_by_verdict: dict[int, int | None] = {}
    if verdict_ids:
        for vid, eid in (
            db.query(VerdictRecord.id, VerdictRecord.essay_id)
            .filter(VerdictRecord.id.in_(verdict_ids))
            .all()
        ):
            essay_id_by_verdict[int(vid)] = eid
    return [
        {
            "id": r.id,
            "verdict_id": r.verdict_id,
            "essay_id": essay_id_by_verdict.get(r.verdict_id),
            "original_label": r.original_label,
            "new_label": r.new_label,
            "user": r.user,
            "note": r.note,
            "logged_at": r.logged_at.isoformat() if r.logged_at else None,
        }
        for r in rows
    ]
