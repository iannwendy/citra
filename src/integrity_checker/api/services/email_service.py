"""Transactional HTML Email Service for CITRA (Register Activation & Password Reset).

Designed to match the CITRA 'Scholarly Precision' UI/UX aesthetic:
- Slate/Indigo/Emerald palette (#0f172a, #4f46e5, #10b981)
- Multipart/alternative MIME messages (Plain-text + Responsive HTML)
- Supports Gmail App Password over SMTP_SSL (port 465) and STARTTLS (port 587)
- Records sent messages in an in-memory outbox during tests for deterministic assertions
"""

from __future__ import annotations

import html
import logging
import os
import smtplib
from dataclasses import dataclass, field
from datetime import UTC, datetime, timezone
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.utils import formataddr, formatdate, make_msgid

from integrity_checker.config import get_settings, is_test_runtime

logger = logging.getLogger(__name__)

# Domains reserved by RFC 2606 / test suites that should not be routed to external Gmail
# (avoids bounce-back emails to the sender's Gmail inbox during automated tests).
_RESERVED_TEST_DOMAINS = (
    "@example.com",
    "@example.org",
    "@example.net",
    "@test.local",
    "@citra.test",
    "@localhost",
    "@university.edu.vn",
)


@dataclass
class SentEmailMessage:
    """Captured email record for test assertions and audit logging."""

    to_email: str
    subject: str
    html_body: str
    text_body: str
    template_type: str  # "activation" | "password_reset" | "password_changed"
    action_url: str | None = None
    token: str | None = None
    delivered_via_smtp: bool = False
    sent_at: datetime = field(default_factory=lambda: datetime.now(UTC))


def _is_reserved_test_email(email: str) -> bool:
    lowered = email.strip().lower()
    return any(lowered.endswith(domain) for domain in _RESERVED_TEST_DOMAINS)


