import { useCallback, useState, useRef, useEffect, useMemo } from 'react';
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
} from 'lucide-react';
import { api } from '../api/client';
import { useRole } from '@/hooks/useRole';
import type { Class } from '@/api/client';
import { FileFormatIcon } from '@/components/FileFormatIcon';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Select } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { UpgradeModal } from '@/components/UpgradeModal';
import { runWithConcurrency } from '@/lib/concurrencyPool';
import { isUnlimitedValue } from '@/lib/quotaDisplay';

/* ============================================================
   Batch Upload Page (Scholarly Precision shadcn/ui v2.0)
   Upload multiple PDFs for concurrent analysis
   ============================================================ */

const ACCEPTED_EXTENSIONS = ['.pdf', '.docx', '.bib', '.ris'];

type FileStatus = 'pending' | 'uploading' | 'processing' | 'completed' | 'failed';

interface BatchFileItem {
  id: string;
  file: File;
  status: FileStatus;
  progress: number;
  essayId?: number;
  error?: string;
}

interface QueueState {
  isProcessing: boolean;
  currentIndex: number;
  hasAutoNavigated: boolean;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(2) + ' MB';
}

function getStatusIcon(status: FileStatus) {
  switch (status) {
    case 'pending':
      return <Clock className="h-4 w-4 text-slate-400" />;
    case 'uploading':
    case 'processing':
      return <Loader2 className="h-4 w-4 text-indigo-500 animate-spin" />;
    case 'completed':
      return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
    case 'failed':
      return <AlertCircle className="h-4 w-4 text-red-500" />;
  }
}

function getStatusVariant(status: FileStatus): 'muted' | 'default' | 'verified' | 'destructive' {
  switch (status) {
    case 'pending':
      return 'muted';
    case 'uploading':
    case 'processing':
      return 'default';
    case 'completed':
      return 'verified';
    case 'failed':
      return 'destructive';
  }
}

