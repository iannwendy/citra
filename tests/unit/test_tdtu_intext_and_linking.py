"""Comprehensive unit tests for TDTU in-text citation extraction and linking (Mục 2.5)."""

from __future__ import annotations

import pytest

from integrity_checker.extraction.base import Document, Page
from integrity_checker.extraction.citation_extractor import CitationExtractor
from integrity_checker.extraction.patterns import get_format
from integrity_checker.extraction.reference_parser import ReferenceListParser
from integrity_checker.linking.citation_linker import CitationLinker
from integrity_checker.linking.statuses import CitationMappingStatus
from integrity_checker.models.citation import Citation, CitationType
from integrity_checker.models.validation import MappingMethod


def _doc(text: str) -> Document:
    return Document(
        file_path="tdtu_test.pdf",
        num_pages=1,
        pages=[Page(page_num=1, text=text, has_text_layer=True)],
        parser_used="test",
    )


class TestTDTUInTextExtraction:
    """Test extraction of all in-text citation formats from TDTU guideline §2.5."""

    def test_single_author_narrative_and_parenthetical(self) -> None:
        ext = CitationExtractor(preserve_occurrences=True)
        text = (
            "Tran (2016) cho thấy trong những năm gần đây sự tiến bộ vượt bậc "
            "của khoa học kỹ thuật đã định hình lại phương thức vận hành của "
            "các doanh nghiệp (Tran, 2016). Một ví dụ khác là (Smith, 2010)."
        )
        cits = ext.extract_from_document(_doc(text))
        raws = [c.raw_text for c in cits]
        assert "Tran (2016)" in raws
        assert "(Tran, 2016)" in raws
        assert "(Smith, 2010)" in raws

    def test_vietnamese_diacritics_single_author(self) -> None:
        ext = CitationExtractor(preserve_occurrences=True)
        text = (
            "Theo Đặng (2020), kết quả phân tích của Nguyễn (2021) và "
            "(Đặng, 2020) cùng (Hương, 2017) và (Mỹ, 2007) rất nhất quán."
        )
        cits = ext.extract_from_document(_doc(text))
        raws = [c.raw_text for c in cits]
        assert "Đặng (2020)" in raws
        assert "Nguyễn (2021)" in raws
        assert "(Đặng, 2020)" in raws
        assert "(Hương, 2017)" in raws
        assert "(Mỹ, 2007)" in raws

    def test_two_authors_vietnamese_va_and_ampersand(self) -> None:
        ext = CitationExtractor(preserve_occurrences=True)
        text = (
            "Zhang và Hanks (2018) cho biết chủ nghĩa thế giới thể hiện mức độ "
            "tiếp thu và chấp nhận sự khác biệt (Zhang và Hanks, 2018). "
            "Tương tự, Hương và Quân (2017) cũng như (Hương và Quân, 2017) "
            "và Carr & Kemmis (1986) hoặc (Carr & Kemmis, 1986) đều đồng tình."
        )
        cits = ext.extract_from_document(_doc(text))
        raws = [c.raw_text for c in cits]
        assert "Zhang và Hanks (2018)" in raws
        assert "(Zhang và Hanks, 2018)" in raws
        assert "Hương và Quân (2017)" in raws
        assert "(Hương và Quân, 2017)" in raws
        assert "Carr & Kemmis (1986)" in raws
        assert "(Carr & Kemmis, 1986)" in raws

    def test_three_or_more_authors_va_cong_su(self) -> None:
        ext = CitationExtractor(preserve_occurrences=True)
        text = (
            "Tran và cộng sự (2019) cũng nêu bật tính chiến lược của ĐGTT "
            "trong việc thúc đẩy ý định tiếp tục của khách hàng (Tran và cộng sự, 2019). "
            "Ngoài ra, Đặng và cs. (2021) cùng (Đặng và cs., 2021) đã kiểm chứng."
        )
        cits = ext.extract_from_document(_doc(text))
        raws = [c.raw_text for c in cits]
        assert "Tran và cộng sự (2019)" in raws
        assert "(Tran và cộng sự, 2019)" in raws
        assert "Đặng và cs. (2021)" in raws
        assert "(Đặng và cs., 2021)" in raws

    def test_multi_source_semicolon_parenthetical(self) -> None:
        ext = CitationExtractor(preserve_occurrences=True)
        text = "Nhiều nghiên cứu trước đây (Richards, 1997; Duddle, 2009; Simon, Smith & West, 2009) đã chỉ ra."
        cits = ext.extract_from_document(_doc(text))
        assert len(cits) == 1
        assert cits[0].raw_text == "(Richards, 1997; Duddle, 2009; Simon, Smith & West, 2009)"

    def test_corporate_and_secondary_and_page_citations(self) -> None:
        ext = CitationExtractor(preserve_occurrences=True)
        text = (
            "Theo Bộ nông nghiệp & PTNT (1996) và (Bộ nông nghiệp & PTNT, 1996), "
            "cũng như Department of Finance and Administration (2006) hoặc "
            "(Department of Finance and Administration, 2006). "
            "Một số quan điểm (Nguyen, 1990, dẫn theo Tran, 2016) và "
            "Nguyen (1990, dẫn theo Tran, 2016) ở (Smith, 2010, tr. 15)."
        )
        cits = ext.extract_from_document(_doc(text))
        raws = [c.raw_text for c in cits]
        assert "Bộ nông nghiệp & PTNT (1996)" in raws
        assert "(Bộ nông nghiệp & PTNT, 1996)" in raws
        assert "Department of Finance and Administration (2006)" in raws
        assert "(Department of Finance and Administration, 2006)" in raws
        assert "(Nguyen, 1990, dẫn theo Tran, 2016)" in raws
        assert "Nguyen (1990, dẫn theo Tran, 2016)" in raws
        assert "(Smith, 2010, tr. 15)" in raws

    def test_apa_is_valid_citation_with_vietnamese(self) -> None:
        apa = get_format("APA")
        assert apa is not None
        assert apa.is_valid_citation("Tran và cộng sự (2019)") is True
        assert apa.is_valid_citation("(Tran và cộng sự, 2019)") is True
        assert apa.is_valid_citation("Đặng và Quân (2020)") is True
        assert apa.is_valid_citation("(Đặng, 2020)") is True


