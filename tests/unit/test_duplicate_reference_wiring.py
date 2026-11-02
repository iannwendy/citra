"""Task 1.1 — DuplicateDetector wired into CitationLinker + pipeline.

DUPLICATE_REFERENCE must actually be emitted for duplicate bibliography
entries (exact DOI / arXiv ID or high title+author+year similarity), never for
legitimately distinct works (2020a/2020b, different editions/volumes/DOIs),
and the CIS rubric penalty must apply end-to-end.
"""

from __future__ import annotations

import pytest

from integrity_checker.extraction.base import Document
from integrity_checker.extraction.document_parser import ParsedDocument
from integrity_checker.linking import CitationLinker, DuplicateDetector
from integrity_checker.linking.statuses import CitationMappingStatus, LinkingResult
from integrity_checker.logic.cis import CISCalculator
from integrity_checker.models.citation import Citation, CitationStyle, CitationType
from integrity_checker.models.source import SourceCandidate, SourceResult
from integrity_checker.models.validation import CitationVerdict, ValidationLabel
from integrity_checker.pipeline.integrity_pipeline import IntegrityPipeline

DUP = CitationMappingStatus.DUPLICATE_REFERENCE.value


def ref(
    raw: str,
    *,
    authors: list[str] | None = None,
    year: str | None = None,
    title: str | None = None,
    doi: str | None = None,
    numeric_index: int | None = None,
) -> Citation:
    return Citation(
        raw_text=raw,
        citation_type=CitationType.REFERENCE_LIST,
        style=CitationStyle.APA if numeric_index is None else CitationStyle.IEEE,
        authors=authors or [],
        year=year,
        title=title,
        title_normalized=(title or "").lower() or None,
        doi=doi,
        numeric_index=numeric_index,
    )


def intext(raw: str, ctype: CitationType = CitationType.IN_TEXT) -> Citation:
    return Citation(
        raw_text=raw,
        citation_type=ctype,
        style=CitationStyle.APA if ctype == CitationType.IN_TEXT else CitationStyle.IEEE,
    )


def _ids(bibs: list[Citation]) -> list[Citation]:
    for i, b in enumerate(bibs, start=1):
        b.reference_id = f"ref-{i:04d}"
    return bibs


# ---------------------------------------------------------------------------
# Linker-level behaviour
# ---------------------------------------------------------------------------


