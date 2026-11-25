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

    def test_consolidate_header_sends_valid_integer_code(self, tmp_path):
        """call_grobid_fulltext sends integer code '0'..'3' for consolidateHeader instead of section name."""
        from integrity_checker.config import GrobidConfig
        from integrity_checker.extraction.grobid_parser import call_grobid_fulltext

        f = tmp_path / "test.pdf"
        f.write_bytes(b"%PDF-1.4\n%fake content\n")

        class MockResponse:
            status_code = 200
            text = "<TEI><teiHeader></teiHeader></TEI>"

        captured_payloads = []

        def mock_post(url, files, data, timeout):
            captured_payloads.append(dict(data))
            return MockResponse()

        # Default config has section list ["abstract", ...] -> must send "0", not "abstract"
        call_grobid_fulltext(str(f), GrobidConfig(), http_post_fn=mock_post)
        assert captured_payloads[-1]["consolidateHeader"] == "0"

        # Explicit numeric code ["1"] -> preserved as "1"
        call_grobid_fulltext(
            str(f),
            GrobidConfig(consolidate_header=["1"]),
            http_post_fn=mock_post,
        )
        assert captured_payloads[-1]["consolidateHeader"] == "1"

    def test_tei_coordinates_omitted_by_default_and_opt_in_coerced(self, tmp_path):
        """Default GrobidConfig omits teiCoordinates; opt-in string/list values are sent cleanly."""
        from integrity_checker.config import GrobidConfig
        from integrity_checker.extraction.grobid_parser import call_grobid_fulltext

        f = tmp_path / "test.pdf"
        f.write_bytes(b"%PDF-1.4\n%fake content\n")

        class MockResponse:
            status_code = 200
            text = "<TEI><teiHeader></teiHeader></TEI>"

        captured_payloads: list[dict[str, str]] = []

        def mock_post(url, files, data, timeout):
            captured_payloads.append(dict(data))
            return MockResponse()

        # Default: teiCoordinates omitted
        call_grobid_fulltext(str(f), GrobidConfig(), http_post_fn=mock_post)
        assert "teiCoordinates" not in captured_payloads[-1]

        # None coerced to "" -> omitted
        call_grobid_fulltext(str(f), GrobidConfig(tei_coordinates=None), http_post_fn=mock_post)  # type: ignore[arg-type]
        assert "teiCoordinates" not in captured_payloads[-1]

        # Explicit string opt-in -> forwarded
        call_grobid_fulltext(
            str(f), GrobidConfig(tei_coordinates="biblStruct"), http_post_fn=mock_post
        )
        assert captured_payloads[-1]["teiCoordinates"] == "biblStruct"

        # List opt-in -> comma-joined string; False/"false" coerced to ""; set sorted deterministically
        cfg_list = GrobidConfig(tei_coordinates=["biblStruct", "ref"])  # type: ignore[arg-type]
        assert cfg_list.tei_coordinates == "biblStruct,ref"
        assert GrobidConfig(tei_coordinates=False).tei_coordinates == ""  # type: ignore[arg-type]
        assert GrobidConfig(tei_coordinates="false").tei_coordinates == ""
        assert GrobidConfig(tei_coordinates={"ref", "biblStruct", None}).tei_coordinates == "biblStruct,ref"  # type: ignore[arg-type]
        call_grobid_fulltext(str(f), cfg_list, http_post_fn=mock_post)
        assert captured_payloads[-1]["teiCoordinates"] == "biblStruct,ref"

    def test_default_http_uses_connect_read_tuple_while_injected_gets_scalar(self, tmp_path, monkeypatch):
        """Default requests.post receives (connect, read) tuple timeout; injected post gets scalar."""
        import requests

        from integrity_checker.config import GrobidConfig
        from integrity_checker.extraction.grobid_parser import call_grobid_fulltext

        f = tmp_path / "test.pdf"
        f.write_bytes(b"%PDF-1.4\n%fake\n")

        class MockResponse:
            status_code = 200
            text = "<TEI/>"
            closed = False

            def close(self):
                self.closed = True

        resp_default = MockResponse()
        seen_default_timeouts = []

        def fake_requests_post(url, files, data, timeout):
            seen_default_timeouts.append(timeout)
            return resp_default

        monkeypatch.setattr(requests, "post", fake_requests_post)
        out = call_grobid_fulltext(str(f), GrobidConfig(timeout_seconds=120))
        assert out == "<TEI/>"
        assert seen_default_timeouts == [(10.0, 120.0)]
        assert resp_default.closed is True

        # Small timeout clamps connect_t <= read_t
        call_grobid_fulltext(str(f), GrobidConfig(timeout_seconds=5))
        assert seen_default_timeouts[-1] == (5.0, 5.0)

        # Injected callable keeps scalar timeout for backward compatibility
        seen_injected = []

        def injected_post(url, files, data, timeout):
            seen_injected.append(timeout)
            return MockResponse()

        call_grobid_fulltext(
            str(f), GrobidConfig(timeout_seconds=45), http_post_fn=injected_post
        )
        assert seen_injected == [45]

    def test_read_timeout_fails_fast_without_retrying(self, tmp_path, monkeypatch):
        """ReadTimeout must NOT retry even when max_attempts=3 (avoids 3x timeout amplification)."""
        import time

        import requests

        from integrity_checker.config import GrobidConfig
        from integrity_checker.extraction.grobid_parser import call_grobid_fulltext

        f = tmp_path / "slow.pdf"
        f.write_bytes(b"%PDF-1.4\n%fake\n")

        attempts = 0
        sleeps: list[float] = []
        monkeypatch.setattr(time, "sleep", lambda s: sleeps.append(s))

        def post_read_timeout(url, files, data, timeout):
            nonlocal attempts
            attempts += 1
            raise requests.exceptions.ReadTimeout("GROBID read timed out")

        res = call_grobid_fulltext(
            str(f), GrobidConfig(timeout_seconds=30), http_post_fn=post_read_timeout, max_attempts=3
        )
        assert res == ""
        assert attempts == 1
        assert sleeps == []

    def test_transient_connect_and_503_retry_and_close_responses(self, tmp_path, monkeypatch):
        """ConnectTimeout, ConnectionError, and HTTP 503 retry and close non-200 responses."""
        import time

        import requests

        from integrity_checker.config import GrobidConfig
        from integrity_checker.extraction.grobid_parser import call_grobid_fulltext

        f = tmp_path / "retry.pdf"
        f.write_bytes(b"%PDF-1.4\n%fake\n")

        sleeps: list[float] = []
        monkeypatch.setattr(time, "sleep", lambda s: sleeps.append(s))

        closed_503 = []

        class Resp503:
            status_code = 503
            text = "Service Unavailable"

            def close(self):
                closed_503.append(True)

        class Resp200:
            status_code = 200
            text = "<TEI>recovered</TEI>"

            def close(self):
                pass

        calls = 0

        def flaky_post(url, files, data, timeout):
            nonlocal calls
            calls += 1
            if calls == 1:
                raise requests.exceptions.ConnectTimeout("connect timed out")
            if calls == 2:
                return Resp503()
            return Resp200()

        res = call_grobid_fulltext(
            str(f), GrobidConfig(timeout_seconds=30), http_post_fn=flaky_post, max_attempts=3
        )
        assert res == "<TEI>recovered</TEI>"
        assert calls == 3
        assert len(closed_503) == 1
        assert len(sleeps) == 2

    def test_ssl_error_and_generic_runtime_error_fail_fast_cleanly(self, tmp_path, monkeypatch):
        """SSLError (subclass of ConnectionError) and generic RuntimeError do not retry or raise."""
        import time

        import requests

        from integrity_checker.config import GrobidConfig
        from integrity_checker.extraction.grobid_parser import call_grobid_fulltext

        f = tmp_path / "err.pdf"
        f.write_bytes(b"%PDF-1.4\n%fake\n")

        sleeps: list[float] = []
        monkeypatch.setattr(time, "sleep", lambda s: sleeps.append(s))

        ssl_calls = 0

        def ssl_post(url, files, data, timeout):
            nonlocal ssl_calls
            ssl_calls += 1
            raise requests.exceptions.SSLError("cert verify failed")

        assert (
            call_grobid_fulltext(str(f), GrobidConfig(), http_post_fn=ssl_post, max_attempts=3)
            == ""
        )
        assert ssl_calls == 1
        assert sleeps == []

        rt_calls = 0

        def runtime_post(url, files, data, timeout):
            nonlocal rt_calls
            rt_calls += 1
            raise RuntimeError("injected mock failure")

        assert (
            call_grobid_fulltext(str(f), GrobidConfig(), http_post_fn=runtime_post, max_attempts=3)
            == ""
        )
        assert rt_calls == 1

        # Generic requests.exceptions.Timeout and InvalidURL (OSError subclasses!) must also fail fast
        for exc_cls in (requests.exceptions.Timeout, requests.exceptions.InvalidURL):
            calls = 0

            def _raise_exc(url, files, data, timeout, _cls=exc_cls):
                nonlocal calls
                calls += 1
                raise _cls("non-retryable client error")

            assert (
                call_grobid_fulltext(str(f), GrobidConfig(), http_post_fn=_raise_exc, max_attempts=3)
                == ""
            )
            assert calls == 1, f"{exc_cls.__name__} must fail fast in 1 attempt"
        assert sleeps == []

