"""Comprehensive TDD suite for Wave 1A v3.69 features:
1. Rich URL Resource Metadata Extraction & JSON-LD / CRAN / URL-date fallbacks
2. Wayback Machine raw `id_` `<head>` recovery, Soft-404 fix, and HTTP 403/406 fallbacks
3. MatchFeatures, NeuroSymbolicChecker `has_scholarly_candidate`, VN Legal synthesis & serialization
4. TCVN3/VNI Legacy Encoding & 1-based Page-Selective OCR Diagnostics across PDF/DOCX/Pipeline/Report
5. Composite Sub-References (`14a, 14b, 14c`), DB Migration 0011, Cache Stats & Essay Dedupe fixes
"""

from __future__ import annotations

import asyncio
import json
from datetime import UTC, datetime, timedelta
from pathlib import Path
from unittest.mock import MagicMock

import fitz
import httpx
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from integrity_checker.api.routes.report import _extract_document_diagnostics, _json_response
from integrity_checker.db.migrations import LATEST_SCHEMA_VERSION, run_migrations
from integrity_checker.db.models import Base, CitationCache, EssayRecord
from integrity_checker.db.repository import Repository
from integrity_checker.extraction.docx_parser import DocxParser
from integrity_checker.extraction.mupdf_parser import MuPdfParser
from integrity_checker.extraction.text_preprocessor import TextPreprocessor
from integrity_checker.logic.neuro_symbolic_checker import NeuroSymbolicChecker
from integrity_checker.models.citation import Citation, CitationStyle, CitationType
from integrity_checker.models.source import SourceCandidate, SourceResult
from integrity_checker.models.validation import ValidationLabel
from integrity_checker.pipeline.integrity_pipeline import (
    _REPORT_CACHE_VERSION,
    AnalysisReport,
    IntegrityPipeline,
    _deserialize_matched_sources,
    _serialize_matched_sources,
    _serialize_verdict_for_json,
)
from integrity_checker.retrieval.html_meta_verifier import (
    HtmlPageMeta,
    extract_year_from_url,
    parse_html_head_meta,
)
from integrity_checker.retrieval.link_validator import LinkStatus, LinkValidator
from integrity_checker.retrieval.persistent_cache import PersistentVerificationCache


def _make_isolated_session_factory(tmp_path: Path):
    db_path = tmp_path / "isolated_v369.db"
    engine = create_engine(f"sqlite:///{db_path}")
    Base.metadata.create_all(bind=engine)
    run_migrations(engine)
    factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    return engine, factory


# ============================================================================
# 1. Rich URL Resource Metadata Extraction & Persistent Cache
# ============================================================================


def test_html_page_meta_to_dict_and_from_dict_normalization() -> None:
    assert HtmlPageMeta.from_dict(None) is None
    assert HtmlPageMeta.from_dict({}) is None
    assert HtmlPageMeta.from_dict({"citation_authors": ["  ", ""], "is_soft_404": False}) is None

    soft_only = HtmlPageMeta.from_dict({"is_soft_404": True})
    assert soft_only is not None and soft_only.is_soft_404 is True

    meta = HtmlPageMeta.from_dict(
        {
            "page_title": "  Package plm - CRAN  ",
            "authors": ["Yves Croissant", "  Giovanni Millo ", "yves croissant"],
            "published_year": 2023,
            "site_name": "  CRAN ",
            "canonical_url": "https://cran.r-project.org/package=plm",
        }
    )
    assert meta is not None
    assert meta.page_title == "Package plm - CRAN"
    assert meta.citation_authors == ["Yves Croissant", "Giovanni Millo"]
    assert meta.published_year == "2023"
    assert meta.site_name == "CRAN"
    assert meta.canonical_url == "https://cran.r-project.org/package=plm"

    roundtrip = HtmlPageMeta.from_dict(meta.to_dict())
    assert roundtrip == meta


def test_parse_html_head_numbered_authors_cran_and_relative_canonical() -> None:
    raw_html = """
    <html>
    <head>
      <title>CRAN - Package plm</title>
      <link rel="canonical" href="/web/packages/plm/index.html" />
      <meta name="citation_author2" content="Giovanni Millo [aut]" />
      <meta name="citation_author1" content="Yves Croissant [aut, cre]" />
      <meta name="citation_author3" content="Kevin Tappe [ctb]" />
      <meta name="DC.publisher" content="Comprehensive R Archive Network (CRAN)" />
      <meta name="DC.date.issued" content="2023-08-15" />
    </head>
    <body>Ignored</body>
    </html>
    """
    meta = parse_html_head_meta(
        raw_html,
        source_url="https://cran.r-project.org/package=plm",
    )
    assert meta is not None
    assert meta.citation_authors == ["Yves Croissant", "Giovanni Millo", "Kevin Tappe"]
    assert meta.site_name == "Comprehensive R Archive Network (CRAN)"
    assert meta.canonical_url == "https://cran.r-project.org/web/packages/plm/index.html"
    assert meta.published_year == "2023"