function getStatusText(status: FileStatus, progress: number, t: TFunction): string {
  switch (status) {
    case 'pending':
      return t('batchUpload.pending');
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

/** Number of files uploaded + polled at the same time. */
export const BATCH_CONCURRENCY = 3;

/** Status poll timing (mutable so tests can shorten the interval). */
export const batchTiming = { pollIntervalMs: 2000 };

export function BatchUploadPage() {
  const { t, i18n } = useTranslation();
  const { isTeacher, isAdmin, planTier, quota, canBatchUpload } = useRole();
  const [quotaProblems, setQuotaProblems] = useState<string[]>([]);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [classes, setClasses] = useState<Class[]>([]);
  const [targetClassId, setTargetClassId] = useState<number | null>(null);

  const lang = i18n.language?.startsWith('vi') ? 'vi' : 'en';

  useEffect(() => {
    if (isTeacher || isAdmin) {
      api
        .listMyClasses()
        .then(setClasses)
        .catch(() => setClasses([]));
    }
  }, [isTeacher, isAdmin]);

  const [files, setFiles] = useState<BatchFileItem[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [queueState, setQueueState] = useState<QueueState>({
    isProcessing: false,
    currentIndex: -1,
    hasAutoNavigated: false,
  });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const navigateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMountedRef = useRef(true);
  const navigate = useNavigate();

  const stats = useMemo(
    () => ({
      pending: files.filter((f) => f.status === 'pending').length,
      processing: files.filter(
        (f) => f.status === 'uploading' || f.status === 'processing'
      ).length,
      completed: files.filter((f) => f.status === 'completed').length,
      failed: files.filter((f) => f.status === 'failed').length,
    }),
    [files]
  );

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
      stats.completed > 0
    ) {
      const completedFiles = files.filter(
        (f) => f.status === 'completed' && f.essayId !== undefined
      );
      if (completedFiles.length === 0) return;

      setQueueState((prev) => ({ ...prev, hasAutoNavigated: true }));
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
    stats.completed,
    navigate,
  ]);

  const setFileState = useCallback((id: string, patch: Partial<BatchFileItem>) => {
    setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  }, []);

  /** Upload one file and poll its pipeline status until it settles. */
  const processOne = useCallback(
    async (fileItem: BatchFileItem) => {
      if (!isMountedRef.current) return;
      setFileState(fileItem.id, { status: 'uploading' });
      try {
        const response = await api.uploadEssay(fileItem.file, targetClassId);
        if (!isMountedRef.current) return;
        setFileState(fileItem.id, {
          status: 'processing',
          essayId: response.essay_id,
          progress: 0,
        });

        let attempts = 0;
        const maxAttempts = 150;
        while (attempts < maxAttempts && isMountedRef.current) {
          await new Promise((resolve) => setTimeout(resolve, batchTiming.pollIntervalMs));
          if (!isMountedRef.current) return;
          attempts++;

          try {
            const status = await api.getEssayStatus(response.essay_id);
            if (!isMountedRef.current) return;
            if (status.status === 'completed') {
              setFileState(fileItem.id, { status: 'completed', progress: 100 });
              return;
            }
            if (status.status === 'failed') {
              setFileState(fileItem.id, {
                status: 'failed',
                error: status.error || 'Processing failed',
              });
              return;
            }
            const progress = Math.round(
              (status.step_index / Math.max(1, status.total_steps)) * 100
            );
            setFileState(fileItem.id, { status: 'processing', progress });
          } catch {
            // Continue polling
          }
        }

        if (attempts >= maxAttempts && isMountedRef.current) {
          setFileState(fileItem.id, { status: 'failed', error: 'Processing timeout' });
        }
      } catch (error) {
        if (!isMountedRef.current) return;
        setFileState(fileItem.id, {
          status: 'failed',
          error: error instanceof Error ? error.message : 'Upload failed',
        });
      }
    },
    [setFileState, targetClassId]
  );

  const processQueue = useCallback(async () => {
    const pendingFiles = files.filter((f) => f.status === 'pending');
    if (pendingFiles.length === 0) {
      setQueueState({
        isProcessing: false,
        currentIndex: -1,
        hasAutoNavigated: false,
      });
      return;
    }

    setQueueState({
      isProcessing: true,
      currentIndex: 0,
      hasAutoNavigated: false,
    });

    // Real concurrency pool: up to BATCH_CONCURRENCY files upload + poll in parallel.
    await runWithConcurrency(pendingFiles, BATCH_CONCURRENCY, processOne);

    if (!isMountedRef.current) return;
    setQueueState({
      isProcessing: false,
      currentIndex: -1,
      hasAutoNavigated: false,
    });
  }, [files, processOne]);

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
    if (!isUnlimitedValue(quota.max_batch_files) && pending.length > quota.max_batch_files) {
      problems.push(
        t('batchUpload.tooManyFiles', { plan, max: quota.max_batch_files, count: pending.length })
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
        })
      );
    }
    if (!isUnlimitedValue(quota.max_file_size_mb)) {
      const maxBytes = quota.max_file_size_mb * 1024 * 1024;
      for (const item of pending) {
        if (item.file.size > maxBytes) {
          problems.push(
            t('batchUpload.fileTooLarge', {
              name: item.file.name,
              size: formatBytes(item.file.size),
              plan,
              max: quota.max_file_size_mb,
            })
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

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    const droppedFiles = Array.from(e.dataTransfer.files).filter((file) => {
      const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
      return ACCEPTED_EXTENSIONS.includes(ext);
    });

    addFiles(droppedFiles);
  }, []);

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const selectedFiles = Array.from(e.target.files);
      addFiles(selectedFiles);
    }
  };

  const addFiles = (newFiles: File[]) => {
    const batchFiles: BatchFileItem[] = newFiles.map((file) => ({
      id: crypto.randomUUID(),
      file,
      status: 'pending',
      progress: 0,
    }));
    setFiles((prev) => [...prev, ...batchFiles]);
    if (navigateTimerRef.current) {
      clearTimeout(navigateTimerRef.current);
      navigateTimerRef.current = null;
    }
    setQueueState((prev) => ({ ...prev, hasAutoNavigated: false }));
  };

  const removeFile = (id: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== id));
  };

  const clearAll = () => {
    setFiles([]);
    if (navigateTimerRef.current) {
      clearTimeout(navigateTimerRef.current);
      navigateTimerRef.current = null;
    }
    setQueueState({
      isProcessing: false,
      currentIndex: -1,
      hasAutoNavigated: false,
    });
  };

  const retryFile = (id: string) => {
    setFiles((prev) =>
      prev.map((f) =>
        f.id === id
          ? { ...f, status: 'pending', progress: 0, error: undefined }
          : f
      )
    );
    if (navigateTimerRef.current) {
      clearTimeout(navigateTimerRef.current);
      navigateTimerRef.current = null;
    }
    setQueueState((prev) => ({ ...prev, hasAutoNavigated: false }));
  };

  const handleStartVerification = () => {
    if (files.length === 0 || queueState.isProcessing) return;
    const problems = checkBatchAgainstQuota(files.filter((f) => f.status === 'pending'));
    setQuotaProblems(problems);
    if (problems.length > 0) {
      setUpgradeOpen(true);
      return;
    }
    if (navigateTimerRef.current) {
      clearTimeout(navigateTimerRef.current);
      navigateTimerRef.current = null;
    }
    setQueueState((prev) => ({ ...prev, hasAutoNavigated: false }));
    processQueue();
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
              <span className={`text-[10px] font-mono font-semibold px-2 py-0.5 rounded-md ${m.badge}`}>
                {m.idx}
              </span>
            </div>
            <p className={`text-2xl font-bold font-mono tabular-nums ${m.tone}`}>
              {m.value}
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
              batch_ingest_queue.py · {files.length} {t('batchUpload.files').toLowerCase()}
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
                  <Label htmlFor="batch-class-select" className="font-semibold text-sm text-slate-900 dark:text-white">
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
                    setTargetClassId(e.target.value ? Number(e.target.value) : null)
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

            <div className="flex items-center justify-center gap-2.5 mb-3.5">
              <FileFormatIcon format="pdf" size="md" />
              <FileFormatIcon format="docx" size="md" />
              <div className="w-14 h-14 rounded-2xl bg-indigo-50 dark:bg-indigo-950 border border-indigo-200/70 dark:border-indigo-800/70 flex items-center justify-center shadow-2xs">
                <Upload className="h-7 w-7 text-indigo-600 dark:text-indigo-400" />
              </div>
              <FileFormatIcon format="bib" size="md" />
              <FileFormatIcon format="ris" size="md" />
            </div>
            <p className="font-display text-lg font-bold text-slate-900 dark:text-white mb-1">
              {t('batchUpload.dropPdfs')}
            </p>
            <p className="text-xs font-mono text-slate-500 dark:text-slate-400 mb-3">
              {t('batchUpload.orClickBrowse')} · {t('batchUpload.pdfOnly')}
            </p>
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

                    <FileFormatIcon filename={fileItem.file.name} size="sm" />

                    <div className="flex-1 min-w-0">
                      <p
                        className="text-sm font-semibold text-slate-900 dark:text-white truncate"
                        title={fileItem.file.name}
                      >
                        {fileItem.file.name}
                      </p>
                      <p className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                        {formatBytes(fileItem.file.size)}
                        {fileItem.essayId && ` · ID #${fileItem.essayId}`}
                      </p>
                    </div>

                    <div className="flex items-center gap-2 shrink-0 ml-auto sm:ml-0">
                      {getStatusIcon(fileItem.status)}
                      <Badge variant={getStatusVariant(fileItem.status)} className="font-mono text-[11px]">
                        {getStatusText(fileItem.status, fileItem.progress, t)}
                      </Badge>
                    </div>

                    {(fileItem.status === 'processing' ||
                      fileItem.status === 'uploading') && (
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
                      {fileItem.status === 'failed' && (
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
                    {f.file.name}: {f.error}
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
                files.length > 0 &&
                stats.pending === 0 &&
                stats.processing === 0 && (
                  <>
                    {stats.completed > 0 ? (
                      <span className="text-xs font-mono text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        {t('batchUpload.allProcessedOpening')}
                      </span>
                    ) : (
                      <span className="text-xs font-mono text-red-600 dark:text-red-400">
                        {t('batchUpload.allFailedNotice')}
                      </span>
                    )}
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
