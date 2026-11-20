import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  FileSearch,
  Upload,
  History,
  Menu,
  X,
  LogOut,
  User,
  Layers,
  Users,
  Settings,
  HelpCircle,
  GraduationCap,
  ClipboardCheck,
  Activity,
  FileText,
  Globe,
  Sparkles,
  Tag,
  Loader2,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  Clock,
  PanelLeftClose,
  PanelLeftOpen,
  Shield,
  ChevronsUpDown,
  Sun,
  Moon,
  Monitor,
} from 'lucide-react';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/contexts/AuthContext';
import { useVerificationProgress } from '@/contexts/VerificationProgressContext';
import { getQuotaView } from '@/lib/quotaDisplay';
import { useRole, type UserCapability, type UserRole } from '@/hooks/useRole';
import { useTheme } from '@/contexts/ThemeContext';
import { useToast } from '@/contexts/ToastContext';
import { HelpModal } from './HelpModal';
import { GoogleOnboardingModal } from './GoogleOnboardingModal';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { m, SPRING_PILL } from '@/components/ui/motion-primitives';
import { SymmetricChevron } from '@/components/ui/transitions';

/* ============================================================
   CITRA — App Layout Component (Scholarly Precision v2.0)
   Academic Source Verification Workspace
   ============================================================ */

interface NavItem {
  path: string;
  labelKey: string;
  icon: React.ComponentType<{ className?: string }>;
  /** If set, item is only visible when user has this capability. */
  capability?: UserCapability;
  /** If set, item is only visible when the plan allows batch upload. */
  requiresBatch?: boolean;
}

interface NavGroup {
  labelKey: string;
  /** If set, group is only visible when user role is in this list. */
  roles?: UserRole[];
  items: NavItem[];
}

const SIDEBAR_GROUPS: NavGroup[] = [
  {
    labelKey: 'nav.workspace',
    items: [
      { path: '/dashboard', labelKey: 'nav.dashboard', icon: FileSearch, capability: 'upload_essay' },
      { path: '/upload', labelKey: 'nav.newCheck', icon: Upload, capability: 'upload_essay' },
      { path: '/batch-upload', labelKey: 'nav.batchCheck', icon: Layers, requiresBatch: true },
      { path: '/history', labelKey: 'nav.history', icon: History, capability: 'view_own_history' },
    ],
  },
  {
    labelKey: 'nav.teaching',
    roles: ['teacher', 'admin'],
    items: [
      { path: '/teacher/classes', labelKey: 'nav.myClasses', icon: GraduationCap, capability: 'view_class_history' },
      { path: '/teacher/reviews', labelKey: 'nav.pendingReviews', icon: ClipboardCheck, capability: 'override_verdict' },
    ],
  },
];

const ADMIN_CONSOLE_ITEMS: NavItem[] = [
  { path: '/admin/users', labelKey: 'nav.accounts', icon: Users, capability: 'manage_users' },
  { path: '/admin/promos', labelKey: 'nav.promoCodes', icon: Tag, capability: 'manage_users' },
  { path: '/admin/system', labelKey: 'nav.systemHealth', icon: Activity, capability: 'view_system_health' },
  { path: '/admin/audit', labelKey: 'nav.auditLog', icon: FileText, capability: 'view_audit_log' },
];

