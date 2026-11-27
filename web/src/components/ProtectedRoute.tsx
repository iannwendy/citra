import { type ReactNode, useEffect, useRef } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { useRole, type UserCapability, type UserRole } from '../hooks/useRole';
import { WorkspaceShellSkeleton } from './PageSkeleton';

interface ProtectedRouteProps {
  children: ReactNode;
  /** @deprecated Use requiredRoles=['admin'] instead. Kept for backward compat. */
  adminOnly?: boolean;
  /** Require user role to be one of these. */
  requiredRoles?: UserRole[];
  /** Require user to have at least ONE of these capabilities. */
  requiredCapabilities?: UserCapability[];
  /** Require user to have ALL of these capabilities. */
  requiredAllCapabilities?: UserCapability[];
}

/**
 * Route guard — must be authenticated, optionally restricted by role or capability.
 *
 * - Unauthenticated requests preserve their destination via `?redirect=...` on `/login`.
 * - Authenticated users lacking the required role/capability receive a clear localized
 *   warning toast before redirecting to `/dashboard` (never a silent redirect).
 */
export function ProtectedRoute({
  children,
  adminOnly,
  requiredRoles,
  requiredCapabilities,
  requiredAllCapabilities,
}: ProtectedRouteProps) {
  const { user, isLoading } = useAuth();
  const { hasAny, hasAll, role } = useRole();
  const location = useLocation();
  const { i18n } = useTranslation();
  const { warning } = useToast();
  const lastDeniedRef = useRef<string | null>(null);

  const isUnauthorized =
    !isLoading &&
    Boolean(user) &&
    ((Boolean(adminOnly) && user?.role !== 'admin') ||
      (Boolean(requiredRoles) && !requiredRoles!.includes(role)) ||
      (Boolean(requiredCapabilities) && !hasAny(requiredCapabilities!)) ||
      (Boolean(requiredAllCapabilities) && !hasAll(requiredAllCapabilities!)));

  useEffect(() => {
    if (!isUnauthorized) {
      lastDeniedRef.current = null;
      return;
    }
    const deniedKey = `${location.pathname}${location.search}`;
    if (lastDeniedRef.current === deniedKey) return;
    lastDeniedRef.current = deniedKey;

    const isVi = i18n.language?.startsWith('vi');
    warning(
      isVi
        ? 'Bạn không có quyền truy cập trang này.'
        : 'You do not have permission to access that page.',
      undefined,
      { force: true },
    );
  }, [isUnauthorized, location.pathname, location.search, i18n.language, warning]);

  if (isLoading) {
    return <WorkspaceShellSkeleton />;
  }

  if (!user) {
    const targetPath = `${location.pathname}${location.search}`;
    const redirectQuery =
      targetPath && targetPath !== '/' && !targetPath.startsWith('/login')
        ? `?redirect=${encodeURIComponent(targetPath)}`
        : '';
    return <Navigate to={`/login${redirectQuery}`} replace />;
  }

  if (isUnauthorized) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}
