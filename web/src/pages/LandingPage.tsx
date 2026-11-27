import { useState, useEffect, useLayoutEffect, useContext, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AuthContext } from '@/contexts/AuthContext';
import { SYMBOLIC_RULES_COUNT } from '@/lib/productFacts';
import {
  getPlainVerdictLabel,
  getPlainMappingLabel,
} from '@/lib/verdictExplanation';
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
  Sun,
  Moon,
  Monitor,
  ArrowDown,
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
import { useTheme, type Theme } from '@/contexts/ThemeContext';
import {
  type Lang,
  clearAnchorHashJump,
  notifyAnchorHashJump,
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
  contextBeforeVi: string;
  contextAfterVi: string;
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
    title: 'match' | 'partial' | 'mismatch' | 'missing' | 'unmatched' | 'not_found';
    authors: 'match' | 'partial' | 'mismatch' | 'missing' | 'unmatched' | 'not_found';
    year: 'match' | 'partial' | 'mismatch' | 'missing' | 'unmatched' | 'not_found';
    venue: 'match' | 'partial' | 'mismatch' | 'missing' | 'unmatched' | 'not_found';
    doi: 'match' | 'partial' | 'mismatch' | 'missing' | 'unmatched' | 'not_found';
  };
  sources: Array<{
    name: string;
    nameVi?: string;
    status: 'matched' | 'partial' | 'none';
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
    detailEn: string;
    detailVi: string;
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
    contextBeforeVi:
      'Cơ chế tự chú ý đa đầu đã thay thế hiệu quả các mô hình tuần tự truyền thống trong xử lý ngôn ngữ tự nhiên, như được đề xuất ban đầu bởi ',
    contextAfterVi: ' trong kiến trúc Transformer.',
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
      { name: 'Crossref', status: 'matched', score: '100% match', scoreVi: 'Khớp 100%' },
      { name: 'Semantic Scholar', status: 'matched', score: '100% match', scoreVi: 'Khớp 100%' },
      { name: 'OpenAlex', status: 'matched', score: '99% match', scoreVi: 'Khớp 99%' },
      { name: 'arXiv', status: 'matched', score: '100% match', scoreVi: 'Khớp 100%' },
    ],
    rules: [
      {
        code: 'doi-check',
        name: 'Official DOI Link Check',
        nameVi: 'Kiểm tra mã DOI gốc',
        plainTitleEn: 'Official DOI Link Confirmed',
        plainTitleVi: 'Mã DOI trỏ đúng tới bài báo gốc',
        plainSummaryEn:
          'The DOI in your reference list opens the exact same paper title in official registries.',
        plainSummaryVi:
          'Mã DOI bạn ghi mở ra đúng bài báo có cùng tiêu đề trên hệ thống đăng ký quốc tế.',
        detailEn: 'Cited DOI matches the official registry record with 100% title agreement.',
        detailVi: 'Mã DOI trong bài khớp hoàn toàn với bản ghi gốc và trùng khớp 100% tiêu đề.',
        status: 'passed',
      },
      {
        code: 'author-check',
        name: 'Author List Check',
        nameVi: 'Kiểm tra danh sách tác giả',
        plainTitleEn: 'All Listed Authors Match',
        plainTitleVi: 'Trùng khớp danh sách tác giả',
        plainSummaryEn:
          'Every author surname in your bibliography matches the published author list.',
        plainSummaryVi:
          'Họ tên các tác giả trong danh mục của bạn khớp hoàn toàn với hồ sơ xuất bản chính thức.',
        detailEn: 'All listed author surnames match the official publication record (100% overlap).',
        detailVi: 'Tất cả họ tên tác giả trong danh mục đều trùng khớp với bài báo gốc (100%).',
        status: 'passed',
      },
      {
        code: 'abstract-check',
        name: 'Claim & Abstract Check',
        nameVi: 'Đối chiếu ý trích dẫn & tóm tắt bài gốc',
        plainTitleEn: 'Paper Abstract Supports Your Sentence',
        plainTitleVi: 'Tóm tắt bài gốc củng cố đúng ý trích dẫn',
        plainSummaryEn:
          'The cited paper’s abstract directly backs your statement about self-attention in Transformers (96% content match).',
        plainSummaryVi:
          'Nội dung tóm tắt của bài báo gốc hoàn toàn phù hợp với câu bạn viết trong bài (độ khớp nội dung 96%).',
        detailEn: 'Sentence context closely aligns with the official paper abstract (96% match).',
        detailVi: 'Câu trích dẫn trong bài phù hợp chặt chẽ với tóm tắt của công trình gốc (khớp 96%).',
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
      'Bidirectional pre-training significantly improves downstream classification accuracy ',
    contextAfter: ' across biomedical and legal document collections.',
    contextBeforeVi:
      'Phương pháp huấn luyện trước hai chiều giúp cải thiện rõ rệt độ chính xác khi phân loại văn bản chuyên ngành ',
    contextAfterVi: ' trong lĩnh vực y sinh và pháp lý.',
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
      { name: 'Crossref', status: 'matched', score: '94% match', scoreVi: 'Khớp 94%' },
      { name: 'OpenAlex', status: 'matched', score: '94% match', scoreVi: 'Khớp 94%' },
      { name: 'DBLP', status: 'matched', score: '92% match', scoreVi: 'Khớp 92%' },
      { name: 'Semantic Scholar', status: 'matched', score: '95% match', scoreVi: 'Khớp 95%' },
    ],
    rules: [
      {
        code: 'doi-check',
        name: 'Official DOI Link Check',
        nameVi: 'Kiểm tra mã DOI gốc',
        plainTitleEn: 'Real Paper Found via DOI',
        plainTitleVi: 'Tìm thấy bài báo thật qua mã DOI',
        plainSummaryEn:
          'DOI 10.18653/v1/N19-1423 is valid and points to the official BERT publication record.',
        plainSummaryVi:
          'Mã DOI 10.18653/v1/N19-1423 hợp lệ và trỏ đúng tới bản công bố chính thức của bài báo BERT.',
        detailEn: 'DOI 10.18653/v1/N19-1423 opens the verified published paper record.',
        detailVi: 'Mã DOI 10.18653/v1/N19-1423 trỏ đúng đến hồ sơ xuất bản hợp lệ của bài báo.',
        status: 'passed',
      },
      {
        code: 'year-check',
        name: 'Publication Year Check',
        nameVi: 'Kiểm tra năm xuất bản',
        plainTitleEn: 'Publication Year Off by 1 Year (2018 vs. 2019)',
        plainTitleVi: 'Lệch 1 năm xuất bản (ghi 2018 thay vì 2019)',
        plainSummaryEn:
          'Your draft cites the 2018 early online version, whereas the official conference version was published in 2019.',
        plainSummaryVi:
          'Bạn đang ghi năm bản nháp đăng sớm (2018), trong khi bài kỷ yếu chính thức được xuất bản năm 2019.',
        detailEn: 'Cited year (2018) is 1 year earlier than the official published year (2019).',
        detailVi: 'Năm ghi trong bài (2018) lệch 1 năm so với năm xuất bản chính thức (2019).',
        status: 'warning',
      },
      {
        code: 'venue-check',
        name: 'Journal / Conference Name Check',
        nameVi: 'Kiểm tra tên tạp chí / hội nghị',
        plainTitleEn: 'Wrong Conference Name Listed',
        plainTitleVi: 'Ghi nhầm tên hội nghị công bố',
        plainSummaryEn:
          'Listed as EMNLP, but the official publication venue is NAACL-HLT 2019.',
        plainSummaryVi:
          'Danh mục đang ghi hội nghị EMNLP, nhưng nơi công bố chính thức là NAACL-HLT 2019.',
        detailEn: 'Cited venue (“EMNLP”) differs from official publication venue (“NAACL-HLT 2019”).',
        detailVi: 'Nơi công bố ghi trong bài (“EMNLP”) khác với nơi xuất bản chính thức (“NAACL-HLT 2019”).',
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
      'Recent studies claim that zero-shot quantum hyper-graphs eliminate all citation errors without external verification ',
    contextAfter: '.',
    contextBeforeVi:
      'Một số bài viết gần đây cho rằng mô hình đồ thị siêu liên kết lượng tử có thể loại bỏ hoàn toàn lỗi trích dẫn mà không cần tra cứu nguồn ngoài ',
    contextAfterVi: '.',
    verdict: 'SUSPECTED_HALLUCINATION',
    verdictBadgeClass: 'verdict-badge-hallucinated',
    mappingStatus: 'MATCHED',
    mappingBadgeClass: 'mapping-badge-matched',
    confidence: 0,
    citedMeta: {
      title: 'Zero-Shot Quantum Hyper-Graphs for Autonomous Citation Verification',
      authors: 'M. Robertson, L. Walker',
      year: '2024',
      venue: 'Nature Machine Intelligence, Vol. 12',
      doi: '10.1038/s42256-024-99812-x',
    },
    retrievedMeta: null,
    fieldStatus: {
      title: 'not_found',
      authors: 'not_found',
      year: 'not_found',
      venue: 'not_found',
      doi: 'not_found',
    },
    sources: [
      { name: 'Crossref', status: 'none', score: 'No match', scoreVi: '0 khớp' },
      { name: 'OpenAlex', status: 'none', score: 'No match', scoreVi: '0 khớp' },
      { name: 'PubMed / PMC', status: 'none', score: 'No match', scoreVi: '0 khớp' },
      { name: 'Semantic Scholar', status: 'none', score: 'No match', scoreVi: '0 khớp' },
    ],
    rules: [
      {
        code: 'doi-missing',
        name: 'DOI Registry Check',
        nameVi: 'Kiểm tra mã DOI quốc tế',
        plainTitleEn: 'DOI Link Does Not Exist',
        plainTitleVi: 'Mã DOI không tồn tại trên hệ thống quốc tế',
        plainSummaryEn:
          'Looking up DOI 10.1038/s42256-024-99812-x returns no publication in official DOI registries.',
        plainSummaryVi:
          'Tra cứu mã DOI 10.1038/s42256-024-99812-x trả về kết quả không tồn tại trên toàn bộ hệ thống đăng ký DOI.',
        detailEn: 'DOI 10.1038/s42256-024-99812-x does not resolve to any registered publication.',
        detailVi: 'Mã DOI 10.1038/s42256-024-99812-x không tồn tại trên hệ thống đăng ký xuất bản quốc tế.',
        status: 'failed',
      },
      {
        code: 'title-missing',
        name: 'Cross-Library Title Check',
        nameVi: 'Tra cứu tiêu đề trên 15+ thư viện',
        plainTitleEn: 'No Matching Title Across 15+ Libraries',
        plainTitleVi: 'Không tìm thấy bài báo nào trùng tên trên 15+ thư viện',
        plainSummaryEn:
          'No article with this title or author pair appears in Crossref, OpenAlex, PubMed, or Semantic Scholar.',
        plainSummaryVi:
          'Không có công trình nào mang tiêu đề và cặp tác giả này trên Crossref, OpenAlex, PubMed hay Semantic Scholar.',
        detailEn: 'Zero publications matched this title or author pair across 15+ academic libraries.',
        detailVi: 'Không tìm thấy bài báo nào trùng tiêu đề hoặc cặp tác giả trên hơn 15 thư viện học thuật.',
        status: 'failed',
      },
      {
        code: 'pattern-check',
        name: 'Publisher Prefix Consistency Check',
        nameVi: 'Kiểm tra tính nhất quán nhà xuất bản',
        plainTitleEn: 'Typical AI-Invented Citation Pattern',
        plainTitleVi: 'Dấu hiệu điển hình của nguồn do AI tự bịa',
        plainSummaryEn:
          'Combines a real journal name (Nature Machine Intelligence) with an invented article number and title.',
        plainSummaryVi:
          'Ghép tên một tạp chí uy tín có thật (Nature Machine Intelligence) với mã số bài báo và tiêu đề không tồn tại.',
        detailEn: 'Real publisher prefix paired with an unregistered article ID and non-existent title.',
        detailVi: 'Ghép tiền tố nhà xuất bản thật với mã bài báo chưa từng được cấp và tiêu đề không có thật.',
        status: 'failed',
      },
    ],
    explanation: {
      en: 'Likely AI-invented reference: pairs a real journal name (Nature Machine Intelligence) with a non-existent DOI link and an article title not found in any academic library.',
      vi: 'Không tìm thấy nguồn gốc: mục này ghép tên tạp chí có thật (Nature Machine Intelligence) với mã DOI không tồn tại và tiêu đề bài báo không có trên bất kỳ thư viện học thuật nào.',
    },
  },
  {
    id: 'cit-4',
    marker: '[4]',
    inText: 'Smith et al. (2021)',
    page: 'p. 14',
    contextBefore:
      'Structured re-ranking improves retrieval accuracy across scanned university reports, as demonstrated by ',
    contextAfter: '.',
    contextBeforeVi:
      'Phương pháp sắp xếp lại kết quả tìm kiếm giúp cải thiện rõ rệt độ chính xác khi tra cứu tài liệu lưu trữ, như đã được trình bày trong nghiên cứu của ',
    contextAfterVi: '.',
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
      authors: 'unmatched',
      year: 'unmatched',
      venue: 'missing',
      doi: 'missing',
    },
    sources: [
      {
        name: 'Reference List Check',
        nameVi: 'Đối chiếu Danh mục cuối bài',
        status: 'none',
        score: 'Not listed',
        scoreVi: 'Chưa liệt kê',
      },
      {
        name: 'In-Text Citation Scan',
        nameVi: 'Kiểm tra Trích dẫn trong bài',
        status: 'none',
        score: 'Cited on p. 14',
        scoreVi: 'Có ở trang 14',
      },
    ],
    rules: [
      {
        code: 'missing-bib',
        name: 'In-Text to Reference List Check',
        nameVi: 'Đối chiếu trích dẫn trong bài & cuối bài',
        plainTitleEn: 'Cited in Body Text, Missing at the End',
        plainTitleVi: 'Có trích dẫn trong bài nhưng quên ghi ở cuối bài',
        plainSummaryEn:
          'You cited “Smith et al. (2021)” on page 14, but there is no matching Smith (2021) entry in your final reference list.',
        plainSummaryVi:
          'Bạn đã trích dẫn “Smith et al. (2021)” ở trang 14, nhưng chưa thêm mục tài liệu Smith (2021) vào Danh mục tham khảo cuối bài.',
        detailEn: '“Smith et al. (2021)” appears on page 14 with no matching entry in your References section.',
        detailVi: '“Smith et al. (2021)” xuất hiện ở trang 14 nhưng chưa có mục tương ứng trong Danh mục tài liệu tham khảo.',
        status: 'failed',
      },
      {
        code: 'lookup-deferred',
        name: 'Library Verification Status',
        nameVi: 'Trạng thái tra cứu thư viện',
        plainTitleEn: 'Library Lookup Paused Until Reference Is Added',
        plainTitleVi: 'Chờ bổ sung tên bài báo để tra cứu thư viện',
        plainSummaryEn:
          'Once you add the full title and journal to your bibliography, CITRA will automatically verify whether the source is real.',
        plainSummaryVi:
          'Sau khi bạn bổ sung đầy đủ tên bài báo vào danh mục cuối bài, CITRA sẽ tự động tra cứu xác minh trên 15+ thư viện.',
        detailEn: 'Full publication details are needed in the reference list before online libraries can be searched.',
        detailVi: 'Cần bổ sung đầy đủ tiêu đề và nguồn công bố ở cuối bài để hệ thống tiến hành đối chiếu thư viện.',
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

  useLayoutEffect(() => {
    if (!location.hash && (typeof window === 'undefined' || !window.location.hash)) {
      clearAnchorHashJump();
    }
  }, [location.key, location.hash]);

  useEffect(() => () => clearAnchorHashJump(), []);

  useEffect(() => {
    const matchedRole = parseWorkspaceRoleFromUrl(location.search, location.hash);
    if (matchedRole) {
      setActiveWorkspaceRole(matchedRole);
    }
    if (location.hash) {
      notifyAnchorHashJump(location.hash);
      const rawId = location.hash.slice(1);
      const targetId = rawId.startsWith('workspaces-') ? 'workspaces' : rawId;
      const targetEl = document.getElementById(targetId);
      if (targetEl && typeof targetEl.scrollIntoView === 'function') {
        targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    } else if (typeof window === 'undefined' || !window.location.hash) {
      clearAnchorHashJump();
    }
  }, [location.key, location.search, location.hash]);

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
      <a
        href="#main-content"
        data-testid="landing-skip-to-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[100] focus:px-4 focus:py-2.5 focus:rounded-[10px] focus:bg-[#1C1A15] focus:text-[#FBFAF6] dark:focus:bg-[#FBFAF6] dark:focus:text-[#1C1A15] focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 font-solva-sans text-sm font-medium"
      >
        {lang === 'vi' ? 'Chuyển tới nội dung chính' : 'Skip to main content'}
      </a>
      <SolvaHeader
        lang={lang}
        onToggleLanguage={toggleLanguage}
        isAuthenticated={isAuthenticated}
      />
      <main id="main-content" tabIndex={-1} className="focus:outline-none">
        <SolvaHeroSection lang={lang} isAuthenticated={isAuthenticated} />
        <SolvaFilmSection lang={lang} />
        <SolvaFeaturesSection lang={lang} />
        <SolvaStickySection lang={lang} isAuthenticated={isAuthenticated} />
        <SolvaInteractiveDebuggerSection lang={lang} isAuthenticated={isAuthenticated} />
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

function SolvaThemeToggle({ lang }: { lang: Lang }) {
  const { theme, setTheme } = useTheme();

  const themeLabels: Record<Theme, { en: string; vi: string }> = {
    light: { en: 'Light', vi: 'Sáng' },
    dark: { en: 'Dark', vi: 'Tối' },
    system: { en: 'System', vi: 'Theo hệ thống' },
  };

  const currentLabel = lang === 'vi' ? themeLabels[theme].vi : themeLabels[theme].en;
  const titleText = lang === 'vi' ? `Giao diện: ${currentLabel}` : `Theme: ${currentLabel}`;
  const ariaLabelText =
    lang === 'vi'
      ? `Giao diện hiện tại: ${currentLabel}. Nhấn để chuyển đổi.`
      : `Current theme: ${currentLabel}. Click to change.`;

  const themeIcons: Record<Theme, React.ReactNode> = {
    light: <Sun className="w-4 h-4 text-amber-500" />,
    dark: <Moon className="w-4 h-4 text-indigo-400" />,
    system: <Monitor className="w-4 h-4 text-slate-500 dark:text-slate-300" />,
  };

  return (
    <button
      type="button"
      onClick={() => {
        const nextTheme: Record<Theme, Theme> = {
          light: 'dark',
          dark: 'system',
          system: 'light',
        };
        setTheme(nextTheme[theme]);
      }}
      className="inline-flex items-center justify-center p-1.5 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100 transition-colors duration-200 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1C1A15] dark:focus-visible:ring-[#FBFAF6]"
      title={titleText}
      aria-label={ariaLabelText}
    >
      <span className="inline-grid place-items-center">
        {(['light', 'dark', 'system'] as const).map((mode) => {
          const isCurrent = theme === mode;
          return (
            <span
              key={mode}
              aria-hidden={!isCurrent}
              style={{
                gridArea: '1 / 1',
                opacity: isCurrent ? 1 : 0,
                filter: isCurrent ? 'blur(0px)' : 'blur(var(--icon-swap-blur, 2px))',
                transform: isCurrent ? 'scale(1)' : 'scale(var(--icon-swap-start-scale, 0.25))',
                transition:
                  'opacity var(--icon-swap-dur, 250ms) var(--icon-swap-ease, ease-in-out), filter var(--icon-swap-dur, 250ms) var(--icon-swap-ease, ease-in-out), transform var(--icon-swap-dur, 250ms) var(--icon-swap-ease, ease-in-out)',
              }}
              className="inline-flex items-center justify-center"
            >
              {themeIcons[mode]}
            </span>
          );
        })}
      </span>
    </button>
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
            desc: 'Chính xác 99,67% trên 120.000 bài báo',
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
            desc: '99.67% accuracy across 120,000 papers',
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
      <div className="max-w-[1280px] mx-auto px-5 sm:px-6 lg:px-5 xl:px-[40px] h-[64px] lg:h-[76px] flex items-center justify-between flex-nowrap gap-2 xl:gap-4">
        {/* Left: Brand Logo */}
        <div className="flex items-center shrink-0">
          <Link
            to="/"
            onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
            className="inline-flex items-center gap-[8px] rounded-[6px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1C1A15] dark:focus-visible:ring-[#FBFAF6] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--solva-bg)]"
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

        {/* Center: Solva Navigation Links + Dropdown (Single-row from lg:1024px upward, matching /pricing) */}
        <nav
          aria-label="Primary Navigation"
          className="hidden lg:flex items-center justify-center flex-1 min-w-0 flex-nowrap gap-0.5 xl:gap-1"
        >
          {/* Dropdown Trigger (`Platform v` / `Nền tảng v`) */}
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
              className="inline-flex items-center gap-[4px] h-[44px] px-1.5 xl:px-[10px] rounded-[8px] font-solva-sans text-[12.5px] xl:text-[15px] font-normal whitespace-nowrap hover:opacity-80 transition-opacity cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1C1A15] dark:focus-visible:ring-[#FBFAF6]"
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
            className="inline-flex items-center h-[44px] px-1.5 xl:px-[10px] rounded-[8px] font-solva-sans text-[12.5px] xl:text-[15px] font-normal whitespace-nowrap shrink-0 hover:opacity-80 transition-opacity"
          >
            {lang === 'vi' ? 'Cách hoạt động' : 'How It Works'}
          </a>

          <a
            href="#interactive-demo"
            style={{ color: 'var(--solva-muted)' }}
            className="inline-flex items-center h-[44px] px-1.5 xl:px-[10px] rounded-[8px] font-solva-sans text-[12.5px] xl:text-[15px] font-normal whitespace-nowrap shrink-0 hover:opacity-80 transition-opacity"
          >
            {lang === 'vi' ? 'Kiểm tra thử' : 'Live Check'}
          </a>

          <a
            href="#workspaces"
            style={{ color: 'var(--solva-muted)' }}
            className="inline-flex items-center h-[44px] px-1.5 xl:px-[10px] rounded-[8px] font-solva-sans text-[12.5px] xl:text-[15px] font-normal whitespace-nowrap shrink-0 hover:opacity-80 transition-opacity"
          >
            {lang === 'vi' ? 'Dành cho ai' : 'For Whom'}
          </a>

          <a
            href="#benchmark-120k"
            style={{ color: 'var(--solva-muted)' }}
            className="inline-flex items-center gap-1.5 h-[44px] px-1.5 xl:px-[10px] rounded-[8px] font-solva-sans text-[12.5px] xl:text-[15px] font-normal whitespace-nowrap shrink-0 hover:opacity-80 transition-opacity"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse shrink-0" />
            <span>{lang === 'vi' ? 'Độ tin cậy' : 'Accuracy'}</span>
          </a>

          <Link
            to="/pricing"
            data-testid="landing-pricing-link"
            style={{ color: 'var(--solva-muted)' }}
            className="inline-flex items-center h-[44px] px-1.5 xl:px-[10px] rounded-[8px] font-solva-sans text-[12.5px] xl:text-[15px] font-normal whitespace-nowrap shrink-0 hover:opacity-80 transition-opacity"
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
            className="inline-flex items-center gap-1 h-[36px] px-2.5 rounded-[8px] font-mono text-[12px] font-medium hover:opacity-85 transition-opacity cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1C1A15] dark:focus-visible:ring-[#FBFAF6]"
            title={lang === 'vi' ? 'Switch to English' : 'Chuyển sang Tiếng Việt'}
          >
            <Globe className="w-3.5 h-3.5" />
            <span>{lang === 'vi' ? 'VI' : 'EN'}</span>
          </button>

          <SolvaThemeToggle lang={lang} />

          <Link
            to={isAuthenticated ? '/dashboard' : '/login'}
            style={{ color: 'var(--solva-muted)' }}
            className="hidden sm:inline-flex items-center h-[44px] px-2 xl:px-[12px] rounded-[8px] font-solva-sans text-[13px] xl:text-[15px] font-normal whitespace-nowrap hover:opacity-80 transition-opacity"
          >
            {lang === 'vi' ? 'Đăng nhập' : 'Sign in'}
          </Link>

          <SolvaButton
            to={isAuthenticated ? '/dashboard' : '/register'}
            variant="primary"
            className="hidden sm:inline-flex lg:px-3 xl:px-[16px] lg:text-[13px] xl:text-[14px]"
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
            ref={mobileToggleRef}
            type="button"
            onClick={() => setMobileMenuOpen((prev) => !prev)}
            aria-label="Toggle navigation menu"
            aria-expanded={mobileMenuOpen}
            style={{
              backgroundColor: 'var(--solva-surface)',
              color: 'var(--solva-ink)',
            }}
            className="lg:hidden inline-flex items-center justify-center w-[40px] h-[40px] rounded-[8px] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1C1A15] dark:focus-visible:ring-[#FBFAF6]"
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
          className={`lg:hidden border-t border-b px-5 py-4 space-y-2 shadow-lg t-mobile-drawer ${
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

          <div className="pt-2 grid grid-cols-1 gap-2 sm:hidden">
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
      className="pt-[76px] sm:pt-[88px] lg:pt-[136px] pb-[24px] sm:pb-[36px] lg:pb-[64px] px-5 sm:px-6 lg:px-6 xl:px-[40px]"
    >
      <div className="max-w-[1200px] mx-auto flex flex-col gap-[28px] sm:gap-[36px] lg:gap-[56px]">
        {/* Top 2-Column Content */}
        <div className="flex flex-col lg:flex-row items-center justify-between gap-[28px] sm:gap-[32px] lg:gap-[24px] pt-0 lg:pt-[12px]">
          {/* Left Column (520px on XL Desktop, wider 48% at 1024px so H1 never squeezes 1-word-per-line) */}
          <div className="w-full lg:w-[48%] xl:w-[520px] min-w-0 flex flex-col items-start gap-[22px] sm:gap-[28px] lg:gap-[32px] lg:pb-[24px]">
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
                        Kiểm định trên 120.000 bài báo · Chính xác 99,67% khi rà soát{' '}
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
                        Tested on 120,000 papers · 99.67% accuracy catching citation{' '}
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
              {lang === 'vi' ? (
                <SolvaScrollReveal delayMs={85} yOffset={24} blurPx={3.5}>
                  <h1 className="font-solva-serif font-light text-[36px] sm:text-[44px] lg:text-[44px] xl:text-[56px] leading-[1.15] tracking-[-0.03em] text-balance">
                    <span className="block" style={{ color: 'var(--solva-ink)' }}>
                      Kiểm chứng mọi{' '}
                      <span className="whitespace-nowrap">trích dẫn</span>
                    </span>{' '}
                    <span className="block" style={{ color: 'var(--solva-muted)' }}>
                      trước khi nộp{' '}
                      <span className="whitespace-nowrap">khóa luận</span> &amp; bài báo.
                    </span>
                  </h1>
                </SolvaScrollReveal>
              ) : (
                <SolvaTwoToneHeading
                  as="h1"
                  size="h1"
                  delayMs={85}
                  primary="Submit your thesis or paper"
                  secondary="with every citation verified."
                />
              )}

              {/* Subtitle (400px–450px max-width, Onest 18px Regular) */}
              <SolvaScrollReveal delayMs={190} yOffset={24} blurPx={3.5}>
                <p
                  style={{ color: 'var(--solva-muted)' }}
                  className="font-solva-sans text-[17px] sm:text-[18px] font-normal leading-[25.5px] max-w-[460px]"
                >
                  {lang === 'vi'
                    ? 'Tải lên bài viết PDF, Word (.docx) hoặc file thư mục Zotero/Mendeley. CITRA tự động đối chiếu trích dẫn trong bài với danh mục cuối bài, xác nhận từng tài liệu có thật trên hơn 15 thư viện học thuật và chỉ rõ năm xuất bản sai hay nguồn do AI tự bịa trước khi bạn nộp bài.'
                    : 'Upload your PDF, Word (.docx), or Zotero/Mendeley file. CITRA checks that every in-text citation matches your reference list, confirms each source is real across 15+ academic libraries, and highlights wrong years or AI-invented references before submission.'}
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
                      ? 'Kiểm tra bài viết mới'
                      : 'Check a Paper'
                    : lang === 'vi'
                      ? 'Trải nghiệm CITRA miễn phí'
                      : 'Try CITRA Free'}
                </SolvaButton>
                <SolvaButton href="#interactive-demo" variant="outline">
                  {lang === 'vi' ? 'Xem kiểm tra mẫu' : 'See Live Check'}
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
                className="t-learn group block w-full rounded-[12px] border p-3 sm:p-3.5 transition-[border-color,background-color,transform,opacity] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] hover:border-[#1C1A15]/40 dark:hover:border-[#FBFAF6]/30"
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
                      {lang === 'vi' ? '99,67%' : '99.67%'}
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
                      {lang === 'vi' ? '99,96%' : '99.96%'}
                    </div>
                    <div
                      style={{ color: 'var(--solva-muted)' }}
                      className="font-mono text-[10px] leading-snug mt-1"
                    >
                      {lang === 'vi' ? (
                        <>2.400 trích dẫn khó</>
                      ) : (
                        <>2,400 tricky cases</>
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

          {/* Right Column: Painterly Mockup Frame (`656px` on XL Desktop, fully framed with zero overhang or bottom clipping) */}
          <div className="w-full lg:w-[52%] xl:w-[656px] min-w-0">
            <SolvaPainterlyFrame
              paintingSrc="/solva/hero-bg.webp"
              priority
              alt="Impressionist wildflower meadow oil painting backdrop"
              className="w-full min-h-[440px] sm:min-h-[520px] lg:min-h-[540px] py-5 px-3.5 sm:py-7 sm:px-6 lg:p-5 xl:p-7 flex items-center justify-center"
            >
              <div className="w-full my-auto">
                <UIGenerationReveal
                  className="rounded-[10px] [&_.t-gen-tag]:top-auto [&_.t-gen-tag]:bottom-2 sm:[&_.t-gen-tag]:top-2 sm:[&_.t-gen-tag]:bottom-auto"
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
                    className="group inline-flex items-center gap-2.5 px-2.5 py-2 -mx-2.5 -my-1.5 rounded-[8px] shrink-0 select-none cursor-pointer opacity-80 hover:opacity-100 active:opacity-100 focus-visible:opacity-100 hover:-translate-y-[1px] active:scale-[0.98] transition-[transform,opacity,background-color,color] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1C1A15]/30 dark:focus-visible:ring-[#FBFAF6]/30"
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
  const fmtPct = (pct: number) =>
    lang === 'vi' ? `${pct.toFixed(2).replace('.', ',')}%` : `${pct.toFixed(2)}%`;

  const plainPillars = [
    {
      badge:
        lang === 'vi'
          ? 'NGUỒN THẬT & TRÍCH DẪN THỰC TẾ'
          : 'REAL & TESTED CITATIONS',
      badgeTone: 'neutral' as const,
      displayValue: lang === 'vi' ? '120.000' : '120,000',
      title:
        lang === 'vi'
          ? 'Đánh giá độc lập trên 120.000+ trích dẫn học thuật đa lĩnh vực'
          : 'Independently evaluated on 120,000+ academic citations',
      desc:
        lang === 'vi'
          ? 'Thử nghiệm trên hàng trăm nghìn bài báo tạp chí, kỷ yếu, sách chuyên khảo cùng các lỗi sai quy cách thường gặp trong bài làm thực tế của sinh viên và học viên.'
          : 'Tested across real journal articles, conference papers, books, and realistic citation slips so CITRA handles everyday papers reliably.',
    },
    {
      badge: lang === 'vi' ? 'ĐỘ TIN CẬY VƯỢT TRỘI' : 'HIGH RELIABILITY',
      badgeTone: 'emerald' as const,
      displayValue: lang === 'vi' ? '99,67%' : '99.67%',
      title:
        lang === 'vi'
          ? 'Chính xác khi phát hiện nguồn ảo & sai lệch'
          : 'Accuracy catching fake or mismatched sources',
      desc:
        lang === 'vi'
          ? 'Nhận diện chuẩn xác tài liệu do AI tự bịa, đường dẫn DOI không tồn tại và năm xuất bản sai — đạt 99,96% khi kiểm thử riêng trên 2.400 trích dẫn khó chưa từng gặp.'
          : 'Spots AI-invented references, broken DOIs, and wrong publication years — maintaining 99.96% accuracy on 2,400 unseen tricky citations.',
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
      badge:
        lang === 'vi'
          ? 'KIỂM THỬ TÁCH BIỆT HOÀN TOÀN'
          : 'STRICTLY INDEPENDENT TEST SET',
      badgeTone: 'neutral' as const,
      displayValue: lang === 'vi' ? '120.000' : '120,000',
      title:
        lang === 'vi'
          ? 'Trích dẫn học thuật được đánh giá độc lập'
          : 'Academic citations evaluated independently',
      desc:
        lang === 'vi'
          ? 'Trích từ kho học thuật 128.000+ bài báo và tách riêng hoàn toàn giữa nhóm xây dựng (84.000), tinh chỉnh (18.000) và kiểm thử cuối cùng (18.000) — không trùng lặp bất kỳ bài báo hay tiêu đề nào.'
          : 'Sampled from 128,000+ scholarly works and split cleanly into development (84,000), tuning (18,000), and final unseen testing (18,000) with zero overlap in papers or titles.',
    },
    {
      badge:
        lang === 'vi'
          ? 'DẪN ĐẦU TRÊN BỘ THƯỜNG & BỘ KHÓ'
          : 'TOP ACCURACY ON STANDARD & TRICKY CASES',
      badgeTone: 'emerald' as const,
      displayValue: lang === 'vi' ? '99,67%' : '99.67%',
      title:
        lang === 'vi'
          ? 'Độ chính xác chung (99,96% trên 2.400 trích dẫn khó)'
          : 'Overall accuracy (99.96% across 2,400 unseen tricky cases)',
      desc:
        lang === 'vi'
          ? 'Đạt độ chính xác 99,67% (17.941 / 18.000 bài kiểm thử), vượt xa các công cụ chỉ dựa vào AI thuần túy — vốn chỉ còn 57,33% khi gặp 2.400 trích dẫn khó chưa từng thấy.'
          : 'Reaches 99.67% accuracy (17,941 / 18,000 unseen test citations), staying at 99.96% on 2,400 novel edge cases where pure-AI classifiers drop to 57.33%.',
    },
    {
      badge: lang === 'vi' ? '0% BÁO NHẦM BÀI THẬT' : '0% FALSE FLAGS ON REAL WORK',
      badgeTone: 'emerald' as const,
      displayValue: lang === 'vi' ? '99,93%' : '99.93%',
      title:
        lang === 'vi'
          ? 'Độ chính xác khi phát hiện nguồn không có thật'
          : 'Precision catching non-existent sources',
      desc:
        lang === 'vi'
          ? 'Phát hiện 5.398 / 5.400 trích dẫn chắp vá tinh vi mà không báo nhầm bất kỳ tài liệu thật nào (0 / 6.480 bài đã xác minh) và không bỏ lọt nguồn ảo vào danh sách hợp lệ.'
          : 'Catches 5,398 / 5,400 plausible fabricated references with zero legitimate papers falsely flagged (0 / 6,480) and zero fake citations marked as Verified.',
    },
    {
      badge: lang === 'vi' ? 'KIỂM CHỨNG THỰC TẾ' : 'END-TO-END CHECKED',
      badgeTone: 'amber' as const,
      displayValue: '120 / 120',
      title:
        lang === 'vi'
          ? 'Chính xác tuyệt đối trên 120 bài mẫu thực tế'
          : 'Perfect score across 120 real end-to-end papers',
      desc:
        lang === 'vi'
          ? 'Mức độ khớp nguồn được hiệu chỉnh để sát với thực tế hơn 6 lần, đạt độ chính xác 99,73% trên nhóm kết quả rõ ràng và 100% (120 / 120) trên bộ bài mẫu đầy đủ.'
          : 'Match confidence scores are calibrated to be 6× more faithful to real-world outcomes, achieving 99.73% accuracy on clear verdicts and 100% (120 / 120) on complete sample papers.',
    },
  ];

  const ablationBaselines = [
    {
      code: lang === 'vi' ? 'Cách 1' : 'Method 1',
      name:
        lang === 'vi'
          ? 'Chỉ kiểm tra mã DOI'
          : 'DOI-link check only',
      note:
        lang === 'vi'
          ? 'Bỏ sót toàn bộ bài báo hội nghị và sách chuyên khảo không có mã DOI'
          : 'Misses valid conference papers & books that do not have DOIs',
      acc: 26.24,
      prec: '23,4%',
      precEn: '23.4%',
      rec: '34,9%',
      recEn: '34.9%',
      highlight: false,
    },
    {
      code: lang === 'vi' ? 'Cách 2' : 'Method 2',
      name:
        lang === 'vi'
          ? 'Chỉ tra cứu 1 thư viện (Crossref)'
          : 'Single library lookup (Crossref only)',
      note:
        lang === 'vi'
          ? 'Thiếu sách in, tạp chí y sinh, kho bài mở và kỷ yếu nhiều ngành khác'
          : 'Misses books, biomedical journals, open archives & regional proceedings',
      acc: 58.31,
      prec: '56,6%',
      precEn: '56.6%',
      rec: '48,1%',
      recEn: '48.1%',
      highlight: false,
    },
    {
      code: lang === 'vi' ? 'Cách 3' : 'Method 3',
      name:
        lang === 'vi'
          ? 'Chỉ đo độ giống tiêu đề bằng AI'
          : 'AI title similarity only',
      note:
        lang === 'vi'
          ? 'Dễ bị đánh lừa bởi tiêu đề AI ghép từ khóa cùng ngành và bỏ qua sai năm / tác giả'
          : 'Fooled by plausible AI-blended titles and overlooks wrong years or authors',
      acc: 66.93,
      prec: '49,4%',
      precEn: '49.4%',
      rec: '52,1%',
      recEn: '52.1%',
      highlight: false,
    },
    {
      code: lang === 'vi' ? 'Cách 4' : 'Method 4',
      name:
        lang === 'vi'
          ? 'Chấm điểm nhiều trường (không có nhóm chờ duyệt)'
          : 'Multi-field score without manual-review band',
      note:
        lang === 'vi'
          ? 'Ép kết luận cứng ở các ca thiếu thông tin thay vì chuyển giảng viên kiểm tra'
          : 'Forces hard verdicts on incomplete entries instead of routing them for review',
      acc: 80.53,
      prec: '62,4%',
      precEn: '62.4%',
      rec: '66,5%',
      recEn: '66.5%',
      highlight: false,
    },
    {
      code: lang === 'vi' ? 'Cách 5' : 'Method 5',
      name:
        lang === 'vi'
          ? 'Chỉ so khớp văn bản tiêu đề & họ tên tác giả'
          : 'Text-only title & author matching',
      note:
        lang === 'vi'
          ? 'Không kiểm tra xem tóm tắt bài báo gốc có khớp câu trích dẫn hay đường dẫn còn mở được không'
          : 'Does not check whether source abstracts match the cited claim or whether links work',
      acc: 82.84,
      prec: '64,0%',
      precEn: '64.0%',
      rec: '69,1%',
      recEn: '69.1%',
      highlight: false,
    },
    {
      code: lang === 'vi' ? 'Cách 6' : 'Method 6',
      name:
        lang === 'vi'
          ? 'Mô hình AI thuần túy (không có kiểm chứng thư viện)'
          : 'Pure AI classifier (no library verification rules)',
      note:
        lang === 'vi'
          ? 'Tụt mạnh xuống 57,33% trên 2.400 trích dẫn khó như bài báo đã bị rút, liên kết giả hay văn bản luật VN'
          : 'Drops to 57.33% on 2,400 unseen edge cases like retracted articles, fake links & legal citations',
      acc: 97.70,
      prec: '97,6%',
      precEn: '97.6%',
      rec: '97,7%',
      recEn: '97.7%',
      highlight: false,
    },
    {
      code: 'CITRA (#1)',
      name:
        lang === 'vi'
          ? `CITRA (15+ Thư viện + ${SYMBOLIC_RULES_COUNT}+ Tiêu chí đối chiếu + Kiểm tra ngữ cảnh)`
          : `CITRA (15+ Libraries + ${SYMBOLIC_RULES_COUNT}+ Verification Checks + Context Match)`,
      note:
        lang === 'vi'
          ? 'Đạt 99,67% trên 18.000 mẫu kiểm thử & 99,96% trên 2.400 trích dẫn khó chưa từng gặp'
          : '99.67% on 18,000 unseen test citations & 99.96% on 2,400 novel edge cases',
      acc: 99.67,
      prec: '99,7%',
      precEn: '99.7%',
      rec: '99,6%',
      recEn: '99.6%',
      highlight: true,
    },
  ];

  const classPerformance = [
    {
      label: lang === 'vi' ? 'Đã xác minh' : 'Verified',
      subtypes: lang === 'vi' ? '4 dạng hợp lệ' : '4 valid cases',
      totalSamples: lang === 'vi' ? '43.200 (36%)' : '43,200 (36%)',
      testSupport: lang === 'vi' ? '6.480' : '6,480',
      precision: lang === 'vi' ? '99,4%' : '99.4%',
      recall: lang === 'vi' ? '99,9%' : '99.9%',
      f1: lang === 'vi' ? '99,7%' : '99.7%',
      tone: 'emerald' as const,
      desc:
        lang === 'vi'
          ? 'Bao gồm bài khớp hoàn toàn, rút gọn et al., lệch ±1 năm giữa bản nháp đăng sớm và bản chính thức, rút gọn tiêu đề phụ hoặc lỗi chính tả nhẹ khi quét PDF. 0 / 6.480 bài thật bị báo nhầm là nguồn ảo.'
          : 'Covers exact matches, et al. abbreviations, ±1 year early-draft differences, shortened subtitles, and minor PDF scan typos. Zero legitimate papers (0 / 6,480) were wrongly flagged.',
    },
    {
      label: lang === 'vi' ? 'Không tìm thấy nguồn' : 'Source Not Found',
      subtypes: lang === 'vi' ? '4 dạng nguồn ảo' : '4 non-existent cases',
      totalSamples: lang === 'vi' ? '36.000 (30%)' : '36,000 (30%)',
      testSupport: lang === 'vi' ? '5.400' : '5,400',
      precision: lang === 'vi' ? '99,9%' : '99.9%',
      recall: lang === 'vi' ? '100,0%' : '100.0%',
      f1: lang === 'vi' ? '99,9%' : '99.9%',
      tone: 'red' as const,
      desc:
        lang === 'vi'
          ? 'Gồm tài liệu do AI tự tạo hoàn toàn, tiêu đề ghép từ khóa cùng ngành với tên tác giả thật, mã DOI không tồn tại hoặc liên kết hỏng. Phát hiện 5.398 / 5.400 trường hợp mà không báo oan bài thật.'
          : 'Catches fully invented references, blended titles paired with real scholars, unregistered DOIs, and dead links — spotting 5,398 / 5,400 cases with zero false accusations on real papers.',
    },
    {
      label: lang === 'vi' ? 'Sai lệch thông tin' : 'Details Mismatch',
      subtypes: lang === 'vi' ? '5 dạng sai lệch' : '5 mismatch types',
      totalSamples: lang === 'vi' ? '26.400 (22%)' : '26,400 (22%)',
      testSupport: lang === 'vi' ? '3.960' : '3,960',
      precision: lang === 'vi' ? '99,9%' : '99.9%',
      recall: lang === 'vi' ? '98,7%' : '98.7%',
      f1: lang === 'vi' ? '99,3%' : '99.3%',
      tone: 'amber' as const,
      desc:
        lang === 'vi'
          ? 'Tài liệu có thật nhưng ghi sai năm xuất bản từ 2 năm trở lên, nhầm đồng tác giả, đúng DOI nhưng sai tiêu đề, trích dẫn sai ý so với bài gốc hoặc bài báo đã bị tạp chí thu hồi.'
          : 'Real publications cited with the wrong year (2+ years off), swapped co-authors, corrupted titles, claims unsupported by the source abstract, or articles that have been retracted.',
    },
    {
      label: lang === 'vi' ? 'Chưa đủ dữ liệu' : 'Unverified',
      subtypes: lang === 'vi' ? '2 dạng cần xem lại' : '2 review cases',
      totalSamples: lang === 'vi' ? '14.400 (12%)' : '14,400 (12%)',
      testSupport: lang === 'vi' ? '2.160' : '2,160',
      precision: lang === 'vi' ? '99,4%' : '99.4%',
      recall: lang === 'vi' ? '100,0%' : '100.0%',
      f1: lang === 'vi' ? '99,7%' : '99.7%',
      tone: 'slate' as const,
      desc:
        lang === 'vi'
          ? 'Các sách in, giáo trình nội bộ hoặc nguồn thiếu thông tin khiến hệ thống chưa đủ căn cứ đối chiếu trực tuyến — CITRA chủ động không kết luận vội mà chuyển sang cho bạn và giảng viên xác nhận.'
          : 'Print books, local theses, or incomplete entries without enough online data to confirm automatically — CITRA politely avoids guessing and flags them for you or your advisor to check.',
    },
  ];

  return (
    <section
      id="benchmark-120k"
      data-testid="benchmark-120k-section"
      className="scroll-mt-[84px] lg:scroll-mt-[108px] py-[36px] sm:py-[52px] lg:py-[96px] px-5 sm:px-6 lg:px-[40px]"
    >
      <div className="max-w-[1200px] mx-auto flex flex-col gap-[28px] sm:gap-[36px] lg:gap-[44px]">
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
            className="w-full sm:w-auto min-h-[44px] px-4 sm:px-5 py-2.5 rounded-[10px] border font-solva-sans text-[14px] font-medium inline-flex items-center justify-between sm:justify-center gap-2.5 hover:opacity-90 active:scale-[0.99] transition-[transform,opacity,background-color,border-color,color] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] cursor-pointer"
          >
            <span>
              {showTechnicalDetails
                ? lang === 'vi'
                  ? 'Ẩn chi tiết kết quả kiểm thử độc lập'
                  : 'Hide Independent Evaluation Breakdown'
                : lang === 'vi'
                  ? 'Xem chi tiết cách CITRA được kiểm thử độc lập'
                  : 'View How CITRA Was Independently Tested'}
            </span>
            <SymmetricChevron open={showTechnicalDetails} size={15} />
          </button>
        </div>

        <div
          id="benchmark-technical-details-panel"
          hidden={!showTechnicalDetails}
        >
          {showTechnicalDetails && (
            <div className="space-y-[24px] animate-debugger-switch">
            {/* 4 Plain-Language Credibility Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-[16px]">
              {headlineMetrics.map((item) => (
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
                      className="font-solva-serif font-light text-[36px] sm:text-[42px] leading-[1.08] tracking-[-0.05em] tabular-nums"
                    >
                      {item.displayValue}
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

            {/* Interactive 3-View Evaluation Explorer */}
            <div
              style={{ backgroundColor: 'var(--solva-surface)' }}
              className="w-full rounded-[16px] p-[8px] sm:p-[12px] space-y-3"
            >
            {/* Top Bar: 3 Views + Dataset Split Summary */}
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 px-1 sm:px-2 pt-1">
              <div
                ref={benchTabsRef}
                role="tablist"
                aria-label={
                  lang === 'vi'
                    ? 'Các bảng kết quả kiểm thử trên 120.000 bài báo'
                    : '120,000-paper evaluation views'
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
                    className="t-tabs-pill rounded-[10px] border border-[#E7E3D9] dark:border-[#3F3A2F] shadow-sm"
                  />
                )}
                {[
                  {
                    id: 'ablation' as const,
                    label:
                      lang === 'vi'
                        ? '1. So sánh phương pháp kiểm tra'
                        : '1. Comparing Approaches',
                  },
                  {
                    id: 'classes' as const,
                    label:
                      lang === 'vi'
                        ? '2. Độ chính xác 4 trạng thái'
                        : '2. All 4 Verdict Types',
                  },
                  {
                    id: 'calibration' as const,
                    label:
                      lang === 'vi'
                        ? '3. Độ tin cậy & Ổn định điểm số'
                        : '3. Score Reliability',
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
                  {lang === 'vi' ? 'Xây dựng:' : 'Development:'}{' '}
                  <strong>{lang === 'vi' ? '84.000' : '84,000'}</strong> (70%)
                </span>
                <span
                  style={{
                    backgroundColor: 'var(--solva-bg)',
                    color: 'var(--solva-ink)',
                  }}
                  className="px-2.5 py-1 rounded-[6px] border border-[#E7E3D9] dark:border-[#332F26]"
                >
                  {lang === 'vi' ? 'Tinh chỉnh:' : 'Tuning:'}{' '}
                  <strong>{lang === 'vi' ? '18.000' : '18,000'}</strong> (15%)
                </span>
                <span className="px-2.5 py-1 rounded-[6px] bg-emerald-500/[0.12] text-emerald-700 dark:text-emerald-300 font-semibold">
                  {lang === 'vi'
                    ? 'Kiểm thử độc lập: 18.000 bài (15%)'
                    : 'Unseen Test Set: 18,000 papers (15%)'}
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
                          ? 'So sánh độ chính xác các phương pháp kiểm tra trên 18.000 bài độc lập'
                          : 'Comparing Verification Methods on 18,000 Unseen Papers'}
                      </h4>
                      <p
                        style={{ color: 'var(--solva-muted)' }}
                        className="font-solva-sans text-[13px] sm:text-[14px] mt-1"
                      >
                        {lang === 'vi'
                          ? 'Lý do vì sao chỉ kiểm tra DOI, chỉ tra 1 thư viện, hay chỉ dùng AI đoán tiêu đề đều dễ bỏ sót các trích dẫn bịa đặt tinh vi.'
                          : 'Why checking DOIs alone, querying one library, or relying solely on AI title matching misses realistic citation errors.'}
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
                        ? '99,96% trên 2.400 trích dẫn khó'
                        : '99.96% on 2,400 unseen edge cases'}
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
                        className="p-3 sm:p-3.5 rounded-[10px] border transition-[background-color,border-color,color] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]"
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
                              {lang === 'vi' ? 'Độ chuẩn xác:' : 'Precision:'}{' '}
                              <strong style={{ color: 'var(--solva-ink)' }}>
                                {lang === 'vi' ? row.prec : row.precEn}
                              </strong>
                            </span>
                            <span style={{ color: 'var(--solva-muted)' }}>
                              {lang === 'vi' ? 'Tỷ lệ phát hiện:' : 'Coverage:'}{' '}
                              <strong style={{ color: 'var(--solva-ink)' }}>
                                {lang === 'vi' ? row.rec : row.recEn}
                              </strong>
                            </span>
                            <span
                              className={`px-2 py-0.5 rounded font-bold ${
                                row.highlight
                                  ? 'bg-emerald-500/[0.15] text-emerald-700 dark:text-emerald-300'
                                  : 'bg-[#FBFAF6] dark:bg-[#141310]'
                              }`}
                              style={!row.highlight ? { color: 'var(--solva-ink)' } : undefined}
                            >
                              {fmtPct(row.acc)} {lang === 'vi' ? 'Chính xác' : 'Accuracy'}
                            </span>
                          </div>
                        </div>

                        {/* Visual Accuracy Progress Bar */}
                        <div className="w-full h-2 rounded-full bg-[#E7E3D9]/70 dark:bg-[#29261F] overflow-hidden">
                          <div
                            style={{ width: `${row.acc}%` }}
                            className={`h-full rounded-full transition-[width,background-color] duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] ${
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
                          ? 'Kết quả kiểm thử trên 4 trạng thái & 15 nhóm lỗi trích dẫn phổ biến'
                          : 'Accuracy Across All 4 Verdict Types & 15 Common Citation Issues'}
                      </h4>
                      <p
                        style={{ color: 'var(--solva-muted)' }}
                        className="font-solva-sans text-[13px] sm:text-[14px] mt-1"
                      >
                        {lang === 'vi'
                          ? 'Nguyên tắc công tâm: không để nguồn ảo lọt sang “Đã xác minh” và không báo nhầm tài liệu thật là “Không tìm thấy nguồn”.'
                          : 'Strict fairness rule: zero fake citations marked as “Verified” and zero real publications wrongly flagged as “Source Not Found”.'}
                      </p>
                    </div>
                    <span className="self-start sm:self-center px-3 py-1 rounded-[8px] bg-emerald-500/[0.12] text-emerald-700 dark:text-emerald-300 font-mono text-[11px] font-semibold shrink-0">
                      {lang === 'vi'
                        ? 'Độ chính xác chung: 99,67%'
                        : 'Overall Accuracy: 99.67%'}
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
                                ? `${cls.subtypes} · Kiểm thử ${cls.testSupport} mẫu`
                                : `${cls.subtypes} · ${cls.testSupport} test citations`}
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
                            <div style={{ color: 'var(--solva-muted)' }}>
                              {lang === 'vi' ? 'CHUẨN XÁC' : 'PRECISION'}
                            </div>
                            <div
                              style={{ color: 'var(--solva-ink)' }}
                              className="font-bold text-[13px] mt-0.5"
                            >
                              {cls.precision}
                            </div>
                          </div>
                          <div>
                            <div style={{ color: 'var(--solva-muted)' }}>
                              {lang === 'vi' ? 'PHÁT HIỆN' : 'DETECTION'}
                            </div>
                            <div
                              style={{ color: 'var(--solva-ink)' }}
                              className="font-bold text-[13px] mt-0.5"
                            >
                              {cls.recall}
                            </div>
                          </div>
                          <div>
                            <div style={{ color: 'var(--solva-muted)' }}>
                              {lang === 'vi' ? 'CÂN BẰNG' : 'BALANCE'}
                            </div>
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
                          ? 'Hiệu chỉnh độ khớp nguồn & Kiểm định tính ổn định'
                          : 'Calibrated Match Scores & Stability Check'}
                      </h4>
                      <p
                        style={{ color: 'var(--solva-muted)' }}
                        className="font-solva-sans text-[13px] sm:text-[14px] mt-1"
                      >
                        {lang === 'vi'
                          ? 'Mức độ khớp hiển thị trên CITRA được hiệu chỉnh độc lập trên 18.000 bài mẫu để phản ánh đúng độ chắc chắn thực tế — không bao giờ thổi phồng kết quả.'
                          : 'Match confidence scores are calibrated independently on 18,000 citations so high percentages genuinely reflect real-world accuracy without overconfidence.'}
                      </p>
                    </div>
                    <span className="self-start sm:self-center px-3 py-1 rounded-[8px] bg-emerald-500/[0.12] text-emerald-700 dark:text-emerald-300 font-mono text-[11px] font-semibold shrink-0">
                      {lang === 'vi'
                        ? '99,73% chính xác ở nhóm kết quả rõ ràng'
                        : '99.73% accuracy on clear-cut verdicts'}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
                    {/* Left: Before vs After Calibration */}
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
                          ? 'SO SÁNH ĐỘ CHÍNH XÁC ĐIỂM KHỚP (18.000 MẪU KIỂM THỬ)'
                          : 'MATCH SCORE RELIABILITY (18,000 UNSEEN TEST CITATIONS)'}
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
                            {lang === 'vi' ? 'CHƯA HIỆU CHỈNH' : 'BEFORE CALIBRATION'}
                          </div>
                          <div className="space-y-1 font-mono text-xs">
                            <div className="flex justify-between">
                              <span style={{ color: 'var(--solva-muted)' }}>
                                {lang === 'vi' ? 'Sai lệch điểm tin cậy:' : 'Score calibration error:'}
                              </span>
                              <strong style={{ color: 'var(--solva-ink)' }}>
                                {lang === 'vi' ? '24,8%' : '24.8%'}
                              </strong>
                            </div>
                            <div className="flex justify-between">
                              <span style={{ color: 'var(--solva-muted)' }}>
                                {lang === 'vi' ? 'Độ chính xác nhóm chắc chắn:' : 'High-confidence accuracy:'}
                              </span>
                              <strong style={{ color: 'var(--solva-ink)' }}>
                                {lang === 'vi' ? '99,64%' : '99.64%'}
                              </strong>
                            </div>
                            <div className="flex justify-between">
                              <span style={{ color: 'var(--solva-muted)' }}>
                                {lang === 'vi' ? 'Độ chính xác 90% ca rõ:' : 'Accuracy on top 90%:'}
                              </span>
                              <strong style={{ color: 'var(--solva-ink)' }}>
                                {lang === 'vi' ? '99,69%' : '99.69%'}
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
                              ? 'PHIÊN BẢN CITRA ĐANG VẬN HÀNH'
                              : 'LIVE CITRA CALIBRATION'}
                          </div>
                          <div className="space-y-1 font-mono text-xs">
                            <div className="flex justify-between">
                              <span style={{ color: 'var(--solva-muted)' }}>
                                {lang === 'vi' ? 'Sai lệch điểm tin cậy:' : 'Score calibration error:'}
                              </span>
                              <strong className="text-emerald-700 dark:text-emerald-300">
                                {lang === 'vi' ? '4,1% (giảm 6,1×)' : '4.1% (6.1× lower)'}
                              </strong>
                            </div>
                            <div className="flex justify-between">
                              <span style={{ color: 'var(--solva-muted)' }}>
                                {lang === 'vi' ? 'Độ chính xác nhóm chắc chắn:' : 'High-confidence accuracy:'}
                              </span>
                              <strong className="text-emerald-700 dark:text-emerald-300">
                                {lang === 'vi' ? '99,67%' : '99.67%'}
                              </strong>
                            </div>
                            <div className="flex justify-between">
                              <span style={{ color: 'var(--solva-muted)' }}>
                                {lang === 'vi' ? 'Độ chính xác 90% ca rõ:' : 'Accuracy on top 90%:'}
                              </span>
                              <strong className="text-emerald-700 dark:text-emerald-300">
                                {lang === 'vi' ? '99,73%' : '99.73%'}
                              </strong>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Right: Stability Summary */}
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
                          ? 'ĐỘ ỔN ĐỊNH KẾT QUẢ QUA 1.000 LẦN KIỂM TRA LẶP'
                          : 'CONSISTENCY ACROSS 1,000 REPEATED CHECKS'}
                      </div>

                      <div className="space-y-2 font-mono text-xs">
                        {[
                          {
                            metric: lang === 'vi' ? 'Độ chính xác tổng thể' : 'Overall Accuracy',
                            est: lang === 'vi' ? '99,67%' : '99.67%',
                            range: lang === 'vi' ? '99,58% – 99,76%' : '99.58% – 99.76%',
                          },
                          {
                            metric: lang === 'vi' ? 'Cân bằng 4 trạng thái' : '4-Class Balance',
                            est: lang === 'vi' ? '99,65%' : '99.65%',
                            range: lang === 'vi' ? '99,55% – 99,74%' : '99.55% – 99.74%',
                          },
                          {
                            metric: lang === 'vi' ? '2.400 trích dẫn khó' : '2,400 Unseen Edge Cases',
                            est: lang === 'vi' ? '99,96%' : '99.96%',
                            range: lang === 'vi' ? '2.399 / 2.400 đúng' : '2,399 / 2,400 correct',
                          },
                          {
                            metric: lang === 'vi' ? 'Bài mẫu hoàn chỉnh' : 'Full End-to-End Papers',
                            est: '100%',
                            range: lang === 'vi' ? '120 / 120 bài đúng' : '120 / 120 papers',
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
                              {item.range}
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
  const stickyBlocks: Array<{
    painting: string;
    title: string;
    desc: string;
    cta: string;
    to?: string;
    href?: string;
  }> = [
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
      to: isAuthenticated ? '/upload' : '/register',
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
      href: '#how-it-works',
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
      to: isAuthenticated ? '/upload' : '/register',
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
                      className="font-solva-serif font-light text-[30px] sm:text-[36px] xl:text-[40px] leading-[1.15] max-w-[400px]"
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
                    to={block.to}
                    href={block.href}
                    onClick={
                      block.href
                        ? () => {
                            notifyAnchorHashJump(block.href);
                          }
                        : undefined
                    }
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
function SolvaInteractiveDebuggerSection({
  lang,
  isAuthenticated,
}: {
  lang: Lang;
  isAuthenticated: boolean;
}) {
  const [selectedId, setSelectedId] = useState<string>(DEMO_CITATIONS[1].id);
  const [isAutoPlaying, setIsAutoPlaying] = useState<boolean>(true);
  const [isHoverPaused, setIsHoverPaused] = useState<boolean>(false);
  const [showTechnicalTrace, setShowTechnicalTrace] = useState<boolean>(false);
  const detailPaneRef = useRef<HTMLDivElement>(null);
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

  const formatDemoPage = (page: string) =>
    lang === 'vi' ? page.replace(/^p\.\s*/, 'tr. ') : page;

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
    if (
      typeof window !== 'undefined' &&
      window.innerWidth < 1024 &&
      typeof detailPaneRef.current?.scrollIntoView === 'function'
    ) {
      detailPaneRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const handleCitationKeyDown = (
    e: React.KeyboardEvent<HTMLButtonElement>,
    idx: number,
  ) => {
    let nextIdx: number | null = null;
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
      nextIdx = (idx + 1) % DEMO_CITATIONS.length;
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
      nextIdx = (idx - 1 + DEMO_CITATIONS.length) % DEMO_CITATIONS.length;
    } else if (e.key === 'Home') {
      nextIdx = 0;
    } else if (e.key === 'End') {
      nextIdx = DEMO_CITATIONS.length - 1;
    }
    if (nextIdx !== null) {
      e.preventDefault();
      const target = DEMO_CITATIONS[nextIdx];
      remainingTourMsRef.current = 4200;
      setSelectedId(target.id);
      setIsAutoPlaying(false);
      document.getElementById(`demo-citation-option-${target.id}`)?.focus();
    }
  };

  const renderFieldStatusBadge = (
    status: 'match' | 'partial' | 'mismatch' | 'missing' | 'unmatched' | 'not_found'
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
      case 'not_found':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[6px] text-[11px] font-mono font-semibold bg-red-500/[0.12] text-red-700 dark:text-red-300 whitespace-nowrap">
            <XCircle className="h-3 w-3" /> {lang === 'vi' ? 'Chưa tìm thấy' : 'Not found'}
          </span>
        );
      case 'unmatched':
        return (
          <span
            style={{
              backgroundColor: 'var(--solva-surface)',
              color: 'var(--solva-muted)',
            }}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[6px] text-[11px] font-mono font-semibold whitespace-nowrap"
          >
            {lang === 'vi' ? '— Chưa đối chiếu được' : '— Not matched'}
          </span>
        );
      case 'missing':
        return (
          <span
            style={{
              backgroundColor: 'var(--solva-surface)',
              color: 'var(--solva-muted)',
            }}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[6px] text-[11px] font-mono font-semibold whitespace-nowrap"
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
            onPointerDown={(e) => {
              if (e.pointerType === 'touch') {
                setIsAutoPlaying(false);
              }
            }}
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
                      {lang === 'vi'
                        ? 'KLTN_KinhTe_TaiChinh_2026.pdf'
                        : 'Thesis_Citation_Review_2026.pdf'}
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
                      {DEMO_CITATIONS.map((cit, idx) => {
                        const isSelected = cit.id === activeCitation.id;
                        const plainV = getPlainVerdictLabel(cit.verdict, lang);
                        const plainM = getPlainMappingLabel(cit.mappingStatus, lang);
                        return (
                          <button
                            key={cit.id}
                            id={`demo-citation-option-${cit.id}`}
                            type="button"
                            role="option"
                            aria-selected={isSelected}
                            onClick={() => handleSelectCitation(cit.id)}
                            onKeyDown={(e) => handleCitationKeyDown(e, idx)}
                            style={{
                              backgroundColor: isSelected
                                ? 'var(--solva-card-elevated)'
                                : 'var(--solva-surface)',
                              borderColor: isSelected
                                ? 'var(--solva-ink)'
                                : 'var(--solva-border)',
                            }}
                            className="relative overflow-hidden w-full text-left p-3.5 rounded-[10px] border transition-[background-color,border-color,color,box-shadow] duration-200 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1C1A15] dark:focus-visible:ring-[#FBFAF6] focus-visible:ring-offset-2"
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
                                {formatDemoPage(cit.page)}
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
                                {cit.verdict === 'SUSPECTED_HALLUCINATION' ? (
                                  <strong className="text-red-700 dark:text-red-300">
                                    {lang === 'vi' ? '0 nguồn khớp' : 'No match'}
                                  </strong>
                                ) : cit.verdict === 'UNRESOLVED' ? (
                                  <strong style={{ color: 'var(--solva-ink)' }}>
                                    {lang === 'vi' ? 'Chưa kiểm tra được' : 'Not checked'}
                                  </strong>
                                ) : (
                                  <>
                                    {lang === 'vi' ? 'Độ khớp nguồn:' : 'Source match:'}{' '}
                                    <strong style={{ color: 'var(--solva-ink)' }}>
                                      {cit.confidence}%
                                    </strong>
                                  </>
                                )}
                              </span>
                            </div>

                            {isSelected && (
                              <div
                                style={{ color: 'var(--solva-muted)' }}
                                className="mt-2 pt-1.5 border-t border-[#E7E3D9] dark:border-[#332F26] flex items-center justify-end gap-1 text-[10.5px] font-mono lg:hidden"
                              >
                                <span>
                                  {lang === 'vi' ? 'Xem chi tiết bên dưới' : 'View details below'}
                                </span>
                                <ArrowDown className="h-3 w-3 shrink-0" aria-hidden="true" />
                              </div>
                            )}

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
                          ? `CÂU VĂN TRONG BÀI (${formatDemoPage(activeCitation.page)})`
                          : `SENTENCE IN YOUR PAPER (${formatDemoPage(activeCitation.page)})`}
                      </span>
                      <span>
                        {lang === 'vi' ? 'Đoạn trích gốc' : 'In-text excerpt'}
                      </span>
                    </div>
                    <p
                      style={{ color: 'var(--solva-ink)' }}
                      className="text-xs sm:text-sm leading-relaxed"
                    >
                      {lang === 'vi' ? activeCitation.contextBeforeVi : activeCitation.contextBefore}
                      <mark
                        style={{
                          backgroundColor: 'var(--solva-btn-bg)',
                          color: 'var(--solva-btn-fg)',
                        }}
                        className="px-1.5 py-0.5 rounded font-medium"
                      >
                        {activeCitation.inText}
                      </mark>
                      {lang === 'vi' ? activeCitation.contextAfterVi : activeCitation.contextAfter}
                    </p>
                  </div>
                </div>

                {/* Right Pane: Plain-Language Verdict & Optional Technical Trace (7 cols) */}
                <div
                  ref={detailPaneRef}
                  style={{ backgroundColor: 'var(--solva-card-elevated)' }}
                  className="lg:col-span-7 min-w-0 scroll-mt-[84px] p-4 sm:p-6 flex flex-col justify-between"
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
                            ·{' '}
                            {activeCitation.verdict === 'SUSPECTED_HALLUCINATION' ? (
                              <span
                                data-testid="debugger-active-confidence"
                                className="text-red-700 dark:text-red-300 font-semibold"
                              >
                                {lang === 'vi' ? 'Không tìm thấy nguồn' : 'No match found'}
                              </span>
                            ) : activeCitation.verdict === 'UNRESOLVED' ? (
                              <span
                                data-testid="debugger-active-confidence"
                                style={{ color: 'var(--solva-ink)' }}
                                className="font-semibold"
                              >
                                {lang === 'vi' ? 'Chưa kiểm tra được' : 'Not checked yet'}
                              </span>
                            ) : (
                              <>
                                {lang === 'vi' ? 'Độ khớp nguồn' : 'Source match'}{' '}
                                <NumberPopIn
                                  value={`${activeCitation.confidence}%`}
                                  data-testid="debugger-active-confidence"
                                />
                              </>
                            )}
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
                        className="grid grid-cols-1 sm:grid-cols-3 w-full p-1 rounded-[10px] h-auto gap-1 border border-[#E7E3D9] dark:border-[#3A352B] [&_.t-tabs-pill]:bg-white dark:[&_.t-tabs-pill]:bg-[#FBFAF6] [&_.t-tabs-pill]:ring-1 [&_.t-tabs-pill]:ring-[#1C1A15]/10 dark:[&_.t-tabs-pill]:ring-white/20"
                      >
                        <TabsTrigger
                          value="diff"
                          className="w-full text-xs font-solva-sans font-medium py-2 sm:py-1.5 px-2.5 rounded-[8px] data-[state=active]:text-[#1C1A15] dark:data-[state=active]:text-[#1C1A15] dark:data-[state=active]:bg-[#FBFAF6] data-[state=inactive]:text-[#56524A] dark:data-[state=inactive]:text-[#C5BFB2] dark:data-[state=inactive]:hover:text-[#FBFAF6]"
                        >
                          {lang === 'vi' ? '1. So sánh thông tin' : '1. Side-by-Side Details'}
                        </TabsTrigger>
                        <TabsTrigger
                          value="rules"
                          className="w-full text-xs font-solva-sans font-medium py-2 sm:py-1.5 px-2.5 rounded-[8px] data-[state=active]:text-[#1C1A15] dark:data-[state=active]:text-[#1C1A15] dark:data-[state=active]:bg-[#FBFAF6] data-[state=inactive]:text-[#56524A] dark:data-[state=inactive]:text-[#C5BFB2] dark:data-[state=inactive]:hover:text-[#FBFAF6]"
                        >
                          {lang === 'vi'
                            ? `2. Lý do kết luận (${activeCitation.rules.length})`
                            : `2. Why This Result (${activeCitation.rules.length})`}
                        </TabsTrigger>
                        <TabsTrigger
                          value="sources"
                          className="w-full text-xs font-solva-sans font-medium py-2 sm:py-1.5 px-2.5 rounded-[8px] data-[state=active]:text-[#1C1A15] dark:data-[state=active]:text-[#1C1A15] dark:data-[state=active]:bg-[#FBFAF6] data-[state=inactive]:text-[#56524A] dark:data-[state=inactive]:text-[#C5BFB2] dark:data-[state=inactive]:hover:text-[#FBFAF6]"
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
                                  {lang === 'vi' ? 'Bạn ghi trong bài' : 'In Your Paper'}
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
                                      {src.status === 'matched'
                                        ? lang === 'vi'
                                          ? 'Tìm thấy bản ghi gốc'
                                          : 'Source record found'
                                        : lang === 'vi'
                                          ? 'Đã tra cứu'
                                          : 'Checked'}
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

                    {/* Progressive Disclosure: Detailed Verification Criteria */}
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
                        className="w-full min-h-[44px] px-3.5 py-2 rounded-[9px] border font-solva-sans text-xs font-medium flex items-center justify-between gap-2 hover:opacity-90 active:scale-[0.99] transition-[transform,opacity,background-color,border-color,color] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] cursor-pointer"
                      >
                        <span>
                          {showTechnicalTrace
                            ? lang === 'vi'
                              ? 'Ẩn chi tiết các bước kiểm tra'
                              : 'Hide Detailed Verification Steps'
                            : lang === 'vi'
                              ? 'Tùy chọn: Xem chi tiết các tiêu chí đối chiếu'
                              : 'Optional: View Detailed Verification Criteria'}
                        </span>
                        <SymmetricChevron open={showTechnicalTrace} size={14} />
                      </button>

                      <div
                        id="debugger-technical-trace-panel"
                        hidden={!showTechnicalTrace}
                      >
                        {showTechnicalTrace && (
                          <div
                            data-testid="debugger-technical-trace-panel"
                            style={{
                              backgroundColor: 'var(--solva-surface)',
                              borderColor: 'var(--solva-border)',
                            }}
                            className="p-3.5 rounded-[10px] border space-y-2.5 animate-debugger-switch"
                          >
                          <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-[#E7E3D9] dark:border-[#332F26] text-[11px]">
                            <span style={{ color: 'var(--solva-muted)' }} className="font-mono">
                              {lang === 'vi'
                                ? 'KẾT QUẢ 2 BƯỚC KIỂM TRA:'
                                : 'TWO-STEP VERIFICATION RESULT:'}
                            </span>
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span
                                style={{
                                  backgroundColor: 'var(--solva-bg)',
                                  color: 'var(--solva-ink)',
                                  borderColor: 'var(--solva-border)',
                                }}
                                className="px-2 py-0.5 rounded border font-medium"
                              >
                                {activePlainVerdict.label}
                              </span>
                              <span
                                style={{
                                  backgroundColor: 'var(--solva-bg)',
                                  color: 'var(--solva-ink)',
                                  borderColor: 'var(--solva-border)',
                                }}
                                className="px-2 py-0.5 rounded border font-medium"
                              >
                                {activePlainMapping.label}
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
                                className="p-2.5 rounded-[8px] border space-y-1 text-[11.5px]"
                              >
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <span style={{ color: 'var(--solva-ink)' }} className="font-semibold">
                                    {lang === 'vi' && rule.nameVi ? rule.nameVi : rule.name}
                                  </span>
                                  <span style={{ color: 'var(--solva-muted)' }} className="font-mono text-[10.5px]">
                                    {lang === 'vi'
                                      ? rule.status === 'passed'
                                        ? 'Đạt'
                                        : rule.status === 'warning'
                                          ? 'Lưu ý'
                                          : 'Chưa đạt'
                                      : rule.status === 'passed'
                                        ? 'Passed'
                                        : rule.status === 'warning'
                                          ? 'Review'
                                          : 'Issue'}
                                  </span>
                                </div>
                                <div
                                  style={{ color: 'var(--solva-muted)' }}
                                  className="break-words leading-snug"
                                >
                                  {lang === 'vi' ? rule.detailVi : rule.detailEn}
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

              {/* Guest / Signed-in Quick Paste Sandbox Bridge */}
              <div
                style={{
                  backgroundColor: 'var(--solva-surface)',
                  borderColor: 'var(--solva-border)',
                }}
                className="px-4 sm:px-6 py-3 border-t flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-xs"
              >
                <p style={{ color: 'var(--solva-muted)' }} className="font-solva-sans leading-relaxed">
                  {lang === 'vi'
                    ? 'Bạn có thể khám phá ngay 4 thẻ trích dẫn mẫu tương tác ở trên mà không cần đăng nhập — hoặc đăng nhập để dán trực tiếp danh mục trích dẫn của riêng bạn.'
                    : 'Explore all 4 interactive sample cards right here without signing in — or sign in to paste and check your own custom reference list.'}
                </p>
                <Link
                  to={isAuthenticated ? '/sandbox' : '/login'}
                  data-testid="interactive-demo-sandbox-link"
                  style={{ color: 'var(--solva-ink)' }}
                  className="inline-flex items-center gap-1.5 font-solva-sans font-medium whitespace-nowrap shrink-0 underline underline-offset-4 hover:opacity-80 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1C1A15] dark:focus-visible:ring-[#FBFAF6] rounded"
                >
                  <span>
                    {isAuthenticated
                      ? lang === 'vi'
                        ? 'Mở công cụ kiểm tra nhanh'
                        : 'Open Quick Citation Check'
                      : lang === 'vi'
                        ? 'Đăng nhập để kiểm tra trích dẫn riêng'
                        : 'Sign in for Custom Quick Paste'}
                  </span>
                  <ArrowRight className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                </Link>
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
                className="t-tabs-pill rounded-[10px] border border-[#E7E3D9] dark:border-[#3F3A2F] shadow-sm"
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
                        className="font-solva-serif font-light text-[26px] sm:text-[30px] leading-[1.25]"
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
                      allowWrap
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
          ? 'Giảng viên & tác giả luôn quyết định cuối'
          : 'You and your advisor always decide',
      desc:
        lang === 'vi'
          ? 'CITRA chỉ cung cấp bằng chứng từ các thư viện học thuật; quyền đánh giá cuối cùng luôn thuộc về bạn, giảng viên và hội đồng.'
          : 'Provides verifiable library records and clear reasons; final judgment always remains with you and your instructors.',
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
          ? 'Bảo mật tuyệt đối bài viết & khóa luận'
          : 'Paper privacy by default',
      desc:
        lang === 'vi'
          ? 'Bài viết và khóa luận chưa công bố luôn thuộc toàn quyền sở hữu của bạn và không bao giờ bị dùng để huấn luyện AI bên ngoài.'
          : 'Your uploaded papers and theses stay private and are never used to train external AI models.',
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
  const [annualBilling, setAnnualBilling] = useState(true);
  const billingQuery = annualBilling ? 'annual' : 'monthly';

  const tiers = [
    {
      key: 'basic' as const,
      name: 'Basic',
      subtitle: lang === 'vi' ? 'Khởi đầu học thuật' : 'Student Starter',
      headerTag: lang === 'vi' ? 'MẶC ĐỊNH' : 'DEFAULT',
      headerEyebrow: (lang === 'vi'
        ? '01 · MIỄN PHÍ TRỌN ĐỜI'
        : '01 · FREE FOREVER') as string | null,
      savingsBadge: null as string | null,
      metricNum: 0,
      vndPrimary: 'Miễn phí',
      unit: lang === 'vi' ? '' : 'month',
      vndNode:
        lang === 'vi' ? (
          <>
            <span className="whitespace-nowrap">Dùng mãi mãi</span> ·{' '}
            <span className="whitespace-nowrap">Không cần thẻ ngân hàng</span>
          </>
        ) : null,
      vndTestId: undefined as string | undefined,
      desc:
        lang === 'vi'
          ? 'Bộ công cụ rà soát trích dẫn thiết yếu dành cho sinh viên viết tiểu luận môn học, tổng quan tài liệu và kiểm tra nhanh danh mục tham khảo.'
          : 'Essential citation verification for course essays, literature reviews, and quick bibliography checks.',
      includesLabel: lang === 'vi' ? 'Quyền lợi bao gồm:' : 'Includes:',
      items:
        lang === 'vi'
          ? [
              '3 bài viết / tháng (tối đa 15 trang, 5 MB / tệp)',
              'Hỗ trợ PDF, Word (.docx) và file Zotero/Mendeley (.bib, .ris) — tối đa 30 trích dẫn / bài',
              'Tự động đối chiếu trích dẫn trong bài & tài liệu tham khảo (APA, IEEE)',
              'Xác thực trực tiếp qua Crossref, OpenAlex & Văn bản pháp luật VN',
              'Chấm điểm toàn vẹn trích dẫn & phân loại chi tiết từng lỗi sai lệch',
              'Bao gồm báo cáo trực tuyến đầy đủ (Xuất Word/PDF ở gói Pro)',
            ]
          : [
              '3 papers / month (up to 15 pages, 5 MB)',
              'Supports PDF, Word (.docx) & Zotero/Mendeley (.bib, .ris) — up to 30 citations / doc',
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
        lang === 'vi' ? 'Khóa luận & Công bố quốc tế' : 'Thesis Writers & Researchers',
      headerTag: lang === 'vi' ? '02 · PHỔ BIẾN NHẤT' : '02 · MOST POPULAR',
      headerEyebrow: null as string | null,
      savingsBadge: annualBilling
        ? lang === 'vi'
          ? 'Tiết kiệm 1.200.000 ₫/năm'
          : 'Save $48/yr'
        : null,
      metricNum: annualBilling ? 16 : 20,
      vndPrimary: annualBilling ? '400.000 ₫' : '500.000 ₫',
      unit:
        lang === 'vi'
          ? 'tháng'
          : annualBilling
            ? 'month (billed yearly)'
            : 'month',
      vndNode:
        lang === 'vi' ? (
          annualBilling ? (
            <>
              <span className="whitespace-nowrap">Thanh toán 4.800.000 ₫/năm</span>{' '}
              <span className="whitespace-nowrap">
                (~<span data-testid="landing-price-pro">$16</span>/tháng) qua VNPay hoặc thẻ quốc tế
              </span>
            </>
          ) : (
            <>
              <span className="whitespace-nowrap">
                Thanh toán hàng tháng (~<span data-testid="landing-price-pro">$20</span>/tháng)
              </span>{' '}
              <span className="whitespace-nowrap">qua VNPay hoặc thẻ quốc tế</span>
            </>
          )
        ) : null,
      vndTestId: 'pro-vnd-equivalent',
      desc:
        lang === 'vi'
          ? 'Kiểm tra toàn diện trên hơn 15 thư viện học thuật, đối chiếu xem bài gốc có khớp ý bạn viết không và tự động định dạng lại danh mục tham khảo chỉ với 1 chạm.'
          : 'Cross-check across 15+ scholarly libraries, verify claim context, and get 1-click formatting fixes for graduation theses.',
      includesLabel:
        lang === 'vi'
          ? 'Toàn bộ quyền lợi gói Basic, cộng thêm:'
          : 'Everything in Basic, plus:',
      items:
        lang === 'vi'
          ? [
              '50 bài viết / tháng (tối đa 100 trang, 25 MB / tệp)',
              'Tối đa 200 trích dẫn / bài & tải lên đồng thời tới 10 tệp',
              'Mở khóa toàn bộ 15+ thư viện học thuật uy tín (PubMed, arXiv, DBLP, DOAJ...)',
              'Kiểm tra bài báo gốc có khớp với ý bạn trích dẫn không (song ngữ Việt ↔ Anh)',
              'Tự động định dạng danh mục (APA, IEEE, Harvard) & xuất báo cáo Word/PDF',
            ]
          : [
              '50 papers / month (up to 100 pages, 25 MB)',
              'Up to 200 citations / paper & multi-file upload (up to 10 files)',
              'Full 15+ academic libraries (PubMed, arXiv, DBLP, DOAJ & Retraction Watch)',
              'Verify cited paper abstracts match your claims (English ↔ Vietnamese)',
              'One-click reference formatting (APA, IEEE, Harvard) & Word/PDF export',
            ],
      cta: lang === 'vi' ? 'Nâng cấp lên Pro' : 'Upgrade to Pro',
      to: `/pricing?billing=${billingQuery}`,
      featured: true,
    },
    {
      key: 'ultra' as const,
      name: 'Ultra',
      subtitle:
        lang === 'vi' ? 'Nhóm nghiên cứu, Khoa & Hội đồng' : 'Research Groups & Departments',
      headerTag: lang === 'vi' ? 'QUY MÔ LỚN' : 'INSTITUTIONAL',
      headerEyebrow: (lang === 'vi'
        ? '03 · BỘ MÔN & HỘI ĐỒNG'
        : '03 · FACULTY & COHORT') as string | null,
      savingsBadge: annualBilling
        ? lang === 'vi'
          ? 'Tiết kiệm 12.000.000 ₫/năm'
          : 'Save $480/yr'
        : null,
      metricNum: annualBilling ? 160 : 200,
      vndPrimary: annualBilling ? '4.000.000 ₫' : '5.000.000 ₫',
      unit:
        lang === 'vi'
          ? 'tháng'
          : annualBilling
            ? 'month (billed yearly)'
            : 'month',
      vndNode:
        lang === 'vi' ? (
          annualBilling ? (
            <>
              <span className="whitespace-nowrap">Thanh toán 48.000.000 ₫/năm</span>{' '}
              <span className="whitespace-nowrap">
                (~<span data-testid="landing-price-ultra">$160</span>/tháng) qua VNPay hoặc thẻ quốc tế
              </span>
            </>
          ) : (
            <>
              <span className="whitespace-nowrap">
                Thanh toán hàng tháng (~<span data-testid="landing-price-ultra">$200</span>/tháng)
              </span>{' '}
              <span className="whitespace-nowrap">qua VNPay hoặc thẻ quốc tế</span>
            </>
          )
        ) : null,
      vndTestId: 'ultra-vnd-equivalent',
      desc:
        lang === 'vi'
          ? 'Giải pháp rà soát chuyên sâu cho Nhóm nghiên cứu, Bộ môn, Khoa và Hội đồng bảo vệ với tra cứu mở rộng qua Google Scholar, quản lý đợt nộp bài và lịch sử duyệt.'
          : 'High-volume institutional verification with extended Google Scholar discovery, cohort management, and faculty review logs.',
      includesLabel:
        lang === 'vi'
          ? 'Toàn bộ quyền lợi gói Pro, cộng thêm:'
          : 'Everything in Pro, plus:',
      items:
        lang === 'vi'
          ? [
              'Tối đa 1.000 bài viết / tháng (lên đến 500 trang, 100 MB / tệp)',
              'Không giới hạn số trích dẫn / bài & rà soát đồng thời tới 50 bài nộp',
              'Tra cứu mở rộng qua Google Scholar cho sách chuyên khảo & ấn phẩm hiếm',
              'Không gian quản lý lớp học, thu bài theo đợt & xác nhận thủ công cho giảng viên',
              'Luồng xử lý ưu tiên, lưu trữ trọn đời & lịch sử duyệt bài minh bạch',
            ]
          : [
              'Up to 1,000 papers / month (up to 500 pages, 100 MB each)',
              'Unlimited citations per paper & bulk cohort upload (up to 50 files)',
              'Extended Google Scholar discovery for rare monographs & regional works',
              'Faculty cohort workspace, student submissions & instructor review notes',
              'Priority processing queue, lifetime history & institutional review log',
            ],
      cta: lang === 'vi' ? 'Khám phá gói Ultra' : 'Explore Ultra plan',
      to: `/pricing?billing=${billingQuery}`,
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

                    {/* Row 3: Price Display (`Sentient` Light + Prominent VND in VI + #02 Per-Digit NumberPopIn) */}
                    <div
                      style={{ borderColor: 'var(--solva-border)' }}
                      className="pt-[16px] lg:pb-[18px] border-t"
                    >
                      {lang === 'vi' ? (
                        <div className="flex items-baseline gap-1.5 flex-wrap">
                          <span
                            style={{ color: 'var(--solva-ink)' }}
                            className="font-solva-serif font-light text-[32px] sm:text-[36px] leading-[42px] tracking-[-0.03em] whitespace-nowrap"
                            data-testid={`landing-vnd-price-${tier.key}`}
                          >
                            {tier.key === 'basic' ? (
                              tier.vndPrimary
                            ) : (
                              <>
                                <NumberPopIn value={tier.vndPrimary.replace(' ₫', '')} />
                                {' ₫'}
                              </>
                            )}
                          </span>
                          {tier.unit && (
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
                          )}
                        </div>
                      ) : (
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
                      )}
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
                ? 'Khác biệt rõ nét, ngay từ bài viết đầu tiên.'
                : 'Big results, from your very first paper.'
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
                  <blockquote className="font-solva-serif font-light text-[24px] sm:text-[30px] leading-[1.25] max-w-[520px]">
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
                    className="font-solva-sans text-[15px] font-medium tracking-tight shrink-0 flex items-center gap-1.5"
                  >
                    <GraduationCap className="w-5 h-5" />
                    <span>{lang === 'vi' ? 'Nghiên cứu tình huống' : 'Academic Case Study'}</span>
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
        : 'Submit your thesis or paper with complete citation confidence.',
      summary: isVi
        ? 'Rà soát danh mục tham khảo ngay khi đang viết, không sợ sót nguồn hay nhầm năm xuất bản.'
        : 'Verify every reference while you write — before a reviewer or advisor ever sees a formatting slip.',
      steps: isVi
        ? [
            'Tải tệp PDF, Word (.docx), file Zotero/Mendeley (.bib, .ris) hoặc dán trực tiếp danh mục tham khảo để kiểm tra nhanh.',
            'Phát hiện tức thì trích dẫn thiếu mục tài liệu cuối bài, lệch năm công bố hoặc tài liệu không có thật.',
            'Chuẩn hóa trích dẫn chuẩn APA, IEEE, Harvard và theo dõi Điểm Toàn vẹn Trích dẫn tăng qua từng bản sửa.',
          ]
        : [
            'Upload a PDF, Word (.docx), or Zotero/Mendeley bibliography file — or paste references for an instant check while writing.',
            'Spot missing bibliography entries, wrong publication years, and non-existent AI-suggested papers in seconds.',
            'Apply clean APA, IEEE, or Harvard fixes and watch your Citation Integrity Score climb across revisions.',
          ],
      ctaLabel: isAuthenticated
        ? isVi
          ? 'Kiểm tra bài viết ngay'
          : 'Check a Paper Now'
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
      previewMetricValue: '72 → 98 / 100',
      previewRows: isVi
        ? [
            { label: '28 nguồn học thuật khớp chuẩn quốc tế', badge: 'ĐÃ XÁC MINH', tone: 'ok' },
            { label: '2 lỗi ghi nhầm năm bản nháp đã chỉnh sửa', badge: 'ĐÃ CHUẨN HÓA', tone: 'info' },
            { label: 'Không còn nguồn trích dẫn ảo', badge: 'SẴN SÀNG NỘP', tone: 'ok' },
          ]
        : [
            { label: '28 scholarly sources matched & confirmed', badge: 'VERIFIED', tone: 'ok' },
            { label: '2 early-draft to published year typos corrected', badge: 'FIXED', tone: 'info' },
            { label: '0 unverified phantom references remaining', badge: 'READY', tone: 'ok' },
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
              className={`min-h-[44px] px-3.5 py-2.5 rounded-[10px] inline-flex items-center justify-center gap-2 font-solva-sans text-[14px] font-medium active:scale-[0.99] transition-[transform,opacity,background-color,border-color,color,box-shadow] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] cursor-pointer ${
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
            ? '“Biểu đồ theo dõi qua từng lần sửa bài giúp mình trình bày rõ ràng với cô hướng dẫn rằng Điểm Toàn vẹn Trích dẫn đã tăng từ 71/100 ở bản nháp đầu lên 98/100 ở bản nộp cuối.”'
            : '“The revision progress view showed my advisor how my Citation Integrity Score improved from 71/100 in Draft 1 to 98/100 in my final submission.”',
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
          : 'CITRA runs two independent checks: first, it checks your paper internally to ensure every in-text citation links to an entry in your reference list; second, it looks up each work across 15+ libraries to separate minor year/venue typos from non-existent sources.',
    },
    {
      id: 'faq-2',
      q:
        lang === 'vi'
          ? 'Hệ thống hỗ trợ những định dạng tệp và chuẩn trích dẫn nào?'
          : 'Which file formats and citation styles does CITRA support?',
      a:
        lang === 'vi'
          ? 'Bạn có thể tải lên tệp PDF, Word (.docx), file thư mục từ Zotero/Mendeley (.bib, .ris) hoặc dán trực tiếp đoạn văn bản. Hệ thống đọc chính xác cả nhóm chuẩn đánh số như IEEE ([1]–[5]), Vancouver, ACM lẫn nhóm chuẩn Tác giả – Năm như APA 7th, Harvard, Chicago, MLA và quy định khóa luận tại Việt Nam.'
          : 'You can upload PDF, Word (.docx), or Zotero/Mendeley bibliography files (.bib, .ris), or paste references directly. CITRA supports numbered styles (IEEE [1]–[5], Vancouver, ACM) as well as author-year formats (APA 7th, Harvard, Chicago, MLA).',
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
                    ? 'Tải lên khóa luận hoặc bài báo (PDF, Word hoặc file Zotero/Mendeley) và nhận báo cáo kiểm chứng trích dẫn rõ ràng, dễ hiểu chỉ sau vài giây — tự tin trọn vẹn trước giờ nộp bài.'
                    : 'Upload your thesis or paper (PDF, Word, or Zotero/Mendeley file) and receive a clear, actionable citation verification report in seconds — before you submit.'}
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
        { label: lang === 'vi' ? 'Độ tin cậy' : 'Accuracy', href: '#benchmark-120k' },
        { label: lang === 'vi' ? 'Bảng giá' : 'Pricing', href: '#pricing-plans' },
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
      header: lang === 'vi' ? 'Tính năng chính' : 'Capabilities',
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
            <Link
              to="/"
              className="inline-flex items-center gap-[10px] rounded-[6px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1C1A15] dark:focus-visible:ring-[#FBFAF6] focus-visible:ring-offset-2"
            >
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
                                  if (
                                    e.metaKey ||
                                    e.ctrlKey ||
                                    e.shiftKey ||
                                    e.altKey ||
                                    e.button !== 0
                                  ) {
                                    return;
                                  }
                                  e.preventDefault();
                                  if (lnk.href) {
                                    window.history.replaceState(null, '', lnk.href);
                                    notifyAnchorHashJump(
                                      lnk.href.startsWith('#') ? lnk.href : window.location.hash,
                                    );
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
              ? 'Công cụ hỗ trợ kiểm tra trích dẫn — đồng hành cùng bạn và giảng viên, không thay thế quyết định của con người.'
              : 'Citation verification assistant — supports your review, never replaces human judgment.'}
          </p>
        </div>
      </div>
    </footer>
  );
}
