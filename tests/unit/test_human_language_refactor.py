"""Comprehensive regression tests for Squad 1A Backend Human-Language Refactor.

Verifies that zero developer/ML/parser/accusatory jargon leaks into user-facing outputs:
1. Word (.docx) audit report and fixed-bibliography exports (EN & VI).
2. PDF report export (EN & VI), including language-aware scanned-PDF warnings.
3. Live Sandbox verdict reasoning localization & Layer-1 mapping notes (EN & VI).
4. Checkout subscription plan features & taglines (EN & VI).
5. Live SSE progress messages emitted by IntegrityPipeline and DocumentParser.
"""

from __future__ import annotations

import io
import json
import re
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import fitz
import pytest
from docx import Document as WordDocument
from fastapi.testclient import TestClient

from integrity_checker.api import deps
from integrity_checker.api.main import app
from integrity_checker.api.routes import essays as essays_route
from integrity_checker.api.routes.report import _generate_pdf_bytes
from integrity_checker.billing.plans import PLAN_CATALOG
from integrity_checker.config import Settings
from integrity_checker.db.models import User
from integrity_checker.export.docx_exporter import (
    export_auto_healed_docx,
    export_report_to_docx,
)
from integrity_checker.extraction.base import Document, Page
from integrity_checker.extraction.document_parser import DocumentParser
from integrity_checker.logic.cis import CISCalculator
from integrity_checker.logic.neuro_symbolic_checker import NeuroSymbolicChecker
from integrity_checker.models.citation import Citation, CitationType
from integrity_checker.models.source import SourceCandidate, SourceResult
from integrity_checker.pipeline.integrity_pipeline import (
    SCANNED_PDF_WARNING_EN,
    SCANNED_PDF_WARNING_VI,
    IntegrityPipeline,
)


def _extract_docx_all_text(docx_bytes: bytes) -> str:
    doc = WordDocument(io.BytesIO(docx_bytes))
    parts = [p.text for p in doc.paragraphs]
    for tbl in doc.tables:
        for row in tbl.rows:
            for cell in row.cells:
                parts.append(cell.text)
    return "\n".join(parts)


def _extract_pdf_all_text(pdf_bytes: bytes) -> str:
    with fitz.open(stream=pdf_bytes, filetype="pdf") as pdf_doc:
        return " ".join(" ".join(page.get_text("text").split()) for page in pdf_doc)


# ---------------------------------------------------------------------------
# 1. Word (.docx) Audit Report & Fixed-Bibliography Exports (EN & VI)
# ---------------------------------------------------------------------------


