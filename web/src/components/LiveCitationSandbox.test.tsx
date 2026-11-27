import { describe, it, expect, vi, beforeEach } from 'vitest';
import { api, type SandboxInstantVerifyResponse } from '@/api/client';
import i18n from '@/i18n';
import { renderWithProviders, screen, fireEvent, waitFor } from '@/test-utils';
import { LiveCitationSandbox } from './LiveCitationSandbox';

const sampleResponse = {
  count: 2,
  style: 'apa',
  database_total_papers: 128626,
  items: [
    {
      index: 1,
      paper_id: 101,
      title: 'Attention Is All You Need',
      authors: ['Ashish Vaswani', 'Noam Shazeer'],
      authors_text: 'Ashish Vaswani; Noam Shazeer',
      year: '2017',
      venue: 'NeurIPS',
      doi: '10.48550/arXiv.1706.03762',
      cite_in_text: true,
      include_in_references: true,
      in_text_year_override: '',
      in_text_context: 'Transformer architectures dispense with recurrence',
      mutation_preset: 'clean',
      original: {
        title: 'Attention Is All You Need',
        authors_text: 'Ashish Vaswani; Noam Shazeer',
        year: '2017',
        venue: 'NeurIPS',
        doi: '10.48550/arXiv.1706.03762',
      },
    },
    {
      index: 2,
      paper_id: 102,
      title: 'BERT Pre-training of Deep Bidirectional Transformers',
      authors: ['Jacob Devlin', 'Ming-Wei Chang'],
      authors_text: 'Jacob Devlin; Ming-Wei Chang',
      year: '2019',
      venue: 'NAACL',
      doi: '10.18653/v1/N19-1423',
      cite_in_text: true,
      include_in_references: true,
      in_text_year_override: '',
      in_text_context: 'Bidirectional pretraining improves language understanding',
      mutation_preset: 'clean',
      original: {
        title: 'BERT Pre-training of Deep Bidirectional Transformers',
        authors_text: 'Jacob Devlin; Ming-Wei Chang',
        year: '2019',
        venue: 'NAACL',
        doi: '10.18653/v1/N19-1423',
      },
    },
  ],
};

