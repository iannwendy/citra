"""Unit tests for Task 6 (A4): Legacy Vietnamese Encoding Transcoder & Page-Selective OCR."""

from __future__ import annotations

import unicodedata
from pathlib import Path

import fitz
import pytest

from integrity_checker.extraction.base import Page
from integrity_checker.extraction.mupdf_parser import MuPdfParser
from integrity_checker.extraction.text_preprocessor import TextPreprocessor
from integrity_checker.extraction.vn_encoding import (
    VietnameseLegacyTranscoder,
    is_valid_vietnamese_syllable,
)


def _make_raster_pdf(path: Path, num_pages: int, *, coverage_ratio: float = 0.65) -> None:
    """Create a synthetic PDF with raster images on every page and zero text layer."""
    doc = fitz.open()
    pix = fitz.Pixmap(fitz.csRGB, fitz.IRect(0, 0, 200, 280), False)
    pix.clear_with(220)
    page_w, page_h = 595.0, 842.0
    box_w = page_w * (coverage_ratio**0.5)
    box_h = page_h * (coverage_ratio**0.5)
    x0 = (page_w - box_w) / 2.0
    y0 = (page_h - box_h) / 2.0
    img_rect = fitz.Rect(x0, y0, x0 + box_w, y0 + box_h)
    for _ in range(num_pages):
        page = doc.new_page(width=page_w, height=page_h)
        page.insert_image(img_rect, pixmap=pix)
    doc.save(str(path))
    doc.close()


class TestTCVN3Transcoder:
    def test_tcvn3_bibliography_and_heading_exact_decode(self) -> None:
        raw = (
            "Tµi liÖu tham kh¶o\n"
            "[1] NguyÔn V¨n A (2020), Gi¸o tr×nh C¬ së d÷ liÖu, NXB Gi¸o dôc."
        )
        expected = (
            "Tài liệu tham khảo\n"
            "[1] Nguyễn Văn A (2020), Giáo trình Cơ sở dữ liệu, NXB Giáo dục."
        )

        # Classmethod call
        decoded, detected = VietnameseLegacyTranscoder.normalize_legacy_vietnamese(raw)
        assert decoded == expected
        assert detected == "tcvn3"
        assert unicodedata.is_normalized("NFC", decoded)

        # Instance call compatibility
        decoded_inst, detected_inst = VietnameseLegacyTranscoder().normalize_legacy_vietnamese(raw)
        assert decoded_inst == expected
        assert detected_inst == "tcvn3"

    def test_tcvn3_all_caps_and_title_case_and_soft_hyphen_u_horn(self) -> None:
        raw_caps = "TR¦êNG §¹I HäC B¸CH KHOA Hµ NéI\nTµI LIÖU THAM KH¶O"
        decoded_caps, detected_caps = VietnameseLegacyTranscoder.normalize_legacy_vietnamese(raw_caps)
        assert detected_caps == "tcvn3"
        assert decoded_caps == "TRƯỜNG ĐẠI HỌC BÁCH KHOA HÀ NỘI\nTÀI LIỆU THAM KHẢO"

        # Title case + soft-hyphen 0xAD ('\xad') -> 'ư' (e.g. "Ph\xad¬ng ph¸p nghiªn cøu t\xad liÖu")
        raw_title = "§¹i häc B¸ch Khoa Hµ Néi: Ph\xad¬ng ph¸p nghiªn cøu t\xad liÖu."
        decoded_title, detected_title = VietnameseLegacyTranscoder.normalize_legacy_vietnamese(raw_title)
        assert detected_title == "tcvn3"
        assert decoded_title == "Đại học Bách Khoa Hà Nội: Phương pháp nghiên cứu tư liệu."

    def test_tcvn3_short_heading_with_subset_font_hint(self) -> None:
        decoded, detected = VietnameseLegacyTranscoder.normalize_legacy_vietnamese(
            "KÕt luËn", font_hint="BCDEFA+.VnTime"
        )
        assert decoded == "Kết luận"
        assert detected == "tcvn3"

    def test_tcvn3_mixed_heading_pure_vowel_caps_and_widow_continuation(self) -> None:
        raw = (
            "CH¦¥NG 2: ý NGHÜA THùC TIÔN - PhÇn më ®Çu\n"
            "Gi¸o tr×nh C¬ së d÷ liÖu cung cÊp kiÕn thøc nÒn t¶ng vÒ hÖ qu¶n trÞ\n"
            "d÷ liÖu."
        )
        decoded, detected = VietnameseLegacyTranscoder.normalize_legacy_vietnamese(raw)
        assert detected == "tcvn3"
        assert decoded == (
            "CHƯƠNG 2: Ý NGHĨA THỰC TIỄN - Phần mở đầu\n"
            "Giáo trình Cơ sở dữ liệu cung cấp kiến thức nền tảng về hệ quản trị\n"
            "dữ liệu."
        )

    def test_tcvn3_exhaustive_74_codepoints_table_bijective(self) -> None:
        from integrity_checker.extraction.vn_encoding import _TCVN3_FULL_MAP

        assert len(_TCVN3_FULL_MAP) == 74
        assert len(set(_TCVN3_FULL_MAP.values())) == 74


