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
import {
  getRuleDisplayName,
  getVerdictExplanation,
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
