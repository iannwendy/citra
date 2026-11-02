"""Tests for GET /api/teacher/classes/{id}/export.csv (Phase 4 — Task 6).

Streams a CSV of all (essay, verdict) pairs for the students enrolled in a
class. Essays without any verdicts still get a row (with empty verdict
fields) so the row count equals ``len(essays) + len(verdicts)`` minus
essays with no verdicts. More precisely: row count = number of (essay,
verdict) pairs + number of essays with zero verdicts. Verifies:

- Positive case: class with 3 essays, 2 with verdicts → 4 CSV lines
  (1 header + 3 data rows: 2 verdicts + 1 essay with no verdicts).
- Cross-tenant: a different teacher (not the class owner) gets 403.
- Content-Type is ``text/csv`` and the response is downloadable.
- Column header includes the documented columns.
"""

from __future__ import annotations

import csv
import io

import pytest
from fastapi.testclient import TestClient

from integrity_checker.api.main import app
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

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def get_admin_token() -> str:
    client = TestClient(app)
    resp = client.post(
        "/api/auth/login", json={"username": "admin", "password": "admin123"},
    )
    assert resp.status_code == 200, f"Admin login failed: {resp.text}"
    return resp.json()["token"]


def get_teacher_token() -> str:
    client = TestClient(app)
    resp = client.post(
        "/api/auth/login", json={"username": "teacher", "password": "teacher123"},
    )
    assert resp.status_code == 200, f"Teacher login failed: {resp.text}"
    return resp.json()["token"]


