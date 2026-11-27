import { describe, it, expect, vi, beforeEach } from 'vitest';
import { api, type EssaySummary } from '@/api/client';
import i18n from '@/i18n';
import { renderWithProviders, makeUser, screen, fireEvent, waitFor } from '@/test-utils';
import { loadDashboardStats } from '@/hooks/useEssays';
import { DashboardPage } from './DashboardPage';
import { HistoryPage } from './HistoryPage';

const essays: EssaySummary[] = [
  { id: 1, filename: 'a.pdf', num_pages: 2, uploaded_at: '2026-10-01T00:00:00Z', user_id: 1, cis_score: 80, num_citations: 10, num_verdicts: 10, num_verified: 5 },
  { id: 2, filename: 'b.pdf', num_pages: 2, uploaded_at: '2026-10-02T00:00:00Z', user_id: 1, cis_score: 60, num_citations: 6, num_verdicts: 6, num_verified: 3 },
];

const remoteStats = {
  total_essays: 120,
  total_citations: 3400,
  verified: 900,
  metadata_error: 50,
  suspected_hallucination: 25,
  unresolved: 15,
  resource: 10,
};

describe('loadDashboardStats (contract C2)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('uses /api/essays/stats totals when available', async () => {
    vi.spyOn(api, 'getEssayStats').mockResolvedValue(remoteStats);
    const stats = await loadDashboardStats(essays);
    expect(stats.total_documents).toBe(120);
    expect(stats.total_citations).toBe(3400);
    expect(stats.verified_rate).toBe(90); // 900 / 1000
    expect(stats.avg_cis_score).toBe(70); // still from essay summaries
  });

  it('falls back to client-side computation on 404', async () => {
    vi.spyOn(api, 'getEssayStats').mockRejectedValue(new Error('API 404: Not Found'));
    const stats = await loadDashboardStats(essays);
    expect(stats).toEqual({ total_documents: 2, total_citations: 16, avg_cis_score: 70, verified_rate: 50 });
  });

  it('falls back when the endpoint returns an unexpected shape', async () => {
    vi.spyOn(api, 'getEssayStats').mockResolvedValue({ detail: 'weird' } as never);
    const stats = await loadDashboardStats(essays);
    expect(stats.total_documents).toBe(2);
  });

  it('handles zero labels without dividing by zero', async () => {
    vi.spyOn(api, 'getEssayStats').mockResolvedValue({
      ...remoteStats,
      verified: 0, metadata_error: 0, suspected_hallucination: 0, unresolved: 0, resource: 0,
    });
    const stats = await loadDashboardStats(essays);
    expect(stats.verified_rate).toBe(0);
  });
});

