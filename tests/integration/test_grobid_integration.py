"""Integration tests với GROBID (mock HTTP + real parsing).

Có 2 chế độ:
1. MOCK mode (default): Test logic parsing với mock HTTP responses - KHÔNG cần Docker
2. REAL mode: Test với GROBID Docker thật - cần GROBID container running

Chạy mock mode:
    pytest tests/integration/test_grobid_integration.py -v

Chạy real mode (auto-detect when GROBID is available):
    pytest tests/integration/test_grobid_integration.py -v
    # Tests tự động chạy khi GROBID Docker available

Reference: v1.2 §3.4, §5.2 (GROBID Docker setup)
"""

from __future__ import annotations

import json
import os
from io import BytesIO
from pathlib import Path
from typing import Optional
from unittest.mock import MagicMock, patch

import pytest
import requests

# Configuration
GROBID_URL = os.environ.get("GROBID_URL", "http://localhost:8070")
GROBID_TEST_MODE = os.environ.get("GROBID_TEST_MODE", "mock").lower()
ESSAYS_DIR = Path("data/essays")


def _is_grobid_available() -> bool:
    """Check if GROBID Docker is running and healthy."""
    try:
        response = requests.get(f"{GROBID_URL}/api/isalive", timeout=5)
        return response.status_code == 200
    except Exception:
        return False


# Auto-detect GROBID availability: skip only if GROBID is not available AND mode is not forced
_SKIP_REAL_TESTS = GROBID_TEST_MODE != "real" and not _is_grobid_available()

# Auto-detect production environment: use Docker internal network
_PRODUCTION_GROBID_URL = "http://grobid:8070"  # Docker internal network
_LOCAL_GROBID_URL = "http://localhost:8070"    # Local development

def _get_grobid_url() -> str:
    """Get appropriate GROBID URL based on environment."""
    import os
    # Check if running in Docker
    if os.path.exists("/.dockerenv"):
        return _PRODUCTION_GROBID_URL
    # Check if GROBID_URL env is set to production URL
    if "grobid:8070" in GROBID_URL or "grobid:8070" in os.environ.get("GROBID_URL", ""):
        return _PRODUCTION_GROBID_URL
    return GROBID_URL

# Sample TEI XML responses for mocking
SAMPLE_TEI_BASIC = """<?xml version="1.0" encoding="UTF-8"?>
<TEI xmlns="http://www.tei-c.org/ns/1.0">
  <teiHeader>
    <fileDesc>
      <titleStmt>
        <title level="a">Deep Learning for NLP</title>
      </titleStmt>
      <sourceDesc>
        <biblStruct>
          <analytic>
            <author>
              <persName>
                <surname>LeCun</surname>
                <forename>Yann</forename>
              </persName>
            </author>
            <idno type="DOI">10.1038/nature14539</idno>
          </analytic>
        </biblStruct>
      </sourceDesc>
    </fileDesc>
    <profileDesc>
      <abstract>
        <p>Deep learning allows computational models...</p>
      </abstract>
    </profileDesc>
  </teiHeader>
  <text>
    <body>
      <div>
        <head>1. Introduction</head>
        <p>Deep learning <ref type="bibr" target="#b0">(LeCun et al., 2015)</ref> is powerful.</p>
      </div>
      <div type="bibliography">
        <head>References</head>
        <listBibl>
          <biblStruct xml:id="b0">
            <analytic>
              <author><persName><surname>LeCun</surname><forename>Yann</forename></persName></author>
              <author><persName><surname>Bengio</surname><forename>Yoshua</forename></persName></author>
              <title level="a">Deep learning</title>
              <idno type="DOI">10.1038/nature14539</idno>
            </analytic>
            <monogr>
              <title level="j">Nature</title>
              <imprint>
                <date type="published" when="2015-06-01">2015</date>
              </imprint>
            </monogr>
          </biblStruct>
        </listBibl>
      </div>
    </body>
  </text>
</TEI>
"""

