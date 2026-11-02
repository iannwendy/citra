"""End-to-end unit tests for TDTU bibliography segmentation, sub-headers, inline splitting, and §2.6.3 compliance."""

import pytest

from integrity_checker.extraction.base import Document, Page
from integrity_checker.extraction.citation_extractor import CitationExtractor
from integrity_checker.extraction.reference_parser import (
    ReferenceListParser,
    check_tdtu_bibliography_compliance,
    vn_alphabetical_sort_key,
)
from integrity_checker.extraction.section_segmenter import SectionSegmenter, SectionType
from integrity_checker.linking.citation_linker import CitationLinker
from integrity_checker.linking.statuses import CitationMappingStatus

TDTU_MUC_2_6_3_INLINE = """DANH MỤC TÀI LIỆU THAM KHẢO
A. Văn bản quy phạm pháp luật
1. Hiến pháp 2013. 2. Luật Doanh nghiệp (Luật số 68/2014/QH13) ngày 26/12/2014. 3. Nghị định số 23/2015/NĐ-CP của Chính phủ ngày 16/02/2015 về cấp bản sao từ sổ gốc, chứng thực bản sao từ bản chính, chứng thực chữ ký và chứng thực hợp đồng, giao dịch.
B. Tài liệu tham khảo
Tiếng Việt
Bộ nông nghiệp & PTNT (1996). Báo cáo tổng kết 5 năm (1992 – 1996) phát triển lúa lai. Hà Nội: NXB Nông nghiệp. Đức, Đ. M. (2016). Một số đánh giá bước đầu về đầu tư của doanh nghiệp Việt Nam ra nước ngoài giai đoạn 2005 – 2015. Nghiên cứu Kinh tế, 456(5), 39-47. Tô, T. (2015). Bàn về chính sách tiền tệ năm 2015. Truy cập 21/7/2016, từ http://kinhtevadubao.vn/chi-tiet/101-3591-ban-ve-chinh-sach-tien-te-nam-2015.html Trâm, N. T. B., & Phượng, N. T. K. (2017). Phản ứng của giá cổ phiếu với thông tin trả cổ tức bằng tiền mặt tại Sở Giao dịch Chứng khoán Thành phố Hồ Chí Minh. Tạp chí Khoa học Đại học Mở Thành phố Hồ Chí Minh, 126(5D), 79–94. Trí, N. C. (2011). Nâng cao năng lực cạnh tranh của các doanh nghiệp du lịch thành phố Hồ Chí Minh đến năm 2020 (Luận án Tiến sĩ kinh tế), Trường Đại học Kinh tế Tp. HCM, Việt Nam.
Tiếng Anh
Aron, L., Botella, M., & Lubart, T. (2019). Culinary arts: Talent and their development. In R. F. Subotnik, P. Olszewski-Kubilius, & F. C. Worrell (Eds.), The psychology of high performance: Developing human potential into domain-specific talent (pp. 345–359). American Psychological Association. Bartlett, R. P. (2009). Going private but staying public: Reexamining the effect of Sarbanes-Oxley on firms’ going-private decisions. The University of Chicago Law Review, 76(1), 7-44. Bergmann, S. (1993). Ecological theology. In J. H.aire (Ed.), Proceedings of the Revitalising dynamism Growth Seminar (pp. 29-43). Melbourne: Joint Board of Education. Department of Finance and Administration (2006). Delivering Australian Government services: Managing multiple channels. Canberra: Author. Kotler, P., & Lee, N. (2009). Up and out of poverty: The social marketing solution. New Jersey: Pearson Education, Inc. May, B. (2007). A survey of radial velocities in the zodiacal dust cloud (Doctoral dissertation). University of Bristol, Bristol, UK. Reserve Bank of Australia. (2007). Statements on monetary policy. Retrieved March 21, 2011, from http://www.rba.gov.au/ PublicationsAndResearch/StatementsOnMonetaryPolicy/index.html
"""

