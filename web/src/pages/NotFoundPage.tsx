import { useContext } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Compass,
  Home,
  ArrowLeft,
  FileSearch,
  Sparkles,
  LogIn,
  LayoutDashboard,
  ShieldCheck,
  Scale,
  Users,
  Globe,
  ArrowUpRight,
} from 'lucide-react';
import { AuthContext } from '@/contexts/AuthContext';
import { ThemeToggle } from '@/contexts/ThemeContext';
import { type Lang, SolvaButton } from '@/components/landing/SolvaPrimitives';

/* ============================================================
   CITRA — Helpful Editorial 404 Page (`*` Catch-All Route)
   Warm Academic Editorial System, Bilingual EN/VI, Light & Dark
   ============================================================ */

function CitraBrandLogo({ size = 20 }: { size?: number }) {
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

export function NotFoundPage(): JSX.Element {
  const { i18n } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const auth = useContext(AuthContext);
  const isAuthenticated = Boolean(auth?.user);
  const lang: Lang = i18n.language?.startsWith('vi') ? 'vi' : 'en';
  const isVi = lang === 'vi';

  const toggleLanguage = () => {
    void i18n.changeLanguage(isVi ? 'en' : 'vi');
  };

  const headingTypography = isVi
    ? 'leading-[1.15] tracking-[-0.03em]'
    : 'leading-[1.06] tracking-[-0.045em]';

  const quickDestinations: Array<{
    title: string;
    desc: string;
    to: string;
    icon: typeof Compass;
  }> = isVi
    ? [
        {
          title: 'Trình thẩm định trích dẫn nhanh',
          desc: 'Thử đối chiếu mẫu trích dẫn và danh mục tài liệu ngay trên trang chủ.',
          to: '/#interactive-demo',
          icon: FileSearch,
        },
        {
          title: 'Bảng giá & Gói dịch vụ',
          desc: 'So sánh gói Basic miễn phí, Pro và Ultra cho cá nhân & bộ môn.',
          to: '/pricing',
          icon: Sparkles,
        },
        isAuthenticated
          ? {
              title: 'Vào Bảng điều khiển',
              desc: 'Mở kho báo cáo trích dẫn, lớp học và lịch sử kiểm tra đã lưu của bạn.',
              to: '/dashboard',
              icon: LayoutDashboard,
            }
          : {
              title: 'Đăng nhập tài khoản',
              desc: 'Truy cập kho báo cáo trích dẫn, lớp học và lịch sử kiểm tra của bạn.',
              to: '/login',
              icon: LogIn,
            },
        {
          title: 'Không gian học thuật 3 vai trò',
          desc: 'Khám phá quy trình dành cho Sinh viên, Giảng viên và Quản trị Khoa.',
          to: '/#workspaces',
          icon: Users,
        },
        {
          title: 'Chính sách bảo vệ dữ liệu',
          desc: 'Cam kết bảo mật bản thảo và quyền chủ thể dữ liệu theo Luật 91/2025/QH15.',
          to: '/privacy',
          icon: ShieldCheck,
        },
        {
          title: 'Điều khoản dịch vụ học thuật',
          desc: 'Nguyên tắc hỗ trợ quyết định, quyền sở hữu tác giả và thanh toán minh bạch.',
          to: '/terms',
          icon: Scale,
        },
      ]
    : [
        {
          title: 'Instant Citation Checker',
          desc: 'Inspect live bibliography verification and side-by-side source evidence.',
          to: '/#interactive-demo',
          icon: FileSearch,
        },
        {
          title: 'Pricing & Academic Plans',
          desc: 'Compare Basic ($0 free forever), Pro, and Ultra quotas and features.',
          to: '/pricing',
          icon: Sparkles,
        },
        isAuthenticated
          ? {
              title: 'Open Dashboard',
              desc: 'Return to your saved verification reports, classes, and citation history.',
              to: '/dashboard',
              icon: LayoutDashboard,
            }
          : {
              title: 'Sign In to Workspace',
              desc: 'Access your saved verification reports, classes, and citation history.',
              to: '/login',
              icon: LogIn,
            },
        {
          title: 'Academic Role Workspaces',
          desc: 'Explore workflows tailored for Students, Lecturers, and Department Admins.',
          to: '/#workspaces',
          icon: Users,
        },
        {
          title: 'Personal Data Policy',
          desc: 'Manuscript confidentiality and statutory rights under Law 91/2025/QH15.',
          to: '/privacy',
          icon: ShieldCheck,
        },
        {
          title: 'Terms of Service',
          desc: 'Decision-support principles, author ownership, and encrypted billing terms.',
          to: '/terms',
          icon: Scale,
        },
      ];

  return (
    <div
      data-testid="not-found-page"
      lang={lang}
      data-lang={lang}
      className="solva-editorial-root min-h-screen flex flex-col justify-between overflow-x-clip selection:bg-[#1C1A15] selection:text-[#FBFAF6]"
    >
      <a
        href="#not-found-main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[100] focus:px-4 focus:py-2 focus:rounded-[10px] focus:bg-[#1C1A15] focus:text-[#FBFAF6] dark:focus:bg-[#FBFAF6] dark:focus:text-[#1C1A15] focus:shadow-lg font-solva-sans text-sm font-medium"
      >
        {isVi ? 'Chuyển đến nội dung chính' : 'Skip to main content'}
      </a>
      {/* Single-Row Top Editorial Bar */}
      <header
        style={{
          backgroundColor: 'var(--solva-bg)',
          borderColor: 'var(--solva-border)',
        }}
        className="w-full border-b"
      >
        <div className="max-w-[1280px] mx-auto px-5 sm:px-6 lg:px-8 xl:px-[40px] h-[64px] lg:h-[76px] flex items-center justify-between flex-nowrap gap-3">
          <Link
            to="/"
            className="inline-flex items-center gap-[8px] rounded-[6px] whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--solva-accent)]"
          >
            <span className="w-[28px] h-[28px] rounded-[7px] bg-white dark:bg-[#1E1C17] border border-[#E7E3D9] dark:border-[#332F26] shadow-sm flex items-center justify-center p-1 shrink-0 transition-colors">
              <CitraBrandLogo size={18} />
            </span>
            <span
              style={{ color: 'var(--solva-ink)' }}
              className="font-solva-sans text-[20px] font-medium tracking-[-0.02em] leading-none"
            >
              CITRA
            </span>
          </Link>

          <div className="flex items-center flex-nowrap gap-1.5 sm:gap-2 shrink-0">
            <button
              type="button"
              onClick={toggleLanguage}
              aria-label={
                isVi
                  ? 'VI / EN — Switch to English'
                  : 'VI / EN — Chuyển sang Tiếng Việt'
              }
              style={{
                backgroundColor: 'var(--solva-surface)',
                color: 'var(--solva-ink)',
              }}
              className="inline-flex items-center gap-1 h-[36px] px-2.5 rounded-[8px] font-mono text-[12px] font-medium whitespace-nowrap shrink-0 hover:opacity-85 transition-opacity cursor-pointer"
              title={isVi ? 'Switch to English' : 'Chuyển sang Tiếng Việt'}
            >
              <Globe className="w-3.5 h-3.5" />
              <span>{isVi ? 'VI' : 'EN'}</span>
            </button>

            <ThemeToggle size="sm" />

            <SolvaButton to="/" variant="outline" className="hidden sm:inline-flex shrink-0">
              {isVi ? 'Trang chủ' : 'Home'}
            </SolvaButton>
          </div>
        </div>
      </header>

      {/* Main 404 Editorial Recovery View */}
      <main
        id="not-found-main-content"
        className="flex-1 flex items-center px-5 sm:px-6 lg:px-[40px] py-[40px] sm:py-[64px]"
      >
        <div className="max-w-[1040px] w-full mx-auto flex flex-col gap-[36px] sm:gap-[48px]">
          <div className="flex flex-col items-start gap-[20px] max-w-[700px]">
            <div
              style={{
                backgroundColor: 'var(--solva-surface)',
                borderColor: 'var(--solva-border)',
                color: 'var(--solva-ink)',
              }}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border font-mono text-[11px] font-medium tracking-wide"
            >
              <Compass className="w-3.5 h-3.5 shrink-0" />
              <span>
                {isVi ? '404 · KHÔNG TÌM THẤY TRANG' : '404 · PAGE NOT FOUND'}
              </span>
            </div>

            <h1
              className={`font-solva-serif font-light text-[34px] sm:text-[46px] xl:text-[54px] [text-wrap:balance] ${headingTypography}`}
            >
              <span className="block" style={{ color: 'var(--solva-ink)' }}>
                {isVi
                  ? 'Không tìm thấy trang này.'
                  : 'This page could not be found.'}
              </span>{' '}
              <span className="block" style={{ color: 'var(--solva-muted)' }}>
                {isVi
                  ? 'Quay lại không gian học thuật CITRA.'
                  : 'Let’s guide you back to your workspace.'}
              </span>
            </h1>

            <p
              style={{ color: 'var(--solva-muted)' }}
              className="font-solva-sans text-[16px] sm:text-[17px] leading-[25px]"
            >
              {isVi ? (
                <>
                  Đường dẫn{' '}
                  <code
                    style={{
                      backgroundColor: 'var(--solva-surface)',
                      borderColor: 'var(--solva-border)',
                      color: 'var(--solva-ink)',
                    }}
                    className="px-2 py-0.5 rounded-[6px] border font-mono text-[13px] break-all"
                  >
                    {location.pathname}
                  </code>{' '}
                  không tồn tại hoặc đã được chuyển sang địa chỉ mới. Bạn có thể quay về trang chủ hoặc chọn một lối tắt bên dưới.
                </>
              ) : (
                <>
                  The address{' '}
                  <code
                    style={{
                      backgroundColor: 'var(--solva-surface)',
                      borderColor: 'var(--solva-border)',
                      color: 'var(--solva-ink)',
                    }}
                    className="px-2 py-0.5 rounded-[6px] border font-mono text-[13px] break-all"
                  >
                    {location.pathname}
                  </code>{' '}
                  does not match an active page in CITRA. Return home or jump directly to one of the workspaces below.
                </>
              )}
            </p>

            {/* Primary Recovery Actions */}
            <div className="flex flex-wrap items-center gap-3 pt-1">
              <SolvaButton to="/" variant="primary" testId="not-found-home-cta">
                <Home className="w-4 h-4 shrink-0" />
                <span>{isVi ? 'Về trang chủ' : 'Back to Home'}</span>
              </SolvaButton>

              <SolvaButton
                variant="outline"
                testId="not-found-go-back-cta"
                onClick={() => {
                  if (typeof window !== 'undefined' && window.history.length > 1) {
                    navigate(-1);
                  } else {
                    navigate('/');
                  }
                }}
              >
                <ArrowLeft className="w-4 h-4 shrink-0" />
                <span>{isVi ? 'Quay lại trang trước' : 'Go Back'}</span>
              </SolvaButton>

              {isAuthenticated ? (
                <SolvaButton to="/dashboard" variant="outline">
                  {isVi ? 'Vào Bảng điều khiển' : 'Open Dashboard'}
                </SolvaButton>
              ) : (
                <SolvaButton to="/register" variant="outline">
                  {isVi ? 'Đăng ký miễn phí' : 'Create Free Account'}
                </SolvaButton>
              )}
            </div>
          </div>

          {/* Helpful Quick Links Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-[12px] sm:gap-[14px]">
            {quickDestinations.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  style={{
                    backgroundColor: 'var(--solva-surface)',
                    borderColor: 'var(--solva-border)',
                  }}
                  className="group min-h-[44px] rounded-[14px] border p-5 flex flex-col justify-between gap-3 hover:border-[#1C1A15]/40 dark:hover:border-[#FBFAF6]/40 transition-colors"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span
                      style={{
                        backgroundColor: 'var(--solva-bg)',
                        borderColor: 'var(--solva-border)',
                        color: 'var(--solva-ink)',
                      }}
                      className="w-9 h-9 rounded-[9px] border flex items-center justify-center shrink-0"
                    >
                      <Icon className="w-4 h-4" />
                    </span>
                    <ArrowUpRight
                      style={{ color: 'var(--solva-muted)' }}
                      className="w-4 h-4 shrink-0 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform"
                    />
                  </div>
                  <div className="space-y-1">
                    <div
                      style={{ color: 'var(--solva-ink)' }}
                      className="font-solva-sans text-[16px] font-semibold leading-[22px]"
                    >
                      {item.title}
                    </div>
                    <p
                      style={{ color: 'var(--solva-muted)' }}
                      className="font-solva-sans text-[14px] leading-[20.5px]"
                    >
                      {item.desc}
                    </p>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      </main>

      {/* Compact Editorial Footer Strip */}
      <footer
        style={{ borderColor: 'var(--solva-border)' }}
        className="border-t px-5 sm:px-6 lg:px-[40px] py-5"
      >
        <div className="max-w-[1200px] mx-auto flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 font-solva-sans text-[13.5px] text-[var(--solva-muted)]">
          <span>
            {isVi
              ? '© 2026 CITRA — Không gian Kiểm chứng Trích dẫn Học thuật.'
              : '© 2026 CITRA — Academic Citation Integrity Workspace.'}
          </span>
          <div className="flex flex-wrap items-center gap-4">
            <Link to="/pricing" className="hover:underline underline-offset-4">
              {isVi ? 'Bảng giá' : 'Pricing'}
            </Link>
            <Link to="/privacy" className="hover:underline underline-offset-4">
              {isVi ? 'Bảo vệ dữ liệu' : 'Privacy'}
            </Link>
            <Link to="/terms" className="hover:underline underline-offset-4">
              {isVi ? 'Điều khoản' : 'Terms'}
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
