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
import os
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
    quota_charged: bool = True
    document_diagnostics: dict[str, Any] | None = None

    def to_snapshot(self) -> dict[str, Any]:
        """JSON-friendly snapshot for the API."""
        out = asdict(self)
        out["quota_charged"] = bool(self.quota_charged)
        out["document_diagnostics"] = self.document_diagnostics
        out["elapsed_seconds"] = (
            (self.finished_at or time.time()) - self.started_at
        )
        return out

    def to_dict(self) -> dict[str, Any]:
        """Alias for `to_snapshot()` returning JSON-ready progress dictionary."""
        return self.to_snapshot()


MAX_AUTO_RETRIES = 1
STATE_TTL_SECONDS = 3600.0
MAX_TRACKED_STATES = 500
SUBSCRIBER_QUEUE_MAXSIZE = 16


def _current_worker_mode() -> str:
    mode = os.getenv("CITRA_WORKER_MODE", "inline").strip().lower()
    if mode in {"web_only", "worker_only", "inline"}:
        return mode
    return "inline"


def refresh_live_snapshot_elapsed(snapshot: dict[str, Any]) -> dict[str, Any]:
    """Recompute live elapsed_seconds from started_at for non-terminal persisted snapshots."""
    if snapshot.get("status") not in ("queued", "processing"):
        return snapshot
    if snapshot.get("finished_at") is not None:
        return snapshot
    started_at = snapshot.get("started_at")
    if isinstance(started_at, (int, float)) and started_at > 0:
        prev_elapsed = float(snapshot.get("elapsed_seconds", 0.0) or 0.0)
        live_elapsed = max(prev_elapsed, time.time() - float(started_at))
        out = dict(snapshot)
        out["elapsed_seconds"] = live_elapsed
        return out
    return snapshot


