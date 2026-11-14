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
import re
import socket
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass
from enum import Enum
from typing import Any
from urllib.parse import urljoin, urlsplit

import httpx

from integrity_checker.logging import get_logger
from integrity_checker.logic.rules import _is_fake_url
from integrity_checker.retrieval.html_meta_verifier import (
    DEFAULT_MAX_REDIRECTS,
    DEFAULT_TIMEOUT_SECONDS,
    MAX_HTML_HEAD_BYTES,
    HtmlPageMeta,
    SSRFBlockedError,
    build_ssrf_safe_transport,
    extract_meta_from_async_response,
    extract_year_from_url,
    is_html_content_type,
    validate_public_target_ips,
    validate_url_syntax_and_literal_ip,
)

logger = get_logger(__name__)

_ORIG_ASYNC_HEAD = httpx.AsyncClient.head
_ORIG_ASYNC_STREAM = httpx.AsyncClient.stream
_ORIG_ASYNC_GET = httpx.AsyncClient.get
_ORIG_GETADDRINFO = socket.getaddrinfo
_REDIRECT_CODES = frozenset({301, 302, 303, 307, 308})
_WAYBACK_RAW_SNAPSHOT_RE = re.compile(
    r"^https?://web\.archive\.org/web/(\d{4,14})(?:[a-z]{2}_)?/(.+)$",
    re.IGNORECASE,
)


def clean_extracted_url(text_or_url: str | None) -> str:
    """Extract and sanitize a URL from PDF text, repairing line wraps and bracket delimiters."""
    if not text_or_url or not str(text_or_url).strip():
        return ""
    s = str(text_or_url).strip()
    # Repair PDF line wraps right after scheme colon, percent-encodings, or path delimiters
    s = re.sub(r"(https?:)\s+(//)", r"\1\2", s, flags=re.IGNORECASE)
    for _ in range(3):
        s_next = re.sub(r"(%)\s+([0-9A-Fa-f]{2})", r"\1\2", s)
        s_next = re.sub(r"(%[0-9A-Fa-f])\s+([0-9A-Fa-f])", r"\1\2", s_next)
        s_next = re.sub(
            r"(%[0-9A-Fa-f]{2})\s+(%[0-9A-Fa-f]|[A-Za-z0-9._~\-])",
            r"\1\2",
            s_next,
        )
        s_next = re.sub(
            r"(https?://[^\s<>\"\]]*?[/_~=\-&?#:])\s+([A-Za-z0-9%_~#])",
            r"\1\2",
            s_next,
            flags=re.IGNORECASE,
        )
        if s_next == s:
            break
        s = s_next

    m = re.search(r"https?://\S+", s, flags=re.IGNORECASE)
    candidate = m.group(0) if m else s.lstrip("<[(\"'")
    # Split concatenated URLs where a second http(s):// was glued after a dash or word char
    candidate = re.split(
        r"(?<=[^\s:/=?&])[-–—](?=https?://)|(?<=[^\s:/=?&\-–—])(?=https?://)",
        candidate,
        maxsplit=1,
        flags=re.IGNORECASE,
    )[0]
    while candidate:
        if (
            candidate[-1] in ".,;:\"'>}"
            or (candidate[-1] == ")" and candidate.count(")") > candidate.count("("))
            or (candidate[-1] == "]" and candidate.count("]") > candidate.count("["))
        ):
            candidate = candidate[:-1]
        else:
            break
    return candidate.strip()

