import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Routes, Route, useLocation } from 'react-router-dom';
import { api } from '@/api/client';
import { makeReport, makeVerdict } from '@/test-fixtures';
import { renderWithProviders, makeUser } from '@/test-utils';
import i18n from '@/i18n';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { LegacyReportSubrouteRedirect } from '@/router';
import {
  NeuralAlignmentPanel,
  VerificationTraceTimeline,
  hasNeuralAlignmentData,
} from './LogicTracePage';
import { EssayPage, ReportSummaryAndNavBar } from './EssayPage';

describe('Task 1: Reusable Verification Trace & Neural Alignment exports', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('hasNeuralAlignmentData returns true when alignment/cross-lingual data exists and false for plain web resources or empty features', () => {
    const rich = makeVerdict({
      label: 'verified',
      features: {
        content_alignment_score: 0.82,
        best_evidence_sentence: 'Transformers rely solely on attention mechanisms.',
        citation_intent: 'methodology',
        stance_label: 'supported',
      },
    });
    const plainResource = makeVerdict({
      label: 'resource',
      features: { content_alignment_score: 0.5 },
    });
    const empty = makeVerdict({
      label: 'suspected_hallucination',
      features: undefined,
    });

    expect(hasNeuralAlignmentData(rich)).toBe(true);
    expect(hasNeuralAlignmentData(plainResource)).toBe(false);
    expect(hasNeuralAlignmentData(empty)).toBe(false);
  });

  it('renders NeuralAlignmentPanel and VerificationTraceTimeline in VI and EN', () => {
    const v = makeVerdict({
      label: 'verified',
      confidence: 0.94,
      triggered_rules: ['R-WELL-LINKED'],
      features: {
        title_sim_fuzzy: 0.96,
        content_alignment_score: 0.84,
        best_evidence_score: 0.88,
        best_cited_sentence: 'We follow Vaswani et al. for self-attention.',
        best_evidence_sentence:
          'We propose a new simple network architecture, the Transformer.',
        citation_intent: 'methodology',
        stance_label: 'supported',
      },
    });

    const { unmount } = render(<NeuralAlignmentPanel verdict={v} lang="en" />);
    expect(screen.getByTestId('neural-alignment-panel')).toBeDefined();
    expect(screen.getByText(/Transformer/)).toBeDefined();
    unmount();

    render(<VerificationTraceTimeline verdict={v} lang="vi" />);
    const timeline = screen.getByTestId('verification-trace-timeline');
    expect(timeline.textContent).toContain('1. Đọc & ghép trích dẫn');
    expect(timeline.textContent).toContain('5. Kết quả kiểm tra');
  });

  it('does not mislabel url_status="unchecked" as unreachable domain in VerificationTraceTimeline', () => {
    const v = makeVerdict({
      label: 'unresolved',
      url_status: 'unchecked',
      matched_sources: [],
      features: { url_status: 'unchecked' },
    });

    render(<VerificationTraceTimeline verdict={v} lang="en" />);
    const timeline = screen.getByTestId('verification-trace-timeline');
    expect(timeline.textContent).not.toContain('Unreachable domain');
    expect(timeline.textContent).not.toContain('Tên miền không tồn tại');
  });
});

