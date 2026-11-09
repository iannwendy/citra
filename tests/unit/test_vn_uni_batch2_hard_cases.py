"""TDD regression tests for hard cases discovered on 100 Vietnamese university PDFs (Batch 2)."""

from __future__ import annotations

from unittest.mock import patch

import httpx
import pytest

from integrity_checker.extraction import mupdf_parser, pdfplumber_parser
from integrity_checker.extraction.base import Document, Page
from integrity_checker.extraction.citation_extractor import CitationExtractor
from integrity_checker.extraction.patterns.utils import extract_url
from integrity_checker.extraction.reference_parser import ReferenceListParser
from integrity_checker.extraction.section_segmenter import SectionSegmenter, SectionType
from integrity_checker.linking import CitationLinker
from integrity_checker.linking.statuses import CitationMappingStatus
from integrity_checker.logic.neuro_symbolic_checker import NeuroSymbolicChecker
from integrity_checker.logic.rules import SymbolicRules
from integrity_checker.matching.author_parser import parse_authors
from integrity_checker.models.citation import Citation, CitationType
from integrity_checker.models.source import SourceCandidate, SourceResult
from integrity_checker.models.validation import MatchFeatures, ValidationLabel
from integrity_checker.retrieval.link_validator import LinkStatus, LinkValidator
from integrity_checker.retrieval.retrieval_orchestrator import RetrievalOrchestrator


def _doc(*pages_text: str) -> Document:
    return Document(
        file_path="test_batch2.pdf",
        num_pages=len(pages_text),
        parser_used="test",
        pages=[Page(page_num=i + 1, text=t) for i, t in enumerate(pages_text)],
    )


def _parse_refs_from_bib_text(bib_text: str) -> list[Citation]:
    doc = _doc("Chương 1. Mở đầu\nNội dung bài báo cáo.", bib_text)
    doc.sections = SectionSegmenter().segment(doc)
    return ReferenceListParser().parse_reference_section(doc)


# ---------------------------------------------------------------------------
# BUG-EXT-1: Default page limit >= 500 so 200+ page theses are not truncated
# ---------------------------------------------------------------------------
def test_mupdf_and_pdfplumber_default_max_pages_at_least_500() -> None:
    assert mupdf_parser.MAX_PDF_PAGES >= 500
    assert pdfplumber_parser.MAX_PDF_PAGES >= 500


# ---------------------------------------------------------------------------
# BUG-SEG-1: Early LaTeX TOC false-positives & Vietnamese LaTeX \refname "Tài liệu"
# ---------------------------------------------------------------------------
def test_segmenter_ignores_latex_toc_entry_and_finds_real_latex_tai_lieu_section() -> None:
    pages = ["TRƯỜNG ĐẠI HỌC KHOA HỌC TỰ NHIÊN\nKHÓA LUẬN TỐT NGHIỆP"]
    pages.append(
        "Mục lục\n"
        "1 Giới thiệu chung\n"
        "3\n"
        "2 Cơ sở lý thuyết\n"
        "10\n"
        "3 Thực nghiệm và đánh giá\n"
        "22\n"
        "Tài liệu tham khảo\n"
        "34"
    )
    for p in range(3, 35):
        pages.append(f"Chương nội dung trang {p}. Phân tích mô hình học máy chi tiết.")
    pages.append(
        "Tài liệu\n"
        "[1] Breiman, L. (2001). Random forests. Machine Learning, 45(1), 5-32.\n"
        "[2] Freund, Y. & Schapire, R. E. (1997). A decision-theoretic generalization of on-line learning."
    )
    doc = _doc(*pages)
    sections = SectionSegmenter().segment(doc)
    bib_sections = [s for s in sections if s.section_type == SectionType.BIBLIOGRAPHY]
    assert len(bib_sections) == 1
    assert bib_sections[0].start_page == 35


def test_segmenter_ignores_early_toc_continuation_page_without_muc_luc_title() -> None:
    pages = ["BÌA ĐỒ ÁN", "LỜI CẢM ƠN", "TÓM TẮT", "Mục lục\n1 Mở đầu\n6\n2 Cơ sở lý thuyết\n12"]
    # Page 5 is a continuation of a LaTeX TOC (no "Mục lục" heading on page 5 itself)
    pages.append(
        "4.2 Kết quả thực nghiệm\n"
        "30\n"
        "5 Kết luận và hướng phát triển\n"
        "36\n"
        "Tài liệu tham khảo\n"
        "38"
    )
    for p in range(6, 39):
        pages.append(f"Nội dung chương mục trang {p}.")
    pages.append(
        "Tài liệu\n"
        "[1] Vapnik, V. (1995). The Nature of Statistical Learning Theory. Springer.\n"
        "[2] Cortes, C. & Vapnik, V. (1995). Support-vector networks. Machine Learning, 20, 273-297."
    )
    doc = _doc(*pages)
    sections = SectionSegmenter().segment(doc)
    bib_sections = [s for s in sections if s.section_type == SectionType.BIBLIOGRAPHY]
    assert len(bib_sections) == 1
    assert bib_sections[0].start_page == 39


