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
  FlaskConical,
  Tag,
} from 'lucide-react';
import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/contexts/AuthContext';
import { getQuotaView } from '@/lib/quotaDisplay';
import { useRole, type UserCapability, type UserRole } from '@/hooks/useRole';
import { ThemeToggle, useTheme } from '@/contexts/ThemeContext';
import { NotificationCenterButton, useToast } from '@/contexts/ToastContext';
import { HelpModal } from './HelpModal';
import { GoogleOnboardingModal } from './GoogleOnboardingModal';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Separator } from '@/components/ui/separator';

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
      { path: '/sandbox', labelKey: 'nav.liveSandbox', icon: FlaskConical, capability: 'upload_essay' },
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
  {
    labelKey: 'nav.administration',
    roles: ['admin'],
    items: [
      { path: '/admin/users', labelKey: 'nav.accounts', icon: Users, capability: 'manage_users' },
      { path: '/admin/promos', labelKey: 'nav.promoCodes', icon: Tag, capability: 'manage_users' },
      { path: '/admin/system', labelKey: 'nav.systemHealth', icon: Activity, capability: 'view_system_health' },
      { path: '/admin/audit', labelKey: 'nav.auditLog', icon: FileText, capability: 'view_audit_log' },
    ],
  },
  {
    labelKey: 'nav.preferences',
    items: [
      { path: '/pricing', labelKey: 'nav.pricing', icon: Sparkles },
      { path: '/settings', labelKey: 'nav.settings', icon: Settings },
    ],
  },
];

