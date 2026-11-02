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

  it('Pro student sees explanation, triggered rules, source lookup and confidence', async () => {
    renderIssues(makeUser('user', 'pro'));
    await expandFirstIssue();
    expect(screen.getByText('What this means')).toBeDefined();
    expect(screen.getByText('Triggered Rules')).toBeDefined();
    expect(screen.getByText('R05')).toBeDefined();
    expect(screen.getByText('Source Lookup')).toBeDefined();
    expect(screen.getByText('Confidence')).toBeDefined();
    expect(screen.queryByTestId('issues-upgrade-hint')).toBeNull();
  });

  it('Ultra student also gets the deep diagnostics', async () => {
    renderIssues(makeUser('user', 'ultra'));
    await expandFirstIssue();
    expect(screen.getByText('Triggered Rules')).toBeDefined();
  });

  it('Basic student is gated and sees an upgrade hint instead', async () => {
    renderIssues(makeUser('user', 'basic'));
    await expandFirstIssue();
    expect(screen.queryByText('Triggered Rules')).toBeNull();
    expect(screen.queryByText('Source Lookup')).toBeNull();
    expect(screen.queryByText('What this means')).toBeNull();
    const hint = screen.getByTestId('issues-upgrade-hint');
    expect(hint.textContent).toMatch(/Pro \/ Ultra/);
    expect(hint.querySelector('a')?.getAttribute('href')).toBe('/pricing');
  });

  it('teacher keeps full access', async () => {
    renderIssues(makeUser('teacher'));
    await expandFirstIssue();
    expect(screen.getByText('Triggered Rules')).toBeDefined();
  });
});

describe('EssayPage capability gating', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await i18n.changeLanguage('en');
    vi.spyOn(api, 'getEssay').mockResolvedValue(makeReport());
  });

  it('Pro student sees the raw extracted reference string and confidence', async () => {
    renderEssay(makeUser('user', 'pro'));
    await waitFor(() => expect(screen.getByText('Raw Extracted Reference String')).toBeDefined());
    expect(screen.getAllByText(/Conf:/).length).toBeGreaterThan(0);
  });

  it('Basic student does not see the raw reference string or confidence', async () => {
    renderEssay(makeUser('user', 'basic'));
    await waitFor(() => expect(screen.getAllByText('thesis.pdf').length).toBeGreaterThan(0));
    expect(screen.queryByText('Raw Extracted Reference String')).toBeNull();
    expect(screen.queryByText(/Conf:/)).toBeNull();
  });
});

describe('DashboardPage Trace button gating', () => {
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

  it('Pro student gets the Logic Trace link', async () => {
    renderWithProviders(<DashboardPage />, { user: makeUser('user', 'pro') });
    const link = await screen.findByTestId('dashboard-trace-link-5');
    expect(link.getAttribute('href')).toBe('/verification/report/5/trace');
  });

  it('Basic student gets a locked Trace link that points to pricing', async () => {
    renderWithProviders(<DashboardPage />, { user: makeUser('user', 'basic') });
    const link = await screen.findByTestId('dashboard-trace-locked-5');
    expect(link.getAttribute('href')).toBe('/pricing');
    expect(screen.queryByTestId('dashboard-trace-link-5')).toBeNull();
  });
});