# ---------------------------------------------------------------------------
# BUG-SEG-2: Implicit bibliography false-positives on SQL lab code & Appendix
# ---------------------------------------------------------------------------
def test_segmenter_does_not_treat_sql_insert_exercise_as_implicit_bibliography() -> None:
    pages = [f"Trang lý thuyết cơ sở dữ liệu {i}" for i in range(1, 22)]
    sql_page = (
        "1. Thêm dữ liệu cho bảng nhân viên:\n"
        "1 INSERT INTO NHANVIEN VALUES ('NV01', N'Nguyễn Văn A', '2023 -07 -10');\n"
        "2. Thêm dữ liệu cho bảng phòng ban:\n"
        "1 INSERT INTO PHONGBAN VALUES ('PB01', N'Kỹ thuật', '2023 -08 -15');\n"
        "3. Truy vấn danh sách nhân viên:\n"
        "1 SELECT * FROM NHANVIEN WHERE NGAYVAOLAM >= '2022 -01 -01';\n"
        "4. Cập nhật mức lương cơ bản:\n"
        "1 UPDATE NHANVIEN SET LUONG = 15000000 WHERE NGAYSINH = '2001 -05 -20';"
    )
    for _ in range(22, 33):
        pages.append(sql_page)
    doc = _doc(*pages)
    sections = SectionSegmenter().segment(doc)
    assert all(s.section_type != SectionType.BIBLIOGRAPHY for s in sections)


def test_segmenter_does_not_create_empty_bibliography_when_page_starts_with_phu_luc() -> None:
    pages = [f"Nội dung khóa luận trang {i}" for i in range(1, 74)]
    pages.append(
        "PHỤ LỤC\n"
        "[1] Bảng câu hỏi khảo sát sinh viên đại học năm 2023.\n"
        "[2] Phiếu phỏng vấn sâu chuyên gia kinh tế năm 2023.\n"
        "[3] Bảng tổng hợp kết quả kiểm định SPSS năm 2023.\n"
        "[4] Danh sách các doanh nghiệp tham gia khảo sát năm 2023."
    )
    doc = _doc(*pages)
    sections = SectionSegmenter().segment(doc)
    assert all(s.section_type != SectionType.BIBLIOGRAPHY for s in sections)
    app_sections = [s for s in sections if s.section_type == SectionType.APPENDIX]
    assert len(app_sections) == 1
    assert app_sections[0].start_page == 74


# ---------------------------------------------------------------------------
# BUG-SEG-3: Header variants & post-bibliography stop boundaries
# ---------------------------------------------------------------------------
@pytest.mark.parametrize(
    "bib_page_text",
    [
        "IV. \nTÀI LIỆU THAM KHẢO () \nHà, M. (2019). Trẻ suy sụp vì bắt nạt qua mạng xã hội.",
        "XI. Tài liệu tham khảo\n[1] Trần Thị B (2022). Phân tích tài chính. NXB Tài chính.",
        "PHẦN 5 - NGUỒN THAM KHẢO\n[1] Lê Văn C (2023). Thiết kế hệ thống IoT. NXB Bách Khoa.",
        "Danh mục tài liệu tham khảo, trích dẫn\n[1] Phạm Văn D (2020). Lịch sử Đảng. NXB Chính trị Quốc gia.",
    ],
)
def test_segmenter_supports_vietnamese_bibliography_header_variants(bib_page_text: str) -> None:
    doc = _doc("Chương 1. Mở đầu\nNội dung tiểu luận.", bib_page_text)
    sections = SectionSegmenter().segment(doc)
    bib_sections = [s for s in sections if s.section_type == SectionType.BIBLIOGRAPHY]
    assert len(bib_sections) == 1
    assert bib_sections[0].start_page == 2


def test_reference_parser_stops_at_post_bib_chi_muc_phan_cong_and_software_list() -> None:
    refs_index = _parse_refs_from_bib_text(
        "Tài liệu tham khảo\n"
        "[1] Merkwirth, C. & Lengauer, T. (2005). Automatic generation of complementary descriptors. J. Chem. Inf. Model., 45, 1159-1168.\n"
        "Chỉ mục\n"
        "A\n"
        "Activation function, 12\n"
        "B\n"
        "Backpropagation, 19"
    )
    assert len(refs_index) == 1
    assert "Chỉ mục" not in refs_index[0].raw_text
    assert "Backpropagation" not in refs_index[0].raw_text

    refs_task = _parse_refs_from_bib_text(
        "6.1.\n"
        "Tài liệu tham khảo\n"
        "[1] Sommerville, I. (2016). Software Engineering (10th ed.). Pearson.\n"
        "6.2.\n"
        "Chi tiết phân công công việc\n"
        "1. Nguyễn Văn A (20120001) - Thiết kế cơ sở dữ liệu - 100%\n"
        "2. Trần Văn B (20120002) - Lập trình giao diện - 100%"
    )
    assert len(refs_task) == 1
    assert "phân công" not in refs_task[0].raw_text.lower()

    refs_tools = _parse_refs_from_bib_text(
        "TÀI LIỆU THAM KHẢO\n"
        " Tiếng Việt:\n"
        "1. Nguyễn Văn Hiệp (2019). Thiết kế hệ thống nhúng. NXB Bách Khoa.\n"
        " Phần mềm và thư viện được sử dụng:\n"
        "1. Microsoft Visual Studio 2017 Community\n"
        "2. Microsoft Visual Code"
    )
    assert len(refs_tools) == 1
    assert "Visual Studio" not in refs_tools[0].raw_text


