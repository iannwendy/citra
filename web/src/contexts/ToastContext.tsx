/**
 * CITRA (SourceLogic) — 120fps Editorial Notification Engine & Notification Center
 * Built on the Solva Warm Editorial + macOS Scholarly IDE Design System.
 *
 * Key UX/UI & 120fps Architecture:
 * - Pure GPU-composited animations (translate3d, scale3d, scaleX, opacity)
 * - 3D stacked toast deck with hover/tap fan-out expansion
 * - Pause-on-hover / pause-on-touch accurate timer + scaleX countdown bar
 * - Direct-DOM 120fps pointer swipe-to-dismiss gesture (zero React re-renders on drag)
 * - In-place toast morphing (updateToast & toast.promise) from loading -> success/error
 * - Synchronous ARIA role transition on dismiss so screen readers & E2E tests see immediate state updates while exit animation plays smoothly
 * - Built-in Notification Center Popover/Drawer for reviewing notification history
 */
import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import {
  X,
  Bell,
  BellOff,
  CheckCheck,
  Trash2,
  Sparkles,
  Layers,
  ChevronDown,
  ChevronUp,
  Terminal,
} from 'lucide-react';

// ============================================================
// Types
// ============================================================

export type ToastType = 'success' | 'error' | 'warning' | 'info' | 'loading';

export interface Toast {
  id: string;
  type: ToastType;
  title?: string;
  message?: string;
  duration?: number;
  /** Show toast even when notifications are disabled in Settings */
  force?: boolean;
  action?: {
    label: string;
    onClick: () => void;
  };
  category?: string;
  createdAt: number;
  /** Internal lifecycle flag for 120fps exit animation */
  isExiting?: boolean;
  /** Read state for Notification Center history */
  read?: boolean;
}

export type ToastMessageInput = string | { title: string; message?: string };

export interface ToastPromiseMessages<T> {
  loading: ToastMessageInput;
  loadingMessage?: string;
  success: ToastMessageInput | ((data: T) => ToastMessageInput);
  successMessage?: string | ((data: T) => string);
  error: ToastMessageInput | ((err: unknown) => ToastMessageInput);
  errorMessage?: string | ((err: unknown) => string);
}

export interface ToastContextValue {
  toasts: Toast[];
  history: Toast[];
  unreadCount: number;
  notificationsEnabled: boolean;
  setNotificationsEnabled: (enabled: boolean) => void;
  addToast: (toast: Omit<Toast, 'id' | 'createdAt'>) => string;
  updateToast: (id: string, updates: Partial<Omit<Toast, 'id' | 'createdAt'>>) => void;
  removeToast: (id: string) => void;
  dismissAll: () => void;
  markAllRead: () => void;
  clearHistory: () => void;
  // Convenience methods
  success: (title: string, message?: string, options?: Partial<Toast>) => string;
  error: (title: string, message?: string, options?: Partial<Toast>) => string;
  warning: (title: string, message?: string, options?: Partial<Toast>) => string;
  info: (title: string, message?: string, options?: Partial<Toast>) => string;
  loading: (title: string, message?: string, options?: Partial<Toast>) => string;
  promise: <T>(
    promiseOrFn: Promise<T> | (() => Promise<T>),
    messages: ToastPromiseMessages<T>
  ) => Promise<T>;
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

// ============================================================
// Constants
// ============================================================

const DEFAULT_DURATION = 4800;
const LOADING_DURATION = Infinity;
const EXIT_ANIMATION_MS = 210;
const MAX_HISTORY_ITEMS = 25;
const STORAGE_KEY_NOTIFICATIONS = 'settings_notifications';
const STORAGE_KEY_HISTORY = 'citra_notification_history_v1';

function readStoredHistory(): Toast[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY_HISTORY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(0, MAX_HISTORY_ITEMS) : [];
  } catch {
    return [];
  }
}

function writeStoredHistory(items: Toast[]): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(
      STORAGE_KEY_HISTORY,
      JSON.stringify(items.slice(0, MAX_HISTORY_ITEMS))
    );
  } catch {
    // Ignore storage quota errors
  }
}

// ============================================================
// Provider Component
// ============================================================

interface ToastProviderProps {
  children: ReactNode;
  /** Position of toast container */
  position?:
    | 'top-right'
    | 'top-left'
    | 'bottom-right'
    | 'bottom-left'
    | 'top-center'
    | 'bottom-center';
  /** Max toasts to show simultaneously */
  maxToasts?: number;
}

interface TimerRecord {
  timeoutId: ReturnType<typeof setTimeout> | null;
  remaining: number;
  startedAt: number;
  paused: boolean;
}