export function AppLayout({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const { user, logout } = useAuth();
  const {
    activeSingleCheck,
    recentSingleCheck,
    isSingleCheckInFlight,
    acknowledgeSingleCheck,
    dismissRecentSingleCheck,
    isBatchActive,
    batchStats,
  } = useVerificationProgress();
  const { has, role, planTier, isBasic, quota, canBatchUpload, isAdmin } = useRole();
  const { theme, setTheme, toggleTheme } = useTheme();
  const toast = useToast();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    try {
      return (
        typeof window !== 'undefined' &&
        localStorage.getItem('citra.sidebar.collapsed') === 'true'
      );
    } catch {
      return false;
    }
  });
  const [adminConsoleOpen, setAdminConsoleOpen] = useState<boolean>(() =>
    location.pathname.startsWith('/admin'),
  );
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const accountMenuRef = useRef<HTMLDivElement | null>(null);
  const accountTriggerRef = useRef<HTMLButtonElement | null>(null);
  const [railTooltip, setRailTooltip] = useState<{ label: string; top: number } | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [dismissedActiveKey, setDismissedActiveKey] = useState<string | null>(null);

  const isDesktopCollapsed = sidebarCollapsed && !mobileOpen;

  const closeMobileDrawer = useCallback(() => {
    setMobileOpen(false);
    setAccountMenuOpen(false);
  }, []);

  // Auto-expand Admin Console when visiting any /admin/* route, and close Account Popover on navigation
  useEffect(() => {
    if (location.pathname.startsWith('/admin')) {
      setAdminConsoleOpen(true);
    }
    setAccountMenuOpen(false);
  }, [location.pathname]);

  // Reset mobile drawer state if viewport crosses into lg (>= 1024px) or user presses Escape
  useEffect(() => {
    if (!mobileOpen) return;
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        closeMobileDrawer();
      }
    };
    const mql =
      typeof window !== 'undefined' && typeof window.matchMedia === 'function'
        ? window.matchMedia('(min-width: 1024px)')
        : null;
    const onBreakpointChange = (ev: MediaQueryListEvent) => {
      if (ev.matches) {
        setMobileOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    mql?.addEventListener?.('change', onBreakpointChange);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      mql?.removeEventListener?.('change', onBreakpointChange);
    };
  }, [mobileOpen, closeMobileDrawer]);

  // Close Account Popover on outside click or Escape
  useEffect(() => {
    if (!accountMenuOpen) return;
    const onPointerDown = (ev: MouseEvent) => {
      const target = ev.target as Node | null;
      if (
        target &&
        !accountMenuRef.current?.contains(target) &&
        !accountTriggerRef.current?.contains(target)
      ) {
        setAccountMenuOpen(false);
      }
    };
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        setAccountMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('click', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('click', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [accountMenuOpen]);

  const toggleSidebarCollapse = useCallback(() => {
    setRailTooltip(null);
    setSidebarCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('citra.sidebar.collapsed', String(next));
      } catch {
        // Ignore storage write errors in private contexts
      }
      return next;
    });
  }, []);

  const showRailTooltip = useCallback(
    (el: HTMLElement | null, label: string) => {
      if (!isDesktopCollapsed || !el) return;
      const rect = el.getBoundingClientRect();
      setRailTooltip({ label, top: rect.top + rect.height / 2 });
    },
    [isDesktopCollapsed],
  );

  const hideRailTooltip = useCallback(() => {
    setRailTooltip(null);
  }, []);

  const currentLang = (i18n.resolvedLanguage || i18n.language || 'en').startsWith('vi')
    ? 'vi'
    : 'en';

  const sidebarQuota = getQuotaView(quota, currentLang, { isAdmin });

  // Auto-acknowledge a finished single check once the user views its report
  useEffect(() => {
    const match = location.pathname.match(/^\/verification\/report\/(\d+)/);
    if (match) {
      const viewedId = parseInt(match[1], 10);
      if (!Number.isNaN(viewedId)) {
        acknowledgeSingleCheck(viewedId);
      }
    }
  }, [location.pathname, acknowledgeSingleCheck]);

  const handleSelectLanguage = (next: 'vi' | 'en') => {
    if (next === currentLang) return;
    void i18n.changeLanguage(next);
    localStorage.setItem('language', next);
    localStorage.setItem('i18nextLng', next);
    const fixedT = i18n.getFixedT(next);
    toast.success(
      fixedT('settings.languageUpdated'),
      next === 'vi' ? 'Tiếng Việt' : 'English',
    );
  };

  // Keyboard shortcuts: Ctrl+/ (help), Ctrl+B (toggle sidebar), Ctrl+U (upload), Ctrl+D (toggle theme)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const target = e.target as HTMLElement | null;
      const isEditable =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable;

      if (e.key === '/') {
        e.preventDefault();
        setHelpOpen(true);
      } else if (!isEditable && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        toggleSidebarCollapse();
      } else if (!isEditable && e.key.toLowerCase() === 'u') {
        e.preventDefault();
        navigate('/upload');
      } else if (!isEditable && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        toggleTheme();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [navigate, toggleTheme, toggleSidebarCollapse]);

  const isActive = (path: string) =>
    location.pathname === path ||
    (path === '/upload' && location.pathname.startsWith('/verification/processing')) ||
    (path !== '/dashboard' && location.pathname.startsWith(`${path}/`));

  const handleLogout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await logout();
      navigate('/login');
    } catch (err) {
      console.error('Logout failed:', err);
    } finally {
      setLoggingOut(false);
    }
  };

  return (
    <div className="h-screen supports-[height:100dvh]:h-dvh overflow-hidden bg-slate-50/80 dark:bg-slate-950 flex selection:bg-indigo-500/20 selection:text-indigo-600 dark:selection:text-indigo-300">
      {/* Skip-to-content — visually hidden until focused. WCAG 2.1 Level A */}
      <a
        href="#main-content"
        className="
          sr-only focus:not-sr-only
          focus:absolute focus:top-4 focus:left-4 focus:z-[60]
          focus:px-4 focus:py-2 focus:rounded-lg
          focus:bg-indigo-600 focus:text-white focus:font-medium
          focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-indigo-300
        "
      >
        {t('nav.skipToContent')}
      </a>

      {/* Mobile & Tablet Sticky Header Bar (< lg) */}
      <header className="lg:hidden fixed top-0 inset-x-0 z-30 h-14 px-3.5 sm:px-6 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-b border-slate-200/80 dark:border-slate-800/80 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <button
            onClick={() => setMobileOpen(true)}
            aria-label="Open navigation menu"
            className="p-2 min-h-10 min-w-10 rounded-xl bg-slate-100/80 dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-200/70 dark:hover:bg-slate-700 transition-colors flex items-center justify-center shrink-0"
          >
            <Menu className="h-5 w-5 text-slate-600 dark:text-slate-300" />
          </button>
          <Link
            to="/dashboard"
            onClick={() => setMobileOpen(false)}
            aria-label="Go to dashboard"
            className="inline-flex items-center gap-[8px] rounded-[6px] min-w-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          >
            <span className="w-[28px] h-[28px] rounded-[7px] bg-white dark:bg-[#1E1C17] border border-[#E7E3D9] dark:border-[#332F26] shadow-sm flex items-center justify-center p-1 shrink-0 transition-colors">
              <img
                src="/citra-logo.png"
                alt="CITRA Logo"
                width={18}
                height={18}
                loading="eager"
                decoding="async"
                className="object-contain select-none dark:brightness-150 dark:drop-shadow-[0_0_2px_rgba(255,255,255,0.45)]"
              />
            </span>
            <span className="font-solva-sans text-[20px] font-medium tracking-[-0.02em] leading-none text-[#1C1A15] dark:text-[#FBFAF6] truncate">
              CITRA
            </span>
          </Link>
        </div>

        {(isSingleCheckInFlight || isBatchActive) && (
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              data-testid="mobile-active-progress-pill"
              onClick={() =>
                navigate(isSingleCheckInFlight ? '/upload' : '/batch-upload')
              }
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-indigo-50 dark:bg-indigo-950/80 border border-indigo-200/80 dark:border-indigo-800/80 text-[11px] font-mono font-semibold text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100/80 dark:hover:bg-indigo-900/70 transition-colors cursor-pointer shrink-0"
            >
              <Loader2 className="h-3 w-3 animate-spin shrink-0" />
              <span>
                {isSingleCheckInFlight
                  ? activeSingleCheck?.status === 'queued'
                    ? activeSingleCheck.queuePosition != null
                      ? currentLang === 'vi'
                        ? `Hàng đợi #${activeSingleCheck.queuePosition}`
                        : `Queued #${activeSingleCheck.queuePosition}`
                      : currentLang === 'vi'
                        ? 'Hàng đợi'
                        : 'Queued'
                    : `${activeSingleCheck?.progress ?? 0}%`
                  : `${batchStats.completed}/${batchStats.total}`}
              </span>
            </button>
          </div>
        )}
      </header>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="lg:hidden fixed inset-0 bg-black/50 backdrop-blur-sm z-40 animate-fade-in"
          onClick={closeMobileDrawer}
        />
      )}

      {/* Sidebar — Tailored 232px desktop width (no dead right whitespace) <-> 72px Slim Icon Rail */}
      <aside
        data-testid="app-sidebar"
        data-collapsed={isDesktopCollapsed ? 'true' : 'false'}
        style={{ viewTransitionName: 'citra-app-sidebar' }}
        className={`
          fixed lg:static inset-y-0 left-0 z-50
          w-64 ${isDesktopCollapsed ? 'lg:w-[72px]' : 'lg:w-[232px]'} max-w-[85vw] h-screen supports-[height:100dvh]:h-dvh shrink-0 overflow-hidden bg-white dark:bg-slate-900 border-r border-slate-200/80 dark:border-slate-800/80
          transform transition-[transform,width] ease-[cubic-bezier(0.16,1,0.3,1)]
          lg:transform-none lg:duration-[240ms]
          ${mobileOpen ? 'translate-x-0 shadow-2xl duration-[var(--panel-open-dur)]' : '-translate-x-full lg:translate-x-0 duration-[var(--panel-close-dur)]'}
        `}
      >
        <div className="flex flex-col h-full">
          {/* Logo & ChatGPT-Style Sidebar Collapse / Expand Header */}
          {isDesktopCollapsed ? (
            <div className="py-3 px-2 border-b border-slate-200/80 dark:border-slate-800/80 bg-gradient-to-b from-slate-50/60 to-transparent dark:from-slate-950/40 flex flex-col items-center gap-2 shrink-0">
              <button
                type="button"
                data-testid="sidebar-collapse-toggle"
                aria-expanded="false"
                aria-label={currentLang === 'vi' ? 'Mở rộng thanh bên' : 'Expand sidebar'}
                title={currentLang === 'vi' ? 'Mở thanh bên (Ctrl+B)' : 'Open sidebar (Ctrl+B)'}
                onClick={toggleSidebarCollapse}
                onMouseEnter={(e) =>
                  showRailTooltip(
                    e.currentTarget,
                    currentLang === 'vi' ? 'Mở thanh bên · Ctrl+B' : 'Open sidebar · Ctrl+B',
                  )
                }
                onMouseLeave={hideRailTooltip}
                onFocus={(e) =>
                  showRailTooltip(
                    e.currentTarget,
                    currentLang === 'vi' ? 'Mở thanh bên · Ctrl+B' : 'Open sidebar · Ctrl+B',
                  )
                }
                onBlur={hideRailTooltip}
                className="group/rail-logo relative h-10 w-10 rounded-xl bg-white dark:bg-[#1E1C17] border border-[#E7E3D9] dark:border-[#332F26] hover:border-slate-300 dark:hover:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 shadow-sm flex items-center justify-center transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              >
                <img
                  src="/citra-logo.png"
                  alt="CITRA Logo"
                  width={18}
                  height={18}
                  loading="eager"
                  decoding="async"
                  className="object-contain select-none dark:brightness-150 dark:drop-shadow-[0_0_2px_rgba(255,255,255,0.45)] opacity-100 scale-100 group-hover/rail-logo:opacity-0 group-hover/rail-logo:scale-75 group-focus-visible/rail-logo:opacity-0 transition-all duration-150"
                />
                <PanelLeftOpen className="h-4 w-4 text-slate-700 dark:text-slate-200 absolute opacity-0 scale-75 group-hover/rail-logo:opacity-100 group-hover/rail-logo:scale-100 group-focus-visible/rail-logo:opacity-100 group-focus-visible/rail-logo:scale-100 transition-all duration-150" />
              </button>
            </div>
          ) : (
            <div className="min-h-14 lg:min-h-0 px-3.5 py-2.5 lg:py-3 border-b border-slate-200/80 dark:border-slate-800/80 bg-gradient-to-b from-slate-50/60 to-transparent dark:from-slate-950/40 flex items-center justify-between gap-2 shrink-0">
              <Link
                to="/dashboard"
                onClick={closeMobileDrawer}
                aria-label="Go to dashboard"
                className="inline-flex items-center gap-[8px] rounded-[6px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              >
                <span className="w-[28px] h-[28px] rounded-[7px] bg-white dark:bg-[#1E1C17] border border-[#E7E3D9] dark:border-[#332F26] shadow-sm flex items-center justify-center p-1 shrink-0 transition-colors">
                  <img
                    src="/citra-logo.png"
                    alt="CITRA Logo"
                    width={18}
                    height={18}
                    loading="eager"
                    decoding="async"
                    className="object-contain select-none dark:brightness-150 dark:drop-shadow-[0_0_2px_rgba(255,255,255,0.45)]"
                  />
                </span>
                <span className="font-solva-sans text-[19px] font-medium tracking-[-0.02em] leading-none text-[#1C1A15] dark:text-[#FBFAF6]">
                  CITRA
                </span>
              </Link>

              <button
                type="button"
                data-testid="mobile-sidebar-close-btn"
                onClick={closeMobileDrawer}
                aria-label="Close navigation menu"
                className="lg:hidden inline-flex items-center justify-center h-9 w-9 rounded-xl text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer shrink-0"
              >
                <X className="h-[18px] w-[18px]" />
              </button>

              <div className="hidden lg:flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  data-testid="sidebar-collapse-toggle"
                  aria-expanded="true"
                  aria-label={currentLang === 'vi' ? 'Thu gọn thanh bên' : 'Collapse sidebar'}
                  title={currentLang === 'vi' ? 'Thu gọn thanh bên (Ctrl+B)' : 'Collapse sidebar (Ctrl+B)'}
                  onClick={toggleSidebarCollapse}
                  className="inline-flex items-center justify-center h-8 w-8 rounded-lg text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer shrink-0"
                >
                  <PanelLeftClose className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}

          {/* Navigation — High-Frequency Daily Workspace & Teaching + Collapsible Admin Console */}
          <nav
            onScroll={hideRailTooltip}
            className={`flex-1 overflow-y-auto scrollbar-none ${
              isDesktopCollapsed ? 'px-2 py-3 space-y-1' : 'px-2.5 py-3 space-y-1.5'
            }`}
          >
            {SIDEBAR_GROUPS.map((group, groupIdx) => {
              if (group.roles && !group.roles.includes(role)) return null;
              const visibleItems = group.items.filter(
                (item) =>
                  (!item.capability || has(item.capability)) &&
                  (!item.requiresBatch || canBatchUpload),
              );
              if (visibleItems.length === 0) return null;
              return (
                <div key={group.labelKey} className={!isDesktopCollapsed && group.roles ? 'pt-1.5' : ''}>
                  {isDesktopCollapsed ? (
                    groupIdx > 0 && (
                      <div
                        aria-hidden="true"
                        className="my-2 mx-auto w-6 h-px bg-slate-200/80 dark:bg-slate-800"
                      />
                    )
                  ) : (
                    <p className="px-3.5 py-1 text-[10px] font-mono font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                      {t(group.labelKey)}
                    </p>
                  )}
                  <div className="space-y-0.5">
                    {visibleItems.map((item) => {
                      const Icon = item.icon;
                      const active = isActive(item.path);
                      const showSingleBadge =
                        item.path === '/upload' && isSingleCheckInFlight;
                      const showBatchBadge =
                        item.path === '/batch-upload' && isBatchActive;
                      const itemLabel = t(item.labelKey);

                      return (
                        <Link
                          key={item.path}
                          to={item.path}
                          viewTransition
                          data-view-transition="true"
                          aria-label={isDesktopCollapsed ? itemLabel : undefined}
                          title={isDesktopCollapsed ? itemLabel : undefined}
                          onClick={() => {
                            hideRailTooltip();
                            setMobileOpen(false);
                          }}
                          onMouseEnter={(e) => showRailTooltip(e.currentTarget, itemLabel)}
                          onMouseLeave={hideRailTooltip}
                          onFocus={(e) => showRailTooltip(e.currentTarget, itemLabel)}
                          onBlur={hideRailTooltip}
                          className={`
                            relative flex items-center rounded-xl text-[13.5px] font-medium
                            transition-[background-color,color,box-shadow] duration-150
                            ${
                              isDesktopCollapsed
                                ? 'justify-center h-10 w-10 mx-auto px-0'
                                : 'gap-2.5 pl-3.5 pr-2.5 py-2'
                            }
                            ${
                              active
                                ? 'bg-indigo-50/90 dark:bg-indigo-950/80 text-indigo-700 dark:text-indigo-300 font-semibold ring-1 ring-indigo-500/20 shadow-sm'
                                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100/80 dark:hover:bg-slate-800/60'
                            }
                          `}
                        >
                          {active && (
                            <m.span
                              layoutId="citra-sidebar-active-bar"
                              transition={SPRING_PILL}
                              data-testid="sidebar-active-indicator"
                              className="absolute left-1 top-2 bottom-2 w-1 rounded-full bg-indigo-600 dark:bg-indigo-400"
                            />
                          )}
                          <Icon className={`h-4 w-4 shrink-0 ${active ? 'text-indigo-600 dark:text-indigo-400' : ''}`} />
                          <span className={isDesktopCollapsed ? 'sr-only' : 'truncate'}>
                            {itemLabel}
                          </span>
                          {showSingleBadge && (
                            <span
                              data-testid="sidebar-single-progress-badge"
                              data-open="true"
                              aria-hidden="true"
                              className={
                                isDesktopCollapsed
                                  ? 'absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-indigo-600 dark:bg-indigo-400 animate-pulse'
                                  : 't-badge ml-auto inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold bg-indigo-100 text-indigo-700 dark:bg-indigo-900/70 dark:text-indigo-300 border border-indigo-200/80 dark:border-indigo-700/70 shrink-0'
                              }
                            >
                              {!isDesktopCollapsed && (
                                <Loader2 className="h-2.5 w-2.5 animate-spin" />
                              )}
                              <span className={isDesktopCollapsed ? 'sr-only' : undefined}>
                                {activeSingleCheck?.status === 'queued'
                                  ? activeSingleCheck.queuePosition != null
                                    ? currentLang === 'vi'
                                      ? `Hàng đợi #${activeSingleCheck.queuePosition}`
                                      : `Queued #${activeSingleCheck.queuePosition}`
                                    : currentLang === 'vi'
                                      ? 'Hàng đợi'
                                      : 'Queued'
                                  : `${activeSingleCheck?.progress ?? 0}%`}
                              </span>
                            </span>
                          )}
                          {showBatchBadge && (
                            <span
                              data-testid="sidebar-batch-progress-badge"
                              data-open="true"
                              aria-hidden="true"
                              className={
                                isDesktopCollapsed
                                  ? 'absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-indigo-600 dark:bg-indigo-400 animate-pulse'
                                  : 't-badge ml-auto inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold bg-indigo-100 text-indigo-700 dark:bg-indigo-900/70 dark:text-indigo-300 border border-indigo-200/80 dark:border-indigo-700/70 shrink-0'
                              }
                            >
                              {!isDesktopCollapsed && (
                                <Loader2 className="h-2.5 w-2.5 animate-spin" />
                              )}
                              <span className={isDesktopCollapsed ? 'sr-only' : undefined}>
                                {batchStats.completed}/{batchStats.total}
                              </span>
                            </span>
                          )}
                        </Link>
                      );
                    })}
                  </div>
                </div>
              );
            })}

            {/* Collapsible Admin Console Accordion (Admin-only, collapsed to 1 clean row by default) */}
            {role === 'admin' && (() => {
              const visibleAdminItems = ADMIN_CONSOLE_ITEMS.filter(
                (item) => !item.capability || has(item.capability),
              );
              if (visibleAdminItems.length === 0) return null;
              const isAdminRouteActive = location.pathname.startsWith('/admin');
              const adminLabel = currentLang === 'vi' ? 'Quản trị hệ thống' : 'Admin Console';

              return (
                <div className={isDesktopCollapsed ? '' : 'pt-1.5'}>
                  {isDesktopCollapsed && (
                    <div
                      aria-hidden="true"
                      className="my-2 mx-auto w-6 h-px bg-slate-200/80 dark:bg-slate-800"
                    />
                  )}
                  <button
                    type="button"
                    data-testid="sidebar-admin-console-toggle"
                    aria-expanded={adminConsoleOpen}
                    aria-label={isDesktopCollapsed ? adminLabel : undefined}
                    title={isDesktopCollapsed ? adminLabel : undefined}
                    onClick={() => setAdminConsoleOpen((prev) => !prev)}
                    onMouseEnter={(e) => showRailTooltip(e.currentTarget, adminLabel)}
                    onMouseLeave={hideRailTooltip}
                    className={`w-full flex items-center rounded-xl text-[13.5px] font-medium transition-colors duration-150 cursor-pointer ${
                      isDesktopCollapsed
                        ? 'justify-center h-10 w-10 mx-auto px-0'
                        : 'justify-between gap-2 pl-3.5 pr-2.5 py-2'
                    } ${
                      isAdminRouteActive && !adminConsoleOpen
                        ? 'bg-indigo-50/90 dark:bg-indigo-950/80 text-indigo-700 dark:text-indigo-300 font-semibold ring-1 ring-indigo-500/20'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100/80 dark:hover:bg-slate-800/60'
                    }`}
                  >
                    <span className="flex items-center gap-2.5 min-w-0">
                      <Shield
                        className={`h-4 w-4 shrink-0 ${
                          isAdminRouteActive ? 'text-indigo-600 dark:text-indigo-400' : ''
                        }`}
                      />
                      {!isDesktopCollapsed && <span className="truncate">{adminLabel}</span>}
                    </span>
                    {!isDesktopCollapsed && (
                      <SymmetricChevron
                        open={adminConsoleOpen}
                        size={15}
                        className="text-slate-400 shrink-0"
                      />
                    )}
                  </button>

                  {/* Pure 120Hz ProMotion GPU-Composited Accordion (0ms Layout / 0ms Blur Paint) */}
                  <div
                    data-testid="sidebar-admin-console-panel"
                    data-open={adminConsoleOpen ? 'true' : 'false'}
                    aria-hidden={!adminConsoleOpen}
                    className="citra-admin-accordion-gpu"
                  >
                    <div className="citra-admin-accordion-gpu-inner">
                      <div
                        className={
                          isDesktopCollapsed
                            ? 'pt-1 space-y-0.5'
                            : 'relative mt-1 ml-4 pl-2.5 space-y-0.5'
                        }
                      >
                        {!isDesktopCollapsed && (
                          <span
                            aria-hidden="true"
                            className={`pointer-events-none absolute left-0 top-1 bottom-1 w-px bg-slate-200/90 dark:bg-slate-800 origin-top transition-[transform,opacity] duration-[220ms] ease-[cubic-bezier(0.16,1,0.3,1)] ${
                              adminConsoleOpen ? 'scale-y-100 opacity-100' : 'scale-y-50 opacity-0'
                            }`}
                          />
                        )}
                        {visibleAdminItems.map((item, idx) => {
                          const Icon = item.icon;
                          const active = isActive(item.path);
                          const itemLabel = t(item.labelKey);

                          return (
                            <Link
                              key={item.path}
                              to={item.path}
                              viewTransition
                              data-view-transition="true"
                              tabIndex={adminConsoleOpen ? undefined : -1}
                              aria-label={isDesktopCollapsed ? itemLabel : undefined}
                              title={isDesktopCollapsed ? itemLabel : undefined}
                              onClick={() => {
                                hideRailTooltip();
                                setMobileOpen(false);
                              }}
                              onMouseEnter={(e) => showRailTooltip(e.currentTarget, itemLabel)}
                              onMouseLeave={hideRailTooltip}
                              style={
                                {
                                  '--stagger-ms': `${idx * 22}ms`,
                                } as React.CSSProperties
                              }
                              className={`citra-admin-item-gpu relative flex items-center rounded-xl text-[13px] font-medium ${
                                isDesktopCollapsed
                                  ? 'justify-center h-9 w-10 mx-auto px-0'
                                  : 'gap-2.5 px-2.5 py-1.5'
                              } ${
                                active
                                  ? 'bg-indigo-50/90 dark:bg-indigo-950/80 text-indigo-700 dark:text-indigo-300 font-semibold'
                                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100/80 dark:hover:bg-slate-800/60'
                              }`}
                            >
                              {active && adminConsoleOpen && (
                                <m.span
                                  layoutId="citra-sidebar-active-bar"
                                  transition={SPRING_PILL}
                                  data-testid="sidebar-active-indicator"
                                  className="absolute left-1 top-1.5 bottom-1.5 w-1 rounded-full bg-indigo-600 dark:bg-indigo-400"
                                />
                              )}
                              <Icon className={`h-3.5 w-3.5 shrink-0 ${active ? 'text-indigo-600 dark:text-indigo-400' : ''}`} />
                              <span className={isDesktopCollapsed ? 'sr-only' : 'truncate'}>
                                {itemLabel}
                              </span>
                            </Link>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })()}
          </nav>

          {/* Bottom ChatGPT-Style Single Account Pill + Compact Basic Upgrade CTA */}
          <div
            data-testid="sidebar-quota-card"
            className={`border-t border-slate-200/80 dark:border-slate-800/80 bg-slate-50/50 dark:bg-slate-900/50 shrink-0 ${
              isDesktopCollapsed ? 'p-2 flex flex-col items-center gap-1.5' : 'p-2 space-y-1.5'
            }`}
          >
            {isBasic && (
              <Link
                to="/pricing"
                onClick={() => {
                  hideRailTooltip();
                  setMobileOpen(false);
                }}
                onMouseEnter={(e) =>
                  showRailTooltip(
                    e.currentTarget,
                    currentLang === 'vi' ? 'Nâng cấp Pro · $16/th' : 'Upgrade to Pro · $16/mo',
                  )
                }
                onMouseLeave={hideRailTooltip}
                data-testid="sidebar-upgrade-link"
                className={
                  isDesktopCollapsed
                    ? 'h-9 w-10 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white inline-flex items-center justify-center transition-colors shadow-sm'
                    : 'w-full inline-flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold transition-colors shadow-sm'
                }
              >
                <Sparkles className="h-3.5 w-3.5 shrink-0" />
                {!isDesktopCollapsed && (
                  <span className="truncate">
                    {currentLang === 'vi'
                      ? 'Nâng cấp Pro · $16/th'
                      : 'Upgrade Pro · $16/mo'}
                  </span>
                )}
              </Link>
            )}

            <button
              ref={accountTriggerRef}
              type="button"
              data-testid="sidebar-account-trigger"
              aria-expanded={accountMenuOpen}
              aria-haspopup="menu"
              onClick={() => {
                hideRailTooltip();
                setAccountMenuOpen((prev) => !prev);
              }}
              onMouseEnter={(e) =>
                showRailTooltip(
                  e.currentTarget,
                  `${user?.full_name || user?.username || 'User'} (${planTier.toUpperCase()})`,
                )
              }
              onMouseLeave={hideRailTooltip}
              className={`w-full flex items-center rounded-xl transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                isDesktopCollapsed
                  ? 'justify-center p-1 hover:bg-slate-100 dark:hover:bg-slate-800'
                  : 'gap-2.5 px-2 py-1.5 hover:bg-white dark:hover:bg-slate-800/90 border border-transparent hover:border-slate-200/90 dark:hover:border-slate-700'
              } ${
                accountMenuOpen
                  ? 'bg-white dark:bg-slate-800 border-slate-200/90 dark:border-slate-700 shadow-sm'
                  : ''
              }`}
            >
              <Avatar className="h-8 w-8 border-2 border-indigo-200 dark:border-indigo-800 shrink-0">
                {user?.avatar_url ? (
                  <AvatarImage src={user.avatar_url} alt={user?.username} />
                ) : (
                  <AvatarFallback>
                    <User className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />
                  </AvatarFallback>
                )}
              </Avatar>

              <div className={isDesktopCollapsed ? 'sr-only' : 'flex-1 min-w-0 text-left'}>
                <p className="text-[13px] font-semibold text-slate-900 dark:text-slate-100 truncate leading-tight">
                  {user?.full_name || user?.username || 'User'}
                </p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span
                    data-testid="sidebar-plan-badge"
                    className={`px-1.5 py-0.5 rounded text-[9px] font-mono font-bold uppercase leading-tight ${
                      planTier === 'ultra'
                        ? 'bg-violet-600 text-white'
                        : planTier === 'pro'
                          ? 'bg-indigo-600 text-white'
                          : 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200'
                    }`}
                  >
                    {planTier.toUpperCase()}
                  </span>
                  <span className="text-[10.5px] text-slate-400">·</span>
                  <span
                    data-testid="sidebar-quota-text"
                    className="text-[10.5px] font-mono text-slate-500 dark:text-slate-400 truncate"
                  >
                    {sidebarQuota.uploadsUnlimited
                      ? sidebarQuota.usage
                      : `${quota.monthly_uploads_used} / ${quota.monthly_uploads_limit}`}
                  </span>
                </div>
              </div>

              {!isDesktopCollapsed && (
                <ChevronsUpDown className="h-3.5 w-3.5 text-slate-400 shrink-0" />
              )}
            </button>
          </div>
        </div>
      </aside>

      {/* ChatGPT-Style Floating Bottom-Left Account Popover Menu (Warm-mounted 120Hz GPU Open & Close) */}
      <div
        ref={accountMenuRef}
        role="menu"
        data-testid="sidebar-account-popover"
        data-open={accountMenuOpen ? 'true' : 'false'}
        data-rail={isDesktopCollapsed ? 'true' : 'false'}
        aria-hidden={!accountMenuOpen}
        className={`citra-account-popover-gpu fixed z-[75] max-h-[calc(100dvh-70px)] overflow-y-auto rounded-2xl border border-slate-200/90 dark:border-slate-700/90 bg-white dark:bg-slate-900 shadow-[0_18px_42px_-10px_rgba(15,23,42,0.22)] dark:shadow-[0_20px_48px_-10px_rgba(0,0,0,0.7)] p-1.5 text-sm ${
          isDesktopCollapsed
            ? 'bottom-3 left-3 lg:left-[80px] w-[244px]'
            : 'bottom-[58px] left-2 w-[240px] max-w-[calc(85vw-16px)] lg:w-[216px]'
        }`}
      >
        {/* Identity & Quota Header */}
        <div className="px-2.5 py-2 rounded-xl bg-slate-50/90 dark:bg-slate-800/60 border border-slate-200/60 dark:border-slate-800 mb-1 space-y-1.5">
          <div className="min-w-0">
            <p className="text-xs font-semibold text-slate-900 dark:text-white truncate">
              {user?.email || user?.username || 'User'}
            </p>
            <p className="text-[10.5px] font-mono text-slate-500 dark:text-slate-400 capitalize">
              {user?.role || 'user'} · {planTier.toUpperCase()}
            </p>
          </div>
          <div className="space-y-1">
            <div className="flex items-center justify-between text-[10.5px] text-slate-600 dark:text-slate-400">
              <span className="truncate">{currentLang === 'vi' ? 'Lượt tháng' : 'Monthly Checks'}</span>
              <span className="font-mono font-semibold text-slate-900 dark:text-white shrink-0">
                {sidebarQuota.uploadsUnlimited
                  ? sidebarQuota.usage
                  : `${quota.monthly_uploads_used} / ${quota.monthly_uploads_limit}`}
              </span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
              <div
                className={`h-full rounded-full transition-[width] duration-300 ${
                  sidebarQuota.exhausted ? 'bg-red-500' : 'bg-indigo-600 dark:bg-indigo-400'
                }`}
                style={{
                  width: `${sidebarQuota.uploadsUnlimited ? 100 : sidebarQuota.percent}%`,
                }}
              />
            </div>
          </div>
        </div>

        {/* Personal & Plan Links */}
        <div className="space-y-0.5">
          <Link
            to="/profile"
            tabIndex={accountMenuOpen ? undefined : -1}
            onClick={() => {
              setAccountMenuOpen(false);
              setMobileOpen(false);
            }}
            className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-xl text-[13px] font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <User className="h-4 w-4 text-slate-500 dark:text-slate-400 shrink-0" />
            <span className="truncate">{t('nav.viewProfile')}</span>
          </Link>

          <Link
            to="/pricing"
            tabIndex={accountMenuOpen ? undefined : -1}
            onClick={() => {
              setAccountMenuOpen(false);
              setMobileOpen(false);
            }}
            className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-xl text-[13px] font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <Sparkles className="h-4 w-4 text-indigo-600 dark:text-indigo-400 shrink-0" />
            <span className="truncate">{t('nav.pricing')}</span>
          </Link>

          <Link
            to="/settings"
            tabIndex={accountMenuOpen ? undefined : -1}
            onClick={() => {
              setAccountMenuOpen(false);
              setMobileOpen(false);
            }}
            className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-xl text-[13px] font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <Settings className="h-4 w-4 text-slate-500 dark:text-slate-400 shrink-0" />
            <span className="truncate">{t('nav.settings')}</span>
          </Link>
        </div>

        <div className="my-1 h-px bg-slate-200/80 dark:bg-slate-800" />

        {/* Inline Theme & Language Segmented Controls with 120fps Sliding Pill Thumb */}
        <div className="px-2.5 py-1.5 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400 truncate">
              {t('nav.theme')}
            </span>
            <div className="relative grid grid-cols-3 p-0.5 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700 shrink-0">
              <span
                aria-hidden="true"
                style={{
                  transform: `translate3d(${
                    theme === 'light' ? '0%' : theme === 'dark' ? '100%' : '200%'
                  }, 0, 0)`,
                }}
                className="pointer-events-none absolute top-0.5 bottom-0.5 left-0.5 w-[calc((100%-4px)/3)] rounded-md bg-white dark:bg-slate-900 shadow-sm transition-transform duration-[220ms] ease-[cubic-bezier(0.16,1,0.3,1)]"
              />
              {([
                { key: 'light', icon: Sun, label: 'Light' },
                { key: 'dark', icon: Moon, label: 'Dark' },
                { key: 'system', icon: Monitor, label: 'System' },
              ] as const).map(({ key, icon: ModeIcon, label }) => {
                const activeMode = theme === key;
                return (
                  <button
                    key={key}
                    type="button"
                    tabIndex={accountMenuOpen ? undefined : -1}
                    title={label}
                    aria-label={label}
                    onClick={() => setTheme(key)}
                    className={`relative z-10 h-6 w-6 rounded-md inline-flex items-center justify-center transition-colors cursor-pointer ${
                      activeMode
                        ? 'text-slate-900 dark:text-white'
                        : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                    }`}
                  >
                    <ModeIcon className="h-3.5 w-3.5" />
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400 flex items-center gap-1.5 min-w-0">
              <Globe className="h-3.5 w-3.5 text-slate-400 shrink-0" />
              <span className="truncate">{currentLang === 'vi' ? 'Ngôn ngữ' : 'Language'}</span>
            </span>
            <div className="relative grid grid-cols-2 p-0.5 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700 text-[10.5px] font-mono font-bold shrink-0">
              <span
                aria-hidden="true"
                style={{
                  transform: `translate3d(${currentLang === 'vi' ? '0%' : '100%'}, 0, 0)`,
                }}
                className="pointer-events-none absolute top-0.5 bottom-0.5 left-0.5 w-[calc((100%-4px)/2)] rounded-md bg-white dark:bg-slate-900 shadow-sm transition-transform duration-[220ms] ease-[cubic-bezier(0.16,1,0.3,1)]"
              />
              {(['vi', 'en'] as const).map((lng) => {
                const isCurr = currentLang === lng;
                return (
                  <button
                    key={lng}
                    type="button"
                    tabIndex={accountMenuOpen ? undefined : -1}
                    onClick={() => handleSelectLanguage(lng)}
                    className={`relative z-10 px-2 py-0.5 rounded-md uppercase transition-colors cursor-pointer ${
                      isCurr
                        ? 'text-slate-900 dark:text-white'
                        : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                    }`}
                  >
                    {lng}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <button
          type="button"
          tabIndex={accountMenuOpen ? undefined : -1}
          onClick={() => {
            closeMobileDrawer();
            setHelpOpen(true);
          }}
          className="w-full flex items-center justify-between gap-1.5 px-2.5 py-1.5 rounded-xl text-[12.5px] font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
        >
          <span className="flex items-center gap-2 min-w-0">
            <HelpCircle className="h-4 w-4 text-slate-500 dark:text-slate-400 shrink-0" />
            <span className="truncate">{t('nav.helpShortcuts')}</span>
          </span>
          <kbd className="px-1.5 py-0.5 text-[10px] font-mono bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded text-slate-500 shrink-0">
            Ctrl+/
          </kbd>
        </button>

        <div className="my-1 h-px bg-slate-200/80 dark:bg-slate-800" />

        <button
          type="button"
          tabIndex={accountMenuOpen ? undefined : -1}
          data-testid="account-popover-signout"
          onClick={() => {
            closeMobileDrawer();
            void handleLogout();
          }}
          disabled={loggingOut}
          className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-xl text-[13px] font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/35 transition-colors disabled:opacity-50 cursor-pointer"
        >
          {loggingOut ? (
            <div className="h-4 w-4 border-2 border-red-600/30 border-t-red-600 rounded-full animate-spin" />
          ) : (
            <LogOut className="h-4 w-4 shrink-0" />
          )}
          <span>{loggingOut ? t('nav.signingOut') : t('nav.signOut')}</span>
        </button>
      </div>

      {/* Floating ChatGPT-Style Dark Rail Tooltip (Never clipped by overflow-y-auto!) */}
      {isDesktopCollapsed && railTooltip && (
        <div
          role="tooltip"
          style={{ top: `${railTooltip.top}px` }}
          className="hidden lg:inline-flex fixed left-[80px] -translate-y-1/2 z-[70] pointer-events-none items-center px-2.5 py-1.5 rounded-lg bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-xs font-medium shadow-lg whitespace-nowrap animate-fade-in"
        >
          {railTooltip.label}
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0 h-screen supports-[height:100dvh]:h-dvh overflow-hidden relative">
        {/* Subtle Architectural Background Aura */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden z-0">
          <div
            className="absolute inset-0 opacity-40 dark:opacity-15"
            style={{
              backgroundImage:
                'radial-gradient(rgb(148 163 184 / 0.28) 1px, transparent 1px)',
              backgroundSize: '24px 24px',
            }}
          />
          <div className="absolute -top-32 right-0 w-[480px] h-[300px] bg-gradient-to-bl from-indigo-500/10 via-indigo-400/5 to-transparent blur-3xl rounded-full" />
        </div>

        <main
          id="main-content"
          tabIndex={-1}
          className="relative flex-1 overflow-y-auto overflow-x-hidden flex flex-col pt-[4.5rem] sm:pt-20 lg:pt-8 focus:outline-none"
        >
          <div
            data-testid="app-main-container"
            data-sidebar-collapsed={isDesktopCollapsed ? 'true' : 'false'}
            className={`citra-main-cq flex-1 w-full mx-auto min-w-0 px-3.5 sm:px-6 ${
              isDesktopCollapsed
                ? 'lg:px-7 xl:px-9 max-w-[1780px] 2xl:max-w-[1960px]'
                : 'lg:px-8 xl:px-10 max-w-[1440px] 2xl:max-w-[1680px]'
            } pb-8 lg:pb-12 transition-[max-width,padding] duration-300`}
          >
            {children}
          </div>

          {/* Footer — flows naturally at the very bottom of the scrollable page */}
          <footer
            data-testid="app-footer"
            className="relative mt-auto shrink-0 border-t border-slate-200/80 dark:border-slate-800/80 bg-white/85 dark:bg-slate-900/85 backdrop-blur-md px-3.5 sm:px-6 lg:px-8 xl:px-10 py-3"
          >
            <div
              className={`mx-auto w-full ${
                isDesktopCollapsed
                  ? 'max-w-[1780px] 2xl:max-w-[1960px]'
                  : 'max-w-[1440px] 2xl:max-w-[1680px]'
              } flex flex-col sm:flex-row items-center justify-between gap-1 text-[11px] sm:text-xs text-slate-500 dark:text-slate-400 text-center sm:text-left transition-[max-width] duration-300`}
            >
              <p className="flex items-center justify-center sm:justify-start gap-2 font-medium">
                <span className="w-[20px] h-[20px] rounded-[5px] bg-white dark:bg-[#1E1C17] border border-[#E7E3D9] dark:border-[#332F26] shadow-sm flex items-center justify-center p-0.5 shrink-0 transition-colors">
                  <img
                    src="/citra-logo.png"
                    alt="CITRA"
                    width={13}
                    height={13}
                    className="object-contain dark:brightness-150 dark:drop-shadow-[0_0_2px_rgba(255,255,255,0.45)] select-none shrink-0"
                  />
                </span>
                <span className="truncate">{t('nav.footerBrand')}</span>
              </p>
              <p className="font-mono text-[10px] sm:text-[11px] truncate max-w-full">{t('nav.footerSystem')}</p>
            </div>
          </footer>
        </main>

        {/* Floating Background Verification Pill (Desktop & Mobile) */}
        {(() => {
          const isOnActiveProcessingRoute =
            activeSingleCheck?.essayId != null &&
            location.pathname === `/verification/processing/${activeSingleCheck.essayId}`;
          const isOnBatchRoute =
            location.pathname === '/batch' || location.pathname === '/batch-upload';

          const activeSingleKey = activeSingleCheck
            ? `single:${activeSingleCheck.essayId ?? activeSingleCheck.startedAt}`
            : null;
          const activeBatchKey = isBatchActive
            ? `batch:${batchStats.total}`
            : null;

          const showSingleActive =
            isSingleCheckInFlight &&
            Boolean(activeSingleCheck) &&
            !isOnActiveProcessingRoute &&
            dismissedActiveKey !== activeSingleKey;

          const showBatchActive =
            !showSingleActive &&
            isBatchActive &&
            !isOnBatchRoute &&
            dismissedActiveKey !== activeBatchKey;

          const showRecentTerminal =
            !showSingleActive &&
            !showBatchActive &&
            Boolean(recentSingleCheck) &&
            location.pathname !== `/verification/processing/${recentSingleCheck?.essayId}` &&
            location.pathname !== `/verification/report/${recentSingleCheck?.essayId}`;

          if (!showSingleActive && !showBatchActive && !showRecentTerminal) {
            return null;
          }

          if (showSingleActive && activeSingleCheck) {
            const isQueued = activeSingleCheck.status === 'queued';
            const totalSteps = activeSingleCheck.totalSteps || 8;
            const stepNum = Math.min(
              totalSteps,
              Math.max(1, (activeSingleCheck.stepIndex ?? 0) + 1),
            );
            const statusText = isQueued
              ? activeSingleCheck.queuePosition != null
                ? currentLang === 'vi'
                  ? `Hàng đợi #${activeSingleCheck.queuePosition}`
                  : `Queued #${activeSingleCheck.queuePosition}`
                : currentLang === 'vi'
                  ? 'Đang xếp hàng'
                  : 'Queued'
              : currentLang === 'vi'
                ? `Bước ${stepNum}/${totalSteps} · ${activeSingleCheck.progress}%`
                : `Step ${stepNum}/${totalSteps} · ${activeSingleCheck.progress}%`;

            return (
              <div
                data-testid="floating-verification-pill"
                className="fixed bottom-5 sm:bottom-6 right-3.5 sm:right-6 z-40 max-w-[calc(100vw-1.75rem)] sm:max-w-sm flex items-center gap-1 rounded-full border border-indigo-200/90 dark:border-indigo-800/90 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md pl-3.5 pr-1.5 py-1.5 shadow-lg ring-1 ring-indigo-500/15"
              >
                <button
                  type="button"
                  data-testid="floating-verification-pill-action"
                  onClick={() =>
                    navigate(
                      activeSingleCheck.essayId != null
                        ? `/verification/processing/${activeSingleCheck.essayId}`
                        : '/upload',
                    )
                  }
                  className="flex items-center gap-2 min-w-0 text-left text-xs font-medium text-slate-800 dark:text-slate-100 hover:text-indigo-600 dark:hover:text-indigo-300 transition-colors cursor-pointer"
                >
                  {isQueued ? (
                    <Clock className="h-3.5 w-3.5 text-amber-500 animate-pulse shrink-0" />
                  ) : (
                    <Loader2 className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400 animate-spin shrink-0" />
                  )}
                  <span className="truncate max-w-[120px] sm:max-w-[150px] font-semibold">
                    {activeSingleCheck.filename}
                  </span>
                  <span className="font-mono text-[11px] px-2 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-950/80 text-indigo-700 dark:text-indigo-300 border border-indigo-200/70 dark:border-indigo-800/70 shrink-0">
                    {statusText}
                  </span>
                </button>
                <button
                  type="button"
                  data-testid="floating-verification-pill-dismiss"
                  aria-label={currentLang === 'vi' ? 'Ẩn thông báo' : 'Dismiss'}
                  onClick={() => setDismissedActiveKey(activeSingleKey)}
                  className="p-1.5 rounded-full text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors shrink-0 cursor-pointer"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          }

          if (showBatchActive) {
            const batchLabel =
              currentLang === 'vi'
                ? `Hàng loạt: ${batchStats.completed}/${batchStats.total} hoàn tất`
                : `Batch: ${batchStats.completed}/${batchStats.total} completed`;

            return (
              <div
                data-testid="floating-verification-pill"
                className="fixed bottom-5 sm:bottom-6 right-3.5 sm:right-6 z-40 max-w-[calc(100vw-1.75rem)] sm:max-w-sm flex items-center gap-1 rounded-full border border-indigo-200/90 dark:border-indigo-800/90 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md pl-3.5 pr-1.5 py-1.5 shadow-lg ring-1 ring-indigo-500/15"
              >
                <button
                  type="button"
                  data-testid="floating-verification-pill-action"
                  onClick={() => navigate('/batch-upload')}
                  className="flex items-center gap-2 min-w-0 text-left text-xs font-semibold text-slate-800 dark:text-slate-100 hover:text-indigo-600 dark:hover:text-indigo-300 transition-colors cursor-pointer"
                >
                  <Layers className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400 shrink-0" />
                  <span className="font-mono text-[11px] truncate">{batchLabel}</span>
                  <ArrowRight className="h-3 w-3 text-indigo-500 shrink-0" />
                </button>
                <button
                  type="button"
                  data-testid="floating-verification-pill-dismiss"
                  aria-label={currentLang === 'vi' ? 'Ẩn thông báo' : 'Dismiss'}
                  onClick={() => setDismissedActiveKey(activeBatchKey)}
                  className="p-1.5 rounded-full text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors shrink-0 cursor-pointer"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          }

          if (showRecentTerminal && recentSingleCheck) {
            const isCompleted = recentSingleCheck.status === 'completed';
            const refundSuffix =
              !isCompleted && recentSingleCheck.quotaCharged === false
                ? currentLang === 'vi'
                  ? ' · Đã hoàn lượt'
                  : ' · Credit Refunded'
                : '';
            const terminalLabel = isCompleted
              ? currentLang === 'vi'
                ? 'Hoàn tất → Mở Báo cáo'
                : 'Completed → Open Report'
              : currentLang === 'vi'
                ? `Thất bại${refundSuffix} → Thử lại`
                : `Failed${refundSuffix} → Retry`;

            return (
              <div
                data-testid="floating-verification-pill"
                className={`fixed bottom-5 sm:bottom-6 right-3.5 sm:right-6 z-40 max-w-[calc(100vw-1.75rem)] sm:max-w-md flex items-center gap-1 rounded-full border backdrop-blur-md pl-3.5 pr-1.5 py-1.5 shadow-lg ${
                  isCompleted
                    ? 'border-emerald-200/90 dark:border-emerald-800/90 bg-white/95 dark:bg-slate-900/95 ring-1 ring-emerald-500/15'
                    : 'border-red-200/90 dark:border-red-800/90 bg-white/95 dark:bg-slate-900/95 ring-1 ring-red-500/15'
                }`}
              >
                <button
                  type="button"
                  data-testid="floating-verification-pill-action"
                  onClick={() => {
                    const id = recentSingleCheck.essayId;
                    dismissRecentSingleCheck(id ?? undefined);
                    if (id != null) {
                      navigate(
                        isCompleted
                          ? `/verification/report/${id}`
                          : `/verification/processing/${id}`,
                      );
                    } else {
                      navigate('/upload');
                    }
                  }}
                  className="flex items-center gap-2 min-w-0 text-left text-xs font-medium text-slate-800 dark:text-slate-100 cursor-pointer"
                >
                  {isCompleted ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  ) : (
                    <AlertCircle className="h-3.5 w-3.5 text-red-600 dark:text-red-400 shrink-0" />
                  )}
                  <span className="truncate max-w-[110px] sm:max-w-[140px] font-semibold">
                    {recentSingleCheck.filename}
                  </span>
                  <span
                    className={`font-mono text-[11px] px-2 py-0.5 rounded-full border shrink-0 ${
                      isCompleted
                        ? 'bg-emerald-50 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800'
                        : 'bg-red-50 dark:bg-red-950/70 text-red-700 dark:text-red-300 border-red-200 dark:border-red-800'
                    }`}
                  >
                    {terminalLabel}
                  </span>
                </button>
                <button
                  type="button"
                  data-testid="floating-verification-pill-dismiss"
                  aria-label={currentLang === 'vi' ? 'Đóng thông báo' : 'Dismiss'}
                  onClick={() =>
                    dismissRecentSingleCheck(recentSingleCheck.essayId ?? undefined)
                  }
                  className="p-1.5 rounded-full text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors shrink-0 cursor-pointer"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          }

          return null;
        })()}
      </div>

      {/* Help Modal */}
      <HelpModal isOpen={helpOpen} onClose={() => setHelpOpen(false)} />

      {/* First-Time Google Account Onboarding Modal */}
      <GoogleOnboardingModal />
    </div>
  );
}
