"""In-memory progress tracker — exposes real-time pipeline status to frontend.

The upload endpoint kicks off the pipeline in a background task; this module
stores per-essay state that the ``GET /essays/{id}/status`` endpoint reads.

State lives in a process-local dict, so it disappears on restart — but the
endpoint also checks the DB (verdicts written = completed) so transient
losses heal naturally on the next call.
"""

from __future__ import annotations

import asyncio
import json
import time
from collections import deque
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import asdict, dataclass, field
from threading import Lock
from typing import Any

# Step keys must match the 8 steps surfaced by the ProcessingPage stepper.
STEP_KEYS: list[str] = [
    "parsing",
    "style_detection",
    "extracting",
    "linking",
    "retrieving",
    "comparing",
    "checking",
    "scoring",
]


@dataclass
class ProgressState:
    """Single source of truth for an in-flight pipeline run."""

    status: str = "processing"            # "queued" | "processing" | "completed" | "failed"
    step: str = "parsing"                 # current step key
    step_index: int = 0                   # 0..7
    total_steps: int = 8
    message: str = "Starting analysis..."
    citations_found: int = 0
    references_found: int = 0
    linked: int = 0
    # Per-data-source status (e.g. {"crossref": "ok", "openalex": "failed: 429"})
    sources_queried: dict[str, str] = field(default_factory=dict)
    started_at: float = field(default_factory=lambda: time.time())
    finished_at: float | None = None
    error: str | None = None
    retry_count: int = 0
    queue_position: int | None = None

    def to_snapshot(self) -> dict[str, Any]:
        """JSON-friendly snapshot for the API."""
        out = asdict(self)
        out["elapsed_seconds"] = (
            (self.finished_at or time.time()) - self.started_at
        )
        return out


MAX_AUTO_RETRIES = 1
STATE_TTL_SECONDS = 3600.0
MAX_TRACKED_STATES = 500


class ProgressTracker:
    """Thread-safe in-memory dict of ``essay_id -> ProgressState`` with bounded TTL cleanup."""

    def __init__(self) -> None:
        self._states: dict[int, ProgressState] = {}
        self._retry_counts: dict[int, int] = {}
        self._lock = Lock()

    def _prune_unlocked(self, now: float) -> None:
        if len(self._states) <= MAX_TRACKED_STATES:
            return
        expired = [
            eid
            for eid, st in self._states.items()
            if st.finished_at is not None and (now - st.finished_at) > STATE_TTL_SECONDS
        ]
        for eid in expired:
            self._states.pop(eid, None)
            self._retry_counts.pop(eid, None)

    def _persist_snapshot(self, essay_id: int, snapshot: dict[str, Any]) -> None:
        """Best-effort persistence of progress snapshot to EssayRecord for multi-worker fallback."""
        try:
            from integrity_checker.db.models import EssayRecord
            from integrity_checker.db.session import get_session

            session = get_session()
            try:
                essay = session.get(EssayRecord, essay_id)
                if essay is not None:
                    existing: dict[str, Any] = {}
                    if essay.style_profile_json:
                        try:
                            parsed = json.loads(essay.style_profile_json)
                            if isinstance(parsed, dict):
                                existing = parsed
                        except Exception:
                            existing = {}
                    existing["_progress_snapshot"] = dict(snapshot)
                    essay.style_profile_json = json.dumps(existing)
                    session.commit()
            finally:
                session.close()
        except Exception:
            pass

    def load_persisted_snapshot(
        self, essay_id: int, essay_record: Any | None = None
    ) -> dict[str, Any] | None:
        """Load persisted progress snapshot from EssayRecord when in-memory tracker is absent."""
        try:
            raw_json = getattr(essay_record, "style_profile_json", None) if essay_record is not None else None
            if raw_json is None and essay_record is None:
                from integrity_checker.db.models import EssayRecord
                from integrity_checker.db.session import get_session

                session = get_session()
                try:
                    row = session.get(EssayRecord, essay_id)
                    raw_json = getattr(row, "style_profile_json", None) if row is not None else None
                finally:
                    session.close()
            if not raw_json:
                return None
            parsed = json.loads(raw_json)
            if isinstance(parsed, dict) and isinstance(parsed.get("_progress_snapshot"), dict):
                return dict(parsed["_progress_snapshot"])
        except Exception:
            return None
        return None

    def init(self, essay_id: int, is_retry: bool = False) -> ProgressState:
        """Create a fresh state for an essay (overwrites any prior state)."""
        initial_q_pos = get_pipeline_admission_controller().peek_queue_position_if_saturated()
        init_status = "queued" if initial_q_pos is not None else "processing"
        init_msg = (
            f"Queued for analysis (position #{initial_q_pos})..."
            if initial_q_pos is not None
            else "Parsing document..."
        )
        with self._lock:
            now = time.time()
            self._prune_unlocked(now)
            if is_retry:
                self._retry_counts[essay_id] = self._retry_counts.get(essay_id, 0) + 1
            else:
                self._retry_counts.setdefault(essay_id, 0)
            state = ProgressState(
                status=init_status,
                step=STEP_KEYS[0],
                step_index=0,
                total_steps=len(STEP_KEYS),
                message=init_msg,
                started_at=now,
                retry_count=self._retry_counts.get(essay_id, 0),
                queue_position=initial_q_pos,
            )
            self._states[essay_id] = state
            snapshot = state.to_snapshot()
        self._persist_snapshot(essay_id, snapshot)
        return state

    def can_auto_retry(self, essay_id: int) -> bool:
        """Return True if essay_id has not exceeded MAX_AUTO_RETRIES."""
        with self._lock:
            return self._retry_counts.get(essay_id, 0) < MAX_AUTO_RETRIES

    def get(self, essay_id: int) -> ProgressState | None:
        with self._lock:
            return self._states.get(essay_id)

    def update(self, essay_id: int, **fields: Any) -> ProgressState | None:
        """Merge ``fields`` into the state. Returns None if essay unknown."""
        snapshot: dict[str, Any] | None = None
        should_persist = False
        with self._lock:
            state = self._states.get(essay_id)
            if state is None:
                return None
            prev_status = state.status
            prev_step = state.step
            prev_qpos = state.queue_position
            for key, value in fields.items():
                if hasattr(state, key):
                    setattr(state, key, value)
            if (
                state.status != prev_status
                or state.step != prev_step
                or state.queue_position != prev_qpos
                or "finished_at" in fields
                or "error" in fields
            ):
                should_persist = True
                snapshot = state.to_snapshot()
        if should_persist and snapshot is not None:
            self._persist_snapshot(essay_id, snapshot)
        return state

    def complete(self, essay_id: int) -> ProgressState | None:
        """Mark complete; keep state around briefly so frontend can read it."""
        return self.update(
            essay_id,
            status="completed",
            step="done",
            step_index=len(STEP_KEYS) - 1,
            message="Analysis complete",
            queue_position=None,
            finished_at=time.time(),
        )

    def fail(self, essay_id: int, error: str) -> ProgressState | None:
        return self.update(
            essay_id,
            status="failed",
            error=error,
            message=f"Failed: {error}",
            queue_position=None,
            finished_at=time.time(),
        )

    def clear(self, essay_id: int) -> None:
        with self._lock:
            self._states.pop(essay_id, None)
            self._retry_counts.pop(essay_id, None)


