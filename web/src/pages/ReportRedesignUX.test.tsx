import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Routes, Route } from 'react-router-dom';
import { api } from '@/api/client';
import i18n from '@/i18n';
import { renderWithProviders, makeUser, screen, fireEvent, waitFor } from '@/test-utils';
import { makeReport, makeVerdict } from '@/test-fixtures';
import { EssayHeader } from './essay/EssayHeader';
import { EssayActionBar } from './essay/EssayActionBar';
import { EssayPage } from './EssayPage';

describe('Report Page UI/UX Redesign (Non-Tech Clarity & Progressive Disclosure)', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await i18n.changeLanguage('vi');
  });

  describe('Task 1: Compact Document Header (EssayHeader)', () => {
    it('eliminates VERIFICATION REPORT IDE / ID# / EXPORT AUDIT ARTIFACT clutter and clarifies references vs in-text mentions', () => {
      const { container } = renderWithProviders(
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

      const summary = screen.getByTestId('header-citation-summary');
      expect(summary.textContent).toContain('53 tài liệu tham khảo');
      expect(summary.textContent).toContain('115 lượt trích trong bài');
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
});
