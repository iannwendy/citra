import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useRole, type UserCapability, type UserRole } from '../hooks/useRole';
import { WorkspaceShellSkeleton } from './PageSkeleton';
import { ReactNode } from 'react';

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
 * Backward compat: ``adminOnly={true}`` still works exactly as before.
 * New code should prefer ``requiredRoles`` or ``requiredCapabilities``.
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

  if (isLoading) {
    return <WorkspaceShellSkeleton />;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (adminOnly && user.role !== 'admin') {
    return <Navigate to="/dashboard" replace />;
  }
  if (requiredRoles && !requiredRoles.includes(role)) {
    return <Navigate to="/dashboard" replace />;
  }
  if (requiredCapabilities && !hasAny(requiredCapabilities)) {
    return <Navigate to="/dashboard" replace />;
  }
  if (requiredAllCapabilities && !hasAll(requiredAllCapabilities)) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}
