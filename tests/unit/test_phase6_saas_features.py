"""Unit tests for Phase 6 SaaS Value-Add Differentiators (Tasks 6.1–6.4)."""

from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

from integrity_checker.api.main import app
from integrity_checker.api.routes.essays import (
    create_essay_share_token,
    verify_essay_share_token,
)
from integrity_checker.db.models import (
    AuthToken,
    CitationRecord,
    EssayRecord,
    User,
    VerdictRecord,
)
from integrity_checker.db.models import Session as SessionModel
from integrity_checker.db.repository import Repository
from integrity_checker.db.session import get_session


@pytest.fixture()
def clean_db():
    """Provide a clean DB session for each test."""
    session = get_session()
    session.query(VerdictRecord).delete()
    session.query(CitationRecord).delete()
    session.query(EssayRecord).delete()
    session.query(AuthToken).delete()
    session.query(SessionModel).delete()
    session.query(User).delete()
    session.commit()
    try:
        yield session
    finally:
        session.close()
        cleanup = get_session()
        cleanup.query(VerdictRecord).delete()
        cleanup.query(CitationRecord).delete()
        cleanup.query(EssayRecord).delete()
        cleanup.query(AuthToken).delete()
        cleanup.query(SessionModel).delete()
        cleanup.query(User).delete()
        cleanup.commit()
        cleanup.close()


def _login(client: TestClient, username: str, password: str) -> tuple[str, dict]:
    resp = client.post(
        "/api/auth/login",
        json={"username": username, "password": password},
    )
    assert resp.status_code == 200, f"Login failed for {username}: {resp.text}"
    data = resp.json()
    return data["token"], data["user"]


def _seed_sample_essay(clean_db, user_id: int, filename: str = "quantum_nlp_2026.pdf") -> int:
    essay = EssayRecord(
        filename=filename,
        num_pages=12,
        user_id=user_id,
        style_profile_json=json.dumps({"style": "APA_LIKE", "confidence": 0.94}),
        cis_json=json.dumps(
            {
                "score": 88.5,
                "components": {
                    "verified_ratio": 0.9,
                    "metadata_accuracy": 0.88,
                    "in_text_bib_consistency": 0.92,
                    "format_consistency": 0.85,
                    "identifier_validity": 0.88,
                },
                "weights_used": {},
                "num_citations": 2,
                "num_unresolved": 0,
                "disclaimer": "Decision-support tool only.",
            }
        ),
    )
    clean_db.add(essay)
    clean_db.flush()

    v1 = VerdictRecord(
        essay_id=essay.id,
        citation_raw="Vaswani, A., et al. (2017). Attention Is All You Need. NeurIPS.",
        label="verified",
        confidence=0.98,
        mapping_status="matched",
        mapping_confidence=0.99,
        reasoning="Exact title and author match in OpenAlex and Semantic Scholar.",
        triggered_rules=json.dumps(["R1_EXACT_MATCH"]),
        mismatched_fields=json.dumps([]),
        features=json.dumps(
            {
                "matched_sources": [
                    {
                        "source": "openalex",
                        "title": "Attention Is All You Need",
                        "authors": ["Ashish Vaswani", "Noam Shazeer"],
                        "year": "2017",
                        "venue": "NeurIPS",
                        "doi": "10.48550/arXiv.1706.03762",
                        "matched_fields": ["title", "authors", "year"],
                        "checked_at": "2026-11-02T00:00:00Z",
                    }
                ]
            }
        ),
    )
    v2 = VerdictRecord(
        essay_id=essay.id,
        citation_raw="Doe, J. (2025). Fabricated Neural Chronodynamics. Fake Conf.",
        label="suspected_hallucination",
        confidence=0.91,
        mapping_status="matched",
        mapping_confidence=0.9,
        reasoning="Zero matches across 15+ scholarly indexes.",
        triggered_rules=json.dumps(["R3_ZERO_RETRIEVAL_HALLUCINATION"]),
        mismatched_fields=json.dumps(["title", "venue"]),
        features=json.dumps({"matched_sources": []}),
    )
    clean_db.add_all([v1, v2])
    clean_db.commit()
    return essay.id