SAMPLE_TEI_ESSAY_01 = """<?xml version="1.0" encoding="UTF-8"?>
<TEI xmlns="http://www.tei-c.org/ns/1.0">
  <teiHeader>
    <fileDesc>
      <titleStmt>
        <title level="a">Sample Essay on Machine Learning</title>
      </titleStmt>
      <sourceDesc>
        <biblStruct>
          <analytic>
            <author><persName><surname>Nguyen</surname><forename>An</forename></persName></author>
          </analytic>
        </biblStruct>
      </sourceDesc>
    </fileDesc>
  </teiHeader>
  <text>
    <body>
      <div>
        <head>Introduction</head>
        <p>Machine learning <ref type="bibr" target="#b1">(Goodfellow et al., 2016)</ref> has revolutionized AI.</p>
        <p>Neural networks <ref type="bibr" target="#b2">(LeCun et al., 2015)</ref> are fundamental.</p>
        <p>According to recent studies <ref type="bibr" target="#b3">(Vaswani et al., 2017)</ref>, attention mechanisms are important.</p>
      </div>
      <div type="bibliography">
        <head>References</head>
        <listBibl>
          <biblStruct xml:id="b1">
            <analytic>
              <author><persName><surname>Goodfellow</surname><forename>Ian</forename></persName></author>
              <title level="a">Deep Learning</title>
              <idno type="DOI">10.1016/B978-0-12-391171-3.00001-5</idno>
            </analytic>
            <monogr>
              <title level="j">MIT Press</title>
              <imprint><date type="published" when="2016">2016</date></imprint>
            </monogr>
          </biblStruct>
          <biblStruct xml:id="b2">
            <analytic>
              <author><persName><surname>LeCun</surname><forename>Yann</forename></persName></author>
              <author><persName><surname>Bengio</surname><forename>Yoshua</forename></persName></author>
              <author><persName><surname>Hinton</surname><forename>Geoffrey</forename></persName></author>
              <title level="a">Deep learning</title>
              <idno type="DOI">10.1038/nature14539</idno>
            </analytic>
            <monogr>
              <title level="j">Nature</title>
              <imprint><date type="published" when="2015-05-28">2015</date></imprint>
            </monogr>
          </biblStruct>
          <biblStruct xml:id="b3">
            <analytic>
              <author><persName><surname>Vaswani</surname><forename>Ashish</forename></persName></author>
              <title level="a">Attention Is All You Need</title>
              <idno type="DOI">10.48550/arXiv.1706.03762</idno>
            </analytic>
            <monogr>
              <title level="j">NeurIPS</title>
              <imprint><date type="published" when="2017">2017</date></imprint>
            </monogr>
          </biblStruct>
          <biblStruct xml:id="b4">
            <analytic>
              <author><persName><surname>Smith</surname><forename>John</forename></persName></author>
              <title level="a">Fabricated Paper That Does Not Exist</title>
            </analytic>
            <monogr>
              <title level="j">Fake Journal</title>
              <imprint><date type="published" when="2025">2025</date></imprint>
            </monogr>
          </biblStruct>
        </listBibl>
      </div>
    </body>
  </text>
</TEI>
"""

SAMPLE_TEI_FABRICATED = """<?xml version="1.0" encoding="UTF-8"?>
<TEI xmlns="http://www.tei-c.org/ns/1.0">
  <teiHeader>
    <fileDesc>
      <titleStmt>
        <title level="a">Fabricated Essay</title>
      </titleStmt>
    </fileDesc>
  </teiHeader>
  <text>
    <body>
      <div>
        <p>According to <ref type="bibr" target="#b1">(Nonexistent, 2050)</ref>, this is fake.</p>
      </div>
      <div type="bibliography">
        <head>References</head>
        <listBibl>
          <biblStruct xml:id="b1">
            <analytic>
              <author><persName><surname>Nonexistent</surname></persName></author>
              <title level="a">Fake Paper Title</title>
            </analytic>
          </biblStruct>
        </listBibl>
      </div>
    </body>
  </text>
</TEI>
"""


# =============================================================================
# Mock HTTP Functions
# =============================================================================


class MockResponse:
    """Mock HTTP response for GROBID API."""

    def __init__(self, status_code: int, text: str):
        self.status_code = status_code
        self.text = text


