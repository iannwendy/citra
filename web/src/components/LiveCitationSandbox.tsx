import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  api,
  type SandboxAclPaperItem,
  type SandboxInstantVerifyResponse,
  type ValidationLabel,
  type Verdict,
} from '@/api/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { useVerificationProgress } from '@/contexts/VerificationProgressContext';
import { UpgradeModal } from '@/components/UpgradeModal';
import { DecisionSupportBanner } from '@/components/DecisionSupportBanner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { CardResize, IconSwap, TextMorph } from '@/components/ui/transitions';
import {
  m,
  AnimatePresence,
  TRANSITION_ENTER,
  TRANSITION_EXIT,
} from '@/components/ui/motion-primitives';
import {
  formatUserError,
  getMappingStatusDisplay,
  getVerdictDisplay,
  normalizeMappingStatusKey,
  normalizeVerdictKey,
  resolveAcademicLang,
} from '@/lib/academicTaxonomy';
import {
  extractObservedWebMeta,
  getCitationMarkerLabel,
  getRuleDisplayName,
  getSourceDisplayName,
  getVerdictExplanation,
  isLegalStatuteVerdict,
} from '@/lib/verdictExplanation';
import {
  Sparkles,
  Shuffle,
  FileText,
  Download,
  Zap,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  HelpCircle,
  RotateCcw,
  Wand2,
  Loader2,
  Link2,
  Scale,
  BookOpen,
  Copy,
  Check,
  ChevronDown,
  Clock,
} from 'lucide-react';

interface LiveCitationSandboxProps {
  lang?: 'vi' | 'en';
}

const DEFAULT_RAW_REFS_SAMPLE = `Vaswani, A., Shazeer, N., & Parmar, N. (2017). Attention Is All You Need. Advances in Neural Information Processing Systems (NeurIPS). https://doi.org/10.48550/arXiv.1706.03762\nDevlin, J., Chang, M., Lee, K., & Toutanova, K. (2022). BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding. NAACL-HLT. https://doi.org/10.18653/v1/N19-1423\nSmith, J., & Nguyen, T. (2024). Autonomous Quantum Hyper-Graph Transformers for Zero-Shot Reasoning. Journal of Imaginary AI Research. https://doi.org/10.9999/fake.hallucination.2024`;

