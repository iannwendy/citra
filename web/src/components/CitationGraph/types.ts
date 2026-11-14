/**
 * SourceConfig — visual config for retrieval sources.
 * Shared by SourceIcon, EvidenceGraphNode, and the citation graph.
 */

import type { ReactNode } from 'react';
import type { ValidationLabel } from '@/api/client';

export interface SourceConfig {
  color: string;
  bgColor: string;
  label: string;
}

export const SOURCE_CONFIG: Record<string, SourceConfig> = {
  crossref: { color: 'text-blue-600 dark:text-blue-400', bgColor: 'bg-blue-50 dark:bg-blue-950', label: 'Crossref' },
  openalex: { color: 'text-teal-600 dark:text-teal-400', bgColor: 'bg-teal-50 dark:bg-teal-950', label: 'OpenAlex' },
  datacite: { color: 'text-emerald-600 dark:text-emerald-400', bgColor: 'bg-emerald-50 dark:bg-emerald-950', label: 'DataCite (Zenodo/OSF)' },
  doi_ra: { color: 'text-indigo-600 dark:text-indigo-400', bgColor: 'bg-indigo-50 dark:bg-indigo-950', label: 'Global DOI Agency (CSL)' },
  doaj: { color: 'text-rose-600 dark:text-rose-400', bgColor: 'bg-rose-50 dark:bg-rose-950', label: 'DOAJ Open Access' },
  openaire_hal: { color: 'text-violet-600 dark:text-violet-400', bgColor: 'bg-violet-50 dark:bg-violet-950', label: 'OpenAIRE / HAL Theses' },
  ncbi_biorxiv: { color: 'text-lime-600 dark:text-lime-400', bgColor: 'bg-lime-50 dark:bg-lime-950', label: 'NCBI Entrez / bioRxiv' },
  dblp: { color: 'text-purple-600 dark:text-purple-400', bgColor: 'bg-purple-50 dark:bg-purple-950', label: 'DBLP' },
  arxiv: { color: 'text-orange-600 dark:text-orange-400', bgColor: 'bg-orange-50 dark:bg-orange-950', label: 'arXiv' },
  openlibrary: { color: 'text-amber-600 dark:text-amber-400', bgColor: 'bg-amber-50 dark:bg-amber-950', label: 'OpenLibrary / Books' },
  europepmc: { color: 'text-green-600 dark:text-green-400', bgColor: 'bg-green-50 dark:bg-green-950', label: 'Europe PMC' },
  huggingface: { color: 'text-yellow-600 dark:text-yellow-400', bgColor: 'bg-yellow-50 dark:bg-yellow-950', label: 'Hugging Face Hub' },
  tech_standard: { color: 'text-slate-600 dark:text-slate-400', bgColor: 'bg-slate-50 dark:bg-slate-950', label: 'IETF RFC / PyPI / NPM / GitHub' },
  vn_tech_standard: { color: 'text-emerald-700 dark:text-emerald-400', bgColor: 'bg-emerald-50 dark:bg-emerald-950', label: 'VN National Standards (TCVN / QCVN)' },
  vn_textbook_registry: { color: 'text-amber-700 dark:text-amber-400', bgColor: 'bg-amber-50 dark:bg-amber-950', label: 'VN University Textbook Registry' },
  wikidata_opencitations: { color: 'text-fuchsia-600 dark:text-fuchsia-400', bgColor: 'bg-fuchsia-50 dark:bg-fuchsia-950', label: 'Wikidata / OpenCitations' },
  serpapi: { color: 'text-sky-600 dark:text-sky-400', bgColor: 'bg-sky-50 dark:bg-sky-950', label: 'Google Scholar' },
  local_db: { color: 'text-indigo-600 dark:text-indigo-400', bgColor: 'bg-indigo-50 dark:bg-indigo-950', label: 'Local Database' },
  known_papers: { color: 'text-cyan-600 dark:text-cyan-400', bgColor: 'bg-cyan-50 dark:bg-cyan-950', label: 'Known Papers' },
  vn_legal_registry: { color: 'text-red-600 dark:text-red-400', bgColor: 'bg-red-50 dark:bg-red-950', label: 'VN Legal Registry' },
  web_html_meta: { color: 'text-sky-600 dark:text-sky-400', bgColor: 'bg-sky-50 dark:bg-sky-950', label: 'Live Web Page Metadata (HTML)' },
  wayback_html_meta: { color: 'text-amber-600 dark:text-amber-400', bgColor: 'bg-amber-50 dark:bg-amber-950', label: 'Wayback Machine Archived Metadata' },
};

export interface GraphNode {
  id: string;
  label: string;
  type: 'reference' | 'source' | 'candidate' | 'similarity' | 'rules' | 'verdict';
  status: 'success' | 'warning' | 'error' | 'neutral' | 'no_match';
  detail?: string;
  children?: GraphNode[];
  matchedSource?: unknown;
  sourceKey?: string;
  verdictLabel?: ValidationLabel;
  statusText?: string;
  similarityScore?: number;
  rulesTriggered?: string[];
  /** Optional icon override (some node types inject their own icon JSX) */
  iconOverride?: ReactNode;
}

export type EvidenceNodeData = GraphNode;
