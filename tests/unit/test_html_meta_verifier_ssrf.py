"""Unit tests for Task 5 (A2): SSRF-Safe HTML <head> Verifier, R-URL-CONTENT-MISMATCH,
and Vietnamese TCVN/QCVN & University Textbook Registry."""

from __future__ import annotations

import socket
from collections.abc import AsyncIterator

import httpx
import pytest

from integrity_checker.logic.neuro_symbolic_checker import NeuroSymbolicChecker
from integrity_checker.logic.rules import SymbolicRules
from integrity_checker.matching.features import FeatureCalculator
from integrity_checker.models.citation import Citation, CitationStyle, CitationType
from integrity_checker.models.source import SourceResult
from integrity_checker.models.validation import MatchFeatures, ValidationLabel
from integrity_checker.retrieval.html_meta_verifier import (
    MAX_HTML_HEAD_BYTES,
    HtmlPageMeta,
    SafeHtmlMetaVerifier,
    validate_public_target_ips,
)
from integrity_checker.retrieval.link_validator import LinkStatus, LinkValidator
from integrity_checker.retrieval.tech_standard_client import TechStandardClient


def _make_addrinfo(ip: str, port: int = 80) -> list[tuple]:
    family = socket.AF_INET6 if ":" in ip else socket.AF_INET
    sockaddr = (ip, port, 0, 0) if family == socket.AF_INET6 else (ip, port)
    return [(family, socket.SOCK_STREAM, socket.IPPROTO_TCP, "", sockaddr)]


# ============================================================================
# 1. SSRF & DNS Rebinding Block
# ============================================================================


@pytest.mark.parametrize(
    "blocked_url",
    [
        "http://127.0.0.1:8000/admin",
        "http://127.0.0.1/",
        "http://169.254.169.254/latest/meta-data/",
        "http://[::1]/",
        "http://[::ffff:127.0.0.1]/",
        "http://[::ffff:169.254.169.254]/latest/meta-data/",
        "http://10.0.0.5/",
        "http://172.16.10.4/",
        "http://192.168.1.1/",
        "http://100.64.0.1/",
        "http://0.0.0.0/",
        "http://localhost/internal",
        "file:///etc/passwd",
        "ftp://93.184.216.34/pub/paper.pdf",
        "https://user:password@93.184.216.34/paper",
        "https://93.184.216.34:8443/paper",
    ],
)
def test_validate_public_target_ips_blocks_private_metadata_and_bad_ports(blocked_url: str) -> None:
    resolver_called = False

    def unexpected_resolver(*args, **kwargs):
        nonlocal resolver_called
        resolver_called = True
        return _make_addrinfo("93.184.216.34", 80)

    allowed, reason = validate_public_target_ips(blocked_url, resolver=unexpected_resolver)
    assert allowed is False
    assert reason
    assert resolver_called is False


def test_validate_public_target_ips_blocks_dns_rebinding_and_empty_dns() -> None:
    # Single private IP via DNS rebinding
    ok_rebind, reason_rebind = validate_public_target_ips(
        "http://evil.rebind.example/article",
        resolver=lambda host, port, *a, **kw: _make_addrinfo("192.168.1.1", port),
    )
    assert ok_rebind is False
    assert "192.168.1.1" in reason_rebind or "private" in reason_rebind.lower() or "non-public" in reason_rebind.lower()

    # Mixed A records (one public, one private) MUST also be rejected
    def mixed_resolver(host: str, port: int, *a, **kw):
        return _make_addrinfo("93.184.216.34", port) + _make_addrinfo("10.0.0.5", port)

    ok_mixed, _ = validate_public_target_ips("https://mixed.rebind.example/", resolver=mixed_resolver)
    assert ok_mixed is False

    # Zero resolved IPs MUST be rejected
    ok_empty, _ = validate_public_target_ips("https://empty.rebind.example/", resolver=lambda *a, **kw: [])
    assert ok_empty is False

    # Purely public IPv4 + IPv6 records succeed
    def public_resolver(host: str, port: int, *a, **kw):
        return _make_addrinfo("93.184.216.34", port) + _make_addrinfo("2606:2800:220:1:248:1893:25c8:1946", port)

    ok_pub, _ = validate_public_target_ips("https://public.scholar.example/paper", resolver=public_resolver)
    assert ok_pub is True


@pytest.mark.asyncio
async def test_verifier_and_link_validator_block_ssrf_and_302_redirect_before_socket() -> None:
    opened_urls: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        opened_urls.append(str(request.url))
        if request.url.host == "public.jumping.example":
            return httpx.Response(302, headers={"Location": "http://127.0.0.1/internal-secret"})
        raise AssertionError(f"Socket should NEVER open to {request.url}!")

    def fake_resolver(host: str, port: int = 80, *args, **kwargs):
        if host == "public.jumping.example":
            return _make_addrinfo("93.184.216.34", port)
        if host == "evil.rebind.example":
            return _make_addrinfo("192.168.1.1", port)
        raise socket.gaierror("NXDOMAIN")

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport, follow_redirects=False) as client:
        verifier = SafeHtmlMetaVerifier(resolver=fake_resolver, client=client)

        # Direct SSRF targets never touch transport
        for bad_url in (
            "http://127.0.0.1:8000/admin",
            "http://169.254.169.254/latest/meta-data/",
            "http://[::1]/",
            "http://10.0.0.5/",
            "http://evil.rebind.example/",
        ):
            assert await verifier.fetch_meta(bad_url) is None
        assert opened_urls == []

        # HTTP 302 from public host -> 127.0.0.1 stops BEFORE opening socket to 127.0.0.1
        meta_redirect = await verifier.fetch_meta("https://public.jumping.example/start")
        assert meta_redirect is None
        assert opened_urls == ["https://public.jumping.example/start"]

    # LinkValidator must also block direct SSRF and redirect-to-loopback before socket
    lv_opened: list[str] = []

    def lv_handler(request: httpx.Request) -> httpx.Response:
        lv_opened.append(str(request.url))
        if request.url.host == "public.jumping.example":
            return httpx.Response(302, headers={"Location": "http://127.0.0.1/"})
        raise AssertionError(f"LinkValidator opened forbidden socket to {request.url}!")

    lv = LinkValidator(
        timeout=3.0,
        enable_wayback_fallback=False,
        resolver=fake_resolver,
        transport=httpx.MockTransport(lv_handler),
    )
    res_meta_ip = await lv.validate_url("http://169.254.169.254/latest/meta-data/")
    assert res_meta_ip.is_valid is False
    assert lv_opened == []

    res_rebind = await lv.validate_url("http://evil.rebind.example/doc")
    assert res_rebind.is_valid is False
    assert lv_opened == []

    res_redir = await lv.validate_url("https://public.jumping.example/start")
    assert res_redir.is_valid is False
    assert lv_opened == ["https://public.jumping.example/start"]


# ============================================================================
# 2. Bounded Stream (<= 64 KB) & Metadata Extraction
# ============================================================================


