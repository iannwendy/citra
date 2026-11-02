import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  api,
  type SandboxAclPaperItem,
  type SandboxInstantVerifyResponse,
} from '@/api/client';
import { useToast } from '@/contexts/ToastContext';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Sparkles,
  Shuffle,
  FileText,
  Download,
  Zap,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  RotateCcw,
  Wand2,
  Loader2,
  Link2,
  BookOpen,
  Copy,
  Check,
} from 'lucide-react';

interface LiveCitationSandboxProps {
  lang?: 'vi' | 'en';
}

export function LiveCitationSandbox({ lang: langProp }: LiveCitationSandboxProps) {
  const { i18n } = useTranslation();
  const lang: 'vi' | 'en' = langProp ?? (i18n.language?.startsWith('vi') ? 'vi' : 'en');
  const navigate = useNavigate();
  const toast = useToast();

  const [mode, setMode] = useState<'acl_studio' | 'raw_paste'>('acl_studio');
  const [sampleCount, setSampleCount] = useState<number>(12);
  const [style, setStyle] = useState<'apa' | 'ieee'>('apa');
  const [manuscriptTitle, setManuscriptTitle] = useState<string>(
    'Empirical Evaluation of Neural Language Representations and Citation Integrity in Computational Linguistics',
  );
  const [items, setItems] = useState<SandboxAclPaperItem[]>([]);
  const [dbTotalPapers, setDbTotalPapers] = useState<number>(128626);
  const [loadingSample, setLoadingSample] = useState(false);
  const [generatingPdf, setGeneratingPdf] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [verifyingInstant, setVerifyingInstant] = useState(false);
  const [instantResult, setInstantResult] = useState<SandboxInstantVerifyResponse | null>(null);
  const [rawRefsText, setRawRefsText] = useState<string>(
    `Vaswani, A., Shazeer, N., & Parmar, N. (2017). Attention Is All You Need. Advances in Neural Information Processing Systems (NeurIPS). https://doi.org/10.48550/arXiv.1706.03762\nDevlin, J., Chang, M., Lee, K., & Toutanova, K. (2022). BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding. NAACL-HLT. https://doi.org/10.18653/v1/N19-1423\nSmith, J., & Nguyen, T. (2024). Autonomous Quantum Hyper-Graph Transformers for Zero-Shot Reasoning. Journal of Imaginary AI Research. https://doi.org/10.9999/fake.hallucination.2024`,
  );
  const [copiedBibtex, setCopiedBibtex] = useState(false);

  const handleSampleRandomAcl = async (customCount?: number) => {
    const targetCount = customCount ?? sampleCount;
    setLoadingSample(true);
    setInstantResult(null);
    try {
      const res = await api.sampleSandboxAclPapers(targetCount, style);
      setItems(res.items || []);
      if (res.database_total_papers) {
        setDbTotalPapers(res.database_total_papers);
      }
      toast.success(
        lang === 'vi'
          ? `Đã lấy ngẫu nhiên ${res.items.length} bài báo thực tế từ CSDL ACL (${(res.database_total_papers || 128626).toLocaleString()} bài)!`
          : `Sampled ${res.items.length} real papers from the local ACL database!`,
      );
    } catch (e) {
      toast.error(
        e instanceof Error
          ? e.message
          : lang === 'vi'
            ? 'Không thể lấy mẫu từ CSDL ACL'
            : 'Failed to sample papers from ACL database',
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
          base.venue = 'International Journal of Synthetic Hallucinated AI Systems';
          base.doi = `10.9999/hallucinated.acl.2025.${idx + 101}`;
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

  const handleAutoInjectDefenseSuite = () => {
    if (items.length === 0) return;
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
              'Autonomous Quantum Hyper-Graph Transformers for Hallucination-Free Symbolic Reasoning',
            authors_text: 'Jonathan Sterling; Victoria Vance',
            authors: ['Jonathan Sterling', 'Victoria Vance'],
            year: '2025',
            venue: 'Journal of Non-Existent Computational Intelligence',
            doi: '10.9999/fake.hallucination.2025.404',
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
      lang === 'vi'
        ? 'Đã tự động gài Bộ Kịch bản Test Hội đồng (Sai năm, Sai tác giả, Nguồn bịa đặt AI, Lệch năm In-text ↔ Ref, Uncited Ref & Orphan In-text)!'
        : 'Injected full Defense Test Suite (Wrong Year, Wrong Author, Hallucination, In-text Mismatch, Uncited Ref & Orphan Citation)!',
    );
  };

  const handleGenerateAndVerifyPdf = async () => {
    if (items.length === 0) return;
    setGeneratingPdf(true);
    try {
      const res = await api.generateSandboxPdfManuscript({
        title: manuscriptTitle,
        style,
        items,
        run_verification: true,
      });
      toast.success(
        lang === 'vi'
          ? `Đã tổng hợp bản thảo PDF (${res.num_pages} trang · ${res.in_text_count} trích dẫn trong bài · ${res.references_count} tài liệu tham khảo) và kích hoạt Pipeline kiểm chứng!`
          : `Synthesized ${res.num_pages}-page PDF manuscript and started full verification pipeline!`,
      );
      navigate(`/verification/processing/${res.essay_id}`);
    } catch (e) {
      toast.error(
        e instanceof Error
          ? e.message
          : lang === 'vi'
            ? 'Lỗi khi tạo file PDF hoàn chỉnh'
            : 'Failed to synthesize PDF manuscript',
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
        lang === 'vi'
          ? 'Đã tải xuống file PDF bản thảo học thuật hoàn chỉnh (gồm In-text Citations + References)!'
          : 'Downloaded synthesized academic PDF manuscript!',
      );
    } catch (e) {
      toast.error(
        e instanceof Error
          ? e.message
          : lang === 'vi'
            ? 'Không thể tải xuống file PDF bản thảo'
            : 'Failed to download PDF manuscript',
      );
    } finally {
      setDownloadingPdf(false);
    }
  };

  const handleInstantVerify = async () => {
    setVerifyingInstant(true);
    try {
      const payload =
        mode === 'acl_studio' && items.length > 0
          ? { style, items }
          : { style, references_text: rawRefsText };
      const res = await api.verifySandboxCitationsInstant(payload);
      setInstantResult(res);
    } catch (e) {
      toast.error(
        e instanceof Error
          ? e.message
          : lang === 'vi'
            ? 'Không thể kiểm tra nhanh'
            : 'Instant verification failed',
      );
    } finally {
      setVerifyingInstant(false);
    }
  };

  const presetBadge = (preset?: string) => {
    switch (preset) {
      case 'wrong_year':
        return (
          <span className="px-2 py-0.5 rounded-md text-[10px] font-mono font-bold bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 border border-amber-300">
            {lang === 'vi' ? '⚡ LỖI NĂM (METADATA_ERROR)' : '⚡ WRONG YEAR (METADATA_ERROR)'}
          </span>
        );
      case 'wrong_author':
        return (
          <span className="px-2 py-0.5 rounded-md text-[10px] font-mono font-bold bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 border border-amber-300">
            {lang === 'vi' ? '⚡ LỖI TÁC GIẢ (METADATA_ERROR)' : '⚡ WRONG AUTHOR (METADATA_ERROR)'}
          </span>
        );
      case 'hallucinated':
        return (
          <span className="px-2 py-0.5 rounded-md text-[10px] font-mono font-bold bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300 border border-red-300">
            {lang === 'vi' ? '🚨 NGUỒN BỊA ĐẶT (HALLUCINATION)' : '🚨 HALLUCINATED SOURCE'}
          </span>
        );
      case 'year_mismatch_intext':
        return (
          <span className="px-2 py-0.5 rounded-md text-[10px] font-mono font-bold bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300 border border-violet-300">
            {lang === 'vi' ? '🔗 LỆCH NĂM IN-TEXT ↔ REF' : '🔗 IN-TEXT ↔ REF YEAR MISMATCH'}
          </span>
        );
      case 'uncited_ref':
        return (
          <span className="px-2 py-0.5 rounded-md text-[10px] font-mono font-bold bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300 border border-orange-300">
            {lang === 'vi' ? '👻 UNCITED REFERENCE (KHÔNG TRÍCH TRONG BÀI)' : '👻 UNCITED REFERENCE'}
          </span>
        );
      case 'orphan_intext':
        return (
          <span className="px-2 py-0.5 rounded-md text-[10px] font-mono font-bold bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300 border border-rose-300">
            {lang === 'vi' ? '❓ MISSING REFERENCE (TRÍCH DẪN MỒ CÔI)' : '❓ ORPHAN IN-TEXT CITATION'}
          </span>
        );
      default:
        return (
          <span className="px-2 py-0.5 rounded-md text-[10px] font-mono font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-300">
            {lang === 'vi' ? '✓ CHUẨN GỐC CSDL ACL' : '✓ CANONICAL ACL RECORD'}
          </span>
        );
    }
  };

  return (
    <Card
      data-testid="live-citation-sandbox"
      className="p-0 overflow-hidden rounded-2xl border-2 border-indigo-200/90 dark:border-indigo-800/80 bg-white dark:bg-slate-900 shadow-md"
    >
      {/* Top Studio Header */}
      <div className="px-4 sm:px-5 py-3.5 sm:py-4 bg-gradient-to-r from-indigo-950 via-slate-900 to-violet-950 text-white flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-slate-800">
        <div className="flex items-start sm:items-center gap-3 min-w-0">
          <div className="h-9 w-9 sm:h-10 sm:w-10 rounded-xl bg-indigo-500/25 border border-indigo-400/40 flex items-center justify-center shrink-0">
            <Sparkles className="h-4 w-4 sm:h-5 sm:w-5 text-indigo-300" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-base sm:text-lg font-display font-bold tracking-tight leading-snug">
                {lang === 'vi'
                  ? 'Live Citation Sandbox & Trình Tạo Bản Thảo PDF Học Thuật Tự Động (CSDL ACL)'
                  : 'Live Citation Sandbox & Synthetic Academic PDF Generator (ACL Database)'}
              </h1>
              <Badge className="bg-emerald-500/25 text-emerald-200 border border-emerald-400/40 font-mono text-[10px]">
                {dbTotalPapers.toLocaleString()} {lang === 'vi' ? 'BÀI BÁO ACL' : 'ACL PAPERS'}
              </Badge>
            </div>
            <p className="text-[11px] sm:text-xs text-slate-300 mt-0.5 leading-relaxed">
              {lang === 'vi'
                ? 'Lấy ngẫu nhiên 10–20 bài báo thật từ CSDL ACL, tùy chỉnh Metadata / In-text ↔ Refs và xuất File PDF hoàn chỉnh để kiểm chứng!'
                : 'Sample 10–20 real ACL papers, tweak metadata or in-text linking live, and synthesize a complete academic PDF manuscript to verify In-Text ↔ Refs!'}
            </p>
          </div>
        </div>

        {/* Mode Switcher */}
        <div className="grid grid-cols-2 sm:inline-flex w-full md:w-auto items-center p-1 rounded-xl bg-slate-800/90 border border-slate-700 gap-1 shrink-0 self-start md:self-auto">
          <button
            type="button"
            data-testid="sandbox-mode-acl-btn"
            onClick={() => setMode('acl_studio')}
            className={`w-full sm:w-auto justify-center text-center whitespace-nowrap px-2.5 sm:px-3 py-1.5 rounded-lg text-[11px] sm:text-xs font-mono font-semibold transition-all ${
              mode === 'acl_studio'
                ? 'bg-indigo-600 text-white shadow-2xs'
                : 'text-slate-300 hover:text-white'
            }`}
          >
            {lang === 'vi' ? '🎲 CSDL ACL → PDF' : '🎲 ACL DB → Full PDF'}
          </button>
          <button
            type="button"
            data-testid="sandbox-mode-raw-btn"
            onClick={() => setMode('raw_paste')}
            className={`w-full sm:w-auto justify-center text-center whitespace-nowrap px-2.5 sm:px-3 py-1.5 rounded-lg text-[11px] sm:text-xs font-mono font-semibold transition-all ${
              mode === 'raw_paste'
                ? 'bg-indigo-600 text-white shadow-2xs'
                : 'text-slate-300 hover:text-white'
            }`}
          >
            {lang === 'vi' ? '⚡ Dán Nhanh (3s)' : '⚡ Quick Paste (3s)'}
          </button>
        </div>
      </div>

      <div className="p-3.5 sm:p-6 space-y-4 sm:space-y-5">
        {mode === 'acl_studio' ? (
          <>
            {/* Control Bar: Count, Style, Random Sample Button & Defense Suite Injector */}
            <div className="p-3.5 sm:p-4 rounded-2xl bg-slate-50 dark:bg-slate-950/70 border border-slate-200/90 dark:border-slate-800 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:flex lg:flex-wrap items-stretch sm:items-center gap-2.5 w-full lg:w-auto min-w-0 max-w-full">
                <div className="flex items-center justify-between sm:justify-start gap-2 w-full sm:w-auto min-w-0 max-w-full">
                  <label className="w-[68px] sm:w-auto whitespace-nowrap text-xs font-mono font-semibold text-slate-600 dark:text-slate-300 shrink-0">
                    {lang === 'vi' ? 'Số lượng:' : 'Papers:'}
                  </label>
                  <select
                    data-testid="sandbox-acl-count-select"
                    aria-label={
                      lang === 'vi'
                        ? 'Số lượng bài báo ACL lấy mẫu'
                        : 'Number of ACL papers to sample'
                    }
                    value={sampleCount}
                    onChange={(e) => setSampleCount(Number(e.target.value))}
                    className="h-9 px-2.5 rounded-xl text-xs font-mono font-semibold bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 flex-1 sm:flex-initial min-w-0 max-w-full"
                  >
                    <option value={10}>{lang === 'vi' ? '10 bài báo ACL' : '10 ACL Papers'}</option>
                    <option value={12}>{lang === 'vi' ? '12 bài báo ACL' : '12 ACL Papers'}</option>
                    <option value={15}>{lang === 'vi' ? '15 bài báo ACL' : '15 ACL Papers'}</option>
                    <option value={20}>{lang === 'vi' ? '20 bài báo ACL' : '20 ACL Papers'}</option>
                  </select>
                </div>

                <div className="flex items-center justify-between sm:justify-start gap-2 w-full sm:w-auto min-w-0 max-w-full">
                  <label className="w-[68px] sm:w-auto whitespace-nowrap text-xs font-mono font-semibold text-slate-600 dark:text-slate-300 shrink-0">
                    {lang === 'vi' ? 'Chuẩn:' : 'Style:'}
                  </label>
                  <select
                    data-testid="sandbox-acl-style-select"
                    aria-label={
                      lang === 'vi'
                        ? 'Chuẩn trích dẫn cho file PDF'
                        : 'Target citation style for generated PDF'
                    }
                    value={style}
                    onChange={(e) => setStyle(e.target.value as 'apa' | 'ieee')}
                    className="h-9 px-2.5 rounded-xl text-xs font-mono font-semibold bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 flex-1 sm:flex-initial min-w-0 max-w-full"
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
                  className="w-full sm:col-span-2 lg:w-auto h-auto min-h-9 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold shadow-xs whitespace-normal text-center leading-snug max-w-full"
                >
                  {loadingSample ? (
                    <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                  ) : (
                    <Shuffle className="h-4 w-4 shrink-0" />
                  )}
                  <span>
                    {lang === 'vi'
                      ? `Random ${sampleCount} Bài báo từ CSDL ACL`
                      : `Sample ${sampleCount} Random ACL Papers`}
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
                    onClick={handleAutoInjectDefenseSuite}
                    className="w-full sm:w-auto h-auto min-h-9 py-2 rounded-xl text-xs font-mono font-semibold border-amber-300 dark:border-amber-700 bg-amber-50/80 dark:bg-amber-950/50 text-amber-800 dark:text-amber-300 hover:bg-amber-100 whitespace-normal text-left leading-snug max-w-full"
                  >
                    <Wand2 className="h-3.5 w-3.5 text-amber-600 shrink-0" />
                    <span>
                      {lang === 'vi'
                        ? 'Gài Tự động Bộ Lỗi Mẫu Hội Đồng (Layer 1 + Layer 2)'
                        : 'Auto-Inject Defense Error Suite (Layer 1 + 2)'}
                    </span>
                  </Button>
                </div>
              )}
            </div>

            {items.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 p-5 sm:p-8 text-center bg-slate-50/50 dark:bg-slate-950/30">
                <BookOpen className="h-8 w-8 sm:h-9 sm:w-9 text-indigo-500 mx-auto mb-2 opacity-85" />
                <p className="text-sm font-display font-bold text-slate-800 dark:text-slate-200 leading-snug">
                  {lang === 'vi'
                    ? `Bấm nút "Random ${sampleCount} Bài báo từ CSDL ACL" ở trên để khởi tạo danh sách bài báo thực tế`
                    : `Click "Sample ${sampleCount} Random ACL Papers" above to load real papers from the ACL Anthology database`}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5 max-w-xl mx-auto leading-relaxed">
                  {lang === 'vi'
                    ? 'Sau khi lấy ngẫu nhiên 10–20 bài báo, bạn có thể sửa Năm, Tác giả, Tiêu đề, DOI hoặc bật/tắt liên kết In-text ↔ References rồi nhấn "Tạo File PDF Hoàn chỉnh & Chạy Kiểm chứng" ngay trước mặt thầy cô!'
                    : 'Once loaded, you can edit any metadata field or toggle In-text ↔ Reference linking, then synthesize a full PDF manuscript to run through the verification pipeline.'}
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Manuscript Title Bar */}
                <div className="flex flex-col sm:flex-row sm:items-center gap-2 bg-slate-50/70 dark:bg-slate-900/60 p-3 rounded-xl border border-slate-200 dark:border-slate-800">
                  <span className="text-xs font-mono font-semibold text-slate-600 dark:text-slate-400 shrink-0">
                    {lang === 'vi' ? 'Tiêu đề Bản thảo PDF:' : 'PDF Manuscript Title:'}
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
                      {/* Row Top: Index + Preset Status Badge + Quick Corrupt Buttons */}
                      <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="px-2 py-0.5 rounded-md text-xs font-mono font-bold bg-indigo-600 text-white">
                            #{idx + 1}
                          </span>
                          {presetBadge(it.mutation_preset)}
                          {it.paper_id && (
                            <span className="text-[10px] font-mono text-slate-400">
                              ACL ID #{it.paper_id}
                            </span>
                          )}
                        </div>

                        {/* Quick 1-Click Mutation Presets for Live Defense Demo */}
                        <div className="flex flex-wrap items-center gap-1">
                          <button
                            type="button"
                            data-testid={`sandbox-preset-clean-${idx}`}
                            onClick={() => applyItemPreset(idx, 'clean')}
                            className="px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-slate-100 hover:bg-emerald-100 text-slate-700 hover:text-emerald-800 dark:bg-slate-800 dark:text-slate-300 transition-colors"
                            title={lang === 'vi' ? 'Khôi phục dữ liệu chuẩn gốc từ CSDL ACL' : 'Restore canonical ACL record'}
                          >
                            <RotateCcw className="h-2.5 w-2.5 inline mr-0.5" />
                            {lang === 'vi' ? 'Gốc ACL' : 'Canonical ACL'}
                          </button>
                          <button
                            type="button"
                            data-testid={`sandbox-preset-wrong-year-${idx}`}
                            onClick={() => applyItemPreset(idx, 'wrong_year')}
                            className="px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-amber-100/80 hover:bg-amber-200 text-amber-900 dark:bg-amber-950 dark:text-amber-300 transition-colors"
                          >
                            {lang === 'vi' ? 'Sửa sai Năm' : 'Wrong Year'}
                          </button>
                          <button
                            type="button"
                            data-testid={`sandbox-preset-wrong-author-${idx}`}
                            onClick={() => applyItemPreset(idx, 'wrong_author')}
                            className="px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-amber-100/80 hover:bg-amber-200 text-amber-900 dark:bg-amber-950 dark:text-amber-300 transition-colors"
                          >
                            {lang === 'vi' ? 'Sửa sai Tác giả' : 'Wrong Author'}
                          </button>
                          <button
                            type="button"
                            data-testid={`sandbox-preset-hallucinated-${idx}`}
                            onClick={() => applyItemPreset(idx, 'hallucinated')}
                            className="px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-red-100/90 hover:bg-red-200 text-red-900 dark:bg-red-950 dark:text-red-300 transition-colors"
                          >
                            {lang === 'vi' ? 'Bịa nguồn giả (Hallucination)' : 'Hallucinate'}
                          </button>
                          <button
                            type="button"
                            data-testid={`sandbox-preset-intext-mismatch-${idx}`}
                            onClick={() => applyItemPreset(idx, 'year_mismatch_intext')}
                            className="px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-violet-100/90 hover:bg-violet-200 text-violet-900 dark:bg-violet-950 dark:text-violet-300 transition-colors"
                          >
                            {lang === 'vi' ? 'Lệch năm In-text ↔ Ref' : 'In-text ↔ Ref Year Drift'}
                          </button>
                          <button
                            type="button"
                            data-testid={`sandbox-preset-uncited-${idx}`}
                            onClick={() => applyItemPreset(idx, 'uncited_ref')}
                            className="px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-orange-100/90 hover:bg-orange-200 text-orange-900 dark:bg-orange-950 dark:text-orange-300 transition-colors"
                          >
                            {lang === 'vi' ? 'Ref không trích (Uncited)' : 'Uncited Ref'}
                          </button>
                          <button
                            type="button"
                            data-testid={`sandbox-preset-orphan-${idx}`}
                            onClick={() => applyItemPreset(idx, 'orphan_intext')}
                            className="px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-rose-100/90 hover:bg-rose-200 text-rose-900 dark:bg-rose-950 dark:text-rose-300 transition-colors"
                          >
                            {lang === 'vi' ? 'Trích dẫn mồ côi (Orphan)' : 'Orphan In-text'}
                          </button>
                        </div>
                      </div>

                      {/* Editable Metadata Inputs */}
                      <div className="grid grid-cols-1 md:grid-cols-12 gap-2">
                        <div className="md:col-span-5">
                          <label className="block text-[10px] font-mono uppercase text-slate-500 mb-0.5">
                            {lang === 'vi' ? 'Title (Tiêu đề bài báo)' : 'Title'}
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
                            {lang === 'vi' ? 'Authors (Tác giả, cách bởi ;)' : 'Authors (; separated)'}
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
                            {lang === 'vi' ? 'Year (Năm)' : 'Year'}
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
                            {lang === 'vi' ? 'DOI / Mã định danh' : 'DOI / Identifier'}
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

                      {/* Layer-1 In-Text <-> References Controls */}
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
                              {lang === 'vi'
                                ? 'Trích dẫn trong bài (Body In-Text)'
                                : 'Cited in Body Text (In-Text)'}
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
                              {lang === 'vi'
                                ? 'Có trong mục References cuối bài'
                                : 'Included in Bibliography (References)'}
                            </span>
                          </label>
                        </div>

                        <div className="flex flex-wrap items-center justify-between gap-2 w-full sm:w-auto">
                          <span className="text-[11px] font-mono text-slate-500">
                            {lang === 'vi'
                              ? 'Năm In-text ghi đè (nếu muốn test lệch năm):'
                              : 'In-text year override (test year drift):'}
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
                <div className="p-4 rounded-2xl bg-gradient-to-r from-indigo-50/90 via-white to-violet-50/80 dark:from-indigo-950/50 dark:via-slate-900 dark:to-violet-950/40 border border-indigo-200/80 dark:border-indigo-800/70 flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3">
                  <div className="text-xs font-mono text-slate-700 dark:text-slate-300 space-y-0.5">
                    <div>
                      <strong>{items.filter((i) => i.cite_in_text).length}</strong>{' '}
                      {lang === 'vi'
                        ? 'trích dẫn In-text trong thân bài ↔'
                        : 'in-text citations in body ↔'}{' '}
                      <strong>{items.filter((i) => i.include_in_references).length}</strong>{' '}
                      {lang === 'vi'
                        ? 'mục trong References cuối bài'
                        : 'entries in References'}
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">
                      {lang === 'vi'
                        ? 'Hệ thống sẽ tự động sinh file PDF học thuật hoàn chỉnh (3 chương + References) để kiểm tra cả Layer 1 (In-text ↔ Refs) và Layer 2 (15+ CSDL).'
                        : 'Synthesizes a complete 3-section academic PDF manuscript + Bibliography to verify both Layer 1 (In-text ↔ Refs) and Layer 2 (15+ Scholarly DBs).'}
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
                        <Download className="h-4 w-4 text-indigo-600 shrink-0" />
                      )}
                      <span>
                        {lang === 'vi'
                          ? 'Tải File PDF Hoàn chỉnh (.PDF)'
                          : 'Download Generated .PDF'}
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
                        {lang === 'vi' ? 'Kiểm tra Nhanh 3 Giây' : 'Instant 3s Check'}
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
                        {lang === 'vi'
                          ? 'Tạo File PDF Hoàn chỉnh & Chạy Full Pipeline (In-Text ↔ Refs)'
                          : 'Generate Full PDF & Run End-to-End Verification'}
                      </span>
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </>
        ) : (
          /* Mode B: Raw Text / BibTeX Instant 3-Second Sandbox */
          <div className="space-y-3">
            <label className="block text-xs font-mono font-semibold text-slate-700 dark:text-slate-300">
              {lang === 'vi'
                ? 'Dán danh sách Tài liệu tham khảo (APA, IEEE, Vancouver) hoặc BibTeX để kiểm tra tức thì:'
                : 'Paste reference entries (APA, IEEE, Vancouver) or BibTeX for instant 3-second verification:'}
            </label>
            <textarea
              data-testid="sandbox-raw-textarea"
              rows={5}
              value={rawRefsText}
              onChange={(e) => setRawRefsText(e.target.value)}
              className="w-full p-3.5 rounded-xl font-mono text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-slate-100"
            />
            <div className="flex justify-end">
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
                  {lang === 'vi'
                    ? 'Kiểm tra Trực tiếp trong 3 Giây'
                    : 'Run Instant 3s Verification'}
                </span>
              </Button>
            </div>
          </div>
        )}

        {/* Instant Verification Results Panel */}
        {instantResult && (
          <div
            data-testid="sandbox-instant-results"
            className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-800 space-y-3"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2 text-xs font-mono">
                <Badge className="bg-indigo-600 text-white">
                  ⚡ {instantResult.elapsed_seconds}s
                </Badge>
                <span className="px-2.5 py-1 rounded-lg bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 font-semibold">
                  ✓ {lang === 'vi' ? 'Hợp lệ' : 'Verified'}: {instantResult.summary.verified}
                </span>
                <span className="px-2.5 py-1 rounded-lg bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-300 font-semibold">
                  ⚠ {lang === 'vi' ? 'Sai lệch Metadata' : 'Metadata Error'}: {instantResult.summary.metadata_error}
                </span>
                <span className="px-2.5 py-1 rounded-lg bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-300 font-semibold">
                  🚨 {lang === 'vi' ? 'Nghi bịa đặt' : 'Hallucination'}: {instantResult.summary.suspected_hallucination}
                </span>
                <span className="px-2.5 py-1 rounded-lg bg-violet-50 dark:bg-violet-950 text-violet-700 dark:text-violet-300 font-semibold">
                  🔗 {lang === 'vi' ? 'Lỗi liên kết Layer-1 In-text ↔ Ref' : 'Layer-1 In-text ↔ Ref Issues'}: {instantResult.summary.layer1_linking_issues}
                </span>
              </div>

              {instantResult.remediation?.combined_bibtex && (
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard.writeText(
                      instantResult.remediation?.combined_bibtex || '',
                    );
                    setCopiedBibtex(true);
                    setTimeout(() => setCopiedBibtex(false), 2000);
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-mono font-semibold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-indigo-50"
                >
                  {copiedBibtex ? (
                    <>
                      <Check className="h-3.5 w-3.5 text-emerald-600" />
                      <span>{lang === 'vi' ? 'Đã sao chép BibTeX!' : 'Copied BibTeX!'}</span>
                    </>
                  ) : (
                    <>
                      <Copy className="h-3.5 w-3.5 text-indigo-600" />
                      <span>{lang === 'vi' ? 'Sao chép BibTeX chuẩn hóa' : 'Copy Standardized BibTeX'}</span>
                    </>
                  )}
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 gap-2 max-h-80 overflow-y-auto pr-1">
              {instantResult.results.map((r) => {
                const isVer = r.label === 'verified';
                const isHalluc = r.label === 'suspected_hallucination';
                const hasL1Issue = r.mapping_status !== 'matched';
                return (
                  <div
                    key={r.index}
                    className={`p-3 rounded-xl border text-xs space-y-1 ${
                      isHalluc
                        ? 'bg-red-50/70 dark:bg-red-950/30 border-red-200 dark:border-red-800'
                        : !isVer || hasL1Issue
                          ? 'bg-amber-50/70 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800'
                          : 'bg-emerald-50/50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800'
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2 font-mono font-bold">
                        <span>#{r.index}</span>
                        {isVer ? (
                          <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-300">
                            <CheckCircle2 className="h-3.5 w-3.5" /> VERIFIED
                          </span>
                        ) : isHalluc ? (
                          <span className="inline-flex items-center gap-1 text-red-700 dark:text-red-300">
                            <XCircle className="h-3.5 w-3.5" /> SUSPECTED HALLUCINATION
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-300">
                            <AlertTriangle className="h-3.5 w-3.5" /> {r.label.toUpperCase()}
                          </span>
                        )}
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] ${
                            hasL1Issue
                              ? 'bg-violet-600 text-white'
                              : 'bg-slate-200/80 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                          }`}
                        >
                          Layer 1: {r.mapping_status.toUpperCase()}
                        </span>
                      </div>
                      <span className="font-mono text-[11px] text-slate-500">
                        {lang === 'vi' ? 'Luật' : 'Rules'}: {(r.triggered_rules || []).join(', ') || 'R01'}
                      </span>
                    </div>
                    <p className="font-mono text-[11px] text-slate-800 dark:text-slate-200 break-words [overflow-wrap:anywhere]">
                      {r.citation_raw}
                    </p>
                    <p className="text-[11px] text-slate-600 dark:text-slate-400 break-words [overflow-wrap:anywhere]">
                      {r.reasoning} {r.mapping_note ? ` • ${r.mapping_note}` : ''}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
