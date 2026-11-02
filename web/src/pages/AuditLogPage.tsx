import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  FileText,
  Search,
  AlertCircle,
  ShieldCheck,
  Terminal,
  Loader2,
  X,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { useDebounce } from '@/hooks/useDebounce';
import { Button } from '@/components/ui/button';
import { api, type AuditLogEntry } from '@/api/client';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

/**
 * AuditLogPage — admin-only audit log (Scholarly Precision v2.0).
 *
 * Lists override events recorded by `Repository.log_audit`.
 * Filter by username; default limit 100 newest-first.
 */
export const AUDIT_PAGE_SIZE = 25;

export function AuditLogPage() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language?.startsWith('vi') ? 'vi' : 'en';
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
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
      // Fetch one extra row to know whether a next page exists.
      const data = await api.listAuditLog({
        limit: AUDIT_PAGE_SIZE + 1,
        offset,
        user: debouncedUserFilter || undefined,
      });
      setHasNext(data.length > AUDIT_PAGE_SIZE);
      setEntries(data.slice(0, AUDIT_PAGE_SIZE));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load audit log');
    } finally {
      setLoading(false);
    }
  }, [debouncedUserFilter, offset]);

  useEffect(() => {
    load();
  }, [load]);

  const page = Math.floor(offset / AUDIT_PAGE_SIZE) + 1;

  const uniqueActors = new Set(entries.map((e) => e.user)).size;

  return (
    <div className="space-y-6 pb-10">
      {/* Executive Header Card */}
      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 p-5 sm:p-6 shadow-xs">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2.5 flex-wrap mb-2.5">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-indigo-50 dark:bg-indigo-950/80 border border-indigo-200/70 dark:border-indigo-800/70 text-[11px] font-mono font-semibold text-indigo-700 dark:text-indigo-300">
                <ShieldCheck className="h-3.5 w-3.5" />
                {lang === 'vi' ? 'NHẬT KÝ KIỂM TOÁN BẤT BIẾN' : 'IMMUTABLE COMPLIANCE LEDGER'}
              </span>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-50 dark:bg-emerald-950/70 border border-emerald-200/70 dark:border-emerald-800/70 text-[11px] font-mono text-emerald-700 dark:text-emerald-300">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                VERDICT OVERRIDE STREAM
              </span>
            </div>

            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700 flex items-center justify-center shrink-0">
                <FileText className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
              </div>
              <div>
                <h1 className="font-display text-2xl sm:text-3xl font-bold text-slate-900 dark:text-white tracking-tight">
                  {t('admin.auditLog')}
                </h1>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
                  {t('admin.auditLogSubtitle')}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Architectural Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 shadow-2xs">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
              Recorded Events
            </span>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
              01
            </span>
          </div>
          <p className="text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
            {entries.length}
          </p>
        </Card>

        <Card className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 shadow-2xs">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-medium text-indigo-600 dark:text-indigo-400">
              Unique Actors
            </span>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-indigo-50 dark:bg-indigo-950/80 text-indigo-600 dark:text-indigo-400">
              02
            </span>
          </div>
          <p className="text-2xl font-bold font-mono tabular-nums text-indigo-600 dark:text-indigo-400">
            {uniqueActors}
          </p>
        </Card>

        <Card className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 shadow-2xs">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
              Query Window
            </span>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/80 text-emerald-600 dark:text-emerald-400">
              03
            </span>
          </div>
          <p className="text-2xl font-bold font-mono tabular-nums text-emerald-600 dark:text-emerald-400">
            LIMIT 100
          </p>
        </Card>
      </div>

      {error && (
        <Alert variant="destructive" className="rounded-2xl">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* IDE Container for Filter + Audit Table */}
      <div className="rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 bg-slate-50/90 dark:bg-slate-900/90 border-b border-slate-200/80 dark:border-slate-800">
          <div className="flex items-center gap-2 min-w-0">
            <div className="flex items-center gap-1.5 shrink-0">
              <span className="w-2.5 h-2.5 rounded-full bg-red-400/80" />
              <span className="w-2.5 h-2.5 rounded-full bg-amber-400/80" />
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400/80" />
            </div>
            <Separator orientation="vertical" className="h-4 shrink-0" />
            <Terminal className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400 shrink-0" />
            <span className="text-xs font-mono font-semibold text-slate-700 dark:text-slate-200 truncate">
              immutable_audit_trail.log
            </span>
          </div>
          <span className="text-[11px] font-mono text-slate-400 shrink-0">
            {entries.length} entries
          </span>
        </div>

        <div className="p-4 border-b border-slate-200/80 dark:border-slate-800 bg-slate-50/30 dark:bg-slate-900/40">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
            <Input
              type="text"
              value={userFilter}
              onChange={(e) => setUserFilter(e.target.value)}
              placeholder={t('admin.filterByUsername')}
              aria-label="Filter audit log by username"
              className="pl-10 rounded-xl"
            />
            {userFilter && (
              <button
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
            <p className="text-slate-500 text-sm font-mono">{t('common.loading')}</p>
          </div>
        ) : (
          <Table className="block sm:table">
            <TableHeader className="hidden sm:table-header-group bg-slate-50/70 dark:bg-slate-800/40 text-[11px] font-mono uppercase text-slate-500">
              <TableRow className="hover:bg-transparent">
                <TableHead className="text-left px-4 py-3 font-semibold">
                  {t('admin.when')}
                </TableHead>
                <TableHead className="text-left px-4 py-3 font-semibold">
                  {t('admin.tableUser')}
                </TableHead>
                <TableHead className="text-left px-4 py-3 font-semibold">
                  {t('admin.verdict')}
                </TableHead>
                <TableHead className="text-left px-4 py-3 font-semibold">
                  {t('admin.fromTo')}
                </TableHead>
                <TableHead className="text-left px-4 py-3 font-semibold">
                  {t('admin.note')}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="block sm:table-row-group divide-y divide-slate-100 dark:divide-slate-800">
              {entries.length === 0 ? (
                <TableRow className="block sm:table-row">
                  <TableCell
                    colSpan={5}
                    className="block sm:table-cell px-4 py-10 text-center text-slate-500 font-mono text-xs"
                  >
                    {t('admin.noAuditLogs')}
                  </TableCell>
                </TableRow>
              ) : (
                entries.map((e) => (
                  <TableRow
                    key={e.id}
                    className="flex flex-col sm:table-row p-4 sm:p-0 gap-1.5 sm:gap-0 hover:bg-slate-50/80 dark:hover:bg-slate-800/30 transition-colors"
                  >
                    <TableCell className="block sm:table-cell p-0 sm:px-4 sm:py-3 text-slate-600 dark:text-slate-400 sm:whitespace-nowrap font-mono text-xs">
                      {e.logged_at ? new Date(e.logged_at).toLocaleString() : '—'}
                    </TableCell>
                    <TableCell className="block sm:table-cell p-0 sm:px-4 sm:py-3 font-medium text-slate-900 dark:text-slate-100 font-mono text-xs">
                      {e.user}
                    </TableCell>
                    <TableCell className="block sm:table-cell p-0 sm:px-4 sm:py-3 text-slate-500 font-mono text-xs">
                      {e.essay_id ? (
                        <Link
                          to={`/verification/report/${e.essay_id}?citation=${e.verdict_id}`}
                          data-testid={`audit-verdict-link-${e.id}`}
                          className="hover:underline"
                        >
                          <Badge variant="outline" className="font-mono text-xs text-indigo-600 dark:text-indigo-400">
                            #{e.verdict_id}
                          </Badge>
                        </Link>
                      ) : (
                        <Badge variant="outline" className="font-mono text-xs">
                          #{e.verdict_id}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="block sm:table-cell p-0 sm:px-4 sm:py-3">
                      <span className="font-mono text-xs break-all sm:break-normal">
                        <span className="text-rose-600 dark:text-rose-400">
                          {e.original_label}
                        </span>
                        {' → '}
                        <span className="text-emerald-600 dark:text-emerald-400">
                          {e.new_label}
                        </span>
                      </span>
                    </TableCell>
                    <TableCell className="block sm:table-cell p-0 sm:px-4 sm:py-3 text-slate-600 dark:text-slate-400 sm:max-w-xs truncate text-xs">
                      {e.note ?? '—'}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        )}

        <div
          className="px-4 py-3 border-t border-slate-200/80 dark:border-slate-800 flex items-center justify-between gap-3 text-xs font-mono text-slate-500"
          data-testid="audit-pagination"
        >
          <span>
            {lang === 'vi' ? `Trang ${page}` : `Page ${page}`}
          </span>
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
