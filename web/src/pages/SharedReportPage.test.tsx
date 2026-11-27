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
      'Hệ thống này là công cụ hỗ trợ giảng viên',
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

  it('renders Incomplete Reference / Thiếu quy cách trích dẫn badge for R-INCOMPLETE-METADATA in SharedReportPage', async () => {
    vi.spyOn(api, 'getSharedEssayReport').mockResolvedValue({
      essay_id: 31,
      filename: 'incomplete_vs_typo_refs.pdf',
      created_at: '2026-11-14T08:00:00Z',
      num_pages: 8,
      num_citations: 2,
      cis: {
        score: 71.2,
        components: {
          verified_ratio: 0.0,
          metadata_accuracy: 0.375,
          in_text_bib_consistency: 1.0,
          format_consistency: 0.85,
          identifier_validity: 1.0,
        },
        weights_used: {},
        num_citations: 2,
        num_unresolved: 0,
        disclaimer: 'This system is a decision-support tool.',
      },
      style_profile: {
        style: 'APA_LIKE',
        confidence: 0.92,
        apa_count: 2,
        ieee_count: 0,
        mixed_count: 0,
        features: {},
        ratios: {},
        explanation: '',
      },
      receipt_id: 'CITRA-00031-11223344',
      verified_at: '2026-11-14T08:00:00Z',
      disclaimer: 'This system is a decision-support tool.',
      verdict_counts: {
        verified: 0,
        metadata_error: 2,
        suspected_hallucination: 0,
        unresolved: 0,
        resource: 0,
      },
      verdicts: [
        {
          reference_id: 'ref-0001',
          raw_text: '[1] Making a robot vacuum cleaner to avoid falling down the stairs',
          label: 'metadata_error',
          confidence: 0.8,
          explanation: 'Incomplete bibliographic reference.',
          triggered_rules: ['R-INCOMPLETE-METADATA'],
          matched_source: null,
        },
        {
          reference_id: 'ref-0002',
          raw_text: 'Vaswani, A. et al. (2018). Attention Is All You Need. NeurIPS.',
          label: 'metadata_error',
          confidence: 0.72,
          explanation: 'Publication year mismatch (2018 vs 2017).',
          triggered_rules: ['R-SINGLE-SOURCE-PARTIAL'],
          matched_source: null,
        },
      ],
    });

    renderWithProviders(
      <Routes>
        <Route path="/verify/share/:token" element={<SharedReportPage />} />
      </Routes>,
      { initialRoute: '/verify/share/sh_31_1999999999_abcdef1234567890abcdef12', user: null },
    );

    await waitFor(() => expect(screen.getByTestId('shared-report-page')).toBeDefined());
    expect(screen.getByTestId('shared-verdict-row-0').textContent).toContain('Incomplete Reference');
    expect(screen.getByTestId('shared-verdict-row-1').textContent).toContain('Details Mismatch');

    fireEvent.click(screen.getByTestId('shared-lang-toggle'));
    await waitFor(() =>
      expect(screen.getByTestId('shared-verdict-row-0').textContent).toContain(
        'Thiếu quy cách trích dẫn',
      ),
    );
    expect(screen.getByTestId('shared-verdict-row-1').textContent).toContain('Sai lệch thông tin');
  });

  it('BUG-44: renders Print & Theme controls, non-truncated verified date, clean receipt branding, Restricted Access 403, and branded invalid-token header', async () => {
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => {});
    vi.spyOn(api, 'getSharedEssayReport').mockResolvedValueOnce({
      essay_id: 88,
      filename: 'public_receipt_audit.pdf',
      created_at: '2026-11-27T05:30:00Z',
      num_pages: 12,
      num_citations: 1,
      cis: {
        score: 94.0,
        components: { verified_ratio: 1.0 },
        weights_used: {},
        num_citations: 1,
        num_unresolved: 0,
        disclaimer: '',
      },
      style_profile: {
        style: 'IEEE_LIKE',
        confidence: 0.95,
        apa_count: 0,
        ieee_count: 1,
        mixed_count: 0,
        features: {},
        ratios: {},
        explanation: '',
      },
      receipt_id: 'CITRA-00088-AABBCCDD',
      verified_at: '2026-11-27T05:30:00Z',
      disclaimer: '',
      verdict_counts: {
        verified: 0,
        metadata_error: 0,
        suspected_hallucination: 0,
        unresolved: 0,
        resource: 1,
      },
      verdicts: [
        {
          reference_id: 'ref-0004',
          numeric_index: 5,
          raw_text: '[5] IEEE Access Guidelines. https://ieeeaccess.ieee.org/',
          label: 'resource',
          confidence: 0.92,
          explanation: 'Verified web source [Neural: content alignment score=0.91] `url_resource`.',
          triggered_rules: ['R-URL-RESOURCE'],
          url_status: 'restricted_alive',
          url_status_code: 403,
          matched_source: null,
        },
      ],
    });

    const { unmount } = renderWithProviders(
      <Routes>
        <Route path="/verify/share/:token" element={<SharedReportPage />} />
      </Routes>,
      { initialRoute: '/verify/share/sh_88_valid', user: null },
    );

    await waitFor(() => expect(screen.getByTestId('shared-report-page')).toBeDefined());

    // Branded receipt badge, Print button & Theme toggle
    expect(screen.getByTestId('shared-receipt-badge').textContent).toContain(
      'CITATION VERIFICATION RECEIPT',
    );
    expect(screen.getByTestId('shared-theme-toggle')).toBeDefined();
    fireEvent.click(screen.getByTestId('shared-print-btn'));
    expect(printSpy).toHaveBeenCalledTimes(1);

    // Non-truncated verified date
    const verifiedAt = screen.getByTestId('shared-verified-at');
    expect(verifiedAt.className).toContain('whitespace-nowrap');
    expect(verifiedAt.className).not.toContain('truncate');

    // Clean verdict row: no (ref-0004), no HTTP 403 OK, no [Neural: ...] or backticks
    const row0 = screen.getByTestId('shared-verdict-row-0');
    expect(row0.textContent).toContain('[5]');
    expect(row0.textContent).not.toContain('(ref-0004)');
    expect(row0.textContent).toContain('Restricted Access (HTTP 403)');
    expect(row0.textContent).not.toContain('HTTP 403 OK');
    expect(row0.textContent).not.toContain('[Neural:');
    expect(row0.textContent).not.toContain('`');
    unmount();

    // Invalid token error state renders branded header with language & theme toggles + recovery hint
    vi.spyOn(api, 'getSharedEssayReport').mockRejectedValueOnce(
      new Error('API 400: {"detail":"Invalid share token format"}'),
    );
    renderWithProviders(
      <Routes>
        <Route path="/verify/share/:token" element={<SharedReportPage />} />
      </Routes>,
      { initialRoute: '/verify/share/bad_token', user: null },
    );
    await waitFor(() => expect(screen.getByTestId('shared-report-error')).toBeDefined());
    expect(screen.getByTestId('shared-theme-toggle')).toBeDefined();
    expect(screen.getByTestId('shared-lang-toggle')).toBeDefined();
    expect(screen.getByTestId('shared-report-error').textContent).not.toContain('{"detail"');
    expect(screen.getByTestId('shared-report-error').textContent).toContain(
      'contact the document author',
    );
  });

  it('Round 2 P1-1 & P2-1: clarifies bibliography references vs in-text mentions, localizes style & link status, and avoids green Matched on suspected_hallucination', async () => {
    vi.spyOn(api, 'getSharedEssayReport').mockResolvedValue({
      essay_id: 99,
      receipt_id: 'CITRA-00099-R2POLISH',
      filename: 'Long_Vietnamese_Essay_Filename_Without_Spaces_2026.pdf',
      num_pages: 14,
      num_citations: 11,
      created_at: '2026-10-26T02:40:00Z',
      verified_at: '2026-10-26T02:40:00Z',
      disclaimer: '',
      style_profile: {
        style: 'APA_LIKE',
        confidence: 0.9,
        apa_count: 9,
        ieee_count: 0,
        mixed_count: 0,
        features: {},
        ratios: {},
        explanation: '',
      },
      cis: {
        score: 69.4,
        components: { verified_ratio: 0.694 },
        weights_used: {},
        num_citations: 9,
        num_unresolved: 1,
        disclaimer: '',
      },
      verdict_counts: {
        verified: 4,
        metadata_error: 1,
        suspected_hallucination: 2,
        unresolved: 1,
        resource: 1,
      },
      verdicts: [
        {
          reference_id: 'ref-0001',
          numeric_index: 1,
          raw_text: '[1] Ban Chấp hành Trung ương (2024). Nghị quyết 57. https://chinhphu.vn/nq57',
          label: 'resource',
          confidence: 0.96,
          explanation: 'Matched record. [Neural: content alignment score=0.72, intent=background]',
          triggered_rules: ['R-URL-RESOURCE'],
          url_status: 'alive',
          url_status_code: 200,
          matched_source: null,
        },
        {
          reference_id: 'ref-0002',
          numeric_index: 2,
          raw_text: '[2] Fake Author (2025). Fake Paper. doi:10.9999/fake.001',
          label: 'suspected_hallucination',
          confidence: 0.99,
          explanation:
            'DOI 10.9999/fake.001 matches known fabricated DOI pattern [Neural: content alignment score=0.12]',
          triggered_rules: ['R-FABRICATED-DOI'],
          matched_source: {
            source: 'crossref',
            title: 'Unrelated Real Paper',
            authors: ['Real Author'],
            year: '2021',
            doi: '10.1000/real',
            url: null,
            matched_fields: ['doi'],
            checked_at: '2026-10-26T02:40:00Z',
          },
        },
      ],
    });

    await i18n.changeLanguage('vi');
    renderWithProviders(
      <Routes>
        <Route path="/verify/share/:token" element={<SharedReportPage />} />
      </Routes>,
      { initialRoute: '/verify/share/sh_99_r2', user: null },
    );

    await waitFor(() => expect(screen.getByTestId('shared-report-page')).toBeDefined());

    // Responsive citations summary explicitly shows references vs in-text mentions
    const citationsSummary = screen.getByTestId('shared-citations-summary');
    expect(citationsSummary.textContent).toContain('2 tài liệu tham khảo (11 lượt trích)');

    // Style localized (APA-LIKE -> Gần chuẩn APA) and Link Active (no HTTP 200 OK)
    expect(screen.getByTestId('shared-report-page').textContent).toContain('Gần chuẩn APA');
    expect(screen.getByTestId('shared-report-page').textContent).toContain('Liên kết hoạt động');
    expect(screen.getByTestId('shared-report-page').textContent).not.toContain('HTTP 200 OK');

    // Expand hallucination row -> sanitized Vietnamese reasoning & candidate warning (NEVER green Đã khớp)
    const row1 = screen.getByTestId('shared-verdict-row-1');
    const expandBtn = row1.querySelector('button');
    expect(expandBtn).not.toBeNull();
    fireEvent.click(expandBtn!);
    await waitFor(() =>
      expect(row1.textContent).toContain('Ứng viên tham khảo (chưa đủ khớp)'),
    );
    expect(row1.textContent).not.toContain('fabricated');
    expect(row1.textContent).not.toContain('[Neural:');

    // Switch to EN -> explicit EN references vs mentions wording
    fireEvent.click(screen.getByTestId('shared-lang-toggle'));
    await waitFor(() =>
      expect(screen.getByTestId('shared-citations-summary').textContent).toContain(
        '2 references (11 mentions)',
      ),
    );
    expect(screen.getByTestId('shared-report-page').textContent).toContain('Link Active');
  });

  it('Round 3 [P2-R2-1 & P3-R2-5]: renders amber non-confirmed candidate badge on unresolved verdict with matched_source and wraps underscore filenames cleanly', async () => {
    vi.spyOn(api, 'getSharedEssayReport').mockResolvedValue({
      essay_id: 105,
      receipt_id: 'CITRA-00105-R3UNRES',
      filename: 'essay_03_comprehensive.pdf',
      num_pages: 10,
      num_citations: 1,
      created_at: '2026-11-27T02:00:00Z',
      verified_at: '2026-11-27T02:00:00Z',
      disclaimer: '',
      style_profile: {
        style: 'APA_LIKE',
        confidence: 0.95,
        apa_count: 1,
        ieee_count: 0,
        mixed_count: 0,
        features: {},
        ratios: {},
        explanation: '',
      },
      cis: {
        score: 78.0,
        components: { verified_ratio: 0.5 },
        weights_used: {},
        num_citations: 1,
        num_unresolved: 1,
        disclaimer: '',
      },
      verdict_counts: {
        verified: 0,
        metadata_error: 0,
        suspected_hallucination: 0,
        unresolved: 1,
        resource: 0,
      },
      verdicts: [
        {
          reference_id: 'ref-0004',
          numeric_index: 4,
          raw_text: '[4] Local Monograph (2022). Unindexed Study.',
          label: 'unresolved',
          confidence: 0.42,
          explanation: 'Weak candidate match on Crossref.',
          triggered_rules: ['R-WEAK-EVIDENCE'],
          matched_source: {
            source: 'crossref',
            title: 'Partially Similar Paper',
            authors: ['Some Author'],
            year: '2022',
            doi: '10.1000/partial',
            url: null,
            matched_fields: ['year'],
            checked_at: '2026-11-27T02:00:00Z',
          },
        },
      ],
    });

    await i18n.changeLanguage('vi');
    renderWithProviders(
      <Routes>
        <Route path="/verify/share/:token" element={<SharedReportPage />} />
      </Routes>,
      { initialRoute: '/verify/share/sh_105_r3', user: null },
    );

    await waitFor(() => expect(screen.getByTestId('shared-report-page')).toBeDefined());

    // Filename preserves exact textContent while inserting <wbr> break points and keeping .pdf unbroken
    const filenameEl = screen.getByTestId('shared-report-filename');
    expect(filenameEl.textContent).toBe('essay_03_comprehensive.pdf');
    expect(filenameEl.className).not.toContain('break-all');
    expect(filenameEl.querySelectorAll('wbr').length).toBeGreaterThan(0);

    // Unresolved verdict [4] with matched_source renders AMBER candidate header, NEVER bright green Nguồn Khớp
    const matchedHeader = screen.getByTestId('shared-matched-source-header-0');
    expect(matchedHeader.className).toContain('text-amber-700');
    expect(matchedHeader.className).not.toContain('text-emerald-700');
    expect(matchedHeader.textContent).toContain('Ứng viên tham khảo (chưa đủ khớp): Crossref');
    expect(matchedHeader.textContent).not.toContain('Nguồn Khớp');

    // Switch to EN -> Candidate (insufficient match): Crossref
    fireEvent.click(screen.getByTestId('shared-lang-toggle'));
    await waitFor(() =>
      expect(screen.getByTestId('shared-matched-source-header-0').textContent).toContain(
        'Candidate (insufficient match): Crossref',
      ),
    );
  });
});
