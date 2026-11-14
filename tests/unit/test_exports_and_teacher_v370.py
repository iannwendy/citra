"""Comprehensive unit tests for v3.70.0 Teacher, Verdicts, Exports & RevisionDiff:
- Group 1 (`teacher.py`): `list_class_essays`, `list_pending_reviews`, `get_class_analytics`, `export_class_csv`
- Group 2 (`verdicts.py`, `api_schemas.py`, `bibliography_formatter.py`, `docx_exporter.py`):
  `VerdictSchema` override/composite/HTML-meta fields, safe auto-heal (`R-INCOMPLETE-METADATA`,
  `R-URL-CONTENT-MISMATCH`, `R-CROSS-LINGUAL-TITLE-MATCH`, `tech_standard`), composite `[14a]/[14b]`
  IEEE numbering & `.docx` sibling preservation, `style="tdtu"`, and honest status badges.
- Group 5 (`report.py`): ReportLab `CitraSans` Vietnamese Unicode PDF rendering, CSV `[composite_label]`,
  and `RevisionDiff` (Unicode keys, composite sibling non-collision, bipartite similarity matching for
  repaired `R-INCOMPLETE-METADATA`, `resource` non-issue handling, and skipping `failed`/`queued` uploads).
"""

from __future__ import annotations

import csv
import io
import json
from datetime import UTC, datetime
from pathlib import Path

import fitz
import pytest
from docx import Document as WordDocument
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from integrity_checker.api.routes.report import (
    _compute_revision_diff,
    _csv_response,
    _generate_pdf_bytes,
    _json_response,
    _register_unicode_pdf_fonts,
    _verdict_canonical_key,
    export_healed_docx_endpoint,
)
from integrity_checker.api.routes.teacher import (
    export_class_csv,
    get_class_analytics,
    list_class_essays,
    list_pending_reviews,
)
from integrity_checker.api.routes.verdicts import (
    OverrideRequest,
    get_verdicts,
    override_verdict,
)
from integrity_checker.db.models import (
    Base,
    CitationRecord,
    Class,
    ClassMembership,
    EssayRecord,
    User,
    VerdictRecord,
)
from integrity_checker.db.repository import Repository
from integrity_checker.export.bibliography_formatter import (
    _parse_raw_citation_fallback,
    remediate_verdicts,
)
from integrity_checker.export.docx_exporter import (
    export_auto_healed_docx,
    export_report_to_docx,
)


@pytest.fixture
def mem_db() -> Session:
    """Create a strictly isolated in-memory SQLite session (never touches data/app.db)."""
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    session_factory = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    session = session_factory()
    try:
        yield session
    finally:
        session.close()
        engine.dispose()


async def _read_streaming_text(resp) -> str:
    chunks: list[bytes] = []
    async for chunk in resp.body_iterator:
        if isinstance(chunk, str):
            chunks.append(chunk.encode("utf-8"))
        else:
            chunks.append(bytes(chunk))
    return b"".join(chunks).decode("utf-8")


async def _read_streaming_bytes(resp) -> bytes:
    chunks: list[bytes] = []
    async for chunk in resp.body_iterator:
        if isinstance(chunk, str):
            chunks.append(chunk.encode("utf-8"))
        else:
            chunks.append(bytes(chunk))
    return b"".join(chunks)


# ---------------------------------------------------------------------------
# Group 1 — teacher.py: Classroom, Pending Reviews, Analytics, Class CSV
# ---------------------------------------------------------------------------


def test_teacher_list_class_essays_job_status_and_cis_score(mem_db: Session) -> None:
    teacher = User(
        username="prof_linh",
        password_hash="x",
        role="teacher",
        plan_tier="ultra",
        is_active=1,
    )
    student = User(
        username="sv_minh",
        password_hash="x",
        role="user",
        plan_tier="pro",
        is_active=1,
    )
    mem_db.add_all([teacher, student])
    mem_db.flush()

    cls = Class(name="CS501 Thesis", teacher_id=teacher.id, join_code="CITRA-501A")
    mem_db.add(cls)
    mem_db.flush()
    mem_db.add(ClassMembership(class_id=cls.id, student_id=student.id))

    e_done = EssayRecord(
        filename="Thesis_v1.pdf",
        num_pages=14,
        user_id=student.id,
        class_id=cls.id,
        cis_json=json.dumps({"score": 88.4}),
        job_status="completed",
        job_attempt_count=1,
        quota_charged=1,
    )
    e_failed = EssayRecord(
        filename="Corrupt_Scan.pdf",
        num_pages=3,
        user_id=student.id,
        class_id=cls.id,
        cis_json=None,
        job_status="failed",
        job_error="OCR worker timeout after 60s",
        job_attempt_count=2,
        quota_charged=0,
    )
    mem_db.add_all([e_done, e_failed])
    mem_db.commit()

    items = list_class_essays(class_id=cls.id, teacher=teacher, db=mem_db)
    by_name = {it.filename: it for it in items}

    assert by_name["Thesis_v1.pdf"].job_status == "completed"
    assert by_name["Thesis_v1.pdf"].cis_score == pytest.approx(88.4)
    assert by_name["Thesis_v1.pdf"].quota_charged is True
    assert by_name["Thesis_v1.pdf"].job_error is None

    assert by_name["Corrupt_Scan.pdf"].job_status == "failed"
    assert by_name["Corrupt_Scan.pdf"].job_error == "OCR worker timeout after 60s"
    assert by_name["Corrupt_Scan.pdf"].job_attempt_count == 2
    assert by_name["Corrupt_Scan.pdf"].quota_charged is False
    assert by_name["Corrupt_Scan.pdf"].cis_score is None


