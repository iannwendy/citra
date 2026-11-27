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

_HTTP_429_RE = re.compile(
    r"\b(?:http[\s/_-]*)?429\b|rate[\s_-]?limit|too many requests",
    re.IGNORECASE,
)
_HTTP_5XX_RE = re.compile(
    r"\b(?:http[\s/_-]*)?5\d{2}\b|\b5xx\b|service unavailable|bad gateway|"
    r"gateway timeout|internal server error",
    re.IGNORECASE,
)
_HTTP_CODE_RE = re.compile(
    r"(?:http[\s/_:-]*|status[\s/_:-]*|\()([45]\d{2})\b|\b(429|5\d{2})\b",
    re.IGNORECASE,
)
_HEX_ADDR_RE = re.compile(r"\b0x[0-9a-fA-F]{4,}\b")
_DIRTY_REPR_OR_QUERY_RE = re.compile(
    r"RetryError\s*\[|"
    r"<\s*Future\b|"
    r"\b0x[0-9a-fA-F]{4,}\b|"
    r"\bfor\s+(?:url\s+)?['\"]|"
    r"['\"][^'\"]{2,}['\"]|"
    r"https?://|"
    r"\b(?:httpx\.)?(?:ReadTimeout|ConnectTimeout|PoolTimeout|WriteTimeout|TimeoutException|"
    r"ConnectError|ReadError|WriteError|RemoteProtocolError|HTTPStatusError|RetryError|"
    r"RequestError|TransportError|NetworkError)\b|"
    r":\s*\)\s*$|"
    r":\s*$",
    re.IGNORECASE,
)
_CONNECTION_ERR_RE = re.compile(
    r"connect(?:error|ion|\s+refused|\s+reset)|remoteprotocol|readerror|writeerror|"
    r"network|dns|ssl|tls|eof|broken pipe|name or service not known|errno",
    re.IGNORECASE,
)


def sanitize_error_reason(raw_reason: str | None) -> str | None:
    """Normalize upstream error reasons so raw Python reprs, hex addresses, and user citation
    strings are never stored or exposed via health telemetry.
    """
    if raw_reason is None:
        return None
    raw = str(raw_reason).strip()
    if not raw:
        return None

    # Already-clean human diagnostics (no Python reprs, hex addresses, URLs, or quoted query text)
    # are preserved verbatim (whitespace-normalized & capped at 240 chars) for backward compatibility.
    if not _DIRTY_REPR_OR_QUERY_RE.search(raw):
        cleaned = " ".join(raw.split())
        return cleaned[:240] or None

    # Strip hex memory addresses before inspecting HTTP codes so 0x...429... never misclassifies.
    scrubbed = _HEX_ADDR_RE.sub("", raw)
    # Strip quoted user queries / URLs so user text never influences error classification or leaks.
    scrubbed = re.sub(r"\bfor\s+(?:url\s+)?(['\"]).*?\1", "", scrubbed, flags=re.IGNORECASE)
    scrubbed = re.sub(r"https?://\S+", "", scrubbed, flags=re.IGNORECASE)
    scrubbed_lower = scrubbed.lower()

    if _HTTP_429_RE.search(scrubbed_lower):
        return "Rate limited (HTTP 429)"
    if "timeout" in scrubbed_lower or "timed out" in scrubbed_lower:
        return "Request timed out (timeout)"

    code_match = _HTTP_CODE_RE.search(scrubbed)
    if code_match:
        code_val = int(code_match.group(1) or code_match.group(2))
        if code_val == 429:
            return "Rate limited (HTTP 429)"
        if 500 <= code_val < 600:
            return f"Upstream server error (HTTP {code_val})"
        if 400 <= code_val < 500:
            return f"Upstream client error (HTTP {code_val})"

    if _HTTP_5XX_RE.search(scrubbed_lower):
        return "Upstream server error (HTTP 5xx)"
    if _CONNECTION_ERR_RE.search(scrubbed_lower):
        return "Connection error"
    return "Upstream request failed"


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
    opened_at: float | None = None
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
            return False, max(0.0, self._recovery_timeout_seconds - (now - entry.probe_started_at))

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
            entry.opened_at = None
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
            entry.last_error = sanitize_error_reason(raw_reason)
            entry.last_failure_at = now

            scrubbed_for_classify = _HEX_ADDR_RE.sub("", raw_reason)
            r = scrubbed_for_classify.lower()
            is_rate_limit = bool(_HTTP_429_RE.search(r))
            if "timeout" in r or "timed out" in r:
                entry.timeout_count += 1
            elif is_rate_limit:
                entry.http_429_count += 1
            elif _HTTP_5XX_RE.search(r):
                entry.http_5xx_count += 1

            code_match = _HTTP_CODE_RE.search(scrubbed_for_classify)
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
                entry.opened_at = now
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
                    "opened_at": entry.opened_at,
                    "last_error": sanitize_error_reason(entry.last_error),
                    "last_status_code": entry.last_status_code,
                    "last_failure_at": entry.last_failure_at,
                }
            return out

    @staticmethod
    def _reset_circuit_entry(entry: _SourceCircuit) -> None:
        entry.state = CircuitState.CLOSED
        entry.consecutive_failures = 0
        entry.open_until = 0.0
        entry.opened_at = None
        entry.probe_in_flight = False
        entry.probe_started_at = 0.0
        entry.last_error = None
        entry.last_status_code = None
        entry.last_failure_at = None

    @staticmethod
    def _reset_private_client_breakers(source: str | None = None) -> None:
        target = (source or "").strip().lower() or None
        if target in (None, "europepmc"):
            try:
                from integrity_checker.retrieval.europepmc_client import EuropePMCClient

                EuropePMCClient.reset_backoff()
            except Exception:  # noqa: BLE001
                pass
        if target in (None, "dblp"):
            try:
                from integrity_checker.retrieval.dblp_client import DBLPClient

                DBLPClient.reset_circuit_state()
            except Exception:  # noqa: BLE001
                pass
        if target in (None, "arxiv"):
            try:
                from integrity_checker.retrieval.arxiv_client import ArxivClient

                ArxivClient.reset_circuit_state()
            except Exception:  # noqa: BLE001
                pass

    def reset(self, source: str | None = None) -> list[str]:
        """Reset either a single named provider's breaker or all tracked breakers back to CLOSED."""
        with self._lock:
            if source is not None:
                target = str(source).strip()
                self._reset_private_client_breakers(target)
                if not target or target not in self._circuits:
                    return []
                self._reset_circuit_entry(self._circuits[target])
                return [target]

            reset_names: list[str] = []
            for name in sorted(self._circuits.keys()):
                self._reset_circuit_entry(self._circuits[name])
                reset_names.append(name)
        self._reset_private_client_breakers(None)
        return reset_names


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
        else:
            CircuitBreakerRegistry._reset_private_client_breakers(None)
        _GLOBAL_REGISTRY = None


__all__ = [
    "CircuitBreakerEntry",
    "CircuitBreakerRegistry",
    "CircuitState",
    "get_circuit_breaker_registry",
    "reset_circuit_breaker_registry",
    "sanitize_error_reason",
]
