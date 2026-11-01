import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Save,
  Loader2,
  Lock,
  AlertCircle,
  CheckCircle2,
  ShieldCheck,
  Terminal,
  UserCheck,
  Mail,
  Sparkles,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { AvatarUpload } from '@/components/AvatarUpload';
import { api } from '@/api/client';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Alert, AlertDescription } from '@/components/ui/alert';

export function ProfilePage() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language?.startsWith('vi') ? 'vi' : 'en';
  const { user: authUser, refreshUser } = useAuth();

  const [username, setUsername] = useState('');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState('');
  const [profileSuccess, setProfileSuccess] = useState(false);

  // Password change / initial password setup
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState('');
  const [emailLinkSending, setEmailLinkSending] = useState(false);

  const canSetUsername = Boolean(authUser?.can_set_username);
  const hasPassword =
    authUser?.has_password !== undefined
      ? authUser.has_password
      : authUser?.auth_provider !== 'google';

  // Init from auth user
  useEffect(() => {
    if (authUser) {
      setUsername(authUser.username ?? '');
      setFullName(authUser.full_name ?? '');
      setEmail(authUser.email ?? '');
    }
  }, [authUser]);

  const handleProfileSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileError('');
    setProfileSuccess(false);

    const trimmedUsername = username.trim();
    if (canSetUsername) {
      if (
        trimmedUsername.length < 3 ||
        trimmedUsername.length > 50 ||
        !/^[a-zA-Z0-9._-]+$/.test(trimmedUsername)
      ) {
        setProfileError(
          lang === 'vi'
            ? 'Tên đăng nhập phải từ 3–50 ký tự và chỉ chứa chữ cái, chữ số, dấu chấm (.), gạch dưới (_) hoặc gạch ngang (-).'
            : 'Username must be 3–50 characters and contain only letters, numbers, dots, underscores, or hyphens.'
        );
        return;
      }
    }

    setProfileLoading(true);
    try {
      const updated = await api.updateMe({
        ...(canSetUsername ? { username: trimmedUsername } : {}),
        full_name: fullName || undefined,
        email: email || undefined,
      });
      await refreshUser();
      setUsername(updated.username ?? '');
      setFullName(updated.full_name ?? '');
      setEmail(updated.email ?? '');
      setProfileSuccess(true);
      setTimeout(() => setProfileSuccess(false), 3000);
    } catch (err) {
      setProfileError(err instanceof Error ? err.message : t('profile.failedToSave'));
    } finally {
      setProfileLoading(false);
    }
  };

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError('');
    setPasswordSuccess('');

    if (newPassword.length < 6) {
      setPasswordError(t('profile.passwordMinLengthError'));
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError(t('profile.passwordMismatchError'));
      return;
    }
    if (hasPassword && newPassword === currentPassword) {
      setPasswordError(t('profile.passwordSameError'));
      return;
    }

    setPasswordLoading(true);
    try {
      await api.changeMyPassword({
        ...(hasPassword ? { current_password: currentPassword } : {}),
        new_password: newPassword,
      });
      await refreshUser();
      setPasswordSuccess(
        hasPassword
          ? t('profile.passwordChangedSuccess')
          : lang === 'vi'
            ? 'Thiết lập mật khẩu thành công! Giờ đây bạn có thể đăng nhập bằng cả Google hoặc Tên đăng nhập + Mật khẩu.'
            : 'Password set successfully! You can now sign in with either Google or Username + Password.'
      );
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setTimeout(() => setPasswordSuccess(''), 6000);
    } catch (err) {
      setPasswordError(
        err instanceof Error ? err.message : t('profile.passwordChangeFailed')
      );
    } finally {
      setPasswordLoading(false);
    }
  };

  const handleSendPasswordSetupEmail = async () => {
    setPasswordError('');
    setPasswordSuccess('');
    setEmailLinkSending(true);
    try {
      await api.sendPasswordSetupEmail(lang);
      setPasswordSuccess(
        lang === 'vi'
          ? `Đã gửi liên kết đặt mật khẩu tới ${authUser?.email}! Vui lòng kiểm tra hộp thư Gmail của bạn.`
          : `Password setup link sent to ${authUser?.email}! Please check your email inbox.`
      );
    } catch (err) {
      setPasswordError(
        err instanceof Error
          ? err.message
          : lang === 'vi'
            ? 'Không thể gửi email thiết lập mật khẩu. Vui lòng thử lại.'
            : 'Could not send password setup email. Please try again.'
      );
    } finally {
      setEmailLinkSending(false);
    }
  };

  const dateLocale = i18n.language?.startsWith('vi') ? 'vi-VN' : 'en-US';

  return (
    <div className="space-y-6 w-full max-w-4xl mx-auto pb-10">
      {/* Executive Header Card */}
      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 p-5 sm:p-6 shadow-xs">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2.5 flex-wrap mb-2.5">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-indigo-50 dark:bg-indigo-950/80 border border-indigo-200/70 dark:border-indigo-800/70 text-[11px] font-mono font-semibold text-indigo-700 dark:text-indigo-300">
                <ShieldCheck className="h-3.5 w-3.5" />
                {lang === 'vi' ? 'ĐỊNH DANH NGƯỜI DÙNG HỌC THUẬT' : 'SCHOLAR IDENTITY PROFILE'}
              </span>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-50 dark:bg-emerald-950/70 border border-emerald-200/70 dark:border-emerald-800/70 text-[11px] font-mono text-emerald-700 dark:text-emerald-300">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                @{authUser?.username ?? 'user'}
              </span>
            </div>

            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-indigo-50 dark:bg-indigo-950/80 border border-indigo-200/70 dark:border-indigo-800/70 flex items-center justify-center shrink-0">
                <UserCheck className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
              </div>
              <div>
                <h1 className="font-display text-2xl sm:text-3xl font-bold text-slate-900 dark:text-slate-100 tracking-tight">
                  {t('profile.title')}
                </h1>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
                  {t('profile.subtitle')}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Architectural Identity Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 shadow-2xs">
          <div className="flex items-center justify-between mb-1">
            <p className="text-slate-500 dark:text-slate-400 text-xs">
              {t('profile.role')}
            </p>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-indigo-50 dark:bg-indigo-950/80 text-indigo-600 dark:text-indigo-400">
              01
            </span>
          </div>
          <p className="font-display font-bold text-lg text-slate-900 dark:text-slate-100 capitalize">
            {authUser?.role ?? '—'}
          </p>
        </Card>

        <Card className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 shadow-2xs">
          <div className="flex items-center justify-between mb-1">
            <p className="text-slate-500 dark:text-slate-400 text-xs">
              {t('profile.memberSince')}
            </p>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/80 text-emerald-600 dark:text-emerald-400">
              02
            </span>
          </div>
          <p className="font-mono font-semibold text-sm text-slate-900 dark:text-slate-100">
            {authUser?.created_at
              ? new Date(authUser.created_at).toLocaleDateString(dateLocale, {
                  month: 'long',
                  day: 'numeric',
                  year: 'numeric',
                })
              : '—'}
          </p>
        </Card>

        <Card className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 shadow-2xs">
          <div className="flex items-center justify-between mb-1">
            <p className="text-slate-500 dark:text-slate-400 text-xs">
              {t('profile.lastLogin')}
            </p>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
              03
            </span>
          </div>
          <p className="font-mono font-semibold text-sm text-slate-900 dark:text-slate-100">
            {authUser?.last_login_at
              ? new Date(authUser.last_login_at).toLocaleDateString(dateLocale, {
                  month: 'long',
                  day: 'numeric',
                  year: 'numeric',
                })
              : '—'}
          </p>
        </Card>
      </div>

      {/* Avatar + Basic Info IDE Container */}
      <div className="rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-4 py-3 bg-slate-50/90 dark:bg-slate-900/90 border-b border-slate-200/80 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-red-400/80" />
              <span className="w-2.5 h-2.5 rounded-full bg-amber-400/80" />
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400/80" />
            </div>
            <Separator orientation="vertical" className="h-4" />
            <Terminal className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />
            <span className="text-xs font-mono font-semibold text-slate-700 dark:text-slate-200">
              identity_profile.config
            </span>
          </div>
        </div>

        <div className="p-4 sm:p-6">
          <div className="flex flex-col sm:flex-row sm:items-start gap-5 sm:gap-6">
            {/* Avatar upload */}
            <div className="flex flex-col items-center gap-3 shrink-0 sm:w-56 p-4 rounded-xl bg-slate-50/70 dark:bg-slate-800/40 border border-slate-200/70 dark:border-slate-800">
              <AvatarUpload
                currentAvatarUrl={authUser?.avatar_url ?? null}
                onSuccess={() => {
                  refreshUser();
                }}
                size="lg"
              />
              <p className="text-[11px] font-mono text-slate-500 dark:text-slate-400 text-center max-w-[9rem]">
                {t('profile.avatarTypes')}{' '}
                <br />
                {t('profile.avatarMax')}
              </p>
            </div>

            {/* Profile form */}
            <div className="flex-1 space-y-4 min-w-0">
              <div>
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <Label className="input-label">{t('profile.username')}</Label>
                  {canSetUsername && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-indigo-50 dark:bg-indigo-950/80 border border-indigo-200/70 dark:border-indigo-800/70 text-[11px] font-mono font-medium text-indigo-700 dark:text-indigo-300">
                      <Sparkles className="h-3 w-3" />
                      {lang === 'vi'
                        ? 'Tài khoản Google · Đặt username lần đầu'
                        : 'Google Account · First-time username setup'}
                    </span>
                  )}
                </div>
                {canSetUsername ? (
                  <>
                    <div className="relative mt-1.5">
                      <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 font-mono text-sm select-none">
                        @
                      </span>
                      <Input
                        type="text"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        maxLength={50}
                        className="pl-8 rounded-xl font-mono"
                        placeholder="your_username"
                        data-testid="profile-username-input"
                      />
                    </div>
                    <p className="text-xs text-indigo-600 dark:text-indigo-400 mt-1">
                      {lang === 'vi'
                        ? 'Bạn có thể đặt tên đăng nhập (username) 1 lần cho tài khoản Google của mình, sau đó nhấn Lưu thay đổi.'
                        : 'You can customize your username once for your Google account, then click Save Changes.'}
                    </p>
                  </>
                ) : (
                  <>
                    <Input
                      type="text"
                      value={authUser?.username ?? ''}
                      readOnly
                      disabled
                      className="opacity-60 cursor-not-allowed mt-1.5 rounded-xl font-mono"
                    />
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                      {t('profile.usernameReadonly')}
                    </p>
                  </>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <Label className="input-label">{t('profile.fullName')}</Label>
                  <Input
                    type="text"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    maxLength={120}
                    className="mt-1.5 rounded-xl"
                    placeholder={t('profile.fullNamePlaceholder')}
                  />
                </div>

                <div>
                  <Label className="input-label">{t('profile.email')}</Label>
                  <Input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="mt-1.5 rounded-xl"
                    placeholder={t('profile.emailPlaceholder')}
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3 pt-1">
                <Button
                  onClick={handleProfileSave}
                  disabled={profileLoading}
                  className="gap-2 rounded-xl"
                >
                  {profileLoading ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      {t('profile.saving')}
                    </>
                  ) : (
                    <>
                      <Save className="h-3.5 w-3.5" />
                      {t('profile.saveChanges')}
                    </>
                  )}
                </Button>

                {profileSuccess && (
                  <span className="flex items-center gap-1 text-sm text-emerald-600 dark:text-emerald-400">
                    <CheckCircle2 className="h-4 w-4" />
                    {t('profile.saved')}
                  </span>
                )}

                {profileError && (
                  <span className="flex items-center gap-1 text-sm text-red-600 dark:text-red-400">
                    <AlertCircle className="h-4 w-4" />
                    {profileError}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Change Password IDE Container */}
      <div className="rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 bg-slate-50/90 dark:bg-slate-900/90 border-b border-slate-200/80 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-red-400/80" />
              <span className="w-2.5 h-2.5 rounded-full bg-amber-400/80" />
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400/80" />
            </div>
            <Separator orientation="vertical" className="h-4" />
            <Lock className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />
            <h2 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
              {t('profile.changePassword')}
            </h2>
          </div>
          <span className="text-[11px] font-mono text-slate-400">
            credential_security.vault
          </span>
        </div>

        <div className="p-4 sm:p-6">
          <form onSubmit={handlePasswordChange} className="space-y-4">
            {/* Hidden username field for accessibility (WCAG 1.3.5) */}
            <input
              type="text"
              name="username"
              autoComplete="username"
              value={authUser?.username ?? ''}
              readOnly
              tabIndex={-1}
              style={{
                position: 'absolute',
                left: '-9999px',
                width: '1px',
                height: '1px',
              }}
              aria-hidden="true"
            />

            {passwordSuccess && (
              <Alert variant="success" className="rounded-xl">
                <CheckCircle2 className="h-4 w-4" />
                <AlertDescription>{passwordSuccess}</AlertDescription>
              </Alert>
            )}

            {passwordError && (
              <Alert variant="destructive" className="rounded-xl">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{passwordError}</AlertDescription>
              </Alert>
            )}

            {!hasPassword ? (
              <div className="rounded-xl bg-indigo-50/70 dark:bg-indigo-950/40 border border-indigo-200/80 dark:border-indigo-800/70 p-3.5 text-xs sm:text-sm text-indigo-900 dark:text-indigo-200 leading-relaxed">
                {lang === 'vi' ? (
                  <>
                    Tài khoản của bạn đăng nhập qua <strong>Google</strong> và chưa có mật khẩu riêng. Bạn có thể{' '}
                    <strong>thiết lập mật khẩu lần đầu trực tiếp bên dưới</strong> (không cần mật khẩu hiện tại) hoặc{' '}
                    <strong>nhận liên kết đặt mật khẩu qua email Google</strong> của bạn.
                  </>
                ) : (
                  <>
                    Your account was created via <strong>Google Sign-In</strong> and does not have a local password yet. You can{' '}
                    <strong>set your initial password directly below</strong> (no current password required) or{' '}
                    <strong>send a password setup link to your Google email</strong>.
                  </>
                )}
              </div>
            ) : (
              <div>
                <Label className="input-label">{t('profile.currentPassword')}</Label>
                <Input
                  type="password"
                  autoComplete="current-password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  required
                  className="mt-1.5 rounded-xl"
                  placeholder={t('profile.currentPasswordPlaceholder')}
                />
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label className="input-label">{t('profile.newPassword')}</Label>
                <Input
                  type="password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                  minLength={6}
                  maxLength={128}
                  className="mt-1.5 rounded-xl"
                  placeholder={t('profile.newPasswordPlaceholder')}
                />
              </div>

              <div>
                <Label className="input-label">{t('profile.confirmNewPassword')}</Label>
                <Input
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  className="mt-1.5 rounded-xl"
                  placeholder={t('profile.confirmNewPasswordPlaceholder')}
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3 pt-1">
              <Button
                type="submit"
                variant="secondary"
                disabled={passwordLoading}
                className="gap-2 rounded-xl"
              >
                {passwordLoading ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    {t('profile.updating')}
                  </>
                ) : (
                  <>
                    <Lock className="h-3.5 w-3.5" />
                    {hasPassword
                      ? t('profile.updatePassword')
                      : lang === 'vi'
                        ? 'Thiết lập mật khẩu'
                        : 'Set Password'}
                  </>
                )}
              </Button>

              {authUser?.email && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleSendPasswordSetupEmail}
                  disabled={emailLinkSending}
                  className="gap-2 rounded-xl text-xs sm:text-sm"
                  data-testid="send-password-setup-email-btn"
                >
                  {emailLinkSending ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      {lang === 'vi' ? 'Đang gửi email...' : 'Sending email...'}
                    </>
                  ) : (
                    <>
                      <Mail className="h-3.5 w-3.5" />
                      {lang === 'vi'
                        ? 'Gửi link đặt mật khẩu qua Email'
                        : 'Send password setup link to email'}
                    </>
                  )}
                </Button>
              )}
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