def test_teacher_list_pending_reviews_composite_and_url_meta(mem_db: Session) -> None:
    teacher = User(username="prof_hoa", password_hash="x", role="teacher", is_active=1)
    student = User(username="sv_nam", password_hash="x", role="user", is_active=1)
    mem_db.add_all([teacher, student])
    mem_db.flush()

    cls = Class(name="AI Ethics", teacher_id=teacher.id, join_code="CITRA-AI01")
    mem_db.add(cls)
    mem_db.flush()
    mem_db.add(ClassMembership(class_id=cls.id, student_id=student.id))

    essay = EssayRecord(
        filename="Ethics_Essay.pdf",
        num_pages=8,
        user_id=student.id,
        class_id=cls.id,
        cis_json=json.dumps({"score": 65.0}),
        job_status="completed",
    )
    mem_db.add(essay)
    mem_db.flush()

    features_payload = {
        "numeric_index": 14,
        "sub_index": "a",
        "composite_label": "14a",
        "url_status": "live_mismatch",
        "url_status_code": 200,
        "archive_url": "https://web.archive.org/web/20250101/https://example.org/post",
        "html_meta": {"title": "Unrelated Marketing Page", "is_soft_404": False},
        "matched_sources": [{"source_name": "crossref", "title": "Real Paper"}],
    }
    verdict = VerdictRecord(
        essay_id=essay.id,
        citation_raw="[14a] Smith, J. (2024). Retracted Claims. https://example.org/post.",
        label="metadata_error",
        confidence=0.82,
        reasoning="Observed web page title does not match cited paper.",
        triggered_rules=json.dumps(["R-URL-CONTENT-MISMATCH", "R-RETRACTED-PAPER"]),
        mismatched_fields=json.dumps(["title", "url"]),
        features=json.dumps(features_payload),
        is_overridden=0,
    )
    mem_db.add(verdict)
    mem_db.commit()

    pending = list_pending_reviews(class_id=cls.id, teacher=teacher, db=mem_db)
    assert len(pending) == 1
    item = pending[0]
    assert item.composite_label == "14a"
    assert item.numeric_index == 14
    assert item.sub_index == "a"
    assert item.triggered_rules == ["R-URL-CONTENT-MISMATCH", "R-RETRACTED-PAPER"]
    assert item.mismatched_fields == ["title", "url"]
    assert item.url_status == "live_mismatch"
    assert item.url_status_code == 200
    assert item.archive_url == "https://web.archive.org/web/20250101/https://example.org/post"
    assert item.cited_url == "https://example.org/post"
    assert item.html_meta == {"title": "Unrelated Marketing Page", "is_soft_404": False}
    assert item.is_retracted is True
    assert len(item.matched_sources) == 1