def test_parse_html_head_extended_authors_byline_and_portal_author_filtering() -> None:
    raw_html = """
    <html>
    <head>
      <title>Beyoncé Is Not Anti-Feminist | The Huffington Post</title>
      <meta property="og:site_name" content="The Huffington Post" />
      <meta property="article:author" content="https://www.facebook.com/HuffPost" />
      <meta name="author" content="The Huffington Post" />
      <meta name="byl" content="By Emma Gray" />
      <meta name="parsely-author" content="Emma Gray" />
      <meta name="sailthru.author" content="Claire Fallon" />
      <meta property="og:url" content="https://www.huffpost.com/entry/beyonce_n_5295891" />
    </head>
    </html>
    """
    meta = parse_html_head_meta(
        raw_html,
        source_url="http://www.huffingtonpost.com/2014/05/09/beyonce-anti-feminist_n_5295891.html",
    )
    assert meta is not None
    assert meta.page_title == "Beyoncé Is Not Anti-Feminist | The Huffington Post"
    assert meta.citation_title == "Beyoncé Is Not Anti-Feminist"
    assert meta.site_name == "The Huffington Post"
    assert meta.citation_authors == ["Emma Gray", "Claire Fallon"]
    assert meta.canonical_url == "https://www.huffpost.com/entry/beyonce_n_5295891"
    # Backfilled from unambiguous /2014/05/09/ URL path date!
    assert meta.published_year == "2014"


def test_parse_html_head_jsonld_graph_backfills_fields() -> None:
    ld_payload = {
        "@context": "https://schema.org",
        "@graph": [
            {
                "@type": "Organization",
                "@id": "https://example-news.org/#org",
                "name": "Journal of Modern Systems",
            },
            {
                "@type": "WebPage",
                "@id": "https://example-news.org/post#webpage",
                "name": "Generic Wrapper Title",
            },
            {
                "@type": "ScholarlyArticle",
                "headline": "Zero-Copy Kernel Networking in Rust",
                "author": [
                    {"@type": "Person", "name": "Lê Minh Hoàng"},
                    {"@type": "Organization", "name": "Journal of Modern Systems"},
                ],
                "datePublished": "2024-03-21T08:00:00Z",
                "publisher": {"@id": "https://example-news.org/#org"},
                "sameAs": "https://doi.org/10.1145/3600000.3600001",
            },
        ],
    }
    raw_html = f"""
    <html>
    <head>
      <title>Zero-Copy Kernel Networking in Rust - JMS</title>
      <script type="application/ld+json">{json.dumps(ld_payload)}</script>
    </head>
    </html>
    """
    meta = parse_html_head_meta(raw_html, source_url="https://example-news.org/post")
    assert meta is not None
    assert meta.citation_title == "Zero-Copy Kernel Networking in Rust"
    assert meta.citation_authors == ["Lê Minh Hoàng"]
    assert meta.published_year == "2024"
    assert meta.site_name == "Journal of Modern Systems"
    assert meta.citation_doi == "10.1145/3600000.3600001"


def test_extract_year_from_url_patterns_and_validation() -> None:
    assert (
        extract_year_from_url(
            "http://www.huffingtonpost.com/2014/05/09/beyonce-anti-feminist_n_5295891.html"
        )
        == 2014
    )
    assert extract_year_from_url("https://blog.rust-lang.org/2021-10-21-Rust-2021.html") == 2021
    assert (
        extract_year_from_url(
            "https://web.archive.org/web/20230101000000id_/https://nytimes.com/2018/11/30/tech/ai.html"
        )
        == 2018
    )
    # Invalid calendar date (Feb 31) and plain numeric IDs without full date must return None
    assert extract_year_from_url("https://example.org/2020/02/31/bad-date") is None
    assert extract_year_from_url("https://arxiv.org/abs/2023.12345") is None


