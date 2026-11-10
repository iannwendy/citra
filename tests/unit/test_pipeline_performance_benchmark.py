from __future__ import annotations

from pathlib import Path

from integrity_checker.api.progress import (
    DeadlineQueueManager,
    PipelineAdmissionController,
    get_deadline_queue_manager,
    get_pipeline_admission_controller,
)
from integrity_checker.extraction.document_parser import DocumentParser


def test_deadline_queue_manager_alias_and_singleton() -> None:
    assert DeadlineQueueManager is PipelineAdmissionController
    assert get_deadline_queue_manager() is get_pipeline_admission_controller()
    mgr = DeadlineQueueManager(max_concurrent=4)
    assert mgr.max_concurrent == 4
    assert mgr.active_count == 0
    assert mgr.waiting_count == 0


def test_document_parser_records_distinct_parsing_and_extracting_telemetry(
    tmp_path: Path,
) -> None:
    import fitz

    pdf_path = tmp_path / "sample_telemetry.pdf"
    doc = fitz.open()
    p1 = doc.new_page()
    p1.insert_text(
        (72, 72),
        "1. Introduction\nTransformers rely on self-attention (Vaswani et al., 2017).\n",
    )
    p2 = doc.new_page()
    p2.insert_text(
        (72, 72),
        "References\nVaswani, A., Shazeer, N., Parmar, N., et al. (2017). Attention Is All You Need. NeurIPS.\n",
    )
    doc.save(str(pdf_path))
    doc.close()

    parser = DocumentParser()
    parser.config.extraction.grobid.enabled = False
    parsed = parser.parse(str(pdf_path), use_service_manager=False)

    telemetry = (parsed.document.metadata or {}).get("_step_telemetry")
    assert isinstance(telemetry, dict)
    assert telemetry["parsing_ms"] > 0.0
    assert telemetry["extracting_ms"] > 0.0
    assert telemetry["parsing_peak_mb"] >= 0.0
    assert telemetry["extracting_peak_mb"] >= 0.0


def test_document_parser_bib_ris_and_corrupted_pdf_still_populate_safe_step_telemetry(
    tmp_path: Path,
) -> None:
    bib_path = tmp_path / "refs.bib"
    bib_path.write_text(
        "@article{vaswani2017,\n  title={Attention Is All You Need},\n  author={Vaswani, Ashish},\n  year={2017}\n}\n",
        encoding="utf-8",
    )
    bad_pdf = tmp_path / "corrupted.pdf"
    bad_pdf.write_bytes(b"not-a-valid-pdf-binary")

    parser = DocumentParser()
    parser.config.extraction.grobid.enabled = False

    parsed_bib = parser.parse(str(bib_path), use_service_manager=False)
    bib_tel = (parsed_bib.document.metadata or {}).get("_step_telemetry")
    assert isinstance(bib_tel, dict)
    assert set(bib_tel.keys()) == {
        "parsing_ms",
        "extracting_ms",
        "parsing_peak_mb",
        "extracting_peak_mb",
    }
    assert all(isinstance(v, float) and v >= 0.0 for v in bib_tel.values())

    parsed_bad = parser.parse(str(bad_pdf), use_service_manager=False)
    bad_tel = (parsed_bad.document.metadata or {}).get("_step_telemetry")
    assert isinstance(bad_tel, dict)
    assert all(isinstance(v, float) and v >= 0.0 for v in bad_tel.values())