class _InfiniteHtmlStream(httpx.AsyncByteStream):
    def __init__(self, header_bytes: bytes, chunk_size: int = 4096) -> None:
        self.header_bytes = header_bytes
        self.chunk_size = chunk_size
        self.bytes_yielded = 0
        self.closed = False

    async def __aiter__(self) -> AsyncIterator[bytes]:
        yield self.header_bytes
        self.bytes_yielded += len(self.header_bytes)
        filler = b"<!-- infinite padding without closing head -->"
        block = (filler * ((self.chunk_size // len(filler)) + 1))[: self.chunk_size]
        while True:
            self.bytes_yielded += len(block)
            yield block
            if self.bytes_yielded > MAX_HTML_HEAD_BYTES * 4:
                raise AssertionError("Verifier failed to stop reading bounded stream at 64 KB!")

    async def aclose(self) -> None:
        self.closed = True


@pytest.mark.asyncio
async def test_bounded_stream_stops_at_64kb_on_infinite_response_and_extracts_meta() -> None:
    head_prefix = (
        b"<!DOCTYPE html><html><head>"
        b"<title>  Adaptive Control of 6-DOF Robot Manipulators  </title>"
        b'<meta name="citation_title" content="Adaptive Control of 6-DOF Robot Manipulators">'
        b'<meta name="citation_author" content="Nguyen, Van A">'
        b'<meta name="citation_author" content="Tran, Thi B">'
        b'<meta name="citation_doi" content="https://doi.org/10.1109/TRO.2023.1234567">'
        b'<meta name="citation_publication_date" content="2023/05/12">'
    )
    # Pad first chunk to 4096 bytes so total chunks align cleanly with 65,536 bytes
    padded_prefix = head_prefix + b" " * (4096 - len(head_prefix))
    infinite_stream = _InfiniteHtmlStream(padded_prefix, chunk_size=4096)

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            headers={"Content-Type": "text/html; charset=utf-8"},
            stream=infinite_stream,
            request=request,
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler), follow_redirects=False) as client:
        verifier = SafeHtmlMetaVerifier(
            resolver=lambda host, port=443, *a, **kw: _make_addrinfo("93.184.216.34", port),
            client=client,
        )
        meta = await verifier.fetch_meta("https://journal.public.example/article/42")

    assert meta is not None
    assert infinite_stream.bytes_yielded <= MAX_HTML_HEAD_BYTES
    assert infinite_stream.closed is True
    assert meta.page_title == "Adaptive Control of 6-DOF Robot Manipulators"
    assert meta.citation_title == "Adaptive Control of 6-DOF Robot Manipulators"
    assert meta.citation_authors == ["Nguyen, Van A", "Tran, Thi B"]
    assert meta.citation_doi == "10.1109/tro.2023.1234567"
    assert meta.published_year == "2023"
    assert meta.is_soft_404 is False


@pytest.mark.asyncio
async def test_bounded_stream_stops_early_at_head_close_tag() -> None:
    chunks_read = 0

    class _EarlyHeadCloseStream(httpx.AsyncByteStream):
        async def __aiter__(self) -> AsyncIterator[bytes]:
            nonlocal chunks_read
            chunks_read += 1
            yield (
                b"<html><head><title>Short Head Page</title>"
                b'<meta name="citation_doi" content="10.1145/9999999.1111111"></head><body>'
            )
            for _ in range(50):
                chunks_read += 1
                yield b"X" * 8192

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            headers={"Content-Type": "text/html"},
            stream=_EarlyHeadCloseStream(),
            request=request,
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler), follow_redirects=False) as client:
        verifier = SafeHtmlMetaVerifier(
            resolver=lambda host, port=443, *a, **kw: _make_addrinfo("93.184.216.34", port),
            client=client,
        )
        meta = await verifier.fetch_meta("https://dl.public.example/paper")

    assert meta is not None
    assert chunks_read == 1
    assert meta.page_title == "Short Head Page"
    assert meta.citation_doi == "10.1145/9999999.1111111"


# ============================================================================
# 3. Soft-404 Downgrade & Decoy URL Detection (R-URL-CONTENT-MISMATCH)
# ============================================================================


@pytest.mark.asyncio
async def test_soft_404_downgrades_link_validator_to_dead_link_without_false_positive_on_404_article() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/missing-post":
            return httpx.Response(
                200,
                headers={"Content-Type": "text/html; charset=utf-8"},
                text="<html><head><title>404 - Không tìm thấy trang</title></head><body>Bài viết đã bị xóa</body></html>",
                request=request,
            )
        return httpx.Response(
            200,
            headers={"Content-Type": "text/html; charset=utf-8"},
            text="<html><head><title>Understanding HTTP 404 Errors in REST APIs</title></head><body>Technical guide</body></html>",
            request=request,
        )

    lv = LinkValidator(
        timeout=3.0,
        enable_wayback_fallback=False,
        resolver=lambda host, port=443, *a, **kw: _make_addrinfo("93.184.216.34", port),
        transport=httpx.MockTransport(handler),
    )

    soft_404_res = await lv.validate_url("https://portal.public.example/missing-post")
    assert soft_404_res.status == LinkStatus.DEAD_LINK
    assert soft_404_res.html_meta is not None
    assert soft_404_res.html_meta.is_soft_404 is True

    tech_404_res = await lv.validate_url("https://portal.public.example/http-404-guide")
    assert tech_404_res.status == LinkStatus.ALIVE
    assert tech_404_res.html_meta is not None
    assert tech_404_res.html_meta.is_soft_404 is False


def test_decoy_url_triggers_r_url_content_mismatch_while_gatekeeper_and_matching_titles_pass() -> None:
    rules = SymbolicRules()
    decoy_url = "https://vnexpress.net/gia-vang-sjc-hom-nay-4700000.html"
    cited_title = "Điều khiển thích nghi cánh tay robot 6 bậc tự do"

    decoy_source = SourceResult(
        citation_raw=f"Nguyễn Văn A (2024). {cited_title}. Truy cập từ {decoy_url}",
        candidates=[],
        sources_queried=["crossref", "openalex"],
        sources_succeeded=[],
        sources_failed={
            "crossref": "Crossref: no results",
            "openalex": "OpenAlex: no results",
        },
        url_status="alive",
        url_status_code=200,
        html_meta=HtmlPageMeta(page_title="Giá vàng SJC hôm nay - VnExpress"),
    )

    outcome = rules.apply(
        MatchFeatures(),
        decoy_source,
        citation_title=cited_title,
        citation_url=decoy_url,
        citation_authors=["Nguyễn Văn A"],
        citation_year="2024",
        citation_raw=decoy_source.citation_raw,
    )
    assert outcome.label == ValidationLabel.METADATA_ERROR
    assert "R-URL-CONTENT-MISMATCH" in outcome.triggered_rules
    assert "url" in outcome.mismatched_fields
    assert "title" in outcome.mismatched_fields

    # Also verify full NeuroSymbolicChecker pipeline does not whitelist decoy URL as RESOURCE
    checker = NeuroSymbolicChecker(
        feature_calculator=FeatureCalculator(enable_content_alignment=False),
        enable_content_alignment=False,
    )
    cit = Citation(
        raw_text=decoy_source.citation_raw,
        title=cited_title,
        authors=["Nguyễn Văn A"],
        year="2024",
        url=decoy_url,
        citation_type=CitationType.REFERENCE_LIST,
        style=CitationStyle.APA,
    )
    verdict = checker.check(cit, decoy_source)
    assert verdict.label == ValidationLabel.METADATA_ERROR
    assert "R-URL-CONTENT-MISMATCH" in verdict.triggered_rules
    assert "url" in verdict.mismatched_fields
    assert "title" in verdict.mismatched_fields

    # Gatekeeper / Cloudflare challenge title must NOT trigger R-URL-CONTENT-MISMATCH
    cloudflare_source = SourceResult(
        citation_raw=decoy_source.citation_raw,
        candidates=[],
        sources_queried=[],
        sources_succeeded=[],
        url_status="alive",
        url_status_code=200,
        html_meta=HtmlPageMeta(page_title="Just a moment... | Cloudflare"),
    )
    cf_outcome = rules.apply(
        MatchFeatures(),
        cloudflare_source,
        citation_title=cited_title,
        citation_url="https://viblo.asia/p/robot-6-dof",
        citation_authors=["Nguyễn Văn A"],
        citation_year="2024",
        citation_raw=decoy_source.citation_raw,
    )
    assert "R-URL-CONTENT-MISMATCH" not in cf_outcome.triggered_rules
    assert cf_outcome.label == ValidationLabel.RESOURCE

    # Matching live page with site suffix must remain RESOURCE
    matching_source = SourceResult(
        citation_raw=decoy_source.citation_raw,
        candidates=[],
        sources_queried=[],
        sources_succeeded=[],
        url_status="alive",
        url_status_code=200,
        html_meta=HtmlPageMeta(page_title="Điều khiển thích nghi cánh tay robot 6 bậc tự do - Viblo"),
    )
    match_outcome = rules.apply(
        MatchFeatures(),
        matching_source,
        citation_title=cited_title,
        citation_url="https://viblo.asia/p/robot-6-dof",
        citation_authors=["Nguyễn Văn A"],
        citation_year="2024",
        citation_raw=decoy_source.citation_raw,
    )
    assert "R-URL-CONTENT-MISMATCH" not in match_outcome.triggered_rules
    assert match_outcome.label == ValidationLabel.RESOURCE


