import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import { api, type EssayStatus } from '@/api/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { runWithConcurrency } from '@/lib/concurrencyPool';
import { queryClient } from '@/lib/queryClient';
import { streamEssayEvents } from '@/hooks/useEssayStream';

/* ============================================================
   VerificationProgressContext
   Global background progress & queue state for:
   1. Single Check ("Kiểm Tra Mới" — /upload & /verification/processing/:id)
   2. Batch Check ("Kiểm Tra Hàng Loạt" — /batch-upload)

   Survives SPA tab navigation in-memory (including File objects and
   active worker loops) and persists essay IDs/metadata to sessionStorage
   so browser refreshes (F5) also reconnect to in-flight backend pipelines.
   ============================================================ */

/** Number of files uploaded + polled at the same time in Batch Check. */
export const BATCH_CONCURRENCY = 3;

/** Status poll timing (mutable so Vitest suites can set 0ms). */
export const batchTiming = { pollIntervalMs: 2000 };
export const singlePollTiming = { pollIntervalMs: 2000 };

export const STEP_KEY_TO_INDEX: Record<string, number> = {
  parsing: 0,
  style_detection: 1,
  extracting: 2,
  linking: 3,
  retrieving: 4,
  comparing: 5,
  checking: 6,
  scoring: 7,
  done: 7,
};

export const TOTAL_PIPELINE_STEPS = 8;

export function computeSingleCheckProgress(snap: Pick<EssayStatus, 'status' | 'step' | 'step_index'>): number {
  if (snap.status === 'queued') return 0;
  if (snap.status === 'completed') return 100;
  const backendIndex = Math.min(
    STEP_KEY_TO_INDEX[snap.step] ?? snap.step_index ?? 0,
    TOTAL_PIPELINE_STEPS - 1,
  );
  return Math.round((backendIndex / TOTAL_PIPELINE_STEPS) * 100);
}

export type SingleCheckLifecycle =
  | 'uploading'
  | 'queued'
  | 'processing'
  | 'completed'
  | 'failed';

export interface ActiveSingleCheck {
  essayId: number | null;
  filename: string;
  fileSize: number;
  classId: number | null;
  status: SingleCheckLifecycle;
  step: string;
  stepIndex: number;
  totalSteps: number;
  progress: number;
  message: string;
  queuePosition: number | null;
  error: string | null;
  startedAt: number;
  acknowledged: boolean;
}

export type BatchFileStatus =
  | 'pending'
  | 'uploading'
  | 'processing'
  | 'completed'
  | 'failed';

export interface BatchFileItem {
  id: string;
  /** Present during SPA session; undefined only when hydrated after hard browser reload (F5). */
  file?: File;
  fileName: string;
  fileSize: number;
  status: BatchFileStatus;
  progress: number;
  essayId?: number;
  error?: string;
}

export interface BatchQueueState {
  isProcessing: boolean;
  currentIndex: number;
  hasAutoNavigated: boolean;
}

export interface BatchQueueStats {
  pending: number;
  processing: number;
  completed: number;
  failed: number;
  total: number;
}

interface PersistedBatchPayload {
  savedAt: number;
  targetClassId: number | null;
  hasAutoNavigated: boolean;
  files: Array<Omit<BatchFileItem, 'file'>>;
}

export interface VerificationProgressContextValue {
  // Single Check ("Kiểm Tra Mới")
  activeSingleCheck: ActiveSingleCheck | null;
  isSingleCheckInFlight: boolean;
  startSingleUpload: (
    file: File,
    classId: number | null,
  ) => Promise<{ essay_id: number }>;
  syncSingleCheckFromStatus: (
    essayId: number,
    snap: EssayStatus,
    filenameFallback?: string,
  ) => void;
  acknowledgeSingleCheck: (essayId?: number) => void;
  registerProcessingPageMount: (essayId: number | null) => () => void;
  registerUploadPageMount: () => () => void;

  // Batch Check ("Kiểm Tra Hàng Loạt")
  batchFiles: BatchFileItem[];
  batchQueueState: BatchQueueState;
  batchStats: BatchQueueStats;
  isBatchActive: boolean;
  batchTargetClassId: number | null;
  setBatchTargetClassId: (id: number | null) => void;
  addBatchFiles: (files: File[]) => void;
  removeBatchFile: (id: string) => void;
  clearBatchFiles: () => void;
  retryBatchFile: (id: string) => void;
  startBatchQueue: (overridePending?: BatchFileItem[]) => Promise<void>;
  markBatchAutoNavigated: () => void;
  registerBatchPageMount: () => () => void;
}

