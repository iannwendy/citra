import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// Mock api/client before importing the hook
const mockGetEssay = vi.fn();
const mockGetEssayStatus = vi.fn();
vi.mock('@/api/client', () => ({
  api: {
    getEssay: (...args: unknown[]) => mockGetEssay(...args),
    getEssayStatus: (...args: unknown[]) => mockGetEssayStatus(...args),
  },
}));

import { useEssayPolling } from './useEssayPolling';
import { useEssayReport } from './useEssayReport';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '@/lib/queryClient';
import React from 'react';

beforeEach(() => {
  vi.useFakeTimers();
  mockGetEssay.mockReset();
  mockGetEssayStatus.mockReset();
  queryClient.clear();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('useEssayPolling', () => {
  it('returns report immediately if getEssay resolves with data', async () => {
    mockGetEssay.mockResolvedValueOnce({ id: 1, filename: 'x.pdf' });
    const { result } = renderHook(() => useEssayPolling(1));
    // The hook is async, give it a tick to resolve
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.report).not.toBeNull();
    expect(result.current.report?.filename).toBe('x.pdf');
    expect(result.current.isPolling).toBe(false);
  });

  it('polls status when getEssay returns null, then resolves on completed', async () => {
    // First 2 calls return null (processing), 3rd returns final report
    mockGetEssay
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 42, filename: 'final.pdf' });
    mockGetEssayStatus
      .mockResolvedValueOnce({ status: 'processing' })
      .mockResolvedValueOnce({ status: 'completed' });

    const { result } = renderHook(() => useEssayPolling(42, { intervalMs: 1000 }));

    // First fetch: getEssay=null, status=processing, starts poll timer
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.isPolling).toBe(true);
    expect(result.current.report).toBeNull();

    // Second fetch (from poll timer): getEssay=null, status=completed, then getEssay=final
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(result.current.report?.filename).toBe('final.pdf');
    expect(result.current.isPolling).toBe(false);
  });

  it('aborts polling when essayId changes', async () => {
    mockGetEssay.mockResolvedValue(null);
    mockGetEssayStatus.mockResolvedValue({ status: 'processing' });

    const { rerender } = renderHook(
      ({ id }) => useEssayPolling(id, { intervalMs: 1000 }),
      { initialProps: { id: 1 } },
    );
    // First fetch
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    // Advance past one poll interval
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1100);
    });
    expect(mockGetEssayStatus.mock.calls.length).toBeGreaterThan(0);

    // Change essayId — old effect should abort
    mockGetEssay.mockReset();
    mockGetEssayStatus.mockReset();
    mockGetEssay.mockResolvedValue({ id: 2, filename: 'new.pdf' });
    rerender({ id: 2 });

    // Advance time — should only make calls for id=2
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    const callsForId1 = mockGetEssayStatus.mock.calls.filter(
      (c) => c[0] === 1,
    ).length;
    // No more status calls for id=1 after the switch
    expect(callsForId1).toBe(0);
  });

  it('sets error when status is failed', async () => {
    mockGetEssay.mockResolvedValue(null);
    mockGetEssayStatus.mockResolvedValueOnce({
      status: 'failed',
      error: 'Pipeline crashed',
    });

    const { result } = renderHook(() => useEssayPolling(99));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.error).toBe('Pipeline crashed');
    expect(result.current.isPolling).toBe(false);
  });

  it('reuses valid cached report from queryClient with zero network calls when switching tabs', async () => {
    const fullCachedReport = {
      essay_id: 77,
      filename: 'cached_thesis.pdf',
      num_pages: 12,
      num_citations: 5,
      verdicts: [{ citation_id: 'v1', citation_raw: '[1]', label: 'verified' }],
    };
    queryClient.setQueryData(['essay-report', 77], fullCachedReport);

    const { result } = renderHook(() => useEssayPolling(77));
    expect(result.current.report?.filename).toBe('cached_thesis.pdf');
    expect(result.current.isPolling).toBe(false);
    expect(mockGetEssay).toHaveBeenCalledTimes(0);
    expect(mockGetEssayStatus).toHaveBeenCalledTimes(0);
  });

  it('populates queryClient cache when full report with verdicts is fetched and refetches after invalidation', async () => {
    const networkReport = {
      essay_id: 88,
      filename: 'fresh_report.pdf',
      num_pages: 10,
      num_citations: 3,
      verdicts: [{ citation_id: 'v2', citation_raw: '[2]', label: 'metadata_error' }],
    };
    mockGetEssay.mockResolvedValueOnce(networkReport);

    const { result } = renderHook(() => useEssayPolling(88));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.report?.filename).toBe('fresh_report.pdf');
    expect(queryClient.getQueryData(['essay-report', 88])).toEqual(networkReport);

    // After verdict override invalidates ['essay-report'], next mount should refetch
    await queryClient.invalidateQueries({ queryKey: ['essay-report'] });
    const updatedReport = {
      ...networkReport,
      verdicts: [{ citation_id: 'v2', citation_raw: '[2]', label: 'verified', is_overridden: true }],
    };
    mockGetEssay.mockResolvedValueOnce(updatedReport);

    const { result: resultAfterInvalidate } = renderHook(() => useEssayPolling(88));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(mockGetEssay).toHaveBeenCalledTimes(2);
    expect(resultAfterInvalidate.current.report?.verdicts[0].label).toBe('verified');
  });

  it('useEssayReport stops polling immediately on 403/404 error', async () => {
    mockGetEssay.mockRejectedValue(new Error('API 403: Access denied'));
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useEssayReport(999, { intervalMs: 1000 }), { wrapper });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(result.current.isError).toBe(true);
    const callsAfterError = mockGetEssay.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(mockGetEssay.mock.calls.length).toBe(callsAfterError);
  });
});
