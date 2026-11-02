"""Unit tests for CITRA EmailService and HTML email templates."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

from integrity_checker.api.services.email_service import EmailService, get_email_service
from integrity_checker.config import EmailConfig


def test_email_config_normalizes_google_app_password():
    cfg = EmailConfig(smtp_password="  zyem odit zzdm lshd  ")
    assert cfg.normalized_password == "zyemoditzzdmlshd"


def test_activation_email_vi_and_en_templates():
    svc = get_email_service()
    svc.clear_outbox()

    msg_vi = svc.send_activation_email(
        to_email="student@example.com",
        username="minh_nguyen",
        full_name="Nguyễn Bảo Minh",
        raw_token="tok_act_12345",
        institution="Ton Duc Thang University",
        lang="vi",
    )
    assert msg_vi.template_type == "activation"
    assert msg_vi.token == "tok_act_12345"
    assert msg_vi.action_url == "http://localhost:5173/activate-account?token=tok_act_12345"
    assert "CITRA" in msg_vi.subject
    assert "Kích hoạt Tài khoản Ngay" in msg_vi.html_body
    assert "Nguyễn Bảo Minh" in msg_vi.html_body
    assert "Ton Duc Thang University" in msg_vi.html_body
    assert "http://localhost:5173/activate-account?token=tok_act_12345" in msg_vi.text_body
    assert msg_vi.delivered_via_smtp is False  # Test runtime captures in outbox

    msg_en = svc.send_activation_email(
        to_email="student@example.com",
        username="minh_nguyen",
        full_name="Bao Minh",
        raw_token="tok_act_67890",
        lang="en",
    )
    assert "Activate Account Now" in msg_en.html_body
    assert "VALID FOR 24H" in msg_en.html_body
    assert len(svc.outbox) == 2


def test_password_reset_and_changed_emails():
    svc = EmailService()
    reset_msg = svc.send_password_reset_email(
        to_email="user@example.com",
        username="scholar_01",
        full_name="Dr. Tran",
        raw_token="reset_tok_abc",
        lang="vi",
    )
    assert reset_msg.template_type == "password_reset"
    assert reset_msg.action_url == "http://localhost:5173/reset-password?token=reset_tok_abc"
    assert "Đặt lại Mật khẩu" in reset_msg.html_body
    assert "HẾT HẠN SAU 30 PHÚT" in reset_msg.html_body

    changed_msg = svc.send_password_changed_email(
        to_email="user@example.com",
        username="scholar_01",
        full_name="Dr. Tran",
        lang="en",
    )
    assert changed_msg.template_type == "password_changed"
    assert "Your password has been updated" in changed_msg.html_body
    assert changed_msg.action_url == "http://localhost:5173/login"


def test_html_escaping_prevents_injection():
    svc = EmailService()
    msg = svc.send_activation_email(
        to_email="user@example.com",
        username="safe_user",
        full_name="<script>alert('xss')</script>",
        raw_token="tok_safe",
        institution="<b>Evil Corp</b>",
        lang="en",
    )
    assert "<script>alert('xss')</script>" not in msg.html_body
    assert "&lt;script&gt;alert(&#x27;xss&#x27;)&lt;/script&gt;" in msg.html_body
    assert "&lt;b&gt;Evil Corp&lt;/b&gt;" in msg.html_body


def test_smtp_ssl_delivery_when_forced():
    svc = EmailService()
    with patch("integrity_checker.api.services.email_service.smtplib.SMTP_SSL") as mock_ssl:
        mock_server = MagicMock()
        mock_ssl.return_value.__enter__.return_value = mock_server

        with patch("integrity_checker.api.services.email_service.get_settings") as mock_settings:
            settings_obj = MagicMock()
            settings_obj.email.enabled = True
            settings_obj.email.smtp_host = "smtp.gmail.com"
            settings_obj.email.smtp_port = 465
            settings_obj.email.smtp_user = "wendyxsausage@gmail.com"
            settings_obj.email.normalized_password = "zyemoditzzdmlshd"
            settings_obj.email.from_email = "wendyxsausage@gmail.com"
            settings_obj.email.from_name = "CITRA — Academic Source Verification"
            settings_obj.email.frontend_url = "http://localhost:5173"
            settings_obj.auth.activation_expire_hours = 24
            mock_settings.return_value = settings_obj

            msg = svc.send_activation_email(
                to_email="realuser@gmail.com",
                username="realuser",
                full_name="Real User",
                raw_token="tok_live_123",
                lang="vi",
                force_smtp=True,
            )

            assert msg.delivered_via_smtp is True
            mock_ssl.assert_called_once_with("smtp.gmail.com", 465, timeout=20)
            mock_server.login.assert_called_once_with("wendyxsausage@gmail.com", "zyemoditzzdmlshd")
            assert mock_server.sendmail.call_count == 1

    def test_background_tasks_email_dispatch_and_safe_error_handling(self):
        from fastapi import BackgroundTasks

        from integrity_checker.api.routes.auth import (
            _dispatch_email_task,
            _safe_send_email,
        )

        bg = BackgroundTasks()
        called_with = []

        def fake_sender(*, to_email: str, raw_token: str):
            called_with.append((to_email, raw_token))

        ok = _dispatch_email_task(bg, fake_sender, to_email="bg@example.com", raw_token="tok_bg_1")
        assert ok is True
        assert len(bg.tasks) == 1
        assert bg.tasks[0].func is _safe_send_email

        # Execute the scheduled background task and verify it invokes fake_sender
        bg.tasks[0].func(*bg.tasks[0].args, **bg.tasks[0].kwargs)
        assert called_with == [("bg@example.com", "tok_bg_1")]

        # Safe wrapper catches and logs exceptions without crashing the background worker
        def failing_sender():
            raise RuntimeError("SMTP connection refused")

        _safe_send_email(failing_sender)
        assert _dispatch_email_task(None, failing_sender) is False