def test_docx_report_export_zero_jargon_and_non_accusatory_en_and_vi() -> None:
    verdicts = [
        {
            "citation_raw": "Vaswani, A., Shazeer, N., & Parmar, N. (2017). Attention Is All You Need. NeurIPS.",
            "mapping_status": "matched",
            "label": "verified",
            "confidence": 0.98,
            "reasoning": (
                "Verified via consensus (author_jaccard=0.95, fuzzy_title_sim=0.99) "
                "[provenance penalty: -0%] [Neural: content alignment score=0.91 (high)]"
            ),
            "triggered_rules": ["R-CONSENSUS-FULL", "R-CONTENT-ALIGNMENT"],
            "mismatched_fields": [],
            "features": {
                "best_evidence_sentence": "The Transformer relies entirely on self-attention.",
                "citation_intent": "methodology",
                "stance_label": "supporting",
                "cross_lingual_title_detected": True,
                "cross_lingual_title_sim": 0.94,
            },
            "matched_sources": [
                {
                    "source_name": "crossref",
                    "title": "Attention Is All You Need",
                    "authors": ["Ashish Vaswani", "Noam Shazeer", "Niki Parmar"],
                    "year": 2017,
                    "venue": "NeurIPS",
                }
            ],
        },
        {
            "citation_raw": "Devlin, J. (2021). BERT: Pre-training of Deep Bidirectional Transformers. NAACL.",
            "mapping_status": "in_text_mismatch",
            "label": "metadata_error",
            "confidence": 0.85,
            "reasoning": "METADATA_ERROR: wrong year (author_jaccard=0.50) [provenance penalty: -10%]",
            "triggered_rules": ["R-YEAR-MISMATCH"],
            "mismatched_fields": ["year"],
            "features": {},
            "matched_sources": [
                {
                    "source_name": "crossref",
                    "title": "BERT: Pre-training of Deep Bidirectional Transformers",
                    "authors": ["Jacob Devlin"],
                    "year": 2019,
                    "venue": "NAACL",
                }
            ],
        },
        {
            "citation_raw": "Phantom, Z. (2025). Nonexistent Neural Hypothesis. Imaginary Journal.",
            "mapping_status": "missing_reference",
            "label": "suspected_hallucination",
            "confidence": 0.91,
            "reasoning": (
                "Suspected AI-hallucinated or fabricated citation. "
                "fuzzy_title_sim=0.22 < 0.65 [Neural: content alignment score=0.12 (low)]"
            ),
            "triggered_rules": ["R-NO-SCHOLARLY-RECORD", "R-FAIL-ALL"],
            "mismatched_fields": [],
            "features": {},
            "matched_sources": [],
        },
        {
            "citation_raw": "Stub Author, Missing Details",
            "mapping_status": "unresolved",
            "label": "metadata_error",
            "confidence": 0.5,
            "reasoning": "Incomplete bibliographic stub.",
            "triggered_rules": ["R-INCOMPLETE-METADATA"],
            "mismatched_fields": ["year", "title"],
            "features": {},
            "matched_sources": [],
        },
    ]
    scanned_diag = {
        "parser_used": "grobid",
        "is_scanned_pdf": True,
        "warning_message": SCANNED_PDF_WARNING_VI,
        "warning_message_vi": SCANNED_PDF_WARNING_VI,
        "warning_message_en": SCANNED_PDF_WARNING_EN,
        "ocr_pages_recovered": [1],
    }

    en_bytes = export_report_to_docx(
        filename="thesis_en.pdf",
        cis_score=74.5,
        num_citations=4,
        num_verified=1,
        num_metadata_error=2,
        num_suspected=1,
        num_unresolved=0,
        num_resource=0,
        verdicts=verdicts,
        document_diagnostics=scanned_diag,
        lang="en",
    )
    en_text = _extract_docx_all_text(en_bytes)

    for forbidden in (
        "HALLUCINATION",
        "Hallucination",
        "hallucinat",
        "BỊA ĐẶT",
        "bịa đặt",
        "NGHI VẤN",
        "nghi vấn",
        "NGỤY TẠO",
        "ngụy tạo",
        "Neuro-Symbolic",
        "Triggered Symbolic Rules",
        "SBERT Best Evidence",
        "Auto-Healed",
        "Canonical",
        "Parser Used",
        "grobid",
        "R-NO-SCHOLARLY-RECORD",
        "R-INCOMPLETE-METADATA",
        "R-CONSENSUS-FULL",
        "R-YEAR-MISMATCH",
        "author_jaccard=",
        "fuzzy_title_sim=",
        "provenance penalty",
        "[Neural:",
        SCANNED_PDF_WARNING_VI,
    ):
        assert forbidden not in en_text, f"Forbidden string leaked in EN DOCX: {forbidden!r}"

    assert "Verification Summary & Evidence" in en_text
    assert "Checks Performed:" in en_text
    assert "Closest Matching Passage:" in en_text
    assert "Source Not Found" in en_text
    assert "[NEEDS REVIEW — SOURCE NOT FOUND]" in en_text
    assert "Details Mismatch" in en_text
    assert SCANNED_PDF_WARNING_EN in en_text

    vi_bytes = export_report_to_docx(
        filename="luan_van.pdf",
        cis_score=74.5,
        num_citations=4,
        num_verified=1,
        num_metadata_error=2,
        num_suspected=1,
        num_unresolved=0,
        num_resource=0,
        verdicts=verdicts,
        document_diagnostics=scanned_diag,
        lang="vi",
    )
    vi_text = _extract_docx_all_text(vi_bytes)

    for forbidden in (
        "HALLUCINATION",
        "BỊA ĐẶT",
        "bịa đặt",
        "NGHI VẤN",
        "NGỤY TẠO",
        "Neuro-Symbolic",
        "Triggered Symbolic Rules",
        "SBERT Best Evidence",
        "R-NO-SCHOLARLY-RECORD",
        "R-INCOMPLETE-METADATA",
    ):
        assert forbidden not in vi_text, f"Forbidden string leaked in VI DOCX: {forbidden!r}"

    assert "Tóm tắt kết quả đối chiếu & bằng chứng" in vi_text
    assert "Các tiêu chí đã kiểm tra:" in vi_text
    assert "Đoạn trích liên quan nhất:" in vi_text
    assert "Không tìm thấy nguồn" in vi_text
    assert "[CẦN KIỂM TRA — CHƯA TÌM THẤY NGUỒN GỐC]" in vi_text
    assert SCANNED_PDF_WARNING_VI in vi_text


