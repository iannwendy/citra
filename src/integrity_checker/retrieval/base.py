"""Abstract scholarly API client with task-isolated HTTP status & Retry-After telemetry."""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import TYPE_CHECKING

from integrity_checker.models.citation import Citation
from integrity_checker.models.source import SourceCandidate
from integrity_checker.retrieval.http_pool import (
    get_task_http_status,
    record_task_http_status,
    reset_task_http_status,
)

if TYPE_CHECKING:
    import httpx


class BaseScholarClient(ABC):
    """Interface chung cho mọi nguồn truy hồi học thuật.

    Provides task-isolated HTTP telemetry (`_last_status_code`, `_last_retry_after`,
    `_last_transport_error`) backed by `contextvars`, preventing cross-coroutine and
    cross-thread race conditions when singleton clients are shared across concurrent essays.
    """

    name: str = "base"

    def __init__(self, timeout: float = 10.0) -> None:
        self.timeout = timeout

    @property
    def _last_status_code(self) -> int | None:
        return get_task_http_status(self.name)[0]

    @_last_status_code.setter
    def _last_status_code(self, value: int | None) -> None:
        if value is None:
            reset_task_http_status(self.name)
        else:
            record_task_http_status(self.name, int(value))

    @property
    def _last_retry_after(self) -> float | None:
        return get_task_http_status(self.name)[1]

    @property
    def _last_transport_error(self) -> str | None:
        return get_task_http_status(self.name)[2]

    def _reset_http_telemetry(self) -> None:
        """Clear recorded HTTP status / Retry-After / error for the current asyncio Task."""
        reset_task_http_status(self.name)

    def _record_http_response(self, resp: httpx.Response) -> float | None:
        """Record HTTP status + Retry-After header and immediately notify RateLimiter on 429."""
        headers = getattr(resp, "headers", None)
        return record_task_http_status(
            self.name,
            resp.status_code,
            headers=headers,
        )

    def _record_transport_error(self, exc: BaseException) -> None:
        """Record a network/timeout error without clobbering an earlier 429 in the same task."""
        record_task_http_status(
            self.name,
            None,
            transport_error=f"{exc.__class__.__name__}: {exc}",
        )

    def _build_miss_or_error_candidate(
        self,
        label: str,
        query_preview: str,
        *,
        clean_miss_error: str | None = None,
    ) -> SourceCandidate:
        """Build a `found=False` SourceCandidate that never disguises 429/5xx/timeout as 'no results'."""
        status, retry_after, transport_err = get_task_http_status(self.name)
        preview = (query_preview or "")[:60]
        if status == 429:
            ra_note = f" (Retry-After={retry_after:.1f}s)" if retry_after else ""
            return SourceCandidate(
                source_name=self.name,
                found=False,
                error=f"{label}: rate limited (429){ra_note} for '{preview}'",
            )
        if status is not None and status >= 500:
            return SourceCandidate(
                source_name=self.name,
                found=False,
                error=f"{label}: service unavailable ({status}) for '{preview}'",
            )
        if transport_err and status is None:
            return SourceCandidate(
                source_name=self.name,
                found=False,
                error=f"{label}: request failed ({transport_err[:80]}) for '{preview}'",
            )
        return SourceCandidate(
            source_name=self.name,
            found=False,
            error=clean_miss_error or f"{label}: no results for '{preview}'",
        )

    @abstractmethod
    async def lookup(self, citation: Citation) -> SourceCandidate:
        """Tra cứu 1 citation. Trả SourceCandidate với found=True/False."""
        raise NotImplementedError

    async def lookup_many(self, citations: list[Citation]) -> list[SourceCandidate]:
        """Default sequential. Override nếu client hỗ trợ batch."""
        return [await self.lookup(c) for c in citations]