# ============================================================================
# 4. VN Standards (TCVN / QCVN) & University Textbooks
# ============================================================================


@pytest.mark.asyncio
async def test_tech_standard_client_resolves_tcvn_qcvn_and_vn_textbooks() -> None:
    client = TechStandardClient()

    # 4a. TCVN 5574:2018
    cit_tcvn = Citation(
        raw_text="Bộ Khoa học và Công nghệ (2018). TCVN 5574:2018 Thiết kế kết cấu bê tông và bê tông cốt thép.",
        title="TCVN 5574:2018 Thiết kế kết cấu bê tông và bê tông cốt thép",
        authors=["Bộ Khoa học và Công nghệ"],
        year="2018",
        citation_type=CitationType.REFERENCE_LIST,
        style=CitationStyle.APA,
    )
    assert TechStandardClient.has_tech_target(cit_tcvn) is True
    cand_tcvn = await client.lookup(cit_tcvn)
    assert cand_tcvn.found is True
    assert cand_tcvn.year == "2018"
    assert "5574" in (cand_tcvn.title or "")
    assert cand_tcvn.confidence >= 0.95

    # 4b. QCVN 06:2022/BXD
    cit_qcvn = Citation(
        raw_text="Bộ Xây dựng (2022). QCVN 06:2022/BXD Quy chuẩn kỹ thuật quốc gia về an toàn cháy cho nhà và công trình.",
        title="QCVN 06:2022/BXD Quy chuẩn kỹ thuật quốc gia về an toàn cháy cho nhà và công trình",
        authors=["Bộ Xây dựng"],
        year="2022",
        citation_type=CitationType.REFERENCE_LIST,
        style=CitationStyle.APA,
    )
    assert TechStandardClient.has_tech_target(cit_qcvn) is True
    cand_qcvn = await client.lookup(cit_qcvn)
    assert cand_qcvn.found is True
    assert cand_qcvn.year == "2022"
    assert "QCVN 06:2022/BXD" in (cand_qcvn.title or "") or cand_qcvn.external_ids.get("vn_standard_code") == "QCVN 06:2022/BXD"
    assert "Bộ Xây dựng" in cand_qcvn.authors
    assert cand_qcvn.confidence >= 0.95

    # 4c. Curated Vietnamese University Textbook (NXB Bách Khoa / NXB Khoa học và Kỹ thuật)
    cit_textbook = Citation(
        raw_text="Nguyễn Doãn Phước (2009). Lý thuyết điều khiển tuyến tính. NXB Khoa học và Kỹ thuật.",
        title="Lý thuyết điều khiển tuyến tính",
        authors=["Nguyễn Doãn Phước"],
        year="2009",
        venue="NXB Khoa học và Kỹ thuật",
        citation_type=CitationType.REFERENCE_LIST,
        style=CitationStyle.APA,
    )
    assert TechStandardClient.has_tech_target(cit_textbook) is True
    cand_tb = await client.lookup(cit_textbook)
    assert cand_tb.found is True
    assert cand_tb.confidence >= 0.94

    checker = NeuroSymbolicChecker(
        feature_calculator=FeatureCalculator(enable_content_alignment=False),
        enable_content_alignment=False,
    )
    tb_source = SourceResult(
        citation_raw=cit_textbook.raw_text,
        candidates=[cand_tb],
        sources_queried=["tech_standard"],
        sources_succeeded=["tech_standard"],
    )
    tb_verdict = checker.check(cit_textbook, tb_source)
    assert tb_verdict.label == ValidationLabel.VERIFIED


# ============================================================================
# 5. Edge Cases: Non-HTML Skip, Redirect Limit, Cross-Lingual, Cache & Orchestrator
# ============================================================================


@pytest.mark.asyncio
async def test_verifier_skips_non_html_and_enforces_max_redirects() -> None:
    hops = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal hops
        if request.url.path.endswith(".pdf"):
            return httpx.Response(
                200,
                headers={"Content-Type": "application/pdf"},
                content=b"%PDF-1.7 binary content",
                request=request,
            )
        if request.url.path.startswith("/loop"):
            hops += 1
            return httpx.Response(
                302,
                headers={"Location": f"/loop-{hops}"},
                request=request,
            )
        return httpx.Response(200, text="<html><head><title>OK</title></head></html>", request=request)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler), follow_redirects=False) as client:
        verifier = SafeHtmlMetaVerifier(
            resolver=lambda host, port=443, *a, **kw: _make_addrinfo("93.184.216.34", port),
            client=client,
            max_redirects=3,
        )
        assert await verifier.fetch_meta("https://files.public.example/paper.pdf") is None
        assert await verifier.fetch_meta("https://files.public.example/loop") is None
        assert hops == 4  # initial request + 3 redirects max


def test_cross_lingual_vietnamese_to_english_page_title_not_false_flagged_and_cache_roundtrip() -> None:
    from integrity_checker.retrieval.persistent_cache import (
        _deserialize_source_result,
        _serialize_source_result,
    )

    rules = SymbolicRules()
    vi_cited_title = "Ứng dụng học sâu và mạng nơ-ron trong điều khiển robot"
    en_live_source = SourceResult(
        citation_raw=f"Trần Văn B (2024). {vi_cited_title}. Truy cập từ https://docs.public.example/dl-robot",
        candidates=[],
        sources_queried=[],
        sources_succeeded=[],
        url_status="alive",
        url_status_code=200,
        html_meta=HtmlPageMeta(
            page_title="Deep Learning and Neural Network Applications in Robot Control | Docs",
            citation_doi="10.1109/access.2024.111111",
            published_year="2024",
        ),
    )

    outcome = rules.apply(
        MatchFeatures(),
        en_live_source,
        citation_title=vi_cited_title,
        citation_url="https://docs.public.example/dl-robot",
        citation_authors=["Trần Văn B"],
        citation_year="2024",
        citation_raw=en_live_source.citation_raw,
    )
    assert "R-URL-CONTENT-MISMATCH" not in outcome.triggered_rules
    assert outcome.label == ValidationLabel.RESOURCE

    # Verify PersistentVerificationCache serialization roundtrip preserves html_meta
    restored = _deserialize_source_result(_serialize_source_result(en_live_source))
    assert restored.html_meta is not None
    assert restored.html_meta.page_title == en_live_source.html_meta.page_title
    assert restored.html_meta.citation_doi == "10.1109/access.2024.111111"
    assert restored.html_meta.published_year == "2024"


