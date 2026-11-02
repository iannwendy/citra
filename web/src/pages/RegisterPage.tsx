import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import {
  AuthSplitShell,
  PasswordStrengthIndicator,
} from '@/components/AuthSplitShell';
import { GoogleAuthButton } from '@/components/GoogleAuthButton';
import {
  Eye,
  EyeOff,
  AlertCircle,
  ArrowRight,
  UserPlus,
  User,
  Mail,
  KeyRound,
  Building2,
  BadgeCheck,
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

export function RegisterPage() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language?.startsWith('vi') ? 'vi' : 'en';

  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [institution, setInstitution] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Success state (Check your email)
  const [registeredEmail, setRegisteredEmail] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [resending, setResending] = useState(false);
  const [resendMessage, setResendMessage] = useState('');

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

    const trimmedUsername = username.trim();
    if (!/^[a-zA-Z0-9._-]{3,50}$/.test(trimmedUsername)) {
      setError(
        lang === 'vi'
          ? 'Tên đăng nhập phải từ 3–50 ký tự và chỉ chứa chữ cái, chữ số, dấu chấm, gạch dưới hoặc gạch ngang.'
          : 'Username must be 3–50 characters and contain only letters, numbers, dots, underscores, or hyphens.',
      );
      return;
    }

    if (password.length < 6) {
      setError(
        lang === 'vi'
          ? 'Mật khẩu phải có tối thiểu 6 ký tự.'
          : 'Password must be at least 6 characters.',
      );
      return;
    }

    if (password !== confirmPassword) {
      setError(
        lang === 'vi'
          ? 'Mật khẩu xác nhận không khớp.'
          : 'Passwords do not match.',
      );
      return;
    }

    setLoading(true);
    try {
      const resp = await api.register({
        username: trimmedUsername,
        email: email.trim().toLowerCase(),
        password,
        full_name: fullName.trim() || undefined,
        institution: institution.trim() || undefined,
        lang,
      });
      setRegisteredEmail(resp.email);
      setCooldown(60);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (!registeredEmail || cooldown > 0 || resending) return;
    setResending(true);
    setResendMessage('');
    setError('');
    try {
      await api.resendActivation(registeredEmail, lang);
      setResendMessage(t('auth.activationResentSuccess'));
      setCooldown(60);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to resend activation email',
      );
    } finally {
      setResending(false);
    }
  };

  return (
    <AuthSplitShell maxWidthClass="max-w-[480px]">
      <Card
        style={{
          backgroundColor: 'var(--solva-card-elevated)',
          borderColor: 'var(--solva-border)',
        }}
        className="solva-glass-ring p-0 overflow-hidden border rounded-[18px]"
      >
        {/* Top Solva Editorial Hairline Accent */}
        <div
          style={{
            background:
              'linear-gradient(90deg, var(--solva-ink) 0%, #10B981 55%, var(--solva-border) 100%)',
          }}
          className="h-[3px] w-full opacity-85"
        />

        {registeredEmail ? (
          /* ============================================================
             Post-Registration: Check Your Email Confirmation View
             ============================================================ */
          <>
            <CardHeader className="space-y-2 pb-4 pt-6 px-6 sm:px-7">
              <div className="flex items-center justify-between gap-2">
                <Badge
                  variant="outline"
                  className="font-mono text-[10px] uppercase tracking-wider px-2.5 py-0.5 bg-emerald-50/80 text-emerald-700 dark:bg-emerald-950/80 dark:text-emerald-300 border-emerald-200/70 dark:border-emerald-800/70"
                >
                  <Mail className="h-3 w-3 mr-1 shrink-0" />
                  {t('auth.activateBadge')}
                </Badge>
              </div>
              <CardTitle className="font-display text-2xl font-bold tracking-tight text-slate-900 dark:text-white pt-1">
                {t('auth.checkEmailTitle')}
              </CardTitle>
              <CardDescription className="text-sm text-slate-600 dark:text-slate-400">
                {t('auth.checkEmailSubtitle')}
              </CardDescription>
            </CardHeader>

            <CardContent className="px-6 sm:px-7 pb-6 space-y-5">
              {/* Target Email Pill */}
              <div className="p-3.5 rounded-xl bg-indigo-50/70 dark:bg-indigo-950/40 border border-indigo-200/80 dark:border-indigo-800/70 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="p-2 rounded-lg bg-indigo-600 text-white shrink-0">
                    <Mail className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[11px] font-mono uppercase tracking-wider text-indigo-600 dark:text-indigo-400 font-semibold">
                      @{username}
                    </p>
                    <p className="text-sm font-mono font-bold text-slate-900 dark:text-white truncate">
                      {registeredEmail}
                    </p>
                  </div>
                </div>
                <BadgeCheck className="h-5 w-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
              </div>

              {resendMessage && (
                <Alert className="border-emerald-200/90 dark:border-emerald-800/80 bg-emerald-50/90 dark:bg-emerald-950/50">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                  <AlertDescription className="text-xs sm:text-sm font-medium text-emerald-800 dark:text-emerald-200">
                    {resendMessage}
                  </AlertDescription>
                </Alert>
              )}

              {error && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription className="text-xs sm:text-sm font-medium">
                    {error}
                  </AlertDescription>
                </Alert>
              )}

              {/* 3-Step Activation Checklist */}
              <div className="rounded-xl bg-slate-50/90 dark:bg-slate-950/60 border border-slate-200/80 dark:border-slate-800 p-4 space-y-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  {t('auth.checkEmailStepsTitle')}
                </p>
                <ol className="space-y-2.5 text-xs sm:text-sm text-slate-700 dark:text-slate-300">
                  <li className="flex items-start gap-2.5">
                    <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 font-mono text-xs font-bold shrink-0 mt-0.5">
                      1
                    </span>
                    <span>{t('auth.checkEmailStep1')}</span>
                  </li>
                  <li className="flex items-start gap-2.5">
                    <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 font-mono text-xs font-bold shrink-0 mt-0.5">
                      2
                    </span>
                    <span>{t('auth.checkEmailStep2')}</span>
                  </li>
                  <li className="flex items-start gap-2.5">
                    <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 font-mono text-xs font-bold shrink-0 mt-0.5">
                      3
                    </span>
                    <span>{t('auth.checkEmailStep3')}</span>
                  </li>
                </ol>
              </div>

              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 pt-1">
                <Button
                  type="button"
                  variant="outline"
                  disabled={cooldown > 0 || resending}
                  onClick={handleResend}
                  className="flex-1 h-10 rounded-xl text-xs font-semibold cursor-pointer"
                >
                  <RefreshCw
                    className={`h-3.5 w-3.5 mr-1.5 ${resending ? 'animate-spin' : ''}`}
                  />
                  <span>
                    {resending
                      ? t('auth.resendingActivation')
                      : cooldown > 0
                        ? t('auth.resendInSeconds', { seconds: cooldown })
                        : t('auth.resendActivationEmail')}
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
            </CardContent>
          </>
        ) : (
          /* ============================================================
             Registration Form View
             ============================================================ */
          <>
            <CardHeader className="space-y-1.5 pb-4 pt-5 sm:pt-6 px-4 sm:px-7">
              <div className="flex items-center justify-between gap-2">
                <Badge
                  variant="outline"
                  className="font-mono text-[10px] uppercase tracking-wider px-2.5 py-0.5 bg-indigo-50/80 text-indigo-700 dark:bg-indigo-950/80 dark:text-indigo-300 border-indigo-200/70 dark:border-indigo-800/70"
                >
                  <UserPlus className="h-3 w-3 mr-1 shrink-0" />
                  {t('auth.registerBadge')}
                </Badge>
              </div>

              <CardTitle className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-white pt-1">
                {t('auth.registerTitle')}
              </CardTitle>
              <CardDescription className="text-sm text-slate-600 dark:text-slate-400">
                {t('auth.registerSubtitle')}
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

              <form onSubmit={handleSubmit} className="space-y-3.5">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {/* Full Name */}
                  <div className="space-y-1.5">
                    <Label
                      htmlFor="full_name"
                      className="text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300"
                    >
                      {t('auth.fullName')}
                    </Label>
                    <div className="relative">
                      <div className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500">
                        <User className="h-4 w-4" />
                      </div>
                      <Input
                        id="full_name"
                        type="text"
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                        required
                        autoComplete="name"
                        className="h-10 pl-9 bg-slate-50/60 dark:bg-slate-950/60"
                        placeholder={t('auth.fullNamePlaceholder')}
                      />
                    </div>
                  </div>

                  {/* Username */}
                  <div className="space-y-1.5">
                    <Label
                      htmlFor="username"
                      className="text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300"
                    >
                      {t('auth.username')}
                    </Label>
                    <div className="relative">
                      <div className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 font-mono text-xs font-bold">
                        @
                      </div>
                      <Input
                        id="username"
                        type="text"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        required
                        autoComplete="username"
                        className="h-10 pl-8 bg-slate-50/60 dark:bg-slate-950/60"
                        placeholder={t('auth.usernamePlaceholder')}
                      />
                    </div>
                  </div>
                </div>

                {/* Email Address */}
                <div className="space-y-1.5">
                  <Label
                    htmlFor="email"
                    className="text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300"
                  >
                    {t('auth.email')}
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
                      className="h-10 pl-10 bg-slate-50/60 dark:bg-slate-950/60"
                      placeholder={t('auth.emailPlaceholder')}
                    />
                  </div>
                </div>

                {/* Institution / Affiliation */}
                <div className="space-y-1.5">
                  <Label
                    htmlFor="institution"
                    className="text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300"
                  >
                    {t('auth.institution')}
                  </Label>
                  <div className="relative">
                    <div className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500">
                      <Building2 className="h-4 w-4" />
                    </div>
                    <Input
                      id="institution"
                      type="text"
                      value={institution}
                      onChange={(e) => setInstitution(e.target.value)}
                      autoComplete="organization"
                      className="h-10 pl-10 bg-slate-50/60 dark:bg-slate-950/60"
                      placeholder={t('auth.institutionPlaceholder')}
                    />
                  </div>
                </div>

                {/* Password & Confirm Password */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label
                      htmlFor="password"
                      className="text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300"
                    >
                      {t('auth.password')}
                    </Label>
                    <div className="relative">
                      <div className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500">
                        <KeyRound className="h-4 w-4" />
                      </div>
                      <Input
                        id="password"
                        type={showPassword ? 'text' : 'password'}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                        autoComplete="new-password"
                        className="h-10 pl-9 pr-9 bg-slate-50/60 dark:bg-slate-950/60"
                        placeholder={t('auth.passwordPlaceholder')}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        aria-label={
                          showPassword ? 'Hide characters' : 'Show characters'
                        }
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
                      >
                        {showPassword ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label
                      htmlFor="confirm_password"
                      className="text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300"
                    >
                      {t('auth.confirmPassword')}
                    </Label>
                    <div className="relative">
                      <div className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500">
                        <KeyRound className="h-4 w-4" />
                      </div>
                      <Input
                        id="confirm_password"
                        type={showPassword ? 'text' : 'password'}
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        required
                        autoComplete="new-password"
                        className="h-10 pl-9 bg-slate-50/60 dark:bg-slate-950/60"
                        placeholder={t('auth.confirmPasswordPlaceholder')}
                      />
                    </div>
                  </div>
                </div>

                {/* Real-time Password Strength & Match Indicator */}
                <PasswordStrengthIndicator
                  password={password}
                  confirmPassword={confirmPassword}
                />

                <Button
                  type="submit"
                  disabled={loading}
                  size="lg"
                  className="w-full h-11 rounded-xl text-sm font-semibold bg-indigo-600 hover:bg-indigo-700 text-white shadow-md shadow-indigo-600/20 mt-1 cursor-pointer"
                >
                  {loading ? (
                    <>
                      <div className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2" />
                      <span>{t('auth.creatingAccount')}</span>
                    </>
                  ) : (
                    <>
                      <span>{t('auth.createAccountBtn')}</span>
                      <ArrowRight className="h-4 w-4" />
                    </>
                  )}
                </Button>
              </form>

              <GoogleAuthButton onError={setError} disabled={loading} />

              <div className="mt-5 pt-4 border-t border-slate-200/70 dark:border-slate-800/70 text-center text-xs sm:text-sm text-slate-600 dark:text-slate-400">
                <span>{t('auth.alreadyHaveAccount')} </span>
                <Link
                  to="/login"
                  className="font-semibold text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 hover:underline transition-colors"
                >
                  {t('auth.signInInstead')}
                </Link>
              </div>
            </CardContent>
          </>
        )}
      </Card>
    </AuthSplitShell>
  );
}
