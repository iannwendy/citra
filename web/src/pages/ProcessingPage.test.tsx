import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, waitFor } from '@testing-library/react';
import { Routes, Route } from 'react-router-dom';
import { api, type EssayStatus } from '@/api/client';
import i18n from '@/i18n';
import { renderWithProviders, makeUser, screen } from '@/test-utils';
import { ProcessingPage } from './ProcessingPage';

const queuedStatusFixture: EssayStatus = {
  status: 'queued',
  queue_position: 4,
  step: 'parse',
  step_index: 0,
  total_steps: 8,
  message: 'Queued in admission queue (#4)',
  citations_found: 0,
  references_found: 0,
  linked: 0,
  sources_queried: {},
  elapsed_seconds: 1.8,
  finished_at: null,
  error: null,
};

describe('ProcessingPage FIFO Admission Queue UI', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await i18n.changeLanguage('en');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders FIFO queue position badge and banner in English when status is queued', async () => {
    vi.spyOn(api, 'getEssayStatus').mockResolvedValue(queuedStatusFixture);

    renderWithProviders(
      <Routes>
        <Route path="/verification/processing/:id" element={<ProcessingPage />} />
      </Routes>,
      {
        user: makeUser('user'),
        initialRoute: '/verification/processing/77',
      },
    );

    expect(
      await screen.findByText('Queued for analysis (Position #4)'),
    ).toBeDefined();
    expect(screen.getByTestId('queued-processing-banner')).toBeDefined();
    expect(
      screen.getByText('Your document is waiting in line — Position #4'),
    ).toBeDefined();
    expect(screen.getByTestId('queued-processing-banner').textContent).not.toMatch(
      /admission queue|FIFO/i,
    );
    expect(screen.getByText('Queued (#4)')).toBeDefined();
  });

  it('renders FIFO queue position badge and banner in Vietnamese when status is queued', async () => {
    await i18n.changeLanguage('vi');
    vi.spyOn(api, 'getEssayStatus').mockResolvedValue({
      ...queuedStatusFixture,
      queue_position: 2,
    });

    renderWithProviders(
      <Routes>
        <Route path="/verification/processing/:id" element={<ProcessingPage />} />
      </Routes>,
      {
        user: makeUser('user'),
        initialRoute: '/verification/processing/77',
      },
    );

    expect(
      await screen.findByText('Đang xếp hàng xử lý (Vị trí #2)'),
    ).toBeDefined();
    expect(screen.getByTestId('queued-processing-banner')).toBeDefined();
    expect(
      screen.getByText('Bài viết đang chờ tới lượt kiểm tra — Vị trí #2'),
    ).toBeDefined();
    expect(screen.getByTestId('queued-processing-banner').textContent).not.toMatch(
      /hàng đợi thông minh|FIFO/i,
    );
    expect(screen.getByText('Hàng đợi #2')).toBeDefined();
    expect(screen.getByText('Đang xếp hàng (#2)')).toBeDefined();
  });

  it('progresses smoothly step-by-step from 01/08 to 04/08 without jumping over intermediate steps', async () => {
    vi.useFakeTimers();
    vi.spyOn(api, 'getEssayStatus').mockResolvedValue({
      status: 'processing',
      queue_position: null,
      step: 'linking',
      step_index: 3,
      total_steps: 8,
      message: 'Linked 53 of 54 references',
      citations_found: 120,
      references_found: 54,
      linked: 53,
      sources_queried: {},
      elapsed_seconds: 0.6,
      finished_at: null,
      error: null,
    });

    renderWithProviders(
      <Routes>
        <Route path="/verification/processing/:id" element={<ProcessingPage />} />
      </Routes>,
      {
        user: makeUser('user'),
        initialRoute: '/verification/processing/92',
      },
    );

    // Flush initial status resolution inside act(...)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    // Initially starts at Step 01/08 active instead of teleporting straight to Step 04/08
    expect(screen.getByTestId('pipeline-step-1').getAttribute('data-step-status')).toBe('active');
    expect(screen.getByTestId('pipeline-step-4').getAttribute('data-step-status')).toBe('pending');

    // After smooth step-by-step progression (3 chained 220ms effects), Step 01..03 are completed and Step 04 is active
    for (let i = 0; i < 3; i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(250);
      });
    }

    expect(screen.getByTestId('pipeline-step-1').getAttribute('data-step-status')).toBe('completed');
    expect(screen.getByTestId('pipeline-step-2').getAttribute('data-step-status')).toBe('completed');
    expect(screen.getByTestId('pipeline-step-3').getAttribute('data-step-status')).toBe('completed');
    expect(screen.getByTestId('pipeline-step-4').getAttribute('data-step-status')).toBe('active');
  });
});