def create_mock_post_fn(tei_xml: str):
    """Create mock HTTP POST function returning specified TEI XML."""

    def mock_post(url: str, files, data, timeout) -> MockResponse:
        # Verify URL contains expected endpoint
        assert "processFulltextDocument" in url
        return MockResponse(200, tei_xml)

    return mock_post


def create_mock_post_fn_with_file(tei_xml: str, pdf_content: bytes):
    """Create mock HTTP POST that also mocks file open."""

    def mock_post(url: str, files, data, timeout) -> MockResponse:
        assert "processFulltextDocument" in url
        return MockResponse(200, tei_xml)

    def mock_open(path, mode="r", *args, **kwargs):
        if "b" in mode:
            return BytesIO(pdf_content)
        return BytesIO(b"")

    return mock_post, mock_open


# =============================================================================
# Fixtures
# =============================================================================


@pytest.fixture
def sample_essay_path() -> Path | None:
    """Path to sample essay PDF if exists."""
    essay_path = ESSAYS_DIR / "essay_01_real_only.pdf"
    if not essay_path.exists():
        pytest.skip(f"Sample essay not found: {essay_path}")
    return essay_path


@pytest.fixture
def fake_pdf_content() -> bytes:
    """Fake PDF content for testing."""
    return b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n\xd3\xd4\xcf\xd3\n"


# =============================================================================
# Test: GROBID TEI XML Parsing (shared logic)
# =============================================================================


class TestGrobidTEIParsing:
    """Test GROBID TEI XML parsing logic - works with both mock and real TEI."""

    def test_parse_basic_tei(self):
        """Parse basic TEI XML and verify structure."""
        from integrity_checker.extraction.grobid_parser import parse_tei

        out = parse_tei(SAMPLE_TEI_BASIC)
        assert out.is_available is True
        assert out.error_message is None
        assert out.header.get("title") == "Deep Learning for NLP"
        assert out.header.get("doi") == "10.1038/nature14539"
        assert len(out.authors) == 1
        assert out.authors[0].last_name == "LeCun"
        assert out.abstract is not None
        assert len(out.citations) == 1
        assert "LeCun" in out.citations[0].raw_text
        assert out.citations[0].ref_id == "b0"
        assert len(out.bibliography) == 1
        assert out.bibliography[0].id == "b0"
        assert out.bibliography[0].title == "Deep learning"
        assert out.bibliography[0].year == "2015"
        assert out.bibliography[0].venue == "Nature"
        assert out.bibliography[0].doi == "10.1038/nature14539"

    def test_parse_essay_01_tei(self):
        """Parse essay_01 style TEI XML with multiple citations."""
        from integrity_checker.extraction.grobid_parser import parse_tei

        out = parse_tei(SAMPLE_TEI_ESSAY_01)
        assert out.is_available is True
        assert len(out.bibliography) == 4
        assert len(out.citations) == 3

        # Check first citation
        assert "Goodfellow" in out.citations[0].raw_text
        assert out.citations[0].ref_id == "b1"

        # Check bibliography entries
        titles = [b.title for b in out.bibliography if b.title]
        assert "Deep Learning" in titles
        assert "Attention Is All You Need" in titles

        # Check DOI extraction
        dois = [b.doi for b in out.bibliography if b.doi]
        assert "10.1038/nature14539" in dois
        assert "10.48550/arXiv.1706.03762" in dois

    def test_parse_fabricated_tei(self):
        """Parse TEI XML with fabricated citations."""
        from integrity_checker.extraction.grobid_parser import parse_tei

        out = parse_tei(SAMPLE_TEI_FABRICATED)
        assert out.is_available is True
        assert len(out.citations) == 1
        assert "Nonexistent" in out.citations[0].raw_text

        # Fabricated entry has no DOI
        bib = out.bibliography[0]
        assert bib.doi is None
        assert bib.title == "Fake Paper Title"

    def test_parse_empty_xml(self):
        """Parse empty XML returns unavailable."""
        from integrity_checker.extraction.grobid_parser import parse_tei

        out = parse_tei("")
        assert out.is_available is False
        assert "empty" in out.error_message

    def test_parse_malformed_xml(self):
        """Parse malformed XML returns error."""
        from integrity_checker.extraction.grobid_parser import parse_tei

        out = parse_tei("<invalid><xml")
        assert out.is_available is False
        assert "parse error" in out.error_message

    def test_parse_xxe_attack_safe(self):
        """XXE attack should be blocked by defusedxml."""
        from integrity_checker.extraction.grobid_parser import parse_tei

        xxe_payload = '<?xml version="1.0"?><!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><TEI>&xxe;</TEI>'
        out = parse_tei(xxe_payload)
        assert out.is_available is False
        assert "passwd" not in (out.error_message or "")