@pytest.mark.asyncio
async def test_teacher_analytics_and_class_csv_contracts(mem_db: Session) -> None:
    teacher = User(username="prof_duc", password_hash="x", role="teacher", is_active=1)
    s1 = User(username="alice_vn", password_hash="x", role="user", is_active=1)
    s2 = User(username="bob_vn", password_hash="x", role="user", is_active=1)
    mem_db.add_all([teacher, s1, s2])
    mem_db.flush()

    cls = Class(name="NLP Cohort", teacher_id=teacher.id, join_code="CITRA-NLP9")
    mem_db.add(cls)
    mem_db.flush()
    mem_db.add_all(
        [
            ClassMembership(class_id=cls.id, student_id=s1.id),
            ClassMembership(class_id=cls.id, student_id=s2.id),
        ]
    )

    e1 = EssayRecord(
        filename="Alice_Paper.pdf",
        num_pages=10,
        user_id=s1.id,
        class_id=cls.id,
        cis_json=json.dumps({"score": 90.0}),
        job_status="completed",
    )
    e2 = EssayRecord(
        filename="Bob_Paper.pdf",
        num_pages=12,
        user_id=s2.id,
        class_id=cls.id,
        cis_json=json.dumps({"score": 80.0}),
        job_status="completed",
    )
    e_failed = EssayRecord(
        filename="Bob_Broken.pdf",
        num_pages=0,
        user_id=s2.id,
        class_id=cls.id,
        cis_json=None,
        job_status="failed",
        job_error="Corrupted PDF",
    )
    e_queued = EssayRecord(
        filename="Alice_InFlight.pdf",
        num_pages=5,
        user_id=s1.id,
        class_id=cls.id,
        cis_json=None,
        job_status="processing",
    )
    mem_db.add_all([e1, e2, e_failed, e_queued])
    mem_db.flush()

    mem_db.add_all(
        [
            VerdictRecord(
                essay_id=e1.id,
                citation_raw="[14a] Nguyen & Tran (2025). Synthetic Hallucinated Transformer.",
                label="suspected_hallucination",
                confidence=0.93,
                triggered_rules=json.dumps(["R-HALLUCINATED-DOI"]),
                features=json.dumps({"composite_label": "14a"}),
            ),
            VerdictRecord(
                essay_id=e1.id,
                citation_raw="Vaswani, Attention Is All You Need",
                label="metadata_error",
                confidence=0.75,
                triggered_rules=json.dumps(["R-INCOMPLETE-METADATA"]),
                features=json.dumps({}),
            ),
            VerdictRecord(
                essay_id=e1.id,
                citation_raw="Legacy Unverified Entry (2021). Obscure Monograph.",
                label="unverified",
                confidence=0.40,
                triggered_rules=json.dumps([]),
                features=json.dumps({}),
            ),
            VerdictRecord(
                essay_id=e2.id,
                citation_raw="[2] (b) Nguyen & Tran (2025). Synthetic Hallucinated Transformer.",
                label="unresolved",
                confidence=0.50,
                triggered_rules=json.dumps([]),
                features=json.dumps({"composite_label": "2b"}),
            ),
            VerdictRecord(
                essay_id=e2.id,
                citation_raw="Chính phủ (2025). Nghị định 356/2025/NĐ-CP.",
                label="resource",
                confidence=0.95,
                triggered_rules=json.dumps([]),
                features=json.dumps({}),
            ),
        ]
    )
    mem_db.commit()

    analytics = get_class_analytics(class_id=cls.id, teacher=teacher, db=mem_db)
    assert analytics.total_essays == 4
    assert analytics.failed_essays == 1
    assert analytics.queued_essays == 1
    # Failed & processing essays with cis_json=None MUST NOT drag avg_cis down from 85.0
    assert analytics.avg_cis == pytest.approx(85.0)
    assert sum(analytics.cis_distribution.values()) == 2
    assert "unverified" not in analytics.verdict_breakdown
    assert analytics.verdict_breakdown["unresolved"] == 2
    assert analytics.verdict_breakdown["incomplete_metadata"] == 1
    assert analytics.verdict_breakdown["resource"] == 1

    # [14a] and [2] (b) must normalize to the same shared hallucination cluster
    shared = [s for s in analytics.shared_hallucinations if s.is_shared]
    assert len(shared) == 1
    assert shared[0].student_count == 2
    assert set(shared[0].students) == {"alice_vn", "bob_vn"}

    # Verify export.csv contract: exact 7 leading columns + 4 appended trailing columns
    csv_resp = export_class_csv(class_id=cls.id, teacher=teacher, db=mem_db)
    csv_text = await _read_streaming_text(csv_resp)
    rows = list(csv.reader(io.StringIO(csv_text)))
    assert rows[0][:7] == [
        "filename",
        "student",
        "verdict_id",
        "label",
        "confidence",
        "validated_at",
        "is_overridden",
    ]
    assert rows[0][7:] == [
        "job_status",
        "composite_label",
        "triggered_rules",
        "citation_raw",
    ]
    # 5 verdict rows + 2 verdict-less essays (failed + processing) = 7 data rows + 1 header = 8 rows
    assert len(rows) == 8
    failed_rows = [r for r in rows[1:] if r[0] == "Bob_Broken.pdf"]
    assert len(failed_rows) == 1
    assert failed_rows[0][7] == "failed"
    comp_rows = [r for r in rows[1:] if r[8] == "14a"]
    assert len(comp_rows) == 1
    assert "R-HALLUCINATED-DOI" in comp_rows[0][9]


