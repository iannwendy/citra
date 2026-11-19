import { useState, useEffect, useContext, useRef, useCallback, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ShieldCheck,
  Globe,
  Lock,
  Database,
  Clock,
  UserCheck,
  FileText,
  CheckCircle2,
  ArrowRight,
  ChevronRight,
  Menu,
  X,
  Plus,
  Minus,
  Sparkles,
  Trash2,
  HardDrive,
  EyeOff,
  Code2,
} from 'lucide-react';
import { AuthContext } from '@/contexts/AuthContext';
import { ThemeToggle } from '@/contexts/ThemeContext';
import {
  SCHOLARLY_APIS_LABEL,
  isDemoEvaluatorMode,
} from '@/lib/productFacts';
import {
  type Lang,
  SolvaScrollReveal,
  SolvaButton,
  SolvaPainterlyFrame,
  SolvaStickyStackCard,
} from '@/components/landing/SolvaPrimitives';
import {
  ScholarlySourceLogo,
  getScholarlySourceUrl,
} from '@/components/landing/ScholarlySourceLogos';

/* ============================================================
   CITRA — Official Personal Data Protection Policy (/privacy)
   1:1 Solva Warm Editorial Design System, Blur-Free Crisp Reveal,
   Sentient Light Serif + Onest Sans Typography & Interactive Architecture
   Legal Basis: Luật Bảo vệ dữ liệu cá nhân 91/2025/QH15 & NĐ 356/2025/NĐ-CP
   ============================================================ */

export const PRIVACY_POLICY_VERSION = '1.0';

function CitraLogo({ size = 20 }: { size?: number }) {
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
   BLUR-FREE EDITORIAL PRIMITIVES FOR `/privacy`
   Guarantees razor-sharp subpixel typography at every scroll offset
   (zero `filter: blur(...)` mid-scroll states).
   ============================================================ */
function PrivacyEyebrow({
  children,
  centered = false,
}: {
  children: ReactNode;
  centered?: boolean;
}) {
  return (
    <SolvaScrollReveal yOffset={16} blurPx={0} scaleFrom={0.995}>
      <div
        className={`inline-flex items-center gap-[6px] pl-[2px] font-solva-sans ${
          centered ? 'justify-center' : ''
        }`}
      >
        <span
          className="w-[10px] h-[5px] rounded-[50px] shrink-0"
          style={{ backgroundColor: 'var(--solva-muted)' }}
        />
        <span
          className="text-[15px] font-normal leading-[19.5px]"
          style={{ color: 'var(--solva-muted)' }}
        >
          {children}
        </span>
      </div>
    </SolvaScrollReveal>
  );
}

function PrivacyTwoToneHeading({
  as: Tag = 'h2',
  primary,
  secondary,
  size = 'h2',
  centered = false,
  delayMs = 0,
  className = '',
}: {
  as?: 'h1' | 'h2';
  primary: string;
  secondary?: string;
  size?: 'h1' | 'h2';
  centered?: boolean;
  delayMs?: number;
  className?: string;
}) {
  const normalizedPrimary = primary.normalize('NFC');
  const normalizedSecondary = secondary ? secondary.normalize('NFC') : undefined;
  const hasVietnamese =
    /[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđÀÁẢÃẠĂẰẮẲẴẶÂẦẤẨẪẬÈÉẺẼẸÊỀẾỂỄỆÌÍỈĨỊÒÓỎÕỌÔỒỐỔỖỘƠỜỚỞỠỢÙÚỦŨỤƯỪỨỬỮỰỲÝỶỸỴĐ]/.test(
      normalizedPrimary,
    ) ||
    (normalizedSecondary
      ? /[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđÀÁẢÃẠĂẰẮẲẴẶÂẦẤẨẪẬÈÉẺẼẸÊỀẾỂỄỆÌÍỈĨỊÒÓỎÕỌÔỒỐỔỖỘƠỜỚỞỠỢÙÚỦŨỤƯỪỨỬỮỰỲÝỶỸỴĐ]/.test(
          normalizedSecondary,
        )
      : false);

  const leadingTrackingClass = hasVietnamese
    ? 'leading-[1.15] tracking-[-0.03em]'
    : 'leading-[1.06] tracking-[-0.05em]';

  const sizeClass =
    size === 'h1'
      ? `text-[40px] sm:text-[48px] xl:text-[56px] ${leadingTrackingClass}`
      : `text-[34px] sm:text-[40px] xl:text-[48px] ${leadingTrackingClass}`;

  return (
    <SolvaScrollReveal delayMs={delayMs} yOffset={20} blurPx={0} scaleFrom={0.995}>
      <Tag
        className={`font-solva-serif font-light ${sizeClass} ${
          centered ? 'text-center mx-auto' : ''
        } ${className}`}
      >
        <span className="block" style={{ color: 'var(--solva-ink)' }}>
          {normalizedPrimary}
        </span>
        {normalizedSecondary && (
          <>
            {' '}
            <span className="block" style={{ color: 'var(--solva-muted)' }}>
              {normalizedSecondary}
            </span>
          </>
        )}
      </Tag>
    </SolvaScrollReveal>
  );
}

function PrivacyAnimatedMetric({
  targetValue,
  suffix = '',
  prefix = '',
  decimals = 0,
  label,
}: {
  targetValue: number;
  suffix?: string;
  prefix?: string;
  decimals?: number;
  label: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const numRef = useRef<HTMLDivElement>(null);
  const hasAnimated = useRef<boolean>(false);
  const animRafRef = useRef<number | null>(null);

  const formatMetric = useCallback(
    (val: number) => {
      const safeVal = Math.abs(val) < 1e-9 ? 0 : val;
      return `${prefix}${safeVal.toFixed(decimals)}${suffix}`;
    },
    [prefix, decimals, suffix],
  );

  useEffect(() => {
    const reduced =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (reduced || typeof IntersectionObserver === 'undefined') {
      hasAnimated.current = true;
      if (numRef.current) {
        numRef.current.textContent = formatMetric(targetValue);
      }
      return;
    }

    const el = ref.current;
    if (!el || hasAnimated.current) {
      if (numRef.current) {
        numRef.current.textContent = formatMetric(targetValue);
      }
      return;
    }

    const runCountAnimation = (fromVal: number, toVal: number, durationMs: number) => {
      if (animRafRef.current !== null) {
        cancelAnimationFrame(animRafRef.current);
      }
      let startTime: number | null = null;
      let lastText = '';
      const tick = () => {
        const now = Date.now();
        if (startTime === null) startTime = now;
        const elapsed = Math.max(0, now - startTime);
        const progress = Math.max(0, Math.min(1, elapsed / durationMs));
        const eased = 1 - Math.pow(1 - progress, 4);
        const current = fromVal + (toVal - fromVal) * eased;
        const nextText = formatMetric(progress < 1 ? current : toVal);
        if (numRef.current && nextText !== lastText) {
          lastText = nextText;
          numRef.current.textContent = nextText;
        }
        if (progress < 1) {
          animRafRef.current = requestAnimationFrame(tick);
        } else {
          animRafRef.current = null;
        }
      };
      animRafRef.current = requestAnimationFrame(tick);
    };

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && !hasAnimated.current) {
            hasAnimated.current = true;
            runCountAnimation(0, targetValue, 1200);
            observer.disconnect();
            break;
          }
        }
      },
      { threshold: 0.15 },
    );

    observer.observe(el);
    return () => {
      observer.disconnect();
      if (animRafRef.current !== null) {
        cancelAnimationFrame(animRafRef.current);
      }
    };
  }, [targetValue, formatMetric]);

  return (
    <SolvaScrollReveal yOffset={16} blurPx={0} scaleFrom={0.995}>
      <div ref={ref} className="flex flex-col gap-[4px]">
        <div
          ref={numRef}
          className="font-solva-serif font-light text-[32px] sm:text-[40px] leading-[1.2] tracking-[-0.05em] tabular-nums"
          style={{ color: 'var(--solva-ink)' }}
        >
          {formatMetric(targetValue)}
        </div>
        <div
          className="font-solva-sans text-[14px] leading-[21px]"
          style={{ color: 'var(--solva-muted)' }}
        >
          {label}
        </div>
      </div>
    </SolvaScrollReveal>
  );
}

interface DataMappingRow {
  categoryVi: string;
  categoryEn: string;
  classification: 'basic' | 'sensitive';
  fieldsVi: string;
  fieldsEn: string;
  schemaFields: string[];
  sourceVi: string;
  sourceEn: string;
  purposeVi: string;
  purposeEn: string;
}

function buildDataMappingRows(demoEvaluatorMode: boolean): DataMappingRow[] {
  return [
    {
      categoryVi: 'Định danh & Hồ sơ tài khoản',
      categoryEn: 'Account Identity & Profile',
      classification: 'basic',
      fieldsVi:
        'Tên đăng nhập, địa chỉ email, họ và tên, trường đại học hoặc đơn vị công tác, vai trò học thuật (sinh viên, giảng viên, quản trị viên), ảnh đại diện tải lên và thời điểm xác nhận đồng ý chính sách.',
      fieldsEn:
        'Username, email address, full name, academic institution, workspace role (student, instructor, administrator), uploaded profile photo, and policy consent timestamp.',
      schemaFields: [
        'username',
        'email',
        'full_name',
        'institution',
        'role',
        'avatar_path',
        'privacy_consented_at',
      ],
      sourceVi: 'Biểu mẫu đăng ký (/register), Hồ sơ (/profile) hoặc Google OAuth 2.0.',
      sourceEn: 'Registration (/register), Profile (/profile), or Google OAuth 2.0.',
      purposeVi:
        'Tạo lập và xác thực tài khoản, gửi email kích hoạt/đặt lại mật khẩu, hiển thị hồ sơ học thuật và quản lý phân quyền lớp học.',
      purposeEn:
        'Account creation and authentication, activation/password-reset emails, academic profile display, and classroom role authorization.',
    },
    {
      categoryVi: 'Liên kết đăng nhập Google (OAuth 2.0)',
      categoryEn: 'Google Sign-In Identity (OAuth 2.0)',
      classification: 'basic',
      fieldsVi:
        'Mã liên kết tài khoản Google duy nhất, địa chỉ email đã xác minh, tên hiển thị và ảnh đại diện công khai từ tài khoản Google của bạn.',
      fieldsEn:
        'Unique Google account link identifier, verified email address, display name, and public profile image from your Google account.',
      schemaFields: ['google_id', 'email', 'full_name', 'picture_url'],
      sourceVi: 'Google Identity Services khi người dùng bấm "Đăng nhập với Google".',
      sourceEn: 'Google Identity Services when selecting "Sign in with Google".',
      purposeVi:
        'Xác thực một chạm không cần mật khẩu cục bộ và liên kết tài khoản an toàn.',
      purposeEn:
        'Single-click federated authentication and secure account linking.',
    },
    {
      categoryVi: 'Bản thảo học thuật & Dữ liệu trích dẫn',
      categoryEn: 'Academic Manuscripts & Citation Metadata',
      classification: 'basic',
      fieldsVi:
        'Tệp bản thảo PDF/Word và danh mục tham khảo (.pdf, .docx, .bib, .ris), văn bản trích xuất, thông tin nguồn trích dẫn (tác giả, tiêu đề, năm công bố, mã DOI/arXiv/PMID/ISBN/URL), điểm toàn vẹn trích dẫn (CIS), kết quả kiểm chứng và ghi chú thẩm định của giảng viên.',
      fieldsEn:
        'Uploaded PDF/Word manuscripts and bibliography files (.pdf, .docx, .bib, .ris), extracted text, cited reference entries (authors, titles, years, DOI/arXiv/PMID/ISBN/URL), Citation Integrity Score (CIS), verification verdicts, and instructor review notes.',
      schemaFields: [
        'manuscript_file',
        'extracted_text',
        'citation_entries',
        'cis_score',
        'verdict',
      ],
      sourceVi: 'Trang Tải lên (/upload), Kiểm tra hàng loạt (/batch) và Lớp học (/classes).',
      sourceEn: 'Upload (/upload), Batch Check (/batch), and Classes (/classes).',
      purposeVi:
        'Phân tích tính toàn vẹn trích dẫn hai tầng, hiển thị Trình kiểm tra tài liệu (Document Inspector), xuất báo cáo PDF/DOCX/CSV/JSON và tạo liên kết chia sẻ có chữ ký số khi người dùng yêu cầu.',
      purposeEn:
        'Two-layer citation integrity analysis, Document Inspector preview, PDF/DOCX/CSV/JSON export, and cryptographically signed shareable reports initiated by the user.',
    },
    {
      categoryVi: 'Thông tin kỹ thuật, Phiên & Bảo mật',
      categoryEn: 'Technical, Session & Security Data',
      classification: 'basic',
      fieldsVi:
        'Phiên đăng nhập bảo mật, mật khẩu mã hóa một chiều, khóa API cá nhân đã băm bảo mật, bộ đếm giới hạn tần suất chống dò mật khẩu tạm thời và tùy chọn giao diện sáng/tối, ngôn ngữ hiển thị trên trình duyệt.',
      fieldsEn:
        'Authenticated session token, one-way hashed password, hashed personal API key prefix, ephemeral login rate-limit counter, and browser theme/language preferences.',
      schemaFields: [
        'jwt_token',
        'password_hash',
        'key_prefix',
        'theme',
        'i18nextLng',
      ],
      sourceVi: 'Tự động phát sinh khi đăng nhập và sử dụng không gian làm việc.',
      sourceEn: 'Generated automatically during authentication and workspace usage.',
      purposeVi:
        'Duy trì phiên làm việc an toàn, ngăn chặn tấn công dò mật khẩu và bảo vệ tài khoản.',
      purposeEn:
        'Session continuity, brute-force rate limiting, and account protection.',
    },
    {
      categoryVi: 'Dữ liệu giao dịch & Phương thức thanh toán',
      categoryEn: 'Payment Method & Billing Transaction Data',
      classification: 'sensitive',
      fieldsVi: demoEvaluatorMode
        ? 'Thương hiệu thẻ, 4 số cuối thẻ thanh toán, quốc gia/mã bưu chính thanh toán, mã tham chiếu giao dịch qua cổng Stripe hoặc VNPay, số tiền thanh toán (USD/VND) và mã ưu đãi đã áp dụng. (Trong chế độ đánh giá học thuật, biểu mẫu chỉ nhận thẻ kiểm thử công khai và lưu 4 số cuối).'
        : 'Thương hiệu thẻ, 4 số cuối thẻ thanh toán, quốc gia/mã bưu chính thanh toán, mã tham chiếu giao dịch qua cổng Stripe hoặc VNPay, số tiền thanh toán (USD/VND) và mã ưu đãi đã áp dụng.',
      fieldsEn: demoEvaluatorMode
        ? 'Card brand, last 4 digits of payment card, billing country/postal code, Stripe or VNPay transaction reference codes, billed amount (USD/VND), and redeemed promo codes. (In academic evaluator mode, checkout forms accept public test cards only and persist only the last 4 digits).'
        : 'Card brand, last 4 digits of payment card, billing country/postal code, Stripe or VNPay transaction reference codes, billed amount (USD/VND), and redeemed promo codes.',
      schemaFields: [
        'card_brand',
        'card_last4',
        'billing_country',
        'stripe_customer_id',
        'stripe_session_id',
        'vnp_bank_code',
        'vnp_txn_ref',
      ],
      sourceVi: demoEvaluatorMode
        ? 'Trang Thanh toán nâng cấp gói Pro/Ultra (Stripe / VNPay / Chế độ Đánh giá).'
        : 'Trang Thanh toán nâng cấp gói Pro/Ultra (Stripe & VNPay).',
      sourceEn: demoEvaluatorMode
        ? 'Pro/Ultra Plan Checkout (Stripe / VNPay / Evaluator Mode).'
        : 'Pro/Ultra Plan Checkout (Stripe & VNPay).',
      purposeVi:
        'Thực hiện giao dịch nâng cấp gói dịch vụ, đối soát thanh toán, cấp hạn mức tải lên hàng tháng và hiển thị lịch sử hóa đơn của người dùng.',
      purposeEn:
        'Processing subscription upgrades, payment reconciliation, monthly upload quota provisioning, and billing history display.',
    },
  ];
}

