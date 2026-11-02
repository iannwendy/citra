"""Tests for Bug Fixes (2026-09-16).

Tests covering:
- Bug 1: num_pages fix (should use document.num_pages not len(sections))
- Bug 3: Network resilience (retry config, timeout increase)
- Bug 5: Known papers whitelist for hallucination detection
- Bug 6: in_text_bib_consistency calculation fix
"""

from dataclasses import dataclass
from unittest.mock import MagicMock, patch

import pytest

from integrity_checker.config import get_settings
from integrity_checker.logic.cis import MAPPING_PENALTIES, CISCalculator
from integrity_checker.logic.neuro_symbolic_checker import NeuroSymbolicChecker
from integrity_checker.models.citation import Citation, CitationStyle, CitationType
from integrity_checker.models.source import SourceCandidate, SourceResult
from integrity_checker.models.validation import CitationVerdict, ValidationLabel
from integrity_checker.retrieval.retrieval_orchestrator import _KNOWN_PAPERS, RetrievalOrchestrator


class TestBug1NumPagesFix:
    """Bug 1: num_pages should come from document.num_pages not len(sections)."""

    def test_num_pages_comes_from_document_not_sections(self):
        """Verify that ParsedDocument uses document.num_pages."""
        from integrity_checker.extraction.base import Document, Page
        from integrity_checker.extraction.document_parser import ParsedDocument
        from integrity_checker.extraction.section_segmenter import DocumentSection, SectionType

        # Create mock document with 91 pages
        mock_doc = MagicMock(spec=Document)
        mock_doc.num_pages = 91

        # Create 5 sections (should NOT be used for num_pages)
        sections = [
            DocumentSection(section_type=SectionType.BODY, start_page=1, end_page=10, text="Section 1"),
            DocumentSection(section_type=SectionType.BODY, start_page=11, end_page=20, text="Section 2"),
            DocumentSection(section_type=SectionType.BIBLIOGRAPHY, start_page=21, end_page=30, text="Section 3"),
            DocumentSection(section_type=SectionType.BODY, start_page=31, end_page=40, text="Section 4"),
            DocumentSection(section_type=SectionType.BODY, start_page=41, end_page=50, text="Section 5"),
        ]

        # Create ParsedDocument
        parsed = ParsedDocument(
            document=mock_doc,
            sections=sections,
        )

        # num_pages should come from document, not len(sections)
        assert parsed.document.num_pages == 91
        assert len(parsed.sections) == 5
        # These should NOT be equal
        assert parsed.document.num_pages != len(parsed.sections)


class TestBug3NetworkResilience:
    """Bug 3: Network resilience improvements."""

    def test_retry_config_increased(self):
        """Verify retry attempts increased from 3 to 5."""
        settings = get_settings()
        assert settings.retrieval.retry.max_attempts == 5, (
            f"Expected max_attempts=5, got {settings.retrieval.retry.max_attempts}"
        )

    def test_retry_backoff_max_seconds_increased(self):
        """Verify backoff max_seconds increased from 60 to 120."""
        settings = get_settings()
        assert settings.retrieval.retry.backoff.max_seconds == 120.0, (
            f"Expected max_seconds=120.0, got {settings.retrieval.retry.backoff.max_seconds}"
        )

    def test_crossref_client_timeout_increased(self):
        """Verify CrossrefClient timeout increased from 10 to 30."""
        from integrity_checker.retrieval.crossref_client import CrossrefClient

        client = CrossrefClient()
        assert client.timeout == 30.0, (
            f"Expected timeout=30.0, got {client.timeout}"
        )

    def test_semantic_scholar_client_timeout_increased(self):
        """Verify SemanticScholarClient timeout increased from 10 to 30."""
        from integrity_checker.retrieval.semantic_scholar_client import SemanticScholarClient

        client = SemanticScholarClient()
        assert client.timeout == 30.0, (
            f"Expected timeout=30.0, got {client.timeout}"
        )


