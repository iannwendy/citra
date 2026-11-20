import { Suspense, useEffect } from 'react';
import {
  createBrowserRouter,
  matchPath,
  Navigate,
  Outlet,
  type RouteObject,
  useLocation,
  useParams,
  useRouteError,
} from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ProtectedRoute } from './components/ProtectedRoute';
import {
  AuthPageSkeleton,
  EditorialPageSkeleton,
  PageSkeleton,
  WorkspaceShellSkeleton,
} from './components/PageSkeleton';
import {
  attemptChunkReload,
  clearChunkReloadState,
  installChunkErrorHandlers,
  isChunkLoadError,
  lazyWithRetry,
} from './lib/lazyWithRetry';
import { LandingPage } from './pages/LandingPage';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';

/* ============================================================
   CITRA — Router Configuration
   Academic Source Verification Workspace

   Public entry routes (/, /login, /register) render synchronously
   for zero-flash first paint, while secondary public pages and the
   authenticated workspace shell (AppLayout + subpages) lazy-load
   on demand with shell-matched skeletons.
   ============================================================ */

// Public route that redirects to dashboard if already authenticated
function PublicRoute({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  if (isLoading) {
    return <AuthPageSkeleton />;
  }
  if (user) {
    return <Navigate to="/dashboard" replace />;
  }
  return <>{children}</>;
}

// Legacy essay redirect with proper parameter handling
function LegacyEssayRedirect() {
  const { id } = useParams();
  return <Navigate to={`/verification/report/${id}`} replace />;
}

// Secondary and authenticated pages are code-split with lazyWithRetry so that the
// landing page initial bundle stays lean and transient chunk errors recover automatically.
const AppLayout = lazyWithRetry(() => import('./components/AppLayout').then((m) => ({ default: m.AppLayout })));
const ActivateAccountPage = lazyWithRetry(() => import('./pages/ActivateAccountPage').then((m) => ({ default: m.ActivateAccountPage })));
const ForgotPasswordPage = lazyWithRetry(() => import('./pages/ForgotPasswordPage').then((m) => ({ default: m.ForgotPasswordPage })));
const ResetPasswordPage = lazyWithRetry(() => import('./pages/ResetPasswordPage').then((m) => ({ default: m.ResetPasswordPage })));
const DashboardPage = lazyWithRetry(() => import('./pages/DashboardPage').then((m) => ({ default: m.DashboardPage })));
const UploadPage = lazyWithRetry(() => import('./pages/UploadPage').then((m) => ({ default: m.UploadPage })));
const SandboxPage = lazyWithRetry(() => import('./pages/SandboxPage').then((m) => ({ default: m.SandboxPage })));
const BatchUploadPage = lazyWithRetry(() => import('./pages/BatchUploadPage').then((m) => ({ default: m.BatchUploadPage })));
const ProcessingPage = lazyWithRetry(() => import('./pages/ProcessingPage').then((m) => ({ default: m.ProcessingPage })));
const EssayPage = lazyWithRetry(() => import('./pages/EssayPage').then((m) => ({ default: m.EssayPage })));
const IssuesPage = lazyWithRetry(() => import('./pages/IssuesPage').then((m) => ({ default: m.IssuesPage })));
const LogicTracePage = lazyWithRetry(() => import('./pages/LogicTracePage').then((m) => ({ default: m.LogicTracePage })));
const HistoryPage = lazyWithRetry(() => import('./pages/HistoryPage').then((m) => ({ default: m.HistoryPage })));
const ProfilePage = lazyWithRetry(() => import('./pages/ProfilePage').then((m) => ({ default: m.ProfilePage })));
const AccountManagementPage = lazyWithRetry(() => import('./pages/AccountManagementPage').then((m) => ({ default: m.AccountManagementPage })));
const PromoManagementPage = lazyWithRetry(() => import('./pages/PromoManagementPage').then((m) => ({ default: m.PromoManagementPage })));
const SettingsPage = lazyWithRetry(() => import('./pages/SettingsPage').then((m) => ({ default: m.SettingsPage })));
const MyClassesPage = lazyWithRetry(() => import('./pages/MyClassesPage').then((m) => ({ default: m.MyClassesPage })));
const ClassDetailPage = lazyWithRetry(() => import('./pages/ClassDetailPage').then((m) => ({ default: m.ClassDetailPage })));
const PendingReviewsPage = lazyWithRetry(() => import('./pages/PendingReviewsPage').then((m) => ({ default: m.PendingReviewsPage })));
const SystemHealthPage = lazyWithRetry(() => import('./pages/SystemHealthPage').then((m) => ({ default: m.SystemHealthPage })));
const AuditLogPage = lazyWithRetry(() => import('./pages/AuditLogPage').then((m) => ({ default: m.AuditLogPage })));
const PricingPage = lazyWithRetry(() => import('./pages/PricingPage').then((m) => ({ default: m.PricingPage })));
const StripeDemoCheckoutPage = lazyWithRetry(() => import('./pages/StripeDemoCheckoutPage').then((m) => ({ default: m.StripeDemoCheckoutPage })));
const BillingSuccessPage = lazyWithRetry(() => import('./pages/BillingSuccessPage').then((m) => ({ default: m.BillingSuccessPage })));
const SharedReportPage = lazyWithRetry(() => import('./pages/SharedReportPage').then((m) => ({ default: m.SharedReportPage })));
const PrivacyPolicyPage = lazyWithRetry(() => import('./pages/PrivacyPolicyPage').then((m) => ({ default: m.PrivacyPolicyPage })));
const TermsOfServicePage = lazyWithRetry(() => import('./pages/TermsOfServicePage').then((m) => ({ default: m.TermsOfServicePage })));
const NotFoundPage = lazyWithRetry(() => import('./pages/NotFoundPage').then((m) => ({ default: m.NotFoundPage })));

// Route-level ErrorBoundary that overrides React Router's raw "Unexpected Application Error!"
// screen and automatically recovers from stale dynamic import chunk errors after deployments.
export function RouteErrorBoundary() {
  const error = useRouteError();
  const { i18n } = useTranslation();
  const isVi = i18n.language?.startsWith('vi') ?? false;
  const chunkError = isChunkLoadError(error);

  useEffect(() => {
    if (chunkError) {
      attemptChunkReload();
    }
  }, [chunkError]);

  const handleHardReload = () => {
    clearChunkReloadState();
    window.location.reload();
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#FBFAF6] dark:bg-slate-950 px-4">
      <div className="max-w-md w-full text-center">
        <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
          <AlertTriangle className="w-8 h-8 text-red-600 dark:text-red-400" />
        </div>
        <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100 mb-2">
          {isVi ? 'Đã xảy ra sự cố' : 'Something went wrong'}
        </h1>
        <p className="text-slate-600 dark:text-slate-400 mb-6 text-sm">
          {chunkError
            ? isVi
              ? 'Hệ thống CITRA vừa có phiên bản mới. Vui lòng tải lại trang để cập nhật giao diện mới nhất.'
              : 'A newer version of CITRA is available. Please refresh the page to load the latest workspace.'
            : isVi
              ? 'Đã có lỗi ngoài ý muốn xảy ra. Vui lòng tải lại trang để tiếp tục.'
              : 'An unexpected error occurred. Please try refreshing the page.'}
        </p>
        <div className="flex gap-3 justify-center">
          <button
            type="button"
            onClick={handleHardReload}
            className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium transition-colors cursor-pointer"
          >
            <RefreshCw className="w-4 h-4" />
            {isVi ? 'Tải lại trang' : 'Refresh Page'}
          </button>
          <a
            href="/"
            className="inline-flex items-center gap-2 px-4 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-lg font-medium transition-colors"
          >
            {isVi ? 'Về trang chủ' : 'Go Home'}
          </a>
        </div>
      </div>
    </div>
  );
}

// Hybrid route: renders inside AppLayout when authenticated, or standalone Solva editorial page when visited publicly
function HybridPricingRoute() {
  const { user, isLoading } = useAuth();
  if (isLoading) {
    return <EditorialPageSkeleton />;
  }
  if (user) {
    return (
      <Suspense fallback={<WorkspaceShellSkeleton />}>
        <AppLayout>
          <Suspense fallback={<PageSkeleton />}>
            <PricingPage />
          </Suspense>
        </AppLayout>
      </Suspense>
    );
  }
  return (
    <Suspense fallback={<EditorialPageSkeleton />}>
      <PricingPage />
    </Suspense>
  );
}

// Wrap any workspace child component in a Suspense boundary using PageSkeleton as fallback
function withSuspense(LazyComponent: React.ComponentType) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <LazyComponent />
    </Suspense>
  );
}