# =============================================================================
# Test: call_grobid_fulltext with mock HTTP
# =============================================================================


class TestCallGrobidFulltext:
    """Test call_grobid_fulltext function with mock HTTP."""

    def test_call_with_mock_http(self, fake_pdf_content):
        """call_grobid_fulltext with mock HTTP should return TEI XML."""
        from integrity_checker.config import GrobidConfig
        from integrity_checker.extraction.grobid_parser import call_grobid_fulltext

        config = GrobidConfig(url=GROBID_URL, timeout_seconds=30)
        mock_post = create_mock_post_fn(SAMPLE_TEI_BASIC)

        with patch("builtins.open", side_effect=lambda p, m, *a, **kw: BytesIO(fake_pdf_content)):
            result = call_grobid_fulltext("/fake/path.pdf", config, http_post_fn=mock_post)

        assert result == SAMPLE_TEI_BASIC
        assert "<TEI" in result
        assert "</TEI>" in result

    def test_call_with_mock_essay_01(self, fake_pdf_content):
        """call_grobid_fulltext with essay_01 mock returns essay TEI."""
        from integrity_checker.config import GrobidConfig
        from integrity_checker.extraction.grobid_parser import call_grobid_fulltext

        config = GrobidConfig(url=GROBID_URL, timeout_seconds=30)
        mock_post = create_mock_post_fn(SAMPLE_TEI_ESSAY_01)

        with patch("builtins.open", side_effect=lambda p, m, *a, **kw: BytesIO(fake_pdf_content)):
            result = call_grobid_fulltext("/fake/path.pdf", config, http_post_fn=mock_post)

        assert result == SAMPLE_TEI_ESSAY_01
        assert "Goodfellow et al., 2016" in result
        assert "LeCun et al., 2015" in result

    def test_call_with_missing_file_returns_empty(self):
        """call_grobid_fulltext with missing file returns empty string."""
        from integrity_checker.config import GrobidConfig
        from integrity_checker.extraction.grobid_parser import call_grobid_fulltext

        config = GrobidConfig(url=GROBID_URL, timeout_seconds=30)
        result = call_grobid_fulltext("/nonexistent/file.pdf", config)
        assert result == ""


# =============================================================================
# Test: DocumentParser with mock GROBID
# =============================================================================


class TestDocumentParserWithMockGrobid:
    """Test DocumentParser integration with mock GROBID HTTP."""

    def test_document_parser_with_mock_grobid(self, fake_pdf_content):
        """DocumentParser with mock GROBID should parse TEI and extract citations."""
        from integrity_checker.config import GrobidConfig, Settings
        from integrity_checker.extraction.document_parser import DocumentParser

        # Create settings with GROBID enabled
        settings = Settings(
            extraction={
                "grobid": {
                    "enabled": True,
                    "url": GROBID_URL,
                }
            }
        )

        mock_post = create_mock_post_fn(SAMPLE_TEI_ESSAY_01)

        parser = DocumentParser(config=settings, grobid_post_fn=mock_post)

        # Use use_service_manager=False to bypass service manager (mock mode)
        with patch("builtins.open", side_effect=lambda p, m, *a, **kw: BytesIO(fake_pdf_content)):
            result = parser.parse("/fake/essay.pdf", use_service_manager=False)

        assert result is not None
        assert result.has_grobid is True
        assert result.grobid is not None
        assert len(result.grobid.bibliography) == 4
        assert len(result.grobid.citations) == 3

    def test_document_parser_fallback_when_disabled(self, fake_pdf_content):
        """DocumentParser should fallback when GROBID disabled."""
        from integrity_checker.config import Settings
        from integrity_checker.extraction.document_parser import DocumentParser

        settings = Settings(
            extraction={
                "grobid": {
                    "enabled": False,
                    "url": GROBID_URL,
                }
            }
        )

        parser = DocumentParser(config=settings)

        with patch("builtins.open", side_effect=lambda p, m, *a, **kw: BytesIO(fake_pdf_content)):
            result = parser.parse("/fake/essay.pdf")

        assert result is not None
        assert result.has_grobid is False


