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
import { UploadPage } from './UploadPage';
import { HistoryPage } from './HistoryPage';
import { DashboardPage } from './DashboardPage';
import { EssayHeader } from './essay/EssayHeader';

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

  it('renders human-readable bilingual cache_stats labels and localized verdict record count in VI', async () => {
    await i18n.changeLanguage('vi');
    vi.spyOn(api, 'getSystemHealth').mockResolvedValue(
      health({
        cache_stats: {
          total: 120,
          total_hits: 350,
          avg_hit_count: 2.92,
          local_papers_count: 128000,
          local_queries_count: 45,
          local_hit_rate_percent: 87.5,
        },
      }),
    );
    renderWithProviders(<SystemHealthPage />);
    const statsPanel = await screen.findByTestId('cache-stats');
    expect(statsPanel.textContent).toContain('Tổng lượt trúng đệm');
    expect(statsPanel.textContent).toContain('Trung bình trúng / mục');
    expect(statsPanel.textContent).toContain('Bài báo kho cục bộ');
    expect(statsPanel.textContent).not.toContain('total_hits');
    expect(statsPanel.textContent).not.toContain('avg_hit_count');
    expect(statsPanel.textContent).not.toContain('local_papers_count');
    expect(screen.getByText('10 bản ghi tổng cộng')).toBeDefined();
  });

  it('renders per-provider circuit breaker states, cooldown, EMA latency, HTTP 429, timeout/5xx, and persistent cache telemetry in EN', async () => {
    vi.spyOn(api, 'getSystemHealth').mockResolvedValue(
      health({
        cache_stats: {
          total: 128145,
          total_hits: 410,
          avg_hit_count: 3.1,
          local_papers_count: 128000,
          local_queries_count: 50,
          local_hit_rate_percent: 88.2,
          by_source: { openalex: 95, crossref: 50, arxiv: 0 },
        },
        upstream_sources: {
          openalex: {
            state: 'closed',
            consecutive_failures: 0,
            total_calls: 120,
            success_count: 118,
            timeout_count: 1,
            http_429_count: 0,
            http_5xx_count: 1,
            ema_latency_ms: 142.5,
            open_remaining_seconds: 0,
          },
          crossref: {
            state: 'open',
            consecutive_failures: 4,
            total_calls: 45,
            success_count: 38,
            timeout_count: 2,
            http_429_count: 5,
            http_5xx_count: 1,
            ema_latency_ms: 860.2,
            open_remaining_seconds: 32.5,
          },
          semanticscholar: {
            state: 'half_open',
            consecutive_failures: 4,
            total_calls: 20,
            success_count: 15,
            timeout_count: 3,
            http_429_count: 2,
            http_5xx_count: 0,
            ema_latency_ms: 512,
            open_remaining_seconds: 0,
          },
        },
      }),
    );

    renderWithProviders(<SystemHealthPage />);

    const panel = await screen.findByTestId('upstream-sources-panel');
    expect(panel.textContent).toContain('Scholarly Upstream Providers & Circuit Breakers');
    const table = screen.getByTestId('upstream-circuit-table');
    expect(table).toBeDefined();

    const openalexBadge = screen.getByTestId('circuit-badge-openalex');
    expect(openalexBadge.getAttribute('data-state')).toBe('closed');
    expect(openalexBadge.textContent).toContain('CLOSED');

    const crossrefBadge = screen.getByTestId('circuit-badge-crossref');
    expect(crossrefBadge.getAttribute('data-state')).toBe('open');
    expect(crossrefBadge.textContent).toContain('OPEN');
    expect(screen.getByTestId('circuit-cooldown-crossref').textContent).toContain('32.5s');

    const s2Badge = screen.getByTestId('circuit-badge-semanticscholar');
    expect(s2Badge.getAttribute('data-state')).toBe('half_open');
    expect(s2Badge.textContent).toContain('HALF_OPEN');

    const openalexRow = screen.getByTestId('upstream-row-openalex');
    expect(openalexRow.textContent).toContain('OpenAlex');
    expect(openalexRow.textContent).toContain('142.5 ms');
    expect(openalexRow.textContent).toContain('118 / 120');

    const crossrefRow = screen.getByTestId('upstream-row-crossref');
    expect(crossrefRow.textContent).toContain('Crossref');
    expect(crossrefRow.textContent).toContain('860.2 ms');
    expect(crossrefRow.textContent).toContain('38 / 45');
    expect(screen.getByTestId('upstream-429-crossref').textContent).toContain('5');
    expect(crossrefRow.textContent).toContain('Timeouts: 2');
    expect(crossrefRow.textContent).toContain('5xx: 1');

    const s2Row = screen.getByTestId('upstream-row-semanticscholar');
    expect(s2Row.textContent).toContain('Semantic Scholar');
    expect(s2Row.textContent).toContain('512 ms');
    expect(s2Row.textContent).toContain('15 / 20');

    expect(screen.getByTestId('health-status-pill').textContent).toContain('ALL SERVICES HEALTHY');

    const cacheStats = screen.getByTestId('cache-stats');
    expect(cacheStats.textContent).toContain('Persistent SQLite Entries');
    expect(cacheStats.textContent).toContain('145');
    expect(cacheStats.textContent).toContain('Persistent SQLite Hits');
    expect(cacheStats.textContent).toContain('360');
    expect(cacheStats.textContent).toContain('OpenAlex');
    expect(cacheStats.textContent).toContain('95');
  });

  it('localizes upstream circuit breaker table, cooldown, and persistent cache breakdown in VI', async () => {
    await i18n.changeLanguage('vi');
    vi.spyOn(api, 'getSystemHealth').mockResolvedValue(
      health({
        cache_stats: {
          total: 128040,
          total_hits: 125,
          local_papers_count: 128000,
          local_queries_count: 25,
          by_source: { openalex: 28, ncbi_biorxiv: 12 },
        },
        upstream_sources: {
          openalex: {
            state: 'closed',
            consecutive_failures: 0,
            total_calls: 30,
            success_count: 30,
            timeout_count: 0,
            http_429_count: 0,
            http_5xx_count: 0,
            ema_latency_ms: 95,
            open_remaining_seconds: 0,
          },
          crossref: {
            state: 'open',
            consecutive_failures: 5,
            total_calls: 12,
            success_count: 7,
            timeout_count: 3,
            http_429_count: 2,
            http_5xx_count: 0,
            ema_latency_ms: 910.4,
            open_remaining_seconds: 18.4,
          },
          arxiv: {
            state: 'half_open',
            consecutive_failures: 4,
            total_calls: 9,
            success_count: 5,
            timeout_count: 2,
            http_429_count: 1,
            http_5xx_count: 1,
            ema_latency_ms: 420,
            open_remaining_seconds: 0,
          },
        },
      }),
    );

    renderWithProviders(<SystemHealthPage />);

    const panel = await screen.findByTestId('upstream-sources-panel');
    expect(panel.textContent).toContain('Nguồn Học Thuật & Ngắt Mạch Tự Động');
    expect(panel.textContent).toContain('Ổn định');
    expect(panel.textContent).toContain('Ngắt mạch');
    expect(panel.textContent).toContain('Thăm dò');
    expect(screen.getByTestId('circuit-cooldown-crossref').textContent).toContain('18.4s');

    const cacheStats = screen.getByTestId('cache-stats');
    expect(cacheStats.textContent).toContain('Mục lưu đệm SQLite bền vững');
    expect(cacheStats.textContent).toContain('40');
    expect(cacheStats.textContent).toContain('Lượt trúng đệm SQLite bền vững');
    expect(cacheStats.textContent).toContain('100');
    expect(cacheStats.textContent).toContain('NCBI / bioRxiv');
    expect(cacheStats.textContent).not.toContain('ncbi_biorxiv');
  });

  it('handles absent or empty upstream_sources gracefully without rendering the circuit table', async () => {
    vi.spyOn(api, 'getSystemHealth').mockResolvedValue(health({ upstream_sources: {} }));
    const { unmount } = renderWithProviders(<SystemHealthPage />);
    expect(await screen.findByTestId('upstream-sources-empty')).toBeDefined();
    expect(screen.queryByTestId('upstream-circuit-table')).toBeNull();
    unmount();

    vi.spyOn(api, 'getSystemHealth').mockResolvedValue(health());
    renderWithProviders(<SystemHealthPage />);
    expect(await screen.findByTestId('upstream-sources-empty')).toBeDefined();
    expect(screen.queryByTestId('upstream-circuit-table')).toBeNull();
  });

  it('maps url_check, clean_miss, and wikidata_opencitatio labels bilingually and suppresses sub-0.05s 0s cooldown pills', async () => {
    const payload = health({
      cache_stats: {
        total: 30,
        total_hits: 90,
        by_source: {
          url_check: 14,
          clean_miss: 9,
          wikidata_opencitatio: 7,
        },
      },
      upstream_sources: {
        crossref: {
          state: 'open',
          consecutive_failures: 4,
          total_calls: 10,
          success_count: 6,
          timeout_count: 2,
          http_429_count: 2,
          http_5xx_count: 0,
          ema_latency_ms: 400,
          open_remaining_seconds: 0.03,
        },
        openalex: {
          state: 'open',
          consecutive_failures: 4,
          total_calls: 10,
          success_count: 6,
          timeout_count: 2,
          http_429_count: 2,
          http_5xx_count: 0,
          ema_latency_ms: 410,
          open_remaining_seconds: 0.08,
        },
      },
    });

    vi.spyOn(api, 'getSystemHealth').mockResolvedValue(payload);
    const { unmount } = renderWithProviders(<SystemHealthPage />);
    const enStats = await screen.findByTestId('cache-stats');
    expect(enStats.textContent).toContain('URL Check');
    expect(enStats.textContent).toContain('Verified Clean Miss');
    expect(enStats.textContent).toContain('Wikidata / OpenCitations');
    expect(screen.queryByTestId('circuit-cooldown-crossref')).toBeNull();
    expect(screen.getByTestId('circuit-cooldown-openalex').textContent).toContain('0.1s');
    unmount();

    await i18n.changeLanguage('vi');
    vi.spyOn(api, 'getSystemHealth').mockResolvedValue(payload);
    renderWithProviders(<SystemHealthPage />);
    const viStats = await screen.findByTestId('cache-stats');
    expect(viStats.textContent).toContain('Kiểm chứng URL');
    expect(viStats.textContent).toContain('Không có bản ghi (Đã xác thực)');
    expect(viStats.textContent).toContain('Wikidata / OpenCitations');
  });
});