def test_auto_healed_docx_in_place_replaces_accusatory_stamps_en_and_vi(tmp_path: Path) -> None:
    orig_doc = WordDocument()
    orig_doc.add_paragraph(
        "Vaswani, A., Shazeer, N., & Parmar, N. (2019). Attention Is All You Need. NeurIPS."
    )
    orig_doc.add_paragraph(
        "Phantom, Z. (2025). Imaginary Paper Title For Testing. Nonexistent Press."
    )
    orig_path = tmp_path / "draft.docx"
    orig_doc.save(str(orig_path))

    verdicts = [
        {
            "citation_raw": "Vaswani, A., Shazeer, N., & Parmar, N. (2019). Attention Is All You Need. NeurIPS.",
            "label": "metadata_error",
            "mismatched_fields": ["year"],
            "matched_sources": [
                {
                    "source_name": "crossref",
                    "title": "Attention Is All You Need",
                    "authors": ["Ashish Vaswani", "Noam Shazeer", "Niki Parmar"],
                    "year": 2017,
                    "venue": "NeurIPS",
                    "doi": "10.48550/arXiv.1706.03762",
                }
            ],
        },
        {
            "citation_raw": "Phantom, Z. (2025). Imaginary Paper Title For Testing. Nonexistent Press.",
            "label": "suspected_hallucination",
            "mismatched_fields": [],
            "matched_sources": [],
        },
    ]

    en_healed = _extract_docx_all_text(
        export_auto_healed_docx(
            "draft.docx", verdicts, style="apa", original_docx_path=str(orig_path), lang="en"
        )
    )
    for forbidden in ("HALLUCINATION", "BỊA ĐẶT", "NGHI VẤN", "CẢNH BÁO ĐỎ", "REMOVE —", "Auto-Healed", "Canonical"):
        assert forbidden not in en_healed, f"Leaked {forbidden!r} in EN fixed DOCX"
    assert "[NEEDS REVIEW — SOURCE NOT FOUND]" in en_healed
    assert "[Updated by CITRA:" in en_healed

    vi_healed = _extract_docx_all_text(
        export_auto_healed_docx(
            "draft.docx", verdicts, style="apa", original_docx_path=str(orig_path), lang="vi"
        )
    )
    for forbidden in ("HALLUCINATION", "BỊA ĐẶT", "NGHI VẤN", "CẢNH BÁO ĐỎ", "REMOVE —", "Auto-Healed", "Canonical"):
        assert forbidden not in vi_healed, f"Leaked {forbidden!r} in VI fixed DOCX"
    assert "[CẦN KIỂM TRA — CHƯA TÌM THẤY NGUỒN GỐC]" in vi_healed
    assert "[CITRA đã cập nhật:" in vi_healed


# ---------------------------------------------------------------------------
# 2. PDF Export (EN & VI) — Zero Parser Leak, Neutral Labels, Localized Scanned Warning
# ---------------------------------------------------------------------------