def _render_scholarly_email_shell(
    *,
    lang: str,
    badge_label: str,
    headline: str,
    subtitle: str,
    greeting_html: str,
    body_html: str,
    cta_label: str | None = None,
    cta_url: str | None = None,
    meta_rows: list[tuple[str, str]] | None = None,
    security_notice: str | None = None,
    expire_badge: str | None = None,
) -> str:
    """Render a responsive, email-client-safe HTML document in CITRA Scholarly Precision style."""
    is_vi = lang.lower().startswith("vi")
    workspace_tag = (
        "KIẾN TRÚC KIỂM CHỨNG TRÍCH DẪN 2 LỚP"
        if is_vi
        else "TWO-LAYER ACADEMIC CITATION VERIFICATION"
    )
    fallback_link_title = (
        "Hoặc sao chép và dán liên kết dưới đây vào trình duyệt của bạn:"
        if is_vi
        else "Or copy and paste this direct link into your browser:"
    )
    footer_disclaimer = (
        "Hệ thống Hỗ trợ Quyết định Học thuật — Không tự động kết luận gian lận học thuật."
        if is_vi
        else "Academic Decision-Support System — Assists human review with explainable verification."
    )

    meta_table_html = ""
    if meta_rows:
        rows_html = []
        for label, value in meta_rows:
            rows_html.append(
                f"""
                <tr>
                  <td style="padding: 8px 12px; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: #64748b; border-bottom: 1px solid #e2e8f0; width: 38%;">
                    {html.escape(label)}
                  </td>
                  <td style="padding: 8px 12px; font-size: 13px; font-weight: 600; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; color: #0f172a; border-bottom: 1px solid #e2e8f0;">
                    {html.escape(value)}
                  </td>
                </tr>
                """
            )
        meta_table_html = f"""
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin: 20px 0; background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
          <tbody>
            {''.join(rows_html)}
          </tbody>
        </table>
        """

    expire_pill_html = ""
    if expire_badge:
        expire_pill_html = f"""
        <span style="display: inline-block; padding: 4px 10px; border-radius: 999px; background-color: #ecfdf5; border: 1px solid #a7f3d0; color: #047857; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 11px; font-weight: 700; letter-spacing: 0.03em;">
          {html.escape(expire_badge)}
        </span>
        """

    cta_section_html = ""
    if cta_label and cta_url:
        escaped_url = html.escape(cta_url, quote=True)
        cta_section_html = f"""
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin: 26px 0 22px 0;">
          <tr>
            <td align="center">
              <a href="{escaped_url}" target="_blank" style="display: inline-block; background-color: #4f46e5; background-image: linear-gradient(135deg, #4f46e5 0%, #4338ca 100%); color: #ffffff; font-size: 15px; font-weight: 700; text-decoration: none; padding: 14px 32px; border-radius: 12px; box-shadow: 0 6px 16px rgba(79, 70, 229, 0.25); letter-spacing: 0.01em;">
                {html.escape(cta_label)} &rarr;
              </a>
            </td>
          </tr>
        </table>
        <div style="margin-top: 18px; padding: 14px 16px; background-color: #f8fafc; border: 1px dashed #cbd5e1; border-radius: 10px;">
          <p style="margin: 0 0 6px 0; font-size: 12px; color: #64748b; font-weight: 500;">
            {html.escape(fallback_link_title)}
          </p>
          <p style="margin: 0; font-size: 12px; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; word-break: break-all; color: #4f46e5;">
            <a href="{escaped_url}" target="_blank" style="color: #4f46e5; text-decoration: underline;">{escaped_url}</a>
          </p>
        </div>
        """

    security_html = ""
    if security_notice:
        security_html = f"""
        <div style="margin-top: 22px; padding: 14px 16px; background-color: #fffbeb; border: 1px solid #fde68a; border-radius: 12px;">
          <p style="margin: 0; font-size: 12.5px; line-height: 1.55; color: #92400e;">
            <strong>&#128274; {"Lưu ý Bảo mật" if is_vi else "Security Notice"}:</strong> {html.escape(security_notice)}
          </p>
        </div>
        """

    return f"""<!DOCTYPE html>
<html lang="{html.escape(lang)}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>{html.escape(headline)} — CITRA</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; color: #0f172a; -webkit-font-smoothing: antialiased;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #f1f5f9; padding: 36px 16px;">
    <tr>
      <td align="center">
        <!-- Main Container -->
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width: 600px; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 18px; overflow: hidden; box-shadow: 0 12px 32px -8px rgba(15, 23, 42, 0.08);">
          <!-- Top Gradient Accent Bar (Indigo -> Emerald) -->
          <tr>
            <td style="height: 6px; background: linear-gradient(90deg, #4f46e5 0%, #6366f1 55%, #10b981 100%); font-size: 0; line-height: 0;">&nbsp;</td>
          </tr>

          <!-- Brand Header -->
          <tr>
            <td style="padding: 28px 32px 20px 32px; border-bottom: 1px solid #f1f5f9;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="left" valign="middle">
                    <div style="display: inline-block; vertical-align: middle;">
                      <span style="display: inline-block; padding: 6px 11px; border-radius: 10px; background-color: #0f172a; color: #ffffff; font-weight: 800; font-size: 16px; letter-spacing: 0.04em;">
                        CITRA
                      </span>
                      <span style="display: inline-block; margin-left: 10px; font-size: 11px; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-weight: 600; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em;">
                        {html.escape(workspace_tag)}
                      </span>
                    </div>
                  </td>
                  <td align="right" valign="middle">
                    {expire_pill_html}
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Main Content -->
          <tr>
            <td style="padding: 28px 32px 32px 32px;">
              <!-- Badge -->
              <div style="margin-bottom: 14px;">
                <span style="display: inline-block; padding: 4px 10px; border-radius: 6px; background-color: #eef2ff; border: 1px solid #c7d2fe; color: #4338ca; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em;">
                  {html.escape(badge_label)}
                </span>
              </div>

              <!-- Headline & Subtitle -->
              <h1 style="margin: 0 0 8px 0; font-size: 24px; font-weight: 800; letter-spacing: -0.02em; color: #0f172a; line-height: 1.25;">
                {html.escape(headline)}
              </h1>
              <p style="margin: 0 0 22px 0; font-size: 14px; color: #64748b; line-height: 1.5;">
                {html.escape(subtitle)}
              </p>

              <!-- Greeting & Body -->
              <div style="font-size: 15px; line-height: 1.65; color: #334155;">
                <p style="margin: 0 0 14px 0;">{greeting_html}</p>
                {body_html}
              </div>

              <!-- Metadata Table -->
              {meta_table_html}

              <!-- CTA Button & Fallback URL -->
              {cta_section_html}

              <!-- Security Notice -->
              {security_html}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 20px 32px; background-color: #f8fafc; border-top: 1px solid #e2e8f0;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="font-size: 12px; color: #64748b; line-height: 1.5;">
                    <strong style="color: #0f172a;">CITRA Workspace</strong> &middot; Neuro-Symbolic Citation Verification (GROBID TEI + Rules R01&ndash;R12)<br />
                    <span>{html.escape(footer_disclaimer)}</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>"""