describe('LiveCitationSandbox i18n, Academic Taxonomy & Quick Paste UX', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await i18n.changeLanguage('en');
  });

  it('renders clean English preset badges, buttons, selects with pr-8, and zero thesis-defense or Vietnamese copy', async () => {
    vi.spyOn(api, 'sampleSandboxAclPapers').mockResolvedValue(sampleResponse);

    renderWithProviders(<LiveCitationSandbox lang="en" />);

    // Defaults to Quick Check; switch to Sample PDF builder to verify sample controls & presets
    fireEvent.click(screen.getByTestId('sandbox-mode-acl-btn'));

    expect(screen.getByTestId('sandbox-acl-count-select').className).toContain('pr-8');
    expect(screen.getByTestId('sandbox-acl-style-select').className).toContain('pr-8');

    fireEvent.click(screen.getByTestId('sandbox-random-acl-btn'));
    await waitFor(() => {
      expect(screen.getByTestId('sandbox-paper-card-0')).toBeDefined();
    });

    // Cycle presets on card 0 and verify non-accusatory, plain-language English labels
    expect(screen.getAllByText('Original Record').length).toBeGreaterThan(0);
    expect(screen.queryByText('Canonical ACL')).toBeNull();
    fireEvent.click(screen.getByTestId('sandbox-preset-wrong-year-0'));
    expect(screen.getAllByText('Wrong Year').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByTestId('sandbox-preset-wrong-author-0'));
    expect(screen.getAllByText('Wrong Author').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByTestId('sandbox-preset-hallucinated-0'));
    expect(screen.getByText('Source Not Found')).toBeDefined();

    fireEvent.click(screen.getByTestId('sandbox-preset-intext-mismatch-0'));
    expect(screen.getByText('In-text Year Mismatch')).toBeDefined();

    const text = document.body.textContent ?? '';
    expect(text).toContain('Add Common Citation Mistakes');
    expect(text).toContain('Cited in Body Text');
    expect(text).toContain('Included in Bibliography');

    // Scrubbed defense-demo copy & zero Vietnamese leaks
    expect(text).not.toContain('Defense Error Suite');
    expect(text).not.toContain('🚨');
    expect(text).not.toContain('Bản gốc ACL');
    expect(text).not.toContain('Sai năm xuất bản');
    expect(text).not.toContain('Có trích dẫn trong bài viết');
  });

  it('renders clean Vietnamese student/teacher copy with zero thesis-defense jargon when lang="vi"', async () => {
    await i18n.changeLanguage('vi');
    vi.spyOn(api, 'sampleSandboxAclPapers').mockResolvedValue(sampleResponse);

    renderWithProviders(<LiveCitationSandbox lang="vi" />);

    // Defaults to Quick Check (Kiểm tra nhanh) before switching to Sample PDF builder
    expect(document.body.textContent ?? '').toContain('Kiểm tra trích dẫn ngay');
    fireEvent.click(screen.getByTestId('sandbox-mode-acl-btn'));

    const builderText = document.body.textContent ?? '';
    expect(builderText).toContain('Lấy ngẫu nhiên 12 bài báo');
    expect(builderText).not.toContain('Random 12 Bài báo');
    expect(builderText).not.toContain('ngay trước mặt thầy cô');

    fireEvent.click(screen.getByTestId('sandbox-random-acl-btn'));
    await waitFor(() => {
      expect(screen.getByTestId('sandbox-paper-card-0')).toBeDefined();
    });

    const text = document.body.textContent ?? '';
    expect(text).toContain('Tạo nhanh bài mẫu có lỗi phổ biến');
    expect(text).toContain('Thư viện học thuật');
    expect(text).not.toContain('Bản gốc ACL');
    expect(text).toContain('Có trích dẫn trong bài viết');
    expect(text).toContain('Có trong Danh mục tham khảo');
    expect(text).not.toContain('Hội Đồng');
    expect(text).not.toContain('nếu muốn test lệch năm');
    expect(text).not.toContain('🚨');
  });

  it('uses explicit light and dark theme classes on the studio header and mode switcher instead of dark-only styling', () => {
    renderWithProviders(<LiveCitationSandbox lang="en" />);

    const header = screen.getByTestId('sandbox-studio-header');
    expect(header.className).toContain('from-slate-50');
    expect(header.className).toContain('text-slate-900');
    expect(header.className).toContain('dark:from-slate-950');
    expect(header.className).toContain('dark:text-slate-50');
    expect(header.className).not.toContain('to-violet-950');

    // Quick Check is active by default; Sample PDF tab carries inactive light/dark classes
    const rawBtn = screen.getByTestId('sandbox-mode-raw-btn');
    expect(rawBtn.getAttribute('aria-pressed')).toBe('true');
    expect(rawBtn.className).toContain('bg-indigo-600');
    expect(rawBtn.className).toContain('text-white');

    const aclBtn = screen.getByTestId('sandbox-mode-acl-btn');
    expect(aclBtn.getAttribute('aria-pressed')).toBe('false');
    expect(aclBtn.className).toContain('text-slate-600');
    expect(aclBtn.className).toContain('dark:text-slate-300');
  });

  it('Quick Paste updates subtitle, hides raw rule IDs behind collapsible toggle, uses Unified Taxonomy + DecisionSupportBanner, formats < 0.1s, suppresses not_applicable Layer-1, fixes dark BibTeX icon, and marks/clears stale results on edit/empty', async () => {
    const verifyResponse: SandboxInstantVerifyResponse = {
      elapsed_seconds: 0.04,
      total: 2,
      summary: {
        verified: 1,
        metadata_error: 0,
        suspected_hallucination: 1,
        layer1_linking_issues: 0,
      },
      results: [
        {
          index: 1,
          citation_raw: 'Vaswani et al. (2017). Attention Is All You Need.',
          label: 'verified',
          confidence: 0.99,
          mapping_status: 'not_applicable',
          mapping_note: '',
          reasoning: 'Matched in Crossref.',
          reasoning_en: 'Exact match confirmed in Crossref.',
          reasoning_vi: 'Khớp chính xác với bản ghi trên Crossref.',
          triggered_rules: ['R-DOI-TITLE-AUTHOR'],
          mismatched_fields: [],
        },
        {
          index: 2,
          citation_raw: 'Smith (2024). Imaginary Paper. https://doi.org/10.9999/fake',
          label: 'suspected_hallucination',
          confidence: 0.12,
          mapping_status: 'not_applicable',
          mapping_note: '',
          reasoning: 'Fallback reasoning',
          reasoning_en: 'DOI prefix 10.9999 is reserved/invalid and no scholarly record was found.',
          reasoning_vi: 'Tiền tố DOI 10.9999 không hợp lệ và không tìm thấy công trình trên 15+ thư viện.',
          triggered_rules: ['R-FABRICATED-DOI', 'R-NO-CANDIDATE'],
          mismatched_fields: [],
        },
      ],
      remediation: {
        essay_id: 0,
        style: 'apa',
        total_entries: 1,
        remediated_count: 1,
        entries: [],
        combined_text: '',
        combined_bibtex: '@inproceedings{vaswani2017attention, title={Attention Is All You Need}}',
        combined_ris: '',
      },
    };

    vi.spyOn(api, 'verifySandboxCitationsInstant').mockResolvedValue(verifyResponse);

    const { unmount } = renderWithProviders(<LiveCitationSandbox lang="vi" />);
    fireEvent.click(screen.getByTestId('sandbox-mode-raw-btn'));

    // Subtitle switches to Quick Paste description
    expect(screen.getByTestId('sandbox-studio-subtitle').textContent).toContain(
      'Dán trực tiếp danh sách tài liệu tham khảo',
    );

    fireEvent.click(screen.getByTestId('sandbox-verify-submit-btn'));
    await waitFor(() => {
      expect(screen.getByTestId('sandbox-instant-results')).toBeDefined();
    });

    const resultsEl = screen.getByTestId('sandbox-instant-results');
    // Elapsed < 0.1s instead of ⚡ 0s
    expect(screen.getByTestId('sandbox-elapsed-badge').textContent).toBe('< 0.1s');
    // Unified Academic Taxonomy pills (no 🚨 Hallucination / Nghi bịa đặt)
    expect(resultsEl.textContent).toContain('Đã xác minh');
    expect(resultsEl.textContent).toContain('Không tìm thấy nguồn');
    expect(resultsEl.textContent).not.toContain('Nghi bịa đặt');
    expect(resultsEl.textContent).not.toContain('🚨');
    // DecisionSupportBanner present
    expect(screen.getByTestId('decision-support-banner')).toBeDefined();
    // Layer-1 not_applicable hidden cleanly
    expect(screen.queryByTestId('sandbox-summary-layer1')).toBeNull();
    expect(screen.queryByTestId('sandbox-layer1-badge-1')).toBeNull();
    // Preserves backend reasoning_vi
    expect(resultsEl.textContent).toContain('Tiền tố DOI 10.9999 không hợp lệ');
    // Raw rule IDs are never exposed even inside collapsible "Chi tiết kỹ thuật" (plain human descriptions shown instead)
    expect(resultsEl.textContent).not.toContain('R-FABRICATED-DOI');
    fireEvent.click(screen.getByTestId('sandbox-tech-toggle-2'));
    expect(screen.getByTestId('sandbox-tech-panel-2').textContent).not.toContain('R-FABRICATED-DOI');
    expect(screen.getByTestId('sandbox-tech-panel-2').textContent).toContain('Mã DOI');
    // Dark mode contrast on Copy BibTeX button & icon
    const copyBtn = screen.getByTestId('sandbox-copy-bibtex-btn');
    expect(copyBtn.className).toContain('dark:text-[#FBFAF6]');
    expect(copyBtn.innerHTML).toContain('dark:text-[#FBFAF6]');

    // Editing textarea marks results stale (dimmed + banner)
    const textarea = screen.getByTestId('sandbox-raw-textarea');
    fireEvent.change(textarea, { target: { value: 'Another reference (2025).' } });
    expect(screen.getByTestId('sandbox-stale-banner')).toBeDefined();
    expect(screen.getByTestId('sandbox-instant-results').getAttribute('data-stale')).toBe('true');

    // Emptying textarea immediately clears stale results & displays inline hint
    fireEvent.change(textarea, { target: { value: '   ' } });
    expect(screen.queryByTestId('sandbox-instant-results')).toBeNull();
    expect(screen.getByTestId('sandbox-raw-empty-hint')).toBeDefined();

    unmount();

    // EN mode uses reasoning_en (no VI leak)
    renderWithProviders(<LiveCitationSandbox lang="en" />);
    fireEvent.click(screen.getByTestId('sandbox-mode-raw-btn'));
    fireEvent.click(screen.getByTestId('sandbox-verify-submit-btn'));
    await waitFor(() => {
      expect(screen.getByTestId('sandbox-instant-results')).toBeDefined();
    });
    expect(screen.getByTestId('sandbox-instant-results').textContent).toContain(
      'DOI prefix 10.9999 is reserved/invalid',
    );
    expect(screen.getByTestId('sandbox-instant-results').textContent).not.toContain(
      'Tiền tố DOI 10.9999',
    );
  });

  it('handles is_invalid_input cleanly by showing invalid-citation card and hiding Copy BibTeX', async () => {
    vi.spyOn(api, 'verifySandboxCitationsInstant').mockResolvedValue({
      elapsed_seconds: 0.02,
      total: 1,
      summary: {
        verified: 0,
        metadata_error: 0,
        suspected_hallucination: 0,
        unresolved: 1,
        layer1_linking_issues: 0,
      },
      results: [
        {
          index: 1,
          citation_raw: 'hello world random text',
          label: 'unresolved',
          confidence: 0,
          mapping_status: 'not_applicable',
          mapping_note: '',
          reasoning: 'Input does not appear to be a valid bibliographic citation.',
          reasoning_en: 'Input does not appear to be a valid bibliographic citation.',
          reasoning_vi: 'Văn bản nhập vào không giống một trích dẫn học thuật hợp lệ.',
          is_invalid_input: true,
          triggered_rules: ['R-INCOMPLETE-METADATA'],
          mismatched_fields: [],
        },
      ],
      remediation: {
        essay_id: 0,
        style: 'apa',
        total_entries: 0,
        remediated_count: 0,
        entries: [],
        combined_text: '',
        combined_bibtex: '@misc{invalid}',
        combined_ris: '',
      },
    });

    renderWithProviders(<LiveCitationSandbox lang="en" />);
    fireEvent.click(screen.getByTestId('sandbox-mode-raw-btn'));
    fireEvent.change(screen.getByTestId('sandbox-raw-textarea'), {
      target: { value: 'hello world random text' },
    });
    fireEvent.click(screen.getByTestId('sandbox-verify-submit-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('sandbox-instant-results')).toBeDefined();
    });

    expect(screen.getByTestId('sandbox-result-card-1').textContent).toContain(
      'Input does not look like a citation',
    );
    expect(screen.queryByTestId('sandbox-copy-bibtex-btn')).toBeNull();
    expect(screen.queryByTestId('sandbox-summary-layer1')).toBeNull();
  });

  it('shows explicit Checking... button state and loading skeleton while clearing prior results on resubmit', async () => {
    let resolveSecond!: (value: SandboxInstantVerifyResponse) => void;
    const secondPromise = new Promise<SandboxInstantVerifyResponse>((resolve) => {
      resolveSecond = resolve;
    });

    const spy = vi
      .spyOn(api, 'verifySandboxCitationsInstant')
      .mockResolvedValueOnce({
        elapsed_seconds: 0.2,
        total: 1,
        summary: {
          verified: 1,
          metadata_error: 0,
          suspected_hallucination: 0,
          layer1_linking_issues: 0,
        },
        results: [
          {
            index: 1,
            citation_raw: 'Vaswani et al. (2017). Attention Is All You Need.',
            label: 'verified',
            confidence: 0.99,
            mapping_status: 'not_applicable',
            mapping_note: '',
            reasoning: 'Matched.',
            reasoning_en: 'Matched.',
            triggered_rules: [],
            mismatched_fields: [],
          },
        ],
      })
      .mockReturnValueOnce(secondPromise);

    renderWithProviders(<LiveCitationSandbox lang="en" />);
    fireEvent.click(screen.getByTestId('sandbox-mode-raw-btn'));
    fireEvent.click(screen.getByTestId('sandbox-verify-submit-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('sandbox-instant-results').textContent).toContain('Verified: 1');
    });

    // Replace text and submit again -> old Verified: 1 immediately clears while skeleton & Checking... render
    fireEvent.change(screen.getByTestId('sandbox-raw-textarea'), {
      target: { value: 'Fake Author (2025). Non-Existent Study.' },
    });
    fireEvent.click(screen.getByTestId('sandbox-verify-submit-btn'));

    expect(screen.getByTestId('sandbox-verify-submit-btn').textContent).toContain('Checking...');
    expect(screen.getByTestId('sandbox-verifying-skeleton')).toBeDefined();
    expect(screen.queryByTestId('sandbox-instant-results')).toBeNull();

    resolveSecond({
      elapsed_seconds: 0.3,
      total: 1,
      summary: {
        verified: 0,
        metadata_error: 0,
        suspected_hallucination: 1,
        layer1_linking_issues: 0,
      },
      results: [
        {
          index: 1,
          citation_raw: 'Fake Author (2025). Non-Existent Study.',
          label: 'suspected_hallucination',
          confidence: 0.1,
          mapping_status: 'not_applicable',
          mapping_note: '',
          reasoning: 'No match found.',
          reasoning_en: 'No matching publication found across libraries.',
          triggered_rules: ['R-NO-CANDIDATE'],
          mismatched_fields: [],
        },
      ],
    });

    await waitFor(() => {
      expect(screen.getByTestId('sandbox-instant-results').textContent).toContain(
        'Source Not Found: 1',
      );
    });
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('Round 2 [P2-03] — keeps compact mobile-safe mode tab labels without ACL jargon and keeps corpus count steady without jumping', async () => {
    vi.spyOn(api, 'sampleSandboxAclPapers').mockResolvedValue({
      database_total_papers: 129157,
      count: 1,
      style: 'apa',
      items: [
        {
          index: 1,
          paper_id: 101,
          title: 'Compact Tab Verification Study',
          authors: ['Nguyen, A.'],
          authors_text: 'Nguyen, A.',
          year: '2024',
          venue: 'ACL',
          doi: '10.18653/v1/2024.acl-long.1',
          abstract: 'Sample abstract.',
          source: 'ACL Anthology',
          cite_in_text: true,
          include_in_references: true,
          in_text_year_override: '',
          in_text_context: 'Prior research verified this method.',
        },
      ],
    });

    // VI mode
    const { unmount: unmountVi } = renderWithProviders(<LiveCitationSandbox lang="vi" />);
    const aclTabVi = screen.getByTestId('sandbox-mode-acl-btn');
    const rawTabVi = screen.getByTestId('sandbox-mode-raw-btn');
    expect(aclTabVi.textContent?.trim()).toBe('Tạo bài mẫu PDF');
    expect(rawTabVi.textContent?.trim()).toBe('Kiểm tra nhanh');
    expect(aclTabVi.textContent).not.toContain('ACL');
    expect(aclTabVi.className).toContain('min-w-0');
    expect(aclTabVi.className).toContain('truncate');
    expect(rawTabVi.className).toContain('min-w-0');
    expect(rawTabVi.className).toContain('truncate');

    const corpusBadgeVi = screen.getByTestId('sandbox-corpus-badge');
    // Default Quick Check mode displays 15+ libraries badge
    expect(corpusBadgeVi.textContent).toContain('15+ thư viện học thuật');

    // Switch to Sample PDF mode -> displays steady 128.000+ badge that never jumps on sample response
    fireEvent.click(aclTabVi);
    expect(corpusBadgeVi.textContent).toContain('128.000+ bài báo học thuật');
    expect(corpusBadgeVi.textContent).not.toContain('128,626');

    fireEvent.click(screen.getByTestId('sandbox-random-acl-btn'));
    await waitFor(() => {
      expect(screen.getByDisplayValue('Compact Tab Verification Study')).toBeDefined();
    });
    // Must stay steady and never jump to 129,157
    expect(corpusBadgeVi.textContent).toContain('128.000+ bài báo học thuật');
    expect(corpusBadgeVi.textContent).not.toContain('129,157');
    expect(corpusBadgeVi.textContent).not.toContain('129.157');
    unmountVi();

    // EN mode
    const { unmount: unmountEn } = renderWithProviders(<LiveCitationSandbox lang="en" />);
    expect(screen.getByTestId('sandbox-mode-acl-btn').textContent?.trim()).toBe('Sample PDF');
    expect(screen.getByTestId('sandbox-mode-raw-btn').textContent?.trim()).toBe('Quick Check');
    expect(screen.getByTestId('sandbox-corpus-badge').textContent).toContain(
      '15+ academic libraries',
    );
    fireEvent.click(screen.getByTestId('sandbox-mode-acl-btn'));
    expect(screen.getByTestId('sandbox-corpus-badge').textContent).toContain(
      '128K+ scholarly papers',
    );
    unmountEn();
  });
});