# ---------------------------------------------------------------------------
# BUG-REF-1: ReferenceListParser, URL extraction, APA quoted title, ACM hijacks
# ---------------------------------------------------------------------------
def test_reference_parser_splits_word_continuous_numbering_above_100_across_subheaders() -> None:
    bib_text = (
        "DANH MỤC TÀI LIỆU THAM KHẢO\n"
        "Tiếng Việt\n"
        "117. Đỗ Duy Thanh, Nguyễn Đình Thuân (2025). Bài giảng Hệ thống Quản trị Quy\n"
        "trình Nghiệp vụ (IE203). Khoa Hệ thống Thông tin, Trường Đại học Công nghệ\n"
        "Thông tin – ĐHQG-HCM.\n"
        "118. Bộ Y tế (2020). Quy chuẩn Kỹ thuật Quốc gia về Vệ sinh An toàn Thực phẩm\n"
        "đối với Cơ sở Dịch vụ Ăn uống. NXB Y học, Hà Nội.\n"
        "119. Công ty Cổ phần Quốc tế Việt Thái (VTI) (2024). Sổ tay Vận hành Tiêu chuẩn\n"
        "Chuỗi Cửa hàng Highlands Coffee (Store Operations Manual - SOP). Tài liệu\n"
        "tham khảo và tổng hợp phục vụ nghiên cứu học thuật dựa trên quan sát thực địa và\n"
        "SOP công khai.\n"
        "120. Vietdata (2025). Báo cáo Thị trường Dịch vụ Ẩm thực (F&B) và Chuỗi Cà phê\n"
        "Việt Nam. Báo cáo Phân tích Chuyên sâu Vietdata Market Intelligence.\n"
        "Tiếng Anh (International Standards & Academic Papers)\n"
        "121. Dumas, M., La Rosa, M., Mendling, J., & Reijers, H. A. (2018). Fundamentals\n"
        "of Business Process Management (2nd ed.). Springer-Verlag Berlin Heidelberg.\n"
        "https://doi.org/10.1007/978-3-662-56509-4\n"
        "122. Object Management Group (OMG) (2013). Business Process Model and\n"
        "Notation (BPMN) Version 2.0.2. International Standard ISO/IEC 19510:2013.\n"
        "123. Silver, B. (2011). BPMN Method and Style (2nd ed.). Cody-Cassidy Press,\n"
        "Aptos, CA.\n"
        "124. Weske, M. (2019). Business Process Management: Concepts, Languages,\n"
        "Architectures (3rd ed.). Springer. https://doi.org/10.1007/978-3-662-59432-2"
    )
    refs = _parse_refs_from_bib_text(bib_text)
    assert len(refs) == 8
    assert any("Dumas" in r.raw_text and "Vietdata" not in r.raw_text for r in refs)
    assert any("Vietdata" in r.raw_text and "Bộ Y tế" not in r.raw_text for r in refs)
    assert all("International Standards & Academic Papers" not in r.raw_text for r in refs)


def test_reference_parser_does_not_glue_page_number_onto_trailing_slash_url() -> None:
    bib_text = (
        "TÀI LIỆU THAM KHẢO\n"
        "[11] DocuSign, \"How electronic signatures work,\" 2023. [Online]. Available:\n"
        "https://www.docusign.com/\n"
        "71\n"
        "[12] National Institute of Standards and Technology, \"Digital Signature Standard (DSS),\" FIPS PUB 186-5, 2023."
    )
    refs = _parse_refs_from_bib_text(bib_text)
    assert len(refs) == 2
    assert refs[0].url == "https://www.docusign.com/"


def test_url_extraction_preserves_balanced_parentheses_and_splits_glued_urls() -> None:
    u1 = extract_url(
        "1. Công ty 1VS (2020), Tích hợp hệ thống, truy cập từ "
        "http://www.1vs.vn/tintuc/15194_tich-hop-he-thong-(phan-1)-cac-muc-do.html."
    )
    assert u1 == "http://www.1vs.vn/tintuc/15194_tich-hop-he-thong-(phan-1)-cac-muc-do.html"

    u2 = extract_url(
        "[14] Source repositories: https://github.com/org/repo-one-https://github.com/org/repo-two"
    )
    assert u2 == "https://github.com/org/repo-one"

    u3 = extract_url(
        "Tham khảo: http:// tailieu.vn/baocao.pdfhttps://khac.vn/trang-chu"
    )
    assert u3 is None or "https://khac.vn" not in u3


def test_reference_parser_strips_wingdings_pua_bullets() -> None:
    bib_text = (
        "TÀI LIỆU THAM KHẢO\n"
        "\uf0b7 Nguyễn Văn A (2021). Giáo trình Mạng máy tính. NXB Giáo dục.\n"
        "\uf0d8 Trần Văn B (2022). An ninh mạng hiện đại. NXB Khoa học và Kỹ thuật."
    )
    refs = _parse_refs_from_bib_text(bib_text)
    assert len(refs) == 2
    for r in refs:
        assert not r.raw_text.startswith(("\uf0b7", "\uf0d8"))
        if r.title:
            assert not r.title.startswith(("\uf0b7", "\uf0d8"))


def test_reference_parser_splits_ocr_period_after_surname_german_apa_entries() -> None:
    bib_text = (
        "Tài liệu tham khảo\n"
        "Brinkschulte, M. (2015). Die Einleitung eines wissenschaftlichen Textes, "
        "https://uni.de/Die_Einleitung_eines_wissenschaftlichen_Textes-l.pdf,\n"
        "Accessed 10/12/2021 10:15\n"
        "Kruse. o. (2007): Keine Angst vor dem leeren Blatt. Ohne Schreibblockaden durchs Studium (9.\n"
        "Auflage). Frankfurt a.M./New York: Campus.\n"
        "Kùhtz. s. (2011). Wissenschaftlich formulieren. Paderborn: Ferdinand Schöningh.\n"
        "Lehnen, K. (2012): Erwerb wissenschaftlicher Textroutinen. In: Schreiben, S. 33-52."
    )
    refs = _parse_refs_from_bib_text(bib_text)
    assert len(refs) == 4
    assert any(r.authors and r.authors[0].last_name == "kruse" for r in refs)
    assert any(r.authors and "htz" in r.authors[0].last_name for r in refs)


