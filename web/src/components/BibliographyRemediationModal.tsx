import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  api,
  type RemediatedBibliographyResponse,
} from '@/api/client';
import {
  Sparkles,
  Copy,
  Check,
  Download,
  X,
  Loader2,
  BookOpen,
  ArrowRight,
  FileCode2,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Globe,
} from 'lucide-react';
import { isDocxFilename } from '@/lib/fileKind';
import { useModalA11y } from '@/hooks/useModalA11y';
import { useToast } from '@/contexts/ToastContext';
import {
  formatUserError,
  sanitizeReasoningForDisplay,
} from '@/lib/academicTaxonomy';
import {
  getFieldDisplayName,
  getSourceDisplayName,
} from '@/lib/verdictExplanation';
import {
  IconSwap,
  TextMorph,
  useSlidingPill,
} from '@/components/ui/transitions';

interface BibliographyRemediationModalProps {
  open: boolean;
  essayId: number;
  filename: string;
  lang: 'vi' | 'en';
  onClose: () => void;
}

type StyleOption = 'apa' | 'ieee' | 'tdtu' | 'bibtex' | 'ris';

/**
 * Deduplicate adjacent repeated venue strings like "CVPR - CVPR" or
 * "NeurIPS – NeurIPS" produced when both conference acronym and proceedings
 * venue repeat verbatim (BUG-56).
 */