def test_persistent_cache_preserves_site_name_canonical_url_and_long_source(tmp_path: Path) -> None:
    engine, factory = _make_isolated_session_factory(tmp_path)
    try:
        cache = PersistentVerificationCache(session_factory=factory)
        sr = SourceResult(
            citation_raw="Wikidata & OpenCitations entry",
            candidates=[
                SourceCandidate(
                    source_name="wikidata_opencitations",
                    found=True,
                    title="Open Bibliographic Knowledge Graph",
                    authors=["Silvio Peroni"],
                    year="2020",
                    confidence=0.92,
                )
            ],
            sources_queried=["wikidata_opencitations"],
            sources_succeeded=["wikidata_opencitations"],
            url_status="alive",
            url_status_code=200,
            html_meta=HtmlPageMeta(
                page_title="Open Bibliographic Knowledge Graph | OpenCitations",
                citation_title="Open Bibliographic Knowledge Graph",
                citation_authors=["Silvio Peroni"],
                published_year="2020",
                site_name="OpenCitations",
                canonical_url="https://opencitations.net/index/2020",
            ),
        )
        assert cache.set("doi:10.9999/opencitations-v369", sr) is True

        with factory() as s:
            row = s.query(CitationCache).filter_by(cache_key="doi:10.9999/opencitations-v369").one()
            # Must NOT be truncated to 20 chars ("wikidata_opencitatio")!
            assert row.source == "wikidata_opencitations"

        loaded = cache.get("doi:10.9999/opencitations-v369")
        assert loaded is not None
        assert loaded.html_meta is not None
        assert loaded.html_meta.site_name == "OpenCitations"
        assert loaded.html_meta.canonical_url == "https://opencitations.net/index/2020"
    finally:
        engine.dispose()


# ============================================================================
# 2. Wayback Machine `<head>` Recovery, Soft-404 Fix, and HTTP 403/406
# ============================================================================


@pytest.mark.asyncio
async def test_wayback_recovers_raw_id_html_meta_and_discards_live_soft_404() -> None:
    LinkValidator.clear_wayback_cache()
    orig_url = "https://legacy-tech-blog.org/2019/06/12/distributed-raft-notes.html"
    wb_snap = f"https://web.archive.org/web/20210501093000/{orig_url}"
    wb_raw_id = f"https://web.archive.org/web/20210501093000id_/{orig_url}"

    def handler(request: httpx.Request) -> httpx.Response:
        u = str(request.url)
        if u == orig_url:
            return httpx.Response(
                200,
                headers={"content-type": "text/html; charset=utf-8"},
                content=b"<html><head><title>404 Page Not Found</title></head><body>Gone</body></html>",
                request=request,
            )
        if "archive.org/wayback/available" in u:
            return httpx.Response(
                200,
                json={
                    "archived_snapshots": {
                        "closest": {
                            "available": True,
                            "url": wb_snap,
                            "timestamp": "20210501093000",
                            "status": "200",
                        }
                    }
                },
                request=request,
            )
        if u == wb_raw_id:
            return httpx.Response(
                200,
                headers={"content-type": "text/html; charset=utf-8"},
                content=(
                    b"<html><head>"
                    b"<title>Distributed Raft Consensus Notes | Legacy Tech Blog</title>"
                    b'<meta property="og:site_name" content="Legacy Tech Blog">'
                    b'<meta name="byl" content="By Alex Rivera">'
                    b"</head><body>Archived body</body></html>"
                ),
                request=request,
            )
        return httpx.Response(404, request=request)

    lv = LinkValidator(
        timeout=2.0,
        enable_wayback_fallback=True,
        resolver=lambda host, *_a: ["93.184.216.34"],
        transport=httpx.MockTransport(handler),
    )
    res = await lv.validate_url(orig_url)
    assert res.status == LinkStatus.ARCHIVED_ALIVE
    assert res.archive_url == wb_snap
    assert res.html_meta is not None
    assert res.html_meta.is_soft_404 is False
    assert res.html_meta.citation_title == "Distributed Raft Consensus Notes"
    assert res.html_meta.site_name == "Legacy Tech Blog"
    assert res.html_meta.citation_authors == ["Alex Rivera"]
    assert res.html_meta.published_year == "2019"


