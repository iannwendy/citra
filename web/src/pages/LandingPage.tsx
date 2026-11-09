import { useState, useEffect, useContext } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AuthContext } from '@/contexts/AuthContext';
import {
  SYMBOLIC_RULES_COUNT,
  SYMBOLIC_RULES_RANGE,
} from '@/lib/productFacts';
import {
  FileSearch,
  Database,
  Shield,
  ArrowRight,
  CheckCircle2,
  GitBranch,
  Scale,
  AlertTriangle,
  XCircle,
  Layers,
  FileText,
  Users,
  GraduationCap,
  Sliders,
  Check,
  BookOpen,
  Cpu,
  ChevronRight,
  ChevronDown,
  Globe,
  Play,
  Pause,
  Menu,
  X,
  Plus,
  Minus,
  Sparkles,
  Lock,
  Eye,
} from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { SolvaFilmSection } from '@/components/landing/CitraFilm';
import { ThemeToggle } from '@/contexts/ThemeContext';
import {
  type Lang,
  SolvaScrollReveal,
  SolvaEyebrow,
  SolvaTwoToneHeading,
  SolvaButton,
  SolvaPainterlyFrame,
  SolvaStickyStackCard,
  SolvaAnimatedMetric,
} from '@/components/landing/SolvaPrimitives';
import {
  HeroVerificationMockup,
  FeatureCardWidget,
  StickyCardWidget,
  PipelineStageVisual,
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
   CITRA (SourceLogic) — Warm Editorial AI SaaS Landing Page
   1:1 Architectural & Visual Implementation of Solva Template
   ============================================================ */

interface DemoCitation {
  id: string;
  marker: string;
  inText: string;
  page: string;
  contextBefore: string;
  contextAfter: string;
  verdict: 'VERIFIED' | 'METADATA_ERROR' | 'SUSPECTED_HALLUCINATION' | 'UNRESOLVED';
  verdictBadgeClass: string;
  mappingStatus: 'MATCHED' | 'MISSING_REFERENCE' | 'IN_TEXT_MISMATCH';
  mappingBadgeClass: string;
  confidence: number;
  citedMeta: {
    title: string;
    authors: string;
    year: string;
    venue: string;
    doi: string;
  };
  retrievedMeta: {
    title: string;
    authors: string;
    year: string;
    venue: string;
    doi: string;
  } | null;
  fieldStatus: {
    title: 'match' | 'partial' | 'mismatch' | 'missing';
    authors: 'match' | 'partial' | 'mismatch' | 'missing';
    year: 'match' | 'partial' | 'mismatch' | 'missing';
    venue: 'match' | 'partial' | 'mismatch' | 'missing';
    doi: 'match' | 'partial' | 'mismatch' | 'missing';
  };
  sources: Array<{
    name: string;
    status: 'matched' | 'partial' | 'none';
    latency: string;
    score: string;
  }>;
  rules: Array<{
    code: string;
    name: string;
    nameVi?: string;
    condition: string;
    status: 'passed' | 'warning' | 'failed';
  }>;
  explanation: {
    en: string;
    vi: string;
  };
}

const DEMO_CITATIONS: DemoCitation[] = [
  {
    id: 'cit-1',
    marker: '[1]',
    inText: 'Vaswani et al. [1]',
    page: 'p. 2',
    contextBefore:
      'Multi-head self-attention mechanisms have fundamentally replaced recurrent architectures in sequence modeling, as originally formalized by ',
    contextAfter: ' in the Transformer architecture.',
    verdict: 'VERIFIED',
    verdictBadgeClass: 'verdict-badge-verified',
    mappingStatus: 'MATCHED',
    mappingBadgeClass: 'mapping-badge-matched',
    confidence: 99,
    citedMeta: {
      title: 'Attention Is All You Need',
      authors: 'A. Vaswani, N. Shazeer, N. Parmar, J. Uszkoreit et al.',
      year: '2017',
      venue: 'Advances in Neural Information Processing Systems (NeurIPS)',
      doi: '10.48550/arXiv.1706.03762',
    },
    retrievedMeta: {
      title: 'Attention Is All You Need',
      authors: 'Ashish Vaswani, Noam Shazeer, Niki Parmar, Jakob Uszkoreit et al.',
      year: '2017',
      venue: 'Advances in Neural Information Processing Systems 30',
      doi: '10.48550/arXiv.1706.03762',
    },
    fieldStatus: {
      title: 'match',
      authors: 'match',
      year: 'match',
      venue: 'match',
      doi: 'match',
    },
    sources: [
      { name: 'Crossref', status: 'matched', latency: '42ms', score: '100%' },
      { name: 'Semantic Scholar', status: 'matched', latency: '68ms', score: '100%' },
      { name: 'OpenAlex', status: 'matched', latency: '55ms', score: '99%' },
      { name: 'arXiv API', status: 'matched', latency: '39ms', score: '100%' },
    ],
    rules: [
      {
        code: 'R01_EXACT_DOI',
        name: 'Canonical DOI Resolution',
        nameVi: 'Xác thực định danh DOI chuẩn',
        condition: 'cited.doi == canonical.doi ∧ title_sim >= 0.95',
        status: 'passed',
      },
      {
        code: 'R04_AUTHOR_OVERLAP',
        name: 'Primary Author Surname Verification',
        nameVi: 'Đối chiếu danh sách họ tên tác giả',
        condition: 'jaccard(cited.authors, canonical.authors) == 1.00',
        status: 'passed',
      },
      {
        code: 'R09_NLI_STANCE',
        name: 'DeBERTa-v3 Claim-Abstract Entailment',
        nameVi: 'Thẩm định sự đồng thuận ngữ nghĩa (DeBERTa-v3)',
        condition: 'stance(context, abstract) == SUPPORTS (0.96)',
        status: 'passed',
      },
    ],
    explanation: {
      en: 'Exact DOI resolution and 100% bibliographic alignment across 4 independent scholarly indexes. Claim context is entailed by abstract.',
      vi: 'Mã định danh DOI hợp lệ tuyệt đối; toàn bộ thông tin thư mục đồng nhất 100% trên 4 cơ sở dữ liệu khoa học độc lập. Nội dung tóm tắt của công trình gốc hoàn toàn củng cố cho luận điểm được trích dẫn trong bài.',
    },
  },
  {
    id: 'cit-2',
    marker: '[2]',
    inText: '(Devlin et al., 2018)',
    page: 'p. 5',
    contextBefore:
      'Bidirectional masked language pre-training significantly improves downstream token-level classification tasks ',
    contextAfter: ' across biomedical and legal corpora.',
    verdict: 'METADATA_ERROR',
    verdictBadgeClass: 'verdict-badge-metadata-error',
    mappingStatus: 'MATCHED',
    mappingBadgeClass: 'mapping-badge-matched',
    confidence: 84,
    citedMeta: {
      title: 'BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding',
      authors: 'J. Devlin, M.-W. Chang, K. Lee, K. Toutanova',
      year: '2018',
      venue: 'EMNLP Conference Proceedings',
      doi: '10.18653/v1/N19-1423',
    },
    retrievedMeta: {
      title: 'BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding',
      authors: 'Jacob Devlin, Ming-Wei Chang, Kenton Lee, Kristina Toutanova',
      year: '2019',
      venue: 'Proceedings of NAACL-HLT 2019',
      doi: '10.18653/v1/N19-1423',
    },
    fieldStatus: {
      title: 'match',
      authors: 'match',
      year: 'mismatch',
      venue: 'mismatch',
      doi: 'match',
    },
    sources: [
      { name: 'Crossref', status: 'matched', latency: '47ms', score: '94%' },
      { name: 'OpenAlex', status: 'matched', latency: '61ms', score: '94%' },
      { name: 'DBLP', status: 'matched', latency: '52ms', score: '92%' },
      { name: 'Semantic Scholar', status: 'matched', latency: '74ms', score: '95%' },
    ],
    rules: [
      {
        code: 'R01_EXACT_DOI',
        name: 'Canonical DOI Resolution',
        nameVi: 'Xác thực định danh DOI chuẩn',
        condition: 'DOI 10.18653/v1/N19-1423 resolves to ACL Anthology work',
        status: 'passed',
      },
      {
        code: 'R05_YEAR_DRIFT',
        name: 'Publication Year Discrepancy',
        nameVi: 'Sai lệch năm công bố (Bản nháp vs. Kỷ yếu)',
        condition: '|cited.year (2018) - canonical.year (2019)| == 1 (arXiv vs Proc.)',
        status: 'warning',
      },
      {
        code: 'R07_VENUE_MISMATCH',
        name: 'Venue / Container Title Drift',
        nameVi: 'Sai lệch tên Hội nghị / Tạp chí công bố',
        condition: 'cited.venue ("EMNLP") != canonical.venue ("NAACL-HLT")',
        status: 'failed',
      },
    ],
    explanation: {
      en: 'Paper exists and DOI is valid, but manuscript cites preprint year (2018) and wrong conference venue (EMNLP instead of NAACL-HLT 2019).',
      vi: 'Công trình có thật với mã DOI hợp lệ, nhưng tác giả đã ghi nhầm năm của bản tiền ấn phẩm trên arXiv (2018) và trích dẫn sai tên hội nghị công bố chính thức (ghi EMNLP thay vì NAACL-HLT 2019).',
    },
  },
  {
    id: 'cit-3',
    marker: '[3]',
    inText: '(Robertson & Walker, 2024)',
    page: 'p. 9',
    contextBefore:
      'Recent studies claim that zero-shot quantum hyper-graphs eliminate all citation hallucinations without external retrieval ',
    contextAfter: '.',
    verdict: 'SUSPECTED_HALLUCINATION',
    verdictBadgeClass: 'verdict-badge-hallucinated',
    mappingStatus: 'MATCHED',
    mappingBadgeClass: 'mapping-badge-matched',
    confidence: 11,
    citedMeta: {
      title: 'Zero-Shot Quantum Hyper-Graphs for Autonomous Citation Verification',
      authors: 'M. Robertson, L. Walker',
      year: '2024',
      venue: 'Nature Machine Intelligence, Vol. 12',
      doi: '10.1038/s42256-024-99812-x',
    },
    retrievedMeta: null,
    fieldStatus: {
      title: 'missing',
      authors: 'mismatch',
      year: 'mismatch',
      venue: 'partial',
      doi: 'mismatch',
    },
    sources: [
      { name: 'Crossref', status: 'none', latency: '51ms', score: '0%' },
      { name: 'OpenAlex', status: 'none', latency: '63ms', score: '11%' },
      { name: 'PubMed / PMC', status: 'none', latency: '58ms', score: '0%' },
      { name: 'Semantic Scholar', status: 'none', latency: '79ms', score: '9%' },
    ],
    rules: [
      {
        code: 'R12_GHOST_DOI',
        name: 'Non-Existent DOI Handle',
        nameVi: 'Mã định danh DOI không tồn tại trên hệ thống quốc tế',
        condition: 'DOI 10.1038/s42256-024-99812-x returns HTTP 404 in Crossref/Handle',
        status: 'failed',
      },
      {
        code: 'R14_ZERO_TITLE_HIT',
        name: 'No Bibliographic Title Match Across 15+ APIs',
        nameVi: 'Không tìm thấy công trình trùng khớp trên 15+ CSDL học thuật',
        condition: 'max_similarity(title, all_candidates) == 0.11 < threshold (0.45)',
        status: 'failed',
      },
      {
        code: 'R16_SYNTHETIC_PATTERN',
        name: 'Fabricated Reference Signature',
        nameVi: 'Dấu hiệu ghép nối nhân tạo của trích dẫn ảo (AI Hallucination)',
        condition: 'Valid journal prefix (10.1038) paired with non-existent article suffix',
        status: 'failed',
      },
    ],
    explanation: {
      en: 'High-risk AI hallucination signature: Plausible journal prefix (Nature Machine Intelligence) combined with a fabricated DOI suffix and non-existent title.',
      vi: 'Dấu hiệu điển hình của trích dẫn ảo do AI tạo sinh: Ghép nối tiền tố của một tạp chí uy tín có thật (Nature Machine Intelligence) với dãy số DOI hư cấu và một tiêu đề bài báo hoàn toàn không tồn tại.',
    },
  },
  {
    id: 'cit-4',
    marker: '[4]',
    inText: 'Smith et al. (2021)',
    page: 'p. 14',
    contextBefore:
      'Cross-encoder re-ranking substantially improves top-1 candidate precision in noisy OCR documents, as demonstrated by ',
    contextAfter: '.',
    verdict: 'UNRESOLVED',
    verdictBadgeClass: 'verdict-badge-unresolved',
    mappingStatus: 'MISSING_REFERENCE',
    mappingBadgeClass: 'mapping-badge-missing',
    confidence: 0,
    citedMeta: {
      title: '[Missing from Bibliography Section]',
      authors: 'Smith et al.',
      year: '2021',
      venue: '—',
      doi: '—',
    },
    retrievedMeta: null,
    fieldStatus: {
      title: 'missing',
      authors: 'partial',
      year: 'partial',
      venue: 'missing',
      doi: 'missing',
    },
    sources: [
      { name: 'GROBID TEI Linker', status: 'none', latency: '4ms', score: 'Unlinked' },
      { name: 'Regex Cross-Validator', status: 'none', latency: '2ms', score: 'Orphan' },
    ],
    rules: [
      {
        code: 'L1_MISSING_BIB_ENTRY',
        name: 'In-Text Citation Without Bibliography Target',
        nameVi: 'Trích dẫn trong bài bị khuyết mục tài liệu tham khảo tương ứng',
        condition: 'in_text("Smith et al., 2021") has no matching biblStruct in References',
        status: 'failed',
      },
      {
        code: 'R00_PRECONDITION_HALT',
        name: 'Layer 2 Deferred Pending Reference Metadata',
        nameVi: 'Tạm hoãn xác thực Tầng 2 do thiếu thông tin thư mục gốc',
        condition: 'IF reference_entry == NULL → UNRESOLVED (Requires Bibliography Entry)',
        status: 'warning',
      },
    ],
    explanation: {
      en: 'Layer 1 Consistency Error: Cited in body text on page 14, but corresponding entry is missing from the Bibliography section.',
      vi: 'Lỗi thiếu nhất quán nội bộ (Tầng 1): Tài liệu được viện dẫn trực tiếp trong phần thân bài tại trang 14, nhưng lại bị bỏ sót hoàn toàn trong Danh mục Tài liệu tham khảo cuối bài.',
    },
  },
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

export function LandingPage() {
  const { i18n } = useTranslation();
  const lang: Lang = i18n.language?.startsWith('vi') ? 'vi' : 'en';
  const auth = useContext(AuthContext);
  const isAuthenticated = auth
    ? Boolean(
        auth.user ||
          (auth.isLoading && typeof window !== 'undefined' && localStorage.getItem('token')),
      )
    : typeof window !== 'undefined' && Boolean(localStorage.getItem('token'));

  const toggleLanguage = () => {
    const next = lang === 'en' ? 'vi' : 'en';
    void i18n.changeLanguage(next);
  };

  return (
    <div
      lang={lang}
      data-lang={lang}
      className="solva-editorial-root min-h-screen overflow-x-clip selection:bg-[#1C1A15] selection:text-[#FBFAF6]"
    >
      <SolvaHeader
        lang={lang}
        onToggleLanguage={toggleLanguage}
        isAuthenticated={isAuthenticated}
      />
      <main id="main-content">
        <SolvaHeroSection lang={lang} isAuthenticated={isAuthenticated} />
        <SolvaFilmSection lang={lang} />
        <SolvaFeaturesSection lang={lang} />
        <SolvaStickySection lang={lang} isAuthenticated={isAuthenticated} />
        <SolvaInteractiveDebuggerSection lang={lang} />
        <SolvaUseCasesSection lang={lang} isAuthenticated={isAuthenticated} />
        <SolvaBenchmark120KSection lang={lang} />
        <SolvaClientResultsSection lang={lang} />
        <SolvaSecuritySection lang={lang} />
        <SolvaTaxonomyPricingSection lang={lang} isAuthenticated={isAuthenticated} />
        <SolvaRoleTestimonialsSection lang={lang} />
        <SolvaFAQSection lang={lang} />
        <SolvaBottomCTASection lang={lang} isAuthenticated={isAuthenticated} />
      </main>
      <SolvaFooter lang={lang} />
    </div>
  );
}

/* ============================================================
   SECTION 0: FIXED SOLVA NAVBAR (`76px` height, Portal Dropdown)
   ============================================================ */
function SolvaHeader({
  lang,
  onToggleLanguage,
  isAuthenticated,
}: {
  lang: Lang;
  onToggleLanguage: () => void;
  isAuthenticated: boolean;
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
            desc: 'Tách biệt Mapping nội bộ & xác thực nguồn gốc',
            href: '#architecture',
            icon: Layers,
          },
          {
            title: 'Trình thẩm định trích dẫn',
            desc: `Đối chiếu thư mục & bộ quy tắc ${SYMBOLIC_RULES_RANGE}`,
            href: '#interactive-demo',
            icon: FileSearch,
          },
          {
            title: 'Quy trình 4 giai đoạn',
            desc: 'Từ phân tích GROBID TEI đến ngữ nghĩa NLI',
            href: '#how-it-works',
            icon: GitBranch,
          },
          {
            title: 'Thực nghiệm 120K bài báo',
            desc: 'Độ chính xác 98,6% · Bắt trọn 100% trích dẫn ảo',
            href: '#benchmark-120k',
            icon: Sparkles,
          },
          {
            title: 'Không gian 3 vai trò',
            desc: 'Thiết kế riêng cho Sinh viên, Giảng viên & Quản trị',
            href: '#workspaces',
            icon: Users,
          },
        ]
      : [
          {
            title: '2-Layer Architecture',
            desc: 'Orthogonal Mapping & Verification',
            href: '#architecture',
            icon: Layers,
          },
          {
            title: 'Citation Debugger',
            desc: `Live metadata diff & rules ${SYMBOLIC_RULES_RANGE}`,
            href: '#interactive-demo',
            icon: FileSearch,
          },
          {
            title: 'Verification Pipeline',
            desc: 'GROBID TEI to DeBERTa NLI stance',
            href: '#how-it-works',
            icon: GitBranch,
          },
          {
            title: '120K-Paper Benchmark',
            desc: '98.6% Acc · 100% Hallucination F1 · 0.043 ECE',
            href: '#benchmark-120k',
            icon: Sparkles,
          },
          {
            title: 'Role Workspaces',
            desc: 'Student, Teacher & Admin views',
            href: '#workspaces',
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
      <div className="max-w-[1280px] mx-auto px-5 sm:px-6 lg:px-8 xl:px-[40px] h-[64px] lg:h-[76px] flex items-center justify-between gap-2 xl:gap-4">
        {/* Left: Brand Logo */}
        <div className="flex items-center shrink-0">
          <Link
            to="/"
            onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
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
        </div>

        {/* Center: Solva Navigation Links + Dropdown */}
        <nav
          aria-label="Primary Navigation"
          className="hidden lg:flex items-center justify-center flex-1 min-w-0 gap-0.5 xl:gap-1"
        >
          {/* Dropdown Trigger (`Platform v` / `Kiến trúc v`) */}
          <div
            className="relative"
            onMouseLeave={() => setDropdownOpen(false)}
          >
            <button
              type="button"
              onClick={() => setDropdownOpen((prev) => !prev)}
              aria-expanded={dropdownOpen}
              style={{ color: 'var(--solva-muted)' }}
              className="inline-flex items-center gap-[5px] h-[44px] px-2 xl:px-[10px] rounded-[8px] font-solva-sans text-[14px] xl:text-[15px] font-normal whitespace-nowrap hover:opacity-80 transition-opacity cursor-pointer"
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
            href="#interactive-demo"
            style={{ color: 'var(--solva-muted)' }}
            className="inline-flex items-center h-[44px] px-2 xl:px-[10px] rounded-[8px] font-solva-sans text-[14px] xl:text-[15px] font-normal whitespace-nowrap hover:opacity-80 transition-opacity"
          >
            {lang === 'vi' ? 'Trình thẩm định' : 'Inspector'}
          </a>

          <a
            href="#how-it-works"
            style={{ color: 'var(--solva-muted)' }}
            className="inline-flex items-center h-[44px] px-2 xl:px-[10px] rounded-[8px] font-solva-sans text-[14px] xl:text-[15px] font-normal whitespace-nowrap hover:opacity-80 transition-opacity"
          >
            {lang === 'vi' ? 'Quy trình' : 'Pipeline'}
          </a>

          <a
            href="#benchmark-120k"
            style={{ color: 'var(--solva-muted)' }}
            className="inline-flex items-center gap-1.5 h-[44px] px-2 xl:px-[10px] rounded-[8px] font-solva-sans text-[14px] xl:text-[15px] font-normal whitespace-nowrap hover:opacity-80 transition-opacity"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            <span>{lang === 'vi' ? 'Thực nghiệm 120K' : '120K Benchmark'}</span>
          </a>

          <a
            href="#taxonomy"
            style={{ color: 'var(--solva-muted)' }}
            className="inline-flex items-center h-[44px] px-2 xl:px-[10px] rounded-[8px] font-solva-sans text-[14px] xl:text-[15px] font-normal whitespace-nowrap hover:opacity-80 transition-opacity"
          >
            {lang === 'vi' ? 'Gói dịch vụ' : 'Taxonomy'}
          </a>

          <Link
            to="/pricing"
            data-testid="landing-pricing-link"
            style={{ color: 'var(--solva-muted)' }}
            className="inline-flex items-center h-[44px] px-2 xl:px-[10px] rounded-[8px] font-solva-sans text-[14px] xl:text-[15px] font-normal whitespace-nowrap hover:opacity-80 transition-opacity"
          >
            {lang === 'vi' ? 'Bảng giá' : 'Pricing'}
          </Link>
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
            to={isAuthenticated ? '/dashboard' : '/login'}
            style={{ color: 'var(--solva-muted)' }}
            className="hidden sm:inline-flex items-center h-[44px] px-[10px] xl:px-[12px] rounded-[8px] font-solva-sans text-[15px] font-normal whitespace-nowrap hover:opacity-80 transition-opacity"
          >
            {lang === 'vi' ? 'Đăng nhập' : 'Sign in'}
          </Link>

          <SolvaButton
            to={isAuthenticated ? '/dashboard' : '/login'}
            variant="primary"
            className="hidden sm:inline-flex"
          >
            {isAuthenticated
              ? lang === 'vi'
                ? 'Vào Không gian'
                : 'Open Workspace'
              : lang === 'vi'
                ? 'Trải nghiệm miễn phí'
                : 'Try CITRA Free'}
          </SolvaButton>

          {/* Mobile Hamburger Button (Solva 2-bar minimalist style) */}
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
          aria-label="Mobile Navigation"
          style={{
            backgroundColor: 'var(--solva-bg)',
            borderColor: 'var(--solva-border)',
          }}
          className="lg:hidden border-t border-b px-5 py-4 space-y-2 shadow-lg animate-debugger-switch"
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            {[
              {
                label: lang === 'vi' ? 'Kiến trúc 2 tầng' : '2-Layer Architecture',
                href: '#architecture',
              },
              {
                label: lang === 'vi' ? 'Trình thẩm định trích dẫn' : 'Interactive Inspector',
                href: '#interactive-demo',
              },
              {
                label: lang === 'vi' ? 'Quy trình 4 giai đoạn' : 'Verification Pipeline',
                href: '#how-it-works',
              },
              {
                label: lang === 'vi' ? 'Thực nghiệm 120K bài báo' : '120K-Paper Benchmark',
                href: '#benchmark-120k',
              },
              {
                label: lang === 'vi' ? 'Gói dịch vụ & Quyền lợi' : 'Verdict Taxonomy',
                href: '#taxonomy',
              },
              {
                label: lang === 'vi' ? 'Không gian 3 vai trò' : 'Role Workspaces',
                href: '#workspaces',
              },
              {
                label: lang === 'vi' ? 'Giải đáp thắc mắc' : 'FAQ',
                href: '#faq',
              },
            ].map((item) => (
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
                <span>{item.label}</span>
                <ChevronRight className="w-4 h-4 opacity-60" />
              </a>
            ))}
          </div>

          <div className="pt-2 flex items-center gap-2">
            <SolvaButton
              to={isAuthenticated ? '/dashboard' : '/login'}
              variant="outline"
              fullWidth
              onClick={() => setMobileMenuOpen(false)}
            >
              {lang === 'vi' ? 'Đăng nhập' : 'Sign in'}
            </SolvaButton>
            <SolvaButton
              to={isAuthenticated ? '/dashboard' : '/register'}
              variant="primary"
              fullWidth
              onClick={() => setMobileMenuOpen(false)}
            >
              {lang === 'vi' ? 'Trải nghiệm miễn phí' : 'Try CITRA Free'}
            </SolvaButton>
          </div>
        </nav>
      )}
    </header>
  );
}

