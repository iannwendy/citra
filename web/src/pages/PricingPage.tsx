import { useState, useEffect, useRef } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  SCHOLARLY_APIS_LABEL,
  SYMBOLIC_RULES_RANGE,
  isDemoEvaluatorMode,
} from '@/lib/productFacts';
import {
  Check,
  X,
  Sparkles,
  Zap,
  Building2,
  ShieldCheck,
  CreditCard,
  Loader2,
  ArrowLeft,
  HelpCircle,
  FileText,
  Layers,
  Database,
  CheckCircle2,
  AlertCircle,
  Globe,
  ChevronRight,
  Menu,
  Plus,
  Minus,
  FileSearch,
  GitBranch,
  Users,
  GraduationCap,
} from 'lucide-react';
import { api, type BillingCycle, type PlanTier } from '@/api/client';
import { useAuth } from '@/contexts/AuthContext';
import { useRole } from '@/hooks/useRole';
import { getQuotaView } from '@/lib/quotaDisplay';
import { formatUserError, resolveAcademicLang } from '@/lib/academicTaxonomy';
import { toSafeExternalHref } from '@/lib/utils';
import { ThemeToggle } from '@/contexts/ThemeContext';
import {
  CardHoverTilt,
  IconSwap,
  NumberPopIn,
  SoftTextSwap,
  SymmetricChevron,
  useSlidingPill,
  useExitPresence,
} from '@/components/ui/transitions';
import {
  type Lang,
  SolvaScrollReveal,
  SolvaEyebrow,
  SolvaTwoToneHeading,
  SolvaButton,
  SolvaPainterlyFrame,
  SolvaAnimatedMetric,
} from '@/components/landing/SolvaPrimitives';
import {
  BottomCTAMockup,
  CohortBatchAuditWidget,
} from '@/components/landing/SolvaMockupWidgets';
import {
  ScholarlySourceLogo,
  getScholarlySourceUrl,
} from '@/components/landing/ScholarlySourceLogos';

/* ============================================================
   CITRA (SourceLogic) — Warm Editorial SaaS Pricing & Plans Page
   1:1 Visual, Performance (120fps RAF) & Animation Parity with LandingPage
   3 Tiers: Basic ($0) · Pro ($20/mo | $16/mo annual) · Ultra ($200/mo | $160/mo annual)
   ============================================================ */

type LocalizedQuotaValue = boolean | { en: string; vi: string };

interface ComparisonRow {
  category_en: string;
  category_vi: string;
  basic: LocalizedQuotaValue;
  pro: LocalizedQuotaValue;
  ultra: LocalizedQuotaValue;
}

function resolveComparisonValue(value: LocalizedQuotaValue, lang: Lang): boolean | string {
  if (typeof value === 'boolean') return value;
  return lang === 'vi' ? value.vi : value.en;
}

const COMPARISON_MATRIX: ComparisonRow[] = [
  {
    category_en: 'Monthly Manuscript Checks (.PDF, .DOCX, .BIB, .RIS)',
    category_vi: 'Số lượt kiểm tra bản thảo (.PDF, .DOCX, .BIB, .RIS) / tháng',
    basic: { en: '3 manuscripts / mo', vi: '3 bản thảo / tháng' },
    pro: { en: '50 manuscripts / mo', vi: '50 bản thảo / tháng' },
    ultra: { en: 'Up to 1,000 / mo', vi: 'Tối đa 1.000 / tháng' },
  },
  {
    category_en: 'Maximum File Size per Upload',
    category_vi: 'Dung lượng tệp tải lên tối đa',
    basic: { en: '5 MB', vi: '5 MB' },
    pro: { en: '25 MB', vi: '25 MB' },
    ultra: { en: '100 MB', vi: '100 MB' },
  },
  {
    category_en: 'Maximum Pages per Manuscript',
    category_vi: 'Số trang tối đa mỗi bản thảo',
    basic: { en: '15 pages', vi: '15 trang' },
    pro: { en: '100 pages', vi: '100 trang' },
    ultra: { en: '500 pages', vi: '500 trang' },
  },
  {
    category_en: 'Citations Verified per Manuscript',
    category_vi: 'Số trích dẫn kiểm chứng mỗi tài liệu',
    basic: { en: 'Up to 30', vi: 'Tối đa 30 trích dẫn' },
    pro: { en: 'Up to 200', vi: 'Tối đa 200 trích dẫn' },
    ultra: { en: 'Unlimited', vi: 'Không giới hạn' },
  },
  {
    category_en: 'Simultaneous Multi-File Upload (.PDF / .DOCX)',
    category_vi: 'Tải lên và kiểm tra đồng thời nhiều tệp (.PDF / .DOCX)',
    basic: false,
    pro: { en: 'Up to 10 files', vi: 'Tối đa 10 tệp / lần' },
    ultra: { en: 'Up to 50 files', vi: 'Tối đa 50 tệp / lần' },
  },
  {
    category_en: 'Scholarly Indexes & Legal Registry',
    category_vi: 'Cơ sở dữ liệu học thuật & Văn bản Pháp luật VN',
    basic: {
      en: 'Crossref, OpenAlex & Vietnam Legal Registry',
      vi: 'Crossref, OpenAlex & Văn bản Pháp luật VN',
    },
    pro: {
      en: '15+ Scholarly Indexes (PubMed, arXiv, DOAJ, DBLP, DataCite, Wayback, Retraction Watch)',
      vi: '15+ CSDL học thuật quốc tế (PubMed, arXiv, DOAJ, DBLP, DataCite, Wayback, Retraction Watch)',
    },
    ultra: {
      en: 'All 15+ Indexes + Extended Google Scholar Discovery',
      vi: 'Toàn bộ 15+ CSDL + Tra cứu mở rộng Google Scholar',
    },
  },
  {
    category_en: 'Automated Bibliography Formatting (APA, IEEE, BibTeX, RIS)',
    category_vi: 'Tự động chuẩn hóa danh mục tham khảo (APA, IEEE, TDTU, BibTeX, RIS)',
    basic: false,
    pro: true,
    ultra: true,
  },
  {
    category_en: 'Deep Semantic Evidence & Claim Alignment',
    category_vi: 'Đối chiếu ngữ nghĩa sâu giữa câu trích dẫn và tài liệu gốc',
    basic: false,
    pro: true,
    ultra: true,
  },
  {
    category_en: 'Interactive PDF Source-to-Page Highlight Reader',
    category_vi: 'Trình đọc đối chiếu trang PDF & đánh dấu vị trí trích dẫn',
    basic: false,
    pro: true,
    ultra: true,
  },
  {
    category_en: 'Interactive Citation Network & Step-by-Step Reasoning',
    category_vi: 'Đồ thị mạng lưới trích dẫn & giải thích suy luận từng bước',
    basic: false,
    pro: true,
    ultra: true,
  },
  {
    category_en: 'Academic Report Export Formats',
    category_vi: 'Định dạng xuất báo cáo thẩm định',
    basic: { en: 'Interactive Web Report', vi: 'Báo cáo tương tác trực tuyến' },
    pro: {
      en: 'Word (DOCX), PDF, CSV, JSON, BibTeX, RIS',
      vi: 'Word (DOCX), PDF, CSV, JSON, BibTeX, RIS',
    },
    ultra: {
      en: 'Word, PDF, CSV, JSON, BibTeX, RIS + Full-Cohort Archive (.ZIP)',
      vi: 'Word, PDF, CSV, JSON, BibTeX, RIS + Trọn bộ cả lớp (.ZIP)',
    },
  },
  {
    category_en: 'Classroom Cohorts (CITRA-XXXX) & Instructor Review',
    category_vi: 'Quản lý lớp học (CITRA-XXXX), thống kê khóa luận & giảng viên duyệt kết luận',
    basic: { en: 'Join Classes via Code', vi: 'Tham gia lớp học bằng mã' },
    pro: {
      en: 'Up to 3 Cohorts + Analytics & Verdict Review',
      vi: 'Tối đa 3 lớp học + Thống kê & Duyệt kết luận',
    },
    ultra: {
      en: 'Unlimited Cohorts & Citation Review Log',
      vi: 'Không giới hạn lớp học & Nhật ký duyệt trích dẫn',
    },
  },
  {
    category_en: 'Verification Report History Retention',
    category_vi: 'Thời gian lưu trữ lịch sử báo cáo',
    basic: { en: '7 days', vi: '7 ngày' },
    pro: { en: '1 year', vi: '1 năm' },
    ultra: { en: 'Lifetime Retention', vi: 'Lưu trữ vĩnh viễn' },
  },
];

const FEDERATED_SOURCES = [
  'Crossref',
  'OpenAlex',
  'Semantic Scholar',
  'PubMed',
  'arXiv',
  'DBLP',
  'DOAJ',
  'DataCite',
  'Unpaywall',
  'ORCID',
  'Europe PMC',
  'Retraction Watch',
  'Wayback Machine',
  'IETF RFC',
  'VN Legal',
];

function SourceLogicLogo({ size = 24 }: { size?: number }) {
  return (
    <img
      src="/citra-logo.png"
      alt="CITRA Logo"
      width={size}
      height={size}
      loading="eager"
      decoding="async"
      className="object-contain select-none dark:brightness-150 dark:drop-shadow-[0_0_2px_rgba(255,255,255,0.45)]"
    />
  );
}

/* ============================================================
   SOLVA ACTION BUTTON WITHvertical SLOT-ROLL ANIMATION
   Supports native button disabled/loading states + testIds
   ============================================================ */
function SolvaPlanActionButton({
  children,
  variant = 'primary',
  disabled = false,
  onClick,
  testId,
}: {
  children: React.ReactNode;
  variant?: 'primary' | 'outline';
  disabled?: boolean;
  onClick?: () => void;
  testId?: string;
}) {
  const variantStyle =
    variant === 'primary'
      ? {
          backgroundColor: 'var(--solva-btn-bg)',
          color: 'var(--solva-btn-fg)',
        }
      : {
          backgroundColor: 'var(--solva-bg)',
          color: 'var(--solva-ink)',
          border: '1px solid var(--solva-border)',
        };

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      data-testid={testId}
      style={variantStyle}
      className={`group relative inline-flex items-center justify-center w-full max-w-full overflow-hidden h-[46px] px-3 sm:px-[16px] pt-[1px] rounded-[10px] font-solva-sans text-[13px] xl:text-[14px] font-medium leading-[21px] transition-[background-color,border-color,color,opacity,box-shadow] duration-200 select-none ${
        disabled ? 'opacity-55 cursor-not-allowed' : 'cursor-pointer hover:opacity-95'
      }`}
    >
      <span className="pointer-events-none relative h-[21px] max-w-full overflow-hidden flex flex-col items-center">
        <span
          className={`flex flex-col transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] ${
            disabled ? '' : 'group-hover:-translate-y-[21px]'
          }`}
        >
          <span className="h-[21px] flex items-center justify-center whitespace-nowrap gap-1.5">
            {children}
          </span>
          {!disabled && (
            <span
              className="h-[21px] flex items-center justify-center whitespace-nowrap gap-1.5"
              aria-hidden="true"
            >
              {children}
            </span>
          )}
        </span>
      </span>
    </button>
  );
}

