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
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';

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
    setLoading(true);

    try {
      const normalized = email.trim().toLowerCase();
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

        <CardHeader className="space-y-2 pb-4 pt-5 sm:pt-6 px-4 sm:px-7">
          <div className="flex items-center justify-between gap-2">
            <Badge
              variant="outline"
              className="font-mono text-[10px] uppercase tracking-wider px-2.5 py-0.5 bg-indigo-50/80 text-indigo-700 dark:bg-indigo-950/80 dark:text-indigo-300 border-indigo-200/70 dark:border-indigo-800/70"
            >
              <KeyRound className="h-3 w-3 mr-1 shrink-0" />
              {t('auth.forgotBadge')}
            </Badge>
          </div>

          <CardTitle className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-white pt-1">
            {sentToEmail
              ? t('auth.resetEmailSentTitle')
              : t('auth.forgotTitle')}
          </CardTitle>
          <CardDescription className="text-sm text-slate-600 dark:text-slate-400">
            {sentToEmail
              ? t('auth.resetEmailSentSubtitle')
              : t('auth.forgotSubtitle')}
          </CardDescription>
        </CardHeader>

        <CardContent className="px-4 sm:px-7 pb-5 sm:pb-6">
          {error && (
            <Alert variant="destructive" className="mb-4">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription className="text-xs sm:text-sm font-medium">
                {error}
              </AlertDescription>
            </Alert>
          )}

          {sentToEmail ? (
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-emerald-50/90 dark:bg-emerald-950/40 border border-emerald-200/80 dark:border-emerald-800/70 flex items-center gap-3">
                <div className="p-2 rounded-lg bg-emerald-600 text-white shrink-0">
                  <CheckCircle2 className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-[11px] font-mono uppercase tracking-wider text-emerald-700 dark:text-emerald-300 font-semibold">
                    {lang === 'vi' ? 'Email nhận liên kết' : 'Target Inbox'}
                  </p>
                  <p className="text-sm font-mono font-bold text-slate-900 dark:text-white truncate">
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
                  className="flex-1 h-10 rounded-xl text-xs font-semibold cursor-pointer"
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

                <Button
                  asChild
                  className="flex-1 h-10 rounded-xl text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white"
                >
                  <Link to="/login">
                    <span>{t('auth.backToSignIn')}</span>
                    <ArrowRight className="h-3.5 w-3.5 ml-1" />
                  </Link>
                </Button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label
                  htmlFor="email"
                  className="text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300"
                >
                  {t('auth.forgotEmailLabel')}
                </Label>
                <div className="relative">
                  <div className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500">
                    <Mail className="h-4 w-4" />
                  </div>
                  <Input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoComplete="email"
                    className="h-11 pl-10 bg-slate-50/60 dark:bg-slate-950/60 focus-visible:bg-white dark:focus-visible:bg-slate-900"
                    placeholder={t('auth.forgotEmailPlaceholder')}
                  />
                </div>
              </div>

              <Button
                type="submit"
                disabled={loading}
                size="lg"
                className="w-full h-11 rounded-xl text-sm font-semibold bg-indigo-600 hover:bg-indigo-700 text-white shadow-md shadow-indigo-600/20 cursor-pointer"
              >
                {loading ? (
                  <>
                    <div className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2" />
                    <span>{t('auth.sendingResetLink')}</span>
                  </>
                ) : (
                  <>
                    <span>{t('auth.sendResetLinkBtn')}</span>
                    <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </Button>

              <div className="pt-3 border-t border-slate-200/70 dark:border-slate-800/70 text-center">
                <Link
                  to="/login"
                  className="inline-flex items-center gap-1.5 text-xs sm:text-sm font-semibold text-indigo-600 dark:text-indigo-400 hover:underline"
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