export function deduplicateRepeatedVenue(text: string): string {
  if (!text) return text;
  return text.replace(
    /\b([A-Za-zÀ-ỹ][A-Za-z0-9À-ỹ&.,'()/\s]{1,70}?)\s*(?:[-–—]|,)\s*\1(?=[\s.,;:)(\n]|$)/gi,
    '$1',
  );
}

const STYLE_LABELS: {
  id: StyleOption;
  labelVi: string;
  labelEn: string;
  ext: string;
}[] = [
  { id: 'apa', labelVi: 'APA (Ấn bản 7)', labelEn: 'APA 7th Edition', ext: 'txt' },
  { id: 'ieee', labelVi: 'IEEE (Đánh số)', labelEn: 'IEEE Numeric', ext: 'txt' },
  {
    id: 'tdtu',
    labelVi: 'Harvard (Khóa luận)',
    labelEn: 'Harvard (Thesis)',
    ext: 'txt',
  },
  { id: 'bibtex', labelVi: 'BibTeX (.bib)', labelEn: 'BibTeX (.bib)', ext: 'bib' },
  { id: 'ris', labelVi: 'RIS (.ris)', labelEn: 'RIS (.ris)', ext: 'ris' },
];

export function BibliographyRemediationModal({
  open,
  essayId,
  filename,
  lang,
  onClose,
}: BibliographyRemediationModalProps) {
  const toast = useToast();
  const [selectedStyle, setSelectedStyle] = useState<StyleOption>('apa');
  const { containerRef: stylePillRef, pillStyle: stylePill } =
    useSlidingPill<HTMLDivElement>(selectedStyle);
  const [data, setData] = useState<RemediatedBibliographyResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [filterMode, setFilterMode] = useState<'all' | 'flagged_red' | 'modified'>('all');
  const [healedBusy, setHealedBusy] = useState(false);
  const [healedError, setHealedError] = useState<string | null>(null);
  // The healed-DOCX endpoint only works for original Word uploads (HTTP 400 for PDFs).
  const isDocxSource = isDocxFilename(filename);
  const { dialogProps, titleId } = useModalA11y<HTMLDivElement>(open, onClose);

  useEffect(() => {
    if (!open || !essayId) return;
    let active = true;
    setLoading(true);
    setError(null);
    api
      .getRemediatedBibliography(essayId, selectedStyle)
      .then((res) => {
        if (active) setData(res);
      })
      .catch((err) => {
        if (active) {
          setError(formatUserError(err, lang));
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [open, essayId, selectedStyle, lang]);

  if (!open) return null;

  const handleCopy = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(deduplicateRepeatedVenue(text));
      setCopiedKey(key);
      toast.success(
        lang === 'vi'
          ? key === 'all'
            ? 'Đã sao chép toàn bộ danh mục'
            : 'Đã sao chép trích dẫn'
          : key === 'all'
            ? 'Copied full bibliography'
            : 'Copied citation',
      );
      setTimeout(() => setCopiedKey(null), 2000);
    } catch {
      // ignore clipboard errors
    }
  };

  const handleDownloadHealedDocx = async () => {
    if (!isDocxSource || healedBusy) return;
    const selectedDocxStyle =
      selectedStyle === 'ieee' ? 'ieee' : selectedStyle === 'tdtu' ? 'tdtu' : 'apa';
    setHealedBusy(true);
    setHealedError(null);
    try {
      await api.downloadAutoHealedDocx(essayId, selectedDocxStyle, filename);
      toast.success(
        lang === 'vi'
          ? 'Đã tải xuống tệp Word (.docx) chuẩn hóa'
          : 'Downloaded auto-healed Word (.docx) file',
      );
    } catch (err) {
      const detail = formatUserError(err, lang);
      setHealedError(
        lang === 'vi'
          ? `Không thể xuất tệp Word tự sửa lỗi. ${detail}`
          : `Could not export the auto-healed Word file. ${detail}`,
      );
    } finally {
      setHealedBusy(false);
    }
  };

  const healedDisabledHint =
    lang === 'vi'
      ? 'Chỉ khả dụng cho tệp Word (.docx) — bài nộp PDF không hỗ trợ xuất trực tiếp .docx'
      : 'Available for Word (.docx) uploads only — PDF uploads cannot export directly to .docx';

  const handleDownloadFile = (content: string, ext: string, suffix: string) => {
    const cleaned = deduplicateRepeatedVenue(content);
    const blob = new Blob([cleaned], { type: 'text/plain;charset=utf-8' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    const cleanBase = (filename || `essay_${essayId}`).replace(/\.[^/.]+$/, '');
    a.href = url;
    a.download = `${cleanBase}_${suffix}.${ext}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
    toast.success(
      lang === 'vi'
        ? `Đã tải xuống tệp .${ext.toUpperCase()}`
        : `Downloaded .${ext.toUpperCase()} file`,
    );
  };

  const flaggedRedCount = data
    ? data.entries.filter(
        (e) =>
          e.is_error ||
          e.is_hallucination ||
          e.remediation_status === 'hallucination' ||
          e.remediation_status === 'manual_review' ||
          e.label === 'suspected_hallucination' ||
          e.label === 'metadata_error'
      ).length
    : 0;

  const visibleEntries = data
    ? filterMode === 'flagged_red'
      ? data.entries.filter(
          (e) =>
            e.is_error ||
            e.is_hallucination ||
            e.remediation_status === 'hallucination' ||
            e.remediation_status === 'manual_review' ||
            e.label === 'suspected_hallucination' ||
            e.label === 'metadata_error'
        )
      : filterMode === 'modified'
        ? data.entries.filter((e) => e.was_modified)
        : data.entries
    : [];

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/65 backdrop-blur-sm p-3 sm:p-4"
      onClick={onClose}
      data-testid="bibliography-remediation-modal"
    >
      <div
        {...dialogProps}
        className="t-modal is-open w-full max-w-5xl max-h-[90dvh] flex flex-col rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Header */}
        <div className="px-6 py-4 bg-gradient-to-r from-indigo-950 via-slate-900 to-violet-950 text-white flex flex-wrap items-center justify-between gap-4 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-indigo-500/20 border border-indigo-400/30 flex items-center justify-center">
              <Sparkles className="h-5 w-5 text-indigo-300" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 id={titleId} className="text-base sm:text-lg font-display font-bold tracking-tight">
                  {lang === 'vi'
                    ? 'Chuẩn hóa & Sửa lỗi Danh mục Tài liệu Tham khảo'
                    : 'Bibliography Auto-Remediation & Export'}
                </h2>
              </div>
              <p className="text-xs text-slate-300 mt-0.5">
                {lang === 'vi'
                  ? 'Tự động đối chiếu & khôi phục Năm xuất bản, Tiêu đề, Tác giả, Nơi công bố và DOI chuẩn xác từ 15+ CSDL học thuật.'
                  : 'Automatically repairs mismatched Year, Title, Authors, Venue & DOI using canonical records from 15+ scholarly databases.'}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg text-slate-300 hover:text-white hover:bg-white/10 transition-colors"
            aria-label={lang === 'vi' ? 'Đóng cửa sổ chuẩn hóa' : 'Close remediation modal'}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Toolbar: Style Selector (#16 Sliding Tabs) + Bulk Export Actions */}
        <div className="px-6 py-3.5 bg-slate-50 dark:bg-slate-900/90 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
          <div
            ref={stylePillRef}
            className="relative flex flex-wrap items-center gap-1.5"
            role="group"
            aria-label={lang === 'vi' ? 'Chọn chuẩn trích dẫn' : 'Target citation style'}
          >
            {stylePill.ready && (
              <span
                aria-hidden="true"
                style={{
                  width: `${stylePill.width}px`,
                  height: `${stylePill.height}px`,
                  transform: `translate3d(${stylePill.left}px, ${stylePill.top}px, 0)`,
                  transition: stylePill.animate ? undefined : 'none',
                }}
                className="t-tabs-pill rounded-lg !bg-indigo-600 shadow-sm"
              />
            )}
            {STYLE_LABELS.map((st) => {
              const isActive = selectedStyle === st.id;
              return (
                <button
                  key={st.id}
                  type="button"
                  data-testid={`remediate-style-${st.id}`}
                  data-pill-active={isActive ? 'true' : 'false'}
                  onClick={() => setSelectedStyle(st.id)}
                  className={`t-tab px-3 py-1.5 rounded-lg text-xs font-mono font-semibold transition-all ${
                    isActive
                      ? stylePill.ready
                        ? 'text-white'
                        : 'bg-indigo-600 text-white shadow-sm'
                      : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:border-indigo-400'
                  }`}
                >
                  {lang === 'vi' ? st.labelVi : st.labelEn}
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {data && (
              <>
                {flaggedRedCount > 0 && (
                  <button
                    type="button"
                    data-testid="filter-flagged-red-btn"
                    onClick={() =>
                      setFilterMode((m) => (m === 'flagged_red' ? 'all' : 'flagged_red'))
                    }
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-mono font-semibold border transition-colors ${
                      filterMode === 'flagged_red'
                        ? 'bg-red-600 text-white border-red-600 shadow-sm'
                        : 'bg-red-50 dark:bg-red-950/60 border-red-300 dark:border-red-800 text-red-700 dark:text-red-300 hover:bg-red-100'
                    }`}
                  >
                    <XCircle className="h-3.5 w-3.5" />
                    <span>
                      {lang === 'vi'
                        ? `Nguồn Lỗi & Nghi vấn (${flaggedRedCount})`
                        : `Flagged Errors & Suspected (${flaggedRedCount})`}
                    </span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() =>
                    setFilterMode((m) => (m === 'modified' ? 'all' : 'modified'))
                  }
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-mono font-medium border transition-colors ${
                    filterMode === 'modified'
                      ? 'bg-amber-50 dark:bg-amber-950/60 border-amber-300 dark:border-amber-700 text-amber-800 dark:text-amber-300'
                      : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                  }`}
                >
                  {lang === 'vi'
                    ? `Đã tự động sửa (${data.remediated_count}/${data.total_entries})`
                    : `Auto-Repaired (${data.remediated_count}/${data.total_entries})`}
                </button>

                <button
                  type="button"
                  data-testid="copy-all-remediated-btn"
                  onClick={() => handleCopy(data.combined_text, 'all')}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 hover:border-indigo-400 transition-colors"
                >
                  <IconSwap
                    active={copiedKey === 'all'}
                    iconA={<Copy className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />}
                    iconB={<Check className="h-3.5 w-3.5 text-emerald-500" />}
                  />
                  <TextMorph
                    text={
                      copiedKey === 'all'
                        ? lang === 'vi'
                          ? 'Đã sao chép!'
                          : 'Copied All!'
                        : lang === 'vi'
                          ? 'Sao chép toàn bộ'
                          : 'Copy All'
                    }
                  />
                </button>

                <button
                  type="button"
                  data-testid="download-bibtex-btn"
                  onClick={() => handleDownloadFile(data.combined_bibtex, 'bib', 'references')}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm transition-colors"
                >
                  <Download className="h-3.5 w-3.5" />
                  <span>.BIB</span>
                </button>

                <button
                  type="button"
                  data-testid="download-ris-btn"
                  onClick={() => handleDownloadFile(data.combined_ris, 'ris', 'references')}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-violet-600 hover:bg-violet-700 text-white shadow-sm transition-colors"
                >
                  <FileCode2 className="h-3.5 w-3.5" />
                  <span>.RIS</span>
                </button>

                <button
                  type="button"
                  data-testid="download-auto-healed-docx-btn"
                  onClick={() => void handleDownloadHealedDocx()}
                  disabled={!isDocxSource || healedBusy}
                  aria-disabled={!isDocxSource}
                  aria-busy={healedBusy}
                  title={isDocxSource ? undefined : healedDisabledHint}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {healedBusy ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="h-3.5 w-3.5" />
                  )}
                  <span>
                    {lang === 'vi'
                      ? 'Xuất Word (.docx) kèm nhật ký chỉnh sửa'
                      : 'Export Auto-Healed .DOCX + Edit Log'}
                  </span>
                </button>
                {!isDocxSource && (
                  <span
                    data-testid="auto-healed-docx-hint"
                    className="text-[11px] text-slate-600 dark:text-slate-400"
                  >
                    {healedDisabledHint}
                  </span>
                )}
              </>
            )}
          </div>
        </div>

        {/* Body Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4 bg-slate-50/50 dark:bg-slate-950/60">
          {healedError && (
            <div
              role="alert"
              data-testid="auto-healed-docx-error"
              className="p-3 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-xs text-red-700 dark:text-red-300"
            >
              {healedError}
            </div>
          )}
          {loading ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <Loader2 className="h-8 w-8 animate-spin text-indigo-600 dark:text-indigo-400" />
              <p className="text-xs font-mono text-slate-500 dark:text-slate-400">
                {lang === 'vi'
                  ? 'Đang tổng hợp metadata chuẩn và định dạng lại danh mục tài liệu tham khảo...'
                  : 'Synthesizing canonical scholarly metadata & formatting bibliography...'}
              </p>
            </div>
          ) : error ? (
            <div className="p-6 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-sm text-red-700 dark:text-red-300">
              {error}
            </div>
          ) : visibleEntries.length === 0 ? (
            <div className="p-12 text-center text-sm text-slate-500 dark:text-slate-400">
              {lang === 'vi'
                ? 'Không có mục tài liệu tham khảo nào cần sửa đổi trong bộ lọc hiện tại.'
                : 'No bibliography entries match the current filter.'}
            </div>
          ) : (
            visibleEntries.map((entry) => {
              const rawIdx = String(
                entry.display_index || entry.composite_label || entry.index
              ).trim();
              const formattedIndex =
                rawIdx.startsWith('[') && rawIdx.endsWith(']')
                  ? rawIdx
                  : `[${rawIdx}]`;

              const isHallucination =
                entry.remediation_status === 'hallucination' ||
                Boolean(entry.is_hallucination) ||
                entry.label === 'suspected_hallucination';
              const isIncompleteMeta = Boolean(
                entry.triggered_rules?.includes('R-INCOMPLETE-METADATA')
              );
              const isManualReview =
                !isHallucination &&
                (entry.remediation_status === 'manual_review' ||
                  isIncompleteMeta ||
                  (entry.label === 'metadata_error' &&
                    !entry.was_modified &&
                    entry.remediation_status !== 'repaired'));
              const isResource =
                !isHallucination &&
                !isManualReview &&
                (entry.remediation_status === 'resource' || entry.label === 'resource');
              const isMetadataError =
                !isHallucination &&
                !isManualReview &&
                !isResource &&
                entry.label === 'metadata_error';
              const isFlaggedError =
                isHallucination ||
                isMetadataError ||
                (!isManualReview && !isResource && Boolean(entry.is_error));

              return (
                <div
                  key={entry.verdict_id}
                  data-testid={`remediation-entry-card-${entry.index}`}
                  data-verdict-label={entry.label}
                  data-remediation-status={entry.remediation_status || ''}
                  className="rounded-xl p-4 shadow-sm space-y-3 border transition-all bg-white dark:bg-slate-900 border-slate-200/90 dark:border-slate-800"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span
                        data-testid={`remediation-entry-index-${entry.index}`}
                        className={`px-2 py-0.5 rounded font-mono text-xs font-bold ${
                          isFlaggedError
                            ? 'text-red-600 dark:text-red-400 bg-slate-100 dark:bg-slate-800'
                            : isManualReview
                              ? 'text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/70 border border-amber-200 dark:border-amber-800'
                              : isResource
                                ? 'text-sky-700 dark:text-sky-300 bg-sky-50 dark:bg-sky-950/70 border border-sky-200 dark:border-sky-800'
                                : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                        }`}
                      >
                        {formattedIndex}
                      </span>

                      {isHallucination ? (
                        <span className="inline-flex items-center gap-1.5 text-[11px] font-mono font-bold text-red-600 dark:text-red-400">
                          <XCircle className="h-3.5 w-3.5" />
                          {lang === 'vi'
                            ? 'Không tìm thấy nguồn — Cần kiểm tra lại bản gốc'
                            : 'Source Not Found — Manual Verification Required'}
                        </span>
                      ) : isManualReview ? (
                        <>
                          <span
                            data-testid={`remediation-status-manual-${entry.index}`}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-mono font-semibold bg-amber-50 dark:bg-amber-950/80 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800"
                          >
                            {isIncompleteMeta && <AlertTriangle className="h-3 w-3" />}
                            {isIncompleteMeta
                              ? lang === 'vi'
                                ? 'Cần bổ sung thủ công'
                                : 'Manual Completion Needed'
                              : lang === 'vi'
                                ? '⚠ Cần kiểm tra thủ công'
                                : '⚠ Manual Review Required'}
                          </span>
                          {isIncompleteMeta && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-mono font-semibold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                              {lang === 'vi'
                                ? 'Thiếu quy cách trích dẫn'
                                : 'Incomplete Reference'}
                            </span>
                          )}
                        </>
                      ) : isResource ? (
                        <span
                          data-testid={`remediation-status-resource-${entry.index}`}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-mono font-semibold bg-sky-50 dark:bg-sky-950/80 text-sky-700 dark:text-sky-300 border border-sky-200 dark:border-sky-800"
                        >
                          <Globe className="h-3 w-3" />
                          {lang === 'vi'
                            ? 'Nguồn Web & Văn bản'
                            : 'Web / Statutory Resource'}
                        </span>
                      ) : isMetadataError ? (
                        <>
                          <span className="inline-flex items-center gap-1 text-[11px] font-mono font-bold text-amber-700 dark:text-amber-300">
                            <AlertTriangle className="h-3 w-3 text-amber-600 dark:text-amber-400" />
                            {lang === 'vi'
                              ? 'Sai lệch thông tin cần chuẩn hóa'
                              : 'Details Mismatch'}
                          </span>
                          {entry.was_modified ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-mono font-semibold bg-emerald-50 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-300">
                              {lang === 'vi' ? '✓ Đã tự động khôi phục chuẩn' : '✓ Auto-Repaired'}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-mono font-semibold bg-amber-50 dark:bg-amber-950/80 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
                              {lang === 'vi' ? '⚠ Cần bổ sung thủ công' : '⚠ Manual Completion Needed'}
                            </span>
                          )}
                        </>
                      ) : entry.was_modified || entry.remediation_status === 'repaired' ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-mono font-semibold bg-amber-50 dark:bg-amber-950/80 text-amber-700 dark:text-amber-300">
                          <AlertTriangle className="h-3 w-3" />
                          {lang === 'vi' ? 'Đã bổ sung thông tin thiếu' : 'Metadata Enriched'}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-mono font-semibold bg-emerald-50 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-300">
                          <CheckCircle2 className="h-3 w-3" />
                          {lang === 'vi' ? 'Đã xác minh & Chuẩn hóa' : 'Verified & Standardized'}
                        </span>
                      )}

                      {entry.diff_fields.map((field) => {
                        const fieldLabel = getFieldDisplayName(field, lang).replace(
                          /^the\s+/i,
                          '',
                        );
                        return (
                          <span
                            key={field}
                            className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                              isFlaggedError
                                ? 'text-red-600 dark:text-red-400 font-bold'
                                : 'text-indigo-700 dark:text-indigo-300'
                            }`}
                          >
                            {isFlaggedError
                              ? lang === 'vi'
                                ? `Sửa: ${fieldLabel}`
                                : `Fix: ${fieldLabel}`
                              : `+${fieldLabel}`}
                          </span>
                        );
                      })}
                      {entry.source_used && (
                        <span className="text-[11px] text-slate-500 dark:text-slate-400">
                          {lang === 'vi'
                            ? `Nguồn đối chiếu: ${getSourceDisplayName(entry.source_used, lang)}`
                            : `Matched via ${getSourceDisplayName(entry.source_used, lang)}`}
                        </span>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() => handleCopy(entry.remediated_text, entry.verdict_id)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-mono text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                    >
                      <IconSwap
                        active={copiedKey === entry.verdict_id}
                        iconA={<Copy className="h-3.5 w-3.5" />}
                        iconB={<Check className="h-3.5 w-3.5 text-emerald-500" />}
                      />
                      <TextMorph
                        text={
                          copiedKey === entry.verdict_id
                            ? lang === 'vi'
                              ? 'Đã chép'
                              : 'Copied'
                            : lang === 'vi'
                              ? 'Sao chép'
                              : 'Copy'
                        }
                      />
                    </button>
                  </div>

                  {isHallucination && (
                    <div className="px-1 py-1 text-xs text-red-600 dark:text-red-400 flex items-start gap-2">
                      <XCircle className="h-4 w-4 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
                      <div>
                        <span className="font-bold">
                          {lang === 'vi'
                            ? 'Lưu ý hỗ trợ rà soát — Chưa tìm thấy bản gốc: '
                            : 'Decision-Support Notice — Source Not Found: '}
                        </span>
                        <span>
                          {sanitizeReasoningForDisplay(entry.reasoning, lang) ||
                            (lang === 'vi'
                              ? 'Chưa tìm thấy bản ghi khớp trong các cơ sở dữ liệu học thuật hoặc phát hiện bất thường ở mã định danh. Vui lòng đối chiếu lại bản gốc trước khi trích dẫn.'
                              : 'No matching scholarly record was found or metadata anomalies were detected. Please manually verify the original publication before citing.')}
                        </span>
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-1 lg:grid-cols-11 gap-3 items-stretch">
                    {/* Original Raw Text */}
                    <div className="lg:col-span-5 rounded-lg p-3 bg-slate-50 dark:bg-slate-950/70">
                      <div
                        className={`text-[10px] font-mono uppercase tracking-wider mb-1 font-semibold ${
                          isFlaggedError
                            ? 'text-red-600 dark:text-red-400'
                            : isManualReview
                              ? 'text-amber-700 dark:text-amber-400'
                              : isResource
                                ? 'text-sky-700 dark:text-sky-400'
                                : 'text-slate-400'
                        }`}
                      >
                        {isHallucination
                          ? lang === 'vi'
                            ? '✕ Mục chưa tìm thấy nguồn trong bài nộp'
                            : '✕ Unmatched Reference in Manuscript'
                          : isManualReview
                            ? lang === 'vi'
                              ? '⚠ Mục tham khảo thiếu thông tin trong bài nộp'
                              : '⚠ Incomplete Reference in Manuscript'
                            : isResource
                              ? lang === 'vi'
                                ? 'Nguồn Web & Văn bản trong bài nộp'
                                : 'Web / Statutory Source in Manuscript'
                              : isMetadataError
                                ? lang === 'vi'
                                  ? '⚠ Bản ghi sai lệch thông tin trong bài nộp'
                                  : '⚠ Mismatched Entry in Manuscript'
                                : lang === 'vi'
                                  ? 'Bản gốc trong bài nộp'
                                  : 'Original in Manuscript'}
                      </div>
                      <p
                        className={`text-xs font-serif break-words leading-relaxed ${
                          isFlaggedError
                            ? 'text-red-600 dark:text-red-400 font-medium line-through decoration-red-500/60'
                            : 'text-slate-600 dark:text-slate-400'
                        }`}
                      >
                        {entry.original_raw}
                      </p>
                    </div>

                    <div
                      className={`hidden lg:flex lg:col-span-1 items-center justify-center ${
                        isHallucination
                          ? 'text-red-500'
                          : isManualReview
                            ? 'text-amber-500'
                            : isResource
                              ? 'text-sky-500'
                              : 'text-indigo-500'
                      }`}
                    >
                      <ArrowRight className="h-4 w-4" />
                    </div>

                    {/* Remediated Canonical Output */}
                    <div className="lg:col-span-5 rounded-lg p-3 bg-slate-50 dark:bg-slate-950/70">
                      <div
                        className={`flex items-center justify-between text-[10px] font-mono uppercase tracking-wider mb-1 font-semibold ${
                          isHallucination
                            ? 'text-red-600 dark:text-red-400'
                            : isManualReview
                              ? 'text-amber-700 dark:text-amber-400'
                              : isResource
                                ? 'text-sky-700 dark:text-sky-400'
                                : isMetadataError
                                  ? entry.was_modified
                                    ? 'text-emerald-700 dark:text-emerald-400'
                                    : 'text-amber-700 dark:text-amber-400'
                                  : 'text-indigo-600 dark:text-indigo-400'
                        }`}
                      >
                        <span>
                          {isHallucination
                            ? lang === 'vi'
                              ? `✕ Không tìm thấy nguồn — Cần kiểm tra lại (${selectedStyle.toUpperCase()})`
                              : `✕ Source Not Found — Verify Manually (${selectedStyle.toUpperCase()})`
                            : isManualReview
                              ? lang === 'vi'
                                ? `⚠ Cần bổ sung thủ công (${selectedStyle.toUpperCase()})`
                                : `⚠ Manual Completion Needed (${selectedStyle.toUpperCase()})`
                              : isResource
                                ? lang === 'vi'
                                  ? `↗ Nguồn Web & Văn bản (${selectedStyle.toUpperCase()})`
                                  : `↗ Web / Statutory Resource (${selectedStyle.toUpperCase()})`
                                : isMetadataError
                                  ? entry.was_modified
                                    ? lang === 'vi'
                                      ? `✓ Bản đã sửa lỗi & Chuẩn hóa (${selectedStyle.toUpperCase()})`
                                      : `✓ Auto-Repaired & Standardized (${selectedStyle.toUpperCase()})`
                                    : lang === 'vi'
                                      ? `⚠ Cần bổ sung thủ công (${selectedStyle.toUpperCase()})`
                                      : `⚠ Manual Completion Needed (${selectedStyle.toUpperCase()})`
                                  : lang === 'vi'
                                    ? `Bản chuẩn hóa (${selectedStyle.toUpperCase()})`
                                    : `Canonical Output (${selectedStyle.toUpperCase()})`}
                        </span>
                        <BookOpen className="h-3 w-3" />
                      </div>
                      <pre
                        className={`text-xs font-mono whitespace-pre-wrap break-words leading-relaxed ${
                          isHallucination
                            ? 'text-red-600 dark:text-red-400 font-medium'
                            : 'text-slate-900 dark:text-slate-100'
                        }`}
                      >
                        {deduplicateRepeatedVenue(entry.remediated_text)}
                      </pre>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
