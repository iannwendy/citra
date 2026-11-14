import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ChevronUp,
  ChevronDown,
  GitBranch,
  Database,
  Brain,
  Link2,
} from 'lucide-react';
import type {
  Verdict,
  CitationMappingStatus,
  ValidationLabel,
  MappingStatusSummary,
} from '@/api/client';
import { MappingStatusBadge } from '../MappingStatusBadge';
import { VerdictBadge } from '../VerdictBadge';
import { OverrideControls } from '../OverrideControls';
import {
  CitationGraphControls,
  type ViewMode,
  type CitationGraphStats,
} from '../graph/CitationGraphControls';
import { EvidenceGraph } from './EvidenceGraph';
import { isUrlResource } from '@/lib/verdictExplanation';

interface CitationGraphViewProps {
  verdicts: Verdict[];
  linkingSummary?: MappingStatusSummary;
  onSelect: (v: Verdict) => void;
  onOverride?: (
    verdict: Verdict,
    req: Parameters<typeof import('@/api/client').api.overrideVerdict>[1]
  ) => Promise<void>;
}

function SortIcon({
  sorted,
  direction,
}: {
  sorted: boolean;
  direction: 'asc' | 'desc';
}) {
  if (!sorted) return <ChevronUp className="h-3 w-3 text-slate-400" />;
  return direction === 'asc' ? (
    <ChevronUp className="h-3 w-3 text-indigo-600 dark:text-indigo-400" />
  ) : (
    <ChevronDown className="h-3 w-3 text-indigo-600 dark:text-indigo-400" />
  );
}

function getCardLeftAccent(v: Verdict): string {
  if (isUrlResource(v)) return 'border-l-violet-500';
  switch (v.label) {
    case 'verified':
      return 'border-l-emerald-500';
    case 'metadata_error':
      return 'border-l-amber-500';
    case 'suspected_hallucination':
      return 'border-l-red-500';
    default:
      return 'border-l-slate-400';
  }
}

