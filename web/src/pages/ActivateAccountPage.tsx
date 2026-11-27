import { useState, useEffect, useRef } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { formatUserError, resolveAcademicLang } from '@/lib/academicTaxonomy';
import { AuthSplitShell } from '@/components/AuthSplitShell';
import {
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  ArrowLeft,
  Mail,
  ShieldCheck,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';

const getSolvaInputBorderClasses = (invalid: boolean) =>
  invalid
    ? 'is-error border-red-600 dark:border-red-400 focus-visible:ring-2 focus-visible:ring-red-600/20 dark:focus-visible:ring-red-400/25 focus-visible:border-red-600 dark:focus-visible:border-red-400 placeholder:text-[#78736A] dark:placeholder:text-[#969084]'
    : 'border-[#E7E3D9] dark:border-[#332F26] focus-visible:ring-2 focus-visible:ring-[#1C1A15]/15 dark:focus-visible:ring-[#FBFAF6]/20 focus-visible:border-[#1C1A15] dark:focus-visible:border-[#FBFAF6] placeholder:text-[#78736A] dark:placeholder:text-[#969084]';

export function ActivateAccountPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';
  const lang = resolveAcademicLang(i18n.language);

  const [status, setStatus] = useState<'loading' | 'success' | 'error'>(
    token ? 'loading' : 'error',
  );
  const [accountInfo, setAccountInfo] = useState<{
    username: string;
    email: string;
  } | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [redirectSeconds, setRedirectSeconds] = useState(5);

  // Resend form state on error
  const [identifier, setIdentifier] = useState('');
  const [resending, setResending] = useState(false);
  const [resendSuccess, setResendSuccess] = useState('');

  const requestedTokenRef = useRef<string | null>(null);

  useEffect(() => {
    if (!token) {
      setStatus('error');
      setErrorMessage(
        lang === 'vi'
          ? 'Thiếu mã kích hoạt trong đường dẫn. Vui lòng nhập email hoặc tên đăng nhập bên dưới để nhận liên kết mới.'
          : 'The activation link is missing or incomplete. Enter your email or username below to receive a fresh link.',
      );
      return;
    }
    if (requestedTokenRef.current === token) return;
    requestedTokenRef.current = token;

    setStatus('loading');
    api
      .activateAccount(token)
      .then((res) => {
        setAccountInfo({ username: res.username, email: res.email });
        setStatus('success');
      })
      .catch((err) => {
        setStatus('error');
        setErrorMessage(
          formatUserError(
            err,
            lang,
            lang === 'vi'
              ? 'Liên kết kích hoạt không hợp lệ hoặc đã hết hạn.'
              : 'This activation link is invalid or has expired.',
          ),
        );
      });
  }, [token, lang]);

  useEffect(() => {
    if (status !== 'success') return;
    if (redirectSeconds <= 0) {
      navigate('/login?activated=1');
      return;
    }
    const timer = window.setTimeout(() => {
      setRedirectSeconds((prev) => prev - 1);
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [status, redirectSeconds, navigate]);

  const handleResend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!identifier.trim() || resending) return;
    setResending(true);
    setResendSuccess('');
    try {
      await api.resendActivation(identifier.trim(), lang);
      setResendSuccess(t('auth.activationResentSuccess'));
      setErrorMessage('');
    } catch (err) {
      setErrorMessage(
        formatUserError(
          err,
          lang,
          lang === 'vi'
            ? 'Không thể gửi lại email kích hoạt. Vui lòng thử lại sau.'
            : 'Failed to send a new activation link. Please try again.',
        ),
      );
    } finally {
      setResending(false);
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
              <span>{t('auth.activateBadge')}</span>
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
            {(status === 'loading'
              ? t('auth.activatingTitle')
              : status === 'success'
                ? t('auth.activateSuccessTitle')
                : t('auth.activateFailedTitle')
            ).normalize('NFC')}
          </CardTitle>
          <CardDescription
            style={{ color: 'var(--solva-muted)' }}
            className="font-solva-sans text-[14px] leading-relaxed"
          >
            {status === 'loading'
              ? t('auth.activatingSubtitle')
              : status === 'success'
                ? t('auth.activateSuccessSubtitle')
                : lang === 'vi'
                  ? 'Liên kết kích hoạt có hiệu lực trong 24 giờ và chỉ sử dụng một lần.'
                  : 'Activation links are valid for 24 hours and can only be used once.'}
          </CardDescription>
        </CardHeader>

        <CardContent className="px-5 sm:px-7 pb-5 sm:pb-6 space-y-4">
          {status === 'loading' && (
            <div
              style={{ color: 'var(--solva-muted)' }}
              className="py-8 flex flex-col items-center justify-center gap-3"
            >
              <Loader2 className="h-8 w-8 text-emerald-600 dark:text-emerald-400 animate-spin" />
              <span className="text-xs font-mono uppercase tracking-wider">
                {lang === 'vi'
                  ? 'Đang xác minh mã kích hoạt...'
                  : 'Validating activation token...'}
              </span>
            </div>
          )}

          {status === 'success' && (
            <>
              <div className="p-4 rounded-[12px] bg-emerald-50/90 dark:bg-emerald-950/40 border border-emerald-200/80 dark:border-emerald-800/70 flex items-center gap-3.5">
                <div className="p-2.5 rounded-[10px] bg-emerald-600 text-white shrink-0">
                  <CheckCircle2 className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-mono font-semibold text-emerald-700 dark:text-emerald-300">
                    @{accountInfo?.username}
                  </p>
                  <p
                    style={{ color: 'var(--solva-ink)' }}
                    className="text-sm font-bold break-all"
                  >
                    {accountInfo?.email}
                  </p>
                </div>
              </div>

              <p
                style={{ color: 'var(--solva-muted)' }}
                className="text-xs text-center font-mono"
              >
                {t('auth.autoRedirectingIn', { seconds: redirectSeconds })}
              </p>

              <Link
                to="/login?activated=1"
                style={{
                  backgroundColor: 'var(--solva-btn-bg)',
                  color: 'var(--solva-btn-fg)',
                }}
                className="w-full h-[46px] px-5 rounded-[11px] font-solva-sans text-[14px] font-medium inline-flex items-center justify-center gap-2 shadow-sm hover:opacity-90 transition-opacity"
              >
                <span>{t('auth.continueToSignIn')}</span>
                <ArrowRight className="h-4 w-4" />
              </Link>
            </>
          )}

          {status === 'error' && (
            <>
              {errorMessage && (
                <Alert
                  variant="destructive"
                  className="px-3.5 py-2.5 rounded-[12px] flex items-start gap-2.5 [&>svg]:static [&>svg]:mt-0.5 [&>svg]:shrink-0 [&>svg~*]:pl-0 [&>svg+div]:translate-y-0"
                >
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription className="text-xs sm:text-sm font-medium">
                    {errorMessage}
                  </AlertDescription>
                </Alert>
              )}

              {resendSuccess && (
                <Alert className="px-3.5 py-2.5 rounded-[12px] border-emerald-500/30 bg-emerald-500/10 text-emerald-900 dark:text-emerald-200 flex items-start gap-2.5 [&>svg]:static [&>svg]:mt-0.5 [&>svg]:shrink-0 [&>svg~*]:pl-0 [&>svg+div]:translate-y-0">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                  <AlertDescription className="text-xs sm:text-sm font-medium text-emerald-900 dark:text-emerald-200">
                    {resendSuccess}
                  </AlertDescription>
                </Alert>
              )}

              <form
                onSubmit={handleResend}
                style={{
                  backgroundColor: 'var(--solva-surface)',
                  borderColor: 'var(--solva-border)',
                }}
                className="rounded-[12px] border p-4 space-y-3"
              >
                <p
                  style={{ color: 'var(--solva-muted)' }}
                  className="text-xs font-solva-sans font-medium"
                >
                  {t('auth.enterEmailOrUsernameToResend')}
                </p>
                <div className="relative">
                  <div
                    style={{ color: 'var(--solva-muted)' }}
                    className="pointer-events-none z-10 absolute left-3.5 top-1/2 -translate-y-1/2"
                  >
                    <Mail className="h-4 w-4" />
                  </div>
                  <Input
                    type="text"
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                    required
                    placeholder={
                      lang === 'vi'
                        ? 'ban@truongdaihoc.edu.vn'
                        : 'you@university.edu'
                    }
                    style={{
                      backgroundColor: 'var(--solva-card-elevated)',
                      color: 'var(--solva-ink)',
                    }}
                    className={`t-input ${getSolvaInputBorderClasses(false)} h-11 pl-10 rounded-[11px] font-solva-sans text-[14px]`}
                  />
                </div>
                <button
                  type="submit"
                  disabled={resending}
                  style={{
                    backgroundColor: 'var(--solva-btn-bg)',
                    color: 'var(--solva-btn-fg)',
                  }}
                  className="w-full h-11 px-4 rounded-[11px] font-solva-sans text-[13.5px] font-medium inline-flex items-center justify-center gap-2 shadow-sm hover:opacity-90 transition-opacity disabled:opacity-55 cursor-pointer"
                >
                  <RefreshCw
                    className={`h-3.5 w-3.5 ${resending ? 'animate-spin' : ''}`}
                  />
                  <span>
                    {resending
                      ? t('auth.resendingActivation')
                      : t('auth.sendNewActivationLink')}
                  </span>
                </button>
              </form>

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
            </>
          )}
        </CardContent>
      </Card>
    </AuthSplitShell>
  );
}