# ---------------------------------------------------------------------------
# Group 2 — verdicts.py, api_schemas.py, report.py override serialization
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_verdicts_and_report_json_override_and_composite_fields(mem_db: Session) -> None:
    teacher = User(
        username="reviewer_teacher",
        password_hash="x",
        role="teacher",
        plan_tier="ultra",
        is_active=1,
        can_override_verdicts=1,
    )
    mem_db.add(teacher)
    mem_db.flush()

    essay = EssayRecord(
        filename="Composite_Study.pdf",
        num_pages=6,
        user_id=teacher.id,
        cis_json=json.dumps({"score": 70.0}),
        job_status="completed",
    )
    mem_db.add(essay)
    mem_db.flush()

    cit = CitationRecord(
        essay_id=essay.id,
        raw_text="[14b] (b) Goodfellow, I. (2014). Generative Adversarial Nets. https://papers.nips.cc/gan",
        citation_type="reference_list",
        numeric_index=14,
        sub_index="b",
        composite_label="14b",
        url="https://papers.nips.cc/gan",
    )
    verdict = VerdictRecord(
        essay_id=essay.id,
        citation_raw=cit.raw_text,
        label="metadata_error",
        confidence=0.78,
        reasoning="Venue abbreviated.",
        triggered_rules=json.dumps(["R-VENUE-MISMATCH"]),
        mismatched_fields=json.dumps(["venue"]),
        features=json.dumps(
            {
                "numeric_index": 14,
                "sub_index": "b",
                "composite_label": "14b",
                "html_meta": {"title": "Generative Adversarial Nets - NeurIPS"},
                "html_meta_title_sim": 0.94,
            }
        ),
    )
    mem_db.add_all([cit, verdict])
    mem_db.commit()

    v_list = get_verdicts(essay_id=essay.id, current_user=teacher, db=mem_db)
    assert len(v_list) == 1
    assert v_list[0].composite_label == "14b"
    assert v_list[0].numeric_index == 14
    assert v_list[0].sub_index == "b"
    assert v_list[0].cited_url == "https://papers.nips.cc/gan"
    assert v_list[0].html_meta == {"title": "Generative Adversarial Nets - NeurIPS"}
    assert v_list[0].html_meta_title_sim == pytest.approx(0.94)
    assert v_list[0].override_record is None

    updated = override_verdict(
        essay_id=essay.id,
        verdict_id=str(verdict.id),
        body=OverrideRequest(
            new_label="verified",
            reason="Standard NeurIPS abbreviation accepted by committee",
        ),
        current_user=teacher,
        db=mem_db,
    )
    assert updated.is_overridden is True
    assert updated.override_note == "Standard NeurIPS abbreviation accepted by committee"
    assert updated.overridden_by == "reviewer_teacher"
    assert updated.overridden_at is not None
    assert updated.override_record is not None
    assert updated.override_record["original_label"] == "metadata_error"
    assert updated.override_record["overridden_label"] == "verified"
    assert updated.override_record["overridden_by"] == "reviewer_teacher"

    repo = Repository(mem_db)
    report_resp = _json_response(
        essay.filename,
        essay,
        repo.get_verdicts(essay.id),
        repo.get_citations(essay.id),
        repo=repo,
    )
    report_payload = json.loads(await _read_streaming_text(report_resp))
    rv = report_payload["verdicts"][0]
    assert rv["composite_label"] == "14b"
    assert rv["cited_url"] == "https://papers.nips.cc/gan"
    assert rv["overridden_by"] == "reviewer_teacher"
    assert rv["overridden_at"] is not None
    assert rv["override_note"] == "Standard NeurIPS abbreviation accepted by committee"
    assert rv["override_record"]["original_label"] == "metadata_error"
    assert rv["override_record"]["overridden_label"] == "verified"


# ---------------------------------------------------------------------------
# Group 3 — bibliography_formatter.py & docx_exporter.py
# ---------------------------------------------------------------------------


