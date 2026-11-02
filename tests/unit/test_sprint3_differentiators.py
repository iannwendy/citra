"""Unit & API tests for Sprint 3 (P2) Differentiator Features:
1. 1-Click Bibliography Auto-Remediation & Canonical Reference Formatter (APA/IEEE/TDTU/BibTeX/RIS)
2. Vietnamese Legal Statute & Regulatory Verification Engine (vn_legal_verifier.py)
3. Interactive PDF Page Preview with Bounding-Box Highlighting (/api/essays/{id}/page-preview/{page})
"""

from __future__ import annotations

import json
import os
from datetime import UTC, datetime

import bcrypt
from fastapi.testclient import TestClient

os.environ.setdefault("JWT_SECRET", "test-secret-sprint3-32-chars-minimum-123456")

from integrity_checker.api.main import app
from integrity_checker.db.models import CitationRecord, EssayRecord, User, VerdictRecord
from integrity_checker.db.session import get_session, init_db
from integrity_checker.export.bibliography_formatter import (
    build_remediated_bibliography,
    format_canonical_entry,
)
from integrity_checker.extraction.patterns.apa import parse_vn_legal_reference
from integrity_checker.logic.neuro_symbolic_checker import NeuroSymbolicChecker
from integrity_checker.logic.vn_legal_verifier import verify_vn_legal_citation
from integrity_checker.models.source import SourceResult
from integrity_checker.models.validation import ValidationLabel


class TestBibliographyAutoRemediationSprint3:
    """Verify 1-Click Bibliography Auto-Remediation across APA, IEEE, TDTU, BibTeX, and RIS."""

    def test_auto_remediates_metadata_error_from_canonical_source(self) -> None:
        verdicts = [
            {
                "citation_id": "v1",
                "citation_raw": "Vaswani, A., et al. (2019). Attention Is All You Need. NIPS.",
                "label": "metadata_error",
                "mismatched_fields": ["year"],
                "features": {
                    "matched_sources": [
                        {
                            "source_name": "semanticscholar",
                            "found": True,
                            "score": 0.96,
                            "title": "Attention Is All You Need",
                            "authors": ["Ashish Vaswani", "Noam Shazeer", "Niki Parmar"],
                            "year": "2017",
                            "venue": "Advances in Neural Information Processing Systems",
                            "doi": "10.48550/arXiv.1706.03762",
                        }
                    ]
                },
            },
            {
                "citation_id": "v2",
                "citation_raw": "[2] K. He, X. Zhang, S. Ren, and J. Sun, \"Deep Residual Learning for Image Recognition,\" CVPR, 2016.",
                "label": "verified",
                "mismatched_fields": [],
                "features": {
                    "matched_sources": [
                        {
                            "source_name": "crossref",
                            "found": True,
                            "score": 0.99,
                            "title": "Deep Residual Learning for Image Recognition",
                            "authors": ["Kaiming He", "Xiangyu Zhang", "Shaoqing Ren", "Jian Sun"],
                            "year": "2016",
                            "venue": "IEEE Conference on Computer Vision and Pattern Recognition (CVPR)",
                            "doi": "10.1109/CVPR.2016.90",
                        }
                    ]
                },
            },
        ]

        res_apa = build_remediated_bibliography(essay_id=42, verdicts=verdicts, style="apa")
        assert res_apa["total_entries"] == 2
        assert res_apa["remediated_count"] >= 1
        e1 = res_apa["entries"][0]
        assert e1["was_modified"] is True
        assert "year" in e1["diff_fields"]
        assert "doi" in e1["diff_fields"]
        assert "(2017)" in e1["apa"]
        assert "https://doi.org/10.48550/arXiv.1706.03762" in e1["apa"]
        assert "@article{" in e1["bibtex"]
        assert "year = {2017}" in e1["bibtex"]
        assert "TY  - JOUR" in e1["ris"]
        assert "PY  - 2017" in e1["ris"]

        # Verify IEEE & TDTU formats
        assert e1["ieee"].startswith("[1]")
        assert "doi: 10.48550/arXiv.1706.03762" in e1["ieee"]
        assert "(2017), 'Attention Is All You Need'" in e1["tdtu"]

    def test_format_canonical_entry_handles_single_and_multi_authors(self) -> None:
        meta = {
            "title": "Green Chemistry: Theory and Practice",
            "authors": ["Anastas, Paul T.", "Warner, John C."],
            "year": "1998",
            "venue": "Oxford University Press",
            "doi": "10.1021/gc98",
        }
        out = format_canonical_entry(meta, index=3, style="ieee")
        assert out["remediated_text"].startswith("[3] P. T. Anastas and J. C. Warner")
        assert "Anastas, P. T., & Warner, J. C. (1998)" in out["apa"]


