import { useState, useEffect, useContext, useRef, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Scale,
  ShieldCheck,
  Lock,
  BookOpen,
  CreditCard,
  Globe,
  Mail,
  MapPin,
  CheckCircle2,
  ChevronRight,
  Menu,
  X,
  Users,
  FileCheck2,
} from 'lucide-react';
import { AuthContext } from '@/contexts/AuthContext';
import { ThemeToggle } from '@/contexts/ThemeContext';
import { IconSwap, useExitPresence } from '@/components/ui/transitions';
import { SCHOLARLY_APIS_LABEL } from '@/lib/productFacts';
import {
  type Lang,
  SolvaButton,
} from '@/components/landing/SolvaPrimitives';

/* ============================================================
   CITRA — Official Academic Terms of Service (/terms)
   Warm Academic Editorial System (Sentient Light + Onest Sans),
   Bilingual EN/VI, Light & Dark Modes, Single-Row 76px Header
   ============================================================ */

export const TERMS_OF_SERVICE_VERSION = '1.0';

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

interface TermsSectionItem {
  id: string;
  num: string;
  shortNav: string;
  badge: string;
  title: string;
  lead: ReactNode;
  bullets: ReactNode[];
  calloutTitle: string;
  calloutBody: ReactNode;
  icon: typeof Scale;
}

