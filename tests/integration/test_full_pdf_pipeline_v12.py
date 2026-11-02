"""Integration test v1.2 — end-to-end pipeline với DocumentParser + retrieval.

Reference: v1.2 §3.4, §3.6 — task #26.

Test coverage:
- Happy path: PDF có citations thật + fabricated → pipeline chạy không crash.
- DocumentParser path: GROBID fallback chain hoạt động.
- Retrieval path: orchestrator với mock cache + mock HTTP để tránh network.
- Edge cases:
    - File missing → FileNotFoundError (legacy) hoặc DocumentParser warning.
    - Essay toàn fabricated → nhiều UNRESOLVED.
    - Essay real-only → ít nhất 1 verdict.
- CIS scores trong range [0, 100].

Cần: `python scripts/gen_sample_essays.py` đã chạy trước.
"""

from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock

import pytest

from integrity_checker.models.citation import Citation
from integrity_checker.models.source import SourceCandidate, SourceResult
from integrity_checker.pipeline.integrity_pipeline import (
    AnalysisReport,
    IntegrityPipeline,
)
from integrity_checker.retrieval.normalization import citation_key

ESSAYS_DIR = Path("data/essays")


# ---------- Mock helpers ----------

def _mock_source_result(citation: Citation, *, found: bool = False) -> SourceResult:
    """Tạo SourceResult giả lập cho retrieval."""
    return SourceResult(
        citation_raw=citation.raw_text,
        candidates=[SourceCandidate(source_name="test", found=found)],
        sources_queried=["test"],
        sources_succeeded=["test"] if found else [],
        sources_failed={} if found else {"test": "mock"},
    )


def _build_mock_orchestrator(found: bool = False):
    """Mock orchestrator với retrieve() trả SourceResult giả lập."""
    mock_orch = MagicMock()

    async def mock_retrieve(citation):
        return _mock_source_result(citation, found=found)

    mock_orch.retrieve = mock_retrieve
    return mock_orch


def _build_mock_checker():
    """Mock NeuroSymbolicChecker trả verdict hợp lệ."""
    from integrity_checker.models.validation import (
        CitationVerdict,
        MatchFeatures,
        ValidationLabel,
    )

    mock_checker = MagicMock()

    def mock_check(citation, source, mapping_status=None, style_profile=None, citation_context=None):
        # If source found → VERIFIED, else UNRESOLVED
        any_found = any(c.found for c in source.candidates)
        label = ValidationLabel.VERIFIED if any_found else ValidationLabel.UNRESOLVED
        return CitationVerdict(
            citation=citation,
            label=label,
            confidence=0.9 if any_found else 0.0,
            features=MatchFeatures(
                title_sim_fuzzy=0.0,
                title_sim_semantic=0.0,
                author_jaccard=0.0,
                year_distance=0,
                doi_exact_match=False,
                source_consensus=1 if any_found else 0,
            ),
            reasoning="mock",
            triggered_rules=[],
            mismatched_fields=[],
        )

    mock_checker.check = mock_check
    return mock_checker


def _build_test_pipeline(
    *,
    use_document_parser: bool = False,
    disable_retrieval: bool = True,
    cache_dir: Path | None = None,
):
    """Build pipeline với mocked retrieval/checker để tránh network."""
    if disable_retrieval:
        orchestrator = _build_mock_orchestrator(found=False)
    else:
        orchestrator = _build_mock_orchestrator(found=True)
    checker = _build_mock_checker()

    return IntegrityPipeline(
        orchestrator=orchestrator,
        checker=checker,
        use_document_parser=use_document_parser,
    )


# ---------- Tests ----------

skip_if_no_essays = pytest.mark.skipif(
    not (ESSAYS_DIR / "essay_01_real_only.pdf").exists(),
    reason="Sample essays chưa được sinh. Chạy: python scripts/gen_sample_essays.py",
)


