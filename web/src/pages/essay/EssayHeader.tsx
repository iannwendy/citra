import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft,
  Download,
  ShieldCheck,
  Lock,
  Sparkles,
  Loader2,
  Share2,
  ExternalLink,
  Check,
  ChevronDown,
} from 'lucide-react';
import { api, type EssayShareLinkResponse } from '@/api/client';
import { IconSwap, TextMorph } from '@/components/ui/transitions';
import { useRole } from '@/hooks/useRole';
import { UpgradeModal } from '@/components/UpgradeModal';
import { BibliographyRemediationModal } from '@/components/BibliographyRemediationModal';
import { FileFormatIcon } from '@/components/FileFormatIcon';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tooltip } from '@/components/ui/tooltip';
import { useToast } from '@/contexts/ToastContext';
import { copyTextToClipboard } from '@/lib/clipboard';
import { isDocxFilename, type ExportFormat } from '@/lib/fileKind';
import { formatUserError } from '@/lib/academicTaxonomy';

/* ============================================================
   EssayHeader — Compact Editorial Document Topbar
   Single-purpose Zone 1: Document Identity + Primary Fix CTA + Grouped Export Menu
   ============================================================ */

export interface EssayHeaderProps {
  essayId: number;
  filename: string;
  numPages: number;
  numCitations: number;
  numReferences?: number;
  styleName?: string;
  onOpenRemediation?: () => void;
}