@pytest.mark.asyncio
async def test_orchestrator_routes_tcvn_qcvn_textbooks_and_enriches_html_meta_doi() -> None:
    from types import SimpleNamespace
    from unittest.mock import AsyncMock

    from integrity_checker.models.source import SourceCandidate
    from integrity_checker.retrieval.retrieval_orchestrator import RetrievalOrchestrator

    crossref_stub = SimpleNamespace(
        name="crossref",
        lookup=AsyncMock(
            side_effect=lambda c: SourceCandidate(
                source_name="crossref",
                found=bool(c.doi == "10.1109/tro.2024.7777777"),
                doi=c.doi,
                title="Adaptive Control of 6-DOF Robot Manipulators",
                authors=["Van A Nguyen"],
                year="2024",
                confidence=0.98,
                error=None if c.doi == "10.1109/tro.2024.7777777" else "Crossref: no results",
            )
        ),
    )
    openalex_stub = SimpleNamespace(
        name="openalex",
        lookup=AsyncMock(return_value=SourceCandidate(source_name="openalex", found=False, error="OpenAlex: no results")),
    )

    def lv_handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            headers={"Content-Type": "text/html; charset=utf-8"},
            text=(
                "<html><head>"
                "<title>Adaptive Control of 6-DOF Robot Manipulators | Publisher</title>"
                '<meta name="citation_doi" content="10.1109/TRO.2024.7777777">'
                "</head><body></body></html>"
            ),
            request=request,
        )

    lv = LinkValidator(
        timeout=3.0,
        enable_wayback_fallback=False,
        resolver=lambda host, port=443, *a, **kw: _make_addrinfo("93.184.216.34", port),
        transport=httpx.MockTransport(lv_handler),
    )
    orch = RetrievalOrchestrator(
        crossref=crossref_stub,
        openalex=openalex_stub,
        tech_standard=TechStandardClient(),
        link_validator=lv,
        enable_link_validation=True,
        use_local_db=False,
        use_persistent_cache=False,
    )

    # 1. Orchestrator routes QCVN 06:2022/BXD directly to TechStandardClient
    cit_qcvn = Citation(
        raw_text="Bộ Xây dựng (2022). QCVN 06:2022/BXD Quy chuẩn kỹ thuật quốc gia về an toàn cháy cho nhà và công trình.",
        title="QCVN 06:2022/BXD Quy chuẩn kỹ thuật quốc gia về an toàn cháy cho nhà và công trình",
        authors=["Bộ Xây dựng"],
        year="2022",
        citation_type=CitationType.REFERENCE_LIST,
    )
    res_qcvn = await orch.retrieve(cit_qcvn)
    assert "tech_standard" in res_qcvn.sources_succeeded
    assert res_qcvn.best_candidate() is not None
    assert res_qcvn.best_candidate().year == "2022"

    # 2. Orchestrator cross-checks HTML <meta name="citation_doi"> when citation.doi is absent
    cit_web_paper = Citation(
        raw_text="Nguyen, V. A. (2024). Adaptive Control of 6-DOF Robot Manipulators. Retrieved from https://pub.public.example/article/77",
        title="Adaptive Control of 6-DOF Robot Manipulators",
        authors=["Van A Nguyen"],
        year="2024",
        url="https://pub.public.example/article/77",
        citation_type=CitationType.REFERENCE_LIST,
    )
    res_web_paper = await orch.retrieve(cit_web_paper)
    assert res_web_paper.html_meta is not None
    assert res_web_paper.html_meta.citation_doi == "10.1109/tro.2024.7777777"
    assert res_web_paper.best_candidate() is not None
    assert res_web_paper.best_candidate().doi == "10.1109/tro.2024.7777777"


# ============================================================================
# 6. Fix Round 1 Regression Tests (Findings 1–6)
# ============================================================================


@pytest.mark.asyncio
async def test_round1_finding1_fabricated_and_wrong_year_tcvn_qcvn_not_false_verified() -> None:
    from types import SimpleNamespace
    from unittest.mock import AsyncMock

    from integrity_checker.models.source import SourceCandidate
    from integrity_checker.retrieval.retrieval_orchestrator import RetrievalOrchestrator

    empty_stub = lambda name: SimpleNamespace(  # noqa: E731
        name=name,
        lookup=AsyncMock(return_value=SourceCandidate(source_name=name, found=False, error=f"{name}: no results")),
    )
    orch = RetrievalOrchestrator(
        crossref=empty_stub("crossref"),
        openalex=empty_stub("openalex"),
        tech_standard=TechStandardClient(),
        enable_link_validation=False,
        use_local_db=False,
        use_persistent_cache=False,
    )
    checker = NeuroSymbolicChecker(
        feature_calculator=FeatureCalculator(enable_content_alignment=False),
        enable_content_alignment=False,
    )

    # 1a. Fabricated / uncurated TCVN 99999:2024 MUST NOT be VERIFIED
    cit_fab_tcvn = Citation(
        raw_text="Bộ Khoa học và Công nghệ (2024). TCVN 99999:2024 Quy trình chế tạo động cơ phản lực hạt nhân.",
        title="TCVN 99999:2024 Quy trình chế tạo động cơ phản lực hạt nhân",
        authors=["Bộ Khoa học và Công nghệ"],
        year="2024",
        citation_type=CitationType.REFERENCE_LIST,
    )
    cand_fab = await TechStandardClient().lookup(cit_fab_tcvn)
    assert cand_fab.found is False
    src_fab = await orch.retrieve(cit_fab_tcvn)
    verdict_fab = checker.check(cit_fab_tcvn, src_fab)
    assert verdict_fab.label != ValidationLabel.VERIFIED
    assert "R-VN-STANDARD-VERIFIED" not in verdict_fab.triggered_rules

    # 1b. Wrong-year curated TCVN 5574:2021 (official: 2018 / 2012) -> METADATA_ERROR (year)
    cit_wrong_yr = Citation(
        raw_text="Bộ Khoa học và Công nghệ (2021). TCVN 5574:2021 Thiết kế kết cấu bê tông và bê tông cốt thép.",
        title="TCVN 5574:2021 Thiết kế kết cấu bê tông và bê tông cốt thép",
        authors=["Bộ Khoa học và Công nghệ"],
        year="2021",
        citation_type=CitationType.REFERENCE_LIST,
    )
    src_wrong_yr = await orch.retrieve(cit_wrong_yr)
    verdict_wrong_yr = checker.check(cit_wrong_yr, src_wrong_yr)
    assert verdict_wrong_yr.label == ValidationLabel.METADATA_ERROR
    assert "year" in verdict_wrong_yr.mismatched_fields

    # 1c. Curated TCVN 5574:2018 with completely fabricated unrelated title -> METADATA_ERROR (title)
    cit_wrong_title = Citation(
        raw_text="Bộ Khoa học và Công nghệ (2018). TCVN 5574:2018 Quy trình nuôi trồng thủy sản nước lợ ven biển.",
        title="TCVN 5574:2018 Quy trình nuôi trồng thủy sản nước lợ ven biển",
        authors=["Bộ Khoa học và Công nghệ"],
        year="2018",
        citation_type=CitationType.REFERENCE_LIST,
    )
    src_wrong_title = await orch.retrieve(cit_wrong_title)
    verdict_wrong_title = checker.check(cit_wrong_title, src_wrong_title)
    assert verdict_wrong_title.label == ValidationLabel.METADATA_ERROR
    assert "title" in verdict_wrong_title.mismatched_fields


@pytest.mark.parametrize(
    "inet_aton_url",
    [
        "http://2130706433/admin",
        "http://0x7f000001/latest",
        "http://0177.0.0.1/secret",
        "http://127.1/internal",
        "http://127.0.1/internal",
        "http://0x7f.0.0.1/internal",
        "http://[::ffff:0177.0.0.1]/",
    ],
)
def test_round1_finding2_blocks_non_canonical_inet_aton_ipv4_literals(inet_aton_url: str) -> None:
    from integrity_checker.retrieval.html_meta_verifier import validate_url_syntax_and_literal_ip

    resolver_called = False

    def spy_resolver(*args, **kwargs):
        nonlocal resolver_called
        resolver_called = True
        return _make_addrinfo("93.184.216.34", 80)

    syn_ok, _reason, _, _ = validate_url_syntax_and_literal_ip(inet_aton_url)
    assert syn_ok is False
    pub_ok, _ = validate_public_target_ips(inet_aton_url, resolver=spy_resolver)
    assert pub_ok is False
    assert resolver_called is False


