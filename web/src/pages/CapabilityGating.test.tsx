import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Routes, Route } from 'react-router-dom';
import { api } from '@/api/client';
import i18n from '@/i18n';
import { renderWithProviders, makeUser, screen, fireEvent, waitFor } from '@/test-utils';
import { makeReport } from '@/test-fixtures';
import { IssuesPage } from './IssuesPage';
import { EssayPage } from './EssayPage';
import { DashboardPage } from './DashboardPage';

/**
 * Capability gating: Pro/Ultra students must see the same deep diagnostics as
 * teachers (the `view_logic_trace` capability), Basic students see upgrade hints.
 */

function renderIssues(user = makeUser('user', 'basic')) {
  return renderWithProviders(
    <Routes>
      <Route path="/verification/report/:id/issues" element={<IssuesPage />} />
    </Routes>,
    { user, initialRoute: '/verification/report/42/issues' },
  );
}

function renderEssay(user = makeUser('user', 'basic')) {
  return renderWithProviders(
    <Routes>
      <Route path="/verification/report/:id" element={<EssayPage />} />
    </Routes>,
    { user, initialRoute: '/verification/report/42' },
  );
}

async function expandFirstIssue() {
  const expand = await screen.findByRole('button', { name: /expand details/i });
  fireEvent.click(expand);
}

describe('IssuesPage capability gating', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await i18n.changeLanguage('en');
    vi.spyOn(api, 'getEssay').mockResolvedValue(makeReport());
  });

  it('Pro student sees explanation, verification checks, checked libraries and match certainty', async () => {
    renderIssues(makeUser('user', 'pro'));
    await expandFirstIssue();
    expect(screen.getByText('What this means')).toBeDefined();
    expect(screen.getByText('Verification Checks')).toBeDefined();
    expect(screen.getByText('An additional verification check was applied')).toBeDefined();
    expect(screen.queryByText(/^R05$/)).toBeNull();
    expect(screen.getByText('Checked Libraries')).toBeDefined();
    expect(screen.getByTestId('issue-analysis-certainty').textContent).toMatch(
      /Match certainty:\s*73%/,
    );
    expect(screen.queryByTestId('issues-upgrade-hint')).toBeNull();
  });

  it('Ultra student also gets the deep diagnostics', async () => {
    renderIssues(makeUser('user', 'ultra'));
    await expandFirstIssue();
    expect(screen.getByText('Verification Checks')).toBeDefined();
  });

  it('Basic student is gated and sees an upgrade hint instead', async () => {
    renderIssues(makeUser('user', 'basic'));
    await expandFirstIssue();
    expect(screen.queryByText('Verification Checks')).toBeNull();
    expect(screen.queryByText('Checked Libraries')).toBeNull();
    expect(screen.queryByText('What this means')).toBeNull();
    const hint = screen.getByTestId('issues-upgrade-hint');
    expect(hint.textContent).toMatch(/Upgrade to Pro/i);
    expect(hint.querySelector('a')?.getAttribute('href')).toBe('/pricing');
  });

  it('teacher keeps full access', async () => {
    renderIssues(makeUser('teacher'));
    await expandFirstIssue();
    expect(screen.getByText('Verification Checks')).toBeDefined();
  });
});

describe('EssayPage capability gating', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await i18n.changeLanguage('en');
    vi.spyOn(api, 'getEssay').mockResolvedValue(makeReport());
  });

  it('Pro student sees the original reference in essay and match confidence in verification details', async () => {
    renderEssay(makeUser('user', 'pro'));
    const drawerToggle = await screen.findByTestId('deep-verification-drawer-toggle');
    fireEvent.click(drawerToggle);
    await waitFor(() => expect(screen.getByText('Original Reference in Essay')).toBeDefined());
    expect(screen.getAllByText(/Match Confidence:/).length).toBeGreaterThan(0);
    expect(screen.queryByTestId('deep-drawer-basic-upgrade')).toBeNull();
  });

  it('Basic student does not see the original reference block or match confidence and sees upgrade card', async () => {
    renderEssay(makeUser('user', 'basic'));
    await waitFor(() => expect(screen.getAllByText('thesis.pdf').length).toBeGreaterThan(0));
    fireEvent.click(screen.getByTestId('deep-verification-drawer-toggle'));
    expect(screen.queryByText('Original Reference in Essay')).toBeNull();
    expect(screen.queryByText(/Match Confidence:/)).toBeNull();
    expect(screen.getByTestId('deep-drawer-basic-upgrade')).toBeDefined();
  });
});

describe('DashboardPage streamlined row actions', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await i18n.changeLanguage('en');
    vi.spyOn(api, 'listEssays').mockResolvedValue([
      {
        id: 5,
        filename: 'a.pdf',
        num_pages: 3,
        uploaded_at: '2026-10-01T00:00:00Z',
        user_id: 10,
        cis_score: 90,
        num_citations: 4,
        num_verdicts: 4,
        num_verified: 3,
      },
    ]);
  });

  it('keeps only the primary View action and hides Issues and Trace buttons for Pro users', async () => {
    const { container } = renderWithProviders(<DashboardPage />, { user: makeUser('user', 'pro') });
    const viewLink = await screen.findByTestId('dashboard-primary-action-5');
    expect(viewLink.getAttribute('href')).toBe('/verification/report/5');
    expect(viewLink.textContent?.trim()).toBe('View');
    expect(screen.queryByTestId('dashboard-trace-link-5')).toBeNull();
    expect(screen.queryByTestId('dashboard-trace-locked-5')).toBeNull();
    expect(container.querySelector('a[href="/verification/report/5/issues"]')).toBeNull();
    expect(container.querySelector('a[href="/verification/report/5/trace"]')).toBeNull();
  });

  it('keeps only the primary View action and hides Issues and Trace buttons for Basic users', async () => {
    const { container } = renderWithProviders(<DashboardPage />, { user: makeUser('user', 'basic') });
    const viewLink = await screen.findByTestId('dashboard-primary-action-5');
    expect(viewLink.getAttribute('href')).toBe('/verification/report/5');
    expect(viewLink.textContent?.trim()).toBe('View');
    expect(screen.queryByTestId('dashboard-trace-link-5')).toBeNull();
    expect(screen.queryByTestId('dashboard-trace-locked-5')).toBeNull();
    expect(container.querySelector('a[href="/verification/report/5/issues"]')).toBeNull();
    expect(container.querySelector('a[href="/verification/report/5/trace"]')).toBeNull();
  });
});