def test_pdf_export_removes_parser_jargon_and_localizes_scanned_warning() -> None:
    essay = SimpleNamespace(
        id=301,
        filename="scanned_sample.pdf",
        num_pages=6,
        cis_json=json.dumps(
            {
                "score": 68.0,
                "components": {
                    "verified_ratio": 0.5,
                    "metadata_accuracy": 0.6,
                    "in_text_bib_consistency": 0.8,
                    "format_consistency": 0.9,
                    "identifier_validity": 1.0,
                },
            }
        ),
        style_profile_json=json.dumps(
            {
                "document_diagnostics": {
                    "is_scanned_pdf": True,
                    "parser_used": "grobid",
                    "warning_code": "SCANNED_PDF_DETECTED",
                    "warning_message": SCANNED_PDF_WARNING_VI,
                    "warning_message_vi": SCANNED_PDF_WARNING_VI,
                    "warning_message_en": SCANNED_PDF_WARNING_EN,
                }
            }
        ),
    )
    verdicts = [
        SimpleNamespace(
            citation_raw="Doe, J. (2024). Missing Work.",
            label="suspected_hallucination",
            mapping_status="matched",
            confidence=0.88,
            triggered_rules="[]",
            features="{}",
        ),
        SimpleNamespace(
            citation_raw="Smith, A. (2021). Wrong Year Paper.",
            label="metadata_error",
            mapping_status="in_text_mismatch",
            confidence=0.82,
            triggered_rules="[]",
            features="{}",
        ),
    ]

    en_pdf_text = _extract_pdf_all_text(_generate_pdf_bytes(essay, verdicts, lang="en"))
    assert "Parser:" not in en_pdf_text
    assert "grobid" not in en_pdf_text.lower()
    assert "regex" not in en_pdf_text.lower()
    assert "Suspected Hallucination" not in en_pdf_text
    assert "Metadata Error" not in en_pdf_text
    assert "Layer-1 Consistency" not in en_pdf_text
    assert "Source Not Found" in en_pdf_text
    assert "Details Mismatch" in en_pdf_text
    assert "In-Text & Bibliography Match" in en_pdf_text
    # EN PDF MUST show English scanned warning and NEVER paste Vietnamese warning!
    assert "Scanned or image-only PDF detected" in en_pdf_text
    assert "Phát hiện" not in en_pdf_text
    assert SCANNED_PDF_WARNING_VI not in en_pdf_text

    vi_pdf_text = _extract_pdf_all_text(_generate_pdf_bytes(essay, verdicts, lang="vi"))
    assert "Parser:" not in vi_pdf_text
    assert "grobid" not in vi_pdf_text.lower()
    assert "Suspected Hallucination" not in vi_pdf_text
    assert "Không tìm thấy nguồn" in vi_pdf_text
    assert "Sai lệch thông tin" in vi_pdf_text
    assert "Đối chiếu trích dẫn trong bài & danh mục" in vi_pdf_text
    assert "Scanned or image-only PDF detected" not in vi_pdf_text
    assert "ảnh quét" in vi_pdf_text.lower() or "văn bản" in vi_pdf_text.lower()


# ---------------------------------------------------------------------------
# 3. Sandbox Reasoning Localization & Natural Layer-1 Notes (ALL 5 Verdict Labels)
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("label", "rules", "raw_reasoning", "mismatched", "url_status"),
    [
        (
            "verified",
            ["R-CONSENSUS-FULL"],
            "Verified (author_jaccard=0.80, fuzzy_title_sim=0.96) [provenance penalty: -0%] [Neural: content alignment score=0.88 (high)]",
            [],
            None,
        ),
        (
            "metadata_error",
            ["R-YEAR-MISMATCH"],
            "Wrong year: cited 2021 vs 2019 (author_jaccard=0.50, fuzzy_title_sim=0.41 < 0.65) [provenance penalty: -10%]",
            ["year"],
            None,
        ),
        (
            "suspected_hallucination",
            ["R-NO-SCHOLARLY-RECORD"],
            "Suspected AI-hallucinated or fabricated citation. fuzzy_title_sim=0.21, author_jaccard=0.00 [Neural: content alignment score=0.14]",
            [],
            None,
        ),
        (
            "unresolved",
            ["R-ABSTENTION-BORDER"],
            "grey-zone title similarity (0.54 in [0.25, 0.78)) — system abstains for manual review.",
            [],
            None,
        ),
        (
            "resource",
            ["R-WEB-RESOURCE"],
            "URL/Reference link detected (HTTP 200 OK): https://example.org (not an academic citation)",
            [],
            "alive",
        ),
    ],
)
def test_sandbox_reasoning_localization_all_labels_clean_bilingual(
    label: str,
    rules: list[str],
    raw_reasoning: str,
    mismatched: list[str],
    url_status: str | None,
) -> None:
    cit = Citation(
        raw_text="Devlin, J. (2021). BERT. NAACL.",
        citation_type=CitationType.REFERENCE_LIST,
        title="BERT",
        authors=["Jacob Devlin"],
        year="2021",
    )
    cand = SourceCandidate(
        source_name="crossref",
        found=True,
        title="BERT: Pre-training of Deep Bidirectional Transformers",
        authors=["Jacob Devlin"],
        year="2019",
        confidence=0.95,
    )
    src = SourceResult(
        citation_raw=cit.raw_text,
        candidates=[cand] if label in ("verified", "metadata_error") else [],
        sources_queried=["crossref"],
        sources_succeeded=["crossref"] if label in ("verified", "metadata_error") else [],
        url_status=url_status,
    )

    chosen_vi, r_en, r_vi = essays_route._localize_sandbox_verdict_reasoning(
        raw_reasoning,
        rules,
        cit,
        src,
        is_en=False,
        label=label,
        mismatched_fields=mismatched,
        url_status=url_status,
    )
    chosen_en, _, _ = essays_route._localize_sandbox_verdict_reasoning(
        raw_reasoning,
        rules,
        cit,
        src,
        is_en=True,
        label=label,
        mismatched_fields=mismatched,
        url_status=url_status,
    )

    assert chosen_vi == r_vi and r_vi
    assert chosen_en == r_en and r_en
    assert r_en != r_vi

    for text in (r_en, r_vi):
        for forbidden in (
            "author_jaccard=",
            "fuzzy_title_sim=",
            "provenance penalty",
            "[Neural:",
            "AI-hallucinated",
            "hallucinated",
            "fabricated",
            "bịa đặt",
            "ngụy tạo",
            "[0.25, 0.78)",
        ):
            assert forbidden.lower() not in text.lower(), (
                f"Jargon {forbidden!r} leaked for label={label}: {text!r}"
            )


