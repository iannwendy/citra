import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Loader2,
  FileText,
  Trash2,
  Search,
  Clock,
  Upload,
  XCircle,
  RefreshCw,
  ChevronRight,
  AlertTriangle,
  Archive,
  Layers,
} from 'lucide-react';
import { useToast } from '@/contexts/ToastContext';
import { ConfirmationModal } from '@/components/ConfirmationModal';
import {
  FileFormatIcon,
  getDocumentFormat,
} from '@/components/FileFormatIcon';
import { useRole } from '@/hooks/useRole';
import { useEssays, useDeleteEssay } from '@/hooks/useEssays';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Alert, AlertDescription } from '@/components/ui/alert';

/* ============================================================
   SourceLogic — History Page Component (Scholarly Precision v2.0)
   ============================================================ */

export function HistoryPage() {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const { isTeacher, isAdmin, canBatchUpload } = useRole();
  const {
    data: items = [],
    isLoading,
    error,
    refetch,
    isFetching,
  } = useEssays();
  const deleteMutation = useDeleteEssay();
  const [searchQuery, setSearchQuery] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  const lang = i18n.language?.startsWith('vi') ? 'vi' : 'en';

  const errorMessage = error
    ? error instanceof Error
      ? error.message
      : t('error.network')
    : null;
  const deletingId = deleteMutation.isPending
    ? (deleteMutation.variables ?? null)
    : null;

  const handleDelete = async () => {
    const id = confirmDeleteId;
    if (id == null) return;
    setConfirmDeleteId(null);
    try {
      await deleteMutation.mutateAsync(id);
      toast.success(t('dashboard.documentDeleted'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('dashboard.deleteFailed'));
    }
  };

  const filteredItems = items.filter((item) =>
    item.filename.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const dateLocale = lang === 'vi' ? 'vi-VN' : 'en-US';

  return (
    <div className="space-y-6 pb-10">
      {/* Executive Header Banner */}
      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 p-5 sm:p-6 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2.5 flex-wrap">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-950/80 border border-indigo-200/70 dark:border-indigo-800/70 text-[11px] font-mono font-semibold text-indigo-700 dark:text-indigo-300">
              <Archive className="h-3 w-3" />
              {lang === 'vi'
                ? 'KHO LƯU TRỮ BÁO CÁO KIỂM CHỨNG'
                : 'VERIFICATION REPORTS ARCHIVE'}
            </span>
          </div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            {t('history.title')}
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            {t(
              items.length === 1
                ? 'history.documentCountOne'
                : 'history.documentCountOther',
              { count: items.length }
            )}
          </p>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap shrink-0">
          {canBatchUpload && (
            <Button
              asChild
              variant="outline"
              size="sm"
              className="h-10 rounded-xl font-medium"
            >
              <Link to="/batch-upload" data-testid="batch-check-link">
                <Layers className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                <span>{t('nav.batchCheck')}</span>
              </Link>
            </Button>
          )}
          <Button
            asChild
            size="sm"
            className="h-10 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold shadow-sm shadow-indigo-600/20 btn-shimmer"
          >
            <Link to="/upload">
              <Upload className="h-4 w-4" />
              {t('dashboard.newCheck')}
            </Link>
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={() => refetch()}
            disabled={isFetching}
            aria-label="Refresh history"
            title={t('common.refresh')}
            className="h-10 w-10 rounded-xl"
          >
            <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {/* Error */}
      {errorMessage && (
        <Alert variant="destructive" className="rounded-2xl">
          <AlertTriangle className="h-5 w-5" />
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      )}

      {/* IDE Window Container for Archive List */}
      <Card className="p-0 overflow-hidden rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm">
        {/* Top Window Chrome */}
        <div className="px-4 sm:px-6 py-3.5 bg-slate-50/80 dark:bg-slate-900/90 border-b border-slate-200/80 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-red-400/80 inline-block" />
              <span className="w-2.5 h-2.5 rounded-full bg-amber-400/80 inline-block" />
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400/80 inline-block" />
            </div>
            <Separator orientation="vertical" className="h-4" />
            <span className="font-mono text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300">
              {lang === 'vi' ? 'DANH MỤC BÁO CÁO ĐÃ LƯU' : 'ARCHIVED VERIFICATION REPORTS'}
            </span>
            <Badge
              variant="secondary"
              className="font-mono text-[11px] bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300 border border-indigo-200/60 dark:border-indigo-800/60"
            >
              {filteredItems.length} / {items.length}
            </Badge>
          </div>

          {/* Search Input inside Chrome Bar */}
          <div className="relative w-full sm:w-80">
            <Search
              className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 dark:text-slate-500 pointer-events-none"
              aria-hidden="true"
            />
            <Input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('dashboard.searchPlaceholder')}
              aria-label="Search documents"
              className="t-clear-input h-9 pl-9 pr-8 text-xs rounded-xl bg-white dark:bg-slate-950 border-slate-200 dark:border-slate-800"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                aria-label="Clear search"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
              >
                <XCircle className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>

        {/* Loading / Empty / List */}
        {isLoading && items.length === 0 ? (
          <div className="p-14 flex flex-col items-center justify-center">
            <Loader2 className="h-8 w-8 text-indigo-600 dark:text-indigo-400 animate-spin mb-4" />
            <p className="text-sm font-mono text-slate-600 dark:text-slate-300">
              {t('dashboard.loadingDocuments')}
            </p>
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="p-14 text-center">
            <div className="flex items-center justify-center w-16 h-16 rounded-2xl bg-slate-100 dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700 mx-auto mb-4">
              <FileText className="h-8 w-8 text-slate-400 dark:text-slate-500" />
            </div>
            {searchQuery ? (
              <>
                <h3 className="font-display text-xl font-bold text-slate-900 dark:text-slate-100 mb-1.5">
                  {t('dashboard.noDocumentsFound')}
                </h3>
                <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">
                  {t('dashboard.noDocumentsMatch', { query: searchQuery })}
                </p>
                <Button variant="outline" size="sm" onClick={() => setSearchQuery('')} className="rounded-xl">
                  {t('dashboard.clearSearch')}
                </Button>
              </>
            ) : (
              <>
                <h3 className="font-display text-xl font-bold text-slate-900 dark:text-slate-100 mb-1.5">
                  {t('dashboard.noDocumentsYet')}
                </h3>
                <p className="text-sm text-slate-600 dark:text-slate-400 mb-6 max-w-md mx-auto">
                  {isAdmin
                    ? t('dashboard.noDocumentsAdmin')
                    : isTeacher
                      ? t('dashboard.noDocumentsTeacher')
                      : t('dashboard.noDocumentsStudent')}
                </p>
                <Button asChild className="rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white">
                  <Link to="/upload">
                    <Upload className="h-4 w-4" />
                    {t('dashboard.uploadDocument')}
                  </Link>
                </Button>
              </>
            )}
          </div>
        ) : (
          <div className="t-skel-reveal p-4 sm:p-5 space-y-3">
            {filteredItems.map((essay, idx) => {
              const jobStatus = (essay.job_status || 'completed').toLowerCase();
              const isQueued = jobStatus === 'queued';
              const isProcessing = jobStatus === 'processing';
              const isInProgress = isQueued || isProcessing;
              const isFailed = jobStatus === 'failed';
              const targetHref =
                isInProgress || isFailed
                  ? `/verification/processing/${essay.id}`
                  : `/verification/report/${essay.id}`;
              const cisDisplay =
                !isFailed && !isInProgress && typeof essay.cis_score === 'number'
                  ? `${Math.round(essay.cis_score)}/100`
                  : '—';

              return (
              <Link
                key={essay.id}
                to={targetHref}
                data-testid="essay-item"
                className="group block p-4 sm:p-5 rounded-2xl bg-slate-50/60 dark:bg-slate-950/60 border border-slate-200/90 dark:border-slate-800 hover:bg-white dark:hover:bg-slate-900 hover:border-indigo-300 dark:hover:border-indigo-700 hover:shadow-sm transition-all duration-200 overflow-hidden"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4 min-w-0">
                  <div className="flex items-center gap-3 sm:gap-4 flex-1 min-w-0 w-full">
                    <FileFormatIcon filename={essay.filename} size="lg" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap min-w-0">
                        <span className="font-mono text-[11px] font-bold px-2 py-0.5 rounded bg-slate-200/70 dark:bg-slate-800 text-slate-700 dark:text-slate-300 shrink-0">
                          #{idx + 1}
                        </span>
                        <p
                          className="font-display font-bold text-sm sm:text-base text-slate-900 dark:text-slate-100 truncate min-w-0 flex-1 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors"
                          title={essay.filename}
                        >
                          {essay.filename}
                        </p>
                        {isQueued && (
                          <span
                            data-testid={`history-job-status-${essay.id}`}
                            className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-mono font-semibold bg-amber-50 dark:bg-amber-950/70 text-amber-700 dark:text-amber-300 border border-amber-200/80 dark:border-amber-800/80 shrink-0"
                          >
                            <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                            {lang === 'vi' ? 'Hàng đợi' : 'Queued'}
                          </span>
                        )}
                        {isProcessing && (
                          <span
                            data-testid={`history-job-status-${essay.id}`}
                            className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-mono font-semibold bg-indigo-50 dark:bg-indigo-950/70 text-indigo-700 dark:text-indigo-300 border border-indigo-200/80 dark:border-indigo-800/80 shrink-0"
                          >
                            <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse" />
                            {lang === 'vi' ? 'Đang xử lý' : 'Processing'}
                          </span>
                        )}
                        {isFailed && (
                          <span
                            data-testid={`history-job-status-${essay.id}`}
                            title={essay.job_error || undefined}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-mono font-semibold bg-rose-50 dark:bg-rose-950/70 text-rose-700 dark:text-rose-300 border border-rose-200/80 dark:border-rose-800/80 shrink-0"
                          >
                            <AlertTriangle className="h-3 w-3" />
                            {lang === 'vi' ? 'Thất bại' : 'Failed'}
                          </span>
                        )}
                        {isFailed && essay.quota_charged === false && (
                          <span
                            data-testid={`history-job-refund-${essay.id}`}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-mono font-medium bg-emerald-50 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-300 border border-emerald-200/80 dark:border-emerald-800/80 shrink-0"
                          >
                            {lang === 'vi' ? 'Hoàn lượt' : 'Credit Refunded'}
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-2 sm:gap-3 text-xs font-mono text-slate-500 dark:text-slate-400 mt-1.5">
                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 text-slate-700 dark:text-slate-300">
                          <FileFormatIcon filename={essay.filename} size="xs" />
                          {essay.num_pages}{' '}
                          {lang !== 'vi' && essay.num_pages === 1
                            ? 'page'
                            : t('history.pages')}
                        </span>
                        <span
                          data-testid={`history-essay-cis-${essay.id}`}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 text-slate-700 dark:text-slate-300 font-semibold"
                        >
                          CIS: {cisDisplay}
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <Clock className="h-3.5 w-3.5 text-slate-400" />
                          {new Date(essay.uploaded_at).toLocaleDateString(
                            dateLocale,
                            {
                              month: 'short',
                              day: 'numeric',
                              year: 'numeric',
                            }
                          )}
                        </span>
                        <span>ID #{essay.id}</span>
                        <span className="text-slate-300 dark:text-slate-700">·</span>
                        {(() => {
                          const fmt = getDocumentFormat(essay.filename);
                          if (fmt === 'docx') {
                            return (
                              <span className="text-[#2563EB] dark:text-[#60A5FA] font-medium">
                                WORD DOCX · OPENXML
                              </span>
                            );
                          }
                          if (fmt === 'bib') {
                            return (
                              <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                                BIBTEX · .BIB
                              </span>
                            );
                          }
                          if (fmt === 'ris') {
                            return (
                              <span className="text-amber-600 dark:text-amber-400 font-medium">
                                RIS · BIBLIOGRAPHY
                              </span>
                            );
                          }
                          return (
                            <span className="text-emerald-600 dark:text-emerald-400">
                              GROBID TEI
                            </span>
                          );
                        })()}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-end gap-2 shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-200/60 dark:border-slate-800/60">
                    <span className="flex-1 sm:flex-initial inline-flex items-center justify-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold border border-indigo-200/80 dark:border-indigo-800/80 bg-indigo-50/80 dark:bg-indigo-950/80 rounded-xl text-indigo-700 dark:text-indigo-300 group-hover:bg-indigo-600 group-hover:text-white group-hover:border-indigo-600 transition-colors">
                      {isInProgress
                        ? lang === 'vi'
                          ? 'Xem tiến trình'
                          : 'Live Progress'
                        : isFailed
                          ? lang === 'vi'
                            ? 'Chi tiết lỗi'
                            : 'View Error'
                          : t('dashboard.viewReport')}
                    </span>
                    <button
                      onClickCapture={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setConfirmDeleteId(essay.id);
                      }}
                      disabled={deletingId === essay.id}
                      className="p-2.5 min-h-10 min-w-10 rounded-xl text-slate-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/50 transition-colors disabled:opacity-50"
                      title={t('common.delete')}
                      aria-label={`Delete ${essay.filename}`}
                    >
                      {deletingId === essay.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                    </button>
                    <ChevronRight className="h-5 w-5 text-slate-400 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 group-hover:translate-x-0.5 transition-all" />
                  </div>
                </div>
              </Link>
              );
            })}
          </div>
        )}

        {/* Stats Footer */}
        {items.length > 0 && (
          <div className="px-5 py-3 bg-slate-50/70 dark:bg-slate-900/70 border-t border-slate-200/80 dark:border-slate-800 flex items-center justify-between text-xs font-mono text-slate-500 dark:text-slate-400">
            <p>
              {t('dashboard.showingCount', {
                shown: filteredItems.length,
                total: items.length,
              })}
            </p>
          </div>
        )}
      </Card>

      <ConfirmationModal
        isOpen={confirmDeleteId !== null}
        title={t('dashboard.deleteConfirmTitle')}
        message={t('dashboard.deleteConfirmMessage')}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        variant="danger"
        onConfirm={handleDelete}
        onCancel={() => setConfirmDeleteId(null)}
      />
    </div>
  );
}