function getTermsSections(lang: Lang): TermsSectionItem[] {
  if (lang === 'vi') {
    return [
      {
        id: 'decision-support',
        num: '01',
        shortNav: '01 · Hỗ trợ Quyết định',
        badge: 'NGUYÊN TẮC CỐT LÕI',
        title: 'Nguyên tắc Hỗ trợ Ra Quyết định Học thuật',
        lead:
          'CITRA được xây dựng nhất quán như một Hệ thống Hỗ trợ Ra Quyết định Học thuật (Academic Decision-Support System), không phải công cụ chấm điểm tự động hay phán quyết kỷ luật tự động.',
        bullets: [
          'Mọi nhãn thẩm định (Đã xác thực, Sai lệch thông tin thư mục, Nghi vấn trích dẫn không có thật, Cần kiểm tra thủ công, Nguồn trực tuyến) chỉ phản ánh bằng chứng đối chiếu khách quan trên hơn 15 cơ sở dữ liệu khoa học quốc tế.',
          'Tác giả, giảng viên hướng dẫn và hội đồng chấm khóa luận luôn giữ toàn quyền đánh giá học thuật cuối cùng đối với từng tài liệu tham khảo.',
          'Giảng viên và người phản biện có thể chủ động xác nhận hợp lệ cho sách chuyên khảo in trong nước, kỷ yếu nội bộ hoặc tài liệu lưu trữ chưa có mã DOI kèm ghi chú chuyên môn minh bạch.',
        ],
        calloutTitle: 'Con người giữ quyền quyết định cuối cùng',
        calloutBody:
          'Không một thuật toán nào tự động kết luận vi phạm liêm chính học thuật thay cho hội đồng chuyên môn của nhà trường.',
        icon: Scale,
      },
      {
        id: 'manuscript-confidentiality',
        num: '02',
        shortNav: '02 · Quyền sở hữu & Bảo mật',
        badge: 'BẢO MẬT BẢN THẢO',
        title: 'Quyền Sở hữu Trí tuệ & Bảo mật Bản thảo Chưa Công bố',
        lead:
          'Tác giả và cơ sở đào tạo giữ trọn vẹn 100% quyền sở hữu trí tuệ và quyền tác giả đối với mọi tệp luận văn, khóa luận, bài báo (.pdf, .docx, .bib, .ris) và báo cáo trích dẫn tạo trên CITRA.',
        bullets: [
          'Không chia sẻ toàn văn ra bên ngoài & không đưa vào kho đối chiếu chung kiểu Turnitin: CITRA tuyệt đối không gửi toàn văn bài viết sang bên thứ ba và không lưu bài nộp vào bất kỳ kho dữ liệu so trùng dùng chung nào.',
          'Không huấn luyện mô hình AI sinh văn bản: Nội dung luận văn và công trình chưa công bố của bạn không bao giờ được sử dụng để huấn luyện các mô hình trí tuệ nhân tạo thương mại.',
          'Chỉ các chuỗi thông tin thư mục cần kiểm chứng (tiêu đề tài liệu được trích dẫn, tên tác giả được dẫn, năm xuất bản, mã DOI/URL) mới được gửi tra cứu tới các danh mục khoa học mở như Crossref, OpenAlex, PubMed, arXiv và DBLP.',
          'Chủ tài khoản có thể tự xóa từng báo cáo hoặc xóa vĩnh viễn toàn bộ tài khoản và tệp gốc bất cứ lúc nào tại trang Cài đặt tài khoản.',
        ],
        calloutTitle: 'An toàn cho luận văn & bài báo trước ngày công bố',
        calloutBody:
          'Việc kiểm tra trích dẫn trên CITRA không làm lộ nội dung nghiên cứu chưa xuất bản và không làm tăng tỷ lệ trùng lặp khi nộp cho tạp chí hoặc hội đồng.',
        icon: BookOpen,
      },
      {
        id: 'acceptable-use',
        num: '03',
        shortNav: '03 · Sử dụng Hợp lệ',
        badge: 'TRÁCH NHIỆM HỌC THUẬT',
        title: 'Quy tắc Sử dụng Học thuật Hợp lệ & Quản lý Tài khoản',
        lead:
          'Không gian làm việc của CITRA phục vụ mục đích học tập, nghiên cứu khoa học, hướng dẫn khóa luận và đảm bảo chất lượng đào tạo đại học – sau đại học.',
        bullets: [
          'Người dùng cam kết cung cấp thông tin đăng ký trung thực, bảo mật thông tin đăng nhập và chịu trách nhiệm đối với các hoạt động phát sinh dưới tài khoản cá nhân.',
          'Khi giảng viên, thư ký hội đồng hoặc trưởng nhóm nghiên cứu tải hàng loạt bài nộp của sinh viên hay đồng tác giả, người tải lên xác nhận có thẩm quyền hướng dẫn học thuật hoặc sự đồng ý hợp pháp của tác giả.',
          'Nghiêm cấm các hành vi thu thập dữ liệu tự động trái phép, dịch ngược mã nguồn, chia sẻ trái phép khóa truy cập hoặc cố ý gây quá tải hệ thống tra cứu học thuật chung.',
        ],
        calloutTitle: 'Môi trường học thuật văn minh & tin cậy',
        calloutBody:
          'Phân tách quyền hạn rõ ràng giữa Sinh viên, Giảng viên và Quản trị viên giúp bảo vệ quyền riêng tư của từng lớp học và bộ môn.',
        icon: Users,
      },
      {
        id: 'billing-quotas',
        num: '04',
        shortNav: '04 · Gói cước & Thanh toán',
        badge: 'HẠN MỨC & THANH TOÁN',
        title: 'Gói Dịch vụ, Hạn mức Kiểm tra & Thanh toán Mã hóa',
        lead: (
          <>
            CITRA cung cấp gói Basic miễn phí trọn đời (0 ₫) cùng các gói nâng cấp Pro và Ultra
            với biểu phí và hạn mức công bố minh bạch tại{' '}
            <Link
              to="/pricing"
              className="underline underline-offset-4 hover:opacity-80 transition-opacity"
            >
              trang Bảng giá
            </Link>
            .
          </>
        ),
        bullets: [
          'Hạn mức số lượt kiểm tra bản thảo mỗi tháng được làm mới tự động theo chu kỳ gói cước; các lượt chưa sử dụng không cộng dồn sang kỳ tiếp theo.',
          'Giao dịch nâng cấp được mã hóa qua giao thức TLS 1.3 thông qua cổng thanh toán quốc tế Stripe (thẻ Visa, Mastercard, Apple Pay, Google Pay) và cổng thanh toán nội địa VNPay (VNPAY-QR, thẻ ATM/NAPAS ngân hàng Việt Nam).',
          'CITRA không bao giờ lưu trữ số thẻ đầy đủ hay mã bảo mật CVV; hệ thống chỉ ghi nhận 4 chữ số cuối và trạng thái biên lai để đối soát gói cước.',
          'Người dùng có thể hủy gia hạn tự động bất cứ lúc nào với một thao tác tại trang Cài đặt tài khoản và vẫn giữ trọn quyền lợi Pro hoặc Ultra đến hết chu kỳ đã thanh toán.',
        ],
        calloutTitle: 'Không phí ẩn · Chủ động hủy gia hạn 1 nhấp chuột',
        calloutBody:
          'Mọi biên lai nâng cấp và ngày gia hạn tiếp theo đều hiển thị rõ ràng trong mục Quản lý Gói cước của tài khoản.',
        icon: CreditCard,
      },
      {
        id: 'governing-law',
        num: '05',
        shortNav: '05 · Pháp luật & Liên hệ',
        badge: 'PHÁP LÝ & LIÊN HỆ',
        title: 'Pháp luật Điều chỉnh & Thông tin Liên hệ Học thuật',
        lead:
          'Điều khoản dịch vụ này được điều chỉnh và giải thích theo pháp luật nước Cộng hòa Xã hội Chủ nghĩa Việt Nam.',
        bullets: [
          <>
            Hoạt động xử lý và bảo vệ dữ liệu cá nhân tuân thủ nghiêm ngặt Luật Bảo vệ dữ liệu cá
            nhân số 91/2025/QH15 và Nghị định 356/2025/NĐ-CP, được quy định chi tiết tại{' '}
            <Link
              to="/privacy"
              className="underline underline-offset-4 text-[var(--solva-ink)] hover:opacity-80 transition-opacity"
            >
              Chính sách bảo vệ dữ liệu cá nhân
            </Link>
            .
          </>,
          'Khi có cập nhật quan trọng về điều khoản hoặc quyền lợi gói cước, CITRA sẽ thông báo rõ ràng trên hệ thống kèm phiên bản hiệu lực mới.',
          'Đơn vị phát triển & vận hành học thuật: Nhóm nghiên cứu CITRA tại Trường Đại học Tôn Đức Thắng (19 Nguyễn Hữu Thọ, phường Tân Hưng, TP. Hồ Chí Minh).',
          'Liên hệ hỗ trợ học thuật, gói dịch vụ và pháp lý dữ liệu: privacy@citra.io.vn.',
        ],
        calloutTitle: 'Đồng bộ cùng Chính sách Bảo vệ Dữ liệu Cá nhân',
        calloutBody: (
          <>
            Xem chi tiết quy trình thực thi quyền chủ thể dữ liệu và thời hạn phản hồi theo luật
            định trong{' '}
            <Link
              to="/privacy"
              className="underline underline-offset-4 text-[var(--solva-ink)] hover:opacity-80 transition-opacity"
            >
              Chính sách bảo vệ dữ liệu cá nhân
            </Link>
            .
          </>
        ),
        icon: ShieldCheck,
      },
    ];
  }

  return [
    {
      id: 'decision-support',
      num: '01',
      shortNav: '01 · Decision-Support',
      badge: 'CORE PRINCIPLE',
      title: 'Academic Decision-Support Principle',
      lead:
        'CITRA operates strictly as an Academic Decision-Support System — never as an automated grading authority or autonomous misconduct tribunal.',
      bullets: [
        'Every verification status (Verified, Metadata Error, Suspected Hallucination, Unverifiable, and Web Resource) presents objective bibliographic evidence cross-checked across 15+ international scholarly catalogs.',
        'Authors, thesis advisors, journal editors, and academic review committees always retain final scholarly judgment over every reference in a submission.',
        'Instructors and reviewers can approve regional print monographs, domestic university press volumes, or archival works without international DOIs in one click with a transparent review note.',
      ],
      calloutTitle: 'Human judgment always comes first',
      calloutBody:
        'CITRA surfaces transparent bibliographic evidence to save review hours while keeping academic decisions firmly in the hands of educators and authors.',
      icon: Scale,
    },
    {
      id: 'manuscript-confidentiality',
      num: '02',
      shortNav: '02 · Ownership & Confidentiality',
      badge: 'MANUSCRIPT PROTECTION',
      title: 'Manuscript Ownership & Confidentiality',
      lead:
        'Authors and institutions retain 100% copyright and intellectual property ownership over all uploaded manuscripts (.pdf, .docx, .bib, .ris), pasted references, and generated verification reports.',
      bullets: [
        'Zero full-text external sharing & zero shared Turnitin pool: CITRA never transmits your full manuscript prose to external third parties and never deposits unpublished theses or papers into any shared Turnitin-style similarity database.',
        'Zero generative AI training: Uploaded theses, student submissions, and unpublished research papers are never used to train external or commercial language models.',
        'Only extracted bibliographic citation fields (cited paper titles, cited author names, publication years, and DOIs/URLs) are queried against scholarly indexes including Crossref, OpenAlex, PubMed, arXiv, and DBLP.',
        'Account holders can delete individual verification reports or permanently purge their entire account and uploaded files at any time from account Settings.',
      ],
      calloutTitle: 'Safe for unpublished theses & journal submissions',
      calloutBody:
        'Verifying references on CITRA never exposes your unpublished findings and never inflates similarity scores when you later submit to a publisher or thesis board.',
      icon: BookOpen,
    },
    {
      id: 'acceptable-use',
      num: '03',
      shortNav: '03 · Acceptable Use',
      badge: 'ACADEMIC STEWARDSHIP',
      title: 'Acceptable Academic Use & Accounts',
      lead:
        'CITRA workspaces are provisioned for students, researchers, thesis advisors, lecturers, and department administrators conducting legitimate scholarly verification.',
      bullets: [
        'Users agree to provide accurate registration details, safeguard their login credentials, and remain responsible for activity conducted under their account.',
        'When a lecturer, thesis coordinator, or research lead uploads student or co-author papers (including classroom batch uploads), the uploader confirms academic review authority or lawful author permission.',
        'Automated scraping, reverse engineering, unauthorized credential sharing, or deliberate abuse of scholarly catalog rate limits is prohibited so institutional service stays dependable for every cohort.',
      ],
      calloutTitle: 'Role-isolated academic workspaces',
      calloutBody:
        'Clear permission boundaries across Student, Lecturer, and Department Admin roles keep individual submissions and classroom cohorts isolated.',
      icon: Users,
    },
    {
      id: 'billing-quotas',
      num: '04',
      shortNav: '04 · Plans & Billing',
      badge: 'QUOTAS & BILLING',
      title: 'Subscriptions, Quotas & Encrypted Billing',
      lead: (
        <>
          CITRA offers a permanent free Basic plan ($0) alongside Pro and Ultra subscriptions with
          transparent monthly quotas published on our{' '}
          <Link
            to="/pricing"
            className="underline underline-offset-4 hover:opacity-80 transition-opacity"
          >
            Pricing page
          </Link>
          .
        </>
      ),
      bullets: [
        'Monthly manuscript verification quotas renew automatically at the start of each billing cycle; unused monthly checks do not roll over.',
        'Paid upgrades are processed over TLS 1.3 via PCI-DSS compliant Stripe (Visa, Mastercard, Apple Pay, Google Pay) and VNPay (VNPAY-QR and domestic Vietnamese ATM/NAPAS bank cards).',
        'CITRA never stores raw card numbers or CVV security codes; only non-reversible payment references and the last 4 digits are retained for billing receipts.',
        'You may cancel or reactivate auto-renewal at any time with one click in account Settings, keeping full Pro or Ultra access through the end of your paid billing period.',
      ],
      calloutTitle: 'Predictable academic billing · 1-click cancellation',
      calloutBody:
        'Every digital receipt, renewal date, and plan quota is visible directly inside your account Settings.',
      icon: CreditCard,
    },
    {
      id: 'governing-law',
      num: '05',
      shortNav: '05 · Governing Law',
      badge: 'GOVERNANCE & CONTACT',
      title: 'Governing Law & Academic Contact',
      lead:
        'These Academic Terms of Service are governed by and construed in accordance with the laws of the Socialist Republic of Vietnam.',
      bullets: [
        <>
          Personal data protection, cross-border bibliographic queries, and statutory user rights
          are governed by Vietnam’s Personal Data Protection Law No. 91/2025/QH15 and Decree
          356/2025/ND-CP, detailed in our{' '}
          <Link
            to="/privacy"
            className="underline underline-offset-4 text-[var(--solva-ink)] hover:opacity-80 transition-opacity"
          >
            Personal Data Protection Policy
          </Link>
          .
        </>,
        'Material updates to these terms are announced clearly with an updated version identifier.',
        'Academic research & operational base: CITRA Research Group, Ton Duc Thang University (19 Nguyen Huu Tho Street, Tan Hung Ward, Ho Chi Minh City, Vietnam).',
        'Direct contact for academic support, institutional plans, or legal inquiries: privacy@citra.io.vn.',
      ],
      calloutTitle: 'Paired with our Personal Data Protection Policy',
      calloutBody: (
        <>
          Review full statutory response timelines and self-service data controls in our{' '}
          <Link
            to="/privacy"
            className="underline underline-offset-4 text-[var(--solva-ink)] hover:opacity-80 transition-opacity"
          >
            Personal Data Protection Policy
          </Link>
          .
        </>
      ),
      icon: ShieldCheck,
    },
  ];
}