const SCHOLARLY_APIS = [
  'Crossref (api.crossref.org)',
  'OpenAlex (api.openalex.org)',
  'PubMed / NCBI Entrez & Europe PMC',
  'arXiv (export.arxiv.org)',
  'DBLP Computer Science Bibliography',
  'DOAJ (Directory of Open Access Journals)',
  'ORCID Public API',
  'Wikidata & OpenCitations',
  'DataCite & Global DOI RA',
  'OpenAIRE Research Graph',
  'HAL Open Archive (api.archives-ouvertes.fr)',
  'Hugging Face Hub & Technical Registries (RFC / PyPI / NPM)',
  'OpenLibrary & Google Books API',
  'Internet Archive Wayback Machine',
  'Serper.dev & SerpAPI — Google Scholar fallback',
];

const TICKER_SCHOLARLY_SOURCES = [
  'Crossref',
  'OpenAlex',
  'PubMed NCBI',
  'arXiv',
  'Europe PMC',
  'DBLP',
  'DOAJ',
  'ORCID',
  'Wikidata',
  'DataCite',
  'OpenAIRE',
];

function getPolicySectionLinks(lang: Lang) {
  return lang === 'vi'
    ? [
        {
          shortLabel: '01 · Bên kiểm soát',
          title: '1. Bên kiểm soát dữ liệu',
          href: '#controller',
          icon: FileText,
        },
        {
          shortLabel: '02 · Ánh xạ dữ liệu',
          title: '2. Bảng ánh xạ dữ liệu',
          href: '#data-collected',
          icon: Database,
        },
        {
          shortLabel: '03 · Bảo mật & Lưu trữ',
          title: '3. Bảo mật & Lưu trữ',
          href: '#sensitive-data',
          icon: Lock,
        },
        {
          shortLabel: '04 · API Xuyên biên giới',
          title: '4. API Xuyên biên giới',
          href: '#third-parties',
          icon: Globe,
        },
        {
          shortLabel: '05 · Quyền & SLA',
          title: '5. Quyền & SLA luật định',
          href: '#rights',
          icon: UserCheck,
        },
      ]
    : [
        {
          shortLabel: '01 · Controller',
          title: '1. Data Controller',
          href: '#controller',
          icon: FileText,
        },
        {
          shortLabel: '02 · Data Matrix',
          title: '2. Data Mapping Matrix',
          href: '#data-collected',
          icon: Database,
        },
        {
          shortLabel: '03 · Safeguards & Retention',
          title: '3. Safeguards & Retention',
          href: '#sensitive-data',
          icon: Lock,
        },
        {
          shortLabel: '04 · Cross-Border',
          title: '4. Cross-Border APIs',
          href: '#third-parties',
          icon: Globe,
        },
        {
          shortLabel: '05 · Rights & SLAs',
          title: '5. Rights & Statutory SLAs',
          href: '#rights',
          icon: UserCheck,
        },
      ];
}

/* ============================================================
   SINGLE-ROW GLOBAL HEADER FOR `/privacy`
   Matches LandingPage / PricingPage Global Header (zero 2-line wrap
   at 1024px or 1440px in both EN & VI).
   ============================================================ */
function PrivacySolvaHeader({
  lang,
  onToggleLanguage,
  isAuthenticated,
}: {
  lang: Lang;
  onToggleLanguage: () => void;
  isAuthenticated: boolean;
}) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [headerEntered, setHeaderEntered] = useState(false);
  const [headerSettled, setHeaderSettled] = useState(false);

  useEffect(() => {
    const raf = window.requestAnimationFrame(() => setHeaderEntered(true));
    const settleTimer = window.setTimeout(() => setHeaderSettled(true), 520);
    return () => {
      window.cancelAnimationFrame(raf);
      window.clearTimeout(settleTimer);
    };
  }, []);

  const sectionLinks = getPolicySectionLinks(lang);
  const globalLinks =
    lang === 'vi'
      ? [
          { label: 'Trang chủ', to: '/' },
          { label: 'Kiến trúc', href: '/#architecture' },
          { label: 'Thực nghiệm 120K', href: '/#benchmark-120k' },
          { label: 'Bảng giá', to: '/pricing' },
          { label: 'Bảo vệ dữ liệu', to: '/privacy', active: true },
        ]
      : [
          { label: 'Home', to: '/' },
          { label: 'Architecture', href: '/#architecture' },
          { label: '120K Benchmark', href: '/#benchmark-120k' },
          { label: 'Pricing', to: '/pricing' },
          { label: 'Privacy', to: '/privacy', active: true },
        ];

  return (
    <header
      style={{
        backgroundColor: 'var(--solva-bg)',
        opacity: headerEntered ? 1 : 0.001,
        transform: headerEntered ? 'translate3d(0, 0, 0)' : 'translate3d(0, -10px, 0)',
        transition: headerSettled
          ? 'background-color 200ms ease'
          : 'opacity 480ms cubic-bezier(0.22, 1, 0.36, 1), transform 480ms cubic-bezier(0.22, 1, 0.36, 1), background-color 200ms ease',
        willChange: headerSettled ? 'auto' : 'transform, opacity',
        backfaceVisibility: 'hidden',
      }}
      className="fixed top-0 left-0 right-0 z-50 border-b border-[#E7E3D9]/70 dark:border-[#332F26]/70"
    >
      <div className="max-w-[1280px] mx-auto px-5 sm:px-6 lg:px-8 xl:px-[40px] h-[64px] lg:h-[76px] flex items-center justify-between flex-nowrap gap-3 xl:gap-4">
        {/* Left: Brand Logo */}
        <div className="flex items-center shrink-0">
          <Link
            to="/"
            className="inline-flex items-center gap-[8px] rounded-[6px] whitespace-nowrap focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1C1A15]/40 dark:focus-visible:ring-[#FBFAF6]/40"
          >
            <span className="w-[28px] h-[28px] rounded-[7px] bg-white dark:bg-[#1E1C17] border border-[#E7E3D9] dark:border-[#332F26] shadow-2xs flex items-center justify-center p-1 shrink-0 transition-colors">
              <CitraLogo size={18} />
            </span>
            <span
              style={{ color: 'var(--solva-ink)' }}
              className="font-solva-sans text-[20px] font-medium tracking-[-0.02em] leading-none"
            >
              CITRA
            </span>
          </Link>
        </div>

        {/* Center: Single-Row Global Navigation Links (Never Wraps) */}
        <nav
          aria-label="Primary Navigation"
          className="hidden lg:flex items-center justify-center flex-1 min-w-0 flex-nowrap gap-0.5 xl:gap-1.5"
        >
          {globalLinks.map((item) => {
            const isActive = Boolean(item.active);
            const itemStyle = isActive
              ? {
                  backgroundColor: 'var(--solva-surface)',
                  color: 'var(--solva-ink)',
                }
              : {
                  color: 'var(--solva-muted)',
                };
            const itemClass = `inline-flex items-center h-[38px] px-2.5 xl:px-3 rounded-[8px] font-solva-sans text-[14px] xl:text-[15px] ${
              isActive ? 'font-medium' : 'font-normal'
            } whitespace-nowrap shrink-0 hover:opacity-80 transition-opacity`;

            if ('to' in item && item.to) {
              return (
                <Link
                  key={item.label}
                  to={item.to}
                  aria-current={isActive ? 'page' : undefined}
                  style={itemStyle}
                  className={itemClass}
                >
                  {item.label}
                </Link>
              );
            }

            return (
              <a
                key={item.label}
                href={item.href}
                style={itemStyle}
                className={itemClass}
              >
                {item.label}
              </a>
            );
          })}
        </nav>

        {/* Right: Lang, Theme, Sign In, Primary Double-Slide CTA */}
        <div className="flex items-center justify-end flex-nowrap gap-1.5 sm:gap-2 shrink-0">
          <button
            type="button"
            onClick={onToggleLanguage}
            aria-label={
              lang === 'vi'
                ? 'VI / EN — Switch to English'
                : 'VI / EN — Chuyển sang Tiếng Việt'
            }
            style={{
              backgroundColor: 'var(--solva-surface)',
              color: 'var(--solva-ink)',
            }}
            className="inline-flex items-center gap-1 h-[36px] px-2.5 rounded-[8px] font-mono text-[12px] font-medium whitespace-nowrap shrink-0 hover:opacity-85 transition-opacity cursor-pointer"
            title={lang === 'vi' ? 'Switch to English' : 'Chuyển sang Tiếng Việt'}
          >
            <Globe className="w-3.5 h-3.5" />
            <span>{lang === 'vi' ? 'VI' : 'EN'}</span>
          </button>

          <ThemeToggle size="sm" />

          <Link
            to={isAuthenticated ? '/dashboard' : '/login'}
            style={{ color: 'var(--solva-muted)' }}
            className="hidden sm:inline-flex items-center h-[40px] px-2.5 xl:px-3 rounded-[8px] font-solva-sans text-[14px] xl:text-[15px] font-normal whitespace-nowrap shrink-0 hover:opacity-80 transition-opacity"
          >
            {isAuthenticated
              ? lang === 'vi'
                ? 'Không gian'
                : 'Workspace'
              : lang === 'vi'
                ? 'Đăng nhập'
                : 'Sign in'}
          </Link>

          <SolvaButton
            to={isAuthenticated ? '/settings' : '/register'}
            variant="primary"
            className="hidden sm:inline-flex shrink-0"
          >
            {isAuthenticated
              ? lang === 'vi'
                ? 'Cài đặt dữ liệu'
                : 'Data Settings'
              : lang === 'vi'
                ? 'Đăng ký'
                : 'Start Free'}
          </SolvaButton>

          {/* Mobile Hamburger Button */}
          <button
            type="button"
            onClick={() => setMobileMenuOpen((prev) => !prev)}
            aria-label="Toggle navigation menu"
            aria-expanded={mobileMenuOpen}
            style={{
              backgroundColor: 'var(--solva-surface)',
              color: 'var(--solva-ink)',
            }}
            className="lg:hidden inline-flex items-center justify-center w-[40px] h-[40px] rounded-[8px] cursor-pointer shrink-0"
          >
            {mobileMenuOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <nav
          aria-label="Mobile Privacy Navigation"
          style={{
            backgroundColor: 'var(--solva-bg)',
            borderColor: 'var(--solva-border)',
          }}
          className="lg:hidden border-t border-b px-5 py-4 space-y-2 shadow-lg animate-debugger-switch"
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            {sectionLinks.map((item) => (
              <a
                key={item.href}
                href={item.href}
                onClick={() => setMobileMenuOpen(false)}
                style={{
                  backgroundColor: 'var(--solva-surface)',
                  color: 'var(--solva-ink)',
                }}
                className="flex items-center justify-between px-3.5 py-2.5 rounded-[10px] font-solva-sans text-[14px] font-medium"
              >
                <span>{item.title}</span>
                <ChevronRight className="w-4 h-4 opacity-60" />
              </a>
            ))}
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
            <Link
              to="/pricing"
              onClick={() => setMobileMenuOpen(false)}
              style={{
                backgroundColor: 'var(--solva-surface)',
                color: 'var(--solva-ink)',
              }}
              className="flex items-center justify-between px-3.5 py-2.5 rounded-[10px] font-solva-sans text-[14px] font-medium"
            >
              <span>{lang === 'vi' ? 'Bảng giá dịch vụ' : 'Pricing Plans'}</span>
              <ChevronRight className="w-4 h-4 opacity-60" />
            </Link>
            <Link
              to="/terms"
              onClick={() => setMobileMenuOpen(false)}
              style={{
                backgroundColor: 'var(--solva-surface)',
                color: 'var(--solva-ink)',
              }}
              className="flex items-center justify-between px-3.5 py-2.5 rounded-[10px] font-solva-sans text-[14px] font-medium"
            >
              <span>{lang === 'vi' ? 'Điều khoản dịch vụ' : 'Terms of Service'}</span>
              <ChevronRight className="w-4 h-4 opacity-60" />
            </Link>
          </div>

          <div className="pt-2 flex items-center gap-2">
            <SolvaButton
              to={isAuthenticated ? '/dashboard' : '/login'}
              variant="outline"
              fullWidth
              onClick={() => setMobileMenuOpen(false)}
            >
              {isAuthenticated
                ? lang === 'vi'
                  ? 'Không gian làm việc'
                  : 'Workspace'
                : lang === 'vi'
                  ? 'Đăng nhập'
                  : 'Sign in'}
            </SolvaButton>
            <SolvaButton
              to={isAuthenticated ? '/settings' : '/register'}
              variant="primary"
              fullWidth
              onClick={() => setMobileMenuOpen(false)}
            >
              {isAuthenticated
                ? lang === 'vi'
                  ? 'Cài đặt dữ liệu'
                  : 'Data Settings'
                : lang === 'vi'
                  ? 'Đăng ký tài khoản'
                  : 'Create Account'}
            </SolvaButton>
          </div>
        </nav>
      )}
    </header>
  );
}

/* ============================================================
   STICKY HORIZONTAL POLICY SECTION SUB-BAR
   Keeps all 5 policy jump links accessible without crowding the
   global header.
   ============================================================ */
function PrivacySectionSubnav({ lang }: { lang: Lang }) {
  const sectionLinks = getPolicySectionLinks(lang);
  const isVi = lang === 'vi';

  return (
    <nav
      data-testid="privacy-section-subnav"
      aria-label={isVi ? 'Mục lục chính sách' : 'Policy section navigation'}
      style={{
        backgroundColor: 'color-mix(in srgb, var(--solva-bg) 92%, transparent)',
        borderColor: 'var(--solva-border)',
      }}
      className="sticky top-[64px] lg:top-[76px] z-40 border-b backdrop-blur-md"
    >
      <div className="max-w-[1280px] mx-auto px-5 sm:px-6 lg:px-8 xl:px-[40px] h-[42px] flex items-center justify-between gap-3 overflow-x-auto scrollbar-none">
        <div className="flex items-center flex-nowrap gap-1 sm:gap-1.5 min-w-max pr-5 sm:pr-0">
          {sectionLinks.map((item) => {
            const Icon = item.icon;
            return (
              <a
                key={item.href}
                href={item.href}
                className="inline-flex items-center gap-1.5 h-[30px] px-2.5 rounded-[7px] font-solva-sans text-[13px] font-medium whitespace-nowrap shrink-0 text-[var(--solva-muted)] hover:bg-[#F4F2EC] dark:hover:bg-[#1E1C17] hover:text-[#1C1A15] dark:hover:text-[#FBFAF6] transition-colors"
              >
                <Icon className="w-3.5 h-3.5 opacity-75 shrink-0" />
                <span>{item.shortLabel}</span>
              </a>
            );
          })}
        </div>

        <span
          style={{ color: 'var(--solva-muted)' }}
          className="hidden xl:inline-flex items-center gap-1.5 font-mono text-[11px] whitespace-nowrap shrink-0"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
          <span>
            {isVi
              ? `Luật 91/2025/QH15 · NĐ 356/2025/NĐ-CP · v${PRIVACY_POLICY_VERSION}`
              : `Law 91/2025/QH15 · Decree 356 · v${PRIVACY_POLICY_VERSION}`}
          </span>
        </span>
      </div>
    </nav>
  );
}

