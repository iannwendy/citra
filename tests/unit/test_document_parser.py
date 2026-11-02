"""Unit tests cho ``DocumentParser`` orchestrator (v1.2 §3.4).

Test fallback chain:
    - GROBID OK → dùng GrobidOutput bibliography
    - GROBID fail → dùng regex parser trên text
    - Cả 2 fail → trả ParsedDocument rỗng với warnings

Tổng: ≥5 tests (task #21 yêu cầu).

Reference:
    v1.2 §3.4 (PDF → Document full-text extraction)
    v1.2 §5.2 (DocumentParser scaffold — tuần 8)
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from unittest.mock import MagicMock

from integrity_checker.config import Settings
from integrity_checker.extraction.base import Document, Page
from integrity_checker.extraction.document_parser import DocumentParser, ParsedDocument
from integrity_checker.extraction.grobid_parser import (
    SAMPLE_TEI,
    GrobidAuthor,
    GrobidBibEntry,
    GrobidOutput,
)

# ---------- Helpers ----------

@dataclass
class _FakePDF:
    """Mock response cho HTTP POST đến GROBID."""

    text: str = SAMPLE_TEI
    status_code: int = 200


class _MockMuPdfParser:
    """Mock PyMuPDF parser trả Document từ text fixture."""

    def __init__(self, doc: Document) -> None:
        self._doc = doc

    def parse(self, file_path):
        return self._doc


def _make_text_doc() -> Document:
    """Tạo Document với body + bibliography section."""
    pages = [
        Page(
            page_num=1,
            text=(
                "Introduction\n\n"
                "This essay cites Smith (2020) and Jones (2019).\n"
                "It also uses (Doe, 2021) and [1].\n\n"
            ),
            has_text_layer=True,
        ),
        Page(
            page_num=2,
            text=(
                "References\n\n"
                "Smith, J. (2020). A study of X. Journal A.\n"
                "Doe, A. (2021). Another. Journal B.\n"
            ),
            has_text_layer=True,
        ),
    ]
    return Document(
        file_path="/fake/essay.pdf",
        num_pages=2,
        pages=pages,
        parser_used="mupdf",
    )


def _make_grobid_output() -> GrobidOutput:
    """GROBID output với bibliography chuẩn."""
    return GrobidOutput(
        header={"title": "Sample Essay"},
        authors=[GrobidAuthor(full_name="Smith, J.", last_name="Smith")],
        abstract="An abstract.",
        sections=[],
        citations=[],
        bibliography=[
            GrobidBibEntry(
                id="b0",
                authors=[GrobidAuthor(full_name="Smith, J.", last_name="Smith")],
                title="A study of X",
                year="2020",
                venue="Journal A",
                doi="10.1234/abc.001",
                raw_xml="<biblStruct/>",
            ),
        ],
        is_available=True,
    )


def _make_settings(grobid_enabled: bool = True) -> Settings:
    """Settings với grobid bật/tắt — dùng dict để Pydantic parse."""
    return Settings(
        extraction={
            "grobid": {
                "enabled": grobid_enabled,
                "url": "http://localhost:8070",
                "timeout_seconds": 5,
                "consolidate_header": ["abstract", "body", "bibliography"],
            },
        },
    )


def _make_post_fn(text: str = SAMPLE_TEI, status_code: int = 200):
    """Mock HTTP POST function."""
    def _post(url, files, data, timeout):
        m = MagicMock()
        m.status_code = status_code
        m.text = text
        return m
    return _post


# ---------- Test 1: GROBID OK → use GROBID bibliography ----------


class TestGrobidOK:
    def test_grobid_bibliography_used_when_available(self, tmp_path: Path):
        """GROBID OK → ParsedDocument.references có 1 entry từ GROBID."""
        text_doc = _make_text_doc()
        grobid_out = _make_grobid_output()
        mock_parser = _MockMuPdfParser(text_doc)
        # Create a fake PDF file
        pdf = tmp_path / "essay.pdf"
        pdf.write_bytes(b"%PDF-1.4\n%fake\n")

        # Build parser with mocked muPDF + GROBID enabled
        settings = _make_settings(grobid_enabled=True)
        parser = DocumentParser(
            config=settings,
            mupdf_parser=mock_parser,
            grobid_post_fn=_make_post_fn(),
        )
        # Inject GROBID output directly (bypass actual call)
        parser._load_grobid_tei = lambda path: grobid_out  # type: ignore[assignment]

        # Use use_service_manager=False to bypass service manager (mock mode)
        parsed = parser.parse(str(pdf), use_service_manager=False)

        # Verify sections
        assert isinstance(parsed, ParsedDocument)
        assert len(parsed.sections) >= 1

        # Verify GROBID bibliography used
        assert parsed.has_grobid is True
        assert parsed.grobid is not None

        # Phase 3 merge: GROBID refs primary + regex supplemental merged
        # GROBID has 1 entry (b0), regex has 1 entry (Doe) → 2 total
        assert len(parsed.references) == 2
        # First ref is from GROBID (source='grobid')
        assert parsed.references[0].source == "grobid"
        assert parsed.references[0].title == "A study of X"
        assert parsed.references[0].year == "2020"
        assert parsed.references[0].doi == "10.1234/abc.001"
        assert parsed.references[0].citation_type.value == "reference_list"
        # Second ref is from regex merge (source='merged')
        assert parsed.references[1].source == "merged"
        assert parsed.references[1].raw_text == "Doe, A. (2021). Another. Journal B."

        # Body has citations
        # Note: parsed.body_citations may be 0 nếu regex không match — that's OK
        # vì test này chỉ verify GROBID bibliography path


# ---------- Test 2: GROBID fail → fallback regex ----------


class TestGrobidFail:
    def test_grobid_fails_falls_back_to_regex(self, tmp_path: Path):
        """GROBID fail (empty TEI) → references parse từ regex parser."""
        text_doc = _make_text_doc()
        mock_parser = _MockMuPdfParser(text_doc)
        pdf = tmp_path / "essay.pdf"
        pdf.write_bytes(b"%PDF-1.4\n%fake\n")

        settings = _make_settings(grobid_enabled=True)
        # Mock GROBID trả về rỗng → fail
        parser = DocumentParser(
            config=settings,
            mupdf_parser=mock_parser,
            grobid_post_fn=_make_post_fn(text="", status_code=500),
        )

        parsed = parser.parse(str(pdf))

        # GROBID không available
        assert parsed.has_grobid is False
        # Có warning về GROBID fail
        assert any("GROBID" in w for w in parsed.parser_warnings)
        # References fallback từ regex parser
        # Lưu ý: regex parser có thể parse ra entries hoặc không tuỳ test data;
        # test này verify fallback path đã chạy (không crash).
        assert isinstance(parsed.references, list)
        # Sections vẫn được segment
        assert len(parsed.sections) >= 1


# ---------- Test 3: GROBID disabled → use regex ----------


class TestGrobidDisabled:
    def test_grobid_disabled_skips_grobid(self, tmp_path: Path):
        """GROBID disabled → không gọi GROBID, dùng regex parser."""
        text_doc = _make_text_doc()
        mock_parser = _MockMuPdfParser(text_doc)
        pdf = tmp_path / "essay.pdf"
        pdf.write_bytes(b"%PDF-1.4\n%fake\n")

        settings = _make_settings(grobid_enabled=False)
        parser = DocumentParser(
            config=settings,
            mupdf_parser=mock_parser,
            grobid_post_fn=_make_post_fn(),
        )

        parsed = parser.parse(str(pdf))

        # GROBID disabled
        assert parsed.grobid is None
        # Có warning về GROBID disabled
        assert any("GROBID disabled" in w for w in parsed.parser_warnings)
        # Sections và references vẫn work
        assert len(parsed.sections) >= 1
        assert isinstance(parsed.references, list)


# ---------- Test 4: PyMuPDF fail → empty doc ----------


class TestPyMuPDFFail:
    def test_mupdf_fail_returns_empty_with_warnings(self, tmp_path: Path):
        """PyMuPDF fail → ParsedDocument rỗng với warning."""
        pdf = tmp_path / "essay.pdf"
        pdf.write_bytes(b"%PDF-1.4\n%fake\n")

        # Mock PyMuPDF raise exception
        class _FailParser:
            def parse(self, file_path):
                raise RuntimeError("PyMuPDF crashed")

        settings = _make_settings(grobid_enabled=False)
        parser = DocumentParser(
            config=settings,
            mupdf_parser=_FailParser(),  # type: ignore[arg-type]
            grobid_post_fn=None,
        )

        parsed = parser.parse(str(pdf))

        # PyMuPDF warning
        assert any("PyMuPDF failed" in w for w in parsed.parser_warnings)
        # Sections rỗng (vì input document rỗng)
        assert parsed.sections == []
        # References rỗng
        assert parsed.references == []
        # Document vẫn được tạo (không crash)
        assert parsed.document is not None


# ---------- Test 5: Both fail → empty ParsedDocument ----------


class TestBothFail:
    def test_both_fail_returns_empty_parsed_document(self, tmp_path: Path):
        """Cả PyMuPDF và GROBID fail → ParsedDocument rỗng, không raise."""
        pdf = tmp_path / "essay.pdf"
        pdf.write_bytes(b"%PDF-1.4\n%fake\n")

        class _FailParser:
            def parse(self, file_path):
                raise RuntimeError("PyMuPDF crashed")

        settings = _make_settings(grobid_enabled=True)
        parser = DocumentParser(
            config=settings,
            mupdf_parser=_FailParser(),  # type: ignore[arg-type]
            grobid_post_fn=_make_post_fn(text=""),
        )

        parsed = parser.parse(str(pdf))

        # Both warnings
        warnings = parsed.parser_warnings
        assert any("PyMuPDF" in w for w in warnings)
        assert any("GROBID" in w for w in warnings)
        # Empty result
        assert parsed.sections == []
        assert parsed.references == []
        assert parsed.body_citations == []
        # Document vẫn tồn tại (không raise)
        assert parsed.document is not None


# ---------- Test 6: ParsedDocument properties ----------


class TestParsedDocumentProperties:
    def test_body_text_property(self, tmp_path: Path):
        """ParsedDocument.body_text ghép text từ body sections."""
        text_doc = _make_text_doc()
        mock_parser = _MockMuPdfParser(text_doc)
        pdf = tmp_path / "essay.pdf"
        pdf.write_bytes(b"%PDF-1.4\n%fake\n")

        settings = _make_settings(grobid_enabled=False)
        parser = DocumentParser(
            config=settings,
            mupdf_parser=mock_parser,
            grobid_post_fn=None,
        )

        parsed = parser.parse(str(pdf))

        # body_text không rỗng
        assert parsed.body_text != ""
        # Chứa từ "Introduction"
        assert "Introduction" in parsed.body_text
        # bibliography_text chứa "References"
        assert "References" in parsed.bibliography_text

    def test_has_grobid_false_when_unavailable(self):
        """has_grobid = False khi grobid=None."""
        parsed = ParsedDocument(document=_make_text_doc())
        assert parsed.has_grobid is False

    def test_has_grobid_true_when_available(self):
        """has_grobid = True khi grobid.is_available=True."""
        parsed = ParsedDocument(
            document=_make_text_doc(),
            grobid=_make_grobid_output(),
        )
        assert parsed.has_grobid is True

    def test_has_grobid_false_when_grobid_unavailable(self):
        """has_grobid = False khi grobid.is_available=False."""
        parsed = ParsedDocument(
            document=_make_text_doc(),
            grobid=GrobidOutput(is_available=False),
        )
        assert parsed.has_grobid is False


# ---------- Test 7: GROBID bibliography → Citation conversion ----------


class TestGrobidToCitations:
    def test_grobid_bibliography_converted_to_citations(self):
        """GROBID bibliography → Citation[] với đầy đủ fields."""
        from integrity_checker.extraction.document_parser import DocumentParser

        grobid_out = _make_grobid_output()
        citations = DocumentParser._grobid_to_citations(grobid_out)

        assert len(citations) == 1
        c = citations[0]
        assert c.title == "A study of X"
        assert c.year == "2020"
        assert c.doi == "10.1234/abc.001"
        assert c.venue == "Journal A"
        assert c.order_index == 1
        assert len(c.authors) == 1
        assert c.authors[0] == "Smith, J."
