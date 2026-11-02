import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Routes, Route } from 'react-router-dom';
import { api } from '@/api/client';
import i18n from '@/i18n';
import { renderWithProviders, makeUser, screen, fireEvent, waitFor } from '@/test-utils';
import { encodeQrMatrix } from '@/lib/qrCode';
import { SharedReportPage } from './SharedReportPage';
import { EssayHeader } from './essay/EssayHeader';

describe('Task 6.1: SharedReportPage & EssayHeader Share Receipt', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await i18n.changeLanguage('en');
  });

  it('renders CITRA Digital Verification Receipt, QR matrix, CIS score, and expandable verdicts', async () => {
    vi.spyOn(api, 'getSharedEssayReport').mockResolvedValue({
      essay_id: 7,
      filename: 'transformer_citations_2026.pdf',
      created_at: '2026-11-02T10:00:00Z',
      num_pages: 14,
      num_citations: 2,
      cis: {
        score: 92.4,
        components: {
          verified_ratio: 0.95,
          metadata_accuracy: 0.9,
          in_text_bib_consistency: 1.0,
          format_consistency: 0.88,
          identifier_validity: 0.9,
        },
        weights_used: {},
        num_citations: 2,
        num_unresolved: 0,
        disclaimer: 'Decision support tool only.',
      },
      style_profile: {
        style: 'APA_LIKE',
        confidence: 0.96,
        apa_count: 10,
        ieee_count: 0,
        mixed_count: 0,
        features: {},
        ratios: {},
        explanation: '',
      },
      receipt_id: 'CITRA-00007-ABCDEF12',
      verified_at: '2026-11-02T10:00:00Z',
      disclaimer: 'Decision support tool only.',
      verdict_counts: {
        verified: 1,
        metadata_error: 0,
        suspected_hallucination: 1,
        unresolved: 0,
        resource: 0,
      },
      verdicts: [
        {
          reference_id: 'ref-0001',
          raw_text: 'Vaswani, A., et al. (2017). Attention Is All You Need. NeurIPS.',
          label: 'verified',
          confidence: 0.99,
          explanation: 'Exact title and DOI match in OpenAlex.',
          triggered_rules: ['R1_EXACT_MATCH'],
          matched_source: {
            source: 'openalex',
            title: 'Attention Is All You Need',
            authors: ['Ashish Vaswani'],
            year: '2017',
            venue: 'NeurIPS',
            doi: '10.48550/arXiv.1706.03762',
            matched_fields: ['title', 'year'],
            checked_at: '2026-11-02T10:00:00Z',
          },
        },
        {
          reference_id: 'ref-0002',
          raw_text: 'Sterling, J. (2025). Hallucinated Paper Title. Fake Conf.',
          label: 'suspected_hallucination',
          confidence: 0.91,
          explanation: 'Zero matches across 15+ scholarly indexes.',
          triggered_rules: ['R3_ZERO_RETRIEVAL'],
          matched_source: null,
        },
      ],
    });

    renderWithProviders(
      <Routes>
        <Route path="/verify/share/:token" element={<SharedReportPage />} />
      </Routes>,
      { initialRoute: '/verify/share/sh_7_1999999999_abcdef1234567890abcdef12', user: null },
    );

    await waitFor(() => expect(screen.getByTestId('shared-report-page')).toBeDefined());
    expect(screen.getByTestId('receipt-id-badge').textContent).toContain('CITRA-00007-ABCDEF12');
    expect(screen.getByTestId('hmac-verified-seal').textContent).toContain('HMAC-SHA256');
    expect(screen.getByTestId('qr-verification-matrix')).toBeDefined();
    expect(screen.getByTestId('shared-cis-score').textContent).toContain('92.4');
    expect(screen.getByTestId('shared-report-filename').textContent).toBe(
      'transformer_citations_2026.pdf',
    );
    expect(screen.getByTestId('count-verified').textContent).toBe('1');
    expect(screen.getByTestId('count-suspected').textContent).toBe('1');
    expect(screen.getByTestId('shared-verdict-row-0').textContent).toContain(
      'Attention Is All You Need',
    );
  });

  it('displays error card when share token is invalid or expired', async () => {
    vi.spyOn(api, 'getSharedEssayReport').mockRejectedValue(
      new Error('Invalid or tampered share token signature'),
    );

    renderWithProviders(
      <Routes>
        <Route path="/verify/share/:token" element={<SharedReportPage />} />
      </Routes>,
      { initialRoute: '/verify/share/sh_7_1_tampered', user: null },
    );

    await waitFor(() => expect(screen.getByTestId('shared-report-error')).toBeDefined());
    expect(screen.getByTestId('shared-report-error').textContent).toContain(
      'Invalid or tampered share token signature',
    );
  });

  it('EssayHeader Share Receipt button calls createEssayShareLink and displays Receipt ID link', async () => {
    const spy = vi.spyOn(api, 'createEssayShareLink').mockResolvedValue({
      essay_id: 42,
      share_token: 'sh_42_1999999999_11223344556677889900aabb',
      share_url: '/verify/share/sh_42_1999999999_11223344556677889900aabb',
      receipt_id: 'CITRA-00042-11223344',
      expires_at: '2026-12-02T00:00:00Z',
    });

    renderWithProviders(
      <EssayHeader
        essayId={42}
        filename="manuscript.pdf"
        numPages={10}
        numCitations={15}
        styleName="APA"
      />,
      { user: makeUser('user', 'basic') },
    );

    const shareBtn = screen.getByTestId('share-receipt-btn');
    fireEvent.click(shareBtn);

    await waitFor(() => expect(spy).toHaveBeenCalledWith(42));
    await waitFor(() => expect(screen.getByTestId('shared-receipt-banner')).toBeDefined());
    expect(screen.getByTestId('shared-receipt-banner').textContent).toContain(
      'CITRA-00042-11223344',
    );
    expect(screen.getByTestId('shared-receipt-link').getAttribute('href')).toBe(
      '/verify/share/sh_42_1999999999_11223344556677889900aabb',
    );
  });

  it('toggles language EN <-> VI without re-fetching API, localizes disclaimer/explanations, and copies link reliably', async () => {
    const getReportSpy = vi.spyOn(api, 'getSharedEssayReport').mockResolvedValue({
      essay_id: 27,
      filename: 'ACL2026_CameraReady_Final.pdf',
      created_at: '2026-11-02T10:00:00Z',
      num_pages: 9,
      num_citations: 1,
      cis: {
        score: 96.2,
        components: {
          verified_ratio: 1.0,
          metadata_accuracy: 1.0,
          in_text_bib_consistency: 1.0,
          format_consistency: 1.0,
          identifier_validity: 0.5,
        },
        weights_used: {},
        num_citations: 1,
        num_unresolved: 0,
        disclaimer: 'Decision support tool only.',
      },
      style_profile: {
        style: 'APA_LIKE',
        confidence: 1.0,
        apa_count: 1,
        ieee_count: 0,
        mixed_count: 0,
        features: {},
        ratios: {},
        explanation: '',
      },
      receipt_id: 'CITRA-00027-9556E7E5',
      verified_at: '2026-11-02T10:00:00Z',
      disclaimer: 'Decision support tool only.',
      verdict_counts: {
        verified: 1,
        metadata_error: 0,
        suspected_hallucination: 0,
        unresolved: 0,
        resource: 0,
      },
      verdicts: [
        {
          reference_id: 'ref-0001',
          raw_text: 'Vaswani, A. (2017). Attention Is All You Need. NeurIPS.',
          label: 'verified',
          confidence: 0.96,
          explanation: 'Exact match in local DB (title_sim=1.00, author_sim=1.00)',
          triggered_rules: ['R-LOCAL_DB_VERIFIED', 'R-LOCAL_DB'],
          matched_source: {
            source: 'local_db',
            title: 'Attention Is All You Need',
            authors: ['Ashish Vaswani'],
            year: '2017',
            venue: 'NeurIPS',
            doi: '10.48550/arXiv.1706.03762',
            matched_fields: ['title', 'authors', 'year'],
            checked_at: '2026-11-02T10:00:00Z',
          },
        },
      ],
    });

    renderWithProviders(
      <Routes>
        <Route path="/verify/share/:token" element={<SharedReportPage />} />
      </Routes>,
      { initialRoute: '/verify/share/sh_27_1777721599_9556e7e57cf6544577924f50', user: null },
    );

    await waitFor(() => expect(screen.getByTestId('shared-report-page')).toBeDefined());
    expect(getReportSpy).toHaveBeenCalledTimes(1);

    // Current language is English -> button shows 'EN' and disclaimer is in English
    const langBtn = screen.getByTestId('shared-lang-toggle');
    expect(langBtn.textContent).toContain('EN');
    expect(screen.getByTestId('shared-report-disclaimer').textContent).toContain(
      'This system is a decision-support tool',
    );

    // Toggle to Vietnamese -> shows 'VI', does NOT re-fetch API, and localizes disclaimer + explanation
    fireEvent.click(langBtn);
    await waitFor(() => expect(langBtn.textContent).toContain('VI'));
    expect(getReportSpy).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('shared-report-disclaimer').textContent).toContain(
      'Hệ thống này chỉ hỗ trợ giảng viên',
    );
    expect(screen.getByTestId('shared-verdict-row-0').textContent).toContain(
      'thư viện học thuật cục bộ',
    );
    expect(screen.getByTestId('shared-verdict-row-0').textContent).toContain(
      'DOI / Nguồn gốc',
    );

    // Copy Link button works and updates label to Vietnamese "Đã sao chép!"
    const copyBtn = screen.getByTestId('copy-share-url-btn');
    fireEvent.click(copyBtn);
    await waitFor(() =>
      expect(copyBtn.textContent).toContain('Đã sao chép!'),
    );

    // Genuine ISO/IEC 18004 QR matrix validation
    const qrSvg = screen.getByTestId('qr-verification-matrix');
    const matrix = encodeQrMatrix(
      'https://citra.io.vn/verify/share/sh_27_1777721599_9556e7e57cf6544577924f50',
    );
    expect(matrix.length).toBeGreaterThanOrEqual(29);
    // 7x7 finder pattern top-left row 0 has 7 dark modules followed by 1 light separator
    expect(matrix[0]!.slice(0, 8)).toEqual([1, 1, 1, 1, 1, 1, 1, 0]);
    expect(qrSvg.getAttribute('shape-rendering') || qrSvg.getAttribute('shapeRendering')).toBeTruthy();
  });
});