@pytest.mark.asyncio
async def test_round1_finding2_network_backend_pins_verified_ip_against_live_dns_rebinding() -> None:
    import httpcore

    from integrity_checker.retrieval.html_meta_verifier import (
        SSRFBlockedError,
        SSRFSafeAsyncNetworkBackend,
        build_ssrf_safe_transport,
    )

    connected_targets: list[tuple[str, int]] = []

    class _FakeInnerBackend(httpcore.AsyncNetworkBackend):
        async def connect_tcp(
            self,
            host: str,
            port: int,
            timeout=None,  # noqa: ASYNC109
            local_address=None,
            socket_options=None,
        ):
            connected_targets.append((host, port))
            raise httpcore.ConnectError("simulated post-pin socket stop")

        async def connect_unix_socket(
            self,
            path: str,
            timeout=None,  # noqa: ASYNC109
            socket_options=None,
        ):
            raise AssertionError("unix socket never allowed")

        async def sleep(self, seconds: float) -> None:
            return None

    # 1. Stateful DNS rebinding resolver: 1st call returns public IP, 2nd call returns 127.0.0.1
    calls = 0

    def rebinding_resolver(host: str, port: int = 443, *args, **kwargs):
        nonlocal calls
        calls += 1
        if calls == 1:
            return _make_addrinfo("93.184.216.34", port)
        return _make_addrinfo("127.0.0.1", port)

    safe_backend = SSRFSafeAsyncNetworkBackend(
        resolver=rebinding_resolver,
        inner_backend=_FakeInnerBackend(),
    )

    # Call #1 resolves once and pins literal "93.184.216.34" into inner connect_tcp (not hostname!)
    with pytest.raises(httpcore.ConnectError):
        await safe_backend.connect_tcp("rebind.scholar.example", 443)
    assert connected_targets == [("93.184.216.34", 443)]

    # Call #2 sees rebinding to 127.0.0.1 and aborts BEFORE inner connect_tcp is ever called!
    with pytest.raises(SSRFBlockedError):
        await safe_backend.connect_tcp("rebind.scholar.example", 443)
    assert connected_targets == [("93.184.216.34", 443)]

    # Verify default transport builder wires SSRFSafeAsyncNetworkBackend into httpcore pool,
    # and end-to-end LinkValidator / SafeHtmlMetaVerifier block rebinding via default transport
    transport = build_ssrf_safe_transport(resolver=rebinding_resolver)
    assert isinstance(transport._pool._network_backend, SSRFSafeAsyncNetworkBackend)

    lv_rebind = LinkValidator(enable_wayback_fallback=False, resolver=rebinding_resolver)
    lv_res = await lv_rebind.validate_url("https://rebind.scholar.example/paper")
    assert lv_res.status == LinkStatus.FAKE_DOMAIN
    assert "ssrf blocked" in (lv_res.error or "").lower()

    meta_rebind = SafeHtmlMetaVerifier(resolver=rebinding_resolver)
    assert await meta_rebind.fetch_meta("https://rebind.scholar.example/paper") is None


@pytest.mark.asyncio
async def test_round1_finding3_decoy_html_meta_doi_rejected_and_valid_html_doi_verified() -> None:
    from types import SimpleNamespace
    from unittest.mock import AsyncMock

    from integrity_checker.models.source import SourceCandidate
    from integrity_checker.retrieval.retrieval_orchestrator import RetrievalOrchestrator

    def crossref_lookup(c: Citation) -> SourceCandidate:
        if c.doi == "10.1038/s41586-024-00001-1":
            return SourceCandidate(
                source_name="crossref",
                found=True,
                doi=c.doi,
                title="Gold Nanoparticle Synthesis in Aqueous Solution",
                authors=["Alice Chemist"],
                year="2024",
                confidence=0.98,
            )
        if c.doi == "10.1109/tro.2024.7777777":
            return SourceCandidate(
                source_name="crossref",
                found=True,
                doi=c.doi,
                title="Adaptive Control of 6-DOF Robot Manipulators",
                authors=["Van A Nguyen", "Thi B Tran"],
                year="2024",
                confidence=0.98,
            )
        return SourceCandidate(source_name="crossref", found=False, error="Crossref: no results")

    crossref_stub = SimpleNamespace(name="crossref", lookup=AsyncMock(side_effect=crossref_lookup))
    openalex_stub = SimpleNamespace(
        name="openalex",
        lookup=AsyncMock(return_value=SourceCandidate(source_name="openalex", found=False, error="OpenAlex: no results")),
    )

    def lv_handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/decoy-paper":
            return httpx.Response(
                200,
                headers={"Content-Type": "text/html; charset=utf-8"},
                text=(
                    "<html><head>"
                    "<title>Gold Nanoparticle Synthesis in Aqueous Solution | Nature</title>"
                    '<meta name="citation_doi" content="10.1038/s41586-024-00001-1">'
                    "</head><body></body></html>"
                ),
                request=request,
            )
        return httpx.Response(
            200,
            headers={"Content-Type": "text/html; charset=utf-8"},
            text=(
                "<html><head>"
                "<title>Adaptive Control of 6-DOF Robot Manipulators | Publisher</title>"
                '<meta name="citation_doi" content="10.1109/TRO.2024.7777777">'
                "</head><body></body></html>"
            ),
            request=request,
        )

    lv = LinkValidator(
        timeout=4.0,
        enable_wayback_fallback=False,
        resolver=lambda host, port=443, *a, **kw: _make_addrinfo("93.184.216.34", port),
        transport=httpx.MockTransport(lv_handler),
    )
    orch = RetrievalOrchestrator(
        crossref=crossref_stub,
        openalex=openalex_stub,
        link_validator=lv,
        enable_link_validation=True,
        use_local_db=False,
        use_persistent_cache=False,
    )
    checker = NeuroSymbolicChecker(
        feature_calculator=FeatureCalculator(enable_content_alignment=False),
        enable_content_alignment=False,
    )

    # 3a. Decoy paper URL with unrelated citation_doi MUST trigger R-URL-CONTENT-MISMATCH
    cit_decoy_doi = Citation(
        raw_text="Nguyễn Văn A (2024). Điều khiển thích nghi cánh tay robot 6 bậc tự do. Truy cập từ https://pub.public.example/decoy-paper",
        title="Điều khiển thích nghi cánh tay robot 6 bậc tự do",
        authors=["Nguyễn Văn A"],
        year="2024",
        url="https://pub.public.example/decoy-paper",
        citation_type=CitationType.REFERENCE_LIST,
    )
    src_decoy_doi = await orch.retrieve(cit_decoy_doi)
    assert src_decoy_doi.candidates == []
    verdict_decoy_doi = checker.check(cit_decoy_doi, src_decoy_doi)
    assert verdict_decoy_doi.label == ValidationLabel.METADATA_ERROR
    assert "R-URL-CONTENT-MISMATCH" in verdict_decoy_doi.triggered_rules

    # 3b. Valid web-cited academic paper (even authorless / single Crossref hit) upgrades to VERIFIED via HTML citation_doi
    cit_valid_html_doi = Citation(
        raw_text="Adaptive Control of 6-DOF Robot Manipulators (2024). Retrieved from https://pub.public.example/article/77",
        title="Adaptive Control of 6-DOF Robot Manipulators",
        authors=[],
        year="2024",
        url="https://pub.public.example/article/77",
        citation_type=CitationType.REFERENCE_LIST,
    )
    src_valid_html_doi = await orch.retrieve(cit_valid_html_doi)
    verdict_valid_html_doi = checker.check(cit_valid_html_doi, src_valid_html_doi)
    assert verdict_valid_html_doi.label == ValidationLabel.VERIFIED
    assert "R-DOI-TITLE-AUTHOR" in verdict_valid_html_doi.triggered_rules

    # 3c. Pure bare URL with no cited title/authors remains RESOURCE
    cit_bare_url = Citation(
        raw_text="https://pub.public.example/article/77",
        title=None,
        authors=[],
        url="https://pub.public.example/article/77",
        citation_type=CitationType.REFERENCE_LIST,
    )
    src_bare_url = await orch.retrieve(cit_bare_url)
    verdict_bare_url = checker.check(cit_bare_url, src_bare_url)
    assert verdict_bare_url.label == ValidationLabel.RESOURCE