def auth_header(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _make_user(username: str, role: str = "user", email: str | None = None) -> int:
    """Create a user directly via DB and return id. Mirrors test_teacher_role helper."""
    import bcrypt

    from integrity_checker.db.repository import Repository
    from integrity_checker.db.session import get_session

    session = get_session()
    repo = Repository(session)
    user = repo.create_user(
        username=username,
        password_hash=bcrypt.hashpw(b"testpass123", bcrypt.gensalt()).decode(),
        role=role,
        email=email,
        full_name=username.title(),
        is_active=True,
    )
    session.commit()
    uid = user.id
    session.close()
    return uid


def _hardcoded_teacher_id() -> int:
    """Look up the user_id of the hardcoded 'teacher' account."""
    from integrity_checker.db.session import get_session

    # Trigger lazy creation of the hardcoded teacher user via login.
    get_teacher_token()

    session = get_session()
    try:
        teacher = session.query(User).filter(User.username == "teacher").first()
        assert teacher is not None, "hardcoded 'teacher' user not seeded"
        return teacher.id
    finally:
        session.close()


def _create_essay_with_verdict(
    user_id: int,
    filename: str = "test_essay.pdf",
    label: str = "verified",
    confidence: float = 0.9,
    is_overridden: int = 0,
) -> tuple[int, int]:
    """Create an essay (owned by user_id) with one VerdictRecord. Returns (essay_id, verdict_id)."""
    from integrity_checker.db.session import get_session

    session = get_session()
    try:
        essay = EssayRecord(filename=filename, num_pages=1, user_id=user_id)
        session.add(essay)
        session.flush()
        verdict = VerdictRecord(
            essay_id=essay.id,
            citation_raw="Smith, J. (2020). Some title. Some venue.",
            label=label,
            confidence=confidence,
            reasoning="ok",
            triggered_rules="[]",
            mismatched_fields="[]",
            features="{}",
            mapping_status="matched",
            mapping_confidence=0.0,
            is_overridden=is_overridden,
        )
        session.add(verdict)
        session.commit()
        return essay.id, verdict.id
    finally:
        session.close()


def _create_essay_no_verdict(user_id: int, filename: str = "no_verdict.pdf") -> int:
    """Create an essay with no verdicts. Returns essay_id."""
    from integrity_checker.db.session import get_session

    session = get_session()
    try:
        essay = EssayRecord(filename=filename, num_pages=1, user_id=user_id)
        session.add(essay)
        session.commit()
        return essay.id
    finally:
        session.close()


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_export_class_csv_returns_one_row_per_essay(clean_db):
    """Class with 3 essays, 2 with verdicts → 4 CSV lines total
    (1 header + 3 data rows: 2 verdicts + 1 essay with no verdicts).
    """
    from integrity_checker.db.repository import Repository
    from integrity_checker.db.session import get_session

    # setup: hardcoded teacher owns a class with a student
    teacher_id = _hardcoded_teacher_id()
    student_id = _make_user("exp_student", role="user")

    session = get_session()
    try:
        repo = Repository(session)
        cls = repo.create_class(name="ExportClass", teacher_id=teacher_id)
        class_id = cls.id
        repo.add_student_to_class(cls.id, student_id)
        session.commit()
    finally:
        session.close()

    # 2 essays with verdicts + 1 essay with no verdicts → 4 CSV lines
    essay_a_id, verdict_a_id = _create_essay_with_verdict(
        student_id, filename="alpha.pdf", label="verified", confidence=0.95,
    )
    essay_b_id, verdict_b_id = _create_essay_with_verdict(
        student_id, filename="beta.pdf", label="metadata_error", confidence=0.4,
    )
    _create_essay_no_verdict(student_id, filename="gamma.pdf")

    # act
    token = get_teacher_token()
    client = TestClient(app)
    resp = client.get(
        f"/api/teacher/classes/{class_id}/export.csv", headers=auth_header(token),
    )

    # assert
    assert resp.status_code == 200, resp.text
    assert resp.headers["content-type"].startswith("text/csv"), resp.headers
    assert "attachment" in resp.headers.get("content-disposition", "")
    assert f"class_{class_id}.csv" in resp.headers.get("content-disposition", "")

    # Parse CSV — 1 header row + 3 data rows = 4 lines total
    reader = csv.reader(io.StringIO(resp.text))
    rows = list(reader)
    assert len(rows) == 4, f"expected 4 lines (1 header + 3 data), got {len(rows)}: {rows}"

    # Header check
    header = rows[0]
    assert "filename" in header
    assert "student" in header
    assert "label" in header
    assert "confidence" in header
    assert "validated_at" in header
    assert "is_overridden" in header

    # Build dicts for row assertions
    data_rows = [dict(zip(header, r, strict=False)) for r in rows[1:]]
    filenames = [r["filename"] for r in data_rows]
    assert sorted(filenames) == ["alpha.pdf", "beta.pdf", "gamma.pdf"]

    # alpha and beta have a verdict; gamma is the empty-verdict row
    by_filename = {r["filename"]: r for r in data_rows}
    assert by_filename["alpha.pdf"]["student"] == "exp_student"
    assert by_filename["alpha.pdf"]["label"] == "verified"
    assert float(by_filename["alpha.pdf"]["confidence"]) == 0.95
    assert by_filename["alpha.pdf"]["is_overridden"] == "no"
    assert by_filename["alpha.pdf"]["validated_at"]  # non-empty ISO timestamp

    assert by_filename["beta.pdf"]["label"] == "metadata_error"
    assert float(by_filename["beta.pdf"]["confidence"]) == 0.4

    # gamma has no verdict → empty label / confidence / validated_at / is_overridden
    assert by_filename["gamma.pdf"]["label"] == ""
    assert by_filename["gamma.pdf"]["confidence"] == ""
    assert by_filename["gamma.pdf"]["validated_at"] == ""
    assert by_filename["gamma.pdf"]["is_overridden"] == ""


def test_export_class_csv_rejects_other_teachers(clean_db):
    """Teacher B (not the owner of the class) must get 403 on a class
    owned by teacher A.
    """
    from integrity_checker.db.repository import Repository
    from integrity_checker.db.session import get_session

    teacher_a_id = _hardcoded_teacher_id()
    teacher_b_id = _make_user("exp_teacher_b", role="teacher")
    student_id = _make_user("exp_loner", role="user")

    session = get_session()
    try:
        repo = Repository(session)
        # Class A owned by hardcoded teacher, student enrolled
        class_a = repo.create_class(name="ClassAExport", teacher_id=teacher_a_id)
        repo.add_student_to_class(class_a.id, student_id)
        # Class B owned by teacher_b (separate teacher)
        class_b = repo.create_class(name="ClassBExport", teacher_id=teacher_b_id)
        class_b_id = class_b.id
        session.commit()
    finally:
        session.close()

    # one essay with a verdict (so the CSV would be non-empty if it were allowed)
    _create_essay_with_verdict(student_id, label="verified")

    # act: hardcoded teacher (teacher A) tries to export class B (not theirs)
    token = get_teacher_token()
    client = TestClient(app)
    resp = client.get(
        f"/api/teacher/classes/{class_b_id}/export.csv", headers=auth_header(token),
    )

    # assert: 403 (not your class)
    assert resp.status_code == 403, f"expected 403, got {resp.status_code}: {resp.text}"
    assert "Not your class" in resp.json()["detail"]


def test_pdf_and_csv_exports_prevent_xml_ssrf_and_csv_formula_injection(clean_db):
    """PDF export must escape XML/HTML in essay.filename (preventing ReportLab SSRF/crash),
    and CSV exports must neutralize leading formula characters (=, +, -, @).
    """
    from integrity_checker.db.repository import Repository
    from integrity_checker.db.session import get_session

    teacher_id = _hardcoded_teacher_id()
    student_id = _make_user("inj_student", role="user")

    session = get_session()
    try:
        repo = Repository(session)
        cls = repo.create_class(name="SecExportClass", teacher_id=teacher_id)
        class_id = cls.id
        repo.add_student_to_class(cls.id, student_id)
        essay = EssayRecord(
            filename='=CMD|" /C calc"!A0 <img src="http://169.254.169.254/meta"/>&"\r\n.pdf',
            num_pages=2,
            user_id=student_id,
            class_id=cls.id,
        )
        session.add(essay)
        session.flush()
        verdict = VerdictRecord(
            essay_id=essay.id,
            citation_raw="+SUM(1,1) Smith (2020)",
            label="verified",
            confidence=0.9,
            reasoning="@evil_macro()",
            triggered_rules="[]",
            mismatched_fields="[]",
            features="{}",
            mapping_status="matched",
            mapping_confidence=1.0,
        )
        session.add(verdict)
        session.commit()
        essay_id = essay.id
    finally:
        session.close()

    token = get_teacher_token()
    client = TestClient(app)

    # 1. PDF report export must succeed without XML parse crash or SSRF
    pdf_resp = client.get(
        f"/api/essays/{essay_id}/report?format=pdf",
        headers=auth_header(token),
    )
    assert pdf_resp.status_code == 200, pdf_resp.text
    assert pdf_resp.content.startswith(b"%PDF-")
    cd_header = pdf_resp.headers.get("content-disposition", "")
    assert "\r" not in cd_header and "\n" not in cd_header

    # 2. Essay CSV export must prefix formula cells with single quote
    csv_resp = client.get(
        f"/api/essays/{essay_id}/report?format=csv",
        headers=auth_header(token),
    )
    assert csv_resp.status_code == 200
    rows = list(csv.reader(io.StringIO(csv_resp.text)))
    assert len(rows) == 2
    assert rows[1][0].startswith("'+SUM(1,1)")
    assert rows[1][5].startswith("'@evil_macro()")

    # 3. Class CSV export must neutralize dangerous filename cell
    class_csv_resp = client.get(
        f"/api/teacher/classes/{class_id}/export.csv",
        headers=auth_header(token),
    )
    assert class_csv_resp.status_code == 200
    c_rows = list(csv.reader(io.StringIO(class_csv_resp.text)))
    assert len(c_rows) == 2
    assert c_rows[1][0].startswith("'=CMD")


# ---------------------------------------------------------------------------
# Fixture — extends clean_db to also wipe VerdictRecord + AuditLog
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def clean_db():
    """Wipe all tables touched by these tests (extends the existing
    test_teacher_role pattern to include VerdictRecord and AuditLog).
    """
    from integrity_checker.db.session import get_session

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
    yield
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