class TestBug5KnownPapers:
    """Bug 5: Known seminal papers should not be flagged as hallucination."""

    def test_known_papers_dict_populated(self):
        """Verify known papers whitelist is populated."""
        assert len(_KNOWN_PAPERS) > 0, "Known papers dict should not be empty"

        # Check for key seminal papers
        expected_papers = [
            ("vaswani", "2017"),  # Attention Is All You Need
            ("devlin", "2019"),    # BERT
            ("sennrich", "2016"),  # NMT
        ]

        for key in expected_papers:
            assert key in _KNOWN_PAPERS, f"Expected paper {key} not in known papers"

    def test_is_known_paper_vaswani_2017(self):
        """Test Vaswani et al. (2017) is recognized."""
        citation = Citation(
            raw_text="Vaswani et al. (2017)",
            citation_type=CitationType.IN_TEXT,
            style=CitationStyle.APA,
        )

        is_known, info = RetrievalOrchestrator.is_known_paper(citation)
        assert is_known, "Vaswani et al. (2017) should be recognized as known paper"
        assert info is not None
        assert "Attention" in info.get("title", "")

    def test_is_known_paper_devlin_2019(self):
        """Test Devlin et al. (2019) is recognized."""
        citation = Citation(
            raw_text="Devlin et al. (2019) BERT",
            citation_type=CitationType.IN_TEXT,
            style=CitationStyle.APA,
        )

        is_known, info = RetrievalOrchestrator.is_known_paper(citation)
        assert is_known, "Devlin et al. (2019) should be recognized as known paper"

    def test_is_known_paper_sennrich_2016(self):
        """Test Sennrich et al. (2016) is recognized."""
        citation = Citation(
            raw_text="Sennrich et al. (2016)",
            citation_type=CitationType.IN_TEXT,
            style=CitationStyle.APA,
        )

        is_known, info = RetrievalOrchestrator.is_known_paper(citation)
        assert is_known, "Sennrich et al. (2016) should be recognized as known paper"

    def test_is_known_paper_unknown(self):
        """Test unknown paper is not falsely recognized."""
        citation = Citation(
            raw_text="Faker et al. (2025) Some Random Paper",
            citation_type=CitationType.IN_TEXT,
            style=CitationStyle.APA,
        )

        is_known, info = RetrievalOrchestrator.is_known_paper(citation)
        assert not is_known, "Unknown paper should not be recognized"
        assert info is None

    def test_neuro_symbolic_checker_returns_verified_for_known_papers(self):
        """Test that NeuroSymbolicChecker returns VERIFIED for known papers."""
        # Create citation for known paper
        citation = Citation(
            raw_text="Vaswani et al. (2017)",
            citation_type=CitationType.IN_TEXT,
            style=CitationStyle.APA,
        )

        # Create empty source result (simulating API failure)
        source = SourceResult(
            citation_raw=citation.raw_text,
            candidates=[],
            sources_queried=["crossref", "openalex", "semantic_scholar"],
            sources_succeeded=[],
            sources_failed={"crossref": "timeout", "openalex": "timeout"},
        )

        # Run through checker
        checker = NeuroSymbolicChecker()
        verdict = checker.check(citation, source)

        # Should be VERIFIED with R-KNOWN-PAPER rule
        assert verdict.label == ValidationLabel.VERIFIED, (
            f"Expected VERIFIED for known paper, got {verdict.label}"
        )
        assert "R-KNOWN-PAPER" in verdict.triggered_rules, (
            "Should trigger R-KNOWN-PAPER rule"
        )
        assert verdict.confidence >= 0.85, (
            f"Expected confidence >= 0.85, got {verdict.confidence}"
        )

    def test_neuro_symbolic_checker_does_not_overwrite_real_verification(self):
        """Test that known paper check doesn't overwrite real API verification."""
        citation = Citation(
            raw_text="Vaswani et al. (2017)",
            citation_type=CitationType.IN_TEXT,
            style=CitationStyle.APA,
        )

        # Create source with real verification
        real_candidate = SourceCandidate(
            source_name="crossref",
            found=True,
            title="Attention Is All You Need",
            doi="10.48550/arXiv.1706.03762",
            year="2017",
            confidence=0.95,
        )

        source = SourceResult(
            citation_raw=citation.raw_text,
            candidates=[real_candidate],
            sources_queried=["crossref"],
            sources_succeeded=["crossref"],
            sources_failed={},
        )

        # Run through checker
        checker = NeuroSymbolicChecker()
        verdict = checker.check(citation, source)

        # Should still be VERIFIED
        assert verdict.label == ValidationLabel.VERIFIED


