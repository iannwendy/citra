"""SSRF-safe bounded HTML <head> metadata verifier (Subsystem A2).

Security & resource invariants:
1. Strict pre-socket SSRF & DNS-rebinding defense:
   - Only ``http`` and ``https`` schemes, ports ``80`` and ``443`` (or default ``None``),
     non-empty hostname, and zero embedded credentials.
   - Resolves all A/AAAA records before opening any socket and verifies EVERY IPv4/IPv6
     address (including IPv4-mapped IPv6 ``::ffff:x.x.x.x``, 6to4, Teredo, NAT64, and CGNAT
     ``100.64.0.0/10``) is strictly globally routable.
   - Disables automatic redirects (``follow_redirects=False``) and re-validates every
     redirect ``Location`` target (up to ``max_redirects=3``) before following.
2. Bounded streaming (``MAX_HTML_HEAD_BYTES = 65536``):
   - Streams HTML chunks up to ``64 KB`` or ``</head>``/``<body>``, closing the stream
     immediately so infinite or multi-megabyte responses never consume memory.
"""

from __future__ import annotations

import asyncio
import codecs
import html
import ipaddress
import re
import socket
import unicodedata
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from html.parser import HTMLParser
from typing import Any
from urllib.parse import urljoin, urlsplit

import httpcore
import httpx

from integrity_checker.logging import get_logger
from integrity_checker.retrieval.normalization import normalize_doi, normalize_text

logger = get_logger(__name__)

MAX_HTML_HEAD_BYTES = 65_536
DEFAULT_MAX_REDIRECTS = 3
DEFAULT_TIMEOUT_SECONDS = 4.0

_CGNAT_NET = ipaddress.ip_network("100.64.0.0/10")
_BENCHMARK_NET = ipaddress.ip_network("198.18.0.0/15")
_NAT64_NETS = (
    ipaddress.ip_network("64:ff9b::/96"),
    ipaddress.ip_network("64:ff9b:1::/48"),
)

_REDIRECT_STATUS_CODES = frozenset({301, 302, 303, 307, 308})
_HTML_CONTENT_TYPES = frozenset({"text/html", "application/xhtml+xml"})
_VALID_DOI_RE = re.compile(r"^10\.\d{4,9}/\S+$", re.IGNORECASE)
_YEAR_4_RE = re.compile(r"\b((?:19|20)\d{2})\b")
_CHARSET_RE = re.compile(r"charset\s*=\s*['\"]?([A-Za-z0-9._-]+)", re.IGNORECASE)
_IPV4_ALT_LABEL_RE = re.compile(r"^(?:\d+|0x[0-9a-f]+)$", re.IGNORECASE)
_CANONICAL_DEC_OCTET_RE = re.compile(r"^(?:0|[1-9]\d{0,2})$")
_ORIG_SOCKET_GETADDRINFO = socket.getaddrinfo
_ORIG_ASYNC_CLIENT_STREAM = httpx.AsyncClient.stream

# Soft-404 title detection: matches true 404/not-found titles while avoiding false positives
# on technical articles *about* HTTP 404 (e.g. "Understanding HTTP 404 Errors in REST APIs")
# or clinical cohorts starting with 404 (e.g. "404 Patients With Type 2 Diabetes").
_SOFT_404_PREFIX_RE = re.compile(
    r"^(?:"
    r"404(?:\s*$|\s*[-–—:|•/]\s*|\s+(?:not\s+found|page\s+not\s+found|file\s+not\s+found|error\b|lỗi\b|không\s+tìm\s+thấy))"
    r"|http\s+404(?:\s*$|\s*[-–—:|•/]\s*|\s+not\s+found\b|\s+error\b)"
    r"|error\s+404\b"
    r"|lỗi\s+404\b"
    r"|404\s+not\s+found\b"
    r"|page\s+not\s+found\b"
    r"|file\s+not\s+found\b"
    r"|document\s+not\s+found\b"
    r"|article\s+not\s+found\b"
    r"|không\s+tìm\s+thấy\s+(?:trang|nội\s+dung|bài\s+viết|tài\s+liệu)\b"
    r"|trang\s+(?:bạn\s+(?:tìm|truy\s+cập)\s+)?không\s+tồn\s+tại\b"
    r")",
    re.IGNORECASE,
)

_SOFT_404_EXACT_SEGMENT_RE = re.compile(
    r"^(?:"
    r"404|404\s+not\s+found|404\s+page\s+not\s+found|page\s+not\s+found"
    r"|error\s+404|lỗi\s+404|file\s+not\s+found"
    r"|không\s+tìm\s+thấy\s+trang|trang\s+không\s+tồn\s+tại"
    r")$",
    re.IGNORECASE,
)

