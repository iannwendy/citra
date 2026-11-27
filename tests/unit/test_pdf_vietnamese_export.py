"""Regression tests for Vietnamese Unicode & semantic color rendering in PDF export."""

from __future__ import annotations

import unicodedata
from types import SimpleNamespace

import fitz
from reportlab.pdfbase import pdfmetrics

from integrity_checker.api.routes import report as report_route


def test_register_unicode_pdf_fonts_uses_bundled_dejavu_without_system_or_matplotlib(monkeypatch):
    """Inside slim Docker runtime without matplotlib or /usr/share/fonts, bundled TTFs must register CitraSans."""
    monkeypatch.setattr(report_route, "_PDF_UNICODE_FONTS_CACHE", None)
    # Unregister CitraSans if an earlier test registered it
    for fname in ("CitraSans", "CitraSans-Bold", "CitraSans-Italic", "CitraSans-BoldItalic"):
        pdfmetrics._fonts.pop(fname, None)  # noqa: SLF001

    monkeypatch.setattr(report_route.importlib.util, "find_spec", lambda _name: None)

    orig_is_file = report_route.Path.is_file

    def fake_is_file(self: report_route.Path) -> bool:
        s = str(self)
        if s.startswith(("/usr/share/fonts", "/System/Library/Fonts", "/Library/Fonts")):
            return False
        return orig_is_file(self)

    monkeypatch.setattr(report_route.Path, "is_file", fake_is_file)

    font_reg, font_bold = report_route._register_unicode_pdf_fonts()
    assert (font_reg, font_bold) == ("CitraSans", "CitraSans-Bold")


def test_generate_pdf_bytes_preserves_vietnamese_nfc_and_nfd_and_colors_status():
    """Exported PDF must render full Vietnamese diacritics (NFC & NFD) without tofu boxes and color status cells."""
    vn_nfc = (
        "Mô tả: Đối chiếu trực quan cấp Giá gốc cơ sở nhận – Giá trọn gói khách thấy, "
        "phân tích chuyển đổi theo độ khớp/Hạng phòng và mô phỏng lời/lỗ trước khi giảm giá."
    )
    vn_nfd = unicodedata.normalize(
        "NFD",
        "RM-002: Trực quan hóa Dải lịch 14 Ngày Vàng chia 3 mức khẩn cấp: Đỏ — Khẩn cấp (D0–D1); "
        "Hỗ trợ nút Chế độ Xả phòng Đêm 1-chạm sau 20h00 khi còn phòng trống Đêm nay.",
    )

    essay = SimpleNamespace(
        id=205,
        filename="goodNstay_Dashboard_SRS_v1.0.docx",
        num_pages=15,
        style_profile_json=None,
        cis_json='{"score": 55.0}',
    )
    verdicts = [
        SimpleNamespace(
            citation_raw=vn_nfc,
            label="unresolved",
            mapping_status="uncited_reference",
            confidence=0.10,
            triggered_rules="[]",
            citation_links_json="[]",
        ),
        SimpleNamespace(
            citation_raw=vn_nfd,
            label="suspected_hallucination",
            mapping_status="uncited_reference",
            confidence=0.99,
            triggered_rules="[]",
            citation_links_json="[]",
        ),
    ]

    pdf_bytes = report_route._generate_pdf_bytes(essay, verdicts)
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    try:
        full_text = " ".join(
            "\n".join(page.get_text("text") for page in doc).split()
        )
        font_names = {f[3] for page in doc for f in page.get_fonts()}

        assert any(
            "DejaVuSans" in fn or "CitraSans" in fn for fn in font_names
        ), f"Expected Unicode TTF embedded, got {font_names}"
        assert "Mô tả: Đối chiếu trực quan" in full_text
        assert "mô phỏng lời/lỗ trước khi giảm giá" in full_text
        assert "Chế độ Xả phòng Đêm 1-chạm" in full_text

        # Verify Source Status 'Source Not Found' has non-black semantic red text color while Citation stays readable dark slate
        spans = [
            s
            for page in doc
            for b in page.get_text("dict")["blocks"]
            for line in b.get("lines", [])
            for s in line.get("spans", [])
        ]
        not_found_spans = [
            s for s in spans if s["text"].strip() in ("Source Not Found", "Source Not")
        ]
        assert not_found_spans, "Expected 'Source Not Found' status cell in PDF"
        assert any(s["color"] != 0 for s in not_found_spans), (
            "Expected 'Source Not Found' status cell text to be colored red, not pure black 0x000000"
        )
    finally:
        doc.close()
