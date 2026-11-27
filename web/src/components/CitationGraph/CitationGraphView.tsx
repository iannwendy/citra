import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ChevronUp,
  ChevronDown,
  GitBranch,
  Database,
  Link2,
  Search,
  GripVertical,
} from 'lucide-react';
import type {
  Citation,
  Verdict,
  CitationMappingStatus,
  ValidationLabel,
  MappingStatusSummary,
} from '@/api/client';
import { MappingStatusBadge } from '../MappingStatusBadge';
import { VerdictBadge } from '../VerdictBadge';
import {
  CitationGraphControls,
  type ViewMode,
  type CitationGraphStats,
} from '../graph/CitationGraphControls';
import {
  InteractiveDecisionFlowBoard,
  extractCleanCitationIdentity,
} from './InteractiveDecisionFlowBoard';
import { DirectionalStageSlide, useSlidingPill } from '@/components/ui/transitions';
import { getCitationMarkerLabel, isUrlResource } from '@/lib/verdictExplanation';
import {
  formatAcademicAuthorShort,
  getVerdictDisplay,
  normalizeVerdictKey,
} from '@/lib/academicTaxonomy';

interface CitationGraphViewProps {
  verdicts: Verdict[];
  references?: Citation[];
  linkingSummary?: MappingStatusSummary;
  selectedCitationId?: string | null;
  onSelect: (v: Verdict) => void;
  onInspectDetails?: (v: Verdict) => void;
  onOverride?: (
    verdict: Verdict,
    req: Parameters<typeof import('@/api/client').api.overrideVerdict>[1]
  ) => Promise<void>;
}

