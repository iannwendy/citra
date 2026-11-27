import { useEffect, useState, useCallback, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
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
  GraduationCap,
  Layers,
  List,
  RotateCcw,
  Search,
  X,
  ArrowUpDown,
} from 'lucide-react';
import {
  api,
  type PendingVerdict,
  type Class,
  type ValidationLabel,
} from '@/api/client';
import {
  formatUserError,
  getVerdictDisplay,
  resolveAcademicLang,
} from '@/lib/academicTaxonomy';
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
import { toSafeExternalHref } from '@/lib/utils';
import { DecisionSupportBanner } from '@/components/DecisionSupportBanner';
import { FileFormatIcon } from '@/components/FileFormatIcon';
import { VerdictBadge } from '@/components/VerdictBadge';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
type ReviewSortMode = 'urgent' | 'newest' | 'paper';

interface EnrichedPendingItem {
  item: PendingVerdict;
  guidance: TeacherReviewGuidance;
  studentLabel: string | null;
  className: string | null;
}

interface SubmissionReviewGroup {
  essayId: number;
  filename: string;
  studentLabel: string | null;
  className: string | null;
  items: EnrichedPendingItem[];
}

interface PendingConfirmDraft {
  verdictId: number;
  actionType: 'approve' | 'flag';
  targetLabel: ValidationLabel;
  note: string;
}

const SEVERITY_PRIORITY: Record<ReviewSeverityKey, number> = {
  critical: 0,
  warning: 1,
  incomplete: 2,
  uncertain: 3,
};

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

const APPROVE_TARGET_OPTIONS: ValidationLabel[] = ['verified', 'resource'];
const FLAG_TARGET_OPTIONS: ValidationLabel[] = [
  'metadata_error',
  'suspected_hallucination',
  'unresolved',
];

function resolveStudentLabel(item: PendingVerdict): string | null {
  const full = item.student_name?.trim();
  if (full && full.toLowerCase() !== 'user') return full;
  const uname = item.student_username?.trim();
  if (uname && uname.toLowerCase() !== 'user') return uname;
  return null;
}

function normalizeOriginalLabel(raw: string | undefined): ValidationLabel {
  const cleaned = String(raw ?? 'unresolved').trim().toLowerCase();
  switch (cleaned) {
    case 'verified':
    case 'metadata_error':
    case 'suspected_hallucination':
    case 'unresolved':
    case 'resource':
      return cleaned;
    case 'unverified':
    default:
      return 'unresolved';
  }
}

function parseTimestamp(value?: string | null): number {
  if (!value) return 0;
  const ts = Date.parse(value);
  return Number.isFinite(ts) ? ts : 0;
}

/**
 * PendingReviewsPage — Visual Action Studio for faculty citation adjudication.
 *
 * Groups flagged citations by student submission, translates symbolic/system signals
 * into a 1-line issue + 1-line action hint, and provides guarded inline confirmation
 * with explicit target verdict selection and Undo support.
 */
