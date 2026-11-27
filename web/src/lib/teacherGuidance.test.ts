import { describe, it, expect } from 'vitest';
import {
  getTeacherReviewGuidance,
  getHumanVerdictMeta,
  formatHumanMismatchedFields,
  isPositiveOrNonIssueRule,
  getTeacherIssueRuleLabel,
  filterTopCitationIssueRules,
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

  it('humanizes raw snake_case verdict labels into canonical non-accusatory taxonomy across VI and EN', () => {
    expect(getHumanVerdictMeta('verified', 'vi').label).toBe('Đã xác minh');
    expect(getHumanVerdictMeta('verified', 'en').label).toBe('Verified');
    expect(getHumanVerdictMeta('suspected_hallucination', 'vi').label).toBe(
      'Không tìm thấy nguồn',
    );
    expect(getHumanVerdictMeta('suspected_hallucination', 'en').label).toBe(
      'Source Not Found',
    );
    expect(getHumanVerdictMeta('metadata_error', 'vi').label).toBe('Sai lệch thông tin');
    expect(getHumanVerdictMeta('metadata_error', 'en').label).toBe('Details Mismatch');
    expect(getHumanVerdictMeta('unresolved', 'vi').label).toBe('Chưa đủ dữ liệu');
    expect(getHumanVerdictMeta('unresolved', 'en').label).toBe('Unverified');
    expect(getHumanVerdictMeta('resource', 'vi').label).toBe('Nguồn Web / Văn bản');
    expect(getHumanVerdictMeta('resource', 'en').label).toBe('Web / Legal Source');

    // Zero accusatory or divergent 4th-taxonomy labels
    for (const key of ['verified', 'metadata_error', 'suspected_hallucination', 'unresolved', 'resource']) {
      expect(getHumanVerdictMeta(key, 'vi').label).not.toMatch(/ngụy tạo|bịa đặt/i);
      expect(getHumanVerdictMeta(key, 'en').label).not.toMatch(/fabrication|discrepancy/i);
    }
  });

  it('BUG-01: filters positive/verified rules out of top citation issues and replaces spliced/chimeric & technical jargon', () => {
    expect(isPositiveOrNonIssueRule('R-LOCAL_DB_VERIFIED')).toBe(true);
    expect(isPositiveOrNonIssueRule('R-WELL-LINKED')).toBe(true);
    expect(isPositiveOrNonIssueRule('R-DOI-TITLE-AUTHOR')).toBe(true);
    expect(isPositiveOrNonIssueRule('R-SINGLE-SOURCE-VERIFIED')).toBe(true);
    expect(isPositiveOrNonIssueRule('R-CUSTOM-VERIFIED')).toBe(true);
    expect(isPositiveOrNonIssueRule('R-TITLE-MISMATCH')).toBe(false);
    expect(isPositiveOrNonIssueRule('R-CHIMERIC-DOI-MISMATCH')).toBe(false);
    expect(isPositiveOrNonIssueRule('R-INCOMPLETE-METADATA')).toBe(false);

    expect(getTeacherIssueRuleLabel('R-CHIMERIC-DOI-MISMATCH', 'vi')).toBe(
      'Mã DOI dẫn tới một bài báo khác (có thể ghép nhầm DOI)',
    );
    expect(getTeacherIssueRuleLabel('R-CHIMERIC-DOI-MISMATCH', 'en')).toBe(
      'Cited DOI points to a different publication',
    );
    expect(getTeacherIssueRuleLabel('R-HALLUCINATED-SOURCE', 'en')).toBe(
      'No matching publication found in academic libraries',
    );
    expect(getTeacherIssueRuleLabel('R-HALLUCINATED-SOURCE', 'vi')).toBe(
      'Không tìm thấy ấn phẩm khớp trên các thư viện học thuật',
    );
    for (const ruleId of ['R-HALLUCINATED-SOURCE', 'R-RATE-LIMITED-ABSTAIN', 'R-DOI-RA-NO-CSL', 'R-CROSS-LINGUAL-TITLE-MATCH']) {
      expect(getTeacherIssueRuleLabel(ruleId, 'en')).not.toMatch(/Retrieved candidates|HTTP 429|CSL-JSON|TDTU/i);
      expect(getTeacherIssueRuleLabel(ruleId, 'vi')).not.toMatch(/ngụy tạo|HTTP 429|CSL-JSON|TDTU/i);
    }

    const filteredVi = filterTopCitationIssueRules(
      [
        { rule_id: 'R-LOCAL_DB_VERIFIED', count: 14 },
        { rule_id: 'R-WELL-LINKED', count: 12 },
        { rule_id: 'R-CHIMERIC-DOI-MISMATCH', count: 4 },
        { rule_id: 'R-TITLE-MISMATCH', count: 3 },
      ],
      'vi',
    );
    expect(filteredVi.map((r) => r.rule_id)).toEqual([
      'R-CHIMERIC-DOI-MISMATCH',
      'R-TITLE-MISMATCH',
    ]);
    expect(filteredVi[0].label).not.toMatch(/chimeric|ngụy tạo/i);
    expect(filteredVi[0].label).toBe(
      'Mã DOI dẫn tới một bài báo khác (có thể ghép nhầm DOI)',
    );
  });

  it('BUG-23: uses non-accusatory VI phrasing for suspected_hallucination review hint', () => {
    const g = getTeacherReviewGuidance(makePending(), 'vi');
    expect(g.actionHint).not.toContain('tự bịa nguồn trích dẫn');
    expect(g.actionHint).toContain('hay tài liệu không có trong các thư viện học thuật đã tra cứu');
  });
});