export function CitationGraphView({
  verdicts,
  linkingSummary: _linkingSummary,
  onSelect,
  onOverride,
}: CitationGraphViewProps) {
  const { i18n } = useTranslation();
  const isVi = i18n.language?.startsWith('vi');
  const [viewMode, setViewMode] = useState<ViewMode>('combined');
  const [statusFilters, setStatusFilters] = useState<
    Set<CitationMappingStatus>
  >(new Set());
  const [labelFilters, setLabelFilters] = useState<Set<ValidationLabel>>(
    new Set(),
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [activeId, setActiveId] = useState<string | null>(
    verdicts[0]?.citation_id ?? null,
  );

  const filtered = useMemo(() => {
    return verdicts.filter((v) => {
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        if (!v.citation_raw?.toLowerCase().includes(query)) {
          return false;
        }
      }
      const statusOk =
        statusFilters.size === 0 || statusFilters.has(v.mapping_status);
      const labelOk = labelFilters.size === 0 || labelFilters.has(v.label);
      return statusOk && labelOk;
    });
  }, [verdicts, searchQuery, statusFilters, labelFilters]);

  const activeVerdict = useMemo(() => {
    return (
      filtered.find((v) => v.citation_id === activeId) ||
      filtered[0] ||
      verdicts[0] ||
      null
    );
  }, [filtered, verdicts, activeId]);

  function toggleStatus(s: CitationMappingStatus) {
    setStatusFilters((prev) => {
      const next = new Set(prev);
      if (next.has(s)) {
        next.delete(s);
      } else {
        next.add(s);
      }
      return next;
    });
  }

  function toggleLabel(l: ValidationLabel) {
    setLabelFilters((prev) => {
      const next = new Set(prev);
      if (next.has(l)) {
        next.delete(l);
      } else {
        next.add(l);
      }
      return next;
    });
  }

  function clearFilters() {
    setStatusFilters(new Set());
    setLabelFilters(new Set());
    setSearchQuery('');
  }

  const stats = useMemo(() => {
    const total = verdicts.length;
    const integrityCounts: Partial<Record<CitationMappingStatus, number>> = {};
    const sourceCounts: Partial<Record<ValidationLabel, number>> = {};
    let overridden = 0;
    let domainExc = 0;

    for (const v of verdicts) {
      integrityCounts[v.mapping_status] =
        (integrityCounts[v.mapping_status] ?? 0) + 1;
      sourceCounts[v.label] = (sourceCounts[v.label] ?? 0) + 1;
      if (v.is_overridden) overridden++;
      if (v.domain_exception) domainExc++;
    }

    return { total, integrityCounts, sourceCounts, overridden, domainExc };
  }, [verdicts]);

  const hasFilters =
    statusFilters.size > 0 || labelFilters.size > 0 || searchQuery.length > 0;

  return (
    <div
      className="space-y-4 p-3 sm:p-5 bg-white dark:bg-slate-950 w-full min-w-0 max-w-full overflow-hidden"
      data-testid="citation-graph-view"
    >
      {/* Top Architecture Header & Controls */}
      <div className="rounded-xl border border-slate-200/90 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/60 p-3.5 sm:p-4 w-full min-w-0 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2.5 mb-3 pb-3 border-b border-slate-200/80 dark:border-slate-800">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="p-2 rounded-lg bg-indigo-50 dark:bg-indigo-950/90 border border-indigo-200/70 dark:border-indigo-800 shrink-0">
              <GitBranch className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
            </div>
            <div className="min-w-0">
              <h3 className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white truncate">
                {isVi
                  ? 'Trình Khám Phá Mạng Lưới Trích Dẫn & Nguồn 2 Tầng'
                  : 'Two-Layer Citation & Source Network Explorer'}
              </h3>
              <p className="text-[11px] sm:text-xs text-slate-500 dark:text-slate-400 truncate">
                {isVi
                  ? 'Chọn trích dẫn bất kỳ để kiểm tra đồ thị bằng chứng Neuro-Symbolic (DAG)'
                  : 'Select any citation to inspect its Neuro-Symbolic Evidence DAG'}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-mono shrink-0">
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-300 border border-emerald-200/70 dark:border-emerald-800">
              <Link2 className="h-3 w-3 shrink-0" />
              <span>
                {isVi ? 'Tầng 1 Liên kết:' : 'L1 Linked:'} {stats.integrityCounts.matched ?? 0}/{stats.total}
              </span>
            </span>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-indigo-50 dark:bg-indigo-950/80 text-indigo-700 dark:text-indigo-300 border border-indigo-200/70 dark:border-indigo-800">
              <Database className="h-3 w-3 shrink-0" />
              <span>
                {isVi ? 'Tầng 2 Xác minh:' : 'L2 Verified:'} {stats.sourceCounts.verified ?? 0}/{stats.total}
              </span>
            </span>
          </div>
        </div>

        <CitationGraphControls
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          statusFilters={statusFilters}
          onToggleStatus={toggleStatus}
          labelFilters={labelFilters}
          onToggleLabel={toggleLabel}
          filteredCount={filtered.length}
          stats={stats satisfies CitationGraphStats}
          hasFilters={hasFilters}
          onClearFilters={clearFilters}
        />
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-12 text-slate-500 dark:text-slate-400 border border-dashed border-slate-200 dark:border-slate-800 rounded-xl">
          <p className="text-sm italic">
            {isVi ? 'Không có trích dẫn nào khớp với bộ lọc.' : 'No citations match your filters.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-5 items-start w-full min-w-0">
          {/* Left Column: Interactive Citation Node Stream (5 cols on desktop) */}
          <div className="lg:col-span-5 space-y-2.5 lg:max-h-[680px] lg:overflow-y-auto lg:pr-1 w-full min-w-0">
            {filtered.map((v, i) => {
              const isSelected = activeVerdict?.citation_id === v.citation_id;
              return (
                <div key={v.citation_id ?? i} className="w-full min-w-0 space-y-2">
                  <div
                    onClick={() => {
                      setActiveId(v.citation_id);
                      onSelect(v);
                    }}
                    className={`w-full min-w-0 max-w-full overflow-hidden border border-l-4 rounded-xl p-3 sm:p-3.5 cursor-pointer transition-all ${getCardLeftAccent(
                      v,
                    )} ${
                      isSelected
                        ? 'border-indigo-500 bg-indigo-50/50 dark:bg-indigo-950/40 ring-1 ring-indigo-500/30 shadow-xs'
                        : 'border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-indigo-300 dark:hover:border-indigo-700'
                    }`}
                  >
                    {/* Top Row: Badges on left, Telemetry pills on right */}
                    <div className="flex flex-wrap items-center justify-between gap-1.5 mb-2">
                      <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                        {viewMode !== 'source' && (
                          <MappingStatusBadge status={v.mapping_status} size="sm" />
                        )}
                        {viewMode !== 'integrity' && (
                          <VerdictBadge
                            verdict={isUrlResource(v) ? 'resource' : v.label}
                            triggeredRules={v.triggered_rules}
                            size="sm"
                          />
                        )}
                        {v.is_overridden && (
                          <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300">
                            {isVi ? 'ĐÃ GHI ĐÈ' : 'OVERRIDDEN'}
                          </span>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-1 text-[10px] font-mono shrink-0">
                        <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                          {isVi ? 'nguồn' : 'src'} {(v.confidence * 100).toFixed(0)}%
                        </span>
                        <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                          {isVi ? 'liên kết' : 'link'} {(v.mapping_confidence * 100).toFixed(0)}%
                        </span>
                        {v.features?.content_alignment_score !== undefined &&
                          v.features.content_alignment_score > 0 && (
                            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-violet-50 dark:bg-violet-950/70 text-violet-700 dark:text-violet-300 font-semibold">
                              <Brain className="h-2.5 w-2.5 shrink-0" />
                              {Math.round(v.features.content_alignment_score * 100)}%
                            </span>
                          )}
                      </div>
                    </div>

                    {/* Bottom Row: Full-width Citation Reference Text */}
                    <div className="flex items-start justify-between gap-2 w-full min-w-0">
                      <p
                        className="text-xs sm:text-sm font-medium text-slate-900 dark:text-slate-100 font-serif leading-relaxed break-words [overflow-wrap:anywhere] line-clamp-2 flex-1 min-w-0"
                        title={v.citation_raw}
                      >
                        {v.citation_raw}
                      </p>

                      {onOverride && (
                        <div
                          className="shrink-0"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <OverrideControls
                            verdict={v}
                            onOverride={(req) => onOverride(v, req)}
                          />
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Mobile/Tablet Inline Accordion Graph (visible on < lg directly below selected card) */}
                  {isSelected && activeVerdict && (
                    <div className="lg:hidden rounded-2xl border border-indigo-200/90 dark:border-indigo-900/80 bg-slate-50/70 dark:bg-slate-900/60 p-3 sm:p-4 w-full min-w-0 max-w-full overflow-hidden shadow-xs">
                      <EvidenceGraph verdict={activeVerdict} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Right Column: Sticky Live Evidence Graph DAG on Desktop (7 cols on lg+) */}
          <div className="hidden lg:block lg:col-span-7 lg:sticky lg:top-4 rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/40 p-4 sm:p-5 w-full min-w-0 overflow-hidden">
            {activeVerdict && <EvidenceGraph verdict={activeVerdict} />}
          </div>
        </div>
      )}
    </div>
  );
}

export { SortIcon };
