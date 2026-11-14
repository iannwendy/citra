import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import i18n from '@/i18n';
import { api, type User } from '@/api/client';
import { ThemeProvider, ThemeToggle } from '@/contexts/ThemeContext';
import { ToastProvider } from '@/contexts/ToastContext';
import { AuthContext } from '@/contexts/AuthContext';
import { VerificationProgressProvider } from '@/contexts/VerificationProgressContext';
import { CitraMotionProvider } from '@/components/ui/motion-primitives';
import { ProcessingPage } from '@/pages/ProcessingPage';
import { AppLayout } from '@/components/AppLayout';

function makeWorkspaceUser(): User {
  return {
    id: 42,
    username: 'researcher_pro',
    email: 'researcher@tdtu.edu.vn',
    full_name: 'Dr. Researcher',
    role: 'user',
    is_active: true,
    avatar_url: null,
    last_login_at: null,
    created_at: null,
    institution: 'TDTU',
    can_override_verdicts: false,
    plan_tier: 'pro',
    billing_cycle: 'annual',
    subscription_status: 'active',
    cancel_at_period_end: false,
    current_period_end: null,
    quota: {
      monthly_uploads_used: 4,
      monthly_uploads_limit: 50,
      monthly_uploads_remaining: 46,
      max_file_size_mb: 25,
      max_pages_per_pdf: 100,
      max_citations_per_essay: 200,
      max_batch_files: 10,
      allowed_export_formats: ['json', 'pdf', 'docx', 'csv'],
      allow_batch_upload: true,
      allow_deep_inspector: true,
      allow_serpapi_fallback: false,
      quota_reset_at: '2026-12-01T00:00:00Z',
    },
  };
}

function renderWorkspace(ui: React.ReactElement, initialEntries = ['/upload']) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const user = makeWorkspaceUser();
  return render(
    <CitraMotionProvider>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider defaultTheme="light">
          <ToastProvider>
            <AuthContext.Provider
              value={{
                user,
                token: 'mock-jwt',
                isLoading: false,
                isAdmin: false,
                login: vi.fn(),
                logout: vi.fn(),
                refreshUser: vi.fn().mockResolvedValue(undefined),
              }}
            >
              <VerificationProgressProvider>
                <MemoryRouter initialEntries={initialEntries}>{ui}</MemoryRouter>
              </VerificationProgressProvider>
            </AuthContext.Provider>
          </ToastProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </CitraMotionProvider>,
  );
}

describe('Task 7 — Core Workspace Continuity', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
    localStorage.clear();
    document.documentElement.classList.remove('light', 'dark');
    document.documentElement.removeAttribute('data-theme-switching');

    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('ProcessingPage renders live #29 ReasoningStream (.t-reason) synthesized from EssayStatus while processing', async () => {
    vi.spyOn(api, 'getEssayStatus').mockResolvedValue({
      status: 'processing',
      queue_position: null,
      step: 'retrieving',
      step_index: 4,
      total_steps: 8,
      message: 'Querying federated scholarly indexes...',
      citations_found: 34,
      references_found: 22,
      linked: 31,
      sources_queried: {
        crossref: 'ok',
        openalex: 'ok',
        arxiv: 'running',
      },
      elapsed_seconds: 5.4,
      finished_at: null,
      error: null,
    });

    renderWorkspace(
      <Routes>
        <Route path="/verification/processing/:id" element={<ProcessingPage />} />
      </Routes>,
      ['/verification/processing/88'],
    );

    const stream = await screen.findByTestId('processing-reasoning-stream');
    expect(stream.classList.contains('t-reason')).toBe(true);
    expect(stream.getAttribute('role')).toBe('log');

    await waitFor(
      () => {
        expect(stream.textContent).toContain('34 in-text markers');
        expect(stream.textContent).toContain('Crossref');
      },
      { timeout: 2500 },
    );
  });

  it('AppLayout renders shared layoutId sidebar-active-indicator and moves it cleanly across route navigation with viewTransition links', () => {
    renderWorkspace(
      <Routes>
        <Route
          path="/upload"
          element={
            <AppLayout>
              <div data-testid="upload-view">Upload View</div>
            </AppLayout>
          }
        />
        <Route
          path="/history"
          element={
            <AppLayout>
              <div data-testid="history-view">History View</div>
            </AppLayout>
          }
        />
      </Routes>,
      ['/upload'],
    );

    const indicatorBefore = screen.getByTestId('sidebar-active-indicator');
    const uploadLink = indicatorBefore.closest('a') as HTMLAnchorElement;
    expect(uploadLink.getAttribute('href')).toBe('/upload');
    expect(uploadLink.getAttribute('data-view-transition')).toBe('true');

    const historyLink = document.querySelector('aside a[href="/history"]') as HTMLAnchorElement;
    expect(historyLink).not.toBeNull();
    expect(historyLink.getAttribute('data-view-transition')).toBe('true');

    fireEvent.click(historyLink);

    expect(screen.getByTestId('history-view')).toBeDefined();
    const indicatorAfter = screen.getByTestId('sidebar-active-indicator');
    expect((indicatorAfter.closest('a') as HTMLAnchorElement).getAttribute('href')).toBe(
      '/history',
    );
  });

  it('ThemeToggle updates document.documentElement.classList.contains("dark") synchronously on click while setting transient data-theme-switching="true" (and omits it under prefers-reduced-motion)', () => {
    vi.useFakeTimers();

    const { unmount } = render(
      <ThemeProvider defaultTheme="light">
        <ThemeToggle />
      </ThemeProvider>,
    );

    const btn = screen.getByRole('button');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(document.documentElement.getAttribute('data-theme-switching')).toBeNull();

    // Click light -> dark: synchronous class update + transient switching attribute
    fireEvent.click(btn);
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.documentElement.getAttribute('data-theme-switching')).toBe('true');

    act(() => {
      vi.advanceTimersByTime(240);
    });
    expect(document.documentElement.getAttribute('data-theme-switching')).toBeNull();

    unmount();

    // Under prefers-reduced-motion: reduce -> synchronous class update, NO data-theme-switching
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: query === '(prefers-reduced-motion: reduce)',
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });

    localStorage.clear();
    document.documentElement.classList.remove('light', 'dark');

    render(
      <ThemeProvider defaultTheme="light">
        <ThemeToggle />
      </ThemeProvider>,
    );

    fireEvent.click(screen.getByRole('button'));
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.documentElement.getAttribute('data-theme-switching')).toBeNull();
  });
});
