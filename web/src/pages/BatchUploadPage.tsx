import { useCallback, useState, useRef, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  Upload,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Clock,
  RefreshCw,
  ExternalLink,
  Trash2,
  Layers,
  GraduationCap,
  ArrowRight,
  ShieldCheck,
} from 'lucide-react';
import { api } from '../api/client';
import { useRole } from '@/hooks/useRole';
import type { Class } from '@/api/client';
import {
  BATCH_CONCURRENCY,
  batchTiming,
  useVerificationProgress,
  type BatchFileItem,
  type BatchFileStatus,
} from '@/contexts/VerificationProgressContext';
import { FileFormatIcon } from '@/components/FileFormatIcon';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Select } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { UpgradeModal } from '@/components/UpgradeModal';
import { isUnlimitedValue } from '@/lib/quotaDisplay';
import {
  NumberPopIn,
  MatrixDotLoader,
  SuccessCheck,
  AvatarGroupHover,
} from '@/components/ui/transitions';

export { BATCH_CONCURRENCY, batchTiming };

/* ============================================================
   Batch Upload Page (Scholarly Precision shadcn/ui v2.0)
   Upload multiple PDFs for concurrent analysis with persistent
   background queue across SPA route transitions.
   ============================================================ */

const ACCEPTED_EXTENSIONS = ['.pdf', '.docx', '.bib', '.ris'];

function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(2) + ' MB';
}

function getStatusIcon(status: BatchFileStatus) {
  switch (status) {
    case 'pending':
      return <Clock className="h-4 w-4 text-slate-400" />;
    case 'queued':
      return <Clock className="h-4 w-4 text-amber-500 animate-pulse" />;
    case 'uploading':
    case 'processing':
      return <MatrixDotLoader variant="scan" className="text-indigo-500" />;
    case 'completed':
      return <SuccessCheck size={16} className="text-emerald-500" />;
    case 'failed':
      return <AlertCircle className="h-4 w-4 text-red-500" />;
  }
}

function getStatusVariant(
  status: BatchFileStatus,
): 'muted' | 'secondary' | 'default' | 'verified' | 'destructive' {
  switch (status) {
    case 'pending':
      return 'muted';
    case 'queued':
      return 'secondary';
    case 'uploading':
    case 'processing':
      return 'default';
    case 'completed':
      return 'verified';
    case 'failed':
      return 'destructive';
  }
}

function getStatusText(
  status: BatchFileStatus,
  progress: number,
  t: TFunction,
  lang: 'en' | 'vi',
  queuePosition?: number | null,
): string {
  switch (status) {
    case 'pending':
      return t('batchUpload.pending');
    case 'queued':
      return queuePosition != null
        ? lang === 'vi'
          ? `Đang xếp hàng (#${queuePosition})`
          : `Queued (#${queuePosition})`
        : lang === 'vi'
          ? 'Đang xếp hàng'
          : 'Queued';
    case 'uploading':
      return t('batchUpload.uploading');
    case 'processing':
      return progress > 0
        ? `${t('batchUpload.processing')} ${progress}%`
        : `${t('batchUpload.processing')}...`;
    case 'completed':
      return t('batchUpload.complete');
    case 'failed':
      return t('batchUpload.failed');
  }
}

