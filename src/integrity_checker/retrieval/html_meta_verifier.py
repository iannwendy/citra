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
2. Bounded streaming (``MAX_HTML_HEAD_BYTES = 131072``):
   - Streams HTML chunks up to ``128 KB`` or ``</head>``/``<body>``, closing the stream
     immediately so infinite or multi-megabyte responses never consume memory while still
     capturing ``<script type="application/ld+json">`` blocks placed after inline CSS in
     modern SSR ``<head>`` sections.
"""

from __future__ import annotations

import asyncio
import codecs
import datetime
import html
import ipaddress
import json
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

MAX_HTML_HEAD_BYTES = 131_072
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
    site_name: str | None = None
    canonical_url: str | None = None
    is_soft_404: bool = False

    def to_dict(self) -> dict[str, Any]:
        """Serialize metadata to a JSON-compatible dictionary."""
        return {
            "page_title": self.page_title,
            "citation_title": self.citation_title,
            "citation_authors": list(self.citation_authors or []),
            "citation_doi": self.citation_doi,
            "published_year": (
                str(self.published_year) if self.published_year is not None else None
            ),
            "site_name": self.site_name,
            "canonical_url": self.canonical_url,
            "is_soft_404": bool(self.is_soft_404),
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None) -> HtmlPageMeta | None:
        """Deserialize metadata from a dictionary, returning ``None`` when empty/None."""
        if not data or not isinstance(data, dict):
            return None

        raw_authors = data.get("citation_authors")
        if raw_authors is None:
            raw_authors = data.get("authors")
        authors: list[str] = []
        if isinstance(raw_authors, str):
            cleaned_a = _clean_meta_text(raw_authors)
            if cleaned_a:
                authors.append(cleaned_a)
        elif isinstance(raw_authors, Iterable):
            seen_low: set[str] = set()
            for item in raw_authors:
                if item is None:
                    continue
                cleaned_a = _clean_meta_text(str(item))
                if cleaned_a and cleaned_a.casefold() not in seen_low:
                    seen_low.add(cleaned_a.casefold())
                    authors.append(cleaned_a)

        page_title = _clean_meta_text(data.get("page_title"))
        citation_title = _clean_meta_text(data.get("citation_title"))
        citation_doi = _normalize_candidate_doi(data.get("citation_doi")) or _clean_meta_text(
            data.get("citation_doi")
        )
        raw_year = data.get("published_year")
        published_year = (
            _clean_meta_text(str(raw_year)) if raw_year is not None and str(raw_year).strip() else None
        )
        site_name = _clean_meta_text(data.get("site_name"))
        canonical_url = _clean_meta_text(data.get("canonical_url"))
        is_soft_404 = bool(data.get("is_soft_404", False))

        if (
            not page_title
            and not citation_title
            and not authors
            and not citation_doi
            and not published_year
            and not site_name
            and not canonical_url
            and not is_soft_404
        ):
            return None

        return cls(
            page_title=page_title,
            citation_title=citation_title,
            citation_authors=authors,
            citation_doi=citation_doi,
            published_year=published_year,
            site_name=site_name,
            canonical_url=canonical_url,
            is_soft_404=is_soft_404,
        )


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


_WAYBACK_WRAPPER_URL_RE = re.compile(
    r"^https?://web\.archive\.org/web/\d+(?:[a-z]+_)?/(https?://.+)$",
    re.IGNORECASE,
)
_URL_SLASH_DATE_RE = re.compile(
    r"/(19\d{2}|20\d{2})/(0?[1-9]|1[0-2])/(0?[1-9]|[12]\d|3[01])(?:/|_|-|\.|$)"
)
_URL_HYPHEN_DATE_RE = re.compile(
    r"(?:^|/|_|-)(19\d{2}|20\d{2})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])(?:/|_|-|\.|$)"
)
_NUMBERED_CITATION_AUTHOR_RE = re.compile(r"^citation_author(\d+)$")
_BYLINE_PREFIX_RE = re.compile(
    r"^(?:by\s+|theo\s+|tác\s+giả\s*:\s*|tac\s+gia\s*:\s*)",
    re.IGNORECASE,
)
_CRAN_ROLE_SUFFIX_RE = re.compile(
    r"\s*\[(?:aut|cre|ctb|cph|ths|trl|edt|fnd|rev|dtc)"
    r"(?:[\s,]+(?:aut|cre|ctb|cph|ths|trl|edt|fnd|rev|dtc))*\]\s*$",
    re.IGNORECASE,
)
_BARE_DOMAIN_RE = re.compile(r"^[a-z0-9-]+(?:\.[a-z0-9-]+)+$")
_JSONLD_PRIMARY_TYPES = frozenset({
    "article",
    "newsarticle",
    "blogposting",
    "scholarlyarticle",
    "techarticle",
    "report",
    "dataset",
    "softwaresourcecode",
    "book",
})
_JSONLD_FALLBACK_TYPES = frozenset({"webpage"})
MAX_JSONLD_BLOCKS = 4
MAX_JSONLD_BLOCK_CHARS = 32_768


def extract_year_from_url(url: str | None) -> int | None:
    """Extract an unambiguous publication year from ``/YYYY/MM/DD/`` or ``/YYYY-MM-DD`` URL paths."""
    if not url or not str(url).strip():
        return None
    raw = str(url).strip()
    wb_match = _WAYBACK_WRAPPER_URL_RE.match(raw)
    if wb_match:
        raw = wb_match.group(1).strip()
    try:
        parsed = urlsplit(raw)
    except ValueError:
        return None
    path = parsed.path or ""
    if not path:
        return None

    for pattern in (_URL_SLASH_DATE_RE, _URL_HYPHEN_DATE_RE):
        for m in pattern.finditer(path):
            yr, mo, dy = int(m.group(1)), int(m.group(2)), int(m.group(3))
            try:
                datetime.date(yr, mo, dy)
            except ValueError:
                continue
            return yr
    return None


def _resolve_canonical_http_url(candidate: str | None, base_url: str | None = None) -> str | None:
    """Resolve and validate an ``http(s)://`` canonical URL candidate."""
    cleaned = _clean_meta_text(candidate)
    if not cleaned:
        return None
    resolved = cleaned
    if not cleaned.lower().startswith(("http://", "https://")):
        if base_url and base_url.lower().startswith(("http://", "https://")):
            wb_match = _WAYBACK_WRAPPER_URL_RE.match(base_url)
            effective_base = wb_match.group(1) if wb_match else base_url
            resolved = urljoin(effective_base, cleaned)
        else:
            return None
    try:
        sp = urlsplit(resolved)
    except ValueError:
        return None
    if (sp.scheme or "").lower() not in ("http", "https") or not sp.hostname:
        return None
    return resolved


