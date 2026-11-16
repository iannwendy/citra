import { useEffect, useState, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  GraduationCap,
  Plus,
  Users,
  FileCheck,
  ClipboardCheck,
  ChevronRight,
  AlertCircle,
  Terminal,
  ShieldCheck,
  LogOut,
  Trash2,
} from 'lucide-react';
import { api, type Class, type TeacherDashboard } from '@/api/client';
import { useToast } from '@/contexts/ToastContext';
import { CreateClassDialog } from '@/components/CreateClassDialog';
import { ConfirmationModal } from '@/components/ConfirmationModal';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Alert, AlertDescription } from '@/components/ui/alert';

/**
 * MyClassesPage — teacher dashboard (Scholarly Precision shadcn/ui v2.0).
 *
 * Shows aggregate stats + class list. Click into a class to manage students
 * and essays (ClassDetailPage).
 */
export function MyClassesPage() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language?.startsWith('vi') ? 'vi' : 'en';
  const navigate = useNavigate();
  const toast = useToast();
  const [dashboard, setDashboard] = useState<TeacherDashboard | null>(null);
  const [enrolledClasses, setEnrolledClasses] = useState<Class[]>([]);
  const [pendingLeaveClass, setPendingLeaveClass] = useState<Class | null>(null);
  const [pendingDeleteClass, setPendingDeleteClass] = useState<Class | null>(null);
  const [error, setError] = useState('');
  const [createOpen, setCreateOpen] = useState(false);

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
      setError(e instanceof Error ? e.message : 'Failed to load dashboard');
    }
  }, []);

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
      toast.error(e instanceof Error ? e.message : 'Failed to leave class');
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
      toast.error(e instanceof Error ? e.message : 'Failed to delete class');
    }
  };

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-6 pb-10">
      {/* Executive Header Card */}
      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 p-5 sm:p-6 shadow-xs">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2.5 flex-wrap mb-2.5">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-indigo-50 dark:bg-indigo-950/80 border border-indigo-200/70 dark:border-indigo-800/70 text-[11px] font-mono font-semibold text-indigo-700 dark:text-indigo-300">
                <ShieldCheck className="h-3.5 w-3.5" />
                {lang === 'vi' ? 'BẢNG ĐIỀU KHIỂN GIẢNG VIÊN' : 'FACULTY WORKSPACE IDE'}
              </span>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-50 dark:bg-emerald-950/70 border border-emerald-200/70 dark:border-emerald-800/70 text-[11px] font-mono text-emerald-700 dark:text-emerald-300">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                {dashboard
                  ? lang === 'vi'
                    ? `${dashboard.total_classes} LỚP ĐANG HOẠT ĐỘNG`
                    : `${dashboard.total_classes} ACTIVE COHORTS`
                  : lang === 'vi'
                    ? 'ĐANG ĐỒNG BỘ...'
                    : 'SYNCING...'}
              </span>
            </div>

            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-indigo-50 dark:bg-indigo-950/80 border border-indigo-200/70 dark:border-indigo-800/70 flex items-center justify-center shrink-0">
                <GraduationCap className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
              </div>
              <div>
                <h1 className="font-display text-2xl sm:text-3xl font-bold text-slate-900 dark:text-white tracking-tight">
                  {t('teacher.myClasses')}
                </h1>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
                  {t('teacher.myClassesSubtitle')}
                </p>
              </div>
            </div>
          </div>

          <Button
            onClick={() => setCreateOpen(true)}
            aria-label={t('teacher.createClass')}
            className="gap-2 rounded-xl shadow-xs shrink-0"
          >
            <Plus className="h-4 w-4" />
            {t('teacher.createClass')}
          </Button>
        </div>
      </div>

      {error && (
        <Alert variant="destructive" className="rounded-2xl">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Architectural Metric Cards */}
      {dashboard && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card className="p-4 sm:p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 shadow-2xs">
            <div className="flex items-center justify-between mb-2">
              <div className="p-2 rounded-xl bg-indigo-50 dark:bg-indigo-950/80 border border-indigo-200/60 dark:border-indigo-800/60">
                <GraduationCap className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
              </div>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-indigo-50 dark:bg-indigo-950/80 text-indigo-600 dark:text-indigo-400">
                01
              </span>
            </div>
            <p className="text-2xl sm:text-3xl font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
              {dashboard.total_classes}
            </p>
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mt-1">
              {t('teacher.classes')}
            </p>
          </Card>

          <Card className="p-4 sm:p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 shadow-2xs">
            <div className="flex items-center justify-between mb-2">
              <div className="p-2 rounded-xl bg-emerald-50 dark:bg-emerald-950/80 border border-emerald-200/60 dark:border-emerald-800/60">
                <Users className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              </div>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/80 text-emerald-600 dark:text-emerald-400">
                02
              </span>
            </div>
            <p className="text-2xl sm:text-3xl font-bold font-mono tabular-nums text-emerald-600 dark:text-emerald-400">
              {dashboard.total_students}
            </p>
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mt-1">
              {t('teacher.students')}
            </p>
          </Card>

          <Card className="p-4 sm:p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 shadow-2xs">
            <div className="flex items-center justify-between mb-2">
              <div className="p-2 rounded-xl bg-amber-50 dark:bg-amber-950/80 border border-amber-200/60 dark:border-amber-800/60">
                <FileCheck className="h-4 w-4 text-amber-600 dark:text-amber-400" />
              </div>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-50 dark:bg-amber-950/80 text-amber-600 dark:text-amber-400">
                03
              </span>
            </div>
            <p className="text-2xl sm:text-3xl font-bold font-mono tabular-nums text-amber-600 dark:text-amber-400">
              {dashboard.total_essays}
            </p>
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mt-1">
              {t('teacher.submissions')}
            </p>
          </Card>

          {dashboard.pending_reviews > 0 ? (
            <Link
              to="/teacher/reviews"
              data-testid="needs-review-kpi-link"
              className="block rounded-2xl focus:outline-none focus:ring-2 focus:ring-rose-500 group"
            >
              <Card className="p-4 sm:p-5 h-full rounded-2xl bg-white dark:bg-slate-900 border border-rose-200/90 dark:border-rose-800/80 hover:border-rose-400 dark:hover:border-rose-600 shadow-2xs transition-colors">
                <div className="flex items-center justify-between mb-2">
                  <div className="p-2 rounded-xl bg-rose-50 dark:bg-rose-950/80 border border-rose-200/60 dark:border-rose-800/60">
                    <ClipboardCheck className="h-4 w-4 text-rose-600 dark:text-rose-400" />
                  </div>
                  <span className="inline-flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded bg-rose-50 dark:bg-rose-950/80 text-rose-600 dark:text-rose-400">
                    04
                    <ChevronRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
                  </span>
                </div>
                <p className="text-2xl sm:text-3xl font-bold font-mono tabular-nums text-rose-600 dark:text-rose-400">
                  {dashboard.pending_reviews}
                </p>
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mt-1 group-hover:text-rose-600 dark:group-hover:text-rose-400 transition-colors">
                  {t('teacher.needsReview')}
                </p>
              </Card>
            </Link>
          ) : (
            <Card className="p-4 sm:p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 shadow-2xs">
              <div className="flex items-center justify-between mb-2">
                <div className="p-2 rounded-xl bg-rose-50 dark:bg-rose-950/80 border border-rose-200/60 dark:border-rose-800/60">
                  <ClipboardCheck className="h-4 w-4 text-rose-600 dark:text-rose-400" />
                </div>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-rose-50 dark:bg-rose-950/80 text-rose-600 dark:text-rose-400">
                  04
                </span>
              </div>
              <p className="text-2xl sm:text-3xl font-bold font-mono tabular-nums text-rose-600 dark:text-rose-400">
                {dashboard.pending_reviews}
              </p>
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mt-1">
                {t('teacher.needsReview')}
              </p>
            </Card>
          )}
        </div>
      )}

      {/* IDE Container for Cohort Registry */}
      <div className="rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-4 py-3 bg-slate-50/90 dark:bg-slate-900/90 border-b border-slate-200/80 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-red-400/80" />
              <span className="w-2.5 h-2.5 rounded-full bg-amber-400/80" />
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400/80" />
            </div>
            <Separator orientation="vertical" className="h-4" />
            <Terminal className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />
            <span className="text-xs font-mono font-semibold text-slate-700 dark:text-slate-200">
              teacher_classes.registry
            </span>
          </div>
          <span className="text-[11px] font-mono text-slate-400">
            {lang === 'vi'
              ? `${dashboard?.classes?.length ?? 0} lớp học`
              : `${dashboard?.classes?.length ?? 0} cohorts`}
          </span>
        </div>

        <div className="p-4 sm:p-5 space-y-3">
          {(dashboard?.classes?.length ?? 0) === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 p-8 sm:p-12 text-center">
              <p className="text-slate-700 dark:text-slate-300 font-medium">
                {t('teacher.noClassesYet')}
              </p>
              <p className="text-sm text-slate-500 mt-1">{t('teacher.noClassesHint')}</p>
            </div>
          ) : (
            (dashboard?.classes ?? []).map((c: Class, idx: number) => (
              <button
                key={c.id}
                onClick={() => navigate(`/teacher/classes/${c.id}`)}
                className="card w-full text-left rounded-xl bg-slate-50/60 dark:bg-slate-800/40 border border-slate-200/90 dark:border-slate-800 p-4 hover:bg-white dark:hover:bg-slate-800 hover:border-indigo-300 dark:hover:border-indigo-700 transition-all flex items-center justify-between gap-4 group focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-2xs"
              >
                <div className="flex items-start gap-3.5 flex-1 min-w-0">
                  <span className="text-xs font-mono font-semibold px-2 py-1 rounded-lg bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-700 text-slate-500 dark:text-slate-400 shrink-0 mt-0.5">
                    #{String(idx + 1).padStart(2, '0')}
                  </span>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-display font-semibold text-base text-slate-900 dark:text-white break-words group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                      {c.name}
                    </h3>
                    {c.description && (
                      <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5 line-clamp-2 break-words">
                        {c.description}
                      </p>
                    )}
                    <div className="flex flex-wrap gap-2.5 mt-2.5">
                      <Badge
                        variant="secondary"
                        className="font-mono font-normal text-xs bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-700"
                      >
                        <Users className="inline h-3 w-3 mr-1 text-emerald-500" />
                        {c.student_count} {lang === 'vi' ? 'SV' : t('teacher.students').toLowerCase()}
                      </Badge>
                      <Badge
                        variant="secondary"
                        className="font-mono font-normal text-xs bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-700"
                      >
                        <FileCheck className="inline h-3 w-3 mr-1 text-indigo-500" />
                        {c.essay_count} {lang === 'vi' ? 'bài' : t('teacher.submissions').toLowerCase()}
                      </Badge>
                      {c.join_code && (
                        <Badge
                          variant="outline"
                          className="font-mono font-semibold text-xs bg-indigo-50/90 dark:bg-indigo-950/80 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800"
                        >
                          CODE: {c.join_code}
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span
                    role="button"
                    tabIndex={0}
                    data-testid={`delete-class-card-btn-${c.id}`}
                    title={lang === 'vi' ? 'Xóa lớp học' : 'Delete class'}
                    onClick={(e) => {
                      e.stopPropagation();
                      setPendingDeleteClass(c);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        e.stopPropagation();
                        setPendingDeleteClass(c);
                      }
                    }}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/50 transition-colors"
                  >
                    <Trash2 className="h-4 w-4" />
                  </span>
                  <ChevronRight className="h-5 w-5 text-slate-400 group-hover:text-indigo-500 shrink-0 transition-transform group-hover:translate-x-0.5" />
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {enrolledClasses.length > 0 && (
        <div
          data-testid="enrolled-classes-section"
          className="rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm overflow-hidden"
        >
          <div className="flex items-center justify-between gap-3 px-4 py-3 bg-slate-50/90 dark:bg-slate-900/90 border-b border-slate-200/80 dark:border-slate-800">
            <div className="flex items-center gap-2.5">
              <Terminal className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
              <span className="text-xs font-mono font-semibold text-slate-700 dark:text-slate-200">
                {lang === 'vi' ? 'Lớp học đã tham gia' : 'Enrolled Cohorts'}
              </span>
            </div>
            <span className="text-[11px] font-mono text-slate-400">
              {enrolledClasses.length}
            </span>
          </div>
          <div className="p-4 sm:p-5 space-y-3">
            {enrolledClasses.map((c) => (
              <div
                key={c.id}
                className="rounded-xl bg-slate-50/60 dark:bg-slate-800/40 border border-slate-200/90 dark:border-slate-800 p-4 flex flex-wrap items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <h3 className="font-display font-semibold text-sm sm:text-base text-slate-900 dark:text-white">
                    {c.name}
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 font-mono">
                    {lang === 'vi' ? 'Giảng viên:' : 'Instructor:'} {c.teacher_username}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  data-testid={`leave-class-btn-${c.id}`}
                  onClick={() => setPendingLeaveClass(c)}
                  className="gap-1.5 rounded-xl text-rose-600 border-rose-200 hover:bg-rose-50 dark:border-rose-800 dark:hover:bg-rose-950/50 text-xs font-mono"
                >
                  <LogOut className="h-3.5 w-3.5" />
                  {lang === 'vi' ? 'Rời lớp' : 'Leave Class'}
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {pendingLeaveClass && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
          role="dialog"
          aria-modal="true"
          onClick={() => setPendingLeaveClass(null)}
        >
          <div
            className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 max-w-md w-full p-5 shadow-2xl space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-display text-lg font-bold text-slate-900 dark:text-white">
              {lang === 'vi' ? 'Xác nhận rời lớp học' : 'Leave Cohort?'}
            </h3>
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
        </div>
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
        onCreated={load}
      />
    </div>
  );
}
