import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, beforeEach } from 'vitest';
import i18n from '@/i18n';
import { renderWithProviders, screen } from '@/test-utils';
import { makeVerdict } from '@/test-fixtures';
import { RULE_DEFINITIONS, RuleInspector } from './RuleInspector';
import {
  getVerdictExplanation,
  getRuleDisplayName,
  getVerdictDisplayName,
  getSourceSummary,
  getSearchStepDescription,
} from '@/lib/verdictExplanation';

const REQUIRED_RULE_IDS = [
  'R-ABSTENTION-BORDER',
  'R-AMBIGUOUS-MAPPING',
  'R-API_EXHAUSTED',
  'R-BOOK-EDITION-VERIFIED',
  'R-BROKEN-LINK',
  'R-CHIMERIC-DOI-MISMATCH',
  'R-CONSENSUS-FULL',
  'R-CONSENSUS-PARTIAL',
  'R-CONTENT-ALIGNMENT',
  'R-CONTENT-MISMATCH',
  'R-CROSS-LINGUAL-ALIGNMENT',
  'R-CROSS-LINGUAL-TITLE-MATCH',
  'R-DEAD-URL',
  'R-DOI-TITLE-AUTHOR',
  'R-DOI-TITLE-MISMATCH',
  'R-DOMAIN-EXCEPTION',
  'R-FABRICATED-DOI',
  'R-FAIL-ALL',
  'R-FAKE-AUTHOR',
  'R-FAKE-URL',
  'R-FUTURE-YEAR',
  'R-FUTURE-YEAR-KNOWN-AUTHOR',
  'R-GITHUB-VERIFIED',
  'R-GLOBAL-DOI-RA-VERIFIED',
  'R-HALLUCINATED-SOURCE',
  'R-HF-VERIFIED',
  'R-KNOWN-AUTHOR-TITLE-MISMATCH',
  'R-KNOWN-AUTHOR-WEAK-EVIDENCE',
  'R-KNOWN-PAPER',
  'R-KNOWN-PAPER-NO-TITLE',
  'R-LEGAL-DOCUMENT',
  'R-LEGAL-STATUTE-ERROR',
  'R-LEGAL-STATUTE-VERIFIED',
  'R-LOCAL_DB',
  'R-LOCAL_DB_GOOD_MATCH',
  'R-LOCAL_DB_METADATA_ERROR',
  'R-LOCAL_DB_ONLY',
  'R-LOCAL_DB_VERIFIED',
  'R-NO-CANDIDATE',
  'R-NO-SCHOLARLY-RECORD',
  'R-NON-SCHOLARLY-RESOURCE',
  'R-NONEXISTENT-DOI',
  'R-OPENCITATIONS-VERIFIED',
  'R-PACKAGE-VERIFIED',
  'R-RATE-LIMITED-ABSTAIN',
  'R-RETRACTED-PAPER',
  'R-RFC-VERIFIED',
  'R-SINGLE-SOURCE-PARTIAL',
  'R-SINGLE-SOURCE-VERIFIED',
  'R-SOFTWARE-PACKAGE-VERIFIED',
  'R-STYLE-INCONSISTENT',
  'R-TITLE-MISMATCH',
  'R-UNINDEXED-BOOK-OR-SOURCE',
  'R-URL-RESOURCE',
  'R-VN-LEGAL-FABRICATED',
  'R-VN-LEGAL-FORMAT',
  'R-VN-LEGAL-MISMATCH',
  'R-VN-LEGAL-SUPERSEDED',
  'R-VN-LEGAL-VERIFIED',
  'R-WAYBACK-ARCHIVED',
  'R-WEAK-EVIDENCE',
  'R-WEB-RESOURCE',
  'R-WELL-LINKED',
  'R-WELL-LINKED-MODERATE',
  'R-WIKIDATA-STANDARD-VERIFIED',
  'R-WIKIDATA-VERIFIED',
];

