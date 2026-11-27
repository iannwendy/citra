import { useEffect, useState, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  GraduationCap,
  Plus,
  Users,
  FileCheck,
  ClipboardCheck,
  ChevronRight,
  AlertCircle,
  LogOut,
  Trash2,
  Copy,
  Check,
  KeyRound,
  X,
} from 'lucide-react';
import { api, type Class, type TeacherDashboard } from '@/api/client';
import { formatUserError, resolveAcademicLang } from '@/lib/academicTaxonomy';
import { useAuth } from '@/contexts/AuthContext';
import { useModalA11y } from '@/hooks/useModalA11y';
import { useToast } from '@/contexts/ToastContext';
import { CreateClassDialog } from '@/components/CreateClassDialog';
import { ConfirmationModal } from '@/components/ConfirmationModal';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { StudioWindowHeader } from '@/components/ui/studio-visuals';
import {
  CardHoverTilt,
  NumberPopIn,
  TextMorph,
} from '@/components/ui/transitions';

type ClassWithInstructorMeta = Class & {
  teacher_full_name?: string | null;
  teacher_name?: string | null;
};

function getInstructorDisplayName(c: ClassWithInstructorMeta): string {
  const fullName = c.teacher_full_name?.trim() || c.teacher_name?.trim();
  if (fullName) return fullName;
  return c.teacher_username || '—';
}

/**
 * MyClassesPage — Visual Classroom Hub for faculty.
 *
 * Combines above-the-fold cohort metrics, an interactive 2-column class card grid
 * with 1-click join-code copying, and direct triage entry into Pending Reviews.
 */
