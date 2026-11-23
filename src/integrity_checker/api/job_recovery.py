"""Orphaned background job recovery and idempotent atomic quota refund (B2)."""

from __future__ import annotations

import asyncio
import json
import threading
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import TYPE_CHECKING, Any

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
MAX_RECOVERY_DRAIN_CONCURRENCY = 2
_REFUND_LOCK = threading.Lock()
QUOTA_LEDGER_LOCK = _REFUND_LOCK
_BACKGROUND_RECOVERY_TASKS: set[asyncio.Task[None]] = set()


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


def _as_utc_naive(dt: datetime | str | None) -> datetime | None:
    """Normalize an aware, naive, or ISO-string UTC timestamp to naive UTC for SQLite comparison."""
    if dt is None:
        return None
    if isinstance(dt, str):
        raw_s = dt.strip()
        if not raw_s:
            return None
        try:
            dt = datetime.fromisoformat(raw_s.replace("Z", "+00:00"))
        except ValueError:
            return None
    if dt.tzinfo is not None:
        return dt.astimezone(UTC).replace(tzinfo=None)
    return dt


def refresh_job_heartbeat(
    essay_id: int,
    *,
    session: Session | None = None,
    session_factory: Callable[[], Session] | None = None,
) -> bool:
    """Atomically advance ``job_heartbeat_at`` for an active ``processing`` essay job.

    Returns True when a matching ``job_status = 'processing'`` row was updated.
    """
    now_utc_str = datetime.now(UTC).replace(tzinfo=None).strftime("%Y-%m-%d %H:%M:%S.%f")
    owns_session = session is None
    sess = (
        session
        if session is not None
        else (session_factory() if session_factory is not None else db_session.get_session())
    )
    try:
        res = sess.execute(
            text(
                "UPDATE essays "
                "SET job_heartbeat_at = :now "
                "WHERE id = :essay_id AND job_status = 'processing'"
            ),
            {"now": now_utc_str, "essay_id": int(essay_id)},
        )
        if owns_session:
            sess.commit()
        else:
            sess.flush()
        return int(getattr(res, "rowcount", 0) or 0) == 1
    except Exception as exc:
        if owns_session:
            sess.rollback()
        logger.debug(f"Could not refresh job_heartbeat_at for essay {essay_id}: {exc}")
        return False
    finally:
        if owns_session:
            sess.close()


def refund_upload_quota_once(session: Session, essay_id: int, reason: str) -> bool:
    """Atomically mark an incomplete essay job as failed and refund its charged slot once.

    Uses a compare-and-swap (CAS) ``WHERE id = :essay_id AND quota_charged = 1 AND cis_json IS NULL``
    update so duplicate/concurrent calls never double-decrement ``users.monthly_uploads_used``
    and failed re-analysis runs on already-completed essays (``cis_json IS NOT NULL``) never
    refund quota or overwrite ``job_status = 'completed'``.
    """
    safe_reason = (reason or "Analysis failed due to an internal processing error.").strip()

    with _REFUND_LOCK:
        if session.new or session.dirty or session.deleted:
            session.flush()
        elif session.in_transaction():
            # Release any stale read snapshot before acquiring write lock on SQLite WAL
            session.commit()

        try:
            cas_res = session.execute(
                text(
                    "UPDATE essays "
                    "SET quota_charged = 0, job_status = 'failed', job_error = :reason "
                    "WHERE id = :essay_id AND quota_charged = 1 AND cis_json IS NULL"
                ),
                {"essay_id": int(essay_id), "reason": safe_reason},
            )
            if int(getattr(cas_res, "rowcount", 0) or 0) == 1:
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
                    "SET job_status = CASE "
                    "WHEN cis_json IS NOT NULL THEN 'completed' ELSE 'failed' END, "
                    "job_error = :reason "
                    "WHERE id = :essay_id AND (cis_json IS NULL OR job_status != 'queued')"
                ),
                {"essay_id": int(essay_id), "reason": safe_reason},
            )
            session.commit()
            session.expire_all()
            return False
        except Exception:
            session.rollback()
            raise


