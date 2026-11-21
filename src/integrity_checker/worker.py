"""Standalone background pipeline worker for CITRA_WORKER_MODE=worker_only."""

from __future__ import annotations

import argparse
import asyncio
import os
import signal
import threading
import time
from collections.abc import Callable, Sequence
from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING

from sqlalchemy import text
from sqlalchemy.orm import Session

from integrity_checker.api import job_recovery
from integrity_checker.api.deps import get_pipeline
from integrity_checker.api.progress import get_tracker
from integrity_checker.db import session as db_session
from integrity_checker.db.models import EssayRecord
from integrity_checker.logging import configure_logging, get_logger
from integrity_checker.retrieval.http_pool import close_loop_http_clients

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
    stale_heartbeat_seconds: float = 300.0,
    heartbeat_interval: float = 30.0,
    orphan_recovery_interval: float = 60.0,
) -> dict[str, int]:
    """Continuously claim and execute queued essay analysis jobs until stopped."""
    from integrity_checker.api.routes import essays as essays_routes

    pipe_factory = pipeline_factory if pipeline_factory is not None else get_pipeline
    sess_factory = session_factory if session_factory is not None else db_session.get_session
    pipeline_instance: IntegrityPipeline | None = None

    def _claim_in_thread() -> tuple[int, int, str | None] | None:
        sess = sess_factory()
        try:
            claimed = claim_next_queued_essay(sess)
            if claimed is None:
                return None
            return (int(claimed.id), int(claimed.user_id or 0), claimed.filename)
        finally:
            sess.close()

    def _refund_missing_in_thread(target_eid: int) -> None:
        err_sess = sess_factory()
        try:
            job_recovery.refund_upload_quota_once(
                err_sess,
                target_eid,
                "Uploaded document file missing on disk.",
            )
        finally:
            err_sess.close()

    def _check_final_status_in_thread(target_eid: int) -> str | None:
        check_sess = sess_factory()
        try:
            row = check_sess.get(EssayRecord, target_eid)
            return str(row.job_status) if row is not None else None
        finally:
            check_sess.close()

    processed = 0
    failed = 0
    idle_polls = 0
    iterations = 0
    last_orphan_check_mono = 0.0

    try:
        if recover_on_startup:
            recovery_stats = await asyncio.to_thread(
                job_recovery.recover_orphaned_essay_jobs,
                pipe_factory,
                session_factory=sess_factory,
                uploads_dir=uploads_dir,
                run_rescheduled=False,
                include_queued=False,
                stale_heartbeat_seconds=stale_heartbeat_seconds,
            )
            last_orphan_check_mono = time.monotonic()
            if any(recovery_stats.values()):
                logger.info(f"Worker startup orphan recovery: {recovery_stats}")
        else:
            last_orphan_check_mono = time.monotonic()

        while True:
            if stop_event is not None and stop_event.is_set():
                break
            if max_iterations is not None and iterations >= max_iterations:
                break
            iterations += 1

            now_mono = time.monotonic()
            if orphan_recovery_interval > 0 and (
                last_orphan_check_mono == 0.0
                or (now_mono - last_orphan_check_mono) >= orphan_recovery_interval
            ):
                periodic_stats = await asyncio.to_thread(
                    job_recovery.recover_orphaned_essay_jobs,
                    pipe_factory,
                    session_factory=sess_factory,
                    uploads_dir=uploads_dir,
                    run_rescheduled=False,
                    include_queued=False,
                    stale_heartbeat_seconds=stale_heartbeat_seconds,
                )
                last_orphan_check_mono = time.monotonic()
                if any(periodic_stats.values()):
                    logger.info(f"Worker periodic orphan recovery: {periodic_stats}")

            claimed_info = await asyncio.to_thread(_claim_in_thread)

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
            upload_path = job_recovery.resolve_persisted_upload_path(
                essay_id, filename=filename, uploads_dir=uploads_dir
            )
            if upload_path is None:
                await asyncio.to_thread(_refund_missing_in_thread, essay_id)
                failed += 1
                continue

            if pipeline_instance is None:
                pipeline_instance = await asyncio.to_thread(pipe_factory)

            get_tracker().init(essay_id)
            hb_stop = asyncio.Event()

            async def _heartbeat_pump(
                target_eid: int,
                stop_ev_hb: asyncio.Event,
            ) -> None:
                interval_s = max(0.01, float(heartbeat_interval))
                while not stop_ev_hb.is_set():
                    try:
                        await asyncio.wait_for(stop_ev_hb.wait(), timeout=interval_s)
                        break
                    except TimeoutError:
                        await asyncio.to_thread(
                            job_recovery.refresh_job_heartbeat,
                            target_eid,
                            session_factory=sess_factory,
                        )

            hb_task = asyncio.create_task(_heartbeat_pump(essay_id, hb_stop))
            try:
                await essays_routes._run_pipeline_task(
                    essay_id,
                    str(upload_path),
                    user_id,
                    pipeline_instance,
                    cleanup_file=False,
                )
            finally:
                hb_stop.set()
                hb_task.cancel()
                try:
                    await hb_task
                except asyncio.CancelledError:
                    pass

            final_status = await asyncio.to_thread(_check_final_status_in_thread, essay_id)
            if final_status == "failed":
                failed += 1
            else:
                processed += 1
    finally:
        await close_loop_http_clients()

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

    os.environ["CITRA_WORKER_MODE"] = "worker_only"
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

    try:
        asyncio.run(_runner())
    finally:
        db_session.get_engine().dispose()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
