"""Active HTTP link liveness validator for citation URLs (Phase 3).

Distinguishes between:
- ALIVE (HTTP 200..399)
- RESTRICTED_ALIVE (HTTP 401, 403, 405, 429 — publisher paywall / anti-bot protection)
- DEAD_LINK (HTTP 404, 410, or DNS/connection failure)
- FAKE_DOMAIN (example.com, test.com, localhost, etc.)
- UNCHECKED (no URL provided, or transient timeout)
"""

from __future__ import annotations

import asyncio
import contextvars
import time
from dataclasses import dataclass
from enum import Enum

import httpx

from integrity_checker.logging import get_logger
from integrity_checker.logic.rules import _is_fake_url

logger = get_logger(__name__)

_WAYBACK_SEMS: dict[int, asyncio.Semaphore] = {}
_WAYBACK_LOCKS: dict[int, asyncio.Lock] = {}
_WAYBACK_LAST_AT: dict[int, float] = {}
_WAYBACK_MIN_INTERVAL = 0.25
# Cache confirmed Wayback lookups: url -> (archive_url, archive_timestamp)
_WAYBACK_CACHE: dict[str, tuple[str | None, str | None]] = {}
_WAYBACK_CACHE_MAX = 1024
_LAST_WAYBACK_OK: contextvars.ContextVar[bool] = contextvars.ContextVar(
    "_last_wayback_ok", default=True
)


def _get_wayback_concurrency() -> tuple[asyncio.Semaphore, asyncio.Lock, int]:
    loop_id = id(asyncio.get_running_loop())
    if loop_id not in _WAYBACK_SEMS:
        _WAYBACK_SEMS[loop_id] = asyncio.Semaphore(2)
        _WAYBACK_LOCKS[loop_id] = asyncio.Lock()
    return _WAYBACK_SEMS[loop_id], _WAYBACK_LOCKS[loop_id], loop_id


class LinkStatus(str, Enum):
    """Normalized liveness status for a citation URL."""

    ALIVE = "alive"
    RESTRICTED_ALIVE = "restricted_alive"
    ARCHIVED_ALIVE = "archived_alive"
    DEAD_LINK = "dead_link"
    FAKE_DOMAIN = "fake_domain"
    UNCHECKED = "unchecked"


@dataclass
class LinkCheckResult:
    """Result of validating a single URL."""

    url: str
    status: LinkStatus
    status_code: int | None = None
    final_url: str | None = None
    error: str | None = None
    archive_url: str | None = None
    archive_timestamp: str | None = None

    @property
    def is_valid(self) -> bool:
        """True if the URL resolves to a live, paywall-protected, or Wayback-archived page."""
        return self.status in (
            LinkStatus.ALIVE,
            LinkStatus.RESTRICTED_ALIVE,
            LinkStatus.ARCHIVED_ALIVE,
        )

    @property
    def is_broken(self) -> bool:
        """True if the URL is confirmed dead (404/410/DNS failure with no archive) or a fake domain."""
        return self.status in (LinkStatus.DEAD_LINK, LinkStatus.FAKE_DOMAIN)


