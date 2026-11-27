import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Routes, Route } from 'react-router-dom';
import { api } from '@/api/client';
import i18n from '@/i18n';
import { renderWithProviders, screen, waitFor } from '@/test-utils';
import { makeReport, makeVerdict } from '@/test-fixtures';
import { VerdictBadge } from '@/components/VerdictBadge';
import { getVerdictBadgeVisuals } from '@/pages/EssayPage';
import { OrphanDetectionPage } from '@/pages/OrphanDetectionPage';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  getRuleDisplayName,
  getSourceDisplayName,
  getVerdictDisplayName,
  getVerdictExplanation,
  getSearchStepDescription,
  getPlainVerdictLabel,
  getPlainMappingLabel,
} from '@/lib/verdictExplanation';

describe('R-INCOMPLETE-METADATA localization & VerdictBadge sub-label', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('localizes R-INCOMPLETE-METADATA and R-URL-CONTENT-MISMATCH rule labels in EN and VI', () => {
    expect(getRuleDisplayName('R-INCOMPLETE-METADATA', 'en')).toContain(
      'Incomplete bibliographic reference',
    );
    expect(getRuleDisplayName('R-INCOMPLETE-METADATA', 'vi')).toContain(
      'Thiếu quy cách trích dẫn',
    );
    expect(getRuleDisplayName('R-URL-CONTENT-MISMATCH', 'en')).toContain(
      'Cited web page title or details do not match',
    );
    expect(getRuleDisplayName('R-URL-CONTENT-MISMATCH', 'vi')).toContain(
      'Tiêu đề hoặc thông tin của trang web không khớp',
    );
  });

  it('produces instructor-friendly explanations for R-INCOMPLETE-METADATA in EN and VI', () => {
    const incompleteVerdict = makeVerdict({
      citation_raw: '[2] Making a robot vacuum cleaner to avoid falling down the stairs',
      label: 'metadata_error',
      confidence: 0.8,
      triggered_rules: ['R-INCOMPLETE-METADATA'],
      mismatched_fields: ['authors', 'year', 'venue'],
      matched_sources: [],
    });

    const enExplanation = getVerdictExplanation(incompleteVerdict, 'en');
    expect(enExplanation).toContain('Incomplete bibliographic reference');
    expect(enExplanation).toContain('the authors, the publication year, and the venue');
    expect(enExplanation).toContain('rather than an invalid source');
    expect(enExplanation).not.toMatch(/\bfabricated\b/i);

    const viExplanation = getVerdictExplanation(incompleteVerdict, 'vi');
    expect(viExplanation).toContain('Thiếu quy cách trích dẫn');
    expect(viExplanation).toContain('tác giả, năm xuất bản và nơi công bố');
    expect(viExplanation).toContain('thiếu sót về trình bày trích dẫn');
    expect(viExplanation).not.toContain('bịa đặt');
  });

  it('renders Incomplete Reference / Thiếu quy cách trích dẫn in VerdictBadge only when R-INCOMPLETE-METADATA is triggered', async () => {
    await i18n.changeLanguage('en');
    const { unmount } = renderWithProviders(
      React.createElement(
        'div',
        null,
        React.createElement(VerdictBadge, {
          verdict: 'metadata_error',
          triggeredRules: ['R-INCOMPLETE-METADATA'],
        }),
        React.createElement(VerdictBadge, {
          verdict: 'metadata_error',
          triggeredRules: ['R-YEAR-MISMATCH'],
        }),
      ),
    );

    expect(screen.getByText('Incomplete Reference')).toBeDefined();
    expect(screen.getByText('Details Mismatch')).toBeDefined();
    unmount();

    await i18n.changeLanguage('vi');
    renderWithProviders(
      React.createElement(
        'div',
        null,
        React.createElement(VerdictBadge, {
          verdict: 'metadata_error',
          triggeredRules: ['R-INCOMPLETE-METADATA'],
        }),
        React.createElement(VerdictBadge, {
          verdict: 'metadata_error',
        }),
      ),
    );

    expect(screen.getByText('Thiếu quy cách trích dẫn')).toBeDefined();
    expect(screen.getByText('Sai lệch thông tin')).toBeDefined();
  });

  it('returns localized Incomplete Reference badge visuals in EssayPage getVerdictBadgeVisuals without breaking standard or legal METADATA_ERROR', () => {
    expect(
      getVerdictBadgeVisuals('metadata_error', ['R-INCOMPLETE-METADATA'], 'en')
        .text,
    ).toBe('⚠ Incomplete Reference');
    expect(
      getVerdictBadgeVisuals('metadata_error', ['R-INCOMPLETE-METADATA'], 'vi')
        .text,
    ).toBe('⚠ Thiếu quy cách trích dẫn');
    expect(
      getVerdictBadgeVisuals(
        'metadata_error',
        ['R-SINGLE-SOURCE-PARTIAL'],
        'en',
      ).text,
    ).toBe('⚠ Details Mismatch');
    expect(
      getVerdictBadgeVisuals('metadata_error', ['R-LEGAL-YEAR-MISMATCH'], 'vi')
        .text,
    ).toBe('⚠ Sai lệch thông tin');
  });

  it('propagates triggered_rules to VerdictBadge on OrphanDetectionPage in EN and VI', async () => {
    vi.spyOn(api, 'getEssay').mockResolvedValue(
      makeReport({
        essay_id: 42,
        verdicts: [
          makeVerdict({
            citation_id: 'ref-0001',
            citation_raw: '[1] Artificial intelligence in healthcare',
            label: 'metadata_error',
            mapping_status: 'matched',
            triggered_rules: ['R-INCOMPLETE-METADATA'],
          }),
          makeVerdict({
            citation_id: 'cit-0002',
            citation_raw: '[2] Synthetic aperture radar imaging',
            label: 'metadata_error',
            mapping_status: 'missing_reference',
            triggered_rules: ['R-INCOMPLETE-METADATA'],
          }),
          makeVerdict({
            citation_id: 'ref-0003',
            citation_raw: 'Vaswani, A. et al. (2018). Attention Is All You Need.',
            label: 'metadata_error',
            mapping_status: 'matched',
            triggered_rules: ['R-SINGLE-SOURCE-PARTIAL'],
          }),
        ],
      }),
    );

    await i18n.changeLanguage('en');
    const { unmount } = renderWithProviders(
      React.createElement(
        Routes,
        null,
        React.createElement(Route, {
          path: '/essays/:id/orphans',
          element: React.createElement(OrphanDetectionPage),
        }),
      ),
      { initialRoute: '/essays/42/orphans' },
    );

    await waitFor(() =>
      expect(screen.getAllByText('Incomplete Reference')).toHaveLength(2),
    );
    expect(screen.getByText('Details Mismatch')).toBeDefined();
    unmount();

    await i18n.changeLanguage('vi');
    renderWithProviders(
      React.createElement(
        Routes,
        null,
        React.createElement(Route, {
          path: '/essays/:id/orphans',
          element: React.createElement(OrphanDetectionPage),
        }),
      ),
      { initialRoute: '/essays/42/orphans' },
    );

    await waitFor(() =>
      expect(screen.getAllByText('Thiếu quy cách trích dẫn')).toHaveLength(2),
    );
    expect(screen.getByText('Sai lệch thông tin')).toBeDefined();
    vi.restoreAllMocks();
  });
});