@pytest.mark.asyncio
async def test_http_406_and_403_wayback_and_url_year_fallbacks() -> None:
    LinkValidator.clear_wayback_cache()
    huff_url = "http://www.huffingtonpost.com/2014/05/09/beyonce-anti-feminist_n_5295891.html"
    wb_snap = f"https://web.archive.org/web/20150101000000/{huff_url}"
    wb_raw_id = f"https://web.archive.org/web/20150101000000id_/{huff_url}"
    restricted_no_wb = "https://paywalled-news.org/2020/07/19/market-report.html"

    def handler(request: httpx.Request) -> httpx.Response:
        u = str(request.url)
        if u == huff_url:
            return httpx.Response(406, request=request)
        if u == restricted_no_wb:
            return httpx.Response(403, request=request)
        if "archive.org/wayback/available" in u:
            if "huffingtonpost.com" in u:
                return httpx.Response(
                    200,
                    json={
                        "archived_snapshots": {
                            "closest": {
                                "available": True,
                                "url": wb_snap,
                                "timestamp": "20150101000000",
                            }
                        }
                    },
                    request=request,
                )
            return httpx.Response(200, json={"archived_snapshots": {}}, request=request)
        if "web.archive.org/cdx/search/cdx" in u:
            return httpx.Response(200, json=[], request=request)
        if u == wb_raw_id:
            return httpx.Response(
                200,
                headers={"content-type": "text/html"},
                content=(
                    b"<html><head>"
                    b"<title>Beyonce Anti-Feminist Debate | The Huffington Post</title>"
                    b'<meta property="og:site_name" content="The Huffington Post">'
                    b"</head></html>"
                ),
                request=request,
            )
        return httpx.Response(404, request=request)

    lv = LinkValidator(
        timeout=2.0,
        enable_wayback_fallback=True,
        resolver=lambda host, *_a: ["93.184.216.34"],
        transport=httpx.MockTransport(handler),
    )

    res_406 = await lv.validate_url(huff_url)
    assert res_406.status == LinkStatus.UNCHECKED
    assert res_406.archive_url == wb_snap
    assert res_406.html_meta is not None
    assert res_406.html_meta.site_name == "The Huffington Post"
    assert res_406.html_meta.published_year == "2014"

    res_403 = await lv.validate_url(restricted_no_wb)
    assert res_403.status == LinkStatus.RESTRICTED_ALIVE
    assert res_403.html_meta is not None
    assert res_403.html_meta.published_year == "2020"
    assert res_403.html_meta.page_title is None  # Must not trigger title mismatch