_GATEKEEPER_TITLE_RE = re.compile(
    r"(?:"
    r"^(?:sign\s*in|log\s*in|authenticate|authentication\s+required|login|signin)\b"
    r"|\bjust\s+a\s+moment\b"
    r"|\battention\s+required\b"
    r"|\bcloudflare\b"
    r"|\bddos[- ]guard\b"
    r"|\baccess\s+denied\b"
    r"|\b(?:403\s+)?forbidden\b"
    r"|\b(?:401\s+)?unauthorized\b"
    r"|\bverify\s+you\s+are\s+human\b"
    r"|\bsecurity\s+check\b"
    r"|\bbot\s+verification\b"
    r"|\bcaptcha\b"
    r"|\bredirecting\b"
    r"|\bplease\s+wait\b"
    r"|\benable\s+javascript\b"
    r"|\bjavascript\s+is\s+required\b"
    r"|\bcookies?\s+(?:disabled|required)\b"
    r"|\bservice\s+unavailable\b"
    r"|\brate\s+limit(?:ed)?\b"
    r"|\bđăng\s+nhập\b"
    r")",
    re.IGNORECASE,
)

_TITLE_STOPWORDS = frozenset({
    "the", "of", "in", "and", "for", "to", "on", "with", "at", "by", "from", "an", "as",
    "is", "are", "be", "or", "into", "over", "via",
    "cua", "cho", "va", "cac", "trong", "voi", "tren", "ve", "tu", "mot", "nhung", "la",
    "của", "và", "các", "với", "trên", "về", "từ", "một", "những", "là", "được", "duoc",
})


class SSRFBlockedError(ValueError):
    """Raised when a URL target fails pre-socket SSRF or DNS-rebinding checks."""


@dataclass
class HtmlPageMeta:
    """Extracted bounded metadata from an HTML document's ``<head>`` section."""

    page_title: str | None = None
    citation_title: str | None = None
    citation_authors: list[str] = field(default_factory=list)
    citation_doi: str | None = None
    published_year: str | None = None
    is_soft_404: bool = False


def _is_strictly_public_ip_obj(
    ip: ipaddress.IPv4Address | ipaddress.IPv6Address,
) -> tuple[bool, str]:
    """Verify an IPv4 or IPv6 address (and any embedded tunnel/mapped IPv4) is globally routable."""
    if isinstance(ip, ipaddress.IPv6Address):
        if ip.ipv4_mapped is not None:
            ok, reason = _is_strictly_public_ip_obj(ip.ipv4_mapped)
            if not ok:
                return False, f"IPv4-mapped IPv6 ({ip} -> {ip.ipv4_mapped}): {reason}"
            return True, "ok"
        if ip.sixtofour is not None:
            ok, reason = _is_strictly_public_ip_obj(ip.sixtofour)
            if not ok:
                return False, f"6to4 IPv6 ({ip} -> {ip.sixtofour}): {reason}"
        if ip.teredo is not None:
            for embedded in ip.teredo:
                ok, reason = _is_strictly_public_ip_obj(embedded)
                if not ok:
                    return False, f"Teredo IPv6 ({ip} -> {embedded}): {reason}"
        if any(ip in net for net in _NAT64_NETS):
            return False, f"NAT64 translation address not permitted ({ip})"

    if ip.is_loopback:
        return False, f"loopback address ({ip})"
    if ip.is_link_local:
        return False, f"link-local / cloud metadata address ({ip})"
    if ip.is_private:
        return False, f"private network address ({ip})"
    if ip.is_multicast:
        return False, f"multicast address ({ip})"
    if ip.is_reserved:
        return False, f"reserved address ({ip})"
    if ip.is_unspecified:
        return False, f"unspecified address ({ip})"
    if isinstance(ip, ipaddress.IPv4Address):
        if ip in _CGNAT_NET:
            return False, f"carrier-grade NAT address ({ip})"
        if ip in _BENCHMARK_NET:
            return False, f"benchmarking network address ({ip})"
    if not ip.is_global:
        return False, f"non-global address ({ip})"
    return True, "ok"