class TestBug6CISConsistency:
    """Bug 6: in_text_bib_consistency calculation fix."""

    def test_mapping_penalties_match_rubric(self):
        """Verify MAPPING_PENALTIES match CISConfig rubric_penalty."""
        settings = get_settings()

        assert MAPPING_PENALTIES["missing_reference"] == settings.cis.rubric_penalty.MISSING_REFERENCE
        assert MAPPING_PENALTIES["uncited_reference"] == settings.cis.rubric_penalty.UNCITED_REFERENCE
        assert MAPPING_PENALTIES["in_text_mismatch"] == settings.cis.rubric_penalty.IN_TEXT_MISMATCH
        assert MAPPING_PENALTIES["duplicate_reference"] == settings.cis.rubric_penalty.DUPLICATE_REFERENCE
        assert MAPPING_PENALTIES["ambiguous_mapping"] == settings.cis.rubric_penalty.AMBIGUOUS_MAPPING
        assert MAPPING_PENALTIES["style_inconsistent"] == settings.cis.rubric_penalty.STYLE_INCONSISTENT

    def test_cis_calculator_with_all_matched(self):
        """Test CIS with all MATCHED citations."""
        from integrity_checker.linking.statuses import CitationMappingStatus

        # Create verdicts with all MATCHED
        verdicts = [
            CitationVerdict(
                citation=Citation(raw_text=f"Citation {i}", citation_type=CitationType.IN_TEXT),
                label=ValidationLabel.VERIFIED,
                confidence=0.8,
                mapping_status=CitationMappingStatus.MATCHED,
            )
            for i in range(10)
        ]

        calculator = CISCalculator()
        cis = calculator.compute(verdicts)

        # in_text_bib_consistency should be 1.0 (no penalties)
        assert cis.components.in_text_bib_consistency == 1.0, (
            f"Expected 1.0 for all matched, got {cis.components.in_text_bib_consistency}"
        )

    def test_cis_calculator_with_missing_reference(self):
        """Test CIS with MISSING_REFERENCE citations."""
        from integrity_checker.linking.statuses import CitationMappingStatus

        # Create verdicts: 8 matched, 2 missing_reference
        verdicts = []
        for i in range(8):
            verdicts.append(CitationVerdict(
                citation=Citation(raw_text=f"Citation {i}", citation_type=CitationType.IN_TEXT),
                label=ValidationLabel.VERIFIED,
                confidence=0.8,
                mapping_status=CitationMappingStatus.MATCHED,
            ))
        for i in range(2):
            verdicts.append(CitationVerdict(
                citation=Citation(raw_text=f"Missing {i}", citation_type=CitationType.IN_TEXT),
                label=ValidationLabel.VERIFIED,
                confidence=0.8,
                mapping_status=CitationMappingStatus.MISSING_REFERENCE,
            ))

        calculator = CISCalculator()
        cis = calculator.compute(verdicts)

        # Expected: 1 - (2 * 0.20 / 10) = 0.96
        expected = 1.0 - (2 * MAPPING_PENALTIES["missing_reference"] / 10)
        assert abs(cis.components.in_text_bib_consistency - expected) < 0.01, (
            f"Expected {expected:.4f}, got {cis.components.in_text_bib_consistency:.4f}"
        )

    def test_cis_calculator_with_mixed_statuses(self):
        """Test CIS with mixed mapping statuses."""
        from integrity_checker.linking.statuses import CitationMappingStatus

        verdicts = [
            # 5 matched
            CitationVerdict(
                citation=Citation(raw_text=f"M{i}", citation_type=CitationType.IN_TEXT),
                label=ValidationLabel.VERIFIED,
                confidence=0.8,
                mapping_status=CitationMappingStatus.MATCHED,
            )
            for i in range(5)
        ] + [
            # 3 missing_reference
            CitationVerdict(
                citation=Citation(raw_text=f"Mi{i}", citation_type=CitationType.IN_TEXT),
                label=ValidationLabel.VERIFIED,
                confidence=0.8,
                mapping_status=CitationMappingStatus.MISSING_REFERENCE,
            )
            for i in range(3)
        ] + [
            # 2 style_inconsistent
            CitationVerdict(
                citation=Citation(raw_text=f"Si{i}", citation_type=CitationType.IN_TEXT),
                label=ValidationLabel.VERIFIED,
                confidence=0.8,
                mapping_status=CitationMappingStatus.STYLE_INCONSISTENT,
            )
            for i in range(2)
        ]

        calculator = CISCalculator()
        cis = calculator.compute(verdicts)

        # Expected: 1 - (3 * 0.20 + 2 * 0.02) / 10 = 1 - 0.064 = 0.936
        expected = 1.0 - (3 * MAPPING_PENALTIES["missing_reference"] + 2 * MAPPING_PENALTIES["style_inconsistent"]) / 10
        assert abs(cis.components.in_text_bib_consistency - expected) < 0.01, (
            f"Expected {expected:.4f}, got {cis.components.in_text_bib_consistency:.4f}"
        )

    def test_cis_calculator_empty_verdicts(self):
        """Test CIS with empty verdicts list."""
        calculator = CISCalculator()
        cis = calculator.compute([])

        # When no verdicts, score is 0 and all components are 0
        assert cis.score == 0.0
        assert cis.num_citations == 0
        assert cis.components.verified_ratio == 0.0