def test_sandbox_layer1_notes_avoid_vietlish_via_endpoint() -> None:
    if hasattr(essays_route, "_sandbox_verify_rate_buckets"):
        essays_route._sandbox_verify_rate_buckets.clear()

    class _MockOrch:
        _local_db = None

        async def retrieve(self, cit: Citation, **_kw) -> SourceResult:
            return SourceResult(
                citation_raw=cit.raw_text,
                candidates=[
                    SourceCandidate(
                        source_name="crossref",
                        found=True,
                        title="Attention Is All You Need",
                        authors=["Ashish Vaswani"],
                        year="2017",
                        confidence=0.98,
                    )
                ],
                sources_queried=["crossref"],
                sources_succeeded=["crossref"],
            )

    fake_pipeline = IntegrityPipeline(
        orchestrator=_MockOrch(),  # type: ignore[arg-type]
        checker=NeuroSymbolicChecker(),
    )
    fake_user = User(
        id=998,
        username="sandbox_l1_tester",
        password_hash="x",
        role="user",
        plan_tier="pro",
        is_active=1,
    )
    app.dependency_overrides[deps.get_pipeline] = lambda: fake_pipeline
    app.dependency_overrides[deps.get_current_user] = lambda: fake_user
    try:
        client = TestClient(app)
        resp = client.post(
            "/api/essays/sandbox/verify",
            json={
                "lang": "vi",
                "style": "apa",
                "items": [
                    {
                        "title": "Attention Is All You Need",
                        "authors": ["Ashish Vaswani"],
                        "year": "2017",
                        "cite_in_text": True,
                        "include_in_references": True,
                    },
                    {
                        "title": "Attention Is All You Need",
                        "authors": ["Ashish Vaswani"],
                        "year": "2017",
                        "cite_in_text": True,
                        "include_in_references": False,
                    },
                    {
                        "title": "Attention Is All You Need",
                        "authors": ["Ashish Vaswani"],
                        "year": "2017",
                        "cite_in_text": False,
                        "include_in_references": True,
                    },
                    {
                        "title": "Attention Is All You Need",
                        "authors": ["Ashish Vaswani"],
                        "year": "2017",
                        "in_text_year_override": "2019",
                        "cite_in_text": True,
                        "include_in_references": True,
                    },
                ],
            },
        )
        assert resp.status_code == 200, resp.text
        results = resp.json()["results"]
        notes = [r["mapping_note"] for r in results]
        for note in notes:
            assert "In-text citation và Reference entry" not in note
            assert "(In-text)" not in note
            assert "References" not in note
        assert "Khớp đầy đủ giữa trích dẫn trong bài và danh mục tài liệu tham khảo" in notes[0]
        # Verify reasoning_vi and reasoning_en are populated for verified entries too
        assert results[0].get("reasoning_vi")
        assert results[0].get("reasoning_en")
    finally:
        app.dependency_overrides.pop(deps.get_pipeline, None)
        app.dependency_overrides.pop(deps.get_current_user, None)
        if hasattr(essays_route, "_sandbox_verify_rate_buckets"):
            essays_route._sandbox_verify_rate_buckets.clear()


