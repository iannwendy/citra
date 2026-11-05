"""Shared per-event-loop HTTP Keep-Alive pool, Retry-After parser, and task-local HTTP telemetry.

Eliminates:
1. Per-request TCP/TLS handshake churn from creating a new `httpx.AsyncClient` on every API call.
2. Cross-thread / cross-coroutine race conditions on singleton client `self._last_status_code`.
3. Delayed HTTP 429 propagation (notifies active `RateLimiter` on the very first 429 response).
"""

from __future__ import annotations

import asyncio
import contextvars
import threading
import time
import weakref
from collections.abc import Callable, Mapping
from datetime import UTC, datetime
from email.utils import parsedate_to_datetime

import httpx

_POOL_LOCK = threading.Lock()
_LOOP_CLIENTS: weakref.WeakKeyDictionary[
    asyncio.AbstractEventLoop, dict[bool, httpx.AsyncClient]
] = weakref.WeakKeyDictionary()

_DEFAULT_LIMITS = httpx.Limits(
    max_connections=100,
    max_keepalive_connections=30,
    keepalive_expiry=30.0,
)

# Task-isolated HTTP telemetry: stores (owner_ref_or_tid, {source_name: (status, retry_after, error)}).
# Comparing the owner against the current asyncio.Task (via weakref) ensures child tasks spawned via
# `asyncio.create_task()` / `asyncio.gather()` automatically copy-on-write a fresh tiny dict without
# accumulating stale entries in a long-lived parent dict or risking `id(task)` address reuse.
_TaskStateDict = dict[str, tuple[int | None, float | None, str | None]]
_TASK_HTTP_STATE: contextvars.ContextVar[
    tuple[weakref.ReferenceType[asyncio.Task[object]] | int, _TaskStateDict] | None
] = contextvars.ContextVar("_TASK_HTTP_STATE", default=None)

# Optional task-scoped callback invoked immediately when any client sees HTTP 429:
# callback(source_name: str, retry_after: float | None) -> None
RateLimitCallback = Callable[[str, float | None], None]
_RATE_LIMIT_CALLBACK: contextvars.ContextVar[RateLimitCallback | None] = contextvars.ContextVar(
    "_RATE_LIMIT_CALLBACK", default=None
)


def get_shared_http_client(*, follow_redirects: bool = True) -> httpx.AsyncClient:
    """Return a Keep-Alive `httpx.AsyncClient` bound to the current running event loop.

    Safe across multiple background threads each running their own `asyncio.run(...)`
    event loop, and 100% compatible with `patch.object(httpx.AsyncClient, "get" / "post")`.
    """
    loop = asyncio.get_running_loop()
    with _POOL_LOCK:
        per_loop = _LOOP_CLIENTS.get(loop)
        if per_loop is None:
            per_loop = {}
            _LOOP_CLIENTS[loop] = per_loop
        client = per_loop.get(follow_redirects)
        if client is None or client.is_closed:
            client = httpx.AsyncClient(
                limits=_DEFAULT_LIMITS,
                follow_redirects=follow_redirects,
                timeout=httpx.Timeout(15.0, connect=5.0),
            )
            per_loop[follow_redirects] = client
        return client


async def close_loop_http_clients() -> None:
    """Close any pooled `httpx.AsyncClient` instances bound to the current event loop."""
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return
    with _POOL_LOCK:
        per_loop = _LOOP_CLIENTS.pop(loop, None)
    if not per_loop:
        return
    for client in per_loop.values():
        if not client.is_closed:
            try:
                await client.aclose()
            except Exception:  # noqa: BLE001
                pass


