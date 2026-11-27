import { useEffect, useMemo, useState } from 'react';
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
  ChevronLeft,
  AlertTriangle,
  Layers,
} from 'lucide-react';
import { useToast } from '@/contexts/ToastContext';
import { ConfirmationModal } from '@/components/ConfirmationModal';
import { EssaySortSelect } from '@/components/EssaySortSelect';
import {
  DEFAULT_ESSAY_SORT,
  sortEssays,
  type EssaySortOption,
} from '@/lib/essaySort';
import {
  formatCisScore,
  formatLocalizedDate,
  formatUserError,
  resolveAcademicLang,
} from '@/lib/academicTaxonomy';
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
import { Alert, AlertDescription } from '@/components/ui/alert';

/* ============================================================
   CITRA — History Page Component
   Archived verification reports with CIS band & format filters
   and client-side pagination (15 per page)
   ============================================================ */

const PAGE_SIZE = 15;

type CisBandFilter = 'all' | 'good' | 'review' | 'attention';
type FileTypeFilter = 'all' | 'pdf' | 'docx' | 'bib_ris';

function getCisBadgeClass(
  score: number | null | undefined,
  isUnscannable: boolean,
): string {
  if (isUnscannable || typeof score !== 'number' || !Number.isFinite(score)) {
    return 'bg-slate-100 text-slate-600 border-slate-200/80 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700';
  }
  if (score >= 85) {
    return 'bg-emerald-50 text-emerald-700 border-emerald-200/80 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800/70';
  }
  if (score >= 60) {
    return 'bg-amber-50 text-amber-800 border-amber-200/80 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800/70';
  }
  return 'bg-rose-50 text-rose-700 border-rose-200/80 dark:bg-rose-950/60 dark:text-rose-300 dark:border-rose-800/70';
}