def validate_url_syntax_and_literal_ip(url: str) -> tuple[bool, str, str, int]:
    """Validate URL scheme, credentials, port, hostname, and IP-literal SSRF constraints.

    Returns:
        ``(is_allowed, status_or_reason, hostname, effective_port)`` where ``status_or_reason``
        is ``"public_ip_literal"`` when the host is already a verified public IP literal,
        ``"needs_dns"`` when DNS resolution is still required, or the rejection reason.
    """
    if not url or not str(url).strip():
        return False, "Empty URL", "", 0

    raw = str(url).strip()
    try:
        parsed = urlsplit(raw)
    except ValueError as exc:
        return False, f"Malformed URL: {exc}", "", 0

    scheme = (parsed.scheme or "").lower()
    if scheme not in ("http", "https"):
        return False, f"Disallowed URL scheme '{scheme or '<empty>'}' (only http/https permitted)", "", 0

    if parsed.username is not None or parsed.password is not None or "@" in (parsed.netloc or ""):
        return False, "Embedded URL credentials are not permitted", "", 0

    try:
        port = parsed.port
    except ValueError:
        return False, "Invalid URL port", "", 0

    if port not in (None, 80, 443):
        return False, f"Disallowed port {port} (only 80 and 443 permitted)", "", 0

    effective_port = port if port is not None else (443 if scheme == "https" else 80)
    hostname = (parsed.hostname or "").strip().rstrip(".")
    if not hostname:
        return False, "Missing URL hostname", "", effective_port

    if "%" in hostname:
        return False, "IPv6 zone identifiers are not permitted", hostname, effective_port

    host_low = hostname.lower()
    if host_low == "localhost" or host_low.endswith((".localhost", ".local", ".internal")):
        return False, f"Disallowed local hostname '{hostname}'", hostname, effective_port

    if ":" in hostname:
        try:
            ip_obj = ipaddress.IPv6Address(hostname)
        except ValueError:
            return False, f"Invalid or obfuscated IPv6 literal '{hostname}'", hostname, effective_port
        ip_ok, ip_reason = _is_strictly_public_ip_obj(ip_obj)
        if not ip_ok:
            return False, f"Non-public IP literal blocked: {ip_reason}", hostname, effective_port
        return True, "public_ip_literal", hostname, effective_port

    labels = hostname.split(".")
    if labels and all(_IPV4_ALT_LABEL_RE.match(lbl) for lbl in labels):
        is_canonical_ipv4 = len(labels) == 4 and all(
            _CANONICAL_DEC_OCTET_RE.match(lbl) is not None and int(lbl) <= 255
            for lbl in labels
        )
        if not is_canonical_ipv4:
            return (
                False,
                f"Non-canonical or obfuscated IPv4 literal '{hostname}' is not permitted",
                hostname,
                effective_port,
            )

    try:
        ip_obj = ipaddress.ip_address(hostname)
    except ValueError:
        return True, "needs_dns", hostname, effective_port

    ip_ok, ip_reason = _is_strictly_public_ip_obj(ip_obj)
    if not ip_ok:
        return False, f"Non-public IP literal blocked: {ip_reason}", hostname, effective_port
    return True, "public_ip_literal", hostname, effective_port


def _invoke_resolver(
    resolver: Callable[..., Any] | None,
    hostname: str,
    port: int,
) -> list[str]:
    """Resolve ``hostname`` into a list of raw IP strings via ``resolver`` or ``socket.getaddrinfo``."""
    if resolver is None:
        infos = socket.getaddrinfo(hostname, port, type=socket.SOCK_STREAM)
    else:
        try:
            infos = resolver(hostname, port, socket.AF_UNSPEC, socket.SOCK_STREAM)
        except TypeError:
            try:
                infos = resolver(hostname, port)
            except TypeError:
                infos = resolver(hostname)

    ips: list[str] = []
    for item in infos or []:
        if isinstance(item, str):
            ip_str = item.strip()
        elif isinstance(item, (tuple, list)) and len(item) >= 5 and isinstance(item[4], (tuple, list)) and item[4]:
            ip_str = str(item[4][0]).strip()
        elif isinstance(item, (tuple, list)) and item and isinstance(item[0], str):
            ip_str = item[0].strip()
        else:
            continue
        if ip_str and ip_str not in ips:
            ips.append(ip_str)
    return ips


