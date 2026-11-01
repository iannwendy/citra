import { useState, useMemo } from 'react';
import {
  Layers,
  ListChecks,
  Database,
  Brain,
  Scale,
  ShieldCheck,
  ChevronsDownUp,
  ChevronsUpDown,
  ArrowRight,
  Sparkles,
} from 'lucide-react';
import type { Verdict } from '@/api/client';
import {
  getFieldDisplayName,
  getRuleDisplayName,
  getVerdictExplanation,
} from '@/lib/verdictExplanation';
import { EvidenceGraphNode } from './EvidenceGraphNode';
import type { GraphNode } from './types';
import { SOURCE_CONFIG } from './types';
import { VERDICT_CONFIG } from './verdictConfig';

interface EvidenceGraphProps {
  verdict: Verdict;
  onClose?: () => void;
}

interface CandidateInfo {
  source: string;
  matched: boolean;
  fields?: string[];
  url?: string;
}

const CORE_EXTERNAL_DBS = [
  'crossref',
  'openalex',
  'dblp',
  'arxiv',
  'openlibrary',
  'europepmc',
];
const EXTERNAL_DBS = [
  ...CORE_EXTERNAL_DBS,
  'datacite',
  'doi_ra',
  'doaj',
  'openaire_hal',
  'ncbi_biorxiv',
  'huggingface',
  'tech_standard',
  'wikidata_opencitations',
  'serpapi',
];
const SOURCE_FLOW_ORDER = [
  'local_db',
  'known_papers',
  'vn_legal_registry',
  'crossref',
  'openalex',
  'datacite',
  'doi_ra',
  'doaj',
  'openaire_hal',
  'ncbi_biorxiv',
  'dblp',
  'arxiv',
  'openlibrary',
  'europepmc',
  'huggingface',
  'tech_standard',
  'wikidata_opencitations',
  'serpapi',
];

/**
 * Build the hierarchical evidence graph for a single verdict.
 * Exported for unit tests.
 */
