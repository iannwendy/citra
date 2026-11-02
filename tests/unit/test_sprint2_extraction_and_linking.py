"""Unit tests for Sprint 2 (P1): Extraction, Reference Parsing, Citation Linking,
Semantic Bilingual Bridge, and LocalDatabase Query Cache optimizations.
"""

from __future__ import annotations

from pathlib import Path

from integrity_checker.database.local_db import _QUERY_CACHE, LocalDatabase
from integrity_checker.database.models import Paper
from integrity_checker.extraction.base import Document, Page
from integrity_checker.extraction.reference_parser import ReferenceListParser
from integrity_checker.extraction.section_segmenter import SectionSegmenter, SectionType
from integrity_checker.linking.citation_linker import CitationLinker
from integrity_checker.linking.statuses import CitationMappingStatus
from integrity_checker.matching.semantic import SemanticMatcher
from integrity_checker.models.citation import Citation, CitationStyle, CitationType


def _doc_from_bib(bib_text: str) -> Document:
    return Document(
        file_path="test_bib.pdf",
        num_pages=1,
        pages=[Page(page_num=1, text=bib_text)],
        metadata={},
    )


class TestSectionSegmenterSprint2:
    """Verify Table 'Reference' column false-positive guard & late-page preference."""

    def test_ignores_singular_reference_header_inside_table_and_picks_late_bib(self) -> None:
        pages = [
            Page(
                page_num=1,
                text="Title of Study\nAbstract: We analyze chemical properties.\n1. Introduction\nText here.",
            ),
            Page(
                page_num=2,
                text=(
                    "Table 1. Summary of catalyst performance across literature\n"
                    "Catalyst\n"
                    "Yield (%)\n"
                    "Reference\n"
                    "Pd/C 95% [1]\n"
                    "Pt/C 88% [2]\n"
                    "2. Experimental Section\n"
                    "More body text on page 2 with citations [1, 2]."
                ),
            ),
            Page(
                page_num=3,
                text="3. Results and Discussion\nDetailed discussion [1-3].",
            ),
            Page(
                page_num=4,
                text="4. Conclusion\nSummary of findings.",
            ),
            Page(
                page_num=5,
                text=(
                    "References\n"
                    "1. Smith, J.; Doe, A. J. J. Am. Chem. Soc. 2020, 142, 100-110.\n"
                    "2. Johnson, M. Org. Lett. 2021, 23, 500-505.\n"
                    "3. Lee, K. Chem. Rev. 2019, 119, 1000-1050."
                ),
            ),
        ]
        doc = Document(
            file_path="synthetic_acs.pdf",
            num_pages=5,
            pages=pages,
            metadata={},
        )
        segmenter = SectionSegmenter()
        sections = segmenter.segment(doc)
        bib_sections = [s for s in sections if s.section_type == SectionType.BIBLIOGRAPHY]
        body_sections = [s for s in sections if s.section_type == SectionType.BODY]
        assert len(bib_sections) == 1
        assert bib_sections[0].start_page == 5
        assert "1. Smith, J." in bib_sections[0].text
        assert "2. Experimental Section" in body_sections[0].text


