"""Per-source 3-state circuit breaker and upstream scholarly telemetry registry."""

from __future__ import annotations

import math
import re
import threading
import time
from collections import deque
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from enum import Enum
from typing import Any

_HTTP_5XX_RE = re.compile(
    r"\b(?:http[\s/_-]*)?5\d{2}\b|\b5xx\b|service unavailable|bad gateway|"
    r"gateway timeout|internal server error",
    re.IGNORECASE,
)
_HTTP_CODE_RE = re.compile(
    r"(?:http[\s/_:-]*|status[\s/_:-]*|\()([45]\d{2})\b|\b(429|5\d{2})\b",
    re.IGNORECASE,
)


class CircuitState(str, Enum):
    """3-state circuit breaker lifecycle for upstream scholarly providers."""

    CLOSED = "closed"
    OPEN = "open"
    HALF_OPEN = "half_open"


@dataclass
class _SourceCircuit:
    """Mutable telemetry and state container guarded by CircuitBreakerRegistry._lock."""

    state: CircuitState = CircuitState.CLOSED
    consecutive_failures: int = 0
    total_calls: int = 0
    success_count: int = 0
    timeout_count: int = 0
    http_429_count: int = 0
    http_5xx_count: int = 0
    ema_latency_ms: float = 0.0
    has_latency_sample: bool = False
    open_until: float = 0.0
    probe_in_flight: bool = False
    probe_started_at: float = 0.0
    last_error: str | None = None
    last_status_code: int | None = None
    last_failure_at: float | None = None
    latency_samples: deque[float] = field(default_factory=lambda: deque(maxlen=100))


CircuitBreakerEntry = _SourceCircuit


