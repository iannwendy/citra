"""Unit & integration tests for Vietnamese Personal Data Protection compliance (DLCN-01..03).

Covers:
- DLCN-02: Explicit privacy consent required on registration + consent timestamp/version persistence
- DLCN-02: Google OAuth signup consent persistence via onboarding (PATCH /api/users/me) and direct Google sign-up
- DLCN-03: Self-service account deletion (DELETE /api/users/me) for local-password and Google-only users
- DLCN-03: Complete cleanup of user's EssayRecord, CitationRecord, VerdictRecord, AuditLog, physical upload files,
  and local avatar upon deletion, while preserving students' essays when a teacher is deleted.
"""

from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from integrity_checker.api.main import app
from integrity_checker.api.routes import essays as essays_routes
from integrity_checker.api.services.avatar_service import AvatarService
from integrity_checker.api.services.email_service import get_email_service
from integrity_checker.db.models import (
    AuditLog,
    AuthToken,
    CitationRecord,
    Class,
    ClassMembership,
    EssayRecord,
    User,
    VerdictRecord,
)
from integrity_checker.db.models import Session as SessionModel
from integrity_checker.db.repository import Repository
from integrity_checker.db.session import get_session


@pytest.fixture(autouse=True)
def clean_db():
    """Reset DB tables before and after each test."""
    def _wipe():
        session = get_session()
        try:
            session.query(AuditLog).delete()
            session.query(VerdictRecord).delete()
            session.query(CitationRecord).delete()
            session.query(EssayRecord).delete()
            session.query(ClassMembership).delete()
            session.query(Class).delete()
            session.query(AuthToken).delete()
            session.query(SessionModel).delete()
            session.query(User).delete()
            session.commit()
        finally:
            session.close()

    _wipe()
    yield
    _wipe()


