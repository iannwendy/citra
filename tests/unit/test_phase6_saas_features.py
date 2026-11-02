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