export function buildEvidenceGraph(
  verdict: Verdict,
): { graph: GraphNode; isLocalOnly: boolean } {
  const sourcesByDatabase: Record<string, CandidateInfo[]> = {};
  for (const source of verdict.matched_sources ?? []) {
    const dbKey = (source.source || 'local_db').toLowerCase();
    const matchedFields = Array.isArray(source.matched_fields)
      ? source.matched_fields
      : ['title', 'authors', 'year'];
    const entry: CandidateInfo = {
      source: dbKey,
      matched: matchedFields.length > 0,
      fields: matchedFields,
      url: source.url ?? undefined,
    };
    if (sourcesByDatabase[dbKey]) {
      sourcesByDatabase[dbKey].push(entry);
    } else {
      sourcesByDatabase[dbKey] = [entry];
    }
  }

  const queriedExternalDbs = EXTERNAL_DBS.filter(
    (key) => sourcesByDatabase[key],
  );

  const databasesWithResults = Object.entries(sourcesByDatabase)
    .filter(([, candidates]) => candidates.length > 0)
    .sort(([a], [b]) => {
      const ai = SOURCE_FLOW_ORDER.indexOf(a);
      const bi = SOURCE_FLOW_ORDER.indexOf(b);
      return (
        (ai === -1 ? SOURCE_FLOW_ORDER.length : ai) -
        (bi === -1 ? SOURCE_FLOW_ORDER.length : bi)
      );
    });

  const databasesWithoutResults: [string, CandidateInfo[]][] =
    Object.keys(sourcesByDatabase).length === 0
      ? CORE_EXTERNAL_DBS.map((db) => [db, []])
      : [];

  const isLocalOnly =
    databasesWithResults.length > 0 && queriedExternalDbs.length === 0;

  // Build optional child nodes under Semantic Matching when features exist
  const similarityChildren: GraphNode[] = [];
  const f = verdict.features;
  if (f) {
    if (f.title_sim_fuzzy !== undefined || f.title_sim_semantic !== undefined) {
      const fuzzyPct = Math.round((f.title_sim_fuzzy ?? 0) * 100);
      const semPct = Math.round((f.title_sim_semantic ?? 0) * 100);
      const bestTitle = Math.max(f.title_sim_fuzzy ?? 0, f.title_sim_semantic ?? 0);
      similarityChildren.push({
        id: 'sim-title',
        label: 'Title Lexical & Neural Match',
        type: 'similarity',
        status: bestTitle >= 0.85 ? 'success' : bestTitle >= 0.55 ? 'warning' : 'error',
        detail: `RapidFuzz=${fuzzyPct}% · Sentence-BERT=${semPct}%`,
      });
    }
    if (f.author_jaccard !== undefined || f.year_distance !== undefined) {
      const authPct = Math.round((f.author_jaccard ?? 0) * 100);
      const yrDist = f.year_distance ?? 0;
      similarityChildren.push({
        id: 'sim-meta',
        label: 'Author & Publication Year Alignment',
        type: 'similarity',
        status:
          (f.author_jaccard ?? 0) >= 0.65 && yrDist <= 1
            ? 'success'
            : (f.author_jaccard ?? 0) >= 0.4
              ? 'warning'
              : 'error',
        detail: `Author Jaccard=${authPct}% · Year Δ=${yrDist} yr(s)`,
      });
    }
    if (
      (f.content_alignment_score !== undefined && f.content_alignment_score > 0) ||
      f.best_evidence_sentence
    ) {
      const alignPct = Math.round((f.content_alignment_score ?? 0) * 100);
      similarityChildren.push({
        id: 'sim-evidence',
        label: `Sentence-BERT Abstract Evidence (${alignPct}%)`,
        type: 'similarity',
        status:
          (f.content_alignment_score ?? 0) >= 0.5
            ? 'success'
            : (f.content_alignment_score ?? 0) >= 0.35
              ? 'warning'
              : 'error',
        detail: f.best_evidence_sentence
          ? `Matched Abstract Sentence: "${f.best_evidence_sentence.slice(0, 140)}${f.best_evidence_sentence.length > 140 ? '...' : ''}"`
          : `Context-to-Source semantic alignment score: ${alignPct}%`,
      });
    }
    if (f.cross_lingual_title_detected) {
      const crossTitlePct = Math.round((f.cross_lingual_title_sim ?? 0) * 100);
      similarityChildren.push({
        id: 'sim-cross-lingual-title',
        label: `VI ↔ EN Translated Title Match (${crossTitlePct}%)`,
        type: 'similarity',
        status: 'warning',
        detail: `Translated Vietnamese title matches English publication (${crossTitlePct}%), but original foreign-language title should be preserved per TDTU citation rules.`,
      });
    }
    if (f.cross_lingual_detected && f.bridged_concepts && f.bridged_concepts.length > 0) {
      similarityChildren.push({
        id: 'sim-cross-lingual-bridge',
        label: `VI ↔ EN Academic Concept Bridge (${f.bridged_concepts.length} concepts)`,
        type: 'similarity',
        status: 'success',
        detail: `Bridged pairs: ${f.bridged_concepts.slice(0, 5).join('; ')}`,
      });
    }
    if (f.citation_intent || f.stance_label || f.cross_lingual_detected) {
      const stance = f.stance_label || 'supported';
      similarityChildren.push({
        id: 'sim-intent-stance',
        label: 'Citation Intent & Claim Stance Polarity',
        type: 'similarity',
        status:
          stance === 'contradiction_risk'
            ? 'error'
            : stance === 'partially_supported'
              ? 'warning'
              : 'success',
        detail: [
          f.citation_intent ? `Intent: ${f.citation_intent.toUpperCase()}` : null,
          `Stance: ${stance.toUpperCase()}`,
          f.cross_lingual_detected
            ? f.bridged_concepts && f.bridged_concepts.length > 0
              ? `Bridge (VI↔EN): ${f.bridged_concepts.slice(0, 3).join('; ')}`
              : 'Bridge: VI ↔ EN Cross-Lingual Active'
            : null,
        ]
          .filter(Boolean)
          .join(' · '),
      });
    }
  }

  const graph: GraphNode = {
    id: 'reference',
    label: verdict.citation_raw || 'Unknown Citation',
    type: 'reference',
    status: 'neutral',
    detail: `Confidence: ${(verdict.confidence * 100).toFixed(0)}%`,
    children: [
      {
        id: 'sources',
        label: 'Academic Databases',
        type: 'source',
        status: (
          databasesWithResults.length > 0 ? 'success' : 'no_match'
        ) as GraphNode['status'],
        detail: isLocalOnly
          ? 'Local database cache hit — no external APIs queried'
          : `${databasesWithResults.length} sources queried`,
        children: [
          ...databasesWithResults.flatMap(([db, candidates]) => {
            const config = SOURCE_CONFIG[db] ?? SOURCE_CONFIG.crossref;
            return candidates.map((c, idx) => {
              const cleanedFields = (c.fields || [])
                .map((fld) => getFieldDisplayName(fld).replace(/^the\s+/i, ''))
                .join(', ');
              return {
                id: `${db}-${idx}`,
                label: config.label,
                type: 'candidate' as const,
                status: (c.matched ? 'success' : 'no_match') as GraphNode['status'],
                detail: c.matched
                  ? `Matched fields: ${cleanedFields || 'available details'}.`
                  : 'No match found',
                matchedSource: {
                  source: db,
                  matched_fields: c.fields || [],
                  checked_at: '',
                },
                children:
                  c.matched && c.url
                    ? [
                        {
                          id: `${db}-${idx}-link`,
                          label: 'View Publication',
                          type: 'candidate' as const,
                          status: 'success' as GraphNode['status'],
                          detail: c.url,
                          matchedSource: {
                            source: db,
                            matched_fields: c.fields || [],
                            checked_at: '',
                            url: c.url,
                          },
                        },
                      ]
                    : undefined,
              };
            });
          }),
          ...databasesWithoutResults.map(([db]) => {
            const config = SOURCE_CONFIG[db] ?? SOURCE_CONFIG.crossref;
            return {
              id: `no-${db}`,
              label: config.label,
              type: 'candidate' as const,
              status: 'no_match' as GraphNode['status'],
              detail: 'No results',
            };
          }),
        ],
      },
      {
        id: 'similarity',
        label: 'Semantic Matching',
        type: 'similarity',
        status: (verdict.confidence >= 0.7
          ? 'success'
          : verdict.confidence >= 0.4
            ? 'warning'
            : 'error') as GraphNode['status'],
        detail: `Best match: ${(verdict.confidence * 100).toFixed(0)}%`,
        children: similarityChildren.length > 0 ? similarityChildren : undefined,
      },
      {
        id: 'rules',
        label: 'Verification Rules',
        type: 'rules',
        status: (
          (verdict.triggered_rules ?? []).length > 0 ? 'warning' : 'success'
        ) as GraphNode['status'],
        detail:
          (verdict.triggered_rules ?? []).length > 0
            ? (verdict.triggered_rules ?? []).map(getRuleDisplayName).join('. ')
            : 'No additional warnings were raised.',
        children:
          (verdict.triggered_rules ?? []).length > 0
            ? [
                {
                  id: 'rules-list',
                  label: `${(verdict.triggered_rules ?? []).length} rules triggered`,
                  type: 'rules' as const,
                  status: 'warning' as GraphNode['status'],
                  detail: getVerdictExplanation(verdict),
                },
                ...(verdict.mismatched_fields ?? []).map((field, idx) => ({
                  id: `mismatch-${idx}`,
                  label: `${getFieldDisplayName(field).replace(/^the /, '')} needs review`,
                  type: 'rules' as const,
                  status: 'error' as GraphNode['status'],
                  detail:
                    'This detail differs from the publication record we found.',
                })),
              ]
            : undefined,
      },
      {
        id: 'verdict',
        label: verdict.label.toUpperCase().replace('_', ' '),
        type: 'verdict',
        status: (verdict.label === 'verified'
          ? 'success'
          : verdict.label === 'metadata_error'
            ? 'warning'
            : verdict.label === 'suspected_hallucination'
              ? 'error'
              : 'neutral') as GraphNode['status'],
        detail: getVerdictExplanation(verdict),
      },
    ],
  };

  return { graph, isLocalOnly };
}

