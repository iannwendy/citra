"""Unit and integration tests for Task 7 (A5):
Composite Chemistry/Physics Sub-References (14a, 14b, 14c) Splitting & Bidirectional Linking.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest

from integrity_checker.extraction.base import Document, Page
from integrity_checker.extraction.citation_extractor import CitationExtractor
from integrity_checker.extraction.composite_splitter import (
    expand_composite_reference,
    expand_composite_references,
)
from integrity_checker.extraction.document_parser import DocumentParser, ParsedDocument
from integrity_checker.extraction.reference_parser import ReferenceListParser
from integrity_checker.extraction.section_segmenter import DocumentSection, SectionType
from integrity_checker.linking.citation_linker import CitationLinker
from integrity_checker.linking.duplicate_detector import DuplicateDetector
from integrity_checker.linking.statuses import CitationMappingStatus, MappingMethod
from integrity_checker.logic.neuro_symbolic_checker import NeuroSymbolicChecker
from integrity_checker.models.citation import Citation, CitationStyle, CitationType
from integrity_checker.models.source import SourceCandidate, SourceResult
from integrity_checker.models.validation import (
    CitationVerdict,
    ValidationLabel,
)
from integrity_checker.pipeline.integrity_pipeline import (
    AnalysisReport,
    IntegrityPipeline,
    _deserialize_citation,
    _serialize_citation,
)
from integrity_checker.retrieval.normalization import citation_key


class TestCitationModelAndSerialization:
    """Verify sub_index and composite_label fields and lossless serialization."""

    def test_citation_model_defaults_backward_compatible(self) -> None:
        cit = Citation(
            raw_text="14. Zhang, Y. J. Am. Chem. Soc. 2020, 142, 1234–1240.",
            citation_type=CitationType.REFERENCE_LIST,
            style=CitationStyle.ACS,
            numeric_index=14,
        )
        assert cit.numeric_index == 14
        assert cit.sub_index is None
        assert cit.composite_label is None

    def test_serialize_and_report_round_trip_preserves_composite_fields(self) -> None:
        cit = Citation(
            raw_text="(b) Wang, L. Org. Lett. 2021, 23, 550–554. DOI: 10.1021/acs.orglett.1c00222.",
            citation_type=CitationType.REFERENCE_LIST,
            style=CitationStyle.ACS,
            authors=["Wang, L."],
            year="2021",
            venue="Org. Lett.",
            doi="10.1021/acs.orglett.1c00222",
            numeric_index=14,
            sub_index="b",
            composite_label="14b",
            reference_id="ref-0014b",
        )
        serialized = _serialize_citation(cit)
        assert serialized["numeric_index"] == 14
        assert serialized["sub_index"] == "b"
        assert serialized["composite_label"] == "14b"

        rehydrated = _deserialize_citation(serialized)
        assert rehydrated.numeric_index == 14
        assert rehydrated.sub_index == "b"
        assert rehydrated.composite_label == "14b"

        verdict = CitationVerdict(
            citation=cit,
            label=ValidationLabel.VERIFIED,
            confidence=0.98,
            mapping_status=CitationMappingStatus.MATCHED,
            mapping_confidence=1.0,
        )
        report = AnalysisReport(
            essay_id=1,
            filename="chemistry.pdf",
            num_pages=5,
            num_citations=1,
            extracted_citations=[cit],
            verdicts=[verdict],
        )
        payload = report.to_dict()
        assert payload["verdicts"][0]["citation"]["sub_index"] == "b"
        assert payload["verdicts"][0]["citation"]["composite_label"] == "14b"
        assert payload["extracted_citations"][0]["composite_label"] == "14b"

        restored_report = AnalysisReport.from_dict(payload)
        assert restored_report.verdicts[0].citation.sub_index == "b"
        assert restored_report.verdicts[0].citation.composite_label == "14b"
        assert restored_report.extracted_citations[0].composite_label == "14b"


class TestCompositeSplitterAndGuards:
    """Verify ACS/RSC/APS composite splitting and Chemical Isomer / Prose False-Split Guards."""

    def test_acs_composite_entry_splits_into_14a_and_14b_with_distinct_dois(self) -> None:
        raw = (
            "14. (a) Zhang, Y.; Liu, X. J. Am. Chem. Soc. 2020, 142, 1234–1240. "
            "DOI: 10.1021/jacs.0c00111; "
            "(b) Wang, L. Org. Lett. 2021, 23, 550–554. "
            "DOI: 10.1021/acs.orglett.1c00222."
        )
        parser = ReferenceListParser()
        base = parser.parse_single_entry(raw, order_index=14, page_num=9)
        assert base is not None

        expanded = expand_composite_reference(base, ref_parser=parser)
        assert len(expanded) == 2

        ref_a, ref_b = expanded
        assert ref_a.numeric_index == 14
        assert ref_a.sub_index == "a"
        assert ref_a.composite_label == "14a"
        assert ref_a.doi == "10.1021/jacs.0c00111"
        assert str(ref_a.year) == "2020"
        assert ref_a.page_num == 9
        assert ref_a.citation_type == CitationType.REFERENCE_LIST
        assert any("zhang" in str(a).lower() for a in ref_a.authors)

        assert ref_b.numeric_index == 14
        assert ref_b.sub_index == "b"
        assert ref_b.composite_label == "14b"
        assert ref_b.doi == "10.1021/acs.orglett.1c00222"
        assert str(ref_b.year) == "2021"
        assert ref_b.page_num == 9
        assert ref_b.citation_type == CitationType.REFERENCE_LIST
        assert any("wang" in str(a).lower() for a in ref_b.authors)

    def test_bracketed_three_way_composite_and_lead_in_phrase(self) -> None:
        raw_three = (
            "[14] (a) Alpha, A. Phys. Rev. Lett. 2018, 120, 010101–010105; "
            "(b) Beta, B. Phys. Rev. B 2019, 99, 125101–125109; "
            "(c) Gamma, C. Nat. Phys. 2021, 17, 300–306."
        )
        cit_three = Citation(
            raw_text=raw_three,
            citation_type=CitationType.REFERENCE_LIST,
            style=CitationStyle.IEEE,
            numeric_index=14,
            page_num=12,
        )
        expanded_three = expand_composite_reference(cit_three)
        assert [c.composite_label for c in expanded_three] == ["14a", "14b", "14c"]
        assert [c.sub_index for c in expanded_three] == ["a", "b", "c"]
        assert [str(c.year) for c in expanded_three] == ["2018", "2019", "2021"]

        raw_lead_in = (
            "22. For recent reviews on C–H activation, see: "
            "a) Ackermann, L. Chem. Rev. 2011, 111, 1315–1345; "
            "b) Davies, H. M. L.; Morton, D. J. Org. Chem. 2016, 81, 343–350."
        )
        cit_lead = Citation(
            raw_text=raw_lead_in,
            citation_type=CitationType.REFERENCE_LIST,
            style=CitationStyle.ACS,
            numeric_index=22,
            page_num=15,
        )
        expanded_lead = expand_composite_reference(cit_lead)
        assert [c.composite_label for c in expanded_lead] == ["22a", "22b"]
        assert [str(c.year) for c in expanded_lead] == ["2011", "2016"]

    def test_chemical_isomer_guard_does_not_false_split(self) -> None:
        """Review Focus #4: (a)-isomer and (b)-enantiomer in a single paper title MUST NOT split."""
        raw = (
            "15. Nguyen, T. Synthesis of (a)-isomer and (b)-enantiomer derivatives. "
            "J. Org. Chem. 2022, 87, 100–110."
        )
        parser = ReferenceListParser()
        cit = parser.parse_single_entry(raw, order_index=15, page_num=10)
        assert cit is not None

        expanded = expand_composite_references([cit], ref_parser=parser)
        assert len(expanded) == 1
        assert expanded[0].numeric_index == 15
        assert expanded[0].sub_index is None
        assert expanded[0].composite_label is None

    @pytest.mark.parametrize(
        "raw_entry,idx",
        [
            (
                "16. Lee, K. Comparison of (a) thermal and (b) photochemical pathways in catalysis. "
                "Chem. Rev. 2021, 121, 500–520.",
                16,
            ),
            (
                "17. (a) First, A. J. Chem. Phys. 2019, 150, 100–105; "
                "(c) Third, C. J. Chem. Phys. 2020, 152, 200–205.",
                17,
            ),
            (
                "18. (b) Second, B. J. Chem. Phys. 2019, 150, 100–105; "
                "(c) Third, C. J. Chem. Phys. 2020, 152, 200–205.",
                18,
            ),
            (
                "19. Patel, R. Structure of poly(a) and vitamin (a) complexes with (a,b)-unsaturated ketones. "
                "Biochemistry 2020, 59, 410–422.",
                19,
            ),
        ],
    )
    def test_prose_and_nonsequential_markers_do_not_split(self, raw_entry: str, idx: int) -> None:
        parser = ReferenceListParser()
        cit = parser.parse_single_entry(raw_entry, order_index=idx, page_num=10)
        assert cit is not None
        expanded = expand_composite_references([cit], ref_parser=parser)
        assert len(expanded) == 1
        assert expanded[0].sub_index is None
        assert expanded[0].composite_label is None

    def test_expand_composite_references_is_idempotent(self) -> None:
        raw = (
            "14. (a) Zhang, Y.; Liu, X. J. Am. Chem. Soc. 2020, 142, 1234–1240; "
            "(b) Wang, L. Org. Lett. 2021, 23, 550–554."
        )
        cit = Citation(
            raw_text=raw,
            citation_type=CitationType.REFERENCE_LIST,
            style=CitationStyle.ACS,
            numeric_index=14,
        )
        once = expand_composite_references([cit])
        twice = expand_composite_references(once)
        assert len(once) == 2
        assert len(twice) == 2
        assert [c.composite_label for c in twice] == ["14a", "14b"]

    def test_reference_list_parser_expands_composite_entries_in_section(self) -> None:
        ref_text = (
            "13. Miller, A. Simple single entry. J. Phys. Chem. A 2019, 123, 10–20.\n"
            "14. (a) Zhang, Y.; Liu, X. J. Am. Chem. Soc. 2020, 142, 1234–1240. DOI: 10.1021/jacs.0c00111; "
            "(b) Wang, L. Org. Lett. 2021, 23, 550–554. DOI: 10.1021/acs.orglett.1c00222.\n"
            "15. Nguyen, T. Synthesis of (a)-isomer and (b)-enantiomer derivatives. J. Org. Chem. 2022, 87, 100–110.\n"
        )
        refs = ReferenceListParser().parse_reference_section(ref_text, page_num=8)
        assert len(refs) == 4
        assert [r.numeric_index for r in refs] == [13, 14, 14, 15]
        assert [r.composite_label for r in refs] == [None, "14a", "14b", None]
        assert [r.order_index for r in refs] == [1, 2, 3, 4]