/* ============================================================
   SECTION 1: HERO SECTION (`#hero`)
   2-Column Split + Painterly Oil Frame + Infinite API Ticker
   ============================================================ */
function SolvaHeroSection({
  lang,
  isAuthenticated,
}: {
  lang: Lang;
  isAuthenticated: boolean;
}) {
  const [activeStep, setActiveStep] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setActiveStep((prev) => (prev + 1) % 3);
    }, 3200);
    return () => window.clearInterval(timer);
  }, [activeStep]);

  const scholarlyApis = [
    'Crossref',
    'OpenAlex',
    'Semantic Scholar',
    'PubMed NCBI',
    'arXiv',
    'Europe PMC',
    'DBLP',
    'DOAJ',
    'ORCID',
    'Unpaywall',
    'DataCite',
    'GROBID TEI',
  ];

  return (
    <section
      id="hero"
      className="pt-[76px] sm:pt-[88px] lg:pt-[136px] pb-[24px] sm:pb-[36px] lg:pb-[64px] px-5 sm:px-6 lg:px-[40px]"
    >
      <div className="max-w-[1200px] mx-auto flex flex-col gap-[28px] sm:gap-[36px] lg:gap-[56px]">
        {/* Top 2-Column Content */}
        <div className="flex flex-col lg:flex-row items-center justify-between gap-[28px] sm:gap-[32px] lg:gap-[24px] pt-0 lg:pt-[12px]">
          {/* Left Column (540px on Desktop) */}
          <div className="w-full lg:w-[516px] xl:w-[540px] flex flex-col items-start gap-[22px] sm:gap-[28px] lg:gap-[32px] lg:pb-[24px]">
            <div className="flex flex-col items-start gap-[16px] sm:gap-[20px] lg:gap-[24px]">
              {/* Announcement Badge (`VERIFIED 120K BENCHMARK | 98.6% Acc · 100% Hallucination F1 ->`) */}
              <SolvaScrollReveal delayMs={40} yOffset={20} blurPx={3}>
                <a
                  href="#benchmark-120k"
                  className="group inline-flex flex-wrap items-center gap-[8px] font-solva-sans"
                >
                  <span
                    style={{
                      backgroundColor: 'var(--solva-surface)',
                      color: 'var(--solva-ink)',
                    }}
                    className="inline-flex items-center gap-1.5 px-[7px] pt-[5px] pb-[4px] rounded-[5px] text-[11px] font-mono font-semibold leading-[12px] border border-[#E7E3D9] dark:border-[#332F26]"
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    {lang === 'vi' ? 'THỰC NGHIỆM 120K' : '120K BENCHMARK'}
                  </span>
                  <span
                    style={{ color: 'var(--solva-muted)' }}
                    className="text-[14px] sm:text-[15px] font-normal leading-[21px] group-hover:underline"
                  >
                    {lang === 'vi'
                      ? 'Kiểm định trên 120.000 công trình · Độ chính xác 98,6% · Bắt trọn 100% trích dẫn ảo'
                      : 'Validated on 120,000 papers · 98.6% Acc · 100% Hallucination F1'}
                  </span>
                  <ArrowRight
                    style={{ color: 'var(--solva-muted)' }}
                    className="w-[14px] h-[14px] transition-transform duration-200 group-hover:translate-x-0.5 shrink-0"
                  />
                </a>
              </SolvaScrollReveal>

              {/* H1 Two-Tone Editorial Split */}
              <SolvaTwoToneHeading
                as="h1"
                size="h1"
                delayMs={85}
                primary={
                  lang === 'vi'
                    ? 'Trợ lý thẩm định trích dẫn'
                    : 'The citation copilot'
                }
                secondary={
                  lang === 'vi'
                    ? 'bảo chứng sự thật cho từng trang viết.'
                    : 'that never hallucinates.'
                }
              />

              {/* Subtitle (400px–430px max-width, Onest 18px Regular) */}
              <SolvaScrollReveal delayMs={190} yOffset={24} blurPx={3.5}>
                <p
                  style={{ color: 'var(--solva-muted)' }}
                  className="font-solva-sans text-[17px] sm:text-[18px] font-normal leading-[25.2px] max-w-[430px]"
                >
                  {lang === 'vi'
                    ? 'Từ bản thảo PDF thô đến báo cáo thẩm định hoàn chỉnh: CITRA tự động nhận diện từng trích dẫn, đối chiếu chéo qua hơn 15 cơ sở dữ liệu học thuật quốc tế và lý giải minh bạch căn cứ của mọi kết luận.'
                    : 'CITRA parses every citation in your PDF manuscript, cross-verifies metadata across 15+ scholarly indexes, and explains every rule trace.'}
                </p>
              </SolvaScrollReveal>
            </div>

            {/* CTA Buttons */}
            <SolvaScrollReveal delayMs={260} yOffset={24} blurPx={3}>
              <div className="flex flex-wrap items-center gap-3">
                <SolvaButton
                  to={isAuthenticated ? '/upload' : '/login'}
                  variant="primary"
                >
                  {isAuthenticated
                    ? lang === 'vi'
                      ? 'Thẩm định bản thảo PDF'
                      : 'Verify Manuscript PDF'
                    : lang === 'vi'
                      ? 'Trải nghiệm CITRA miễn phí'
                      : 'Try CITRA Free'}
                </SolvaButton>
                <SolvaButton href="#interactive-demo" variant="outline">
                  {lang === 'vi' ? 'Khám phá Trình thẩm định' : 'Live Citation Debugger'}
                </SolvaButton>
              </div>
            </SolvaScrollReveal>

            {/* Hero Verified 120K-Paper Benchmark Proof Strip */}
            <SolvaScrollReveal delayMs={310} yOffset={20} blurPx={2.5} className="w-full">
              <a
                href="#benchmark-120k"
                data-testid="hero-benchmark-120k-strip"
                style={{
                  backgroundColor: 'var(--solva-surface)',
                  borderColor: 'var(--solva-border)',
                }}
                className="group block w-full rounded-[12px] border p-3 sm:p-3.5 transition-all duration-200 hover:border-[#1C1A15]/40 dark:hover:border-[#FBFAF6]/30"
              >
                <div className="flex items-center justify-between gap-2 mb-2">
                  <span
                    style={{ color: 'var(--solva-ink)' }}
                    className="inline-flex items-center gap-1.5 font-mono text-[10px] sm:text-[11px] font-semibold uppercase tracking-wider"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                    <span>
                      {lang === 'vi'
                        ? 'BẢO CHỨNG THỰC NGHIỆM · KIỂM ĐỊNH 120.000 CÔNG TRÌNH'
                        : 'VERIFIED EMPIRICAL BENCHMARK · 120,000 PAPERS'}
                    </span>
                  </span>
                  <span
                    style={{ color: 'var(--solva-muted)' }}
                    className="font-mono text-[10px] inline-flex items-center gap-1 shrink-0 group-hover:underline"
                  >
                    <span>{lang === 'vi' ? 'Xem báo cáo' : 'Full report'}</span>
                    <ArrowRight className="w-3 h-3 transition-transform duration-200 group-hover:translate-x-0.5" />
                  </span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-[#E7E3D9] dark:border-[#332F26]">
                  <div>
                    <div
                      style={{ color: 'var(--solva-ink)' }}
                      className="font-solva-serif text-[20px] sm:text-[22px] leading-none tracking-[-0.04em]"
                    >
                      120,000
                    </div>
                    <div
                      style={{ color: 'var(--solva-muted)' }}
                      className="font-mono text-[10px] mt-1 truncate"
                    >
                      {lang === 'vi' ? 'Công trình · 0% rò rỉ' : 'Papers · 0% leakage'}
                    </div>
                  </div>
                  <div>
                    <div className="font-solva-serif text-[20px] sm:text-[22px] leading-none tracking-[-0.04em] text-emerald-700 dark:text-emerald-400">
                      98.58%
                    </div>
                    <div
                      style={{ color: 'var(--solva-muted)' }}
                      className="font-mono text-[10px] mt-1 truncate"
                    >
                      {lang === 'vi' ? 'Độ chính xác thẩm định' : 'Neuro-Symbolic Acc'}
                    </div>
                  </div>
                  <div>
                    <div className="font-solva-serif text-[20px] sm:text-[22px] leading-none tracking-[-0.04em] text-emerald-700 dark:text-emerald-400">
                      100.0%
                    </div>
                    <div
                      style={{ color: 'var(--solva-muted)' }}
                      className="font-mono text-[10px] mt-1 truncate"
                    >
                      {lang === 'vi' ? 'Bắt trọn trích dẫn ảo' : 'Hallucination F1'}
                    </div>
                  </div>
                  <div>
                    <div
                      style={{ color: 'var(--solva-ink)' }}
                      className="font-solva-serif text-[20px] sm:text-[22px] leading-none tracking-[-0.04em]"
                    >
                      0.0433
                    </div>
                    <div
                      style={{ color: 'var(--solva-muted)' }}
                      className="font-mono text-[10px] mt-1 truncate"
                    >
                      {lang === 'vi' ? 'Sai số ECE (↓4,9×)' : 'Platt ECE (↓4.9×)'}
                    </div>
                  </div>
                </div>
              </a>
            </SolvaScrollReveal>
          </div>

          {/* Right Column: Painterly Mockup Frame (`660x521px` on Desktop) */}
          <SolvaScrollReveal
            delayMs={150}
            yOffset={36}
            scaleFrom={0.975}
            blurPx={4}
            className="w-full lg:w-[660px] shrink-0"
          >
            <SolvaPainterlyFrame
              paintingSrc="/solva/hero-bg.webp"
              priority
              alt="Impressionist wildflower meadow oil painting backdrop"
              className="w-full min-h-[420px] sm:min-h-[490px] lg:h-[521px] p-4 sm:p-8 lg:p-0"
            >
              <div className="lg:absolute lg:top-[52px] lg:left-[52px] lg:right-[-24px]">
                <HeroVerificationMockup
                  lang={lang}
                  activeStep={activeStep}
                  onSelectStep={setActiveStep}
                />
              </div>
            </SolvaPainterlyFrame>
          </SolvaScrollReveal>
        </div>

        {/* Bottom Infinite Edge-Masked Scholarly API Ticker (`1200x112px`) */}
        <SolvaScrollReveal delayMs={320} yOffset={20} blurPx={2.5} triggerRatio={0.99}>
          <div
            data-testid="hero-scholarly-ticker"
            className="w-full py-[10px] sm:py-[16px] lg:py-[32px] overflow-hidden solva-ticker-mask"
          >
            <div className="animate-solva-marquee flex items-center gap-[44px] sm:gap-[64px] lg:gap-[72px]">
              {[...scholarlyApis, ...scholarlyApis].map((apiName, idx) => {
                const href = getScholarlySourceUrl(apiName) ?? '#';
                const slug = apiName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
                return (
                  <a
                    key={`${apiName}-${idx}`}
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`${apiName} official website`}
                    title={`${apiName} (${href.replace(/^https?:\/\//, '')})`}
                    data-testid={`hero-ticker-logo-${slug}-${idx}`}
                    onClick={(e) => e.currentTarget.blur()}
                    style={{ color: 'var(--solva-ink)' }}
                    className="group inline-flex items-center gap-2.5 px-2.5 py-2 -mx-2.5 -my-1.5 rounded-[8px] shrink-0 select-none cursor-pointer opacity-80 hover:opacity-100 active:opacity-100 focus-visible:opacity-100 hover:-translate-y-[1px] active:scale-[0.98] transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1C1A15]/30 dark:focus-visible:ring-[#FBFAF6]/30"
                  >
                    <ScholarlySourceLogo
                      name={apiName}
                      size={20}
                      className="opacity-90 group-hover:opacity-100 transition-opacity"
                    />
                    <span className="font-solva-sans text-[17px] sm:text-[18px] font-medium tracking-[-0.03em] whitespace-nowrap group-hover:underline underline-offset-4 decoration-[#1C1A15]/35 dark:decoration-[#FBFAF6]/35">
                      {apiName}
                    </span>
                  </a>
                );
              })}
            </div>
          </div>
        </SolvaScrollReveal>
      </div>
    </section>
  );
}

/* ============================================================
   SECTION 1.5: VERIFIED 120,000-PAPER BENCHMARK SPOTLIGHT (`#benchmark-120k`)
   Highlights the Empirical Neuro-Symbolic Benchmark, Ablation Study,
   Per-Class Zero-False-Accusation Guardrails & Platt Calibration
   ============================================================ */