def test_bibliography_safe_auto_heal_and_composite_ieee() -> None:
    # 1. Prefix stripping on composite sub-references
    parsed_sub = _parse_raw_citation_fallback(
        "[14a] (a) LeCun, Y., Bottou, L. (1998). Gradient-based learning applied to document recognition. IEEE."
    )
    assert not any("(a)" in a.lower() for a in parsed_sub["authors"])
    assert not parsed_sub["title"].lower().startswith("(a)")

    verdicts = [
        # (A) R-INCOMPLETE-METADATA with no scholarly match -> NEVER "Anonymous (n.d.)"
        {
            "citation_raw": "[7] Vaswani, Attention Is All You Need",
            "label": "metadata_error",
            "triggered_rules": ["R-INCOMPLETE-METADATA"],
            "mismatched_fields": ["year", "venue"],
            "matched_sources": [],
        },
        # (B) R-URL-CONTENT-MISMATCH with web_html_meta -> NEVER heal from mismatched web page
        {
            "citation_raw": "Doe, J. (2023). Neural Rendering Survey. https://spam-domain.example/shoes",
            "label": "metadata_error",
            "triggered_rules": ["R-URL-CONTENT-MISMATCH"],
            "mismatched_fields": ["url"],
            "html_meta": {"title": "Buy Discount Running Shoes", "is_soft_404": False},
            "matched_sources": [
                {
                    "source_name": "web_html_meta",
                    "found": True,
                    "title": "Buy Discount Running Shoes",
                    "authors": ["Shoe Store"],
                    "year": 2025,
                },
                {
                    "source_name": "wayback_html_meta",
                    "found": True,
                    "title": "Buy Discount Running Shoes",
                    "authors": ["Shoe Store"],
                    "year": 2024,
                },
            ],
        },
        # (C) R-CROSS-LINGUAL-TITLE-MATCH -> heal translated Vietnamese title to canonical English title
        {
            "citation_raw": "Vaswani, A., Shazeer, N. (2017). Chú ý là tất cả những gì bạn cần. NeurIPS.",
            "label": "metadata_error",
            "triggered_rules": ["R-CROSS-LINGUAL-TITLE-MATCH"],
            "mismatched_fields": ["title"],
            "features": {
                "cross_lingual_title_detected": True,
                "cross_lingual_title_sim": 0.78,
            },
            "matched_sources": [
                {
                    "source_name": "openalex",
                    "found": True,
                    "title": "Attention Is All You Need",
                    "authors": ["Ashish Vaswani", "Noam Shazeer"],
                    "year": 2017,
                    "venue": "Advances in Neural Information Processing Systems",
                    "doi": "10.48550/arXiv.1706.03762",
                }
            ],
        },
        # (D) tech_standard trusted registry -> heal wrong year on ISO/IEC standard
        {
            "citation_raw": "ISO/IEC 27001:2018 Information security management systems.",
            "label": "metadata_error",
            "triggered_rules": ["R-YEAR-MISMATCH"],
            "mismatched_fields": ["year"],
            "matched_sources": [
                {
                    "source_name": "tech_standard",
                    "found": True,
                    "code": "ISO/IEC 27001",
                    "title": "ISO/IEC 27001:2022 Information security, cybersecurity and privacy protection",
                    "authors": ["ISO/IEC"],
                    "year": 2022,
                    "venue": "International Standard",
                }
            ],
        },
        # (E) Composite [14a] and [14b] followed by [15]
        {
            "citation_raw": "[14a] (a) LeCun, Y. (1998). Gradient-based learning. Proc. IEEE.",
            "label": "verified",
            "composite_label": "14a",
            "numeric_index": 14,
            "sub_index": "a",
            "matched_sources": [],
        },
        {
            "citation_raw": "[14b] (b) Hochreiter, S., & Schmidhuber, J. (1997). Long short-term memory. Neural Computation.",
            "label": "verified",
            "composite_label": "14b",
            "numeric_index": 14,
            "sub_index": "b",
            "matched_sources": [],
        },
        {
            "citation_raw": "[15] He, K., Zhang, X. (2016). Deep residual learning for image recognition. CVPR.",
            "label": "verified",
            "numeric_index": 15,
            "matched_sources": [],
        },
        # (F) Unresolved & Resource statuses
        {
            "citation_raw": "Trần Văn B (2021). Tài liệu lưu hành nội bộ khoa CNTT.",
            "label": "unresolved",
            "matched_sources": [],
        },
        {
            "citation_raw": "Chính phủ (2025). Nghị định 356/2025/NĐ-CP về Bảo vệ dữ liệu cá nhân.",
            "label": "resource",
            "matched_sources": [],
        },
    ]

    entries = remediate_verdicts(verdicts, style="ieee")

    # (A) Incomplete metadata preserved, never Anonymous
    e_inc = entries[0]
    assert "Anonymous" not in e_inc.apa
    assert "Anonymous" not in e_inc.ieee
    assert "Vaswani, Attention Is All You Need" in e_inc.apa
    assert e_inc.was_modified is False
    assert e_inc.remediation_status == "manual_review"

    # (B) Mismatched web page excluded
    e_url = entries[1]
    assert "Running Shoes" not in e_url.apa
    assert e_url.was_modified is False
    assert e_url.remediation_status == "manual_review"

    # (C) Cross-lingual title healed to canonical English title
    e_xl = entries[2]
    assert e_xl.was_modified is True
    assert e_xl.remediation_status == "repaired"
    assert "Attention Is All You Need" in e_xl.apa
    assert "Attention Is All You Need" in e_xl.tdtu

    # (D) Tech standard healed
    e_std = entries[3]
    assert e_std.was_modified is True
    assert e_std.remediation_status == "repaired"
    assert "2022" in e_std.apa

    # (E) IEEE [display_index] synchronized with manuscript body markers
    assert entries[4].display_index == "14a"
    assert entries[4].ieee.startswith("[14a]")
    assert entries[5].display_index == "14b"
    assert entries[5].ieee.startswith("[14b]")
    assert entries[6].display_index == "15"
    assert entries[6].ieee.startswith("[15]")

    # (F) Unresolved -> manual_review, Resource -> resource
    assert entries[7].remediation_status == "manual_review"
    assert entries[7].was_modified is False
    assert entries[8].remediation_status == "resource"
    assert entries[8].was_modified is False


