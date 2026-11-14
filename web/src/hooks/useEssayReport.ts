import { useEffect, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, type AnalysisReport, type OverrideRequest } from '@/api/client';
import { streamEssayEvents } from './useEssayStream';

interface UseEssayReportOptions {
  /** Enable polling/SSE while essay is still processing (default: true) */
  pollUntilDone?: boolean;
  /** Fallback poll interval in ms when SSE is unavailable (default: 2000) */
  intervalMs?: number;
}

export function useEssayReport(
  essayId: number | null,
  options: UseEssayReportOptions = {},
) {
  const { pollUntilDone = true, intervalMs = 2000 } = options;
  const [sseFallbackForId, setSseFallbackForId] = useState<number | null>(null);
  const sseFallbackRef = useRef<number | null>(null);
  const terminalErrorRef = useRef<{ essayId: number; message: string } | null>(null);

  const sseConnected = essayId === null || sseFallbackForId !== essayId;

  const query = useQuery({
    queryKey: ['essay-report', essayId],
    queryFn: async ({ signal }): Promise<AnalysisReport | null> => {
      if (essayId === null) return null;
      if (terminalErrorRef.current?.essayId === essayId) {
        throw new Error(terminalErrorRef.current.message);
      }
      // Try direct report first
      const report = await api.getEssay(essayId, { signal });
      if (report) {
        if (terminalErrorRef.current?.essayId === essayId) {
          terminalErrorRef.current = null;
        }
        return report;
      }
      // While SSE is active/pending, avoid redundant getEssayStatus HTTP polls
      if (sseFallbackRef.current !== essayId) {
        return null;
      }
      // Fallback path when SSE is unavailable/disconnected
      const status = await api.getEssayStatus(essayId, { signal });
      if (status.status === 'failed') {
        throw new Error(status.error ?? 'Essay processing failed');
      }
      return null;
    },
    enabled: essayId !== null,
    staleTime: Infinity,
    retry: false,
    refetchInterval: (q) => {
      if (!pollUntilDone || q.state.status === 'error') return false;
      if (sseConnected) return false;
      const data = q.state.data;
      return data ? false : intervalMs;
    },
    refetchIntervalInBackground: false,
  });

  const queryData = query.data;
  const queryIsError = query.isError;
  const refetchReport = query.refetch;

  const isWaitingForPipeline =
    essayId !== null &&
    !Number.isNaN(essayId) &&
    essayId > 0 &&
    pollUntilDone &&
    queryData === null &&
    !queryIsError;

  useEffect(() => {
    if (!isWaitingForPipeline || essayId === null) return;
    if (sseFallbackRef.current === essayId) return;

    let cancelled = false;
    const controller = new AbortController();

    void (async () => {
      const settled = await streamEssayEvents(
        essayId,
        (snap) => {
          if (cancelled) return;
          if (snap.status === 'completed') {
            if (terminalErrorRef.current?.essayId === essayId) {
              terminalErrorRef.current = null;
            }
            void refetchReport();
          } else if (snap.status === 'failed') {
            terminalErrorRef.current = {
              essayId,
              message: snap.error ?? 'Essay processing failed',
            };
            void refetchReport();
          }
        },
        controller.signal,
      );

      if (cancelled || controller.signal.aborted || settled) return;

      sseFallbackRef.current = essayId;
      try {
        const status = await api.getEssayStatus(essayId, { signal: controller.signal });
        if (cancelled) return;
        if (status.status === 'failed') {
          terminalErrorRef.current = {
            essayId,
            message: status.error ?? 'Essay processing failed',
          };
          void refetchReport();
          return;
        }
        if (status.status === 'completed') {
          void refetchReport();
          return;
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
      }

      if (!cancelled) {
        setSseFallbackForId(essayId);
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [essayId, isWaitingForPipeline, refetchReport]);

  return query;
}

export function useOverrideVerdict() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      essayId,
      req,
    }: {
      essayId?: number;
      verdictId?: number | string;
      req: OverrideRequest;
    }) => {
      if (essayId == null || Number.isNaN(Number(essayId))) {
        return Promise.reject(new Error('Valid essayId is required to override verdict'));
      }
      return api.overrideVerdict(Number(essayId), req);
    },
    onSuccess: () => {
      // Invalidate all essay-report queries so updated verdict reloads
      qc.invalidateQueries({ queryKey: ['essay-report'] });
    },
  });
}