function TermsSolvaHeader({
  lang,
  onToggleLanguage,
  isAuthenticated,
  sections,
}: {
  lang: Lang;
  onToggleLanguage: () => void;
  isAuthenticated: boolean;
  sections: TermsSectionItem[];
}) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const mobileToggleRef = useRef<HTMLButtonElement>(null);
  const mobileDrawerPresence = useExitPresence(mobileMenuOpen, 150);

  useEffect(() => {
    if (!mobileMenuOpen) return;
    const closeOnKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMobileMenuOpen(false);
        mobileToggleRef.current?.focus({ preventScroll: true });
      }
    };
    window.addEventListener('keydown', closeOnKeyDown);
    return () => window.removeEventListener('keydown', closeOnKeyDown);
  }, [mobileMenuOpen]);

  const globalLinks: Array<{ label: string; to?: string; href?: string; active?: boolean }> =
    lang === 'vi'
      ? [
          { label: 'Trang chủ', to: '/' },
          { label: 'Quy trình hoạt động', to: '/#how-it-works' },
          { label: 'Bảng giá', to: '/pricing' },
          { label: 'Bảo vệ dữ liệu', to: '/privacy' },
          { label: 'Điều khoản', to: '/terms', active: true },
        ]
      : [
          { label: 'Home', to: '/' },
          { label: 'How It Works', to: '/#how-it-works' },
          { label: 'Pricing', to: '/pricing' },
          { label: 'Privacy', to: '/privacy' },
          { label: 'Terms', to: '/terms', active: true },
        ];

  return (
    <header
      style={{ backgroundColor: 'var(--solva-bg)' }}
      className="fixed top-0 left-0 right-0 z-50 border-b border-[#E7E3D9]/70 dark:border-[#332F26]/70 transition-colors duration-200"
    >
      <div className="max-w-[1280px] mx-auto px-5 sm:px-6 lg:px-8 xl:px-[40px] h-[64px] lg:h-[76px] flex items-center justify-between flex-nowrap gap-3 xl:gap-4">
        {/* Left: Brand Logo */}
        <div className="flex items-center shrink-0">
          <Link
            to="/"
            className="inline-flex items-center gap-[8px] rounded-[6px] whitespace-nowrap focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1C1A15]/40 dark:focus-visible:ring-[#FBFAF6]/40"
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
        </div>

        {/* Center: Single-Row Global Navigation Links (Never Wraps at 1024px or 1440px) */}
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

            if (item.to) {
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
              <a key={item.label} href={item.href} style={itemStyle} className={itemClass}>
                {item.label}
              </a>
            );
          })}
        </nav>

        {/* Right: Lang, Theme, Sign In, Primary CTA */}
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
            to={isAuthenticated ? '/upload' : '/register'}
            variant="primary"
            className="hidden sm:inline-flex shrink-0"
          >
            {isAuthenticated
              ? lang === 'vi'
                ? 'Kiểm tra mới'
                : 'New Check'
              : lang === 'vi'
                ? 'Đăng ký'
                : 'Start Free'}
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
            className="lg:hidden inline-flex items-center justify-center w-[40px] h-[40px] rounded-[8px] cursor-pointer shrink-0"
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
          aria-label="Mobile Terms Navigation"
          style={{
            backgroundColor: 'var(--solva-bg)',
            borderColor: 'var(--solva-border)',
          }}
          className={`lg:hidden border-t border-b px-5 py-4 space-y-2 shadow-lg t-mobile-drawer ${
            mobileDrawerPresence.phase === 'open' ? 'is-open' : 'is-closing'
          }`}
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            {sections.map((sec) => (
              <a
                key={sec.id}
                href={`#${sec.id}`}
                onClick={() => setMobileMenuOpen(false)}
                style={{
                  backgroundColor: 'var(--solva-surface)',
                  color: 'var(--solva-ink)',
                }}
                className="flex items-center justify-between min-h-[44px] px-3.5 py-2.5 rounded-[10px] font-solva-sans text-[14px] font-medium"
              >
                <span>{sec.shortNav}</span>
                <ChevronRight className="w-4 h-4 opacity-60 shrink-0" />
              </a>
            ))}
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
            <Link
              to="/privacy"
              onClick={() => setMobileMenuOpen(false)}
              style={{
                backgroundColor: 'var(--solva-surface)',
                color: 'var(--solva-ink)',
              }}
              className="flex items-center justify-between min-h-[44px] px-3.5 py-2.5 rounded-[10px] font-solva-sans text-[14px] font-medium"
            >
              <span>
                {lang === 'vi' ? 'Chính sách bảo vệ dữ liệu' : 'Personal Data Policy'}
              </span>
              <ChevronRight className="w-4 h-4 opacity-60 shrink-0" />
            </Link>
            <Link
              to="/pricing"
              onClick={() => setMobileMenuOpen(false)}
              style={{
                backgroundColor: 'var(--solva-surface)',
                color: 'var(--solva-ink)',
              }}
              className="flex items-center justify-between min-h-[44px] px-3.5 py-2.5 rounded-[10px] font-solva-sans text-[14px] font-medium"
            >
              <span>{lang === 'vi' ? 'Bảng giá dịch vụ' : 'Pricing Plans'}</span>
              <ChevronRight className="w-4 h-4 opacity-60 shrink-0" />
            </Link>
          </div>

          <div className="pt-2 flex flex-col min-[390px]:flex-row items-stretch gap-2">
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
              to={isAuthenticated ? '/upload' : '/register'}
              variant="primary"
              fullWidth
              onClick={() => setMobileMenuOpen(false)}
            >
              {isAuthenticated
                ? lang === 'vi'
                  ? 'Kiểm tra bài mới'
                  : 'New Check'
                : lang === 'vi'
                  ? 'Tạo tài khoản'
                  : 'Create Account'}
            </SolvaButton>
          </div>
        </nav>
      )}
    </header>
  );
}