def validate_public_target_ips(
    url: str,
    resolver: Callable[..., Any] | None = None,
) -> tuple[bool, str]:
    """Validate URL syntax and verify all resolved IPv4/IPv6 targets are globally routable.

    Rejects before opening any socket if:
    - Scheme is not ``http`` or ``https``, credentials are present, or port is not ``80``/``443``.
    - Hostname is empty, localhost/internal, or a non-public IP literal.
    - DNS resolution fails, returns zero IPs, or ANY resolved IP is non-public.
    """
    syntax_ok, state_or_reason, hostname, effective_port = validate_url_syntax_and_literal_ip(url)
    if not syntax_ok:
        return False, state_or_reason
    if state_or_reason == "public_ip_literal":
        return True, "ok"

    try:
        resolved_ips = _invoke_resolver(resolver, hostname, effective_port)
    except (socket.gaierror, OSError, ValueError) as exc:
        return False, f"DNS resolution failed for '{hostname}': {exc}"

    if not resolved_ips:
        return False, f"DNS resolution returned zero IP addresses for '{hostname}'"

    for ip_raw in resolved_ips:
        clean_ip = ip_raw.split("%", 1)[0]
        try:
            ip_obj = ipaddress.ip_address(clean_ip)
        except ValueError:
            return False, f"Invalid resolved IP address '{ip_raw}' for '{hostname}'"
        ip_ok, ip_reason = _is_strictly_public_ip_obj(ip_obj)
        if not ip_ok:
            return (
                False,
                f"Resolved non-public IP {ip_raw} for '{hostname}': {ip_reason}",
            )

    return True, "ok"


def _normalize_candidate_doi(raw_val: str | None) -> str | None:
    if not raw_val:
        return None
    cleaned = re.sub(r"^\s*doi\s*:\s*", "", str(raw_val).strip(), flags=re.IGNORECASE)
    norm = normalize_doi(cleaned)
    if norm and _VALID_DOI_RE.match(norm):
        return norm
    return None


def _clean_meta_text(value: str | None) -> str | None:
    if not value:
        return None
    unescaped = html.unescape(str(value))
    collapsed = re.sub(r"\s+", " ", unescaped).strip()
    return collapsed or None


def is_soft_404_title(
    page_title: str | None,
    *,
    citation_doi: str | None = None,
) -> bool:
    """Detect soft-404 error titles while sparing technical articles discussing HTTP 404."""
    if citation_doi and _VALID_DOI_RE.match(citation_doi):
        return False
    cleaned = _clean_meta_text(page_title)
    if not cleaned:
        return False
    if _SOFT_404_PREFIX_RE.search(cleaned):
        return True
    segments = [
        seg.strip()
        for seg in re.split(r"\s+(?:[-–—|•·]|::)\s+", cleaned)
        if seg and seg.strip()
    ]
    if 1 < len(segments) <= 3:
        for seg in segments:
            if len(seg) <= 45 and _SOFT_404_EXACT_SEGMENT_RE.match(seg):
                return True
    return False


def is_gatekeeper_or_generic_html_title(title: str | None) -> bool:
    """Return True if ``title`` is empty, generic login/WAF/Cloudflare challenge, or non-informative."""
    cleaned = _clean_meta_text(title)
    if not cleaned or len(cleaned) < 4:
        return True
    if _GATEKEEPER_TITLE_RE.search(cleaned):
        return True
    if cleaned.lower() in {"home", "homepage", "index", "untitled", "document", "welcome", "trang chủ"}:
        return True
    return False


def _fold_vn_ascii(text: str) -> str:
    nfd = unicodedata.normalize("NFD", text.replace("đ", "d").replace("Đ", "D"))
    return "".join(ch for ch in nfd if unicodedata.category(ch) != "Mn")


def _content_tokens(text: str, *, fold_ascii: bool = False) -> set[str]:
    norm = normalize_text(_fold_vn_ascii(text) if fold_ascii else text)
    return {
        tok
        for tok in norm.split()
        if (len(tok) >= 2 or tok.isdigit()) and tok not in _TITLE_STOPWORDS
    }


def _single_title_pair_similarity(citation_title: str, candidate_html_title: str) -> float:
    """Compute lexical + diacritic-folded + cross-lingual concept similarity in ``[0, 1]``."""
    best = 0.0
    for fold in (False, True):
        c_toks = _content_tokens(citation_title, fold_ascii=fold)
        h_toks = _content_tokens(candidate_html_title, fold_ascii=fold)
        if c_toks and h_toks:
            inter = len(c_toks & h_toks)
            union = len(c_toks | h_toks)
            jacc = inter / union if union else 0.0
            containment = inter / min(len(c_toks), len(h_toks))
            best = max(best, jacc, containment * 0.85)

    try:
        from integrity_checker.matching.vn_en_academic_bridge import (
            compute_cross_lingual_concept_overlap,
        )

        xl_vi_en, _ = compute_cross_lingual_concept_overlap(citation_title, candidate_html_title)
        xl_en_vi, _ = compute_cross_lingual_concept_overlap(candidate_html_title, citation_title)
        best = max(best, xl_vi_en, xl_en_vi)
    except Exception:  # noqa: BLE001
        pass

    return min(1.0, best)