function formatHistoryFormatBadge(
  filename: string,
  numPages: number,
  lang: 'vi' | 'en',
  pagesPluralLabel: string,
): string {
  const fmt = getDocumentFormat(filename);
  if (fmt === 'bib') return 'BibTeX';
  if (fmt === 'ris') return 'RIS';
  const formatPrefix = fmt === 'docx' ? 'Word (.docx)' : 'PDF';
  if (numPages > 0) {
    const unit = lang !== 'vi' && numPages === 1 ? 'page' : pagesPluralLabel;
    return `${formatPrefix} · ${numPages} ${unit}`;
  }
  return formatPrefix;
}

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
  const [sortBy, setSortBy] = useState<EssaySortOption>(DEFAULT_ESSAY_SORT);
  const [cisBand, setCisBand] = useState<CisBandFilter>('all');
  const [fileType, setFileType] = useState<FileTypeFilter>('all');
  const [page, setPage] = useState(1);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  const lang = resolveAcademicLang(i18n.resolvedLanguage || i18n.language);

  const errorMessage = error
    ? formatUserError(error, lang, t('error.network'))
    : null;
  const deletingId = deleteMutation.isPending
    ? (deleteMutation.variables ?? null)
    : null;

  const confirmDeleteEssay = useMemo(
    () =>
      confirmDeleteId !== null
        ? items.find((item) => item.id === confirmDeleteId) ?? null
        : null,
    [confirmDeleteId, items],
  );

  const handleDelete = async () => {
    const id = confirmDeleteId;
    if (id == null) return;
    setConfirmDeleteId(null);
    try {
      await deleteMutation.mutateAsync(id);
      toast.success(t('dashboard.documentDeleted'));
    } catch (err) {
      toast.error(formatUserError(err, lang, t('dashboard.deleteFailed')));
    }
  };

  const filteredItems = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const filtered = items.filter((item) => {
      if (query && !item.filename.toLowerCase().includes(query)) {
        return false;
      }

      if (fileType !== 'all') {
        const fmt = getDocumentFormat(item.filename);
        if (fileType === 'pdf' && fmt !== 'pdf') return false;
        if (fileType === 'docx' && fmt !== 'docx') return false;
        if (fileType === 'bib_ris' && fmt !== 'bib' && fmt !== 'ris') {
          return false;
        }
      }

      if (cisBand !== 'all') {
        const jobStatus = (item.job_status || 'completed').toLowerCase();
        const isCompleted = jobStatus === 'completed';
        const score = item.cis_score;
        if (!isCompleted || typeof score !== 'number' || !Number.isFinite(score)) {
          return false;
        }
        if (cisBand === 'good' && score < 85) return false;
        if (cisBand === 'review' && (score < 60 || score >= 85)) return false;
        if (cisBand === 'attention' && score >= 60) return false;
      }

      return true;
    });
    return sortEssays(filtered, sortBy);
  }, [items, searchQuery, sortBy, cisBand, fileType]);

  const totalPages = Math.max(1, Math.ceil(filteredItems.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);

  useEffect(() => {
    setPage(1);
  }, [searchQuery, cisBand, fileType, sortBy]);

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  const startIndex = (safePage - 1) * PAGE_SIZE;
  const paginatedItems = useMemo(
    () => filteredItems.slice(startIndex, startIndex + PAGE_SIZE),
    [filteredItems, startIndex],
  );

  const hasActiveFilters =
    Boolean(searchQuery.trim()) || cisBand !== 'all' || fileType !== 'all';

  const resetAllFilters = () => {
    setSearchQuery('');
    setCisBand('all');
    setFileType('all');
  };

  const cisBandOptions: Array<{
    key: CisBandFilter;
    label: string;
    activeClass: string;
  }> = [
    {
      key: 'all',
      label: lang === 'vi' ? 'Tất cả' : 'All',
      activeClass:
        'bg-indigo-600 text-white border-indigo-600 dark:bg-indigo-500 dark:border-indigo-500',
    },
    {
      key: 'good',
      label: lang === 'vi' ? 'Tốt ≥ 85' : 'Good ≥ 85',
      activeClass:
        'bg-emerald-600 text-white border-emerald-600 dark:bg-emerald-500 dark:border-emerald-500',
    },
    {
      key: 'review',
      label: lang === 'vi' ? 'Cần xem 60–84' : 'Review 60–84',
      activeClass:
        'bg-amber-600 text-white border-amber-600 dark:bg-amber-500 dark:border-amber-500',
    },
    {
      key: 'attention',
      label: lang === 'vi' ? 'Cần rà soát < 60' : 'Needs Review < 60',
      activeClass:
        'bg-rose-600 text-white border-rose-600 dark:bg-rose-500 dark:border-rose-500',
    },
  ];

  const fileTypeOptions: Array<{ key: FileTypeFilter; label: string }> = [
    {
      key: 'all',
      label: lang === 'vi' ? 'Tất cả định dạng' : 'All formats',
    },
    { key: 'pdf', label: 'PDF' },
    { key: 'docx', label: 'DOCX' },
    { key: 'bib_ris', label: 'BibTeX / RIS' },
  ];

  return (
    <div className="space-y-6 pb-10">
      {/* Page Header Banner */}
      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 p-5 sm:p-6 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1.5 min-w-0">
          <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            {t('history.title')}
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            {t(
              items.length === 1
                ? 'history.documentCountOne'
                : 'history.documentCountOther',
              { count: items.length },
            )}
          </p>
        </div>

        <div className="flex items-center gap-2 sm:gap-2.5 flex-wrap shrink-0">
          {canBatchUpload && (
            <Button
              asChild
              variant="outline"
              size="sm"
              className="h-10 rounded-xl font-medium whitespace-nowrap"
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
            className="h-10 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold shadow-sm shadow-indigo-600/20 btn-shimmer whitespace-nowrap"
          >
            <Link to="/upload">
              <Upload className="h-4 w-4" />
              {t('dashboard.newCheck')}
            </Link>
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

      {/* Archive List Card */}
      <Card className="p-0 overflow-hidden rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm">
        {/* Top Toolbar */}
        <div className="px-4 sm:px-6 py-3.5 bg-slate-50/80 dark:bg-slate-900/90 border-b border-slate-200/80 dark:border-slate-800 space-y-3">
          <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0 flex-wrap shrink-0">
              <h2 className="font-display text-sm font-bold text-slate-800 dark:text-slate-200">
                {lang === 'vi'
                  ? 'Danh mục báo cáo đã lưu'
                  : 'Archived Verification Reports'}
              </h2>
              <Badge
                variant="secondary"
                className="font-mono text-[11px] bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300 border border-indigo-200/60 dark:border-indigo-800/60"
              >
                {filteredItems.length} / {items.length}
              </Badge>
            </div>

            {/* Sort, Search & Inline Refresh Controls (no lonely wrap on 375px) */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full xl:w-auto min-w-0">
              <EssaySortSelect value={sortBy} onChange={setSortBy} />
              <div className="flex items-center gap-2 flex-nowrap w-full sm:flex-1 xl:flex-none min-w-0">
                <div className="relative flex-1 xl:w-64 2xl:w-72 min-w-0">
                  <Search
                    className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 dark:text-slate-500 pointer-events-none"
                    aria-hidden="true"
                  />
                  <Input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder={t('dashboard.searchPlaceholder')}
                    aria-label={
                      lang === 'vi' ? 'Tìm kiếm tài liệu' : 'Search documents'
                    }
                    className="t-clear-input h-9 pl-9 pr-8 text-xs rounded-xl bg-white dark:bg-slate-950 border-slate-200 dark:border-slate-800"
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => setSearchQuery('')}
                      aria-label={
                        lang === 'vi' ? 'Xóa tìm kiếm' : 'Clear search'
                      }
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
                    >
                      <XCircle className="h-4 w-4" />
                    </button>
                  )}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => void refetch()}
                  disabled={isFetching}
                  aria-label={
                    lang === 'vi' ? 'Làm mới lịch sử' : 'Refresh history'
                  }
                  title={t('common.refresh')}
                  className="h-9 w-9 shrink-0 rounded-xl bg-white dark:bg-slate-950 border-slate-200 dark:border-slate-700"
                >
                  <RefreshCw
                    className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`}
                  />
                </Button>
              </div>
            </div>
          </div>

          {/* CIS Band & File Type Filter Chips */}
          {items.length > 0 && (
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-2.5 pt-2 border-t border-slate-200/70 dark:border-slate-800/80">
              <div
                className="flex flex-wrap items-center gap-1.5"
                role="group"
                aria-label={
                  lang === 'vi'
                    ? 'Lọc theo mức điểm CIS'
                    : 'Filter by CIS quality band'
                }
              >
                {cisBandOptions.map((opt) => {
                  const active = cisBand === opt.key;
                  return (
                    <button
                      key={opt.key}
                      type="button"
                      data-testid={`history-cis-filter-${opt.key}`}
                      aria-pressed={active}
                      onClick={() => setCisBand(opt.key)}
                      className={`px-2.5 py-1 rounded-lg border text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
                        active
                          ? opt.activeClass
                          : 'bg-white dark:bg-slate-950 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-indigo-300 dark:hover:border-indigo-700'
                      }`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>

              <div
                className="flex flex-wrap items-center gap-1.5"
                role="group"
                aria-label={
                  lang === 'vi'
                    ? 'Lọc theo định dạng tệp'
                    : 'Filter by file format'
                }
              >
                {fileTypeOptions.map((opt) => {
                  const active = fileType === opt.key;
                  return (
                    <button
                      key={opt.key}
                      type="button"
                      data-testid={`history-format-filter-${opt.key}`}
                      aria-pressed={active}
                      onClick={() => setFileType(opt.key)}
                      className={`px-2.5 py-1 rounded-lg border text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
                        active
                          ? 'bg-slate-900 text-white border-slate-900 dark:bg-slate-100 dark:text-slate-900 dark:border-slate-100'
                          : 'bg-white dark:bg-slate-950 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-slate-400 dark:hover:border-slate-600'
                      }`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Loading / Empty / List */}
        {isLoading && items.length === 0 ? (
          <div className="p-14 flex flex-col items-center justify-center">
            <Loader2 className="h-8 w-8 text-indigo-600 dark:text-indigo-400 animate-spin mb-4" />
            <p className="text-sm text-slate-600 dark:text-slate-300">
              {t('dashboard.loadingDocuments')}
            </p>
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="p-14 text-center">
            <div className="flex items-center justify-center w-16 h-16 rounded-2xl bg-slate-100 dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700 mx-auto mb-4">
              <FileText className="h-8 w-8 text-slate-400 dark:text-slate-500" />
            </div>
            {hasActiveFilters ? (
              <>
                <h3 className="font-display text-xl font-bold text-slate-900 dark:text-slate-100 mb-1.5">
                  {t('dashboard.noDocumentsFound')}
                </h3>
                <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">
                  {searchQuery
                    ? t('dashboard.noDocumentsMatch', { query: searchQuery })
                    : lang === 'vi'
                      ? 'Không có tài liệu nào khớp với bộ lọc đang chọn.'
                      : 'No documents match your active filters.'}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={resetAllFilters}
                  className="rounded-xl"
                >
                  {lang === 'vi' ? 'Đặt lại bộ lọc' : 'Reset filters'}
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
                <Button
                  asChild
                  className="rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white"
                >
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
            {paginatedItems.map((essay, idx) => {
              const jobStatus = (essay.job_status || 'completed').toLowerCase();
              const isQueued = jobStatus === 'queued';
              const isProcessing = jobStatus === 'processing';
              const isInProgress = isQueued || isProcessing;
              const isFailed = jobStatus === 'failed';
              const targetHref =
                isInProgress || isFailed
                  ? `/verification/processing/${essay.id}`
                  : `/verification/report/${essay.id}`;
              const isUnscannableCis = isFailed || isInProgress;
              const cisDisplay = formatCisScore(essay.cis_score, {
                isUnscannable: isUnscannableCis,
              });
              const cisTone = getCisBadgeClass(
                essay.cis_score,
                isUnscannableCis,
              );
              const formatLabel = formatHistoryFormatBadge(
                essay.filename,
                essay.num_pages,
                lang,
                t('history.pages'),
              );

              return (
                <div
                  key={essay.id}
                  className="group relative p-4 sm:p-5 rounded-2xl bg-slate-50/60 dark:bg-slate-950/60 border border-slate-200/90 dark:border-slate-800 hover:bg-white dark:hover:bg-slate-900 hover:border-indigo-300 dark:hover:border-indigo-700 hover:shadow-sm transition-all duration-200 overflow-hidden"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4 min-w-0">
                    <Link
                      to={targetHref}
                      data-testid="essay-item"
                      className="flex items-center gap-3 sm:gap-4 flex-1 min-w-0 w-full after:absolute after:inset-0 after:rounded-2xl after:content-[''] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded-xl"
                    >
                      <FileFormatIcon filename={essay.filename} size="lg" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap min-w-0">
                          <span className="font-mono text-[11px] font-bold px-2 py-0.5 rounded bg-slate-200/70 dark:bg-slate-800 text-slate-700 dark:text-slate-300 shrink-0">
                            #{startIndex + idx + 1}
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
                              className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium bg-amber-50 dark:bg-amber-950/70 text-amber-700 dark:text-amber-300 border border-amber-200/80 dark:border-amber-800/80 shrink-0"
                            >
                              <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                              {lang === 'vi' ? 'Hàng đợi' : 'Queued'}
                            </span>
                          )}
                          {isProcessing && (
                            <span
                              data-testid={`history-job-status-${essay.id}`}
                              className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium bg-indigo-50 dark:bg-indigo-950/70 text-indigo-700 dark:text-indigo-300 border border-indigo-200/80 dark:border-indigo-800/80 shrink-0"
                            >
                              <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse" />
                              {lang === 'vi' ? 'Đang xử lý' : 'Processing'}
                            </span>
                          )}
                          {isFailed && (
                            <span
                              data-testid={`history-job-status-${essay.id}`}
                              title={essay.job_error || undefined}
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-rose-50 dark:bg-rose-950/70 text-rose-700 dark:text-rose-300 border border-rose-200/80 dark:border-rose-800/80 shrink-0"
                            >
                              <AlertTriangle className="h-3 w-3" />
                              {lang === 'vi' ? 'Thất bại' : 'Failed'}
                            </span>
                          )}
                          {isFailed && essay.quota_charged === false && (
                            <span
                              data-testid={`history-job-refund-${essay.id}`}
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-50 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-300 border border-emerald-200/80 dark:border-emerald-800/80 shrink-0"
                            >
                              {lang === 'vi' ? 'Hoàn lượt' : 'Credit Refunded'}
                            </span>
                          )}
                        </div>
                        <div className="flex flex-wrap items-center gap-2 sm:gap-2.5 text-xs text-slate-500 dark:text-slate-400 mt-1.5">
                          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 text-slate-700 dark:text-slate-300 font-medium">
                            <FileFormatIcon filename={essay.filename} size="xs" />
                            <span>{formatLabel}</span>
                          </span>
                          <span
                            data-testid={`history-essay-cis-${essay.id}`}
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border font-mono tabular-nums font-semibold ${cisTone}`}
                          >
                            CIS: {cisDisplay}
                          </span>
                          <span className="inline-flex items-center gap-1 font-mono">
                            <Clock className="h-3.5 w-3.5 text-slate-400" />
                            {formatLocalizedDate(essay.uploaded_at, lang)}
                          </span>
                        </div>
                      </div>
                    </Link>

                    {/* Action Controls: open indicator separated cleanly from Trash delete button */}
                    <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0 pt-2.5 sm:pt-0 border-t sm:border-t-0 border-slate-200/60 dark:border-slate-800/60">
                      <span className="pointer-events-none flex-1 sm:flex-initial inline-flex items-center justify-center gap-1.5 px-3.5 py-2 text-xs font-semibold whitespace-nowrap shrink-0 border border-indigo-200/80 dark:border-indigo-800/80 bg-indigo-50/80 dark:bg-indigo-950/80 rounded-xl text-indigo-700 dark:text-indigo-300 group-hover:bg-indigo-600 group-hover:text-white group-hover:border-indigo-600 transition-colors">
                        <span>
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
                        <ChevronRight className="h-3.5 w-3.5 shrink-0 group-hover:translate-x-0.5 transition-transform" />
                      </span>

                      <div className="pl-2.5 border-l border-slate-200/80 dark:border-slate-800 shrink-0">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setConfirmDeleteId(essay.id);
                          }}
                          disabled={deletingId === essay.id}
                          className="relative z-10 inline-flex items-center justify-center p-2.5 min-h-10 min-w-10 rounded-xl text-slate-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/50 transition-colors disabled:opacity-50 cursor-pointer"
                          title={t('common.delete')}
                          aria-label={`${t('common.delete')} ${essay.filename}`}
                        >
                          {deletingId === essay.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Trash2 className="h-4 w-4" />
                          )}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Stats & Pagination Footer */}
        {items.length > 0 && (
          <div className="px-4 sm:px-5 py-3 bg-slate-50/70 dark:bg-slate-900/70 border-t border-slate-200/80 dark:border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-2.5 text-xs text-slate-500 dark:text-slate-400">
            <p>
              {t('dashboard.showingCount', {
                shown: filteredItems.length,
                total: items.length,
              })}
            </p>

            {totalPages > 1 && (
              <div
                data-testid="history-pagination"
                className="flex items-center gap-2"
              >
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  data-testid="history-prev-page"
                  disabled={safePage <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="h-8 px-2.5 rounded-lg text-xs"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                  <span>{lang === 'vi' ? 'Trước' : 'Prev'}</span>
                </Button>
                <span className="font-mono text-xs text-slate-700 dark:text-slate-300 px-1.5">
                  {lang === 'vi'
                    ? `Trang ${safePage} / ${totalPages}`
                    : `Page ${safePage} / ${totalPages}`}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  data-testid="history-next-page"
                  disabled={safePage >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  className="h-8 px-2.5 rounded-lg text-xs"
                >
                  <span>{lang === 'vi' ? 'Sau' : 'Next'}</span>
                  <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}
          </div>
        )}
      </Card>

      <ConfirmationModal
        isOpen={confirmDeleteId !== null}
        title={
          confirmDeleteEssay
            ? lang === 'vi'
              ? `Xóa vĩnh viễn "${confirmDeleteEssay.filename}"?`
              : `Permanently delete "${confirmDeleteEssay.filename}"?`
            : t('dashboard.deleteConfirmTitle')
        }
        message={
          confirmDeleteEssay
            ? lang === 'vi'
              ? `Báo cáo và kết quả phân tích của "${confirmDeleteEssay.filename}" sẽ bị xóa vĩnh viễn và không thể khôi phục.`
              : `This will permanently remove "${confirmDeleteEssay.filename}" and its verification report. This action cannot be undone.`
            : t('dashboard.deleteConfirmMessage')
        }
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        variant="danger"
        onConfirm={handleDelete}
        onCancel={() => setConfirmDeleteId(null)}
      />
    </div>
  );
}