export function PricingPage() {
  const { i18n } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const { planTier, quota, isAdmin } = useRole();

  const lang: Lang = resolveAcademicLang(i18n.language);
  const quotaView = getQuotaView(quota, lang, { isAdmin });
  // Admins always have Ultra-level access (contract C3): every checkout CTA is
  // disabled and Ultra is shown as the current plan.
  const adminLocked = Boolean(user && isAdmin);
  const [billingCycle, setBillingCycle] = useState<BillingCycle>('annual');
  const [loadingTier, setLoadingTier] = useState<'pro' | 'ultra' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canceled = searchParams.get('canceled') === '1';

  useEffect(() => {
    if (user?.billing_cycle === 'monthly' || user?.billing_cycle === 'annual') {
      setBillingCycle(user.billing_cycle);
    }
  }, [user?.billing_cycle]);

  const toggleLanguage = () => {
    const next = lang === 'en' ? 'vi' : 'en';
    void i18n.changeLanguage(next);
  };

  const handleSelectPlan = async (targetTier: PlanTier) => {
    if (adminLocked) return;
    if (targetTier === 'basic') {
      if (!user) {
        navigate('/register');
      } else {
        navigate('/upload');
      }
      return;
    }

    if (!user) {
      const checkoutTarget = `/billing/checkout?plan=${encodeURIComponent(targetTier)}&billing=${encodeURIComponent(billingCycle)}`;
      navigate(`/login?redirect=${encodeURIComponent(checkoutTarget)}`);
      return;
    }

    setLoadingTier(targetTier);
    setError(null);
    try {
      const session = await api.createCheckoutSession({
        plan_tier: targetTier,
        billing_cycle: billingCycle,
      });
      const safeCheckoutUrl = toSafeExternalHref(session.checkout_url);
      if (safeCheckoutUrl) {
        window.location.href = safeCheckoutUrl;
      } else if (
        session.checkout_url.startsWith('/') &&
        !session.checkout_url.startsWith('//')
      ) {
        navigate(session.checkout_url);
      } else {
        throw new Error('Invalid checkout redirect URL');
      }
    } catch (err) {
      setError(
        formatUserError(
          err,
          lang,
          lang === 'vi'
            ? 'Không thể khởi tạo phiên thanh toán. Vui lòng thử lại sau.'
            : 'Failed to create checkout session. Please try again.',
        ),
      );
    } finally {
      setLoadingTier(null);
    }
  };

  const proPrice = billingCycle === 'annual' ? 16 : 20;
  const ultraPrice = billingCycle === 'annual' ? 160 : 200;
  const demoEvaluatorMode = isDemoEvaluatorMode();
  const [mobileCompareTier, setMobileCompareTier] = useState<PlanTier>('pro');
  const { containerRef: billingToggleRef, pillStyle: billingPill } =
    useSlidingPill<HTMLDivElement>(billingCycle);
  const { containerRef: compareTabsRef, pillStyle: comparePill } =
    useSlidingPill<HTMLDivElement>(mobileCompareTier);
  const PricingMainTag = user ? 'div' : 'main';
  const isCurrentUltra = Boolean(
    user &&
      planTier === 'ultra' &&
      (!user.billing_cycle || user.billing_cycle === billingCycle),
  );
  const isCurrentPro = Boolean(
    user &&
      planTier === 'pro' &&
      (!user.billing_cycle || user.billing_cycle === billingCycle),
  );
  const tierGridClass = user
    ? 'w-full grid grid-cols-1 gap-y-[16px] xl:grid-cols-3 xl:gap-x-[16px] xl:gap-y-0 items-stretch'
    : 'w-full grid grid-cols-1 gap-y-[16px] lg:grid-cols-3 lg:gap-x-[16px] lg:gap-y-0 items-stretch';
  const subgridSpan5Class = user
    ? 'xl:row-span-5 xl:grid xl:grid-rows-subgrid'
    : 'lg:row-span-5 lg:grid lg:grid-rows-subgrid';
  const subgridBodyClass = user
    ? 'xl:gap-y-0 xl:row-span-4 xl:grid xl:grid-rows-subgrid'
    : 'lg:gap-y-0 lg:row-span-4 lg:grid lg:grid-rows-subgrid';
  const subgridRowPb18Class = user ? 'xl:pb-[18px]' : 'lg:pb-[18px]';
  const subgridRowPb20Class = user ? 'xl:pb-[20px]' : 'lg:pb-[20px]';
  const mobileCompareWrapClass = user ? 'lg:hidden' : 'md:hidden';
  const desktopCompareWrapClass = user ? 'hidden lg:block' : 'hidden md:block';

  return (
    <div
      lang={lang}
      data-lang={lang}
      className={`solva-editorial-root ${
        user ? 'rounded-[20px] pb-12' : 'min-h-screen overflow-x-clip'
      } selection:bg-[#1C1A15] selection:text-[#FBFAF6]`}
      data-testid="pricing-page"
    >
      {/* Accessible Skip-to-Content Link on Public View */}
      {!user && (
        <a
          href="#pricing-main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[100] focus:px-4 focus:py-2 focus:rounded-[10px] focus:bg-[#1C1A15] focus:text-[#FBFAF6] dark:focus:bg-[#FBFAF6] dark:focus:text-[#1C1A15] focus:shadow-lg font-solva-sans text-sm font-medium"
        >
          {lang === 'vi' ? 'Chuyển đến nội dung chính' : 'Skip to main content'}
        </a>
      )}

      {/* Fixed Solva Navbar when accessed publicly */}
      {!user && (
        <PricingSolvaHeader
          lang={lang}
          onToggleLanguage={toggleLanguage}
        />
      )}

      <PricingMainTag id="pricing-main-content">
        {/* ============================================================
            SECTION 1: HERO & INTERACTIVE BILLING CYCLE SELECTOR + 3 TIERS
            ============================================================ */}
        <section
          className={`${
            user
              ? 'pt-[12px] sm:pt-[18px] pb-[36px] sm:pb-[56px] px-3 sm:px-6'
              : 'pt-[74px] sm:pt-[84px] lg:pt-[92px] pb-[40px] sm:pb-[56px] lg:pb-[72px] px-5 sm:px-6 lg:px-[40px]'
          }`}
        >
          <div className="max-w-[1200px] mx-auto flex flex-col items-center gap-[20px] sm:gap-[24px] lg:gap-[28px]">
            {/* Hero Header */}
            <div className="flex flex-col items-center text-center gap-[10px] max-w-[760px]">
              <SolvaEyebrow centered>
                {lang === 'vi'
                  ? 'Bảng giá học thuật minh bạch · Thanh toán Stripe & VNPay'
                  : 'Transparent academic pricing · Powered by Stripe & VNPay'}
              </SolvaEyebrow>

              <h1
                className={`font-solva-serif font-light text-center mx-auto text-[30px] sm:text-[36px] xl:text-[42px] ${
                  lang === 'vi'
                    ? 'leading-[1.15] tracking-[-0.03em]'
                    : 'leading-[1.08] tracking-[-0.045em]'
                }`}
              >
                <span className="block" style={{ color: 'var(--solva-ink)' }}>
                  {lang === 'vi' ? (
                    <>
                      {'Đầu tư cho sự toàn vẹn '.normalize('NFC')}
                      <span className="whitespace-nowrap">{'khoa học.'.normalize('NFC')}</span>
                    </>
                  ) : (
                    'Invest in rigorous citation integrity.'
                  )}
                </span>{' '}
                <span className="block" style={{ color: 'var(--solva-muted)' }}>
                  {lang === 'vi' ? (
                    <>
                      {'Minh bạch chi phí, tối ưu mọi '.normalize('NFC')}
                      <span className="whitespace-nowrap">{'quy mô.'.normalize('NFC')}</span>
                    </>
                  ) : (
                    'Simple plans, built for every research scale.'
                  )}
                </span>
              </h1>

              <SolvaScrollReveal delayMs={60} yOffset={16}>
                <p
                  style={{ color: 'var(--solva-muted)' }}
                  className="font-solva-sans text-[14.5px] sm:text-[15px] font-normal leading-[22px] max-w-[660px]"
                >
                  {lang === 'vi'
                    ? 'Bắt đầu miễn phí với gói Basic cho tiểu luận môn học, hoặc nâng cấp lên Pro & Ultra để tra cứu hơn 15 cơ sở dữ liệu học thuật quốc tế (Crossref, OpenAlex, PubMed, arXiv, DOAJ, DataCite, Wayback Machine, Retraction Watch), đối chiếu ngữ nghĩa sâu giữa câu trích dẫn với tài liệu gốc và xuất báo cáo Word/PDF chuẩn hội đồng.'
                    : 'Start free with Basic for course essays, or upgrade to Pro & Ultra to cross-check citations across 15+ international scholarly indexes (Crossref, OpenAlex, PubMed, arXiv, DOAJ, DataCite, Wayback Machine, Retraction Watch), verify semantic alignment against source papers, and export Word/PDF reports ready for committee review.'}
                </p>
              </SolvaScrollReveal>

              {/* Current Plan Banner for Authenticated Users */}
              {user && (
                <SolvaScrollReveal delayMs={110} yOffset={16}>
                  <div
                    style={{
                      backgroundColor: 'var(--solva-surface)',
                      borderColor: 'var(--solva-border)',
                    }}
                    className="inline-flex flex-wrap items-center justify-center gap-3 px-4 py-2.5 rounded-[12px] border text-[13px] font-solva-sans"
                    data-testid="current-plan-banner"
                  >
                    <span style={{ color: 'var(--solva-muted)' }}>
                      {lang === 'vi' ? 'Gói hiện tại:' : 'Current Plan:'}
                    </span>
                    <span
                      style={{
                        backgroundColor: 'var(--solva-btn-bg)',
                        color: 'var(--solva-btn-fg)',
                      }}
                      className="px-2.5 py-0.5 rounded-[6px] font-mono text-[11px] font-semibold uppercase tracking-wide"
                    >
                      {planTier.toUpperCase()}
                    </span>
                    <span
                      style={{ color: 'var(--solva-ink)' }}
                      className="font-mono text-[12px]"
                    >
                      {quotaView.uploadsUnlimited
                        ? lang === 'vi'
                          ? `Lượt tải tháng: ${quotaView.usage}`
                          : `Monthly uploads: ${quotaView.usage}`
                        : lang === 'vi'
                          ? `Đã dùng ${quotaView.usage} tài liệu tháng này`
                          : `${quotaView.usage} uploads used this month`}
                    </span>
                    <Link
                      to="/settings"
                      style={{ color: 'var(--solva-muted)' }}
                      className="inline-flex items-center gap-1 underline underline-offset-4 hover:opacity-80 transition-opacity text-[12px]"
                    >
                      <span>{lang === 'vi' ? 'Quản lý gói' : 'Manage billing'}</span>
                      <ChevronRight className="w-3.5 h-3.5" />
                    </Link>
                  </div>
                  {adminLocked && (
                    <p
                      data-testid="admin-plan-note"
                      style={{ color: 'var(--solva-muted)' }}
                      className="mt-2 text-[12px] font-solva-sans max-w-[560px] mx-auto"
                    >
                      {lang === 'vi'
                        ? 'Tài khoản quản trị viên luôn có toàn quyền gói Ultra với hạn mức không giới hạn — không cần (và không thể) nâng cấp hay hạ cấp.'
                        : 'Administrator accounts always have full Ultra access with unlimited quota — upgrades and downgrades are not needed (or available).'}
                    </p>
                  )}
                </SolvaScrollReveal>
              )}

              {/* Billing Cycle Toggle (Segmented Solva Track + #16 Sliding Pill Indicator) */}
              <SolvaScrollReveal delayMs={130} yOffset={18}>
                <div className="pt-2 flex flex-col items-center gap-2.5">
                  <div
                    ref={billingToggleRef}
                    style={{
                      backgroundColor: 'var(--solva-surface)',
                      borderColor: 'var(--solva-border)',
                    }}
                    className="relative inline-flex max-w-full items-center p-[5px] rounded-[12px] border gap-1"
                    role="group"
                    aria-label="Billing cycle selector"
                  >
                    {billingPill.ready && (
                      <span
                        aria-hidden="true"
                        style={{
                          backgroundColor: 'var(--solva-btn-bg)',
                          width: `${billingPill.width}px`,
                          height: `${billingPill.height}px`,
                          transform: `translate3d(${billingPill.left}px, ${billingPill.top}px, 0)`,
                          transition: billingPill.animate ? undefined : 'none',
                        }}
                        className="t-tabs-pill rounded-[8px]"
                      />
                    )}
                    <button
                      type="button"
                      data-testid="billing-toggle-monthly"
                      aria-pressed={billingCycle === 'monthly'}
                      data-pill-active={billingCycle === 'monthly' ? 'true' : 'false'}
                      onClick={() => setBillingCycle('monthly')}
                      style={
                        billingCycle === 'monthly'
                          ? {
                              backgroundColor: billingPill.ready
                                ? 'transparent'
                                : 'var(--solva-btn-bg)',
                              color: 'var(--solva-btn-fg)',
                            }
                          : {
                              backgroundColor: 'transparent',
                              color: 'var(--solva-muted)',
                            }
                      }
                      className="t-tab px-3 sm:px-5 py-2 rounded-[8px] font-solva-sans text-[12px] sm:text-[14px] font-medium whitespace-nowrap cursor-pointer"
                    >
                      {lang === 'vi' ? (
                        <>
                          <span className="hidden sm:inline">Thanh toán theo Tháng</span>
                          <span className="sm:hidden">Theo Tháng</span>
                        </>
                      ) : (
                        <>
                          <span className="hidden sm:inline">Monthly Billing</span>
                          <span className="sm:hidden">Monthly</span>
                        </>
                      )}
                    </button>

                    <button
                      type="button"
                      data-testid="billing-toggle-annual"
                      aria-pressed={billingCycle === 'annual'}
                      data-pill-active={billingCycle === 'annual' ? 'true' : 'false'}
                      onClick={() => setBillingCycle('annual')}
                      style={
                        billingCycle === 'annual'
                          ? {
                              backgroundColor: billingPill.ready
                                ? 'transparent'
                                : 'var(--solva-btn-bg)',
                              color: 'var(--solva-btn-fg)',
                            }
                          : {
                              backgroundColor: 'transparent',
                              color: 'var(--solva-muted)',
                            }
                      }
                      className="t-tab px-3 sm:px-5 py-2 rounded-[8px] font-solva-sans text-[12px] sm:text-[14px] font-medium flex items-center gap-1.5 sm:gap-2 whitespace-nowrap cursor-pointer"
                    >
                      <span>
                        {lang === 'vi' ? (
                          <>
                            <span className="hidden sm:inline">Thanh toán theo Năm</span>
                            <span className="sm:hidden">Theo Năm</span>
                          </>
                        ) : (
                          <>
                            <span className="hidden sm:inline">Annual Billing</span>
                            <span className="sm:hidden">Annual</span>
                          </>
                        )}
                      </span>
                      <span className="px-2 py-0.5 rounded-[6px] bg-emerald-600 text-white text-[11px] font-mono font-semibold leading-none whitespace-nowrap shrink-0">
                        {lang === 'vi' ? 'Tiết kiệm 20%' : 'Save 20%'}
                      </span>
                    </button>
                  </div>

                  <p className="font-solva-sans text-[13px] text-emerald-700 dark:text-emerald-400 font-medium">
                    <SoftTextSwap
                      align="center"
                      text={
                        billingCycle === 'annual'
                          ? lang === 'vi'
                            ? '✨ Đang áp dụng ưu đãi trả theo năm: Tiết kiệm 20% (tương đương hơn 2 tháng miễn phí)!'
                            : '✨ Annual discount active: Equivalent to over 2 months free!'
                          : lang === 'vi'
                            ? '💡 Mẹo: Chuyển sang gói theo Năm để tiết kiệm ngay $48/năm (Pro) hoặc $480/năm (Ultra).'
                            : '💡 Tip: Switch to Annual billing to save $48/year on Pro or $480/year on Ultra.'
                      }
                    />
                  </p>
                </div>
              </SolvaScrollReveal>
            </div>

            {/* Canceled / Error Alerts */}
            {canceled && (
              <div className="w-full max-w-[680px] p-4 rounded-[12px] bg-amber-50/90 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 flex items-center gap-3 font-solva-sans text-[14px] text-amber-900 dark:text-amber-200">
                <AlertCircle className="h-5 w-5 shrink-0 text-amber-600" />
                <span>
                  {lang === 'vi'
                    ? 'Phiên thanh toán đã được hủy. Bạn có thể chọn lại gói cước bất cứ lúc nào.'
                    : 'Checkout was canceled. You can select a plan again whenever you are ready.'}
                </span>
              </div>
            )}

            {error && (
              <div className="w-full max-w-[680px] p-4 rounded-[12px] bg-red-50/90 dark:bg-red-950/40 border border-red-200 dark:border-red-800 flex items-center gap-3 font-solva-sans text-[14px] text-red-800 dark:text-red-300">
                <AlertCircle className="h-5 w-5 shrink-0 text-red-600" />
                <span>{error}</span>
              </div>
            )}

            {/* ============================================================
                3 SOLVA EDITORIAL PRICING CARDS (Basic · Pro Floral · Ultra)
                5-Row CSS Subgrid Alignment + High-Contrast Pro Body Surface
                ============================================================ */}
            <div className={tierGridClass}>
              {/* 1. BASIC TIER */}
              <SolvaScrollReveal
                delayMs={0}
                yOffset={36}
                triggerRatio={0.99}
                className={`h-full ${subgridSpan5Class}`}
              >
                <div
                  style={{
                    backgroundColor: 'var(--solva-surface)',
                    borderColor: 'var(--solva-border)',
                  }}
                  className={`relative rounded-[16px] border p-[8px] sm:p-[10px] flex flex-col overflow-hidden h-full ${subgridSpan5Class}`}
                  data-testid="plan-card-basic"
                >
                  {/* Row 1: Top Architectural Gallery Header Band */}
                  <div className="relative min-h-[100px] sm:min-h-[104px] rounded-t-[11px] px-4 sm:px-5 py-3.5 flex flex-col justify-between bg-gradient-to-b from-[#ECE9E0]/90 via-[#F4F2EC]/55 to-transparent dark:from-[#26231C]/90 dark:via-[#1E1C17]/55 dark:to-transparent">
                    <div className="flex items-start justify-between gap-x-2 gap-y-2 flex-wrap">
                      <span
                        style={{
                          backgroundColor: 'var(--solva-bg)',
                          borderColor: 'var(--solva-border)',
                          color: 'var(--solva-muted)',
                        }}
                        className="inline-flex items-center px-2.5 py-1 rounded-[6px] border font-mono text-[11px] font-medium leading-none whitespace-nowrap shrink-0"
                      >
                        {lang === 'vi' ? 'MẶC ĐỊNH' : 'DEFAULT'}
                      </span>
                    </div>
                    <span
                      style={{ color: 'var(--solva-muted)' }}
                      className="font-mono text-[11px] uppercase tracking-wider whitespace-nowrap"
                    >
                      {lang === 'vi' ? '01 · KHỞI ĐẦU MIỄN PHÍ' : '01 · FREE STARTER'}
                    </span>
                  </div>

                  {/* Rows 2..5: Card Body Surface */}
                  <div
                    style={{
                      backgroundColor: 'var(--solva-bg)',
                      borderColor: 'var(--solva-border)',
                    }}
                    className={`relative z-10 rounded-[12px] border px-[20px] sm:px-[24px] py-[22px] sm:py-[24px] flex flex-col justify-between gap-[20px] flex-1 ${subgridBodyClass}`}
                  >
                    {/* Row 2: Header & Description */}
                    <div className={`space-y-[14px] ${subgridRowPb18Class}`}>
                      <div className="flex items-center gap-3">
                        <div
                          style={{
                            backgroundColor: 'var(--solva-surface)',
                            borderColor: 'var(--solva-border)',
                            color: 'var(--solva-ink)',
                          }}
                          className="w-[40px] h-[40px] rounded-[10px] border flex items-center justify-center shrink-0"
                        >
                          <FileText className="w-[18px] h-[18px]" />
                        </div>
                        <div>
                          <h2
                            style={{ color: 'var(--solva-ink)' }}
                            className="font-solva-sans text-[22px] font-medium leading-tight tracking-[-0.02em]"
                          >
                            Basic
                          </h2>
                          <p
                            style={{ color: 'var(--solva-muted)' }}
                            className="font-solva-sans text-[13px] mt-0.5"
                          >
                            {lang === 'vi'
                              ? 'Gói mặc định cho Sinh viên'
                              : 'Default Student Starter'}
                          </p>
                        </div>
                      </div>

                      <p
                        style={{ color: 'var(--solva-muted)' }}
                        className="font-solva-sans text-[15px] leading-[22.5px]"
                      >
                        {lang === 'vi'
                          ? 'Phù hợp để làm quen hệ thống và rà soát nhanh các bài tập, tiểu luận môn học ngắn.'
                          : 'Ideal for exploring the platform and checking short course essays & literature drafts.'}
                      </p>
                    </div>

                    {/* Row 3: Price Display (`Sentient` 44px Light + Prominent VND in VI) */}
                    <div
                      style={{ borderColor: 'var(--solva-border)' }}
                      className={`pt-[16px] ${subgridRowPb18Class} border-t`}
                    >
                      <div className="flex items-baseline gap-1.5 flex-wrap">
                        <span
                          style={{ color: 'var(--solva-ink)' }}
                          className={`font-solva-serif font-light leading-[44px] ${
                            lang === 'vi'
                              ? 'text-[34px] sm:text-[38px] tracking-[-0.03em]'
                              : 'text-[40px] sm:text-[44px] tracking-[-0.05em]'
                          }`}
                        >
                          {lang === 'vi' ? '0 ₫' : '$0'}
                        </span>
                        <span
                          style={{ color: 'var(--solva-muted)' }}
                          className="font-solva-sans text-[14px]"
                        >
                          / {lang === 'vi' ? 'tháng' : 'month'}
                        </span>
                      </div>
                      <p
                        style={{ color: 'var(--solva-muted)' }}
                        className="font-mono text-[12px] mt-1"
                      >
                        {lang === 'vi'
                          ? '$0 USD · Miễn phí trọn đời · Không cần thẻ'
                          : 'Free forever · No credit card required'}
                      </p>
                      {lang === 'vi' && (
                        <p
                          style={{ color: 'var(--solva-muted)' }}
                          className="font-mono text-[12px] mt-1"
                        >
                          <span className="whitespace-nowrap">0 ₫/tháng</span> ·{' '}
                          <span className="whitespace-nowrap">Khởi tạo tức thì</span>
                        </p>
                      )}
                    </div>

                    {/* Row 4: Features Checklist (Constructive Basic Framing) */}
                    <div className={`space-y-[10px] pt-1 ${subgridRowPb20Class}`}>
                      <p
                        style={{ color: 'var(--solva-ink)' }}
                        className="font-mono text-[11px] font-semibold uppercase tracking-wider"
                      >
                        {lang === 'vi' ? 'Quyền lợi bao gồm:' : 'Included features:'}
                      </p>
                      <ul className="space-y-[9px]">
                        {(lang === 'vi'
                          ? [
                              '3 lượt kiểm tra bản thảo (.PDF, .DOCX, .BIB, .RIS) / tháng',
                              'Dung lượng tối đa 5 MB / tệp tải lên',
                              'Tối đa 15 trang & 30 trích dẫn mỗi tài liệu',
                              'Tự động đối chiếu trích dẫn trong bài với danh mục tham khảo',
                              'Xác thực xuất bản qua Crossref, OpenAlex & Văn bản Pháp luật VN',
                              'Điểm toàn vẹn trích dẫn & phân loại chi tiết từng lỗi sai lệch',
                            ]
                          : [
                              '3 manuscript checks (.PDF, .DOCX, .BIB, .RIS) / month',
                              'Maximum 5 MB file size per upload',
                              'Up to 15 pages & 30 citations per document',
                              'Automated in-text to bibliography cross-checking',
                              'Verified against Crossref, OpenAlex & Vietnam Legal Registry',
                              'Citation integrity score & structured issue breakdown',
                            ]
                        ).map((feat) => (
                          <li
                            key={feat}
                            className="flex items-start gap-[9px] font-solva-sans text-[14px] leading-[21px]"
                          >
                            <CheckCircle2 className="w-[16px] h-[16px] text-emerald-600 dark:text-emerald-400 mt-[2.5px] shrink-0" />
                            <span style={{ color: 'var(--solva-ink)' }}>{feat}</span>
                          </li>
                        ))}
                        {(lang === 'vi'
                          ? [
                              'Báo cáo trực tuyến đầy đủ · Mở khóa xuất Word/PDF ở gói Pro',
                              'Bảng tổng hợp kết luận · Mở khóa đối chiếu trang PDF ở gói Pro',
                              'Kiểm tra từng bản thảo · Mở khóa tải nhiều tệp cùng lúc ở gói Pro',
                            ]
                          : [
                              'Web verification report included (Word/PDF export on Pro)',
                              'Summary verdict table included (interactive PDF reader on Pro)',
                              'Single-manuscript check per upload (multi-file upload on Pro)',
                            ]
                        ).map((item) => (
                          <li
                            key={item}
                            style={{ color: 'var(--solva-muted)' }}
                            className="flex items-start gap-[9px] font-solva-sans text-[14px] leading-[21px]"
                          >
                            <CheckCircle2 className="w-[16px] h-[16px] mt-[2.5px] shrink-0 opacity-75" />
                            <span>{item}</span>
                          </li>
                        ))}
                      </ul>
                    </div>

                    {/* Row 5: Action Button */}
                    <div
                      style={{ borderColor: 'var(--solva-border)' }}
                      className="pt-[18px] border-t flex items-end"
                    >
                      <SolvaPlanActionButton
                        variant="outline"
                        disabled={
                          adminLocked ||
                          Boolean(user && (planTier === 'basic' || planTier === 'pro' || planTier === 'ultra'))
                        }
                        onClick={() => handleSelectPlan('basic')}
                        testId="select-basic-btn"
                      >
                        {adminLocked
                          ? lang === 'vi'
                            ? 'Mở sẵn cho Quản trị'
                            : 'Included with Admin'
                          : user && (planTier === 'pro' || planTier === 'ultra')
                            ? lang === 'vi'
                              ? 'Đã bao gồm trong gói của bạn'
                              : 'Included in your plan'
                            : user && planTier === 'basic'
                              ? lang === 'vi'
                                ? 'Đang sử dụng gói Basic'
                                : 'Current Active Plan'
                              : lang === 'vi'
                                ? 'Bắt đầu miễn phí'
                                : 'Get Started Free'}
                      </SolvaPlanActionButton>
                    </div>
                  </div>
                </div>
              </SolvaScrollReveal>

              {/* 2. PRO TIER (CENTER HIGHLIGHTED — FRAMED FLORAL GALLERY HEADER + .solva-pro-card-surface + #19 CardHoverTilt) */}
              <SolvaScrollReveal
                delayMs={95}
                yOffset={36}
                triggerRatio={0.99}
                className={`h-full ${subgridSpan5Class}`}
              >
                <CardHoverTilt
                  maxTilt={3.5}
                  className={`h-full ${subgridSpan5Class}`}
                  cardClassName={`h-full rounded-[16px] ${subgridSpan5Class}`}
                >
                  <div
                    style={{
                      backgroundColor: 'var(--solva-surface)',
                      borderColor: 'var(--solva-ink)',
                    }}
                    className={`relative rounded-[16px] border-2 p-[8px] sm:p-[10px] flex flex-col overflow-hidden h-full shadow-[0_12px_36px_rgba(28,26,21,0.08)] ${subgridSpan5Class}`}
                    data-testid="plan-card-pro"
                  >
                    {/* Row 1: Top Gallery Floral Painting Banner (`/solva/pricing-floral.webp`) */}
                    <div className="relative min-h-[100px] sm:min-h-[104px] rounded-t-[11px] overflow-hidden px-3.5 sm:px-4 py-3.5 flex flex-col justify-between">
                      <div
                        className="solva-floral-banner-mask absolute inset-0 pointer-events-none select-none z-0"
                        aria-hidden="true"
                      >
                        <img
                          src="/solva/pricing-floral.webp"
                          alt=""
                          loading="eager"
                          decoding="async"
                          {...({ fetchpriority: 'low' } as Record<string, string>)}
                          className="w-full h-full object-cover object-center"
                        />
                      </div>
                      <div className="solva-noise-overlay z-0" aria-hidden="true" />

                      <div className="relative z-10 flex items-center justify-between gap-x-1.5 gap-y-2 flex-wrap">
                        <span
                          style={{
                            backgroundColor: '#1C1A15',
                            color: '#FBFAF6',
                          }}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-[6px] border border-white/15 shadow-sm font-mono text-[10px] font-semibold leading-none tracking-tight whitespace-nowrap shrink-0"
                        >
                          <Sparkles className="w-3 h-3 shrink-0" />
                          <span>
                            {lang === 'vi' ? '02 · PHỔ BIẾN NHẤT' : '02 · MOST POPULAR'}
                          </span>
                        </span>
                        {billingCycle === 'annual' && (
                          <span className="inline-flex items-center px-2 py-1 rounded-[6px] bg-[#FBFAF6] text-emerald-800 border border-emerald-700/25 dark:bg-[#141310] dark:text-emerald-300 dark:border-emerald-400/30 shadow-sm font-mono text-[10px] font-semibold leading-none whitespace-nowrap shrink-0">
                            {lang === 'vi' ? 'Tiết kiệm $48/năm' : 'Save $48/yr'}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Rows 2..5: High-Contrast Pro Card Surface (WCAG AAA in Light & Dark) */}
                    <div
                      className={`solva-pro-card-surface relative z-10 rounded-[12px] px-[20px] sm:px-[24px] py-[22px] sm:py-[24px] flex flex-col justify-between gap-[20px] flex-1 ${subgridBodyClass}`}
                    >
                      {/* Row 2: Header & Description */}
                      <div className={`space-y-[14px] ${subgridRowPb18Class}`}>
                        <div className="flex items-center gap-3">
                          <div
                            style={{
                              backgroundColor: 'var(--solva-btn-bg)',
                              color: 'var(--solva-btn-fg)',
                            }}
                            className="w-[40px] h-[40px] rounded-[10px] flex items-center justify-center shrink-0 shadow-sm"
                          >
                            <Zap className="w-[18px] h-[18px]" />
                          </div>
                          <div>
                            <h2
                              style={{ color: 'var(--solva-ink)' }}
                              className="font-solva-sans text-[22px] font-medium leading-tight tracking-[-0.02em]"
                            >
                              Pro
                            </h2>
                            <p
                              style={{ color: 'var(--solva-muted)' }}
                              className="font-solva-sans text-[13px] mt-0.5 font-medium"
                            >
                              {lang === 'vi'
                                ? 'Nghiên cứu sinh, Luận văn & Giảng viên'
                                : 'Thesis Writers, Researchers & Lecturers'}
                            </p>
                          </div>
                        </div>

                        <p
                          style={{ color: 'var(--solva-muted)' }}
                          className="font-solva-sans text-[15px] leading-[22.5px]"
                        >
                          {lang === 'vi'
                            ? 'Thẩm định toàn diện khóa luận, luận văn thạc sĩ và bài báo khoa học với hơn 15 nguồn học thuật quốc tế cùng xuất báo cáo chuẩn hội đồng.'
                            : 'Comprehensive citation verification across 15+ scholarly indexes for full-length theses, research manuscripts, and faculty grading.'}
                        </p>
                      </div>

                      {/* Row 3: Price Display (`Sentient` Light + Prominent VND in VI + USD Subtext) */}
                      <div
                        style={{ borderColor: 'var(--solva-border)' }}
                        className={`pt-[16px] ${subgridRowPb18Class} border-t`}
                      >
                        {lang === 'vi' ? (
                          <>
                            <div className="flex items-baseline gap-1.5 flex-wrap">
                              <span
                                style={{ color: 'var(--solva-ink)' }}
                                className="font-solva-serif font-light text-[34px] sm:text-[38px] leading-[44px] tracking-[-0.03em] whitespace-nowrap"
                              >
                                <NumberPopIn
                                  value={billingCycle === 'annual' ? '400.000 ₫' : '500.000 ₫'}
                                />
                              </span>
                              <span
                                style={{ color: 'var(--solva-muted)' }}
                                className="font-solva-sans text-[14px] whitespace-nowrap"
                              >
                                / tháng
                              </span>
                            </div>
                            <div className="flex items-baseline gap-2 flex-wrap mt-1">
                              <span
                                style={{ color: 'var(--solva-ink)' }}
                                className="font-mono text-[13px] font-semibold"
                                data-testid="pro-price-display"
                              >
                                <NumberPopIn value={`$${proPrice}`} />
                              </span>
                              <span
                                style={{ color: 'var(--solva-muted)' }}
                                className="font-mono text-[12px]"
                              >
                                USD / tháng
                              </span>
                              {billingCycle === 'annual' && (
                                <span
                                  style={{ color: 'var(--solva-muted)' }}
                                  className="text-[12px] line-through font-mono"
                                >
                                  $20
                                </span>
                              )}
                            </div>
                          </>
                        ) : (
                          <div className="flex items-baseline gap-2 flex-wrap">
                            <span
                              style={{ color: 'var(--solva-ink)' }}
                              className="font-solva-serif font-light text-[40px] sm:text-[44px] leading-[48px] tracking-[-0.05em]"
                              data-testid="pro-price-display"
                            >
                              <NumberPopIn value={`$${proPrice}`} />
                            </span>
                            <span
                              style={{ color: 'var(--solva-muted)' }}
                              className="font-solva-sans text-[14px]"
                            >
                              / month
                            </span>
                            {billingCycle === 'annual' && (
                              <span
                                style={{ color: 'var(--solva-muted)' }}
                                className="text-[14px] line-through font-mono"
                              >
                                $20
                              </span>
                            )}
                          </div>
                        )}
                        <p
                          style={{ color: 'var(--solva-muted)' }}
                          className="font-mono text-[12px] mt-1"
                        >
                          {billingCycle === 'annual'
                            ? lang === 'vi'
                              ? 'Thanh toán $192/năm (Tiết kiệm $48/năm — Giảm 20%)'
                              : 'Billed $192 annually ($16/mo equivalent — Save 20%)'
                            : lang === 'vi'
                              ? 'Thanh toán $20 định kỳ hàng tháng (Hoặc $16/tháng khi trả năm)'
                              : 'Billed $20 monthly (Or $16/mo when billed annually)'}
                        </p>
                        {lang === 'vi' && (
                          <p
                            data-testid="pro-vnd-equivalent"
                            style={{ color: 'var(--solva-ink)' }}
                            className="font-mono text-[12px] font-medium mt-1"
                          >
                            {billingCycle === 'annual' ? (
                              <>
                                <span className="whitespace-nowrap">400.000 ₫/tháng</span> ·{' '}
                                <span className="whitespace-nowrap">4.800.000 ₫/năm</span>{' '}
                                <span className="whitespace-nowrap">qua VNPay</span>
                              </>
                            ) : (
                              <>
                                <span className="whitespace-nowrap">500.000 ₫/tháng</span>{' '}
                                <span className="whitespace-nowrap">qua VNPay &amp; thẻ quốc tế</span>
                              </>
                            )}
                          </p>
                        )}
                      </div>

                      {/* Row 4: Features Checklist */}
                      <div className={`space-y-[10px] pt-1 ${subgridRowPb20Class}`}>
                        <p
                          style={{ color: 'var(--solva-ink)' }}
                          className="font-mono text-[11px] font-semibold uppercase tracking-wider"
                        >
                          {lang === 'vi'
                            ? 'Mọi tính năng Basic, cộng thêm:'
                            : 'Everything in Basic, plus:'}
                        </p>
                        <ul className="space-y-[9px]">
                          {(lang === 'vi'
                            ? [
                                '50 lượt kiểm tra (.PDF, .DOCX, .BIB, .RIS) mỗi tháng (gấp 16 lần gói Basic)',
                                'Tối đa 25 MB & 100 trang / bài (trọn vẹn Khóa luận & Luận văn Thạc sĩ)',
                                'Kiểm chứng tới 200 trích dẫn / bài & tải lên đồng thời 10 tệp',
                                'Tra cứu hơn 15 cơ sở dữ liệu học thuật quốc tế (PubMed, arXiv, DOAJ, DBLP, DataCite...)',
                                'Cảnh báo bài báo bị rút hồi (Retraction Watch) & khôi phục liên kết hỏng qua Wayback Machine',
                                'Đối chiếu ngữ nghĩa sâu giữa câu trích dẫn và nội dung tài liệu gốc',
                                'Kiểm chứng trích dẫn chéo đa ngôn ngữ (Tiếng Việt ↔ Tiếng Anh)',
                                'Mở khóa trình đọc đối chiếu trang PDF, giải thích suy luận & đồ thị trích dẫn',
                                'Tự động chuẩn hóa danh mục (APA, IEEE, BibTeX) & xuất báo cáo Word, PDF, CSV, JSON',
                                'Quản lý tới 3 lớp học & quyền giảng viên điều chỉnh kết luận thẩm định',
                              ]
                            : [
                                '50 manuscript checks (.PDF, .DOCX, .BIB, .RIS) / month (16× Basic)',
                                'Up to 25 MB & 100 pages per document (Full Bachelor & Master Theses)',
                                'Up to 200 citations per document & multi-file upload (up to 10 files)',
                                'Full 15+ scholarly indexes (PubMed, arXiv, DOAJ, DBLP, DataCite & Europe PMC)',
                                'Retracted paper alerts (Retraction Watch) & broken URL archive recovery (Wayback Machine)',
                                'Deep semantic evidence matching between cited claims and source papers',
                                'Cross-lingual citation verification (Vietnamese ↔ English)',
                                'Interactive PDF source-to-page reader, step-by-step reasoning & citation graph',
                                'Automated bibliography formatting (APA, IEEE, BibTeX) & Word, PDF, CSV, JSON export',
                                'Manage up to 3 classroom cohorts & instructor verdict review',
                              ]
                          ).map((feat) => (
                            <li
                              key={feat}
                              className="flex items-start gap-[9px] font-solva-sans text-[14px] leading-[21px]"
                            >
                              <CheckCircle2
                                style={{ color: 'var(--solva-ink)' }}
                                className="w-[16px] h-[16px] mt-[2.5px] shrink-0"
                              />
                              <span
                                style={{ color: 'var(--solva-ink)' }}
                                className="font-medium"
                              >
                                {feat}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>

                      {/* Row 5: Action Button */}
                      <div
                        style={{ borderColor: 'var(--solva-border)' }}
                        className="pt-[18px] border-t flex items-end"
                      >
                        <SolvaPlanActionButton
                          variant="primary"
                          disabled={
                            adminLocked ||
                            loadingTier !== null ||
                            isCurrentPro ||
                            Boolean(user && planTier === 'ultra')
                          }
                          onClick={() => handleSelectPlan('pro')}
                          testId="select-pro-btn"
                        >
                          {loadingTier === 'pro' ? (
                            <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                          ) : (
                            <CreditCard className="h-4 w-4 shrink-0" />
                          )}
                          <span>
                            {adminLocked ? (
                              lang === 'vi' ? (
                                'Mở sẵn cho Quản trị'
                              ) : (
                                'Included with Admin'
                              )
                            ) : user && planTier === 'ultra' ? (
                              lang === 'vi' ? (
                                <>
                                  Đã bao gồm{' '}
                                  <span className="hidden 2xl:inline">trong </span>gói Ultra
                                </>
                              ) : (
                                <>
                                  Included in Ultra
                                  <span className="hidden 2xl:inline"> Plan</span>
                                </>
                              )
                            ) : isCurrentPro ? (
                              lang === 'vi' ? (
                                <>
                                  Đang sử dụng gói Pro
                                  <span className="hidden 2xl:inline"> này</span>
                                </>
                              ) : (
                                <>
                                  Current <span className="hidden 2xl:inline">Active </span>
                                  Pro Plan
                                </>
                              )
                            ) : user && planTier === 'pro' ? (
                              billingCycle === 'monthly' ? (
                                lang === 'vi' ? (
                                  'Chuyển sang gói Tháng'
                                ) : (
                                  'Switch to Monthly'
                                )
                              ) : lang === 'vi' ? (
                                'Chuyển sang gói Năm (-20%)'
                              ) : (
                                'Switch to Annual (-20%)'
                              )
                            ) : lang === 'vi' ? (
                              <>
                                Nâng cấp lên Pro
                                <span className="hidden 2xl:inline">
                                  {` · $${
                                    billingCycle === 'annual' ? '192/năm' : '20/tháng'
                                  }`}
                                </span>
                              </>
                            ) : (
                              <>
                                Upgrade to Pro
                                <span className="hidden 2xl:inline">
                                  {` · $${billingCycle === 'annual' ? '192/yr' : '20/mo'}`}
                                </span>
                              </>
                            )}
                          </span>
                        </SolvaPlanActionButton>
                      </div>
                    </div>
                  </div>
                </CardHoverTilt>
              </SolvaScrollReveal>

              {/* 3. ULTRA TIER */}
              <SolvaScrollReveal
                delayMs={190}
                yOffset={36}
                triggerRatio={0.99}
                className={`h-full ${subgridSpan5Class}`}
              >
                <div
                  style={{
                    backgroundColor: 'var(--solva-surface)',
                    borderColor: 'var(--solva-border)',
                  }}
                  className={`relative rounded-[16px] border p-[8px] sm:p-[10px] flex flex-col overflow-hidden h-full ${subgridSpan5Class}`}
                  data-testid="plan-card-ultra"
                >
                  {/* Row 1: Top Architectural Gallery Header Band */}
                  <div className="relative min-h-[100px] sm:min-h-[104px] rounded-t-[11px] px-3.5 sm:px-4 py-3.5 flex flex-col justify-between bg-gradient-to-b from-[#E8E3D6]/95 via-[#F4F2EC]/55 to-transparent dark:from-[#2A261E]/95 dark:via-[#1E1C17]/55 dark:to-transparent">
                    <div className="flex items-center justify-between gap-x-1.5 gap-y-2 flex-wrap">
                      <span
                        style={{
                          backgroundColor: 'var(--solva-bg)',
                          borderColor: 'var(--solva-border)',
                          color: 'var(--solva-muted)',
                        }}
                        className="inline-flex items-center px-2 py-1 rounded-[6px] border font-mono text-[10px] font-medium leading-none whitespace-nowrap shrink-0"
                      >
                        {lang === 'vi' ? 'QUY MÔ LỚN' : 'ENTERPRISE LAB'}
                      </span>
                      {billingCycle === 'annual' ? (
                        <span className="inline-flex items-center px-2 py-1 rounded-[6px] bg-[#FBFAF6] text-emerald-800 border border-emerald-700/25 dark:bg-[#141310] dark:text-emerald-300 dark:border-emerald-400/30 shadow-sm font-mono text-[10px] font-semibold leading-none whitespace-nowrap shrink-0">
                          {lang === 'vi' ? 'Tiết kiệm $480/năm' : 'Save $480/yr'}
                        </span>
                      ) : user && planTier === 'ultra' && user.billing_cycle === 'annual' ? (
                        <span className="inline-flex items-center px-2 py-1 rounded-[6px] bg-emerald-500/[0.12] text-emerald-800 border border-emerald-700/25 dark:text-emerald-300 dark:border-emerald-400/30 font-mono text-[10px] font-semibold leading-none whitespace-nowrap shrink-0">
                          {lang === 'vi' ? 'Đang dùng gói Ultra (Năm)' : 'Active: Ultra (Annual)'}
                        </span>
                      ) : null}
                    </div>
                    <span
                      style={{ color: 'var(--solva-muted)' }}
                      className="font-mono text-[11px] uppercase tracking-wider whitespace-nowrap"
                    >
                      {lang === 'vi' ? '03 · BỘ MÔN & HỘI ĐỒNG' : '03 · FACULTY & COHORT'}
                    </span>
                  </div>

                  {/* Rows 2..5: Card Body Surface */}
                  <div
                    style={{
                      backgroundColor: 'var(--solva-bg)',
                      borderColor: 'var(--solva-border)',
                    }}
                    className={`relative z-10 rounded-[12px] border px-[20px] sm:px-[24px] py-[22px] sm:py-[24px] flex flex-col justify-between gap-[20px] flex-1 ${subgridBodyClass}`}
                  >
                    {/* Row 2: Header & Description */}
                    <div className={`space-y-[14px] ${subgridRowPb18Class}`}>
                      <div className="flex items-center gap-3">
                        <div
                          style={{
                            backgroundColor: 'var(--solva-surface)',
                            borderColor: 'var(--solva-border)',
                            color: 'var(--solva-ink)',
                          }}
                          className="w-[40px] h-[40px] rounded-[10px] border flex items-center justify-center shrink-0"
                        >
                          <Building2 className="w-[18px] h-[18px]" />
                        </div>
                        <div>
                          <h2
                            style={{ color: 'var(--solva-ink)' }}
                            className="font-solva-sans text-[22px] font-medium leading-tight tracking-[-0.02em]"
                          >
                            Ultra
                          </h2>
                          <p
                            style={{ color: 'var(--solva-muted)' }}
                            className="font-solva-sans text-[13px] mt-0.5"
                          >
                            {lang === 'vi'
                              ? 'Phòng Thí Nghiệm, Bộ Môn & Hội Đồng'
                              : 'Research Labs, Faculties & Review Boards'}
                          </p>
                        </div>
                      </div>

                      <p
                        style={{ color: 'var(--solva-muted)' }}
                        className="font-solva-sans text-[15px] leading-[22.5px]"
                      >
                        {lang === 'vi'
                          ? 'Năng lực thẩm định quy mô lớn cho nhóm nghiên cứu, bộ môn đại học và hội đồng chấm luận án Tiến sĩ.'
                          : 'High-volume verification scale for university departments, research labs, and doctoral committees.'}
                      </p>
                    </div>

                    {/* Row 3: Price Display (`Sentient` Light + Prominent VND in VI + USD Subtext) */}
                    <div
                      style={{ borderColor: 'var(--solva-border)' }}
                      className={`pt-[16px] ${subgridRowPb18Class} border-t`}
                    >
                      {lang === 'vi' ? (
                        <>
                          <div className="flex items-baseline gap-1.5 flex-wrap">
                            <span
                              style={{ color: 'var(--solva-ink)' }}
                              className="font-solva-serif font-light text-[34px] sm:text-[38px] leading-[44px] tracking-[-0.03em] whitespace-nowrap"
                            >
                              <NumberPopIn
                                value={billingCycle === 'annual' ? '4.000.000 ₫' : '5.000.000 ₫'}
                              />
                            </span>
                            <span
                              style={{ color: 'var(--solva-muted)' }}
                              className="font-solva-sans text-[14px] whitespace-nowrap"
                            >
                              / tháng
                            </span>
                          </div>
                          <div className="flex items-baseline gap-2 flex-wrap mt-1">
                            <span
                              style={{ color: 'var(--solva-ink)' }}
                              className="font-mono text-[13px] font-semibold"
                              data-testid="ultra-price-display"
                            >
                              <NumberPopIn value={`$${ultraPrice}`} />
                            </span>
                            <span
                              style={{ color: 'var(--solva-muted)' }}
                              className="font-mono text-[12px]"
                            >
                              USD / tháng
                            </span>
                            {billingCycle === 'annual' && (
                              <span
                                style={{ color: 'var(--solva-muted)' }}
                                className="text-[12px] line-through font-mono"
                              >
                                $200
                              </span>
                            )}
                          </div>
                        </>
                      ) : (
                        <div className="flex items-baseline gap-2 flex-wrap">
                          <span
                            style={{ color: 'var(--solva-ink)' }}
                            className="font-solva-serif font-light text-[40px] sm:text-[44px] leading-[48px] tracking-[-0.05em]"
                            data-testid="ultra-price-display"
                          >
                            <NumberPopIn value={`$${ultraPrice}`} />
                          </span>
                          <span
                            style={{ color: 'var(--solva-muted)' }}
                            className="font-solva-sans text-[14px]"
                          >
                            / month
                          </span>
                          {billingCycle === 'annual' && (
                            <span
                              style={{ color: 'var(--solva-muted)' }}
                              className="text-[14px] line-through font-mono"
                            >
                              $200
                            </span>
                          )}
                        </div>
                      )}
                      <p
                        style={{ color: 'var(--solva-muted)' }}
                        className="font-mono text-[12px] mt-1"
                      >
                        {billingCycle === 'annual'
                          ? lang === 'vi'
                            ? 'Thanh toán $1.920/năm (Tiết kiệm $480/năm — Giảm 20%)'
                            : 'Billed $1,920 annually ($160/mo equivalent — Save $480)'
                          : lang === 'vi'
                            ? 'Thanh toán $200 định kỳ hàng tháng (Hoặc $160/tháng khi trả năm)'
                            : 'Billed $200 monthly (Or $160/mo when billed annually)'}
                      </p>
                      {lang === 'vi' && (
                        <p
                          data-testid="ultra-vnd-equivalent"
                          style={{ color: 'var(--solva-muted)' }}
                          className="font-mono text-[12px] mt-1"
                        >
                          {billingCycle === 'annual' ? (
                            <>
                              <span className="whitespace-nowrap">4.000.000 ₫/tháng</span> ·{' '}
                              <span className="whitespace-nowrap">48.000.000 ₫/năm</span>{' '}
                              <span className="whitespace-nowrap">qua VNPay</span>
                            </>
                          ) : (
                            <>
                              <span className="whitespace-nowrap">5.000.000 ₫/tháng</span>{' '}
                              <span className="whitespace-nowrap">qua VNPay &amp; thẻ quốc tế</span>
                            </>
                          )}
                        </p>
                      )}
                    </div>

                    {/* Row 4: Features Checklist */}
                    <div className={`space-y-[10px] pt-1 ${subgridRowPb20Class}`}>
                      <p
                        style={{ color: 'var(--solva-ink)' }}
                        className="font-mono text-[11px] font-semibold uppercase tracking-wider"
                      >
                        {lang === 'vi'
                          ? 'Mọi tính năng Pro, cộng thêm:'
                          : 'Everything in Pro, plus:'}
                      </p>
                      <ul className="space-y-[9px]">
                        {(lang === 'vi'
                          ? [
                              'Hạn mức cấp đơn vị lên tới 1.000 bản thảo / tháng',
                              'Tối đa 100 MB & 500 trang / bài (Luận án Tiến sĩ & Sách chuyên khảo)',
                              'Không giới hạn số lượng trích dẫn trong mỗi tài liệu',
                              'Tra cứu mở rộng qua Google Scholar cho sách chuyên khảo & ấn phẩm hiếm',
                              'Kiểm tra tình trạng hoạt động của mã DOI & đường dẫn trực tuyến theo thời gian thực',
                              'Rà soát hàng loạt công suất lớn: tối đa 50 bản thảo PDF/DOCX cùng lúc',
                              'Không giới hạn lớp học, sinh viên & tải trọn bộ báo cáo cả lớp (.ZIP)',
                              'Lưu trữ lịch sử báo cáo vĩnh viễn & luồng xử lý ưu tiên 24/7',
                            ]
                          : [
                              'Institutional volume up to 1,000 manuscripts / month',
                              'Up to 100 MB & 500 pages per document (Doctoral Dissertations & Books)',
                              'Unlimited citations verified per manuscript',
                              'Extended Google Scholar discovery for rare monographs & regional literature',
                              'Real-time live DOI & URL reachability verification',
                              'Bulk cohort verification: upload up to 50 manuscripts at once',
                              'Unlimited classroom cohorts, students & full-cohort archive export (.ZIP)',
                              'Lifetime report retention & 24/7 priority processing queue',
                            ]
                        ).map((feat) => (
                          <li
                            key={feat}
                            className="flex items-start gap-[9px] font-solva-sans text-[14px] leading-[21px]"
                          >
                            <CheckCircle2 className="w-[16px] h-[16px] text-emerald-600 dark:text-emerald-400 mt-[2.5px] shrink-0" />
                            <span style={{ color: 'var(--solva-ink)' }}>{feat}</span>
                          </li>
                        ))}
                      </ul>
                    </div>

                    {/* Row 5: Action Button */}
                    <div
                      style={{ borderColor: 'var(--solva-border)' }}
                      className="pt-[18px] border-t flex items-end"
                    >
                      <SolvaPlanActionButton
                        variant="outline"
                        disabled={
                          adminLocked ||
                          loadingTier !== null ||
                          isCurrentUltra
                        }
                        onClick={() => handleSelectPlan('ultra')}
                        testId="select-ultra-btn"
                      >
                        {loadingTier === 'ultra' ? (
                          <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                        ) : (
                          <CreditCard className="h-4 w-4 shrink-0" />
                        )}
                        <span>
                          {adminLocked ? (
                            lang === 'vi' ? (
                              'Gói Quản trị · Ultra'
                            ) : (
                              <>
                                Current<span className="hidden 2xl:inline"> Plan</span> · Ultra (Admin)
                              </>
                            )
                          ) : isCurrentUltra ? (
                            lang === 'vi' ? (
                              'Đang sử dụng gói Ultra'
                            ) : (
                              <>
                                Current <span className="hidden 2xl:inline">Active </span>Ultra Plan
                              </>
                            )
                          ) : user && planTier === 'ultra' ? (
                            billingCycle === 'monthly' ? (
                              lang === 'vi' ? (
                                'Chuyển sang gói Tháng'
                              ) : (
                                'Switch to Monthly'
                              )
                            ) : lang === 'vi' ? (
                              'Chuyển sang gói Năm (-20%)'
                            ) : (
                              'Switch to Annual (-20%)'
                            )
                          ) : lang === 'vi' ? (
                            <>
                              Nâng cấp lên Ultra
                              <span className="hidden 2xl:inline">
                                {` · $${
                                  billingCycle === 'annual' ? '1.920/năm' : '200/tháng'
                                }`}
                              </span>
                            </>
                          ) : (
                            <>
                              Upgrade to Ultra
                              <span className="hidden 2xl:inline">
                                {` · $${billingCycle === 'annual' ? '1,920/yr' : '200/mo'}`}
                              </span>
                            </>
                          )}
                        </span>
                      </SolvaPlanActionButton>
                    </div>
                  </div>
                </div>
              </SolvaScrollReveal>
            </div>

            {/* ============================================================
                15+ FEDERATED SCHOLARLY INDEXES MARQUEE (120FPS GPU TICKER)
                ============================================================ */}
            <SolvaScrollReveal delayMs={110} yOffset={24} className="w-full pt-2">
              <div className="w-full flex flex-col items-center gap-[14px]">
                <p
                  style={{ color: 'var(--solva-muted)' }}
                  className="font-solva-sans text-[13px] text-center"
                >
                  {lang === 'vi'
                    ? 'Đối chiếu trực tiếp hơn 200 triệu công trình khoa học từ 15+ cơ sở dữ liệu quốc tế uy tín'
                    : 'Cross-referencing 200M+ canonical works across 15+ federated scholarly & technical indexes'}
                </p>

                <div className="w-full overflow-hidden solva-ticker-mask py-1">
                  <div className="animate-solva-marquee flex items-center gap-6 sm:gap-8">
                    {[...FEDERATED_SOURCES, ...FEDERATED_SOURCES].map((src, idx) => (
                      <a
                        key={`${src}-${idx}`}
                        href={getScholarlySourceUrl(src)}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.currentTarget.blur()}
                        style={{
                          backgroundColor: 'var(--solva-surface)',
                          borderColor: 'var(--solva-border)',
                          color: 'var(--solva-ink)',
                        }}
                        className="inline-flex items-center gap-2 px-3.5 py-2 rounded-[10px] border font-solva-sans text-[13px] font-medium whitespace-nowrap hover:opacity-80 transition-opacity shrink-0"
                      >
                        <ScholarlySourceLogo name={src} className="w-4 h-4 shrink-0" />
                        <span>{src}</span>
                      </a>
                    ))}
                  </div>
                </div>
              </div>
            </SolvaScrollReveal>
          </div>
        </section>

        {/* ============================================================
            SECTION 2: DETAILED FEATURE & QUOTA COMPARISON MATRIX
            ============================================================ */}
        <section
          id="compare-matrix"
          className={`scroll-mt-[84px] lg:scroll-mt-[108px] py-[36px] sm:py-[56px] lg:py-[80px] ${
            user ? 'px-3 sm:px-6' : 'px-5 sm:px-6 lg:px-[40px]'
          }`}
        >
          <div className="max-w-[1200px] mx-auto flex flex-col gap-[24px] sm:gap-[36px] lg:gap-[48px]">
            <div className="flex flex-col items-start gap-[12px] max-w-[620px]">
              <SolvaEyebrow>
                {lang === 'vi' ? 'So sánh tính năng & Hạn mức' : 'Plan comparison'}
              </SolvaEyebrow>
              <SolvaTwoToneHeading
                primary={
                  lang === 'vi'
                    ? 'Bảng so sánh chi tiết quyền lợi,'
                    : 'Detailed feature & quota comparison,'
                }
                secondary={
                  lang === 'vi'
                    ? 'minh bạch giữa 3 gói dịch vụ.'
                    : 'transparent across every plan.'
                }
              />
            </div>

            {/* Mobile / Narrow Segmented Comparison Switcher + 100%-Width Tier Feature Cards */}
            <div className={`${mobileCompareWrapClass} flex flex-col gap-3 w-full max-w-full`}>
              <div
                style={{ backgroundColor: 'var(--solva-bg)' }}
                className={`sticky ${
                  user
                    ? '-top-[18px] sm:-top-[24px] z-20 pt-2.5 pb-2'
                    : 'top-[64px] z-30 pt-2 pb-2'
                } -mx-1 px-1`}
              >
                <div
                  ref={compareTabsRef}
                  data-testid="mobile-compare-tier-tabs"
                  role="tablist"
                  aria-label={
                    lang === 'vi' ? 'Chọn gói dịch vụ để so sánh' : 'Select plan tier to compare'
                  }
                  style={{
                    backgroundColor: 'var(--solva-surface)',
                    borderColor: 'var(--solva-border)',
                  }}
                  className={`${mobileCompareWrapClass} relative grid grid-cols-3 items-center gap-1 p-1 rounded-[12px] border shadow-sm w-full max-w-full`}
                >
                  {comparePill.ready && (
                    <span
                      aria-hidden="true"
                      style={{
                        backgroundColor: 'var(--solva-btn-bg)',
                        width: `${comparePill.width}px`,
                        height: `${comparePill.height}px`,
                        transform: `translate3d(${comparePill.left}px, ${comparePill.top}px, 0)`,
                        transition: comparePill.animate ? undefined : 'none',
                      }}
                      className="t-tabs-pill rounded-[8px]"
                    />
                  )}
                  {(
                    [
                      {
                        tier: 'basic' as const,
                        id: 'mobile-compare-tab-basic',
                        label: 'Basic ($0)',
                      },
                      {
                        tier: 'pro' as const,
                        id: 'mobile-compare-tab-pro',
                        label: 'Pro',
                        starred: true,
                      },
                      {
                        tier: 'ultra' as const,
                        id: 'mobile-compare-tab-ultra',
                        label: 'Ultra',
                      },
                    ] as const
                  ).map((tab) => {
                    const isActive = mobileCompareTier === tab.tier;
                    return (
                      <button
                        key={tab.tier}
                        id={tab.id}
                        type="button"
                        role="tab"
                        aria-selected={isActive}
                        aria-controls="mobile-compare-tier-panel"
                        data-pill-active={isActive ? 'true' : 'false'}
                        data-testid={tab.id}
                        onClick={() => setMobileCompareTier(tab.tier)}
                        style={
                          isActive
                            ? {
                                backgroundColor: comparePill.ready
                                  ? 'transparent'
                                  : 'var(--solva-btn-bg)',
                                color: 'var(--solva-btn-fg)',
                              }
                            : {
                                backgroundColor: 'transparent',
                                color: 'var(--solva-muted)',
                              }
                        }
                        className={`t-tab relative z-10 min-h-[44px] px-2 rounded-[8px] font-solva-sans text-[13px] ${
                          isActive ? 'font-semibold' : 'font-medium'
                        } inline-flex items-center justify-center gap-1 whitespace-nowrap cursor-pointer`}
                      >
                        <span>{tab.label}</span>
                        {'starred' in tab && tab.starred && (
                          <Sparkles className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Selected Tier Panel + Full-Width Comparison Rows + Bottom CTA */}
              <div
                id="mobile-compare-tier-panel"
                data-testid="mobile-compare-tier-panel"
                role="tabpanel"
                aria-labelledby={`mobile-compare-tab-${mobileCompareTier}`}
                style={{
                  backgroundColor: 'var(--solva-surface)',
                  borderColor:
                    mobileCompareTier === 'pro' ? 'var(--solva-ink)' : 'var(--solva-border)',
                }}
                className="rounded-[16px] border p-3.5 sm:p-5 flex flex-col gap-3.5 w-full max-w-full"
              >
                {/* Selected Tier Header Summary */}
                <div className="flex flex-wrap items-center justify-between gap-2.5 px-1">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div
                      style={
                        mobileCompareTier === 'pro'
                          ? {
                              backgroundColor: 'var(--solva-btn-bg)',
                              color: 'var(--solva-btn-fg)',
                            }
                          : {
                              backgroundColor: 'var(--solva-bg)',
                              borderColor: 'var(--solva-border)',
                              color: 'var(--solva-ink)',
                            }
                      }
                      className={`w-[36px] h-[36px] rounded-[9px] ${
                        mobileCompareTier === 'pro' ? '' : 'border'
                      } flex items-center justify-center shrink-0`}
                    >
                      {mobileCompareTier === 'basic' ? (
                        <FileText className="w-4 h-4" />
                      ) : mobileCompareTier === 'pro' ? (
                        <Zap className="w-4 h-4" />
                      ) : (
                        <Building2 className="w-4 h-4" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3
                          style={{ color: 'var(--solva-ink)' }}
                          className="font-solva-sans text-[17px] font-semibold leading-tight"
                        >
                          {mobileCompareTier === 'basic'
                            ? 'Basic'
                            : mobileCompareTier === 'pro'
                              ? 'Pro'
                              : 'Ultra'}
                        </h3>
                        {mobileCompareTier === 'pro' && (
                          <span
                            style={{
                              backgroundColor: 'var(--solva-btn-bg)',
                              color: 'var(--solva-btn-fg)',
                            }}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[5px] font-mono text-[10px] font-semibold uppercase tracking-wide whitespace-nowrap shrink-0"
                          >
                            <Sparkles className="w-2.5 h-2.5 shrink-0" aria-hidden="true" />
                            <span>{lang === 'vi' ? 'Phổ biến nhất' : 'Most Popular'}</span>
                          </span>
                        )}
                      </div>
                      <p
                        style={{ color: 'var(--solva-muted)' }}
                        className="font-solva-sans text-[12.5px] leading-snug mt-0.5"
                      >
                        {mobileCompareTier === 'basic'
                          ? lang === 'vi'
                            ? 'Gói khởi đầu miễn phí cho sinh viên'
                            : 'Free starter for course essays'
                          : mobileCompareTier === 'pro'
                            ? lang === 'vi'
                              ? 'Khóa luận, luận văn & giảng viên'
                              : 'Theses, researchers & lecturers'
                            : lang === 'vi'
                              ? 'Phòng thí nghiệm, bộ môn & hội đồng'
                              : 'Labs, faculties & review boards'}
                      </p>
                    </div>
                  </div>

                  <div
                    style={{
                      backgroundColor: 'var(--solva-bg)',
                      borderColor: 'var(--solva-border)',
                      color: 'var(--solva-ink)',
                    }}
                    className="inline-flex items-baseline gap-1 px-2.5 py-1 rounded-[8px] border font-mono text-[13px] font-semibold whitespace-nowrap shrink-0"
                  >
                    <span>
                      $
                      {mobileCompareTier === 'basic'
                        ? 0
                        : mobileCompareTier === 'pro'
                          ? proPrice
                          : ultraPrice}
                    </span>
                    <span
                      style={{ color: 'var(--solva-muted)' }}
                      className="font-solva-sans text-[11.5px] font-normal"
                    >
                      /{lang === 'vi' ? 'tháng' : 'mo'}
                    </span>
                  </div>
                </div>

                {/* 100%-Width Comparison Feature Rows */}
                <div
                  style={{
                    backgroundColor: 'var(--solva-bg)',
                    borderColor: 'var(--solva-border)',
                  }}
                  className="rounded-[12px] border divide-y w-full max-w-full"
                >
                  {COMPARISON_MATRIX.map((row) => {
                    const resolved = resolveComparisonValue(row[mobileCompareTier], lang);
                    const categoryLabel = lang === 'vi' ? row.category_vi : row.category_en;
                    const isLongString = typeof resolved === 'string' && resolved.length > 22;

                    return (
                      <div
                        key={row.category_en}
                        style={{ borderColor: 'var(--solva-border)' }}
                        className={`px-3.5 py-3 w-full max-w-full ${
                          isLongString
                            ? 'flex flex-col items-start gap-1.5'
                            : 'flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5'
                        }`}
                      >
                        <span
                          style={{ color: 'var(--solva-ink)' }}
                          className="font-solva-sans text-[13.5px] font-medium leading-[19.5px] min-w-0 break-words"
                        >
                          {categoryLabel}
                        </span>

                        {typeof resolved === 'boolean' ? (
                          resolved ? (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[7px] bg-emerald-600/[0.12] dark:bg-emerald-400/15 text-emerald-800 dark:text-emerald-300 border border-emerald-700/20 dark:border-emerald-400/25 font-mono text-[11.5px] font-semibold whitespace-nowrap shrink-0">
                              <Check className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                              <span>{lang === 'vi' ? 'Có hỗ trợ' : 'Included'}</span>
                            </span>
                          ) : (
                            <span
                              style={{
                                backgroundColor: 'var(--solva-surface)',
                                borderColor: 'var(--solva-border)',
                                color: 'var(--solva-muted)',
                              }}
                              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[7px] border font-mono text-[11.5px] font-medium whitespace-nowrap shrink-0"
                            >
                              <Minus className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                              <span>{lang === 'vi' ? 'Chưa bao gồm' : 'Not included'}</span>
                            </span>
                          )
                        ) : isLongString ? (
                          <span
                            style={{
                              backgroundColor: 'var(--solva-surface)',
                              borderColor: 'var(--solva-border)',
                              color: 'var(--solva-ink)',
                            }}
                            className="inline-block max-w-full px-2.5 py-1.5 rounded-[8px] border font-solva-sans text-[12.5px] font-medium leading-[18px] break-words"
                          >
                            {resolved}
                          </span>
                        ) : (
                          <span
                            style={{
                              backgroundColor: 'var(--solva-surface)',
                              borderColor: 'var(--solva-border)',
                              color: 'var(--solva-ink)',
                            }}
                            className="inline-flex items-center px-2.5 py-1 rounded-[7px] border font-mono text-[12px] font-semibold whitespace-nowrap shrink-0"
                          >
                            {resolved}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Bottom Action CTA for Selected Tier */}
                <div className="pt-0.5">
                  {mobileCompareTier === 'basic' ? (
                    <SolvaPlanActionButton
                      variant="outline"
                      disabled={
                        adminLocked ||
                        Boolean(user && (planTier === 'basic' || planTier === 'pro' || planTier === 'ultra'))
                      }
                      onClick={() => handleSelectPlan('basic')}
                      testId="mobile-compare-tier-cta"
                    >
                      {adminLocked
                        ? lang === 'vi'
                          ? 'Mở sẵn cho Quản trị'
                          : 'Included with Admin'
                        : user && (planTier === 'pro' || planTier === 'ultra')
                          ? lang === 'vi'
                            ? 'Đã bao gồm trong gói của bạn'
                            : 'Included in your plan'
                          : user && planTier === 'basic'
                            ? lang === 'vi'
                              ? 'Đang sử dụng gói Basic'
                              : 'Current Active Plan'
                            : lang === 'vi'
                              ? 'Bắt đầu miễn phí'
                              : 'Get Started Free'}
                    </SolvaPlanActionButton>
                  ) : mobileCompareTier === 'pro' ? (
                    <SolvaPlanActionButton
                      variant="primary"
                      disabled={
                        adminLocked ||
                        loadingTier !== null ||
                        isCurrentPro ||
                        Boolean(user && planTier === 'ultra')
                      }
                      onClick={() => handleSelectPlan('pro')}
                      testId="mobile-compare-tier-cta"
                    >
                      {loadingTier === 'pro' ? (
                        <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                      ) : (
                        <CreditCard className="h-4 w-4 shrink-0" />
                      )}
                      <span>
                        {adminLocked
                          ? lang === 'vi'
                            ? 'Mở sẵn cho Quản trị'
                            : 'Included with Admin'
                          : user && planTier === 'ultra'
                            ? lang === 'vi'
                              ? 'Đã bao gồm gói Ultra'
                              : 'Included in Ultra'
                            : isCurrentPro
                              ? lang === 'vi'
                                ? 'Đang sử dụng gói Pro'
                                : 'Current Pro Plan'
                              : user && planTier === 'pro'
                                ? billingCycle === 'monthly'
                                  ? lang === 'vi'
                                    ? 'Chuyển sang gói Tháng'
                                    : 'Switch to Monthly'
                                  : lang === 'vi'
                                    ? 'Chuyển sang gói Năm'
                                    : 'Switch to Annual'
                                : lang === 'vi'
                                  ? 'Nâng cấp lên Pro'
                                  : 'Upgrade to Pro'}
                      </span>
                    </SolvaPlanActionButton>
                  ) : (
                    <SolvaPlanActionButton
                      variant="outline"
                      disabled={adminLocked || loadingTier !== null || isCurrentUltra}
                      onClick={() => handleSelectPlan('ultra')}
                      testId="mobile-compare-tier-cta"
                    >
                      {loadingTier === 'ultra' ? (
                        <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                      ) : (
                        <CreditCard className="h-4 w-4 shrink-0" />
                      )}
                      <span>
                        {adminLocked
                          ? lang === 'vi'
                            ? 'Gói Quản trị · Ultra'
                            : 'Current · Ultra (Admin)'
                          : isCurrentUltra
                            ? lang === 'vi'
                              ? 'Đang sử dụng gói Ultra'
                              : 'Current Ultra Plan'
                            : user && planTier === 'ultra'
                              ? billingCycle === 'monthly'
                                ? lang === 'vi'
                                  ? 'Chuyển sang gói Tháng'
                                  : 'Switch to Monthly'
                                : lang === 'vi'
                                  ? 'Chuyển sang gói Năm'
                                  : 'Switch to Annual'
                              : lang === 'vi'
                                ? 'Nâng cấp lên Ultra'
                                : 'Upgrade to Ultra'}
                      </span>
                    </SolvaPlanActionButton>
                  )}
                </div>
              </div>
            </div>

            {/* Desktop 4-Column Semantic Comparison Table */}
            <div data-testid="desktop-compare-table-wrap" className={desktopCompareWrapClass}>
              <SolvaScrollReveal delayMs={40} yOffset={20} blurPx={0}>
                <div
                  style={{
                    backgroundColor: 'var(--solva-surface)',
                    borderColor: 'var(--solva-border)',
                  }}
                  className="rounded-[16px] border p-4 sm:p-5 xl:p-[32px] overflow-x-clip"
                >
                  <div>
                    <table className="w-full table-fixed text-left border-collapse font-solva-sans text-[13px] xl:text-[14px]">
                      <thead
                        className={`sticky ${
                          user ? 'top-0' : 'top-[64px] lg:top-[76px]'
                        } z-20`}
                      >
                        <tr
                          style={{
                            backgroundColor: 'var(--solva-surface)',
                            borderColor: 'var(--solva-border)',
                            color: 'var(--solva-muted)',
                          }}
                          className="border-b font-mono uppercase text-[11px] shadow-[0_1px_0_var(--solva-border)]"
                        >
                          <th
                            style={{ backgroundColor: 'var(--solva-surface)' }}
                            className="w-[34%] py-3.5 pr-3 xl:pr-4 font-semibold"
                          >
                            {lang === 'vi' ? 'Danh mục tính năng' : 'Feature / Quota'}
                          </th>
                          <th
                            style={{ backgroundColor: 'var(--solva-surface)' }}
                            className="w-[18%] py-3.5 px-2.5 xl:px-4 text-center font-semibold"
                          >
                            {lang === 'vi' ? 'Basic (0 ₫)' : 'Basic ($0)'}
                          </th>
                          <th
                            style={{
                              backgroundColor: 'var(--solva-bg)',
                              color: 'var(--solva-ink)',
                            }}
                            className="w-[24%] py-3.5 px-2.5 xl:px-4 text-center font-bold rounded-t-[10px]"
                          >
                            Pro (${proPrice}/{lang === 'vi' ? 'tháng' : 'mo'})
                          </th>
                          <th
                            style={{
                              backgroundColor: 'var(--solva-surface)',
                              color: 'var(--solva-ink)',
                            }}
                            className="w-[24%] py-3.5 pl-2.5 xl:pl-4 text-center font-bold"
                          >
                            Ultra (${ultraPrice}/{lang === 'vi' ? 'tháng' : 'mo'})
                          </th>
                        </tr>
                      </thead>
                      <tbody
                        style={{ borderColor: 'var(--solva-border)' }}
                        className="divide-y"
                      >
                        {COMPARISON_MATRIX.map((row) => {
                          const basicVal = resolveComparisonValue(row.basic, lang);
                          const proVal = resolveComparisonValue(row.pro, lang);
                          const ultraVal = resolveComparisonValue(row.ultra, lang);

                          return (
                            <tr
                              key={row.category_en}
                              style={{ borderColor: 'var(--solva-border)' }}
                              className="hover:bg-[#FBFAF6]/60 dark:hover:bg-[#141310]/40 transition-colors"
                            >
                              <td
                                style={{ color: 'var(--solva-ink)' }}
                                className="py-3.5 pr-3 xl:pr-4 font-medium break-words"
                              >
                                {lang === 'vi' ? row.category_vi : row.category_en}
                              </td>
                              <td
                                style={{ color: 'var(--solva-muted)' }}
                                className="py-3.5 px-2.5 xl:px-4 text-center font-mono text-[12px] break-words"
                              >
                                {typeof basicVal === 'boolean' ? (
                                  basicVal ? (
                                    <Check
                                      aria-label={lang === 'vi' ? 'Có hỗ trợ' : 'Included'}
                                      className="h-4 w-4 text-emerald-600 dark:text-emerald-400 mx-auto"
                                    />
                                  ) : (
                                    <Minus
                                      aria-label={lang === 'vi' ? 'Chưa bao gồm' : 'Not included'}
                                      className="h-4 w-4 opacity-55 mx-auto"
                                    />
                                  )
                                ) : (
                                  basicVal
                                )}
                              </td>
                              <td
                                style={{
                                  backgroundColor: 'var(--solva-bg)',
                                  color: 'var(--solva-ink)',
                                }}
                                className="py-3.5 px-2.5 xl:px-4 text-center font-semibold font-mono text-[12px] break-words"
                              >
                                {typeof proVal === 'boolean' ? (
                                  proVal ? (
                                    <CheckCircle2
                                      aria-label={lang === 'vi' ? 'Có hỗ trợ' : 'Included'}
                                      className="h-4 w-4 text-emerald-600 dark:text-emerald-400 mx-auto"
                                    />
                                  ) : (
                                    <Minus
                                      aria-label={lang === 'vi' ? 'Chưa bao gồm' : 'Not included'}
                                      className="h-4 w-4 opacity-55 mx-auto"
                                    />
                                  )
                                ) : (
                                  proVal
                                )}
                              </td>
                              <td
                                style={{ color: 'var(--solva-ink)' }}
                                className="py-3.5 pl-2.5 xl:pl-4 text-center font-semibold font-mono text-[12px] break-words"
                              >
                                {typeof ultraVal === 'boolean' ? (
                                  ultraVal ? (
                                    <CheckCircle2
                                      aria-label={lang === 'vi' ? 'Có hỗ trợ' : 'Included'}
                                      className="h-4 w-4 text-emerald-600 dark:text-emerald-400 mx-auto"
                                    />
                                  ) : (
                                    <Minus
                                      aria-label={lang === 'vi' ? 'Chưa bao gồm' : 'Not included'}
                                      className="h-4 w-4 opacity-55 mx-auto"
                                    />
                                  )
                                ) : (
                                  ultraVal
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </SolvaScrollReveal>
            </div>
          </div>
        </section>

        {/* ============================================================
            SECTION 3: PAINTERLY EMPIRICAL BENCHMARK & TRUST GUARANTEES
            ============================================================ */}
        <section
          className={`py-[36px] sm:py-[56px] lg:py-[80px] ${
            user ? 'px-3 sm:px-6' : 'px-5 sm:px-6 lg:px-[40px]'
          }`}
        >
          <div className="max-w-[1200px] mx-auto flex flex-col gap-[24px] sm:gap-[32px]">
            {/* Split Painterly Card + 3 Animated Metrics */}
            <SolvaScrollReveal yOffset={36}>
              <div
                style={{ backgroundColor: 'var(--solva-surface)' }}
                className="w-full rounded-[16px] p-[12px] grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch"
              >
                <div className="lg:col-span-5">
                  <SolvaPainterlyFrame
                    paintingSrc="/solva/usecase-4-bg.webp"
                    alt="Impressionist botanical painting backdrop for cohort thesis audit"
                    radiusClass="rounded-[10px]"
                    className="w-full min-h-[360px] sm:min-h-[400px] lg:h-[440px] p-4 sm:p-6 flex items-center justify-center"
                  >
                    <div className="w-full flex items-center justify-center">
                      <CohortBatchAuditWidget lang={lang} />
                    </div>
                  </SolvaPainterlyFrame>
                </div>

                <div className="lg:col-span-7 p-4 sm:p-[28px] lg:pl-[36px] flex flex-col justify-between gap-[28px]">
                  <div className="space-y-[20px]">
                    <div className="flex flex-col sm:flex-row items-start justify-between gap-4">
                      <blockquote className="font-solva-serif font-light text-[22px] sm:text-[28px] leading-[1.25] max-w-[520px]">
                        <span style={{ color: 'var(--solva-ink)' }}>
                          {lang === 'vi'
                            ? '“Nâng cấp lên gói Pro & Ultra giúp hội đồng rà soát 120 khóa luận tốt nghiệp chỉ trong một buổi sáng, phát hiện chính xác mọi mã DOI không tồn tại '
                            : '“Upgrading to CITRA Pro & Ultra let our review committee audit 120 graduation theses in a single morning, catching every non-existent DOI '}
                        </span>
                        <span style={{ color: 'var(--solva-muted)' }}>
                          {lang === 'vi'
                            ? `kèm đối chiếu nguồn gốc từng trường thông tin (${SYMBOLIC_RULES_RANGE}) minh bạch.”`
                            : `with clear, field-by-field source checks (${SYMBOLIC_RULES_RANGE}).”`}
                        </span>
                      </blockquote>

                      <div
                        style={{ color: 'var(--solva-ink)' }}
                        className="font-solva-sans text-[14px] font-medium tracking-tight shrink-0 flex items-center gap-1.5"
                      >
                        <GraduationCap className="w-4 h-4" />
                        <span>
                          {lang === 'vi' ? 'Kiểm định Hội đồng' : 'Committee Study'}
                        </span>
                      </div>
                    </div>

                    <div className="space-y-[2px]">
                      <div
                        style={{ color: 'var(--solva-ink)' }}
                        className="font-solva-sans text-[14px] font-medium leading-[21px]"
                      >
                        {lang === 'vi'
                          ? 'Hội đồng Rà soát Học thuật & Luận văn'
                          : 'Academic Thesis Review Committee'}
                      </div>
                      <div
                        style={{ color: 'var(--solva-muted)' }}
                        className="font-solva-sans text-[14px] leading-[21px]"
                      >
                        {lang === 'vi'
                          ? 'Kiểm định trên 120.000 bài báo khoa học thực tế'
                          : 'Empirically benchmarked across 120,000 scholarly papers'}
                      </div>
                    </div>
                  </div>

                  {/* 3 Count-Up Metrics (`Sentient` 40px Light) */}
                  <div
                    style={{ borderColor: 'var(--solva-border)' }}
                    className="grid grid-cols-1 sm:grid-cols-3 gap-6 sm:gap-[32px] pt-4 border-t"
                  >
                    <SolvaAnimatedMetric
                      targetValue={15}
                      suffix="+"
                      decimals={0}
                      label={
                        lang === 'vi'
                          ? 'Thư viện & kho dữ liệu học thuật uy tín'
                          : 'Trusted academic libraries & indexes'
                      }
                    />
                    <SolvaAnimatedMetric
                      targetValue={99.67}
                      suffix="%"
                      decimals={2}
                      decimalSeparator={lang === 'vi' ? ',' : '.'}
                      label={
                        lang === 'vi'
                          ? 'Độ chính xác kiểm chứng trích dẫn'
                          : 'Overall citation verification accuracy'
                      }
                    />
                    <SolvaAnimatedMetric
                      targetValue={99.93}
                      suffix="%"
                      decimals={2}
                      decimalSeparator={lang === 'vi' ? ',' : '.'}
                      label={
                        lang === 'vi'
                          ? 'Độ chuẩn xác đối chiếu'
                          : 'Verification precision'
                      }
                    />
                  </div>
                </div>
              </div>
            </SolvaScrollReveal>

            {/* 3 Trust & Security Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-[16px]">
              {[
                demoEvaluatorMode
                  ? {
                      icon: ShieldCheck,
                      title_vi: 'Thanh toán Stripe An toàn (Chế độ Đánh giá)',
                      title_en: 'Secure Stripe Checkout (Evaluator Mode)',
                      desc_vi:
                        'Hỗ trợ thẻ quốc tế Visa/Mastercard qua cổng Stripe Demo chuẩn bảo mật PCI-DSS kèm thẻ kiểm thử 1-Click. Nâng cấp tài khoản và mở khóa hạn mức tức thì.',
                      desc_en:
                        'Instant activation via Stripe Demo Checkout with full invoice receipts and 1-click test card support.',
                    }
                  : {
                      icon: ShieldCheck,
                      title_vi: 'Thanh toán Stripe & VNPay Mã hóa',
                      title_en: 'Encrypted Stripe & VNPay Checkout',
                      desc_vi:
                        'Giao dịch mã hóa TLS 1.3 theo chuẩn PCI-DSS qua cổng quốc tế Stripe (Visa, Mastercard, Apple Pay, Google Pay) và VNPay nội địa (VNPAY-QR, thẻ ATM/NAPAS). Kích hoạt hạn mức và xuất biên lai điện tử tức thì.',
                      desc_en:
                        'TLS 1.3 encrypted, PCI-DSS compliant checkout via Stripe (Visa, Mastercard, Apple Pay, Google Pay) and VNPay domestic gateway (VNPAY-QR & ATM/NAPAS cards), with instant quota activation and digital receipts.',
                    },
                {
                  icon: Database,
                  title_vi: 'Chuyển đổi Tháng / Năm linh hoạt',
                  title_en: 'Flexible Monthly & Annual Plans',
                  desc_vi:
                    'Nâng cấp, chuyển sang chu kỳ năm tiết kiệm 20% hoặc hủy gia hạn tự động bất cứ lúc nào trong trang Cài đặt.',
                  desc_en:
                    'Switch between monthly and annual billing (Save 20%) or cancel auto-renewal anytime from Settings.',
                },
                {
                  icon: HelpCircle,
                  title_vi: 'Đảm bảo Tính Toàn vẹn Học thuật',
                  title_en: 'Academic Decision-Support',
                  desc_vi: `Mọi kết quả kiểm chứng đều đi kèm bằng chứng truy xuất từ ${SCHOLARLY_APIS_LABEL} cơ sở dữ liệu khoa học quốc tế uy tín và luật suy diễn ${SYMBOLIC_RULES_RANGE}.`,
                  desc_en: `Every verdict is backed by explainable symbolic rules (${SYMBOLIC_RULES_RANGE}) and live scholarly metadata.`,
                },
              ].map((item, idx) => {
                const Icon = item.icon;
                return (
                  <SolvaScrollReveal
                    key={item.title_en}
                    delayMs={idx * 80}
                    yOffset={24}
                    className="h-full"
                  >
                    <div
                      style={{
                        backgroundColor: 'var(--solva-surface)',
                        borderColor: 'var(--solva-border)',
                      }}
                      className="rounded-[12px] border p-[24px] h-full flex flex-col justify-between gap-[20px]"
                    >
                      <Icon
                        style={{ color: 'var(--solva-ink)' }}
                        className="w-[18px] h-[18px]"
                      />
                      <div className="space-y-[6px]">
                        <h3
                          style={{ color: 'var(--solva-ink)' }}
                          className="font-solva-sans text-[17px] font-medium leading-[24px]"
                        >
                          {lang === 'vi' ? item.title_vi : item.title_en}
                        </h3>
                        <p
                          style={{ color: 'var(--solva-muted)' }}
                          className="font-solva-sans text-[14px] font-normal leading-[21px]"
                        >
                          {lang === 'vi' ? item.desc_vi : item.desc_en}
                        </p>
                      </div>
                    </div>
                  </SolvaScrollReveal>
                );
              })}
            </div>
          </div>
        </section>

        {/* ============================================================
            SECTION 4: PRICING & BILLING FAQ ACCORDION (`#pricing-faq`)
            ============================================================ */}
        <PricingSolvaFAQSection
          lang={lang}
          isEmbedded={Boolean(user)}
          demoEvaluatorMode={demoEvaluatorMode}
          billingCycle={billingCycle}
        />

        {/* ============================================================
            SECTION 5: BOTTOM PAINTERLY CTA & FOOTER (Public Standalone View)
            ============================================================ */}
        {!user && (
          <>
            <section className="pt-[28px] pb-[36px] sm:py-[48px] lg:py-[88px] px-5 sm:px-6 lg:px-[40px]">
              <div className="max-w-[1200px] mx-auto">
                <SolvaScrollReveal yOffset={36}>
                  <div
                    style={{ backgroundColor: 'var(--solva-surface)' }}
                    className="w-full rounded-[16px] p-[12px] grid grid-cols-1 lg:grid-cols-12 items-center gap-6"
                  >
                    <div className="lg:col-span-6 p-5 sm:p-[32px] flex flex-col items-start gap-[24px]">
                      <div className="space-y-[16px]">
                        <SolvaTwoToneHeading
                          primary={
                            lang === 'vi'
                              ? 'Trao lại sự an tâm'
                              : 'Give your research'
                          }
                          secondary={
                            lang === 'vi'
                              ? 'cho mỗi bản thảo học thuật.'
                              : 'verifiable integrity.'
                          }
                        />
                        <p
                          style={{ color: 'var(--solva-muted)' }}
                          className="font-solva-sans text-[16px] font-normal leading-[23.2px] max-w-[420px]"
                        >
                          {lang === 'vi'
                            ? 'Bắt đầu miễn phí ngay hôm nay với 3 lượt kiểm tra (.PDF, .DOCX, .BIB, .RIS) mỗi tháng, hoặc nâng cấp lên gói Pro để tra cứu toàn diện hơn 15 thư viện học thuật và xuất báo cáo đầy đủ.'
                            : 'Start free today with 3 checks (.PDF, .DOCX, .BIB, .RIS) per month, or upgrade to CITRA Pro for full 15+ academic library verification and complete exports.'}
                        </p>
                      </div>

                      <div className="flex flex-wrap items-center gap-3">
                        <SolvaButton to="/register" variant="primary">
                          {lang === 'vi' ? 'Bắt đầu miễn phí' : 'Get started free'}
                        </SolvaButton>
                        <SolvaButton to="/" variant="outline">
                          {lang === 'vi' ? 'Quay về Trang chủ' : 'Back to Home'}
                        </SolvaButton>
                      </div>
                    </div>

                    <div className="lg:col-span-6">
                      <SolvaPainterlyFrame
                        paintingSrc="/solva/hero-bg.webp"
                        alt="Impressionist floral painting backdrop"
                        radiusClass="rounded-[12px]"
                        className="w-full min-h-[320px] sm:h-[376px] p-6 sm:p-8 flex items-center justify-center"
                      >
                        <div className="w-full max-w-[480px]">
                          <BottomCTAMockup lang={lang} />
                        </div>
                      </SolvaPainterlyFrame>
                    </div>
                  </div>
                </SolvaScrollReveal>
              </div>
            </section>

            <PricingSolvaFooter lang={lang} />
          </>
        )}
      </PricingMainTag>
    </div>
  );
}

/* ============================================================
   FIXED SOLVA NAVBAR FOR PUBLIC `/pricing` VIEW
   ============================================================ */
function PricingSolvaHeader({
  lang,
  onToggleLanguage,
}: {
  lang: Lang;
  onToggleLanguage: () => void;
}) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const dropdownContainerRef = useRef<HTMLDivElement>(null);
  const dropdownTriggerRef = useRef<HTMLButtonElement>(null);
  const mobileToggleRef = useRef<HTMLButtonElement>(null);
  const dropdownPresence = useExitPresence(dropdownOpen, 150);
  const mobileDrawerPresence = useExitPresence(mobileMenuOpen, 150);
  const [headerEntered, setHeaderEntered] = useState(false);
  const [headerSettled, setHeaderSettled] = useState(false);

  useEffect(() => {
    let raf1 = 0;
    let raf2 = 0;
    let settleTimer = 0;
    raf1 = window.requestAnimationFrame(() => {
      raf2 = window.requestAnimationFrame(() => {
        setHeaderEntered(true);
        settleTimer = window.setTimeout(() => {
          setHeaderSettled(true);
        }, 680);
      });
    });
    return () => {
      window.cancelAnimationFrame(raf1);
      window.cancelAnimationFrame(raf2);
      if (settleTimer) window.clearTimeout(settleTimer);
    };
  }, []);

  useEffect(() => {
    if (!dropdownOpen && !mobileMenuOpen) return;
    const closeOnScroll = () => setDropdownOpen(false);
    const closeOnOutsidePointer = (e: MouseEvent | PointerEvent) => {
      if (!dropdownOpen) return;
      const target = e.target as Node | null;
      if (
        dropdownContainerRef.current &&
        target &&
        !dropdownContainerRef.current.contains(target)
      ) {
        setDropdownOpen(false);
      }
    };
    const closeOnKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (dropdownOpen) {
          setDropdownOpen(false);
          dropdownTriggerRef.current?.focus({ preventScroll: true });
        }
        if (mobileMenuOpen) {
          setMobileMenuOpen(false);
          mobileToggleRef.current?.focus({ preventScroll: true });
        }
      }
    };
    window.addEventListener('scroll', closeOnScroll, { passive: true });
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    document.addEventListener('mousedown', closeOnOutsidePointer);
    window.addEventListener('keydown', closeOnKeyDown);
    return () => {
      window.removeEventListener('scroll', closeOnScroll);
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
      document.removeEventListener('mousedown', closeOnOutsidePointer);
      window.removeEventListener('keydown', closeOnKeyDown);
    };
  }, [dropdownOpen, mobileMenuOpen]);

  const dropdownItems =
    lang === 'vi'
      ? [
          {
            title: 'Kiểm tra trích dẫn 2 bước',
            desc: 'Đối chiếu trong bài & xác minh nguồn thật',
            href: '/#architecture',
            icon: Layers,
          },
          {
            title: 'Cách hoạt động',
            desc: '4 bước rõ ràng từ tải bài đến xuất báo cáo',
            href: '/#how-it-works',
            icon: GitBranch,
          },
          {
            title: 'Kiểm tra thử trực quan',
            desc: 'So sánh chi tiết bài viết với bản ghi thư viện',
            href: '/#interactive-demo',
            icon: FileSearch,
          },
          {
            title: 'Độ tin cậy thực tế',
            desc: 'Chính xác 99,67% trên 120.000 bài báo',
            href: '/#benchmark-120k',
            icon: Sparkles,
          },
          {
            title: 'Dành cho từng vai trò',
            desc: 'Sinh viên, Giảng viên & Khoa / Trường',
            href: '/#workspaces',
            icon: Users,
          },
        ]
      : [
          {
            title: 'Two-Step Citation Check',
            desc: 'In-text links & real source verification',
            href: '/#architecture',
            icon: Layers,
          },
          {
            title: 'How It Works',
            desc: '4 clear steps from upload to clean report',
            href: '/#how-it-works',
            icon: GitBranch,
          },
          {
            title: 'Live Citation Check',
            desc: 'Compare cited details with library records',
            href: '/#interactive-demo',
            icon: FileSearch,
          },
          {
            title: 'Proven Accuracy',
            desc: '99.67% accuracy across 120,000 papers',
            href: '/#benchmark-120k',
            icon: Sparkles,
          },
          {
            title: 'Built for Every Role',
            desc: 'Students, Lecturers & Faculties',
            href: '/#workspaces',
            icon: Users,
          },
        ];

  return (
    <header
      style={{
        backgroundColor: 'var(--solva-bg)',
        opacity: headerEntered ? 1 : 0.001,
        transform: headerEntered ? 'translate3d(0, 0, 0)' : 'translate3d(0, -12px, 0)',
        filter: headerEntered ? 'none' : 'blur(2.5px)',
        transition: headerSettled
          ? 'background-color 200ms ease'
          : 'opacity 620ms cubic-bezier(0.22, 1, 0.36, 1), transform 620ms cubic-bezier(0.22, 1, 0.36, 1), filter 520ms cubic-bezier(0.22, 1, 0.36, 1), background-color 200ms ease',
        willChange: headerSettled ? 'transform' : 'transform, opacity, filter',
        backfaceVisibility: 'hidden',
      }}
      className="fixed top-0 left-0 right-0 z-50"
    >
      <div className="max-w-[1280px] mx-auto px-5 sm:px-6 lg:px-8 xl:px-[40px] h-[64px] lg:h-[76px] flex items-center justify-between flex-nowrap gap-2 xl:gap-4">
        {/* Left: Brand Logo (+ Tablet Home Pill on sm..lg) */}
        <div className="flex items-center gap-2.5 shrink-0">
          <Link
            to="/"
            className="inline-flex items-center gap-[8px] rounded-[6px] whitespace-nowrap shrink-0 focus:outline-none"
          >
            <span className="w-[28px] h-[28px] rounded-[7px] bg-white dark:bg-[#1E1C17] border border-[#E7E3D9] dark:border-[#332F26] shadow-sm flex items-center justify-center p-1 shrink-0 transition-colors">
              <SourceLogicLogo size={18} />
            </span>
            <span
              style={{ color: 'var(--solva-ink)' }}
              className="font-solva-sans text-[20px] font-medium tracking-[-0.02em] leading-none"
            >
              CITRA
            </span>
          </Link>

          <Link
            to="/"
            style={{
              backgroundColor: 'var(--solva-surface)',
              color: 'var(--solva-muted)',
            }}
            className="hidden sm:inline-flex lg:hidden items-center gap-1.5 h-[32px] px-2.5 rounded-[8px] font-solva-sans text-[13px] font-normal whitespace-nowrap shrink-0 hover:opacity-80 transition-opacity"
          >
            <ArrowLeft className="w-3.5 h-3.5 shrink-0" />
            <span>{lang === 'vi' ? 'Trang chủ' : 'Home'}</span>
          </Link>
        </div>

        {/* Center: Single-Row Solva Navigation Links (Never Wraps at 1024px or 1440px) */}
        <nav
          aria-label="Pricing Navigation"
          className="hidden lg:flex items-center justify-center flex-1 min-w-0 flex-nowrap gap-0.5 xl:gap-1.5"
        >
          <Link
            to="/"
            style={{ color: 'var(--solva-muted)' }}
            className="inline-flex items-center h-[40px] px-2.5 xl:px-3 rounded-[8px] font-solva-sans text-[14px] xl:text-[15px] font-normal whitespace-nowrap shrink-0 hover:opacity-80 transition-opacity"
          >
            {lang === 'vi' ? 'Trang chủ' : 'Home'}
          </Link>

          <div
            ref={dropdownContainerRef}
            className="relative shrink-0"
            onMouseLeave={() => setDropdownOpen(false)}
          >
            <button
              ref={dropdownTriggerRef}
              type="button"
              onClick={() => setDropdownOpen((prev) => !prev)}
              aria-expanded={dropdownOpen}
              aria-haspopup="true"
              style={{ color: 'var(--solva-muted)' }}
              className="inline-flex items-center gap-[5px] h-[40px] px-2.5 xl:px-3 rounded-[8px] font-solva-sans text-[14px] xl:text-[15px] font-normal whitespace-nowrap shrink-0 hover:opacity-80 transition-opacity cursor-pointer"
            >
              <span>{lang === 'vi' ? 'Nền tảng' : 'Platform'}</span>
              <SymmetricChevron open={dropdownOpen} size={14} />
            </button>

            {dropdownPresence.mounted && (
              <div
                className={`absolute left-0 top-[40px] pt-1 z-50 t-dropdown ${
                  dropdownPresence.phase === 'open' ? 'is-open' : 'is-closing'
                }`}
              >
                <div
                  style={{
                    backgroundColor: 'var(--solva-bg)',
                    borderColor: 'var(--solva-border)',
                  }}
                  className="w-[264px] p-[8px] rounded-[12px] border shadow-[0_4px_16px_rgba(0,0,0,0.06)] space-y-0.5"
                >
                  {dropdownItems.map((item) => {
                    const Icon = item.icon;
                    return (
                      <Link
                        key={item.href}
                        to={item.href}
                        onClick={() => setDropdownOpen(false)}
                        className="flex items-start gap-3 p-[10px_12px] rounded-[8px] hover:bg-[#F4F2EC] dark:hover:bg-[#1E1C17] transition-colors"
                      >
                        <Icon
                          style={{ color: 'var(--solva-ink)' }}
                          className="w-[18px] h-[18px] mt-0.5 shrink-0"
                        />
                        <div className="min-w-0">
                          <div
                            style={{ color: 'var(--solva-ink)' }}
                            className="font-solva-sans text-[14px] font-medium leading-tight"
                          >
                            {item.title}
                          </div>
                          <div
                            style={{ color: 'var(--solva-muted)' }}
                            className="font-solva-sans text-[12px] leading-snug mt-0.5"
                          >
                            {item.desc}
                          </div>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          <a
            href="#compare-matrix"
            style={{ color: 'var(--solva-muted)' }}
            className="inline-flex items-center h-[40px] px-2.5 xl:px-3 rounded-[8px] font-solva-sans text-[14px] xl:text-[15px] font-normal whitespace-nowrap shrink-0 hover:opacity-80 transition-opacity"
          >
            {lang === 'vi' ? 'So sánh gói' : 'Compare Plans'}
          </a>

          <a
            href="#pricing-faq"
            style={{ color: 'var(--solva-muted)' }}
            className="inline-flex items-center h-[40px] px-2.5 xl:px-3 rounded-[8px] font-solva-sans text-[14px] xl:text-[15px] font-normal whitespace-nowrap shrink-0 hover:opacity-80 transition-opacity"
          >
            {lang === 'vi' ? 'Giải đáp' : 'Billing FAQ'}
          </a>

          <Link
            to="/#benchmark-120k"
            style={{ color: 'var(--solva-muted)' }}
            className="inline-flex items-center gap-1.5 h-[40px] px-2.5 xl:px-3 rounded-[8px] font-solva-sans text-[14px] xl:text-[15px] font-normal whitespace-nowrap shrink-0 hover:opacity-80 transition-opacity"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse shrink-0" />
            <span>{lang === 'vi' ? 'Thực nghiệm 120K' : '120K Benchmark'}</span>
          </Link>
        </nav>

        {/* Right: Lang, Theme, Sign In, Primary Double-Slide CTA */}
        <div className="flex items-center justify-end flex-nowrap gap-1.5 sm:gap-2 shrink-0">
          <button
            type="button"
            onClick={onToggleLanguage}
            style={{
              backgroundColor: 'var(--solva-surface)',
              color: 'var(--solva-ink)',
            }}
            className="inline-flex items-center gap-1 h-[36px] px-2.5 rounded-[8px] font-mono text-[12px] font-medium whitespace-nowrap shrink-0 hover:opacity-85 transition-opacity cursor-pointer"
            title={lang === 'vi' ? 'Switch to English' : 'Chuyển sang Tiếng Việt'}
          >
            <Globe className="w-3.5 h-3.5 shrink-0" />
            <span>{lang === 'vi' ? 'VI' : 'EN'}</span>
          </button>

          <ThemeToggle size="sm" />

          <Link
            to="/login"
            style={{ color: 'var(--solva-muted)' }}
            className="hidden sm:inline-flex items-center h-[40px] px-2.5 xl:px-3 rounded-[8px] font-solva-sans text-[14px] xl:text-[15px] font-normal whitespace-nowrap shrink-0 hover:opacity-80 transition-opacity"
          >
            {lang === 'vi' ? 'Đăng nhập' : 'Sign in'}
          </Link>

          <SolvaButton to="/register" variant="primary" className="hidden sm:inline-flex shrink-0">
            {lang === 'vi' ? 'Đăng ký' : 'Start Free'}
          </SolvaButton>

          <button
            ref={mobileToggleRef}
            type="button"
            onClick={() => setMobileMenuOpen((prev) => !prev)}
            aria-label="Toggle navigation menu"
            aria-expanded={mobileMenuOpen}
            style={{
              backgroundColor: 'var(--solva-surface)',
              color: 'var(--solva-ink)',
            }}
            className="lg:hidden inline-flex items-center justify-center w-[40px] h-[40px] rounded-[8px] shrink-0 cursor-pointer"
          >
            <IconSwap
              active={mobileMenuOpen}
              iconA={<Menu className="w-4 h-4" />}
              iconB={<X className="w-4 h-4" />}
            />
          </button>
        </div>
      </div>

      {/* Mobile Drawer */}
      {mobileDrawerPresence.mounted && (
        <nav
          aria-label="Mobile Pricing Navigation"
          style={{
            backgroundColor: 'var(--solva-bg)',
            borderColor: 'var(--solva-border)',
          }}
          className={`lg:hidden border-t border-b px-5 py-4 space-y-2 shadow-lg t-mobile-drawer ${
            mobileDrawerPresence.phase === 'open' ? 'is-open' : 'is-closing'
          }`}
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            <Link
              to="/"
              onClick={() => setMobileMenuOpen(false)}
              style={{
                backgroundColor: 'var(--solva-surface)',
                color: 'var(--solva-ink)',
              }}
              className="flex items-center justify-between min-h-[44px] px-3.5 py-2.5 rounded-[10px] font-solva-sans text-[14px] font-medium"
            >
              <span>{lang === 'vi' ? 'Quay về Trang chủ' : 'Back to Home'}</span>
              <ChevronRight className="w-4 h-4 opacity-60 shrink-0" />
            </Link>
            <a
              href="#compare-matrix"
              onClick={() => setMobileMenuOpen(false)}
              style={{
                backgroundColor: 'var(--solva-surface)',
                color: 'var(--solva-ink)',
              }}
              className="flex items-center justify-between min-h-[44px] px-3.5 py-2.5 rounded-[10px] font-solva-sans text-[14px] font-medium"
            >
              <span>{lang === 'vi' ? 'Bảng so sánh tính năng' : 'Compare Plans'}</span>
              <ChevronRight className="w-4 h-4 opacity-60 shrink-0" />
            </a>
            <a
              href="#pricing-faq"
              onClick={() => setMobileMenuOpen(false)}
              style={{
                backgroundColor: 'var(--solva-surface)',
                color: 'var(--solva-ink)',
              }}
              className="flex items-center justify-between min-h-[44px] px-3.5 py-2.5 rounded-[10px] font-solva-sans text-[14px] font-medium"
            >
              <span>{lang === 'vi' ? 'Giải đáp thanh toán' : 'Billing FAQ'}</span>
              <ChevronRight className="w-4 h-4 opacity-60 shrink-0" />
            </a>
          </div>

          <div className="pt-2 flex items-center gap-2">
            <SolvaButton
              to="/login"
              variant="outline"
              fullWidth
              onClick={() => setMobileMenuOpen(false)}
            >
              {lang === 'vi' ? 'Đăng nhập' : 'Sign in'}
            </SolvaButton>
            <SolvaButton
              to="/register"
              variant="primary"
              fullWidth
              onClick={() => setMobileMenuOpen(false)}
            >
              {lang === 'vi' ? 'Bắt đầu miễn phí' : 'Start Free'}
            </SolvaButton>
          </div>
        </nav>
      )}
    </header>
  );
}

/* ============================================================
   2-COLUMN ACCORDION FAQ FOR PRICING & BILLING (`#pricing-faq`)
   ============================================================ */
function PricingSolvaFAQSection({
  lang,
  isEmbedded,
  demoEvaluatorMode,
  billingCycle,
}: {
  lang: Lang;
  isEmbedded: boolean;
  demoEvaluatorMode: boolean;
  billingCycle: BillingCycle;
}) {
  const [openIds, setOpenIds] = useState<Record<string, boolean>>({
    'pfaq-0': true,
  });

  const toggleFaq = (id: string) => {
    setOpenIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const activeProLabelVi =
    billingCycle === 'annual'
      ? '400.000 ₫/tháng · $16/tháng khi trả theo năm'
      : '500.000 ₫/tháng · $20/tháng khi trả theo tháng';
  const activeProLabelEn =
    billingCycle === 'annual' ? '$16/mo billed annually' : '$20/mo billed monthly';

  const leftFaqs = [
    {
      id: 'pfaq-0',
      q:
        lang === 'vi'
          ? 'Gói Basic miễn phí có giới hạn thời gian sử dụng không?'
          : 'Is the Basic ($0) tier really free forever?',
      a:
        lang === 'vi'
          ? 'Hoàn toàn miễn phí trọn đời và không yêu cầu thẻ tín dụng. Mỗi tháng tài khoản Basic được cấp mới 3 lượt kiểm tra bản thảo (.PDF, .DOCX, .BIB, .RIS — tối đa 15 trang và 30 trích dẫn mỗi bài) cùng đầy đủ kết quả đối chiếu trích dẫn trong bài và xác minh nguồn thật.'
          : 'Yes — Basic is free forever with no credit card required. Your quota automatically resets every month with 3 manuscript checks (.PDF, .DOCX, .BIB, .RIS — up to 15 pages and 30 citations per document) with complete in-text link and real-source verification.',
    },
    {
      id: 'pfaq-1',
      q:
        lang === 'vi'
          ? `Sự khác biệt lớn nhất khi nâng cấp lên gói Pro (${activeProLabelVi}) là gì?`
          : `What unlocks immediately when I upgrade to Pro (${activeProLabelEn})?`,
      a:
        lang === 'vi'
          ? 'Gói Pro nâng hạn mức lên 50 tài liệu/tháng (tối đa 100 trang, 200 trích dẫn/bài), mở khóa toàn bộ hơn 15 thư viện học thuật quốc tế (PubMed, arXiv, DBLP, DOAJ, DataCite, Retraction Watch, Wayback Machine), đối chiếu nội dung tóm tắt bài gốc, gợi ý sửa định dạng trích dẫn 1 chạm, trình đọc đối chiếu trực tiếp trên trang PDF và xuất báo cáo ra PDF/DOCX/CSV.'
          : 'Pro unlocks 50 manuscripts/month (up to 100 pages & 200 citations each), all 15+ trusted academic libraries, source-abstract content matching, one-click citation formatting fixes, side-by-side PDF page inspection, and full PDF/DOCX/CSV report exports.',
    },
    {
      id: 'pfaq-2',
      q:
        lang === 'vi'
          ? 'Thanh toán theo Năm (Tiết kiệm 20%) hoạt động như thế nào?'
          : 'How does the 20% Annual Billing discount work?',
      a:
        lang === 'vi'
          ? 'Khi chọn chu kỳ Thanh toán theo Năm, gói Pro giảm từ $20 xuống còn $16/tháng (thanh toán $192/năm — tiết kiệm $48) và gói Ultra giảm từ $200 xuống $160/tháng (tiết kiệm $480/năm), tương đương hơn 2 tháng sử dụng miễn phí.'
          : 'When billed annually, Pro drops from $20 to $16/month ($192/year — saving $48) and Ultra drops from $200 to $160/month ($1,920/year — saving $480), giving you over 2 months free.',
    },
  ];

  const rightFaqs = [
    {
      id: 'pfaq-3',
      q:
        lang === 'vi'
          ? 'Tôi có thể hủy gia hạn tự động hoặc đổi gói bất cứ lúc nào không?'
          : 'Can I cancel auto-renewal or switch plans at any time?',
      a:
        lang === 'vi'
          ? 'Có. Bạn có thể hủy gia hạn tự động hoặc kích hoạt lại chỉ với 1 cú nhấp chuột trong mục Cài đặt (Cài đặt → Quản lý Gói cước). Khi hủy gia hạn, bạn vẫn giữ nguyên toàn bộ quyền lợi Pro/Ultra cho đến hết chu kỳ đã thanh toán.'
          : 'Yes. You can cancel or reactivate auto-renewal with one click from your Settings page. If you cancel, your Pro or Ultra features remain active through the end of your current billing period.',
    },
    {
      id: 'pfaq-4',
      q: demoEvaluatorMode
        ? lang === 'vi'
          ? 'Cổng thanh toán Stripe Demo hỗ trợ những thẻ thử nghiệm nào?'
          : 'How does Stripe Checkout work in this academic workspace?'
        : lang === 'vi'
          ? 'CITRA hỗ trợ những phương thức thanh toán mã hóa nào?'
          : 'Which encrypted payment methods does CITRA support?',
      a: demoEvaluatorMode
        ? lang === 'vi'
          ? 'Hệ thống tích hợp cổng thanh toán Stripe bảo mật kèm chế độ điền nhanh thẻ kiểm thử 1-Click (Visa 4242 / Mastercard 4444) để hội đồng và người dùng trải nghiệm trọn vẹn luồng nâng cấp hóa đơn và mở khóa tính năng tức thì.'
          : 'CITRA integrates Stripe Checkout with 1-click test card autofill (Visa 4242 & Mastercard 4444) so evaluators, researchers, and students can experience instant tier activation and invoice generation.'
        : lang === 'vi'
          ? 'CITRA xử lý thanh toán qua kết nối mã hóa TLS 1.3 trên hạ tầng chuẩn bảo mật PCI-DSS của Stripe (thẻ quốc tế Visa, Mastercard, Apple Pay, Google Pay) và cổng thanh toán nội địa VNPay (quét mã VNPAY-QR, thẻ ATM/NAPAS ngân hàng Việt Nam). CITRA không lưu trữ số thẻ gốc; hạn mức gói cước và biên lai điện tử được kích hoạt tức thì ngay sau khi xác thực giao dịch.'
          : 'CITRA processes payments over TLS 1.3 through PCI-DSS compliant Stripe (Visa, Mastercard, Apple Pay, Google Pay) and VNPay (VNPAY-QR and domestic Vietnamese ATM/NAPAS cards). CITRA never stores raw card numbers, and your upgraded tier quota and digital receipt unlock immediately upon payment confirmation.',
    },
    {
      id: 'pfaq-5',
      q:
        lang === 'vi'
          ? 'Gói Ultra dành cho Bộ môn & Phòng thí nghiệm có ưu điểm gì đặc biệt?'
          : 'When should a research lab or department choose Ultra?',
      a:
        lang === 'vi'
          ? 'Gói Ultra hỗ trợ tài liệu dài tới 500 trang (luận án Tiến sĩ, sách chuyên khảo), tải lên hàng loạt 50 tệp PDF cùng lúc, tra cứu mở rộng qua Google Scholar cho tài liệu hiếm, quản lý không giới hạn lớp học và tải trọn bộ báo cáo cả lớp dạng tệp nén ZIP.'
          : 'Ultra is designed for departments and thesis review committees: supporting 500-page doctoral dissertations, 50-file concurrent batch uploads, extended Google Scholar lookup for rare publications, unlimited classroom cohorts, and full-cohort archive exports (.ZIP).',
    },
  ];

  const renderColumn = (items: typeof leftFaqs, colOffset: number) => (
    <div className="flex-1 flex flex-col gap-[16px] w-full">
      {items.map((item, idx) => {
        const isOpen = Boolean(openIds[item.id]);
        return (
          <SolvaScrollReveal
            key={item.id}
            delayMs={colOffset + idx * 65}
            yOffset={24}
          >
            <div
              style={{ backgroundColor: 'var(--solva-surface)' }}
              className="w-full rounded-[12px] px-[24px] transition-colors duration-200"
            >
              <button
                type="button"
                onClick={() => toggleFaq(item.id)}
                aria-expanded={isOpen}
                className="w-full min-h-[73px] py-[20px] flex items-center justify-between gap-4 text-left cursor-pointer group"
              >
                <span
                  style={{ color: 'var(--solva-ink)' }}
                  className="font-solva-sans text-[17px] sm:text-[18px] font-normal leading-[25.2px]"
                >
                  {item.q}
                </span>
                <span
                  style={{ color: 'var(--solva-ink)' }}
                  className="relative w-[20px] h-[25px] flex items-center justify-center shrink-0"
                >
                  <Plus
                    className={`w-4 h-4 absolute transition-[transform,opacity] duration-[250ms] ease-[cubic-bezier(0.22,1,0.36,1)] ${
                      isOpen
                        ? 'rotate-90 opacity-0 scale-75'
                        : 'rotate-0 opacity-100 scale-100'
                    }`}
                  />
                  <Minus
                    className={`w-4 h-4 absolute transition-[transform,opacity] duration-[250ms] ease-[cubic-bezier(0.22,1,0.36,1)] ${
                      isOpen
                        ? 'rotate-0 opacity-100 scale-100'
                        : '-rotate-90 opacity-0 scale-75'
                    }`}
                  />
                </span>
              </button>
              <div
                data-open={isOpen ? 'true' : 'false'}
                style={{
                  gridTemplateRows: isOpen ? '1fr' : '0fr',
                  transition: isOpen
                    ? 'grid-template-rows 300ms cubic-bezier(0.22, 1, 0.36, 1)'
                    : 'grid-template-rows 190ms cubic-bezier(0.32, 0.72, 0, 1)',
                }}
                className="grid"
                aria-hidden={!isOpen}
              >
                <div className="overflow-hidden">
                  <div
                    style={{
                      opacity: isOpen ? 1 : 0,
                      transform: isOpen
                        ? 'translate3d(0, 0, 0)'
                        : 'translate3d(0, -8px, 0)',
                      filter: isOpen ? 'blur(0px)' : 'blur(2px)',
                      transition: isOpen
                        ? 'opacity 260ms cubic-bezier(0.22, 1, 0.36, 1), transform 300ms cubic-bezier(0.22, 1, 0.36, 1), filter 240ms cubic-bezier(0.22, 1, 0.36, 1)'
                        : 'opacity 150ms cubic-bezier(0.32, 0.72, 0, 1), transform 190ms cubic-bezier(0.32, 0.72, 0, 1), filter 150ms cubic-bezier(0.32, 0.72, 0, 1)',
                    }}
                    className="pb-[24px] pr-[24px]"
                  >
                    <p
                      style={{ color: 'var(--solva-muted)' }}
                      className="font-solva-sans text-[16px] font-normal leading-[23.2px]"
                    >
                      {item.a}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </SolvaScrollReveal>
        );
      })}
    </div>
  );

  return (
    <section
      id="pricing-faq"
      className={`scroll-mt-[84px] lg:scroll-mt-[108px] py-[32px] sm:py-[48px] lg:py-[80px] ${
        isEmbedded ? 'px-3 sm:px-6' : 'px-5 sm:px-6 lg:px-[40px]'
      }`}
    >
      <div className="max-w-[1200px] mx-auto flex flex-col gap-[28px] sm:gap-[36px] lg:gap-[56px]">
        <div className="flex flex-col items-start gap-[12px] max-w-[520px]">
          <SolvaEyebrow>
            {lang === 'vi' ? 'Câu hỏi về Gói cước & Thanh toán' : 'Billing & Plans FAQ'}
          </SolvaEyebrow>
          <SolvaTwoToneHeading
            primary={
              lang === 'vi' ? 'Giải đáp mọi thắc mắc' : 'Questions about plans,'
            }
            secondary={
              lang === 'vi' ? 'trước khi bạn nâng cấp.' : 'answered clearly.'
            }
          />
        </div>

        <div className="flex flex-col lg:flex-row items-start gap-[16px]">
          {renderColumn(leftFaqs, 0)}
          {renderColumn(rightFaqs, 75)}
        </div>
      </div>
    </section>
  );
}

/* ============================================================
   FULL-BLEED SOLVA FOOTER FOR PUBLIC `/pricing` VIEW
   ============================================================ */
function PricingSolvaFooter({ lang }: { lang: Lang }) {
  const columns = [
    {
      header: lang === 'vi' ? 'Nền tảng' : 'Product',
      links: [
        { label: lang === 'vi' ? 'Cách hoạt động' : 'How It Works', to: '/#how-it-works' },
        { label: lang === 'vi' ? 'Kiểm tra thử trích dẫn' : 'Live Citation Check', to: '/#interactive-demo' },
        { label: lang === 'vi' ? 'Kiểm tra 2 bước rõ ràng' : 'Two-Step Citation Check', to: '/#architecture' },
        { label: lang === 'vi' ? 'Độ tin cậy (120.000 bài)' : 'Proven Accuracy (120K)', to: '/#benchmark-120k' },
        { label: lang === 'vi' ? 'Bảng so sánh gói cước' : 'Comparison Matrix', href: '#compare-matrix' },
      ],
    },
    {
      header: lang === 'vi' ? 'Không gian học thuật' : 'Workspaces',
      links: [
        { label: lang === 'vi' ? 'Dành cho Sinh viên & Tác giả' : 'Student Workspace', to: '/#workspaces-student' },
        { label: lang === 'vi' ? 'Dành cho Giảng viên & Hội đồng' : 'Teacher Classroom', to: '/#workspaces-teacher' },
        { label: lang === 'vi' ? 'Trung tâm Quản trị' : 'Admin Control', to: '/#workspaces-admin' },
        { label: lang === 'vi' ? 'Trang chủ CITRA' : 'CITRA Home', to: '/' },
      ],
    },
    {
      header: lang === 'vi' ? 'Công nghệ' : 'Capabilities',
      links: [
        { label: lang === 'vi' ? 'Đọc chuẩn APA, IEEE, Harvard' : 'APA, IEEE & Harvard Reader', to: '/#how-it-works' },
        { label: lang === 'vi' ? 'Tra cứu 15+ thư viện học thuật' : '15+ Academic Libraries', to: '/#architecture' },
        { label: lang === 'vi' ? 'Đối chiếu chi tiết từng trường' : 'Side-by-Side Detail Checks', to: '/#interactive-demo' },
        { label: lang === 'vi' ? 'Đối chiếu nội dung Việt ↔ Anh' : 'Bilingual Abstract Matching', to: '/#how-it-works' },
      ],
    },
    {
      header: lang === 'vi' ? 'Tài khoản' : 'Account',
      links: [
        { label: lang === 'vi' ? 'Đăng nhập' : 'Sign in', to: '/login' },
        { label: lang === 'vi' ? 'Đăng ký tài khoản' : 'Create account', to: '/register' },
        { label: lang === 'vi' ? 'Câu hỏi thường gặp' : 'Billing FAQ', href: '#pricing-faq' },
        {
          label:
            lang === 'vi'
              ? 'Chính sách bảo vệ dữ liệu'
              : 'Personal Data Policy',
          to: '/privacy',
        },
        {
          label: lang === 'vi' ? 'Điều khoản dịch vụ' : 'Terms of Service',
          to: '/terms',
        },
      ],
    },
  ];

  return (
    <footer
      style={{ backgroundColor: 'var(--solva-surface)' }}
      className="pt-[36px] sm:pt-[48px] lg:pt-[96px] pb-[24px] sm:pb-[32px] px-5 sm:px-6 lg:px-[40px]"
    >
      <div className="max-w-[1200px] mx-auto flex flex-col gap-[28px] sm:gap-[36px] lg:gap-[48px]">
        <div className="flex flex-col lg:flex-row items-start justify-between gap-[28px] sm:gap-[36px] lg:gap-[32px]">
          <div className="w-full lg:w-[389px] flex flex-col items-start gap-[16px]">
            <Link to="/" className="inline-flex items-center gap-[10px]">
              <span className="w-[32px] h-[32px] rounded-[8px] bg-white dark:bg-[#1E1C17] border border-[#E7E3D9] dark:border-[#332F26] shadow-sm flex items-center justify-center p-1 shrink-0 transition-colors">
                <SourceLogicLogo size={20} />
              </span>
              <span
                style={{ color: 'var(--solva-ink)' }}
                className="font-solva-sans text-[28px] font-medium tracking-[-0.02em] leading-none"
              >
                CITRA
              </span>
            </Link>

            <p
              style={{ color: 'var(--solva-muted)' }}
              className="font-solva-sans text-[16px] font-normal leading-[23.2px] max-w-[310px]"
            >
              {lang === 'vi'
                ? 'Không gian kiểm chứng trích dẫn học thuật giúp sinh viên, nhà nghiên cứu và giảng viên tự tin với mọi danh mục tài liệu tham khảo.'
                : 'Academic citation verification workspace helping students, researchers, and faculty submit every paper with verified references.'}
            </p>
          </div>

          <div className="w-full lg:w-[779px] grid grid-cols-2 sm:grid-cols-4 gap-[24px]">
            {columns.map((col) => (
              <div key={col.header} className="flex flex-col gap-[12px]">
                <h4
                  style={{ color: 'var(--solva-ink)' }}
                  className="font-solva-sans text-[18px] font-normal leading-[25.2px]"
                >
                  {col.header}
                </h4>
                <ul className="flex flex-col gap-[10px]">
                  {col.links.map((lnk) => (
                    <li key={lnk.label}>
                      {'to' in lnk && lnk.to ? (
                        <Link
                          to={lnk.to}
                          style={{ color: 'var(--solva-muted)' }}
                          className="font-solva-sans text-[16px] font-normal leading-[23.2px] hover:opacity-75 transition-opacity"
                        >
                          {lnk.label}
                        </Link>
                      ) : (
                        <a
                          href={lnk.href}
                          style={{ color: 'var(--solva-muted)' }}
                          className="font-solva-sans text-[16px] font-normal leading-[23.2px] hover:opacity-75 transition-opacity"
                        >
                          {lnk.label}
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        <div
          style={{ borderColor: 'var(--solva-border)' }}
          className="pt-[20px] sm:pt-[32px] border-t flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-4 font-solva-sans text-[14px] sm:text-[16px]"
        >
          <p style={{ color: 'var(--solva-muted)' }}>
            {lang === 'vi'
              ? '© 2026 CITRA — Không gian Kiểm chứng Trích dẫn Học thuật. Bảo lưu mọi quyền.'
              : '© 2026 CITRA — Academic Citation Integrity Workspace. All rights reserved.'}
          </p>
          <p style={{ color: 'var(--solva-muted)' }}>
            {lang === 'vi'
              ? 'Hệ thống hỗ trợ rà soát học thuật — không thay thế phán quyết của giảng viên.'
              : 'Decision-Support System — assists scholarly review, never replaces human judgment.'}
          </p>
        </div>
      </div>
    </footer>
  );
}