class TestReferenceListParserSprint2:
    """Verify ACS no-space dot numbers, CSE comma-less & dot-year, Slavic keys, and omitted 3-em dash."""

    def test_acs_dot_numbered_without_space_up_to_triple_digits(self) -> None:
        lines = ["References"]
        for i in range(1, 10):
            lines.append(
                f"{i}. Anastas, P. T.; Warner, J. C. Green Chemistry Vol {i}. J. Am. Chem. Soc. {2000 + i}, {120 + i}, 100-110."
            )
        lines.append(
            "10.Hungerbühler, K.; Ranke, J. Chemical safety assessment. Environ. Sci. Technol. 2015, 39, 100-110."
        )
        lines.append(
            "11.Smith, A. B.; Jones, C. D. Total synthesis of complex alkaloids. J. Am. Chem. Soc. 2022, 144, 999-1010."
        )
        bib_text = "\n".join(lines)
        parser = ReferenceListParser()
        refs = parser.parse_reference_section(_doc_from_bib(bib_text))
        by_num = {r.numeric_index: r for r in refs}
        assert 1 in by_num
        assert 10 in by_num
        assert 11 in by_num
        assert any("Hungerbühler" in getattr(a, "raw", str(a)) for a in by_num[10].authors)
        assert by_num[10].year == "2015"
        assert any("Smith" in getattr(a, "raw", str(a)) for a in by_num[11].authors)
        assert by_num[11].year == "2022"

    def test_cse_commaless_author_year_inline_splitting(self) -> None:
        bib_text = (
            "References\n"
            "Ackerman JD (1981) Pollination biology of Calypso bulbosa. Amer J Bot 68:100-110. "
            "Nilsson LA (1992) Orchid pollination biology. Trends Ecol Evol 7:255-259. "
            "Dressler RL (1993) Phylogeny and classification of the orchid family. Cambridge University Press."
        )
        parser = ReferenceListParser()
        refs = parser.parse_reference_section(_doc_from_bib(bib_text))
        assert len(refs) == 3
        assert any("Ackerman" in getattr(a, "raw", str(a)) for a in refs[0].authors)
        assert any("Nilsson" in getattr(a, "raw", str(a)) for a in refs[1].authors)
        assert any("Dressler" in getattr(a, "raw", str(a)) for a in refs[2].authors)
        assert [r.year for r in refs] == ["1981", "1992", "1993"]

    def test_chicago_and_cse_dot_year_inline_splitting(self) -> None:
        bib_text = (
            "Literature Cited\n"
            "Ackerly, D. D., and W. K. Cornwell. 2007. A trait-based approach to community assembly. Ecology Letters 10:135-145. "
            "Tilman, D. 1982. Resource competition and community structure. Princeton University Press."
        )
        parser = ReferenceListParser()
        refs = parser.parse_reference_section(_doc_from_bib(bib_text))
        assert len(refs) == 2
        assert any("Ackerly" in getattr(a, "raw", str(a)) for a in refs[0].authors)
        assert refs[0].year == "2007"
        assert any("Tilman" in getattr(a, "raw", str(a)) for a in refs[1].authors)
        assert refs[1].year == "1982"

    def test_slavic_harvard_key_prefix_and_omitted_3em_dash_inheritance(self) -> None:
        bib_text = (
            "References\n"
            "Ewing 2002 – Ewing E.T. (2002), The Teachers of Stalinism, New York: Peter Lang.\n"
            "Foucault, Michel. 1977. Discipline and Punish. New York: Pantheon.\n"
            ". “The Subject and Power.” Critical Inquiry 8, no. 4 (1982): 777–795."
        )
        parser = ReferenceListParser()
        refs = parser.parse_reference_section(_doc_from_bib(bib_text))
        assert len(refs) >= 3
        assert any("Ewing" in getattr(a, "raw", str(a)) for a in refs[0].authors)
        assert refs[0].year == "2002"
        foucault_1982 = [r for r in refs if r.year == "1982"]
        assert len(foucault_1982) == 1
        assert any("Foucault" in getattr(a, "raw", str(a)) for a in foucault_1982[0].authors)

    def test_stray_bracket_numbers_do_not_hijack_author_year_bibliography(self) -> None:
        bib_text = (
            "References\n"
            "Ben-Sasson, H. H. (1976). A History of the Jewish People [5706]. Harvard University Press.\n"
            "Cohen, M. R. (1994). Under Crescent and Cross [113]. Princeton University Press.\n"
            "Smith, J. A. (2010). Modern Historiography. Oxford University Press."
        )
        parser = ReferenceListParser()
        refs = parser.parse_reference_section(_doc_from_bib(bib_text))
        assert len(refs) == 3
        assert all(r.numeric_index is None for r in refs)

    def test_multipage_bracketed_bibliography_past_page_15_not_truncated(self) -> None:
        bib_text = (
            "References\n"
            "[1] De Choudhury, M., Gamon, S. (2013). Predicting depression via social media. ICWSM.\n"
            "[2] Nguyen, D. Q., Nguyen, A. T. (2020). PhoBERT: Pre-trained language models for Vietnamese. EMNLP.\n"
            "19\n"
            "[3] Vaswani, A., Shazeer, N. (2017). Attention is all you need. NeurIPS.\n"
            "77\n"
            "[4] Devlin, J., Chang, M.-W. (2019). BERT: Pre-training of deep bidirectional transformers. NAACL."
        )
        parser = ReferenceListParser()
        refs = parser.parse_reference_section(_doc_from_bib(bib_text))
        assert len(refs) == 4
        assert [r.numeric_index for r in refs] == [1, 2, 3, 4]

    def test_vn_legal_wrapped_url_and_court_judgment_preserved(self) -> None:
        bib_text = (
            "Tài liệu tham khảo:\n"
            "Quốc hội. (2013). Hiến pháp nước Cộng hòa xã hội chủ nghĩa Việt Nam năm 2013, ban hành ngày 28/11/2013. "
            "https://\nvanban.chinhphu.vn/?\npageid=27160&docid=171264\n"
            "Tòa án nhân dân cấp cao tại TP. Hồ Chí Minh\n(2022). Bản án số 39/2022/KDTM-PT ngày 18/7/2022 "
            "xét xử phúc thẩm công khai vụ án kinh doanh thương mại về tranh chấp tên miền."
        )
        parser = ReferenceListParser()
        refs = parser.parse_reference_section(_doc_from_bib(bib_text))
        assert len(refs) == 2
        assert refs[0].year == "2013"
        assert refs[1].year == "2022"
        linker = CitationLinker()
        body = [
            Citation(
                raw_text="(Tòa án nhân dân cấp cao tại TP. Hồ Chí Minh, 2022)",
                citation_type=CitationType.IN_TEXT,
                style=CitationStyle.APA,
                year="2022",
                reference_id="occ-court",
            )
        ]
        refs[0].reference_id = "ref-const"
        refs[1].reference_id = "ref-court"
        res = linker.link(body, refs)
        assert len(res.unmatched_in_text) == 0


