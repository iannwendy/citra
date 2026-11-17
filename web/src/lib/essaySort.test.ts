import { describe, it, expect } from 'vitest';
import type { EssaySummary } from '@/api/client';
import {
  sortEssays,
  toggleEssayColumnSort,
  getEssayColumnAriaSort,
  type EssaySortOption,
} from './essaySort';

function makeEssay(overrides: Partial<EssaySummary> & { id: number; filename: string }): EssaySummary {
  return {
    id: overrides.id,
    filename: overrides.filename,
    num_pages: overrides.num_pages ?? 10,
    uploaded_at: overrides.uploaded_at ?? '2026-11-14T10:00:00Z',
    user_id: overrides.user_id ?? 1,
    duplicate_ids: overrides.duplicate_ids ?? [],
    cis_score: 'cis_score' in overrides ? overrides.cis_score : 85,
    num_citations: overrides.num_citations ?? 20,
    num_verdicts: overrides.num_verdicts ?? 20,
    num_verified: overrides.num_verified ?? 17,
    job_status: overrides.job_status ?? 'completed',
    job_error: overrides.job_error ?? null,
    job_attempt_count: overrides.job_attempt_count ?? 1,
    quota_charged: overrides.quota_charged ?? true,
  };
}

describe('sortEssays', () => {
  it('does not mutate the input array in place', () => {
    const input: EssaySummary[] = [
      makeEssay({ id: 1, filename: 'z_last.pdf', uploaded_at: '2026-11-10T00:00:00Z' }),
      makeEssay({ id: 2, filename: 'a_first.pdf', uploaded_at: '2026-11-15T00:00:00Z' }),
    ];
    const snapshotIds = input.map((e) => e.id);

    const sorted = sortEssays(input, 'name_asc');

    expect(input.map((e) => e.id)).toEqual(snapshotIds);
    expect(sorted).not.toBe(input);
    expect(sorted.map((e) => e.id)).toEqual([2, 1]);
  });

  it('sorts by upload date newest-first (date_desc) and oldest-first (date_asc) with deterministic ID tie-breaking', () => {
    const fixtures: EssaySummary[] = [
      makeEssay({ id: 10, filename: 'middle.pdf', uploaded_at: '2026-11-14T12:00:00Z' }),
      makeEssay({ id: 11, filename: 'same_time_newer_id.pdf', uploaded_at: '2026-11-15T09:00:00Z' }),
      makeEssay({ id: 9, filename: 'same_time_older_id.pdf', uploaded_at: '2026-11-15T09:00:00Z' }),
      makeEssay({ id: 5, filename: 'oldest.pdf', uploaded_at: '2026-11-01T08:30:00Z' }),
      makeEssay({ id: 99, filename: 'malformed_date.pdf', uploaded_at: '' }),
    ];

    expect(sortEssays(fixtures, 'date_desc').map((e) => e.id)).toEqual([11, 9, 10, 5, 99]);
    expect(sortEssays(fixtures, 'date_asc').map((e) => e.id)).toEqual([5, 10, 9, 11, 99]);
  });

  it('sorts filenames alphabetically (name_asc & name_desc) using case-insensitive natural numeric order', () => {
    const fixtures: EssaySummary[] = [
      makeEssay({ id: 1, filename: 'VietDepression_PLOS_ONE.pdf' }),
      makeEssay({ id: 2, filename: 'essay_02_mixed.pdf' }),
      makeEssay({ id: 3, filename: '10_uit_thesis.pdf' }),
      makeEssay({ id: 4, filename: '2_uit_thesis.pdf' }),
      makeEssay({ id: 5, filename: 'Attention_Mechanism.pdf' }),
    ];

    expect(sortEssays(fixtures, 'name_asc').map((e) => e.filename)).toEqual([
      '2_uit_thesis.pdf',
      '10_uit_thesis.pdf',
      'Attention_Mechanism.pdf',
      'essay_02_mixed.pdf',
      'VietDepression_PLOS_ONE.pdf',
    ]);

    expect(sortEssays(fixtures, 'name_desc').map((e) => e.filename)).toEqual([
      'VietDepression_PLOS_ONE.pdf',
      'essay_02_mixed.pdf',
      'Attention_Mechanism.pdf',
      '10_uit_thesis.pdf',
      '2_uit_thesis.pdf',
    ]);
  });

  it('sorts CIS high-to-low (cis_desc) and low-to-high (cis_asc), keeping 0/100 as a real score and placing null/in-progress/failed at the bottom', () => {
    const fixtures: EssaySummary[] = [
      makeEssay({ id: 114, filename: 'zero_score.pdf', cis_score: 0, job_status: 'completed' }),
      makeEssay({ id: 119, filename: 'top_score.pdf', cis_score: 99, job_status: 'completed' }),
      makeEssay({ id: 120, filename: 'failed_with_stale_cis.pdf', cis_score: 95, job_status: 'failed' }),
      makeEssay({ id: 121, filename: 'processing_doc.pdf', cis_score: null, job_status: 'processing' }),
      makeEssay({ id: 122, filename: 'queued_doc.pdf', cis_score: 50, job_status: 'queued' }),
      makeEssay({ id: 117, filename: 'mid_score.pdf', cis_score: 72, job_status: 'completed' }),
      makeEssay({ id: 123, filename: 'null_completed.pdf', cis_score: null, job_status: 'completed' }),
    ];

    const descIds = sortEssays(fixtures, 'cis_desc').map((e) => e.id);
    expect(descIds.slice(0, 3)).toEqual([119, 117, 114]);
    expect(new Set(descIds.slice(3))).toEqual(new Set([120, 121, 122, 123]));

    const ascIds = sortEssays(fixtures, 'cis_asc').map((e) => e.id);
    // 0/100 must be #1 in low-to-high; missing/failed/in-progress must stay at the bottom!
    expect(ascIds.slice(0, 3)).toEqual([114, 117, 119]);
    expect(new Set(ascIds.slice(3))).toEqual(new Set([120, 121, 122, 123]));
  });

  it('sorts page counts most-to-fewest (pages_desc) and fewest-to-most (pages_asc)', () => {
    const fixtures: EssaySummary[] = [
      makeEssay({ id: 1, filename: 'short.pdf', num_pages: 2 }),
      makeEssay({ id: 2, filename: 'monograph.pdf', num_pages: 98 }),
      makeEssay({ id: 3, filename: 'article.pdf', num_pages: 20 }),
    ];

    expect(sortEssays(fixtures, 'pages_desc').map((e) => e.id)).toEqual([2, 3, 1]);
    expect(sortEssays(fixtures, 'pages_asc').map((e) => e.id)).toEqual([1, 3, 2]);
  });
});