def _extract_usable_html_titles(
    citation_title: str | None,
    html_meta: HtmlPageMeta | None,
) -> tuple[str | None, list[str]]:
    """Validate ``citation_title`` and return ``(cleaned_citation_title, usable_html_titles)``."""
    if not citation_title or html_meta is None or html_meta.is_soft_404:
        return None, []

    cit_clean = _clean_meta_text(citation_title)
    if not cit_clean or len(cit_clean) < 20:
        return None, []
    if re.match(r"^(?:https?://|www\.)\S+$", cit_clean, re.IGNORECASE):
        return None, []
    if "http://" in cit_clean.lower() or "https://" in cit_clean.lower():
        return None, []

    raw_candidates = [
        t
        for t in (html_meta.citation_title, html_meta.page_title)
        if t and not is_gatekeeper_or_generic_html_title(t)
    ]
    if not raw_candidates:
        return cit_clean, []

    expanded_candidates: list[str] = []
    for raw_t in raw_candidates:
        cleaned_t = _clean_meta_text(raw_t)
        if not cleaned_t:
            continue
        expanded_candidates.append(cleaned_t)
        parts = [
            p.strip()
            for p in re.split(r"\s+(?:[-–—|•·]|::)\s+", cleaned_t)
            if p and len(p.strip()) >= 8 and not is_gatekeeper_or_generic_html_title(p)
        ]
        for p in parts:
            if p not in expanded_candidates:
                expanded_candidates.append(p)

    return cit_clean, expanded_candidates


def compute_url_title_match_score(
    citation_title: str | None,
    html_meta: HtmlPageMeta | None,
) -> float | None:
    """Return best ``[0, 1]`` similarity between ``citation_title`` and ``html_meta`` titles,
    or ``None`` when ``html_meta`` lacks a usable non-gatekeeper title (or is soft-404)."""
    cit_clean, expanded_candidates = _extract_usable_html_titles(citation_title, html_meta)
    if not cit_clean or not expanded_candidates:
        return None

    return max(_single_title_pair_similarity(cit_clean, cand) for cand in expanded_candidates)


def _project_for_english_minilm(text: str) -> str | None:
    """Project Vietnamese academic text to English concepts before ``all-MiniLM-L6-v2`` encoding.

    ``all-MiniLM-L6-v2`` uses an English WordPiece vocabulary where unrelated Vietnamese strings
    sharing diacritics exhibit ~0.60+ cosine anisotropy; projecting Vietnamese text through
    ``bridge_vn_to_en`` preserves cross-lingual / concept matching without false-passing VI decoys.
    """
    from integrity_checker.matching.vn_en_academic_bridge import (
        bridge_vn_to_en,
        is_vietnamese_text,
    )

    if not is_vietnamese_text(text):
        return text
    _, bridged, matched_pairs = bridge_vn_to_en(text)
    if not matched_pairs:
        return None
    m = re.search(r"\(([^()]+)\)\s*$", bridged)
    return m.group(1).strip() if m else None


def compute_html_meta_semantic_similarity(
    citation_title: str | None,
    html_meta: HtmlPageMeta | None,
    semantic_matcher: Any | None,
) -> float:
    """Compute neural semantic similarity between ``citation_title`` and ``html_meta`` titles."""
    if semantic_matcher is None or not hasattr(semantic_matcher, "similarity"):
        return 0.0

    cit_clean, expanded_candidates = _extract_usable_html_titles(citation_title, html_meta)
    if not cit_clean or not expanded_candidates:
        return 0.0

    try:
        from integrity_checker.matching.semantic import SemanticMatcher

        is_default_minilm = isinstance(semantic_matcher, SemanticMatcher)
    except Exception:  # noqa: BLE001
        is_default_minilm = False

    best_sem = 0.0
    try:
        if is_default_minilm:
            proj_cit = _project_for_english_minilm(cit_clean)
            if not proj_cit:
                return 0.0
            for cand in expanded_candidates:
                proj_cand = _project_for_english_minilm(cand)
                if not proj_cand:
                    continue
                sim = float(semantic_matcher.similarity(proj_cit, proj_cand) or 0.0)
                if sim > best_sem:
                    best_sem = sim
        else:
            for cand in expanded_candidates:
                sim = float(semantic_matcher.similarity(cit_clean, cand) or 0.0)
                if sim > best_sem:
                    best_sem = sim
    except Exception as exc:  # noqa: BLE001
        logger.debug(f"compute_html_meta_semantic_similarity failed: {exc}")
        return 0.0

    return max(0.0, min(1.0, best_sem))


