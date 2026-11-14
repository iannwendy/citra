import { Search, RotateCcw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import type { CitationMappingStatus, ValidationLabel } from '@/api/client';

/* ============================================================
   Filter Configuration (shared with parent)
   ============================================================ */

export const STATUS_FILTERS: {
  value: CitationMappingStatus;
  label: string;
  labelVi: string;
  dotColor: string;
}[] = [
  { value: 'matched', label: 'Matched', labelVi: 'Đã khớp', dotColor: 'bg-emerald-500' },
  { value: 'missing_reference', label: 'Missing Ref', labelVi: 'Thiếu nguồn', dotColor: 'bg-red-500' },
  { value: 'uncited_reference', label: 'Uncited Ref', labelVi: 'Chưa trích dẫn', dotColor: 'bg-amber-500' },
  { value: 'in_text_mismatch', label: 'Mismatch', labelVi: 'Sai lệch', dotColor: 'bg-amber-500' },
  { value: 'duplicate_reference', label: 'Duplicate', labelVi: 'Trùng lặp', dotColor: 'bg-orange-500' },
  { value: 'ambiguous_mapping', label: 'Ambiguous', labelVi: 'Mơ hồ', dotColor: 'bg-amber-500' },
  { value: 'style_inconsistent', label: 'Style Issue', labelVi: 'Sai chuẩn', dotColor: 'bg-violet-500' },
  { value: 'unresolved', label: 'Unresolved', labelVi: 'Chưa xác định', dotColor: 'bg-slate-400' },
];

export const LABEL_FILTERS: {
  value: ValidationLabel;
  label: string;
  labelVi: string;
  dotColor: string;
}[] = [
  { value: 'verified', label: 'Verified', labelVi: 'Đã xác minh', dotColor: 'bg-emerald-500' },
  { value: 'metadata_error', label: 'Meta Error', labelVi: 'Sai Metadata', dotColor: 'bg-amber-500' },
  { value: 'suspected_hallucination', label: 'Suspected', labelVi: 'Nghi vấn', dotColor: 'bg-red-500' },
  { value: 'unresolved', label: 'Unresolved', labelVi: 'Chưa xác minh', dotColor: 'bg-slate-400' },
  { value: 'resource', label: 'URL / Legal Resource', labelVi: 'Nguồn Web & Pháp quy', dotColor: 'bg-violet-500' },
];

export type ViewMode = 'integrity' | 'source' | 'combined';

export interface CitationGraphStats {
  total: number;
  integrityCounts: Partial<Record<CitationMappingStatus, number>>;
  sourceCounts: Partial<Record<ValidationLabel, number>>;
  overridden: number;
  domainExc: number;
}

export interface CitationGraphControlsProps {
  searchQuery: string;
  onSearchChange: (q: string) => void;
  viewMode: ViewMode;
  onViewModeChange: (m: ViewMode) => void;
  statusFilters: Set<CitationMappingStatus>;
  onToggleStatus: (s: CitationMappingStatus) => void;
  labelFilters: Set<ValidationLabel>;
  onToggleLabel: (l: ValidationLabel) => void;
  filteredCount: number;
  stats: CitationGraphStats;
  hasFilters: boolean;
  onClearFilters: () => void;
}

export function CitationGraphControls({
  searchQuery,
  onSearchChange,
  viewMode,
  onViewModeChange,
  statusFilters,
  onToggleStatus,
  labelFilters,
  onToggleLabel,
  filteredCount,
  stats,
  hasFilters,
  onClearFilters,
}: CitationGraphControlsProps) {
  const { i18n } = useTranslation();
  const isVi = i18n.language?.startsWith('vi');
  const visibleStatusFilters = STATUS_FILTERS.filter(
    (f) => (stats.integrityCounts[f.value] ?? 0) > 0 || statusFilters.has(f.value),
  );
  const visibleLabelFilters = LABEL_FILTERS.filter(
    (f) => (stats.sourceCounts[f.value] ?? 0) > 0 || labelFilters.has(f.value),
  );

  return (
    <div className="space-y-3 w-full min-w-0">
      {/* Row 1: Search Input + Segmented View Mode Toggle */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 w-full min-w-0">
        <div className="relative flex-1 min-w-0">
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 pointer-events-none"
            aria-hidden="true"
          />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={
              isVi
                ? 'Tìm theo tác giả, tiêu đề, năm, [#]...'
                : 'Search by author, title, year, [#]...'
            }
            aria-label={isVi ? 'Tìm kiếm trích dẫn' : 'Search citations'}
            className="w-full h-9 pl-9 pr-3 rounded-xl text-xs sm:text-sm bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500"
          />
        </div>

        <div className="flex items-center justify-between sm:justify-end gap-2 shrink-0">
          <div
            role="group"
            aria-label={isVi ? 'Chế độ xem trích dẫn' : 'Citation view mode'}
            className="inline-flex bg-slate-200/70 dark:bg-slate-800 rounded-xl p-0.5 border border-slate-200 dark:border-slate-700"
          >
            {(['combined', 'integrity', 'source'] as ViewMode[]).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => onViewModeChange(mode)}
                aria-pressed={viewMode === mode}
                className={cn(
                  'px-2.5 py-1 text-[11px] font-mono rounded-lg transition-all cursor-pointer',
                  viewMode === mode
                    ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-2xs font-bold'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200',
                )}
              >
                {mode === 'combined'
                  ? isVi
                    ? 'Tất cả tầng'
                    : 'All Layers'
                  : mode === 'integrity'
                    ? isVi
                      ? 'Tầng 1 Liên kết'
                      : 'L1 Mapping'
                    : isVi
                      ? 'Tầng 2 Nguồn'
                      : 'L2 Source'}
              </button>
            ))}
          </div>

          {hasFilters && (
            <button
              type="button"
              onClick={onClearFilters}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-[11px] font-mono font-semibold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/70 border border-indigo-200 dark:border-indigo-800 hover:bg-indigo-100 transition-colors cursor-pointer shrink-0"
            >
              <RotateCcw className="h-3 w-3" />
              <span>{isVi ? 'Đặt lại' : 'Reset'}</span>
            </button>
          )}
        </div>
      </div>

      {/* Row 2: Active Category Filter Pills (only non-zero counts shown to prevent mobile clutter) */}
      <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
        <span className="text-[11px] font-mono font-semibold text-slate-500 dark:text-slate-400 mr-1">
          {isVi ? `Hiển thị ${filteredCount}/${stats.total}:` : `Showing ${filteredCount}/${stats.total}:`}
        </span>

        {(viewMode === 'integrity' || viewMode === 'combined') &&
          visibleStatusFilters.map((f) => {
            const count = stats.integrityCounts[f.value] ?? 0;
            const active = statusFilters.has(f.value);
            return (
              <button
                key={`status-${f.value}`}
                type="button"
                onClick={() => onToggleStatus(f.value)}
                aria-pressed={active}
                className={cn(
                  'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-mono transition-all border cursor-pointer',
                  active
                    ? 'border-indigo-500 bg-indigo-600 text-white font-semibold shadow-2xs'
                    : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-slate-700 dark:text-slate-300 hover:border-indigo-300 dark:hover:border-indigo-700',
                )}
              >
                <span
                  className={cn(
                    'w-1.5 h-1.5 rounded-full shrink-0',
                    active ? 'bg-white' : f.dotColor,
                  )}
                />
                <span>{isVi ? f.labelVi : f.label}</span>
                <span
                  className={cn(
                    'text-[10px]',
                    active ? 'text-indigo-100' : 'text-slate-400 dark:text-slate-500',
                  )}
                >
                  ({count})
                </span>
              </button>
            );
          })}

        {(viewMode === 'source' || viewMode === 'combined') &&
          visibleLabelFilters.map((f) => {
            const count = stats.sourceCounts[f.value] ?? 0;
            const active = labelFilters.has(f.value);
            return (
              <button
                key={`label-${f.value}`}
                type="button"
                data-testid={`graph-label-filter-${f.value}`}
                onClick={() => onToggleLabel(f.value)}
                aria-pressed={active}
                className={cn(
                  'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-mono transition-all border cursor-pointer',
                  active
                    ? 'border-indigo-500 bg-indigo-600 text-white font-semibold shadow-2xs'
                    : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-slate-700 dark:text-slate-300 hover:border-indigo-300 dark:hover:border-indigo-700',
                )}
              >
                <span
                  className={cn(
                    'w-1.5 h-1.5 rounded-full shrink-0',
                    active ? 'bg-white' : f.dotColor,
                  )}
                />
                <span>{isVi ? f.labelVi : f.label}</span>
                <span
                  className={cn(
                    'text-[10px]',
                    active ? 'text-indigo-100' : 'text-slate-400 dark:text-slate-500',
                  )}
                >
                  ({count})
                </span>
              </button>
            );
          })}
      </div>
    </div>
  );
}
