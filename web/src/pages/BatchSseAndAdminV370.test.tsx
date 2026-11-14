import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Routes, Route, useLocation } from 'react-router-dom';
import {
  api,
  type EssayStatus,
  type SystemHealth,
  type AuditLogEntry,
} from '@/api/client';
import i18n from '@/i18n';
import {
  renderWithProviders,
  makeUser,
  screen,
  fireEvent,
  waitFor,
} from '@/test-utils';
import {
  batchTiming,
  singlePollTiming,
} from '@/contexts/VerificationProgressContext';
import { loadDashboardStats } from '@/hooks/useEssays';
import { AppLayout } from '@/components/AppLayout';
import { BatchUploadPage } from './BatchUploadPage';
import { UploadPage } from './UploadPage';
import { ProcessingPage } from './ProcessingPage';
import { DashboardPage } from './DashboardPage';
import { SystemHealthPage } from './SystemHealthPage';
import { AuditLogPage } from './AuditLogPage';

function makePdf(name: string, sizeKb = 12): File {
  return new File([new Uint8Array(sizeKb * 1024)], name, {
    type: 'application/pdf',
  });
}

function makeStatus(overrides: Partial<EssayStatus> = {}): EssayStatus {
  return {
    status: 'processing',
    queue_position: null,
    step: 'retrieving',
    step_index: 4,
    total_steps: 8,
    message: 'Querying scholarly indexes...',
    citations_found: 12,
    references_found: 10,
    linked: 10,
    sources_queried: { crossref: 'ok', openalex: 'ok' },
    elapsed_seconds: 5.0,
    finished_at: null,
    error: null,
    ...overrides,
  };
}

function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="location-probe">{loc.pathname + loc.search}</div>;
}

