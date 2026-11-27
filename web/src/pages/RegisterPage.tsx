import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '@/api/client';
import { validatePasswordClient } from '@/lib/utils';
import { formatUserError, resolveAcademicLang } from '@/lib/academicTaxonomy';
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
  Check,
  CheckCircle2,
  RefreshCw,
  ShieldCheck,
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
import { IconSwap } from '@/components/ui/transitions';

/**
 * Derives a valid 3–50 character username (`/^[a-zA-Z0-9._-]{3,50}$/` without
 * leading/trailing punctuation or consecutive dots) from an email or name.
 */
export function deriveUsernameFromEmailOrName(input: string): string {
  const raw = String(input ?? '').trim();
  if (!raw) return '';

  const hasAt = raw.includes('@');
  const base = hasAt ? raw.split('@')[0] : raw;
  const ascii = base
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase();

  let cleaned = ascii
    .replace(/\+/g, '_')
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9._-]/g, '_')
    .replace(/\.{2,}/g, '.')
    .replace(/_{2,}/g, '_')
    .replace(/^[-._]+|[-._]+$/g, '');

  if (!cleaned) {
    return hasAt ? 'scholar_user' : '';
  }

  if (cleaned.length > 50) {
    cleaned = cleaned.slice(0, 50).replace(/^[-._]+|[-._]+$/g, '');
  }

  if (!cleaned) {
    return hasAt ? 'scholar_user' : '';
  }

  if (cleaned.length < 3) {
    cleaned = `${cleaned}_user`.slice(0, 50).replace(/^[-._]+|[-._]+$/g, '');
  }

  return cleaned;
}

const SIMPLE_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

type RegisterInvalidField =
  | 'full_name'
  | 'email'
  | 'username'
  | 'password'
  | 'confirm_password'
  | 'privacy_consent'
  | null;

const getSolvaInputBorderClasses = (invalid: boolean) =>
  invalid
    ? 'is-error border-red-600 dark:border-red-400 focus-visible:ring-2 focus-visible:ring-red-600/20 dark:focus-visible:ring-red-400/25 focus-visible:border-red-600 dark:focus-visible:border-red-400 placeholder:text-[#78736A] dark:placeholder:text-[#969084]'
    : 'border-[#E7E3D9] dark:border-[#332F26] focus-visible:ring-2 focus-visible:ring-[#1C1A15]/15 dark:focus-visible:ring-[#FBFAF6]/20 focus-visible:border-[#1C1A15] dark:focus-visible:border-[#FBFAF6] placeholder:text-[#78736A] dark:placeholder:text-[#969084]';