class SSRFSafeAsyncNetworkBackend(httpcore.AsyncNetworkBackend):
    """``httpcore.AsyncNetworkBackend`` that resolves DNS once, verifies ALL IPs are public,
    and pins the verified IP literal at TCP socket connect time (eliminating DNS-rebinding TOCTOU)."""

    def __init__(
        self,
        resolver: Callable[..., Any] | None = None,
        inner_backend: httpcore.AsyncNetworkBackend | None = None,
    ) -> None:
        self.resolver = resolver
        self._inner = (
            inner_backend
            if inner_backend is not None
            else httpcore.AsyncConnectionPool()._network_backend
        )

    async def connect_tcp(
        self,
        host: str,
        port: int,
        timeout: float | None = None,  # noqa: ASYNC109
        local_address: str | None = None,
        socket_options: Iterable[Any] | None = None,
    ) -> httpcore.AsyncNetworkStream:
        if port not in (80, 443):
            raise SSRFBlockedError(f"Disallowed port {port} (only 80 and 443 permitted)")

        raw_host = (host or "").strip()
        if raw_host.startswith("[") and raw_host.endswith("]"):
            raw_host = raw_host[1:-1]
        clean_host = raw_host.rstrip(".")
        if not clean_host:
            raise SSRFBlockedError("Missing target hostname")

        scheme = "https" if port == 443 else "http"
        host_for_url = f"[{clean_host}]" if ":" in clean_host else clean_host
        synthetic_url = f"{scheme}://{host_for_url}:{port}/"

        syntax_ok, state_or_reason, parsed_host, _ = validate_url_syntax_and_literal_ip(
            synthetic_url
        )
        if not syntax_ok:
            raise SSRFBlockedError(state_or_reason)

        verified_ips: list[str] = []
        if state_or_reason == "public_ip_literal":
            verified_ips.append(parsed_host)
        else:
            try:
                if self.resolver is not None or socket.getaddrinfo is not _ORIG_SOCKET_GETADDRINFO:
                    resolved_ips = _invoke_resolver(self.resolver, parsed_host, port)
                else:
                    resolved_ips = await asyncio.to_thread(
                        _invoke_resolver, None, parsed_host, port
                    )
            except (socket.gaierror, OSError, ValueError) as exc:
                raise httpcore.ConnectError(
                    f"DNS resolution failed for '{parsed_host}': {exc}"
                ) from exc

            if not resolved_ips:
                raise httpcore.ConnectError(
                    f"DNS resolution returned zero IP addresses for '{parsed_host}'"
                )

            for ip_raw in resolved_ips:
                clean_ip = ip_raw.split("%", 1)[0]
                try:
                    ip_obj = ipaddress.ip_address(clean_ip)
                except ValueError as exc:
                    raise SSRFBlockedError(
                        f"Invalid resolved IP address '{ip_raw}' for '{parsed_host}'"
                    ) from exc
                ip_ok, ip_reason = _is_strictly_public_ip_obj(ip_obj)
                if not ip_ok:
                    raise SSRFBlockedError(
                        f"Resolved non-public IP {ip_raw} for '{parsed_host}': {ip_reason}"
                    )
                norm_ip = str(ip_obj)
                if norm_ip not in verified_ips:
                    verified_ips.append(norm_ip)

        last_err: Exception | None = None
        for idx, pinned_ip in enumerate(verified_ips):
            try:
                return await self._inner.connect_tcp(
                    pinned_ip,
                    port,
                    timeout=timeout,
                    local_address=local_address,
                    socket_options=socket_options,
                )
            except Exception as exc:  # noqa: BLE001
                last_err = exc
                if idx + 1 >= len(verified_ips) or isinstance(exc, SSRFBlockedError):
                    raise
        assert last_err is not None
        raise last_err

    async def connect_unix_socket(
        self,
        path: str,
        timeout: float | None = None,  # noqa: ASYNC109
        socket_options: Iterable[Any] | None = None,
    ) -> httpcore.AsyncNetworkStream:
        raise SSRFBlockedError("Unix domain sockets are not permitted")

    async def sleep(self, seconds: float) -> None:
        await self._inner.sleep(seconds)


def build_ssrf_safe_transport(
    resolver: Callable[..., Any] | None = None,
) -> httpx.AsyncHTTPTransport:
    """Create an ``httpx.AsyncHTTPTransport`` pinned to ``SSRFSafeAsyncNetworkBackend``."""
    transport = httpx.AsyncHTTPTransport(trust_env=False, retries=0)
    transport._pool._network_backend = SSRFSafeAsyncNetworkBackend(
        resolver=resolver,
        inner_backend=transport._pool._network_backend,
    )
    return transport


