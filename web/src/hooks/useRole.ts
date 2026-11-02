/**
 * useRole() — capability-based role abstraction (v1.15 / Phase 3).
 *
 * Replaces scattered `user?.role === 'admin'` checks across the codebase.
 * Components should query capabilities, not roles — easier to evolve
 * when we add a 4th role later.
 *
 * Capabilities are derived from role via ROLE_CAPABILITIES table.
 * Keep this list in sync with backend ROLES_PLAN.md §C.1.
 */
import { useAuth } from '@/contexts/AuthContext';
import type { PlanTier, UserQuota } from '@/api/client';

export type UserRole = 'user' | 'teacher' | 'admin';

export type UserCapability =
  // student
  | 'upload_essay'
  | 'view_own_history'
  // teacher + admin
  | 'view_class_history'
  | 'override_verdict'
  | 'view_logic_trace'
  | 'view_document_inspector'
  | 'view_orphan_detection'
  | 'create_class'
  // admin only
  | 'manage_users'
  | 'system_settings'
  | 'view_audit_log'
  | 'view_system_health';

const ROLE_CAPABILITIES: Record<UserRole, UserCapability[]> = {
  user: ['upload_essay', 'view_own_history'],
  teacher: [
    'upload_essay',
    'view_own_history',
    'view_class_history',
    'override_verdict',
    'view_logic_trace',
    'view_document_inspector',
    'view_orphan_detection',
    'create_class',
  ],
  admin: [
    'upload_essay',
    'view_own_history',
    'view_class_history',
    'override_verdict',
    'view_logic_trace',
    'view_document_inspector',
    'view_orphan_detection',
    'create_class',
    'manage_users',
    'system_settings',
    'view_audit_log',
    'view_system_health',
  ],
};

export interface UseRoleResult {
  role: UserRole;
  isUser: boolean;
  isTeacher: boolean;
  isAdmin: boolean;
  planTier: PlanTier;
  isBasic: boolean;
  isPro: boolean;
  isUltra: boolean;
  isPaid: boolean;
  quota: UserQuota;
  /**
   * Batch upload entitlement: plan quota `allow_batch_upload` (Pro/Ultra) or
   * teacher/admin role. Single source of truth for every Batch Check entry point.
   */
  canBatchUpload: boolean;
  capabilities: ReadonlyArray<UserCapability>;
  has: (cap: UserCapability) => boolean;
  hasAny: (caps: UserCapability[]) => boolean;
  hasAll: (caps: UserCapability[]) => boolean;
}

const DEFAULT_QUOTA_BY_TIER: Record<PlanTier, UserQuota> = {
  basic: {
    monthly_uploads_used: 0,
    monthly_uploads_limit: 3,
    monthly_uploads_remaining: 3,
    max_file_size_mb: 5,
    max_pages_per_pdf: 15,
    max_citations_per_essay: 30,
    max_batch_files: 1,
    allowed_export_formats: ['json'],
    allow_batch_upload: false,
    allow_deep_inspector: false,
    allow_serpapi_fallback: false,
    quota_reset_at: '',
  },
  pro: {
    monthly_uploads_used: 0,
    monthly_uploads_limit: 50,
    monthly_uploads_remaining: 50,
    max_file_size_mb: 25,
    max_pages_per_pdf: 100,
    max_citations_per_essay: 200,
    max_batch_files: 10,
    allowed_export_formats: ['json', 'csv', 'pdf', 'docx'],
    allow_batch_upload: true,
    allow_deep_inspector: true,
    allow_serpapi_fallback: false,
    quota_reset_at: '',
  },
  ultra: {
    monthly_uploads_used: 0,
    monthly_uploads_limit: 1000,
    monthly_uploads_remaining: 1000,
    max_file_size_mb: 100,
    max_pages_per_pdf: 500,
    max_citations_per_essay: 2000,
    max_batch_files: 50,
    allowed_export_formats: ['json', 'csv', 'pdf', 'docx'],
    allow_batch_upload: true,
    allow_deep_inspector: true,
    allow_serpapi_fallback: true,
    quota_reset_at: '',
  },
};

export function useRole(): UseRoleResult {
  const { user } = useAuth();
  // Default to 'user' (least privilege) when unauthenticated so accidental
  // capability checks don't accidentally grant anything.
  const role: UserRole = (user?.role as UserRole) ?? 'user';
  const defaultTier: PlanTier =
    role === 'admin' ? 'ultra' : role === 'teacher' ? 'pro' : 'basic';
  const planTier: PlanTier =
    role === 'admin' ? 'ultra' : ((user?.plan_tier as PlanTier) ?? defaultTier);

  const isBasic = planTier === 'basic';
  const isPro = planTier === 'pro';
  const isUltra = planTier === 'ultra';
  const isPaid = isPro || isUltra;

  const baseCapabilities = [...(ROLE_CAPABILITIES[role] ?? [])];
  if (isPaid && role === 'user') {
    for (const paidCap of [
      'view_logic_trace',
      'view_document_inspector',
      'view_orphan_detection',
      'view_class_history',
    ] as UserCapability[]) {
      if (!baseCapabilities.includes(paidCap)) {
        baseCapabilities.push(paidCap);
      }
    }
  }

  const capabilities =
    user?.can_override_verdicts === false
      ? baseCapabilities.filter((c) => c !== 'override_verdict')
      : baseCapabilities;

  const quota: UserQuota = user?.quota ?? DEFAULT_QUOTA_BY_TIER[planTier];

  return {
    role,
    isUser: role === 'user',
    isTeacher: role === 'teacher',
    isAdmin: role === 'admin',
    planTier,
    isBasic,
    isPro,
    isUltra,
    isPaid,
    quota,
    canBatchUpload: role === 'teacher' || role === 'admin' || quota.allow_batch_upload === true,
    capabilities,
    has: (cap) => capabilities.includes(cap),
    hasAny: (caps) => caps.some((c) => capabilities.includes(c)),
    hasAll: (caps) => caps.every((c) => capabilities.includes(c)),
  };
}