class TestSameAuthorCollisionGuards:
    """Ensure same-author, same-year sub-references never collide in citation_key or DuplicateDetector."""

    def test_same_author_same_year_titleless_acs_sub_refs_do_not_collide(self) -> None:
        raw = (
            "14. (a) Smith, J. J. Am. Chem. Soc. 2020, 142, 100–110; "
            "(b) Smith, J. J. Am. Chem. Soc. 2020, 142, 200–210."
        )
        refs = ReferenceListParser().parse_reference_section(raw, page_num=5)
        assert len(refs) == 2
        ref_a, ref_b = refs
        assert ref_a.composite_label == "14a"
        assert ref_b.composite_label == "14b"

        assert citation_key(ref_a) != citation_key(ref_b)

        dup_groups = DuplicateDetector().detect(refs)
        assert dup_groups == []


class TestExtractionAndBidirectionalLinking:
    """Verify in-text extraction and CitationLinker bidirectional linking for [14b], [14a, 14c], [14a-c], (14b), [14]."""

    @pytest.fixture
    def composite_bib(self) -> list[Citation]:
        ref_section = (
            "13. Adams, R. Inorg. Chem. 2019, 58, 400–408.\n"
            "14. (a) Zhang, Y.; Liu, X. J. Am. Chem. Soc. 2020, 142, 1234–1240. DOI: 10.1021/jacs.0c00111; "
            "(b) Wang, L. Org. Lett. 2021, 23, 550–554. DOI: 10.1021/acs.orglett.1c00222; "
            "(c) Chen, M. ACS Catal. 2022, 12, 880–890. DOI: 10.1021/acscatal.2c00333.\n"
            "15. Baker, S. Organometallics 2022, 41, 900–910.\n"
        )
        refs = ReferenceListParser().parse_reference_section(ref_section, page_num=10)
        for idx, r in enumerate(refs, start=1):
            r.reference_id = f"ref-{idx:04d}"
        return refs

    def test_citation_extractor_extracts_alphanumeric_sub_reference_callouts(self) -> None:
        body = (
            "Earlier catalysis reports [14b] and mechanistic studies [14a, 14c] "
            "as well as full series [14a–c] and [14a-c] confirmed the pathway."
        )
        extracted = CitationExtractor().extract_from_text(body, page_num=2)
        raw_texts = [c.raw_text for c in extracted]
        assert "[14b]" in raw_texts
        assert "[14a, 14c]" in raw_texts
        assert "[14a–c]" in raw_texts
        assert "[14a-c]" in raw_texts
        assert all(c.citation_type == CitationType.NUMERIC for c in extracted if "14" in c.raw_text)

    def test_direct_14b_and_parent_14_fan_out(self) -> None:
        """Brief Requirement #2: [14b] links 1-to-1 to 14b; [14] fans out to both 14a and 14b (0 UNCITED, 0 AMBIGUOUS)."""
        ref_text = (
            "14. (a) Zhang, Y.; Liu, X. J. Am. Chem. Soc. 2020, 142, 1234–1240. DOI: 10.1021/jacs.0c00111; "
            "(b) Wang, L. Org. Lett. 2021, 23, 550–554. DOI: 10.1021/acs.orglett.1c00222."
        )
        refs = ReferenceListParser().parse_reference_section(ref_text, page_num=6)
        for idx, r in enumerate(refs, start=1):
            r.reference_id = f"ref-{idx:04d}"
        assert [r.composite_label for r in refs] == ["14a", "14b"]

        # Case A: only [14b] cited -> 1-to-1 link to 14b (ref-0002), 14a is UNCITED_REFERENCE
        occ_14b = Citation(
            raw_text="[14b]",
            citation_type=CitationType.NUMERIC,
            style=CitationStyle.IEEE,
            reference_id="occ-0001",
        )
        res_specific = CitationLinker().link([occ_14b], refs)
        assert len(res_specific.links) == 1
        assert res_specific.links[0].status == CitationMappingStatus.MATCHED
        assert res_specific.links[0].method == MappingMethod.NUMERIC_INDEX
        assert res_specific.links[0].reference_id == "ref-0002"
        assert refs[1].mapping_status == CitationMappingStatus.MATCHED.value
        assert refs[0].mapping_status == CitationMappingStatus.UNCITED_REFERENCE.value
        assert res_specific.unmatched_reference_ids == ["ref-0001"]

        # Case B: parent [14] cited -> fan-out to BOTH 14a and 14b, 0 UNCITED, 0 AMBIGUOUS
        occ_parent = Citation(
            raw_text="[14]",
            citation_type=CitationType.NUMERIC,
            style=CitationStyle.IEEE,
            reference_id="occ-0002",
        )
        res_parent = CitationLinker().link([occ_parent], refs)
        parent_links = [lnk for lnk in res_parent.links if lnk.occurrence_id == "occ-0002"]
        assert [lnk.reference_id for lnk in parent_links] == ["ref-0001", "ref-0002"]
        assert all(lnk.status == CitationMappingStatus.MATCHED for lnk in parent_links)
        assert all(lnk.method == MappingMethod.NUMERIC_INDEX for lnk in parent_links)
        assert res_parent.unmatched_reference_ids == []
        assert res_parent.status_counts.get(CitationMappingStatus.AMBIGUOUS_MAPPING, 0) == 0
        assert refs[0].mapping_status == CitationMappingStatus.MATCHED.value
        assert refs[1].mapping_status == CitationMappingStatus.MATCHED.value

    def test_multi_list_and_sub_index_range_linking(self, composite_bib: list[Citation]) -> None:
        # composite_bib: ref-0001 (13), ref-0002 (14a), ref-0003 (14b), ref-0004 (14c), ref-0005 (15)
        occ_list = Citation(
            raw_text="[14a, 14c]",
            citation_type=CitationType.NUMERIC,
            style=CitationStyle.IEEE,
            reference_id="occ-list",
        )
        res_list = CitationLinker().link([occ_list], composite_bib)
        assert [lnk.reference_id for lnk in res_list.links] == ["ref-0002", "ref-0004"]
        assert composite_bib[1].mapping_status == CitationMappingStatus.MATCHED.value
        assert composite_bib[3].mapping_status == CitationMappingStatus.MATCHED.value
        assert composite_bib[2].mapping_status == CitationMappingStatus.UNCITED_REFERENCE.value
        assert "ref-0003" in res_list.unmatched_reference_ids

        occ_range = Citation(
            raw_text="[14a–c]",
            citation_type=CitationType.NUMERIC,
            style=CitationStyle.IEEE,
            reference_id="occ-range",
        )
        res_range = CitationLinker().link([occ_range], composite_bib)
        assert [lnk.reference_id for lnk in res_range.links] == ["ref-0002", "ref-0003", "ref-0004"]
        assert composite_bib[1].mapping_status == CitationMappingStatus.MATCHED.value
        assert composite_bib[2].mapping_status == CitationMappingStatus.MATCHED.value
        assert composite_bib[3].mapping_status == CitationMappingStatus.MATCHED.value
        assert "ref-0002" not in res_range.unmatched_reference_ids
        assert "ref-0003" not in res_range.unmatched_reference_ids
        assert "ref-0004" not in res_range.unmatched_reference_ids

    def test_parenthetical_14b_and_missing_sub_index_14d(self, composite_bib: list[Citation]) -> None:
        occ_paren = Citation(
            raw_text="(14b)",
            citation_type=CitationType.NUMERIC,
            style=CitationStyle.ACS,
            reference_id="occ-paren",
        )
        occ_missing = Citation(
            raw_text="[14d]",
            citation_type=CitationType.NUMERIC,
            style=CitationStyle.IEEE,
            reference_id="occ-missing",
        )
        res = CitationLinker().link([occ_paren, occ_missing], composite_bib)
        by_occ = {lnk.occurrence_id: lnk for lnk in res.links}

        assert by_occ["occ-paren"].status == CitationMappingStatus.MATCHED
        assert by_occ["occ-paren"].reference_id == "ref-0003"
        assert by_occ["occ-missing"].status == CitationMappingStatus.MISSING_REFERENCE
        assert by_occ["occ-missing"].reference_id is None

    def test_grobid_tei_link_on_parent_14_still_fans_out_to_all_sub_refs(self) -> None:
        ref_a = Citation(
            raw_text="(a) Zhang, Y. J. Am. Chem. Soc. 2020, 142, 1234–1240.",
            citation_type=CitationType.REFERENCE_LIST,
            style=CitationStyle.ACS,
            numeric_index=14,
            sub_index="a",
            composite_label="14a",
            reference_id="ref-0014a",
            grobid_ref_id="b13",
            source="grobid",
        )
        ref_b = Citation(
            raw_text="(b) Wang, L. Org. Lett. 2021, 23, 550–554.",
            citation_type=CitationType.REFERENCE_LIST,
            style=CitationStyle.ACS,
            numeric_index=14,
            sub_index="b",
            composite_label="14b",
            reference_id="ref-0014b",
            grobid_ref_id="b13",
            source="grobid",
        )
        occ = Citation(
            raw_text="[14]",
            citation_type=CitationType.NUMERIC,
            style=CitationStyle.IEEE,
            reference_id="occ-0001",
            grobid_ref_id="b13",
            is_grobid_linked=True,
            source="grobid",
        )
        res = CitationLinker().link([occ], [ref_a, ref_b])
        assert [lnk.reference_id for lnk in res.links] == ["ref-0014a", "ref-0014b"]
        assert res.unmatched_reference_ids == []

    def test_document_parser_merge_extracts_parenthetical_composite_and_preserves_hybrid_refs(
        self,
    ) -> None:
        dp = DocumentParser()
        grobid_unsplit = Citation(
            raw_text=(
                "14. (a) Zhang, Y.; Liu, X. J. Am. Chem. Soc. 2020, 142, 1234–1240. "
                "DOI: 10.1021/jacs.0c00111; "
                "(b) Wang, L. Org. Lett. 2021, 23, 550–554. "
                "DOI: 10.1021/acs.orglett.1c00222."
            ),
            citation_type=CitationType.REFERENCE_LIST,
            style=CitationStyle.ACS,
            numeric_index=14,
            grobid_ref_id="b13",
            source="grobid",
        )
        regex_refs = ReferenceListParser().parse_reference_section(grobid_unsplit.raw_text, page_num=7)
        merged = dp._merge_reference_lists(expand_composite_references([grobid_unsplit]), regex_refs)
        assert len(merged) == 2
        assert [m.composite_label for m in merged] == ["14a", "14b"]

        sections = [
            DocumentSection(
                section_type=SectionType.BODY,
                text=(
                    "Catalytic turnover improved significantly as reported previously (14b). "
                    "However, Compound (14a) and Scheme (14b) in our synthesis are substrate labels."
                ),
                start_page=2,
                end_page=2,
            )
        ]
        body_cits = dp._extract_body_citations_for_composite_refs(sections, merged)
        assert [c.raw_text for c in body_cits] == ["(14b)"]