class TestCitationLinkerSprint2:
    """Verify square-bracketed Author-Year/Page, corporate acronym learning, and Ibid. inheritance."""

    def test_square_bracketed_author_year_and_acronym_learning(self) -> None:
        body_citations = [
            Citation(
                raw_text="(National Institute of Mental Health [NIMH], 2021)",
                citation_type=CitationType.IN_TEXT,
                style=CitationStyle.APA,
                authors=["National Institute of Mental Health"],
                year="2021",
                reference_id="occ-1",
            ),
            Citation(
                raw_text="[NIMH, 2021]",
                citation_type=CitationType.IN_TEXT,
                style=CitationStyle.APA,
                authors=["NIMH"],
                year="2021",
                reference_id="occ-2",
            ),
            Citation(
                raw_text="[Ewing 2002]",
                citation_type=CitationType.IN_TEXT,
                style=CitationStyle.APA,
                authors=["Ewing"],
                year="2002",
                reference_id="occ-3",
            ),
            Citation(
                raw_text="[Foucault, p. 45]",
                citation_type=CitationType.IN_TEXT,
                style=CitationStyle.MLA,
                authors=["Foucault"],
                year=None,
                reference_id="occ-4",
            ),
        ]

        references = [
            Citation(
                raw_text="National Institute of Mental Health (2021). Annual Mental Health Report.",
                citation_type=CitationType.REFERENCE_LIST,
                authors=["National Institute of Mental Health"],
                title="Annual Mental Health Report",
                year="2021",
                reference_id="ref-1",
            ),
            Citation(
                raw_text="Ewing, E. T. (2002). The Teachers of Stalinism. Peter Lang.",
                citation_type=CitationType.REFERENCE_LIST,
                authors=["Ewing, E. T."],
                title="The Teachers of Stalinism",
                year="2002",
                reference_id="ref-2",
            ),
            Citation(
                raw_text="Foucault, Michel. (1977). Discipline and Punish. Pantheon.",
                citation_type=CitationType.REFERENCE_LIST,
                authors=["Foucault, Michel"],
                title="Discipline and Punish",
                year="1977",
                reference_id="ref-3",
            ),
        ]

        linker = CitationLinker()
        result = linker.link(body_citations, references)
        matched_ref_ids = {
            link.reference_id
            for link in result.links
            if link.status == CitationMappingStatus.MATCHED
        }
        assert {"ref-1", "ref-2", "ref-3"}.issubset(matched_ref_ids)
        assert len(result.unmatched_in_text) == 0

    def test_ibid_footnote_inherits_previous_matched_reference(self) -> None:
        body_citations = [
            Citation(
                raw_text="(Smith 2019, 14)",
                citation_type=CitationType.IN_TEXT,
                style=CitationStyle.CHICAGO,
                authors=["Smith"],
                year="2019",
                reference_id="occ-1",
            ),
            Citation(
                raw_text="Ibid., p. 22",
                citation_type=CitationType.IN_TEXT,
                style=CitationStyle.CHICAGO,
                authors=["Ibid"],
                year=None,
                reference_id="occ-2",
            ),
        ]
        references = [
            Citation(
                raw_text="Smith, John. 2019. Archive Studies. Chicago: University of Chicago Press.",
                citation_type=CitationType.REFERENCE_LIST,
                authors=["Smith, John"],
                title="Archive Studies",
                year="2019",
                reference_id="ref-1",
            )
        ]
        linker = CitationLinker()
        result = linker.link(body_citations, references)
        matched = [l for l in result.links if l.status == CitationMappingStatus.MATCHED]
        assert len(matched) == 2
        assert matched[0].reference_id == "ref-1"
        assert matched[1].reference_id == "ref-1"