def _auth_header(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


class TestPrivacyConsentPersistence:
    """DLCN-02: Explicit consent enforcement and timestamp/version persistence."""

    def test_register_rejects_missing_or_false_privacy_consent(self, clean_db):
        client = TestClient(app)

        # Omitted privacy_consent -> must reject (default unchecked)
        resp_missing = client.post(
            "/api/auth/register",
            json={
                "username": "noconsent_user",
                "email": "noconsent@example.com",
                "password": "Password123!",
            },
        )
        assert resp_missing.status_code == 400
        assert "PRIVACY_CONSENT_REQUIRED" in resp_missing.json()["detail"]

        # Explicit False -> must reject
        resp_false = client.post(
            "/api/auth/register",
            json={
                "username": "noconsent_user2",
                "email": "noconsent2@example.com",
                "password": "Password123!",
                "privacy_consent": False,
            },
        )
        assert resp_false.status_code == 400

        session = get_session()
        try:
            assert session.query(User).filter(User.username == "noconsent_user").first() is None
            assert session.query(User).filter(User.username == "noconsent_user2").first() is None
        finally:
            session.close()

    def test_register_persists_consent_timestamp_and_policy_version(self, clean_db):
        email_svc = get_email_service()
        email_svc.clear_outbox()
        client = TestClient(app)

        reg = client.post(
            "/api/auth/register",
            json={
                "username": "consented_student",
                "email": "consented@example.com",
                "password": "Password123!",
                "full_name": "Nguyen Van Minh",
                "privacy_consent": True,
                "privacy_policy_version": "1.0",
            },
        )
        assert reg.status_code == 200, reg.text
        assert len(email_svc.outbox) == 1
        raw_token = email_svc.outbox[-1].token
        assert raw_token

        act = client.post("/api/auth/activate", json={"token": raw_token})
        assert act.status_code == 200

        login = client.post(
            "/api/auth/login",
            json={"username": "consented_student", "password": "Password123!"},
        )
        assert login.status_code == 200
        token = login.json()["token"]
        login_user = login.json()["user"]
        assert login_user["privacy_consented_at"] is not None
        assert login_user["privacy_policy_version"] == "1.0"

        for endpoint in ("/api/auth/me", "/api/users/me"):
            me = client.get(endpoint, headers=_auth_header(token))
            assert me.status_code == 200
            body = me.json()
            assert body["privacy_consented_at"] is not None
            assert body["privacy_policy_version"] == "1.0"

    def test_google_onboarding_records_privacy_consent(self, clean_db, monkeypatch):
        monkeypatch.setenv("GOOGLE_CLIENT_ID", "test-google-client-id")
        client = TestClient(app)

        fake_google_profile = {
            "sub": "google-sub-dlcn-01",
            "email": "google.scholar@example.com",
            "email_verified": True,
            "name": "Google Scholar",
            "picture": "https://lh3.googleusercontent.com/a/default-user",
        }
        with patch(
            "integrity_checker.api.routes.auth._verify_google_payload",
            return_value=fake_google_profile,
        ):
            g_resp = client.post(
                "/api/auth/google",
                json={"credential": "mock-id-token"},
            )
        assert g_resp.status_code == 200, g_resp.text
        token = g_resp.json()["token"]
        g_user = g_resp.json()["user"]
        assert g_user["needs_onboarding"] is True
        assert g_user["privacy_consented_at"] is None
        assert g_user["privacy_policy_version"] is None

        # Explicit privacy_consent=False during onboarding must be rejected
        bad_patch = client.patch(
            "/api/users/me",
            json={"complete_onboarding": True, "privacy_consent": False},
            headers=_auth_header(token),
        )
        assert bad_patch.status_code == 400

        # Completing onboarding with privacy_consent=True records timestamp + version
        ok_patch = client.patch(
            "/api/users/me",
            json={
                "username": "google_scholar_vn",
                "complete_onboarding": True,
                "privacy_consent": True,
                "privacy_policy_version": "1.0",
            },
            headers=_auth_header(token),
        )
        assert ok_patch.status_code == 200, ok_patch.text
        updated = ok_patch.json()
        assert updated["username"] == "google_scholar_vn"
        assert updated["privacy_consented_at"] is not None
        assert updated["privacy_policy_version"] == "1.0"

    def test_google_signup_from_register_page_with_consent_stamps_immediately(
        self, clean_db, monkeypatch
    ):
        monkeypatch.setenv("GOOGLE_CLIENT_ID", "test-google-client-id")
        client = TestClient(app)

        fake_google_profile = {
            "sub": "google-sub-dlcn-02",
            "email": "google.register@example.com",
            "email_verified": True,
            "name": "Direct Register Google",
        }
        with patch(
            "integrity_checker.api.routes.auth._verify_google_payload",
            return_value=fake_google_profile,
        ):
            g_resp = client.post(
                "/api/auth/google",
                json={
                    "credential": "mock-id-token-2",
                    "privacy_consent": True,
                    "privacy_policy_version": "1.0",
                },
            )
        assert g_resp.status_code == 200, g_resp.text
        user_data = g_resp.json()["user"]
        assert user_data["privacy_consented_at"] is not None
        assert user_data["privacy_policy_version"] == "1.0"


class TestSelfServiceAccountDeletionAndCleanup:
    """DLCN-03: Self-service DELETE /api/users/me & complete removal of essays/files/avatars."""

    def test_local_user_self_delete_verifies_password_and_purges_all_data(
        self, clean_db, tmp_path: Path, monkeypatch
    ):
        uploads_dir = tmp_path / "uploads"
        uploads_dir.mkdir(parents=True, exist_ok=True)
        avatars_dir = tmp_path / "avatars"
        avatars_dir.mkdir(parents=True, exist_ok=True)
        monkeypatch.setattr(essays_routes, "UPLOADS_DIR", uploads_dir)
        custom_avatar_svc = AvatarService(base_dir=avatars_dir)
        monkeypatch.setattr(
            "integrity_checker.api.routes.users.get_avatar_service",
            lambda: custom_avatar_svc,
        )
        monkeypatch.setattr(
            "integrity_checker.db.repository.get_avatar_service",
            lambda: custom_avatar_svc,
            raising=False,
        )

        # Create active local user via admin
        admin_login = TestClient(app).post(
            "/api/auth/login", json={"username": "admin", "password": "admin123"}
        )
        admin_token = admin_login.json()["token"]
        client = TestClient(app)
        create_resp = client.post(
            "/api/users",
            json={
                "username": "student_del",
                "password": "MySecretPassword123!",
                "email": "student_del@example.com",
                "full_name": "Student Delete",
                "role": "user",
                "is_active": True,
            },
            headers=_auth_header(admin_token),
        )
        assert create_resp.status_code == 200
        user_id = create_resp.json()["id"]

        login_resp = client.post(
            "/api/auth/login",
            json={"username": "student_del", "password": "MySecretPassword123!"},
        )
        assert login_resp.status_code == 200
        user_token = login_resp.json()["token"]

        # Seed avatar file + 2 essays (.pdf and .docx) with citations, verdicts, and audit logs
        avatar_file = avatars_dir / f"{user_id}_test.png"
        avatar_file.write_bytes(b"\x89PNG\r\n\x1a\nfakeavatar")

        session = get_session()
        try:
            repo = Repository(session)
            repo.update_user(user_id, avatar_path=f"/api/avatars/{avatar_file.name}")
            e1 = repo.create_essay_with_user(
                filename="thesis_v1.pdf", num_pages=12, user_id=user_id
            )
            e2 = repo.create_essay_with_user(
                filename="thesis_v2.docx", num_pages=15, user_id=user_id
            )
            c1 = CitationRecord(
                essay_id=e1.id,
                raw_text="Nguyen (2024). Sample study.",
            )
            session.add(c1)
            session.flush()
            v1 = VerdictRecord(
                essay_id=e1.id,
                citation_raw="Nguyen (2024). Sample study.",
                label="VALID",
                confidence=0.95,
                reasoning="Matched.",
            )
            session.add(v1)
            session.flush()
            audit = AuditLog(
                verdict_id=v1.id,
                original_label="VALID",
                new_label="NEEDS_REVIEW",
                user="student_del",
                note="Check",
            )
            session.add(audit)
            session.commit()
            eid1, eid2, vid1 = e1.id, e2.id, v1.id
        finally:
            session.close()

        pdf_path = uploads_dir / f"{eid1}.pdf"
        docx_path = uploads_dir / f"{eid2}.docx"
        pdf_path.write_bytes(b"%PDF-1.4 thesis content")
        docx_path.write_bytes(b"PK\x03\x04 docx content")

        # 1. Missing password -> 400
        no_pw = client.request(
            "DELETE",
            "/api/users/me",
            json={},
            headers=_auth_header(user_token),
        )
        assert no_pw.status_code == 400

        # 2. Wrong password -> 400
        wrong_pw = client.request(
            "DELETE",
            "/api/users/me",
            json={"current_password": "WrongPassword999!"},
            headers=_auth_header(user_token),
        )
        assert wrong_pw.status_code == 400
        assert pdf_path.exists()

        # 3. Correct password -> 200 & complete data + file purge
        ok_del = client.request(
            "DELETE",
            "/api/users/me",
            json={"current_password": "MySecretPassword123!"},
            headers=_auth_header(user_token),
        )
        assert ok_del.status_code == 200, ok_del.text

        # Old JWT session is immediately invalidated
        after_me = client.get("/api/users/me", headers=_auth_header(user_token))
        assert after_me.status_code == 401

        # Files on disk are deleted
        assert not pdf_path.exists()
        assert not docx_path.exists()
        assert not avatar_file.exists()

        # Database rows are completely purged (no orphan EssayRecord with user_id=None)
        verify_session = get_session()
        try:
            assert verify_session.get(User, user_id) is None
            assert verify_session.get(EssayRecord, eid1) is None
            assert verify_session.get(EssayRecord, eid2) is None
            assert (
                verify_session.query(CitationRecord)
                .filter(CitationRecord.essay_id.in_([eid1, eid2]))
                .count()
                == 0
            )
            assert verify_session.get(VerdictRecord, vid1) is None
            assert (
                verify_session.query(AuditLog)
                .filter(AuditLog.verdict_id == vid1)
                .count()
                == 0
            )
        finally:
            verify_session.close()

    def test_google_only_user_self_delete_verifies_username_confirmation(
        self, clean_db, monkeypatch
    ):
        monkeypatch.setenv("GOOGLE_CLIENT_ID", "test-google-client-id")
        client = TestClient(app)

        fake_profile = {
            "sub": "google-sub-delete-me",
            "email": "deleteme.google@example.com",
            "email_verified": True,
            "name": "Delete Me Google",
        }
        with patch(
            "integrity_checker.api.routes.auth._verify_google_payload",
            return_value=fake_profile,
        ):
            g_resp = client.post(
                "/api/auth/google",
                json={"credential": "mock-del-token", "privacy_consent": True},
            )
        assert g_resp.status_code == 200
        token = g_resp.json()["token"]
        username = g_resp.json()["user"]["username"]
        user_id = g_resp.json()["user"]["id"]

        # Wrong or missing confirm_username -> 400
        bad_del = client.request(
            "DELETE",
            "/api/users/me",
            json={"confirm_username": "wrong_handle"},
            headers=_auth_header(token),
        )
        assert bad_del.status_code == 400

        # Exact username confirmation -> 200
        ok_del = client.request(
            "DELETE",
            "/api/users/me",
            json={"confirm_username": username},
            headers=_auth_header(token),
        )
        assert ok_del.status_code == 200, ok_del.text

        session = get_session()
        try:
            assert session.get(User, user_id) is None
        finally:
            session.close()

    def test_self_delete_blocks_last_active_admin(self, clean_db):
        client = TestClient(app)
        admin_login = client.post(
            "/api/auth/login", json={"username": "admin", "password": "admin123"}
        )
        assert admin_login.status_code == 200
        admin_token = admin_login.json()["token"]

        resp = client.request(
            "DELETE",
            "/api/users/me",
            json={"current_password": "admin123"},
            headers=_auth_header(admin_token),
        )
        assert resp.status_code == 400
        assert "admin" in resp.json()["detail"].lower()

    def test_deleting_teacher_purges_teacher_essays_but_preserves_student_essays(
        self, clean_db, tmp_path: Path, monkeypatch
    ):
        uploads_dir = tmp_path / "uploads"
        uploads_dir.mkdir(parents=True, exist_ok=True)
        monkeypatch.setattr(essays_routes, "UPLOADS_DIR", uploads_dir)

        client = TestClient(app)
        admin_token = client.post(
            "/api/auth/login", json={"username": "admin", "password": "admin123"}
        ).json()["token"]

        t_resp = client.post(
            "/api/users",
            json={
                "username": "teacher_owner",
                "password": "TeacherPass123!",
                "email": "teacher_owner@example.com",
                "role": "teacher",
                "is_active": True,
            },
            headers=_auth_header(admin_token),
        )
        s_resp = client.post(
            "/api/users",
            json={
                "username": "enrolled_student",
                "password": "StudentPass123!",
                "email": "enrolled_student@example.com",
                "role": "user",
                "is_active": True,
            },
            headers=_auth_header(admin_token),
        )
        teacher_id = t_resp.json()["id"]
        student_id = s_resp.json()["id"]

        session = get_session()
        try:
            repo = Repository(session)
            cls = repo.create_class(name="Thesis Seminar 2026", teacher_id=teacher_id)
            repo.add_student_to_class(class_id=cls.id, student_id=student_id)
            t_essay = repo.create_essay_with_user(
                filename="teacher_sample.pdf",
                num_pages=5,
                user_id=teacher_id,
                class_id=cls.id,
            )
            s_essay = repo.create_essay_with_user(
                filename="student_thesis.pdf",
                num_pages=20,
                user_id=student_id,
                class_id=cls.id,
            )
            session.commit()
            cls_id, t_eid, s_eid = cls.id, t_essay.id, s_essay.id
        finally:
            session.close()

        t_file = uploads_dir / f"{t_eid}.pdf"
        s_file = uploads_dir / f"{s_eid}.pdf"
        t_file.write_bytes(b"%PDF-1.4 teacher sample")
        s_file.write_bytes(b"%PDF-1.4 student thesis")

        # Teacher self-deletes account
        t_token = client.post(
            "/api/auth/login",
            json={"username": "teacher_owner", "password": "TeacherPass123!"},
        ).json()["token"]
        del_resp = client.request(
            "DELETE",
            "/api/users/me",
            json={"current_password": "TeacherPass123!"},
            headers=_auth_header(t_token),
        )
        assert del_resp.status_code == 200, del_resp.text

        # Teacher's own file & essay & class are purged; Student's file & essay remain intact!
        assert not t_file.exists()
        assert s_file.exists()

        check_session = get_session()
        try:
            assert check_session.get(User, teacher_id) is None
            assert check_session.get(Class, cls_id) is None
            assert check_session.get(EssayRecord, t_eid) is None
            preserved = check_session.get(EssayRecord, s_eid)
            assert preserved is not None
            assert preserved.user_id == student_id
            assert preserved.class_id is None
        finally:
            check_session.close()