TDTU_MUC_2_6_3_MULTILINE = """DANH MỤC TÀI LIỆU THAM KHẢO
A. Văn bản quy phạm pháp luật
1. Hiến pháp 2013.
2. Luật Doanh nghiệp (Luật số 68/2014/QH13) ngày 26/12/2014.
3. Nghị định số 23/2015/NĐ-CP của Chính phủ ngày 16/02/2015 về cấp bản sao từ sổ gốc, chứng thực bản sao từ bản chính, chứng thực chữ ký và chứng thực hợp đồng, giao dịch.
B. Tài liệu tham khảo
Tiếng Việt
Bộ nông nghiệp & PTNT (1996). Báo cáo tổng kết 5 năm (1992 – 1996) phát triển lúa lai. Hà Nội: NXB Nông nghiệp.
Đức, Đ. M. (2016). Một số đánh giá bước đầu về đầu tư của doanh nghiệp Việt Nam ra nước ngoài giai đoạn 2005 – 2015. Nghiên cứu Kinh tế, 456(5), 39-47.
Tô, T. (2015). Bàn về chính sách tiền tệ năm 2015. Truy cập 21/7/2016, từ http://kinhtevadubao.vn/chi-tiet/101-3591-ban-ve-chinh-sach-tien-te-nam-2015.html
Trâm, N. T. B., & Phượng, N. T. K. (2017). Phản ứng của giá cổ phiếu với thông tin trả cổ tức bằng tiền mặt tại Sở Giao dịch Chứng khoán Thành phố Hồ Chí Minh. Tạp chí Khoa học Đại học Mở Thành phố Hồ Chí Minh, 126(5D), 79–94.
Trí, N. C. (2011). Nâng cao năng lực cạnh tranh của các doanh nghiệp du lịch thành phố Hồ Chí Minh đến năm 2020 (Luận án Tiến sĩ kinh tế), Trường Đại học Kinh tế Tp. HCM, Việt Nam.
Tiếng Anh
Aron, L., Botella, M., & Lubart, T. (2019). Culinary arts: Talent and their development. In R. F. Subotnik, P. Olszewski-Kubilius, & F. C. Worrell (Eds.), The psychology of high performance: Developing human potential into domain-specific talent (pp. 345–359). American Psychological Association.
Bartlett, R. P. (2009). Going private but staying public: Reexamining the effect of Sarbanes-Oxley on firms’ going-private decisions. The University of Chicago Law Review, 76(1), 7-44.
Bergmann, S. (1993). Ecological theology. In J. H.aire (Ed.), Proceedings of the Revitalising dynamism Growth Seminar (pp. 29-43). Melbourne: Joint Board of Education.
Department of Finance and Administration (2006). Delivering Australian Government services: Managing multiple channels. Canberra: Author.
Kotler, P., & Lee, N. (2009). Up and out of poverty: The social marketing solution. New Jersey: Pearson Education, Inc.
May, B. (2007). A survey of radial velocities in the zodiacal dust cloud (Doctoral dissertation). University of Bristol, Bristol, UK.
Reserve Bank of Australia. (2007). Statements on monetary policy. Retrieved March 21, 2011, from http://www.rba.gov.au/ PublicationsAndResearch/StatementsOnMonetaryPolicy/index.html
"""


class TestTDTUBibliographySegmentationAndParsing:
    """Tests for DANH MỤC TÀI LIỆU THAM KHẢO detection, sub-header stripping, and 15-entry parsing."""

    def test_section_segmenter_recognizes_danh_muc_tai_lieu_tham_khao(self) -> None:
        doc = Document(
            file_path="tdtu_thesis.pdf",
            num_pages=2,
            pages=[
                Page(page_num=1, text="CHƯƠNG 1: GIỚI THIỆU\nNội dung chương 1 (Đức, 2016)."),
                Page(page_num=2, text=TDTU_MUC_2_6_3_MULTILINE),
            ],
        )
        segmenter = SectionSegmenter()
        sections = segmenter.segment(doc)
        bib_sections = [s for s in sections if s.section_type == SectionType.BIBLIOGRAPHY]
        assert len(bib_sections) == 1
        assert bib_sections[0].start_page == 2

    @pytest.mark.parametrize("ref_block", [TDTU_MUC_2_6_3_INLINE, TDTU_MUC_2_6_3_MULTILINE])
    def test_parse_all_15_entries_from_muc_2_6_3(self, ref_block: str) -> None:
        doc = Document(
            file_path="tdtu_thesis.pdf",
            num_pages=2,
            pages=[
                Page(page_num=1, text="Nội dung bài viết có trích dẫn (Đức, 2016)."),
                Page(page_num=2, text=ref_block),
            ],
        )
        parser = ReferenceListParser()
        citations = parser.parse_reference_section(doc)

        assert len(citations) == 15

        years = [c.year for c in citations]
        assert years == [
            "2013", "2014", "2015",
            "1996", "2016", "2015", "2017", "2011",
            "2019", "2009", "1993", "2006", "2009", "2007", "2007",
        ]

        # Check sub-headers did not pollute first entries of each block
        assert citations[0].title == "Hiến pháp 2013"
        assert citations[3].authors[0].last_name == "bộ nông nghiệp & ptnt"
        assert citations[8].authors[0].last_name == "aron"