const SESSION_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

function singleStorageKey(userId: number): string {
  return `citra_single_check_v1_${userId}`;
}

function batchStorageKey(userId: number): string {
  return `citra_batch_check_v1_${userId}`;
}

function readPersistedSingle(userId: number): ActiveSingleCheck | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(singleStorageKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ActiveSingleCheck;
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      typeof parsed.startedAt !== 'number' ||
      Date.now() - parsed.startedAt > SESSION_TTL_MS
    ) {
      sessionStorage.removeItem(singleStorageKey(userId));
      return null;
    }
    // An interrupted raw HTTP upload (before receiving essayId) cannot resume after F5
    if (parsed.status === 'uploading' && parsed.essayId == null) {
      sessionStorage.removeItem(singleStorageKey(userId));
      return null;
    }
    if (parsed.acknowledged && (parsed.status === 'completed' || parsed.status === 'failed')) {
      sessionStorage.removeItem(singleStorageKey(userId));
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writePersistedSingle(userId: number, state: ActiveSingleCheck | null): void {
  if (typeof window === 'undefined') return;
  try {
    const key = singleStorageKey(userId);
    if (
      !state ||
      (state.status === 'uploading' && state.essayId == null) ||
      (state.acknowledged && (state.status === 'completed' || state.status === 'failed'))
    ) {
      sessionStorage.removeItem(key);
      return;
    }
    sessionStorage.setItem(key, JSON.stringify(state));
  } catch {
    // Ignore storage quota errors
  }
}

function readPersistedBatch(
  userId: number,
  interruptedMsg: string,
): PersistedBatchPayload | null {
  if (typeof window === 'undefined') return null;
  try {
    const key = batchStorageKey(userId);
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedBatchPayload;
    if (
      !parsed ||
      !Array.isArray(parsed.files) ||
      typeof parsed.savedAt !== 'number' ||
      Date.now() - parsed.savedAt > SESSION_TTL_MS
    ) {
      sessionStorage.removeItem(key);
      return null;
    }
    const normalizedFiles = parsed.files.map((item) => {
      if ((item.status === 'pending' || item.status === 'uploading') && item.essayId == null) {
        return {
          ...item,
          status: 'failed' as const,
          progress: 0,
          error: interruptedMsg,
        };
      }
      return item;
    });
    return {
      ...parsed,
      files: normalizedFiles,
    };
  } catch {
    return null;
  }
}

function writePersistedBatch(
  userId: number,
  files: BatchFileItem[],
  targetClassId: number | null,
  hasAutoNavigated: boolean,
): void {
  if (typeof window === 'undefined') return;
  try {
    const key = batchStorageKey(userId);
    if (files.length === 0) {
      sessionStorage.removeItem(key);
      return;
    }
    const payload: PersistedBatchPayload = {
      savedAt: Date.now(),
      targetClassId,
      hasAutoNavigated,
      files: files.map(({ file: _omit, ...rest }) => rest),
    };
    sessionStorage.setItem(key, JSON.stringify(payload));
  } catch {
    // Ignore storage quota errors
  }
}

const noopCleanup = () => {};

/**
 * Fallback context value so isolated unit tests that render UploadPage,
 * ProcessingPage, BatchUploadPage, or AppLayout without mounting
 * VerificationProgressProvider continue working seamlessly.
 */
const defaultContextValue: VerificationProgressContextValue = {
  activeSingleCheck: null,
  isSingleCheckInFlight: false,
  startSingleUpload: async (file, classId) => api.uploadEssay(file, classId),
  syncSingleCheckFromStatus: () => {},
  acknowledgeSingleCheck: () => {},
  registerProcessingPageMount: () => noopCleanup,
  registerUploadPageMount: () => noopCleanup,
  batchFiles: [],
  batchQueueState: {
    isProcessing: false,
    currentIndex: -1,
    hasAutoNavigated: false,
  },
  batchStats: {
    pending: 0,
    processing: 0,
    completed: 0,
    failed: 0,
    total: 0,
  },
  isBatchActive: false,
  batchTargetClassId: null,
  setBatchTargetClassId: () => {},
  addBatchFiles: () => {},
  removeBatchFile: () => {},
  clearBatchFiles: () => {},
  retryBatchFile: () => {},
  startBatchQueue: async () => {},
  markBatchAutoNavigated: () => {},
  registerBatchPageMount: () => noopCleanup,
};

const VerificationProgressContext =
  createContext<VerificationProgressContextValue>(defaultContextValue);

export interface VerificationProgressProviderProps {
  children: ReactNode;
  /** Optional navigation callback (e.g. router.navigate) for toast actions. */
  onNavigate?: (path: string) => void;
}

export function VerificationProgressProvider({
  children,
  onNavigate,
}: VerificationProgressProviderProps) {
  const { user, refreshUser } = useAuth();
  const toast = useToast();
  const { t } = useTranslation();

  const userId = user?.id ?? null;

  const [activeSingleCheck, setActiveSingleCheck] = useState<ActiveSingleCheck | null>(() =>
    userId != null ? readPersistedSingle(userId) : null,
  );
  const [mountedProcessingEssayId, setMountedProcessingEssayId] = useState<number | null>(null);
  const uploadPageMountedRef = useRef(false);
  const singleGenRef = useRef(0);

  const [batchFiles, setBatchFiles] = useState<BatchFileItem[]>([]);
  const batchFilesRef = useRef<BatchFileItem[]>([]);
  batchFilesRef.current = batchFiles;

  const [batchTargetClassId, setBatchTargetClassId] = useState<number | null>(null);
  const batchTargetClassIdRef = useRef<number | null>(null);
  batchTargetClassIdRef.current = batchTargetClassId;

  const [batchQueueState, setBatchQueueState] = useState<BatchQueueState>({
    isProcessing: false,
    currentIndex: -1,
    hasAutoNavigated: false,
  });
  const batchPageMountedRef = useRef(false);
  const batchGenRef = useRef(0);
  const batchStreamControllersRef = useRef<Set<AbortController>>(new Set());
  const hydratedUserIdRef = useRef<number | null>(null);

  const abortBatchStreams = useCallback(() => {
    batchStreamControllersRef.current.forEach((ctrl) => ctrl.abort());
    batchStreamControllersRef.current.clear();
  }, []);

  const updateBatchFiles = useCallback(
    (updater: BatchFileItem[] | ((prev: BatchFileItem[]) => BatchFileItem[])) => {
      setBatchFiles((prev) => {
        const next = typeof updater === 'function' ? updater(prev) : updater;
        batchFilesRef.current = next;
        return next;
      });
    },
    [],
  );

  const setBatchFilePatch = useCallback(
    (id: string, patch: Partial<BatchFileItem>) => {
      updateBatchFiles((prev) =>
        prev.map((item) => (item.id === id ? { ...item, ...patch } : item)),
      );
    },
    [updateBatchFiles],
  );

  /** Stream SSE (or fall back to HTTP polling) until completion/failure for a BatchFileItem. */
  const pollBatchEssayUntilSettled = useCallback(
    async (itemId: string, essayId: number, myGen: number) => {
      if (batchGenRef.current !== myGen) return;

      const streamController = new AbortController();
      batchStreamControllersRef.current.add(streamController);
      let settledByStream = false;
      try {
        settledByStream = await streamEssayEvents(
          essayId,
          (status) => {
            if (batchGenRef.current !== myGen) {
              streamController.abort();
              return;
            }
            if (status.status === 'completed') {
              setBatchFilePatch(itemId, { status: 'completed', progress: 100, error: undefined });
              return;
            }
            if (status.status === 'failed') {
              setBatchFilePatch(itemId, {
                status: 'failed',
                error: status.error || 'Processing failed',
              });
              return;
            }
            const progress = Math.round(
              (status.step_index / Math.max(1, status.total_steps)) * 100,
            );
            setBatchFilePatch(itemId, { status: 'processing', progress });
          },
          streamController.signal,
        );
      } finally {
        batchStreamControllersRef.current.delete(streamController);
      }

      if (settledByStream || batchGenRef.current !== myGen) {
        return;
      }

      let attempts = 0;
      const maxAttempts = 150;
      while (attempts < maxAttempts && batchGenRef.current === myGen) {
        await new Promise((resolve) => setTimeout(resolve, batchTiming.pollIntervalMs));
        if (batchGenRef.current !== myGen) return;
        attempts++;

        try {
          const status = await api.getEssayStatus(essayId);
          if (batchGenRef.current !== myGen) return;
          if (status.status === 'completed') {
            setBatchFilePatch(itemId, { status: 'completed', progress: 100, error: undefined });
            return;
          }
          if (status.status === 'failed') {
            setBatchFilePatch(itemId, {
              status: 'failed',
              error: status.error || 'Processing failed',
            });
            return;
          }
          const progress = Math.round(
            (status.step_index / Math.max(1, status.total_steps)) * 100,
          );
          setBatchFilePatch(itemId, { status: 'processing', progress });
        } catch {
          // Transient poll error — continue polling
        }
      }

      if (attempts >= maxAttempts && batchGenRef.current === myGen) {
        setBatchFilePatch(itemId, { status: 'failed', error: 'Processing timeout' });
      }
    },
    [setBatchFilePatch],
  );

  // Hydrate or clear state when authenticated user changes
  useEffect(() => {
    if (userId == null) {
      hydratedUserIdRef.current = null;
      singleGenRef.current += 1;
      batchGenRef.current += 1;
      abortBatchStreams();
      setActiveSingleCheck(null);
      updateBatchFiles([]);
      setBatchTargetClassId(null);
      setBatchQueueState({
        isProcessing: false,
        currentIndex: -1,
        hasAutoNavigated: false,
      });
      return;
    }

    if (hydratedUserIdRef.current === userId) return;
    hydratedUserIdRef.current = userId;

    const restoredSingle = readPersistedSingle(userId);
    setActiveSingleCheck(restoredSingle);

    const restoredBatch = readPersistedBatch(
      userId,
      t('batchUpload.reloadInterrupted'),
    );
    if (restoredBatch && restoredBatch.files.length > 0) {
      const restoredItems: BatchFileItem[] = restoredBatch.files;
      updateBatchFiles(restoredItems);
      setBatchTargetClassId(restoredBatch.targetClassId);
      const inFlightItems = restoredItems.filter(
        (f) => f.status === 'processing' && f.essayId != null,
      );
      if (inFlightItems.length > 0) {
        const myGen = ++batchGenRef.current;
        setBatchQueueState({
          isProcessing: true,
          currentIndex: 0,
          hasAutoNavigated: restoredBatch.hasAutoNavigated,
        });
        void runWithConcurrency(
          inFlightItems,
          BATCH_CONCURRENCY,
          async (item) => {
            if (item.essayId != null) {
              await pollBatchEssayUntilSettled(item.id, item.essayId, myGen);
            }
          },
        ).then(() => {
          if (batchGenRef.current !== myGen) return;
          void queryClient.invalidateQueries({ queryKey: ['essays'] });
          setBatchQueueState((prev) => ({
            isProcessing: false,
            currentIndex: -1,
            hasAutoNavigated: batchPageMountedRef.current ? prev.hasAutoNavigated : true,
          }));
        });
      } else {
        setBatchQueueState({
          isProcessing: false,
          currentIndex: -1,
          hasAutoNavigated: restoredBatch.hasAutoNavigated,
        });
      }
    } else {
      updateBatchFiles([]);
      setBatchTargetClassId(null);
      setBatchQueueState({
        isProcessing: false,
        currentIndex: -1,
        hasAutoNavigated: false,
      });
    }
  }, [abortBatchStreams, userId, pollBatchEssayUntilSettled, t, updateBatchFiles]);

  // Persist Single Check state to sessionStorage
  useEffect(() => {
    if (userId == null) return;
    writePersistedSingle(userId, activeSingleCheck);
  }, [userId, activeSingleCheck]);

  // Persist Batch Check state to sessionStorage
  useEffect(() => {
    if (userId == null) return;
    writePersistedBatch(
      userId,
      batchFiles,
      batchTargetClassId,
      batchQueueState.hasAutoNavigated,
    );
  }, [userId, batchFiles, batchTargetClassId, batchQueueState.hasAutoNavigated]);

  // ============================================================
  // Single Check Actions & Background Poller
  // ============================================================

  const registerUploadPageMount = useCallback(() => {
    uploadPageMountedRef.current = true;
    return () => {
      uploadPageMountedRef.current = false;
    };
  }, []);

  const registerProcessingPageMount = useCallback((essayId: number | null) => {
    if (essayId == null) return noopCleanup;
    setMountedProcessingEssayId(essayId);
    return () => {
      setMountedProcessingEssayId((prev) => (prev === essayId ? null : prev));
    };
  }, []);

  const startSingleUpload = useCallback(
    async (file: File, classId: number | null): Promise<{ essay_id: number }> => {
      const myGen = ++singleGenRef.current;
      const startedAt = Date.now();
      setActiveSingleCheck({
        essayId: null,
        filename: file.name,
        fileSize: file.size,
        classId,
        status: 'uploading',
        step: 'parsing',
        stepIndex: 0,
        totalSteps: TOTAL_PIPELINE_STEPS,
        progress: 0,
        message: t('upload.uploading'),
        queuePosition: null,
        error: null,
        startedAt,
        acknowledged: false,
      });

      try {
        const response = await api.uploadEssay(file, classId);
        void refreshUser();
        void queryClient.invalidateQueries({ queryKey: ['essays'] });

        if (singleGenRef.current === myGen) {
          const initSummary = (response as { summary?: { status?: string; queue_position?: number } })
            .summary;
          const isQueued = initSummary?.status === 'queued';
          setActiveSingleCheck({
            essayId: response.essay_id,
            filename: response.filename || file.name,
            fileSize: file.size,
            classId,
            status: isQueued ? 'queued' : 'processing',
            step: 'parsing',
            stepIndex: 0,
            totalSteps: TOTAL_PIPELINE_STEPS,
            progress: 0,
            message: isQueued ? 'Queued for analysis...' : 'Starting analysis...',
            queuePosition: initSummary?.queue_position ?? null,
            error: null,
            startedAt,
            acknowledged: false,
          });
        }
        return response;
      } catch (err) {
        if (singleGenRef.current === myGen) {
          setActiveSingleCheck(null);
          if (!uploadPageMountedRef.current) {
            toast.error(
              t('upload.toastFailedTitle'),
              err instanceof Error ? err.message : t('upload.uploadFailed'),
            );
          }
        }
        throw err;
      }
    },
    [refreshUser, t, toast],
  );

  const syncSingleCheckFromStatus = useCallback(
    (essayId: number, snap: EssayStatus, filenameFallback?: string) => {
      const nextProgress = computeSingleCheckProgress(snap);
      const nextStatus: SingleCheckLifecycle =
        snap.status === 'completed'
          ? 'completed'
          : snap.status === 'failed'
            ? 'failed'
            : snap.status === 'queued'
              ? 'queued'
              : 'processing';
      const nextQueuePos = snap.queue_position ?? null;
      const nextError = snap.error ?? null;

      setActiveSingleCheck((prev) => {
        if (prev && prev.essayId !== null && prev.essayId !== essayId) {
          // Only overwrite if previous single check already settled
          if (
            prev.status === 'uploading' ||
            prev.status === 'queued' ||
            prev.status === 'processing'
          ) {
            return prev;
          }
        }
        if (!prev) {
          if (nextStatus === 'completed' || nextStatus === 'failed') {
            return null;
          }
          return {
            essayId,
            filename: filenameFallback || `ID #${essayId}`,
            fileSize: 0,
            classId: null,
            status: nextStatus,
            step: snap.step || 'parsing',
            stepIndex: snap.step_index ?? 0,
            totalSteps: snap.total_steps || TOTAL_PIPELINE_STEPS,
            progress: nextProgress,
            message: snap.message || '',
            queuePosition: nextQueuePos,
            error: nextError,
            startedAt: Date.now(),
            acknowledged: false,
          };
        }

        if (
          prev.essayId === essayId &&
          prev.status === nextStatus &&
          prev.step === snap.step &&
          prev.stepIndex === snap.step_index &&
          prev.progress === nextProgress &&
          prev.message === snap.message &&
          prev.queuePosition === nextQueuePos &&
          prev.error === nextError
        ) {
          return prev;
        }

        return {
          ...prev,
          essayId,
          status: nextStatus,
          step: snap.step || prev.step,
          stepIndex: snap.step_index ?? prev.stepIndex,
          totalSteps: snap.total_steps || TOTAL_PIPELINE_STEPS,
          progress: nextProgress,
          message: snap.message || prev.message,
          queuePosition: nextQueuePos,
          error: nextError,
        };
      });
    },
    [],
  );

  const acknowledgeSingleCheck = useCallback((essayId?: number) => {
    setActiveSingleCheck((prev) => {
      if (!prev) return null;
      if (essayId !== undefined && prev.essayId !== essayId) return prev;
      if (
        prev.status === 'uploading' ||
        prev.status === 'queued' ||
        prev.status === 'processing'
      ) {
        return prev;
      }
      return null;
    });
  }, []);

  // Background status polling when ProcessingPage is NOT currently mounted for activeSingleCheck
  const bgPollEssayId = activeSingleCheck?.essayId ?? null;
  const bgPollActive =
    bgPollEssayId !== null &&
    (activeSingleCheck?.status === 'queued' || activeSingleCheck?.status === 'processing') &&
    mountedProcessingEssayId !== bgPollEssayId;

  useEffect(() => {
    if (!bgPollActive || bgPollEssayId === null) return;
    let cancelled = false;
    let consecutiveErrors = 0;
    let timer: ReturnType<typeof setInterval> | null = null;
    const controller = new AbortController();

    const handleSettledSingle = (snap: EssayStatus) => {
      if (snap.status === 'completed') {
        if (timer) clearInterval(timer);
        void queryClient.invalidateQueries({ queryKey: ['essays'] });
        void api
          .getEssay(bgPollEssayId)
          .then((report) => {
            if (report) {
              queryClient.setQueryData(['essay-report', bgPollEssayId], report);
            }
          })
          .catch(() => {});

        const displayFilename = activeSingleCheck?.filename || `ID #${bgPollEssayId}`;
        toast.success(
          t('upload.toastCompletedTitle'),
          t('upload.toastCompletedDesc', { filename: displayFilename }),
          onNavigate
            ? {
                action: {
                  label: t('upload.openReport'),
                  onClick: () => {
                    acknowledgeSingleCheck(bgPollEssayId);
                    onNavigate(`/verification/report/${bgPollEssayId}`);
                  },
                },
              }
            : undefined,
        );
      } else if (snap.status === 'failed') {
        if (timer) clearInterval(timer);
        toast.error(
          t('upload.toastFailedTitle'),
          snap.error || t('upload.uploadFailed'),
        );
      }
    };

    const tick = async () => {
      try {
        const snap = await api.getEssayStatus(bgPollEssayId, { signal: controller.signal });
        if (cancelled) return;
        consecutiveErrors = 0;
        syncSingleCheckFromStatus(bgPollEssayId, snap);
        if (snap.status === 'completed' || snap.status === 'failed') {
          handleSettledSingle(snap);
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        consecutiveErrors += 1;
        if (!cancelled && consecutiveErrors >= 5) {
          if (timer) clearInterval(timer);
          const errMsg =
            err instanceof Error ? err.message : 'Unable to fetch processing status.';
          setActiveSingleCheck((prev) =>
            prev && prev.essayId === bgPollEssayId
              ? { ...prev, status: 'failed', error: errMsg }
              : prev,
          );
        }
      }
    };

    void (async () => {
      const streamed = await streamEssayEvents(
        bgPollEssayId,
        (snap) => {
          if (cancelled) return;
          consecutiveErrors = 0;
          syncSingleCheckFromStatus(bgPollEssayId, snap);
          if (snap.status === 'completed' || snap.status === 'failed') {
            handleSettledSingle(snap);
          }
        },
        controller.signal,
      );
      if (cancelled || streamed) return;
      void tick();
      timer = setInterval(() => {
        void tick();
      }, singlePollTiming.pollIntervalMs);
    })();

    return () => {
      cancelled = true;
      controller.abort();
      if (timer) clearInterval(timer);
    };
  }, [
    bgPollActive,
    bgPollEssayId,
    activeSingleCheck?.filename,
    syncSingleCheckFromStatus,
    acknowledgeSingleCheck,
    onNavigate,
    t,
    toast,
  ]);

  const isSingleCheckInFlight = Boolean(
    activeSingleCheck &&
      (activeSingleCheck.status === 'uploading' ||
        activeSingleCheck.status === 'queued' ||
        activeSingleCheck.status === 'processing'),
  );

  // ============================================================
  // Batch Check Actions & Persistent Worker Pool
  // ============================================================

  const registerBatchPageMount = useCallback(() => {
    batchPageMountedRef.current = true;
    return () => {
      batchPageMountedRef.current = false;
    };
  }, []);

  const processOneBatchItem = useCallback(
    async (fileItem: BatchFileItem, myGen: number, classIdSnapshot: number | null) => {
      if (batchGenRef.current !== myGen) return;

      // If item already received an essayId earlier, just resume polling it
      if (fileItem.essayId != null && !fileItem.file) {
        setBatchFilePatch(fileItem.id, { status: 'processing', error: undefined });
        await pollBatchEssayUntilSettled(fileItem.id, fileItem.essayId, myGen);
        return;
      }

      if (!fileItem.file) {
        setBatchFilePatch(fileItem.id, {
          status: 'failed',
          error: t('batchUpload.reloadInterrupted'),
        });
        return;
      }

      setBatchFilePatch(fileItem.id, { status: 'uploading', error: undefined });
      try {
        const response = await api.uploadEssay(fileItem.file, classIdSnapshot);
        if (batchGenRef.current !== myGen) return;

        setBatchFilePatch(fileItem.id, {
          status: 'processing',
          essayId: response.essay_id,
          progress: 0,
        });

        await pollBatchEssayUntilSettled(fileItem.id, response.essay_id, myGen);
      } catch (error) {
        if (batchGenRef.current !== myGen) return;
        setBatchFilePatch(fileItem.id, {
          status: 'failed',
          error: error instanceof Error ? error.message : 'Upload failed',
        });
      }
    },
    [pollBatchEssayUntilSettled, setBatchFilePatch, t],
  );

  const startBatchQueue = useCallback(
    async (overridePending?: BatchFileItem[]) => {
      const pendingFiles =
        overridePending ?? batchFilesRef.current.filter((f) => f.status === 'pending');
      if (pendingFiles.length === 0) {
        setBatchQueueState({
          isProcessing: false,
          currentIndex: -1,
          hasAutoNavigated: false,
        });
        return;
      }

      const myGen = ++batchGenRef.current;
      const classIdSnapshot = batchTargetClassIdRef.current;

      setBatchQueueState({
        isProcessing: true,
        currentIndex: 0,
        hasAutoNavigated: false,
      });

      await runWithConcurrency(pendingFiles, BATCH_CONCURRENCY, (item) =>
        processOneBatchItem(item, myGen, classIdSnapshot),
      );

      if (batchGenRef.current !== myGen) return;

      void refreshUser();
      void queryClient.invalidateQueries({ queryKey: ['essays'] });

      const finishedAwayFromBatchPage = !batchPageMountedRef.current;
      setBatchQueueState({
        isProcessing: false,
        currentIndex: -1,
        hasAutoNavigated: finishedAwayFromBatchPage,
      });

      if (finishedAwayFromBatchPage) {
        const snapshot = batchFilesRef.current;
        const completedCount = snapshot.filter((f) => f.status === 'completed').length;
        const failedCount = snapshot.filter((f) => f.status === 'failed').length;
        const totalCount = snapshot.length;

        if (failedCount === 0 && completedCount > 0) {
          toast.success(
            t('batchUpload.toastBatchCompletedTitle'),
            t('batchUpload.toastBatchCompletedDesc', {
              completed: completedCount,
              total: totalCount,
            }),
            onNavigate
              ? {
                  action: {
                    label: t('nav.batchCheck'),
                    onClick: () => onNavigate('/batch-upload'),
                  },
                }
              : undefined,
          );
        } else if (failedCount > 0) {
          toast.warning(
            t('batchUpload.toastBatchMixedTitle'),
            t('batchUpload.toastBatchMixedDesc', {
              completed: completedCount,
              failed: failedCount,
            }),
            onNavigate
              ? {
                  action: {
                    label: t('nav.batchCheck'),
                    onClick: () => onNavigate('/batch-upload'),
                  },
                }
              : undefined,
          );
        }
      }
    },
    [onNavigate, processOneBatchItem, refreshUser, t, toast],
  );

  const addBatchFiles = useCallback(
    (newFiles: File[]) => {
      if (newFiles.length === 0) return;
      const items: BatchFileItem[] = newFiles.map((file) => ({
        id: crypto.randomUUID(),
        file,
        fileName: file.name,
        fileSize: file.size,
        status: 'pending',
        progress: 0,
      }));
      updateBatchFiles((prev) => [...prev, ...items]);
      setBatchQueueState((prev) => ({ ...prev, hasAutoNavigated: false }));
    },
    [updateBatchFiles],
  );

  const removeBatchFile = useCallback(
    (id: string) => {
      updateBatchFiles((prev) => prev.filter((f) => f.id !== id));
    },
    [updateBatchFiles],
  );

  const clearBatchFiles = useCallback(() => {
    batchGenRef.current += 1;
    abortBatchStreams();
    updateBatchFiles([]);
    setBatchQueueState({
      isProcessing: false,
      currentIndex: -1,
      hasAutoNavigated: false,
    });
  }, [abortBatchStreams, updateBatchFiles]);

  const retryBatchFile = useCallback(
    (id: string) => {
      const target = batchFilesRef.current.find((f) => f.id === id);
      if (!target) return;
      // Cannot retry if neither raw File nor server essayId is available
      if (!target.file && target.essayId == null) return;

      const updatedItem: BatchFileItem = {
        ...target,
        status: 'pending',
        progress: 0,
        error: undefined,
      };

      updateBatchFiles((prev) =>
        prev.map((f) => (f.id === id ? updatedItem : f)),
      );
      setBatchQueueState((prev) => ({ ...prev, hasAutoNavigated: false }));

      if (!batchQueueState.isProcessing) {
        const otherPending = batchFilesRef.current.filter(
          (f) => f.id !== id && f.status === 'pending',
        );
        void startBatchQueue([updatedItem, ...otherPending]);
      }
    },
    [batchQueueState.isProcessing, startBatchQueue, updateBatchFiles],
  );

  const markBatchAutoNavigated = useCallback(() => {
    setBatchQueueState((prev) =>
      prev.hasAutoNavigated ? prev : { ...prev, hasAutoNavigated: true },
    );
  }, []);

  const batchStats = useMemo<BatchQueueStats>(
    () => ({
      pending: batchFiles.filter((f) => f.status === 'pending').length,
      processing: batchFiles.filter(
        (f) => f.status === 'uploading' || f.status === 'processing',
      ).length,
      completed: batchFiles.filter((f) => f.status === 'completed').length,
      failed: batchFiles.filter((f) => f.status === 'failed').length,
      total: batchFiles.length,
    }),
    [batchFiles],
  );

  const isBatchActive = batchQueueState.isProcessing || batchStats.processing > 0;

  const value = useMemo<VerificationProgressContextValue>(
    () => ({
      activeSingleCheck,
      isSingleCheckInFlight,
      startSingleUpload,
      syncSingleCheckFromStatus,
      acknowledgeSingleCheck,
      registerProcessingPageMount,
      registerUploadPageMount,
      batchFiles,
      batchQueueState,
      batchStats,
      isBatchActive,
      batchTargetClassId,
      setBatchTargetClassId,
      addBatchFiles,
      removeBatchFile,
      clearBatchFiles,
      retryBatchFile,
      startBatchQueue,
      markBatchAutoNavigated,
      registerBatchPageMount,
    }),
    [
      activeSingleCheck,
      isSingleCheckInFlight,
      startSingleUpload,
      syncSingleCheckFromStatus,
      acknowledgeSingleCheck,
      registerProcessingPageMount,
      registerUploadPageMount,
      batchFiles,
      batchQueueState,
      batchStats,
      isBatchActive,
      batchTargetClassId,
      addBatchFiles,
      removeBatchFile,
      clearBatchFiles,
      retryBatchFile,
      startBatchQueue,
      markBatchAutoNavigated,
      registerBatchPageMount,
    ],
  );

  return (
    <VerificationProgressContext.Provider value={value}>
      {children}
    </VerificationProgressContext.Provider>
  );
}

export function useVerificationProgress(): VerificationProgressContextValue {
  return useContext(VerificationProgressContext);
}