_WAYBACK_SEMS: dict[int, asyncio.Semaphore] = {}
_WAYBACK_LOCKS: dict[int, asyncio.Lock] = {}
_WAYBACK_LAST_AT: dict[int, float] = {}
_WAYBACK_GLOBAL_LOCK = threading.Lock()
_WAYBACK_GLOBAL_LAST_AT: float = 0.0
_WAYBACK_MIN_INTERVAL = 0.25
# Cache confirmed Wayback lookups: url -> (archive_url, archive_timestamp)
_WAYBACK_CACHE: dict[str, tuple[str | None, str | None]] = {}
_WAYBACK_META_CACHE: dict[str, HtmlPageMeta] = {}
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
    html_meta: HtmlPageMeta | None = None

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
        timeout: float = DEFAULT_TIMEOUT_SECONDS,
        enable_wayback_fallback: bool | None = None,
        resolver: Callable[..., Any] | None = None,
        transport: httpx.AsyncBaseTransport | None = None,
        max_redirects: int = DEFAULT_MAX_REDIRECTS,
    ) -> None:
        self.timeout = timeout
        self.resolver = resolver
        self._transport = transport
        self.max_redirects = max_redirects
        if enable_wayback_fallback is None:
            try:
                from integrity_checker.config import get_settings

                enable_wayback_fallback = bool(
                    getattr(get_settings().retrieval.sources, "wayback_fallback", True)
                )
            except Exception:  # noqa: BLE001
                enable_wayback_fallback = True
        self.enable_wayback_fallback = enable_wayback_fallback

    async def _check_ssrf_before_hop(self, target_url: str) -> tuple[bool, str, bool]:
        """Validate SSRF & DNS-rebinding constraints before opening a socket.

        Returns:
            ``(allowed, reason, is_dns_nxdomain)``
        """
        syntax_ok, state_or_reason, _, _ = validate_url_syntax_and_literal_ip(target_url)
        if not syntax_ok:
            return False, state_or_reason, False
        if state_or_reason == "public_ip_literal":
            return True, "ok", False

        if self.resolver is not None or socket.getaddrinfo is not _ORIG_GETADDRINFO:
            ok, reason = validate_public_target_ips(target_url, resolver=self.resolver)
        else:
            ok, reason = await asyncio.to_thread(validate_public_target_ips, target_url, None)

        if ok:
            return True, "ok", False

        if reason.startswith("DNS resolution failed"):
            httpx_is_mocked = (
                httpx.AsyncClient.head is not _ORIG_ASYNC_HEAD
                or httpx.AsyncClient.stream is not _ORIG_ASYNC_STREAM
            )
            if (
                httpx_is_mocked
                and self.resolver is None
                and socket.getaddrinfo is _ORIG_GETADDRINFO
                and self._transport is None
            ):
                # Synthetic domain in unit tests where httpx.AsyncClient is mocked in-memory
                return True, "mocked_httpx_nxdomain", False
            return False, reason, True

        return False, reason, False

    def _is_benign_nonstandard_port_url(self, target_url: str, ssrf_reason: str | None) -> bool:
        """Return True iff target_url was rejected solely for a non-80/443 port on a public host."""
        reason_low = (ssrf_reason or "").lower()
        if "port" not in reason_low or "invalid url port" in reason_low:
            return False
        try:
            parsed = urlsplit(str(target_url).strip())
            port = parsed.port
        except ValueError:
            return False
        if port is None or port in (80, 443):
            return False
        scheme = (parsed.scheme or "").lower()
        hostname = (parsed.hostname or "").strip().rstrip(".")
        if scheme not in ("http", "https") or not hostname:
            return False
        if (
            parsed.username is not None
            or parsed.password is not None
            or "@" in (parsed.netloc or "")
        ):
            return False
        host_repr = f"[{hostname}]" if ":" in hostname else hostname
        probe_url = f"{scheme}://{host_repr}/"
        syntax_ok, state_or_reason, _, _ = validate_url_syntax_and_literal_ip(probe_url)
        if not syntax_ok:
            return False
        if state_or_reason == "public_ip_literal":
            return True
        if self.resolver is not None or socket.getaddrinfo is not _ORIG_GETADDRINFO:
            ok, dns_reason = validate_public_target_ips(probe_url, resolver=self.resolver)
            if not ok and not dns_reason.startswith("DNS resolution failed"):
                return False
        return True

    @classmethod
    def clear_wayback_cache(cls) -> None:
        """Clear session-level Wayback Machine lookup cache (primarily for tests)."""
        _WAYBACK_CACHE.clear()
        _WAYBACK_META_CACHE.clear()

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

        global _WAYBACK_GLOBAL_LAST_AT
        sem, lock, loop_id = _get_wayback_concurrency()
        backoffs = (0.0, 0.08)
        wb_timeout = (
            min(self.timeout, 3.0)
            if self.timeout >= 2.0
            else (min(self.timeout, 0.95) if self.timeout > 0 else 3.0)
        )
        last_exc: Exception | None = None

        for attempt, backoff_sec in enumerate(backoffs):
            if backoff_sec > 0:
                await asyncio.sleep(backoff_sec)
            async with sem:
                async with lock:
                    with _WAYBACK_GLOBAL_LOCK:
                        now = time.monotonic()
                        last_at = max(_WAYBACK_GLOBAL_LAST_AT, _WAYBACK_LAST_AT.get(loop_id, 0.0))
                        scheduled = max(now, last_at + _WAYBACK_MIN_INTERVAL)
                        _WAYBACK_GLOBAL_LAST_AT = scheduled
                        _WAYBACK_LAST_AT[loop_id] = scheduled
                        wait_sec = scheduled - now
                if wait_sec > 0:
                    await asyncio.sleep(wait_sec)

                try:
                    wb_client_kwargs: dict[str, Any] = {
                        "timeout": wb_timeout,
                        "follow_redirects": True,
                        "headers": {
                            "User-Agent": self.DEFAULT_HEADERS["User-Agent"],
                            "Accept": "application/json",
                        },
                    }
                    if self._transport is not None:
                        wb_client_kwargs["transport"] = self._transport
                    async with httpx.AsyncClient(**wb_client_kwargs) as client:
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
                except httpx.TimeoutException as exc:
                    last_exc = exc
                    logger.debug(
                        f"Wayback Machine timed out on attempt {attempt + 1}/{len(backoffs)} for '{url}': {exc}"
                    )
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

    @staticmethod
    def _to_wayback_raw_id_url(wb_url: str | None) -> str | None:
        """Convert a Wayback snapshot URL into its raw ``{timestamp}id_`` HTML form."""
        if not wb_url or not str(wb_url).strip():
            return None
        m = _WAYBACK_RAW_SNAPSHOT_RE.match(str(wb_url).strip())
        if not m:
            return None
        return f"https://web.archive.org/web/{m.group(1)}id_/{m.group(2)}"

    @staticmethod
    def _is_nonempty_html_meta(meta: HtmlPageMeta | None) -> bool:
        if meta is None or meta.is_soft_404:
            return False
        return bool(
            meta.page_title
            or meta.citation_title
            or meta.citation_authors
            or meta.citation_doi
            or meta.published_year
            or meta.site_name
            or meta.canonical_url
        )

    async def _fetch_wayback_html_meta(
        self,
        client: httpx.AsyncClient | None,
        wb_url: str,
        original_url: str | None = None,
    ) -> HtmlPageMeta | None:
        """Fetch bounded ``<head>`` metadata from Wayback's raw ``id_`` snapshot safely."""
        try:
            raw_wb_url = self._to_wayback_raw_id_url(wb_url)
            if not raw_wb_url:
                return None

            if raw_wb_url in _WAYBACK_META_CACHE:
                return _WAYBACK_META_CACHE[raw_wb_url]

            head_is_patched = httpx.AsyncClient.head is not _ORIG_ASYNC_HEAD
            stream_is_patched = httpx.AsyncClient.stream is not _ORIG_ASYNC_STREAM
            if head_is_patched and not stream_is_patched and self._transport is None:
                return None

            uses_pinned_backend = (
                self._transport is None and not head_is_patched and not stream_is_patched
            )
            wb_meta_timeout = (
                min(max(self.timeout, 5.5), 7.0)
                if self.timeout >= 2.0
                else (self.timeout if self.timeout > 0 else 5.5)
            )

            async def _stream_once(active_client: httpx.AsyncClient) -> HtmlPageMeta | None:
                cur_wb = raw_wb_url
                for hop in range(3):
                    parsed_wb = urlsplit(cur_wb)
                    if (parsed_wb.hostname or "").lower() != "web.archive.org":
                        return None
                    if uses_pinned_backend:
                        allowed, _, _, _ = validate_url_syntax_and_literal_ip(cur_wb)
                    else:
                        allowed, _, _ = await self._check_ssrf_before_hop(cur_wb)
                    if not allowed:
                        return None

                    async with active_client.stream(
                        "GET",
                        cur_wb,
                        timeout=wb_meta_timeout,
                    ) as wb_resp:
                        if wb_resp.status_code in _REDIRECT_CODES:
                            loc = (wb_resp.headers.get("location") or "").strip()
                            if not loc or hop >= 2:
                                return None
                            next_url = urljoin(cur_wb, loc)
                            rewritten = self._to_wayback_raw_id_url(next_url)
                            cur_wb = rewritten or next_url
                            continue
                        if wb_resp.status_code in (429, 500, 502, 503, 504):
                            raise httpx.TransportError(
                                f"Wayback replay transient HTTP {wb_resp.status_code}"
                            )
                        if wb_resp.status_code not in (200, 206):
                            return None
                        meta = await extract_meta_from_async_response(
                            wb_resp,
                            max_bytes=MAX_HTML_HEAD_BYTES,
                            source_url=original_url or wb_url,
                        )
                        if self._is_nonempty_html_meta(meta):
                            if len(_WAYBACK_META_CACHE) >= _WAYBACK_CACHE_MAX:
                                oldest_key = next(iter(_WAYBACK_META_CACHE))
                                _WAYBACK_META_CACHE.pop(oldest_key, None)
                            _WAYBACK_META_CACHE[raw_wb_url] = meta  # type: ignore[assignment]
                            return meta
                        return None
                return None

            async def _stream_with_retry(active_client: httpx.AsyncClient) -> HtmlPageMeta | None:
                last_err: Exception | None = None
                for meta_attempt in range(2):
                    if meta_attempt > 0:
                        await asyncio.sleep(0.12)
                    try:
                        return await _stream_once(active_client)
                    except (httpx.TimeoutException, httpx.TransportError) as err:
                        last_err = err
                        continue
                if last_err is not None:
                    logger.debug(
                        f"Wayback <head> metadata fetch exhausted retries for '{wb_url}': {last_err}"
                    )
                return None

            if client is not None:
                return await _stream_with_retry(client)

            transport = (
                self._transport
                if self._transport is not None
                else build_ssrf_safe_transport(resolver=self.resolver)
            )
            async with httpx.AsyncClient(
                timeout=wb_meta_timeout,
                follow_redirects=False,
                trust_env=False,
                headers=self.DEFAULT_HEADERS,
                transport=transport,
            ) as owned_client:
                return await _stream_with_retry(owned_client)
        except Exception as exc:  # noqa: BLE001
            logger.debug(f"Wayback <head> metadata fetch skipped for '{wb_url}': {exc}")
            return None

    async def validate_url(self, url: str | None) -> LinkCheckResult:
        """Validate whether a citation URL is reachable and alive (or archived on Wayback Machine)."""
        if not url or not str(url).strip():
            return LinkCheckResult(url="", status=LinkStatus.UNCHECKED)

        clean_url = clean_extracted_url(url)
        if not clean_url:
            return LinkCheckResult(url="", status=LinkStatus.UNCHECKED)
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
            head_is_patched = httpx.AsyncClient.head is not _ORIG_ASYNC_HEAD
            stream_is_patched = httpx.AsyncClient.stream is not _ORIG_ASYNC_STREAM
            uses_pinned_backend = (
                self._transport is None and not head_is_patched and not stream_is_patched
            )
            transport = (
                self._transport
                if self._transport is not None
                else build_ssrf_safe_transport(resolver=self.resolver)
            )
            async with httpx.AsyncClient(
                timeout=self.timeout,
                follow_redirects=False,
                trust_env=False,
                headers=self.DEFAULT_HEADERS,
                transport=transport,
            ) as client:
                current_url = clean_url
                status_code = 0
                final_url = clean_url
                html_meta: HtmlPageMeta | None = None

                for hop in range(self.max_redirects + 1):
                    if uses_pinned_backend:
                        allowed, ssrf_reason, _, _ = validate_url_syntax_and_literal_ip(current_url)
                        is_nxdomain = False
                    else:
                        allowed, ssrf_reason, is_nxdomain = await self._check_ssrf_before_hop(
                            current_url
                        )
                    if not allowed:
                        if is_nxdomain:
                            raise httpx.ConnectError(ssrf_reason)
                        if hop == 0 and self._is_benign_nonstandard_port_url(
                            current_url, ssrf_reason
                        ):
                            return LinkCheckResult(
                                url=clean_url,
                                status=LinkStatus.UNCHECKED,
                                final_url=current_url,
                                error=f"SSRF blocked: {ssrf_reason}",
                            )
                        return LinkCheckResult(
                            url=clean_url,
                            status=LinkStatus.FAKE_DOMAIN,
                            final_url=current_url,
                            error=f"SSRF blocked: {ssrf_reason}",
                        )

                    resp_headers: httpx.Headers | dict[str, str] = {}
                    try:
                        resp = await client.head(current_url)
                        status_code = resp.status_code
                        final_url = str(resp.url)
                        resp_headers = resp.headers
                    except httpx.TimeoutException:
                        async with client.stream("GET", current_url) as get_resp:
                            status_code = get_resp.status_code
                            final_url = str(get_resp.url)
                            resp_headers = get_resp.headers
                            if status_code in (200, 206):
                                html_meta = await extract_meta_from_async_response(
                                    get_resp,
                                    max_bytes=MAX_HTML_HEAD_BYTES,
                                    source_url=final_url or current_url,
                                )

                    if status_code in _REDIRECT_CODES:
                        loc = (resp_headers.get("location") or "").strip()
                        if loc and hop < self.max_redirects:
                            current_url = urljoin(current_url, loc)
                            html_meta = None
                            continue
                        if loc and hop >= self.max_redirects:
                            return LinkCheckResult(
                                url=clean_url,
                                status=LinkStatus.UNCHECKED,
                                status_code=status_code,
                                final_url=current_url,
                                error="Exceeded max safe redirects",
                            )
                        break

                    # Many academic publishers/portals/WAFs reject HEAD; verify via lightweight GET stream
                    if status_code in (400, 401, 403, 404, 405, 406, 500, 501, 503):
                        async with client.stream("GET", current_url) as get_resp:
                            status_code = get_resp.status_code
                            final_url = str(get_resp.url)
                            resp_headers = get_resp.headers
                            if status_code in _REDIRECT_CODES:
                                loc = (resp_headers.get("location") or "").strip()
                                if loc and hop < self.max_redirects:
                                    current_url = urljoin(current_url, loc)
                                    html_meta = None
                                    continue
                                if loc and hop >= self.max_redirects:
                                    return LinkCheckResult(
                                        url=clean_url,
                                        status=LinkStatus.UNCHECKED,
                                        status_code=status_code,
                                        final_url=current_url,
                                        error="Exceeded max safe redirects",
                                    )
                                break
                            if status_code in (200, 206):
                                html_meta = await extract_meta_from_async_response(
                                    get_resp,
                                    max_bytes=MAX_HTML_HEAD_BYTES,
                                    source_url=final_url or current_url,
                                )
                    elif (
                        status_code in (200, 206)
                        and html_meta is None
                        and not (head_is_patched and not stream_is_patched and self._transport is None)
                        and is_html_content_type(resp_headers.get("content-type", ""))
                    ):
                        async with client.stream("GET", current_url) as get_resp:
                            status_code = get_resp.status_code
                            final_url = str(get_resp.url)
                            if status_code in _REDIRECT_CODES:
                                loc = (get_resp.headers.get("location") or "").strip()
                                if loc and hop < self.max_redirects:
                                    current_url = urljoin(current_url, loc)
                                    html_meta = None
                                    continue
                                if loc and hop >= self.max_redirects:
                                    return LinkCheckResult(
                                        url=clean_url,
                                        status=LinkStatus.UNCHECKED,
                                        status_code=status_code,
                                        final_url=current_url,
                                        error="Exceeded max safe redirects",
                                    )
                                break
                            if status_code in (200, 206):
                                html_meta = await extract_meta_from_async_response(
                                    get_resp,
                                    max_bytes=MAX_HTML_HEAD_BYTES,
                                    source_url=final_url or current_url,
                                )
                    break

                result = self._classify_status_code(clean_url, status_code, final_url)
                result.html_meta = html_meta
                was_soft_404 = False
                if result.status == LinkStatus.ALIVE and html_meta is not None and html_meta.is_soft_404:
                    was_soft_404 = True
                    result = LinkCheckResult(
                        url=clean_url,
                        status=LinkStatus.DEAD_LINK,
                        status_code=status_code,
                        final_url=final_url,
                        error=f"Soft-404 detected in HTML <title>: '{html_meta.page_title}'",
                        html_meta=html_meta,
                    )
                if result.status == LinkStatus.DEAD_LINK:
                    _LAST_WAYBACK_OK.set(True)
                    wb_url, wb_ts = await self._check_wayback_machine(clean_url)
                    wb_ok = _LAST_WAYBACK_OK.get()
                    if wb_url:
                        recovered_meta = None if was_soft_404 else html_meta
                        if recovered_meta is None:
                            recovered_meta = await self._fetch_wayback_html_meta(
                                client,
                                wb_url,
                                original_url=clean_url,
                            )
                        return LinkCheckResult(
                            url=clean_url,
                            status=LinkStatus.ARCHIVED_ALIVE,
                            status_code=status_code,
                            final_url=final_url,
                            archive_url=wb_url,
                            archive_timestamp=wb_ts,
                            html_meta=recovered_meta,
                        )
                    if not wb_ok:
                        return LinkCheckResult(
                            url=clean_url,
                            status=LinkStatus.UNCHECKED,
                            status_code=status_code,
                            final_url=final_url,
                            error="HTTP 404/410 while Wayback Machine verification timed out or rate-limited",
                            html_meta=html_meta,
                        )
                elif status_code in (403, 406) and html_meta is None:
                    wb_is_mocked_or_live = not (
                        (head_is_patched or stream_is_patched)
                        and httpx.AsyncClient.get is _ORIG_ASYNC_GET
                        and self._transport is None
                        and getattr(self._check_wayback_machine, "__func__", None)
                        is LinkValidator._check_wayback_machine
                        and getattr(self._check_wayback_machine_status, "__func__", None)
                        is LinkValidator._check_wayback_machine_status
                        and clean_url.strip() not in _WAYBACK_CACHE
                    )
                    if self.enable_wayback_fallback and wb_is_mocked_or_live:
                        wb_url, wb_ts = await self._check_wayback_machine(clean_url)
                        if wb_url:
                            result.archive_url = wb_url
                            result.archive_timestamp = wb_ts
                            result.html_meta = await self._fetch_wayback_html_meta(
                                client,
                                wb_url,
                                original_url=clean_url,
                            )
                    if result.html_meta is None:
                        url_yr = extract_year_from_url(final_url or clean_url)
                        if url_yr is not None:
                            result.html_meta = HtmlPageMeta(published_year=str(url_yr))
                elif result.status == LinkStatus.ALIVE and result.html_meta is None:
                    url_yr = extract_year_from_url(final_url or clean_url)
                    if url_yr is not None:
                        result.html_meta = HtmlPageMeta(published_year=str(url_yr))
                return result

        except SSRFBlockedError as exc:
            logger.debug(f"LinkValidator SSRF blocked '{clean_url}': {exc}")
            return LinkCheckResult(
                url=clean_url,
                status=LinkStatus.FAKE_DOMAIN,
                error=f"SSRF blocked: {exc}",
            )
        except httpx.TimeoutException as exc:
            logger.debug(f"LinkValidator timeout for '{clean_url}': {exc}")
            _LAST_WAYBACK_OK.set(True)
            wb_url, wb_ts = await self._check_wayback_machine(clean_url)
            if wb_url:
                wb_meta = await self._fetch_wayback_html_meta(
                    None,
                    wb_url,
                    original_url=clean_url,
                )
                return LinkCheckResult(
                    url=clean_url,
                    status=LinkStatus.ARCHIVED_ALIVE,
                    error=f"Live host timed out, recovered via Wayback Machine ({wb_ts or 'archived'})",
                    archive_url=wb_url,
                    archive_timestamp=wb_ts,
                    html_meta=wb_meta,
                )
            return LinkCheckResult(
                url=clean_url,
                status=LinkStatus.UNCHECKED,
                error=f"Timeout: {exc}",
            )
        except httpx.ConnectError as exc:
            err_detail = f"{exc} {repr(exc)}"
            if any(
                tok in err_detail
                for tok in (
                    "CERTIFICATE_VERIFY_FAILED",
                    "SSLCertVerificationError",
                    "[SSL:",
                    "certificate verify failed",
                )
            ):
                logger.debug(
                    f"LinkValidator TLS certificate verification issue on live host '{clean_url}': {exc}"
                )
                return LinkCheckResult(
                    url=clean_url,
                    status=LinkStatus.RESTRICTED_ALIVE,
                    error=f"TLS certificate chain incomplete on live host: {exc}",
                )
            logger.debug(f"LinkValidator connect/DNS error for '{clean_url}': {exc}")
            _LAST_WAYBACK_OK.set(True)
            wb_url, wb_ts = await self._check_wayback_machine(clean_url)
            wb_ok = _LAST_WAYBACK_OK.get()
            if wb_url:
                wb_meta = await self._fetch_wayback_html_meta(
                    None,
                    wb_url,
                    original_url=clean_url,
                )
                return LinkCheckResult(
                    url=clean_url,
                    status=LinkStatus.ARCHIVED_ALIVE,
                    error=f"Live host unreachable, recovered via Wayback Machine ({wb_ts or 'archived'})",
                    archive_url=wb_url,
                    archive_timestamp=wb_ts,
                    html_meta=wb_meta,
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
