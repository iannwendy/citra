import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Routes, Route } from 'react-router-dom';
import { api } from '@/api/client';
import i18n from '@/i18n';
import { renderWithProviders, makeUser, screen, fireEvent, waitFor, act } from '@/test-utils';
import { makeReport, makeVerdict } from '@/test-fixtures';
import { EssayHeader } from './essay/EssayHeader';
import { EssayActionBar } from './essay/EssayActionBar';
import { EssayPage } from './EssayPage';

describe('Report Page UI/UX Redesign (Non-Tech Clarity & Progressive Disclosure)', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await i18n.changeLanguage('vi');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Task 1: Compact Document Header (EssayHeader)', () => {
    it('eliminates VERIFICATION REPORT IDE / ID# / EXPORT AUDIT ARTIFACT clutter and clarifies references vs in-text mentions', async () => {
      const { container, unmount } = renderWithProviders(
        <EssayHeader
          essayId={119}
          filename="VietDepression_PLOS_ONE.pdf"
          numPages={20}
          numCitations={115}
          numReferences={53}
          styleName="IEEE-LIKE"
        />,
        { user: makeUser('teacher', 'ultra') },
      );

      expect(container.textContent).not.toContain('VERIFICATION REPORT IDE');
      expect(container.textContent).not.toContain('BÁO CÁO KIỂM CHỨNG HỌC THUẬT');
      expect(container.textContent).not.toContain('ID #119');
      expect(container.textContent).not.toContain('EXPORT AUDIT ARTIFACT');
      expect(screen.getByTestId('header-back-btn').textContent?.trim()).toBe('Quay lại');

      const summary = screen.getByTestId('header-citation-summary');
      expect(summary.textContent).toContain('53 tài liệu tham khảo');
      expect(summary.textContent).toContain('115 lượt trích trong bài');
      unmount();

      await i18n.changeLanguage('en');
      renderWithProviders(
        <EssayHeader
          essayId={119}
          filename="VietDepression_PLOS_ONE.pdf"
          numPages={20}
          numCitations={115}
          numReferences={53}
          styleName="IEEE-LIKE"
        />,
        { user: makeUser('teacher', 'ultra') },
      );
      expect(screen.getByTestId('header-back-btn').textContent?.trim()).toBe('Back');
      expect(screen.getByTestId('header-back-btn').textContent).not.toContain('Back to Reports');
    });

    it('consolidates export formats into a clean Export dropdown trigger + primary Fix & Format CTA', () => {
      const onOpenRemediation = vi.fn();
      renderWithProviders(
        <EssayHeader
          essayId={119}
          filename="VietDepression_PLOS_ONE.pdf"
          numPages={20}
          numCitations={115}
          numReferences={53}
          styleName="IEEE"
          onOpenRemediation={onOpenRemediation}
        />,
        { user: makeUser('user', 'pro') },
      );

      const fixBtn = screen.getByTestId('header-remediation-btn');
      expect(fixBtn.textContent).toContain('Sửa & Chuẩn hóa trích dẫn');
      fireEvent.click(fixBtn);
      expect(onOpenRemediation).toHaveBeenCalledTimes(1);

      const exportTrigger = screen.getByTestId('export-menu-trigger');
      const exportMenu = screen.getByTestId('export-dropdown-menu');
      expect(exportMenu.getAttribute('data-open')).toBe('false');

      fireEvent.click(exportTrigger);
      expect(exportMenu.getAttribute('data-open')).toBe('true');
    });
  });

  describe('Task 2: Single-Purpose View Tabs & Smart Summary Health Bar', () => {
    it('replaces programmer jargon Citation Debugger with human Vietnamese/English view labels in EssayActionBar', async () => {
      const { container, unmount } = renderWithProviders(
        <EssayActionBar
          essayId="119"
          filename="VietDepression_PLOS_ONE.pdf"
          issueCount={2}
          consistencyOk={true}
          hideRemediationButton={true}
        />,
        { user: makeUser('teacher', 'pro'), initialRoute: '/verification/report/119' },
      );

      expect(container.textContent).not.toContain('Citation Debugger');
      expect(container.textContent).toContain('Danh mục trích dẫn');
      expect(container.textContent).toContain('Xem trong bài viết');
      expect(container.textContent).toContain('Kiểm tra thiếu / thừa');
      expect(screen.queryByTestId('actionbar-remediation-btn')).toBeNull();
      unmount();

      await i18n.changeLanguage('en');
      const { container: enContainer } = renderWithProviders(
        <EssayActionBar
          essayId="119"
          filename="VietDepression_PLOS_ONE.pdf"
          issueCount={2}
          consistencyOk={true}
          hideRemediationButton={true}
        />,
        { user: makeUser('teacher', 'pro'), initialRoute: '/verification/report/119' },
      );
      expect(enContainer.textContent).not.toContain('Citation Debugger');
      expect(enContainer.textContent).toContain('Citations');
      expect(enContainer.textContent).toContain('In Document');
      expect(enContainer.textContent).toContain('In-Text Check');
    });

    it('collapses zero-change Revision Tracker into a quiet note instead of 0->0 math pills and shows qualitative CIS health pill', async () => {
      vi.spyOn(api, 'getEssay').mockResolvedValue(
        makeReport({
          essay_id: 119,
          filename: 'VietDepression_PLOS_ONE.pdf',
          num_pages: 20,
          num_citations: 115,
          cis: { score: 99.1, grade: 'A', total_academic: 53, verified: 50 } as never,
          verdicts: [
            makeVerdict({
              citation_id: 'v7',
              numeric_index: 7,
              citation_raw: '[7] Choudhury et al. (2013). Negatively correlated noisy learners.',
              label: 'metadata_error',
            }),
          ],
          revision_diff: {
            has_previous_revision: true,
            is_same_manuscript_family: true,
            previous_essay_id: 118,
            previous_filename: 'VietDepression_PLOS_ONE.pdf',
            current_essay_id: 119,
            current_filename: 'VietDepression_PLOS_ONE.pdf',
            cis_before: 99.1,
            cis_after: 99.1,
            cis_delta: 0.0,
            resolved_issues_count: 0,
            new_issues_count: 0,
            counts_before: {
              total: 53,
              verified: 50,
              metadata_error: 1,
              suspected_hallucination: 0,
              unresolved: 2,
            },
            counts_after: {
              total: 53,
              verified: 50,
              metadata_error: 1,
              suspected_hallucination: 0,
              unresolved: 2,
            },
            citation_changes: [],
          },
        }),
      );

      const { container } = renderWithProviders(
        <Routes>
          <Route path="/verification/report/:id" element={<EssayPage />} />
        </Routes>,
        { user: makeUser('teacher', 'ultra'), initialRoute: '/verification/report/119' },
      );

      await waitFor(() =>
        expect(screen.getByTestId('cis-qualitative-pill')).toBeDefined(),
      );
      expect(screen.getByTestId('cis-qualitative-pill').textContent).toContain(
        'Rất đáng tin cậy',
      );

      const revNote = screen.getByTestId('revision-diff-banner');
      expect(revNote.getAttribute('data-quiet-unchanged')).toBe('true');
      expect(container.textContent).not.toContain('THEO DÕI TIẾN BỘ QUA CÁC LẦN NỘP');
      expect(screen.queryByTestId('revision-delta-suspected_hallucination')).toBeNull();
    });
  });

  describe('Task 3: Clean 2-Column Workspace, Exception-First Queue & Progressive Disclosure Drawer', () => {
    it('removes fake macOS window chrome, prioritizes issues first in queue, hides normal MATCHED noise, pins mismatched diff row first, and collapses deep AI drawer by default', async () => {
      vi.spyOn(api, 'getEssay').mockResolvedValue(
        makeReport({
          essay_id: 119,
          filename: 'VietDepression_PLOS_ONE.pdf',
          num_pages: 20,
          num_citations: 115,
          references: [
            {
              id: 1,
              reference_id: 'ref-0001',
              numeric_index: 1,
              raw_text: '[1] De Choudhury, M. et al. (2013). Predicting depression via social media. ICWSM.',
              citation_type: 'reference_list',
              authors: ['De Choudhury, M.'],
              year: '2013',
              title: 'Predicting depression via social media',
              venue: 'ICWSM',
              doi: null,
              url: null,
              confidence: 1,
            },
            {
              id: 7,
              reference_id: 'ref-0007',
              numeric_index: 7,
              raw_text: '[7] Choudhury, M. et al. (2013). Negatively correlated noisy learners. PLOS ONE.',
              citation_type: 'reference_list',
              authors: ['Choudhury, M.'],
              year: '2013',
              title: 'Negatively correlated noisy learners',
              venue: 'PLOS ONE',
              doi: '10.1371/journal.pone.0119482',
              url: null,
              confidence: 1,
            },
          ] as never,
          verdicts: [
            makeVerdict({
              citation_id: 'cit-1',
              numeric_index: 1,
              citation_raw: '[1] De Choudhury, M. et al. (2013). Predicting depression via social media. ICWSM.',
              mapping_status: 'matched',
              label: 'verified',
              confidence: 0.98,
              matched_sources: [
                {
                  source: 'openalex',
                  title: 'Predicting depression via social media',
                  authors: ['Munmun De Choudhury'],
                  year: '2013',
                  venue: 'ICWSM',
                  confidence: 0.98,
                  matched_fields: ['title', 'authors', 'year', 'venue'],
                  checked_at: '2026-11-16T00:00:00Z',
                },
              ],
            }),
            makeVerdict({
              citation_id: 'cit-7',
              numeric_index: 7,
              citation_raw: '[7] Choudhury, M. et al. (2013). Negatively correlated noisy learners. PLOS ONE.',
              mapping_status: 'matched',
              label: 'metadata_error',
              confidence: 0.89,
              mismatched_fields: ['year'],
              triggered_rules: ['R-SINGLE-SOURCE-PARTIAL'],
              citation_links: [{ citation_id: 'cit-7', reference_id: 'ref-0007', status: 'matched', confidence: 1 }] as never,
              matched_sources: [
                {
                  source: 'crossref',
                  title: 'Negatively correlated noisy learners',
                  authors: ['Munmun De Choudhury'],
                  year: '2014',
                  venue: 'PLOS ONE',
                  doi: '10.1371/journal.pone.0119482',
                  confidence: 0.95,
                  matched_fields: ['title', 'authors', 'venue', 'doi'],
                  checked_at: '2026-11-16T00:00:00Z',
                },
              ],
              features: {
                title_sim_fuzzy: 1.0,
                author_jaccard: 1.0,
                year_distance: 1,
                doi_exact_match: true,
              },
            }),
          ],
        }),
      );

      const { container } = renderWithProviders(
        <Routes>
          <Route path="/verification/report/:id" element={<EssayPage />} />
        </Routes>,
        { user: makeUser('user', 'pro'), initialRoute: '/verification/report/119' },
      );

      await waitFor(() =>
        expect(screen.getByTestId('deep-verification-drawer')).toBeDefined(),
      );

      // 1. No fake macOS traffic-light chrome, no Split-Pane IDE label, no ref-0007 leak
      expect(container.textContent).not.toContain('Split-Pane IDE');
      expect(container.textContent).not.toContain('INSPECTING REFERENCE');
      expect(container.textContent).not.toContain('ref-0007');

      // 2. Normal MATCHED plumbing badge is hidden
      expect(container.querySelectorAll('.mapping-badge').length).toBe(0);

      // 3. Issue [7] is prioritized BEFORE verified [1] in the left queue
      const queueOptions = Array.from(
        container.querySelectorAll('[role="listbox"] [role="option"]'),
      );
      expect(queueOptions.length).toBe(2);
      expect(queueOptions[0]?.getAttribute('data-citation-id')).toBe('cit-7');
      expect(queueOptions[1]?.getAttribute('data-citation-id')).toBe('cit-1');

      // 4. Mismatched field (Năm XB / Year) is pinned to row 1 of the comparison table, and empty URL row is hidden
      const diffRows = Array.from(container.querySelectorAll('table tbody tr'));
      expect(diffRows[0]?.textContent).toContain('Năm XB');
      const hasUrlRow = diffRows.some((r) => r.textContent?.includes('URL / Link'));
      expect(hasUrlRow).toBe(false);

      // 5. Quick Copy Formatted Citation button is available in Tier 1
      expect(screen.getByTestId('copy-formatted-citation-btn')).toBeDefined();

      // 6. Deep Verification Drawer is collapsed by default and opens on click
      const drawer = screen.getByTestId('deep-verification-drawer');
      expect(drawer.getAttribute('data-open')).toBe('false');
      fireEvent.click(screen.getByTestId('deep-verification-drawer-toggle'));
      expect(drawer.getAttribute('data-open')).toBe('true');
    });
  });

  describe('Task 6: Unified Single-Page 4-View Consolidation, Pinned Tab Bar & 120fps Motion', () => {
    it('keeps all 4 view tabs pinned in one fixed segmented bar with a 120fps sliding pill and transitions all 4 views in-place with causal DirectionalStageSlide', async () => {
      vi.spyOn(api, 'getEssay').mockResolvedValue(
        makeReport({
          essay_id: 119,
          filename: 'VietDepression_PLOS_ONE.pdf',
          num_pages: 20,
          num_citations: 115,
          verdicts: [
            makeVerdict({
              citation_id: 'cit-1',
              numeric_index: 1,
              citation_raw: '[1] De Choudhury et al. (2013). Predicting depression via social media.',
              context: 'Prior studies examined social media signals [1].',
              mapping_status: 'matched',
              label: 'verified',
              confidence: 0.98,
            }),
            makeVerdict({
              citation_id: 'cit-2',
              numeric_index: 2,
              citation_raw: '[2] Missing Entry (2022). Unmatched paper.',
              context: 'Another claim cited [2] in text.',
              mapping_status: 'missing_reference',
              label: 'metadata_error',
              confidence: 0.72,
            }),
          ],
        }),
      );

      const { container } = renderWithProviders(
        <Routes>
          <Route path="/verification/report/:id" element={<EssayPage />} />
        </Routes>,
        { user: makeUser('teacher', 'ultra'), initialRoute: '/verification/report/119' },
      );

      await waitFor(() =>
        expect(screen.getByTestId('report-tabs-sliding-pill')).toBeDefined(),
      );

      const pill = screen.getByTestId('report-tabs-sliding-pill');
      expect(pill.classList.contains('t-tabs-pill')).toBe(true);

      const healthSummaryBefore = screen.getByTestId('report-health-summary');
      const tablistBefore = screen.getByTestId('report-view-tablist');
      const citationsBtn = screen.getByTestId('mode-citations-btn');
      const docBtn = screen.getByTestId('mode-document-btn');
      const consistencyBtn = screen.getByTestId('mode-consistency-btn');
      const graphBtn = screen.getByTestId('mode-graph-btn');

      expect(citationsBtn.getAttribute('aria-selected')).toBe('true');
      expect(docBtn.getAttribute('aria-selected')).toBe('false');
      expect(consistencyBtn.getAttribute('aria-selected')).toBe('false');
      expect(graphBtn.getAttribute('aria-selected')).toBe('false');

      const stage = screen.getByTestId('report-view-stage');
      expect(stage.classList.contains('t-stage-slide-viewport')).toBe(true);

      // Click citation item in left queue -> detail inspector has smooth stage wrapper
      expect(screen.getByTestId('citation-detail-stage')).toBeDefined();

      // 1. Click Tab 2 ("Xem trong bài viết") -> switches in-place without unmounting health bar or tablist!
      fireEvent.click(docBtn);
      expect(screen.getByTestId('report-health-summary')).toBe(healthSummaryBefore);
      expect(screen.getByTestId('report-view-tablist')).toBe(tablistBefore);
      expect(docBtn.getAttribute('aria-selected')).toBe('true');
      expect(citationsBtn.getAttribute('aria-selected')).toBe('false');
      expect(stage.getAttribute('data-direction')).toBe('1');
      expect(screen.getByText('Chế độ xem tài liệu')).toBeDefined();
      expect(container.textContent).not.toContain('document_inspector.tei');
      expect(container.textContent).not.toContain('document_inspector.docx');

      // 2. Click Tab 3 ("Kiểm tra thiếu / thừa") -> switches forward (+1) in-place without fake python chrome
      fireEvent.click(consistencyBtn);
      expect(screen.getByTestId('report-health-summary')).toBe(healthSummaryBefore);
      expect(screen.getByTestId('report-view-tablist')).toBe(tablistBefore);
      expect(consistencyBtn.getAttribute('aria-selected')).toBe('true');
      expect(docBtn.getAttribute('aria-selected')).toBe('false');
      expect(stage.getAttribute('data-direction')).toBe('1');
      expect(screen.getByText('Trích dẫn thiếu tham khảo')).toBeDefined();
      expect(container.textContent).not.toContain('bipartite_consistency.py');

      // 3. Click Tab 1 ("Danh mục trích dẫn") -> slides causally backward (-1) back to Citations inspector
      fireEvent.click(citationsBtn);
      expect(screen.getByTestId('report-health-summary')).toBe(healthSummaryBefore);
      expect(screen.getByTestId('report-view-tablist')).toBe(tablistBefore);
      expect(citationsBtn.getAttribute('aria-selected')).toBe('true');
      expect(stage.getAttribute('data-direction')).toBe('-1');
      expect(screen.getByTestId('deep-verification-drawer')).toBeDefined();
    });

    it('opens directly on the requested tab when visiting /document or /consistency URL and opens UpgradeModal cleanly for Basic users', async () => {
      vi.spyOn(api, 'getEssay').mockResolvedValue(
        makeReport({
          essay_id: 119,
          filename: 'VietDepression_PLOS_ONE.pdf',
          num_pages: 20,
          num_citations: 10,
          verdicts: [
            makeVerdict({
              citation_id: 'cit-1',
              numeric_index: 1,
              citation_raw: '[1] De Choudhury et al. (2013). Paper.',
              mapping_status: 'matched',
              label: 'verified',
            }),
          ],
        }),
      );

      // Pro/Ultra bookmark to /verification/report/119/document lands on Unified EssayPage with Tab 2 active
      const { unmount } = renderWithProviders(
        <Routes>
          <Route path="/verification/report/:id/document" element={<EssayPage />} />
        </Routes>,
        { user: makeUser('user', 'pro'), initialRoute: '/verification/report/119/document' },
      );

      await waitFor(() =>
        expect(screen.getByTestId('mode-document-btn').getAttribute('aria-selected')).toBe('true'),
      );
      expect(screen.getByText('Chế độ xem tài liệu')).toBeDefined();
      unmount();

      // Basic user sees locked tabs in the exact same pinned bar and opens UpgradeModal on click
      renderWithProviders(
        <Routes>
          <Route path="/verification/report/:id" element={<EssayPage />} />
        </Routes>,
        { user: makeUser('user', 'basic'), initialRoute: '/verification/report/119' },
      );

      const lockedDocBtn = await screen.findByTestId('locked-document-inspector-btn');
      const tablistBefore = screen.getByTestId('report-view-tablist');
      fireEvent.click(lockedDocBtn);
      expect(screen.getByTestId('report-view-tablist')).toBe(tablistBefore);
    });

    it('stays inside the Network tab when clicking any reference card (updating EvidenceGraph in-place at 120fps) and uses clean uniform 1px editorial borders instead of tacky border-l-4 stripes', async () => {
      vi.spyOn(api, 'getEssay').mockResolvedValue(
        makeReport({
          essay_id: 119,
          filename: 'VietDepression_PLOS_ONE.pdf',
          num_pages: 20,
          num_citations: 15,
          verdicts: [
            makeVerdict({
              citation_id: 'cit-1',
              numeric_index: 1,
              citation_raw: '[1] Vietnam National Administration of Tourism (2025). Annual Report.',
              mapping_status: 'matched',
              label: 'resource',
              confidence: 0.95,
            }),
            makeVerdict({
              citation_id: 'cit-2',
              numeric_index: 2,
              citation_raw: '[2] Pontiki, M. et al. (2014). SemEval-2014 Task 4: Aspect Based Sentiment Analysis.',
              mapping_status: 'matched',
              label: 'verified',
              confidence: 0.96,
            }),
          ],
        }),
      );

      const { container } = renderWithProviders(
        <Routes>
          <Route path="/verification/report/:id" element={<EssayPage />} />
        </Routes>,
        { user: makeUser('teacher', 'ultra'), initialRoute: '/verification/report/119' },
      );

      const citationsBtn = await screen.findByTestId('mode-citations-btn');
      const graphBtn = screen.getByTestId('mode-graph-btn');

      // Check Citations queue cards have NO curved thick border-l-4 / border-l-[3.5px]
      expect(container.innerHTML).not.toContain('border-l-4');
      expect(container.innerHTML).not.toContain('border-l-[3.5px]');

      // Switch to Network tab
      fireEvent.click(graphBtn);
      expect(graphBtn.getAttribute('aria-selected')).toBe('true');
      expect(citationsBtn.getAttribute('aria-selected')).toBe('false');
      expect(screen.getByTestId('citation-graph-view')).toBeDefined();

      // Network ref cards have NO border-l-4 curved stripe
      const refCard0 = screen.getByTestId('graph-ref-card-0');
      const refCard1 = screen.getByTestId('graph-ref-card-1');
      expect(refCard0.className).not.toContain('border-l-4');
      expect(refCard1.className).not.toContain('border-l-4');

      // Click [2] in Network tab -> MUST STAY in Network tab and select [2]!
      fireEvent.click(refCard1);
      expect(graphBtn.getAttribute('aria-selected')).toBe('true');
      expect(citationsBtn.getAttribute('aria-selected')).toBe('false');
      expect(screen.getByTestId('citation-graph-view')).toBeDefined();
      expect(refCard1.getAttribute('data-selected')).toBe('true');
      expect(refCard0.getAttribute('data-selected')).toBe('false');
      expect(screen.getByTestId('network-evidence-stage')).toBeDefined();
    });

    it('calibrates the CIS score donut ring directly to report.cis.score (99.9% renders a virtually full ring even when non-scholarly web resources are present)', async () => {
      const verdicts = [
        ...Array.from({ length: 26 }, (_, idx) =>
          makeVerdict({
            citation_id: `v-${idx + 1}`,
            numeric_index: idx + 1,
            citation_raw: `[${idx + 1}] Verified Paper (${2020 + (idx % 5)}). Journal.`,
            mapping_status: 'matched',
            label: 'verified',
          }),
        ),
        ...Array.from({ length: 4 }, (_, idx) =>
          makeVerdict({
            citation_id: `res-${idx + 1}`,
            numeric_index: 27 + idx,
            citation_raw: `[${27 + idx}] Official Portal (2025). https://example.org/${idx}`,
            mapping_status: 'matched',
            label: 'resource',
          }),
        ),
      ];

      vi.spyOn(api, 'getEssay').mockResolvedValue(
        makeReport({
          essay_id: 120,
          filename: 'GoodNstay_SRS.docx',
          num_pages: 15,
          num_citations: 30,
          cis: { score: 99.9, grade: 'A', total_academic: 26, verified: 26 } as never,
          verdicts,
        }),
      );

      renderWithProviders(
        <Routes>
          <Route path="/verification/report/:id" element={<EssayPage />} />
        </Routes>,
        { user: makeUser('teacher', 'ultra'), initialRoute: '/verification/report/120' },
      );

      const ring = await screen.findByTestId('cis-score-ring');
      expect(ring.getAttribute('data-score')).toBe('99.9');

      const progressCircle = ring.querySelector(
        '[data-testid="cis-score-ring-progress"]',
      ) as SVGCircleElement;
      expect(progressCircle).not.toBeNull();
      const dashArray = parseFloat(progressCircle.getAttribute('stroke-dasharray') || '0');
      const dashOffset = parseFloat(progressCircle.getAttribute('stroke-dashoffset') || '999');
      expect(dashArray).toBeGreaterThan(90);
      // At 99.9%, remaining offset must be ~0.1% of circumference (< 0.5px), NOT a 13-18% missing chunk!
      expect(dashOffset).toBeLessThan(0.5);
    });

    it('renders the InteractiveDecisionFlowBoard in the Network tab with zero ML jargon, 4 clickable pipeline stages, interactive satellite DB nodes, and Cinema spotlight mode', async () => {
      vi.spyOn(api, 'getEssay').mockResolvedValue(
        makeReport({
          essay_id: 121,
          filename: 'Thesis_Defense_Demo.pdf',
          num_pages: 24,
          num_citations: 18,
          verdicts: [
            makeVerdict({
              citation_id: 'cit-7',
              numeric_index: 7,
              citation_raw: '[7] Choudhury, M. et al. (2013). Negatively correlated noisy learners. PLOS ONE.',
              mapping_status: 'matched',
              label: 'metadata_error',
              confidence: 0.89,
              mismatched_fields: ['year'],
              triggered_rules: ['R-SINGLE-SOURCE-PARTIAL'],
              matched_sources: [
                {
                  source: 'crossref',
                  title: 'Negatively correlated noisy learners',
                  authors: ['Munmun De Choudhury'],
                  year: '2014',
                  venue: 'PLOS ONE',
                  doi: '10.1371/journal.pone.0119482',
                  confidence: 0.95,
                  matched_fields: ['title', 'authors', 'venue', 'doi'],
                  checked_at: '2026-11-16T00:00:00Z',
                },
              ],
            }),
          ],
        }),
      );

      renderWithProviders(
        <Routes>
          <Route path="/verification/report/:id" element={<EssayPage />} />
        </Routes>,
        { user: makeUser('teacher', 'ultra'), initialRoute: '/verification/report/121' },
      );

      const graphBtn = await screen.findByTestId('mode-graph-btn');
      fireEvent.click(graphBtn);

      const board = await screen.findByTestId('interactive-decision-flow-board');
      expect(board).toBeDefined();

      // Zero ML / internal jargon in the Network workspace
      const graphView = screen.getByTestId('citation-graph-view');
      expect(graphView.textContent).not.toContain('RapidFuzz');
      expect(graphView.textContent).not.toContain('Sentence-BERT');
      expect(graphView.textContent).not.toContain('Author Jaccard');
      expect(graphView.textContent).not.toContain('DAG TRACE');
      expect(graphView.textContent).not.toContain('R-SINGLE-SOURCE-PARTIAL');

      // 4 end-to-end pipeline steps are interactive
      const step0 = screen.getByTestId('flow-step-0');
      const step2 = screen.getByTestId('flow-step-2');
      expect(step0).toBeDefined();
      expect(step2).toBeDefined();

      // Crossref satellite node is lit as matched, OpenAlex is unmatched
      const crossrefSat = screen.getByTestId('flow-sat-crossref');
      const openalexSat = screen.getByTestId('flow-sat-openalex');
      expect(crossrefSat.getAttribute('data-matched')).toBe('true');
      expect(openalexSat.getAttribute('data-matched')).toBe('false');

      // Clicking Step 3 (index 2) updates the plain-language story card
      fireEvent.click(step2);
      expect(step2.getAttribute('data-active')).toBe('true');
      expect(screen.getByTestId('flow-story-card').textContent).toContain('Năm xuất bản');

      // Clicking Crossref satellite node focuses it and shows human provenance story
      fireEvent.click(crossrefSat);
      expect(crossrefSat.getAttribute('data-focused')).toBe('true');
      expect(screen.getByTestId('flow-story-card').textContent).toContain('Crossref');

      // Cinema Spotlight toggle switches board presentation mode cleanly
      const cinemaToggle = screen.getByTestId('flow-cinema-toggle');
      expect(board.getAttribute('data-cinema')).toBe('false');
      fireEvent.click(cinemaToggle);
      expect(board.getAttribute('data-cinema')).toBe('true');

      // Slow 4-Act Replay Flow physically transforms the MAIN BOARD step-by-step (>= 2.2s per act)
      vi.useFakeTimers();
      try {
        const replayBtn = screen.getByTestId('flow-replay-btn');
        fireEvent.click(replayBtn);

        // Act 1 (0ms - 2300ms): Main board enters "step-0" (Reading Manuscript), satellites standby
        expect(board.getAttribute('data-board-phase')).toBe('step-0');
        expect(screen.getByTestId('flow-main-stage-hud').textContent).toContain('1/4');
        expect(crossrefSat.getAttribute('data-phase-state')).toBe('standby');

        // After 800ms it MUST STILL be on Act 1 (not zooming past in 420ms!)
        act(() => {
          vi.advanceTimersByTime(800);
        });
        expect(board.getAttribute('data-board-phase')).toBe('step-0');

        // Advance to Act 2 (2400ms total): Main board enters "step-1" (Broadcasting Radar Scan to 15+ DBs)
        act(() => {
          vi.advanceTimersByTime(1600);
        });
        expect(board.getAttribute('data-board-phase')).toBe('step-1');
        expect(screen.getByTestId('flow-main-stage-hud').textContent).toContain('2/4');
        expect(crossrefSat.getAttribute('data-phase-state')).toBe('hit');
        expect(openalexSat.getAttribute('data-phase-state')).toBe('scanning');

        // Advance to Act 3 (4800ms total): Main board enters "step-2" and morphs Center Hub into Live Field Diff Matrix!
        act(() => {
          vi.advanceTimersByTime(2400);
        });
        expect(board.getAttribute('data-board-phase')).toBe('step-2');
        expect(screen.getByTestId('flow-main-stage-hud').textContent).toContain('3/4');
        const matrix = screen.getByTestId('flow-hub-field-matrix');
        expect(matrix.textContent).toContain('Năm xuất bản');
        expect(matrix.textContent).toContain('2013');
        expect(matrix.textContent).toContain('2014');

        // Advance to Act 4 (7200ms total): Dedicated Final Verdict Seal inside Center Hub on Main Board
        act(() => {
          vi.advanceTimersByTime(2400);
        });
        expect(board.getAttribute('data-board-phase')).toBe('step-3');
        expect(screen.getByTestId('flow-main-stage-hud').textContent).toContain('4/4');
        const verdictSeal = screen.getByTestId('flow-hub-verdict-seal');
        expect(verdictSeal).toBeDefined();

        // Clicking replayBtn while running stops replay cleanly back to overview
        fireEvent.click(replayBtn);
        expect(board.getAttribute('data-board-phase')).toBe('overview');
      } finally {
        vi.useRealTimers();
      }

      // Network split resizer allows dragging / keyboard resizing left-right and double-click reset
      const splitContainer = screen.getByTestId('network-split-container');
      const resizer = screen.getByTestId('network-split-resizer');
      expect(resizer.getAttribute('role')).toBe('separator');
      expect(splitContainer.style.getPropertyValue('--network-split-pct')).toBe('32%');

      // Keyboard ArrowRight widens left reference column; double-click resets to 32%
      fireEvent.keyDown(resizer, { key: 'ArrowRight' });
      expect(splitContainer.style.getPropertyValue('--network-split-pct')).toBe('35%');
      expect(localStorage.getItem('citra.network.splitPct')).toBe('35');

      fireEvent.doubleClick(resizer);
      expect(splitContainer.style.getPropertyValue('--network-split-pct')).toBe('32%');
    });

    it('prevents bottom text clipping on long titles and unbroken URLs in Play Step-by-Step (step-0) by isolating vertical padding from line-clamp-2', async () => {
      const longTitle =
        'Quantifying Mental Health Signals in Twitter: A Longitudinal Multi-Cohort Linguistic Analysis Across Social Platforms';
      vi.spyOn(api, 'getEssay').mockResolvedValue(
        makeReport({
          essay_id: 122,
          filename: 'Long_Reference_Replay.pdf',
          num_pages: 14,
          num_citations: 2,
          verdicts: [
            makeVerdict({
              citation_id: 'cit-2',
              numeric_index: 2,
              citation_raw: `[2] Coppersmith, G., Dredze, M., & Harman, C. (2014). ${longTitle}. Workshop on Computational Linguistics and Clinical Psychology.`,
              mapping_status: 'matched',
              label: 'verified',
              confidence: 0.97,
              matched_sources: [
                {
                  source: 'crossref',
                  title: `${longTitle}.`,
                  authors: ['Glen Coppersmith', 'Mark Dredze', 'Craig Harman'],
                  year: '2014',
                  venue: 'CLPsych',
                  doi: '10.3115/v1/W14-3207',
                  confidence: 0.97,
                  matched_fields: ['title', 'authors', 'year'],
                  checked_at: '2026-11-17T00:00:00Z',
                },
              ],
            }),
          ],
        }),
      );

      renderWithProviders(
        <Routes>
          <Route path="/verification/report/:id" element={<EssayPage />} />
        </Routes>,
        { user: makeUser('teacher', 'ultra'), initialRoute: '/verification/report/122' },
      );

      fireEvent.click(await screen.findByTestId('mode-graph-btn'));
      const board = await screen.findByTestId('interactive-decision-flow-board');
      const hub = screen.getByTestId('flow-central-hub');

      // Overview phase title wraps unbroken strings safely
      const overviewTitle = hub.querySelector('p');
      expect(overviewTitle?.className).toContain('break-words');
      expect(overviewTitle?.className).toContain('[overflow-wrap:anywhere]');

      // Enter Play Step-by-Step (step-0: 1/4 · Reading Manuscript)
      fireEvent.click(screen.getByTestId('flow-replay-btn'));
      expect(board.getAttribute('data-board-phase')).toBe('step-0');

      // No element inside flow-central-hub may combine line-clamp-* with vertical padding (py-*/p-*/pb-*)
      const clampedNodes = Array.from(hub.querySelectorAll('[class*="line-clamp-"]'));
      expect(clampedNodes.length).toBeGreaterThan(0);
      for (const node of clampedNodes) {
        expect(node.className).not.toMatch(/\b(?:py-|pb-|pt-|p-\d)/);
      }

      // Dedicated step-0 title pill uses outer padding + inner line-clamp-2 <p> + full title tooltip
      const step0TitleBox = screen.getByTestId('flow-step0-title-box');
      expect(step0TitleBox.getAttribute('title')).toContain(longTitle);
      const innerClampedP = step0TitleBox.querySelector('p');
      expect(innerClampedP).not.toBeNull();
      expect(innerClampedP?.className).toContain('line-clamp-2');
      expect(innerClampedP?.className).toContain('break-words');
      expect(innerClampedP?.className).toContain('[overflow-wrap:anywhere]');

      // Left metadata labels in step-0 carry shrink-0 so Vietnamese labels never wrap on long authors
      const step0Labels = Array.from(hub.querySelectorAll('span.opacity-70'));
      expect(step0Labels.length).toBe(2);
      for (const lbl of step0Labels) {
        expect(lbl.className).toContain('shrink-0');
      }
    });
  });
});