function SolvaBenchmark120KSection({ lang }: { lang: Lang }) {
  const [activeView, setActiveView] = useState<'ablation' | 'classes' | 'calibration'>('ablation');
  const { containerRef: benchRef, replaySeed: benchSeed } = useFloralCardAnimation(5600);
  const sep = lang === 'vi' ? '.' : ',';

  const headlineMetrics = [
    {
      badge: lang === 'vi' ? '0% RÒ RỈ DỮ LIỆU · PAPER-DISJOINT' : '0% LEAKAGE · PAPER-DISJOINT',
      badgeTone: 'neutral' as const,
      value: 120000,
      decimals: 0,
      suffix: '',
      formatThousands: true,
      title:
        lang === 'vi'
          ? 'Công trình khoa học độc lập'
          : 'Distinct scholarly papers',
      desc:
        lang === 'vi'
          ? 'Phân tách độc lập tuyệt đối giữa 84.000 bài huấn luyện, 18.000 bài thẩm định và 18.000 bài kiểm thử độc lập (|Train ∩ Val ∩ Test| = 0) trước khi tạo biến nhiễu. Mã hóa 323.848 văn bản thực bằng Sentence-BERT.'
          : 'Strict 84,000 Train · 18,000 Val · 18,000 Held-Out Test partitioning (|Train ∩ Val ∩ Test| = 0) prior to perturbation. 323,848 unique texts encoded via Sentence-BERT.',
    },
    {
      badge: 'MACRO-F1: 0.9764 – 0.9979',
      badgeTone: 'emerald' as const,
      value: 98.58,
      decimals: 2,
      suffix: '%',
      formatThousands: false,
      title:
        lang === 'vi'
          ? 'Độ chính xác Neuro-Symbolic (Đạt tới 99.86%)'
          : 'Neuro-Symbolic Accuracy (Up to 99.86%)',
      desc:
        lang === 'vi'
          ? 'Kiến trúc Neuro-Symbolic đề xuất đạt 98.58% Accuracy (Macro-F1 0.9764) và bộ chấm điểm lai HybridMLScorer 16 chiều (C=5.0) chạm mốc 99.86% (Macro-F1 0.9979), bỏ xa phương pháp thuần biểu diễn nhúng SBERT (64.85%).'
          : 'Proposed Neuro-Symbolic engine reaches 98.58% Accuracy (0.9764 Macro-F1) and 16D HybridMLScorer (C=5.0) reaches 99.86% (0.9979 F1), far surpassing pure SBERT (64.85%).',
    },
    {
      badge: lang === 'vi' ? '0% KẾT LUẬN OAN CHO BÀI THẬT' : '0% FALSE ACCUSATIONS',
      badgeTone: 'emerald' as const,
      value: 100.0,
      decimals: 1,
      suffix: '%',
      formatThousands: false,
      title:
        lang === 'vi'
          ? 'Độ chuẩn xác nhận diện trích dẫn ngụy tạo (F1 = 1.0000)'
          : 'Hallucination Detection Precision & Recall (F1 = 1.0000)',
      desc:
        lang === 'vi'
          ? 'Nhận diện trọn vẹn 5.400 / 5.400 trích dẫn bịa đặt hoặc chắp vá tinh vi trên tập kiểm thử độc lập mà không kết luận oan bất kỳ công trình chân xác nào. Nhãn VERIFIED đạt độ chuẩn xác tuyệt đối 100% (6.480 mẫu).'
          : 'Catches 5,400 / 5,400 fabricated and chimeric LLM citations on the 18,000-paper test split with 0 false accusations on legitimate works and 100% VERIFIED precision.',
    },
    {
      badge: '↓ 4.9× ECE · ↓ 8.4× BRIER',
      badgeTone: 'amber' as const,
      value: 0.0433,
      decimals: 4,
      suffix: '',
      formatThousands: false,
      title:
        lang === 'vi'
          ? 'Sai số hiệu chỉnh xác suất ECE (Brier = 0.0095)'
          : 'Expected Calibration Error ECE (Brier = 0.0095)',
      desc:
        lang === 'vi'
          ? 'Hiệu chỉnh hậu nghiệm Logit-Space Platt Scaling (a = 2.1621, b = 0.6299) giúp kéo giảm 4,9 lần sai số ECE (từ 0.2135 xuống 0.0433), đưa độ chính xác thực tế lên mức 99.99% ở ngưỡng bao phủ 90%.'
          : 'Post-hoc Logit-Space Platt Scaling (a = 2.1621, b = 0.6299) cuts ECE by 4.9× (0.2135 → 0.0433) and Brier by 8.4× (0.0794 → 0.0095), reaching 99.99% accuracy @ 90% coverage.',
    },
  ];

  const ablationBaselines = [
    {
      code: 'B0 · doi_only',
      name:
        lang === 'vi'
          ? 'Chỉ đối chiếu định danh DOI tuyệt đối'
          : 'Exact DOI resolution only',
      note:
        lang === 'vi'
          ? 'Bỏ lọt toàn bộ bài báo hội nghị và sách chuyên khảo không đăng ký mã DOI'
          : 'Misses valid conference papers & books without DOIs',
      acc: 30.19,
      prec: '0.2233',
      rec: '0.3764',
      f1: '0.2184',
      highlight: false,
    },
    {
      code: 'B3 · embedding_only',
      name:
        lang === 'vi'
          ? 'Thuần tương đồng ngữ nghĩa Sentence-BERT trên tiêu đề'
          : 'Pure Sentence-BERT cosine threshold on title',
      note:
        lang === 'vi'
          ? 'Dễ dàng bị qua mặt bởi tiêu đề AI chắp vá từ khóa (chimeric) và làm ngơ sai lệch năm xuất bản'
          : 'Fooled by plausible chimeric LLM titles; ignores year & author drift',
      acc: 64.85,
      prec: '0.4500',
      rec: '0.5078',
      f1: '0.4559',
      highlight: false,
    },
    {
      code: 'B1 · single_source_crossref',
      name:
        lang === 'vi'
          ? 'Tra cứu đơn nguồn (chỉ truy vấn Crossref)'
          : 'Single-source lookup (Crossref only)',
      note:
        lang === 'vi'
          ? 'Khuyết thiếu kho bản thảo arXiv, kỷ yếu DBLP/ACL, sách chuyên khảo OpenLibrary và y sinh Europe PMC'
          : 'Lacks arXiv preprints, DBLP CS proceedings, OpenLibrary & Europe PMC',
      acc: 69.66,
      prec: '0.5559',
      rec: '0.5684',
      f1: '0.5339',
      highlight: false,
    },
    {
      code: 'B4 · no_calibration',
      name:
        lang === 'vi'
          ? 'Tổ hợp tuyến tính đa đặc trưng (Không khoanh vùng nghi vấn)'
          : 'Linear multi-feature scorer without abstention band',
      note:
        lang === 'vi'
          ? 'Cưỡng ép ra phán quyết cứng ở vùng ranh giới nhạy cảm [0.40, 0.60], dẫn tới rủi ro kết luận sai'
          : 'Forces hard verdicts in borderline [0.40, 0.60] cases',
      acc: 77.29,
      prec: '0.5770',
      rec: '0.6359',
      f1: '0.5996',
      highlight: false,
    },
    {
      code: 'B2 · fuzzy_only',
      name:
        lang === 'vi'
          ? 'So khớp từ vựng RapidFuzz tiêu đề kết hợp AuthorJaccard'
          : 'Lexical RapidFuzz title + AuthorJaccard only',
      note:
        lang === 'vi'
          ? 'Thiếu khả năng kiểm chứng ngữ nghĩa câu trích dẫn với tóm tắt bài gốc và không kiểm tra liên kết sống'
          : 'No sentence-level abstract entailment or active HTTP/DOI link checks',
      acc: 78.28,
      prec: '0.5959',
      rec: '0.6472',
      f1: '0.6131',
      highlight: false,
    },
    {
      code: 'Proposed · Neuro-Symbolic',
      name:
        lang === 'vi'
          ? `CITRA Neuro-Symbolic (Đa nguồn + Đối sánh Tóm tắt + ${SYMBOLIC_RULES_COUNT} Luật + Khoanh vùng Nghi vấn)`
          : `CITRA Neuro-Symbolic (Multi-Source + Abstract Evidence + ${SYMBOLIC_RULES_COUNT} Rules + Abstention)`,
      note:
        lang === 'vi'
          ? 'Giải trình tường minh từng quy tắc · Đạt chuẩn xác tuyệt đối 100% trên cả VERIFIED và HALLUCINATION'
          : 'Full rule-level explainability · 100% Precision on VERIFIED & HALLUCINATION',
      acc: 98.58,
      prec: '0.9848',
      rec: '0.9704',
      f1: '0.9764',
      highlight: true,
    },
    {
      code: 'B5 · HybridMLScorer (16D)',
      name:
        lang === 'vi'
          ? 'HybridMLScorer 16 chiều (Hồi quy Logistic Đa thức, C = 5.0)'
          : '16D HybridMLScorer (Multinomial Logistic Regression, C = 5.0)',
      note:
        lang === 'vi'
          ? 'Nắm bắt tương tác phi tuyến giữa các trường (title×author, title×year, doi_mismatch_title)'
          : 'Non-linear interaction features (title×author, title×year, doi_mismatch_title)',
      acc: 99.86,
      prec: '0.9982',
      rec: '0.9976',
      f1: '0.9979',
      highlight: true,
    },
  ];

  const classPerformance = [
    {
      label: 'VERIFIED',
      subtypes: 'V1 – V4',
      totalSamples: '43,200 (36%)',
      testSupport: '6,480',
      precision: '1.0000 (100%)',
      recall: '0.9742 (97.4%)',
      f1: '0.9869',
      tone: 'emerald' as const,
      desc:
        lang === 'vi'
          ? 'Khớp nguyên bản tuyệt đối (V1), viết tắt et al. hoặc chênh ±1 năm giữa bản thảo tiền ấn phẩm và bản in chính thức (V2), lược phụ đề (V3), hay lỗi nhận dạng ký tự OCR được cứu hộ nhờ đối sánh ngữ nghĩa phần tóm tắt (V4). Không một trích dẫn giả mạo nào có thể lọt qua nhãn VERIFIED.'
          : 'Exact canonical match (V1), et al./±1yr preprint drift (V2), subtitle truncation (V3), OCR noise rescued by abstract alignment (V4). Zero fabricated papers ever marked VERIFIED.',
    },
    {
      label: 'SUSPECTED_HALLUCINATION',
      subtypes: 'H1 – H4',
      totalSamples: '36,000 (30%)',
      testSupport: '5,400',
      precision: '1.0000 (100%)',
      recall: '1.0000 (100%)',
      f1: '1.0000',
      tone: 'red' as const,
      desc:
        lang === 'vi'
          ? 'Ngụy tạo hoàn toàn không tồn tại trên bất kỳ thư mục nào (H1), chắp vá từ khóa tinh vi kiểu chimeric (H2), bịa đặt mã định danh DOI 10.9999/* (H3), hoặc dẫn liên kết chết HTTP 404 / mâu thuẫn hoàn toàn với nội dung tóm tắt (H4). Phát hiện trọn vẹn 5.400/5.400 mẫu, 0 trường hợp kết luận oan.'
          : 'Complete fabrication (H1), chimeric keyword synthesis (H2), fabricated DOI handles (H3), dead HTTP 404 URLs or severe abstract contradiction (H4). 5,400/5,400 caught with 0 false accusations.',
    },
    {
      label: 'METADATA_ERROR',
      subtypes: 'M1 – M5',
      totalSamples: '26,400 (22%)',
      testSupport: '3,960',
      precision: '0.9337 (93.4%)',
      recall: '0.9394 (93.9%)',
      f1: '0.9366',
      tone: 'amber' as const,
      desc:
        lang === 'vi'
          ? 'Công trình thực sự tồn tại nhưng bị ghi lệch năm công bố |Δyear| ≥ 2 (M1), nhầm lẫn danh sách đồng tác giả (M2), mã DOI hợp lệ nhưng tiêu đề bị biến dạng (M3), chỉ khớp một phần trên đơn nguồn (M4), hoặc sai lệch đồng thời nhiều trường thư mục (M5).'
          : 'Real work exists but cited with wrong publication year |Δyear| ≥ 2 (M1), swapped co-authors (M2), valid DOI with deformed title (M3), partial single-source match (M4), or multi-field drift (M5).',
    },
    {
      label: 'UNRESOLVED (Abstention)',
      subtypes: 'U1 – U2',
      totalSamples: '14,400 (12%)',
      testSupport: '2,160',
      precision: '0.8945 (89.5%)',
      recall: '0.9537 (95.4%)',
      f1: '0.9231',
      tone: 'slate' as const,
      desc:
        lang === 'vi'
          ? 'Các tài liệu nằm trong vùng ranh giới mờ [0.40, 0.60] và thiếu định danh DOI (U1, U2). Hệ thống chủ động kiềm chế không đưa ra phán quyết võ đoán mà khoanh vùng riêng để giảng viên hoặc hội đồng trực tiếp thẩm định.'
          : 'Borderline candidates in the [0.40, 0.60] gray zone without DOIs (U1, U2). Safely abstains from hard judgment and routes to human-in-the-loop faculty review.',
    },
  ];

  return (
    <section
      id="benchmark-120k"
      data-testid="benchmark-120k-section"
      className="scroll-mt-[84px] lg:scroll-mt-[108px] py-[36px] sm:py-[52px] lg:py-[96px] px-5 sm:px-6 lg:px-[40px]"
    >
      <div
        ref={benchRef}
        className="max-w-[1200px] mx-auto flex flex-col gap-[28px] sm:gap-[36px] lg:gap-[56px]"
      >
        {/* Top Section Header + International Standards Provenance Pill */}
        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6">
          <div className="flex flex-col items-start gap-[12px] sm:gap-[16px] max-w-[680px]">
            <SolvaEyebrow>
              {lang === 'vi'
                ? 'Bảo chứng thực nghiệm · Kiểm định trên 120.000 công trình khoa học'
                : 'Verified System Highlight · 120,000-Paper Empirical Benchmark'}
            </SolvaEyebrow>
            <SolvaTwoToneHeading
              primary={
                lang === 'vi'
                  ? 'Được kiểm chứng trên 120.000 bài báo.'
                  : 'Proven across 120,000 papers.'
              }
              secondary={
                lang === 'vi'
                  ? 'Không rò rỉ dữ liệu. Không một lời kết tội oan.'
                  : 'Zero data leakage. Zero false accusations.'
              }
            />
          </div>

          <SolvaScrollReveal delayMs={80} yOffset={24} className="lg:max-w-[440px]">
            <div
              style={{
                backgroundColor: 'var(--solva-surface)',
                borderColor: 'var(--solva-border)',
              }}
              className="rounded-[12px] border p-3.5 sm:p-4 space-y-1.5"
            >
              <div className="flex items-center justify-between gap-2 font-mono text-[11px]">
                <span
                  style={{ color: 'var(--solva-ink)' }}
                  className="font-semibold inline-flex items-center gap-1.5"
                >
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  <span>
                    {lang === 'vi'
                      ? 'ĐẠT CHUẨN KIỂM ĐỊNH 0% RÒ RỈ DỮ LIỆU'
                      : 'ZERO-LEAKAGE AUDIT PASSED'}
                  </span>
                </span>
                <span style={{ color: 'var(--solva-muted)' }}>1,000× Bootstrap CI</span>
              </div>
              <p
                style={{ color: 'var(--solva-muted)' }}
                className="font-solva-sans text-[13px] leading-[19.5px]"
              >
                {lang === 'vi'
                  ? 'Thiết kế nghiêm ngặt theo chuẩn mực thẩm định quốc tế SciFact (EMNLP 2020), FEVER (NAACL 2018), ALCE (EMNLP 2023) và Platt Calibration (ICML 2017) từ tập dữ liệu 128.717 công trình thực tế.'
                  : 'Engineered to international verification standards — SciFact (EMNLP 2020), FEVER (NAACL 2018), ALCE (EMNLP 2023) & Platt Calibration (ICML 2017).'}
              </p>
            </div>
          </SolvaScrollReveal>
        </div>

        {/* 4 Highlighted Metric Cards (`120,000` · `98.58%` · `100.0%` · `0.0433`) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-[16px]">
          {headlineMetrics.map((item, idx) => (
            <SolvaScrollReveal
              key={item.title}
              delayMs={idx * 75}
              yOffset={30}
              className="h-full"
            >
              <div
                style={{
                  backgroundColor: 'var(--solva-surface)',
                  borderColor: 'var(--solva-border)',
                }}
                className="rounded-[14px] border p-[20px] sm:p-[24px] h-full flex flex-col justify-between gap-[20px]"
              >
                <div className="space-y-[14px]">
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={`px-2 py-0.5 rounded-[5px] font-mono text-[10px] font-semibold tracking-wide ${
                        item.badgeTone === 'emerald'
                          ? 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300'
                          : item.badgeTone === 'amber'
                            ? 'bg-amber-500/12 text-amber-700 dark:text-amber-300'
                            : 'bg-[#FBFAF6] dark:bg-[#141310] text-[#56524A] dark:text-[#A8A296]'
                      }`}
                    >
                      {item.badge}
                    </span>
                  </div>

                  <div
                    style={{ color: 'var(--solva-ink)' }}
                    className="font-solva-serif font-light text-[36px] sm:text-[42px] leading-[1.08] tracking-[-0.05em]"
                  >
                    <SolvaLiveNumber
                      value={item.value}
                      decimals={item.decimals}
                      suffix={item.suffix}
                      formatThousands={item.formatThousands}
                      thousandSeparator={sep}
                      replaySeed={benchSeed}
                      durationMs={1400 + idx * 120}
                    />
                  </div>

                  <h3
                    style={{ color: 'var(--solva-ink)' }}
                    className="font-solva-sans text-[16px] sm:text-[17px] font-medium leading-[23px]"
                  >
                    {item.title}
                  </h3>
                </div>

                <p
                  style={{ color: 'var(--solva-muted)' }}
                  className="font-solva-sans text-[13px] leading-[19.5px] pt-3 border-t border-[#E7E3D9] dark:border-[#332F26]"
                >
                  {item.desc}
                </p>
              </div>
            </SolvaScrollReveal>
          ))}
        </div>

        {/* Interactive 3-View Scientific Benchmark Explorer (Nested Bezel `#F4F2EC` -> `#FBFAF6`) */}
        <SolvaScrollReveal delayMs={140} yOffset={32}>
          <div
            style={{ backgroundColor: 'var(--solva-surface)' }}
            className="w-full rounded-[16px] p-[8px] sm:p-[12px] space-y-3"
          >
            {/* Top Bar: 3 Scientific Audit Views + Dataset Split Summary */}
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 px-1 sm:px-2 pt-1">
              <div
                role="tablist"
                aria-label={
                  lang === 'vi'
                    ? 'Các bảng kết quả thực nghiệm 120K bài báo'
                    : '120K-paper benchmark evaluation views'
                }
                className="grid grid-cols-1 sm:grid-cols-3 gap-1.5 w-full lg:w-auto"
              >
                {[
                  {
                    id: 'ablation' as const,
                    label:
                      lang === 'vi'
                        ? '1. So sánh Baseline (B0–B5)'
                        : '1. Ablation vs. Baselines (B0–B5)',
                  },
                  {
                    id: 'classes' as const,
                    label:
                      lang === 'vi'
                        ? '2. Hiệu năng 4 Nhãn & 15 Nhóm lỗi'
                        : '2. 4 Classes & 15 Sub-Taxonomies',
                  },
                  {
                    id: 'calibration' as const,
                    label:
                      lang === 'vi'
                        ? '3. Hiệu chỉnh Platt & Bootstrap 95% CI'
                        : '3. Platt Calibration & 95% CI',
                  },
                ].map((tab) => {
                  const isActive = activeView === tab.id;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      role="tab"
                      aria-selected={isActive}
                      onClick={() => setActiveView(tab.id)}
                      style={{
                        backgroundColor: isActive ? 'var(--solva-bg)' : 'transparent',
                        color: isActive ? 'var(--solva-ink)' : 'var(--solva-muted)',
                      }}
                      className="h-[40px] px-3.5 rounded-[10px] font-mono text-[12px] font-medium flex items-center justify-center gap-2 transition-all duration-200 cursor-pointer"
                    >
                      <span>{tab.label}</span>
                    </button>
                  );
                })}
              </div>

              <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] px-2">
                <span
                  style={{
                    backgroundColor: 'var(--solva-bg)',
                    color: 'var(--solva-ink)',
                  }}
                  className="px-2.5 py-1 rounded-[6px] border border-[#E7E3D9] dark:border-[#332F26]"
                >
                  {lang === 'vi' ? 'Huấn luyện:' : 'Train:'}{' '}
                  <strong>{lang === 'vi' ? '84.000' : '84,000'}</strong> (70%)
                </span>
                <span
                  style={{
                    backgroundColor: 'var(--solva-bg)',
                    color: 'var(--solva-ink)',
                  }}
                  className="px-2.5 py-1 rounded-[6px] border border-[#E7E3D9] dark:border-[#332F26]"
                >
                  {lang === 'vi' ? 'Thẩm định:' : 'Val:'}{' '}
                  <strong>{lang === 'vi' ? '18.000' : '18,000'}</strong> (15%)
                </span>
                <span className="px-2.5 py-1 rounded-[6px] bg-emerald-500/12 text-emerald-700 dark:text-emerald-300 font-semibold">
                  {lang === 'vi'
                    ? 'Kiểm thử độc lập: N = 18.000 (15%)'
                    : 'Held-Out Test: N = 18,000 (15%)'}
                </span>
              </div>
            </div>

            {/* Inner Content Well (`#FBFAF6`) */}
            <div
              style={{
                backgroundColor: 'var(--solva-bg)',
                borderColor: 'var(--solva-border)',
              }}
              className="rounded-[12px] border p-4 sm:p-6"
            >
              {activeView === 'ablation' && (
                <div className="space-y-5 animate-debugger-switch">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-[#E7E3D9] dark:border-[#332F26]">
                    <div>
                      <h4
                        style={{ color: 'var(--solva-ink)' }}
                        className="font-solva-serif font-light text-[22px] sm:text-[26px] leading-tight tracking-[-0.03em]"
                      >
                        {lang === 'vi'
                          ? 'Thực nghiệm khảo sát thành phần (Ablation Study) trên 18.000 bài kiểm thử độc lập'
                          : 'Ablation Study on Held-Out Test Split (N = 18,000 Distinct Papers)'}
                      </h4>
                      <p
                        style={{ color: 'var(--solva-muted)' }}
                        className="font-solva-sans text-[13px] sm:text-[14px] mt-1"
                      >
                        {lang === 'vi'
                          ? 'Minh chứng thực nghiệm giải thích vì sao cách tiếp cận thuần nhúng ngữ nghĩa (B3) hay tra cứu đơn nguồn (B1) không thể ngăn chặn trích dẫn ngụy tạo tinh vi của LLM.'
                          : 'Empirical proof of why pure neural embeddings (B3) and single-source lookup (B1) fail on chimeric LLM citation hallucinations.'}
                      </p>
                    </div>
                    <span
                      style={{
                        backgroundColor: 'var(--solva-surface)',
                        color: 'var(--solva-ink)',
                      }}
                      className="self-start sm:self-center px-3 py-1 rounded-[8px] font-mono text-[11px] font-semibold shrink-0"
                    >
                      {lang === 'vi' ? '+33.7% Chính xác hơn SBERT thuần' : '+33.7% Acc vs. Pure SBERT'}
                    </span>
                  </div>

                  <div className="space-y-2.5">
                    {ablationBaselines.map((row) => (
                      <div
                        key={row.code}
                        style={{
                          backgroundColor: row.highlight
                            ? 'var(--solva-card-elevated)'
                            : 'var(--solva-surface)',
                          borderColor: row.highlight
                            ? 'var(--solva-ink)'
                            : 'var(--solva-border)',
                        }}
                        className="p-3 sm:p-3.5 rounded-[10px] border transition-all"
                      >
                        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-2 mb-2">
                          <div className="flex flex-wrap items-center gap-2 min-w-0">
                            <span
                              style={{
                                backgroundColor: row.highlight
                                  ? 'var(--solva-btn-bg)'
                                  : 'var(--solva-bg)',
                                color: row.highlight
                                  ? 'var(--solva-btn-fg)'
                                  : 'var(--solva-ink)',
                              }}
                              className="px-2 py-0.5 rounded-[5px] font-mono text-[11px] font-bold shrink-0"
                            >
                              {row.code}
                            </span>
                            <span
                              style={{ color: 'var(--solva-ink)' }}
                              className="font-solva-sans text-[14px] font-medium"
                            >
                              {row.name}
                            </span>
                            <span
                              style={{ color: 'var(--solva-muted)' }}
                              className="font-solva-sans text-[12px] hidden xl:inline"
                            >
                              — {row.note}
                            </span>
                          </div>

                          <div className="flex flex-wrap items-center gap-3 sm:gap-4 font-mono text-[11px] sm:text-[12px] shrink-0">
                            <span style={{ color: 'var(--solva-muted)' }}>
                              Prec: <strong style={{ color: 'var(--solva-ink)' }}>{row.prec}</strong>
                            </span>
                            <span style={{ color: 'var(--solva-muted)' }}>
                              Rec: <strong style={{ color: 'var(--solva-ink)' }}>{row.rec}</strong>
                            </span>
                            <span
                              className={
                                row.highlight
                                  ? 'text-emerald-700 dark:text-emerald-300 font-bold'
                                  : ''
                              }
                              style={!row.highlight ? { color: 'var(--solva-ink)' } : undefined}
                            >
                              Macro-F1: {row.f1}
                            </span>
                            <span
                              className={`px-2 py-0.5 rounded font-bold ${
                                row.highlight
                                  ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                                  : 'bg-[#FBFAF6] dark:bg-[#141310]'
                              }`}
                              style={!row.highlight ? { color: 'var(--solva-ink)' } : undefined}
                            >
                              {row.acc.toFixed(2)}% Acc
                            </span>
                          </div>
                        </div>

                        {/* Visual Accuracy Progress Bar */}
                        <div className="w-full h-2 rounded-full bg-[#E7E3D9]/70 dark:bg-[#29261F] overflow-hidden">
                          <div
                            style={{ width: `${row.acc}%` }}
                            className={`h-full rounded-full transition-all duration-700 ${
                              row.highlight
                                ? 'bg-emerald-600 dark:bg-emerald-400'
                                : 'bg-[#8C8577] dark:bg-[#6E685C]'
                            }`}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {activeView === 'classes' && (
                <div className="space-y-5 animate-debugger-switch">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-[#E7E3D9] dark:border-[#332F26]">
                    <div>
                      <h4
                        style={{ color: 'var(--solva-ink)' }}
                        className="font-solva-serif font-light text-[22px] sm:text-[26px] leading-tight tracking-[-0.03em]"
                      >
                        {lang === 'vi'
                          ? 'Hiệu năng trên 4 Nhãn Phán quyết & 15 Phân nhóm Sai lệch Học thuật (V1–V4, H1–H4, M1–M5, U1–U2)'
                          : '4 Canonical Verdict Classes & 15 Fine-Grained Error Sub-Taxonomies'}
                      </h4>
                      <p
                        style={{ color: 'var(--solva-muted)' }}
                        className="font-solva-sans text-[13px] sm:text-[14px] mt-1"
                      >
                        {lang === 'vi'
                          ? 'Nguyên tắc bảo vệ học thuật nghiêm ngặt: không để bất kỳ trích dẫn bịa đặt nào lọt qua nhãn VERIFIED và không kết tội oan công trình chân xác nào là SUSPECTED_HALLUCINATION.'
                          : 'Strict academic safety guarantee: 0 fabricated references marked VERIFIED and 0 legitimate papers falsely accused of hallucination.'}
                      </p>
                    </div>
                    <span className="self-start sm:self-center px-3 py-1 rounded-[8px] bg-emerald-500/12 text-emerald-700 dark:text-emerald-300 font-mono text-[11px] font-semibold shrink-0">
                      {lang === 'vi'
                        ? 'Độ chính xác chung: 97.18% [96.93%, 97.41%]'
                        : 'Overall Acc: 97.18% [96.93%, 97.41%]'}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                    {classPerformance.map((cls) => (
                      <div
                        key={cls.label}
                        style={{
                          backgroundColor: 'var(--solva-surface)',
                          borderColor: 'var(--solva-border)',
                        }}
                        className="p-4 rounded-[12px] border flex flex-col justify-between gap-3"
                      >
                        <div className="space-y-2">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span
                              className={`px-2.5 py-0.5 rounded font-mono text-[11px] font-bold ${
                                cls.tone === 'emerald'
                                  ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                                  : cls.tone === 'red'
                                    ? 'bg-red-500/15 text-red-700 dark:text-red-300'
                                    : cls.tone === 'amber'
                                      ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                                      : 'bg-slate-500/15 text-slate-700 dark:text-slate-300'
                              }`}
                            >
                              {cls.label}
                            </span>
                            <span
                              style={{ color: 'var(--solva-muted)' }}
                              className="font-mono text-[11px]"
                            >
                              {lang === 'vi'
                                ? `${cls.subtypes} · Tổng mẫu: ${cls.totalSamples} · Kiểm thử N=${cls.testSupport}`
                                : `${cls.subtypes} · Corpus: ${cls.totalSamples} · Test N=${cls.testSupport}`}
                            </span>
                          </div>

                          <p
                            style={{ color: 'var(--solva-muted)' }}
                            className="font-solva-sans text-[13px] leading-[19.5px]"
                          >
                            {cls.desc}
                          </p>
                        </div>

                        <div className="grid grid-cols-3 gap-2 pt-2.5 border-t border-[#E7E3D9] dark:border-[#332F26] font-mono text-[11px]">
                          <div>
                            <div style={{ color: 'var(--solva-muted)' }}>PRECISION</div>
                            <div
                              style={{ color: 'var(--solva-ink)' }}
                              className="font-bold text-[13px] mt-0.5"
                            >
                              {cls.precision}
                            </div>
                          </div>
                          <div>
                            <div style={{ color: 'var(--solva-muted)' }}>RECALL</div>
                            <div
                              style={{ color: 'var(--solva-ink)' }}
                              className="font-bold text-[13px] mt-0.5"
                            >
                              {cls.recall}
                            </div>
                          </div>
                          <div>
                            <div style={{ color: 'var(--solva-muted)' }}>F1-SCORE</div>
                            <div className="font-bold text-[13px] mt-0.5 text-emerald-700 dark:text-emerald-300">
                              {cls.f1}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {activeView === 'calibration' && (
                <div className="space-y-5 animate-debugger-switch">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-[#E7E3D9] dark:border-[#332F26]">
                    <div>
                      <h4
                        style={{ color: 'var(--solva-ink)' }}
                        className="font-solva-serif font-light text-[22px] sm:text-[26px] leading-tight tracking-[-0.03em]"
                      >
                        {lang === 'vi'
                          ? 'Hiệu chỉnh Xác suất Hậu nghiệm Logit-Space Platt Scaling & Khoảng Tin cậy 95% Bootstrap'
                          : 'Post-Hoc Logit-Space Platt Calibration & 1,000-Bootstrap 95% Confidence Intervals'}
                      </h4>
                      <p
                        style={{ color: 'var(--solva-muted)' }}
                        className="font-solva-sans text-[13px] sm:text-[14px] mt-1"
                      >
                        {lang === 'vi'
                          ? 'Ước lượng tham số Platt (a = 2.1621, b = 0.6299) hoàn toàn độc lập trên tập Thẩm định (18.000 mẫu), đảm bảo điểm độ tin cậy phản ánh trung thực xác suất đúng thực nghiệm.'
                          : 'Platt parameters (a = 2.1621, b = 0.6299) fitted strictly on the 18,000-sample Validation split align confidence scores with true empirical accuracy.'}
                      </p>
                    </div>
                    <span className="self-start sm:self-center px-3 py-1 rounded-[8px] bg-emerald-500/12 text-emerald-700 dark:text-emerald-300 font-mono text-[11px] font-semibold shrink-0">
                      {lang === 'vi'
                        ? '99.99% Chính xác @ 90% Độ phủ'
                        : '99.99% Acc @ 90% Coverage'}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
                    {/* Left: Uncalibrated vs Platt-Calibrated */}
                    <div
                      style={{
                        backgroundColor: 'var(--solva-surface)',
                        borderColor: 'var(--solva-border)',
                      }}
                      className="lg:col-span-7 p-4 rounded-[12px] border space-y-3"
                    >
                      <div
                        style={{ color: 'var(--solva-ink)' }}
                        className="font-mono text-xs font-semibold uppercase"
                      >
                        {lang === 'vi'
                          ? 'ĐỐI SÁNH TRƯỚC & SAU KHI HIỆU CHỈNH PLATT (N = 18.000 MẪU KIỂM THỬ)'
                          : 'BEFORE VS. AFTER LOGIT-SPACE PLATT SCALING (N = 18,000 TEST)'}
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div
                          style={{
                            backgroundColor: 'var(--solva-bg)',
                            borderColor: 'var(--solva-border)',
                          }}
                          className="p-3.5 rounded-[10px] border space-y-2"
                        >
                          <div
                            style={{ color: 'var(--solva-muted)' }}
                            className="font-mono text-[11px] font-semibold"
                          >
                            {lang === 'vi' ? 'ĐIỂM THÔ CHƯA HIỆU CHỈNH' : 'UNCALIBRATED RAW'}
                          </div>
                          <div className="space-y-1 font-mono text-xs">
                            <div className="flex justify-between">
                              <span style={{ color: 'var(--solva-muted)' }}>
                                {lang === 'vi' ? 'Sai số ECE:' : 'ECE Error:'}
                              </span>
                              <strong style={{ color: 'var(--solva-ink)' }}>0.2135</strong>
                            </div>
                            <div className="flex justify-between">
                              <span style={{ color: 'var(--solva-muted)' }}>
                                {lang === 'vi' ? 'Điểm Brier:' : 'Brier Score:'}
                              </span>
                              <strong style={{ color: 'var(--solva-ink)' }}>0.0794</strong>
                            </div>
                            <div className="flex justify-between">
                              <span style={{ color: 'var(--solva-muted)' }}>
                                {lang === 'vi' ? 'Chính xác @ 70% Phủ:' : 'Acc @ 70% Cov:'}
                              </span>
                              <strong style={{ color: 'var(--solva-ink)' }}>98.14%</strong>
                            </div>
                            <div className="flex justify-between">
                              <span style={{ color: 'var(--solva-muted)' }}>
                                {lang === 'vi' ? 'Chính xác @ 90% Phủ:' : 'Acc @ 90% Cov:'}
                              </span>
                              <strong style={{ color: 'var(--solva-ink)' }}>98.37%</strong>
                            </div>
                          </div>
                        </div>

                        <div
                          style={{
                            backgroundColor: 'var(--solva-card-elevated)',
                            borderColor: 'var(--solva-ink)',
                          }}
                          className="p-3.5 rounded-[10px] border space-y-2"
                        >
                          <div className="font-mono text-[11px] font-bold text-emerald-700 dark:text-emerald-300">
                            {lang === 'vi'
                              ? 'SAU HIỆU CHỈNH PLATT (VẬN HÀNH THỰC TẾ)'
                              : 'PLATT-CALIBRATED (PRODUCTION)'}
                          </div>
                          <div className="space-y-1 font-mono text-xs">
                            <div className="flex justify-between">
                              <span style={{ color: 'var(--solva-muted)' }}>
                                {lang === 'vi' ? 'Sai số ECE:' : 'ECE Error:'}
                              </span>
                              <strong className="text-emerald-700 dark:text-emerald-300">
                                0.0433 (↓ 4.9×)
                              </strong>
                            </div>
                            <div className="flex justify-between">
                              <span style={{ color: 'var(--solva-muted)' }}>
                                {lang === 'vi' ? 'Điểm Brier:' : 'Brier Score:'}
                              </span>
                              <strong className="text-emerald-700 dark:text-emerald-300">
                                0.0095 (↓ 8.4×)
                              </strong>
                            </div>
                            <div className="flex justify-between">
                              <span style={{ color: 'var(--solva-muted)' }}>
                                {lang === 'vi' ? 'Chính xác @ 70% Phủ:' : 'Acc @ 70% Cov:'}
                              </span>
                              <strong className="text-emerald-700 dark:text-emerald-300">
                                100.00%
                              </strong>
                            </div>
                            <div className="flex justify-between">
                              <span style={{ color: 'var(--solva-muted)' }}>
                                {lang === 'vi' ? 'Chính xác @ 90% Phủ:' : 'Acc @ 90% Cov:'}
                              </span>
                              <strong className="text-emerald-700 dark:text-emerald-300">
                                99.99%
                              </strong>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Right: 1,000-Bootstrap 95% CI Table */}
                    <div
                      style={{
                        backgroundColor: 'var(--solva-surface)',
                        borderColor: 'var(--solva-border)',
                      }}
                      className="lg:col-span-5 p-4 rounded-[12px] border flex flex-col justify-between gap-3"
                    >
                      <div
                        style={{ color: 'var(--solva-ink)' }}
                        className="font-mono text-xs font-semibold uppercase"
                      >
                        {lang === 'vi'
                          ? 'KHOẢNG TIN CẬY 95% BOOTSTRAP (B = 1.000 LẦN LẤY MẪU)'
                          : '95% BOOTSTRAP CONFIDENCE INTERVALS (B = 1,000)'}
                      </div>

                      <div className="space-y-2 font-mono text-xs">
                        {[
                          {
                            metric: lang === 'vi' ? 'Độ chính xác tổng thể' : 'Overall Accuracy',
                            est: '97.18%',
                            ci: '[96.93%, 97.41%]',
                            se: '±0.12%',
                          },
                          {
                            metric: lang === 'vi' ? 'Điểm Macro-F1' : 'Macro-F1 Score',
                            est: '0.9617',
                            ci: '[0.9583, 0.9648]',
                            se: '±0.0016',
                          },
                          {
                            metric: lang === 'vi' ? 'Sai số ECE đã hiệu chỉnh' : 'Calibrated ECE',
                            est: '0.0433',
                            ci: '[0.0421, 0.0448]',
                            se: '±0.0007',
                          },
                          {
                            metric: lang === 'vi' ? 'Điểm Brier (Brier Score)' : 'Brier Score',
                            est: '0.0095',
                            ci: '[0.0087, 0.0102]',
                            se: '±0.0004',
                          },
                        ].map((item) => (
                          <div
                            key={item.metric}
                            style={{
                              backgroundColor: 'var(--solva-bg)',
                              borderColor: 'var(--solva-border)',
                            }}
                            className="px-3 py-2 rounded-[8px] border flex items-center justify-between gap-2"
                          >
                            <span style={{ color: 'var(--solva-ink)' }} className="font-medium">
                              {item.metric}
                            </span>
                            <span style={{ color: 'var(--solva-muted)' }}>
                              <strong style={{ color: 'var(--solva-ink)' }}>{item.est}</strong> ·{' '}
                              {item.ci} ({item.se})
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </SolvaScrollReveal>
      </div>
    </section>
  );
}

/* ============================================================
   SECTION 2: FEATURES (`#architecture` — "What CITRA does")
   3-Column Grid (384x433px cards with Oil Paintings + 288x288 Widgets)
   ============================================================ */
function SolvaFeaturesSection({ lang }: { lang: Lang }) {
  const features = [
    {
      painting: '/solva/feature-1-bg.webp',
      title:
        lang === 'vi'
          ? 'Thẩm định độc lập trên hai tầng trực giao (L1 × L2)'
          : 'Verify across two orthogonal layers',
      desc:
        lang === 'vi'
          ? 'Tách bạch rành mạch giữa tính nhất quán trình bày nội bộ (Tầng 1: Đối chiếu ký hiệu trích dẫn trong bài với Danh mục tài liệu) và tính xác thực học thuật bên ngoài (Tầng 2: Kiểm chứng sự tồn tại thực tế của công trình).'
          : 'Cleanly decouples internal manuscript consistency (Layer 1: In-text to Bibliography mapping) from external bibliographic existence (Layer 2: Canonical truth).',
    },
    {
      painting: '/solva/feature-2-bg.webp',
      title:
        lang === 'vi'
          ? 'Truy vấn đồng thời hơn 15 cơ sở dữ liệu khoa học quốc tế'
          : 'Query 15+ scholarly indexes in parallel',
      desc:
        lang === 'vi'
          ? 'Đối chiếu song song trên Crossref, OpenAlex, Semantic Scholar, PubMed, arXiv, DBLP, DOAJ và ORCID, kết hợp chỉ mục đệm cục bộ SQLite FTS5 phản hồi dưới 10 mili-giây.'
          : 'Queries Crossref, OpenAlex, Semantic Scholar, PubMed, arXiv, DBLP, DOAJ, and ORCID concurrently with sub-10ms SQLite FTS5 local caching.',
    },
    {
      painting: '/solva/feature-3-bg.webp',
      title:
        lang === 'vi'
          ? 'Hợp nhất suy diễn Neuro-Symbolic & thẩm định ngữ nghĩa'
          : 'Combine symbolic rules with neural stance',
      desc:
        lang === 'vi'
          ? `Kết hợp ${SYMBOLIC_RULES_COUNT} quy tắc suy diễn hình thức (${SYMBOLIC_RULES_RANGE}) cùng mô hình Sentence-BERT và DeBERTa-v3 NLI để làm rõ liệu nội dung bài báo gốc có thực sự hậu thuẫn cho nhận định đang trích dẫn hay không.`
          : `Pairs ${SYMBOLIC_RULES_COUNT} formal symbolic rules (${SYMBOLIC_RULES_RANGE}) with Sentence-BERT embeddings and DeBERTa-v3 NLI to verify whether cited abstracts actually support the claim.`,
    },
  ];

  return (
    <section
      id="architecture"
      className="scroll-mt-[84px] lg:scroll-mt-[108px] py-[32px] sm:py-[48px] lg:py-[96px] px-5 sm:px-6 lg:px-[40px]"
    >
      <div className="max-w-[1200px] mx-auto flex flex-col gap-[28px] sm:gap-[36px] lg:gap-[64px]">
        {/* Section Headline */}
        <div className="flex flex-col items-start gap-[12px] sm:gap-[16px] max-w-[620px]">
          <SolvaEyebrow>
            {lang === 'vi' ? 'Nền tảng kiến trúc cốt lõi' : 'What CITRA does'}
          </SolvaEyebrow>
          <SolvaTwoToneHeading
            primary={
              lang === 'vi'
                ? 'Ba trụ cột giúp CITRA'
                : 'Three ways CITRA'
            }
            secondary={
              lang === 'vi'
                ? 'gìn giữ sự chuẩn xác cho từng danh mục tham khảo.'
                : 'audits your bibliography.'
            }
          />
        </div>

        {/* 3-Column Feature Cards (`gap: 24px`) */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-[24px]">
          {features.map((feat, idx) => (
            <SolvaScrollReveal
              key={feat.title}
              delayMs={idx * 95}
              yOffset={36}
              className="flex flex-col gap-[16px] min-w-0"
            >
              {/* Top 336px Painterly Visual Box */}
              <SolvaPainterlyFrame
                paintingSrc={feat.painting}
                alt={feat.title}
                className="w-full h-[320px] sm:h-[336px] p-[24px]"
              >
                <div className="w-full h-full flex items-center justify-center">
                  <FeatureCardWidget index={idx as 0 | 1 | 2} lang={lang} />
                </div>
              </SolvaPainterlyFrame>

              {/* Bottom Title (20px Onest) + Description (16px Onest) */}
              <div className="flex flex-col gap-[8px] pt-1">
                <h3
                  style={{ color: 'var(--solva-ink)' }}
                  className="font-solva-sans text-[20px] font-normal leading-[27px] tracking-[-0.02em]"
                >
                  {feat.title}
                </h3>
                <p
                  style={{ color: 'var(--solva-muted)' }}
                  className="font-solva-sans text-[16px] font-normal leading-[23.2px]"
                >
                  {feat.desc}
                </p>
              </div>
            </SolvaScrollReveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ============================================================
   SECTION 3: STICKY FEATURES ("Why CITRA")
   3 Scroll-Linked Sticky Stacking Cards (`scale(1)` -> `scale(0.915)`)
   ============================================================ */
function SolvaStickySection({
  lang,
  isAuthenticated,
}: {
  lang: Lang;
  isAuthenticated: boolean;
}) {
  const stickyBlocks = [
    {
      painting: '/solva/sticky-1-bg.webp',
      title:
        lang === 'vi'
          ? 'Bóc tách cấu trúc học thuật bằng GROBID TEI-XML thay vì biểu thức mẫu cứng nhắc'
          : 'Parsed by GROBID TEI-XML, not brittle templates',
      desc:
        lang === 'vi'
          ? 'Kết hợp mô hình học sâu GROBID cùng bộ kiểm định chéo đa quy chuẩn (IEEE, APA 7th, Vancouver, Harvard, ACM), tự động nhận diện chuẩn xác ranh giới phần Tài liệu tham khảo và giải nén trọn vẹn các cụm trích dẫn gộp [1]–[5].'
          : 'Combines deep-learning GROBID TEI-XML segmentation with a multi-style cross-validator (IEEE, APA 7th, Vancouver, Harvard, ACM) that locks bibliography boundaries and expands grouped ranges.',
      cta: lang === 'vi' ? 'Trải nghiệm ngay' : 'Get started',
    },
    {
      painting: '/solva/sticky-2-bg.webp',
      title:
        lang === 'vi'
          ? 'Minh bạch từng quy tắc cho hội đồng phản biện, phản hồi tức thì cho người viết'
          : 'Formal rule traces for reviewers, instant feedback for authors',
      desc:
        lang === 'vi'
          ? `Mọi phán quyết đều đính kèm vết suy diễn hình thức ${SYMBOLIC_RULES_RANGE} và bảng đối chiếu chi tiết từng trường thư mục (Tiêu đề, Tác giả, Năm, Tạp chí, DOI). Giảng viên có toàn quyền điều chỉnh kết luận (Override) kèm lưu vết kiểm toán bất biến.`
          : `Every verdict includes a deterministic ${SYMBOLIC_RULES_RANGE} rule trace and field-level edit distances. Instructors can override verdicts with mandatory rationale logged to an immutable audit trail.`,
      cta: lang === 'vi' ? 'Khám phá hệ quy tắc' : 'Explore rules',
    },
    {
      painting: '/solva/sticky-3-bg.webp',
      title:
        lang === 'vi'
          ? 'Chặn đứng trích dẫn ngụy tạo do AI trước khi bản thảo bước vào hội đồng'
          : 'Catch hallucinated references before peer review',
      desc:
        lang === 'vi'
          ? 'Phát hiện tức thì những tài liệu "ma" do mô hình ngôn ngữ lớn tự suy diễn — như ghép tiền tố nhà xuất bản uy tín với mã DOI không có thật — đồng thời theo dõi sự tiến bộ của Điểm Toàn vẹn Trích dẫn (CIS) qua từng lần chỉnh sửa.'
          : 'Flags synthetic LLM-generated references — such as real journal prefixes paired with fabricated DOIs — and tracks Citation Integrity Score (CIS) improvements across manuscript revisions.',
      cta: lang === 'vi' ? 'Thẩm định bản thảo' : 'Audit manuscript',
    },
  ];

  return (
    <section className="py-[32px] sm:py-[48px] lg:py-[96px] px-5 sm:px-6 lg:px-[40px]">
      <div className="max-w-[1200px] mx-auto flex flex-col gap-[28px] sm:gap-[36px] lg:gap-[60px]">
        {/* Section Headline */}
        <div className="flex flex-col items-start gap-[12px] max-w-[580px]">
          <SolvaEyebrow>
            {lang === 'vi' ? 'Giá trị khác biệt của CITRA' : 'Why CITRA'}
          </SolvaEyebrow>
          <SolvaTwoToneHeading
            primary={lang === 'vi' ? 'Một không gian học thuật.' : 'One workspace.'}
            secondary={
              lang === 'vi'
                ? 'Mọi trích dẫn đều có bằng chứng bảo chứng.'
                : 'Every citation, accounted for.'
            }
          />
        </div>

        {/* Sticky Stacking Cards Container */}
        <div
          data-testid="solva-sticky-cards-deck"
          className="relative flex flex-col gap-[32px] sm:gap-[44px] lg:gap-[72px]"
        >
          {stickyBlocks.map((block, idx) => (
            <SolvaStickyStackCard
              key={block.title}
              index={idx}
              total={stickyBlocks.length}
            >
              <div className="grid grid-cols-1 lg:grid-cols-12 items-center">
                {/* Left Painterly Frame (667x548px equivalent on Desktop) */}
                <div className="lg:col-span-7">
                  <SolvaPainterlyFrame
                    paintingSrc={block.painting}
                    alt={block.title}
                    radiusClass="rounded-[10px]"
                    className="w-full h-[340px] sm:h-[420px] lg:h-[520px] p-6 flex items-center justify-center"
                  >
                    <div className="w-full h-full flex items-center justify-center">
                      <StickyCardWidget index={idx as 0 | 1 | 2} lang={lang} />
                    </div>
                  </SolvaPainterlyFrame>
                </div>

                {/* Right Editorial Content (509x548px equivalent, padding 48px) */}
                <div className="lg:col-span-5 p-6 sm:p-8 lg:p-[48px] flex flex-col items-start justify-center gap-[24px]">
                  <div className="flex flex-col gap-[12px]">
                    <h3
                      style={{ color: 'var(--solva-ink)' }}
                      className="font-solva-serif font-light text-[30px] sm:text-[36px] xl:text-[40px] leading-[1.15] tracking-[-0.05em] max-w-[400px]"
                    >
                      {block.title}
                    </h3>
                    <p
                      style={{ color: 'var(--solva-muted)' }}
                      className="font-solva-sans text-[16px] font-normal leading-[23.2px] max-w-[380px]"
                    >
                      {block.desc}
                    </p>
                  </div>

                  <SolvaButton
                    to={isAuthenticated ? '/upload' : '/login'}
                    variant="primary"
                  >
                    {block.cta}
                  </SolvaButton>
                </div>
              </div>
            </SolvaStickyStackCard>
          ))}
          <div
            aria-hidden="true"
            className="h-[24px] sm:h-[40px] lg:h-[88px] pointer-events-none shrink-0"
          />
        </div>
      </div>
    </section>
  );
}

/* ============================================================
   SECTION 4: INTERACTIVE CITATION DEBUGGER IDE (`#interactive-demo`)
   Wrapped in Solva's Nested Bezel (`#F4F2EC` -> `#FBFAF6`)
   Preserves all E2E test selectors & accessible tab roles!
   ============================================================ */
function SolvaInteractiveDebuggerSection({ lang }: { lang: Lang }) {
  const [selectedId, setSelectedId] = useState<string>(DEMO_CITATIONS[1].id);
  const [isAutoPlaying, setIsAutoPlaying] = useState<boolean>(true);
  const {
    containerRef: debuggerRef,
    isVisible: debuggerVisible,
    replaySeed: debuggerSeed,
  } = useFloralCardAnimation(5600);

  const activeCitation =
    DEMO_CITATIONS.find((c) => c.id === selectedId) || DEMO_CITATIONS[0];

  useEffect(() => {
    if (!isAutoPlaying || !debuggerVisible) return;
    const timer = window.setInterval(() => {
      setSelectedId((prev) => {
        const idx = DEMO_CITATIONS.findIndex((c) => c.id === prev);
        const nextIdx = (idx + 1) % DEMO_CITATIONS.length;
        return DEMO_CITATIONS[nextIdx].id;
      });
    }, 4200);
    return () => window.clearInterval(timer);
  }, [isAutoPlaying, debuggerVisible]);

  const handleSelectCitation = (id: string) => {
    setSelectedId(id);
    setIsAutoPlaying(false);
  };

  const renderFieldStatusBadge = (
    status: 'match' | 'partial' | 'mismatch' | 'missing'
  ) => {
    switch (status) {
      case 'match':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[6px] text-[11px] font-mono font-semibold bg-emerald-500/12 text-emerald-700 dark:text-emerald-300">
            <Check className="h-3 w-3" /> {lang === 'vi' ? 'Khớp 100%' : '100% Match'}
          </span>
        );
      case 'partial':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[6px] text-[11px] font-mono font-semibold bg-amber-500/12 text-amber-700 dark:text-amber-300">
            <AlertTriangle className="h-3 w-3" /> {lang === 'vi' ? 'Tương đồng 86%' : '86% Sim'}
          </span>
        );
      case 'mismatch':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[6px] text-[11px] font-mono font-semibold bg-red-500/12 text-red-700 dark:text-red-300">
            <XCircle className="h-3 w-3" /> {lang === 'vi' ? 'Sai lệch' : 'Diff'}
          </span>
        );
      case 'missing':
        return (
          <span
            style={{
              backgroundColor: 'var(--solva-surface)',
              color: 'var(--solva-muted)',
            }}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[6px] text-[11px] font-mono font-semibold"
          >
            {lang === 'vi' ? '— Khuyết thông tin' : '— Missing'}
          </span>
        );
    }
  };

  const fieldLabelMap: Record<'title' | 'authors' | 'year' | 'venue' | 'doi', string> = {
    title: lang === 'vi' ? 'Tiêu đề' : 'title',
    authors: lang === 'vi' ? 'Tác giả' : 'authors',
    year: lang === 'vi' ? 'Năm XB' : 'year',
    venue: lang === 'vi' ? 'Nơi công bố' : 'venue',
    doi: 'DOI',
  };

  const localizeMetaValue = (val: string) => {
    if (lang !== 'vi') return val;
    if (val === '[Missing from Bibliography Section]') {
      return '[Khuyết mục tương ứng trong Danh mục Tài liệu tham khảo]';
    }
    if (val === '—') return '—';
    return val;
  };

  return (
    <section
      id="interactive-demo"
      className="scroll-mt-[84px] lg:scroll-mt-[108px] py-[32px] sm:py-[48px] lg:py-[96px] px-5 sm:px-6 lg:px-[40px]"
    >
      <div className="max-w-[1200px] mx-auto flex flex-col gap-[28px] sm:gap-[36px] lg:gap-[64px]">
        {/* Section Headline */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 sm:gap-6">
          <div className="flex flex-col items-start gap-[12px]">
            <SolvaEyebrow>
              {lang === 'vi'
                ? 'Không gian kiểm nghiệm trích dẫn trực quan'
                : 'Interactive Citation Debugger'}
            </SolvaEyebrow>
            <SolvaTwoToneHeading
              primary={
                lang === 'vi'
                  ? 'Soi chiếu từng trích dẫn.'
                  : 'Inspect every citation.'
              }
              secondary={
                lang === 'vi'
                  ? 'Tường minh từng quy tắc suy diễn.'
                  : 'Audit every symbolic rule.'
              }
            />
          </div>
          <SolvaScrollReveal delayMs={80} yOffset={24}>
            <p
              style={{ color: 'var(--solva-muted)' }}
              className="font-solva-sans text-[16px] leading-[23.2px] max-w-[400px]"
            >
              {lang === 'vi'
                ? 'Chọn bất kỳ trích dẫn mẫu nào bên dưới để quan sát cách CITRA đối sánh siêu dữ liệu song song, đo độ trễ truy vấn đa nguồn và kích hoạt chuỗi luật R01–R16.'
                : 'Select any sample citation below to inspect live side-by-side metadata diffs, multi-source latency, and formal symbolic rule triggers.'}
            </p>
          </SolvaScrollReveal>
        </div>

        {/* Solva Outer Bezel (`#F4F2EC`, `border-radius: 16px`, `padding: 12px`) */}
        <SolvaScrollReveal delayMs={110} yOffset={36}>
          <div
            ref={debuggerRef}
            style={{ backgroundColor: 'var(--solva-surface)' }}
            className="rounded-[16px] p-[8px] sm:p-[12px]"
          >
            <div
              style={{
                backgroundColor: 'var(--solva-bg)',
                borderColor: 'var(--solva-border)',
              }}
              className="rounded-[12px] border overflow-hidden"
            >
              {/* Top Window Bar */}
              <div
                style={{
                  backgroundColor: 'var(--solva-card-elevated)',
                  borderColor: 'var(--solva-border)',
                }}
                className="px-4 sm:px-6 py-3.5 border-b flex flex-wrap items-center justify-between gap-4"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="flex items-center gap-1.5 shrink-0" aria-label="macOS window controls">
                    <span className="w-3 h-3 rounded-full bg-[#FF5F56] border border-[#E0443E]/60 shadow-2xs" />
                    <span className="w-3 h-3 rounded-full bg-[#FFBD2E] border border-[#DEA123]/60 shadow-2xs" />
                    <span className="w-3 h-3 rounded-full bg-[#27C93F] border border-[#1AAB29]/60 shadow-2xs" />
                  </div>
                <div
                  style={{ color: 'var(--solva-ink)' }}
                  className="flex items-center gap-2 font-mono text-xs min-w-0"
                >
                  <FileText className="h-3.5 w-3.5 shrink-0" />
                  <span className="font-semibold truncate">
                    thesis_neural_retrieval_2026.pdf
                  </span>
                  <span
                    style={{ color: 'var(--solva-muted)' }}
                    className="hidden sm:inline"
                  >
                    (<SolvaLiveNumber value={18} replaySeed={debuggerSeed} durationMs={1150} />{' '}
                    {lang === 'vi' ? 'trang' : 'pages'} ·{' '}
                    <SolvaLiveNumber value={24} replaySeed={debuggerSeed} durationMs={1300} />{' '}
                    {lang === 'vi' ? 'trích dẫn' : 'citations'})
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsAutoPlaying((prev) => !prev)}
                  style={{
                    backgroundColor: 'var(--solva-surface)',
                    color: 'var(--solva-ink)',
                    borderColor: 'var(--solva-border)',
                  }}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[8px] border text-[11px] font-mono font-medium cursor-pointer"
                >
                  {isAutoPlaying ? (
                    <>
                      <Pause className="h-3 w-3" />
                      <span>{lang === 'vi' ? 'Đang tự động duyệt' : 'Auto-Tour: ON'}</span>
                    </>
                  ) : (
                    <>
                      <Play className="h-3 w-3" />
                      <span>{lang === 'vi' ? 'Tạm dừng duyệt' : 'Auto-Tour: PAUSED'}</span>
                    </>
                  )}
                </button>
                <div
                  style={{
                    backgroundColor: 'var(--solva-btn-bg)',
                    color: 'var(--solva-btn-fg)',
                  }}
                  className="px-2.5 py-1 rounded-[8px] text-[11px] font-mono font-semibold"
                >
                  CIS:{' '}
                  <SolvaLiveNumber
                    value={84.5}
                    decimals={1}
                    replaySeed={debuggerSeed}
                    durationMs={1400}
                  />{' '}
                  / 100
                </div>
              </div>
            </div>

            {/* Split-Pane Debugger Body */}
            <div className="grid lg:grid-cols-12">
              {/* Left Pane: Extracted Citations Queue (5 cols) */}
              <div
                style={{ borderColor: 'var(--solva-border)' }}
                className="lg:col-span-5 min-w-0 border-b lg:border-b-0 lg:border-r p-4 sm:p-5 flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <span
                      style={{ color: 'var(--solva-muted)' }}
                      className="text-xs font-mono uppercase tracking-wider font-semibold"
                    >
                      {lang === 'vi'
                        ? 'Trích dẫn bóc tách từ bản thảo (Chọn để thẩm định)'
                        : 'Extracted Citations (Select to Inspect)'}
                    </span>
                    <span
                      style={{ color: 'var(--solva-muted)' }}
                      className="text-[11px] font-mono"
                    >
                      {lang === 'vi' ? 'Hiển thị 4 / 24' : '4 / 24 shown'}
                    </span>
                  </div>

                  <div className="space-y-2.5" role="listbox" aria-label="Sample Citations">
                    {DEMO_CITATIONS.map((cit) => {
                      const isSelected = cit.id === activeCitation.id;
                      return (
                        <button
                          key={cit.id}
                          type="button"
                          role="option"
                          aria-selected={isSelected}
                          onClick={() => handleSelectCitation(cit.id)}
                          style={{
                            backgroundColor: isSelected
                              ? 'var(--solva-card-elevated)'
                              : 'var(--solva-surface)',
                            borderColor: isSelected
                              ? 'var(--solva-ink)'
                              : 'var(--solva-border)',
                          }}
                          className="w-full text-left p-3.5 rounded-[10px] border transition-all duration-200 cursor-pointer"
                        >
                          <div className="flex items-center justify-between gap-2 mb-1.5">
                            <div className="flex items-center gap-2 min-w-0">
                              <span
                                style={{
                                  backgroundColor: isSelected
                                    ? 'var(--solva-btn-bg)'
                                    : 'var(--solva-bg)',
                                  color: isSelected
                                    ? 'var(--solva-btn-fg)'
                                    : 'var(--solva-ink)',
                                }}
                                className="font-mono text-xs font-bold px-2 py-0.5 rounded-[5px]"
                              >
                                {cit.marker}
                              </span>
                              <span
                                style={{ color: 'var(--solva-ink)' }}
                                className="font-medium text-sm truncate"
                              >
                                {cit.inText}
                              </span>
                            </div>
                            <span
                              style={{ color: 'var(--solva-muted)' }}
                              className="font-mono text-[11px] shrink-0"
                            >
                              {cit.page}
                            </span>
                          </div>

                          <p
                            style={{ color: 'var(--solva-muted)' }}
                            className="text-xs line-clamp-1 mb-2.5 font-solva-serif italic"
                          >
                            &ldquo;{localizeMetaValue(cit.citedMeta.title)}&rdquo;
                          </p>

                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span
                                className={`verdict-badge ${cit.verdictBadgeClass} text-[10px] px-2 py-0.5 font-mono`}
                              >
                                {cit.verdict}
                              </span>
                              <span
                                className={`mapping-badge ${cit.mappingBadgeClass} text-[10px] px-2 py-0.5 font-mono`}
                              >
                                {cit.mappingStatus}
                              </span>
                            </div>
                            <span
                              style={{ color: 'var(--solva-muted)' }}
                              className="font-mono text-[11px]"
                            >
                              {lang === 'vi' ? 'Độ tin cậy:' : 'Conf:'}{' '}
                              <strong style={{ color: 'var(--solva-ink)' }}>
                                <SolvaLiveNumber
                                  value={cit.confidence}
                                  suffix="%"
                                  replaySeed={debuggerSeed}
                                  durationMs={1250}
                                />
                              </strong>
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Manuscript Context Box */}
                <div
                  key={`ctx-${activeCitation.id}`}
                  style={{
                    backgroundColor: 'var(--solva-surface)',
                    borderColor: 'var(--solva-border)',
                  }}
                  className="mt-5 p-3.5 rounded-[10px] border animate-debugger-switch"
                >
                  <div
                    style={{ color: 'var(--solva-muted)' }}
                    className="flex items-center justify-between text-[11px] font-mono mb-1.5"
                  >
                    <span>
                      {lang === 'vi'
                        ? `NGỮ CẢNH TRONG BẢN THẢO (${activeCitation.page})`
                        : `MANUSCRIPT CONTEXT (${activeCitation.page})`}
                    </span>
                    <span>GROBID TEI-XML</span>
                  </div>
                  <p
                    style={{ color: 'var(--solva-ink)' }}
                    className="text-xs sm:text-sm leading-relaxed"
                  >
                    {activeCitation.contextBefore}
                    <mark
                      style={{
                        backgroundColor: 'var(--solva-btn-bg)',
                        color: 'var(--solva-btn-fg)',
                      }}
                      className="px-1.5 py-0.5 rounded font-medium"
                    >
                      {activeCitation.inText}
                    </mark>
                    {activeCitation.contextAfter}
                  </p>
                </div>
              </div>

              {/* Right Pane: Reference Inspector & Symbolic Trace (7 cols) */}
              <div
                style={{ backgroundColor: 'var(--solva-card-elevated)' }}
                className="lg:col-span-7 min-w-0 p-4 sm:p-6 flex flex-col justify-between"
              >
                <div key={activeCitation.id} className="animate-debugger-switch">
                  <div
                    style={{ borderColor: 'var(--solva-border)' }}
                    className="flex flex-wrap items-start justify-between gap-4 pb-4 border-b"
                  >
                    <div className="min-w-0">
                      <div
                        style={{ color: 'var(--solva-muted)' }}
                        className="flex flex-wrap items-center gap-x-2 gap-y-1 mb-1 font-mono text-xs"
                      >
                        <span>
                          {lang === 'vi'
                            ? 'ĐANG THẨM ĐỊNH TÀI LIỆU'
                            : 'INSPECTING REFERENCE'}
                        </span>
                        <strong style={{ color: 'var(--solva-ink)' }}>
                          {activeCitation.marker}
                        </strong>
                        <span>
                          · {lang === 'vi' ? 'Độ tin cậy' : 'Confidence'}{' '}
                          <SolvaLiveNumber
                            value={activeCitation.confidence}
                            suffix="%"
                            replaySeed={debuggerSeed}
                            durationMs={1150}
                          />
                        </span>
                      </div>
                      <h3
                        style={{ color: 'var(--solva-ink)' }}
                        className="font-solva-serif font-light text-[22px] sm:text-[26px] leading-[1.2] break-words"
                      >
                        {localizeMetaValue(activeCitation.citedMeta.title)}
                      </h3>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`verdict-badge ${activeCitation.verdictBadgeClass} text-xs px-3 py-1 font-mono`}
                      >
                        {activeCitation.verdict}
                      </span>
                      <span
                        className={`mapping-badge ${activeCitation.mappingBadgeClass} text-xs px-2.5 py-1 font-mono`}
                      >
                        {activeCitation.mappingStatus}
                      </span>
                    </div>
                  </div>

                  {/* Explanation Callout */}
                  <div
                    style={{
                      backgroundColor: 'var(--solva-surface)',
                      borderColor: 'var(--solva-border)',
                    }}
                    className="my-4 p-3.5 rounded-[10px] border flex items-start gap-3"
                  >
                    <Scale
                      style={{ color: 'var(--solva-ink)' }}
                      className="h-4 w-4 shrink-0 mt-0.5"
                    />
                    <div
                      style={{ color: 'var(--solva-muted)' }}
                      className="text-xs sm:text-sm leading-relaxed"
                    >
                      <strong
                        style={{ color: 'var(--solva-ink)' }}
                        className="mr-1.5"
                      >
                        {lang === 'vi' ? 'Lập luận Neuro-Symbolic:' : 'Neuro-Symbolic Reasoning:'}
                      </strong>
                      {lang === 'vi'
                        ? activeCitation.explanation.vi
                        : activeCitation.explanation.en}
                    </div>
                  </div>

                  {/* Inspector Tabs (Preserves exact role="tab" labels for E2E tests!) */}
                  <Tabs defaultValue="diff" className="w-full">
                    <TabsList
                      style={{ backgroundColor: 'var(--solva-surface)' }}
                      className="grid grid-cols-1 sm:grid-cols-3 w-full p-1 rounded-[10px] h-auto gap-1"
                    >
                      <TabsTrigger
                        value="diff"
                        className="w-full text-xs font-mono py-2 sm:py-1.5 px-2.5 rounded-[8px]"
                      >
                        {lang === 'vi' ? '1. Đối chiếu Siêu dữ liệu' : '1. Metadata Diff'}
                      </TabsTrigger>
                      <TabsTrigger
                        value="rules"
                        className="w-full text-xs font-mono py-2 sm:py-1.5 px-2.5 rounded-[8px]"
                      >
                        {lang === 'vi'
                          ? `2. Luật Suy diễn (${activeCitation.rules.length})`
                          : `2. Symbolic Rules (${activeCitation.rules.length})`}
                      </TabsTrigger>
                      <TabsTrigger
                        value="sources"
                        className="w-full text-xs font-mono py-2 sm:py-1.5 px-2.5 rounded-[8px]"
                      >
                        {lang === 'vi' ? '3. Nguồn Truy hồi' : '3. Source Retrieval'}
                      </TabsTrigger>
                    </TabsList>

                    {/* TAB 1: Side-by-side Metadata Diff */}
                    <TabsContent value="diff" className="mt-4 animate-debugger-switch">
                      <div
                        style={{ borderColor: 'var(--solva-border)' }}
                        className="rounded-[10px] border overflow-hidden"
                      >
                        <table className="w-full text-left border-collapse block sm:table">
                          <thead className="hidden sm:table-header-group">
                            <tr
                              style={{
                                backgroundColor: 'var(--solva-surface)',
                                borderColor: 'var(--solva-border)',
                                color: 'var(--solva-muted)',
                              }}
                              className="border-b text-[11px] font-mono uppercase"
                            >
                              <th className="py-2.5 px-3 w-28">
                                {lang === 'vi' ? 'Trường' : 'Field'}
                              </th>
                              <th className="py-2.5 px-3">
                                {lang === 'vi' ? 'Ghi trong bản thảo' : 'Cited in Manuscript'}
                              </th>
                              <th className="py-2.5 px-3">
                                {lang === 'vi' ? 'Hồ sơ gốc đối chiếu' : 'Canonical Retrieved'}
                              </th>
                              <th className="py-2.5 px-3 text-right">
                                {lang === 'vi' ? 'Kết quả' : 'Status'}
                              </th>
                            </tr>
                          </thead>
                          <tbody className="block sm:table-row-group divide-y divide-[#E7E3D9] dark:divide-[#332F26] text-xs">
                            {(
                              ['title', 'authors', 'year', 'venue', 'doi'] as const
                            ).map((field) => {
                              const status = activeCitation.fieldStatus[field];
                              const citedVal = localizeMetaValue(activeCitation.citedMeta[field]);
                              const retVal = activeCitation.retrievedMeta
                                ? activeCitation.retrievedMeta[field]
                                : lang === 'vi'
                                  ? '— Không tìm thấy trên các CSDL khoa học —'
                                  : '— Not Found in External Indexes —';

                              return (
                                <tr
                                  key={field}
                                  className="block sm:table-row p-3 sm:p-0 space-y-1.5 sm:space-y-0"
                                >
                                  <td
                                    style={{ color: 'var(--solva-muted)' }}
                                    className="block sm:table-cell sm:py-2.5 sm:px-3 font-mono uppercase text-[11px] font-semibold"
                                  >
                                    <div className="flex items-center justify-between sm:block">
                                      <span>{fieldLabelMap[field]}</span>
                                      <span className="sm:hidden">
                                        {renderFieldStatusBadge(status)}
                                      </span>
                                    </div>
                                  </td>
                                  <td
                                    style={{ color: 'var(--solva-ink)' }}
                                    className="block sm:table-cell sm:py-2.5 sm:px-3 break-words"
                                  >
                                    {citedVal}
                                  </td>
                                  <td
                                    style={{ color: 'var(--solva-muted)' }}
                                    className="block sm:table-cell sm:py-2.5 sm:px-3 break-words font-mono text-[11px]"
                                  >
                                    {retVal}
                                  </td>
                                  <td className="hidden sm:table-cell sm:py-2.5 sm:px-3 text-right whitespace-nowrap">
                                    {renderFieldStatusBadge(status)}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </TabsContent>

                    {/* TAB 2: Symbolic Rules */}
                    <TabsContent value="rules" className="mt-4 space-y-2.5 animate-debugger-switch">
                      {activeCitation.rules.map((rule) => (
                        <div
                          key={rule.code}
                          style={{
                            backgroundColor: 'var(--solva-surface)',
                            borderColor: 'var(--solva-border)',
                          }}
                          className="p-3.5 rounded-[10px] border flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                        >
                          <div className="space-y-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span
                                style={{ color: 'var(--solva-ink)' }}
                                className="font-mono text-xs font-bold"
                              >
                                {rule.code}
                              </span>
                              <span
                                style={{ color: 'var(--solva-ink)' }}
                                className="text-xs font-medium"
                              >
                                {lang === 'vi' && rule.nameVi ? rule.nameVi : rule.name}
                              </span>
                            </div>
                            <p
                              style={{ color: 'var(--solva-muted)' }}
                              className="font-mono text-[11px] break-words"
                            >
                              {rule.condition}
                            </p>
                          </div>
                          <span
                            className={`self-start sm:self-center px-2.5 py-0.5 rounded font-mono text-[10px] font-semibold uppercase shrink-0 ${
                              rule.status === 'passed'
                                ? 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300'
                                : rule.status === 'warning'
                                  ? 'bg-amber-500/12 text-amber-700 dark:text-amber-300'
                                  : 'bg-red-500/12 text-red-700 dark:text-red-300'
                            }`}
                          >
                            {lang === 'vi'
                              ? rule.status === 'passed'
                                ? 'ĐẠT'
                                : rule.status === 'warning'
                                  ? 'CẢNH BÁO'
                                  : 'VI PHẠM'
                              : rule.status}
                          </span>
                        </div>
                      ))}
                    </TabsContent>

                    {/* TAB 3: Source Retrieval */}
                    <TabsContent value="sources" className="mt-4 animate-debugger-switch">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        {activeCitation.sources.map((src) => {
                          const srcUrl = getScholarlySourceUrl(src.name);
                          const cardContent = (
                            <>
                              <div className="flex items-center gap-2.5 min-w-0">
                                <span
                                  style={{
                                    backgroundColor: 'var(--solva-bg)',
                                    borderColor: 'var(--solva-border)',
                                    color: 'var(--solva-ink)',
                                  }}
                                  className="w-8 h-8 rounded-[8px] border flex items-center justify-center shrink-0"
                                >
                                  <ScholarlySourceLogo name={src.name} size={16} />
                                </span>
                                <div className="min-w-0">
                                  <div
                                    style={{ color: 'var(--solva-ink)' }}
                                    className="text-sm font-medium truncate group-hover:underline underline-offset-2"
                                  >
                                    {src.name}
                                  </div>
                                  <div
                                    style={{ color: 'var(--solva-muted)' }}
                                    className="text-xs font-mono"
                                  >
                                    {lang === 'vi' ? 'Độ trễ:' : 'Latency:'} {src.latency}
                                  </div>
                                </div>
                              </div>
                              <span
                                style={{ color: 'var(--solva-ink)' }}
                                className="font-mono text-xs font-semibold px-2.5 py-1 rounded bg-[#FBFAF6] dark:bg-[#141310]"
                              >
                                {lang === 'vi' && src.score === '0 hits'
                                  ? '0 kết quả'
                                  : lang === 'vi' && src.score === 'Skipped'
                                    ? 'Bỏ qua'
                                    : src.score}
                              </span>
                            </>
                          );

                          if (srcUrl) {
                            return (
                              <a
                                key={src.name}
                                href={srcUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                aria-label={`${src.name} official website`}
                                style={{
                                  backgroundColor: 'var(--solva-surface)',
                                  borderColor: 'var(--solva-border)',
                                }}
                                className="group p-3.5 rounded-[10px] border flex items-center justify-between gap-2 transition-all duration-200 hover:border-[#1C1A15]/40 dark:hover:border-[#FBFAF6]/35"
                              >
                                {cardContent}
                              </a>
                            );
                          }

                          return (
                            <div
                              key={src.name}
                              style={{
                                backgroundColor: 'var(--solva-surface)',
                                borderColor: 'var(--solva-border)',
                              }}
                              className="p-3.5 rounded-[10px] border flex items-center justify-between gap-2"
                            >
                              {cardContent}
                            </div>
                          );
                        })}
                      </div>
                    </TabsContent>
                  </Tabs>
                </div>
              </div>
            </div>
          </div>
          </div>
        </SolvaScrollReveal>
      </div>
    </section>
  );
}

/* ============================================================
   SECTION 5: USE CASES / PIPELINE (`#how-it-works`)
   Solva's 4-Tab Nested Bezel Box (`#F4F2EC` Outer -> `#FBFAF6` Inner Well)
   ============================================================ */
function SolvaUseCasesSection({
  lang,
  isAuthenticated,
}: {
  lang: Lang;
  isAuthenticated: boolean;
}) {
  const [activeTab, setActiveTab] = useState(0);
  const [autoCycleTabs, setAutoCycleTabs] = useState(true);
  const { containerRef: useCasesRef, isVisible: useCasesVisible } = useFloralCardAnimation(0);

  useEffect(() => {
    if (!autoCycleTabs || !useCasesVisible) return;
    const timer = window.setInterval(() => {
      setActiveTab((prev) => (prev + 1) % 4);
    }, 4600);
    return () => window.clearInterval(timer);
  }, [autoCycleTabs, useCasesVisible]);

  // Pre-decode inactive tab WebP paintings during browser idle time so tab switching is instant
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const timer = window.setTimeout(() => {
      ['/solva/usecase-2-bg.webp', '/solva/usecase-3-bg.webp', '/solva/usecase-4-bg.webp'].forEach(
        (src) => {
          const img = new Image();
          img.decoding = 'async';
          img.src = src;
        }
      );
    }, 650);
    return () => window.clearTimeout(timer);
  }, []);

  const tabs = [
    {
      label: lang === 'vi' ? '1. Bóc tách GROBID TEI' : 'PDF & GROBID TEI',
      icon: FileText,
      painting: '/solva/usecase-1-bg.webp',
      headline:
        lang === 'vi'
          ? 'Bóc tách trọn vẹn mọi trích dẫn trong bài và danh mục tài liệu chỉ trong vài giây'
          : 'Every in-text marker and reference parsed in seconds',
      subFeatures: [
        {
          title:
            lang === 'vi'
              ? 'Phân vùng cấu trúc bản thảo chuẩn xác'
              : 'Structural section segmentation',
          desc:
            lang === 'vi'
              ? 'Tự động bóc tách phần nội dung chính, chú thích chân trang và khóa chặt ranh giới Danh mục Tài liệu tham khảo cuối bài.'
              : 'Separates body paragraphs, footnotes, and locks bibliography boundaries automatically.',
        },
        {
          title:
            lang === 'vi'
              ? 'Chuẩn hóa đa quy cách trích dẫn học thuật'
              : 'Multi-style citation normalization',
          desc:
            lang === 'vi'
              ? 'Nhận diện mượt mà cả chuẩn đánh số IEEE [1]–[5], Vancouver, ACM lẫn chuẩn Tác giả – Năm của APA 7th và Harvard.'
              : 'Handles IEEE numbered ranges [1]–[5], APA 7th author-year, Vancouver, and Harvard.',
        },
        {
          title:
            lang === 'vi'
              ? 'Rà soát tính nhất quán Tầng 1 (Mapping Consistency)'
              : 'Layer 1 mapping consistency check',
          desc:
            lang === 'vi'
              ? 'Chỉ ra tức thì các trích dẫn trong bài bị khuyết nguồn cuối bài (MISSING_REFERENCE) hoặc tài liệu liệt kê nhưng chưa từng được viện dẫn (UNCITED).'
              : 'Flags orphan in-text markers (MISSING_REFERENCE) and uncited bibliography entries on the spot.',
        },
      ],
    },
    {
      label: lang === 'vi' ? '2. Truy hồi 15+ API' : '15+ API Retrieval',
      icon: Database,
      painting: '/solva/usecase-2-bg.webp',
      headline:
        lang === 'vi'
          ? 'Truy vấn liên hợp song song trên hơn 15 cơ sở dữ liệu khoa học toàn cầu'
          : 'Federated lookup across 15+ global scholarly indexes',
      subFeatures: [
        {
          title:
            lang === 'vi'
              ? 'Truy hồi phân tầng bất đồng bộ theo độ ưu tiên'
              : 'Tiered asynchronous waterfall',
          desc:
            lang === 'vi'
              ? 'Ưu tiên phân giải định danh chính xác (DOI, PMID, arXiv ID) trước khi mở rộng sang tìm kiếm mờ đa trường theo tiêu đề và tác giả.'
              : 'Resolves exact DOI, PMID, and arXiv IDs first before cascading to fuzzy title-author search.',
        },
        {
          title:
            lang === 'vi'
              ? 'Chỉ mục đệm cục bộ SQLite FTS5 dưới 10ms'
              : 'Sub-10ms SQLite FTS5 local cache',
          desc:
            lang === 'vi'
              ? 'Lưu trữ các công trình đã xác thực bằng thuật toán xếp hạng BM25 kết hợp Trigram, giúp triệt tiêu tới 80% độ trễ truy vấn mạng.'
              : 'Caches verified canonical works with BM25 + trigram indexing for instant repeat checks.',
        },
        {
          title:
            lang === 'vi'
              ? 'Hợp nhất thực thể & khử trùng lặp đa nguồn'
              : 'Cross-source entity deduplication',
          desc:
            lang === 'vi'
              ? 'Tự động quy về một hồ sơ học thuật chuẩn duy nhất giữa bản thảo tiền ấn phẩm arXiv và bài báo chính thức trên tạp chí.'
              : 'Merges preprint records and published journal versions into a single canonical profile.',
        },
      ],
    },
    {
      label: lang === 'vi' ? '3. Luật Neuro-Symbolic' : 'Neuro-Symbolic Rules',
      icon: Scale,
      painting: '/solva/usecase-3-bg.webp',
      headline:
        lang === 'vi'
          ? `Suy diễn tất định, minh bạch trên nền tảng ${SYMBOLIC_RULES_COUNT} quy tắc hình thức ${SYMBOLIC_RULES_RANGE}`
          : `Deterministic verification grounded in formal rules ${SYMBOLIC_RULES_RANGE}`,
      subFeatures: [
        {
          title:
            lang === 'vi'
              ? 'Đối sánh độc lập từng trường siêu dữ liệu'
              : 'Field-level metadata diffing',
          desc:
            lang === 'vi'
              ? 'Tính toán độ tương đồng riêng biệt cho từng trường: Tiêu đề, Họ tên tác giả, Năm công bố, Tạp chí/Hội nghị và mã DOI.'
              : 'Computes independent similarity scores for Title, Author surnames, Year, Venue, and DOI.',
        },
        {
          title:
            lang === 'vi'
              ? 'Radar phát hiện mã DOI ngụy tạo (Ghost DOI)'
              : 'Ghost DOI & hallucination radar',
          desc:
            lang === 'vi'
              ? 'Vạch trần thủ thuật ghép tiền tố nhà xuất bản uy tín (như 10.1038) với chuỗi hậu tố bịa đặt thường gặp ở các mô hình LLM.'
              : 'Catches valid publisher prefixes (e.g., 10.1038) paired with fabricated article suffixes.',
        },
        {
          title:
            lang === 'vi'
              ? 'Khước từ mọi phán quyết "hộp đen" cảm tính'
              : 'Zero black-box guesswork',
          desc:
            lang === 'vi'
              ? 'Mỗi kết luận đưa ra đều đính kèm chính xác chuỗi quy tắc hình thức đã kích hoạt để giảng viên và tác giả dễ dàng kiểm chứng.'
              : 'Every verdict exposes the exact symbolic rule chain that fired during evaluation.',
        },
      ],
    },
    {
      label: lang === 'vi' ? '4. Ngữ nghĩa & Đồng thuận' : 'Semantic & NLI Stance',
      icon: Cpu,
      painting: '/solva/usecase-4-bg.webp',
      headline:
        lang === 'vi'
          ? 'Thẩm định xem tóm tắt bài báo gốc có thực sự hậu thuẫn cho luận điểm trích dẫn'
          : 'Verify that cited abstracts actually support the manuscript claim',
      subFeatures: [
        {
          title:
            lang === 'vi'
              ? 'So khớp ngữ nghĩa sâu 2 giai đoạn (Bi-Encoder & Cross-Encoder)'
              : 'Two-stage neural semantic matching',
          desc:
            lang === 'vi'
              ? 'Kết hợp không gian nhúng all-MiniLM-L6-v2 cùng cơ chế xếp hạng chéo ms-marco-MiniLM-L-6-v2 để đo lường sát sao mức độ tương đồng học thuật.'
              : 'Pairs all-MiniLM-L6-v2 embeddings with ms-marco-MiniLM-L-6-v2 cross-attention re-ranking.',
        },
        {
          title:
            lang === 'vi'
              ? 'Suy luận quan hệ ngữ nghĩa bằng DeBERTa-v3 NLI'
              : 'DeBERTa-v3 claim stance detection',
          desc:
            lang === 'vi'
              ? 'Phân định rõ ràng liệu tóm tắt công trình gốc Ủng hộ (SUPPORTS), Bác bỏ (REFUTES) hay Trung lập (NEUTRAL) trước câu văn trong bản thảo.'
              : 'Classifies whether the retrieved abstract SUPPORTS, REFUTES, or is NEUTRAL to the in-text claim.',
        },
        {
          title:
            lang === 'vi'
              ? 'Cảnh báo viện dẫn sai lệch tinh thần bài gốc'
              : 'Context misrepresentation alerts',
          desc:
            lang === 'vi'
              ? 'Kịp thời phát hiện những trường hợp trích dẫn bài báo có thật nhưng lại diễn giải ngược hoàn toàn với kết quả thực nghiệm của tác giả.'
              : 'Highlights real papers that are cited to claim the opposite of their actual findings.',
        },
      ],
    },
  ];

  const current = tabs[activeTab];

  return (
    <section
      id="how-it-works"
      className="scroll-mt-[84px] lg:scroll-mt-[108px] py-[32px] sm:py-[48px] lg:py-[96px] px-5 sm:px-6 lg:px-[40px]"
    >
      <div className="max-w-[1200px] mx-auto flex flex-col gap-[28px] sm:gap-[36px] lg:gap-[64px]">
        {/* Headline */}
        <div className="flex flex-col items-start gap-[12px] max-w-[540px]">
          <SolvaEyebrow>
            {lang === 'vi' ? 'Quy trình thẩm định 4 giai đoạn' : 'Verification pipeline'}
          </SolvaEyebrow>
          <SolvaTwoToneHeading
            primary={lang === 'vi' ? 'Một nền tảng thống nhất.' : 'One platform.'}
            secondary={
              lang === 'vi'
                ? 'Bốn tầng thẩm định khép kín.'
                : 'Every verification layer it touches.'
            }
          />
        </div>

        {/* Outer Interactive Container (`#F4F2EC`, `rounded-[16px]`) */}
        <SolvaScrollReveal delayMs={90} yOffset={36}>
          <div
            ref={useCasesRef}
            style={{ backgroundColor: 'var(--solva-surface)' }}
            className="w-full rounded-[16px] flex flex-col"
          >
            {/* Top 4-Tab Bar (`padding: 16px 40px`, `gap: 24px`) */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-[16px] lg:gap-[24px] p-3 sm:px-[24px] lg:px-[40px] sm:py-[16px]">
              {tabs.map((tab, idx) => {
                const Icon = tab.icon;
                const isActive = idx === activeTab;
                return (
                  <button
                    key={tab.label}
                    type="button"
                    onClick={() => {
                      setActiveTab(idx);
                      setAutoCycleTabs(false);
                    }}
                    style={{
                      backgroundColor: isActive ? 'var(--solva-bg)' : 'transparent',
                      color: isActive ? 'var(--solva-ink)' : 'var(--solva-muted)',
                    }}
                    className="h-[44px] px-3 rounded-[10px] font-solva-sans text-[13px] sm:text-[14px] font-medium flex items-center justify-center gap-[8px] transition-all duration-200 cursor-pointer"
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span className="truncate">{tab.label}</span>
                  </button>
                );
              })}
            </div>

            {/* Bottom Content Well (`#FBFAF6` inset with `12px` bezel) */}
            <div className="px-[8px] pb-[8px] sm:px-[12px] sm:pb-[12px]">
              <div
                key={activeTab}
                style={{ backgroundColor: 'var(--solva-bg)' }}
                className="rounded-[14px] p-3 sm:p-[12px] grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch animate-debugger-switch"
              >
                {/* Left Column (`412px` equivalent on Desktop, `padding: 28px`) */}
                <div className="lg:col-span-5 p-4 sm:p-[28px] flex flex-col justify-between gap-[32px]">
                  <div className="space-y-[28px]">
                    <h4
                      style={{ color: 'var(--solva-ink)' }}
                      className="font-solva-serif font-light text-[26px] sm:text-[30px] leading-[1.25] tracking-[-0.05em]"
                    >
                      {current.headline}
                    </h4>

                    <div className="space-y-[24px]">
                      {current.subFeatures.map((sf) => (
                        <div key={sf.title} className="flex items-start gap-3">
                          <CheckCircle2
                            style={{ color: 'var(--solva-ink)' }}
                            className="w-[18px] h-[18px] mt-1 shrink-0"
                          />
                          <div className="space-y-[4px]">
                            <h6
                              style={{ color: 'var(--solva-ink)' }}
                              className="font-solva-sans text-[17px] sm:text-[18px] font-normal leading-[25.2px]"
                            >
                              {sf.title}
                            </h6>
                            <p
                              style={{ color: 'var(--solva-muted)' }}
                              className="font-solva-sans text-[14px] font-normal leading-[21px]"
                            >
                              {sf.desc}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <SolvaButton
                    to={isAuthenticated ? '/upload' : '/login'}
                    variant="primary"
                    fullWidth
                  >
                    {lang === 'vi' ? 'Trải nghiệm quy trình thẩm định này' : 'Try CITRA Free'}
                  </SolvaButton>
                </div>

                {/* Right Column (`764x501px` equivalent, Painterly Frame + Stage Card) */}
                <div className="lg:col-span-7">
                  <SolvaPainterlyFrame
                    paintingSrc={current.painting}
                    alt={current.headline}
                    radiusClass="rounded-[10px]"
                    className="w-full h-full min-h-[380px] sm:min-h-[460px] p-5 sm:p-[40px] flex items-center justify-center"
                  >
                    <div className="w-full h-full flex items-center justify-center">
                      <PipelineStageVisual tabIndex={activeTab} lang={lang} />
                    </div>
                  </SolvaPainterlyFrame>
                </div>
              </div>
            </div>
          </div>
        </SolvaScrollReveal>
      </div>
    </section>
  );
}

/* ============================================================
   SECTION 6: SECURITY & ACADEMIC COMPLIANCE
   Full-Bleed `#F4F2EC` Section Background + 4 `#FBFAF6` Cards
   ============================================================ */
function SolvaSecuritySection({ lang }: { lang: Lang }) {
  const cards = [
    {
      icon: Shield,
      title:
        lang === 'vi'
          ? 'Tôn trọng quyền phán quyết của con người'
          : 'Human-in-the-loop authority',
      desc:
        lang === 'vi'
          ? 'Đóng vai trò hệ thống cung cấp bằng chứng thư mục khách quan; quyền kết luận cuối cùng luôn thuộc về giảng viên và hội đồng.'
          : 'Provides verifiable bibliographic evidence; final judgment always remains with instructors.',
    },
    {
      icon: Lock,
      title:
        lang === 'vi'
          ? 'Phân quyền độc lập theo 3 vai trò (RBAC)'
          : 'Role-based access control',
      desc:
        lang === 'vi'
          ? 'Cô lập chặt chẽ quyền truy cập và tác vụ chuyên môn giữa không gian Sinh viên, Giảng viên hướng dẫn và Quản trị viên.'
          : 'Capability-based isolation across Student, Teacher, and Administrator workspaces.',
    },
    {
      icon: Eye,
      title:
        lang === 'vi'
          ? 'Nhật ký kiểm toán bất biến (Audit Trail)'
          : 'Immutable override audit logs',
      desc:
        lang === 'vi'
          ? 'Mọi thao tác điều chỉnh kết luận (Override) của giảng viên đều được lưu vết minh bạch kèm lý do chuyên môn và dấu thời gian.'
          : 'Every instructor verdict override and administrative action is logged with rationale.',
    },
    {
      icon: FileSearch,
      title:
        lang === 'vi'
          ? 'Bảo mật tuyệt đối bản quyền bản thảo'
          : 'Manuscript privacy by default',
      desc:
        lang === 'vi'
          ? 'Bản thảo chưa công bố của bạn luôn thuộc toàn quyền sở hữu của bạn và không bao giờ bị thu thập để huấn luyện mô hình AI bên ngoài.'
          : 'Your uploaded manuscripts stay yours and are never used to train external models.',
    },
  ];

  return (
    <section
      style={{ backgroundColor: 'var(--solva-surface)' }}
      className="py-[40px] sm:py-[56px] lg:py-[96px] px-5 sm:px-6 lg:px-[40px]"
    >
      <div className="max-w-[1200px] mx-auto flex flex-col items-center gap-[28px] sm:gap-[36px] lg:gap-[64px]">
        {/* Centered Headline */}
        <div className="flex flex-col items-center text-center gap-[12px] max-w-[600px]">
          <SolvaEyebrow centered>
            {lang === 'vi' ? 'Chuẩn mực đạo đức & Bảo mật học thuật' : 'Academic compliance'}
          </SolvaEyebrow>
          <SolvaTwoToneHeading
            centered
            primary={
              lang === 'vi'
                ? 'Chuẩn mực liêm chính khoa học,'
                : 'Academic-grade integrity,'
            }
            secondary={
              lang === 'vi'
                ? 'được kiến tạo ngay từ nền tảng.'
                : 'built in by default.'
            }
          />
          <SolvaScrollReveal delayMs={90} yOffset={20}>
            <p
              style={{ color: 'var(--solva-muted)' }}
              className="font-solva-sans text-[16px] font-normal leading-[23.2px] max-w-[420px] pt-1"
            >
              {lang === 'vi'
                ? 'Công trình nghiên cứu của bạn luôn được bảo vệ trọn vẹn. CITRA đồng hành hỗ trợ quá trình phản biện minh bạch, không bao giờ thay thế hội đồng học thuật.'
                : 'Your research manuscripts stay yours. Designed to assist scholarly review, never replace it.'}
            </p>
          </SolvaScrollReveal>
        </div>

        {/* 4 Cards (`288x192px` equivalent on Desktop, `#FBFAF6` background) */}
        <div className="w-full grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-[16px]">
          {cards.map((card, idx) => {
            const Icon = card.icon;
            return (
              <SolvaScrollReveal
                key={card.title}
                delayMs={idx * 85}
                yOffset={30}
              >
                <div
                  style={{ backgroundColor: 'var(--solva-bg)' }}
                  className="rounded-[12px] p-[20px] sm:p-[24px] min-h-[156px] sm:min-h-[192px] h-full flex flex-col justify-between gap-[24px] sm:gap-[40px]"
                >
                  <Icon
                    style={{ color: 'var(--solva-ink)' }}
                    className="w-[18px] h-[18px]"
                  />
                  <div className="space-y-[6px]">
                    <h3
                      style={{ color: 'var(--solva-ink)' }}
                      className="font-solva-sans text-[18px] font-normal leading-[25.2px]"
                    >
                      {card.title}
                    </h3>
                    <p
                      style={{ color: 'var(--solva-muted)' }}
                      className="font-solva-sans text-[14px] font-normal leading-[21px]"
                    >
                      {card.desc}
                    </p>
                  </div>
                </div>
              </SolvaScrollReveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/* ============================================================
   SECTION 7: PRICING PLANS & ACADEMIC BENEFITS (`#taxonomy`)
   3 Cards (`Basic`, `Pro Popular`, `Ultra`) + Squircle Billing Toggle
   + Radial-Masked Watercolor Floral Card (`/solva/pricing-floral.png`)
   ============================================================ */
function SolvaTaxonomyPricingSection({
  lang,
  isAuthenticated,
}: {
  lang: Lang;
  isAuthenticated: boolean;
}) {
  const [annualBilling, setAnnualBilling] = useState(false);
  const { containerRef: pricingRef, replaySeed: pricingSeed } = useFloralCardAnimation(5400);

  const tiers = [
    {
      name: lang === 'vi' ? 'Basic (Khởi đầu Học thuật)' : 'Basic',
      badge: null,
      metricNum: 0,
      unit: lang === 'vi' ? 'tháng · Miễn phí' : 'month',
      desc:
        lang === 'vi'
          ? 'Bộ công cụ thẩm định trích dẫn 2 tầng thiết yếu dành cho sinh viên thực hiện tiểu luận chuyên ngành, tổng quan tài liệu và rà soát danh mục tham khảo nhanh.'
          : 'Essential two-layer citation verification for course essays, literature reviews, and quick bibliography checks.',
      includesLabel: lang === 'vi' ? 'Quyền lợi bao gồm:' : 'Includes:',
      items:
        lang === 'vi'
          ? [
              '3 bản thảo / tháng (tối đa 15 trang, 5 MB / tệp)',
              'Thẩm định tối đa 30 trích dẫn trên mỗi bản thảo',
              'Bóc tách cấu trúc GROBID TEI-XML & Đa quy chuẩn (IEEE, APA 7th)',
              'Kho đệm 127K FTS5 cục bộ + Crossref, OpenAlex & Văn bản Pháp luật VN',
              'Trọn bộ 15 nhãn phán quyết 2 tầng trực giao (L1 × L2)',
            ]
          : [
              '3 manuscripts / month (up to 15 pages, 5 MB)',
              'Up to 30 citations verified per manuscript',
              'GROBID TEI-XML & Multi-Style Cross-Validator',
              '127K Local FTS5 + Crossref, OpenAlex & VN Legal',
              'Full 15-verdict Two-Layer Orthogonal Taxonomy',
            ],
      cta: lang === 'vi' ? 'Bắt đầu miễn phí' : 'Get started free',
      to: isAuthenticated ? '/upload' : '/register',
      featured: false,
    },
    {
      name: lang === 'vi' ? 'Pro (Khóa luận & Công bố Quốc tế)' : 'Pro',
      badge: lang === 'vi' ? 'Được chọn nhiều nhất' : 'Popular',
      metricNum: annualBilling ? 16 : 20,
      unit:
        lang === 'vi'
          ? annualBilling
            ? 'tháng (thanh toán theo năm)'
            : 'tháng'
          : annualBilling
            ? 'month (billed yearly)'
            : 'month',
      desc:
        lang === 'vi'
          ? 'Truy vấn liên hợp hơn 15 CSDL khoa học quốc tế, đối sánh ngữ nghĩa sâu bằng Sentence-BERT và chuẩn hóa danh mục tự động chỉ với một cú nhấp cho khóa luận, luận văn.'
          : 'Full 15+ scholarly API federation, Sentence-BERT semantic matching, and 1-Click Auto-Fix for graduation theses.',
      includesLabel:
        lang === 'vi'
          ? 'Toàn bộ quyền lợi gói Basic, cộng thêm:'
          : 'Everything in Basic, plus:',
      items:
        lang === 'vi'
          ? [
              '50 bản thảo / tháng (tối đa 100 trang, 25 MB / tệp)',
              'Tối đa 200 trích dẫn / bản thảo + Tải lên hàng loạt (10 tệp)',
              'Mở khóa toàn bộ 15+ CSDL học thuật (PubMed, arXiv, DBLP, DOAJ...)',
              'So khớp ngữ nghĩa sâu Sentence-BERT & Thẩm định đồng thuận DeBERTa NLI',
              'Chuẩn hóa tự động 1-Click (APA, IEEE, BibTeX) & Xuất báo cáo PDF',
            ]
          : [
              '50 manuscripts / month (up to 100 pages, 25 MB)',
              'Up to 200 citations / doc + Batch Upload (10 files)',
              'All 15+ Scholarly APIs (PubMed, arXiv, DBLP, DOAJ...)',
              'Sentence-BERT Deep Neural & DeBERTa-v3 NLI Stance',
              '1-Click Bibliography Auto-Fix (APA, IEEE, BibTeX) & PDF Export',
            ],
      cta: lang === 'vi' ? 'Nâng cấp gói Pro' : 'Start Pro trial',
      to: '/pricing',
      featured: true,
    },
    {
      name: lang === 'vi' ? 'Ultra (Hội đồng & Khoa / Viện)' : 'Ultra',
      badge: null,
      metricNum: annualBilling ? 160 : 200,
      unit:
        lang === 'vi'
          ? annualBilling
            ? 'tháng (thanh toán theo năm)'
            : 'tháng'
          : annualBilling
            ? 'month (billed yearly)'
            : 'month',
      desc:
        lang === 'vi'
          ? 'Giải pháp thẩm định toàn diện ở quy mô Bộ môn, Khoa và Hội đồng bảo vệ với kênh tra cứu dự phòng Google Scholar, quản lý lớp học và lưu vết kiểm toán bất biến.'
          : 'Unlimited institutional verification, Google Scholar fallback, classroom cohort management, and instructor override logs.',
      includesLabel:
        lang === 'vi'
          ? 'Toàn bộ quyền lợi gói Pro, cộng thêm:'
          : 'Everything in Pro, plus:',
      items:
        lang === 'vi'
          ? [
              'Không giới hạn bản thảo (1.000 bài/tháng, 500 trang, 100 MB)',
              'Không giới hạn số trích dẫn / bài + Rà soát hàng loạt (50 tệp)',
              'Tích hợp kênh dự phòng SerpAPI Google Scholar cho ấn phẩm chuyên khảo hiếm',
              'Bảng điều khiển Lớp học dành cho Giảng viên & Quyền điều chỉnh nhãn (Override)',
              'Hàng đợi xử lý ưu tiên, Trung tâm Quản trị & Nhật ký Kiểm toán bất biến',
            ]
          : [
              'Unlimited manuscripts (1,000/mo, up to 500 pages, 100 MB)',
              'Unlimited citations per paper + Batch Upload (50 files)',
              'SerpAPI Google Scholar Fallback for obscure monographs',
              'Teacher Classroom Cohort Dashboard & Instructor Override',
              'Admin Control Plane, Priority Queue & Immutable Audit Logs',
            ],
      cta: lang === 'vi' ? 'Khám phá gói Ultra & So sánh' : 'Explore Ultra plan',
      to: '/pricing',
      featured: false,
    },
  ];

  return (
    <section
      id="taxonomy"
      className="scroll-mt-[84px] lg:scroll-mt-[108px] py-[36px] sm:py-[48px] lg:py-[96px] px-5 sm:px-6 lg:px-[40px]"
    >
      <div className="max-w-[1200px] mx-auto flex flex-col items-center gap-[28px] sm:gap-[36px] lg:gap-[64px]">
        {/* Centered Headline */}
        <div className="flex flex-col items-center text-center gap-[16px] max-w-[580px]">
          <SolvaEyebrow centered>
            {lang === 'vi' ? 'Gói dịch vụ & Quyền lợi học thuật' : 'Pricing & Plans'}
          </SolvaEyebrow>
          <SolvaTwoToneHeading
            centered
            primary={
              lang === 'vi' ? 'Chi phí minh bạch.' : 'Simple pricing.'
            }
            secondary={
              lang === 'vi' ? 'Tối ưu cho mọi quy mô nghiên cứu.' : 'No surprises.'
            }
          />
        </div>

        {/* Toggle + 3 Cards Wrapper */}
        <div className="w-full flex flex-col items-center gap-[32px]">
          {/* Solva Squircle Switch (`48x28px`, `border-radius: 8px`, `bg: #ECE9E0`) */}
          <SolvaScrollReveal yOffset={20}>
            <div className="inline-flex items-center gap-[10px]">
              <span
                style={{ color: 'var(--solva-ink)' }}
                className="font-solva-sans text-[15px] sm:text-[16px]"
              >
                {lang === 'vi' ? 'Thanh toán theo tháng' : 'Monthly'}
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={annualBilling}
                aria-label="Toggle billing cycle"
                onClick={() => setAnnualBilling((prev) => !prev)}
                style={{ backgroundColor: 'var(--solva-surface-alt)' }}
                className="w-[48px] h-[28px] rounded-[8px] p-[4px] flex items-center transition-colors cursor-pointer"
              >
                <span
                  style={{
                    backgroundColor: annualBilling
                      ? 'var(--solva-ink)'
                      : 'var(--solva-subtle)',
                    transform: annualBilling ? 'translateX(20px)' : 'translateX(0px)',
                  }}
                  className="w-[20px] h-[20px] rounded-[5px] transition-transform duration-200 ease-out"
                />
              </button>
              <span
                style={{ color: 'var(--solva-ink)' }}
                className="font-solva-sans text-[15px] sm:text-[16px]"
              >
                {lang === 'vi' ? 'Thanh toán theo năm (Tiết kiệm 20%)' : 'Yearly -20%'}
              </span>
            </div>
          </SolvaScrollReveal>

          {/* 3 Plan Cards (`389x483px` equivalent, `bg: #F4F2EC`, `rounded-[16px]`, `p-[32px]`) */}
          <div ref={pricingRef} className="w-full grid grid-cols-1 lg:grid-cols-3 gap-[16px]">
            {tiers.map((tier, idx) => (
              <SolvaScrollReveal
                key={tier.name}
                delayMs={idx * 95}
                yOffset={36}
                className="h-full"
              >
                <div
                  style={{ backgroundColor: 'var(--solva-surface)' }}
                  className="relative rounded-[16px] p-[28px] sm:p-[32px] flex flex-col justify-between gap-[24px] overflow-hidden min-h-[483px] h-full"
                >
                  {/* Radial-Masked Watercolor Floral Background on Middle Popular Card */}
                  {tier.featured && (
                    <>
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
                    </>
                  )}

                  <div className="relative z-10 space-y-[20px]">
                    {/* Top Tier Name + Popular Badge */}
                    <div className="flex items-center justify-between gap-2">
                      <h3
                        style={{ color: 'var(--solva-ink)' }}
                        className={`font-solva-sans text-[20px] ${
                          tier.featured ? 'font-medium' : 'font-normal'
                        } leading-[27px] tracking-[-0.02em]`}
                      >
                        {tier.name}
                      </h3>
                      {tier.badge && (
                        <span
                          style={{
                            backgroundColor: 'var(--solva-btn-bg)',
                            color: 'var(--solva-btn-fg)',
                          }}
                          className="px-[8px] py-[4px] rounded-[6px] font-solva-sans text-[12px] font-medium leading-[12px]"
                        >
                          {tier.badge}
                        </span>
                      )}
                    </div>

                    {/* Price Display (`Sentient` 40px Light) */}
                    <div className="flex items-baseline gap-1.5">
                      <span
                        style={{ color: 'var(--solva-ink)' }}
                        className="font-solva-serif font-light text-[36px] sm:text-[40px] leading-[46px] tracking-[-0.05em]"
                      >
                        <SolvaLiveNumber
                          value={tier.metricNum}
                          prefix="$"
                          replaySeed={pricingSeed}
                          durationMs={1350}
                        />
                      </span>
                      <span
                        style={{
                          color: tier.featured ? 'var(--solva-ink)' : 'var(--solva-muted)',
                        }}
                        className={`font-solva-sans text-[14px] ${
                          tier.featured ? 'font-medium' : ''
                        }`}
                      >
                        / {tier.unit}
                      </span>
                    </div>

                    {/* Description */}
                    <p
                      style={{
                        color: tier.featured ? 'var(--solva-ink)' : 'var(--solva-muted)',
                      }}
                      className={`font-solva-sans text-[15px] sm:text-[16px] leading-[23.2px] ${
                        tier.featured ? 'font-medium' : ''
                      }`}
                    >
                      {tier.desc}
                    </p>

                    {/* Benefits Checklist */}
                    <div className="space-y-[10px] pt-1">
                      <div
                        style={{
                          color: tier.featured ? 'var(--solva-ink)' : 'var(--solva-muted)',
                        }}
                        className={`font-solva-sans text-[14px] ${
                          tier.featured ? 'font-semibold' : ''
                        }`}
                      >
                        {tier.includesLabel}
                      </div>
                      <ul className="space-y-[8px]">
                        {tier.items.map((item) => (
                          <li
                            key={item}
                            className="flex items-start gap-[8px] font-solva-sans text-[14px] leading-[21px]"
                          >
                            <CheckCircle2
                              style={{
                                color: tier.featured
                                  ? 'var(--solva-ink)'
                                  : 'var(--solva-muted)',
                              }}
                              className="w-[17px] h-[17px] mt-[2px] shrink-0"
                            />
                            <span
                              style={{
                                color: tier.featured
                                  ? 'var(--solva-ink)'
                                  : 'var(--solva-muted)',
                              }}
                              className={tier.featured ? 'font-medium' : undefined}
                            >
                              {item}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>

                  {/* Bottom CTA Button */}
                  <div className="relative z-10 pt-2">
                    <SolvaButton
                      to={tier.to}
                      variant={tier.featured ? 'primary' : 'outline'}
                      fullWidth
                    >
                      {tier.cta}
                    </SolvaButton>
                  </div>
                </div>
              </SolvaScrollReveal>
            ))}
          </div>

          {/* Bottom Trust Strip */}
          <SolvaScrollReveal delayMs={120} yOffset={18}>
            <div className="flex flex-col items-center gap-[16px] pt-4 text-center">
              <p
                style={{ color: 'var(--solva-muted)' }}
                className="font-solva-sans text-[14px]"
              >
                {lang === 'vi'
                  ? 'Thanh toán bảo mật qua cổng Stripe · Đối chiếu trực tiếp với hơn 200 triệu ấn phẩm khoa học từ 15+ cơ sở dữ liệu quốc tế'
                  : 'Secured by Stripe · Cross-referencing 200M+ canonical works across 15+ global scholarly indexes'}
              </p>
            </div>
          </SolvaScrollReveal>
        </div>
      </div>
    </section>
  );
}

/* ============================================================
   SECTION 8: CLIENT RESULTS / EMPIRICAL BENCHMARK
   Split Portrait Card + Two-Tone Quote + 3 Animated Counters
   ============================================================ */
function SolvaClientResultsSection({ lang }: { lang: Lang }) {
  return (
    <section className="py-[32px] sm:py-[48px] lg:py-[96px] px-5 sm:px-6 lg:px-[40px]">
      <div className="max-w-[1200px] mx-auto flex flex-col gap-[28px] sm:gap-[36px] lg:gap-[64px]">
        {/* Headline */}
        <div className="flex flex-col items-start gap-[12px]">
          <SolvaEyebrow>
            {lang === 'vi' ? 'Hiệu quả thực tiễn' : 'Real results'}
          </SolvaEyebrow>
          <SolvaTwoToneHeading
            primary={
              lang === 'vi'
                ? 'Khác biệt rõ nét, ngay từ bản thảo đầu tiên.'
                : 'Big results, from the first manuscript.'
            }
          />
        </div>

        {/* Main Split Card (`1200x500px` equivalent, `bg: #F4F2EC`, `rounded-[16px]`, `p-[12px]`) */}
        <SolvaScrollReveal delayMs={80} yOffset={36}>
          <div
            style={{ backgroundColor: 'var(--solva-surface)' }}
            className="w-full rounded-[16px] p-[12px] grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch"
          >
            {/* Left Interactive Cohort Case Study Frame (`442x476px` equivalent) */}
            <div className="lg:col-span-5">
              <SolvaPainterlyFrame
                paintingSrc="/solva/usecase-4-bg.webp"
                alt="Impressionist botanical painting backdrop for cohort thesis audit"
                radiusClass="rounded-[10px]"
                className="w-full min-h-[380px] sm:min-h-[420px] lg:h-[476px] p-4 sm:p-6 flex items-center justify-center"
              >
                <div className="w-full flex items-center justify-center">
                  <CohortBatchAuditWidget lang={lang} />
                </div>
              </SolvaPainterlyFrame>
            </div>

            {/* Right Quote + Metrics (`734x476px` equivalent, `padding: 28px 32px 28px 40px`) */}
            <div className="lg:col-span-7 p-4 sm:p-[28px] lg:pl-[40px] flex flex-col justify-between gap-[32px]">
              {/* Top Two-Tone Quote + Attribution */}
              <div className="space-y-[24px]">
                <div className="flex flex-col sm:flex-row items-start justify-between gap-4">
                  <blockquote className="font-solva-serif font-light text-[24px] sm:text-[30px] leading-[1.25] tracking-[-0.05em] max-w-[520px]">
                    <span style={{ color: 'var(--solva-ink)' }}>
                      {lang === 'vi'
                        ? '“Đầu tuần vừa qua, chúng tôi đưa 120 quyển khóa luận tốt nghiệp vào thẩm định trên CITRA. Chỉ trong một buổi sáng, hệ thống đã khoanh vùng chính xác từng mã DOI ngụy tạo và lệch năm xuất bản — '
                        : '“We ran CITRA across 120 graduation theses on Monday morning. Within an hour, it pinpointed every hallucinated DOI and year drift '}
                    </span>
                    <span style={{ color: 'var(--solva-muted)' }}>
                      {lang === 'vi'
                        ? 'những sai sót mà trước đây cả hội đồng phải mất hàng tuần tra cứu thủ công.”'
                        : 'that used to take our review committee weeks to check by hand.”'}
                    </span>
                  </blockquote>

                  <div
                    style={{ color: 'var(--solva-ink)' }}
                    className="font-solva-sans text-[16px] font-medium tracking-tight shrink-0 flex items-center gap-1.5"
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
                      ? 'Hội đồng Thẩm định Khóa luận & Đạo đức Học thuật'
                      : 'Dr. Elena Rostova'}
                  </div>
                  <div
                    style={{ color: 'var(--solva-muted)' }}
                    className="font-solva-sans text-[14px] leading-[21px]"
                  >
                    {lang === 'vi'
                      ? 'Khoa Khoa học Máy tính & Trí tuệ Nhân tạo'
                      : 'Chair of Graduate Thesis Review Committee'}
                  </div>
                </div>
              </div>

              {/* Bottom 3 Count-Up Metrics (`Sentient` 40px Light) */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 sm:gap-[40px] pt-4 border-t border-[#E7E3D9] dark:border-[#332F26]">
                <SolvaAnimatedMetric
                  targetValue={120}
                  suffix="K"
                  decimals={0}
                  label={
                    lang === 'vi'
                      ? 'Công trình khoa học kiểm định thực nghiệm'
                      : 'Scholarly papers in benchmark audit'
                  }
                />
                <SolvaAnimatedMetric
                  targetValue={98.6}
                  suffix="%"
                  decimals={1}
                  label={
                    lang === 'vi'
                      ? 'Độ chính xác Neuro-Symbolic (Macro-F1 0.976)'
                      : 'Neuro-Symbolic accuracy (0.976 F1)'
                  }
                />
                <SolvaAnimatedMetric
                  targetValue={100}
                  suffix="%"
                  decimals={0}
                  label={
                    lang === 'vi'
                      ? 'Độ chuẩn xác bắt trích dẫn ngụy tạo (0 kết luận oan)'
                      : 'Hallucination precision (0 false flags)'
                  }
                />
              </div>
            </div>
          </div>
        </SolvaScrollReveal>
      </div>
    </section>
  );
}

/* ============================================================
   SECTION 9: ROLE WORKSPACES & ACADEMIC TESTIMONIALS (`#workspaces`)
   Solva's 3-Column Staggered Grid (Middle Column Offset by `48px`)
   ============================================================ */
function SolvaRoleTestimonialsSection({ lang }: { lang: Lang }) {
  const columns = [
    // Column 1 (padding-top: 0px)
    [
      {
        roleBadge: lang === 'vi' ? 'KHÔNG GIAN SINH VIÊN' : 'STUDENT WORKSPACE',
        quote:
          lang === 'vi'
            ? '“Trước ngày nộp quyển khóa luận, mình đưa bản PDF lên CITRA rà soát lần cuối và phát hiện 3 tài liệu bị ghi nhầm năm của bản nháp arXiv thay vì năm công bố chính thức trên IEEE Xplore.”'
            : '“Before submitting my thesis, I ran my PDF through CITRA and caught three arXiv-to-conference year mismatches in under two minutes.”',
        author: lang === 'vi' ? 'Minh Quân' : 'Marcus Chen',
        role:
          lang === 'vi'
            ? 'Học viên Cao học Khoa học Máy tính · Khóa luận Tốt nghiệp'
            : 'M.Sc. Computer Science Candidate',
      },
      {
        roleBadge: lang === 'vi' ? 'SINH VIÊN · LIVE SANDBOX' : 'STUDENT · LIVE SANDBOX',
        quote:
          lang === 'vi'
            ? '“Tiện lợi nhất là chế độ Live Sandbox: chỉ cần dán nhanh một đoạn tổng quan tài liệu kèm danh mục tham khảo là kiểm chứng được ngay, không phải chờ biên dịch lại toàn bộ dự án LaTeX.”'
            : '“The Live Sandbox lets me paste a single literature review section and verify every reference on the spot without compiling my full LaTeX PDF.”',
        author: lang === 'vi' ? 'Thanh Thảo' : 'Sophia Nguyen',
        role:
          lang === 'vi'
            ? 'Nghiên cứu sinh Tin Sinh học'
            : 'Biomedical Informatics Researcher',
      },
      {
        roleBadge: lang === 'vi' ? 'THEO DÕI TIẾN ĐỘ SỬA BÀI' : 'REVISION TRACKER',
        quote:
          lang === 'vi'
            ? '“Biểu đồ theo dõi qua từng phiên bản chỉnh sửa giúp mình minh chứng trực quan với thầy hướng dẫn rằng Điểm Toàn vẹn Trích dẫn (CIS) của bản thảo đã tăng từ 71% ở bản nháp đầu lên 98% ở bản nộp cuối.”'
            : '“The Revision Progress Tracker showed my advisor how my Citation Integrity Score improved from 71% in Draft 1 to 98% in my final submission.”',
        author: lang === 'vi' ? 'Hoàng Nam' : 'David Alverez',
        role:
          lang === 'vi'
            ? 'Sinh viên Chương trình Cử nhân Tài năng'
            : 'Undergraduate Honors Thesis Author',
      },
    ],
    // Column 2 (Staggered 48px lower on Desktop: `lg:pt-[48px]`)
    [
      {
        roleBadge: lang === 'vi' ? 'KHÔNG GIAN GIẢNG VIÊN' : 'TEACHER CLASSROOM',
        quote:
          lang === 'vi'
            ? '“Thay vì phải tự tay sao chép từng tiêu đề vào Google Scholar cho cả lớp 40 sinh viên làm đồ án, giờ đây tôi có ngay bức tranh tổng thể về các trích dẫn đáng ngờ trên một bảng điều khiển duy nhất.”'
            : '“Instead of manually copying titles into Google Scholar across 40 student submissions, I see cohort-wide hallucination alerts in one dashboard.”',
        author: lang === 'vi' ? 'PGS.TS. Trần Hải' : 'Prof. Arthur Pendelton',
        role:
          lang === 'vi'
            ? 'Giảng viên Hướng dẫn & Phản biện Luận văn'
            : 'Thesis Advisor & Faculty Reviewer',
      },
      {
        roleBadge: lang === 'vi' ? 'GIẢNG VIÊN · ĐIỀU CHỈNH NHÃN' : 'INSTRUCTOR OVERRIDE',
        quote:
          lang === 'vi'
            ? '“Khi sinh viên trích dẫn các ấn phẩm chuyên khảo in trong nước chưa có mã DOI quốc tế, tôi có thể chủ động xác nhận hợp lệ (Override) chỉ bằng một cú nhấp kèm ghi chú chuyên môn cho hội đồng.”'
            : '“When a student cites a print-only regional monograph, I can override the UNVERIFIABLE status with one click and attach my review note.”',
        author: lang === 'vi' ? 'TS. Lê Thu Hà' : 'Dr. Hannah Lindqvist',
        role:
          lang === 'vi'
            ? 'Chủ tịch Hội đồng Chấm Khóa luận Tốt nghiệp'
            : 'Senior Lecturer in Computational Linguistics',
      },
      {
        roleBadge: lang === 'vi' ? 'THẨM ĐỊNH ĐỒNG THUẬN NLI' : 'DeBERTa-v3 NLI STANCE',
        quote:
          lang === 'vi'
            ? '“Điểm đắt giá nhất đối với người làm phản biện là mô-đun DeBERTa NLI: hệ thống chỉ ra ngay những vị trí bài báo được trích dẫn có thật, nhưng kết luận trong tóm tắt gốc lại bác bỏ hoàn toàn nhận định của người viết.”'
            : '“DeBERTa NLI stance detection is a game changer — it flags cases where a real paper is cited, but the abstract actually refutes the student’s claim.”',
        author: lang === 'vi' ? 'TS. Nguyễn Hoàng' : 'Dr. Liam O’Connor',
        role:
          lang === 'vi'
            ? 'Chuyên gia Phương pháp luận & Phản biện Tạp chí'
            : 'Peer Review Methodologist',
      },
    ],
    // Column 3 (padding-top: 0px)
    [
      {
        roleBadge: lang === 'vi' ? 'TRUNG TÂM QUẢN TRỊ' : 'ADMIN CONTROL',
        quote:
          lang === 'vi'
            ? '“Phân hệ Quản trị mang lại tầm nhìn thời gian thực về sức khỏe cụm máy chủ GROBID, tỷ lệ trúng bộ nhớ đệm SQLite FTS5, độ trễ của 15 API học thuật và nhật ký kiểm toán bất biến.”'
            : '“The Admin Control plane gives us live health diagnostics for our GROBID container, SQLite FTS5 cache hit rates, and an immutable audit trail.”',
        author: lang === 'vi' ? 'Đội ngũ Kỹ thuật CITRA' : 'Victor K.',
        role:
          lang === 'vi'
            ? 'Quản trị Hạ tầng Công nghệ Học thuật'
            : 'Academic Infrastructure Administrator',
      },
      {
        roleBadge: lang === 'vi' ? 'TRUY HỒI LIÊN HỢP 15+ NGUỒN' : 'FEDERATED RETRIEVAL',
        quote:
          lang === 'vi'
            ? '“Sự kết hợp nhịp nhàng giữa Crossref, OpenAlex, PubMed, arXiv và DBLP giúp độ bao phủ thư mục trải rộng liền mạch từ khối ngành Kỹ thuật – Máy tính cho tới Y Sinh học.”'
            : '“Combining Crossref, OpenAlex, PubMed, arXiv, and DBLP gives us seamless bibliographic coverage across both STEM and biomedical faculties.”',
        author: lang === 'vi' ? 'ThS. Phạm Khôi' : 'Dr. Priya Nair',
        role:
          lang === 'vi'
            ? 'Trưởng bộ phận Hệ thống Thư viện Số'
            : 'Digital Library Systems Lead',
      },
      {
        roleBadge: lang === 'vi' ? 'MÔ HÌNH 2 TẦNG TRỰC GIAO' : 'ORTHOGONAL MODEL',
        quote:
          lang === 'vi'
            ? '“Nhờ tách bạch Tầng 1 (Quy cách dẫn nguồn nội bộ) và Tầng 2 (Sự tồn tại học thuật bên ngoài), phản hồi gửi tới sinh viên mang tính hướng dẫn xây dựng rõ ràng thay vì quy chụp nặng nề.”'
            : '“Separating Layer 1 formatting consistency from Layer 2 bibliographic existence makes feedback constructive rather than punitive.”',
        author: lang === 'vi' ? 'TS. Vũ Đăng' : 'Prof. Claire Beaumont',
        role:
          lang === 'vi'
            ? 'Giám đốc Trung tâm Hỗ trợ Viết Học thuật'
            : 'Director of Academic Writing Center',
      },
    ],
  ];

  return (
    <section
      id="workspaces"
      className="scroll-mt-[84px] lg:scroll-mt-[108px] py-[32px] sm:py-[48px] lg:py-[96px] px-5 sm:px-6 lg:px-[40px]"
    >
      <div className="max-w-[1200px] mx-auto flex flex-col gap-[28px] sm:gap-[36px] lg:gap-[64px]">
        {/* Headline */}
        <div className="flex flex-col items-start gap-[12px] max-w-[540px]">
          <SolvaEyebrow>
            {lang === 'vi'
              ? 'Được tin dùng bởi cộng đồng học thuật'
              : 'Loved by academic teams'}
          </SolvaEyebrow>
          <SolvaTwoToneHeading
            primary={
              lang === 'vi' ? 'Trút bỏ gánh nặng rà soát thủ công,' : 'Less busywork,'
            }
            secondary={
              lang === 'vi'
                ? 'dành trọn tâm huyết cho chiều sâu học thuật.'
                : 'more breathing room.'
            }
          />
        </div>

        {/* 3-Column Staggered Masonry Grid (`gap: 12px`, Middle Column `lg:pt-[48px]`) */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-[12px] items-start">
          {columns.map((col, colIdx) => (
            <div
              key={colIdx}
              className={`flex flex-col gap-[12px] ${
                colIdx === 1 ? 'lg:pt-[48px]' : ''
              }`}
            >
              {col.map((card, cardIdx) => (
                <SolvaScrollReveal
                  key={card.author}
                  delayMs={colIdx * 75 + cardIdx * 55}
                  yOffset={30}
                >
                  <div
                    style={{ backgroundColor: 'var(--solva-surface)' }}
                    className="rounded-[12px] p-[20px] sm:p-[24px] min-h-[200px] sm:min-h-[230px] lg:h-[280px] flex flex-col justify-between gap-[20px] sm:gap-[24px]"
                  >
                    <div className="space-y-[20px]">
                      <div className="flex items-center justify-between">
                        <span
                          style={{
                            backgroundColor: 'var(--solva-bg)',
                            color: 'var(--solva-muted)',
                          }}
                          className="px-2.5 py-1 rounded-[6px] font-mono text-[11px] font-medium"
                        >
                          {card.roleBadge}
                        </span>
                      </div>
                      <p
                        style={{ color: 'var(--solva-ink)' }}
                        className="font-solva-sans text-[17px] sm:text-[18px] font-normal leading-[25.2px]"
                      >
                        {card.quote}
                      </p>
                    </div>

                    <div className="space-y-[2px]">
                      <div
                        style={{ color: 'var(--solva-ink)' }}
                        className="font-solva-sans text-[14px] font-medium leading-[21px]"
                      >
                        {card.author}
                      </div>
                      <div
                        style={{ color: 'var(--solva-muted)' }}
                        className="font-solva-sans text-[14px] leading-[21px]"
                      >
                        {card.role}
                      </div>
                    </div>
                  </div>
                </SolvaScrollReveal>
              ))}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ============================================================
   SECTION 10: FAQ (`#faq`)
   2-Column Independent Accordion (`592px` Left + `592px` Right, `gap: 16px`)
   ============================================================ */
function SolvaFAQSection({ lang }: { lang: Lang }) {
  const [openIds, setOpenIds] = useState<Record<string, boolean>>({
    'faq-0': true,
  });

  const toggleFaq = (id: string) => {
    setOpenIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const leftFaqs = [
    {
      id: 'faq-0',
      q:
        lang === 'vi'
          ? 'CITRA khác biệt như thế nào so với các phần mềm kiểm tra trùng lặp văn bản truyền thống (như Turnitin)?'
          : 'How is CITRA different from traditional plagiarism checkers like Turnitin?',
      a:
        lang === 'vi'
          ? 'Các phần mềm đạo văn truyền thống chỉ dừng ở việc so khớp tỷ lệ trùng lặp câu chữ bề mặt. Ngược lại, CITRA đi sâu thẩm định tính chân thực của từng tài liệu tham khảo: phân giải định danh DOI, đối chiếu chéo trên hơn 15 cơ sở dữ liệu khoa học quốc tế để vạch trần các trích dẫn ngụy tạo do AI sinh ra (Hallucinated Citations), đồng thời sử dụng mô hình DeBERTa NLI để kiểm chứng xem tóm tắt bài báo gốc có thực sự hậu thuẫn cho nhận định trong bài viết hay không.'
          : 'Traditional tools only check text overlap. CITRA verifies bibliographic truth: resolving DOIs, cross-checking 15+ scholarly indexes to catch AI-hallucinated references, and running DeBERTa NLI to verify whether cited abstracts actually support the in-text claim.',
    },
    {
      id: 'faq-1',
      q:
        lang === 'vi'
          ? 'Mô hình 2 tầng trực giao (Two-Layer Orthogonal Model) vận hành ra sao?'
          : 'How does the Two-Layer Orthogonal Output Model work?',
      a:
        lang === 'vi'
          ? 'CITRA tách biệt hai chiều thẩm định hoàn toàn độc lập: Tầng 1 kiểm tra tính nhất quán nội bộ giữa ký hiệu trích dẫn trong bài và danh mục tài liệu cuối bài (với 7 trạng thái như MATCHED, MISSING_REFERENCE, UNCITED_REFERENCE). Tầng 2 độc lập xác minh sự tồn tại thực tế của công trình trên các cơ sở dữ liệu học thuật toàn cầu (với 8 nhãn phán quyết như VERIFIED, METADATA_ERROR, SUSPECTED_HALLUCINATION).'
          : 'Layer 1 audits internal manuscript consistency between in-text markers and the bibliography (7 states including MATCHED, MISSING_REFERENCE, UNCITED_REFERENCE). Layer 2 independently audits external bibliographic existence across 15+ APIs (8 verdicts including VERIFIED, METADATA_ERROR, SUSPECTED_HALLUCINATION).',
    },
    {
      id: 'faq-2',
      q:
        lang === 'vi'
          ? 'Hệ thống hỗ trợ những quy chuẩn định dạng trích dẫn học thuật nào?'
          : 'Which academic citation styles does CITRA support?',
      a:
        lang === 'vi'
          ? 'Nhờ kết hợp mô hình học sâu GROBID TEI-XML cùng bộ kiểm định chéo đa quy chuẩn (Multi-Style Cross-Validator), CITRA xử lý chính xác cả nhóm định dạng đánh số như IEEE ([1], [2]–[5]), Vancouver, ACM lẫn nhóm định dạng Tác giả – Năm như APA 7th, Harvard, Chicago và MLA.'
          : 'Through GROBID TEI-XML paired with our multi-style cross-validator, CITRA supports numbered styles (IEEE [1]–[5], Vancouver, ACM) as well as author-year formats (APA 7th, Harvard, Chicago, MLA).',
    },
  ];

  const rightFaqs = [
    {
      id: 'faq-3',
      q:
        lang === 'vi'
          ? 'CITRA có tự động đánh trượt hay quy kết sinh viên vi phạm liêm chính học thuật không?'
          : 'Does CITRA automatically accuse students of academic misconduct?',
      a:
        lang === 'vi'
          ? `Tuyệt đối không. CITRA được thiết kế nhất quán theo triết lý Hệ thống Hỗ trợ Ra Quyết định (Decision-Support System). Hệ thống cung cấp bằng chứng đối chiếu thư mục khách quan cùng vết suy diễn hình thức ${SYMBOLIC_RULES_RANGE} để giảng viên và hội đồng xem xét; quyền phán quyết cuối cùng luôn thuộc về con người.`
          : `Never. CITRA is strictly a Decision-Support System. It surfaces verifiable bibliographic evidence and formal ${SYMBOLIC_RULES_RANGE} rule traces for human reviewers. Instructors can override any verdict with an audited rationale.`,
    },
    {
      id: 'faq-4',
      q:
        lang === 'vi'
          ? 'Hệ thống xử lý thế nào khi tài liệu tham khảo là sách chuyên khảo in trong nước hoặc ấn phẩm chưa có mã DOI?'
          : 'What happens when a citation refers to an offline book or regional paper without a DOI?',
      a:
        lang === 'vi'
          ? 'Thay vì kết luận oan là trích dẫn ngụy tạo, hệ quy tắc suy diễn của CITRA sẽ chủ động khoanh vùng tài liệu đó vào trạng thái UNVERIFIABLE / UNRESOLVED (Cần thẩm định thủ công), giúp giảng viên hướng dẫn dễ dàng rà soát và xác nhận hợp lệ chỉ với một thao tác.'
          : 'Rather than falsely flagging it as hallucinated, CITRA’s symbolic rule engine classifies offline or non-indexed works as UNVERIFIABLE, queuing them cleanly for instructor review.',
    },
    {
      id: 'faq-5',
      q:
        lang === 'vi'
          ? 'Cần bao nhiêu thời gian để thẩm định hoàn chỉnh một quyển khóa luận hoặc bài báo PDF?'
          : 'How long does it take to verify a full PDF manuscript?',
      a:
        lang === 'vi'
          ? 'Nhờ kiến trúc truy vấn bất đồng bộ song song trên hơn 15 API quốc tế kết hợp chỉ mục đệm cục bộ SQLite FTS5, một bản thảo tiêu chuẩn gồm 25–40 tài liệu tham khảo thường hoàn tất trọn vẹn cả 4 giai đoạn thẩm định chỉ trong vòng 10 đến 25 giây.'
          : 'With async parallel querying across 15+ APIs and local SQLite FTS5 caching, a standard manuscript with 25–40 references completes all four verification stages in 10 to 25 seconds.',
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
      id="faq"
      className="scroll-mt-[84px] lg:scroll-mt-[108px] py-[32px] sm:py-[48px] lg:py-[96px] px-5 sm:px-6 lg:px-[40px]"
    >
      <div className="max-w-[1200px] mx-auto flex flex-col gap-[28px] sm:gap-[36px] lg:gap-[64px]">
        {/* Headline */}
        <div className="flex flex-col items-start gap-[12px] max-w-[460px]">
          <SolvaEyebrow>{lang === 'vi' ? 'Giải đáp thắc mắc' : 'FAQ'}</SolvaEyebrow>
          <SolvaTwoToneHeading
            primary={
              lang === 'vi' ? 'Mọi băn khoăn học thuật.' : 'You have questions.'
            }
            secondary={
              lang === 'vi' ? 'Đều được giải đáp tường tận.' : 'We have answers.'
            }
          />
        </div>

        {/* 2 Independent Accordion Columns (`592px` each on Desktop, `gap: 16px`) */}
        <div className="flex flex-col lg:flex-row items-start gap-[16px]">
          {renderColumn(leftFaqs, 0)}
          {renderColumn(rightFaqs, 75)}
        </div>
      </div>
    </section>
  );
}

/* ============================================================
   SECTION 11: BOTTOM CTA BANNER (`1200x400px` Split Painterly Card)
   ============================================================ */
function SolvaBottomCTASection({
  lang,
  isAuthenticated,
}: {
  lang: Lang;
  isAuthenticated: boolean;
}) {
  return (
    <section className="pt-[28px] pb-[36px] sm:py-[48px] lg:py-[96px] px-5 sm:px-6 lg:px-[40px]">
      <div className="max-w-[1200px] mx-auto">
        <SolvaScrollReveal yOffset={36}>
          <div
            style={{ backgroundColor: 'var(--solva-surface)' }}
            className="w-full rounded-[16px] p-[12px] grid grid-cols-1 lg:grid-cols-12 items-center gap-6"
          >
            {/* Left Editorial Content (`588x275px` equivalent, `padding: 24px 36px`) */}
            <div className="lg:col-span-6 p-5 sm:p-[32px] flex flex-col items-start gap-[24px]">
              <div className="space-y-[16px]">
                <SolvaTwoToneHeading
                  primary={
                    lang === 'vi'
                      ? 'Trao điểm tựa chuẩn xác'
                      : 'Give your research'
                  }
                  secondary={
                    lang === 'vi'
                      ? 'cho từng công trình nghiên cứu của bạn.'
                      : 'verifiable integrity.'
                  }
                />
                <p
                  style={{ color: 'var(--solva-muted)' }}
                  className="font-solva-sans text-[16px] font-normal leading-[23.2px] max-w-[420px]"
                >
                  {lang === 'vi'
                    ? 'Tải lên bản thảo PDF hoặc dán danh mục tài liệu tham khảo vào Live Sandbox. Nhận ngay báo cáo thẩm định 2 tầng trực giao kèm chuỗi lập luận Neuro-Symbolic chỉ sau vài giây.'
                    : 'Upload your PDF manuscript or paste references into the Live Sandbox. Get a complete two-layer verification report in seconds.'}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <SolvaButton
                  to={isAuthenticated ? '/upload' : '/login'}
                  variant="primary"
                >
                  {isAuthenticated
                    ? lang === 'vi'
                      ? 'Vào Không gian Thẩm định'
                      : 'Go to Verification Workspace'
                    : lang === 'vi'
                      ? 'Bắt đầu miễn phí'
                      : 'Get started free'}
                </SolvaButton>
                <SolvaButton to="/pricing" variant="outline">
                  {lang === 'vi' ? 'So sánh các gói dịch vụ' : 'Compare plans'}
                </SolvaButton>
              </div>
            </div>

            {/* Right Painterly Frame (`588x376px` equivalent) */}
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
  );
}

/* ============================================================
   SECTION 12: FOOTER (Full-Bleed `#F4F2EC`, 4 Menu Columns)
   ============================================================ */
function SolvaFooter({ lang }: { lang: Lang }) {
  const columns = [
    {
      header: lang === 'vi' ? 'Nền tảng' : 'Product',
      links: [
        { label: lang === 'vi' ? 'Thực nghiệm 120K bài báo' : '120K-Paper Benchmark', href: '#benchmark-120k' },
        { label: lang === 'vi' ? 'Kiểm nghiệm trích dẫn' : 'Citation Debugger', href: '#interactive-demo' },
        { label: lang === 'vi' ? 'Kiến trúc 2 tầng (L1 × L2)' : '2-Layer Architecture', href: '#architecture' },
        { label: lang === 'vi' ? 'Quy trình 4 giai đoạn' : 'Verification Pipeline', href: '#how-it-works' },
        { label: lang === 'vi' ? 'Gói dịch vụ & Quyền lợi' : 'Pricing & Benefits', href: '#taxonomy' },
      ],
    },
    {
      header: lang === 'vi' ? 'Không gian học thuật' : 'Workspaces',
      links: [
        { label: lang === 'vi' ? 'Dành cho Sinh viên & Tác giả' : 'Student Workspace', href: '#workspaces' },
        { label: lang === 'vi' ? 'Dành cho Giảng viên & Hội đồng' : 'Teacher Classroom', href: '#workspaces' },
        { label: lang === 'vi' ? 'Trung tâm Quản trị' : 'Admin Control', href: '#workspaces' },
        { label: lang === 'vi' ? 'Bảng giá chi tiết' : 'Pricing Plans', to: '/pricing' },
      ],
    },
    {
      header: lang === 'vi' ? 'Công nghệ cốt lõi' : 'Technology',
      links: [
        { label: 'GROBID TEI-XML', href: '#how-it-works' },
        { label: lang === 'vi' ? 'Liên hợp 15+ API Khoa học' : '15+ Scholarly APIs', href: '#architecture' },
        { label: lang === 'vi' ? 'Hệ quy tắc Neuro-Symbolic' : 'Neuro-Symbolic Rules', href: '#interactive-demo' },
        { label: lang === 'vi' ? 'Thẩm định ngữ nghĩa DeBERTa NLI' : 'DeBERTa-v3 NLI Stance', href: '#how-it-works' },
      ],
    },
    {
      header: lang === 'vi' ? 'Tài khoản' : 'Account',
      links: [
        { label: lang === 'vi' ? 'Đăng nhập' : 'Sign in', to: '/login' },
        { label: lang === 'vi' ? 'Đăng ký tài khoản' : 'Create account', to: '/register' },
        { label: lang === 'vi' ? 'Câu hỏi thường gặp' : 'FAQ', href: '#faq' },
        {
          label:
            lang === 'vi'
              ? 'Chính sách bảo vệ dữ liệu'
              : 'Personal Data Policy',
          to: '/privacy',
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
        {/* Top Row: Brand Info (389px) + 4 Columns (779px) */}
        <div className="flex flex-col lg:flex-row items-start justify-between gap-[28px] sm:gap-[36px] lg:gap-[32px]">
          {/* Left Brand Info */}
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
              className="font-solva-sans text-[16px] font-normal leading-[23.2px] max-w-[310px]"
            >
              {lang === 'vi'
                ? 'Nền tảng thẩm định nguồn trích dẫn học thuật đa nguồn, vận hành trên kiến trúc Neuro-Symbolic hai tầng trực giao.'
                : 'Academic source verification workspace powered by a two-layer Neuro-Symbolic and 15+ API engine.'}
            </p>
          </div>

          {/* Right 4 Navigation Columns */}
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

        {/* Bottom Copyright Bar (`border-top: 1px solid #E7E3D9`) */}
        <div
          style={{ borderColor: 'var(--solva-border)' }}
          className="pt-[20px] sm:pt-[32px] border-t flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-4 font-solva-sans text-[14px] sm:text-[16px]"
        >
          <p style={{ color: 'var(--solva-muted)' }}>
            {lang === 'vi'
              ? '© 2026 CITRA · Không gian Thẩm định Liêm chính Học thuật SourceLogic. Bảo lưu mọi quyền.'
              : '© 2026 CITRA · SourceLogic Academic Integrity Workspace. All rights reserved.'}
          </p>
          <p style={{ color: 'var(--solva-muted)' }}>
            {lang === 'vi'
              ? 'Hệ thống hỗ trợ quyết định học thuật — đồng hành cùng giảng viên, không thay thế phán quyết của con người.'
              : 'Decision-Support System — assists scholarly review, never replaces human judgment.'}
          </p>
        </div>
      </div>
    </footer>
  );
}