class CircuitBreakerRegistry:
    """Thread-safe per-source 3-state circuit breaker & EMA latency telemetry registry."""

    def __init__(
        self,
        failure_threshold: int = 4,
        recovery_timeout_seconds: float = 45.0,
        now_fn: Callable[[], float] = time.monotonic,
        *,
        ema_alpha: float = 0.3,
    ) -> None:
        if failure_threshold < 1:
            raise ValueError("failure_threshold must be >= 1")
        if recovery_timeout_seconds <= 0:
            raise ValueError("recovery_timeout_seconds must be > 0")
        self._failure_threshold = int(failure_threshold)
        self._recovery_timeout_seconds = float(recovery_timeout_seconds)
        self._now_fn = now_fn
        self._ema_alpha = max(0.01, min(1.0, float(ema_alpha)))
        self._lock = threading.Lock()
        self._circuits: dict[str, _SourceCircuit] = {}

    def _get_or_create(self, source_name: str) -> _SourceCircuit:
        entry = self._circuits.get(source_name)
        if entry is None:
            entry = _SourceCircuit()
            self._circuits[source_name] = entry
        return entry

    def register_sources(self, source_names: Iterable[str]) -> None:
        """Pre-register upstream source keys in CLOSED state without mutating existing entries."""
        with self._lock:
            for raw_name in source_names:
                name = str(raw_name or "").strip()
                if name:
                    self._get_or_create(name)

    def _update_ema(self, entry: _SourceCircuit, latency_ms: float) -> None:
        sample = max(0.0, float(latency_ms))
        if not entry.has_latency_sample:
            entry.ema_latency_ms = sample
            entry.has_latency_sample = True
        else:
            entry.ema_latency_ms = (
                self._ema_alpha * sample + (1.0 - self._ema_alpha) * entry.ema_latency_ms
            )

    def allow_request(self, source_name: str) -> tuple[bool, float]:
        """Return `(allowed, open_remaining_seconds)` for `source_name`.

        When `OPEN` and the cooldown window has elapsed, transitions to `HALF_OPEN`
        and admits **exactly 1** probe caller (`(True, 0.0)`); concurrent callers
        while that probe is in-flight receive `(False, remaining)`.
        """
        with self._lock:
            entry = self._circuits.get(source_name)
            if entry is None or entry.state == CircuitState.CLOSED:
                return True, 0.0

            now = float(self._now_fn())
            if entry.state == CircuitState.OPEN:
                if now >= entry.open_until:
                    entry.state = CircuitState.HALF_OPEN
                    entry.probe_in_flight = True
                    entry.probe_started_at = now
                    entry.open_until = 0.0
                    return True, 0.0
                return False, max(0.0, entry.open_until - now)

            # HALF_OPEN: admit at most 1 probe caller concurrently (auto-expiring stale probes)
            if (
                not entry.probe_in_flight
                or (now - entry.probe_started_at) >= self._recovery_timeout_seconds
            ):
                entry.probe_in_flight = True
                entry.probe_started_at = now
                return True, 0.0
            return False, max(0.0, entry.open_until - now)

    def release_probe(self, source_name: str) -> None:
        """Clear `probe_in_flight` if a `HALF_OPEN` probe task is cancelled or skipped."""
        with self._lock:
            entry = self._circuits.get(source_name)
            if entry is not None and entry.state == CircuitState.HALF_OPEN:
                entry.probe_in_flight = False
                entry.probe_started_at = 0.0

    def record_success(self, source_name: str, latency_ms: float) -> None:
        """Record a clean hit or clean scholarly miss (e.g. HTTP 200 empty / HTTP 404)."""
        with self._lock:
            entry = self._get_or_create(source_name)
            entry.total_calls += 1
            entry.success_count += 1
            sample = max(0.0, float(latency_ms))
            self._update_ema(entry, sample)
            entry.latency_samples.append(sample)
            entry.consecutive_failures = 0
            entry.probe_in_flight = False
            entry.probe_started_at = 0.0
            entry.open_until = 0.0
            if entry.state != CircuitState.CLOSED:
                entry.state = CircuitState.CLOSED

    def record_infra_failure(
        self,
        source_name: str,
        reason: str,
        latency_ms: float | None = None,
    ) -> None:
        """Record an upstream infrastructure failure and trip to OPEN when threshold reached."""
        with self._lock:
            now = float(self._now_fn())
            entry = self._get_or_create(source_name)
            entry.total_calls += 1
            entry.consecutive_failures += 1

            raw_reason = str(reason or "")
            entry.last_error = raw_reason[:240] or None
            entry.last_failure_at = now

            r = raw_reason.lower()
            is_rate_limit = (
                "429" in r
                or "rate limit" in r
                or "rate-limit" in r
                or "too many requests" in r
            )
            if "timeout" in r or "timed out" in r:
                entry.timeout_count += 1
            elif is_rate_limit:
                entry.http_429_count += 1
            elif _HTTP_5XX_RE.search(r):
                entry.http_5xx_count += 1

            code_match = _HTTP_CODE_RE.search(raw_reason)
            if code_match:
                entry.last_status_code = int(code_match.group(1) or code_match.group(2))
            elif is_rate_limit:
                entry.last_status_code = 429
            else:
                entry.last_status_code = None

            if latency_ms is not None and latency_ms >= 0:
                sample = float(latency_ms)
                self._update_ema(entry, sample)
                entry.latency_samples.append(sample)

            if (
                entry.state == CircuitState.HALF_OPEN
                or entry.consecutive_failures >= self._failure_threshold
            ):
                entry.state = CircuitState.OPEN
                entry.open_until = now + self._recovery_timeout_seconds
                entry.probe_in_flight = False
                entry.probe_started_at = 0.0

    def snapshot_all(self) -> dict[str, dict[str, Any]]:
        """Return per-source telemetry dictionary for `/api/system/health` observability."""
        with self._lock:
            now = float(self._now_fn())
            out: dict[str, dict[str, Any]] = {}
            for source_name, entry in sorted(self._circuits.items()):
                effective_state = (
                    CircuitState.HALF_OPEN
                    if (entry.state == CircuitState.OPEN and now >= entry.open_until)
                    else entry.state
                )
                rem = (
                    max(0.0, entry.open_until - now)
                    if effective_state == CircuitState.OPEN
                    else 0.0
                )
                open_remaining = round(rem, 2)
                avg_val = round(entry.ema_latency_ms, 2) if entry.has_latency_sample else None
                if entry.latency_samples:
                    sorted_samples = sorted(entry.latency_samples)
                    p95_idx = min(
                        len(sorted_samples) - 1,
                        max(0, math.ceil(0.95 * len(sorted_samples)) - 1),
                    )
                    p95_val: float | None = round(sorted_samples[p95_idx], 2)
                else:
                    p95_val = None
                failures = max(0, entry.total_calls - entry.success_count)
                out[source_name] = {
                    "state": effective_state.value,
                    "consecutive_failures": entry.consecutive_failures,
                    "total_calls": entry.total_calls,
                    "success_count": entry.success_count,
                    "failure_count": failures,
                    "total_failures": failures,
                    "timeout_count": entry.timeout_count,
                    "http_429_count": entry.http_429_count,
                    "http_5xx_count": entry.http_5xx_count,
                    "ema_latency_ms": round(entry.ema_latency_ms, 2),
                    "avg_latency_ms": avg_val,
                    "p95_latency_ms": p95_val,
                    "has_latency_sample": bool(entry.has_latency_sample),
                    "open_remaining_seconds": open_remaining,
                    "cooldown_remaining_s": open_remaining,
                    "last_error": entry.last_error,
                    "last_status_code": entry.last_status_code,
                    "last_failure_at": entry.last_failure_at,
                }
            return out

    def reset(self) -> None:
        """Clear all recorded per-source circuit state and telemetry."""
        with self._lock:
            self._circuits.clear()


_REGISTRY_LOCK = threading.Lock()
_GLOBAL_REGISTRY: CircuitBreakerRegistry | None = None


def get_circuit_breaker_registry() -> CircuitBreakerRegistry:
    """Return the process-wide singleton `CircuitBreakerRegistry`."""
    global _GLOBAL_REGISTRY
    with _REGISTRY_LOCK:
        if _GLOBAL_REGISTRY is None:
            _GLOBAL_REGISTRY = CircuitBreakerRegistry()
        return _GLOBAL_REGISTRY


def reset_circuit_breaker_registry() -> None:
    """Reset the process-wide `CircuitBreakerRegistry` (used for test isolation)."""
    global _GLOBAL_REGISTRY
    with _REGISTRY_LOCK:
        if _GLOBAL_REGISTRY is not None:
            _GLOBAL_REGISTRY.reset()
        _GLOBAL_REGISTRY = None


__all__ = [
    "CircuitBreakerEntry",
    "CircuitBreakerRegistry",
    "CircuitState",
    "get_circuit_breaker_registry",
    "reset_circuit_breaker_registry",
]
