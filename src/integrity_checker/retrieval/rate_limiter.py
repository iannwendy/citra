"""Async-safe & cross-event-loop adaptive AIMD token-bucket rate limiter."""

from __future__ import annotations

import asyncio
import random
import threading
import time


class RateLimiter:
    """Async-safe & cross-event-loop adaptive AIMD rate limiter with Retry-After support.

    Features:
        - Atomic slot reservation across threads & independent event loops
        - Adaptive AIMD (Additive Increase / Multiplicative Decrease): halves effective
          request rate upon HTTP 429 and smoothly ramps back up on HTTP 200 successes
        - Respects exact `Retry-After` / `RateLimit-Reset` durations (float or int)
        - Full jitter to eliminate thundering-herd retry spikes near assignment deadlines
        - Smart fast-fail threshold (`should_fast_fail`): smoothly queues callers across
          short Retry-After windows (`<= 8s`) while fast-skipping on sustained 429 storms
    """

    def __init__(
        self,
        calls_per_second: float = 1.0,
        burst_size: int | None = None,
        *,
        fast_fail_backoff_seconds: float = 8.0,
        fast_fail_failures: int = 3,
    ) -> None:
        if calls_per_second <= 0:
            raise ValueError("calls_per_second phải > 0")
        self._base_calls_per_second = float(calls_per_second)
        self._base_min_interval = 1.0 / float(calls_per_second)
        self._effective_interval = self._base_min_interval
        self._max_effective_interval = max(2.0, min(10.0, self._base_min_interval * 8.0))
        self._burst_size = burst_size
        self._lock = threading.Lock()
        self._last_call = 0.0

        # Backoff & AIMD state
        self._backoff_until: float = 0.0
        self._consecutive_failures: int = 0
        self._base_backoff: float = 2.0  # seconds (2s -> 4s -> 8s -> 16s -> 32s -> 60s)
        self._max_backoff: float = 60.0  # 1 minute max
        self._fast_fail_backoff_seconds = float(fast_fail_backoff_seconds)
        self._fast_fail_failures = int(fast_fail_failures)

    async def wait(self) -> None:
        """Wait until rate limit & any short backoff window allows the next request."""
        with self._lock:
            now = time.monotonic()
            earliest = (
                now
                if self._last_call == 0.0
                else max(now, self._last_call + self._effective_interval)
            )

            # Honor active backoff window and stagger queued callers after _backoff_until
            if now < self._backoff_until:
                wait_time = self._backoff_until - now
                jitter = random.uniform(0.0, min(1.0, wait_time * 0.15))
                earliest = max(earliest, self._backoff_until + jitter)

            sleep_duration = max(0.0, earliest - now)
            self._last_call = earliest

        if sleep_duration > 0:
            await asyncio.sleep(sleep_duration)

    def report_rate_limited(self, retry_after: float | int | None = None) -> None:
        """Record an HTTP 429 event, apply Retry-After / exponential backoff, and halve rate."""
        with self._lock:
            now = time.monotonic()
            self._consecutive_failures += 1

            # Multiplicative Decrease (AIMD): slow down effective rate by 2x to prevent re-triggering 429
            self._effective_interval = min(
                self._max_effective_interval,
                max(self._effective_interval * 2.0, self._base_min_interval * 2.0),
            )

            if retry_after is not None and float(retry_after) > 0:
                ra_val = min(float(retry_after), self._max_backoff)
                jitter = random.uniform(0.0, min(1.5, ra_val * 0.15))
                target_until = now + ra_val + jitter
            else:
                # Exponential backoff: ~2s, 4s, 8s, 16s, 32s, 60s + 0-25% jitter
                backoff = min(
                    self._base_backoff * (2 ** max(0, self._consecutive_failures - 1)),
                    self._max_backoff,
                )
                jitter = random.uniform(0.0, backoff * 0.25)
                target_until = now + backoff + jitter

            self._backoff_until = max(self._backoff_until, target_until)

    def report_success(self) -> None:
        """Record a clean non-429 response — clear backoff and smoothly ramp rate back up."""
        with self._lock:
            self._consecutive_failures = 0
            self._backoff_until = 0.0
            # Additive / smooth recovery back toward base rate
            if self._effective_interval > self._base_min_interval:
                self._effective_interval = max(
                    self._base_min_interval,
                    self._effective_interval * 0.80,
                )

    def is_in_backoff(self) -> bool:
        """Return True when currently inside an active rate-limit backoff window."""
        with self._lock:
            return time.monotonic() < self._backoff_until

    def remaining_backoff(self) -> float:
        """Return remaining backoff seconds (`0.0` if not in backoff)."""
        with self._lock:
            return max(0.0, self._backoff_until - time.monotonic())

    def should_fast_fail(self) -> bool:
        """Return True only when sustained 429 backoff exceeds the queueable window.

        Brief Retry-After windows (`<= fast_fail_backoff_seconds` and `< fast_fail_failures`)
        return False so `await wait()` paces requests cleanly instead of dropping them.
        """
        with self._lock:
            now = time.monotonic()
            if now >= self._backoff_until:
                return False
            remaining = self._backoff_until - now
            return (
                self._consecutive_failures >= self._fast_fail_failures
                or remaining > self._fast_fail_backoff_seconds
            )

    @property
    def effective_calls_per_second(self) -> float:
        """Current AIMD-adjusted throughput in calls/second."""
        with self._lock:
            return 1.0 / self._effective_interval

    @property
    def consecutive_failures(self) -> int:
        """Number of consecutive rate-limit events."""
        with self._lock:
            return self._consecutive_failures