function findMatchedReferenceForVerdict(
  verdict: Verdict,
  references: Citation[] | undefined,
): Citation | null {
  if (!references || references.length === 0) return null;
  const refId = verdict.citation_link?.reference_id;
  if (refId) {
    const exact = references.find((r) => r.reference_id === refId);
    if (exact) return exact;
    if (/^ref-0*\d+$/.test(refId)) {
      const idxNum = parseInt(refId.replace(/^ref-/, ''), 10);
      if (!Number.isNaN(idxNum) && idxNum >= 1 && idxNum <= references.length) {
        return references[idxNum - 1];
      }
    }
  }
  const rawTrimmed = (verdict.citation_raw ?? '').trim();
  const rawLower = rawTrimmed.toLowerCase();
  return (
    references.find(
      (r) =>
        (r.raw_text ?? '').trim() === rawTrimmed ||
        (r.title && rawLower.includes(r.title.toLowerCase().slice(0, 35))),
    ) ?? null
  );
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

export function CitationGraphView({
  verdicts,
  references,
  linkingSummary: _linkingSummary,
  selectedCitationId,
  onSelect,
  onInspectDetails,
  onOverride,
}: CitationGraphViewProps) {
  const { i18n } = useTranslation();
  const isVi = Boolean(i18n.language?.startsWith('vi'));
  const isCleanEmbeddedMode = Boolean(onInspectDetails);

  const [viewMode, setViewMode] = useState<ViewMode>('combined');
  const [statusFilters, setStatusFilters] = useState<
    Set<CitationMappingStatus>
  >(new Set());
  const [labelFilters, setLabelFilters] = useState<Set<ValidationLabel>>(
    new Set(),
  );
  const [cleanFilter, setCleanFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeId, setActiveId] = useState<string | null>(
    selectedCitationId ?? verdicts[0]?.citation_id ?? null,
  );

  // Interactive Left-Right Split Resizer state (20% .. 56%, default 32%)
  const DEFAULT_SPLIT_PCT = 32;
  const MIN_SPLIT_PCT = 20;
  const MAX_SPLIT_PCT = 56;
  const [splitPct, setSplitPct] = useState<number>(() => {
    try {
      if (typeof window === 'undefined') return DEFAULT_SPLIT_PCT;
      const raw = Number(localStorage.getItem('citra.network.splitPct'));
      if (Number.isFinite(raw) && raw >= MIN_SPLIT_PCT && raw <= MAX_SPLIT_PCT) {
        return raw;
      }
    } catch {
      // Ignore storage errors
    }
    return DEFAULT_SPLIT_PCT;
  });
  const [isResizing, setIsResizing] = useState(false);
  const splitContainerRef = useRef<HTMLDivElement | null>(null);

  const commitSplitPct = useCallback((next: number) => {
    const clamped = Math.min(
      MAX_SPLIT_PCT,
      Math.max(MIN_SPLIT_PCT, Math.round(next * 10) / 10),
    );
    setSplitPct(clamped);
    try {
      localStorage.setItem('citra.network.splitPct', String(clamped));
    } catch {
      // Ignore storage errors
    }
  }, []);

  const handleResizerPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      const container = splitContainerRef.current;
      if (!container) return;
      e.preventDefault();
      const rect = container.getBoundingClientRect();
      if (rect.width <= 0) return;

      setIsResizing(true);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';

      let rafId: number | null = null;
      const onMove = (ev: PointerEvent) => {
        const pct = ((ev.clientX - rect.left) / rect.width) * 100;
        if (rafId !== null) cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(() => {
          commitSplitPct(pct);
          rafId = null;
        });
      };

      const onUp = () => {
        if (rafId !== null) cancelAnimationFrame(rafId);
        setIsResizing(false);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    },
    [commitSplitPct],
  );

  const handleResizerKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        commitSplitPct(splitPct - 3);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        commitSplitPct(splitPct + 3);
      } else if (e.key === 'Home') {
        e.preventDefault();
        commitSplitPct(MIN_SPLIT_PCT);
      } else if (e.key === 'End') {
        e.preventDefault();
        commitSplitPct(MAX_SPLIT_PCT);
      }
    },
    [commitSplitPct, splitPct],
  );

  const { containerRef: cleanFilterRef, pillStyle: cleanFilterPill } =
    useSlidingPill<HTMLDivElement>(`${cleanFilter}-${i18n.language}`);

  useEffect(() => {
    if (selectedCitationId) {
      setActiveId(selectedCitationId);
    }
  }, [selectedCitationId]);

  const indexedVerdicts = useMemo(() => {
    return verdicts.map((v, idx) => ({
      verdict: v,
      citedRef: findMatchedReferenceForVerdict(v, references),
      originalIndex: idx,
      marker: getCitationMarkerLabel(v, idx),
      effectiveLabel: (isUrlResource(v)
        ? 'resource'
        : normalizeVerdictKey(v.label)) as ValidationLabel,
    }));
  }, [verdicts, references]);

  const filtered = useMemo(() => {
    return indexedVerdicts.filter(({ verdict: v, marker, effectiveLabel }) => {
      if (searchQuery) {
        const query = searchQuery.trim().toLowerCase();
        if (query) {
          const matchesRaw = v.citation_raw?.toLowerCase().includes(query) ?? false;
          const matchesMarker =
            marker.toLowerCase().includes(query) ||
            Boolean(
              v.composite_label &&
                v.composite_label
                  .toLowerCase()
                  .includes(query.replace(/^\[|\]$/g, '')),
            );
          if (!matchesRaw && !matchesMarker) {
            return false;
          }
        }
      }
      if (isCleanEmbeddedMode) {
        if (cleanFilter === 'all') return true;
        if (cleanFilter === 'attention') {
          return (
            effectiveLabel === 'metadata_error' ||
            effectiveLabel === 'suspected_hallucination' ||
            effectiveLabel === 'unresolved'
          );
        }
        return effectiveLabel === cleanFilter;
      }
      const statusOk =
        statusFilters.size === 0 || statusFilters.has(v.mapping_status);
      const labelOk =
        labelFilters.size === 0 || labelFilters.has(effectiveLabel);
      return statusOk && labelOk;
    });
  }, [
    indexedVerdicts,
    searchQuery,
    isCleanEmbeddedMode,
    cleanFilter,
    statusFilters,
    labelFilters,
  ]);

  const activeEntry = useMemo(() => {
    return (
      filtered.find((item) => item.verdict.citation_id === activeId) ||
      filtered[0] ||
      indexedVerdicts[0] ||
      null
    );
  }, [filtered, indexedVerdicts, activeId]);

  const activeVerdict = activeEntry?.verdict ?? null;

  const activeStageIdx = useMemo(() => {
    if (!activeVerdict) return 0;
    const idx = indexedVerdicts.findIndex(
      (item) => item.verdict.citation_id === activeVerdict.citation_id,
    );
    return Math.max(0, idx);
  }, [indexedVerdicts, activeVerdict]);

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
    const total = indexedVerdicts.length;
    const integrityCounts: Partial<Record<CitationMappingStatus, number>> = {};
    const sourceCounts: Partial<Record<ValidationLabel, number>> = {};
    let overridden = 0;
    let domainExc = 0;

    for (const { verdict: v, effectiveLabel } of indexedVerdicts) {
      integrityCounts[v.mapping_status] =
        (integrityCounts[v.mapping_status] ?? 0) + 1;
      sourceCounts[effectiveLabel] = (sourceCounts[effectiveLabel] ?? 0) + 1;
      if (v.is_overridden) overridden++;
      if (v.domain_exception) domainExc++;
    }

    return { total, integrityCounts, sourceCounts, overridden, domainExc };
  }, [indexedVerdicts]);

  const resourceCount = stats.sourceCounts.resource ?? 0;
  const scholarlyDenom =
    stats.total > resourceCount ? Math.max(1, stats.total - resourceCount) : 0;
  const l2VerifiedCount = stats.sourceCounts.verified ?? 0;
  const l2VerifiedPct =
    scholarlyDenom > 0 ? Math.round((l2VerifiedCount / scholarlyDenom) * 100) : null;

  const hasFilters =
    statusFilters.size > 0 || labelFilters.size > 0 || searchQuery.length > 0;

  const cleanAttentionCount =
    (stats.sourceCounts.metadata_error ?? 0) +
    (stats.sourceCounts.suspected_hallucination ?? 0) +
    (stats.sourceCounts.unresolved ?? 0);

  const lang: 'vi' | 'en' = isVi ? 'vi' : 'en';
  const cleanFilterOptions = [
    { key: 'all', label: isVi ? `Tất cả (${stats.total})` : `All (${stats.total})`, show: true },
    {
      key: 'verified',
      label: `✓ ${getVerdictDisplay('verified', lang).label} (${stats.sourceCounts.verified ?? 0})`,
      show: (stats.sourceCounts.verified ?? 0) > 0,
    },
    {
      key: 'attention',
      label: isVi
        ? `⚠ Cần kiểm tra (${cleanAttentionCount})`
        : `⚠ Needs Check (${cleanAttentionCount})`,
      show: cleanAttentionCount > 0,
    },
    {
      key: 'resource',
      label: `🔗 ${getVerdictDisplay('resource', lang).label} (${stats.sourceCounts.resource ?? 0})`,
      show: (stats.sourceCounts.resource ?? 0) > 0,
    },
  ].filter((o) => o.show);

  return (
    <div
      className="bg-white dark:bg-slate-950 w-full min-w-0 max-w-full overflow-hidden"
      data-testid="citation-graph-view"
    >
      {/* Standalone Header & Controls (retained for isolated component renders) */}
      {!isCleanEmbeddedMode && (
        <div className="p-3.5 sm:p-5 pb-0">
          <div className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/60 p-3.5 sm:p-4 w-full min-w-0 overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2.5 mb-3 pb-3 border-b border-slate-200/80 dark:border-slate-800">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="p-2 rounded-lg bg-white dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700 shrink-0 shadow-sm">
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
                      ? 'Chọn tài liệu bất kỳ ở cột trái để xem sơ đồ luồng kiểm chứng trực quan bên phải'
                      : 'Select any reference on the left to inspect its Interactive Verification Flow'}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-mono shrink-0">
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg bg-emerald-50/90 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-300 border border-emerald-200/70 dark:border-emerald-800">
                  <Link2 className="h-3 w-3 shrink-0" />
                  <span>
                    {isVi ? 'Tầng 1 Liên kết:' : 'L1 Linked:'}{' '}
                    {stats.integrityCounts.matched ?? 0}/{stats.total}
                  </span>
                </span>
                <span
                  data-testid="graph-l2-verified-pill"
                  className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200/90 dark:border-slate-700"
                >
                  <Database className="h-3 w-3 shrink-0 text-indigo-600 dark:text-indigo-400" />
                  <span>
                    {isVi ? 'Tầng 2 Xác minh:' : 'L2 Verified:'}{' '}
                    {scholarlyDenom > 0
                      ? `${l2VerifiedCount}/${scholarlyDenom} (${l2VerifiedPct}%)`
                      : `${l2VerifiedCount}/0`}
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
        </div>
      )}

      {/* Main 2-Column Resizable Layout: Left Reference Picker + Drag Handle + Right Flow Board */}
      <div
        ref={splitContainerRef}
        data-testid="network-split-container"
        style={{ '--network-split-pct': `${splitPct}%` } as React.CSSProperties}
        className={
          isCleanEmbeddedMode
            ? 'citra-network-resizable-grid grid grid-cols-1 w-full min-w-0'
            : 'citra-network-resizable-grid grid grid-cols-1 gap-4 lg:gap-0 items-start p-3.5 sm:p-5 w-full min-w-0'
        }
      >
        {/* Left Column: Minimalist, Non-Tech Reference Picker */}
        <div
          className={
            isCleanEmbeddedMode
              ? 'border-b lg:border-b-0 border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/40 flex flex-col lg:h-full min-w-0'
              : 'space-y-2 lg:max-h-[680px] lg:overflow-y-auto lg:pr-2 w-full min-w-0'
          }
        >
          {isCleanEmbeddedMode && (
            <div className="p-3.5 sm:px-4 border-b border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-2.5 shrink-0">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-slate-900 dark:text-white">
                  {isVi
                    ? 'Chọn tài liệu để xem sơ đồ luồng'
                    : 'Select a reference to trace'}
                </span>
                <span className="text-[11px] font-medium text-slate-400 tabular-nums">
                  {filtered.length}/{stats.total}
                </span>
              </div>

              <div className="relative">
                <Search className="h-3.5 w-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={
                    isVi
                      ? 'Tìm tên bài, tác giả, số [7]...'
                      : 'Search title, author, [#]...'
                  }
                  className="w-full pl-8 pr-3 py-1.5 text-xs sm:text-[13px] rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-200 placeholder:text-slate-400 focus:bg-white dark:focus:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/25"
                />
              </div>

              <div
                ref={cleanFilterRef}
                className="t-tabs relative flex flex-wrap gap-1.5"
              >
                <span
                  aria-hidden="true"
                  style={{
                    width: `${cleanFilterPill.width}px`,
                    height: `${cleanFilterPill.height}px`,
                    transform: `translate3d(${cleanFilterPill.left}px, ${cleanFilterPill.top}px, 0)`,
                    opacity: cleanFilterPill.ready ? 1 : 0,
                    transition: cleanFilterPill.animate ? undefined : 'none',
                  }}
                  className="t-tabs-pill rounded-full bg-slate-900 dark:bg-white shadow-sm"
                />
                {cleanFilterOptions.map((opt) => {
                  const isActive = cleanFilter === opt.key;
                  return (
                    <button
                      key={opt.key}
                      type="button"
                      data-pill-active={isActive ? 'true' : 'false'}
                      onClick={() => setCleanFilter(opt.key)}
                      className={`t-tab px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-colors cursor-pointer ${
                        isActive
                          ? cleanFilterPill.ready
                            ? 'text-white dark:text-slate-900 border-transparent'
                            : 'bg-slate-900 text-white border-slate-900 dark:bg-white dark:text-slate-900 dark:border-white'
                          : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-800 hover:border-slate-300'
                      }`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className={isCleanEmbeddedMode ? 'relative flex-1 min-h-0' : ''}>
            <div
              className={
                isCleanEmbeddedMode
                  ? 'p-3 space-y-2 overflow-y-auto max-h-[340px] lg:max-h-none lg:absolute lg:inset-0'
                  : 'space-y-2'
              }
            >
            {filtered.length === 0 ? (
              <div className="py-10 text-center text-xs text-slate-500 dark:text-slate-400 italic">
                {isVi
                  ? 'Không có trích dẫn nào khớp với bộ lọc.'
                  : 'No citations match your filters.'}
              </div>
            ) : (
              filtered.map(({ verdict: v, citedRef, marker, effectiveLabel }, i) => {
                const isSelected = activeVerdict?.citation_id === v.citation_id;
                const isIncompleteRef = (v.triggered_rules ?? []).includes(
                  'R-INCOMPLETE-METADATA',
                );
                const cleanedRawText =
                  v.citation_raw
                    ?.replace(/^\s*(?:\[\s*\d+[a-z]?\s*\]|\d+[a-z]?[.)])\s*/i, '')
                    .trim() || v.citation_raw;
                const parsedIdentity = extractCleanCitationIdentity(
                  v.citation_raw,
                  v.matched_sources?.[0],
                  citedRef
                    ? {
                        citedYear: citedRef.year,
                        citedAuthors: citedRef.authors,
                        citedTitle: citedRef.title,
                      }
                    : undefined,
                );
                const shortAuthorLabel =
                  parsedIdentity.shortHeader ||
                  formatAcademicAuthorShort(
                    v.matched_sources?.[0]?.authors,
                    cleanedRawText,
                    lang,
                  );
                return (
                  <div key={v.citation_id ?? i} className="w-full min-w-0 space-y-2">
                    <div
                      data-testid={`graph-ref-card-${i}`}
                      data-selected={isSelected ? 'true' : 'false'}
                      onClick={() => {
                        setActiveId(v.citation_id);
                        onSelect(v);
                      }}
                      className={`group relative w-full min-w-0 max-w-full overflow-hidden border rounded-xl p-3 cursor-pointer transition-all duration-150 ${
                        isSelected
                          ? 'border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800/90 shadow-[0_2px_10px_-3px_rgba(15,23,42,0.08)]'
                          : 'border-slate-200/80 dark:border-slate-800/90 bg-white/85 dark:bg-slate-900 hover:border-slate-300 dark:hover:border-slate-700 hover:bg-white dark:hover:bg-slate-800/50'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 mb-1.5 min-w-0">
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          <span
                            data-testid="graph-sidebar-marker"
                            className={`font-mono text-[11px] font-bold px-1.5 py-0.5 rounded-md shrink-0 transition-colors ${
                              isSelected
                                ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900 shadow-sm'
                                : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200'
                            }`}
                          >
                            {marker}
                          </span>
                          {shortAuthorLabel && (
                            <span
                              data-testid="graph-sidebar-author"
                              className="text-xs font-semibold text-slate-800 dark:text-slate-100 truncate"
                            >
                              {shortAuthorLabel}
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-1.5 flex-wrap justify-end shrink-0">
                          {!isCleanEmbeddedMode && viewMode !== 'source' && (
                            <MappingStatusBadge status={v.mapping_status} size="sm" />
                          )}
                          {(isCleanEmbeddedMode || viewMode !== 'integrity') && (
                            <VerdictBadge
                              verdict={effectiveLabel}
                              triggeredRules={v.triggered_rules}
                              size="sm"
                            />
                          )}
                          {isIncompleteRef && !isCleanEmbeddedMode && (
                            <span
                              data-testid="graph-incomplete-ref-badge"
                              className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-amber-50 dark:bg-amber-950/80 text-amber-800 dark:text-amber-300 border border-amber-200/80 dark:border-amber-800"
                            >
                              {isVi ? 'Thiếu quy cách' : 'Incomplete Ref'}
                            </span>
                          )}
                        </div>
                      </div>

                      <p
                        className={`text-xs sm:text-[13px] leading-snug break-words [overflow-wrap:anywhere] line-clamp-2 ${
                          isSelected
                            ? 'font-semibold text-slate-900 dark:text-white'
                            : 'font-normal text-slate-600 dark:text-slate-300 group-hover:text-slate-900 dark:group-hover:text-white'
                        }`}
                      >
                        {cleanedRawText}
                      </p>
                    </div>
                  </div>
                );
              })
            )}
            </div>
          </div>
        </div>

        {/* Interactive Left-Right Drag Resizer Handle (Desktop lg+) */}
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label={
            isVi
              ? 'Kéo sang trái hoặc phải để chỉnh độ rộng hai cột (nhấp đúp để đặt lại)'
              : 'Drag left or right to resize columns (double-click to reset)'
          }
          aria-valuemin={MIN_SPLIT_PCT}
          aria-valuemax={MAX_SPLIT_PCT}
          aria-valuenow={Math.round(splitPct)}
          tabIndex={0}
          data-testid="network-split-resizer"
          title={
            isVi
              ? 'Kéo trái/phải để chỉnh độ rộng · Nhấp đúp để đặt lại'
              : 'Drag left/right to resize · Double-click to reset'
          }
          onPointerDown={handleResizerPointerDown}
          onDoubleClick={() => commitSplitPct(DEFAULT_SPLIT_PCT)}
          onKeyDown={handleResizerKeyDown}
          className="hidden lg:flex items-center justify-center self-stretch relative cursor-col-resize select-none group/resizer focus:outline-none z-20"
        >
          {/* Crisp 1px vertical seam that lights up on hover/drag */}
          <div
            aria-hidden="true"
            className={`absolute inset-y-0 left-1/2 -translate-x-1/2 transition-all duration-150 ${
              isResizing
                ? 'w-[2px] bg-indigo-500 dark:bg-emerald-400'
                : 'w-px bg-slate-200 dark:bg-slate-800 group-hover/resizer:w-[2px] group-hover/resizer:bg-indigo-400 dark:group-hover/resizer:bg-emerald-400/80 group-focus-visible/resizer:w-[2px] group-focus-visible/resizer:bg-indigo-500'
            }`}
          />
          {/* Tactile Centered Grip Pill */}
          <div
            aria-hidden="true"
            className={`relative z-10 h-9 w-3.5 rounded-full border flex items-center justify-center transition-all duration-150 shadow-sm ${
              isResizing
                ? 'border-indigo-500 dark:border-emerald-400 bg-indigo-50 dark:bg-emerald-950 scale-110'
                : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 group-hover/resizer:border-indigo-400 dark:group-hover/resizer:border-emerald-400 group-hover/resizer:scale-105'
            }`}
          >
            <GripVertical
              className={`h-3 w-3 ${
                isResizing
                  ? 'text-indigo-600 dark:text-emerald-300'
                  : 'text-slate-400 group-hover/resizer:text-indigo-600 dark:group-hover/resizer:text-emerald-300'
              }`}
            />
          </div>
        </div>

        {/* Right Column: Exhibition-Grade Interactive Decision Flow Board */}
        <div
          className={
            isCleanEmbeddedMode
              ? 'p-4 sm:p-5 bg-white dark:bg-slate-950 min-w-0'
              : 'lg:sticky lg:top-4 lg:pl-3 w-full min-w-0'
          }
        >
          {activeVerdict && (
            <DirectionalStageSlide
              stageKey={activeStageIdx}
              distancePx={12}
              data-testid="network-evidence-stage"
            >
              <InteractiveDecisionFlowBoard
                verdict={activeVerdict}
                citedRef={activeEntry?.citedRef}
                markerLabel={activeEntry?.marker}
                onInspectDetails={onInspectDetails}
                onOverride={onOverride}
              />
            </DirectionalStageSlide>
          )}
        </div>
      </div>
    </div>
  );
}

export { SortIcon };