# =============================================================================
# Test: End-to-end pipeline with mock GROBID
# =============================================================================


class TestPipelineWithMockGrobid:
    """Test end-to-end pipeline with mock GROBID."""

    def test_grobid_to_citations_conversion(self, fake_pdf_content):
        """GrobidOutput should convert correctly to Citation objects."""
        from integrity_checker.config import Settings
        from integrity_checker.extraction.document_parser import DocumentParser

        settings = Settings(extraction={"grobid": {"enabled": True, "url": GROBID_URL}})
        mock_post = create_mock_post_fn(SAMPLE_TEI_ESSAY_01)
        parser = DocumentParser(config=settings, grobid_post_fn=mock_post)

        # Use use_service_manager=False to bypass service manager (mock mode)
        with patch("builtins.open", side_effect=lambda p, m, *a, **kw: BytesIO(fake_pdf_content)):
            result = parser.parse("/fake/path.pdf", use_service_manager=False)

        # Convert GROBID bibliography to Citation
        citations = DocumentParser._grobid_to_citations(result.grobid)

        assert len(citations) == 4
        assert citations[0].title == "Deep Learning"
        assert citations[0].doi == "10.1016/B978-0-12-391171-3.00001-5"
        assert citations[1].doi == "10.1038/nature14539"
        assert citations[2].doi == "10.48550/arXiv.1706.03762"


# =============================================================================
# Test: Real GROBID (optional, requires Docker)
# =============================================================================


@pytest.mark.skipif(
    _SKIP_REAL_TESTS,
    reason="GROBID Docker not available. Start with: docker-compose up grobid"
)
class TestRealGrobidDocker:
    """Test with real GROBID Docker - requires container running."""

    @pytest.fixture(scope="class", autouse=True)
    def check_grobid_running(self):
        """Skip if GROBID Docker not running."""
        import requests

        grobid_url = _get_grobid_url()
        try:
            response = requests.get(f"{grobid_url}/api/isalive", timeout=5)
            if response.status_code != 200:
                pytest.skip("GROBID Docker not healthy")
        except Exception:
            pytest.skip("GROBID Docker not accessible")

    def test_real_grobid_health(self, check_grobid_running):
        """GROBID /api/isalive should return 200."""
        import requests

        grobid_url = _get_grobid_url()
        response = requests.get(f"{grobid_url}/api/isalive", timeout=10)
        assert response.status_code == 200
        assert "true" in response.text.lower()

    def test_real_grobid_process_sample(self, check_grobid_running, sample_essay_path):
        """GROBID processFulltextDocument should parse real PDF."""
        from integrity_checker.config import GrobidConfig
        from integrity_checker.extraction.grobid_parser import call_grobid_fulltext, parse_tei

        grobid_url = _get_grobid_url()
        config = GrobidConfig(url=grobid_url, timeout_seconds=60)
        tei_xml = call_grobid_fulltext(str(sample_essay_path), config)

        assert tei_xml, "GROBID returned empty response"
        assert "<TEI" in tei_xml

        out = parse_tei(tei_xml)
        assert out.is_available is True

    def test_real_document_parser(self, check_grobid_running, sample_essay_path):
        """DocumentParser with real GROBID should parse PDF."""
        from integrity_checker.config import Settings
        from integrity_checker.extraction.document_parser import DocumentParser

        grobid_url = _get_grobid_url()
        settings = Settings(
            extraction={"grobid": {"enabled": True, "url": grobid_url}}
        )

        parser = DocumentParser(config=settings)
        result = parser.parse(str(sample_essay_path))

        assert result is not None
        assert hasattr(result, "grobid")

    def test_real_pipeline_end_to_end(self, check_grobid_running, sample_essay_path):
        """Full pipeline with real GROBID should produce valid report."""

        from integrity_checker.config import Settings
        from integrity_checker.extraction.document_parser import DocumentParser
        from integrity_checker.models.source import SourceCandidate, SourceResult
        from integrity_checker.pipeline.integrity_pipeline import IntegrityPipeline

        grobid_url = _get_grobid_url()

        # Mock orchestrator
        mock_orch = MagicMock()

        async def mock_retrieve(citation):
            return SourceResult(
                citation_raw=citation.raw_text,
                candidates=[SourceCandidate(source_name="test", found=False)],
                sources_queried=["test"],
                sources_succeeded=[],
                sources_failed={"test": "mock"},
            )

        mock_orch.retrieve = mock_retrieve

        settings = Settings(
            extraction={"grobid": {"enabled": True, "url": grobid_url}}
        )

        parser = DocumentParser(config=settings)
        pipeline = IntegrityPipeline(
            orchestrator=mock_orch,
            document_parser=parser,
            use_document_parser=True,
        )

        report = pipeline.run(str(sample_essay_path), essay_id=1)

        assert isinstance(report, type(report))
        assert report.filename == sample_essay_path.name
        assert report.num_pages >= 0
        assert report.cis is not None
        assert 0 <= report.cis.score <= 100