@pytest.mark.asyncio
async def test_docx_exports_composite_siblings_tdtu_style_and_honest_badges(
    tmp_path: Path,
    mem_db: Session,
) -> None:
    orig_doc = WordDocument()
    orig_doc.add_heading("KLTN TDTU", level=1)
    orig_doc.add_paragraph("Tài liệu tham khảo")
    orig_doc.add_paragraph(
        "[14] (a) Vaswani, A., & Shazeer, N. (2019). Attention Is All You Need. NeurIPS; "
        "(b) Devlin, J., & Chang, M. (2019). BERT Pre-training of Deep Bidirectional Transformers. NAACL."
    )
    orig_doc.add_paragraph(" Vaswani, Incomplete Stub Without Year ")
    orig_doc.add_paragraph("Obscure Local Thesis (2020). Unindexed Campus Print.")
    orig_docx_path = tmp_path / "thesis_composite.docx"
    orig_doc.save(str(orig_docx_path))

    verdicts = [
        {
            "citation_raw": "[14a] (a) Vaswani, A., & Shazeer, N. (2019). Attention Is All You Need. NeurIPS",
            "label": "metadata_error",
            "numeric_index": 14,
            "sub_index": "a",
            "composite_label": "14a",
            "mismatched_fields": ["year"],
            "matched_sources": [
                {
                    "source_name": "acl",
                    "found": True,
                    "title": "Attention Is All You Need",
                    "authors": ["Ashish Vaswani", "Noam Shazeer"],
                    "year": 2017,
                    "venue": "NeurIPS",
                    "doi": "10.48550/arXiv.1706.03762",
                }
            ],
        },
        {
            "citation_raw": "[14b] (b) Devlin, J., & Chang, M. (2019). BERT Pre-training of Deep Bidirectional Transformers. NAACL.",
            "label": "verified",
            "numeric_index": 14,
            "sub_index": "b",
            "composite_label": "14b",
            "matched_sources": [],
        },
        {
            "citation_raw": "Vaswani, Incomplete Stub Without Year",
            "label": "metadata_error",
            "triggered_rules": ["R-INCOMPLETE-METADATA"],
            "matched_sources": [],
        },
        {
            "citation_raw": "Obscure Local Thesis (2020). Unindexed Campus Print.",
            "label": "unresolved",
            "matched_sources": [],
        },
        {
            "citation_raw": "Chính phủ (2025). Nghị định 356/2025/NĐ-CP.",
            "label": "resource",
            "matched_sources": [],
        },
    ]

    healed_bytes = export_auto_healed_docx(
        essay_filename="thesis_composite.docx",
        verdicts=verdicts,
        style="tdtu",
        original_docx_path=str(orig_docx_path),
    )
    reopened = WordDocument(io.BytesIO(healed_bytes))
    para_text = "\n".join(p.text for p in reopened.paragraphs)
    table_text = "\n".join(
        cell.text for tbl in reopened.tables for row in tbl.rows for cell in row.cells
    )

    # Both sibling sub-entries (14a AND 14b) MUST survive in the composite paragraph!
    assert "Attention Is All You Need" in para_text
    assert "2017" in para_text
    assert "BERT Pre-training of Deep Bidirectional Transformers" in para_text
    assert "TDTU" in para_text

    # Honest status badges in Change Log table (unresolved/incomplete/resource NEVER stamped VERIFIED)
    assert "[INCOMPLETE METADATA — MANUAL COMPLETION REQUIRED]" in table_text
    assert "[UNRESOLVED — MANUAL CHECK]" in table_text
    assert "[WEB / STATUTORY RESOURCE]" in table_text

    # Verify export-healed-docx route accepts style="TDTU" case-insensitively and rejects invalid style
    pro_user = User(
        username="tdtu_student",
        password_hash="x",
        role="user",
        plan_tier="pro",
        is_active=1,
    )
    mem_db.add(pro_user)
    mem_db.flush()
    essay_row = EssayRecord(
        filename="thesis_composite.docx",
        num_pages=4,
        user_id=pro_user.id,
        cis_json=json.dumps({"score": 78.0}),
        job_status="completed",
    )
    mem_db.add(essay_row)
    mem_db.commit()

    resp_tdtu = export_healed_docx_endpoint(
        essay_id=essay_row.id,
        style="TDTU",
        current_user=pro_user,
        db=mem_db,
    )
    tdtu_bytes = await _read_streaming_bytes(resp_tdtu)
    assert len(tdtu_bytes) > 500

    with pytest.raises(HTTPException) as exc_info:
        export_healed_docx_endpoint(
            essay_id=essay_row.id,
            style="harvard_invalid",
            current_user=pro_user,
            db=mem_db,
        )
    assert exc_info.value.status_code == 400

    # Verify audit report DOCX distinguishes all 5 labels + R-INCOMPLETE-METADATA + diagnostics
    audit_docx_bytes = export_report_to_docx(
        filename="thesis_composite.docx",
        cis_score=78.0,
        num_citations=5,
        num_verified=1,
        num_metadata_error=2,
        num_suspected=0,
        num_unresolved=1,
        num_resource=1,
        verdicts=[
            {
                **verdicts[0],
                "url_status": "dead_archived",
                "archive_url": "https://web.archive.org/web/2024/https://example.org",
                "html_meta": {"title": "Archived NeurIPS Paper"},
            },
            *verdicts[1:],
        ],
        document_diagnostics={
            "parser_used": "MuPdfParser+OCR",
            "ocr_pages_recovered": [2, 5],
            "legacy_encoding_detected": "TCVN3",
            "legacy_encoding_pages_count": 2,
        },
    )
    audit_doc = WordDocument(io.BytesIO(audit_docx_bytes))
    audit_full_text = "\n".join(p.text for p in audit_doc.paragraphs) + "\n" + "\n".join(
        cell.text for tbl in audit_doc.tables for row in tbl.rows for cell in row.cells
    )
    assert "[14a]" in audit_full_text
    assert "INCOMPLETE METADATA" in audit_full_text
    assert "UNRESOLVED" in audit_full_text
    assert "RESOURCE" in audit_full_text
    assert "MuPdfParser+OCR" in audit_full_text
    assert "TCVN3" in audit_full_text
    assert "Archived NeurIPS Paper" in audit_full_text


