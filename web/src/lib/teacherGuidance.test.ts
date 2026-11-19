import { describe, it, expect } from 'vitest';
import {
  getTeacherReviewGuidance,
  getHumanVerdictMeta,
  formatHumanMismatchedFields,
} from './teacherGuidance';
import type { PendingVerdict } from '@/api/client';

const makePending = (over: Partial<PendingVerdict> = {}): PendingVerdict => ({
  verdict_id: 1,
  essay_id: 10,
  filename: '1810.04805v2.pdf',
  student_username: 'sv_an',
  citation_raw: 'Christopher Clark and Matt Gardner. 2018.',
  label: 'suspected_hallucination',
  confidence: 0.35,
  reasoning: '',
  validated_at: '2026-11-19T00:00:00Z',
  ...over,
});

describe('teacherGuidance', () => {
  it('maps suspected_hallucination to critical plain-language guidance without raw R-* codes or Mismatch: the ...', () => {
    const vi = getTeacherReviewGuidance(
      makePending({
        triggered_rules: [
          'R-STYLE-INCONSISTENT',
          'R-CONTENT-ALIGNMENT',
          'R-WEAK-EVIDENCE',
          'R-HALLUCINATED-SOURCE',
        ],
        mismatched_fields: ['title', 'authors'],
      }),
      'vi',
    );
    expect(vi.severity).toBe('critical');
    expect(vi.headline).not.toMatch(/R-[A-Z]/);
    expect(vi.actionHint).not.toMatch(/R-[A-Z]/);
    expect(vi.headline).not.toContain('Mismatch:');
    expect(vi.confirmNewLabel).toBe('suspected_hallucination');
    expect(vi.confirmButtonLabel).toBe('Giữ cảnh báo');

    const en = getTeacherReviewGuidance(makePending(), 'en');
    expect(en.severity).toBe('critical');
    expect(en.confirmButtonLabel).toBe('Keep Warning');
    expect(en.confirmNewLabel).toBe('suspected_hallucination');
  });

  it('prioritizes retracted publications as critical guidance even when label is metadata_error', () => {
    const vi = getTeacherReviewGuidance(
      makePending({
        label: 'metadata_error',
        is_retracted: true,
        triggered_rules: ['R-RETRACTED-PAPER'],
      }),
      'vi',
    );
    expect(vi.severity).toBe('critical');
    expect(vi.headline.toLowerCase()).toContain('rút');
    expect(vi.confirmNewLabel).toBe('metadata_error');
  });

  it('maps R-URL-CONTENT-MISMATCH to clear wrong-page guidance', () => {
    const vi = getTeacherReviewGuidance(
      makePending({
        label: 'metadata_error',
        triggered_rules: ['R-URL-CONTENT-MISMATCH'],
        html_meta: { page_title: 'Unrelated Cooking Blog Homepage' },
      }),
      'vi',
    );
    expect(vi.severity).toBe('warning');
    expect(vi.headline.toLowerCase()).toContain('trang web khác');
    expect(vi.confirmNewLabel).toBe('metadata_error');
  });

  it('maps R-INCOMPLETE-METADATA to incomplete severity and preserves VI academic identifier phrase', () => {
    const vi = getTeacherReviewGuidance(
      makePending({
        label: 'metadata_error',
        triggered_rules: ['R-INCOMPLETE-METADATA'],
        mismatched_fields: ['year', 'venue'],
      }),
      'vi',
    );
    expect(vi.severity).toBe('incomplete');
    expect(`${vi.headline} ${vi.actionHint}`).toMatch(
      /chưa đủ thông tin định danh học thuật/i,
    );
    expect(vi.confirmNewLabel).toBe('metadata_error');
  });

  it('formats mismatched_fields into natural human nouns without "the title" or "the authors"', () => {
    expect(formatHumanMismatchedFields(['title', 'authors', 'year'], 'en')).toBe(
      'title, authors, publication year',
    );
    expect(formatHumanMismatchedFields(['title', 'authors'], 'vi')).toBe(
      'tên bài, tác giả',
    );

    const g = getTeacherReviewGuidance(
      makePending({
        label: 'metadata_error',
        mismatched_fields: ['title', 'authors'],
        triggered_rules: ['R-SINGLE-SOURCE-PARTIAL'],
      }),
      'en',
    );
    expect(g.severity).toBe('warning');
    expect(g.headline).toContain('title, authors');
    expect(g.headline).not.toContain('the title');
  });

  it('normalizes unresolved and legacy unverified to confirmNewLabel="metadata_error" (Review Focus #3)', () => {
    const uVi = getTeacherReviewGuidance(makePending({ label: 'unresolved' }), 'vi');
    const uEn = getTeacherReviewGuidance(makePending({ label: 'unverified' }), 'en');
    expect(uVi.severity).toBe('uncertain');
    expect(uVi.confirmNewLabel).toBe('metadata_error');
    expect(uVi.confirmButtonLabel).toBe('Đánh dấu lỗi');
    expect(uEn.severity).toBe('uncertain');
    expect(uEn.confirmNewLabel).toBe('metadata_error');
    expect(uEn.confirmButtonLabel).toBe('Flag Issue');
  });

  it('humanizes raw snake_case verdict labels across VI and EN', () => {
    expect(getHumanVerdictMeta('verified', 'vi').label).toBe('Hợp lệ');
    expect(getHumanVerdictMeta('suspected_hallucination', 'vi').label).toBe(
      'Nghi vấn ngụy tạo',
    );
    expect(getHumanVerdictMeta('metadata_error', 'en').label).toBe(
      'Metadata Discrepancy',
    );
    expect(getHumanVerdictMeta('unresolved', 'en').label).toBe('Needs Review');
    expect(getHumanVerdictMeta('resource', 'vi').label).toBe(
      'Tài nguyên Web / Pháp luật',
    );
  });
});