@pytest.mark.asyncio
async def test_wayback_html_meta_retry_and_session_cache() -> None:
    LinkValidator.clear_wayback_cache()
    huff_url = "http://www.huffingtonpost.com/2014/05/09/beyonce-anti-feminist_n_5295891.html"
    wb_snap = f"http://web.archive.org/web/20180327060938/{huff_url}"
    id_calls = {"count": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        url_str = str(request.url)
        if "huffingtonpost.com" in url_str and "archive.org" not in url_str:
            return httpx.Response(406, request=request)
        if "archive.org/wayback/available" in url_str:
            return httpx.Response(
                200,
                json={
                    "archived_snapshots": {
                        "closest": {
                            "available": True,
                            "url": wb_snap,
                            "timestamp": "20180327060938",
                            "status": "200",
                        }
                    }
                },
                request=request,
            )
        if "web.archive.org/web/20180327060938id_/" in url_str:
            id_calls["count"] += 1
            if id_calls["count"] == 1:
                raise httpx.ReadTimeout("Archive.org Petabox cold replay timeout")
            return httpx.Response(
                200,
                headers={"content-type": "text/html; charset=utf-8"},
                content=(
                    b"<html><head>"
                    b'<meta property="og:title" content="Feminist Activist Says Beyonce Is Partly Anti-Feminist">'
                    b'<meta name="author" content="Cavan Sieczkowski">'
                    b'<meta property="og:site_name" content="HuffPost">'
                    b"</head></html>"
                ),
                request=request,
            )
        return httpx.Response(404, request=request)

    lv = LinkValidator(
        timeout=4.0,
        enable_wayback_fallback=True,
        resolver=lambda host, *_a: ["93.184.216.34"],
        transport=httpx.MockTransport(handler),
    )

    first = await lv.validate_url(huff_url)
    assert id_calls["count"] == 2  # Retried once after transient ReadTimeout
    assert first.html_meta is not None
    assert first.html_meta.page_title == "Feminist Activist Says Beyonce Is Partly Anti-Feminist"
    assert first.html_meta.citation_authors == ["Cavan Sieczkowski"]
    assert first.html_meta.site_name == "HuffPost"

    second = await lv.validate_url(huff_url)
    assert id_calls["count"] == 2  # Served instantaneously from _WAYBACK_META_CACHE
    assert second.html_meta is not None
    assert second.html_meta.site_name == "HuffPost"
    LinkValidator.clear_wayback_cache()


# ============================================================================
# 3. MatchFeatures, NeuroSymbolicChecker & Verdict/MatchedSource Serialization
# ============================================================================


def test_neuro_symbolic_checker_html_meta_and_has_scholarly_candidate_flags() -> None:
    checker = NeuroSymbolicChecker(enable_content_alignment=False, enable_calibration=False)

    # Check 4 Web Resource with rich HTML meta -> has_scholarly_candidate=False + html_meta attached
    web_cit = Citation(
        raw_text="Croissant, Y. (2023). Package plm. https://cran.r-project.org/package=plm",
        citation_type=CitationType.REFERENCE_LIST,
        style=CitationStyle.APA,
        authors=["Croissant, Y."],
        year="2023",
        title="Package plm: Linear Models for Panel Data",
        url="https://cran.r-project.org/package=plm",
    )
    web_src = SourceResult(
        citation_raw=web_cit.raw_text,
        url_status="alive",
        url_status_code=200,
        html_meta=HtmlPageMeta(
            page_title="CRAN - Package plm: Linear Models for Panel Data",
            citation_title="Package plm: Linear Models for Panel Data",
            citation_authors=["Yves Croissant"],
            published_year="2023",
            site_name="CRAN",
            canonical_url="https://cran.r-project.org/package=plm",
        ),
    )
    v_web = checker.check(web_cit, web_src)
    assert v_web.label == ValidationLabel.RESOURCE
    assert v_web.features.has_scholarly_candidate is False
    assert v_web.features.html_meta is not None
    assert v_web.features.html_meta["site_name"] == "CRAN"
    assert v_web.features.html_meta_title_sim is not None
    assert v_web.features.html_meta_title_sim > 0.75

    # Synthesized web_html_meta in _serialize_matched_sources
    ms_web = _serialize_matched_sources(v_web.matched_source)
    assert len(ms_web) == 1
    assert ms_web[0]["source"] == "web_html_meta"
    assert ms_web[0]["venue"] == "CRAN"
    assert ms_web[0]["confidence"] == pytest.approx(0.80)

    # Generic VN Legal Document without _STATUTE_REGISTRY entry -> synthesized vn_legal_registry candidate + Δ=0y
    legal_cit = Citation(
        raw_text="Bộ Giáo dục và Đào tạo (2022). Thông tư số 12/2022/TT-BGDĐT ban hành Chương trình giáo dục đại học.",
        citation_type=CitationType.REFERENCE_LIST,
        style=CitationStyle.APA,
        authors=["Bộ Giáo dục và Đào tạo"],
        year="2022",
        title="Thông tư số 12/2022/TT-BGDĐT ban hành Chương trình giáo dục đại học",
        matched_pattern="vn_legal_document",
    )
    legal_src = SourceResult(citation_raw=legal_cit.raw_text)
    v_legal = checker.check(legal_cit, legal_src)
    assert v_legal.label == ValidationLabel.RESOURCE
    assert v_legal.features.has_scholarly_candidate is True
    assert v_legal.features.year_distance == 0
    assert v_legal.features.title_sim_fuzzy == pytest.approx(1.0)
    assert len(v_legal.matched_source.candidates) == 1
    assert v_legal.matched_source.candidates[0].source_name == "vn_legal_registry"

    # External IDs preserved on serialized candidates + report cache version bumped to report-v21
    assert _REPORT_CACHE_VERSION == "report-v21"
    std_src = SourceResult(
        citation_raw="TCVN 7562:2006",
        candidates=[
            SourceCandidate(
                source_name="tech_standard",
                found=True,
                title="TCVN 7562:2006",
                confidence=0.95,
                external_ids={"vn_standard_code": "TCVN 7562:2006"},
            )
        ],
    )
    ms_std = _serialize_matched_sources(std_src)
    assert ms_std[0]["external_ids"] == {"vn_standard_code": "TCVN 7562:2006"}
    rehydrated_std = _deserialize_matched_sources(ms_std)
    assert rehydrated_std is not None
    assert rehydrated_std.candidates[0].external_ids == {"vn_standard_code": "TCVN 7562:2006"}

    # AnalysisReport roundtrip preserves html_meta, has_scholarly_candidate, and composite sub-ref fields
    web_cit.numeric_index = 14
    web_cit.sub_index = "a"
    web_cit.composite_label = "14a"
    report = AnalysisReport(
        essay_id=1,
        filename="test.pdf",
        num_pages=2,
        num_citations=1,
        extracted_citations=[web_cit],
        verdicts=[v_web],
    )
    as_dict = report.to_dict()
    assert as_dict["verdicts"][0]["composite_label"] == "14a"
    assert as_dict["verdicts"][0]["has_scholarly_candidate"] is False
    assert as_dict["verdicts"][0]["html_meta"]["site_name"] == "CRAN"
    reloaded_report = AnalysisReport.from_dict(as_dict)
    assert reloaded_report.verdicts[0].features.has_scholarly_candidate is False
    assert reloaded_report.verdicts[0].features.html_meta["site_name"] == "CRAN"
    serialized_v = _serialize_verdict_for_json(v_web)
    assert serialized_v["composite_label"] == "14a"
    assert serialized_v["matched_sources"][0]["source"] == "web_html_meta"

    # Bot-walled URL (url_status='unchecked') rescued by Wayback snapshot must serialize as wayback_html_meta
    wb_bot_src = SourceResult(
        citation_raw=web_cit.raw_text,
        url_status="unchecked",
        url_status_code=406,
        archive_url="https://web.archive.org/web/20140511/http://www.huffingtonpost.com/article",
        html_meta=HtmlPageMeta(
            citation_title="Feminist Activist Says Beyonce Is Partly 'Anti-Feminist'",
            citation_authors=["Cavan Sieczkowski"],
            published_year=2014,
            site_name="HuffPost",
        ),
    )
    wb_ms = _serialize_matched_sources(wb_bot_src)
    assert wb_ms[0]["source"] == "wayback_html_meta"



# ============================================================================
# 4. TCVN3/VNI Legacy Encoding & 1-Based OCR Diagnostics
# ============================================================================


def test_mupdf_1based_ocr_pages_and_docx_legacy_encoding_diagnostics(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # 4a. MuPdfParser stores 1-based ocr_pages_recovered + legacy_encoding_pages_count
    pdf_path = tmp_path / "ocr_and_legacy.pdf"
    pdf_doc = fitz.open()
    p1 = pdf_doc.new_page()
    # TCVN3 text on page 1: "Tr­êng §¹i häc B¸ch khoa Hµ Néi - Tµi liÖu tham kh¶o"
    p1.insert_text(
        (50, 72),
        "Tr\u00ad\u00eang \u00a7\u00b9i h\u00e4c B\u00b8ch khoa H\u00b5 N\u00e9i - T\u00b5i li\u00d6u tham kh\u00b6o "
        * 2,
    )
    pdf_doc.new_page()  # Page 2 (0-based index 1) is sparse -> recovered via OCR
    pdf_doc.save(str(pdf_path))
    pdf_doc.close()

    monkeypatch.setattr(
        MuPdfParser,
        "_maybe_ocr_sparse_pages",
        lambda self, doc, pages, sparse_indices, **_kw: [1],
    )
    parsed_pdf = MuPdfParser().parse(pdf_path)
    assert parsed_pdf.metadata["ocr_pages_recovered"] == [2]  # 1-based!
    assert parsed_pdf.metadata["legacy_encoding_detected"] == "tcvn3"
    assert parsed_pdf.metadata["legacy_encoding_pages_count"] >= 1

    # 4b. DocxParser detects & transcodes TCVN3 .docx and records metadata diagnostics
    import docx

    docx_path = tmp_path / "legacy_tcvn3.docx"
    wdoc = docx.Document()
    wdoc.add_paragraph(
        "Tr\u00ad\u00eang \u00a7\u00b9i h\u00e4c T\u00f4n \u00a7\u00f8c Th\u00benng - B\u00b8o c\u00b8o t\u00e8t nghi\u00d6p"
    )
    wdoc.save(str(docx_path))

    parsed_docx = DocxParser().parse(docx_path)
    assert "Trường Đại học" in parsed_docx.full_text
    assert parsed_docx.metadata["legacy_encoding_detected"] == "tcvn3"
    assert parsed_docx.metadata["legacy_encoding_pages_count"] == 1
    assert parsed_docx.metadata["ocr_pages_recovered"] == []

    # 4c. TextPreprocessor metadata recording
    tp_meta: dict = {}
    tp = TextPreprocessor()
    norm_txt = tp.normalize(
        "Tr\u00ad\u00eang \u00a7\u00b9i h\u00e4c Qu\u00e8c gia Th\u00b5nh ph\u00e8 H\u00e5 Ch\u00dd Minh",
        metadata=tp_meta,
    )
    assert "Trường Đại học" in norm_txt
    assert tp_meta["legacy_encoding_detected"] == "tcvn3"
    assert tp_meta["legacy_encoding_pages_count"] == 1

    # 4d. Pipeline SSE _emit("extracting", 2, document_diagnostics=...)
    emitted: list[tuple[str, int, dict]] = []
    pipeline = IntegrityPipeline(use_report_cache=False, use_document_parser=False)
    pipeline.parser = MagicMock()
    pipeline.parser.parse.return_value = parsed_pdf
    pipeline.extractor = MagicMock()
    pipeline.extractor.extract_from_document.return_value = []
    pipeline.ref_parser = MagicMock()
    pipeline.ref_parser.parse_reference_section.return_value = []

    report = pipeline.run(
        pdf_path,
        progress_callback=lambda key, idx, stats: emitted.append((key, idx, dict(stats))),
    )
    diag = report.style_profile["document_diagnostics"]
    assert diag["ocr_pages_recovered"] == [2]
    assert diag["legacy_encoding_detected"] == "tcvn3"
    assert diag["legacy_encoding_pages_count"] >= 1
    extracting_events = [e for e in emitted if e[0] == "extracting"]
    assert len(extracting_events) == 1
    assert extracting_events[0][2]["document_diagnostics"]["ocr_pages_recovered"] == [2]


# ============================================================================
# 5. Composite Sub-References, Migration 0011, Report Serialization, Dedupe & Cache Stats
# ============================================================================


def test_composite_subreferences_db_persistence_and_report_json(tmp_path: Path) -> None:
    assert LATEST_SCHEMA_VERSION == "0011"
    engine, factory = _make_isolated_session_factory(tmp_path)
    try:
        with factory() as session:
            repo = Repository(session)
            essay = repo.create_essay("composite_refs.pdf", num_pages=5)
            essay.style_profile_json = json.dumps(
                {
                    "detected_style": "ieee",
                    "document_diagnostics": {
                        "is_scanned_pdf": False,
                        "scanned_pages_count": 0,
                        "total_extractable_chars": 4500,
                        "avg_chars_per_page": 900.0,
                        "ocr_pages_recovered": [3],
                        "legacy_encoding_detected": "vni_windows",
                        "legacy_encoding_pages_count": 2,
                    },
                }
            )

            in_text = Citation(
                raw_text="[14a]",
                citation_type=CitationType.NUMERIC,
                style=CitationStyle.IEEE,
                numeric_index=14,
                sub_index="a",
                composite_label="14a",
                page_num=2,
            )
            ref_14a = Citation(
                raw_text="[14] a) Croissant, Y. (2023). plm package. https://cran.r-project.org/package=plm",
                citation_type=CitationType.REFERENCE_LIST,
                style=CitationStyle.IEEE,
                authors=["Croissant, Y."],
                year="2023",
                title="plm package",
                url="https://cran.r-project.org/package=plm",
                numeric_index=14,
                sub_index="a",
                composite_label="14a",
                page_num=5,
            )
            repo.add_citations(essay.id, [in_text, ref_14a])

            verdict_14a = NeuroSymbolicChecker(
                enable_content_alignment=False, enable_calibration=False
            ).check(
                ref_14a,
                SourceResult(
                    citation_raw=ref_14a.raw_text,
                    url_status="alive",
                    url_status_code=200,
                    html_meta=HtmlPageMeta(
                        page_title="CRAN - Package plm",
                        citation_title="plm: Linear Models for Panel Data",
                        citation_authors=["Yves Croissant"],
                        published_year="2023",
                        site_name="CRAN",
                        canonical_url="https://cran.r-project.org/package=plm",
                    ),
                ),
            )
            repo.add_verdicts(essay.id, [verdict_14a])
            session.commit()

            resp = _json_response(
                essay.filename,
                essay,
                repo.get_verdicts(essay.id),
                repo.get_citations(essay.id),
                repo=repo,
            )
            async def _read_streaming_body() -> bytes:
                chunks: list[bytes] = []
                async for chunk in resp.body_iterator:
                    chunks.append(chunk.encode("utf-8") if isinstance(chunk, str) else bytes(chunk))
                return b"".join(chunks)

            body = asyncio.run(_read_streaming_body())
            payload = json.loads(body.decode("utf-8"))

            assert payload["document_diagnostics"]["ocr_pages_recovered"] == [3]
            assert payload["document_diagnostics"]["legacy_encoding_detected"] == "vni_windows"
            assert payload["document_diagnostics"]["legacy_encoding_pages_count"] == 2

            assert payload["extracted_citations"][0]["composite_label"] == "14a"
            assert payload["extracted_citations"][0]["numeric_index"] == 14
            assert payload["extracted_citations"][0]["sub_index"] == "a"

            assert payload["references"][0]["composite_label"] == "14a"
            assert payload["references"][0]["html_meta"]["site_name"] == "CRAN"
            assert payload["references"][0]["has_scholarly_candidate"] is False

            v_item = payload["verdicts"][0]
            assert v_item["composite_label"] == "14a"
            assert v_item["numeric_index"] == 14
            assert v_item["sub_index"] == "a"
            assert v_item["has_scholarly_candidate"] is False
            assert v_item["html_meta"]["site_name"] == "CRAN"
            assert v_item["matched_sources"][0]["source"] == "web_html_meta"

            fallback_diag = _extract_document_diagnostics(essay, None, [], [])
            assert fallback_diag["ocr_pages_recovered"] == []
            assert fallback_diag["legacy_encoding_detected"] is None
            assert fallback_diag["legacy_encoding_pages_count"] == 0
    finally:
        engine.dispose()


def test_essay_dedupe_surfaces_active_and_recent_failed_uploads(tmp_path: Path) -> None:
    engine, factory = _make_isolated_session_factory(tmp_path)
    try:
        with factory() as session:
            repo = Repository(session)
            t0 = datetime(2026, 5, 1, 10, 0, tzinfo=UTC)

            old_completed = EssayRecord(
                filename="thesis.pdf",
                num_pages=10,
                user_id=7,
                uploaded_at=t0,
                job_status="completed",
                cis_json=json.dumps({"score": 88.0}),
            )
            session.add(old_completed)
            session.flush()

            # 1. Newer failed attempt must NOT be hidden behind older completed copy
            recent_failed = EssayRecord(
                filename="thesis.pdf",
                num_pages=0,
                user_id=7,
                uploaded_at=t0 + timedelta(minutes=5),
                job_status="failed",
                job_error="Corrupted upload",
            )
            session.add(recent_failed)
            session.commit()

            deduped_1 = repo.get_all_essays_deduped(user_id=7)
            assert len(deduped_1) == 1
            assert deduped_1[0][0].id == recent_failed.id

            # 2. Active processing re-upload surfaces immediately
            active_processing = EssayRecord(
                filename="thesis.pdf",
                num_pages=10,
                user_id=7,
                uploaded_at=t0 + timedelta(minutes=10),
                job_status="processing",
            )
            session.add(active_processing)
            session.commit()

            deduped_2 = repo.get_all_essays_deduped(user_id=7)
            assert deduped_2[0][0].id == active_processing.id

            # 3. Once active finishes as completed, newest completed wins over prior failed
            active_processing.job_status = "completed"
            active_processing.cis_json = json.dumps({"score": 94.0})
            session.commit()

            deduped_3 = repo.get_all_essays_deduped(user_id=7)
            assert deduped_3[0][0].id == active_processing.id
    finally:
        engine.dispose()


def test_get_cache_stats_separates_dynamic_by_source_from_local_corpus(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    engine, factory = _make_isolated_session_factory(tmp_path)
    try:
        now_ts = datetime.now(UTC).timestamp()
        with factory() as session:
            repo = Repository(session)
            session.add_all(
                [
                    CitationCache(
                        cache_key="active_1",
                        source="wikidata_opencitations",
                        raw_response=json.dumps({"expires_at": now_ts + 3600, "result": {}}),
                        matched_fields=json.dumps({"expires_at": now_ts + 3600}),
                        hit_count=6,
                    ),
                    CitationCache(
                        cache_key="expired_1",
                        source="crossref",
                        raw_response=json.dumps({"expires_at": now_ts - 60, "result": {}}),
                        matched_fields=json.dumps({"expires_at": now_ts - 60}),
                        hit_count=2,
                    ),
                ]
            )
            session.commit()

            monkeypatch.setattr(
                "integrity_checker.database.LocalDatabase.get_stats",
                lambda _self: {
                    "total_papers": 129_000,
                    "total_queries": 40,
                    "hit_rate_percent": 50.0,
                    "source_counts": {"openalex": 100_000, "arxiv": 29_000},
                },
            )

            stats = repo.get_cache_stats()
            assert stats["persistent_entries"] == 1
            assert stats["expired_entries"] == 1
            assert stats["persistent_hits"] == 8
            # Dynamic avg_hit_count = 8 / 2 = 4.0 (NOT divided by 129,002!)
            assert stats["avg_hit_count"] == pytest.approx(4.0)
            # Dynamic by_source must NOT be polluted by 100k static local corpus rows
            assert stats["by_source"]["wikidata_opencitations"] == 1
            assert stats["by_source"]["crossref"] == 1
            assert stats["by_source"]["openalex"] == 0
            assert stats["local_corpus_by_source"] == {"openalex": 100_000, "arxiv": 29_000}
            assert stats["local_papers_count"] == 129_000
            assert stats["local_queries_count"] == 40
            assert stats["local_hits_count"] == 20
            assert stats["total"] == 129_002
            assert stats["total_hits"] == 28
    finally:
        engine.dispose()
