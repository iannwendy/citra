"""Audit log endpoint (admin only) — Phase 4."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from integrity_checker.api.deps import get_db, require_admin
from integrity_checker.db.models import EssayRecord, User, VerdictRecord
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

    essay_ids = {eid for eid in essay_id_by_verdict.values() if eid is not None}
    essay_info_by_id: dict[int, tuple[str | None, int | None]] = {}
    if essay_ids:
        for eid, filename, owner_uid in (
            db.query(EssayRecord.id, EssayRecord.filename, EssayRecord.user_id)
            .filter(EssayRecord.id.in_(essay_ids))
            .all()
        ):
            essay_info_by_id[int(eid)] = (filename, owner_uid)

    student_ids = {uid for _, uid in essay_info_by_id.values() if uid is not None}
    student_info_by_id: dict[int, tuple[str | None, str | None]] = {}
    if student_ids:
        for uid, uname, full_name in (
            db.query(User.id, User.username, User.full_name)
            .filter(User.id.in_(student_ids))
            .all()
        ):
            student_info_by_id[int(uid)] = (uname, full_name)

    out: list[dict] = []
    for r in rows:
        eid = essay_id_by_verdict.get(r.verdict_id)
        essay_filename, owner_uid = (
            essay_info_by_id.get(eid, (None, None)) if eid is not None else (None, None)
        )
        student_username, student_full_name = (
            student_info_by_id.get(owner_uid, (None, None))
            if owner_uid is not None
            else (None, None)
        )
        cleaned_full_name = (student_full_name or "").strip() or None
        student_name = cleaned_full_name or student_username
        out.append(
            {
                "id": r.id,
                "verdict_id": r.verdict_id,
                "essay_id": eid,
                "essay_filename": essay_filename,
                "student_name": student_name,
                "student_username": student_username,
                "original_label": r.original_label,
                "new_label": r.new_label,
                "user": r.user,
                "note": r.note,
                "logged_at": r.logged_at.isoformat() if r.logged_at else None,
            }
        )
    return out


@router.get("/stats")
def get_audit_stats(
    user: str | None = Query(None),
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> dict[str, int]:
    """Return accurate SQL total_events and unique_actors counts across all audit_logs."""
    del admin
    return Repository(db).get_audit_stats(user_filter=user)
