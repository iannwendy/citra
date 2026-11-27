import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import i18n from '@/i18n';
import { api } from '@/api/client';
import type {
  Class,
  ClassAnalytics,
  ClassEssay,
  PendingVerdict,
  RemediatedBibliographyResponse,
  SandboxInstantVerifyResponse,
  User,
  Verdict,
} from '@/api/client';
import { AuthContext } from '@/contexts/AuthContext';
import { ToastProvider } from '@/contexts/ToastContext';
import { ClassDetailPage } from '@/pages/ClassDetailPage';
import { MyClassesPage } from '@/pages/MyClassesPage';
import { PendingReviewsPage } from '@/pages/PendingReviewsPage';
import { BibliographyRemediationModal } from '@/components/BibliographyRemediationModal';
import { EssayHeader } from '@/pages/essay/EssayHeader';
import { EssayActionBar } from '@/pages/essay/EssayActionBar';
import { OverrideControls } from '@/components/OverrideControls';
import { LiveCitationSandbox } from '@/components/LiveCitationSandbox';
import { HelpModal } from '@/components/HelpModal';
import { RULE_DEFINITIONS, RuleInspector } from '@/components/RuleInspector';

function makeQuota(overrides: Partial<NonNullable<User['quota']>> = {}): NonNullable<User['quota']> {
  return {
    monthly_uploads_used: 2,
    monthly_uploads_limit: 50,
    monthly_uploads_remaining: 48,
    max_file_size_mb: 50,
    max_pages_per_pdf: 150,
    max_citations_per_essay: 250,
    max_batch_files: 20,
    allow_batch_upload: true,
    allow_deep_inspector: true,
    allow_serpapi_fallback: true,
    allowed_export_formats: ['json', 'csv', 'pdf', 'docx'],
    quota_reset_at: '2026-12-01T00:00:00Z',
    ...overrides,
  };
}

function makeAuthUser(overrides: Partial<User> = {}): User {
  return {
    id: 10,
    username: 'prof_tran',
    email: 'tran@tdtu.edu.vn',
    full_name: null,
    institution: null,
    avatar_url: null,
    last_login_at: null,
    created_at: '2026-10-01T00:00:00Z',
    role: 'teacher',
    plan_tier: 'pro',
    is_active: true,
    can_override_verdicts: true,
    quota: overrides.quota !== undefined ? overrides.quota : makeQuota(),
    ...overrides,
  };
}

function makeClass(overrides: Partial<Class> = {}): Class {
  return {
    id: 1,
    name: 'CS401 Capstone Cohort',
    description: null,
    teacher_id: 10,
    teacher_username: 'prof_tran',
    student_count: 1,
    essay_count: 1,
    created_at: '2026-10-01T00:00:00Z',
    ...overrides,
  };
}

function renderWithAuth(
  ui: React.ReactElement,
  options?: {
    route?: string;
    user?: User | null;
    refreshUser?: () => Promise<void>;
  },
) {
  const resolvedUser = options?.user !== undefined ? options.user : makeAuthUser();
  const authValue = {
    user: resolvedUser,
    token: 'mock-jwt-token',
    isLoading: false,
    isAdmin: resolvedUser?.role === 'admin',
    login: vi.fn().mockResolvedValue(undefined),
    logout: vi.fn().mockResolvedValue(undefined),
    refreshUser: options?.refreshUser ?? vi.fn().mockResolvedValue(undefined),
  };

  return render(
    <MemoryRouter initialEntries={[options?.route ?? '/']}>
      <AuthContext.Provider value={authValue}>
        <ToastProvider>{ui}</ToastProvider>
      </AuthContext.Provider>
    </MemoryRouter>,
  );
}