def test_apa_comma_quoted_title_separates_title_from_venue() -> None:
    refs = _parse_refs_from_bib_text(
        "References\n"
        '18. Pedregosa, F. et al. (2011), "Scikit-learn: Machine Learning in Python", '
        "Journal of Machine Learning Research, 12, pp. 2825–2830."
    )
    assert len(refs) == 1
    cit = refs[0]
    assert cit.title == "Scikit-learn: Machine Learning in Python"
    assert cit.venue is not None and "Journal of Machine Learning Research" in cit.venue


def test_acm_parser_avoids_greedy_hijacks_on_sommerville_goodfellow_dauphin_jurafsky() -> None:
    refs = _parse_refs_from_bib_text(
        "References\n"
        "[5] Ian Sommerville, Software Engineering, 10th Edition, Pearson Education, 2016.\n"
        "[78] I. Goodfellow, Y. Bengio, and A. Courville, Deep Learning. MIT Press, 2016.\n"
        "[9] DAUPHIN, Yann N., et al. Language modeling with gated convolutional networks. "
        "In: International conference on machine learning. 2017. p. 933-941.\n"
        "[10] Speech and Language Processing. Daniel Jurafsky & James H. Martin. "
        "Copyright c 2019. Draft of October 2, 2019."
    )
    assert len(refs) == 4
    by_idx = {r.numeric_index: r for r in refs}

    assert by_idx[5].title == "Software Engineering"
    assert by_idx[5].year == "2016"

    assert by_idx[78].title == "Deep Learning"
    assert by_idx[78].year == "2016"

    assert by_idx[9].title is not None
    assert "Language modeling with gated convolutional networks" in by_idx[9].title
    assert by_idx[9].year == "2017"

    assert by_idx[10].title == "Speech and Language Processing"
    assert by_idx[10].year == "2019"


# ---------------------------------------------------------------------------
# BUG-EXT-2: CitationExtractor body false-positives
# ---------------------------------------------------------------------------
def test_citation_extractor_ignores_statistical_code_xpath_word_comment_and_narrative_false_positives() -> None:
    body_text = (
        "Hệ số liên kết (Cramér's V) và độ lớn hiệu ứng (Cohen's d) cho thấy mức ý nghĩa cao.\n"
        "Chân điều khiển nhận mức thấp (Logic 0), ngắt ngoài (Priority 1), mã lỗi deadlock (Msg 1205).\n"
        "Biểu thức XPath truy xuất phần tử /KetQua[1]/KyNang[1] trong tài liệu XML.\n"
        "Commented [1]: Sinh viên cần bổ sung thêm bảng số liệu thực tế.\n"
        "## [1] 0.845231\n"
        "Đại hội đại biểu toàn quốc của Đảng (1951) và bộ phim Mai (2024) cùng hệ thống dịch Mark II (1964).\n"
        "Nguyễn Sinh Sắc đã tham dự kỳ thi Hương và đỗ cử nhân tại trường thi Nghệ An (1894).\n"
        "Mô hình rừng ngẫu nhiên cho độ chính xác vượt trội (Breiman, 2001)."
    )
    doc = _doc(body_text, "References\nBreiman, L. (2001). Random forests. Machine Learning, 45, 5-32.")
    doc.sections = SectionSegmenter().segment(doc)
    body_cits = CitationExtractor().extract_from_document(doc)
    raws = [c.raw_text for c in body_cits if c.citation_type == CitationType.IN_TEXT]
    assert raws == ["(Breiman, 2001)"]


# ---------------------------------------------------------------------------
# BUG-LINK-1: Corporate author acronyms & OCR Vietnamese inverted full names
# ---------------------------------------------------------------------------
def test_linker_matches_corporate_acronym_semicolon_org_and_ocr_vietnamese_fullname() -> None:
    from integrity_checker.matching.author_parser import parse_authors

    bibs = [
        Citation(
            raw_text="Jollibee Foods Corporation (JFC). (2023). Annual Report 2023.",
            citation_type=CitationType.REFERENCE_LIST,
            authors=parse_authors("Jollibee Foods Corporation (JFC)"),
            year="2023",
            title="Annual Report 2023",
            reference_id="ref-jfc",
        ),
        Citation(
            raw_text="Breiman, L. (2001). Random forests. Machine Learning, 45, 5-32.",
            citation_type=CitationType.REFERENCE_LIST,
            authors=parse_authors("Breiman, L."),
            year="2001",
            title="Random forests",
            reference_id="ref-breiman",
        ),
        Citation(
            raw_text="Object Management Group (OMG). (2017). Unified Modeling Language Specification.",
            citation_type=CitationType.REFERENCE_LIST,
            authors=parse_authors("Object Management Group (OMG)"),
            year="2017",
            title="Unified Modeling Language Specification",
            reference_id="ref-omg",
        ),
        Citation(
            raw_text="Nguyên, Thu Trang (2021). Nghiên cứu cụm danh từ tiếng Đức. Khóa luận tốt nghiệp.",
            citation_type=CitationType.REFERENCE_LIST,
            authors=parse_authors("Nguyên, Thu Trang"),
            year="2021",
            title="Nghiên cứu cụm danh từ tiếng Đức",
            reference_id="ref-trang",
        ),
    ]
    body = [
        Citation(raw_text="(JFC, 2023)", citation_type=CitationType.IN_TEXT),
        Citation(raw_text="(Breiman, 2001; JFC, 2023)", citation_type=CitationType.IN_TEXT),
        Citation(
            raw_text="OMG (2017)",
            citation_type=CitationType.IN_TEXT,
            authors=parse_authors("OMG"),
            year="2017",
        ),
        Citation(
            raw_text="Nguyền Thu Trang (2021)",
            citation_type=CitationType.IN_TEXT,
            authors=parse_authors("Nguyền Thu Trang"),
            year="2021",
        ),
    ]
    res = CitationLinker().link(body, bibs)
    assert len(res.links) == 5
    assert all(link.status == CitationMappingStatus.MATCHED for link in res.links)


