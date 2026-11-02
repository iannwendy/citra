import { useState, useEffect, useRef } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { AuthSplitShell } from '@/components/AuthSplitShell';
import {
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  Mail,
  ShieldCheck,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';

export function ActivateAccountPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';
  const lang = i18n.language?.startsWith('vi') ? 'vi' : 'en';

  const [status, setStatus] = useState<'loading' | 'success' | 'error'>(
    token ? 'loading' : 'error',
  );
  const [accountInfo, setAccountInfo] = useState<{
    username: string;
    email: string;
  } | null>(null);
  const [errorMessage, setErrorMessage] = useState(
    token ? '' : t('auth.activateFailedSubtitle'),
  );
  const [redirectSeconds, setRedirectSeconds] = useState(5);

  // Resend form state on error
  const [identifier, setIdentifier] = useState('');
  const [resending, setResending] = useState(false);
  const [resendSuccess, setResendSuccess] = useState('');

  const requestedTokenRef = useRef<string | null>(null);

  useEffect(() => {
    if (!token) {
      setStatus('error');
      setErrorMessage(t('auth.activateFailedSubtitle'));
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
          err instanceof Error ? err.message : t('auth.activateFailedSubtitle'),
        );
      });
  }, [token, t]);

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
        err instanceof Error ? err.message : 'Failed to send activation link',
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

        <CardHeader className="space-y-2 pb-4 pt-5 sm:pt-6 px-4 sm:px-7">
          <div className="flex items-center justify-between gap-2">
            <Badge
              variant="outline"
              className="font-mono text-[10px] uppercase tracking-wider px-2.5 py-0.5 bg-indigo-50/80 text-indigo-700 dark:bg-indigo-950/80 dark:text-indigo-300 border-indigo-200/70 dark:border-indigo-800/70"
            >
              <ShieldCheck className="h-3 w-3 mr-1 shrink-0" />
              {t('auth.activateBadge')}
            </Badge>
          </div>

          <CardTitle className="font-display text-2xl font-bold tracking-tight text-slate-900 dark:text-white pt-1">
            {status === 'loading'
              ? t('auth.activatingTitle')
              : status === 'success'
                ? t('auth.activateSuccessTitle')
                : t('auth.activateFailedTitle')}
          </CardTitle>
          <CardDescription className="text-sm text-slate-600 dark:text-slate-400">
            {status === 'loading'
              ? t('auth.activatingSubtitle')
              : status === 'success'
                ? t('auth.activateSuccessSubtitle')
                : t('auth.activateFailedSubtitle')}
          </CardDescription>
        </CardHeader>

        <CardContent className="px-4 sm:px-7 pb-5 sm:pb-6 space-y-5">
          {status === 'loading' && (
            <div className="py-8 flex flex-col items-center justify-center gap-3 text-slate-500 dark:text-slate-400">
              <Loader2 className="h-9 w-9 text-indigo-600 dark:text-indigo-400 animate-spin" />
              <span className="text-xs font-mono uppercase tracking-wider">
                {lang === 'vi'
                  ? 'Đang xác minh mã kích hoạt...'
                  : 'Validating activation token...'}
              </span>
            </div>
          )}

          {status === 'success' && (
            <>
              <div className="p-4 rounded-2xl bg-emerald-50/90 dark:bg-emerald-950/40 border border-emerald-200/80 dark:border-emerald-800/70 flex items-center gap-3.5">
                <div className="p-2.5 rounded-xl bg-emerald-600 text-white shrink-0">
                  <CheckCircle2 className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-mono font-semibold text-emerald-700 dark:text-emerald-300">
                    @{accountInfo?.username}
                  </p>
                  <p className="text-sm font-bold text-slate-900 dark:text-white truncate">
                    {accountInfo?.email}
                  </p>
                </div>
              </div>

              <p className="text-xs text-center font-mono text-slate-500 dark:text-slate-400">
                {t('auth.autoRedirectingIn', { seconds: redirectSeconds })}
              </p>

              <Button
                asChild
                size="lg"
                className="w-full h-11 rounded-xl text-sm font-semibold bg-indigo-600 hover:bg-indigo-700 text-white shadow-md shadow-indigo-600/20"
              >
                <Link to="/login?activated=1">
                  <span>{t('auth.continueToSignIn')}</span>
                  <ArrowRight className="h-4 w-4 ml-1.5" />
                </Link>
              </Button>
            </>
          )}

          {status === 'error' && (
            <>
              {errorMessage && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription className="text-xs sm:text-sm font-medium">
                    {errorMessage}
                  </AlertDescription>
                </Alert>
              )}

              {resendSuccess && (
                <Alert className="border-emerald-200/90 dark:border-emerald-800/80 bg-emerald-50/90 dark:bg-emerald-950/50">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                  <AlertDescription className="text-xs sm:text-sm font-medium text-emerald-800 dark:text-emerald-200">
                    {resendSuccess}
                  </AlertDescription>
                </Alert>
              )}

              <form
                onSubmit={handleResend}
                className="rounded-xl bg-slate-50/90 dark:bg-slate-950/60 border border-slate-200/80 dark:border-slate-800 p-4 space-y-3"
              >
                <p className="text-xs font-medium text-slate-600 dark:text-slate-400">
                  {t('auth.enterEmailOrUsernameToResend')}
                </p>
                <div className="relative">
                  <div className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500">
                    <Mail className="h-4 w-4" />
                  </div>
                  <Input
                    type="text"
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                    required
                    placeholder={t('auth.emailPlaceholder')}
                    className="h-10 pl-10 bg-white dark:bg-slate-900"
                  />
                </div>
                <Button
                  type="submit"
                  disabled={resending}
                  className="w-full h-10 rounded-xl text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white cursor-pointer"
                >
                  <RefreshCw
                    className={`h-3.5 w-3.5 mr-1.5 ${resending ? 'animate-spin' : ''}`}
                  />
                  <span>
                    {resending
                      ? t('auth.resendingActivation')
                      : t('auth.sendNewActivationLink')}
                  </span>
                </Button>
              </form>

              <div className="pt-2 text-center">
                <Link
                  to="/login"
                  className="text-xs sm:text-sm font-semibold text-indigo-600 dark:text-indigo-400 hover:underline"
                >
                  {t('auth.backToSignIn')}
                </Link>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </AuthSplitShell>
  );
}