describe('v3.70.0 Classroom, Pending Reviews, Sandbox, Modals & RuleInspector', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await i18n.changeLanguage('en');
  });

  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('ClassDetailPage renders verdict_breakdown, job_status smart links, Credit Refunded pill, and clickable shared_hallucinations essay_ids', async () => {
    vi.spyOn(api, 'listMyClasses').mockResolvedValue([
      makeClass({
        id: 5,
        name: 'CS401 Capstone Cohort',
        description: 'TDTU Thesis Cohort',
        join_code: 'TDTU26',
        student_count: 1,
        essay_count: 3,
      }),
    ]);
    vi.spyOn(api, 'listClassStudents').mockResolvedValue([
      {
        id: 21,
        username: 'sv_nguyen',
        email: 'nguyen@student.tdtu.edu.vn',
        full_name: 'Nguyen Van A',
        is_active: true,
      },
    ]);

    const mockEssays: ClassEssay[] = [
      {
        id: 101,
        filename: 'Completed_Thesis.docx',
        num_pages: 42,
        user_id: 21,
        username: 'sv_nguyen',
        uploaded_at: '2026-11-10T08:00:00Z',
        job_status: 'completed',
        cis_score: 91.4,
        quota_charged: true,
      },
      {
        id: 102,
        filename: 'Queued_Draft.pdf',
        num_pages: 18,
        user_id: 21,
        username: 'sv_nguyen',
        uploaded_at: '2026-11-11T08:00:00Z',
        job_status: 'queued',
        quota_charged: true,
      },
      {
        id: 103,
        filename: 'Corrupted_Scan.pdf',
        num_pages: 5,
        user_id: 21,
        username: 'sv_nguyen',
        uploaded_at: '2026-11-12T08:00:00Z',
        job_status: 'failed',
        job_error: 'GROBID timeout while parsing PDF stream',
        quota_charged: false,
      },
    ];
    vi.spyOn(api, 'listClassEssays').mockResolvedValue(mockEssays);

    const mockAnalytics: ClassAnalytics = {
      class_id: 5,
      class_name: 'CS401 Capstone Cohort',
      total_students: 1,
      total_essays: 3,
      queued_essays: 1,
      failed_essays: 1,
      avg_cis: 88.5,
      recency_5yr_ratio: 72.0,
      cis_distribution: { excellent: 1, good: 0, fair: 0, poor: 0 },
      verdict_breakdown: {
        verified: 15,
        metadata_error: 3,
        incomplete_metadata: 2,
        suspected_hallucination: 1,
        unresolved: 2,
        resource: 2,
      },
      top_triggered_rules: [
        { rule_id: 'R-INCOMPLETE-METADATA', count: 2 },
        { rule_id: 'R-DOI-CONFLICT', count: 1 },
      ],
      shared_hallucinations: [
        {
          citation_raw: 'Sterling, J. (2025). Imaginary Hyper-Graphs. Fake AI Journal.',
          label: 'suspected_hallucination',
          occurrence_count: 2,
          student_count: 2,
          students: ['sv_nguyen', 'sv_le'],
          essay_ids: [101, 104],
          is_shared: true,
        },
      ],
    };
    vi.spyOn(api, 'getClassAnalytics').mockResolvedValue(mockAnalytics);

    renderWithAuth(
      <Routes>
        <Route path="/teacher/classes/:classId" element={<ClassDetailPage />} />
      </Routes>,
      { route: '/teacher/classes/5' },
    );

    expect(await screen.findByTestId('cohort-verdict-breakdown')).toBeTruthy();
    expect(
      screen.getByTestId('verdict-breakdown-pill-incomplete_metadata').textContent,
    ).toMatch(/Incomplete Reference:\s*2/);
    expect(
      screen.getByTestId('verdict-breakdown-pill-unresolved').textContent,
    ).toMatch(/Unresolved:\s*2/);
    expect(screen.getByTestId('cohort-queued-essays-pill').textContent).toContain(
      '1 queued',
    );
    expect(screen.getByTestId('cohort-failed-essays-pill').textContent).toContain(
      '1 failed',
    );
    expect(screen.getByText(/Incomplete Bibliographic Reference/i)).toBeTruthy();

    // Shared hallucination clickable essay chip links
    const sharedChip = screen.getByTestId('shared-hallucination-essay-link-101');
    expect(sharedChip.getAttribute('href')).toBe('/verification/report/101');
    expect(
      screen.getByTestId('shared-hallucination-essay-link-104').getAttribute('href'),
    ).toBe('/verification/report/104');

    // Header action row allows wrapping within narrow mobile cards (no shrink-0 overflow)
    const editClassBtn = screen.getByTestId('edit-class-btn');
    expect(editClassBtn.parentElement?.className).toContain('min-w-0');
    expect(editClassBtn.parentElement?.className).toContain('max-w-full');
    expect(editClassBtn.parentElement?.className).not.toContain('shrink-0');

    // Smart routing for ClassEssay rows
    const completedRow = screen.getByTestId('class-essay-row-101');
    expect(completedRow.getAttribute('href')).toBe('/verification/report/101');
    expect(within(completedRow).getByText('CIS 91.4 / 100')).toBeTruthy();

    const queuedRow = screen.getByTestId('class-essay-row-102');
    expect(queuedRow.getAttribute('href')).toBe('/verification/processing/102');
    expect(within(queuedRow).getByText('View Progress')).toBeTruthy();

    const failedRow = screen.getByTestId('class-essay-row-103');
    expect(failedRow.getAttribute('href')).toBe('/verification/processing/103');
    expect(within(failedRow).getByText('Credit Refunded')).toBeTruthy();
    expect(failedRow.getAttribute('title')).toBe(
      'GROBID timeout while parsing PDF stream',
    );
  });

  it('MyClassesPage links Needs Review KPI card to /teacher/reviews when pending_reviews > 0', async () => {
    const cls = makeClass({
      id: 1,
      name: 'AI Ethics',
      student_count: 24,
      essay_count: 19,
    });
    vi.spyOn(api, 'listMyClasses').mockResolvedValue([cls]);
    vi.spyOn(api, 'getTeacherDashboard').mockResolvedValue({
      total_classes: 1,
      total_students: 24,
      total_essays: 19,
      pending_reviews: 4,
      classes: [cls],
    });

    renderWithAuth(<MyClassesPage />, { route: '/teacher/classes' });

    const link = await screen.findByTestId('needs-review-kpi-link');
    expect(link.getAttribute('href')).toBe('/teacher/reviews');
    expect(within(link).getByText('4')).toBeTruthy();
  });

  it('PendingReviewsPage renders [14a] composite marker, Incomplete Reference badge, observed html_meta title, RETRACTED badge, and VI explanation', async () => {
    vi.spyOn(api, 'listMyClasses').mockResolvedValue([
      makeClass({ id: 8, name: 'NLP Seminar' }),
    ]);

    const pendingItems: PendingVerdict[] = [
      {
        verdict_id: 501,
        essay_id: 77,
        filename: 'MultiRef.docx',
        student_username: 'sv_an',
        citation_raw: 'Nguyen, H. Deep Learning Notes.',
        label: 'metadata_error',
        confidence: 0.78,
        reasoning: 'Missing publication year and venue.',
        validated_at: '2026-11-12T10:00:00Z',
        composite_label: '14a',
        numeric_index: 14,
        sub_index: 'a',
        triggered_rules: ['R-INCOMPLETE-METADATA'],
        mismatched_fields: ['year', 'venue'],
      },
      {
        verdict_id: 502,
        essay_id: 78,
        filename: 'WebRef.pdf',
        student_username: 'sv_binh',
        citation_raw:
          'World Health Organization (2024). AI Governance Report. https://example.org/wrong-page',
        label: 'metadata_error',
        confidence: 0.82,
        reasoning: 'URL content mismatch.',
        validated_at: '2026-11-12T10:05:00Z',
        triggered_rules: ['R-URL-CONTENT-MISMATCH', 'R-RETRACTED-PAPER'],
        is_retracted: true,
        url_status: 'archived_alive',
        url_status_code: 200,
        archive_url:
          'https://web.archive.org/web/20250101/https://example.org/wrong-page',
        html_meta: {
          page_title: 'Unrelated Cooking Blog Homepage',
          site_name: 'Example Kitchen',
        },
        matched_sources: [
          {
            source: 'crossref',
            title: 'AI Governance Report',
            authors: ['WHO'],
            year: '2024',
            matched_fields: ['title'],
            checked_at: '2026-11-12T10:05:00Z',
          },
        ],
      },
    ];
    vi.spyOn(api, 'listPendingReviews').mockResolvedValue(pendingItems);

    const { unmount } = renderWithAuth(<PendingReviewsPage />, {
      route: '/teacher/reviews',
    });

    expect((await screen.findByTestId('pending-marker-501')).textContent).toContain(
      '[14a]',
    );
    expect(screen.getByTestId('pending-kpi-incomplete').textContent).toContain('1');
    expect(
      within(screen.getByTestId('pending-review-row-501')).getByText(
        'Incomplete Reference',
      ),
    ).toBeTruthy();
    expect(screen.getByTestId('pending-observed-meta-502').textContent).toContain(
      'Unrelated Cooking Blog Homepage',
    );
    expect(screen.getByTestId('pending-retracted-502').textContent).toContain(
      'RETRACTED',
    );
    expect(
      within(screen.getByTestId('pending-url-status-502'))
        .getByRole('link', { name: /Wayback Archived/i })
        .getAttribute('href'),
    ).toBe('https://web.archive.org/web/20250101/https://example.org/wrong-page');

    unmount();

    // Switch to Vietnamese and verify localized explanation & badge
    await i18n.changeLanguage('vi');
    renderWithAuth(<PendingReviewsPage />, { route: '/teacher/reviews' });

    expect(await screen.findByText('Thiếu quy cách trích dẫn')).toBeTruthy();
    expect(screen.getByTestId('pending-observed-meta-502').textContent).toContain(
      'Tiêu đề trang URL thực tế: "Unrelated Cooking Blog Homepage"',
    );
    expect(
      within(screen.getByTestId('pending-review-row-501')).getByText(
        /chưa đủ thông tin định danh học thuật/i,
      ),
    ).toBeTruthy();
  });

  it('BibliographyRemediationModal displays [14a], manual_review & resource badges, passes tdtu on .docx, and keeps .pdf disabled', async () => {
    const mockRemediated: RemediatedBibliographyResponse = {
      essay_id: 42,
      style: 'apa',
      total_entries: 2,
      remediated_count: 0,
      combined_text: '[14a] Nguyen, H.\n[14b] Luat Giao duc 2019.',
      combined_bibtex: '@misc{ref14a, title={Notes}}',
      combined_ris: 'TY  - GEN\nER  -',
      entries: [
        {
          index: 14,
          display_index: '14a',
          composite_label: '14a',
          verdict_id: 'v-14a',
          label: 'metadata_error',
          remediation_status: 'manual_review',
          triggered_rules: ['R-INCOMPLETE-METADATA'],
          was_modified: false,
          diff_fields: [],
          original_raw: '[14a] Nguyen, H. Deep Learning Lecture Notes.',
          remediated_text: '[14a] Nguyen, H. Deep Learning Lecture Notes.',
          apa: '[14a] Nguyen, H. Deep Learning Lecture Notes.',
          ieee: '[14a] H. Nguyen, Deep Learning Lecture Notes.',
          tdtu: '[14a] Nguyen, H. Deep Learning Lecture Notes.',
          bibtex: '',
          ris: '',
          source_used: null,
          canonical_metadata: {
            title: '',
            authors: [],
            year: '',
            venue: '',
            doi: '',
            url: '',
          },
        },
        {
          index: 15,
          display_index: '14b',
          verdict_id: 'v-14b',
          label: 'resource',
          remediation_status: 'resource',
          triggered_rules: ['R-VN-LEGAL-STATUTE-VERIFIED'],
          was_modified: false,
          diff_fields: [],
          original_raw: '[14b] Quốc hội (2019). Luật Giáo dục số 43/2019/QH14.',
          remediated_text: '[14b] Quốc hội (2019). Luật Giáo dục số 43/2019/QH14.',
          apa: '[14b] Quốc hội (2019). Luật Giáo dục số 43/2019/QH14.',
          ieee: '[14b] Quốc hội, Luật Giáo dục số 43/2019/QH14, 2019.',
          tdtu: '[14b] Quốc hội (2019). Luật Giáo dục số 43/2019/QH14.',
          bibtex: '',
          ris: '',
          source_used: 'vn_legal_registry',
          canonical_metadata: {
            title: '',
            authors: [],
            year: '',
            venue: '',
            doi: '',
            url: '',
          },
        },
      ],
    };

    vi.spyOn(api, 'getRemediatedBibliography').mockResolvedValue(mockRemediated);
    const healedSpy = vi
      .spyOn(api, 'downloadAutoHealedDocx')
      .mockResolvedValue(undefined);

    const { rerender } = renderWithAuth(
      <BibliographyRemediationModal
        open={true}
        essayId={42}
        filename="Dissertation.docx"
        lang="en"
        onClose={vi.fn()}
      />,
    );

    expect(
      (await screen.findByTestId('remediation-entry-index-14')).textContent,
    ).toBe('[14a]');
    expect(screen.getByTestId('remediation-status-manual-14').textContent).toContain(
      'Manual Completion Needed',
    );
    expect(screen.getByTestId('remediation-entry-index-15').textContent).toBe('[14b]');
    expect(
      screen.getByTestId('remediation-status-resource-15').textContent,
    ).toContain('Web / Statutory Resource');

    // Select TDTU style and click Export Auto-Healed .DOCX
    fireEvent.click(screen.getByTestId('remediate-style-tdtu'));
    await waitFor(() => {
      expect(api.getRemediatedBibliography).toHaveBeenCalledWith(42, 'tdtu');
    });
    const docxBtn = (await screen.findByTestId(
      'download-auto-healed-docx-btn',
    )) as HTMLButtonElement;
    expect(docxBtn.disabled).toBe(false);
    fireEvent.click(docxBtn);
    await waitFor(() => {
      expect(healedSpy).toHaveBeenCalledWith(42, 'tdtu', 'Dissertation.docx');
    });

    // Rerender with .pdf upload -> must remain disabled with .docx hint
    rerender(
      <MemoryRouter>
        <AuthContext.Provider
          value={{
            user: makeAuthUser(),
            token: 'mock-jwt-token',
            isLoading: false,
            isAdmin: false,
            login: vi.fn().mockResolvedValue(undefined),
            logout: vi.fn().mockResolvedValue(undefined),
            refreshUser: vi.fn().mockResolvedValue(undefined),
          }}
        >
          <ToastProvider>
            <BibliographyRemediationModal
              open={true}
              essayId={42}
              filename="Dissertation.pdf"
              lang="en"
              onClose={vi.fn()}
            />
          </ToastProvider>
        </AuthContext.Provider>
      </MemoryRouter>,
    );

    const disabledBtn = (await screen.findByTestId(
      'download-auto-healed-docx-btn',
    )) as HTMLButtonElement;
    expect(disabledBtn.disabled).toBe(true);
    expect(screen.getByTestId('auto-healed-docx-hint').textContent).toMatch(/\.docx/i);
  });

  it('EssayHeader passes tdtu for TDTU styleName, EssayActionBar localizes Remediation Engine, and OverrideControls shows attribution', async () => {
    const healedSpy = vi
      .spyOn(api, 'downloadAutoHealedDocx')
      .mockResolvedValue(undefined);

    const overriddenVerdict: Verdict = {
      citation_id: 'cit-9',
      citation_raw: 'Le, T. (2023). Graph Networks.',
      mapping_status: 'matched',
      mapping_confidence: 1,
      label: 'verified',
      confidence: 0.95,
      reasoning: 'Manually verified against printed proceedings.',
      triggered_rules: [],
      mismatched_fields: [],
      matched_sources: [],
      is_overridden: true,
      overridden_by: 'prof_tran',
      override_note: 'Checked physical copy',
      overridden_at: '2026-11-12T10:00:00Z',
    };

    const { unmount } = renderWithAuth(
      <div>
        <EssayHeader
          essayId={99}
          filename="Capstone_TDTU.docx"
          numPages={30}
          numCitations={18}
          styleName="Harvard / TDTU"
        />
        <EssayActionBar essayId="99" filename="Capstone_TDTU.docx" />
        <OverrideControls verdict={overriddenVerdict} onOverride={vi.fn()} />
      </div>,
      { route: '/verification/report/99' },
    );

    fireEvent.click(screen.getByTestId('export-healed-docx-btn'));
    await waitFor(() => {
      expect(healedSpy).toHaveBeenCalledWith(99, 'tdtu', 'Capstone_TDTU.docx');
    });

    const remBtn = screen.getByTestId('actionbar-remediation-btn');
    expect(remBtn.textContent).toContain('Remediation Engine');
    expect(remBtn.getAttribute('title')).toBe('Auto-Fix Style (APA / IEEE / TDTU)');
    expect(screen.getByTestId('override-attribution').textContent).toBe('by prof_tran');

    unmount();

    await i18n.changeLanguage('vi');
    renderWithAuth(
      <div>
        <EssayActionBar essayId="99" filename="Capstone_TDTU.docx" />
        <OverrideControls verdict={overriddenVerdict} onOverride={vi.fn()} />
      </div>,
      { route: '/verification/report/99' },
    );

    const remBtnVi = screen.getByTestId('actionbar-remediation-btn');
    expect(remBtnVi.textContent).toContain('Chuẩn hóa Tài liệu tham khảo');
    expect(remBtnVi.getAttribute('title')).toBe(
      'Tự động chuẩn hóa (APA / IEEE / TDTU)',
    );
    expect(screen.getByTestId('override-attribution').textContent).toBe('bởi prof_tran');
  });

  it('LiveCitationSandbox opens UpgradeModal on 0 remaining quota and on 402 error, calls refreshUser() on success', async () => {
    vi.spyOn(api, 'sampleSandboxAclPapers').mockResolvedValue({
      count: 1,
      style: 'apa',
      database_total_papers: 128626,
      items: [
        {
          index: 1,
          paper_id: 1001,
          title: 'Attention Is All You Need',
          authors: ['Ashish Vaswani'],
          authors_text: 'Ashish Vaswani',
          year: '2017',
          venue: 'NeurIPS',
          doi: '10.48550/arXiv.1706.03762',
          cite_in_text: true,
          include_in_references: true,
          in_text_context: 'Prior transformer work (Vaswani, 2017).',
          in_text_year_override: '',
          mutation_preset: 'clean',
        },
      ],
    });

    const genSpy = vi.spyOn(api, 'generateSandboxPdfManuscript');

    // 1. Pre-check when monthly_uploads_remaining === 0 opens UpgradeModal immediately
    const zeroQuotaUser = makeAuthUser({
      role: 'user',
      plan_tier: 'basic',
      quota: makeQuota({
        monthly_uploads_used: 3,
        monthly_uploads_limit: 3,
        monthly_uploads_remaining: 0,
        max_file_size_mb: 10,
        max_pages_per_pdf: 30,
        allowed_export_formats: ['json'],
      }),
    });

    const { unmount } = renderWithAuth(<LiveCitationSandbox lang="en" />, {
      user: zeroQuotaUser,
    });

    fireEvent.click(screen.getByTestId('sandbox-random-acl-btn'));
    await screen.findByTestId('sandbox-paper-card-0');
    fireEvent.click(screen.getByTestId('sandbox-generate-verify-pdf-btn'));

    expect(await screen.findByTestId('upgrade-modal')).toBeTruthy();
    expect(genSpy).not.toHaveBeenCalled();
    unmount();

    // 2. Backend 402 MONTHLY_QUOTA_EXCEEDED opens UpgradeModal, then success calls refreshUser()
    genSpy.mockRejectedValueOnce(new Error('API 402: MONTHLY_QUOTA_EXCEEDED'));
    genSpy.mockResolvedValueOnce({
      essay_id: 321,
      filename: 'Sandbox_Manuscript.pdf',
      num_pages: 4,
      in_text_count: 1,
      references_count: 1,
      in_text_markers_preview: ['(Vaswani, 2017)'],
      references_preview: ['Vaswani, A. (2017). Attention Is All You Need.'],
      pdf_base64: '',
      status: 'queued',
    });

    const refreshUserSpy = vi.fn().mockResolvedValue(undefined);
    renderWithAuth(
      <Routes>
        <Route path="/" element={<LiveCitationSandbox lang="en" />} />
        <Route
          path="/verification/processing/:essayId"
          element={<div data-testid="processing-dest">Processing 321</div>}
        />
      </Routes>,
      { refreshUser: refreshUserSpy },
    );

    fireEvent.click(screen.getByTestId('sandbox-random-acl-btn'));
    await screen.findByTestId('sandbox-paper-card-0');

    // First click hits 402 -> opens UpgradeModal
    fireEvent.click(screen.getByTestId('sandbox-generate-verify-pdf-btn'));
    expect(await screen.findByTestId('upgrade-modal')).toBeTruthy();

    // Second click succeeds -> calls refreshUser() and navigates
    fireEvent.click(screen.getByTestId('sandbox-generate-verify-pdf-btn'));
    expect(await screen.findByTestId('processing-dest')).toBeTruthy();
    expect(refreshUserSpy).toHaveBeenCalledTimes(1);
  });

  it('LiveCitationSandbox instant verification renders tech_standard (TCVN), [14a], RETRACTED, unchecked URL pill, incomplete_metadata summary, and VI explanation', async () => {
    const instantMock: SandboxInstantVerifyResponse = {
      elapsed_seconds: 1.2,
      total: 3,
      summary: {
        verified: 1,
        metadata_error: 1,
        incomplete_metadata: 1,
        suspected_hallucination: 0,
        unresolved: 1,
        resource: 0,
        layer1_linking_issues: 0,
      },
      results: [
        {
          index: 1,
          composite_label: '14a',
          citation_raw:
            'Bộ Khoa học và Công nghệ (2020). TCVN 7572-1:2020 Cốt liệu cho bê tông.',
          label: 'verified',
          confidence: 0.96,
          mapping_status: 'matched',
          mapping_note: '',
          mismatched_fields: [],
          triggered_rules: ['R-TECH-STANDARD-VERIFIED'],
          url_status: 'unchecked',
          matched_sources: [
            {
              source: 'tech_standard',
              title: 'TCVN 7572-1:2020 Aggregates for concrete and mortar',
              authors: ['Ministry of Science and Technology'],
              year: '2020',
              venue: 'National Technical Standard',
              external_ids: { standard_code: 'TCVN 7572-1:2020' },
              matched_fields: ['title', 'year'],
              checked_at: '2026-11-12T10:00:00Z',
            },
          ],
          reasoning: 'Verified national technical standard.',
        },
        {
          index: 2,
          citation_raw: 'Tran, V. Unpublished Lecture Handout.',
          label: 'metadata_error',
          confidence: 0.75,
          mapping_status: 'matched',
          mapping_note: '',
          mismatched_fields: ['year', 'venue'],
          triggered_rules: ['R-INCOMPLETE-METADATA', 'R-RETRACTED-PAPER'],
          is_retracted: true,
          reasoning: 'Incomplete reference missing year and venue.',
          reasoning_vi:
            'Trích dẫn chưa đủ thông tin định danh học thuật (thiếu năm xuất bản và nơi công bố).',
        },
        {
          index: 3,
          citation_raw: 'Obscure Monograph (1998).',
          label: 'unresolved',
          confidence: 0.45,
          mapping_status: 'matched',
          mapping_note: '',
          mismatched_fields: [],
          triggered_rules: ['R-UNVERIFIED'],
          reasoning: 'Unresolved entry.',
        },
      ],
    };

    vi.spyOn(api, 'verifySandboxCitationsInstant').mockResolvedValue(instantMock);

    const { unmount } = renderWithAuth(<LiveCitationSandbox lang="en" />);

    fireEvent.click(screen.getByTestId('sandbox-mode-raw-btn'));
    fireEvent.click(screen.getByTestId('sandbox-verify-submit-btn'));

    expect(await screen.findByTestId('sandbox-instant-results')).toBeTruthy();
    expect(screen.getByTestId('sandbox-summary-incomplete').textContent).toContain(
      'Incomplete Ref: 1',
    );
    expect(screen.getByTestId('sandbox-summary-unresolved').textContent).toContain(
      'Unverified: 1',
    );

    const card1 = screen.getByTestId('sandbox-result-card-1');
    expect(card1.textContent).toContain('[14a]');
    expect(screen.getByTestId('sandbox-url-status-1').textContent).toContain(
      'Scholarly Match',
    );
    expect(screen.getByTestId('sandbox-observed-meta-1').textContent).toContain(
      'TCVN 7572-1:2020 Aggregates for concrete and mortar',
    );
    expect(screen.getByTestId('sandbox-observed-meta-1').textContent).toMatch(
      /VN National Standards \(TCVN \/ QCVN\)/i,
    );
    expect(screen.getByTestId('sandbox-retracted-pill-2').textContent).toContain(
      'RETRACTED',
    );

    unmount();

    await i18n.changeLanguage('vi');
    renderWithAuth(<LiveCitationSandbox lang="vi" />);
    fireEvent.click(screen.getByTestId('sandbox-mode-raw-btn'));
    fireEvent.click(screen.getByTestId('sandbox-verify-submit-btn'));

    expect(
      (await screen.findByTestId('sandbox-summary-incomplete')).textContent,
    ).toContain('Thiếu quy cách: 1');
    expect(screen.getByTestId('sandbox-observed-meta-1').textContent).toMatch(
      /TCVN\s*\/\s*QCVN/i,
    );
    expect(screen.getByTestId('sandbox-result-card-2').textContent).toMatch(
      /chưa đủ thông tin định danh học thuật/i,
    );
  });

  it('HelpModal renders Incomplete Reference and 4 canonical 0–100 CIS bands in EN & VI, and RuleInspector defines R-DOI-CONFLICT & updated R-CROSS-LINGUAL-TITLE-MATCH', async () => {
    const { unmount } = renderWithAuth(<HelpModal isOpen={true} onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /Understanding Verdicts/i }));

    expect(screen.getByText('Incomplete Reference')).toBeTruthy();
    expect(screen.queryByText('R-INCOMPLETE-METADATA')).toBeNull();
    expect(screen.getByText('85 – 100')).toBeTruthy();
    expect(screen.getByText('70 – 84')).toBeTruthy();
    expect(screen.getByText('50 – 69')).toBeTruthy();
    expect(screen.getByText('< 50')).toBeTruthy();

    unmount();

    await i18n.changeLanguage('vi');
    renderWithAuth(<HelpModal isOpen={true} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Hiểu về kết quả/i }));
    expect(screen.getByText('Thiếu quy cách trích dẫn')).toBeTruthy();
    expect(screen.getByText('Xuất sắc')).toBeTruthy();
    expect(screen.getByText('Tốt')).toBeTruthy();
    expect(screen.getByText('Trung bình / Cần rà soát')).toBeTruthy();
    expect(screen.getByText('Cần rà soát kỹ')).toBeTruthy();

    // RuleInspector definitions check
    expect(RULE_DEFINITIONS['R-DOI-CONFLICT']).toBeDefined();
    expect(RULE_DEFINITIONS['R-DOI-CONFLICT'].category).toBe('warning');
    expect(RULE_DEFINITIONS['R-CROSS-LINGUAL-TITLE-MATCH'].name).toBe(
      'Translated Title Match (TDTU Foreign-Title Rule)',
    );
    expect(RULE_DEFINITIONS['R-CROSS-LINGUAL-TITLE-MATCH'].nameVi).toBe(
      'Tiêu đề dịch tiếng Việt (Vi phạm quy tắc giữ nguyên tiêu đề gốc TDTU)',
    );
    expect(RULE_DEFINITIONS['R-CROSS-LINGUAL-TITLE-MATCH'].description).toContain(
      '>= 0.58 (lexicon + multilingual ONNX INT8)',
    );
    expect(RULE_DEFINITIONS['R-CROSS-LINGUAL-TITLE-MATCH'].descriptionVi).toContain(
      '>= 0.58 (lexicon + multilingual ONNX INT8)',
    );

    renderWithAuth(
      <RuleInspector
        triggeredRules={['R-DOI-CONFLICT']}
        verdictLabel="metadata_error"
      />,
    );
    expect(
      screen.getByText('Xung đột mã DOI giữa các CSDL học thuật'),
    ).toBeTruthy();
  });

  it('Phase 2 Agent E — ClassDetailPage filters positive rules, requires join-code regenerate confirmation, supports submission search/filter/sort + VI DD/MM/YYYY dates + empty onboarding & friendly 404', async () => {
    await i18n.changeLanguage('vi');
    vi.spyOn(api, 'listMyClasses').mockResolvedValue([
      makeClass({
        id: 15,
        name: 'Khóa luận CNTT 2026',
        join_code: 'CITRA-1001',
        student_count: 2,
        essay_count: 2,
      }),
    ]);
    vi.spyOn(api, 'listClassStudents').mockResolvedValue([
      {
        id: 31,
        username: 'sv_an',
        email: 'an@tdtu.edu.vn',
        full_name: 'Nguyễn Văn An',
        is_active: true,
      },
    ]);
    vi.spyOn(api, 'listClassEssays').mockResolvedValue([
      {
        id: 201,
        filename: 'High_Score_Paper.pdf',
        num_pages: 20,
        user_id: 31,
        username: 'sv_an',
        uploaded_at: '2026-11-24T08:00:00Z',
        job_status: 'completed',
        cis_score: 94.5,
      },
      {
        id: 202,
        filename: 'Failed_Scan.pdf',
        num_pages: 4,
        user_id: 31,
        username: 'sv_an',
        uploaded_at: '2026-11-23T08:00:00Z',
        job_status: 'failed',
        job_error: 'Parse error',
        quota_charged: false,
      },
    ]);
    vi.spyOn(api, 'getClassAnalytics').mockResolvedValue({
      class_id: 15,
      class_name: 'Khóa luận CNTT 2026',
      total_students: 2,
      total_essays: 2,
      failed_essays: 1,
      queued_essays: 0,
      avg_cis: 94.5,
      recency_5yr_ratio: 80,
      cis_distribution: { excellent: 1, good: 0, fair: 0, poor: 0 },
      verdict_breakdown: { verified: 10, metadata_error: 2 },
      top_triggered_rules: [
        { rule_id: 'R-LOCAL_DB_VERIFIED', count: 10 },
        { rule_id: 'R-WELL-LINKED', count: 8 },
        { rule_id: 'R-CHIMERIC-DOI-MISMATCH', count: 2 },
      ],
      shared_hallucinations: [],
    });
    const regenSpy = vi.spyOn(api, 'regenerateClassCode').mockResolvedValue(
      makeClass({
        id: 15,
        name: 'Khóa luận CNTT 2026',
        join_code: 'CITRA-9999',
      }),
    );

    const { unmount } = renderWithAuth(
      <Routes>
        <Route path="/teacher/classes/:classId" element={<ClassDetailPage />} />
      </Routes>,
      { route: '/teacher/classes/15' },
    );

    // BUG-01: positive rules excluded, chimeric DOI translated cleanly
    const issuesCard = await screen.findByTestId('top-citation-issues-card');
    expect(issuesCard.textContent).toContain(
      'Mã DOI dẫn tới một bài báo khác (có thể ghép nhầm DOI)',
    );
    expect(issuesCard.textContent).not.toContain('R-LOCAL_DB_VERIFIED');
    expect(issuesCard.textContent).not.toContain('khớp chặt chẽ');

    // BUG-48: VI localized DD/MM/YYYY date
    expect(screen.getByTestId('class-essay-row-201').textContent).toContain('24/11/2026');

    // BUG-43: Clicking failed pill filters submissions to failed only
    fireEvent.click(screen.getByTestId('cohort-failed-essays-pill'));
    expect(screen.queryByTestId('class-essay-row-201')).toBeNull();
    expect(screen.getByTestId('class-essay-row-202')).toBeTruthy();

    // BUG-23: Regenerate join code requires explicit confirmation dialog
    fireEvent.click(screen.getByTestId('regenerate-join-code-btn'));
    expect(regenSpy).not.toHaveBeenCalled();
    expect(await screen.findByText('Tạo mã tham gia lớp mới?')).toBeTruthy();
    fireEvent.click(screen.getByTestId('confirmation-confirm-btn'));
    await waitFor(() => expect(regenSpy).toHaveBeenCalledWith(15));

    // BUG-11 & BUG-54: Edit Class modal portals with !mt-0 and has close × button
    fireEvent.click(screen.getByTestId('edit-class-btn'));
    const closeEditBtn = await screen.findByTestId('edit-class-close-btn');
    expect(closeEditBtn.closest('[role="dialog"]')?.parentElement?.className).toContain(
      '!mt-0',
    );
    fireEvent.click(closeEditBtn);
    unmount();

    // BUG-50: Empty class renders — on CIS/Recency, disabled exports, and 3-step onboarding
    vi.spyOn(api, 'listMyClasses').mockResolvedValue([
      makeClass({
        id: 16,
        name: 'Empty Class',
        join_code: 'CITRA-2026',
        student_count: 0,
        essay_count: 0,
      }),
    ]);
    vi.spyOn(api, 'listClassStudents').mockResolvedValue([]);
    vi.spyOn(api, 'listClassEssays').mockResolvedValue([]);
    vi.spyOn(api, 'getClassAnalytics').mockResolvedValue({
      class_id: 16,
      class_name: 'Empty Class',
      total_students: 0,
      total_essays: 0,
      avg_cis: 0,
      recency_5yr_ratio: 0,
      cis_distribution: {},
      verdict_breakdown: {},
      top_triggered_rules: [],
      shared_hallucinations: [],
    });

    const { unmount: unmountEmpty } = renderWithAuth(
      <Routes>
        <Route path="/teacher/classes/:classId" element={<ClassDetailPage />} />
      </Routes>,
      { route: '/teacher/classes/16' },
    );

    expect((await screen.findByTestId('cohort-avg-cis-value')).textContent).toBe('—');
    expect(screen.getByTestId('cohort-recency-value').textContent).toBe('—');
    expect(
      (screen.getByTestId('export-class-csv-btn') as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByTestId('export-class-zip-btn') as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(screen.getByTestId('empty-class-onboarding')).toBeTruthy();
    unmountEmpty();

    // Invalid class ID 999999 renders friendly not-found/access-restricted message
    renderWithAuth(
      <Routes>
        <Route path="/teacher/classes/:classId" element={<ClassDetailPage />} />
      </Routes>,
      { route: '/teacher/classes/999999' },
    );
    expect(
      await screen.findByText(
        'Không tìm thấy lớp học này hoặc bạn không có quyền truy cập.',
      ),
    ).toBeTruthy();
  });

  it('Phase 2 Agent E — OverrideControls mounts DecisionSupportBanner, close × button, unified taxonomy, mapping description, and enforces >=5-char audit note', async () => {
    await i18n.changeLanguage('vi');
    const onOverride = vi.fn().mockResolvedValue(undefined);
    const verdict: Verdict = {
      citation_id: 'cit-42',
      citation_raw: 'Nguyen (2024). Study.',
      mapping_status: 'missing_reference',
      mapping_confidence: 0.5,
      label: 'suspected_hallucination',
      confidence: 0.4,
      reasoning: 'Not found.',
      triggered_rules: [],
      mismatched_fields: [],
      matched_sources: [],
      is_overridden: false,
    };

    renderWithAuth(<OverrideControls verdict={verdict} onOverride={onOverride} />);
    fireEvent.click(screen.getByTestId('override-badge'));

    expect(screen.getByTestId('decision-support-banner')).toBeTruthy();
    expect(screen.getByTestId('override-close-btn')).toBeTruthy();
    expect(screen.getByText('Kết quả xác minh nguồn')).toBeTruthy();
    expect(
      screen.getByText('Tình trạng trình bày & đối chiếu trong bài'),
    ).toBeTruthy();
    expect(screen.getByTestId('override-mapping-description').textContent).toContain(
      'Thiếu nguồn:',
    );

    const submitBtn = screen.getByTestId('override-submit-btn') as HTMLButtonElement;
    expect(submitBtn.disabled).toBe(true);

    // Too short (< 5 chars) keeps submit disabled
    fireEvent.change(screen.getByTestId('override-reason-input'), {
      target: { value: 'abc' },
    });
    expect(submitBtn.disabled).toBe(true);

    // Select verified + >= 5 char rationale enables submit
    fireEvent.click(screen.getByTestId('override-label-verified'));
    fireEvent.change(screen.getByTestId('override-reason-input'), {
      target: { value: 'Đã kiểm tra bản in gốc' },
    });
    expect(submitBtn.disabled).toBe(false);

    fireEvent.click(submitBtn);
    await waitFor(() =>
      expect(onOverride).toHaveBeenCalledWith(
        expect.objectContaining({
          verdict_id: 'cit-42',
          new_label: 'verified',
          reason: 'Đã kiểm tra bản in gốc',
        }),
      ),
    );
  });

  it('Phase 2 Agent E — PendingReviewsPage mounts DecisionSupportBanner, shows student_name & class_name, uses real <a href> report links, guards actions with target picker & Undo toast', async () => {
    await i18n.changeLanguage('vi');
    vi.spyOn(api, 'listMyClasses').mockResolvedValue([
      makeClass({ id: 9, name: 'KLTN 2026' }),
    ]);
    vi.spyOn(api, 'listPendingReviews').mockResolvedValue([
      {
        verdict_id: 701,
        essay_id: 88,
        filename: 'KhoaLuan_NguyenVanAn_Final_Version_2026.pdf',
        student_username: 'sv_an',
        student_name: 'Nguyễn Văn An',
        class_id: 9,
        class_name: 'KLTN 2026',
        citation_raw: 'Unknown Paper (2025).',
        label: 'unresolved',
        confidence: 0.45,
        reasoning: 'Not indexed.',
        validated_at: '2026-11-24T10:00:00Z',
      },
    ]);
    const overrideSpy = vi
      .spyOn(api, 'overrideVerdict')
      .mockResolvedValue({ citation_id: '701', label: 'suspected_hallucination' } as Verdict);

    renderWithAuth(<PendingReviewsPage />, { route: '/teacher/reviews' });

    expect(await screen.findByTestId('decision-support-banner')).toBeTruthy();
    expect(screen.getByTestId('pending-group-student-88').textContent).toContain(
      'Nguyễn Văn An',
    );
    expect(screen.getByTestId('pending-group-class-88').textContent).toContain(
      'KLTN 2026',
    );
    expect(
      screen.getByTestId('pending-open-report-link-701').getAttribute('href'),
    ).toBe('/verification/report/88?citation=701');
    expect(
      screen.getByTestId('pending-full-report-link-88').getAttribute('href'),
    ).toBe('/verification/report/88');

    // Clicking Flag opens confirmation bar without immediately mutating
    fireEvent.click(screen.getByTestId('pending-confirm-issue-btn-701'));
    expect(overrideSpy).not.toHaveBeenCalled();
    expect(screen.getByTestId('pending-confirm-bar-701')).toBeTruthy();

    // Teacher chooses suspected_hallucination explicitly instead of forced metadata_error
    fireEvent.click(
      screen.getByTestId('pending-target-option-701-suspected_hallucination'),
    );
    fireEvent.change(screen.getByTestId('pending-confirm-note-701'), {
      target: { value: 'Không có trong kỷ yếu hội nghị' },
    });
    fireEvent.click(screen.getByTestId('pending-confirm-submit-701'));

    await waitFor(() =>
      expect(overrideSpy).toHaveBeenCalledWith(
        88,
        expect.objectContaining({
          verdict_id: '701',
          new_label: 'suspected_hallucination',
          reason: 'Không có trong kỷ yếu hội nghị',
        }),
      ),
    );

    // Undo button appears in toast and reverts back to original_label ('unresolved')
    const undoBtn = await screen.findByRole('button', { name: 'Hoàn tác' });
    fireEvent.click(undoBtn);
    await waitFor(() =>
      expect(overrideSpy).toHaveBeenNthCalledWith(
        2,
        88,
        expect.objectContaining({
          verdict_id: '701',
          new_label: 'unresolved',
        }),
      ),
    );
    expect(await screen.findByTestId('pending-review-row-701')).toBeTruthy();
  });

  it('Round 3 [P3-R2-3 & P3-03/04]: PendingReviewsPage uses Invalid Domain in EN, ClassDetailPage uses Điểm CIS TB in VI, and LiveCitationSandbox uses bài báo học thuật', async () => {
    // 1. PendingReviewsPage EN fake_domain -> "✕ Invalid Domain" (never "✕ Fake Domain")
    await i18n.changeLanguage('en');
    vi.spyOn(api, 'listMyClasses').mockResolvedValue([makeClass({ id: 20, name: 'AI Research' })]);
    vi.spyOn(api, 'listPendingReviews').mockResolvedValue([
      {
        verdict_id: 801,
        essay_id: 91,
        filename: 'FakeDomainCheck.pdf',
        student_username: 'sv_test',
        citation_raw: 'Fake (2025). https://example.com/nonexistent',
        label: 'suspected_hallucination',
        confidence: 0.95,
        reasoning: 'Placeholder domain.',
        validated_at: '2026-11-27T08:00:00Z',
        url_status: 'fake_domain',
      },
    ]);
    const { unmount: unmountPending } = renderWithAuth(<PendingReviewsPage />, {
      route: '/teacher/reviews',
    });
    const urlPill = await screen.findByTestId('pending-url-status-801');
    expect(urlPill.textContent).toContain('✕ Invalid Domain');
    expect(urlPill.textContent).not.toContain('Fake Domain');
    unmountPending();

    // 2. ClassDetailPage VI KPI label -> "Điểm CIS TB" (matching /dashboard)
    await i18n.changeLanguage('vi');
    vi.spyOn(api, 'listMyClasses').mockResolvedValue([makeClass({ id: 21, name: 'Lớp KLTN' })]);
    vi.spyOn(api, 'listClassStudents').mockResolvedValue([]);
    vi.spyOn(api, 'listClassEssays').mockResolvedValue([]);
    vi.spyOn(api, 'getClassAnalytics').mockResolvedValue({
      class_id: 21,
      class_name: 'Lớp KLTN',
      total_students: 0,
      total_essays: 0,
      queued_essays: 0,
      failed_essays: 0,
      avg_cis: 0,
      recency_5yr_ratio: 0,
      cis_distribution: { excellent: 0, good: 0, fair: 0, poor: 0 },
      verdict_breakdown: {},
      top_triggered_rules: [],
      shared_hallucinations: [],
    });
    const { container: clsContainer, unmount: unmountCls } = renderWithAuth(
      <Routes>
        <Route path="/teacher/classes/:classId" element={<ClassDetailPage />} />
      </Routes>,
      { route: '/teacher/classes/21' },
    );
    await screen.findByTestId('cohort-avg-cis-value');
    expect(clsContainer.textContent).toContain('Điểm CIS TB');
    expect(clsContainer.textContent).not.toContain('Điểm tin cậy TB');
    unmountCls();

    // 3. LiveCitationSandbox VI uses "12 bài báo học thuật" & "kho bài báo học thuật"
    const { container: sbContainer } = renderWithAuth(<LiveCitationSandbox lang="vi" />);
    const countSelect = screen.getByTestId('sandbox-acl-count-select');
    expect(countSelect.textContent).toContain('12 bài báo học thuật');
    expect(countSelect.textContent).not.toContain('12 bài báo ACL');
    expect(sbContainer.textContent).toContain('kho bài báo học thuật');
    expect(sbContainer.textContent).not.toContain('kho ACL');
  });
});
