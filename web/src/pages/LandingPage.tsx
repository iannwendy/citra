import { useState, useEffect, useContext, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AuthContext } from '@/contexts/AuthContext';
import {
  SYMBOLIC_RULES_COUNT,
  SYMBOLIC_RULES_RANGE,
} from '@/lib/productFacts';
import {
  getPlainVerdictLabel,
  getPlainMappingLabel,
} from '@/lib/verdictExplanation';
import {
  FileSearch,
  Database,
  Shield,
  ArrowRight,
  ArrowDown,
  CheckCircle2,
  GitBranch,
  Scale,
  AlertTriangle,
  XCircle,
  Layers,
  FileText,
  Users,
  GraduationCap,
  Check,
  Cpu,
  ChevronRight,
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
import {
  IconSwap,
  NumberPopIn,
  SoftTextSwap,
  TactileToggle,
  DirectionalStageSlide,
  SymmetricChevron,
  LearnMoreChevron,
  UIGenerationReveal,
  useSlidingPill,
  useExitPresence,
} from '@/components/ui/transitions';
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
import { GuestInstantChecker } from '@/components/landing/GuestInstantChecker';

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
    nameVi?: string;
    status: 'matched' | 'partial' | 'none';
    latency: string;
    score: string;
    scoreVi?: string;
  }>;
  rules: Array<{
    code: string;
    name: string;
    nameVi?: string;
    plainTitleEn: string;
    plainTitleVi: string;
    plainSummaryEn: string;
    plainSummaryVi: string;
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
      { name: 'arXiv', status: 'matched', latency: '39ms', score: '100%' },
    ],
    rules: [
      {
        code: 'R01_EXACT_DOI',
        name: 'Canonical DOI Resolution',
        nameVi: 'Xác thực định danh DOI chuẩn',
        plainTitleEn: 'Official DOI Link Confirmed',
        plainTitleVi: 'Mã DOI trỏ đúng tới bài báo gốc',
        plainSummaryEn:
          'The DOI in your reference list opens the exact same paper title in official registries.',
        plainSummaryVi:
          'Mã DOI bạn ghi mở ra đúng bài báo có cùng tiêu đề trên hệ thống đăng ký quốc tế.',
        condition: 'cited.doi == canonical.doi ∧ title_sim >= 0.95',
        status: 'passed',
      },
      {
        code: 'R04_AUTHOR_OVERLAP',
        name: 'Primary Author Surname Verification',
        nameVi: 'Đối chiếu danh sách họ tên tác giả',
        plainTitleEn: 'All Listed Authors Match',
        plainTitleVi: 'Trùng khớp danh sách tác giả',
        plainSummaryEn:
          'Every author surname in your bibliography matches the published author list.',
        plainSummaryVi:
          'Họ tên các tác giả trong danh mục của bạn khớp hoàn toàn với hồ sơ xuất bản chính thức.',
        condition: 'jaccard(cited.authors, canonical.authors) == 1.00',
        status: 'passed',
      },
      {
        code: 'R09_SEMANTIC_ALIGN',
        name: 'Sentence-BERT + Multilingual MiniLM ONNX INT8 Alignment',
        nameVi: 'Đối sánh ngữ nghĩa (Sentence-BERT + Multilingual MiniLM ONNX INT8)',
        plainTitleEn: 'Paper Abstract Supports Your Sentence',
        plainTitleVi: 'Tóm tắt bài gốc củng cố đúng ý trích dẫn',
        plainSummaryEn:
          'The cited paper’s abstract directly backs your statement about self-attention in Transformers (96% content match).',
        plainSummaryVi:
          'Nội dung tóm tắt của bài báo gốc hoàn toàn phù hợp với câu bạn viết trong bài (độ khớp nội dung 96%).',
        condition: 'cosine_sim(context, abstract) == ALIGNED (0.96)',
        status: 'passed',
      },
    ],
    explanation: {
      en: 'Confirmed across 4 independent academic libraries with 100% matching title, authors, year, and DOI. The paper’s abstract directly supports your cited claim.',
      vi: 'Đã xác nhận khớp 100% tiêu đề, tác giả, năm xuất bản và mã DOI trên 4 thư viện học thuật độc lập. Tóm tắt của công trình gốc củng cố trực tiếp cho ý bạn viết.',
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
        plainTitleEn: 'Real Paper Found via DOI',
        plainTitleVi: 'Tìm thấy bài báo thật qua mã DOI',
        plainSummaryEn:
          'DOI 10.18653/v1/N19-1423 is valid and points to the official BERT paper in ACL Anthology.',
        plainSummaryVi:
          'Mã DOI 10.18653/v1/N19-1423 hợp lệ và trỏ đúng tới bài báo BERT trên kho ACL Anthology.',
        condition: 'DOI 10.18653/v1/N19-1423 resolves to ACL Anthology work',
        status: 'passed',
      },
      {
        code: 'R05_YEAR_DRIFT',
        name: 'Publication Year Discrepancy',
        nameVi: 'Sai lệch năm công bố (Bản nháp vs. Kỷ yếu)',
        plainTitleEn: 'Publication Year Off by 1 Year (2018 vs. 2019)',
        plainTitleVi: 'Lệch 1 năm xuất bản (ghi 2018 thay vì 2019)',
        plainSummaryEn:
          'Your draft cites the 2018 online preprint year, whereas the official conference proceedings were published in 2019.',
        plainSummaryVi:
          'Bạn đang ghi năm bản nháp trực tuyến (2018), trong khi bài kỷ yếu chính thức được xuất bản năm 2019.',
        condition: '|cited.year (2018) - canonical.year (2019)| == 1 (arXiv vs Proc.)',
        status: 'warning',
      },
      {
        code: 'R07_VENUE_MISMATCH',
        name: 'Venue / Container Title Drift',
        nameVi: 'Sai lệch tên Hội nghị / Tạp chí công bố',
        plainTitleEn: 'Wrong Conference Name Listed',
        plainTitleVi: 'Ghi nhầm tên hội nghị công bố',
        plainSummaryEn:
          'Listed as EMNLP, but the official publication venue is NAACL-HLT 2019.',
        plainSummaryVi:
          'Danh mục đang ghi hội nghị EMNLP, nhưng nơi công bố chính thức là NAACL-HLT 2019.',
        condition: 'cited.venue ("EMNLP") != canonical.venue ("NAACL-HLT")',
        status: 'failed',
      },
    ],
    explanation: {
      en: 'This paper is real and its DOI is valid, but your entry cites the 2018 draft year and lists the wrong conference (EMNLP instead of NAACL-HLT 2019).',
      vi: 'Bài báo này hoàn toàn có thật với mã DOI hợp lệ, nhưng mục tham khảo đang ghi nhầm năm bản nháp (2018) và nhầm tên hội nghị (ghi EMNLP thay vì NAACL-HLT 2019).',
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
        plainTitleEn: 'DOI Link Does Not Exist (Error 404)',
        plainTitleVi: 'Mã DOI không tồn tại trên hệ thống quốc tế',
        plainSummaryEn:
          'Looking up DOI 10.1038/s42256-024-99812-x returns “Not Found” across official DOI registries.',
        plainSummaryVi:
          'Tra cứu mã DOI 10.1038/s42256-024-99812-x trả về kết quả không tồn tại trên toàn bộ hệ thống đăng ký DOI.',
        condition: 'DOI 10.1038/s42256-024-99812-x returns HTTP 404 in Crossref/Handle',
        status: 'failed',
      },
      {
        code: 'R14_ZERO_TITLE_HIT',
        name: 'No Bibliographic Title Match Across 15+ APIs',
        nameVi: 'Không tìm thấy công trình trùng khớp trên 15+ CSDL học thuật',
        plainTitleEn: 'No Matching Title Across 15+ Libraries',
        plainTitleVi: 'Không tìm thấy bài báo nào trùng tên trên 15+ thư viện',
        plainSummaryEn:
          'No article with this title or author pair appears in Crossref, OpenAlex, PubMed, or Semantic Scholar.',
        plainSummaryVi:
          'Không có công trình nào mang tiêu đề và cặp tác giả này trên Crossref, OpenAlex, PubMed hay Semantic Scholar.',
        condition: 'max_similarity(title, all_candidates) == 0.11 < threshold (0.45)',
        status: 'failed',
      },
      {
        code: 'R16_SYNTHETIC_PATTERN',
        name: 'Fabricated Reference Signature',
        nameVi: 'Dấu hiệu ghép nối nhân tạo của trích dẫn ảo (AI Hallucination)',
        plainTitleEn: 'Typical AI-Invented Citation Pattern',
        plainTitleVi: 'Dấu hiệu điển hình của nguồn do AI tự bịa',
        plainSummaryEn:
          'Combines a real journal name (Nature Machine Intelligence) with an invented article number and title.',
        plainSummaryVi:
          'Ghép tên một tạp chí uy tín có thật (Nature Machine Intelligence) với mã số bài báo và tiêu đề không tồn tại.',
        condition: 'Valid journal prefix (10.1038) paired with non-existent article suffix',
        status: 'failed',
      },
    ],
    explanation: {
      en: 'Likely AI-invented reference: pairs a real journal name (Nature Machine Intelligence) with a non-existent DOI link and an article title not found in any academic library.',
      vi: 'Nghi vấn tài liệu do AI tự tạo: ghép tên tạp chí có thật (Nature Machine Intelligence) với mã DOI không tồn tại và tiêu đề bài báo không có trên bất kỳ thư viện học thuật nào.',
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
      {
        name: 'Reference List Check',
        nameVi: 'Đối chiếu Danh mục cuối bài',
        status: 'none',
        latency: '4ms',
        score: 'Not listed',
        scoreVi: 'Chưa liệt kê',
      },
      {
        name: 'In-Text Citation Scan',
        nameVi: 'Kiểm tra Trích dẫn trong bài',
        status: 'none',
        latency: '2ms',
        score: 'Cited on p. 14',
        scoreVi: 'Có ở trang 14',
      },
    ],
    rules: [
      {
        code: 'L1_MISSING_BIB_ENTRY',
        name: 'In-Text Citation Without Bibliography Target',
        nameVi: 'Trích dẫn trong bài bị khuyết mục tài liệu tham khảo tương ứng',
        plainTitleEn: 'Cited in Body Text, Missing at the End',
        plainTitleVi: 'Có trích dẫn trong bài nhưng quên ghi ở cuối bài',
        plainSummaryEn:
          'You cited “Smith et al. (2021)” on page 14, but there is no matching Smith (2021) entry in your final reference list.',
        plainSummaryVi:
          'Bạn đã trích dẫn “Smith et al. (2021)” ở trang 14, nhưng chưa thêm mục tài liệu Smith (2021) vào Danh mục tham khảo cuối bài.',
        condition: 'in_text("Smith et al., 2021") has no matching biblStruct in References',
        status: 'failed',
      },
      {
        code: 'R00_PRECONDITION_HALT',
        name: 'Layer 2 Deferred Pending Reference Metadata',
        nameVi: 'Tạm hoãn xác thực Tầng 2 do thiếu thông tin thư mục gốc',
        plainTitleEn: 'Library Lookup Paused Until Reference Is Added',
        plainTitleVi: 'Chờ bổ sung tên bài báo để tra cứu thư viện',
        plainSummaryEn:
          'Once you add the full title and journal to your bibliography, CITRA will automatically verify whether the source is real.',
        plainSummaryVi:
          'Sau khi bạn bổ sung đầy đủ tên bài báo vào danh mục cuối bài, CITRA sẽ tự động tra cứu xác minh trên 15+ thư viện.',
        condition: 'IF reference_entry == NULL → UNRESOLVED (Requires Bibliography Entry)',
        status: 'warning',
      },
    ],
    explanation: {
      en: 'Missing bibliography entry: you cited “Smith et al. (2021)” on page 14, but forgot to include the full reference in your Bibliography section at the end.',
      vi: 'Thiếu mục tham khảo cuối bài: bạn đã trích dẫn “Smith et al. (2021)” tại trang 14 nhưng quên liệt kê thông tin đầy đủ của tài liệu này ở Danh mục tham khảo cuối bài.',
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

export type WorkspaceRole = 'student' | 'teacher' | 'admin';

function parseWorkspaceRoleFromUrl(search: string, hash: string): WorkspaceRole | null {
  const roleParam = new URLSearchParams(search).get('role');
  if (roleParam === 'student' || roleParam === 'teacher' || roleParam === 'admin') {
    return roleParam;
  }
  const normalizedHash = hash.toLowerCase();
  if (normalizedHash === '#workspaces-student') return 'student';
  if (normalizedHash === '#workspaces-teacher') return 'teacher';
  if (normalizedHash === '#workspaces-admin') return 'admin';
  return null;
}

export function LandingPage() {
  const { i18n } = useTranslation();
  const location = useLocation();
  const lang: Lang = i18n.language?.startsWith('vi') ? 'vi' : 'en';
  const auth = useContext(AuthContext);
  const isAuthenticated = auth
    ? Boolean(
        auth.user ||
          (auth.isLoading && typeof window !== 'undefined' && localStorage.getItem('token')),
      )
    : typeof window !== 'undefined' && Boolean(localStorage.getItem('token'));

  const [activeWorkspaceRole, setActiveWorkspaceRole] = useState<WorkspaceRole>(
    () =>
      parseWorkspaceRoleFromUrl(
        location.search || (typeof window !== 'undefined' ? window.location.search : ''),
        location.hash || (typeof window !== 'undefined' ? window.location.hash : ''),
      ) ?? 'student',
  );

  useEffect(() => {
    const matchedRole = parseWorkspaceRoleFromUrl(location.search, location.hash);
    if (matchedRole) {
      setActiveWorkspaceRole(matchedRole);
    }
    if (location.hash) {
      const rawId = location.hash.slice(1);
      const targetId = rawId.startsWith('workspaces-') ? 'workspaces' : rawId;
      const targetEl = document.getElementById(targetId);
      if (targetEl && typeof targetEl.scrollIntoView === 'function') {
        targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }
  }, [location.search, location.hash]);

  useEffect(() => {
    const onHashChange = () => {
      const matchedRole = parseWorkspaceRoleFromUrl(
        window.location.search,
        window.location.hash,
      );
      if (matchedRole) {
        setActiveWorkspaceRole(matchedRole);
      }
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const selectAndFocusWorkspaceRole = (role: WorkspaceRole) => {
    setActiveWorkspaceRole(role);
    const sectionEl = document.getElementById('workspaces');
    if (sectionEl && typeof sectionEl.scrollIntoView === 'function') {
      sectionEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    window.requestAnimationFrame(() => {
      const tabEl = document.getElementById(`workspace-tab-${role}`);
      tabEl?.focus({ preventScroll: true });
    });
  };

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
        <GuestInstantChecker lang={lang} isAuthenticated={isAuthenticated} />
        <SolvaFilmSection lang={lang} />
        <SolvaFeaturesSection lang={lang} />
        <SolvaStickySection lang={lang} isAuthenticated={isAuthenticated} />
        <SolvaInteractiveDebuggerSection lang={lang} />
        <SolvaUseCasesSection lang={lang} isAuthenticated={isAuthenticated} />
        <SolvaBenchmark120KSection lang={lang} />
        <SolvaClientResultsSection lang={lang} />
        <SolvaSecuritySection lang={lang} />
        <SolvaTaxonomyPricingSection lang={lang} isAuthenticated={isAuthenticated} />
        <SolvaRoleTestimonialsSection
          lang={lang}
          activeRole={activeWorkspaceRole}
          onSelectRole={setActiveWorkspaceRole}
          isAuthenticated={isAuthenticated}
        />
        <SolvaFAQSection lang={lang} />
        <SolvaBottomCTASection lang={lang} isAuthenticated={isAuthenticated} />
      </main>
      <SolvaFooter lang={lang} onSelectWorkspaceRole={selectAndFocusWorkspaceRole} />
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
    const closeOnKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setDropdownOpen(false);
        setMobileMenuOpen(false);
      }
    };
    window.addEventListener('scroll', closeOnScroll, { passive: true });
    window.addEventListener('keydown', closeOnKeyDown);
    return () => {
      window.removeEventListener('scroll', closeOnScroll);
      window.removeEventListener('keydown', closeOnKeyDown);
    };
  }, [dropdownOpen, mobileMenuOpen]);

  const dropdownItems =
    lang === 'vi'
      ? [
          {
            title: 'Kiểm tra trích dẫn 2 bước',
            desc: 'Đối chiếu trong bài & xác minh nguồn thật',
            href: '#architecture',
            icon: Layers,
          },
          {
            title: 'Cách hoạt động',
            desc: '4 bước rõ ràng từ tải bài đến xuất báo cáo',
            href: '#how-it-works',
            icon: GitBranch,
          },
          {
            title: 'Kiểm tra thử trực quan',
            desc: 'So sánh chi tiết bài viết với bản ghi thư viện',
            href: '#interactive-demo',
            icon: FileSearch,
          },
          {
            title: 'Độ tin cậy thực tế',
            desc: 'Chính xác 99,02% trên 120.000 bài báo',
            href: '#benchmark-120k',
            icon: Sparkles,
          },
          {
            title: 'Dành cho từng vai trò',
            desc: 'Sinh viên, Giảng viên & Khoa / Trường',
            href: '#workspaces',
            icon: Users,
          },
        ]
      : [
          {
            title: 'Two-Step Citation Check',
            desc: 'In-text links & real source verification',
            href: '#architecture',
            icon: Layers,
          },
          {
            title: 'How It Works',
            desc: '4 clear steps from upload to clean report',
            href: '#how-it-works',
            icon: GitBranch,
          },
          {
            title: 'Live Citation Check',
            desc: 'Compare cited details with library records',
            href: '#interactive-demo',
            icon: FileSearch,
          },
          {
            title: 'Proven Accuracy',
            desc: '99.02% accuracy across 120,000 papers',
            href: '#benchmark-120k',
            icon: Sparkles,
          },
          {
            title: 'Built for Every Role',
            desc: 'Students, Lecturers & Faculties',
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
      <div className="max-w-[1280px] mx-auto px-5 sm:px-6 lg:px-6 xl:px-[40px] h-[64px] lg:h-[76px] flex items-center justify-between flex-nowrap gap-2 xl:gap-4">
        {/* Left: Brand Logo */}
        <div className="flex items-center shrink-0">
          <Link
            to="/"
            onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
            className="inline-flex items-center gap-[8px] rounded-[6px] focus:outline-none"
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
        </div>

        {/* Center: Solva Navigation Links + Dropdown */}
        <nav
          aria-label="Primary Navigation"
          className="hidden xl:flex items-center justify-center flex-1 min-w-0 flex-nowrap gap-0.5 xl:gap-1"
        >
          {/* Dropdown Trigger (`Platform v` / `Nền tảng v`) */}
          <div
            className="relative shrink-0"
            onMouseLeave={() => setDropdownOpen(false)}
          >
            <button
              type="button"
              onClick={() => setDropdownOpen((prev) => !prev)}
              aria-expanded={dropdownOpen}
              style={{ color: 'var(--solva-muted)' }}
              className="inline-flex items-center gap-[4px] h-[44px] px-1.5 xl:px-[10px] rounded-[8px] font-solva-sans text-[13.5px] xl:text-[15px] font-normal whitespace-nowrap hover:opacity-80 transition-opacity cursor-pointer"
            >
              <span>{lang === 'vi' ? 'Nền tảng' : 'Platform'}</span>
              <SymmetricChevron open={dropdownOpen} size={14} />
            </button>

            {dropdownPresence.mounted && (
              <div
                className={`absolute left-0 top-[44px] pt-1 z-50 t-dropdown ${
                  dropdownPresence.phase === 'open' ? 'is-open' : 'is-closing'
                }`}
              >
                <div
                  style={{
                    backgroundColor: 'var(--solva-bg)',
                    borderColor: 'var(--solva-border)',
                  }}
                  className="w-[276px] p-[8px] rounded-[12px] border shadow-[0_4px_16px_rgba(0,0,0,0.06)] space-y-0.5"
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
            href="#how-it-works"
            style={{ color: 'var(--solva-muted)' }}
            className="inline-flex items-center h-[44px] px-1.5 xl:px-[10px] rounded-[8px] font-solva-sans text-[13.5px] xl:text-[15px] font-normal whitespace-nowrap shrink-0 hover:opacity-80 transition-opacity"
          >
            {lang === 'vi' ? 'Cách hoạt động' : 'How It Works'}
          </a>

          <a
            href="#interactive-demo"
            style={{ color: 'var(--solva-muted)' }}
            className="inline-flex items-center h-[44px] px-1.5 xl:px-[10px] rounded-[8px] font-solva-sans text-[13.5px] xl:text-[15px] font-normal whitespace-nowrap shrink-0 hover:opacity-80 transition-opacity"
          >
            {lang === 'vi' ? 'Kiểm tra thử' : 'Live Check'}
          </a>

          <a
            href="#workspaces"
            style={{ color: 'var(--solva-muted)' }}
            className="inline-flex items-center h-[44px] px-1.5 xl:px-[10px] rounded-[8px] font-solva-sans text-[13.5px] xl:text-[15px] font-normal whitespace-nowrap shrink-0 hover:opacity-80 transition-opacity"
          >
            {lang === 'vi' ? 'Dành cho ai' : 'For Whom'}
          </a>

          <a
            href="#benchmark-120k"
            style={{ color: 'var(--solva-muted)' }}
            className="inline-flex items-center gap-1.5 h-[44px] px-1.5 xl:px-[10px] rounded-[8px] font-solva-sans text-[13.5px] xl:text-[15px] font-normal whitespace-nowrap shrink-0 hover:opacity-80 transition-opacity"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse shrink-0" />
            <span>{lang === 'vi' ? 'Độ tin cậy' : 'Accuracy'}</span>
          </a>

          <Link
            to="/pricing"
            data-testid="landing-pricing-link"
            style={{ color: 'var(--solva-muted)' }}
            className="inline-flex items-center h-[44px] px-1.5 xl:px-[10px] rounded-[8px] font-solva-sans text-[13.5px] xl:text-[15px] font-normal whitespace-nowrap shrink-0 hover:opacity-80 transition-opacity"
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
            to={isAuthenticated ? '/dashboard' : '/register'}
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

          {/* Mobile Hamburger Button (Solva 2-bar minimalist style + #09 IconSwap) */}
          <button
            type="button"
            onClick={() => setMobileMenuOpen((prev) => !prev)}
            aria-label="Toggle navigation menu"
            aria-expanded={mobileMenuOpen}
            style={{
              backgroundColor: 'var(--solva-surface)',
              color: 'var(--solva-ink)',
            }}
            className="xl:hidden inline-flex items-center justify-center w-[40px] h-[40px] rounded-[8px] cursor-pointer"
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
          aria-label="Mobile Navigation"
          style={{
            backgroundColor: 'var(--solva-bg)',
            borderColor: 'var(--solva-border)',
          }}
          className={`xl:hidden border-t border-b px-5 py-4 space-y-2 shadow-lg t-mobile-drawer ${
            mobileDrawerPresence.phase === 'open' ? 'is-open' : 'is-closing'
          }`}
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            {[
              {
                label: lang === 'vi' ? 'Kiểm tra trích dẫn 2 bước' : 'Two-Step Citation Check',
                href: '#architecture',
              },
              {
                label: lang === 'vi' ? 'Cách hoạt động (4 bước)' : 'How It Works',
                href: '#how-it-works',
              },
              {
                label: lang === 'vi' ? 'Kiểm tra thử trực quan' : 'Live Citation Check',
                href: '#interactive-demo',
              },
              {
                label: lang === 'vi' ? 'Độ tin cậy (120.000 bài báo)' : 'Proven Accuracy (120K)',
                href: '#benchmark-120k',
              },
              {
                label: lang === 'vi' ? 'Dành cho ai' : 'For Students & Faculty',
                href: '#workspaces',
              },
              {
                label: lang === 'vi' ? 'Tóm tắt gói dịch vụ' : 'Plan Summary',
                href: '#pricing-plans',
              },
              {
                label: lang === 'vi' ? 'Giải đáp thắc mắc' : 'Common Questions',
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
                className="flex items-center justify-between min-h-[44px] px-3.5 py-2.5 rounded-[10px] font-solva-sans text-[14px] font-medium"
              >
                <span>{item.label}</span>
                <ChevronRight className="w-4 h-4 opacity-60 shrink-0" aria-hidden="true" />
              </a>
            ))}
            <Link
              to="/pricing"
              data-testid="mobile-menu-pricing-link"
              onClick={() => setMobileMenuOpen(false)}
              style={{
                backgroundColor: 'var(--solva-surface)',
                borderColor: 'var(--solva-ink)',
                color: 'var(--solva-ink)',
              }}
              className="flex items-center justify-between min-h-[44px] px-3.5 py-2.5 rounded-[10px] border font-solva-sans text-[14px] font-semibold"
            >
              <span className="inline-flex items-center gap-2">
                <Sparkles className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                <span>{lang === 'vi' ? 'Bảng giá' : 'Pricing'}</span>
              </span>
              <ChevronRight className="w-4 h-4 opacity-80 shrink-0" aria-hidden="true" />
            </Link>
          </div>

          <div className="pt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
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
    'OpenLibrary',
  ];

  return (
    <section
      id="hero"
      className="pt-[76px] sm:pt-[88px] lg:pt-[136px] pb-[24px] sm:pb-[36px] lg:pb-[64px] px-5 sm:px-6 lg:px-[40px]"
    >
      <div className="max-w-[1200px] mx-auto flex flex-col gap-[28px] sm:gap-[36px] lg:gap-[56px]">
        {/* Top 2-Column Content */}
        <div className="flex flex-col lg:flex-row items-center justify-between gap-[28px] sm:gap-[32px] lg:gap-[24px] pt-0 lg:pt-[12px]">
          {/* Left Column (520px on Desktop) */}
          <div className="w-full lg:w-[45%] xl:w-[520px] min-w-0 flex flex-col items-start gap-[22px] sm:gap-[28px] lg:gap-[32px] lg:pb-[24px]">
            <div className="flex flex-col items-start gap-[16px] sm:gap-[20px] lg:gap-[24px]">
              {/* Announcement Badge (`PROVEN ACCURACY | Tested on 120,000 academic papers ->`) */}
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
                    className="inline-flex items-center gap-1.5 px-[7px] pt-[5px] pb-[4px] rounded-[5px] text-[11px] font-mono font-semibold leading-[12px] border border-[#E7E3D9] dark:border-[#332F26] shrink-0 whitespace-nowrap"
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    {lang === 'vi' ? 'ĐỘ TIN CẬY ĐÃ KIỂM CHỨNG' : 'PROVEN ACCURACY'}
                  </span>
                  <span
                    style={{ color: 'var(--solva-muted)' }}
                    className="text-[14px] sm:text-[15px] font-normal leading-[21px] group-hover:underline"
                  >
                    {lang === 'vi' ? (
                      <>
                        Kiểm định trên 120.000 bài báo · Chính xác 99,02% khi rà soát{' '}
                        <span className="citra-nowrap-tail whitespace-nowrap">
                          trích dẫn{'\u00A0'}
                          <span
                            aria-hidden="true"
                            className="inline-block transition-transform duration-200 group-hover:translate-x-0.5"
                          >
                            →
                          </span>
                        </span>
                      </>
                    ) : (
                      <>
                        Tested on 120,000 papers · 99.02% accuracy catching citation{' '}
                        <span className="citra-nowrap-tail whitespace-nowrap">
                          errors{'\u00A0'}
                          <span
                            aria-hidden="true"
                            className="inline-block transition-transform duration-200 group-hover:translate-x-0.5"
                          >
                            →
                          </span>
                        </span>
                      </>
                    )}
                  </span>
                </a>
              </SolvaScrollReveal>

              {/* H1 Two-Tone Editorial Split */}
              <SolvaTwoToneHeading
                as="h1"
                size="h1"
                delayMs={85}
                primary={
                  lang === 'vi'
                    ? 'Kiểm chứng mọi trích dẫn'
                    : 'Submit your thesis or paper'
                }
                secondary={
                  lang === 'vi'
                    ? 'trước khi nộp khóa luận & bài báo.'
                    : 'with every citation verified.'
                }
              />

              {/* Subtitle (400px–450px max-width, Onest 18px Regular) */}
              <SolvaScrollReveal delayMs={190} yOffset={24} blurPx={3.5}>
                <p
                  style={{ color: 'var(--solva-muted)' }}
                  className="font-solva-sans text-[17px] sm:text-[18px] font-normal leading-[25.5px] max-w-[460px]"
                >
                  {lang === 'vi'
                    ? 'Tải lên bài viết PDF, Word hoặc BibTeX. CITRA tự động đối chiếu trích dẫn trong bài với danh mục cuối bài, xác nhận từng tài liệu có thật trên hơn 15 thư viện học thuật và chỉ rõ năm xuất bản sai hay nguồn do AI tự bịa trước khi bạn nộp bài.'
                    : 'Upload your PDF, Word, or BibTeX draft. CITRA checks that every in-text citation matches your reference list, confirms each source is real across 15+ academic libraries, and highlights wrong years or AI-invented references before submission.'}
                </p>
              </SolvaScrollReveal>
            </div>

            {/* CTA Buttons */}
            <SolvaScrollReveal delayMs={260} yOffset={24} blurPx={3}>
              <div className="flex flex-wrap items-center gap-3">
                <SolvaButton
                  to={isAuthenticated ? '/upload' : '/register'}
                  variant="primary"
                >
                  {isAuthenticated
                    ? lang === 'vi'
                      ? 'Kiểm tra bản thảo mới'
                      : 'Check a Manuscript'
                    : lang === 'vi'
                      ? 'Trải nghiệm CITRA miễn phí'
                      : 'Try CITRA Free'}
                </SolvaButton>
                <SolvaButton href="#try-instant" variant="outline">
                  <span>
                    {lang === 'vi'
                      ? 'Thử dán 3 trích dẫn ngay'
                      : 'Try 3 Citations Now'}
                  </span>
                  <ArrowDown className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
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
                className="t-learn group block w-full rounded-[12px] border p-3 sm:p-3.5 transition-all duration-200 hover:border-[#1C1A15]/40 dark:hover:border-[#FBFAF6]/30"
              >
                <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 mb-2">
                  <span
                    style={{ color: 'var(--solva-ink)' }}
                    className="inline-flex items-center gap-1.5 font-mono text-[10px] sm:text-[11px] font-semibold uppercase tracking-wider min-w-0"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400 shrink-0" />
                    <span>
                      {lang === 'vi'
                        ? 'ĐÃ KIỂM ĐỊNH TRÊN 120.000 BÀI BÁO KHOA HỌC'
                        : 'TESTED ON 120,000 ACADEMIC PAPERS'}
                    </span>
                  </span>
                  <span
                    style={{ color: 'var(--solva-muted)' }}
                    className="whitespace-nowrap font-mono text-[10px] inline-flex items-center gap-1 shrink-0 group-hover:underline"
                  >
                    <span>{lang === 'vi' ? 'Xem độ tin cậy' : 'See accuracy'}</span>
                    <LearnMoreChevron size={12} />
                  </span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4 gap-x-3 gap-y-2.5 pt-2.5 border-t border-[#E7E3D9] dark:border-[#332F26]">
                  <div className="min-w-0">
                    <div
                      style={{ color: 'var(--solva-ink)' }}
                      className="font-solva-serif text-[20px] sm:text-[22px] leading-none tracking-[-0.04em]"
                    >
                      {lang === 'vi' ? '120.000' : '120,000'}
                    </div>
                    <div
                      style={{ color: 'var(--solva-muted)' }}
                      className="font-mono text-[10px] leading-snug mt-1"
                    >
                      {lang === 'vi' ? 'Bài báo kiểm định' : 'Papers tested'}
                    </div>
                  </div>
                  <div className="min-w-0">
                    <div className="font-solva-serif text-[20px] sm:text-[22px] leading-none tracking-[-0.04em] text-emerald-700 dark:text-emerald-400">
                      {lang === 'vi' ? '99,02%' : '99.02%'}
                    </div>
                    <div
                      style={{ color: 'var(--solva-muted)' }}
                      className="font-mono text-[10px] leading-snug mt-1"
                    >
                      {lang === 'vi' ? 'Độ chính xác' : 'Overall accuracy'}
                    </div>
                  </div>
                  <div className="min-w-0">
                    <div className="font-solva-serif text-[20px] sm:text-[22px] leading-none tracking-[-0.04em] text-emerald-700 dark:text-emerald-400">
                      {lang === 'vi' ? '99,75%' : '99.75%'}
                    </div>
                    <div
                      style={{ color: 'var(--solva-muted)' }}
                      className="font-mono text-[10px] leading-snug mt-1"
                    >
                      {lang === 'vi' ? (
                        <>
                          Ca trích dẫn khó{' '}
                          <span className="citra-nowrap-tail whitespace-nowrap">(2,4K)</span>
                        </>
                      ) : (
                        <>
                          Tricky cases{' '}
                          <span className="citra-nowrap-tail whitespace-nowrap">(2.4K)</span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="min-w-0">
                    <div
                      style={{ color: 'var(--solva-ink)' }}
                      className="font-solva-serif text-[20px] sm:text-[22px] leading-none tracking-[-0.04em]"
                    >
                      15+
                    </div>
                    <div
                      style={{ color: 'var(--solva-muted)' }}
                      className="font-mono text-[10px] leading-snug mt-1"
                    >
                      {lang === 'vi' ? 'Thư viện học thuật' : 'Academic libraries'}
                    </div>
                  </div>
                </div>
              </a>
            </SolvaScrollReveal>
          </div>

          {/* Right Column: Painterly Mockup Frame (`656px` on XL Desktop, fully framed with zero overhang) */}
          <div className="w-full lg:w-[55%] xl:w-[656px] min-w-0">
            <SolvaPainterlyFrame
              paintingSrc="/solva/hero-bg.webp"
              priority
              alt="Impressionist wildflower meadow oil painting backdrop"
              className="w-full min-h-[420px] sm:min-h-[480px] lg:min-h-[521px] p-3.5 sm:p-6 lg:p-4 xl:p-7 flex items-center justify-center"
            >
              <div className="w-full my-auto">
                <UIGenerationReveal
                  className="rounded-[10px]"
                  steps={
                    lang === 'vi'
                      ? [
                          'ĐỌC DANH MỤC TÀI LIỆU',
                          'ĐỐI CHIẾU 15+ THƯ VIỆN',
                          'HOÀN TẤT KIỂM TRA',
                        ]
                      : [
                          'READING REFERENCES',
                          'CHECKING 15+ LIBRARIES',
                          'REPORT READY',
                        ]
                  }
                >
                  <HeroVerificationMockup
                    lang={lang}
                    activeStep={activeStep}
                    onSelectStep={setActiveStep}
                  />
                </UIGenerationReveal>
              </div>
            </SolvaPainterlyFrame>
          </div>
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
  const [showTechnicalDetails, setShowTechnicalDetails] = useState(false);
  const [activeView, setActiveView] = useState<'ablation' | 'classes' | 'calibration'>('ablation');
  const { containerRef: benchTabsRef, pillStyle: benchPill } = useSlidingPill<HTMLDivElement>(
    `${activeView}-${showTechnicalDetails}`,
  );
  const { containerRef: benchRef, replaySeed: benchSeed } = useFloralCardAnimation(5600);
  const sep = lang === 'vi' ? '.' : ',';
  const decSep = lang === 'vi' ? ',' : '.';
  const fmtPct = (pct: number) =>
    lang === 'vi' ? `${pct.toFixed(2).replace('.', ',')}%` : `${pct.toFixed(2)}%`;

  const plainPillars = [
    {
      badge:
        lang === 'vi'
          ? 'NGUỒN THẬT & TRÍCH DẪN THỰC TẾ'
          : 'REAL & SYNTHETIC CITATIONS',
      badgeTone: 'neutral' as const,
      displayValue: lang === 'vi' ? '120.000' : '120,000',
      title:
        lang === 'vi'
          ? 'Bài báo & trích dẫn đã kiểm định'
          : 'Academic papers rigorously tested',
      desc:
        lang === 'vi'
          ? 'Thử nghiệm trên hàng trăm nghìn bài báo tạp chí, kỷ yếu, sách chuyên khảo cùng các lỗi sai quy cách thường gặp trong bài làm thực tế của sinh viên và học viên.'
          : 'Tested across real journal articles, conference papers, books, and realistic citation slips so CITRA handles everyday manuscripts reliably.',
    },
    {
      badge: lang === 'vi' ? 'ĐỘ TIN CẬY VƯỢT TRỘI' : 'HIGH RELIABILITY',
      badgeTone: 'emerald' as const,
      displayValue: lang === 'vi' ? '99,02%' : '99.02%',
      title:
        lang === 'vi'
          ? 'Chính xác khi phát hiện nguồn ảo & sai lệch'
          : 'Accuracy catching fake or mismatched sources',
      desc:
        lang === 'vi'
          ? 'Nhận diện chuẩn xác tài liệu do AI tự bịa, đường dẫn DOI không tồn tại và năm xuất bản sai — đạt 99,75% ngay cả trên 2.400 ca trích dẫn khó.'
          : 'Spots AI-invented references, broken DOIs, and wrong publication years — maintaining 99.75% accuracy across 2,400 tricky edge-case citations.',
    },
    {
      badge:
        lang === 'vi'
          ? 'CÔNG TÂM VỚI NGƯỜI VIẾT'
          : 'FAIR TO STUDENTS & AUTHORS',
      badgeTone: 'emerald' as const,
      displayValue: '0',
      title:
        lang === 'vi'
          ? 'Trường hợp kết luận oan cho tài liệu thật'
          : 'False accusations on real publications',
      desc:
        lang === 'vi'
          ? 'Không một công trình hợp lệ nào bị gắn cờ nhầm là nguồn bịa đặt trên 6.480 bài kiểm thử chuẩn. Sách in và luận văn nội bộ luôn được chuyển nhẹ nhàng để giảng viên duyệt.'
          : 'Zero legitimate papers were wrongly flagged as fake across 6,480 verified test works. Print books and local theses are routed politely for advisor review.',
    },
  ];

  const headlineMetrics = [
    {
      badge: lang === 'vi' ? '0% RÒ RỈ DỮ LIỆU · PAPER & TITLE DISJOINT' : '0% LEAKAGE · PAPER & TITLE DISJOINT',
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
          ? 'Phân tách độc lập tuyệt đối theo bài báo và tiêu đề chuẩn hóa giữa 84.000 bài huấn luyện, 18.000 bài thẩm định và 18.000 bài kiểm thử độc lập (|Train ∩ Val ∩ Test| = 0). Mã hóa 419.053 chuỗi văn bản thực bằng Sentence-BERT, 0% np.clip.'
          : 'Strict paper- & title-disjoint 84,000 Train · 18,000 Val · 18,000 Held-Out Test split (|Train ∩ Val ∩ Test| = 0) prior to perturbation. 419,053 unique texts encoded via Sentence-BERT with zero clamping.',
    },
    {
      badge: lang === 'vi' ? 'MACRO-F1: 0.9888 · HẠNG #1 ID & OOD' : 'MACRO-F1: 0.9888 · #1 ON ID & OOD',
      badgeTone: 'emerald' as const,
      value: 99.02,
      decimals: 2,
      suffix: '%',
      formatThousands: false,
      title:
        lang === 'vi'
          ? 'Độ chính xác Neuro-Symbolic (99,75% trên 2.400 mẫu OOD)'
          : 'Neuro-Symbolic Accuracy (99.75% on 2,400-Sample OOD)',
      desc:
        lang === 'vi'
          ? 'Kiến trúc Neuro-Symbolic đề xuất đạt 99,02% Accuracy (17.823/18.000, Macro-F1 0.9888), vượt qua cả mô hình học máy thuần túy B5 (97,98%, McNemar p = 6.17e-23) trên ID và bỏ xa B5 trên bộ 2.400 mẫu OOD (99,75% vs. 49,88%).'
          : 'Proposed Neuro-Symbolic engine achieves 99.02% Accuracy (17,823/18,000, 0.9888 Macro-F1), statistically outperforming Pure ML B5 on ID (97.98%, p = 6.17e-23) and OOD (99.75% vs. 49.88%).',
    },
    {
      badge: lang === 'vi' ? '0% KẾT LUẬN OAN CHO BÀI THẬT' : '0% FALSE ACCUSATIONS',
      badgeTone: 'emerald' as const,
      value: 99.93,
      decimals: 2,
      suffix: '%',
      formatThousands: false,
      title:
        lang === 'vi'
          ? 'Precision nhận diện trích dẫn ngụy tạo (F1 = 0.9981)'
          : 'Hallucination Detection Precision (F1 = 0.9981)',
      desc:
        lang === 'vi'
          ? 'Phát hiện 5.383 / 5.400 trích dẫn chắp vá cùng miền tinh vi (Recall 99,69%, Precision 99,93%) mà không cáo buộc oan bất kỳ công trình hợp lệ nào (0 / 6.480 VERIFIED) và không để lọt bất kỳ trích dẫn ảo nào sang VERIFIED (0 / 5.400).'
          : 'Catches 5,383 / 5,400 plausible same-domain spliced hallucinations (99.69% recall, 99.93% precision) with 0 / 6,480 legitimate works falsely accused and 0 / 5,400 fabrications leaked into VERIFIED.',
    },
    {
      badge: '↓ 6.19× ECE · ↓ 7.32× BRIER',
      badgeTone: 'amber' as const,
      value: 0.0395,
      decimals: 4,
      suffix: '',
      formatThousands: false,
      title:
        lang === 'vi'
          ? 'Sai số hiệu chỉnh xác suất ECE (Brier = 0.0125)'
          : 'Expected Calibration Error ECE (Brier = 0.0125)',
      desc:
        lang === 'vi'
          ? 'Hiệu chỉnh hậu nghiệm Logit-Space Platt Scaling (a = 1.8077, b = 1.1160) kéo giảm 6,19 lần sai số ECE (0.2445 → 0.0395) và 7,32 lần Brier (0.0915 → 0.0125), đạt 99,31% chính xác ở độ phủ 90% và 100% (120/120) E2E Gold.'
          : 'Post-hoc Logit-Space Platt Scaling (a = 1.8077, b = 1.1160) cuts ECE by 6.19× (0.2445 → 0.0395) and Brier by 7.32× (0.0915 → 0.0125), with 99.31% accuracy @ 90% coverage and 100% (120/120) E2E Gold.',
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
      acc: 26.34,
      prec: '0.2336',
      rec: '0.3496',
      f1: '0.1963',
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
      acc: 58.11,
      prec: '0.5626',
      rec: '0.4794',
      f1: '0.4513',
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
          ? 'Dễ dàng bị qua mặt bởi tiêu đề AI chắp vá từ khóa cùng miền và làm ngơ sai lệch năm / tác giả'
          : 'Fooled by plausible same-domain chimeric LLM titles; ignores year & author drift',
      acc: 66.86,
      prec: '0.4930',
      rec: '0.5214',
      f1: '0.4585',
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
          ? 'Cưỡng ép ra phán quyết cứng ở vùng ranh giới nhạy cảm [0.40, 0.60), dẫn tới sụp đổ 3,33% trên OOD'
          : 'Forces hard verdicts in borderline [0.40, 0.60) cases (3.33% on OOD)',
      acc: 80.13,
      prec: '0.6212',
      rec: '0.6607',
      f1: '0.6269',
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
      acc: 81.93,
      prec: '0.6328',
      rec: '0.6811',
      f1: '0.6466',
      highlight: false,
    },
    {
      code: 'B5 · HybridMLScorer (16D, C = 2.0)',
      name:
        lang === 'vi'
          ? 'HybridMLScorer 16 chiều thuần học máy (C = 2.0 — sụp đổ còn 49,88% trên 2.400 mẫu OOD!)'
          : 'Pure 16D HybridMLScorer (C = 2.0 — collapses to 49.88% on 2,400-sample OOD!)',
      note:
        lang === 'vi'
          ? 'Thiếu rào chắn ký hiệu bậc nhất cho bài bị rút (Retracted 0%), URL giả (0%) và ghép lai DOI'
          : 'Lacks symbolic guardrails for retracted papers (0%), fake URLs (0%) & chimeric DOIs',
      acc: 97.98,
      prec: '0.9805',
      rec: '0.9800',
      f1: '0.9802',
      highlight: false,
    },
    {
      code: 'Proposed · Neuro-Symbolic (#1)',
      name:
        lang === 'vi'
          ? `CITRA Neuro-Symbolic Thống nhất (Đa nguồn + Đặc hiệu Ngữ nghĩa + ${SYMBOLIC_RULES_COUNT}+ Luật + Platt)`
          : `CITRA Unified Neuro-Symbolic (Multi-Source + Verb-Agnostic Specificity + ${SYMBOLIC_RULES_COUNT}+ Rules + Platt)`,
      note:
        lang === 'vi'
          ? 'Hạng #1 trên cả ID (p = 6.17e-23 vs. B5) & OOD (99,75% vs. 49,88%) · 100% (120/120) E2E Gold'
          : '#1 on both ID (p = 6.17e-23 vs. B5) & OOD (99.75% vs. 49.88%) · 100% (120/120) E2E Gold',
      acc: 99.02,
      prec: '0.9894',
      rec: '0.9883',
      f1: '0.9888',
      highlight: true,
    },
  ];

  const classPerformance = [
    {
      label: 'VERIFIED',
      subtypes: 'V1 – V4',
      totalSamples: lang === 'vi' ? '43.200 (36%)' : '43,200 (36%)',
      testSupport: lang === 'vi' ? '6.480' : '6,480',
      precision: lang === 'vi' ? '0.9846 (98,5%)' : '0.9846 (98.5%)',
      recall: lang === 'vi' ? '0.9980 (99,8%)' : '0.9980 (99.8%)',
      f1: '0.9913',
      tone: 'emerald' as const,
      desc:
        lang === 'vi'
          ? 'Khớp nguyên bản (V1), viết tắt et al. hoặc chênh ±1 năm giữa bản tiền ấn phẩm và kỷ yếu (V2), lược phụ đề (V3), hay lỗi ký tự OCR được cứu hộ nhờ đối sánh ngữ nghĩa (V4). 0 / 6.480 bài thật bị cáo buộc oan là ảo giác; 0 trích dẫn giả lọt vào VERIFIED.'
          : 'Exact canonical match (V1), et al./±1yr preprint drift (V2), subtitle truncation (V3), OCR noise rescued by abstract alignment (V4). 0 / 6,480 verified papers accused as hallucinated; 0 fabrications marked VERIFIED.',
    },
    {
      label: 'SUSPECTED_HALLUCINATION',
      subtypes: 'H1 – H4',
      totalSamples: lang === 'vi' ? '36.000 (30%)' : '36,000 (30%)',
      testSupport: lang === 'vi' ? '5.400' : '5,400',
      precision: lang === 'vi' ? '0.9993 (99,9%)' : '0.9993 (99.9%)',
      recall: lang === 'vi' ? '0.9969 (99,7%)' : '0.9969 (99.7%)',
      f1: '0.9981',
      tone: 'red' as const,
      desc:
        lang === 'vi'
          ? 'Ngụy tạo hoàn toàn (H1), chắp vá tiêu đề cùng miền kết hợp tên học giả thật (H2), mã DOI giả / ghép lai (H3), hoặc liên kết chết HTTP 404 (H4). Bắt trọn 5.383 / 5.400 mẫu (17 mẫu biên chuyển sang UNRESOLVED), 0 kết tội oan bài VERIFIED.'
          : 'Complete fabrication (H1), plausible same-domain spliced titles with real scholar names (H2), fabricated/chimeric DOIs (H3), dead HTTP 404 URLs (H4). 5,383 / 5,400 caught (0 false accusations on VERIFIED).',
    },
    {
      label: 'METADATA_ERROR',
      subtypes: 'M1 – M5',
      totalSamples: lang === 'vi' ? '26.400 (22%)' : '26,400 (22%)',
      testSupport: lang === 'vi' ? '3.960' : '3,960',
      precision: lang === 'vi' ? '0.9915 (99,2%)' : '0.9915 (99.2%)',
      recall: lang === 'vi' ? '0.9684 (96,8%)' : '0.9684 (96.8%)',
      f1: '0.9798',
      tone: 'amber' as const,
      desc:
        lang === 'vi'
          ? 'Công trình có thật nhưng lệch năm công bố |Δyear| ≥ 2 (M1), tráo/ghép đồng tác giả (M2), DOI đúng nhưng tiêu đề biến dạng (M3), gán ghép luận điểm không có trong bài gốc qua 12 mẫu câu tự nhiên (M4), hoặc sai đa trường / bài bị rút (M5).'
          : 'Real work exists but cited with wrong year |Δyear| ≥ 2 (M1), swapped/grafted co-authors (M2), valid DOI with corrupted title (M3), verb-agnostic ungrounded claim misattribution across 12 templates (M4), or multi-field/retracted status (M5).',
    },
    {
      label: 'UNRESOLVED (Abstention)',
      subtypes: 'U1 – U2',
      totalSamples: lang === 'vi' ? '14.400 (12%)' : '14,400 (12%)',
      testSupport: lang === 'vi' ? '2.160' : '2,160',
      precision: lang === 'vi' ? '0.9821 (98,2%)' : '0.9821 (98.2%)',
      recall: lang === 'vi' ? '0.9898 (99,0%)' : '0.9898 (99.0%)',
      f1: '0.9859',
      tone: 'slate' as const,
      desc:
        lang === 'vi'
          ? 'Các tài liệu nằm trong vùng ranh giới mờ [0.40, 0.60) thiếu DOI (U1) hoặc gặp giới hạn băng thông HTTP 429 / DOI khu vực thiếu CSL (U2). Hệ thống chủ động kiềm chế không kết luận võ đoán để giảng viên thẩm định.'
          : 'Borderline candidates in the [0.40, 0.60) gray zone without DOIs (U1) or HTTP 429 / regional no-CSL DOIs (U2). Safely abstains from hard judgment and routes to faculty review.',
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
        className="max-w-[1200px] mx-auto flex flex-col gap-[28px] sm:gap-[36px] lg:gap-[44px]"
      >
        {/* Top Section Header + Plain-Language Trust Callout */}
        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6">
          <div className="flex flex-col items-start gap-[12px] sm:gap-[16px] max-w-[680px]">
            <SolvaEyebrow>
              {lang === 'vi'
                ? 'Độ tin cậy thực tế · Kiểm định trên 120.000 bài báo khoa học'
                : 'Proven Accuracy · Tested on 120,000 Academic Papers'}
            </SolvaEyebrow>
            <SolvaTwoToneHeading
              primary={
                lang === 'vi'
                  ? 'Được kiểm chứng trên 120.000 bài báo.'
                  : 'Tested across 120,000 papers.'
              }
              secondary={
                lang === 'vi'
                  ? 'Chính xác, công tâm, không một lời kết luận oan.'
                  : 'Accurate, fair, and zero false accusations.'
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
                      ? 'KIỂM THỬ ĐỘC LẬP ĐA NGÀNH'
                      : 'INDEPENDENT CROSS-DISCIPLINE AUDIT'}
                  </span>
                </span>
                <span style={{ color: 'var(--solva-muted)' }}>
                  {lang === 'vi' ? '18.000 bài độc lập' : '18,000 Unseen Papers'}
                </span>
              </div>
              <p
                style={{ color: 'var(--solva-muted)' }}
                className="font-solva-sans text-[13px] leading-[19.5px]"
              >
                {lang === 'vi'
                  ? 'Đánh giá khách quan trên 18.000 bài báo kiểm thử hoàn toàn độc lập trải rộng từ Kinh tế, Luật, Nhân văn đến Y sinh và Kỹ thuật — mọi cảnh báo đều đính kèm bằng chứng thư viện rõ ràng.'
                  : 'Evaluated on 18,000 completely unseen academic papers across Economics, Law, Humanities, Medicine, and STEM — every flag links directly to verifiable library records.'}
              </p>
            </div>
          </SolvaScrollReveal>
        </div>

        {/* Default Surface: 3-Pillar Plain-Language Reassurance Summary */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-[16px]">
          {plainPillars.map((pillar, idx) => (
            <SolvaScrollReveal
              key={pillar.title}
              delayMs={idx * 75}
              yOffset={28}
              className="h-full"
            >
              <div
                style={{
                  backgroundColor: 'var(--solva-surface)',
                  borderColor: 'var(--solva-border)',
                }}
                className="rounded-[14px] border p-[20px] sm:p-[24px] h-full flex flex-col justify-between gap-[18px]"
              >
                <div className="space-y-[12px]">
                  <span
                    className={`inline-flex px-2 py-0.5 rounded-[5px] font-mono text-[10px] font-semibold tracking-wide ${
                      pillar.badgeTone === 'emerald'
                        ? 'bg-emerald-500/[0.12] text-emerald-700 dark:text-emerald-300'
                        : 'bg-[#FBFAF6] dark:bg-[#141310] text-[#56524A] dark:text-[#A8A296]'
                    }`}
                  >
                    {pillar.badge}
                  </span>

                  <div
                    style={{ color: 'var(--solva-ink)' }}
                    className="font-solva-serif font-light text-[38px] sm:text-[44px] leading-[1.08] tracking-[-0.05em]"
                  >
                    {pillar.displayValue}
                  </div>

                  <h3
                    style={{ color: 'var(--solva-ink)' }}
                    className="font-solva-sans text-[17px] sm:text-[18px] font-medium leading-[24px]"
                  >
                    {pillar.title}
                  </h3>
                </div>

                <p
                  style={{ color: 'var(--solva-muted)' }}
                  className="font-solva-sans text-[14px] leading-[21px] pt-3 border-t border-[#E7E3D9] dark:border-[#332F26]"
                >
                  {pillar.desc}
                </p>
              </div>
            </SolvaScrollReveal>
          ))}
        </div>

        {/* Progressive Disclosure Toggle for Evaluators, ML Researchers & Thesis Committees */}
        <div className="flex flex-col items-start sm:items-center">
          <button
            type="button"
            data-testid="benchmark-technical-details-toggle"
            aria-expanded={showTechnicalDetails}
            aria-controls="benchmark-technical-details-panel"
            onClick={() => setShowTechnicalDetails((prev) => !prev)}
            style={{
              backgroundColor: 'var(--solva-surface)',
              borderColor: showTechnicalDetails ? 'var(--solva-ink)' : 'var(--solva-border)',
              color: 'var(--solva-ink)',
            }}
            className="w-full sm:w-auto min-h-[44px] px-4 sm:px-5 py-2.5 rounded-[10px] border font-solva-sans text-[14px] font-medium inline-flex items-center justify-between sm:justify-center gap-2.5 hover:opacity-90 transition-all cursor-pointer"
          >
            <span>
              {showTechnicalDetails
                ? lang === 'vi'
                  ? 'Ẩn chi tiết phương pháp & bảng số liệu kỹ thuật'
                  : 'Hide Technical Methodology & Benchmark Tables'
                : lang === 'vi'
                  ? 'Xem chi tiết phương pháp & bảng số liệu kỹ thuật'
                  : 'View Full Technical Methodology & Benchmark Tables'}
            </span>
            <SymmetricChevron open={showTechnicalDetails} size={15} />
          </button>
        </div>

        {showTechnicalDetails && (
          <div
            id="benchmark-technical-details-panel"
            className="space-y-[24px] animate-debugger-switch"
          >
            {/* 4 Technical Telemetry Cards (`120,000` · `99.02%` · `99.93%` · `0.0395`) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-[16px]">
              {headlineMetrics.map((item, idx) => (
                <div
                  key={item.title}
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
                            ? 'bg-emerald-500/[0.12] text-emerald-700 dark:text-emerald-300'
                            : item.badgeTone === 'amber'
                              ? 'bg-amber-500/[0.12] text-amber-800 dark:text-amber-300'
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
                        decimalSeparator={item.suffix === '%' ? decSep : '.'}
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
              ))}
            </div>

            {/* Interactive 3-View Scientific Benchmark Explorer (Nested Bezel `#F4F2EC` -> `#FBFAF6`) */}
            <div
              style={{ backgroundColor: 'var(--solva-surface)' }}
              className="w-full rounded-[16px] p-[8px] sm:p-[12px] space-y-3"
            >
            {/* Top Bar: 3 Scientific Audit Views + Dataset Split Summary (#16 Sliding Tabs) */}
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 px-1 sm:px-2 pt-1">
              <div
                ref={benchTabsRef}
                role="tablist"
                aria-label={
                  lang === 'vi'
                    ? 'Các bảng kết quả thực nghiệm 120K bài báo'
                    : '120K-paper benchmark evaluation views'
                }
                className="relative grid grid-cols-1 sm:grid-cols-3 gap-1.5 w-full lg:w-auto"
              >
                {benchPill.ready && (
                  <span
                    aria-hidden="true"
                    style={{
                      backgroundColor: 'var(--solva-bg)',
                      width: `${benchPill.width}px`,
                      height: `${benchPill.height}px`,
                      transform: `translate3d(${benchPill.left}px, ${benchPill.top}px, 0)`,
                      transition: benchPill.animate ? undefined : 'none',
                    }}
                    className="t-tabs-pill rounded-[10px] shadow-sm"
                  />
                )}
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
                      data-pill-active={isActive ? 'true' : 'false'}
                      onClick={() => setActiveView(tab.id)}
                      style={{
                        backgroundColor: !benchPill.ready && isActive ? 'var(--solva-bg)' : 'transparent',
                        color: isActive ? 'var(--solva-ink)' : 'var(--solva-muted)',
                      }}
                      className="t-tab min-h-[44px] h-auto py-2 px-3.5 text-center leading-tight rounded-[10px] font-mono text-[12px] font-medium flex items-center justify-center gap-2 cursor-pointer"
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
                <span className="px-2.5 py-1 rounded-[6px] bg-emerald-500/[0.12] text-emerald-700 dark:text-emerald-300 font-semibold">
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
                      {lang === 'vi'
                        ? '+32,16% hơn SBERT · Thắng B5 (p = 6.17e-23)'
                        : '+32.16% vs. SBERT · Beats B5 (p = 6.17e-23)'}
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
                                  ? 'bg-emerald-500/[0.15] text-emerald-700 dark:text-emerald-300'
                                  : 'bg-[#FBFAF6] dark:bg-[#141310]'
                              }`}
                              style={!row.highlight ? { color: 'var(--solva-ink)' } : undefined}
                            >
                              {fmtPct(row.acc)} Acc
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
                    <span className="self-start sm:self-center px-3 py-1 rounded-[8px] bg-emerald-500/[0.12] text-emerald-700 dark:text-emerald-300 font-mono text-[11px] font-semibold shrink-0">
                      {lang === 'vi'
                        ? 'Độ chính xác chung: 99,02% [98,87%; 99,16%]'
                        : 'Overall Acc: 99.02% [98.87%, 99.16%]'}
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
                                  ? 'bg-emerald-500/[0.15] text-emerald-700 dark:text-emerald-300'
                                  : cls.tone === 'red'
                                    ? 'bg-red-500/[0.15] text-red-700 dark:text-red-300'
                                    : cls.tone === 'amber'
                                      ? 'bg-amber-500/[0.15] text-amber-800 dark:text-amber-300'
                                      : 'bg-slate-500/[0.15] text-slate-700 dark:text-slate-300'
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
                          ? 'Ước lượng tham số Platt (a = 1.8077, b = 1.1160) hoàn toàn độc lập trên tập Thẩm định (18.000 mẫu), đảm bảo điểm độ tin cậy phản ánh trung thực xác suất đúng thực nghiệm.'
                          : 'Platt parameters (a = 1.8077, b = 1.1160) fitted strictly on the 18,000-sample Validation split align confidence scores with true empirical accuracy.'}
                      </p>
                    </div>
                    <span className="self-start sm:self-center px-3 py-1 rounded-[8px] bg-emerald-500/[0.12] text-emerald-700 dark:text-emerald-300 font-mono text-[11px] font-semibold shrink-0">
                      {lang === 'vi'
                        ? '99,31% Chính xác @ 90% Độ phủ'
                        : '99.31% Acc @ 90% Coverage'}
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
                              <strong style={{ color: 'var(--solva-ink)' }}>0.2445</strong>
                            </div>
                            <div className="flex justify-between">
                              <span style={{ color: 'var(--solva-muted)' }}>
                                {lang === 'vi' ? 'Điểm Brier:' : 'Brier Score:'}
                              </span>
                              <strong style={{ color: 'var(--solva-ink)' }}>0.0915</strong>
                            </div>
                            <div className="flex justify-between">
                              <span style={{ color: 'var(--solva-muted)' }}>
                                {lang === 'vi' ? 'Chính xác @ 70% Phủ:' : 'Acc @ 70% Cov:'}
                              </span>
                              <strong style={{ color: 'var(--solva-ink)' }}>
                                {lang === 'vi' ? '99,03%' : '99.03%'}
                              </strong>
                            </div>
                            <div className="flex justify-between">
                              <span style={{ color: 'var(--solva-muted)' }}>
                                {lang === 'vi' ? 'Chính xác @ 90% Phủ:' : 'Acc @ 90% Cov:'}
                              </span>
                              <strong style={{ color: 'var(--solva-ink)' }}>
                                {lang === 'vi' ? '99,08%' : '99.08%'}
                              </strong>
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
                                {lang === 'vi' ? '0.0395 (↓ 6,19×)' : '0.0395 (↓ 6.19×)'}
                              </strong>
                            </div>
                            <div className="flex justify-between">
                              <span style={{ color: 'var(--solva-muted)' }}>
                                {lang === 'vi' ? 'Điểm Brier:' : 'Brier Score:'}
                              </span>
                              <strong className="text-emerald-700 dark:text-emerald-300">
                                {lang === 'vi' ? '0.0125 (↓ 7,32×)' : '0.0125 (↓ 7.32×)'}
                              </strong>
                            </div>
                            <div className="flex justify-between">
                              <span style={{ color: 'var(--solva-muted)' }}>
                                {lang === 'vi' ? 'Chính xác @ 70% Phủ:' : 'Acc @ 70% Cov:'}
                              </span>
                              <strong className="text-emerald-700 dark:text-emerald-300">
                                {lang === 'vi' ? '99,23%' : '99.23%'}
                              </strong>
                            </div>
                            <div className="flex justify-between">
                              <span style={{ color: 'var(--solva-muted)' }}>
                                {lang === 'vi' ? 'Chính xác @ 90% Phủ:' : 'Acc @ 90% Cov:'}
                              </span>
                              <strong className="text-emerald-700 dark:text-emerald-300">
                                {lang === 'vi' ? '99,31%' : '99.31%'}
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
                            est: lang === 'vi' ? '99,02%' : '99.02%',
                            ci: lang === 'vi' ? '[98,87%; 99,16%]' : '[98.87%, 99.16%]',
                            se: lang === 'vi' ? '±0,07%' : '±0.07%',
                          },
                          {
                            metric: lang === 'vi' ? 'Điểm Macro-F1' : 'Macro-F1 Score',
                            est: '0.9888',
                            ci: '[0.9871, 0.9905]',
                            se: '±0.0009',
                          },
                          {
                            metric: lang === 'vi' ? 'Sai số ECE đã hiệu chỉnh' : 'Calibrated ECE',
                            est: '0.0395',
                            ci: '[0.0380, 0.0410]',
                            se: '±0.0008',
                          },
                          {
                            metric: lang === 'vi' ? 'Điểm Brier (Brier Score)' : 'Brier Score',
                            est: '0.0125',
                            ci: '[0.0113, 0.0137]',
                            se: '±0.0006',
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
          </div>
        )}
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
          ? 'Khớp từng trích dẫn trong bài với danh mục cuối bài'
          : 'Match every in-text citation to your reference list',
      desc:
        lang === 'vi'
          ? 'Kiểm tra tách biệt hai phần dễ nhầm nhất: mọi trích dẫn trong đoạn văn đã có mặt ở Danh mục tham khảo cuối bài chưa, và ấn phẩm được nêu có thực sự tồn tại ngoài đời thực không.'
          : 'Checks two essentials separately: whether every in-text citation connects to an entry in your bibliography, and whether each cited publication actually exists.',
    },
    {
      painting: '/solva/feature-2-bg.webp',
      title:
        lang === 'vi'
          ? 'Đối chiếu cùng lúc trên hơn 15 thư viện học thuật uy tín'
          : 'Verify sources across 15+ academic libraries at once',
      desc:
        lang === 'vi'
          ? 'Tra cứu song song trên Crossref, OpenAlex, Semantic Scholar, PubMed, arXiv, DOAJ, OpenLibrary và Cơ sở dữ liệu Văn bản Pháp luật Việt Nam chỉ trong vài giây.'
          : 'Cross-checks your bibliography simultaneously against Crossref, OpenAlex, Semantic Scholar, PubMed, arXiv, DOAJ, OpenLibrary, and Vietnam’s legal statute registry in seconds.',
    },
    {
      painting: '/solva/feature-3-bg.webp',
      title:
        lang === 'vi'
          ? 'Đảm bảo bài báo gốc thực sự củng cố cho ý bạn viết'
          : 'Confirm the cited paper actually supports your point',
      desc:
        lang === 'vi'
          ? 'So sánh câu trích dẫn trong bài (cả tiếng Việt và tiếng Anh) với tóm tắt của ấn phẩm gốc, phát hiện sớm năm xuất bản sai, nhầm tác giả hoặc trích dẫn lệch ý tác giả.'
          : 'Compares your cited sentence against the source paper’s abstract across English and Vietnamese, catching wrong years, swapped authors, and misquoted findings with clear reasons.',
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
            {lang === 'vi' ? 'CITRA giúp bạn kiểm tra gì' : 'What CITRA checks'}
          </SolvaEyebrow>
          <SolvaTwoToneHeading
            primary={
              lang === 'vi'
                ? 'Ba bước kiểm tra'
                : 'Three checks behind'
            }
            secondary={
              lang === 'vi'
                ? 'giúp danh mục tham khảo luôn chuẩn xác.'
                : 'every trustworthy bibliography.'
            }
          />
        </div>

        {/* 3-Column Feature Cards (`gap: 24px`) */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-[24px]">
          {features.map((feat, idx) => (
            <SolvaScrollReveal
              key={feat.title}
              delayMs={idx * 95}
              yOffset={36}
              className="flex flex-col gap-[16px] min-w-0"
            >
              {/* Top Painterly Visual Box */}
              <SolvaPainterlyFrame
                paintingSrc={feat.painting}
                alt={feat.title}
                className="w-full min-h-[320px] sm:min-h-[344px] p-4 sm:p-5 lg:p-3.5 xl:p-[24px] flex items-center justify-center"
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
          ? 'Đọc chuẩn xác danh mục tài liệu ở mọi quy cách trình bày phổ biến'
          : 'Reads complex reference lists across every major citation style',
      desc:
        lang === 'vi'
          ? 'Tải lên bài viết PDF hoặc Word trình bày theo chuẩn APA 7th, IEEE, Vancouver, Harvard hay ACM. CITRA tự động nhận diện phần Tài liệu tham khảo cuối bài và tách rời từng cụm trích dẫn gộp dạng [1]–[5].'
          : 'Upload a PDF or Word manuscript in APA 7th, IEEE, Vancouver, Harvard, or ACM style. CITRA cleanly separates body text from your bibliography and expands grouped citations like [1]–[5] automatically.',
      cta: lang === 'vi' ? 'Kiểm tra miễn phí' : 'Get started',
    },
    {
      painting: '/solva/sticky-2-bg.webp',
      title:
        lang === 'vi'
          ? 'Giải thích dễ hiểu cho người viết, duyệt nhanh một chạm cho giảng viên'
          : 'Clear explanations for authors, one-click sign-off for advisors',
      desc:
        lang === 'vi'
          ? 'Mỗi trích dẫn cần xem lại đều đặt song song thông tin bạn ghi trong bài và bản ghi gốc trên thư viện. Giảng viên hướng dẫn có thể xác nhận hợp lệ ngay cho giáo trình in hoặc luận văn nội bộ kèm ghi chú.'
          : 'Every flagged citation shows side-by-side what you wrote versus the official library record. Advisors can approve print textbooks or regional theses in one click with a review note.',
      cta: lang === 'vi' ? 'Xem cách đối chiếu' : 'See how it works',
    },
    {
      painting: '/solva/sticky-3-bg.webp',
      title:
        lang === 'vi'
          ? 'Phát hiện sớm trích dẫn do AI tự bịa trước khi nộp hội đồng'
          : 'Catch AI-invented references before your committee does',
      desc:
        lang === 'vi'
          ? 'Các công cụ viết bằng AI thường ghép tên tác giả và tạp chí có thật với bài báo không hề tồn tại. CITRA giúp bạn lọc sạch nguồn ảo và theo dõi Điểm Toàn vẹn Trích dẫn tăng lên qua từng bản sửa.'
          : 'AI writing tools often combine real journal titles and author names with articles that do not exist. CITRA catches unverified sources early and tracks your Citation Integrity Score across drafts.',
      cta: lang === 'vi' ? 'Rà soát bài viết' : 'Check manuscript',
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
                ? 'Mọi trích dẫn đều được đối chiếu minh bạch.'
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
                <div className="lg:col-span-7 min-w-0">
                  <SolvaPainterlyFrame
                    paintingSrc={block.painting}
                    alt={block.title}
                    radiusClass="rounded-[10px]"
                    className="w-full min-h-[340px] sm:min-h-[420px] lg:min-h-[520px] p-4 sm:p-6 flex items-center justify-center"
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
                    to={isAuthenticated ? '/upload' : '/register'}
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
  const [isHoverPaused, setIsHoverPaused] = useState<boolean>(false);
  const [showTechnicalTrace, setShowTechnicalTrace] = useState<boolean>(false);
  const remainingTourMsRef = useRef<number>(4200);
  const tourStartedAtRef = useRef<number>(0);
  const {
    containerRef: debuggerRef,
    isVisible: debuggerVisible,
    replaySeed: debuggerSeed,
  } = useFloralCardAnimation(0);

  const activeCitation =
    DEMO_CITATIONS.find((c) => c.id === selectedId) || DEMO_CITATIONS[0];
  const activePlainVerdict = getPlainVerdictLabel(activeCitation.verdict, lang);
  const activePlainMapping = getPlainMappingLabel(activeCitation.mappingStatus, lang);
  const activeActionHint =
    activeCitation.mappingStatus === 'MISSING_REFERENCE'
      ? activePlainMapping.actionHint
      : activePlainVerdict.actionHint;

  useEffect(() => {
    remainingTourMsRef.current = 4200;
  }, [selectedId]);

  useEffect(() => {
    if (!isAutoPlaying || !debuggerVisible || isHoverPaused) return;
    tourStartedAtRef.current = Date.now();
    const delayMs = Math.max(120, remainingTourMsRef.current);
    const timer = window.setTimeout(() => {
      remainingTourMsRef.current = 4200;
      setSelectedId((prev) => {
        const idx = DEMO_CITATIONS.findIndex((c) => c.id === prev);
        const nextIdx = (idx + 1) % DEMO_CITATIONS.length;
        return DEMO_CITATIONS[nextIdx].id;
      });
    }, delayMs);
    return () => {
      const elapsed = Date.now() - tourStartedAtRef.current;
      remainingTourMsRef.current = Math.max(120, remainingTourMsRef.current - elapsed);
      window.clearTimeout(timer);
    };
  }, [isAutoPlaying, debuggerVisible, isHoverPaused, selectedId]);

  const handleSelectCitation = (id: string) => {
    remainingTourMsRef.current = 4200;
    setSelectedId(id);
    setIsAutoPlaying(false);
  };

  const renderFieldStatusBadge = (
    status: 'match' | 'partial' | 'mismatch' | 'missing'
  ) => {
    switch (status) {
      case 'match':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[6px] text-[11px] font-mono font-semibold bg-emerald-500/[0.12] text-emerald-700 dark:text-emerald-300 whitespace-nowrap">
            <Check className="h-3 w-3" /> {lang === 'vi' ? 'Khớp chuẩn' : 'Exact Match'}
          </span>
        );
      case 'partial':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[6px] text-[11px] font-mono font-semibold bg-amber-500/[0.12] text-amber-800 dark:text-amber-300 whitespace-nowrap">
            <AlertTriangle className="h-3 w-3" /> {lang === 'vi' ? 'Gần khớp' : 'Close Match'}
          </span>
        );
      case 'mismatch':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[6px] text-[11px] font-mono font-semibold bg-red-500/[0.12] text-red-700 dark:text-red-300 whitespace-nowrap">
            <XCircle className="h-3 w-3" /> {lang === 'vi' ? 'Chưa khớp' : 'Different'}
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
            {lang === 'vi' ? '— Còn thiếu' : '— Missing'}
          </span>
        );
    }
  };

  const fieldLabelMap: Record<'title' | 'authors' | 'year' | 'venue' | 'doi', string> = {
    title: lang === 'vi' ? 'Tiêu đề' : 'Title',
    authors: lang === 'vi' ? 'Tác giả' : 'Authors',
    year: lang === 'vi' ? 'Năm xuất bản' : 'Year',
    venue: lang === 'vi' ? 'Tạp chí / Kỷ yếu' : 'Journal / Venue',
    doi: lang === 'vi' ? 'Mã DOI' : 'DOI',
  };

  const localizeMetaValue = (val: string) => {
    if (lang !== 'vi') return val;
    if (val === '[Missing from Bibliography Section]') {
      return '[Chưa liệt kê ở Danh mục Tài liệu tham khảo cuối bài]';
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
                ? 'Kiểm tra thử trích dẫn trực quan'
                : 'Live Citation Check'}
            </SolvaEyebrow>
            <SolvaTwoToneHeading
              primary={
                lang === 'vi'
                  ? 'Kiểm tra từng trích dẫn.'
                  : 'Inspect every citation.'
              }
              secondary={
                lang === 'vi'
                  ? 'Hiểu rõ cách sửa chỉ trong vài giây.'
                  : 'Understand every fix in seconds.'
              }
            />
          </div>
          <SolvaScrollReveal delayMs={80} yOffset={24}>
            <p
              style={{ color: 'var(--solva-muted)' }}
              className="font-solva-sans text-[16px] leading-[23.2px] max-w-[420px]"
            >
              {lang === 'vi'
                ? 'Nhấp vào bất kỳ trích dẫn mẫu nào bên dưới để xem CITRA đặt thông tin bạn ghi cạnh bản ghi thư viện gốc và hướng dẫn cách chỉnh sửa cụ thể.'
                : 'Click any sample citation below to see how CITRA compares your manuscript entry with official library records and tells you exactly what to update.'}
            </p>
          </SolvaScrollReveal>
        </div>

        {/* Solva Outer Bezel (`#F4F2EC`, `border-radius: 16px`, `padding: 12px`) */}
        <SolvaScrollReveal delayMs={110} yOffset={36}>
          <div
            ref={debuggerRef}
            data-testid="debugger-bezel"
            onMouseEnter={() => setIsHoverPaused(true)}
            onMouseLeave={() => setIsHoverPaused(false)}
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
                    <span className="w-3 h-3 rounded-full bg-[#FF5F56] border border-[#E0443E]/60 shadow-sm" />
                    <span className="w-3 h-3 rounded-full bg-[#FFBD2E] border border-[#DEA123]/60 shadow-sm" />
                    <span className="w-3 h-3 rounded-full bg-[#27C93F] border border-[#1AAB29]/60 shadow-sm" />
                  </div>
                  <div
                    style={{ color: 'var(--solva-ink)' }}
                    className="flex items-center gap-2 font-mono text-xs min-w-0"
                  >
                    <FileText className="h-3.5 w-3.5 shrink-0" />
                    <span className="font-semibold break-all sm:break-normal min-w-0">
                      thesis_neural_retrieval_2026.pdf
                    </span>
                    <span
                      style={{ color: 'var(--solva-muted)' }}
                      className="hidden sm:inline"
                    >
                      (18 {lang === 'vi' ? 'trang' : 'pages'} · 24{' '}
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
                    {lang === 'vi' ? 'Điểm:' : 'Score:'}{' '}
                    <SolvaLiveNumber
                      value={84.5}
                      decimals={1}
                      decimalSeparator={lang === 'vi' ? ',' : '.'}
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
                    <div className="flex flex-wrap items-center justify-between gap-1.5 mb-3">
                      <span
                        style={{ color: 'var(--solva-muted)' }}
                        className="text-xs font-mono uppercase tracking-wider font-semibold"
                      >
                        {lang === 'vi'
                          ? 'Trích dẫn trong bài (Chọn để xem chi tiết)'
                          : 'Sample Citations (Click to Check)'}
                      </span>
                      <span
                        style={{ color: 'var(--solva-muted)' }}
                        className="text-[11px] font-mono shrink-0 whitespace-nowrap"
                      >
                        {lang === 'vi' ? 'Hiển thị 4 / 24' : '4 / 24 shown'}
                      </span>
                    </div>

                    <div className="space-y-2.5" role="listbox" aria-label="Sample Citations">
                      {DEMO_CITATIONS.map((cit) => {
                        const isSelected = cit.id === activeCitation.id;
                        const plainV = getPlainVerdictLabel(cit.verdict, lang);
                        const plainM = getPlainMappingLabel(cit.mappingStatus, lang);
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
                            className="relative overflow-hidden w-full text-left p-3.5 rounded-[10px] border transition-[background-color,border-color,color,box-shadow] duration-200 cursor-pointer"
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
                                  className="font-mono text-xs font-bold px-2 py-0.5 rounded-[5px] shrink-0"
                                >
                                  {cit.marker}
                                </span>
                                <span
                                  style={{ color: 'var(--solva-ink)' }}
                                  className="font-medium text-sm min-w-0 break-words"
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
                              className="text-xs mb-2.5 font-solva-serif italic leading-snug"
                            >
                              &ldquo;{localizeMetaValue(cit.citedMeta.title)}&rdquo;
                            </p>

                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span
                                  className={`verdict-badge ${cit.verdictBadgeClass} text-[10.5px] px-2 py-0.5 font-medium`}
                                >
                                  {plainV.label}
                                </span>
                                <span
                                  className={`mapping-badge ${cit.mappingBadgeClass} text-[10.5px] px-2 py-0.5 font-medium`}
                                >
                                  {plainM.label}
                                </span>
                              </div>
                              <span
                                style={{ color: 'var(--solva-muted)' }}
                                className="font-mono text-[11px] shrink-0 whitespace-nowrap"
                              >
                                {lang === 'vi' ? 'Độ tin cậy:' : 'Conf:'}{' '}
                                <strong style={{ color: 'var(--solva-ink)' }}>
                                  {cit.confidence}%
                                </strong>
                              </span>
                            </div>

                            {isSelected && isAutoPlaying && (
                              <span
                                key={`tour-progress-${cit.id}`}
                                data-testid="debugger-autotour-progress"
                                data-paused={isHoverPaused || !debuggerVisible ? 'true' : 'false'}
                                aria-hidden="true"
                                className="t-autotour-bar"
                              />
                            )}
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
                          ? `CÂU VĂN TRONG BÀI (${activeCitation.page})`
                          : `SENTENCE IN YOUR PAPER (${activeCitation.page})`}
                      </span>
                      <span>
                        {lang === 'vi' ? 'Đoạn trích gốc' : 'In-text excerpt'}
                      </span>
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

                {/* Right Pane: Plain-Language Verdict & Optional Technical Trace (7 cols) */}
                <div
                  style={{ backgroundColor: 'var(--solva-card-elevated)' }}
                  className="lg:col-span-7 min-w-0 p-4 sm:p-6 flex flex-col justify-between"
                >
                  <div>
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
                              ? 'ĐANG KIỂM TRA MỤC'
                              : 'CHECKING CITATION'}
                          </span>
                          <strong style={{ color: 'var(--solva-ink)' }}>
                            {activeCitation.marker}
                          </strong>
                          <span>
                            · {lang === 'vi' ? 'Độ tin cậy' : 'Confidence'}{' '}
                            <NumberPopIn
                              value={`${activeCitation.confidence}%`}
                              data-testid="debugger-active-confidence"
                            />
                          </span>
                        </div>
                        <h3
                          style={{ color: 'var(--solva-ink)' }}
                          className="font-solva-serif font-light text-[22px] sm:text-[26px] leading-[1.2] break-words"
                        >
                          <SoftTextSwap text={localizeMetaValue(activeCitation.citedMeta.title)} />
                        </h3>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`verdict-badge ${activeCitation.verdictBadgeClass} text-xs px-3 py-1 font-medium`}
                        >
                          {activePlainVerdict.label}
                        </span>
                        <span
                          className={`mapping-badge ${activeCitation.mappingBadgeClass} text-xs px-2.5 py-1 font-medium`}
                        >
                          {activePlainMapping.label}
                        </span>
                      </div>
                    </div>

                    {/* Plain-Language Finding & Actionable Next-Step Callout */}
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
                      <div className="space-y-1.5 text-xs sm:text-sm leading-relaxed">
                        <div style={{ color: 'var(--solva-muted)' }}>
                          <strong
                            style={{ color: 'var(--solva-ink)' }}
                            className="mr-1.5"
                          >
                            {lang === 'vi' ? 'Kết luận kiểm tra:' : 'What we found:'}
                          </strong>
                          <SoftTextSwap
                            text={
                              lang === 'vi'
                                ? activeCitation.explanation.vi
                                : activeCitation.explanation.en
                            }
                          />
                        </div>
                        <div
                          style={{ color: 'var(--solva-ink)' }}
                          className="text-xs font-medium pt-1 border-t border-[#E7E3D9] dark:border-[#332F26]"
                        >
                          <span style={{ color: 'var(--solva-muted)' }} className="mr-1">
                            {lang === 'vi' ? 'Hướng xử lý gợi ý:' : 'Recommended action:'}
                          </span>
                          <span>{activeActionHint}</span>
                        </div>
                      </div>
                    </div>

                    {/* Human-First Inspector Tabs */}
                    <Tabs defaultValue="diff" className="w-full">
                      <TabsList
                        style={{ backgroundColor: 'var(--solva-surface)' }}
                        className="grid grid-cols-1 sm:grid-cols-3 w-full p-1 rounded-[10px] h-auto gap-1"
                      >
                        <TabsTrigger
                          value="diff"
                          className="w-full text-xs font-solva-sans font-medium py-2 sm:py-1.5 px-2.5 rounded-[8px]"
                        >
                          {lang === 'vi' ? '1. So sánh thông tin' : '1. Side-by-Side Details'}
                        </TabsTrigger>
                        <TabsTrigger
                          value="rules"
                          className="w-full text-xs font-solva-sans font-medium py-2 sm:py-1.5 px-2.5 rounded-[8px]"
                        >
                          {lang === 'vi'
                            ? `2. Lý do kết luận (${activeCitation.rules.length})`
                            : `2. Why This Result (${activeCitation.rules.length})`}
                        </TabsTrigger>
                        <TabsTrigger
                          value="sources"
                          className="w-full text-xs font-solva-sans font-medium py-2 sm:py-1.5 px-2.5 rounded-[8px]"
                        >
                          {lang === 'vi' ? '3. Thư viện đã tra cứu' : '3. Libraries Checked'}
                        </TabsTrigger>
                      </TabsList>

                      {/* TAB 1: Side-by-side Bibliographic Details */}
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
                                <th className="py-2.5 px-3 w-32">
                                  {lang === 'vi' ? 'Thông tin' : 'Detail'}
                                </th>
                                <th className="py-2.5 px-3">
                                  {lang === 'vi' ? 'Bạn ghi trong bài' : 'In Your Manuscript'}
                                </th>
                                <th className="py-2.5 px-3">
                                  {lang === 'vi' ? 'Bản ghi thư viện gốc' : 'Official Library Record'}
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
                                    ? '— Không tìm thấy trên 15+ thư viện học thuật —'
                                    : '— Not found in academic libraries —';

                                return (
                                  <tr
                                    key={field}
                                    className="block sm:table-row p-3 sm:p-0 space-y-1.5 sm:space-y-0"
                                  >
                                    <td
                                      style={{ color: 'var(--solva-muted)' }}
                                      className="block sm:table-cell sm:py-2.5 sm:px-3 text-[11.5px] font-semibold"
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
                                      <SoftTextSwap text={citedVal} />
                                    </td>
                                    <td
                                      style={{ color: 'var(--solva-muted)' }}
                                      className="block sm:table-cell sm:py-2.5 sm:px-3 break-words text-[11.5px]"
                                    >
                                      <SoftTextSwap text={retVal} />
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

                      {/* TAB 2: Plain-Language Reasons */}
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
                              <div
                                style={{ color: 'var(--solva-ink)' }}
                                className="text-xs sm:text-[13px] font-medium"
                              >
                                {lang === 'vi' ? rule.plainTitleVi : rule.plainTitleEn}
                              </div>
                              <p
                                style={{ color: 'var(--solva-muted)' }}
                                className="text-xs leading-relaxed break-words"
                              >
                                {lang === 'vi' ? rule.plainSummaryVi : rule.plainSummaryEn}
                              </p>
                            </div>
                            <span
                              className={`self-start sm:self-center px-2.5 py-0.5 rounded text-[10.5px] font-semibold shrink-0 whitespace-nowrap ${
                                rule.status === 'passed'
                                  ? 'bg-emerald-500/[0.12] text-emerald-700 dark:text-emerald-300'
                                  : rule.status === 'warning'
                                    ? 'bg-amber-500/[0.12] text-amber-800 dark:text-amber-300'
                                    : 'bg-red-500/[0.12] text-red-700 dark:text-red-300'
                              }`}
                            >
                              {lang === 'vi'
                                ? rule.status === 'passed'
                                  ? 'Đạt'
                                  : rule.status === 'warning'
                                    ? 'Cần xem lại'
                                    : 'Chưa đạt'
                                : rule.status === 'passed'
                                  ? 'Confirmed'
                                  : rule.status === 'warning'
                                    ? 'Review'
                                    : 'Issue Found'}
                            </span>
                          </div>
                        ))}
                      </TabsContent>

                      {/* TAB 3: Libraries Checked */}
                      <TabsContent value="sources" className="mt-4 animate-debugger-switch">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                          {activeCitation.sources.map((src) => {
                            const srcUrl = getScholarlySourceUrl(src.name);
                            const displayName =
                              lang === 'vi' && src.nameVi ? src.nameVi : src.name;
                            const displayScore =
                              lang === 'vi' && src.scoreVi ? src.scoreVi : src.score;
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
                                      className="text-sm font-medium leading-snug group-hover:underline underline-offset-2"
                                    >
                                      {displayName}
                                    </div>
                                    <div
                                      style={{ color: 'var(--solva-muted)' }}
                                      className="text-xs font-mono"
                                    >
                                      {lang === 'vi' ? 'Phản hồi:' : 'Response:'} {src.latency}
                                    </div>
                                  </div>
                                </div>
                                <span
                                  style={{ color: 'var(--solva-ink)' }}
                                  className="font-mono text-xs font-semibold px-2.5 py-1 rounded bg-[#FBFAF6] dark:bg-[#141310] shrink-0 whitespace-nowrap"
                                >
                                  {displayScore}
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
                                  className="group p-3.5 rounded-[10px] border flex items-center justify-between gap-2 transition-[background-color,border-color,color,box-shadow] duration-200 hover:border-[#1C1A15]/40 dark:hover:border-[#FBFAF6]/35"
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

                    {/* Progressive Disclosure: Technical Rule Trace & Canonical Enums (`R01–R30`) */}
                    <div
                      style={{ borderColor: 'var(--solva-border)' }}
                      className="mt-4 pt-3.5 border-t space-y-3"
                    >
                      <button
                        type="button"
                        data-testid="debugger-technical-trace-toggle"
                        aria-expanded={showTechnicalTrace}
                        aria-controls="debugger-technical-trace-panel"
                        onClick={() => setShowTechnicalTrace((prev) => !prev)}
                        style={{
                          backgroundColor: 'var(--solva-surface)',
                          borderColor: showTechnicalTrace
                            ? 'var(--solva-ink)'
                            : 'var(--solva-border)',
                          color: 'var(--solva-ink)',
                        }}
                        className="w-full min-h-[44px] px-3.5 py-2 rounded-[9px] border font-solva-sans text-xs font-medium flex items-center justify-between gap-2 hover:opacity-90 transition-all cursor-pointer"
                      >
                        <span>
                          {showTechnicalTrace
                            ? lang === 'vi'
                              ? 'Ẩn mã quy tắc & công thức kỹ thuật'
                              : 'Hide Technical Rule Trace & Formulas'
                            : lang === 'vi'
                              ? `Tùy chọn: Xem mã quy tắc kỹ thuật (${SYMBOLIC_RULES_RANGE})`
                              : `Optional: View Technical Rule Trace (${SYMBOLIC_RULES_RANGE})`}
                        </span>
                        <SymmetricChevron open={showTechnicalTrace} size={14} />
                      </button>

                      {showTechnicalTrace && (
                        <div
                          id="debugger-technical-trace-panel"
                          data-testid="debugger-technical-trace-panel"
                          style={{
                            backgroundColor: 'var(--solva-surface)',
                            borderColor: 'var(--solva-border)',
                          }}
                          className="p-3.5 rounded-[10px] border space-y-2.5 animate-debugger-switch"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-[#E7E3D9] dark:border-[#332F26] font-mono text-[11px]">
                            <span style={{ color: 'var(--solva-muted)' }}>
                              {lang === 'vi'
                                ? 'NHÃN HỆ THỐNG CHUẨN (T1 × T2):'
                                : 'CANONICAL OUTPUT CODES (L1 × L2):'}
                            </span>
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span
                                style={{
                                  backgroundColor: 'var(--solva-bg)',
                                  color: 'var(--solva-ink)',
                                  borderColor: 'var(--solva-border)',
                                }}
                                className="px-2 py-0.5 rounded border font-semibold"
                              >
                                {activeCitation.verdict}
                              </span>
                              <span
                                style={{
                                  backgroundColor: 'var(--solva-bg)',
                                  color: 'var(--solva-ink)',
                                  borderColor: 'var(--solva-border)',
                                }}
                                className="px-2 py-0.5 rounded border font-semibold"
                              >
                                {activeCitation.mappingStatus}
                              </span>
                            </div>
                          </div>

                          <div className="space-y-2">
                            {activeCitation.rules.map((rule) => (
                              <div
                                key={`trace-${rule.code}`}
                                style={{
                                  backgroundColor: 'var(--solva-bg)',
                                  borderColor: 'var(--solva-border)',
                                }}
                                className="p-2.5 rounded-[8px] border space-y-1 font-mono text-[11px]"
                              >
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <span style={{ color: 'var(--solva-ink)' }} className="font-bold">
                                    {rule.code} · {lang === 'vi' && rule.nameVi ? rule.nameVi : rule.name}
                                  </span>
                                  <span style={{ color: 'var(--solva-muted)' }}>
                                    {rule.status.toUpperCase()}
                                  </span>
                                </div>
                                <div
                                  style={{ color: 'var(--solva-muted)' }}
                                  className="break-words leading-snug"
                                >
                                  {rule.condition}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
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
  const [isHoverPaused, setIsHoverPaused] = useState(false);
  const remainingStageMsRef = useRef<number>(6000);
  const stageStartedAtRef = useRef<number>(0);
  const { containerRef: useCasesRef, isVisible: useCasesVisible } = useFloralCardAnimation(0);
  const { containerRef: pipelineTabsRef, pillStyle: pipelinePill } =
    useSlidingPill<HTMLDivElement>(activeTab);

  useEffect(() => {
    remainingStageMsRef.current = 6000;
  }, [activeTab]);

  useEffect(() => {
    if (!autoCycleTabs || !useCasesVisible || isHoverPaused) return;
    stageStartedAtRef.current = Date.now();
    const delayMs = Math.max(120, remainingStageMsRef.current);
    const timer = window.setTimeout(() => {
      remainingStageMsRef.current = 6000;
      setActiveTab((prev) => (prev + 1) % 4);
    }, delayMs);
    return () => {
      const elapsed = Date.now() - stageStartedAtRef.current;
      remainingStageMsRef.current = Math.max(120, remainingStageMsRef.current - elapsed);
      window.clearTimeout(timer);
    };
  }, [autoCycleTabs, useCasesVisible, isHoverPaused, activeTab]);

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
      label: lang === 'vi' ? '1. Đọc bài viết' : '1. Read Your Paper',
      icon: FileText,
      painting: '/solva/usecase-1-bg.webp',
      headline:
        lang === 'vi'
          ? 'Nhận diện trọn vẹn trích dẫn trong bài và danh mục cuối bài chỉ trong vài giây'
          : 'Finds every in-text citation and bibliography entry in seconds',
      subFeatures: [
        {
          title:
            lang === 'vi'
              ? 'Tách rõ phần thân bài và danh mục tham khảo'
              : 'Cleanly separates body text from references',
          desc:
            lang === 'vi'
              ? 'Tự động phân biệt đoạn văn chính, chú thích chân trang và phần Tài liệu tham khảo ở cuối bài.'
              : 'Identifies body paragraphs, footnotes, and your final bibliography section automatically.',
        },
        {
          title:
            lang === 'vi'
              ? 'Hỗ trợ chuẩn APA 7th, IEEE, Harvard & Vancouver'
              : 'Supports APA 7th, IEEE, Harvard & Vancouver',
          desc:
            lang === 'vi'
              ? 'Đọc chính xác cả kiểu đánh số [1]–[5] lẫn kiểu Tác giả – Năm phổ biến trong khóa luận và tạp chí.'
              : 'Handles numbered ranges like [1]–[5] as well as author-year formats across disciplines.',
        },
        {
          title:
            lang === 'vi'
              ? 'Báo ngay trích dẫn thiếu nguồn hoặc liệt kê thừa'
              : 'Spots missing or uncited entries right away',
          desc:
            lang === 'vi'
              ? 'Chỉ rõ những chỗ trích dẫn trong bài nhưng quên liệt kê cuối bài, hoặc tài liệu liệt kê nhưng chưa từng trích dẫn.'
              : 'Highlights citations in your text that are missing at the end, and bibliography items never cited.',
        },
      ],
    },
    {
      label: lang === 'vi' ? '2. Tra cứu 15+ thư viện' : '2. Check 15+ Libraries',
      icon: Database,
      painting: '/solva/usecase-2-bg.webp',
      headline:
        lang === 'vi'
          ? 'Đối chiếu song song từng tài liệu trên hơn 15 thư viện học thuật uy tín'
          : 'Looks up every source across 15+ trusted academic libraries at once',
      subFeatures: [
        {
          title:
            lang === 'vi'
              ? 'Kiểm tra mã DOI, mã y sinh và thông tin sách'
              : 'Checks DOIs, PubMed IDs, and book catalogs first',
          desc:
            lang === 'vi'
              ? 'Ưu tiên xác minh mã định danh chính thức trước khi mở rộng tìm kiếm theo tên bài báo và họ tên tác giả.'
              : 'Verifies exact article and book identifiers first before searching by title and author names.',
        },
        {
          title:
            lang === 'vi'
              ? 'Trả kết quả nhanh cho các ấn phẩm kinh điển'
              : 'Fast repeat checks for widely cited works',
          desc:
            lang === 'vi'
              ? 'Nhận diện tức thì các công trình kinh điển, giáo trình đại học và văn bản quy phạm pháp luật Việt Nam.'
              : 'Recognizes seminal papers, university textbooks, and Vietnamese legal statutes in milliseconds.',
        },
        {
          title:
            lang === 'vi'
              ? 'Tự động gộp bản nháp và bài đăng tạp chí chính thức'
              : 'Links preprints and published journal versions',
          desc:
            lang === 'vi'
              ? 'Quy các bản ghi trùng lặp về một hồ sơ chuẩn duy nhất để bạn dễ dàng cập nhật năm xuất bản chính thức.'
              : 'Combines duplicate database records into one clean reference profile so you cite the final version.',
        },
      ],
    },
    {
      label: lang === 'vi' ? '3. Đối chiếu chi tiết' : '3. Compare Details',
      icon: Scale,
      painting: '/solva/usecase-3-bg.webp',
      headline:
        lang === 'vi'
          ? 'So sánh rõ ràng tên bài, tác giả, năm xuất bản, tạp chí và đường dẫn'
          : 'Compares title, authors, publication year, journal, and links side by side',
      subFeatures: [
        {
          title:
            lang === 'vi'
              ? 'Đối chiếu riêng từng thông tin thư mục'
              : 'Field-by-field comparison',
          desc:
            lang === 'vi'
              ? 'Kiểm tra độc lập tiêu đề, danh sách tác giả, năm xuất bản, tên tạp chí/hội nghị và đường dẫn DOI.'
              : 'Checks Title, Author names, Year, Journal/Conference, and DOI individually so you see exact differences.',
        },
        {
          title:
            lang === 'vi'
              ? 'Phát hiện đường dẫn hỏng và mã DOI do AI tự tạo'
              : 'Catches broken links and AI-invented DOIs',
          desc:
            lang === 'vi'
              ? 'Nhận diện ngay trường hợp ghép tên tạp chí có thật với mã số bài báo không tồn tại trên hệ thống quốc tế.'
              : 'Flags real publisher prefixes paired with non-existent article numbers commonly invented by AI tools.',
        },
        {
          title:
            lang === 'vi'
              ? 'Lý do kết luận minh bạch — không phán đoán cảm tính'
              : 'Transparent reasons — never black-box guesswork',
          desc:
            lang === 'vi'
              ? 'Mỗi nhận xét đều chỉ rõ bằng chứng thư viện đối chiếu để người viết và giảng viên dễ dàng kiểm tra.'
              : 'Every result explains exactly why a source was confirmed or flagged so you stay in full control.',
        },
      ],
    },
    {
      label: lang === 'vi' ? '4. Kiểm tra nội dung & Sửa' : '4. Match Meaning & Fix',
      icon: Cpu,
      painting: '/solva/usecase-4-bg.webp',
      headline:
        lang === 'vi'
          ? 'Đảm bảo bài báo gốc củng cố đúng ý trích dẫn và chuẩn hóa danh mục'
          : 'Confirms cited papers support your claim and formats clean fixes',
      subFeatures: [
        {
          title:
            lang === 'vi'
              ? 'Đối chiếu câu viết trong bài với tóm tắt ấn phẩm gốc'
              : 'Compares your sentence with the paper’s abstract',
          desc:
            lang === 'vi'
              ? 'Kiểm tra xem nội dung tóm tắt của tài liệu được trích dẫn có thực sự phù hợp với luận điểm bạn nêu hay không.'
              : 'Checks whether the retrieved abstract actually backs up the statement in your paragraph.',
        },
        {
          title:
            lang === 'vi'
              ? 'Hiểu chính xác bài tiếng Việt trích dẫn nguồn tiếng Anh'
              : 'Seamless across Vietnamese and English writing',
          desc:
            lang === 'vi'
              ? 'Hỗ trợ tự nhiên cho khóa luận, luận văn viết bằng tiếng Việt trích dẫn sách báo quốc tế bằng tiếng Anh.'
              : 'Handles Vietnamese theses citing English international journals and English manuscripts effortlessly.',
        },
        {
          title:
            lang === 'vi'
              ? 'Cảnh báo sớm khi trích dẫn lệch ý tác giả gốc'
              : 'Early alerts for misquoted findings',
          desc:
            lang === 'vi'
              ? 'Giúp bạn rà soát lại những chỗ bài báo có thật nhưng kết luận gốc khác với nội dung đang trích dẫn.'
              : 'Highlights real papers whose findings differ from the claim attached to them before peer review.',
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
        <div className="flex flex-col items-start gap-[12px] max-w-[560px]">
          <SolvaEyebrow>
            {lang === 'vi' ? 'Cách hoạt động trong 4 bước' : 'How it works'}
          </SolvaEyebrow>
          <SolvaTwoToneHeading
            primary={lang === 'vi' ? 'Từ bản thảo tải lên' : 'From uploaded draft'}
            secondary={
              lang === 'vi'
                ? 'đến danh mục tham khảo đáng tin cậy.'
                : 'to a verified bibliography.'
            }
          />
        </div>

        {/* Outer Interactive Container (`#F4F2EC`, `rounded-[16px]`) */}
        <SolvaScrollReveal delayMs={90} yOffset={36}>
          <div
            ref={useCasesRef}
            onMouseEnter={() => setIsHoverPaused(true)}
            onMouseLeave={() => setIsHoverPaused(false)}
            style={{ backgroundColor: 'var(--solva-surface)' }}
            className="w-full rounded-[16px] flex flex-col"
          >
            {/* Top 4-Tab Bar (`padding: 16px 40px`, `gap: 24px`) */}
            <div
              ref={pipelineTabsRef}
              role="tablist"
              aria-label={lang === 'vi' ? '4 giai đoạn thẩm định' : '4 verification stages'}
              className="relative grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-[16px] lg:gap-[24px] p-3 sm:px-[24px] lg:px-[40px] sm:py-[16px]"
            >
              <span
                aria-hidden="true"
                data-testid="pipeline-tabs-pill"
                style={{
                  backgroundColor: 'var(--solva-bg)',
                  width: `${pipelinePill.width}px`,
                  height: `${pipelinePill.height}px`,
                  transform: `translate3d(${pipelinePill.left}px, ${pipelinePill.top}px, 0)`,
                  opacity: pipelinePill.ready ? 1 : 0,
                  transition: pipelinePill.animate ? undefined : 'none',
                }}
                className="t-tabs-pill rounded-[10px]"
              />
              {tabs.map((tab, idx) => {
                const Icon = tab.icon;
                const isActive = idx === activeTab;
                return (
                  <button
                    key={tab.label}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    data-pill-active={isActive ? 'true' : 'false'}
                    onClick={() => {
                      remainingStageMsRef.current = 6000;
                      setActiveTab(idx);
                      setAutoCycleTabs(false);
                    }}
                    style={{
                      backgroundColor:
                        isActive && !pipelinePill.ready ? 'var(--solva-bg)' : 'transparent',
                      color: isActive ? 'var(--solva-ink)' : 'var(--solva-muted)',
                    }}
                    className="t-tab relative overflow-hidden min-h-[44px] py-2 px-2.5 sm:px-3 rounded-[10px] font-solva-sans text-[13px] sm:text-[14px] font-medium flex items-center justify-center gap-[8px] cursor-pointer"
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span className="leading-tight text-center">{tab.label}</span>
                    {isActive && autoCycleTabs && (
                      <span
                        key={`stage-progress-${idx}`}
                        data-testid="pipeline-autotour-progress"
                        data-paused={isHoverPaused || !useCasesVisible ? 'true' : 'false'}
                        style={{ '--autotour-dur': '6000ms' } as React.CSSProperties}
                        aria-hidden="true"
                        className="t-autotour-bar"
                      />
                    )}
                  </button>
                );
              })}
            </div>

            {/* Bottom Content Well (`#FBFAF6` inset with `12px` bezel) */}
            <div className="px-[8px] pb-[8px] sm:px-[12px] sm:pb-[12px]">
              <DirectionalStageSlide
                stageKey={activeTab}
                data-testid="pipeline-stage-slide"
                className="rounded-[14px]"
              >
                <div
                  style={{ backgroundColor: 'var(--solva-bg)' }}
                  className="rounded-[14px] p-3 sm:p-[12px] grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch"
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
                      to={isAuthenticated ? '/upload' : '/register'}
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
              </DirectionalStageSlide>
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
          ? 'Phân quyền riêng biệt theo vai trò'
          : 'Role-based access control',
      desc:
        lang === 'vi'
          ? 'Tách biệt chặt chẽ quyền truy cập và tác vụ chuyên môn giữa không gian Sinh viên, Giảng viên hướng dẫn và Quản trị viên.'
          : 'Clean workspace boundaries across Student, Lecturer, and Administrator roles.',
    },
    {
      icon: Eye,
      title:
        lang === 'vi'
          ? 'Lưu lịch sử duyệt bài minh bạch'
          : 'Transparent review history',
      desc:
        lang === 'vi'
          ? 'Mọi thao tác xác nhận thủ công của giảng viên đều được ghi nhận rõ ràng kèm lý do chuyên môn và mốc thời gian.'
          : 'Every advisor manual approval and faculty action is clearly recorded with rationale and timestamp.',
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
   + Framed Gallery Floral Banner (`/solva/pricing-floral.webp`) & Subgrid Alignment
   ============================================================ */
function SolvaTaxonomyPricingSection({
  lang,
  isAuthenticated,
}: {
  lang: Lang;
  isAuthenticated: boolean;
}) {
  const [annualBilling, setAnnualBilling] = useState(false);

  const tiers = [
    {
      key: 'basic' as const,
      name: 'Basic',
      subtitle: lang === 'vi' ? 'Khởi đầu Học thuật' : 'Student Starter',
      headerTag: lang === 'vi' ? 'MẶC ĐỊNH' : 'DEFAULT',
      headerEyebrow: (lang === 'vi'
        ? '01 · MIỄN PHÍ TRỌN ĐỜI'
        : '01 · FREE FOREVER') as string | null,
      savingsBadge: null as string | null,
      metricNum: 0,
      unit: lang === 'vi' ? 'tháng · Miễn phí' : 'month',
      vndNode:
        lang === 'vi' ? (
          <>
            <span className="whitespace-nowrap">0 ₫/tháng</span> ·{' '}
            <span className="whitespace-nowrap">Không cần thẻ thanh toán</span>
          </>
        ) : null,
      vndTestId: undefined as string | undefined,
      desc:
        lang === 'vi'
          ? 'Bộ công cụ rà soát trích dẫn thiết yếu dành cho sinh viên thực hiện tiểu luận môn học, tổng quan tài liệu và kiểm tra nhanh danh mục tham khảo.'
          : 'Essential citation verification for course essays, literature reviews, and quick bibliography checks.',
      includesLabel: lang === 'vi' ? 'Quyền lợi bao gồm:' : 'Includes:',
      items:
        lang === 'vi'
          ? [
              '3 bản thảo / tháng (tối đa 15 trang, 5 MB / tệp)',
              'Hỗ trợ đầy đủ .PDF, .DOCX, .BIB & .RIS (tối đa 30 trích dẫn / bài)',
              'Tự động đối chiếu trích dẫn trong bài & tài liệu tham khảo (APA, IEEE)',
              'Xác thực trực tiếp qua Crossref, OpenAlex & Văn bản Pháp luật VN',
              'Chấm điểm toàn vẹn trích dẫn & phân loại chi tiết từng lỗi sai lệch',
              'Bao gồm báo cáo trực tuyến đầy đủ (Xuất Word/PDF ở gói Pro)',
            ]
          : [
              '3 manuscripts / month (up to 15 pages, 5 MB)',
              'Supports .PDF, .DOCX, .BIB & .RIS (up to 30 citations / doc)',
              'Automated in-text & bibliography cross-checking (APA, IEEE, Vancouver)',
              'Verified against Crossref, OpenAlex & Vietnam Legal Registry',
              'Clear citation integrity score & structured issue breakdown',
              'Web verification report included (Word/PDF export on Pro)',
            ],
      cta: lang === 'vi' ? 'Bắt đầu miễn phí' : 'Get started free',
      to: isAuthenticated ? '/upload' : '/register',
      featured: false,
    },
    {
      key: 'pro' as const,
      name: 'Pro',
      subtitle:
        lang === 'vi' ? 'Khóa luận & Công bố Quốc tế' : 'Thesis Writers & Researchers',
      headerTag: lang === 'vi' ? '02 · PHỔ BIẾN NHẤT' : '02 · MOST POPULAR',
      headerEyebrow: null as string | null,
      savingsBadge: annualBilling
        ? lang === 'vi'
          ? 'Tiết kiệm $48/năm'
          : 'Save $48/yr'
        : null,
      metricNum: annualBilling ? 16 : 20,
      unit:
        lang === 'vi'
          ? annualBilling
            ? 'tháng (trả theo năm)'
            : 'tháng'
          : annualBilling
            ? 'month (billed yearly)'
            : 'month',
      vndNode:
        lang === 'vi' ? (
          annualBilling ? (
            <>
              <span className="whitespace-nowrap">≈ 400.000 ₫/tháng</span> ·{' '}
              <span className="whitespace-nowrap">4.800.000 ₫/năm</span>{' '}
              <span className="whitespace-nowrap">qua VNPay</span>
            </>
          ) : (
            <>
              <span className="whitespace-nowrap">≈ 500.000 ₫/tháng</span>{' '}
              <span className="whitespace-nowrap">qua VNPay &amp; thẻ quốc tế</span>
            </>
          )
        ) : null,
      vndTestId: 'pro-vnd-equivalent',
      desc:
        lang === 'vi'
          ? 'Tra cứu hơn 15 cơ sở dữ liệu học thuật quốc tế, đối chiếu ngữ nghĩa sâu với tài liệu gốc và chuẩn hóa danh mục tham khảo tự động cho khóa luận, luận văn.'
          : 'Full 15+ scholarly API federation, Sentence-BERT semantic matching, and 1-Click Auto-Fix for graduation theses.',
      includesLabel:
        lang === 'vi'
          ? 'Toàn bộ quyền lợi gói Basic, cộng thêm:'
          : 'Everything in Basic, plus:',
      items:
        lang === 'vi'
          ? [
              '50 bản thảo / tháng (tối đa 100 trang, 25 MB / tệp)',
              'Tối đa 200 trích dẫn / bài & tải lên đồng thời tới 10 bản thảo',
              'Mở khóa toàn bộ 15+ nguồn học thuật uy tín (PubMed, arXiv, DBLP, DOAJ...)',
              'Đối chiếu ngữ nghĩa sâu câu trích dẫn song ngữ Việt ↔ Anh với văn bản gốc',
              'Tự động chuẩn hóa danh mục (APA, IEEE, BibTeX) & xuất báo cáo Word/PDF',
            ]
          : [
              '50 manuscripts / month (up to 100 pages, 25 MB)',
              'Up to 200 citations / manuscript & multi-file upload (up to 10 files)',
              'Full 15+ scholarly indexes (PubMed, arXiv, DBLP, DOAJ & Retraction Watch)',
              'Bilingual semantic claim-to-source evidence verification (EN ↔ VI)',
              'Automated bibliography formatting (APA, IEEE, BibTeX) & Word/PDF export',
            ],
      cta: lang === 'vi' ? 'Nâng cấp lên Pro' : 'Upgrade to Pro',
      to: '/pricing',
      featured: true,
    },
    {
      key: 'ultra' as const,
      name: 'Ultra',
      subtitle:
        lang === 'vi' ? 'Hội đồng & Khoa / Viện' : 'Research Labs & Review Boards',
      headerTag: lang === 'vi' ? 'QUY MÔ LỚN' : 'ENTERPRISE LAB',
      headerEyebrow: (lang === 'vi'
        ? '03 · BỘ MÔN & HỘI ĐỒNG'
        : '03 · FACULTY & COHORT') as string | null,
      savingsBadge: annualBilling
        ? lang === 'vi'
          ? 'Tiết kiệm $480/năm'
          : 'Save $480/yr'
        : null,
      metricNum: annualBilling ? 160 : 200,
      unit:
        lang === 'vi'
          ? annualBilling
            ? 'tháng (trả theo năm)'
            : 'tháng'
          : annualBilling
            ? 'month (billed yearly)'
            : 'month',
      vndNode:
        lang === 'vi' ? (
          annualBilling ? (
            <>
              <span className="whitespace-nowrap">≈ 4.000.000 ₫/tháng</span> ·{' '}
              <span className="whitespace-nowrap">48.000.000 ₫/năm</span>{' '}
              <span className="whitespace-nowrap">qua VNPay</span>
            </>
          ) : (
            <>
              <span className="whitespace-nowrap">≈ 5.000.000 ₫/tháng</span>{' '}
              <span className="whitespace-nowrap">qua VNPay &amp; thẻ quốc tế</span>
            </>
          )
        ) : null,
      vndTestId: 'ultra-vnd-equivalent',
      desc:
        lang === 'vi'
          ? 'Giải pháp thẩm định chuyên sâu cho Bộ môn, Khoa và Hội đồng bảo vệ với tra cứu mở rộng qua Google Scholar, quản lý đợt nộp bài và nhật ký thẩm định.'
          : 'High-volume institutional verification with extended Google Scholar discovery, cohort management, and faculty review logs.',
      includesLabel:
        lang === 'vi'
          ? 'Toàn bộ quyền lợi gói Pro, cộng thêm:'
          : 'Everything in Pro, plus:',
      items:
        lang === 'vi'
          ? [
              'Tối đa 1.000 bản thảo / tháng (lên đến 500 trang, 100 MB / tệp)',
              'Không giới hạn số trích dẫn / bài & rà soát đồng thời tới 50 bản thảo',
              'Tra cứu mở rộng qua Google Scholar cho sách chuyên khảo & ấn phẩm hiếm',
              'Không gian quản lý lớp học, thu bài theo đợt & điều chỉnh kết luận của giảng viên',
              'Luồng xử lý ưu tiên, lưu trữ trọn đời & nhật ký thẩm định cấp đơn vị',
            ]
          : [
              'Up to 1,000 manuscripts / month (up to 500 pages, 100 MB each)',
              'Unlimited citations per paper & bulk cohort upload (up to 50 files)',
              'Extended Google Scholar discovery for rare monographs & regional works',
              'Faculty cohort workspace, student submissions & instructor review notes',
              'Priority processing queue, lifetime history & institutional audit trail',
            ],
      cta: lang === 'vi' ? 'Khám phá gói Ultra' : 'Explore Ultra plan',
      to: '/pricing',
      featured: false,
    },
  ];

  return (
    <section
      id="pricing-plans"
      className="scroll-mt-[84px] lg:scroll-mt-[108px] py-[36px] sm:py-[48px] lg:py-[96px] px-5 sm:px-6 lg:px-[40px]"
    >
      <div
        id="taxonomy"
        className="scroll-mt-[88px] max-w-[1200px] mx-auto flex flex-col items-center gap-[28px] sm:gap-[36px] lg:gap-[64px]"
      >
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
          {/* Tactile Switch (#27 TactileToggle) */}
          <SolvaScrollReveal yOffset={20}>
            <div className="inline-flex flex-wrap items-center justify-center gap-2 sm:gap-[10px]">
              <span
                style={{ color: 'var(--solva-ink)' }}
                className="font-solva-sans text-[14px] sm:text-[16px] whitespace-nowrap"
              >
                {lang === 'vi' ? (
                  <>
                    <span className="hidden sm:inline">Thanh toán theo tháng</span>
                    <span className="sm:hidden">Theo tháng</span>
                  </>
                ) : (
                  'Monthly'
                )}
              </span>
              <TactileToggle
                checked={annualBilling}
                onChange={setAnnualBilling}
                aria-label="Toggle billing cycle"
                data-testid="landing-billing-toggle"
              />
              <span
                style={{ color: 'var(--solva-ink)' }}
                className="font-solva-sans text-[14px] sm:text-[16px] whitespace-nowrap"
              >
                {lang === 'vi' ? (
                  <>
                    <span className="hidden sm:inline">Theo năm (Tiết kiệm 20%)</span>
                    <span className="sm:hidden">Theo năm (-20%)</span>
                  </>
                ) : (
                  'Yearly -20%'
                )}
              </span>
            </div>
          </SolvaScrollReveal>

          {/* 3 Plan Cards (`lg:grid-cols-3` + 5-row CSS subgrid for horizontal row parity) */}
          <div className="w-full grid grid-cols-1 gap-y-[16px] lg:grid-cols-3 lg:gap-x-[16px] lg:gap-y-0 items-stretch">
            {tiers.map((tier, idx) => (
              <SolvaScrollReveal
                key={tier.key}
                delayMs={idx * 95}
                yOffset={36}
                className="h-full lg:row-span-5 lg:grid lg:grid-rows-subgrid"
              >
                <div
                  style={{
                    backgroundColor: 'var(--solva-surface)',
                    borderColor: tier.featured ? 'var(--solva-ink)' : 'var(--solva-border)',
                  }}
                  className={`relative rounded-[16px] ${
                    tier.featured
                      ? 'border-2 shadow-[0_12px_36px_rgba(28,26,21,0.08)]'
                      : 'border'
                  } p-[8px] sm:p-[10px] flex flex-col overflow-hidden h-full lg:row-span-5 lg:grid lg:grid-rows-subgrid`}
                >
                  {/* Row 1: Top Architectural / Floral Gallery Header Band (`min-h-[104px]`) */}
                  <div
                    className={`relative min-h-[100px] sm:min-h-[104px] rounded-t-[11px] overflow-hidden px-4 sm:px-5 py-3.5 flex flex-col justify-between ${
                      tier.featured
                        ? ''
                        : idx === 0
                          ? 'bg-gradient-to-b from-[#ECE9E0]/90 via-[#F4F2EC]/55 to-transparent dark:from-[#26231C]/90 dark:via-[#1E1C17]/55 dark:to-transparent'
                          : 'bg-gradient-to-b from-[#E8E3D6]/95 via-[#F4F2EC]/55 to-transparent dark:from-[#2A261E]/95 dark:via-[#1E1C17]/55 dark:to-transparent'
                    }`}
                  >
                    {tier.featured && (
                      <>
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
                      </>
                    )}

                    <div className="relative z-10 flex items-start justify-between gap-x-2 gap-y-2 flex-wrap">
                      {tier.featured ? (
                        <span
                          style={{ backgroundColor: '#1C1A15', color: '#FBFAF6' }}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[6px] border border-white/15 shadow-sm font-mono text-[11px] font-semibold leading-none tracking-wide whitespace-nowrap shrink-0"
                        >
                          <Sparkles className="w-3 h-3 shrink-0" />
                          <span>{tier.headerTag}</span>
                        </span>
                      ) : (
                        <span
                          style={{
                            backgroundColor: 'var(--solva-bg)',
                            borderColor: 'var(--solva-border)',
                            color: 'var(--solva-muted)',
                          }}
                          className="inline-flex items-center px-2.5 py-1 rounded-[6px] border font-mono text-[11px] font-medium leading-none whitespace-nowrap shrink-0"
                        >
                          {tier.headerTag}
                        </span>
                      )}

                      {tier.savingsBadge && (
                        <span className="inline-flex items-center px-2.5 py-1 rounded-[6px] bg-[#FBFAF6] text-emerald-800 border border-emerald-700/25 dark:bg-[#141310] dark:text-emerald-300 dark:border-emerald-400/30 shadow-sm font-mono text-[11px] font-semibold leading-none whitespace-nowrap shrink-0">
                          {tier.savingsBadge}
                        </span>
                      )}
                    </div>

                    {tier.headerEyebrow && (
                      <span
                        style={{ color: 'var(--solva-muted)' }}
                        className="relative z-10 font-mono text-[11px] uppercase tracking-wider whitespace-nowrap"
                      >
                        {tier.headerEyebrow}
                      </span>
                    )}
                  </div>

                  {/* Rows 2..5: High-Contrast Card Body Surface */}
                  <div
                    style={
                      tier.featured
                        ? undefined
                        : {
                            backgroundColor: 'var(--solva-bg)',
                            borderColor: 'var(--solva-border)',
                          }
                    }
                    className={`${
                      tier.featured ? 'solva-pro-card-surface' : 'border'
                    } relative z-10 rounded-[12px] px-[20px] sm:px-[24px] py-[22px] sm:py-[24px] flex flex-col justify-between gap-[20px] lg:gap-y-0 flex-1 lg:row-span-4 lg:grid lg:grid-rows-subgrid`}
                  >
                    {/* Row 2: Tier Title, Subtitle & Description */}
                    <div className="space-y-[10px] lg:pb-[18px]">
                      <div>
                        <h3
                          style={{ color: 'var(--solva-ink)' }}
                          className={`font-solva-sans text-[22px] ${
                            tier.featured ? 'font-medium' : 'font-normal'
                          } leading-[28px] tracking-[-0.02em]`}
                        >
                          {tier.name}
                        </h3>
                        <p
                          style={{ color: 'var(--solva-muted)' }}
                          className="font-solva-sans text-[13px] mt-0.5"
                        >
                          {tier.subtitle}
                        </p>
                      </div>

                      <p
                        style={{
                          color: tier.featured ? 'var(--solva-ink)' : 'var(--solva-muted)',
                        }}
                        className={`font-solva-sans text-[15px] leading-[22.5px] ${
                          tier.featured ? 'font-medium' : ''
                        }`}
                      >
                        {tier.desc}
                      </p>
                    </div>

                    {/* Row 3: Price Display (`Sentient` 40px Light + #02 Per-Digit NumberPopIn) + VI VND Equivalent */}
                    <div
                      style={{ borderColor: 'var(--solva-border)' }}
                      className="pt-[16px] lg:pb-[18px] border-t"
                    >
                      <div className="flex items-baseline gap-1.5 flex-wrap">
                        <span
                          style={{ color: 'var(--solva-ink)' }}
                          className="font-solva-serif font-light text-[36px] sm:text-[40px] leading-[46px] tracking-[-0.05em]"
                        >
                          <NumberPopIn
                            value={`$${tier.metricNum}`}
                            data-testid={`landing-price-${tier.key}`}
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
                          <SoftTextSwap text={`/ ${tier.unit}`} />
                        </span>
                      </div>
                      {tier.vndNode && (
                        <p
                          data-testid={tier.vndTestId}
                          style={{
                            color: tier.featured ? 'var(--solva-ink)' : 'var(--solva-muted)',
                          }}
                          className={`font-mono text-[12px] mt-1 ${
                            tier.featured ? 'font-medium' : ''
                          }`}
                        >
                          {tier.vndNode}
                        </p>
                      )}
                    </div>

                    {/* Row 4: Benefits Checklist */}
                    <div className="space-y-[10px] pt-1 lg:pb-[20px]">
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

                    {/* Row 5: Bottom CTA Button */}
                    <div
                      style={{ borderColor: 'var(--solva-border)' }}
                      className="pt-[16px] border-t flex items-end"
                    >
                      <SolvaButton
                        to={tier.to}
                        variant={tier.featured ? 'primary' : 'outline'}
                        fullWidth
                      >
                        {tier.cta}
                      </SolvaButton>
                    </div>
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
                  ? 'Thanh toán bảo mật quốc tế qua Stripe & nội địa VNPay (chuẩn PCI-DSS) · Đối chiếu trực tiếp với hơn 200 triệu ấn phẩm khoa học từ 15+ cơ sở dữ liệu quốc tế'
                  : 'PCI-DSS encrypted checkout via Stripe & VNPay · Cross-referencing 200M+ canonical works across 15+ global scholarly indexes'}
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
                className="w-full min-h-[380px] sm:min-h-[420px] lg:min-h-[476px] h-full py-5 px-4 sm:p-6 flex items-center justify-center"
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
                        ? '“Đầu tuần vừa qua, chúng tôi đưa 120 quyển khóa luận tốt nghiệp vào rà soát trên CITRA. Chỉ trong một buổi sáng, hệ thống đã chỉ rõ từng mã DOI không tồn tại và năm xuất bản sai — '
                        : '“We ran CITRA across 120 graduation theses on Monday morning. Within an hour, it highlighted every broken DOI and wrong publication year '}
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
                      ? 'PGS.TS. Nguyễn Minh Châu'
                      : 'Dr. Elena Rostova'}
                  </div>
                  <div
                    style={{ color: 'var(--solva-muted)' }}
                    className="font-solva-sans text-[14px] leading-[21px]"
                  >
                    {lang === 'vi'
                      ? 'Chủ tịch Hội đồng Bảo vệ Khóa luận Tốt nghiệp'
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
                      ? 'Bài báo khoa học kiểm định thực tế'
                      : 'Academic papers tested in benchmark'
                  }
                />
                <SolvaAnimatedMetric
                  targetValue={99.02}
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
                      ? 'Độ chuẩn xác phát hiện nguồn ảo (0 kết luận oan)'
                      : 'Precision catching fake sources (0 false flags)'
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
   Interactive 3-Role Showcase + Solva's 3-Column Staggered Grid
   ============================================================ */
function SolvaRoleWorkspacesShowcase({
  lang,
  activeRole,
  onSelectRole,
  isAuthenticated,
}: {
  lang: Lang;
  activeRole: WorkspaceRole;
  onSelectRole: (role: WorkspaceRole) => void;
  isAuthenticated: boolean;
}) {
  const isVi = lang === 'vi';
  const roleOrder: WorkspaceRole[] = ['student', 'teacher', 'admin'];

  const roleConfigs: Record<
    WorkspaceRole,
    {
      tabLabel: string;
      eyebrow: string;
      headline: string;
      summary: string;
      steps: string[];
      ctaLabel: string;
      ctaTo: string;
      previewTitle: string;
      previewSubtitle: string;
      previewMetricLabel: string;
      previewMetricValue: string;
      previewRows: Array<{ label: string; badge: string; tone: 'ok' | 'warn' | 'info' }>;
      icon: typeof GraduationCap;
    }
  > = {
    student: {
      tabLabel: isVi ? 'Sinh viên & Tác giả' : 'Students & Authors',
      eyebrow: isVi ? 'DÀNH CHO SINH VIÊN & TÁC GIẢ' : 'FOR STUDENTS & AUTHORS',
      headline: isVi
        ? 'Hoàn thiện khóa luận và bài báo với sự tự tin trọn vẹn trước giờ nộp.'
        : 'Submit your thesis or manuscript with complete bibliographic confidence.',
      summary: isVi
        ? 'Rà soát danh mục tham khảo ngay khi đang viết, không sợ sót nguồn hay nhầm năm xuất bản.'
        : 'Verify every reference while you write — before a reviewer or advisor ever sees a formatting slip.',
      steps: isVi
        ? [
            'Tải tệp PDF, Word (.docx), BibTeX hoặc dán trực tiếp đoạn tài liệu tham khảo để kiểm tra nhanh.',
            'Phát hiện tức thì trích dẫn thiếu mục tài liệu cuối bài, lệch năm công bố hoặc tài liệu không có thật.',
            'Chuẩn hóa trích dẫn chuẩn APA, IEEE, Harvard và theo dõi Điểm Toàn vẹn Trích dẫn (Citation Integrity Score) tăng qua từng bản sửa.',
          ]
        : [
            'Upload a PDF, Word (.docx), or bibliography file — or paste references for an instant check while writing.',
            'Spot missing bibliography entries, wrong publication years, and non-existent AI-suggested papers in seconds.',
            'Apply clean APA, IEEE, or Harvard fixes and watch your Citation Integrity Score climb across revisions.',
          ],
      ctaLabel: isAuthenticated
        ? isVi
          ? 'Kiểm tra bản thảo ngay'
          : 'Check a Manuscript Now'
        : isVi
          ? 'Bắt đầu miễn phí cho Tác giả'
          : 'Start Free Author Check',
      ctaTo: isAuthenticated ? '/upload' : '/register',
      previewTitle: isVi ? 'Bản xem trước Khóa luận Tốt nghiệp' : 'Thesis Readiness Snapshot',
      previewSubtitle: isVi
        ? 'Bản nộp cuối · 30 tài liệu tham khảo'
        : 'Final Submission · 30 References Checked',
      previewMetricLabel: isVi
        ? 'Điểm Toàn vẹn Trích dẫn'
        : 'Citation Integrity Score',
      previewMetricValue: '72% → 98%',
      previewRows: isVi
        ? [
            { label: '28 nguồn học thuật khớp chuẩn quốc tế', badge: 'ĐÃ XÁC THỰC', tone: 'ok' },
            { label: '2 lỗi ghi nhầm năm bản nháp đã chỉnh sửa', badge: 'ĐÃ CHUẨN HÓA', tone: 'info' },
            { label: '0 tài liệu tham khảo ngụy tạo tồn đọng', badge: 'SẴN SÀNG NỘP', tone: 'ok' },
          ]
        : [
            { label: '28 scholarly sources matched & confirmed', badge: 'VERIFIED', tone: 'ok' },
            { label: '2 preprint-to-journal year typos corrected', badge: 'FIXED', tone: 'info' },
            { label: '0 unresolved phantom references remaining', badge: 'READY', tone: 'ok' },
          ],
      icon: GraduationCap,
    },
    teacher: {
      tabLabel: isVi ? 'Giảng viên & Hội đồng' : 'Lecturers & Advisors',
      eyebrow: isVi ? 'DÀNH CHO GIẢNG VIÊN & HỘI ĐỒNG' : 'FOR LECTURERS & ADVISORS',
      headline: isVi
        ? 'Thẩm định trích dẫn cho cả lớp học và hội đồng chỉ trong vài phút.'
        : 'Review an entire cohort’s bibliography in minutes, not weekends.',
      summary: isVi
        ? 'Tập trung thời gian quý báu vào hướng dẫn chuyên môn thay vì tra cứu thủ công từng tiêu đề bài báo.'
        : 'Spend your advising hours mentoring research depth instead of manually searching reference lists.',
      steps: isVi
        ? [
            'Mở lớp học bằng mã tham gia đơn giản hoặc tải lên cùng lúc tới 50 bài nộp của sinh viên.',
            'Xem danh sách ưu tiên làm nổi bật các trích dẫn nghi vấn bịa đặt hoặc lệch nội dung so với tóm tắt bài báo gốc.',
            'Xác nhận hợp lệ một chạm cho giáo trình, sách chuyên khảo in trong nước kèm ghi chú góp ý xây dựng.',
          ]
        : [
            'Open a class cohort with a simple join code, or upload up to 50 student submissions in a single batch.',
            'Scan a clear review queue highlighting fabricated citations and claims that diverge from the cited paper’s abstract.',
            'Approve domestic print monographs or regional textbooks in one click and attach constructive advisor feedback.',
          ],
      ctaLabel: isVi ? 'Xem gói Giảng viên & Lớp học' : 'Explore Lecturer Plans',
      ctaTo: '/pricing',
      previewTitle: isVi ? 'Bảng Tổng hợp Lớp Khóa luận' : 'Cohort Review Dashboard',
      previewSubtitle: isVi
        ? 'Hội đồng KLTN · 38 bài nộp của sinh viên'
        : 'Honors Thesis Cohort · 38 Student Submissions',
      previewMetricLabel: isVi ? 'Thời gian rà soát tiết kiệm' : 'Manual Lookup Time Saved',
      previewMetricValue: '~85%',
      previewRows: isVi
        ? [
            { label: '31 quyển đạt chuẩn danh mục tài liệu tham khảo', badge: 'HỢP LỆ', tone: 'ok' },
            { label: '5 bài cần bổ sung số tập / trang tạp chí', badge: 'GỢI Ý SỬA', tone: 'info' },
            { label: '2 sách in trong nước chờ giảng viên duyệt', badge: 'DUYỆT 1 CHẠM', tone: 'warn' },
          ]
        : [
            { label: '31 submissions with clean reference lists', badge: 'CLEAN', tone: 'ok' },
            { label: '5 papers needing minor volume or year fixes', badge: 'GUIDANCE', tone: 'info' },
            { label: '2 print monographs queued for 1-click approval', badge: 'ADVISOR REVIEW', tone: 'warn' },
          ],
      icon: Users,
    },
    admin: {
      tabLabel: isVi ? 'Quản trị Khoa & Trường' : 'Department Admin',
      eyebrow: isVi ? 'DÀNH CHO KHOA, VIỆN & NHÀ TRƯỜNG' : 'FOR FACULTIES & DEPARTMENTS',
      headline: isVi
        ? 'Đồng bộ chuẩn mực trích dẫn và bảo mật học thuật trên toàn đơn vị.'
        : 'Consistent citation standards and transparent governance across faculties.',
      summary: isVi
        ? 'Đảm bảo tính giải trình minh bạch cho hội đồng học thuật và bảo vệ tuyệt đối tài sản trí tuệ của nhà trường.'
        : 'Equip thesis committees and research labs with clear quotas, accountable review trails, and strict data protection.',
      steps: isVi
        ? [
            'Phân quyền rõ ràng cho Sinh viên, Giảng viên, Quản trị viên và điều phối hạn mức kiểm tra cho từng bộ môn.',
            'Lưu giữ lịch sử duyệt thủ công minh bạch, không thể chỉnh sửa lùi ngày phục vụ công tác kiểm định chất lượng.',
            'Bảo vệ tuyệt đối luận văn chưa công bố — không chia sẻ toàn văn ra bất kỳ kho dữ liệu đối chiếu bên ngoài nào.',
          ]
        : [
            'Manage Student, Lecturer, and Administrator accounts and allocate monthly verification quotas across cohorts.',
            'Maintain a clear, tamper-evident review history of manual citation approvals for academic board accountability.',
            'Keep unpublished theses strictly private — zero external full-text sharing and full compliance with Law 91/2025/QH15.',
          ],
      ctaLabel: isVi ? 'Xem gói cho Khoa & Bộ môn' : 'Compare Institutional Tier',
      ctaTo: '/pricing',
      previewTitle: isVi ? 'Tổng quan Quản trị Học thuật Khoa' : 'Faculty Governance Overview',
      previewSubtitle: isVi
        ? 'Phân quyền theo vai trò · Bảo mật cấp đơn vị'
        : 'Role-Isolated Access · Institutional Safeguards',
      previewMetricLabel: isVi ? 'Chia sẻ toàn văn ra bên ngoài' : 'External Full-Text Sharing',
      previewMetricValue: '0%',
      previewRows: isVi
        ? [
            { label: 'Phân tách độc lập Sinh viên · Giảng viên · Quản trị', badge: 'ĐÃ KÍCH HOẠT', tone: 'ok' },
            { label: 'Nhật ký xác nhận của hội đồng minh bạch', badge: 'MINH BẠCH', tone: 'info' },
            { label: 'Tuân thủ Luật Bảo vệ dữ liệu 91/2025/QH15', badge: 'CHUẨN PHÁP LÝ', tone: 'ok' },
          ]
        : [
            { label: 'Isolated Student, Lecturer & Admin permissions', badge: 'ACTIVE', tone: 'ok' },
            { label: 'Tamper-evident advisor override history', badge: 'AUDITED', tone: 'info' },
            { label: 'Aligned with Data Protection Law 91/2025/QH15', badge: 'COMPLIANT', tone: 'ok' },
          ],
      icon: Shield,
    },
  };

  const current = roleConfigs[activeRole];

  const handleTabKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, idx: number) => {
    let nextIdx: number | null = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      nextIdx = (idx + 1) % roleOrder.length;
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      nextIdx = (idx - 1 + roleOrder.length) % roleOrder.length;
    } else if (e.key === 'Home') {
      nextIdx = 0;
    } else if (e.key === 'End') {
      nextIdx = roleOrder.length - 1;
    }
    if (nextIdx !== null) {
      e.preventDefault();
      const nextRole = roleOrder[nextIdx];
      onSelectRole(nextRole);
      document.getElementById(`workspace-tab-${nextRole}`)?.focus();
    }
  };

  return (
    <div data-testid="role-workspaces-showcase" className="w-full flex flex-col gap-[20px]">
      {/* Accessible 3-Role Segmented Switcher (Mobile-safe stacked pills at 375px, 3-col bar on sm+) */}
      <div
        role="tablist"
        aria-label={isVi ? 'Không gian làm việc theo vai trò học thuật' : 'Academic workspaces by role'}
        style={{
          backgroundColor: 'var(--solva-surface)',
          borderColor: 'var(--solva-border)',
        }}
        className="w-full max-w-[780px] grid grid-cols-1 sm:grid-cols-3 gap-1.5 p-1.5 rounded-[14px] border"
      >
        {roleOrder.map((roleKey, idx) => {
          const cfg = roleConfigs[roleKey];
          const Icon = cfg.icon;
          const isSelected = activeRole === roleKey;
          return (
            <button
              key={roleKey}
              id={`workspace-tab-${roleKey}`}
              data-testid={`workspace-tab-${roleKey}`}
              type="button"
              role="tab"
              aria-selected={isSelected}
              aria-controls={`workspace-panel-${roleKey}`}
              tabIndex={isSelected ? 0 : -1}
              onClick={() => onSelectRole(roleKey)}
              onKeyDown={(e) => handleTabKeyDown(e, idx)}
              className={`min-h-[44px] px-3.5 py-2.5 rounded-[10px] inline-flex items-center justify-center gap-2 font-solva-sans text-[14px] font-medium transition-all cursor-pointer ${
                isSelected
                  ? 'bg-white dark:bg-[#26231D] text-[#1C1A15] dark:text-[#FBFAF6] shadow-sm border border-[#E7E3D9] dark:border-[#3A352B]'
                  : 'text-[var(--solva-muted)] hover:text-[var(--solva-ink)] border border-transparent'
              }`}
            >
              <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>{cfg.tabLabel}</span>
            </button>
          );
        })}
      </div>

      {/* Active Role Panel */}
      <div
        id={`workspace-panel-${activeRole}`}
        role="tabpanel"
        aria-labelledby={`workspace-tab-${activeRole}`}
        style={{
          backgroundColor: 'var(--solva-surface)',
          borderColor: 'var(--solva-border)',
        }}
        className="w-full rounded-[16px] border p-5 sm:p-8 lg:p-10 grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-10 items-center"
      >
        {/* Left: Jargon-Free Workflow */}
        <div className="lg:col-span-7 flex flex-col items-start gap-5">
          <span
            style={{
              backgroundColor: 'var(--solva-bg)',
              color: 'var(--solva-muted)',
              borderColor: 'var(--solva-border)',
            }}
            className="px-3 py-1 rounded-full border font-mono text-[11px] font-medium tracking-wide"
          >
            {current.eyebrow}
          </span>

          <div className="space-y-2.5">
            <h3
              style={{ color: 'var(--solva-ink)' }}
              className={`font-solva-serif font-light text-[26px] sm:text-[32px] ${
                isVi ? 'leading-[1.18] tracking-[-0.025em]' : 'leading-[1.1] tracking-[-0.04em]'
              }`}
            >
              {current.headline}
            </h3>
            <p
              style={{ color: 'var(--solva-muted)' }}
              className="font-solva-sans text-[15.5px] sm:text-[16px] leading-[24px]"
            >
              {current.summary}
            </p>
          </div>

          <ol className="space-y-3 w-full">
            {current.steps.map((step, sIdx) => (
              <li key={step} className="flex items-start gap-3">
                <span
                  style={{
                    backgroundColor: 'var(--solva-bg)',
                    color: 'var(--solva-ink)',
                    borderColor: 'var(--solva-border)',
                  }}
                  className="mt-0.5 w-6 h-6 rounded-full border font-mono text-[11px] font-semibold flex items-center justify-center shrink-0"
                >
                  {sIdx + 1}
                </span>
                <span
                  style={{ color: 'var(--solva-ink)' }}
                  className="font-solva-sans text-[15px] leading-[22.5px]"
                >
                  {step}
                </span>
              </li>
            ))}
          </ol>

          <div className="pt-1">
            <SolvaButton to={current.ctaTo} variant="primary">
              <span>{current.ctaLabel}</span>
              <ArrowRight className="w-4 h-4 shrink-0" />
            </SolvaButton>
          </div>
        </div>

        {/* Right: Clean Visual Summary Card */}
        <div className="lg:col-span-5 w-full">
          <div
            style={{
              backgroundColor: 'var(--solva-bg)',
              borderColor: 'var(--solva-border)',
            }}
            className="rounded-[14px] border p-5 sm:p-6 flex flex-col gap-5 shadow-sm"
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-4 border-b border-[#E7E3D9] dark:border-[#332F26]">
              <div className="space-y-0.5">
                <div
                  style={{ color: 'var(--solva-ink)' }}
                  className="font-solva-sans text-[15.5px] font-semibold leading-snug"
                >
                  {current.previewTitle}
                </div>
                <div
                  style={{ color: 'var(--solva-muted)' }}
                  className="font-solva-sans text-[13px] leading-snug"
                >
                  {current.previewSubtitle}
                </div>
              </div>
              <div className="sm:text-right">
                <div className="font-mono text-[18px] font-semibold text-emerald-700 dark:text-emerald-400">
                  {current.previewMetricValue}
                </div>
                <div
                  style={{ color: 'var(--solva-muted)' }}
                  className="font-mono text-[10.5px] uppercase tracking-wider"
                >
                  {current.previewMetricLabel}
                </div>
              </div>
            </div>

            <div className="space-y-2.5">
              {current.previewRows.map((row) => {
                const badgeClass =
                  row.tone === 'ok'
                    ? 'bg-emerald-500/[0.12] text-emerald-800 dark:text-emerald-300 border-emerald-500/25'
                    : row.tone === 'warn'
                      ? 'bg-amber-500/[0.12] text-amber-800 dark:text-amber-300 border-amber-500/25'
                      : 'bg-sky-500/[0.12] text-sky-800 dark:text-sky-300 border-sky-500/25';
                return (
                  <div
                    key={row.label}
                    style={{
                      backgroundColor: 'var(--solva-surface)',
                      borderColor: 'var(--solva-border)',
                    }}
                    className="rounded-[10px] border px-3.5 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                  >
                    <span
                      style={{ color: 'var(--solva-ink)' }}
                      className="font-solva-sans text-[13.5px] leading-[19.5px]"
                    >
                      {row.label}
                    </span>
                    <span
                      className={`self-start sm:self-auto px-2 py-0.5 rounded-[6px] border font-mono text-[10.5px] font-semibold whitespace-nowrap shrink-0 ${badgeClass}`}
                    >
                      {row.badge}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SolvaRoleTestimonialsSection({
  lang,
  activeRole,
  onSelectRole,
  isAuthenticated,
}: {
  lang: Lang;
  activeRole: WorkspaceRole;
  onSelectRole: (role: WorkspaceRole) => void;
  isAuthenticated: boolean;
}) {
  const columns = [
    // Column 1 (padding-top: 0px)
    [
      {
        roleBadge: lang === 'vi' ? 'SINH VIÊN & HỌC VIÊN' : 'STUDENT WORKSPACE',
        quote:
          lang === 'vi'
            ? '“Trước ngày nộp quyển khóa luận, mình đưa bản PDF lên CITRA rà soát lần cuối và phát hiện 3 tài liệu bị ghi nhầm năm bản nháp thay vì năm xuất bản chính thức trên tạp chí.”'
            : '“Before submitting my thesis, I ran my PDF through CITRA and caught three draft-to-journal year mismatches in under two minutes.”',
        author: lang === 'vi' ? 'Minh Quân' : 'Marcus Chen',
        role:
          lang === 'vi'
            ? 'Học viên Cao học · Tác giả Luận văn Tốt nghiệp'
            : 'Graduate Thesis Author',
      },
      {
        roleBadge: lang === 'vi' ? 'KIỂM TRA NHANH KHI ĐANG VIẾT' : 'QUICK REFERENCE CHECK',
        quote:
          lang === 'vi'
            ? '“Tiện lợi nhất là chế độ dán văn bản nhanh: chỉ cần chép một đoạn tổng quan tài liệu kèm danh mục tham khảo vào là kiểm chứng được ngay khi đang viết chương 2.”'
            : '“Being able to paste a single literature review section and check its references on the spot saves hours while drafting early chapters.”',
        author: lang === 'vi' ? 'Thanh Thảo' : 'Sophia Nguyen',
        role:
          lang === 'vi'
            ? 'Nghiên cứu sinh Kinh tế & Chính sách công'
            : 'Economics & Public Policy Researcher',
      },
      {
        roleBadge: lang === 'vi' ? 'THEO DÕI TIẾN ĐỘ SỬA BÀI' : 'REVISION TRACKER',
        quote:
          lang === 'vi'
            ? '“Biểu đồ theo dõi qua từng lần sửa bài giúp mình trình bày rõ ràng với cô hướng dẫn rằng Điểm Toàn vẹn Trích dẫn đã tăng từ 71% ở bản nháp đầu lên 98% ở bản nộp cuối.”'
            : '“The revision progress view showed my advisor how my Citation Integrity Score improved from 71% in Draft 1 to 98% in my final submission.”',
        author: lang === 'vi' ? 'Hoàng Nam' : 'David Alverez',
        role:
          lang === 'vi'
            ? 'Sinh viên năm cuối · Khóa luận Tốt nghiệp'
            : 'Undergraduate Honors Thesis Author',
      },
    ],
    // Column 2 (Staggered 48px lower on Desktop: `lg:pt-[48px]`)
    [
      {
        roleBadge: lang === 'vi' ? 'KHÔNG GIAN GIẢNG VIÊN' : 'TEACHER CLASSROOM',
        quote:
          lang === 'vi'
            ? '“Thay vì phải tự tay gõ từng tiêu đề vào công cụ tìm kiếm cho cả lớp 40 sinh viên làm tiểu luận, giờ đây tôi nắm ngay các nguồn trích dẫn cần xem lại trên một bảng tổng hợp duy nhất.”'
            : '“Instead of manually searching titles across 40 student essays, I can review every unverified citation across my entire class in one calm dashboard.”',
        author: lang === 'vi' ? 'PGS.TS. Trần Hải' : 'Prof. Arthur Pendelton',
        role:
          lang === 'vi'
            ? 'Giảng viên Hướng dẫn & Phản biện Luận văn'
            : 'Thesis Advisor & Faculty Reviewer',
      },
      {
        roleBadge: lang === 'vi' ? 'GIẢNG VIÊN · DUYỆT MỘT CHẠM' : 'ADVISOR SIGN-OFF',
        quote:
          lang === 'vi'
            ? '“Khi sinh viên trích dẫn giáo trình hoặc sách chuyên khảo in trong nước chưa có mã DOI quốc tế, tôi có thể xác nhận hợp lệ chỉ bằng một cú nhấp kèm ghi chú hướng dẫn.”'
            : '“When a student cites a printed domestic textbook or monograph, I can approve it with one click and attach my advisor note for the committee.”',
        author: lang === 'vi' ? 'TS. Lê Thu Hà' : 'Dr. Hannah Lindqvist',
        role:
          lang === 'vi'
            ? 'Chủ tịch Hội đồng Chấm Khóa luận Tốt nghiệp'
            : 'Senior Lecturer in Humanities & Social Sciences',
      },
      {
        roleBadge: lang === 'vi' ? 'ĐỐI CHIẾU NỘI DUNG BÀI GỐC' : 'ABSTRACT ALIGNMENT',
        quote:
          lang === 'vi'
            ? '“Tính năng đối chiếu nội dung thực sự hữu ích khi đọc phản biện: hệ thống chỉ ra ngay những chỗ bài báo được trích dẫn có thật nhưng tóm tắt bài gốc lại khác với nhận định của người viết.”'
            : '“Abstract content matching is invaluable for peer review — it highlights cases where a real paper is cited, yet its abstract says something different from the student’s claim.”',
        author: lang === 'vi' ? 'TS. Nguyễn Hoàng' : 'Dr. Liam O’Connor',
        role:
          lang === 'vi'
            ? 'Giảng viên Phương pháp Nghiên cứu Khoa học'
            : 'Research Methodology Lecturer',
      },
    ],
    // Column 3 (padding-top: 0px)
    [
      {
        roleBadge: lang === 'vi' ? 'QUẢN TRỊ KHOA & BỘ MÔN' : 'DEPARTMENT GOVERNANCE',
        quote:
          lang === 'vi'
            ? '“Bảng quản trị cấp Khoa giúp chúng tôi theo dõi trực quan hạn mức kiểm tra của từng đợt nộp khóa luận, kết nối 15+ thư viện học thuật và lưu lịch sử duyệt bài minh bạch.”'
            : '“The department dashboard gives our faculty clear visibility into cohort verification quotas, library coverage, and a complete advisor review history.”',
        author: lang === 'vi' ? 'Văn phòng Quản lý Khoa học' : 'Victor K.',
        role:
          lang === 'vi'
            ? 'Quản trị Học thuật & Đảm bảo Chất lượng'
            : 'Academic Quality & Governance Lead',
      },
      {
        roleBadge: lang === 'vi' ? 'BAO PHỦ 15+ THƯ VIỆN' : '15+ ACADEMIC LIBRARIES',
        quote:
          lang === 'vi'
            ? '“Việc kết hợp Crossref, OpenAlex, DOAJ, PubMed và OpenLibrary giúp bao phủ đồng đều tài liệu từ khối ngành Kinh tế, Luật, Nhân văn cho tới Kỹ thuật và Y sinh.”'
            : '“Combining Crossref, OpenAlex, DOAJ, PubMed, and OpenLibrary gives us broad coverage across Economics, Law, Humanities, Biomedical, and STEM faculties.”',
        author: lang === 'vi' ? 'ThS. Phạm Khôi' : 'Dr. Priya Nair',
        role:
          lang === 'vi'
            ? 'Trưởng bộ phận Thư viện Đại học'
            : 'University Library Systems Lead',
      },
      {
        roleBadge: lang === 'vi' ? 'PHẢN HỒI MANG TÍNH XÂY DỰNG' : 'CONSTRUCTIVE FEEDBACK',
        quote:
          lang === 'vi'
            ? '“Nhờ tách rõ lỗi quên ghi nguồn cuối bài với lỗi nguồn không tồn tại, phản hồi gửi tới sinh viên rất dễ hiểu, mang tính hướng dẫn thay vì gây áp lực nặng nề.”'
            : '“Separating simple formatting slips from unverified sources makes feedback constructive and reassuring for students rather than punitive.”',
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
      <div id="workspaces-student" className="scroll-mt-[88px]" aria-hidden="true" />
      <div id="workspaces-teacher" className="scroll-mt-[88px]" aria-hidden="true" />
      <div id="workspaces-admin" className="scroll-mt-[88px]" aria-hidden="true" />
      <div className="max-w-[1200px] mx-auto flex flex-col gap-[28px] sm:gap-[36px] lg:gap-[56px]">
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

        {/* Interactive 3-Role Academic Workspace Showcase */}
        <SolvaRoleWorkspacesShowcase
          lang={lang}
          activeRole={activeRole}
          onSelectRole={onSelectRole}
          isAuthenticated={isAuthenticated}
        />

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
          ? 'CITRA khác gì so với các phần mềm kiểm tra đạo văn như Turnitin?'
          : 'How is CITRA different from plagiarism checkers like Turnitin?',
      a:
        lang === 'vi'
          ? 'Các phần mềm đạo văn truyền thống chỉ kiểm tra tỷ lệ trùng lặp câu chữ. CITRA giải quyết một bài toán hoàn toàn khác: kiểm tra xem từng tài liệu tham khảo bạn trích dẫn có thực sự tồn tại trên hơn 15 thư viện học thuật hay không, thông tin tác giả – năm xuất bản – mã DOI có chính xác không, và tóm tắt bài gốc có phù hợp với ý bạn viết hay không.'
          : 'Plagiarism checkers only look for copied sentences. CITRA checks whether the references in your paper actually exist across 15+ academic libraries, whether author names, years, and DOIs are accurate, and whether each cited paper’s abstract supports your point.',
    },
    {
      id: 'faq-1',
      q:
        lang === 'vi'
          ? 'CITRA phân biệt lỗi trình bày danh mục với nguồn trích dẫn không tồn tại như thế nào?'
          : 'How does CITRA separate formatting slips from fake or missing sources?',
      a:
        lang === 'vi'
          ? 'CITRA kiểm tra tách biệt hai bước rõ ràng: Bước 1 đối chiếu nội bộ xem mọi trích dẫn trong bài đã có mặt ở Danh mục tham khảo cuối bài chưa (và ngược lại). Bước 2 tra cứu trên các thư viện học thuật để xác nhận tài liệu có thật, chỉ rõ chi tiết lệch năm/tên tạp chí, hoặc cảnh báo các nguồn không tìm thấy.'
          : 'CITRA runs two independent checks: first, it checks your manuscript internally to ensure every in-text citation links to an entry in your reference list; second, it looks up each work across 15+ libraries to separate minor year/venue typos from non-existent sources.',
    },
    {
      id: 'faq-2',
      q:
        lang === 'vi'
          ? 'Hệ thống hỗ trợ những định dạng tệp và chuẩn trích dẫn nào?'
          : 'Which file formats and citation styles does CITRA support?',
      a:
        lang === 'vi'
          ? 'Bạn có thể tải lên tệp PDF, Word (.docx), BibTeX (.bib), RIS (.ris) hoặc dán trực tiếp đoạn văn bản. Hệ thống đọc chính xác cả nhóm chuẩn đánh số như IEEE ([1]–[5]), Vancouver, ACM lẫn nhóm chuẩn Tác giả – Năm như APA 7th, Harvard, Chicago, MLA và quy định khóa luận tại Việt Nam.'
          : 'You can upload PDF, Word (.docx), BibTeX (.bib), or RIS (.ris) files, or paste references directly. CITRA supports numbered styles (IEEE [1]–[5], Vancouver, ACM) as well as author-year formats (APA 7th, Harvard, Chicago, MLA).',
    },
  ];

  const rightFaqs = [
    {
      id: 'faq-3',
      q:
        lang === 'vi'
          ? 'CITRA có tự động đánh trượt hay kết luận sinh viên vi phạm học thuật không?'
          : 'Does CITRA automatically accuse students of academic misconduct?',
      a:
        lang === 'vi'
          ? 'Tuyệt đối không. CITRA là công cụ hỗ trợ rà soát và cung cấp bằng chứng thư viện minh bạch để người viết kịp thời chỉnh sửa sai sót trước khi nộp bài; quyền đánh giá và kết luận cuối cùng luôn thuộc về giảng viên và hội đồng chuyên môn.'
          : 'Never. CITRA is strictly an academic decision-support assistant. It provides verifiable library records and clear fix suggestions so authors can correct slips early, while instructors always retain final judgment.',
    },
    {
      id: 'faq-4',
      q:
        lang === 'vi'
          ? 'Điều gì xảy ra khi tôi trích dẫn giáo trình in trong nước hoặc luận văn chưa có mã DOI?'
          : 'What happens when I cite a printed textbook or regional thesis without a DOI?',
      a:
        lang === 'vi'
          ? 'Thay vì gắn cờ nhầm là nguồn bịa đặt, CITRA lịch sự phân loại các ấn phẩm in hoặc tài liệu nội bộ chưa có trên mạng vào nhóm “Cần kiểm tra thủ công”, giúp bạn và giảng viên hướng dẫn dễ dàng đối chiếu và xác nhận hợp lệ chỉ bằng một cú nhấp.'
          : 'Rather than wrongly calling it fake, CITRA marks offline books or unindexed regional works as “Needs Manual Check,” allowing you or your advisor to review and approve them in one click.',
    },
    {
      id: 'faq-5',
      q:
        lang === 'vi'
          ? 'Mất bao lâu để kiểm tra xong một quyển khóa luận hoặc bài báo hoàn chỉnh?'
          : 'How long does it take to check a full thesis or journal paper?',
      a:
        lang === 'vi'
          ? 'Nhờ tra cứu song song cùng lúc trên hơn 15 thư viện học thuật, một bài tiểu luận hoặc khóa luận tiêu chuẩn gồm 25–40 tài liệu tham khảo thường hoàn tất toàn bộ quá trình kiểm tra chỉ trong 10 đến 25 giây.'
          : 'By checking 15+ academic libraries in parallel, a typical paper or thesis with 25–40 references finishes all four verification steps in just 10 to 25 seconds.',
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
                    className={`w-4 h-4 absolute transition-[transform,opacity] duration-250 ease-[cubic-bezier(0.22,1,0.36,1)] ${
                      isOpen
                        ? 'rotate-90 opacity-0 scale-75'
                        : 'rotate-0 opacity-100 scale-100'
                    }`}
                  />
                  <Minus
                    className={`w-4 h-4 absolute transition-[transform,opacity] duration-250 ease-[cubic-bezier(0.22,1,0.36,1)] ${
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
                    ? 'Tải lên khóa luận hoặc bài báo (.PDF, .DOCX, .BIB, .RIS) và nhận báo cáo kiểm chứng trích dẫn rõ ràng, dễ hiểu chỉ sau vài giây — tự tin trọn vẹn trước giờ nộp bài.'
                    : 'Upload your thesis or paper (.PDF, .DOCX, .BIB, .RIS) and receive a clear, actionable citation verification report in seconds — before you submit.'}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <SolvaButton
                  to={isAuthenticated ? '/upload' : '/register'}
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
                className="w-full min-h-[320px] sm:min-h-[376px] h-full p-6 sm:p-8 flex items-center justify-center"
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
function SolvaFooter({
  lang,
  onSelectWorkspaceRole,
}: {
  lang: Lang;
  onSelectWorkspaceRole: (role: WorkspaceRole) => void;
}) {
  const columns: Array<{
    header: string;
    links: Array<{
      label: string;
      href?: string;
      to?: string;
      role?: WorkspaceRole;
    }>;
  }> = [
    {
      header: lang === 'vi' ? 'Nền tảng' : 'Product',
      links: [
        { label: lang === 'vi' ? 'Cách hoạt động' : 'How It Works', href: '#how-it-works' },
        { label: lang === 'vi' ? 'Kiểm tra thử trích dẫn' : 'Live Citation Check', href: '#interactive-demo' },
        { label: lang === 'vi' ? 'Kiểm tra 2 bước rõ ràng' : 'Two-Step Citation Check', href: '#architecture' },
        { label: lang === 'vi' ? 'Độ tin cậy (120.000 bài)' : 'Proven Accuracy (120K)', href: '#benchmark-120k' },
        { label: lang === 'vi' ? 'Gói dịch vụ & Quyền lợi' : 'Pricing & Plans', href: '#pricing-plans' },
      ],
    },
    {
      header: lang === 'vi' ? 'Không gian học thuật' : 'Workspaces',
      links: [
        {
          label: lang === 'vi' ? 'Dành cho Sinh viên & Tác giả' : 'Student Workspace',
          href: '#workspaces-student',
          role: 'student',
        },
        {
          label: lang === 'vi' ? 'Dành cho Giảng viên & Hội đồng' : 'Teacher Classroom',
          href: '#workspaces-teacher',
          role: 'teacher',
        },
        {
          label: lang === 'vi' ? 'Trung tâm Quản trị' : 'Admin Control',
          href: '#workspaces-admin',
          role: 'admin',
        },
        { label: lang === 'vi' ? 'Bảng giá chi tiết' : 'Pricing Plans', to: '/pricing' },
      ],
    },
    {
      header: lang === 'vi' ? 'Điểm nổi bật' : 'Capabilities',
      links: [
        { label: lang === 'vi' ? 'Đọc chuẩn APA, IEEE, Harvard' : 'APA, IEEE & Harvard Reader', href: '#how-it-works' },
        { label: lang === 'vi' ? 'Tra cứu 15+ thư viện học thuật' : '15+ Academic Libraries', href: '#architecture' },
        { label: lang === 'vi' ? 'Đối chiếu chi tiết từng trường' : 'Side-by-Side Detail Checks', href: '#interactive-demo' },
        { label: lang === 'vi' ? 'Đối chiếu nội dung Việt ↔ Anh' : 'Bilingual Abstract Matching', href: '#how-it-works' },
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
        {/* Top Row: Brand Info (389px) + 4 Columns (779px) */}
        <div className="flex flex-col lg:flex-row items-start justify-between gap-[28px] sm:gap-[36px] lg:gap-[32px]">
          {/* Left Brand Info */}
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
                          onClick={
                            lnk.role
                              ? (e) => {
                                  e.preventDefault();
                                  if (lnk.href) {
                                    window.history.replaceState(null, '', lnk.href);
                                  }
                                  onSelectWorkspaceRole(lnk.role!);
                                }
                              : undefined
                          }
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
              ? '© 2026 CITRA — Không gian Kiểm chứng Trích dẫn Học thuật. Bảo lưu mọi quyền.'
              : '© 2026 CITRA — Academic Citation Integrity Workspace. All rights reserved.'}
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
