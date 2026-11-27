import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  FileText,
  Upload,
  Search,
  Clock,
  Trash2,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Eye,
  Scale,
  XCircle,
  TrendingUp,
  Layers,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  GraduationCap,
  ClipboardCheck,
  ArrowRight,
  Info,
} from 'lucide-react';
import { api, type TeacherDashboard } from '@/api/client';
import { useToast } from '@/contexts/ToastContext';
import { ConfirmationModal } from '@/components/ConfirmationModal';
import { EssaySortSelect } from '@/components/EssaySortSelect';
import {
  DEFAULT_ESSAY_SORT,
  sortEssays,
  toggleEssayColumnSort,
  getEssayColumnAriaSort,
  type EssaySortOption,
  type EssaySortColumn,
} from '@/lib/essaySort';
import {
  formatCisScore,
  formatLocalizedDate,
  formatUserError,
  resolveAcademicLang,
} from '@/lib/academicTaxonomy';
import { SCHOLARLY_APIS_LABEL } from '@/lib/productFacts';
import {
  FileFormatIcon,
  getDocumentFormat,
} from '@/components/FileFormatIcon';
import { useRole } from '@/hooks/useRole';
import {
  useEssays,
  useDeleteEssay,
  useDashboardStats,
  type DashboardStats,
} from '@/hooks/useEssays';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { NumberPopIn } from '@/components/ui/transitions';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

/* ============================================================
   CITRA — Dashboard Page Component
   Shows overview of all uploaded documents + aggregate stats
   ============================================================ */

const DEFAULT_STATS: DashboardStats = {
  total_documents: 0,
  total_citations: 0,
  avg_cis_score: null,
  verified_rate: 0,
};

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

function formatDocumentMeta(
  filename: string,
  numPages: number,
  lang: 'vi' | 'en',
): string {
  const fmt = getDocumentFormat(filename);
  if (fmt === 'bib') return 'BibTeX';
  if (fmt === 'ris') return 'RIS';
  const formatLabel = fmt === 'docx' ? 'Word (.docx)' : 'PDF';
  if (numPages > 0) {
    const pageUnit =
      lang === 'vi' ? 'trang' : numPages === 1 ? 'page' : 'pages';
    return `${formatLabel} · ${numPages} ${pageUnit}`;
  }
  return formatLabel;
}