function withAuthSuspense(LazyComponent: React.ComponentType) {
  return (
    <Suspense fallback={<AuthPageSkeleton />}>
      <LazyComponent />
    </Suspense>
  );
}

function withEditorialSuspense(LazyComponent: React.ComponentType) {
  return (
    <Suspense fallback={<EditorialPageSkeleton />}>
      <LazyComponent />
    </Suspense>
  );
}

const PAGE_TITLE_ROUTES: Array<{ pattern: string; title: string }> = [
  { pattern: '/', title: 'Home' },
  { pattern: '/login', title: 'Login' },
  { pattern: '/register', title: 'Register' },
  { pattern: '/forgot-password', title: 'Forgot Password' },
  { pattern: '/activate-account', title: 'Activate Account' },
  { pattern: '/reset-password', title: 'Reset Password' },
  { pattern: '/dashboard', title: 'Dashboard' },
  { pattern: '/upload', title: 'New Check' },
  { pattern: '/sandbox', title: 'Live Sandbox' },
  { pattern: '/batch-upload', title: 'Batch Check' },
  { pattern: '/verification/processing', title: 'Processing' },
  { pattern: '/verification/processing/:id', title: 'Processing' },
  { pattern: '/verification/report/:id', title: 'Verification Report' },
  { pattern: '/verification/report/:id/issues', title: 'Issues' },
  { pattern: '/verification/report/:id/trace', title: 'Logic Trace' },
  { pattern: '/verification/report/:id/document', title: 'Document Inspector' },
  { pattern: '/verification/report/:id/consistency', title: 'Consistency' },
  { pattern: '/history', title: 'History' },
  { pattern: '/profile', title: 'Profile' },
  { pattern: '/admin/users', title: 'Accounts' },
  { pattern: '/admin/promos', title: 'Promo Codes' },
  { pattern: '/admin/system', title: 'System Health' },
  { pattern: '/admin/audit', title: 'Audit Log' },
  { pattern: '/settings', title: 'Settings' },
  { pattern: '/pricing', title: 'Pricing & Plans' },
  { pattern: '/privacy', title: 'Privacy Policy' },
  { pattern: '/terms', title: 'Terms of Service' },
  { pattern: '/billing/checkout', title: 'Stripe Checkout' },
  { pattern: '/billing/success', title: 'Payment Confirmed' },
  { pattern: '/teacher/classes', title: 'My Classes' },
  { pattern: '/teacher/classes/:classId', title: 'Class Detail' },
  { pattern: '/teacher/reviews', title: 'Pending Reviews' },
  { pattern: '/verify/share/:token', title: 'Digital Verification Receipt' },
];

