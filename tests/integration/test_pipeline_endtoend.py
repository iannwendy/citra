"""Integration test — chạy pipeline end-to-end trên 1 PDF mẫu.

Cần: `python scripts/gen_sample_essays.py` đã được chạy trước.

Note v1.2 (tuần 8): real HTTP clients giờ thật sự gọi API. Các test này
mock toàn bộ retrieval (orchestrator) để tránh network calls. Cho real
end-to-end với API thật, xem tests/integration/test_full_pdf_pipeline_v12.py
(mặc dù nó cũng mock để CI pass).
"""

from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock

import pytest

from integrity_checker.models.source import SourceCandidate, SourceResult
from integrity_checker.pipeline.integrity_pipeline import IntegrityPipeline

ESSAYS_DIR = Path("data/essays")


def _build_mock_orchestrator(found: bool = False):
    """Mock orchestrator với retrieve() trả SourceResult giả lập."""
    mock_orch = MagicMock()

    async def mock_retrieve(citation):
        return SourceResult(
            citation_raw=citation.raw_text,
            candidates=[SourceCandidate(source_name="test", found=found)],
            sources_queried=["test"],
            sources_succeeded=["test"] if found else [],
            sources_failed={} if found else {"test": "mock"},
        )

    mock_orch.retrieve = mock_retrieve
    return mock_orch


@pytest.mark.skipif(
    not (ESSAYS_DIR / "essay_01_real_only.pdf").exists(),
    reason="Sample essays chưa được sinh. Chạy: python scripts/gen_sample_essays.py",
)
def test_pipeline_runs_on_sample_essay() -> None:
    """Chạy pipeline trên essay_01 — không crash, trả verdict list."""
    pipeline = IntegrityPipeline(orchestrator=_build_mock_orchestrator(found=False))
    report = pipeline.run(str(ESSAYS_DIR / "essay_01_real_only.pdf"), essay_id=1)

    assert report.num_pages > 0
    assert report.filename == "essay_01_real_only.pdf"
    assert len(report.verdicts) >= 1  # có ít nhất 1 citation
    assert report.cis is not None
    assert 0 <= report.cis.score <= 100
    assert report.disclaimer != ""


@pytest.mark.skipif(
    not (ESSAYS_DIR / "essay_02_mixed.pdf").exists(),
    reason="Sample essays chưa được sinh",
)
def test_pipeline_mixed_essay_handles_no_api() -> None:
    """Chạy pipeline trên essay_02 — mock retrieval found=False, nên tất cả
    citation sẽ là UNRESOLVED. Test là chạy không crash + có verdict."""
    pipeline = IntegrityPipeline(orchestrator=_build_mock_orchestrator(found=False))
    report = pipeline.run(str(ESSAYS_DIR / "essay_02_mixed.pdf"), essay_id=2)

    assert len(report.verdicts) >= 1
    from integrity_checker.models.validation import ValidationLabel

    labels = {v.label for v in report.verdicts}
    assert labels.issubset(
        {
            ValidationLabel.SUSPECTED_HALLUCINATION,
            ValidationLabel.UNRESOLVED,
            ValidationLabel.VERIFIED,
            ValidationLabel.METADATA_ERROR,
        }
    )


@pytest.mark.skipif(
    not (ESSAYS_DIR / "essay_03_fabricated.pdf").exists(),
    reason="Sample essays chưa được sinh",
)
def test_pipeline_fabricated_essay() -> None:
    """Essay toàn fabricated — vẫn phải chạy được."""
    pipeline = IntegrityPipeline(orchestrator=_build_mock_orchestrator(found=False))
    report = pipeline.run(str(ESSAYS_DIR / "essay_03_fabricated.pdf"), essay_id=3)
    assert report.num_citations >= 1
    assert report.cis is not None


def test_pipeline_handles_missing_file() -> None:
    """Pipeline === file không tồn tại → raise."""
    from integrity_checker.pipeline.integrity_pipeline import IntegrityPipeline

    with pytest.raises(FileNotFoundError):
        IntegrityPipeline(
            orchestrator=_build_mock_orchestrator()
        ).run("/nonexistent/file.pdf")
