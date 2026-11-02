import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Routes, Route, useLocation } from 'react-router-dom';
import { api, type SystemHealth } from '@/api/client';
import i18n from '@/i18n';
import { renderWithProviders, makeUser, screen, fireEvent, waitFor, act } from '@/test-utils';
import { makeReport, makeVerdict } from '@/test-fixtures';
import { EssayPage, findVerdictByCitationParam } from './EssayPage';
import { PendingReviewsPage } from './PendingReviewsPage';
import { AuditLogPage, AUDIT_PAGE_SIZE } from './AuditLogPage';
import { SystemHealthPage, summarizeHealth } from './SystemHealthPage';

function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="location">{loc.pathname + loc.search}</div>;
}

describe('findVerdictByCitationParam', () => {
  const verdicts = [makeVerdict({ citation_id: 'v10' }), makeVerdict({ citation_id: 'v42' })];
  it('matches raw DB ids and report ids', () => {
    expect(findVerdictByCitationParam(verdicts, '42')?.citation_id).toBe('v42');
    expect(findVerdictByCitationParam(verdicts, 'v10')?.citation_id).toBe('v10');
  });
  it('returns undefined for unknown / empty params', () => {
    expect(findVerdictByCitationParam(verdicts, '99')).toBeUndefined();
    expect(findVerdictByCitationParam(verdicts, '')).toBeUndefined();
    expect(findVerdictByCitationParam(verdicts, null)).toBeUndefined();
  });
});

describe('EssayPage ?citation= deep link', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await i18n.changeLanguage('en');
  });

  it('selects the citation from the query string instead of the default first issue', async () => {
    const report = makeReport({
      verdicts: [
        makeVerdict({ citation_id: 'v1', citation_raw: '[1] First flagged paper', label: 'metadata_error' }),
        makeVerdict({ citation_id: 'v2', citation_raw: '[2] Second verified paper', label: 'verified' }),
      ],
    });
    vi.spyOn(api, 'getEssay').mockResolvedValue(report);
    const scrollSpy = vi.fn();
    Element.prototype.scrollIntoView = scrollSpy;
    renderWithProviders(
      <Routes>
        <Route path="/verification/report/:id" element={<EssayPage />} />
      </Routes>,
      { user: makeUser('teacher'), initialRoute: '/verification/report/42?citation=2' },
    );
    await waitFor(() => {
      const option = document.querySelector('[data-citation-id="v2"]');
      expect(option?.getAttribute('aria-selected')).toBe('true');
    });
    expect(document.querySelector('[data-citation-id="v1"]')?.getAttribute('aria-selected')).toBe('false');
    await waitFor(() => expect(scrollSpy).toHaveBeenCalled());
  });
});

describe('PendingReviewsPage', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await i18n.changeLanguage('en');
  });

  it('row navigates to the report with ?citation=<verdict_id>', async () => {
    vi.spyOn(api, 'listMyClasses').mockResolvedValue([
      { id: 3, name: 'CS101', join_code: 'ABC123' } as never,
    ]);
    vi.spyOn(api, 'listPendingReviews').mockResolvedValue([
      {
        verdict_id: 77,
        essay_id: 9,
        filename: 'x.pdf',
        student_username: 'student1',
        citation_raw: 'Fake 2020',
        label: 'suspected_hallucination',
        confidence: 0.4,
        reasoning: '',
        validated_at: '',
      },
    ]);
    renderWithProviders(
      <>
        <PendingReviewsPage />
        <LocationProbe />
      </>,
      { user: makeUser('teacher') },
    );
    fireEvent.click(await screen.findByTestId('pending-review-row-77'));
    expect(screen.getByTestId('location').textContent).toBe('/verification/report/9?citation=77');
  });
});