class TestVNIWindowsTranscoder:
    def test_vni_windows_bibliography_and_heading_exact_decode(self) -> None:
        raw = (
            "TAØI LIEÄU THAM KHAÛO\n"
            "[1] Traàn Vaên B (2021), Heä thoáng ñieàu khieån töï ñoäng."
        )
        expected = (
            "TÀI LIỆU THAM KHẢO\n"
            "[1] Trần Văn B (2021), Hệ thống điều khiển tự động."
        )

        decoded, detected = VietnameseLegacyTranscoder.normalize_legacy_vietnamese(raw)
        assert decoded == expected
        assert detected == "vni_windows"
        assert unicodedata.is_normalized("NFC", decoded)

    def test_vni_windows_full_vowel_families_horns_breves_i_and_y_tones(self) -> None:
        raw = (
            "Ñaïi hoïc Quoác gia: Cô sôû döõ lieäu, phöông phaùp löôïng töû, "
            "kyõ thuaät ñònh tính vaø yù nghóa thöïc tieãn."
        )
        expected = (
            "Đại học Quốc gia: Cơ sở dữ liệu, phương pháp lượng tử, "
            "kỹ thuật định tính và ý nghĩa thực tiễn."
        )
        decoded, detected = VietnameseLegacyTranscoder.normalize_legacy_vietnamese(raw)
        assert detected == "vni_windows"
        assert decoded == expected

    def test_vni_windows_covers_all_134_vietnamese_precomposed_letters(self) -> None:
        from integrity_checker.extraction.vn_encoding import _VNI_1CHAR_MAP, _VNI_2CHAR_MAP

        produced = set(_VNI_1CHAR_MAP.values()) | set(_VNI_2CHAR_MAP.values())
        assert len(produced) == 134


class TestPhonotacticSafetyGateAndImmunity:
    @pytest.mark.parametrize(
        "european_or_scientific",
        [
            "François Müller, Søren Kierkegaard, and Jürgen Habermas (2019). Über die Theorie.",
            "L'étude du rôle des modèles à l'échelle de 10 µm ± 2 ÷ 5 §3",
            "José María Aznar & Niño (2018). España y América Latina: Crítica, Educación, Acción.",
            "À côté de l'université, l'élève a déjà étudié la littérature française à Paris.",
            "Nguyễn Văn A (2020), Giáo trình Cơ sở dữ liệu, NXB Giáo dục.",
        ],
    )
    def test_european_scientific_and_unicode_vn_100_percent_byte_identical(
        self, european_or_scientific: str
    ) -> None:
        for hint in (None, ".VnTime", "VNI-Times"):
            decoded, detected = VietnameseLegacyTranscoder.normalize_legacy_vietnamese(
                european_or_scientific, font_hint=hint
            )
            assert decoded == european_or_scientific
            assert detected is None

    def test_mixed_legacy_and_european_lines_preserve_foreign_entries_and_urls_dois(self) -> None:
        mixed = (
            "Tµi liÖu tham kh¶o\n"
            "[1] NguyÔn V¨n A (2020), Gi¸o tr×nh C¬ së d÷ liÖu, https://example.org/p_µ_1?x=1, DOI: 10.1007/s001-020-01.\n"
            "[2] François Müller, Søren Kierkegaard, and Jürgen Habermas (2019). Über die Theorie.\n"
            "[3] L'étude du rôle des modèles à l'échelle de 10 µm ± 2 ÷ 5 §3."
        )
        decoded, detected = VietnameseLegacyTranscoder.normalize_legacy_vietnamese(mixed)
        assert detected == "tcvn3"
        lines = decoded.splitlines()
        assert lines[0] == "Tài liệu tham khảo"
        assert (
            lines[1]
            == "[1] Nguyễn Văn A (2020), Giáo trình Cơ sở dữ liệu, https://example.org/p_µ_1?x=1, DOI: 10.1007/s001-020-01."
        )
        assert (
            lines[2]
            == "[2] François Müller, Søren Kierkegaard, and Jürgen Habermas (2019). Über die Theorie."
        )
        assert lines[3] == "[3] L'étude du rôle des modèles à l'échelle de 10 µm ± 2 ÷ 5 §3."

    def test_text_preprocessor_wires_legacy_transcoder_without_breaking_latex_accents(self) -> None:
        pp = TextPreprocessor()
        tcvn_cleaned = pp.normalize(
            "Tµi liÖu tham kh¶o\n[1] NguyÔn V¨n A (2020), Gi¸o tr×nh C¬ së d÷ liÖu."
        )
        assert "Nguyễn Văn A (2020), Giáo trình Cơ sở dữ liệu." in tcvn_cleaned

        vni_cleaned = pp.normalize(
            "TAØI LIEÄU THAM KHAÛO\n[1] Traàn Vaên B (2021), Heä thoáng ñieàu khieån töï ñoäng."
        )
        assert "Trần Văn B (2021), Hệ thống điều khiển tự động." in vni_cleaned

        # LaTeX spacing accents and European text must still work identically
        euro_cleaned = pp.normalize("P. Erd˝ os and A. R´enyi (1960); François Müller (2019).")
        assert "Erdős" in euro_cleaned
        assert "Rényi" in euro_cleaned
        assert "François Müller" in euro_cleaned