export function DashboardPage() {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const { isUser, isTeacher, isAdmin, canBatchUpload } = useRole();
  const { data: essays = [], isLoading, error, refetch, isFetching } = useEssays();
  const {
    data: stats = DEFAULT_STATS,
    incompleteMetadataCount,
    refetchStats,
  } = useDashboardStats();
  const deleteMutation = useDeleteEssay();
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<EssaySortOption>(DEFAULT_ESSAY_SORT);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [teacherOverview, setTeacherOverview] = useState<TeacherDashboard | null>(
    null,
  );

  const lang = resolveAcademicLang(i18n.resolvedLanguage || i18n.language);

  useEffect(() => {
    if (!isTeacher || typeof api.getTeacherDashboard !== 'function') {
      setTeacherOverview(null);
      return;
    }
    let cancelled = false;
    api
      .getTeacherDashboard()
      .then((res) => {
        if (!cancelled && res && typeof res === 'object') {
          setTeacherOverview(res);
        }
      })
      .catch(() => {
        if (!cancelled) setTeacherOverview(null);
      });
    return () => {
      cancelled = true;
    };
  }, [isTeacher]);

  const errorMessage = error
    ? formatUserError(error, lang, t('error.network'))
    : null;
  const deletingId = deleteMutation.isPending
    ? (deleteMutation.variables ?? null)
    : null;

  const confirmDeleteEssay = useMemo(
    () =>
      confirmDeleteId !== null
        ? essays.find((e) => e.id === confirmDeleteId) ?? null
        : null,
    [confirmDeleteId, essays],
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

  // Filter essays by search query and apply active sort order
  const filteredEssays = useMemo(() => {
    const filtered = essays.filter((essay) =>
      essay.filename.toLowerCase().includes(searchQuery.toLowerCase()),
    );
    return sortEssays(filtered, sortBy);
  }, [essays, searchQuery, sortBy]);

  const cisTooltip =
    lang === 'vi'
      ? 'Chỉ số toàn vẹn trích dẫn (0–100): Tốt ≥ 85 · Cần xem 60–84 · Cần rà soát < 60'
      : 'Citation Integrity Score (0–100): Good ≥ 85 · Review 60–84 · Needs review < 60';

  const renderSortHeaderButton = (
    column: EssaySortColumn,
    label: string,
    title?: string,
  ) => {
    const ariaSort = getEssayColumnAriaSort(sortBy, column);
    const isActive = ariaSort !== 'none';
    return (
      <button
        type="button"
        title={title}
        data-testid={`dashboard-sort-col-${column}`}
        onClick={() => setSortBy((prev) => toggleEssayColumnSort(prev, column))}
        className={`group/sort inline-flex items-center gap-1 font-mono text-[11px] uppercase tracking-wider transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40 rounded ${
          isActive
            ? 'text-indigo-600 dark:text-indigo-400 font-bold'
            : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
        }`}
      >
        <span>{label}</span>
        {ariaSort === 'ascending' ? (
          <ArrowUp className="h-3 w-3 shrink-0" aria-hidden="true" />
        ) : ariaSort === 'descending' ? (
          <ArrowDown className="h-3 w-3 shrink-0" aria-hidden="true" />
        ) : (
          <ArrowUpDown
            className="hidden lg:inline-block h-3 w-3 opacity-45 group-hover/sort:opacity-90 shrink-0 transition-opacity"
            aria-hidden="true"
          />
        )}
      </button>
    );
  };

  // Stat cards data
  const statCards = [
    {
      idx: '01',
      label: t('dashboard.totalDocuments'),
      value: stats.total_documents,
      sub:
        lang === 'vi'
          ? 'Tài liệu học thuật đã phân tích'
          : 'Analyzed academic documents',
      tooltip: undefined as string | undefined,
      alwaysShowSub: false,
      icon: FileText,
      color: 'text-indigo-600 dark:text-indigo-400',
      iconBox:
        'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/20',
      badgeTone:
        'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/80 dark:text-indigo-300 border-indigo-200/60 dark:border-indigo-800/60',
    },
    {
      idx: '02',
      label: t('dashboard.totalCitations'),
      value: stats.total_citations,
      sub:
        lang === 'vi'
          ? 'Trích dẫn bóc tách đa định dạng'
          : 'Multi-format citation extractions',
      tooltip: undefined as string | undefined,
      alwaysShowSub: false,
      icon: Scale,
      color: 'text-emerald-600 dark:text-emerald-400',
      iconBox:
        'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
      badgeTone:
        'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/80 dark:text-emerald-300 border-emerald-200/60 dark:border-emerald-800/60',
    },
    {
      idx: '03',
      label: t('dashboard.avgCisScore'),
      value: formatCisScore(stats.avg_cis_score),
      sub:
        lang === 'vi'
          ? 'Chỉ số toàn vẹn trích dẫn (0–100)'
          : 'Citation Integrity Score (0–100)',
      tooltip: cisTooltip,
      alwaysShowSub: true,
      icon: TrendingUp,
      color: 'text-amber-600 dark:text-amber-400',
      iconBox:
        'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
      badgeTone:
        'bg-amber-50 text-amber-700 dark:bg-amber-950/80 dark:text-amber-300 border-amber-200/60 dark:border-amber-800/60',
    },
    {
      idx: '04',
      label: t('dashboard.verifiedRate'),
      value: stats.verified_rate > 0 ? `${stats.verified_rate}%` : '—',
      sub:
        lang === 'vi'
          ? `Đối chiếu trên ${SCHOLARLY_APIS_LABEL} thư viện học thuật`
          : `Checked across ${SCHOLARLY_APIS_LABEL} scholarly libraries`,
      tooltip: undefined as string | undefined,
      alwaysShowSub: false,
      icon: CheckCircle2,
      color: 'text-sky-600 dark:text-sky-400',
      iconBox:
        'bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20',
      badgeTone:
        'bg-sky-50 text-sky-700 dark:bg-sky-950/80 dark:text-sky-300 border-sky-200/60 dark:border-sky-800/60',
    },
  ];

  return (
    <div className="space-y-6 pb-8">
      {/* Page Header Banner */}
      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 p-5 sm:p-6 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1.5 min-w-0">
          <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            {t('dashboard.title')}
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            {t('dashboard.subtitle')}
          </p>
        </div>

        <div className="flex items-center gap-2 sm:gap-2.5 flex-wrap shrink-0">
          {canBatchUpload && (
            <Button
              asChild
              variant="outline"
              size="sm"
              className="h-10 rounded-xl font-medium border-slate-200 dark:border-slate-700 whitespace-nowrap"
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

      {/* Teacher Quick Teaching Overview Banner */}
      {isTeacher && (
        <div
          data-testid="dashboard-teacher-overview"
          className="rounded-2xl bg-gradient-to-r from-indigo-50/90 via-white to-slate-50/90 dark:from-indigo-950/40 dark:via-slate-900 dark:to-slate-900 border border-indigo-200/80 dark:border-indigo-800/70 p-4 sm:p-5 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4"
        >
          <div className="flex items-start gap-3 min-w-0">
            <div className="p-2.5 rounded-xl bg-indigo-600/10 text-indigo-700 dark:text-indigo-300 border border-indigo-500/20 shrink-0">
              <GraduationCap className="h-5 w-5" />
            </div>
            <div className="min-w-0 space-y-1">
              <h2 className="font-display text-sm sm:text-base font-bold text-slate-900 dark:text-white">
                {lang === 'vi'
                  ? 'Không gian Giảng dạy & Rà soát'
                  : 'Teaching & Citation Review'}
              </h2>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                {teacherOverview
                  ? lang === 'vi'
                    ? `${teacherOverview.total_classes} lớp học · ${teacherOverview.total_students} sinh viên · ${teacherOverview.pending_reviews} trích dẫn chờ duyệt`
                    : `${teacherOverview.total_classes} ${teacherOverview.total_classes === 1 ? 'class' : 'classes'} · ${teacherOverview.total_students} ${teacherOverview.total_students === 1 ? 'student' : 'students'} · ${teacherOverview.pending_reviews} pending ${teacherOverview.pending_reviews === 1 ? 'review' : 'reviews'}`
                  : lang === 'vi'
                    ? 'Quản lý các lớp học phần và rà soát các trích dẫn cần giảng viên xác nhận.'
                    : 'Manage your classes and review flagged student citations.'}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <Button
              asChild
              variant="outline"
              size="sm"
              className="h-9 rounded-xl font-semibold border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 whitespace-nowrap"
            >
              <Link to="/teacher/classes" data-testid="dashboard-teacher-classes-link">
                <GraduationCap className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />
                <span>{lang === 'vi' ? 'Lớp học của tôi' : 'My Classes'}</span>
                <ArrowRight className="h-3.5 w-3.5 opacity-60" />
              </Link>
            </Button>
            <Button
              asChild
              size="sm"
              className="h-9 rounded-xl font-semibold bg-indigo-600 hover:bg-indigo-700 text-white whitespace-nowrap"
            >
              <Link to="/teacher/reviews" data-testid="dashboard-teacher-reviews-link">
                <ClipboardCheck className="h-3.5 w-3.5" />
                <span>{lang === 'vi' ? 'Duyệt trích dẫn' : 'Review Citations'}</span>
                {teacherOverview && teacherOverview.pending_reviews > 0 && (
                  <span
                    data-testid="dashboard-teacher-pending-count"
                    className="ml-0.5 inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 rounded-full text-[11px] font-mono font-bold bg-amber-400 text-slate-950"
                  >
                    {teacherOverview.pending_reviews}
                  </span>
                )}
              </Link>
            </Button>
          </div>
        </div>
      )}

      {/* 4 Aggregate Metric Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {statCards.map((card) => {
          const Icon = card.icon;
          return (
            <Card
              key={card.label}
              title={card.tooltip}
              className="card group relative overflow-hidden rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 p-3.5 sm:p-5 shadow-sm hover:shadow-md hover:-translate-y-0.5 hover:border-indigo-300 dark:hover:border-indigo-700 transition-all duration-200"
            >
              <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-indigo-600 via-indigo-500 to-emerald-500 scale-x-0 group-hover:scale-x-100 transition-transform duration-300 origin-left" />
              <div className="flex items-start justify-between gap-3 mb-3">
                <div className={`p-2.5 rounded-xl border ${card.iconBox}`}>
                  <Icon className="h-5 w-5" />
                </div>
                {!isUser && (
                  <span
                    className={`text-[11px] font-mono font-semibold px-2 py-0.5 rounded-md border ${card.badgeTone}`}
                  >
                    {card.idx}
                  </span>
                )}
              </div>
              <p
                className={`text-xl sm:text-2xl xl:text-3xl font-bold font-mono tabular-nums tracking-tight ${card.color}`}
              >
                <NumberPopIn value={card.value} />
              </p>
              <div className="flex items-center gap-1.5 flex-wrap mt-1">
                <p className="text-sm font-semibold text-slate-800 dark:text-slate-200 inline-flex items-center gap-1">
                  <span>{card.label}</span>
                  {card.tooltip && (
                    <Info
                      className="h-3.5 w-3.5 text-slate-400 shrink-0"
                      aria-hidden="true"
                    />
                  )}
                </p>
                {card.idx === '02' && incompleteMetadataCount > 0 && (
                  <span
                    data-testid="dashboard-incomplete-ref-chip"
                    className="inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-mono font-semibold bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800/70"
                  >
                    {lang === 'vi'
                      ? `${incompleteMetadataCount} thiếu thông tin`
                      : `${incompleteMetadataCount} Incomplete Ref`}
                  </span>
                )}
              </div>
              {(card.alwaysShowSub || !isUser) && (
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 leading-snug">
                  {card.sub}
                </p>
              )}
            </Card>
          );
        })}
      </div>

      {/* Error */}
      {errorMessage && (
        <Alert variant="destructive" className="rounded-2xl">
          <AlertTriangle className="h-5 w-5" />
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      )}

      {/* Document Registry & Search */}
      <Card className="p-0 overflow-hidden rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm">
        {/* Top Toolbar */}
        <div className="px-4 sm:px-6 py-3.5 bg-slate-50/80 dark:bg-slate-900/90 border-b border-slate-200/80 dark:border-slate-800 flex flex-col xl:flex-row xl:items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0 flex-wrap shrink-0">
            <h2 className="font-display text-sm font-bold text-slate-800 dark:text-slate-200">
              {t('dashboard.recentActivity')}
            </h2>
            <Badge
              variant="secondary"
              className="font-mono text-[11px] bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300 border border-indigo-200/60 dark:border-indigo-800/60"
            >
              {filteredEssays.length} / {essays.length}
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
                onClick={() => {
                  void refetch();
                  void refetchStats();
                }}
                disabled={isFetching}
                aria-label={
                  lang === 'vi'
                    ? 'Làm mới danh sách tài liệu'
                    : 'Refresh essays list'
                }
                title={t('common.refresh')}
                className="h-9 w-9 shrink-0 rounded-xl border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950"
              >
                <RefreshCw
                  className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`}
                />
              </Button>
            </div>
          </div>
        </div>

        {/* Table or Empty State */}
        {isLoading && essays.length === 0 ? (
          <div className="p-14 flex flex-col items-center justify-center">
            <Loader2 className="h-8 w-8 text-indigo-600 dark:text-indigo-400 animate-spin mb-4" />
            <p className="text-sm text-slate-600 dark:text-slate-300">
              {t('dashboard.loadingDocuments')}
            </p>
          </div>
        ) : filteredEssays.length === 0 ? (
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
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setSearchQuery('')}
                  className="rounded-xl"
                >
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
                {!(isTeacher || isAdmin) && (
                  <Button
                    asChild
                    className="rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white"
                  >
                    <Link to="/upload">
                      <Upload className="h-4 w-4" />
                      {t('dashboard.uploadDocument')}
                    </Link>
                  </Button>
                )}
              </>
            )}
          </div>
        ) : (
          <Table className="t-skel-reveal block md:table">
            <TableHeader className="hidden md:table-header-group">
              <TableRow className="bg-slate-50/50 dark:bg-slate-900/50 border-b border-slate-200/80 dark:border-slate-800">
                <TableHead
                  aria-sort={getEssayColumnAriaSort(sortBy, 'name')}
                  className="w-full font-mono text-[11px] uppercase tracking-wider text-slate-500 dark:text-slate-400 py-3 px-3.5 xl:px-5"
                >
                  {renderSortHeaderButton('name', t('dashboard.tableDocument'))}
                </TableHead>
                <TableHead
                  aria-sort={getEssayColumnAriaSort(sortBy, 'pages')}
                  className="whitespace-nowrap font-mono text-[11px] uppercase tracking-wider text-slate-500 dark:text-slate-400 py-3 px-2 xl:px-4"
                >
                  {renderSortHeaderButton('pages', t('dashboard.tablePages'))}
                </TableHead>
                <TableHead
                  aria-sort={getEssayColumnAriaSort(sortBy, 'cis')}
                  className="whitespace-nowrap font-mono text-[11px] uppercase tracking-wider text-slate-500 dark:text-slate-400 py-3 px-2 xl:px-4"
                >
                  {renderSortHeaderButton('cis', 'CIS', cisTooltip)}
                </TableHead>
                <TableHead
                  aria-sort={getEssayColumnAriaSort(sortBy, 'date')}
                  className="whitespace-nowrap font-mono text-[11px] uppercase tracking-wider text-slate-500 dark:text-slate-400 py-3 px-2 xl:px-4"
                >
                  {renderSortHeaderButton('date', t('dashboard.tableUploaded'))}
                </TableHead>
                <TableHead className="whitespace-nowrap font-mono text-[11px] uppercase tracking-wider text-slate-500 dark:text-slate-400 py-3 px-3.5 xl:px-5 text-right">
                  {t('dashboard.tableActions')}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="block md:table-row-group divide-y divide-slate-100 dark:divide-slate-800/80">
              {filteredEssays.map((essay) => {
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
                const fmt = getDocumentFormat(essay.filename);
                const pagesCellDisplay =
                  fmt === 'bib'
                    ? 'BibTeX'
                    : fmt === 'ris'
                      ? 'RIS'
                      : essay.num_pages > 0
                        ? String(essay.num_pages)
                        : '—';

                return (
                  <TableRow
                    key={essay.id}
                    className="flex flex-col md:table-row p-3.5 md:p-0 gap-2 md:gap-0 group hover:bg-slate-50/80 dark:hover:bg-slate-900/60 transition-colors"
                  >
                    <TableCell className="py-0 md:py-3.5 px-0 md:px-3.5 xl:px-5 min-w-0 w-full md:max-w-0 overflow-hidden">
                      <div className="flex items-center gap-2.5 xl:gap-3 min-w-0">
                        <FileFormatIcon filename={essay.filename} size="md" />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap min-w-0">
                            <Link
                              to={targetHref}
                              title={essay.filename}
                              data-testid={`dashboard-essay-link-${essay.id}`}
                              className="text-sm font-semibold text-slate-900 dark:text-slate-100 hover:text-indigo-600 dark:hover:text-indigo-400 truncate min-w-0 max-w-full block transition-colors"
                            >
                              {essay.filename}
                            </Link>
                            {isQueued && (
                              <span
                                data-testid={`job-status-badge-${essay.id}`}
                                className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium bg-amber-50 dark:bg-amber-950/70 text-amber-700 dark:text-amber-300 border border-amber-200/80 dark:border-amber-800/80 shrink-0"
                              >
                                <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                                {lang === 'vi' ? 'Hàng đợi' : 'Queued'}
                              </span>
                            )}
                            {isProcessing && (
                              <span
                                data-testid={`job-status-badge-${essay.id}`}
                                className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium bg-indigo-50 dark:bg-indigo-950/70 text-indigo-700 dark:text-indigo-300 border border-indigo-200/80 dark:border-indigo-800/80 shrink-0"
                              >
                                <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse" />
                                {lang === 'vi' ? 'Đang xử lý' : 'Processing'}
                              </span>
                            )}
                            {isFailed && (
                              <span
                                data-testid={`job-status-badge-${essay.id}`}
                                title={essay.job_error || undefined}
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-rose-50 dark:bg-rose-950/70 text-rose-700 dark:text-rose-300 border border-rose-200/80 dark:border-rose-800/80 shrink-0"
                              >
                                <AlertTriangle className="h-3 w-3" />
                                {lang === 'vi' ? 'Thất bại' : 'Failed'}
                              </span>
                            )}
                            {isFailed && essay.quota_charged === false && (
                              <span
                                data-testid={`job-refund-badge-${essay.id}`}
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-50 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-300 border border-emerald-200/80 dark:border-emerald-800/80 shrink-0"
                              >
                                {lang === 'vi' ? 'Hoàn lượt' : 'Credit Refunded'}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate">
                            {formatDocumentMeta(
                              essay.filename,
                              essay.num_pages,
                              lang,
                            )}
                          </p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="py-0 md:py-4 px-0 md:px-2 xl:px-4 whitespace-nowrap flex items-center justify-between md:table-cell">
                      <span className="md:hidden text-[11px] font-medium uppercase text-slate-400">
                        {fmt === 'bib' || fmt === 'ris'
                          ? lang === 'vi'
                            ? 'Định dạng'
                            : 'Format'
                          : t('dashboard.tablePages')}
                      </span>
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-xs font-mono tabular-nums font-semibold text-slate-700 dark:text-slate-300">
                        {pagesCellDisplay}
                      </span>
                    </TableCell>
                    <TableCell className="py-0 md:py-4 px-0 md:px-2 xl:px-4 whitespace-nowrap flex items-center justify-between md:table-cell">
                      <span className="md:hidden text-[11px] font-medium uppercase text-slate-400">
                        CIS
                      </span>
                      <span
                        data-testid={`essay-cis-${essay.id}`}
                        title={cisTooltip}
                        className={`inline-flex items-center px-2.5 py-0.5 rounded-md border text-xs font-mono tabular-nums font-semibold ${cisTone}`}
                      >
                        {cisDisplay}
                      </span>
                    </TableCell>
                    <TableCell className="py-0 md:py-4 px-0 md:px-2 xl:px-4 whitespace-nowrap flex items-center justify-between md:table-cell">
                      <span className="md:hidden text-[11px] font-medium uppercase text-slate-400">
                        {t('dashboard.tableUploaded')}
                      </span>
                      <div className="flex items-center gap-1.5 text-xs font-mono text-slate-600 dark:text-slate-300 whitespace-nowrap">
                        <Clock className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                        {formatLocalizedDate(essay.uploaded_at, lang)}
                      </div>
                    </TableCell>
                    <TableCell className="py-1 md:py-4 px-0 md:px-3.5 xl:px-5 whitespace-nowrap text-right">
                      <div className="flex items-center justify-end gap-1.5 pt-2 md:pt-0 border-t md:border-t-0 border-slate-100 dark:border-slate-800/60">
                        <Link
                          to={targetHref}
                          data-testid={`dashboard-primary-action-${essay.id}`}
                          className="flex-1 md:flex-initial inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-semibold whitespace-nowrap shrink-0 rounded-xl bg-indigo-50 dark:bg-indigo-950/90 text-indigo-700 dark:text-indigo-300 border border-indigo-200/70 dark:border-indigo-800/70 hover:bg-indigo-600 hover:text-white dark:hover:bg-indigo-600 dark:hover:text-white transition-all"
                        >
                          <Eye className="h-3.5 w-3.5 shrink-0" />
                          {isInProgress
                            ? lang === 'vi'
                              ? 'Xem tiến trình'
                              : 'Live Progress'
                            : isFailed
                              ? lang === 'vi'
                                ? 'Chi tiết lỗi'
                                : 'View Error'
                              : t('dashboard.viewReport')}
                        </Link>
                        <button
                          type="button"
                          onClickCapture={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setConfirmDeleteId(essay.id);
                          }}
                          disabled={deletingId === essay.id}
                          className="p-2 shrink-0 rounded-xl text-slate-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/50 transition-colors disabled:opacity-50"
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
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}

        {/* Footer Bar */}
        {essays.length > 0 && (
          <div className="px-4 sm:px-5 py-3 bg-slate-50/70 dark:bg-slate-900/70 border-t border-slate-200/80 dark:border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-1.5 text-xs text-slate-500 dark:text-slate-400">
            <p>
              {t('dashboard.showingCount', {
                shown: filteredEssays.length,
                total: essays.length,
              })}
            </p>
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