class TestLinkerEmitsDuplicateReference:
    def test_exact_doi_duplicate_flagged_on_second_entry(self):
        bibs = _ids([
            ref("Vaswani, A., Shazeer, N. (2017). Attention is all you need. NeurIPS. "
                "https://doi.org/10.48550/arXiv.1706.03762",
                authors=["Vaswani, A.", "Shazeer, N."], year="2017",
                title="Attention is all you need", doi="10.48550/arXiv.1706.03762"),
            ref("LeCun, Y., Bengio, Y., Hinton, G. (2015). Deep learning. Nature, 521, 436-444.",
                authors=["LeCun, Y.", "Bengio, Y.", "Hinton, G."], year="2015",
                title="Deep learning", doi="10.1038/nature14539"),
            ref("Vaswani, A. et al. (2017). Attention Is All You Need. "
                "doi:10.48550/ARXIV.1706.03762",
                authors=["Vaswani, A."], year="2017",
                title="Attention Is All You Need", doi="https://doi.org/10.48550/ARXIV.1706.03762"),
        ])
        body = [intext("(Vaswani et al., 2017)"), intext("(LeCun et al., 2015)")]
        result = CitationLinker().link(body, bibs)

        assert bibs[0].mapping_status == CitationMappingStatus.MATCHED.value
        assert bibs[1].mapping_status == CitationMappingStatus.MATCHED.value
        assert bibs[2].mapping_status == DUP
        assert result.duplicate_reference_ids == ["ref-0003"]
        # The redundant entry is penalised as duplicate, not additionally as uncited.
        assert "ref-0003" not in result.unmatched_reference_ids
        assert result.status_counts[CitationMappingStatus.DUPLICATE_REFERENCE] == 1
        group = result.duplicate_groups[0]
        assert group["canonical_reference_id"] == "ref-0001"
        assert set(group["reference_ids"]) == {"ref-0001", "ref-0003"}
        assert "doi" in group["reason"].lower()

    def test_arxiv_id_duplicate_between_preprint_and_datacite_doi(self):
        bibs = _ids([
            ref("Devlin, J. (2018). BERT: Pre-training of deep bidirectional transformers. "
                "arXiv:1810.04805", authors=["Devlin, J."], year="2018",
                title="BERT: Pre-training of deep bidirectional transformers"),
            ref("Devlin, J. et al. (2018). BERT. https://doi.org/10.48550/arXiv.1810.04805v2",
                authors=["Devlin, J."], year="2018", title="BERT"),
        ])
        result = CitationLinker().link([intext("(Devlin, 2018)")], bibs)
        assert result.duplicate_reference_ids == ["ref-0002"]
        assert bibs[1].mapping_status == DUP

    def test_similarity_duplicate_vietnamese_reference(self):
        bibs = _ids([
            ref("Nguyễn, V. A. (2019). Ứng dụng học sâu trong xử lý ngôn ngữ tự nhiên tiếng Việt. "
                "Tạp chí Khoa học, 12(3), 1-10.",
                authors=["Nguyễn, V. A."], year="2019",
                title="Ứng dụng học sâu trong xử lý ngôn ngữ tự nhiên tiếng Việt"),
            ref("Nguyễn, V. A. (2019). Ứng dụng học sâu trong xử lý ngôn ngữ tự nhiên tiếng Việt. "
                "Tạp chí Khoa học.",
                authors=["Nguyễn, V. A."], year="2019",
                title="Ứng dụng học sâu trong xử lý ngôn ngữ tự nhiên tiếng Việt"),
        ])
        result = CitationLinker().link([intext("(Nguyễn, 2019)")], bibs)
        assert result.duplicate_reference_ids == ["ref-0002"]

    def test_cited_member_becomes_canonical(self):
        """If only the later copy is cited, the earlier uncited copy is the duplicate."""
        bibs = _ids([
            ref("[1] A. Smith, \"Graph neural networks for chemistry,\" 2021, doi:10.1/gnn.",
                authors=["A. Smith"], year="2021", title="Graph neural networks for chemistry",
                doi="10.1/gnn", numeric_index=1),
            ref("[2] B. Jones, \"Protein folding,\" 2020.", authors=["B. Jones"], year="2020",
                title="Protein folding", numeric_index=2),
            ref("[3] A. Smith, \"Graph neural networks for chemistry,\" 2021, doi:10.1/GNN.",
                authors=["A. Smith"], year="2021", title="Graph neural networks for chemistry",
                doi="10.1/GNN", numeric_index=3),
        ])
        body = [intext("[2]", CitationType.NUMERIC), intext("[3]", CitationType.NUMERIC)]
        result = CitationLinker().link(body, bibs)
        assert bibs[2].mapping_status == CitationMappingStatus.MATCHED.value
        assert bibs[0].mapping_status == DUP
        assert result.duplicate_reference_ids == ["ref-0001"]
        assert result.unmatched_reference_ids == []
        assert result.duplicate_groups[0]["canonical_reference_id"] == "ref-0003"

    def test_detection_can_be_disabled(self):
        bibs = _ids([
            ref("A (2020). T. doi:10.1/x", authors=["A"], year="2020", title="T", doi="10.1/x"),
            ref("A (2020). T. doi:10.1/x", authors=["A"], year="2020", title="T", doi="10.1/x"),
        ])
        result = CitationLinker(detect_duplicates=False).link([], bibs)
        assert result.duplicate_reference_ids == []
        assert all(b.mapping_status != DUP for b in bibs)

    def test_injected_detector_threshold_is_respected(self):
        bibs = _ids([
            ref("Smith, J. (2020). Deep learning for medical image segmentation.",
                authors=["Smith, J."], year="2020",
                title="Deep learning for medical image segmentation"),
            ref("Smith, J. (2020). Deep learning for medical image analysis.",
                authors=["Smith, J."], year="2020",
                title="Deep learning for medical image analysis"),
        ])
        strict = CitationLinker(duplicate_detector=DuplicateDetector(title_year_author_similarity=0.99))
        assert strict.link([], bibs).duplicate_reference_ids == []

    def test_to_dict_exposes_duplicates(self):
        bibs = _ids([
            ref("A (2020). T. doi:10.1/x", authors=["A"], year="2020", title="T", doi="10.1/x"),
            ref("A (2020). T. doi:10.1/x", authors=["A"], year="2020", title="T", doi="10.1/x"),
        ])
        d = CitationLinker().link([], bibs).to_dict()
        assert d["duplicate_reference_ids"] == ["ref-0002"]
        assert d["status_counts"]["duplicate_reference"] == 1


