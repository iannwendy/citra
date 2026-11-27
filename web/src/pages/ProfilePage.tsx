import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Save,
  Loader2,
  Lock,
  AlertCircle,
  CheckCircle2,
  ShieldCheck,
  UserCheck,
  Mail,
  Sparkles,
  LogOut,
  GraduationCap,
  User as UserIcon,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { AvatarUpload } from '@/components/AvatarUpload';
import { api, type Class } from '@/api/client';
import { validatePasswordClient } from '@/lib/utils';
import {
  formatLocalizedDate,
  formatUserError,
  resolveAcademicLang,
} from '@/lib/academicTaxonomy';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';

export function ProfilePage() {
  const { t, i18n } = useTranslation();
  const lang = resolveAcademicLang(i18n.resolvedLanguage || i18n.language);
  const { user: authUser, refreshUser } = useAuth();
  const toast = useToast();

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
  const [enrolledClasses, setEnrolledClasses] = useState<Class[]>([]);

  const canSetUsername = Boolean(authUser?.can_set_username);
  const isGoogleEmailLocked = Boolean(
    (authUser?.google_linked || authUser?.auth_provider?.includes('google')) &&
      authUser?.email,
  );
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

  useEffect(() => {
    if (!authUser || typeof api.listEnrolledClasses !== 'function') return;
    let cancelled = false;
    void api
      .listEnrolledClasses()
      .then((list) => {
        if (!cancelled && Array.isArray(list)) setEnrolledClasses(list);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [authUser]);

  const handleLeaveClass = async (cls: Class) => {
    try {
      await api.leaveClass(cls.id);
      setEnrolledClasses((prev) => prev.filter((c) => c.id !== cls.id));
      toast.success(
        lang === 'vi'
          ? `Đã rời khỏi lớp ${cls.name}`
          : `Left class ${cls.name}`,
      );
    } catch (err) {
      toast.error(
        formatUserError(
          err,
          lang,
          lang === 'vi'
            ? 'Không thể rời lớp học. Vui lòng thử lại.'
            : 'Failed to leave class. Please try again.',
        ),
      );
    }
  };

  const handleProfileSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileError('');
    setProfileSuccess(false);

    const trimmedUsername = username.trim();
    if (canSetUsername) {
      if (
        trimmedUsername.length < 3 ||
        trimmedUsername.length > 50 ||
        !/^[a-zA-Z0-9._-]+$/.test(trimmedUsername) ||
        /^[._-]|[._-]$/.test(trimmedUsername) ||
        trimmedUsername.includes('..')
      ) {
        setProfileError(
          lang === 'vi'
            ? 'Tên đăng nhập dài 3–50 ký tự, chỉ dùng chữ không dấu, số và . _ - (không đặt ký tự đặc biệt ở đầu/cuối).'
            : "Use 3–50 letters, numbers, dots, underscores, or hyphens — don't start or end with a symbol.",
        );
        return;
      }
    }

    const trimmedEmail = email.trim();
    if (
      !isGoogleEmailLocked &&
      trimmedEmail &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)
    ) {
      setProfileError(
        lang === 'vi'
          ? 'Địa chỉ email không đúng định dạng.'
          : 'Please enter a valid email address.',
      );
      return;
    }

    setProfileLoading(true);
    try {
      const updated = await api.updateMe({
        ...(canSetUsername ? { username: trimmedUsername } : {}),
        full_name: fullName || undefined,
        ...(!isGoogleEmailLocked ? { email: trimmedEmail || undefined } : {}),
      });
      await refreshUser();
      setUsername(updated.username ?? '');
      setFullName(updated.full_name ?? '');
      setEmail(updated.email ?? '');
      setProfileSuccess(true);
      toast.success(
        lang === 'vi' ? 'Đã lưu hồ sơ cá nhân' : 'Profile Updated',
        lang === 'vi'
          ? 'Thông tin tài khoản của bạn đã được cập nhật.'
          : 'Your account profile has been saved.',
      );
      setTimeout(() => setProfileSuccess(false), 3000);
    } catch (err) {
      const msg = formatUserError(err, lang, t('profile.failedToSave'));
      setProfileError(msg);
      toast.error(lang === 'vi' ? 'Lỗi cập nhật hồ sơ' : 'Update Failed', msg);
    } finally {
      setProfileLoading(false);
    }
  };

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError('');
    setPasswordSuccess('');

    if (hasPassword && !currentPassword.trim()) {
      setPasswordError(
        lang === 'vi'
          ? 'Vui lòng nhập mật khẩu hiện tại.'
          : 'Please enter your current password.',
      );
      return;
    }

    const pwCheck = validatePasswordClient(newPassword, lang);
    if (!pwCheck.valid) {
      setPasswordError(
        pwCheck.reason === 'too_short'
          ? t('profile.passwordMinLengthError')
          : pwCheck.error || t('profile.passwordMinLengthError'),
      );
      return;
    }
    if (!confirmPassword) {
      setPasswordError(
        lang === 'vi'
          ? 'Vui lòng nhập lại mật khẩu mới để xác nhận.'
          : 'Please confirm your new password.',
      );
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
            : 'Password set successfully! You can now sign in with either Google or Username + Password.',
      );
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setTimeout(() => setPasswordSuccess(''), 6000);
    } catch (err) {
      setPasswordError(
        formatUserError(err, lang, t('profile.passwordChangeFailed')),
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
        hasPassword
          ? lang === 'vi'
            ? `Đã gửi liên kết đặt lại mật khẩu tới ${authUser?.email}! Vui lòng kiểm tra hộp thư của bạn.`
            : `Password reset link sent to ${authUser?.email}! Please check your email inbox.`
          : lang === 'vi'
            ? `Đã gửi liên kết đặt mật khẩu tới ${authUser?.email}! Vui lòng kiểm tra hộp thư của bạn.`
            : `Password setup link sent to ${authUser?.email}! Please check your email inbox.`,
      );
    } catch (err) {
      setPasswordError(
        formatUserError(
          err,
          lang,
          lang === 'vi'
            ? 'Không thể gửi email đặt mật khẩu lúc này. Vui lòng thử lại sau.'
            : 'Could not send password email right now. Please try again later.',
        ),
      );
    } finally {
      setEmailLinkSending(false);
    }
  };

  return (
    <div className="citra-cq-page-narrow space-y-6 w-full max-w-4xl mx-auto pb-10 transition-[max-width] duration-300">
      {/* Header Card */}
      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 p-5 sm:p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-indigo-50 dark:bg-indigo-950/80 border border-indigo-200/70 dark:border-indigo-800/70 flex items-center justify-center shrink-0">
                <UserCheck className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="font-solva-serif font-normal text-2xl sm:text-3xl tracking-tight text-slate-900 dark:text-slate-100">
                    {t('profile.title')}
                  </h1>
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/70 border border-emerald-200/70 dark:border-emerald-800/70 text-xs font-mono text-emerald-700 dark:text-emerald-300">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                    @{authUser?.username ?? 'user'}
                  </span>
                </div>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
                  {t('profile.subtitle')}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Account Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 shadow-sm">
          <p className="text-slate-500 dark:text-slate-400 text-xs mb-1">
            {t('profile.role')}
          </p>
          <p
            data-testid="profile-role-value"
            className="font-display font-semibold text-lg text-slate-900 dark:text-slate-100"
          >
            {authUser?.role
              ? authUser.role === 'admin'
                ? t('roleBadge.admin')
                : authUser.role === 'teacher'
                  ? t('roleBadge.teacher')
                  : t('roleBadge.user')
              : '—'}
          </p>
        </Card>

        <Card className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 shadow-sm">
          <p className="text-slate-500 dark:text-slate-400 text-xs mb-1">
            {t('profile.memberSince')}
          </p>
          <p className="font-mono font-semibold text-sm text-slate-900 dark:text-slate-100">
            {formatLocalizedDate(authUser?.created_at, lang)}
          </p>
        </Card>

        <Card className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 shadow-sm">
          <p className="text-slate-500 dark:text-slate-400 text-xs mb-1">
            {t('profile.lastLogin')}
          </p>
          <p className="font-mono font-semibold text-sm text-slate-900 dark:text-slate-100">
            {formatLocalizedDate(authUser?.last_login_at, lang)}
          </p>
        </Card>
      </div>

      {/* Avatar + Basic Info Card */}
      <div className="rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-4 sm:px-5 py-3.5 bg-slate-50/90 dark:bg-slate-900/90 border-b border-slate-200/80 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <UserIcon className="h-4 w-4 text-indigo-600 dark:text-indigo-400 shrink-0" />
            <h2 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
              {lang === 'vi' ? 'Thông tin cá nhân' : 'Personal Information'}
            </h2>
          </div>
        </div>

        <div className="p-4 sm:p-6">
          <div className="flex flex-col sm:flex-row sm:items-start gap-5 sm:gap-6">
            {/* Avatar upload */}
            <div className="flex flex-col items-center gap-3 shrink-0 sm:w-56 p-4 rounded-xl bg-slate-50/70 dark:bg-slate-800/40 border border-slate-200/70 dark:border-slate-800">
              <AvatarUpload
                currentAvatarUrl={authUser?.avatar_url ?? null}
                onSuccess={() => {
                  void refreshUser();
                }}
                size="lg"
              />
              <p className="text-[11px] font-mono text-slate-500 dark:text-slate-400 text-center max-w-[9rem]">
                {t('profile.avatarTypes')} <br />
                {t('profile.avatarMax')}
              </p>
            </div>

            {/* Profile form */}
            <form
              onSubmit={handleProfileSave}
              noValidate
              className="flex-1 space-y-4 min-w-0"
            >
              <div>
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <Label
                    htmlFor="profile-username-field"
                    className="input-label"
                  >
                    {t('profile.username')}
                  </Label>
                  {canSetUsername && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-indigo-50 dark:bg-indigo-950/80 border border-indigo-200/70 dark:border-indigo-800/70 text-[11px] font-medium text-indigo-700 dark:text-indigo-300">
                      <Sparkles className="h-3 w-3" />
                      {lang === 'vi'
                        ? 'Tài khoản Google · Đặt tên đăng nhập lần đầu'
                        : 'Google Account · First-time username setup'}
                    </span>
                  )}
                </div>
                {canSetUsername ? (
                  <>
                    <div className="relative mt-1.5">
                      <span
                        className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 font-mono text-sm select-none"
                        aria-hidden="true"
                      >
                        @
                      </span>
                      <Input
                        id="profile-username-field"
                        type="text"
                        aria-label={t('profile.username')}
                        value={username}
                        onChange={(e) => {
                          setUsername(e.target.value);
                          if (profileError) setProfileError('');
                        }}
                        maxLength={50}
                        className="pl-8 rounded-xl font-mono"
                        placeholder={lang === 'vi' ? 'vd_minh_nguyen' : 'e.g. alex_chen'}
                        data-testid="profile-username-input"
                      />
                    </div>
                    <p className="text-xs text-indigo-600 dark:text-indigo-400 mt-1">
                      {lang === 'vi'
                        ? 'Bạn có thể đặt tên đăng nhập 1 lần cho tài khoản Google của mình, sau đó nhấn Lưu thay đổi.'
                        : 'You can customize your username once for your Google account, then click Save Changes.'}
                    </p>
                  </>
                ) : (
                  <>
                    <Input
                      id="profile-username-field"
                      type="text"
                      aria-label={t('profile.username')}
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
                  <Label
                    htmlFor="profile-fullname-field"
                    className="input-label"
                  >
                    {t('profile.fullName')}
                  </Label>
                  <Input
                    id="profile-fullname-field"
                    type="text"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    maxLength={120}
                    className="mt-1.5 rounded-xl"
                    placeholder={t('profile.fullNamePlaceholder')}
                  />
                </div>

                <div>
                  <Label htmlFor="profile-email-field" className="input-label">
                    {t('profile.email')}
                  </Label>
                  <Input
                    id="profile-email-field"
                    type="email"
                    data-testid="profile-email-input"
                    value={email}
                    readOnly={isGoogleEmailLocked}
                    disabled={isGoogleEmailLocked}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      if (profileError) setProfileError('');
                    }}
                    className={`mt-1.5 rounded-xl ${
                      isGoogleEmailLocked ? 'opacity-65 cursor-not-allowed' : ''
                    }`}
                    placeholder={t('profile.emailPlaceholder')}
                  />
                  {isGoogleEmailLocked && (
                    <p className="text-xs text-slate-400 mt-1">
                      {lang === 'vi'
                        ? 'Email được đồng bộ từ tài khoản Google của bạn.'
                        : 'Synced with your Google account.'}
                    </p>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3 pt-1">
                <Button
                  type="submit"
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
                  <span
                    role="alert"
                    className="flex items-center gap-1 text-sm text-red-600 dark:text-red-400"
                  >
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    {profileError}
                  </span>
                )}
              </div>
            </form>
          </div>
        </div>
      </div>

      {/* Password & Security Card */}
      <div className="rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 sm:px-5 py-3.5 bg-slate-50/90 dark:bg-slate-900/90 border-b border-slate-200/80 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <Lock className="h-4 w-4 text-indigo-600 dark:text-indigo-400 shrink-0" />
            <h2 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
              {hasPassword
                ? t('profile.changePassword')
                : lang === 'vi'
                  ? 'Tạo mật khẩu đăng nhập'
                  : 'Create a Password'}
            </h2>
          </div>
        </div>

        <div className="p-4 sm:p-6">
          <form
            onSubmit={handlePasswordChange}
            noValidate
            className="space-y-4"
          >
            {/* Hidden username field for password-manager accessibility (WCAG 1.3.5) */}
            <input
              type="text"
              name="username"
              autoComplete="username"
              aria-label={t('profile.username')}
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
                    Tài khoản của bạn đăng nhập qua <strong>Google</strong> và
                    chưa có mật khẩu riêng. Bạn có thể{' '}
                    <strong>
                      thiết lập mật khẩu lần đầu trực tiếp bên dưới
                    </strong>{' '}
                    (không cần mật khẩu hiện tại) hoặc{' '}
                    <strong>nhận liên kết đặt mật khẩu qua email Google</strong>{' '}
                    của bạn.
                  </>
                ) : (
                  <>
                    Your account was created via <strong>Google Sign-In</strong>{' '}
                    and does not have a CITRA password yet. You can{' '}
                    <strong>set your password directly below</strong>{' '}
                    (no current password required) or{' '}
                    <strong>
                      send a password setup link to your Google email
                    </strong>
                    .
                  </>
                )}
              </div>
            ) : (
              <div>
                <Label
                  htmlFor="profile-current-password"
                  className="input-label"
                >
                  {t('profile.currentPassword')}
                </Label>
                <Input
                  id="profile-current-password"
                  type="password"
                  autoComplete="current-password"
                  value={currentPassword}
                  onChange={(e) => {
                    setCurrentPassword(e.target.value);
                    if (passwordError) setPasswordError('');
                  }}
                  className="mt-1.5 rounded-xl"
                  placeholder={t('profile.currentPasswordPlaceholder')}
                />
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="profile-new-password" className="input-label">
                  {t('profile.newPassword')}
                </Label>
                <Input
                  id="profile-new-password"
                  type="password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => {
                    setNewPassword(e.target.value);
                    if (passwordError) setPasswordError('');
                  }}
                  maxLength={128}
                  className="mt-1.5 rounded-xl"
                  placeholder={t('profile.newPasswordPlaceholder')}
                />
              </div>

              <div>
                <Label
                  htmlFor="profile-confirm-password"
                  className="input-label"
                >
                  {t('profile.confirmNewPassword')}
                </Label>
                <Input
                  id="profile-confirm-password"
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => {
                    setConfirmPassword(e.target.value);
                    if (passwordError) setPasswordError('');
                  }}
                  maxLength={128}
                  className="mt-1.5 rounded-xl"
                  placeholder={t('profile.confirmNewPasswordPlaceholder')}
                />
              </div>
            </div>

            <div className="space-y-2 pt-1">
              <div className="flex flex-wrap items-center gap-3">
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
                        {hasPassword
                          ? lang === 'vi'
                            ? 'Gửi liên kết đặt lại mật khẩu qua email'
                            : 'Send password reset link via email'
                          : lang === 'vi'
                            ? 'Gửi liên kết đặt mật khẩu qua email'
                            : 'Send password setup link via email'}
                      </>
                    )}
                  </Button>
                )}
              </div>

              {authUser?.email && (
                <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                  {hasPassword
                    ? lang === 'vi'
                      ? 'Quên mật khẩu hiện tại? Nhấn nút gửi liên kết qua email để tạo mật khẩu mới mà không cần nhập mật khẩu cũ.'
                      : 'Forgot your current password? Send a reset link to your email to create a new password without entering your current one.'
                    : lang === 'vi'
                      ? 'Liên kết qua email cho phép bạn tạo mật khẩu đăng nhập trực tiếp bên cạnh đăng nhập bằng Google.'
                      : 'The email link lets you create a CITRA password so you can sign in with either Google or a password.'}
                </p>
              )}
            </div>
          </form>
        </div>
      </div>

      {enrolledClasses.length > 0 && (
        <div
          data-testid="profile-enrolled-classes"
          className="rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm overflow-hidden"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 sm:px-5 py-3.5 bg-slate-50/90 dark:bg-slate-900/90 border-b border-slate-200/80 dark:border-slate-800">
            <div className="flex items-center gap-2.5">
              <GraduationCap className="h-4 w-4 text-indigo-600 dark:text-indigo-400 shrink-0" />
              <h2 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
                {lang === 'vi' ? 'Lớp học đã tham gia' : 'Enrolled Classes'}
              </h2>
            </div>
            <span className="text-xs font-mono text-slate-500 dark:text-slate-400">
              {enrolledClasses.length}
            </span>
          </div>
          <div className="p-4 sm:p-6 space-y-2.5">
            {enrolledClasses.map((cls) => (
              <div
                key={cls.id}
                className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-xl bg-slate-50/70 dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-800"
              >
                <div>
                  <p className="text-sm font-semibold text-slate-900 dark:text-white">
                    {cls.name}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {lang === 'vi' ? 'Giảng viên:' : 'Instructor:'}{' '}
                    {cls.teacher_username}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  data-testid={`profile-leave-class-${cls.id}`}
                  onClick={() => void handleLeaveClass(cls)}
                  className="gap-1.5 rounded-xl text-rose-600 border-rose-200 hover:bg-rose-50 dark:border-rose-800 dark:hover:bg-rose-950/50 text-xs"
                >
                  <LogOut className="h-3.5 w-3.5" />
                  {lang === 'vi' ? 'Rời lớp' : 'Leave Class'}
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Privacy & Account Management Card (DLCN-03) */}
      <div className="rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 sm:px-5 py-3.5 bg-slate-50/90 dark:bg-slate-900/90 border-b border-slate-200/80 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <ShieldCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
            <h2 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
              {lang === 'vi'
                ? 'Quyền riêng tư & Dữ liệu cá nhân'
                : 'Privacy & Your Data'}
            </h2>
          </div>
        </div>

        <div className="p-4 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 leading-relaxed max-w-xl">
            {lang === 'vi'
              ? 'Xem cách CITRA bảo vệ bài viết của bạn, hoặc quản lý và xóa tài khoản vĩnh viễn trong trang Cài đặt.'
              : 'Review how CITRA protects your documents, or manage and permanently delete your account in Settings.'}
          </p>
          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <Link
              to="/privacy"
              className="inline-flex items-center px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-950/60 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              {t('privacyCompliance.policyLinkLabel')}
            </Link>
            <Link
              to="/settings#delete-account-section"
              data-testid="profile-manage-delete-account-link"
              className="inline-flex items-center px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:border-red-300 hover:text-red-700 dark:hover:border-red-800 dark:hover:text-red-300 transition-colors"
            >
              {lang === 'vi'
                ? 'Quản lý & xóa tài khoản trong Cài đặt →'
                : 'Manage or delete account in Settings →'}
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