class TestIntegrityPipelineCompositeEndToEnd:
    """Verify IntegrityPipeline end-to-end flow with [14] and [14b] against composite 14a/14b."""

    @pytest.mark.asyncio
    async def test_pipeline_evaluates_and_links_composite_sub_references_cleanly(
        self, tmp_path
    ) -> None:
        dummy_pdf = tmp_path / "acs_composite.pdf"
        dummy_pdf.write_bytes(b"%PDF-1.4 dummy")

        refs = ReferenceListParser().parse_reference_section(
            "14. (a) Zhang, Y.; Liu, X. J. Am. Chem. Soc. 2020, 142, 1234–1240. "
            "DOI: 10.1021/jacs.0c00111; "
            "(b) Wang, L. Org. Lett. 2021, 23, 550–554. "
            "DOI: 10.1021/acs.orglett.1c00222.",
            page_num=5,
        )
        body_text = "The cascade reaction [14] and specifically the ligand effect [14b] were benchmarked."
        in_texts = CitationExtractor(preserve_occurrences=True).extract_from_text(
            body_text,
            page_num=1,
        )

        raw_doc = Document(
            file_path=str(dummy_pdf),
            num_pages=5,
            parser_used="regex",
            pages=[Page(page_num=1, text=body_text)],
            metadata={},
        )
        parsed_doc = ParsedDocument(
            document=raw_doc,
            sections=[
                DocumentSection(
                    section_type=SectionType.BODY,
                    text=body_text,
                    start_page=1,
                    end_page=1,
                )
            ],
            body_citations=in_texts,
            references=refs,
            appendix_citations=[],
            parser_used="regex",
            grobid_status="disabled",
        )

        mock_doc_parser = MagicMock()
        mock_doc_parser.parse.return_value = parsed_doc
        mock_orchestrator = MagicMock()
        mock_orchestrator.retrieve = AsyncMock(
            side_effect=lambda cit, **_kw: SourceResult(citation_raw=cit.raw_text)
        )

        pipeline = IntegrityPipeline(
            document_parser=mock_doc_parser,
            orchestrator=mock_orchestrator,
            use_report_cache=False,
        )

        report = await pipeline.run_async(str(dummy_pdf), essay_id=42)

        assert len(report.verdicts) == 2
        by_label = {v.citation.composite_label: v for v in report.verdicts}
        assert set(by_label.keys()) == {"14a", "14b"}
        assert by_label["14a"].mapping_status == CitationMappingStatus.MATCHED
        assert by_label["14b"].mapping_status == CitationMappingStatus.MATCHED
        assert report.linking_summary.get(CitationMappingStatus.UNCITED_REFERENCE.value, 0) == 0
        assert report.linking_summary.get(CitationMappingStatus.AMBIGUOUS_MAPPING.value, 0) == 0
        assert report.cis is not None
        assert report.cis.components.in_text_bib_consistency == 1.0

        report_dict = report.to_dict()
        rehydrated = AnalysisReport.from_dict(report_dict)
        assert {v.citation.composite_label for v in rehydrated.verdicts} == {"14a", "14b"}