class TestNoFalseDuplicates:
    def test_year_suffix_a_b_are_distinct(self):
        bibs = _ids([
            ref("Smith, J. (2020a). Deep learning for medical image segmentation. Journal A.",
                authors=["Smith, J."], year="2020",
                title="Deep learning for medical image segmentation"),
            ref("Smith, J. (2020b). Deep learning for medical image segmentation: A review. Journal B.",
                authors=["Smith, J."], year="2020",
                title="Deep learning for medical image segmentation a review"),
        ])
        body = [intext("(Smith, 2020a)"), intext("(Smith, 2020b)")]
        result = CitationLinker().link(body, bibs)
        assert result.duplicate_reference_ids == []
        assert all(b.mapping_status != DUP for b in bibs)

    def test_different_editions_are_distinct(self):
        bibs = _ids([
            ref("Russell, S., & Norvig, P. (2010). Artificial intelligence: A modern approach "
                "(3rd ed.). Pearson.", authors=["Russell, S.", "Norvig, P."], year="2010",
                title="Artificial intelligence a modern approach"),
            ref("Russell, S., & Norvig, P. (2010). Artificial intelligence: A modern approach "
                "(2nd ed.). Prentice Hall.", authors=["Russell, S.", "Norvig, P."], year="2010",
                title="Artificial intelligence a modern approach"),
        ])
        assert CitationLinker().link([], bibs).duplicate_reference_ids == []

    def test_vietnamese_reprints_are_distinct(self):
        bibs = _ids([
            ref("Trần, V. (2015). Giáo trình kinh tế vĩ mô (tái bản lần thứ 2). NXB Giáo dục.",
                authors=["Trần, V."], year="2015", title="Giáo trình kinh tế vĩ mô"),
            ref("Trần, V. (2015). Giáo trình kinh tế vĩ mô (tái bản lần thứ 3). NXB Giáo dục.",
                authors=["Trần, V."], year="2015", title="Giáo trình kinh tế vĩ mô"),
        ])
        assert CitationLinker().link([], bibs).duplicate_reference_ids == []

    def test_different_volumes_are_distinct(self):
        bibs = _ids([
            ref("Knuth, D. (1997). The art of computer programming, Vol. 1. Addison-Wesley.",
                authors=["Knuth, D."], year="1997", title="The art of computer programming"),
            ref("Knuth, D. (1997). The art of computer programming, Vol. 2. Addison-Wesley.",
                authors=["Knuth, D."], year="1997", title="The art of computer programming"),
        ])
        assert CitationLinker().link([], bibs).duplicate_reference_ids == []

    def test_same_title_different_dois_are_distinct(self):
        bibs = _ids([
            ref("Lee, K. (2021). Federated learning. In Proc. A. doi:10.1/a",
                authors=["Lee, K."], year="2021", title="Federated learning", doi="10.1/a"),
            ref("Lee, K. (2021). Federated learning. In Proc. B. doi:10.1/b",
                authors=["Lee, K."], year="2021", title="Federated learning", doi="10.1/b"),
        ])
        assert CitationLinker().link([], bibs).duplicate_reference_ids == []

    def test_same_title_different_years_are_distinct(self):
        bibs = _ids([
            ref("WHO (2019). World health statistics.", authors=["WHO"], year="2019",
                title="World health statistics"),
            ref("WHO (2020). World health statistics.", authors=["WHO"], year="2020",
                title="World health statistics"),
        ])
        assert CitationLinker().link([], bibs).duplicate_reference_ids == []

    def test_realistic_reference_list_has_no_duplicates(self):
        bibs = _ids([
            ref("Brown, T. et al. (2020). Language models are few-shot learners. NeurIPS.",
                authors=["Brown, T."], year="2020", title="Language models are few-shot learners"),
            ref("Devlin, J. et al. (2019). BERT: Pre-training of deep bidirectional transformers "
                "for language understanding. NAACL.", authors=["Devlin, J."], year="2019",
                title="BERT pre-training of deep bidirectional transformers for language understanding"),
            ref("He, K. et al. (2016). Deep residual learning for image recognition. CVPR.",
                authors=["He, K."], year="2016", title="Deep residual learning for image recognition"),
            ref("He, K. et al. (2016). Identity mappings in deep residual networks. ECCV.",
                authors=["He, K."], year="2016", title="Identity mappings in deep residual networks"),
            ref("Lê, T. H. (2020). Phân tích dữ liệu lớn trong giáo dục. NXB ĐHQG.",
                authors=["Lê, T. H."], year="2020", title="Phân tích dữ liệu lớn trong giáo dục"),
        ])
        body = [intext("(Brown et al., 2020)"), intext("(He et al., 2016)")]
        result = CitationLinker().link(body, bibs)
        assert result.duplicate_reference_ids == []
        assert result.duplicate_groups == []