def recover_orphaned_essay_jobs(
    pipeline_factory: Callable[[], IntegrityPipeline],
    *,
    session_factory: Callable[[], Session] | None = None,
    uploads_dir: Path | None = None,
    max_attempts: int = MAX_ORPHAN_RECOVERY_ATTEMPTS,
    run_rescheduled: bool = True,
    include_queued: bool = True,
    stale_heartbeat_seconds: float | None = None,
    started_before_utc: datetime | None = None,
) -> dict[str, int]:
    """Scan orphaned incomplete ``EssayRecord`` jobs on startup and reschedule or refund.

    - When ``job_attempt_count < max_attempts`` and the persisted upload file exists on disk:
      increments ``job_attempt_count``, sets ``job_status = 'queued'`` without charging extra
      upload quota, and re-runs the pipeline (when ``run_rescheduled=True``).
    - When ``job_attempt_count >= max_attempts`` or the persisted upload file is missing:
      marks ``job_status = 'failed'`` and refunds ``monthly_uploads_used`` strictly once.
    - When ``include_queued=False`` (standalone worker startup), freshly queued uploads are
      left untouched for ``claim_next_queued_essay`` pickup without burning recovery attempts,
      and ``stale_heartbeat_seconds`` skips active peer workers with fresh heartbeats.
    - When ``started_before_utc`` is provided (inline server boot), skips jobs uploaded after
      server startup as well as jobs currently active in this process's ``ProgressTracker``.
    """
    from integrity_checker.api.routes import essays as essays_routes

    sess_factory = session_factory if session_factory is not None else db_session.get_session
    rescheduled_count = 0
    failed_count = 0
    refunded_count = 0
    to_run: list[tuple[int, str, int]] = []
    target_statuses = ("queued", "processing") if include_queued else ("processing",)
    cutoff_utc: datetime | None = None
    if stale_heartbeat_seconds is not None:
        cutoff_utc = datetime.now(UTC).replace(tzinfo=None) - timedelta(
            seconds=max(0.0, float(stale_heartbeat_seconds))
        )
    boot_cutoff_utc = (
        _as_utc_naive(started_before_utc) if started_before_utc is not None else None
    )
    boot_cutoff_epoch = (
        boot_cutoff_utc.replace(tzinfo=UTC).timestamp() if boot_cutoff_utc is not None else None
    )
    active_tracker = get_tracker() if boot_cutoff_utc is not None else None

    session = sess_factory()
    try:
        orphans = (
            session.query(EssayRecord)
            .filter(
                EssayRecord.cis_json.is_(None),
                EssayRecord.job_status.in_(target_statuses),
            )
            .order_by(EssayRecord.id.asc())
            .all()
        )
        orphan_snapshots: list[tuple[int, str | None, int, int, str]] = []
        for e in orphans:
            if boot_cutoff_utc is not None:
                if active_tracker is not None and boot_cutoff_epoch is not None:
                    active_st = active_tracker.get(int(e.id))
                    if (
                        active_st is not None
                        and active_st.status in ("queued", "processing")
                        and active_st.finished_at is None
                        and active_st.started_at >= boot_cutoff_epoch - 1.0
                    ):
                        continue
                up_naive = _as_utc_naive(e.uploaded_at)
                if up_naive is not None and up_naive >= boot_cutoff_utc:
                    continue
                hb_boot_naive = _as_utc_naive(e.job_heartbeat_at)
                if hb_boot_naive is not None and hb_boot_naive >= boot_cutoff_utc:
                    continue
            if e.job_status == "processing" and cutoff_utc is not None:
                hb_naive = _as_utc_naive(e.job_heartbeat_at)
                if hb_naive is not None and hb_naive > cutoff_utc:
                    continue
            orphan_snapshots.append(
                (
                    int(e.id),
                    e.filename,
                    int(e.user_id or 0),
                    int(e.job_attempt_count or 0),
                    str(e.job_status),
                )
            )

        for eid, filename, uid, attempt_count, prev_status in orphan_snapshots:
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

            now_utc_str = datetime.now(UTC).replace(tzinfo=None).strftime("%Y-%m-%d %H:%M:%S.%f")
            resched_res = session.execute(
                text(
                    "UPDATE essays "
                    "SET job_attempt_count = :next_attempt, "
                    "job_status = 'queued', "
                    "job_heartbeat_at = :now, "
                    "job_error = NULL "
                    "WHERE id = :eid AND cis_json IS NULL AND job_status = :expected_status"
                ),
                {
                    "next_attempt": attempt_count + 1,
                    "now": now_utc_str,
                    "eid": eid,
                    "expected_status": prev_status,
                },
            )
            session.commit()
            session.expire_all()
            if int(getattr(resched_res, "rowcount", 0) or 0) != 1:
                continue

            get_tracker().init(eid, is_retry=True)
            to_run.append((eid, str(upload_path), uid))
            rescheduled_count += 1

        # Also recover orphaned re-analysis jobs on already-completed essays (cis_json IS NOT NULL)
        # so they never remain stuck in 'queued' / 'processing' after SIGKILL / OOM.
        reanalysis_orphans = (
            session.query(EssayRecord)
            .filter(
                EssayRecord.cis_json.is_not(None),
                EssayRecord.job_status.in_(target_statuses),
            )
            .order_by(EssayRecord.id.asc())
            .all()
        )
        restored_reanalysis_ids: list[int] = []
        for re_essay in reanalysis_orphans:
            if boot_cutoff_utc is not None:
                if active_tracker is not None and boot_cutoff_epoch is not None:
                    re_active_st = active_tracker.get(int(re_essay.id))
                    if (
                        re_active_st is not None
                        and re_active_st.status in ("queued", "processing")
                        and re_active_st.finished_at is None
                        and re_active_st.started_at >= boot_cutoff_epoch - 1.0
                    ):
                        continue
                re_hb = _as_utc_naive(re_essay.job_heartbeat_at)
                if re_hb is not None and re_hb >= boot_cutoff_utc:
                    continue
            if cutoff_utc is not None:
                hb_naive = _as_utc_naive(re_essay.job_heartbeat_at)
                if hb_naive is not None and hb_naive > cutoff_utc:
                    continue
            re_essay.job_status = "completed"
            re_essay.job_error = (
                "Orphaned re-analysis interrupted; previous completed report preserved."
            )
            if re_essay.style_profile_json:
                try:
                    parsed_sp = json.loads(re_essay.style_profile_json)
                    if isinstance(parsed_sp, dict) and isinstance(
                        parsed_sp.get("_progress_snapshot"), dict
                    ):
                        if parsed_sp["_progress_snapshot"].get("status") != "completed":
                            parsed_sp.pop("_progress_snapshot", None)
                            re_essay.style_profile_json = (
                                json.dumps(parsed_sp) if parsed_sp else None
                            )
                except Exception:
                    pass
            restored_reanalysis_ids.append(int(re_essay.id))

        if restored_reanalysis_ids:
            session.commit()
            session.expire_all()
            tracker = get_tracker()
            for re_id in restored_reanalysis_ids:
                st = tracker.get(re_id)
                if st is not None and st.status != "completed":
                    tracker.clear(re_id)
    finally:
        session.close()

    if to_run and run_rescheduled:

        async def _run_single_recovered(
            eid: int,
            path_str: str,
            uid: int,
            pipeline: Any,
            sem: asyncio.Semaphore,
        ) -> None:
            async with sem:
                await essays_routes._run_pipeline_task(
                    eid, path_str, uid, pipeline, cleanup_file=False
                )

        async def _drain(*, close_http_pool: bool = False) -> None:
            sem = asyncio.Semaphore(MAX_RECOVERY_DRAIN_CONCURRENCY)
            try:
                pipeline = await asyncio.to_thread(pipeline_factory)
                results = await asyncio.gather(
                    *(
                        _run_single_recovered(eid, path_str, uid, pipeline, sem)
                        for eid, path_str, uid in to_run
                    ),
                    return_exceptions=True,
                )
                for res_item in results:
                    if isinstance(res_item, BaseException):
                        logger.error(f"Recovered essay job drain task failed: {res_item}")
            finally:
                if close_http_pool:
                    from integrity_checker.retrieval.http_pool import close_loop_http_clients

                    await close_loop_http_clients()

        try:
            running_loop: asyncio.AbstractEventLoop | None = asyncio.get_running_loop()
        except RuntimeError:
            running_loop = None

        if running_loop is not None:
            bg_task = running_loop.create_task(_drain(close_http_pool=False))
            _BACKGROUND_RECOVERY_TASKS.add(bg_task)
            bg_task.add_done_callback(_BACKGROUND_RECOVERY_TASKS.discard)
        else:
            asyncio.run(_drain(close_http_pool=True))

    return {
        "rescheduled": rescheduled_count,
        "failed": failed_count,
        "refunded": refunded_count,
    }
