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
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { isDocxFilename } from '@/lib/fileKind';
import { useModalA11y } from '@/hooks/useModalA11y';

interface BibliographyRemediationModalProps {
  open: boolean;
  essayId: number;
  filename: string;
  lang: 'vi' | 'en';
  onClose: () => void;
}

type StyleOption = 'apa' | 'ieee' | 'tdtu' | 'bibtex' | 'ris';

const STYLE_LABELS: { id: StyleOption; label: string; ext: string }[] = [
  { id: 'apa', label: 'APA 7th Edition', ext: 'txt' },
  { id: 'ieee', label: 'IEEE Numeric', ext: 'txt' },
  { id: 'tdtu', label: 'Harvard / TDTU', ext: 'txt' },
  { id: 'bibtex', label: 'BibTeX (.bib)', ext: 'bib' },
  { id: 'ris', label: 'RIS (.ris)', ext: 'ris' },
];

export function BibliographyRemediationModal({
  open,
  essayId,
  filename,
  lang,
  onClose,
}: BibliographyRemediationModalProps) {
  const [selectedStyle, setSelectedStyle] = useState<StyleOption>('apa');
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
          setError(err instanceof Error ? err.message : 'Failed to load remediated bibliography');
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [open, essayId, selectedStyle]);

  if (!open) return null;

  const handleCopy = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 2000);
    } catch {
      // ignore clipboard errors
    }
  };

  const handleDownloadHealedDocx = async () => {
    if (!isDocxSource || healedBusy) return;
    const targetStyle = selectedStyle === 'ieee' ? 'ieee' : 'apa';
    setHealedBusy(true);
    setHealedError(null);
    try {
      await api.downloadAutoHealedDocx(essayId, targetStyle, filename);
    } catch (err) {
      const detail = err instanceof Error ? err.message : '';
      setHealedError(
        (lang === 'vi'
          ? 'Không thể xuất tệp Word tự sửa lỗi. Vui lòng thử lại.'
          : 'Could not export the auto-healed Word file. Please try again.') +
          (detail ? ` (${detail})` : ''),
      );
    } finally {
      setHealedBusy(false);
    }
  };

  const healedDisabledHint =
    lang === 'vi'
      ? 'Auto-Healed .DOCX chỉ khả dụng với bài nộp dạng tệp .docx'
      : 'Auto-Healed .DOCX is only available for essays uploaded as .docx files';

  const handleDownloadFile = (content: string, ext: string, suffix: string) => {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    const cleanBase = (filename || `essay_${essayId}`).replace(/\.[^/.]+$/, '');
    a.href = url;
    a.download = `${cleanBase}_${suffix}.${ext}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  };

  const flaggedRedCount = data
    ? data.entries.filter(
        (e) =>
          e.is_error ||
          e.is_hallucination ||
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
            e.label === 'suspected_hallucination' ||
            e.label === 'metadata_error'
        )
      : filterMode === 'modified'
        ? data.entries.filter((e) => e.was_modified)
        : data.entries
    : [];

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/65 backdrop-blur-xs p-3 sm:p-4"
      onClick={onClose}
      data-testid="bibliography-remediation-modal"
    >
      <div
        {...dialogProps}
        className="w-full max-w-5xl max-h-[90dvh] flex flex-col rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden outline-none"
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
                    ? '1-Click Chuẩn hóa & Sửa lỗi Danh mục Tài liệu Tham khảo'
                    : '1-Click Bibliography Auto-Remediation & Export Studio'}
                </h2>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-indigo-500/30 border border-indigo-400/40 text-indigo-200">
                  PRO STUDIO
                </span>
              </div>
              <p className="text-xs text-slate-300 mt-0.5">
                {lang === 'vi'
                  ? 'Tự động đối chiếu & khôi phục Năm xuất bản, Tiêu đề, Tác giả, Tạp chí và DOI chuẩn xác từ 15+ CSDL học thuật.'
                  : 'Automatically repairs mismatched Year, Title, Authors, Venue & DOI using canonical records from 15+ scholarly databases.'}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg text-slate-300 hover:text-white hover:bg-white/10 transition-colors"
            aria-label="Close studio"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Toolbar: Style Selector + Bulk Export Actions */}
        <div className="px-6 py-3.5 bg-slate-50 dark:bg-slate-900/90 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Target citation style">
            {STYLE_LABELS.map((st) => (
              <button
                key={st.id}
                type="button"
                data-testid={`remediate-style-${st.id}`}
                onClick={() => setSelectedStyle(st.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-mono font-semibold transition-all ${
                  selectedStyle === st.id
                    ? 'bg-indigo-600 text-white shadow-2xs'
                    : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:border-indigo-400'
                }`}
              >
                {st.label}
              </button>
            ))}
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
                        ? 'bg-red-600 text-white border-red-600 shadow-2xs'
                        : 'bg-red-50 dark:bg-red-950/60 border-red-300 dark:border-red-800 text-red-700 dark:text-red-300 hover:bg-red-100'
                    }`}
                  >
                    <XCircle className="h-3.5 w-3.5" />
                    <span>
                      {lang === 'vi'
                        ? `Nguồn Lỗi & Bịa đặt (${flaggedRedCount})`
                        : `Flagged Errors & Fabricated (${flaggedRedCount})`}
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
                  {copiedKey === 'all' ? (
                    <>
                      <Check className="h-3.5 w-3.5 text-emerald-500" />
                      <span>{lang === 'vi' ? 'Đã sao chép!' : 'Copied All!'}</span>
                    </>
                  ) : (
                    <>
                      <Copy className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />
                      <span>{lang === 'vi' ? 'Sao chép toàn bộ' : 'Copy All'}</span>
                    </>
                  )}
                </button>

                <button
                  type="button"
                  data-testid="download-bibtex-btn"
                  onClick={() => handleDownloadFile(data.combined_bibtex, 'bib', 'references')}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white shadow-2xs transition-colors"
                >
                  <Download className="h-3.5 w-3.5" />
                  <span>.BIB</span>
                </button>

                <button
                  type="button"
                  data-testid="download-ris-btn"
                  onClick={() => handleDownloadFile(data.combined_ris, 'ris', 'references')}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-violet-600 hover:bg-violet-700 text-white shadow-2xs transition-colors"
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
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white shadow-2xs transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {healedBusy ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="h-3.5 w-3.5" />
                  )}
                  <span>
                    {lang === 'vi'
                      ? 'Xuất Word (.docx) Tự sửa lỗi + Change Log'
                      : 'Export Auto-Healed .DOCX + Change Log'}
                  </span>
                </button>
                {!isDocxSource && (
                  <span
                    data-testid="auto-healed-docx-hint"
                    className="text-[11px] text-slate-300"
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
              const isHallucination =
                Boolean(entry.is_hallucination) || entry.label === 'suspected_hallucination';
              const isMetadataError = entry.label === 'metadata_error';
              const isFlaggedError = isHallucination || isMetadataError || Boolean(entry.is_error);

              return (
                <div
                  key={entry.verdict_id}
                  data-testid={`remediation-entry-card-${entry.index}`}
                  data-verdict-label={entry.label}
                  className="rounded-xl p-4 shadow-2xs space-y-3 border transition-all bg-white dark:bg-slate-900 border-slate-200/90 dark:border-slate-800"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span
                        className={`px-2 py-0.5 rounded font-mono text-xs font-bold ${
                          isFlaggedError
                            ? 'text-red-600 dark:text-red-400 bg-slate-100 dark:bg-slate-800'
                            : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                        }`}
                      >
                        #{entry.index}
                      </span>

                      {isHallucination ? (
                        <span className="inline-flex items-center gap-1.5 text-[11px] font-mono font-bold text-red-600 dark:text-red-400">
                          <XCircle className="h-3.5 w-3.5" />
                          {lang === 'vi'
                            ? 'NGUỒN BỊA ĐẶT / ẢO GIÁC AI — CẦN LOẠI BỎ'
                            : 'SUSPECTED HALLUCINATION — FABRICATED SOURCE'}
                        </span>
                      ) : isMetadataError ? (
                        <>
                          <span className="inline-flex items-center gap-1 text-[11px] font-mono font-bold text-red-600 dark:text-red-400">
                            <AlertTriangle className="h-3 w-3 text-red-600 dark:text-red-400" />
                            {lang === 'vi'
                              ? 'Nguồn bị đánh dấu Lỗi Metadata'
                              : 'Flagged Metadata Error'}
                          </span>
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-mono font-semibold bg-emerald-50 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-300">
                            <CheckCircle2 className="h-3 w-3" />
                            {lang === 'vi' ? 'Đã tự động khôi phục chuẩn' : 'Auto-Repaired'}
                          </span>
                        </>
                      ) : entry.was_modified ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-mono font-semibold bg-amber-50 dark:bg-amber-950/80 text-amber-700 dark:text-amber-300">
                          <AlertTriangle className="h-3 w-3" />
                          {lang === 'vi' ? 'Đã bổ sung Metadata thiếu' : 'Metadata Enriched'}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-mono font-semibold bg-emerald-50 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-300">
                          <CheckCircle2 className="h-3 w-3" />
                          {lang === 'vi' ? 'Chuẩn xác & Đã chuẩn hóa' : 'Verified & Standardized'}
                        </span>
                      )}

                      {entry.diff_fields.map((field) => (
                        <span
                          key={field}
                          className={`text-[10px] font-mono uppercase px-1.5 py-0.5 rounded ${
                            isFlaggedError
                              ? 'text-red-600 dark:text-red-400 font-bold'
                              : 'text-indigo-700 dark:text-indigo-300'
                          }`}
                        >
                          {isFlaggedError ? `sửa:${field}` : `+${field}`}
                        </span>
                      ))}
                      {entry.source_used && (
                        <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                          via {entry.source_used}
                        </span>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() => handleCopy(entry.remediated_text, entry.verdict_id)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-mono text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                    >
                      {copiedKey === entry.verdict_id ? (
                        <>
                          <Check className="h-3.5 w-3.5 text-emerald-500" />
                          <span>{lang === 'vi' ? 'Đã chép' : 'Copied'}</span>
                        </>
                      ) : (
                        <>
                          <Copy className="h-3.5 w-3.5" />
                          <span>{lang === 'vi' ? 'Sao chép' : 'Copy'}</span>
                        </>
                      )}
                    </button>
                  </div>

                  {isHallucination && (
                    <div className="px-1 py-1 text-xs text-red-600 dark:text-red-400 flex items-start gap-2">
                      <XCircle className="h-4 w-4 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
                      <div>
                        <span className="font-bold">
                          {lang === 'vi'
                            ? 'Cảnh báo Đỏ — Nguồn Bịa đặt / Không tồn tại: '
                            : 'Red Alert — Fabricated / Non-Existent Source: '}
                        </span>
                        <span>
                          {entry.reasoning ||
                            (lang === 'vi'
                              ? 'Tài liệu tham khảo này không tồn tại trong bất kỳ cơ sở dữ liệu học thuật nào hoặc có dấu hiệu bịa đặt (Fake DOI / Chimera). Tuyệt đối không sử dụng nguồn này trong bài nộp chính thức.'
                              : 'This reference was not found in any scholarly database or exhibits fabrication indicators. Remove this source from your manuscript.')}
                        </span>
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-1 lg:grid-cols-11 gap-3 items-stretch">
                    {/* Original Raw Text (Text colored red if Metadata Error or Suspected Hallucination — no red box frame) */}
                    <div className="lg:col-span-5 rounded-lg p-3 bg-slate-50 dark:bg-slate-950/70">
                      <div
                        className={`text-[10px] font-mono uppercase tracking-wider mb-1 font-semibold ${
                          isFlaggedError
                            ? 'text-red-600 dark:text-red-400'
                            : 'text-slate-400'
                        }`}
                      >
                        {isHallucination
                          ? lang === 'vi'
                            ? '✕ Bản gốc bị phát hiện Bịa đặt / Không tồn tại (Before)'
                            : '✕ Fabricated Source in Manuscript (Before)'
                          : isMetadataError
                            ? lang === 'vi'
                              ? '✕ Bản gốc bị lỗi Metadata trong bài nộp (Before)'
                              : '✕ Erroneous Source in Manuscript (Before)'
                            : lang === 'vi'
                              ? 'Bản gốc trong bài nộp (Before)'
                              : 'Original in Manuscript (Before)'}
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
                        isHallucination ? 'text-red-500' : 'text-indigo-500'
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
                            : isMetadataError
                              ? 'text-emerald-700 dark:text-emerald-400'
                              : 'text-indigo-600 dark:text-indigo-400'
                        }`}
                      >
                        <span>
                          {isHallucination
                            ? lang === 'vi'
                              ? `✕ CẢNH BÁO ĐỎ — Khuyến nghị xóa bỏ (${selectedStyle.toUpperCase()})`
                              : `✕ RED ALERT — Remove Fabricated Entry (${selectedStyle.toUpperCase()})`
                            : isMetadataError
                              ? lang === 'vi'
                                ? `✓ Bản đã sửa lỗi & Chuẩn hóa (${selectedStyle.toUpperCase()})`
                                : `✓ Auto-Repaired & Standardized (${selectedStyle.toUpperCase()})`
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
                        {entry.remediated_text}
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
