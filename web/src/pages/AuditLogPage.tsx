import { useEffect, useState, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  FileText,
  Search,
  AlertCircle,
  Loader2,
  X,
  ChevronLeft,
  ChevronRight,
  ArrowRight,
  ExternalLink,
  MessageSquareQuote,
  RefreshCw,
  Download,
  User as UserIcon,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { useDebounce } from '@/hooks/useDebounce';
import { useToast } from '@/contexts/ToastContext';
import { Button } from '@/components/ui/button';
import { api, type AuditLogEntry } from '@/api/client';
import {
  formatLocalizedDateTime,
  formatUserError,
  getVerdictDisplay,
  normalizeVerdictKey,
  resolveAcademicLang,
  type CanonicalVerdictKey,
} from '@/lib/academicTaxonomy';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { StudioWindowHeader } from '@/components/ui/studio-visuals';
import { NumberPopIn } from '@/components/ui/transitions';

/**
 * AuditLogPage — Visual Citation Review Log for administrators.
 *
 * Displays reviewer decisions, essay & student context, canonical non-accusatory
 * verdict transitions, notes, CSV export, and deep links to each report citation.
 */
export const AUDIT_PAGE_SIZE = 25;

type VerdictFilterKey = 'all' | CanonicalVerdictKey;

function escapeCsvCell(raw: string | number | null | undefined): string {
  const str = String(raw ?? '');
  const safe = /^[=+\-@\t\r]/.test(str) ? `'${str}` : str;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function AuditLogPage() {
  const { t, i18n } = useTranslation();
  const lang = resolveAcademicLang(i18n.language);
  const numLocale = lang === 'vi' ? 'vi-VN' : 'en-US';
  const toast = useToast();

  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [globalStats, setGlobalStats] = useState<{
    total_events: number;
    unique_actors: number;
  } | null>(null);
  const [userFilter, setUserFilter] = useState('');
  const [verdictFilter, setVerdictFilter] = useState<VerdictFilterKey>('all');
  const debouncedUserFilter = useDebounce(userFilter.trim(), 300);
  const [offset, setOffset] = useState(0);
  const [hasNext, setHasNext] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // A new user filter always starts from the first page.
  useEffect(() => {
    setOffset(0);
  }, [debouncedUserFilter]);

  const loadGlobalStats = useCallback(async () => {
    if (typeof api.getAuditStats !== 'function') return;
    try {
      const statsRes = await api.getAuditStats(undefined);
      if (statsRes && typeof statsRes.total_events === 'number') {
        setGlobalStats({
          total_events: statsRes.total_events,
          unique_actors:
            typeof statsRes.unique_actors === 'number'
              ? statsRes.unique_actors
              : 0,
        });
      }
    } catch {
      // Keep last known global stats or fallback to loaded entries
    }
  }, []);

  const loadEntries = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      // Fetch one extra row to know whether a next page exists.
      const data = await api.listAuditLog({
        limit: AUDIT_PAGE_SIZE + 1,
        offset,
        user: debouncedUserFilter || undefined,
      });
      setHasNext(data.length > AUDIT_PAGE_SIZE);
      setEntries(data.slice(0, AUDIT_PAGE_SIZE));
    } catch (e) {
      setError(
        formatUserError(
          e,
          lang,
          lang === 'vi'
            ? 'Không thể tải nhật ký duyệt trích dẫn.'
            : 'Failed to load citation review log.',
        ),
      );
    } finally {
      setLoading(false);
    }
  }, [debouncedUserFilter, lang, offset]);

  useEffect(() => {
    void loadGlobalStats();
  }, [loadGlobalStats]);

  useEffect(() => {
    void loadEntries();
  }, [loadEntries]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all([loadGlobalStats(), loadEntries()]);
    } finally {
      setRefreshing(false);
    }
  };

  const visibleEntries = useMemo(() => {
    if (verdictFilter === 'all') return entries;
    return entries.filter(
      (e) => normalizeVerdictKey(e.new_label) === verdictFilter,
    );
  }, [entries, verdictFilter]);

  const page = Math.floor(offset / AUDIT_PAGE_SIZE) + 1;

  const totalEventsDisplay = globalStats?.total_events ?? entries.length;
  const uniqueActorsDisplay =
    globalStats?.unique_actors ?? new Set(entries.map((e) => e.user)).size;

  // Accurate 3-way breakdown: resource & unresolved are NOT counted as flagged!
  const outcomeSummary = useMemo(() => {
    const total = visibleEntries.length;
    if (total === 0) {
      return {
        approved: 0,
        flagged: 0,
        neutral: 0,
        approvedPct: 0,
        flaggedPct: 0,
        neutralPct: 0,
      };
    }
    let approved = 0;
    let flagged = 0;
    let neutral = 0;
    for (const entry of visibleEntries) {
      const key = normalizeVerdictKey(entry.new_label);
      if (key === 'verified') {
        approved += 1;
      } else if (
        key === 'metadata_error' ||
        key === 'suspected_hallucination'
      ) {
        flagged += 1;
      } else {
        neutral += 1;
      }
    }
    const approvedPct = Math.round((approved / total) * 100);
    const flaggedPct = Math.round((flagged / total) * 100);
    const neutralPct = Math.max(0, 100 - approvedPct - flaggedPct);
    return {
      approved,
      flagged,
      neutral,
      approvedPct,
      flaggedPct,
      neutralPct,
    };
  }, [visibleEntries]);

  const hasActiveFilters =
    Boolean(userFilter.trim()) || verdictFilter !== 'all';

  const resetFilters = () => {
    setUserFilter('');
    setVerdictFilter('all');
    setOffset(0);
  };

  const handleExportCsv = () => {
    if (visibleEntries.length === 0) return;
    const headers = [
      'ID',
      'Logged At',
      'Reviewer',
      'Essay ID',
      'Essay Filename',
      'Student',
      'Verdict ID',
      'Original Label',
      'New Label',
      'Note',
    ];
    const rows = visibleEntries.map((e) => {
      const cleanNote = e.note
        ? e.note.replace(/\s*\[mapping_status:[^\]]+\]\s*$/, '').trim()
        : '';
      return [
        escapeCsvCell(e.id),
        escapeCsvCell(
          e.logged_at ? formatLocalizedDateTime(e.logged_at, lang) : '',
        ),
        escapeCsvCell(e.user),
        escapeCsvCell(e.essay_id ?? ''),
        escapeCsvCell(e.essay_filename ?? ''),
        escapeCsvCell(e.student_name ?? e.student_username ?? ''),
        escapeCsvCell(e.verdict_id ?? ''),
        escapeCsvCell(getVerdictDisplay(e.original_label, lang).label),
        escapeCsvCell(getVerdictDisplay(e.new_label, lang).label),
        escapeCsvCell(cleanNote),
      ].join(',');
    });
    const csvContent = `\uFEFF${[headers.join(','), ...rows].join('\n')}`;
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const dateStamp = new Date().toISOString().slice(0, 10);
    link.href = url;
    link.download = `citation_review_log_${dateStamp}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    toast.success(
      lang === 'vi' ? 'Đã xuất tệp CSV' : 'CSV Exported',
      lang === 'vi'
        ? `Đã tải xuống ${visibleEntries.length} bản ghi duyệt trích dẫn.`
        : `Downloaded ${visibleEntries.length} citation review entries.`,
    );
  };

  return (
    <div className="space-y-5 pb-10">
      {/* Clean Header with Refresh & Export CSV Actions */}
      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 p-5 sm:p-6 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3.5 min-w-0">
          <div className="w-11 h-11 rounded-2xl bg-indigo-50 dark:bg-indigo-950/80 border border-indigo-200/70 dark:border-indigo-800/70 flex items-center justify-center shrink-0">
            <FileText className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
          </div>
          <div className="min-w-0">
            <h1 className="font-display text-2xl sm:text-3xl font-bold text-slate-900 dark:text-white tracking-tight">
              {lang === 'vi'
                ? 'Nhật ký duyệt trích dẫn'
                : 'Citation Review Log'}
            </h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
              {lang === 'vi'
                ? 'Dòng thời gian ghi lại mọi quyết định duyệt và chỉnh sửa kết quả trích dẫn của giảng viên & quản trị viên.'
                : 'Timeline of faculty & admin review decisions and citation verdict updates.'}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid="audit-refresh-btn"
            disabled={loading || refreshing}
            onClick={() => void handleRefresh()}
            className="gap-1.5 rounded-xl text-xs cursor-pointer"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${loading || refreshing ? 'animate-spin' : ''}`}
            />
            {lang === 'vi' ? 'Làm mới' : 'Refresh'}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid="audit-export-csv-btn"
            disabled={visibleEntries.length === 0}
            onClick={handleExportCsv}
            className="gap-1.5 rounded-xl text-xs cursor-pointer"
          >
            <Download className="h-3.5 w-3.5" />
            {lang === 'vi' ? 'Xuất CSV' : 'Export CSV'}
          </Button>
        </div>
      </div>

      {/* Visual Summary Strip (Global totals preserved during search!) */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="p-4 sm:p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 shadow-sm flex flex-col justify-between">
          <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
            {lang === 'vi' ? 'Tổng lượt duyệt đã lưu' : 'Total Review Events'}
          </span>
          <p
            data-testid="audit-total-events"
            className="mt-2 text-2xl sm:text-3xl font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100"
          >
            <NumberPopIn value={totalEventsDisplay.toLocaleString(numLocale)} />
          </p>
        </Card>

        <Card className="p-4 sm:p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 shadow-sm flex flex-col justify-between">
          <span className="text-xs font-medium text-indigo-600 dark:text-indigo-400">
            {lang === 'vi' ? 'Giảng viên / Quản trị tham gia' : 'Active Reviewers'}
          </span>
          <p
            data-testid="audit-unique-actors"
            className="mt-2 text-2xl sm:text-3xl font-bold font-mono tabular-nums text-indigo-600 dark:text-indigo-400"
          >
            <NumberPopIn value={uniqueActorsDisplay.toLocaleString(numLocale)} />
          </p>
        </Card>

        <Card className="p-4 sm:p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 shadow-sm flex flex-col justify-between gap-2">
          <div className="flex items-center justify-between text-xs gap-2">
            <span className="font-medium text-slate-600 dark:text-slate-300">
              {lang === 'vi'
                ? 'Tỷ lệ kết quả trên trang này'
                : 'Decisions on Current Page'}
            </span>
            <span className="font-mono font-semibold text-emerald-600 dark:text-emerald-400 whitespace-nowrap">
              {visibleEntries.length > 0 ? `${outcomeSummary.approvedPct}%` : '—'}
            </span>
          </div>
          <div className="h-2 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden flex">
            {visibleEntries.length > 0 && (
              <>
                {outcomeSummary.approved > 0 && (
                  <div
                    style={{ width: `${outcomeSummary.approvedPct}%` }}
                    className="bg-emerald-500 h-full transition-all"
                  />
                )}
                {outcomeSummary.flagged > 0 && (
                  <div
                    style={{ width: `${outcomeSummary.flaggedPct}%` }}
                    className="bg-amber-500 h-full transition-all"
                  />
                )}
                {outcomeSummary.neutral > 0 && (
                  <div
                    style={{ width: `${outcomeSummary.neutralPct}%` }}
                    className="bg-violet-500 h-full transition-all"
                  />
                )}
              </>
            )}
          </div>
          <div
            data-testid="audit-outcome-breakdown"
            className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-[11px] text-slate-500 dark:text-slate-400"
          >
            <span className="inline-flex items-center gap-1 whitespace-nowrap">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
              {lang === 'vi'
                ? `${outcomeSummary.approved} đã xác minh`
                : `${outcomeSummary.approved} verified`}
            </span>
            <span className="inline-flex items-center gap-1 whitespace-nowrap">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />
              {lang === 'vi'
                ? `${outcomeSummary.flagged} giữ cảnh báo`
                : `${outcomeSummary.flagged} flagged`}
            </span>
            {outcomeSummary.neutral > 0 && (
              <span className="inline-flex items-center gap-1 whitespace-nowrap">
                <span className="w-1.5 h-1.5 rounded-full bg-violet-500 shrink-0" />
                {lang === 'vi'
                  ? `${outcomeSummary.neutral} nguồn web / khác`
                  : `${outcomeSummary.neutral} web / other`}
              </span>
            )}
          </div>
        </Card>
      </div>

      {error && (
        <Alert variant="destructive" className="rounded-2xl">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Visual Review Activity Timeline Studio */}
      <div className="rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm overflow-hidden">
        <StudioWindowHeader
          title={
            lang === 'vi'
              ? 'LỊCH SỬ DUYỆT TRÍCH DẪN'
              : 'REVIEW ACTIVITY LOG'
          }
          badge={
            <Badge
              variant="secondary"
              className="font-mono text-[11px] bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300 border border-indigo-200/60 dark:border-indigo-800/60 whitespace-nowrap"
            >
              {lang === 'vi'
                ? `${visibleEntries.length} hoạt động`
                : `${visibleEntries.length} entries`}
            </Badge>
          }
        />

        {/* Username Search + Verdict Filter */}
        <div className="p-4 border-b border-slate-200/80 dark:border-slate-800 bg-slate-50/30 dark:bg-slate-900/40 flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
            <Input
              type="text"
              value={userFilter}
              onChange={(e) => setUserFilter(e.target.value)}
              placeholder={t('admin.filterByUsername')}
              aria-label={
                lang === 'vi'
                  ? 'Lọc nhật ký duyệt trích dẫn theo tên đăng nhập'
                  : 'Filter audit log by username'
              }
              className="pl-10 pr-9 rounded-xl"
            />
            {userFilter && (
              <button
                type="button"
                onClick={() => setUserFilter('')}
                aria-label={
                  lang === 'vi' ? 'Xóa bộ lọc người dùng' : 'Clear username filter'
                }
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          <Select
            data-testid="audit-verdict-filter"
            value={verdictFilter}
            onChange={(e) =>
              setVerdictFilter(e.target.value as VerdictFilterKey)
            }
            aria-label={
              lang === 'vi' ? 'Lọc theo kết quả mới' : 'Filter by new verdict'
            }
            wrapperClassName="sm:w-56"
            className="w-full rounded-xl"
          >
            <option value="all">
              {lang === 'vi' ? 'Tất cả kết quả' : 'All Verdicts'}
            </option>
            <option value="verified">
              {lang === 'vi' ? 'Đã xác minh' : 'Verified'}
            </option>
            <option value="metadata_error">
              {lang === 'vi' ? 'Sai lệch thông tin' : 'Details Mismatch'}
            </option>
            <option value="suspected_hallucination">
              {lang === 'vi' ? 'Không tìm thấy nguồn' : 'Source Not Found'}
            </option>
            <option value="resource">
              {lang === 'vi' ? 'Nguồn Web / Văn bản' : 'Web / Legal Source'}
            </option>
            <option value="unresolved">
              {lang === 'vi' ? 'Chưa đủ dữ liệu' : 'Unverified'}
            </option>
          </Select>
        </div>

        {loading ? (
          <div className="px-4 py-12 flex items-center justify-center">
            <Loader2 className="h-6 w-6 text-indigo-600 animate-spin mr-3" />
            <p className="text-slate-500 text-sm">{t('common.loading')}</p>
          </div>
        ) : visibleEntries.length === 0 ? (
          <div className="px-4 py-14 text-center space-y-2.5">
            <FileText className="h-7 w-7 text-slate-300 dark:text-slate-600 mx-auto" />
            {hasActiveFilters || (globalStats?.total_events ?? 0) > 0 ? (
              <>
                <p className="text-slate-700 dark:text-slate-300 text-sm font-medium">
                  {lang === 'vi'
                    ? 'Không có bản ghi khớp bộ lọc'
                    : 'No review records match your filters'}
                </p>
                <p className="text-slate-400 text-xs">
                  {lang === 'vi'
                    ? 'Thử thay đổi tên đăng nhập hoặc bộ lọc kết quả.'
                    : 'Try adjusting the reviewer search or verdict filter.'}
                </p>
                {hasActiveFilters && (
                  <div className="pt-1">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      data-testid="audit-reset-filters-btn"
                      onClick={resetFilters}
                      className="rounded-xl gap-1.5 text-xs"
                    >
                      <X className="h-3.5 w-3.5" />
                      {lang === 'vi' ? 'Xóa bộ lọc' : 'Reset Filters'}
                    </Button>
                  </div>
                )}
              </>
            ) : (
              <p className="text-slate-500 text-sm">
                {lang === 'vi'
                  ? 'Chưa có lịch sử duyệt trích dẫn nào.'
                  : 'No citation review logs yet.'}
              </p>
            )}
          </div>
        ) : (
          <div className="p-4 sm:p-5 space-y-3">
            {visibleEntries.map((e) => {
              const fromMeta = getVerdictDisplay(e.original_label, lang);
              const toMeta = getVerdictDisplay(e.new_label, lang);
              const cleanNote = e.note
                ? e.note.replace(/\s*\[mapping_status:[^\]]+\]\s*$/, '').trim()
                : '';
              const studentDisplay = e.student_name || e.student_username;

              return (
                <div
                  key={e.id}
                  data-testid={`audit-entry-${e.id}`}
                  className="relative pl-6 sm:pl-7 py-1 before:content-[''] before:absolute before:left-2.5 before:top-3 before:bottom-0 before:w-px before:bg-slate-200 dark:before:bg-slate-800 last:before:hidden"
                >
                  <span
                    aria-hidden="true"
                    className={`absolute left-1 top-3.5 w-3 h-3 rounded-full ring-4 ring-white dark:ring-slate-900 ${toMeta.dotClass}`}
                  />

                  <div className="rounded-2xl bg-slate-50/70 dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-800 p-3.5 sm:p-4 hover:border-slate-300 dark:hover:border-slate-700 transition-colors space-y-2.5">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 min-w-0">
                        <div className="w-7 h-7 rounded-full bg-indigo-50 dark:bg-indigo-950/80 border border-indigo-200/70 dark:border-indigo-800/70 flex items-center justify-center text-[11px] font-bold text-indigo-700 dark:text-indigo-300 uppercase shrink-0">
                          {(e.user || '?').slice(0, 1)}
                        </div>
                        <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                          {e.user}
                        </span>
                        {e.logged_at && (
                          <span
                            data-testid={`audit-time-${e.id}`}
                            className="text-xs text-slate-500 dark:text-slate-400 font-mono whitespace-nowrap"
                          >
                            · {formatLocalizedDateTime(e.logged_at, lang)}
                          </span>
                        )}
                      </div>

                      <div className="shrink-0">
                        {e.verdict_id != null && e.verdict_id > 0 ? (
                          e.essay_id ? (
                            <Link
                              to={`/verification/report/${e.essay_id}?citation=${e.verdict_id}`}
                              data-testid={`audit-verdict-link-${e.id}`}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white dark:bg-slate-900 hover:bg-indigo-50 dark:hover:bg-indigo-950/60 border border-slate-200 dark:border-slate-700 text-xs font-mono font-semibold text-indigo-600 dark:text-indigo-400 transition-colors whitespace-nowrap"
                            >
                              <span>#{e.verdict_id}</span>
                              <ExternalLink className="h-3 w-3 shrink-0" />
                            </Link>
                          ) : (
                            <Badge
                              variant="outline"
                              className="font-mono text-xs whitespace-nowrap"
                            >
                              #{e.verdict_id}
                            </Badge>
                          )
                        ) : (
                          <Badge
                            variant="secondary"
                            className="text-xs whitespace-nowrap"
                          >
                            {lang === 'vi' ? 'Hệ thống' : 'System'}
                          </Badge>
                        )}
                      </div>
                    </div>

                    {/* Essay Filename & Student Context */}
                    {(e.essay_filename || studentDisplay) && (
                      <div
                        data-testid={`audit-context-${e.id}`}
                        className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600 dark:text-slate-300"
                      >
                        {e.essay_filename && (
                          <span
                            title={e.essay_filename}
                            className="inline-flex items-center gap-1.5 min-w-0 max-w-full"
                          >
                            <FileText className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                            <span className="font-medium truncate max-w-[260px] sm:max-w-[380px]">
                              {e.essay_filename}
                            </span>
                          </span>
                        )}
                        {studentDisplay && (
                          <span className="inline-flex items-center gap-1 text-slate-500 dark:text-slate-400 whitespace-nowrap">
                            <UserIcon className="h-3 w-3 shrink-0" />
                            <span>
                              {lang === 'vi' ? 'Sinh viên:' : 'Student:'}{' '}
                              <strong className="font-medium text-slate-700 dark:text-slate-200">
                                {studentDisplay}
                              </strong>
                            </span>
                          </span>
                        )}
                      </div>
                    )}

                    {/* Visual State Transition Diagram — Arrow Grouped with Target to Prevent Dangling Arrow on Mobile */}
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-medium whitespace-nowrap ${fromMeta.badgeClass}`}
                      >
                        <span
                          className={`w-1.5 h-1.5 rounded-full shrink-0 ${fromMeta.dotClass}`}
                        />
                        {fromMeta.label}
                      </span>
                      <span className="inline-flex items-center gap-2">
                        <ArrowRight
                          className="h-3.5 w-3.5 text-slate-400 shrink-0"
                          aria-hidden="true"
                        />
                        <span
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-semibold whitespace-nowrap ${toMeta.badgeClass}`}
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full shrink-0 ${toMeta.dotClass}`}
                          />
                          {toMeta.label}
                        </span>
                      </span>
                    </div>

                    {cleanNote && (
                      <div className="flex items-start gap-2 text-xs text-slate-600 dark:text-slate-300 bg-white/80 dark:bg-slate-900/60 rounded-xl px-3 py-2 border border-slate-200/60 dark:border-slate-800">
                        <MessageSquareQuote className="h-3.5 w-3.5 text-slate-400 mt-0.5 shrink-0" />
                        <span className="leading-relaxed">{cleanNote}</span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div
          className="px-4 py-3 border-t border-slate-200/80 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500"
          data-testid="audit-pagination"
        >
          <div className="flex items-center gap-2.5">
            <span className="font-medium text-slate-700 dark:text-slate-300">
              {lang === 'vi' ? `Trang ${page}` : `Page ${page}`}
            </span>
            <span
              data-testid="audit-page-size"
              className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 font-mono text-[11px] text-slate-500 dark:text-slate-400"
            >
              {lang === 'vi'
                ? `${AUDIT_PAGE_SIZE} / TRANG`
                : `${AUDIT_PAGE_SIZE} / PAGE`}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={loading || offset === 0}
              onClick={() => setOffset((o) => Math.max(0, o - AUDIT_PAGE_SIZE))}
              data-testid="audit-prev-page"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              {lang === 'vi' ? 'Trước' : 'Prev'}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={loading || !hasNext}
              onClick={() => setOffset((o) => o + AUDIT_PAGE_SIZE)}
              data-testid="audit-next-page"
            >
              {lang === 'vi' ? 'Sau' : 'Next'}
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
