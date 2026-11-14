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
  AlertTriangle,
} from 'lucide-react';
import {
  api,
  type PendingVerdict,
  type Class,
  type ValidationLabel,
  type Verdict,
} from '@/api/client';
import {
  extractObservedWebMeta,
  getCitationMarkerLabel,
  getFieldDisplayName,
  getRuleDisplayName,
  getSourceDisplayName,
  getVerdictExplanation,
  isUrlResource,
} from '@/lib/verdictExplanation';
import { FileFormatIcon } from '@/components/FileFormatIcon';
import { VerdictBadge } from '@/components/VerdictBadge';
import { Card } from '@/components/ui/card';
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
  const incompleteRefCount = reviews.filter(
    (r) =>
      r.label === 'metadata_error' &&
      Boolean(r.triggered_rules?.includes('R-INCOMPLETE-METADATA'))
  ).length;
  const metadataErrorCount = reviews.filter(
    (r) =>
      r.label === 'metadata_error' &&
      !r.triggered_rules?.includes('R-INCOMPLETE-METADATA')
  ).length;
  const unresolvedCount = reviews.filter((r) => r.label === 'unresolved').length;

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
                {lang === 'vi' ? `${reviews.length} TRÍCH DẪN CẦN RÀ SOÁT` : `${reviews.length} FLAGGED VERDICTS`}
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
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3.5">
            <Card className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 shadow-2xs">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                  {lang === 'vi' ? 'Hàng đợi rà soát' : 'Queue Depth'}
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
                  {lang === 'vi' ? 'Nghi vấn ngụy tạo' : 'Suspected Hallucination'}
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
                  {lang === 'vi' ? 'Sai lệch Metadata' : 'Metadata Error'}
                </span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-50 dark:bg-amber-950/80 text-amber-600 dark:text-amber-400">
                  03
                </span>
              </div>
              <p className="text-2xl font-bold font-mono tabular-nums text-amber-600 dark:text-amber-400">
                {metadataErrorCount}
              </p>
            </Card>

            <Card
              data-testid="pending-kpi-incomplete"
              className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 shadow-2xs"
            >
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-medium text-orange-600 dark:text-orange-400">
                  {lang === 'vi' ? 'Thiếu quy cách' : 'Incomplete Ref'}
                </span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-orange-50 dark:bg-orange-950/80 text-orange-600 dark:text-orange-400">
                  04
                </span>
              </div>
              <p className="text-2xl font-bold font-mono tabular-nums text-orange-600 dark:text-orange-400">
                {incompleteRefCount}
              </p>
            </Card>

            <Card
              data-testid="pending-kpi-unresolved"
              className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 shadow-2xs"
            >
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
                  {lang === 'vi' ? 'Chờ rà soát' : 'Unresolved'}
                </span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                  05
                </span>
              </div>
              <p className="text-2xl font-bold font-mono tabular-nums text-slate-700 dark:text-slate-200">
                {unresolvedCount}
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
                reviews.map((r, idx) => {
                  const marker = getCitationMarkerLabel(r);
                  const hasExplicitMarker = marker !== '[?]';
                  const isRetracted =
                    Boolean(r.is_retracted) ||
                    Boolean(r.triggered_rules?.includes('R-RETRACTED-PAPER'));
                  const rawHtmlMeta = (r.html_meta ?? null) as Record<
                    string,
                    unknown
                  > | null;
                  const fallbackHtmlTitle =
                    [
                      rawHtmlMeta?.page_title,
                      rawHtmlMeta?.citation_title,
                      rawHtmlMeta?.og_title,
                      rawHtmlMeta?.dc_title,
                      rawHtmlMeta?.title,
                      rawHtmlMeta?.observed_title,
                    ]
                      .find((val): val is string => typeof val === 'string' && val.trim().length > 0)
                      ?.trim() ?? null;
                  const fallbackHtmlVenue =
                    typeof rawHtmlMeta?.site_name === 'string' &&
                    rawHtmlMeta.site_name.trim()
                      ? rawHtmlMeta.site_name.trim()
                      : null;
                  const extractedWeb = extractObservedWebMeta(r);
                  const observedWeb =
                    extractedWeb?.title
                      ? extractedWeb
                      : fallbackHtmlTitle
                        ? {
                            title: fallbackHtmlTitle,
                            venue: extractedWeb?.venue ?? fallbackHtmlVenue,
                            authors: extractedWeb?.authors ?? [],
                            year: extractedWeb?.year ?? null,
                            isArchived:
                              extractedWeb?.isArchived ??
                              r.url_status === 'archived_alive',
                          }
                        : extractedWeb;
                  const isUrlMismatch = Boolean(
                    r.triggered_rules?.includes('R-URL-CONTENT-MISMATCH')
                  );
                  const showObservedWeb =
                    Boolean(observedWeb?.title) &&
                    (isUrlMismatch ||
                      isUrlResource({
                        citation_raw: r.citation_raw ?? '',
                        label: String(r.label),
                        triggered_rules: r.triggered_rules,
                      }) ||
                      Boolean(r.html_meta));

                  const nonWebSources = (r.matched_sources ?? []).filter((s) => {
                    const low = (s.source || '').toLowerCase();
                    return low !== 'web_html_meta' && low !== 'wayback_html_meta';
                  });
                  const sourceDisplayNames = [
                    ...new Set(
                      nonWebSources.map((s) =>
                        getSourceDisplayName(s.source, lang, {
                          triggered_rules: r.triggered_rules,
                          external_ids: s.external_ids,
                          venue: s.venue,
                          title: s.title,
                        })
                      )
                    ),
                  ];

                  const hasRichContext =
                    Boolean(r.triggered_rules && r.triggered_rules.length > 0) ||
                    Boolean(r.matched_sources && r.matched_sources.length > 0) ||
                    Boolean(r.mismatched_fields && r.mismatched_fields.length > 0) ||
                    Boolean(r.url_status) ||
                    Boolean(r.html_meta) ||
                    isRetracted;

                  const verdictAdapter: Verdict = {
                    citation_id: String(r.verdict_id),
                    citation_raw: r.citation_raw ?? '',
                    mapping_status: 'matched',
                    mapping_confidence: 1,
                    label: (r.label as ValidationLabel) || 'unresolved',
                    confidence: r.confidence,
                    reasoning: r.reasoning ?? '',
                    triggered_rules: r.triggered_rules ?? [],
                    mismatched_fields: r.mismatched_fields ?? [],
                    matched_sources: r.matched_sources ?? [],
                    url_status: r.url_status ?? null,
                    url_status_code: r.url_status_code ?? null,
                    archive_url: r.archive_url ?? null,
                    cited_url: r.cited_url ?? null,
                    html_meta: r.html_meta ?? null,
                    is_retracted: r.is_retracted ?? false,
                    numeric_index: r.numeric_index ?? null,
                    sub_index: r.sub_index ?? null,
                    composite_label: r.composite_label ?? null,
                    features: r.features,
                    is_overridden: false,
                  };
                  const explanationText = hasRichContext
                    ? getVerdictExplanation(verdictAdapter, lang)
                    : r.reasoning;

                  const openReport = () =>
                    navigate(`/verification/report/${r.essay_id}?citation=${r.verdict_id}`);

                  return (
                    <div
                      key={r.verdict_id}
                      role="button"
                      tabIndex={0}
                      onClick={openReport}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          openReport();
                        }
                      }}
                      data-testid={`pending-review-row-${r.verdict_id}`}
                      className="w-full text-left px-4 sm:px-5 py-3.5 sm:py-4 hover:bg-slate-50/80 dark:hover:bg-slate-800/50 flex items-start gap-3 focus:outline-none focus:bg-slate-50 dark:focus:bg-slate-800/50 transition-colors group cursor-pointer"
                    >
                      <span className="text-xs font-mono text-slate-400 dark:text-slate-500 pt-0.5 shrink-0">
                        #{String(idx + 1).padStart(2, '0')}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                          {hasExplicitMarker && (
                            <span
                              data-testid={`pending-marker-${r.verdict_id}`}
                              className="px-2 py-0.5 rounded-md bg-indigo-50 dark:bg-indigo-950/80 border border-indigo-200/80 dark:border-indigo-800/80 text-indigo-700 dark:text-indigo-300 text-[11px] font-mono font-bold"
                            >
                              {marker}
                            </span>
                          )}
                          <VerdictBadge
                            verdict={r.label as ValidationLabel}
                            triggeredRules={r.triggered_rules}
                            size="sm"
                          />
                          {isRetracted && (
                            <span
                              data-testid={`pending-retracted-${r.verdict_id}`}
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-600 text-white text-[10px] font-mono font-bold"
                            >
                              <AlertTriangle className="h-3 w-3" />
                              {lang === 'vi' ? 'ĐÃ RÚT BÀI (RETRACTED)' : 'RETRACTED'}
                            </span>
                          )}
                          {r.url_status && (
                            <span
                              data-testid={`pending-url-status-${r.verdict_id}`}
                              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-mono font-semibold border ${
                                r.url_status === 'alive' || r.url_status === 'restricted_alive'
                                  ? 'bg-emerald-50 dark:bg-emerald-950/70 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300'
                                  : r.url_status === 'archived_alive'
                                    ? 'bg-amber-50 dark:bg-amber-950/70 border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300'
                                    : r.url_status === 'unchecked'
                                      ? 'bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                                      : 'bg-rose-50 dark:bg-rose-950/70 border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300'
                              }`}
                            >
                              {r.url_status === 'alive'
                                ? `✓ HTTP ${r.url_status_code || 200} OK`
                                : r.url_status === 'restricted_alive'
                                  ? `🔒 HTTP ${r.url_status_code || 403} OK`
                                  : r.url_status === 'archived_alive'
                                    ? r.archive_url ? (
                                        <a
                                          href={r.archive_url}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          onClick={(e) => e.stopPropagation()}
                                          className="underline hover:text-amber-950 dark:hover:text-amber-100"
                                        >
                                          {lang === 'vi' ? '🏛️ Bản lưu Wayback' : '🏛️ Wayback Archived'}
                                        </a>
                                      ) : lang === 'vi' ? (
                                        '🏛️ Bản lưu Wayback'
                                      ) : (
                                        '🏛️ Wayback Archived'
                                      )
                                    : r.url_status === 'dead_link'
                                      ? `✕ HTTP ${r.url_status_code || 404} ${lang === 'vi' ? 'Liên kết hỏng' : 'Dead Link'}`
                                      : r.url_status === 'fake_domain'
                                        ? `✕ ${lang === 'vi' ? 'Tên miền giả' : 'Fake Domain'}`
                                        : lang === 'vi'
                                          ? 'Chưa mở URL (Đã khớp học thuật)'
                                          : 'URL Unchecked'}
                            </span>
                          )}
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

                        {showObservedWeb && observedWeb?.title && (
                          <div
                            data-testid={`pending-observed-meta-${r.verdict_id}`}
                            className="mt-1.5 px-2.5 py-1.5 rounded-lg bg-amber-50/80 dark:bg-amber-950/40 border border-amber-200/80 dark:border-amber-800/80 text-[11px] font-mono text-amber-900 dark:text-amber-200"
                          >
                            {lang === 'vi'
                              ? `Tiêu đề trang URL thực tế: "${observedWeb.title}"`
                              : `Observed web page title: "${observedWeb.title}"`}
                            {observedWeb.venue ? ` (${observedWeb.venue})` : ''}
                          </div>
                        )}

                        {explanationText && (
                          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5 line-clamp-3 leading-relaxed">
                            {explanationText}
                          </p>
                        )}

                        {((r.mismatched_fields && r.mismatched_fields.length > 0) ||
                          (r.triggered_rules && r.triggered_rules.length > 0) ||
                          sourceDisplayNames.length > 0) && (
                          <div className="flex flex-wrap items-center gap-1.5 mt-2">
                            {(r.mismatched_fields ?? []).map((field) => (
                              <span
                                key={field}
                                className="px-2 py-0.5 rounded bg-amber-50 dark:bg-amber-950/60 border border-amber-200/80 dark:border-amber-800/70 text-[10px] font-mono text-amber-800 dark:text-amber-300"
                              >
                                {lang === 'vi' ? 'Lệch: ' : 'Mismatch: '}
                                {getFieldDisplayName(field, lang)}
                              </span>
                            ))}
                            {(r.triggered_rules ?? []).map((ruleId) => (
                              <span
                                key={ruleId}
                                title={getRuleDisplayName(ruleId, lang)}
                                className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-[10px] font-mono font-semibold text-indigo-700 dark:text-indigo-300"
                              >
                                {ruleId}
                              </span>
                            ))}
                            {sourceDisplayNames.map((srcName) => (
                              <span
                                key={srcName}
                                className="px-2 py-0.5 rounded bg-emerald-50/80 dark:bg-emerald-950/50 border border-emerald-200/80 dark:border-emerald-800/70 text-[10px] font-mono text-emerald-700 dark:text-emerald-300"
                              >
                                {srcName}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                      <ExternalLink className="h-4 w-4 text-slate-400 group-hover:text-indigo-500 mt-1 shrink-0 transition-colors" />
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
