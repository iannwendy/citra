import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Routes, Route } from 'react-router-dom';
import { api } from '@/api/client';
import i18n from '@/i18n';
import {
  renderWithProviders,
  makeUser,
  screen,
  fireEvent,
  waitFor,
} from '@/test-utils';
import { makeReport, makeVerdict } from '@/test-fixtures';
import { EssayPage } from './EssayPage';
import { LogicTracePage } from './LogicTracePage';
import { DocumentInspectorPage } from './DocumentInspectorPage';
import { SharedReportPage } from './SharedReportPage';
import { CitationGraphView } from '@/components/CitationGraph/CitationGraphView';
import {
  EvidenceGraph,
  buildEvidenceGraph,
} from '@/components/CitationGraph/EvidenceGraph';

describe('v3.70.0 Groups 5 & 6: Cross-Lingual ONNX INT8 UI, RevisionDiff Polarity, Diagnostics & CitationGraph Overhaul', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await i18n.changeLanguage('en');
  });

  it('EssayPage renders ONNX INT8 Cross-Lingual callout when bridged_concepts is [] and uses cross_lingual_title_sim (84%) instead of title_sim_fuzzy (11%)', async () => {
    const crossLingualVerdict = makeVerdict({
      citation_id: 'cit-xl-onnx',
      numeric_index: 3,
      citation_raw:
        '[3] Vaswani, A. et al. (2017). Chú ý là tất cả những gì bạn cần. NeurIPS.',
      label: 'metadata_error',
      confidence: 0.84,
      triggered_rules: ['R-CROSS-LINGUAL-TITLE-MATCH'],
      mismatched_fields: ['title'],
      matched_sources: [
        {
          source: 'openalex',
          title: 'Attention Is All You Need',
          authors: ['Ashish Vaswani'],
          year: '2017',
          venue: 'NeurIPS',
          doi: '10.48550/arXiv.1706.03762',
          confidence: 0.84,
          matched_fields: ['authors', 'year', 'venue'],
          checked_at: '2026-11-14T00:00:00Z',
        },
      ],
      features: {
        title_sim_fuzzy: 0.11,
        title_sim_semantic: 0.22,
        cross_lingual_title_detected: true,
        cross_lingual_title_sim: 0.84,
        bridged_concepts: [],
        author_jaccard: 1.0,
        year_distance: 0,
      },
    });

    vi.spyOn(api, 'getEssay').mockResolvedValue(
      makeReport({
        essay_id: 3701,
        verdicts: [crossLingualVerdict],
      }),
    );

    const { container, unmount } = renderWithProviders(
      <Routes>
        <Route path="/verification/report/:id" element={<EssayPage />} />
      </Routes>,
      {
        user: makeUser('teacher', 'pro'),
        initialRoute: '/verification/report/3701',
      },
    );

    await waitFor(() =>
      expect(screen.getByTestId('essay-bridged-concepts')).toBeDefined(),
    );

    const bridgeBox = screen.getByTestId('essay-bridged-concepts');
    expect(bridgeBox.textContent).toContain('VI → EN');
    expect(bridgeBox.textContent).toContain(
      'Multilingual ONNX INT8 Embedding Match (paraphrase-multilingual-MiniLM-L12-v2)',
    );
    expect(bridgeBox.textContent).toContain('84%');

    // Title similarity in Metadata Diff table must show 84% Sim, NEVER 11% Sim
    const diffTableText = container.querySelector('table')?.textContent ?? '';
    expect(diffTableText).toContain('84% Sim');
    expect(diffTableText).not.toContain('11% Sim');
    expect(container.textContent).toContain('0.84');
    expect(container.textContent).not.toContain('title similarity = 0.11');
    unmount();

    // Verify Vietnamese localization of the ONNX INT8 callout
    await i18n.changeLanguage('vi');
    renderWithProviders(
      <Routes>
        <Route path="/verification/report/:id" element={<EssayPage />} />
      </Routes>,
      {
        user: makeUser('teacher', 'pro'),
        initialRoute: '/verification/report/3701',
      },
    );

    await waitFor(() =>
      expect(screen.getByTestId('essay-onnx-cross-lingual-badge')).toBeDefined(),
    );
    expect(screen.getByTestId('essay-onnx-cross-lingual-badge').textContent).toContain(
      'Đối sánh ngữ nghĩa đa ngôn ngữ ONNX INT8',
    );
    expect(screen.getByTestId('essay-onnx-cross-lingual-badge').textContent).toContain(
      '84%',
    );
  });

  it('EssayPage renders THEN SUSPECTED_HALLUCINATION for R-CHIMERIC-DOI-MISMATCH and localizes Tab 3 Source Retrieval in VI & EN', async () => {
    const chimericVerdict = makeVerdict({
      citation_id: 'cit-chimeric',
      citation_raw:
        '[1] Fake Author (2024). Fabricated Title With Real DOI. https://doi.org/10.1038/s41586-021-03819-2',
      label: 'suspected_hallucination',
      confidence: 0.93,
      triggered_rules: ['R-CHIMERIC-DOI-MISMATCH', 'R-DOI-CONFLICT'],
      mismatched_fields: ['title', 'authors'],
      matched_sources: [
        {
          source: 'crossref',
          title: 'Highly accurate protein structure prediction with AlphaFold',
          authors: ['John Jumper'],
          year: '2021',
          doi: '10.1038/s41586-021-03819-2',
          confidence: 0.88,
          matched_fields: ['doi'],
          checked_at: '2026-11-14T00:00:00Z',
        },
      ],
    });
    const unroutedWebVerdict = makeVerdict({
      citation_id: 'cit-web-unrouted',
      citation_raw: '[2] MDN Web Docs (2025). HTTP Status Codes. https://developer.mozilla.org',
      label: 'resource',
      confidence: 0.92,
      triggered_rules: ['R-URL-RESOURCE'],
      matched_sources: [],
      url_status: 'alive',
      url_status_code: 200,
      features: {
        has_scholarly_candidate: false,
      },
    });

    vi.spyOn(api, 'getEssay').mockResolvedValue(
      makeReport({
        essay_id: 3702,
        verdicts: [chimericVerdict, unroutedWebVerdict],
      }),
    );

    const { container, unmount } = renderWithProviders(
      <Routes>
        <Route path="/verification/report/:id" element={<EssayPage />} />
      </Routes>,
      {
        user: makeUser('teacher', 'pro'),
        initialRoute: '/verification/report/3702',
      },
    );

    await waitFor(() =>
      expect(screen.getAllByText(/Fabricated Title With Real DOI/).length).toBeGreaterThan(0),
    );

    // Switch to Tab 2 (Symbolic Rules) and verify R-CHIMERIC-DOI-MISMATCH consequent
    const rulesTab = screen.getByRole('tab', { name: /2\. Symbolic Rules/i });
    fireEvent.mouseDown(rulesTab);
    fireEvent.click(rulesTab);
    await waitFor(() =>
      expect(container.textContent).toContain('R-CHIMERIC-DOI-MISMATCH'),
    );
    expect(container.textContent).toContain(
      'IF doi_resolved == TRUE AND title_sim_fuzzy < 0.35 AND author_jaccard < 0.25 THEN SUSPECTED_HALLUCINATION',
    );
    expect(container.textContent).toContain('R-DOI-CONFLICT');

    // Switch to Tab 3 (Source Retrieval) in EN mode
    const sourcesTabEn = screen.getByRole('tab', { name: /3\. Source Retrieval/i });
    fireEvent.mouseDown(sourcesTabEn);
    fireEvent.click(sourcesTabEn);
    await waitFor(() =>
      expect(container.textContent).toContain('Matched · Sim: 0.88'),
    );
    expect(container.textContent).toContain('NO HIT');

    // Select web resource [2] in EN mode -> shows Not Routed
    const webCardEn = container.querySelector('[data-citation-id="cit-web-unrouted"]');
    fireEvent.click(webCardEn!);
    await waitFor(() =>
      expect(container.textContent).toContain('NOT ROUTED'),
    );
    unmount();

    // Verify Vietnamese localization in Tab 3 (Source Retrieval)
    await i18n.changeLanguage('vi');
    const { container: viContainer } = renderWithProviders(
      <Routes>
        <Route path="/verification/report/:id" element={<EssayPage />} />
      </Routes>,
      {
        user: makeUser('teacher', 'pro'),
        initialRoute: '/verification/report/3702',
      },
    );

    await waitFor(() =>
      expect(screen.getAllByText(/Fabricated Title With Real DOI/).length).toBeGreaterThan(0),
    );
    const sourcesTabVi = screen.getByRole('tab', { name: /3\. Nguồn Truy hồi/i });
    fireEvent.mouseDown(sourcesTabVi);
    fireEvent.click(sourcesTabVi);
    await waitFor(() =>
      expect(viContainer.textContent).toContain('Đã khớp · Tương đồng: 0.88'),
    );
    expect(viContainer.textContent).toContain('KHỚP');
    expect(viContainer.textContent).toContain('KHÔNG KHỚP');
    expect(viContainer.textContent).not.toContain('NO HIT');

    const webCardVi = viContainer.querySelector('[data-citation-id="cit-web-unrouted"]');
    fireEvent.click(webCardVi!);
    await waitFor(() =>
      expect(viContainer.textContent).toContain('KHÔNG ĐỊNH TUYẾN'),
    );
  });

  it('EssayPage RevisionDiff uses rose styling when error counts increase and emerald when error counts decrease, plus [14a] composite marker & localized labels', async () => {
    const reportWithRegressionAndFix = makeReport({
      essay_id: 3703,
      verdicts: [
        makeVerdict({
          citation_id: 'v1',
          citation_raw: '[1] Verified Paper (2023).',
          label: 'verified',
        }),
      ],
      revision_diff: {
        has_previous_revision: true,
        previous_essay_id: 3700,
        current_essay_id: 3703,
        previous_filename: 'draft_v1.pdf',
        current_filename: 'draft_v2.pdf',
        cis_before: 82.0,
        cis_after: 76.5,
        cis_delta: -5.5,
        resolved_issues_count: 1,
        new_issues_count: 3,
        counts_before: {
          total: 11,
          verified: 5,
          metadata_error: 4,
          suspected_hallucination: 1,
          unresolved: 1,
        },
        counts_after: {
          total: 11,
          verified: 4,
          metadata_error: 2, // decreased (-2) -> GOOD -> emerald
          suspected_hallucination: 3, // increased (+2) -> BAD -> rose
          unresolved: 2, // increased (+1) -> BAD -> rose
        },
        citation_changes: [
          {
            citation_raw: 'Vaswani, A. et al. (2017). Attention Is All You Need.',
            before_label: 'metadata_error',
            after_label: 'verified',
            transition: 'fixed',
            composite_label: '14a',
          } as never,
          {
            citation_raw: 'Synthetic Hallucinated Paper Added in V2 (2026).',
            before_label: 'unresolved',
            after_label: 'suspected_hallucination',
            transition: 'regressed',
            composite_label: '15b',
          } as never,
        ],
      },
    });

    vi.spyOn(api, 'getEssay').mockResolvedValue(reportWithRegressionAndFix);

    renderWithProviders(
      <Routes>
        <Route path="/verification/report/:id" element={<EssayPage />} />
      </Routes>,
      {
        user: makeUser('teacher', 'pro'),
        initialRoute: '/verification/report/3703',
      },
    );

    await waitFor(() =>
      expect(screen.getByTestId('revision-diff-banner')).toBeDefined(),
    );

    // Decreased metadata_error (-2) -> emerald
    const metaDelta = screen.getByTestId('revision-delta-metadata_error');
    expect(metaDelta.textContent).toBe('-2');
    expect(metaDelta.className).toContain('text-emerald-700');
    expect(metaDelta.className).toContain('bg-emerald-500/10');

    // Increased suspected_hallucination (+2) -> rose
    const halluDelta = screen.getByTestId('revision-delta-suspected_hallucination');
    expect(halluDelta.textContent).toBe('+2');
    expect(halluDelta.className).toContain('text-rose-700');
    expect(halluDelta.className).toContain('bg-rose-500/10');

    // Increased unresolved (+1) -> rose
    const unresDelta = screen.getByTestId('revision-delta-unresolved');
    expect(unresDelta.textContent).toBe('+1');
    expect(unresDelta.className).toContain('text-rose-700');
    expect(unresDelta.className).toContain('bg-rose-500/10');

    // Decreased verified (-1) -> rose
    const verDelta = screen.getByTestId('revision-delta-verified');
    expect(verDelta.textContent).toBe('-1');
    expect(verDelta.className).toContain('text-rose-700');

    // Expand detailed changes and check [14a] composite marker + localized labels (no raw snake_case)
    fireEvent.click(screen.getByTestId('revision-diff-details-btn'));
    const panel = screen.getByTestId('revision-diff-details-panel');
    expect(panel.textContent).toContain('[14a]');
    expect(panel.textContent).toContain('[15b]');
    expect(panel.textContent).toContain('Metadata Error → Verified');
    expect(panel.textContent).toContain('Unresolved → Suspected Hallucination');
    expect(panel.textContent).not.toContain('SUSPECTED_HALLUCINATION');
    expect(panel.textContent).not.toContain('METADATA_ERROR');
  });

  it('CitationGraphView & EvidenceGraph: resource filter, L2 Verified resource exclusion, [14a] search, ROOT pill fix, R-URL-CONTENT-MISMATCH warning, Curated Registry Hit, and VI verdict labels', async () => {
    const verdicts = [
      makeVerdict({
        citation_id: 'g-verified',
        numeric_index: 1,
        citation_raw: '[1] Vaswani, A. (2017). Attention Is All You Need.',
        label: 'verified',
        confidence: 0.96,
        triggered_rules: ['R-WELL-LINKED'],
        mismatched_fields: [],
        matched_sources: [
          {
            source: 'crossref',
            matched_fields: ['title', 'authors', 'year'],
            checked_at: '2026-11-14T00:00:00Z',
          },
        ],
      }),
      makeVerdict({
        citation_id: 'g-incomplete',
        numeric_index: 14,
        sub_index: 'a',
        composite_label: '14a',
        citation_raw: '(a) Bare Title Without Author Or Year',
        label: 'metadata_error',
        confidence: 0.75,
        triggered_rules: ['R-INCOMPLETE-METADATA'],
        mismatched_fields: ['authors', 'year'],
        matched_sources: [],
      }),
      makeVerdict({
        citation_id: 'g-legal',
        numeric_index: 15,
        citation_raw: 'Quốc hội (2025). Luật Dữ liệu số 60/2024/QH15.',
        label: 'resource',
        confidence: 0.99,
        triggered_rules: ['R-VN-LEGAL-VERIFIED'],
        mismatched_fields: [],
        matched_sources: [
          {
            source: 'vn_legal_registry',
            title: 'Luật Dữ liệu số 60/2024/QH15',
            matched_fields: ['title', 'year'],
            checked_at: '2026-11-14T00:00:00Z',
          },
        ],
      }),
      makeVerdict({
        citation_id: 'g-unresolved',
        numeric_index: 16,
        citation_raw: 'Regional Unindexed Thesis (2020).',
        label: 'unresolved',
        confidence: 0.5,
        triggered_rules: ['R-UNINDEXED-BOOK-OR-SOURCE'],
        mismatched_fields: [],
        matched_sources: [],
      }),
    ];

    const onSelect = vi.fn();
    const { unmount } = renderWithProviders(
      <CitationGraphView verdicts={verdicts} onSelect={onSelect} />,
    );

    // 4 total verdicts, 1 resource -> scholarly denominator = 3, verified = 1 -> 1/3 (33%)
    expect(screen.getByTestId('graph-l2-verified-pill').textContent).toContain(
      '1/3 (33%)',
    );

    // Composite marker [14a] and Incomplete Ref badge appear on sidebar
    const markers = screen
      .getAllByTestId('graph-sidebar-marker')
      .map((el) => el.textContent);
    expect(markers).toContain('[14a]');
    expect(screen.getByTestId('graph-incomplete-ref-badge').textContent).toBe(
      'Incomplete Ref',
    );

    // Filter by 'resource' pill -> shows only the legal resource item
    const resourceFilterBtn = screen.getByTestId('graph-label-filter-resource');
    expect(resourceFilterBtn.textContent).toContain('URL / Legal Resource');
    fireEvent.click(resourceFilterBtn);
    expect(screen.getAllByTestId('graph-sidebar-marker')).toHaveLength(1);
    expect(screen.getByTestId('graph-sidebar-marker').textContent).toBe('[15]');

    // Clear resource filter and search by '14a' and '[14a]'
    fireEvent.click(resourceFilterBtn);
    const searchInput = screen.getByRole('textbox');
    fireEvent.change(searchInput, { target: { value: '[14a]' } });
    expect(screen.getAllByTestId('graph-sidebar-marker')).toHaveLength(1);
    expect(screen.getByTestId('graph-sidebar-marker').textContent).toBe('[14a]');

    fireEvent.change(searchInput, { target: { value: '14a' } });
    expect(screen.getAllByTestId('graph-sidebar-marker')).toHaveLength(1);
    unmount();

    // Verify ROOT pill bug fix on leaf 'unresolved' and 'resource' verdict nodes
    const { unmount: unmountUnres } = renderWithProviders(
      <EvidenceGraph verdict={verdicts[3]} />,
    );
    const unresVerdictNode = screen.getByTestId('evidence-node-verdict');
    expect(unresVerdictNode.textContent).toContain('REVIEW');
    expect(unresVerdictNode.textContent).not.toContain('ROOT');
    expect(screen.getByTestId('evidence-node-reference').textContent).toContain(
      'ROOT',
    );
    // Unresolved rules node has neutral INFO status, not warning
    expect(screen.getByTestId('evidence-node-rules').textContent).toContain('INFO');
    unmountUnres();

    // Verify 'resource' verdict node shows RESOURCE + Curated Registry Hit (never Local FTS5 Hit or ROOT) + positive PASS rules
    const { container: legalGraphContainer, unmount: unmountLegal } =
      renderWithProviders(<EvidenceGraph verdict={verdicts[2]} />);
    const legalVerdictNode = screen.getByTestId('evidence-node-verdict');
    expect(legalVerdictNode.textContent).toContain('RESOURCE');
    expect(legalVerdictNode.textContent).not.toContain('ROOT');
    expect(legalGraphContainer.textContent).toContain('Curated Registry Hit');
    expect(legalGraphContainer.textContent).not.toContain('Local FTS5 Hit');
    expect(
      legalGraphContainer.querySelector('[data-source-key="vn_legal_registry"]'),
    ).not.toBeNull();
    expect(screen.getByTestId('evidence-node-rules').textContent).toContain('PASS');
    unmountLegal();

    // Verify R-URL-CONTENT-MISMATCH web_html_meta candidate has 'warning' status (MISMATCH, NEVER 'success'/PASS) & surfaces observed <title>
    const mismatchUrlVerdict = makeVerdict({
      citation_id: 'g-url-mismatch',
      citation_raw:
        '[9] Claimed AI Safety Paper (2025). https://example.org/wrong-target',
      label: 'metadata_error',
      confidence: 0.81,
      triggered_rules: ['R-URL-CONTENT-MISMATCH'],
      mismatched_fields: ['title', 'url'],
      url_status: 'alive',
      url_status_code: 200,
      html_meta: {
        page_title: 'Cooking Pasta Blog Landing Page',
        site_name: 'Foodie World',
      },
      matched_sources: [
        {
          source: 'web_html_meta',
          title: 'Cooking Pasta Blog Landing Page',
          matched_fields: ['title'],
          checked_at: '2026-11-14T00:00:00Z',
        },
      ],
    });
    const { graph: mismatchGraph } = buildEvidenceGraph(mismatchUrlVerdict, 'en');
    const sourcesNode = mismatchGraph.children!.find((c) => c.id === 'sources')!;
    const webCandidate = sourcesNode.children!.find((c) =>
      c.id.startsWith('web_html_meta'),
    )!;
    expect(webCandidate.status).toBe('warning');
    expect(webCandidate.statusText).toBe('MISMATCH');
    expect(webCandidate.detail).toContain('Cooking Pasta Blog Landing Page');

    const simNode = mismatchGraph.children!.find((c) => c.id === 'similarity')!;
    const urlCheckNode = simNode.children!.find((c) => c.id === 'url-link-check')!;
    expect(urlCheckNode.status).toBe('warning');
    expect(urlCheckNode.label).toContain('Wrong Page');

    // Pure ONNX cross-lingual bridge node when bridged_concepts is [] + VI verdict node titles
    const onnxOnlyVerdict = makeVerdict({
      citation_id: 'g-onnx-only',
      label: 'metadata_error',
      triggered_rules: ['R-INCOMPLETE-METADATA', 'R-CROSS-LINGUAL-ALIGNMENT'],
      features: {
        cross_lingual_title_sim: 0.86,
        bridged_concepts: [],
      },
    });
    const { graph: viOnnxGraph } = buildEvidenceGraph(onnxOnlyVerdict, 'vi');
    const viSim = viOnnxGraph.children!.find((c) => c.id === 'similarity')!;
    const viBridge = viSim.children!.find(
      (c) => c.id === 'sim-cross-lingual-bridge',
    );
    expect(viBridge).toBeDefined();
    expect(viBridge!.detail).toContain('ONNX INT8');
    expect(viBridge!.detail).toContain('86%');
    const viVerdictNode = viOnnxGraph.children!.find((c) => c.id === 'verdict')!;
    expect(viVerdictNode.label).toBe('Thiếu quy cách trích dẫn');

    const { graph: viLegalGraph } = buildEvidenceGraph(verdicts[2], 'vi');
    expect(viLegalGraph.children!.find((c) => c.id === 'verdict')!.label).toBe(
      'Văn bản Pháp luật VN',
    );
  });

  it('LogicTracePage, DocumentInspectorPage & SharedReportPage surface ONNX cross-lingual badges and OCR / TCVN3 diagnostics', async () => {
    const xlVerdict = makeVerdict({
      citation_id: 'v-xl-1',
      numeric_index: 2,
      citation_raw: '[2] Vaswani, A. (2017). Chú ý là tất cả những gì bạn cần.',
      context: 'Mô hình Transformer dựa trên cơ chế tự chú ý đa đầu [2].',
      label: 'metadata_error',
      confidence: 0.84,
      triggered_rules: ['R-CROSS-LINGUAL-TITLE-MATCH'],
      mismatched_fields: ['title'],
      features: {
        title_sim_fuzzy: 0.11,
        cross_lingual_title_detected: true,
        cross_lingual_title_sim: 0.84,
        bridged_concepts: [],
      },
    });
    const fullReport = makeReport({
      essay_id: 3705,
      verdicts: [xlVerdict],
    });
    vi.spyOn(api, 'getEssay').mockResolvedValue(fullReport);

    // 1. LogicTracePage surfaces ONNX INT8 Multilingual badge & 84% even when bridged_concepts is []
    const { unmount: unmountTrace } = renderWithProviders(
      <Routes>
        <Route path="/verification/report/:id/trace" element={<LogicTracePage />} />
      </Routes>,
      {
        user: makeUser('teacher', 'pro'),
        initialRoute: '/verification/report/3705/trace',
      },
    );
    await waitFor(() =>
      expect(screen.getByTestId('trace-onnx-multilingual-badge')).toBeDefined(),
    );
    expect(screen.getByTestId('trace-onnx-multilingual-badge').textContent).toContain(
      '84%',
    );
    expect(screen.getByTestId('bridged-concepts-bar').textContent).toContain(
      'paraphrase-multilingual-MiniLM-L12-v2',
    );
    unmountTrace();

    // 2. DocumentInspectorPage surfaces VI↔EN ONNX · 84% in list and CitationPopup
    const { unmount: unmountInsp } = renderWithProviders(
      <Routes>
        <Route
          path="/verification/inspector/:id"
          element={<DocumentInspectorPage />}
        />
      </Routes>,
      {
        user: makeUser('teacher', 'pro'),
        initialRoute: '/verification/inspector/3705',
      },
    );
    await waitFor(() =>
      expect(screen.getByTestId('inspector-list-cross-lingual-0')).toBeDefined(),
    );
    expect(screen.getByTestId('inspector-list-cross-lingual-0').textContent).toContain(
      'VI↔EN ONNX · 84%',
    );
    fireEvent.click(screen.getByTestId('page-citation-item-0'));
    await waitFor(() =>
      expect(screen.getByTestId('inspector-cross-lingual-pill')).toBeDefined(),
    );
    expect(screen.getByTestId('inspector-cross-lingual-pill').textContent).toContain(
      'VI↔EN ONNX · 84%',
    );
    unmountInsp();

    // 3. SharedReportPage renders OCR + TCVN3 + Scanned PDF diagnostics chips & VI↔EN ONNX badge
    vi.spyOn(api, 'getSharedEssayReport').mockResolvedValue({
      essay_id: 3705,
      filename: 'luannvan_tcvn3_ocr.pdf',
      created_at: '2026-11-14T10:00:00Z',
      num_pages: 12,
      num_citations: 1,
      cis: {
        score: 88.5,
        components: {},
        weights_used: {},
        num_citations: 1,
        num_unresolved: 0,
        disclaimer: 'Decision support tool only.',
      },
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
      receipt_id: 'CITRA-03705-ABCDEF99',
      verified_at: '2026-11-14T10:00:00Z',
      disclaimer: 'Decision support tool only.',
      document_diagnostics: {
        is_scanned_pdf: false,
        scanned_pages_count: 2,
        legacy_encoding_detected: 'tcvn3',
        ocr_pages_recovered: [3, 7],
      },
      verdict_counts: {
        verified: 0,
        metadata_error: 1,
        suspected_hallucination: 0,
        unresolved: 0,
        resource: 0,
      },
      verdicts: [
        {
          reference_id: 'ref-0001',
          raw_text: 'Vaswani, A. (2017). Chú ý là tất cả những gì bạn cần.',
          label: 'metadata_error',
          confidence: 0.84,
          explanation: 'Translated foreign title.',
          triggered_rules: ['R-CROSS-LINGUAL-TITLE-MATCH'],
          matched_source: null,
          features: {
            cross_lingual_title_detected: true,
            cross_lingual_title_sim: 0.84,
          } as never,
        },
      ],
    } as never);

    renderWithProviders(
      <Routes>
        <Route path="/verify/share/:token" element={<SharedReportPage />} />
      </Routes>,
      {
        initialRoute: '/verify/share/sh_3705_valid_token',
        user: null,
      },
    );

    await waitFor(() =>
      expect(screen.getByTestId('shared-doc-diagnostics-banner')).toBeDefined(),
    );
    expect(screen.getByTestId('shared-legacy-encoding-pill').textContent).toContain(
      'Auto-transcoded legacy Vietnamese encoding (TCVN3 → Unicode NFC)',
    );
    expect(screen.getByTestId('shared-ocr-recovery-pill').textContent).toContain(
      'Recovered text via Tesseract OCR (vie+eng) on page(s): 3, 7',
    );
    expect(screen.getByTestId('shared-cross-lingual-badge-0').textContent).toContain(
      'VI↔EN ONNX · 84%',
    );

    // Toggle SharedReportPage to VI and check localized diagnostics
    fireEvent.click(screen.getByTestId('shared-lang-toggle'));
    await waitFor(() =>
      expect(screen.getByTestId('shared-legacy-encoding-pill').textContent).toContain(
        'Đã tự động chuyển mã bảng mã tiếng Việt cũ (TCVN3 → Unicode NFC)',
      ),
    );
    expect(screen.getByTestId('shared-ocr-recovery-pill').textContent).toContain(
      'Đã khôi phục văn bản bằng OCR (Tesseract vie+eng) tại trang: 3, 7',
    );
  });
});
