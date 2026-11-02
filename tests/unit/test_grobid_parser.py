"""Unit tests cho extraction/grobid_parser.py — TEI XML parser (v1.2 §3.4)."""

from __future__ import annotations

from integrity_checker.extraction.grobid_parser import (
    SAMPLE_TEI,
    compute_sha256,
    compute_sha256_hash,
    deserialize_output,
    parse_tei,
    serialize_output,
)


class TestParseTEI:
    def test_sample_tei_header(self):
        out = parse_tei(SAMPLE_TEI)
        assert out.is_available is True
        assert out.error_message is None
        assert out.header.get("title") == "Deep Learning"
        assert out.header.get("doi") == "10.1038/nature14539"

    def test_authors_extracted(self):
        out = parse_tei(SAMPLE_TEI)
        assert len(out.authors) == 2
        assert out.authors[0].last_name == "LeCun"
        assert out.authors[0].first_name == "Yann"

    def test_abstract_extracted(self):
        out = parse_tei(SAMPLE_TEI)
        assert "Deep learning" in out.abstract

    def test_sections_extracted(self):
        out = parse_tei(SAMPLE_TEI)
        assert len(out.sections) >= 1
        assert any(s.section_type == "body" for s in out.sections)

    def test_in_text_citations(self):
        out = parse_tei(SAMPLE_TEI)
        assert len(out.citations) == 1
        assert "LeCun" in out.citations[0].raw_text
        assert out.citations[0].ref_id == "b0"

    def test_bibliography_entries(self):
        out = parse_tei(SAMPLE_TEI)
        assert len(out.bibliography) == 1
        entry = out.bibliography[0]
        assert entry.id == "b0"
        assert entry.title == "Deep learning"
        assert entry.year == "2015"
        assert entry.venue == "Nature"
        assert entry.doi == "10.1038/nature14539"
        assert [a.last_name for a in entry.authors] == ["LeCun", "Bengio"]


class TestParseTEIErrors:
    def test_empty_xml(self):
        out = parse_tei("")
        assert out.is_available is False
        assert "empty" in out.error_message

    def test_malformed_xml(self):
        out = parse_tei("<TEI><invalid")
        assert out.is_available is False
        assert "parse error" in out.error_message

    def test_xml_with_entity_attack_safe(self):
        """defusedxml chặn XXE attack — parse_tei trả về error_message."""
        xxe_payload = '<?xml version="1.0"?><!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><TEI>&xxe;</TEI>'
        out = parse_tei(xxe_payload)
        # Caller dựa vào is_available=False + error_message; tuyệt đối không
        # leak entity content.
        assert out.is_available is False
        assert out.error_message is not None
        assert "passwd" not in (out.error_message or "")
        # Header / authors / bibliography PHẢI rỗng
        assert out.authors == []
        assert out.bibliography == []
        assert out.header == {}


class TestSerializeRoundTrip:
    def test_serialize_then_deserialize(self):
        out = parse_tei(SAMPLE_TEI)
        serialized = serialize_output(out)
        assert isinstance(serialized, str)
        out2 = deserialize_output(serialized)
        assert out2.header.get("title") == out.header.get("title")
        assert len(out2.bibliography) == len(out.bibliography)

    def test_deserialize_empty(self):
        out = deserialize_output("")
        assert out.is_available is False


class TestComputeSha256:
    def test_sha256_of_string(self):
        h = compute_sha256_hash("hello")
        assert len(h) == 64
        # SHA256("hello") = 2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824
        assert h == "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"

    def test_sha256_of_file(self, tmp_path):
        f = tmp_path / "test.pdf"
        f.write_bytes(b"PDF content")
        h = compute_sha256(str(f))
        assert len(h) == 64


class TestCallGrobidFulltext:
    def test_missing_pdf(self, tmp_path):
        from integrity_checker.config import GrobidConfig
        from integrity_checker.extraction.grobid_parser import call_grobid_fulltext
        # File không tồn tại → return "" (fallback graceful)
        cfg = GrobidConfig(url="http://localhost:8070")
        result = call_grobid_fulltext("/nonexistent/file.pdf", cfg)
        assert result == ""

    def test_injectable_http_post(self, tmp_path):
        """Test với mock HTTP post function."""
        from integrity_checker.config import GrobidConfig
        from integrity_checker.extraction.grobid_parser import call_grobid_fulltext

        f = tmp_path / "test.pdf"
        f.write_bytes(b"%PDF-1.4\n%fake content\n")

        # Mock response
        class MockResponse:
            status_code = 200
            text = "<TEI><teiHeader></teiHeader></TEI>"

        captured = {}

        def mock_post(url, files, data, timeout):
            captured["url"] = url
            captured["files"] = files
            captured["data"] = data
            captured["timeout"] = timeout
            return MockResponse()

        cfg = GrobidConfig(url="http://localhost:8070", timeout_seconds=10)
        result = call_grobid_fulltext(str(f), cfg, http_post_fn=mock_post)
        assert result == "<TEI><teiHeader></teiHeader></TEI>"
        assert "/api/processFulltextDocument" in captured["url"]
