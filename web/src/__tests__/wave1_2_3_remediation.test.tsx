import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, renderHook, act } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import i18n from '@/i18n';
import { api } from '@/api/client';
import type {
  AnalysisReport,
  Class,
  ClassAnalytics,
  PendingVerdict,
  User,
  Verdict,
} from '@/api/client';
import { AuthContext, AuthProvider, useAuth } from '@/contexts/AuthContext';
import { ToastProvider } from '@/contexts/ToastContext';
import { VerificationProgressProvider, useVerificationProgress } from '@/contexts/VerificationProgressContext';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { useRole } from '@/hooks/useRole';
import { UserFormDialog } from '@/components/UserFormDialog';
import { UpgradeModal } from '@/components/UpgradeModal';
import { CreateClassDialog } from '@/components/CreateClassDialog';
import { BibliographyRemediationModal } from '@/components/BibliographyRemediationModal';
import { OverrideControls } from '@/components/OverrideControls';
import { SolvaFilmSection } from '@/components/landing/CitraFilm';
import { LiveCitationSandbox } from '@/components/LiveCitationSandbox';
import { PendingReviewsPage } from '@/pages/PendingReviewsPage';
import { ClassDetailPage } from '@/pages/ClassDetailPage';
import { MyClassesPage } from '@/pages/MyClassesPage';
import { EssayPage } from '@/pages/EssayPage';
import { IssuesPage } from '@/pages/IssuesPage';
import { DocumentInspectorPage } from '@/pages/DocumentInspectorPage';
import { OrphanDetectionPage } from '@/pages/OrphanDetectionPage';
import { LogicTracePage } from '@/pages/LogicTracePage';
import { ProfilePage } from '@/pages/ProfilePage';
import { StripeDemoCheckoutPage } from '@/pages/StripeDemoCheckoutPage';

const WEB_ROOT = path.resolve(__dirname, '../..');

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 42,
    username: 'researcher_linh',
    email: 'linh@tdtu.edu.vn',
    full_name: 'Nguyen Linh',
    institution: 'TDTU',
    avatar_url: null,
    last_login_at: '2026-11-15T10:00:00Z',
    created_at: '2026-10-01T00:00:00Z',
    role: 'user',
    plan_tier: 'pro',
    is_active: true,
    can_override_verdicts: false,
    auth_provider: 'local',
    google_linked: false,
    has_password: true,
    quota: {
      monthly_uploads_used: 3,
      monthly_uploads_limit: 200,
      monthly_uploads_remaining: 197,
      max_file_size_mb: 50,
      max_pages_per_pdf: 150,
      max_citations_per_essay: 250,
      max_batch_files: 20,
      allow_batch_upload: true,
      allow_deep_inspector: true,
      allow_serpapi_fallback: false,
      allowed_export_formats: ['json', 'csv', 'pdf', 'docx'],
      quota_reset_at: '2026-12-01T00:00:00Z',
    },
    ...overrides,
  };
}

function makeSampleReport(overrides: Partial<AnalysisReport> = {}): AnalysisReport {
  const verdict: Verdict = {
    citation_id: 'cit-0001',
    citation_raw: '(Phantom & Ghost, 2023)',
    citation_type: 'in_text',
    context: 'Recent findings claim zero-error alignment (Phantom & Ghost, 2023).',
    mapping_status: 'matched',
    mapping_confidence: 0.96,
    citation_link: {
      occurrence_id: 'cit-0001',
      reference_id: 'ref-0001',
      method: 'author_year',
      confidence: 0.96,
    },
    label: 'suspected_hallucination',
    confidence: 0.92,
    reasoning: 'No academic database record matches the claimed title and DOI.',
    triggered_rules: ['R05'],
    mismatched_fields: ['title', 'authors'],
    is_overridden: false,
    matched_sources: [
      {
        source: 'crossref',
        matched_fields: ['year'],
        checked_at: '2026-11-16T08:00:00Z',
        confidence: 0.28,
        url: 'https://doi.org/10.1000/unrelated',
        title: 'Loosely Related Paper With Different Authors',
        authors: ['Someone Else'],
        year: '2023',
      },
    ],
  };

  return {
    essay_id: 77,
    filename: 'capstone_thesis.docx',
    num_pages: 4,
    num_citations: 1,
    num_references: 1,
    style_profile: {
      style: 'APA_LIKE',
      confidence: 0.95,
      apa_count: 1,
      ieee_count: 0,
      mixed_count: 0,
      features: {},
      ratios: {},
      explanation: 'APA style detected.',
    },
    linking_summary: {
      matched: 1,
      missing_reference: 0,
      uncited_reference: 0,
      in_text_mismatch: 0,
      duplicate_reference: 0,
      ambiguous_mapping: 0,
      style_inconsistent: 0,
      unresolved: 0,
    },
    extracted_citations: [
      {
        id: 101,
        reference_id: 'cit-0001',
        raw_text: '(Phantom & Ghost, 2023)',
        citation_type: 'in_text',
        style: 'APA_LIKE',
        authors: ['Phantom', 'Ghost'],
        year: '2023',
        page_num: 1,
        confidence: 0.95,
        context: 'Recent findings claim zero-error alignment (Phantom & Ghost, 2023).',
      },
    ],
    references: [
      {
        id: 201,
        reference_id: 'ref-0001',
        raw_text:
          'Phantom, A., & Ghost, B. (2023). Synthetic citations in academia. Fake Journal, 12(1), 1-9.',
        citation_type: 'reference_list',
        style: 'APA_LIKE',
        title: 'Synthetic citations in academia',
        authors: ['Phantom, A.', 'Ghost, B.'],
        year: '2023',
        doi: '10.9999/fake.2023.001',
        venue: 'Fake Journal',
        page_num: 4,
        confidence: 0.98,
        cited_in_text_count: 1,
      },
    ],
    verdicts: [verdict],
    cis: {
      score: 0.15,
      components: {},
      weights_used: {},
      num_citations: 1,
      num_unresolved: 0,
      disclaimer: 'Decision-support indicator only.',
    },
    disclaimer: 'Decision-support indicator only.',
    ...overrides,
  };
}

