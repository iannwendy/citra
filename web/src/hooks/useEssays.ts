import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, type EssaySummary, type AnalysisReport, type EssayStats } from '@/api/client';

const ESSAYS_KEY = ['essays'] as const;

export function useEssays() {
  return useQuery({
    queryKey: ESSAYS_KEY,
    queryFn: () => api.listEssays(),
    staleTime: 30_000,
  });
}

export function useDeleteEssay() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.deleteEssay(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ESSAYS_KEY });
    },
  });
}

export interface DashboardStats {
  total_documents: number;
  total_citations: number;
  avg_cis_score: number | null;
  verified_rate: number;
}

/**
 * Aggregate stats từ essays + reports.
 * Loop qua essays, fetch report, tính tổng. Skip essay nào lỗi.
 */
async function loadClientSideStats(essays: EssaySummary[]): Promise<DashboardStats> {
  let totalCitations = 0;
  let totalCIS = 0;
  let cisCount = 0;
  let totalVerified = 0;
  let totalVerdicts = 0;

  await Promise.all(
    essays.map(async (essay) => {
      // Fast path: use summary fields included in GET /api/essays response (no N+1 call)
      if (
        typeof essay.num_citations === 'number' &&
        typeof essay.num_verdicts === 'number' &&
        typeof essay.num_verified === 'number'
      ) {
        totalCitations += essay.num_citations;
        if (essay.cis_score != null && essay.cis_score > 0) {
          totalCIS += essay.cis_score;
          cisCount++;
        }
        totalVerdicts += essay.num_verdicts;
        totalVerified += essay.num_verified;
        return;
      }

      // Fallback path for mocked/legacy essay payloads without summary metrics
      try {
        const report: AnalysisReport | null = await api.getEssay(essay.id);
        if (!report) return;
        totalCitations += report.num_citations || 0;
        if (report.cis?.score) {
          totalCIS += report.cis.score;
          cisCount++;
        }
        if (Array.isArray(report.verdicts)) {
          totalVerdicts += report.verdicts.length;
          totalVerified += report.verdicts.filter(
            (v) => v.label === 'verified' || v.is_overridden,
          ).length;
        }
      } catch {
        // Skip essay đang processing (425) hoặc lỗi
      }
    }),
  );

  return {
    total_documents: essays.length,
    total_citations: totalCitations,
    avg_cis_score: cisCount > 0 ? Math.round((totalCIS / cisCount) * 100) / 100 : null,
    verified_rate:
      totalVerdicts > 0 ? Math.round((totalVerified / totalVerdicts) * 100) : 0,
  };
}

function isEssayStats(value: unknown): value is EssayStats {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return typeof v.total_essays === 'number' && typeof v.total_citations === 'number';
}

/**
 * Dashboard aggregates. Prefers the server-side `GET /essays/stats` (C2) which
 * covers every essay visible to the caller; falls back to the client-side
 * computation when the endpoint is missing (404) or errors. The average CIS is
 * not part of C2, so it always comes from the essay summaries.
 */
export async function loadDashboardStats(essays: EssaySummary[]): Promise<DashboardStats> {
  let remote: EssayStats | null = null;
  try {
    const res = await api.getEssayStats();
    remote = isEssayStats(res) ? res : null;
  } catch {
    remote = null;
  }
  const local = await loadClientSideStats(essays);
  if (!remote) return local;

  const labelTotal =
    (remote.verified ?? 0) +
    (remote.metadata_error ?? 0) +
    (remote.suspected_hallucination ?? 0) +
    (remote.unresolved ?? 0) +
    (remote.resource ?? 0);
  return {
    total_documents: remote.total_essays,
    total_citations: remote.total_citations,
    avg_cis_score: local.avg_cis_score,
    verified_rate: labelTotal > 0 ? Math.round(((remote.verified ?? 0) / labelTotal) * 100) : 0,
  };
}

export function useDashboardStats() {
  const { data: essays = [] } = useEssays();
  return useQuery({
    queryKey: ['dashboard-stats', essays.map((e) => e.id).join(',')],
    queryFn: () => loadDashboardStats(essays),
    enabled: essays.length > 0,
    staleTime: 30_000,
  });
}

export type { EssaySummary };
