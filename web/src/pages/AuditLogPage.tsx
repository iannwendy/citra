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
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { useDebounce } from '@/hooks/useDebounce';
import { Button } from '@/components/ui/button';
import { api, type AuditLogEntry } from '@/api/client';
import { getHumanVerdictMeta } from '@/lib/teacherGuidance';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { StudioWindowHeader } from '@/components/ui/studio-visuals';
import { NumberPopIn } from '@/components/ui/transitions';

/**
 * AuditLogPage — Visual Review History Timeline for administrators.
 *
 * Replaces dry snake_case log tables with a clean activity timeline showing
 * reviewer avatars, human verdict badge transitions, notes, and deep-link pills.
 */
export const AUDIT_PAGE_SIZE = 25;

export function AuditLogPage() {
  const { t, i18n } = useTranslation();
  const lang: 'en' | 'vi' = i18n.language?.startsWith('vi') ? 'vi' : 'en';
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [auditStats, setAuditStats] = useState<{
    total_events: number;
    unique_actors: number;
  } | null>(null);
  const [userFilter, setUserFilter] = useState('');
  const debouncedUserFilter = useDebounce(userFilter.trim(), 300);
  const [offset, setOffset] = useState(0);
  const [hasNext, setHasNext] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  // A new filter always starts from the first page.
  useEffect(() => {
    setOffset(0);
  }, [debouncedUserFilter]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const statsPromise =
        typeof api.getAuditStats === 'function'
          ? api
              .getAuditStats(debouncedUserFilter || undefined)
              .catch(() => null)
          : Promise.resolve(null);

      // Fetch one extra row to know whether a next page exists.
      const [data, statsRes] = await Promise.all([
        api.listAuditLog({
          limit: AUDIT_PAGE_SIZE + 1,
          offset,
          user: debouncedUserFilter || undefined,
        }),
        statsPromise,
      ]);
      setHasNext(data.length > AUDIT_PAGE_SIZE);
      setEntries(data.slice(0, AUDIT_PAGE_SIZE));
      if (statsRes && typeof statsRes.total_events === 'number') {
        setAuditStats({
          total_events: statsRes.total_events,
          unique_actors:
            typeof statsRes.unique_actors === 'number'
              ? statsRes.unique_actors
              : new Set(data.slice(0, AUDIT_PAGE_SIZE).map((e) => e.user)).size,
        });
      } else {
        setAuditStats(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load audit log');
    } finally {
      setLoading(false);
    }
  }, [debouncedUserFilter, offset]);

  useEffect(() => {
    void load();
  }, [load]);

  const page = Math.floor(offset / AUDIT_PAGE_SIZE) + 1;

  const totalEventsDisplay = auditStats?.total_events ?? entries.length;
  const uniqueActorsDisplay =
    auditStats?.unique_actors ?? new Set(entries.map((e) => e.user)).size;

  const outcomeSummary = useMemo(() => {
    const total = entries.length;
    if (total === 0) return { approved: 0, flagged: 0, approvedPct: 0 };
    const approved = entries.filter(
      (e) => String(e.new_label ?? '').toLowerCase() === 'verified',
    ).length;
    const flagged = total - approved;
    return {
      approved,
      flagged,
      approvedPct: Math.round((approved / total) * 100),
    };
  }, [entries]);

  return (
    <div className="space-y-5 pb-10">
      {/* Clean Header */}
      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 p-5 sm:p-6 shadow-xs flex items-center gap-3.5">
        <div className="w-11 h-11 rounded-2xl bg-indigo-50 dark:bg-indigo-950/80 border border-indigo-200/70 dark:border-indigo-800/70 flex items-center justify-center shrink-0">
          <FileText className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
        </div>
        <div className="min-w-0">
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-slate-900 dark:text-white tracking-tight">
            {t('admin.auditLog')}
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            {lang === 'vi'
              ? 'Dòng thời gian ghi lại mọi quyết định duyệt và chỉnh sửa kết quả trích dẫn của giảng viên.'
              : 'Visual timeline of faculty review decisions and citation verdict changes.'}
          </p>
        </div>
      </div>

      {/* Visual Summary Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="p-4 sm:p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 shadow-2xs flex flex-col justify-between">
          <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
            {lang === 'vi' ? 'Tổng lượt duyệt đã lưu' : 'Total Review Events'}
          </span>
          <p
            data-testid="audit-total-events"
            className="mt-2 text-2xl sm:text-3xl font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100"
          >
            <NumberPopIn value={totalEventsDisplay} />
          </p>
        </Card>

        <Card className="p-4 sm:p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 shadow-2xs flex flex-col justify-between">
          <span className="text-xs font-medium text-indigo-600 dark:text-indigo-400">
            {lang === 'vi' ? 'Giảng viên / Quản trị tham gia' : 'Active Reviewers'}
          </span>
          <p
            data-testid="audit-unique-actors"
            className="mt-2 text-2xl sm:text-3xl font-bold font-mono tabular-nums text-indigo-600 dark:text-indigo-400"
          >
            <NumberPopIn value={uniqueActorsDisplay} />
          </p>
        </Card>

        <Card className="p-4 sm:p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 shadow-2xs flex flex-col justify-between gap-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-slate-600 dark:text-slate-300">
              {lang === 'vi'
                ? 'Tỷ lệ kết quả trên trang này'
                : 'Decisions on Current Page'}
            </span>
            <span className="font-mono font-semibold text-emerald-600 dark:text-emerald-400">
              {entries.length > 0 ? `${outcomeSummary.approvedPct}%` : '—'}
            </span>
          </div>
          <div className="h-2 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden flex">
            {entries.length > 0 && (
              <>
                <div
                  style={{ width: `${outcomeSummary.approvedPct}%` }}
                  className="bg-emerald-500 h-full transition-all"
                />
                <div
                  style={{ width: `${100 - outcomeSummary.approvedPct}%` }}
                  className="bg-amber-500 h-full transition-all"
                />
              </>
            )}
          </div>
          <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
            <span>
              {lang === 'vi'
                ? `${outcomeSummary.approved} duyệt hợp lệ`
                : `${outcomeSummary.approved} approved`}
            </span>
            <span>
              {lang === 'vi'
                ? `${outcomeSummary.flagged} giữ cảnh báo`
                : `${outcomeSummary.flagged} flagged`}
            </span>
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
              className="font-mono text-[11px] bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300 border border-indigo-200/60 dark:border-indigo-800/60"
            >
              {lang === 'vi'
                ? `${entries.length} hoạt động`
                : `${entries.length} entries`}
            </Badge>
          }
        />

        <div className="p-4 border-b border-slate-200/80 dark:border-slate-800 bg-slate-50/30 dark:bg-slate-900/40">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
            <Input
              type="text"
              value={userFilter}
              onChange={(e) => setUserFilter(e.target.value)}
              placeholder={t('admin.filterByUsername')}
              aria-label={
                lang === 'vi'
                  ? 'Lọc nhật ký kiểm toán theo tên đăng nhập'
                  : 'Filter audit log by username'
              }
              className="pl-10 rounded-xl"
            />
            {userFilter && (
              <button
                type="button"
                onClick={() => setUserFilter('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>

        {loading ? (
          <div className="px-4 py-12 flex items-center justify-center">
            <Loader2 className="h-6 w-6 text-indigo-600 animate-spin mr-3" />
            <p className="text-slate-500 text-sm">{t('common.loading')}</p>
          </div>
        ) : entries.length === 0 ? (
          <div className="px-4 py-14 text-center space-y-2">
            <FileText className="h-7 w-7 text-slate-300 dark:text-slate-600 mx-auto" />
            <p className="text-slate-500 text-sm">{t('admin.noAuditLogs')}</p>
          </div>
        ) : (
          <div className="p-4 sm:p-5 space-y-3">
            {entries.map((e) => {
              const fromMeta = getHumanVerdictMeta(e.original_label, lang);
              const toMeta = getHumanVerdictMeta(e.new_label, lang);
              const cleanNote = e.note
                ? e.note.replace(/\s*\[mapping_status:[^\]]+\]\s*$/, '').trim()
                : '';

              return (
                <div
                  key={e.id}
                  className="relative pl-6 sm:pl-7 py-1 before:content-[''] before:absolute before:left-2.5 before:top-3 before:bottom-0 before:w-px before:bg-slate-200 dark:before:bg-slate-800 last:before:hidden"
                >
                  <span
                    aria-hidden="true"
                    className={`absolute left-1 top-3.5 w-3 h-3 rounded-full ring-4 ring-white dark:ring-slate-900 ${toMeta.barClass}`}
                  />

                  <div className="rounded-2xl bg-slate-50/70 dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-800 p-3.5 sm:p-4 hover:border-slate-300 dark:hover:border-slate-700 transition-colors space-y-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-7 h-7 rounded-full bg-indigo-50 dark:bg-indigo-950/80 border border-indigo-200/70 dark:border-indigo-800/70 flex items-center justify-center text-[11px] font-bold text-indigo-700 dark:text-indigo-300 uppercase shrink-0">
                          {(e.user || '?').slice(0, 1)}
                        </div>
                        <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                          {e.user}
                        </span>
                        {e.logged_at && (
                          <span className="text-xs text-slate-400 dark:text-slate-500">
                            · {new Date(e.logged_at).toLocaleString()}
                          </span>
                        )}
                      </div>

                      <div>
                        {e.verdict_id != null && e.verdict_id > 0 ? (
                          e.essay_id ? (
                            <Link
                              to={`/verification/report/${e.essay_id}?citation=${e.verdict_id}`}
                              data-testid={`audit-verdict-link-${e.id}`}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white dark:bg-slate-900 hover:bg-indigo-50 dark:hover:bg-indigo-950/60 border border-slate-200 dark:border-slate-700 text-xs font-mono font-semibold text-indigo-600 dark:text-indigo-400 transition-colors"
                            >
                              <span>#{e.verdict_id}</span>
                              <ExternalLink className="h-3 w-3" />
                            </Link>
                          ) : (
                            <Badge variant="outline" className="font-mono text-xs">
                              #{e.verdict_id}
                            </Badge>
                          )
                        ) : (
                          <Badge variant="secondary" className="text-xs">
                            {lang === 'vi' ? 'Hệ thống' : 'System'}
                          </Badge>
                        )}
                      </div>
                    </div>

                    {/* Visual State Transition Diagram */}
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-medium ${fromMeta.badgeClass}`}
                      >
                        <span className={`w-1.5 h-1.5 rounded-full ${fromMeta.barClass}`} />
                        {fromMeta.label}
                      </span>
                      <ArrowRight className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                      <span
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-semibold ${toMeta.badgeClass}`}
                      >
                        <span className={`w-1.5 h-1.5 rounded-full ${toMeta.barClass}`} />
                        {toMeta.label}
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
