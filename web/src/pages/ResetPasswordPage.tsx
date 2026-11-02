import { useState, useEffect, useRef } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
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
  Loader2,
  UserCheck,
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

export function ResetPasswordPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';
  const lang = i18n.language?.startsWith('vi') ? 'vi' : 'en';

  const [tokenState, setTokenState] = useState<
    'verifying' | 'valid' | 'invalid' | 'completed'
  >(token ? 'verifying' : 'invalid');
  const [targetUser, setTargetUser] = useState<{
    username?: string | null;
    email?: string | null;
  }>({});
  const [invalidMessage, setInvalidMessage] = useState(
    token ? '' : t('auth.invalidResetLinkSubtitle'),
  );

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [redirectSeconds, setRedirectSeconds] = useState(4);

  const verifiedTokenRef = useRef<string | null>(null);

  useEffect(() => {
    if (!token) {
      setTokenState('invalid');
      setInvalidMessage(t('auth.invalidResetLinkSubtitle'));
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
          setInvalidMessage(res.message || t('auth.invalidResetLinkSubtitle'));
        }
      })
      .catch((err) => {
        setTokenState('invalid');
        setInvalidMessage(
          err instanceof Error
            ? err.message
            : t('auth.invalidResetLinkSubtitle'),
        );
      });
  }, [token, t]);

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

    if (newPassword.length < 6) {
      setError(
        lang === 'vi'
          ? 'Mật khẩu mới phải có tối thiểu 6 ký tự.'
          : 'New password must be at least 6 characters.',
      );
      return;
    }

    if (newPassword !== confirmPassword) {
      setError(
        lang === 'vi'
          ? 'Mật khẩu xác nhận không khớp.'
          : 'Passwords do not match.',
      );
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
      setError(err instanceof Error ? err.message : 'Failed to reset password');
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

        <CardHeader className="space-y-2 pb-4 pt-5 sm:pt-6 px-4 sm:px-7">
          <div className="flex items-center justify-between gap-2">
            <Badge
              variant="outline"
              className="font-mono text-[10px] uppercase tracking-wider px-2.5 py-0.5 bg-indigo-50/80 text-indigo-700 dark:bg-indigo-950/80 dark:text-indigo-300 border-indigo-200/70 dark:border-indigo-800/70"
            >
              <ShieldCheck className="h-3 w-3 mr-1 shrink-0" />
              {t('auth.resetBadge')}
            </Badge>
          </div>

          <CardTitle className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-white pt-1">
            {tokenState === 'invalid'
              ? t('auth.invalidResetLinkTitle')
              : tokenState === 'completed'
                ? t('auth.resetSuccessTitle')
                : t('auth.resetTitle')}
          </CardTitle>
          <CardDescription className="text-sm text-slate-600 dark:text-slate-400">
            {tokenState === 'invalid'
              ? t('auth.invalidResetLinkSubtitle')
              : tokenState === 'completed'
                ? t('auth.resetSuccessSubtitle')
                : t('auth.resetSubtitle')}
          </CardDescription>
        </CardHeader>

        <CardContent className="px-4 sm:px-7 pb-5 sm:pb-6">
          {tokenState === 'verifying' && (
            <div className="py-8 flex flex-col items-center justify-center gap-3 text-slate-500 dark:text-slate-400">
              <Loader2 className="h-8 w-8 text-indigo-600 dark:text-indigo-400 animate-spin" />
              <span className="text-xs font-mono uppercase tracking-wider">
                {t('auth.verifyingResetLink')}
              </span>
            </div>
          )}

          {tokenState === 'invalid' && (
            <div className="space-y-4">
              {invalidMessage && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription className="text-xs sm:text-sm font-medium">
                    {invalidMessage}
                  </AlertDescription>
                </Alert>
              )}

              <Button
                asChild
                size="lg"
                className="w-full h-11 rounded-xl text-sm font-semibold bg-indigo-600 hover:bg-indigo-700 text-white"
              >
                <Link to="/forgot-password">
                  <span>{t('auth.requestNewResetLink')}</span>
                  <ArrowRight className="h-4 w-4 ml-1.5" />
                </Link>
              </Button>

              <div className="pt-2 text-center">
                <Link
                  to="/login"
                  className="text-xs sm:text-sm font-semibold text-indigo-600 dark:text-indigo-400 hover:underline"
                >
                  {t('auth.backToSignIn')}
                </Link>
              </div>
            </div>
          )}

          {tokenState === 'valid' && (
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Target Account Pill */}
              {(targetUser.username || targetUser.email) && (
                <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950/70 border border-slate-200/80 dark:border-slate-800 flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 shrink-0">
                    <UserCheck className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    {targetUser.username && (
                      <p className="text-xs font-mono font-bold text-slate-900 dark:text-white">
                        @{targetUser.username}
                      </p>
                    )}
                    {targetUser.email && (
                      <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                        {targetUser.email}
                      </p>
                    )}
                  </div>
                </div>
              )}

              {error && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription className="text-xs sm:text-sm font-medium">
                    {error}
                  </AlertDescription>
                </Alert>
              )}

              <div className="space-y-2">
                <Label
                  htmlFor="new_password"
                  className="text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300"
                >
                  {t('auth.newPassword')}
                </Label>
                <div className="relative">
                  <div className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500">
                    <KeyRound className="h-4 w-4" />
                  </div>
                  <Input
                    id="new_password"
                    type={showPassword ? 'text' : 'password'}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    required
                    autoComplete="new-password"
                    className="h-11 pl-10 pr-11 bg-slate-50/60 dark:bg-slate-950/60"
                    placeholder={t('auth.newPasswordPlaceholder')}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={
                      showPassword ? 'Hide characters' : 'Show characters'
                    }
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
                  >
                    {showPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <Label
                  htmlFor="confirm_new_password"
                  className="text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300"
                >
                  {t('auth.confirmNewPassword')}
                </Label>
                <div className="relative">
                  <div className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500">
                    <KeyRound className="h-4 w-4" />
                  </div>
                  <Input
                    id="confirm_new_password"
                    type={showPassword ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                    autoComplete="new-password"
                    className="h-11 pl-10 bg-slate-50/60 dark:bg-slate-950/60"
                    placeholder={t('auth.confirmNewPasswordPlaceholder')}
                  />
                </div>
              </div>

              <PasswordStrengthIndicator
                password={newPassword}
                confirmPassword={confirmPassword}
              />

              <Button
                type="submit"
                disabled={submitting}
                size="lg"
                className="w-full h-11 rounded-xl text-sm font-semibold bg-indigo-600 hover:bg-indigo-700 text-white shadow-md shadow-indigo-600/20 cursor-pointer"
              >
                {submitting ? (
                  <>
                    <div className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2" />
                    <span>{t('auth.resettingPassword')}</span>
                  </>
                ) : (
                  <>
                    <span>{t('auth.resetPasswordBtn')}</span>
                    <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </Button>
            </form>
          )}

          {tokenState === 'completed' && (
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-emerald-50/90 dark:bg-emerald-950/40 border border-emerald-200/80 dark:border-emerald-800/70 flex items-center gap-3">
                <div className="p-2 rounded-lg bg-emerald-600 text-white shrink-0">
                  <CheckCircle2 className="h-5 w-5" />
                </div>
                <div className="text-xs sm:text-sm font-medium text-emerald-900 dark:text-emerald-200">
                  {t('auth.resetSuccessSubtitle')}
                </div>
              </div>

              <p className="text-xs text-center font-mono text-slate-500 dark:text-slate-400">
                {t('auth.autoRedirectingIn', { seconds: redirectSeconds })}
              </p>

              <Button
                asChild
                size="lg"
                className="w-full h-11 rounded-xl text-sm font-semibold bg-indigo-600 hover:bg-indigo-700 text-white"
              >
                <Link to="/login?reset=1">
                  <span>{t('auth.continueToSignIn')}</span>
                  <ArrowRight className="h-4 w-4 ml-1.5" />
                </Link>
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </AuthSplitShell>
  );
}
