import { useState, useEffect, useRef } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { validatePasswordClient } from '@/lib/utils';
import { formatUserError, resolveAcademicLang } from '@/lib/academicTaxonomy';
import {
  AuthSplitShell,
  PasswordStrengthIndicator,
} from '@/components/AuthSplitShell';
import {
  Eye,
  EyeOff,
  KeyRound,
  ShieldCheck,
  AlertCircle,
  CheckCircle2,
  ArrowRight,
  ArrowLeft,
  Loader2,
  UserCheck,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { IconSwap } from '@/components/ui/transitions';

const getSolvaInputBorderClasses = (invalid: boolean) =>
  invalid
    ? 'is-error border-red-600 dark:border-red-400 focus-visible:ring-2 focus-visible:ring-red-600/20 dark:focus-visible:ring-red-400/25 focus-visible:border-red-600 dark:focus-visible:border-red-400 placeholder:text-[#78736A] dark:placeholder:text-[#969084]'
    : 'border-[#E7E3D9] dark:border-[#332F26] focus-visible:ring-2 focus-visible:ring-[#1C1A15]/15 dark:focus-visible:ring-[#FBFAF6]/20 focus-visible:border-[#1C1A15] dark:focus-visible:border-[#FBFAF6] placeholder:text-[#78736A] dark:placeholder:text-[#969084]';

export function ResetPasswordPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';
  const lang = resolveAcademicLang(i18n.language);

  const [tokenState, setTokenState] = useState<
    'verifying' | 'valid' | 'invalid' | 'completed'
  >(token ? 'verifying' : 'invalid');
  const [targetUser, setTargetUser] = useState<{
    username?: string | null;
    email?: string | null;
  }>({});
  const [invalidMessage, setInvalidMessage] = useState('');

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [redirectSeconds, setRedirectSeconds] = useState(4);

  const verifiedTokenRef = useRef<string | null>(null);

  useEffect(() => {
    if (!token) {
      setTokenState('invalid');
      setInvalidMessage(
        lang === 'vi'
          ? 'Thiếu mã xác thực trong liên kết đặt lại mật khẩu. Vui lòng yêu cầu gửi một liên kết mới.'
          : 'The password reset link is missing or incomplete. Please request a fresh reset link.',
      );
      return;
    }
    if (verifiedTokenRef.current === token) return;
    verifiedTokenRef.current = token;

    setTokenState('verifying');
    api
      .verifyResetToken(token)
      .then((res) => {
        if (res.valid) {
          setTargetUser({ username: res.username, email: res.email });
          setTokenState('valid');
        } else {
          setTokenState('invalid');
          setInvalidMessage(
            formatUserError(
              res.message || '',
              lang,
              lang === 'vi'
                ? 'Liên kết đặt lại mật khẩu không hợp lệ hoặc đã hết hạn.'
                : 'This password reset link is invalid or has expired.',
            ),
          );
        }
      })
      .catch((err) => {
        setTokenState('invalid');
        setInvalidMessage(
          formatUserError(
            err,
            lang,
            lang === 'vi'
              ? 'Liên kết đặt lại mật khẩu không hợp lệ hoặc đã hết hạn.'
              : 'This password reset link is invalid or has expired.',
          ),
        );
      });
  }, [token, lang]);

  useEffect(() => {
    if (tokenState !== 'completed') return;
    if (redirectSeconds <= 0) {
      navigate('/login?reset=1');
      return;
    }
    const timer = window.setTimeout(() => {
      setRedirectSeconds((prev) => prev - 1);
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [tokenState, redirectSeconds, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const pwCheck = validatePasswordClient(newPassword, lang);
    if (!pwCheck.valid) {
      setError(
        pwCheck.reason === 'too_short'
          ? t('auth.registerPasswordTooShort')
          : t('auth.registerPasswordTooLong'),
      );
      return;
    }

    if (newPassword !== confirmPassword) {
      setError(t('auth.registerPasswordMismatch'));
      return;
    }

    setSubmitting(true);
    try {
      await api.resetPassword({
        token,
        new_password: newPassword,
        lang,
      });
      setTokenState('completed');
    } catch (err) {
      setError(
        formatUserError(
          err,
          lang,
          lang === 'vi'
            ? 'Không thể cập nhật mật khẩu. Vui lòng thử lại.'
            : 'Failed to reset password. Please try again.',
        ),
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthSplitShell>
      <Card
        style={{
          backgroundColor: 'var(--solva-card-elevated)',
          borderColor: 'var(--solva-border)',
        }}
        className="solva-glass-ring p-0 overflow-hidden border rounded-[18px]"
      >
        <div
          style={{
            background:
              'linear-gradient(90deg, var(--solva-ink) 0%, #10B981 55%, var(--solva-border) 100%)',
          }}
          className="h-[3px] w-full opacity-85"
        />

        <CardHeader className="space-y-2 pb-4 pt-5 sm:pt-6 px-5 sm:px-7">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div
              style={{
                backgroundColor: 'var(--solva-surface)',
                borderColor: 'var(--solva-border)',
                color: 'var(--solva-ink)',
              }}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[6px] border font-mono text-[10px] uppercase tracking-wider font-semibold whitespace-nowrap"
            >
              <ShieldCheck className="h-3 w-3 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <span>{t('auth.resetBadge')}</span>
            </div>
          </div>

          <CardTitle
            style={{ color: 'var(--solva-ink)' }}
            className={`font-solva-serif font-light text-[26px] sm:text-[30px] pt-0.5 ${
              lang === 'vi'
                ? 'leading-[1.15] tracking-[-0.03em]'
                : 'leading-[1.08] tracking-[-0.04em]'
            }`}
          >
            {(tokenState === 'invalid'
              ? t('auth.invalidResetLinkTitle')
              : tokenState === 'completed'
                ? t('auth.resetSuccessTitle')
                : t('auth.resetTitle')
            ).normalize('NFC')}
          </CardTitle>
          <CardDescription
            style={{ color: 'var(--solva-muted)' }}
            className="font-solva-sans text-[14px] leading-relaxed"
          >
            {tokenState === 'invalid'
              ? lang === 'vi'
                ? 'Liên kết đặt lại mật khẩu có hiệu lực trong 30 phút và chỉ sử dụng một lần.'
                : 'Password reset links are valid for 30 minutes and can only be used once.'
              : tokenState === 'completed'
                ? t('auth.resetSuccessSubtitle')
                : t('auth.resetSubtitle')}
          </CardDescription>
        </CardHeader>

        <CardContent className="px-5 sm:px-7 pb-5 sm:pb-6">
          {tokenState === 'verifying' && (
            <div
              style={{ color: 'var(--solva-muted)' }}
              className="py-8 flex flex-col items-center justify-center gap-3"
            >
              <Loader2 className="h-8 w-8 text-emerald-600 dark:text-emerald-400 animate-spin" />
              <span className="text-xs font-mono uppercase tracking-wider">
                {t('auth.verifyingResetLink')}
              </span>
            </div>
          )}

          {tokenState === 'invalid' && (
            <div className="space-y-4">
              {invalidMessage && (
                <Alert
                  variant="destructive"
                  className="px-3.5 py-2.5 rounded-[12px] flex items-start gap-2.5 [&>svg]:static [&>svg]:mt-0.5 [&>svg]:shrink-0 [&>svg~*]:pl-0 [&>svg+div]:translate-y-0"
                >
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription className="text-xs sm:text-sm font-medium">
                    {invalidMessage}
                  </AlertDescription>
                </Alert>
              )}

              <Link
                to="/forgot-password"
                style={{
                  backgroundColor: 'var(--solva-btn-bg)',
                  color: 'var(--solva-btn-fg)',
                }}
                className="w-full h-[46px] px-5 rounded-[11px] font-solva-sans text-[14px] font-medium inline-flex items-center justify-center gap-2 shadow-sm hover:opacity-90 transition-opacity"
              >
                <span>{t('auth.requestNewResetLink')}</span>
                <ArrowRight className="h-4 w-4" />
              </Link>

              <div
                style={{ borderColor: 'var(--solva-border)' }}
                className="pt-3 border-t text-center"
              >
                <Link
                  to="/login"
                  style={{ color: 'var(--solva-ink)' }}
                  className="inline-flex items-center gap-1.5 font-solva-sans text-xs sm:text-sm font-semibold underline underline-offset-4 decoration-[#1C1A15]/35 dark:decoration-[#FBFAF6]/35 hover:decoration-current transition-colors"
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                  <span>{t('auth.backToSignIn')}</span>
                </Link>
              </div>
            </div>
          )}

          {tokenState === 'valid' && (
            <form onSubmit={handleSubmit} noValidate className="space-y-4">
              {/* Target Account Pill */}
              {(targetUser.username || targetUser.email) && (
                <div
                  style={{
                    backgroundColor: 'var(--solva-surface)',
                    borderColor: 'var(--solva-border)',
                  }}
                  className="p-3 rounded-[12px] border flex items-center gap-3"
                >
                  <div
                    style={{
                      backgroundColor: 'var(--solva-btn-bg)',
                      color: 'var(--solva-btn-fg)',
                    }}
                    className="p-2 rounded-[8px] shrink-0"
                  >
                    <UserCheck className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    {targetUser.username && (
                      <p
                        style={{ color: 'var(--solva-ink)' }}
                        className="text-xs font-mono font-bold"
                      >
                        @{targetUser.username}
                      </p>
                    )}
                    {targetUser.email && (
                      <p
                        style={{ color: 'var(--solva-muted)' }}
                        className="text-xs break-all"
                      >
                        {targetUser.email}
                      </p>
                    )}
                  </div>
                </div>
              )}

              {error && (
                <Alert
                  id="reset-form-error"
                  variant="destructive"
                  className="px-3.5 py-2.5 rounded-[12px] flex items-start gap-2.5 [&>svg]:static [&>svg]:mt-0.5 [&>svg]:shrink-0 [&>svg~*]:pl-0 [&>svg+div]:translate-y-0"
                >
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription className="text-xs sm:text-sm font-medium">
                    {error}
                  </AlertDescription>
                </Alert>
              )}

              <div className="space-y-1.5">
                <Label
                  htmlFor="new_password"
                  style={{ color: 'var(--solva-ink)' }}
                  className="font-mono text-[11px] font-semibold uppercase tracking-wider"
                >
                  {t('auth.newPassword')}
                </Label>
                <div className="relative">
                  <div
                    style={{ color: 'var(--solva-muted)' }}
                    className="pointer-events-none z-10 absolute left-3.5 top-1/2 -translate-y-1/2"
                  >
                    <KeyRound className="h-4 w-4" />
                  </div>
                  <Input
                    id="new_password"
                    type={showPassword ? 'text' : 'password'}
                    value={newPassword}
                    aria-invalid={Boolean(error)}
                    aria-describedby={error ? 'reset-form-error' : undefined}
                    onChange={(e) => {
                      setNewPassword(e.target.value);
                      if (error) setError('');
                    }}
                    required
                    minLength={6}
                    maxLength={128}
                    autoComplete="new-password"
                    style={{
                      backgroundColor: 'var(--solva-surface)',
                      color: 'var(--solva-ink)',
                    }}
                    className={`t-input ${getSolvaInputBorderClasses(Boolean(error))} h-11 pl-10 pr-11 rounded-[11px] font-solva-sans text-[14px]`}
                    placeholder={t('auth.newPasswordPlaceholder')}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={
                      lang === 'vi'
                        ? showPassword
                          ? 'Ẩn mật khẩu mới'
                          : 'Hiện mật khẩu mới'
                        : showPassword
                          ? 'Hide new password'
                          : 'Show new password'
                    }
                    title={
                      lang === 'vi'
                        ? showPassword
                          ? 'Ẩn mật khẩu mới'
                          : 'Hiện mật khẩu mới'
                        : showPassword
                          ? 'Hide new password'
                          : 'Show new password'
                    }
                    style={{ color: 'var(--solva-muted)' }}
                    className="z-10 absolute right-2.5 top-1/2 -translate-y-1/2 p-1.5 rounded-[8px] hover:bg-[#ECE9E0] dark:hover:bg-[#29261F] hover:text-[#1C1A15] dark:hover:text-[#FBFAF6] transition-colors cursor-pointer"
                  >
                    <IconSwap
                      active={showPassword}
                      iconA={<Eye className="h-4 w-4" />}
                      iconB={<EyeOff className="h-4 w-4" />}
                    />
                  </button>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label
                  htmlFor="confirm_new_password"
                  style={{ color: 'var(--solva-ink)' }}
                  className="font-mono text-[11px] font-semibold uppercase tracking-wider"
                >
                  {t('auth.confirmNewPassword')}
                </Label>
                <div className="relative">
                  <div
                    style={{ color: 'var(--solva-muted)' }}
                    className="pointer-events-none z-10 absolute left-3.5 top-1/2 -translate-y-1/2"
                  >
                    <KeyRound className="h-4 w-4" />
                  </div>
                  <Input
                    id="confirm_new_password"
                    type={showConfirmPassword ? 'text' : 'password'}
                    value={confirmPassword}
                    aria-invalid={Boolean(error)}
                    aria-describedby={error ? 'reset-form-error' : undefined}
                    onChange={(e) => {
                      setConfirmPassword(e.target.value);
                      if (error) setError('');
                    }}
                    required
                    minLength={6}
                    maxLength={128}
                    autoComplete="new-password"
                    style={{
                      backgroundColor: 'var(--solva-surface)',
                      color: 'var(--solva-ink)',
                    }}
                    className={`t-input ${getSolvaInputBorderClasses(Boolean(error))} h-11 pl-10 pr-11 rounded-[11px] font-solva-sans text-[14px]`}
                    placeholder={t('auth.confirmNewPasswordPlaceholder')}
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    aria-label={
                      lang === 'vi'
                        ? showConfirmPassword
                          ? 'Ẩn mật khẩu xác nhận'
                          : 'Hiện mật khẩu xác nhận'
                        : showConfirmPassword
                          ? 'Hide confirm password'
                          : 'Show confirm password'
                    }
                    title={
                      lang === 'vi'
                        ? showConfirmPassword
                          ? 'Ẩn mật khẩu xác nhận'
                          : 'Hiện mật khẩu xác nhận'
                        : showConfirmPassword
                          ? 'Hide confirm password'
                          : 'Show confirm password'
                    }
                    style={{ color: 'var(--solva-muted)' }}
                    className="z-10 absolute right-2.5 top-1/2 -translate-y-1/2 p-1.5 rounded-[8px] hover:bg-[#ECE9E0] dark:hover:bg-[#29261F] hover:text-[#1C1A15] dark:hover:text-[#FBFAF6] transition-colors cursor-pointer"
                  >
                    <IconSwap
                      active={showConfirmPassword}
                      iconA={<Eye className="h-4 w-4" />}
                      iconB={<EyeOff className="h-4 w-4" />}
                    />
                  </button>
                </div>
              </div>

              <PasswordStrengthIndicator
                password={newPassword}
                confirmPassword={confirmPassword}
              />

              <button
                type="submit"
                disabled={submitting}
                style={{
                  backgroundColor: 'var(--solva-btn-bg)',
                  color: 'var(--solva-btn-fg)',
                }}
                className="group relative w-full h-[46px] px-5 rounded-[11px] font-solva-sans text-[14px] font-medium flex items-center justify-center gap-2 shadow-sm hover:shadow-md transition-all duration-200 active:scale-[0.985] disabled:opacity-55 disabled:pointer-events-none cursor-pointer select-none"
              >
                {submitting ? (
                  <>
                    <div className="h-4 w-4 border-2 border-current/30 border-t-current rounded-full animate-spin" />
                    <span>{t('auth.resettingPassword')}</span>
                  </>
                ) : (
                  <>
                    <span>{t('auth.resetPasswordBtn')}</span>
                    <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
                  </>
                )}
              </button>
            </form>
          )}

          {tokenState === 'completed' && (
            <div className="space-y-4">
              <div className="p-4 rounded-[12px] bg-emerald-50/90 dark:bg-emerald-950/40 border border-emerald-200/80 dark:border-emerald-800/70 flex items-center gap-3">
                <div className="p-2 rounded-[9px] bg-emerald-600 text-white shrink-0">
                  <CheckCircle2 className="h-5 w-5" />
                </div>
                <div className="text-xs sm:text-sm font-medium text-emerald-900 dark:text-emerald-200">
                  {t('auth.resetSuccessSubtitle')}
                </div>
              </div>

              <p
                style={{ color: 'var(--solva-muted)' }}
                className="text-xs text-center font-mono"
              >
                {t('auth.autoRedirectingIn', { seconds: redirectSeconds })}
              </p>

              <Link
                to="/login?reset=1"
                style={{
                  backgroundColor: 'var(--solva-btn-bg)',
                  color: 'var(--solva-btn-fg)',
                }}
                className="w-full h-[46px] px-5 rounded-[11px] font-solva-sans text-[14px] font-medium inline-flex items-center justify-center gap-2 shadow-sm hover:opacity-90 transition-opacity"
              >
                <span>{t('auth.continueToSignIn')}</span>
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          )}
        </CardContent>
      </Card>
    </AuthSplitShell>
  );
}
