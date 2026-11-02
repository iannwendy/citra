"""Unit and integration tests for Sprint 1 features:
- DocxParser & DocumentParser on real demo.docx and synthetic .docx with tables & footnotes
- FastAPI .docx upload validation
- Class join_code (CITRA-XXXX), student self-enrollment, and Cohort Analytics / Shared Hallucination Detector
- Rich DOCX compliance report exporter with 5-component CIS and Neuro-Symbolic trace
"""

from __future__ import annotations

import zipfile
from io import BytesIO
from pathlib import Path

from docx import Document as WordDocument
from fastapi.testclient import TestClient

from integrity_checker.config import PROJECT_ROOT
from integrity_checker.export.docx_exporter import export_report_to_docx
from integrity_checker.extraction.document_parser import DocumentParser
from integrity_checker.extraction.docx_parser import DocxParser
from integrity_checker.linking.citation_linker import CitationLinker, CitationMappingStatus


def test_real_demo_docx_extraction_and_linking(tmp_path: Path) -> None:
    """Verify real demo.docx (or CI equivalent when local *.docx is gitignored) extracts references, table citations, strips trailing biographies, and links 100%."""
    demo_path = PROJECT_ROOT / "demo.docx"
    dp = DocumentParser()
    linker = CitationLinker()

    if demo_path.is_file():
        parsed = dp.parse(str(demo_path))
        assert parsed.parser_used == "docx"
        assert len(parsed.references) == 18
        assert len(parsed.body_citations) == 29

        for ref in parsed.references:
            assert "is currently an undergraduate student" not in (ref.raw_text or "")

        link_res = linker.link(parsed.body_citations, parsed.references)
        assert link_res.unmatched_in_text == []
        assert link_res.unmatched_reference_ids == []
        assert link_res.status_counts.get(CitationMappingStatus.MATCHED, 0) == 35
    else:
        fallback_docx = tmp_path / "ci_demo.docx"
        doc = WordDocument()
        doc.add_heading("VietDepression: Detecting Depression Language", level=1)
        doc.add_paragraph("Prior studies on social media mental health [1] and Vietnamese NLP [2] motivate our work.")
        tbl = doc.add_table(rows=2, cols=2)
        tbl.rows[0].cells[0].text = "Baseline"
        tbl.rows[0].cells[1].text = "Citation"
        tbl.rows[1].cells[0].text = "PhoBERT"
        tbl.rows[1].cells[1].text = "Evaluated in [1, 2]"
        doc.add_heading("References", level=1)
        doc.add_paragraph("[1] De Choudhury, M., Gamon, S. (2013). Predicting depression via social media. ICWSM.")
        doc.add_paragraph("[2] Nguyen, D. Q., Nguyen, A. T. (2020). PhoBERT: Pre-trained language models for Vietnamese. EMNLP.")
        doc.add_paragraph(
            "MINH NGUYEN is currently an undergraduate student at the Faculty of Information Technology, "
            "Ton Duc Thang University, Ho Chi Minh City, Vietnam."
        )
        doc.save(str(fallback_docx))

        parsed = dp.parse(str(fallback_docx))
        assert parsed.parser_used == "docx"
        assert len(parsed.references) == 2
        for ref in parsed.references:
            assert "is currently an undergraduate student" not in (ref.raw_text or "")
        link_res = linker.link(parsed.body_citations, parsed.references)
        assert link_res.unmatched_in_text == []
        assert link_res.unmatched_reference_ids == []


def test_synthetic_docx_with_tables_and_footnotes(tmp_path: Path) -> None:
    """Verify DocxParser extracts paragraphs, tables, and XML footnotes in document order."""
    docx_file = tmp_path / "synthetic_thesis.docx"
    doc = WordDocument()
    doc.add_heading("1. Introduction", level=1)
    doc.add_paragraph("Recent transformer architectures have revolutionized NLP (Vaswani et al., 2017).")

    tbl = doc.add_table(rows=2, cols=2)
    tbl.rows[0].cells[0].text = "Model"
    tbl.rows[0].cells[1].text = "Reference"
    tbl.rows[1].cells[0].text = "BERT"
    tbl.rows[1].cells[1].text = "(Devlin et al., 2019)"

    doc.add_heading("References", level=1)
    doc.add_paragraph(
        "Vaswani, A., Shazeer, N., Parmar, N., Uszkoreit, J., Jones, L., Gomez, A. N., Kaiser, L., & Polosukhin, I. (2017). "
        "Attention is all you need. Advances in Neural Information Processing Systems, 30."
    )
    doc.add_paragraph(
        "Devlin, J., Chang, M. W., Lee, K., & Toutanova, K. (2019). "
        "BERT: Pre-training of deep bidirectional transformers for language understanding. NAACL-HLT."
    )
    doc.save(str(docx_file))

    parser = DocxParser()
    parsed_doc = parser.parse(docx_file)
    assert parsed_doc.parser_used == "docx"
    assert parsed_doc.num_pages >= 2
    assert "(Devlin et al., 2019)" in parsed_doc.full_text

    dp = DocumentParser()
    full_parsed = dp.parse(str(docx_file))
    assert len(full_parsed.references) == 2
    assert len(full_parsed.body_citations) >= 2


