import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft,
  UserPlus,
  Download,
  Users,
  FileText,
  Trash2,
  AlertCircle,
  ExternalLink,
  Loader2,
  Copy,
  Check,
  RefreshCw,
  KeyRound,
  AlertTriangle,
  Pencil,
  Archive,
  Search,
  X,
  ArrowUpDown,
  RotateCcw,
} from 'lucide-react';
import {
  api,
  type Class,
  type ClassStudent,
  type ClassEssay,
  type ClassAnalytics,
} from '@/api/client';
import {
  formatCisScore,
  formatLocalizedDate,
  formatUserError,
  getVerdictDisplay,
  resolveAcademicLang,
} from '@/lib/academicTaxonomy';
import {
  filterTopCitationIssueRules,
} from '@/lib/teacherGuidance';
import { useModalA11y } from '@/hooks/useModalA11y';
import { useToast } from '@/contexts/ToastContext';
import { ConfirmationModal } from '@/components/ConfirmationModal';
import { AddStudentDialog } from '@/components/AddStudentDialog';
import { UpgradeModal } from '@/components/UpgradeModal';
import { FileFormatIcon } from '@/components/FileFormatIcon';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { StudioWindowHeader } from '@/components/ui/studio-visuals';
import {
  DonutChart,
  NumberPopIn,
  ScoreRing,
} from '@/components/ui/transitions';

type SubmissionStatusFilter = 'all' | 'completed' | 'processing' | 'failed' | 'low_cis';
type SubmissionSortOrder = 'newest' | 'cis_asc' | 'cis_desc';

function parseSubmissionTimestamp(value?: string | null): number {
  if (!value) return 0;
  const ts = Date.parse(value);
  return Number.isFinite(ts) ? ts : 0;
}

function formatStudentDisplayName(
  fullName?: string | null,
  username?: string | null,
): string {
  const rawFull = (fullName ?? '').trim();
  const rawUser = (username ?? '').trim();
  if (rawFull) {
    if (rawUser) {
      const escaped = rawUser.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const stripped = rawFull
        .replace(new RegExp(`\\s*\\(@?${escaped}\\)$`, 'i'), '')
        .trim();
      if (stripped) return stripped;
    }
    const strippedGeneric = rawFull.replace(/\s*\(user\)$/i, '').trim();
    if (strippedGeneric) return strippedGeneric;
    return rawFull;
  }
  if (rawUser) {
    const strippedGeneric = rawUser.replace(/\s*\(user\)$/i, '').trim();
    if (strippedGeneric) return strippedGeneric;
    return rawUser;
  }
  return '—';
}

/**
 * ClassDetailPage — Visual Cohort Studio for a single class.
 *
 * Combines ScoreRing gauges, DonutChart verdict distribution, 4-band grade histogram,
 * plain-language issue ranking bars, and searchable/sortable student & submission rosters.
 */
