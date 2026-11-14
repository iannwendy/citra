import { useEffect, useState, useCallback } from 'react';
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
  Terminal,
  ShieldCheck,
  ExternalLink,
  Loader2,
  Copy,
  Check,
  RefreshCw,
  KeyRound,
  BarChart3,
  AlertTriangle,
  Sparkles,
} from 'lucide-react';
import {
  api,
  type Class,
  type ClassStudent,
  type ClassEssay,
  type ClassAnalytics,
} from '@/api/client';
import { getRuleDisplayName } from '@/lib/verdictExplanation';
import { useToast } from '@/contexts/ToastContext';
import { ConfirmationModal } from '@/components/ConfirmationModal';
import { AddStudentDialog } from '@/components/AddStudentDialog';
import { FileFormatIcon } from '@/components/FileFormatIcon';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Alert, AlertDescription } from '@/components/ui/alert';

/**
 * ClassDetailPage — manage a single class (Scholarly Precision shadcn/ui v2.0).
 *
 * 3 sections: header (name, description, CSV export), students (add/remove),
 * essays (click-through to report). Owner-only — 403 redirects to dashboard.
 */
export function ClassDetailPage() {
  const { classId } = useParams<{ classId: string }>();
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const lang = i18n.language?.startsWith('vi') ? 'vi' : 'en';
  const toast = useToast();
  const cid = Number(classId);

  const [cls, setCls] = useState<Class | null>(null);
  const [students, setStudents] = useState<ClassStudent[]>([]);
  const [essays, setEssays] = useState<ClassEssay[]>([]);
  const [analytics, setAnalytics] = useState<ClassAnalytics | null>(null);
  const [copiedCode, setCopiedCode] = useState(false);
  const [regeneratingCode, setRegeneratingCode] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [pendingRemove, setPendingRemove] = useState<ClassStudent | null>(null);

  const load = useCallback(async () => {
    if (!cid || Number.isNaN(cid)) {
      setError('Invalid class id');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const all = await api.listMyClasses();
      const found = all.find((c) => c.id === cid);
      if (!found) {
        setError(t('teacher.classAccessDenied'));
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
      setError(e instanceof Error ? e.message : 'Failed to load class');
    } finally {
      setLoading(false);
    }
  }, [cid, t]);

  useEffect(() => {
    load();
  }, [load]);

  const handleRemove = async () => {
    if (!pendingRemove) return;
    const studentId = pendingRemove.id;
    setPendingRemove(null);
    try {
      await api.removeStudentFromClass(cid, studentId);
      toast.success(
        t('teacher.studentRemovedSuccess', { username: pendingRemove.username })
      );
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('teacher.studentRemoveFailed'));
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
          : `Copied class join code: ${cls.join_code}`
      );
    } catch {
      toast.error(lang === 'vi' ? 'Không thể sao chép mã' : 'Failed to copy code');
    }
  };

  const handleRegenerateCode = async () => {
    setRegeneratingCode(true);
    try {
      const updated = await api.regenerateClassCode(cid);
      setCls(updated);
      toast.success(
        lang === 'vi'
          ? `Đã tạo mã tham gia mới: ${updated.join_code}`
          : `Generated new join code: ${updated.join_code}`
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to regenerate code');
    } finally {
      setRegeneratingCode(false);
    }
  };

  const handleExport = async () => {
    try {
      const token = localStorage.getItem('token');
      const resp = await fetch(api.exportClassCSV(cid), {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!resp.ok) {
        throw new Error(`API ${resp.status}: ${await resp.text()}`);
      }
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `class_${cid}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('teacher.exportCsvFailed'));
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 text-indigo-600 dark:text-indigo-400 animate-spin" />
        <span className="ml-3 text-slate-500 font-mono text-sm">
          {t('common.loading')}
        </span>
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

  return (
    <div className="space-y-6 pb-10">
      {/* Executive Header Card */}
      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 p-5 sm:p-6 shadow-xs">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2.5 flex-wrap mb-3">
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigate('/teacher/classes')}
                aria-label="Back to classes"
                className="h-7 px-2.5 rounded-lg text-xs font-mono gap-1.5"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                {t('common.back')}
              </Button>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-indigo-50 dark:bg-indigo-950/80 border border-indigo-200/70 dark:border-indigo-800/70 text-[11px] font-mono font-semibold text-indigo-700 dark:text-indigo-300">
                <ShieldCheck className="h-3.5 w-3.5" />
                COHORT #{cls.id}
              </span>
              {cls.join_code && (
                <div
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-50 dark:bg-emerald-950/70 border border-emerald-200/80 dark:border-emerald-800/80 text-[11px] font-mono font-bold text-emerald-700 dark:text-emerald-300"
                  data-testid="class-join-code-badge"
                >
                  <KeyRound className="h-3 w-3" />
                  <span>JOIN CODE: {cls.join_code}</span>
                  <button
                    type="button"
                    onClick={handleCopyJoinCode}
                    title={lang === 'vi' ? 'Sao chép mã lớp' : 'Copy join code'}
                    className="p-0.5 rounded hover:bg-emerald-200/60 dark:hover:bg-emerald-900/60 transition-colors cursor-pointer"
                  >
                    {copiedCode ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                  </button>
                  <button
                    type="button"
                    onClick={handleRegenerateCode}
                    disabled={regeneratingCode}
                    title={lang === 'vi' ? 'Đổi mã tham gia lớp mới' : 'Regenerate join code'}
                    className="p-0.5 rounded hover:bg-emerald-200/60 dark:hover:bg-emerald-900/60 transition-colors cursor-pointer disabled:opacity-50"
                  >
                    <RefreshCw className={`h-3 w-3 ${regeneratingCode ? 'animate-spin' : ''}`} />
                  </button>
                </div>
              )}
            </div>

            <h1 className="font-display text-2xl sm:text-3xl font-bold text-slate-900 dark:text-white break-words tracking-tight">
              {cls.name}
            </h1>
            {cls.description && (
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                {cls.description}
              </p>
            )}
          </div>

          <Button
            variant="outline"
            onClick={handleExport}
            className="gap-2 rounded-xl font-mono text-xs h-9 shrink-0"
          >
            <Download className="h-3.5 w-3.5" />
            {t('teacher.exportCsv')}
          </Button>
        </div>
      </div>

      {/* Architectural Metric Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="p-4 sm:p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 shadow-2xs">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
              {t('teacher.enrolledStudents')}
            </span>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-indigo-50 dark:bg-indigo-950/80 text-indigo-600 dark:text-indigo-400">
              01
            </span>
          </div>
          <p className="text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
            {students.length}
          </p>
        </Card>

        <Card className="p-4 sm:p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 shadow-2xs">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
              {t('teacher.cohortSubmissions')}
            </span>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/80 text-emerald-600 dark:text-emerald-400">
              02
            </span>
          </div>
          <p className="text-2xl font-bold font-mono tabular-nums text-emerald-600 dark:text-emerald-400">
            {essays.length}
          </p>
        </Card>

        <Card className="p-4 sm:p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 shadow-2xs">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
              {lang === 'vi' ? 'Điểm CIS Trung bình Lớp' : 'Cohort Average CIS'}
            </span>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-violet-50 dark:bg-violet-950/80 text-violet-600 dark:text-violet-400">
              03
            </span>
          </div>
          <p className="text-2xl font-bold font-mono tabular-nums text-violet-600 dark:text-violet-400">
            {analytics ? `${analytics.avg_cis.toFixed(1)}` : '—'}
          </p>
        </Card>

        <Card className="p-4 sm:p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 shadow-2xs">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
              {lang === 'vi' ? 'Tỷ lệ Tài liệu Mới (≤ 5 năm)' : '5-Year Citation Recency'}
            </span>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-50 dark:bg-amber-950/80 text-amber-600 dark:text-amber-400">
              04
            </span>
          </div>
          <p className="text-2xl font-bold font-mono tabular-nums text-amber-600 dark:text-amber-400">
            {analytics ? `${analytics.recency_5yr_ratio.toFixed(1)}%` : '—'}
          </p>
        </Card>
      </div>

      {/* Cohort Integrity Analytics & Shared Hallucination Detector */}
      {analytics && (
        <section
          className="rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm overflow-hidden"
          data-testid="cohort-analytics-panel"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 bg-slate-50/90 dark:bg-slate-900/90 border-b border-slate-200/80 dark:border-slate-800">
            <div className="flex items-center gap-2.5 flex-wrap">
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-red-400/80" />
                <span className="w-2.5 h-2.5 rounded-full bg-amber-400/80" />
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-400/80" />
              </div>
              <Separator orientation="vertical" className="h-4" />
              <BarChart3 className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
              <h2 className="text-sm font-display font-semibold text-slate-900 dark:text-white">
                {lang === 'vi'
                  ? 'Phân tích Độ tin cậy Lớp học & Cảnh báo Ảo giác AI Trùng lặp'
                  : 'Cohort Integrity Analytics & Shared AI Hallucination Detector'}
              </h2>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {(analytics.queued_essays ?? 0) > 0 && (
                <span
                  data-testid="cohort-queued-essays-pill"
                  className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-amber-50 dark:bg-amber-950/80 border border-amber-200/80 dark:border-amber-800/80 text-[10px] font-mono font-semibold text-amber-700 dark:text-amber-300"
                >
                  <Loader2 className="h-3 w-3 animate-spin" />
                  {lang === 'vi'
                    ? `${analytics.queued_essays} bài đang xử lý`
                    : `${analytics.queued_essays} queued`}
                </span>
              )}
              {(analytics.failed_essays ?? 0) > 0 && (
                <span
                  data-testid="cohort-failed-essays-pill"
                  className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-rose-50 dark:bg-rose-950/80 border border-rose-200/80 dark:border-rose-800/80 text-[10px] font-mono font-semibold text-rose-700 dark:text-rose-300"
                >
                  <AlertCircle className="h-3 w-3" />
                  {lang === 'vi'
                    ? `${analytics.failed_essays} bài lỗi xử lý`
                    : `${analytics.failed_essays} failed`}
                </span>
              )}
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-950/80 border border-indigo-200/70 dark:border-indigo-800/70 text-[10px] font-mono font-semibold text-indigo-700 dark:text-indigo-300">
                <Sparkles className="h-3 w-3" />
                CROSS-STUDENT ANOMALY ENGINE
              </span>
            </div>
          </div>

          {(() => {
            const vb = analytics.verdict_breakdown ?? {};
            const breakdownItems = [
              {
                key: 'verified',
                count: vb.verified ?? 0,
                label: lang === 'vi' ? 'Hợp lệ' : 'Verified',
                barClass: 'bg-emerald-500',
                pillClass:
                  'bg-emerald-50 dark:bg-emerald-950/70 border-emerald-200/80 dark:border-emerald-800/80 text-emerald-700 dark:text-emerald-300',
              },
              {
                key: 'metadata_error',
                count: vb.metadata_error ?? 0,
                label: lang === 'vi' ? 'Sai lệch Metadata' : 'Metadata Error',
                barClass: 'bg-amber-500',
                pillClass:
                  'bg-amber-50 dark:bg-amber-950/70 border-amber-200/80 dark:border-amber-800/80 text-amber-700 dark:text-amber-300',
              },
              {
                key: 'incomplete_metadata',
                count: vb.incomplete_metadata ?? 0,
                label:
                  lang === 'vi'
                    ? 'Thiếu quy cách trích dẫn'
                    : 'Incomplete Reference',
                barClass: 'bg-orange-400',
                pillClass:
                  'bg-orange-50 dark:bg-orange-950/70 border-orange-200/80 dark:border-orange-800/80 text-orange-700 dark:text-orange-300',
              },
              {
                key: 'suspected_hallucination',
                count: vb.suspected_hallucination ?? 0,
                label: lang === 'vi' ? 'Nghi vấn ngụy tạo' : 'Suspected Hallucination',
                barClass: 'bg-rose-500',
                pillClass:
                  'bg-rose-50 dark:bg-rose-950/70 border-rose-200/80 dark:border-rose-800/80 text-rose-700 dark:text-rose-300',
              },
              {
                key: 'unresolved',
                count: vb.unresolved ?? 0,
                label: lang === 'vi' ? 'Chờ rà soát' : 'Unresolved',
                barClass: 'bg-slate-400',
                pillClass:
                  'bg-slate-100 dark:bg-slate-800/90 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300',
              },
              {
                key: 'resource',
                count: vb.resource ?? 0,
                label:
                  lang === 'vi'
                    ? 'Tài nguyên Web / Pháp luật'
                    : 'Web / Legal Resource',
                barClass: 'bg-sky-500',
                pillClass:
                  'bg-sky-50 dark:bg-sky-950/70 border-sky-200/80 dark:border-sky-800/80 text-sky-700 dark:text-sky-300',
              },
            ];
            const totalVerdicts = breakdownItems.reduce((sum, item) => sum + item.count, 0);
            const showBreakdown =
              totalVerdicts > 0 || (analytics.total_essays ?? 0) > 0 || essays.length > 0;
            if (!showBreakdown) return null;

            return (
              <div
                data-testid="cohort-verdict-breakdown"
                className="px-4 sm:px-5 pt-4 sm:pt-5"
              >
                <div className="p-4 rounded-xl bg-slate-50/80 dark:bg-slate-950/60 border border-slate-200/80 dark:border-slate-800 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-[11px] font-mono font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                      {lang === 'vi'
                        ? 'Phân bổ Phán quyết Trích dẫn Toàn Lớp'
                        : 'Cohort Verdict Breakdown'}
                    </p>
                    <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                      {totalVerdicts}{' '}
                      {lang === 'vi' ? 'trích dẫn đã phân loại' : 'verdicts classified'}
                    </span>
                  </div>
                  {totalVerdicts > 0 && (
                    <div className="h-2 w-full rounded-full bg-slate-200/70 dark:bg-slate-800 overflow-hidden flex">
                      {breakdownItems
                        .filter((item) => item.count > 0)
                        .map((item) => (
                          <div
                            key={item.key}
                            style={{ width: `${(item.count / totalVerdicts) * 100}%` }}
                            title={`${item.label}: ${item.count}`}
                            className={`${item.barClass} h-full transition-all`}
                          />
                        ))}
                    </div>
                  )}
                  <div className="flex flex-wrap gap-2">
                    {breakdownItems.map((item) => (
                      <span
                        key={item.key}
                        data-testid={`verdict-breakdown-pill-${item.key}`}
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-mono ${item.pillClass}`}
                      >
                        <span className={`w-2 h-2 rounded-full ${item.barClass}`} />
                        <span className="font-medium">{item.label}:</span>
                        <span className="font-bold tabular-nums">{item.count}</span>
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            );
          })()}

          <div className="p-4 sm:p-5 grid grid-cols-1 lg:grid-cols-12 gap-5">
            {/* Left: CIS Distribution & Top Symbolic Rules */}
            <div className="lg:col-span-5 space-y-4">
              <div className="p-4 rounded-xl bg-slate-50/80 dark:bg-slate-950/60 border border-slate-200/80 dark:border-slate-800">
                <p className="text-[11px] font-mono font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-3">
                  {lang === 'vi' ? 'Phân phối Điểm CIS trong Lớp' : 'Cohort CIS Score Distribution'}
                </p>
                <div className="grid grid-cols-4 gap-2 text-center">
                  <div className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                    <p className="text-lg font-mono font-bold text-emerald-700 dark:text-emerald-300">
                      {analytics.cis_distribution?.excellent ?? 0}
                    </p>
                    <p className="text-[10px] font-mono text-emerald-600 dark:text-emerald-400">
                      ≥ 85 (A)
                    </p>
                  </div>
                  <div className="p-2 rounded-lg bg-indigo-500/10 border border-indigo-500/20">
                    <p className="text-lg font-mono font-bold text-indigo-700 dark:text-indigo-300">
                      {analytics.cis_distribution?.good ?? 0}
                    </p>
                    <p className="text-[10px] font-mono text-indigo-600 dark:text-indigo-400">
                      70–84 (B)
                    </p>
                  </div>
                  <div className="p-2 rounded-lg bg-amber-500/10 border border-amber-500/20">
                    <p className="text-lg font-mono font-bold text-amber-700 dark:text-amber-300">
                      {analytics.cis_distribution?.fair ?? 0}
                    </p>
                    <p className="text-[10px] font-mono text-amber-600 dark:text-amber-400">
                      50–69 (C)
                    </p>
                  </div>
                  <div className="p-2 rounded-lg bg-rose-500/10 border border-rose-500/20">
                    <p className="text-lg font-mono font-bold text-rose-700 dark:text-rose-300">
                      {analytics.cis_distribution?.poor ?? 0}
                    </p>
                    <p className="text-[10px] font-mono text-rose-600 dark:text-rose-400">
                      &lt; 50 (D)
                    </p>
                  </div>
                </div>
              </div>

              <div className="p-4 rounded-xl bg-slate-50/80 dark:bg-slate-950/60 border border-slate-200/80 dark:border-slate-800">
                <p className="text-[11px] font-mono font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2.5">
                  {lang === 'vi'
                    ? 'Luật Symbolic Kích hoạt Nhiều nhất'
                    : 'Most Triggered Symbolic Rules'}
                </p>
                {(analytics.top_triggered_rules ?? []).length === 0 ? (
                  <p className="text-xs font-mono text-slate-400">
                    {lang === 'vi' ? 'Chưa có luật vi phạm nào được ghi nhận.' : 'No rule violations triggered yet.'}
                  </p>
                ) : (
                  <div className="space-y-2">
                    {(analytics.top_triggered_rules ?? []).map((r) => (
                      <div
                        key={r.rule_id}
                        className="flex flex-col gap-0.5 px-2.5 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700"
                      >
                        <div className="flex items-center justify-between gap-2 text-xs font-mono">
                          <span className="font-bold text-indigo-600 dark:text-indigo-400">
                            {r.rule_id}
                          </span>
                          <span className="text-slate-500 dark:text-slate-400 font-semibold">
                            ×{r.count}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-snug">
                          {getRuleDisplayName(r.rule_id, lang)}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Right: Shared Hallucination & Flagged Citation Radar */}
            <div className="lg:col-span-7 p-4 rounded-xl bg-slate-50/80 dark:bg-slate-950/60 border border-slate-200/80 dark:border-slate-800 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between gap-2 mb-3">
                  <p className="text-[11px] font-mono font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                    <AlertTriangle className="h-3.5 w-3.5 text-rose-500" />
                    {lang === 'vi'
                      ? 'Radar Phát hiện Trích dẫn Ảo giác / Lỗi Metadata trong Lớp'
                      : 'Shared Hallucination & Flagged Citation Radar'}
                  </p>
                  <span className="text-[10px] font-mono text-slate-400">
                    {(analytics.shared_hallucinations ?? []).length}{' '}
                    {lang === 'vi' ? 'cảnh báo' : 'flagged items'}
                  </span>
                </div>

                {(analytics.shared_hallucinations ?? []).length === 0 ? (
                  <div className="py-8 text-center text-xs font-mono text-slate-400">
                    {lang === 'vi'
                      ? 'Không phát hiện trích dẫn ảo giác hoặc lỗi metadata nào trong lớp học.'
                      : 'No suspected hallucinations or metadata anomalies detected across this cohort.'}
                  </div>
                ) : (
                  <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                    {(analytics.shared_hallucinations ?? []).map((item, idx) => (
                      <div
                        key={idx}
                        className={`p-3 rounded-xl border text-xs ${
                          item.is_shared
                            ? 'bg-rose-50/70 dark:bg-rose-950/30 border-rose-200 dark:border-rose-800/80'
                            : 'bg-white dark:bg-slate-900 border-slate-200/80 dark:border-slate-800'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2 mb-1 flex-wrap">
                          <span
                            className={`px-2 py-0.5 rounded font-mono text-[10px] font-bold uppercase ${
                              item.label === 'suspected_hallucination'
                                ? 'bg-rose-500/15 text-rose-700 dark:text-rose-300'
                                : 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                            }`}
                          >
                            {item.label}
                          </span>
                          <span className="font-mono text-[10px] text-slate-500 dark:text-slate-400">
                            {item.is_shared
                              ? lang === 'vi'
                                ? `TRÙNG LẶP Ở ${item.essay_ids.length} BÀI NỘP (${item.students.join(', ')})`
                                : `SHARED ACROSS ${item.essay_ids.length} SUBMISSIONS (${item.students.join(', ')})`
                              : `${item.students.join(', ')}`}
                          </span>
                        </div>
                        <p className="font-mono text-[11px] text-slate-800 dark:text-slate-200 line-clamp-2">
                          {item.citation_raw}
                        </p>
                        {item.essay_ids && item.essay_ids.length > 0 && (
                          <div className="flex flex-wrap items-center gap-1.5 mt-2 pt-1.5 border-t border-slate-200/60 dark:border-slate-800/80">
                            <span className="text-[10px] font-mono text-slate-400">
                              {lang === 'vi' ? 'Báo cáo:' : 'Reports:'}
                            </span>
                            {item.essay_ids.map((eid) => (
                              <Link
                                key={eid}
                                to={`/verification/report/${eid}`}
                                data-testid={`shared-hallucination-essay-link-${eid}`}
                                className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-md bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/70 dark:hover:bg-indigo-900/70 border border-indigo-200/80 dark:border-indigo-800/80 font-mono text-[10px] font-semibold text-indigo-700 dark:text-indigo-300 transition-colors"
                              >
                                #{eid}
                                <ExternalLink className="h-2.5 w-2.5" />
                              </Link>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Students Roster IDE Container */}
      <section className="rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2.5 px-4 py-3 bg-slate-50/90 dark:bg-slate-900/90 border-b border-slate-200/80 dark:border-slate-800">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex items-center gap-1.5 shrink-0">
              <span className="w-2.5 h-2.5 rounded-full bg-red-400/80" />
              <span className="w-2.5 h-2.5 rounded-full bg-amber-400/80" />
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400/80" />
            </div>
            <Separator orientation="vertical" className="h-4 shrink-0" />
            <Users className="h-4 w-4 text-indigo-600 dark:text-indigo-400 shrink-0" />
            <h2 className="text-sm font-display font-semibold text-slate-900 dark:text-white">
              {t('teacher.students')} ({students.length})
            </h2>
          </div>
          <Button
            size="sm"
            onClick={() => setAddOpen(true)}
            className="gap-1.5 rounded-xl h-8 text-xs shrink-0"
          >
            <UserPlus className="h-3.5 w-3.5" />
            {t('teacher.addStudent')}
          </Button>
        </div>

        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          {students.length === 0 ? (
            <p className="p-8 text-center text-sm text-slate-500 font-mono">
              {t('teacher.noStudentsYet')}
            </p>
          ) : (
            students.map((s, idx) => (
              <div
                key={s.id}
                className="flex items-center justify-between px-5 py-3.5 hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-xs font-mono text-slate-400 dark:text-slate-500">
                    #{String(idx + 1).padStart(2, '0')}
                  </span>
                  <div className="min-w-0">
                    <p className="font-medium text-sm text-slate-900 dark:text-slate-100 truncate">
                      {s.username}
                    </p>
                    {s.full_name && (
                      <p className="text-xs text-slate-500 truncate">{s.full_name}</p>
                    )}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setPendingRemove(s)}
                  aria-label={`Remove ${s.username}`}
                  className="text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:hover:bg-rose-950/30 rounded-lg"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))
          )}
        </div>
      </section>

      {/* Submissions IDE Container */}
      <section className="rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2.5 px-4 py-3 bg-slate-50/90 dark:bg-slate-900/90 border-b border-slate-200/80 dark:border-slate-800">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex items-center gap-1.5 shrink-0">
              <span className="w-2.5 h-2.5 rounded-full bg-red-400/80" />
              <span className="w-2.5 h-2.5 rounded-full bg-amber-400/80" />
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400/80" />
            </div>
            <Separator orientation="vertical" className="h-4 shrink-0" />
            <FileText className="h-4 w-4 text-indigo-600 dark:text-indigo-400 shrink-0" />
            <h2 className="text-sm font-display font-semibold text-slate-900 dark:text-white">
              {t('teacher.submissions')} ({essays.length})
            </h2>
          </div>
          <span className="text-[11px] font-mono text-slate-400 flex items-center gap-1 shrink-0">
            <Terminal className="h-3 w-3" />
            cohort_submissions.log
          </span>
        </div>

        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          {essays.length === 0 ? (
            <p className="p-8 text-center text-sm text-slate-500 font-mono">
              {t('teacher.noSubmissionsYet')}
            </p>
          ) : (
            essays.map((e, idx) => {
              const status = (e.job_status ?? 'completed').toLowerCase();
              const isQueuedOrProcessing = status === 'queued' || status === 'processing';
              const isFailed = status === 'failed';
              const targetHref =
                isQueuedOrProcessing || isFailed
                  ? `/verification/processing/${e.id}`
                  : `/verification/report/${e.id}`;

              return (
                <Link
                  key={e.id}
                  to={targetHref}
                  data-testid={`class-essay-row-${e.id}`}
                  title={isFailed && e.job_error ? e.job_error : undefined}
                  className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 hover:bg-slate-50 dark:hover:bg-slate-800/50 focus:outline-none focus:bg-slate-50 dark:focus:bg-slate-800/50 transition-colors group"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-xs font-mono text-slate-400 dark:text-slate-500">
                      #{String(idx + 1).padStart(2, '0')}
                    </span>
                    <FileFormatIcon filename={e.filename} size="sm" />
                    <div className="min-w-0">
                      <p className="font-medium text-sm text-slate-900 dark:text-slate-100 truncate group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                        {e.filename}
                      </p>
                      <p className="text-xs font-mono text-slate-500 mt-0.5">
                        {e.username ?? '—'} • {e.num_pages} {t('teacher.pages')} •{' '}
                        {e.uploaded_at
                          ? new Date(e.uploaded_at).toLocaleDateString()
                          : ''}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    {isQueuedOrProcessing ? (
                      <>
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-amber-50 dark:bg-amber-950/80 border border-amber-200/80 dark:border-amber-800/80 text-[11px] font-mono font-semibold text-amber-700 dark:text-amber-300">
                          <Loader2 className="h-3 w-3 animate-spin" />
                          {status === 'queued'
                            ? lang === 'vi'
                              ? 'Đang chờ'
                              : 'Queued'
                            : lang === 'vi'
                              ? 'Đang xử lý'
                              : 'Processing'}
                        </span>
                        <span className="text-[11px] font-mono text-indigo-600 dark:text-indigo-400 font-medium">
                          {lang === 'vi' ? 'Xem tiến độ' : 'View Progress'}
                        </span>
                      </>
                    ) : isFailed ? (
                      <>
                        <span
                          title={e.job_error ?? undefined}
                          className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-rose-50 dark:bg-rose-950/80 border border-rose-200/80 dark:border-rose-800/80 text-[11px] font-mono font-semibold text-rose-700 dark:text-rose-300"
                        >
                          <AlertCircle className="h-3 w-3" />
                          {lang === 'vi' ? 'Thất bại' : 'Failed'}
                        </span>
                        {e.quota_charged === false && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/80 border border-emerald-200/80 dark:border-emerald-800/80 text-[10px] font-mono font-semibold text-emerald-700 dark:text-emerald-300">
                            {lang === 'vi' ? 'Đã hoàn lượt' : 'Credit Refunded'}
                          </span>
                        )}
                        <span className="text-[11px] font-mono text-indigo-600 dark:text-indigo-400 font-medium">
                          {lang === 'vi' ? 'Thử lại' : 'Retry'}
                        </span>
                      </>
                    ) : (
                      <>
                        {e.cis_score != null && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-indigo-50 dark:bg-indigo-950/80 border border-indigo-200/70 dark:border-indigo-800/70 text-[11px] font-mono font-bold text-indigo-700 dark:text-indigo-300 tabular-nums">
                            CIS {Number(e.cis_score).toFixed(1)}%
                          </span>
                        )}
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/80 border border-emerald-200/80 dark:border-emerald-800/80 text-[10px] font-mono font-semibold text-emerald-700 dark:text-emerald-300">
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
    </div>
  );
}
