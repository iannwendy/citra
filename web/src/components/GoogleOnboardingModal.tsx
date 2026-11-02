import { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Sparkles,
  Lock,
  Mail,
  CheckCircle2,
  AlertCircle,
  Loader2,
  X,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useModalA11y } from '@/hooks/useModalA11y';

export function GoogleOnboardingModal() {
  const { i18n } = useTranslation();
  const lang = i18n.language?.startsWith('vi') ? 'vi' : 'en';
  const location = useLocation();
  const { user, refreshUser } = useAuth();

  const [open, setOpen] = useState(false);
  const [username, setUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [sendingEmail, setSendingEmail] = useState(false);
  const [error, setError] = useState('');
  const [emailSentMsg, setEmailSentMsg] = useState('');

  useEffect(() => {
    if (!user?.needs_onboarding) {
      setOpen(false);
      return;
    }
    // Don't cover the Profile page if the user navigated there directly to edit
    if (location.pathname === '/profile') {
      setOpen(false);
      return;
    }
    const dismissKey = `google_onboarding_dismissed_${user.id}`;
    if (sessionStorage.getItem(dismissKey) === '1') {
      setOpen(false);
      return;
    }
    setUsername(user.username || '');
    setOpen(true);
  }, [user, location.pathname]);

  const dismiss = () => {
    if (user) sessionStorage.setItem(`google_onboarding_dismissed_${user.id}`, '1');
    setOpen(false);
  };
  const { dialogProps, titleId } = useModalA11y<HTMLDivElement>(open && !!user, dismiss);

  if (!open || !user) return null;

  const handleDismiss = dismiss;

  const handleSendEmailLink = async () => {
    setError('');
    setEmailSentMsg('');
    setSendingEmail(true);
    try {
      await api.sendPasswordSetupEmail(lang);
      setEmailSentMsg(
        lang === 'vi'
          ? `Đã gửi liên kết đặt mật khẩu tới ${user.email}!`
          : `Password setup link sent to ${user.email}!`
      );
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : lang === 'vi'
            ? 'Không thể gửi email. Vui lòng thử lại.'
            : 'Could not send email. Please try again.'
      );
    } finally {
      setSendingEmail(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const trimmedUsername = username.trim();
    if (
      trimmedUsername.length < 3 ||
      trimmedUsername.length > 50 ||
      !/^[a-zA-Z0-9._-]+$/.test(trimmedUsername)
    ) {
      setError(
        lang === 'vi'
          ? 'Tên đăng nhập phải từ 3–50 ký tự và chỉ gồm chữ cái, số, dấu chấm (.), gạch dưới (_) hoặc gạch ngang (-).'
          : 'Username must be 3–50 characters and contain only letters, numbers, dots, underscores, or hyphens.'
      );
      return;
    }

    if (newPassword) {
      if (newPassword.length < 6) {
        setError(
          lang === 'vi'
            ? 'Mật khẩu phải có ít nhất 6 ký tự.'
            : 'Password must be at least 6 characters.'
        );
        return;
      }
      if (newPassword !== confirmPassword) {
        setError(
          lang === 'vi'
            ? 'Mật khẩu xác nhận không khớp.'
            : 'Passwords do not match.'
        );
        return;
      }
    }

    setSaving(true);
    try {
      await api.updateMe({
        username: trimmedUsername,
        complete_onboarding: true,
      });
      if (newPassword) {
        await api.changeMyPassword({
          new_password: newPassword,
        });
      }
      await refreshUser();
      setOpen(false);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : lang === 'vi'
            ? 'Không thể lưu thiết lập. Vui lòng thử lại.'
            : 'Failed to save setup. Please try again.'
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-4"
      data-testid="google-onboarding-modal"
    >
      <div
        {...dialogProps}
        className="relative w-full max-w-lg rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden outline-none"
      >
        {/* Top gradient bar */}
        <div className="h-1.5 w-full bg-gradient-to-r from-indigo-600 via-indigo-500 to-emerald-500" />

        <button
          type="button"
          onClick={handleDismiss}
          className="absolute right-4 top-4 p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="p-6 space-y-5">
          <div>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-indigo-50 dark:bg-indigo-950/80 border border-indigo-200/70 dark:border-indigo-800/70 text-[11px] font-mono font-semibold text-indigo-700 dark:text-indigo-300 mb-2.5">
              <Sparkles className="h-3.5 w-3.5" />
              {lang === 'vi'
                ? 'THIẾT LẬP TÀI KHOẢN GOOGLE LẦN ĐẦU'
                : 'FIRST-TIME GOOGLE ACCOUNT SETUP'}
            </span>
            <h2 id={titleId} className="font-display text-xl font-bold text-slate-900 dark:text-slate-100">
              {lang === 'vi'
                ? 'Hoàn tất hồ sơ CITRA của bạn'
                : 'Complete your CITRA profile'}
            </h2>
            <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-1">
              {lang === 'vi'
                ? `Xin chào ${user.full_name || user.username}! Hãy chọn tên đăng nhập (@username) của bạn và thiết lập mật khẩu (tuỳ chọn).`
                : `Welcome ${user.full_name || user.username}! Choose your custom @username and optionally set a local password.`}
            </p>
          </div>

          {error && (
            <Alert variant="destructive" className="rounded-xl">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {emailSentMsg && (
            <Alert variant="success" className="rounded-xl">
              <CheckCircle2 className="h-4 w-4" />
              <AlertDescription>{emailSentMsg}</AlertDescription>
            </Alert>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label className="input-label">
                {lang === 'vi'
                  ? 'Tên đăng nhập (@username) — Đặt 1 lần duy nhất'
                  : 'Username (@handle) — One-time customization'}
              </Label>
              <div className="relative mt-1.5">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 font-mono text-sm select-none">
                  @
                </span>
                <Input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  maxLength={50}
                  required
                  className="pl-8 rounded-xl font-mono"
                  placeholder="your_username"
                  data-testid="onboarding-username-input"
                />
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                {lang === 'vi'
                  ? '3–50 ký tự (chữ cái, số, dấu chấm, gạch dưới, gạch ngang).'
                  : '3–50 characters (letters, numbers, dots, underscores, hyphens).'}
              </p>
            </div>

            <div className="rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/80 dark:border-slate-800 p-3.5 space-y-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="text-xs font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                  <Lock className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />
                  {lang === 'vi'
                    ? 'Đặt mật khẩu đăng nhập (Tuỳ chọn)'
                    : 'Set a local password (Optional)'}
                </span>
                {user.email && (
                  <button
                    type="button"
                    onClick={handleSendEmailLink}
                    disabled={sendingEmail}
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-indigo-600 dark:text-indigo-400 hover:underline disabled:opacity-50"
                  >
                    {sendingEmail ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Mail className="h-3 w-3" />
                    )}
                    {lang === 'vi'
                      ? 'Gửi link đặt mật khẩu qua Email'
                      : 'Send setup link to email'}
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Input
                    type="password"
                    autoComplete="new-password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    minLength={6}
                    maxLength={128}
                    className="rounded-xl text-sm"
                    placeholder={
                      lang === 'vi'
                        ? 'Mật khẩu mới (tối thiểu 6 ký tự)'
                        : 'New password (min 6 chars)'
                    }
                  />
                </div>
                <div>
                  <Input
                    type="password"
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="rounded-xl text-sm"
                    placeholder={
                      lang === 'vi'
                        ? 'Nhập lại mật khẩu mới'
                        : 'Confirm new password'
                    }
                  />
                </div>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                {lang === 'vi'
                  ? `Nếu bỏ trống, bạn vẫn có thể đặt mật khẩu sau trong trang Hồ sơ hoặc qua liên kết đã gửi tới ${user.email}.`
                  : `If left blank, you can still set a password anytime on your Profile page or via the link sent to ${user.email}.`}
              </p>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={handleDismiss}
                className="rounded-xl text-xs sm:text-sm"
              >
                {lang === 'vi' ? 'Để sau (Đổi trong Hồ sơ)' : 'Later in Profile'}
              </Button>
              <Button
                type="submit"
                disabled={saving}
                className="gap-2 rounded-xl text-xs sm:text-sm"
                data-testid="onboarding-save-btn"
              >
                {saving ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    {lang === 'vi' ? 'Đang lưu...' : 'Saving...'}
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    {lang === 'vi' ? 'Hoàn tất thiết lập' : 'Save & Continue'}
                  </>
                )}
              </Button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