export function LiveCitationSandbox({ lang: langProp }: LiveCitationSandboxProps) {
  const { i18n } = useTranslation();
  const i18nLang = resolveAcademicLang(i18n.resolvedLanguage || i18n.language);
  const lang: 'vi' | 'en' = langProp ?? i18nLang;
  const isVi = lang === 'vi';
  const { user, refreshUser } = useAuth();
  const { syncSingleCheckFromStatus } = useVerificationProgress();
  const navigate = useNavigate();
  const toast = useToast();

  const [upgradeOpen, setUpgradeOpen] = useState(false);

  const [mode, setMode] = useState<'acl_studio' | 'raw_paste'>('acl_studio');
  const [sampleCount, setSampleCount] = useState<number>(12);
  const [style, setStyle] = useState<'apa' | 'ieee'>('apa');
  const [manuscriptTitle, setManuscriptTitle] = useState<string>(
    'Empirical Evaluation of Neural Language Representations and Citation Integrity in Computational Linguistics',
  );
  const [items, setItems] = useState<SandboxAclPaperItem[]>([]);
  const [loadingSample, setLoadingSample] = useState(false);
  const [generatingPdf, setGeneratingPdf] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [verifyingInstant, setVerifyingInstant] = useState(false);
  const [instantResult, setInstantResult] = useState<SandboxInstantVerifyResponse | null>(null);
  const [rawRefsText, setRawRefsText] = useState<string>(DEFAULT_RAW_REFS_SAMPLE);
  const [lastVerifiedText, setLastVerifiedText] = useState<string | null>(null);
  const [isResultStale, setIsResultStale] = useState(false);
  const [expandedTechCards, setExpandedTechCards] = useState<Record<string, boolean>>({});
  const [copiedBibtex, setCopiedBibtex] = useState(false);

  const handleModeSwitch = (nextMode: 'acl_studio' | 'raw_paste') => {
    if (nextMode === mode) return;
    setMode(nextMode);
    setInstantResult(null);
    setIsResultStale(false);
    setExpandedTechCards({});
  };

  const handleRawTextChange = (nextText: string) => {
    setRawRefsText(nextText);
    if (!nextText.trim()) {
      setInstantResult(null);
      setIsResultStale(false);
      setExpandedTechCards({});
      return;
    }
    if (instantResult) {
      setIsResultStale(nextText !== lastVerifiedText);
    }
  };

  const handleSampleRandomAcl = async (customCount?: number) => {
    const targetCount = customCount ?? sampleCount;
    setLoadingSample(true);
    setInstantResult(null);
    setIsResultStale(false);
    setExpandedTechCards({});
    try {
      const res = await api.sampleSandboxAclPapers(targetCount, style);
      setItems(res.items || []);
      toast.success(
        isVi
          ? `Đã lấy ngẫu nhiên ${res.items.length} bài báo thật từ kho 128.000+ bài báo học thuật.`
          : `Sampled ${res.items.length} real papers from the 128K+ scholarly papers corpus.`,
      );
    } catch (e) {
      toast.error(
        formatUserError(
          e,
          lang,
          isVi
            ? 'Không thể lấy mẫu từ kho bài báo học thuật. Vui lòng thử lại.'
            : 'Failed to sample papers from the scholarly corpus. Please try again.',
        ),
      );
    } finally {
      setLoadingSample(false);
    }
  };

  const updateItemField = <K extends keyof SandboxAclPaperItem>(
    idx: number,
    field: K,
    value: SandboxAclPaperItem[K],
  ) => {
    if (instantResult) {
      setIsResultStale(true);
    }
    setItems((prev) =>
      prev.map((it, i) => {
        if (i !== idx) return it;
        const updated: SandboxAclPaperItem = {
          ...it,
          [field]: value,
        };
        if (field === 'authors_text' && typeof value === 'string') {
          updated.authors = value
            .split(/[;,]/)
            .map((s) => s.trim())
            .filter(Boolean);
        }
        return updated;
      }),
    );
  };

  const applyItemPreset = (
    idx: number,
    preset:
      | 'clean'
      | 'wrong_year'
      | 'wrong_author'
      | 'hallucinated'
      | 'year_mismatch_intext'
      | 'uncited_ref'
      | 'orphan_intext',
  ) => {
    if (instantResult) {
      setIsResultStale(true);
    }
    setItems((prev) =>
      prev.map((it, i) => {
        if (i !== idx) return it;
        const orig = it.original || {
          title: it.title,
          authors_text: it.authors_text,
          year: it.year,
          venue: it.venue,
          doi: it.doi,
        };
        const base: SandboxAclPaperItem = {
          ...it,
          title: orig.title,
          authors_text: orig.authors_text,
          authors: orig.authors_text
            .split(/[;,]/)
            .map((s) => s.trim())
            .filter(Boolean),
          year: orig.year,
          venue: orig.venue,
          doi: orig.doi,
          cite_in_text: true,
          include_in_references: true,
          in_text_year_override: '',
          mutation_preset: preset,
        };
        const origYr = parseInt(orig.year, 10) || 2020;

        if (preset === 'wrong_year') {
          base.year = String(origYr >= 2023 ? origYr - 4 : origYr + 3);
        } else if (preset === 'wrong_author') {
          base.authors_text = 'Michael Anderson; Elena Rostova';
          base.authors = ['Michael Anderson', 'Elena Rostova'];
        } else if (preset === 'hallucinated') {
          const topicWords = orig.title
            .split(/\s+/)
            .filter(Boolean)
            .slice(0, 5)
            .join(' ')
            .replace(/[.,:;!?]+$/, '');
          base.title = `Autonomous Quantum Hyper-Graph Prompting for Zero-Shot ${topicWords || 'Neural Reasoning'}`;
          base.authors_text = 'Jonathan Sterling; Victoria Vance';
          base.authors = ['Jonathan Sterling', 'Victoria Vance'];
          base.year = '2025';
          base.venue = 'International Journal of Synthetic Computational Systems';
          base.doi = `10.9999/unverified.acl.2025.${idx + 101}`;
        } else if (preset === 'year_mismatch_intext') {
          base.in_text_year_override = String(Math.max(1995, origYr - 12));
        } else if (preset === 'uncited_ref') {
          base.cite_in_text = false;
          base.include_in_references = true;
        } else if (preset === 'orphan_intext') {
          base.cite_in_text = true;
          base.include_in_references = false;
        }
        return base;
      }),
    );
  };

  const handleAddCommonMistakes = () => {
    if (items.length === 0) return;
    if (instantResult) {
      setIsResultStale(true);
    }
    setItems((prev) =>
      prev.map((it, idx) => {
        const orig = it.original || {
          title: it.title,
          authors_text: it.authors_text,
          year: it.year,
          venue: it.venue,
          doi: it.doi,
        };
        const origYr = parseInt(orig.year, 10) || 2020;
        const cleanItem: SandboxAclPaperItem = {
          ...it,
          title: orig.title,
          authors_text: orig.authors_text,
          authors: orig.authors_text
            .split(/[;,]/)
            .map((s) => s.trim())
            .filter(Boolean),
          year: orig.year,
          venue: orig.venue,
          doi: orig.doi,
          cite_in_text: true,
          include_in_references: true,
          in_text_year_override: '',
          mutation_preset: 'clean',
        };
        if (idx === 1) {
          return {
            ...cleanItem,
            year: String(origYr >= 2023 ? origYr - 4 : origYr + 3),
            mutation_preset: 'wrong_year',
          };
        }
        if (idx === 2) {
          return {
            ...cleanItem,
            authors_text: 'Michael Anderson; Elena Rostova',
            authors: ['Michael Anderson', 'Elena Rostova'],
            mutation_preset: 'wrong_author',
          };
        }
        if (idx === 3) {
          return {
            ...cleanItem,
            title:
              'Autonomous Quantum Hyper-Graph Transformers for Symbolic Reasoning',
            authors_text: 'Jonathan Sterling; Victoria Vance',
            authors: ['Jonathan Sterling', 'Victoria Vance'],
            year: '2025',
            venue: 'Journal of Non-Existent Computational Intelligence',
            doi: '10.9999/fake.sample.2025.404',
            mutation_preset: 'hallucinated',
          };
        }
        if (idx === 4) {
          return {
            ...cleanItem,
            in_text_year_override: String(Math.max(1995, origYr - 12)),
            mutation_preset: 'year_mismatch_intext',
          };
        }
        if (idx === 5) {
          return {
            ...cleanItem,
            cite_in_text: false,
            include_in_references: true,
            mutation_preset: 'uncited_ref',
          };
        }
        if (idx === 6) {
          return {
            ...cleanItem,
            cite_in_text: true,
            include_in_references: false,
            mutation_preset: 'orphan_intext',
          };
        }
        return cleanItem;
      }),
    );
    toast.success(
      isVi
        ? 'Đã thêm bộ lỗi trích dẫn phổ biến vào bài mẫu (sai năm, sai tác giả, không tìm thấy nguồn, lệch năm trong bài, chưa trích dẫn và thiếu ở danh mục).'
        : 'Added common citation mistakes to the sample paper (wrong year, wrong author, source not found, in-text year mismatch, uncited reference, and missing reference).',
    );
  };

  const handleGenerateAndVerifyPdf = async () => {
    if (items.length === 0) return;
    if (
      user?.quota &&
      user.quota.monthly_uploads_limit > 0 &&
      user.quota.monthly_uploads_remaining <= 0
    ) {
      setUpgradeOpen(true);
      return;
    }
    setGeneratingPdf(true);
    try {
      const res = await api.generateSandboxPdfManuscript({
        title: manuscriptTitle,
        style,
        items,
        run_verification: true,
      });
      syncSingleCheckFromStatus(
        res.essay_id,
        {
          status: res.status === 'completed' ? 'completed' : 'queued',
          step: 'parsing',
          step_index: 0,
          total_steps: 8,
          message: isVi
            ? 'Đang tạo và kiểm chứng bản thảo PDF mẫu...'
            : 'Building & verifying sample PDF manuscript...',
          citations_found: res.in_text_count ?? 0,
          references_found: res.references_count ?? 0,
          linked: 0,
          sources_queried: {},
          elapsed_seconds: 0,
          finished_at: null,
          error: null,
        },
        res.filename || manuscriptTitle,
      );
      void refreshUser();
      toast.success(
        isVi
          ? `Đã tạo bản thảo PDF mẫu (${res.num_pages} trang · ${res.in_text_count} trích dẫn trong bài · ${res.references_count} mục tham khảo) và bắt đầu kiểm chứng.`
          : `Built ${res.num_pages}-page sample PDF manuscript and started full verification.`,
      );
      navigate(`/verification/processing/${res.essay_id}`);
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e ?? '');
      if (/402|MONTHLY_QUOTA_EXCEEDED/i.test(errMsg)) {
        setGeneratingPdf(false);
        setUpgradeOpen(true);
        return;
      }
      toast.error(
        formatUserError(
          e,
          lang,
          isVi
            ? 'Không thể tạo tệp PDF mẫu. Vui lòng thử lại.'
            : 'Failed to generate sample PDF manuscript.',
        ),
      );
      setGeneratingPdf(false);
    }
  };

  const handleDownloadPdfOnly = async () => {
    if (items.length === 0) return;
    setDownloadingPdf(true);
    try {
      await api.downloadSandboxPdfManuscript({
        title: manuscriptTitle,
        style,
        items,
      });
      toast.success(
        isVi
          ? 'Đã tải xuống tệp PDF bài mẫu học thuật (gồm trích dẫn trong bài và danh mục tham khảo).'
          : 'Downloaded sample academic PDF manuscript.',
      );
    } catch (e) {
      toast.error(
        formatUserError(
          e,
          lang,
          isVi
            ? 'Không thể tải xuống tệp PDF mẫu.'
            : 'Failed to download sample PDF manuscript.',
        ),
      );
    } finally {
      setDownloadingPdf(false);
    }
  };

  const handleInstantVerify = async () => {
    if (mode === 'raw_paste' && !rawRefsText.trim()) return;
    setVerifyingInstant(true);
    setInstantResult(null);
    setIsResultStale(false);
    setExpandedTechCards({});
    const submittedText = rawRefsText;
    try {
      const payload =
        mode === 'acl_studio' && items.length > 0
          ? { style, items, lang }
          : { style, references_text: submittedText, lang };
      const res = await api.verifySandboxCitationsInstant(payload);
      setInstantResult(res);
      if (mode === 'raw_paste') {
        setLastVerifiedText(submittedText);
      }
    } catch (e) {
      toast.error(
        formatUserError(
          e,
          lang,
          isVi
            ? 'Không thể kiểm tra nhanh trích dẫn. Vui lòng thử lại.'
            : 'Quick verification failed. Please try again.',
        ),
      );
    } finally {
      setVerifyingInstant(false);
    }
  };

  const toggleTechCard = (key: string) => {
    setExpandedTechCards((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const presetBadge = (preset?: string) => {
    switch (preset) {
      case 'wrong_year':
        return (
          <span className="px-2 py-0.5 rounded-md text-[10px] font-mono font-semibold bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 border border-amber-300 dark:border-amber-800">
            {isVi ? 'Sai năm xuất bản' : 'Wrong Year'}
          </span>
        );
      case 'wrong_author':
        return (
          <span className="px-2 py-0.5 rounded-md text-[10px] font-mono font-semibold bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 border border-amber-300 dark:border-amber-800">
            {isVi ? 'Sai tác giả' : 'Wrong Author'}
          </span>
        );
      case 'hallucinated':
        return (
          <span className="px-2 py-0.5 rounded-md text-[10px] font-mono font-semibold bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300 border border-red-300 dark:border-red-800">
            {isVi ? 'Không tìm thấy nguồn' : 'Source Not Found'}
          </span>
        );
      case 'year_mismatch_intext':
        return (
          <span className="px-2 py-0.5 rounded-md text-[10px] font-mono font-semibold bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300 border border-violet-300 dark:border-violet-800">
            {isVi ? 'Lệch năm trong bài' : 'In-text Year Mismatch'}
          </span>
        );
      case 'uncited_ref':
        return (
          <span className="px-2 py-0.5 rounded-md text-[10px] font-mono font-semibold bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300 border border-orange-300 dark:border-orange-800">
            {isVi ? 'Chưa trích dẫn trong bài' : 'Uncited Reference'}
          </span>
        );
      case 'orphan_intext':
        return (
          <span className="px-2 py-0.5 rounded-md text-[10px] font-mono font-semibold bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300 border border-rose-300 dark:border-rose-800">
            {isVi ? 'Thiếu ở danh mục tham khảo' : 'Missing Reference'}
          </span>
        );
      default:
        return (
          <span className="px-2 py-0.5 rounded-md text-[10px] font-mono font-semibold bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800">
            {isVi ? 'Bản gốc ACL' : 'Canonical ACL'}
          </span>
        );
    }
  };

  const renderVerdictPill = (
    label: string,
    triggeredRules: string[] | undefined,
    isInvalidInput?: boolean,
  ) => {
    if (isInvalidInput) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10.5px] font-semibold border bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/70 dark:text-amber-200 dark:border-amber-800 whitespace-nowrap">
          <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden="true" />
          <span>
            {isVi
              ? 'Đầu vào chưa phải định dạng trích dẫn'
              : 'Input does not look like a citation'}
          </span>
        </span>
      );
    }

    const canonical = normalizeVerdictKey(label);
    const display = getVerdictDisplay(label, lang);
    const isIncomplete =
      canonical === 'metadata_error' &&
      Boolean(triggeredRules?.includes('R-INCOMPLETE-METADATA'));
    const isLegal =
      canonical === 'resource' &&
      isLegalStatuteVerdict({ label, triggered_rules: triggeredRules });

    if (isLegal) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10.5px] font-semibold border bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950/70 dark:text-indigo-300 dark:border-indigo-800 whitespace-nowrap">
          <Scale className="h-3 w-3 shrink-0" aria-hidden="true" />
          <span>{isVi ? 'Văn bản Pháp luật' : 'Legal Statute'}</span>
        </span>
      );
    }

    if (isIncomplete) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10.5px] font-semibold border bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/70 dark:text-amber-300 dark:border-amber-800 whitespace-nowrap">
          <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden="true" />
          <span>{isVi ? 'Thiếu quy cách trích dẫn' : 'Incomplete Reference'}</span>
        </span>
      );
    }

    const Icon =
      canonical === 'verified'
        ? CheckCircle2
        : canonical === 'metadata_error'
          ? AlertTriangle
          : canonical === 'suspected_hallucination'
            ? XCircle
            : canonical === 'resource'
              ? Link2
              : HelpCircle;

    return (
      <span
        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10.5px] font-semibold border whitespace-nowrap ${display.pillClass}`}
      >
        <Icon className="h-3 w-3 shrink-0" aria-hidden="true" />
        <span>{display.label}</span>
      </span>
    );
  };

  return (
    <Card
      data-testid="live-citation-sandbox"
      className="p-0 overflow-hidden rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm"
    >
      {/* Top Studio Header */}
      <div
        data-testid="sandbox-studio-header"
        className="px-4 sm:px-5 py-4 sm:py-5 bg-gradient-to-r from-slate-50 via-white to-slate-100/80 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950 text-slate-900 dark:text-slate-50 flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-slate-200/90 dark:border-slate-800 transition-colors"
      >
        <div className="flex items-start sm:items-center gap-3 min-w-0">
          <div className="h-9 w-9 sm:h-10 sm:w-10 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200/90 dark:border-slate-700 flex items-center justify-center shrink-0">
            <Sparkles className="h-4 w-4 sm:h-5 sm:w-5 text-slate-800 dark:text-slate-200" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-base sm:text-lg font-display font-bold tracking-tight leading-snug text-slate-900 dark:text-slate-50">
                {isVi
                  ? 'Kiểm tra nhanh & Tạo bài mẫu thử nghiệm'
                  : 'Quick Citation Check & Sample Paper Builder'}
              </h1>
              <Badge
                data-testid="sandbox-corpus-badge"
                className="bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/80 dark:text-emerald-300 dark:border-emerald-800 font-mono text-[10px]"
              >
                {mode === 'acl_studio'
                  ? isVi
                    ? '128.000+ bài báo học thuật'
                    : '128K+ scholarly papers'
                  : isVi
                    ? '15+ thư viện học thuật'
                    : '15+ academic libraries'}
              </Badge>
            </div>
            <p
              data-testid="sandbox-studio-subtitle"
              className="text-[11px] sm:text-xs text-slate-600 dark:text-slate-300 mt-0.5 leading-relaxed"
            >
              {mode === 'acl_studio'
                ? isVi
                  ? 'Lấy ngẫu nhiên 10–20 bài báo thật từ kho 128.000+ bài báo học thuật, tùy chỉnh thông tin hoặc liên kết trích dẫn và xuất tệp PDF mẫu để chạy thử kiểm chứng.'
                  : 'Sample 10–20 real papers from the 128K+ scholarly papers corpus, edit citation details or linking live, and build a sample academic PDF to test verification.'
                : isVi
                  ? 'Dán trực tiếp danh sách tài liệu tham khảo (APA, IEEE, Vancouver hoặc BibTeX) để đối chiếu nhanh trên hơn 15 thư viện học thuật chỉ trong vài giây.'
                  : 'Paste your reference list (APA, IEEE, Vancouver, or BibTeX) to cross-check citations across 15+ academic libraries in seconds.'}
            </p>
          </div>
        </div>

        {/* Mode Switcher */}
        <div
          data-testid="sandbox-mode-switcher"
          className="flex sm:inline-flex w-full md:w-auto items-center p-1 rounded-xl bg-slate-100 dark:bg-slate-800/90 border border-slate-200/90 dark:border-slate-700 gap-1 shrink-0 self-start md:self-auto"
        >
          <button
            type="button"
            data-testid="sandbox-mode-acl-btn"
            aria-pressed={mode === 'acl_studio'}
            onClick={() => handleModeSwitch('acl_studio')}
            className={`min-w-0 flex-1 sm:flex-initial text-center px-2.5 py-2 rounded-lg text-xs sm:text-sm font-semibold whitespace-nowrap truncate transition-all cursor-pointer ${
              mode === 'acl_studio'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
            }`}
          >
            {isVi ? 'Tạo bài mẫu PDF' : 'Sample PDF'}
          </button>
          <button
            type="button"
            data-testid="sandbox-mode-raw-btn"
            aria-pressed={mode === 'raw_paste'}
            onClick={() => handleModeSwitch('raw_paste')}
            className={`min-w-0 flex-1 sm:flex-initial text-center px-2.5 py-2 rounded-lg text-xs sm:text-sm font-semibold whitespace-nowrap truncate transition-all cursor-pointer ${
              mode === 'raw_paste'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
            }`}
          >
            {isVi ? 'Kiểm tra nhanh' : 'Quick Check'}
          </button>
        </div>
      </div>

      <div className="p-3.5 sm:p-6 space-y-4 sm:space-y-5">
        {mode === 'acl_studio' ? (
          <>
            {/* Control Bar: Count, Style, Random Sample Button & Common Mistakes Injector */}
            <div className="p-3.5 sm:p-4 rounded-2xl bg-slate-50 dark:bg-slate-950/70 border border-slate-200/90 dark:border-slate-800 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:flex lg:flex-wrap items-stretch sm:items-center gap-2.5 w-full lg:w-auto min-w-0 max-w-full">
                <div className="flex items-center justify-between sm:justify-start gap-2 w-full sm:w-auto min-w-0 max-w-full">
                  <label className="w-[68px] sm:w-auto whitespace-nowrap text-xs font-mono font-semibold text-slate-600 dark:text-slate-300 shrink-0">
                    {isVi ? 'Số lượng:' : 'Papers:'}
                  </label>
                  <select
                    data-testid="sandbox-acl-count-select"
                    aria-label={
                      isVi
                        ? 'Số lượng bài báo học thuật lấy mẫu'
                        : 'Number of scholarly papers to sample'
                    }
                    value={sampleCount}
                    onChange={(e) => setSampleCount(Number(e.target.value))}
                    className="h-9 pl-2.5 pr-8 rounded-xl text-xs font-mono font-semibold bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 flex-1 sm:flex-initial min-w-0 max-w-full"
                  >
                    <option value={10}>{isVi ? '10 bài báo học thuật' : '10 Scholarly Papers'}</option>
                    <option value={12}>{isVi ? '12 bài báo học thuật' : '12 Scholarly Papers'}</option>
                    <option value={15}>{isVi ? '15 bài báo học thuật' : '15 Scholarly Papers'}</option>
                    <option value={20}>{isVi ? '20 bài báo học thuật' : '20 Scholarly Papers'}</option>
                  </select>
                </div>

                <div className="flex items-center justify-between sm:justify-start gap-2 w-full sm:w-auto min-w-0 max-w-full">
                  <label className="w-[68px] sm:w-auto whitespace-nowrap text-xs font-mono font-semibold text-slate-600 dark:text-slate-300 shrink-0">
                    {isVi ? 'Chuẩn:' : 'Style:'}
                  </label>
                  <select
                    data-testid="sandbox-acl-style-select"
                    aria-label={
                      isVi
                        ? 'Chuẩn trích dẫn cho tệp PDF'
                        : 'Target citation style for generated PDF'
                    }
                    value={style}
                    onChange={(e) => setStyle(e.target.value as 'apa' | 'ieee')}
                    className="h-9 pl-2.5 pr-8 rounded-xl text-xs font-mono font-semibold bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 flex-1 sm:flex-initial min-w-0 max-w-full"
                  >
                    <option value="apa">APA 7th (Author-Year)</option>
                    <option value="ieee">IEEE Numeric [1]..[N]</option>
                  </select>
                </div>

                <Button
                  type="button"
                  data-testid="sandbox-random-acl-btn"
                  disabled={loadingSample}
                  onClick={() => void handleSampleRandomAcl()}
                  className="w-full sm:col-span-2 lg:w-auto h-auto min-h-9 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold shadow-sm whitespace-normal text-center leading-snug max-w-full"
                >
                  {loadingSample ? (
                    <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                  ) : (
                    <Shuffle className="h-4 w-4 shrink-0" />
                  )}
                  <span>
                    {isVi
                      ? `Lấy ngẫu nhiên ${sampleCount} bài báo`
                      : `Sample ${sampleCount} Random Papers`}
                  </span>
                </Button>
              </div>

              {items.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 min-w-0 max-w-full">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    data-testid="sandbox-auto-inject-suite-btn"
                    onClick={handleAddCommonMistakes}
                    className="w-full sm:w-auto h-auto min-h-9 py-2 rounded-xl text-xs font-mono font-semibold border-amber-300 dark:border-amber-700 bg-amber-50/80 dark:bg-amber-950/50 text-amber-800 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-950 whitespace-normal text-left leading-snug max-w-full"
                  >
                    <Wand2 className="h-3.5 w-3.5 text-amber-600 dark:text-amber-300 shrink-0" />
                    <span>
                      {isVi
                        ? 'Tạo nhanh bài mẫu có lỗi phổ biến'
                        : 'Add Common Citation Mistakes'}
                    </span>
                  </Button>
                </div>
              )}
            </div>

            {items.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 p-5 sm:p-8 text-center bg-slate-50/50 dark:bg-slate-950/30">
                <BookOpen className="h-8 w-8 sm:h-9 sm:w-9 text-indigo-500 mx-auto mb-2 opacity-85" />
                <p className="text-sm font-display font-bold text-slate-800 dark:text-slate-200 leading-snug">
                  {isVi
                    ? `Nhấn "Lấy ngẫu nhiên ${sampleCount} bài báo" ở trên để tải danh sách bài báo mẫu`
                    : `Click "Sample ${sampleCount} Random Papers" above to load real papers from the scholarly corpus`}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5 max-w-xl mx-auto leading-relaxed">
                  {isVi
                    ? 'Sau khi tải 10–20 bài báo thật từ kho bài báo học thuật, bạn có thể chỉnh sửa năm, tác giả, tiêu đề, mã DOI hoặc bật/tắt liên kết trích dẫn rồi tạo tệp PDF mẫu để thử nghiệm toàn bộ quy trình kiểm chứng.'
                    : 'Once loaded, you can edit any metadata field or toggle in-text ↔ bibliography links, then build a sample PDF manuscript to run through the full verification workflow.'}
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Manuscript Title Bar */}
                <div className="flex flex-col sm:flex-row sm:items-center gap-2 bg-slate-50/70 dark:bg-slate-900/60 p-3 rounded-xl border border-slate-200 dark:border-slate-800">
                  <span className="text-xs font-mono font-semibold text-slate-600 dark:text-slate-400 shrink-0">
                    {isVi ? 'Tiêu đề bài mẫu PDF:' : 'Sample PDF Title:'}
                  </span>
                  <input
                    type="text"
                    data-testid="sandbox-manuscript-title-input"
                    value={manuscriptTitle}
                    onChange={(e) => setManuscriptTitle(e.target.value)}
                    className="w-full sm:flex-1 h-9 px-3 rounded-lg text-xs font-medium bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white"
                  />
                </div>

                {/* Editable List of 10-20 Sampled ACL Papers */}
                <div
                  data-testid="sandbox-acl-items-list"
                  className="max-h-[460px] overflow-y-auto space-y-3 pr-1"
                >
                  {items.map((it, idx) => (
                    <div
                      key={`${it.paper_id ?? idx}-${idx}`}
                      data-testid={`sandbox-paper-card-${idx}`}
                      className={`p-3.5 rounded-xl border transition-all ${
                        it.mutation_preset && it.mutation_preset !== 'clean'
                          ? 'bg-amber-50/40 dark:bg-amber-950/20 border-amber-300/90 dark:border-amber-800/80'
                          : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800'
                      }`}
                    >
                      {/* Row Top: Index + Preset Status Badge + Quick Edit Presets */}
                      <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="px-2 py-0.5 rounded-md text-xs font-mono font-bold bg-indigo-600 text-white">
                            #{idx + 1}
                          </span>
                          {presetBadge(it.mutation_preset)}
                          {it.paper_id && (
                            <span className="text-[10px] font-mono text-slate-400">
                              ACL #{it.paper_id}
                            </span>
                          )}
                        </div>

                        {/* Quick 1-Click Scenario Presets */}
                        <div className="flex flex-wrap items-center gap-1">
                          <button
                            type="button"
                            data-testid={`sandbox-preset-clean-${idx}`}
                            onClick={() => applyItemPreset(idx, 'clean')}
                            className="px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-slate-100 hover:bg-emerald-100 text-slate-700 hover:text-emerald-800 dark:bg-slate-800 dark:text-slate-300 transition-colors cursor-pointer"
                            title={
                              isVi
                                ? 'Khôi phục dữ liệu gốc từ kho bài báo học thuật'
                                : 'Restore canonical scholarly record'
                            }
                          >
                            <RotateCcw className="h-2.5 w-2.5 inline mr-0.5" />
                            {isVi ? 'Bản gốc ACL' : 'Canonical ACL'}
                          </button>
                          <button
                            type="button"
                            data-testid={`sandbox-preset-wrong-year-${idx}`}
                            onClick={() => applyItemPreset(idx, 'wrong_year')}
                            className="px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-amber-100/80 hover:bg-amber-200 text-amber-900 dark:bg-amber-950 dark:text-amber-300 transition-colors cursor-pointer"
                          >
                            {isVi ? 'Sai năm' : 'Wrong Year'}
                          </button>
                          <button
                            type="button"
                            data-testid={`sandbox-preset-wrong-author-${idx}`}
                            onClick={() => applyItemPreset(idx, 'wrong_author')}
                            className="px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-amber-100/80 hover:bg-amber-200 text-amber-900 dark:bg-amber-950 dark:text-amber-300 transition-colors cursor-pointer"
                          >
                            {isVi ? 'Sai tác giả' : 'Wrong Author'}
                          </button>
                          <button
                            type="button"
                            data-testid={`sandbox-preset-hallucinated-${idx}`}
                            onClick={() => applyItemPreset(idx, 'hallucinated')}
                            className="px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-red-100/90 hover:bg-red-200 text-red-900 dark:bg-red-950 dark:text-red-300 transition-colors cursor-pointer"
                          >
                            {isVi ? 'Nguồn không có thật' : 'Unfound Source'}
                          </button>
                          <button
                            type="button"
                            data-testid={`sandbox-preset-intext-mismatch-${idx}`}
                            onClick={() => applyItemPreset(idx, 'year_mismatch_intext')}
                            className="px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-violet-100/90 hover:bg-violet-200 text-violet-900 dark:bg-violet-950 dark:text-violet-300 transition-colors cursor-pointer"
                          >
                            {isVi ? 'Lệch năm trong bài' : 'In-text Year Drift'}
                          </button>
                          <button
                            type="button"
                            data-testid={`sandbox-preset-uncited-${idx}`}
                            onClick={() => applyItemPreset(idx, 'uncited_ref')}
                            className="px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-orange-100/90 hover:bg-orange-200 text-orange-900 dark:bg-orange-950 dark:text-orange-300 transition-colors cursor-pointer"
                          >
                            {isVi ? 'Chưa trích dẫn' : 'Uncited Ref'}
                          </button>
                          <button
                            type="button"
                            data-testid={`sandbox-preset-orphan-${idx}`}
                            onClick={() => applyItemPreset(idx, 'orphan_intext')}
                            className="px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-rose-100/90 hover:bg-rose-200 text-rose-900 dark:bg-rose-950 dark:text-rose-300 transition-colors cursor-pointer"
                          >
                            {isVi ? 'Thiếu ở danh mục' : 'Missing Ref'}
                          </button>
                        </div>
                      </div>

                      {/* Editable Metadata Inputs */}
                      <div className="grid grid-cols-1 md:grid-cols-12 gap-2">
                        <div className="md:col-span-5">
                          <label className="block text-[10px] font-mono uppercase text-slate-500 mb-0.5">
                            {isVi ? 'Tiêu đề bài báo' : 'Title'}
                          </label>
                          <input
                            type="text"
                            data-testid={`sandbox-item-title-${idx}`}
                            value={it.title}
                            onChange={(e) => updateItemField(idx, 'title', e.target.value)}
                            className="w-full h-8 px-2.5 rounded-lg text-xs font-medium bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white"
                          />
                        </div>
                        <div className="md:col-span-3">
                          <label className="block text-[10px] font-mono uppercase text-slate-500 mb-0.5">
                            {isVi ? 'Tác giả (cách nhau bởi ;)' : 'Authors (; separated)'}
                          </label>
                          <input
                            type="text"
                            data-testid={`sandbox-item-authors-${idx}`}
                            value={it.authors_text}
                            onChange={(e) => updateItemField(idx, 'authors_text', e.target.value)}
                            className="w-full h-8 px-2.5 rounded-lg text-xs font-mono bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white"
                          />
                        </div>
                        <div className="md:col-span-1">
                          <label className="block text-[10px] font-mono uppercase text-slate-500 mb-0.5">
                            {isVi ? 'Năm' : 'Year'}
                          </label>
                          <input
                            type="text"
                            data-testid={`sandbox-item-year-${idx}`}
                            value={it.year}
                            onChange={(e) => updateItemField(idx, 'year', e.target.value)}
                            className="w-full h-8 px-2 rounded-lg text-xs font-mono font-bold text-center bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white"
                          />
                        </div>
                        <div className="md:col-span-3">
                          <label className="block text-[10px] font-mono uppercase text-slate-500 mb-0.5">
                            {isVi ? 'DOI / Mã định danh' : 'DOI / Identifier'}
                          </label>
                          <input
                            type="text"
                            data-testid={`sandbox-item-doi-${idx}`}
                            value={it.doi}
                            onChange={(e) => updateItemField(idx, 'doi', e.target.value)}
                            className="w-full h-8 px-2.5 rounded-lg text-xs font-mono bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white"
                          />
                        </div>
                      </div>

                      {/* In-Text <-> References Controls */}
                      <div className="mt-2 pt-2 border-t border-slate-100 dark:border-slate-800/80 flex flex-wrap items-center justify-between gap-3 text-xs">
                        <div className="flex flex-wrap items-center gap-4">
                          <label className="inline-flex items-center gap-1.5 cursor-pointer font-mono text-[11px] text-slate-700 dark:text-slate-300">
                            <input
                              type="checkbox"
                              data-testid={`sandbox-item-cite-intext-${idx}`}
                              checked={it.cite_in_text}
                              onChange={(e) =>
                                updateItemField(idx, 'cite_in_text', e.target.checked)
                              }
                              className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                            />
                            <Link2 className="h-3 w-3 text-indigo-500" />
                            <span>
                              {isVi ? 'Có trích dẫn trong bài viết' : 'Cited in Body Text'}
                            </span>
                          </label>

                          <label className="inline-flex items-center gap-1.5 cursor-pointer font-mono text-[11px] text-slate-700 dark:text-slate-300">
                            <input
                              type="checkbox"
                              data-testid={`sandbox-item-inc-ref-${idx}`}
                              checked={it.include_in_references}
                              onChange={(e) =>
                                updateItemField(idx, 'include_in_references', e.target.checked)
                              }
                              className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                            />
                            <BookOpen className="h-3 w-3 text-emerald-500" />
                            <span>
                              {isVi ? 'Có trong Danh mục tham khảo' : 'Included in Bibliography'}
                            </span>
                          </label>
                        </div>

                        <div className="flex flex-wrap items-center justify-between gap-2 w-full sm:w-auto">
                          <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                            {isVi
                              ? 'Năm ghi trong đoạn văn (tùy chọn):'
                              : 'In-text year override (optional):'}
                          </span>
                          <input
                            type="text"
                            placeholder={it.year}
                            data-testid={`sandbox-item-intext-year-${idx}`}
                            value={it.in_text_year_override}
                            onChange={(e) =>
                              updateItemField(idx, 'in_text_year_override', e.target.value)
                            }
                            className="w-20 h-8 px-2 rounded-md text-xs font-mono text-center bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white shrink-0"
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Action Footer for Mode A */}
                <div className="p-4 rounded-2xl bg-gradient-to-r from-slate-50 via-white to-slate-100/80 dark:from-slate-950/60 dark:via-slate-900 dark:to-slate-950/60 border border-slate-200/90 dark:border-slate-800 flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3">
                  <div className="text-xs font-mono text-slate-700 dark:text-slate-300 space-y-0.5">
                    <div>
                      <strong>{items.filter((i) => i.cite_in_text).length}</strong>{' '}
                      {isVi
                        ? 'trích dẫn trong bài ↔'
                        : 'in-text citations in body ↔'}{' '}
                      <strong>{items.filter((i) => i.include_in_references).length}</strong>{' '}
                      {isVi
                        ? 'mục trong danh mục tham khảo'
                        : 'entries in bibliography'}
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">
                      {isVi
                        ? 'Hệ thống tạo tệp PDF học thuật mẫu (3 phần + danh mục cuối bài) để kiểm tra cả liên kết trong bài và đối chiếu 15+ thư viện.'
                        : 'Builds a complete 3-section academic PDF sample + reference list to verify both in-text linking and 15+ academic libraries.'}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2.5 min-w-0 max-w-full">
                    <Button
                      type="button"
                      variant="outline"
                      data-testid="sandbox-download-pdf-btn"
                      disabled={downloadingPdf || generatingPdf}
                      onClick={() => void handleDownloadPdfOnly()}
                      className="w-full sm:w-auto h-auto min-h-10 py-2.5 px-3.5 rounded-xl text-xs font-mono font-semibold border-slate-300 dark:border-slate-700 whitespace-normal text-center leading-snug max-w-full"
                    >
                      {downloadingPdf ? (
                        <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                      ) : (
                        <Download className="h-4 w-4 text-slate-700 dark:text-slate-200 shrink-0" />
                      )}
                      <span>
                        {isVi ? 'Tải tệp PDF mẫu (.PDF)' : 'Download Sample .PDF'}
                      </span>
                    </Button>

                    <Button
                      type="button"
                      variant="outline"
                      data-testid="sandbox-verify-submit-btn"
                      disabled={verifyingInstant || generatingPdf}
                      onClick={() => void handleInstantVerify()}
                      className="w-full sm:w-auto h-auto min-h-10 py-2.5 px-3.5 rounded-xl text-xs font-mono font-semibold border-indigo-300 dark:border-indigo-700 text-indigo-700 dark:text-indigo-300 whitespace-normal text-center leading-snug max-w-full"
                    >
                      {verifyingInstant ? (
                        <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                      ) : (
                        <Zap className="h-4 w-4 text-amber-500 shrink-0" />
                      )}
                      <span>
                        {verifyingInstant
                          ? isVi
                            ? 'Đang kiểm tra...'
                            : 'Checking...'
                          : isVi
                            ? 'Kiểm tra nhanh'
                            : 'Quick Check'}
                      </span>
                    </Button>

                    <Button
                      type="button"
                      data-testid="sandbox-generate-verify-pdf-btn"
                      disabled={generatingPdf}
                      onClick={() => void handleGenerateAndVerifyPdf()}
                      className="w-full sm:w-auto h-auto min-h-10 py-2.5 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold shadow-md shadow-indigo-600/20 whitespace-normal text-center leading-snug max-w-full"
                    >
                      {generatingPdf ? (
                        <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                      ) : (
                        <FileText className="h-4 w-4 shrink-0" />
                      )}
                      <span>
                        {isVi
                          ? 'Tạo PDF mẫu & Chạy kiểm chứng đầy đủ'
                          : 'Generate Sample PDF & Run Full Check'}
                      </span>
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </>
        ) : (
          /* Mode B: Raw Text / BibTeX Quick Paste Check */
          <div className="space-y-3">
            <label
              htmlFor="sandbox-raw-textarea-input"
              className="block text-xs font-mono font-semibold text-slate-700 dark:text-slate-300"
            >
              {isVi
                ? 'Dán danh sách Tài liệu tham khảo (APA, IEEE, Vancouver) hoặc BibTeX để kiểm tra nhanh:'
                : 'Paste reference entries (APA, IEEE, Vancouver) or BibTeX for quick verification:'}
            </label>
            <textarea
              id="sandbox-raw-textarea-input"
              data-testid="sandbox-raw-textarea"
              rows={5}
              value={rawRefsText}
              onChange={(e) => handleRawTextChange(e.target.value)}
              placeholder={
                isVi
                  ? 'Ví dụ: Vaswani, A., et al. (2017). Attention Is All You Need. NeurIPS. https://doi.org/10.48550/arXiv.1706.03762'
                  : 'Example: Vaswani, A., et al. (2017). Attention Is All You Need. NeurIPS. https://doi.org/10.48550/arXiv.1706.03762'
              }
              className="w-full p-3.5 rounded-xl font-mono text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
            />
            {!rawRefsText.trim() && (
              <p
                data-testid="sandbox-raw-empty-hint"
                className="text-xs text-slate-500 dark:text-slate-400"
              >
                {isVi
                  ? 'Hãy dán ít nhất một trích dẫn học thuật (APA, IEEE, Vancouver hoặc BibTeX) để bắt đầu kiểm tra.'
                  : 'Paste at least one academic citation (APA, IEEE, Vancouver, or BibTeX) to start checking.'}
              </p>
            )}
            <div className="flex flex-wrap items-center justify-between gap-2">
              {rawRefsText !== DEFAULT_RAW_REFS_SAMPLE ? (
                <button
                  type="button"
                  onClick={() => handleRawTextChange(DEFAULT_RAW_REFS_SAMPLE)}
                  className="text-xs font-mono text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 underline underline-offset-4 cursor-pointer"
                >
                  {isVi ? 'Dùng lại 3 trích dẫn mẫu' : 'Restore 3 sample citations'}
                </button>
              ) : (
                <span />
              )}
              <Button
                type="button"
                data-testid="sandbox-verify-submit-btn"
                disabled={verifyingInstant || !rawRefsText.trim()}
                onClick={() => void handleInstantVerify()}
                className="h-10 px-5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold"
              >
                {verifyingInstant ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Zap className="h-4 w-4 text-amber-300" />
                )}
                <span>
                  {verifyingInstant
                    ? isVi
                      ? 'Đang kiểm tra...'
                      : 'Checking...'
                    : isVi
                      ? 'Kiểm tra trích dẫn ngay'
                      : 'Check Citations Now'}
                </span>
              </Button>
            </div>
          </div>
        )}

        {/* Instant Verification Loading Skeleton & Results Panel */}
        <CardResize>
          <AnimatePresence mode="wait">
            {verifyingInstant && (
              <m.div
                key="sandbox-verifying-skeleton"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0, transition: TRANSITION_ENTER }}
                exit={{ opacity: 0, y: -4, transition: TRANSITION_EXIT }}
                data-testid="sandbox-verifying-skeleton"
                role="status"
                aria-live="polite"
                className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-800 space-y-3"
              >
                <div className="flex items-center gap-2 text-xs font-mono text-slate-600 dark:text-slate-300">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-indigo-600 dark:text-indigo-400" />
                  <span>
                    {isVi
                      ? 'Đang đối chiếu trích dẫn trên 15+ thư viện học thuật...'
                      : 'Cross-checking citations across 15+ academic libraries...'}
                  </span>
                </div>
                <div className="space-y-2 animate-pulse">
                  {[0, 1].map((idx) => (
                    <div
                      key={idx}
                      className="p-3.5 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/50 space-y-2"
                    >
                      <div className="flex items-center gap-2">
                        <div className="h-4 w-10 rounded bg-slate-200 dark:bg-slate-800" />
                        <div className="h-4 w-28 rounded-full bg-slate-200 dark:bg-slate-800" />
                      </div>
                      <div className="h-3 w-4/5 rounded bg-slate-200/80 dark:bg-slate-800/80" />
                      <div className="h-3 w-2/3 rounded bg-slate-200/60 dark:bg-slate-800/60" />
                    </div>
                  ))}
                </div>
              </m.div>
            )}

            {!verifyingInstant && instantResult && (
              <m.div
                key="sandbox-instant-results"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0, transition: TRANSITION_ENTER }}
                exit={{ opacity: 0, y: -4, transition: TRANSITION_EXIT }}
                data-testid="sandbox-instant-results"
                data-stale={isResultStale ? 'true' : 'false'}
                className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-800 space-y-3"
              >
                {isResultStale && (
                  <div
                    role="status"
                    data-testid="sandbox-stale-banner"
                    className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50/90 dark:bg-amber-950/60 text-xs text-amber-900 dark:text-amber-200"
                  >
                    <span className="inline-flex items-center gap-1.5">
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      <span>
                        {isVi
                          ? 'Nội dung đã thay đổi — kết quả bên dưới thuộc lần kiểm tra trước. Nhấn "Kiểm tra" để cập nhật.'
                          : 'Input has changed — the results below are from a previous check. Run verification again to refresh.'}
                      </span>
                    </span>
                  </div>
                )}

                <div
                  className={
                    isResultStale
                      ? 'space-y-3 opacity-50 pointer-events-none select-none transition-opacity'
                      : 'space-y-3 transition-opacity'
                  }
                >
                  {(() => {
                    const resultsList = instantResult.results ?? [];
                    const summaryMap = (instantResult.summary ?? {}) as Record<
                      string,
                      number | undefined
                    >;
                    const invalidInputCount = resultsList.filter((item) =>
                      Boolean(item.is_invalid_input),
                    ).length;
                    const allInvalidInput =
                      resultsList.length > 0 && invalidInputCount === resultsList.length;
                    const verifiedCount = summaryMap.verified ?? 0;
                    const hallucCount = summaryMap.suspected_hallucination ?? 0;
                    const rawUnresolved =
                      summaryMap.unresolved ??
                      resultsList.filter((item) => item.label === 'unresolved').length;
                    const unresolvedCount = Math.max(0, rawUnresolved - invalidInputCount);
                    const resItems = resultsList.filter((item) => item.label === 'resource');
                    const resourceTotal = summaryMap.resource ?? resItems.length;
                    const legalCount = resItems.filter((item) =>
                      isLegalStatuteVerdict(item),
                    ).length;
                    const webCount = Math.max(0, resourceTotal - legalCount);
                    const incompleteFromResults = resultsList.filter(
                      (item) =>
                        item.label === 'metadata_error' &&
                        (item.triggered_rules ?? []).includes('R-INCOMPLETE-METADATA'),
                    ).length;
                    const incompleteCount =
                      summaryMap.incomplete_metadata ?? incompleteFromResults;
                    const rawMetaErr = summaryMap.metadata_error ?? 0;
                    const totalExpected = instantResult.total ?? resultsList.length;
                    const sumIfSeparate =
                      verifiedCount +
                      rawMetaErr +
                      incompleteCount +
                      hallucCount +
                      rawUnresolved +
                      resourceTotal;
                    const metadataErrorCount =
                      incompleteCount > 0 &&
                      (summaryMap.incomplete_metadata === undefined ||
                        (totalExpected > 0 && sumIfSeparate > totalExpected))
                        ? Math.max(0, rawMetaErr - incompleteCount)
                        : rawMetaErr;

                    const hasApplicableLayer1 = resultsList.some(
                      (item) =>
                        normalizeMappingStatusKey(item.mapping_status) !== 'not_applicable',
                    );

                    const elapsedDisplay =
                      typeof instantResult.elapsed_seconds === 'number' &&
                      instantResult.elapsed_seconds < 0.1
                        ? '< 0.1s'
                        : `${Number(instantResult.elapsed_seconds ?? 0).toFixed(1)}s`;

                    const verifiedDisplay = getVerdictDisplay('verified', lang);
                    const mismatchDisplay = getVerdictDisplay('metadata_error', lang);
                    const notFoundDisplay = getVerdictDisplay('suspected_hallucination', lang);
                    const unresolvedDisplay = getVerdictDisplay('unresolved', lang);

                    return (
                      <>
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-2 text-xs font-mono">
                            <Badge
                              data-testid="sandbox-elapsed-badge"
                              className="inline-flex items-center gap-1 bg-indigo-600 text-white"
                            >
                              <Clock className="h-3 w-3 shrink-0" aria-hidden="true" />
                              <span>{elapsedDisplay}</span>
                            </Badge>

                            {!allInvalidInput && (
                              <>
                                <span className="px-2.5 py-1 rounded-lg border bg-emerald-50 border-emerald-200 dark:bg-emerald-950 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 font-semibold">
                                  {verifiedDisplay.label}: {verifiedCount}
                                </span>
                                <span className="px-2.5 py-1 rounded-lg border bg-amber-50 border-amber-200 dark:bg-amber-950 dark:border-amber-800 text-amber-800 dark:text-amber-300 font-semibold">
                                  {mismatchDisplay.label}: {metadataErrorCount}
                                </span>
                                {incompleteCount > 0 && (
                                  <span
                                    data-testid="sandbox-summary-incomplete"
                                    className="px-2.5 py-1 rounded-lg border bg-amber-100/80 border-amber-200 dark:bg-amber-950/80 dark:border-amber-800 text-amber-800 dark:text-amber-200 font-semibold"
                                  >
                                    {isVi ? 'Thiếu quy cách' : 'Incomplete Ref'}: {incompleteCount}
                                  </span>
                                )}
                                <span className="px-2.5 py-1 rounded-lg border bg-red-50 border-red-200 dark:bg-red-950 dark:border-red-800 text-red-700 dark:text-red-300 font-semibold">
                                  {notFoundDisplay.label}: {hallucCount}
                                </span>
                                {unresolvedCount > 0 && (
                                  <span
                                    data-testid="sandbox-summary-unresolved"
                                    className="px-2.5 py-1 rounded-lg border bg-slate-100 border-slate-200 dark:bg-slate-800 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-semibold"
                                  >
                                    {unresolvedDisplay.label}: {unresolvedCount}
                                  </span>
                                )}
                                {webCount > 0 && (
                                  <span
                                    data-testid="sandbox-summary-resource"
                                    className="px-2.5 py-1 rounded-lg border bg-violet-50 border-violet-200 dark:bg-violet-950 dark:border-violet-800 text-violet-700 dark:text-violet-300 font-semibold"
                                  >
                                    {isVi ? 'Nguồn Web' : 'Web Source'}: {webCount}
                                  </span>
                                )}
                                {legalCount > 0 && (
                                  <span
                                    data-testid="sandbox-summary-legal"
                                    className="px-2.5 py-1 rounded-lg border bg-indigo-50 border-indigo-200 dark:bg-indigo-950 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300 font-semibold"
                                  >
                                    {isVi ? 'Văn bản Pháp luật' : 'Legal Statute'}: {legalCount}
                                  </span>
                                )}
                              </>
                            )}

                            {invalidInputCount > 0 && (
                              <span
                                data-testid="sandbox-summary-invalid"
                                className="px-2.5 py-1 rounded-lg border bg-amber-50 border-amber-200 dark:bg-amber-950 dark:border-amber-800 text-amber-800 dark:text-amber-200 font-semibold"
                              >
                                {isVi ? 'Đầu vào chưa hợp lệ' : 'Invalid Input'}:{' '}
                                {invalidInputCount}
                              </span>
                            )}

                            {hasApplicableLayer1 && (
                              <span
                                data-testid="sandbox-summary-layer1"
                                className="px-2.5 py-1 rounded-lg border bg-violet-50 border-violet-200 dark:bg-violet-950 dark:border-violet-800 text-violet-700 dark:text-violet-300 font-semibold"
                              >
                                {isVi
                                  ? 'Lỗi liên kết trong bài ↔ danh mục'
                                  : 'In-text ↔ Ref Linking Issues'}
                                : {instantResult.summary.layer1_linking_issues}
                              </span>
                            )}
                          </div>

                          {!allInvalidInput && instantResult.remediation?.combined_bibtex && (
                            <button
                              type="button"
                              data-testid="sandbox-copy-bibtex-btn"
                              onClick={() => {
                                void navigator.clipboard.writeText(
                                  instantResult.remediation?.combined_bibtex || '',
                                );
                                setCopiedBibtex(true);
                                setTimeout(() => setCopiedBibtex(false), 2000);
                              }}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono font-semibold border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-[#FBFAF6] hover:bg-indigo-50 dark:hover:bg-slate-700 transition-colors cursor-pointer"
                            >
                              <IconSwap
                                active={copiedBibtex}
                                iconA={
                                  <Copy className="h-3.5 w-3.5 text-indigo-600 dark:text-[#FBFAF6]" />
                                }
                                iconB={
                                  <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-300" />
                                }
                              />
                              <TextMorph
                                text={
                                  copiedBibtex
                                    ? isVi
                                      ? 'Đã sao chép BibTeX!'
                                      : 'Copied BibTeX!'
                                    : isVi
                                      ? 'Sao chép BibTeX chuẩn hóa'
                                      : 'Copy Standardized BibTeX'
                                }
                              />
                            </button>
                          )}
                        </div>

                        <div className="grid grid-cols-1 gap-2 max-h-96 overflow-y-auto pr-1">
                          {resultsList.map((r, rIdx) => {
                            const cardKey = `${r.index}-${rIdx}`;
                            const isInvalid = Boolean(r.is_invalid_input);
                            const isVer = !isInvalid && r.label === 'verified';
                            const isRes = !isInvalid && r.label === 'resource';
                            const isHalluc = !isInvalid && r.label === 'suspected_hallucination';
                            const isRetracted =
                              !isInvalid &&
                              (Boolean(r.is_retracted || r.features?.is_retracted) ||
                                (r.triggered_rules ?? []).includes('R-RETRACTED-PAPER'));
                            const isUrlMismatch =
                              !isInvalid &&
                              (r.triggered_rules ?? []).includes('R-URL-CONTENT-MISMATCH');

                            const mappingKey = normalizeMappingStatusKey(r.mapping_status);
                            const isLayer1Applicable =
                              !isInvalid && mappingKey !== 'not_applicable';
                            const hasL1Issue = isLayer1Applicable && mappingKey !== 'matched';
                            const mappingDisplay = getMappingStatusDisplay(r.mapping_status, lang);

                            const rawHtmlMeta = (r.html_meta ?? r.features?.html_meta ?? null) as
                              | Record<string, unknown>
                              | null;
                            const fallbackHtmlTitle =
                              [
                                rawHtmlMeta?.page_title,
                                rawHtmlMeta?.citation_title,
                                rawHtmlMeta?.og_title,
                                rawHtmlMeta?.dc_title,
                                rawHtmlMeta?.title,
                                rawHtmlMeta?.observed_title,
                              ]
                                .find(
                                  (val): val is string =>
                                    typeof val === 'string' && val.trim().length > 0,
                                )
                                ?.trim() ?? null;
                            const extractedWeb = extractObservedWebMeta(r);
                            const observedWeb = extractedWeb?.title
                              ? extractedWeb
                              : fallbackHtmlTitle
                                ? {
                                    title: fallbackHtmlTitle,
                                    venue:
                                      extractedWeb?.venue ??
                                      (typeof rawHtmlMeta?.site_name === 'string'
                                        ? rawHtmlMeta.site_name
                                        : null),
                                    authors: extractedWeb?.authors ?? [],
                                    year: extractedWeb?.year ?? null,
                                    isArchived:
                                      extractedWeb?.isArchived ??
                                      r.url_status === 'archived_alive',
                                  }
                                : extractedWeb;
                            const nonWebSources = (r.matched_sources ?? []).filter(
                              (s) =>
                                s.source !== 'web_html_meta' && s.source !== 'wayback_html_meta',
                            );
                            const primarySource =
                              (r.matched_source &&
                              r.matched_source.source !== 'web_html_meta' &&
                              r.matched_source.source !== 'wayback_html_meta'
                                ? r.matched_source
                                : null) ??
                              (nonWebSources.length > 0 ? nonWebSources[0] : null);
                            const rawUrlStatus = r.url_status ?? r.features?.url_status;
                            const hasArchiveFallback =
                              Boolean(r.archive_url || r.features?.archive_url) ||
                              (r.triggered_rules ?? []).includes('R-WAYBACK-ARCHIVED');
                            const urlStatus =
                              rawUrlStatus === 'archived_alive' ||
                              (hasArchiveFallback &&
                                rawUrlStatus !== 'alive' &&
                                rawUrlStatus !== 'restricted_alive')
                                ? 'archived_alive'
                                : rawUrlStatus === 'alive' ||
                                    rawUrlStatus === 'restricted_alive' ||
                                    rawUrlStatus === 'dead_link' ||
                                    rawUrlStatus === 'fake_domain' ||
                                    rawUrlStatus === 'unchecked'
                                  ? rawUrlStatus
                                  : null;
                            const urlCode = r.url_status_code ?? r.features?.url_status_code;
                            const markerDisplay =
                              r.composite_label || r.sub_index || r.numeric_index != null
                                ? getCitationMarkerLabel(r, r.index ? r.index - 1 : rIdx)
                                : `#${r.index}`;

                            const verdictForExplain: Verdict = {
                              citation_id: `sandbox-${r.index}`,
                              citation_raw: r.citation_raw,
                              mapping_status: (r.mapping_status ||
                                'matched') as Verdict['mapping_status'],
                              mapping_confidence: 1,
                              label: r.label as ValidationLabel,
                              confidence: r.confidence ?? 1,
                              reasoning: r.reasoning || '',
                              triggered_rules: r.triggered_rules ?? [],
                              mismatched_fields: r.mismatched_fields ?? [],
                              matched_sources:
                                r.matched_sources ?? (r.matched_source ? [r.matched_source] : []),
                              url_status: r.url_status ?? r.features?.url_status ?? null,
                              url_status_code:
                                r.url_status_code ?? r.features?.url_status_code ?? null,
                              archive_url: r.archive_url ?? r.features?.archive_url ?? null,
                              cited_url: r.cited_url ?? null,
                              html_meta: r.html_meta ?? r.features?.html_meta ?? null,
                              is_retracted: isRetracted,
                              composite_label: r.composite_label ?? null,
                              numeric_index: r.numeric_index ?? null,
                              sub_index: r.sub_index ?? null,
                              features: r.features,
                              is_overridden: false,
                            };

                            const explanationText = isVi
                              ? r.reasoning_vi ||
                                r.reasoning ||
                                getVerdictExplanation(verdictForExplain, 'vi')
                              : r.reasoning_en ||
                                r.reasoning ||
                                getVerdictExplanation(verdictForExplain, 'en');

                            const rulesList = r.triggered_rules ?? [];
                            const isTechExpanded = Boolean(expandedTechCards[cardKey]);

                            return (
                              <div
                                key={cardKey}
                                data-testid={`sandbox-result-card-${r.index}`}
                                data-verdict-label={isInvalid ? 'invalid_input' : r.label}
                                className={`p-3 rounded-xl border text-xs space-y-1.5 ${
                                  isInvalid
                                    ? 'bg-amber-50/70 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800'
                                    : isHalluc || isRetracted
                                      ? 'bg-red-50/70 dark:bg-red-950/30 border-red-200 dark:border-red-800'
                                      : isRes && !hasL1Issue
                                        ? 'bg-sky-50/60 dark:bg-sky-950/25 border-sky-200 dark:border-sky-800'
                                        : !isVer || hasL1Issue
                                          ? 'bg-amber-50/70 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800'
                                          : 'bg-emerald-50/50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800'
                                }`}
                              >
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <div className="flex flex-wrap items-center gap-2 font-mono font-bold">
                                    <span>{markerDisplay}</span>
                                    {renderVerdictPill(r.label, r.triggered_rules, isInvalid)}
                                    {isRetracted && (
                                      <span
                                        data-testid={`sandbox-retracted-pill-${r.index}`}
                                        className="px-2 py-0.5 rounded text-[10px] font-bold bg-red-600 text-white border border-red-700"
                                      >
                                        {isVi ? 'ĐÃ RÚT BÀI' : 'RETRACTED'}
                                      </span>
                                    )}
                                    {!isInvalid && urlStatus && (
                                      <span
                                        data-testid={`sandbox-url-status-${r.index}`}
                                        className={`px-2 py-0.5 rounded text-[10px] border ${
                                          isUrlMismatch
                                            ? 'bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-800'
                                            : urlStatus === 'unchecked'
                                              ? 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700'
                                              : urlStatus === 'alive' ||
                                                  urlStatus === 'restricted_alive'
                                                ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-800'
                                                : urlStatus === 'archived_alive'
                                                  ? 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-800'
                                                  : 'bg-red-50 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-300 dark:border-red-800'
                                        }`}
                                      >
                                        {isUrlMismatch
                                          ? isVi
                                            ? `HTTP ${urlCode || 200} · Sai nội dung trang`
                                            : `HTTP ${urlCode || 200} · Wrong Page`
                                          : urlStatus === 'unchecked'
                                            ? isVi
                                              ? 'Đã khớp học thuật'
                                              : 'Scholarly Match'
                                            : urlStatus === 'alive'
                                              ? `HTTP ${urlCode || 200} OK`
                                              : urlStatus === 'restricted_alive'
                                                ? `HTTP ${urlCode || 403} OK`
                                                : urlStatus === 'archived_alive'
                                                  ? isVi
                                                    ? 'Bản lưu Wayback'
                                                    : 'Wayback Archived'
                                                  : urlStatus === 'dead_link'
                                                    ? `HTTP ${urlCode || 404} · ${isVi ? 'Liên kết hỏng' : 'Dead Link'}`
                                                    : isVi
                                                      ? 'URL không hợp lệ'
                                                      : 'Invalid URL'}
                                      </span>
                                    )}
                                    {isLayer1Applicable && (
                                      <span
                                        data-testid={`sandbox-layer1-badge-${r.index}`}
                                        className={`px-2 py-0.5 rounded text-[10px] font-medium ${
                                          hasL1Issue
                                            ? 'bg-violet-600 text-white'
                                            : 'bg-slate-200/80 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                                        }`}
                                      >
                                        {isVi ? 'Liên kết' : 'Link'}: {mappingDisplay.label}
                                      </span>
                                    )}
                                  </div>

                                  {!isInvalid && rulesList.length > 0 && (
                                    <button
                                      type="button"
                                      data-testid={`sandbox-tech-toggle-${r.index}`}
                                      aria-expanded={isTechExpanded}
                                      onClick={() => toggleTechCard(cardKey)}
                                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md font-mono text-[11px] text-slate-600 dark:text-slate-300 hover:bg-slate-200/70 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                                    >
                                      <span>
                                        {isVi ? 'Chi tiết kỹ thuật' : 'Technical details'}
                                      </span>
                                      <ChevronDown
                                        className={`h-3 w-3 transition-transform duration-200 ${
                                          isTechExpanded ? 'rotate-180' : ''
                                        }`}
                                        aria-hidden="true"
                                      />
                                    </button>
                                  )}
                                </div>

                                <p className="font-mono text-[11px] text-slate-800 dark:text-slate-200 break-words [overflow-wrap:anywhere]">
                                  {r.citation_raw}
                                </p>

                                {!isInvalid && (observedWeb || primarySource) && (
                                  <div
                                    data-testid={`sandbox-observed-meta-${r.index}`}
                                    className={`px-2.5 py-1.5 rounded-lg border font-mono text-[11px] space-y-0.5 ${
                                      isUrlMismatch
                                        ? 'bg-amber-100/70 dark:bg-amber-950/50 border-amber-300 dark:border-amber-800 text-amber-900 dark:text-amber-200'
                                        : 'bg-white/80 dark:bg-slate-900/70 border-sky-200/80 dark:border-sky-800/70 text-slate-700 dark:text-slate-200'
                                    }`}
                                  >
                                    {isUrlMismatch && observedWeb?.title ? (
                                      <div className="font-semibold">
                                        {isVi
                                          ? `Tiêu đề trang đích thực tế: "${observedWeb.title}"`
                                          : `Observed web page title: "${observedWeb.title}"`}
                                      </div>
                                    ) : observedWeb?.title || primarySource?.title ? (
                                      <div className="font-semibold">
                                        {observedWeb?.title
                                          ? isVi
                                            ? 'Thông tin trang web: '
                                            : 'Observed web metadata: '
                                          : isVi
                                            ? 'Bản ghi chuẩn đối chiếu: '
                                            : 'Canonical match: '}
                                        {observedWeb?.title || primarySource?.title}
                                      </div>
                                    ) : null}
                                    <div className="text-[10px] text-slate-500 dark:text-slate-400">
                                      {[
                                        (observedWeb?.authors?.length
                                          ? observedWeb.authors.join(', ')
                                          : primarySource?.authors?.join(', ')) || null,
                                        observedWeb?.year || primarySource?.year || null,
                                        observedWeb?.venue || primarySource?.venue || null,
                                        primarySource?.source
                                          ? getSourceDisplayName(primarySource.source, lang, {
                                              triggered_rules: r.triggered_rules,
                                              external_ids: primarySource.external_ids,
                                              venue: primarySource.venue,
                                              title: primarySource.title,
                                            })
                                          : observedWeb
                                            ? getSourceDisplayName(
                                                observedWeb.isArchived
                                                  ? 'wayback_html_meta'
                                                  : 'web_html_meta',
                                                lang,
                                              )
                                            : null,
                                      ]
                                        .filter(Boolean)
                                        .join(' · ')}
                                    </div>
                                  </div>
                                )}

                                <p className="text-[11px] text-slate-600 dark:text-slate-300 break-words [overflow-wrap:anywhere] leading-relaxed">
                                  {explanationText}
                                  {isLayer1Applicable && r.mapping_note
                                    ? ` · ${r.mapping_note}`
                                    : ''}
                                </p>

                                {!isInvalid && isTechExpanded && rulesList.length > 0 && (
                                  <div
                                    data-testid={`sandbox-tech-panel-${r.index}`}
                                    className="mt-1.5 pt-2 border-t border-slate-200/80 dark:border-slate-800 space-y-1 text-[11px]"
                                  >
                                    <div className="font-mono text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
                                      {isVi ? 'Quy tắc đối chiếu đã kích hoạt' : 'Triggered Verification Rules'}
                                    </div>
                                    <ul className="space-y-1">
                                      {rulesList.map((rule) => (
                                        <li
                                          key={rule}
                                          className="flex flex-wrap items-baseline gap-1.5 text-slate-600 dark:text-slate-300"
                                        >
                                          <code className="px-1.5 py-0.5 rounded bg-slate-200/80 dark:bg-slate-800 text-slate-800 dark:text-slate-200 font-mono text-[10px]">
                                            {rule}
                                          </code>
                                          <span>{getRuleDisplayName(rule, lang)}</span>
                                        </li>
                                      ))}
                                    </ul>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>

                        <DecisionSupportBanner variant="compact" lang={lang} />
                      </>
                    );
                  })()}
                </div>
              </m.div>
            )}
          </AnimatePresence>
        </CardResize>
      </div>

      <UpgradeModal
        open={upgradeOpen}
        onOpenChange={setUpgradeOpen}
        featureName={
          isVi
            ? 'Tạo & Kiểm chứng Bản thảo PDF mẫu'
            : 'Sample PDF Verification'
        }
      />
    </Card>
  );
}