export function ToastProvider({
  children,
  position = 'bottom-right',
  maxToasts = 5,
}: ToastProviderProps): ReactNode {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [history, setHistory] = useState<Toast[]>(() => readStoredHistory());
  const [notificationsEnabled, setNotificationsEnabledState] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    return localStorage.getItem(STORAGE_KEY_NOTIFICATIONS) !== 'false';
  });
  const [isPaused, setIsPaused] = useState(false);

  const timersRef = useRef<Map<string, TimerRecord>>(new Map());
  const exitTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Synchistory to sessionStorage
  useEffect(() => {
    writeStoredHistory(history);
  }, [history]);

  // Listen to storage changes across tabs or SettingsPage updates
  useEffect(() => {
    const handleStorage = () => {
      if (typeof window !== 'undefined') {
        setNotificationsEnabledState(
          localStorage.getItem(STORAGE_KEY_NOTIFICATIONS) !== 'false'
        );
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  // Cleanup all timers on unmount
  useEffect(() => {
    const timers = timersRef.current;
    const exitTimers = exitTimersRef.current;
    return () => {
      timers.forEach((rec) => {
        if (rec.timeoutId) clearTimeout(rec.timeoutId);
      });
      exitTimers.forEach((tid) => clearTimeout(tid));
    };
  }, []);

  const generateId = () =>
    `toast-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

  // Finalize removal after exit animation finishes
  const finalizeRemove = useCallback((id: string) => {
    const timerRec = timersRef.current.get(id);
    if (timerRec?.timeoutId) clearTimeout(timerRec.timeoutId);
    timersRef.current.delete(id);

    const exitTimer = exitTimersRef.current.get(id);
    if (exitTimer) clearTimeout(exitTimer);
    exitTimersRef.current.delete(id);

    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // Trigger 120fps exit animation and remove
  const removeToast = useCallback(
    (id: string): void => {
      const timerRec = timersRef.current.get(id);
      if (timerRec?.timeoutId) clearTimeout(timerRec.timeoutId);
      timersRef.current.delete(id);

      setToasts((prev) => {
        const target = prev.find((t) => t.id === id);
        if (!target || target.isExiting) return prev;
        return prev.map((t) => (t.id === id ? { ...t, isExiting: true } : t));
      });

      if (!exitTimersRef.current.has(id)) {
        const tid = setTimeout(() => {
          finalizeRemove(id);
        }, EXIT_ANIMATION_MS);
        exitTimersRef.current.set(id, tid);
      }
    },
    [finalizeRemove]
  );

  // Schedule auto-dismiss timer for a toast
  const scheduleTimer = useCallback(
    (id: string, duration: number, pausedNow: boolean) => {
      const existing = timersRef.current.get(id);
      if (existing?.timeoutId) clearTimeout(existing.timeoutId);

      if (duration === Infinity || duration <= 0) {
        timersRef.current.delete(id);
        return;
      }

      if (pausedNow) {
        timersRef.current.set(id, {
          timeoutId: null,
          remaining: duration,
          startedAt: Date.now(),
          paused: true,
        });
        return;
      }

      const timeoutId = setTimeout(() => {
        removeToast(id);
      }, duration);

      timersRef.current.set(id, {
        timeoutId,
        remaining: duration,
        startedAt: Date.now(),
        paused: false,
      });
    },
    [removeToast]
  );

  // Pause all active timers on hover / touch
  const pauseAllTimers = useCallback(() => {
    setIsPaused(true);
    const now = Date.now();
    timersRef.current.forEach((rec, id) => {
      if (!rec.paused && rec.timeoutId) {
        clearTimeout(rec.timeoutId);
        const elapsed = now - rec.startedAt;
        const remaining = Math.max(400, rec.remaining - elapsed);
        timersRef.current.set(id, {
          timeoutId: null,
          remaining,
          startedAt: now,
          paused: true,
        });
      }
    });
  }, []);

  // Resume all paused timers when hover / touch ends
  const resumeAllTimers = useCallback(() => {
    setIsPaused(false);
    const now = Date.now();
    timersRef.current.forEach((rec, id) => {
      if (rec.paused && rec.remaining < Infinity) {
        const timeoutId = setTimeout(() => {
          removeToast(id);
        }, rec.remaining);
        timersRef.current.set(id, {
          timeoutId,
          remaining: rec.remaining,
          startedAt: now,
          paused: false,
        });
      }
    });
  }, [removeToast]);

  // Add toast
  const addToast = useCallback(
    (toast: Omit<Toast, 'id' | 'createdAt'>): string => {
      const isMuted =
        typeof window !== 'undefined' &&
        localStorage.getItem(STORAGE_KEY_NOTIFICATIONS) === 'false';

      setNotificationsEnabledState(!isMuted);

      const id = generateId();
      const duration =
        toast.duration ??
        (toast.type === 'loading' ? LOADING_DURATION : DEFAULT_DURATION);

      const newToast: Toast = {
        ...toast,
        id,
        createdAt: Date.now(),
        duration,
        isExiting: false,
        read: false,
      };

      if (toast.type !== 'loading') {
        setHistory((prev) => [newToast, ...prev].slice(0, MAX_HISTORY_ITEMS));
      }

      if (!toast.force && isMuted) {
        return '';
      }

      setToasts((prev) => {
        const active = prev.filter((t) => !t.isExiting);
        const exiting = prev.filter((t) => t.isExiting);
        const updatedActive = [newToast, ...active].slice(0, maxToasts);
        return [...updatedActive, ...exiting];
      });

      if (duration !== Infinity) {
        scheduleTimer(id, duration, isPaused);
      }

      return id;
    },
    [maxToasts, scheduleTimer, isPaused]
  );

  // Update toast in-place (e.g., morphing loading -> success/error at 120fps)
  const updateToast = useCallback(
    (id: string, updates: Partial<Omit<Toast, 'id' | 'createdAt'>>): void => {
      const nextDuration =
        updates.duration ??
        (updates.type && updates.type !== 'loading' ? DEFAULT_DURATION : undefined);

      setToasts((prev) =>
        prev.map((t) => {
          if (t.id !== id) return t;
          const updated: Toast = {
            ...t,
            ...updates,
            duration: nextDuration ?? t.duration,
            createdAt: Date.now(),
            isExiting: false,
          };
          return updated;
        })
      );

      const nextType = updates.type;
      if (nextType && nextType !== 'loading') {
        setHistory((prev) => {
          const exists = prev.some((h) => h.id === id);
          if (exists) {
            return prev.map((h) =>
              h.id === id ? { ...h, ...updates, type: nextType, createdAt: Date.now() } : h
            );
          }
          const morphed: Toast = {
            id,
            type: nextType,
            title: updates.title,
            message: updates.message,
            category: updates.category,
            createdAt: Date.now(),
            read: false,
          };
          return [morphed, ...prev].slice(0, MAX_HISTORY_ITEMS);
        });
      }

      if (nextDuration !== undefined && nextDuration !== Infinity) {
        scheduleTimer(id, nextDuration, isPaused);
      }
    },
    [scheduleTimer, isPaused]
  );

  // Dismiss all active toasts
  const dismissAll = useCallback((): void => {
    timersRef.current.forEach((rec) => {
      if (rec.timeoutId) clearTimeout(rec.timeoutId);
    });
    timersRef.current.clear();

    setToasts((prev) => prev.map((t) => ({ ...t, isExiting: true })));
    const tid = setTimeout(() => {
      setToasts([]);
    }, EXIT_ANIMATION_MS);
    exitTimersRef.current.set('__all__', tid);
  }, []);

  const markAllRead = useCallback((): void => {
    setHistory((prev) => prev.map((item) => ({ ...item, read: true })));
  }, []);

  const clearHistory = useCallback((): void => {
    setHistory([]);
    writeStoredHistory([]);
  }, []);

  const setNotificationsEnabled = useCallback((enabled: boolean): void => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_KEY_NOTIFICATIONS, String(enabled));
    }
    setNotificationsEnabledState(enabled);
  }, []);

  // Convenience methods
  const success = useCallback(
    (title: string, message?: string, options?: Partial<Toast>) =>
      addToast({ type: 'success', title, message, ...options }),
    [addToast]
  );

  const error = useCallback(
    (title: string, message?: string, options?: Partial<Toast>) =>
      addToast({ type: 'error', title, message, ...options }),
    [addToast]
  );

  const warning = useCallback(
    (title: string, message?: string, options?: Partial<Toast>) =>
      addToast({ type: 'warning', title, message, ...options }),
    [addToast]
  );

  const info = useCallback(
    (title: string, message?: string, options?: Partial<Toast>) =>
      addToast({ type: 'info', title, message, ...options }),
    [addToast]
  );

  const loading = useCallback(
    (title: string, message?: string, options?: Partial<Toast>) =>
      addToast({ type: 'loading', title, message, ...options }),
    [addToast]
  );

  const promise = useCallback(
    async <T,>(
      promiseOrFn: Promise<T> | (() => Promise<T>),
      messages: ToastPromiseMessages<T>
    ): Promise<T> => {
      const loadingResolved =
        typeof messages.loading === 'string'
          ? { title: messages.loading, message: messages.loadingMessage }
          : messages.loading;
      const id = addToast({
        type: 'loading',
        title: loadingResolved.title,
        message: loadingResolved.message ?? messages.loadingMessage,
        force: true,
      });
      try {
        const p = typeof promiseOrFn === 'function' ? promiseOrFn() : promiseOrFn;
        const result = await p;
        const rawSuccess =
          typeof messages.success === 'function'
            ? messages.success(result)
            : messages.success;
        const successResolved =
          typeof rawSuccess === 'string'
            ? {
                title: rawSuccess,
                message:
                  typeof messages.successMessage === 'function'
                    ? messages.successMessage(result)
                    : messages.successMessage,
              }
            : rawSuccess;
        if (id) {
          updateToast(id, {
            type: 'success',
            title: successResolved.title,
            message: successResolved.message,
            duration: DEFAULT_DURATION,
          });
        }
        return result;
      } catch (err) {
        const rawError =
          typeof messages.error === 'function' ? messages.error(err) : messages.error;
        const errorResolved =
          typeof rawError === 'string'
            ? {
                title: rawError,
                message:
                  typeof messages.errorMessage === 'function'
                    ? messages.errorMessage(err)
                    : messages.errorMessage,
              }
            : rawError;
        if (id) {
          updateToast(id, {
            type: 'error',
            title: errorResolved.title,
            message: errorResolved.message,
            duration: DEFAULT_DURATION + 1200,
          });
        }
        throw err;
      }
    },
    [addToast, updateToast]
  );

  const unreadCount = history.filter((h) => !h.read).length;

  const value: ToastContextValue = {
    toasts,
    history,
    unreadCount,
    notificationsEnabled,
    setNotificationsEnabled,
    addToast,
    updateToast,
    removeToast,
    dismissAll,
    markAllRead,
    clearHistory,
    success,
    error,
    warning,
    info,
    loading,
    promise,
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastContainer
        toasts={toasts}
        onRemove={removeToast}
        onDismissAll={dismissAll}
        position={position}
        isPaused={isPaused}
        onPause={pauseAllTimers}
        onResume={resumeAllTimers}
      />
    </ToastContext.Provider>
  );
}

// ============================================================
// Hooks
// ============================================================

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (context === undefined) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
}

export const useSuccessToast = () => {
  const { success } = useToast();
  return success;
};

export const useErrorToast = () => {
  const { error } = useToast();
  return error;
};

// ============================================================
// Bespoke 120fps Animated SVG Status Icons
// ============================================================

function ToastStatusGlyph({ type }: { type: ToastType }) {
  if (type === 'success') {
    return (
      <div className="relative w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-emerald-500/15 dark:bg-emerald-500/20 border border-emerald-500/25 dark:border-emerald-400/30 flex items-center justify-center shrink-0 shadow-[inset_0_1px_0_rgba(255,255,255,0.5)] animate-icon-pop">
        <span
          aria-hidden="true"
          className="absolute inset-0 rounded-xl bg-emerald-500/15 blur-md pointer-events-none"
        />
        <svg
          className="w-[18px] h-[18px] text-emerald-600 dark:text-emerald-400 relative z-10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="9.5" className="opacity-25" strokeWidth="1.75" />
          <path d="M8 12.5l2.8 2.8L16.5 9.5" className="animate-stroke-draw" />
        </svg>
      </div>
    );
  }

  if (type === 'error') {
    return (
      <div className="relative w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-red-500/15 dark:bg-red-500/20 border border-red-500/25 dark:border-red-400/30 flex items-center justify-center shrink-0 shadow-[inset_0_1px_0_rgba(255,255,255,0.5)] animate-error-shake">
        <span
          aria-hidden="true"
          className="absolute inset-0 rounded-xl bg-red-500/15 blur-md pointer-events-none"
        />
        <svg
          className="w-[18px] h-[18px] text-red-600 dark:text-red-400 relative z-10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.3"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="9.5" className="opacity-25" strokeWidth="1.75" />
          <path d="M15 9l-6 6M9 9l6 6" className="animate-stroke-draw" />
        </svg>
      </div>
    );
  }

  if (type === 'warning') {
    return (
      <div className="relative w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-amber-500/15 dark:bg-amber-500/20 border border-amber-500/25 dark:border-amber-400/30 flex items-center justify-center shrink-0 shadow-[inset_0_1px_0_rgba(255,255,255,0.5)] animate-icon-pop">
        <span
          aria-hidden="true"
          className="absolute inset-0 rounded-xl bg-amber-500/15 blur-md pointer-events-none"
        />
        <svg
          className="w-[18px] h-[18px] text-amber-600 dark:text-amber-400 relative z-10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          <line x1="12" y1="9" x2="12" y2="13" className="animate-stroke-draw" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
      </div>
    );
  }

  if (type === 'loading') {
    return (
      <div className="relative w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-[#1C1A15] dark:bg-[#FBFAF6] border border-[#1C1A15]/20 dark:border-[#FBFAF6]/30 flex items-center justify-center shrink-0 shadow-xs">
        <svg
          className="w-[18px] h-[18px] text-[#FBFAF6] dark:text-[#1C1A15] animate-orbital-spin"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
        >
          <circle
            cx="12"
            cy="12"
            r="9"
            stroke="currentColor"
            strokeWidth="2.2"
            className="opacity-20"
          />
          <path
            d="M21 12a9 9 0 0 0-9-9"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
          />
        </svg>
        <span
          aria-hidden="true"
          className="absolute w-2 h-2 rounded-full bg-emerald-400 dark:bg-emerald-600 animate-pulse"
        />
      </div>
    );
  }

  // info
  return (
    <div className="relative w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-[#1C1A15]/10 dark:bg-[#FBFAF6]/15 border border-[#1C1A15]/15 dark:border-[#FBFAF6]/20 flex items-center justify-center shrink-0 shadow-[inset_0_1px_0_rgba(255,255,255,0.5)] animate-icon-pop">
      <Sparkles className="w-[18px] h-[18px] text-[#1C1A15] dark:text-[#FBFAF6]" />
    </div>
  );
}

// ============================================================
// Toast Container Component (3D Stack + Expand on Hover/Touch)
// ============================================================

interface ToastContainerProps {
  toasts: Toast[];
  onRemove: (id: string) => void;
  onDismissAll: () => void;
  position: ToastProviderProps['position'];
  isPaused: boolean;
  onPause: () => void;
  onResume: () => void;
}

function ToastContainer({
  toasts,
  onRemove,
  onDismissAll,
  position = 'bottom-right',
  isPaused,
  onPause,
  onResume,
}: ToastContainerProps): ReactNode {
  const [expanded, setExpanded] = useState(false);

  const activeCount = toasts.filter((t) => !t.isExiting).length;

  useEffect(() => {
    if (activeCount <= 1) {
      setExpanded(false);
    }
  }, [activeCount]);

  // Responsive positioning:
  // On mobile (< sm): centered bottom floating capsule with safe horizontal margins
  // On desktop (>= sm): docked to the requested corner with 400px editorial width
  const positionClasses: Record<NonNullable<ToastProviderProps['position']>, string> = {
    'top-right': 'top-3.5 inset-x-3 sm:inset-x-auto sm:top-5 sm:right-5',
    'top-left': 'top-3.5 inset-x-3 sm:inset-x-auto sm:top-5 sm:left-5',
    'bottom-right': 'bottom-3.5 inset-x-3 sm:inset-x-auto sm:bottom-5 sm:right-5',
    'bottom-left': 'bottom-3.5 inset-x-3 sm:inset-x-auto sm:bottom-5 sm:left-5',
    'top-center': 'top-3.5 inset-x-3 sm:inset-x-auto sm:top-5 sm:left-1/2 sm:-translate-x-1/2',
    'bottom-center':
      'bottom-3.5 inset-x-3 sm:inset-x-auto sm:bottom-5 sm:left-1/2 sm:-translate-x-1/2',
  };

  const isExpandedView = expanded || isPaused;

  return (
    <div
      className={`fixed ${positionClasses[position]} z-[100] flex flex-col items-stretch sm:w-[400px] max-w-[430px] mx-auto sm:mx-0 pointer-events-none select-none`}
      aria-live="polite"
      aria-label="Notifications"
      onMouseEnter={() => {
        onPause();
        if (activeCount > 1) setExpanded(true);
      }}
      onMouseLeave={() => {
        onResume();
        setExpanded(false);
      }}
      onTouchStart={() => {
        onPause();
      }}
      onTouchEnd={() => {
        onResume();
      }}
    >
      {/* Multi-toast Stack Control Pill (visible when > 1 active toast) */}
      {activeCount > 1 && (
        <div
          data-testid="toast-stack-toolbar"
          className="pointer-events-auto mb-4 flex items-center justify-between gap-2 px-3.5 py-1.5 rounded-full bg-[#1C1A15] dark:bg-[#FBFAF6] text-[#FBFAF6] dark:text-[#1C1A15] shadow-[0_10px_28px_-4px_rgba(28,26,21,0.35)] border border-white/15 dark:border-black/15 text-[11px] font-mono animate-fade-in relative z-[60]"
        >
          <button
            type="button"
            onClick={() => setExpanded((prev) => !prev)}
            className="inline-flex items-center gap-1.5 font-semibold tracking-wider uppercase cursor-pointer hover:opacity-85 transition-opacity"
          >
            <Layers className="w-3.5 h-3.5" />
            <span>{activeCount} NOTIFICATIONS</span>
            {isExpandedView ? (
              <ChevronDown className="w-3.5 h-3.5" />
            ) : (
              <ChevronUp className="w-3.5 h-3.5" />
            )}
          </button>

          <button
            type="button"
            data-testid="dismiss-all-toasts-btn"
            onClick={onDismissAll}
            className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-white/15 dark:bg-black/10 hover:bg-white/25 dark:hover:bg-black/20 text-[10px] font-mono font-bold uppercase tracking-wider transition-colors cursor-pointer"
          >
            <span>CLEAR ALL</span>
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* Toast Stack Items */}
      <div className="relative flex flex-col gap-2.5">
        {toasts.map((toast, idx) => (
          <ToastItem
            key={toast.id}
            toast={toast}
            index={idx}
            totalActive={activeCount}
            expanded={isExpandedView}
            isPaused={isPaused}
            onRemove={onRemove}
          />
        ))}
      </div>
    </div>
  );
}

// ============================================================
// Individual Toast Item Component (120fps Direct-DOM Swipe + Spring Card)
// ============================================================

interface ToastItemProps {
  toast: Toast;
  index: number;
  totalActive: number;
  expanded: boolean;
  isPaused: boolean;
  onRemove: (id: string) => void;
}

const META_BADGE_CONFIG: Record<
  ToastType,
  {
    tag: string;
    pillClass: string;
    dotClass: string;
    progressClass: string;
    auraClass: string;
    borderAccent: string;
  }
> = {
  success: {
    tag: 'CITRA · VERIFIED',
    pillClass:
      'bg-emerald-500/15 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300 border-emerald-500/25',
    dotClass: 'bg-emerald-500',
    progressClass: 'bg-gradient-to-r from-emerald-600 via-emerald-500 to-teal-400',
    auraClass: 'bg-emerald-500/20 dark:bg-emerald-500/15',
    borderAccent: 'border-[#E7E3D9] dark:border-[#332F26] hover:border-emerald-500/40',
  },
  error: {
    tag: 'SYSTEM · ALERT',
    pillClass:
      'bg-red-500/15 text-red-800 dark:bg-red-500/20 dark:text-red-300 border-red-500/25',
    dotClass: 'bg-red-500',
    progressClass: 'bg-gradient-to-r from-red-600 via-red-500 to-rose-400',
    auraClass: 'bg-red-500/20 dark:bg-red-500/15',
    borderAccent: 'border-red-200/90 dark:border-red-900/60 hover:border-red-500/50',
  },
  warning: {
    tag: 'NOTICE · WARN',
    pillClass:
      'bg-amber-500/15 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300 border-amber-500/25',
    dotClass: 'bg-amber-500',
    progressClass: 'bg-gradient-to-r from-amber-600 via-amber-500 to-yellow-400',
    auraClass: 'bg-amber-500/20 dark:bg-amber-500/15',
    borderAccent: 'border-amber-200/90 dark:border-amber-900/60 hover:border-amber-500/50',
  },
  info: {
    tag: 'CITRA · NOTICE',
    pillClass:
      'bg-[#1C1A15]/10 text-[#1C1A15] dark:bg-[#FBFAF6]/15 dark:text-[#FBFAF6] border-[#1C1A15]/15 dark:border-[#FBFAF6]/20',
    dotClass: 'bg-[#1C1A15] dark:bg-[#FBFAF6]',
    progressClass: 'bg-[#1C1A15] dark:bg-[#FBFAF6]',
    auraClass: 'bg-amber-400/15 dark:bg-indigo-500/15',
    borderAccent: 'border-[#E7E3D9] dark:border-[#332F26]',
  },
  loading: {
    tag: 'PIPELINE · SYNC',
    pillClass:
      'bg-[#1C1A15] text-[#FBFAF6] dark:bg-[#FBFAF6] dark:text-[#1C1A15] border-transparent',
    dotClass: 'bg-emerald-400 dark:bg-emerald-600 animate-ping',
    progressClass: 'bg-[#1C1A15] dark:bg-[#FBFAF6]',
    auraClass: 'bg-indigo-500/15 dark:bg-indigo-400/15',
    borderAccent: 'border-[#E7E3D9] dark:border-[#332F26]',
  },
};

function ToastItem({
  toast,
  index,
  totalActive,
  expanded,
  isPaused,
  onRemove,
}: ToastItemProps): ReactNode {
  const cardRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    active: boolean;
    startX: number;
    startY: number;
    dx: number;
    dy: number;
  }>({
    active: false,
    startX: 0,
    startY: 0,
    dx: 0,
    dy: 0,
  });

  const meta = META_BADGE_CONFIG[toast.type];
  const isExiting = Boolean(toast.isExiting);
  const showProgress =
    toast.duration !== undefined &&
    toast.duration !== Infinity &&
    toast.duration > 0 &&
    !isExiting;

  // Direct DOM 120fps pointer swipe-to-dismiss handlers
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // Do not hijack clicks on interactive buttons inside the toast
    const target = e.target as HTMLElement | null;
    if (target?.closest('button, a')) return;

    dragRef.current = {
      active: true,
      startX: e.clientX,
      startY: e.clientY,
      dx: 0,
      dy: 0,
    };
    const el = cardRef.current;
    if (el) {
      el.style.transition = 'none';
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current.active) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = Math.max(0, e.clientY - dragRef.current.startY);
    dragRef.current.dx = dx;
    dragRef.current.dy = dy;

    const el = cardRef.current;
    if (el) {
      const distance = Math.hypot(dx, dy);
      const opacity = Math.max(0.25, 1 - distance / 240);
      const tilt = (dx * 0.025).toFixed(2);
      el.style.transform = `translate3d(${dx.toFixed(1)}px, ${dy.toFixed(1)}px, 0) rotateZ(${tilt}deg)`;
      el.style.opacity = opacity.toFixed(3);
    }
  };

  const handlePointerUp = () => {
    if (!dragRef.current.active) return;
    dragRef.current.active = false;
    const { dx, dy } = dragRef.current;
    const el = cardRef.current;

    if (Math.abs(dx) > 76 || dy > 52) {
      if (el) {
        const flyX = dx > 0 ? 220 : dx < -20 ? -220 : 0;
        const flyY = dy > 40 ? 90 : 0;
        el.style.transition =
          'transform 190ms cubic-bezier(0.22, 1, 0.36, 1), opacity 190ms ease-out';
        el.style.transform = `translate3d(${flyX}px, ${flyY}px, 0) scale3d(0.92, 0.92, 1)`;
        el.style.opacity = '0';
      }
      onRemove(toast.id);
    } else if (el) {
      el.style.transition =
        'transform 260ms cubic-bezier(0.22, 1, 0.36, 1), opacity 220ms ease-out';
      el.style.transform = '';
      el.style.opacity = '';
    }
  };

  // Compute 3D deck stacking style when collapsed and multiple toasts exist
  const isCollapsedBehind = !expanded && totalActive > 1 && index > 0;
  const stackScale = isCollapsedBehind ? Math.max(0.88, 1 - index * 0.045) : 1;
  const stackTranslateY = isCollapsedBehind ? index * -10 : 0;
  const stackOpacity = isCollapsedBehind ? Math.max(0.65, 1 - index * 0.16) : 1;

  return (
    <div
      ref={cardRef}
      role={isExiting ? 'presentation' : 'alert'}
      aria-hidden={isExiting ? 'true' : undefined}
      data-testid={`citra-toast-${toast.type}`}
      data-toast-type={toast.type}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      style={
        isCollapsedBehind
          ? {
              transform: `translate3d(0, ${stackTranslateY}px, 0) scale3d(${stackScale}, ${stackScale}, 1)`,
              opacity: stackOpacity,
              zIndex: 50 - index,
            }
          : {
              zIndex: 50 - index,
            }
      }
      className={`
        overflow-hidden rounded-2xl border
        bg-[#FBFAF6]/95 dark:bg-[#1E1C17]/95 backdrop-blur-xl
        shadow-[0_20px_48px_-12px_rgba(28,26,21,0.18),0_4px_14px_-2px_rgba(28,26,21,0.08),inset_0_1px_0_rgba(255,255,255,0.85)]
        dark:shadow-[0_24px_54px_-12px_rgba(0,0,0,0.75),0_4px_16px_-2px_rgba(0,0,0,0.45),inset_0_1px_0_rgba(255,255,255,0.08)]
        transform-gpu transition-[transform,opacity,margin,border-color,box-shadow] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]
        ${isCollapsedBehind ? 'absolute inset-x-0 top-0 h-full pointer-events-none' : 'relative pointer-events-auto'}
        ${meta.borderAccent}
        ${isExiting ? 'animate-toast-exit pointer-events-none' : 'animate-toast-enter'}
      `}
    >
      {/* Subtle Ambient Semantic Glow */}
      <div
        aria-hidden="true"
        className={`pointer-events-none absolute -top-10 -left-10 w-32 h-32 rounded-full blur-2xl ${meta.auraClass}`}
      />

      {/* Main Content Row */}
      <div
        className={`relative z-10 flex items-start gap-3 p-3.5 sm:p-4 transition-opacity duration-200 ${
          isCollapsedBehind ? 'opacity-0' : 'opacity-100'
        }`}
      >
        {/* Left Animated SVG Badge */}
        <ToastStatusGlyph type={toast.type} />

        {/* Center Editorial Text & Action */}
        <div className="flex-1 min-w-0">
          {/* Top Monospace Telemetry Strip */}
          <div className="flex items-center justify-between gap-2 mb-1">
            <span
              className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[10px] font-mono font-bold uppercase tracking-wider leading-none ${meta.pillClass}`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${meta.dotClass}`} />
              <span>{toast.category || meta.tag}</span>
            </span>

            <span className="text-[10px] font-mono text-[#8C887E] dark:text-[#7A756B] uppercase tracking-wider shrink-0">
              {toast.type === 'loading' ? 'SYNCING' : 'NOW'}
            </span>
          </div>

          {toast.title && (
            <p className="font-solva-sans font-semibold text-[13.5px] sm:text-[14px] text-[#1C1A15] dark:text-[#FBFAF6] tracking-[-0.012em] leading-[1.35] break-words">
              {toast.title}
            </p>
          )}

          {toast.message && (
            <p className="font-solva-sans text-[12.5px] sm:text-[13px] text-[#56524A] dark:text-[#A8A296] leading-[1.45] mt-0.5 break-words">
              {toast.message}
            </p>
          )}

          {toast.action && (
            <div className="mt-2.5">
              <button
                type="button"
                onClick={() => {
                  toast.action?.onClick();
                  onRemove(toast.id);
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#1C1A15] text-[#FBFAF6] dark:bg-[#FBFAF6] dark:text-[#1C1A15] text-xs font-mono font-semibold tracking-tight hover:opacity-90 active:scale-95 transition-[transform,opacity] duration-150 cursor-pointer shadow-2xs"
              >
                <span>{toast.action.label}</span>
              </button>
            </div>
          )}
        </div>

        {/* Right Dismiss Button */}
        <button
          type="button"
          onClick={() => onRemove(toast.id)}
          className="shrink-0 w-7 h-7 rounded-lg flex items-center justify-center text-[#8C887E] dark:text-[#A8A296] hover:text-[#1C1A15] dark:hover:text-[#FBFAF6] hover:bg-[#ECE9E0]/90 dark:hover:bg-[#29261F] active:scale-90 transition-[transform,background-color,color] duration-150 cursor-pointer"
          aria-label="Dismiss notification"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Bottom 120fps GPU-Composited Countdown Bar (scaleX) */}
      {showProgress && (
        <div
          aria-hidden="true"
          className="relative h-[2.5px] w-full bg-[#E7E3D9]/65 dark:bg-[#332F26]/70 overflow-hidden"
        >
          <div
            key={`${toast.id}-${toast.type}-${toast.createdAt}`}
            style={{
              transformOrigin: 'left center',
              animationName: 'citraToastProgress',
              animationDuration: `${toast.duration}ms`,
              animationTimingFunction: 'linear',
              animationFillMode: 'forwards',
              animationPlayState: isPaused ? 'paused' : 'running',
              willChange: 'transform',
            }}
            className={`h-full w-full ${meta.progressClass}`}
          />
        </div>
      )}
    </div>
  );
}

// ============================================================
// Notification Center Trigger & Drawer/Popover (For AppLayout)
// ============================================================

export function NotificationCenterButton({
  lang = 'en',
  compact = false,
}: {
  lang?: 'en' | 'vi';
  compact?: boolean;
}): ReactNode {
  const {
    history,
    unreadCount,
    notificationsEnabled,
    setNotificationsEnabled,
    markAllRead,
    clearHistory,
    success,
  } = useToast();
  const [open, setOpen] = useState(false);

  const handleOpen = () => {
    const next = !open;
    setOpen(next);
    if (next && unreadCount > 0) {
      markAllRead();
    }
  };

  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open]);

  const formatTimeAgo = (ts: number) => {
    const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    if (diffSec < 10) return lang === 'vi' ? 'Vừa xong' : 'Just now';
    if (diffSec < 60) return `${diffSec}s`;
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m`;
    const diffHr = Math.floor(diffMin / 60);
    return `${diffHr}h`;
  };

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        data-testid={
          compact
            ? 'notification-center-trigger-mobile'
            : 'notification-center-trigger-desktop'
        }
        aria-label={lang === 'vi' ? 'Trung tâm thông báo' : 'Notification Center'}
        title={lang === 'vi' ? 'Trung tâm thông báo' : 'Notification Center'}
        className={`relative inline-flex items-center justify-center rounded-xl border border-slate-200/80 dark:border-slate-700/80 bg-white dark:bg-slate-800/90 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 hover:-translate-y-[1px] active:translate-y-0 active:scale-95 transition-[transform,background-color,border-color,box-shadow] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] cursor-pointer shadow-2xs ${
          compact ? 'h-9 w-9' : 'h-8 px-2.5 gap-1.5 text-[11px] font-mono font-semibold'
        }`}
      >
        {notificationsEnabled ? (
          <Bell className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
        ) : (
          <BellOff className="w-4 h-4 text-slate-400" />
        )}

        {!compact && (
          <span className="hidden sm:inline">
            {unreadCount > 0 ? unreadCount : ''}
          </span>
        )}

        {/* Live Status / Unread Badge */}
        {unreadCount > 0 ? (
          <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-indigo-600 dark:bg-emerald-500 text-white dark:text-slate-950 text-[10px] font-mono font-bold flex items-center justify-center shadow-xs animate-icon-pop">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        ) : (
          <span
            aria-hidden="true"
            className={`absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-white dark:border-slate-900 ${
              notificationsEnabled ? 'bg-emerald-500' : 'bg-slate-400'
            }`}
          />
        )}
      </button>

      {open &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            className="fixed inset-0 z-[95] flex items-start justify-end p-3 sm:p-5 bg-black/25 dark:bg-black/50 backdrop-blur-[2px] animate-fade-in"
            onClick={() => setOpen(false)}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              data-testid="notification-center-panel"
              role="dialog"
              aria-modal="false"
              aria-label={lang === 'vi' ? 'Nhật ký thông báo' : 'Notification Center'}
              className="mt-12 sm:mt-2 w-full max-w-[390px] rounded-2xl border border-[#E7E3D9] dark:border-[#332F26] bg-[#FBFAF6] dark:bg-[#1E1C17] shadow-[0_24px_60px_-12px_rgba(28,26,21,0.32),inset_0_1px_0_rgba(255,255,255,0.85)] dark:shadow-[0_24px_60px_-12px_rgba(0,0,0,0.8)] overflow-hidden animate-scale-in"
            >
              {/* macOS Editorial Header Chrome */}
              <div className="flex items-center justify-between gap-2 px-4 py-3 bg-[#F4F2EC] dark:bg-[#141310] border-b border-[#E7E3D9] dark:border-[#332F26]">
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-red-400" />
                    <span className="w-2.5 h-2.5 rounded-full bg-amber-400" />
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
                  </div>
                  <span className="h-3.5 w-px bg-[#E7E3D9] dark:bg-[#332F26] mx-0.5" />
                  <Terminal className="w-3.5 h-3.5 text-[#1C1A15] dark:text-[#FBFAF6]" />
                  <span className="font-mono text-xs font-semibold text-[#1C1A15] dark:text-[#FBFAF6]">
                    {lang === 'vi' ? 'Trung tâm Thông báo' : 'Notification Center'}
                  </span>
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    data-testid="notification-mute-toggle-btn"
                    onClick={() => {
                      const next = !notificationsEnabled;
                      setNotificationsEnabled(next);
                      if (next) {
                        success(
                          lang === 'vi' ? 'Đã lưu cài đặt' : 'Settings saved',
                          lang === 'vi'
                            ? 'Đã bật thông báo'
                            : 'Notifications enabled',
                          { force: true }
                        );
                      }
                    }}
                    className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-mono font-bold uppercase tracking-wider border transition-colors cursor-pointer ${
                      notificationsEnabled
                        ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/25'
                        : 'bg-slate-200/70 dark:bg-slate-800 text-slate-500 border-slate-300 dark:border-slate-700'
                    }`}
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        notificationsEnabled ? 'bg-emerald-500' : 'bg-slate-400'
                      }`}
                    />
                    <span>{notificationsEnabled ? 'LIVE' : 'MUTED'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    aria-label="Close notification center"
                    className="p-1 rounded-lg text-[#8C887E] hover:text-[#1C1A15] dark:hover:text-[#FBFAF6] hover:bg-[#ECE9E0] dark:hover:bg-[#29261F] transition-colors cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Notification List Body */}
              <div
                role="list"
                className="max-h-[340px] overflow-y-auto divide-y divide-[#E7E3D9]/70 dark:divide-[#332F26]/70"
              >
                {history.length === 0 ? (
                  <div className="p-7 text-center space-y-2.5">
                    <div className="w-11 h-11 rounded-2xl bg-[#F4F2EC] dark:bg-[#29261F] border border-[#E7E3D9] dark:border-[#332F26] flex items-center justify-center mx-auto">
                      <Bell className="w-5 h-5 text-[#8C887E]" />
                    </div>
                    <div>
                      <p className="font-solva-sans font-semibold text-sm text-[#1C1A15] dark:text-[#FBFAF6]">
                        {lang === 'vi'
                          ? 'Chưa có thông báo mới'
                          : 'All caught up'}
                      </p>
                      <p className="text-xs text-[#56524A] dark:text-[#A8A296] mt-0.5">
                        {lang === 'vi'
                          ? 'Mọi sự kiện hệ thống, thanh toán Stripe và kiểm chứng tài liệu sẽ hiển thị tại đây.'
                          : 'System events, Stripe billing updates, and verification alerts will appear here.'}
                      </p>
                    </div>
                  </div>
                ) : (
                  history.map((item) => {
                    const itemMeta = META_BADGE_CONFIG[item.type];
                    return (
                      <div
                        key={item.id}
                        role="listitem"
                        className="p-3.5 hover:bg-[#F4F2EC]/70 dark:hover:bg-[#29261F]/50 transition-colors flex items-start gap-3"
                      >
                        <ToastStatusGlyph type={item.type} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2 mb-0.5">
                            <span
                              className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full border text-[9px] font-mono font-bold uppercase ${itemMeta.pillClass}`}
                            >
                              <span
                                className={`w-1.5 h-1.5 rounded-full ${itemMeta.dotClass}`}
                              />
                              <span>{itemMeta.tag}</span>
                            </span>
                            <span className="text-[10px] font-mono text-[#8C887E]">
                              {formatTimeAgo(item.createdAt)}
                            </span>
                          </div>
                          {item.title && (
                            <p className="font-solva-sans font-semibold text-xs text-[#1C1A15] dark:text-[#FBFAF6] leading-snug">
                              {item.title}
                            </p>
                          )}
                          {item.message && (
                            <p className="font-solva-sans text-xs text-[#56524A] dark:text-[#A8A296] leading-relaxed mt-0.5">
                              {item.message}
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Footer Actions */}
              {history.length > 0 && (
                <div className="px-4 py-2.5 bg-[#F4F2EC]/90 dark:bg-[#141310]/90 border-t border-[#E7E3D9] dark:border-[#332F26] flex items-center justify-between gap-2 text-xs font-mono">
                  <button
                    type="button"
                    onClick={markAllRead}
                    className="inline-flex items-center gap-1.5 text-[#56524A] dark:text-[#A8A296] hover:text-[#1C1A15] dark:hover:text-[#FBFAF6] transition-colors cursor-pointer"
                  >
                    <CheckCheck className="w-3.5 h-3.5" />
                    <span>{lang === 'vi' ? 'Đánh dấu đã đọc' : 'Mark all read'}</span>
                  </button>
                  <button
                    type="button"
                    data-testid="notification-clear-history-btn"
                    onClick={clearHistory}
                    className="inline-flex items-center gap-1.5 text-red-600 dark:text-red-400 hover:underline cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>{lang === 'vi' ? 'Xóa lịch sử' : 'Clear history'}</span>
                  </button>
                </div>
              )}
            </div>
          </div>,
          document.body
        )}
    </>
  );
}

export default ToastProvider;
