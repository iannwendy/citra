import { useState } from 'react';
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
  Terminal,
  GitBranch,
  AlertCircle,
  Lock,
} from 'lucide-react';
import { useToast } from '@/contexts/ToastContext';
import { ConfirmationModal } from '@/components/ConfirmationModal';
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
import { Separator } from '@/components/ui/separator';
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
   SourceLogic — Dashboard Page Component (Scholarly Precision v2.0)
   Shows overview of all uploaded documents + aggregate stats
   ============================================================ */

const DEFAULT_STATS: DashboardStats = {
  total_documents: 0,
  total_citations: 0,
  avg_cis_score: null,
  verified_rate: 0,
};

export function DashboardPage() {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const { isUser, isTeacher, isAdmin, has, canBatchUpload } = useRole();
  const canViewTrace = has('view_logic_trace');
  const { data: essays = [], isLoading, error, refetch, isFetching } = useEssays();
  const { data: stats = DEFAULT_STATS } = useDashboardStats();
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

  // Filter essays by search query
  const filteredEssays = essays.filter((essay) =>
    essay.filename.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Stat cards data
  const statCards = [
    {
      idx: '01',
      label: t('dashboard.totalDocuments'),
      value: stats.total_documents,
      sub: lang === 'vi' ? 'Tài liệu học thuật đã phân tích' : 'Analyzed academic documents',
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
      sub: lang === 'vi' ? 'Trích dẫn bóc tách đa định dạng' : 'Multi-format citation extractions',
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
      value: stats.avg_cis_score !== null ? `${stats.avg_cis_score}%` : 'N/A',
      sub: lang === 'vi' ? 'Chỉ số Toàn vẹn Trích dẫn (0–100)' : 'Citation Integrity Score (0–100)',
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
      value: stats.verified_rate > 0 ? `${stats.verified_rate}%` : 'N/A',
      sub:
        lang === 'vi'
          ? `Xác thực trên ${SCHOLARLY_APIS_LABEL} CSDL học thuật`
          : `Verified across ${SCHOLARLY_APIS_LABEL} scholarly indexes`,
      icon: CheckCircle2,
      color: 'text-sky-600 dark:text-sky-400',
      iconBox:
        'bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20',
      badgeTone:
        'bg-sky-50 text-sky-700 dark:bg-sky-950/80 dark:text-sky-300 border-sky-200/60 dark:border-sky-800/60',
    },
  ];

  const dateLocale = lang === 'vi' ? 'vi-VN' : 'en-US';

  return (
    <div className="space-y-6 pb-8">
      {/* Executive Page Header Banner */}
      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 p-5 sm:p-6 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1.5">
          {!isUser && (
            <div className="flex items-center gap-2.5 flex-wrap">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-950/80 border border-indigo-200/70 dark:border-indigo-800/70 text-[11px] font-mono font-semibold text-indigo-700 dark:text-indigo-300">
                <Terminal className="h-3 w-3" />
                {lang === 'vi' ? 'TRUNG TÂM KIỂM CHỨNG' : 'VERIFICATION WORKSPACE'}
              </span>
            </div>
          )}
          <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            {t('dashboard.title')}
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            {t('dashboard.subtitle')}
          </p>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap shrink-0">
          {canBatchUpload && (
            <Button
              asChild
              variant="outline"
              size="sm"
              className="h-10 rounded-xl font-medium border-slate-200 dark:border-slate-700"
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
            aria-label="Refresh essays list"
            title={t('common.refresh')}
            className="h-10 w-10 rounded-xl border-slate-200 dark:border-slate-700"
          >
            <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {/* 4 Architectural Metric Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {statCards.map((card) => {
          const Icon = card.icon;
          return (
            <Card
              key={card.label}
              className="card group relative overflow-hidden rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 p-3.5 sm:p-5 shadow-xs hover:shadow-md hover:-translate-y-0.5 hover:border-indigo-300 dark:hover:border-indigo-700 transition-all duration-200"
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
              <p className={`text-2xl sm:text-3xl font-bold font-mono tabular-nums tracking-tight ${card.color}`}>
                <NumberPopIn value={card.value} />
              </p>
              <p className="text-sm font-semibold text-slate-800 dark:text-slate-200 mt-1">
                {card.label}
              </p>
              {!isUser && (
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
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

      {/* IDE Window Container for Document Registry & Search */}
      <Card className="p-0 overflow-hidden rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm">
        {/* Top Window Chrome Bar */}
        <div className="px-4 sm:px-6 py-3.5 bg-slate-50/80 dark:bg-slate-900/90 border-b border-slate-200/80 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-red-400/80 inline-block" />
              <span className="w-2.5 h-2.5 rounded-full bg-amber-400/80 inline-block" />
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400/80 inline-block" />
            </div>
            <Separator orientation="vertical" className="h-4" />
            <span className="font-mono text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300">
              {t('dashboard.recentActivity')}
            </span>
            <Badge
              variant="secondary"
              className="font-mono text-[11px] bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300 border border-indigo-200/60 dark:border-indigo-800/60"
            >
              {filteredEssays.length} / {essays.length}
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

        {/* Table or Empty State */}
        {isLoading && essays.length === 0 ? (
          <div className="p-14 flex flex-col items-center justify-center">
            <Loader2 className="h-8 w-8 text-indigo-600 dark:text-indigo-400 animate-spin mb-4" />
            <p className="text-sm font-mono text-slate-600 dark:text-slate-300">
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
                {!(isTeacher || isAdmin) && (
                  <Button asChild className="rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white">
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
          <Table className="t-skel-reveal block sm:table">
            <TableHeader className="hidden sm:table-header-group">
              <TableRow className="bg-slate-50/50 dark:bg-slate-900/50 border-b border-slate-200/80 dark:border-slate-800">
                <TableHead className="font-mono text-[11px] uppercase tracking-wider text-slate-500 dark:text-slate-400 py-3 px-5">
                  {t('dashboard.tableDocument')}
                </TableHead>
                <TableHead className="font-mono text-[11px] uppercase tracking-wider text-slate-500 dark:text-slate-400 py-3">
                  {t('dashboard.tablePages')}
                </TableHead>
                <TableHead className="font-mono text-[11px] uppercase tracking-wider text-slate-500 dark:text-slate-400 py-3">
                  {t('dashboard.tableUploaded')}
                </TableHead>
                <TableHead className="font-mono text-[11px] uppercase tracking-wider text-slate-500 dark:text-slate-400 py-3 px-5 text-right">
                  {t('dashboard.tableActions')}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="block sm:table-row-group divide-y divide-slate-100 dark:divide-slate-800/80">
              {filteredEssays.map((essay) => (
                <TableRow
                  key={essay.id}
                  className="flex flex-col sm:table-row p-3.5 sm:p-0 gap-2 sm:gap-0 group hover:bg-slate-50/80 dark:hover:bg-slate-900/60 transition-colors"
                >
                  <TableCell className="py-0 sm:py-3.5 px-0 sm:px-5 min-w-0 w-full sm:w-auto">
                    <div className="flex items-center gap-3 min-w-0">
                      <FileFormatIcon filename={essay.filename} size="md" />
                      <div className="min-w-0 flex-1">
                        <Link
                          to={`/verification/report/${essay.id}`}
                          title={essay.filename}
                          className="text-sm font-semibold text-slate-900 dark:text-slate-100 hover:text-indigo-600 dark:hover:text-indigo-400 truncate max-w-full sm:max-w-xs md:max-w-md block transition-colors"
                        >
                          {essay.filename}
                        </Link>
                        {!isUser && (
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                              ID #{essay.id}
                            </span>
                            <span className="text-slate-300 dark:text-slate-700">·</span>
                            {(() => {
                              const fmt = getDocumentFormat(essay.filename);
                              if (fmt === 'docx') {
                                return (
                                  <span className="text-[11px] font-mono font-medium text-[#2563EB] dark:text-[#60A5FA]">
                                    WORD DOCX · OPENXML
                                  </span>
                                );
                              }
                              if (fmt === 'bib') {
                                return (
                                  <span className="text-[11px] font-mono font-medium text-emerald-600 dark:text-emerald-400">
                                    BIBTEX · .BIB
                                  </span>
                                );
                              }
                              if (fmt === 'ris') {
                                return (
                                  <span className="text-[11px] font-mono font-medium text-amber-600 dark:text-amber-400">
                                    RIS · BIBLIOGRAPHY
                                  </span>
                                );
                              }
                              return (
                                <span className="text-[11px] font-mono text-emerald-600 dark:text-emerald-400">
                                  GROBID TEI
                                </span>
                              );
                            })()}
                          </div>
                        )}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="py-0 sm:py-4 px-0 sm:px-4 flex items-center justify-between sm:table-cell">
                    <span className="sm:hidden text-[11px] font-mono uppercase text-slate-400">
                      {t('dashboard.tablePages')}
                    </span>
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-xs font-mono tabular-nums font-semibold text-slate-700 dark:text-slate-300">
                      {essay.num_pages}
                    </span>
                  </TableCell>
                  <TableCell className="py-0 sm:py-4 px-0 sm:px-4 flex items-center justify-between sm:table-cell">
                    <span className="sm:hidden text-[11px] font-mono uppercase text-slate-400">
                      {t('dashboard.tableUploaded')}
                    </span>
                    <div className="flex items-center gap-1.5 text-xs font-mono text-slate-600 dark:text-slate-300 whitespace-nowrap">
                      <Clock className="h-3.5 w-3.5 text-slate-400" />
                      {new Date(essay.uploaded_at).toLocaleDateString(dateLocale, {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      })}
                    </div>
                  </TableCell>
                  <TableCell className="py-1 sm:py-4 px-0 sm:px-5 text-right">
                    <div className="flex items-center justify-end gap-1.5 pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-100 dark:border-slate-800/60">
                      <Link
                        to={`/verification/report/${essay.id}/issues`}
                        title={t('essay.issues')}
                        className="hidden md:inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-mono font-medium rounded-lg border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:border-amber-300 dark:hover:border-amber-700 hover:text-amber-600 dark:hover:text-amber-400 transition-colors"
                      >
                        <AlertCircle className="h-3.5 w-3.5" />
                        <span>{t('essay.issues')}</span>
                      </Link>
                      {canViewTrace ? (
                        <Link
                          to={`/verification/report/${essay.id}/trace`}
                          title={t('essay.logicTrace')}
                          data-testid={`dashboard-trace-link-${essay.id}`}
                          className="hidden lg:inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-mono font-medium rounded-lg border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:border-violet-300 dark:hover:border-violet-700 hover:text-violet-600 dark:hover:text-violet-400 transition-colors"
                        >
                          <GitBranch className="h-3.5 w-3.5" />
                          <span>Trace</span>
                        </Link>
                      ) : (
                        <Link
                          to="/pricing"
                          title={
                            lang === 'vi'
                              ? 'Logic Trace có trong gói Pro / Ultra — bấm để nâng cấp'
                              : 'Logic Trace is available on Pro / Ultra — click to upgrade'
                          }
                          data-testid={`dashboard-trace-locked-${essay.id}`}
                          className="hidden lg:inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-mono font-medium rounded-lg border border-dashed border-slate-200 dark:border-slate-800 text-slate-400 dark:text-slate-500 hover:text-amber-600 dark:hover:text-amber-400 transition-colors"
                        >
                          <Lock className="h-3.5 w-3.5" />
                          <span>Trace</span>
                        </Link>
                      )}
                      <Link
                        to={`/verification/report/${essay.id}`}
                        className="flex-1 sm:flex-initial inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-xl bg-indigo-50 dark:bg-indigo-950/90 text-indigo-700 dark:text-indigo-300 border border-indigo-200/70 dark:border-indigo-800/70 hover:bg-indigo-600 hover:text-white dark:hover:bg-indigo-600 dark:hover:text-white transition-all"
                      >
                        <Eye className="h-3.5 w-3.5" />
                        {t('dashboard.viewReport')}
                      </Link>
                      <button
                        onClickCapture={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setConfirmDeleteId(essay.id);
                        }}
                        disabled={deletingId === essay.id}
                        className="p-2 rounded-xl text-slate-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/50 transition-colors disabled:opacity-50"
                        title={t('common.delete')}
                        aria-label={`Delete ${essay.filename}`}
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
              ))}
            </TableBody>
          </Table>
        )}

        {/* Footer Bar */}
        {essays.length > 0 && (
          <div className="px-4 sm:px-5 py-3 bg-slate-50/70 dark:bg-slate-900/70 border-t border-slate-200/80 dark:border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-1.5 text-xs font-mono text-slate-500 dark:text-slate-400">
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