class TestTDTUCitationLinking:
    """Test CitationLinker with all TDTU §2.5 in-text variants."""

    @pytest.fixture()
    def tdtu_bibs(self) -> list[Citation]:
        ref_parser = ReferenceListParser()
        raw_entries = [
            "Bộ nông nghiệp & PTNT (1996). Báo cáo tổng kết 5 năm (1992-1996) phát triển lúa lai. Hà Nội, Việt Nam.",
            "Hương, N. T. L., & Quân, T. T. (2017). Nhận thức của du khách về hình ảnh điểm đến du lịch Huế. Tạp chí Khoa học Đại học Huế: Kinh tế và Phát triển, 126(5D), 79–94. DOI: 10.26459/hueuni-jed.v126i5D.4555.",
            "Carr, W., & Kemmis, S. (1986). Becoming critical: Education knowledge and action research. London, United Kingdom: Falmer Press.",
            "Department of Finance and Administration. (2006). Delivering Australian Government services: Managing multiple channels. Canberra, Australia: Author.",
            "Simon, J., Smith, K., & West, T. (2009). Price incentives and consumer payment behaviour. Retrieved March 21, 2011, from http://www.rba.gov.au/RDP2009-04.html",
            "Smith, R. (2010). Rethinking teacher education: Teacher education in the knowledge age. Sydney, Australia: AACLM Press.",
            "Richards, K. C. (1997). Views on globalization. In H. L. Vivaldi (Ed.), Australia in a global world (pp. 29-43). Sydney, Australia: Century.",
            "Duddle, M. (2009). Intraprofessional relations in nursing: A case study (Unpublished doctoral thesis). University of Sydney, Australia.",
            "Zhang, L., & Hanks, L. (2018). Cosmopolitanism and cultural competence. Journal of Hospitality, 12(3), 10-25.",
            "Tran, V. D., Nguyen, T. H., & Le, M. T. (2019). Strategic value of online reviews. Journal of Marketing, 45(2), 100-115.",
        ]
        bibs: list[Citation] = []
        for idx, line in enumerate(raw_entries, start=1):
            c = ref_parser._parse_entry(line, order_index=idx, page_num=10)
            assert c is not None, f"Failed to parse bib line: {line}"
            c.reference_id = f"ref-{idx:04d}"
            bibs.append(c)
        return bibs

    @pytest.mark.parametrize(
        ("in_text_raw", "expected_ref_ids"),
        [
            ("(Smith, 2010)", ["ref-0006"]),
            ("Smith (2010)", ["ref-0006"]),
            ("(Smith, 2010, tr. 15)", ["ref-0006"]),
            ("Zhang và Hanks (2018)", ["ref-0009"]),
            ("(Zhang và Hanks, 2018)", ["ref-0009"]),
            ("Hương và Quân (2017)", ["ref-0002"]),
            ("(Hương và Quân, 2017)", ["ref-0002"]),
            ("Carr & Kemmis (1986)", ["ref-0003"]),
            ("(Carr & Kemmis, 1986)", ["ref-0003"]),
            ("Tran và cộng sự (2019)", ["ref-0010"]),
            ("(Tran và cộng sự, 2019)", ["ref-0010"]),
            ("(Tran và cs., 2019)", ["ref-0010"]),
            ("Simon và cộng sự (2009)", ["ref-0005"]),
            ("(Simon, Smith & West, 2009)", ["ref-0005"]),
            (
                "(Richards, 1997; Duddle, 2009; Simon, Smith & West, 2009)",
                ["ref-0007", "ref-0008", "ref-0005"],
            ),
            ("(Bộ nông nghiệp & PTNT, 1996)", ["ref-0001"]),
            ("Bộ nông nghiệp & PTNT (1996)", ["ref-0001"]),
            ("(Department of Finance and Administration, 2006)", ["ref-0004"]),
            ("Department of Finance and Administration (2006)", ["ref-0004"]),
            ("(Brown, 1999, dẫn theo Smith, 2010)", ["ref-0006"]),
            ("Brown (1999, dẫn theo Tran và cộng sự, 2019)", ["ref-0010"]),
            ("(Brown, 1999, as cited in Zhang & Hanks, 2018)", ["ref-0009"]),
        ],
    )
    def test_tdtu_in_text_links_to_expected_bib(
        self,
        tdtu_bibs: list[Citation],
        in_text_raw: str,
        expected_ref_ids: list[str],
    ) -> None:
        linker = CitationLinker()
        body = [
            Citation(
                raw_text=in_text_raw,
                citation_type=CitationType.IN_TEXT,
                reference_id="occ-0001",
            )
        ]
        result = linker.link(body, tdtu_bibs)
        assert len(result.links) == len(expected_ref_ids)
        assert [l.reference_id for l in result.links] == expected_ref_ids
        assert all(l.status == CitationMappingStatus.MATCHED for l in result.links)
        assert all(l.method == MappingMethod.AUTHOR_YEAR for l in result.links)


