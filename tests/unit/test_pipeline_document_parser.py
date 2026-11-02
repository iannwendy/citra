"""Unit test cho IntegrityPipeline với DocumentParser integration (task #25).

Test cả 2 path:
- Modern: DocumentParser (PyMuPDF + GROBID) — khi use_document_parser=True
- Legacy: BasePDFParser + CitationExtractor + ReferenceListParser — fallback

Verify:
- _merge_citations dedupe đúng (priority ref > body > appendix)
- use_document_parser=False → fallback legacy flow
- use_document_parser=True → gọi DocumentParser.parse()
- num_pages, num_citations populated
- verdicts generated per citation
- CIS computed
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from integrity_checker.extraction.base import Document
from integrity_checker.extraction.document_parser import ParsedDocument
from integrity_checker.models.citation import (
    Citation,
    CitationStyle,
    CitationType,
)
from integrity_checker.pipeline.integrity_pipeline import (
    AnalysisReport,
    IntegrityPipeline,
)


def _make_citation(
    raw_text: str, title: str | None = None, year: str | None = None,
    citation_type: CitationType | None = None,
) -> Citation:
    """Build minimal Citation cho test."""
    return Citation(
        raw_text=raw_text,
        citation_type=citation_type or CitationType.IN_TEXT,
        style=CitationStyle.APA,
        title=title,
        year=year,
    )


class TestPipelineMergeCitations:
    """Test _merge_citations cho modern flow."""

    def test_merge_priority_ref_over_body_over_appendix(self):
        """References ưu tiên (có title), sau đó body, cuối cùng appendix."""
        ref = _make_citation("Smith, J. (2020). A study. Journal A.", title="A study", year="2020")
        body = _make_citation("(Smith, 2020)")
        appendix = _make_citation("(Smith, 2020)")  # duplicate of body

        merged = IntegrityPipeline._merge_citations(
            body=[body], references=[ref], appendix=[appendix]
        )
        assert len(merged) == 2
        # Reference đầu tiên (priority)
        assert merged[0].title == "A study"
        # Body ở vị trí 2 (dedupe vs appendix giống raw_text)
        assert merged[1].raw_text == "(Smith, 2020)"

    def test_merge_dedupe_by_raw_text(self):
        """Citation trùng raw_text → chỉ giữ 1."""
        a = _make_citation("Smith, J. (2020).")
        b = _make_citation("Smith, J. (2020).")
        merged = IntegrityPipeline._merge_citations(
            body=[a], references=[b], appendix=[]
        )
        assert len(merged) == 1

    def test_merge_empty_inputs(self):
        """Empty lists → empty output."""
        merged = IntegrityPipeline._merge_citations(body=[], references=[], appendix=[])
        assert merged == []


class TestPipelineLegacyMerge:
    """Test _merge_citations_legacy cho fallback flow."""

    def test_legacy_merge_priority_ref(self):
        ref = _make_citation("Smith, J. (2020).", title="A study")
        body = _make_citation("(Smith, 2020)")
        merged = IntegrityPipeline._merge_citations_legacy(in_text=[body], ref_list=[ref])
        assert len(merged) == 2
        # Reference đầu tiên
        assert merged[0].title == "A study"


class TestPipelineWithDocumentParser:
    """Test pipeline.run_async() với DocumentParser mocked."""

    @pytest.mark.asyncio
    async def test_pipeline_uses_document_parser_when_enabled(self):
        """use_document_parser=True → gọi DocumentParser.parse()."""
        # Mock DocumentParser
        body_cit = _make_citation("(Smith, 2020)")
        # FIX v1.7: ref must be REFERENCE_LIST to be verifiable
        ref_cit = _make_citation(
            "Smith, J. (2020). A study.", title="A study", year="2020",
            citation_type=CitationType.REFERENCE_LIST
        )
        parsed = ParsedDocument(
            document=Document(file_path="/fake/path.pdf", num_pages=5, pages=[]),
            body_citations=[body_cit],
            references=[ref_cit],
            appendix_citations=[],
            sections=[],
            parser_warnings=[],
        )

        mock_doc_parser = MagicMock()
        mock_doc_parser.parse.return_value = parsed

        # Mock orchestrator + checker để tránh network calls
        mock_orchestrator = MagicMock()

        async def mock_retrieve(citation):
            from integrity_checker.models.source import SourceCandidate, SourceResult
            return SourceResult(
                citation_raw=citation.raw_text,
                candidates=[SourceCandidate(source_name="test", found=False)],
                sources_queried=["test"],
                sources_succeeded=[],
                sources_failed={"test": "mock"},
            )

        mock_orchestrator.retrieve = mock_retrieve

        mock_checker = MagicMock()
        mock_verdict = MagicMock()
        mock_verdict.label.value = "unresolved"
        mock_verdict.confidence = 0.0
        mock_verdict.citation = ref_cit
        mock_verdict.features.title_sim_fuzzy = 0.0
        mock_verdict.features.title_sim_semantic = 0.0
        mock_verdict.features.author_jaccard = 0.0
        mock_verdict.features.year_distance = 0
        mock_verdict.features.doi_exact_match = False
        mock_verdict.features.source_consensus = 0
        mock_verdict.reasoning = "mock"
        mock_verdict.triggered_rules = []
        mock_verdict.mismatched_fields = []
        mock_checker.check.return_value = mock_verdict

        from integrity_checker.logic.cis import CISCalculator
        pipeline = IntegrityPipeline(
            document_parser=mock_doc_parser,
            use_document_parser=True,
            orchestrator=mock_orchestrator,
            checker=mock_checker,
            cis_calc=CISCalculator(),
        )

        report = await pipeline.run_async("/fake/path.pdf", essay_id=42)

        # Verify DocumentParser was called
        mock_doc_parser.parse.assert_called_once_with("/fake/path.pdf")

        # Verify report populated
        assert isinstance(report, AnalysisReport)
        assert report.essay_id == 42
        assert report.filename == "path.pdf"
        # FIX v1.7: only REFERENCE_LIST citations get verified.
        # The reference entry (ref_cit) → verdict; the in-text (body_cit) → NOT verified.
        assert report.num_citations == 1
        assert len(report.extracted_citations) == 2  # both in-text + ref preserved
        assert len(report.verdicts) == 1  # only the reference entry has a verdict

    @pytest.mark.asyncio
    async def test_pipeline_uses_legacy_path_when_disabled(self):
        """use_document_parser=False → fallback legacy flow."""
        # Mock DocumentParser không được gọi
        mock_doc_parser = MagicMock()
        mock_doc_parser.parse.return_value = ParsedDocument(
            document=Document(file_path="/fake/path.pdf", num_pages=0, pages=[])
        )

        # Mock parser (legacy BasePDFParser)
        body_cit = _make_citation("(Smith, 2020)")
        # FIX v1.7: ref must be REFERENCE_LIST to be verifiable
        ref_cit = _make_citation(
            "Smith, J. (2020). A study.", title="A study",
            citation_type=CitationType.REFERENCE_LIST
        )
        mock_parser = MagicMock()
        mock_doc = MagicMock(spec=Document)
        mock_doc.num_pages = 5
        mock_doc.pages = []
        mock_parser.parse.return_value = mock_doc

        # Mock extractor + ref_parser
        mock_extractor = MagicMock()
        mock_extractor.extract_from_document.return_value = [body_cit]
        mock_extractor.preprocessor = MagicMock()
        mock_extractor.find_reference_section.return_value = None

        mock_ref_parser = MagicMock()
        mock_ref_parser.parse_reference_section.return_value = [ref_cit]

        # Mock orchestrator + checker
        mock_orchestrator = MagicMock()

        async def mock_retrieve(citation):
            from integrity_checker.models.source import SourceCandidate, SourceResult
            return SourceResult(
                citation_raw=citation.raw_text,
                candidates=[SourceCandidate(source_name="test", found=False)],
                sources_queried=["test"],
                sources_succeeded=[],
                sources_failed={"test": "mock"},
            )

        mock_orchestrator.retrieve = mock_retrieve

        mock_checker = MagicMock()
        mock_verdict = MagicMock()
        mock_verdict.label.value = "verified"
        mock_verdict.confidence = 0.0
        # FIX v1.7: verdict is for ref_cit (the only verifiable citation)
        mock_verdict.citation = ref_cit
        mock_verdict.features.title_sim_fuzzy = 0.0
        mock_verdict.features.title_sim_semantic = 0.0
        mock_verdict.features.author_jaccard = 0.0
        mock_verdict.features.year_distance = 0
        mock_verdict.features.doi_exact_match = False
        mock_verdict.features.source_consensus = 0
        mock_verdict.reasoning = "mock"
        mock_verdict.triggered_rules = []
        mock_verdict.mismatched_fields = []
        mock_checker.check.return_value = mock_verdict

        from integrity_checker.logic.cis import CISCalculator
        pipeline = IntegrityPipeline(
            parser=mock_parser,
            extractor=mock_extractor,
            ref_parser=mock_ref_parser,
            orchestrator=mock_orchestrator,
            checker=mock_checker,
            cis_calc=CISCalculator(),
            document_parser=mock_doc_parser,
            use_document_parser=False,
        )

        report = await pipeline.run_async("/fake/path.pdf")

        # Verify legacy path: DocumentParser NOT called, parser.parse called
        mock_doc_parser.parse.assert_not_called()
        mock_parser.parse.assert_called_once()
        mock_extractor.extract_from_document.assert_called_once()
        mock_ref_parser.parse_reference_section.assert_called_once()

        # FIX v1.7: num_citations reflects verifiable citations (references only)
        # extracted_citations includes all (in-text + ref)
        assert report.num_pages == 5
        assert report.num_citations == 1
        assert len(report.extracted_citations) == 2  # body + ref

    @pytest.mark.asyncio
    async def test_pipeline_default_uses_modern_path(self):
        """Default (use_document_parser=None) → True (DocumentParser) for v1.2+."""
        pipeline = IntegrityPipeline()
        assert pipeline._use_document_parser is True

        pipeline = IntegrityPipeline(use_document_parser=True)
        assert pipeline._use_document_parser is True

        pipeline = IntegrityPipeline(use_document_parser=False)
        assert pipeline._use_document_parser is False

    @pytest.mark.asyncio
    async def test_pipeline_comparing_progress_formats_source_hits_cleanly(self):
        """comparing step message formats total hits and human-readable source labels without raw dict."""
        ref1 = _make_citation(
            "Smith, J. (2020). Study one.", title="Study one", year="2020",
            citation_type=CitationType.REFERENCE_LIST,
        )
        ref2 = _make_citation(
            "Doe, A. (2021). Study two.", title="Study two", year="2021",
            citation_type=CitationType.REFERENCE_LIST,
        )
        parsed = ParsedDocument(
            document=Document(file_path="/fake/manuscript.docx", num_pages=4, pages=[]),
            body_citations=[],
            references=[ref1, ref2],
            appendix_citations=[],
            sections=[],
            parser_warnings=[],
        )
        mock_doc_parser = MagicMock()
        mock_doc_parser.parse.return_value = parsed

        mock_orchestrator = MagicMock()

        async def mock_retrieve(citation):
            from integrity_checker.models.source import SourceCandidate, SourceResult
            return SourceResult(
                citation_raw=citation.raw_text,
                candidates=[SourceCandidate(source_name="local_db", found=True)],
                sources_queried=["local_db", "openalex"],
                sources_succeeded=["local_db", "openalex"] if "Smith" in citation.raw_text else ["local_db"],
                sources_failed={},
            )

        mock_orchestrator.retrieve = mock_retrieve

        mock_checker = MagicMock()
        mock_verdict = MagicMock()
        mock_verdict.label.value = "verified"
        mock_verdict.confidence = 0.95
        mock_verdict.citation = ref1
        mock_verdict.features.title_sim_fuzzy = 1.0
        mock_verdict.features.title_sim_semantic = 1.0
        mock_verdict.features.author_jaccard = 1.0
        mock_verdict.features.year_distance = 0
        mock_verdict.features.doi_exact_match = True
        mock_verdict.features.source_consensus = 2
        mock_verdict.reasoning = "verified"
        mock_verdict.triggered_rules = ["R01"]
        mock_verdict.mismatched_fields = []
        mock_checker.check.return_value = mock_verdict

        from integrity_checker.logic.cis import CISCalculator
        pipeline = IntegrityPipeline(
            document_parser=mock_doc_parser,
            use_document_parser=True,
            orchestrator=mock_orchestrator,
            checker=mock_checker,
            cis_calc=CISCalculator(),
        )

        emitted: list[tuple[str, int, dict]] = []
        await pipeline.run_async(
            "/fake/manuscript.docx",
            essay_id=99,
            progress_callback=lambda step, idx, stats: emitted.append((step, idx, stats)),
        )

        parsing_events = [e for e in emitted if e[0] == "parsing"]
        assert parsing_events
        assert parsing_events[0][2]["message"] == "Parsing DOCX structure..."

        comparing_events = [e for e in emitted if e[0] == "comparing"]
        assert comparing_events
        msg = comparing_events[0][2]["message"]
        assert "{" not in msg
        assert "'local_db'" not in msg
        assert msg == "Compared 3 source hits across 2 databases (ACL FTS5: 2 · OpenAlex: 1)"