def parse_retry_after(
    headers: httpx.Headers | Mapping[str, str] | None,
    *,
    min_seconds: float = 0.5,
    max_seconds: float = 120.0,
) -> float | None:
    """Extract wait duration in seconds from `Retry-After` or `RateLimit-Reset` headers.

    Supports both delta-seconds (`"5"`, `"2.5"`) and RFC 7231 HTTP-date strings,
    plus numeric `x-ratelimit-reset-after` / `ratelimit-reset` headers.
    """
    if not headers:
        return None

    raw = (
        headers.get("retry-after")
        or headers.get("Retry-After")
        or headers.get("x-ratelimit-reset-after")
        or headers.get("X-RateLimit-Reset-After")
    )
    if raw is not None:
        val_str = str(raw).strip()
        if val_str:
            try:
                secs = float(val_str)
                if secs > 0:
                    return max(min_seconds, min(max_seconds, secs))
                return min_seconds
            except ValueError:
                try:
                    dt = parsedate_to_datetime(val_str)
                    if dt.tzinfo is None:
                        dt = dt.replace(tzinfo=UTC)
                    delta = (dt - datetime.now(UTC)).total_seconds()
                    if delta > 0:
                        return max(min_seconds, min(max_seconds, delta))
                    return min_seconds
                except (TypeError, ValueError, OverflowError):
                    pass

    reset_raw = (
        headers.get("ratelimit-reset")
        or headers.get("RateLimit-Reset")
        or headers.get("x-ratelimit-reset")
        or headers.get("X-RateLimit-Reset")
    )
    if reset_raw is not None:
        val_str = str(reset_raw).strip()
        try:
            num = float(val_str)
            # Distinguish Unix epoch seconds (> 1e9) vs delta seconds
            delta = (num - time.time()) if num > 1_000_000_000 else num
            if delta > 0:
                return max(min_seconds, min(max_seconds, delta))
        except ValueError:
            pass

    return None


def set_rate_limit_callback(
    callback: RateLimitCallback | None,
) -> contextvars.Token[RateLimitCallback | None]:
    """Install a task-local callback notified immediately when HTTP 429 is observed."""
    return _RATE_LIMIT_CALLBACK.set(callback)


def reset_rate_limit_callback(
    token: contextvars.Token[RateLimitCallback | None],
) -> None:
    """Restore previous task-local rate-limit callback."""
    _RATE_LIMIT_CALLBACK.reset(token)


def _current_owner_matches(
    owner: weakref.ReferenceType[asyncio.Task[object]] | int,
    task: asyncio.Task[object] | None,
) -> bool:
    if task is not None:
        return isinstance(owner, weakref.ReferenceType) and owner() is task
    return isinstance(owner, int) and owner == threading.get_ident()


def _get_owned_state_dict(*, create: bool) -> _TaskStateDict | None:
    try:
        task = asyncio.current_task()
    except RuntimeError:
        task = None

    current = _TASK_HTTP_STATE.get()
    if current is not None:
        owner, state_dict = current
        if _current_owner_matches(owner, task):
            return state_dict

    if not create:
        return None

    fresh: _TaskStateDict = {}
    new_owner: weakref.ReferenceType[asyncio.Task[object]] | int = (
        weakref.ref(task) if task is not None else threading.get_ident()
    )
    _TASK_HTTP_STATE.set((new_owner, fresh))
    return fresh


def reset_task_http_status(source_name: str) -> None:
    """Clear recorded HTTP status / error for `source_name` in the current asyncio Task."""
    state = _get_owned_state_dict(create=False)
    if state is not None:
        state.pop(source_name, None)


def record_task_http_status(
    source_name: str,
    status_code: int | None,
    *,
    headers: httpx.Headers | Mapping[str, str] | None = None,
    retry_after: float | None = None,
    transport_error: str | None = None,
) -> float | None:
    """Record per-task HTTP outcome and immediately notify active RateLimiter on HTTP 429."""
    parsed_ra = retry_after if retry_after is not None else (
        parse_retry_after(headers) if status_code == 429 else None
    )
    state = _get_owned_state_dict(create=True)
    assert state is not None
    prev = state.get(source_name)

    # Preserve an earlier 429 within the same lookup across secondary fallback endpoints
    # or RetryError wrappers; if a secondary endpoint actually finds a match, `lookup()`
    # returns `found=True` directly without consulting miss/error telemetry.
    if status_code == 429:
        state[source_name] = (429, parsed_ra, None)
        cb = _RATE_LIMIT_CALLBACK.get()
        if cb is not None:
            try:
                cb(source_name, parsed_ra)
            except Exception:  # noqa: BLE001
                pass
    elif prev is not None and prev[0] == 429:
        pass
    elif status_code == 200:
        state[source_name] = (200, None, None)
    else:
        state[source_name] = (status_code, parsed_ra, transport_error)

    return parsed_ra


def get_task_http_status(
    source_name: str,
) -> tuple[int | None, float | None, str | None]:
    """Return `(status_code, retry_after_seconds, transport_error)` for current Task."""
    state = _get_owned_state_dict(create=False)
    if state is None:
        return None, None, None
    return state.get(source_name, (None, None, None))
