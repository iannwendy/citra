import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Routes, Route } from 'react-router-dom';
import { api } from '@/api/client';
import i18n from '@/i18n';
import { renderWithProviders, makeUser, screen, waitFor } from '@/test-utils';
import { makeReport, makeVerdict } from '@/test-fixtures';
import { EssayPage } from './EssayPage';

function getDiffRowStatusText(container: HTMLElement, fieldLabel: string): string {
  const rows = Array.from(container.querySelectorAll('table tbody tr'));
  const targetRow = rows.find((tr) => {
    const firstSpan = tr.querySelector('td > span');
    return (firstSpan?.textContent ?? '').replace(/\s+/g, ' ').trim() === fieldLabel;
  });
  expect(targetRow, `Expected row "${fieldLabel}" in diff table`).toBeTruthy();
  const cells = targetRow!.querySelectorAll('td');
  return (cells[cells.length - 1]?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

describe('EssayPage Metadata Diff Table Accuracy (Regression for essay_02_mixed.pdf)', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await i18n.changeLanguage('en');
  });

  it('never reports 100% Match or Checked when Venue, DOI, and DOI-URL conflict on an unresolved candidate (even with stale matched_fields)', async () => {
    const rawText =
      'Smith, J. Q., & Doe, R. K. (2024). A novel framework for hallucination detection in large language models. Journal of Imaginary AI Research, 99(12), 1-25. https://doi.org/10.9999/jiar.2024.9999';
    const report = makeReport({
      essay_id: 902,
      references: [
        {
          id: 4,
          reference_id: 'ref-4',
          raw_text: rawText,
          citation_type: 'reference_list',
          style: 'apa',
          authors: ['Smith, J. Q.', 'Doe, R. K.'],
          year: '2024',
          title: 'A novel framework for hallucination detection in large language models',
          venue: 'Journal of Imaginary AI Research',
          doi: '10.9999/jiar.2024.9999',
          url: null,
          page_num: 2,
          cited_on_pages: [1],
          confidence: 1.0,
        },
      ],
      verdicts: [
        makeVerdict({
          citation_id: 'cit-mixed-4',
          citation_raw: rawText,
          label: 'unresolved',
          confidence: 0.25,
          triggered_rules: ['R-ABSTENTION-BORDER', 'R-DOI-CONFLICT'],
          mismatched_fields: [],
          matched_sources: [
            {
              source: 'openalex',
              title: 'Fine-grained Hallucination Detection and Editing for Language Models',
              authors: [
                'Abhika Mishra',
                'Akari Asai',
                'Vidhisha Balachandran',
                'Yizhong Wang',
                'Graham Neubig',
                'Yulia Tsvetkov',
                'Hannaneh Hajishirzi',
              ],
              year: '2024',
              venue: 'arXiv (Cornell University)',
              doi: '10.48550/arxiv.2401.06855',
              url: 'https://openalex.org/W4391013695',
              confidence: 0.84,
              // Even if cached DB rows had stale existence-based matched_fields:
              matched_fields: ['doi', 'title', 'authors', 'year', 'venue'],
              checked_at: '2026-11-15T00:00:00Z',
            },
          ],
          features: {
            title_sim_fuzzy: 0.783,
            title_sim_semantic: 0.839,
            author_jaccard: 0.0,
            year_distance: 0,
            doi_exact_match: false,
            source_consensus: 1,
            venue_sim: 0.0,
          },
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
        initialRoute: '/verification/report/902',
      },
    );

    await waitFor(() =>
      expect(
        screen.getAllByText(/Journal of Imaginary AI Research/).length,
      ).toBeGreaterThan(0),
    );

    expect(getDiffRowStatusText(container, 'Title')).toContain('84% Sim');
    expect(getDiffRowStatusText(container, 'Authors')).toContain('Diff');
    expect(getDiffRowStatusText(container, 'Year')).toContain('100% Match');

    const venueStatus = getDiffRowStatusText(container, 'Venue');
    expect(venueStatus).not.toContain('100% Match');
    expect(venueStatus).toContain('Diff');

    const doiStatus = getDiffRowStatusText(container, 'DOI');
    expect(doiStatus).not.toContain('100% Match');
    expect(doiStatus).not.toContain('Missing');
    expect(doiStatus).toContain('Diff');

    const urlStatus = getDiffRowStatusText(container, 'URL / Link');
    expect(urlStatus).not.toContain('Checked');
    expect(urlStatus).not.toContain('Verified Link');
    expect(urlStatus).toMatch(/Broken Link|Diff/);
  });

  it('marks synthesized DOI URL as Broken Link / Diff (not Checked) on suspected_hallucination', async () => {
    const rawText =
      'Smith, J. Q., & Doe, R. K. (2024). A novel framework for hallucination detection in large language models. Journal of Imaginary AI Research, 99(12), 1-25. https://doi.org/10.9999/jiar.2024.9999';
    const report = makeReport({
      essay_id: 903,
      references: [
        {
          id: 5,
          reference_id: 'ref-fab',
          raw_text: rawText,
          citation_type: 'reference_list',
          style: 'apa',
          authors: ['Smith, J. Q.', 'Doe, R. K.'],
          year: '2024',
          title: 'A novel framework for hallucination detection in large language models',
          venue: 'Journal of Imaginary AI Research',
          doi: '10.9999/jiar.2024.9999',
          url: null,
          page_num: 2,
          cited_on_pages: [1],
          confidence: 1.0,
        },
      ],
      verdicts: [
        makeVerdict({
          citation_id: 'cit-fab-1',
          citation_raw: rawText,
          label: 'suspected_hallucination',
          confidence: 0.9,
          triggered_rules: ['R-FABRICATED-DOI'],
          mismatched_fields: ['doi'],
          matched_sources: [],
          features: {
            title_sim_fuzzy: 0.0,
            title_sim_semantic: 0.0,
            author_jaccard: 0.0,
            year_distance: 999,
            doi_exact_match: false,
            source_consensus: 0,
            venue_sim: 0.0,
          },
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
        initialRoute: '/verification/report/903',
      },
    );

    await waitFor(() =>
      expect(
        screen.getAllByText(/Journal of Imaginary AI Research/).length,
      ).toBeGreaterThan(0),
    );

    const urlStatus = getDiffRowStatusText(container, 'URL / Link');
    expect(urlStatus).not.toContain('Checked');
    expect(urlStatus).toMatch(/Broken Link|Diff/);
  });

  it('displays Preprint (not 100% Match) when a verified paper cites conference venue against retrieved arXiv record', async () => {
    const rawText =
      'Vaswani, A., et al. (2017). Attention is all you need. Advances in Neural Information Processing Systems, 30.';
    const report = makeReport({
      essay_id: 904,
      references: [
        {
          id: 1,
          reference_id: 'ref-vaswani',
          raw_text: rawText,
          citation_type: 'reference_list',
          style: 'apa',
          authors: ['Vaswani, A.'],
          year: '2017',
          title: 'Attention is all you need',
          venue: 'Advances in Neural Information Processing Systems',
          doi: null,
          url: null,
          page_num: 2,
          cited_on_pages: [1],
          confidence: 1.0,
        },
      ],
      verdicts: [
        makeVerdict({
          citation_id: 'cit-vaswani',
          citation_raw: rawText,
          label: 'verified',
          confidence: 0.92,
          triggered_rules: ['R-CONSENSUS-FULL'],
          mismatched_fields: [],
          matched_sources: [
            {
              source: 'openalex',
              title: 'Attention Is All You Need',
              authors: ['Ashish Vaswani', 'Noam Shazeer'],
              year: '2017',
              venue: 'arXiv (Cornell University)',
              doi: '10.48550/arxiv.1706.03762',
              url: 'https://openalex.org/W2626778328',
              confidence: 0.95,
              matched_fields: ['title', 'authors', 'year'],
              checked_at: '2026-11-15T00:00:00Z',
            },
          ],
          features: {
            title_sim_fuzzy: 1.0,
            title_sim_semantic: 1.0,
            author_jaccard: 1.0,
            year_distance: 0,
            doi_exact_match: false,
            source_consensus: 2,
            venue_sim: 0.0,
          },
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
        initialRoute: '/verification/report/904',
      },
    );

    await waitFor(() =>
      expect(
        screen.getAllByText(/Advances in Neural Information Processing Systems/).length,
      ).toBeGreaterThan(0),
    );

    const venueStatus = getDiffRowStatusText(container, 'Venue');
    expect(venueStatus).not.toContain('100% Match');
    expect(venueStatus).not.toContain('Diff');
    expect(venueStatus).toContain('Preprint');
  });

  it('EvidenceGraph marks suspected_hallucination partial-overlap candidates as warning (never green success)', async () => {
    const { buildEvidenceGraph } = await import(
      '@/components/CitationGraph/EvidenceGraph'
    );
    const hallucVerdict = makeVerdict({
      citation_id: 'cit-halluc-graph',
      citation_raw:
        'Smith, J. Q., & Doe, R. K. (2024). A novel framework for hallucination detection. https://doi.org/10.9999/jiar.2024.9999',
      label: 'suspected_hallucination',
      confidence: 0.92,
      triggered_rules: ['R-NONEXISTENT-DOI', 'R-DOI-CONFLICT'],
      mismatched_fields: ['doi', 'title', 'author'],
      matched_sources: [
        {
          source: 'openalex',
          title: 'Fine-grained Hallucination Detection and Editing for Language Models',
          year: '2024',
          matched_fields: ['year'],
          checked_at: '2026-11-15T00:00:00Z',
        },
      ],
    });
    const { graph } = buildEvidenceGraph(hallucVerdict, 'en');
    const sourcesNode = graph.children!.find((c) => c.id === 'sources')!;
    expect(sourcesNode.status).not.toBe('success');
    expect(sourcesNode.status).toBe('warning');
    const oaNode = sourcesNode.children!.find((c) => c.id.startsWith('openalex'))!;
    expect(oaNode.status).toBe('warning');
  });
});