describe('ProcessingPage real-time elapsed timer', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('ticks continuously in real time while a step is running without new SSE frames and stops cleanly on completion', async () => {
    await i18n.changeLanguage('en');
    vi.useFakeTimers();

    const encoder = new TextEncoder();
    const ctrlRef: { current: ReadableStreamDefaultController<Uint8Array> | null } = {
      current: null,
    };

    const sseStream = new ReadableStream<Uint8Array>({
      start(controller) {
        ctrlRef.current = controller;
        const initialFrame: EssayStatus = {
          status: 'processing',
          queue_position: null,
          step: 'parsing',
          step_index: 0,
          total_steps: 8,
          message: 'Parsing document...',
          citations_found: 0,
          references_found: 0,
          linked: 0,
          sources_queried: {},
          elapsed_seconds: 0.2,
          finished_at: null,
          error: null,
        };
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(initialFrame)}\n\n`),
        );
      },
    });

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(sseStream, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream; charset=utf-8' },
      }),
    );
    vi.spyOn(api, 'getEssay').mockResolvedValue(null);

    renderWithProviders(
      <Routes>
        <Route path="/verification/processing/:id" element={<ProcessingPage />} />
        <Route path="/verification/report/:id" element={<div>Report View</div>} />
      </Routes>,
      {
        user: makeUser('user'),
        initialRoute: '/verification/processing/105',
      },
    );

    // Flush microtasks for initial SSE frame
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText('0.2s')).toBeDefined();

    // Advance 1.5s while Step 1 is still running (ZERO new SSE frames arrive)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(screen.queryByText('0.2s')).toBeNull();
    expect(screen.getByText('1.7s')).toBeDefined();

    // Advance another 0.8s without SSE frames -> 2.5s
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });
    expect(screen.getByText('2.5s')).toBeDefined();

    // Emit terminal completed snapshot at 2.6s and close SSE stream
    await act(async () => {
      const completedFrame: EssayStatus = {
        status: 'completed',
        queue_position: null,
        step: 'done',
        step_index: 7,
        total_steps: 8,
        message: 'Analysis complete',
        citations_found: 18,
        references_found: 12,
        linked: 18,
        sources_queried: { crossref: 'ok' },
        elapsed_seconds: 2.6,
        finished_at: Date.now() / 1000,
        error: null,
      };
      ctrlRef.current?.enqueue(
        encoder.encode(`data: ${JSON.stringify(completedFrame)}\n\n`),
      );
      ctrlRef.current?.close();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText('2.6s')).toBeDefined();

    // Even as post-completion step animations & redirect delay elapse (900ms), stopwatch stays frozen at 2.6s
    await act(async () => {
      await vi.advanceTimersByTimeAsync(900);
    });
    expect(screen.getByText('2.6s')).toBeDefined();
  });

  it('displays 0.0s immediately when initial elapsed_seconds is 0 and never jumps backwards on network jitter', async () => {
    await i18n.changeLanguage('en');
    vi.useFakeTimers();

    const encoder = new TextEncoder();
    const ctrlRef: { current: ReadableStreamDefaultController<Uint8Array> | null } = {
      current: null,
    };

    const sseStream = new ReadableStream<Uint8Array>({
      start(controller) {
        ctrlRef.current = controller;
        const frame0: EssayStatus = {
          status: 'processing',
          queue_position: null,
          step: 'parsing',
          step_index: 0,
          total_steps: 8,
          message: 'Starting analysis...',
          citations_found: 0,
          references_found: 0,
          linked: 0,
          sources_queried: {},
          elapsed_seconds: 0,
          finished_at: null,
          error: null,
        };
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(frame0)}\n\n`));
      },
    });

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(sseStream, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream; charset=utf-8' },
      }),
    );

    renderWithProviders(
      <Routes>
        <Route path="/verification/processing/:id" element={<ProcessingPage />} />
      </Routes>,
      {
        user: makeUser('user'),
        initialRoute: '/verification/processing/106',
      },
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText('0.0s')).toBeDefined();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(screen.getByText('0.5s')).toBeDefined();

    // Next step snapshot arrives with elapsed_seconds: 0.4 due to transit jitter — must NOT jump backwards to 0.4s
    await act(async () => {
      const jitterFrame: EssayStatus = {
        status: 'processing',
        queue_position: null,
        step: 'style_detection',
        step_index: 1,
        total_steps: 8,
        message: 'Detecting citation style...',
        citations_found: 0,
        references_found: 0,
        linked: 0,
        sources_queried: {},
        elapsed_seconds: 0.4,
        finished_at: null,
        error: null,
      };
      ctrlRef.current?.enqueue(
        encoder.encode(`data: ${JSON.stringify(jitterFrame)}\n\n`),
      );
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText('0.5s')).toBeDefined();

    // Continues ticking smoothly from 0.5s -> 0.8s after 300ms
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(screen.getByText('0.8s')).toBeDefined();

    // Catches up forward immediately if server snapshot reports higher elapsed time (e.g. after background tab throttling)
    await act(async () => {
      const catchupFrame: EssayStatus = {
        status: 'processing',
        queue_position: null,
        step: 'retrieving',
        step_index: 4,
        total_steps: 8,
        message: 'Retrieving metadata...',
        citations_found: 14,
        references_found: 10,
        linked: 14,
        sources_queried: {},
        elapsed_seconds: 4.3,
        finished_at: null,
        error: null,
      };
      ctrlRef.current?.enqueue(
        encoder.encode(`data: ${JSON.stringify(catchupFrame)}\n\n`),
      );
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText('4.3s')).toBeDefined();

    ctrlRef.current?.close();
  });
});