describe('v3.70.0 — Batch Lifecycle, SSE Refund/Rate-Limit, Floating Pill, Stats, SystemHealth & AuditLog', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    sessionStorage.clear();
    localStorage.setItem('token', 'v370-test-jwt');
    batchTiming.pollIntervalMs = 0;
    batchTiming.maxAttempts = 150;
    batchTiming.maxQueuedPolls = 900;
    singlePollTiming.pollIntervalMs = 20;
    await i18n.changeLanguage('en');
    vi.spyOn(api, 'listMyClasses').mockResolvedValue([]);
    vi.spyOn(api, 'listEnrolledClasses').mockResolvedValue([]);
    vi.spyOn(api, 'listEssays').mockResolvedValue([]);
  });

  afterEach(() => {
    batchTiming.pollIntervalMs = 2000;
    batchTiming.maxAttempts = 150;
    batchTiming.maxQueuedPolls = 900;
    singlePollTiming.pollIntervalMs = 2000;
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it('BatchUploadPage + VerificationProgressContext: does not prematurely time out while queued (>150 polls), renders diagnostic chips, shows Credit Refunded + mixed-outcome banner, and calls api.reanalyzeEssay on existing essayId retry', async () => {
    const refreshUserSpy = vi.fn().mockResolvedValue(undefined);
    batchTiming.maxAttempts = 8;

    const uploadSpy = vi
      .spyOn(api, 'uploadEssay')
      .mockImplementation(async (file: File) => {
        return {
          essay_id: file.name === 'queued_ocr.pdf' ? 901 : 902,
          filename: file.name,
        } as never;
      });

    let pollsFor901 = 0;
    let reanalyzed902 = false;

    vi.spyOn(api, 'getEssayStatus').mockImplementation(async (essayId: number) => {
      if (essayId === 901) {
        pollsFor901 += 1;
        // Stay in 'queued' for 12 polls (> maxAttempts = 8) to prove queued polls do NOT consume processing timeout
        if (pollsFor901 <= 12) {
          return makeStatus({
            status: 'queued',
            queue_position: 2,
            step_index: 0,
          });
        }
        return makeStatus({
          status: 'completed',
          step: 'completed',
          step_index: 7,
          finished_at: 1762430500,
          document_diagnostics: {
            is_scanned_pdf: true,
            scanned_pages_count: 3,
            total_extractable_chars: 4200,
            avg_chars_per_page: 420,
            ocr_pages_recovered: [1, 3, 5],
            legacy_encoding_detected: 'TCVN3',
          },
        });
      }

      // essayId === 902: fails on initial run with quota_charged: false, succeeds after /reanalyze
      if (!reanalyzed902) {
        return makeStatus({
          status: 'failed',
          step: 'extracting',
          step_index: 2,
          error: 'Temporary GROBID container restart',
          quota_charged: false,
        });
      }
      return makeStatus({
        status: 'completed',
        step: 'completed',
        step_index: 7,
        finished_at: 1762430600,
      });
    });

    const reanalyzeSpy = vi
      .spyOn(api, 'reanalyzeEssay')
      .mockImplementation(async (essayId: number) => {
        if (essayId === 902) {
          reanalyzed902 = true;
        }
        return { essay_id: essayId, status: 'queued' };
      });

    const user = makeUser('user', 'pro');
    const { container } = renderWithProviders(<BatchUploadPage />, {
      user,
      authOverrides: { refreshUser: refreshUserSpy },
    });

    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, {
      target: { files: [makePdf('queued_ocr.pdf'), makePdf('failed_pipeline.pdf')] },
    });
    fireEvent.click(screen.getByRole('button', { name: /start verification/i }));

    // Wait for mixed batch to settle (901 completed after 13 polls > maxAttempts=8; 902 failed with refund)
    const mixedBanner = await screen.findByTestId(
      'batch-mixed-outcome-banner',
      {},
      { timeout: 4000 },
    );
    expect(mixedBanner.textContent).toContain(
      '1 completed, 1 failed (credits automatically refunded)',
    );
    expect(pollsFor901).toBeGreaterThan(12);

    // Refund badge + refreshUser called when quota_charged === false
    expect(screen.getByText('Credit Refunded')).toBeDefined();
    expect(refreshUserSpy).toHaveBeenCalled();

    // OCR & legacy encoding chips rendered on completed row
    expect(screen.getByText(/OCR:\s*3p/)).toBeDefined();
    expect(screen.getByText('TCVN3/VNI -> Unicode')).toBeDefined();

    // Clicking "Retry Failed" calls api.reanalyzeEssay(902) and NEVER re-uploads a duplicate essay
    expect(uploadSpy).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByTestId('batch-retry-failed-btn'));

    await waitFor(
      () => {
        expect(reanalyzeSpy).toHaveBeenCalledWith(902);
        expect(screen.getAllByText('Complete').length).toBe(2);
      },
      { timeout: 4000 },
    );
    expect(uploadSpy).toHaveBeenCalledTimes(2);
  });

  it('UploadPage failed background banner links to /verification/processing/:id with refund pill, and AppLayout renders dismissible floating-verification-pill', async () => {
    const user = makeUser('user', 'pro');

    // Seed an unacknowledged failed single check in sessionStorage
    sessionStorage.setItem(
      `citra_single_check_v1_${user.id}`,
      JSON.stringify({
        essayId: 404,
        filename: 'Broken_Scan.pdf',
        fileSize: 16384,
        classId: null,
        status: 'failed',
        step: 'parsing',
        stepIndex: 0,
        totalSteps: 8,
        progress: 0,
        message: 'Failed',
        queuePosition: null,
        quotaCharged: false,
        error: 'Encrypted PDF requires password',
        startedAt: Date.now(),
        acknowledged: false,
      }),
    );

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ status: 'healthy', parser_mode: 'grobid' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const { unmount } = renderWithProviders(
      <AppLayout>
        <Routes>
          <Route path="/dashboard" element={<div>Dashboard Content</div>} />
          <Route path="/upload" element={<UploadPage />} />
          <Route
            path="/verification/processing/:id"
            element={<div>Processing Recovery View</div>}
          />
        </Routes>
        <LocationProbe />
      </AppLayout>,
      {
        user,
        initialRoute: '/dashboard',
      },
    );

    // 1. On /dashboard, floating-verification-pill shows terminal Failed · Credit Refunded -> Retry
    const pill = await screen.findByTestId('floating-verification-pill');
    expect(pill.textContent).toContain('Broken_Scan.pdf');
    expect(pill.textContent).toContain('Failed · Credit Refunded -> Retry');

    // 2. Navigate to /upload via sidebar -> recent-single-check-banner shows Credit Refunded & links to /verification/processing/404
    fireEvent.click(screen.getByRole('link', { name: /new check/i }));
    const recentBanner = await screen.findByTestId('recent-single-check-banner');
    expect(screen.getByTestId('recent-single-refund-badge').textContent).toBe(
      'Credit Refunded',
    );
    const retryLink = recentBanner.querySelector('a');
    expect(retryLink?.getAttribute('href')).toBe('/verification/processing/404');
    expect(retryLink?.textContent).toContain('View Error & Retry');

    // 3. Dismiss floating pill via × button -> clears both pill and recent banner
    fireEvent.click(screen.getByTestId('floating-verification-pill-dismiss'));
    await waitFor(() => {
      expect(screen.queryByTestId('floating-verification-pill')).toBeNull();
      expect(screen.queryByTestId('recent-single-check-banner')).toBeNull();
    });
    unmount();
  });

  it('ProcessingPage calls refreshUser() once on live SSE failure with quota_charged=false and renders amber Rate-Limited source badge', async () => {
    const refreshUserSpy = vi.fn().mockResolvedValue(undefined);
    const encoder = new TextEncoder();

    let streamController!: ReadableStreamDefaultController<Uint8Array>;
    const sseStream = new ReadableStream<Uint8Array>({
      start(controller) {
        streamController = controller;
        controller.enqueue(
          encoder.encode(
            `event: step\ndata: ${JSON.stringify(
              makeStatus({
                status: 'processing',
                step: 'retrieving',
                step_index: 4,
                sources_queried: {
                  crossref: 'ok',
                  semanticscholar: 'rate_limited',
                },
              }),
            )}\n\n`,
          ),
        );
      },
    });

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      if (url.endsWith('/essays/612/events')) {
        return new Response(sseStream, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        });
      }
      return new Response('Not mocked', { status: 500 });
    });
    vi.spyOn(api, 'getEssay').mockResolvedValue({
      essay_id: 612,
      filename: 'rate_limited_test.pdf',
    } as never);

    renderWithProviders(
      <Routes>
        <Route path="/verification/processing/:id" element={<ProcessingPage />} />
      </Routes>,
      {
        user: makeUser('user', 'pro'),
        initialRoute: '/verification/processing/612',
        authOverrides: { refreshUser: refreshUserSpy },
      },
    );

    // Verify Step 5 renders distinct amber Rate-Limited badge
    const rateLimitedBadge = await screen.findByTestId(
      'live-source-rate-limited-semanticscholar',
    );
    expect(rateLimitedBadge.textContent).toBe('Rate-Limited');
    expect(refreshUserSpy).not.toHaveBeenCalled();

    // Push terminal SSE failed frame with quota_charged: false
    streamController.enqueue(
      encoder.encode(
        `event: failed\ndata: ${JSON.stringify(
          makeStatus({
            status: 'failed',
            step: 'retrieving',
            step_index: 4,
            error: 'Upstream scholarly workers unavailable',
            quota_charged: false,
            finished_at: 1762430900,
          }),
        )}\n\n`,
      ),
    );
    streamController.close();

    await screen.findByTestId('failed-pipeline-alert');
    await waitFor(() => {
      expect(refreshUserSpy).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByTestId('quota-refund-badge')).toBeDefined();
  });

  it('SystemHealthPage separates Dynamic Citation Cache (0 after clear) from Static Local Corpus (128,000), surfaces B1 session telemetry, and resets OPEN circuit breakers', async () => {
    const initialHealth: SystemHealth = {
      status: 'ok',
      totals: { users: 8, admins: 1, teachers: 2, students: 5, essays: 30, verdicts: 240 },
      verdict_label_counts: { verified: 200, metadata_error: 40 },
      cache_stats: {
        total: 128450,
        persistent_entries: 450,
        persistent_hits: 920,
        expired_entries: 5,
        local_papers_count: 128000,
        local_hits_count: 340,
        session_hits: 78,
        session_misses: 22,
        session_hit_rate_percent: 78.0,
        wave0_entries: 34,
        singleflight_coalesced: 19,
        negative_cache_entries: 11,
        by_source: { crossref: 300, openalex: 150 },
      },
      upstream_sources: {
        crossref: {
          state: 'open',
          consecutive_failures: 5,
          total_calls: 40,
          success_count: 25,
          timeout_count: 10,
          http_429_count: 5,
          http_5xx_count: 0,
          ema_latency_ms: 890,
          open_remaining_seconds: 42,
        },
        openalex: {
          state: 'closed',
          consecutive_failures: 0,
          total_calls: 60,
          success_count: 60,
          timeout_count: 0,
          http_429_count: 0,
          http_5xx_count: 0,
          ema_latency_ms: 120,
          open_remaining_seconds: 0,
        },
      },
    };

    const clearedAndResetHealth: SystemHealth = {
      ...initialHealth,
      cache_stats: {
        ...initialHealth.cache_stats,
        total: 128000,
        persistent_entries: 0,
        persistent_hits: 0,
        expired_entries: 0,
        local_papers_count: 128000,
        local_hits_count: 340,
        by_source: {},
      },
      upstream_sources: {
        ...initialHealth.upstream_sources,
        crossref: {
          ...initialHealth.upstream_sources!.crossref,
          state: 'closed',
          consecutive_failures: 0,
          open_remaining_seconds: 0,
        },
      },
    };

    let currentPayload = initialHealth;
    vi.spyOn(api, 'getSystemHealth').mockImplementation(async () => currentPayload);
    const clearSpy = vi.spyOn(api, 'clearCache').mockImplementation(async () => {
      currentPayload = {
        ...currentPayload,
        cache_stats: clearedAndResetHealth.cache_stats,
      };
      return { deleted_count: 450 };
    });
    const resetBreakerSpy = vi
      .spyOn(api, 'resetCircuitBreaker')
      .mockImplementation(async () => {
        currentPayload = clearedAndResetHealth;
        return { status: 'ok', reset_sources: ['crossref'] };
      });

    renderWithProviders(<SystemHealthPage />, { user: makeUser('admin') });

    // Dynamic cache shows 450 & 920 hits; Static Local Corpus shows 128,000; conflated 128450 is NOT shown
    expect(
      (await screen.findByTestId('dynamic-cache-entries-value')).textContent,
    ).toBe('450');
    expect(screen.getByTestId('static-local-corpus-value').textContent).toBe(
      '128,000',
    );
    expect(screen.getByTestId('cache-stats').textContent).not.toContain('128450');

    // B1 in-memory session cache strip surfaced
    expect(screen.getByTestId('b1-session-hit-rate').textContent).toContain('78%');
    expect(screen.getByTestId('b1-wave0-entries').textContent).toContain('34');
    expect(screen.getByTestId('b1-singleflight-coalesced').textContent).toContain(
      '19',
    );
    expect(screen.getByTestId('b1-negative-entries').textContent).toContain('11');

    // Clear Cache drops Dynamic Citation Cache to 0 (and persistent hits to 0, never local_hits_count=340!) while Static Local Corpus stays 128,000
    fireEvent.click(screen.getByTestId('clear-cache-btn'));
    fireEvent.click(await screen.findByTestId('confirmation-confirm-btn'));
    await waitFor(() => {
      expect(clearSpy).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId('dynamic-cache-entries-value').textContent).toBe('0');
    });
    expect(screen.getByTestId('dynamic-citation-cache-card').textContent).toContain(
      '0 persistent hits',
    );
    expect(screen.getByTestId('static-local-corpus-value').textContent).toBe(
      '128,000',
    );

    // Reset OPEN crossref breaker calls api.resetCircuitBreaker('crossref') and refreshes state to CLOSED
    fireEvent.click(screen.getByTestId('reset-breaker-crossref'));
    await waitFor(() => {
      expect(resetBreakerSpy).toHaveBeenCalledWith('crossref');
      expect(
        screen.getByTestId('circuit-badge-crossref').getAttribute('data-state'),
      ).toBe('closed');
    });
  });

  it('AuditLogPage fetches true total_events (142) from api.getAuditStats, shows 25 / PAGE, and useDashboardStats excludes resource from verified_rate + surfaces Incomplete Ref', async () => {
    const entries: AuditLogEntry[] = Array.from({ length: 25 }, (_, i) => ({
      id: i + 1,
      verdict_id: i + 1,
      essay_id: 100,
      original_label: 'unresolved',
      new_label: 'verified',
      user: i % 2 === 0 ? 'lecturer_a' : 'admin_b',
      note: 'Verified manually',
      logged_at: '2026-11-14T08:00:00Z',
    }));

    vi.spyOn(api, 'listAuditLog').mockResolvedValue(entries);
    const auditStatsSpy = vi.spyOn(api, 'getAuditStats').mockResolvedValue({
      total_events: 142,
      unique_actors: 9,
    });

    const { unmount } = renderWithProviders(<AuditLogPage />, {
      user: makeUser('admin'),
    });

    await waitFor(() => {
      expect(screen.getByTestId('audit-total-events').textContent).toBe('142');
    });
    expect(screen.getByTestId('audit-unique-actors').textContent).toBe('9');
    expect(screen.getByTestId('audit-page-size').textContent).toBe('25 / PAGE');
    expect(auditStatsSpy).toHaveBeenCalledWith(undefined);
    unmount();

    // Verify scholarly verified_rate excludes non-scholarly 'resource' URLs and surfaces Incomplete Ref chip
    vi.spyOn(api, 'listEssays').mockResolvedValue([
      {
        id: 11,
        filename: 'thesis_with_urls.pdf',
        num_pages: 20,
        uploaded_at: '2026-11-14T09:00:00Z',
        user_id: 10,
        cis_score: 94,
        num_citations: 100,
        num_verdicts: 100,
        num_verified: 80,
      },
    ]);
    const statsSpy = vi.spyOn(api, 'getEssayStats').mockResolvedValue({
      total_essays: 1,
      total_citations: 100,
      verified: 80,
      metadata_error: 0,
      suspected_hallucination: 0,
      unresolved: 0,
      resource: 20,
      incomplete_metadata: 0,
    });

    const computed = await loadDashboardStats([
      {
        id: 11,
        filename: 'thesis_with_urls.pdf',
        num_pages: 20,
        uploaded_at: '2026-11-14T09:00:00Z',
        user_id: 10,
        cis_score: 94,
      },
    ]);
    // 80 verified out of 80 scholarly citations (20 resource excluded) = 100%
    expect(computed.verified_rate).toBe(100);

    statsSpy.mockResolvedValue({
      total_essays: 1,
      total_citations: 104,
      verified: 80,
      metadata_error: 0,
      suspected_hallucination: 0,
      unresolved: 0,
      resource: 20,
      incomplete_metadata: 4,
    });

    renderWithProviders(<DashboardPage />, { user: makeUser('teacher', 'pro') });
    const chip = await screen.findByTestId('dashboard-incomplete-ref-chip');
    expect(chip.textContent).toContain('4 Incomplete Ref');
  });
});