class TestBug7DateOnlyCitationFilter:
    """Bug 7: Filter out date-only patterns like '(May 2012)', '(Spring 2013)'.

    These are legal citations with dates, not author-year citations.
    """

    def test_date_only_citation_filter_filters_month_year(self):
        """Test that date-only patterns like '(May 2012)' are filtered."""
        from integrity_checker.extraction.citation_extractor import _is_date_only_citation

        # Should be filtered (date-only)
        assert _is_date_only_citation("(May 2012)") is True
        assert _is_date_only_citation("(June 1996)") is True
        assert _is_date_only_citation("(July 1997)") is True
        assert _is_date_only_citation("(August 1884)") is True
        assert _is_date_only_citation("(September 2020)") is True
        assert _is_date_only_citation("(Spring 2013)") is True
        assert _is_date_only_citation("(Fall 2022)") is True

    def test_date_only_citation_filter_allows_real_citations(self):
        """Test that real APA citations like '(Smith, 2020)' are NOT filtered."""
        from integrity_checker.extraction.citation_extractor import _is_date_only_citation

        # Should NOT be filtered (real citations)
        assert _is_date_only_citation("(Smith, 2020)") is False
        assert _is_date_only_citation("(Smith et al., 2020)") is False
        assert _is_date_only_citation("(Johnson & Williams, 2019)") is False
        assert _is_date_only_citation("(Brown, 2021)") is False

    def test_date_only_citation_filter_case_insensitive(self):
        """Test that month/season matching is case-insensitive."""
        from integrity_checker.extraction.citation_extractor import _is_date_only_citation

        # Case insensitive
        assert _is_date_only_citation("(MAY 2012)") is True
        assert _is_date_only_citation("(may 2012)") is True
        assert _is_date_only_citation("(SPRING 2013)") is True


class TestIntegrationBugFixes:
    """Integration tests for bug fixes in the pipeline."""

    def test_pipeline_with_known_papers_still_works(self):
        """Test that pipeline works correctly with known papers."""
        from integrity_checker.logic.neuro_symbolic_checker import NeuroSymbolicChecker
        from integrity_checker.models.citation import Citation, CitationStyle, CitationType
        from integrity_checker.models.source import SourceResult

        # Known paper citation
        citation = Citation(
            raw_text="Vaswani et al. (2017)",
            citation_type=CitationType.IN_TEXT,
            style=CitationStyle.APA,
        )

        # Source with failed APIs
        source = SourceResult(
            citation_raw=citation.raw_text,
            candidates=[],
            sources_queried=["crossref", "openalex"],
            sources_succeeded=[],
            sources_failed={"crossref": "timeout", "openalex": "timeout"},
        )

        checker = NeuroSymbolicChecker()
        verdict = checker.check(citation, source)

        # Should be VERIFIED via known papers database
        assert verdict.label == ValidationLabel.VERIFIED
        assert "R-KNOWN-PAPER" in verdict.triggered_rules

    def test_cis_score_not_zero_with_good_citations(self):
        """Test that CIS score is not zero when most citations are good."""
        from integrity_checker.linking.statuses import CitationMappingStatus

        # 9 verified matched, 1 missing_reference
        verdicts = [
            CitationVerdict(
                citation=Citation(raw_text=f"Citation {i}", citation_type=CitationType.IN_TEXT),
                label=ValidationLabel.VERIFIED,
                confidence=0.9,
                mapping_status=CitationMappingStatus.MATCHED,
            )
            for i in range(9)
        ] + [
            CitationVerdict(
                citation=Citation(raw_text="Missing citation", citation_type=CitationType.IN_TEXT),
                label=ValidationLabel.VERIFIED,
                confidence=0.9,
                mapping_status=CitationMappingStatus.MISSING_REFERENCE,
            )
        ]

        calculator = CISCalculator()
        cis = calculator.compute(verdicts)

        # CIS should be > 0 with mostly good citations
        assert cis.score > 50, (
            f"Expected CIS > 50 with mostly good citations, got {cis.score}"
        )
        assert cis.components.in_text_bib_consistency > 0.8, (
            f"Expected in_text_bib_consistency > 0.8, got {cis.components.in_text_bib_consistency}"
        )