describe('ProcessingPage Step 1 sub-stage telemetry & ReasoningStream invariants', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('appends Step 1 sub-stage SSE lines monotonically without shrinking on Step 2 and localizes in EN/VI', async () => {
    await i18n.changeLanguage('en');
    vi.useFakeTimers();

    const encoder = new TextEncoder();
    const ctrlRef: { current: ReadableStreamDefaultController<Uint8Array> | null } = {
      current: null,
    };

    const sseStream = new ReadableStream<Uint8Array>({
      start(controller) {
        ctrlRef.current = controller;
        const frame1: EssayStatus = {
          status: 'processing',
          queue_position: null,
          step: 'parsing',
          step_index: 0,
          total_steps: 8,
          message: 'Extracted text from 117 pages · Checking GROBID layout cache...',
          citations_found: 0,
          references_found: 0,
          linked: 0,
          sources_queried: {},
          elapsed_seconds: 0.4,
          finished_at: null,
          error: null,
        };
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(frame1)}\n\n`));
      },
    });

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(sseStream, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream; charset=utf-8' },
      }),
    );
    vi.spyOn(api, 'getEssay').mockResolvedValue(null);

    renderWithProviders(
      <Routes>
        <Route path="/verification/processing/:id" element={<ProcessingPage />} />
      </Routes>,
      {
        user: makeUser('user'),
        initialRoute: '/verification/processing/124',
      },
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(
      screen.getByText(
        '[01/08] Extracted document text (117 pages) · Checking cached layout',
      ),
    ).toBeDefined();

    // Next Step 1 sub-stage arrives: Analyzing document layout
    await act(async () => {
      const frame2: EssayStatus = {
        status: 'processing',
        queue_position: null,
        step: 'parsing',
        step_index: 0,
        total_steps: 8,
        message: 'Analyzing 117-page PDF layout with GROBID...',
        citations_found: 0,
        references_found: 0,
        linked: 0,
        sources_queried: {},
        elapsed_seconds: 1.2,
        finished_at: null,
        error: null,
      };
      ctrlRef.current?.enqueue(encoder.encode(`data: ${JSON.stringify(frame2)}\n\n`));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(
      screen.getByText('[01/08] Analyzing document structure (117 pages)…'),
    ).toBeDefined();

    // Advance to Step 2 — previous Step 1 sub-stage lines MUST stay in ReasoningStream (monotonic prefix)
    await act(async () => {
      const frame3: EssayStatus = {
        status: 'processing',
        queue_position: null,
        step: 'style_detection',
        step_index: 1,
        total_steps: 8,
        message: 'Detecting citation style...',
        citations_found: 0,
        references_found: 0,
        linked: 0,
        sources_queried: {},
        elapsed_seconds: 6.5,
        finished_at: null,
        error: null,
      };
      ctrlRef.current?.enqueue(encoder.encode(`data: ${JSON.stringify(frame3)}\n\n`));
      await vi.advanceTimersByTimeAsync(0);
    });
    // Stepper catch-up (220ms) + ReasoningStream step animation (360ms)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(450);
    });
    expect(
      screen.getByText(
        '[01/08] Extracted document text (117 pages) · Checking cached layout',
      ),
    ).toBeDefined();
    expect(
      screen.getByText('[01/08] Analyzing document structure (117 pages)…'),
    ).toBeDefined();
    expect(
      screen.getByText(
        '[02/08] Identifying citation style conventions (APA, IEEE, MLA…)',
      ),
    ).toBeDefined();

    // Switching language to Vietnamese re-renders stored sub-messages cleanly in Vietnamese
    await act(async () => {
      await i18n.changeLanguage('vi');
    });
    expect(
      screen.getByText('[01/08] Đang phân tích cấu trúc tài liệu (117 trang)…'),
    ).toBeDefined();

    ctrlRef.current?.close();
  });

  it('does not misattribute a later-step message as a Step 1 sub-stage during initial stepper animation', async () => {
    await i18n.changeLanguage('en');
    vi.useFakeTimers();

    // Backend is already at step="linking" with a message that happens to contain "analyzing" & "grobid"
    vi.spyOn(api, 'getEssayStatus').mockResolvedValue({
      status: 'processing',
      queue_position: null,
      step: 'linking',
      step_index: 3,
      total_steps: 8,
      message: 'Analyzing 40-page PDF layout with GROBID...',
      citations_found: 50,
      references_found: 30,
      linked: 28,
      sources_queried: {},
      elapsed_seconds: 5.0,
      finished_at: null,
      error: null,
    });

    renderWithProviders(
      <Routes>
        <Route path="/verification/processing/:id" element={<ProcessingPage />} />
      </Routes>,
      {
        user: makeUser('user'),
        initialRoute: '/verification/processing/125',
      },
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    // Even though effectiveStepIndex starts at 0 during stepper catch-up, snap.step !== 'parsing'
    // so it must NOT be recorded as a Step 1 sub-stage line!
    expect(
      screen.queryByText('[01/08] Analyzing document structure (40 pages)…'),
    ).toBeNull();
  });

  it('uses singular English grammar for 1 page / 1 reference and renders humanized structural parser lines', async () => {
    await i18n.changeLanguage('en');
    vi.useFakeTimers();

    const encoder = new TextEncoder();
    const ctrlRef: { current: ReadableStreamDefaultController<Uint8Array> | null } = {
      current: null,
    };

    const sseStream = new ReadableStream<Uint8Array>({
      start(controller) {
        ctrlRef.current = controller;
        const frame1: EssayStatus = {
          status: 'processing',
          queue_position: null,
          step: 'parsing',
          step_index: 0,
          total_steps: 8,
          message: 'Extracted text from 1 page · Using regex parser...',
          citations_found: 0,
          references_found: 0,
          linked: 0,
          sources_queried: {},
          elapsed_seconds: 0.2,
          finished_at: null,
          error: null,
        };
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(frame1)}\n\n`));
      },
    });

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(sseStream, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream; charset=utf-8' },
      }),
    );
    vi.spyOn(api, 'getEssay').mockResolvedValue(null);

    renderWithProviders(
      <Routes>
        <Route path="/verification/processing/:id" element={<ProcessingPage />} />
      </Routes>,
      {
        user: makeUser('user'),
        initialRoute: '/verification/processing/126',
      },
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(
      screen.getByText('[01/08] Analyzing structural text layout (1 page)'),
    ).toBeDefined();

    await act(async () => {
      const frame2: EssayStatus = {
        status: 'processing',
        queue_position: null,
        step: 'parsing',
        step_index: 0,
        total_steps: 8,
        message: 'GROBID parsed 1 reference · Extracting & merging citations...',
        citations_found: 0,
        references_found: 0,
        linked: 0,
        sources_queried: {},
        elapsed_seconds: 0.9,
        finished_at: null,
        error: null,
      };
      ctrlRef.current?.enqueue(encoder.encode(`data: ${JSON.stringify(frame2)}\n\n`));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(
      screen.getByText('[01/08] Parsed 1 reference · Merging citations'),
    ).toBeDefined();

    ctrlRef.current?.close();
  });

  it('renders empty state at /verification/processing without :id and disables Open Report while processing', async () => {
    await i18n.changeLanguage('en');

    const { unmount } = renderWithProviders(
      <Routes>
        <Route path="/verification/processing" element={<ProcessingPage />} />
      </Routes>,
      {
        user: makeUser('user'),
        initialRoute: '/verification/processing',
      },
    );

    expect(screen.getByTestId('processing-empty-state')).toBeDefined();
    expect(screen.getByText('No active verification in progress')).toBeDefined();
    unmount();

    vi.spyOn(api, 'getEssayStatus').mockResolvedValue({
      status: 'processing',
      queue_position: null,
      step: 'comparing',
      step_index: 5,
      total_steps: 8,
      message: 'Comparing candidate publications...',
      citations_found: 10,
      references_found: 8,
      linked: 8,
      sources_queried: { crossref: 'ok' },
      elapsed_seconds: 4.1,
      finished_at: null,
      error: null,
    });

    renderWithProviders(
      <Routes>
        <Route path="/verification/processing/:id" element={<ProcessingPage />} />
      </Routes>,
      {
        user: makeUser('user'),
        initialRoute: '/verification/processing/200',
      },
    );

    const buildingBtn = (await screen.findByTestId(
      'processing-building-report-btn',
    )) as HTMLButtonElement;
    expect(buildingBtn.disabled).toBe(true);
    expect(screen.queryByTestId('processing-open-report-btn')).toBeNull();
    await waitFor(() => {
      expect(screen.getByTestId('processing-progress-percent').textContent).toContain(
        '63%',
      );
    });
  });
});