describe('toggleEssayColumnSort & getEssayColumnAriaSort', () => {
  it('enters natural primary direction when clicking an inactive column and flips direction on repeat click', () => {
    const transitions: Array<[EssaySortOption, 'name' | 'pages' | 'cis' | 'date', EssaySortOption]> = [
      ['date_desc', 'name', 'name_asc'],
      ['name_asc', 'name', 'name_desc'],
      ['name_desc', 'name', 'name_asc'],
      ['date_desc', 'cis', 'cis_desc'],
      ['cis_desc', 'cis', 'cis_asc'],
      ['cis_asc', 'cis', 'cis_desc'],
      ['date_desc', 'pages', 'pages_desc'],
      ['pages_desc', 'pages', 'pages_asc'],
      ['date_desc', 'date', 'date_asc'],
      ['date_asc', 'date', 'date_desc'],
      ['cis_desc', 'date', 'date_desc'],
    ];

    for (const [current, col, want] of transitions) {
      expect(toggleEssayColumnSort(current, col)).toBe(want);
    }
  });

  it('maps active sort option to WAI-ARIA aria-sort attribute per column', () => {
    expect(getEssayColumnAriaSort('date_desc', 'date')).toBe('descending');
    expect(getEssayColumnAriaSort('date_asc', 'date')).toBe('ascending');
    expect(getEssayColumnAriaSort('date_desc', 'cis')).toBe('none');
    expect(getEssayColumnAriaSort('name_asc', 'name')).toBe('ascending');
    expect(getEssayColumnAriaSort('name_desc', 'name')).toBe('descending');
    expect(getEssayColumnAriaSort('cis_desc', 'cis')).toBe('descending');
    expect(getEssayColumnAriaSort('cis_asc', 'cis')).toBe('ascending');
    expect(getEssayColumnAriaSort('pages_desc', 'pages')).toBe('descending');
    expect(getEssayColumnAriaSort('pages_asc', 'pages')).toBe('ascending');
  });
});