class TestTDTUGithubReportsBugRegressions:
    """Regression tests for BUG-1 through BUG-6 discovered on 75 TDTU GitHub reports."""

    def test_bug1_uncited_references_marked_when_body_citations_empty(self) -> None:
        ref_parser = ReferenceListParser()
        ref = ref_parser._parse_entry(
            "[1] Vaswani, A., et al. (2017). Attention is all you need. NeurIPS.",
            order_index=1,
            page_num=5,
        )
        assert ref is not None
        ref.reference_id = "ref-0001"
        linker = CitationLinker()
        res = linker.link([], [ref])
        assert ref.mapping_status == CitationMappingStatus.UNCITED_REFERENCE.value
        assert res.unmatched_reference_ids == ["ref-0001"]

    def test_bug2_and_bug3_no_false_footnote_or_superscript_in_tdtu_tech_report(self) -> None:
        from integrity_checker.extraction.document_parser import DocumentParser

        dp = DocumentParser()
        doc = Document(
            file_path="tdtu_report.pdf",
            num_pages=2,
            pages=[
                Page(
                    page_num=1,
                    text=(
                        "ĐẠI HỌC TÔN ĐỨC THẮNG\nKHOA CÔNG NGHỆ THÔNG TIN\n"
                        "BÁO CÁO CUỐI KỲ\nSinh viên thực hiện: Nguyen Van A - MSSV: 52100001\n"
                        "Mô hình Qwen3 và YOLOv3 kết hợp SPEA2 trên Router1, Switch2, backend1, worker2.\n"
                        "Dữ liệu Glucose3 được xử lý bằng Google Colab và thư viện Underthesea."
                    ),
                    has_text_layer=True,
                ),
                Page(
                    page_num=2,
                    text=(
                        "TÀI LIỆU THAM KHẢO\n"
                        "1. Google. (2023). Google Colab Documentation. https://colab.research.google.com\n"
                        "2. Nguyen, K. V. (2018). Vietnamese NLP corpus. ACL.\n"
                        "3. Underthesea NLP Team. (2022). Underthesea toolkit. https://github.com/undertheseanlp\n"
                    ),
                    has_text_layer=True,
                ),
            ],
            parser_used="test",
        )
        parsed = dp._merge(doc, None)
        assert len(parsed.references) == 3
        assert parsed.body_citations == []

    def test_bug4_code_arrays_math_intervals_and_discourse_prefix(self) -> None:
        ext = CitationExtractor(preserve_occurrences=True)
        text = (
            "Ta có X.shape[1] và axs[1].plot() cùng parts[1].trim() và byte[4096], int[100].\n"
            "Mảng a[1], a[2], ..., a[i] nhận giá trị nhị phân [1, 0] hoặc [1, 0, 1] và ma trận [1 2].\n"
            "Miền giá trị thuộc khoảng [1,5] và đầu ra có kích thước [1, 5, 64] với màu [10, 255, 255].\n"
            "Cấu hình mạng (VLAN 10), mô hình (LLaMA 1, 2, 3), bước (Optimization 1) và tập (Itemset X).\n"
            "Cụ thể, Reimers và Gurevych (2019) đã đề xuất mô hình Sentence-BERT."
        )
        cits = ext.extract_from_document(_doc(text))
        raws = [c.raw_text for c in cits]
        assert raws == ["Reimers và Gurevych (2019)"]

    def test_bug5_section_segmenter_self_evaluation_and_tham_khao_and_phuluc(self) -> None:
        from integrity_checker.extraction.section_segmenter import SectionSegmenter, SectionType

        seg = SectionSegmenter()
        doc = Document(
            file_path="tdtu_rubric.pdf",
            num_pages=3,
            pages=[
                Page(page_num=1, text="1. Giới thiệu\nNội dung báo cáo đồ án môn học.", has_text_layer=True),
                Page(
                    page_num=2,
                    text=(
                        "THAM KHẢO:\n"
                        "[1] https://viblo.asia/p/tim-hieu-ve-bert-12345\n"
                        "[2] https://geeksforgeeks.org/machine-learning\n"
                        "PHỤLỤC\n"
                        "Bảng cấu hình chi tiết."
                    ),
                    has_text_layer=True,
                ),
                Page(
                    page_num=3,
                    text=(
                        "SELF-EVALUATION\n"
                        "Criteria | Content | Achievement\n"
                        "References\n"
                        "None\n"
                        "60%"
                    ),
                    has_text_layer=True,
                ),
            ],
            parser_used="test",
        )
        sections = seg.segment(doc)
        sec_types = [s.section_type for s in sections]
        assert SectionType.BIBLIOGRAPHY in sec_types
        assert SectionType.APPENDIX in sec_types
        bib_sec = next(s for s in sections if s.section_type == SectionType.BIBLIOGRAPHY)
        assert "viblo.asia" in bib_sec.text
        assert "SELF-EVALUATION" not in bib_sec.text

    def test_bug6_reference_parser_oxford_comma_ieee_and_informal_tdtu_refs(self) -> None:
        ref_parser = ReferenceListParser()
        # IEEE unquoted book with Oxford comma before 'and'
        ieee_book = ref_parser._parse_entry(
            "[3] J. Han, M. Kamber, and J. Pei, Data Mining: Concepts and Techniques, 3rd ed., Morgan Kaufmann, 2012.",
            order_index=3,
            page_num=10,
        )
        assert ieee_book is not None
        assert ieee_book.title == "Data Mining: Concepts and Techniques"
        assert ieee_book.year == "2012"

        # 2-digit numbered reference should not extract '10' as author last_name
        vanc_10 = ref_parser._parse_entry(
            "10. Documentation for Scikit-learn machine learning library in Python. 2023.",
            order_index=10,
            page_num=10,
        )
        assert vanc_10 is not None
        assert vanc_10.numeric_index == 10
        assert not any(getattr(a, "last_name", "") == "10" for a in (vanc_10.authors or []))

        # Informal TDTU bibliography with "Title" bởi Author and bare URLs
        bib_text = (
            'TÀI LIỆU THAM KHẢO\n'
            '“Học sâu cho xử lý ngôn ngữ tự nhiên” bởi Nguyễn Văn A ● Ngày xuất bản: 2023\n'
            '“Phân loại văn bản tiếng Việt với PhoBERT” bởi Trần Thị B ● Ngày xuất bản: 2022\n'
        )
        cits = ref_parser.parse_reference_section(_doc(bib_text))
        assert len(cits) == 2
        assert cits[0].title == "Học sâu cho xử lý ngôn ngữ tự nhiên"
        assert cits[0].year == "2023"
        assert cits[1].title == "Phân loại văn bản tiếng Việt với PhoBERT"
        assert cits[1].year == "2022"