def test_round1_finding4_live_semantic_similarity_prevents_false_url_mismatch_without_vi_decoy_leak() -> None:
    from integrity_checker.retrieval.html_meta_verifier import compute_url_title_match_score

    checker = NeuroSymbolicChecker(
        feature_calculator=FeatureCalculator(enable_content_alignment=False),
        enable_content_alignment=False,
    )

    # 4a. Paraphrased English title with ZERO lexical token overlap passes via live SemanticMatcher
    en_cited = "Preventing SQL Injection Vulnerabilities in Web Applications"
    en_meta = HtmlPageMeta(
        page_title="Mitigating Database Query Tampering in Modern Backends | Security Guide"
    )
    assert (compute_url_title_match_score(en_cited, en_meta) or 0.0) < 0.20

    en_source = SourceResult(
        citation_raw=f"OWASP Team (2024). {en_cited}. Retrieved from https://sec.public.example/sqli",
        candidates=[],
        sources_queried=[],
        sources_succeeded=[],
        url_status="alive",
        url_status_code=200,
        html_meta=en_meta,
    )
    en_cit = Citation(
        raw_text=en_source.citation_raw,
        title=en_cited,
        authors=["OWASP Team"],
        year="2024",
        url="https://sec.public.example/sqli",
        citation_type=CitationType.REFERENCE_LIST,
    )
    en_verdict = checker.check(en_cit, en_source)
    assert "R-URL-CONTENT-MISMATCH" not in en_verdict.triggered_rules
    assert en_verdict.label == ValidationLabel.RESOURCE

    # 4b. Unrelated Vietnamese diacritic decoy ("điện mặt trời" -> "nấu phở bò") MUST still trigger R-URL-CONTENT-MISMATCH
    vi_cited = "Thiết kế bộ nghịch lưu áp ba pha cho hệ thống điện mặt trời"
    vi_decoy_source = SourceResult(
        citation_raw=f"Lê Văn C (2024). {vi_cited}. Truy cập từ https://amthuc.public.example/pho-bo",
        candidates=[],
        sources_queried=[],
        sources_succeeded=[],
        url_status="alive",
        url_status_code=200,
        html_meta=HtmlPageMeta(page_title="Cách nấu phở bò Nam Định thơm ngon chuẩn vị"),
    )
    vi_decoy_cit = Citation(
        raw_text=vi_decoy_source.citation_raw,
        title=vi_cited,
        authors=["Lê Văn C"],
        year="2024",
        url="https://amthuc.public.example/pho-bo",
        citation_type=CitationType.REFERENCE_LIST,
    )
    vi_verdict = checker.check(vi_decoy_cit, vi_decoy_source)
    assert vi_verdict.label == ValidationLabel.METADATA_ERROR
    assert "R-URL-CONTENT-MISMATCH" in vi_verdict.triggered_rules


@pytest.mark.asyncio
async def test_round1_finding5_link_validator_default_timeout_4s_and_head_200_get_guards() -> None:
    assert LinkValidator().timeout == 4.0

    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "HEAD":
            return httpx.Response(200, headers={"Content-Type": "text/html"}, request=request)
        if request.url.path.startswith("/get-loop"):
            return httpx.Response(302, headers={"Location": "/get-loop-next"}, request=request)
        if request.url.path == "/get-403":
            return httpx.Response(403, headers={"Content-Type": "text/html"}, request=request)
        return httpx.Response(404, headers={"Content-Type": "text/html"}, request=request)

    lv = LinkValidator(
        enable_wayback_fallback=False,
        resolver=lambda host, port=443, *a, **kw: _make_addrinfo("93.184.216.34", port),
        transport=httpx.MockTransport(handler),
        max_redirects=3,
    )

    loop_res = await lv.validate_url("https://portal.public.example/get-loop")
    assert loop_res.status == LinkStatus.UNCHECKED
    assert "redirect" in (loop_res.error or "").lower()

    forb_res = await lv.validate_url("https://portal.public.example/get-403")
    assert forb_res.status == LinkStatus.RESTRICTED_ALIVE
    assert forb_res.status_code == 403

    missing_res = await lv.validate_url("https://portal.public.example/get-404")
    assert missing_res.status == LinkStatus.DEAD_LINK
    assert missing_res.status_code == 404


@pytest.mark.asyncio
async def test_round1_finding6_vn_textbook_negative_cases_and_author_mismatch_rule() -> None:
    client = TechStandardClient()
    checker = NeuroSymbolicChecker(
        feature_calculator=FeatureCalculator(enable_content_alignment=False),
        enable_content_alignment=False,
    )

    # 6a. Co-author token-union spoof ("Nguyễn" + "Xuân" + "Thành" split across 3 different co-authors)
    cit_union_spoof = Citation(
        raw_text="Nguyễn Xuân Thành (2006). Lý thuyết điều khiển phi tuyến. NXB Khoa học và Kỹ thuật.",
        title="Lý thuyết điều khiển phi tuyến",
        authors=["Nguyễn Xuân Thành"],
        year="2006",
        venue="NXB Khoa học và Kỹ thuật",
        citation_type=CitationType.REFERENCE_LIST,
    )
    assert TechStandardClient.match_vn_textbook(cit_union_spoof) is None
    assert (await client.lookup(cit_union_spoof)).found is False

    # 6b. Empty citation.authors when raw_text begins with a wrong author + matching publisher
    cit_raw_wrong_author = Citation(
        raw_text="Trần Văn Giả (2009). Lý thuyết điều khiển tuyến tính. NXB Khoa học và Kỹ thuật.",
        title="Lý thuyết điều khiển tuyến tính",
        authors=[],
        year="2009",
        citation_type=CitationType.REFERENCE_LIST,
    )
    assert TechStandardClient.match_vn_textbook(cit_raw_wrong_author) is None

    # 6c. Generic short textbook title ("trí tuệ nhân tạo") inside a longer paper raw_text when title=None
    cit_short_substring = Citation(
        raw_text="Lê Hoài Bắc (2022). Ứng dụng trí tuệ nhân tạo trong chẩn đoán ảnh y khoa. NXB ĐHQG TP.HCM.",
        title=None,
        authors=["Lê Hoài Bắc"],
        year="2022",
        citation_type=CitationType.REFERENCE_LIST,
    )
    assert TechStandardClient.match_vn_textbook(cit_short_substring) is None

    # 6d. SymbolicRules / NeuroSymbolicChecker enforces author_sim on vn_textbook_id candidates
    valid_cit = Citation(
        raw_text="Nguyễn Doãn Phước (2009). Lý thuyết điều khiển tuyến tính. NXB Khoa học và Kỹ thuật.",
        title="Lý thuyết điều khiển tuyến tính",
        authors=["Nguyễn Doãn Phước"],
        year="2009",
        citation_type=CitationType.REFERENCE_LIST,
    )
    tb_cand = await client.lookup(valid_cit)
    assert tb_cand.found is True

    wrong_author_cit = Citation(
        raw_text="Phạm Văn Sai (2009). Lý thuyết điều khiển tuyến tính. NXB Khoa học và Kỹ thuật.",
        title="Lý thuyết điều khiển tuyến tính",
        authors=["Phạm Văn Sai"],
        year="2009",
        citation_type=CitationType.REFERENCE_LIST,
    )
    wrong_author_verdict = checker.check(
        wrong_author_cit,
        SourceResult(
            citation_raw=wrong_author_cit.raw_text,
            candidates=[tb_cand],
            sources_queried=["tech_standard"],
            sources_succeeded=["tech_standard"],
        ),
    )
    assert wrong_author_verdict.label == ValidationLabel.METADATA_ERROR
    assert "authors" in wrong_author_verdict.mismatched_fields

    # 6e. Fabricated VN textbook never resolves as VERIFIED
    cit_fab_tb = Citation(
        raw_text="Nguyễn Văn Giả (2024). Giáo trình Lượng tử Siêu không gian Bậc 9. NXB Bách Khoa Hà Nội.",
        title="Giáo trình Lượng tử Siêu không gian Bậc 9",
        authors=["Nguyễn Văn Giả"],
        year="2024",
        venue="NXB Bách Khoa Hà Nội",
        citation_type=CitationType.REFERENCE_LIST,
    )
    assert (await client.lookup(cit_fab_tb)).found is False


