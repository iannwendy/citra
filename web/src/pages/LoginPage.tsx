import { useState, useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/contexts/AuthContext';
import { api } from '@/api/client';
import { AuthSplitShell } from '@/components/AuthSplitShell';
import { GoogleAuthButton } from '@/components/GoogleAuthButton';
import {
  Eye,
  EyeOff,
  AlertCircle,
  ArrowRight,
  Lock,
  User,
  KeyRound,
  Terminal,
  Check,
  CheckCircle2,
  Mail,
  ShieldCheck,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { IconSwap, useErrorShake } from '@/components/ui/transitions';

export function LoginPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [focusedField, setFocusedField] = useState<'username' | 'password' | null>(null);
  const [capsLockOn, setCapsLockOn] = useState(false);
  const [error, setError] = useState('');
  const [needsActivation, setNeedsActivation] = useState(false);
  const [resending, setResending] = useState(false);
  const [resentSuccess, setResentSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const [copiedDemo, setCopiedDemo] = useState(false);
  const [mounted, setMounted] = useState(false);
  const { isShaking, triggerError: triggerShake } = useErrorShake();

  useEffect(() => {
    const raf = window.requestAnimationFrame(() => setMounted(true));
    return () => window.cancelAnimationFrame(raf);
  }, []);

  const lang = i18n.language?.startsWith('vi') ? 'vi' : 'en';
  const activatedParam = searchParams.get('activated') === '1';
  const resetParam = searchParams.get('reset') === '1';
  const isEmailFormat = username.includes('@');

  const handleFillDemo = () => {
    setUsername('admin');
    setPassword('admin123');
    setError('');
    setNeedsActivation(false);
    setResentSuccess('');
    setCopiedDemo(true);
    window.setTimeout(() => setCopiedDemo(false), 1800);
  };

  const handlePasswordKeyEvent = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (typeof e.getModifierState === 'function') {
      setCapsLockOn(e.getModifierState('CapsLock'));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setNeedsActivation(false);
    setResentSuccess('');
    setLoading(true);

    try {
      await login(username, password);
      navigate('/dashboard');
    } catch (err) {
      triggerShake();
      const msg = err instanceof Error ? err.message : t('auth.loginError');
      if (msg.includes('ACCOUNT_NOT_ACTIVATED')) {
        setNeedsActivation(true);
        setError(t('auth.accountNotActivatedDesc'));
      } else if (msg.includes('ACCOUNT_DEACTIVATED')) {
        setError(msg.replace('ACCOUNT_DEACTIVATED: ', ''));
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleResendActivation = async () => {
    if (!username.trim()) return;
    setResending(true);
    setResentSuccess('');
    try {
      await api.resendActivation(username.trim(), lang);
      setResentSuccess(t('auth.activationResentSuccess'));
      setError('');
      setNeedsActivation(false);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to resend activation email',
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
        className="solva-glass-ring p-0 overflow-hidden border rounded-[18px] transition-all duration-300"
      >
        {/* Top Solva Editorial Hairline Accent */}
        <div
          style={{
            background:
              'linear-gradient(90deg, var(--solva-ink) 0%, #10B981 55%, var(--solva-border) 100%)',
          }}
          className="h-[3px] w-full opacity-85"
        />

        <CardHeader className="space-y-2.5 pb-4 sm:pb-5 pt-5 sm:pt-6 px-5 sm:px-7">
          {/* Eyebrow Row */}
          <div className="flex items-center justify-between gap-2">
            <div
              style={{
                backgroundColor: 'var(--solva-surface)',
                borderColor: 'var(--solva-border)',
                color: 'var(--solva-ink)',
              }}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[6px] border font-mono text-[10px] uppercase tracking-wider font-semibold whitespace-nowrap"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse shrink-0" />
              <Lock className="h-3 w-3 shrink-0 opacity-80" />
              <span>
                {lang === 'vi' ? 'Xác thực Hệ thống' : 'Workspace Sign In'}
              </span>
            </div>

            <span
              style={{ color: 'var(--solva-muted)' }}
              className="inline-flex items-center gap-1 font-mono text-[10px]"
            >
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <span>SSO · RBAC</span>
            </span>
          </div>

          {/* Sentient Light Editorial Title */}
          <CardTitle
            style={{
              color: 'var(--solva-ink)',
              opacity: mounted ? 1 : 0.01,
              transform: mounted ? 'translate3d(0, 0, 0)' : 'translate3d(0, 12px, 0)',
              transition:
                'opacity 520ms cubic-bezier(0.22, 1, 0.36, 1), transform 520ms cubic-bezier(0.22, 1, 0.36, 1)',
            }}
            className="font-solva-serif font-light text-[30px] sm:text-[34px] leading-[1.08] tracking-[-0.04em] pt-0.5"
          >
            {t('auth.welcomeBack')}
          </CardTitle>

          <CardDescription
            style={{ color: 'var(--solva-muted)' }}
            className="font-solva-sans text-[14px] sm:text-[15px] leading-relaxed"
          >
            {t('auth.signInSubtitle')}
          </CardDescription>
        </CardHeader>

        <CardContent className="px-5 sm:px-7 pb-5 sm:pb-6">
          {/* Activated or Password Reset Success Banner */}
          {(activatedParam || resetParam || resentSuccess) && !error && (
            <Alert className="mb-4 rounded-[12px] border-emerald-500/30 bg-emerald-500/10 text-emerald-900 dark:text-emerald-200 animate-debugger-switch">
              <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              <AlertDescription className="text-xs sm:text-sm font-medium text-emerald-900 dark:text-emerald-200">
                {resentSuccess
                  ? resentSuccess
                  : activatedParam
                    ? t('auth.activatedBanner')
                    : t('auth.passwordResetBanner')}
              </AlertDescription>
            </Alert>
          )}

          {/* Error Message */}
          {error && (
            <Alert
              variant="destructive"
              className="mb-4 rounded-[12px] animate-error-shake"
            >
              <AlertCircle className="h-4 w-4" />
              <AlertDescription className="text-xs sm:text-sm font-medium">
                {error}
              </AlertDescription>
            </Alert>
          )}

          {/* Login Form (Contains ZERO <button><svg> before #password Eye toggle) */}
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Username / Email Input */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <Label
                  htmlFor="username"
                  style={{ color: 'var(--solva-ink)' }}
                  className="font-mono text-[11px] font-semibold uppercase tracking-wider"
                >
                  {t('auth.username')}
                </Label>
                {username.trim().length > 0 && (
                  <span
                    style={{
                      backgroundColor: 'var(--solva-surface)',
                      borderColor: 'var(--solva-border)',
                      color: 'var(--solva-muted)',
                    }}
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-mono font-semibold border"
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                    {isEmailFormat ? 'EMAIL' : 'USERNAME'}
                  </span>
                )}
              </div>

              <div className="relative">
                <div
                  style={{
                    color:
                      focusedField === 'username'
                        ? 'var(--solva-ink)'
                        : 'var(--solva-muted)',
                  }}
                  className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 transition-colors duration-200"
                >
                  {isEmailFormat ? (
                    <Mail className="h-4 w-4" />
                  ) : (
                    <User className="h-4 w-4" />
                  )}
                </div>
                <Input
                  id="username"
                  type="text"
                  value={username}
                  onFocus={() => setFocusedField('username')}
                  onBlur={() => setFocusedField(null)}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                  autoComplete="username"
                  style={{
                    backgroundColor:
                      focusedField === 'username'
                        ? 'var(--solva-card-elevated)'
                        : 'var(--solva-surface)',
                    borderColor:
                      focusedField === 'username'
                        ? 'var(--solva-ink)'
                        : 'var(--solva-border)',
                    color: 'var(--solva-ink)',
                  }}
                  className={`t-input ${error ? 'is-error' : ''} ${isShaking ? 'is-shaking' : ''} h-11 pl-10 rounded-[11px] font-solva-sans text-[14px] transition-all duration-200 focus-visible:ring-2 focus-visible:ring-[#1C1A15]/15 dark:focus-visible:ring-[#FBFAF6]/20`}
                  placeholder={t('auth.usernamePlaceholder')}
                />
              </div>
            </div>

            {/* Password Input */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <Label
                  htmlFor="password"
                  style={{ color: 'var(--solva-ink)' }}
                  className="font-mono text-[11px] font-semibold uppercase tracking-wider"
                >
                  {t('auth.password')}
                </Label>
                <div className="flex items-center gap-2">
                  {capsLockOn && (
                    <span className="px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/25 font-mono text-[9px] font-semibold">
                      CAPS LOCK
                    </span>
                  )}
                  <Link
                    to="/forgot-password"
                    style={{ color: 'var(--solva-muted)' }}
                    className="font-solva-sans text-xs font-medium hover:text-[#1C1A15] dark:hover:text-[#FBFAF6] hover:underline underline-offset-4 transition-colors"
                  >
                    {t('auth.forgotPasswordLink')}
                  </Link>
                </div>
              </div>

              <div className="relative">
                <div
                  style={{
                    color:
                      focusedField === 'password'
                        ? 'var(--solva-ink)'
                        : 'var(--solva-muted)',
                  }}
                  className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 transition-colors duration-200"
                >
                  <KeyRound className="h-4 w-4" />
                </div>
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onFocus={() => setFocusedField('password')}
                  onBlur={() => {
                    setFocusedField(null);
                    setCapsLockOn(false);
                  }}
                  onKeyDown={handlePasswordKeyEvent}
                  onKeyUp={handlePasswordKeyEvent}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  style={{
                    backgroundColor:
                      focusedField === 'password'
                        ? 'var(--solva-card-elevated)'
                        : 'var(--solva-surface)',
                    borderColor:
                      focusedField === 'password'
                        ? 'var(--solva-ink)'
                        : 'var(--solva-border)',
                    color: 'var(--solva-ink)',
                  }}
                  className={`t-input ${error ? 'is-error' : ''} ${isShaking ? 'is-shaking' : ''} h-11 pl-10 pr-11 rounded-[11px] font-solva-sans text-[14px] transition-all duration-200 focus-visible:ring-2 focus-visible:ring-[#1C1A15]/15 dark:focus-visible:ring-[#FBFAF6]/20`}
                  placeholder={t('auth.passwordPlaceholder')}
                />
                {/* IMPORTANT: First <button> with <svg> in DOM for E2E test compatibility */}
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? 'Hide characters' : 'Show characters'}
                  style={{ color: 'var(--solva-muted)' }}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1.5 rounded-[8px] hover:bg-[#ECE9E0] dark:hover:bg-[#29261F] hover:text-[#1C1A15] dark:hover:text-[#FBFAF6] transition-colors cursor-pointer"
                >
                  <IconSwap
                    active={showPassword}
                    iconA={<Eye className="h-4 w-4" />}
                    iconB={<EyeOff className="h-4 w-4" />}
                  />
                </button>
              </div>
            </div>

            {/* Resend Activation Action Box (placed after #password toggle in DOM) */}
            {needsActivation && (
              <div className="rounded-[12px] bg-amber-500/10 border border-amber-500/25 p-3.5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2.5 animate-debugger-switch">
                <div className="text-xs text-amber-900 dark:text-amber-200 font-medium">
                  {t('auth.accountNotActivatedTitle')}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={resending}
                  onClick={handleResendActivation}
                  className="h-8 px-3 text-xs font-semibold border-amber-400/60 dark:border-amber-700 text-amber-900 dark:text-amber-100 hover:bg-amber-500/15 cursor-pointer shrink-0"
                >
                  <Mail className="h-3.5 w-3.5 mr-1.5" />
                  <span>
                    {resending
                      ? t('auth.resendingActivation')
                      : t('auth.resendActivationBtn')}
                  </span>
                </Button>
              </div>
            )}

            {/* Primary Solva Vertical Slot-Roll Submit Button */}
            <button
              type="submit"
              disabled={loading}
              style={{
                backgroundColor: 'var(--solva-btn-bg)',
                color: 'var(--solva-btn-fg)',
              }}
              className="group relative w-full h-[46px] px-5 rounded-[11px] font-solva-sans text-[14px] font-medium flex items-center justify-center shadow-sm hover:shadow-md transition-all duration-200 active:scale-[0.985] disabled:opacity-55 disabled:pointer-events-none cursor-pointer select-none mt-2"
            >
              {loading ? (
                <div className="h-5 w-5 border-2 border-current/30 border-t-current rounded-full animate-spin" />
              ) : (
                <span className="relative h-[22px] overflow-hidden flex flex-col items-center">
                  <span className="flex flex-col transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:-translate-y-[22px]">
                    <span className="h-[22px] flex items-center justify-center whitespace-nowrap gap-2">
                      <span>{t('auth.signIn')}</span>
                      <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
                    </span>
                    <span
                      className="h-[22px] flex items-center justify-center whitespace-nowrap gap-2"
                      aria-hidden="true"
                    >
                      <span>{t('auth.signIn')}</span>
                      <ArrowRight className="h-4 w-4 translate-x-0.5" />
                    </span>
                  </span>
                </span>
              )}
            </button>
          </form>

          {/* Google OAuth Sign-In (placed after form so #password Eye toggle remains first SVG button) */}
          <GoogleAuthButton onError={setError} disabled={loading} />

          {/* Create Account Link */}
          <div
            style={{
              borderColor: 'var(--solva-border)',
              color: 'var(--solva-muted)',
            }}
            className="mt-5 pt-4 border-t text-center font-solva-sans text-xs sm:text-sm"
          >
            <span>{t('auth.noAccountPrompt')} </span>
            <Link
              to="/register"
              style={{ color: 'var(--solva-ink)' }}
              className="font-semibold underline underline-offset-4 decoration-[#1C1A15]/35 dark:decoration-[#FBFAF6]/35 hover:decoration-current transition-colors"
            >
              {t('auth.createAccountLink')}
            </Link>
          </div>
        </CardContent>

        {/* Demo Credentials Dock (Interactive Role Workspace Quick-Fill) */}
        {import.meta.env.VITE_DEMO_MODE === 'true' && (
          <CardFooter
            style={{
              backgroundColor: 'var(--solva-surface)',
              borderColor: 'var(--solva-border)',
            }}
            className="px-5 sm:px-7 py-3.5 border-t flex flex-col items-stretch gap-2.5"
          >
            <div className="flex items-center justify-between gap-2">
              <div
                style={{ color: 'var(--solva-ink)' }}
                className="flex items-center gap-1.5 text-xs font-solva-sans font-semibold"
              >
                <Terminal className="h-3.5 w-3.5 shrink-0 opacity-80" />
                <span>{t('auth.demoCredentials')}</span>
              </div>
              <button
                type="button"
                onClick={handleFillDemo}
                style={{
                  backgroundColor: 'var(--solva-card-elevated)',
                  borderColor: 'var(--solva-border)',
                  color: 'var(--solva-ink)',
                }}
                className="inline-flex items-center gap-1.5 h-7 px-2.5 text-[11px] font-mono font-semibold rounded-[7px] border hover:opacity-85 transition-opacity cursor-pointer shrink-0 shadow-2xs"
              >
                {copiedDemo ? (
                  <>
                    <Check className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
                    <span>{lang === 'vi' ? 'Đã điền' : 'Filled'}</span>
                  </>
                ) : (
                  <span>{lang === 'vi' ? 'Điền nhanh' : 'Quick Fill'}</span>
                )}
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2 font-mono">
              <div
                style={{
                  backgroundColor: 'var(--solva-card-elevated)',
                  borderColor: 'var(--solva-border)',
                }}
                className="px-3 py-2 rounded-[9px] border flex flex-col gap-0.5"
              >
                <span
                  style={{ color: 'var(--solva-muted)' }}
                  className="text-[10px] uppercase tracking-wider"
                >
                  {t('auth.username')}
                </span>
                <span
                  style={{ color: 'var(--solva-ink)' }}
                  className="text-xs font-semibold"
                >
                  admin
                </span>
              </div>
              <div
                style={{
                  backgroundColor: 'var(--solva-card-elevated)',
                  borderColor: 'var(--solva-border)',
                }}
                className="px-3 py-2 rounded-[9px] border flex flex-col gap-0.5"
              >
                <span
                  style={{ color: 'var(--solva-muted)' }}
                  className="text-[10px] uppercase tracking-wider"
                >
                  {t('auth.password')}
                </span>
                <span
                  style={{ color: 'var(--solva-ink)' }}
                  className="text-xs font-semibold"
                >
                  admin123
                </span>
              </div>
            </div>
          </CardFooter>
        )}
      </Card>
    </AuthSplitShell>
  );
}