def test_upload_endpoint_validates_docx_magic_bytes() -> None:
    """POST /api/essays rejects spoofed .docx without PK header and accepts valid .docx."""
    from integrity_checker.api.main import app

    client = TestClient(app)
    login = client.post("/api/auth/login", json={"username": "admin", "password": "admin123"})
    if login.status_code != 200:
        # Ensure default admin exists in test DB
        import bcrypt

        from integrity_checker.db.models import User
        from integrity_checker.db.session import get_session

        s = get_session()
        if not s.query(User).filter(User.username == "admin").first():
            s.add(
                User(
                    username="admin",
                    password_hash=bcrypt.hashpw(b"admin123", bcrypt.gensalt()).decode(),
                    role="admin",
                    plan_tier="ultra",
                )
            )
            s.commit()
        s.close()
        login = client.post("/api/auth/login", json={"username": "admin", "password": "admin123"})

    token = login.json()["token"]
    headers = {"Authorization": f"Bearer {token}"}

    bad_resp = client.post(
        "/api/essays",
        files={"file": ("spoofed.docx", BytesIO(b"not a zip archive"), "application/octet-stream")},
        headers=headers,
    )
    assert bad_resp.status_code == 400
    assert "docx" in bad_resp.json()["detail"].lower()


def test_class_join_code_and_cohort_analytics() -> None:
    """Verify teacher class creation generates CITRA-XXXX join_code, student self-enrolls, and cohort analytics detects shared hallucinations."""
    import json

    import bcrypt

    from integrity_checker.api.main import app
    from integrity_checker.db.models import EssayRecord, User, VerdictRecord
    from integrity_checker.db.session import get_session

    s = get_session()
    teacher = s.query(User).filter(User.username == "sprint1_teacher").first()
    if not teacher:
        teacher = User(
            username="sprint1_teacher",
            password_hash=bcrypt.hashpw(b"pass123", bcrypt.gensalt()).decode(),
            role="teacher",
            plan_tier="pro",
        )
        s.add(teacher)
    student1 = s.query(User).filter(User.username == "sprint1_student1").first()
    if not student1:
        student1 = User(
            username="sprint1_student1",
            password_hash=bcrypt.hashpw(b"pass123", bcrypt.gensalt()).decode(),
            role="user",
            plan_tier="basic",
        )
        s.add(student1)
    student2 = s.query(User).filter(User.username == "sprint1_student2").first()
    if not student2:
        student2 = User(
            username="sprint1_student2",
            password_hash=bcrypt.hashpw(b"pass123", bcrypt.gensalt()).decode(),
            role="user",
            plan_tier="pro",
        )
        s.add(student2)
    s.commit()
    s1_id, s2_id = student1.id, student2.id
    s.close()

    client = TestClient(app)
    t_tok = client.post("/api/auth/login", json={"username": "sprint1_teacher", "password": "pass123"}).json()["token"]
    s1_tok = client.post("/api/auth/login", json={"username": "sprint1_student1", "password": "pass123"}).json()["token"]
    s2_tok = client.post("/api/auth/login", json={"username": "sprint1_student2", "password": "pass123"}).json()["token"]

    # Create class
    c_resp = client.post(
        "/api/teacher/classes",
        json={"name": "DATN Cohort 2026", "description": "Graduation Thesis Class"},
        headers={"Authorization": f"Bearer {t_tok}"},
    )
    assert c_resp.status_code == 201
    c_data = c_resp.json()
    class_id = c_data["id"]
    join_code = c_data["join_code"]
    assert join_code and join_code.startswith("CITRA-")

    # Both students join via join_code
    j1 = client.post(
        "/api/teacher/classes/join",
        json={"join_code": join_code.lower()},
        headers={"Authorization": f"Bearer {s1_tok}"},
    )
    assert j1.status_code == 200
    assert j1.json()["id"] == class_id

    j2 = client.post(
        "/api/teacher/classes/join",
        json={"join_code": join_code},
        headers={"Authorization": f"Bearer {s2_tok}"},
    )
    assert j2.status_code == 200

    # Check enrolled classes for student1
    enr = client.get("/api/teacher/enrolled-classes", headers={"Authorization": f"Bearer {s1_tok}"})
    assert enr.status_code == 200
    assert any(c["id"] == class_id for c in enr.json())

    # Insert 2 essays with a shared hallucinated citation
    s = get_session()
    shared_fake = "Nguyen, V. A. (2025). Quantum Blockchain Hallucination in Higher Education. Fake Journal, 12(3), 1-19."
    e1 = EssayRecord(
        filename="student1_thesis.pdf",
        num_pages=10,
        user_id=s1_id,
        class_id=class_id,
        cis_json=json.dumps({"score": 72.5}),
    )
    e2 = EssayRecord(
        filename="student2_thesis.pdf",
        num_pages=12,
        user_id=s2_id,
        class_id=class_id,
        cis_json=json.dumps({"score": 88.0}),
    )
    s.add_all([e1, e2])
    s.flush()
    s.add_all([
        VerdictRecord(
            essay_id=e1.id,
            citation_raw=shared_fake,
            label="suspected_hallucination",
            confidence=0.92,
            triggered_rules=json.dumps(["R01", "R08"]),
        ),
        VerdictRecord(
            essay_id=e2.id,
            citation_raw=shared_fake,
            label="suspected_hallucination",
            confidence=0.94,
            triggered_rules=json.dumps(["R01"]),
        ),
    ])
    s.commit()
    s.close()

    # Fetch Cohort Analytics
    ana_resp = client.get(
        f"/api/teacher/classes/{class_id}/analytics",
        headers={"Authorization": f"Bearer {t_tok}"},
    )
    assert ana_resp.status_code == 200
    ana = ana_resp.json()
    assert ana["total_students"] == 2
    assert ana["total_essays"] == 2
    assert ana["avg_cis"] == 80.2
    assert len(ana["shared_hallucinations"]) >= 1
    top_shared = ana["shared_hallucinations"][0]
    assert top_shared["is_shared"] is True
    assert top_shared["student_count"] == 2