class TestFixRound1Regressions:
    """Regression suite covering all 7 findings from Task 7 Review Round 1."""

    @pytest.mark.parametrize(
        "raw_entry",
        [
            "15. Smith, J. Survey of US recessions: (a) 1990–1991 downturn, and (b) 2008–2009 crisis. J. Econ. Perspect. 2022, 36, 100–120.",
            "15. World Health Organization. Global Tuberculosis Report: (a) 2019 baseline; (b) 2021 update. WHO Press, 2022.",
            "15. Nguyen, T. Asymmetric catalysis; (a) 1995 ligand class; (b) 2005 ligand class. Chem. Rev. 2022, 122, 100–150.",
        ],
    )
    def test_subtitle_colons_semicolons_and_historical_years_do_not_split(
        self, raw_entry: str
    ) -> None:
        parser = ReferenceListParser()
        cit = Citation(
            raw_text=raw_entry,
            citation_type=CitationType.REFERENCE_LIST,
            style=CitationStyle.ACS,
            numeric_index=15,
            order_index=15,
        )
        expanded = expand_composite_reference(cit, ref_parser=parser)
        assert len(expanded) == 1
        assert expanded[0].sub_index is None
        assert expanded[0].composite_label is None

        parsed_list = parser.parse_reference_section(raw_entry, page_num=4)
        assert len(parsed_list) == 1
        assert parsed_list[0].sub_index is None
        assert parsed_list[0].year == "2022"

    def test_rsc_and_wiley_initials_first_sub_entries_and_neuro_symbolic_verified(
        self,
    ) -> None:
        parser = ReferenceListParser()
        rsc_raw = (
            "14. (a) Y. Zhang and X. Liu, Chem. Sci., 2020, 11, 1234–1240, "
            "DOI: 10.1039/D0SC00111A; "
            "(b) L. Wang, Chem. Commun., 2021, 57, 550–554."
        )
        rsc_refs = parser.parse_reference_section(rsc_raw, page_num=6)
        assert len(rsc_refs) == 2
        r14a, r14b = rsc_refs

        assert r14a.composite_label == "14a"
        assert r14a.title is None
        assert r14a.venue == "Chem. Sci."
        assert r14a.year == "2020"
        assert r14a.volume == "11"
        assert r14a.pages == "1234–1240"
        assert r14a.doi == "10.1039/D0SC00111A"
        assert [a.last_name for a in r14a.authors] == ["zhang", "liu"]

        assert r14b.composite_label == "14b"
        assert r14b.title is None
        assert r14b.venue == "Chem. Commun."
        assert r14b.year == "2021"
        assert r14b.volume == "57"
        assert r14b.pages == "550–554"
        assert [a.last_name for a in r14b.authors] == ["wang"]

        wiley_raw = (
            "[14] a) Y. Zhang, X. Liu, Angew. Chem. Int. Ed. 2020, 59, 1234–1240; "
            "b) L. Wang, M. Chen, Chem. Eur. J. 2021, 27, 550–554."
        )
        wiley_refs = parser.parse_reference_section(wiley_raw, page_num=6)
        assert len(wiley_refs) == 2
        w14a, w14b = wiley_refs
        assert w14a.composite_label == "14a"
        assert w14a.title is None
        assert w14a.venue == "Angew. Chem. Int. Ed."
        assert w14a.year == "2020"
        assert w14a.volume == "59"
        assert w14a.pages == "1234–1240"
        assert [a.last_name for a in w14a.authors] == ["zhang", "liu"]

        assert w14b.composite_label == "14b"
        assert w14b.title is None
        assert w14b.venue == "Chem. Eur. J."
        assert w14b.year == "2021"
        assert w14b.volume == "27"
        assert w14b.pages == "550–554"
        assert [a.last_name for a in w14b.authors] == ["wang", "chen"]

        # Verify NeuroSymbolicChecker marks title-less RSC DOI match as VERIFIED (never R-CHIMERIC-DOI-MISMATCH)
        checker = NeuroSymbolicChecker(enable_content_alignment=False)
        source_res = SourceResult(
            citation_raw=r14a.raw_text,
            candidates=[
                SourceCandidate(
                    source_name="crossref",
                    found=True,
                    doi="10.1039/D0SC00111A",
                    title="Visible-Light-Induced Nickel-Catalyzed Cross-Coupling of Aryl Halides",
                    authors=["Y. Zhang", "X. Liu"],
                    year="2020",
                    venue="Chemical Science",
                    confidence=0.95,
                    score=1.0,
                )
            ],
            sources_queried=["crossref"],
            sources_succeeded=["crossref"],
        )
        verdict = checker.check(r14a, source_res)
        assert verdict.label == ValidationLabel.VERIFIED
        assert "R-CHIMERIC-DOI-MISMATCH" not in verdict.triggered_rules

    def test_acs_superscript_sub_indices_not_truncated_and_linked(self) -> None:
        extractor = CitationExtractor(preserve_occurrences=True)
        body = "Catalysis was reported previously^14b and extended^14a,b by Zhang^14c."
        cits = extractor.extract_from_text(body, page_num=1)
        assert [c.raw_text for c in cits] == ["^14b", "^14a,b", "Zhang^14c"]

        bib = ReferenceListParser().parse_reference_section(
            "14. (a) Zhang, Y. J. Am. Chem. Soc. 2020, 142, 100–105; "
            "(b) Wang, L. Org. Lett. 2021, 23, 200–205; "
            "(c) Chen, M. Chem. Sci. 2022, 13, 300–305.",
            page_num=5,
        )
        for idx, b in enumerate(bib, start=1):
            b.reference_id = f"ref-{idx:04d}"
        for idx, c in enumerate(cits, start=1):
            c.reference_id = f"occ-{idx:04d}"

        res = CitationLinker().link(cits, bib)
        links_by_occ: dict[str, list[str | None]] = {}
        for lnk in res.links:
            links_by_occ.setdefault(lnk.occurrence_id, []).append(lnk.reference_id)

        assert links_by_occ["occ-0001"] == ["ref-0002"]
        assert links_by_occ["occ-0002"] == ["ref-0001", "ref-0002"]
        assert links_by_occ["occ-0003"] == ["ref-0003"]
        assert res.unmatched_reference_ids == []

    def test_no_false_positives_on_equations_plural_labels_substrates_and_si_units(
        self,
    ) -> None:
        dp = DocumentParser()
        comp_refs = ReferenceListParser().parse_reference_section(
            "1. (a) Zhang, Y. J. Am. Chem. Soc. 2020, 142, 100–105; "
            "(b) Wang, L. Org. Lett. 2021, 23, 200–205.\n"
            "2. (a) Lee, K. Chem. Sci. 2019, 10, 300–305; "
            "(b) Kim, S. Org. Lett. 2020, 22, 400–405; "
            "(c) Park, J. J. Org. Chem. 2021, 86, 500–505.",
            page_num=8,
        )
        assert [r.composite_label for r in comp_refs] == ["1a", "1b", "2a", "2b", "2c"]

        sections = [
            DocumentSection(
                section_type=SectionType.BODY,
                text=(
                    "Equations (1a) and (1b) govern the rate law:\n"
                    "k_obs = k_1 [A] + k_2 [B]   (1a)\n"
                    "Compounds (2a) and (2b) gave ketone (2c) in high yield.\n"
                    "Figures (1a) and Schemes (2a, 2b) illustrate the cycle, "
                    "as shown previously (1b)."
                ),
                start_page=2,
                end_page=2,
            )
        ]
        body_cits = dp._extract_body_citations_for_composite_refs(sections, comp_refs)
        assert [c.raw_text for c in body_cits] == ["(1b)"]

        # SI unit & dimension brackets must never be extracted as numeric citations
        extractor = CitationExtractor(preserve_occurrences=True)
        unit_text = (
            "The reaction ran for [24h] in a [10m] capillary with [5g] catalyst "
            "using a [3d] or [2d] mesh for [30s], see [14b]."
        )
        unit_cits = extractor.extract_from_text(unit_text, page_num=1)
        assert [c.raw_text for c in unit_cits] == ["[14b]"]

    def test_wrapped_doi_without_period_comma_separated_and_aps_year_paren_split(
        self,
    ) -> None:
        parser = ReferenceListParser()

        wrapped_doi = (
            "14. (a) Zhang, Y.; Liu, X. J. Am. Chem. Soc. 2020, 142, 1234–1240, "
            "DOI: 10.1021/jacs.0c00111\n"
            "(b) Wang, L. Org. Lett. 2021, 23, 550–554, "
            "DOI: 10.1021/acs.orglett.1c00222"
        )
        r_wrap = parser.parse_reference_section(wrapped_doi, page_num=5)
        assert [r.composite_label for r in r_wrap] == ["14a", "14b"]
        assert r_wrap[0].doi == "10.1021/jacs.0c00111"
        assert r_wrap[1].doi == "10.1021/acs.orglett.1c00222"

        aps_no_punct = (
            "[14] (a) Y. Zhang, Phys. Rev. Lett. 124, 123001 (2020) "
            "(b) L. Wang, Phys. Rev. B 103, 045102 (2021)."
        )
        r_aps = parser.parse_reference_section(aps_no_punct, page_num=5)
        assert [r.composite_label for r in r_aps] == ["14a", "14b"]
        assert r_aps[0].year == "2020"
        assert r_aps[1].year == "2021"

        aps_comma = (
            "[14] (a) Y. Zhang, Phys. Rev. Lett. 124, 123001 (2020), "
            "(b) L. Wang, Phys. Rev. B 103, 045102 (2021)."
        )
        r_aps_c = parser.parse_reference_section(aps_comma, page_num=5)
        assert [r.composite_label for r in r_aps_c] == ["14a", "14b"]

        comma_sep = (
            "14. (a) Zhang, Y. J. Am. Chem. Soc. 2020, 142, 1234–1240, "
            "(b) Wang, L. Org. Lett. 2021, 23, 550–554."
        )
        r_comma = parser.parse_reference_section(comma_sep, page_num=5)
        assert [r.composite_label for r in r_comma] == ["14a", "14b"]

    def test_split_by_year_boundary_does_not_swallow_subsequent_numbered_entry(
        self,
    ) -> None:
        bib_text = (
            "References\n"
            "14. (a) Zhang, Y.; Liu, X. J. Am. Chem. Soc. 2020, 142, 1234–1240. "
            "DOI: 10.1021/jacs.0c00111; "
            "(b) Wang, L. Org. Lett. 2021, 23, 550–554.\n"
            "22. Baker, S. J. Org. Chem. 2022, 87, 100–110. "
            "DOI: 10.1021/acs.joc.2c00333."
        )
        refs = ReferenceListParser().parse_reference_section(bib_text, page_num=6)
        assert [(r.numeric_index, r.composite_label, r.doi) for r in refs] == [
            (14, "14a", "10.1021/jacs.0c00111"),
            (14, "14b", None),
            (22, None, "10.1021/acs.joc.2c00333"),
        ]

        # Also test _split_by_year_boundary directly (and flattened single-line PDF extraction)
        inline_bib = (
            "14. (a) Zhang, Y.; Liu, X. J. Am. Chem. Soc. 2020, 142, 1234–1240. "
            "DOI: 10.1021/jacs.0c00111; "
            "(b) Wang, L. Org. Lett. 2021, 23, 550–554. "
            "22. Baker, S. J. Org. Chem. 2022, 87, 100–110. "
            "DOI: 10.1021/acs.joc.2c00333."
        )
        chunks = ReferenceListParser()._split_by_year_boundary(inline_bib)
        assert len(chunks) == 2
        inline_refs = ReferenceListParser().parse_reference_section(inline_bib, page_num=6)
        assert [(r.numeric_index, r.composite_label, r.doi) for r in inline_refs] == [
            (14, "14a", "10.1021/jacs.0c00111"),
            (14, "14b", None),
            (22, None, "10.1021/acs.joc.2c00333"),
        ]

    def test_hybrid_grobid_unexpanded_with_regex_expanded_preserves_14a_and_14b(
        self,
    ) -> None:
        dp = DocumentParser()
        grobid_refs = [
            Citation(
                raw_text=f"{idx}. Author{idx}, A. J. Chem. 2020, {idx}, 10–15.",
                citation_type=CitationType.REFERENCE_LIST,
                style=CitationStyle.ACS,
                authors=[f"Author{idx}, A."],
                title=f"Paper Title {idx}",
                venue="J. Chem.",
                year="2020",
                numeric_index=idx,
                order_index=idx,
                source="grobid",
                grobid_ref_id=f"b{idx - 1}",
            )
            for idx in range(1, 6)
        ]
        # GROBID extracted only (a) of entry 14 without (a)/(b) markers (unexpanded)
        grobid_refs.append(
            Citation(
                raw_text="14. Smith, J. Catalytic Cycle Part I. J. Am. Chem. Soc. 2020, 142, 100–110.",
                citation_type=CitationType.REFERENCE_LIST,
                style=CitationStyle.ACS,
                authors=["Smith, J."],
                title="Catalytic Cycle Part I",
                venue="J. Am. Chem. Soc.",
                year="2020",
                numeric_index=14,
                order_index=6,
                source="grobid",
                grobid_ref_id="b13",
            )
        )

        regex_refs = [
            Citation(
                raw_text=g.raw_text,
                citation_type=CitationType.REFERENCE_LIST,
                style=CitationStyle.ACS,
                authors=list(g.authors),
                title=g.title,
                venue=g.venue,
                year=g.year,
                numeric_index=g.numeric_index,
                order_index=g.order_index,
                source="regex",
            )
            for g in grobid_refs[:5]
        ]
        # Regex expanded 14 into 14a (titled) and 14b (title-less, no DOI/URL, >420 chars fallback)
        regex_refs.append(
            Citation(
                raw_text="(a) Smith, J. Catalytic Cycle Part I. J. Am. Chem. Soc. 2020, 142, 100–110.",
                citation_type=CitationType.REFERENCE_LIST,
                style=CitationStyle.ACS,
                authors=["Smith, J."],
                title="Catalytic Cycle Part I",
                venue="J. Am. Chem. Soc.",
                year="2020",
                numeric_index=14,
                sub_index="a",
                composite_label="14a",
                order_index=6,
                matched_pattern="acs_reference_article",
                source="regex",
            )
        )
        long_note = " " + ("supplementary kinetic derivation details " * 11)
        regex_refs.append(
            Citation(
                raw_text=f"(b) Smith, J. Org. Lett. 2020, 22, 550–554.{long_note}",
                citation_type=CitationType.REFERENCE_LIST,
                style=CitationStyle.ACS,
                authors=["Smith, J."],
                title=None,
                venue="Org. Lett.",
                year="2020",
                numeric_index=14,
                sub_index="b",
                composite_label="14b",
                order_index=7,
                matched_pattern="composite_sub_fallback",
                source="regex",
            )
        )

        merged = dp._merge_reference_lists(grobid_refs, regex_refs)
        merged_14 = [m for m in merged if m.numeric_index == 14]
        assert [m.composite_label for m in merged_14] == ["14a", "14b"]
        assert all(m.grobid_ref_id == "b13" for m in merged_14)