# ============================================================================
# 7. Fix Round 2 Regression Tests (QCVN/TCVN Core Subject & Ministry Namespace)
# ============================================================================


@pytest.mark.asyncio
async def test_round2_qcvn_tcvn_core_subject_mismatch_and_per_ministry_namespace() -> None:
    from types import SimpleNamespace
    from unittest.mock import AsyncMock

    from integrity_checker.models.source import SourceCandidate
    from integrity_checker.retrieval.retrieval_orchestrator import RetrievalOrchestrator

    empty_stub = lambda name: SimpleNamespace(  # noqa: E731
        name=name,
        lookup=AsyncMock(
            return_value=SourceCandidate(
                source_name=name, found=False, error=f"{name}: no results"
            )
        ),
    )
    orch = RetrievalOrchestrator(
        crossref=empty_stub("crossref"),
        openalex=empty_stub("openalex"),
        tech_standard=TechStandardClient(),
        enable_link_validation=False,
        use_local_db=False,
        use_persistent_cache=False,
    )
    checker = NeuroSymbolicChecker(
        feature_calculator=FeatureCalculator(enable_content_alignment=False),
        enable_content_alignment=False,
    )

    # 2a. Curated QCVN 06:2022/BXD + standard "Quy chuẩn kỹ thuật quốc gia về ..." boilerplate
    #     with fabricated core subject MUST return METADATA_ERROR (title), NOT VERIFIED!
    cit_qcvn_fab_subj = Citation(
        raw_text=(
            "Bộ Xây dựng (2022). QCVN 06:2022/BXD Quy chuẩn kỹ thuật quốc gia về "
            "chế tạo động cơ phản lực hạt nhân."
        ),
        title="QCVN 06:2022/BXD Quy chuẩn kỹ thuật quốc gia về chế tạo động cơ phản lực hạt nhân",
        authors=["Bộ Xây dựng"],
        year="2022",
        citation_type=CitationType.REFERENCE_LIST,
    )
    src_qcvn_fab = await orch.retrieve(cit_qcvn_fab_subj)
    verdict_qcvn_fab = checker.check(cit_qcvn_fab_subj, src_qcvn_fab)
    assert verdict_qcvn_fab.label == ValidationLabel.METADATA_ERROR
    assert "title" in verdict_qcvn_fab.mismatched_fields
    assert "R-VN-STANDARD-VERIFIED" not in verdict_qcvn_fab.triggered_rules

    # Also verify when citation.title is None (only raw_text populated)
    cit_qcvn_fab_raw_only = Citation(
        raw_text=cit_qcvn_fab_subj.raw_text,
        title=None,
        authors=["Bộ Xây dựng"],
        year="2022",
        citation_type=CitationType.REFERENCE_LIST,
    )
    src_qcvn_fab_raw = await orch.retrieve(cit_qcvn_fab_raw_only)
    verdict_qcvn_fab_raw = checker.check(cit_qcvn_fab_raw_only, src_qcvn_fab_raw)
    assert verdict_qcvn_fab_raw.label == ValidationLabel.METADATA_ERROR
    assert "title" in verdict_qcvn_fab_raw.mismatched_fields

    # 2b. Curated TCVN 5574:2018 + "Tiêu chuẩn quốc gia về ..." boilerplate + fabricated subject
    cit_tcvn_fab_subj = Citation(
        raw_text=(
            "Bộ Khoa học và Công nghệ (2018). TCVN 5574:2018 Tiêu chuẩn quốc gia về "
            "quy trình nuôi trồng thủy sản nước lợ."
        ),
        title="TCVN 5574:2018 Tiêu chuẩn quốc gia về quy trình nuôi trồng thủy sản nước lợ",
        authors=["Bộ Khoa học và Công nghệ"],
        year="2018",
        citation_type=CitationType.REFERENCE_LIST,
    )
    src_tcvn_fab = await orch.retrieve(cit_tcvn_fab_subj)
    verdict_tcvn_fab = checker.check(cit_tcvn_fab_subj, src_tcvn_fab)
    assert verdict_tcvn_fab.label == ValidationLabel.METADATA_ERROR
    assert "title" in verdict_tcvn_fab.mismatched_fields

    # 2c. Same-ministry wrong year (QCVN 06:2019/BXD vs curated 2022/2021/BXD) -> METADATA_ERROR (year)
    cit_same_min_wrong_yr = Citation(
        raw_text=(
            "Bộ Xây dựng (2019). QCVN 06:2019/BXD Quy chuẩn kỹ thuật quốc gia về "
            "an toàn cháy cho nhà và công trình."
        ),
        title="QCVN 06:2019/BXD Quy chuẩn kỹ thuật quốc gia về an toàn cháy cho nhà và công trình",
        authors=["Bộ Xây dựng"],
        year="2019",
        citation_type=CitationType.REFERENCE_LIST,
    )
    src_same_min = await orch.retrieve(cit_same_min_wrong_yr)
    verdict_same_min = checker.check(cit_same_min_wrong_yr, src_same_min)
    assert verdict_same_min.label == ValidationLabel.METADATA_ERROR
    assert "year" in verdict_same_min.mismatched_fields
    assert "title" not in verdict_same_min.mismatched_fields

    # 2d. Different-ministry uncurated QCVN sharing number 01 or 06 (BCT / BNNPTNT vs curated BXD)
    #     MUST NOT match BXD as METADATA_ERROR and MUST NOT be falsely VERIFIED!
    for raw_other_min, title_other_min, auth_other_min, yr_other_min in [
        (
            "Bộ Công Thương (2020). QCVN 01:2020/BCT Quy chuẩn kỹ thuật quốc gia về yêu cầu thiết kế cửa hàng xăng dầu.",
            "QCVN 01:2020/BCT Quy chuẩn kỹ thuật quốc gia về yêu cầu thiết kế cửa hàng xăng dầu",
            "Bộ Công Thương",
            "2020",
        ),
        (
            "Bộ Nông nghiệp và Phát triển nông thôn (2021). QCVN 06:2021/BNNPTNT Quy chuẩn kỹ thuật quốc gia về thiết bị thủy lợi.",
            "QCVN 06:2021/BNNPTNT Quy chuẩn kỹ thuật quốc gia về thiết bị thủy lợi",
            "Bộ Nông nghiệp và Phát triển nông thôn",
            "2021",
        ),
    ]:
        cit_other_min = Citation(
            raw_text=raw_other_min,
            title=title_other_min,
            authors=[auth_other_min],
            year=yr_other_min,
            citation_type=CitationType.REFERENCE_LIST,
        )
        assert TechStandardClient.is_curated_vn_standard(cit_other_min) is False
        assert (await TechStandardClient().lookup(cit_other_min)).found is False
        src_other_min = await orch.retrieve(cit_other_min)
        verdict_other_min = checker.check(cit_other_min, src_other_min)
        assert verdict_other_min.label in (ValidationLabel.RESOURCE, ValidationLabel.UNRESOLVED)
        assert verdict_other_min.label != ValidationLabel.METADATA_ERROR
        assert verdict_other_min.label != ValidationLabel.VERIFIED