class TestVietnameseLegalVerifierSprint3:
    """Verify statutory registry, vigencia checks, and structural validation for VN laws."""

    def test_valid_active_statutes_pass_with_verified_rule(self) -> None:
        samples = [
            "1. Hiến pháp 2013.",
            "2. Bộ luật Dân sự (Luật số 91/2015/QH13) ngày 24/11/2015.",
            "3. Luật Doanh nghiệp (Luật số 59/2020/QH14) ngày 17/06/2020 của Quốc hội.",
            "4. Luật Đất đai (Luật số 31/2024/QH15) của Quốc hội.",
        ]
        checker = NeuroSymbolicChecker(enable_content_alignment=False)
        for raw in samples:
            cit = parse_vn_legal_reference(raw)
            assert cit is not None
            verdict = checker.check(cit, SourceResult(citation_raw=raw, candidates=[]))
            assert verdict.label == ValidationLabel.RESOURCE
            assert "R-LEGAL-DOCUMENT" in verdict.triggered_rules
            assert "R-VN-LEGAL-VERIFIED" in verdict.triggered_rules
            assert "R-VN-LEGAL-SUPERSEDED" not in verdict.triggered_rules

    def test_superseded_historical_statutes_include_superseded_warning_rule(self) -> None:
        raw = "Luật Doanh nghiệp (Luật số 68/2014/QH13) ngày 26/12/2014."
        cit = parse_vn_legal_reference(raw)
        assert cit is not None
        checker = NeuroSymbolicChecker(enable_content_alignment=False)
        verdict = checker.check(cit, SourceResult(citation_raw=raw, candidates=[]))
        assert verdict.label == ValidationLabel.RESOURCE
        assert "R-LEGAL-DOCUMENT" in verdict.triggered_rules
        assert "R-VN-LEGAL-VERIFIED" in verdict.triggered_rules
        assert "R-VN-LEGAL-SUPERSEDED" in verdict.triggered_rules
        assert "59/2020/QH14" in verdict.reasoning

    def test_fabricated_year_or_wrong_code_or_wrong_authority_flags_metadata_error(self) -> None:
        invalid_samples = [
            # Wrong promulgation year for Hiến pháp (no 2018 Constitution exists)
            ("Hiến pháp năm 2018.", "year"),
            # Wrong law number for Luật Doanh nghiệp 2020 (real is 59/2020/QH14, not 99/2020/QH14)
            ("Luật Doanh nghiệp (Luật số 99/2020/QH14) ngày 17/06/2020.", "title"),
            # Wrong issuing authority for Bộ luật Dân sự (Chính phủ cannot issue Bộ luật)
            ("Bộ luật Dân sự năm 2015 của Chính phủ.", "venue"),
            # Wrong issuing authority for Nghị định NĐ-CP (Quốc hội does not issue NĐ-CP)
            ("Nghị định số 23/2015/NĐ-CP của Quốc hội ngày 16/02/2015.", "venue"),
        ]
        checker = NeuroSymbolicChecker(enable_content_alignment=False)
        for raw, expected_field in invalid_samples:
            res = verify_vn_legal_citation(raw)
            assert res.is_valid is False
            assert expected_field in res.mismatched_fields
            assert "R-VN-LEGAL-MISMATCH" in res.triggered_rules

            cit = parse_vn_legal_reference(raw)
            if cit is not None:
                verdict = checker.check(cit, SourceResult(citation_raw=raw, candidates=[]))
                assert verdict.label == ValidationLabel.METADATA_ERROR
                assert "R-VN-LEGAL-MISMATCH" in verdict.triggered_rules
                assert expected_field in verdict.mismatched_fields


