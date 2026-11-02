import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ClipboardCheck,
  ExternalLink,
  AlertCircle,
  Terminal,
  ShieldCheck,
  Filter,
  Loader2,
} from 'lucide-react';
import { api, type PendingVerdict, type Class } from '@/api/client';
import { FileFormatIcon } from '@/components/FileFormatIcon';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Alert, AlertDescription } from '@/components/ui/alert';

/**
 * PendingReviewsPage — teacher queue of verdicts awaiting review (Scholarly Precision v2.0).
 *
 * Class filter chips at top; rows are click-throughs to the essay report.
 * Each verdict row has a colored label badge (rose for suspected, amber for
 * metadata_error).
 */
export function PendingReviewsPage() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language?.startsWith('vi') ? 'vi' : 'en';
  const navigate = useNavigate();
  const [classes, setClasses] = useState<Class[]>([]);
  const [selectedClassId, setSelectedClassId] = useState<number | null>(null);
  const [reviews, setReviews] = useState<PendingVerdict[]>([]);
  const [loadingClasses, setLoadingClasses] = useState(true);
  const [loadingReviews, setLoadingReviews] = useState(false);
  const [error, setError] = useState('');

  const loadClasses = useCallback(async () => {
    try {
      const data = await api.listMyClasses();
      setClasses(data);
      if (data.length > 0 && selectedClassId === null) {
        setSelectedClassId(data[0].id);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load classes');
    } finally {
      setLoadingClasses(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadReviews = useCallback(async (cid: number) => {
    setLoadingReviews(true);
    setError('');
    try {
      const data = await api.listPendingReviews(cid);
      setReviews(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load reviews');
    } finally {
      setLoadingReviews(false);
    }
  }, []);

  useEffect(() => {
    loadClasses();
  }, [loadClasses]);

  useEffect(() => {
    if (selectedClassId !== null) loadReviews(selectedClassId);
  }, [selectedClassId, loadReviews]);

  const hallucinationCount = reviews.filter(
    (r) => r.label === 'suspected_hallucination'
  ).length;
  const metadataErrorCount = reviews.filter(
    (r) => r.label === 'metadata_error'
  ).length;

  return (
    <div className="space-y-6 pb-10">
      {/* Executive Header Card */}
      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 p-5 sm:p-6 shadow-xs">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2.5 flex-wrap mb-2.5">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-50 dark:bg-amber-950/80 border border-amber-200/70 dark:border-amber-800/70 text-[11px] font-mono font-semibold text-amber-700 dark:text-amber-300">
                <ShieldCheck className="h-3.5 w-3.5" />
                {lang === 'vi' ? 'HÀNG ĐỢI RÀ SOÁT TRÍCH DẪN' : 'FACULTY ADJUDICATION QUEUE'}
              </span>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-[11px] font-mono text-slate-600 dark:text-slate-300">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                {reviews.length} FLAGGED VERDICTS
              </span>
            </div>

            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-50 dark:bg-amber-950/80 border border-amber-200/70 dark:border-amber-800/70 flex items-center justify-center shrink-0">
                <ClipboardCheck className="h-5 w-5 text-amber-600 dark:text-amber-400" />
              </div>
              <div>
                <h1 className="font-display text-2xl sm:text-3xl font-bold text-slate-900 dark:text-white tracking-tight">
                  {t('teacher.pendingReviews')}
                </h1>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
                  {t('teacher.pendingReviewsSubtitle')}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {error && (
        <Alert variant="destructive" className="rounded-2xl">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {loadingClasses ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 text-indigo-600 dark:text-indigo-400 animate-spin" />
          <span className="ml-3 text-slate-500 text-sm font-mono">{t('common.loading')}</span>
        </div>
      ) : classes.length === 0 ? (
        <Card className="rounded-2xl border-dashed border-slate-300 dark:border-slate-700 p-12 text-center">
          <p className="text-slate-700 dark:text-slate-300 font-medium">
            {t('teacher.noClassesAssigned')}
          </p>
          <p className="text-sm text-slate-500 mt-1">
            {t('teacher.noClassesAssignedHint')}
          </p>
        </Card>
      ) : (
        <>
          {/* Architectural Metric Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Card className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 shadow-2xs">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                  Queue Depth
                </span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                  01
                </span>
              </div>
              <p className="text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
                {reviews.length}
              </p>
            </Card>

            <Card className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 shadow-2xs">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-medium text-rose-600 dark:text-rose-400">
                  Suspected Hallucination
                </span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-rose-50 dark:bg-rose-950/80 text-rose-600 dark:text-rose-400">
                  02
                </span>
              </div>
              <p className="text-2xl font-bold font-mono tabular-nums text-rose-600 dark:text-rose-400">
                {hallucinationCount}
              </p>
            </Card>

            <Card className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 shadow-2xs">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-medium text-amber-600 dark:text-amber-400">
                  Metadata Error
                </span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-50 dark:bg-amber-950/80 text-amber-600 dark:text-amber-400">
                  03
                </span>
              </div>
              <p className="text-2xl font-bold font-mono tabular-nums text-amber-600 dark:text-amber-400">
                {metadataErrorCount}
              </p>
            </Card>
          </div>

          {/* IDE Container for Queue */}
          <div className="rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm overflow-hidden">
            {/* IDE Window Chrome + Class Filter Chips */}
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 bg-slate-50/90 dark:bg-slate-900/90 border-b border-slate-200/80 dark:border-slate-800">
              <div className="flex items-center gap-2.5">
                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-red-400/80" />
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-400/80" />
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-400/80" />
                </div>
                <Separator orientation="vertical" className="h-4" />
                <Terminal className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />
                <span className="text-xs font-mono font-semibold text-slate-700 dark:text-slate-200">
                  pending_reviews.queue
                </span>
              </div>

              <div
                role="group"
                aria-label={t('teacher.filterByClass')}
                className="flex flex-wrap items-center gap-1.5"
              >
                <Filter className="h-3.5 w-3.5 text-slate-400 mr-1" />
                {classes.map((c) => {
                  const isActive = selectedClassId === c.id;
                  return (
                    <button
                      key={c.id}
                      onClick={() => setSelectedClassId(c.id)}
                      aria-pressed={isActive}
                      className={`px-3 py-1.5 rounded-lg text-xs font-mono font-medium transition-all focus:outline-none focus:ring-2 focus:ring-indigo-500 ${
                        isActive
                          ? 'bg-indigo-600 text-white shadow-2xs'
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                      }`}
                    >
                      {c.name}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {loadingReviews ? (
                <p className="p-8 text-center text-sm text-slate-500 font-mono">
                  {t('common.loading')}
                </p>
              ) : reviews.length === 0 ? (
                <p className="p-8 text-center text-sm text-slate-500 font-mono">
                  {t('teacher.noPendingVerdicts')}
                </p>
              ) : (
                reviews.map((r, idx) => (
                  <button
                    key={r.verdict_id}
                    onClick={() => navigate(`/verification/report/${r.essay_id}?citation=${r.verdict_id}`)}
                    data-testid={`pending-review-row-${r.verdict_id}`}
                    className="w-full text-left px-4 sm:px-5 py-3.5 sm:py-4 hover:bg-slate-50/80 dark:hover:bg-slate-800/50 flex items-start gap-3 focus:outline-none focus:bg-slate-50 dark:focus:bg-slate-800/50 transition-colors group"
                  >
                    <span className="text-xs font-mono text-slate-400 dark:text-slate-500 pt-0.5 shrink-0">
                      #{String(idx + 1).padStart(2, '0')}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <Badge
                          variant={
                            r.label === 'suspected_hallucination'
                              ? 'hallucination'
                              : 'metadata_error'
                          }
                          className="px-2 py-0.5 rounded text-xs font-mono"
                        >
                          {r.label}
                        </Badge>
                        <span className="text-xs font-mono text-slate-500">
                          {r.student_username ?? '—'}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 min-w-0">
                        <FileFormatIcon filename={r.filename} size="xs" />
                        <p className="text-sm font-medium text-slate-900 dark:text-white truncate group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                          {r.filename}
                        </p>
                      </div>
                      {r.citation_raw && (
                        <p className="text-xs font-serif text-slate-700 dark:text-slate-300 mt-1 line-clamp-2 break-words [overflow-wrap:anywhere]">
                          &ldquo;{r.citation_raw}&rdquo;
                        </p>
                      )}
                      {r.reasoning && (
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 line-clamp-2 leading-relaxed">
                          {r.reasoning}
                        </p>
                      )}
                    </div>
                    <ExternalLink className="h-4 w-4 text-slate-400 group-hover:text-indigo-500 mt-1 shrink-0 transition-colors" />
                  </button>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