export function PendingReviewsPage() {
  const { t, i18n } = useTranslation();
  const lang = resolveAcademicLang(i18n.resolvedLanguage || i18n.language);
  const navigate = useNavigate();
  const toast = useToast();

  const [classes, setClasses] = useState<Class[]>([]);
  const [selectedClassId, setSelectedClassId] = useState<number | null>(null);
  const [reviews, setReviews] = useState<PendingVerdict[]>([]);
  const [loadingClasses, setLoadingClasses] = useState(true);
  const [loadingReviews, setLoadingReviews] = useState(false);
  const [error, setError] = useState('');

  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortMode, setSortMode] = useState<ReviewSortMode>('urgent');
  const [viewMode, setViewMode] = useState<QueueViewMode>('grouped');
  const [collapsedEssays, setCollapsedEssays] = useState<Record<number, boolean>>({});
  const [inFlightIds, setInFlightIds] = useState<Record<number, boolean>>({});
  const [resolvedSessionCount, setResolvedSessionCount] = useState(0);
  const [confirmDraft, setConfirmDraft] = useState<PendingConfirmDraft | null>(null);

  const classNameById = useMemo(() => {
    const map = new Map<number, string>();
    for (const c of classes) {
      map.set(c.id, c.name);
    }
    return map;
  }, [classes]);

  const loadClasses = useCallback(async () => {
    try {
      const data = await api.listMyClasses();
      setClasses(data);
    } catch (e) {
      setError(
        formatUserError(
          e,
          lang,
          lang === 'vi' ? 'Không thể tải danh sách lớp học.' : 'Failed to load classes',
        ),
      );
    } finally {
      setLoadingClasses(false);
    }
  }, [lang]);

  const loadReviews = useCallback(
    async (cid: number | null, classList: Class[]) => {
      if (classList.length === 0) {
        setReviews([]);
        return;
      }
      setLoadingReviews(true);
      setError('');
      try {
        if (cid === null) {
          const results = await Promise.all(
            classList.map(async (c) => {
              const list = await api.listPendingReviews(c.id);
              return list.map((item) => ({
                ...item,
                class_id: item.class_id ?? c.id,
                class_name: item.class_name ?? c.name,
              }));
            }),
          );
          const seen = new Set<number>();
          const merged: PendingVerdict[] = [];
          for (const list of results) {
            for (const item of list) {
              if (!seen.has(item.verdict_id)) {
                seen.add(item.verdict_id);
                merged.push(item);
              }
            }
          }
          setReviews(merged);
        } else {
          const selectedClass = classList.find((c) => c.id === cid);
          const data = await api.listPendingReviews(cid);
          setReviews(
            data.map((item) => ({
              ...item,
              class_id: item.class_id ?? cid,
              class_name: item.class_name ?? selectedClass?.name ?? null,
            })),
          );
        }
      } catch (e) {
        setError(
          formatUserError(
            e,
            lang,
            lang === 'vi' ? 'Không thể tải hàng đợi duyệt.' : 'Failed to load reviews',
          ),
        );
      } finally {
        setLoadingReviews(false);
      }
    },
    [lang],
  );

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
      reviews.map((item) => {
        const resolvedClassName =
          item.class_name?.trim() ||
          (item.class_id != null ? classNameById.get(item.class_id) ?? null : null);
        return {
          item,
          guidance: getTeacherReviewGuidance(item, lang),
          studentLabel: resolveStudentLabel(item),
          className: resolvedClassName,
        };
      }),
    [reviews, classNameById, lang],
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

  const filteredReviews = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const matched = enrichedReviews.filter((entry) => {
      if (severityFilter !== 'all' && entry.guidance.severity !== severityFilter) {
        return false;
      }
      if (!q) return true;
      const { item, guidance, studentLabel, className } = entry;
      return (
        item.filename.toLowerCase().includes(q) ||
        (studentLabel ?? '').toLowerCase().includes(q) ||
        (item.student_username ?? '').toLowerCase().includes(q) ||
        (className ?? '').toLowerCase().includes(q) ||
        (item.citation_raw ?? '').toLowerCase().includes(q) ||
        guidance.headline.toLowerCase().includes(q)
      );
    });

    const sorted = [...matched];
    sorted.sort((a, b) => {
      if (sortMode === 'urgent') {
        const diff =
          SEVERITY_PRIORITY[a.guidance.severity] -
          SEVERITY_PRIORITY[b.guidance.severity];
        if (diff !== 0) return diff;
        return parseTimestamp(b.item.validated_at) - parseTimestamp(a.item.validated_at);
      }
      if (sortMode === 'paper') {
        const titleCmp = a.item.filename.localeCompare(b.item.filename);
        if (titleCmp !== 0) return titleCmp;
        return (
          SEVERITY_PRIORITY[a.guidance.severity] -
          SEVERITY_PRIORITY[b.guidance.severity]
        );
      }
      // newest
      return parseTimestamp(b.item.validated_at) - parseTimestamp(a.item.validated_at);
    });
    return sorted;
  }, [enrichedReviews, severityFilter, searchQuery, sortMode]);

  const submissionGroups = useMemo<SubmissionReviewGroup[]>(() => {
    const map = new Map<number, SubmissionReviewGroup>();
    for (const entry of filteredReviews) {
      const { item, studentLabel, className } = entry;
      const existing = map.get(item.essay_id);
      if (existing) {
        existing.items.push(entry);
        if (!existing.studentLabel && studentLabel) existing.studentLabel = studentLabel;
        if (!existing.className && className) existing.className = className;
      } else {
        map.set(item.essay_id, {
          essayId: item.essay_id,
          filename: item.filename,
          studentLabel,
          className,
          items: [entry],
        });
      }
    }
    const groups = Array.from(map.values());
    groups.sort((a, b) => {
      if (sortMode === 'paper') {
        return a.filename.localeCompare(b.filename);
      }
      if (sortMode === 'newest') {
        const aMax = Math.max(...a.items.map((x) => parseTimestamp(x.item.validated_at)));
        const bMax = Math.max(...b.items.map((x) => parseTimestamp(x.item.validated_at)));
        return bMax - aMax;
      }
      // urgent
      const aMin = Math.min(...a.items.map((x) => SEVERITY_PRIORITY[x.guidance.severity]));
      const bMin = Math.min(...b.items.map((x) => SEVERITY_PRIORITY[x.guidance.severity]));
      if (aMin !== bMin) return aMin - bMin;
      return b.items.length - a.items.length;
    });
    return groups;
  }, [filteredReviews, sortMode]);

  const totalPaperCount = useMemo(
    () => new Set(reviews.map((r) => r.essay_id)).size,
    [reviews],
  );

  const handleUndoAdjudication = useCallback(
    async (originalItem: PendingVerdict) => {
      const revertLabel = normalizeOriginalLabel(String(originalItem.label));
      try {
        await api.overrideVerdict(originalItem.essay_id, {
          verdict_id: String(originalItem.verdict_id),
          new_label: revertLabel,
          reason:
            lang === 'vi'
              ? 'Hoàn tác thao tác duyệt nhanh từ hàng đợi giảng viên'
              : 'Undid quick adjudication from faculty review queue',
        });
        setReviews((prev) =>
          prev.some((x) => x.verdict_id === originalItem.verdict_id)
            ? prev
            : [originalItem, ...prev],
        );
        setResolvedSessionCount((c) => Math.max(0, c - 1));
        toast.info(
          lang === 'vi'
            ? 'Đã hoàn tác quyết định duyệt'
            : 'Review decision undone',
          originalItem.filename,
        );
      } catch (e) {
        toast.error(
          lang === 'vi'
            ? 'Không thể hoàn tác quyết định duyệt'
            : 'Failed to undo review decision',
          formatUserError(e, lang),
        );
      }
    },
    [lang, toast],
  );

  const handleAdjudicate = useCallback(
    async (
      r: PendingVerdict,
      newLabel: ValidationLabel,
      actionType: 'approve' | 'flag',
      customNote?: string,
    ) => {
      if (inFlightIds[r.verdict_id]) return;
      setInFlightIds((prev) => ({ ...prev, [r.verdict_id]: true }));
      const trimmedNote = (customNote ?? '').trim();
      const defaultReason =
        actionType === 'approve'
          ? lang === 'vi'
            ? 'Giảng viên xác nhận trích dẫn hợp lệ từ hàng đợi duyệt'
            : 'Approved as valid from faculty review queue'
          : lang === 'vi'
            ? `Giảng viên cập nhật phân loại (${getVerdictDisplay(newLabel, 'vi').label}) từ hàng đợi duyệt`
            : `Updated classification (${getVerdictDisplay(newLabel, 'en').label}) from faculty review queue`;

      try {
        await api.overrideVerdict(r.essay_id, {
          verdict_id: String(r.verdict_id),
          new_label: newLabel,
          reason: trimmedNote || defaultReason,
        });
        setReviews((prev) =>
          prev.filter((item) => item.verdict_id !== r.verdict_id),
        );
        setConfirmDraft((prev) =>
          prev?.verdictId === r.verdict_id ? null : prev,
        );
        setResolvedSessionCount((c) => c + 1);
        const appliedLabel = getVerdictDisplay(newLabel, lang).label;
        toast.success(
          actionType === 'approve'
            ? lang === 'vi'
              ? `Đã cập nhật: ${appliedLabel}`
              : `Marked as ${appliedLabel}`
            : lang === 'vi'
              ? `Đã ghi nhận: ${appliedLabel}`
              : `Recorded as ${appliedLabel}`,
          r.filename,
          {
            duration: 8000,
            action: {
              label: lang === 'vi' ? 'Hoàn tác' : 'Undo',
              onClick: () => {
                void handleUndoAdjudication(r);
              },
            },
          },
        );
      } catch (e) {
        toast.error(
          lang === 'vi'
            ? 'Không thể lưu quyết định duyệt'
            : 'Failed to save review decision',
          formatUserError(e, lang),
        );
      } finally {
        setInFlightIds((prev) => {
          const next = { ...prev };
          delete next[r.verdict_id];
          return next;
        });
      }
    },
    [handleUndoAdjudication, inFlightIds, lang, toast],
  );

  const openConfirmBar = (
    r: PendingVerdict,
    actionType: 'approve' | 'flag',
    defaultTarget: ValidationLabel,
  ) => {
    setConfirmDraft((prev) => {
      if (prev && prev.verdictId === r.verdict_id && prev.actionType === actionType) {
        return null;
      }
      return {
        verdictId: r.verdict_id,
        actionType,
        targetLabel: defaultTarget,
        note: '',
      };
    });
  };

  const toggleGroup = (essayId: number) => {
    setCollapsedEssays((prev) => ({
      ...prev,
      [essayId]: !prev[essayId],
    }));
  };

  const renderCitationCard = (
    { item: r, guidance, studentLabel, className }: EnrichedPendingItem,
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
    const activeDraft =
      confirmDraft?.verdictId === r.verdict_id ? confirmDraft : null;
    const reportHref = `/verification/report/${r.essay_id}?citation=${r.verdict_id}`;

    const openReport = () => navigate(reportHref);

    return (
      <m.div
        key={r.verdict_id}
        layout
        exit={{ opacity: 0, y: -6, transition: TRANSITION_EXIT }}
        onClick={openReport}
        data-testid={`pending-review-row-${r.verdict_id}`}
        className="relative w-full text-left px-4 sm:px-5 py-4 hover:bg-slate-50/80 dark:hover:bg-slate-800/40 focus-within:bg-slate-50/90 dark:focus-within:bg-slate-800/40 focus-within:ring-1 focus-within:ring-inset focus-within:ring-indigo-300 dark:focus-within:ring-indigo-700 transition-colors group cursor-pointer"
      >
        <span
          aria-hidden="true"
          className={`absolute left-0 top-3 bottom-3 w-1 rounded-r-full ${SEVERITY_ACCENT_BAR[guidance.severity]}`}
        />

        <div className="space-y-2.5 pl-1">
          {/* Top badges + Student & Class context */}
          <div className="flex items-start justify-between gap-2 flex-wrap">
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
                        ? (() => {
                            const safeArchiveHref = toSafeExternalHref(r.archive_url);
                            return safeArchiveHref ? (
                              <a
                                href={safeArchiveHref}
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
                            );
                          })()
                        : r.url_status === 'fake_domain'
                          ? lang === 'vi'
                            ? '✕ Tên miền không tồn tại'
                            : '✕ Invalid Domain'
                          : lang === 'vi'
                            ? '✕ Liên kết hỏng'
                            : '✕ Dead Link'}
                </span>
              )}
            </div>

            {/* Student & Class badges on every item card */}
            {(studentLabel || className) && (
              <div className="flex items-center gap-1.5 flex-wrap text-[11px]">
                {studentLabel && (
                  <span
                    data-testid={`pending-student-${r.verdict_id}`}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-medium"
                  >
                    <UserIcon className="h-3 w-3 text-slate-400 shrink-0" />
                    <span>{studentLabel}</span>
                  </span>
                )}
                {className && (
                  <span
                    data-testid={`pending-class-${r.verdict_id}`}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-indigo-50/90 dark:bg-indigo-950/70 border border-indigo-200/80 dark:border-indigo-800/80 text-indigo-700 dark:text-indigo-300 font-medium"
                  >
                    <GraduationCap className="h-3 w-3 shrink-0" />
                    <span>{className}</span>
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Full Paper Filename in List view (no aggressive 28-char truncation) */}
          {showPaperMeta && (
            <div className="flex items-start gap-2 text-xs text-slate-600 dark:text-slate-300">
              <FileFormatIcon filename={r.filename} size="xs" />
              <span className="font-semibold text-slate-800 dark:text-slate-100 break-words leading-snug">
                {r.filename}
              </span>
            </div>
          )}

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
              className="px-3 py-2 rounded-xl bg-amber-50/80 dark:bg-amber-950/40 border border-amber-200/80 dark:border-amber-800/80 text-xs text-amber-900 dark:text-amber-200 break-words"
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

          {/* Guarded Teacher Actions + Real <Link> to Report */}
          <div
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
            className="pt-1 space-y-2.5"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={isBusy}
                  aria-expanded={activeDraft?.actionType === 'approve'}
                  data-testid={`pending-approve-btn-${r.verdict_id}`}
                  onClick={() => openConfirmBar(r, 'approve', 'verified')}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold shadow-sm transition-colors disabled:opacity-50 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 ${
                    activeDraft?.actionType === 'approve'
                      ? 'bg-emerald-700 text-white ring-2 ring-emerald-500/30'
                      : 'bg-emerald-600 hover:bg-emerald-700 text-white'
                  }`}
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
                  aria-expanded={activeDraft?.actionType === 'flag'}
                  data-testid={`pending-confirm-issue-btn-${r.verdict_id}`}
                  onClick={() => openConfirmBar(r, 'flag', guidance.confirmNewLabel)}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-medium transition-colors disabled:opacity-50 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 ${
                    activeDraft?.actionType === 'flag'
                      ? 'bg-amber-50 dark:bg-amber-950/60 border-amber-400 dark:border-amber-600 text-amber-900 dark:text-amber-100 ring-2 ring-amber-500/20'
                      : 'bg-white dark:bg-slate-900 hover:bg-amber-50 dark:hover:bg-amber-950/40 border-slate-200 dark:border-slate-700 hover:border-amber-300 dark:hover:border-amber-700 text-slate-700 dark:text-slate-200 hover:text-amber-800 dark:hover:text-amber-200'
                  }`}
                >
                  <Flag className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
                  <span>{guidance.confirmButtonLabel}</span>
                </button>
              </div>

              <Link
                to={reportHref}
                data-testid={`pending-open-report-link-${r.verdict_id}`}
                onClick={(e) => e.stopPropagation()}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/60 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              >
                <span>{lang === 'vi' ? 'Xem trong bài' : 'Open Report'}</span>
                <ExternalLink className="h-3.5 w-3.5" />
              </Link>
            </div>

            {/* BUG-23: Inline confirmation bar with explicit target status selector & optional note */}
            {activeDraft && (
              <div
                data-testid={`pending-confirm-bar-${r.verdict_id}`}
                className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 space-y-2.5"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-slate-800 dark:text-slate-100">
                    {activeDraft.actionType === 'approve'
                      ? lang === 'vi'
                        ? 'Xác nhận kết quả áp dụng:'
                        : 'Confirm classification to apply:'
                      : lang === 'vi'
                        ? 'Chọn trạng thái ghi nhận:'
                        : 'Choose status to record:'}
                  </span>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {(activeDraft.actionType === 'approve'
                      ? APPROVE_TARGET_OPTIONS
                      : FLAG_TARGET_OPTIONS
                    ).map((opt) => {
                      const disp = getVerdictDisplay(opt, lang);
                      const selected = activeDraft.targetLabel === opt;
                      return (
                        <button
                          key={opt}
                          type="button"
                          aria-pressed={selected}
                          data-testid={`pending-target-option-${r.verdict_id}-${opt}`}
                          onClick={() =>
                            setConfirmDraft((prev) =>
                              prev ? { ...prev, targetLabel: opt } : prev,
                            )
                          }
                          className={`px-2.5 py-1 rounded-lg border text-xs font-medium transition-colors cursor-pointer ${
                            selected
                              ? `${disp.badgeClass} ring-2 ring-indigo-500/25 font-semibold`
                              : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                          }`}
                        >
                          {disp.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                  <Input
                    type="text"
                    value={activeDraft.note}
                    onChange={(e) =>
                      setConfirmDraft((prev) =>
                        prev ? { ...prev, note: e.target.value } : prev,
                      )
                    }
                    data-testid={`pending-confirm-note-${r.verdict_id}`}
                    placeholder={
                      lang === 'vi'
                        ? 'Ghi chú ngắn cho nhật ký duyệt (tùy chọn)…'
                        : 'Optional review note for audit log…'
                    }
                    aria-label={lang === 'vi' ? 'Ghi chú duyệt' : 'Review note'}
                    className="h-8 text-xs rounded-lg bg-white dark:bg-slate-900 flex-1"
                  />
                  <div className="flex items-center justify-end gap-1.5 shrink-0">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={isBusy}
                      data-testid={`pending-confirm-cancel-${r.verdict_id}`}
                      onClick={() => setConfirmDraft(null)}
                      className="h-8 px-3 text-xs rounded-lg"
                    >
                      {t('common.cancel')}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      disabled={isBusy}
                      data-testid={`pending-confirm-submit-${r.verdict_id}`}
                      onClick={() =>
                        void handleAdjudicate(
                          r,
                          activeDraft.targetLabel,
                          activeDraft.actionType,
                          activeDraft.note,
                        )
                      }
                      className={`h-8 px-3 text-xs rounded-lg gap-1.5 ${
                        activeDraft.actionType === 'approve'
                          ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                          : 'bg-amber-600 hover:bg-amber-700 text-white'
                      }`}
                    >
                      {isBusy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                      <span>{lang === 'vi' ? 'Xác nhận' : 'Confirm'}</span>
                    </Button>
                  </div>
                </div>
              </div>
            )}
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
    testId: string;
  }> = [
    {
      key: 'all',
      label: lang === 'vi' ? 'Tất cả' : 'All',
      count: counts.total,
      dotClass: 'bg-indigo-500',
      activeClass:
        'border-indigo-400 dark:border-indigo-600 ring-2 ring-indigo-500/15 bg-indigo-50/40 dark:bg-indigo-950/30',
      valueClass: 'text-slate-900 dark:text-slate-100',
      testId: 'pending-kpi-all',
    },
    {
      key: 'critical',
      label: getVerdictDisplay('suspected_hallucination', lang).label,
      count: counts.critical,
      dotClass: 'bg-rose-500',
      activeClass:
        'border-rose-400 dark:border-rose-600 ring-2 ring-rose-500/15 bg-rose-50/40 dark:bg-rose-950/30',
      valueClass: 'text-rose-600 dark:text-rose-400',
      testId: 'pending-kpi-critical',
    },
    {
      key: 'warning',
      label: getVerdictDisplay('metadata_error', lang).label,
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
      label: getVerdictDisplay('unresolved', lang).label,
      count: counts.uncertain,
      dotClass: 'bg-slate-400',
      activeClass:
        'border-slate-400 dark:border-slate-500 ring-2 ring-slate-500/15 bg-slate-100/70 dark:bg-slate-800/70',
      valueClass: 'text-slate-700 dark:text-slate-200',
      testId: 'pending-kpi-unresolved',
    },
  ];

  const hasActiveFilters = severityFilter !== 'all' || searchQuery.trim().length > 0;

  return (
    <div className="space-y-5 pb-10">
      {/* Clean Action-First Header */}
      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 p-5 sm:p-6 shadow-sm flex flex-wrap items-center justify-between gap-4">
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
                ? 'Xem nhanh gợi ý xử lý và xác nhận từng trích dẫn có kèm nhật ký & hoàn tác.'
                : 'Review plain-language guidance and confirm each citation with audit notes and undo.'}
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
                  : `${counts.total} ${counts.total === 1 ? 'item' : 'items'} across ${totalPaperCount} ${totalPaperCount === 1 ? 'paper' : 'papers'}`
                : lang === 'vi'
                  ? 'Đã duyệt sạch'
                  : 'Queue clear'}
            </span>
          </span>
        </div>
      </div>

      {/* BUG-23: Prominent Decision-Support Framing Banner */}
      <DecisionSupportBanner variant="compact" lang={lang} />

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
          {/* Visual Triage Overview: Summary Donut + Non-Truncating Responsive Filter Cards */}
          <div className="space-y-3.5">
            <Card className="p-4 sm:p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 shadow-sm flex items-center gap-4">
              <DonutChart
                size={76}
                thickness={10}
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
                    <span className="text-lg font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
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
                      ? 'Chọn một mức ưu tiên bên dưới để lọc và xử lý các trích dẫn cần chú ý trước.'
                      : 'Choose a priority category below to focus on similar citation issues first.'
                    : lang === 'vi'
                      ? 'Mọi trích dẫn cần chú ý trong lớp đã được xử lý.'
                      : 'Every flagged citation across your classes has been reviewed.'}
                </p>
              </div>
            </Card>

            <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3">
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
                    className={`text-left p-3.5 rounded-2xl bg-white dark:bg-slate-900 border transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 flex flex-col justify-between gap-2 ${
                      active
                        ? fc.activeClass
                        : 'border-slate-200/90 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 shadow-sm'
                    }`}
                  >
                    <div className="flex items-start gap-1.5">
                      <span
                        className={`w-2 h-2 rounded-full shrink-0 mt-1 ${fc.dotClass}`}
                      />
                      <span className="text-xs font-medium text-slate-700 dark:text-slate-300 leading-snug break-words">
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
                          ? 'bg-indigo-600 text-white shadow-sm'
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
                              ? 'bg-indigo-600 text-white shadow-sm'
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

            {/* Search & Sort Toolbar */}
            {reviews.length > 0 && (
              <div className="px-4 sm:px-5 py-3 bg-slate-50/60 dark:bg-slate-950/40 border-b border-slate-200/80 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center gap-2.5">
                <div className="relative flex-1 min-w-0">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 pointer-events-none" />
                  <Input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    data-testid="pending-search-input"
                    placeholder={
                      lang === 'vi'
                        ? 'Tìm theo tên bài, sinh viên, lớp hoặc nội dung trích dẫn…'
                        : 'Search by paper filename, student, class, or citation text…'
                    }
                    aria-label={
                      lang === 'vi' ? 'Tìm kiếm trong hàng đợi duyệt' : 'Search pending reviews'
                    }
                    className="h-9 pl-9 pr-8 text-xs rounded-xl bg-white dark:bg-slate-900"
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => setSearchQuery('')}
                      aria-label={lang === 'vi' ? 'Xóa tìm kiếm' : 'Clear search'}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 rounded text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>

                <div className="relative sm:w-52 shrink-0">
                  <ArrowUpDown className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 pointer-events-none" />
                  <select
                    value={sortMode}
                    onChange={(e) => setSortMode(e.target.value as ReviewSortMode)}
                    data-testid="pending-sort-select"
                    aria-label={lang === 'vi' ? 'Sắp xếp hàng đợi' : 'Sort review queue'}
                    className="h-9 w-full pl-8 pr-8 rounded-xl border border-input bg-white dark:bg-slate-900 text-xs font-medium text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
                  >
                    <option value="urgent">
                      {lang === 'vi' ? 'Ưu tiên gấp nhất trước' : 'Most urgent first'}
                    </option>
                    <option value="newest">
                      {lang === 'vi' ? 'Mới cập nhật nhất' : 'Newest first'}
                    </option>
                    <option value="paper">
                      {lang === 'vi' ? 'Tên bài nộp (A → Z)' : 'Paper title (A → Z)'}
                    </option>
                  </select>
                </div>
              </div>
            )}

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
                    ? 'Không còn mục nào khớp với bộ lọc hiện tại.'
                    : 'No items match the active search or category filter.'}
                </p>
                {hasActiveFilters && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    data-testid="pending-reset-severity-btn"
                    onClick={() => {
                      setSeverityFilter('all');
                      setSearchQuery('');
                    }}
                    className="gap-1.5 rounded-xl"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    {lang === 'vi'
                      ? `Xem tất cả ${reviews.length} mục còn lại`
                      : `Show all ${reviews.length} remaining items`}
                  </Button>
                )}
              </div>
            ) : viewMode === 'grouped' ? (
              <div className="p-3.5 sm:p-4 space-y-3.5 bg-slate-50/40 dark:bg-slate-950/30">
                <AnimatePresence initial={false}>
                  {submissionGroups.map((group) => {
                    const isOpen = !collapsedEssays[group.essayId];

                    return (
                      <m.div
                        key={group.essayId}
                        layout
                        exit={{ opacity: 0, y: -8, transition: TRANSITION_EXIT }}
                        className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 shadow-sm overflow-hidden"
                      >
                        <div className="px-4 py-3 bg-slate-50/80 dark:bg-slate-800/50 border-b border-slate-200/70 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2.5">
                          <button
                            type="button"
                            onClick={() => toggleGroup(group.essayId)}
                            aria-expanded={isOpen}
                            className="flex flex-wrap items-center gap-2 min-w-0 flex-1 text-left cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded-lg"
                          >
                            <FileFormatIcon filename={group.filename} size="xs" />
                            <span className="font-display font-semibold text-sm sm:text-base text-slate-900 dark:text-white break-words">
                              {group.filename}
                            </span>
                            {group.studentLabel && (
                              <span
                                data-testid={`pending-group-student-${group.essayId}`}
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-700 text-xs text-slate-600 dark:text-slate-300 shrink-0"
                              >
                                <UserIcon className="h-3 w-3 text-slate-400" />
                                {group.studentLabel}
                              </span>
                            )}
                            {group.className && (
                              <span
                                data-testid={`pending-group-class-${group.essayId}`}
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-indigo-50/90 dark:bg-indigo-950/70 border border-indigo-200/80 dark:border-indigo-800/80 text-xs text-indigo-700 dark:text-indigo-300 font-medium shrink-0"
                              >
                                <GraduationCap className="h-3 w-3" />
                                {group.className}
                              </span>
                            )}
                            <span className="px-2 py-0.5 rounded-full bg-amber-100/80 dark:bg-amber-950/80 text-amber-800 dark:text-amber-300 text-xs font-semibold shrink-0">
                              {lang === 'vi'
                                ? `${group.items.length} mục`
                                : `${group.items.length} ${group.items.length === 1 ? 'item' : 'items'}`}
                            </span>
                          </button>

                          <div className="flex items-center gap-2 shrink-0">
                            <Link
                              to={`/verification/report/${group.essayId}`}
                              data-testid={`pending-full-report-link-${group.essayId}`}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-white dark:hover:bg-slate-800 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                            >
                              <span>
                                {lang === 'vi' ? 'Mở toàn bộ bài' : 'Full Report'}
                              </span>
                              <ExternalLink className="h-3 w-3" />
                            </Link>
                            <button
                              type="button"
                              onClick={() => toggleGroup(group.essayId)}
                              aria-label={
                                isOpen
                                  ? lang === 'vi'
                                    ? 'Thu gọn bài nộp'
                                    : 'Collapse paper'
                                  : lang === 'vi'
                                    ? 'Mở rộng bài nộp'
                                    : 'Expand paper'
                              }
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