# ---------------------------------------------------------------------------
# CIS penalty
# ---------------------------------------------------------------------------


def _verified(c: Citation, mapping: CitationMappingStatus) -> CitationVerdict:
    return CitationVerdict(citation=c, label=ValidationLabel.VERIFIED, confidence=0.95,
                           mapping_status=mapping)


class TestCisDuplicatePenalty:
    def test_duplicate_verdict_lowers_link_consistency(self):
        a, b = ref("A"), ref("B")
        base = LinkingResult(total_citations=1, total_references=2)
        clean = CISCalculator().compute(
            [_verified(a, CitationMappingStatus.MATCHED), _verified(b, CitationMappingStatus.MATCHED)],
            linking_result=base,
        )
        dup = CISCalculator().compute(
            [_verified(a, CitationMappingStatus.MATCHED),
             _verified(b, CitationMappingStatus.DUPLICATE_REFERENCE)],
            linking_result=LinkingResult(total_citations=1, total_references=2,
                                         duplicate_reference_ids=["ref-0002"]),
        )
        assert dup.components.in_text_bib_consistency < 1.0
        assert dup.score < clean.score or clean.components.in_text_bib_consistency == 1.0

    def test_linker_duplicates_counted_without_verdict_mapping(self):
        lr = LinkingResult(total_citations=0, total_references=2,
                           duplicate_reference_ids=["ref-0002"])
        value = CISCalculator._compute_link_consistency([], lr)
        assert value < 1.0


# ---------------------------------------------------------------------------
# End-to-end pipeline (mock retrieval + checker)
# ---------------------------------------------------------------------------


