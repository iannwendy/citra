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

function renderWorkspace(
  ui: React.ReactElement,
  initialEntries = ['/upload'],
  roleOverride: User['role'] = 'user',
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const user: User = { ...makeWorkspaceUser(), role: roleOverride };
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
                isAdmin: roleOverride === 'admin',
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
    const indicatorTokens = indicatorBefore.className.split(/\s+/);
    expect(indicatorTokens).toContain('rounded-full');
    expect(indicatorTokens).not.toContain('rounded-r-full');
    expect(indicatorTokens).not.toContain('left-0');
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

  it('AppLayout collapses into a ChatGPT-style 72px Slim Icon Rail via toggle button & Ctrl+B while expanding the fluid main content container', () => {
    localStorage.removeItem('citra.sidebar.collapsed');

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

    const sidebar = screen.getByTestId('app-sidebar');
    const mainEl = document.getElementById('main-content') as HTMLElement;
    const mainContainer = screen.getByTestId('app-main-container');
    const footerEl = screen.getByTestId('app-footer');
    const toggleBtn = screen.getByTestId('sidebar-collapse-toggle');

    // Footer must live inside scrollable #main-content (only visible when scrolled to the bottom, not pinned)
    expect(mainEl.contains(footerEl)).toBe(true);

    // Default expanded state uses sleek balanced 232px width (eliminating bloated 288px w-72 dead space)
    expect(sidebar.getAttribute('data-collapsed')).toBe('false');
    expect(sidebar.className).toContain('lg:w-[232px]');
    expect(sidebar.className).not.toContain('lg:w-72');
    expect(toggleBtn.getAttribute('aria-expanded')).toBe('true');
    // Main content container must NOT be clamped to old max-w-6xl (1152px)
    expect(mainContainer.className).not.toContain('max-w-6xl');
    expect(mainContainer.className).toContain('citra-main-cq');
    expect(mainContainer.getAttribute('data-sidebar-collapsed')).toBe('false');

    // Click collapse -> Slim 72px Icon Rail + persisted localStorage + expanded main container
    fireEvent.click(toggleBtn);
    expect(sidebar.getAttribute('data-collapsed')).toBe('true');
    expect(sidebar.className).toContain('lg:w-[72px]');
    expect(localStorage.getItem('citra.sidebar.collapsed')).toBe('true');
    expect(mainContainer.getAttribute('data-sidebar-collapsed')).toBe('true');

    // Icon rail keeps navigation links, active indicator, and quota metadata functional
    const collapsedToggle = screen.getByTestId('sidebar-collapse-toggle');
    expect(collapsedToggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByTestId('sidebar-active-indicator')).toBeDefined();
    expect(screen.getByTestId('sidebar-plan-badge')).toBeDefined();

    // Navigation still works in 1 click while collapsed
    const historyLink = document.querySelector('aside a[href="/history"]') as HTMLAnchorElement;
    fireEvent.click(historyLink);
    expect(screen.getByTestId('history-view')).toBeDefined();

    // Ctrl+B keyboard shortcut expands sidebar back to w-72
    fireEvent.keyDown(window, { key: 'b', ctrlKey: true });
    expect(screen.getByTestId('app-sidebar').getAttribute('data-collapsed')).toBe('false');
    expect(localStorage.getItem('citra.sidebar.collapsed')).toBe('false');
  });

  it('AppLayout organizes sidebar like ChatGPT: collapsible Admin Console accordion + bottom Account Popover housing Profile, Pricing, Settings, Theme, Language, Help & Sign out', () => {
    renderWorkspace(
      <Routes>
        <Route
          path="/dashboard"
          element={
            <AppLayout>
              <div data-testid="dash-view">Dashboard</div>
            </AppLayout>
          }
        />
      </Routes>,
      ['/dashboard'],
      'admin',
    );

    const sidebar = screen.getByTestId('app-sidebar');

    // Outer sidebar does NOT clutter nav with standalone /settings link or standalone Sign out button
    expect(sidebar.querySelector('nav a[href="/settings"]')).toBeNull();
    const initialPopover = screen.getByTestId('sidebar-account-popover');
    expect(initialPopover.className).toContain('citra-account-popover-gpu');
    expect(initialPopover.getAttribute('data-open')).toBe('false');
    expect(initialPopover.getAttribute('aria-hidden')).toBe('true');

    // Admin Console uses pure 120fps GPU compositor animation (.citra-admin-accordion-gpu, zero blur/grid-row layout thrash)
    const adminToggle = screen.getByTestId('sidebar-admin-console-toggle');
    const adminPanel = screen.getByTestId('sidebar-admin-console-panel');
    expect(adminPanel.className).toContain('citra-admin-accordion-gpu');
    expect(adminPanel.className).not.toContain('t-acc-panel');
    expect(adminToggle.getAttribute('aria-expanded')).toBe('false');
    expect(adminPanel.getAttribute('data-open')).toBe('false');
    expect(adminPanel.getAttribute('aria-hidden')).toBe('true');

    const adminUsersLink = sidebar.querySelector('nav a[href="/admin/users"]') as HTMLAnchorElement;
    expect(adminUsersLink).not.toBeNull();
    expect(adminUsersLink.getAttribute('tabindex')).toBe('-1');

    // Expand -> smooth 0fr -> 1fr + staggered items + focusable links
    fireEvent.click(adminToggle);
    expect(adminToggle.getAttribute('aria-expanded')).toBe('true');
    expect(adminPanel.getAttribute('data-open')).toBe('true');
    expect(adminPanel.getAttribute('aria-hidden')).toBe('false');
    expect(adminUsersLink.getAttribute('tabindex')).toBeNull();

    // Collapse again -> stays mounted in DOM with data-open="false" for smooth exit animation
    fireEvent.click(adminToggle);
    expect(adminToggle.getAttribute('aria-expanded')).toBe('false');
    expect(adminPanel.getAttribute('data-open')).toBe('false');
    expect(screen.getByTestId('sidebar-admin-console-panel')).toBeDefined();

    // Clicking bottom Account Pill opens ChatGPT-style Account Popover smoothly at 120fps, and clicking again animates closed
    const accountTrigger = screen.getByTestId('sidebar-account-trigger');
    fireEvent.click(accountTrigger);
    const popover = screen.getByTestId('sidebar-account-popover');
    expect(popover.getAttribute('data-open')).toBe('true');
    expect(popover.getAttribute('aria-hidden')).toBe('false');
    expect(popover.querySelector('a[href="/profile"]')).not.toBeNull();
    expect(popover.querySelector('a[href="/pricing"]')).not.toBeNull();
    expect(popover.querySelector('a[href="/settings"]')).not.toBeNull();
    expect(screen.getByTestId('account-popover-signout')).toBeDefined();

    fireEvent.click(accountTrigger);
    expect(popover.getAttribute('data-open')).toBe('false');
    expect(popover.getAttribute('aria-hidden')).toBe('true');
  });
});
