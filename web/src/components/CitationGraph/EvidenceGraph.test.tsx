import { describe, it, expect } from 'vitest';
import { buildEvidenceGraph } from './EvidenceGraph';
import { getVerdictExplanation, getSourceDisplayName, getRuleDisplayName } from '@/lib/verdictExplanation';
import type { Verdict } from '@/api/client';

function makeVerdict(overrides: Partial<Verdict> = {}): Verdict {
  return {
    citation_id: 'cite-1',
    citation_raw: 'Smith et al., 2023',
    mapping_status: 'matched',
    mapping_confidence: 0.9,
    label: 'verified',
    confidence: 0.85,
    reasoning: 'Match found',
    triggered_rules: [],
    mismatched_fields: [],
    matched_sources: [
      {
        source: 'crossref',
        matched_fields: ['title', 'year'],
        url: 'https://example.com',
        checked_at: '2026-01-01T00:00:00Z',
      },
    ],
    is_overridden: false,
    domain_exception: false,
    style_penalty: 0,
    ...overrides,
  };
}

describe('buildEvidenceGraph', () => {
  it('returns a reference node at the root', () => {
    const { graph } = buildEvidenceGraph(makeVerdict());
    expect(graph.type).toBe('reference');
    expect(graph.label).toBe('Smith et al., 2023');
    expect(graph.children).toBeDefined();
  });

  it('marks confidence detail as percentage', () => {
    const { graph } = buildEvidenceGraph(makeVerdict());
    expect(graph.detail).toContain('85%');
  });

  it('includes sources / similarity / rules / verdict children', () => {
    const { graph } = buildEvidenceGraph(makeVerdict());
    const ids = graph.children!.map((c) => c.id);
    expect(ids).toEqual(['sources', 'similarity', 'rules', 'verdict']);
  });

  it('marks sources as success when matched_sources present', () => {
    const { graph } = buildEvidenceGraph(makeVerdict());
    const sources = graph.children!.find((c) => c.id === 'sources')!;
    expect(sources.status).toBe('success');
  });

  it('marks sources as no_match when no matched_sources', () => {
    const { graph } = buildEvidenceGraph(makeVerdict({ matched_sources: [] }));
    const sources = graph.children!.find((c) => c.id === 'sources')!;
    expect(sources.status).toBe('no_match');
  });

  it('marks similarity as success when confidence >= 0.7', () => {
    const { graph } = buildEvidenceGraph(makeVerdict({ confidence: 0.85 }));
    const sim = graph.children!.find((c) => c.id === 'similarity')!;
    expect(sim.status).toBe('success');
  });

  it('marks similarity as warning when confidence 0.4-0.7', () => {
    const { graph } = buildEvidenceGraph(makeVerdict({ confidence: 0.5 }));
    const sim = graph.children!.find((c) => c.id === 'similarity')!;
    expect(sim.status).toBe('warning');
  });

  it('marks similarity as error when confidence < 0.4', () => {
    const { graph } = buildEvidenceGraph(makeVerdict({ confidence: 0.2 }));
    const sim = graph.children!.find((c) => c.id === 'similarity')!;
    expect(sim.status).toBe('error');
  });

  it('marks rules as success when none triggered', () => {
    const { graph } = buildEvidenceGraph(makeVerdict({ triggered_rules: [] }));
    const rules = graph.children!.find((c) => c.id === 'rules')!;
    expect(rules.status).toBe('success');
  });

  it('marks rules as warning when triggered', () => {
    const { graph } = buildEvidenceGraph(
      makeVerdict({
        triggered_rules: ['rule_a', 'rule_b'],
        mismatched_fields: ['year', 'venue', 'doi'],
      }),
    );
    const rules = graph.children!.find((c) => c.id === 'rules')!;
    expect(rules.status).toBe('warning');
    expect(rules.children).toBeDefined();
    // 1 rules-list + 3 mismatched fields
    expect(rules.children!.length).toBe(4);
  });

  it('uses verdict label for final node status', () => {
    const { graph } = buildEvidenceGraph(makeVerdict({ label: 'suspected_hallucination' }));
    const verdict = graph.children!.find((c) => c.id === 'verdict')!;
    expect(verdict.status).toBe('error');
  });

  it('reports localOnly when only internal cache paths matched', () => {
    const { isLocalOnly } = buildEvidenceGraph(
      makeVerdict({
        matched_sources: [
          {
            source: 'local_db',
            matched_fields: ['title'],
            checked_at: '2026-01-01T00:00:00Z',
          },
        ],
      }),
    );
    expect(isLocalOnly).toBe(true);
  });

  it('reports not localOnly when external APIs were queried', () => {
    const { isLocalOnly } = buildEvidenceGraph(makeVerdict());
    expect(isLocalOnly).toBe(false);
  });

  it('formats matched source field list cleanly without duplicate "The the" prefix', () => {
    const { graph } = buildEvidenceGraph(makeVerdict());
    const sources = graph.children!.find((c) => c.id === 'sources')!;
    const crossrefNode = sources.children![0];
    expect(crossrefNode.detail).toBe('Matched fields: title, publication year.');
    expect(crossrefNode.detail).not.toMatch(/the\s+the/i);
  });

  it('supports all 9 new free API sources in buildEvidenceGraph and getSourceDisplayName', () => {
    const newSources = [
      'datacite',
      'doi_ra',
      'doaj',
      'openaire_hal',
      'ncbi_biorxiv',
      'huggingface',
      'tech_standard',
      'wikidata_opencitations',
    ];
    for (const src of newSources) {
      const displayName = getSourceDisplayName(src);
      expect(displayName.length).toBeGreaterThan(2);
      const { graph, isLocalOnly } = buildEvidenceGraph(
        makeVerdict({
          matched_sources: [
            {
              source: src,
              matched_fields: ['title', 'authors'],
              checked_at: '2026-01-01T00:00:00Z',
            },
          ],
        }),
      );
      expect(isLocalOnly).toBe(false);
      const sourcesNode = graph.children!.find((c) => c.id === 'sources')!;
      expect(sourcesNode.status).toBe('success');
    }
  });

  it('explains retracted papers and Wayback Machine archived links in getVerdictExplanation', () => {
    const retractedVerdict = makeVerdict({
      label: 'metadata_error',
      is_retracted: true,
      triggered_rules: ['R-RETRACTED-PAPER'],
      mismatched_fields: ['retracted_paper'],
    });
    const explanation = getVerdictExplanation(retractedVerdict);
    expect(explanation).toMatch(/RETRACTED/i);

    const archivedVerdict = makeVerdict({
      label: 'verified',
      url_status: 'archived_alive',
      archive_url: 'https://web.archive.org/web/20230101/https://example.org/paper.pdf',
      triggered_rules: ['R-WAYBACK-ARCHIVED'],
    });
    const archExplanation = getVerdictExplanation(archivedVerdict);
    expect(archExplanation).toMatch(/Wayback Machine/i);
    expect(getRuleDisplayName('R-RETRACTED-PAPER')).toMatch(/retracted/i);
    expect(getRuleDisplayName('R-WAYBACK-ARCHIVED')).toMatch(/Wayback Machine/i);
    expect(getRuleDisplayName('R-GLOBAL-DOI-RA-VERIFIED')).toMatch(/Registration Agency/i);
    expect(getRuleDisplayName('R-HF-VERIFIED')).toMatch(/Hugging Face/i);
    expect(getRuleDisplayName('R-RFC-VERIFIED')).toMatch(/IETF/i);
    expect(getRuleDisplayName('R-GITHUB-VERIFIED')).toMatch(/GitHub/i);
    expect(getRuleDisplayName('R-PACKAGE-VERIFIED')).toMatch(/PyPI|NPM/i);
    expect(getRuleDisplayName('R-WIKIDATA-VERIFIED')).toMatch(/Wikidata|OpenCitations/i);
    expect(getRuleDisplayName('R-CROSS-LINGUAL-ALIGNMENT')).toMatch(/Vietnamese|cross-lingual/i);
    expect(getRuleDisplayName('R-CROSS-LINGUAL-TITLE-MATCH')).toMatch(/Translated title|TDTU/i);
  });

  it('builds cross-lingual concept bridge and translated title nodes in EvidenceGraph', () => {
    const crossLingualVerdict = makeVerdict({
      label: 'metadata_error',
      triggered_rules: ['R-CROSS-LINGUAL-TITLE-MATCH', 'R-CROSS-LINGUAL-ALIGNMENT'],
      mismatched_fields: ['title'],
      features: {
        title_sim_fuzzy: 0.22,
        title_sim_semantic: 0.85,
        author_jaccard: 1.0,
        year_distance: 0,
        doi_exact_match: false,
        cross_lingual_detected: true,
        bridged_concepts: ['học sâu → deep learning', 'mạng nơ-ron tích chập → convolutional neural network'],
        cross_lingual_title_detected: true,
        cross_lingual_title_sim: 0.92,
        content_alignment_score: 0.78,
        content_is_aligned: true,
        stance_label: 'entails',
      },
    });

    const { graph } = buildEvidenceGraph(crossLingualVerdict);
    const simNode = graph.children!.find((c) => c.id === 'similarity')!;
    const bridgeNode = simNode.children!.find((c) => c.id === 'sim-cross-lingual-bridge');
    const titleBridgeNode = simNode.children!.find((c) => c.id === 'sim-cross-lingual-title');

    expect(bridgeNode).toBeDefined();
    expect(bridgeNode!.status).toBe('success');
    expect(bridgeNode!.detail).toContain('học sâu → deep learning');

    expect(titleBridgeNode).toBeDefined();
    expect(titleBridgeNode!.status).toBe('warning');
    expect(titleBridgeNode!.detail).toContain('92%');

    const explanation = getVerdictExplanation(crossLingualVerdict);
    expect(explanation).toContain('92% VI↔EN semantic match');
    expect(explanation).toContain('TDTU academic citation rules');
  });
});