class TestTDTUBibliographyCompliance:
    """Tests for TDTU §2.6 language grouping, legal hierarchy, and Vietnamese ABC sorting."""

    def test_vietnamese_alphabetical_sort_key_order(self) -> None:
        names = ["Trí", "Đức", "Bộ nông nghiệp & PTNT", "Trâm", "Tô"]
        sorted_names = sorted(names, key=vn_alphabetical_sort_key)
        assert sorted_names == ["Bộ nông nghiệp & PTNT", "Đức", "Tô", "Trâm", "Trí"]

    def test_muc_2_6_3_sample_is_fully_compliant(self) -> None:
        doc = Document(
            file_path="tdtu_thesis.pdf",
            num_pages=1,
            pages=[Page(page_num=1, text=TDTU_MUC_2_6_3_MULTILINE)],
        )
        parser = ReferenceListParser()
        citations = parser.parse_reference_section(doc)
        assert len(citations) == 15

        res = check_tdtu_bibliography_compliance(citations)
        assert res.is_compliant is True
        assert res.violations == []
        assert res.groups == ["legal"] * 3 + ["vi"] * 5 + ["foreign"] * 7

    def test_detects_vietnamese_alphabetical_violation(self) -> None:
        doc = Document(
            file_path="tdtu_thesis.pdf",
            num_pages=1,
            pages=[Page(page_num=1, text=TDTU_MUC_2_6_3_MULTILINE)],
        )
        parser = ReferenceListParser()
        citations = parser.parse_reference_section(doc)
        # Swap Đức (index 4) and Trí (index 7)
        citations[4], citations[7] = citations[7], citations[4]

        res = check_tdtu_bibliography_compliance(citations)
        assert res.is_compliant is False
        assert any("Alphabetical order violation in 'vi'" in v for v in res.violations)

    def test_detects_interleaved_language_groups(self) -> None:
        doc = Document(
            file_path="tdtu_thesis.pdf",
            num_pages=1,
            pages=[Page(page_num=1, text=TDTU_MUC_2_6_3_MULTILINE)],
        )
        parser = ReferenceListParser()
        citations = parser.parse_reference_section(doc)
        # Move an English entry into the middle of the Vietnamese section
        en_entry = citations.pop(10)
        citations.insert(5, en_entry)

        res = check_tdtu_bibliography_compliance(citations)
        assert res.is_compliant is False
        assert any("interleaved" in v for v in res.violations)

    def test_detects_legal_hierarchy_violation(self) -> None:
        doc = Document(
            file_path="tdtu_thesis.pdf",
            num_pages=1,
            pages=[Page(page_num=1, text=TDTU_MUC_2_6_3_MULTILINE)],
        )
        parser = ReferenceListParser()
        citations = parser.parse_reference_section(doc)
        # Put Nghị định (index 2) before Hiến pháp (index 0)
        citations[0], citations[2] = citations[2], citations[0]

        res = check_tdtu_bibliography_compliance(citations)
        assert res.is_compliant is False
        assert any("Legal hierarchy violation" in v for v in res.violations)

    def test_end_to_end_linking_all_15_muc_2_6_3_references(self) -> None:
        body_text = (
            "Căn cứ theo (Hiến pháp, 2013), Luật Doanh nghiệp (2014) và "
            "(Nghị định số 23/2015/NĐ-CP, 2015), hành lang pháp lý đã hoàn thiện. "
            "Báo cáo của Bộ nông nghiệp & PTNT (1996) cùng nghiên cứu của Đức (2016), "
            "Tô (2015), (Trâm và Phượng, 2017) và Trí (2011) đã phân tích bối cảnh trong nước. "
            "Trên thế giới, (Aron và cộng sự, 2019), Bartlett (2009), (Bergmann, 1993), "
            "Department of Finance and Administration (2006), (Kotler & Lee, 2009), "
            "May (2007) và (Reserve Bank of Australia, 2007) đều khẳng định kết quả này."
        )
        doc = Document(
            file_path="tdtu_full.pdf",
            num_pages=2,
            pages=[
                Page(page_num=1, text=body_text),
                Page(page_num=2, text=TDTU_MUC_2_6_3_INLINE),
            ],
        )
        extractor = CitationExtractor(preserve_occurrences=True)
        parser = ReferenceListParser(extractor=extractor)
        linker = CitationLinker()

        in_text = extractor.extract_from_document(doc)
        bibs = parser.parse_reference_section(doc)

        assert len(bibs) == 15
        assert len(in_text) == 15

        report = linker.link(in_text, bibs)
        matched = [lnk for lnk in report.links if lnk.status == CitationMappingStatus.MATCHED]
        assert len(matched) == 15
        assert len(report.unmatched_in_text) == 0
        assert len(report.unmatched_reference_ids) == 0