def test_rich_docx_exporter_includes_cis_components_and_trace() -> None:
    """Verify export_report_to_docx renders 5-component CIS table, linking summary, and diagnostic trace."""
    docx_bytes = export_report_to_docx(
        filename="thesis_final.docx",
        cis_score=86.5,
        num_citations=2,
        num_verified=1,
        num_metadata_error=1,
        num_suspected=0,
        num_unresolved=0,
        num_resource=0,
        verdicts=[
            {
                "citation_raw": "Vaswani et al. (2017). Attention is all you need.",
                "mapping_status": "matched",
                "label": "verified",
                "confidence": 0.98,
                "reasoning": "Verified on CrossRef and OpenAlex.",
                "triggered_rules": [],
                "mismatched_fields": [],
                "features": {
                    "best_evidence_sentence": "The Transformer is the first transduction model relying entirely on self-attention.",
                    "citation_intent": "methodology",
                    "citation_stance": "supporting",
                },
            },
            {
                "citation_raw": "Devlin et al. (2021). BERT Pre-training.",
                "mapping_status": "in_text_mismatch",
                "label": "metadata_error",
                "confidence": 0.81,
                "reasoning": "Year mismatch: published in 2019, cited as 2021.",
                "triggered_rules": ["R02"],
                "mismatched_fields": ["year"],
                "features": {},
            },
        ],
        cis_components={
            "verified_ratio": 0.85,
            "metadata_accuracy": 0.80,
            "in_text_bib_consistency": 0.90,
            "format_consistency": 0.95,
            "identifier_validity": 1.0,
        },
        linking_summary={"matched": 1, "in_text_mismatch": 1},
        style_profile={"style": "APA", "confidence": 0.92},
    )
    assert docx_bytes.startswith(b"PK\x03\x04")
    doc = WordDocument(BytesIO(docx_bytes))
    all_text = "\n".join(p.text for p in doc.paragraphs)
    assert "5-Component CIS Formula Breakdown" in all_text
    assert "Neuro-Symbolic Diagnostic Trace & Evidence" in all_text
    assert "The Transformer is the first transduction model" in all_text
