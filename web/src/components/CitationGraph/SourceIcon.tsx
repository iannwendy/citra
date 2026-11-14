import {
  Archive,
  BookOpen,
  Code2,
  Compass,
  Cpu,
  Database,
  FileCheck2,
  FileText,
  Fingerprint,
  Globe,
  HardDrive,
  Library,
  Microscope,
  Network,
  Scale,
  Server,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';
import { SOURCE_CONFIG } from './types';

const SOURCE_ICON_MAP: Record<string, LucideIcon> = {
  vn_legal_registry: Scale,
  tech_standard: Cpu,
  vn_tech_standard: FileCheck2,
  vn_textbook_registry: BookOpen,
  openlibrary: BookOpen,
  web_html_meta: Globe,
  wayback_html_meta: Archive,
  datacite: HardDrive,
  doaj: FileText,
  openaire_hal: FileText,
  arxiv: FileText,
  dblp: Code2,
  europepmc: Microscope,
  ncbi_biorxiv: Microscope,
  huggingface: Sparkles,
  wikidata_opencitations: Network,
  doi_ra: Fingerprint,
  openalex: Compass,
  crossref: Database,
  local_db: Server,
  known_papers: Library,
  serpapi: Globe,
};

export function SourceIcon({ source }: { source?: string }) {
  const key = (source || '').trim().toLowerCase();
  const config = SOURCE_CONFIG[key] ?? {
    color: 'text-indigo-600 dark:text-indigo-400',
    bgColor: 'bg-indigo-50 dark:bg-indigo-950',
    label: source || 'Database',
  };
  const Icon = SOURCE_ICON_MAP[key] ?? Database;
  return (
    <Icon
      data-source-key={key || 'default'}
      className={`h-4 w-4 shrink-0 ${config.color}`}
    />
  );
}
