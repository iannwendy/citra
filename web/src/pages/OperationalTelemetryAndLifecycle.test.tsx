import { useEffect } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { Routes, Route, useLocation } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import {
  api,
  type EssayStatus,
  type EssaySummary,
  type SystemHealth,
  type User,
} from '@/api/client';
import i18n from '@/i18n';
import {
  createTestQueryClient,
  renderWithProviders,
  makeUser,
  screen,
  fireEvent,
  waitFor,
} from '@/test-utils';
import { makeReport } from '@/test-fixtures';
import { useVerificationProgress } from '@/contexts/VerificationProgressContext';
import { AppLayout } from '@/components/AppLayout';
import { useEssayReport } from '@/hooks/useEssayReport';
import { useOrphanReport } from '@/hooks/useOrphanReport';
import { ProcessingPage } from './ProcessingPage';
import { SystemHealthPage } from './SystemHealthPage';
import { DashboardPage } from './DashboardPage';
import { HistoryPage } from './HistoryPage';
import { AccountManagementPage } from './AccountManagementPage';

function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="location-probe">{loc.pathname + loc.search}</div>;
}

describe('ProcessingPage failed-job UX, queued step state, & live SSE telemetry', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    sessionStorage.clear();
    await i18n.changeLanguage('en');
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('never redirects or renders green completion state on failed job, marks failing step error, shows refund badge, and navigates via recovery actions', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });

    const failedSnap: EssayStatus = {
      status: 'failed',
      queue_position: null,
      step: 'extracting',
      step_index: 2,
      total_steps: 8,
      message: 'Extraction crashed',
      citations_found: 14,
      references_found: 0,
      linked: 0,
      sources_queried: {},
      elapsed_seconds: 6.4,
      finished_at: 1730000010,
      error: 'GROBID worker crashed on malformed xref stream',
      quota_charged: false,
    };

    vi.spyOn(api, 'getEssayStatus').mockResolvedValue(failedSnap);

    renderWithProviders(
      <>
        <Routes>
          <Route path="/verification/processing/:id" element={<ProcessingPage />} />
          <Route path="/verification/report/:id" element={<div>Report Route</div>} />
          <Route path="/upload" element={<div>Upload Route</div>} />
          <Route path="/history" element={<div>History Route</div>} />
        </Routes>
        <LocationProbe />
      </>,
      {
        user: makeUser('user'),
        initialRoute: '/verification/processing/501',
      },
    );

    const alert = await screen.findByTestId('failed-pipeline-alert');
    expect(alert.textContent).toContain('GROBID worker crashed on malformed xref stream');

    // Advance well past the 3s auto-redirect window to prove failed jobs stay on ProcessingPage
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(screen.getByTestId('location-probe').textContent).toBe('/verification/processing/501');

    // Never renders false green completion banner or Open Report button
    expect(screen.queryByText(/Analysis Complete! Redirecting/i)).toBeNull();
    expect(screen.queryByText('Open Report')).toBeNull();

    // Steps < 2 are completed, Step 3 (index 2) is error with Failed badge, Steps > 2 are pending
    expect(screen.getByTestId('pipeline-step-1').getAttribute('data-step-status')).toBe('completed');
    expect(screen.getByTestId('pipeline-step-2').getAttribute('data-step-status')).toBe('completed');
    expect(screen.getByTestId('pipeline-step-3').getAttribute('data-step-status')).toBe('error');
    expect(screen.getByTestId('pipeline-step-error-badge-3').textContent).toBe('Failed');
    for (let stepNum = 4; stepNum <= 8; stepNum += 1) {
      expect(screen.getByTestId(`pipeline-step-${stepNum}`).getAttribute('data-step-status')).toBe(
        'pending',
      );
    }

    // Credit refund reassurance badge
    expect(screen.getByTestId('quota-refund-badge').textContent).toContain(
      'Your monthly upload credit was automatically refunded',
    );

    // Action buttons navigate cleanly
    const uploadBtn = screen.getByTestId('failed-upload-another-btn');
    expect(uploadBtn.textContent).toContain('Upload Another Document');
    const historyBtn = screen.getByTestId('failed-back-history-btn');
    expect(historyBtn.textContent).toContain('Back to History');

    fireEvent.click(historyBtn);
    expect(screen.getByTestId('location-probe').textContent).toBe('/history');
  });

  it('renders Vietnamese failed-job refund reassurance, Lỗi step badge, and recovery buttons', async () => {
    await i18n.changeLanguage('vi');

    vi.spyOn(api, 'getEssayStatus').mockResolvedValue({
      status: 'failed',
      queue_position: null,
      step: 'parsing',
      step_index: 0,
      total_steps: 8,
      message: 'Lỗi đọc PDF',
      citations_found: 0,
      references_found: 0,
      linked: 0,
      sources_queried: {},
      elapsed_seconds: 1.2,
      finished_at: 1730000020,
      error: 'Tệp PDF bị hỏng cấu trúc trang',
      quota_charged: false,
    });

    renderWithProviders(
      <>
        <Routes>
          <Route path="/verification/processing/:id" element={<ProcessingPage />} />
          <Route path="/upload" element={<div>Upload VI</div>} />
        </Routes>
        <LocationProbe />
      </>,
      {
        user: makeUser('user'),
        initialRoute: '/verification/processing/502',
      },
    );

    await screen.findByTestId('failed-pipeline-alert');
    expect(screen.getByTestId('pipeline-step-1').getAttribute('data-step-status')).toBe('error');
    expect(screen.getByTestId('pipeline-step-error-badge-1').textContent).toBe('Lỗi');
    expect(screen.getByTestId('quota-refund-badge').textContent).toContain(
      'Lượt tải lên trong tháng của bạn đã được hoàn lại (không trừ hạn ngạch)',
    );
    expect(screen.getByTestId('failed-upload-another-btn').textContent).toContain(
      'Tải lại tài liệu khác',
    );
    expect(screen.getByTestId('failed-back-history-btn').textContent).toContain(
      'Về Lịch sử kiểm tra',
    );

    fireEvent.click(screen.getByTestId('failed-upload-another-btn'));
    expect(screen.getByTestId('location-probe').textContent).toBe('/upload');
  });

  it('keeps Step 01 pending while status is queued instead of spinning active prematurely', async () => {
    vi.spyOn(api, 'getEssayStatus').mockResolvedValue({
      status: 'queued',
      queue_position: 3,
      step: 'parsing',
      step_index: 0,
      total_steps: 8,
      message: 'Waiting in FIFO queue (#3)',
      citations_found: 0,
      references_found: 0,
      linked: 0,
      sources_queried: {},
      elapsed_seconds: 2.0,
      finished_at: null,
      error: null,
    });

    renderWithProviders(
      <Routes>
        <Route path="/verification/processing/:id" element={<ProcessingPage />} />
      </Routes>,
      {
        user: makeUser('user'),
        initialRoute: '/verification/processing/503',
      },
    );

    await screen.findByTestId('queued-processing-banner');
    for (let stepNum = 1; stepNum <= 8; stepNum += 1) {
      expect(screen.getByTestId(`pipeline-step-${stepNum}`).getAttribute('data-step-status')).toBe(
        'pending',
      );
    }
  });

  it('renders live federated sources_queried pills and early document_diagnostics banners (scanned PDF, legacy TCVN3/VNI encoding, OCR recovery)', async () => {
    vi.spyOn(api, 'getEssayStatus').mockResolvedValue({
      status: 'processing',
      queue_position: null,
      step: 'retrieving',
      step_index: 4,
      total_steps: 8,
      message: 'Querying scholarly indexes',
      citations_found: 24,
      references_found: 18,
      linked: 17,
      sources_queried: {
        crossref: 'ok',
        openalex: 'ok',
        arxiv: 'pending',
        vn_legal_registry: 'failed:timeout',
      },
      elapsed_seconds: 12.5,
      finished_at: null,
      error: null,
      document_diagnostics: {
        is_scanned_pdf: true,
        scanned_pages_count: 5,
        total_extractable_chars: 180,
        avg_chars_per_page: 36,
        legacy_encoding_detected: 'TCVN3',
        legacy_encoding_pages_count: 4,
        ocr_pages_recovered: [1, 2, 4],
      },
    });

    renderWithProviders(
      <Routes>
        <Route path="/verification/processing/:id" element={<ProcessingPage />} />
      </Routes>,
      {
        user: makeUser('user'),
        initialRoute: '/verification/processing/504',
      },
    );

    const sourcesBar = await screen.findByTestId('live-sources-queried');
    expect(sourcesBar.textContent).toContain('Crossref');
    expect(sourcesBar.textContent).toContain('OpenAlex');
    expect(sourcesBar.textContent).toContain('arXiv');
    expect(sourcesBar.textContent).toContain('VN Legal Registry');
    expect(screen.getByTestId('live-source-pill-crossref')).toBeDefined();
    expect(screen.getByTestId('live-source-pill-vn_legal_registry')).toBeDefined();

    expect(screen.getByTestId('scanned-pdf-processing-banner')).toBeDefined();
    expect(screen.getByTestId('legacy-encoding-processing-banner').textContent).toContain('TCVN3');
    expect(screen.getByTestId('legacy-encoding-processing-banner').textContent).toContain(
      'Unicode NFC',
    );
    expect(screen.getByTestId('ocr-recovered-processing-banner').textContent).toContain(
      '3 pages (p.1, p.2, p.4)',
    );
  });
});