# =============================================================================
# Test: Cache functionality
# =============================================================================


class TestGrobidCache:
    """Test GROBID caching functionality."""

    def test_cache_key_generation(self):
        """Cache key should be SHA256 of PDF content."""
        from integrity_checker.extraction.grobid_parser import cache_key, compute_sha256

        # Same content = same key
        key1 = cache_key("data/essays/essay_01_real_only.pdf")
        key2 = compute_sha256("data/essays/essay_01_real_only.pdf")

        assert key1 == key2
        assert len(key1) == 64  # SHA256 hex length

    def test_serialize_deserialize_roundtrip(self):
        """GrobidOutput should serialize/deserialize correctly."""
        from integrity_checker.extraction.grobid_parser import (
            deserialize_output,
            parse_tei,
            serialize_output,
        )

        out = parse_tei(SAMPLE_TEI_ESSAY_01)
        serialized = serialize_output(out)

        assert isinstance(serialized, str)
        assert "Deep Learning" in serialized

        out2 = deserialize_output(serialized)
        assert len(out2.bibliography) == len(out.bibliography)
        assert out2.bibliography[0].title == out.bibliography[0].title


# =============================================================================
# Test: Error Handling
# =============================================================================


class TestGrobidErrorHandling:
    """Test GROBID error handling."""

    def test_handle_http_error(self, fake_pdf_content):
        """Should handle HTTP errors gracefully."""

        def mock_post_error(url, files, data, timeout):
            class ErrorResponse:
                status_code = 500
                text = "Internal Server Error"

            return ErrorResponse()

        from integrity_checker.config import GrobidConfig
        from integrity_checker.extraction.grobid_parser import call_grobid_fulltext

        config = GrobidConfig(url=GROBID_URL, timeout_seconds=10)

        with patch("builtins.open", side_effect=lambda p, m, *a, **kw: BytesIO(fake_pdf_content)):
            result = call_grobid_fulltext("/fake/path.pdf", config, http_post_fn=mock_post_error)

        # Should return empty string on HTTP error (status != 200)
        assert result == ""

    def test_handle_timeout(self, fake_pdf_content):
        """Should handle timeout gracefully."""

        def mock_post_timeout(url, files, data, timeout):
            raise TimeoutError("Connection timeout")

        from integrity_checker.config import GrobidConfig
        from integrity_checker.extraction.grobid_parser import call_grobid_fulltext

        config = GrobidConfig(url=GROBID_URL, timeout_seconds=1)

        with patch("builtins.open", side_effect=lambda p, m, *a, **kw: BytesIO(fake_pdf_content)):
            result = call_grobid_fulltext("/fake/path.pdf", config, http_post_fn=mock_post_timeout)

        assert result == ""


# =============================================================================
# Main
# =============================================================================


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