class TestTask61ShareableVerificationLinks:
    """Task 6.1: Cryptographic shareable verification links & Digital Receipt API."""

    def test_valid_share_token_and_public_report(self, clean_db) -> None:
        client = TestClient(app)
        user_token, user_info = _login(client, "user", "user123")
        essay_id = _seed_sample_essay(clean_db, user_id=user_info["id"])

        # Create share link as owner
        share_resp = client.post(
            f"/api/essays/{essay_id}/share",
            headers={"Authorization": f"Bearer {user_token}"},
        )
        assert share_resp.status_code == 200, share_resp.text
        share_data = share_resp.json()
        assert share_data["essay_id"] == essay_id
        assert share_data["share_token"].startswith(f"sh_{essay_id}_")
        assert share_data["share_url"] == f"/verify/share/{share_data['share_token']}"
        assert share_data["receipt_id"].startswith(f"CITRA-{essay_id:05d}-")
        assert "expires_at" in share_data

        # Verify helper round-trip
        verified_id = verify_essay_share_token(share_data["share_token"])
        assert verified_id == essay_id

        # Public unauthenticated GET /api/essays/shared/{share_token}
        pub_resp = client.get(f"/api/essays/shared/{share_data['share_token']}")
        assert pub_resp.status_code == 200, pub_resp.text
        report = pub_resp.json()
        assert report["essay_id"] == essay_id
        assert report["filename"] == "quantum_nlp_2026.pdf"
        assert report["receipt_id"] == share_data["receipt_id"]
        assert report["cis"]["score"] == 88.5
        assert "verified_ratio" in report["cis"]["components"]
        assert report["verdict_counts"]["verified"] == 1
        assert report["verdict_counts"]["suspected_hallucination"] == 1
        assert len(report["verdicts"]) == 2
        first_v = report["verdicts"][0]
        assert first_v["reference_id"] == "ref-0001"
        assert "Attention Is All You Need" in first_v["raw_text"]
        assert first_v["label"] == "verified"
        assert first_v["matched_source"]["source"] == "openalex"

    def test_tampered_signature_and_modified_payload_rejected(self, clean_db) -> None:
        client = TestClient(app)
        _, user_info = _login(client, "user", "user123")
        essay_id = _seed_sample_essay(clean_db, user_id=user_info["id"])

        token_info = create_essay_share_token(essay_id, expires_days=30)
        valid_token = token_info["share_token"]

        # Flip last character of signature
        last_ch = "a" if valid_token[-1] != "a" else "b"
        tampered_sig_token = valid_token[:-1] + last_ch
        resp_sig = client.get(f"/api/essays/shared/{tampered_sig_token}")
        assert resp_sig.status_code == 403

        # Tamper essay_id in token while keeping signature
        parts = valid_token.split("_")
        tampered_id_token = f"sh_{essay_id + 999}_{parts[2]}_{parts[3]}"
        resp_id = client.get(f"/api/essays/shared/{tampered_id_token}")
        assert resp_id.status_code == 403

    def test_expired_share_token_rejected(self, clean_db) -> None:
        client = TestClient(app)
        _, user_info = _login(client, "user", "user123")
        essay_id = _seed_sample_essay(clean_db, user_id=user_info["id"])

        expired_info = create_essay_share_token(essay_id, expires_days=-1)
        resp = client.get(f"/api/essays/shared/{expired_info['share_token']}")
        assert resp.status_code == 403
        assert "expired" in resp.json()["detail"].lower()

    def test_unauthorized_user_cannot_create_share_token(self, clean_db) -> None:
        client = TestClient(app)
        admin_token, _ = _login(client, "admin", "admin123")
        _, owner_info = _login(client, "user", "user123")
        essay_id = _seed_sample_essay(clean_db, user_id=owner_info["id"])

        # Create a second student user
        repo = Repository(clean_db)
        other_user = repo.create_user(
            username="intruder_student",
            password_hash= repo.get_user_by_username("user").password_hash,
            role="user",
            email="intruder@example.com",
        )
        other_user.is_active = True
        clean_db.commit()

        intruder_token, _ = _login(client, "intruder_student", "user123")
        forbidden_resp = client.post(
            f"/api/essays/{essay_id}/share",
            headers={"Authorization": f"Bearer {intruder_token}"},
        )
        assert forbidden_resp.status_code == 403

        # Admin can share any essay
        admin_resp = client.post(
            f"/api/essays/{essay_id}/share",
            headers={"Authorization": f"Bearer {admin_token}"},
        )
        assert admin_resp.status_code == 200


