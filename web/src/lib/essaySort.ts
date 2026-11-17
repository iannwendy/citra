import type { EssaySummary } from '@/api/client';

export type EssaySortOption =
  | 'date_desc'
  | 'date_asc'
  | 'name_asc'
  | 'name_desc'
  | 'cis_desc'
  | 'cis_asc'
  | 'pages_desc'
  | 'pages_asc';

export type EssaySortColumn = 'name' | 'pages' | 'cis' | 'date';

export const DEFAULT_ESSAY_SORT: EssaySortOption = 'date_desc';

export const ESSAY_SORT_OPTIONS: readonly EssaySortOption[] = [
  'date_desc',
  'date_asc',
  'name_asc',
  'name_desc',
  'cis_desc',
  'cis_asc',
  'pages_desc',
  'pages_asc',
] as const;

export function isValidEssaySortOption(value: unknown): value is EssaySortOption {
  return typeof value === 'string' && (ESSAY_SORT_OPTIONS as readonly string[]).includes(value);
}

function getUploadTimestamp(essay: EssaySummary): number | null {
  if (!essay.uploaded_at) return null;
  const parsed = Date.parse(essay.uploaded_at);
  return Number.isFinite(parsed) ? parsed : null;
}

function getSortableCisScore(essay: EssaySummary): number | null {
  const jobStatus = (essay.job_status || 'completed').toLowerCase();
  if (jobStatus === 'queued' || jobStatus === 'processing' || jobStatus === 'failed') {
    return null;
  }
  if (typeof essay.cis_score !== 'number' || !Number.isFinite(essay.cis_score)) {
    return null;
  }
  return essay.cis_score;
}

function compareFilenamesNatural(a: string, b: string): number {
  const baseDiff = a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
  if (baseDiff !== 0) return baseDiff;
  return a.localeCompare(b);
}

function compareByRecentDateFallback(a: EssaySummary, b: EssaySummary): number {
  const aTime = getUploadTimestamp(a);
  const bTime = getUploadTimestamp(b);
  if (aTime !== null && bTime !== null && aTime !== bTime) {
    return bTime - aTime;
  }
  if (aTime !== null && bTime === null) return -1;
  if (aTime === null && bTime !== null) return 1;
  return b.id - a.id;
}

export function sortEssays(
  essays: readonly EssaySummary[],
  sortBy: EssaySortOption = DEFAULT_ESSAY_SORT,
): EssaySummary[] {
  return [...essays].sort((a, b) => {
    switch (sortBy) {
      case 'date_desc': {
        const aTime = getUploadTimestamp(a);
        const bTime = getUploadTimestamp(b);
        if (aTime === null && bTime === null) return b.id - a.id;
        if (aTime === null) return 1;
        if (bTime === null) return -1;
        if (bTime !== aTime) return bTime - aTime;
        return b.id - a.id;
      }
      case 'date_asc': {
        const aTime = getUploadTimestamp(a);
        const bTime = getUploadTimestamp(b);
        if (aTime === null && bTime === null) return a.id - b.id;
        if (aTime === null) return 1;
        if (bTime === null) return -1;
        if (aTime !== bTime) return aTime - bTime;
        return a.id - b.id;
      }
      case 'name_asc': {
        const nameDiff = compareFilenamesNatural(a.filename, b.filename);
        if (nameDiff !== 0) return nameDiff;
        return a.id - b.id;
      }
      case 'name_desc': {
        const nameDiff = compareFilenamesNatural(b.filename, a.filename);
        if (nameDiff !== 0) return nameDiff;
        return b.id - a.id;
      }
      case 'cis_desc': {
        const aCis = getSortableCisScore(a);
        const bCis = getSortableCisScore(b);
        if (aCis === null && bCis === null) return compareByRecentDateFallback(a, b);
        if (aCis === null) return 1;
        if (bCis === null) return -1;
        if (bCis !== aCis) return bCis - aCis;
        return compareByRecentDateFallback(a, b);
      }
      case 'cis_asc': {
        const aCis = getSortableCisScore(a);
        const bCis = getSortableCisScore(b);
        if (aCis === null && bCis === null) return compareByRecentDateFallback(a, b);
        if (aCis === null) return 1;
        if (bCis === null) return -1;
        if (aCis !== bCis) return aCis - bCis;
        return compareByRecentDateFallback(a, b);
      }
      case 'pages_desc': {
        const aPages = typeof a.num_pages === 'number' ? a.num_pages : 0;
        const bPages = typeof b.num_pages === 'number' ? b.num_pages : 0;
        if (bPages !== aPages) return bPages - aPages;
        return compareByRecentDateFallback(a, b);
      }
      case 'pages_asc': {
        const aPages = typeof a.num_pages === 'number' ? a.num_pages : 0;
        const bPages = typeof b.num_pages === 'number' ? b.num_pages : 0;
        if (aPages !== bPages) return aPages - bPages;
        return compareByRecentDateFallback(a, b);
      }
    }
  });
}

export function toggleEssayColumnSort(
  current: EssaySortOption,
  column: EssaySortColumn,
): EssaySortOption {
  switch (column) {
    case 'name':
      return current === 'name_asc' ? 'name_desc' : 'name_asc';
    case 'cis':
      return current === 'cis_desc' ? 'cis_asc' : 'cis_desc';
    case 'pages':
      return current === 'pages_desc' ? 'pages_asc' : 'pages_desc';
    case 'date':
      return current === 'date_desc' ? 'date_asc' : 'date_desc';
  }
}

export function getEssayColumnAriaSort(
  current: EssaySortOption,
  column: EssaySortColumn,
): 'ascending' | 'descending' | 'none' {
  switch (column) {
    case 'name':
      return current === 'name_asc'
        ? 'ascending'
        : current === 'name_desc'
          ? 'descending'
          : 'none';
    case 'cis':
      return current === 'cis_asc'
        ? 'ascending'
        : current === 'cis_desc'
          ? 'descending'
          : 'none';
    case 'pages':
      return current === 'pages_asc'
        ? 'ascending'
        : current === 'pages_desc'
          ? 'descending'
          : 'none';
    case 'date':
      return current === 'date_asc'
        ? 'ascending'
        : current === 'date_desc'
          ? 'descending'
          : 'none';
  }
}