function renderWithProviders(
  ui: React.ReactElement,
  options: {
    user?: User | null;
    route?: string;
    queryClient?: QueryClient;
  } = {},
) {
  const user = options.user === undefined ? makeUser() : options.user;
  const queryClient =
    options.queryClient ??
    new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

  return render(
    <QueryClientProvider client={queryClient}>
      <AuthContext.Provider
        value={{
          user,
          token: user ? 'test-jwt-token' : null,
          isAdmin: user?.role === 'admin',
          isLoading: false,
          login: vi.fn(),
          loginWithGoogle: vi.fn(),
          logout: vi.fn(),
          refreshUser: vi.fn().mockResolvedValue(undefined),
        }}
      >
        <ToastProvider>
          <VerificationProgressProvider>
            <MemoryRouter initialEntries={[options.route ?? '/']}>{ui}</MemoryRouter>
          </VerificationProgressProvider>
        </ToastProvider>
      </AuthContext.Provider>
    </QueryClientProvider>,
  );
}

describe('Track 5 Remediation Suite (Wave 1, 2 & 3)', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    await i18n.changeLanguage('en');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('1. Nginx SSE Buffering, Body Size & Auth Rate-Limit Hardening', () => {
    it('configures unbuffered SSE proxy and 105M body limit in web/nginx.conf', () => {
      const nginxConf = fs.readFileSync(path.join(WEB_ROOT, 'nginx.conf'), 'utf8');
      expect(nginxConf).toMatch(/client_max_body_size\s+105M;/);
      expect(nginxConf).toMatch(/location\s+~\s+\^\/api\/essays\/\[0-9\]\+\/events\$/);
      expect(nginxConf).toMatch(/proxy_buffering\s+off;/);
    });

    it('configures 105M body limit and reset-password|activate auth rate-limiting in web/nginx.prod.conf', () => {
      const nginxProdConf = fs.readFileSync(path.join(WEB_ROOT, 'nginx.prod.conf'), 'utf8');
      const bodyLimitMatches = nginxProdConf.match(/client_max_body_size\s+105M;/g) ?? [];
      expect(bodyLimitMatches.length).toBeGreaterThanOrEqual(2);
      expect(nginxProdConf).toMatch(
        /location\s+~\s+\^\/api\/auth\/\(.*reset-password.*activate.*\)\$/,
      );
    });
  });

  describe('2. Role Capabilities & Route Guards (useRole.ts & router.tsx)', () => {
    it('does NOT grant view_class_history to paid role="user" while still permitting batch_upload', () => {
      const proStudent = makeUser({ role: 'user', plan_tier: 'pro' });
      const ultraStudent = makeUser({ role: 'user', plan_tier: 'ultra' });
      const teacher = makeUser({ role: 'teacher', plan_tier: 'pro' });

      const wrapperFor = (u: User) =>
        function Wrapper({ children }: { children: React.ReactNode }) {
          return (
            <AuthContext.Provider
              value={{
                user: u,
                token: 'tok',
                isAdmin: u.role === 'admin',
                isLoading: false,
                login: vi.fn(),
                loginWithGoogle: vi.fn(),
                logout: vi.fn(),
                refreshUser: vi.fn(),
              }}
            >
              {children}
            </AuthContext.Provider>
          );
        };

      const { result: proRes } = renderHook(() => useRole(), { wrapper: wrapperFor(proStudent) });
      expect(proRes.current.has('view_class_history')).toBe(false);
      expect(proRes.current.canBatchUpload).toBe(true);
      expect((proRes.current.has as (cap: string) => boolean)('batch_upload')).toBe(true);

      const { result: ultraRes } = renderHook(() => useRole(), {
        wrapper: wrapperFor(ultraStudent),
      });
      expect(ultraRes.current.has('view_class_history')).toBe(false);
      expect((ultraRes.current.has as (cap: string) => boolean)('batch_upload')).toBe(true);

      const { result: teacherRes } = renderHook(() => useRole(), { wrapper: wrapperFor(teacher) });
      expect(teacherRes.current.has('view_class_history')).toBe(true);
      expect((teacherRes.current.has as (cap: string) => boolean)('batch_upload')).toBe(true);
    });

    it('blocks paid role="user" from /teacher/classes via ProtectedRoute while allowing /batch-upload', () => {
      const proStudent = makeUser({ role: 'user', plan_tier: 'pro' });

      const { unmount } = renderWithProviders(
        <Routes>
          <Route path="/dashboard" element={<div data-testid="dashboard-fallback">Dashboard</div>} />
          <Route
            path="/teacher/classes"
            element={
              <ProtectedRoute
                requiredRoles={['teacher', 'admin']}
                requiredCapabilities={['view_class_history']}
              >
                <div data-testid="teacher-classes-secret">Classes</div>
              </ProtectedRoute>
            }
          />
        </Routes>,
        { user: proStudent, route: '/teacher/classes' },
      );

      expect(screen.queryByTestId('teacher-classes-secret')).toBeNull();
      expect(screen.getByTestId('dashboard-fallback')).toBeTruthy();
      unmount();

      // Verify router.tsx enforces requiredRoles={['teacher', 'admin']} on /teacher/classes and batch_upload on /batch-upload
      const routerSource = fs.readFileSync(path.join(WEB_ROOT, 'src/router.tsx'), 'utf8');
      expect(routerSource).toMatch(/batch_upload/);
      expect(routerSource).toMatch(
        /path:\s*'\/teacher\/classes'[\s\S]{0,250}requiredRoles=\{\['teacher',\s*'admin'\]\}/,
      );
    });
  });

  describe('3. AuthContext Memoization & Global 401 Session Expiry Event', () => {
    it('maintains stable refreshUser & logout identities across user refreshes in AuthProvider', async () => {
      localStorage.setItem('token', 'valid-token');
      let callCount = 0;
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
        callCount += 1;
        return new Response(
          JSON.stringify(
            makeUser({
              full_name: `Name v${callCount}`,
            }),
          ),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      });

      const seenRefreshFns: Array<() => Promise<void>> = [];
      function Probe() {
        const { user, refreshUser } = useAuth();
        seenRefreshFns.push(refreshUser);
        return (
          <button type="button" onClick={() => void refreshUser()} data-testid="trigger-refresh">
            {user?.full_name ?? 'loading'}
          </button>
        );
      }

      const qc = new QueryClient();
      render(
        <QueryClientProvider client={qc}>
          <AuthProvider>
            <Probe />
          </AuthProvider>
        </QueryClientProvider>,
      );

      await waitFor(() => {
        expect(screen.getByTestId('trigger-refresh').textContent).toBe('Name v1');
      });

      await act(async () => {
        fireEvent.click(screen.getByTestId('trigger-refresh'));
      });

      await waitFor(() => {
        expect(screen.getByTestId('trigger-refresh').textContent).toBe('Name v2');
      });

      expect(seenRefreshFns.length).toBeGreaterThanOrEqual(2);
      const firstFn = seenRefreshFns[0];
      for (const fn of seenRefreshFns) {
        expect(Object.is(fn, firstFn)).toBe(true);
      }
      fetchSpy.mockRestore();
    });

    it('emits citra:unauthorized on 401 from protected endpoints (not /auth/login) and clears AuthProvider session', async () => {
      localStorage.setItem('token', 'expired-jwt');
      const unauthorizedEvents: Event[] = [];
      const handler = (ev: Event) => unauthorizedEvents.push(ev);
      window.addEventListener('citra:unauthorized', handler);

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
        const url = String(input);
        if (url.includes('/api/auth/me')) {
          return new Response(JSON.stringify(makeUser()), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        if (url.includes('/api/auth/login')) {
          return new Response(JSON.stringify({ detail: 'Bad credentials' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response(JSON.stringify({ detail: 'Token expired' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      });

      function SessionIndicator() {
        const { user } = useAuth();
        return <div data-testid="session-state">{user ? user.username : 'anonymous'}</div>;
      }

      const qc = new QueryClient();
      try {
        render(
          <QueryClientProvider client={qc}>
            <AuthProvider>
              <SessionIndicator />
            </AuthProvider>
          </QueryClientProvider>,
        );

        await waitFor(() => {
          expect(screen.getByTestId('session-state').textContent).toBe('researcher_linh');
        });

        // 401 on /auth/google MUST NOT emit citra:unauthorized or log out existing session
        await expect(api.googleLogin({ credential: 'bad-id-token' })).rejects.toThrow();
        expect(unauthorizedEvents).toHaveLength(0);

        // 401 on protected endpoint MUST emit citra:unauthorized and clear AuthContext
        await act(async () => {
          await expect(api.listEssays()).rejects.toThrow(/401/);
        });

        expect(unauthorizedEvents.length).toBeGreaterThanOrEqual(1);
        expect(localStorage.getItem('token')).toBeNull();
        await waitFor(() => {
          expect(screen.getByTestId('session-state').textContent).toBe('anonymous');
        });
      } finally {
        window.removeEventListener('citra:unauthorized', handler);
        fetchSpy.mockRestore();
      }
    });
  });

  describe('4. UserFormDialog plan_tier & Edit Password Reset + Tier-Aware UpgradeModal', () => {
    it('exposes plan_tier selector and optional password reset in UserFormDialog edit mode', async () => {
      const updateSpy = vi.spyOn(api, 'updateUser').mockResolvedValue(
        makeUser({ id: 99, plan_tier: 'ultra' }),
      );
      const targetUser = makeUser({ id: 99, username: 'target_u', plan_tier: 'basic' });

      renderWithProviders(
        <UserFormDialog
          open={true}
          onOpenChange={vi.fn()}
          onSuccess={vi.fn()}
          user={targetUser}
        />,
        { user: makeUser({ role: 'admin', plan_tier: 'ultra' }) },
      );

      const planSelect = screen.getByTestId('user-form-plan-tier') as HTMLSelectElement;
      expect(planSelect.value).toBe('basic');
      fireEvent.change(planSelect, { target: { value: 'ultra' } });

      const passwordInput = screen.getByTestId('user-form-password') as HTMLInputElement;
      fireEvent.change(passwordInput, { target: { value: 'NewResetPass123' } });

      const form = planSelect.closest('form')!;
      fireEvent.submit(form);

      await waitFor(() => {
        expect(updateSpy).toHaveBeenCalledWith(
          99,
          expect.objectContaining({
            plan_tier: 'ultra',
            password: 'NewResetPass123',
          }),
        );
      });
    });

    it('renders Pro as Current Plan and highlights Ultra when UpgradeModal opens for a Pro user', () => {
      const proUser = makeUser({ role: 'teacher', plan_tier: 'pro' });
      renderWithProviders(
        <UpgradeModal open={true} onOpenChange={vi.fn()} featureName="Classroom Cohorts" />,
        { user: proUser },
      );

      const proBtn = screen.getByTestId('modal-upgrade-pro-btn') as HTMLButtonElement;
      const ultraBtn = screen.getByTestId('modal-upgrade-ultra-btn') as HTMLButtonElement;
      expect(proBtn.disabled).toBe(true);
      expect(ultraBtn.disabled).toBe(false);
    });
  });

  describe('5. PendingReviewsPage "All Classes" Default & Classroom CRUD / ZIP / Leave / Limit Paywall', () => {
    it('defaults PendingReviewsPage to "All Classes" so pending verdicts in Class #2 appear immediately', async () => {
      const classes: Class[] = [
        {
          id: 1,
          name: 'Empty Cohort 1',
          description: null,
          teacher_id: 10,
          teacher_username: 'prof_tran',
          student_count: 5,
          essay_count: 2,
          created_at: '2026-10-01T00:00:00Z',
          join_code: 'CLS001',
        },
        {
          id: 2,
          name: 'Active Cohort 2',
          description: null,
          teacher_id: 10,
          teacher_username: 'prof_tran',
          student_count: 8,
          essay_count: 4,
          created_at: '2026-10-02T00:00:00Z',
          join_code: 'CLS002',
        },
      ];
      const pendingInClass2: PendingVerdict[] = [
        {
          verdict_id: 901,
          essay_id: 55,
          filename: 'cohort2_paper.pdf',
          student_username: 'sv_minh',
          citation_raw: '(Nguyen, 2024)',
          label: 'suspected_hallucination',
          confidence: 0.91,
          reasoning: 'Unmatched DOI in Cohort 2.',
          triggered_rules: ['R05'],
          validated_at: '2026-11-15T12:00:00Z',
        },
      ];

      vi.spyOn(api, 'listMyClasses').mockResolvedValue(classes);
      vi.spyOn(api, 'listPendingReviews').mockImplementation(async (cid: number) =>
        cid === 2 ? pendingInClass2 : [],
      );

      renderWithProviders(<PendingReviewsPage />, {
        user: makeUser({ role: 'teacher', plan_tier: 'pro', can_override_verdicts: true }),
      });

      await waitFor(() => {
        expect(screen.getByTestId('pending-filter-all-classes')).toBeTruthy();
        expect(screen.getByText('cohort2_paper.pdf')).toBeTruthy();
      });
    });

    it('wires Rename Class, Delete Class, and Download Class ZIP on ClassDetailPage and Leave Class on MyClassesPage', async () => {
      const cls: Class = {
        id: 12,
        name: 'Original Class Name',
        description: 'Initial cohort',
        teacher_id: 10,
        teacher_username: 'prof_tran',
        student_count: 2,
        essay_count: 1,
        created_at: '2026-10-01T00:00:00Z',
        join_code: 'ABC123',
      };
      const analytics: ClassAnalytics = {
        class_id: 12,
        class_name: 'Original Class Name',
        total_students: 2,
        total_essays: 1,
        avg_cis: 90,
        recency_5yr_ratio: 85,
        cis_distribution: {},
        verdict_breakdown: { verified: 9, metadata_error: 1 },
        top_triggered_rules: [],
        shared_hallucinations: [],
      };

      vi.spyOn(api, 'listMyClasses').mockResolvedValue([cls]);
      vi.spyOn(api, 'listClassStudents').mockResolvedValue([]);
      vi.spyOn(api, 'listClassEssays').mockResolvedValue([]);
      vi.spyOn(api, 'getClassAnalytics').mockResolvedValue(analytics);

      expect(typeof api.updateClass).toBe('function');
      expect(typeof api.deleteClass).toBe('function');
      expect(typeof api.downloadClassZipExport).toBe('function');
      expect(typeof api.leaveClass).toBe('function');

      const zipSpy = vi.spyOn(api, 'downloadClassZipExport').mockResolvedValue(undefined);
      const updateSpy = vi
        .spyOn(api, 'updateClass')
        .mockResolvedValue({ ...cls, name: 'Renamed Cohort 2026' });
      const deleteSpy = vi
        .spyOn(api, 'deleteClass')
        .mockResolvedValue({ status: 'deleted', id: 12 });

      const { unmount } = renderWithProviders(
        <Routes>
          <Route path="/teacher/classes/:classId" element={<ClassDetailPage />} />
          <Route path="/teacher/classes" element={<div data-testid="classes-index">Index</div>} />
        </Routes>,
        {
          user: makeUser({ id: 10, role: 'teacher', plan_tier: 'ultra' }),
          route: '/teacher/classes/12',
        },
      );

      await waitFor(() => {
        expect(screen.getByText('Original Class Name')).toBeTruthy();
      });

      fireEvent.click(screen.getByTestId('export-class-zip-btn'));
      await waitFor(() => {
        expect(zipSpy).toHaveBeenCalledWith(12);
      });

      fireEvent.click(screen.getByTestId('edit-class-btn'));
      const nameInput = await screen.findByTestId('edit-class-name-input');
      fireEvent.change(nameInput, { target: { value: 'Renamed Cohort 2026' } });
      fireEvent.click(screen.getByTestId('save-edit-class-btn'));

      await waitFor(() => {
        expect(updateSpy).toHaveBeenCalledWith(
          12,
          expect.objectContaining({ name: 'Renamed Cohort 2026' }),
        );
      });

      fireEvent.click(screen.getByTestId('delete-class-btn'));
      const confirmDeleteBtn = await screen.findByRole('button', { name: /delete/i });
      fireEvent.click(confirmDeleteBtn);
      await waitFor(() => {
        expect(deleteSpy).toHaveBeenCalledWith(12);
      });
      unmount();

      // Leave Class on MyClassesPage when enrolled classes exist
      vi.spyOn(api, 'getTeacherDashboard').mockResolvedValue({
        total_classes: 0,
        total_students: 0,
        total_essays: 0,
        pending_reviews: 0,
        classes: [],
      });
      vi.spyOn(api, 'listEnrolledClasses').mockResolvedValue([cls]);
      const leaveSpy = vi
        .spyOn(api, 'leaveClass')
        .mockResolvedValue({ status: 'left', class_id: 12 });

      renderWithProviders(<MyClassesPage />, {
        user: makeUser({ id: 88, role: 'teacher', plan_tier: 'pro' }),
      });

      const leaveBtn = await screen.findByTestId('leave-class-btn-12');
      fireEvent.click(leaveBtn);
      const confirmBtn = await screen.findByTestId('confirm-leave-class-btn');
      fireEvent.click(confirmBtn);

      await waitFor(() => {
        expect(leaveSpy).toHaveBeenCalledWith(12);
      });
    });

    it('opens UpgradeModal when CreateClassDialog hits a 403/402 class limit error', async () => {
      vi.spyOn(api, 'createClass').mockRejectedValue(
        new Error('API 403: {"detail":{"code":"CLASS_LIMIT_REACHED","message":"Pro plan allows up to 5 classes"}}'),
      );

      renderWithProviders(
        <CreateClassDialog open={true} onClose={vi.fn()} onCreated={vi.fn()} />,
        { user: makeUser({ role: 'teacher', plan_tier: 'pro' }) },
      );

      const input = screen.getByLabelText(/class name/i);
      fireEvent.change(input, { target: { value: 'Sixth Cohort' } });
      fireEvent.submit(input.closest('form')!);

      await waitFor(() => {
        expect(screen.getByTestId('upgrade-modal')).toBeTruthy();
      });
    });
  });

  describe('6. CitraFilm Fast-Click Race & Sandbox VerificationProgress Registration', () => {
    it('does not overwrite an actively playing fallback video stream when pickVariant resolves late', async () => {
      let resolveProbe!: (info: { supported: boolean; smooth: boolean; powerEfficient: boolean }) => void;
      const origMc = navigator.mediaCapabilities;
      Object.defineProperty(navigator, 'mediaCapabilities', {
        configurable: true,
        value: {
          decodingInfo: vi.fn(
            () =>
              new Promise((resolve) => {
                resolveProbe = resolve;
              }),
          ),
        },
      });

      let ioCallback: IntersectionObserverCallback | null = null;
      const origIO = globalThis.IntersectionObserver;
      globalThis.IntersectionObserver = class MockIO {
        constructor(cb: IntersectionObserverCallback) {
          ioCallback = cb;
        }
        observe() {}
        disconnect() {}
        unobserve() {}
        takeRecords() {
          return [];
        }
        root = null;
        rootMargin = '';
        thresholds = [];
      } as unknown as typeof IntersectionObserver;

      const origCreate = document.createElement.bind(document);
      const createSpy = vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
        const el = origCreate(tag);
        if (tag === 'video') {
          Object.defineProperty(el, 'canPlayType', {
            configurable: true,
            value: () => 'probably',
          });
        }
        return el;
      }) as typeof document.createElement);

      const playStub = vi
        .spyOn(HTMLMediaElement.prototype, 'play')
        .mockImplementation(() => Promise.resolve());

      try {
        render(<SolvaFilmSection lang="en" />);

        // Trigger warm hover so async pickVariant starts immediately
        fireEvent.pointerEnter(screen.getByTestId('citra-film-play'));
        act(() => {
          ioCallback?.(
            [{ isIntersecting: true } as IntersectionObserverEntry],
            {} as IntersectionObserver,
          );
        });

        // Fast-click play BEFORE pickVariant resolves
        fireEvent.click(screen.getByTestId('citra-film-play'));
        const video = screen.getByLabelText('Watch the CITRA film') as HTMLVideoElement;
        const initialPlayingSrc = video.getAttribute('src');
        expect(initialPlayingSrc).toBe('/media/citra-film-v2/film-1080p.h264.mp4');

        // Now resolve async MediaCapabilities probe with smooth AV1 support
        await act(async () => {
          resolveProbe?.({ supported: true, smooth: true, powerEfficient: true });
          await Promise.resolve();
          await Promise.resolve();
        });

        // Active stream MUST NOT be swapped mid-playback to a different codec/URL
        expect(video.getAttribute('src')).toBe(initialPlayingSrc);
      } finally {
        playStub.mockRestore();
        createSpy.mockRestore();
        globalThis.IntersectionObserver = origIO;
        Object.defineProperty(navigator, 'mediaCapabilities', {
          configurable: true,
          value: origMc,
        });
      }
    });

    it('registers generated sandbox PDF manuscript job in VerificationProgressContext', async () => {
      vi.spyOn(api, 'sampleSandboxAclPapers').mockResolvedValue({
        count: 1,
        style: 'apa',
        database_total_papers: 500,
        items: [
          {
            index: 0,
            paper_id: 10,
            title: 'Attention Is All You Need',
            authors: ['Vaswani, A.'],
            authors_text: 'Vaswani, A.',
            year: '2017',
            venue: 'NeurIPS',
            doi: '10.5555/3295222.3295349',
            cite_in_text: true,
            include_in_references: true,
            in_text_year_override: '',
            in_text_context: 'Transformers improved translation (Vaswani, 2017).',
          },
        ],
      });
      vi.spyOn(api, 'generateSandboxPdfManuscript').mockResolvedValue({
        essay_id: 888,
        filename: 'sandbox_demo.pdf',
        num_pages: 3,
        in_text_count: 1,
        references_count: 1,
        in_text_markers_preview: ['(Vaswani, 2017)'],
        references_preview: ['Vaswani, A. (2017). Attention Is All You Need.'],
        pdf_base64: '',
        status: 'queued',
      });
      vi.spyOn(api, 'getEssayStatus').mockResolvedValue({
        status: 'queued',
        step: 'parsing',
        step_index: 0,
        total_steps: 8,
        message: 'Queued...',
        citations_found: 1,
        references_found: 1,
        linked: 0,
        sources_queried: {},
        elapsed_seconds: 0,
        finished_at: null,
        error: null,
      });

      function ProgressSpy() {
        const { activeSingleCheck } = useVerificationProgress();
        return (
          <div data-testid="active-single-essay-id">
            {activeSingleCheck?.essayId ?? 'none'}
          </div>
        );
      }

      renderWithProviders(
        <Routes>
          <Route
            path="*"
            element={
              <>
                <ProgressSpy />
                <LiveCitationSandbox />
              </>
            }
          />
        </Routes>,
        { user: makeUser({ plan_tier: 'pro' }) },
      );

      fireEvent.click(screen.getByTestId('sandbox-random-acl-btn'));
      const generateBtn = await screen.findByTestId('sandbox-generate-verify-pdf-btn');
      fireEvent.click(generateBtn);

      await waitFor(() => {
        expect(screen.getByTestId('active-single-essay-id').textContent).toBe('888');
      });
    });
  });

  describe('7. Report Tabs filename Propagation, Escape Modal Guard & Issues Candidate Badge', () => {
    it('passes filename={report.filename} to EssayActionBar across all 5 report tabs', async () => {
      const reportTabs = [
        'src/pages/EssayPage.tsx',
        'src/pages/IssuesPage.tsx',
        'src/pages/DocumentInspectorPage.tsx',
        'src/pages/OrphanDetectionPage.tsx',
        'src/pages/LogicTracePage.tsx',
      ];

      for (const rel of reportTabs) {
        const src = fs.readFileSync(path.join(WEB_ROOT, rel), 'utf8');
        expect(src, `${rel} must pass filename={report.filename} to EssayActionBar`).toMatch(
          /<EssayActionBar[\s\S]{0,300}filename=\{report\.filename\}/,
        );
      }

      // Verify render on IssuesPage + Remediation Modal enables .docx auto-heal button
      vi.spyOn(api, 'getEssay').mockResolvedValue(makeSampleReport({ filename: 'capstone_thesis.docx' }));
      vi.spyOn(api, 'getRemediatedBibliography').mockResolvedValue({
        essay_id: 77,
        style: 'apa',
        total_entries: 0,
        remediated_count: 0,
        entries: [],
        combined_text: '',
        combined_bibtex: '',
        combined_ris: '',
      });

      renderWithProviders(
        <Routes>
          <Route path="/verification/report/:id/issues" element={<IssuesPage />} />
        </Routes>,
        { route: '/verification/report/77/issues', user: makeUser({ plan_tier: 'pro' }) },
      );

      const remBtn = await screen.findByTestId('actionbar-remediation-btn');
      fireEvent.click(remBtn);
      const docxBtn = (await screen.findByTestId('download-auto-healed-docx-btn')) as HTMLButtonElement;
      expect(docxBtn.disabled).toBe(false);

      // Ensure helper references imported tabs cleanly for typecheck
      expect(EssayPage).toBeDefined();
      expect(DocumentInspectorPage).toBeDefined();
      expect(OrphanDetectionPage).toBeDefined();
      expect(LogicTracePage).toBeDefined();
    });

    it('guards EssayPage Escape listener so closing a modal does not deselect the active citation', async () => {
      const essayPageSrc = fs.readFileSync(path.join(WEB_ROOT, 'src/pages/EssayPage.tsx'), 'utf8');
      expect(essayPageSrc).toMatch(/remediationOpen|role="dialog"/);

      // OverrideControls supports both legacy & canonical OverrideRecord keys
      const verdictWithLegacyOverrideKeys: Verdict = {
        citation_id: 'cit-0001',
        citation_raw: '(Phantom & Ghost, 2023)',
        mapping_status: 'matched',
        mapping_confidence: 0.95,
        label: 'verified',
        confidence: 1,
        reasoning: 'Verified by instructor',
        triggered_rules: [],
        mismatched_fields: [],
        matched_sources: [],
        is_overridden: true,
        override_record: {
          original_label: 'suspected_hallucination',
          overridden_label: 'verified',
          reason: 'Verified physical library copy',
          overridden_by: 'prof_tran',
          overridden_at: '2026-11-16T09:00:00Z',
        } as unknown as Verdict['override_record'],
      };

      renderWithProviders(
        <OverrideControls verdict={verdictWithLegacyOverrideKeys} onOverride={vi.fn()} />,
        { user: makeUser({ role: 'teacher', can_override_verdicts: true }) },
      );

      expect(screen.getByTestId('override-badge').textContent).toContain('prof_tran');
    });

    it('renders non-green candidate badge instead of MATCH for low-confidence matched_sources on IssuesPage', async () => {
      vi.spyOn(api, 'getEssay').mockResolvedValue(makeSampleReport());

      renderWithProviders(
        <Routes>
          <Route path="/verification/report/:id/issues" element={<IssuesPage />} />
        </Routes>,
        { route: '/verification/report/77/issues', user: makeUser({ plan_tier: 'pro' }) },
      );

      const expandBtn = await screen.findByLabelText('Expand details');
      fireEvent.click(expandBtn);

      // Must NOT label a 0.28 confidence hallucination candidate as green "MATCH"
      const candidateBadge = await screen.findByTestId('issue-source-candidate-badge');
      expect(candidateBadge.textContent).toContain('LOW CONFIDENCE');
      expect(candidateBadge.textContent).not.toBe('MATCH');
    });
  });

  describe('8. StripeDemoCheckoutPage Real ISO QR, Google ReadOnly Email & Product Copy Accuracy', () => {
    it('renders real ISO/IEC 18004 QR matrix modules on VNPAY-QR checkout tab', async () => {
      vi.spyOn(api, 'getCheckoutSessionDetails').mockResolvedValue({
        session_id: 'cs_demo_123',
        status: 'open',
        payment_mode: 'stripe_demo',
        merchant_name: 'CITRA',
        customer_email: 'linh@tdtu.edu.vn',
        customer_name: 'Nguyen Linh',
        plan_tier: 'pro',
        plan_name: 'CITRA Pro',
        billing_cycle: 'monthly',
        amount_usd: 20,
        amount_vnd: 500000,
        usd_to_vnd_rate: 25000,
        monthly_equivalent_usd: 20,
        annual_savings_usd: 0,
        currency: 'usd',
        features_en: ['50 checks / month'],
        features_vi: ['50 lượt kiểm tra / tháng'],
      });
      vi.spyOn(api, 'createVNPayPaymentUrl').mockResolvedValue({
        session_id: 'cs_demo_123',
        payment_url:
          'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html?vnp_Amount=50000000&vnp_BankCode=VNPAYQR&vnp_TxnRef=CITRA123',
        vnp_txn_ref: 'CITRA123',
        vnp_amount: 50000000,
        amount_vnd: 500000,
        amount_usd: 20,
        usd_to_vnd_rate: 25000,
        bank_code: 'VNPAYQR',
        tmn_code: 'CITRAVNP',
        create_date: '20261116100000',
        expire_date: '20261116101500',
        order_info: 'CITRA Pro monthly',
        external_redirect: false,
        vnp_params: { vnp_TxnRef: 'CITRA123', vnp_Amount: '50000000' },
        supported_banks: [],
        sandbox_test_cards: [],
      });

      renderWithProviders(<StripeDemoCheckoutPage />, {
        route: '/billing/checkout?session_id=cs_demo_123&plan=pro&cycle=monthly',
        user: makeUser({ plan_tier: 'basic' }),
      });

      const vnpayTab = await screen.findByTestId('method-tab-vnpay');
      fireEvent.click(vnpayTab);

      const paySubmit = await screen.findByTestId('vnpay-launch-gateway-btn');
      fireEvent.click(paySubmit);

      const qrModalTab = await screen.findByTestId('vnpay-modal-tab-qr');
      fireEvent.click(qrModalTab);

      const qrSvg = await screen.findByTestId('vnpay-iso-qr-svg');
      const rects = qrSvg.querySelectorAll('rect');
      // Real ISO QR version >= 3 has > 150 dark modules
      expect(rects.length).toBeGreaterThan(150);
    });

    it('activates $0.00 promo_waiver (VIP100) checkout without requiring Luhn card details', async () => {
      vi.spyOn(api, 'getCheckoutSessionDetails').mockResolvedValue({
        session_id: 'cs_waiver_100',
        status: 'open',
        payment_mode: 'promo_waiver',
        merchant_name: 'CITRA',
        customer_email: 'linh@tdtu.edu.vn',
        customer_name: 'Nguyen Linh',
        plan_tier: 'pro',
        plan_name: 'CITRA Pro',
        billing_cycle: 'monthly',
        subtotal_usd: 20,
        discount_usd: 20,
        promo_code: 'VIP100',
        amount_usd: 0,
        amount_vnd: 0,
        usd_to_vnd_rate: 25000,
        monthly_equivalent_usd: 0,
        annual_savings_usd: 0,
        currency: 'usd',
        features_en: ['50 checks / month'],
        features_vi: ['50 lượt kiểm tra / tháng'],
      });
      const verifySpy = vi.spyOn(api, 'verifyCheckoutSession').mockResolvedValue({
        status: 'succeeded',
        message: 'Activated via 100% promo waiver',
        transaction: {
          id: 501,
          user_id: 42,
          stripe_session_id: 'cs_waiver_100',
          stripe_payment_intent_id: null,
          plan_tier: 'pro',
          plan_name: 'CITRA Pro',
          billing_cycle: 'monthly',
          amount_usd: 0,
          currency: 'usd',
          status: 'succeeded',
          payment_mode: 'promo_waiver',
          card_brand: 'promo_waiver',
          card_last4: 'FREE',
          created_at: null,
          paid_at: '2026-11-16T10:00:00Z',
        },
        subscription: {
          plan_tier: 'pro',
          plan_name: 'CITRA Pro',
          billing_cycle: 'monthly',
          subscription_status: 'active',
          cancel_at_period_end: false,
          current_period_start: '2026-11-16T00:00:00Z',
          current_period_end: '2026-12-16T00:00:00Z',
          quota: makeUser().quota!,
        },
        user: makeUser({ plan_tier: 'pro' }),
      });

      renderWithProviders(
        <Routes>
          <Route path="/billing/checkout" element={<StripeDemoCheckoutPage />} />
          <Route path="/billing/success" element={<div data-testid="waiver-success">Done</div>} />
        </Routes>,
        {
          route: '/billing/checkout?session_id=cs_waiver_100',
          user: makeUser({ plan_tier: 'basic' }),
        },
      );

      const cardInput = (await screen.findByTestId('stripe-card-number-input')) as HTMLInputElement;
      expect(cardInput.required).toBe(false);

      // Clear prefilled demo values to prove $0.00 promo_waiver needs zero card details
      fireEvent.change(cardInput, { target: { value: '' } });
      fireEvent.change(screen.getByTestId('stripe-expiry-input'), { target: { value: '' } });
      fireEvent.change(screen.getByTestId('stripe-cvc-input'), { target: { value: '' } });
      fireEvent.change(screen.getByTestId('stripe-cardholder-input'), { target: { value: '' } });
      fireEvent.change(screen.getByTestId('stripe-billing-zip-input'), { target: { value: '' } });

      fireEvent.submit(cardInput.closest('form')!);

      await waitFor(() => {
        expect(verifySpy).toHaveBeenCalledWith(
          expect.objectContaining({
            session_id: 'cs_waiver_100',
            payment_method: 'card',
            card_brand: 'promo_waiver',
            card_last4: 'FREE',
          }),
        );
      });
    });

    it('renders Google-linked user email as readOnly/disabled on ProfilePage and enforces 72-byte password cap', async () => {
      const changePwSpy = vi.spyOn(api, 'changeMyPassword').mockResolvedValue({ message: 'ok' });
      const googleUser = makeUser({
        auth_provider: 'google',
        google_linked: true,
        has_password: false,
        email: 'google.scholar@tdtu.edu.vn',
      });

      const { container } = renderWithProviders(<ProfilePage />, { user: googleUser });

      const emailInput = screen.getByDisplayValue('google.scholar@tdtu.edu.vn') as HTMLInputElement;
      expect(emailInput.disabled || emailInput.readOnly).toBe(true);

      const pwInputs = Array.from(container.querySelectorAll('input[type="password"]'));
      expect(pwInputs.length).toBeGreaterThanOrEqual(2);
      const tooLongPw = 'A'.repeat(73);
      fireEvent.change(pwInputs[0]!, { target: { value: tooLongPw } });
      fireEvent.change(pwInputs[1]!, { target: { value: tooLongPw } });
      fireEvent.submit(pwInputs[0]!.closest('form')!);

      await waitFor(() => {
        expect(screen.getByText(/72 UTF-8 bytes|72 byte/i)).toBeTruthy();
      });
      expect(changePwSpy).not.toHaveBeenCalled();
    });

    it('replaces stale DeBERTa / R01-R16 / 15-verdict / accusatory copy across LandingPage, PricingPage & BibliographyRemediationModal while preserving pricing-floral.webp comment', async () => {
      const landingSrc = fs.readFileSync(path.join(WEB_ROOT, 'src/pages/LandingPage.tsx'), 'utf8');
      const mockupSrc = fs.readFileSync(
        path.join(WEB_ROOT, 'src/components/landing/SolvaMockupWidgets.tsx'),
        'utf8',
      );
      const pricingSrc = fs.readFileSync(path.join(WEB_ROOT, 'src/pages/PricingPage.tsx'), 'utf8');
      const remediationSrc = fs.readFileSync(
        path.join(WEB_ROOT, 'src/components/BibliographyRemediationModal.tsx'),
        'utf8',
      );

      expect(landingSrc).not.toMatch(/DeBERTa|ms-marco/i);
      expect(mockupSrc).not.toMatch(/DeBERTa|ms-marco|CrossEncoder/i);
      expect(pricingSrc).not.toMatch(/DeBERTa|ms-marco/i);
      expect(landingSrc).not.toMatch(/R01–R16/);
      expect(landingSrc).not.toMatch(/15-verdict|15 nhãn phán quyết/i);
      expect(landingSrc).toContain('/solva/pricing-floral.webp');
      expect(landingSrc).toMatch(/Sentence-BERT/i);
      expect(pricingSrc).toMatch(/Sentence-BERT/i);

      expect(remediationSrc).not.toContain('NGUỒN BỊA ĐẶT / ẢO GIÁC AI — CẦN LOẠI BỎ');
      expect(remediationSrc).toContain('NGHI VẤN NGUỒN BỊA ĐẶT / ẢO GIÁC AI — CẦN KIỂM TRA');

      await i18n.changeLanguage('vi');
      vi.spyOn(api, 'getRemediatedBibliography').mockResolvedValue({
        essay_id: 77,
        style: 'apa',
        total_entries: 1,
        remediated_count: 0,
        hallucination_count: 1,
        entries: [
          {
            index: 1,
            verdict_id: 'cit-0001',
            label: 'suspected_hallucination',
            remediation_status: 'hallucination',
            is_hallucination: true,
            is_error: true,
            source_used: null,
            original_raw: 'Phantom, A. (2023). Fake paper.',
            remediated_text: 'Phantom, A. (2023). Fake paper.',
            apa: 'Phantom, A. (2023). Fake paper.',
            ieee: '[1] A. Phantom, "Fake paper," 2023.',
            tdtu: 'Phantom, A. (2023). Fake paper.',
            bibtex: '',
            ris: '',
            diff_fields: [],
            was_modified: false,
            canonical_metadata: {
              title: '',
              authors: [],
              year: '',
              venue: '',
              doi: '',
              url: '',
            },
          },
        ],
        combined_text: '',
        combined_bibtex: '',
        combined_ris: '',
      });

      renderWithProviders(
        <BibliographyRemediationModal
          essayId={77}
          lang="vi"
          filename="capstone_thesis.docx"
          open={true}
          onClose={vi.fn()}
        />,
      );

      await waitFor(() => {
        expect(
          screen.getByText(/NGHI VẤN NGUỒN BỊA ĐẶT \/ ẢO GIÁC AI — CẦN KIỂM TRA/),
        ).toBeTruthy();
      });
    });
  });
});