class TestSprint3APIEndpoints:
    """Verify /remediate (with Pro gating) and /page-preview/{page_num} endpoints."""

    def test_remediate_and_page_preview_endpoints(self) -> None:
        init_db()
        session = get_session()
        suffix = int(datetime.now(UTC).timestamp() * 1000) % 1000000
        pw_hash = bcrypt.hashpw(b"Pass123!", bcrypt.gensalt()).decode()
        try:
            basic_user = User(
                username=f"basic_s3_{suffix}",
                email=f"basic_s3_{suffix}@example.com",
                password_hash=pw_hash,
                role="user",
                plan_tier="basic",
                subscription_status="active",
            )
            pro_user = User(
                username=f"pro_s3_{suffix}",
                email=f"pro_s3_{suffix}@example.com",
                password_hash=pw_hash,
                role="user",
                plan_tier="pro",
                subscription_status="active",
            )
            session.add_all([basic_user, pro_user])
            session.flush()

            essay_basic = EssayRecord(
                user_id=basic_user.id,
                filename="basic_thesis.pdf",
                num_pages=2,
            )
            essay_pro = EssayRecord(
                user_id=pro_user.id,
                filename="pro_thesis.pdf",
                num_pages=2,
            )
            session.add_all([essay_basic, essay_pro])
            session.flush()

            session.add(
                CitationRecord(
                    essay_id=essay_pro.id,
                    raw_text="(Vaswani et al., 2017)",
                    citation_type="in_text",
                    style="APA",
                    page_num=1,
                    confidence=0.95,
                    context="Transformer architectures rely on self-attention (Vaswani et al., 2017).",
                )
            )
            session.add(
                VerdictRecord(
                    essay_id=essay_pro.id,
                    citation_raw="Vaswani, A. (2019). Attention Is All You Need. NIPS.",
                    label="metadata_error",
                    confidence=0.88,
                    mapping_status="matched",
                    mapping_confidence=0.95,
                    reasoning="Year mismatch: cited 2019, source is 2017.",
                    triggered_rules="R-SINGLE-SOURCE-PARTIAL",
                    mismatched_fields="year",
                    features=json.dumps(
                        {
                            "matched_sources": [
                                {
                                    "source_name": "semanticscholar",
                                    "found": True,
                                    "score": 0.96,
                                    "title": "Attention Is All You Need",
                                    "authors": ["Ashish Vaswani", "Noam Shazeer"],
                                    "year": "2017",
                                    "venue": "NeurIPS",
                                    "doi": "10.48550/arXiv.1706.03762",
                                }
                            ]
                        }
                    ),
                )
            )
            session.commit()
            basic_uname = basic_user.username
            pro_uname = pro_user.username
            e_basic_id = essay_basic.id
            e_pro_id = essay_pro.id
        finally:
            session.close()

        client = TestClient(app)
        basic_token = client.post(
            "/api/auth/login",
            json={"username": basic_uname, "password": "Pass123!"},
        ).json()["token"]
        pro_token = client.post(
            "/api/auth/login",
            json={"username": pro_uname, "password": "Pass123!"},
        ).json()["token"]

        # 1. Basic user is gated with 402 on /remediate
        r_basic = client.get(
            f"/api/essays/{e_basic_id}/remediate?style=apa",
            headers={"Authorization": f"Bearer {basic_token}"},
        )
        assert r_basic.status_code == 402

        # 2. Pro user gets 200 OK with auto-repaired bibliography
        r_pro = client.get(
            f"/api/essays/{e_pro_id}/remediate?style=apa",
            headers={"Authorization": f"Bearer {pro_token}"},
        )
        assert r_pro.status_code == 200
        payload = r_pro.json()
        assert payload["total_entries"] == 1
        assert payload["remediated_count"] == 1
        assert "(2017)" in payload["entries"][0]["apa"]
        assert "@article{" in payload["combined_bibtex"]

        # 3. Page preview returns a valid PNG image with bounding-box highlight
        r_prev = client.get(
            f"/api/essays/{e_pro_id}/page-preview/1?highlight=Vaswani",
            headers={"Authorization": f"Bearer {pro_token}"},
        )
        assert r_prev.status_code == 200
        assert r_prev.headers["content-type"] == "image/png"
        assert r_prev.content.startswith(b"\x89PNG\r\n\x1a\n")