@skip_if_no_essays
class TestPipelineV12EndToEnd:
    """Test pipeline end-to-end với DocumentParser (v1.2)."""

    def test_legacy_path_real_only_essay(self):
        """Essay 01 (real-only) — legacy flow (no DocumentParser)."""
        pipeline = _build_test_pipeline(
            use_document_parser=False, disable_retrieval=True
        )
        report = pipeline.run(
            str(ESSAYS_DIR / "essay_01_real_only.pdf"), essay_id=1
        )

        assert isinstance(report, AnalysisReport)
        assert report.num_pages > 0
        assert report.filename == "essay_01_real_only.pdf"
        assert report.num_citations >= 1
        assert len(report.verdicts) >= 1
        assert report.cis is not None
        assert 0 <= report.cis.score <= 100
        assert report.disclaimer != ""
        # Vì retrieval mock found=False → UNRESOLVED
        from integrity_checker.models.validation import ValidationLabel
        for v in report.verdicts:
            assert v.label in (
                ValidationLabel.UNRESOLVED,
                ValidationLabel.SUSPECTED_HALLUCINATION,
                ValidationLabel.VERIFIED,
                ValidationLabel.METADATA_ERROR,
            )

    def test_modern_path_with_document_parser(self):
        """Essay 01 — DocumentParser path. GROBID disabled → fallback to PyMuPDF+regex."""
        pipeline = _build_test_pipeline(
            use_document_parser=True, disable_retrieval=True
        )
        report = pipeline.run(
            str(ESSAYS_DIR / "essay_01_real_only.pdf"), essay_id=1
        )

        assert report.num_pages > 0
        assert report.num_citations >= 1
        # num_pages = len(sections) từ DocumentParser
        # (PyMuPDF trên essay 01 có thể có 1 section duy nhất nếu không detect bibliography)
        assert report.num_pages >= 1

    def test_mixed_essay_with_real_retrieval(self):
        """Essay 02 (mixed) — mock retrieval found=True → có VERIFIED."""
        pipeline = _build_test_pipeline(
            use_document_parser=True, disable_retrieval=False
        )
        report = pipeline.run(
            str(ESSAYS_DIR / "essay_02_mixed.pdf"), essay_id=2
        )

        assert report.num_citations >= 1
        # Mock found=True → tất cả verdict phải là VERIFIED
        from integrity_checker.models.validation import ValidationLabel
        verified_count = sum(
            1 for v in report.verdicts if v.label == ValidationLabel.VERIFIED
        )
        assert verified_count >= 1, "Có ít nhất 1 VERIFIED khi retrieval mock found=True"

    def test_fabricated_essay_all_unresolved(self):
        """Essay 03 (fabricated) — retrieval mock found=False → UNRESOLVED hết."""
        pipeline = _build_test_pipeline(
            use_document_parser=True, disable_retrieval=True
        )
        report = pipeline.run(
            str(ESSAYS_DIR / "essay_03_fabricated.pdf"), essay_id=3
        )

        # Vẫn extract được citations từ text (parser OK)
        assert report.num_pages > 0
        # Mock found=False → toàn bộ UNRESOLVED
        from integrity_checker.models.validation import ValidationLabel
        if report.num_citations > 0:
            unresolved_count = sum(
                1 for v in report.verdicts if v.label == ValidationLabel.UNRESOLVED
            )
            assert unresolved_count == report.num_citations

    def test_doi_only_edge_case(self):
        """Essay 05 (DOI-only) — test edge case references chỉ có DOI."""
        pdf_path = ESSAYS_DIR / "essay_05_edge_doi_only.pdf"
        if not pdf_path.exists():
            pytest.skip("essay_05_edge_doi_only.pdf không tồn tại")
        pipeline = _build_test_pipeline(
            use_document_parser=True, disable_retrieval=True
        )
        report = pipeline.run(str(pdf_path), essay_id=5)

        assert report.num_pages > 0
        # Có thể có 0 citations nếu parser không trích được — chỉ check không crash
        assert report.cis is not None


class TestPipelineV12ErrorHandling:
    """Test edge cases + error handling."""

    def test_missing_file_raises(self):
        """File không tồn tại → DocumentParser / parser raise."""
        pipeline = _build_test_pipeline(
            use_document_parser=False, disable_retrieval=True
        )
        with pytest.raises(FileNotFoundError):
            pipeline.run("/nonexistent/file.pdf")

    def test_modern_path_missing_file_warns(self):
        """DocumentParser path missing file → parser_warnings populated, không raise."""
        pipeline = _build_test_pipeline(
            use_document_parser=True, disable_retrieval=True
        )
        # DocumentParser không raise — fallback chain → empty ParsedDocument + warnings
        report = pipeline.run("/nonexistent/file.pdf", essay_id=99)
        assert report.num_citations == 0
        assert report.num_pages == 0

    def test_empty_report_to_dict(self):
        """Empty report to_dict() trả JSON-friendly structure."""
        pipeline = _build_test_pipeline(
            use_document_parser=True, disable_retrieval=True
        )
        report = pipeline.run("/nonexistent/file.pdf", essay_id=99)
        d = report.to_dict()
        assert "essay_id" in d
        assert "filename" in d
        assert "num_citations" in d
        assert "verdicts" in d
        assert "cis" in d  # CIS may be None for empty
        assert "disclaimer" in d


class TestPipelineV12WithMockedRetrieval:
    """Test với mocked HTTP (đảm bảo không gọi API thật)."""

    @pytest.mark.asyncio
    async def test_retrieve_called_per_citation(self):
        """Verify orchestrator.retrieve() được gọi cho mỗi citation."""
        call_count = {"n": 0}

        async def counting_retrieve(citation):
            call_count["n"] += 1
            return _mock_source_result(citation, found=False)

        mock_orch = MagicMock()
        mock_orch.retrieve = counting_retrieve
        mock_checker = _build_mock_checker()

        pipeline = IntegrityPipeline(
            orchestrator=mock_orch,
            checker=mock_checker,
            use_document_parser=False,
        )

        # Use run_async directly (don't use sync .run() inside pytest-asyncio)
        report = await pipeline.run_async(
            str(ESSAYS_DIR / "essay_01_real_only.pdf"), essay_id=1
        )

        # Retrieval is deduplicated by canonical paper identity while the
        # report still retains one verdict per extracted citation.
        expected_unique = len({citation_key(v.citation) for v in report.verdicts})
        assert call_count["n"] == expected_unique
        assert call_count["n"] >= 1