describe('DashboardPage aggregate cards', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await i18n.changeLanguage('en');
    vi.spyOn(api, 'listEssays').mockResolvedValue(essays);
  });

  it('renders server-side totals from /api/essays/stats', async () => {
    vi.spyOn(api, 'getEssayStats').mockResolvedValue(remoteStats);
    renderWithProviders(<DashboardPage />, { user: makeUser('admin') });
    await waitFor(() => expect(screen.getByText('120')).toBeDefined());
    expect(screen.getByText('3400')).toBeDefined();
    expect(screen.getByText('90%')).toBeDefined();
  });

  it('renders client-side totals when the stats endpoint is unavailable', async () => {
    vi.spyOn(api, 'getEssayStats').mockRejectedValue(new Error('API 404'));
    renderWithProviders(<DashboardPage />, { user: makeUser('user', 'pro') });
    await waitFor(() => expect(screen.getByText('16')).toBeDefined());
    expect(screen.getByText('50%')).toBeDefined();
    expect(screen.getByText('70.0 / 100')).toBeDefined();
    expect(screen.getByTestId('essay-cis-1').textContent).toBe('80.0 / 100');
  });

  it('renders Teacher Overview banner with live pending review count and omits dev cosplay tags', async () => {
    vi.spyOn(api, 'getEssayStats').mockResolvedValue(remoteStats);
    vi.spyOn(api, 'getTeacherDashboard').mockResolvedValue({
      total_classes: 3,
      total_students: 48,
      total_essays: 12,
      pending_reviews: 7,
      classes: [],
    });

    renderWithProviders(<DashboardPage />, { user: makeUser('teacher', 'pro') });
    const overview = await screen.findByTestId('dashboard-teacher-overview');
    await waitFor(() => {
      expect(overview.textContent).toContain('3 classes');
      expect(screen.getByTestId('dashboard-teacher-pending-count').textContent).toBe('7');
    });
    expect(screen.getByTestId('dashboard-teacher-classes-link').getAttribute('href')).toBe(
      '/teacher/classes',
    );
    expect(screen.getByTestId('dashboard-teacher-reviews-link').getAttribute('href')).toBe(
      '/teacher/reviews',
    );
    expect(document.body.textContent).not.toContain('GROBID TEI');
    expect(document.body.textContent).not.toContain('OPENXML');
  });

  it('Loop Round 2: bounds Search/Sort/Refresh toolbar widths across DashboardPage & HistoryPage, uses font-solva-serif font-normal H1s, and sets role="dialog" aria-modal="true" on Delete Essay modal', async () => {
    vi.spyOn(api, 'getEssayStats').mockResolvedValue(remoteStats);

    const { unmount: unmountDash } = renderWithProviders(<DashboardPage />, {
      user: makeUser('user', 'pro'),
    });
    await waitFor(() => expect(screen.getByTestId('dashboard-essay-link-1')).toBeDefined());

    const dashH1 = screen.getByRole('heading', { level: 1 });
    expect(dashH1.className).toContain('font-solva-serif');
    expect(dashH1.className).toContain('font-normal');
    expect(dashH1.className).not.toContain('font-bold');

    const dashSearchBox = screen.getByTestId('dashboard-search-box');
    expect(dashSearchBox.className).toContain('sm:flex-none');
    expect(dashSearchBox.className).toContain('w-full');
    expect(dashSearchBox.className).toContain('sm:w-52');
    expect(dashSearchBox.className).toContain('lg:w-56');
    expect(dashSearchBox.className).toContain('xl:w-64');
    expect(dashSearchBox.className).toContain('min-w-0');

    const dashControls = screen.getByTestId('dashboard-toolbar-controls');
    expect(dashControls.className).toContain('sm:flex-wrap');
    expect(dashControls.className).toContain('min-w-0');

    // Open Delete Essay ConfirmationModal and verify explicit role="dialog" + aria-modal="true"
    fireEvent.click(screen.getByRole('button', { name: 'Delete a.pdf' }));
    const deleteDialog = await screen.findByRole('dialog');
    expect(deleteDialog.getAttribute('aria-modal')).toBe('true');
    unmountDash();

    // HistoryPage toolbar geometry + H1 typography
    renderWithProviders(<HistoryPage />, { user: makeUser('user', 'pro') });
    await waitFor(() => expect(screen.getByTestId('history-search-box')).toBeDefined());

    const histH1 = screen.getByRole('heading', { level: 1 });
    expect(histH1.className).toContain('font-solva-serif');
    expect(histH1.className).toContain('font-normal');
    expect(histH1.className).not.toContain('font-bold');

    const histSearchBox = screen.getByTestId('history-search-box');
    expect(histSearchBox.className).toContain('sm:flex-none');
    expect(histSearchBox.className).toContain('w-full');
    expect(histSearchBox.className).toContain('sm:w-52');
    expect(histSearchBox.className).toContain('lg:w-56');
    expect(histSearchBox.className).toContain('xl:w-64');
    expect(histSearchBox.className).toContain('min-w-0');

    const histControls = screen.getByTestId('history-toolbar-controls');
    expect(histControls.className).toContain('sm:flex-wrap');
    expect(histControls.className).toContain('min-w-0');
  });
});