class ProgressTracker:
    """Thread-safe in-memory dict of ``essay_id -> ProgressState`` with bounded TTL cleanup."""

    def __init__(self) -> None:
        self._states: dict[int, ProgressState] = {}
        self._retry_counts: dict[int, int] = {}
        self._subscribers: dict[
            int, list[tuple[asyncio.AbstractEventLoop, asyncio.Queue[dict[str, Any]]]]
        ] = {}
        self._lock = Lock()

    @staticmethod
    def _enqueue_snapshot_on_loop(
        queue: asyncio.Queue[dict[str, Any]],
        snapshot: dict[str, Any],
    ) -> None:
        """Push snapshot onto subscriber queue on its owning event loop without blocking."""
        if queue.full():
            try:
                oldest = queue.get_nowait()
                if oldest.get("status") in ("completed", "failed"):
                    # Never discard an already-queued terminal snapshot
                    try:
                        queue.put_nowait(oldest)
                    except asyncio.QueueFull:
                        pass
                    return
            except asyncio.QueueEmpty:
                pass
        try:
            queue.put_nowait(snapshot)
        except asyncio.QueueFull:
            pass

    def _notify_subscribers(
        self,
        subs: list[tuple[asyncio.AbstractEventLoop, asyncio.Queue[dict[str, Any]]]],
        snapshot: dict[str, Any],
    ) -> None:
        if not subs:
            return
        for loop, queue in subs:
            if loop.is_closed():
                continue
            try:
                loop.call_soon_threadsafe(
                    self._enqueue_snapshot_on_loop,
                    queue,
                    dict(snapshot),
                )
            except RuntimeError:
                pass

    @staticmethod
    def _snapshot_signature(snapshot: dict[str, Any]) -> str:
        comparable = {
            k: v
            for k, v in snapshot.items()
            if k not in ("elapsed_seconds", "started_at")
        }
        return json.dumps(comparable, sort_keys=True, default=str)

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
            subs = list(self._subscribers.get(essay_id, ()))
        self._notify_subscribers(subs, snapshot)
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
        notify_snapshot: dict[str, Any] | None = None
        subs: list[tuple[asyncio.AbstractEventLoop, asyncio.Queue[dict[str, Any]]]] = []
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
            notify_snapshot = state.to_snapshot()
            subs = list(self._subscribers.get(essay_id, ()))
            if (
                state.status != prev_status
                or state.step != prev_step
                or state.queue_position != prev_qpos
                or "finished_at" in fields
                or "error" in fields
                or "quota_charged" in fields
                or "document_diagnostics" in fields
            ):
                should_persist = True
        if notify_snapshot is not None:
            self._notify_subscribers(subs, notify_snapshot)
        if should_persist and notify_snapshot is not None:
            self._persist_snapshot(essay_id, notify_snapshot)
        return state

    def complete(
        self,
        essay_id: int,
        document_diagnostics: dict[str, Any] | None = None,
    ) -> ProgressState | None:
        """Mark complete; keep state around briefly so frontend can read it."""
        fields: dict[str, Any] = {
            "status": "completed",
            "step": "done",
            "step_index": len(STEP_KEYS) - 1,
            "message": "Analysis complete",
            "queue_position": None,
            "finished_at": time.time(),
        }
        if document_diagnostics is not None:
            fields["document_diagnostics"] = document_diagnostics
        return self.update(essay_id, **fields)

    def fail(
        self,
        essay_id: int,
        error: str,
        *,
        quota_charged: bool | None = None,
    ) -> ProgressState | None:
        fields: dict[str, Any] = {
            "status": "failed",
            "error": error,
            "message": f"Failed: {error}",
            "queue_position": None,
            "finished_at": time.time(),
        }
        if quota_charged is not None:
            fields["quota_charged"] = bool(quota_charged)
        return self.update(essay_id, **fields)

    def clear(self, essay_id: int) -> None:
        with self._lock:
            self._states.pop(essay_id, None)
            self._retry_counts.pop(essay_id, None)

    def load_db_fallback_snapshot(
        self,
        essay_id: int,
        db: Any | None = None,
    ) -> dict[str, Any] | None:
        """Reconstruct progress snapshot from SQLite for multi-worker / restart resilience."""
        try:
            from integrity_checker.db.models import EssayRecord
            from integrity_checker.db.repository import Repository
            from integrity_checker.db.session import get_session

            owns_session = db is None
            session = get_session() if owns_session else db
            try:
                essay = session.get(EssayRecord, essay_id)
                if essay is None:
                    return None

                persisted_snap = self.load_persisted_snapshot(essay_id, essay)
                job_status = getattr(essay, "job_status", None)
                raw_qc = getattr(essay, "quota_charged", True)
                quota_charged_bool = True if raw_qc is None else bool(raw_qc)

                if job_status == "queued":
                    if persisted_snap is not None and persisted_snap.get("status") == "queued":
                        snap = dict(refresh_live_snapshot_elapsed(persisted_snap))
                        if snap.get("queue_position") is None:
                            snap["queue_position"] = compute_sqlite_fifo_queue_position(
                                session, essay_id
                            )
                        snap.setdefault("quota_charged", quota_charged_bool)
                        snap.setdefault("document_diagnostics", None)
                        return snap
                    q_pos = compute_sqlite_fifo_queue_position(session, essay_id)
                    return {
                        "status": "queued",
                        "step": "queued",
                        "step_index": 0,
                        "total_steps": len(STEP_KEYS),
                        "message": f"Queued for analysis (position #{q_pos})...",
                        "citations_found": 0,
                        "references_found": 0,
                        "linked": 0,
                        "sources_queried": {},
                        "elapsed_seconds": 0.0,
                        "finished_at": None,
                        "error": None,
                        "queue_position": q_pos,
                        "quota_charged": quota_charged_bool,
                        "document_diagnostics": None,
                    }

                if job_status == "failed":
                    fail_err = (
                        essay.job_error
                        or (persisted_snap or {}).get("error")
                        or "Analysis failed due to an internal processing error."
                    )
                    return {
                        "status": "failed",
                        "step": (persisted_snap or {}).get("step", STEP_KEYS[0]),
                        "step_index": int((persisted_snap or {}).get("step_index", 0) or 0),
                        "total_steps": len(STEP_KEYS),
                        "message": f"Failed: {fail_err}",
                        "citations_found": int((persisted_snap or {}).get("citations_found", 0) or 0),
                        "references_found": int((persisted_snap or {}).get("references_found", 0) or 0),
                        "linked": int((persisted_snap or {}).get("linked", 0) or 0),
                        "sources_queried": (persisted_snap or {}).get("sources_queried", {}),
                        "elapsed_seconds": float((persisted_snap or {}).get("elapsed_seconds", 0.0) or 0.0),
                        "finished_at": (persisted_snap or {}).get("finished_at"),
                        "error": fail_err,
                        "queue_position": None,
                        "quota_charged": quota_charged_bool,
                        "document_diagnostics": (persisted_snap or {}).get("document_diagnostics"),
                    }

                if job_status == "processing":
                    if persisted_snap is not None and persisted_snap.get("status") in (
                        "processing",
                        "queued",
                    ):
                        snap = dict(refresh_live_snapshot_elapsed(persisted_snap))
                        snap.setdefault("quota_charged", quota_charged_bool)
                        snap.setdefault("document_diagnostics", None)
                        return snap
                    return {
                        "status": "processing",
                        "step": STEP_KEYS[0],
                        "step_index": 0,
                        "total_steps": len(STEP_KEYS),
                        "message": "Processing...",
                        "citations_found": 0,
                        "references_found": 0,
                        "linked": 0,
                        "sources_queried": {},
                        "elapsed_seconds": 0.0,
                        "finished_at": None,
                        "error": None,
                        "queue_position": None,
                        "quota_charged": quota_charged_bool,
                        "document_diagnostics": None,
                    }

                repo = Repository(session)
                verdicts = repo.get_verdicts(essay_id)
                if (
                    verdicts
                    or essay.cis_json is not None
                    or (persisted_snap is not None and persisted_snap.get("status") == "completed")
                ):
                    extracted = repo.get_citations(essay_id)
                    doc_diag = None
                    if essay.style_profile_json:
                        try:
                            sp_parsed = json.loads(essay.style_profile_json)
                            if isinstance(sp_parsed, dict):
                                doc_diag = sp_parsed.get("document_diagnostics")
                        except Exception:
                            doc_diag = None
                    if doc_diag is None and persisted_snap is not None:
                        doc_diag = persisted_snap.get("document_diagnostics")
                    return {
                        "status": "completed",
                        "step": "done",
                        "step_index": len(STEP_KEYS) - 1,
                        "total_steps": len(STEP_KEYS),
                        "message": "Analysis complete",
                        "citations_found": sum(
                            c.citation_type in {"in_text", "numeric"} for c in extracted
                        ),
                        "references_found": sum(
                            c.citation_type == "reference_list" for c in extracted
                        ),
                        "linked": sum(v.mapping_status == "matched" for v in verdicts),
                        "sources_queried": (persisted_snap or {}).get("sources_queried", {}),
                        "elapsed_seconds": float(
                            (persisted_snap or {}).get("elapsed_seconds", 0.0) or 0.0
                        ),
                        "finished_at": (persisted_snap or {}).get("finished_at"),
                        "error": None,
                        "queue_position": None,
                        "quota_charged": quota_charged_bool,
                        "document_diagnostics": doc_diag,
                    }

                if persisted_snap is not None and persisted_snap.get("status") in (
                    "failed",
                    "processing",
                    "queued",
                ):
                    snap = dict(refresh_live_snapshot_elapsed(persisted_snap))
                    snap.setdefault("quota_charged", quota_charged_bool)
                    snap.setdefault("document_diagnostics", None)
                    return snap

                return {
                    "status": "processing",
                    "step": STEP_KEYS[0],
                    "step_index": 0,
                    "total_steps": len(STEP_KEYS),
                    "message": "Processing...",
                    "citations_found": 0,
                    "references_found": 0,
                    "linked": 0,
                    "sources_queried": {},
                    "elapsed_seconds": 0.0,
                    "finished_at": None,
                    "error": None,
                    "queue_position": None,
                    "quota_charged": quota_charged_bool,
                    "document_diagnostics": None,
                }
            finally:
                if owns_session:
                    session.close()
        except Exception:
            return None

    async def subscribe(
        self,
        essay_id: int,
        poll_interval: float = 1.0,
        heartbeat_interval: float = 15.0,
    ) -> AsyncIterator[dict[str, Any]]:
        """Yield live progress snapshots for ``essay_id`` until terminal status or disconnect."""
        _ = heartbeat_interval  # Kept in signature for SSE route configuration compatibility
        loop = asyncio.get_running_loop()
        queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=SUBSCRIBER_QUEUE_MAXSIZE)
        sub_entry = (loop, queue)
        worker_mode = _current_worker_mode()

        with self._lock:
            self._subscribers.setdefault(essay_id, []).append(sub_entry)
            initial_mem_snap = (
                None
                if worker_mode == "web_only" or essay_id not in self._states
                else self._states[essay_id].to_snapshot()
            )

        try:
            initial_snap = (
                initial_mem_snap
                if initial_mem_snap is not None
                else await asyncio.to_thread(self.load_db_fallback_snapshot, essay_id)
            )
            last_sig: str | None = None
            if initial_snap is not None:
                last_sig = self._snapshot_signature(initial_snap)
                yield initial_snap
                if initial_snap.get("status") in ("completed", "failed"):
                    return

            effective_poll = max(0.01, float(poll_interval))
            while True:
                worker_mode = _current_worker_mode()
                try:
                    item = await asyncio.wait_for(queue.get(), timeout=effective_poll)
                    if worker_mode == "web_only":
                        continue
                    sig = self._snapshot_signature(item)
                    if sig != last_sig:
                        last_sig = sig
                        yield item
                    if item.get("status") in ("completed", "failed"):
                        return
                except TimeoutError:
                    in_mem = None if worker_mode == "web_only" else self.get(essay_id)
                    if in_mem is not None:
                        mem_snap = in_mem.to_snapshot()
                        sig = self._snapshot_signature(mem_snap)
                        if sig != last_sig:
                            last_sig = sig
                            yield mem_snap
                        if mem_snap.get("status") in ("completed", "failed"):
                            return
                        continue

                    db_snap = await asyncio.to_thread(self.load_db_fallback_snapshot, essay_id)
                    if db_snap is None:
                        return
                    sig = self._snapshot_signature(db_snap)
                    if sig != last_sig:
                        last_sig = sig
                        yield db_snap
                    if db_snap.get("status") in ("completed", "failed"):
                        return
        finally:
            with self._lock:
                subs = self._subscribers.get(essay_id)
                if subs is not None:
                    try:
                        subs.remove(sub_entry)
                    except ValueError:
                        pass
                    if not subs:
                        self._subscribers.pop(essay_id, None)


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
        self._active_essays: set[int] = set()
        self._waiters: deque[_QueuedEssayWaiter] = deque()

    def is_inflight(self, essay_id: int) -> bool:
        """Return True if essay_id is actively executing or waiting in the FIFO queue."""
        with self._lock:
            if essay_id in self._active_essays:
                return True
            return any(
                w.essay_id == essay_id and not w.cancelled for w in self._waiters
            )

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

    def _release_slot(self, finished_essay_id: int | None = None) -> None:
        limit = self.max_concurrent
        promoted: list[_QueuedEssayWaiter] = []
        pos_updates: list[tuple[int, ProgressTracker, int]] = []
        with self._lock:
            if finished_essay_id is not None:
                self._active_essays.discard(finished_essay_id)
            self._active_count = max(0, self._active_count - 1)
            while self._active_count < limit and self._waiters:
                candidate = self._waiters.popleft()
                if candidate.cancelled or candidate.loop.is_closed():
                    continue
                candidate.admitted = True
                self._active_count += 1
                self._active_essays.add(candidate.essay_id)
                promoted.append(candidate)
            pos_updates = self._collect_position_updates_unlocked()

        for w in promoted:
            try:
                w.loop.call_soon_threadsafe(w.event.set)
            except RuntimeError:
                self._release_slot(w.essay_id)
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
                self._active_essays.add(essay_id)
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
                    self._release_slot(essay_id)
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
            self._release_slot(essay_id)


