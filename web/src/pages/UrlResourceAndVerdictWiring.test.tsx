import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Routes, Route } from 'react-router-dom';
import { api } from '@/api/client';
import i18n from '@/i18n';
import { renderWithProviders, makeUser, screen, fireEvent, waitFor } from '@/test-utils';
import { makeReport, makeVerdict } from '@/test-fixtures';
import { EssayPage } from './EssayPage';
import { SharedReportPage } from './SharedReportPage';
import { IssuesPage } from './IssuesPage';
import { LogicTracePage } from './LogicTracePage';
import { DocumentInspectorPage } from './DocumentInspectorPage';
import { OrphanDetectionPage } from './OrphanDetectionPage';
import { VerdictBadge } from '@/components/VerdictBadge';
import { RuleInspector } from '@/components/RuleInspector';
import { BibliographyRemediationModal } from '@/components/BibliographyRemediationModal';
import { LiveCitationSandbox } from '@/components/LiveCitationSandbox';
import { EvidenceGraph } from '@/components/CitationGraph/EvidenceGraph';

describe('Wave 2A: URL Resource Metadata, Verdict Diff Table, Composite Sub-Refs & Telemetry Wiring', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await i18n.changeLanguage('en');
  });

  it('EssayPage Case (a): renders extracted HTML metadata on Web RESOURCE (HuffPost <-> The Huffington Post, neutral undeclared fields, zero red Diff)', async () => {
    const report = makeReport({
      essay_id: 201,
      verdicts: [
        makeVerdict({
          citation_id: 'cit-web-1',
          citation_raw:
            '[1] HuffPost (2023). Why Academic Citation Checking Matters. HuffPost. Available at: https://www.huffpost.com/entry/citation-checking',
          label: 'resource',
          confidence: 0.91,
          triggered_rules: ['R-URL-RESOURCE'],
          mismatched_fields: [],
          url_status: 'alive',
          url_status_code: 200,
          cited_url: 'https://www.huffpost.com/entry/citation-checking',
          html_meta: {
            page_title: 'Why Academic Citation Checking Matters',
            authors: [],
            year: 2023,
            site_name: 'The Huffington Post',
            doi: null,
            canonical_url: 'https://www.huffpost.com/entry/citation-checking',
          },
          matched_sources: [
            {
              source: 'web_html_meta',
              title: 'Why Academic Citation Checking Matters',
              authors: [],
              year: '2023',
              venue: 'The Huffington Post',
              url: 'https://www.huffpost.com/entry/citation-checking',
              confidence: 0.91,
              matched_fields: ['title', 'year', 'venue'],
              checked_at: '2026-11-10T00:00:00Z',
            },
          ],
          features: {
            html_meta_title_sim: 0.96,
            url_status: 'alive',
            url_status_code: 200,
          },
        }),
      ],
    });
    vi.spyOn(api, 'getEssay').mockResolvedValue(report);

    const { container, unmount } = renderWithProviders(
      <Routes>
        <Route path="/verification/report/:id" element={<EssayPage />} />
      </Routes>,
      {
        user: makeUser('teacher', 'pro'),
        initialRoute: '/verification/report/201',
      },
    );

    await waitFor(() =>
      expect(screen.getAllByText(/Why Academic Citation Checking Matters/).length).toBeGreaterThan(0),
    );
    const diffTableText = container.querySelector('table')?.textContent ?? '';
    expect(diffTableText).toContain('The Huffington Post');
    expect(diffTableText).toContain('Not declared in page metadata');
    expect(diffTableText).not.toContain('Available at:');
    expect(container.textContent).not.toContain('No canonical record found');
    expect(container.textContent).not.toContain('✕ Diff');

    // Check Vietnamese localization for Case (a)
    unmount();
    await i18n.changeLanguage('vi');
    const { container: viContainer } = renderWithProviders(
      <Routes>
        <Route path="/verification/report/:id" element={<EssayPage />} />
      </Routes>,
      {
        user: makeUser('teacher', 'pro'),
        initialRoute: '/verification/report/201',
      },
    );
    await waitFor(() =>
      expect(screen.getAllByText(/Why Academic Citation Checking Matters/).length).toBeGreaterThan(0),
    );
    expect(viContainer.textContent).toContain('Trang web không khai báo thẻ này');
    expect(viContainer.textContent).not.toContain('Không tìm thấy bản ghi chuẩn');
    expect(viContainer.textContent).not.toContain('✕ Lệch');
  });

  it('EssayPage Case (b): renders neutral Web Resource text and badges when RESOURCE has no extractable HTML meta (403 bot-wall & direct web)', async () => {
    const report = makeReport({
      essay_id: 202,
      verdicts: [
        makeVerdict({
          citation_id: 'cit-botwall',
          citation_raw:
            '[1] OpenAI (2024). System Card Technical Overview. https://platform.openai.com/docs/overview',
          label: 'resource',
          confidence: 0.85,
          triggered_rules: ['R-URL-RESOURCE'],
          mismatched_fields: [],
          matched_sources: [],
          url_status: 'restricted_alive',
          url_status_code: 403,
          cited_url: 'https://platform.openai.com/docs/overview',
        }),
      ],
    });
    vi.spyOn(api, 'getEssay').mockResolvedValue(report);

    const { container, unmount } = renderWithProviders(
      <Routes>
        <Route path="/verification/report/:id" element={<EssayPage />} />
      </Routes>,
      {
        user: makeUser('teacher', 'pro'),
        initialRoute: '/verification/report/202',
      },
    );

    await waitFor(() =>
      expect(screen.getAllByText(/System Card Technical Overview/).length).toBeGreaterThan(0),
    );
    expect(container.textContent).toContain(
      'Verified web resource (bot-protected — HTML meta unavailable)',
    );
    expect(container.textContent).toContain('Web Resource');
    expect(container.textContent).not.toContain('No canonical record found');
    expect(container.textContent).not.toContain('✕ Diff');

    unmount();
    await i18n.changeLanguage('vi');
    const { container: viContainer } = renderWithProviders(
      <Routes>
        <Route path="/verification/report/:id" element={<EssayPage />} />
      </Routes>,
      {
        user: makeUser('teacher', 'pro'),
        initialRoute: '/verification/report/202',
      },
    );
    await waitFor(() =>
      expect(screen.getAllByText(/System Card Technical Overview/).length).toBeGreaterThan(0),
    );
    expect(viContainer.textContent).toContain(
      'Tài nguyên web hợp lệ (tường lửa/chặn bot — không đọc được thẻ HTML)',
    );
    expect(viContainer.textContent).toContain('Tài nguyên Web');
    expect(viContainer.textContent).not.toContain('Không tìm thấy bản ghi chuẩn');
    expect(viContainer.textContent).not.toContain('✕ Lệch');
  });

  it('EssayPage Case (c): displays actual observed wrong page title and Wrong Page badge on R-URL-CONTENT-MISMATCH', async () => {
    const report = makeReport({
      essay_id: 203,
      verdicts: [
        makeVerdict({
          citation_id: 'cit-mismatch-url',
          citation_raw:
            '[1] Nguyen, V. A. (2024). Deep Neural Verification for Vietnamese Citations. https://example.org/wrong-article',
          label: 'metadata_error',
          confidence: 0.82,
          triggered_rules: ['R-URL-CONTENT-MISMATCH'],
          mismatched_fields: ['title', 'url'],
          matched_sources: [],
          url_status: 'alive',
          url_status_code: 200,
          cited_url: 'https://example.org/wrong-article',
          html_meta: {
            page_title: 'Top 10 Summer Cooking Recipes Blog Home',
            authors: ['Chef Bob'],
            year: 2021,
            site_name: 'Daily Food Blog',
            canonical_url: 'https://example.org/wrong-article',
          },
          features: {
            html_meta_title_sim: 0.04,
            url_status: 'alive',
            url_status_code: 200,
          },
        }),
      ],
    });
    vi.spyOn(api, 'getEssay').mockResolvedValue(report);

    const { container, unmount } = renderWithProviders(
      <Routes>
        <Route path="/verification/report/:id" element={<EssayPage />} />
      </Routes>,
      {
        user: makeUser('teacher', 'pro'),
        initialRoute: '/verification/report/203',
      },
    );

    await waitFor(() =>
      expect(container.textContent).toContain('Top 10 Summer Cooking Recipes Blog Home'),
    );
    expect(container.textContent).toContain('Wrong Page');
    expect(container.textContent).toContain('HTTP 200 resolved to a different page title');
    expect(container.textContent).toContain(
      'The actual web page at this URL is titled “Top 10 Summer Cooking Recipes Blog Home”',
    );
    expect(container.textContent).not.toContain('Matching publication found');

    unmount();
    await i18n.changeLanguage('vi');
    const { container: viContainer } = renderWithProviders(
      <Routes>
        <Route path="/verification/report/:id" element={<EssayPage />} />
      </Routes>,
      {
        user: makeUser('teacher', 'pro'),
        initialRoute: '/verification/report/203',
      },
    );
    await waitFor(() =>
      expect(viContainer.textContent).toContain('Top 10 Summer Cooking Recipes Blog Home'),
    );
    expect(viContainer.textContent).toContain('Sai nội dung trang');
    expect(viContainer.textContent).toContain('HTTP 200 hoạt động nhưng trỏ tới tiêu đề trang web khác');
  });

  it('EssayPage Case (d): renders amber Incomplete Metadata messaging without hallucinating authors from bare title or showing red Diff', async () => {
    const report = makeReport({
      essay_id: 204,
      verdicts: [
        makeVerdict({
          citation_id: 'cit-incomplete',
          citation_raw: '(a) Survey of Large Language Model Hallucinations',
          label: 'metadata_error',
          confidence: 0.75,
          triggered_rules: ['R-INCOMPLETE-METADATA'],
          mismatched_fields: ['authors', 'year', 'venue'],
          matched_sources: [],
        }),
      ],
    });
    vi.spyOn(api, 'getEssay').mockResolvedValue(report);

    const { container } = renderWithProviders(
      <Routes>
        <Route path="/verification/report/:id" element={<EssayPage />} />
      </Routes>,
      {
        user: makeUser('teacher', 'pro'),
        initialRoute: '/verification/report/204',
      },
    );

    await waitFor(() =>
      expect(screen.getAllByText(/Survey of Large Language Model Hallucinations/).length).toBeGreaterThan(0),
    );
    expect(container.textContent).toContain('Insufficient citation metadata for canonical lookup');
    expect(container.textContent).toContain('Provided');
    expect(container.textContent).toContain('Missing');
    expect(container.textContent).not.toContain('No canonical record found');
    expect(container.textContent).not.toContain('✕ Diff');

    // Card uses amber styling for metadata_error rather than hallucination-red
    const optionCard = container.querySelector('[data-citation-id="cit-incomplete"]');
    expect(optionCard?.innerHTML).toContain('text-amber-700');
    expect(optionCard?.innerHTML).not.toContain('text-red-600');
  });

  it('Case (e): guards year_distance=999 across EssayPage, LogicTracePage, and EvidenceGraph and localizes TCVN/Textbook/Legal sources', async () => {
    const standardVerdict = makeVerdict({
      citation_id: 'cit-tcvn',
      citation_raw: '[1] Bộ KH&CN (2025). TCVN 12345:2025 An toàn thông tin mạng.',
      label: 'verified',
      confidence: 0.98,
      triggered_rules: ['R-VN-STANDARD-VERIFIED'],
      mismatched_fields: [],
      matched_sources: [
        {
          source: 'tech_standard',
          title: 'TCVN 12345:2025 An toàn thông tin mạng',
          year: '2025',
          venue: 'TCVN / QCVN',
          confidence: 0.98,
          matched_fields: ['title', 'year'],
          checked_at: '2026-11-10T00:00:00Z',
          external_ids: { standard_code: 'TCVN 12345:2025' },
        },
      ],
      features: {
        title_sim_fuzzy: 0.99,
        year_distance: 999,
        has_scholarly_candidate: false,
      },
    });
    const report = makeReport({ essay_id: 205, verdicts: [standardVerdict] });
    vi.spyOn(api, 'getEssay').mockResolvedValue(report);

    const { container, unmount } = renderWithProviders(
      <Routes>
        <Route path="/verification/report/:id" element={<EssayPage />} />
      </Routes>,
      {
        user: makeUser('teacher', 'pro'),
        initialRoute: '/verification/report/205',
      },
    );

    await waitFor(() =>
      expect(screen.getAllByText(/TCVN 12345:2025/).length).toBeGreaterThan(0),
    );
    expect(container.textContent).toContain('VN National Standards (TCVN / QCVN)');
    expect(container.textContent).not.toContain('999');
    expect(container.textContent).not.toContain('1026');
    unmount();

    // LogicTracePage also guards year_distance=999 and renders live features
    const { container: traceContainer, unmount: unmountTrace } = renderWithProviders(
      <Routes>
        <Route path="/verification/report/:id/trace" element={<LogicTracePage />} />
      </Routes>,
      {
        user: makeUser('teacher', 'pro'),
        initialRoute: '/verification/report/205/trace',
      },
    );
    await waitFor(() =>
      expect(traceContainer.textContent).toContain('R-VN-STANDARD-VERIFIED'),
    );
    expect(traceContainer.textContent).not.toContain('999');
    expect(traceContainer.textContent).not.toContain('1026');
    unmountTrace();

    // EvidenceGraph also guards year_distance=999
    const { container: graphContainer } = renderWithProviders(
      <EvidenceGraph verdict={standardVerdict} />,
    );
    expect(graphContainer.textContent).not.toContain('999');
    expect(graphContainer.textContent).toContain('VN National Standards (TCVN / QCVN)');
  });

  it('EssayPage Failed-Essay (409) error card and TCVN3/OCR diagnostics on EssayPage & DocumentInspectorPage', async () => {
    vi.spyOn(api, 'getEssay').mockRejectedValueOnce(
      new Error('HTTP 409 Conflict: Essay analysis job failed during PDF extraction'),
    );

    const { unmount } = renderWithProviders(
      <Routes>
        <Route path="/verification/report/:id" element={<EssayPage />} />
      </Routes>,
      {
        user: makeUser('teacher', 'pro'),
        initialRoute: '/verification/report/206',
      },
    );

    await waitFor(() =>
      expect(screen.getByTestId('essay-failed-analysis-card')).toBeDefined(),
    );
    expect(screen.getByText('Upload Again')).toBeDefined();
    expect(screen.getByText('Back to History')).toBeDefined();
    unmount();

    // TCVN3 + OCR diagnostics on EssayPage and DocumentInspectorPage
    const diagReport = makeReport({
      essay_id: 207,
      document_diagnostics: {
        is_scanned_pdf: false,
        scanned_pages_count: 2,
        total_extractable_chars: 14500,
        avg_chars_per_page: 1812,
        legacy_encoding_detected: 'tcvn3',
        ocr_pages_recovered: [2, 5],
      },
    });
    vi.spyOn(api, 'getEssay').mockResolvedValue(diagReport);

    const { unmount: unmountEssayDiag } = renderWithProviders(
      <Routes>
        <Route path="/verification/report/:id" element={<EssayPage />} />
      </Routes>,
      {
        user: makeUser('teacher', 'pro'),
        initialRoute: '/verification/report/207',
      },
    );
    await waitFor(() =>
      expect(screen.getByTestId('essay-doc-diagnostics-banner')).toBeDefined(),
    );
    expect(
      screen.getByText('Auto-transcoded legacy Vietnamese encoding (TCVN3 → Unicode NFC)'),
    ).toBeDefined();
    expect(
      screen.getByText('Recovered text via Tesseract OCR (vie+eng) on page(s): 2, 5'),
    ).toBeDefined();
    unmountEssayDiag();

    await i18n.changeLanguage('vi');
    renderWithProviders(
      <Routes>
        <Route path="/verification/inspector/:id" element={<DocumentInspectorPage />} />
      </Routes>,
      {
        user: makeUser('teacher', 'pro'),
        initialRoute: '/verification/inspector/207',
      },
    );
    await waitFor(() =>
      expect(screen.getByTestId('inspector-doc-diagnostics-banner')).toBeDefined(),
    );
    expect(
      screen.getByText('Đã tự động chuyển mã bảng mã tiếng Việt cũ (TCVN3 → Unicode NFC)'),
    ).toBeDefined();
    expect(
      screen.getByText('Đã khôi phục văn bản bằng OCR (Tesseract vie+eng) tại trang: 2, 5'),
    ).toBeDefined();
  });

  it('renders composite sub-reference markers [14a] across OrphanDetectionPage, IssuesPage, and SharedReportPage with observed web metadata', async () => {
    const compositeReport = makeReport({
      essay_id: 208,
      verdicts: [
        makeVerdict({
          citation_id: 'v14a',
          numeric_index: 14,
          sub_index: 'a',
          composite_label: '14a',
          citation_raw: 'Wrong Link Claimed Paper (2024). https://example.org/mismatch',
          label: 'metadata_error',
          mapping_status: 'missing_reference',
          triggered_rules: ['R-URL-CONTENT-MISMATCH'],
          url_status: 'alive',
          url_status_code: 200,
          html_meta: {
            page_title: 'Unrelated Portal Homepage',
            site_name: 'Example Portal',
          },
        }),
      ],
      references: [
        {
          reference_id: 'ref-014b',
          raw_text: '(b) Uncited Sub-Reference Entry (2023).',
          cited_in_text_count: 0,
          numeric_index: 14,
          sub_index: 'b',
          composite_label: '14b',
        } as never,
      ],
    });
    vi.spyOn(api, 'getEssay').mockResolvedValue(compositeReport);

    const { container: orphanContainer, unmount: unmountOrphan } = renderWithProviders(
      <Routes>
        <Route path="/verification/report/:id/consistency" element={<OrphanDetectionPage />} />
      </Routes>,
      {
        user: makeUser('teacher', 'pro'),
        initialRoute: '/verification/report/208/consistency',
      },
    );
    await waitFor(() => expect(orphanContainer.textContent).toContain('[14a]'));
    expect(orphanContainer.textContent).toContain('[14b]');
    unmountOrphan();

    const { container: issuesContainer, unmount: unmountIssues } = renderWithProviders(
      <Routes>
        <Route path="/verification/report/:id/issues" element={<IssuesPage />} />
      </Routes>,
      {
        user: makeUser('teacher', 'pro'),
        initialRoute: '/verification/report/208/issues',
      },
    );
    await waitFor(() => expect(issuesContainer.textContent).toContain('[14a]'));
    expect(screen.getByTestId('issue-url-status-badge').textContent).toContain(
      'HTTP 200 · Wrong Page',
    );
    expect(issuesContainer.textContent).toContain('Unrelated Portal Homepage');
    unmountIssues();

    // SharedReportPage composite marker + observed web metadata + Legal Statute badge
    vi.spyOn(api, 'getSharedEssayReport').mockResolvedValue({
      essay_id: 208,
      filename: 'composite_audit.pdf',
      created_at: '2026-11-10T00:00:00Z',
      num_pages: 10,
      num_citations: 2,
      cis: {
        score: 88.0,
        components: {},
        weights_used: {},
        num_citations: 2,
        num_unresolved: 0,
        disclaimer: 'Decision support tool only.',
      },
      style_profile: {
        style: 'IEEE_LIKE',
        confidence: 0.95,
        apa_count: 0,
        ieee_count: 2,
        mixed_count: 0,
        features: {},
        ratios: {},
        explanation: '',
      },
      receipt_id: 'CITRA-00208-99887766',
      verified_at: '2026-11-10T00:00:00Z',
      disclaimer: 'Decision support tool only.',
      verdict_counts: {
        verified: 0,
        metadata_error: 1,
        suspected_hallucination: 0,
        unresolved: 0,
        resource: 1,
      },
      verdicts: [
        {
          reference_id: 'ref-014a',
          numeric_index: 14,
          sub_index: 'a',
          composite_label: '14a',
          raw_text: 'Claimed Paper With Wrong URL (2024). https://example.org/mismatch',
          label: 'metadata_error',
          confidence: 0.81,
          explanation: 'URL content mismatch.',
          triggered_rules: ['R-URL-CONTENT-MISMATCH'],
          matched_source: null,
          url_status: 'alive',
          url_status_code: 200,
          html_meta: {
            page_title: 'Unrelated Portal Homepage',
            site_name: 'Example Portal',
            canonical_url: 'https://example.org/mismatch',
          },
        },
        {
          reference_id: 'ref-015',
          numeric_index: 15,
          raw_text: 'Quốc hội (2025). Luật Bảo vệ dữ liệu cá nhân số 91/2025/QH15.',
          label: 'resource',
          confidence: 0.99,
          explanation: 'Official statute verified.',
          triggered_rules: ['R-VN-LEGAL-VERIFIED'],
          matched_source: {
            source: 'vn_legal_registry',
            title: 'Luật Bảo vệ dữ liệu cá nhân số 91/2025/QH15',
            year: '2025',
            matched_fields: ['title', 'year'],
            checked_at: '2026-11-10T00:00:00Z',
          },
        },
      ],
    });

    const { container: sharedContainer } = renderWithProviders(
      <Routes>
        <Route path="/verify/share/:token" element={<SharedReportPage />} />
      </Routes>,
      { initialRoute: '/verify/share/sh_208_test_token', user: null },
    );

    await waitFor(() => expect(screen.getByTestId('shared-report-page')).toBeDefined());
    expect(sharedContainer.textContent).toContain('[14a]');
    expect(screen.getByTestId('shared-url-status-0').textContent).toContain('Wrong Page');
    expect(screen.getByTestId('shared-observed-web-meta-0').textContent).toContain(
      'Unrelated Portal Homepage',
    );
    expect(sharedContainer.textContent).toContain('Legal Statute');
  });

  it('wires VerdictBadge legal statutes, RuleInspector live features, BibliographyRemediationModal was_modified=false, and LiveCitationSandbox resource cards', async () => {
    // 1. VerdictBadge Legal Statute in EN & VI
    const { rerender, unmount: unmountBadge } = renderWithProviders(
      <VerdictBadge verdict="resource" triggeredRules={['R-VN-LEGAL-VERIFIED']} />,
    );
    expect(screen.getByText('Legal Statute')).toBeDefined();
    await i18n.changeLanguage('vi');
    rerender(<VerdictBadge verdict="resource" triggeredRules={['R-VN-LEGAL-VERIFIED']} />);
    expect(screen.getByText('Văn bản Pháp luật')).toBeDefined();
    unmountBadge();

    await i18n.changeLanguage('en');

    // 2. RuleInspector tech_standard condition + live features pills (guarding year_distance=999)
    const { container: ruleContainer, unmount: unmountRule } = renderWithProviders(
      <RuleInspector
        triggeredRules={['R-VN-STANDARD-VERIFIED', 'R-URL-CONTENT-MISMATCH']}
        verdictLabel="metadata_error"
        features={{
          html_meta_title_sim: 0.12,
          cross_lingual_title_sim: 0.88,
          year_distance: 999,
          has_scholarly_candidate: false,
          url_status: 'alive',
          url_status_code: 200,
        }}
      />,
    );
    expect(ruleContainer.textContent).toContain('tech_standard');
    expect(ruleContainer.textContent).not.toContain('vn_tech_standard');
    const liveFeatures = screen.getByTestId('rule-inspector-live-features');
    expect(liveFeatures.textContent).toContain('html_meta_title_sim=0.12');
    expect(liveFeatures.textContent).toContain('cross_lingual_title_sim=0.88');
    expect(liveFeatures.textContent).not.toContain('999');
    unmountRule();

    // 3. BibliographyRemediationModal was_modified=false vs was_modified=true
    vi.spyOn(api, 'getRemediatedBibliography').mockResolvedValue({
      essay_id: 209,
      style: 'apa',
      total_entries: 2,
      remediated_count: 1,
      hallucination_count: 0,
      error_count: 1,
      combined_text: 'Export preview',
      combined_bibtex: '@misc{c1}',
      combined_ris: 'TY  - GEN',
      entries: [
        {
          index: 1,
          verdict_id: 'c1',
          label: 'metadata_error',
          is_error: true,
          source_used: null,
          original_raw: 'Incomplete Citation Entry',
          remediated_text: 'Incomplete Citation Entry',
          apa: 'Incomplete Citation Entry',
          ieee: '[1] Incomplete Citation Entry',
          tdtu: 'Incomplete Citation Entry',
          bibtex: '@misc{c1}',
          ris: 'TY  - GEN',
          diff_fields: ['authors', 'year'],
          was_modified: false,
          canonical_metadata: {
            title: 'Incomplete Citation Entry',
            authors: [],
            year: '',
            venue: '',
            doi: '',
            url: '',
          },
        },
        {
          index: 2,
          verdict_id: 'c2',
          label: 'metadata_error',
          is_error: true,
          source_used: 'crossref',
          original_raw: 'Vaswani, A. (2019). Attention Is All You Need.',
          remediated_text: 'Vaswani, A. (2017). Attention Is All You Need. NeurIPS.',
          apa: 'Vaswani, A. (2017). Attention Is All You Need. NeurIPS.',
          ieee: '[2] A. Vaswani, "Attention Is All You Need," NeurIPS, 2017.',
          tdtu: 'Vaswani, A. (2017). Attention Is All You Need. NeurIPS.',
          bibtex: '@inproceedings{vaswani2017}',
          ris: 'TY  - CONF',
          diff_fields: ['year'],
          was_modified: true,
          canonical_metadata: {
            title: 'Attention Is All You Need',
            authors: ['Ashish Vaswani'],
            year: '2017',
            venue: 'NeurIPS',
            doi: '10.48550/arXiv.1706.03762',
            url: 'https://doi.org/10.48550/arXiv.1706.03762',
          },
        },
      ],
    });

    const { unmount: unmountModal } = renderWithProviders(
      <BibliographyRemediationModal
        open={true}
        essayId={209}
        filename="thesis.pdf"
        lang="en"
        onClose={() => {}}
      />,
    );
    await waitFor(() =>
      expect(screen.getByText('⚠ Manual Review Required')).toBeDefined(),
    );
    expect(screen.getByText('✓ Auto-Repaired')).toBeDefined();
    unmountModal();

    // 4. LiveCitationSandbox resource card + R-URL-CONTENT-MISMATCH observed page title
    vi.spyOn(api, 'sampleSandboxAclPapers').mockResolvedValue({
      count: 1,
      style: 'apa',
      database_total_papers: 128000,
      items: [
        {
          index: 1,
          title: 'React Documentation',
          authors: [],
          authors_text: '',
          year: '2025',
          venue: 'react.dev',
          doi: '',
          cite_in_text: true,
          include_in_references: true,
          in_text_year_override: '',
          in_text_context: '',
        },
      ],
    });
    vi.spyOn(api, 'verifySandboxCitationsInstant').mockResolvedValue({
      elapsed_seconds: 0.15,
      total: 2,
      summary: {
        verified: 0,
        metadata_error: 1,
        suspected_hallucination: 0,
        resource: 1,
        layer1_linking_issues: 0,
      },
      results: [
        {
          index: 1,
          composite_label: '1a',
          citation_raw: 'React Team (2025). React Official Docs. https://react.dev',
          label: 'resource',
          confidence: 0.94,
          mapping_status: 'matched',
          mapping_note: '',
          reasoning: 'Live web documentation verified.',
          triggered_rules: ['R-URL-RESOURCE'],
          mismatched_fields: [],
          url_status: 'alive',
          url_status_code: 200,
          html_meta: {
            page_title: 'React – The library for web and native user interfaces',
            site_name: 'React',
            year: 2025,
          },
        },
        {
          index: 2,
          citation_raw: 'Fake Title Claim (2024). https://react.dev/blog',
          label: 'metadata_error',
          confidence: 0.8,
          mapping_status: 'matched',
          mapping_note: '',
          reasoning: 'Observed HTML title differs from claimed citation.',
          triggered_rules: ['R-URL-CONTENT-MISMATCH'],
          mismatched_fields: ['title'],
          url_status: 'alive',
          url_status_code: 200,
          html_meta: {
            page_title: 'React Blog Archive',
            site_name: 'React',
          },
        },
      ],
    });

    renderWithProviders(<LiveCitationSandbox lang="en" />, {
      user: makeUser('teacher', 'pro'),
    });

    fireEvent.click(screen.getByTestId('sandbox-mode-raw-btn'));
    const submitBtn = await screen.findByTestId('sandbox-verify-submit-btn');
    await waitFor(() => expect((submitBtn as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(submitBtn);

    await waitFor(() =>
      expect(screen.getByTestId('sandbox-result-card-1')).toBeDefined(),
    );
    const resCard0 = screen.getByTestId('sandbox-result-card-1');
    expect(resCard0.className).toContain('border-sky-200');
    expect(resCard0.textContent).toContain('[1a]');
    expect(resCard0.textContent).toContain('URL RESOURCE');
    expect(resCard0.textContent).toContain(
      'React – The library for web and native user interfaces',
    );

    const resCard1 = screen.getByTestId('sandbox-result-card-2');
    expect(resCard1.textContent).toContain('HTTP 200 · Wrong Page');
    expect(resCard1.textContent).toContain('React Blog Archive');
  });

  it('Tour 1 Polish: Wayback fallback on bot-walled unchecked URLs, DOCX OpenXML badge, curated TCVN primary source scoping, and [8a] <mark> highlight', async () => {
    // 1. LiveCitationSandbox: url_status='unchecked' + archive_url shows WAYBACK ARCHIVED (never FAKE URL) & splits Legal Statute count
    vi.spyOn(api, 'sampleSandboxAclPapers').mockResolvedValue({
      count: 1,
      style: 'apa',
      database_total_papers: 128000,
      items: [],
    });
    vi.spyOn(api, 'verifySandboxCitationsInstant').mockResolvedValue({
      elapsed_seconds: 0.42,
      total: 2,
      summary: {
        verified: 0,
        metadata_error: 0,
        suspected_hallucination: 0,
        resource: 2,
        layer1_linking_issues: 0,
      },
      results: [
        {
          index: 1,
          citation_raw:
            "Sieczkowski, C (2014) Feminist activist says Beyoncé is partly 'anti-feminist'. The Huffington Post. http://www.huffingtonpost.com/article",
          label: 'resource',
          confidence: 0.92,
          mapping_status: 'matched',
          mapping_note: '',
          reasoning: 'Wayback snapshot recovered.',
          triggered_rules: ['R-URL-RESOURCE'],
          mismatched_fields: [],
          url_status: 'unchecked',
          url_status_code: 406,
          archive_url: 'https://web.archive.org/web/20140511/http://www.huffingtonpost.com/article',
          html_meta: {
            citation_title: "Feminist Activist Says Beyonce Is Partly 'Anti-Feminist'",
            citation_authors: ['Cavan Sieczkowski'],
            published_year: 2014,
            site_name: 'HuffPost',
          },
        },
        {
          index: 2,
          citation_raw: 'Quốc hội (2012). Luật Giáo dục đại học số 08/2012/QH13.',
          label: 'resource',
          confidence: 0.98,
          mapping_status: 'matched',
          mapping_note: '',
          reasoning: 'Verified legal statute.',
          triggered_rules: ['R-VN-LEGAL-VERIFIED'],
          mismatched_fields: [],
          matched_sources: [
            {
              source: 'vn_legal_registry',
              matched_fields: ['title', 'year'],
              checked_at: '2026-11-14T00:00:00Z',
              title: 'Luật Giáo dục đại học số 08/2012/QH13',
              authors: ['Quốc hội'],
              year: '2012',
              confidence: 0.98,
            },
          ],
        },
      ],
    });

    const { container: sbContainer, unmount: unmountSb } = renderWithProviders(
      <LiveCitationSandbox lang="en" />,
      { user: makeUser('teacher', 'pro') },
    );
    fireEvent.click(screen.getByTestId('sandbox-mode-raw-btn'));
    const rawTextarea = sbContainer.querySelector('textarea') as HTMLTextAreaElement;
    fireEvent.change(rawTextarea, {
      target: { value: 'Sieczkowski (2014) http://www.huffingtonpost.com/article' },
    });
    const submitBtn = await screen.findByTestId('sandbox-verify-submit-btn');
    await waitFor(() => expect((submitBtn as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(submitBtn);

    await waitFor(() =>
      expect(screen.getByTestId('sandbox-result-card-1')).toBeDefined(),
    );
    expect(sbContainer.textContent).not.toContain('FAKE URL');
    expect(sbContainer.textContent).toContain('WAYBACK ARCHIVED');
    expect(sbContainer.textContent).toContain('URL Resource: 1');
    expect(sbContainer.textContent).toContain('Legal Statute: 1');
    expect(sbContainer.textContent).toContain('· Vietnamese Legal Registry');
    expect(sbContainer.textContent).not.toContain('· the Vietnamese Legal Registry');
    unmountSb();

    // 2. EssayPage: DOCX OpenXML badge + curated TCVN primary source scoping + no 0.00 scholarly sim on Web Resource
    const docxReport = makeReport({
      essay_id: 210,
      filename: 'thesis_submission.docx',
      document_diagnostics: {
        is_scanned_pdf: false,
        scanned_pages_count: 0,
        total_extractable_chars: 1850,
        avg_chars_per_page: 1850,
        parser_used: 'docx',
      },
      verdicts: [
        makeVerdict({
          citation_id: 'v1',
          numeric_index: 1,
          citation_raw: '[1] Bộ KH&CN (2018). TCVN 5574:2018 Kết cấu bê tông.',
          label: 'verified',
          triggered_rules: ['R-VN-STANDARD-VERIFIED'],
          matched_sources: [
            {
              source: 'tech_standard',
              matched_fields: ['title', 'year'],
              checked_at: '2026-11-14T00:00:00Z',
              title: 'TCVN 5574:2018 Kết cấu bê tông',
              year: '2018',
              confidence: 0.96,
              external_ids: { vn_standard_code: 'TCVN 5574:2018' },
            },
            {
              source: 'openalex',
              matched_fields: ['doi'],
              checked_at: '2026-11-14T00:00:00Z',
              title: 'Unrelated Secondary Hit',
              doi: '10.1234/unrelated',
              confidence: 0.35,
            },
          ],
        }),
        makeVerdict({
          citation_id: 'v2',
          numeric_index: 8,
          sub_index: 'a',
          composite_label: '8a',
          citation_raw: '[8] (a) Hochreiter, S., & Schmidhuber, J. (1997). Long short-term memory.',
          context:
            'Recurrent sequence modeling foundations were established in seminal research [8a].',
          label: 'resource',
          triggered_rules: ['R-URL-RESOURCE'],
          url_status: 'unchecked',
          archive_url: 'https://web.archive.org/web/2020/https://example.org/lstm',
          html_meta: {
            citation_title: 'Long Short-Term Memory Web Entry',
            site_name: 'Neural Archive',
          },
          features: {
            has_scholarly_candidate: false,
            title_sim_fuzzy: 0,
            author_jaccard: 0,
            html_meta_title_sim: 1.0,
          },
        }),
      ],
    });
    vi.spyOn(api, 'getEssay').mockResolvedValue(docxReport);

    const { container: essayDocxContainer, unmount: unmountEssayDocx } =
      renderWithProviders(
        <Routes>
          <Route path="/verification/report/:id" element={<EssayPage />} />
        </Routes>,
        {
          user: makeUser('teacher', 'pro'),
          initialRoute: '/verification/report/210?citation=v1',
        },
      );
    await waitFor(() =>
      expect(essayDocxContainer.textContent).toContain('WORD DOCX · OPENXML'),
    );
    expect(essayDocxContainer.textContent).not.toContain(
      'VN National Standards (TCVN / QCVN) and OpenAlex',
    );
    expect(essayDocxContainer.textContent).toContain(
      'Verified fields (title, publication year)',
    );

    // Click [8a] and verify no "title similarity = 0.00" & [8a] highlighted
    const btn8a = Array.from(
      essayDocxContainer.querySelectorAll<HTMLElement>('[data-citation-id]'),
    ).find((el) => el.dataset.citationId === 'v2');
    expect(btn8a).toBeDefined();
    fireEvent.click(btn8a!);
    await waitFor(() =>
      expect(essayDocxContainer.textContent).toContain('HTML page title similarity = 1.00'),
    );
    expect(essayDocxContainer.textContent).not.toContain('title similarity = 0.00');
    unmountEssayDocx();

    // 3. DocumentInspectorPage highlights [8a] inside <mark>, shows document_inspector.docx, and never shows FAKE URL on Wayback-rescued unchecked URLs
    const { container: inspContainer, unmount: unmountInsp } = renderWithProviders(
      <Routes>
        <Route path="/verification/inspector/:id" element={<DocumentInspectorPage />} />
      </Routes>,
      {
        user: makeUser('teacher', 'pro'),
        initialRoute: '/verification/inspector/210',
      },
    );
    await waitFor(() =>
      expect(inspContainer.textContent).toContain('document_inspector.docx'),
    );
    const marks = Array.from(inspContainer.querySelectorAll('mark')).map(
      (m) => m.textContent,
    );
    expect(marks).toContain('[8a]');
    expect(inspContainer.textContent).not.toContain('FAKE URL');
    unmountInsp();

    // 4. LogicTracePage shows WAYBACK ARCHIVED (never FAKE URL) and strips duplicate [1] prefix
    const { container: traceContainer } = renderWithProviders(
      <Routes>
        <Route path="/verification/trace/:id" element={<LogicTracePage />} />
      </Routes>,
      {
        user: makeUser('teacher', 'pro'),
        initialRoute: '/verification/trace/210',
      },
    );
    await waitFor(() =>
      expect(traceContainer.textContent).toContain('WAYBACK ARCHIVED'),
    );
    expect(traceContainer.textContent).not.toContain('FAKE URL');
    expect(traceContainer.textContent).not.toContain('[1][1]');
    expect(traceContainer.textContent).not.toContain('[1] [1]');
  });
});