export function BatchUploadPage() {
  const { t, i18n } = useTranslation();
  const { isTeacher, isAdmin, planTier, quota, canBatchUpload } = useRole();
  const {
    batchFiles: files,
    batchQueueState: queueState,
    batchStats: stats,
    isBatchActive,
    batchTargetClassId: targetClassId,
    setBatchTargetClassId: setTargetClassId,
    addBatchFiles,
    removeBatchFile,
    clearBatchFiles,
    retryBatchFile,
    retryFailedBatchFiles,
    startBatchQueue,
    markBatchAutoNavigated,
    registerBatchPageMount,
  } = useVerificationProgress();

  const [quotaProblems, setQuotaProblems] = useState<string[]>([]);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [classes, setClasses] = useState<Class[]>([]);
  const [dragActive, setDragActive] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const navigateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMountedRef = useRef(true);
  const navigate = useNavigate();

  const lang = i18n.language?.startsWith('vi') ? 'vi' : 'en';

  useEffect(() => registerBatchPageMount(), [registerBatchPageMount]);

  useEffect(() => {
    if (isTeacher || isAdmin) {
      api
        .listMyClasses()
        .then(setClasses)
        .catch(() => setClasses([]));
    }
  }, [isTeacher, isAdmin]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (navigateTimerRef.current) clearTimeout(navigateTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (
      !queueState.isProcessing &&
      !queueState.hasAutoNavigated &&
      files.length > 0 &&
      stats.pending === 0 &&
      stats.processing === 0 &&
      stats.failed === 0 &&
      stats.completed > 0
    ) {
      const completedFiles = files.filter(
        (f) => f.status === 'completed' && f.essayId !== undefined,
      );
      if (completedFiles.length === 0) return;

      markBatchAutoNavigated();
      navigateTimerRef.current = setTimeout(() => {
        if (!isMountedRef.current) return;
        if (completedFiles.length === 1 && completedFiles[0].essayId) {
          navigate(`/verification/report/${completedFiles[0].essayId}`);
        } else {
          navigate('/history');
        }
      }, 1200);
    }
  }, [
    queueState.isProcessing,
    queueState.hasAutoNavigated,
    files,
    stats.pending,
    stats.processing,
    stats.failed,
    stats.completed,
    markBatchAutoNavigated,
    navigate,
  ]);

  /**
   * Client-side plan pre-check (mirrors backend quota) so users get an
   * UpgradeModal instead of a batch of 403/413 failures.
   */
  const checkBatchAgainstQuota = (pending: BatchFileItem[]): string[] => {
    if (isAdmin) {
      return [];
    }
    const plan = planTier.toUpperCase();
    const problems: string[] = [];
    if (!canBatchUpload) {
      problems.push(t('batchUpload.noBatchAccess', { plan }));
      return problems;
    }
    if (
      !isUnlimitedValue(quota.max_batch_files) &&
      pending.length > quota.max_batch_files
    ) {
      problems.push(
        t('batchUpload.tooManyFiles', {
          plan,
          max: quota.max_batch_files,
          count: pending.length,
        }),
      );
    }
    if (
      !isUnlimitedValue(quota.monthly_uploads_limit) &&
      pending.length > quota.monthly_uploads_remaining
    ) {
      problems.push(
        t('batchUpload.notEnoughUploads', {
          plan,
          remaining: Math.max(0, quota.monthly_uploads_remaining),
          count: pending.length,
        }),
      );
    }
    if (!isUnlimitedValue(quota.max_file_size_mb)) {
      const maxBytes = quota.max_file_size_mb * 1024 * 1024;
      for (const item of pending) {
        if (item.fileSize > maxBytes) {
          problems.push(
            t('batchUpload.fileTooLarge', {
              name: item.fileName,
              size: formatBytes(item.fileSize),
              plan,
              max: quota.max_file_size_mb,
            }),
          );
        }
      }
    }
    return problems;
  };

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') setDragActive(true);
    else if (e.type === 'dragleave') setDragActive(false);
  }, []);

  const addFiles = useCallback(
    (newFiles: File[]) => {
      if (newFiles.length === 0) return;
      if (navigateTimerRef.current) {
        clearTimeout(navigateTimerRef.current);
        navigateTimerRef.current = null;
      }
      addBatchFiles(newFiles);
    },
    [addBatchFiles],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragActive(false);

      const droppedFiles = Array.from(e.dataTransfer.files).filter((file) => {
        const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
        return ACCEPTED_EXTENSIONS.includes(ext);
      });

      addFiles(droppedFiles);
    },
    [addFiles],
  );

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const selectedFiles = Array.from(e.target.files);
      addFiles(selectedFiles);
      e.target.value = '';
    }
  };

  const removeFile = (id: string) => {
    removeBatchFile(id);
  };

  const clearAll = () => {
    if (navigateTimerRef.current) {
      clearTimeout(navigateTimerRef.current);
      navigateTimerRef.current = null;
    }
    clearBatchFiles();
  };

  const retryFile = (id: string) => {
    if (navigateTimerRef.current) {
      clearTimeout(navigateTimerRef.current);
      navigateTimerRef.current = null;
    }
    retryBatchFile(id);
  };

  const handleStartVerification = () => {
    if (files.length === 0 || queueState.isProcessing) return;
    const problems = checkBatchAgainstQuota(
      files.filter((f) => f.status === 'pending'),
    );
    setQuotaProblems(problems);
    if (problems.length > 0) {
      setUpgradeOpen(true);
      return;
    }
    if (navigateTimerRef.current) {
      clearTimeout(navigateTimerRef.current);
      navigateTimerRef.current = null;
    }
    void startBatchQueue();
  };

  const pendingCount = stats.pending;

  const queueMetrics = [
    {
      idx: '01',
      label: t('batchUpload.pending'),
      value: stats.pending,
      tone: 'text-slate-700 dark:text-slate-200',
      badge: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
    },
    {
      idx: '02',
      label: t('batchUpload.processing'),
      value: stats.processing,
      tone: 'text-indigo-600 dark:text-indigo-400',
      badge: 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300',
    },
    {
      idx: '03',
      label: t('batchUpload.completed'),
      value: stats.completed,
      tone: 'text-emerald-600 dark:text-emerald-400',
      badge: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
    },
    {
      idx: '04',
      label: t('batchUpload.failed'),
      value: stats.failed,
      tone: 'text-red-600 dark:text-red-400',
      badge: 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300',
    },
  ];

  return (
    <div className="max-w-5xl mx-auto space-y-6 pb-10">
      {/* Executive Header Banner */}
      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 p-5 sm:p-6 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2.5 flex-wrap">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-950/80 border border-indigo-200/70 dark:border-indigo-800/70 text-[11px] font-mono font-semibold text-indigo-700 dark:text-indigo-300">
              <Layers className="h-3 w-3" />
              {lang === 'vi'
                ? 'HÀNG ĐỢI ĐA BẢN THẢO · BATCH ENGINE'
                : 'MULTI-MANUSCRIPT QUEUE · BATCH ENGINE'}
            </span>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700 text-[11px] font-mono text-slate-600 dark:text-slate-300">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              {t('batchUpload.concurrentWorkers', { count: BATCH_CONCURRENCY })}
            </span>
          </div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-white">
            {t('batchUpload.title')}
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            {t('batchUpload.subtitle')}
          </p>
        </div>

        <Button
          asChild
          variant="outline"
          size="sm"
          className="h-10 rounded-xl font-medium shrink-0"
        >
          <Link to="/upload">
            <Upload className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
            <span>{t('nav.newCheck')}</span>
          </Link>
        </Button>
      </div>

      {/* Live Background Persistence Banner when Batch is Actively Processing */}
      {isBatchActive && (
        <div
          data-testid="batch-background-active-banner"
          className="rounded-2xl border border-indigo-200 dark:border-indigo-800/80 bg-indigo-50/85 dark:bg-indigo-950/45 px-4 py-3 space-y-2 text-xs text-indigo-900 dark:text-indigo-200 shadow-2xs"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <Loader2 className="h-4 w-4 text-indigo-600 dark:text-indigo-400 animate-spin shrink-0" />
              <p className="font-medium break-words [overflow-wrap:anywhere]">
                {t('batchUpload.backgroundActiveBanner')}
              </p>
            </div>
            <span className="font-mono text-[11px] font-semibold shrink-0">
              {stats.completed}/{files.length}
              {stats.queued > 0
                ? lang === 'vi'
                  ? ` · ${stats.queued} xếp hàng`
                  : ` · ${stats.queued} queued`
                : ''}
            </span>
          </div>
          <div data-testid="batch-overall-progress">
            <Progress
              value={
                files.length > 0
                  ? Math.round(
                      files.reduce(
                        (sum, f) =>
                          sum +
                          (f.status === 'completed' || f.status === 'failed'
                            ? 100
                            : f.status === 'processing' ||
                                f.status === 'uploading'
                              ? Math.max(5, f.progress || 0)
                              : 0),
                        0,
                      ) / files.length,
                    )
                  : 0
              }
            />
          </div>
        </div>
      )}

      {/* Completed-in-Background Notice when User Returns After All-Succeeded Batch */}
      {!isBatchActive &&
        queueState.hasAutoNavigated &&
        stats.completed > 0 &&
        stats.pending === 0 &&
        stats.failed === 0 && (
          <div
            data-testid="batch-background-completed-notice"
            className="rounded-2xl border border-emerald-200 dark:border-emerald-800/80 bg-emerald-50/85 dark:bg-emerald-950/35 px-4 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-emerald-950 dark:text-emerald-200 shadow-2xs"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <span className="font-semibold break-words [overflow-wrap:anywhere]">
                {t('batchUpload.backgroundCompletedNotice', {
                  completed: stats.completed,
                  total: files.length,
                })}
              </span>
            </div>
            <Button
              asChild
              size="sm"
              className="h-8 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold shrink-0 w-full sm:w-auto"
            >
              <Link to="/history">
                <span>{t('batchUpload.openHistory')}</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </Button>
          </div>
        )}

      {/* Mixed-Outcome Summary Banner when Batch Finishes with Both Completed & Failed Items */}
      {!isBatchActive &&
        stats.pending === 0 &&
        stats.processing === 0 &&
        stats.completed > 0 &&
        stats.failed > 0 && (
          <div
            data-testid="batch-mixed-outcome-banner"
            className="rounded-2xl border border-amber-300/90 dark:border-amber-800/80 bg-amber-50/85 dark:bg-amber-950/35 px-4 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-amber-950 dark:text-amber-200 shadow-2xs"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
              <span className="font-semibold break-words [overflow-wrap:anywhere]">
                {lang === 'vi'
                  ? `${stats.completed} hoàn tất, ${stats.failed} thất bại (đã tự động hoàn lượt)`
                  : `${stats.completed} completed, ${stats.failed} failed (credits automatically refunded)`}
              </span>
            </div>
            {files.some(
              (f) => f.status === 'failed' && Boolean(f.file || f.essayId != null),
            ) && (
              <Button
                type="button"
                size="sm"
                data-testid="batch-retry-failed-btn"
                onClick={() => {
                  if (navigateTimerRef.current) {
                    clearTimeout(navigateTimerRef.current);
                    navigateTimerRef.current = null;
                  }
                  retryFailedBatchFiles();
                }}
                className="h-8 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold shrink-0 w-full sm:w-auto"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                <span>
                  {lang === 'vi' ? 'Thử lại tệp lỗi' : 'Retry Failed'}
                </span>
              </Button>
            )}
          </div>
        )}

      {/* 4 Queue Telemetry Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {queueMetrics.map((m) => (
          <Card
            key={m.idx}
            className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 shadow-2xs"
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                {m.label}
              </span>
              <span
                className={`text-[10px] font-mono font-semibold px-2 py-0.5 rounded-md ${m.badge}`}
              >
                {m.idx}
              </span>
            </div>
            <p className={`text-2xl font-bold font-mono tabular-nums ${m.tone}`}>
              <NumberPopIn value={m.value} />
            </p>
          </Card>
        ))}
      </div>

      {/* Main IDE Batch Ingestion Container */}
      <Card className="p-0 overflow-hidden rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm">
        {/* Top Window Chrome */}
        <div className="px-4 sm:px-6 py-3.5 bg-slate-50/80 dark:bg-slate-900/90 border-b border-slate-200/80 dark:border-slate-800 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-red-400/80 inline-block" />
              <span className="w-2.5 h-2.5 rounded-full bg-amber-400/80 inline-block" />
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400/80 inline-block" />
            </div>
            <Separator orientation="vertical" className="h-4" />
            <span className="font-mono text-xs text-slate-700 dark:text-slate-300 font-semibold">
              batch_ingest_queue.py · {files.length}{' '}
              {t('batchUpload.files').toLowerCase()}
            </span>
          </div>

          <Badge
            variant="outline"
            className="font-mono text-[11px] bg-white dark:bg-slate-950 text-slate-600 dark:text-slate-400"
          >
            {t('batchUpload.pdfOnly')}
          </Badge>
        </div>

        <div className="p-4 sm:p-8 space-y-6">
          {/* Class selector (teacher/admin only) */}
          {(isTeacher || isAdmin) && classes.length > 0 && (
            <div className="p-4 rounded-2xl bg-slate-50/80 dark:bg-slate-950/60 border border-slate-200/80 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20">
                  <GraduationCap className="h-5 w-5" />
                </div>
                <div>
                  <Label
                    htmlFor="batch-class-select"
                    className="font-semibold text-sm text-slate-900 dark:text-white"
                  >
                    {t('batchUpload.assignToClass')}
                  </Label>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    {t('batchUpload.assignToClassHint')}
                  </p>
                </div>
              </div>

              <div className="sm:w-64 shrink-0">
                <Select
                  id="batch-class-select"
                  value={targetClassId ?? ''}
                  onChange={(e) =>
                    setTargetClassId(
                      e.target.value ? Number(e.target.value) : null,
                    )
                  }
                  wrapperClassName="w-full"
                >
                  <option value="">{t('batchUpload.noClassAssigned')}</option>
                  {classes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
          )}

          {/* Dropzone */}
          <div
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`
              relative border-2 border-dashed rounded-2xl p-6 sm:p-10 text-center transition-all duration-200 cursor-pointer
              ${
                dragActive
                  ? 'border-indigo-500 bg-indigo-50/70 dark:bg-indigo-950/50 scale-[1.01]'
                  : 'border-slate-300 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-950/50 hover:border-indigo-400 dark:hover:border-indigo-500 hover:bg-indigo-50/30 dark:hover:bg-slate-900'
              }
            `}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.docx,.bib,.ris"
              multiple
              onChange={handleFileInput}
              className="hidden"
            />

            <AvatarGroupHover className="flex items-center justify-center gap-2.5 mb-3.5">
              <FileFormatIcon format="pdf" size="md" />
              <FileFormatIcon format="docx" size="md" />
              <div className="w-14 h-14 rounded-2xl bg-indigo-50 dark:bg-indigo-950 border border-indigo-200/70 dark:border-indigo-800/70 flex items-center justify-center shadow-2xs">
                <Upload className="h-7 w-7 text-indigo-600 dark:text-indigo-400" />
              </div>
              <FileFormatIcon format="bib" size="md" />
              <FileFormatIcon format="ris" size="md" />
            </AvatarGroupHover>
            <p className="font-display text-lg font-bold text-slate-900 dark:text-white mb-1">
              {t('batchUpload.dropPdfs')}
            </p>
            <p className="text-xs font-mono text-slate-500 dark:text-slate-400 mb-3">
              {t('batchUpload.orClickBrowse')} · {t('batchUpload.pdfOnly')}
            </p>
          </div>

          {/* Author authorization & cross-border scholarly API notice (DLCN-02) */}
          <div
            data-testid="batch-upload-privacy-notice"
            className="rounded-[14px] border border-amber-300/80 dark:border-amber-800/60 bg-amber-50/65 dark:bg-amber-950/25 px-4 py-3.5 flex items-start gap-3 font-solva-sans text-[12px] leading-[19px] text-amber-950 dark:text-amber-200 transition-colors"
          >
            <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-[7px] bg-white/90 dark:bg-amber-950/70 border border-amber-300/80 dark:border-amber-800 text-amber-700 dark:text-amber-300 shadow-2xs">
              <ShieldCheck className="h-3.5 w-3.5" />
            </span>
            <div className="min-w-0">
              <span className="font-semibold">
                {t('privacyCompliance.batchNoticeTitle')}:{' '}
              </span>
              {t('privacyCompliance.batchNoticeBody')}{' '}
              <Link
                to="/privacy#third-parties"
                className="inline-flex items-center gap-1 font-semibold underline underline-offset-3 hover:opacity-80 transition-opacity"
              >
                <span>{t('privacyCompliance.policyLinkLabel')}</span>
                <ArrowRight className="h-3 w-3" />
              </Link>
              .
            </div>
          </div>

          {/* File List */}
          {files.length > 0 && (
            <div className="space-y-3 pt-2">
              <div className="flex items-center justify-between">
                <h2 className="font-mono text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300">
                  {t('batchUpload.files')} ({files.length})
                </h2>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={clearAll}
                  disabled={queueState.isProcessing}
                  className="h-8 text-xs text-red-600 dark:text-red-400 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/40 rounded-xl"
                >
                  {t('batchUpload.clearAll')}
                </Button>
              </div>

              <div className="space-y-2.5 max-h-[380px] overflow-y-auto pr-1">
                {files.map((fileItem, idx) => (
                  <div
                    key={fileItem.id}
                    className="flex flex-wrap sm:flex-nowrap items-center gap-2.5 sm:gap-3.5 px-3.5 sm:px-4 py-3 rounded-xl bg-slate-50/70 dark:bg-slate-950/70 border border-slate-200/80 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 transition-colors overflow-hidden"
                  >
                    <span className="font-mono text-xs font-bold px-2 py-0.5 rounded bg-slate-200/70 dark:bg-slate-800 text-slate-700 dark:text-slate-300 shrink-0">
                      #{idx + 1}
                    </span>

                    <FileFormatIcon filename={fileItem.fileName} size="sm" />

                    <div className="flex-1 min-w-0">
                      <p
                        className="text-sm font-semibold text-slate-900 dark:text-white truncate"
                        title={fileItem.fileName}
                      >
                        {fileItem.fileName}
                      </p>
                      <p className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                        {formatBytes(fileItem.fileSize)}
                        {fileItem.essayId && ` · ID #${fileItem.essayId}`}
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5 shrink-0 ml-auto sm:ml-0">
                      {getStatusIcon(fileItem.status)}
                      <Badge
                        variant={getStatusVariant(fileItem.status)}
                        className={`font-mono text-[11px] ${
                          fileItem.status === 'queued'
                            ? 'bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800'
                            : ''
                        }`}
                      >
                        {getStatusText(
                          fileItem.status,
                          fileItem.progress,
                          t,
                          lang,
                          fileItem.queuePosition,
                        )}
                      </Badge>

                      {fileItem.status === 'failed' &&
                        fileItem.quotaCharged === false && (
                          <span
                            data-testid={`batch-refund-badge-${fileItem.id}`}
                            className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-mono font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800/70"
                          >
                            {lang === 'vi' ? 'Đã hoàn lượt' : 'Credit Refunded'}
                          </span>
                        )}

                      {fileItem.status === 'completed' &&
                        (fileItem.documentDiagnostics?.ocr_pages_recovered
                          ?.length ?? 0) > 0 && (
                          <span
                            data-testid={`batch-ocr-chip-${fileItem.id}`}
                            className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200 dark:bg-indigo-950/50 dark:text-indigo-300 dark:border-indigo-800/70"
                          >
                            OCR:{' '}
                            {
                              fileItem.documentDiagnostics!.ocr_pages_recovered!
                                .length
                            }
                            p
                          </span>
                        )}

                      {fileItem.status === 'completed' &&
                        fileItem.documentDiagnostics
                          ?.legacy_encoding_detected && (
                          <span
                            data-testid={`batch-encoding-chip-${fileItem.id}`}
                            className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold bg-violet-50 text-violet-700 border border-violet-200 dark:bg-violet-950/50 dark:text-violet-300 dark:border-violet-800/70"
                          >
                            TCVN3/VNI -&gt; Unicode
                          </span>
                        )}
                    </div>

                    {(fileItem.status === 'processing' ||
                      fileItem.status === 'uploading' ||
                      fileItem.status === 'queued') && (
                      <div className="w-full sm:w-24 shrink-0">
                        <Progress value={fileItem.progress} />
                      </div>
                    )}

                    <div className="flex items-center gap-1 shrink-0">
                      {fileItem.status === 'completed' && fileItem.essayId && (
                        <button
                          onClick={() =>
                            navigate(`/verification/report/${fileItem.essayId}`)
                          }
                          className="p-2 rounded-lg text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/50 transition-colors"
                          title={t('dashboard.viewReport')}
                        >
                          <ExternalLink className="h-4 w-4" />
                        </button>
                      )}
                      {fileItem.status === 'failed' &&
                        Boolean(fileItem.file || fileItem.essayId != null) && (
                          <button
                            onClick={() => retryFile(fileItem.id)}
                            disabled={queueState.isProcessing}
                            className="p-2 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors disabled:opacity-50"
                            title={t('common.retry')}
                          >
                            <RefreshCw className="h-4 w-4 text-slate-500 dark:text-slate-400" />
                          </button>
                        )}
                      {!queueState.isProcessing && (
                        <button
                          onClick={() => removeFile(fileItem.id)}
                          className="p-2 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                          title={t('common.delete')}
                        >
                          <Trash2 className="h-4 w-4 text-slate-400 hover:text-red-500" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {files
                .filter((f) => f.error)
                .map((f) => (
                  <div
                    key={f.id}
                    className="text-xs font-mono text-red-600 dark:text-red-400 px-3 py-2 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/60 break-words [overflow-wrap:anywhere]"
                  >
                    {f.fileName}: {f.error}
                  </div>
                ))}
            </div>
          )}

          {quotaProblems.length > 0 && (
            <div
              role="alert"
              data-testid="batch-quota-errors"
              className="space-y-1 text-xs text-amber-800 dark:text-amber-200 px-3 py-2.5 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60"
            >
              <p className="font-semibold">{t('batchUpload.limitTitle')}</p>
              {quotaProblems.map((p) => (
                <p key={p}>{p}</p>
              ))}
            </div>
          )}

          {/* Action Footer */}
          <div className="pt-4 border-t border-slate-200/80 dark:border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-4">
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {t('batchUpload.disclaimer')}
            </p>

            <div className="flex flex-col sm:flex-row items-center gap-3 w-full sm:w-auto">
              {!queueState.isProcessing &&
                !queueState.hasAutoNavigated &&
                files.length > 0 &&
                stats.pending === 0 &&
                stats.processing === 0 && (
                  <>
                    {stats.completed > 0 && stats.failed === 0 ? (
                      <span className="text-xs font-mono text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        {t('batchUpload.allProcessedOpening')}
                      </span>
                    ) : stats.completed === 0 ? (
                      <span className="text-xs font-mono text-red-600 dark:text-red-400">
                        {t('batchUpload.allFailedNotice')}
                      </span>
                    ) : null}
                  </>
                )}

              <Button
                size="lg"
                onClick={handleStartVerification}
                disabled={pendingCount === 0 || queueState.isProcessing}
                className="w-full sm:w-auto h-11 px-7 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold shadow-md shadow-indigo-600/20 btn-shimmer"
              >
                {queueState.isProcessing ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>{t('batchUpload.processing')}...</span>
                  </>
                ) : (
                  <>
                    <span>{t('batchUpload.startVerification')}</span>
                    <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      </Card>

      <UpgradeModal
        open={upgradeOpen}
        onOpenChange={setUpgradeOpen}
        featureName={t('batchUpload.upgradeFeature')}
        reasonTitle={t('batchUpload.limitTitle')}
        reasonDescription={quotaProblems.join(' ')}
      />
    </div>
  );
}
