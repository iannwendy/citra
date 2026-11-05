import type { ReactElement, ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { render, type RenderOptions } from '@testing-library/react';
import { AuthContext } from '@/contexts/AuthContext';
import { ToastProvider } from '@/contexts/ToastContext';
import { ThemeProvider } from '@/contexts/ThemeContext';
import type { PlanTier, User, UserQuota } from '@/api/client';

export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

/** Plan quotas mirroring backend `billing/plans.py` (admins use the Ultra tier). */
export const QUOTA_BY_TIER: Record<PlanTier, UserQuota> = {
  basic: {
    monthly_uploads_used: 1,
    monthly_uploads_limit: 3,
    monthly_uploads_remaining: 2,
    max_file_size_mb: 5,
    max_pages_per_pdf: 15,
    max_citations_per_essay: 30,
    max_batch_files: 1,
    allowed_export_formats: ['json'],
    allow_batch_upload: false,
    allow_deep_inspector: false,
    allow_serpapi_fallback: false,
    quota_reset_at: '2026-12-01T00:00:00Z',
  },
  pro: {
    monthly_uploads_used: 4,
    monthly_uploads_limit: 50,
    monthly_uploads_remaining: 46,
    max_file_size_mb: 25,
    max_pages_per_pdf: 100,
    max_citations_per_essay: 200,
    max_batch_files: 10,
    allowed_export_formats: ['json', 'csv', 'pdf', 'docx'],
    allow_batch_upload: true,
    allow_deep_inspector: true,
    allow_serpapi_fallback: false,
    quota_reset_at: '2026-12-01T00:00:00Z',
  },
  ultra: {
    monthly_uploads_used: 4,
    monthly_uploads_limit: 1000,
    monthly_uploads_remaining: 996,
    max_file_size_mb: 100,
    max_pages_per_pdf: 500,
    max_citations_per_essay: 2000,
    max_batch_files: 50,
    allowed_export_formats: ['json', 'csv', 'pdf', 'docx'],
    allow_batch_upload: true,
    allow_deep_inspector: true,
    allow_serpapi_fallback: true,
    quota_reset_at: '2026-12-01T00:00:00Z',
  },
};

/**
 * Build a mock authenticated user for a role + plan combination.
 * `makeUser('user', 'pro')` → paying student, `makeUser('admin')` → admin (Ultra).
 */
export function makeUser(
  role: User['role'] = 'user',
  tier?: PlanTier,
  overrides: Partial<User> = {},
): User {
  const plan: PlanTier = tier ?? (role === 'admin' ? 'ultra' : role === 'teacher' ? 'pro' : 'basic');
  return {
    id: role === 'admin' ? 1 : role === 'teacher' ? 2 : 10,
    username: role === 'admin' ? 'admin' : role === 'teacher' ? 'lecturer1' : 'student1',
    role,
    email: `${role}@test.local`,
    full_name: `Test ${role}`,
    is_active: true,
    avatar_url: null,
    last_login_at: null,
    created_at: '2026-01-01T00:00:00Z',
    institution: null,
    can_override_verdicts: role !== 'user',
    plan_tier: plan,
    billing_cycle: null,
    subscription_status: 'active',
    cancel_at_period_end: false,
    current_period_end: null,
    quota: { ...QUOTA_BY_TIER[plan] },
    ...overrides,
  };
}

interface WrapperOptions {
  /** Mock authenticated user; default = admin */
  user?: User | null;
  /** Initial route for MemoryRouter; default = '/' */
  initialRoute?: string;
  /** Override QueryClient; default = fresh client with retries disabled */
  queryClient?: QueryClient;
  /** Optional overrides for AuthContext methods (e.g. logout spy) */
  authOverrides?: Partial<{
    login: (username: string, password: string) => Promise<void>;
    loginWithGoogle: (payload: import('@/api/client').GoogleLoginPayload) => Promise<void>;
    logout: () => Promise<void>;
    refreshUser: () => Promise<void>;
  }>;
}

function makeWrapper(options: WrapperOptions = {}) {
  const {
    user = {
      id: 1,
      username: 'admin',
      role: 'admin',
      email: 'admin@test.local',
      full_name: 'Test Admin',
      is_active: true,
      avatar_url: null,
      last_login_at: null,
      created_at: '2026-01-01T00:00:00Z',
      institution: null,
      can_override_verdicts: true,
    },
    initialRoute = '/',
    queryClient = createTestQueryClient(),
    authOverrides,
  } = options;

  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <ThemeProvider defaultTheme="light">
          <ToastProvider>
            <MemoryRouter initialEntries={[initialRoute]}>
              <AuthContext.Provider
                value={{
                  user,
                  token: 'test-token',
                  isAdmin: user?.role === 'admin',
                  isLoading: false,
                  login: async () => {},
                  loginWithGoogle: async () => {},
                  logout: async () => {},
                  refreshUser: async () => {},
                  ...authOverrides,
                }}
              >
                {children}
              </AuthContext.Provider>
            </MemoryRouter>
          </ToastProvider>
        </ThemeProvider>
      </QueryClientProvider>
    );
  };
}

export function renderWithProviders(
  ui: ReactElement,
  options: WrapperOptions & RenderOptions = {},
) {
  const { user, initialRoute, queryClient, authOverrides, ...renderOpts } = options;
  const Wrapper = makeWrapper({ user, initialRoute, queryClient, authOverrides });
  return render(ui, { wrapper: Wrapper, ...renderOpts });
}

export * from '@testing-library/react';