# ---------------------------------------------------------------------------
# BUG-RET-1: Retrieval & Verdict accuracy on NIST FIPS DOIs, SSL cert-chain,
# known book chapters, web/doc resources, and domestic VN textbooks/theses
# ---------------------------------------------------------------------------
def test_filter_quality_candidates_preserves_authorless_exact_doi_nist_standard() -> None:
    orch = RetrievalOrchestrator.__new__(RetrievalOrchestrator)
    cit = Citation(
        raw_text='[12] NIST, "Secure Hash Standard (SHS)," FIPS PUB 180-4, doi: 10.6028/NIST.FIPS.180-4.',
        citation_type=CitationType.REFERENCE_LIST,
        authors=["NIST"],
        title="Secure Hash Standard (SHS)",
        year="2015",
        doi="10.6028/NIST.FIPS.180-4",
    )
    cand = SourceCandidate(
        source_name="crossref",
        found=True,
        doi="10.6028/nist.fips.180-4",
        title="Secure hash standard",
        authors=[],
        year="2015",
        venue="National Institute of Standards and Technology",
        confidence=0.95,
    )
    filtered, succeeded = orch._filter_quality_candidates([cand], ["crossref"], cit)
    assert len(filtered) == 1
    assert "crossref" in succeeded
    assert len(filtered[0].authors) >= 1


@pytest.mark.asyncio
async def test_link_validator_treats_ssl_cert_verify_failed_as_restricted_alive() -> None:
    async def mock_head_ssl_err(self, url, **kwargs):
        raise httpx.ConnectError(
            "[SSL: CERTIFICATE_VERIFY_FAILED] certificate verify failed: unable to get local issuer certificate"
        )

    validator = LinkValidator()
    with patch.object(httpx.AsyncClient, "head", mock_head_ssl_err):
        res = await validator.validate_url("https://moh.gov.vn/thong-ke-y-te")

    assert res.status == LinkStatus.RESTRICTED_ALIVE
    assert res.is_broken is False
    assert res.is_valid is True


def test_neuro_symbolic_checker_verifies_chapter_inside_known_book_goodfellow_2016() -> None:
    checker = NeuroSymbolicChecker()
    cit = Citation(
        raw_text='[14] I. Goodfellow, Y. Bengio, and A. Courville, "Deep feedforward networks," in Deep Learning. MIT Press, 2016, ch. 6.',
        citation_type=CitationType.REFERENCE_LIST,
        authors=["I. Goodfellow", "Y. Bengio", "A. Courville"],
        title="Deep feedforward networks",
        year="2016",
        venue="Deep Learning. MIT Press",
    )
    known_cand = SourceCandidate(
        source_name="known_papers",
        found=True,
        title="Deep Learning",
        authors=["Goodfellow", "Bengio", "Courville"],
        year="2016",
        venue="MIT Press",
        confidence=1.0,
    )
    source = SourceResult(
        citation_raw=cit.raw_text,
        candidates=[known_cand],
        sources_queried=["known_papers", "crossref"],
        sources_succeeded=["known_papers"],
    )
    verdict = checker.check(cit, source)
    assert verdict.label == ValidationLabel.VERIFIED


def test_is_web_or_legal_resource_recognizes_retrieved_from_news_url_and_bare_official_docs() -> None:
    c_news = Citation(
        raw_text=(
            "Việt Cường. (2024). Thị trường đồ ăn nhanh Việt Nam năm 2024. Dân Trí. "
            "Retrieved May 10, 2024, from https://dantri.com.vn/kinh-doanh/thi-truong-2024.htm"
        ),
        citation_type=CitationType.REFERENCE_LIST,
        authors=["Việt Cường"],
        year="2024",
        title="Thị trường đồ ăn nhanh Việt Nam năm 2024",
        url="https://dantri.com.vn/kinh-doanh/thi-truong-2024.htm",
    )
    c_pandas = Citation(
        raw_text='[5] Pandas Development Team, "Pandas Documentation," 2023.',
        citation_type=CitationType.REFERENCE_LIST,
        authors=["Pandas Development Team"],
        year="2023",
        title="Pandas Documentation",
    )
    c_esp32 = Citation(
        raw_text='[6] Espressif Systems, "ESP32 Series Datasheet," 2023.',
        citation_type=CitationType.REFERENCE_LIST,
        authors=["Espressif Systems"],
        year="2023",
        title="ESP32 Series Datasheet",
    )
    assert RetrievalOrchestrator.is_web_or_legal_resource(c_news) is True
    assert RetrievalOrchestrator.is_web_or_legal_resource(c_pandas) is True
    assert RetrievalOrchestrator.is_web_or_legal_resource(c_esp32) is True


