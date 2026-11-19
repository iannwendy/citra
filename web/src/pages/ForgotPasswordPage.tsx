import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { AuthSplitShell } from '@/components/AuthSplitShell';
import {
  Mail,
  KeyRound,
  AlertCircle,
  ArrowRight,
  ArrowLeft,
  CheckCircle2,
  RefreshCw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
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

const SIMPLE_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const getSolvaInputBorderClasses = (invalid: boolean) =>
  invalid
    ? 'is-error border-red-600 dark:border-red-400 focus-visible:ring-2 focus-visible:ring-red-600/20 dark:focus-visible:ring-red-400/25 focus-visible:border-red-600 dark:focus-visible:border-red-400 placeholder:text-[#78736A] dark:placeholder:text-[#969084]'
    : 'border-[#E7E3D9] dark:border-[#332F26] focus-visible:ring-2 focus-visible:ring-[#1C1A15]/15 dark:focus-visible:ring-[#FBFAF6]/20 focus-visible:border-[#1C1A15] dark:focus-visible:border-[#FBFAF6] placeholder:text-[#78736A] dark:placeholder:text-[#969084]';

export function ForgotPasswordPage() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language?.startsWith('vi') ? 'vi' : 'en';

  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [sentToEmail, setSentToEmail] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setInterval(() => {
      setCooldown((prev) => (prev > 1 ? prev - 1 : 0));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [cooldown]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const normalized = email.trim().toLowerCase();
    if (!normalized || !SIMPLE_EMAIL_RE.test(normalized)) {
      setError(t('auth.forgotInvalidEmail'));
      return;
    }

    setLoading(true);

    try {
      await api.forgotPassword(normalized, lang);
      setSentToEmail(normalized);
      setCooldown(30);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to send password reset link',
      );
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (!sentToEmail || cooldown > 0 || loading) return;
    setLoading(true);
    setError('');
    try {
      await api.forgotPassword(sentToEmail, lang);
      setCooldown(30);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to resend reset link',
      );
    } finally {
      setLoading(false);
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
          <div className="flex items-center justify-between gap-2">
            <div
              style={{
                backgroundColor: 'var(--solva-surface)',
                borderColor: 'var(--solva-border)',
                color: 'var(--solva-ink)',
              }}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[6px] border font-mono text-[10px] uppercase tracking-wider font-semibold whitespace-nowrap"
            >
              <KeyRound className="h-3 w-3 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <span>{t('auth.forgotBadge')}</span>
            </div>
          </div>

          <CardTitle
            style={{ color: 'var(--solva-ink)' }}
            className={`font-solva-serif font-light text-[28px] sm:text-[32px] pt-0.5 ${
              lang === 'vi'
                ? 'leading-[1.15] tracking-[-0.03em]'
                : 'leading-[1.08] tracking-[-0.04em]'
            }`}
          >
            {(sentToEmail
              ? t('auth.resetEmailSentTitle')
              : t('auth.forgotTitle')
            ).normalize('NFC')}
          </CardTitle>
          <CardDescription
            style={{ color: 'var(--solva-muted)' }}
            className="font-solva-sans text-[14px] sm:text-[15px] leading-relaxed"
          >
            {sentToEmail
              ? t('auth.resetEmailSentSubtitle')
              : t('auth.forgotSubtitle')}
          </CardDescription>
        </CardHeader>

        <CardContent className="px-5 sm:px-7 pb-5 sm:pb-6">
          {error && (
            <Alert
              id="forgot-form-error"
              variant="destructive"
              className="mb-4 rounded-[12px]"
            >
              <AlertCircle className="h-4 w-4" />
              <AlertDescription className="text-xs sm:text-sm font-medium">
                {error}
              </AlertDescription>
            </Alert>
          )}

          {sentToEmail ? (
            <div className="space-y-4">
              <div
                style={{
                  backgroundColor: 'var(--solva-surface)',
                  borderColor: 'var(--solva-border)',
                }}
                className="p-4 rounded-[12px] border flex items-center gap-3"
              >
                <div className="p-2 rounded-[8px] bg-emerald-600 text-white shrink-0">
                  <CheckCircle2 className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-[11px] font-mono uppercase tracking-wider text-emerald-700 dark:text-emerald-300 font-semibold">
                    {lang === 'vi' ? 'Email nhận liên kết' : 'Target Inbox'}
                  </p>
                  <p
                    style={{ color: 'var(--solva-ink)' }}
                    className="text-sm font-mono font-bold break-all"
                  >
                    {sentToEmail}
                  </p>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 pt-1">
                <Button
                  type="button"
                  variant="outline"
                  disabled={cooldown > 0 || loading}
                  onClick={handleResend}
                  className="flex-1 h-10 rounded-[11px] text-xs font-semibold border-[#E7E3D9] dark:border-[#332F26] bg-[var(--solva-surface)] text-[var(--solva-ink)] hover:bg-[#ECE9E0] dark:hover:bg-[#29261F] hover:border-[#D4CFC3] dark:hover:border-[#3F3A30] hover:text-[var(--solva-ink)] dark:hover:text-[var(--solva-ink)] cursor-pointer"
                >
                  <RefreshCw
                    className={`h-3.5 w-3.5 mr-1.5 ${loading ? 'animate-spin' : ''}`}
                  />
                  <span>
                    {cooldown > 0
                      ? t('auth.resendInSeconds', { seconds: cooldown })
                      : t('auth.sendResetLinkBtn')}
                  </span>
                </Button>

                <Link
                  to="/login"
                  style={{
                    backgroundColor: 'var(--solva-btn-bg)',
                    color: 'var(--solva-btn-fg)',
                  }}
                  className="flex-1 h-10 px-4 rounded-[11px] font-solva-sans text-xs font-semibold inline-flex items-center justify-center gap-1.5 hover:opacity-90 transition-opacity"
                >
                  <span>{t('auth.backToSignIn')}</span>
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} noValidate className="space-y-4">
              <div className="space-y-1.5">
                <Label
                  htmlFor="email"
                  style={{ color: 'var(--solva-ink)' }}
                  className="font-mono text-[11px] font-semibold uppercase tracking-wider"
                >
                  {t('auth.forgotEmailLabel')}
                </Label>
                <div className="relative">
                  <div
                    style={{ color: 'var(--solva-muted)' }}
                    className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2"
                  >
                    <Mail className="h-4 w-4" />
                  </div>
                  <Input
                    id="email"
                    type="email"
                    value={email}
                    aria-invalid={Boolean(error)}
                    aria-describedby={error ? 'forgot-form-error' : undefined}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      if (error) setError('');
                    }}
                    required
                    autoComplete="email"
                    style={{
                      backgroundColor: 'var(--solva-surface)',
                      color: 'var(--solva-ink)',
                    }}
                    className={`t-input ${getSolvaInputBorderClasses(Boolean(error))} h-11 pl-10 rounded-[11px] font-solva-sans text-[14px]`}
                    placeholder={t('auth.forgotEmailPlaceholder')}
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                style={{
                  backgroundColor: 'var(--solva-btn-bg)',
                  color: 'var(--solva-btn-fg)',
                }}
                className="group relative w-full h-[46px] px-5 rounded-[11px] font-solva-sans text-[14px] font-medium flex items-center justify-center gap-2 shadow-sm hover:shadow-md transition-all duration-200 active:scale-[0.985] disabled:opacity-55 disabled:pointer-events-none cursor-pointer select-none"
              >
                {loading ? (
                  <>
                    <div className="h-4 w-4 border-2 border-current/30 border-t-current rounded-full animate-spin" />
                    <span>{t('auth.sendingResetLink')}</span>
                  </>
                ) : (
                  <>
                    <span>{t('auth.sendResetLinkBtn')}</span>
                    <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
                  </>
                )}
              </button>

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
            </form>
          )}
        </CardContent>
      </Card>
    </AuthSplitShell>
  );
}