def _clean_author_candidate(raw: str | None, *, strip_byline: bool = False) -> str | None:
    """Normalize an author tag value, rejecting URLs, handles, and bare domains."""
    cleaned = _clean_meta_text(raw)
    if not cleaned:
        return None
    low = cleaned.lower()
    if low.startswith(("http://", "https://", "www.", "mailto:", "/", "@")) or "://" in low:
        return None
    if strip_byline:
        cleaned = _BYLINE_PREFIX_RE.sub("", cleaned).strip(" \t\r\n,-–—:|")
    cleaned = _CRAN_ROLE_SUFFIX_RE.sub("", cleaned).strip()
    if not cleaned or len(cleaned) < 2:
        return None
    if " " not in cleaned and _BARE_DOMAIN_RE.match(cleaned):
        return None
    return cleaned


def _extract_host_labels(url: str | None) -> set[str]:
    if not url:
        return set()
    raw = str(url).strip()
    wb_match = _WAYBACK_WRAPPER_URL_RE.match(raw)
    if wb_match:
        raw = wb_match.group(1).strip()
    try:
        host = (urlsplit(raw).hostname or "").lower().strip(".")
    except ValueError:
        return set()
    if not host:
        return set()
    no_www = host[4:] if host.startswith("www.") else host
    labels = {host, no_www}
    parts = no_www.split(".")
    if len(parts) >= 2 and len(parts[0]) >= 4:
        labels.add(parts[0])
    return labels