@pytest.mark.parametrize(
    "raw_citation",
    [
        "Nguyễn Văn A (2020). Giáo trình Kinh tế vi mô. Trường Đại học Kinh tế Quốc dân.",
        "Trần Thị B (2022). Khóa luận tốt nghiệp: Phân tích chiến lược marketing tại Công ty X. Trường Đại học Ngoại thương.",
        "Công ty Cổ phần VNG (2023). Báo cáo thường niên năm 2023.",
    ],
)
def test_rules_treats_vietnamese_giao_trinh_khoa_luan_and_annual_report_as_unindexed_not_hallucination(
    raw_citation: str,
) -> None:
    rules = SymbolicRules()
    source = SourceResult(
        citation_raw=raw_citation,
        candidates=[],
        sources_queried=["crossref", "openalex", "semantic_scholar", "pubmed"],
        sources_succeeded=["crossref", "openalex", "semantic_scholar", "pubmed"],
    )
    outcome = rules.apply(MatchFeatures(), source, citation_raw=raw_citation)
    assert outcome.label == ValidationLabel.UNRESOLVED
    assert "R-UNINDEXED-BOOK-OR-SOURCE" in outcome.triggered_rules


# ---------------------------------------------------------------------------
# Round-2 Forensic Hard Cases (NFD headers, IEEE multi-author initials,
# ACM/APA/IEEE book & quoted-journal parsing, Book Review filtering,
# Rate-limit backoff exhaustion, GitHub [Online] & domestic VN theses)
# ---------------------------------------------------------------------------
def test_section_segmenter_handles_nfd_decomposed_phu_luc_before_bibliography() -> None:
    # Exact pattern from 067: Page 131 has NFD-decomposed 'PHU\u0323 LU\u0323C' with [1]..[3] localhost
    # manual steps, followed by Page 132 'TA\u0300I LIÊ\u0323U THAM KHA\u0309O'.
    p_body = "Chương 5. KẾT LUẬN\nHệ thống đáp ứng yêu cầu đề ra.\n" * 6
    p_appendix = (
        "PHU\u0323 LU\u0323C\n"
        "[1] Hướng dẫn sử dụng quy trình đăng nhập: https://localhost:8000/login\n"
        "[2] Hướng dẫn sử dụng quy trình đăng ký: https://localhost:8000/register\n"
        "[3] Hướng dẫn sử dụng quy trình mua hàng: https://localhost:8000/home\n"
    )
    p_bib = (
        "TA\u0300I LIÊ\u0323U THAM KHA\u0309O\n"
        "[1] Trang chính thức MySQL Documentation: https://dev.mysql.com/doc/\n"
        "[2] Trang chính thức Laravel Documentation: https://laravel.com/docs/9.x\n"
    )
    sections = SectionSegmenter().segment(_doc(p_body, p_appendix, p_bib))
    bib_secs = [s for s in sections if s.section_type == SectionType.BIBLIOGRAPHY]
    assert len(bib_secs) == 1
    assert bib_secs[0].start_page == 3
    assert "localhost:8000" not in bib_secs[0].text


def test_author_parser_preserves_ieee_forward_initials_multi_author_lists() -> None:
    # Exact patterns from 062 #2 & 088 #14, #71
    a1 = parse_authors("D. C. Montgomery, E. A. Peck, and G. G. Vining")
    assert [x.last_name for x in a1] == ["montgomery", "peck", "vining"]

    a2 = parse_authors("A. Summerville, S. Snodgrass, M. Mateas, and S. Ontanon")
    assert [x.last_name for x in a2] == ["summerville", "snodgrass", "mateas", "ontanon"]


def test_apa_comma_edition_publisher_stripped_from_book_title() -> None:
    # Exact patterns from 027 #3 and 047 #2
    r1 = _parse_refs_from_bib_text(
        "References\n"
        "[3] James F. Kurose and Keith W. Ross (2013), Computer Networking: A Top-Down Approach, Sixth Edition, Pearson Education."
    )[0]
    assert r1.title == "Computer Networking: A Top-Down Approach"
    assert r1.venue is not None and "Pearson" in r1.venue

    r2 = _parse_refs_from_bib_text(
        "References\n"
        "[2] Grady Booch, James Rumbaugh, Ivar Jacobson (2005), The Unified Modeling Language User Guide (2nd Edition), Addison-Wesley Professional."
    )[0]
    assert r2.title == "The Unified Modeling Language User Guide (2nd Edition)"
    assert r2.venue is not None and "Addison-Wesley" in r2.venue


def test_acm_book_does_not_swallow_comma_book_title_into_authors() -> None:
    # Exact pattern from 066 #6
    r = _parse_refs_from_bib_text(
        "References\n"
        "[6] Robin Nixon, Learning PHP, MySQL & JavaScript, O’Reilly Media, 2018."
    )[0]
    assert [a.last_name for a in r.authors] == ["nixon"]
    assert r.title == "Learning PHP, MySQL & JavaScript"


