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
