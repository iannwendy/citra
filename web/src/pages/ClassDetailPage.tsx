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
  ExternalLink,
  Loader2,
  Copy,
  Check,
  RefreshCw,
  KeyRound,
  AlertTriangle,
  Pencil,
  Archive,
} from 'lucide-react';
import {
  api,
  type Class,
  type ClassStudent,
  type ClassEssay,
  type ClassAnalytics,
} from '@/api/client';
import { getRuleDisplayName } from '@/lib/verdictExplanation';
import { getHumanVerdictMeta } from '@/lib/teacherGuidance';
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
import {
  StudioWindowHeader,
  ProportionalBarRow,
} from '@/components/ui/studio-visuals';
import {
  DonutChart,
  NumberPopIn,
  ScoreRing,
} from '@/components/ui/transitions';

/**
 * ClassDetailPage — Visual Cohort Studio for a single class.
 *
 * Combines ScoreRing gauges, DonutChart verdict distribution, 4-band grade histogram,
 * plain-language issue ranking bars, and student/submission rosters.
 */
export function ClassDetailPage() {
  const { classId } = useParams<{ classId: string }>();
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const lang: 'en' | 'vi' = i18n.language?.startsWith('vi') ? 'vi' : 'en';
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
  const [editOpen, setEditOpen] = useState(false);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [exportingZip, setExportingZip] = useState(false);
  const [upgradeOpen, setUpgradeOpen] = useState(false);

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
    void load();
  }, [load]);

  const handleRemove = async () => {
    if (!pendingRemove) return;
    const studentId = pendingRemove.id;
    setPendingRemove(null);
    try {
      await api.removeStudentFromClass(cid, studentId);
      toast.success(
        t('teacher.studentRemovedSuccess', { username: pendingRemove.username }),
      );
      void load();
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
          : `Copied class join code: ${cls.join_code}`,
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
          : `Generated new join code: ${updated.join_code}`,
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
      const msg = e instanceof Error ? e.message : 'Failed to export class ZIP';
      if (/API\s+(402|403)\b|HTTP\s+(402|403)\b|Ultra|upgrade/i.test(msg)) {
        setUpgradeOpen(true);
      } else {
        toast.error(msg);
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
      toast.error(err instanceof Error ? err.message : 'Failed to update class');
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
      toast.error(err instanceof Error ? err.message : 'Failed to delete class');
    }
  };

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

  const avgCisSafe =
    analytics && Number.isFinite(analytics.avg_cis) ? analytics.avg_cis : 0;
  const recencySafe =
    analytics && Number.isFinite(analytics.recency_5yr_ratio)
      ? analytics.recency_5yr_ratio
      : 0;

  return (
    <div className="space-y-5 pb-10">
      {/* Clean Class Header */}
      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 p-5 sm:p-6 shadow-xs">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2.5 flex-wrap mb-3">
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigate('/teacher/classes')}
                aria-label="Back to classes"
                className="h-7 px-2.5 rounded-lg text-xs gap-1.5"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                {t('common.back')}
              </Button>
              {cls.join_code && (
                <div
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-50 dark:bg-emerald-950/70 border border-emerald-200/80 dark:border-emerald-800/80 text-xs font-mono font-semibold text-emerald-700 dark:text-emerald-300"
                  data-testid="class-join-code-badge"
                >
                  <KeyRound className="h-3.5 w-3.5" />
                  <span>
                    {lang === 'vi' ? 'MÃ LỚP:' : 'JOIN CODE:'} {cls.join_code}
                  </span>
                  <button
                    type="button"
                    onClick={() => void handleCopyJoinCode()}
                    title={lang === 'vi' ? 'Sao chép mã lớp' : 'Copy join code'}
                    className="p-0.5 rounded hover:bg-emerald-200/60 dark:hover:bg-emerald-900/60 transition-colors cursor-pointer"
                  >
                    {copiedCode ? (
                      <Check className="h-3 w-3" />
                    ) : (
                      <Copy className="h-3 w-3" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleRegenerateCode()}
                    disabled={regeneratingCode}
                    title={
                      lang === 'vi' ? 'Đổi mã tham gia lớp mới' : 'Regenerate join code'
                    }
                    className="p-0.5 rounded hover:bg-emerald-200/60 dark:hover:bg-emerald-900/60 transition-colors cursor-pointer disabled:opacity-50"
                  >
                    <RefreshCw
                      className={`h-3 w-3 ${regeneratingCode ? 'animate-spin' : ''}`}
                    />
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

          <div className="flex flex-wrap items-center gap-2 shrink-0">
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
              disabled={exportingZip}
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
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5 sm:gap-4">
        <Card className="p-4 sm:p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 shadow-2xs flex flex-col justify-between">
          <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
            {t('teacher.enrolledStudents')}
          </span>
          <p className="mt-2 text-2xl sm:text-3xl font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
            <NumberPopIn value={students.length} />
          </p>
        </Card>

        <Card className="p-4 sm:p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 shadow-2xs flex flex-col justify-between">
          <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
            {t('teacher.cohortSubmissions')}
          </span>
          <p className="mt-2 text-2xl sm:text-3xl font-bold font-mono tabular-nums text-emerald-600 dark:text-emerald-400">
            <NumberPopIn value={essays.length} />
          </p>
        </Card>

        <Card className="p-4 sm:p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 shadow-2xs flex items-center justify-between gap-3">
          <div>
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400 block">
              {lang === 'vi' ? 'Điểm tin cậy TB' : 'Average CIS'}
            </span>
            <p className="mt-1.5 text-2xl sm:text-3xl font-bold font-mono tabular-nums text-violet-600 dark:text-violet-400">
              {analytics ? `${avgCisSafe.toFixed(1)}` : '—'}
            </p>
          </div>
          <ScoreRing
            data-testid="cohort-cis-ring"
            value={avgCisSafe}
            size={46}
            thickness={4.5}
            color="#8b5cf6"
          />
        </Card>

        <Card className="p-4 sm:p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 shadow-2xs flex items-center justify-between gap-3">
          <div>
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400 block">
              {lang === 'vi' ? 'Tài liệu mới (≤ 5 năm)' : '5-Year Recency'}
            </span>
            <p className="mt-1.5 text-2xl sm:text-3xl font-bold font-mono tabular-nums text-amber-600 dark:text-amber-400">
              {analytics ? `${recencySafe.toFixed(1)}%` : '—'}
            </p>
          </div>
          <ScoreRing
            data-testid="cohort-recency-ring"
            value={recencySafe}
            size={46}
            thickness={4.5}
            color="#f59e0b"
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
                  <span
                    data-testid="cohort-queued-essays-pill"
                    className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-amber-50 dark:bg-amber-950/80 border border-amber-200/80 dark:border-amber-800/80 text-xs font-medium text-amber-700 dark:text-amber-300"
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
                    className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-rose-50 dark:bg-rose-950/80 border border-rose-200/80 dark:border-rose-800/80 text-xs font-medium text-rose-700 dark:text-rose-300"
                  >
                    <AlertCircle className="h-3 w-3" />
                    {lang === 'vi'
                      ? `${analytics.failed_essays} bài lỗi xử lý`
                      : `${analytics.failed_essays} failed`}
                  </span>
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
                label: lang === 'vi' ? 'Hợp lệ' : 'Verified',
                colorHex: '#10b981',
                barClass: 'bg-emerald-500',
                pillClass:
                  'bg-emerald-50 dark:bg-emerald-950/70 border-emerald-200/80 dark:border-emerald-800/80 text-emerald-700 dark:text-emerald-300',
              },
              {
                key: 'metadata_error',
                count: vb.metadata_error ?? 0,
                label: lang === 'vi' ? 'Sai lệch thông tin' : 'Metadata Discrepancy',
                colorHex: '#f59e0b',
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
                colorHex: '#fb923c',
                barClass: 'bg-orange-400',
                pillClass:
                  'bg-orange-50 dark:bg-orange-950/70 border-orange-200/80 dark:border-orange-800/80 text-orange-700 dark:text-orange-300',
              },
              {
                key: 'suspected_hallucination',
                count: vb.suspected_hallucination ?? 0,
                label: lang === 'vi' ? 'Nghi vấn ngụy tạo' : 'Suspected Fabrication',
                colorHex: '#f43f5e',
                barClass: 'bg-rose-500',
                pillClass:
                  'bg-rose-50 dark:bg-rose-950/70 border-rose-200/80 dark:border-rose-800/80 text-rose-700 dark:text-rose-300',
              },
              {
                key: 'unresolved',
                count: vb.unresolved ?? 0,
                label: lang === 'vi' ? 'Chờ kiểm tra' : 'Unresolved',
                colorHex: '#94a3b8',
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
                colorHex: '#0ea5e9',
                barClass: 'bg-sky-500',
                pillClass:
                  'bg-sky-50 dark:bg-sky-950/70 border-sky-200/80 dark:border-sky-800/80 text-sky-700 dark:text-sky-300',
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
                        {lang === 'vi' ? 'trích dẫn' : 'citations'}
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

              <div className="p-4 rounded-2xl bg-slate-50/80 dark:bg-slate-950/60 border border-slate-200/80 dark:border-slate-800">
                <p className="text-xs font-semibold text-slate-700 dark:text-slate-200 mb-2.5">
                  {lang === 'vi'
                    ? 'Lỗi trích dẫn thường gặp nhất trong lớp'
                    : 'Most Common Citation Issues'}
                </p>
                {(analytics.top_triggered_rules ?? []).length === 0 ? (
                  <p className="text-xs text-slate-400">
                    {lang === 'vi'
                      ? 'Chưa ghi nhận lỗi trích dẫn phổ biến nào.'
                      : 'No recurring citation issues detected yet.'}
                  </p>
                ) : (
                  <div className="space-y-2">
                    {(() => {
                      const rules = analytics.top_triggered_rules ?? [];
                      const maxRuleCount = Math.max(1, ...rules.map((r) => r.count));
                      return rules.map((r) => (
                        <ProportionalBarRow
                          key={r.rule_id}
                          label={getRuleDisplayName(r.rule_id, lang)}
                          count={`×${r.count}`}
                          value={r.count}
                          max={maxRuleCount}
                          barClass="bg-amber-500"
                        />
                      ));
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
                      ? 'Nguồn lỗi xuất hiện ở các bài nộp'
                      : 'Flagged Citations Across Submissions'}
                  </p>
                  <span className="text-xs text-slate-400">
                    {(analytics.shared_hallucinations ?? []).length}{' '}
                    {lang === 'vi' ? 'mục' : 'items'}
                  </span>
                </div>

                {(analytics.shared_hallucinations ?? []).length === 0 ? (
                  <div className="py-10 text-center text-xs text-slate-400">
                    {lang === 'vi'
                      ? 'Chưa phát hiện trích dẫn nghi vấn trùng lặp nào giữa các bài nộp.'
                      : 'No shared or repeated citation warnings detected across this class.'}
                  </div>
                ) : (
                  <div className="space-y-2.5 max-h-64 overflow-y-auto pr-1">
                    {(analytics.shared_hallucinations ?? []).map((item, idx) => {
                      const meta = getHumanVerdictMeta(item.label, lang);
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
                              className={`px-2 py-0.5 rounded-md border text-[11px] font-semibold ${meta.badgeClass}`}
                            >
                              {meta.label}
                            </span>
                            <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                              {item.is_shared
                                ? lang === 'vi'
                                  ? `Trùng ở ${item.essay_ids.length} bài (${item.students.join(', ')})`
                                  : `Shared in ${item.essay_ids.length} papers (${item.students.join(', ')})`
                                : item.students.join(', ')}
                            </span>
                          </div>
                          <p className="font-serif text-xs text-slate-800 dark:text-slate-200 line-clamp-2">
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
            students.map((s) => (
              <div
                key={s.id}
                className="flex items-center justify-between px-5 py-3.5 hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-8 h-8 rounded-full bg-indigo-50 dark:bg-indigo-950/80 border border-indigo-200/70 dark:border-indigo-800/70 flex items-center justify-center text-xs font-bold text-indigo-700 dark:text-indigo-300 shrink-0 uppercase">
                    {(s.full_name || s.username).slice(0, 1)}
                  </div>
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

      {/* Class Submissions */}
      <section className="rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm overflow-hidden">
        <StudioWindowHeader
          title={lang === 'vi' ? 'BÀI NỘP CỦA LỚP' : 'CLASS SUBMISSIONS'}
          badge={
            <Badge variant="secondary" className="font-mono text-[11px]">
              {essays.length}
            </Badge>
          }
        />

        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          {essays.length === 0 ? (
            <div className="p-10 text-center space-y-1">
              <FileText className="h-6 w-6 text-slate-300 dark:text-slate-600 mx-auto mb-1" />
              <p className="text-sm text-slate-500">{t('teacher.noSubmissionsYet')}</p>
            </div>
          ) : (
            essays.map((e) => {
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

              return (
                <Link
                  key={e.id}
                  to={targetHref}
                  data-testid={`class-essay-row-${e.id}`}
                  title={isFailed && e.job_error ? e.job_error : undefined}
                  className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 hover:bg-slate-50 dark:hover:bg-slate-800/50 focus:outline-none focus:bg-slate-50 dark:focus:bg-slate-800/50 transition-colors group"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <FileFormatIcon filename={e.filename} size="sm" />
                    <div className="min-w-0">
                      <p className="font-medium text-sm text-slate-900 dark:text-slate-100 truncate group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                        {e.filename}
                      </p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {e.username ?? '—'} • {e.num_pages} {t('teacher.pages')}
                        {e.uploaded_at
                          ? ` • ${new Date(e.uploaded_at).toLocaleDateString()}`
                          : ''}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2.5 shrink-0">
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
                            <span className="text-xs font-mono font-bold text-slate-800 dark:text-slate-200 tabular-nums">
                              CIS {cisVal.toFixed(1)}%
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

      {editOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="edit-class-modal-title"
          onClick={() => setEditOpen(false)}
        >
          <div
            className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 max-w-md w-full p-5 shadow-2xl space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h2
              id="edit-class-modal-title"
              className="font-display text-lg font-bold text-slate-900 dark:text-white"
            >
              {lang === 'vi' ? 'Chỉnh sửa lớp học' : 'Edit Class'}
            </h2>
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
        </div>
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
