import { useState, useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  SCHOLARLY_APIS_LABEL,
  SYMBOLIC_RULES_RANGE,
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
  ChevronDown,
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
import { ThemeToggle } from '@/contexts/ThemeContext';
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
  SolvaLiveNumber,
  useFloralCardAnimation,
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

interface ComparisonRow {
  category_en: string;
  category_vi: string;
  basic: string | boolean;
  pro: string | boolean;
  ultra: string | boolean;
}

const COMPARISON_MATRIX: ComparisonRow[] = [
  {
    category_en: 'Monthly PDF & Word (.docx) Checks',
    category_vi: 'Số lượt tải & kiểm tra PDF / Word (.docx) / tháng',
    basic: '3 docs / mo',
    pro: '50 docs / mo',
    ultra: 'Unlimited (1,000/mo)',
  },
  {
    category_en: 'Maximum File Size (.pdf / .docx)',
    category_vi: 'Dung lượng file tối đa (.pdf / .docx)',
    basic: '5 MB',
    pro: '25 MB',
    ultra: '100 MB',
  },
  {
    category_en: 'Maximum Pages per Manuscript',
    category_vi: 'Giới hạn số trang mỗi tài liệu',
    basic: '15 pages',
    pro: '100 pages',
    ultra: '500 pages',
  },
  {
    category_en: 'Citations Verified per Document',
    category_vi: 'Số trích dẫn kiểm chứng tối đa / bài',
    basic: 'Up to 30',
    pro: 'Up to 200',
    ultra: 'Unlimited',
  },
  {
    category_en: 'Concurrent Batch Upload (.pdf / .docx)',
    category_vi: 'Tải lên hàng loạt (Batch Check)',
    basic: false,
    pro: 'Up to 10 files',
    ultra: 'Up to 50 files',
  },
  {
    category_en: 'Scholarly Databases & Legal Registry',
    category_vi: 'CSDL Học thuật & Hệ thống Pháp luật Việt Nam',
    basic: 'Local 127K + Crossref + OpenAlex + VN Legal',
    pro: '15+ Scholarly & Technical APIs (+DataCite, DOAJ, HAL, NCBI/bioRxiv, HF, RFC, Wayback, Retraction Watch)',
    ultra: 'All 15+ APIs + SerpAPI Google Scholar Fallback',
  },
  {
    category_en: '1-Click Bibliography Auto-Fix Studio (BibTeX / RIS)',
    category_vi: '1-Click Auto-Fix Studio (Chuẩn hóa APA, IEEE, TDTU, BibTeX, RIS)',
    basic: false,
    pro: true,
    ultra: true,
  },
  {
    category_en: 'Deep Neural Sentence-BERT Evidence & Stance',
    category_vi: 'Đối chiếu câu bằng chứng Sentence-BERT & Stance',
    basic: false,
    pro: true,
    ultra: true,
  },
  {
    category_en: 'Interactive PDF Page Preview (Bounding-Box)',
    category_vi: 'Document Inspector (Xem trang PDF & Highlight tọa độ)',
    basic: false,
    pro: true,
    ultra: true,
  },
  {
    category_en: 'Interactive Citation Network & Evidence DAG Graph',
    category_vi: 'Đồ thị Mạng lưới Trích dẫn & Cây suy diễn Bằng chứng',
    basic: false,
    pro: true,
    ultra: true,
  },
  {
    category_en: 'Academic Report Export Formats',
    category_vi: 'Định dạng xuất báo cáo học thuật',
    basic: 'Web View (JSON)',
    pro: 'PDF, DOCX (Word), CSV, JSON, BibTeX, RIS',
    ultra: 'PDF, DOCX, CSV, JSON, BibTeX, RIS + Class ZIP',
  },
  {
    category_en: 'Classroom Join Code (CITRA-XXXX) & Cohort Analytics',
    category_vi: 'Mã lớp học (CITRA-XXXX), Thống kê khóa luận & Ghi đè (Override)',
    basic: 'Self-Join Classes',
    pro: 'Up to 3 Classes + Cohort Analytics',
    ultra: 'Unlimited Classes & Audit Log',
  },
  {
    category_en: 'Verification History Retention',
    category_vi: 'Thời gian lưu trữ lịch sử báo cáo',
    basic: '7 days',
    pro: '1 year',
    ultra: 'Unlimited Lifetime',
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
      className={`group relative inline-flex items-center justify-center w-full h-[46px] px-[18px] pt-[1px] rounded-[10px] font-solva-sans text-[14px] font-medium leading-[21px] transition-all duration-200 select-none ${
        disabled ? 'opacity-55 cursor-not-allowed' : 'cursor-pointer hover:opacity-95'
      }`}
    >
      <span className="pointer-events-none relative h-[21px] overflow-hidden flex flex-col items-center">
        <span
          className={`flex flex-col transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] ${
            disabled ? '' : 'group-hover:-translate-y-[21px]'
          }`}
        >
          <span className="h-[21px] flex items-center justify-center whitespace-nowrap gap-1.5">
            {children}
          </span>
          <span
            className="h-[21px] flex items-center justify-center whitespace-nowrap gap-1.5"
            aria-hidden="true"
          >
            {children}
          </span>
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

  const lang: Lang = i18n.language?.startsWith('vi') ? 'vi' : 'en';
  const quotaView = getQuotaView(quota, lang, { isAdmin });
  // Admins always have Ultra-level access (contract C3): every checkout CTA is
  // disabled and Ultra is shown as the current plan.
  const adminLocked = Boolean(user && isAdmin);
  const [billingCycle, setBillingCycle] = useState<BillingCycle>('annual');
  const [loadingTier, setLoadingTier] = useState<'pro' | 'ultra' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canceled = searchParams.get('canceled') === '1';

  const { containerRef: pricingRef, replaySeed: pricingSeed } = useFloralCardAnimation(5400);

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
      navigate('/login');
      return;
    }

    setLoadingTier(targetTier);
    setError(null);
    try {
      const session = await api.createCheckoutSession({
        plan_tier: targetTier,
        billing_cycle: billingCycle,
      });
      if (session.checkout_url.startsWith('http')) {
        window.location.href = session.checkout_url;
      } else {
        navigate(session.checkout_url);
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : lang === 'vi'
            ? 'Không thể khởi tạo thanh toán Stripe.'
            : 'Failed to create Stripe checkout session.',
      );
    } finally {
      setLoadingTier(null);
    }
  };

  const proPrice = billingCycle === 'annual' ? 16 : 20;
  const ultraPrice = billingCycle === 'annual' ? 160 : 200;

  return (
    <div
      className={`solva-editorial-root ${
        user ? 'rounded-[20px] pb-12' : 'min-h-screen overflow-x-hidden'
      } selection:bg-[#1C1A15] selection:text-[#FBFAF6]`}
      data-testid="pricing-page"
    >
      {/* Fixed Solva Navbar when accessed publicly */}
      {!user && (
        <PricingSolvaHeader
          lang={lang}
          onToggleLanguage={toggleLanguage}
        />
      )}

      <main id="pricing-main-content">
        {/* ============================================================
            SECTION 1: HERO & INTERACTIVE BILLING CYCLE SELECTOR + 3 TIERS
            ============================================================ */}
        <section
          className={`${
            user
              ? 'pt-[16px] sm:pt-[24px] pb-[40px] sm:pb-[64px] px-3 sm:px-6'
              : 'pt-[96px] sm:pt-[116px] lg:pt-[136px] pb-[48px] sm:pb-[64px] lg:pb-[88px] px-5 sm:px-6 lg:px-[40px]'
          }`}
        >
          <div className="max-w-[1200px] mx-auto flex flex-col items-center gap-[28px] sm:gap-[36px] lg:gap-[48px]">
            {/* Hero Header */}
            <div className="flex flex-col items-center text-center gap-[16px] max-w-[760px]">
              <SolvaEyebrow centered>
                {lang === 'vi'
                  ? 'Bảng giá học thuật minh bạch · Thanh toán Stripe & VNPay'
                  : 'Transparent academic pricing · Powered by Stripe & VNPay'}
              </SolvaEyebrow>

              <SolvaTwoToneHeading
                as="h1"
                size="h1"
                centered
                primary={
                  lang === 'vi'
                    ? 'Đầu tư cho sự toàn vẹn khoa học.'
                    : 'Invest in rigorous citation integrity.'
                }
                secondary={
                  lang === 'vi'
                    ? 'Minh bạch chi phí, tối ưu mọi quy mô.'
                    : 'Simple plans, built for every research scale.'
                }
              />

              <SolvaScrollReveal delayMs={80} yOffset={20}>
                <p
                  style={{ color: 'var(--solva-muted)' }}
                  className="font-solva-sans text-[15px] sm:text-[16px] font-normal leading-[23.8px] max-w-[680px] pt-1"
                >
                  {lang === 'vi'
                    ? 'Bắt đầu miễn phí với gói Basic cho bài tiểu luận ngắn, hoặc nâng cấp lên Pro & Ultra để mở khóa toàn bộ 15+ cơ sở dữ liệu học thuật & kỹ thuật (DataCite, DOAJ, OpenAIRE/HAL, NCBI/bioRxiv, Hugging Face, IETF RFC, Wayback Machine, Retraction Watch), Sentence-BERT Deep Neural và xuất báo cáo chuẩn hội đồng.'
                    : 'Start free with Basic for course essays, or upgrade to Pro & Ultra for full 15+ scholarly & technical API retrieval (DataCite, DOAJ, OpenAIRE/HAL, NCBI/bioRxiv, Hugging Face, IETF RFC, Wayback Machine, Retraction Watch), Sentence-BERT Deep Neural verification, and academic PDF/DOCX exports.'}
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

              {/* Billing Cycle Toggle (Segmented Solva Track + Squircle Indicator) */}
              <SolvaScrollReveal delayMs={130} yOffset={18}>
                <div className="pt-2 flex flex-col items-center gap-2.5">
                  <div
                    style={{
                      backgroundColor: 'var(--solva-surface)',
                      borderColor: 'var(--solva-border)',
                    }}
                    className="inline-flex items-center p-[5px] rounded-[12px] border gap-1"
                    role="group"
                    aria-label="Billing cycle selector"
                  >
                    <button
                      type="button"
                      data-testid="billing-toggle-monthly"
                      onClick={() => setBillingCycle('monthly')}
                      style={
                        billingCycle === 'monthly'
                          ? {
                              backgroundColor: 'var(--solva-btn-bg)',
                              color: 'var(--solva-btn-fg)',
                            }
                          : {
                              backgroundColor: 'transparent',
                              color: 'var(--solva-muted)',
                            }
                      }
                      className="px-4 sm:px-5 py-2 rounded-[8px] font-solva-sans text-[13px] sm:text-[14px] font-medium transition-all duration-200 cursor-pointer"
                    >
                      {lang === 'vi' ? 'Thanh toán theo Tháng' : 'Monthly Billing'}
                    </button>

                    <button
                      type="button"
                      data-testid="billing-toggle-annual"
                      onClick={() => setBillingCycle('annual')}
                      style={
                        billingCycle === 'annual'
                          ? {
                              backgroundColor: 'var(--solva-btn-bg)',
                              color: 'var(--solva-btn-fg)',
                            }
                          : {
                              backgroundColor: 'transparent',
                              color: 'var(--solva-muted)',
                            }
                      }
                      className="px-4 sm:px-5 py-2 rounded-[8px] font-solva-sans text-[13px] sm:text-[14px] font-medium transition-all duration-200 flex items-center gap-2 cursor-pointer"
                    >
                      <span>{lang === 'vi' ? 'Thanh toán theo Năm' : 'Annual Billing'}</span>
                      <span className="px-2 py-0.5 rounded-[6px] bg-emerald-600 text-white text-[11px] font-mono font-semibold leading-none">
                        {lang === 'vi' ? 'Tiết kiệm 20%' : 'Save 20%'}
                      </span>
                    </button>
                  </div>

                  <p className="font-solva-sans text-[13px] text-emerald-700 dark:text-emerald-400 font-medium">
                    {billingCycle === 'annual'
                      ? lang === 'vi'
                        ? '✨ Đang áp dụng ưu đãi trả theo năm: Tặng tương đương > 2 tháng sử dụng miễn phí!'
                        : '✨ Annual discount active: Equivalent to over 2 months free!'
                      : lang === 'vi'
                        ? '💡 Mẹo: Chuyển sang gói theo Năm để tiết kiệm ngay $48/năm (Pro) hoặc $480/năm (Ultra).'
                        : '💡 Tip: Switch to Annual billing to save $48/year on Pro or $480/year on Ultra.'}
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
                ============================================================ */}
            <div
              ref={pricingRef}
              className="w-full grid grid-cols-1 lg:grid-cols-3 gap-[16px] items-stretch"
            >
              {/* 1. BASIC TIER */}
              <SolvaScrollReveal delayMs={0} yOffset={36} className="h-full">
                <div
                  style={{
                    backgroundColor: 'var(--solva-surface)',
                    borderColor: 'var(--solva-border)',
                  }}
                  className="relative rounded-[16px] border p-[28px] sm:p-[32px] flex flex-col justify-between gap-[24px] h-full"
                  data-testid="plan-card-basic"
                >
                  <div className="space-y-[20px]">
                    {/* Header */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-3">
                        <div
                          style={{
                            backgroundColor: 'var(--solva-bg)',
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
                      <span
                        style={{
                          backgroundColor: 'var(--solva-bg)',
                          borderColor: 'var(--solva-border)',
                          color: 'var(--solva-muted)',
                        }}
                        className="px-[8px] py-[4px] rounded-[6px] border font-mono text-[11px] font-medium leading-none"
                      >
                        {lang === 'vi' ? 'MẶC ĐỊNH' : 'DEFAULT'}
                      </span>
                    </div>

                    {/* Description */}
                    <p
                      style={{ color: 'var(--solva-muted)' }}
                      className="font-solva-sans text-[15px] leading-[22.5px] min-h-[45px]"
                    >
                      {lang === 'vi'
                        ? 'Phù hợp để làm quen hệ thống và rà soát nhanh các bài tập, tiểu luận môn học ngắn.'
                        : 'Ideal for exploring the platform and checking short course essays & literature drafts.'}
                    </p>

                    {/* Price Display (`Sentient` 44px Light) */}
                    <div
                      style={{ borderColor: 'var(--solva-border)' }}
                      className="pt-4 border-t"
                    >
                      <div className="flex items-baseline gap-1.5">
                        <span
                          style={{ color: 'var(--solva-ink)' }}
                          className="font-solva-serif font-light text-[40px] sm:text-[44px] leading-[48px] tracking-[-0.05em]"
                        >
                          $0
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
                          ? 'Miễn phí trọn đời · Không cần thẻ'
                          : 'Free forever · No credit card required'}
                      </p>
                    </div>

                    {/* Features Checklist */}
                    <div className="space-y-[10px] pt-1">
                      <p
                        style={{ color: 'var(--solva-ink)' }}
                        className="font-mono text-[11px] font-semibold uppercase tracking-wider"
                      >
                        {lang === 'vi' ? 'Quyền lợi bao gồm:' : 'Included features:'}
                      </p>
                      <ul className="space-y-[9px]">
                        {(lang === 'vi'
                          ? [
                              '3 lượt tải & kiểm tra PDF / tháng',
                              'Dung lượng tối đa 5 MB / file PDF',
                              'Giới hạn tối đa 15 trang & 30 trích dẫn / bài',
                              'Layer 1: Đối chiếu trích dẫn trong bài & Danh mục',
                              'Tra cứu Local 127K papers, Crossref & OpenAlex',
                              'Xem điểm CIS tổng quát & Bảng kết luận cơ bản',
                            ]
                          : [
                              '3 PDF manuscript checks per month',
                              'Maximum 5 MB file size per upload',
                              'Up to 15 pages & 30 citations per document',
                              'Layer 1 In-text <-> Bibliography Linking',
                              'Local 127K DB, Crossref & OpenAlex lookup',
                              'Overall CIS Integrity Score & Verdict Table',
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
                              'Không hỗ trợ xuất báo cáo PDF, DOCX, CSV',
                              'Khóa Document Inspector, Logic Trace & Đồ thị',
                              'Không hỗ trợ tải lên hàng loạt (Batch Upload)',
                            ]
                          : [
                              'No PDF, DOCX (Word), or CSV report export',
                              'No Document Inspector, Logic Trace, or Graph',
                              'No multi-file Batch Upload',
                            ]
                        ).map((lim) => (
                          <li
                            key={lim}
                            style={{ color: 'var(--solva-subtle)' }}
                            className="flex items-start gap-[9px] font-solva-sans text-[14px] leading-[21px]"
                          >
                            <X className="w-[16px] h-[16px] mt-[2.5px] shrink-0 opacity-70" />
                            <span>{lim}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>

                  {/* Action Button */}
                  <div
                    style={{ borderColor: 'var(--solva-border)' }}
                    className="pt-5 border-t"
                  >
                    <SolvaPlanActionButton
                      variant="outline"
                      disabled={adminLocked || Boolean(user && planTier === 'basic')}
                      onClick={() => handleSelectPlan('basic')}
                      testId="select-basic-btn"
                    >
                      {adminLocked
                        ? lang === 'vi'
                          ? 'Đã bao gồm trong quyền Quản trị'
                          : 'Included with Admin access'
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
              </SolvaScrollReveal>

              {/* 2. PRO TIER (CENTER HIGHLIGHTED — RADIAL WATERCOLOR FLORAL BACKDROP) */}
              <SolvaScrollReveal delayMs={95} yOffset={36} className="h-full">
                <div
                  style={{
                    backgroundColor: 'var(--solva-surface)',
                    borderColor: 'var(--solva-ink)',
                  }}
                  className="relative rounded-[16px] border-2 p-[28px] sm:p-[32px] flex flex-col justify-between gap-[24px] overflow-hidden h-full shadow-[0_12px_36px_rgba(28,26,21,0.08)]"
                  data-testid="plan-card-pro"
                >
                  {/* Radial-Masked Watercolor Floral Background (`/solva/pricing-floral.webp`) */}
                  <div
                    className="solva-pricing-floral-mask absolute inset-0 pointer-events-none select-none z-0"
                    aria-hidden="true"
                  >
                    <img
                      src="/solva/pricing-floral.webp"
                      alt=""
                      loading="eager"
                      decoding="async"
                      {...({ fetchpriority: 'low' } as Record<string, string>)}
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <div className="solva-noise-overlay z-0" aria-hidden="true" />

                  <div className="relative z-10 space-y-[20px]">
                    {/* Top Recommendation Pill */}
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <span
                        style={{
                          backgroundColor: 'var(--solva-btn-bg)',
                          color: 'var(--solva-btn-fg)',
                        }}
                        className="inline-flex items-center gap-1.5 px-3 py-1 rounded-[6px] font-mono text-[11px] font-semibold tracking-wide"
                      >
                        <Sparkles className="w-3 h-3" />
                        <span>
                          {lang === 'vi'
                            ? 'PHỔ BIẾN NHẤT · KHUYÊN DÙNG'
                            : 'MOST POPULAR · RECOMMENDED'}
                        </span>
                      </span>
                      {billingCycle === 'annual' && (
                        <span className="px-2.5 py-1 rounded-[6px] bg-emerald-600/15 text-emerald-800 dark:text-emerald-300 border border-emerald-600/30 font-mono text-[11px] font-semibold">
                          {lang === 'vi' ? 'Tiết kiệm $48/năm' : 'Save $48/yr'}
                        </span>
                      )}
                    </div>

                    {/* Header */}
                    <div className="flex items-center gap-3">
                      <div
                        style={{
                          backgroundColor: 'var(--solva-btn-bg)',
                          color: 'var(--solva-btn-fg)',
                        }}
                        className="w-[40px] h-[40px] rounded-[10px] flex items-center justify-center shrink-0 shadow-2xs"
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

                    {/* Description */}
                    <p
                      style={{ color: 'var(--solva-muted)' }}
                      className="font-solva-sans text-[15px] leading-[22.5px] min-h-[45px]"
                    >
                      {lang === 'vi'
                        ? 'Mở khóa toàn bộ công nghệ Neuro-Symbolic, kiểm tra khóa luận/luận văn dài và xuất báo cáo chuẩn hội đồng.'
                        : 'Full Neuro-Symbolic pipeline for full-length theses, research manuscripts, and lecturer grading.'}
                    </p>

                    {/* Price Display (`Sentient` 44px Light + SolvaLiveNumber) */}
                    <div
                      style={{ borderColor: 'var(--solva-border)' }}
                      className="pt-4 border-t"
                    >
                      <div className="flex items-baseline gap-2">
                        <span
                          style={{ color: 'var(--solva-ink)' }}
                          className="font-solva-serif font-light text-[40px] sm:text-[44px] leading-[48px] tracking-[-0.05em]"
                          data-testid="pro-price-display"
                        >
                          <SolvaLiveNumber
                            value={proPrice}
                            prefix="$"
                            replaySeed={pricingSeed}
                            durationMs={1150}
                          />
                        </span>
                        <span
                          style={{ color: 'var(--solva-muted)' }}
                          className="font-solva-sans text-[14px]"
                        >
                          / {lang === 'vi' ? 'tháng' : 'month'}
                        </span>
                        {billingCycle === 'annual' && (
                          <span
                            style={{ color: 'var(--solva-subtle)' }}
                            className="text-[14px] line-through font-mono"
                          >
                            $20
                          </span>
                        )}
                      </div>
                      <p
                        style={{ color: 'var(--solva-muted)' }}
                        className="font-mono text-[12px] mt-1"
                      >
                        {billingCycle === 'annual'
                          ? lang === 'vi'
                            ? 'Thanh toán $192 / năm (Tương đương tặng >2 tháng miễn phí)'
                            : 'Billed $192 annually ($16/mo equivalent — Save 20%)'
                          : lang === 'vi'
                            ? 'Thanh toán $20 định kỳ hàng tháng (Hoặc $16/tháng khi trả năm)'
                            : 'Billed $20 monthly (Or $16/mo when billed annually)'}
                      </p>
                    </div>

                    {/* Features Checklist */}
                    <div className="space-y-[10px] pt-1">
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
                              '50 lượt tải & kiểm tra PDF mỗi tháng (Gấp 16 lần)',
                              'Tối đa 25 MB & 100 trang / bài (Đủ cho Khóa luận & Luận văn ThS)',
                              'Kiểm chứng tới 200 trích dẫn / bài + Batch Upload 10 files',
                              'Đầy đủ 15+ nguồn học thuật & kỹ thuật (+DataCite, DOAJ, HAL, NCBI/bioRxiv, HF, RFC)',
                              'Phát hiện bài báo bị rút hồi (Retraction Watch) & cứu hộ Link Rot qua Wayback Machine',
                              'Deep Neural Sentence-BERT đối chiếu câu bằng chứng & Stance',
                              'Cầu nối ngữ nghĩa đa ngôn ngữ (Tiếng Việt ↔ Tiếng Anh)',
                              'Mở khóa Document Inspector, Logic Trace & Đồ thị trích dẫn',
                              'Xuất báo cáo chuẩn học thuật ra PDF, DOCX (Word), CSV & JSON',
                              'Quản lý tới 3 Lớp học (Classrooms) & Ghi đè kết luận (Override)',
                            ]
                          : [
                              '50 PDF manuscript checks per month (16x Basic)',
                              'Up to 25 MB & 100 pages per document (Full Master/BS Theses)',
                              'Up to 200 citations / doc + 10-file concurrent Batch Upload',
                              'All 15+ Scholarly & Technical APIs (+DataCite, DOAJ, HAL, NCBI/bioRxiv, HF, RFC)',
                              'Retraction Watch Detection & Wayback Machine Link-Rot Rescue',
                              'Deep Neural Sentence-BERT Evidence & Claim Stance verification',
                              'Cross-lingual semantic bridging (Vietnamese ↔ English)',
                              'Unlock Document Inspector, Logic Trace & Evidence Graph',
                              'Export academic reports in PDF, DOCX (Word), CSV & JSON',
                              'Manage up to 3 Classroom Cohorts & Verdict Overrides',
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
                  </div>

                  {/* Action Button */}
                  <div
                    style={{ borderColor: 'var(--solva-border)' }}
                    className="relative z-10 pt-5 border-t"
                  >
                    <SolvaPlanActionButton
                      variant="primary"
                      disabled={
                        adminLocked ||
                        loadingTier !== null ||
                        Boolean(
                          user &&
                            planTier === 'pro' &&
                            user.billing_cycle === billingCycle,
                        )
                      }
                      onClick={() => handleSelectPlan('pro')}
                      testId="select-pro-btn"
                    >
                      {loadingTier === 'pro' ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <CreditCard className="h-4 w-4" />
                      )}
                      <span>
                        {adminLocked
                          ? lang === 'vi'
                            ? 'Đã bao gồm trong quyền Quản trị'
                            : 'Included with Admin access'
                          : user &&
                        planTier === 'pro' &&
                        user.billing_cycle === billingCycle
                          ? lang === 'vi'
                            ? 'Đang sử dụng gói Pro này'
                            : 'Current Active Pro Plan'
                          : lang === 'vi'
                            ? `Nâng cấp lên Pro · $${
                                billingCycle === 'annual' ? '192/năm' : '20/tháng'
                              }`
                            : `Upgrade to Pro · $${
                                billingCycle === 'annual' ? '192/yr' : '20/mo'
                              }`}
                      </span>
                    </SolvaPlanActionButton>
                  </div>
                </div>
              </SolvaScrollReveal>

              {/* 3. ULTRA TIER */}
              <SolvaScrollReveal delayMs={190} yOffset={36} className="h-full">
                <div
                  style={{
                    backgroundColor: 'var(--solva-surface)',
                    borderColor: 'var(--solva-border)',
                  }}
                  className="relative rounded-[16px] border p-[28px] sm:p-[32px] flex flex-col justify-between gap-[24px] h-full"
                  data-testid="plan-card-ultra"
                >
                  <div className="space-y-[20px]">
                    {/* Header */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-3">
                        <div
                          style={{
                            backgroundColor: 'var(--solva-bg)',
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
                      {billingCycle === 'annual' ? (
                        <span className="px-2.5 py-1 rounded-[6px] bg-emerald-600/15 text-emerald-800 dark:text-emerald-300 border border-emerald-600/30 font-mono text-[11px] font-semibold">
                          {lang === 'vi' ? 'Tiết kiệm $480' : 'Save $480/yr'}
                        </span>
                      ) : (
                        <span
                          style={{
                            backgroundColor: 'var(--solva-bg)',
                            borderColor: 'var(--solva-border)',
                            color: 'var(--solva-muted)',
                          }}
                          className="px-[8px] py-[4px] rounded-[6px] border font-mono text-[11px] font-medium leading-none"
                        >
                          {lang === 'vi' ? 'QUY MÔ LỚN' : 'ENTERPRISE LAB'}
                        </span>
                      )}
                    </div>

                    {/* Description */}
                    <p
                      style={{ color: 'var(--solva-muted)' }}
                      className="font-solva-sans text-[15px] leading-[22.5px] min-h-[45px]"
                    >
                      {lang === 'vi'
                        ? 'Hiệu năng tối đa không giới hạn cho nhóm nghiên cứu, bộ môn đại học và hội đồng chấm luận án Tiến sĩ.'
                        : 'Unrestricted verification scale for university departments, research labs, and doctoral committees.'}
                    </p>

                    {/* Price Display (`Sentient` 44px Light + SolvaLiveNumber) */}
                    <div
                      style={{ borderColor: 'var(--solva-border)' }}
                      className="pt-4 border-t"
                    >
                      <div className="flex items-baseline gap-2">
                        <span
                          style={{ color: 'var(--solva-ink)' }}
                          className="font-solva-serif font-light text-[40px] sm:text-[44px] leading-[48px] tracking-[-0.05em]"
                          data-testid="ultra-price-display"
                        >
                          <SolvaLiveNumber
                            value={ultraPrice}
                            prefix="$"
                            replaySeed={pricingSeed}
                            durationMs={1150}
                          />
                        </span>
                        <span
                          style={{ color: 'var(--solva-muted)' }}
                          className="font-solva-sans text-[14px]"
                        >
                          / {lang === 'vi' ? 'tháng' : 'month'}
                        </span>
                        {billingCycle === 'annual' && (
                          <span
                            style={{ color: 'var(--solva-subtle)' }}
                            className="text-[14px] line-through font-mono"
                          >
                            $200
                          </span>
                        )}
                      </div>
                      <p
                        style={{ color: 'var(--solva-muted)' }}
                        className="font-mono text-[12px] mt-1"
                      >
                        {billingCycle === 'annual'
                          ? lang === 'vi'
                            ? 'Thanh toán $1,920 / năm (Tiết kiệm $480 / năm — Giảm 20%)'
                            : 'Billed $1,920 annually ($160/mo equivalent — Save $480)'
                          : lang === 'vi'
                            ? 'Thanh toán $200 định kỳ hàng tháng (Hoặc $160/tháng khi trả năm)'
                            : 'Billed $200 monthly (Or $160/mo when billed annually)'}
                      </p>
                    </div>

                    {/* Features Checklist */}
                    <div className="space-y-[10px] pt-1">
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
                              'Không giới hạn lượt kiểm tra (Fair-use: 1.000 tài liệu/tháng)',
                              'Tối đa 100 MB & 500 trang / bài (Luận án Tiến sĩ & Sách chuyên khảo)',
                              'Không giới hạn số lượng trích dẫn trong mỗi tài liệu',
                              'Kích hoạt SerpAPI Google Scholar Fallback cho trích dẫn khó',
                              'Kiểm tra sống/chết đường dẫn DOI & URL thời gian thực',
                              'Batch Upload công suất lớn: Tối đa 50 PDF cùng lúc',
                              'Không giới hạn Lớp học, Sinh viên & Xuất báo cáo Class ZIP',
                              'Lưu trữ lịch sử vĩnh viễn & Luồng xử lý ưu tiên 24/7',
                            ]
                          : [
                              'Unlimited monthly checks (Fair-use: 1,000 manuscripts/mo)',
                              'Up to 100 MB & 500 pages (Doctoral Dissertations & Books)',
                              'Unlimited citations verified per manuscript',
                              'SerpAPI Google Scholar Fallback for obscure literature',
                              'Real-time Active DOI & URL Reachability Validator',
                              'High-throughput Batch Upload: Up to 50 PDFs at once',
                              'Unlimited Classroom Cohorts, Students & Class ZIP Export',
                              'Lifetime report retention & 24/7 priority compute queue',
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
                  </div>

                  {/* Action Button */}
                  <div
                    style={{ borderColor: 'var(--solva-border)' }}
                    className="pt-5 border-t"
                  >
                    <SolvaPlanActionButton
                      variant="outline"
                      disabled={
                        adminLocked ||
                        loadingTier !== null ||
                        Boolean(
                          user &&
                            planTier === 'ultra' &&
                            user.billing_cycle === billingCycle,
                        )
                      }
                      onClick={() => handleSelectPlan('ultra')}
                      testId="select-ultra-btn"
                    >
                      {loadingTier === 'ultra' ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <CreditCard className="h-4 w-4" />
                      )}
                      <span>
                        {adminLocked
                          ? lang === 'vi'
                            ? 'Gói hiện tại · Ultra (Quản trị viên)'
                            : 'Current Plan · Ultra (Admin)'
                          : user &&
                        planTier === 'ultra' &&
                        user.billing_cycle === billingCycle
                          ? lang === 'vi'
                            ? 'Đang sử dụng gói Ultra'
                            : 'Current Active Ultra Plan'
                          : lang === 'vi'
                            ? `Nâng cấp lên Ultra · $${
                                billingCycle === 'annual' ? '1,920/năm' : '200/tháng'
                              }`
                            : `Upgrade to Ultra · $${
                                billingCycle === 'annual' ? '1,920/yr' : '200/mo'
                              }`}
                      </span>
                    </SolvaPlanActionButton>
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
          <div className="max-w-[1200px] mx-auto flex flex-col gap-[28px] sm:gap-[36px] lg:gap-[48px]">
            <div className="flex flex-col items-start gap-[12px] max-w-[620px]">
              <SolvaEyebrow>
                {lang === 'vi'
                  ? 'Thông số kỹ thuật & Hạn mức'
                  : 'Technical specifications'}
              </SolvaEyebrow>
              <SolvaTwoToneHeading
                primary={
                  lang === 'vi'
                    ? 'Bảng so sánh chi tiết tính năng,'
                    : 'Detailed feature & quota matrix,'
                }
                secondary={
                  lang === 'vi'
                    ? 'minh bạch giữa 3 gói cước.'
                    : 'transparent across every tier.'
                }
              />
            </div>

            <SolvaScrollReveal delayMs={70} yOffset={32}>
              <div
                style={{
                  backgroundColor: 'var(--solva-surface)',
                  borderColor: 'var(--solva-border)',
                }}
                className="rounded-[16px] border p-4 sm:p-[28px] lg:p-[32px] overflow-hidden"
              >
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse font-solva-sans text-[13px] sm:text-[14px]">
                    <thead>
                      <tr
                        style={{
                          borderColor: 'var(--solva-border)',
                          color: 'var(--solva-muted)',
                        }}
                        className="border-b font-mono uppercase text-[11px]"
                      >
                        <th className="py-4 pr-4 font-semibold min-w-[220px]">
                          {lang === 'vi' ? 'Danh mục tính năng' : 'Feature / Quota'}
                        </th>
                        <th className="py-4 px-4 text-center font-semibold min-w-[140px]">
                          Basic ($0)
                        </th>
                        <th
                          style={{
                            backgroundColor: 'var(--solva-bg)',
                            color: 'var(--solva-ink)',
                          }}
                          className="py-4 px-4 text-center font-bold rounded-t-[10px] min-w-[180px]"
                        >
                          Pro (${proPrice}/mo)
                        </th>
                        <th
                          style={{ color: 'var(--solva-ink)' }}
                          className="py-4 pl-4 text-center font-bold min-w-[160px]"
                        >
                          Ultra (${ultraPrice}/mo)
                        </th>
                      </tr>
                    </thead>
                    <tbody
                      style={{ borderColor: 'var(--solva-border)' }}
                      className="divide-y"
                    >
                      {COMPARISON_MATRIX.map((row) => (
                        <tr
                          key={row.category_en}
                          style={{ borderColor: 'var(--solva-border)' }}
                          className="hover:bg-[#FBFAF6]/60 dark:hover:bg-[#141310]/40 transition-colors"
                        >
                          <td
                            style={{ color: 'var(--solva-ink)' }}
                            className="py-3.5 pr-4 font-medium"
                          >
                            {lang === 'vi' ? row.category_vi : row.category_en}
                          </td>
                          <td
                            style={{ color: 'var(--solva-muted)' }}
                            className="py-3.5 px-4 text-center font-mono text-[12px]"
                          >
                            {typeof row.basic === 'boolean' ? (
                              row.basic ? (
                                <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400 mx-auto" />
                              ) : (
                                <X className="h-4 w-4 opacity-40 mx-auto" />
                              )
                            ) : (
                              row.basic
                            )}
                          </td>
                          <td
                            style={{
                              backgroundColor: 'var(--solva-bg)',
                              color: 'var(--solva-ink)',
                            }}
                            className="py-3.5 px-4 text-center font-semibold font-mono text-[12px]"
                          >
                            {typeof row.pro === 'boolean' ? (
                              row.pro ? (
                                <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400 mx-auto" />
                              ) : (
                                <X className="h-4 w-4 opacity-40 mx-auto" />
                              )
                            ) : (
                              row.pro
                            )}
                          </td>
                          <td
                            style={{ color: 'var(--solva-ink)' }}
                            className="py-3.5 pl-4 text-center font-semibold font-mono text-[12px]"
                          >
                            {typeof row.ultra === 'boolean' ? (
                              row.ultra ? (
                                <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400 mx-auto" />
                              ) : (
                                <X className="h-4 w-4 opacity-40 mx-auto" />
                              )
                            ) : (
                              row.ultra
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </SolvaScrollReveal>
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
                      <blockquote className="font-solva-serif font-light text-[22px] sm:text-[28px] leading-[1.25] tracking-[-0.05em] max-w-[520px]">
                        <span style={{ color: 'var(--solva-ink)' }}>
                          {lang === 'vi'
                            ? '“Nâng cấp lên gói Pro & Ultra giúp hội đồng rà soát 120 khóa luận tốt nghiệp chỉ trong một buổi sáng, phát hiện chính xác mọi mã DOI ảo giác '
                            : '“Upgrading to CITRA Pro & Ultra let our review committee audit 120 graduation theses in a single morning, catching every hallucinated DOI '}
                        </span>
                        <span style={{ color: 'var(--solva-muted)' }}>
                          {lang === 'vi'
                            ? `kèm bằng chứng truy vết quy tắc ${SYMBOLIC_RULES_RANGE} minh bạch.”`
                            : `with verifiable ${SYMBOLIC_RULES_RANGE} symbolic rule traces.”`}
                        </span>
                      </blockquote>

                      <div
                        style={{ color: 'var(--solva-ink)' }}
                        className="font-solva-sans text-[15px] font-medium tracking-tight shrink-0 flex items-center gap-1.5"
                      >
                        <GraduationCap className="w-5 h-5" />
                        <span>CITRA Lab</span>
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
                          ? 'CSDL học thuật & kỹ thuật liên hợp'
                          : 'Federated scholarly & technical APIs'
                      }
                    />
                    <SolvaAnimatedMetric
                      targetValue={98.6}
                      suffix="%"
                      decimals={1}
                      label={
                        lang === 'vi'
                          ? 'Độ chính xác Neuro-Symbolic (F1 0.976)'
                          : 'Neuro-Symbolic accuracy (0.976 F1)'
                      }
                    />
                    <SolvaAnimatedMetric
                      targetValue={100}
                      suffix="%"
                      decimals={0}
                      label={
                        lang === 'vi'
                          ? 'Precision phát hiện ảo giác (0 oan sai)'
                          : 'Hallucination precision (0 false flags)'
                      }
                    />
                  </div>
                </div>
              </div>
            </SolvaScrollReveal>

            {/* 3 Trust & Security Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-[16px]">
              {[
                {
                  icon: ShieldCheck,
                  title_vi: 'Thanh toán Stripe An toàn',
                  title_en: 'Secure Stripe Checkout',
                  desc_vi:
                    'Hỗ trợ thẻ quốc tế Visa/Mastercard qua cổng Stripe Demo chuẩn bảo mật PCI-DSS. Nâng cấp tài khoản và mở khóa hạn mức tức thì.',
                  desc_en:
                    'Instant activation via Stripe Demo Checkout with full invoice receipts and 1-click test card support.',
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
                  <SolvaScrollReveal key={item.title_en} delayMs={idx * 80} yOffset={24}>
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
        <PricingSolvaFAQSection lang={lang} isEmbedded={Boolean(user)} />

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
                            ? 'Bắt đầu miễn phí ngay hôm nay với 3 lượt kiểm tra PDF mỗi tháng, hoặc mở khóa toàn bộ sức mạnh Neuro-Symbolic với gói Pro.'
                            : 'Start free today with 3 PDF checks per month, or unlock the full Neuro-Symbolic pipeline with CITRA Pro.'}
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
      </main>
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
    if (!dropdownOpen) return;
    const closeOnScroll = () => setDropdownOpen(false);
    window.addEventListener('scroll', closeOnScroll, { passive: true });
    return () => window.removeEventListener('scroll', closeOnScroll);
  }, [dropdownOpen]);

  const dropdownItems =
    lang === 'vi'
      ? [
          {
            title: 'Kiến trúc 2 tầng',
            desc: 'Tách biệt Mapping & Kiểm chứng nguồn',
            href: '/#architecture',
            icon: Layers,
          },
          {
            title: 'Trình gỡ lỗi trích dẫn',
            desc: `Soi chiếu metadata & luật ${SYMBOLIC_RULES_RANGE}`,
            href: '/#interactive-demo',
            icon: FileSearch,
          },
          {
            title: 'Quy trình 4 giai đoạn',
            desc: 'Từ GROBID TEI tới DeBERTa NLI',
            href: '/#how-it-works',
            icon: GitBranch,
          },
          {
            title: 'Kiểm định 120K bài báo',
            desc: '98.6% Acc · 100% F1 ảo giác · 0.043 ECE',
            href: '/#benchmark-120k',
            icon: Sparkles,
          },
          {
            title: 'Phân quyền 3 vai trò',
            desc: 'Sinh viên, Giảng viên & Quản trị',
            href: '/#workspaces',
            icon: Users,
          },
        ]
      : [
          {
            title: '2-Layer Architecture',
            desc: 'Orthogonal Mapping & Verification',
            href: '/#architecture',
            icon: Layers,
          },
          {
            title: 'Citation Debugger',
            desc: `Live metadata diff & rules ${SYMBOLIC_RULES_RANGE}`,
            href: '/#interactive-demo',
            icon: FileSearch,
          },
          {
            title: 'Verification Pipeline',
            desc: 'GROBID TEI to DeBERTa NLI stance',
            href: '/#how-it-works',
            icon: GitBranch,
          },
          {
            title: '120K-Paper Benchmark',
            desc: '98.6% Acc · 100% Hallucination F1 · 0.043 ECE',
            href: '/#benchmark-120k',
            icon: Sparkles,
          },
          {
            title: 'Role Workspaces',
            desc: 'Student, Teacher & Admin views',
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
      <div className="max-w-[1280px] mx-auto px-5 sm:px-6 lg:px-[40px] h-[64px] lg:h-[76px] flex items-center justify-between gap-4">
        {/* Left: Brand Logo + Back to Home */}
        <div className="flex items-center gap-3 shrink-0">
          <Link
            to="/"
            className="inline-flex items-center gap-[8px] rounded-[6px] focus:outline-none"
          >
            <span className="w-[28px] h-[28px] rounded-[7px] bg-white dark:bg-[#1E1C17] border border-[#E7E3D9] dark:border-[#332F26] shadow-2xs flex items-center justify-center p-1 shrink-0 transition-colors">
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
            className="hidden sm:inline-flex items-center gap-1.5 h-[32px] px-2.5 rounded-[8px] font-solva-sans text-[13px] font-normal hover:opacity-80 transition-opacity"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>{lang === 'vi' ? 'Trang chủ' : 'Back to Home'}</span>
          </Link>
        </div>

        {/* Center: Solva Navigation Links */}
        <nav
          aria-label="Pricing Navigation"
          className="hidden lg:flex items-center justify-center flex-1 gap-1"
        >
          <div className="relative" onMouseLeave={() => setDropdownOpen(false)}>
            <button
              type="button"
              onClick={() => setDropdownOpen((prev) => !prev)}
              aria-expanded={dropdownOpen}
              style={{ color: 'var(--solva-muted)' }}
              className="inline-flex items-center gap-[6px] h-[44px] px-[12px] rounded-[8px] font-solva-sans text-[15px] font-normal hover:opacity-80 transition-opacity cursor-pointer"
            >
              <span>{lang === 'vi' ? 'Nền tảng' : 'Platform'}</span>
              <ChevronDown
                className={`w-3.5 h-3.5 transition-transform duration-200 ${
                  dropdownOpen ? 'rotate-180' : ''
                }`}
              />
            </button>

            {dropdownOpen && (
              <div className="absolute left-0 top-[44px] pt-1 z-50 animate-debugger-switch">
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
                      <a
                        key={item.href}
                        href={item.href}
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
                      </a>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          <a
            href="#compare-matrix"
            style={{ color: 'var(--solva-muted)' }}
            className="inline-flex items-center h-[44px] px-[12px] rounded-[8px] font-solva-sans text-[15px] font-normal hover:opacity-80 transition-opacity"
          >
            {lang === 'vi' ? 'Bảng so sánh' : 'Comparison Matrix'}
          </a>

          <a
            href="#pricing-faq"
            style={{ color: 'var(--solva-muted)' }}
            className="inline-flex items-center h-[44px] px-[12px] rounded-[8px] font-solva-sans text-[15px] font-normal hover:opacity-80 transition-opacity"
          >
            {lang === 'vi' ? 'Câu hỏi thường gặp' : 'Billing FAQ'}
          </a>

          <a
            href="/#benchmark-120k"
            style={{ color: 'var(--solva-muted)' }}
            className="inline-flex items-center gap-1.5 h-[44px] px-[12px] rounded-[8px] font-solva-sans text-[15px] font-normal hover:opacity-80 transition-opacity"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            <span>{lang === 'vi' ? 'Benchmark 120K' : '120K Benchmark'}</span>
          </a>
        </nav>

        {/* Right: Lang, Theme, Sign In, Primary Double-Slide CTA */}
        <div className="flex items-center justify-end gap-1.5 sm:gap-2 shrink-0">
          <button
            type="button"
            onClick={onToggleLanguage}
            style={{
              backgroundColor: 'var(--solva-surface)',
              color: 'var(--solva-ink)',
            }}
            className="inline-flex items-center gap-1 h-[36px] px-2.5 rounded-[8px] font-mono text-[12px] font-medium hover:opacity-85 transition-opacity cursor-pointer"
            title={lang === 'vi' ? 'Switch to English' : 'Chuyển sang Tiếng Việt'}
          >
            <Globe className="w-3.5 h-3.5" />
            <span>{lang === 'vi' ? 'VI' : 'EN'}</span>
          </button>

          <ThemeToggle size="sm" />

          <Link
            to="/login"
            style={{ color: 'var(--solva-muted)' }}
            className="hidden sm:inline-flex items-center h-[44px] px-[12px] rounded-[8px] font-solva-sans text-[15px] font-normal hover:opacity-80 transition-opacity"
          >
            {lang === 'vi' ? 'Đăng nhập' : 'Sign in'}
          </Link>

          <SolvaButton to="/register" variant="primary" className="hidden sm:inline-flex">
            {lang === 'vi' ? 'Dùng thử miễn phí' : 'Start Free'}
          </SolvaButton>

          <button
            type="button"
            onClick={() => setMobileMenuOpen((prev) => !prev)}
            aria-label="Toggle navigation menu"
            aria-expanded={mobileMenuOpen}
            style={{
              backgroundColor: 'var(--solva-surface)',
              color: 'var(--solva-ink)',
            }}
            className="lg:hidden inline-flex items-center justify-center w-[40px] h-[40px] rounded-[8px] cursor-pointer"
          >
            {mobileMenuOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <nav
          aria-label="Mobile Pricing Navigation"
          style={{
            backgroundColor: 'var(--solva-bg)',
            borderColor: 'var(--solva-border)',
          }}
          className="lg:hidden border-t border-b px-5 py-4 space-y-2 shadow-lg animate-debugger-switch"
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            <Link
              to="/"
              onClick={() => setMobileMenuOpen(false)}
              style={{
                backgroundColor: 'var(--solva-surface)',
                color: 'var(--solva-ink)',
              }}
              className="flex items-center justify-between px-3.5 py-2.5 rounded-[10px] font-solva-sans text-[14px] font-medium"
            >
              <span>{lang === 'vi' ? 'Quay về Trang chủ' : 'Back to Home'}</span>
              <ChevronRight className="w-4 h-4 opacity-60" />
            </Link>
            <a
              href="#compare-matrix"
              onClick={() => setMobileMenuOpen(false)}
              style={{
                backgroundColor: 'var(--solva-surface)',
                color: 'var(--solva-ink)',
              }}
              className="flex items-center justify-between px-3.5 py-2.5 rounded-[10px] font-solva-sans text-[14px] font-medium"
            >
              <span>{lang === 'vi' ? 'Bảng so sánh tính năng' : 'Comparison Matrix'}</span>
              <ChevronRight className="w-4 h-4 opacity-60" />
            </a>
            <a
              href="#pricing-faq"
              onClick={() => setMobileMenuOpen(false)}
              style={{
                backgroundColor: 'var(--solva-surface)',
                color: 'var(--solva-ink)',
              }}
              className="flex items-center justify-between px-3.5 py-2.5 rounded-[10px] font-solva-sans text-[14px] font-medium"
            >
              <span>{lang === 'vi' ? 'Câu hỏi thanh toán' : 'Billing FAQ'}</span>
              <ChevronRight className="w-4 h-4 opacity-60" />
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
}: {
  lang: Lang;
  isEmbedded: boolean;
}) {
  const [openIds, setOpenIds] = useState<Record<string, boolean>>({
    'pfaq-0': true,
  });

  const toggleFaq = (id: string) => {
    setOpenIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const leftFaqs = [
    {
      id: 'pfaq-0',
      q:
        lang === 'vi'
          ? 'Gói Basic ($0) có giới hạn thời gian sử dụng không?'
          : 'Is the Basic ($0) tier really free forever?',
      a:
        lang === 'vi'
          ? 'Hoàn toàn miễn phí trọn đời và không yêu cầu thẻ tín dụng. Mỗi tháng tài khoản Basic được cấp mới 3 lượt kiểm tra bản thảo PDF/DOCX (tối đa 15 trang và 30 trích dẫn mỗi bài) cùng đầy đủ phân loại 2 tầng L1 × L2.'
          : 'Yes — Basic is free forever with no credit card required. Your quota automatically resets every month with 3 PDF/DOCX manuscript checks (up to 15 pages and 30 citations per document).',
    },
    {
      id: 'pfaq-1',
      q:
        lang === 'vi'
          ? 'Sự khác biệt lớn nhất khi nâng cấp lên gói Pro ($16/tháng) là gì?'
          : 'What unlocks immediately when I upgrade to Pro ($16/mo)?',
      a:
        lang === 'vi'
          ? 'Gói Pro nâng hạn mức lên 50 tài liệu/tháng (tối đa 100 trang, 200 trích dẫn/bài), mở khóa toàn bộ 15+ API học thuật & kỹ thuật (PubMed, arXiv, DBLP, DOAJ, DataCite, Retraction Watch, Wayback Machine), đối chiếu câu bằng chứng Sentence-BERT & DeBERTa NLI, 1-Click Auto-Fix Studio, Document Inspector và xuất báo cáo ra PDF/DOCX/CSV.'
          : 'Pro unlocks 50 manuscripts/month (up to 100 pages & 200 citations each), all 15+ federated scholarly APIs, Sentence-BERT & DeBERTa-v3 NLI claim verification, 1-Click Auto-Fix Studio, interactive PDF bounding-box Document Inspector, and full PDF/DOCX/CSV exports.',
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
          ? 'Có. Bạn có thể hủy gia hạn tự động hoặc kích hoạt lại chỉ với 1 cú nhấp chuột trong mục Cài đặt (Settings -> Quản lý Gói cước). Khi hủy gia hạn, bạn vẫn giữ nguyên toàn bộ quyền lợi Pro/Ultra cho đến hết chu kỳ đã thanh toán.'
          : 'Yes. You can cancel or reactivate auto-renewal with one click from your Settings page. If you cancel, your Pro or Ultra features remain active through the end of your current billing period.',
    },
    {
      id: 'pfaq-4',
      q:
        lang === 'vi'
          ? 'Cổng thanh toán Stripe Demo hỗ trợ những thẻ thử nghiệm nào?'
          : 'How does Stripe Checkout work in this academic workspace?',
      a:
        lang === 'vi'
          ? 'Hệ thống tích hợp cổng thanh toán Stripe bảo mật kèm chế độ điền nhanh thẻ kiểm thử 1-Click (Visa 4242 / Mastercard 4444) để hội đồng và người dùng trải nghiệm trọn vẹn luồng nâng cấp hóa đơn và mở khóa tính năng tức thì.'
          : 'CITRA integrates Stripe Checkout with 1-click test card autofill (Visa 4242 & Mastercard 4444) so evaluators, researchers, and students can experience instant tier activation and invoice generation.',
    },
    {
      id: 'pfaq-5',
      q:
        lang === 'vi'
          ? 'Gói Ultra dành cho Bộ môn & Phòng thí nghiệm có ưu điểm gì đặc biệt?'
          : 'When should a research lab or department choose Ultra?',
      a:
        lang === 'vi'
          ? 'Gói Ultra hỗ trợ tài liệu dài tới 500 trang (luận án Tiến sĩ, sách chuyên khảo), tải lên hàng loạt 50 file PDF cùng lúc, kích hoạt SerpAPI Google Scholar dự phòng cho tài liệu hiếm, quản lý không giới hạn lớp học và xuất toàn bộ báo cáo khóa luận ra file ZIP.'
          : 'Ultra is designed for departments and thesis review boards: supporting 500-page doctoral dissertations, 50-file concurrent batch uploads, SerpAPI Google Scholar fallback, unlimited classroom cohorts, and 1-click Class ZIP exports.',
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
                    className={`w-4 h-4 absolute transition-all duration-350 ease-[cubic-bezier(0.22,1,0.36,1)] ${
                      isOpen
                        ? 'rotate-90 opacity-0 scale-75'
                        : 'rotate-0 opacity-100 scale-100'
                    }`}
                  />
                  <Minus
                    className={`w-4 h-4 absolute transition-all duration-350 ease-[cubic-bezier(0.22,1,0.36,1)] ${
                      isOpen
                        ? 'rotate-0 opacity-100 scale-100'
                        : '-rotate-90 opacity-0 scale-75'
                    }`}
                  />
                </span>
              </button>
              <div
                style={{
                  gridTemplateRows: isOpen ? '1fr' : '0fr',
                  transition: 'grid-template-rows 420ms cubic-bezier(0.22, 1, 0.36, 1)',
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
                        : 'translate3d(0, -10px, 0)',
                      filter: isOpen ? 'blur(0px)' : 'blur(2.5px)',
                      transition:
                        'opacity 360ms cubic-bezier(0.22, 1, 0.36, 1), transform 420ms cubic-bezier(0.22, 1, 0.36, 1), filter 320ms cubic-bezier(0.22, 1, 0.36, 1)',
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
      header: lang === 'vi' ? 'Sản phẩm' : 'Product',
      links: [
        { label: lang === 'vi' ? 'Benchmark 120K bài báo' : '120K-Paper Benchmark', href: '/#benchmark-120k' },
        { label: lang === 'vi' ? 'Trình gỡ lỗi trích dẫn' : 'Citation Debugger', href: '/#interactive-demo' },
        { label: lang === 'vi' ? 'Kiến trúc 2 tầng' : '2-Layer Architecture', href: '/#architecture' },
        { label: lang === 'vi' ? 'Quy trình 4 giai đoạn' : 'Verification Pipeline', href: '/#how-it-works' },
        { label: lang === 'vi' ? 'Bảng so sánh gói cước' : 'Comparison Matrix', href: '#compare-matrix' },
      ],
    },
    {
      header: lang === 'vi' ? 'Không gian làm việc' : 'Workspaces',
      links: [
        { label: lang === 'vi' ? 'Dành cho Sinh viên' : 'Student Workspace', href: '/#workspaces' },
        { label: lang === 'vi' ? 'Dành cho Giảng viên' : 'Teacher Classroom', href: '/#workspaces' },
        { label: lang === 'vi' ? 'Quản trị hệ thống' : 'Admin Control', href: '/#workspaces' },
        { label: lang === 'vi' ? 'Trang chủ CITRA' : 'CITRA Home', to: '/' },
      ],
    },
    {
      header: lang === 'vi' ? 'Công nghệ' : 'Technology',
      links: [
        { label: 'GROBID TEI-XML', href: '/#how-it-works' },
        { label: '15+ Scholarly APIs', href: '/#architecture' },
        { label: 'Neuro-Symbolic Rules', href: '/#interactive-demo' },
        { label: 'DeBERTa-v3 NLI Stance', href: '/#how-it-works' },
      ],
    },
    {
      header: lang === 'vi' ? 'Tài khoản' : 'Account',
      links: [
        { label: lang === 'vi' ? 'Đăng nhập' : 'Sign in', to: '/login' },
        { label: lang === 'vi' ? 'Tạo tài khoản' : 'Create account', to: '/register' },
        { label: lang === 'vi' ? 'Câu hỏi thường gặp' : 'Billing FAQ', href: '#pricing-faq' },
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
              <span className="w-[32px] h-[32px] rounded-[8px] bg-white dark:bg-[#1E1C17] border border-[#E7E3D9] dark:border-[#332F26] shadow-2xs flex items-center justify-center p-1 shrink-0 transition-colors">
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
              className="font-solva-sans text-[16px] font-normal leading-[23.2px] max-w-[290px]"
            >
              {lang === 'vi'
                ? 'Không gian kiểm chứng nguồn trích dẫn học thuật đa nguồn dựa trên kiến trúc Neuro-Symbolic 2 tầng.'
                : 'Academic source verification workspace powered by a two-layer Neuro-Symbolic and 15+ API engine.'}
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
            © 2026 CITRA · SourceLogic Academic Integrity Workspace. All rights reserved.
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