class TestSelectivePyMuPDFOCR:
    def test_25_page_priority_selects_last_10_and_first_5_capped_at_15(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        pdf_path = tmp_path / "scanned_25.pdf"
        _make_raster_pdf(pdf_path, num_pages=25, coverage_ratio=0.70)

        tess_dir = tmp_path / "tessdata"
        tess_dir.mkdir()
        (tess_dir / "eng.traineddata").write_bytes(b"dummy-eng")
        (tess_dir / "vie.traineddata").write_bytes(b"dummy-vie")
        monkeypatch.setenv("TESSDATA_PREFIX", str(tess_dir))

        ocr_calls: list[tuple[int, str, int, bool, str]] = []

        def _fake_get_textpage_ocr(
            self_page, flags: int = 0, language: str = "eng", dpi: int = 72, full: bool = False, tessdata: str | None = None
        ):
            ocr_calls.append((self_page.number, language, dpi, full, str(tessdata)))
            return f"FAKE_TP_{self_page.number}"

        orig_get_text = fitz.Page.get_text

        def _fake_get_text(self_page, opt: str = "text", *args, **kwargs):
            tp = kwargs.get("textpage")
            if isinstance(tp, str) and tp.startswith("FAKE_TP_"):
                return (
                    f"[1] Nguyễn Văn A (2020), Giáo trình Cơ sở dữ liệu — trang {self_page.number + 1}."
                )
            return orig_get_text(self_page, opt, *args, **kwargs)

        monkeypatch.setattr(fitz.Page, "get_textpage_ocr", _fake_get_textpage_ocr)
        monkeypatch.setattr(fitz.Page, "get_text", _fake_get_text)

        parser = MuPdfParser()
        doc = fitz.open(str(pdf_path))
        try:
            pages = [Page(page_num=i + 1, text="", has_text_layer=False) for i in range(25)]
            recovered = parser._maybe_ocr_sparse_pages(
                doc, pages, list(range(25)), max_pages=15, timeout_sec=12.0
            )
        finally:
            doc.close()

        # Exact priority order: last 10 pages (15..24) first, then first 5 pages (0..4)
        expected_order = list(range(15, 25)) + list(range(0, 5))
        assert len(recovered) == 15
        assert recovered == expected_order
        assert [c[0] for c in ocr_calls] == expected_order
        assert all(c[1] == "vie+eng" and c[2] == 200 and c[3] is True for c in ocr_calls)
        assert all(c[4] == str(tess_dir) for c in ocr_calls)

        # Middle pages (5..14) untouched; recovered pages updated with text layer
        for idx in range(25):
            if idx in expected_order:
                assert f"trang {idx + 1}" in pages[idx].text
                assert pages[idx].has_text_layer is True
            else:
                assert pages[idx].text == ""
                assert pages[idx].has_text_layer is False

    def test_selective_ocr_missing_tessdata_and_runtime_error_fallback_gracefully(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        pdf_path = tmp_path / "scanned_3.pdf"
        _make_raster_pdf(pdf_path, num_pages=3, coverage_ratio=0.70)

        # Case 1: Missing tessdata directory
        monkeypatch.setenv("TESSDATA_PREFIX", str(tmp_path / "nonexistent_tessdata"))
        monkeypatch.setattr(
            MuPdfParser,
            "_STANDARD_TESSDATA_DIRS",
            (str(tmp_path / "no_sys_tess_1"), str(tmp_path / "no_sys_tess_2")),
        )

        parser = MuPdfParser()
        doc = fitz.open(str(pdf_path))
        try:
            pages = [Page(page_num=i + 1, text="", has_text_layer=False) for i in range(3)]
            recovered = parser._maybe_ocr_sparse_pages(doc, pages, [0, 1, 2])
            assert recovered == []
        finally:
            doc.close()

        # Case 2: tessdata exists with only eng.traineddata, but get_textpage_ocr raises RuntimeError
        tess_dir = tmp_path / "bad_tessdata"
        tess_dir.mkdir()
        (tess_dir / "eng.traineddata").write_bytes(b"corrupt")
        monkeypatch.setenv("TESSDATA_PREFIX", str(tess_dir))

        parsed_doc = parser.parse(pdf_path)
        assert parsed_doc.num_pages == 3
        assert parsed_doc.metadata["ocr_pages_recovered"] == []
        assert parsed_doc.metadata["is_scanned_pdf"] is True

    def test_selective_ocr_skips_low_image_coverage_and_respects_timeout_budget(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # Page 0: small logo (< 25% coverage) -> skipped
        # Page 1 & 2: full scan (>= 25% coverage), but timeout triggers after 1 page
        pdf_path = tmp_path / "mixed_scan.pdf"
        doc = fitz.open()
        pix = fitz.Pixmap(fitz.csRGB, fitz.IRect(0, 0, 100, 100), False)
        pix.clear_with(200)

        p0 = doc.new_page(width=595, height=842)
        p0.insert_image(fitz.Rect(20, 20, 100, 100), pixmap=pix)  # ~1.3% area < 25%

        p1 = doc.new_page(width=595, height=842)
        p1.insert_image(fitz.Rect(30, 30, 560, 800), pixmap=pix)  # ~81% area

        p2 = doc.new_page(width=595, height=842)
        p2.insert_image(fitz.Rect(30, 30, 560, 800), pixmap=pix)  # ~81% area

        doc.save(str(pdf_path))
        doc.close()

        tess_dir = tmp_path / "tess_eng_only"
        tess_dir.mkdir()
        (tess_dir / "eng.traineddata").write_bytes(b"dummy")
        monkeypatch.setenv("TESSDATA_PREFIX", str(tess_dir))

        clock = {"now": 100.0}

        def _fake_monotonic() -> float:
            return clock["now"]

        langs_used: list[str] = []

        def _fake_ocr(self_page, flags: int = 0, language: str = "eng", dpi: int = 72, full: bool = False, tessdata: str | None = None):
            langs_used.append(language)
            clock["now"] += 15.0  # Exceeds 12.0s budget after first OCR page!
            return f"TP_{self_page.number}"

        orig_get_text = fitz.Page.get_text

        def _fake_get_text(self_page, opt: str = "text", *args, **kwargs):
            tp = kwargs.get("textpage")
            if isinstance(tp, str) and tp.startswith("TP_"):
                return "References\n[1] Smith, J. (2021). Deep Neural Architectures in Vision."
            return orig_get_text(self_page, opt, *args, **kwargs)

        import integrity_checker.extraction.mupdf_parser as mupdf_mod

        monkeypatch.setattr(mupdf_mod.time, "monotonic", _fake_monotonic)
        monkeypatch.setattr(fitz.Page, "get_textpage_ocr", _fake_ocr)
        monkeypatch.setattr(fitz.Page, "get_text", _fake_get_text)

        parsed = MuPdfParser().parse(pdf_path)
        assert langs_used == ["eng"]
        # Only 1 page OCR'd before deadline expired, and p0 was excluded due to <25% raster coverage
        assert len(parsed.metadata["ocr_pages_recovered"]) == 1
        assert 0 not in parsed.metadata["ocr_pages_recovered"]

    def test_mupdf_parse_end_to_end_decodes_legacy_pdf_and_str_pages_compat(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        pdf_path = tmp_path / "legacy_tcvn3.pdf"
        doc = fitz.open()
        p = doc.new_page(width=595, height=842)
        p.insert_text(
            (50, 72),
            "Tµi liÖu tham kh¶o\n"
            "[1] NguyÔn V¨n A (2020), Gi¸o tr×nh C¬ së d÷ liÖu, NXB Gi¸o dôc.\n"
            "[2] François Müller (2019), Über die Theorie.",
            fontsize=11,
        )
        doc.save(str(pdf_path))
        doc.close()

        parsed = MuPdfParser().parse(pdf_path)
        assert parsed.metadata["legacy_encoding_detected"] == "tcvn3"
        assert parsed.metadata["ocr_pages_recovered"] == []
        assert "Tài liệu tham khảo" in parsed.pages[0].text
        assert "Nguyễn Văn A (2020), Giáo trình Cơ sở dữ liệu" in parsed.pages[0].text
        assert "François Müller (2019), Über die Theorie." in parsed.pages[0].text

        # Also verify list[str] pages compatibility on _maybe_ocr_sparse_pages
        scan_path = tmp_path / "scan_str.pdf"
        _make_raster_pdf(scan_path, num_pages=2, coverage_ratio=0.60)
        tess_dir = tmp_path / "tess_str"
        tess_dir.mkdir()
        (tess_dir / "eng.traineddata").write_bytes(b"x")
        (tess_dir / "vie.traineddata").write_bytes(b"x")
        monkeypatch.setenv("TESSDATA_PREFIX", str(tess_dir))
        monkeypatch.setattr(fitz.Page, "get_textpage_ocr", lambda self_p, **kw: "TP_STR")
        orig_gt = fitz.Page.get_text
        monkeypatch.setattr(
            fitz.Page,
            "get_text",
            lambda self_p, opt="text", *a, **kw: (
                "Tài liệu tham khảo [1] Trần Văn B (2021)"
                if kw.get("textpage") == "TP_STR"
                else orig_gt(self_p, opt, *a, **kw)
            ),
        )
        raw_doc = fitz.open(str(scan_path))
        try:
            str_pages = ["", ""]
            rec = MuPdfParser()._maybe_ocr_sparse_pages(raw_doc, str_pages)
            assert rec == [0, 1]
            assert all("Trần Văn B" in s for s in str_pages)
        finally:
            raw_doc.close()


def test_dockerfile_runtime_installs_tesseract_eng_and_vie() -> None:
    repo_root = Path(__file__).resolve().parents[2]
    dockerfile_text = (repo_root / "Dockerfile").read_text(encoding="utf-8")
    runtime_section = dockerfile_text.split("FROM python:3.11-slim AS runtime", 1)[1]
    assert "tesseract-ocr-eng" in runtime_section
    assert "tesseract-ocr-vie" in runtime_section
    assert "--no-install-recommends" in runtime_section
    assert "TESSDATA_PREFIX" in runtime_section


class TestFixRound1Regressions:
    def test_mupdf_end_to_end_tcvn3_soft_hyphen_0xad_demoted_to_ascii_hyphen(
        self, tmp_path: Path
    ) -> None:
        """Finding 1: MuPDF stext converts TCVN3 0xAD ('ư') into ASCII '-' (0x2D)."""
        pdf_path = tmp_path / "tcvn3_u_horn_0xad.pdf"
        doc = fitz.open()
        page = doc.new_page(width=595, height=842)
        # Raw TCVN3 bytes using 0xAD ('\xad') for untoned 'ư' and 'ươ':
        raw_tcvn3_pdf_text = (
            "CH\xad\u00a5NG 1: TR\xad\u00eaNG H\xadNG T\xad LI\u00d6U\n"
            "[1] Tr\xad\u00acng V\u00a8n H\xadng (2018), Ph\xad\u00acng ph\u00b8p l\xad\u00eeng t\u00f6 "
            "trong tr\xad\u00eang t\xad\u00acng t\u00b8c \u00ae\xad\u00eec nghi\u00aan c\u00f8u t\u00f5 t\xad li\u00d6u.\n"
            "- M\u00ab h\u00d7nh t\u00e8i \xadu v\u00b5 \xad\u00edc l\xad\u00eeng c\u00f1a Jean-Paul (2018-2020) "
            "ch\xada l\xadu tr\u00aan UTF-8 (t\xad/c\u00abng, p-n)."
        )
        page.insert_text((40, 72), raw_tcvn3_pdf_text, fontsize=10)
        doc.save(str(pdf_path))
        doc.close()

        parsed = MuPdfParser().parse(pdf_path)
        assert parsed.metadata["legacy_encoding_detected"] == "tcvn3"
        lines = [ln.strip() for ln in parsed.pages[0].text.strip().splitlines()]
        assert lines[0] == "CHƯƠNG 1: TRƯỜNG HƯNG TƯ LIỆU"
        assert lines[1] == (
            "[1] Trương Văn Hưng (2018), Phương pháp lượng tử "
            "trong trường tương tác được nghiên cứu từ tư liệu."
        )
        assert lines[2] == (
            "- Mô hình tối ưu và ước lượng của Jean-Paul (2018-2020) "
            "chưa lưu trên UTF-8 (tư/công, p-n)."
        )

        # Also verify Lévi-Strauss on a TCVN3 line preserves its hyphen & foreign accent
        levi_line = "Theo L\u00e9vi-Strauss (1962), ph-\u00acng ph\u00b8p c\u00cau tr\u00f3c ®-\u00eec ¸p dông."
        dec_levi, det_levi = VietnameseLegacyTranscoder.normalize_legacy_vietnamese(levi_line)
        assert det_levi == "tcvn3"
        assert "phương pháp cấu trúc được áp dụng." in dec_levi
        assert "L" in dec_levi and "-Strauss" in dec_levi

    def test_short_french_lines_immune_under_font_hint_and_consecutive_bib_entries(self) -> None:
        """Finding 2: passes_hinted & prev_line_enc must never corrupt short French lines."""
        for fr_line in ("Tôt le matin à Paris", "Tôt ou tard", "Côté mer"):
            assert VietnameseLegacyTranscoder.normalize_legacy_vietnamese(
                fr_line, font_hint=".VnTime"
            ) == (fr_line, None)

        for fr_vni in ("Là où tu es né", "Là tu vas", "Où tu vas"):
            assert VietnameseLegacyTranscoder.normalize_legacy_vietnamese(
                fr_vni, font_hint="VNI-Times"
            ) == (fr_vni, None)

        consecutive_tcvn = (
            "[1] NguyÔn V¨n A (2020), Gi¸o tr×nh C¬ së d÷ liÖu, NXB Gi¸o dôc.\n"
            "[2] Tôt le matin à Paris\n"
            "3.Tôt ou tard\n"
            "- Là où tu es né"
        )
        for hint in (None, ".VnTime"):
            dec_tcvn, det_tcvn = VietnameseLegacyTranscoder.normalize_legacy_vietnamese(
                consecutive_tcvn, font_hint=hint
            )
            assert det_tcvn == "tcvn3"
            assert dec_tcvn.splitlines() == [
                "[1] Nguyễn Văn A (2020), Giáo trình Cơ sở dữ liệu, NXB Giáo dục.",
                "[2] Tôt le matin à Paris",
                "3.Tôt ou tard",
                "- Là où tu es né",
            ]

        consecutive_vni = (
            "[1] Traàn Vaên B (2021), Heä thoáng ñieàu khieån töï ñoäng.\n"
            "[2] Là où tu es né\n"
            "2. Là tu vas"
        )
        for hint in (None, "VNI-Times"):
            dec_vni, det_vni = VietnameseLegacyTranscoder.normalize_legacy_vietnamese(
                consecutive_vni, font_hint=hint
            )
            assert det_vni == "vni_windows"
            assert dec_vni.splitlines() == [
                "[1] Trần Văn B (2021), Hệ thống điều khiển tự động.",
                "[2] Là où tu es né",
                "2. Là tu vas",
            ]

    def test_capslock_tcvn3_lower_base_and_vntimeh_all_caps_font(self) -> None:
        """Finding 3: CapsLock TCVN3 0xA8..0xAE uppercasing + .Vn*H display fonts."""
        caps_block = "®¹I HäC B¸CH KHOA\nLêI C¶M ¬N\nNGUYÔN V¨N A\nCH-¬NG 1: GIíI THIÖU"
        decoded_caps, det_caps = VietnameseLegacyTranscoder.normalize_legacy_vietnamese(
            caps_block, font_hint=".VnTime"
        )
        assert det_caps == "tcvn3"
        assert decoded_caps == "ĐẠI HỌC BÁCH KHOA\nLỜI CẢM ƠN\nNGUYỄN VĂN A\nCHƯƠNG 1: GIỚI THIỆU"

        decoded_h, det_h = VietnameseLegacyTranscoder.normalize_legacy_vietnamese(
            "ch-¬ng 1: tæng quan tµi liÖu", font_hint=".VnTimeH"
        )
        assert det_h == "tcvn3"
        assert decoded_h == "CHƯƠNG 1: TỔNG QUAN TÀI LIỆU"

        decoded_sub_h, det_sub_h = VietnameseLegacyTranscoder.normalize_legacy_vietnamese(
            "lêi c¶m ¬n", font_hint="BCDEFA+.VnArialH,Bold"
        )
        assert det_sub_h == "tcvn3"
        assert decoded_sub_h == "LỜI CẢM ƠN"

        # Mixed .VnTimeH heading + .VnTime body on one PDF page must return non-H .VnTime hint
        class _DummyPage:
            def __init__(self, fonts):
                self._fonts = fonts

            def get_fonts(self):
                return self._fonts

        only_h_page = _DummyPage([(1, "ttf", "TrueType", "ABCDEF+.VnTimeH", "F1", "WinAnsi")])
        mixed_h_page = _DummyPage(
            [
                (1, "ttf", "TrueType", "ABCDEF+.VnTimeH", "F1", "WinAnsi"),
                (2, "ttf", "TrueType", "BCDEFA+.VnTime", "F2", "WinAnsi"),
            ]
        )
        assert MuPdfParser._extract_page_font_hint(only_h_page) == "ABCDEF+.VnTimeH"
        assert MuPdfParser._extract_page_font_hint(mixed_h_page) == "BCDEFA+.VnTime"

    def test_gi_coalesced_ie_codas_gieng_giec_valid_and_decoded(self) -> None:
        """Finding 4: gi + iêng / iêc -> giếng, giềng, giêng, giếc."""
        for word in ("giếng", "giềng", "giêng", "giếc"):
            assert is_valid_vietnamese_syllable(word) == (True, True)

        assert VietnameseLegacyTranscoder.normalize_legacy_vietnamese(
            "giÕng khoan", font_hint=".VnTime"
        ) == ("giếng khoan", "tcvn3")
        assert VietnameseLegacyTranscoder.normalize_legacy_vietnamese(
            "c¸ giÕc ®ång vµ th¸ng giªng l¸ng giÒng"
        ) == ("cá giếc đồng và tháng giêng láng giềng", "tcvn3")

        assert VietnameseLegacyTranscoder.normalize_legacy_vietnamese(
            "gieáng khoan", font_hint="VNI-Times"
        ) == ("giếng khoan", "vni_windows")

    def test_bilingual_docx_paragraph_tcvn3_sentence_plus_english_and_french_sentences(
        self,
    ) -> None:
        """Multi-sentence DOCX paragraph: TCVN3 Vietnamese sentence decodes while English & French stay intact."""
        raw_para = (
            "Tr\u00ad\u00eang \u00a7\u00b9i h\u00e4c B\u00b8ch khoa H\u00b5 N\u00e9i nghi\u00aan c\u00f8u "
            "\u00f8ng d\u00f4ng tr\u00dd tu\u00d6 nh\u00a9n t\u00b9o trong ki\u00d3m \u00ae\u00denh ch\u00cat "
            "l\u00ad\u00eeng c\u00abng tr\u00d7nh. "
            "Reinforced concrete design in Vietnam strictly follows national technical standard TCVN 5574:2018 [5]. "
            "François Müller and Søren Kierkegaard (2019) studied European philosophy."
        )
        decoded, detected = VietnameseLegacyTranscoder.normalize_legacy_vietnamese(raw_para)
        assert detected == "tcvn3"
        assert decoded.startswith(
            "Trường Đại học Bách khoa Hà Nội nghiên cứu ứng dụng trí tuệ nhân tạo trong kiểm định chất lượng công trình. "
        )
        assert "François Müller and Søren Kierkegaard (2019)" in decoded