# ---------------------------------------------------------------------------
# Group 5 — report.py: Unicode PDF (CitraSans), CSV composite_label, RevisionDiff
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_pdf_vietnamese_unicode_rendering_and_csv_composite_label() -> None:
    font_reg, font_bold = _register_unicode_pdf_fonts()
    assert font_reg == "CitraSans"
    assert font_bold == "CitraSans-Bold"

    class DummyEssay:
        id = 42
        filename = "Luận_văn_Nguyễn_Văn_A_ĐH_Tôn_Đức_Thắng.pdf"
        num_pages = 25
        cis_json = json.dumps({"score": 84.5})
        style_profile_json = json.dumps(
            {
                "document_diagnostics": {
                    "is_scanned_pdf": False,
                    "parser_used": "MuPdfParser",
                    "ocr_pages_recovered": [3],
                    "legacy_encoding_detected": "TCVN3",
                    "legacy_encoding_pages_count": 1,
                }
            }
        )

    class DummyVerdict:
        def __init__(
            self,
            raw: str,
            label: str,
            *,
            comp: str | None = None,
            rules: list[str] | None = None,
        ) -> None:
            self.citation_raw = raw
            self.label = label
            self.confidence = 0.92
            self.mapping_status = "matched"
            self.mapping_confidence = 0.95
            self.reasoning = "Kiểm chứng thành công với đầy đủ dấu tiếng Việt."
            self.triggered_rules = json.dumps(rules or [])
            self.mismatched_fields = "[]"
            self.is_overridden = 0
            self.style_penalty = 0.0
            self.domain_exception = 0
            self.features = json.dumps({"composite_label": comp} if comp else {})

    verdicts = [
        DummyVerdict(
            "Nguyễn Văn A, Đặng Thị Ước (2024). Giáo trình Đại học Tôn Đức Thắng về Học sâu.",
            "verified",
            comp="14a",
        ),
        DummyVerdict(
            "Chính phủ (2025). Nghị định 356/2025/NĐ-CP quy định chi tiết Luật Bảo vệ dữ liệu cá nhân.",
            "resource",
        ),
        DummyVerdict(
            "Lê Hoàng B, Thiếu năm xuất bản và nhà xuất bản",
            "metadata_error",
            rules=["R-INCOMPLETE-METADATA"],
        ),
    ]

    pdf_bytes = _generate_pdf_bytes(DummyEssay(), verdicts)
    assert pdf_bytes.startswith(b"%PDF-")

    from reportlab.pdfbase import pdfmetrics

    assert "CitraSans" in pdfmetrics.getRegisteredFontNames()
    assert "CitraSans-Bold" in pdfmetrics.getRegisteredFontNames()

    pdf_doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    try:
        fonts_on_p1 = [f[3] for f in pdf_doc[0].get_fonts()]
        assert any(
            any(tag in fname for tag in ("CitraSans", "DejaVuSans", "Arial"))
            for fname in fonts_on_p1
        ), fonts_on_p1
        extracted_text = " ".join(
            " ".join(page.get_text().split()) for page in pdf_doc
        )
    finally:
        pdf_doc.close()

    assert "Nguyễn Văn A" in extracted_text
    assert "Đặng Thị Ước" in extracted_text
    assert "Giáo trình Đại học Tôn Đức Thắng" in extracted_text
    assert "Nghị định 356/2025/NĐ-CP" in extracted_text
    assert "[14a]" in extracted_text
    assert "Incomplete Metadata" in extracted_text
    assert "Resource" in extracted_text
    assert "TCVN3" in extracted_text

    csv_resp = _csv_response("Luận_văn.pdf", verdicts)
    csv_rows = list(csv.reader(io.StringIO(await _read_streaming_text(csv_resp))))
    assert csv_rows[0][-1] == "composite_label"
    assert csv_rows[1][0].startswith("[14a] Nguyễn Văn A")
    assert csv_rows[1][-1] == "14a"