describe('Task 0.1: Plain-language verdict/mapping helpers & Solva CSS tokens', () => {
  it('maps SUSPECTED_HALLUCINATION and METADATA_ERROR to human-friendly plain-language labels with action hints', () => {
    const viSuspected = getPlainVerdictLabel('SUSPECTED_HALLUCINATION', 'vi');
    expect(viSuspected.label).toBe('Không tìm thấy nguồn');
    expect(viSuspected.technicalCode).toBe('SUSPECTED_HALLUCINATION');
    expect(viSuspected.actionHint.trim().length).toBeGreaterThan(15);

    const enMeta = getPlainVerdictLabel('METADATA_ERROR', 'en');
    expect(enMeta.label).toBe('Details Mismatch');
    expect(enMeta.technicalCode).toBe('METADATA_ERROR');
    expect(enMeta.actionHint.trim().length).toBeGreaterThan(15);
  });

  it('covers all 5 Layer-2 verdict labels in EN and VI without raw snake_case enum leakage', () => {
    const layer2Codes = [
      'VERIFIED',
      'METADATA_ERROR',
      'SUSPECTED_HALLUCINATION',
      'UNRESOLVED',
      'UNVERIFIABLE',
      'RESOURCE',
    ] as const;

    for (const code of layer2Codes) {
      for (const lang of ['en', 'vi'] as const) {
        const res = getPlainVerdictLabel(code, lang);
        expect(res.label).not.toContain('_');
        expect(res.label).not.toBe(code);
        expect(res.actionHint.trim().length).toBeGreaterThan(15);
        expect(res.technicalCode).toBe(code);
      }
    }
  });

  it('handles lowercase inputs, UI aliases (HALLUCINATED), and unknown strings gracefully in getPlainVerdictLabel', () => {
    expect(getPlainVerdictLabel('suspected_hallucination', 'vi')).toEqual(
      getPlainVerdictLabel('SUSPECTED_HALLUCINATION', 'vi'),
    );
    expect(getPlainVerdictLabel('HALLUCINATED', 'vi')).toEqual(
      getPlainVerdictLabel('SUSPECTED_HALLUCINATION', 'vi'),
    );
    expect(getPlainVerdictLabel('hallucinated', 'en')).toEqual(
      getPlainVerdictLabel('SUSPECTED_HALLUCINATION', 'en'),
    );
    expect(getPlainVerdictLabel('metadata_error', 'en').label).toBe(
      'Details Mismatch',
    );

    const unknownVi = getPlainVerdictLabel('FUTURE_UNKNOWN_STATE', 'vi');
    expect(unknownVi.label).toBe('Chưa đủ dữ liệu');
    expect(unknownVi.technicalCode).toBe('FUTURE_UNKNOWN_STATE');
    expect(unknownVi.actionHint.trim().length).toBeGreaterThan(10);

    const emptyEn = getPlainVerdictLabel('', 'en');
    expect(emptyEn.label).toBe('Unverified');
    expect(emptyEn.technicalCode).toBe('UNRESOLVED');
  });

  it('maps MISSING_REFERENCE and all 7 Layer-1 mapping statuses to plain EN & VI labels', () => {
    const viMissing = getPlainMappingLabel('MISSING_REFERENCE', 'vi');
    expect(viMissing.label).toBe('Thiếu ở danh mục tham khảo');
    expect(viMissing.technicalCode).toBe('MISSING_REFERENCE');

    const enMissing = getPlainMappingLabel('MISSING_REFERENCE', 'en');
    expect(enMissing.label).toBe('Missing from Bibliography');
    expect(enMissing.technicalCode).toBe('MISSING_REFERENCE');

    const layer1Statuses = [
      'MATCHED',
      'MISSING_REFERENCE',
      'UNCITED_REFERENCE',
      'IN_TEXT_MISMATCH',
      'DUPLICATE_REFERENCE',
      'AMBIGUOUS_MAPPING',
      'STYLE_INCONSISTENT',
    ] as const;

    for (const status of layer1Statuses) {
      for (const lang of ['en', 'vi'] as const) {
        const res = getPlainMappingLabel(status, lang);
        expect(res.label).not.toContain('_');
        expect(res.label).not.toBe(status);
        expect(res.actionHint.trim().length).toBeGreaterThan(15);
        expect(res.technicalCode).toBe(status);
      }
    }
  });

  it('handles lowercase inputs, legacy aliases (MISSING, UNCITED, MISMATCH), and unknown statuses in getPlainMappingLabel', () => {
    expect(getPlainMappingLabel('missing_reference', 'vi')).toEqual(
      getPlainMappingLabel('MISSING_REFERENCE', 'vi'),
    );
    expect(getPlainMappingLabel('MISSING', 'vi')).toEqual(
      getPlainMappingLabel('MISSING_REFERENCE', 'vi'),
    );
    expect(getPlainMappingLabel('missing', 'en')).toEqual(
      getPlainMappingLabel('MISSING_REFERENCE', 'en'),
    );
    expect(getPlainMappingLabel('UNCITED', 'vi').technicalCode).toBe(
      'UNCITED_REFERENCE',
    );
    expect(getPlainMappingLabel('MISMATCH', 'en').technicalCode).toBe(
      'IN_TEXT_MISMATCH',
    );

    const unknownStatus = getPlainMappingLabel('CUSTOM_UNMAPPED', 'en');
    expect(unknownStatus.label).not.toContain('_');
    expect(unknownStatus.technicalCode).toBe('CUSTOM_UNMAPPED');
  });

  it('uses accurate item-scoped and Vietnamese non-calque actionHints, falls back to active i18n.language when lang is omitted, and guards Object.prototype keys', async () => {
    expect(getPlainVerdictLabel('RESOURCE', 'vi').actionHint).toBe(
      'Đây là trang web hoặc văn bản quy định chung thay vì bài báo học thuật (không bị tính điểm trừ).',
    );
    expect(getPlainMappingLabel('MATCHED', 'en').actionHint).toBe(
      'In-text citation cleanly connects to its matching bibliography entry.',
    );

    expect(getPlainVerdictLabel('METADATA_ERROR', 'vi').actionHint).toContain(
      'hãy kiểm tra và cập nhật lại.',
    );
    expect(getPlainVerdictLabel('SOURCE_MISMATCH', 'vi').actionHint).toContain(
      'hãy kiểm tra lại nguồn.',
    );
    expect(getPlainMappingLabel('MISSING_REFERENCE', 'vi').actionHint).toContain(
      'hãy bổ sung mục này vào cuối bài.',
    );
    expect(getPlainMappingLabel('UNCITED_REFERENCE', 'vi').actionHint).toContain(
      'hãy trích dẫn trong bài hoặc lược bỏ.',
    );

    await i18n.changeLanguage('vi');
    expect(getPlainVerdictLabel('SUSPECTED_HALLUCINATION').label).toBe(
      'Không tìm thấy nguồn',
    );
    expect(getPlainMappingLabel('MISSING_REFERENCE').label).toBe(
      'Thiếu ở danh mục tham khảo',
    );
    await i18n.changeLanguage('en');

    // Object.prototype keys like 'toString' or 'constructor' must fall back cleanly
    expect(getPlainVerdictLabel('toString', 'en').label).toBe('Unverified');
    expect(getPlainMappingLabel('constructor', 'en').label).toBe('Needs Link Check');
  });

  it('Squad 1B: fixes EN singular/plural grammar & capitalization, removes local-library/accusatory/TDTU jargon, and aligns source & verdict display names', () => {
    // Singular matched field -> capitalized sentence + "is consistent"
    const singleMatched = makeVerdict({
      label: 'verified',
      matched_sources: [
        {
          source: 'local_db',
          title: 'Attention Is All You Need',
          authors: ['Ashish Vaswani'],
          year: '2017',
          doi: null,
          url: null,
          checked_at: '2026-11-27T00:00:00Z',
          matched_fields: ['title'],
        },
      ],
    });
    const enSingle = getVerdictExplanation(singleMatched, 'en');
    expect(enSingle).toContain('CITRA Scholarly Library');
    expect(enSingle).toContain('. The title is consistent with the citation.');
    expect(enSingle).not.toContain('the local library');
    expect(enSingle).not.toContain('so no external search was needed');

    const viSingle = getVerdictExplanation(singleMatched, 'vi');
    expect(viSingle).toContain('Thư viện học thuật CITRA');
    expect(viSingle).not.toContain('thư viện học thuật cục bộ');

    // Plural matched field ("authors") and multi-field -> "are consistent"
    const pluralAuthors = makeVerdict({
      label: 'verified',
      matched_sources: [
        {
          source: 'crossref',
          checked_at: '2026-11-27T00:00:00Z',
          matched_fields: ['authors'],
        },
      ],
    });
    expect(getVerdictExplanation(pluralAuthors, 'en')).toContain(
      '. The authors are consistent with the citation.',
    );

    const multiMatched = makeVerdict({
      label: 'verified',
      matched_sources: [
        {
          source: 'openalex',
          checked_at: '2026-11-27T00:00:00Z',
          matched_fields: ['title', 'year'],
        },
      ],
    });
    expect(getVerdictExplanation(multiMatched, 'en')).toContain(
      '. The title and the publication year are consistent with the citation.',
    );

    // Singular vs plural mismatched fields -> "does not match" vs "do not match"
    const singleMismatch = makeVerdict({
      label: 'metadata_error',
      mismatched_fields: ['year'],
      matched_sources: [
        {
          source: 'crossref',
          checked_at: '2026-11-27T00:00:00Z',
          matched_fields: ['title'],
        },
      ],
    });
    expect(getVerdictExplanation(singleMismatch, 'en')).toContain(
      'but the publication year does not match the citation. Please review this detail.',
    );

    const pluralMismatch = makeVerdict({
      label: 'metadata_error',
      mismatched_fields: ['year', 'authors'],
      matched_sources: [
        {
          source: 'crossref',
          checked_at: '2026-11-27T00:00:00Z',
          matched_fields: ['title'],
        },
      ],
    });
    expect(getVerdictExplanation(pluralMismatch, 'en')).toContain(
      'but the publication year and the authors do not match the citation. Please review these details.',
    );

    // Clean search step descriptions for local DB & web
    expect(getSearchStepDescription(singleMatched, 'en')).toBe(
      'Matched against the CITRA Scholarly Library.',
    );
    expect(getSearchStepDescription(singleMatched, 'vi')).toBe(
      'Đã đối chiếu và tìm thấy bản ghi khớp trong Thư viện học thuật CITRA.',
    );

    // Canonical getVerdictDisplayName without accusatory words
    expect(getVerdictDisplayName('suspected_hallucination', 'vi')).toBe('Không tìm thấy nguồn');
    expect(getVerdictDisplayName('metadata_error', 'vi')).toBe('Sai lệch thông tin');
    expect(getVerdictDisplayName('metadata_error', 'en')).toBe('Details Mismatch');

    // Clean human source names (VI & EN)
    expect(getSourceDisplayName('local_db', 'vi')).toBe('Thư viện học thuật CITRA');
    expect(getSourceDisplayName('doi_ra', 'vi')).toBe('Hệ thống đăng ký DOI quốc tế');
    expect(getSourceDisplayName('doi_ra', 'en')).toBe('Global DOI Registry');
    expect(getSourceDisplayName('ncbi_biorxiv', 'en')).toBe('PubMed / bioRxiv');
    expect(getSourceDisplayName('web_html_meta', 'vi')).toBe('Trang web gốc');
    expect(getSourceDisplayName('wayback_html_meta', 'en')).toBe('Web Archive (Wayback)');

    // Zero accusatory / technical jargon in rule labels
    const auditedRules = [
      'R-CHIMERIC-DOI-MISMATCH',
      'R-HALLUCINATED-SOURCE',
      'R-FABRICATED-DOI',
      'R-VN-LEGAL-FABRICATED',
      'R-RATE-LIMITED-ABSTAIN',
      'R-DEAD-URL',
      'R-GLOBAL-DOI-RA-VERIFIED',
      'R-DOI-RA-NO-CSL',
      'R-API_EXHAUSTED',
      'R-NO-CANDIDATE',
      'R-ABSTENTION-BORDER',
      'R-CROSS-LINGUAL-TITLE-MATCH',
      'R-LOCAL_DB',
      'R-LOCAL_DB_METADATA_ERROR',
      'R-CONSENSUS-PARTIAL',
      'R16_SYNTHETIC_PATTERN',
    ];
    for (const ruleId of auditedRules) {
      const enRule = getRuleDisplayName(ruleId, 'en');
      const viRule = getRuleDisplayName(ruleId, 'vi');
      expect(enRule).not.toMatch(/chimeric|fabricated|hallucinat|TDTU|HTTP 429|HTTP 404|CSL-JSON|canonical/i);
      expect(viRule).not.toMatch(
        /ngụy tạo|bịa đặt|TDTU|HTTP 429|HTTP 404|CSL-JSON|Hạn ngạch API|ứng viên bài báo|trường metadata|vùng biên không chắc chắn|thư viện cục bộ/i,
      );
    }
  });

  it('defines scroll-padding-top: 88px, reduced-motion scroll-behavior: auto, high-contrast .solva-pro-card-surface, .solva-floral-banner-mask, and .citra-nowrap-tail in index.css while preserving self-hosted Sentient fonts', () => {
    const indexCssRaw = readFileSync(resolve(__dirname, '../index.css'), 'utf8');
    expect(indexCssRaw).toMatch(/html\s*\{[^}]*scroll-padding-top:\s*88px\s*;/s);
    expect(indexCssRaw).toMatch(
      /@media\s*\(\s*prefers-reduced-motion:\s*reduce\s*\)\s*\{[\s\S]*?html\s*\{\s*scroll-behavior:\s*auto\s*;\s*\}/,
    );

    const lightSurfaceMatch = indexCssRaw.match(
      /(?<!\.dark\s)\.solva-pro-card-surface\s*\{([^}]*)\}/s,
    );
    expect(lightSurfaceMatch).not.toBeNull();
    expect(lightSurfaceMatch?.[1]).toMatch(
      /background(?:-color)?:\s*(?:#[0-9a-fA-F]{6}|rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*0\.9[4-9]\d*\s*\))/,
    );

    const darkSurfaceMatch = indexCssRaw.match(
      /\.dark\s+\.solva-pro-card-surface\s*\{([^}]*)\}/s,
    );
    expect(darkSurfaceMatch).not.toBeNull();
    expect(darkSurfaceMatch?.[1]).toMatch(
      /background(?:-color)?:\s*(?:#[0-9a-fA-F]{6}|rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*0\.9[4-9]\d*\s*\))/,
    );

    expect(indexCssRaw).toMatch(
      /\.solva-floral-banner-mask\s*\{[^}]*mask-image:\s*linear-gradient\(/s,
    );
    expect(indexCssRaw).toMatch(
      /\.citra-nowrap-tail\s*\{[^}]*white-space:\s*nowrap\s*;[^}]*display:\s*inline\s*;/s,
    );
    expect(indexCssRaw).toContain('/fonts/Sentient-Light.woff2');
    expect(indexCssRaw).toContain('/fonts/Sentient-Regular.woff2');
    expect(indexCssRaw).not.toContain('cdn.fontshare.com');
  });
});