class _FakeOrchestrator:
    def __init__(self) -> None:
        self.calls: list[str] = []

    async def retrieve(self, citation: Citation) -> SourceResult:
        self.calls.append(citation.raw_text)
        return SourceResult(
            citation_raw=citation.raw_text,
            candidates=[SourceCandidate(source_name="crossref", found=True,
                                        title=citation.title, doi=citation.doi,
                                        year=int(citation.year) if citation.year else None)],
            sources_queried=["crossref"],
            sources_succeeded=["crossref"],
            sources_failed={},
        )


class _VerifyingChecker:
    def check(self, citation, source, **kwargs):
        return CitationVerdict(citation=citation, label=ValidationLabel.VERIFIED,
                               confidence=0.95, matched_source=source)


def _parsed_doc() -> ParsedDocument:
    refs = [
        ref("Vaswani, A., Shazeer, N. (2017). Attention is all you need. NeurIPS. "
            "https://doi.org/10.48550/arXiv.1706.03762",
            authors=["Vaswani, A.", "Shazeer, N."], year="2017",
            title="Attention is all you need", doi="10.48550/arXiv.1706.03762"),
        ref("LeCun, Y., Bengio, Y., Hinton, G. (2015). Deep learning. Nature, 521, 436-444. "
            "https://doi.org/10.1038/nature14539",
            authors=["LeCun, Y.", "Bengio, Y.", "Hinton, G."], year="2015",
            title="Deep learning", doi="10.1038/nature14539"),
        ref("Vaswani, A. et al. (2017). Attention is all you need. Advances in NIPS 30. "
            "doi:10.48550/arxiv.1706.03762",
            authors=["Vaswani, A."], year="2017",
            title="Attention is all you need", doi="10.48550/arxiv.1706.03762"),
    ]
    body = [intext("(Vaswani et al., 2017)"), intext("(LeCun et al., 2015)")]
    return ParsedDocument(
        document=Document(file_path="/fake/dup.pdf", num_pages=3, pages=[]),
        body_citations=body,
        references=refs,
        appendix_citations=[],
        sections=[],
        parser_warnings=[],
    )


def _pipeline(linker: CitationLinker | None = None) -> tuple[IntegrityPipeline, _FakeOrchestrator]:
    from unittest.mock import MagicMock

    parser = MagicMock()
    parser.parse.return_value = _parsed_doc()
    orch = _FakeOrchestrator()
    pipe = IntegrityPipeline(
        document_parser=parser,
        use_document_parser=True,
        orchestrator=orch,
        checker=_VerifyingChecker(),
        cis_calc=CISCalculator(),
        linker=linker,
    )
    return pipe, orch


class TestPipelineEndToEnd:
    @pytest.mark.asyncio
    async def test_report_contains_duplicate_reference_verdict(self):
        pipe, orch = _pipeline()
        report = await pipe.run_async("/fake/dup.pdf", essay_id=7)

        statuses = {
            v.citation.reference_id: getattr(v.mapping_status, "value", v.mapping_status)
            for v in report.verdicts
        }
        assert statuses.get("ref-0003") == DUP
        assert statuses.get("ref-0001") == CitationMappingStatus.MATCHED.value
        assert statuses.get("ref-0002") == CitationMappingStatus.MATCHED.value
        assert report.linking_summary.get("duplicate_reference") == 1
        # Duplicate shares the canonical retrieval — no extra API call.
        assert len(orch.calls) == 2
        payload = report.to_dict()
        assert any(v.get("mapping_status") == DUP for v in payload["verdicts"])

    @pytest.mark.asyncio
    async def test_cis_penalised_compared_to_detection_disabled(self):
        pipe_on, _ = _pipeline()
        pipe_off, _ = _pipeline(CitationLinker(detect_duplicates=False))
        with_dup = await pipe_on.run_async("/fake/dup.pdf", essay_id=1)
        without = await pipe_off.run_async("/fake/dup.pdf", essay_id=2)
        assert with_dup.cis is not None and without.cis is not None
        assert (
            with_dup.cis.components.in_text_bib_consistency
            < without.cis.components.in_text_bib_consistency
        )
        assert with_dup.cis.score < without.cis.score
