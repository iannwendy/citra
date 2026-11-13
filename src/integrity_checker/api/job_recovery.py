"""Orphaned background job recovery and idempotent atomic quota refund (B2)."""

from __future__ import annotations

import asyncio
import threading
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING

from sqlalchemy import text
from sqlalchemy.orm import Session

from integrity_checker.api.progress import get_tracker
from integrity_checker.db import session as db_session
from integrity_checker.db.models import EssayRecord
from integrity_checker.logging import get_logger

if TYPE_CHECKING:
    from integrity_checker.pipeline.integrity_pipeline import IntegrityPipeline

logger = get_logger(__name__)

MAX_ORPHAN_RECOVERY_ATTEMPTS = 2
_REFUND_LOCK = threading.Lock()


def resolve_persisted_upload_path(
    essay_id: int,
    filename: str | None = None,
    uploads_dir: Path | None = None,
) -> Path | None:
    """Locate the persisted uploaded document file for ``essay_id`` on disk, if present."""
    from integrity_checker.api.routes import essays as essays_routes

    base_dir = uploads_dir if uploads_dir is not None else essays_routes.UPLOADS_DIR
    lower_name = (filename or "").strip().lower()
    if lower_name.endswith(".docx"):
        preferred_ext = ".docx"
    elif lower_name.endswith(".bib"):
        preferred_ext = ".bib"
    elif lower_name.endswith(".ris"):
        preferred_ext = ".ris"
    else:
        preferred_ext = ".pdf"

    candidates = [preferred_ext] + [
        ext for ext in essays_routes.ALLOWED_UPLOAD_EXTENSIONS if ext != preferred_ext
    ]
    for ext in candidates:
        cand = base_dir / f"{essay_id}{ext}"
        if cand.is_file():
            return cand
    return None


def refund_upload_quota_once(session: Session, essay_id: int, reason: str) -> bool:
    """Atomically mark an essay job as failed and refund its charged upload slot at most once.

    Uses a compare-and-swap (CAS) ``WHERE id = :essay_id AND quota_charged = 1`` update
    so duplicate or concurrent calls across threads/workers never double-decrement
    ``users.monthly_uploads_used`` or drive it below 0.
    """
    safe_reason = (reason or "Analysis failed due to an internal processing error.").strip()

    with _REFUND_LOCK:
        if session.new or session.dirty or session.deleted:
            session.flush()
        elif session.in_transaction():
            # Release any stale read snapshot before acquiring write lock on SQLite WAL
            session.commit()

        cas_res = session.execute(
            text(
                "UPDATE essays "
                "SET quota_charged = 0, job_status = 'failed', job_error = :reason "
                "WHERE id = :essay_id AND quota_charged = 1"
            ),
            {"essay_id": int(essay_id), "reason": safe_reason},
        )
        if (cas_res.rowcount or 0) == 1:
            uid_row = session.execute(
                text("SELECT user_id FROM essays WHERE id = :essay_id"),
                {"essay_id": int(essay_id)},
            ).first()
            user_id = uid_row[0] if uid_row is not None else None
            if user_id is not None:
                session.execute(
                    text(
                        "UPDATE users "
                        "SET monthly_uploads_used = CASE "
                        "WHEN COALESCE(monthly_uploads_used, 0) > 0 "
                        "THEN monthly_uploads_used - 1 ELSE 0 END "
                        "WHERE id = :user_id"
                    ),
                    {"user_id": int(user_id)},
                )
            session.commit()
            session.expire_all()
            return True

        session.execute(
            text(
                "UPDATE essays "
                "SET job_status = 'failed', job_error = :reason "
                "WHERE id = :essay_id AND (cis_json IS NULL OR job_status != 'completed')"
            ),
            {"essay_id": int(essay_id), "reason": safe_reason},
        )
        session.commit()
        session.expire_all()
        return False


def recover_orphaned_essay_jobs(
    pipeline_factory: Callable[[], IntegrityPipeline],
    *,
    session_factory: Callable[[], Session] | None = None,
    uploads_dir: Path | None = None,
    max_attempts: int = MAX_ORPHAN_RECOVERY_ATTEMPTS,
    run_rescheduled: bool = True,
) -> dict[str, int]:
    """Scan orphaned incomplete ``EssayRecord`` jobs on startup and reschedule or refund.

    - When ``job_attempt_count < max_attempts`` and the persisted upload file exists on disk:
      increments ``job_attempt_count``, sets ``job_status = 'queued'`` without charging extra
      upload quota, and re-runs the pipeline (when ``run_rescheduled=True``).
    - When ``job_attempt_count >= max_attempts`` or the persisted upload file is missing:
      marks ``job_status = 'failed'`` and refunds ``monthly_uploads_used`` strictly once.
    """
    from integrity_checker.api.routes import essays as essays_routes

    sess_factory = session_factory if session_factory is not None else db_session.get_session
    rescheduled_count = 0
    failed_count = 0
    refunded_count = 0
    to_run: list[tuple[int, str, int]] = []

    session = sess_factory()
    try:
        orphans = (
            session.query(EssayRecord)
            .filter(
                EssayRecord.cis_json.is_(None),
                EssayRecord.job_status.in_(("queued", "processing")),
            )
            .order_by(EssayRecord.id.asc())
            .all()
        )
        orphan_snapshots = [
            (
                int(e.id),
                e.filename,
                int(e.user_id or 0),
                int(e.job_attempt_count or 0),
            )
            for e in orphans
        ]

        for eid, filename, uid, attempt_count in orphan_snapshots:
            upload_path = resolve_persisted_upload_path(
                eid, filename=filename, uploads_dir=uploads_dir
            )
            if attempt_count >= max_attempts or upload_path is None:
                if upload_path is None:
                    reason = (
                        "Orphaned analysis job failed: uploaded document file missing on disk."
                    )
                else:
                    reason = (
                        "Orphaned analysis job failed after exceeding maximum recovery "
                        f"attempts ({attempt_count}/{max_attempts})."
                    )
                if refund_upload_quota_once(session, eid, reason):
                    refunded_count += 1
                failed_count += 1
                continue

            essay_row = session.get(EssayRecord, eid)
            if essay_row is None:
                continue
            essay_row.job_attempt_count = attempt_count + 1
            essay_row.job_status = "queued"
            essay_row.job_heartbeat_at = datetime.now(UTC)
            essay_row.job_error = None
            session.commit()

            get_tracker().init(eid, is_retry=True)
            to_run.append((eid, str(upload_path), uid))
            rescheduled_count += 1
    finally:
        session.close()

    if to_run and run_rescheduled:
        pipeline = pipeline_factory()

        async def _drain() -> None:
            await asyncio.gather(
                *(
                    essays_routes._run_pipeline_task(
                        eid, path_str, uid, pipeline, cleanup_file=False
                    )
                    for eid, path_str, uid in to_run
                )
            )

        try:
            asyncio.get_running_loop()
            has_running_loop = True
        except RuntimeError:
            has_running_loop = False

        if has_running_loop:
            with ThreadPoolExecutor(max_workers=1) as pool:
                pool.submit(lambda: asyncio.run(_drain())).result()
        else:
            asyncio.run(_drain())

    return {
        "rescheduled": rescheduled_count,
        "failed": failed_count,
        "refunded": refunded_count,
    }