class TestTask62ExportReceiptAndQrSeal:
    """Task 6.2: Tamper-evident Digital Verification Receipt & QR seal in PDF and DOCX exports."""

    def test_docx_export_contains_digital_receipt_and_verification_url(self, clean_db) -> None:
        import io

        from docx import Document as WordDocument

        from integrity_checker.export.docx_exporter import export_report_to_docx

        docx_bytes = export_report_to_docx(
            filename="thesis_final.pdf",
            cis_score=91.2,
            num_citations=10,
            num_verified=9,
            num_metadata_error=1,
            num_suspected=0,
            num_unresolved=0,
            num_resource=0,
            verdicts=[
                {
                    "citation_raw": "Vaswani et al. (2017). Attention Is All You Need.",
                    "label": "verified",
                    "confidence": 0.99,
                    "mapping_status": "matched",
                }
            ],
            essay_id=42,
        )
        doc = WordDocument(io.BytesIO(docx_bytes))
        all_paragraphs_text = "\n".join(p.text for p in doc.paragraphs)
        all_tables_text = "\n".join(
            cell.text for tbl in doc.tables for row in tbl.rows for cell in row.cells
        )
        combined = f"{all_paragraphs_text}\n{all_tables_text}"
        assert "CITRA-00042-" in combined
        assert "https://citra.io.vn/verify/share/sh_42_" in combined
        assert "HMAC-SHA256 Signature Prefix" in combined

    def test_pdf_export_contains_digital_receipt_and_qr_seal(self, clean_db) -> None:
        import fitz

        from integrity_checker.api.routes.report import _generate_pdf_bytes

        client = TestClient(app)
        admin_token, admin_info = _login(client, "admin", "admin123")
        essay_id = _seed_sample_essay(clean_db, user_id=admin_info["id"])

        essay = clean_db.get(EssayRecord, essay_id)
        verdicts = Repository(clean_db).get_verdicts(essay_id)
        pdf_bytes = _generate_pdf_bytes(essay, verdicts)
        assert pdf_bytes.startswith(b"%PDF-")

        with fitz.open(stream=pdf_bytes, filetype="pdf") as pdf_doc:
            extracted_text = "\n".join(page.get_text() for page in pdf_doc)

        assert f"CITRA-{essay_id:05d}-" in extracted_text
        assert f"https://citra.io.vn/verify/share/sh_{essay_id}_" in extracted_text
        assert "CITRA Digital Verification Receipt" in extracted_text

        # Also test via HTTP endpoint GET /api/essays/{id}/report?format=pdf and format=docx
        resp_pdf = client.get(
            f"/api/essays/{essay_id}/report?format=pdf",
            headers={"Authorization": f"Bearer {admin_token}"},
        )
        assert resp_pdf.status_code == 200
        with fitz.open(stream=resp_pdf.content, filetype="pdf") as http_pdf:
            http_pdf_text = "\n".join(page.get_text() for page in http_pdf)
        assert f"CITRA-{essay_id:05d}-" in http_pdf_text
        assert f"https://citra.io.vn/verify/share/sh_{essay_id}_" in http_pdf_text