describe('RuleInspector & verdictExplanation i18n and complete backend R- rule coverage', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('defines every required R- rule ID and every R- rule emitted by backend logic files', () => {
    const logicDir = path.resolve(
      __dirname,
      '../../../src/integrity_checker/logic',
    );
    const extractedBackendRuleIds = new Set<string>(REQUIRED_RULE_IDS);
    for (const file of ['rules.py', 'vn_legal_verifier.py', 'neuro_symbolic_checker.py']) {
      const fullPath = path.join(logicDir, file);
      if (fs.existsSync(fullPath)) {
        const content = fs.readFileSync(fullPath, 'utf8');
        const matches = content.matchAll(/["'](R-[A-Z0-9_-]+)["']/g);
        for (const match of matches) {
          extractedBackendRuleIds.add(match[1]);
        }
      }
    }

    for (const ruleId of extractedBackendRuleIds) {
      const def = RULE_DEFINITIONS[ruleId];
      expect(def, `Missing RULE_DEFINITIONS entry for ${ruleId}`).toBeDefined();
      expect(def.name.length).toBeGreaterThan(3);
      expect(def.nameVi.length).toBeGreaterThan(3);
      expect(def.description).not.toBe('Custom rule triggered');
      expect(def.descriptionVi).not.toBe('Quy tắc kiểm tra bổ sung được kích hoạt');

      // Also verify verdictExplanation has a dedicated EN and VI label
      expect(getRuleDisplayName(ruleId, 'en')).not.toBe(
        'An additional verification check was applied',
      );
      expect(getRuleDisplayName(ruleId, 'vi')).not.toBe(
        'Đã áp dụng quy tắc kiểm tra bổ sung',
      );
    }
  });

  it('renders RuleInspector in English and Vietnamese without falling back to Custom rule triggered', async () => {
    await i18n.changeLanguage('en');
    const { unmount } = renderWithProviders(
      <RuleInspector
        triggeredRules={[
          'R-CROSS-LINGUAL-ALIGNMENT',
          'R-CROSS-LINGUAL-TITLE-MATCH',
          'R-RETRACTED-PAPER',
          'R-WAYBACK-ARCHIVED',
        ]}
      />,
    );

    expect(screen.getByText('Triggered Rules (4)')).toBeDefined();
    expect(screen.getByText('Cross-Lingual Semantic Alignment (VI↔EN)')).toBeDefined();
    expect(
      screen.getByText('Translated Title Match (TDTU Foreign-Title Rule)'),
    ).toBeDefined();
    expect(document.body.textContent).not.toContain('Custom rule triggered');
    unmount();

    await i18n.changeLanguage('vi');
    renderWithProviders(
      <RuleInspector
        triggeredRules={[
          'R-CROSS-LINGUAL-ALIGNMENT',
          'R-CROSS-LINGUAL-TITLE-MATCH',
          'R-RETRACTED-PAPER',
          'R-WAYBACK-ARCHIVED',
        ]}
      />,
    );

    expect(screen.getByText('Luật được kích hoạt (4)')).toBeDefined();
    expect(
      screen.getByText('Tương đồng ngữ nghĩa xuyên ngôn ngữ Việt ↔ Anh'),
    ).toBeDefined();
    expect(
      screen.getByText(
        'Tiêu đề dịch tiếng Việt (Vi phạm quy tắc giữ nguyên tiêu đề gốc TDTU)',
      ),
    ).toBeDefined();
    expect(document.body.textContent).not.toContain('Custom rule triggered');
    expect(document.body.textContent).not.toContain(
      'Quy tắc kiểm tra bổ sung được kích hoạt',
    );
  });

  it('localizes getVerdictExplanation, getVerdictDisplayName, getSourceSummary, and getSearchStepDescription in EN and VI', async () => {
    const verdict = makeVerdict({
      label: 'metadata_error',
      mismatched_fields: ['year', 'authors'],
      matched_sources: [
        {
          source: 'crossref',
          title: 'Attention Is All You Need',
          authors: ['Ashish Vaswani'],
          year: '2017',
          doi: '10.48550/arXiv.1706.03762',
          url: null,
          checked_at: '2026-11-02T00:00:00Z',
          matched_fields: ['title', 'doi'],
        },
      ],
      triggered_rules: ['R-SINGLE-SOURCE-PARTIAL'],
    });

    await i18n.changeLanguage('en');
    expect(getVerdictExplanation(verdict)).toContain(
      'We found a likely publication, but the publication year and the authors do not match',
    );
    expect(getVerdictDisplayName('metadata_error')).toBe('Needs a metadata review');
    expect(getSourceSummary(verdict)).toBe('Found a matching publication in Crossref');
    expect(getSearchStepDescription(verdict)).toBe(
      'Checked Crossref for a matching publication.',
    );

    await i18n.changeLanguage('vi');
    expect(getVerdictExplanation(verdict)).toContain(
      'Tìm thấy ấn phẩm tương ứng nhưng năm xuất bản và tác giả không khớp với trích dẫn',
    );
    expect(getVerdictDisplayName('metadata_error')).toBe('Cần rà soát metadata');
    expect(getSourceSummary(verdict)).toBe('Tìm thấy ấn phẩm khớp trên Crossref');
    expect(getSearchStepDescription(verdict)).toBe(
      'Đã kiểm tra Crossref để tìm ấn phẩm khớp.',
    );
  });
});