describe('Multi-format & Telemetry Accuracy (BUG-03 & BUG-09)', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await i18n.changeLanguage('en');
  });

  it('UploadPage shows KB size, accurate BIBTEX parser badge, regex fallback status, and VI plan badge', async () => {
    await i18n.changeLanguage('vi');
    vi.spyOn(api, 'listEnrolledClasses').mockResolvedValue([]);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          status: 'healthy',
          grobid: { status: 'unhealthy', available: false, container_running: false },
          parser_mode: 'regex',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const { container } = renderWithProviders(<UploadPage />, {
      user: makeUser('teacher', 'pro'),
    });

    await waitFor(() => {
      expect(screen.getByTestId('upload-parser-status').textContent).toContain(
        'BỘ PHÂN TÍCH REGEX SẴN SÀNG',
      );
    });
    expect(screen.getByTestId('upload-quota-banner').textContent).toContain('GÓI PRO');

    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const smallBib = new File(['@article{vaswani2017, title={Attention}}'.repeat(30)], 'sample.bib', {
      type: 'application/x-bibtex',
    });
    fireEvent.change(input, { target: { files: [smallBib] } });

    await waitFor(() => {
      expect(screen.getByText('sample.bib')).toBeDefined();
    });
    expect(container.textContent).toContain('KB');
    expect(container.textContent).not.toContain('0.00 MB');
    expect(container.textContent).toContain('BIBTEX PARSER');
    expect(container.textContent).not.toContain('GROBID / XML');
  });

  it('HistoryPage and DashboardPage label .bib and .ris accurately instead of GROBID TEI, and singularize 1 page', async () => {
    const multiFormatEssays = [
      {
        id: 101,
        filename: 'references.bib',
        num_pages: 1,
        uploaded_at: '2026-11-11T00:00:00Z',
        user_id: 1,
        cis_score: 95,
        num_citations: 4,
        num_verdicts: 4,
        num_verified: 4,
      },
      {
        id: 102,
        filename: 'library.ris',
        num_pages: 2,
        uploaded_at: '2026-11-11T00:00:00Z',
        user_id: 1,
        cis_score: 88,
        num_citations: 6,
        num_verdicts: 6,
        num_verified: 5,
      },
    ];
    vi.spyOn(api, 'listEssays').mockResolvedValue(multiFormatEssays);
    vi.spyOn(api, 'getEssayStats').mockRejectedValue(new Error('API 404'));

    const { container: historyContainer, unmount } = renderWithProviders(<HistoryPage />, {
      user: makeUser('teacher', 'pro'),
    });
    await waitFor(() => expect(screen.getByText('references.bib')).toBeDefined());
    expect(historyContainer.textContent).toContain('BIBTEX · .BIB');
    expect(historyContainer.textContent).toContain('RIS · BIBLIOGRAPHY');
    expect(historyContainer.textContent).not.toContain('GROBID TEI');
    expect(historyContainer.textContent).toContain('1 page');
    expect(historyContainer.textContent).not.toContain('1 pages');
    unmount();

    const { container: dashContainer } = renderWithProviders(<DashboardPage />, {
      user: makeUser('teacher', 'pro'),
    });
    await waitFor(() => expect(screen.getByText('references.bib')).toBeDefined());
    expect(dashContainer.textContent).toContain('BIBTEX · .BIB');
    expect(dashContainer.textContent).toContain('RIS · BIBLIOGRAPHY');
  });

  it('EssayHeader omits raw UNKNOWN style badge and singularizes 1 page and 1 citation', () => {
    const { container } = renderWithProviders(
      <EssayHeader
        essayId={55}
        filename="sample.bib"
        numPages={1}
        numCitations={1}
        styleName="UNKNOWN"
      />,
      { user: makeUser('user', 'pro') },
    );
    expect(container.textContent).not.toContain('UNKNOWN');
    expect(container.textContent).toContain('1 page');
    expect(container.textContent).not.toContain('1 pages');
    expect(container.textContent).toContain('1 citation');
    expect(container.textContent).not.toContain('1 citations');
  });
});