export function MyClassesPage() {
  const { t, i18n } = useTranslation();
  const lang = resolveAcademicLang(i18n.resolvedLanguage || i18n.language);
  const { user } = useAuth();
  const toast = useToast();
  const [dashboard, setDashboard] = useState<TeacherDashboard | null>(null);
  const [enrolledClasses, setEnrolledClasses] = useState<ClassWithInstructorMeta[]>([]);
  const [pendingLeaveClass, setPendingLeaveClass] = useState<ClassWithInstructorMeta | null>(null);
  const [pendingDeleteClass, setPendingDeleteClass] = useState<Class | null>(null);
  const [copiedClassId, setCopiedClassId] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const leaveClassDialog = useModalA11y<HTMLDivElement>(
    pendingLeaveClass !== null,
    () => setPendingLeaveClass(null),
  );

  const load = useCallback(async () => {
    const enrolledPromise =
      typeof api.listEnrolledClasses === 'function'
        ? api.listEnrolledClasses().catch(() => [])
        : Promise.resolve([]);
    try {
      const [data, enrolled] = await Promise.all([
        api.getTeacherDashboard(),
        enrolledPromise,
      ]);
      setDashboard(data);
      setEnrolledClasses(Array.isArray(enrolled) ? enrolled : []);
      setError('');
    } catch (e) {
      const enrolled = await enrolledPromise;
      setEnrolledClasses(Array.isArray(enrolled) ? enrolled : []);
      setError(
        formatUserError(
          e,
          lang,
          lang === 'vi' ? 'Không thể tải danh sách lớp học.' : 'Failed to load dashboard',
        ),
      );
    }
  }, [lang]);

  const handleClassCreated = useCallback(
    (created: Class) => {
      toast.success(
        lang === 'vi'
          ? `Đã tạo lớp "${created.name}" thành công`
          : `Created class "${created.name}"`,
        created.join_code
          ? lang === 'vi'
            ? `Mã tham gia lớp: ${created.join_code}`
            : `Join code: ${created.join_code}`
          : undefined,
      );
      void load();
    },
    [lang, load, toast],
  );

  const handleCopyCode = async (e: React.MouseEvent, c: Class) => {
    e.stopPropagation();
    if (!c.join_code) return;
    try {
      await navigator.clipboard?.writeText(c.join_code);
    } catch {
      // Ignore clipboard failures in headless environments
    }
    setCopiedClassId(c.id);
    toast.success(
      lang === 'vi'
        ? `Đã sao chép mã lớp ${c.join_code}`
        : `Copied join code ${c.join_code}`,
      c.name,
    );
    setTimeout(() => {
      setCopiedClassId((prev) => (prev === c.id ? null : prev));
    }, 1800);
  };

  const handleConfirmLeave = async () => {
    if (!pendingLeaveClass) return;
    const target = pendingLeaveClass;
    setPendingLeaveClass(null);
    try {
      await api.leaveClass(target.id);
      setEnrolledClasses((prev) => prev.filter((c) => c.id !== target.id));
      toast.success(
        lang === 'vi'
          ? `Đã rời khỏi lớp ${target.name}`
          : `Left class ${target.name}`,
      );
    } catch (e) {
      toast.error(
        formatUserError(
          e,
          lang,
          lang === 'vi' ? 'Không thể rời khỏi lớp học.' : 'Failed to leave class',
        ),
      );
    }
  };

  const handleConfirmDelete = async () => {
    if (!pendingDeleteClass) return;
    const target = pendingDeleteClass;
    setPendingDeleteClass(null);
    try {
      await api.deleteClass(target.id);
      toast.success(
        lang === 'vi'
          ? `Đã xóa lớp ${target.name}`
          : `Deleted class ${target.name}`,
      );
      void load();
    } catch (e) {
      toast.error(
        formatUserError(
          e,
          lang,
          lang === 'vi' ? 'Không thể xóa lớp học.' : 'Failed to delete class',
        ),
      );
    }
  };

  useEffect(() => {
    void load();
  }, [load]);

  // BUG-22: Never show classes owned/taught by the current teacher under Enrolled Classes
  const visibleEnrolledClasses = useMemo(() => {
    const ownedClassIds = new Set((dashboard?.classes ?? []).map((c) => c.id));
    return enrolledClasses.filter(
      (c) =>
        (user?.id == null || c.teacher_id !== user.id) &&
        !ownedClassIds.has(c.id),
    );
  }, [dashboard?.classes, enrolledClasses, user?.id]);

  const classCount = dashboard?.classes?.length ?? 0;

  return (
    <div className="space-y-5 pb-10">
      {/* Clean Classroom Header */}
      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 p-5 sm:p-6 shadow-sm flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3.5 min-w-0">
          <div className="w-11 h-11 rounded-2xl bg-indigo-50 dark:bg-indigo-950/80 border border-indigo-200/70 dark:border-indigo-800/70 flex items-center justify-center shrink-0">
            <GraduationCap className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2.5 flex-wrap">
              <h1 className="font-display text-2xl sm:text-3xl font-bold text-slate-900 dark:text-white tracking-tight">
                {t('teacher.myClasses')}
              </h1>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/70 border border-emerald-200/70 dark:border-emerald-800/70 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                {dashboard
                  ? lang === 'vi'
                    ? `${dashboard.total_classes} LỚP ĐANG HOẠT ĐỘNG`
                    : `${dashboard.total_classes} ACTIVE ${dashboard.total_classes === 1 ? 'CLASS' : 'CLASSES'}`
                  : lang === 'vi'
                    ? 'ĐANG ĐỒNG BỘ...'
                    : 'SYNCING...'}
              </span>
            </div>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
              {lang === 'vi'
                ? 'Quản lý danh sách sinh viên, mã tham gia và tiến độ nộp bài theo từng lớp.'
                : 'Manage student rosters, join codes, and citation health across your classes.'}
            </p>
          </div>
        </div>

        <Button
          onClick={() => setCreateOpen(true)}
          aria-label={t('teacher.createClass')}
          className="gap-2 rounded-xl shadow-sm shrink-0"
        >
          <Plus className="h-4 w-4" />
          {t('teacher.createClass')}
        </Button>
      </div>

      {error && (
        <Alert variant="destructive" className="rounded-2xl">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Visual Metric Cards (Zero numbered corner tags) */}
      {dashboard && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5 sm:gap-4">
          <Card className="p-4 sm:p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 shadow-sm">
            <div className="flex items-center gap-2.5 mb-2.5">
              <div className="p-2 rounded-xl bg-indigo-50 dark:bg-indigo-950/80 border border-indigo-200/60 dark:border-indigo-800/60">
                <GraduationCap className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
              </div>
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                {t('teacher.classes')}
              </span>
            </div>
            <p className="text-2xl sm:text-3xl font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
              <NumberPopIn value={dashboard.total_classes} />
            </p>
          </Card>

          <Card className="p-4 sm:p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 shadow-sm">
            <div className="flex items-center gap-2.5 mb-2.5">
              <div className="p-2 rounded-xl bg-emerald-50 dark:bg-emerald-950/80 border border-emerald-200/60 dark:border-emerald-800/60">
                <Users className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              </div>
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                {t('teacher.students')}
              </span>
            </div>
            <p className="text-2xl sm:text-3xl font-bold font-mono tabular-nums text-emerald-600 dark:text-emerald-400">
              <NumberPopIn value={dashboard.total_students} />
            </p>
          </Card>

          <Card className="p-4 sm:p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 shadow-sm">
            <div className="flex items-center gap-2.5 mb-2.5">
              <div className="p-2 rounded-xl bg-amber-50 dark:bg-amber-950/80 border border-amber-200/60 dark:border-amber-800/60">
                <FileCheck className="h-4 w-4 text-amber-600 dark:text-amber-400" />
              </div>
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                {t('teacher.submissions')}
              </span>
            </div>
            <p className="text-2xl sm:text-3xl font-bold font-mono tabular-nums text-amber-600 dark:text-amber-400">
              <NumberPopIn value={dashboard.total_essays} />
            </p>
          </Card>

          {dashboard.pending_reviews > 0 ? (
            <Link
              to="/teacher/reviews"
              data-testid="needs-review-kpi-link"
              className="block rounded-2xl focus:outline-none focus:ring-2 focus:ring-rose-500 group"
            >
              <Card className="p-4 sm:p-5 h-full rounded-2xl bg-rose-50/40 dark:bg-rose-950/20 border border-rose-200/90 dark:border-rose-800/80 hover:border-rose-400 dark:hover:border-rose-600 shadow-sm transition-colors">
                <div className="flex items-center justify-between gap-2 mb-2.5">
                  <div className="flex items-center gap-2">
                    <div className="p-2 rounded-xl bg-rose-100/80 dark:bg-rose-950/80 border border-rose-200/60 dark:border-rose-800/60">
                      <ClipboardCheck className="h-4 w-4 text-rose-600 dark:text-rose-400" />
                    </div>
                    <span className="text-xs font-semibold text-rose-700 dark:text-rose-300">
                      {t('teacher.needsReview')}
                    </span>
                  </div>
                  <ChevronRight className="h-4 w-4 text-rose-500 transition-transform group-hover:translate-x-0.5 shrink-0" />
                </div>
                <p className="text-2xl sm:text-3xl font-bold font-mono tabular-nums text-rose-600 dark:text-rose-400">
                  <NumberPopIn value={dashboard.pending_reviews} />
                </p>
              </Card>
            </Link>
          ) : (
            <Card className="p-4 sm:p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 shadow-sm">
              <div className="flex items-center gap-2.5 mb-2.5">
                <div className="p-2 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200/60 dark:border-slate-700">
                  <ClipboardCheck className="h-4 w-4 text-slate-500 dark:text-slate-400" />
                </div>
                <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                  {t('teacher.needsReview')}
                </span>
              </div>
              <p className="text-2xl sm:text-3xl font-bold font-mono tabular-nums text-slate-700 dark:text-slate-200">
                <NumberPopIn value={dashboard.pending_reviews} />
              </p>
            </Card>
          )}
        </div>
      )}

      {/* Visual Class Cards Studio */}
      <div className="rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm overflow-hidden">
        <StudioWindowHeader
          title={lang === 'vi' ? 'DANH SÁCH LỚP HỌC' : 'MY CLASSES'}
          badge={
            <Badge
              variant="secondary"
              className="font-mono text-[11px] bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300 border border-indigo-200/60 dark:border-indigo-800/60"
            >
              {lang === 'vi'
                ? `${classCount} lớp học`
                : `${classCount} ${classCount === 1 ? 'class' : 'classes'}`}
            </Badge>
          }
        />

        <div className="p-4 sm:p-5">
          {classCount === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 p-10 text-center">
              <p className="text-slate-700 dark:text-slate-300 font-medium">
                {t('teacher.noClassesYet')}
              </p>
              <p className="text-sm text-slate-500 mt-1">{t('teacher.noClassesHint')}</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {(dashboard?.classes ?? []).map((c: Class) => {
                const isCopied = copiedClassId === c.id;

                return (
                  <CardHoverTilt key={c.id} maxTilt={3.2} className="h-full">
                    <div
                      data-testid={`class-card-${c.id}`}
                      className="relative h-full w-full text-left rounded-2xl bg-slate-50/70 dark:bg-slate-800/40 border border-slate-200/90 dark:border-slate-800 p-4 sm:p-5 hover:bg-white dark:hover:bg-slate-800 hover:border-indigo-300 dark:hover:border-indigo-700 focus-within:ring-2 focus-within:ring-indigo-500 focus-within:border-indigo-400 transition-colors flex flex-col justify-between gap-4 group shadow-sm"
                    >
                      <div className="space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <h3 className="font-display font-bold text-base sm:text-lg text-slate-900 dark:text-white break-words">
                            <Link
                              to={`/teacher/classes/${c.id}`}
                              className="group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors focus-visible:outline-none rounded after:content-[''] after:absolute after:inset-0"
                            >
                              {c.name}
                            </Link>
                          </h3>
                          <div className="relative z-10 flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              data-testid={`delete-class-card-btn-${c.id}`}
                              title={lang === 'vi' ? 'Xóa lớp học' : 'Delete class'}
                              aria-label={
                                lang === 'vi'
                                  ? `Xóa lớp học ${c.name}`
                                  : `Delete class ${c.name}`
                              }
                              onClick={(e) => {
                                e.stopPropagation();
                                setPendingDeleteClass(c);
                              }}
                              className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/50 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                            <ChevronRight
                              aria-hidden="true"
                              className="h-4 w-4 text-slate-400 group-hover:text-indigo-500 transition-transform group-hover:translate-x-0.5 pointer-events-none"
                            />
                          </div>
                        </div>

                        {c.description && (
                          <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 line-clamp-2 break-words">
                            {c.description}
                          </p>
                        )}
                      </div>

                      <div className="space-y-3 pt-1">
                        {/* Explicit Student & Submission Counts */}
                        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white dark:bg-slate-900/70 border border-slate-200/80 dark:border-slate-700/80 text-slate-700 dark:text-slate-200 font-medium">
                            <Users className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                            <span className="font-mono font-semibold tabular-nums">
                              {c.student_count}
                            </span>
                            <span>
                              {lang === 'vi'
                                ? 'sinh viên'
                                : c.student_count === 1
                                  ? 'student'
                                  : 'students'}
                            </span>
                          </span>
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white dark:bg-slate-900/70 border border-slate-200/80 dark:border-slate-700/80 text-slate-700 dark:text-slate-200 font-medium">
                            <FileCheck className="h-3.5 w-3.5 text-indigo-500 shrink-0" />
                            <span className="font-mono font-semibold tabular-nums">
                              {c.essay_count}
                            </span>
                            <span>
                              {lang === 'vi'
                                ? 'bài nộp'
                                : c.essay_count === 1
                                  ? 'submission'
                                  : 'submissions'}
                            </span>
                          </span>
                        </div>

                        {/* Interactive Join Code Ticket Pill */}
                        {c.join_code && (
                          <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-200/70 dark:border-slate-700/70">
                            <span className="text-[11px] text-slate-500 dark:text-slate-400">
                              {lang === 'vi' ? 'Mã tham gia lớp' : 'Class Join Code'}
                            </span>
                            <button
                              type="button"
                              data-testid={`copy-class-code-${c.id}`}
                              onClick={(e) => void handleCopyCode(e, c)}
                              className="relative z-10 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-indigo-50/90 hover:bg-indigo-100 dark:bg-indigo-950/80 dark:hover:bg-indigo-900/70 border border-indigo-200/80 dark:border-indigo-800 text-xs font-mono font-semibold text-indigo-700 dark:text-indigo-300 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                            >
                              {isCopied ? (
                                <Check className="h-3 w-3 text-emerald-500" />
                              ) : (
                                <KeyRound className="h-3 w-3" />
                              )}
                              <TextMorph
                                text={
                                  isCopied
                                    ? lang === 'vi'
                                      ? 'Đã chép!'
                                      : 'Copied!'
                                    : c.join_code
                                }
                              />
                              {!isCopied && <Copy className="h-3 w-3 opacity-60" />}
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </CardHoverTilt>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {visibleEnrolledClasses.length > 0 && (
        <div
          data-testid="enrolled-classes-section"
          className="rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm overflow-hidden"
        >
          <StudioWindowHeader
            title={lang === 'vi' ? 'LỚP HỌC ĐÃ THAM GIA' : 'ENROLLED CLASSES'}
            badge={
              <Badge variant="secondary" className="font-mono text-[11px]">
                {visibleEnrolledClasses.length}
              </Badge>
            }
          />
          <div className="p-4 sm:p-5 space-y-3">
            {visibleEnrolledClasses.map((c) => (
              <div
                key={c.id}
                className="rounded-xl bg-slate-50/60 dark:bg-slate-800/40 border border-slate-200/90 dark:border-slate-800 p-4 flex flex-wrap items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <h3 className="font-display font-semibold text-sm sm:text-base text-slate-900 dark:text-white break-words">
                    {c.name}
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    {lang === 'vi' ? 'Giảng viên:' : 'Instructor:'}{' '}
                    {getInstructorDisplayName(c)}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  data-testid={`leave-class-btn-${c.id}`}
                  onClick={() => setPendingLeaveClass(c)}
                  className="gap-1.5 rounded-xl text-rose-600 border-rose-200 hover:bg-rose-50 dark:border-rose-800 dark:hover:bg-rose-950/50 text-xs"
                >
                  <LogOut className="h-3.5 w-3.5" />
                  {lang === 'vi' ? 'Rời lớp' : 'Leave Class'}
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {pendingLeaveClass &&
        createPortal(
          <div
            className="fixed inset-0 !mt-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
            onClick={() => setPendingLeaveClass(null)}
          >
            <div
              {...leaveClassDialog.dialogProps}
              className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 max-w-md w-full p-5 shadow-2xl space-y-4 outline-none"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between gap-3">
                <h3
                  id={leaveClassDialog.titleId}
                  className="font-display text-lg font-bold text-slate-900 dark:text-white"
                >
                  {lang === 'vi' ? 'Xác nhận rời lớp học' : 'Leave Class?'}
                </h3>
                <button
                  type="button"
                  onClick={() => setPendingLeaveClass(null)}
                  aria-label={t('teacher.closeModal')}
                  className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                >
                  <X className="h-5 w-5 text-slate-500" />
                </button>
              </div>
              <p className="text-sm text-slate-600 dark:text-slate-300">
                {lang === 'vi'
                  ? `Bạn có chắc muốn rời khỏi lớp "${pendingLeaveClass.name}"?`
                  : `Are you sure you want to leave "${pendingLeaveClass.name}"?`}
              </p>
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setPendingLeaveClass(null)}
                >
                  {t('common.cancel')}
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  data-testid="confirm-leave-class-btn"
                  onClick={() => void handleConfirmLeave()}
                >
                  {lang === 'vi' ? 'Rời lớp' : 'Leave Class'}
                </Button>
              </div>
            </div>
          </div>,
          document.body,
        )}

      <ConfirmationModal
        isOpen={pendingDeleteClass !== null}
        title={lang === 'vi' ? 'Xóa lớp học' : 'Delete Class'}
        message={
          pendingDeleteClass
            ? lang === 'vi'
              ? `Xóa vĩnh viễn lớp "${pendingDeleteClass.name}"? Các bài luận đã nộp vẫn được giữ nguyên cho sinh viên.`
              : `Permanently delete "${pendingDeleteClass.name}"? Student essays remain intact.`
            : ''
        }
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        variant="danger"
        onConfirm={() => void handleConfirmDelete()}
        onCancel={() => setPendingDeleteClass(null)}
      />

      <CreateClassDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={handleClassCreated}
      />
    </div>
  );
}