class _BoundedHeadHTMLParser(HTMLParser):
    """Streaming stdlib HTMLParser extracting scholarly & OpenGraph tags within ``<head>``."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.head_closed: bool = False
        self._in_title: bool = False
        self._title_chunks: list[str] = []
        self.title_tag: str | None = None
        self.fallback_og_title: str | None = None
        self.citation_title: str | None = None
        self.dc_title: str | None = None
        self.citation_authors: list[str] = []
        self.fallback_authors: list[str] = []
        self.citation_doi: str | None = None
        self.published_year: str | None = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if self.head_closed:
            return
        tag_low = tag.lower()
        if tag_low == "body":
            self.head_closed = True
            return
        if tag_low == "title" and self.title_tag is None:
            self._in_title = True
            self._title_chunks.clear()
            return
        if tag_low != "meta":
            return

        attr_map = {k.lower(): (v or "") for k, v in attrs if k}
        key = (
            attr_map.get("name")
            or attr_map.get("property")
            or attr_map.get("itemprop")
            or ""
        ).strip().lower()
        content = _clean_meta_text(attr_map.get("content"))
        if not key or not content:
            return

        if key in ("og:title", "twitter:title") and self.fallback_og_title is None:
            self.fallback_og_title = content
        elif key == "citation_title" and self.citation_title is None:
            self.citation_title = content
        elif key in ("dc.title", "dcterms.title") and self.dc_title is None:
            self.dc_title = content
        elif key in ("citation_author", "dc.creator", "dcterms.creator"):
            if content not in self.citation_authors:
                self.citation_authors.append(content)
        elif key == "author":
            if content not in self.fallback_authors:
                self.fallback_authors.append(content)
        elif key in (
            "citation_doi",
            "prism.doi",
            "bepress_citation_doi",
            "dc.identifier",
            "dcterms.identifier",
        ):
            if self.citation_doi is None:
                cand_doi = _normalize_candidate_doi(content)
                if cand_doi:
                    self.citation_doi = cand_doi
        elif key in (
            "citation_publication_date",
            "citation_date",
            "citation_online_date",
            "article:published_time",
            "og:published_time",
            "dc.date",
            "dcterms.issued",
            "prism.publicationdate",
        ):
            if self.published_year is None:
                ym = _YEAR_4_RE.search(content)
                if ym:
                    self.published_year = ym.group(1)

    def handle_data(self, data: str) -> None:
        if self._in_title and not self.head_closed and len(self._title_chunks) < 64:
            self._title_chunks.append(data)

    def handle_endtag(self, tag: str) -> None:
        tag_low = tag.lower()
        if tag_low == "title" and self._in_title:
            self._in_title = False
            self.title_tag = _clean_meta_text("".join(self._title_chunks))
        elif tag_low == "head":
            self._in_title = False
            if self.title_tag is None and self._title_chunks:
                self.title_tag = _clean_meta_text("".join(self._title_chunks))
            self.head_closed = True

    def build_meta(self) -> HtmlPageMeta:
        if self.title_tag is None and self._title_chunks:
            self.title_tag = _clean_meta_text("".join(self._title_chunks))
        page_title = self.title_tag or self.fallback_og_title
        cit_title = self.citation_title or self.dc_title
        authors = self.citation_authors if self.citation_authors else self.fallback_authors
        soft_404 = is_soft_404_title(page_title, citation_doi=self.citation_doi)
        return HtmlPageMeta(
            page_title=page_title,
            citation_title=cit_title,
            citation_authors=list(authors),
            citation_doi=self.citation_doi,
            published_year=self.published_year,
            is_soft_404=soft_404,
        )


def _detect_charset(content_type: str, initial_bytes: bytes = b"") -> str:
    for src in (content_type, initial_bytes[:1024].decode("ascii", errors="ignore")):
        m = _CHARSET_RE.search(src)
        if m:
            candidate = m.group(1).strip().lower()
            try:
                codecs.lookup(candidate)
                return candidate
            except LookupError:
                continue
    return "utf-8"


def is_html_content_type(content_type: str | None) -> bool:
    """Return True if HTTP Content-Type indicates HTML/XHTML (or is omitted)."""
    if not content_type or not content_type.strip():
        return True
    mime = content_type.split(";", 1)[0].strip().lower()
    return mime in _HTML_CONTENT_TYPES


async def extract_meta_from_async_response(
    resp: httpx.Response,
    *,
    max_bytes: int = MAX_HTML_HEAD_BYTES,
) -> HtmlPageMeta | None:
    """Stream up to ``max_bytes`` or ``</head>`` from an open ``httpx.Response`` and parse metadata."""
    content_type = resp.headers.get("content-type", "")
    if not is_html_content_type(content_type):
        return None

    parser = _BoundedHeadHTMLParser()
    decoder: codecs.IncrementalDecoder | None = None
    bytes_read = 0

    async for chunk in resp.aiter_bytes():
        if not chunk:
            continue
        remaining = max_bytes - bytes_read
        if remaining <= 0:
            break
        take = chunk if len(chunk) <= remaining else chunk[:remaining]
        if decoder is None:
            charset = _detect_charset(content_type, take)
            decoder = codecs.getincrementaldecoder(charset)(errors="replace")
            if not content_type.strip():
                sample = take[:256].lstrip()
                if sample.startswith((b"%PDF-", b"\x89PNG", b"\xff\xd8\xff", b"PK\x03\x04")):
                    return None
        bytes_read += len(take)
        parser.feed(decoder.decode(take, final=bytes_read >= max_bytes))
        if parser.head_closed or bytes_read >= max_bytes:
            break

    if decoder is not None and not parser.head_closed and bytes_read < max_bytes:
        tail = decoder.decode(b"", final=True)
        if tail:
            parser.feed(tail)
    try:
        parser.close()
    except Exception:  # noqa: BLE001
        pass
    return parser.build_meta()


class SafeHtmlMetaVerifier:
    """SSRF-safe bounded HTML ``<head>`` metadata fetcher."""

    DEFAULT_HEADERS = {
        "User-Agent": (
            "Mozilla/5.0 (compatible; EssayIntegrityChecker/1.0; "
            "+https://github.com/iannwendy/citra)"
        ),
        "Accept": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
    }

    def __init__(
        self,
        timeout: float = DEFAULT_TIMEOUT_SECONDS,
        max_redirects: int = DEFAULT_MAX_REDIRECTS,
        max_bytes: int = MAX_HTML_HEAD_BYTES,
        resolver: Callable[..., Any] | None = None,
        client: httpx.AsyncClient | None = None,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self.timeout = timeout
        self.max_redirects = max_redirects
        self.max_bytes = max_bytes
        self.resolver = resolver
        self._client = client
        self._transport = transport

    async def _validate_target(self, url: str) -> tuple[bool, str]:
        if self.resolver is not None:
            return validate_public_target_ips(url, resolver=self.resolver)
        syntax_ok, state_or_reason, _, _ = validate_url_syntax_and_literal_ip(url)
        if not syntax_ok:
            return False, state_or_reason
        if state_or_reason == "public_ip_literal":
            return True, "ok"
        return await asyncio.to_thread(validate_public_target_ips, url, None)

    async def _fetch_with_client(
        self,
        client: httpx.AsyncClient,
        url: str,
        *,
        uses_pinned_backend: bool = False,
    ) -> HtmlPageMeta | None:
        current_url = url.strip()
        for hop in range(self.max_redirects + 1):
            if uses_pinned_backend and httpx.AsyncClient.stream is _ORIG_ASYNC_CLIENT_STREAM:
                allowed, reason, _, _ = validate_url_syntax_and_literal_ip(current_url)
            else:
                allowed, reason = await self._validate_target(current_url)
            if not allowed:
                logger.debug(f"SafeHtmlMetaVerifier blocked '{current_url}': {reason}")
                return None

            async with client.stream(
                "GET",
                current_url,
                follow_redirects=False,
                headers=self.DEFAULT_HEADERS,
            ) as resp:
                if resp.status_code in _REDIRECT_STATUS_CODES:
                    location = (resp.headers.get("location") or "").strip()
                    if not location or hop >= self.max_redirects:
                        return None
                    current_url = urljoin(current_url, location)
                    continue

                if resp.status_code not in (200, 206):
                    return None

                return await extract_meta_from_async_response(
                    resp,
                    max_bytes=self.max_bytes,
                )
        return None

    async def fetch_meta(self, url: str) -> HtmlPageMeta | None:
        """Fetch and parse ``<head>`` metadata safely, returning ``None`` if blocked or non-HTML."""
        if not url or not str(url).strip():
            return None

        try:
            if self._client is not None:
                return await self._fetch_with_client(self._client, str(url))

            uses_pinned = self._transport is None
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
            ) as owned_client:
                return await self._fetch_with_client(
                    owned_client,
                    str(url),
                    uses_pinned_backend=uses_pinned,
                )
        except Exception as exc:  # noqa: BLE001
            logger.debug(f"SafeHtmlMetaVerifier failed for '{url}': {exc}")
            return None
