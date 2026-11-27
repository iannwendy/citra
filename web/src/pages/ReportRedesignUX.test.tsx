import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Routes, Route } from 'react-router-dom';
import { api } from '@/api/client';
import i18n from '@/i18n';
import { renderWithProviders, makeUser, screen, fireEvent, waitFor, act } from '@/test-utils';
import { makeReport, makeVerdict } from '@/test-fixtures';
import { EssayHeader } from './essay/EssayHeader';
import { EssayActionBar } from './essay/EssayActionBar';
import { EssayPage } from './EssayPage';
import { IssuesPage } from './IssuesPage';
import { LogicTracePage } from './LogicTracePage';
import { DocumentInspectorPage } from './DocumentInspectorPage';
import { OrphanDetectionPage } from './OrphanDetectionPage';
import {
  InteractiveDecisionFlowBoard,
  extractCleanCitationIdentity,
} from '@/components/CitationGraph/InteractiveDecisionFlowBoard';
import {
  BibliographyRemediationModal,
  deduplicateRepeatedVenue,
} from '@/components/BibliographyRemediationModal';

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
        'Xuất sắc',
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

  describe('Phase 2 Agent D Regression Coverage (BUG-02..BUG-59)', () => {
    it('BUG-02/03/19: enforces single-definition counts across L1-L5 (resource separate from verified, excluded from L2 issues, zero dropped L5 entries, ambiguous_mapping blue badge)', async () => {
      await i18n.changeLanguage('en');
      const mixedReport = makeReport({
        essay_id: 401,
        filename: 'thesis_mixed.docx',
        num_pages: 10,
        num_citations: 5,
        verdicts: [
          makeVerdict({
            citation_id: 'v-ver',
            numeric_index: 1,
            citation_raw: '[1] Vaswani, A. (2017). Attention Is All You Need. NeurIPS.',
            label: 'verified',
            mapping_status: 'matched',
          }),
          makeVerdict({
            citation_id: 'v-res',
            numeric_index: 2,
            citation_raw: '[2] Official Python Docs. https://docs.python.org/3/',
            label: 'resource',
            mapping_status: 'matched',
            url_status: 'restricted_alive',
            url_status_code: 403,
            triggered_rules: ['R-URL-RESOURCE'],
          }),
          makeVerdict({
            citation_id: 'v-hallu',
            numeric_index: 3,
            citation_raw: '[3] Phantom, X. (2025). Nonexistent Paper Title.',
            label: 'suspected_hallucination',
            mapping_status: 'ambiguous_mapping',
            matched_sources: [],
            triggered_rules: ['R-ZERO-MATCH'],
          }),
          makeVerdict({
            citation_id: 'v-dup',
            numeric_index: 4,
            citation_raw: '[4] Duplicate Entry (2022). Same Paper.',
            label: 'verified',
            mapping_status: 'duplicate_reference',
          }),
          makeVerdict({
            citation_id: 'v-style',
            numeric_index: 5,
            citation_raw: '[5] Mixed Style Entry (2021). Another Paper.',
            label: 'verified',
            mapping_status: 'style_inconsistent',
          }),
        ],
      });
      vi.spyOn(api, 'getEssay').mockResolvedValue(mixedReport);

      // L2 IssuesPage: excludes valid web resource from actionable issues & provides direct Inspect Citation link
      const { container: l2Container, unmount: unmountL2 } = renderWithProviders(
        <Routes>
          <Route path="/verification/report/:id/issues" element={<IssuesPage />} />
        </Routes>,
        { user: makeUser('teacher', 'pro'), initialRoute: '/verification/report/401/issues' },
      );
      await waitFor(() =>
        expect(screen.getByTestId('decision-support-banner')).toBeDefined(),
      );
      expect(l2Container.textContent).not.toContain('Official Python Docs');
      expect(l2Container.textContent).toContain('Nonexistent Paper Title');
      const expandBtns = screen.getAllByLabelText('Expand details');
      fireEvent.click(expandBtns[0]);
      expect(screen.getByTestId('issue-inspect-citation-link').getAttribute('href')).toContain(
        '/verification/report/401?citation=v-hallu',
      );
      unmountL2();

      // L3 LogicTracePage: separates verified (3) from resource (1) and mounts DecisionSupportBanner
      const { container: l3Container, unmount: unmountL3 } = renderWithProviders(
        <Routes>
          <Route path="/verification/report/:id/trace" element={<LogicTracePage />} />
        </Routes>,
        { user: makeUser('teacher', 'pro'), initialRoute: '/verification/report/401/trace' },
      );
      await waitFor(() =>
        expect(screen.getByTestId('decision-support-banner')).toBeDefined(),
      );
      expect(l3Container.textContent).toContain('Web / Legal Source');
      expect(l3Container.textContent).not.toContain('symbolic_verifier.py');
      expect(l3Container.textContent).not.toContain('HTTP 403 OK');
      unmountL3();

      // L5 OrphanDetectionPage: All (5) renders ALL 5 cards (zero dropped duplicate/style entries) & ambiguous_mapping wears Ambiguous badge (not Missing Ref)
      const { container: l5Container, unmount: unmountL5 } = renderWithProviders(
        <Routes>
          <Route path="/verification/orphans/:id" element={<OrphanDetectionPage />} />
        </Routes>,
        { user: makeUser('teacher', 'pro'), initialRoute: '/verification/orphans/401' },
      );
      await waitFor(() =>
        expect(screen.getAllByTestId('consistency-entry-card')).toHaveLength(5),
      );
      expect(screen.getByTestId('decision-support-banner')).toBeDefined();
      const ambCard = l5Container.querySelector('[data-mapping-status="ambiguous_mapping"]');
      expect(ambCard?.textContent).toContain('Ambiguous');
      expect(ambCard?.textContent).not.toContain('No Reference');
      expect(l5Container.textContent).toContain('Duplicate Entry');
      expect(l5Container.textContent).toContain('Mixed Style Entry');
      unmountL5();
    });

    it('BUG-04/05/07/16/21: handles mobile detail sheet, unmatched Google Scholar + disabled Copy + neutral diff + 403 Restricted Access, EN scanned PDF N/A badge, and friendly 404', async () => {
      await i18n.changeLanguage('en');

      // 1. Friendly 404 error card (zero raw JSON)
      vi.spyOn(api, 'getEssay').mockRejectedValueOnce(
        new Error('API 404: {"detail":"Essay not found"}'),
      );
      const { container: errContainer, unmount: unmountErr } = renderWithProviders(
        <Routes>
          <Route path="/verification/report/:id" element={<EssayPage />} />
        </Routes>,
        { user: makeUser('teacher', 'pro'), initialRoute: '/verification/report/999999' },
      );
      await waitFor(() => expect(screen.getByTestId('essay-error-card')).toBeDefined());
      expect(errContainer.textContent).not.toContain('{"detail"');
      expect(errContainer.textContent).toContain('Report not found');
      unmountErr();

      // 2. Scanned PDF in EN -> English notice + N/A Not Scannable (never Vietnamese leak or 0.0% High Risk)
      vi.spyOn(api, 'getEssay').mockResolvedValueOnce(
        makeReport({
          essay_id: 402,
          filename: 'scanned_thesis.pdf',
          num_pages: 12,
          num_citations: 0,
          cis: {
            score: 0,
            is_unscannable: true,
            components: {},
            weights_used: {},
            num_citations: 0,
            num_unresolved: 0,
            disclaimer: '',
          } as never,
          document_diagnostics: {
            is_scanned_pdf: true,
            scanned_pages_count: 12,
            total_extractable_chars: 0,
            avg_chars_per_page: 0,
            warning_message: 'Cảnh báo tiếng Việt từ backend',
          },
          verdicts: [],
        }),
      );
      const { container: scanContainer, unmount: unmountScan } = renderWithProviders(
        <Routes>
          <Route path="/verification/report/:id" element={<EssayPage />} />
        </Routes>,
        { user: makeUser('teacher', 'pro'), initialRoute: '/verification/report/402' },
      );
      await waitFor(() =>
        expect(screen.getByTestId('scanned-pdf-guardrail-banner')).toBeDefined(),
      );
      expect(scanContainer.textContent).not.toContain('Cảnh báo tiếng Việt');
      expect(scanContainer.textContent).toContain('Not Scannable');
      unmountScan();

      // 3. Unmatched citation + restricted 403 + self-bridge + mobile detail sheet
      const originalMatchMedia = window.matchMedia;
      window.matchMedia = vi.fn().mockImplementation((query: string) => ({
        matches: query === '(max-width: 1023px)',
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }));
      try {
        vi.spyOn(api, 'getEssay').mockResolvedValueOnce(
          makeReport({
            essay_id: 403,
            verdicts: [
              makeVerdict({
                citation_id: 'v-unmatched',
                numeric_index: 1,
                citation_raw: '[1] Unknown, Z. (2025). Mystery Unindexed Study.',
                label: 'suspected_hallucination',
                matched_sources: [],
                mismatched_fields: ['title', 'authors', 'year'],
                url_status: 'restricted_alive',
                url_status_code: 403,
                features: {
                  bridged_concepts: ['SENTENCE-BERT ↔ SENTENCE-BERT'],
                },
              }),
            ],
          }),
        );
        const { container: mobContainer, unmount: unmountMob } = renderWithProviders(
          <Routes>
            <Route path="/verification/report/:id" element={<EssayPage />} />
          </Routes>,
          { user: makeUser('teacher', 'pro'), initialRoute: '/verification/report/403' },
        );
        await waitFor(() =>
          expect(mobContainer.querySelector('[data-citation-id="v-unmatched"]')).not.toBeNull(),
        );
        // Tap card on mobile -> opens Mobile Detail Sheet
        fireEvent.click(mobContainer.querySelector('[data-citation-id="v-unmatched"]')!);
        const sheet = await screen.findByTestId('mobile-citation-detail-sheet');
        expect(sheet.textContent).toContain('Search on Google Scholar');
        expect(sheet.textContent).toContain('Not matched');
        expect(sheet.textContent).not.toContain('HTTP 403 OK');
        expect(sheet.textContent).not.toContain('HTTP 403');
        expect(sheet.textContent).toContain('Restricted Access');
        expect(sheet.textContent).not.toContain('SENTENCE-BERT ↔ SENTENCE-BERT');
        const copyBtn = sheet.querySelector('button[disabled]');
        expect(copyBtn).not.toBeNull();
        unmountMob();
      } finally {
        window.matchMedia = originalMatchMedia;
      }
    });

    it('BUG-06/45/56: fixes local_db routing & Reimers surname parsing, DOCX inspector controls, and repeated venue deduplication', async () => {
      await i18n.changeLanguage('en');

      // BUG-06a: Surname parser handles initials cleanly ("N. Reimers and I. Gurevych" -> "Reimers & Gurevych", NEVER "N")
      const identity = extractCleanCitationIdentity(
        '[1] N. Reimers and I. Gurevych, "Sentence-BERT: Sentence Embeddings using Siamese BERT-Networks," EMNLP, 2019.',
        null,
      );
      expect(identity.authorOnly).toContain('Reimers');
      expect(identity.authorOnly).not.toBe('N');
      expect(identity.citedYear).toBe('2019');

      // BUG-06b: local_db routes to Local Scholarly Library (local_scholarly), NEVER vnlegal (Pháp luật · TCVN)
      const localDbVerdict = makeVerdict({
        citation_id: 'v-sbert',
        numeric_index: 1,
        citation_raw:
          '[1] N. Reimers and I. Gurevych, "Sentence-BERT: Sentence Embeddings using Siamese BERT-Networks," EMNLP, 2019.',
        label: 'verified',
        triggered_rules: ['R-LOCAL_DB_VERIFIED'],
        matched_sources: [
          {
            source: 'local_db',
            title: 'Sentence-BERT: Sentence Embeddings using Siamese BERT-Networks',
            authors: ['Nils Reimers', 'Iryna Gurevych'],
            year: '2019',
            venue: 'EMNLP',
            confidence: 0.99,
            matched_fields: ['title', 'authors', 'year'],
            checked_at: '2026-11-27T00:00:00Z',
          },
        ],
      });
      await i18n.changeLanguage('vi');
      const { unmount: unmountBoard } = renderWithProviders(
        <InteractiveDecisionFlowBoard verdict={localDbVerdict} />,
      );
      expect(screen.getByTestId('flow-sat-local_scholarly').getAttribute('data-matched')).toBe(
        'true',
      );
      expect(screen.getByTestId('flow-sat-vnlegal').getAttribute('data-matched')).toBe('false');
      expect(screen.getByTestId('flow-central-hub').textContent).toContain('Reimers');
      expect(screen.getByTestId('flow-central-hub').textContent).not.toContain('[1] N (2019)');
      unmountBoard();
      await i18n.changeLanguage('en');

      // BUG-45: DocumentInspectorPage shows Highlight Legend & DOCX Document Page Preview label
      vi.spyOn(api, 'getEssay').mockResolvedValueOnce(
        makeReport({
          essay_id: 405,
          filename: 'seminar_paper.docx',
          verdicts: [localDbVerdict],
        }),
      );
      const { unmount: unmountDocx } = renderWithProviders(
        <Routes>
          <Route path="/verification/inspector/:id" element={<DocumentInspectorPage />} />
        </Routes>,
        { user: makeUser('teacher', 'pro'), initialRoute: '/verification/inspector/405' },
      );
      await waitFor(() =>
        expect(screen.getByTestId('inspector-highlight-legend')).toBeDefined(),
      );
      expect(screen.getByTestId('toggle-pdf-page-preview').textContent).toContain(
        'Document Page Preview',
      );
      unmountDocx();

      // BUG-56: Repeated venue deduplication
      expect(deduplicateRepeatedVenue('He, K. (2016). ResNet. CVPR - CVPR.')).toBe(
        'He, K. (2016). ResNet. CVPR.',
      );
      expect(deduplicateRepeatedVenue('NeurIPS, NeurIPS 2020')).toBe('NeurIPS 2020');
    });

    it('Round 2 fixes: EssayPage CIS /100 & VI labels, IssuesPage 1-based markers & non-green certainty bar & linking filter, Vietnamese institutional authors, Remediation reasoning, LogicTrace KPI 100% sum, and OrphanPage real bibliography indices', async () => {
      // 1. P2-5: Vietnamese institutional authors & bare numeric fallback
      const bchIdentity = extractCleanCitationIdentity(
        '[1] Ban Chấp hành Trung ương (2024). Nghị quyết số 57-NQ/TW.',
      );
      expect(bchIdentity.authorOnly).toBe('Ban Chấp hành Trung ương');
      expect(bchIdentity.authorOnly).not.toBe('ương');
      expect(bchIdentity.authorOnly).not.toContain('et al.');

      const dcsIdentity = extractCleanCitationIdentity(
        '[2] Đảng Cộng sản Việt Nam (2021). Văn kiện Đại hội XIII.',
      );
      expect(dcsIdentity.authorOnly).toBe('Đảng Cộng sản Việt Nam');
      expect(dcsIdentity.authorOnly).not.toContain('Nam Đ.');

      const numericGarbageIdentity = extractCleanCitationIdentity(
        '[4] 4 (2025). Báo cáo chuyển đổi số quốc gia tại Việt Nam.',
      );
      expect(numericGarbageIdentity.authorOnly).not.toBe('4');
      expect(numericGarbageIdentity.shortHeader).not.toContain('[4] 4');

      // 2. P2-3 & P2-Teacher #1: EssayPage L1 CIS / 100, VI labels, no GROBID TEI-XML, uncited caption
      const r2Report = makeReport({
        essay_id: 502,
        filename: 'BaoCao_TDTU_2026.pdf',
        style_profile: {
          style: 'APA_LIKE',
          confidence: 0.9,
          apa_count: 5,
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
          num_citations: 5,
          num_unresolved: 1,
          disclaimer: '',
        },
        verdicts: [
          makeVerdict({
            citation_id: '765',
            numeric_index: null,
            citation_raw: 'Fake Author (2025). Fake Title. doi:10.9999/test.123',
            label: 'suspected_hallucination',
            confidence: 0.99,
            mapping_status: 'matched',
            reasoning:
              'DOI 10.9999/test.123 matches known fabricated DOI pattern. [Neural: content alignment score=0.52, intent=background, stance=neutral]',
            triggered_rules: ['R-FABRICATED-DOI', 'R-FAKE-URL'],
            mismatched_fields: ['title'],
            features: {
              content_alignment_score: 0.52,
              best_cited_sentence: 'Câu trích dẫn trong bài viết về chuyển đổi số.',
              best_evidence_sentence: 'Matched evidence passage from source paper.',
              best_evidence_score: 0.57,
            },
            matched_sources: [
              {
                source: 'crossref',
                title: 'Unrelated Source Title',
                authors: ['John Doe'],
                year: '2020',
                doi: '10.1000/other',
                confidence: 0.4,
                matched_fields: ['doi'],
                checked_at: '2026-11-27T00:00:00Z',
              },
            ],
          }),
          makeVerdict({
            citation_id: '766',
            numeric_index: null,
            citation_raw: 'Ban Chấp hành Trung ương (2024). Nghị quyết 57-NQ/TW. https://chinhphu.vn/nq57',
            label: 'verified',
            confidence: 0.95,
            mapping_status: 'uncited_reference',
            url_status: 'alive',
            url_status_code: 200,
            context: 'Đoạn thân bài nhắc tới chuyển đổi số quốc gia.',
            triggered_rules: ['R-VN-LEGAL-VERIFIED'],
            features: {
              context_source: 'implicit_body_discovery',
              content_alignment_score: 0.52,
              best_cited_sentence: 'Đoạn thân bài nhắc tới chuyển đổi số quốc gia.',
              best_evidence_sentence: 'Nghị quyết về đột phá phát triển khoa học công nghệ.',
              best_evidence_score: 0.57,
            },
          }),
          makeVerdict({
            citation_id: '767',
            numeric_index: null,
            citation_raw: 'Smith, J. (2022). Partial Mismatch Study.',
            label: 'metadata_error',
            confidence: 0.86,
            mapping_status: 'matched',
            mismatched_fields: ['year'],
            triggered_rules: ['R-SINGLE-SOURCE-PARTIAL'],
          }),
          makeVerdict({
            citation_id: '768',
            numeric_index: null,
            citation_raw: 'Local Report (2023). Unindexed Internal Document.',
            label: 'unresolved',
            confidence: 0.5,
            mapping_status: 'matched',
            matched_sources: [],
            triggered_rules: ['R-NO-CANDIDATE'],
          }),
          makeVerdict({
            citation_id: '769',
            numeric_index: null,
            citation_raw: 'VNExpress (2025). Bài viết báo chí. https://vnexpress.net/demo',
            label: 'resource',
            confidence: 0.9,
            mapping_status: 'uncited_reference',
            url_status: 'alive',
            url_status_code: 200,
            triggered_rules: ['R-URL-RESOURCE'],
          }),
        ],
      });

      vi.spyOn(api, 'getEssay').mockResolvedValue(r2Report);

      await i18n.changeLanguage('vi');
      const { container: essayContainer, unmount: unmountEssay } = renderWithProviders(
        <Routes>
          <Route path="/verification/report/:id" element={<EssayPage />} />
        </Routes>,
        { user: makeUser('teacher', 'ultra'), initialRoute: '/verification/report/502?citation=766' },
      );

      await waitFor(() => {
        expect(screen.getByTestId('report-cis-score-value').textContent).toContain('69.4 / 100');
        expect(
          essayContainer.querySelector('[data-citation-id="766"]')?.getAttribute('aria-selected'),
        ).toBe('true');
      });
      expect(screen.getByTestId('report-cis-score-value').textContent).not.toContain('%');
      expect(essayContainer.textContent).toContain('Gần chuẩn APA');
      expect(essayContainer.textContent).toContain('Liên kết hoạt động');
      expect(essayContainer.textContent).not.toContain('HTTP 200 OK');
      expect(essayContainer.textContent).not.toContain('GROBID TEI-XML');
      // Missing page_num must not fabricate a bogus "(tr. 1)"
      expect(essayContainer.textContent).not.toContain('(tr. 1)');
      expect(essayContainer.textContent).toContain(
        'Đoạn văn liên quan trong bài (chưa trích dẫn trực tiếp)',
      );
      // L1 summary omits raw ML telemetry suffixes
      expect(essayContainer.textContent).not.toContain('Neural = 0.52');
      expect(essayContainer.textContent).not.toContain('mức độ liên quan ngữ cảnh: 52%');

      // Select unresolved citation [4] (768) -> verifies short "— Chưa đối chiếu" badge without clipping
      const unresolvedCard = essayContainer.querySelector('[data-citation-id="768"]');
      expect(unresolvedCard).not.toBeNull();
      fireEvent.click(unresolvedCard!);
      await waitFor(() =>
        expect(essayContainer.textContent).toContain('— Chưa đối chiếu'),
      );
      expect(essayContainer.textContent).not.toContain('Chưa đối chiếu được');
      unmountEssay();

      // 3. P2-4: IssuesPage 1-based markers (no [765]), non-green certainty bar, plain-language checks, Liên kết trong bài bucket
      const { container: issuesContainer, unmount: unmountIssues } = renderWithProviders(
        <Routes>
          <Route path="/verification/issues/:id" element={<IssuesPage />} />
        </Routes>,
        { user: makeUser('teacher', 'ultra'), initialRoute: '/verification/issues/502' },
      );

      await waitFor(() =>
        expect(screen.getByTestId('issues-filter-linking')).toBeDefined(),
      );
      expect(issuesContainer.textContent).toContain('Liên kết trong bài');
      expect(issuesContainer.textContent).not.toContain('[765]');
      expect(issuesContainer.textContent).not.toContain('[769]');

      // Expand first error card ([1] Fake Author - suspected_hallucination): hides misleading certainty bar & raw rule IDs
      const expandButtons = screen.getAllByLabelText(/Mở rộng chi tiết/i);
      expect(expandButtons.length).toBeGreaterThan(1);
      fireEvent.click(expandButtons[0]);

      await waitFor(() =>
        expect(screen.getByTestId('issue-source-candidate-badge')).toBeDefined(),
      );
      expect(screen.queryByTestId('issue-analysis-certainty')).toBeNull();
      expect(issuesContainer.textContent).not.toContain('R-FABRICATED-DOI');

      // Expand metadata_error card ([3] Smith) -> shows non-green amber match certainty bar
      fireEvent.click(expandButtons[1]);
      const certaintyEl = await screen.findByTestId('issue-analysis-certainty');
      expect(certaintyEl.textContent).toContain('Độ khớp đối chiếu');
      // Must NOT use green bg-emerald-500 progress bar on error cards!
      expect(certaintyEl.innerHTML).not.toContain('bg-emerald-500');
      unmountIssues();

      // 4. P3: LogicTracePage plain labels + KPI cards summing to 100% of Total
      const { container: traceContainer, unmount: unmountTrace } = renderWithProviders(
        <Routes>
          <Route path="/verification/trace/:id" element={<LogicTracePage />} />
        </Routes>,
        { user: makeUser('teacher', 'ultra'), initialRoute: '/verification/trace/502' },
      );

      await waitFor(() =>
        expect(screen.getByTestId('trace-kpi-unresolved')).toBeDefined(),
      );
      expect(screen.getByTestId('trace-kpi-resource')).toBeDefined();
      // Expand citation [1] (Fake Author, confidence 0.99) to inspect NeuralAlignmentPanel labels
      const fakeTraceBtn = Array.from(traceContainer.querySelectorAll('button')).find((b) =>
        b.textContent?.includes('Fake Title'),
      );
      expect(fakeTraceBtn).toBeDefined();
      fireEvent.click(fakeTraceBtn!);
      await waitFor(() =>
        expect(screen.getByTestId('trace-manuscript-passage-label').textContent).toContain(
          'Câu trong bài viết · Khớp 52%',
        ),
      );
      expect(screen.getByTestId('trace-source-passage-label').textContent).toContain(
        'Đoạn trích từ tài liệu gần giống (chưa xác nhận) · 57%',
      );
      expect(screen.getByTestId('trace-source-passage-label').className).toContain('text-amber-700');
      const neuralPanel = screen.getByTestId('neural-alignment-panel');
      expect(neuralPanel.textContent).not.toContain('(Manuscript Claim)');
      expect(neuralPanel.textContent).not.toContain('(Source Evidence)');
      expect(neuralPanel.textContent).not.toContain('align=');
      expect(neuralPanel.textContent).not.toContain('sim=');
      expect(traceContainer.textContent).not.toContain('(Manuscript Claim)');
      unmountTrace();

      // 5. P3: OrphanDetectionPage uses real 1-based bibliography index (no duplicate [1], [2] across uncited & matched)
      const { unmount: unmountOrphan } = renderWithProviders(
        <Routes>
          <Route path="/verification/consistency/:id" element={<OrphanDetectionPage />} />
        </Routes>,
        { user: makeUser('teacher', 'ultra'), initialRoute: '/verification/consistency/502' },
      );

      await waitFor(() =>
        expect(screen.getAllByTestId('consistency-entry-card').length).toBe(5),
      );
      const uncitedCards = screen
        .getAllByTestId('consistency-entry-card')
        .filter((el) => el.getAttribute('data-mapping-status') === 'uncited_reference');
      const matchedCards = screen
        .getAllByTestId('consistency-entry-card')
        .filter((el) => el.getAttribute('data-mapping-status') === 'matched');
      const uncitedMarkers = uncitedCards.map((c) => c.textContent?.match(/\[\d+\]/)?.[0]);
      const matchedMarkers = matchedCards.map((c) => c.textContent?.match(/\[\d+\]/)?.[0]);
      // Uncited entries are at bibliography positions [2] and [5]; matched are at [1], [3], [4]
      expect(uncitedMarkers).toEqual(['[2]', '[5]']);
      expect(matchedMarkers).toEqual(['[1]', '[3]', '[4]']);
      unmountOrphan();

      // 6. P2-7: BibliographyRemediationModal sanitizes EN reasoning & strips [Neural: ...]
      vi.spyOn(api, 'getRemediatedBibliography').mockResolvedValueOnce({
        essay_id: 502,
        style: 'apa',
        total_entries: 1,
        remediated_count: 0,
        hallucination_count: 1,
        error_count: 0,
        entries: [
          {
            index: 1,
            verdict_id: '765',
            label: 'suspected_hallucination',
            remediation_status: 'hallucination',
            is_hallucination: true,
            triggered_rules: ['R-FABRICATED-DOI'],
            reasoning:
              'DOI 10.9999/test.123 matches known fabricated DOI pattern [Neural: content alignment score=0.41, intent=background]',
            source_used: null,
            original_raw: '[1] Fake Author (2025). Fake Title. doi:10.9999/test.123',
            remediated_text: '[1] Fake Author (2025). Fake Title.',
            apa: 'Fake Author (2025). Fake Title.',
            ieee: '[1] Fake Author, "Fake Title," 2025.',
            tdtu: 'Fake Author (2025), Fake Title.',
            bibtex: '',
            ris: '',
            diff_fields: [],
            was_modified: false,
            canonical_metadata: {
              title: 'Fake Title',
              authors: ['Fake Author'],
              year: '2025',
              venue: '',
              doi: '10.9999/test.123',
              url: '',
            },
          },
        ],
        combined_text: '[1] Fake Author (2025). Fake Title.',
        combined_bibtex: '',
        combined_ris: '',
      });

      const { unmount: unmountModal } = renderWithProviders(
        <BibliographyRemediationModal
          essayId={502}
          filename="BaoCao_TDTU_2026.pdf"
          lang="vi"
          open={true}
          onClose={() => {}}
        />,
        { user: makeUser('teacher', 'ultra') },
      );

      await waitFor(() =>
        expect(document.body.textContent).toContain('tiền tố thử nghiệm/không hợp lệ'),
      );
      expect(document.body.textContent).not.toContain('fabricated DOI pattern');
      expect(document.body.textContent).not.toContain('[Neural:');
      unmountModal();
    });

    it('Round 3 [P2-R2-2/3 & P3-R2-2/4/5]: preserves Vietnamese institutional authors in EssayPage L1 & table, fixes R44 [4] title-sentence/year in Network, scrubs HTTP 200 OK, and unifies Revision Diff VI labels', async () => {
      // 1. [P2-R2-3] R44 ref [4] must NEVER become "mới et al. (2021)"
      const r44Ref4Raw =
        '4. Nghiên cứu đề xuất đổi mới và hoàn thiện thể chế phát triển khoa học - công nghệ và đổi mới sáng tạo ở Việt Nam giai đoạn 2021 - 2030. https://vista.gov.vn, ngày 25/12/2025.';
      const r44Identity = extractCleanCitationIdentity(
        r44Ref4Raw,
        {
          authors: ['Phạm Thị Thúy Vân'],
          title: 'Unrelated Crossref Candidate',
          year: '2025',
        },
        { citedYear: '2025', citedAuthors: [] },
      );
      expect(r44Identity.citedYear).toBe('2025');
      expect(r44Identity.authorOnly).toBe('Nghiên cứu đề xuất đổi mới…');
      expect(r44Identity.shortHeader).toBe('Nghiên cứu đề xuất đổi mới… (2025)');
      expect(r44Identity.shortHeader).not.toContain('mới et al.');
      expect(r44Identity.shortHeader).not.toContain('2021');

      // Also without explicit options (pure raw-text parse)
      const r44IdentityRawOnly = extractCleanCitationIdentity(r44Ref4Raw, null);
      expect(r44IdentityRawOnly.citedYear).toBe('2025');
      expect(r44IdentityRawOnly.authorOnly).toBe('Nghiên cứu đề xuất đổi mới…');

      // 2. [P3-R2-2 & P3-R2-5] InteractiveDecisionFlowBoard scrubs (HTTP 200 OK) & uses Văn bản pháp luật in VI
      const liveLegalVerdict = makeVerdict({
        citation_id: 'r44-v1',
        numeric_index: 1,
        citation_raw:
          '1. Ban Chấp hành Trung ương (2024). Nghị quyết số 57-NQ/TƯ ngày 22/12/2024. https://chinhphu.vn/nq57',
        label: 'resource',
        confidence: 0.98,
        url_status: 'alive',
        url_status_code: 200,
        triggered_rules: ['R-LEGAL-DOCUMENT'],
      });
      await i18n.changeLanguage('vi');
      const { unmount: unmountFlowVi } = renderWithProviders(
        <InteractiveDecisionFlowBoard verdict={liveLegalVerdict} />,
      );
      const storyVi = screen.getByTestId('flow-story-card').textContent ?? '';
      expect(storyVi).toContain('Liên kết trang web đang hoạt động.');
      expect(storyVi).not.toContain('HTTP 200 OK');
      expect(storyVi).toContain('Văn bản pháp luật');
      unmountFlowVi();

      await i18n.changeLanguage('en');
      const { unmount: unmountFlowEn } = renderWithProviders(
        <InteractiveDecisionFlowBoard verdict={liveLegalVerdict} />,
      );
      const storyEn = screen.getByTestId('flow-story-card').textContent ?? '';
      expect(storyEn).toContain('The cited link is active.');
      expect(storyEn).not.toContain('HTTP 200 OK');
      unmountFlowEn();

      // 3. [P2-R2-2 & P3-R2-4] EssayPage R44 + R25 real DB shapes + VI Revision Diff labels + OpenAlex candidate card
      const r44R25Report = makeReport({
        essay_id: 544,
        filename: 'R44_R25_Institutional_Audit.pdf',
        references: [
          {
            id: 1,
            reference_id: 'ref-0001',
            numeric_index: 1,
            raw_text:
              '1. Ban Chấp hành Trung ương (2024). Nghị quyết số 57-NQ/TƯ về đột phá khoa học công nghệ.',
            citation_type: 'reference_list',
            authors: [
              'Ban Chấp Hành Trung Ương',
              'Bộ Chính Trị',
              'Nghị Quyết Số 57-nq/tư',
              'Nghị Quyết 57-nq/tư',
            ],
            year: '2024',
            title: 'Nghị quyết số 57-NQ/TƯ về đột phá khoa học công nghệ',
            venue: null,
            doi: null,
            url: null,
            confidence: 1,
          },
          {
            id: 2,
            reference_id: 'ref-0002',
            numeric_index: 2,
            raw_text:
              '2. Đảng Cộng sản Việt Nam (2021). Văn kiện Đại hội đại biểu toàn quốc lần thứ XIII.',
            citation_type: 'reference_list',
            authors: ['Nam Đ. C. V.'],
            year: '2021',
            title: 'Văn kiện Đại hội đại biểu toàn quốc lần thứ XIII',
            venue: 'NXB Chính trị quốc gia Sự thật',
            doi: null,
            url: null,
            confidence: 1,
          },
          {
            id: 3,
            reference_id: 'ref-0003',
            numeric_index: 3,
            raw_text:
              '3. Chính phủ. (2023). Nghị định số 13/2023/NĐ-CP ngày 17/04/2023 về bảo vệ dữ liệu cá nhân.',
            citation_type: 'reference_list',
            authors: ['chính phủ', 'nghị định số 13/2023/nđ-cp', 'nghị định 13/2023/nđ-cp'],
            year: '2023',
            title: 'Nghị định số 13/2023/NĐ-CP ngày 17/04/2023 về bảo vệ dữ liệu cá nhân',
            venue: null,
            doi: null,
            url: null,
            confidence: 1,
          },
          {
            id: 4,
            reference_id: 'ref-0004',
            numeric_index: 4,
            raw_text:
              '4. Vaswani, A., Shazeer, N., Parmar, N. (2017). Attention Is All You Need. NeurIPS.',
            citation_type: 'reference_list',
            authors: ['vaswani A.', 'shazeer N.', 'parmar N.'],
            year: '2017',
            title: 'Attention Is All You Need',
            venue: 'NeurIPS',
            doi: null,
            url: null,
            confidence: 1,
          },
        ] as never,
        verdicts: [
          makeVerdict({
            citation_id: 'r44-1',
            numeric_index: 1,
            citation_raw:
              '1. Ban Chấp hành Trung ương (2024). Nghị quyết số 57-NQ/TƯ về đột phá khoa học công nghệ.',
            label: 'resource',
            triggered_rules: ['R-LEGAL-DOCUMENT'],
            citation_link: { occurrence_id: 'r44-1', reference_id: 'ref-0001', method: 'exact', confidence: 1 },
          }),
          makeVerdict({
            citation_id: 'r44-2',
            numeric_index: 2,
            citation_raw:
              '2. Đảng Cộng sản Việt Nam (2021). Văn kiện Đại hội đại biểu toàn quốc lần thứ XIII.',
            label: 'verified',
            citation_link: { occurrence_id: 'r44-2', reference_id: 'ref-0002', method: 'exact', confidence: 1 },
          }),
          makeVerdict({
            citation_id: 'r25-3',
            numeric_index: 3,
            citation_raw:
              '3. Chính phủ. (2023). Nghị định số 13/2023/NĐ-CP ngày 17/04/2023 về bảo vệ dữ liệu cá nhân.',
            label: 'resource',
            triggered_rules: ['R-LEGAL-DOCUMENT'],
            citation_link: { occurrence_id: 'r25-3', reference_id: 'ref-0003', method: 'exact', confidence: 1 },
          }),
          makeVerdict({
            citation_id: 'r25-4',
            numeric_index: 4,
            citation_raw:
              '4. Vaswani, A., Shazeer, N., Parmar, N. (2017). Attention Is All You Need. NeurIPS.',
            label: 'suspected_hallucination',
            citation_link: { occurrence_id: 'r25-4', reference_id: 'ref-0004', method: 'exact', confidence: 1 },
            matched_sources: [
              {
                source: 'openalex',
                title: 'Attention Is All You Need',
                authors: ['Ashish Vaswani'],
                year: '2017',
                confidence: 0.45,
                matched_fields: ['title'],
                checked_at: '2026-11-27T00:00:00Z',
              },
            ],
          }),
        ],
        revision_diff: {
          has_previous_revision: true,
          is_same_manuscript_family: true,
          previous_essay_id: 543,
          current_essay_id: 544,
          previous_filename: 'R44_v1.pdf',
          current_filename: 'R44_R25_Institutional_Audit.pdf',
          cis_before: 70.0,
          cis_after: 82.0,
          cis_delta: 12.0,
          resolved_issues_count: 2,
          new_issues_count: 0,
          counts_before: {
            total: 4,
            verified: 1,
            metadata_error: 2,
            suspected_hallucination: 1,
            unresolved: 1,
          },
          counts_after: {
            total: 4,
            verified: 2,
            metadata_error: 1,
            suspected_hallucination: 1,
            unresolved: 0,
          },
          citation_changes: [],
        },
      });
      vi.spyOn(api, 'getEssay').mockResolvedValueOnce(r44R25Report);

      await i18n.changeLanguage('vi');
      const { container } = renderWithProviders(
        <Routes>
          <Route path="/verification/report/:id" element={<EssayPage />} />
        </Routes>,
        { user: makeUser('teacher', 'ultra'), initialRoute: '/verification/report/544?citation=r44-2' },
      );

      await waitFor(() => {
        expect(screen.getByTestId('revision-diff-banner')).toBeDefined();
        expect(
          container.querySelector('[data-citation-id="r44-2"]')?.getAttribute('aria-selected'),
        ).toBe('true');
      });

      // Unified VI Revision Diff labels
      const revBannerText = screen.getByTestId('revision-diff-banner').textContent ?? '';
      expect(revBannerText).toContain('Sai lệch thông tin:');
      expect(revBannerText).toContain('Chưa đủ dữ liệu:');
      expect(revBannerText).not.toContain('Sai thông tin:');
      expect(revBannerText).not.toContain('Chưa rõ:');

      // L1 queue cards & Field Comparison Table preserve Vietnamese institutional authors cleanly
      const listboxText = container.querySelector('[role="listbox"]')?.textContent ?? '';
      expect(listboxText).toContain('Ban Chấp hành Trung ương (2024)');
      expect(listboxText).not.toContain('Ban Chấp Hành Trung Ương et al.');
      expect(listboxText).toContain('Đảng Cộng sản Việt Nam (2021)');
      expect(listboxText).not.toContain('[2]Nam (2021)');
      expect(listboxText).toContain('Chính phủ (2023)');
      expect(listboxText).not.toContain('chính phủ et al.');
      expect(listboxText).toContain('Vaswani et al. (2017)');
      expect(listboxText).not.toContain('vaswani et al.');

      // Active citation r44-2 Field Comparison Table Tác giả cell must NOT show "Nam Đ. C. V."
      const tableText = container.querySelector('table')?.textContent ?? '';
      expect(tableText).toContain('Đảng Cộng sản Việt Nam');
      expect(tableText).not.toContain('Nam Đ. C. V.');

      // Open candidate card in 1. Nguồn đối chiếu for r25-4 -> OpenAlex must NOT carry truncate
      const r25Card = container.querySelector('[data-citation-id="r25-4"]');
      fireEvent.click(r25Card!);
      fireEvent.click(screen.getByTestId('deep-verification-drawer-toggle'));
      const openAlexCard = await waitFor(() => {
        const cards = screen.getAllByTestId('deep-source-card');
        const found = cards.find((c) => c.textContent?.includes('OpenAlex'));
        expect(found).toBeDefined();
        return found!;
      });
      expect(openAlexCard.className).toContain('sm:col-span-2');
      const titleP = openAlexCard.querySelector('p');
      expect(titleP?.className).not.toContain('truncate');
    });
  });
});