describe('Task 2: 4-Tab ReportSummaryAndNavBar & Single Badge Discipline', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await i18n.changeLanguage('en');
  });

  it('renders exactly 4 task tabs and omits mode-issues-btn and mode-trace-btn', () => {
    const report = makeReport({
      essay_id: 101,
      verdicts: [
        makeVerdict({ citation_id: 'v1', label: 'verified', mapping_status: 'matched' }),
      ],
    });

    renderWithProviders(
      <ReportSummaryAndNavBar
        essayId="101"
        report={report}
        activeLayer="debugger"
        onChangeWorkspaceMode={vi.fn()}
      />,
      { user: makeUser('user', 'pro') },
    );

    const tablist = screen.getByTestId('report-view-tablist');
    expect(tablist.querySelectorAll('[role="tab"]')).toHaveLength(4);
    expect(screen.getByTestId('mode-citations-btn')).toBeDefined();
    expect(screen.getByTestId('mode-document-btn')).toBeDefined();
    expect(screen.getByTestId('mode-consistency-btn')).toBeDefined();
    expect(screen.getByTestId('mode-graph-btn')).toBeDefined();
    expect(screen.queryByTestId('mode-issues-btn')).toBeNull();
    expect(screen.queryByTestId('mode-trace-btn')).toBeNull();
    expect(screen.queryByTestId('citations-issue-badge')).toBeNull();
  });

  it('counts dead links and abnormal mappings in single critical badge on Tab 1 and amber linking count on Tab 3', () => {
    const report = makeReport({
      essay_id: 102,
      verdicts: [
        makeVerdict({
          citation_id: 'v1',
          label: 'verified',
          mapping_status: 'matched',
          url_status: 'dead_link',
        }),
        makeVerdict({
          citation_id: 'v2',
          label: 'verified',
          mapping_status: 'uncited_reference',
        }),
        makeVerdict({
          citation_id: 'v3',
          label: 'verified',
          mapping_status: 'matched',
        }),
      ],
      linking_summary: {
        total_in_text: 2,
        total_references: 3,
        matched: 2,
        missing_reference: 0,
        uncited_reference: 1,
        in_text_mismatch: 0,
        ambiguous_mapping: 0,
        duplicate_reference: 0,
        style_inconsistent: 0,
      } as never,
    });

    renderWithProviders(
      <ReportSummaryAndNavBar
        essayId="102"
        report={report}
        activeLayer="debugger"
        onChangeWorkspaceMode={vi.fn()}
      />,
      { user: makeUser('user', 'pro') },
    );

    const citBadge = screen.getByTestId('citations-issue-badge');
    expect(citBadge.textContent?.trim()).toBe('2');
    expect(citBadge.getAttribute('data-severity')).toBe('critical');

    const linkBadge = screen.getByTestId('consistency-issue-badge');
    expect(linkBadge.textContent?.trim()).toBe('1');
    expect(screen.queryByTestId('consistency-matched-dot')).toBeNull();
  });

  it('shows amber warning badge on Tab 1 for metadata_error only and emerald dot on Tab 3 when all linked', () => {
    const report = makeReport({
      essay_id: 103,
      verdicts: [
        makeVerdict({
          citation_id: 'v1',
          label: 'metadata_error',
          mapping_status: 'matched',
        }),
      ],
      linking_summary: {
        total_in_text: 1,
        total_references: 1,
        matched: 1,
        missing_reference: 0,
        uncited_reference: 0,
        in_text_mismatch: 0,
        ambiguous_mapping: 0,
        duplicate_reference: 0,
        style_inconsistent: 0,
      } as never,
    });

    renderWithProviders(
      <ReportSummaryAndNavBar
        essayId="103"
        report={report}
        activeLayer="debugger"
        onChangeWorkspaceMode={vi.fn()}
      />,
      { user: makeUser('user', 'pro') },
    );

    const citBadge = screen.getByTestId('citations-issue-badge');
    expect(citBadge.textContent?.trim()).toBe('1');
    expect(citBadge.getAttribute('data-severity')).toBe('warning');
    expect(screen.getByTestId('consistency-matched-dot')).toBeDefined();
    expect(screen.queryByTestId('consistency-issue-badge')).toBeNull();
  });

  it('preserves Basic-plan lock gates across the 4 tabs without issues or trace links', () => {
    const report = makeReport({
      essay_id: 104,
      verdicts: [makeVerdict({ citation_id: 'v1', label: 'verified', mapping_status: 'matched' })],
    });

    renderWithProviders(
      <ReportSummaryAndNavBar
        essayId="104"
        report={report}
        activeLayer="debugger"
        onChangeWorkspaceMode={vi.fn()}
        onOpenLockedFeature={vi.fn()}
      />,
      { user: makeUser('user', 'basic') },
    );

    expect(screen.getByTestId('mode-citations-btn')).toBeDefined();
    expect(screen.getByTestId('locked-document-inspector-btn')).toBeDefined();
    expect(screen.getByTestId('locked-consistency-btn')).toBeDefined();
    expect(screen.getByTestId('locked-graph-btn')).toBeDefined();
    expect(screen.queryByTestId('mode-issues-btn')).toBeNull();
    expect(screen.queryByTestId('mode-trace-btn')).toBeNull();
  });
});

