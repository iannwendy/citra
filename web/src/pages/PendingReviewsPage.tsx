import { useEffect, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ClipboardCheck,
  ExternalLink,
  AlertCircle,
  Loader2,
  AlertTriangle,
  Check,
  Flag,
  ArrowRight,
  User as UserIcon,
  Layers,
  List,
  RotateCcw,
} from 'lucide-react';
import {
  api,
  type PendingVerdict,
  type Class,
  type ValidationLabel,
} from '@/api/client';
import {
  extractObservedWebMeta,
  getCitationMarkerLabel,
  isUrlResource,
} from '@/lib/verdictExplanation';
import {
  getTeacherReviewGuidance,
  type ReviewSeverityKey,
  type TeacherReviewGuidance,
} from '@/lib/teacherGuidance';
import { useToast } from '@/contexts/ToastContext';
import { FileFormatIcon } from '@/components/FileFormatIcon';
import { VerdictBadge } from '@/components/VerdictBadge';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  StudioWindowHeader,
  SlidingFilterPills,
} from '@/components/ui/studio-visuals';
import {
  AccordionExpand,
  DonutChart,
  NumberPopIn,
  SuccessCheck,
  SymmetricChevron,
} from '@/components/ui/transitions';
import {
  m,
  AnimatePresence,
  TRANSITION_EXIT,
} from '@/components/ui/motion-primitives';

type SeverityFilter = 'all' | ReviewSeverityKey;
type QueueViewMode = 'grouped' | 'flat';

interface EnrichedPendingItem {
  item: PendingVerdict;
  guidance: TeacherReviewGuidance;
}

interface SubmissionReviewGroup {
  essayId: number;
  filename: string;
  studentUsername: string | null;
  items: EnrichedPendingItem[];
}

const SEVERITY_ACCENT_BAR: Record<ReviewSeverityKey, string> = {
  critical: 'bg-rose-500',
  warning: 'bg-amber-500',
  incomplete: 'bg-orange-400',
  uncertain: 'bg-slate-400',
};

const SEVERITY_CALLOUT_BOX: Record<ReviewSeverityKey, string> = {
  critical:
    'bg-rose-50/75 dark:bg-rose-950/30 border-rose-200/80 dark:border-rose-800/70 text-rose-950 dark:text-rose-100',
  warning:
    'bg-amber-50/75 dark:bg-amber-950/30 border-amber-200/80 dark:border-amber-800/70 text-amber-950 dark:text-amber-100',
  incomplete:
    'bg-orange-50/75 dark:bg-orange-950/30 border-orange-200/80 dark:border-orange-800/70 text-orange-950 dark:text-orange-100',
  uncertain:
    'bg-slate-50/90 dark:bg-slate-800/50 border-slate-200/80 dark:border-slate-700/80 text-slate-900 dark:text-slate-100',
};

/**
 * PendingReviewsPage — Visual Action Studio for faculty citation adjudication.
 *
 * Groups flagged citations by student submission, translates symbolic/system signals
 * into a 1-line issue + 1-line action hint, and provides 1-click inline Approve / Flag actions.
 */