function TermsSolvaFooter({ lang }: { lang: Lang }) {
  const columns: Array<{
    header: string;
    links: Array<{ label: string; to?: string; href?: string }>;
  }> = [
    {
      header: lang === 'vi' ? 'Nền tảng' : 'Product',
      links: [
        { label: lang === 'vi' ? 'Trang chủ CITRA' : 'CITRA Home', to: '/' },
        {
          label: lang === 'vi' ? 'Thực nghiệm 120K bài báo' : '120K-Paper Benchmark',
          to: '/#benchmark-120k',
        },
        {
          label: lang === 'vi' ? 'Trình thẩm định trích dẫn' : 'Citation Inspector',
          to: '/#interactive-demo',
        },
        { label: lang === 'vi' ? 'Bảng giá dịch vụ' : 'Pricing Plans', to: '/pricing' },
      ],
    },
    {
      header: lang === 'vi' ? 'Không gian học thuật' : 'Workspaces',
      links: [
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
      header: lang === 'vi' ? 'Mục lục điều khoản' : 'Terms Sections',
      links: [
        {
          label: lang === 'vi' ? '01. Hỗ trợ Quyết định' : '01. Decision-Support',
          href: '#decision-support',
        },
        {
          label: lang === 'vi' ? '02. Bảo mật bản thảo' : '02. Manuscript Confidentiality',
          href: '#manuscript-confidentiality',
        },
        {
          label: lang === 'vi' ? '03. Sử dụng hợp lệ' : '03. Acceptable Academic Use',
          href: '#acceptable-use',
        },
        {
          label: lang === 'vi' ? '04. Gói cước & Thanh toán' : '04. Plans & Encrypted Billing',
          href: '#billing-quotas',
        },
        {
          label: lang === 'vi' ? '05. Luật điều chỉnh & Liên hệ' : '05. Governing Law & Contact',
          href: '#governing-law',
        },
      ],
    },
    {
      header: lang === 'vi' ? 'Pháp lý & Tài khoản' : 'Legal & Account',
      links: [
        { label: lang === 'vi' ? 'Đăng nhập' : 'Sign in', to: '/login' },
        { label: lang === 'vi' ? 'Đăng ký tài khoản' : 'Create account', to: '/register' },
        {
          label: lang === 'vi' ? 'Chính sách bảo vệ dữ liệu' : 'Personal Data Policy',
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
      className="pt-[36px] sm:pt-[48px] lg:pt-[80px] pb-[24px] sm:pb-[32px] px-5 sm:px-6 lg:px-[40px] mt-[48px]"
    >
      <div className="max-w-[1200px] mx-auto flex flex-col gap-[28px] sm:gap-[36px] lg:gap-[48px]">
        <div className="flex flex-col lg:flex-row items-start justify-between gap-[28px] sm:gap-[36px] lg:gap-[32px]">
          <div className="w-full lg:w-[360px] flex flex-col items-start gap-[16px]">
            <Link to="/" className="inline-flex items-center gap-[10px]">
              <span className="w-[32px] h-[32px] rounded-[8px] bg-white dark:bg-[#1E1C17] border border-[#E7E3D9] dark:border-[#332F26] shadow-sm flex items-center justify-center p-1 shrink-0 transition-colors">
                <CitraBrandLogo size={20} />
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
              className="font-solva-sans text-[15px] leading-[22.5px] max-w-[320px]"
            >
              {lang === 'vi'
                ? 'Không gian kiểm chứng trích dẫn và danh mục tài liệu tham khảo học thuật, đối chiếu trực tiếp qua hơn 15 cơ sở dữ liệu khoa học quốc tế.'
                : `Academic citation and bibliography verification workspace cross-referencing ${SCHOLARLY_APIS_LABEL} international scholarly databases.`}
            </p>
          </div>

          <div className="w-full lg:w-[780px] grid grid-cols-2 sm:grid-cols-4 gap-[24px]">
            {columns.map((col) => (
              <div key={col.header} className="flex flex-col gap-[12px]">
                <h4
                  style={{ color: 'var(--solva-ink)' }}
                  className="font-solva-sans text-[17px] font-medium leading-[24px]"
                >
                  {col.header}
                </h4>
                <ul className="flex flex-col gap-[10px]">
                  {col.links.map((lnk) => (
                    <li key={lnk.label}>
                      {lnk.to ? (
                        <Link
                          to={lnk.to}
                          style={{ color: 'var(--solva-muted)' }}
                          className="font-solva-sans text-[15px] leading-[22px] hover:opacity-75 transition-opacity"
                        >
                          {lnk.label}
                        </Link>
                      ) : (
                        <a
                          href={lnk.href}
                          style={{ color: 'var(--solva-muted)' }}
                          className="font-solva-sans text-[15px] leading-[22px] hover:opacity-75 transition-opacity"
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
          className="pt-[20px] sm:pt-[28px] border-t flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-4 font-solva-sans text-[14px]"
        >
          <p style={{ color: 'var(--solva-muted)' }}>
            {lang === 'vi'
              ? '© 2026 CITRA — Không gian Kiểm chứng Trích dẫn Học thuật. Bảo lưu mọi quyền.'
              : '© 2026 CITRA — Academic Citation Integrity Workspace. All rights reserved.'}
          </p>
          <p style={{ color: 'var(--solva-muted)' }}>
            {lang === 'vi'
              ? 'Hệ thống hỗ trợ quyết định học thuật — đồng hành cùng giảng viên & tác giả.'
              : 'Decision-Support System — assists scholarly review, never replaces human judgment.'}
          </p>
        </div>
      </div>
    </footer>
  );
}

export function TermsOfServicePage(): JSX.Element {
  const { i18n } = useTranslation();
  const location = useLocation();
  const auth = useContext(AuthContext);
  const isAuthenticated = Boolean(auth?.user);
  const lang: Lang = i18n.language?.startsWith('vi') ? 'vi' : 'en';
  const isVi = lang === 'vi';

  const toggleLanguage = () => {
    void i18n.changeLanguage(isVi ? 'en' : 'vi');
  };

  useEffect(() => {
    if (location.hash) {
      const target = document.getElementById(location.hash.slice(1));
      if (target && typeof target.scrollIntoView === 'function') {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
    }
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, [location.hash]);

  const sections = getTermsSections(lang);
  const headingTypography = isVi
    ? 'leading-[1.15] tracking-[-0.03em]'
    : 'leading-[1.06] tracking-[-0.045em]';

  const pillars = isVi
    ? [
        {
          badge: 'HỖ TRỢ RA QUYẾT ĐỊNH',
          title: 'Con người giữ phán quyết cuối',
          desc: 'Cung cấp bằng chứng thư mục khách quan; giảng viên và tác giả luôn giữ quyền kết luận học thuật.',
          icon: Scale,
        },
        {
          badge: '100% QUYỀN SỞ HỮU TÁC GIẢ',
          title: 'Không chia sẻ vào kho đối chiếu chung',
          desc: 'Không gửi toàn văn ra ngoài, không lưu vào kho chung kiểu Turnitin và không huấn luyện AI.',
          icon: Lock,
        },
        {
          badge: 'THANH TOÁN & DỮ LIỆU MINH BẠCH',
          title: 'Stripe, VNPay & Luật 91/2025/QH15',
          desc: 'Mã hóa TLS 1.3 không lưu số thẻ gốc, hủy gia hạn 1 nhấp chuột và tự xóa dữ liệu tại trang Cài đặt.',
          icon: FileCheck2,
        },
      ]
    : [
        {
          badge: 'DECISION-SUPPORT ONLY',
          title: 'Human reviewers decide',
          desc: 'Surfaces verifiable bibliographic evidence; authors and faculty advisors retain final judgment.',
          icon: Scale,
        },
        {
          badge: '100% AUTHOR OWNERSHIP',
          title: 'Zero shared similarity pool',
          desc: 'Zero full-text external sharing, zero shared Turnitin-style repository, and zero AI training on your work.',
          icon: Lock,
        },
        {
          badge: 'ENCRYPTED BILLING & PRIVACY',
          title: 'Stripe, VNPay & Law 91/2025/QH15',
          desc: 'TLS 1.3 checkout without raw card storage, 1-click renewal control, and full self-service deletion.',
          icon: FileCheck2,
        },
      ];

  return (
    <div
      data-testid="terms-page"
      lang={lang}
      data-lang={lang}
      className="solva-editorial-root min-h-screen overflow-x-clip selection:bg-[#1C1A15] selection:text-[#FBFAF6]"
    >
      <a
        href="#terms-main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[100] focus:px-4 focus:py-2 focus:rounded-[10px] focus:bg-[#1C1A15] focus:text-[#FBFAF6] dark:focus:bg-[#FBFAF6] dark:focus:text-[#1C1A15] focus:shadow-lg font-solva-sans text-sm font-medium"
      >
        {isVi ? 'Chuyển đến nội dung chính' : 'Skip to main content'}
      </a>
      <TermsSolvaHeader
        lang={lang}
        onToggleLanguage={toggleLanguage}
        isAuthenticated={isAuthenticated}
        sections={sections}
      />

      {/* Sticky Section Jump Sub-Bar */}
      <div
        data-testid="terms-section-subnav"
        style={{
          backgroundColor: 'color-mix(in srgb, var(--solva-bg) 92%, transparent)',
          borderColor: 'var(--solva-border)',
        }}
        className="sticky top-[64px] lg:top-[76px] z-40 mt-[64px] lg:mt-[76px] border-b backdrop-blur-md"
      >
        <div className="max-w-[1200px] mx-auto px-5 sm:px-6 lg:px-[40px] h-[44px] flex items-center gap-2 overflow-x-auto no-scrollbar">
          {sections.map((sec) => (
            <a
              key={sec.id}
              href={`#${sec.id}`}
              className="inline-flex items-center h-[30px] px-3 rounded-full font-solva-sans text-[12.5px] font-medium whitespace-nowrap shrink-0 text-[var(--solva-muted)] hover:text-[var(--solva-ink)] hover:bg-[var(--solva-surface)] transition-colors"
            >
              {sec.shortNav}
            </a>
          ))}
        </div>
      </div>

      <main id="terms-main-content" className="px-5 sm:px-6 lg:px-[40px] pt-[36px] sm:pt-[48px] lg:pt-[64px]">
        <div className="max-w-[1200px] mx-auto flex flex-col gap-[36px] sm:gap-[48px] lg:gap-[64px]">
          {/* Editorial Hero */}
          <section id="terms-hero" className="flex flex-col gap-[28px]">
            <div className="flex flex-col items-start gap-[16px] max-w-[820px]">
              <div
                style={{
                  backgroundColor: 'var(--solva-surface)',
                  borderColor: 'var(--solva-border)',
                  color: 'var(--solva-ink)',
                }}
                className="inline-flex items-center gap-1.5 max-w-full px-3 py-1.5 rounded-full border font-mono text-[11px] font-medium tracking-wide"
              >
                <span className="w-2 h-2 rounded-full bg-emerald-600 dark:bg-emerald-400 shrink-0" />
                <span className="leading-snug">
                  {isVi
                    ? `ĐIỀU KHOẢN DỊCH VỤ HỌC THUẬT · PHIÊN BẢN ${TERMS_OF_SERVICE_VERSION}`
                    : `ACADEMIC TERMS OF SERVICE · v${TERMS_OF_SERVICE_VERSION}`}
                </span>
              </div>

              <h1
                className={`font-solva-serif font-light text-[34px] sm:text-[44px] xl:text-[52px] ${headingTypography}`}
              >
                <span className="block" style={{ color: 'var(--solva-ink)' }}>
                  {isVi ? 'Điều khoản học thuật minh bạch.' : 'Clear academic terms.'}
                </span>{' '}
                <span className="block" style={{ color: 'var(--solva-muted)' }}>
                  {isVi
                    ? 'Đặt quyền sở hữu tác giả và thẩm định con người làm trọng tâm.'
                    : 'Built around author ownership and human review.'}
                </span>
              </h1>

              <p
                style={{ color: 'var(--solva-muted)' }}
                className="font-solva-sans text-[16px] sm:text-[17px] leading-[25.5px] max-w-[700px]"
              >
                {isVi
                  ? 'Văn bản này quy định rõ nguyên tắc sử dụng không gian kiểm chứng trích dẫn CITRA dành cho sinh viên, tác giả nghiên cứu, giảng viên hướng dẫn và các khoa, viện — bằng ngôn ngữ học thuật trực diện, dễ hiểu.'
                  : 'These terms govern how students, authors, lecturers, thesis advisors, and academic departments use the CITRA citation verification workspace — written in plain, transparent academic prose.'}
              </p>

              <div className="flex flex-wrap items-center gap-x-5 gap-y-2 pt-1 font-mono text-[12px] text-[var(--solva-muted)]">
                <span>
                  {isVi ? 'Hiệu lực từ: 05/11/2026' : 'Effective Date: November 5, 2026'}
                </span>
                <span aria-hidden="true">·</span>
                <Link
                  to="/privacy"
                  className="underline underline-offset-4 text-[var(--solva-ink)] hover:opacity-80 transition-opacity"
                >
                  {isVi
                    ? 'Chính sách Bảo vệ Dữ liệu Cá nhân (Luật 91/2025/QH15)'
                    : 'Personal Data Protection Policy (Law 91/2025/QH15)'}
                </Link>
              </div>
            </div>

            {/* 3-Card Governance Summary */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-[14px]">
              {pillars.map((pillar) => {
                const Icon = pillar.icon;
                return (
                  <div
                    key={pillar.badge}
                    style={{
                      backgroundColor: 'var(--solva-surface)',
                      borderColor: 'var(--solva-border)',
                    }}
                    className="rounded-[14px] border p-5 sm:p-6 flex flex-col justify-between gap-4"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span
                        style={{
                          backgroundColor: 'var(--solva-bg)',
                          color: 'var(--solva-muted)',
                        }}
                        className="px-2.5 py-1 rounded-[6px] font-mono text-[11px] font-medium"
                      >
                        {pillar.badge}
                      </span>
                      <Icon
                        style={{ color: 'var(--solva-ink)' }}
                        className="w-[18px] h-[18px] shrink-0"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <h2
                        style={{ color: 'var(--solva-ink)' }}
                        className="font-solva-sans text-[17px] font-semibold leading-[23px]"
                      >
                        {pillar.title}
                      </h2>
                      <p
                        style={{ color: 'var(--solva-muted)' }}
                        className="font-solva-sans text-[14.5px] leading-[21.5px]"
                      >
                        {pillar.desc}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* 5 Numbered Governance Sections */}
          <div className="flex flex-col gap-[20px] sm:gap-[24px]">
            {sections.map((sec) => {
              const Icon = sec.icon;
              return (
                <section
                  key={sec.id}
                  id={sec.id}
                  className="scroll-mt-[136px] rounded-[16px] border p-6 sm:p-8 lg:p-10 transition-colors"
                  style={{
                    backgroundColor: 'var(--solva-surface)',
                    borderColor: 'var(--solva-border)',
                  }}
                >
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-10 items-start">
                    {/* Left Column: Section Number & Title */}
                    <div className="lg:col-span-4 flex flex-col items-start gap-3">
                      <div className="inline-flex items-center gap-2">
                        <span
                          style={{
                            backgroundColor: 'var(--solva-bg)',
                            color: 'var(--solva-ink)',
                            borderColor: 'var(--solva-border)',
                          }}
                          className="inline-flex items-center justify-center h-[28px] px-2.5 rounded-[7px] border font-mono text-[12px] font-semibold"
                        >
                          {sec.num}
                        </span>
                        <span
                          style={{ color: 'var(--solva-muted)' }}
                          className="font-mono text-[11px] font-medium tracking-wider uppercase"
                        >
                          {sec.badge}
                        </span>
                      </div>

                      <h2
                        style={{ color: 'var(--solva-ink)' }}
                        className={`font-solva-serif font-light text-[26px] sm:text-[30px] ${headingTypography}`}
                      >
                        {sec.title}
                      </h2>

                      <div
                        style={{
                          backgroundColor: 'var(--solva-bg)',
                          borderColor: 'var(--solva-border)',
                        }}
                        className="w-full rounded-[12px] border p-4 mt-1 space-y-1.5"
                      >
                        <div className="flex items-center gap-2">
                          <Icon
                            style={{ color: 'var(--solva-ink)' }}
                            className="w-4 h-4 shrink-0"
                          />
                          <span
                            style={{ color: 'var(--solva-ink)' }}
                            className="font-solva-sans text-[13.5px] font-semibold leading-snug"
                          >
                            {sec.calloutTitle}
                          </span>
                        </div>
                        <p
                          style={{ color: 'var(--solva-muted)' }}
                          className="font-solva-sans text-[13px] leading-[19.5px]"
                        >
                          {sec.calloutBody}
                        </p>
                      </div>
                    </div>

                    {/* Right Column: Plain Academic Prose & Commitments */}
                    <div className="lg:col-span-8 flex flex-col gap-5">
                      <p
                        style={{ color: 'var(--solva-ink)' }}
                        className="font-solva-sans text-[16px] sm:text-[17px] font-medium leading-[25.5px]"
                      >
                        {sec.lead}
                      </p>

                      <ul className="space-y-3.5">
                        {sec.bullets.map((bullet, bulletIdx) => (
                          <li key={`${sec.id}-bullet-${bulletIdx}`} className="flex items-start gap-3">
                            <CheckCircle2 className="w-[18px] h-[18px] mt-1 text-emerald-700 dark:text-emerald-400 shrink-0" />
                            <span
                              style={{ color: 'var(--solva-muted)' }}
                              className="font-solva-sans text-[15px] sm:text-[15.5px] leading-[23.5px]"
                            >
                              {bullet}
                            </span>
                          </li>
                        ))}
                      </ul>

                      {sec.id === 'billing-quotas' && (
                        <div className="pt-1 flex flex-wrap items-center gap-3">
                          <SolvaButton to="/pricing" variant="outline">
                            {isVi ? 'Xem Bảng giá & Hạn mức' : 'Compare Plans & Quotas'}
                          </SolvaButton>
                        </div>
                      )}

                      {sec.id === 'governing-law' && (
                        <div
                          style={{
                            backgroundColor: 'var(--solva-bg)',
                            borderColor: 'var(--solva-border)',
                          }}
                          className="rounded-[12px] border p-4 sm:p-5 flex flex-col md:flex-row md:items-center justify-between gap-4"
                        >
                          <div className="space-y-1.5 min-w-0">
                            <div className="flex items-start gap-2 font-solva-sans text-[14px] font-medium text-[var(--solva-ink)]">
                              <MapPin className="w-4 h-4 mt-0.5 shrink-0" />
                              <span>
                                {isVi
                                  ? 'Trường Đại học Tôn Đức Thắng · 19 Nguyễn Hữu Thọ, phường Tân Hưng, TP. Hồ Chí Minh'
                                  : 'Ton Duc Thang University · 19 Nguyen Huu Tho St., Tan Hung Ward, Ho Chi Minh City'}
                              </span>
                            </div>
                            <div className="flex items-center gap-2 font-mono text-[13px] text-[var(--solva-muted)]">
                              <Mail className="w-4 h-4 shrink-0" />
                              <a
                                href="mailto:privacy@citra.io.vn"
                                className="underline underline-offset-4 text-[var(--solva-ink)] hover:opacity-80"
                              >
                                privacy@citra.io.vn
                              </a>
                            </div>
                          </div>

                          <SolvaButton
                            to="/privacy"
                            variant="primary"
                            className="shrink-0 self-start md:self-auto"
                          >
                            {isVi ? 'Xem Chính sách bảo vệ dữ liệu' : 'Read Privacy Policy'}
                          </SolvaButton>
                        </div>
                      )}
                    </div>
                  </div>
                </section>
              );
            })}
          </div>
        </div>
      </main>

      <TermsSolvaFooter lang={lang} />
    </div>
  );
}
