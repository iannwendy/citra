"""Integration tests cho FastAPI."""

from __future__ import annotations

import os

import pytest
from fastapi.testclient import TestClient

from integrity_checker.db.models import (
    AuditLog,
    CitationRecord,
    ClassMembership,
    EssayRecord,
    User,
    VerdictRecord,
)
from integrity_checker.db.models import (
    Class as ClassModel,
)
from integrity_checker.db.models import (
    Session as SessionModel,
)
from integrity_checker.db.session import get_session

# Test credentials - intentionally simple for testing per plan spec
# Override with environment variables in CI/CD if needed
TEST_ADMIN_USER = os.environ.get("TEST_ADMIN_USER", "admin")
TEST_ADMIN_PASS = os.environ.get("TEST_ADMIN_PASS", "admin123")


@pytest.fixture(autouse=True)
def clean_db():
    """Clean database before each test."""
    session = get_session()
    session.query(AuditLog).delete()
    session.query(VerdictRecord).delete()
    session.query(CitationRecord).delete()
    session.query(EssayRecord).delete()
    session.query(ClassMembership).delete()
    session.query(ClassModel).delete()
    session.query(SessionModel).delete()
    session.query(User).delete()
    session.commit()
    session.close()


def test_health_endpoint() -> None:
    from integrity_checker.api.main import app

    client = TestClient(app)
    resp = client.get("/api/health")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "ok"
    assert "disclaimer" in data
    assert "version" in data


def test_root_404() -> None:
    """Path không tồn tại → 404."""
    from integrity_checker.api.main import app

    client = TestClient(app)
    resp = client.get("/api/nonexistent")
    assert resp.status_code == 404


def test_get_essay_404() -> None:
    """Essay không tồn tại → 404 (requires auth)."""
    from integrity_checker.api.main import app

    client = TestClient(app)
    # Login first
    login_resp = client.post("/api/auth/login", json={"username": TEST_ADMIN_USER, "password": TEST_ADMIN_PASS})
    token = login_resp.json()["token"]

    # Now try to get non-existent essay
    resp = client.get("/api/essays/99999", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 404


def test_upload_rejects_non_pdf() -> None:
    """Upload file không phải PDF → 400 (requires auth)."""
    from io import BytesIO

    from integrity_checker.api.main import app

    client = TestClient(app)
    # Login first
    login_resp = client.post("/api/auth/login", json={"username": TEST_ADMIN_USER, "password": TEST_ADMIN_PASS})
    token = login_resp.json()["token"]

    resp = client.post(
        "/api/essays",
        files={"file": ("test.txt", BytesIO(b"not a pdf"), "text/plain")},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 400


def test_report_and_verdicts_require_authentication() -> None:
    """GET /api/essays/{id}/report và /verdicts bắt buộc có Authorization header."""
    from integrity_checker.api.main import app
    from integrity_checker.db.repository import Repository

    session = get_session()
    repo = Repository(session)
    essay = repo.create_essay_with_user("protected.pdf", 2, None)
    session.commit()
    essay_id = essay.id
    session.close()

    client = TestClient(app)
    resp_report = client.get(f"/api/essays/{essay_id}/report")
    assert resp_report.status_code in (401, 422)

    resp_verdicts = client.get(f"/api/essays/{essay_id}/verdicts")
    assert resp_verdicts.status_code in (401, 422)


def test_upload_rejects_pdf_without_magic_bytes() -> None:
    """File .pdf nhưng không có %PDF- magic header -> 400."""
    from io import BytesIO

    from integrity_checker.api.main import app

    client = TestClient(app)
    login_resp = client.post(
        "/api/auth/login",
        json={"username": TEST_ADMIN_USER, "password": TEST_ADMIN_PASS},
    )
    token = login_resp.json()["token"]

    resp = client.post(
        "/api/essays",
        files={"file": ("spoofed.pdf", BytesIO(b"<html>not a pdf</html>"), "application/pdf")},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 400
    assert "%pdf-" in resp.json()["detail"].lower()


def test_upload_rejects_oversized_pdf(monkeypatch) -> None:
    """Upload PDF vượt quá ngưỡng dung lượng -> 413 Payload Too Large."""
    from io import BytesIO

    import integrity_checker.api.routes.essays as essays_route
    from integrity_checker.api.main import app

    monkeypatch.setattr(essays_route, "MAX_PDF_UPLOAD_BYTES", 1024)

    client = TestClient(app)
    login_resp = client.post(
        "/api/auth/login",
        json={"username": TEST_ADMIN_USER, "password": TEST_ADMIN_PASS},
    )
    token = login_resp.json()["token"]

    payload = b"%PDF-1.4\n" + (b"0" * 2048)
    resp = client.post(
        "/api/essays",
        files={"file": ("oversized.pdf", BytesIO(payload), "application/pdf")},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 413


def test_security_headers_present() -> None:
    """Mọi HTTP response đều có X-Content-Type-Options, X-Frame-Options, Referrer-Policy."""
    from integrity_checker.api.main import app

    client = TestClient(app)
    resp = client.get("/api/health")
    assert resp.status_code == 200
    assert resp.headers.get("X-Content-Type-Options") == "nosniff"
    assert resp.headers.get("X-Frame-Options") == "SAMEORIGIN"
    assert resp.headers.get("Referrer-Policy") == "strict-origin-when-cross-origin"