def test_ieee_quote_based_handles_quoted_journal_and_colon_quoted_subtitle() -> None:
    # Exact patterns from 070 #9 and 070 #2
    r_quinlan = _parse_refs_from_bib_text(
        "References\n"
        '[9] J. Ross Quinlan. Simplifying decision trees. "International journal of man-machine studies", 27(3):221–234, 1987.'
    )[0]
    assert r_quinlan.title == "Simplifying decision trees"
    assert [a.last_name for a in r_quinlan.authors] == ["quinlan"]
    assert r_quinlan.venue is not None and "man-machine studies" in r_quinlan.venue.lower()

    r_kazi = _parse_refs_from_bib_text(
        "References\n"
        '[2] Anees Kazi, Shayan Shekarforoush, and Nassir Navab. Inceptiongcn: "receptive field aware graph convolutional network for disease prediction". In IPMI, 2019.'
    )[0]
    assert r_kazi.title.lower() == "inceptiongcn: receptive field aware graph convolutional network for disease prediction"
    assert [a.last_name for a in r_kazi.authors] == ["kazi", "shekarforoush", "navab"]


def test_filter_quality_candidates_rejects_journal_book_review_with_reviewer_first_author() -> None:
    # Exact patterns from 036 #6 (Vaughn 1982 JASA review of Hillier & Lieberman) & 062 #2 (Gibbs Technometrics review)
    orch = RetrievalOrchestrator.__new__(RetrievalOrchestrator)
    cit = Citation(
        raw_text="Hillier, F. S., & Lieberman, G. J. (2015). Introduction to operations research (10th ed.). McGraw-Hill Education.",
        citation_type=CitationType.REFERENCE_LIST,
        authors=parse_authors("Hillier, F. S., & Lieberman, G. J."),
        title="Introduction to operations research (10th ed.)",
        year="2015",
        venue="McGraw-Hill Education",
    )
    cand_review = SourceCandidate(
        source_name="crossref",
        found=True,
        title="Introduction to Operations Research (3rd ed.).",
        authors=["Richard C. Vaughn", "Frederick S. Hillier", "Gerald J. Lieberman"],
        year="1982",
        venue="Journal of the American Statistical Association",
        confidence=0.85,
    )
    filtered, _ = orch._filter_quality_candidates([cand_review], ["crossref"], cit)
    assert filtered == []


def test_rate_limit_backoff_on_primary_sources_prevents_false_hallucination() -> None:
    # Exact pattern from 088 #14, #71 when OpenAlex/DBLP/arXiv were skipped due to rate-limit backoff
    from integrity_checker.pipeline.integrity_pipeline import IntegrityPipeline

    source = SourceResult(
        citation_raw='[14] A. Summerville et al., "The video game level corpus," in Proc. AAAI AIIDE, 2016.',
        candidates=[],
        sources_queried=["crossref", "openalex", "dblp", "arxiv"],
        sources_succeeded=[],
        sources_failed={
            "crossref": "Crossref: no title match (0.69)",
            "openalex": "openalex: skipped (rate-limit backoff active)",
            "dblp": "dblp: skipped (rate-limit backoff active)",
            "arxiv": "arxiv: skipped (rate-limit backoff active)",
        },
    )
    assert IntegrityPipeline._is_source_rate_limit_or_api_exhausted(source) is True


def test_github_online_repo_and_vn_portal_access_date_classified_as_resource() -> None:
    checker = NeuroSymbolicChecker()
    cit_gh = Citation(
        raw_text="[4] Google, Diff Match Patch – Synchronize plain text, [Online]. Available: https://github.com/google/diff-match-patch",
        citation_type=CitationType.REFERENCE_LIST,
        authors=["Google"],
        title="Diff Match Patch – Synchronize plain text, [Online]",
        url="https://github.com/google/diff-match-patch",
    )
    cand_gh = SourceCandidate(
        source_name="tech_standard",
        found=True,
        title="diff-match-patch",
        authors=["google"],
        year="2026",
        venue="GitHub Repository",
        confidence=0.95,
    )
    src_gh = SourceResult(
        citation_raw=cit_gh.raw_text,
        candidates=[cand_gh],
        sources_queried=["tech_standard"],
        sources_succeeded=["tech_standard"],
    )
    v_gh = checker.check(cit_gh, src_gh)
    assert v_gh.label in (ValidationLabel.RESOURCE, ValidationLabel.VERIFIED)

    cit_portal = Citation(
        raw_text="Tiểu sử Chủ tịch Hồ Chí Minh | C. Mác; Ph. Ăngghen; V. I. Lênin; Hồ Chí Minh (dangcongsan.vn)",
        citation_type=CitationType.REFERENCE_LIST,
        title="Tiểu sử Chủ tịch Hồ Chí Minh",
    )
    v_portal = checker.check(cit_portal, SourceResult(citation_raw=cit_portal.raw_text))
    assert v_portal.label == ValidationLabel.RESOURCE

    cit_access = Citation(
        raw_text="[2] Ban biên tập TOPDev, OPENCV là gì? Học Computer Vision không khó! | TopDev, Truy cập ngày 15 tháng 10 năm 2025",
        citation_type=CitationType.REFERENCE_LIST,
        title="OPENCV là gì? Học Computer Vision không khó!",
    )
    v_access = checker.check(cit_access, SourceResult(citation_raw=cit_access.raw_text))
    assert v_access.label == ValidationLabel.RESOURCE