export function EssayHeader({
  essayId,
  filename,
  numPages,
  numCitations,
  numReferences,
  styleName,
  onOpenRemediation,
}: EssayHeaderProps) {
  const { t, i18n } = useTranslation();
  const { has, quota } = useRole();
  const toast = useToast();
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [lockedFormat, setLockedFormat] = useState<string>('PDF');
  const [remediationOpen, setRemediationOpen] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [busy, setBusy] = useState<ExportFormat | 'healed' | 'share' | null>(null);
  const [shareInfo, setShareInfo] = useState<EssayShareLinkResponse | null>(null);
  const exportMenuRef = useRef<HTMLDivElement | null>(null);
  const lang = i18n.language?.startsWith('vi') ? 'vi' : 'en';
  const isVi = lang === 'vi';

  const allowedFormats = new Set<string>(
    (quota?.allowed_export_formats ?? []).map((f) => f.toLowerCase()),
  );
  const canExport = (fmt: ExportFormat) => allowedFormats.has(fmt);
  const canExportHealed = canExport('docx');
  const canUseRemediation = has('view_logic_trace');
  const isDocxSource = isDocxFilename(filename);

  useEffect(() => {
    if (!exportMenuOpen) return;
    const handlePointerDown = (e: MouseEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) {
        setExportMenuOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setExportMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [exportMenuOpen]);

  const openUpgrade = (label: string) => {
    setExportMenuOpen(false);
    setLockedFormat(label);
    setUpgradeOpen(true);
  };

  const handleRemediationClick = () => {
    if (!canUseRemediation) {
      openUpgrade(
        isVi
          ? 'Sửa & Chuẩn hóa Danh mục Tài liệu Tham khảo'
          : 'Fix & Format Citations',
      );
      return;
    }
    if (onOpenRemediation) {
      onOpenRemediation();
    } else {
      setRemediationOpen(true);
    }
  };

  const runDownload = async (
    key: ExportFormat | 'healed',
    label: string,
    fn: () => Promise<void>,
  ) => {
    if (busy) return;
    setBusy(key);
    try {
      await fn();
      setExportMenuOpen(false);
      toast.success(
        isVi ? `Đã tải báo cáo (${label})` : `Downloaded ${label} report`,
        filename,
      );
    } catch (err) {
      const friendly = formatUserError(
        err,
        lang,
        t('essay.export.failedMessage', { format: label }),
      );
      toast.error(t('essay.export.failedTitle'), friendly);
    } finally {
      setBusy(null);
    }
  };

  const handleDownload = (fmt: ExportFormat) => {
    const label = fmt.toUpperCase();
    if (!canExport(fmt)) {
      openUpgrade(label);
      return;
    }
    void runDownload(fmt, label, () => api.downloadReportFile(essayId, fmt, filename));
  };

  const handleDownloadHealedDocx = () => {
    if (!isDocxSource) return;
    const healedLabel = isVi
      ? 'Bản Word gợi ý sửa (.docx)'
      : 'Word with Suggestions (.docx)';
    if (!canExportHealed) {
      openUpgrade(healedLabel);
      return;
    }
    const healedStyle = /ieee/i.test(styleName ?? '')
      ? 'ieee'
      : /tdtu/i.test(styleName ?? '')
        ? 'tdtu'
        : 'apa';
    void runDownload('healed', healedLabel, () =>
      api.downloadAutoHealedDocx(essayId, healedStyle, filename),
    );
  };

  const handleShareReceipt = async () => {
    if (busy) return;
    setBusy('share');
    try {
      const res = await api.createEssayShareLink(essayId);
      setShareInfo(res);
      setExportMenuOpen(false);
      const origin =
        typeof window !== 'undefined' && window.location?.origin
          ? window.location.origin
          : 'https://citra.io.vn';
      const fullUrl = `${origin}/verify/share/${res.share_token}`;
      await copyTextToClipboard(fullUrl);
      toast.success(
        t('essay.share.toastTitle'),
        `${res.receipt_id} — ${t('essay.share.toastCopied')}`,
      );
    } catch (err) {
      const friendly = formatUserError(err, lang, t('essay.share.failedMessage'));
      toast.error(t('essay.share.failedTitle'), friendly);
    } finally {
      setBusy(null);
    }
  };

  const renderMenuFormatItem = (
    fmt: ExportFormat,
    titleVi: string,
    titleEn: string,
    subVi?: string,
    subEn?: string,
  ) => {
    const label = fmt.toUpperCase();
    const locked = !canExport(fmt);
    const loading = busy === fmt;
    return (
      <button
        key={fmt}
        type="button"
        role="menuitem"
        onClick={() => handleDownload(fmt)}
        disabled={loading}
        data-testid={`export-${fmt}-btn`}
        data-locked={locked ? 'true' : 'false'}
        aria-busy={loading}
        aria-label={
          locked
            ? t('essay.export.lockedHint', { format: label })
            : t('essay.export.download', { filename, format: label })
        }
        title={locked ? t('essay.export.lockedHint', { format: label }) : undefined}
        className="w-full flex items-center justify-between gap-2.5 px-3 py-2 rounded-xl text-left text-xs sm:text-[13px] text-slate-800 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors disabled:opacity-50 cursor-pointer"
      >
        <div className="flex items-start gap-2.5 min-w-0">
          <span className="mt-0.5 shrink-0">
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin text-indigo-600" />
            ) : locked ? (
              <Lock className="h-4 w-4 text-amber-500" />
            ) : fmt === 'pdf' || fmt === 'docx' ? (
              <FileFormatIcon format={fmt} size="xs" />
            ) : (
              <Download className="h-4 w-4 text-slate-500" />
            )}
          </span>
          <div className="min-w-0">
            <span className="font-semibold block truncate">
              {isVi ? titleVi : titleEn}
            </span>
            {(subVi || subEn) && (
              <span className="text-[11px] text-slate-500 dark:text-slate-400 block">
                {isVi ? subVi : subEn}
              </span>
            )}
          </div>
        </div>
        {locked && (
          <span className="shrink-0 px-1.5 py-0.5 rounded-full bg-indigo-500/15 text-indigo-600 dark:text-indigo-300 text-[10px] font-bold">
            PRO
          </span>
        )}
      </button>
    );
  };

  const hasDistinctReferences =
    typeof numReferences === 'number' &&
    numReferences > 0 &&
    numReferences !== numCitations;

  return (
    <div className="relative rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 px-4 py-3.5 sm:px-5 shadow-sm">
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3.5 w-full min-w-0">
        {/* Document Identity Cluster */}
        <div className="flex flex-col items-start gap-2.5 sm:flex-row sm:items-center sm:gap-3 min-w-0 flex-1">
          <Link
            to="/history"
            data-testid="header-back-btn"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-400 px-2.5 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700 transition-colors shrink-0"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            <span>{isVi ? 'Quay lại' : 'Back'}</span>
          </Link>

          <div className="flex items-start sm:items-center gap-3 min-w-0 w-full sm:flex-1">
            <span className="shrink-0 mt-0.5 sm:mt-0">
              <FileFormatIcon filename={filename} size="md" />
            </span>

            <div className="min-w-0 flex-1">
              <h1
                className="font-sans text-base sm:text-lg lg:text-xl font-bold text-slate-900 dark:text-slate-100 truncate tracking-tight"
                title={filename}
              >
                {filename}
              </h1>

              <div className="text-xs sm:text-[13px] text-slate-600 dark:text-slate-400 mt-0.5 leading-relaxed">
                <span>
                  {numPages}{' '}
                  {!isVi && numPages === 1 ? 'page' : t('history.pages')}
                </span>
                <span className="mx-1.5 text-slate-300 dark:text-slate-600" aria-hidden="true">
                  •
                </span>
                <span data-testid="header-citation-summary" className="mr-2">
                  {hasDistinctReferences ? (
                    isVi ? (
                      <>
                        <strong className="font-semibold text-slate-900 dark:text-slate-100">
                          {numReferences}
                        </strong>{' '}
                        tài liệu tham khảo{' '}
                        <span className="text-slate-500 dark:text-slate-400">
                          ({numCitations} lượt trích trong bài)
                        </span>
                      </>
                    ) : (
                      <>
                        <strong className="font-semibold text-slate-900 dark:text-slate-100">
                          {numReferences}
                        </strong>{' '}
                        {numReferences === 1 ? 'reference' : 'references'}{' '}
                        <span className="text-slate-500 dark:text-slate-400">
                          ({numCitations} in-text{' '}
                          {numCitations === 1 ? 'mention' : 'mentions'})
                        </span>
                      </>
                    )
                  ) : (
                    <>
                      {numCitations}{' '}
                      {!isVi && numCitations === 1
                        ? 'citation'
                        : t('essay.citationsTab').toLowerCase()}
                    </>
                  )}
                </span>

                {styleName && styleName.trim().toUpperCase() !== 'UNKNOWN' && (
                  <Badge
                    variant="secondary"
                    className="align-middle text-[11px] font-medium px-2 py-0"
                  >
                    {isVi ? `Chuẩn: ${styleName}` : `Style: ${styleName}`}
                  </Badge>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Clean 2-Control Action Cluster (Primary Fix CTA + Grouped Export Menu) */}
        <div className="relative flex items-center gap-2 shrink-0 flex-wrap sm:flex-nowrap w-full sm:w-auto">
          <Button
            type="button"
            size="sm"
            data-testid="header-remediation-btn"
            onClick={handleRemediationClick}
            className="h-9 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs sm:text-[13px] font-semibold shadow-sm px-3.5 cursor-pointer"
          >
            <Sparkles className="h-3.5 w-3.5 text-amber-300 shrink-0" />
            <span>
              {isVi ? 'Sửa & Chuẩn hóa trích dẫn' : 'Fix & Format Citations'}
            </span>
          </Button>

          <div ref={exportMenuRef} className="sm:relative">
            <Button
              type="button"
              variant="outline"
              size="sm"
              data-testid="export-menu-trigger"
              aria-expanded={exportMenuOpen}
              aria-haspopup="menu"
              onClick={() => setExportMenuOpen((v) => !v)}
              className="h-9 rounded-xl text-xs sm:text-[13px] font-semibold px-3.5 border-slate-300 dark:border-slate-700 cursor-pointer"
            >
              <Download className="h-3.5 w-3.5 text-slate-500 shrink-0" />
              <span>{isVi ? 'Xuất báo cáo' : 'Export Report'}</span>
              <ChevronDown
                className={`h-3.5 w-3.5 text-slate-500 transition-transform duration-150 ${
                  exportMenuOpen ? 'rotate-180' : ''
                }`}
              />
            </Button>

            <div
              role="menu"
              data-testid="export-dropdown-menu"
              data-open={exportMenuOpen ? 'true' : 'false'}
              className={`absolute left-0 sm:left-auto sm:right-0 top-[calc(100%+6px)] z-50 w-full max-w-[18rem] sm:w-72 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-1.5 shadow-xl origin-top-left sm:origin-top-right transition-all duration-150 ${
                exportMenuOpen
                  ? 'opacity-100 scale-100 pointer-events-auto visible'
                  : 'opacity-0 scale-95 pointer-events-none invisible'
              }`}
            >
              <div className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                {isVi ? 'Tài liệu báo cáo' : 'Report Documents'}
              </div>

              {renderMenuFormatItem(
                'pdf',
                'Báo cáo kiểm tra (.PDF)',
                'Verification Report (.PDF)',
                'Bản trình bày chuẩn để nộp hoặc lưu trữ',
                'Formatted report for submission or archiving',
              )}

              {renderMenuFormatItem(
                'docx',
                'Báo cáo chi tiết (.DOCX)',
                'Detailed Report (.DOCX)',
                'Dễ dàng ghi chú và chỉnh sửa trên Word',
                'Editable Word report with full notes',
              )}

              <Tooltip
                content={isDocxSource ? undefined : t('essay.export.healedRequiresDocx')}
                className="w-full block"
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={handleDownloadHealedDocx}
                  disabled={!isDocxSource || busy === 'healed'}
                  aria-disabled={!isDocxSource}
                  aria-busy={busy === 'healed'}
                  title={isDocxSource ? undefined : t('essay.export.healedRequiresDocx')}
                  data-testid="export-healed-docx-btn"
                  className="w-full flex items-center justify-between gap-2.5 px-3 py-2 rounded-xl text-left text-xs sm:text-[13px] text-slate-800 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                >
                  <div className="flex items-start gap-2.5 min-w-0">
                    <span className="mt-0.5 shrink-0">
                      {busy === 'healed' ? (
                        <Loader2 className="h-4 w-4 animate-spin text-emerald-600" />
                      ) : !canExportHealed ? (
                        <Lock className="h-4 w-4 text-amber-500" />
                      ) : (
                        <Sparkles className="h-4 w-4 text-emerald-600" />
                      )}
                    </span>
                    <div className="min-w-0">
                      <span className="font-semibold block truncate">
                        {isVi
                          ? 'Tải bản Word gợi ý sửa (.docx)'
                          : 'Download Word with Suggestions'}
                      </span>
                      <span className="text-[11px] text-slate-500 dark:text-slate-400 block">
                        {!isDocxSource
                          ? isVi
                            ? 'Chỉ khả dụng cho tệp Word (.docx)'
                            : 'Available for Word (.docx) files only'
                          : isVi
                            ? 'Thêm gợi ý sửa trích dẫn ngay trên tệp Word gốc'
                            : 'Adds verified citation suggestions to your .docx'}
                      </span>
                    </div>
                  </div>
                  {!canExportHealed && (
                    <span className="shrink-0 px-1.5 py-0.5 rounded-full bg-indigo-500/15 text-indigo-600 dark:text-indigo-300 text-[10px] font-bold">
                      PRO
                    </span>
                  )}
                </button>
              </Tooltip>

              <div className="my-1 h-px bg-slate-200/80 dark:bg-slate-800" />

              <button
                type="button"
                role="menuitem"
                onClick={() => void handleShareReceipt()}
                disabled={busy === 'share'}
                aria-busy={busy === 'share'}
                data-testid="share-receipt-btn"
                className="w-full flex items-center justify-between gap-2.5 px-3 py-2 rounded-xl text-left text-xs sm:text-[13px] text-slate-800 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors disabled:opacity-50 cursor-pointer"
              >
                <div className="flex items-start gap-2.5 min-w-0">
                  <span className="mt-0.5 shrink-0 text-indigo-600 dark:text-indigo-400">
                    {busy === 'share' ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <IconSwap
                        active={Boolean(shareInfo)}
                        iconA={<Share2 className="h-4 w-4" />}
                        iconB={
                          <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                        }
                      />
                    )}
                  </span>
                  <div className="min-w-0">
                    <span className="font-semibold block truncate">
                      <TextMorph text={t('essay.share.buttonLabel')} />
                    </span>
                    <span className="text-[11px] text-slate-500 dark:text-slate-400 block">
                      {isVi
                        ? 'Sao chép liên kết chia sẻ báo cáo gửi giảng viên'
                        : 'Copy a shareable link to this report'}
                    </span>
                  </div>
                </div>
              </button>

              <div className="my-1 h-px bg-slate-200/80 dark:bg-slate-800" />

              <div className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                {isVi ? 'Dữ liệu bảng tính & kỹ thuật' : 'Data Exports'}
              </div>

              {renderMenuFormatItem('csv', 'Bảng tính (.CSV)', 'Spreadsheet (.CSV)')}
              {renderMenuFormatItem('json', 'Dữ liệu JSON (.JSON)', 'JSON Data (.JSON)')}
            </div>
          </div>
        </div>
      </div>

      {shareInfo && (
        <div
          data-testid="shared-receipt-banner"
          className="flex flex-wrap items-center gap-2 text-xs text-indigo-700 dark:text-indigo-300 bg-indigo-50/80 dark:bg-indigo-950/60 border border-indigo-200/80 dark:border-indigo-800/80 rounded-xl px-3 py-1.5 mt-3"
        >
          <ShieldCheck className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
          <span className="font-mono font-bold">{shareInfo.receipt_id}</span>
          <Link
            to={`/verify/share/${shareInfo.share_token}`}
            data-testid="shared-receipt-link"
            className="inline-flex items-center gap-1 font-medium underline hover:text-indigo-900 dark:hover:text-indigo-100"
          >
            {t('essay.share.openPublicReceipt')}
            <ExternalLink className="h-3 w-3" />
          </Link>
        </div>
      )}

      {!onOpenRemediation && (
        <BibliographyRemediationModal
          open={remediationOpen}
          essayId={essayId}
          filename={filename}
          lang={lang}
          onClose={() => setRemediationOpen(false)}
        />
      )}

      <UpgradeModal
        open={upgradeOpen}
        onOpenChange={setUpgradeOpen}
        featureName={t('essay.export.upgradeFeature', { format: lockedFormat })}
        reasonTitle={t('essay.export.upgradeTitle', { format: lockedFormat })}
        reasonDescription={t('essay.export.upgradeDescription', { format: lockedFormat })}
      />
    </div>
  );
}
