import type { Verdict } from '@/api/client';

const SOURCE_LABELS: Record<string, string> = {
  crossref: 'Crossref',
  openalex: 'OpenAlex',
  datacite: 'DataCite (Zenodo / Figshare / OSF)',
  doi_ra: 'Global DOI Registration Agency (CSL-JSON)',
  doaj: 'DOAJ (Directory of Open Access Journals)',
  openaire_hal: 'OpenAIRE Graph / HAL Open Science',
  ncbi_biorxiv: 'NCBI Entrez / bioRxiv / medRxiv',
  dblp: 'DBLP',
  arxiv: 'arXiv',
  openlibrary: 'OpenLibrary / Google Books',
  europepmc: 'Europe PMC (PubMed)',
  huggingface: 'Hugging Face Hub',
  tech_standard: 'IETF RFC / PyPI / NPM / GitHub',
  wikidata_opencitations: 'Wikidata Knowledge Graph / OpenCitations',
  serpapi: 'Google Scholar',
  local_db: 'the local library',
  known_papers: 'the known-papers library',
  vn_legal_registry: 'the Vietnamese Legal Registry',
};

const FIELD_LABELS: Record<string, string> = {
  title: 'the title',
  authors: 'the authors',
  author: 'the authors',
  year: 'the publication year',
  doi: 'the DOI',
  venue: 'the venue',
  url: 'the link',
  retracted: 'the retraction status (RETRACTED PAPER)',
  retracted_paper: 'the retraction status (RETRACTED PAPER)',
};

const RULE_LABELS: Record<string, string> = {
  'R-WELL-LINKED': 'Citation and publication details match closely',
  'R-WELL-LINKED-MODERATE': 'Citation and publication are a reasonable match',
  'R-DOI-TITLE-AUTHOR': 'DOI, title, and author details match',
  'R-CONSENSUS-FULL': 'Multiple sources agree on the publication details',
  'R-CONSENSUS-PARTIAL': 'Sources agree, with some details to review',
  'R-SINGLE-SOURCE-VERIFIED': 'High-confidence match verified in a scholarly registry',
  'R-SINGLE-SOURCE-PARTIAL': 'Scholarly record found, but author, year, or title differs',
  'R-BOOK-EDITION-VERIFIED': 'Canonical textbook or book edition verified',
  'R-LOCAL_DB_VERIFIED': 'Verified against the local scholarly library',
  'R-LOCAL_DB_GOOD_MATCH': 'Strong match found in the local scholarly library',
  'R-KNOWN-PAPER': 'Matches a canonical benchmark publication',
  'R-KNOWN-PAPER-NO-TITLE': 'Matches a canonical seminal paper by author and year',
  'R-VN-LEGAL-FORMAT': 'Official statutory or legal document format verified',
  'R-GLOBAL-DOI-RA-VERIFIED': 'Verified via Global DOI Registration Agency & Content Negotiation (CSL-JSON)',
  'R-HF-VERIFIED': 'AI model, dataset, or paper verified on Hugging Face Hub',
  'R-RFC-VERIFIED': 'Technical RFC standard or software repository verified via IETF / PyPI / NPM / GitHub',
  'R-GITHUB-VERIFIED': 'Public software repository & CITATION.cff verified via GitHub REST API',
  'R-PACKAGE-VERIFIED': 'Open-source package metadata verified via PyPI / NPM Registry',
  'R-WIKIDATA-VERIFIED': 'Standard, clinical manual, or DOI verified via Wikidata Knowledge Graph / OpenCitations',
  'R-WAYBACK-ARCHIVED': 'Original URL experienced link rot, verified via Internet Archive Wayback Machine snapshot',
  'R-RETRACTED-PAPER': 'WARNING: This publication has been officially RETRACTED in scholarly registries',
  'R-KNOWN-AUTHOR-TITLE-MISMATCH': 'Author matches, but the title needs review',
  'R-KNOWN-AUTHOR-WEAK-EVIDENCE': 'Author is known, but supporting evidence is limited',
  'R-DOI-TITLE-MISMATCH': 'DOI matches, but the title needs review',
  'R-FAKE-URL': 'The link does not look like a real academic source',
  'R-DEAD-URL': 'The cited URL is unreachable (HTTP 404/DNS) and no scholarly record was found',
  'R-BROKEN-LINK': 'The scholarly paper exists, but the cited URL returned an HTTP error',
  'R-FABRICATED-DOI': 'The DOI has an invalid or fabricated prefix',
  'R-NONEXISTENT-DOI': 'The cited DOI does not resolve in scholarly registries',
  'R-NO-SCHOLARLY-RECORD': 'Zero matching records returned across live scholarly registries',
  'R-HALLUCINATED-SOURCE': 'Retrieved candidates fall below the minimum similarity threshold',
  'R-FAKE-AUTHOR': 'The author details look unusual or fabricated',
  'R-FUTURE-YEAR': 'The publication year is in the future',
  'R-FUTURE-YEAR-KNOWN-AUTHOR': 'The publication year needs review',
  'R-CONTENT-ALIGNMENT': 'In-text context aligns semantically with the source abstract',
  'R-CROSS-LINGUAL-ALIGNMENT': 'Vietnamese–English cross-lingual semantic alignment verified via academic concept bridge',
  'R-CROSS-LINGUAL-TITLE-MATCH': 'Translated title matches original publication semantically — original foreign-language title must be preserved per TDTU citation rules',
  'R-CONTENT-MISMATCH': 'The citation content does not match the publication',
  'R-STYLE-INCONSISTENT': 'The citation format differs from the document style',
};

