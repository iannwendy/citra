/**
 * Shared vitest fixtures for report / verdict shaped data.
 * Not a test file itself (vitest only collects `*.test.ts(x)`).
 */
import type { AnalysisReport, Verdict } from '@/api/client';

export function makeVerdict(overrides: Partial<Verdict> = {}): Verdict {
  return {
    citation_id: 'cit-1',
    citation_raw: '[1] Smith, J. (2020). Deep learning for citations. Journal of AI.',
    context: 'As shown in prior work [1], citation checking matters.',
    mapping_status: 'matched',
    mapping_confidence: 0.92,
    citation_links: [{ reference_id: 'ref-0001' } as never],
    label: 'metadata_error',
    confidence: 0.73,
    reasoning: 'Year mismatch against Crossref record.',
    triggered_rules: ['R05'],
    mismatched_fields: ['year'],
    matched_sources: [{ source: 'crossref' } as never],
    is_overridden: false,
    ...overrides,
  };
}

export function makeReport(overrides: Partial<AnalysisReport> = {}): AnalysisReport {
  return {
    essay_id: 42,
    filename: 'thesis.pdf',
    num_pages: 8,
    num_citations: 1,
    num_references: 1,
    extracted_citations: [],
    style_profile: {
      style: 'APA_LIKE',
      confidence: 0.9,
      apa_count: 1,
      ieee_count: 0,
      mixed_count: 0,
      features: {},
      ratios: {},
      explanation: '',
    },
    linking_summary: {
      matched: 1,
      missing_reference: 0,
      uncited_reference: 0,
      in_text_mismatch: 0,
      duplicate_reference: 0,
      ambiguous_mapping: 0,
      style_inconsistent: 0,
      unresolved: 0,
    },
    verdicts: [makeVerdict()],
    references: [],
    cis: {
      score: 80,
      components: {},
      weights_used: {},
      num_citations: 1,
      num_unresolved: 0,
      disclaimer: '',
    },
    disclaimer: '',
    ...overrides,
  };
}