function collectAllNodeIds(node: GraphNode, out: string[] = []): string[] {
  out.push(node.id);
  for (const child of node.children ?? []) {
    collectAllNodeIds(child, out);
  }
  return out;
}

export function EvidenceGraph({ verdict, onClose }: EvidenceGraphProps) {
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(
    new Set(['reference', 'sources', 'similarity', 'rules']),
  );

  const { graph: graphData, isLocalOnly } = useMemo(
    () => buildEvidenceGraph(verdict),
    [verdict],
  );

  const toggleExpand = (id: string) => {
    setExpandedNodes((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const expandAll = () => {
    setExpandedNodes(new Set(collectAllNodeIds(graphData)));
  };

  const collapseAll = () => {
    setExpandedNodes(new Set(['reference']));
  };

  const verdictConfig =
    VERDICT_CONFIG[verdict.label] ?? VERDICT_CONFIG.unresolved;
  const Icon = verdictConfig.icon;
  const matchedSourcesCount = (verdict.matched_sources ?? []).filter(
    (s) => s.matched_fields && s.matched_fields.length > 0,
  ).length;
  const neuralPct = Math.round(
    (verdict.features?.content_alignment_score ||
      verdict.features?.title_sim_semantic ||
      verdict.confidence ||
      0) * 100,
  );

  return (
    <div className="space-y-3.5 w-full min-w-0 max-w-full overflow-hidden" data-testid="evidence-graph-container">
      {/* Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className={`p-2 rounded-xl border shrink-0 ${verdictConfig.bgColor} ${verdictConfig.borderColor}`}>
            <Layers className={`h-4 w-4 ${verdictConfig.color}`} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-xs sm:text-sm font-bold text-slate-900 dark:text-slate-100 truncate">
                Neuro-Symbolic Evidence Graph
              </h3>
              <span className="px-1.5 py-0.5 rounded bg-indigo-50 dark:bg-indigo-950/80 border border-indigo-200/70 dark:border-indigo-800 text-[9px] font-mono font-semibold text-indigo-700 dark:text-indigo-300 shrink-0">
                DAG TRACE
              </span>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
              Decision tree from federated retrieval to calibrated verdict
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={expandAll}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-[10px] sm:text-[11px] font-mono text-slate-600 dark:text-slate-300 hover:border-indigo-400 transition-colors cursor-pointer"
          >
            <ChevronsUpDown className="h-3 w-3 shrink-0" />
            <span>Expand</span>
          </button>
          <button
            type="button"
            onClick={collapseAll}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-[10px] sm:text-[11px] font-mono text-slate-600 dark:text-slate-300 hover:border-indigo-400 transition-colors cursor-pointer"
          >
            <ChevronsDownUp className="h-3 w-3 shrink-0" />
            <span>Collapse</span>
          </button>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="px-2 py-1 rounded-lg text-xs font-mono text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 cursor-pointer"
            >
              Close
            </button>
          )}
        </div>
      </div>

      {/* 4-Stage Visual Pipeline Flow Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 p-2.5 rounded-xl bg-slate-100/80 dark:bg-slate-900/90 border border-slate-200/80 dark:border-slate-800">
        <div className="flex items-center justify-between p-2 rounded-lg bg-white dark:bg-slate-950 border border-slate-200/80 dark:border-slate-800 min-w-0">
          <div className="min-w-0">
            <div className="flex items-center gap-1 text-[10px] font-mono uppercase text-slate-400">
              <Database className="h-3 w-3 text-blue-500 shrink-0" />
              <span className="truncate">1. Retrieval</span>
            </div>
            <p className="text-[11px] sm:text-xs font-bold font-mono text-slate-900 dark:text-white mt-0.5 truncate">
              {isLocalOnly
                ? 'Local FTS5 Hit'
                : `${matchedSourcesCount} DB Match(es)`}
            </p>
          </div>
          <ArrowRight className="h-3 w-3 text-slate-300 dark:text-slate-700 hidden sm:block shrink-0" />
        </div>

        <div className="flex items-center justify-between p-2 rounded-lg bg-white dark:bg-slate-950 border border-slate-200/80 dark:border-slate-800 min-w-0">
          <div className="min-w-0">
            <div className="flex items-center gap-1 text-[10px] font-mono uppercase text-slate-400">
              <Brain className="h-3 w-3 text-violet-500 shrink-0" />
              <span className="truncate">2. Neural</span>
            </div>
            <p className="text-[11px] sm:text-xs font-bold font-mono text-slate-900 dark:text-white mt-0.5 truncate">
              Sim: {neuralPct}%
              {verdict.features?.citation_intent
                ? ` · ${verdict.features.citation_intent}`
                : ''}
            </p>
          </div>
          <ArrowRight className="h-3 w-3 text-slate-300 dark:text-slate-700 hidden sm:block shrink-0" />
        </div>

        <div className="flex items-center justify-between p-2 rounded-lg bg-white dark:bg-slate-950 border border-slate-200/80 dark:border-slate-800 min-w-0">
          <div className="min-w-0">
            <div className="flex items-center gap-1 text-[10px] font-mono uppercase text-slate-400">
              <Scale className="h-3 w-3 text-amber-500 shrink-0" />
              <span className="truncate">3. Symbolic</span>
            </div>
            <p className="text-[11px] sm:text-xs font-bold font-mono text-slate-900 dark:text-white mt-0.5 truncate">
              {verdict.triggered_rules.length} Rule(s)
            </p>
          </div>
          <ArrowRight className="h-3 w-3 text-slate-300 dark:text-slate-700 hidden sm:block shrink-0" />
        </div>

        <div className={`flex items-center justify-between p-2 rounded-lg border min-w-0 ${verdictConfig.bgColor} ${verdictConfig.borderColor}`}>
          <div className="min-w-0">
            <div className="flex items-center gap-1 text-[10px] font-mono uppercase text-slate-500 dark:text-slate-400">
              <ShieldCheck className={`h-3 w-3 shrink-0 ${verdictConfig.color}`} />
              <span className="truncate">4. Verdict</span>
            </div>
            <p className={`text-[11px] sm:text-xs font-bold font-mono mt-0.5 truncate ${verdictConfig.color}`}>
              {verdictConfig.label} ({Math.round(verdict.confidence * 100)}%)
            </p>
          </div>
        </div>
      </div>

      {/* Verdict Summary Banner */}
      <div
        className={`p-3 rounded-xl border w-full min-w-0 overflow-hidden ${verdictConfig.bgColor} ${verdictConfig.borderColor}`}
      >
        <div className="flex items-center justify-between gap-2 mb-1 flex-wrap">
          <div className="flex items-center gap-1.5 min-w-0">
            <Icon className={`h-4 w-4 shrink-0 ${verdictConfig.color}`} />
            <span className={`font-bold text-xs font-mono truncate ${verdictConfig.color}`}>
              {verdictConfig.label}
            </span>
          </div>
          {verdict.features?.cross_lingual_detected && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-violet-100 dark:bg-violet-950/90 text-violet-700 dark:text-violet-300 text-[10px] font-mono font-semibold shrink-0">
              <Sparkles className="h-3 w-3 shrink-0" />
              VI ↔ EN Cross-Lingual Bridge
            </span>
          )}
        </div>
        <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed break-words [overflow-wrap:anywhere]">
          {getVerdictExplanation(verdict)}
        </p>
        {verdict.triggered_rules.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {verdict.triggered_rules.map((rule) => (
              <span
                key={rule}
                className="inline-flex items-center gap-1 px-2 py-0.5 bg-white/80 dark:bg-slate-900/80 border border-amber-300/80 dark:border-amber-800 text-amber-800 dark:text-amber-300 rounded-md text-[10px] font-mono font-semibold break-all"
              >
                <ListChecks className="h-3 w-3 shrink-0" />
                {rule}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Interactive Hierarchical DAG Tree (no min-w-fit, never overflows horizontally) */}
      <div className="border border-slate-200 dark:border-slate-800 rounded-xl p-3 sm:p-4 bg-white dark:bg-slate-950 w-full min-w-0 max-w-full overflow-hidden shadow-2xs">
        <EvidenceGraphNode
          node={graphData}
          level={0}
          onExpand={toggleExpand}
          expandedNodes={expandedNodes}
        />
      </div>

      {/* Compact Legend */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400 px-1">
        <div className="flex flex-wrap gap-2.5">
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block" />
            <span>Match / Pass</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-500 inline-block" />
            <span>Warning / Rule</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-red-500 inline-block" />
            <span>Mismatch / Fail</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-slate-400 dark:bg-slate-600 inline-block" />
            <span>No Hit</span>
          </div>
        </div>

        {verdict.mismatched_fields.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-mono text-[10px] uppercase text-red-600 dark:text-red-400 font-semibold">
              Mismatched:
            </span>
            {verdict.mismatched_fields.map((field) => (
              <span
                key={field}
                className="px-1.5 py-0.5 bg-red-50 dark:bg-red-950 text-red-600 dark:text-red-400 rounded text-[10px] font-mono border border-red-200 dark:border-red-800"
              >
                {field}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
