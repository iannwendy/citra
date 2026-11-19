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
  getVerdictExplanation,
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
      'Cited web page title/metadata does not match',
    );
    expect(getRuleDisplayName('R-URL-CONTENT-MISMATCH', 'vi')).toContain(
      'Tiêu đề hoặc metadata của trang URL không khớp',
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
    expect(enExplanation).toContain('rather than a fabricated source');

    const viExplanation = getVerdictExplanation(incompleteVerdict, 'vi');
    expect(viExplanation).toContain('Thiếu quy cách trích dẫn');
    expect(viExplanation).toContain('tác giả, năm xuất bản và nơi công bố');
    expect(viExplanation).toContain('không phải nguồn bịa đặt');
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
    expect(screen.getByText('Metadata Error')).toBeDefined();
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
    expect(screen.getByText('Lỗi Metadata')).toBeDefined();
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
    ).toBe('⚠ METADATA_ERROR');
    expect(
      getVerdictBadgeVisuals('metadata_error', ['R-LEGAL-YEAR-MISMATCH'], 'vi')
        .text,
    ).toBe('⚠ LEGAL_METADATA_ERROR');
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
    expect(screen.getByText('Metadata Error')).toBeDefined();
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
    expect(screen.getByText('Lỗi Metadata')).toBeDefined();
    vi.restoreAllMocks();
  });
});

describe('Task 0.1: Plain-language verdict/mapping helpers & Solva CSS tokens', () => {
  it('maps SUSPECTED_HALLUCINATION and METADATA_ERROR to human-friendly plain-language labels with action hints', () => {
    const viSuspected = getPlainVerdictLabel('SUSPECTED_HALLUCINATION', 'vi');
    expect(viSuspected.label).toBe('Không tìm thấy nguồn gốc');
    expect(viSuspected.technicalCode).toBe('SUSPECTED_HALLUCINATION');
    expect(viSuspected.actionHint.trim().length).toBeGreaterThan(15);

    const enMeta = getPlainVerdictLabel('METADATA_ERROR', 'en');
    expect(enMeta.label).toBe('Citation Details Mismatch');
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
      'Citation Details Mismatch',
    );

    const unknownVi = getPlainVerdictLabel('FUTURE_UNKNOWN_STATE', 'vi');
    expect(unknownVi.label).toBe('Cần kiểm tra thủ công');
    expect(unknownVi.technicalCode).toBe('FUTURE_UNKNOWN_STATE');
    expect(unknownVi.actionHint.trim().length).toBeGreaterThan(10);

    const emptyEn = getPlainVerdictLabel('', 'en');
    expect(emptyEn.label).toBe('Needs Manual Check');
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

  it('defines scroll-padding-top: 88px, high-contrast .solva-pro-card-surface, .solva-floral-banner-mask, and .citra-nowrap-tail in index.css while preserving self-hosted Sentient fonts', () => {
    const indexCssRaw = readFileSync(resolve(__dirname, '../index.css'), 'utf8');
    expect(indexCssRaw).toMatch(/html\s*\{[^}]*scroll-padding-top:\s*88px\s*;/s);

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
