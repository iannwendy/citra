"""Unit tests cho PDF parser."""

from __future__ import annotations

from pathlib import Path

import pytest


def test_mupdf_parser_on_nonexistent_file() -> None:
    """Parse file không tồn tại → FileNotFoundError."""
    from integrity_checker.extraction import MuPdfParser

    with pytest.raises(FileNotFoundError):
        MuPdfParser().parse("/nonexistent/file.pdf")


def test_pdfplumber_parser_on_nonexistent_file() -> None:
    from integrity_checker.extraction import PdfPlumberParser

    with pytest.raises(FileNotFoundError):
        PdfPlumberParser().parse("/nonexistent/file.pdf")


@pytest.mark.skipif(
    not Path("data/essays/essay_01_real_only.pdf").exists(),
    reason="Sample essay chưa được sinh. Chạy: python scripts/gen_sample_essays.py",
)
def test_mupdf_parser_on_sample_essay() -> None:
    """Parse 1 PDF mẫu — nếu file có sẵn."""
    from integrity_checker.extraction import MuPdfParser

    doc = MuPdfParser().parse("data/essays/essay_01_real_only.pdf")
    assert doc.num_pages > 0
    assert len(doc.pages) == doc.num_pages
    assert doc.has_any_text()
    assert doc.parser_used == "mupdf"
    # Phải có text chứa "References"
    full_text = doc.full_text.lower()
    assert "references" in full_text