export function PendingReviewsPage() {
  const { t, i18n } = useTranslation();
  const lang: 'en' | 'vi' = i18n.language?.startsWith('vi') ? 'vi' : 'en';
  const navigate = useNavigate();
  const toast = useToast();

  const [classes, setClasses] = useState<Class[]>([]);
  const [selectedClassId, setSelectedClassId] = useState<number | null>(null);
  const [reviews, setReviews] = useState<PendingVerdict[]>([]);
  const [loadingClasses, setLoadingClasses] = useState(true);
  const [loadingReviews, setLoadingReviews] = useState(false);
  const [error, setError] = useState('');

  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>('all');
  const [viewMode, setViewMode] = useState<QueueViewMode>('grouped');
  const [collapsedEssays, setCollapsedEssays] = useState<Record<number, boolean>>({});
  const [inFlightIds, setInFlightIds] = useState<Record<number, boolean>>({});
  const [resolvedSessionCount, setResolvedSessionCount] = useState(0);

  const loadClasses = useCallback(async () => {
    try {
      const data = await api.listMyClasses();
      setClasses(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load classes');
    } finally {
      setLoadingClasses(false);
    }
  }, []);

  const loadReviews = useCallback(async (cid: number | null, classList: Class[]) => {
    if (classList.length === 0) {
      setReviews([]);
      return;
    }
    setLoadingReviews(true);
    setError('');
    try {
      if (cid === null) {
        const lists = await Promise.all(
          classList.map((c) => api.listPendingReviews(c.id)),
        );
        const seen = new Set<number>();
        const merged: PendingVerdict[] = [];
        for (const list of lists) {
          for (const item of list) {
            if (!seen.has(item.verdict_id)) {
              seen.add(item.verdict_id);
              merged.push(item);
            }
          }
        }
        setReviews(merged);
      } else {
        const data = await api.listPendingReviews(cid);
        setReviews(data);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load reviews');
    } finally {
      setLoadingReviews(false);
    }
  }, []);

  useEffect(() => {
    void loadClasses();
  }, [loadClasses]);

  useEffect(() => {
    if (!loadingClasses && classes.length > 0) {
      void loadReviews(selectedClassId, classes);
    }
  }, [loadingClasses, classes, selectedClassId, loadReviews]);

  const enrichedReviews = useMemo<EnrichedPendingItem[]>(
    () =>
      reviews.map((item) => ({
        item,
        guidance: getTeacherReviewGuidance(item, lang),
      })),
    [reviews, lang],
  );

  const counts = useMemo(() => {
    let critical = 0;
    let warning = 0;
    let incomplete = 0;
    let uncertain = 0;
    for (const { guidance } of enrichedReviews) {
      if (guidance.severity === 'critical') critical += 1;
      else if (guidance.severity === 'warning') warning += 1;
      else if (guidance.severity === 'incomplete') incomplete += 1;
      else uncertain += 1;
    }
    return {
      total: enrichedReviews.length,
      critical,
      warning,
      incomplete,
      uncertain,
    };
  }, [enrichedReviews]);

  const filteredReviews = useMemo(
    () =>
      severityFilter === 'all'
        ? enrichedReviews
        : enrichedReviews.filter((entry) => entry.guidance.severity === severityFilter),
    [enrichedReviews, severityFilter],
  );

  const submissionGroups = useMemo<SubmissionReviewGroup[]>(() => {
    const map = new Map<number, SubmissionReviewGroup>();
    for (const entry of filteredReviews) {
      const { item } = entry;
      const existing = map.get(item.essay_id);
      if (existing) {
        existing.items.push(entry);
      } else {
        map.set(item.essay_id, {
          essayId: item.essay_id,
          filename: item.filename,
          studentUsername: item.student_username,
          items: [entry],
        });
      }
    }
    return Array.from(map.values());
  }, [filteredReviews]);

  const totalPaperCount = useMemo(
    () => new Set(reviews.map((r) => r.essay_id)).size,
    [reviews],
  );

  const handleAdjudicate = useCallback(
    async (
      r: PendingVerdict,
      newLabel: ValidationLabel,
      actionType: 'approve' | 'flag',
    ) => {
      if (inFlightIds[r.verdict_id]) return;
      setInFlightIds((prev) => ({ ...prev, [r.verdict_id]: true }));
      try {
        await api.overrideVerdict(r.essay_id, {
          verdict_id: String(r.verdict_id),
          new_label: newLabel,
          reason:
            actionType === 'approve'
              ? lang === 'vi'
                ? 'Giảng viên chấp nhận trích dẫn hợp lệ từ hàng đợi duyệt nhanh'
                : 'Approved as valid from faculty review queue'
              : lang === 'vi'
                ? 'Giảng viên xác nhận cảnh báo trích dẫn từ hàng đợi duyệt nhanh'
                : 'Confirmed citation warning from faculty review queue',
        });
        setReviews((prev) =>
          prev.filter((item) => item.verdict_id !== r.verdict_id),
        );
        setResolvedSessionCount((c) => c + 1);
        toast.success(
          actionType === 'approve'
            ? lang === 'vi'
              ? 'Đã chấp nhận trích dẫn hợp lệ'
              : 'Citation approved as valid'
            : lang === 'vi'
              ? 'Đã ghi nhận cảnh báo trích dẫn'
              : 'Citation warning confirmed',
          r.filename,
        );
      } catch (e) {
        toast.error(
          lang === 'vi'
            ? 'Không thể lưu quyết định duyệt'
            : 'Failed to save review decision',
          e instanceof Error ? e.message : undefined,
        );
      } finally {
        setInFlightIds((prev) => {
          const next = { ...prev };
          delete next[r.verdict_id];
          return next;
        });
      }
    },
    [inFlightIds, lang, toast],
  );

  const toggleGroup = (essayId: number) => {
    setCollapsedEssays((prev) => ({
      ...prev,
      [essayId]: !prev[essayId],
    }));
  };

  const renderCitationCard = (
    { item: r, guidance }: EnrichedPendingItem,
    showPaperMeta: boolean,
  ) => {
    const marker = getCitationMarkerLabel(r);
    const hasExplicitMarker = marker !== '[?]';
    const isRetracted =
      Boolean(r.is_retracted) ||
      Boolean(r.triggered_rules?.includes('R-RETRACTED-PAPER'));

    const rawHtmlMeta = (r.html_meta ?? null) as Record<string, unknown> | null;
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
      typeof rawHtmlMeta?.site_name === 'string' && rawHtmlMeta.site_name.trim()
        ? rawHtmlMeta.site_name.trim()
        : null;
    const extractedWeb = extractObservedWebMeta(r);
    const observedWeb = extractedWeb?.title
      ? extractedWeb
      : fallbackHtmlTitle
        ? {
            title: fallbackHtmlTitle,
            venue: extractedWeb?.venue ?? fallbackHtmlVenue,
            authors: extractedWeb?.authors ?? [],
            year: extractedWeb?.year ?? null,
            isArchived:
              extractedWeb?.isArchived ?? r.url_status === 'archived_alive',
          }
        : extractedWeb;

    const isUrlMismatch = Boolean(
      r.triggered_rules?.includes('R-URL-CONTENT-MISMATCH'),
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

    const badgeVerdict: ValidationLabel =
      String(r.label).toLowerCase() === 'unverified'
        ? 'unresolved'
        : ((r.label as ValidationLabel) || 'unresolved');

    const showUrlStatusPill =
      Boolean(r.url_status) && r.url_status !== 'unchecked';
    const isBusy = Boolean(inFlightIds[r.verdict_id]);

    const openReport = () =>
      navigate(`/verification/report/${r.essay_id}?citation=${r.verdict_id}`);

    const cleanStudent =
      r.student_username && r.student_username.toLowerCase() !== 'user'
        ? r.student_username
        : null;

    return (
      <m.div
        key={r.verdict_id}
        layout
        exit={{ opacity: 0, y: -6, transition: TRANSITION_EXIT }}
        onClick={openReport}
        data-testid={`pending-review-row-${r.verdict_id}`}
        className="relative w-full text-left px-4 sm:px-5 py-4 hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors group cursor-pointer"
      >
        <span
          aria-hidden="true"
          className={`absolute left-0 top-3 bottom-3 w-1 rounded-r-full ${SEVERITY_ACCENT_BAR[guidance.severity]}`}
        />

        <div className="space-y-2.5 pl-1">
          {/* Top badges row */}
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2 flex-wrap min-w-0">
              {hasExplicitMarker && (
                <span
                  data-testid={`pending-marker-${r.verdict_id}`}
                  className="px-2 py-0.5 rounded-md bg-indigo-50 dark:bg-indigo-950/80 border border-indigo-200/80 dark:border-indigo-800/80 text-indigo-700 dark:text-indigo-300 text-xs font-mono font-bold"
                >
                  {marker}
                </span>
              )}

              <VerdictBadge
                verdict={badgeVerdict}
                triggeredRules={r.triggered_rules}
                size="sm"
              />

              {isRetracted && (
                <span
                  data-testid={`pending-retracted-${r.verdict_id}`}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-600 text-white text-[11px] font-semibold"
                >
                  <AlertTriangle className="h-3 w-3" />
                  {lang === 'vi' ? 'ĐÃ RÚT BÀI (RETRACTED)' : 'RETRACTED'}
                </span>
              )}

              {showUrlStatusPill && (
                <span
                  data-testid={`pending-url-status-${r.verdict_id}`}
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium border ${
                    r.url_status === 'alive' || r.url_status === 'restricted_alive'
                      ? 'bg-emerald-50 dark:bg-emerald-950/70 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300'
                      : r.url_status === 'archived_alive'
                        ? 'bg-amber-50 dark:bg-amber-950/70 border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300'
                        : 'bg-rose-50 dark:bg-rose-950/70 border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300'
                  }`}
                >
                  {r.url_status === 'alive'
                    ? lang === 'vi'
                      ? 'Liên kết hoạt động'
                      : 'Link Active'
                    : r.url_status === 'restricted_alive'
                      ? lang === 'vi'
                        ? 'Trang chặn bot'
                        : 'Protected Link'
                      : r.url_status === 'archived_alive'
                        ? r.archive_url ? (
                            <a
                              href={r.archive_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="underline hover:text-amber-950 dark:hover:text-amber-100"
                            >
                              {lang === 'vi'
                                ? '🏛️ Bản lưu Wayback'
                                : '🏛️ Wayback Archived'}
                            </a>
                          ) : lang === 'vi' ? (
                            '🏛️ Bản lưu Wayback'
                          ) : (
                            '🏛️ Wayback Archived'
                          )
                        : r.url_status === 'fake_domain'
                          ? lang === 'vi'
                            ? '✕ Tên miền không tồn tại'
                            : '✕ Fake Domain'
                          : lang === 'vi'
                            ? '✕ Liên kết hỏng'
                            : '✕ Dead Link'}
                </span>
              )}

              {showPaperMeta && (
                <span className="inline-flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 min-w-0">
                  <FileFormatIcon filename={r.filename} size="xs" />
                  <span className="font-medium text-slate-700 dark:text-slate-200 truncate max-w-[200px]">
                    {r.filename}
                  </span>
                  {cleanStudent && <span>· {cleanStudent}</span>}
                </span>
              )}
            </div>
          </div>

          {/* Plain-language Issue + Teacher Action Guidance */}
          <div
            className={`px-3.5 py-2.5 rounded-xl border ${SEVERITY_CALLOUT_BOX[guidance.severity]}`}
          >
            <p className="text-sm font-semibold leading-snug">
              {guidance.headline}
            </p>
            <p className="mt-1 text-xs opacity-85 flex items-start gap-1.5 leading-relaxed">
              <ArrowRight className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>{guidance.actionHint}</span>
            </p>
          </div>

          {showObservedWeb && observedWeb?.title && (
            <div
              data-testid={`pending-observed-meta-${r.verdict_id}`}
              className="px-3 py-2 rounded-xl bg-amber-50/80 dark:bg-amber-950/40 border border-amber-200/80 dark:border-amber-800/80 text-xs text-amber-900 dark:text-amber-200"
            >
              {lang === 'vi'
                ? `Tiêu đề trang URL thực tế: "${observedWeb.title}"`
                : `Observed web page title: "${observedWeb.title}"`}
              {observedWeb.venue ? ` (${observedWeb.venue})` : ''}
            </div>
          )}

          {/* Quoted citation */}
          {r.citation_raw && (
            <p className="text-xs sm:text-[13px] font-serif text-slate-600 dark:text-slate-300 line-clamp-2 break-words [overflow-wrap:anywhere] pl-2.5 border-l-2 border-slate-200 dark:border-slate-700">
              &ldquo;{r.citation_raw}&rdquo;
            </p>
          )}

          {/* 1-Click Teacher Actions */}
          <div
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
            className="pt-1 flex flex-wrap items-center justify-between gap-2"
          >
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={isBusy}
                data-testid={`pending-approve-btn-${r.verdict_id}`}
                onClick={() => void handleAdjudicate(r, 'verified', 'approve')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold shadow-2xs transition-colors disabled:opacity-50 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
              >
                {isBusy ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Check className="h-3.5 w-3.5" />
                )}
                <span>{lang === 'vi' ? 'Chấp nhận hợp lệ' : 'Approve Valid'}</span>
              </button>

              <button
                type="button"
                disabled={isBusy}
                data-testid={`pending-confirm-issue-btn-${r.verdict_id}`}
                onClick={() =>
                  void handleAdjudicate(r, guidance.confirmNewLabel, 'flag')
                }
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white dark:bg-slate-900 hover:bg-amber-50 dark:hover:bg-amber-950/40 border border-slate-200 dark:border-slate-700 hover:border-amber-300 dark:hover:border-amber-700 text-slate-700 dark:text-slate-200 hover:text-amber-800 dark:hover:text-amber-200 text-xs font-medium transition-colors disabled:opacity-50 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
              >
                <Flag className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
                <span>{guidance.confirmButtonLabel}</span>
              </button>
            </div>

            <button
              type="button"
              onClick={openReport}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/60 transition-colors cursor-pointer"
            >
              <span>{lang === 'vi' ? 'Xem trong bài' : 'Open Report'}</span>
              <ExternalLink className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </m.div>
    );
  };

  const filterCards: Array<{
    key: SeverityFilter;
    label: string;
    count: number;
    dotClass: string;
    activeClass: string;
    valueClass: string;
    testId?: string;
  }> = [
    {
      key: 'all',
      label: lang === 'vi' ? 'Tất cả cần xem' : 'All Flagged',
      count: counts.total,
      dotClass: 'bg-indigo-500',
      activeClass:
        'border-indigo-400 dark:border-indigo-600 ring-2 ring-indigo-500/15 bg-indigo-50/40 dark:bg-indigo-950/30',
      valueClass: 'text-slate-900 dark:text-slate-100',
      testId: 'pending-kpi-all',
    },
    {
      key: 'critical',
      label: lang === 'vi' ? 'Cần kiểm tra gấp' : 'Not Found / Critical',
      count: counts.critical,
      dotClass: 'bg-rose-500',
      activeClass:
        'border-rose-400 dark:border-rose-600 ring-2 ring-rose-500/15 bg-rose-50/40 dark:bg-rose-950/30',
      valueClass: 'text-rose-600 dark:text-rose-400',
      testId: 'pending-kpi-critical',
    },
    {
      key: 'warning',
      label: lang === 'vi' ? 'Sai lệch thông tin' : 'Details Differ',
      count: counts.warning,
      dotClass: 'bg-amber-500',
      activeClass:
        'border-amber-400 dark:border-amber-600 ring-2 ring-amber-500/15 bg-amber-50/40 dark:bg-amber-950/30',
      valueClass: 'text-amber-600 dark:text-amber-400',
      testId: 'pending-kpi-warning',
    },
    {
      key: 'incomplete',
      label: lang === 'vi' ? 'Thiếu quy cách' : 'Incomplete Ref',
      count: counts.incomplete,
      dotClass: 'bg-orange-400',
      activeClass:
        'border-orange-400 dark:border-orange-600 ring-2 ring-orange-500/15 bg-orange-50/40 dark:bg-orange-950/30',
      valueClass: 'text-orange-600 dark:text-orange-400',
      testId: 'pending-kpi-incomplete',
    },
    {
      key: 'uncertain',
      label: lang === 'vi' ? 'Chưa đủ dữ liệu' : 'Unresolved',
      count: counts.uncertain,
      dotClass: 'bg-slate-400',
      activeClass:
        'border-slate-400 dark:border-slate-500 ring-2 ring-slate-500/15 bg-slate-100/70 dark:bg-slate-800/70',
      valueClass: 'text-slate-700 dark:text-slate-200',
      testId: 'pending-kpi-unresolved',
    },
  ];

  return (
    <div className="space-y-5 pb-10">
      {/* Clean Action-First Header */}
      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 p-5 sm:p-6 shadow-xs flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3.5 min-w-0">
          <div className="w-11 h-11 rounded-2xl bg-amber-50 dark:bg-amber-950/80 border border-amber-200/70 dark:border-amber-800/70 flex items-center justify-center shrink-0">
            <ClipboardCheck className="h-5 w-5 text-amber-600 dark:text-amber-400" />
          </div>
          <div className="min-w-0">
            <h1 className="font-display text-2xl sm:text-3xl font-bold text-slate-900 dark:text-white tracking-tight">
              {t('teacher.pendingReviews')}
            </h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
              {lang === 'vi'
                ? 'Xem nhanh gợi ý xử lý và duyệt trực tiếp từng trích dẫn ngay tại đây.'
                : 'See clear action guidance and approve or flag citations in one click.'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap shrink-0">
          {resolvedSessionCount > 0 && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/70 border border-emerald-200/80 dark:border-emerald-800/70 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
              <SuccessCheck size={14} />
              <span>
                {lang === 'vi'
                  ? `Đã xử lý ${resolvedSessionCount} mục`
                  : `${resolvedSessionCount} reviewed`}
              </span>
            </span>
          )}
          <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-200">
            <span
              className={`w-2 h-2 rounded-full ${
                counts.total > 0 ? 'bg-amber-500 animate-pulse' : 'bg-emerald-500'
              }`}
            />
            <span>
              {counts.total > 0
                ? lang === 'vi'
                  ? `${counts.total} mục trên ${totalPaperCount} bài nộp`
                  : `${counts.total} items across ${totalPaperCount} papers`
                : lang === 'vi'
                  ? 'Đã duyệt sạch'
                  : 'Queue clear'}
            </span>
          </span>
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
          <span className="ml-3 text-slate-500 text-sm">{t('common.loading')}</span>
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
          {/* Visual Triage Overview: Donut Chart + Interactive Filter Cards */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            <Card className="lg:col-span-4 p-4 sm:p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 shadow-2xs flex items-center gap-4">
              <DonutChart
                size={84}
                thickness={11}
                segments={
                  counts.total > 0
                    ? [
                        { value: counts.critical, color: '#f43f5e' },
                        { value: counts.warning, color: '#f59e0b' },
                        { value: counts.incomplete, color: '#fb923c' },
                        { value: counts.uncertain, color: '#94a3b8' },
                      ]
                    : [{ value: 1, color: '#10b981' }]
                }
                centerContent={
                  counts.total > 0 ? (
                    <span className="text-xl font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
                      <NumberPopIn value={counts.total} />
                    </span>
                  ) : (
                    <SuccessCheck size={20} className="text-emerald-500" />
                  )
                }
              />
              <div className="min-w-0 flex-1 space-y-1">
                <p className="text-sm font-display font-semibold text-slate-900 dark:text-slate-100">
                  {counts.total > 0
                    ? lang === 'vi'
                      ? 'Phân loại mức độ ưu tiên'
                      : 'Priority Triage Breakdown'
                    : lang === 'vi'
                      ? 'Hoàn tất rà soát!'
                      : 'All Caught Up!'}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                  {counts.total > 0
                    ? lang === 'vi'
                      ? 'Bấm vào một nhóm bên cạnh để lọc và xử lý từ mức khẩn cấp nhất.'
                      : 'Select any category on the right to focus on similar issues first.'
                    : lang === 'vi'
                      ? 'Mọi trích dẫn cần chú ý trong lớp đã được xử lý.'
                      : 'Every flagged citation across your classes has been reviewed.'}
                </p>
              </div>
            </Card>

            <div className="lg:col-span-8 grid grid-cols-2 sm:grid-cols-5 gap-3">
              {filterCards.map((fc) => {
                const active = severityFilter === fc.key;
                return (
                  <button
                    key={fc.key}
                    type="button"
                    data-testid={fc.testId}
                    aria-pressed={active}
                    onClick={() =>
                      setSeverityFilter((prev) =>
                        prev === fc.key && fc.key !== 'all' ? 'all' : fc.key,
                      )
                    }
                    className={`text-left p-3.5 rounded-2xl bg-white dark:bg-slate-900 border transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                      active
                        ? fc.activeClass
                        : 'border-slate-200/90 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 shadow-2xs'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 mb-2">
                      <span className={`w-2 h-2 rounded-full shrink-0 ${fc.dotClass}`} />
                      <span className="text-xs font-medium text-slate-600 dark:text-slate-400 truncate">
                        {fc.label}
                      </span>
                    </div>
                    <p
                      className={`text-2xl font-bold font-mono tabular-nums ${fc.valueClass}`}
                    >
                      <NumberPopIn value={fc.count} />
                    </p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Review Queue Studio Container */}
          <div className="rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm overflow-hidden">
            <StudioWindowHeader
              title={lang === 'vi' ? 'DANH SÁCH CẦN DUYỆT' : 'REVIEW QUEUE'}
              badge={
                <Badge
                  variant="secondary"
                  className="font-mono text-[11px] bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300 border border-indigo-200/60 dark:border-indigo-800/60"
                >
                  {filteredReviews.length} / {reviews.length}
                </Badge>
              }
              rightSlot={
                <div className="flex flex-wrap items-center gap-2">
                  <div
                    role="group"
                    aria-label={t('teacher.filterByClass')}
                    className="flex flex-wrap items-center gap-1.5"
                  >
                    <button
                      type="button"
                      data-testid="pending-filter-all-classes"
                      onClick={() => setSelectedClassId(null)}
                      aria-pressed={selectedClassId === null}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-indigo-500 ${
                        selectedClassId === null
                          ? 'bg-indigo-600 text-white shadow-2xs'
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                      }`}
                    >
                      {lang === 'vi' ? 'Tất cả lớp' : 'All Classes'}
                    </button>
                    {classes.map((c) => {
                      const isActive = selectedClassId === c.id;
                      return (
                        <button
                          type="button"
                          key={c.id}
                          onClick={() => setSelectedClassId(c.id)}
                          aria-pressed={isActive}
                          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-indigo-500 ${
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

                  <SlidingFilterPills
                    value={viewMode}
                    onChange={setViewMode}
                    ariaLabel={lang === 'vi' ? 'Chế độ hiển thị' : 'Queue layout'}
                    options={[
                      {
                        key: 'grouped',
                        label: (
                          <>
                            <Layers className="h-3.5 w-3.5" />
                            <span>{lang === 'vi' ? 'Theo bài nộp' : 'By Paper'}</span>
                          </>
                        ),
                      },
                      {
                        key: 'flat',
                        label: (
                          <>
                            <List className="h-3.5 w-3.5" />
                            <span>{lang === 'vi' ? 'Từng mục' : 'List'}</span>
                          </>
                        ),
                      },
                    ]}
                  />
                </div>
              }
            />

            {loadingReviews ? (
              <div className="p-12 flex items-center justify-center gap-2.5 text-sm text-slate-500">
                <Loader2 className="h-5 w-5 animate-spin text-indigo-600" />
                <span>{t('common.loading')}</span>
              </div>
            ) : reviews.length === 0 ? (
              <div className="p-12 text-center space-y-2">
                <div className="w-12 h-12 rounded-2xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200/70 dark:border-emerald-800/70 flex items-center justify-center mx-auto text-emerald-600 dark:text-emerald-400">
                  <SuccessCheck size={22} />
                </div>
                <p className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  {lang === 'vi'
                    ? 'Không có trích dẫn nào chờ duyệt'
                    : 'No citations awaiting review'}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {lang === 'vi'
                    ? 'Không có trích dẫn nào cần kiểm tra thủ công ở thời điểm này.'
                    : 'No citations need manual review right now.'}
                </p>
              </div>
            ) : filteredReviews.length === 0 ? (
              <div className="p-10 text-center space-y-3">
                <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                  {lang === 'vi'
                    ? 'Không còn mục nào thuộc nhóm lọc này.'
                    : 'No items left in this category filter.'}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  data-testid="pending-reset-severity-btn"
                  onClick={() => setSeverityFilter('all')}
                  className="gap-1.5 rounded-xl"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  {lang === 'vi'
                    ? `Xem tất cả ${reviews.length} mục còn lại`
                    : `Show all ${reviews.length} remaining items`}
                </Button>
              </div>
            ) : viewMode === 'grouped' ? (
              <div className="p-3.5 sm:p-4 space-y-3.5 bg-slate-50/40 dark:bg-slate-950/30">
                <AnimatePresence initial={false}>
                  {submissionGroups.map((group) => {
                    const isOpen = !collapsedEssays[group.essayId];
                    const cleanStudent =
                      group.studentUsername &&
                      group.studentUsername.toLowerCase() !== 'user'
                        ? group.studentUsername
                        : null;

                    return (
                      <m.div
                        key={group.essayId}
                        layout
                        exit={{ opacity: 0, y: -8, transition: TRANSITION_EXIT }}
                        className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 shadow-2xs overflow-hidden"
                      >
                        <div className="px-4 py-3 bg-slate-50/80 dark:bg-slate-800/50 border-b border-slate-200/70 dark:border-slate-800 flex items-center justify-between gap-3">
                          <button
                            type="button"
                            onClick={() => toggleGroup(group.essayId)}
                            aria-expanded={isOpen}
                            className="flex items-center gap-2.5 min-w-0 flex-1 text-left cursor-pointer focus:outline-none"
                          >
                            <FileFormatIcon filename={group.filename} size="xs" />
                            <span className="font-display font-semibold text-sm sm:text-base text-slate-900 dark:text-white truncate">
                              {group.filename}
                            </span>
                            {cleanStudent && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-700 text-xs text-slate-600 dark:text-slate-300 shrink-0">
                                <UserIcon className="h-3 w-3 text-slate-400" />
                                {cleanStudent}
                              </span>
                            )}
                            <span className="px-2 py-0.5 rounded-full bg-amber-100/80 dark:bg-amber-950/80 text-amber-800 dark:text-amber-300 text-xs font-semibold shrink-0">
                              {lang === 'vi'
                                ? `${group.items.length} mục`
                                : `${group.items.length} ${group.items.length === 1 ? 'item' : 'items'}`}
                            </span>
                          </button>

                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              type="button"
                              onClick={() =>
                                navigate(`/verification/report/${group.essayId}`)
                              }
                              className="hidden sm:inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-white dark:hover:bg-slate-800 transition-colors cursor-pointer"
                            >
                              <span>
                                {lang === 'vi' ? 'Mở toàn bộ bài' : 'Full Report'}
                              </span>
                              <ExternalLink className="h-3 w-3" />
                            </button>
                            <button
                              type="button"
                              onClick={() => toggleGroup(group.essayId)}
                              aria-label={isOpen ? 'Collapse paper' : 'Expand paper'}
                              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-white dark:hover:bg-slate-800 transition-colors cursor-pointer"
                            >
                              <SymmetricChevron open={isOpen} size={15} />
                            </button>
                          </div>
                        </div>

                        <AccordionExpand open={isOpen}>
                          <div className="divide-y divide-slate-100 dark:divide-slate-800">
                            <AnimatePresence initial={false}>
                              {group.items.map((entry) =>
                                renderCitationCard(entry, false),
                              )}
                            </AnimatePresence>
                          </div>
                        </AccordionExpand>
                      </m.div>
                    );
                  })}
                </AnimatePresence>
              </div>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                <AnimatePresence initial={false}>
                  {filteredReviews.map((entry) => renderCitationCard(entry, true))}
                </AnimatePresence>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