# ---------------------------------------------------------------------------
# 4. Checkout Plan Features — Zero ML / Dev Jargon Across All Tiers
# ---------------------------------------------------------------------------


def test_billing_plan_features_have_zero_ml_or_dev_jargon() -> None:
    forbidden_terms = (
        "neuro-symbolic",
        "dag",
        "bounding-box",
        "sentence-bert",
        "compute queue",
        "layer 1",
        "serpapi",
        "override verdict",
        "high-throughput",
        "tdtu",
    )
    all_en_bullets: list[str] = []
    all_vi_bullets: list[str] = []

    for tier, policy in PLAN_CATALOG.items():
        texts = [
            policy.tagline_en,
            policy.tagline_vi,
            *policy.features_en,
            *policy.features_vi,
            *policy.limitations_en,
            *policy.limitations_vi,
        ]
        all_en_bullets.extend(policy.features_en)
        all_vi_bullets.extend(policy.features_vi)
        for txt in texts:
            low = txt.lower()
            for term in forbidden_terms:
                assert term not in low, f"Plan {tier!r} leaked {term!r} in: {txt!r}"

    joined_en = "\n".join(all_en_bullets)
    joined_vi = "\n".join(all_vi_bullets)
    assert "Step-by-Step Visual Verification Breakdown" in joined_en
    assert "In-Document Citation Highlighting" in joined_en
    assert "Context & Claim Relevance Checking" in joined_en
    assert "faster priority processing" in joined_en.lower()
    assert "(APA, IEEE, Harvard, BibTeX, RIS)" in joined_en
    assert "(APA, IEEE, Harvard, BibTeX, RIS)" in joined_vi
    assert "TDTU" not in joined_en and "TDTU" not in joined_vi
    assert any("tô sáng vị trí trích dẫn" in b.lower() for b in all_vi_bullets)
    assert any("ưu tiên xử lý nhanh hơn" in b.lower() for b in all_vi_bullets)


