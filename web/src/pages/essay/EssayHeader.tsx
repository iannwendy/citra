import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Quote, Clock, Download, ShieldCheck, Lock, Sparkles, Loader2 } from 'lucide-react';
import { api } from '@/api/client';
import { useRole } from '@/hooks/useRole';
import { UpgradeModal } from '@/components/UpgradeModal';
import { FileFormatIcon } from '@/components/FileFormatIcon';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tooltip } from '@/components/ui/tooltip';
import { useToast } from '@/contexts/ToastContext';
import { isDocxFilename, type ExportFormat } from '@/lib/fileKind';

/* ============================================================
   EssayHeader (Scholarly Precision shadcn/ui v2.0)
   Breadcrumb back-link + filename title + meta line + export buttons.
   ============================================================ */

export interface EssayHeaderProps {
  essayId: number;
  filename: string;
  numPages: number;
  numCitations: number;
  styleName?: string;
}

export function EssayHeader({
  essayId,
  filename,
  numPages,
  numCitations,
  styleName,
}: EssayHeaderProps) {
  const { t, i18n } = useTranslation();
  const { isUser, quota } = useRole();
  const toast = useToast();
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [lockedFormat, setLockedFormat] = useState<string>('PDF');
  const [busy, setBusy] = useState<ExportFormat | 'healed' | null>(null);
  const lang = i18n.language?.startsWith('vi') ? 'vi' : 'en';

  // Export permissions come from the plan quota (backend `/auth/me`), never
  // from the role: Pro/Ultra students get every format, Basic only JSON.
  const allowedFormats = new Set<string>(
    (quota?.allowed_export_formats ?? []).map((f) => f.toLowerCase()),
  );
  const canExport = (fmt: ExportFormat) => allowedFormats.has(fmt);
  // Auto-healed DOCX is a premium Word export: it follows the DOCX entitlement.
  const canExportHealed = canExport('docx');
  const isDocxSource = isDocxFilename(filename);

  const openUpgrade = (label: string) => {
    setLockedFormat(label);
    setUpgradeOpen(true);
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
    } catch (err) {
      const detail = err instanceof Error ? err.message : '';
      toast.error(
        t('essay.export.failedTitle'),
        `${t('essay.export.failedMessage', { format: label })}${detail ? ` (${detail})` : ''}`,
      );
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
    if (!canExportHealed) {
      openUpgrade('AUTO-HEALED DOCX');
      return;
    }
    const targetStyle = (styleName || '').toLowerCase().includes('ieee') ? 'ieee' : 'apa';
    void runDownload('healed', 'AUTO-HEALED DOCX', () =>
      api.downloadAutoHealedDocx(essayId, targetStyle, filename),
    );
  };

  const renderFormatButton = (fmt: ExportFormat, primary = false) => {
    const label = fmt.toUpperCase();
    const locked = !canExport(fmt);
    const loading = busy === fmt;
    return (
      <Button
        key={fmt}
        type="button"
        variant={primary ? 'default' : 'outline'}
        size="sm"
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
        className={
          primary
            ? 'h-8 font-mono text-xs rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white w-full sm:w-auto'
            : 'h-8 font-mono text-xs rounded-xl w-full sm:w-auto'
        }
      >
        {loading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : locked ? (
          <Lock className={primary ? 'h-3.5 w-3.5 text-amber-300' : 'h-3.5 w-3.5 text-amber-500'} />
        ) : fmt === 'pdf' || fmt === 'docx' ? (
          <FileFormatIcon format={fmt} size="xs" />
        ) : (
          <Download className="h-3.5 w-3.5" />
        )}
        {label}
        {locked && (
          <span
            className={
              primary
                ? 'ml-1 px-1 py-0.2 rounded bg-amber-400/20 text-amber-200 text-[9px] font-bold'
                : 'ml-1 px-1 py-0.2 rounded bg-indigo-500/15 text-indigo-600 dark:text-indigo-300 text-[9px] font-bold'
            }
          >
            PRO
          </span>
        )}
      </Button>
    );
  };

  return (
    <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 p-4 sm:p-6 shadow-xs overflow-hidden">
      <div className="flex flex-col xl:flex-row items-start justify-between gap-4 w-full min-w-0">
        <div className="w-full min-w-0 flex-1">
          <div className="flex items-center gap-3 flex-wrap mb-2.5">
            <Link
              to="/history"
              className="inline-flex items-center gap-1.5 text-xs font-mono font-semibold text-slate-600 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-400 px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700 transition-colors"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              {t('essay.backToReports').replace(/^←\s*/, '')}
            </Link>
            {!isUser && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-indigo-50 dark:bg-indigo-950/80 border border-indigo-200/70 dark:border-indigo-800/70 text-[11px] font-mono font-semibold text-indigo-700 dark:text-indigo-300">
                <ShieldCheck className="h-3.5 w-3.5" />
                {lang === 'vi' ? 'BÁO CÁO KIỂM CHỨNG HỌC THUẬT' : 'VERIFICATION REPORT IDE'}
              </span>
            )}
          </div>

          <div className="flex items-center gap-3 min-w-0">
            <FileFormatIcon filename={filename} size="lg" />
            <h1
              className="font-display text-lg sm:text-2xl lg:text-3xl font-bold text-slate-900 dark:text-slate-100 break-words [overflow-wrap:anywhere] tracking-tight max-w-full min-w-0 flex-1"
              title={filename}
            >
              {filename}
            </h1>
          </div>

          <div className="flex items-center gap-3 text-sm text-slate-600 dark:text-slate-300 mt-2.5 flex-wrap">
            <span className="inline-flex items-center gap-1.5 font-mono text-xs px-2.5 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
              <FileFormatIcon filename={filename} size="xs" />
              {numPages} {t('history.pages')}
            </span>
            <span className="inline-flex items-center gap-1.5 font-mono text-xs px-2.5 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
              <Quote className="h-3.5 w-3.5 text-emerald-500" />
              {numCitations} {t('essay.citationsTab').toLowerCase()}
            </span>
            {styleName && (
              <Badge variant="secondary" className="font-mono text-xs">
                {styleName}
              </Badge>
            )}
            {!isUser && (
              <span className="inline-flex items-center gap-1.5 font-mono text-xs text-slate-500 dark:text-slate-400">
                <Clock className="h-3.5 w-3.5 text-slate-400" />
                ID #{essayId}
              </span>
            )}
          </div>
        </div>

        {/* Export Actions */}
        <div className="flex flex-col items-start xl:items-end gap-1.5 shrink-0 w-full xl:w-auto">
          <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400 dark:text-slate-500">
            {t('essay.export.sectionLabel')}
          </span>
          <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-2 w-full xl:w-auto">
            {renderFormatButton('json')}
            {renderFormatButton('csv')}
            {renderFormatButton('pdf', true)}
            {renderFormatButton('docx')}
            <Tooltip
              content={isDocxSource ? undefined : t('essay.export.healedRequiresDocx')}
              className="w-full sm:w-auto"
            >
              <Button
                type="button"
                size="sm"
                onClick={handleDownloadHealedDocx}
                disabled={!isDocxSource || busy === 'healed'}
                aria-disabled={!isDocxSource}
                aria-busy={busy === 'healed'}
                title={isDocxSource ? undefined : t('essay.export.healedRequiresDocx')}
                data-testid="export-healed-docx-btn"
                className="h-8 font-mono text-xs rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white w-full sm:w-auto disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {busy === 'healed' ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : !canExportHealed ? (
                  <Lock className="h-3.5 w-3.5 text-amber-300" />
                ) : (
                  <Sparkles className="h-3.5 w-3.5" />
                )}
                <FileFormatIcon format="docx" size="xs" />
                {t('essay.export.healedDocx')}
                {!canExportHealed && (
                  <span className="ml-1 px-1 py-0.2 rounded bg-amber-400/20 text-amber-200 text-[9px] font-bold">
                    PRO
                  </span>
                )}
              </Button>
            </Tooltip>
          </div>
        </div>
      </div>

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