export function ClassDetailPage() {
  const { classId } = useParams<{ classId: string }>();
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const lang = resolveAcademicLang(i18n.resolvedLanguage || i18n.language);
  const toast = useToast();
  const cid = Number(classId);
  const submissionsSectionRef = useRef<HTMLElement | null>(null);

  const [cls, setCls] = useState<Class | null>(null);
  const [students, setStudents] = useState<ClassStudent[]>([]);
  const [essays, setEssays] = useState<ClassEssay[]>([]);
  const [analytics, setAnalytics] = useState<ClassAnalytics | null>(null);
  const [copiedCode, setCopiedCode] = useState(false);
  const [regeneratingCode, setRegeneratingCode] = useState(false);
  const [confirmRegenerateOpen, setConfirmRegenerateOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [pendingRemove, setPendingRemove] = useState<ClassStudent | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [exportingZip, setExportingZip] = useState(false);
  const [upgradeOpen, setUpgradeOpen] = useState(false);

  // Submission roster search, filter, sort
  const [submissionSearch, setSubmissionSearch] = useState('');
  const [submissionStatusFilter, setSubmissionStatusFilter] =
    useState<SubmissionStatusFilter>('all');
  const [submissionSort, setSubmissionSort] = useState<SubmissionSortOrder>('newest');

  const editClassDialog = useModalA11y<HTMLDivElement>(
    editOpen,
    () => {
      if (!savingEdit) setEditOpen(false);
    },
    { disableEscape: savingEdit },
  );

  const notFoundMessage = useMemo(
    () =>
      lang === 'vi'
        ? 'Không tìm thấy lớp học này hoặc bạn không có quyền truy cập.'
        : 'Class not found or access restricted.',
    [lang],
  );

  const load = useCallback(async () => {
    if (!cid || Number.isNaN(cid) || cid <= 0) {
      setError(notFoundMessage);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const all = await api.listMyClasses();
      const found = all.find((c) => c.id === cid);
      if (!found) {
        setError(notFoundMessage);
        setLoading(false);
        return;
      }
      setCls(found);
      const [studentList, essayList, analyticsData] = await Promise.all([
        api.listClassStudents(cid).catch(() => []),
        api.listClassEssays(cid).catch(() => []),
        api.getClassAnalytics(cid).catch(() => null),
      ]);
      setStudents(studentList);
      setEssays(essayList);
      setAnalytics(analyticsData);
    } catch (e) {
      setError(
        formatUserError(
          e,
          lang,
          lang === 'vi' ? 'Không thể tải thông tin lớp học.' : 'Failed to load class.',
        ),
      );
    } finally {
      setLoading(false);
    }
  }, [cid, lang, notFoundMessage]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleRemove = async () => {
    if (!pendingRemove) return;
    const studentId = pendingRemove.id;
    const studentUsername = pendingRemove.username;
    setPendingRemove(null);
    try {
      await api.removeStudentFromClass(cid, studentId);
      toast.success(
        t('teacher.studentRemovedSuccess', { username: studentUsername }),
      );
      void load();
    } catch (e) {
      toast.error(formatUserError(e, lang, t('teacher.studentRemoveFailed')));
    }
  };

  const handleCopyJoinCode = async () => {
    if (!cls?.join_code) return;
    try {
      await navigator.clipboard.writeText(cls.join_code);
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2000);
      toast.success(
        lang === 'vi'
          ? `Đã sao chép mã tham gia lớp: ${cls.join_code}`
          : `Copied class join code: ${cls.join_code}`,
      );
    } catch {
      toast.error(lang === 'vi' ? 'Không thể sao chép mã' : 'Failed to copy code');
    }
  };

  const handleRegenerateCode = async () => {
    setConfirmRegenerateOpen(false);
    setRegeneratingCode(true);
    try {
      const updated = await api.regenerateClassCode(cid);
      setCls(updated);
      toast.success(
        lang === 'vi'
          ? `Đã tạo mã tham gia mới: ${updated.join_code}`
          : `Generated new join code: ${updated.join_code}`,
      );
    } catch (e) {
      toast.error(
        formatUserError(
          e,
          lang,
          lang === 'vi' ? 'Không thể tạo mã tham gia mới.' : 'Failed to regenerate code',
        ),
      );
    } finally {
      setRegeneratingCode(false);
    }
  };

  const handleExport = async () => {
    try {
      await api.downloadClassCsvFile(cid);
    } catch (e) {
      toast.error(formatUserError(e, lang, t('teacher.exportCsvFailed')));
    }
  };

  const handleExportZip = async () => {
    setExportingZip(true);
    try {
      await api.downloadClassZipExport(cid);
      toast.success(
        lang === 'vi'
          ? 'Đã tải xuống gói ZIP báo cáo toàn lớp'
          : 'Downloaded class ZIP archive',
      );
    } catch (e) {
      const rawMsg = e instanceof Error ? e.message : 'Failed to export class ZIP';
      if (/API\s+(402|403)\b|HTTP\s+(402|403)\b|Ultra|upgrade/i.test(rawMsg)) {
        setUpgradeOpen(true);
      } else {
        toast.error(
          formatUserError(
            e,
            lang,
            lang === 'vi' ? 'Không thể tải gói ZIP báo cáo.' : 'Failed to export class ZIP',
          ),
        );
      }
    } finally {
      setExportingZip(false);
    }
  };

  const handleOpenEdit = () => {
    if (!cls) return;
    setEditName(cls.name);
    setEditDescription(cls.description ?? '');
    setEditOpen(true);
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cls || !editName.trim()) return;
    setSavingEdit(true);
    try {
      const updated = await api.updateClass(cid, {
        name: editName.trim(),
        description: editDescription.trim(),
      });
      setCls(updated);
      setEditOpen(false);
      toast.success(
        lang === 'vi' ? 'Đã cập nhật thông tin lớp học' : 'Updated class details',
      );
    } catch (err) {
      toast.error(
        formatUserError(
          err,
          lang,
          lang === 'vi' ? 'Không thể cập nhật thông tin lớp.' : 'Failed to update class',
        ),
      );
    } finally {
      setSavingEdit(false);
    }
  };

  const handleDeleteClass = async () => {
    setConfirmDeleteOpen(false);
    try {
      await api.deleteClass(cid);
      toast.success(
        lang === 'vi' ? 'Đã xóa lớp học' : 'Class deleted successfully',
      );
      navigate('/teacher/classes');
    } catch (err) {
      toast.error(
        formatUserError(
          err,
          lang,
          lang === 'vi' ? 'Không thể xóa lớp học.' : 'Failed to delete class',
        ),
      );
    }
  };

  const handleJumpToSubmissionFilter = useCallback(
    (status: SubmissionStatusFilter) => {
      setSubmissionStatusFilter((prev) => (prev === status ? 'all' : status));
      submissionsSectionRef.current?.scrollIntoView?.({
        behavior: 'smooth',
        block: 'start',
      });
    },
    [],
  );

  // Map student full_name by user_id and username for clean search/display on submissions & flagged items
  const studentNameById = useMemo(() => {
    const map = new Map<number, string>();
    for (const s of students) {
      if (s.full_name?.trim()) {
        map.set(s.id, formatStudentDisplayName(s.full_name, s.username));
      }
    }
    return map;
  }, [students]);

  const studentNameByUsername = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of students) {
      if (s.username?.trim() && s.full_name?.trim()) {
        map.set(
          s.username.trim().toLowerCase(),
          formatStudentDisplayName(s.full_name, s.username),
        );
      }
    }
    return map;
  }, [students]);

  const submissionStatusCounts = useMemo(() => {
    let completed = 0;
    let processing = 0;
    let failed = 0;
    let lowCis = 0;
    for (const e of essays) {
      const st = (e.job_status ?? 'completed').toLowerCase();
      if (st === 'failed') failed += 1;
      else if (st === 'queued' || st === 'processing') processing += 1;
      else {
        completed += 1;
        if (e.cis_score != null && Number.isFinite(Number(e.cis_score)) && Number(e.cis_score) < 70) {
          lowCis += 1;
        }
      }
    }
    return { total: essays.length, completed, processing, failed, lowCis };
  }, [essays]);

  const filteredAndSortedEssays = useMemo(() => {
    const q = submissionSearch.trim().toLowerCase();
    const filtered = essays.filter((e) => {
      const st = (e.job_status ?? 'completed').toLowerCase();
      if (submissionStatusFilter === 'completed' && (st === 'failed' || st === 'queued' || st === 'processing')) {
        return false;
      }
      if (submissionStatusFilter === 'processing' && st !== 'queued' && st !== 'processing') {
        return false;
      }
      if (submissionStatusFilter === 'failed' && st !== 'failed') {
        return false;
      }
      if (submissionStatusFilter === 'low_cis') {
        const score =
          e.cis_score != null && Number.isFinite(Number(e.cis_score))
            ? Number(e.cis_score)
            : null;
        if (st === 'failed' || st === 'queued' || st === 'processing' || score === null || score >= 70) {
          return false;
        }
      }
      if (!q) return true;
      const fullName =
        (e.user_id != null ? studentNameById.get(e.user_id) : undefined) ??
        (e.username
          ? studentNameByUsername.get(e.username.trim().toLowerCase())
          : undefined) ??
        '';
      return (
        e.filename.toLowerCase().includes(q) ||
        (e.username ?? '').toLowerCase().includes(q) ||
        fullName.toLowerCase().includes(q)
      );
    });

    const sorted = [...filtered];
    sorted.sort((a, b) => {
      if (submissionSort === 'cis_asc') {
        const aScore =
          a.cis_score != null && Number.isFinite(Number(a.cis_score))
            ? Number(a.cis_score)
            : Number.POSITIVE_INFINITY;
        const bScore =
          b.cis_score != null && Number.isFinite(Number(b.cis_score))
            ? Number(b.cis_score)
            : Number.POSITIVE_INFINITY;
        if (aScore !== bScore) return aScore - bScore;
      } else if (submissionSort === 'cis_desc') {
        const aScore =
          a.cis_score != null && Number.isFinite(Number(a.cis_score))
            ? Number(a.cis_score)
            : Number.NEGATIVE_INFINITY;
        const bScore =
          b.cis_score != null && Number.isFinite(Number(b.cis_score))
            ? Number(b.cis_score)
            : Number.NEGATIVE_INFINITY;
        if (aScore !== bScore) return bScore - aScore;
      }
      return parseSubmissionTimestamp(b.uploaded_at) - parseSubmissionTimestamp(a.uploaded_at);
    });
    return sorted;
  }, [
    essays,
    studentNameById,
    studentNameByUsername,
    submissionSearch,
    submissionStatusFilter,
    submissionSort,
  ]);

  // BUG-01 defense-in-depth: strip positive/verified rules and replace chimeric jargon
  const filteredTopIssueRules = useMemo(
    () => filterTopCitationIssueRules(analytics?.top_triggered_rules, lang),
    [analytics?.top_triggered_rules, lang],
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 text-indigo-600 dark:text-indigo-400 animate-spin" />
        <span className="ml-3 text-slate-500 text-sm">{t('common.loading')}</span>
      </div>
    );
  }
  if (error) {
    return (
      <div className="space-y-4 p-6">
        <Alert variant="destructive" className="rounded-2xl">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
        <Button
          variant="link"
          onClick={() => navigate('/teacher/classes')}
          className="px-0"
        >
          {t('teacher.backToClasses')}
        </Button>
      </div>
    );
  }
  if (!cls) return null;

  const hasAnySubmissions =
    essays.length > 0 ||
    (analytics?.total_essays ?? 0) > 0 ||
    (cls.essay_count ?? 0) > 0;

  const avgCisSafe =
    analytics && Number.isFinite(analytics.avg_cis) ? analytics.avg_cis : 0;
  const recencySafe =
    analytics && Number.isFinite(analytics.recency_5yr_ratio)
      ? analytics.recency_5yr_ratio
      : 0;

  const emptyExportHint =
    lang === 'vi'
      ? 'Chưa có bài nộp nào trong lớp để xuất báo cáo.'
      : 'No submissions in this class to export yet.';

  return (
    <div className="space-y-5 pb-10">
      {/* Clean Class Header — Tablet/Desktop Safe Layout (BUG-42) */}
      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 p-5 sm:p-6 shadow-sm">
        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
          <div className="min-w-0 flex-1 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigate('/teacher/classes')}
                aria-label={lang === 'vi' ? 'Quay lại danh sách lớp' : 'Back to classes'}
                className="h-9 px-3 rounded-xl text-xs gap-1.5"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                {t('common.back')}
              </Button>

              {cls.join_code && (
                <div className="flex flex-wrap items-center gap-2">
                  <div
                    className="inline-flex items-center gap-1.5 h-9 px-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/70 border border-emerald-200/80 dark:border-emerald-800/80 text-xs font-mono font-semibold text-emerald-700 dark:text-emerald-300 whitespace-nowrap"
                    data-testid="class-join-code-badge"
                  >
                    <KeyRound className="h-3.5 w-3.5 shrink-0" />
                    <span>
                      {lang === 'vi' ? 'MÃ LỚP:' : 'JOIN CODE:'} {cls.join_code}
                    </span>
                  </div>

                  <button
                    type="button"
                    data-testid="copy-join-code-btn"
                    onClick={() => void handleCopyJoinCode()}
                    title={lang === 'vi' ? 'Sao chép mã tham gia lớp' : 'Copy class join code'}
                    aria-label={lang === 'vi' ? 'Sao chép mã tham gia lớp' : 'Copy class join code'}
                    className="inline-flex items-center justify-center gap-1.5 min-h-[36px] min-w-[36px] px-3 py-1.5 rounded-xl bg-emerald-50/70 hover:bg-emerald-100 dark:bg-emerald-950/50 dark:hover:bg-emerald-900/60 border border-emerald-200/80 dark:border-emerald-800/80 text-xs font-medium text-emerald-700 dark:text-emerald-300 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
                  >
                    {copiedCode ? (
                      <Check className="h-3.5 w-3.5 shrink-0" />
                    ) : (
                      <Copy className="h-3.5 w-3.5 shrink-0" />
                    )}
                    <span>
                      {copiedCode
                        ? lang === 'vi'
                          ? 'Đã chép'
                          : 'Copied'
                        : lang === 'vi'
                          ? 'Sao chép'
                          : 'Copy'}
                    </span>
                  </button>

                  <button
                    type="button"
                    data-testid="regenerate-join-code-btn"
                    onClick={() => setConfirmRegenerateOpen(true)}
                    disabled={regeneratingCode}
                    title={
                      lang === 'vi' ? 'Đổi mã tham gia lớp mới' : 'Regenerate join code'
                    }
                    aria-label={
                      lang === 'vi' ? 'Đổi mã tham gia lớp mới' : 'Regenerate join code'
                    }
                    className="inline-flex items-center justify-center gap-1.5 min-h-[36px] min-w-[36px] px-3 py-1.5 rounded-xl bg-white dark:bg-slate-900 hover:bg-amber-50 dark:hover:bg-amber-950/50 border border-slate-200 dark:border-slate-700 hover:border-amber-300 dark:hover:border-amber-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:text-amber-800 dark:hover:text-amber-200 transition-colors cursor-pointer disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
                  >
                    <RefreshCw
                      className={`h-3.5 w-3.5 shrink-0 ${regeneratingCode ? 'animate-spin' : ''}`}
                    />
                    <span>{lang === 'vi' ? 'Đổi mã' : 'New Code'}</span>
                  </button>
                </div>
              )}
            </div>

            <div>
              <h1 className="font-display text-2xl sm:text-3xl font-bold text-slate-900 dark:text-white break-words tracking-tight">
                {cls.name}
              </h1>
              {cls.description && (
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 break-words">
                  {cls.description}
                </p>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 min-w-0 max-w-full lg:justify-end">
            <Button
              type="button"
              variant="outline"
              data-testid="edit-class-btn"
              onClick={handleOpenEdit}
              className="gap-1.5 rounded-xl text-xs h-9"
            >
              <Pencil className="h-3.5 w-3.5" />
              {lang === 'vi' ? 'Sửa thông tin' : 'Edit Class'}
            </Button>

            <Button
              type="button"
              variant="outline"
              data-testid="export-class-csv-btn"
              disabled={!hasAnySubmissions}
              title={!hasAnySubmissions ? emptyExportHint : undefined}
              onClick={() => void handleExport()}
              className="gap-1.5 rounded-xl text-xs h-9"
            >
              <Download className="h-3.5 w-3.5" />
              {t('teacher.exportCsv')}
            </Button>

            <Button
              type="button"
              variant="outline"
              data-testid="export-class-zip-btn"
              disabled={exportingZip || !hasAnySubmissions}
              title={!hasAnySubmissions ? emptyExportHint : undefined}
              onClick={() => void handleExportZip()}
              className="gap-1.5 rounded-xl text-xs h-9 border-violet-200 dark:border-violet-800 text-violet-700 dark:text-violet-300 hover:bg-violet-50 dark:hover:bg-violet-950/50"
            >
              {exportingZip ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Archive className="h-3.5 w-3.5" />
              )}
              {lang === 'vi' ? 'Tải gói ZIP' : 'Export ZIP'}
            </Button>

            <Button
              type="button"
              variant="outline"
              data-testid="delete-class-btn"
              onClick={() => setConfirmDeleteOpen(true)}
              className="gap-1.5 rounded-xl text-xs h-9 border-rose-200 dark:border-rose-800 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/50"
            >
              <Trash2 className="h-3.5 w-3.5" />
              {lang === 'vi' ? 'Xóa lớp' : 'Delete'}
            </Button>
          </div>
        </div>
      </div>

      {/* Visual Metric & Ring Gauge Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3.5 sm:gap-4">
        <Card className="p-4 sm:p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 shadow-sm flex flex-col justify-between">
          <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
            {t('teacher.enrolledStudents')}
          </span>
          <p className="mt-2 text-2xl sm:text-3xl font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
            <NumberPopIn value={students.length} />
          </p>
        </Card>

        <Card className="p-4 sm:p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 shadow-sm flex flex-col justify-between">
          <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
            {t('teacher.cohortSubmissions')}
          </span>
          <p className="mt-2 text-2xl sm:text-3xl font-bold font-mono tabular-nums text-emerald-600 dark:text-emerald-400">
            <NumberPopIn value={essays.length} />
          </p>
        </Card>

        <Card className="p-4 sm:p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 shadow-sm flex items-center justify-between gap-3">
          <div className="min-w-0">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400 block">
              {lang === 'vi' ? 'Điểm tin cậy TB' : 'Average CIS'}
            </span>
            <p
              data-testid="cohort-avg-cis-value"
              className="mt-1.5 text-xl sm:text-2xl font-bold font-mono tabular-nums whitespace-nowrap text-violet-600 dark:text-violet-400"
            >
              {analytics && hasAnySubmissions ? formatCisScore(avgCisSafe) : '—'}
            </p>
          </div>
          <ScoreRing
            data-testid="cohort-cis-ring"
            value={hasAnySubmissions ? avgCisSafe : 0}
            size={46}
            thickness={4.5}
            color={hasAnySubmissions ? '#8b5cf6' : '#cbd5e1'}
          />
        </Card>

        <Card className="p-4 sm:p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 shadow-sm flex items-center justify-between gap-3">
          <div className="min-w-0">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400 block">
              {lang === 'vi' ? 'Tài liệu mới (≤ 5 năm)' : '5-Year Recency'}
            </span>
            <p
              data-testid="cohort-recency-value"
              className="mt-1.5 text-xl sm:text-2xl font-bold font-mono tabular-nums whitespace-nowrap text-amber-600 dark:text-amber-400"
            >
              {analytics && hasAnySubmissions ? `${recencySafe.toFixed(1)}%` : '—'}
            </p>
          </div>
          <ScoreRing
            data-testid="cohort-recency-ring"
            value={hasAnySubmissions ? recencySafe : 0}
            size={46}
            thickness={4.5}
            color={hasAnySubmissions ? '#f59e0b' : '#cbd5e1'}
          />
        </Card>
      </div>

      {/* Visual Cohort Citation Health Studio */}
      {analytics && (
        <section
          className="rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm overflow-hidden"
          data-testid="cohort-analytics-panel"
        >
          <StudioWindowHeader
            title={
              lang === 'vi'
                ? 'TỔNG QUAN CHẤT LƯỢNG TRÍCH DẪN'
                : 'CLASS CITATION HEALTH'
            }
            rightSlot={
              <div className="flex flex-wrap items-center gap-2">
                {(analytics.queued_essays ?? 0) > 0 && (
                  <button
                    type="button"
                    data-testid="cohort-queued-essays-pill"
                    aria-pressed={submissionStatusFilter === 'processing'}
                    onClick={() => handleJumpToSubmissionFilter('processing')}
                    title={
                      lang === 'vi'
                        ? 'Bấm để lọc các bài đang xử lý bên dưới'
                        : 'Click to filter queued/processing submissions below'
                    }
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/80 dark:hover:bg-amber-900/80 border text-xs font-medium text-amber-700 dark:text-amber-300 transition-colors cursor-pointer ${
                      submissionStatusFilter === 'processing'
                        ? 'border-amber-500 ring-2 ring-amber-500/20'
                        : 'border-amber-200/80 dark:border-amber-800/80'
                    }`}
                  >
                    <Loader2 className="h-3 w-3 animate-spin" />
                    {lang === 'vi'
                      ? `${analytics.queued_essays} bài đang xử lý`
                      : `${analytics.queued_essays} queued`}
                  </button>
                )}
                {(analytics.failed_essays ?? 0) > 0 && (
                  <button
                    type="button"
                    data-testid="cohort-failed-essays-pill"
                    aria-pressed={submissionStatusFilter === 'failed'}
                    onClick={() => handleJumpToSubmissionFilter('failed')}
                    title={
                      lang === 'vi'
                        ? 'Bấm để lọc các bài lỗi xử lý bên dưới'
                        : 'Click to filter failed submissions below'
                    }
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/80 dark:hover:bg-rose-900/80 border text-xs font-medium text-rose-700 dark:text-rose-300 transition-colors cursor-pointer ${
                      submissionStatusFilter === 'failed'
                        ? 'border-rose-500 ring-2 ring-rose-500/20'
                        : 'border-rose-200/80 dark:border-rose-800/80'
                    }`}
                  >
                    <AlertCircle className="h-3 w-3" />
                    {lang === 'vi'
                      ? `${analytics.failed_essays} bài lỗi xử lý`
                      : `${analytics.failed_essays} failed`}
                  </button>
                )}
              </div>
            }
          />

          {(() => {
            const vb = analytics.verdict_breakdown ?? {};
            const breakdownItems = [
              {
                key: 'verified',
                count: vb.verified ?? 0,
                label: getVerdictDisplay('verified', lang).label,
                colorHex: '#10b981',
                barClass: 'bg-emerald-500',
                pillClass:
                  'bg-emerald-50 dark:bg-emerald-950/70 border-emerald-200/80 dark:border-emerald-800/80 text-emerald-700 dark:text-emerald-300',
              },
              {
                key: 'metadata_error',
                count: vb.metadata_error ?? 0,
                label: getVerdictDisplay('metadata_error', lang).label,
                colorHex: '#f59e0b',
                barClass: 'bg-amber-500',
                pillClass:
                  'bg-amber-50 dark:bg-amber-950/70 border-amber-200/80 dark:border-amber-800/80 text-amber-800 dark:text-amber-300',
              },
              {
                key: 'incomplete_metadata',
                count: vb.incomplete_metadata ?? 0,
                label:
                  lang === 'vi'
                    ? 'Thiếu quy cách trích dẫn'
                    : 'Incomplete Reference',
                colorHex: '#fb923c',
                barClass: 'bg-orange-400',
                pillClass:
                  'bg-orange-50 dark:bg-orange-950/70 border-orange-200/80 dark:border-orange-800/80 text-orange-700 dark:text-orange-300',
              },
              {
                key: 'suspected_hallucination',
                count: vb.suspected_hallucination ?? 0,
                label: getVerdictDisplay('suspected_hallucination', lang).label,
                colorHex: '#f43f5e',
                barClass: 'bg-rose-500',
                pillClass:
                  'bg-rose-50 dark:bg-rose-950/70 border-rose-200/80 dark:border-rose-800/80 text-rose-700 dark:text-rose-300',
              },
              {
                key: 'unresolved',
                count: vb.unresolved ?? 0,
                label: lang === 'vi' ? 'Chưa đủ dữ liệu' : 'Unresolved',
                colorHex: '#94a3b8',
                barClass: 'bg-slate-400',
                pillClass:
                  'bg-slate-100 dark:bg-slate-800/90 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300',
              },
              {
                key: 'resource',
                count: vb.resource ?? 0,
                label: getVerdictDisplay('resource', lang).label,
                colorHex: '#8b5cf6',
                barClass: 'bg-violet-500',
                pillClass:
                  'bg-violet-50 dark:bg-violet-950/70 border-violet-200/80 dark:border-violet-800/80 text-violet-700 dark:text-violet-300',
              },
            ];
            const totalVerdicts = breakdownItems.reduce(
              (sum, item) => sum + item.count,
              0,
            );
            const showBreakdown =
              totalVerdicts > 0 ||
              (analytics.total_essays ?? 0) > 0 ||
              essays.length > 0;
            if (!showBreakdown) return null;

            return (
              <div
                data-testid="cohort-verdict-breakdown"
                className="px-4 sm:px-5 pt-4 sm:pt-5"
              >
                <div className="p-4 rounded-2xl bg-slate-50/80 dark:bg-slate-950/60 border border-slate-200/80 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center gap-4">
                  <DonutChart
                    size={76}
                    thickness={10}
                    segments={
                      totalVerdicts > 0
                        ? breakdownItems.map((b) => ({
                            value: b.count,
                            color: b.colorHex,
                          }))
                        : [{ value: 1, color: '#cbd5e1' }]
                    }
                    centerContent={
                      <span className="text-sm font-bold font-mono tabular-nums text-slate-800 dark:text-slate-100">
                        {totalVerdicts}
                      </span>
                    }
                  />
                  <div className="flex-1 min-w-0 space-y-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                        {lang === 'vi'
                          ? 'Phân bổ kết quả trích dẫn toàn lớp'
                          : 'Class Citation Breakdown'}
                      </p>
                      <span className="text-xs text-slate-500 dark:text-slate-400">
                        {totalVerdicts}{' '}
                        {lang === 'vi'
                          ? 'trích dẫn'
                          : totalVerdicts === 1
                            ? 'citation'
                            : 'citations'}
                      </span>
                    </div>
                    {totalVerdicts > 0 && (
                      <div className="h-2.5 w-full rounded-full bg-slate-200/70 dark:bg-slate-800 overflow-hidden flex">
                        {breakdownItems
                          .filter((item) => item.count > 0)
                          .map((item) => (
                            <div
                              key={item.key}
                              style={{
                                width: `${(item.count / totalVerdicts) * 100}%`,
                              }}
                              title={`${item.label}: ${item.count}`}
                              className={`${item.barClass} h-full transition-all`}
                            />
                          ))}
                      </div>
                    )}
                    <div className="flex flex-wrap gap-1.5">
                      {breakdownItems.map((item) => (
                        <span
                          key={item.key}
                          data-testid={`verdict-breakdown-pill-${item.key}`}
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs ${item.pillClass}`}
                        >
                          <span className={`w-2 h-2 rounded-full ${item.barClass}`} />
                          <span>{item.label}:</span>
                          <span className="font-bold font-mono tabular-nums">
                            {item.count}
                          </span>
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}

          <div className="p-4 sm:p-5 grid grid-cols-1 lg:grid-cols-12 gap-5">
            {/* Left: Visual Grade Histogram & Natural-Language Issue Bars */}
            <div className="lg:col-span-5 space-y-4">
              {(() => {
                const dist = analytics.cis_distribution ?? {};
                const bands = [
                  {
                    key: 'A',
                    range: '≥ 85',
                    count: dist.excellent ?? 0,
                    barClass: 'bg-emerald-500',
                    textClass: 'text-emerald-700 dark:text-emerald-300',
                  },
                  {
                    key: 'B',
                    range: '70–84',
                    count: dist.good ?? 0,
                    barClass: 'bg-indigo-500',
                    textClass: 'text-indigo-700 dark:text-indigo-300',
                  },
                  {
                    key: 'C',
                    range: '50–69',
                    count: dist.fair ?? 0,
                    barClass: 'bg-amber-500',
                    textClass: 'text-amber-700 dark:text-amber-300',
                  },
                  {
                    key: 'D',
                    range: '< 50',
                    count: dist.poor ?? 0,
                    barClass: 'bg-rose-500',
                    textClass: 'text-rose-700 dark:text-rose-300',
                  },
                ];
                const maxBand = Math.max(1, ...bands.map((b) => b.count));

                return (
                  <div className="p-4 rounded-2xl bg-slate-50/80 dark:bg-slate-950/60 border border-slate-200/80 dark:border-slate-800">
                    <p className="text-xs font-semibold text-slate-700 dark:text-slate-200 mb-3">
                      {lang === 'vi'
                        ? 'Phân bố mức điểm tin cậy (A – D)'
                        : 'Score Band Distribution (A – D)'}
                    </p>
                    <div className="grid grid-cols-4 gap-2.5 items-end pt-2">
                      {bands.map((b) => {
                        const heightPct =
                          b.count > 0 ? Math.max(18, (b.count / maxBand) * 100) : 6;
                        return (
                          <div
                            key={b.key}
                            className="flex flex-col items-center gap-1.5"
                          >
                            <span
                              className={`text-sm font-bold font-mono tabular-nums ${b.textClass}`}
                            >
                              {b.count}
                            </span>
                            <div className="w-full h-16 rounded-xl bg-slate-200/60 dark:bg-slate-800/80 flex items-end p-1">
                              <div
                                style={{
                                  height: `${heightPct}%`,
                                  transition:
                                    'height 420ms cubic-bezier(0.22, 1, 0.36, 1)',
                                }}
                                className={`w-full rounded-lg ${b.barClass}`}
                              />
                            </div>
                            <div className="text-center">
                              <p className="text-xs font-bold text-slate-800 dark:text-slate-200">
                                {b.key}
                              </p>
                              <p className="text-[10px] font-mono text-slate-400">
                                {b.range}
                              </p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}

              {/* BUG-01: Filtered Top Citation Issues with clean full-text wrapping */}
              <div
                data-testid="top-citation-issues-card"
                className="p-4 rounded-2xl bg-slate-50/80 dark:bg-slate-950/60 border border-slate-200/80 dark:border-slate-800"
              >
                <p className="text-xs font-semibold text-slate-700 dark:text-slate-200 mb-2.5">
                  {lang === 'vi'
                    ? 'Lỗi trích dẫn thường gặp nhất trong lớp'
                    : 'Most Common Citation Issues'}
                </p>
                {filteredTopIssueRules.length === 0 ? (
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {lang === 'vi'
                      ? 'Chưa ghi nhận lỗi trích dẫn phổ biến nào.'
                      : 'No recurring citation issues detected yet.'}
                  </p>
                ) : (
                  <div className="space-y-2">
                    {(() => {
                      const maxRuleCount = Math.max(
                        1,
                        ...filteredTopIssueRules.map((r) => r.count),
                      );
                      return filteredTopIssueRules.map((r) => {
                        const pct = Math.min(
                          100,
                          Math.max(0, (r.count / maxRuleCount) * 100),
                        );
                        return (
                          <div
                            key={r.rule_id}
                            data-testid={`top-issue-rule-${r.rule_id}`}
                            className="p-3 rounded-xl bg-white dark:bg-slate-900/70 border border-slate-200/80 dark:border-slate-800 space-y-2"
                          >
                            <div className="flex items-start justify-between gap-2.5 text-xs">
                              <span className="font-medium text-slate-800 dark:text-slate-200 min-w-0 flex-1 break-words leading-snug">
                                {r.label}
                              </span>
                              <span className="px-2 py-0.5 rounded-md bg-slate-50 dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700 font-mono text-xs font-semibold tabular-nums text-slate-800 dark:text-slate-100 shrink-0">
                                ×{r.count}
                              </span>
                            </div>
                            <div className="h-2 w-full rounded-full bg-slate-200/70 dark:bg-slate-800 overflow-hidden">
                              <div
                                style={{
                                  width: `${pct.toFixed(1)}%`,
                                  transition:
                                    'width 420ms cubic-bezier(0.22, 1, 0.36, 1)',
                                }}
                                className="h-full rounded-full bg-amber-500"
                              />
                            </div>
                          </div>
                        );
                      });
                    })()}
                  </div>
                )}
              </div>
            </div>

            {/* Right: Shared Flagged Citations Across Students */}
            <div className="lg:col-span-7 p-4 rounded-2xl bg-slate-50/80 dark:bg-slate-950/60 border border-slate-200/80 dark:border-slate-800 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between gap-2 mb-3">
                  <p className="text-xs font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
                    <AlertTriangle className="h-3.5 w-3.5 text-rose-500" />
                    {lang === 'vi'
                      ? 'Nguồn cần rà soát xuất hiện ở các bài nộp'
                      : 'Flagged Citations Across Submissions'}
                  </p>
                  <span className="text-xs text-slate-400">
                    {(analytics.shared_hallucinations ?? []).length}{' '}
                    {lang === 'vi'
                      ? 'mục'
                      : (analytics.shared_hallucinations ?? []).length === 1
                        ? 'item'
                        : 'items'}
                  </span>
                </div>

                {(analytics.shared_hallucinations ?? []).length === 0 ? (
                  <div className="py-10 text-center text-xs text-slate-400">
                    {lang === 'vi'
                      ? 'Chưa phát hiện trích dẫn cần chú ý trùng lặp nào giữa các bài nộp.'
                      : 'No shared or repeated citation warnings detected across this class.'}
                  </div>
                ) : (
                  <div className="space-y-2.5 max-h-64 overflow-y-auto pr-1">
                    {(analytics.shared_hallucinations ?? []).map((item, idx) => {
                      const verdictDisplay = getVerdictDisplay(item.label, lang);
                      const resolvedStudentNames = Array.from(
                        new Set(
                          item.students.map((raw) => {
                            const trimmed = raw.trim();
                            return (
                              studentNameByUsername.get(trimmed.toLowerCase()) ||
                              formatStudentDisplayName(undefined, trimmed)
                            );
                          }),
                        ),
                      );
                      return (
                        <div
                          key={idx}
                          className={`p-3.5 rounded-xl border text-xs ${
                            item.is_shared
                              ? 'bg-rose-50/70 dark:bg-rose-950/30 border-rose-200 dark:border-rose-800/80'
                              : 'bg-white dark:bg-slate-900 border-slate-200/80 dark:border-slate-800'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2 mb-1.5 flex-wrap">
                            <span
                              className={`px-2 py-0.5 rounded-md border text-[11px] font-semibold ${verdictDisplay.badgeClass}`}
                            >
                              {verdictDisplay.label}
                            </span>
                            <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                              {item.is_shared
                                ? lang === 'vi'
                                  ? `Trùng ở ${item.essay_ids.length} bài · ${resolvedStudentNames.join(', ')}`
                                  : `Shared in ${item.essay_ids.length} papers · ${resolvedStudentNames.join(', ')}`
                                : resolvedStudentNames.join(', ')}
                            </span>
                          </div>
                          <p className="font-serif text-xs text-slate-800 dark:text-slate-200 line-clamp-2 break-words">
                            &ldquo;{item.citation_raw}&rdquo;
                          </p>
                          {item.essay_ids && item.essay_ids.length > 0 && (
                            <div className="flex flex-wrap items-center gap-1.5 mt-2 pt-2 border-t border-slate-200/60 dark:border-slate-800/80">
                              <span className="text-[11px] text-slate-400">
                                {lang === 'vi' ? 'Mở báo cáo:' : 'Reports:'}
                              </span>
                              {item.essay_ids.map((eid) => (
                                <Link
                                  key={eid}
                                  to={`/verification/report/${eid}`}
                                  data-testid={`shared-hallucination-essay-link-${eid}`}
                                  className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-md bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/70 dark:hover:bg-indigo-900/70 border border-indigo-200/80 dark:border-indigo-800/80 font-mono text-[11px] font-semibold text-indigo-700 dark:text-indigo-300 transition-colors"
                                >
                                  #{eid}
                                  <ExternalLink className="h-2.5 w-2.5" />
                                </Link>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Students Roster */}
      <section className="rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm overflow-hidden">
        <StudioWindowHeader
          title={lang === 'vi' ? 'DANH SÁCH SINH VIÊN' : 'STUDENTS'}
          badge={
            <Badge variant="secondary" className="font-mono text-[11px]">
              {students.length}
            </Badge>
          }
          rightSlot={
            <Button
              size="sm"
              onClick={() => setAddOpen(true)}
              className="gap-1.5 rounded-xl h-8 text-xs"
            >
              <UserPlus className="h-3.5 w-3.5" />
              {t('teacher.addStudent')}
            </Button>
          }
        />

        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          {students.length === 0 ? (
            <div className="p-10 text-center space-y-1">
              <Users className="h-6 w-6 text-slate-300 dark:text-slate-600 mx-auto mb-1" />
              <p className="text-sm text-slate-500">{t('teacher.noStudentsYet')}</p>
            </div>
          ) : (
            students.map((s) => {
              const displayName = formatStudentDisplayName(s.full_name, s.username);
              const secondaryMeta = s.full_name
                ? s.email?.trim() || `@${s.username}`
                : s.email?.trim() || '';
              return (
                <div
                  key={s.id}
                  className="flex items-center justify-between px-5 py-3.5 hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-8 h-8 rounded-full bg-indigo-50 dark:bg-indigo-950/80 border border-indigo-200/70 dark:border-indigo-800/70 flex items-center justify-center text-xs font-bold text-indigo-700 dark:text-indigo-300 shrink-0 uppercase">
                      {displayName.slice(0, 1)}
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium text-sm text-slate-900 dark:text-slate-100 truncate">
                        {displayName}
                      </p>
                      {secondaryMeta && (
                        <p className="text-xs text-slate-500 truncate">
                          {secondaryMeta}
                        </p>
                      )}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setPendingRemove(s)}
                    aria-label={
                      lang === 'vi' ? `Xóa ${s.username} khỏi lớp` : `Remove ${s.username}`
                    }
                    className="text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:hover:bg-rose-950/30 rounded-lg"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              );
            })
          )}
        </div>
      </section>

      {/* Class Submissions — Search, Status Filter, Sort & Empty Onboarding */}
      <section
        id="class-submissions-section"
        ref={submissionsSectionRef}
        className="rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm overflow-hidden"
      >
        <StudioWindowHeader
          title={lang === 'vi' ? 'BÀI NỘP CỦA LỚP' : 'CLASS SUBMISSIONS'}
          badge={
            <Badge variant="secondary" className="font-mono text-[11px]">
              {essays.length > 0 && filteredAndSortedEssays.length !== essays.length
                ? `${filteredAndSortedEssays.length} / ${essays.length}`
                : essays.length}
            </Badge>
          }
        />

        {essays.length > 0 && (
          <div className="px-4 sm:px-5 py-3 bg-slate-50/60 dark:bg-slate-950/40 border-b border-slate-200/80 dark:border-slate-800 space-y-2.5">
            <div className="flex flex-col sm:flex-row sm:items-center gap-2.5">
              {/* Search by filename / student */}
              <div className="relative flex-1 min-w-0">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 pointer-events-none" />
                <Input
                  type="text"
                  value={submissionSearch}
                  onChange={(e) => setSubmissionSearch(e.target.value)}
                  data-testid="class-submissions-search"
                  placeholder={
                    lang === 'vi'
                      ? 'Tìm theo tên tệp hoặc sinh viên…'
                      : 'Search by filename or student…'
                  }
                  aria-label={
                    lang === 'vi' ? 'Tìm kiếm bài nộp trong lớp' : 'Search class submissions'
                  }
                  className="h-9 pl-9 pr-8 text-xs rounded-xl bg-white dark:bg-slate-900"
                />
                {submissionSearch && (
                  <button
                    type="button"
                    onClick={() => setSubmissionSearch('')}
                    aria-label={lang === 'vi' ? 'Xóa tìm kiếm' : 'Clear search'}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 rounded text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>

              {/* Sort dropdown */}
              <div className="relative sm:w-56 shrink-0">
                <ArrowUpDown className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 pointer-events-none" />
                <select
                  value={submissionSort}
                  onChange={(e) =>
                    setSubmissionSort(e.target.value as SubmissionSortOrder)
                  }
                  data-testid="class-submissions-sort"
                  aria-label={lang === 'vi' ? 'Sắp xếp bài nộp' : 'Sort submissions'}
                  className="h-9 w-full pl-8 pr-8 rounded-xl border border-input bg-white dark:bg-slate-900 text-xs font-medium text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
                >
                  <option value="newest">
                    {lang === 'vi' ? 'Mới nộp nhất' : 'Newest first'}
                  </option>
                  <option value="cis_asc">
                    {lang === 'vi'
                      ? 'CIS thấp → cao (ưu tiên chấm)'
                      : 'CIS Low → High (priority)'}
                  </option>
                  <option value="cis_desc">
                    {lang === 'vi' ? 'CIS cao → thấp' : 'CIS High → Low'}
                  </option>
                </select>
              </div>
            </div>

            {/* Interactive status filter pills */}
            <div
              role="group"
              data-testid="class-submissions-status-filter"
              aria-label={lang === 'vi' ? 'Lọc theo trạng thái bài nộp' : 'Filter by submission status'}
              className="flex flex-wrap items-center gap-1.5"
            >
              {(
                [
                  {
                    key: 'all' as SubmissionStatusFilter,
                    label: lang === 'vi' ? 'Tất cả' : 'All',
                    count: submissionStatusCounts.total,
                  },
                  {
                    key: 'completed' as SubmissionStatusFilter,
                    label: lang === 'vi' ? 'Hoàn tất' : 'Completed',
                    count: submissionStatusCounts.completed,
                  },
                  {
                    key: 'low_cis' as SubmissionStatusFilter,
                    label: lang === 'vi' ? 'CIS < 70' : 'CIS < 70',
                    count: submissionStatusCounts.lowCis,
                  },
                  {
                    key: 'processing' as SubmissionStatusFilter,
                    label: lang === 'vi' ? 'Đang xử lý' : 'In Progress',
                    count: submissionStatusCounts.processing,
                  },
                  {
                    key: 'failed' as SubmissionStatusFilter,
                    label: lang === 'vi' ? 'Lỗi xử lý' : 'Failed',
                    count: submissionStatusCounts.failed,
                  },
                ] as const
              )
                .filter((opt) => opt.key === 'all' || opt.count > 0 || submissionStatusFilter === opt.key)
                .map((opt) => {
                  const active = submissionStatusFilter === opt.key;
                  return (
                    <button
                      key={opt.key}
                      type="button"
                      data-testid={`class-submission-filter-${opt.key}`}
                      aria-pressed={active}
                      onClick={() => setSubmissionStatusFilter(opt.key)}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                        active
                          ? 'bg-indigo-600 text-white shadow-sm'
                          : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                      }`}
                    >
                      <span>{opt.label}</span>
                      <span
                        className={`font-mono text-[11px] ${
                          active ? 'text-indigo-100' : 'text-slate-400'
                        }`}
                      >
                        {opt.count}
                      </span>
                    </button>
                  );
                })}
            </div>
          </div>
        )}

        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          {essays.length === 0 ? (
            <div
              data-testid="empty-class-onboarding"
              className="p-6 sm:p-8 space-y-5"
            >
              <div className="text-center space-y-1">
                <FileText className="h-7 w-7 text-indigo-400 dark:text-indigo-500 mx-auto mb-1.5" />
                <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                  {t('teacher.noSubmissionsYet')}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {lang === 'vi'
                    ? 'Thực hiện 3 bước sau để bắt đầu thu nhận và rà soát bài nộp của lớp:'
                    : 'Follow these 3 quick steps to start receiving and reviewing student essays:'}
                </p>
              </div>

              <ol className="grid grid-cols-1 md:grid-cols-3 gap-3 text-left">
                <li className="p-4 rounded-xl bg-slate-50/90 dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-800 space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className="w-6 h-6 rounded-full bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 font-mono text-xs font-bold flex items-center justify-center shrink-0">
                      1
                    </span>
                    <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                      {lang === 'vi' ? 'Sao chép mã lớp' : 'Copy class join code'}
                    </p>
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                    {lang === 'vi'
                      ? 'Gửi mã tham gia cho sinh viên hoặc thêm trực tiếp ở danh sách sinh viên phía trên.'
                      : 'Share the join code with your students or enroll them manually above.'}
                  </p>
                  {cls.join_code && (
                    <button
                      type="button"
                      onClick={() => void handleCopyJoinCode()}
                      className="mt-1 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/70 dark:hover:bg-emerald-900/70 border border-emerald-200 dark:border-emerald-800 text-xs font-mono font-semibold text-emerald-700 dark:text-emerald-300 cursor-pointer"
                    >
                      {copiedCode ? (
                        <Check className="h-3 w-3" />
                      ) : (
                        <Copy className="h-3 w-3" />
                      )}
                      <span>{cls.join_code}</span>
                    </button>
                  )}
                </li>

                <li className="p-4 rounded-xl bg-slate-50/90 dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-800 space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className="w-6 h-6 rounded-full bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 font-mono text-xs font-bold flex items-center justify-center shrink-0">
                      2
                    </span>
                    <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                      {lang === 'vi' ? 'Sinh viên tải bài lên' : 'Students upload essays'}
                    </p>
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                    {lang === 'vi'
                      ? 'Sinh viên tham gia bằng mã lớp và tải tệp PDF, DOCX, BibTeX hoặc RIS lên hệ thống.'
                      : 'Students join using the code and submit PDF, DOCX, BibTeX, or RIS manuscripts.'}
                  </p>
                </li>

                <li className="p-4 rounded-xl bg-slate-50/90 dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-800 space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className="w-6 h-6 rounded-full bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 font-mono text-xs font-bold flex items-center justify-center shrink-0">
                      3
                    </span>
                    <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                      {lang === 'vi' ? 'Theo dõi kết quả tại đây' : 'Track results here'}
                    </p>
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                    {lang === 'vi'
                      ? 'Điểm tin cậy trích dẫn (CIS), các lỗi thường gặp và báo cáo chi tiết sẽ hiển thị tự động.'
                      : 'CIS scores, recurring citation issues, and exportable CSV/ZIP reports appear automatically.'}
                  </p>
                </li>
              </ol>
            </div>
          ) : filteredAndSortedEssays.length === 0 ? (
            <div className="p-10 text-center space-y-3">
              <p className="text-sm text-slate-600 dark:text-slate-300">
                {lang === 'vi'
                  ? 'Không tìm thấy bài nộp phù hợp với bộ lọc hiện tại.'
                  : 'No submissions match your current search or filter.'}
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setSubmissionSearch('');
                  setSubmissionStatusFilter('all');
                }}
                className="gap-1.5 rounded-xl"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                {lang === 'vi' ? 'Đặt lại bộ lọc' : 'Reset Filters'}
              </Button>
            </div>
          ) : (
            filteredAndSortedEssays.map((e) => {
              const status = (e.job_status ?? 'completed').toLowerCase();
              const isQueuedOrProcessing =
                status === 'queued' || status === 'processing';
              const isFailed = status === 'failed';
              const targetHref =
                isQueuedOrProcessing || isFailed
                  ? `/verification/processing/${e.id}`
                  : `/verification/report/${e.id}`;
              const cisVal =
                e.cis_score != null && Number.isFinite(Number(e.cis_score))
                  ? Number(e.cis_score)
                  : null;
              const resolvedFullName =
                (e.user_id != null ? studentNameById.get(e.user_id) : undefined) ||
                (e.username
                  ? studentNameByUsername.get(e.username.trim().toLowerCase())
                  : undefined);
              const studentDisplay = formatStudentDisplayName(
                resolvedFullName,
                e.username,
              );

              return (
                <Link
                  key={e.id}
                  to={targetHref}
                  data-testid={`class-essay-row-${e.id}`}
                  title={isFailed && e.job_error ? e.job_error : undefined}
                  className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 hover:bg-slate-50 dark:hover:bg-slate-800/50 focus-visible:outline-none focus-visible:bg-slate-50 dark:focus-visible:bg-slate-800/50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 transition-colors group"
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <FileFormatIcon filename={e.filename} size="sm" />
                    <div className="min-w-0">
                      <p className="font-medium text-sm text-slate-900 dark:text-slate-100 break-words sm:truncate group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                        {e.filename}
                      </p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {studentDisplay} • {e.num_pages}{' '}
                        {lang === 'vi'
                          ? 'trang'
                          : e.num_pages === 1
                            ? 'page'
                            : 'pages'}
                        {e.uploaded_at
                          ? ` • ${formatLocalizedDate(e.uploaded_at, lang)}`
                          : ''}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2.5 min-w-0 max-w-full">
                    {isQueuedOrProcessing ? (
                      <>
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-amber-50 dark:bg-amber-950/80 border border-amber-200/80 dark:border-amber-800/80 text-xs font-medium text-amber-700 dark:text-amber-300">
                          <Loader2 className="h-3 w-3 animate-spin" />
                          {status === 'queued'
                            ? lang === 'vi'
                              ? 'Đang chờ'
                              : 'Queued'
                            : lang === 'vi'
                              ? 'Đang xử lý'
                              : 'Processing'}
                        </span>
                        <span className="text-xs text-indigo-600 dark:text-indigo-400 font-medium">
                          {lang === 'vi' ? 'Xem tiến độ' : 'View Progress'}
                        </span>
                      </>
                    ) : isFailed ? (
                      <>
                        <span
                          title={e.job_error ?? undefined}
                          className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-rose-50 dark:bg-rose-950/80 border border-rose-200/80 dark:border-rose-800/80 text-xs font-medium text-rose-700 dark:text-rose-300"
                        >
                          <AlertCircle className="h-3 w-3" />
                          {lang === 'vi' ? 'Thất bại' : 'Failed'}
                        </span>
                        {e.quota_charged === false && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/80 border border-emerald-200/80 dark:border-emerald-800/80 text-xs font-medium text-emerald-700 dark:text-emerald-300">
                            {lang === 'vi' ? 'Đã hoàn lượt' : 'Credit Refunded'}
                          </span>
                        )}
                        <span className="text-xs text-indigo-600 dark:text-indigo-400 font-medium">
                          {lang === 'vi' ? 'Thử lại' : 'Retry'}
                        </span>
                      </>
                    ) : (
                      <>
                        {cisVal !== null && (
                          <div className="inline-flex items-center gap-2">
                            <ScoreRing
                              value={cisVal}
                              size={28}
                              thickness={3.2}
                              color={
                                cisVal >= 85
                                  ? '#10b981'
                                  : cisVal >= 70
                                    ? '#6366f1'
                                    : cisVal >= 50
                                      ? '#f59e0b'
                                      : '#f43f5e'
                              }
                            />
                            <span className="text-xs font-mono font-bold text-slate-800 dark:text-slate-200 tabular-nums whitespace-nowrap">
                              CIS {formatCisScore(cisVal)}
                            </span>
                          </div>
                        )}
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/80 border border-emerald-200/80 dark:border-emerald-800/80 text-xs font-medium text-emerald-700 dark:text-emerald-300">
                          <Check className="h-3 w-3" />
                          {lang === 'vi' ? 'Hoàn tất' : 'Completed'}
                        </span>
                      </>
                    )}
                    <ExternalLink className="h-4 w-4 text-slate-400 group-hover:text-indigo-500 shrink-0 transition-colors" />
                  </div>
                </Link>
              );
            })
          )}
        </div>
      </section>

      <AddStudentDialog
        open={addOpen}
        classId={cid}
        existingStudentIds={students.map((s) => s.id)}
        onClose={() => setAddOpen(false)}
        onAdded={load}
      />

      <ConfirmationModal
        isOpen={pendingRemove !== null}
        title={t('teacher.removeStudentTitle')}
        message={
          pendingRemove
            ? t('teacher.removeStudentConfirm', {
                username: pendingRemove.username,
                className: cls.name,
              })
            : ''
        }
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        variant="danger"
        onConfirm={handleRemove}
        onCancel={() => setPendingRemove(null)}
      />

      {/* BUG-23: Explicit confirmation before regenerating class join code */}
      <ConfirmationModal
        isOpen={confirmRegenerateOpen}
        title={
          lang === 'vi'
            ? 'Tạo mã tham gia lớp mới?'
            : 'Generate a new class join code?'
        }
        message={
          lang === 'vi'
            ? `Mã hiện tại (${cls.join_code ?? ''}) sẽ ngừng hoạt động ngay lập tức đối với sinh viên mới. Sinh viên đã tham gia lớp vẫn được giữ nguyên.`
            : `The current code (${cls.join_code ?? ''}) will immediately stop working for new students. Already-enrolled students will not be affected.`
        }
        confirmLabel={lang === 'vi' ? 'Tạo mã mới' : 'Generate New Code'}
        cancelLabel={t('common.cancel')}
        variant="danger"
        onConfirm={() => void handleRegenerateCode()}
        onCancel={() => setConfirmRegenerateOpen(false)}
      />

      {/* BUG-11 & BUG-54: Portaled Edit Class modal with top-right close × button */}
      {editOpen &&
        createPortal(
          <div
            className="fixed inset-0 !mt-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
            onClick={() => {
              if (!savingEdit) setEditOpen(false);
            }}
          >
            <div
              {...editClassDialog.dialogProps}
              className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 max-w-md w-full max-h-[90dvh] overflow-y-auto p-5 shadow-2xl space-y-4 outline-none"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between gap-3">
                <h2
                  id={editClassDialog.titleId}
                  className="font-display text-lg font-bold text-slate-900 dark:text-white"
                >
                  {lang === 'vi' ? 'Chỉnh sửa lớp học' : 'Edit Class'}
                </h2>
                <button
                  type="button"
                  data-testid="edit-class-close-btn"
                  onClick={() => setEditOpen(false)}
                  disabled={savingEdit}
                  aria-label={t('teacher.closeModal')}
                  className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer disabled:opacity-50"
                >
                  <X className="h-5 w-5 text-slate-500" />
                </button>
              </div>
              <form onSubmit={(e) => void handleSaveEdit(e)} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="edit-class-name">
                    {t('teacher.classNameLabel')}{' '}
                    <span className="text-rose-500">*</span>
                  </Label>
                  <Input
                    id="edit-class-name"
                    data-testid="edit-class-name-input"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    required
                    maxLength={120}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="edit-class-desc">
                    {t('teacher.classDescriptionLabel')}
                  </Label>
                  <Textarea
                    id="edit-class-desc"
                    data-testid="edit-class-desc-input"
                    value={editDescription}
                    onChange={(e) => setEditDescription(e.target.value)}
                    maxLength={1000}
                    rows={3}
                  />
                </div>
                <div className="flex justify-end gap-2 pt-1">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setEditOpen(false)}
                    disabled={savingEdit}
                  >
                    {t('common.cancel')}
                  </Button>
                  <Button
                    type="submit"
                    data-testid="save-edit-class-btn"
                    disabled={savingEdit || !editName.trim()}
                  >
                    {savingEdit ? t('common.loading') : t('common.save')}
                  </Button>
                </div>
              </form>
            </div>
          </div>,
          document.body,
        )}

      <ConfirmationModal
        isOpen={confirmDeleteOpen}
        title={lang === 'vi' ? 'Xóa lớp học' : 'Delete Class'}
        message={
          lang === 'vi'
            ? `Bạn có chắc muốn xóa vĩnh viễn lớp "${cls.name}"? Các bài luận đã nộp của sinh viên vẫn được bảo toàn.`
            : `Permanently delete "${cls.name}"? Student essays remain intact.`
        }
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        variant="danger"
        onConfirm={() => void handleDeleteClass()}
        onCancel={() => setConfirmDeleteOpen(false)}
      />

      <UpgradeModal
        open={upgradeOpen}
        onOpenChange={setUpgradeOpen}
        featureName="Class ZIP Export"
      />
    </div>
  );
}