# ---------------------------------------------------------------------------
# 5. Live SSE Progress Messages — Zero ML / Parser Internals
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_sse_progress_messages_zero_ml_and_parser_jargon(tmp_path: Path, monkeypatch) -> None:
    # 5a. DocumentParser progress messages across cached, live, fallback, and disabled branches
    pdf = tmp_path / "sample.pdf"
    pdf.write_bytes(b"%PDF-1.4\n%fake\n")

    sample_tei = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<TEI xmlns="http://www.tei-c.org/ns/1.0">'
        "<text><body><div><p>Text</p></div></body>"
        "<back><div type=\"references\"><listBibl>"
        '<biblStruct xml:id="b0"><analytic><title>Paper One</title></analytic>'
        '<monogr><imprint><date when="2022"/></imprint></monogr></biblStruct>'
        "</listBibl></div></back></text></TEI>"
    )

    text_doc = Document(
        file_path=str(pdf),
        num_pages=2,
        pages=[
            Page(page_num=1, text="Intro citing Smith (2022).", has_text_layer=True),
            Page(page_num=2, text="References\nSmith, J. (2022). Paper One. Conf.", has_text_layer=True),
        ],
        parser_used="mupdf",
    )

    class _StubMuPdf:
        def parse(self, _path: str) -> Document:
            return text_doc

    def _cfg(enabled: bool) -> Settings:
        s = Settings()
        s.extraction.grobid.enabled = enabled
        return s

    collected_parser_msgs: list[str] = []

    # Cached branch
    fake_mgr = MagicMock()
    fake_mgr.get_from_cache.return_value = sample_tei
    monkeypatch.setattr(
        "integrity_checker.extraction.document_parser.get_grobid_manager",
        lambda: fake_mgr,
    )
    DocumentParser(config=_cfg(True), mupdf_parser=_StubMuPdf()).parse(  # type: ignore[arg-type]
        str(pdf), use_service_manager=True, progress_callback=collected_parser_msgs.append
    )

    # Fallback branch (GROBID error)
    def _fail_post(*_a, **_kw):
        return SimpleNamespace(status_code=500, text="")

    DocumentParser(
        config=_cfg(True),
        mupdf_parser=_StubMuPdf(),  # type: ignore[arg-type]
        grobid_post_fn=_fail_post,
    ).parse(str(pdf), use_service_manager=False, progress_callback=collected_parser_msgs.append)

    # Disabled branch
    DocumentParser(config=_cfg(False), mupdf_parser=_StubMuPdf()).parse(  # type: ignore[arg-type]
        str(pdf), progress_callback=collected_parser_msgs.append
    )

    assert collected_parser_msgs
    for msg in collected_parser_msgs:
        low = msg.lower()
        assert "tei-xml" not in low, msg
        assert "grobid" not in low, msg
        assert "regex parser" not in low, msg
    assert any("Extracting references from document" in m for m in collected_parser_msgs)
    assert any("standard document text reader" in m.lower() for m in collected_parser_msgs)

    # 5b. IntegrityPipeline SSE messages across steps 0-7 (with 8 refs so comparing loop emits too)
    refs = [
        Citation(
            raw_text=f"Author{i}, A. (2022). Sample Paper Title Number {i}. Venue.",
            citation_type=CitationType.REFERENCE_LIST,
            title=f"Sample Paper Title Number {i}",
            authors=[f"Author{i}"],
            year="2022",
            page_num=2,
        )
        for i in range(1, 9)
    ]

    mock_doc_parser = MagicMock()
    mock_doc_parser.parse.return_value = SimpleNamespace(
        document=text_doc,
        body_citations=[],
        appendix_citations=[],
        references=refs,
        parser_warnings=[],
    )

    mock_orch = MagicMock()
    mock_orch.retrieve = AsyncMock(
        side_effect=lambda c, **_kw: SourceResult(
            citation_raw=c.raw_text,
            candidates=[
                SourceCandidate(
                    source_name="crossref",
                    found=True,
                    title=c.title or "Sample",
                    authors=c.authors,
                    year=c.year,
                    confidence=0.95,
                )
            ],
            sources_queried=["crossref"],
            sources_succeeded=["crossref"],
        )
    )

    class _StubChecker:
        def compare_evidence(self, citation, source, context=None):
            return {"stub": True}

        def check(self, citation, source, precomputed_features=None, **_kw):
            v = MagicMock()
            v.citation = citation
            v.label.value = "verified"
            v.confidence = 0.95
            v.reasoning = "Matched"
            v.triggered_rules = []
            v.mismatched_fields = []
            v.features = SimpleNamespace(
                title_sim_fuzzy=1.0,
                title_sim_semantic=1.0,
                author_jaccard=1.0,
                year_distance=0,
                doi_exact_match=False,
                source_consensus=1,
            )
            return v

    pipeline = IntegrityPipeline(
        document_parser=mock_doc_parser,
        use_document_parser=True,
        orchestrator=mock_orch,
        checker=_StubChecker(),  # type: ignore[arg-type]
        cis_calc=CISCalculator(),
    )

    sse_messages: list[str] = []
    await pipeline.run_async(
        str(pdf),
        essay_id=505,
        progress_callback=lambda _step, _idx, stats: sse_messages.append(
            str(stats.get("message") or "")
        ),
    )

    assert sse_messages
    for msg in sse_messages:
        low = msg.lower()
        assert "neuro-symbolic" not in low, msg
        assert "platt calibration" not in low, msg
        assert "tei-xml" not in low, msg
        assert "regex parser" not in low, msg
        assert "neural evidence" not in low, msg
        assert "acl fts5" not in low, msg

    assert any(
        re.search(r"Evaluating verification results for \d+ citations", m) for m in sse_messages
    )
    assert any(
        "Comparing citation details and context against matched sources" in m
        for m in sse_messages
    )