describe('Task 3: Unified Issues Filter & In-Context Verification Details Drawer', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await i18n.changeLanguage('en');
  });

  it('filters all actionable issues (including broken URL & abnormal mapping on verified items) and hides zero-count status chips', async () => {
    vi.spyOn(api, 'getEssay').mockResolvedValue(
      makeReport({
        essay_id: 201,
        verdicts: [
          makeVerdict({
            citation_id: 'v-clean',
            numeric_index: 1,
            citation_raw: '[1] Clean Paper (2022). Verified Title.',
            label: 'verified',
            mapping_status: 'matched',
          }),
          makeVerdict({
            citation_id: 'v-web-ok',
            numeric_index: 2,
            citation_raw: '[2] Python Docs. https://docs.python.org/3/',
            label: 'resource',
            mapping_status: 'matched',
            url_status: 'alive',
          }),
          makeVerdict({
            citation_id: 'v-hallu',
            numeric_index: 3,
            citation_raw: '[3] Phantom (2025). Fake Paper.',
            label: 'suspected_hallucination',
            mapping_status: 'matched',
          }),
          makeVerdict({
            citation_id: 'v-meta',
            numeric_index: 4,
            citation_raw: '[4] Smith (2020). Wrong Year Paper.',
            label: 'metadata_error',
            mapping_status: 'matched',
          }),
          makeVerdict({
            citation_id: 'v-dead-url',
            numeric_index: 5,
            citation_raw: '[5] Verified With Dead Link (2021). Broken URL Paper.',
            label: 'verified',
            mapping_status: 'matched',
            url_status: 'dead_link',
          }),
          makeVerdict({
            citation_id: 'v-uncited',
            numeric_index: 6,
            citation_raw: '[6] Verified Uncited (2021). Uncited Paper.',
            label: 'verified',
            mapping_status: 'uncited_reference',
          }),
          makeVerdict({
            citation_id: 'v-web-broken',
            numeric_index: 7,
            citation_raw: '[7] Broken Docs. https://broken.example.org/',
            label: 'resource',
            mapping_status: 'uncited_reference',
            url_status: 'dead_link',
            triggered_rules: ['R-URL-RESOURCE', 'R-DEAD-URL', 'R-URL-CONTENT-MISMATCH'],
          }),
        ],
      }),
    );

    const { container } = renderWithProviders(
      <Routes>
        <Route path="/verification/report/:id" element={<EssayPage />} />
      </Routes>,
      { user: makeUser('user', 'pro'), initialRoute: '/verification/report/201' },
    );

    const issuesChip = await screen.findByTestId('queue-filter-issues');
    // Multi-trigger broken web resource counts ONCE (total = 5, not 7)
    expect(issuesChip.textContent).toContain('5');
    expect(screen.getByTestId('citations-issue-badge').textContent?.trim()).toBe('5');
    // Unresolved count is 0 -> chip is hidden
    expect(screen.queryByTestId('queue-filter-unresolved')).toBeNull();

    fireEvent.click(issuesChip);

    const optionIds = Array.from(
      container.querySelectorAll('[role="listbox"] [role="option"]'),
    ).map((el) => el.getAttribute('data-citation-id'));

    expect(optionIds).toEqual(
      expect.arrayContaining([
        'v-hallu',
        'v-meta',
        'v-dead-url',
        'v-uncited',
        'v-web-broken',
      ]),
    );
    expect(optionIds).toHaveLength(5);
    expect(optionIds).not.toContain('v-clean');
    expect(optionIds).not.toContain('v-web-ok');
  });

  it('shows empty-issues state with 1-click reset when landing with ?filter=issues on a clean paper', async () => {
    vi.spyOn(api, 'getEssay').mockResolvedValue(
      makeReport({
        essay_id: 202,
        verdicts: [
          makeVerdict({
            citation_id: 'v-ok-1',
            numeric_index: 1,
            citation_raw: '[1] Vaswani et al. (2017). Attention Is All You Need.',
            label: 'verified',
            mapping_status: 'matched',
          }),
        ],
      }),
    );

    const { container } = renderWithProviders(
      <>
        <LocationSpy />
        <Routes>
          <Route path="/verification/report/:id" element={<EssayPage />} />
        </Routes>
      </>,
      {
        user: makeUser('user', 'pro'),
        initialRoute: '/verification/report/202?filter=issues',
      },
    );

    const emptyCard = await screen.findByTestId('queue-empty-issues');
    expect(emptyCard).toBeDefined();

    fireEvent.click(screen.getByTestId('queue-reset-filter-btn'));
    await waitFor(() =>
      expect(
        container.querySelectorAll('[role="listbox"] [role="option"]'),
      ).toHaveLength(1),
    );
    // Resetting Issues filter must clear stale ?filter=issues from the URL
    expect(screen.getByTestId('location-spy').getAttribute('data-search')).toBe('');
  });

  it('renders 4-tab Verification Details drawer with Content Match, 5-Step Trace + Checks, and zero /trace link for Pro users (plus fallback for plain resources)', async () => {
    vi.spyOn(api, 'getEssay').mockResolvedValue(
      makeReport({
        essay_id: 203,
        verdicts: [
          makeVerdict({
            citation_id: 'v-rich',
            numeric_index: 1,
            citation_raw: '[1] Vaswani et al. (2017). Attention Is All You Need.',
            label: 'verified',
            confidence: 0.96,
            mapping_status: 'matched',
            triggered_rules: ['R-WELL-LINKED'],
            features: {
              title_sim_fuzzy: 0.98,
              content_alignment_score: 0.87,
              best_evidence_score: 0.91,
              best_cited_sentence: 'Our encoder builds on multi-head self-attention.',
              best_evidence_sentence:
                'We propose a new simple network architecture, the Transformer.',
              citation_intent: 'methodology',
              stance_label: 'supported',
            },
          }),
          makeVerdict({
            citation_id: 'v-res',
            numeric_index: 2,
            citation_raw: '[2] Official Python Docs. https://docs.python.org/3/',
            label: 'resource',
            mapping_status: 'matched',
            url_status: 'alive',
            triggered_rules: ['R-URL-RESOURCE'],
          }),
        ],
      }),
    );

    const { container } = renderWithProviders(
      <Routes>
        <Route path="/verification/report/:id" element={<EssayPage />} />
      </Routes>,
      { user: makeUser('user', 'pro'), initialRoute: '/verification/report/203' },
    );

    fireEvent.click(await screen.findByTestId('deep-verification-drawer-toggle'));

    // No context-breaking jump link to /trace
    expect(container.querySelector('a[href$="/trace"]')).toBeNull();

    expect(screen.getByTestId('inspector-tab-sources')).toBeDefined();
    expect(screen.getByTestId('inspector-tab-content')).toBeDefined();
    expect(screen.getByTestId('inspector-tab-steps')).toBeDefined();
    expect(screen.getByTestId('inspector-tab-graph')).toBeDefined();

    // Tab 2: Content Match renders NeuralAlignmentPanel
    fireEvent.click(screen.getByTestId('inspector-tab-content'));
    expect(screen.getByTestId('neural-alignment-panel')).toBeDefined();
    expect(screen.getByText(/Transformer/)).toBeDefined();

    // Tab 3: Steps & Checks renders 5-Step Trace Timeline + plain-language rules
    fireEvent.click(screen.getByTestId('inspector-tab-steps'));
    expect(screen.getByTestId('verification-trace-timeline')).toBeDefined();
    expect(screen.getByText(/Strong Match Across Citation Details/i)).toBeDefined();

    // Switching to plain web resource -> Content Match shows bilingual fallback instead of blank panel
    const resOption = container.querySelector(
      '[role="option"][data-citation-id="v-res"]',
    ) as HTMLElement;
    fireEvent.click(resOption);
    fireEvent.click(screen.getByTestId('inspector-tab-content'));
    expect(screen.getByTestId('content-match-empty')).toBeDefined();
  });

  it('keeps Basic users gated inside Tier 3 drawer without leaking Content Match or 5-Step Trace', async () => {
    vi.spyOn(api, 'getEssay').mockResolvedValue(
      makeReport({
        essay_id: 204,
        verdicts: [
          makeVerdict({
            citation_id: 'v-rich',
            numeric_index: 1,
            citation_raw: '[1] Vaswani et al. (2017). Attention Is All You Need.',
            label: 'verified',
            features: {
              content_alignment_score: 0.87,
              best_evidence_sentence: 'Transformer architecture.',
            },
          }),
        ],
      }),
    );

    renderWithProviders(
      <Routes>
        <Route path="/verification/report/:id" element={<EssayPage />} />
      </Routes>,
      { user: makeUser('user', 'basic'), initialRoute: '/verification/report/204' },
    );

    fireEvent.click(await screen.findByTestId('deep-verification-drawer-toggle'));
    expect(screen.getByTestId('deep-drawer-basic-upgrade')).toBeDefined();
    expect(screen.queryByTestId('inspector-tab-content')).toBeNull();
    expect(screen.queryByTestId('neural-alignment-panel')).toBeNull();
    expect(screen.queryByTestId('verification-trace-timeline')).toBeNull();

    // Clicking a locked tab opens UpgradeModal cleanly for Basic users
    fireEvent.click(screen.getByTestId('locked-document-inspector-btn'));
    expect(await screen.findByTestId('upgrade-modal')).toBeDefined();
  });
});