export function getDocumentTitle(pathname: string): string {
  for (const route of PAGE_TITLE_ROUTES) {
    if (matchPath({ path: route.pattern, end: true }, pathname)) {
      return `CITRA - ${route.title}`;
    }
  }
  return 'CITRA - Page Not Found';
}

function syncRobotsMeta(pathname: string): void {
  if (typeof document === 'undefined') return;
  const isPublicIndexable = pathname === '/';
  const content = isPublicIndexable ? 'index, follow' : 'noindex, nofollow';
  let meta = document.querySelector<HTMLMetaElement>('meta[name="robots"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = 'robots';
    document.head.appendChild(meta);
  }
  meta.content = content;

  let canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!canonical) {
    canonical = document.createElement('link');
    canonical.rel = 'canonical';
    document.head.appendChild(canonical);
  }
  const normalizedPath = pathname === '/' ? '/' : pathname.replace(/\/+$/, '');
  canonical.href = `https://citra.io.vn${normalizedPath}`;
}

function RootLayout() {
  const { pathname } = useLocation();

  useEffect(() => {
    document.title = getDocumentTitle(pathname);
    syncRobotsMeta(pathname);
  }, [pathname]);

  return <Outlet />;
}

export const appRoutes: RouteObject[] = [
  {
    element: <RootLayout />,
    errorElement: <RouteErrorBoundary />,
    children: [
      // Public routes (eager — small, needed for first paint)
      {
        path: '/',
        element: <LandingPage />,
      },
      {
        path: '/login',
        element: (
          <PublicRoute>
            <LoginPage />
          </PublicRoute>
        ),
      },
      {
        path: '/register',
        element: (
          <PublicRoute>
            <RegisterPage />
          </PublicRoute>
        ),
      },
      {
        path: '/forgot-password',
        element: (
          <PublicRoute>
            {withAuthSuspense(ForgotPasswordPage)}
          </PublicRoute>
        ),
      },
      {
        path: '/activate-account',
        element: withAuthSuspense(ActivateAccountPage),
      },
      {
        path: '/reset-password',
        element: withAuthSuspense(ResetPasswordPage),
      },
      {
        path: '/pricing',
        element: <HybridPricingRoute />,
      },
      {
        path: '/privacy',
        element: withEditorialSuspense(PrivacyPolicyPage),
      },
      {
        path: '/terms',
        element: withEditorialSuspense(TermsOfServicePage),
      },
      {
        path: '/verify/share/:token',
        element: withEditorialSuspense(SharedReportPage),
      },

      // Protected routes with AppLayout (sidebar navigation)
      {
        element: (
          <ProtectedRoute>
            <Suspense fallback={<WorkspaceShellSkeleton />}>
              <AppLayout>
                <Outlet />
              </AppLayout>
            </Suspense>
          </ProtectedRoute>
        ),
        errorElement: <RouteErrorBoundary />,
        children: [
          { path: '/dashboard', element: withSuspense(DashboardPage) },
          { path: '/upload', element: withSuspense(UploadPage) },
          { path: '/sandbox', element: withSuspense(SandboxPage) },
          {
            path: '/batch-upload',
            element: (
              <ProtectedRoute requiredCapabilities={['batch_upload']}>
                <Suspense fallback={<PageSkeleton />}>
                  <BatchUploadPage />
                </Suspense>
              </ProtectedRoute>
            ),
          },
          { path: '/verification/processing', element: withSuspense(ProcessingPage) },
          { path: '/verification/processing/:id', element: withSuspense(ProcessingPage) },
          { path: '/verification/report/:id', element: withSuspense(EssayPage) },
          { path: '/verification/report/:id/issues', element: withSuspense(IssuesPage) },
          {
            path: '/verification/report/:id/trace',
            element: (
              <ProtectedRoute requiredCapabilities={['view_logic_trace']}>
                <Suspense fallback={<PageSkeleton />}>
                  <LogicTracePage />
                </Suspense>
              </ProtectedRoute>
            ),
          },
          {
            path: '/verification/report/:id/document',
            element: (
              <ProtectedRoute requiredCapabilities={['view_document_inspector']}>
                <Suspense fallback={<PageSkeleton />}>
                  <EssayPage />
                </Suspense>
              </ProtectedRoute>
            ),
          },
          {
            path: '/verification/report/:id/consistency',
            element: (
              <ProtectedRoute requiredCapabilities={['view_orphan_detection']}>
                <Suspense fallback={<PageSkeleton />}>
                  <EssayPage />
                </Suspense>
              </ProtectedRoute>
            ),
          },
          { path: '/essay/:id', element: <LegacyEssayRedirect /> },
          { path: '/history', element: withSuspense(HistoryPage) },
          { path: '/profile', element: withSuspense(ProfilePage) },
          {
            path: '/admin/users',
            element: (
              <ProtectedRoute requiredCapabilities={['manage_users']}>
                <Suspense fallback={<PageSkeleton />}>
                  <AccountManagementPage />
                </Suspense>
              </ProtectedRoute>
            ),
          },
          {
            path: '/admin/promos',
            element: (
              <ProtectedRoute requiredCapabilities={['manage_users']}>
                <Suspense fallback={<PageSkeleton />}>
                  <PromoManagementPage />
                </Suspense>
              </ProtectedRoute>
            ),
          },
          {
            path: '/admin/system',
            element: (
              <ProtectedRoute requiredCapabilities={['view_system_health']}>
                <Suspense fallback={<PageSkeleton />}>
                  <SystemHealthPage />
                </Suspense>
              </ProtectedRoute>
            ),
          },
          {
            path: '/admin/audit',
            element: (
              <ProtectedRoute requiredCapabilities={['view_audit_log']}>
                <Suspense fallback={<PageSkeleton />}>
                  <AuditLogPage />
                </Suspense>
              </ProtectedRoute>
            ),
          },
          { path: '/settings', element: withSuspense(SettingsPage) },
          { path: '/billing/checkout', element: withSuspense(StripeDemoCheckoutPage) },
          { path: '/billing/success', element: withSuspense(BillingSuccessPage) },
          // Teacher (v1.15 / Phase 3) — gated by teacher/admin role + view_class_history capability
          {
            path: '/teacher/classes',
            element: (
              <ProtectedRoute
                requiredRoles={['teacher', 'admin']}
                requiredCapabilities={['view_class_history']}
              >
                <Suspense fallback={<PageSkeleton />}>
                  <MyClassesPage />
                </Suspense>
              </ProtectedRoute>
            ),
          },
          {
            path: '/teacher/classes/:classId',
            element: (
              <ProtectedRoute
                requiredRoles={['teacher', 'admin']}
                requiredCapabilities={['view_class_history']}
              >
                <Suspense fallback={<PageSkeleton />}>
                  <ClassDetailPage />
                </Suspense>
              </ProtectedRoute>
            ),
          },
          {
            path: '/teacher/reviews',
            element: (
              <ProtectedRoute
                requiredRoles={['teacher', 'admin']}
                requiredCapabilities={['override_verdict']}
              >
                <Suspense fallback={<PageSkeleton />}>
                  <PendingReviewsPage />
                </Suspense>
              </ProtectedRoute>
            ),
          },
          // Legacy route redirects
          { path: '/home', element: <Navigate to="/dashboard" replace /> },
          { path: '/sanbox', element: <Navigate to="/sandbox" replace /> },
        ],
      },

      // Catch-all 404 page
      {
        path: '*',
        element: withEditorialSuspense(NotFoundPage),
      },
    ],
  },
];

export const router = createBrowserRouter(appRoutes, {
  future: {
    v7_relativeSplatPath: true,
    v7_fetcherPersist: true,
    v7_normalizeFormMethod: true,
    v7_partialHydration: true,
    v7_skipActionErrorRevalidation: true,
  },
});

if (typeof document !== 'undefined' && typeof window !== 'undefined') {
  installChunkErrorHandlers();
  document.title = getDocumentTitle(window.location.pathname);
  router.subscribe((state) => {
    document.title = getDocumentTitle(state.location.pathname);
  });
}

/* ============================================================
   Router Export with AuthProvider
   Wrap router with AuthProvider for authentication context
   ============================================================ */
export { AuthProvider };