def test_revision_diff_vietnamese_composite_bipartite_and_skip_failed() -> None:
    # 1. Unicode canonical key preserves Vietnamese diacritics and strips [14a] / (a)
    vn_key = _verdict_canonical_key(
        "[14a] (a) Nguyễn Văn An (2023). Giáo trình Luật Thương mại Điện tử. NXB Chính trị."
    )
    assert "nguyễn" in vn_key
    assert "giáo" in vn_key
    assert "trình" in vn_key
    assert "14a" not in vn_key

    class RevVerdict:
        def __init__(
            self,
            raw: str,
            label: str,
            *,
            comp: str | None = None,
            rules: list[str] | None = None,
        ) -> None:
            self.citation_raw = raw
            self.label = label
            self.triggered_rules = json.dumps(rules or [])
            self.features = json.dumps({"composite_label": comp} if comp else {})

    class RevEssay:
        def __init__(
            self,
            eid: int,
            filename: str,
            cis_score: float | None,
            *,
            job_status: str = "completed",
        ) -> None:
            self.id = eid
            self.filename = filename
            self.user_id = 7
            self.uploaded_at = datetime(2026, 5, 1, tzinfo=UTC)
            self.job_status = job_status
            self.cis_json = json.dumps({"score": cis_score}) if cis_score is not None else None

    class RevRepo:
        def __init__(self, essays: list[RevEssay], verdicts_map: dict[int, list[RevVerdict]]) -> None:
            self._essays = essays
            self._verdicts = verdicts_map

        def get_user_essays(self, user_id: int) -> list[RevEssay]:
            return self._essays

        def get_verdicts(self, essay_id: int) -> list[RevVerdict]:
            return self._verdicts.get(essay_id, [])

    e_v1 = RevEssay(10, "Luan_Van_AI_v1.pdf", 55.0, job_status="completed")
    # Intermediate failed & queued uploads between v1 (#10) and v2 (#13) MUST be skipped!
    e_failed = RevEssay(11, "Luan_Van_AI_v2_draft.pdf", None, job_status="failed")
    e_queued = RevEssay(12, "Luan_Van_AI_v2_retry.pdf", None, job_status="queued")
    e_v2 = RevEssay(13, "Luan_Van_AI_v2_final.pdf", 96.0, job_status="completed")

    v1_verdicts = [
        # Incomplete stub in v1 -> completed with full metadata + DOI in v2 (bipartite match!)
        RevVerdict(
            "Vaswani, Attention Is All You Need",
            "metadata_error",
            rules=["R-INCOMPLETE-METADATA"],
        ),
        # Composite siblings [14a] and [14b] with identical short text must NOT overwrite each other
        RevVerdict(
            "[14a] (a) Nguyễn Văn A (2022). Nghiên cứu Trí tuệ Nhân tạo.",
            "metadata_error",
            comp="14a",
        ),
        RevVerdict(
            "[14b] (b) Nguyễn Văn A (2022). Nghiên cứu Trí tuệ Nhân tạo.",
            "unresolved",
            comp="14b",
        ),
    ]

    v2_verdicts = [
        RevVerdict(
            "Vaswani, A., Shazeer, N., et al. (2017). Attention Is All You Need. NeurIPS. https://doi.org/10.48550/arXiv.1706.03762",
            "verified",
        ),
        RevVerdict(
            "[14a] (a) Nguyễn Văn A (2022). Nghiên cứu Trí tuệ Nhân tạo.",
            "verified",
            comp="14a",
        ),
        RevVerdict(
            "[14b] (b) Nguyễn Văn A (2022). Nghiên cứu Trí tuệ Nhân tạo.",
            "resource",
            comp="14b",
        ),
        # Newly added resource in v2 must NOT count as a new issue
        RevVerdict(
            "Chính phủ (2025). Nghị định 356/2025/NĐ-CP.",
            "resource",
        ),
    ]

    repo = RevRepo(
        [e_v2, e_queued, e_failed, e_v1],
        {10: v1_verdicts, 11: [], 12: [], 13: v2_verdicts},
    )

    diff = _compute_revision_diff(repo, e_v2, v2_verdicts)  # type: ignore[arg-type]
    assert diff is not None
    assert diff["previous_essay_id"] == 10
    assert diff["cis_before"] == pytest.approx(55.0)
    assert diff["cis_after"] == pytest.approx(96.0)
    assert diff["counts_before"]["incomplete_metadata"] == 1
    assert diff["counts_after"]["incomplete_metadata"] == 0
    assert diff["counts_delta"]["incomplete_metadata"] == -1
    assert diff["counts_after"]["resource"] == 2

    # All 3 v1 issues (bipartite stub + 14a->verified + 14b->resource) resolved, 0 new issues!
    assert diff["resolved_issues_count"] == 3
    assert diff["persisting_issues_count"] == 0
    assert diff["new_issues_count"] == 0
    comp_labels_resolved = {r["composite_label"] for r in diff["resolved_issues"]}
    assert "14a" in comp_labels_resolved
    assert "14b" in comp_labels_resolved