@dataclass
class _QueuedEssayWaiter:
    essay_id: int
    loop: asyncio.AbstractEventLoop
    event: asyncio.Event
    tracker: ProgressTracker | None = None
    admitted: bool = False
    cancelled: bool = False


class PipelineAdmissionController:
    """Process-wide FIFO admission gate bounding concurrent essay pipelines.

    Prevents deadline upload storms (e.g. 50 students submitting simultaneously)
    from spawning 50 parallel GROBID + Sentence-BERT + 15-API worker threads,
    queuing excess submissions cleanly in async memory with live ``queue_position``.
    """

    def __init__(self, max_concurrent: int | None = None) -> None:
        self._explicit_max = max_concurrent
        self._lock = Lock()
        self._active_count: int = 0
        self._waiters: deque[_QueuedEssayWaiter] = deque()

    @property
    def max_concurrent(self) -> int:
        if self._explicit_max is not None:
            return max(1, int(self._explicit_max))
        try:
            from integrity_checker.config import get_settings

            return max(1, int(get_settings().retrieval.max_concurrent_pipelines))
        except Exception:
            return 3

    @property
    def active_count(self) -> int:
        with self._lock:
            return self._active_count

    @property
    def waiting_count(self) -> int:
        with self._lock:
            return len(self._waiters)

    def peek_queue_position_if_saturated(self) -> int | None:
        """Return 1-indexed estimated queue position if all worker slots are currently busy."""
        limit = self.max_concurrent
        with self._lock:
            if self._active_count < limit and not self._waiters:
                return None
            return len(self._waiters) + 1

    def _collect_position_updates_unlocked(
        self,
    ) -> list[tuple[int, ProgressTracker, int]]:
        updates: list[tuple[int, ProgressTracker, int]] = []
        for idx, w in enumerate(self._waiters, start=1):
            if not w.cancelled and w.tracker is not None:
                updates.append((w.essay_id, w.tracker, idx))
        return updates

    @staticmethod
    def _apply_position_updates(
        updates: list[tuple[int, ProgressTracker, int]],
    ) -> None:
        for eid, trk, pos in updates:
            trk.update(
                eid,
                status="queued",
                queue_position=pos,
                message=f"Queued for analysis (position #{pos})...",
            )

    def cancel(self, essay_id: int) -> bool:
        """Cancel a queued essay (e.g. when deleted before starting) and refresh queue positions."""
        to_wake: list[_QueuedEssayWaiter] = []
        pos_updates: list[tuple[int, ProgressTracker, int]] = []
        with self._lock:
            kept: deque[_QueuedEssayWaiter] = deque()
            for w in self._waiters:
                if w.essay_id == essay_id and not w.admitted:
                    w.cancelled = True
                    to_wake.append(w)
                else:
                    kept.append(w)
            self._waiters = kept
            if to_wake:
                pos_updates = self._collect_position_updates_unlocked()

        for w in to_wake:
            try:
                w.loop.call_soon_threadsafe(w.event.set)
            except RuntimeError:
                pass
        if pos_updates:
            self._apply_position_updates(pos_updates)
        return bool(to_wake)

    def _release_slot(self) -> None:
        limit = self.max_concurrent
        promoted: list[_QueuedEssayWaiter] = []
        pos_updates: list[tuple[int, ProgressTracker, int]] = []
        with self._lock:
            self._active_count = max(0, self._active_count - 1)
            while self._active_count < limit and self._waiters:
                candidate = self._waiters.popleft()
                if candidate.cancelled or candidate.loop.is_closed():
                    continue
                candidate.admitted = True
                self._active_count += 1
                promoted.append(candidate)
            pos_updates = self._collect_position_updates_unlocked()

        for w in promoted:
            try:
                w.loop.call_soon_threadsafe(w.event.set)
            except RuntimeError:
                self._release_slot()
        if pos_updates:
            self._apply_position_updates(pos_updates)

    @asynccontextmanager
    async def acquire(
        self,
        essay_id: int,
        tracker: ProgressTracker | None = None,
    ) -> AsyncIterator[bool]:
        """Acquire a pipeline execution slot in FIFO order.

        Yields ``True`` when admitted to run, or ``False`` if cancelled while queued.
        """
        loop = asyncio.get_running_loop()
        limit = self.max_concurrent
        waiter: _QueuedEssayWaiter | None = None
        queue_pos = 0

        with self._lock:
            if self._active_count < limit and not self._waiters:
                self._active_count += 1
                admitted_now = True
            else:
                waiter = _QueuedEssayWaiter(
                    essay_id=essay_id,
                    loop=loop,
                    event=asyncio.Event(),
                    tracker=tracker,
                )
                self._waiters.append(waiter)
                queue_pos = len(self._waiters)
                admitted_now = False

        if not admitted_now:
            assert waiter is not None
            if tracker is not None:
                tracker.update(
                    essay_id,
                    status="queued",
                    step=STEP_KEYS[0],
                    step_index=0,
                    queue_position=queue_pos,
                    message=f"Queued for analysis (position #{queue_pos})...",
                )
            try:
                await waiter.event.wait()
            except BaseException:
                pos_updates: list[tuple[int, ProgressTracker, int]] = []
                was_admitted = False
                with self._lock:
                    was_admitted = waiter.admitted
                    if not was_admitted:
                        waiter.cancelled = True
                        try:
                            self._waiters.remove(waiter)
                        except ValueError:
                            pass
                        pos_updates = self._collect_position_updates_unlocked()
                if pos_updates:
                    self._apply_position_updates(pos_updates)
                if was_admitted:
                    self._release_slot()
                raise

            if waiter.cancelled or not waiter.admitted:
                yield False
                return

        if tracker is not None:
            cur = tracker.get(essay_id)
            if cur is not None and (cur.status == "queued" or cur.queue_position is not None):
                tracker.update(
                    essay_id,
                    status="processing",
                    step=STEP_KEYS[0],
                    step_index=0,
                    queue_position=None,
                    message="Parsing document...",
                )

        try:
            yield True
        finally:
            self._release_slot()


# Canonical thesis/NFR alias for PipelineAdmissionController
DeadlineQueueManager = PipelineAdmissionController

# Module-level singletons — backend is single-process for MVP
_tracker = ProgressTracker()
_admission_controller = PipelineAdmissionController()


def get_tracker() -> ProgressTracker:
    return _tracker


def get_pipeline_admission_controller() -> PipelineAdmissionController:
    return _admission_controller


def get_deadline_queue_manager() -> PipelineAdmissionController:
    return _admission_controller