class TestTask63BibtexAndRisUploadAndParsing:
    """Task 6.3: Direct BibTeX (.bib) and RIS (.ris) bibliography upload and verification."""

    def test_parse_bibtex_entries_and_layer1_linking(self) -> None:
        from integrity_checker.extraction.reference_parser import parse_bib_or_ris_content
        from integrity_checker.linking.citation_linker import CitationLinker
        from integrity_checker.models.citation import CitationType

        bib_text = r"""
        @article{vaswani2017attention,
          title={{Attention Is All You Need}},
          author={Vaswani, Ashish and Shazeer, Noam and Parmar, Niki},
          journal={Advances in Neural Information Processing Systems},
          volume={30},
          pages={5998--6008},
          year={2017},
          doi={10.48550/arXiv.1706.03762}
        }

        @inproceedings{scholkopf2001learning,
          title={Learning with {K}ernels \& Support Vector Machines},
          author={Sch{\"o}lkopf, Bernhard and Smola, Alexander J.},
          booktitle={Proceedings of the International Conference on Machine Learning},
          year={2001},
          number={2},
          url={https://example.org/kernels}
        }
        """
        citations = parse_bib_or_ris_content(bib_text, ".bib")
        refs = [c for c in citations if c.citation_type == CitationType.REFERENCE_LIST]
        in_texts = [c for c in citations if c.citation_type == CitationType.IN_TEXT]

        assert len(refs) == 2
        assert len(in_texts) == 2

        assert refs[0].reference_id == "ref-0001"
        assert refs[0].title == "Attention Is All You Need"
        assert refs[0].authors == ["Vaswani, Ashish", "Shazeer, Noam", "Parmar, Niki"]
        assert refs[0].year == "2017"
        assert refs[0].doi == "10.48550/arXiv.1706.03762"
        assert refs[0].volume == "30"
        assert refs[0].pages == "5998–6008"

        assert refs[1].reference_id == "ref-0002"
        assert refs[1].title == "Learning with Kernels & Support Vector Machines"
        assert "Schölkopf, Bernhard" in refs[1].authors
        assert refs[1].year == "2001"
        assert refs[1].issue == "2"

        assert in_texts[0].reference_id == "occ-0001"
        assert in_texts[0].grobid_ref_id == "ref-0001"
        assert in_texts[0].is_grobid_linked is True

        linker = CitationLinker()
        link_res = linker.link(in_texts, refs)
        assert len(link_res.unmatched_in_text) == 0
        assert len(link_res.unmatched_reference_ids) == 0
        assert all(r.mapping_status == "matched" for r in refs)

    def test_parse_ris_entries_and_document_parser_integration(self, tmp_path) -> None:
        from integrity_checker.extraction.document_parser import DocumentParser
        from integrity_checker.extraction.reference_parser import parse_bib_or_ris_content
        from integrity_checker.models.citation import CitationType

        ris_text = """TY  - JOUR
TI  - Deep Residual Learning for Image Recognition
AU  - He, Kaiming
AU  - Zhang, Xiangyu
PY  - 2016/06/01
JO  - IEEE Conference on Computer Vision and Pattern Recognition
VL  - 1
IS  - 1
SP  - 770
EP  - 778
DO  - 10.1109/CVPR.2016.90
UR  - https://doi.org/10.1109/CVPR.2016.90
ER  -

TY  - BOOK
T1  - Pattern Recognition and Machine Learning
A1  - Bishop, Christopher M.
Y1  - 2006
PB  - Springer
ER  -
"""
        citations = parse_bib_or_ris_content(ris_text, ".ris")
        refs = [c for c in citations if c.citation_type == CitationType.REFERENCE_LIST]
        in_texts = [c for c in citations if c.citation_type == CitationType.IN_TEXT]
        assert len(refs) == 2
        assert len(in_texts) == 2
        assert refs[0].title == "Deep Residual Learning for Image Recognition"
        assert refs[0].doi == "10.1109/CVPR.2016.90"
        assert refs[0].year == "2016"
        assert refs[0].pages == "770–778"
        assert refs[1].title == "Pattern Recognition and Machine Learning"
        assert refs[1].venue == "Springer"

        ris_file = tmp_path / "export.ris"
        ris_file.write_text(ris_text, encoding="utf-8")

        doc_parser = DocumentParser()
        parsed_doc = doc_parser.parse(str(ris_file), use_service_manager=False)
        assert parsed_doc.parser_used == "ris"
        assert len(parsed_doc.references) == 2
        assert len(parsed_doc.body_citations) == 2
        assert parsed_doc.document.num_pages == 1

    def test_upload_bib_and_ris_endpoints(self, clean_db, monkeypatch) -> None:
        from integrity_checker.api.routes import essays as essays_route

        async def _noop_pipeline_task(*args, **kwargs):
            return None

        monkeypatch.setattr(essays_route, "_run_pipeline_task", _noop_pipeline_task)

        client = TestClient(app)
        admin_token, _ = _login(client, "admin", "admin123")
        headers = {"Authorization": f"Bearer {admin_token}"}

        bib_bytes = b"""@article{devlin2019bert,
          title={BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding},
          author={Devlin, Jacob and Chang, Ming-Wei},
          journal={NAACL-HLT},
          year={2019},
          doi={10.18653/v1/N19-1423}
        }"""
        resp_bib = client.post(
            "/api/essays",
            files={"file": ("references.bib", bib_bytes, "application/x-bibtex")},
            headers=headers,
        )
        assert resp_bib.status_code == 200
        assert resp_bib.json()["filename"] == "references.bib"

        ris_bytes = b"""TY  - JOUR
TI  - Attention Is All You Need
AU  - Vaswani, Ashish
PY  - 2017
ER  -
"""
        resp_ris = client.post(
            "/api/essays",
            files={"file": ("zotero.ris", ris_bytes, "application/x-research-info-systems")},
            headers=headers,
        )
        assert resp_ris.status_code == 200
        assert resp_ris.json()["filename"] == "zotero.ris"

        # Invalid .bib without @ entry is rejected with 400
        resp_bad_bib = client.post(
            "/api/essays",
            files={"file": ("broken.bib", b"just plain text without bibtex entries", "text/plain")},
            headers=headers,
        )
        assert resp_bad_bib.status_code == 400