class EmailService:
    """Service for building and sending CITRA transactional HTML emails."""

    def __init__(self) -> None:
        self.outbox: list[SentEmailMessage] = []

    def clear_outbox(self) -> None:
        """Clear in-memory test outbox."""
        self.outbox.clear()

    def send_raw_email(
        self,
        *,
        to_email: str,
        subject: str,
        html_body: str,
        text_body: str,
        template_type: str,
        action_url: str | None = None,
        token: str | None = None,
        force_smtp: bool = False,
    ) -> SentEmailMessage:
        """Send a multipart (text + HTML) email via Gmail SMTP and record in outbox."""
        settings = get_settings()
        record = SentEmailMessage(
            to_email=to_email,
            subject=subject,
            html_body=html_body,
            text_body=text_body,
            template_type=template_type,
            action_url=action_url,
            token=token,
            delivered_via_smtp=False,
        )

        # Keep last 100 emails in memory for dev/test & diagnostics only (never in production)
        raw_cfg_env = getattr(getattr(settings, "app", None), "env", "")
        cfg_env = raw_cfg_env if isinstance(raw_cfg_env, str) else ""
        app_env = (os.getenv("APP_ENV") or cfg_env).strip().lower()
        demo_enabled = os.getenv("DEMO_USERS_ENABLED", "").strip().lower() in ("true", "1", "yes")
        if app_env not in ("production", "prod", "live") or demo_enabled:
            if len(self.outbox) >= 100:
                self.outbox.pop(0)
            self.outbox.append(record)

        # Skip external network SMTP in pytest (unless force_smtp=True) or reserved RFC 2606 domains
        if (is_test_runtime() and not force_smtp) or (
            _is_reserved_test_email(to_email) and not force_smtp
        ):
            logger.info(
                "Email captured in outbox (template=%s, to=%s, test_mode=%s)",
                template_type,
                to_email,
                is_test_runtime(),
            )
            return record

        if not settings.email.enabled:
            logger.info("Email sending disabled in config; captured in outbox for %s", to_email)
            return record

        smtp_password = settings.email.normalized_password
        if not smtp_password:
            logger.warning(
                "SMTP_PASSWORD is not configured; email to %s captured in outbox only.",
                to_email,
            )
            return record

        from_addr_formatted = formataddr((settings.email.from_name, settings.email.from_email))
        from_domain = (
            settings.email.from_email.split("@", 1)[1].strip()
            if "@" in settings.email.from_email
            else "citra.io.vn"
        )

        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"] = from_addr_formatted
        msg["Reply-To"] = from_addr_formatted
        msg["To"] = to_email
        msg["Date"] = formatdate(localtime=True)
        msg["Message-ID"] = make_msgid(domain=from_domain)

        msg.attach(MIMEText(text_body, "plain", "utf-8"))
        msg.attach(MIMEText(html_body, "html", "utf-8"))

        host = settings.email.smtp_host
        port = settings.email.smtp_port
        user = settings.email.smtp_user

        try:
            if port == 465:
                with smtplib.SMTP_SSL(host, port, timeout=20) as server:
                    server.login(user, smtp_password)
                    server.sendmail(settings.email.from_email, [to_email], msg.as_string())
            else:
                with smtplib.SMTP(host, port, timeout=20) as server:
                    server.ehlo()
                    server.starttls()
                    server.ehlo()
                    server.login(user, smtp_password)
                    server.sendmail(settings.email.from_email, [to_email], msg.as_string())

            record.delivered_via_smtp = True
            logger.info("Sent %s HTML email via SMTP to %s", template_type, to_email)
        except Exception as exc:
            logger.error("Failed to send %s email to %s via SMTP: %s", template_type, to_email, exc)
            raise

        return record

    def send_activation_email(
        self,
        *,
        to_email: str,
        username: str,
        full_name: str | None,
        raw_token: str,
        institution: str | None = None,
        lang: str = "vi",
        force_smtp: bool = False,
    ) -> SentEmailMessage:
        """Build and send the Account Activation HTML email."""
        settings = get_settings()
        frontend_url = settings.email.frontend_url.rstrip("/")
        expire_hours = settings.auth.activation_expire_hours
        action_url = f"{frontend_url}/activate-account?token={raw_token}"

        display_name = full_name.strip() if full_name and full_name.strip() else username
        is_vi = lang.lower().startswith("vi")

        if is_vi:
            subject = "[CITRA] Kích hoạt tài khoản Không gian Xác minh Học thuật của bạn"
            badge_label = "XÁC MINH TÀI KHOẢN · ACCOUNT ACTIVATION"
            headline = "Kích hoạt tài khoản CITRA của bạn"
            subtitle = "Hoàn tất bước xác thực email để truy cập Không gian Xác minh Trích dẫn Học thuật 2 Lớp."
            greeting_html = f"Xin chào <strong>{html.escape(display_name)}</strong>,"
            body_html = (
                "<p style=\"margin: 0 0 12px 0;\">"
                "Cảm ơn bạn đã đăng ký tài khoản trên <strong>CITRA</strong> — Hệ thống Kiểm chứng Trích dẫn "
                "và Toàn vẹn Nguồn Học thuật Neuro-Symbolic. Để bảo vệ tính xác thực của không gian làm việc, "
                "vui lòng xác nhận địa chỉ email của bạn bằng cách nhấn vào nút bên dưới."
                "</p>"
            )
            cta_label = "Kích hoạt Tài khoản Ngay"
            expire_badge = f"HIỆU LỰC {expire_hours} GIỜ"
            meta_rows = [
                ("Tên đăng nhập", username),
                ("Địa chỉ Email", to_email),
                ("Vai trò mặc định", "Student / Researcher"),
            ]
            if institution:
                meta_rows.append(("Đơn vị / Trường", institution))
            security_notice = (
                f"Liên kết kích hoạt này có hiệu lực trong vòng {expire_hours} giờ và chỉ sử dụng một lần. "
                "Nếu bạn không thực hiện đăng ký tài khoản CITRA, vui lòng bỏ qua email này."
            )
            text_body = (
                f"Xin chào {display_name},\n\n"
                f"Cảm ơn bạn đã đăng ký tài khoản CITRA (Tên đăng nhập: {username}).\n"
                f"Vui lòng mở liên kết sau để kích hoạt tài khoản của bạn (hiệu lực {expire_hours} giờ):\n"
                f"{action_url}\n\n"
                "Nếu bạn không yêu cầu tạo tài khoản này, vui lòng bỏ qua email này.\n"
                "— CITRA Academic Source Verification Workspace"
            )
        else:
            subject = "[CITRA] Activate Your Academic Source Verification Account"
            badge_label = "EMAIL VERIFICATION · ACCOUNT ACTIVATION"
            headline = "Activate your CITRA account"
            subtitle = "Complete your email verification to access the Two-Layer Academic Citation Workspace."
            greeting_html = f"Hello <strong>{html.escape(display_name)}</strong>,"
            body_html = (
                "<p style=\"margin: 0 0 12px 0;\">"
                "Thank you for registering an account on <strong>CITRA</strong> — the Neuro-Symbolic Academic "
                "Source Verification &amp; Citation Integrity Workspace. Please verify your email address by "
                "clicking the button below to activate your account."
                "</p>"
            )
            cta_label = "Activate Account Now"
            expire_badge = f"VALID FOR {expire_hours}H"
            meta_rows = [
                ("Username", username),
                ("Email Address", to_email),
                ("Default Role", "Student / Researcher"),
            ]
            if institution:
                meta_rows.append(("Institution", institution))
            security_notice = (
                f"This activation link is valid for {expire_hours} hours and can only be used once. "
                "If you did not create a CITRA account, you can safely ignore this email."
            )
            text_body = (
                f"Hello {display_name},\n\n"
                f"Thank you for registering on CITRA (Username: {username}).\n"
                f"Please open the link below to activate your account (valid for {expire_hours} hours):\n"
                f"{action_url}\n\n"
                "If you did not create this account, please ignore this email.\n"
                "— CITRA Academic Source Verification Workspace"
            )

        html_body = _render_scholarly_email_shell(
            lang=lang,
            badge_label=badge_label,
            headline=headline,
            subtitle=subtitle,
            greeting_html=greeting_html,
            body_html=body_html,
            cta_label=cta_label,
            cta_url=action_url,
            meta_rows=meta_rows,
            security_notice=security_notice,
            expire_badge=expire_badge,
        )

        return self.send_raw_email(
            to_email=to_email,
            subject=subject,
            html_body=html_body,
            text_body=text_body,
            template_type="activation",
            action_url=action_url,
            token=raw_token,
            force_smtp=force_smtp,
        )

    def send_password_reset_email(
        self,
        *,
        to_email: str,
        username: str,
        full_name: str | None,
        raw_token: str,
        lang: str = "vi",
        force_smtp: bool = False,
    ) -> SentEmailMessage:
        """Build and send the Forgot Password / Password Reset HTML email."""
        settings = get_settings()
        frontend_url = settings.email.frontend_url.rstrip("/")
        expire_minutes = settings.auth.reset_expire_minutes
        action_url = f"{frontend_url}/reset-password?token={raw_token}"

        display_name = full_name.strip() if full_name and full_name.strip() else username
        is_vi = lang.lower().startswith("vi")
        timestamp_str = datetime.now(UTC).strftime("%Y-%m-%d %H:%M UTC")

        if is_vi:
            subject = "[CITRA] Yêu cầu Đặt lại Mật khẩu Tài khoản của bạn"
            badge_label = "KHÔI PHỤC BẢO MẬT · PASSWORD RESET"
            headline = "Đặt lại mật khẩu tài khoản CITRA"
            subtitle = "Chúng tôi nhận được yêu cầu đặt lại mật khẩu cho tài khoản gắn với địa chỉ email này."
            greeting_html = f"Xin chào <strong>{html.escape(display_name)}</strong>,"
            body_html = (
                "<p style=\"margin: 0 0 12px 0;\">"
                "Bạn vừa gửi yêu cầu khôi phục mật khẩu trên hệ thống <strong>CITRA</strong>. "
                "Nhấn vào nút bên dưới để thiết lập mật khẩu mới. Sau khi đổi mật khẩu thành công, "
                "tất cả các phiên đăng nhập cũ sẽ tự động được thu hồi để đảm bảo an toàn."
                "</p>"
            )
            cta_label = "Đặt lại Mật khẩu"
            expire_badge = f"HẾT HẠN SAU {expire_minutes} PHÚT"
            meta_rows = [
                ("Tên đăng nhập", username),
                ("Địa chỉ Email", to_email),
                ("Thời điểm yêu cầu", timestamp_str),
            ]
            security_notice = (
                f"Liên kết khôi phục mật khẩu chỉ có hiệu lực trong {expire_minutes} phút và chỉ dùng 1 lần. "
                "Nếu bạn KHÔNG yêu cầu đặt lại mật khẩu, hãy bỏ qua email này — mật khẩu hiện tại của bạn vẫn an toàn."
            )
            text_body = (
                f"Xin chào {display_name},\n\n"
                f"Chúng tôi nhận được yêu cầu đặt lại mật khẩu cho tài khoản CITRA ({username}).\n"
                f"Mở liên kết dưới đây để thiết lập mật khẩu mới (hiệu lực {expire_minutes} phút):\n"
                f"{action_url}\n\n"
                "Nếu bạn không yêu cầu đặt lại mật khẩu, vui lòng bỏ qua email này.\n"
                "— CITRA Academic Source Verification Workspace"
            )
        else:
            subject = "[CITRA] Password Reset Request for Your Workspace Account"
            badge_label = "SECURITY RECOVERY · PASSWORD RESET"
            headline = "Reset your CITRA password"
            subtitle = "We received a request to reset the password associated with this email address."
            greeting_html = f"Hello <strong>{html.escape(display_name)}</strong>,"
            body_html = (
                "<p style=\"margin: 0 0 12px 0;\">"
                "A password reset was requested for your <strong>CITRA</strong> account. "
                "Click the button below to choose a new password. Once updated, all previous active "
                "sessions will be automatically revoked for your security."
                "</p>"
            )
            cta_label = "Reset Password Now"
            expire_badge = f"EXPIRES IN {expire_minutes}M"
            meta_rows = [
                ("Username", username),
                ("Email Address", to_email),
                ("Requested At", timestamp_str),
            ]
            security_notice = (
                f"This password reset link expires in {expire_minutes} minutes and can only be used once. "
                "If you did NOT request a password reset, please ignore this email — your password will remain unchanged."
            )
            text_body = (
                f"Hello {display_name},\n\n"
                f"We received a password reset request for your CITRA account ({username}).\n"
                f"Use the link below to set a new password (valid for {expire_minutes} minutes):\n"
                f"{action_url}\n\n"
                "If you did not request this, you can safely ignore this email.\n"
                "— CITRA Academic Source Verification Workspace"
            )

        html_body = _render_scholarly_email_shell(
            lang=lang,
            badge_label=badge_label,
            headline=headline,
            subtitle=subtitle,
            greeting_html=greeting_html,
            body_html=body_html,
            cta_label=cta_label,
            cta_url=action_url,
            meta_rows=meta_rows,
            security_notice=security_notice,
            expire_badge=expire_badge,
        )

        return self.send_raw_email(
            to_email=to_email,
            subject=subject,
            html_body=html_body,
            text_body=text_body,
            template_type="password_reset",
            action_url=action_url,
            token=raw_token,
            force_smtp=force_smtp,
        )

    def send_password_changed_email(
        self,
        *,
        to_email: str,
        username: str,
        full_name: str | None,
        lang: str = "vi",
        force_smtp: bool = False,
    ) -> SentEmailMessage:
        """Build and send a security confirmation email after password reset."""
        settings = get_settings()
        frontend_url = settings.email.frontend_url.rstrip("/")
        action_url = f"{frontend_url}/login"
        display_name = full_name.strip() if full_name and full_name.strip() else username
        is_vi = lang.lower().startswith("vi")
        timestamp_str = datetime.now(UTC).strftime("%Y-%m-%d %H:%M UTC")

        if is_vi:
            subject = "[CITRA] Mật khẩu tài khoản của bạn đã được cập nhật thành công"
            badge_label = "THÔNG BÁO BẢO MẬT · SECURITY CONFIRMATION"
            headline = "Mật khẩu đã được cập nhật"
            subtitle = "Mật khẩu đăng nhập CITRA của bạn vừa được thay đổi thành công."
            greeting_html = f"Xin chào <strong>{html.escape(display_name)}</strong>,"
            body_html = (
                "<p style=\"margin: 0 0 12px 0;\">"
                "Mật khẩu cho tài khoản <strong>CITRA</strong> của bạn đã được đặt lại thành công. "
                "Tất cả các phiên đăng nhập trước đó đã được đăng xuất tự động. Bạn có thể đăng nhập lại ngay bây giờ."
                "</p>"
            )
            cta_label = "Đăng nhập vào CITRA"
            expire_badge = "ĐÃ XÁC THỰC"
            meta_rows = [
                ("Tên đăng nhập", username),
                ("Địa chỉ Email", to_email),
                ("Thời gian cập nhật", timestamp_str),
            ]
            security_notice = (
                "Nếu bạn không thực hiện thay đổi này, vui lòng sử dụng ngay chức năng Quên mật khẩu hoặc liên hệ Quản trị viên."
            )
            text_body = (
                f"Xin chào {display_name},\n\n"
                f"Mật khẩu cho tài khoản CITRA ({username}) đã được cập nhật thành công vào lúc {timestamp_str}.\n"
                f"Đăng nhập tại: {action_url}\n"
            )
        else:
            subject = "[CITRA] Your Account Password Has Been Updated"
            badge_label = "SECURITY CONFIRMATION · PASSWORD UPDATED"
            headline = "Your password has been updated"
            subtitle = "Your CITRA workspace password was recently changed."
            greeting_html = f"Hello <strong>{html.escape(display_name)}</strong>,"
            body_html = (
                "<p style=\"margin: 0 0 12px 0;\">"
                "The password for your <strong>CITRA</strong> account has been successfully reset. "
                "All previous active sessions have been signed out. You may now sign in with your new credentials."
                "</p>"
            )
            cta_label = "Sign In to CITRA"
            expire_badge = "CONFIRMED"
            meta_rows = [
                ("Username", username),
                ("Email Address", to_email),
                ("Updated At", timestamp_str),
            ]
            security_notice = (
                "If you did not authorize this change, please reset your password immediately or contact your workspace administrator."
            )
            text_body = (
                f"Hello {display_name},\n\n"
                f"The password for your CITRA account ({username}) was successfully updated at {timestamp_str}.\n"
                f"Sign in at: {action_url}\n"
            )

        html_body = _render_scholarly_email_shell(
            lang=lang,
            badge_label=badge_label,
            headline=headline,
            subtitle=subtitle,
            greeting_html=greeting_html,
            body_html=body_html,
            cta_label=cta_label,
            cta_url=action_url,
            meta_rows=meta_rows,
            security_notice=security_notice,
            expire_badge=expire_badge,
        )

        return self.send_raw_email(
            to_email=to_email,
            subject=subject,
            html_body=html_body,
            text_body=text_body,
            template_type="password_changed",
            action_url=action_url,
            force_smtp=force_smtp,
        )

    def send_google_welcome_email(
        self,
        *,
        to_email: str,
        username: str,
        full_name: str | None,
        raw_token: str,
        lang: str = "vi",
        force_smtp: bool = False,
    ) -> SentEmailMessage:
        """Build and send a welcome + initial password setup HTML email for new Google OAuth users."""
        settings = get_settings()
        frontend_url = settings.email.frontend_url.rstrip("/")
        action_url = f"{frontend_url}/reset-password?token={raw_token}"
        display_name = full_name.strip() if full_name and full_name.strip() else username
        is_vi = lang.lower().startswith("vi")
        timestamp_str = datetime.now(UTC).strftime("%Y-%m-%d %H:%M UTC")

        if is_vi:
            subject = "[CITRA] Chào mừng bạn đến với CITRA — Thiết lập mật khẩu & tên đăng nhập"
            badge_label = "TÀI KHOẢN GOOGLE · INITIAL PASSWORD SETUP"
            headline = "Chào mừng bạn đến với Không gian CITRA"
            subtitle = "Tài khoản của bạn đã được khởi tạo thành công qua Google OAuth 2.0."
            greeting_html = f"Xin chào <strong>{html.escape(display_name)}</strong>,"
            body_html = (
                "<p style=\"margin: 0 0 12px 0;\">"
                "Cảm ơn bạn đã đăng nhập vào <strong>CITRA</strong> bằng tài khoản Google. "
                "Bạn có thể tuỳ chỉnh <strong>tên đăng nhập (@username)</strong> cho lần đầu tiên ngay trong trang "
                "<strong>Hồ sơ cá nhân</strong> trên hệ thống."
                "</p>"
                "<p style=\"margin: 0 0 12px 0;\">"
                "Nếu bạn muốn đăng nhập song song bằng cả <strong>Tên đăng nhập / Email và Mật khẩu</strong> "
                "(bên cạnh nút Tiếp tục với Google), hãy nhấn vào nút bên dưới để thiết lập mật khẩu lần đầu cho tài khoản của bạn:"
                "</p>"
            )
            cta_label = "Thiết lập Mật khẩu Lần đầu"
            expire_badge = "HIỆU LỰC 24 GIỜ"
            meta_rows = [
                ("Tên đăng nhập hiện tại", f"@{username}"),
                ("Email Google liên kết", to_email),
                ("Phương thức xác thực", "Google OAuth 2.0"),
                ("Thời điểm khởi tạo", timestamp_str),
            ]
            security_notice = (
                "Liên kết thiết lập mật khẩu này có hiệu lực trong 24 giờ và chỉ sử dụng 1 lần. "
                "Bạn cũng có thể đặt mật khẩu trực tiếp trong trang Hồ sơ cá nhân bất cứ lúc nào mà không cần mật khẩu cũ."
            )
            text_body = (
                f"Xin chào {display_name},\n\n"
                f"Chào mừng bạn đến với CITRA (Tên đăng nhập: @{username}).\n"
                "Bạn có thể đặt lại tên đăng nhập lần đầu trong trang Hồ sơ cá nhân hoặc thiết lập mật khẩu đăng nhập qua liên kết dưới đây (hiệu lực 24 giờ):\n"
                f"{action_url}\n\n"
                "— CITRA Academic Source Verification Workspace"
            )
        else:
            subject = "[CITRA] Welcome to CITRA — Set Up Your Password & Username"
            badge_label = "GOOGLE OAUTH 2.0 · INITIAL PASSWORD SETUP"
            headline = "Welcome to your CITRA Workspace"
            subtitle = "Your account has been created via Google Sign-In."
            greeting_html = f"Hello <strong>{html.escape(display_name)}</strong>,"
            body_html = (
                "<p style=\"margin: 0 0 12px 0;\">"
                "Thank you for signing in to <strong>CITRA</strong> with Google. "
                "You can customize your <strong>@username</strong> for the first time directly on your "
                "<strong>Profile</strong> page."
                "</p>"
                "<p style=\"margin: 0 0 12px 0;\">"
                "If you would also like to sign in using your <strong>Username / Email and a Password</strong> "
                "(in addition to Google Sign-In), click the button below to set your initial password:"
                "</p>"
            )
            cta_label = "Set Initial Password"
            expire_badge = "VALID FOR 24H"
            meta_rows = [
                ("Current Username", f"@{username}"),
                ("Linked Google Email", to_email),
                ("Auth Method", "Google OAuth 2.0"),
                ("Created At", timestamp_str),
            ]
            security_notice = (
                "This initial password setup link is valid for 24 hours and can only be used once. "
                "You can also set your password anytime directly on your Profile page without needing a current password."
            )
            text_body = (
                f"Hello {display_name},\n\n"
                f"Welcome to CITRA (Username: @{username}).\n"
                "You can customize your username on your Profile page, or set an initial password using the link below (valid for 24 hours):\n"
                f"{action_url}\n\n"
                "— CITRA Academic Source Verification Workspace"
            )

        html_body = _render_scholarly_email_shell(
            lang=lang,
            badge_label=badge_label,
            headline=headline,
            subtitle=subtitle,
            greeting_html=greeting_html,
            body_html=body_html,
            cta_label=cta_label,
            cta_url=action_url,
            meta_rows=meta_rows,
            security_notice=security_notice,
            expire_badge=expire_badge,
        )

        return self.send_raw_email(
            to_email=to_email,
            subject=subject,
            html_body=html_body,
            text_body=text_body,
            template_type="google_welcome",
            action_url=action_url,
            token=raw_token,
            force_smtp=force_smtp,
        )


_email_service_singleton = EmailService()


def get_email_service() -> EmailService:
    """Return the singleton EmailService instance."""
    return _email_service_singleton