describe('AuditLogPage', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await i18n.changeLanguage('en');
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const entry = (id: number, extra: Record<string, unknown> = {}) => ({
    id,
    verdict_id: 1000 + id,
    original_label: 'metadata_error',
    new_label: 'verified',
    user: 'lecturer1',
    note: null,
    logged_at: null,
    ...extra,
  });

  it('debounces the username filter (one request after typing stops)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const spy = vi.spyOn(api, 'listAuditLog').mockResolvedValue([]);
    renderWithProviders(<AuditLogPage />);
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    const input = screen.getByLabelText('Filter audit log by username');
    fireEvent.change(input, { target: { value: 'l' } });
    fireEvent.change(input, { target: { value: 'le' } });
    fireEvent.change(input, { target: { value: 'lec' } });
    expect(spy).toHaveBeenCalledTimes(1);
    await act(async () => {
      vi.advanceTimersByTime(350);
    });
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
    expect(spy).toHaveBeenLastCalledWith({ limit: AUDIT_PAGE_SIZE + 1, offset: 0, user: 'lec' });
  });

  it('paginates with limit/offset and Prev/Next buttons', async () => {
    const page1 = Array.from({ length: AUDIT_PAGE_SIZE + 1 }, (_, i) => entry(i + 1));
    const spy = vi
      .spyOn(api, 'listAuditLog')
      .mockImplementation(async ({ offset = 0 } = {}) => (offset === 0 ? page1 : [entry(99)]));
    renderWithProviders(<AuditLogPage />);
    await waitFor(() => expect(screen.getByText('Page 1')).toBeDefined());
    expect((screen.getByTestId('audit-prev-page') as HTMLButtonElement).disabled).toBe(true);
    const next = screen.getByTestId('audit-next-page') as HTMLButtonElement;
    await waitFor(() => expect(next.disabled).toBe(false));
    fireEvent.click(next);
    await waitFor(() => expect(screen.getByText('Page 2')).toBeDefined());
    expect(spy).toHaveBeenLastCalledWith({ limit: AUDIT_PAGE_SIZE + 1, offset: AUDIT_PAGE_SIZE, user: undefined });
    await waitFor(() => expect((screen.getByTestId('audit-next-page') as HTMLButtonElement).disabled).toBe(true));
  });

  it('links the verdict id to the essay report when essay_id is provided', async () => {
    vi.spyOn(api, 'listAuditLog').mockResolvedValue([entry(1, { essay_id: 12 }), entry(2)]);
    renderWithProviders(<AuditLogPage />);
    const link = await screen.findByTestId('audit-verdict-link-1');
    expect(link.getAttribute('href')).toBe('/verification/report/12?citation=1001');
    expect(screen.queryByTestId('audit-verdict-link-2')).toBeNull();
  });
});

describe('SystemHealthPage', () => {
  const health = (over: Partial<SystemHealth> = {}): SystemHealth => ({
    status: 'ok',
    totals: { users: 3, admins: 1, teachers: 1, students: 1, essays: 4, verdicts: 10 },
    verdict_label_counts: { verified: 7, metadata_error: 3 },
    cache_stats: {},
    ...over,
  });

  beforeEach(async () => {
    vi.restoreAllMocks();
    await i18n.changeLanguage('en');
  });

  it('summarizeHealth derives level from status and services', () => {
    expect(summarizeHealth({ status: 'ok' }).level).toBe('healthy');
    expect(summarizeHealth({ status: 'ok', services: { grobid: 'down', db: 'ok' } })).toEqual({
      level: 'degraded',
      degradedServices: ['grobid'],
    });
    expect(summarizeHealth({ status: 'degraded' }).level).toBe('degraded');
    expect(summarizeHealth({ status: 'error' }).level).toBe('down');
  });

  it('pill reflects degraded services instead of a hardcoded healthy label', async () => {
    vi.spyOn(api, 'getSystemHealth').mockResolvedValue(
      health({ services: { grobid: { status: 'down' }, redis: 'ok' } }),
    );
    renderWithProviders(<SystemHealthPage />);
    const pill = await screen.findByTestId('health-status-pill');
    expect(pill.getAttribute('data-level')).toBe('degraded');
    expect(pill.textContent).toContain('DEGRADED: grobid');
    expect(pill.textContent).not.toContain('ALL SERVICES HEALTHY');
  });

  it('healthy status shows the healthy pill', async () => {
    vi.spyOn(api, 'getSystemHealth').mockResolvedValue(health());
    renderWithProviders(<SystemHealthPage />);
    expect((await screen.findByTestId('health-status-pill')).textContent).toContain('ALL SERVICES HEALTHY');
  });

  it('Clear cache asks for confirmation, calls api.clearCache and toasts', async () => {
    vi.spyOn(api, 'getSystemHealth').mockResolvedValue(health({ cache_stats: { total: 42, total_hits: 7 } }));
    const clear = vi.spyOn(api, 'clearCache').mockResolvedValue({ deleted_count: 42 });
    renderWithProviders(<SystemHealthPage />);
    expect((await screen.findByTestId('cache-stats')).textContent).toContain('42');
    fireEvent.click(screen.getByTestId('clear-cache-btn'));
    expect(clear).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByTestId('confirmation-confirm-btn'));
    await waitFor(() => expect(clear).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText('Cache cleared')).toBeDefined());
  });
});
