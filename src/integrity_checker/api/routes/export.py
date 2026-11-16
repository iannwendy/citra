"""Export routes (admin only)."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from sqlalchemy import func
from sqlalchemy.orm import Session

from integrity_checker.api.deps import get_db, require_admin
from integrity_checker.db.models import EssayRecord, User, VerdictRecord

router = APIRouter()


@router.get("/report")
def get_system_report(
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Get full system report (admin only) using SQL GROUP BY aggregations."""
    del admin

    # 1. Users summary via SQL GROUP BY role + lightweight column projection
    role_counts: dict[str, int] = {}
    for role_val, cnt in (
        db.query(User.role, func.count(User.id))
        .group_by(User.role)
        .all()
    ):
        role_counts[str(role_val or "user")] = int(cnt or 0)

    user_rows = (
        db.query(User.id, User.username, User.role, User.created_at)
        .order_by(User.id.asc())
        .all()
    )
    user_summaries = [
        {
            "id": u_id,
            "username": u_name,
            "role": u_role,
            "created_at": u_created.isoformat() if u_created else None,
        }
        for u_id, u_name, u_role, u_created in user_rows
    ]

    # 2. Essays summary via SQL COUNT + lightweight column projection (skips JSON blobs)
    total_essays = int(db.query(func.count(EssayRecord.id)).scalar() or 0)
    essay_rows = (
        db.query(
            EssayRecord.id,
            EssayRecord.filename,
            EssayRecord.user_id,
            EssayRecord.num_pages,
            EssayRecord.uploaded_at,
        )
        .order_by(EssayRecord.uploaded_at.desc())
        .all()
    )
    essay_summaries = [
        {
            "id": e_id,
            "filename": e_fname,
            "user_id": e_uid,
            "num_pages": e_pages,
            "uploaded_at": e_up.isoformat() if e_up else None,
        }
        for e_id, e_fname, e_uid, e_pages, e_up in essay_rows
    ]

    # 3. Verdicts summary via SQL GROUP BY label (never loads VerdictRecord JSON blobs)
    verdict_counts: dict[str, int] = {}
    for label_val, cnt in (
        db.query(VerdictRecord.label, func.count(VerdictRecord.id))
        .group_by(VerdictRecord.label)
        .all()
    ):
        key = str(label_val or "unresolved")
        verdict_counts[key] = int(cnt or 0)
    total_verdicts = sum(verdict_counts.values())

    return JSONResponse({
        "users": {
            "total": sum(role_counts.values()),
            "admins": role_counts.get("admin", 0),
            "teachers": role_counts.get("teacher", 0),
            "users": role_counts.get("user", 0),
            "list": user_summaries,
        },
        "essays": {
            "total": total_essays,
            "list": essay_summaries,
        },
        "verdicts": {
            "total": total_verdicts,
            "by_label": verdict_counts,
        },
    })