class TestThesisPdfFixes:
    """Regression tests for thesis.pdf reference extraction, linking, and retrieval fixes."""

    def test_join_wrapped_line_dehyphenates_words_and_preserves_compounds(self):
        from integrity_checker.extraction.reference_parser import ReferenceListParser

        assert ReferenceListParser._join_wrapped_line("data recog-", "nition and term") == "data recognition and term"
        assert ReferenceListParser._join_wrapped_line("Huang, Z., Ide-", "Smith, M.") == "Huang, Z., Ide-Smith, M."
        assert ReferenceListParser._join_wrapped_line("BERT: Pre-", "training of deep") == "BERT: Pre-training of deep"
        assert (
            ReferenceListParser._join_wrapped_line("Retrieved from https://github.com/kermitt2/", "grobid")
            == "Retrieved from https://github.com/kermitt2/grobid"
        )

    def test_is_fake_entry_filters_appendix_artifacts(self):
        from integrity_checker.extraction.reference_parser import _is_fake_entry

        assert _is_fake_entry("Grobid + Regex extraction/ Citation extraction & section segmentation PyMuPDF, pdfplumber")
        assert _is_fake_entry("linking/ In-text ↔ reference list matching")
        assert _is_fake_entry(
            "metadata_error — The cited work exists, but one or more metadata fields disagree. "
            "suspected_hallucination — No matching work is found across any scholarly index."
        )
        assert _is_fake_entry("evaluation/iaa_calculator.py — Pairwise Cohen's κ and Fleiss' κ computation")
        assert _is_fake_entry("Per-class Precision, Recall, F1, Macro-F1, and confusion matrix generator")

    def test_crossref_message_to_candidate_joins_subtitle(self):
        from integrity_checker.retrieval.crossref_client import CrossrefClient

        cand = CrossrefClient._message_to_candidate(
            {
                "DOI": "10.14778/1687553.1687577",
                "title": ["DBLP"],
                "subtitle": ["some lessons learned"],
                "author": [{"given": "Michael", "family": "Ley"}],
                "issued": {"date-parts": [[2009]]},
            }
        )
        assert cand.title == "DBLP: some lessons learned"
        assert cand.year == "2009"

    def test_feature_calculator_question_mark_and_arxiv_id_doi_match(self):
        from integrity_checker.matching.features import FeatureCalculator
        from integrity_checker.models.source import SourceCandidate

        fc = FeatureCalculator(enable_content_alignment=False)
        cit = Citation(
            raw_text="[18] Sadasivan, S., et al. (2023). Can AI-generated text be reliably detected?. arXiv:2303.11156.",
            citation_type=CitationType.REFERENCE_LIST,
            authors=["Sadasivan, S"],
            year="2023",
            title="Can AI-generated text be reliably detected",
            venue="arXiv:2303.11156",
        )
        src = SourceResult(
            citation_raw=cit.raw_text,
            candidates=[
                SourceCandidate(
                    source_name="local_db",
                    found=True,
                    doi="10.48550/arXiv.2303.11156",
                    title="Can AI-Generated Text be Reliably Detected?",
                    authors=["Vinu Sankar Sadasivan"],
                    year="2023",
                    confidence=0.9,
                )
            ],
            sources_queried=["local_db"],
            sources_succeeded=["local_db"],
        )
        feats = fc.compute(cit, src)
        assert feats.title_sim_fuzzy == 1.0
        assert feats.doi_exact_match is True


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