# Canonical thesis/NFR alias for PipelineAdmissionController
DeadlineQueueManager = PipelineAdmissionController

# Module-level singletons — backend is single-process for MVP
_tracker = ProgressTracker()
_admission_controller = PipelineAdmissionController()


def compute_sqlite_fifo_queue_position(session: Any, essay_id: int) -> int:
    """Compute 1-based FIFO queue position among SQLite essays with `job_status == 'queued'`."""
    from sqlalchemy import func

    from integrity_checker.db.models import EssayRecord

    cnt = (
        session.query(func.count(EssayRecord.id))
        .filter(
            EssayRecord.job_status == "queued",
            EssayRecord.id <= int(essay_id),
        )
        .scalar()
    )
    return max(1, int(cnt or 0))


def load_db_fallback_snapshot(essay_id: int, db: Any | None = None) -> dict[str, Any] | None:
    """Module-level helper delegating to `_tracker.load_db_fallback_snapshot(essay_id, db)`."""
    return _tracker.load_db_fallback_snapshot(essay_id, db=db)


def get_tracker() -> ProgressTracker:
    return _tracker


def get_pipeline_admission_controller() -> PipelineAdmissionController:
    return _admission_controller


def get_deadline_queue_manager() -> PipelineAdmissionController:
    return _admission_controller