class TestFixRound2Regressions:
    """Regression suite covering all 7 items from Task 7 Fix Round 2."""

    def test_rsc_hyphenated_initials_three_authors_unquoted_title_and_wiley_eid(
        self,
    ) -> None:
        parser = ReferenceListParser()

        # 1) Hyphenated initials with periods (J.-Q. Yu)
        hyphen_raw = (
            "14. (a) J.-Q. Yu and D. W. C. MacMillan, J. Am. Chem. Soc., 2020, 142, 1234–1240, "
            "DOI: 10.1021/jacs.0c00111; "
            "(b) L. Wang, Chem. Commun., 2021, 57, 550–554."
        )
        hyphen_refs = parser.parse_reference_section(hyphen_raw, page_num=5)
        assert len(hyphen_refs) == 2
        h14a, h14b = hyphen_refs
        assert h14a.composite_label == "14a"
        assert [a.last_name for a in h14a.authors] == ["yu", "macmillan"]
        assert h14a.venue == "J. Am. Chem. Soc."
        assert h14a.year == "2020"
        assert h14a.title is None
        assert h14b.composite_label == "14b"
        assert [a.last_name for a in h14b.authors] == ["wang"]

        # 2) 3+ RSC authors without Oxford comma & all-comma-separated
        three_auth_raw = (
            "15. (a) Y. Zhang, X. Liu and M. Chen, Chem. Sci., 2020, 11, 1234–1240; "
            "(b) J.-Q. Yu, X. Liu, M. Chen, Org. Lett., 2021, 23, 100–104."
        )
        three_refs = parser.parse_reference_section(three_auth_raw, page_num=5)
        assert len(three_refs) == 2
        assert [a.last_name for a in three_refs[0].authors] == ["zhang", "liu", "chen"]
        assert [a.last_name for a in three_refs[1].authors] == ["yu", "liu", "chen"]

        # 3) Unquoted comma-delimited RSC title vs comma-containing RSC venue (Angew. Chem., Int. Ed.)
        unquoted_title_raw = (
            "16. (a) Y. Zhang and X. Liu, Nickel-Catalyzed Cross-Coupling of Aryl Halides, "
            "Chem. Sci., 2020, 11, 1234–1240, DOI: 10.1039/D0SC00111A; "
            "(b) L. Wang, Angew. Chem., Int. Ed., 2021, 60, 550–554."
        )
        unquoted_refs = parser.parse_reference_section(unquoted_title_raw, page_num=5)
        assert len(unquoted_refs) == 2
        assert unquoted_refs[0].title == "Nickel-Catalyzed Cross-Coupling of Aryl Halides"
        assert unquoted_refs[0].venue == "Chem. Sci."
        assert unquoted_refs[1].title is None
        assert unquoted_refs[1].venue == "Angew. Chem., Int. Ed."

        # 4) Wiley/Angewandte electronic article IDs without page hyphens (e202201234)
        wiley_eid_raw = (
            "[14] a) Y. Zhang, X. Liu, Angew. Chem. Int. Ed. 2022, 61, e202201234; "
            "b) L. Wang, Chem. Eur. J. 2021, 27, 550–554."
        )
        wiley_refs = parser.parse_reference_section(wiley_eid_raw, page_num=5)
        assert len(wiley_refs) == 2
        assert wiley_refs[0].composite_label == "14a"
        assert [a.last_name for a in wiley_refs[0].authors] == ["zhang", "liu"]
        assert wiley_refs[0].venue == "Angew. Chem. Int. Ed."
        assert wiley_refs[0].year == "2022"
        assert wiley_refs[0].volume == "61"
        assert wiley_refs[0].pages == "e202201234"
        assert wiley_refs[1].composite_label == "14b"
        assert wiley_refs[1].pages == "550–554"

    def test_superscript_multi_item_composite_callouts_not_truncated_and_linked(self) -> None:
        extractor = CitationExtractor(preserve_occurrences=True)
        body = "Catalysis was reported^1,2,14c and extended^1–3,14b by Zhang^1,2,14c."
        extracted = extractor.extract_from_text(body, page_num=1)
        raws = [c.raw_text for c in extracted]
        assert "^1,2,14c" in raws
        assert "^1–3,14b" in raws
        assert "Zhang^1,2,14c" in raws
        assert "^1" not in raws

        bibs = [
            Citation(
                raw_text=f"{idx}. Ref {idx}. J. Am. Chem. Soc. 2020, 142, {idx}0–{idx}5.",
                citation_type=CitationType.REFERENCE_LIST,
                style=CitationStyle.ACS,
                numeric_index=idx,
                order_index=idx,
                reference_id=f"ref-{idx}",
            )
            for idx in (1, 2, 3)
        ] + [
            Citation(
                raw_text=f"({sub}) Zhang, Y. Chem. Sci. 2020, 11, 10{i}–10{i + 2}.",
                citation_type=CitationType.REFERENCE_LIST,
                style=CitationStyle.ACS,
                authors=["Zhang, Y."],
                year="2020",
                numeric_index=14,
                sub_index=sub,
                composite_label=f"14{sub}",
                order_index=3 + i,
                reference_id=f"ref-14{sub}",
            )
            for i, sub in enumerate(["a", "b", "c"], start=1)
        ]

        for idx_o, occ in enumerate(extracted, start=1):
            occ.reference_id = f"occ-{idx_o:04d}"

        res = CitationLinker().link(extracted, bibs)
        occ_by_raw: dict[str, list[str]] = {}
        for occ in extracted:
            occ_links = [lk for lk in res.links if lk.occurrence_id == occ.reference_id]
            assert all(lk.status == CitationMappingStatus.MATCHED for lk in occ_links)
            occ_by_raw.setdefault(occ.raw_text, []).extend(
                lk.reference_id for lk in occ_links if lk.reference_id
            )

        assert occ_by_raw["^1,2,14c"] == ["ref-1", "ref-2", "ref-14c"]
        assert occ_by_raw["^1–3,14b"] == ["ref-1", "ref-2", "ref-3", "ref-14b"]
        assert occ_by_raw["Zhang^1,2,14c"] == ["ref-1", "ref-2", "ref-14c"]

    def test_split_by_year_boundary_paren_composite_periodless_pages_and_surname_particles(
        self,
    ) -> None:
        parser = ReferenceListParser()

        # Layout A: Parenthesized ACS numbering followed by (a)
        raw_paren = (
            "(14) (a) Zhang, Y. J. Am. Chem. Soc. 2020, 142, 1234–1240. DOI: 10.1021/jacs.0c00111; "
            "(b) Wang, L. Org. Lett. 2021, 23, 550–554. "
            "(15) (a) Baker, S. Chem. Rev. 2022, 122, 100–110. DOI: 10.1021/acs.chemrev.2c00222; "
            "(b) Clark, R. Chem. Sci. 2022, 13, 200–210."
        )
        refs_paren = parser.parse_reference_section(raw_paren, page_num=7)
        assert [r.composite_label for r in refs_paren] == ["14a", "14b", "15a", "15b"]

        # Layout B: Period-less (b) page ranges before next entry
        raw_periodless = (
            "14. (a) Zhang, Y. J. Am. Chem. Soc. 2020, 142, 1234–1240. DOI: 10.1021/jacs.0c00111; "
            "(b) Wang, L. Org. Lett. 2021, 23, 550–554 "
            "22. Baker, S. J. Am. Chem. Soc. 2022, 144, 100–110. DOI: 10.1021/jacs.2c00222."
        )
        refs_periodless = parser.parse_reference_section(raw_periodless, page_num=7)
        assert len(refs_periodless) == 3
        assert refs_periodless[0].composite_label == "14a"
        assert refs_periodless[1].composite_label == "14b"
        assert "Baker" not in refs_periodless[1].raw_text
        assert refs_periodless[2].numeric_index == 22

        # Layout C: Lowercase surname particles (22. van Leeuwen, P. W. N. M. ...)
        raw_particle = (
            "14. (a) Zhang, Y. J. Am. Chem. Soc. 2020, 142, 1234–1240. DOI: 10.1021/jacs.0c00111; "
            "(b) Wang, L. Org. Lett. 2021, 23, 550–554. "
            "22. van Leeuwen, P. W. N. M. Chem. Rev. 2011, 111, 2077–2118. DOI: 10.1021/cr1002497."
        )
        refs_particle = parser.parse_reference_section(raw_particle, page_num=7)
        assert len(refs_particle) == 3
        assert refs_particle[1].composite_label == "14b"
        assert "van Leeuwen" not in refs_particle[1].raw_text
        assert refs_particle[2].numeric_index == 22
        assert refs_particle[2].authors[0].last_name == "van leeuwen"
        assert refs_particle[2].venue.rstrip(".") == "Chem. Rev"

    def test_titleless_chemistry_ref_never_rubber_stamped_by_known_papers(self) -> None:
        parser = ReferenceListParser()
        raw = (
            "14. (a) C. He, Chem. Sci., 2016, 7, 1234–1240, DOI: 10.1039/C6SC99999Z; "
            "(b) L. Wang, Chem. Commun., 2018, 54, 100–104, DOI: 10.1039/C8CC99999Z."
        )
        refs = parser.parse_reference_section(raw, page_num=6)
        assert len(refs) == 2

        checker = NeuroSymbolicChecker(enable_content_alignment=False)
        for ref in refs:
            empty_res = SourceResult(
                citation_raw=ref.raw_text,
                candidates=[],
                sources_queried=["crossref", "openalex"],
                sources_succeeded=[],
            )
            verdict = checker.check(ref, empty_res)
            assert verdict.label == ValidationLabel.SUSPECTED_HALLUCINATION
            assert "R-KNOWN-PAPER" not in verdict.triggered_rules

        # Bare in-text callout (He et al., 2016) still verifies via R-KNOWN-PAPER
        intext_he = Citation(
            raw_text="(He et al., 2016)",
            citation_type=CitationType.IN_TEXT,
            style=CitationStyle.APA,
            authors=["He"],
            year="2016",
        )
        intext_verdict = checker.check(
            intext_he,
            SourceResult(
                citation_raw=intext_he.raw_text,
                candidates=[],
                sources_queried=["crossref"],
                sources_succeeded=[],
            ),
        )
        assert intext_verdict.label == ValidationLabel.VERIFIED
        assert "R-KNOWN-PAPER" in intext_verdict.triggered_rules

    def test_titleless_journal_venue_title_swallow_year_mismatch_and_chimeric_doi_guards(
        self,
    ) -> None:
        parser = ReferenceListParser()
        checker = NeuroSymbolicChecker(enable_content_alignment=False)

        # Case 1: Fabricated period-separated title before Chem. Sci. MUST NOT be swallowed into venue
        swallow_raw = (
            "14. (a) Y. Zhang and X. Liu, Quantum Gravity Hallucination. Chem. Sci., "
            "2020, 11, 1234–1240, DOI: 10.1039/D0SC00111A; "
            "(b) L. Wang, Chem. Commun., 2021, 57, 550–554."
        )
        swallow_refs = parser.parse_reference_section(swallow_raw, page_num=6)
        assert len(swallow_refs) == 2
        assert swallow_refs[0].title == "Quantum Gravity Hallucination"
        assert swallow_refs[0].venue == "Chem. Sci."

        v_swallow = checker.check(
            swallow_refs[0],
            SourceResult(
                citation_raw=swallow_refs[0].raw_text,
                candidates=[
                    SourceCandidate(
                        source_name="crossref",
                        found=True,
                        doi="10.1039/D0SC00111A",
                        title="Visible-Light-Induced Nickel-Catalyzed Cross-Coupling of Aryl Halides",
                        authors=["Y. Zhang", "X. Liu"],
                        year="2020",
                        venue="Chemical Science",
                        confidence=0.95,
                        score=1.0,
                    )
                ],
                sources_queried=["crossref"],
                sources_succeeded=["crossref"],
            ),
        )
        assert v_swallow.label == ValidationLabel.SUSPECTED_HALLUCINATION

        # Case 2: Title-less DOI entry with year_dist >= 2 (2023 vs Crossref 2019) -> METADATA_ERROR
        yr_raw = (
            "14. (a) Y. Zhang and X. Liu, Chem. Sci., 2023, 11, 1234–1240, "
            "DOI: 10.1039/D0SC00111A; "
            "(b) L. Wang, Chem. Commun., 2021, 57, 550–554."
        )
        yr_refs = parser.parse_reference_section(yr_raw, page_num=6)
        v_year = checker.check(
            yr_refs[0],
            SourceResult(
                citation_raw=yr_refs[0].raw_text,
                candidates=[
                    SourceCandidate(
                        source_name="crossref",
                        found=True,
                        doi="10.1039/D0SC00111A",
                        title="Visible-Light-Induced Nickel-Catalyzed Cross-Coupling of Aryl Halides",
                        authors=["Y. Zhang", "X. Liu"],
                        year="2019",
                        venue="Chemical Science",
                        confidence=0.95,
                        score=1.0,
                    )
                ],
                sources_queried=["crossref"],
                sources_succeeded=["crossref"],
            ),
        )
        assert v_year.label == ValidationLabel.METADATA_ERROR
        assert "year" in v_year.mismatched_fields

        # Case 3: Cross-domain spliced DOI sharing only 1 of 5 authors (Chem. Sci. vs IEEE TPAMI)
        chimeric_raw = (
            "14. (a) Y. Zhang, K. Lee and M. Park, Chem. Sci., 2023, 11, 1234–1240, "
            "DOI: 10.1109/TPAMI.2018.123456; "
            "(b) L. Wang, Chem. Commun., 2021, 57, 550–554."
        )
        chimeric_refs = parser.parse_reference_section(chimeric_raw, page_num=6)
        v_chimeric = checker.check(
            chimeric_refs[0],
            SourceResult(
                citation_raw=chimeric_refs[0].raw_text,
                candidates=[
                    SourceCandidate(
                        source_name="crossref",
                        found=True,
                        doi="10.1109/TPAMI.2018.123456",
                        title="Mask R-CNN",
                        authors=["Y. Zhang", "H. He", "R. Girshick"],
                        year="2018",
                        venue="IEEE Transactions on Pattern Analysis and Machine Intelligence",
                        confidence=0.95,
                        score=1.0,
                    )
                ],
                sources_queried=["crossref"],
                sources_succeeded=["crossref"],
            ),
        )
        assert v_chimeric.label == ValidationLabel.SUSPECTED_HALLUCINATION
        assert "R-CHIMERIC-DOI-MISMATCH" in v_chimeric.triggered_rules

    def test_bracketed_1d_4f_and_14g_preserved_for_composite_bibliographies(
        self, tmp_path
    ) -> None:
        bib_raw = (
            "[1] (a) Smith, J. J. Am. Chem. Soc. 2020, 142, 10–15; "
            "(b) Jones, A. Org. Lett. 2020, 22, 20–25; "
            "(c) Lee, K. Chem. Sci. 2021, 12, 30–35; "
            "(d) Chen, M. Chem. Commun. 2021, 57, 40–45."
        )
        bibs_1 = ReferenceListParser().parse_reference_section(bib_raw, page_num=3)
        assert [b.composite_label for b in bibs_1] == ["1a", "1b", "1c", "1d"]
        for b in bibs_1:
            b.reference_id = f"ref-{b.composite_label}"

        # Standalone CitationExtractor + CitationLinker
        body_1 = "Catalysts [1a], [1b], [1c], and [1d] were screened."
        in_text_1 = CitationExtractor(preserve_occurrences=True).extract_from_text(
            body_1, page_num=1
        )
        link_res_1 = CitationLinker().link(in_text_1, bibs_1)
        assert link_res_1.unmatched_reference_ids == []
        assert len(link_res_1.links) == 4
        assert all(lk.status == CitationMappingStatus.MATCHED for lk in link_res_1.links)

        # DocumentParser rescue when [1d], [4f], [14g] appear without sibling [1a]/[4a] in body,
        # while still ignoring SI units [24h] and [5g]
        dummy_pdf = tmp_path / "composite_brackets.pdf"
        dummy_pdf.write_bytes(b"%PDF-1.4 dummy")
        doc = Document(
            file_path=str(dummy_pdf),
            num_pages=2,
            parser_used="mupdf",
            pages=[
                Page(
                    page_num=1,
                    text=(
                        "Introduction\n"
                        "Protocol [1d] and ligand [4f] outperformed [14g] after [24h] using [5g] silica."
                    ),
                ),
                Page(
                    page_num=2,
                    text=(
                        "References\n"
                        "[1] (a) Smith, J. J. Am. Chem. Soc. 2020, 142, 10–15; "
                        "(b) Jones, A. Org. Lett. 2020, 22, 20–25; "
                        "(c) Lee, K. Chem. Sci. 2021, 12, 30–35; "
                        "(d) Chen, M. Chem. Commun. 2021, 57, 40–45.\n"
                        "[4] (a) Adams, R. Org. Lett. 2019, 21, 1–5; "
                        "(b) Baker, S. Org. Lett. 2019, 21, 6–10; "
                        "(c) Clark, T. Org. Lett. 2019, 21, 11–15; "
                        "(d) Davis, U. Org. Lett. 2019, 121, 16–20; "
                        "(e) Evans, V. Org. Lett. 2019, 21, 21–25; "
                        "(f) Frank, W. Org. Lett. 2019, 21, 26–30.\n"
                        "[5] Green, X. Chem. Rev. 2020, 120, 100–120.\n"
                        "[14] (a) White, Y. Chem. Sci. 2021, 12, 200–205; "
                        "(b) Black, Z. Chem. Sci. 2021, 12, 210–215.\n"
                        "[24] Young, P. J. Org. Chem. 2020, 85, 300–310."
                    ),
                ),
            ],
            metadata={},
        )
        mock_mupdf = MagicMock()
        mock_mupdf.parse.return_value = doc
        dp = DocumentParser(mupdf_parser=mock_mupdf)
        dp._load_grobid_tei = MagicMock(return_value=None)  # type: ignore[method-assign]
        parsed_doc = dp.parse(str(dummy_pdf), use_service_manager=False)
        body_raws = [c.raw_text for c in parsed_doc.body_citations]
        assert "[1d]" in body_raws
        assert "[4f]" in body_raws
        assert "[14g]" in body_raws
        assert "[24h]" not in body_raws
        assert "[5g]" not in body_raws

        for idx_b, bc in enumerate(parsed_doc.body_citations, start=1):
            bc.reference_id = f"occ-{idx_b:04d}"
        doc_links = CitationLinker().link(parsed_doc.body_citations, parsed_doc.references)
        status_by_raw = {
            occ.raw_text: [
                lk.status for lk in doc_links.links if lk.occurrence_id == occ.reference_id
            ]
            for occ in parsed_doc.body_citations
        }
        assert status_by_raw["[1d]"] == [CitationMappingStatus.MATCHED]
        assert status_by_raw["[4f]"] == [CitationMappingStatus.MATCHED]
        assert status_by_raw["[14g]"] == [CitationMappingStatus.MISSING_REFERENCE]

    def test_hybrid_merge_preserves_titleless_14b_alongside_earlier_same_author_year_entry(
        self,
    ) -> None:
        dp = DocumentParser()

        grobid_refs = [
            Citation(
                raw_text=f"{i}. Author{i}, A. Paper {i}. J. Org. Chem. 2019, 84, {i}0–{i}5.",
                citation_type=CitationType.REFERENCE_LIST,
                style=CitationStyle.ACS,
                authors=[f"Author{i}, A."],
                title=f"Paper {i}",
                venue="J. Org. Chem.",
                year="2019",
                numeric_index=i,
                order_index=i,
                source="grobid",
                grobid_ref_id=f"b{i - 1}",
            )
            for i in range(1, 5)
        ]
        # Entry 5: Title-less Smith, J. (2020) in GROBID
        grobid_refs.append(
            Citation(
                raw_text="5. Smith, J. J. Am. Chem. Soc. 2020, 142, 100–105.",
                citation_type=CitationType.REFERENCE_LIST,
                style=CitationStyle.ACS,
                authors=["Smith, J."],
                title=None,
                venue="J. Am. Chem. Soc.",
                year="2020",
                numeric_index=5,
                order_index=5,
                source="grobid",
                grobid_ref_id="b4",
            )
        )
        # Entry 14: Unexpanded composite in GROBID
        grobid_refs.append(
            Citation(
                raw_text="14. (a) Jones, A. Org. Lett. 2021, 23, 10–15; (b) Smith, J. Chem. Sci. 2020, 11, 200–205.",
                citation_type=CitationType.REFERENCE_LIST,
                style=CitationStyle.ACS,
                authors=["Jones, A."],
                title=None,
                venue="Org. Lett.",
                year="2021",
                numeric_index=14,
                order_index=6,
                source="grobid",
                grobid_ref_id="b13",
            )
        )

        regex_refs = [
            Citation(
                raw_text=g.raw_text,
                citation_type=CitationType.REFERENCE_LIST,
                style=CitationStyle.ACS,
                authors=list(g.authors),
                title=g.title,
                venue=g.venue,
                year=g.year,
                numeric_index=g.numeric_index,
                order_index=g.order_index,
                source="regex",
            )
            for g in grobid_refs[:5]
        ]
        regex_refs.extend(
            [
                Citation(
                    raw_text="(a) Jones, A. Org. Lett. 2021, 23, 10–15.",
                    citation_type=CitationType.REFERENCE_LIST,
                    style=CitationStyle.ACS,
                    authors=["Jones, A."],
                    title=None,
                    venue="Org. Lett.",
                    year="2021",
                    numeric_index=14,
                    sub_index="a",
                    composite_label="14a",
                    order_index=6,
                    source="regex",
                ),
                Citation(
                    raw_text="(b) Smith, J. Chem. Sci. 2020, 11, 200–205.",
                    citation_type=CitationType.REFERENCE_LIST,
                    style=CitationStyle.ACS,
                    authors=["Smith, J."],
                    title=None,
                    venue="Chem. Sci.",
                    year="2020",
                    numeric_index=14,
                    sub_index="b",
                    composite_label="14b",
                    order_index=7,
                    source="regex",
                ),
            ]
        )

        merged = dp._merge_reference_lists(grobid_refs, regex_refs)
        assert any(m.numeric_index == 5 and m.sub_index is None for m in merged)
        merged_14 = [m for m in merged if m.numeric_index == 14]
        assert [m.composite_label for m in merged_14] == ["14a", "14b"]