describe('AppLayout active queue position badge', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    sessionStorage.clear();
    await i18n.changeLanguage('en');
  });

  function SeedQueuedCheck() {
    const { syncSingleCheckFromStatus } = useVerificationProgress();
    useEffect(() => {
      const id = setTimeout(() => {
        syncSingleCheckFromStatus(
          610,
          {
            status: 'queued',
            queue_position: 3,
            step: 'parsing',
            step_index: 0,
            total_steps: 8,
            message: 'Queued #3',
            citations_found: 0,
            references_found: 0,
            linked: 0,
            sources_queried: {},
            elapsed_seconds: 1.0,
            finished_at: null,
            error: null,
          },
          'queued_manuscript.pdf',
        );
      }, 0);
      return () => clearTimeout(id);
    }, [syncSingleCheckFromStatus]);
    return <div>Dashboard Workspace</div>;
  }

  it('includes #queuePosition in sidebar and mobile progress badges in EN and VI', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('No SSE in test', { status: 502 }));
    vi.spyOn(api, 'getEssayStatus').mockResolvedValue({
      status: 'queued',
      queue_position: 3,
      step: 'parsing',
      step_index: 0,
      total_steps: 8,
      message: 'Queued #3',
      citations_found: 0,
      references_found: 0,
      linked: 0,
      sources_queried: {},
      elapsed_seconds: 1.5,
      finished_at: null,
      error: null,
    });

    const { unmount } = renderWithProviders(
      <AppLayout>
        <SeedQueuedCheck />
      </AppLayout>,
      {
        user: makeUser('user'),
        initialRoute: '/dashboard',
      },
    );

    await waitFor(() => {
      expect(screen.getByTestId('sidebar-single-progress-badge').textContent).toContain('Queued #3');
    });
    expect(screen.getByTestId('mobile-active-progress-pill').textContent).toContain('Queued #3');
    unmount();

    sessionStorage.clear();
    await i18n.changeLanguage('vi');
    renderWithProviders(
      <AppLayout>
        <SeedQueuedCheck />
      </AppLayout>,
      {
        user: makeUser('user'),
        initialRoute: '/dashboard',
      },
    );

    await waitFor(() => {
      expect(screen.getByTestId('sidebar-single-progress-badge').textContent).toContain(
        'Hàng đợi #3',
      );
    });
    expect(screen.getByTestId('mobile-active-progress-pill').textContent).toContain('Hàng đợi #3');
  });
});