export function RegisterPage() {
  const { t, i18n } = useTranslation();
  const lang = resolveAcademicLang(i18n.language);

  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [usernameManuallyEdited, setUsernameManuallyEdited] = useState(false);
  const [email, setEmail] = useState('');
  const [institution, setInstitution] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [privacyConsent, setPrivacyConsent] = useState(false);
  const [consentShake, setConsentShake] = useState(false);
  const [invalidField, setInvalidField] = useState<RegisterInvalidField>(null);
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

  const handleFullNameChange = (nextFullName: string) => {
    setFullName(nextFullName);
    if (error) setError('');
    if (invalidField) setInvalidField(null);
    if (!usernameManuallyEdited && !email.trim()) {
      setUsername(deriveUsernameFromEmailOrName(nextFullName));
    }
  };

  const handleEmailChange = (nextEmail: string) => {
    setEmail(nextEmail);
    if (error) setError('');
    if (invalidField) setInvalidField(null);
    if (!usernameManuallyEdited) {
      if (!nextEmail.trim()) {
        setUsername(deriveUsernameFromEmailOrName(fullName));
      } else if (nextEmail.includes('@')) {
        const localDerived = deriveUsernameFromEmailOrName(
          nextEmail.trim().split('@')[0],
        );
        if (localDerived) {
          setUsername(localDerived);
        } else {
          setUsername(
            deriveUsernameFromEmailOrName(fullName) ||
              deriveUsernameFromEmailOrName(nextEmail),
          );
        }
      } else {
        setUsername(deriveUsernameFromEmailOrName(nextEmail));
      }
    }
  };

  const handleUsernameChange = (nextUsername: string) => {
    setUsername(nextUsername);
    setUsernameManuallyEdited(nextUsername.trim().length > 0);
    if (error) setError('');
    if (invalidField) setInvalidField(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setInvalidField(null);

    if (!fullName.trim()) {
      setInvalidField('full_name');
      setError(t('auth.registerMissingFullName'));
      return;
    }

    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail || !SIMPLE_EMAIL_RE.test(normalizedEmail)) {
      setInvalidField('email');
      setError(t('auth.registerInvalidEmail'));
      return;
    }

    const trimmedUsername = username.trim();
    if (
      !/^[a-zA-Z0-9._-]{3,50}$/.test(trimmedUsername) ||
      /^[._-]|[._-]$/.test(trimmedUsername) ||
      trimmedUsername.includes('..')
    ) {
      setInvalidField('username');
      setError(t('auth.registerInvalidUsername'));
      return;
    }

    const pwCheck = validatePasswordClient(password, lang);
    if (!pwCheck.valid) {
      setInvalidField('password');
      setError(
        pwCheck.reason === 'too_short'
          ? t('auth.registerPasswordTooShort')
          : pwCheck.error || t('auth.registerPasswordTooLong'),
      );
      return;
    }

    if (password !== confirmPassword) {
      setInvalidField('confirm_password');
      setError(t('auth.registerPasswordMismatch'));
      return;
    }

    if (!privacyConsent) {
      setInvalidField('privacy_consent');
      setError(t('privacyCompliance.consentRequiredError'));
      setConsentShake(false);
      window.requestAnimationFrame(() => setConsentShake(true));
      return;
    }

    setLoading(true);
    try {
      const resp = await api.register({
        username: trimmedUsername,
        email: normalizedEmail,
        password,
        full_name: fullName.trim() || undefined,
        institution: institution.trim() || undefined,
        lang,
        privacy_consent: true,
        privacy_policy_version: '1.0',
      });
      setRegisteredEmail(resp.email);
      setCooldown(60);
    } catch (err) {
      const rawMsg = err instanceof Error ? err.message : '';
      if (/email/i.test(rawMsg)) {
        setInvalidField('email');
      } else if (/username|tên đăng nhập/i.test(rawMsg)) {
        setInvalidField('username');
      } else if (/password|mật khẩu/i.test(rawMsg)) {
        setInvalidField('password');
      }
      setError(
        formatUserError(
          err,
          lang,
          lang === 'vi'
            ? 'Không thể đăng ký tài khoản. Vui lòng thử lại.'
            : 'Registration failed. Please try again.',
        ),
      );
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
        formatUserError(
          err,
          lang,
          lang === 'vi'
            ? 'Không thể gửi lại email kích hoạt. Vui lòng thử lại sau.'
            : 'Failed to resend activation email. Please try again.',
        ),
      );
    } finally {
      setResending(false);
    }
  };

  const fullNameInvalid = Boolean(error) && invalidField === 'full_name';
  const emailInvalid = Boolean(error) && invalidField === 'email';
  const usernameInvalid = Boolean(error) && invalidField === 'username';
  const passwordInvalid = Boolean(error) && invalidField === 'password';
  const confirmPasswordInvalid =
    Boolean(error) && invalidField === 'confirm_password';
  const consentInvalid = Boolean(error) && invalidField === 'privacy_consent';

  return (
    <AuthSplitShell maxWidthClass="max-w-[500px]" compactRightPanel>
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
            <CardHeader className="space-y-2 pb-3.5 pt-5 px-5 sm:px-6">
              <div className="flex items-center justify-between gap-2">
                <div
                  style={{
                    backgroundColor: 'var(--solva-surface)',
                    borderColor: 'var(--solva-border)',
                    color: 'var(--solva-ink)',
                  }}
                  className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-[6px] border font-mono text-[10px] uppercase tracking-wider font-semibold"
                >
                  <Mail className="h-3 w-3 text-emerald-600 dark:text-emerald-400 shrink-0" />
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
                {t('auth.checkEmailTitle').normalize('NFC')}
              </CardTitle>
              <CardDescription
                style={{ color: 'var(--solva-muted)' }}
                className="font-solva-sans text-[13.5px] leading-relaxed"
              >
                {t('auth.checkEmailSubtitle')}
              </CardDescription>
            </CardHeader>

            <CardContent className="px-5 sm:px-6 pb-5 space-y-4">
              {/* Target Email Pill */}
              <div
                style={{
                  backgroundColor: 'var(--solva-surface)',
                  borderColor: 'var(--solva-border)',
                }}
                className="p-3.5 rounded-[12px] border flex items-center justify-between gap-3"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <div
                    style={{
                      backgroundColor: 'var(--solva-btn-bg)',
                      color: 'var(--solva-btn-fg)',
                    }}
                    className="p-2 rounded-[8px] shrink-0"
                  >
                    <Mail className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <p
                      style={{ color: 'var(--solva-muted)' }}
                      className="text-[11px] font-mono uppercase tracking-wider font-semibold"
                    >
                      @{username}
                    </p>
                    <p
                      style={{ color: 'var(--solva-ink)' }}
                      className="text-sm font-mono font-bold break-all"
                    >
                      {registeredEmail}
                    </p>
                  </div>
                </div>
                <BadgeCheck className="h-5 w-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
              </div>

              {resendMessage && (
                <Alert className="px-3.5 py-2.5 rounded-[12px] border-emerald-500/30 bg-emerald-500/10 text-emerald-900 dark:text-emerald-200 flex items-start gap-2.5 [&>svg]:static [&>svg]:mt-0.5 [&>svg]:shrink-0 [&>svg~*]:pl-0 [&>svg+div]:translate-y-0">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                  <AlertDescription className="text-xs sm:text-sm font-medium text-emerald-900 dark:text-emerald-200">
                    {resendMessage}
                  </AlertDescription>
                </Alert>
              )}

              {error && (
                <Alert
                  variant="destructive"
                  className="px-3.5 py-2.5 rounded-[12px] flex items-start gap-2.5 [&>svg]:static [&>svg]:mt-0.5 [&>svg]:shrink-0 [&>svg~*]:pl-0 [&>svg+div]:translate-y-0"
                >
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription className="text-xs sm:text-sm font-medium">
                    {error}
                  </AlertDescription>
                </Alert>
              )}

              {/* 3-Step Activation Checklist */}
              <div
                style={{
                  backgroundColor: 'var(--solva-surface)',
                  borderColor: 'var(--solva-border)',
                }}
                className="rounded-[12px] border p-3.5 space-y-2.5"
              >
                <p
                  style={{ color: 'var(--solva-muted)' }}
                  className="text-[11px] font-mono font-semibold uppercase tracking-wider"
                >
                  {t('auth.checkEmailStepsTitle')}
                </p>
                <ol
                  style={{ color: 'var(--solva-ink)' }}
                  className="space-y-2 text-xs sm:text-[13px] font-solva-sans"
                >
                  <li className="flex items-start gap-2.5">
                    <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 font-mono text-xs font-bold shrink-0 mt-0.5">
                      1
                    </span>
                    <span>{t('auth.checkEmailStep1')}</span>
                  </li>
                  <li className="flex items-start gap-2.5">
                    <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 font-mono text-xs font-bold shrink-0 mt-0.5">
                      2
                    </span>
                    <span>{t('auth.checkEmailStep2')}</span>
                  </li>
                  <li className="flex items-start gap-2.5">
                    <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 font-mono text-xs font-bold shrink-0 mt-0.5">
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
                  className="flex-1 h-10 rounded-[11px] text-xs font-semibold border-[#E7E3D9] dark:border-[#332F26] bg-[var(--solva-surface)] text-[var(--solva-ink)] hover:bg-[#ECE9E0] dark:hover:bg-[#29261F] hover:border-[#D4CFC3] dark:hover:border-[#3F3A30] hover:text-[var(--solva-ink)] dark:hover:text-[var(--solva-ink)] cursor-pointer"
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
            </CardContent>
          </>
        ) : (
          /* ============================================================
             Registration Form View (Engineered to fit cleanly inside 1440×900)
             ============================================================ */
          <>
            <CardHeader className="space-y-1 pb-2.5 pt-3.5 sm:pt-4 px-5 sm:px-6">
              <div className="flex items-center justify-between gap-2">
                <div
                  style={{
                    backgroundColor: 'var(--solva-surface)',
                    borderColor: 'var(--solva-border)',
                    color: 'var(--solva-ink)',
                  }}
                  className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-[6px] border font-mono text-[10px] uppercase tracking-wider font-semibold whitespace-nowrap"
                >
                  <UserPlus className="h-3 w-3 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  <span>{t('auth.registerBadge')}</span>
                </div>
              </div>

              <CardTitle
                style={{ color: 'var(--solva-ink)' }}
                className={`font-solva-serif font-light text-[25px] sm:text-[28px] pt-0.5 ${
                  lang === 'vi'
                    ? 'leading-[1.15] tracking-[-0.03em]'
                    : 'leading-[1.08] tracking-[-0.04em]'
                }`}
              >
                {t('auth.registerTitle').normalize('NFC')}
              </CardTitle>
              <CardDescription
                style={{ color: 'var(--solva-muted)' }}
                className="font-solva-sans text-[13px] leading-snug"
              >
                {t('auth.registerSubtitle')}
              </CardDescription>
            </CardHeader>

            <CardContent className="px-5 sm:px-6 pb-3.5 sm:pb-4">
              {error && (
                <Alert
                  id="register-form-error"
                  variant="destructive"
                  className="mb-2.5 px-3.5 py-2.5 rounded-[10px] flex items-start gap-2.5 [&>svg]:static [&>svg]:mt-0.5 [&>svg]:shrink-0 [&>svg~*]:pl-0 [&>svg+div]:translate-y-0"
                >
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription className="text-xs font-medium leading-snug">
                    {error}
                  </AlertDescription>
                </Alert>
              )}

              <form onSubmit={handleSubmit} noValidate className="space-y-2.5">
                {/* Row 1: Full Name + Email Address (True Email-First Tab Order) */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div className="space-y-1 min-w-0">
                    <Label
                      htmlFor="full_name"
                      style={{ color: 'var(--solva-ink)' }}
                      className="font-mono text-[10.5px] font-semibold uppercase tracking-wider"
                    >
                      {t('auth.fullName')}
                    </Label>
                    <div className="relative">
                      <div
                        style={{ color: 'var(--solva-muted)' }}
                        className="pointer-events-none z-10 absolute left-3 top-1/2 -translate-y-1/2"
                      >
                        <User className="h-3.5 w-3.5" />
                      </div>
                      <Input
                        id="full_name"
                        type="text"
                        value={fullName}
                        aria-invalid={fullNameInvalid}
                        aria-describedby={
                          fullNameInvalid ? 'register-form-error' : undefined
                        }
                        onChange={(e) => handleFullNameChange(e.target.value)}
                        required
                        autoComplete="name"
                        style={{
                          backgroundColor: 'var(--solva-surface)',
                          color: 'var(--solva-ink)',
                        }}
                        className={`t-input ${getSolvaInputBorderClasses(fullNameInvalid)} w-full min-w-0 h-9 pl-9 pr-2.5 rounded-[10px] font-solva-sans text-[13px]`}
                        placeholder={t('auth.fullNamePlaceholder')}
                      />
                    </div>
                  </div>

                  <div className="space-y-1 min-w-0">
                    <Label
                      htmlFor="email"
                      style={{ color: 'var(--solva-ink)' }}
                      className="font-mono text-[10.5px] font-semibold uppercase tracking-wider"
                    >
                      {t('auth.email')}
                    </Label>
                    <div className="relative">
                      <div
                        style={{ color: 'var(--solva-muted)' }}
                        className="pointer-events-none z-10 absolute left-3 top-1/2 -translate-y-1/2"
                      >
                        <Mail className="h-3.5 w-3.5" />
                      </div>
                      <Input
                        id="email"
                        type="email"
                        value={email}
                        aria-invalid={emailInvalid}
                        aria-describedby={
                          emailInvalid ? 'register-form-error' : undefined
                        }
                        onChange={(e) => handleEmailChange(e.target.value)}
                        required
                        autoComplete="email"
                        style={{
                          backgroundColor: 'var(--solva-surface)',
                          color: 'var(--solva-ink)',
                        }}
                        className={`t-input ${getSolvaInputBorderClasses(emailInvalid)} w-full min-w-0 h-9 pl-9 pr-2.5 rounded-[10px] font-solva-sans text-[13px]`}
                        placeholder={
                          lang === 'vi'
                            ? 'ban@truongdaihoc.edu.vn'
                            : 'you@university.edu'
                        }
                      />
                    </div>
                  </div>
                </div>

                {/* Row 2: Username (auto-suggested from Full Name / Email until manually edited) + Institution (Optional) */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div className="space-y-1 min-w-0">
                    <Label
                      htmlFor="username"
                      style={{ color: 'var(--solva-ink)' }}
                      className="font-mono text-[10.5px] font-semibold uppercase tracking-wider"
                    >
                      {t('auth.username')}
                    </Label>
                    <div className="relative">
                      <div
                        style={{ color: 'var(--solva-muted)' }}
                        className="pointer-events-none z-10 absolute left-3 top-1/2 -translate-y-1/2 font-mono text-xs font-bold"
                      >
                        @
                      </div>
                      <Input
                        id="username"
                        type="text"
                        value={username}
                        aria-invalid={usernameInvalid}
                        aria-describedby={
                          usernameInvalid ? 'register-form-error' : undefined
                        }
                        onChange={(e) => handleUsernameChange(e.target.value)}
                        required
                        autoComplete="username"
                        style={{
                          backgroundColor: 'var(--solva-surface)',
                          color: 'var(--solva-ink)',
                        }}
                        className={`t-input ${getSolvaInputBorderClasses(usernameInvalid)} w-full min-w-0 h-9 pl-8 pr-2.5 rounded-[10px] font-solva-sans text-[13px]`}
                        placeholder={t('auth.usernamePlaceholder')}
                      />
                    </div>
                  </div>

                  <div className="space-y-1 min-w-0">
                    <Label
                      htmlFor="institution"
                      style={{ color: 'var(--solva-ink)' }}
                      className="font-mono text-[10.5px] font-semibold uppercase tracking-wider"
                    >
                      {t('auth.institution')}
                    </Label>
                    <div className="relative">
                      <div
                        style={{ color: 'var(--solva-muted)' }}
                        className="pointer-events-none z-10 absolute left-3 top-1/2 -translate-y-1/2"
                      >
                        <Building2 className="h-3.5 w-3.5" />
                      </div>
                      <Input
                        id="institution"
                        type="text"
                        value={institution}
                        onChange={(e) => {
                          setInstitution(e.target.value);
                          if (error) setError('');
                          if (invalidField) setInvalidField(null);
                        }}
                        autoComplete="organization"
                        style={{
                          backgroundColor: 'var(--solva-surface)',
                          color: 'var(--solva-ink)',
                        }}
                        className={`t-input ${getSolvaInputBorderClasses(false)} w-full min-w-0 h-9 pl-9 pr-2.5 rounded-[10px] font-solva-sans text-[13px]`}
                        placeholder={
                          lang === 'vi'
                            ? 'VD: Trường Đại học...'
                            : 'e.g. University name'
                        }
                      />
                    </div>
                  </div>
                </div>

                {/* Row 3: Password & Confirm Password */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div className="space-y-1 min-w-0">
                    <Label
                      htmlFor="password"
                      style={{ color: 'var(--solva-ink)' }}
                      className="font-mono text-[10.5px] font-semibold uppercase tracking-wider"
                    >
                      {t('auth.password')}
                    </Label>
                    <div className="relative">
                      <div
                        style={{ color: 'var(--solva-muted)' }}
                        className="pointer-events-none z-10 absolute left-3 top-1/2 -translate-y-1/2"
                      >
                        <KeyRound className="h-3.5 w-3.5" />
                      </div>
                      <Input
                        id="password"
                        type={showPassword ? 'text' : 'password'}
                        value={password}
                        minLength={6}
                        maxLength={128}
                        aria-invalid={passwordInvalid}
                        aria-describedby={
                          passwordInvalid ? 'register-form-error' : undefined
                        }
                        onChange={(e) => {
                          setPassword(e.target.value);
                          if (error) setError('');
                          if (invalidField) setInvalidField(null);
                        }}
                        required
                        autoComplete="new-password"
                        style={{
                          backgroundColor: 'var(--solva-surface)',
                          color: 'var(--solva-ink)',
                        }}
                        className={`t-input ${getSolvaInputBorderClasses(passwordInvalid)} w-full min-w-0 h-9 pl-9 pr-9 rounded-[10px] font-solva-sans text-[13px]`}
                        placeholder={t('auth.passwordPlaceholder')}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        aria-label={
                          lang === 'vi'
                            ? showPassword
                              ? 'Ẩn mật khẩu'
                              : 'Hiện mật khẩu'
                            : showPassword
                              ? 'Hide password'
                              : 'Show password'
                        }
                        title={
                          lang === 'vi'
                            ? showPassword
                              ? 'Ẩn mật khẩu'
                              : 'Hiện mật khẩu'
                            : showPassword
                              ? 'Hide password'
                              : 'Show password'
                        }
                        style={{ color: 'var(--solva-muted)' }}
                        className="z-10 absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-[6px] hover:bg-[#ECE9E0] dark:hover:bg-[#29261F] hover:text-[#1C1A15] dark:hover:text-[#FBFAF6] transition-colors cursor-pointer"
                      >
                        <IconSwap
                          active={showPassword}
                          iconA={<Eye className="h-3.5 w-3.5" />}
                          iconB={<EyeOff className="h-3.5 w-3.5" />}
                        />
                      </button>
                    </div>
                  </div>

                  <div className="space-y-1 min-w-0">
                    <Label
                      htmlFor="confirm_password"
                      style={{ color: 'var(--solva-ink)' }}
                      className="font-mono text-[10.5px] font-semibold uppercase tracking-wider"
                    >
                      {t('auth.confirmPassword')}
                    </Label>
                    <div className="relative">
                      <div
                        style={{ color: 'var(--solva-muted)' }}
                        className="pointer-events-none z-10 absolute left-3 top-1/2 -translate-y-1/2"
                      >
                        <KeyRound className="h-3.5 w-3.5" />
                      </div>
                      <Input
                        id="confirm_password"
                        type={showConfirmPassword ? 'text' : 'password'}
                        value={confirmPassword}
                        minLength={6}
                        maxLength={128}
                        aria-invalid={confirmPasswordInvalid}
                        aria-describedby={
                          confirmPasswordInvalid
                            ? 'register-form-error'
                            : undefined
                        }
                        onChange={(e) => {
                          setConfirmPassword(e.target.value);
                          if (error) setError('');
                          if (invalidField) setInvalidField(null);
                        }}
                        required
                        autoComplete="new-password"
                        style={{
                          backgroundColor: 'var(--solva-surface)',
                          color: 'var(--solva-ink)',
                        }}
                        className={`t-input ${getSolvaInputBorderClasses(confirmPasswordInvalid)} w-full min-w-0 h-9 pl-9 pr-9 rounded-[10px] font-solva-sans text-[13px]`}
                        placeholder={t('auth.confirmPasswordPlaceholder')}
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
                        className="z-10 absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-[6px] hover:bg-[#ECE9E0] dark:hover:bg-[#29261F] hover:text-[#1C1A15] dark:hover:text-[#FBFAF6] transition-colors cursor-pointer"
                      >
                        <IconSwap
                          active={showConfirmPassword}
                          iconA={<Eye className="h-3.5 w-3.5" />}
                          iconB={<EyeOff className="h-3.5 w-3.5" />}
                        />
                      </button>
                    </div>
                  </div>
                </div>

                {/* Real-time Password Strength & Match Indicator */}
                <PasswordStrengthIndicator
                  password={password}
                  confirmPassword={confirmPassword}
                />

                {/* Concise Statutory Consent (Luật 91/2025/QH15 & NĐ 356/2025/NĐ-CP) */}
                <div
                  style={{
                    backgroundColor: privacyConsent
                      ? undefined
                      : 'var(--solva-surface)',
                  }}
                  className={`rounded-[10px] border px-3 py-2 transition-all duration-200 ${
                    consentInvalid
                      ? 'is-error border-red-600 dark:border-red-400'
                      : privacyConsent
                        ? 'bg-emerald-50/75 dark:bg-emerald-950/35 border-emerald-300/90 dark:border-emerald-800/80'
                        : 'border-[#E7E3D9] dark:border-[#332F26]'
                  } ${consentShake ? 'animate-error-shake' : ''}`}
                >
                  <label className="flex items-start gap-2.5 cursor-pointer select-none group">
                    <span className="relative mt-0.5 flex h-[17px] w-[17px] shrink-0 items-center justify-center">
                      <input
                        type="checkbox"
                        checked={privacyConsent}
                        aria-invalid={consentInvalid}
                        aria-describedby={
                          consentInvalid ? 'register-form-error' : undefined
                        }
                        onChange={(e) => {
                          setPrivacyConsent(e.target.checked);
                          setConsentShake(false);
                          if (e.target.checked) {
                            if (error) setError('');
                            if (invalidField) setInvalidField(null);
                          }
                        }}
                        data-testid="register-privacy-consent-checkbox"
                        className="peer sr-only"
                      />
                      <span
                        className={`flex h-[17px] w-[17px] items-center justify-center rounded-[5px] border transition-all duration-200 peer-focus-visible:ring-2 peer-focus-visible:ring-offset-1 peer-focus-visible:ring-[#1C1A15] dark:peer-focus-visible:ring-[#FBFAF6] ${
                          consentInvalid
                            ? 'bg-white dark:bg-[#141310] border-red-600 dark:border-red-400'
                            : privacyConsent
                              ? 'bg-[#1C1A15] border-[#1C1A15] text-[#FBFAF6] dark:bg-[#FBFAF6] dark:border-[#FBFAF6] dark:text-[#1C1A15]'
                              : 'bg-white dark:bg-[#141310] border-[#D4CFC3] dark:border-[#3F3A30] group-hover:border-[#1C1A15] dark:group-hover:border-[#FBFAF6]'
                        }`}
                      >
                        {privacyConsent && (
                          <Check className="h-3 w-3 stroke-[2.75] animate-icon-pop" />
                        )}
                      </span>
                    </span>
                    <span className="font-solva-sans text-[11.5px] leading-[16.5px] text-[#56524A] dark:text-[#A8A296]">
                      {t('privacyCompliance.registerConsentPrefix')}
                      <Link
                        to="/privacy"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium text-[#1C1A15] dark:text-[#FBFAF6] underline underline-offset-4 decoration-[#1C1A15]/40 dark:decoration-[#FBFAF6]/40 hover:opacity-80 transition-opacity"
                      >
                        {t('privacyCompliance.policyLinkLabel')}
                      </Link>
                      {lang === 'vi' ? ' và ' : ' and '}
                      <Link
                        to="/terms"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium text-[#1C1A15] dark:text-[#FBFAF6] underline underline-offset-4 decoration-[#1C1A15]/40 dark:decoration-[#FBFAF6]/40 hover:opacity-80 transition-opacity"
                      >
                        {lang === 'vi' ? 'Điều khoản Dịch vụ' : 'Terms of Service'}
                      </Link>
                      {t('privacyCompliance.registerConsentSuffix')}{' '}
                      <span className="inline-flex items-center gap-1 font-mono text-[10px] font-semibold uppercase tracking-wider text-[#1C1A15] dark:text-[#FBFAF6] whitespace-nowrap">
                        <ShieldCheck className="h-3 w-3 text-emerald-600 dark:text-emerald-400 shrink-0" />
                        <span>
                          {lang === 'vi' ? '(Luật 91/2025/QH15)' : '(Law 91/2025/QH15)'}
                        </span>
                      </span>
                    </span>
                  </label>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  style={{
                    backgroundColor: 'var(--solva-btn-bg)',
                    color: 'var(--solva-btn-fg)',
                  }}
                  className="group relative w-full h-10 px-5 rounded-[10px] font-solva-sans text-[14px] font-medium flex items-center justify-center gap-2 shadow-sm hover:shadow-md transition-all duration-200 active:scale-[0.985] disabled:opacity-55 disabled:pointer-events-none cursor-pointer select-none"
                >
                  {loading ? (
                    <>
                      <div className="h-4 w-4 border-2 border-current/30 border-t-current rounded-full animate-spin" />
                      <span>{t('auth.creatingAccount')}</span>
                    </>
                  ) : (
                    <>
                      <span>{t('auth.createAccountBtn')}</span>
                      <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
                    </>
                  )}
                </button>
              </form>

              <GoogleAuthButton
                compact
                onError={(msg) => {
                  setInvalidField(null);
                  setError(msg ? formatUserError(msg, lang) : '');
                }}
                disabled={loading}
                beforeAuth={() => {
                  if (!privacyConsent) {
                    setInvalidField('privacy_consent');
                    setError(t('privacyCompliance.consentRequiredError'));
                    setConsentShake(false);
                    window.requestAnimationFrame(() => setConsentShake(true));
                    return false;
                  }
                  return true;
                }}
                googlePayloadExtras={{
                  privacy_consent: true,
                  privacy_policy_version: '1.0',
                }}
              />

              <div
                style={{
                  borderColor: 'var(--solva-border)',
                  color: 'var(--solva-muted)',
                }}
                className="mt-3 pt-2.5 border-t text-center font-solva-sans text-xs sm:text-[13px]"
              >
                <span>{t('auth.alreadyHaveAccount')} </span>
                <Link
                  to="/login"
                  style={{ color: 'var(--solva-ink)' }}
                  className="font-semibold underline underline-offset-4 decoration-[#1C1A15]/35 dark:decoration-[#FBFAF6]/35 hover:decoration-current transition-colors"
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