# ============================================================================
# 8. Fix Round 3 Regression Tests (APA Venue Split, Pre-Code Subject, ASCII Fold)
# ============================================================================


@pytest.mark.asyncio
async def test_round3_apa_venue_split_pre_code_subjects_and_ascii_folding() -> None:
    from types import SimpleNamespace
    from unittest.mock import AsyncMock

    from integrity_checker.extraction.patterns.apa import APAFormat
    from integrity_checker.models.source import SourceCandidate
    from integrity_checker.retrieval.retrieval_orchestrator import RetrievalOrchestrator

    empty_stub = lambda name: SimpleNamespace(  # noqa: E731
        name=name,
        lookup=AsyncMock(
            return_value=SourceCandidate(
                source_name=name, found=False, error=f"{name}: no results"
            )
        ),
    )
    orch = RetrievalOrchestrator(
        crossref=empty_stub("crossref"),
        openalex=empty_stub("openalex"),
        tech_standard=TechStandardClient(),
        enable_link_validation=False,
        use_local_db=False,
        use_persistent_cache=False,
    )
    checker = NeuroSymbolicChecker(
        feature_calculator=FeatureCalculator(enable_content_alignment=False),
        enable_content_alignment=False,
    )

    # 3a. Period-delimited APA parsed citation (title="QCVN 06:2022/BXD", subject in venue)
    apa_fab = APAFormat().parse_reference_entry(
        "Bộ Xây dựng (2022). QCVN 06:2022/BXD. Quy chuẩn kỹ thuật quốc gia về chế tạo động cơ phản lực hạt nhân."
    )
    assert apa_fab is not None
    src_apa_fab = await orch.retrieve(apa_fab)
    verdict_apa_fab = checker.check(apa_fab, src_apa_fab)
    assert verdict_apa_fab.label == ValidationLabel.METADATA_ERROR
    assert "title" in verdict_apa_fab.mismatched_fields

    # Valid period-delimited APA parsed citation must still VERIFY cleanly
    apa_valid = APAFormat().parse_reference_entry(
        "Bộ Xây dựng (2022). QCVN 06:2022/BXD. Quy chuẩn kỹ thuật quốc gia về an toàn cháy cho nhà và công trình."
    )
    assert apa_valid is not None
    src_apa_valid = await orch.retrieve(apa_valid)
    verdict_apa_valid = checker.check(apa_valid, src_apa_valid)
    assert verdict_apa_valid.label == ValidationLabel.VERIFIED

    # 3b. Subject-before-code (title=None) WITH boilerplate
    cit_pre_boiler = Citation(
        raw_text=(
            "Bộ Xây dựng (2022). Quy chuẩn kỹ thuật quốc gia về chế tạo động cơ phản lực hạt nhân "
            "(QCVN 06:2022/BXD)."
        ),
        title=None,
        authors=["Bộ Xây dựng"],
        year="2022",
        citation_type=CitationType.REFERENCE_LIST,
    )
    src_pre_boiler = await orch.retrieve(cit_pre_boiler)
    verdict_pre_boiler = checker.check(cit_pre_boiler, src_pre_boiler)
    assert verdict_pre_boiler.label == ValidationLabel.METADATA_ERROR
    assert "title" in verdict_pre_boiler.mismatched_fields

    # 3c. Subject-before-code (title=None) WITHOUT boilerplate
    cit_pre_plain = Citation(
        raw_text=(
            "Bộ Khoa học và Công nghệ (2018). Quy trình nuôi trồng thủy sản nước lợ ven biển "
            "(TCVN 5574:2018)."
        ),
        title=None,
        authors=["Bộ Khoa học và Công nghệ"],
        year="2018",
        citation_type=CitationType.REFERENCE_LIST,
    )
    src_pre_plain = await orch.retrieve(cit_pre_plain)
    verdict_pre_plain = checker.check(cit_pre_plain, src_pre_plain)
    assert verdict_pre_plain.label == ValidationLabel.METADATA_ERROR
    assert "title" in verdict_pre_plain.mismatched_fields

    # 3d. Stopword-heavy fake subject ("quy định đối với nhà") against TCVN 9386-1:2012
    cit_stopword_spoof = Citation(
        raw_text="Bộ Khoa học và Công nghệ (2012). TCVN 9386-1:2012 Tiêu chuẩn quốc gia về quy định đối với nhà.",
        title="TCVN 9386-1:2012 Tiêu chuẩn quốc gia về quy định đối với nhà",
        authors=["Bộ Khoa học và Công nghệ"],
        year="2012",
        citation_type=CitationType.REFERENCE_LIST,
    )
    src_stopword_spoof = await orch.retrieve(cit_stopword_spoof)
    verdict_stopword_spoof = checker.check(cit_stopword_spoof, src_stopword_spoof)
    assert verdict_stopword_spoof.label == ValidationLabel.METADATA_ERROR
    assert "title" in verdict_stopword_spoof.mismatched_fields

    # 3e. Valid diacritic-stripped / ASCII BibTeX citation -> ValidationLabel.VERIFIED
    apa_ascii_valid = APAFormat().parse_reference_entry(
        "Bo Xay dung (2022). QCVN 06:2022/BXD Quy chuan ky thuat quoc gia ve an toan chay cho nha va cong trinh."
    )
    assert apa_ascii_valid is not None
    src_ascii_valid = await orch.retrieve(apa_ascii_valid)
    verdict_ascii_valid = checker.check(apa_ascii_valid, src_ascii_valid)
    assert verdict_ascii_valid.label == ValidationLabel.VERIFIED

    cit_ascii_tcvn = Citation(
        raw_text="Bo Khoa hoc va Cong nghe (2023). TCVN 2737:2023 Tai trong va tac dong.",
        title="TCVN 2737:2023 Tai trong va tac dong",
        authors=["Bo Khoa hoc va Cong nghe"],
        year="2023",
        citation_type=CitationType.REFERENCE_LIST,
    )
    src_ascii_tcvn = await orch.retrieve(cit_ascii_tcvn)
    verdict_ascii_tcvn = checker.check(cit_ascii_tcvn, src_ascii_tcvn)
    assert verdict_ascii_tcvn.label == ValidationLabel.VERIFIED

    # 3f. Pre-code IEEE-style citation without (YYYY) header + bare-code with publisher in venue
    cit_ieee_pre_fab = Citation(
        raw_text="[1] Bộ Xây dựng, Quy chuẩn kỹ thuật quốc gia về chế tạo động cơ phản lực hạt nhân, QCVN 06:2022/BXD, 2022.",
        title=None,
        authors=["Bộ Xây dựng"],
        year="2022",
        citation_type=CitationType.REFERENCE_LIST,
    )
    src_ieee_pre_fab = await orch.retrieve(cit_ieee_pre_fab)
    verdict_ieee_pre_fab = checker.check(cit_ieee_pre_fab, src_ieee_pre_fab)
    assert verdict_ieee_pre_fab.label == ValidationLabel.METADATA_ERROR
    assert "title" in verdict_ieee_pre_fab.mismatched_fields

    apa_bare_pub = APAFormat().parse_reference_entry(
        "Bộ Xây dựng (2022). QCVN 06:2022/BXD. Hà Nội: NXB Xây dựng."
    )
    assert apa_bare_pub is not None
    src_bare_pub = await orch.retrieve(apa_bare_pub)
    verdict_bare_pub = checker.check(apa_bare_pub, src_bare_pub)
    assert verdict_bare_pub.label == ValidationLabel.VERIFIED

