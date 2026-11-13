"""Standalone background pipeline worker for CITRA_WORKER_MODE=worker_only."""

from __future__ import annotations

import argparse
import asyncio
import os
import signal
import threading
from collections.abc import Callable, Sequence
from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING

from sqlalchemy import text
from sqlalchemy.orm import Session

from integrity_checker.api.deps import get_pipeline
from integrity_checker.api.job_recovery import (
    recover_orphaned_essay_jobs,
    refund_upload_quota_once,
    resolve_persisted_upload_path,
)
from integrity_checker.api.progress import get_tracker
from integrity_checker.db import session as db_session
from integrity_checker.db.models import EssayRecord
from integrity_checker.logging import configure_logging, get_logger

if TYPE_CHECKING:
    from integrity_checker.pipeline.integrity_pipeline import IntegrityPipeline

logger = get_logger(__name__)

_WORKER_CLAIM_LOCK = threading.Lock()


def claim_next_queued_essay(session: Session) -> EssayRecord | None:
    """Atomically claim the oldest ``job_status='queued'`` essay via CAS update."""
    with _WORKER_CLAIM_LOCK:
        if session.new or session.dirty or session.deleted:
            session.flush()
        elif session.in_transaction():
            session.commit()

        now_utc_str = datetime.now(UTC).replace(tzinfo=None).strftime("%Y-%m-%d %H:%M:%S.%f")
        claimed_row = session.execute(
            text(
                "UPDATE essays "
                "SET job_status = 'processing', job_heartbeat_at = :now, job_error = NULL "
                "WHERE id = ("
                "SELECT id FROM essays WHERE job_status = 'queued' ORDER BY id ASC LIMIT 1"
                ") AND job_status = 'queued' "
                "RETURNING id"
            ),
            {"now": now_utc_str},
        ).first()
        session.commit()
        if claimed_row is None:
            return None

        claimed_id = int(claimed_row[0])
        session.expire_all()
        return session.get(EssayRecord, claimed_id)


async def run_worker_loop(
    *,
    pipeline_factory: Callable[[], IntegrityPipeline] | None = None,
    session_factory: Callable[[], Session] | None = None,
    uploads_dir: Path | None = None,
    poll_interval: float = 1.0,
    stop_event: asyncio.Event | None = None,
    max_iterations: int | None = None,
    recover_on_startup: bool = True,
) -> dict[str, int]:
    """Continuously claim and execute queued essay analysis jobs until stopped."""
    from integrity_checker.api.routes import essays as essays_routes

    pipe_factory = pipeline_factory if pipeline_factory is not None else get_pipeline
    sess_factory = session_factory if session_factory is not None else db_session.get_session
    pipeline_instance: IntegrityPipeline | None = None

    if recover_on_startup:
        recovery_stats = recover_orphaned_essay_jobs(
            pipe_factory,
            session_factory=sess_factory,
            uploads_dir=uploads_dir,
            run_rescheduled=False,
        )
        if any(recovery_stats.values()):
            logger.info(f"Worker startup orphan recovery: {recovery_stats}")

    processed = 0
    failed = 0
    idle_polls = 0
    iterations = 0

    while True:
        if stop_event is not None and stop_event.is_set():
            break
        if max_iterations is not None and iterations >= max_iterations:
            break
        iterations += 1

        sess = sess_factory()
        try:
            claimed = claim_next_queued_essay(sess)
            claimed_info = (
                (int(claimed.id), int(claimed.user_id or 0), claimed.filename)
                if claimed is not None
                else None
            )
        finally:
            sess.close()

        if claimed_info is None:
            idle_polls += 1
            if stop_event is not None:
                try:
                    await asyncio.wait_for(stop_event.wait(), timeout=max(0.005, poll_interval))
                except TimeoutError:
                    pass
            else:
                await asyncio.sleep(max(0.005, poll_interval))
            continue

        essay_id, user_id, filename = claimed_info
        upload_path = resolve_persisted_upload_path(
            essay_id, filename=filename, uploads_dir=uploads_dir
        )
        if upload_path is None:
            err_sess = sess_factory()
            try:
                refund_upload_quota_once(
                    err_sess,
                    essay_id,
                    "Uploaded document file missing on disk.",
                )
            finally:
                err_sess.close()
            failed += 1
            continue

        if pipeline_instance is None:
            pipeline_instance = pipe_factory()

        get_tracker().init(essay_id)
        await essays_routes._run_pipeline_task(
            essay_id,
            str(upload_path),
            user_id,
            pipeline_instance,
            cleanup_file=False,
        )

        check_sess = sess_factory()
        try:
            row = check_sess.get(EssayRecord, essay_id)
            if row is not None and row.job_status == "failed":
                failed += 1
            else:
                processed += 1
        finally:
            check_sess.close()

    return {
        "processed": processed,
        "failed": failed,
        "idle_polls": idle_polls,
    }


def main(argv: Sequence[str] | None = None) -> int:
    """CLI entrypoint for ``python -m integrity_checker.worker``."""
    parser = argparse.ArgumentParser(
        prog="python -m integrity_checker.worker",
        description="CITRA standalone essay verification worker",
    )
    parser.add_argument(
        "--poll-interval",
        type=float,
        default=float(os.getenv("CITRA_WORKER_POLL_INTERVAL", "1.0")),
        help="Seconds to wait between idle queue polls (default: 1.0)",
    )
    parser.add_argument(
        "--max-iterations",
        type=int,
        default=None,
        help="Optional maximum poll/claim iterations before exiting cleanly",
    )
    args = parser.parse_args(list(argv) if argv is not None else None)

    os.environ.setdefault("CITRA_WORKER_MODE", "worker_only")
    configure_logging()
    db_session.init_db()
    logger.info("Starting CITRA standalone worker (CITRA_WORKER_MODE=worker_only)")

    async def _runner() -> None:
        stop_ev = asyncio.Event()
        loop = asyncio.get_running_loop()
        for sig in (signal.SIGINT, signal.SIGTERM):
            try:
                loop.add_signal_handler(sig, stop_ev.set)
            except (NotImplementedError, RuntimeError):
                pass
        await run_worker_loop(
            poll_interval=args.poll_interval,
            stop_event=stop_ev,
            max_iterations=args.max_iterations,
            recover_on_startup=True,
        )

    asyncio.run(_runner())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