/* ============================================================
   INTERACTIVE HERO MOCKUP: LIVE DATA GOVERNANCE INSPECTOR
   Floating Glass-Ring Card Over Impressionist Oil Painting
   ============================================================ */
function HeroPrivacyGovernanceWidget({
  lang,
  activeStep,
  onSelectStep,
}: {
  lang: Lang;
  activeStep: number;
  onSelectStep: (idx: number) => void;
}) {
  const steps =
    lang === 'vi'
      ? [
          {
            code: '01 · CONSENT',
            badge: 'ĐIỀU 9 LUẬT 91/2025/QH15',
            title: 'Bằng chứng đồng ý tường minh',
            metric: 'v1.0 · Ghi nhận thời điểm (UTC)',
            detail:
              'Ô tích chọn mặc định để trống khi đăng ký tài khoản và liên kết Google. Hệ thống ghi nhận chính xác thời điểm và phiên bản chính sách đã đồng ý.',
            rows: [
              { k: 'Trạng thái đồng ý', v: 'Xác nhận tường minh', ok: true },
              { k: 'Mật khẩu & khóa API', v: 'Mã hóa một chiều', ok: true },
              { k: 'Cookie quảng cáo', v: '0 trình theo dõi', ok: true },
            ],
          },
          {
            code: '02 · MINIMIZER',
            badge: 'ĐIỀU 20 · API XUYÊN BIÊN GIỚI',
            title: 'Tối thiểu hóa truy vấn học thuật',
            metric: 'Chỉ gửi chuỗi thư mục',
            detail:
              `CITRA tuyệt đối không gửi toàn văn hay các chương luận văn chưa công bố ra bên ngoài, và không lập chỉ mục vào kho đối sánh tương đồng dùng chung (không ảnh hưởng kết quả Turnitin của trường); chỉ gửi chuỗi thư mục ngắn tới ${SCHOLARLY_APIS_LABEL} cơ sở dữ liệu quốc tế.`,
            rows: [
              { k: 'Dữ liệu gửi đi', v: 'Tiêu đề, tác giả, năm, DOI', ok: true },
              { k: 'Toàn văn luận văn', v: 'Không gửi · Không lưu kho chung', ok: true },
              { k: 'Số thẻ & CVV/OTP', v: 'Stripe / VNPay xử lý riêng', ok: true },
            ],
          },
          {
            code: '03 · PURGE',
            badge: 'ĐIỀU 14 · XÓA TỨC THÌ',
            title: 'Xóa triệt để, không lưu tệp tồn dư',
            metric: '0 tệp tồn dư',
            detail:
              'Chức năng tự xóa tài khoản tại Cài đặt (/settings) thu hồi toàn bộ phiên đăng nhập, xóa ảnh đại diện, bản ghi trích dẫn và gỡ bỏ vĩnh viễn tệp bản thảo gốc.',
            rows: [
              { k: 'Phiên đăng nhập', v: 'Thu hồi tức thì', ok: true },
              { k: 'Tệp bản thảo (.pdf / .docx)', v: 'Xóa vĩnh viễn', ok: true },
              { k: 'Bài nộp trong lớp học', v: 'Giữ nguyên cho sinh viên', ok: true },
            ],
          },
        ]
      : [
          {
            code: '01 · CONSENT',
            badge: 'ARTICLE 9 LAW 91/2025/QH15',
            title: 'Verifiable Explicit Consent',
            metric: 'v1.0 · UTC Timestamp',
            detail:
              'Unchecked-by-default opt-in during registration and Google Sign-In onboarding. CITRA records the exact UTC timestamp and consented policy version.',
            rows: [
              { k: 'Consent status', v: 'Explicit Opt-In', ok: true },
              { k: 'Credential protection', v: 'One-way hashed', ok: true },
              { k: 'Ad tracking pixels', v: '0 ad trackers', ok: true },
            ],
          },
          {
            code: '02 · MINIMIZER',
            badge: 'ARTICLE 20 · CROSS-BORDER',
            title: 'Bibliographic Query Minimization',
            metric: 'Metadata Strings Only',
            detail:
              `CITRA never transmits unpublished manuscript full text or chapters to external APIs and never indexes manuscripts into any shared cross-user or inter-university similarity pool (zero impact on Turnitin or institutional checks) — querying only short cited bibliographic fields across ${SCHOLARLY_APIS_LABEL} scholarly indexes.`,
            rows: [
              { k: 'Outbound query', v: 'Cited title, author, year, DOI', ok: true },
              { k: 'Manuscript full text', v: 'Never sent · No shared pool', ok: true },
              { k: 'Card numbers & CVV/OTP', v: 'Handled by Stripe / VNPay', ok: true },
            ],
          },
          {
            code: '03 · PURGE',
            badge: 'ARTICLE 14 · INSTANT PURGE',
            title: 'Complete Account & File Deletion',
            metric: '0 Residual Files',
            detail:
              'Self-service deletion in Settings (/settings) revokes active sessions, deletes profile photos and citation records, and permanently removes all uploaded manuscript files.',
            rows: [
              { k: 'Active sessions', v: 'Revoked immediately', ok: true },
              { k: 'Manuscripts (.pdf / .docx)', v: 'Permanently purged', ok: true },
              { k: 'Classroom submissions', v: 'Student ownership preserved', ok: true },
            ],
          },
        ];

  const current = steps[activeStep] ?? steps[0];

  return (
    <div
      style={{
        backgroundColor: 'var(--solva-card-elevated)',
        borderColor: 'var(--solva-border)',
      }}
      className="solva-glass-ring rounded-[14px] border p-4 sm:p-5 space-y-4"
    >
      {/* Window Bar + Step Selector */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[#E7E3D9] dark:border-[#332F26]">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <span
            style={{ color: 'var(--solva-ink)' }}
            className="font-mono text-[11px] font-semibold uppercase tracking-wider"
          >
            {lang === 'vi' ? 'KIẾN TRÚC BẢO VỆ DỮ LIỆU' : 'PRIVACY ARCHITECTURE'}
          </span>
        </div>

        <div
          style={{
            backgroundColor: 'var(--solva-surface)',
            borderColor: 'var(--solva-border)',
          }}
          className="inline-flex items-center p-0.5 rounded-[8px] border gap-0.5"
        >
          {steps.map((s, idx) => (
            <button
              key={s.code}
              type="button"
              onClick={() => onSelectStep(idx)}
              style={
                activeStep === idx
                  ? {
                      backgroundColor: 'var(--solva-btn-bg)',
                      color: 'var(--solva-btn-fg)',
                    }
                  : {
                      backgroundColor: 'transparent',
                      color: 'var(--solva-muted)',
                    }
              }
              className="px-2 py-1 rounded-[6px] font-mono text-[10px] font-semibold transition-all duration-200 cursor-pointer"
            >
              {s.code.split(' · ')[0]}
            </button>
          ))}
        </div>
      </div>

      {/* Active Step Body */}
      <div key={current.code} className="space-y-3 animate-debugger-switch">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="verdict-badge verdict-badge-verified px-2.5 py-0.5 text-[10px] font-mono">
            {current.badge}
          </span>
          <span
            style={{ color: 'var(--solva-muted)' }}
            className="font-mono text-[11px] font-medium"
          >
            {current.metric}
          </span>
        </div>

        <div>
          <h3
            style={{ color: 'var(--solva-ink)' }}
            className="font-solva-serif font-light text-[22px] sm:text-[24px] leading-[1.15] tracking-[-0.04em]"
          >
            {current.title}
          </h3>
          <p
            style={{ color: 'var(--solva-muted)' }}
            className="font-solva-sans text-[13px] sm:text-[14px] leading-[20.5px] mt-1.5"
          >
            {current.detail}
          </p>
        </div>

        <div
          style={{
            backgroundColor: 'var(--solva-surface)',
            borderColor: 'var(--solva-border)',
          }}
          className="rounded-[10px] border divide-y divide-[#E7E3D9] dark:divide-[#332F26]"
        >
          {current.rows.map((r) => (
            <div
              key={r.k}
              className="px-3 py-2 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-0.5 sm:gap-3 text-[11px] sm:text-[12px] font-mono"
            >
              <span style={{ color: 'var(--solva-muted)' }}>
                {r.k}
              </span>
              <span
                style={{ color: 'var(--solva-ink)' }}
                className="inline-flex items-center gap-1.5 font-medium"
              >
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                <span>{r.v}</span>
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   2-COLUMN SOLVA ACCORDION FOR DATA SUBJECT RIGHTS FAQ
   Zero CSS blur filter — crisp subpixel rendering on open & close.
   ============================================================ */
function PrivacyRightsAccordion({ lang }: { lang: Lang }) {
  const [openIds, setOpenIds] = useState<Record<string, boolean>>({
    'pfaq-0': true,
    'pfaq-3': true,
  });

  const toggleFaq = (id: string) => {
    setOpenIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const leftFaqs = [
    {
      id: 'pfaq-0',
      q:
        lang === 'vi'
          ? 'Làm thế nào để tôi tự rút lại sự đồng ý và xóa toàn bộ tài khoản?'
          : 'How do I withdraw consent and permanently delete my account?',
      a:
        lang === 'vi'
          ? 'Truy cập Cài đặt (/settings) → mục 05 "Bảo vệ dữ liệu cá nhân & Quyền chủ thể dữ liệu" → bấm "Xóa tài khoản & toàn bộ dữ liệu". Sau khi xác nhận mật khẩu (hoặc tên tài khoản với Google OAuth), hệ thống lập tức thu hồi phiên đăng nhập, xóa hồ sơ, ảnh đại diện và toàn bộ tệp bản thảo (.pdf, .docx, .bib, .ris) khỏi kho lưu trữ.'
          : 'Navigate to Settings (/settings) → Section 05 "Personal Data Protection & Data Subject Rights" → select "Delete Account & All Data". Confirm your password (or exact username for Google-only accounts) to immediately purge your profile, photos, citation records, and uploaded manuscript files.',
    },
    {
      id: 'pfaq-1',
      q:
        lang === 'vi'
          ? 'CITRA có bán bản thảo khóa luận, dùng bài viết huấn luyện AI hay lưu vào kho đạo văn chung không?'
          : 'Does CITRA sell my manuscripts, train external AI models, or index my thesis in a shared similarity pool?',
      a:
        lang === 'vi'
          ? 'Tuyệt đối không. CITRA không bao giờ gửi toàn văn hay các chương bản thảo chưa công bố ra bên ngoài, không dùng bài viết để huấn luyện AI và không đưa bản thảo vào bất kỳ kho đối sánh tương đồng liên trường hay liên người dùng nào (hoàn toàn không ảnh hưởng đến lần kiểm tra Turnitin hoặc hệ thống của trường sau đó). Khi kiểm chứng nguồn tham khảo, CITRA chỉ gửi chuỗi siêu dữ liệu thư mục ngắn (tiêu đề, tác giả được trích dẫn, năm công bố, DOI) tới các cơ sở dữ liệu khoa học công khai như Crossref, OpenAlex, PubMed, arXiv.'
          : 'Never. CITRA never transmits unpublished manuscript full text or chapters to external APIs, never uses submissions to train external AI models, and never indexes your manuscripts into any shared cross-user or inter-university similarity pool (zero impact on subsequent Turnitin or institutional checks). External lookups transmit only short cited bibliographic strings (cited title, cited author, publication year, DOI) to public scholarly registries such as Crossref, OpenAlex, PubMed, and arXiv.',
    },
    {
      id: 'pfaq-2',
      q:
        lang === 'vi'
          ? 'Nếu Giảng viên xóa tài khoản cá nhân, bài nộp của sinh viên trong lớp có bị mất không?'
          : 'If an Instructor deletes their account, are student essays lost?',
      a:
        lang === 'vi'
          ? 'Không. Trước khi đóng lớp học của giảng viên, hệ thống tự động tách liên kết lớp học một cách an toàn cho toàn bộ bài nộp của sinh viên, đảm bảo mỗi sinh viên vẫn giữ nguyên quyền sở hữu đối với báo cáo và tệp bản thảo của mình.'
          : 'No. Before closing an instructor’s classroom, CITRA safely detaches student submissions from that class so every student retains full ownership of their manuscripts and verification reports.',
    },
  ];

  const rightFaqs = [
    {
      id: 'pfaq-3',
      q:
        lang === 'vi'
          ? 'Hệ thống lưu trữ những thông tin gì khi tôi thanh toán nâng cấp gói Pro / Ultra?'
          : 'What payment data is stored when upgrading to Pro or Ultra?',
      a:
        lang === 'vi'
          ? 'Số thẻ đầy đủ, mã CVV/CVC và OTP ngân hàng do cổng Stripe hoặc VNPay trực tiếp xử lý theo chuẩn bảo mật PCI-DSS. Hệ thống CITRA chỉ lưu mã giao dịch tham chiếu, thương hiệu thẻ, 4 số cuối thẻ thanh toán, tên ngân hàng thanh toán và thời hạn gói dịch vụ.'
          : 'Full card numbers, CVV/CVC codes, and bank OTPs are processed directly by Stripe or VNPay under PCI-DSS security standards. CITRA stores only transaction reference IDs, card brand, the last 4 digits of your payment card, issuing bank code, and billing period.',
    },
    {
      id: 'pfaq-4',
      q:
        lang === 'vi'
          ? 'Trách nhiệm của Giảng viên khi tải hàng loạt (Batch Upload) khóa luận sinh viên là gì?'
          : 'What are an Instructor’s obligations when batch-uploading student theses?',
      a:
        lang === 'vi'
          ? 'Khi tải lên tối đa 50 bản thảo tại /batch, Giảng viên hoặc Hội đồng thẩm định chịu trách nhiệm thông báo trước và bảo đảm đã có sự đồng ý hợp pháp hoặc căn cứ quy chế đào tạo của cơ sở giáo dục đối với việc trích xuất danh mục tài liệu tham khảo để kiểm chứng.'
          : 'When uploading up to 50 manuscripts via /batch, the instructor or review board is responsible for informing student/co-author contributors and ensuring lawful consent or institutional academic policy authorization.',
    },
    {
      id: 'pfaq-5',
      q:
        lang === 'vi'
          ? 'Website có cài đặt Cookie theo dõi quảng cáo của bên thứ ba không?'
          : 'Does CITRA use third-party advertising or behavioral tracking cookies?',
      a:
        lang === 'vi'
          ? 'Không. Hệ thống không gắn Google Analytics, Meta Pixel hay TikTok Pixel. Trình duyệt chỉ lưu các tùy chọn kỹ thuật thiết yếu gồm phiên đăng nhập bảo mật, chế độ giao diện sáng/tối và ngôn ngữ hiển thị.'
          : 'No. CITRA embeds zero Google Analytics, Meta Pixel, or TikTok Pixel trackers. Browser storage holds only strictly necessary technical settings: your authenticated session, light/dark color theme, and UI display language.',
    },
  ];

  const renderColumn = (items: typeof leftFaqs, colOffset: number) => (
    <div className="flex-1 flex flex-col gap-[16px] w-full">
      {items.map((item, idx) => {
        const isOpen = Boolean(openIds[item.id]);
        return (
          <SolvaScrollReveal
            key={item.id}
            delayMs={colOffset + idx * 45}
            yOffset={18}
            blurPx={0}
          >
            <div
              style={{
                backgroundColor: 'var(--solva-surface)',
                borderColor: 'var(--solva-border)',
              }}
              className="w-full rounded-[12px] border px-[24px] transition-colors duration-200"
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
                  transition: isOpen
                    ? 'grid-template-rows 320ms cubic-bezier(0.22, 1, 0.36, 1)'
                    : 'grid-template-rows 200ms cubic-bezier(0.32, 0, 0.67, 0)',
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
                      transition: isOpen
                        ? 'opacity 320ms cubic-bezier(0.22, 1, 0.36, 1), transform 320ms cubic-bezier(0.22, 1, 0.36, 1)'
                        : 'opacity 200ms cubic-bezier(0.32, 0, 0.67, 0), transform 200ms cubic-bezier(0.32, 0, 0.67, 0)',
                    }}
                    className="pb-[24px] pr-[12px]"
                  >
                    <p
                      style={{ color: 'var(--solva-muted)' }}
                      className="font-solva-sans text-[15px] sm:text-[16px] font-normal leading-[23.2px]"
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
    <div className="flex flex-col lg:flex-row items-start gap-[16px] pt-4">
      {renderColumn(leftFaqs, 0)}
      {renderColumn(rightFaqs, 50)}
    </div>
  );
}

/* ============================================================
   FULL-BLEED 4-COLUMN SOLVA FOOTER (Aligned with Task 1.1)
   ============================================================ */
function PrivacySolvaFooter({ lang }: { lang: Lang }) {
  const columns = [
    {
      header: lang === 'vi' ? 'Nền tảng' : 'Product',
      links: [
        {
          label: lang === 'vi' ? 'Trang chủ CITRA' : 'CITRA Home',
          to: '/',
        },
        {
          label: lang === 'vi' ? 'Thực nghiệm 120K bài báo' : '120K-Paper Benchmark',
          href: '/#benchmark-120k',
        },
        {
          label: lang === 'vi' ? 'Quy trình kiểm chứng trích dẫn' : 'How Verification Works',
          href: '/#architecture',
        },
        {
          label: lang === 'vi' ? 'Bảng giá dịch vụ' : 'Pricing Plans',
          to: '/pricing',
        },
        {
          label: lang === 'vi' ? 'Sinh viên & Tác giả' : 'Student Workspace',
          to: '/#workspaces-student',
        },
        {
          label: lang === 'vi' ? 'Giảng viên & Hội đồng' : 'Teacher Classroom',
          to: '/#workspaces-teacher',
        },
        {
          label: lang === 'vi' ? 'Quản trị Khoa & Trường' : 'Admin Control',
          to: '/#workspaces-admin',
        },
      ],
    },
    {
      header: lang === 'vi' ? 'Mục lục chính sách' : 'Policy Sections',
      links: [
        {
          label: lang === 'vi' ? '1. Bên kiểm soát dữ liệu' : '1. Data Controller',
          href: '#controller',
        },
        {
          label: lang === 'vi' ? '2. Dữ liệu thu thập' : '2. Data Collected',
          href: '#data-collected',
        },
        {
          label: lang === 'vi' ? '3. Thanh toán nhạy cảm' : '3. Sensitive Billing Data',
          href: '#sensitive-data',
        },
        {
          label: lang === 'vi' ? '4. API Xuyên biên giới' : '4. Cross-Border APIs',
          href: '#third-parties',
        },
      ],
    },
    {
      header: lang === 'vi' ? 'Quyền chủ thể dữ liệu' : 'Data Subject Rights',
      links: [
        {
          label: lang === 'vi' ? 'Cookie & Bộ nhớ trình duyệt' : 'Cookies & Browser Storage',
          href: '#cookies',
        },
        {
          label: lang === 'vi' ? 'Lưu trữ & Xóa tệp gốc' : 'Retention & File Purge',
          href: '#retention',
        },
        {
          label: lang === 'vi' ? 'Cam kết SLA phản hồi' : 'Statutory Response SLAs',
          href: '#sla',
        },
        {
          label: lang === 'vi' ? 'Tự xóa tài khoản (/settings)' : 'Self-Delete (/settings)',
          to: '/settings',
        },
      ],
    },
    {
      header: lang === 'vi' ? 'Tài khoản' : 'Account',
      links: [
        { label: lang === 'vi' ? 'Đăng nhập' : 'Sign in', to: '/login' },
        { label: lang === 'vi' ? 'Đăng ký tài khoản' : 'Create account', to: '/register' },
        { label: lang === 'vi' ? 'Hồ sơ cá nhân' : 'Scholar Profile', to: '/profile' },
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
              <span className="w-[32px] h-[32px] rounded-[8px] bg-white dark:bg-[#1E1C17] border border-[#E7E3D9] dark:border-[#332F26] shadow-2xs flex items-center justify-center p-1 shrink-0 transition-colors">
                <CitraLogo size={20} />
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
                ? 'Không gian kiểm chứng trích dẫn và danh mục tài liệu tham khảo học thuật, đối chiếu trực tiếp qua hơn 15 cơ sở dữ liệu khoa học quốc tế.'
                : `Academic citation and bibliography verification workspace cross-referencing ${SCHOLARLY_APIS_LABEL} international scholarly databases.`}
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
              ? 'Tuân thủ Luật Bảo vệ dữ liệu cá nhân 91/2025/QH15 & Nghị định 356/2025/NĐ-CP.'
              : 'Aligned with Vietnam Personal Data Protection Law 91/2025/QH15 & Decree 356/2025/ND-CP.'}
          </p>
        </div>
      </div>
    </footer>
  );
}

/* ============================================================
   MAIN PAGE COMPONENT: `/privacy`
   ============================================================ */
export function PrivacyPolicyPage(): JSX.Element {
  const { i18n } = useTranslation();
  const auth = useContext(AuthContext);
  const user = auth?.user ?? null;
  const isAuthenticated = Boolean(user);
  const lang: Lang = (i18n.language || 'vi').startsWith('vi') ? 'vi' : 'en';
  const isVi = lang === 'vi';
  const demoEvaluatorMode = isDemoEvaluatorMode();

  const [activeHeroStep, setActiveHeroStep] = useState(0);
  const [heroPaused, setHeroPaused] = useState(false);
  const [dataFilter, setDataFilter] = useState<'all' | 'basic' | 'sensitive'>('all');
  const [showTechnicalSchema, setShowTechnicalSchema] = useState(false);

  useEffect(() => {
    if (heroPaused) return;
    const timer = window.setInterval(() => {
      setActiveHeroStep((prev) => (prev + 1) % 3);
    }, 3600);
    return () => window.clearInterval(timer);
  }, [heroPaused]);

  const toggleLanguage = () => {
    void i18n.changeLanguage(isVi ? 'en' : 'vi');
  };

  const dataMappingRows = buildDataMappingRows(demoEvaluatorMode);
  const filteredMappingRows = dataMappingRows.filter((row) =>
    dataFilter === 'all' ? true : row.classification === dataFilter,
  );

  return (
    <div
      data-testid="privacy-policy-page"
      data-lang={lang}
      className="solva-editorial-root min-h-screen overflow-x-clip selection:bg-[#1C1A15] selection:text-[#FBFAF6]"
    >
      {/* Căn cứ pháp lý: Luật Bảo vệ dữ liệu cá nhân 91/2025/QH15 (Điều 4, 9, 11, 14, 20, 23, 37) & Nghị định 356/2025/NĐ-CP (Điều 4, 5, 6, 7, 18) */}
      <PrivacySolvaHeader
        lang={lang}
        onToggleLanguage={toggleLanguage}
        isAuthenticated={isAuthenticated}
      />

      <main id="privacy-main-content" className="pt-[64px] lg:pt-[76px]">
        <PrivacySectionSubnav lang={lang} />

        {/* ============================================================
            SECTION 0: HERO + OFFICIAL v1.0 BADGE + PAINTERLY MOCKUP + API TICKER
            ============================================================ */}
        <section
          id="privacy-hero"
          className="pt-[24px] sm:pt-[32px] lg:pt-[44px] pb-[32px] sm:pb-[48px] lg:pb-[64px] px-5 sm:px-6 lg:px-[40px]"
        >
          <div className="max-w-[1200px] mx-auto flex flex-col gap-[28px] sm:gap-[36px] lg:gap-[44px]">
            {/* Official v1.0 Personal Data Protection Notice Callout */}
            <SolvaScrollReveal delayMs={10} yOffset={14} blurPx={0}>
              <div
                role="note"
                style={{
                  backgroundColor: 'var(--solva-surface)',
                  borderColor: 'var(--solva-border)',
                }}
                className="rounded-[16px] border p-4 sm:p-5 flex flex-col sm:flex-row items-start gap-3.5 shadow-2xs"
              >
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[6px] bg-emerald-500/[0.12] text-emerald-800 dark:text-emerald-300 border border-emerald-500/25 font-mono text-[11px] font-semibold shrink-0 mt-0.5">
                  <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
                  <span>
                    {isVi
                      ? `CHÍNH SÁCH BẢO VỆ DỮ LIỆU CÁ NHÂN · PHIÊN BẢN ${PRIVACY_POLICY_VERSION}`
                      : `OFFICIAL PERSONAL DATA PROTECTION NOTICE · v${PRIVACY_POLICY_VERSION}`}
                  </span>
                </span>
                <div className="space-y-1 font-solva-sans text-[13px] sm:text-[14px] leading-[21px]">
                  <p style={{ color: 'var(--solva-ink)' }} className="font-medium">
                    {isVi
                      ? 'Thông báo chính thức về xử lý và bảo vệ dữ liệu cá nhân trên không gian học thuật CITRA'
                      : 'Official transparency notice for personal data protection across the CITRA workspace'}
                  </p>
                  <p style={{ color: 'var(--solva-muted)' }}>
                    {isVi
                      ? 'Văn bản này công bố minh bạch quy trình thu thập, phân loại, bảo mật và thực thi quyền chủ thể dữ liệu trên hệ thống CITRA theo Luật Bảo vệ dữ liệu cá nhân số 91/2025/QH15 và Nghị định số 356/2025/NĐ-CP.'
                      : 'This notice governs how CITRA classifies, minimizes, safeguards, and honors data subject rights under Vietnam Personal Data Protection Law No. 91/2025/QH15 and Decree No. 356/2025/ND-CP.'}
                  </p>
                </div>
              </div>
            </SolvaScrollReveal>

            {/* Top 2-Column Editorial Split */}
            <div className="flex flex-col lg:flex-row items-center justify-between gap-[28px] sm:gap-[32px] lg:gap-[32px]">
              {/* Left Column */}
              <div className="w-full lg:flex-1 lg:max-w-[548px] flex flex-col items-start gap-[22px] sm:gap-[26px]">
                <div className="flex flex-col items-start gap-[16px] sm:gap-[20px]">
                  <PrivacyEyebrow>
                    {isVi
                      ? `Luật 91/2025/QH15 · Nghị định 356/2025/NĐ-CP · Phiên bản ${PRIVACY_POLICY_VERSION}`
                      : `Law No. 91/2025/QH15 · Decree 356/2025/ND-CP · Version ${PRIVACY_POLICY_VERSION}`}
                  </PrivacyEyebrow>

                  <PrivacyTwoToneHeading
                    as="h1"
                    size="h1"
                    delayMs={40}
                    primary={
                      isVi
                        ? 'Chính sách bảo vệ'
                        : 'Personal data policy'
                    }
                    secondary={
                      isVi
                        ? '& thông báo xử lý dữ liệu cá nhân.'
                        : '& transparent processing notice.'
                    }
                  />

                  <SolvaScrollReveal delayMs={80} yOffset={16} blurPx={0}>
                    <p
                      style={{ color: 'var(--solva-muted)' }}
                      className="font-solva-sans text-[16px] sm:text-[17px] font-normal leading-[24.8px] max-w-[490px]"
                    >
                      {isVi
                        ? 'Giải trình minh bạch cách CITRA thu thập, phân loại dữ liệu cá nhân cơ bản và nhạy cảm, đối chiếu qua hơn 15 cơ sở dữ liệu học thuật quốc tế, lưu trữ an toàn và bảo đảm quyền tự xóa sạch dữ liệu bất cứ lúc nào.'
                        : `A transparent breakdown of how CITRA classifies basic and sensitive personal data, queries ${SCHOLARLY_APIS_LABEL} international scholarly indexes, safeguards manuscripts, and guarantees instant self-service deletion.`}
                    </p>
                  </SolvaScrollReveal>
                </div>

                {/* Action Buttons */}
                <SolvaScrollReveal delayMs={110} yOffset={14} blurPx={0}>
                  <div className="flex flex-wrap items-center gap-3">
                    <SolvaButton
                      to={isAuthenticated ? '/settings' : '/login'}
                      variant="primary"
                    >
                      {isAuthenticated
                        ? isVi
                          ? 'Quản lý Quyền dữ liệu (/settings)'
                          : 'Manage Data Rights (/settings)'
                        : isVi
                          ? 'Đăng nhập quản lý dữ liệu'
                          : 'Sign in to manage data'}
                    </SolvaButton>
                    <SolvaButton href="#data-collected" variant="outline">
                      {isVi ? 'Xem bảng ánh xạ dữ liệu' : 'Explore Data Matrix'}
                    </SolvaButton>
                  </div>
                </SolvaScrollReveal>

                {/* Statutory SLA Proof Strip */}
                <SolvaScrollReveal delayMs={140} yOffset={14} blurPx={0} className="w-full">
                  <a
                    href="#sla"
                    style={{
                      backgroundColor: 'var(--solva-surface)',
                      borderColor: 'var(--solva-border)',
                    }}
                    className="group block w-full rounded-[12px] border p-3.5 transition-all duration-200 hover:border-[#1C1A15]/40 dark:hover:border-[#FBFAF6]/30"
                  >
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <span
                        style={{ color: 'var(--solva-ink)' }}
                        className="inline-flex items-center gap-1.5 font-mono text-[10px] sm:text-[11px] font-semibold uppercase tracking-wider"
                      >
                        <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                        <span>
                          {isVi
                            ? 'CAM KẾT PHẢN HỒI LUẬT ĐỊNH · ĐIỀU 5 NĐ 356/2025/NĐ-CP'
                            : 'STATUTORY RESPONSE SLAs · DECREE 356/2025/ND-CP ART. 5'}
                        </span>
                      </span>
                      <ArrowRight
                        style={{ color: 'var(--solva-muted)' }}
                        className="w-3.5 h-3.5 transition-transform duration-200 group-hover:translate-x-0.5 shrink-0"
                      />
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4 gap-2.5 pt-2 border-t border-[#E7E3D9] dark:border-[#332F26]">
                      <div>
                        <div
                          style={{ color: 'var(--solva-ink)' }}
                          className="font-solva-serif text-[20px] sm:text-[22px] leading-none tracking-[-0.04em]"
                        >
                          {isVi ? '02 ngày' : '2 days'}
                        </div>
                        <div
                          style={{ color: 'var(--solva-muted)' }}
                          className="font-solva-sans text-[11px] leading-snug mt-1"
                        >
                          {isVi ? 'Tiếp nhận (làm việc)' : 'Business-day ack'}
                        </div>
                      </div>
                      <div>
                        <div className="font-solva-serif text-[20px] sm:text-[22px] leading-none tracking-[-0.04em] text-emerald-700 dark:text-emerald-400">
                          {isVi ? '10–15 ngày' : '10–15d'}
                        </div>
                        <div
                          style={{ color: 'var(--solva-muted)' }}
                          className="font-solva-sans text-[11px] leading-snug mt-1"
                        >
                          {isVi ? 'Xem, sửa & cung cấp' : 'Access & rectify'}
                        </div>
                      </div>
                      <div>
                        <div
                          style={{ color: 'var(--solva-ink)' }}
                          className="font-solva-serif text-[20px] sm:text-[22px] leading-none tracking-[-0.04em]"
                        >
                          {isVi ? '20–30 ngày' : '20–30d'}
                        </div>
                        <div
                          style={{ color: 'var(--solva-muted)' }}
                          className="font-solva-sans text-[11px] leading-snug mt-1"
                        >
                          {isVi ? 'Yêu cầu xóa dữ liệu' : 'Deletion requests'}
                        </div>
                      </div>
                      <div>
                        <div className="font-solva-serif text-[20px] sm:text-[22px] leading-none tracking-[-0.04em] text-emerald-700 dark:text-emerald-400">
                          {isVi ? 'Tức thì' : 'Instant'}
                        </div>
                        <div
                          style={{ color: 'var(--solva-muted)' }}
                          className="font-solva-sans text-[11px] leading-snug mt-1"
                        >
                          {isVi ? 'Tự xóa tại /settings' : 'Self-purge /settings'}
                        </div>
                      </div>
                    </div>
                  </a>
                </SolvaScrollReveal>
              </div>

              {/* Right Column: Painterly Oil Frame + Live Governance Inspector */}
              <SolvaScrollReveal
                delayMs={80}
                yOffset={24}
                scaleFrom={0.985}
                blurPx={0}
                className="w-full lg:w-[480px] xl:w-[612px] shrink-0"
              >
                <div
                  onMouseEnter={() => setHeroPaused(true)}
                  onMouseLeave={() => setHeroPaused(false)}
                >
                  <SolvaPainterlyFrame
                    paintingSrc="/solva/hero-bg.webp"
                    priority
                    alt="Impressionist wildflower meadow oil painting backdrop"
                    className="w-full min-h-[380px] sm:min-h-[430px] p-5 sm:p-8 flex items-center justify-center"
                  >
                    <div className="w-full max-w-[520px]">
                      <HeroPrivacyGovernanceWidget
                        lang={lang}
                        activeStep={activeHeroStep}
                        onSelectStep={setActiveHeroStep}
                      />
                    </div>
                  </SolvaPainterlyFrame>
                </div>
              </SolvaScrollReveal>
            </div>

            {/* Bottom Infinite Edge-Masked Scholarly API Ticker */}
            <SolvaScrollReveal delayMs={120} yOffset={14} blurPx={0} triggerRatio={0.99}>
              <div className="w-full py-[10px] sm:py-[16px] lg:py-[24px] overflow-hidden solva-ticker-mask">
                <div className="animate-solva-marquee flex items-center gap-[44px] sm:gap-[64px] lg:gap-[72px]">
                  {[...TICKER_SCHOLARLY_SOURCES, ...TICKER_SCHOLARLY_SOURCES].map(
                    (apiName, idx) => {
                      const href = getScholarlySourceUrl(apiName) ?? '#third-parties';
                      return (
                        <a
                          key={`${apiName}-${idx}`}
                          href={href}
                          target={href.startsWith('http') ? '_blank' : undefined}
                          rel={href.startsWith('http') ? 'noopener noreferrer' : undefined}
                          style={{ color: 'var(--solva-ink)' }}
                          className="group inline-flex items-center gap-2.5 px-2.5 py-2 -mx-2.5 -my-1.5 rounded-[8px] shrink-0 select-none cursor-pointer opacity-80 hover:opacity-100 hover:-translate-y-[1px] transition-all duration-200"
                        >
                          <ScholarlySourceLogo
                            name={apiName}
                            size={20}
                            className="opacity-90 group-hover:opacity-100 transition-opacity"
                          />
                          <span className="font-solva-sans text-[17px] sm:text-[18px] font-medium tracking-[-0.03em] whitespace-nowrap">
                            {apiName}
                          </span>
                        </a>
                      );
                    },
                  )}
                </div>
              </div>
            </SolvaScrollReveal>
          </div>
        </section>

        {/* ============================================================
            SECTION 1: DATA CONTROLLER (`#controller`)
            ============================================================ */}
        <section
          id="controller"
          className="scroll-mt-[132px] py-[36px] sm:py-[56px] lg:py-[80px] px-5 sm:px-6 lg:px-[40px]"
        >
          <div className="max-w-[1200px] mx-auto flex flex-col gap-[28px] sm:gap-[36px]">
            <div className="flex flex-col items-start gap-[12px] max-w-[680px]">
              <PrivacyEyebrow>
                {isVi
                  ? 'Mục 01 · Điều 37 Luật 91/2025/QH15 & Điều 7 NĐ 356/2025/NĐ-CP'
                  : 'Section 01 · Article 37 Law 91/2025/QH15 & Article 7 Decree 356'}
              </PrivacyEyebrow>
              <PrivacyTwoToneHeading
                primary={
                  isVi
                    ? 'Bên Kiểm soát và Xử lý'
                    : 'Personal Data Controller'
                }
                secondary={
                  isVi
                    ? 'dữ liệu cá nhân trên hệ thống CITRA.'
                    : '& Designated Contact Entity.'
                }
              />
              <SolvaScrollReveal delayMs={40} yOffset={14} blurPx={0}>
                <p
                  style={{ color: 'var(--solva-muted)' }}
                  className="font-solva-sans text-[15px] sm:text-[16px] leading-[23.8px] pt-1"
                >
                  {isVi
                    ? 'Thông tin định danh pháp lý và kênh tiếp nhận yêu cầu quyền chủ thể dữ liệu của đơn vị vận hành nền tảng CITRA (https://citra.io.vn):'
                    : 'Operating entity details and official data protection intake channels for the CITRA platform (https://citra.io.vn):'}
                </p>
              </SolvaScrollReveal>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-[16px] items-stretch">
              <SolvaScrollReveal delayMs={0} yOffset={18} blurPx={0} className="h-full">
                <div
                  style={{
                    backgroundColor: 'var(--solva-surface)',
                    borderColor: 'var(--solva-border)',
                  }}
                  className="rounded-[16px] border p-6 sm:p-7 h-full flex flex-col justify-between gap-4"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span
                      style={{ color: 'var(--solva-ink)' }}
                      className="font-solva-sans text-[16px] sm:text-[17px] font-medium leading-snug"
                    >
                      {isVi
                        ? 'Đơn vị chủ quản / Nhóm phát triển'
                        : 'Operating Entity / Project Team'}
                    </span>
                    <span
                      style={{
                        backgroundColor: 'var(--solva-bg)',
                        borderColor: 'var(--solva-border)',
                        color: 'var(--solva-muted)',
                      }}
                      className="px-2.5 py-1 rounded-[6px] border font-mono text-[10px] font-semibold shrink-0"
                    >
                      01 · ENTITY
                    </span>
                  </div>
                  <div
                    style={{
                      backgroundColor: 'var(--solva-bg)',
                      borderColor: 'var(--solva-border)',
                      color: 'var(--solva-ink)',
                    }}
                    className="rounded-[10px] border px-3.5 py-3 font-solva-sans text-[14px] sm:text-[15px] font-medium leading-relaxed"
                  >
                    {isVi
                      ? 'Trường Đại học Tôn Đức Thắng (TDTU)'
                      : 'Ton Duc Thang University (TDTU)'}
                  </div>
                </div>
              </SolvaScrollReveal>

              <SolvaScrollReveal delayMs={50} yOffset={18} blurPx={0} className="h-full">
                <div
                  style={{
                    backgroundColor: 'var(--solva-surface)',
                    borderColor: 'var(--solva-border)',
                  }}
                  className="rounded-[16px] border p-6 sm:p-7 h-full flex flex-col justify-between gap-4"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span
                      style={{ color: 'var(--solva-ink)' }}
                      className="font-solva-sans text-[16px] sm:text-[17px] font-medium leading-snug"
                    >
                      {isVi
                        ? 'Địa chỉ trụ sở chính'
                        : 'Headquarters Address'}
                    </span>
                    <span
                      style={{
                        backgroundColor: 'var(--solva-bg)',
                        borderColor: 'var(--solva-border)',
                        color: 'var(--solva-muted)',
                      }}
                      className="px-2.5 py-1 rounded-[6px] border font-mono text-[10px] font-semibold shrink-0"
                    >
                      02 · ADDRESS
                    </span>
                  </div>
                  <div
                    style={{
                      backgroundColor: 'var(--solva-bg)',
                      borderColor: 'var(--solva-border)',
                      color: 'var(--solva-ink)',
                    }}
                    className="rounded-[10px] border px-3.5 py-3 font-solva-sans text-[14px] sm:text-[15px] leading-relaxed"
                  >
                    {isVi
                      ? '19 Nguyễn Hữu Thọ, phường Tân Hưng, TP. Hồ Chí Minh'
                      : '19 Nguyen Huu Tho Street, Tan Hung Ward, Ho Chi Minh City, Vietnam'}
                  </div>
                </div>
              </SolvaScrollReveal>

              <SolvaScrollReveal delayMs={100} yOffset={18} blurPx={0} className="h-full">
                <div
                  style={{
                    backgroundColor: 'var(--solva-surface)',
                    borderColor: 'var(--solva-border)',
                  }}
                  className="rounded-[16px] border p-6 sm:p-7 h-full flex flex-col justify-between gap-4"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span
                      style={{ color: 'var(--solva-ink)' }}
                      className="font-solva-sans text-[16px] sm:text-[17px] font-medium leading-snug"
                    >
                      {isVi
                        ? 'Bộ phận / Nhân sự Bảo vệ dữ liệu cá nhân & Kênh tiếp nhận'
                        : 'Data Protection Contact & Intake Channel'}
                    </span>
                    <span
                      style={{
                        backgroundColor: 'var(--solva-bg)',
                        borderColor: 'var(--solva-border)',
                        color: 'var(--solva-muted)',
                      }}
                      className="px-2.5 py-1 rounded-[6px] border font-mono text-[10px] font-semibold shrink-0"
                    >
                      03 · DPO &amp; INTAKE
                    </span>
                  </div>
                  <div
                    style={{
                      backgroundColor: 'var(--solva-bg)',
                      borderColor: 'var(--solva-border)',
                      color: 'var(--solva-ink)',
                    }}
                    className="rounded-[10px] border px-3.5 py-3 font-solva-sans text-[14px] sm:text-[15px] leading-relaxed flex flex-col gap-0.5"
                  >
                    <span className="font-medium">
                      {isVi ? 'Nguyễn Bảo Minh' : 'Nguyen Bao Minh'}
                    </span>
                    <span style={{ color: 'var(--solva-muted)' }} className="text-[13px] sm:text-[14px]">
                      Email:{' '}
                      <a
                        href="mailto:iannwendii@gmail.com"
                        style={{ color: 'var(--solva-ink)' }}
                        className="font-mono underline underline-offset-4 hover:opacity-75 transition-opacity"
                      >
                        iannwendii@gmail.com
                      </a>
                    </span>
                  </div>
                </div>
              </SolvaScrollReveal>
            </div>
          </div>
        </section>

        {/* ============================================================
            SECTION 2: PERSONAL DATA MAPPING MATRIX (`#data-collected`)
            Human-first primary prose + collapsible Technical Schema pills
            ============================================================ */}
        <section
          id="data-collected"
          className="scroll-mt-[132px] py-[36px] sm:py-[56px] lg:py-[80px] px-5 sm:px-6 lg:px-[40px]"
        >
          <div className="max-w-[1200px] mx-auto flex flex-col gap-[28px] sm:gap-[36px]">
            <div className="flex flex-col xl:flex-row xl:items-end justify-between gap-5">
              <div className="flex flex-col items-start gap-[12px] max-w-[540px]">
                <PrivacyEyebrow>
                  {isVi
                    ? 'Mục 02 · Điều 11 Luật 91/2025/QH15 & Điều 4 NĐ 356/2025/NĐ-CP'
                    : 'Section 02 · Article 11 Law 91/2025/QH15 & Article 4 Decree 356'}
                </PrivacyEyebrow>
                <PrivacyTwoToneHeading
                  primary={
                    isVi
                      ? 'Danh mục dữ liệu thu thập'
                      : 'Personal data inventory'
                  }
                  secondary={
                    isVi
                      ? '& mục đích xử lý theo từng phân nhóm.'
                      : '& strict purpose limitation.'
                  }
                />
              </div>

              {/* Filter Track + Collapsible Technical Schema Toggle */}
              <SolvaScrollReveal delayMs={60} yOffset={14} blurPx={0}>
                <div className="flex flex-wrap xl:flex-nowrap items-center gap-2.5 max-w-full">
                  <div
                    style={{
                      backgroundColor: 'var(--solva-surface)',
                      borderColor: 'var(--solva-border)',
                    }}
                    className="inline-flex flex-wrap sm:flex-nowrap max-w-full items-center p-[5px] rounded-[12px] border gap-1"
                    role="group"
                    aria-label="Filter personal data categories"
                  >
                    {(
                      [
                        {
                          key: 'all',
                          vi: `Tất cả (${dataMappingRows.length})`,
                          en: `All (${dataMappingRows.length})`,
                        },
                        {
                          key: 'basic',
                          vi: 'Dữ liệu Cơ bản (4)',
                          en: 'Basic Data (4)',
                        },
                        {
                          key: 'sensitive',
                          vi: 'Dữ liệu Nhạy cảm (1)',
                          en: 'Sensitive Data (1)',
                        },
                      ] as const
                    ).map((tab) => (
                      <button
                        key={tab.key}
                        type="button"
                        aria-pressed={dataFilter === tab.key}
                        onClick={() => setDataFilter(tab.key)}
                        style={
                          dataFilter === tab.key
                            ? {
                                backgroundColor: 'var(--solva-btn-bg)',
                                color: 'var(--solva-btn-fg)',
                              }
                            : {
                                backgroundColor: 'transparent',
                                color: 'var(--solva-muted)',
                              }
                        }
                        className="px-2.5 sm:px-3.5 py-2 rounded-[8px] font-solva-sans text-[13px] font-medium whitespace-nowrap transition-all duration-200 cursor-pointer"
                      >
                        {isVi ? tab.vi : tab.en}
                      </button>
                    ))}
                  </div>

                  <button
                    type="button"
                    data-testid="privacy-schema-toggle"
                    aria-label="Chi tiết trường kỹ thuật / Technical Schema"
                    aria-expanded={showTechnicalSchema}
                    onClick={() => setShowTechnicalSchema((prev) => !prev)}
                    style={
                      showTechnicalSchema
                        ? {
                            backgroundColor: 'var(--solva-btn-bg)',
                            color: 'var(--solva-btn-fg)',
                            borderColor: 'var(--solva-btn-bg)',
                          }
                        : {
                            backgroundColor: 'var(--solva-surface)',
                            color: 'var(--solva-ink)',
                            borderColor: 'var(--solva-border)',
                          }
                    }
                    className="inline-flex items-center gap-1.5 min-h-[44px] max-w-full px-3.5 py-2 rounded-[12px] border font-mono text-[12px] font-medium whitespace-normal sm:whitespace-nowrap text-left transition-colors duration-200 cursor-pointer"
                  >
                    <Code2 className="w-3.5 h-3.5 shrink-0" />
                    <span>{isVi ? 'Chi tiết trường kỹ thuật' : 'Technical Schema'}</span>
                  </button>
                </div>
              </SolvaScrollReveal>
            </div>

            <SolvaScrollReveal delayMs={60} yOffset={20} blurPx={0}>
              <div
                style={{
                  backgroundColor: 'var(--solva-surface)',
                  borderColor: 'var(--solva-border)',
                }}
                className="rounded-[16px] border p-[8px] sm:p-[12px]"
              >
                <div
                  style={{
                    backgroundColor: 'var(--solva-card-elevated)',
                    borderColor: 'var(--solva-border)',
                  }}
                  className="overflow-x-auto rounded-[12px] border"
                >
                  <table className="w-full text-left border-collapse font-solva-sans text-[14px]">
                    <thead>
                      <tr
                        style={{
                          backgroundColor: 'var(--solva-surface)',
                          borderColor: 'var(--solva-border)',
                        }}
                        className="border-b"
                      >
                        <th
                          style={{ color: 'var(--solva-ink)' }}
                          className="p-4 font-medium whitespace-nowrap"
                        >
                          {isVi ? 'Nhóm dữ liệu & Nguồn' : 'Category & Source'}
                        </th>
                        <th
                          style={{ color: 'var(--solva-ink)' }}
                          className="p-4 font-medium whitespace-nowrap"
                        >
                          {isVi ? 'Phân loại' : 'Classification'}
                        </th>
                        <th
                          style={{ color: 'var(--solva-ink)' }}
                          className="p-4 font-medium min-w-[260px]"
                        >
                          {isVi ? 'Thông tin thu thập' : 'Information Collected'}
                        </th>
                        <th
                          style={{ color: 'var(--solva-ink)' }}
                          className="p-4 font-medium min-w-[240px]"
                        >
                          {isVi ? 'Mục đích xử lý' : 'Processing Purpose'}
                        </th>
                      </tr>
                    </thead>
                    <tbody
                      key={dataFilter}
                      className="divide-y divide-[#E7E3D9] dark:divide-[#332F26] animate-debugger-switch"
                    >
                      {filteredMappingRows.map((row) => (
                        <tr
                          key={row.categoryEn}
                          className="align-top hover:bg-[#F4F2EC]/55 dark:hover:bg-[#1E1C17]/65 transition-colors"
                        >
                          <td className="p-4 sm:w-[250px]">
                            <div
                              style={{ color: 'var(--solva-ink)' }}
                              className="font-medium leading-snug"
                            >
                              {isVi ? row.categoryVi : row.categoryEn}
                            </div>
                            <div
                              style={{ color: 'var(--solva-muted)' }}
                              className="font-mono text-[11px] mt-1.5 leading-relaxed"
                            >
                              {isVi ? row.sourceVi : row.sourceEn}
                            </div>
                          </td>
                          <td className="p-4 whitespace-nowrap">
                            {row.classification === 'sensitive' ? (
                              <span className="verdict-badge verdict-badge-hallucinated px-2.5 py-0.5 text-[11px] font-mono">
                                {isVi ? 'Nhạy cảm' : 'Sensitive'}
                              </span>
                            ) : (
                              <span className="verdict-badge verdict-badge-verified px-2.5 py-0.5 text-[11px] font-mono">
                                {isVi ? 'Cơ bản' : 'Basic'}
                              </span>
                            )}
                          </td>
                          <td
                            style={{ color: 'var(--solva-ink)' }}
                            className="p-4 leading-[22px]"
                          >
                            <p>{isVi ? row.fieldsVi : row.fieldsEn}</p>
                            {showTechnicalSchema && (
                              <div className="mt-2.5 pt-2 border-t border-[#E7E3D9]/80 dark:border-[#332F26]/80 flex flex-wrap gap-1.5">
                                {row.schemaFields.map((field) => (
                                  <code
                                    key={field}
                                    style={{
                                      backgroundColor: 'var(--solva-surface)',
                                      borderColor: 'var(--solva-border)',
                                      color: 'var(--solva-ink)',
                                    }}
                                    className="px-2 py-0.5 rounded-[6px] border font-mono text-[11px]"
                                  >
                                    {field}
                                  </code>
                                ))}
                              </div>
                            )}
                          </td>
                          <td
                            style={{ color: 'var(--solva-muted)' }}
                            className="p-4 leading-[22px]"
                          >
                            {isVi ? row.purposeVi : row.purposeEn}
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
            SECTION 3: 3-CARD STICKY STACK — SENSITIVE DATA, COOKIES & RETENTION
            ============================================================ */}
        <section
          id="sensitive-data"
          className="scroll-mt-[132px] py-[36px] sm:py-[56px] lg:py-[88px] px-5 sm:px-6 lg:px-[40px]"
        >
          <div className="max-w-[1200px] mx-auto flex flex-col gap-[32px] sm:gap-[48px]">
            <div className="flex flex-col items-start gap-[12px] max-w-[680px]">
              <PrivacyEyebrow>
                {isVi
                  ? 'Mục 03 · Bảo vệ Thanh toán, Trình duyệt & Vòng đời Tệp bản thảo'
                  : 'Section 03 · Payment Safeguards, Storage & Manuscript Lifecycle'}
              </PrivacyEyebrow>
              <PrivacyTwoToneHeading
                primary={
                  isVi
                    ? 'Ba nguyên tắc cốt lõi'
                    : 'Three technical guardrails'
                }
                secondary={
                  isVi
                    ? 'bảo vệ dữ liệu nhạy cảm và quyền xóa sạch.'
                    : 'protecting billing, browser state, and file purge.'
                }
              />
            </div>

            <div className="flex flex-col gap-[24px]">
              {/* Sticky Card 0: Sensitive Billing Data */}
              <SolvaStickyStackCard index={0} total={3} baseTopDesktop={132} baseTopMobile={118}>
                <div className="grid grid-cols-1 lg:grid-cols-12 items-center gap-6">
                  <div className="lg:col-span-7 p-4 sm:p-7 space-y-4">
                    <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-[6px] bg-red-500/10 text-red-700 dark:text-red-300 border border-red-500/20 font-mono text-[11px] font-semibold">
                      <Lock className="w-3.5 h-3.5" />
                      <span>
                        {isVi
                          ? '3.1 · DỮ LIỆU CÁ NHÂN NHẠY CẢM TRONG THANH TOÁN'
                          : '3.1 · SENSITIVE PERSONAL DATA IN BILLING'}
                      </span>
                    </div>
                    <h3
                      style={{ color: 'var(--solva-ink)' }}
                      className="font-solva-serif font-light text-[28px] sm:text-[34px] leading-[1.1] tracking-[-0.04em]"
                    >
                      {isVi
                        ? 'Xử lý Dữ liệu Cá nhân Nhạy cảm trong Thanh toán'
                        : 'Sensitive Personal Data Processing in Billing'}
                    </h3>
                    <p
                      style={{ color: 'var(--solva-muted)' }}
                      className="font-solva-sans text-[15px] leading-[23px]"
                    >
                      {isVi
                        ? 'Theo điểm i, điểm k khoản 1 Điều 4 và khoản 4 Điều 6 Nghị định số 356/2025/NĐ-CP, thông tin gắn với phương thức thanh toán ngân hàng/trung gian thanh toán thuộc nhóm dữ liệu cá nhân nhạy cảm:'
                        : 'Under Article 4.1(i, k) and Article 6.4 of Decree No. 356/2025/ND-CP, banking and payment instrument records constitute sensitive personal data:'}
                    </p>
                    <ul className="space-y-2.5 font-solva-sans text-[14px] sm:text-[15px] leading-[22px]">
                      <li className="flex items-start gap-2.5">
                        <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 mt-1 shrink-0" />
                        <span style={{ color: 'var(--solva-ink)' }}>
                          {isVi
                            ? 'Cổng thanh toán Stripe & VNPay chính thức: số thẻ đầy đủ, mã bảo mật CVV/CVC và OTP ngân hàng được xử lý trực tiếp trên hạ tầng chuẩn PCI-DSS của Stripe và VNPay. CITRA chỉ lưu mã giao dịch tham chiếu, thương hiệu thẻ, 4 số cuối thẻ thanh toán, tên ngân hàng thanh toán, quốc gia/mã bưu chính và thời hạn gói dịch vụ.'
                            : 'Official Stripe & VNPay gateways: full card numbers, CVV/CVC codes, and bank OTPs are handled directly on Stripe and VNPay PCI-DSS infrastructure. CITRA retains only transaction IDs, card brand, last 4 card digits, issuing bank code, billing country/postal code, and plan tier.'}
                        </span>
                      </li>
                      <li className="flex items-start gap-2.5">
                        <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 mt-1 shrink-0" />
                        <span style={{ color: 'var(--solva-ink)' }}>
                          {demoEvaluatorMode
                            ? isVi
                              ? 'Chế độ đánh giá học thuật (Stripe Demo / VNPay Sandbox): hiển thị cảnh báo rõ chỉ nhập thẻ kiểm thử công khai, tuyệt đối không nhập thẻ ngân hàng thật và chỉ ghi nhận 4 chữ số cuối.'
                              : 'Evaluator simulation mode (Stripe Demo / VNPay Sandbox): explicitly warns evaluators to enter public test cards only, never real bank cards, persisting only the last 4 digits.'
                            : isVi
                              ? 'Đối soát minh bạch & tự quản lý gói dịch vụ: biên lai điện tử và hạn mức tải lên được kích hoạt tức thì qua chữ ký số xác thực; người dùng có thể tra cứu hóa đơn hoặc hủy gia hạn tự động bất cứ lúc nào tại Cài đặt (/settings).'
                              : 'Cryptographic reconciliation & billing control: digital receipts and upload quotas unlock via verified webhook signatures, and subscribers can review invoices or cancel auto-renewal anytime in Settings (/settings).'}
                        </span>
                      </li>
                    </ul>
                  </div>

                  <div className="lg:col-span-5">
                    <SolvaPainterlyFrame
                      paintingSrc="/solva/feature-1-bg.webp"
                      alt="Warm editorial oil painting"
                      radiusClass="rounded-[12px]"
                      className="w-full min-h-[250px] sm:min-h-[290px] p-5 flex items-center justify-center"
                    >
                      <div
                        style={{
                          backgroundColor: 'var(--solva-card-elevated)',
                          borderColor: 'var(--solva-border)',
                        }}
                        className="solva-glass-ring w-full rounded-[12px] border p-4 space-y-2.5 font-mono text-[12px]"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span style={{ color: 'var(--solva-ink)' }} className="font-semibold">
                            PCI-DSS · HMAC-SHA512
                          </span>
                          <span className="verdict-badge verdict-badge-verified px-2 py-0.5 text-[10px]">
                            {isVi ? 'CÁCH LY BẢO MẬT' : 'ISOLATED'}
                          </span>
                        </div>
                        <div
                          style={{ color: 'var(--solva-muted)' }}
                          className="pt-2 border-t border-[#E7E3D9] dark:border-[#332F26] space-y-1.5"
                        >
                          <div className="flex justify-between gap-2">
                            <span>{isVi ? 'Số thẻ đầy đủ / CVV' : 'Full card numbers / CVV'}</span>
                            <span className="text-emerald-600 dark:text-emerald-400">
                              {isVi ? 'KHÔNG LƯU TRỮ' : 'NEVER STORED'}
                            </span>
                          </div>
                          <div className="flex justify-between gap-2">
                            <span>{isVi ? '4 số cuối (card_last4)' : 'Last 4 digits (card_last4)'}</span>
                            <span style={{ color: 'var(--solva-ink)' }}>
                              {demoEvaluatorMode
                                ? '•••• 4242'
                                : isVi
                                  ? 'Chỉ lưu 4 số cuối'
                                  : 'Last 4 digits only'}
                            </span>
                          </div>
                          <div className="flex justify-between gap-2">
                            <span>{isVi ? 'Cổng thanh toán' : 'Gateways'}</span>
                            <span style={{ color: 'var(--solva-ink)' }}>Stripe · VNPay</span>
                          </div>
                        </div>
                      </div>
                    </SolvaPainterlyFrame>
                  </div>
                </div>
              </SolvaStickyStackCard>

              {/* Sticky Card 1: Cookies & Browser Storage (`#cookies`) */}
              <SolvaStickyStackCard index={1} total={3} baseTopDesktop={132} baseTopMobile={118}>
                <div
                  id="cookies"
                  className="scroll-mt-[172px] grid grid-cols-1 lg:grid-cols-12 items-center gap-6"
                >
                  <div className="lg:col-span-7 p-4 sm:p-7 space-y-4">
                    <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-[6px] bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/20 font-mono text-[11px] font-semibold">
                      <EyeOff className="w-3.5 h-3.5" />
                      <span>
                        {isVi
                          ? '3.2 · KHÔNG COOKIE QUẢNG CÁO · LƯU TRỮ TỐI GIẢN'
                          : '3.2 · ZERO AD PIXELS · MINIMAL BROWSER STORAGE'}
                      </span>
                    </div>
                    <h3
                      style={{ color: 'var(--solva-ink)' }}
                      className="font-solva-serif font-light text-[28px] sm:text-[34px] leading-[1.1] tracking-[-0.04em]"
                    >
                      {isVi
                        ? 'Cookie và Bộ nhớ Trình duyệt'
                        : 'Cookies & Browser Storage'}
                    </h3>
                    <p
                      style={{ color: 'var(--solva-muted)' }}
                      className="font-solva-sans text-[15px] leading-[23.5px]"
                    >
                      {isVi
                        ? 'Nền tảng CITRA tuyệt đối KHÔNG cài đặt cookie quảng cáo, tiếp thị lại (remarketing) hay công cụ theo dõi hành vi bên thứ ba (không sử dụng Google Analytics, Meta Pixel hay TikTok Pixel). Trình duyệt chỉ lưu các tùy chọn kỹ thuật thiết yếu gồm phiên đăng nhập bảo mật, chế độ giao diện sáng/tối, ngôn ngữ hiển thị và trạng thái tạm thời của phiên thanh toán. Khi đăng xuất hoặc xóa tài khoản, phiên đăng nhập bị xóa ngay khỏi trình duyệt.'
                        : 'CITRA deploys ZERO advertising cookies, remarketing tags, or behavioral analytics (no Google Analytics, Meta Pixel, or TikTok Pixel). Browser storage holds only strictly necessary technical settings: your authenticated session, light/dark theme, display language, and temporary checkout state. Signing out or deleting your account clears your session immediately.'}
                    </p>
                  </div>

                  <div className="lg:col-span-5">
                    <SolvaPainterlyFrame
                      paintingSrc="/solva/feature-2-bg.webp"
                      alt="Warm editorial oil painting"
                      radiusClass="rounded-[12px]"
                      className="w-full min-h-[250px] sm:min-h-[290px] p-5 flex items-center justify-center"
                    >
                      <div
                        style={{
                          backgroundColor: 'var(--solva-card-elevated)',
                          borderColor: 'var(--solva-border)',
                        }}
                        className="solva-glass-ring w-full rounded-[12px] border p-4 space-y-2.5 font-mono text-[12px]"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span style={{ color: 'var(--solva-ink)' }} className="font-semibold">
                            {isVi ? 'KIỂM ĐỊNH TRÌNH DUYỆT' : 'BROWSER STORAGE AUDIT'}
                          </span>
                          <span className="verdict-badge verdict-badge-verified px-2 py-0.5 text-[10px]">
                            {isVi ? '0 THEO DÕI' : '0 TRACKERS'}
                          </span>
                        </div>
                        <div
                          style={{ color: 'var(--solva-muted)' }}
                          className="pt-2 border-t border-[#E7E3D9] dark:border-[#332F26] space-y-1.5"
                        >
                          <div className="flex justify-between gap-2">
                            <span>Google Analytics / Meta</span>
                            <span className="text-emerald-600 dark:text-emerald-400">
                              {isVi ? 'KHÔNG DÙNG' : 'NONE'}
                            </span>
                          </div>
                          <div className="flex justify-between gap-2">
                            <span>{isVi ? 'Khóa thiết yếu' : 'Essential state'}</span>
                            <span style={{ color: 'var(--solva-ink)' }}>
                              {isVi ? 'Phiên · Giao diện · Ngôn ngữ' : 'Session · Theme · Language'}
                            </span>
                          </div>
                        </div>
                      </div>
                    </SolvaPainterlyFrame>
                  </div>
                </div>
              </SolvaStickyStackCard>

              {/* Sticky Card 2: Retention & Complete File Deletion (`#retention`) */}
              <SolvaStickyStackCard index={2} total={3} baseTopDesktop={132} baseTopMobile={118}>
                <div
                  id="retention"
                  className="scroll-mt-[200px] grid grid-cols-1 lg:grid-cols-12 items-center gap-6"
                >
                  <div className="lg:col-span-7 p-4 sm:p-7 space-y-4">
                    <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-[6px] bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/20 font-mono text-[11px] font-semibold">
                      <Clock className="w-3.5 h-3.5" />
                      <span>
                        {isVi
                          ? '3.3 · LƯU TRỮ & CƠ CHẾ XÓA TRIỆT ĐỂ KHÔNG TỆP TỒN DƯ'
                          : '3.3 · RETENTION & COMPLETE FILE DELETION'}
                      </span>
                    </div>
                    <h3
                      style={{ color: 'var(--solva-ink)' }}
                      className="font-solva-serif font-light text-[28px] sm:text-[34px] leading-[1.1] tracking-[-0.04em]"
                    >
                      {isVi
                        ? 'Thời hạn Lưu trữ & Cơ chế Xóa Dữ liệu'
                        : 'Data Retention & Deletion Mechanism'}
                    </h3>
                    <ul className="space-y-2.5 font-solva-sans text-[14px] sm:text-[15px] leading-[22.5px]">
                      <li className="flex items-start gap-2.5">
                        <HardDrive className="w-4 h-4 text-emerald-600 dark:text-emerald-400 mt-1 shrink-0" />
                        <span style={{ color: 'var(--solva-ink)' }}>
                          {isVi
                            ? 'Hồ sơ tài khoản, tệp bản thảo đã tải lên và báo cáo kiểm chứng trích dẫn được lưu giữ an toàn trong thời gian tài khoản còn hoạt động để bạn tra cứu lịch sử, đối chiếu phiên bản chỉnh sửa và xuất báo cáo học thuật.'
                            : 'Account profiles, uploaded manuscripts, and citation verification reports are securely retained while your account remains active for revision comparison and academic exports.'}
                        </span>
                      </li>
                      <li className="flex items-start gap-2.5">
                        <Trash2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 mt-1 shrink-0" />
                        <span style={{ color: 'var(--solva-ink)' }}>
                          {isVi
                            ? 'Bạn có thể xóa từng bài nộp tại Lịch sử (/history) hoặc tự thực hiện "Xóa tài khoản & toàn bộ dữ liệu" tại Cài đặt (/settings) — hệ thống lập tức thu hồi phiên đăng nhập, xóa ảnh đại diện, bản ghi trích dẫn và gỡ bỏ vĩnh viễn tệp bản thảo gốc (.pdf, .docx, .bib, .ris).'
                            : 'Delete individual submissions anytime in History (/history), or execute "Delete Account & All Data" in Settings (/settings) to revoke active sessions, remove profile photos and citation records, and permanently erase all physical manuscript files (.pdf, .docx, .bib, .ris).'}
                        </span>
                      </li>
                      <li className="flex items-start gap-2.5">
                        <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400 mt-1 shrink-0" />
                        <span style={{ color: 'var(--solva-muted)' }}>
                          {isVi
                            ? 'Chứng từ đối soát thanh toán và nhật ký an toàn thông tin thiết yếu được lưu giữ tách biệt trong thời hạn tối thiểu theo quy định pháp luật về kế toán, giao dịch điện tử và an ninh mạng Việt Nam, tuyệt đối không sử dụng cho mục đích tiếp thị.'
                            : 'Payment reconciliation records and essential security audit logs are isolated and retained strictly for the minimum statutory periods mandated by Vietnamese accounting, e-transaction, and cybersecurity laws, and are never used for marketing.'}
                        </span>
                      </li>
                    </ul>
                  </div>

                  <div className="lg:col-span-5">
                    <SolvaPainterlyFrame
                      paintingSrc="/solva/feature-3-bg.webp"
                      alt="Warm editorial oil painting"
                      radiusClass="rounded-[12px]"
                      className="w-full min-h-[250px] sm:min-h-[290px] p-5 flex items-center justify-center"
                    >
                      <div
                        style={{
                          backgroundColor: 'var(--solva-card-elevated)',
                          borderColor: 'var(--solva-border)',
                        }}
                        className="solva-glass-ring w-full rounded-[12px] border p-4 space-y-2.5 font-mono text-[12px]"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span style={{ color: 'var(--solva-ink)' }} className="font-semibold">
                            {isVi ? 'XÓA TỨC THÌ (/settings)' : 'SELF-SERVICE PURGE (/settings)'}
                          </span>
                          <span className="verdict-badge verdict-badge-verified px-2 py-0.5 text-[10px]">
                            {isVi ? 'XÓA TRIỆT ĐỂ' : 'COMPLETE PURGE'}
                          </span>
                        </div>
                        <div
                          style={{ color: 'var(--solva-muted)' }}
                          className="pt-2 border-t border-[#E7E3D9] dark:border-[#332F26] space-y-1.5"
                        >
                          <div className="flex justify-between gap-2">
                            <span>{isVi ? 'Báo cáo & phán quyết' : 'Reports & verdicts'}</span>
                            <span className="text-emerald-600 dark:text-emerald-400">
                              {isVi ? 'ĐÃ XÓA SẠCH' : 'DELETED'}
                            </span>
                          </div>
                          <div className="flex justify-between gap-2">
                            <span>{isVi ? 'Tệp bản thảo (.pdf/.docx)' : 'Manuscripts (.pdf/.docx)'}</span>
                            <span className="text-emerald-600 dark:text-emerald-400">
                              {isVi ? 'ĐÃ GỠ BỎ' : 'REMOVED'}
                            </span>
                          </div>
                          <div className="flex justify-between gap-2">
                            <span>{isVi ? 'Ảnh đại diện & phiên' : 'Profile photo & sessions'}</span>
                            <span className="text-emerald-600 dark:text-emerald-400">
                              {isVi ? 'ĐÃ THU HỒI' : 'REVOKED'}
                            </span>
                          </div>
                        </div>
                      </div>
                    </SolvaPainterlyFrame>
                  </div>
                </div>
              </SolvaStickyStackCard>
            </div>
          </div>
        </section>

        {/* ============================================================
            SECTION 4: THIRD PARTIES & CROSS-BORDER TRANSFERS (`#third-parties`)
            ============================================================ */}
        <section
          id="third-parties"
          className="scroll-mt-[132px] py-[36px] sm:py-[56px] lg:py-[80px] px-5 sm:px-6 lg:px-[40px]"
        >
          <div className="max-w-[1200px] mx-auto flex flex-col gap-[28px] sm:gap-[36px]">
            <div className="flex flex-col items-start gap-[12px] max-w-[700px]">
              <PrivacyEyebrow>
                {isVi
                  ? 'Mục 04 · Điều 20, Điều 23 Luật 91/2025/QH15 & Điều 18 NĐ 356/2025/NĐ-CP'
                  : 'Section 04 · Articles 20 & 23 Law 91/2025/QH15 & Article 18 Decree 356'}
              </PrivacyEyebrow>
              <PrivacyTwoToneHeading
                primary={
                  isVi
                    ? 'Bên thứ ba nhận dữ liệu'
                    : 'Third-party recipients'
                }
                secondary={
                  isVi
                    ? '& truyền tải truy vấn học thuật xuyên biên giới.'
                    : '& cross-border scholarly lookups.'
                }
              />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-[16px] items-stretch">
              {/* Left Column: Auth, Email & Payment Providers */}
              <SolvaScrollReveal delayMs={0} yOffset={20} blurPx={0} className="lg:col-span-5 h-full">
                <div
                  style={{
                    backgroundColor: 'var(--solva-surface)',
                    borderColor: 'var(--solva-border)',
                  }}
                  className="rounded-[16px] border p-6 sm:p-8 h-full flex flex-col justify-between gap-6"
                >
                  <div className="space-y-4">
                    <span
                      style={{
                        backgroundColor: 'var(--solva-bg)',
                        borderColor: 'var(--solva-border)',
                        color: 'var(--solva-ink)',
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-1 rounded-[6px] border font-mono text-[11px] font-semibold"
                    >
                      <Lock className="w-3.5 h-3.5" />
                      <span>
                        {isVi ? 'A · XÁC THỰC, EMAIL & THANH TOÁN' : 'A · AUTH, EMAIL & BILLING'}
                      </span>
                    </span>

                    <h3
                      style={{ color: 'var(--solva-ink)' }}
                      className="font-solva-serif font-light text-[26px] sm:text-[30px] leading-[1.12] tracking-[-0.04em]"
                    >
                      {isVi
                        ? 'Đối tác hạ tầng định danh & cổng thanh toán'
                        : 'Identity, Account Email & Payment Infrastructure'}
                    </h3>

                    <div className="space-y-3 pt-1">
                      <div
                        style={{
                          backgroundColor: 'var(--solva-bg)',
                          borderColor: 'var(--solva-border)',
                        }}
                        className="rounded-[12px] border p-4 space-y-1"
                      >
                        <div
                          style={{ color: 'var(--solva-ink)' }}
                          className="font-solva-sans text-[15px] font-medium"
                        >
                          {isVi
                            ? 'Google LLC (Google OAuth 2.0 & Email hệ thống — Hoa Kỳ / Quốc tế)'
                            : 'Google LLC (Google OAuth 2.0 & Transactional Email — US / Global)'}
                        </div>
                        <p
                          style={{ color: 'var(--solva-muted)' }}
                          className="font-solva-sans text-[14px] leading-[21px]"
                        >
                          {isVi
                            ? 'Xác thực đăng nhập bằng Google (oauth2.googleapis.com) và gửi email kích hoạt tài khoản, đặt lại mật khẩu qua kết nối mã hóa TLS.'
                            : 'Federated Google Sign-In verification (oauth2.googleapis.com) and encrypted transactional emails for account activation and password resets over TLS.'}
                        </p>
                      </div>

                      <div
                        style={{
                          backgroundColor: 'var(--solva-bg)',
                          borderColor: 'var(--solva-border)',
                        }}
                        className="rounded-[12px] border p-4 space-y-1"
                      >
                        <div
                          style={{ color: 'var(--solva-ink)' }}
                          className="font-solva-sans text-[15px] font-medium"
                        >
                          Stripe, Inc. (US / Global) &amp; VNPay (Việt Nam)
                        </div>
                        <p
                          style={{ color: 'var(--solva-muted)' }}
                          className="font-solva-sans text-[14px] leading-[21px]"
                        >
                          {isVi
                            ? 'Xử lý giao dịch nâng cấp gói dịch vụ Pro / Ultra theo chuẩn mã hóa PCI-DSS và chữ ký số HMAC-SHA512.'
                            : 'Subscription checkout processing for Pro / Ultra plans under PCI-DSS encryption and HMAC-SHA512 signatures.'}
                        </p>
                      </div>
                    </div>
                  </div>

                  <p
                    style={{ color: 'var(--solva-muted)' }}
                    className="font-mono text-[11px] leading-relaxed pt-3 border-t border-[#E7E3D9] dark:border-[#332F26]"
                  >
                    {isVi
                      ? 'Mọi kết nối truyền dữ liệu ra nước ngoài đều được mã hóa HTTPS/TLS 1.2+.'
                      : 'All outbound cross-border connections are encrypted over HTTPS/TLS 1.2+.'}
                  </p>
                </div>
              </SolvaScrollReveal>

              {/* Right Column: Radial Watercolor Floral Card — 15+ Scholarly APIs */}
              <SolvaScrollReveal delayMs={65} yOffset={20} blurPx={0} className="lg:col-span-7 h-full">
                <div
                  style={{
                    backgroundColor: 'var(--solva-surface)',
                    borderColor: 'var(--solva-ink)',
                  }}
                  className="relative rounded-[16px] border-2 p-6 sm:p-8 h-full flex flex-col justify-between gap-5 overflow-hidden shadow-[0_12px_36px_rgba(28,26,21,0.08)]"
                >
                  <div
                    className="solva-pricing-floral-mask absolute inset-0 pointer-events-none select-none z-0"
                    aria-hidden="true"
                  >
                    <img
                      src="/solva/pricing-floral.webp"
                      alt=""
                      loading="lazy"
                      decoding="async"
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <div className="solva-noise-overlay z-0" aria-hidden="true" />

                  <div className="relative z-10 space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span
                        style={{
                          backgroundColor: 'var(--solva-btn-bg)',
                          color: 'var(--solva-btn-fg)',
                        }}
                        className="inline-flex items-center gap-1.5 px-3 py-1 rounded-[6px] font-mono text-[11px] font-semibold"
                      >
                        <Sparkles className="w-3 h-3" />
                        <span>
                          {isVi
                            ? `B · LIÊN HỢP ${SCHOLARLY_APIS_LABEL} CSDL & API HỌC THUẬT QUỐC TẾ`
                            : `B · ${SCHOLARLY_APIS_LABEL} FEDERATED SCHOLARLY REGISTRIES & APIs`}
                        </span>
                      </span>
                    </div>

                    <p
                      style={{ color: 'var(--solva-ink)' }}
                      className="font-solva-sans text-[15px] leading-[23px]"
                    >
                      {isVi
                        ? 'Khi phân tích bản thảo, CITRA tuyệt đối KHÔNG gửi toàn văn hay các chương luận văn chưa công bố ra bên ngoài, KHÔNG đưa bài viết vào bất kỳ kho đối sánh tương đồng dùng chung hay liên trường nào (không ảnh hưởng kết quả kiểm tra Turnitin của trường) và KHÔNG gửi mật khẩu hay dữ liệu thanh toán; hệ thống chỉ truy vấn các trường thư mục ngắn (tiêu đề tài liệu được trích dẫn, tên tác giả được trích dẫn, năm xuất bản, mã DOI/arXiv/PMID/ISBN hoặc URL nguồn) tới:'
                        : 'When verifying a manuscript, CITRA NEVER transmits unpublished manuscript full text or chapters to external APIs, NEVER indexes submissions into any shared cross-user or inter-university similarity pool (zero impact on subsequent Turnitin or institutional checks), and NEVER shares passwords or billing records — querying only short cited bibliographic fields (cited titles, cited author names, publication years, DOI/arXiv/PMID/ISBN, or cited URLs) across:'}
                    </p>

                    <div className="flex flex-wrap gap-2 pt-1">
                      {SCHOLARLY_APIS.map((apiName) => (
                        <span
                          key={apiName}
                          style={{
                            backgroundColor: 'var(--solva-bg)',
                            borderColor: 'var(--solva-border)',
                            color: 'var(--solva-ink)',
                          }}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-[8px] border font-mono text-[11px] font-medium shadow-2xs"
                        >
                          <ScholarlySourceLogo name={apiName} size={13} />
                          <span>{apiName}</span>
                        </span>
                      ))}
                    </div>
                  </div>

                  <div
                    style={{
                      backgroundColor: 'var(--solva-bg)',
                      borderColor: 'var(--solva-border)',
                    }}
                    className="relative z-10 rounded-[12px] border p-4 space-y-1.5 font-solva-sans text-[13px] leading-[20px]"
                  >
                    <p style={{ color: 'var(--solva-ink)' }} className="font-medium">
                      {isVi
                        ? 'Trách nhiệm của Giảng viên / Người tải hộ (/upload & /batch tối đa 50 tệp):'
                        : 'Instructor / Uploader Responsibility (/upload & /batch up to 50 files):'}
                    </p>
                    <p style={{ color: 'var(--solva-muted)' }}>
                      {isVi
                        ? 'Khi tải lên khóa luận, tiểu luận của sinh viên hoặc đồng tác giả, người tải lên chịu trách nhiệm thông báo và bảo đảm đã có sự đồng ý hợp pháp hoặc căn cứ quy chế học thuật của cơ sở đào tạo. Hoạt động truyền tải truy vấn thư mục tối giản ra nước ngoài tuân thủ nguyên tắc tối thiểu hóa dữ liệu và quản trị chuyển dữ liệu xuyên biên giới theo Điều 20 Luật số 91/2025/QH15.'
                        : 'When uploading student theses or co-authored manuscripts, the uploader must inform authors and ensure lawful consent or institutional academic authorization. Outbound bibliographic lookups strictly adhere to data minimization and cross-border transfer governance under Article 20 of Law No. 91/2025/QH15.'}
                    </p>
                  </div>
                </div>
              </SolvaScrollReveal>
            </div>
          </div>
        </section>

        {/* ============================================================
            SECTION 5: DATA SUBJECT RIGHTS & STATUTORY SLAs (`#rights`, `#sla`)
            Zero mid-scroll blur — razor-sharp typography on reveal
            ============================================================ */}
        <section
          id="rights"
          className="scroll-mt-[132px] py-[36px] sm:py-[56px] lg:py-[88px] px-5 sm:px-6 lg:px-[40px]"
        >
          <div className="max-w-[1200px] mx-auto flex flex-col gap-[32px] sm:gap-[44px]">
            <div className="flex flex-col items-start gap-[12px] max-w-[720px]">
              <PrivacyEyebrow>
                {isVi
                  ? 'Mục 05 · Điều 4, 10, 14 Luật 91/2025/QH15 & Điều 5 NĐ 356/2025/NĐ-CP'
                  : 'Section 05 · Articles 4, 10, 14 Law 91/2025/QH15 & Article 5 Decree 356'}
              </PrivacyEyebrow>
              <PrivacyTwoToneHeading
                primary={
                  isVi
                    ? 'Quyền của Chủ thể dữ liệu'
                    : 'Your statutory data rights'
                }
                secondary={
                  isVi
                    ? '& thời hạn phản hồi bắt buộc theo luật định.'
                    : '& binding response timelines.'
                }
              />
              <SolvaScrollReveal delayMs={40} yOffset={14} blurPx={0}>
                <p
                  style={{ color: 'var(--solva-muted)' }}
                  className="font-solva-sans text-[15px] sm:text-[16px] leading-[23.8px] pt-1"
                >
                  {isVi
                    ? 'Bạn có đầy đủ quyền được biết, quyền đồng ý hoặc không đồng ý, quyền xem và chỉnh sửa trực tiếp tại Hồ sơ (/profile), quyền rút lại sự đồng ý, quyền yêu cầu cung cấp, hạn chế hoặc phản đối xử lý dữ liệu, quyền tự xóa ngay lập tức tại Cài đặt (/settings) và quyền khiếu nại, tố cáo, khởi kiện theo quy định pháp luật.'
                    : 'You hold the rights to be informed, consent or decline, access and rectify directly in Profile (/profile), withdraw consent, request data provision, restrict or object to processing, self-delete immediately in Settings (/settings), and lodge legal claims.'}
                </p>
              </SolvaScrollReveal>
            </div>

            {/* 4 Blur-Free Animated Statutory Metric Counters */}
            <div
              style={{
                backgroundColor: 'var(--solva-surface)',
                borderColor: 'var(--solva-border)',
              }}
              className="rounded-[16px] border p-6 sm:p-8 grid grid-cols-2 lg:grid-cols-4 gap-6"
            >
              <PrivacyAnimatedMetric
                targetValue={2}
                suffix={isVi ? ' ngày' : ' days'}
                label={
                  isVi
                    ? 'Thông báo tiếp nhận yêu cầu (02 ngày làm việc)'
                    : 'Request acknowledgment (within 2 business days)'
                }
              />
              <PrivacyAnimatedMetric
                targetValue={10}
                suffix={isVi ? '–15 ngày' : '–15d'}
                label={
                  isVi
                    ? 'Xem, chỉnh sửa hoặc cung cấp dữ liệu cá nhân'
                    : 'Access, rectification, or data provision'
                }
              />
              <PrivacyAnimatedMetric
                targetValue={15}
                suffix={isVi ? '–20 ngày' : '–20d'}
                label={
                  isVi
                    ? 'Rút lại sự đồng ý, hạn chế hoặc phản đối xử lý'
                    : 'Consent withdrawal, restriction, or objection'
                }
              />
              <PrivacyAnimatedMetric
                targetValue={20}
                suffix={isVi ? '–30 ngày' : '–30d'}
                label={
                  isVi
                    ? 'Xóa dữ liệu theo yêu cầu (Tự xóa /settings: Tức thì)'
                    : 'Statutory deletion (/settings self-purge: Instant)'
                }
              />
            </div>

            {/* Explicit Statutory SLA Breakdown Card (`#sla`) */}
            <SolvaScrollReveal delayMs={45} yOffset={18} blurPx={0}>
              <div
                id="sla"
                style={{
                  backgroundColor: 'var(--solva-surface)',
                  borderColor: 'var(--solva-border)',
                }}
                className="scroll-mt-[136px] rounded-[16px] border p-6 sm:p-8 space-y-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3
                    style={{ color: 'var(--solva-ink)' }}
                    className="font-solva-sans text-[18px] sm:text-[20px] font-medium"
                  >
                    {isVi
                      ? 'Chi tiết thời hạn tiếp nhận & xử lý yêu cầu (Điều 5 Nghị định 356/2025/NĐ-CP)'
                      : 'Detailed Statutory Request Handling SLAs (Article 5 of Decree 356/2025/ND-CP)'}
                  </h3>
                  <span className="verdict-badge verdict-badge-verified px-2.5 py-0.5 text-[11px] font-mono">
                    {isVi ? 'TỐI ĐA 01 LẦN GIA HẠN' : 'MAX 01 EXTENSION'}
                  </span>
                </div>

                <ul
                  style={{ color: 'var(--solva-muted)' }}
                  className="grid grid-cols-1 md:grid-cols-2 gap-3 font-solva-sans text-[14px] sm:text-[15px] leading-[22.5px]"
                >
                  <li
                    style={{
                      backgroundColor: 'var(--solva-bg)',
                      borderColor: 'var(--solva-border)',
                    }}
                    className="rounded-[12px] border p-4"
                  >
                    <strong style={{ color: 'var(--solva-ink)' }}>
                      {isVi ? 'Thông báo tiếp nhận yêu cầu: ' : 'Request acknowledgment: '}
                    </strong>
                    {isVi
                      ? 'Chậm nhất trong 02 ngày làm việc kể từ khi nhận được yêu cầu hợp lệ qua kênh tiếp nhận (iannwendii@gmail.com).'
                      : 'Within 2 business days from receipt of a valid request via our intake channel (iannwendii@gmail.com).'}
                  </li>
                  <li
                    style={{
                      backgroundColor: 'var(--solva-bg)',
                      borderColor: 'var(--solva-border)',
                    }}
                    className="rounded-[12px] border p-4"
                  >
                    <strong style={{ color: 'var(--solva-ink)' }}>
                      {isVi
                        ? 'Xem, chỉnh sửa hoặc cung cấp dữ liệu: '
                        : 'Access, rectification, or provision: '}
                    </strong>
                    {isVi
                      ? 'Thực hiện trong 10 ngày (hoặc 15 ngày trường hợp cần phối hợp với Bên xử lý dữ liệu / bên thứ ba).'
                      : 'Completed within 10 days (or 15 days when coordinating with a processor / third party).'}
                  </li>
                  <li
                    style={{
                      backgroundColor: 'var(--solva-bg)',
                      borderColor: 'var(--solva-border)',
                    }}
                    className="rounded-[12px] border p-4"
                  >
                    <strong style={{ color: 'var(--solva-ink)' }}>
                      {isVi
                        ? 'Rút lại sự đồng ý, hạn chế / phản đối xử lý: '
                        : 'Consent withdrawal, restriction / objection: '}
                    </strong>
                    {isVi
                      ? 'Thực hiện trong 15 ngày (hoặc 20 ngày khi liên quan Bên xử lý dữ liệu / bên thứ ba).'
                      : 'Completed within 15 days (or 20 days where a processor / third party is involved).'}
                  </li>
                  <li
                    style={{
                      backgroundColor: 'var(--solva-bg)',
                      borderColor: 'var(--solva-border)',
                    }}
                    className="rounded-[12px] border p-4"
                  >
                    <strong style={{ color: 'var(--solva-ink)' }}>
                      {isVi
                        ? 'Xóa dữ liệu & quy định gia hạn: '
                        : 'Data deletion & extension rule: '}
                    </strong>
                    {isVi
                      ? 'Thực hiện trong 20 ngày (hoặc 30 ngày khi liên quan bên thứ ba); trường hợp phức tạp thông báo trước tối đa 01 lần gia hạn theo khoản 6 Điều 5 Nghị định 356/2025/NĐ-CP.'
                      : 'Completed within 20 days (or 30 days with third parties); complex cases allow at most one (01) prior-notified extension under Article 5.6 of Decree 356/2025/ND-CP.'}
                  </li>
                </ul>
              </div>
            </SolvaScrollReveal>

            {/* 2-Column Solva Interactive FAQ Accordion */}
            <PrivacyRightsAccordion lang={lang} />
          </div>
        </section>

        {/* ============================================================
            SECTION 6: BOTTOM EDITORIAL SPLIT CTA (`#contact`)
            ============================================================ */}
        <section
          id="contact"
          className="scroll-mt-[132px] pt-[24px] pb-[44px] sm:py-[56px] lg:py-[88px] px-5 sm:px-6 lg:px-[40px]"
        >
          <div className="max-w-[1200px] mx-auto">
            <SolvaScrollReveal yOffset={22} blurPx={0}>
              <div
                style={{
                  backgroundColor: 'var(--solva-surface)',
                  borderColor: 'var(--solva-border)',
                }}
                className="w-full rounded-[16px] border p-[12px] grid grid-cols-1 lg:grid-cols-12 items-center gap-6"
              >
                <div className="lg:col-span-6 p-5 sm:p-[32px] flex flex-col items-start gap-[24px]">
                  <div className="space-y-[16px]">
                    <PrivacyTwoToneHeading
                      primary={
                        isVi
                          ? 'Toàn quyền kiểm soát'
                          : 'Take full control of'
                      }
                      secondary={
                        isVi
                          ? 'hồ sơ và bản thảo học thuật của bạn.'
                          : 'your scholarly profile and manuscripts.'
                      }
                    />
                    <p
                      style={{ color: 'var(--solva-muted)' }}
                      className="font-solva-sans text-[16px] font-normal leading-[23.2px] max-w-[440px]"
                    >
                      {isVi
                        ? 'Kiểm tra trạng thái đồng ý chính sách, chỉnh sửa hồ sơ học thuật hoặc tự thực hiện xóa tài khoản và toàn bộ tệp bản thảo ngay trong trang Cài đặt.'
                        : 'Inspect your consent timestamp, update your academic profile, or execute instant self-service account and file deletion directly in Settings.'}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-3">
                    <SolvaButton
                      to={isAuthenticated ? '/settings' : '/login'}
                      variant="primary"
                    >
                      {isAuthenticated
                        ? isVi
                          ? 'Mở Cài đặt Quyền dữ liệu (/settings)'
                          : 'Open Data Rights Settings (/settings)'
                        : isVi
                          ? 'Đăng nhập để quản lý dữ liệu'
                          : 'Sign in to manage data'}
                    </SolvaButton>
                    <SolvaButton to="/pricing" variant="outline">
                      {isVi ? 'Xem Bảng giá & Gói dịch vụ' : 'Compare Plans & Quotas'}
                    </SolvaButton>
                  </div>
                </div>

                <div className="lg:col-span-6">
                  <SolvaPainterlyFrame
                    paintingSrc="/solva/sticky-2-bg.webp"
                    alt="Impressionist landscape oil painting backdrop"
                    radiusClass="rounded-[12px]"
                    className="w-full min-h-[280px] sm:h-[340px] p-6 sm:p-8 flex items-center justify-center"
                  >
                    <div
                      style={{
                        backgroundColor: 'var(--solva-card-elevated)',
                        borderColor: 'var(--solva-border)',
                      }}
                      className="solva-glass-ring w-full max-w-[440px] rounded-[14px] border p-5 space-y-3"
                    >
                      <div className="flex items-center justify-between">
                        <span
                          style={{ color: 'var(--solva-ink)' }}
                          className="font-mono text-[11px] font-semibold uppercase tracking-wider"
                        >
                          {isVi ? 'TRUNG TÂM QUYỀN CHỦ THỂ DỮ LIỆU' : 'DATA SUBJECT CONTROL'}
                        </span>
                        <span className="verdict-badge verdict-badge-verified px-2.5 py-0.5 text-[10px] font-mono">
                          v{PRIVACY_POLICY_VERSION}
                        </span>
                      </div>
                      <p
                        style={{ color: 'var(--solva-ink)' }}
                        className="font-solva-serif font-light text-[22px] leading-snug tracking-[-0.03em]"
                      >
                        {isVi
                          ? 'Dễ dàng rút lại sự đồng ý tương đương lúc đăng ký.'
                          : 'Withdraw consent as effortlessly as granting it.'}
                      </p>
                      <div className="grid grid-cols-2 gap-2 pt-1 font-mono text-[11px]">
                        <div
                          style={{
                            backgroundColor: 'var(--solva-surface)',
                            borderColor: 'var(--solva-border)',
                            color: 'var(--solva-ink)',
                          }}
                          className="rounded-[8px] border px-3 py-2"
                        >
                          /profile · {isVi ? 'Xem & Sửa' : 'Rectify'}
                        </div>
                        <div
                          style={{
                            backgroundColor: 'var(--solva-surface)',
                            borderColor: 'var(--solva-border)',
                            color: 'var(--solva-ink)',
                          }}
                          className="rounded-[8px] border px-3 py-2"
                        >
                          /settings · {isVi ? 'Xóa sạch' : 'Purge All'}
                        </div>
                      </div>
                    </div>
                  </SolvaPainterlyFrame>
                </div>
              </div>
            </SolvaScrollReveal>
          </div>
        </section>
      </main>

      <PrivacySolvaFooter lang={lang} />
    </div>
  );
}

export default PrivacyPolicyPage;