def test_domestic_vn_masters_thesis_rejects_unrelated_search_hit_and_resolves_unresolved() -> None:
    # Exact pattern from 003 #18: domestic VN Luận văn thạc sĩ matched an unrelated 2025 paper
    checker = NeuroSymbolicChecker()
    cit = Citation(
        raw_text=(
            "18. Trần Thị Hồng (2013), Xây dựng hệ thống tiêu chí đánh giá kết quả nghiên cứu khoa học "
            "ngành khoa học xã hội tại trường Đại học Khoa học, Đại học Thái Nguyên, Luận văn thạc sĩ."
        ),
        citation_type=CitationType.REFERENCE_LIST,
        authors=parse_authors("Trần Thị Hồng"),
        year="2013",
        title="Xây dựng hệ thống tiêu chí đánh giá kết quả nghiên cứu khoa học ngành khoa học xã hội tại trường Đại học Khoa học, Đại học Thái Nguyên",
        venue="Luận văn thạc sĩ",
    )
    unrelated_cand = SourceCandidate(
        source_name="crossref",
        found=True,
        title="ĐÁNH GIÁ NĂNG LỰC SỐ CỦA SINH VIÊN KHỐI NGÀNH KHOA HỌC XÃ HỘI VÀ NHÂN VĂN THEO THÔNG TƯ 02/2025/TT-BGDĐT",
        authors=["Trần Thị Hồng", "Nguyễn Thị Lan"],
        year="2025",
        venue="Tạp chí Giáo dục",
        confidence=0.65,
    )
    src = SourceResult(
        citation_raw=cit.raw_text,
        candidates=[unrelated_cand],
        sources_queried=["crossref", "doaj"],
        sources_succeeded=["crossref"],
    )
    verdict = checker.check(cit, src)
    assert verdict.label == ValidationLabel.UNRESOLVED


def test_authorless_yearless_web_url_detected_as_web_resource_without_affecting_ojs_articles() -> None:
    # Exact pattern from 096 #5: authorless, yearless corporate web URL without "Truy cập từ"
    cit_web = Citation(
        raw_text="5. Hội thảo của FPT Software với đối tác tư vấn QAI Global: https://fptsoftware.com/newsroom/event-calendar/cmmi-2-0-automation-in-quality-management",
        citation_type=CitationType.REFERENCE_LIST,
        title="Hội thảo của FPT Software với đối tác tư vấn QAI Global",
        url="https://fptsoftware.com/newsroom/event-calendar/cmmi-2-0-automation-in-quality-management",
    )
    assert RetrievalOrchestrator.is_web_or_legal_resource(cit_web) is True

    # Ensure OJS/scholarly journal URLs (/article/view/) are NOT short-circuited as generic web resources
    cit_ojs = Citation(
        raw_text="Nghiên cứu ứng dụng AI: https://tapchikhoahoc.vn/index.php/journal/article/view/1234",
        citation_type=CitationType.REFERENCE_LIST,
        title="Nghiên cứu ứng dụng AI",
        url="https://tapchikhoahoc.vn/index.php/journal/article/view/1234",
    )
    assert RetrievalOrchestrator.is_web_or_legal_resource(cit_ojs) is False


def test_wayback_global_lock_exists_for_cross_thread_rate_limiting() -> None:
    from integrity_checker.retrieval import link_validator

    assert hasattr(link_validator, "_WAYBACK_GLOBAL_LOCK")
    assert hasattr(link_validator, "_WAYBACK_GLOBAL_LAST_AT")


def test_short_two_word_title_filters_disjoint_author_longer_title_collision() -> None:
    # Exact pattern from 088 #85: "Consistency models" (Song et al. 2023) vs "Database Consistency Models" (Shapiro 2019)
    orch = RetrievalOrchestrator.__new__(RetrievalOrchestrator)
    cit = Citation(
        raw_text='[85] Y. Song, P. Dhariwal, M. Chen, and I. Sutskever, "Consistency models," in Proc. Int. Conf. Mach. Learn., vol. 202, pp. 32211–32252, 2023.',
        citation_type=CitationType.REFERENCE_LIST,
        authors=["Y. Song", "P. Dhariwal", "M. Chen", "I. Sutskever"],
        title="Consistency models",
        year="2023",
    )
    cand_collision = SourceCandidate(
        source_name="openaire_hal",
        found=True,
        title="Database Consistency Models",
        authors=["Marc Shapiro", "Pierre Sutra"],
        year="2019",
        confidence=0.80,
    )
    filtered, _ = orch._filter_quality_candidates([cand_collision], ["openaire_hal"], cit)
    assert filtered == []


def test_venue_normalizer_matches_conference_initialism_fdg() -> None:
    from integrity_checker.matching.venue_normalizer import VenueNormalizer

    vn = VenueNormalizer()
    sim = vn.similarity(
        "in Proceedings of the 16th International Conference on the Foundations of Digital Games",
        "FDG",
    )
    assert sim >= 0.85


def test_local_db_fuzzy_search_scopes_fts_to_title_and_orders_shortest_title_first(tmp_path) -> None:
    from integrity_checker.database.local_db import LocalDatabase, Paper

    db = LocalDatabase(str(tmp_path / "test_papers.db"))
    # Insert 60 distractors whose abstracts mention "consistency" and "models" before the target paper
    for i in range(60):
        db.add_paper(
            Paper(
                title=f"Unrelated Speech Recognition Paper Number {i}",
                authors=["Xia Song"],
                year=2023,
                abstract="We evaluate consistency and models in speech recognition.",
            )
        )
    target_id = db.add_paper(
        Paper(
            title="Consistency Models",
            authors=["Yang Song", "Prafulla Dhariwal", "Mark Chen", "Ilya Sutskever"],
            year=2023,
            doi="10.48550/arxiv.2303.01469",
            abstract="Diffusion models have significantly advanced image generation.",
        )
    )
    results = db.fuzzy_search(title="Consistency models", authors=["song"], year=2023, limit=5)
    assert len(results) == 1
    assert results[0].id == target_id
    assert results[0].title == "Consistency Models"