class LinkValidator:
    """Asynchronous HTTP link validator with HEAD-then-GET and Wayback Machine fallback."""

    WAYBACK_API_URL = "https://archive.org/wayback/available"
    WAYBACK_CDX_URL = "https://web.archive.org/cdx/search/cdx"
    DEFAULT_HEADERS = {
        "User-Agent": (
            "Mozilla/5.0 (compatible; EssayIntegrityChecker/1.0; "
            "+https://github.com/iannwendy/citra)"
        ),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    }

    def __init__(
        self,
        timeout: float = 5.0,
        enable_wayback_fallback: bool | None = None,
    ) -> None:
        self.timeout = timeout
        if enable_wayback_fallback is None:
            try:
                from integrity_checker.config import get_settings

                enable_wayback_fallback = bool(
                    getattr(get_settings().retrieval.sources, "wayback_fallback", True)
                )
            except Exception:  # noqa: BLE001
                enable_wayback_fallback = True
        self.enable_wayback_fallback = enable_wayback_fallback

    @classmethod
    def clear_wayback_cache(cls) -> None:
        """Clear session-level Wayback Machine lookup cache (primarily for tests)."""
        _WAYBACK_CACHE.clear()

    async def _check_wayback_machine_status(
        self, url: str
    ) -> tuple[str | None, str | None, bool]:
        """Query Internet Archive Wayback Machine with per-loop throttling, cache, and retry.

        Returns:
            ``(archive_url, archive_timestamp, wayback_verified_ok)`` where
            ``wayback_verified_ok=True`` means Wayback definitively answered (either
            snapshot found or HTTP 200 confirming no snapshot), while ``False`` means
            Archive.org itself timed out / rate-limited so link rot could not be ruled out.
        """
        if not self.enable_wayback_fallback or not url:
            return None, None, True
        lower_url = url.lower()
        if ".invalid" in lower_url or "nonexistent" in lower_url or "doi.org/" in lower_url:
            return None, None, True

        cache_key = url.strip()
        if cache_key in _WAYBACK_CACHE:
            cached_url, cached_ts = _WAYBACK_CACHE[cache_key]
            return cached_url, cached_ts, True

        sem, lock, loop_id = _get_wayback_concurrency()
        backoffs = (0.0, 0.35, 0.75)
        last_exc: Exception | None = None

        for attempt, backoff_sec in enumerate(backoffs):
            if backoff_sec > 0:
                await asyncio.sleep(backoff_sec)
            async with sem:
                async with lock:
                    now = time.monotonic()
                    scheduled = max(now, _WAYBACK_LAST_AT.get(loop_id, 0.0) + _WAYBACK_MIN_INTERVAL)
                    _WAYBACK_LAST_AT[loop_id] = scheduled
                    wait_sec = scheduled - now
                if wait_sec > 0:
                    await asyncio.sleep(wait_sec)

                try:
                    async with httpx.AsyncClient(
                        timeout=min(max(self.timeout, 2.0), 4.5),
                        follow_redirects=True,
                        headers={
                            "User-Agent": self.DEFAULT_HEADERS["User-Agent"],
                            "Accept": "application/json",
                        },
                    ) as client:
                        resp = await client.get(self.WAYBACK_API_URL, params={"url": url})
                        if resp.status_code in (429, 500, 502, 503, 504):
                            last_exc = RuntimeError(f"Wayback HTTP {resp.status_code}")
                            continue

                        avail_ok = resp.status_code == 200
                        if avail_ok:
                            data = resp.json()
                            closest = (
                                ((data or {}).get("archived_snapshots") or {}).get("closest") or {}
                            )
                            if (
                                isinstance(closest, dict)
                                and bool(closest.get("available"))
                                and closest.get("url")
                            ):
                                found_url = str(closest["url"])
                                found_ts = str(closest.get("timestamp") or "") or None
                                if len(_WAYBACK_CACHE) >= _WAYBACK_CACHE_MAX:
                                    _WAYBACK_CACHE.pop(next(iter(_WAYBACK_CACHE)))
                                _WAYBACK_CACHE[cache_key] = (found_url, found_ts)
                                return found_url, found_ts, True

                        # Fallback to Wayback CDX API when availability endpoint has lag or empty index
                        cdx_resp = await client.get(
                            self.WAYBACK_CDX_URL,
                            params={
                                "url": url,
                                "output": "json",
                                "limit": "1",
                                "fl": "timestamp,original",
                                "filter": "statuscode:200",
                            },
                        )
                        if cdx_resp.status_code in (429, 500, 502, 503, 504) and not avail_ok:
                            last_exc = RuntimeError(f"Wayback CDX HTTP {cdx_resp.status_code}")
                            continue
                        if cdx_resp.status_code == 200:
                            rows = cdx_resp.json()
                            if (
                                isinstance(rows, list)
                                and len(rows) >= 2
                                and isinstance(rows[1], list)
                                and len(rows[1]) >= 2
                            ):
                                ts = str(rows[1][0]).strip()
                                orig = str(rows[1][1]).strip() or url
                                if ts:
                                    found_url = f"https://web.archive.org/web/{ts}/{orig}"
                                    if len(_WAYBACK_CACHE) >= _WAYBACK_CACHE_MAX:
                                        _WAYBACK_CACHE.pop(next(iter(_WAYBACK_CACHE)))
                                    _WAYBACK_CACHE[cache_key] = (found_url, ts)
                                    return found_url, ts, True

                        if avail_ok or cdx_resp.status_code == 200:
                            if len(_WAYBACK_CACHE) >= _WAYBACK_CACHE_MAX:
                                _WAYBACK_CACHE.pop(next(iter(_WAYBACK_CACHE)))
                            _WAYBACK_CACHE[cache_key] = (None, None)
                            return None, None, True
                except Exception as exc:  # noqa: BLE001
                    last_exc = exc
                    logger.debug(
                        f"Wayback Machine attempt {attempt + 1}/{len(backoffs)} failed for '{url}': {exc}"
                    )

        logger.debug(f"Wayback Machine fallback exhausted for '{url}': {last_exc}")
        return None, None, False

    async def _check_wayback_machine(self, url: str) -> tuple[str | None, str | None]:
        """Backward-compatible wrapper returning ``(archive_url, archive_timestamp)``."""
        wb_url, wb_ts, wb_ok = await self._check_wayback_machine_status(url)
        _LAST_WAYBACK_OK.set(wb_ok)
        return wb_url, wb_ts

    async def validate_url(self, url: str | None) -> LinkCheckResult:
        """Validate whether a citation URL is reachable and alive (or archived on Wayback Machine)."""
        if not url or not str(url).strip():
            return LinkCheckResult(url="", status=LinkStatus.UNCHECKED)

        clean_url = str(url).strip().rstrip(".,;:)\"'")
        is_fake, matched_domain = _is_fake_url(clean_url)
        if is_fake:
            return LinkCheckResult(
                url=clean_url,
                status=LinkStatus.FAKE_DOMAIN,
                error=f"Fake/placeholder domain: {matched_domain}",
            )

        if not clean_url.lower().startswith(("http://", "https://")):
            return LinkCheckResult(url=clean_url, status=LinkStatus.UNCHECKED)

        try:
            async with httpx.AsyncClient(
                timeout=self.timeout,
                follow_redirects=True,
                headers=self.DEFAULT_HEADERS,
            ) as client:
                resp = await client.head(clean_url)
                status_code = resp.status_code
                final_url = str(resp.url)

                # Many academic publishers reject HEAD with 403/404/405; verify via lightweight GET
                if status_code in (403, 404, 405):
                    async with client.stream("GET", clean_url) as get_resp:
                        status_code = get_resp.status_code
                        final_url = str(get_resp.url)

                result = self._classify_status_code(clean_url, status_code, final_url)
                if result.status == LinkStatus.DEAD_LINK:
                    _LAST_WAYBACK_OK.set(True)
                    wb_url, wb_ts = await self._check_wayback_machine(clean_url)
                    wb_ok = _LAST_WAYBACK_OK.get()
                    if wb_url:
                        return LinkCheckResult(
                            url=clean_url,
                            status=LinkStatus.ARCHIVED_ALIVE,
                            status_code=status_code,
                            final_url=final_url,
                            archive_url=wb_url,
                            archive_timestamp=wb_ts,
                        )
                    if not wb_ok:
                        return LinkCheckResult(
                            url=clean_url,
                            status=LinkStatus.UNCHECKED,
                            status_code=status_code,
                            final_url=final_url,
                            error="HTTP 404/410 while Wayback Machine verification timed out or rate-limited",
                        )
                return result

        except httpx.TimeoutException as exc:
            logger.debug(f"LinkValidator timeout for '{clean_url}': {exc}")
            _LAST_WAYBACK_OK.set(True)
            wb_url, wb_ts = await self._check_wayback_machine(clean_url)
            if wb_url:
                return LinkCheckResult(
                    url=clean_url,
                    status=LinkStatus.ARCHIVED_ALIVE,
                    error=f"Live host timed out, recovered via Wayback Machine ({wb_ts or 'archived'})",
                    archive_url=wb_url,
                    archive_timestamp=wb_ts,
                )
            return LinkCheckResult(
                url=clean_url,
                status=LinkStatus.UNCHECKED,
                error=f"Timeout: {exc}",
            )
        except httpx.ConnectError as exc:
            logger.debug(f"LinkValidator connect/DNS error for '{clean_url}': {exc}")
            _LAST_WAYBACK_OK.set(True)
            wb_url, wb_ts = await self._check_wayback_machine(clean_url)
            wb_ok = _LAST_WAYBACK_OK.get()
            if wb_url:
                return LinkCheckResult(
                    url=clean_url,
                    status=LinkStatus.ARCHIVED_ALIVE,
                    error=f"Live host unreachable, recovered via Wayback Machine ({wb_ts or 'archived'})",
                    archive_url=wb_url,
                    archive_timestamp=wb_ts,
                )
            if not wb_ok:
                return LinkCheckResult(
                    url=clean_url,
                    status=LinkStatus.UNCHECKED,
                    error=f"Connection error while Wayback Machine verification unavailable: {exc}",
                )
            return LinkCheckResult(
                url=clean_url,
                status=LinkStatus.DEAD_LINK,
                error=f"Connection/DNS failed: {exc}",
            )
        except httpx.HTTPError as exc:
            logger.debug(f"LinkValidator HTTP error for '{clean_url}': {exc}")
            return LinkCheckResult(
                url=clean_url,
                status=LinkStatus.UNCHECKED,
                error=f"HTTP error: {exc}",
            )

    @staticmethod
    def _classify_status_code(
        url: str,
        status_code: int,
        final_url: str | None = None,
    ) -> LinkCheckResult:
        if 200 <= status_code < 400:
            return LinkCheckResult(
                url=url,
                status=LinkStatus.ALIVE,
                status_code=status_code,
                final_url=final_url,
            )
        if status_code in (401, 403, 405, 429):
            return LinkCheckResult(
                url=url,
                status=LinkStatus.RESTRICTED_ALIVE,
                status_code=status_code,
                final_url=final_url,
            )
        if status_code in (404, 410):
            return LinkCheckResult(
                url=url,
                status=LinkStatus.DEAD_LINK,
                status_code=status_code,
                final_url=final_url,
                error=f"HTTP {status_code}",
            )
        return LinkCheckResult(
            url=url,
            status=LinkStatus.UNCHECKED,
            status_code=status_code,
            final_url=final_url,
        )
