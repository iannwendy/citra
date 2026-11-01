import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ThemeToggle } from '@/contexts/ThemeContext';
import {
  Shield,
  Quote,
  Database,
  GitBranch,
  ArrowLeft,
  Globe,
  Layers,
  Check,
  Circle,
} from 'lucide-react';

export function SourceLogicBrandMark({ size = 28 }: { size?: number }) {
  return (
    <img
      src="/citra-logo.png"
      alt="CITRA Logo"
      width={size}
      height={size}
      className="object-contain select-none dark:brightness-150 dark:drop-shadow-[0_0_2px_rgba(255,255,255,0.45)]"
    />
  );
}

interface AuthSplitShellProps {
  children: ReactNode;
  maxWidthClass?: string;
}

export function AuthSplitShell({
  children,
  maxWidthClass = 'max-w-[440px]',
}: AuthSplitShellProps) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language?.startsWith('vi') ? 'vi' : 'en';

  const toggleLanguage = () => {
    const next = lang === 'en' ? 'vi' : 'en';
    void i18n.changeLanguage(next);
  };

  const features = [
    {
      icon: Quote,
      title: t('auth.featureExtraction'),
      desc: t('auth.featureExtractionDesc'),
      tag: 'GROBID TEI · Layer 1',
      iconBox:
        'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
      tagBadge:
        'bg-emerald-50 text-emerald-700 border-emerald-200/70 dark:bg-emerald-950/70 dark:text-emerald-300 dark:border-emerald-800/70',
    },
    {
      icon: Database,
      title: t('auth.featureRetrieval'),
      desc: t('auth.featureRetrievalDesc'),
      tag: '127K ACL FTS5 + 6 APIs',
      iconBox:
        'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/20',
      tagBadge:
        'bg-indigo-50 text-indigo-700 border-indigo-200/70 dark:bg-indigo-950/70 dark:text-indigo-300 dark:border-indigo-800/70',
    },
    {
      icon: GitBranch,
      title: t('auth.featureVerification'),
      desc: t('auth.featureVerificationDesc'),
      tag: 'Rules R01–R12 · CIS',
      iconBox:
        'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
      tagBadge:
        'bg-amber-50 text-amber-700 border-amber-200/70 dark:bg-amber-950/70 dark:text-amber-300 dark:border-amber-800/70',
    },
  ];

  return (
    <div className="min-h-screen bg-slate-50/70 dark:bg-slate-950 text-slate-900 dark:text-slate-50 flex flex-col lg:flex-row selection:bg-indigo-500/20 selection:text-indigo-600 dark:selection:text-indigo-300">
      {/* ============================================================
          Left Panel — Scholarly Precision Architecture Showcase
          ============================================================ */}
      <div className="hidden lg:flex lg:w-[52%] xl:w-[55%] relative overflow-hidden bg-white dark:bg-slate-900 border-r border-slate-200/80 dark:border-slate-800/80 flex-col justify-between p-10 xl:p-14">
        {/* Architectural Dot-Grid + Radial Aura (Matches LandingPage) */}
        <div className="pointer-events-none absolute inset-0">
          <div
            className="absolute inset-0 opacity-55 dark:opacity-20"
            style={{
              backgroundImage:
                'radial-gradient(rgb(148 163 184 / 0.35) 1px, transparent 1px)',
              backgroundSize: '24px 24px',
            }}
          />
          <div className="absolute -top-24 -left-24 w-[520px] h-[380px] bg-gradient-to-tr from-indigo-500/15 via-indigo-400/5 to-emerald-500/10 blur-3xl rounded-full" />
          <div className="absolute bottom-0 right-0 w-[420px] h-[300px] bg-gradient-to-tl from-indigo-500/10 via-transparent to-transparent blur-2xl rounded-full" />
        </div>

        {/* Top Header: Brand Identity */}
        <div className="relative z-10 flex items-center justify-between gap-4">
          <Link
            to="/"
            className="inline-flex items-center gap-[8px] rounded-[6px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          >
            <span className="w-[28px] h-[28px] rounded-[7px] bg-white dark:bg-[#1E1C17] border border-[#E7E3D9] dark:border-[#332F26] shadow-2xs flex items-center justify-center p-1 shrink-0 transition-colors">
              <SourceLogicBrandMark size={18} />
            </span>
            <span className="font-solva-sans text-[20px] font-medium tracking-[-0.02em] leading-none text-[#1C1A15] dark:text-[#FBFAF6]">
              CITRA
            </span>
          </Link>
        </div>

        {/* Center Content: Headline + 3 Feature Pillars + Mini Debugger Trace */}
        <div className="relative z-10 my-auto py-8 space-y-6 max-w-xl">
          <div>
            <div className="inline-flex items-center gap-2 pl-2 pr-3 py-1 rounded-full bg-slate-100/90 dark:bg-slate-800/90 border border-slate-200/90 dark:border-slate-700/80 mb-4">
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold bg-indigo-600 text-white">
                <Layers className="h-3 w-3" />
                NEURO-SYMBOLIC
              </span>
              <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                {lang === 'vi'
                  ? 'Kiến trúc Kiểm chứng Trích dẫn Học thuật 2 Lớp'
                  : 'Two-Layer Academic Citation Debugger'}
              </span>
            </div>

            <h2 className="font-display text-3xl xl:text-4xl font-bold tracking-tight text-slate-900 dark:text-white leading-[1.12] mb-3.5">
              {t('auth.heroTitle1')}{' '}
              <br />
              <span className="bg-clip-text text-transparent bg-gradient-to-r from-indigo-600 via-indigo-500 to-emerald-600 dark:from-indigo-400 dark:via-indigo-300 dark:to-emerald-400">
                {t('auth.heroTitle2')}
              </span>
            </h2>
            <p className="text-sm xl:text-base text-slate-600 dark:text-slate-400 leading-relaxed">
              {t('auth.heroDesc')}
            </p>
          </div>

          {/* 3 Feature Cards */}
          <div className="space-y-3">
            {features.map((item) => {
              const Icon = item.icon;
              return (
                <div
                  key={item.title}
                  className="group p-3.5 rounded-2xl bg-slate-50/85 dark:bg-slate-950/60 border border-slate-200/80 dark:border-slate-800/90 hover:border-indigo-300 dark:hover:border-indigo-800 hover:bg-white dark:hover:bg-slate-900 transition-all shadow-2xs flex items-start gap-3.5"
                >
                  <div
                    className={`p-2.5 rounded-xl border shrink-0 mt-0.5 ${item.iconBox}`}
                  >
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <h3 className="font-display font-semibold text-slate-900 dark:text-white text-sm xl:text-base">
                        {item.title}
                      </h3>
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-mono font-semibold border ${item.tagBadge}`}
                      >
                        {item.tag}
                      </span>
                    </div>
                    <p className="text-xs xl:text-sm text-slate-600 dark:text-slate-400 mt-1 leading-relaxed">
                      {item.desc}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Mini Symbolic Rule Engine Trace Preview */}
          <div className="rounded-2xl bg-slate-900 dark:bg-slate-950 border border-slate-800 p-4 font-mono text-xs text-slate-300 shadow-lg">
            <div className="flex items-center justify-between pb-2.5 mb-2.5 border-b border-slate-800 text-[11px]">
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-red-400/80" />
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-400/80" />
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-400/80" />
                </div>
                <span className="text-slate-400 ml-1">
                  symbolic_verifier.py · Trace Preview
                </span>
              </div>
              <span className="px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 font-semibold">
                CIS: 84.5 / 100
              </span>
            </div>
            <div className="space-y-1.5 text-[11px] leading-relaxed">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-slate-300">
                  <span className="text-indigo-400 font-semibold">[1]</span>{' '}
                  Vaswani et al. (2017) ·{' '}
                  <span className="text-slate-400">R01_DOI_MATCH</span>
                </span>
                <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-semibold shrink-0">
                  VERIFIED
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-slate-300">
                  <span className="text-indigo-400 font-semibold">[4]</span>{' '}
                  Nguyen &amp; Tran (2021) ·{' '}
                  <span className="text-slate-400">R05_YEAR_DRIFT</span>
                </span>
                <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 font-semibold shrink-0">
                  YEAR_MISMATCH
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Bottom Footer: Decision-Support Note + Role Capabilities */}
        <div className="relative z-10 pt-4 border-t border-slate-200/80 dark:border-slate-800/80 flex items-center justify-between gap-4 text-xs text-slate-500 dark:text-slate-400">
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-indigo-600 dark:text-indigo-400 shrink-0" />
            <span>{t('auth.footerNote')}</span>
          </div>
          <div className="hidden xl:flex items-center gap-1.5 font-mono text-[11px]">
            <span className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
              Student
            </span>
            <span className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
              Teacher
            </span>
            <span className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
              Admin
            </span>
          </div>
        </div>
      </div>

      {/* ============================================================
          Right Panel — Executive Authentication Card (shadcn/ui)
          ============================================================ */}
      <div className="flex-1 flex flex-col justify-between p-3.5 sm:p-6 md:p-8 lg:p-10 xl:p-12 relative overflow-hidden">
        {/* Subtle ambient glow for right panel */}
        <div className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-indigo-500/5 dark:bg-indigo-500/10 blur-3xl rounded-full -z-10" />

        {/* Main Centered Container (First in DOM order so #password toggle is first SVG button) */}
        <div className={`order-2 my-auto w-full ${maxWidthClass} mx-auto py-3 sm:py-4`}>
          {children}
        </div>

        {/* Top Utility Navigation Bar (Visually at top via order-1, placed after form in DOM) */}
        <div
          className={`order-1 w-full ${maxWidthClass} lg:max-w-none mx-auto flex items-center justify-between gap-2`}
        >
          {/* Mobile Brand / Back to Home */}
          <div className="flex items-center gap-3 min-w-0">
            <Link
              to="/"
              className="lg:hidden inline-flex items-center gap-[8px] rounded-[6px] shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            >
              <span className="w-[28px] h-[28px] rounded-[7px] bg-white dark:bg-[#1E1C17] border border-[#E7E3D9] dark:border-[#332F26] shadow-2xs flex items-center justify-center p-1 shrink-0 transition-colors">
                <SourceLogicBrandMark size={18} />
              </span>
              <span className="font-solva-sans text-[20px] font-medium tracking-[-0.02em] leading-none text-[#1C1A15] dark:text-[#FBFAF6]">
                CITRA
              </span>
            </Link>

            <Link
              to="/"
              className="hidden lg:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200/60 dark:hover:bg-slate-800/70 transition-colors"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span>
                {lang === 'vi' ? 'Về trang giới thiệu' : 'Back to Overview'}
              </span>
            </Link>
          </div>

          {/* Right Utility Controls: Mobile Back Link + Language Switcher + ThemeToggle */}
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <Link
              to="/"
              className="lg:hidden inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200/60 dark:hover:bg-slate-800 transition-colors whitespace-nowrap"
            >
              <ArrowLeft className="h-3.5 w-3.5 shrink-0" />
              <span>{lang === 'vi' ? 'Trang chủ' : 'Home'}</span>
            </Link>

            <button
              type="button"
              onClick={toggleLanguage}
              className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-xs font-mono font-semibold text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer shadow-2xs"
              title={
                lang === 'vi' ? 'Switch to English' : 'Chuyển sang Tiếng Việt'
              }
            >
              <Globe className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />
              <span>{lang === 'vi' ? 'VI' : 'EN'}</span>
            </button>

            <ThemeToggle
              size="sm"
              className="h-8 w-8 bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 shadow-2xs"
            />
          </div>
        </div>

        {/* Bottom Subtle Workspace Note (order-3) */}
        <div
          className={`order-3 w-full ${maxWidthClass} mx-auto pt-2 flex items-center justify-between text-[11px] text-slate-400 dark:text-slate-500`}
        >
          <span>CITRA Workspace</span>
          <span className="font-mono">JWT · Capability RBAC</span>
        </div>
      </div>
    </div>
  );
}

export function PasswordStrengthIndicator({
  password,
  confirmPassword,
}: {
  password: string;
  confirmPassword: string;
}) {
  const { t } = useTranslation();

  const hasMinLen = password.length >= 6;
  const hasAlphaNum = /[a-zA-Z]/.test(password) && /\d/.test(password);
  const hasStrongLenOrSpecial =
    password.length >= 10 || /[^a-zA-Z0-9]/.test(password);
  const matches =
    password.length > 0 &&
    confirmPassword.length > 0 &&
    password === confirmPassword;

  let score = 0;
  if (hasMinLen) score += 1;
  if (hasAlphaNum) score += 1;
  if (hasStrongLenOrSpecial) score += 1;
  if (matches) score += 1;

  const strengthLabels = [
    t('auth.strengthWeak'),
    t('auth.strengthWeak'),
    t('auth.strengthFair'),
    t('auth.strengthGood'),
    t('auth.strengthStrong'),
  ];

  const barColors = [
    'bg-slate-200 dark:bg-slate-800',
    'bg-red-500',
    'bg-amber-500',
    'bg-indigo-500',
    'bg-emerald-500',
  ];

  const rules = [
    { label: t('auth.ruleMinLength'), met: hasMinLen },
    { label: t('auth.ruleUpperOrNum'), met: hasAlphaNum },
    { label: t('auth.ruleMatch'), met: matches },
  ];

  if (!password && !confirmPassword) {
    return null;
  }

  return (
    <div className="rounded-xl bg-slate-50/90 dark:bg-slate-950/70 border border-slate-200/80 dark:border-slate-800/80 p-3 space-y-2.5">
      <div className="flex items-center justify-between text-[11px] font-medium">
        <span className="text-slate-500 dark:text-slate-400">
          {t('auth.passwordStrength')}
        </span>
        <span className="font-mono font-semibold text-slate-700 dark:text-slate-300">
          {strengthLabels[score]}
        </span>
      </div>
      <div className="grid grid-cols-4 gap-1.5">
        {[1, 2, 3, 4].map((level) => (
          <div
            key={level}
            className={`h-1.5 rounded-full transition-colors ${
              score >= level
                ? barColors[score]
                : 'bg-slate-200 dark:bg-slate-800'
            }`}
          />
        ))}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5 pt-0.5">
        {rules.map((r) => (
          <div
            key={r.label}
            className={`flex items-center gap-1.5 text-[11px] ${
              r.met
                ? 'text-emerald-600 dark:text-emerald-400 font-medium'
                : 'text-slate-400 dark:text-slate-500'
            }`}
          >
            {r.met ? (
              <Check className="h-3 w-3 shrink-0" />
            ) : (
              <Circle className="h-2.5 w-2.5 shrink-0" />
            )}
            <span className="truncate">{r.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
