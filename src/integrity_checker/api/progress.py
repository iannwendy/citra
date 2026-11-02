"""In-memory progress tracker — exposes real-time pipeline status to frontend.

The upload endpoint kicks off the pipeline in a background task; this module
stores per-essay state that the ``GET /essays/{id}/status`` endpoint reads.

State lives in a process-local dict, so it disappears on restart — but the
endpoint also checks the DB (verdicts written = completed) so transient
losses heal naturally on the next call.
"""

from __future__ import annotations

import time
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

    def init(self, essay_id: int, is_retry: bool = False) -> ProgressState:
        """Create a fresh state for an essay (overwrites any prior state)."""
        with self._lock:
            now = time.time()
            self._prune_unlocked(now)
            if is_retry:
                self._retry_counts[essay_id] = self._retry_counts.get(essay_id, 0) + 1
            else:
                self._retry_counts.setdefault(essay_id, 0)
            state = ProgressState(
                status="processing",
                step=STEP_KEYS[0],
                step_index=0,
                total_steps=len(STEP_KEYS),
                message="Parsing document...",
                started_at=now,
                retry_count=self._retry_counts.get(essay_id, 0),
            )
            self._states[essay_id] = state
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
        with self._lock:
            state = self._states.get(essay_id)
            if state is None:
                return None
            for key, value in fields.items():
                if hasattr(state, key):
                    setattr(state, key, value)
            return state

    def complete(self, essay_id: int) -> ProgressState | None:
        """Mark complete; keep state around briefly so frontend can read it."""
        return self.update(
            essay_id,
            status="completed",
            step="done",
            step_index=len(STEP_KEYS) - 1,
            message="Analysis complete",
            finished_at=time.time(),
        )

    def fail(self, essay_id: int, error: str) -> ProgressState | None:
        return self.update(
            essay_id,
            status="failed",
            error=error,
            message=f"Failed: {error}",
            finished_at=time.time(),
        )

    def clear(self, essay_id: int) -> None:
        with self._lock:
            self._states.pop(essay_id, None)
            self._retry_counts.pop(essay_id, None)


# Module-level singleton — backend is single-process for MVP
_tracker = ProgressTracker()


def get_tracker() -> ProgressTracker:
    return _tracker
