import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, type AnalysisReport } from '@/api/client';
import { streamEssayEvents } from './useEssayStream';

export function useOrphanReport(essayId: number | null) {
  const [sseFallbackForId, setSseFallbackForId] = useState<number | null>(null);
  const sseFallbackRef = useRef<number | null>(null);
  const terminalErrorRef = useRef<{ essayId: number; message: string } | null>(null);

  const sseConnected = essayId === null || sseFallbackForId !== essayId;

  const query = useQuery({
    queryKey: ['essay-report', essayId],
    queryFn: async ({ signal }) => {
      if (essayId === null) throw new Error('essayId required');
      if (terminalErrorRef.current?.essayId === essayId) {
        throw new Error(terminalErrorRef.current.message);
      }
      const report = await api.getEssay(essayId, { signal });
      if (report !== null) {
        if (terminalErrorRef.current?.essayId === essayId) {
          terminalErrorRef.current = null;
        }
        return report;
      }
      if (sseFallbackRef.current !== essayId) {
        return null;
      }
      const status = await api.getEssayStatus(essayId, { signal });
      if (status.status === 'failed') {
        throw new Error(status.error || 'Essay processing failed');
      }
      return null;
    },
    enabled: essayId !== null,
    staleTime: 60_000,
    retry: false,
    refetchInterval: (q) => {
      if (q.state.status === 'error') return false;
      if (sseConnected) return false;
      return q.state.data === null ? 3000 : false;
    },
  });

  const queryData = query.data;
  const queryIsError = query.isError;
  const refetchReport = query.refetch;

  const isWaitingForPipeline =
    essayId !== null &&
    !Number.isNaN(essayId) &&
    essayId > 0 &&
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
              message: snap.error || 'Essay processing failed',
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
            message: status.error || 'Essay processing failed',
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

export type { AnalysisReport };