function LocationSpy() {
  const loc = useLocation();
  return (
    <div data-testid="location-spy" data-pathname={loc.pathname} data-search={loc.search} />
  );
}

describe('Task 4: Canonical URL Sync & Legacy Sub-Route Redirects', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await i18n.changeLanguage('en');
  });

  it('syncs ?view= in-place on /verification/report/:id without unmounting health bar or tablist', async () => {
    vi.spyOn(api, 'getEssay').mockResolvedValue(
      makeReport({
        essay_id: 301,
        verdicts: [
          makeVerdict({
            citation_id: 'v1',
            numeric_index: 1,
            citation_raw: '[1] Vaswani et al. (2017). Attention Is All You Need.',
            label: 'verified',
            mapping_status: 'matched',
          }),
        ],
      }),
    );

    renderWithProviders(
      <>
        <LocationSpy />
        <Routes>
          <Route path="/verification/report/:id" element={<EssayPage />} />
        </Routes>
      </>,
      { user: makeUser('user', 'pro'), initialRoute: '/verification/report/301' },
    );

    const healthBefore = await screen.findByTestId('report-health-summary');
    const tablistBefore = screen.getByTestId('report-view-tablist');
    const spy = () => screen.getByTestId('location-spy');

    expect(spy().getAttribute('data-pathname')).toBe('/verification/report/301');
    expect(spy().getAttribute('data-search')).toBe('');

    fireEvent.click(screen.getByTestId('mode-document-btn'));
    expect(screen.getByTestId('report-health-summary')).toBe(healthBefore);
    expect(screen.getByTestId('report-view-tablist')).toBe(tablistBefore);
    expect(spy().getAttribute('data-pathname')).toBe('/verification/report/301');
    expect(spy().getAttribute('data-search')).toBe('?view=document');

    fireEvent.click(screen.getByTestId('mode-consistency-btn'));
    expect(screen.getByTestId('report-health-summary')).toBe(healthBefore);
    expect(spy().getAttribute('data-search')).toBe('?view=consistency');

    fireEvent.click(screen.getByTestId('mode-graph-btn'));
    expect(screen.getByTestId('report-health-summary')).toBe(healthBefore);
    expect(spy().getAttribute('data-search')).toBe('?view=graph');

    fireEvent.click(screen.getByTestId('mode-citations-btn'));
    expect(screen.getByTestId('report-health-summary')).toBe(healthBefore);
    expect(spy().getAttribute('data-search')).toBe('');
  });

  it('redirects legacy /issues, /trace, /document, and /consistency URLs cleanly into canonical /verification/report/:id', async () => {
    vi.spyOn(api, 'getEssay').mockResolvedValue(
      makeReport({
        essay_id: 302,
        verdicts: [
          makeVerdict({
            citation_id: 'v-err',
            numeric_index: 1,
            citation_raw: '[1] Smith (2020). Mismatched Paper.',
            label: 'metadata_error',
            mapping_status: 'matched',
          }),
        ],
      }),
    );

    const renderRoutes = (initialRoute: string, plan: 'pro' | 'basic' = 'pro') =>
      renderWithProviders(
        <>
          <LocationSpy />
          <Routes>
            <Route path="/verification/report/:id" element={<EssayPage />} />
            <Route
              path="/verification/report/:id/issues"
              element={<LegacyReportSubrouteRedirect target="issues" />}
            />
            <Route
              path="/verification/report/:id/trace"
              element={
                <ProtectedRoute requiredCapabilities={['view_logic_trace']}>
                  <LegacyReportSubrouteRedirect target="trace" />
                </ProtectedRoute>
              }
            />
            <Route
              path="/verification/report/:id/document"
              element={
                <ProtectedRoute requiredCapabilities={['view_document_inspector']}>
                  <LegacyReportSubrouteRedirect target="document" />
                </ProtectedRoute>
              }
            />
            <Route
              path="/verification/report/:id/consistency"
              element={
                <ProtectedRoute requiredCapabilities={['view_orphan_detection']}>
                  <LegacyReportSubrouteRedirect target="consistency" />
                </ProtectedRoute>
              }
            />
            <Route path="/dashboard" element={<div data-testid="dashboard-redirect">Dashboard</div>} />
          </Routes>
        </>,
        { user: makeUser('user', plan), initialRoute },
      );

    // 1. /issues -> /verification/report/302?filter=issues with Issues filter active
    const r1 = renderRoutes('/verification/report/302/issues');
    const issuesBtn = await screen.findByTestId('queue-filter-issues');
    expect(screen.getByTestId('location-spy').getAttribute('data-pathname')).toBe(
      '/verification/report/302',
    );
    expect(screen.getByTestId('location-spy').getAttribute('data-search')).toBe(
      '?filter=issues',
    );
    expect(issuesBtn.getAttribute('data-pill-active')).toBe('true');
    r1.unmount();

    // 2. /trace (Pro) -> /verification/report/302?drawer=trace with drawer open on Steps & Checks
    const r2 = renderRoutes('/verification/report/302/trace', 'pro');
    const drawer = await screen.findByTestId('deep-verification-drawer');
    expect(screen.getByTestId('location-spy').getAttribute('data-pathname')).toBe(
      '/verification/report/302',
    );
    expect(screen.getByTestId('location-spy').getAttribute('data-search')).toBe(
      '?drawer=trace',
    );
    expect(drawer.getAttribute('data-open')).toBe('true');
    expect(screen.getByTestId('inspector-tab-steps').getAttribute('aria-selected')).toBe(
      'true',
    );
    r2.unmount();

    // 3. /document (Pro) -> /verification/report/302?view=document
    const r3 = renderRoutes('/verification/report/302/document', 'pro');
    await waitFor(() =>
      expect(screen.getByTestId('mode-document-btn').getAttribute('aria-selected')).toBe(
        'true',
      ),
    );
    expect(screen.getByTestId('location-spy').getAttribute('data-pathname')).toBe(
      '/verification/report/302',
    );
    expect(screen.getByTestId('location-spy').getAttribute('data-search')).toBe(
      '?view=document',
    );
    r3.unmount();

    // 4. /consistency (Pro) -> /verification/report/302?view=consistency
    const r4 = renderRoutes('/verification/report/302/consistency', 'pro');
    await waitFor(() =>
      expect(screen.getByTestId('mode-consistency-btn').getAttribute('aria-selected')).toBe(
        'true',
      ),
    );
    expect(screen.getByTestId('location-spy').getAttribute('data-search')).toBe(
      '?view=consistency',
    );
    r4.unmount();

    // 5. /trace (Basic) -> blocked by ProtectedRoute and actually redirected to /dashboard
    const r5 = renderRoutes('/verification/report/302/trace', 'basic');
    expect(await screen.findByTestId('dashboard-redirect')).toBeDefined();
    expect(screen.getByTestId('location-spy').getAttribute('data-pathname')).toBe(
      '/dashboard',
    );
    expect(screen.queryByTestId('deep-verification-drawer')).toBeNull();
    r5.unmount();
  });

  it('preserves ?view=document on reload when ?citation= is present and keeps ?citation= across tab switches', async () => {
    vi.spyOn(api, 'getEssay').mockResolvedValue(
      makeReport({
        essay_id: 303,
        verdicts: [
          makeVerdict({
            citation_id: 'v1',
            numeric_index: 1,
            citation_raw: '[1] Vaswani et al. (2017). Attention Is All You Need.',
            label: 'verified',
            mapping_status: 'matched',
          }),
        ],
      }),
    );

    renderWithProviders(
      <>
        <LocationSpy />
        <Routes>
          <Route path="/verification/report/:id" element={<EssayPage />} />
        </Routes>
      </>,
      {
        user: makeUser('user', 'pro'),
        initialRoute: '/verification/report/303?citation=v1&view=document',
      },
    );

    await screen.findByTestId('mode-document-btn');
    // Wait for ?citation=v1 effect to settle after report loads; mode-document-btn must STAY active!
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.getByTestId('mode-document-btn').getAttribute('aria-selected')).toBe(
      'true',
    );
    expect(screen.getByTestId('location-spy').getAttribute('data-search')).toBe(
      '?citation=v1&view=document',
    );

    fireEvent.click(screen.getByTestId('mode-consistency-btn'));
    expect(screen.getByTestId('location-spy').getAttribute('data-search')).toBe(
      '?citation=v1&view=consistency',
    );
  });

  it('re-syncs tab, filter, and drawer from URL when navigating from one report to another while EssayPage stays mounted', async () => {
    vi.spyOn(api, 'getEssay').mockImplementation(async (id) =>
      makeReport({
        essay_id: id,
        filename: id === 401 ? 'draft_v2.pdf' : 'draft_v1.pdf',
        verdicts: [
          makeVerdict({
            citation_id: `v-${id}`,
            numeric_index: 1,
            citation_raw: `[1] Draft ${id} Reference.`,
            label: 'metadata_error',
            mapping_status: 'matched',
          }),
        ],
        revision_diff:
          id === 401
            ? ({
                has_previous_revision: true,
                is_same_manuscript_family: true,
                previous_essay_id: 400,
                previous_filename: 'draft_v1.pdf',
                current_essay_id: 401,
                current_filename: 'draft_v2.pdf',
                cis_before: 80,
                cis_after: 90,
                cis_delta: 10,
                resolved_issues_count: 1,
                new_issues_count: 0,
                citation_changes: [],
              } as never)
            : null,
      }),
    );

    renderWithProviders(
      <>
        <LocationSpy />
        <Routes>
          <Route path="/verification/report/:id" element={<EssayPage />} />
        </Routes>
      </>,
      {
        user: makeUser('user', 'pro'),
        initialRoute: '/verification/report/401?view=document',
      },
    );

    await waitFor(() =>
      expect(screen.getByTestId('mode-document-btn').getAttribute('aria-selected')).toBe(
        'true',
      ),
    );

    // Click "Open previous draft" -> navigates to /verification/report/400 (no ?view=)
    fireEvent.click(screen.getByText('Open previous draft'));

    await screen.findByText('draft_v1.pdf');
    expect(screen.getByTestId('location-spy').getAttribute('data-pathname')).toBe(
      '/verification/report/400',
    );
    expect(screen.getByTestId('mode-citations-btn').getAttribute('aria-selected')).toBe(
      'true',
    );
  });
});