export function getSourceDisplayName(source: string): string {
  const key = source.toLowerCase();
  return SOURCE_LABELS[key] ?? source;
}

function matchedSourceNames(verdict: Verdict): string[] {
  return (verdict.matched_sources ?? []).map((source) => getSourceDisplayName(source.source));
}

/** Treat URL-only rows as web resources, including older cached reports. */
export function isUrlResource(verdict: { citation_raw: string; label: string }): boolean {
  if (verdict.label === 'resource') return true;
  const raw = verdict.citation_raw.trim().replace(/[.,;:)"']+$/, '');
  return /^(?:https?:\/\/|www\.)\S+$/i.test(raw);
}

export function getFieldDisplayName(field: string): string {
  return FIELD_LABELS[field.toLowerCase()] ?? field;
}

export function getRuleDisplayName(rule: string): string {
  return RULE_LABELS[rule] ?? 'An additional verification check was applied';
}

export function getVerdictDisplayName(label: string): string {
  const labels: Record<string, string> = {
    verified: 'Verified',
    metadata_error: 'Needs a metadata review',
    suspected_hallucination: 'Could not be verified',
    unresolved: 'Needs manual review',
    resource: 'Web resource',
  };
  return labels[label] ?? 'Needs manual review';
}

function fieldLabels(fields: string[]): string {
  const labels = [...new Set(fields.map((field) => FIELD_LABELS[field.toLowerCase()] ?? field))];
  if (labels.length === 0) return 'the available details';
  if (labels.length === 1) return labels[0];
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(', ')}, and ${labels[labels.length - 1]}`;
}

/**
 * Converts internal validation reasoning into a short explanation for people
 * reading the report. The raw reasoning remains available to the backend.
 */
export function getVerdictExplanation(verdict: Verdict): string {
  const sources = matchedSourceNames(verdict);
  const fields = fieldLabels(verdict.mismatched_fields ?? []);
  const matchedFields = fieldLabels(
    (verdict.matched_sources ?? []).flatMap((source) => source.matched_fields ?? [])
  );

  const urlStatus = verdict.url_status ?? verdict.features?.url_status;
  const urlCode = verdict.url_status_code ?? verdict.features?.url_status_code;
  const archiveUrl = verdict.archive_url ?? verdict.features?.archive_url;
  const isRetracted =
    Boolean(verdict.is_retracted ?? verdict.features?.is_retracted) ||
    Boolean((verdict.triggered_rules ?? []).includes('R-RETRACTED-PAPER'));
  const retractionNote = isRetracted
    ? ' RETRACTION WARNING: This publication has been officially RETRACTED in scholarly registries.'
    : '';
  const linkNote =
    urlStatus === 'alive'
      ? ` Link check passed (HTTP ${urlCode || 200} OK).`
      : urlStatus === 'restricted_alive'
        ? ` Link check passed (HTTP ${urlCode || 403} publisher paywall — link is alive).`
        : urlStatus === 'archived_alive'
          ? ` Link rot detected, but an archived snapshot was verified on Internet Archive Wayback Machine${archiveUrl ? ` (${archiveUrl})` : ''}.`
          : urlStatus === 'dead_link'
            ? ` Warning: the cited URL returned HTTP ${urlCode || 404} (dead/unreachable link).`
            : urlStatus === 'fake_domain'
              ? ' Warning: the cited URL uses a fake or placeholder domain.'
              : '';

  if (isUrlResource(verdict)) {
    return `URL resource detected: ${verdict.citation_raw}. This is not an academic citation and is excluded from the CIS score.${linkNote}${retractionNote}`;
  }

  if (verdict.mapping_status === 'missing_reference') {
    return 'This citation does not have a matching entry in the bibliography.';
  }

  if (verdict.mapping_status === 'ambiguous_mapping') {
    return 'The citation could match more than one bibliography entry, so the system did not choose one automatically.';
  }

  switch (verdict.label) {
    case 'verified':
      if (sources.length === 0) {
        return `The citation is linked to its bibliography entry and passes the available checks.${linkNote}${retractionNote}`;
      }
      if (sources.every((source) => source === 'the local library' || source === 'the known-papers library')) {
        return `The citation matches a paper in ${sources[0]}. ${matchedFields} are consistent, so no external search was needed.${linkNote}${retractionNote}`;
      }
      return `We found a matching publication in ${sources.join(' and ')}. ${matchedFields} are consistent with the citation.${linkNote}${retractionNote}`;

    case 'metadata_error':
      if (
        (verdict.triggered_rules ?? []).includes('R-CROSS-LINGUAL-TITLE-MATCH') ||
        verdict.features?.cross_lingual_title_detected
      ) {
        const crossSimPct = verdict.features?.cross_lingual_title_sim
          ? ` (${Math.round(verdict.features.cross_lingual_title_sim * 100)}% VI↔EN semantic match)`
          : '';
        return (
          `The Vietnamese translated title semantically matches the English publication${crossSimPct}, ` +
          `but TDTU academic citation rules require preserving the original foreign-language title (optionally followed by [Vietnamese translation] in brackets).` +
          linkNote +
          retractionNote
        );
      }
      return (sources.length > 0
        ? `We found a likely publication, but ${fields} do not match the citation. Please review these details.`
        : `The citation could not be confirmed because ${fields} do not match the available record.`) + linkNote + retractionNote;

    case 'suspected_hallucination':
      return (sources.length === 0
        ? 'We could not find a matching publication in the checked sources. Please verify this citation manually.'
        : 'The available records do not support this citation. Please verify the source and its details manually.') + linkNote + retractionNote;

    case 'unresolved':
    default:
      return (sources.length === 0
        ? 'There was not enough evidence to verify this citation. Please review it manually.'
        : `We found a possible match, but the available details are not strong enough to confirm it. Check ${fields}.`) + linkNote + retractionNote;
  }
}

export function getSourceSummary(verdict: Verdict): string {
  if (isUrlResource(verdict)) return `URL: ${verdict.citation_raw}`;
  const sources = matchedSourceNames(verdict);
  if (sources.length === 0) return 'No matching publication found';
  if (sources.length === 1) return `Found a matching publication in ${sources[0]}`;
  return `Found matching publications in ${sources.join(' and ')}`;
}

export function getSearchStepDescription(verdict: Verdict): string {
  const sources = matchedSourceNames(verdict);
  if (sources.every((source) => source === 'the local library' || source === 'the known-papers library') && sources.length > 0) {
    return 'A saved local record matched, so no external services were contacted.';
  }
  if (sources.length > 0) {
    return `Checked ${sources.join(', ')} for a matching publication.`;
  }
  return 'No matching publication was returned by the available sources.';
}