export function AppLayout({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const { user, logout } = useAuth();
  const { has, role, planTier, isBasic, quota, canBatchUpload, isAdmin } = useRole();
  const { toggleTheme } = useTheme();
  const toast = useToast();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  const currentLang = (i18n.resolvedLanguage || i18n.language || 'en').startsWith('vi')
    ? 'vi'
    : 'en';

  const sidebarQuota = getQuotaView(quota, currentLang, { isAdmin });

  const handleToggleLanguage = () => {
    const next = currentLang === 'en' ? 'vi' : 'en';
    void i18n.changeLanguage(next);
    localStorage.setItem('language', next);
    localStorage.setItem('i18nextLng', next);
    const fixedT = i18n.getFixedT(next);
    toast.success(
      fixedT('settings.languageUpdated'),
      next === 'vi' ? 'Tiếng Việt' : 'English',
    );
  };

  // Keyboard shortcuts: Ctrl+/ (help), Ctrl+U (upload), Ctrl+D (toggle theme)
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
  }, [navigate, toggleTheme]);

  const isActive = (path: string) =>
    location.pathname === path ||
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
      <header className="lg:hidden fixed top-0 inset-x-0 z-30 h-14 px-3.5 sm:px-6 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-b border-slate-200/80 dark:border-slate-800/80 flex items-center justify-between gap-3">
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
            <span className="w-[28px] h-[28px] rounded-[7px] bg-white dark:bg-[#1E1C17] border border-[#E7E3D9] dark:border-[#332F26] shadow-2xs flex items-center justify-center p-1 shrink-0 transition-colors">
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

        <div className="flex items-center gap-2 shrink-0">
          <NotificationCenterButton lang={currentLang} compact />
        </div>
      </header>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="lg:hidden fixed inset-0 bg-black/50 backdrop-blur-sm z-40 animate-fade-in"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`
          fixed lg:static inset-y-0 left-0 z-50
          w-72 max-w-[85vw] h-screen supports-[height:100dvh]:h-dvh shrink-0 overflow-hidden bg-white dark:bg-slate-900 border-r border-slate-200/80 dark:border-slate-800/80
          transform transition-transform duration-300 ease-out
          lg:transform-none
          ${mobileOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full lg:translate-x-0'}
        `}
      >
        {/* Mobile close button */}
        <button
          onClick={() => setMobileOpen(false)}
          aria-label="Close navigation menu"
          className="lg:hidden absolute top-4 right-4 p-2 min-h-11 min-w-11 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
        >
          <X className="h-5 w-5 text-slate-500" />
        </button>

        <div className="flex flex-col h-full">
          {/* Logo & Branding */}
          <div className="p-5 border-b border-slate-200/80 dark:border-slate-800/80 bg-gradient-to-b from-slate-50/60 to-transparent dark:from-slate-950/40">
            <Link
              to="/dashboard"
              onClick={() => setMobileOpen(false)}
              aria-label="Go to dashboard"
              className="inline-flex items-center gap-[8px] rounded-[6px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            >
              <span className="w-[28px] h-[28px] rounded-[7px] bg-white dark:bg-[#1E1C17] border border-[#E7E3D9] dark:border-[#332F26] shadow-2xs flex items-center justify-center p-1 shrink-0 transition-colors">
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
              <span className="font-solva-sans text-[20px] font-medium tracking-[-0.02em] leading-none text-[#1C1A15] dark:text-[#FBFAF6]">
                CITRA
              </span>
            </Link>
          </div>

          {/* Navigation — capability-driven */}
          <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1.5">
            {SIDEBAR_GROUPS.map((group) => {
              if (group.roles && !group.roles.includes(role)) return null;
              const visibleItems = group.items.filter(
                (item) =>
                  (!item.capability || has(item.capability)) &&
                  (!item.requiresBatch || canBatchUpload),
              );
              if (visibleItems.length === 0) return null;
              return (
                <div key={group.labelKey} className={group.roles ? 'pt-2' : ''}>
                  <p className="px-3.5 py-1.5 text-[10px] font-mono font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                    {t(group.labelKey)}
                  </p>
                  <div className="space-y-0.5">
                    {visibleItems.map((item) => {
                      const Icon = item.icon;
                      const active = isActive(item.path);
                      return (
                        <Link
                          key={item.path}
                          to={item.path}
                          onClick={() => setMobileOpen(false)}
                          className={`
                            relative flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium
                            transition-all duration-200
                            ${active
                              ? 'bg-indigo-50/90 dark:bg-indigo-950/80 text-indigo-700 dark:text-indigo-300 font-semibold ring-1 ring-indigo-500/20 shadow-2xs'
                              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100/80 dark:hover:bg-slate-800/60'
                            }
                          `}
                        >
                          {active && (
                            <span className="absolute left-0 top-2 bottom-2 w-1 rounded-r-full bg-indigo-600 dark:bg-indigo-400" />
                          )}
                          <Icon className={`h-4 w-4 shrink-0 ${active ? 'text-indigo-600 dark:text-indigo-400' : ''}`} />
                          <span>{t(item.labelKey)}</span>
                        </Link>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </nav>

          {/* Subscription Quota & Upgrade Card */}
          <div className="px-3.5 pb-2" data-testid="sidebar-quota-card">
            <div className="rounded-xl p-3 bg-gradient-to-br from-slate-50 via-white to-indigo-50/40 dark:from-slate-800/80 dark:via-slate-900 dark:to-indigo-950/30 border border-slate-200/90 dark:border-slate-800 space-y-2 shadow-2xs">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-mono font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300">
                  {currentLang === 'vi' ? 'Gói cước' : 'Plan'}
                </span>
                <span
                  data-testid="sidebar-plan-badge"
                  className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold uppercase ${
                    planTier === 'ultra'
                      ? 'bg-violet-600 text-white'
                      : planTier === 'pro'
                        ? 'bg-indigo-600 text-white'
                        : 'bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-slate-200'
                  }`}
                >
                  {planTier.toUpperCase()}
                </span>
              </div>

              <div className="space-y-1">
                <div className="flex items-center justify-between text-[11px] font-mono text-slate-600 dark:text-slate-400">
                  <span>
                    {currentLang === 'vi' ? 'Lượt tải tháng' : 'Monthly Checks'}
                  </span>
                  <span data-testid="sidebar-quota-text" className="font-semibold text-slate-900 dark:text-white">
                    {sidebarQuota.uploadsUnlimited
                      ? sidebarQuota.usage
                      : `${quota.monthly_uploads_used} / ${quota.monthly_uploads_limit}`}
                  </span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-300 ${
                      sidebarQuota.exhausted
                        ? 'bg-red-500'
                        : 'bg-indigo-600 dark:bg-indigo-400'
                    }`}
                    style={{
                      width: `${sidebarQuota.uploadsUnlimited ? 100 : sidebarQuota.percent}%`,
                    }}
                  />
                </div>
              </div>

              {isBasic && (
                <Link
                  to="/pricing"
                  onClick={() => setMobileOpen(false)}
                  data-testid="sidebar-upgrade-link"
                  className="mt-1 w-full inline-flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold transition-colors shadow-2xs"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  <span>
                    {currentLang === 'vi'
                      ? 'Nâng cấp Pro · $16/th'
                      : 'Upgrade to Pro · $16/mo'}
                  </span>
                </Link>
              )}
            </div>
          </div>

          <Separator />

          {/* Theme Toggle, Language & Help */}
          <div className="px-4 py-2.5 space-y-1">
            <div className="flex items-center justify-between px-2 py-1 gap-2">
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400">{t('nav.theme')}</span>
              <div className="flex items-center gap-1.5">
                <NotificationCenterButton lang={currentLang} />
                <button
                  type="button"
                  onClick={handleToggleLanguage}
                  title="Switch language (VI / EN)"
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700 text-[11px] font-mono font-semibold text-slate-700 dark:text-slate-300 hover:border-indigo-300 dark:hover:border-indigo-700 hover:-translate-y-[1px] active:scale-95 transition-[transform,border-color,background-color] duration-200 cursor-pointer"
                >
                  <Globe className="h-3 w-3 text-indigo-600 dark:text-indigo-400" />
                  <span>{currentLang === 'vi' ? 'VI' : 'EN'}</span>
                </button>
                <ThemeToggle size="sm" showLabel />
              </div>
            </div>

            <button
              onClick={() => setHelpOpen(true)}
              className="w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-sm text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              <span className="flex items-center gap-2">
                <HelpCircle className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                {t('nav.helpShortcuts')}
              </span>
              <kbd className="hidden sm:inline-block px-1.5 py-0.5 text-[10px] font-mono bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded text-slate-500">
                Ctrl+/
              </kbd>
            </button>
          </div>

          {/* User Info & Logout */}
          <div className="p-3 border-t border-slate-200/80 dark:border-slate-800/80 space-y-1.5 bg-slate-50/60 dark:bg-slate-900/60">
            <div className="flex flex-col gap-1 px-3 py-2.5 rounded-xl bg-white dark:bg-slate-800/70 border border-slate-200/80 dark:border-slate-800 shadow-2xs">
              <div className="flex items-center gap-3">
                <Avatar className="h-9 w-9 border-2 border-indigo-200 dark:border-indigo-800">
                  {user?.avatar_url ? (
                    <AvatarImage src={user.avatar_url} alt={user?.username} />
                  ) : (
                    <AvatarFallback>
                      <User className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                    </AvatarFallback>
                  )}
                </Avatar>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
                    {user?.full_name || user?.username || 'User'}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 capitalize flex items-center gap-1.5 font-mono">
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-indigo-500" />
                    {user?.role || 'user'}
                  </p>
                </div>
                <Link
                  to="/profile"
                  onClick={() => setMobileOpen(false)}
                  className="text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline shrink-0"
                  aria-label="View profile"
                >
                  {t('nav.viewProfile')}
                </Link>
              </div>
            </div>

            {/* Logout Button */}
            <button
              onClick={handleLogout}
              disabled={loggingOut}
              title="Logout"
              className="w-full flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl text-sm font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 transition-all duration-200 disabled:opacity-50"
            >
              {loggingOut ? (
                <div className="h-4 w-4 border-2 border-red-600/30 border-t-red-600 rounded-full animate-spin" />
              ) : (
                <LogOut className="h-4 w-4" />
              )}
              {loggingOut ? t('nav.signingOut') : t('nav.signOut')}
            </button>
          </div>
        </div>
      </aside>

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
          className="relative flex-1 overflow-y-auto overflow-x-hidden px-3.5 sm:px-6 lg:px-10 pb-6 lg:pb-10 pt-[4.5rem] sm:pt-20 lg:pt-8 focus:outline-none"
        >
          <div className="max-w-6xl mx-auto w-full min-w-0">
            {children}
          </div>
        </main>

        {/* Footer */}
        <footer className="relative shrink-0 border-t border-slate-200/80 dark:border-slate-800/80 bg-white/90 dark:bg-slate-900/90 backdrop-blur-md px-3.5 sm:px-6 py-2.5 sm:py-3">
          <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-1 text-[11px] sm:text-xs text-slate-500 dark:text-slate-400 text-center sm:text-left">
            <p className="flex items-center justify-center sm:justify-start gap-2 font-medium">
              <span className="w-[20px] h-[20px] rounded-[5px] bg-white dark:bg-[#1E1C17] border border-[#E7E3D9] dark:border-[#332F26] shadow-2xs flex items-center justify-center p-0.5 shrink-0 transition-colors">
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
      </div>

      {/* Help Modal */}
      <HelpModal isOpen={helpOpen} onClose={() => setHelpOpen(false)} />

      {/* First-Time Google Account Onboarding Modal */}
      <GoogleOnboardingModal />
    </div>
  );
}