class TestFixRound3Regressions:
    """Regression suite covering all 5 structural fixes from Task 7 Fix Round 3."""

    def test_structural_iso4_journals_and_comma_venues_not_split_into_bogus_titles(
        self,
    ) -> None:
        parser = ReferenceListParser()
        checker = NeuroSymbolicChecker(enable_content_alignment=False)

        iso4_and_comma_cases = [
            (
                "14. (a) Y. Zhang and X. Liu, Org. Biomol. Chem., 2020, 18, 1234–1240, "
                "DOI: 10.1039/D0OB00111A; "
                "(b) L. Wang, ACS Cent. Sci., 2021, 7, 550–558, DOI: 10.1021/acscentsci.1c00222.",
                [
                    ("Org. Biomol. Chem.", "Organic & Biomolecular Chemistry", "10.1039/D0OB00111A", ["Y. Zhang", "X. Liu"], 2020),
                    ("ACS Cent. Sci.", "ACS Central Science", "10.1021/acscentsci.1c00222", ["L. Wang"], 2021),
                ],
            ),
            (
                "15. (a) Y. Zhang and X. Liu, ACS Sustain. Chem. Eng., 2020, 8, 1000–1010, "
                "DOI: 10.1021/acssuschemeng.0c00111; "
                "(b) L. Wang, Proc. Natl. Acad. Sci. U. S. A., 2021, 118, e2100111118, "
                "DOI: 10.1073/pnas.2100111118.",
                [
                    ("ACS Sustain. Chem. Eng.", "ACS Sustainable Chemistry & Engineering", "10.1021/acssuschemeng.0c00111", ["Y. Zhang", "X. Liu"], 2020),
                    ("Proc. Natl. Acad. Sci. U. S. A.", "Proceedings of the National Academy of Sciences", "10.1073/pnas.2100111118", ["L. Wang"], 2021),
                ],
            ),
            (
                "16. (a) Y. Zhang and X. Liu, Bioorg. Med. Chem. Lett., 2020, 30, 127001, "
                "DOI: 10.1016/j.bmcl.2020.127001; "
                "(b) L. Wang, Chin. J. Chem., 2021, 39, 550–556, DOI: 10.1002/cjoc.202000555.",
                [
                    ("Bioorg. Med. Chem. Lett.", "Bioorganic & Medicinal Chemistry Letters", "10.1016/j.bmcl.2020.127001", ["Y. Zhang", "X. Liu"], 2020),
                    ("Chin. J. Chem.", "Chinese Journal of Chemistry", "10.1002/cjoc.202000555", ["L. Wang"], 2021),
                ],
            ),
            (
                "17. (a) Y. Zhang and X. Liu, Angewandte Chemie, International Edition, 2020, 59, 1234–1240, "
                "DOI: 10.1002/anie.202000111; "
                "(b) L. Wang, Journal of the Chemical Society, Dalton Transactions, 1998, 5, 550–556, "
                "DOI: 10.1039/A800111A.",
                [
                    ("Angewandte Chemie, International Edition", "Angewandte Chemie International Edition", "10.1002/anie.202000111", ["Y. Zhang", "X. Liu"], 2020),
                    ("Journal of the Chemical Society, Dalton Transactions", "Journal of the Chemical Society, Dalton Transactions", "10.1039/A800111A", ["L. Wang"], 1998),
                ],
            ),
        ]

        for raw_entry, expected_subs in iso4_and_comma_cases:
            refs = parser.parse_reference_section(raw_entry, page_num=5)
            assert len(refs) == 2
            for ref, (exp_venue, full_venue, doi, cand_authors, cand_year) in zip(refs, expected_subs, strict=True):
                assert ref.title is None, f"Unexpected bogus title={ref.title!r} for {exp_venue!r}"
                assert ref.venue == exp_venue
                cand = SourceCandidate(
                    source_name="crossref",
                    found=True,
                    title="Total Synthesis and Mechanistic Investigation of Chiral Catalysts",
                    authors=cand_authors,
                    year=str(cand_year),
                    venue=full_venue,
                    doi=doi,
                    confidence=0.95,
                    score=1.0,
                )
                sr = SourceResult(
                    citation_raw=ref.raw_text,
                    candidates=[cand],
                    sources_queried=["crossref"],
                    sources_succeeded=["crossref"],
                )
                verdict = checker.check(ref, sr)
                assert verdict.label == ValidationLabel.VERIFIED, (
                    f"Expected VERIFIED for {exp_venue}, got {verdict.label} ({verdict.triggered_rules})"
                )

        # Meanwhile, unquoted sentences before . Journal MUST still split cleanly into title + venue
        titled_raw = (
            "18. (a) Y. Zhang and X. Liu, Quantum Gravity Hallucination. Chem. Sci., 2020, 11, 1234–1240; "
            "(b) L. Wang, Synthesis of Aryl Halides. Org. Biomol. Chem., 2021, 19, 550–556."
        )
        titled_refs = parser.parse_reference_section(titled_raw, page_num=5)
        assert len(titled_refs) == 2
        assert titled_refs[0].title == "Quantum Gravity Hallucination"
        assert titled_refs[0].venue == "Chem. Sci."
        assert titled_refs[1].title == "Synthesis of Aryl Halides"
        assert titled_refs[1].venue == "Org. Biomol. Chem."

    def test_structural_j_journal_disambiguation_and_surname_first_titleless_acs(
        self,
    ) -> None:
        parser = ReferenceListParser()
        checker = NeuroSymbolicChecker(enable_content_alignment=False)

        raw_bib = (
            "14. (a) Zhang, Y.; Liu, X. J. Organomet. Chem. 2020, 910, 121123. DOI: 10.1016/j.jorganchem.2020.121123; "
            "(b) Wang, L. J. Comput. Chem. 2021, 42, 550–558. DOI: 10.1002/jcc.26475.\n"
            "15. (a) Smith, J. A.; Doe, B. J. Agric. Food Chem. 2020, 68, 1000–1008. DOI: 10.1021/acs.jafc.0c00111; "
            "(b) Chen, M. J. Colloid Interface Sci. 2021, 585, 200–209. DOI: 10.1016/j.jcis.2020.11.001.\n"
            "16. (a) Zhang, Y.; Liu, X. Angew. Chem. Int. Ed. 2020, 59, 1234–1240. DOI: 10.1002/anie.202000111; "
            "(b) Zhang, Y.; Liu, X. Org. Biomol. Chem. 2020, 18, 1234–1240. DOI: 10.1039/D0OB00111A.\n"
            "17. van Leeuwen, P. W. N. M. Chem. Rev. 2011, 111, 2077–2118. DOI: 10.1021/cr1002497.\n"
            "18. Doe, A. J. Synthesis of Aryl Halides. J. Organomet. Chem. 2020, 910, 121999."
        )
        refs = parser.parse_reference_section(raw_bib, page_num=6)
        assert len(refs) == 8

        expected_titleless = [
            (refs[0], ["zhang", "liu"], "J. Organomet. Chem.", "Journal of Organometallic Chemistry", "10.1016/j.jorganchem.2020.121123", ["Y. Zhang", "X. Liu"], 2020),
            (refs[1], ["wang"], "J. Comput. Chem.", "Journal of Computational Chemistry", "10.1002/jcc.26475", ["L. Wang"], 2021),
            (refs[2], ["smith", "doe"], "J. Agric. Food Chem.", "Journal of Agricultural and Food Chemistry", "10.1021/acs.jafc.0c00111", ["J. A. Smith", "B. Doe"], 2020),
            (refs[3], ["chen"], "J. Colloid Interface Sci.", "Journal of Colloid and Interface Science", "10.1016/j.jcis.2020.11.001", ["M. Chen"], 2021),
            (refs[4], ["zhang", "liu"], "Angew. Chem. Int. Ed.", "Angewandte Chemie International Edition", "10.1002/anie.202000111", ["Y. Zhang", "X. Liu"], 2020),
            (refs[5], ["zhang", "liu"], "Org. Biomol. Chem.", "Organic & Biomolecular Chemistry", "10.1039/D0OB00111A", ["Y. Zhang", "X. Liu"], 2020),
            (refs[6], ["van leeuwen"], "Chem. Rev.", "Chemical Reviews", "10.1021/cr1002497", ["P. W. N. M. van Leeuwen"], 2011),
        ]
        for ref, exp_last, exp_venue, full_venue, doi, cand_authors, cand_year in expected_titleless:
            assert [a.last_name for a in ref.authors] == exp_last
            assert (ref.venue or "").rstrip(".") == exp_venue.rstrip(".")
            if ref.sub_index is not None:
                assert ref.title is None
            cand = SourceCandidate(
                source_name="crossref",
                found=True,
                title="Ligand Effects in Transition-Metal Homogeneous Catalysis",
                authors=cand_authors,
                year=str(cand_year),
                venue=full_venue,
                doi=doi,
                confidence=0.95,
                score=1.0,
            )
            sr = SourceResult(
                citation_raw=ref.raw_text,
                candidates=[cand],
                sources_queried=["crossref"],
                sources_succeeded=["crossref"],
            )
            verdict = checker.check(ref, sr)
            assert verdict.label == ValidationLabel.VERIFIED

        # Entry 18: Author final initial J. followed by unquoted article title before J. Organomet. Chem.
        assert [a.last_name for a in refs[7].authors] == ["doe"]
        assert refs[7].title == "Synthesis of Aryl Halides"
        assert (refs[7].venue or "").rstrip(".") == "J. Organomet. Chem"

        # Lone surname-first (a) entry with Angew. Chem. Int. Ed. keeps title=None and full venue
        lone_angew = parser.parse_single_entry(
            "14. (a) Zhang, Y.; Liu, X. Angew. Chem. Int. Ed. 2020, 59, 1234–1240. DOI: 10.1002/anie.202000111",
            order_index=14,
            page_num=6,
        )
        assert lone_angew is not None
        assert lone_angew.title is None
        assert (lone_angew.venue or "").rstrip(".") == "Angew. Chem. Int. Ed"

    def test_lone_sub_marker_prefix_cross_domain_cvpr_doi_and_empty_venue_zenodo_doi(
        self,
    ) -> None:
        parser = ReferenceListParser()
        checker = NeuroSymbolicChecker(enable_content_alignment=False)

        # (a) Lone (a) prefix with bogus unquoted title before . Journal (both RSC and surname-first ACS)
        for lone_raw in (
            "14. (a) Y. Zhang and X. Liu, Quantum Gravity Hallucination. Chem. Sci., 2020, 11, 1234–1240, DOI: 10.1039/D0SC00111A",
            "14. (a) Zhang, Y.; Liu, X. Quantum Gravity Hallucination. Chem. Sci. 2020, 11, 1234–1240, DOI: 10.1039/D0SC00111A",
        ):
            lone_ref = parser.parse_single_entry(lone_raw, order_index=14, page_num=5)
            assert lone_ref is not None
            assert lone_ref.title == "Quantum Gravity Hallucination"
            assert (lone_ref.venue or "").rstrip(".") == "Chem. Sci"
            real_chem_cand = SourceCandidate(
                source_name="crossref",
                found=True,
                title="Visible-Light Photoredox Cross-Coupling of Aryl Chlorides",
                authors=["Y. Zhang", "X. Liu"],
                year="2020",
                venue="Chemical Science",
                doi="10.1039/D0SC00111A",
                confidence=0.95,
                score=1.0,
            )
            sr_lone = SourceResult(
                citation_raw=lone_ref.raw_text,
                candidates=[real_chem_cand],
                sources_queried=["crossref"],
                sources_succeeded=["crossref"],
            )
            v_lone = checker.check(lone_ref, sr_lone)
            assert v_lone.label == ValidationLabel.SUSPECTED_HALLUCINATION
            assert "R-CHIMERIC-DOI-MISMATCH" in v_lone.triggered_rules

        # Defense-in-depth in rules.py: even if a fallback Citation had title == venue with unparsed sentence in raw_text
        fallback_cit = Citation(
            raw_text="14. (a) Y. Zhang and X. Liu, Quantum Gravity Hallucination. Chem. Sci., 2020",
            citation_type=CitationType.REFERENCE_LIST,
            style=CitationStyle.ACS,
            authors=["Y. Zhang", "X. Liu"],
            year="2020",
            title="Chem. Sci.",
            venue="Chem. Sci.",
            doi="10.1039/D0SC00111A",
        )
        v_fb = checker.check(
            fallback_cit,
            SourceResult(
                citation_raw=fallback_cit.raw_text,
                candidates=[real_chem_cand],
                sources_queried=["crossref"],
                sources_succeeded=["crossref"],
            ),
        )
        assert v_fb.label == ValidationLabel.SUSPECTED_HALLUCINATION
        assert "R-CHIMERIC-DOI-MISMATCH" in v_fb.triggered_rules

        # (b) Cross-domain CVPR DOI spliced onto Chem. Sci. with same-name common authors + same year
        cvpr_raw = (
            "14. (a) Y. Zhang and X. Liu, Chem. Sci., 2020, 11, 1234–1240, "
            "DOI: 10.1109/CVPR42600.2020.00123"
        )
        cvpr_ref = parser.parse_single_entry(cvpr_raw, order_index=14, page_num=5)
        assert cvpr_ref is not None
        cvpr_cand = SourceCandidate(
            source_name="crossref",
            found=True,
            title="Deep Feature Calibration for Object Detection",
            authors=["Y. Zhang", "X. Liu"],
            year="2020",
            venue="2020 IEEE/CVF Conference on Computer Vision and Pattern Recognition (CVPR)",
            doi="10.1109/CVPR42600.2020.00123",
            confidence=0.95,
            score=1.0,
        )
        sr_cvpr = SourceResult(
            citation_raw=cvpr_ref.raw_text,
            candidates=[cvpr_cand],
            sources_queried=["crossref"],
            sources_succeeded=["crossref"],
        )
        v_cvpr = checker.check(cvpr_ref, sr_cvpr)
        assert v_cvpr.label == ValidationLabel.SUSPECTED_HALLUCINATION
        assert "R-CHIMERIC-DOI-MISMATCH" in v_cvpr.triggered_rules

        # (c) Zenodo DOI with empty cand.venue spliced onto Chem. Sci.
        zenodo_raw = (
            "14. (a) Y. Zhang and X. Liu, Chem. Sci., 2020, 11, 1234–1240, "
            "DOI: 10.5281/zenodo.3900123"
        )
        zenodo_ref = parser.parse_single_entry(zenodo_raw, order_index=14, page_num=5)
        assert zenodo_ref is not None
        zenodo_cand = SourceCandidate(
            source_name="crossref",
            found=True,
            title="PyTorch ImageNet Checkpoint Weights v1.0",
            authors=["Y. Zhang", "X. Liu"],
            year="2020",
            venue=None,
            doi="10.5281/zenodo.3900123",
            confidence=0.95,
            score=1.0,
        )
        sr_zenodo = SourceResult(
            citation_raw=zenodo_ref.raw_text,
            candidates=[zenodo_cand],
            sources_queried=["crossref"],
            sources_succeeded=["crossref"],
        )
        v_zenodo = checker.check(zenodo_ref, sr_zenodo)
        assert v_zenodo.label == ValidationLabel.SUSPECTED_HALLUCINATION
        assert "R-CHIMERIC-DOI-MISMATCH" in v_zenodo.triggered_rules

    def test_ieee_numeric_a_to_z_siblings_and_bibliography_pre_header_body_rescue(
        self, tmp_path
    ) -> None:
        extractor = CitationExtractor(preserve_occurrences=True)
        sibling_hits = extractor.extract_from_text(
            "Prior studies [14a], [14b], [14c], and [14g] were extended [14a–g].",
            page_num=1,
        )
        assert [c.raw_text for c in sibling_hits] == [
            "[14a]",
            "[14b]",
            "[14c]",
            "[14g]",
            "[14a–g]",
        ]

        # Standalone units/dimensions without sibling [Na]/[Nb]/[Nc] remain blocked
        unit_hits = extractor.extract_from_text(
            "Stirred for [24h] at [10m] scale with [5g] catalyst in [3d] space for [30s].",
            page_num=1,
        )
        assert unit_hits == []

        # 1-page note where body sits above References (SectionType.BIBLIOGRAPHY pre_header_body_text)
        dummy_pdf = tmp_path / "one_page_note.pdf"
        dummy_pdf.write_bytes(b"%PDF-1.4 dummy")
        one_page_doc = Document(
            file_path=str(dummy_pdf),
            num_pages=1,
            parser_used="mupdf",
            pages=[
                Page(
                    page_num=1,
                    text=(
                        "Catalytic cross-coupling was demonstrated in seminal reports (14b) "
                        "and extended to [1d] and [14g] under mild photoredox conditions.\n"
                        "References\n"
                        "[1] (a) Alpha, A. Org. Lett. 2018, 20, 10–12; "
                        "(b) Beta, B. Org. Lett. 2019, 21, 20–22; "
                        "(c) Gamma, C. Org. Lett. 2020, 22, 30–32; "
                        "(d) Delta, D. Org. Lett. 2021, 23, 40–42.\n"
                        "[14] (a) Zhang, Y. Chem. Sci. 2020, 11, 100–105; "
                        "(b) Wang, L. Chem. Sci. 2021, 12, 200–205."
                    ),
                    has_text_layer=True,
                )
            ],
            metadata={},
        )
        mock_mupdf = MagicMock()
        mock_mupdf.parse.return_value = one_page_doc
        dp = DocumentParser(mupdf_parser=mock_mupdf)
        dp._load_grobid_tei = MagicMock(return_value=None)  # type: ignore[method-assign]
        parsed = dp.parse(str(dummy_pdf), use_service_manager=False)
        body_raws = [c.raw_text for c in parsed.body_citations]
        assert "(14b)" in body_raws
        assert "[1d]" in body_raws
        assert "[14g]" in body_raws

    def test_bracket_non_citation_labels_and_equations_rejected(self, tmp_path) -> None:
        false_pos_text = (
            "Compound [1d] gave 95% yield, Compounds [1a] and [1b] decomposed, "
            "whereas Figure [1a] and Scheme [1b] show the spectra:\n"
            "k_obs = k_1 [A]   [1a]"
        )
        extractor = CitationExtractor(preserve_occurrences=True)
        assert extractor.extract_from_text(false_pos_text, page_num=1) == []

        dummy_pdf = tmp_path / "chem_brackets.pdf"
        dummy_pdf.write_bytes(b"%PDF-1.4 dummy")
        doc = Document(
            file_path=str(dummy_pdf),
            num_pages=2,
            parser_used="mupdf",
            pages=[
                Page(
                    page_num=1,
                    text=false_pos_text + "\n\nPrior reports [1a] and [1d] confirmed the mechanism.",
                    has_text_layer=True,
                ),
                Page(
                    page_num=2,
                    text=(
                        "References\n"
                        "[1] (a) Alpha, A. J. Am. Chem. Soc. 2018, 140, 10–15; "
                        "(b) Beta, B. J. Am. Chem. Soc. 2019, 141, 20–25; "
                        "(c) Gamma, C. J. Am. Chem. Soc. 2020, 142, 30–35; "
                        "(d) Delta, D. J. Am. Chem. Soc. 2021, 143, 40–45."
                    ),
                    has_text_layer=True,
                ),
            ],
            metadata={},
        )
        mock_mupdf = MagicMock()
        mock_mupdf.parse.return_value = doc
        dp = DocumentParser(mupdf_parser=mock_mupdf)
        dp._load_grobid_tei = MagicMock(return_value=None)  # type: ignore[method-assign]
        parsed = dp.parse(str(dummy_pdf), use_service_manager=False)
        assert [c.raw_text for c in parsed.body_citations] == ["[1a]", "[1d]"]