describe('useEssayReport & useOrphanReport universal SSE streaming + fallback polling', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.setItem('token', 'sse-test-jwt');
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('useEssayReport streams SSE when getEssay returns null (425), refetches on completed with zero status polls', async () => {
    const completedReport = makeReport({ essay_id: 701, filename: 'sse_report.pdf' });
    const getEssaySpy = vi
      .spyOn(api, 'getEssay')
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(completedReport);
    const getStatusSpy = vi.spyOn(api, 'getEssayStatus');

    const encoder = new TextEncoder();
    const sseStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              status: 'processing',
              step: 'comparing',
              step_index: 5,
              total_steps: 8,
              message: 'Comparing metadata',
              citations_found: 8,
              references_found: 8,
              linked: 8,
              sources_queried: { crossref: 'ok' },
              elapsed_seconds: 3.1,
              finished_at: null,
              error: null,
            })}\n\n`,
          ),
        );
        setTimeout(() => {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                status: 'completed',
                step: 'completed',
                step_index: 7,
                total_steps: 8,
                message: 'Completed',
                citations_found: 8,
                references_found: 8,
                linked: 8,
                sources_queried: { crossref: 'ok' },
                elapsed_seconds: 4.0,
                finished_at: 1730000100,
                error: null,
              })}\n\n`,
            ),
          );
          controller.close();
        }, 25);
      },
    });

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url.endsWith('/essays/701/events')) {
        return new Response(sseStream, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        });
      }
      return new Response('Not mocked', { status: 500 });
    });

    const qc = createTestQueryClient();
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );

    const { result } = renderHook(() => useEssayReport(701), { wrapper });

    await waitFor(() => {
      expect(result.current.data?.filename).toBe('sse_report.pdf');
    });
    expect(getEssaySpy).toHaveBeenCalledTimes(2);
    expect(getStatusSpy).not.toHaveBeenCalled();
  });

  it('useOrphanReport surfaces terminal error on SSE failed event and falls back to polling when SSE returns 502', async () => {
    // Part A: SSE emits failed -> query transitions to error without status polling
    vi.spyOn(api, 'getEssay').mockResolvedValue(null);
    const getStatusSpy = vi.spyOn(api, 'getEssayStatus');

    const encoder = new TextEncoder();
    const failedStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              status: 'failed',
              step: 'parsing',
              step_index: 0,
              total_steps: 8,
              message: 'Failed',
              citations_found: 0,
              references_found: 0,
              linked: 0,
              sources_queried: {},
              elapsed_seconds: 0.9,
              finished_at: 1730000200,
              error: 'Corrupted DOCX XML archive',
            })}\n\n`,
          ),
        );
        controller.close();
      },
    });

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(failedStream, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      }),
    );

    const qc1 = createTestQueryClient();
    const wrapper1 = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={qc1}>{children}</QueryClientProvider>
    );

    const { result: failedResult, unmount } = renderHook(() => useOrphanReport(702), {
      wrapper: wrapper1,
    });

    await waitFor(() => {
      expect(failedResult.current.isError).toBe(true);
    });
    expect((failedResult.current.error as Error).message).toContain('Corrupted DOCX XML archive');
    expect(getStatusSpy).not.toHaveBeenCalled();
    unmount();

    // Part B: SSE returns 502 -> falls back to getEssayStatus + refetchInterval
    const readyReport = makeReport({ essay_id: 703, filename: 'fallback_orphan.pdf' });
    vi.spyOn(api, 'getEssay')
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(readyReport);
    getStatusSpy.mockResolvedValue({
      status: 'completed',
      step: 'completed',
      step_index: 7,
      total_steps: 8,
      message: 'Done',
      citations_found: 4,
      references_found: 4,
      linked: 4,
      sources_queried: {},
      elapsed_seconds: 5.0,
      finished_at: 1730000300,
      error: null,
    });
    fetchSpy.mockResolvedValueOnce(new Response('Bad Gateway', { status: 502 }));

    const qc2 = createTestQueryClient();
    const wrapper2 = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={qc2}>{children}</QueryClientProvider>
    );

    const { result: fallbackResult } = renderHook(() => useOrphanReport(703), {
      wrapper: wrapper2,
    });

    await waitFor(() => {
      expect(fallbackResult.current.data?.filename).toBe('fallback_orphan.pdf');
    });
    expect(getStatusSpy).toHaveBeenCalledWith(703, expect.anything());
  });
});

describe('SystemHealthPage idle provider guard, SQLite WAL telemetry, & dynamic vs static cache stats', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await i18n.changeLanguage('en');
  });

  const makeHealth = (over: Partial<SystemHealth> = {}): SystemHealth => ({
    status: 'ok',
    totals: { users: 5, admins: 1, teachers: 2, students: 2, essays: 12, verdicts: 60 },
    verdict_label_counts: { verified: 50, metadata_error: 10 },
    cache_stats: {},
    ...over,
  });

  it('guards 0-call providers with — instead of false 100%/0 ms, shows avg/p95/last_error, formats VN/Web providers, and renders sqlite-wal-telemetry', async () => {
    vi.spyOn(api, 'getSystemHealth').mockResolvedValue(
      makeHealth({
        sqlite_wal: {
          app_db: {
            journal_mode: 'wal',
            synchronous: 1,
            busy_timeout_ms: 15000,
          },
          local_papers_db: {
            available: true,
            mode: 'ro_immutable_wal',
          },
        },
        upstream_sources: {
          vn_tech_standard: {
            state: 'closed',
            consecutive_failures: 0,
            total_calls: 0,
            success_count: 0,
            timeout_count: 0,
            http_429_count: 0,
            http_5xx_count: 0,
            ema_latency_ms: 0,
            has_latency_sample: false,
            open_remaining_seconds: 0,
          },
          wayback_html_meta: {
            state: 'open',
            consecutive_failures: 5,
            total_calls: 20,
            success_count: 12,
            timeout_count: 4,
            http_429_count: 2,
            http_5xx_count: 2,
            ema_latency_ms: 910,
            avg_latency_ms: 845.4,
            p95_latency_ms: 1420.8,
            has_latency_sample: true,
            last_error: 'HTTP 503 CDX Wayback upstream gateway timeout',
            open_remaining_seconds: 24.0,
          },
          vn_textbook_registry: {
            state: 'closed',
            consecutive_failures: 0,
            total_calls: 4,
            success_count: 4,
            timeout_count: 0,
            http_429_count: 0,
            http_5xx_count: 0,
            ema_latency_ms: 0,
            has_latency_sample: false,
            open_remaining_seconds: 0,
          },
          vn_legal_registry: {
            state: 'closed',
            consecutive_failures: 0,
            total_calls: 10,
            success_count: 10,
            timeout_count: 0,
            http_429_count: 0,
            http_5xx_count: 0,
            ema_latency_ms: 35,
            has_latency_sample: true,
            open_remaining_seconds: 0,
          },
          web_html_meta: {
            state: 'half_open',
            consecutive_failures: 2,
            total_calls: 8,
            success_count: 6,
            timeout_count: 1,
            http_429_count: 0,
            http_5xx_count: 1,
            ema_latency_ms: 310,
            has_latency_sample: true,
            last_error: 'TLS handshake reset by peer',
            open_remaining_seconds: 0,
          },
        },
      }),
    );

    renderWithProviders(<SystemHealthPage />);

    // Health status pill preserved
    expect((await screen.findByTestId('health-status-pill')).textContent).toContain(
      'ALL SERVICES HEALTHY',
    );

    // SQLite WAL telemetry rendered cleanly
    const walBar = screen.getByTestId('sqlite-wal-telemetry');
    expect(walBar.textContent).toContain('WAL');
    expect(walBar.textContent).toContain('NORMAL');
    expect(walBar.textContent).toContain('15000 ms');
    expect(walBar.textContent).toContain('RO_IMMUTABLE_WAL');

    // Idle 0-call provider shows '—' for BOTH latency and success rate (never 100% or 0 ms)
    const idleRow = screen.getByTestId('upstream-row-vn_tech_standard');
    expect(idleRow.textContent).toContain('VN Tech Standards (TCVN/QCVN)');
    expect(idleRow.textContent).not.toContain('100%');
    expect(idleRow.textContent).not.toContain('0 ms');
    expect(screen.getByTestId('upstream-latency-vn_tech_standard').textContent?.trim()).toBe('—');
    expect(screen.getByTestId('upstream-success-vn_tech_standard').textContent?.trim()).toBe('—');

    // Provider with calls > 0 but has_latency_sample === false shows '—' for latency, 100% for success
    const noSampleRow = screen.getByTestId('upstream-row-vn_textbook_registry');
    expect(noSampleRow.textContent).toContain('VN Textbook Registry');
    expect(screen.getByTestId('upstream-latency-vn_textbook_registry').textContent?.trim()).toBe(
      '—',
    );
    expect(screen.getByTestId('upstream-success-vn_textbook_registry').textContent).toContain(
      '100%',
    );

    // Active open provider prefers avg_latency_ms, shows p95 caption, and renders last_error with tooltip
    const waybackRow = screen.getByTestId('upstream-row-wayback_html_meta');
    expect(waybackRow.textContent).toContain('Wayback Machine Archive');
    expect(waybackRow.textContent).toContain('845.4 ms');
    expect(waybackRow.textContent).toContain('p95: 1420.8 ms');
    const lastErr = screen.getByTestId('upstream-last-error-wayback_html_meta');
    expect(lastErr.getAttribute('title')).toBe('HTTP 503 CDX Wayback upstream gateway timeout');
    expect(lastErr.textContent).toContain('HTTP 503 CDX Wayback');

    expect(screen.getByTestId('upstream-row-vn_legal_registry').textContent).toContain(
      'VN Legal Registry (VBQPPL)',
    );
    expect(screen.getByTestId('upstream-row-web_html_meta').textContent).toContain(
      'Web HTML Metadata',
    );
  });

  it('distinguishes dynamic verification cache from static local corpus in EN & VI and drops dynamic entries to 0 on Clear Cache', async () => {
    const beforeClear = makeHealth({
      cache_stats: {
        total: 128090,
        total_hits: 320,
        avg_hit_count: 3.55,
        persistent_entries: 90,
        expired_entries: 12,
        persistent_hits: 310,
        local_papers_count: 128000,
        local_queries_count: 64,
        local_hits_count: 58,
        local_hit_rate_percent: 90.6,
        by_source: { crossref: 55, openalex: 35 },
        local_corpus_by_source: { acl_anthology: 80000, openalex_seed: 48000 },
      },
    });
    const afterClear = makeHealth({
      cache_stats: {
        total: 128000,
        total_hits: 0,
        avg_hit_count: 0,
        persistent_entries: 0,
        expired_entries: 0,
        persistent_hits: 0,
        local_papers_count: 128000,
        local_queries_count: 64,
        local_hits_count: 58,
        local_hit_rate_percent: 90.6,
        by_source: {},
        local_corpus_by_source: { acl_anthology: 80000, openalex_seed: 48000 },
      },
    });

    const healthSpy = vi
      .spyOn(api, 'getSystemHealth')
      .mockResolvedValueOnce(beforeClear)
      .mockResolvedValueOnce(afterClear);
    const clearSpy = vi.spyOn(api, 'clearCache').mockResolvedValue({ deleted_count: 90 });

    const { unmount } = renderWithProviders(<SystemHealthPage />);

    const stats = await screen.findByTestId('cache-stats');
    expect(stats.textContent).toContain('Persistent SQLite Entries');
    expect(stats.textContent).toContain('Expired Cache Entries');
    expect(stats.textContent).toContain('Persistent SQLite Hits');
    expect(stats.textContent).toContain('Local Corpus Hits');
    expect(stats.textContent).toContain('Local Corpus Papers');
    expect(stats.textContent).toContain('Crossref');
    expect(screen.getByTestId('local-corpus-by-source-section')).toBeDefined();

    // Clear cache -> refreshes health -> dynamic entries and Cached Entries by Source drop to 0 while 128,000 local papers stay intact
    fireEvent.click(screen.getByTestId('clear-cache-btn'));
    fireEvent.click(await screen.findByTestId('confirmation-confirm-btn'));
    await waitFor(() => expect(clearSpy).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(healthSpy).toHaveBeenCalledTimes(2));
    await waitFor(() => {
      expect(screen.getByTestId('cache-by-source-zero').textContent).toContain(
        '0dynamic cached entries',
      );
    });
    expect(screen.getByTestId('cache-stat-persistent_entries').textContent).toContain('0');
    expect(screen.getByTestId('cache-stat-local_papers_count').textContent).toContain('128000');
    unmount();

    // Check Vietnamese labels
    await i18n.changeLanguage('vi');
    vi.spyOn(api, 'getSystemHealth').mockResolvedValue(beforeClear);
    renderWithProviders(<SystemHealthPage />);
    const viStats = await screen.findByTestId('cache-stats');
    expect(viStats.textContent).toContain('Mục lưu đệm SQLite bền vững');
    expect(viStats.textContent).toContain('Mục lưu đệm đã hết hạn');
    expect(viStats.textContent).toContain('Lượt trúng đệm SQLite bền vững');
    expect(viStats.textContent).toContain('Lượt trúng kho cục bộ');
  });
});

describe('DashboardPage, HistoryPage job lifecycle badges & AccountManagementPage Plan/Quota column', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await i18n.changeLanguage('en');
  });

  const lifecycleEssays: EssaySummary[] = [
    {
      id: 801,
      filename: 'queued_submission.pdf',
      num_pages: 12,
      uploaded_at: '2026-11-14T05:00:00Z',
      user_id: 10,
      cis_score: null,
      job_status: 'queued',
    },
    {
      id: 802,
      filename: 'active_processing.docx',
      num_pages: 18,
      uploaded_at: '2026-11-14T05:05:00Z',
      user_id: 10,
      cis_score: null,
      job_status: 'processing',
    },
    {
      id: 803,
      filename: 'corrupted_upload.pdf',
      num_pages: 0,
      uploaded_at: '2026-11-14T05:10:00Z',
      user_id: 10,
      cis_score: 0,
      job_status: 'failed',
      job_error: 'PDF xref table damaged beyond repair',
      quota_charged: false,
    },
    {
      id: 804,
      filename: 'verified_thesis.pdf',
      num_pages: 32,
      uploaded_at: '2026-11-14T05:15:00Z',
      user_id: 10,
      cis_score: 92.4,
      job_status: 'completed',
      quota_charged: true,
    },
  ];

  it('DashboardPage & HistoryPage surface queued/processing/failed + credit refund badges, guard CIS as —, and link non-completed jobs to /verification/processing/:id in EN & VI', async () => {
    vi.spyOn(api, 'listEssays').mockResolvedValue(lifecycleEssays);
    vi.spyOn(api, 'getEssayStats').mockResolvedValue({
      total_essays: 1,
      total_citations: 25,
      verified: 23,
      metadata_error: 2,
      suspected_hallucination: 0,
      unresolved: 0,
      resource: 0,
    });

    const { unmount } = renderWithProviders(<DashboardPage />, {
      user: makeUser('user', 'pro'),
    });

    await waitFor(() => expect(screen.getByText('queued_submission.pdf')).toBeDefined());

    expect(screen.getByTestId('job-status-badge-801').textContent).toBe('Queued');
    expect(screen.getByTestId('job-status-badge-802').textContent).toBe('Processing');
    const failedBadge = screen.getByTestId('job-status-badge-803');
    expect(failedBadge.textContent).toContain('Failed');
    expect(failedBadge.getAttribute('title')).toBe('PDF xref table damaged beyond repair');
    expect(screen.getByTestId('job-refund-badge-803').textContent).toBe('Credit Refunded');

    // CIS guard: — for queued, processing, and failed; 92/100 for completed
    expect(screen.getByTestId('essay-cis-801').textContent).toBe('—');
    expect(screen.getByTestId('essay-cis-802').textContent).toBe('—');
    expect(screen.getByTestId('essay-cis-803').textContent).toBe('—');
    expect(screen.getByTestId('essay-cis-804').textContent).toBe('92/100');

    // Links point to /verification/processing/:id for queued/processing/failed, and /verification/report/:id for completed
    expect(screen.getByTestId('dashboard-essay-link-801').getAttribute('href')).toBe(
      '/verification/processing/801',
    );
    expect(screen.getByTestId('dashboard-essay-link-802').getAttribute('href')).toBe(
      '/verification/processing/802',
    );
    expect(screen.getByTestId('dashboard-essay-link-803').getAttribute('href')).toBe(
      '/verification/processing/803',
    );
    expect(screen.getByTestId('dashboard-essay-link-804').getAttribute('href')).toBe(
      '/verification/report/804',
    );
    unmount();

    // HistoryPage in Vietnamese
    await i18n.changeLanguage('vi');
    vi.spyOn(api, 'listEssays').mockResolvedValue(lifecycleEssays);
    renderWithProviders(<HistoryPage />, {
      user: makeUser('user', 'pro'),
    });

    await waitFor(() => expect(screen.getByText('queued_submission.pdf')).toBeDefined());
    expect(screen.getByTestId('history-job-status-801').textContent).toBe('Hàng đợi');
    expect(screen.getByTestId('history-job-status-802').textContent).toBe('Đang xử lý');
    expect(screen.getByTestId('history-job-status-803').textContent).toContain('Thất bại');
    expect(screen.getByTestId('history-job-refund-803').textContent).toBe('Hoàn lượt');
    expect(screen.getByTestId('history-essay-cis-803').textContent).toBe('CIS: —');
    expect(screen.getByTestId('history-essay-cis-804').textContent).toBe('CIS: 92/100');

    const historyLinks = screen.getAllByTestId('essay-item');
    expect(historyLinks[0]?.getAttribute('href')).toBe('/verification/processing/801');
    expect(historyLinks[1]?.getAttribute('href')).toBe('/verification/processing/802');
    expect(historyLinks[2]?.getAttribute('href')).toBe('/verification/processing/803');
    expect(historyLinks[3]?.getAttribute('href')).toBe('/verification/report/804');
  });

  it('AccountManagementPage renders Plan / Quota column with tier badge + used/limit, Unlimited for admin, and graceful — when quota is undefined', async () => {
    const usersFixture: User[] = [
      makeUser('admin', 'ultra', { id: 1, username: 'root_admin' }),
      makeUser('teacher', 'pro', {
        id: 2,
        username: 'dr_nguyen',
        quota: {
          ...makeUser('teacher', 'pro').quota!,
          monthly_uploads_used: 12,
          monthly_uploads_limit: 50,
        },
      }),
      {
        id: 3,
        username: 'minimal_fixture_user',
        role: 'user',
        email: 'min@test.local',
        full_name: 'Minimal Fixture',
        is_active: true,
        avatar_url: null,
        last_login_at: null,
        created_at: '2026-06-01T00:00:00Z',
        institution: 'HCMUT',
        can_override_verdicts: false,
      },
    ];

    vi.spyOn(api, 'listUsers').mockResolvedValue(usersFixture);

    const { unmount } = renderWithProviders(<AccountManagementPage />, {
      user: makeUser('admin'),
      initialRoute: '/admin/users',
    });

    await waitFor(() => expect(screen.getByText('dr_nguyen · teacher@test.local')).toBeDefined());
    expect(screen.getAllByText('Plan / Quota').length).toBeGreaterThan(0);

    expect(screen.getByTestId('user-plan-quota-1').textContent).toContain('ULTRA');
    expect(screen.getByTestId('user-plan-quota-1').textContent).toContain('Unlimited');

    expect(screen.getByTestId('user-plan-quota-2').textContent).toContain('PRO');
    expect(screen.getByTestId('user-plan-quota-2').textContent).toContain('12/50');

    expect(screen.getByTestId('user-plan-quota-3').textContent).toContain('BASIC');
    expect(screen.getByTestId('user-plan-quota-3').textContent).toContain('—');
    unmount();

    await i18n.changeLanguage('vi');
    vi.spyOn(api, 'listUsers').mockResolvedValue(usersFixture);
    renderWithProviders(<AccountManagementPage />, {
      user: makeUser('admin'),
      initialRoute: '/admin/users',
    });
    await waitFor(() => expect(screen.getAllByText('Gói / Hạn ngạch').length).toBeGreaterThan(0));
    expect(screen.getByTestId('user-plan-quota-1').textContent).toContain('Không giới hạn');
  });
});