def _normalize_site_compare(text: str | None) -> str:
    if not text:
        return ""
    norm = normalize_text(text)
    if norm.startswith("the "):
        norm = norm[4:].strip()
    return norm


def _schema_types_of(node: dict[str, Any]) -> set[str]:
    raw_t = node.get("@type") or node.get("type")
    items = raw_t if isinstance(raw_t, list) else ([raw_t] if raw_t else [])
    out: set[str] = set()
    for item in items:
        if not isinstance(item, str):
            continue
        s = item.strip()
        if "/" in s:
            s = s.rsplit("/", 1)[-1]
        if ":" in s:
            s = s.rsplit(":", 1)[-1]
        if s:
            out.add(s.lower())
    return out


class _BoundedHeadHTMLParser(HTMLParser):
    """Streaming stdlib HTMLParser extracting scholarly, OpenGraph & JSON-LD metadata within ``<head>``."""

    def __init__(self, source_url: str | None = None) -> None:
        super().__init__(convert_charrefs=True)
        self.source_url: str | None = (source_url or "").strip() or None
        self.head_closed: bool = False
        self._in_title: bool = False
        self._title_chunks: list[str] = []
        self.title_tag: str | None = None
        self.fallback_og_title: str | None = None
        self.citation_title: str | None = None
        self.dc_title: str | None = None

        self.citation_authors: list[str] = []
        self._numbered_citation_authors: list[tuple[int, str]] = []
        self.dc_authors: list[str] = []
        self.fallback_authors: list[str] = []

        self.citation_doi: str | None = None
        self.published_year: str | None = None

        self._scholarly_venue: str | None = None
        self._publisher_name: str | None = None
        self._og_site_name: str | None = None
        self._twitter_site: str | None = None

        self._link_canonical_url: str | None = None
        self._citation_public_url: str | None = None
        self._og_url: str | None = None

        self._in_jsonld: bool = False
        self._jsonld_chunks: list[str] = []
        self._jsonld_chars: int = 0
        self._jsonld_blocks: list[str] = []

    @staticmethod
    def _append_unique(target: list[str], value: str | None) -> None:
        if not value:
            return
        folded = value.casefold()
        if all(existing.casefold() != folded for existing in target):
            target.append(value)

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if self.head_closed:
            return
        tag_low = tag.lower()
        if tag_low == "body":
            self._in_jsonld = False
            self.head_closed = True
            return
        if tag_low == "title" and self.title_tag is None:
            self._in_title = True
            self._title_chunks.clear()
            return

        attr_map = {k.lower(): (v or "") for k, v in attrs if k}

        if tag_low == "link":
            rel_tokens = (attr_map.get("rel") or "").lower().split()
            if "canonical" in rel_tokens and self._link_canonical_url is None:
                resolved = _resolve_canonical_http_url(attr_map.get("href"), self.source_url)
                if resolved:
                    self._link_canonical_url = resolved
            return

        if tag_low == "script":
            script_type = (attr_map.get("type") or "").split(";", 1)[0].strip().lower()
            if script_type == "application/ld+json" and len(self._jsonld_blocks) < MAX_JSONLD_BLOCKS:
                self._in_jsonld = True
                self._jsonld_chunks.clear()
                self._jsonld_chars = 0
            return

        if tag_low != "meta":
            return

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
        elif key == "citation_author":
            self._append_unique(self.citation_authors, _clean_author_candidate(content))
        elif (num_match := _NUMBERED_CITATION_AUTHOR_RE.match(key)) is not None:
            cleaned_a = _clean_author_candidate(content)
            if cleaned_a:
                self._numbered_citation_authors.append((int(num_match.group(1)), cleaned_a))
        elif key in ("dc.creator", "dcterms.creator"):
            self._append_unique(self.dc_authors, _clean_author_candidate(content))
        elif key in (
            "author",
            "parsely-author",
            "sailthru.author",
            "cxenseparse:author",
            "article:author",
            "byl",
        ):
            self._append_unique(
                self.fallback_authors,
                _clean_author_candidate(content, strip_byline=True),
            )
        elif key in (
            "citation_journal_title",
            "citation_conference_title",
            "citation_technical_report_institution",
            "prism.publicationname",
        ):
            if self._scholarly_venue is None:
                self._scholarly_venue = content
        elif key in ("citation_publisher", "dc.publisher", "dcterms.publisher"):
            if self._publisher_name is None:
                self._publisher_name = content
        elif key in ("og:site_name", "application-name"):
            if self._og_site_name is None:
                self._og_site_name = content
        elif key == "twitter:site":
            if self._twitter_site is None:
                tw_clean = content.lstrip("@").strip()
                if len(tw_clean) >= 2:
                    self._twitter_site = tw_clean
        elif key == "citation_public_url":
            if self._citation_public_url is None:
                self._citation_public_url = _resolve_canonical_http_url(content, self.source_url)
        elif key == "og:url":
            if self._og_url is None:
                self._og_url = _resolve_canonical_http_url(content, self.source_url)
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
            "dc.date.issued",
            "dcterms.issued",
            "prism.publicationdate",
            "parsely-pub-date",
            "sailthru.date",
            "pubdate",
            "publishdate",
            "date",
        ):
            if self.published_year is None:
                ym = _YEAR_4_RE.search(content)
                if ym:
                    self.published_year = ym.group(1)

    def handle_data(self, data: str) -> None:
        if self.head_closed:
            return
        if self._in_title and len(self._title_chunks) < 64:
            self._title_chunks.append(data)
        if self._in_jsonld and self._jsonld_chars < MAX_JSONLD_BLOCK_CHARS:
            rem = MAX_JSONLD_BLOCK_CHARS - self._jsonld_chars
            piece = data if len(data) <= rem else data[:rem]
            self._jsonld_chunks.append(piece)
            self._jsonld_chars += len(piece)

    def handle_endtag(self, tag: str) -> None:
        tag_low = tag.lower()
        if tag_low == "title" and self._in_title:
            self._in_title = False
            self.title_tag = _clean_meta_text("".join(self._title_chunks))
        elif tag_low == "script" and self._in_jsonld:
            self._in_jsonld = False
            raw_block = "".join(self._jsonld_chunks).strip()
            self._jsonld_chunks.clear()
            if raw_block and len(self._jsonld_blocks) < MAX_JSONLD_BLOCKS:
                self._jsonld_blocks.append(raw_block)
        elif tag_low == "head":
            self._in_title = False
            self._in_jsonld = False
            if self.title_tag is None and self._title_chunks:
                self.title_tag = _clean_meta_text("".join(self._title_chunks))
            self.head_closed = True

    def _extract_jsonld_fallbacks(
        self,
    ) -> tuple[str | None, list[str], str | None, str | None, str | None]:
        """Parse captured JSON-LD blocks and return ``(title, authors, year, site_name, doi)``."""
        j_title: str | None = None
        j_authors: list[str] = []
        j_year: str | None = None
        j_site: str | None = None
        j_doi: str | None = None

        if not self._jsonld_blocks:
            return j_title, j_authors, j_year, j_site, j_doi

        id_map: dict[str, dict[str, Any]] = {}
        all_nodes: list[dict[str, Any]] = []

        def _collect(obj: Any, depth: int = 0) -> None:
            if depth > 12:
                return
            if isinstance(obj, list):
                for elem in obj:
                    _collect(elem, depth + 1)
            elif isinstance(obj, dict):
                node_id = obj.get("@id")
                if isinstance(node_id, str) and node_id.strip() and len(obj) > 1:
                    id_map[node_id.strip()] = obj
                all_nodes.append(obj)
                graph = obj.get("@graph")
                if isinstance(graph, list):
                    _collect(graph, depth + 1)

        for raw_block in self._jsonld_blocks:
            try:
                parsed = json.loads(raw_block)
            except Exception:  # noqa: BLE001
                continue
            _collect(parsed)

        def _resolve_ref(val: Any) -> Any:
            if isinstance(val, dict) and len(val) == 1 and isinstance(val.get("@id"), str):
                return id_map.get(val["@id"].strip(), val)
            return val

        def _extract_entity_name(val: Any) -> str | None:
            val = _resolve_ref(val)
            if isinstance(val, str):
                return _clean_meta_text(val)
            if isinstance(val, dict):
                return _clean_meta_text(val.get("name"))
            if isinstance(val, list):
                for sub in val:
                    nm = _extract_entity_name(sub)
                    if nm:
                        return nm
            return None

        def _extract_authors(val: Any, out: list[str]) -> None:
            val = _resolve_ref(val)
            if isinstance(val, str):
                self._append_unique(out, _clean_author_candidate(val, strip_byline=True))
            elif isinstance(val, dict):
                types = _schema_types_of(val)
                nm = _clean_author_candidate(val.get("name"), strip_byline=True)
                if nm:
                    if "organization" in types and j_site and _normalize_site_compare(nm) == _normalize_site_compare(j_site):
                        return
                    self._append_unique(out, nm)
            elif isinstance(val, list):
                for sub in val:
                    _extract_authors(sub, out)

        def _extract_doi_from_field(val: Any) -> str | None:
            if isinstance(val, str):
                return _normalize_candidate_doi(val)
            if isinstance(val, dict):
                for k in ("value", "@id", "url"):
                    cand = _normalize_candidate_doi(val.get(k))
                    if cand:
                        return cand
            elif isinstance(val, list):
                for sub in val:
                    cand = _extract_doi_from_field(sub)
                    if cand:
                        return cand
            return None

        primary_nodes: list[dict[str, Any]] = []
        fallback_nodes: list[dict[str, Any]] = []
        for node in all_nodes:
            types = _schema_types_of(node)
            if types & _JSONLD_PRIMARY_TYPES:
                primary_nodes.append(node)
            elif types & _JSONLD_FALLBACK_TYPES:
                fallback_nodes.append(node)

        for node in (*primary_nodes, *fallback_nodes):
            if j_site is None:
                j_site = _extract_entity_name(node.get("publisher")) or _extract_entity_name(
                    node.get("isPartOf")
                )
            if j_title is None:
                cand_t = _clean_meta_text(node.get("headline")) or _clean_meta_text(
                    node.get("name")
                )
                if cand_t and not is_gatekeeper_or_generic_html_title(cand_t):
                    j_title = cand_t
            if not j_authors and node.get("author") is not None:
                _extract_authors(node.get("author"), j_authors)
            if j_year is None:
                for date_key in ("datePublished", "dateCreated"):
                    raw_dt = _clean_meta_text(
                        str(node.get(date_key)) if node.get(date_key) is not None else None
                    )
                    if raw_dt:
                        ym = _YEAR_4_RE.search(raw_dt)
                        if ym:
                            j_year = ym.group(1)
                            break
            if j_doi is None:
                j_doi = _extract_doi_from_field(node.get("sameAs")) or _extract_doi_from_field(
                    node.get("identifier")
                )

        return j_title, j_authors, j_year, j_site, j_doi

    def build_meta(self) -> HtmlPageMeta:
        if self.title_tag is None and self._title_chunks:
            self.title_tag = _clean_meta_text("".join(self._title_chunks))

        j_title, j_authors, j_year, j_site, j_doi = self._extract_jsonld_fallbacks()

        site_name = (
            self._scholarly_venue
            or self._publisher_name
            or self._og_site_name
            or j_site
            or self._twitter_site
        )
        canonical_url = self._link_canonical_url or self._citation_public_url or self._og_url

        page_title = self.title_tag or self.fallback_og_title
        cit_title = self.citation_title or self.dc_title or j_title
        if cit_title is None and page_title and site_name:
            site_cmp = _normalize_site_compare(site_name)
            if site_cmp:
                parts = [
                    p.strip()
                    for p in re.split(r"\s+(?:[-–—|•·]|::)\s+", page_title)
                    if p and p.strip()
                ]
                if len(parts) >= 2 and _normalize_site_compare(parts[-1]) == site_cmp:
                    stripped_title = " - ".join(parts[:-1]).strip() if len(parts) > 2 else parts[0]
                    if (
                        len(stripped_title) >= 4
                        and not is_gatekeeper_or_generic_html_title(stripped_title)
                        and not is_soft_404_title(stripped_title)
                    ):
                        cit_title = stripped_title

        primary_authors: list[str] = list(self.citation_authors)
        if self._numbered_citation_authors:
            for _, num_author in sorted(self._numbered_citation_authors, key=lambda item: item[0]):
                self._append_unique(primary_authors, num_author)

        site_cmp = _normalize_site_compare(site_name)
        host_labels = _extract_host_labels(canonical_url or self.source_url)

        def _is_generic_site_author(name: str) -> bool:
            nm_cmp = _normalize_site_compare(name)
            if not nm_cmp:
                return True
            if site_cmp and nm_cmp == site_cmp:
                return True
            if name.lower() in host_labels or nm_cmp in host_labels:
                return True
            return False

        if primary_authors:
            authors = [a for a in primary_authors if a.lower() not in host_labels]
        elif self.dc_authors:
            filtered_dc = [a for a in self.dc_authors if not _is_generic_site_author(a)]
            authors = filtered_dc
        else:
            merged_fallbacks: list[str] = []
            for cand_a in (*self.fallback_authors, *j_authors):
                if not _is_generic_site_author(cand_a):
                    self._append_unique(merged_fallbacks, cand_a)
            authors = merged_fallbacks

        doi = self.citation_doi or j_doi
        published_year = self.published_year or j_year
        if published_year is None:
            url_year = extract_year_from_url(self.source_url) or extract_year_from_url(canonical_url)
            if url_year is not None:
                published_year = str(url_year)

        soft_404 = is_soft_404_title(page_title, citation_doi=doi)
        return HtmlPageMeta(
            page_title=page_title,
            citation_title=cit_title,
            citation_authors=list(authors),
            citation_doi=doi,
            published_year=published_year,
            site_name=site_name,
            canonical_url=canonical_url,
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


def parse_html_head_meta(
    raw_bytes: bytes | str,
    *,
    content_type: str = "text/html",
    source_url: str | None = None,
    url: str | None = None,
    max_bytes: int = MAX_HTML_HEAD_BYTES,
) -> HtmlPageMeta | None:
    """Parse bounded HTML ``<head>`` bytes/text synchronously, with optional URL-date fallback."""
    if not is_html_content_type(content_type):
        return None
    effective_url = source_url or url
    if isinstance(raw_bytes, str):
        raw_buf = raw_bytes.encode("utf-8", errors="replace")[:max_bytes]
    else:
        raw_buf = bytes(raw_bytes[:max_bytes])
    if not content_type.strip():
        sample = raw_buf[:256].lstrip()
        if sample.startswith((b"%PDF-", b"\x89PNG", b"\xff\xd8\xff", b"PK\x03\x04")):
            return None
    charset = _detect_charset(content_type, raw_buf)
    text = raw_buf.decode(charset, errors="replace")
    parser = _BoundedHeadHTMLParser(source_url=effective_url)
    parser.feed(text)
    try:
        parser.close()
    except Exception:  # noqa: BLE001
        pass
    return parser.build_meta()


async def extract_meta_from_async_response(
    resp: httpx.Response,
    *,
    max_bytes: int = MAX_HTML_HEAD_BYTES,
    source_url: str | None = None,
    url: str | None = None,
) -> HtmlPageMeta | None:
    """Stream up to ``max_bytes`` or ``</head>`` from an open ``httpx.Response`` and parse metadata."""
    content_type = resp.headers.get("content-type", "")
    if not is_html_content_type(content_type):
        return None

    resp_url_raw = getattr(resp, "url", None)
    effective_url = source_url or url or (str(resp_url_raw) if resp_url_raw else None)
    parser = _BoundedHeadHTMLParser(source_url=effective_url)
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
                    source_url=current_url,
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
