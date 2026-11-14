import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from '@testing-library/react';
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
      screen.getByText('Submission in smart admission queue — Current position: #4'),
    ).toBeDefined();
    expect(screen.getByText('QUEUED (#4)')).toBeDefined();
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
      screen.getByText('Bài nộp đang trong hàng đợi thông minh — Vị trí hiện tại: #2'),
    ).toBeDefined();
    expect(screen.getByText('Hàng đợi #2')).toBeDefined();
    expect(screen.getByText('QUEUED (#2)')).toBeDefined();
  });

  it('progresses smoothly step-by-step from 01/08 to 04/08 without jumping over intermediate steps', async () => {
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

    // Initially starts at Step 01/08 active instead of teleporting straight to Step 04/08
    const step1 = await screen.findByTestId('pipeline-step-1');
    expect(step1.getAttribute('data-step-status')).toBe('active');
    expect(screen.getByTestId('pipeline-step-4').getAttribute('data-step-status')).toBe('pending');

    // After smooth step-by-step progression (~700ms for 3 steps at 220ms/step), Step 01..03 are completed and Step 04 is active
    await vi.waitFor(
      () => {
        expect(screen.getByTestId('pipeline-step-1').getAttribute('data-step-status')).toBe('completed');
        expect(screen.getByTestId('pipeline-step-2').getAttribute('data-step-status')).toBe('completed');
        expect(screen.getByTestId('pipeline-step-3').getAttribute('data-step-status')).toBe('completed');
        expect(screen.getByTestId('pipeline-step-4').getAttribute('data-step-status')).toBe('active');
      },
      { timeout: 2000 },
    );
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