class TestSemanticBilingualBridgeAndLocalDBCache:
    """Verify Vietnamese-English concept bridging and LocalDatabase query cache."""

    def test_vietnamese_english_academic_concept_bridge(self) -> None:
        claim_vi = "Nghiên cứu đánh giá tác động của biến đổi khí hậu và năng lượng tái tạo đối với quản trị doanh nghiệp."
        detected, bridged = SemanticMatcher.detect_and_bridge_cross_lingual(
            claim_vi,
            source_title="Climate Change, Renewable Energy, and Corporate Governance",
            source_abstract="An empirical study on sustainable development.",
        )
        assert detected is True
        assert "climate change" in bridged
        assert "renewable energy" in bridged
        assert "corporate governance" in bridged

    def test_contradiction_stance_detects_refutation(self) -> None:
        claim = "Phương pháp này hoàn toàn thất bại và không có tác dụng cải thiện độ chính xác."
        evidence = "We demonstrate that our method is state-of-the-art and significantly improves accuracy."
        stance = SemanticMatcher.check_claim_stance(
            focal_sentence=claim,
            best_evidence_sentence=evidence,
            similarity=0.65,
            has_abstract=True,
        )
        assert stance == "contradiction_risk"

    def test_local_db_query_cache_hit_and_invalidation(self, tmp_path: Path) -> None:
        db_file = tmp_path / "test_cache.db"
        db = LocalDatabase(db_file)
        paper = Paper(
            doi="10.1021/acs.joc.2024.01",
            arxiv_id="2401.12345",
            title="Catalytic Asymmetric Hydrogenation of Quinolines",
            authors=["Nguyen, V. A.", "Tran, B. C."],
            year=2024,
            venue="Journal of Organic Chemistry",
            source="local_db",
        )
        db.add_paper(paper)

        # First lookup populates _QUERY_CACHE
        found_doi = db.find_by_doi("10.1021/acs.joc.2024.01")
        assert found_doi is not None
        assert found_doi.title == "Catalytic Asymmetric Hydrogenation of Quinolines"
        assert len(_QUERY_CACHE) >= 1

        found_arxiv = db.find_by_arxiv_id("2401.12345")
        assert found_arxiv is not None

        found_title = db.search_by_title("Catalytic Asymmetric Hydrogenation of Quinolines")
        assert len(found_title) == 1

        # Mutating the DB via add_paper bumps _MUTATION_VERSION and clears _QUERY_CACHE
        db.add_paper(
            Paper(
                doi="10.1021/acs.joc.2024.02",
                title="Another Organic Synthesis Paper",
                authors=["Le, D."],
                year=2024,
                source="local_db",
            )
        )
        assert db.find_by_doi("10.1021/acs.joc.2024.02") is not None
