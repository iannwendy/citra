import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from '@/i18n';
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
  ExternalLink,
  Link2,
} from 'lucide-react';
import type { Verdict } from '@/api/client';
import {
  extractObservedWebMeta,
  getFieldDisplayName,
  getRuleDisplayName,
  getSourceDisplayName,
  getVerdictExplanation,
} from '@/lib/verdictExplanation';
import { EvidenceGraphNode } from './EvidenceGraphNode';
import type { GraphNode } from './types';
import { SOURCE_CONFIG } from './types';
import { VERDICT_CONFIG, getVerdictNodeTitle } from './verdictConfig';

interface EvidenceGraphProps {
  verdict: Verdict;
  onClose?: () => void;
}

interface CandidateInfo {
  source: string;
  matched: boolean;
  fields?: string[];
  url?: string;
  external_ids?: Record<string, string>;
  venue?: string | null;
  title?: string | null;
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
  'vn_legal_registry',
  'datacite',
  'doi_ra',
  'doaj',
  'openaire_hal',
  'ncbi_biorxiv',
  'huggingface',
  'tech_standard',
  'vn_tech_standard',
  'vn_textbook_registry',
  'wikidata_opencitations',
  'serpapi',
  'web_html_meta',
  'wayback_html_meta',
];
const CURATED_REGISTRY_DBS = new Set([
  'vn_legal_registry',
  'tech_standard',
  'vn_tech_standard',
  'vn_textbook_registry',
]);
const WARNING_SYMBOLIC_RULES = new Set([
  'R-WAYBACK-ARCHIVED',
  'R-BROKEN-LINK',
  'R-VN-LEGAL-SUPERSEDED',
  'R-CONSENSUS-PARTIAL',
  'R-STYLE-INCONSISTENT',
  'R-DOMAIN-EXCEPTION',
  'R-URL-CONTENT-MISMATCH',
  'R-RETRACTED-PAPER',
  'R-CONTENT-MISMATCH',
]);

type CrossLingualFeaturesExt = NonNullable<Verdict['features']> & {
  cross_lingual_bridged_concepts?: string[];
  cross_lingual_alignment?: boolean | number;
  semantic_similarity?: number;
};

function resolveGraphUrlStatus(verdict: Verdict): {
  status: 'alive' | 'restricted_alive' | 'archived_alive' | 'dead_link' | 'fake_domain' | null;
  code: number | null;
} {
  const raw = verdict.url_status ?? verdict.features?.url_status ?? null;
  const code = verdict.url_status_code ?? verdict.features?.url_status_code ?? null;
  const rules = verdict.triggered_rules ?? [];
  const hasArchive =
    Boolean(verdict.archive_url || verdict.features?.archive_url) ||
    rules.includes('R-WAYBACK-ARCHIVED');
  if (raw === 'archived_alive' || (hasArchive && raw !== 'alive' && raw !== 'restricted_alive')) {
    return { status: 'archived_alive', code: code ?? 404 };
  }
  if (
    raw === 'alive' ||
    raw === 'restricted_alive' ||
    raw === 'dead_link' ||
    raw === 'fake_domain'
  ) {
    return { status: raw, code };
  }
  if (rules.includes('R-FAKE-URL')) {
    return { status: 'fake_domain', code: null };
  }
  if (rules.includes('R-DEAD-URL') || rules.includes('R-BROKEN-LINK')) {
    return { status: 'dead_link', code: code ?? 404 };
  }
  return { status: null, code: null };
}
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
  'vn_tech_standard',
  'vn_textbook_registry',
  'wikidata_opencitations',
  'serpapi',
  'web_html_meta',
  'wayback_html_meta',
];

/**
 * Build the hierarchical evidence graph for a single verdict.
 * Exported for unit tests.
 */
export function buildEvidenceGraph(
  verdict: Verdict,
  lang?: 'en' | 'vi',
): { graph: GraphNode; isLocalOnly: boolean; hasCuratedRegistryHit?: boolean } {
  const resolvedLang: 'en' | 'vi' =
    lang ?? (i18n.language?.startsWith('vi') ? 'vi' : 'en');
  const isVi = resolvedLang === 'vi';
  const triggeredRules = verdict.triggered_rules ?? [];
  const isUrlContentMismatch = triggeredRules.includes('R-URL-CONTENT-MISMATCH');
  const observedWeb = extractObservedWebMeta(verdict);

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
      external_ids: source.external_ids,
      venue: source.venue,
      title: source.title,
    };
    if (sourcesByDatabase[dbKey]) {
      sourcesByDatabase[dbKey].push(entry);
    } else {
      sourcesByDatabase[dbKey] = [entry];
    }
  }

  // Synthesize web_html_meta / wayback_html_meta candidate when observed HTML metadata exists
  // (e.g. R-URL-CONTENT-MISMATCH or web resource with html_meta but empty matched_sources)
  if (
    observedWeb &&
    !sourcesByDatabase.web_html_meta &&
    !sourcesByDatabase.wayback_html_meta
  ) {
    const webDbKey = observedWeb.isArchived ? 'wayback_html_meta' : 'web_html_meta';
    const obsFields: string[] = [];
    if (observedWeb.title) obsFields.push('title');
    if (observedWeb.authors?.length) obsFields.push('authors');
    if (observedWeb.year) obsFields.push('year');
    if (observedWeb.venue) obsFields.push('venue');
    sourcesByDatabase[webDbKey] = [
      {
        source: webDbKey,
        matched: true,
        fields: obsFields.length > 0 ? obsFields : ['title'],
        url: observedWeb.url ?? verdict.cited_url ?? undefined,
        venue: observedWeb.venue ?? null,
        title: observedWeb.title ?? null,
      },
    ];
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
    databasesWithResults.length > 0 &&
    queriedExternalDbs.length === 0 &&
    databasesWithResults.every(
      ([db]) => db === 'local_db' || db === 'known_papers',
    );
  const hasCuratedRegistryHit = databasesWithResults.some(([db]) =>
    CURATED_REGISTRY_DBS.has(db),
  );
  const isCuratedOnly =
    databasesWithResults.length > 0 &&
    databasesWithResults.every(([db]) => CURATED_REGISTRY_DBS.has(db));

  // Build optional child nodes under Semantic Matching when features exist
  const similarityChildren: GraphNode[] = [];
  const f = verdict.features as CrossLingualFeaturesExt | undefined;
  const bridgedConcepts =
    (f?.bridged_concepts && f.bridged_concepts.length > 0
      ? f.bridged_concepts
      : f?.cross_lingual_bridged_concepts) ?? [];
  const hasCrossLingual =
    bridgedConcepts.length > 0 ||
    Boolean(f?.cross_lingual_detected) ||
    Boolean(f?.cross_lingual_alignment) ||
    Boolean(f?.cross_lingual_title_detected) ||
    (f?.cross_lingual_title_sim ?? 0) >= 0.5 ||
    triggeredRules.some(
      (r) =>
        r === 'R-CROSS-LINGUAL-ALIGNMENT' || r === 'R-CROSS-LINGUAL-TITLE-MATCH',
    );

  if (f) {
    if (
      f.title_sim_fuzzy !== undefined ||
      f.title_sim_semantic !== undefined ||
      f.cross_lingual_title_sim !== undefined
    ) {
      const fuzzyPct = Math.round((f.title_sim_fuzzy ?? 0) * 100);
      const semPct = Math.round((f.title_sim_semantic ?? 0) * 100);
      const xlTitlePct =
        f.cross_lingual_title_sim !== undefined && f.cross_lingual_title_sim > 0
          ? Math.round(f.cross_lingual_title_sim * 100)
          : null;
      const bestTitle = Math.max(
        f.title_sim_fuzzy ?? 0,
        f.title_sim_semantic ?? 0,
        f.cross_lingual_title_sim ?? 0,
      );
      similarityChildren.push({
        id: 'sim-title',
        label: isVi ? 'Đối sánh từ vựng & ngữ nghĩa tiêu đề' : 'Title Lexical & Neural Match',
        type: 'similarity',
        status: bestTitle >= 0.85 ? 'success' : bestTitle >= 0.55 ? 'warning' : 'error',
        detail: `RapidFuzz=${fuzzyPct}% · Sentence-BERT=${semPct}%${xlTitlePct !== null ? ` · ONNX VI↔EN=${xlTitlePct}%` : ''}`,
      });
    }
    const validYearDist =
      f.year_distance !== undefined &&
      f.year_distance < 900 &&
      f.has_scholarly_candidate !== false
        ? f.year_distance
        : null;
    if (f.author_jaccard !== undefined || validYearDist !== null) {
      const authPct = Math.round((f.author_jaccard ?? 0) * 100);
      similarityChildren.push({
        id: 'sim-meta',
        label: isVi
          ? validYearDist !== null
            ? 'Đối chiếu tác giả & năm xuất bản'
            : 'Đối chiếu tác giả'
          : validYearDist !== null
            ? 'Author & Publication Year Alignment'
            : 'Author Alignment',
        type: 'similarity',
        status:
          (f.author_jaccard ?? 0) >= 0.65 && (validYearDist === null || validYearDist <= 1)
            ? 'success'
            : (f.author_jaccard ?? 0) >= 0.4
              ? 'warning'
              : 'error',
        detail:
          validYearDist !== null
            ? isVi
              ? `Tác giả Jaccard=${authPct}% · Lệch năm Δ=${validYearDist} năm`
              : `Author Jaccard=${authPct}% · Year Δ=${validYearDist} yr(s)`
            : isVi
              ? `Tác giả Jaccard=${authPct}%`
              : `Author Jaccard=${authPct}%`,
      });
    }
    if (f.html_meta_title_sim !== undefined && f.html_meta_title_sim !== null) {
      const htmlSimPct = Math.round(f.html_meta_title_sim * 100);
      similarityChildren.push({
        id: 'sim-html-meta-title',
        label: isVi
          ? `Đối sánh tiêu đề Metadata trang Web (${htmlSimPct}%)`
          : `Live Web HTML Metadata Title Match (${htmlSimPct}%)`,
        type: 'similarity',
        status:
          f.html_meta_title_sim >= 0.65
            ? 'success'
            : f.html_meta_title_sim >= 0.25
              ? 'warning'
              : 'error',
        detail: `html_meta_title_sim=${f.html_meta_title_sim.toFixed(2)} (${htmlSimPct}%)`,
      });
    }
    if (
      (f.content_alignment_score !== undefined && f.content_alignment_score > 0) ||
      f.best_evidence_sentence
    ) {
      const alignPct = Math.round((f.content_alignment_score ?? 0) * 100);
      similarityChildren.push({
        id: 'sim-evidence',
        label: isVi
          ? `Bằng chứng tóm tắt Sentence-BERT (${alignPct}%)`
          : `Sentence-BERT Abstract Evidence (${alignPct}%)`,
        type: 'similarity',
        status:
          (f.content_alignment_score ?? 0) >= 0.5
            ? 'success'
            : (f.content_alignment_score ?? 0) >= 0.35
              ? 'warning'
              : 'error',
        detail: f.best_evidence_sentence
          ? isVi
            ? `Câu tóm tắt khớp: "${f.best_evidence_sentence.slice(0, 140)}${f.best_evidence_sentence.length > 140 ? '...' : ''}"`
            : `Matched Abstract Sentence: "${f.best_evidence_sentence.slice(0, 140)}${f.best_evidence_sentence.length > 140 ? '...' : ''}"`
          : isVi
            ? `Điểm tương đồng ngữ nghĩa ngữ cảnh–nguồn: ${alignPct}%`
            : `Context-to-Source semantic alignment score: ${alignPct}%`,
      });
    }
    if (
      f.cross_lingual_title_detected ||
      (f.cross_lingual_title_sim !== undefined && f.cross_lingual_title_sim > 0)
    ) {
      const crossTitlePct = Math.round((f.cross_lingual_title_sim ?? 0) * 100);
      similarityChildren.push({
        id: 'sim-cross-lingual-title',
        label: isVi
          ? `Khớp tiêu đề dịch Việt ↔ Anh (${crossTitlePct}%)`
          : `VI ↔ EN Translated Title Match (${crossTitlePct}%)`,
        type: 'similarity',
        status: 'warning',
        detail: isVi
          ? `Tiêu đề dịch sang tiếng Việt khớp công trình tiếng Anh (${crossTitlePct}%), nhưng cần giữ nguyên tiêu đề tiếng nước ngoài theo chuẩn TDTU.`
          : `Translated Vietnamese title matches English publication (${crossTitlePct}%), but original foreign-language title should be preserved per TDTU citation rules.`,
      });
    }
    if (bridgedConcepts.length > 0) {
      similarityChildren.push({
        id: 'sim-cross-lingual-bridge',
        label: isVi
          ? `Cầu nối khái niệm học thuật Việt ↔ Anh (${bridgedConcepts.length} khái niệm)`
          : `VI ↔ EN Academic Concept Bridge (${bridgedConcepts.length} concepts)`,
        type: 'similarity',
        status: 'success',
        detail: isVi
          ? `Cặp khái niệm: ${bridgedConcepts.slice(0, 5).join('; ')}`
          : `Bridged pairs: ${bridgedConcepts.slice(0, 5).join('; ')}`,
      });
    } else if (hasCrossLingual) {
      const onnxScore =
        f.cross_lingual_title_sim ??
        f.semantic_similarity ??
        f.content_alignment_score ??
        f.title_sim_semantic ??
        (typeof f.cross_lingual_alignment === 'number'
          ? f.cross_lingual_alignment
          : undefined);
      const onnxPct =
        typeof onnxScore === 'number' && onnxScore > 0
          ? Math.round(onnxScore * 100)
          : null;
      similarityChildren.push({
        id: 'sim-cross-lingual-bridge',
        label: isVi
          ? 'Đối sánh ngữ nghĩa đa ngôn ngữ ONNX INT8 (VI ↔ EN)'
          : 'VI ↔ EN Multilingual ONNX INT8 Embedding Bridge',
        type: 'similarity',
        status: 'success',
        detail: isVi
          ? `Mô hình paraphrase-multilingual-MiniLM-L12-v2 (ONNX INT8)${onnxPct !== null ? ` · Tương đồng ngữ nghĩa: ${onnxPct}%` : ''}`
          : `Model paraphrase-multilingual-MiniLM-L12-v2 (ONNX INT8)${onnxPct !== null ? ` · Semantic similarity: ${onnxPct}%` : ''}`,
      });
    }
    if (f.citation_intent || f.stance_label || hasCrossLingual) {
      const stance = f.stance_label || 'supported';
      similarityChildren.push({
        id: 'sim-intent-stance',
        label: isVi
          ? 'Mục đích trích dẫn & Cực tính quan điểm'
          : 'Citation Intent & Claim Stance Polarity',
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
          hasCrossLingual
            ? bridgedConcepts.length > 0
              ? `Bridge (VI↔EN): ${bridgedConcepts.slice(0, 3).join('; ')}`
              : 'Bridge: VI ↔ EN ONNX INT8 Active'
            : null,
        ]
          .filter(Boolean)
          .join(' · '),
      });
    }
  }

  // Append compact URL Link Check child node when url_status is present
  const { status: effectiveUrlStatus, code: effectiveUrlCode } =
    resolveGraphUrlStatus(verdict);
  if (effectiveUrlStatus) {
    const linkStatus: GraphNode['status'] =
      isUrlContentMismatch || effectiveUrlStatus === 'archived_alive'
        ? 'warning'
        : effectiveUrlStatus === 'alive' || effectiveUrlStatus === 'restricted_alive'
          ? 'success'
          : 'error';
    const linkLabel = isUrlContentMismatch
      ? isVi
        ? `Kiểm tra URL: HTTP ${effectiveUrlCode || 200} · Sai nội dung trang`
        : `URL Link Check: HTTP ${effectiveUrlCode || 200} · Wrong Page`
      : effectiveUrlStatus === 'alive'
        ? isVi
          ? `Kiểm tra URL: HTTP ${effectiveUrlCode || 200} OK`
          : `URL Link Check: HTTP ${effectiveUrlCode || 200} OK`
        : effectiveUrlStatus === 'restricted_alive'
          ? isVi
            ? `Kiểm tra URL: HTTP ${effectiveUrlCode || 403} (Chặn bot — Liên kết sống)`
            : `URL Link Check: HTTP ${effectiveUrlCode || 403} (Bot-Protected / Alive)`
          : effectiveUrlStatus === 'archived_alive'
            ? isVi
              ? 'Kiểm tra URL: Bản lưu Wayback Machine đã xác thực'
              : 'URL Link Check: Wayback Machine Snapshot Verified'
            : effectiveUrlStatus === 'dead_link'
              ? isVi
                ? `Kiểm tra URL: HTTP ${effectiveUrlCode || 404} (Liên kết chết)`
                : `URL Link Check: HTTP ${effectiveUrlCode || 404} Dead Link`
              : isVi
                ? 'Kiểm tra URL: Tên miền không tồn tại / giả mạo'
                : 'URL Link Check: Unresolvable / Fake Domain';
    const linkDetail =
      isUrlContentMismatch && observedWeb?.title
        ? isVi
          ? `Tiêu đề trang thực tế: «${observedWeb.title}»`
          : `Observed page <title>: “${observedWeb.title}”`
        : verdict.archive_url && effectiveUrlStatus === 'archived_alive'
          ? verdict.archive_url
          : verdict.cited_url || undefined;
    similarityChildren.push({
      id: 'url-link-check',
      label: linkLabel,
      type: 'candidate',
      sourceKey:
        effectiveUrlStatus === 'archived_alive' ? 'wayback_html_meta' : 'web_html_meta',
      status: linkStatus,
      detail: linkDetail,
    });
  }

  const candidateNodes: GraphNode[] = [
    ...databasesWithResults.flatMap(([db, candidates]) => {
      const config = SOURCE_CONFIG[db] ?? SOURCE_CONFIG.crossref;
      return candidates.map((c, idx) => {
        const cleanedFields = (c.fields || [])
          .map((fld) => getFieldDisplayName(fld, resolvedLang).replace(/^the\s+/i, ''))
          .join(', ');
        const contextualName = getSourceDisplayName(db, resolvedLang, {
          triggered_rules: verdict.triggered_rules,
          external_ids: c.external_ids,
          venue: c.venue,
          title: c.title,
        });
        const candidateLabel =
          db === 'vn_legal_registry' && !isVi
            ? 'VN Legal Registry'
            : db === 'tech_standard' ||
                db === 'vn_tech_standard' ||
                db === 'vn_textbook_registry' ||
                db === 'web_html_meta' ||
                db === 'wayback_html_meta' ||
                isVi
              ? contextualName
              : config.label;

        const isWebMetaMismatch =
          isUrlContentMismatch &&
          (db === 'web_html_meta' || db === 'wayback_html_meta');
        const obsPageTitle = c.title || observedWeb?.title || null;

        const candidateStatus: GraphNode['status'] = isWebMetaMismatch
          ? 'warning'
          : c.matched
            ? 'success'
            : 'no_match';

        const candidateDetail = isWebMetaMismatch
          ? obsPageTitle
            ? isVi
              ? `Tiêu đề <title> thực tế: «${obsPageTitle}» — không khớp tiêu đề trích dẫn.`
              : `Observed HTML <title>: “${obsPageTitle}” — mismatches cited title.`
            : isVi
              ? 'Metadata trang web không khớp tiêu đề trích dẫn.'
              : 'Observed web page metadata mismatches cited title.'
          : c.matched
            ? isVi
              ? `Trường khớp: ${cleanedFields || 'thông tin sẵn có'}.`
              : `Matched fields: ${cleanedFields || 'available details'}.`
            : isVi
              ? 'Không tìm thấy bản ghi khớp'
              : 'No match found';

        return {
          id: `${db}-${idx}`,
          label: candidateLabel,
          type: 'candidate' as const,
          sourceKey: db,
          status: candidateStatus,
          statusText: isWebMetaMismatch
            ? isVi
              ? 'LỆCH NỘI DUNG'
              : 'MISMATCH'
            : undefined,
          detail: candidateDetail,
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
                    label: isVi ? 'Xem công bố gốc' : 'View Publication',
                    type: 'candidate' as const,
                    status: (isWebMetaMismatch ? 'warning' : 'success') as GraphNode['status'],
                    detail: c.url,
                    iconOverride: (
                      <ExternalLink className="h-4 w-4 text-indigo-600 dark:text-indigo-400 shrink-0" />
                    ),
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
        sourceKey: db,
        status: 'no_match' as GraphNode['status'],
        detail: isVi ? 'Không có kết quả' : 'No results',
      };
    }),
  ];

  const hasPassingCandidate = candidateNodes.some((n) => n.status === 'success');
  const hasWarningCandidate = candidateNodes.some((n) => n.status === 'warning');
  const sourcesNodeStatus: GraphNode['status'] = hasPassingCandidate
    ? 'success'
    : hasWarningCandidate
      ? 'warning'
      : 'no_match';

  // Differentiate positive verification rules from warning / error / neutral rules
  const mismatchedCount = (verdict.mismatched_fields ?? []).length;
  const hasWarningRule = triggeredRules.some((r) => WARNING_SYMBOLIC_RULES.has(r));
  const rulesNodeStatus: GraphNode['status'] =
    triggeredRules.length === 0 && mismatchedCount === 0
      ? 'success'
      : verdict.label === 'suspected_hallucination'
        ? 'error'
        : verdict.label === 'metadata_error' || mismatchedCount > 0 || hasWarningRule
          ? 'warning'
          : verdict.label === 'unresolved'
            ? 'neutral'
            : 'success';

  const graph: GraphNode = {
    id: 'reference',
    label: verdict.citation_raw || (isVi ? 'Trích dẫn không rõ' : 'Unknown Citation'),
    type: 'reference',
    status: 'neutral',
    detail: isVi
      ? `Độ tin cậy: ${(verdict.confidence * 100).toFixed(0)}%`
      : `Confidence: ${(verdict.confidence * 100).toFixed(0)}%`,
    children: [
      {
        id: 'sources',
        label: isVi ? 'Cơ sở dữ liệu học thuật' : 'Academic Databases',
        type: 'source',
        status: sourcesNodeStatus,
        detail: isLocalOnly
          ? isVi
            ? 'Khớp bộ nhớ đệm cục bộ — không cần truy vấn API ngoài'
            : 'Local database cache hit — no external APIs queried'
          : isCuratedOnly
            ? isVi
              ? 'Danh mục Chuẩn hóa — xác thực từ cơ sở dữ liệu quy chuẩn'
              : 'Curated Registry Hit — verified against authoritative registry'
            : isVi
              ? `${databasesWithResults.length} nguồn được truy vấn`
              : `${databasesWithResults.length} sources queried`,
        children: candidateNodes,
      },
      {
        id: 'similarity',
        label: isVi ? 'Đối sánh ngữ nghĩa' : 'Semantic Matching',
        type: 'similarity',
        status: (verdict.confidence >= 0.7
          ? 'success'
          : verdict.confidence >= 0.4
            ? 'warning'
            : 'error') as GraphNode['status'],
        detail: isVi
          ? `Khớp cao nhất: ${(verdict.confidence * 100).toFixed(0)}%`
          : `Best match: ${(verdict.confidence * 100).toFixed(0)}%`,
        children: similarityChildren.length > 0 ? similarityChildren : undefined,
      },
      {
        id: 'rules',
        label: isVi ? 'Luật xác minh' : 'Verification Rules',
        type: 'rules',
        status: rulesNodeStatus,
        detail:
          triggeredRules.length > 0
            ? triggeredRules.map((r) => getRuleDisplayName(r, resolvedLang)).join('. ')
            : isVi
              ? 'Không có cảnh báo bổ sung nào được phát hiện.'
              : 'No additional warnings were raised.',
        children:
          triggeredRules.length > 0
            ? [
                {
                  id: 'rules-list',
                  label: isVi
                    ? `${triggeredRules.length} luật được kích hoạt`
                    : `${triggeredRules.length} rules triggered`,
                  type: 'rules' as const,
                  status: rulesNodeStatus,
                  detail: getVerdictExplanation(verdict, resolvedLang),
                },
                ...(verdict.mismatched_fields ?? []).map((field, idx) => ({
                  id: `mismatch-${idx}`,
                  label: isVi
                    ? `${getFieldDisplayName(field, resolvedLang)} cần kiểm tra`
                    : `${getFieldDisplayName(field, resolvedLang).replace(/^the /, '')} needs review`,
                  type: 'rules' as const,
                  status: 'error' as GraphNode['status'],
                  detail: isVi
                    ? 'Thông tin này khác với hồ sơ công bố mà chúng tôi tìm thấy.'
                    : 'This detail differs from the publication record we found.',
                })),
              ]
            : undefined,
      },
      {
        id: 'verdict',
        label: getVerdictNodeTitle(verdict, isVi),
        type: 'verdict',
        verdictLabel: verdict.label,
        status: (verdict.label === 'verified'
          ? 'success'
          : verdict.label === 'metadata_error'
            ? 'warning'
            : verdict.label === 'suspected_hallucination'
              ? 'error'
              : 'neutral') as GraphNode['status'],
        detail: getVerdictExplanation(verdict, resolvedLang),
      },
    ],
  };

  return { graph, isLocalOnly, hasCuratedRegistryHit };
}

function collectAllNodeIds(node: GraphNode, out: string[] = []): string[] {
  out.push(node.id);
  for (const child of node.children ?? []) {
    collectAllNodeIds(child, out);
  }
  return out;
}

export function EvidenceGraph({ verdict, onClose }: EvidenceGraphProps) {
  const { i18n: i18nInstance } = useTranslation();
  const isVi = Boolean(i18nInstance.language?.startsWith('vi'));
  const lang: 'en' | 'vi' = isVi ? 'vi' : 'en';
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(
    new Set(['reference', 'sources', 'similarity', 'rules']),
  );

  const { graph: graphData, isLocalOnly, hasCuratedRegistryHit } = useMemo(
    () => buildEvidenceGraph(verdict, lang),
    [verdict, lang],
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
  const verdictTitle = getVerdictNodeTitle(verdict, isVi);
  const Icon = verdictConfig.icon;
  const matchedSourcesCount = (verdict.matched_sources ?? []).filter(
    (s) => s.matched_fields && s.matched_fields.length > 0,
  ).length;
  const fExt = verdict.features as CrossLingualFeaturesExt | undefined;
  const neuralPct = Math.round(
    Math.max(
      verdict.features?.content_alignment_score ?? 0,
      verdict.features?.title_sim_semantic ?? 0,
      verdict.features?.cross_lingual_title_sim ?? 0,
      verdict.confidence || 0,
    ) * 100,
  );
  const hasCrossLingualBanner =
    Boolean(fExt?.cross_lingual_detected) ||
    Boolean(fExt?.cross_lingual_alignment) ||
    Boolean(fExt?.cross_lingual_title_detected) ||
    (fExt?.cross_lingual_title_sim ?? 0) >= 0.5 ||
    (fExt?.bridged_concepts?.length ?? fExt?.cross_lingual_bridged_concepts?.length ?? 0) > 0 ||
    (verdict.triggered_rules ?? []).some(
      (r) =>
        r === 'R-CROSS-LINGUAL-ALIGNMENT' || r === 'R-CROSS-LINGUAL-TITLE-MATCH',
    );
  const { status: bannerUrlStatus, code: bannerUrlCode } =
    resolveGraphUrlStatus(verdict);
  const isUrlMismatchBanner = (verdict.triggered_rules ?? []).includes(
    'R-URL-CONTENT-MISMATCH',
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
                {isVi ? 'Đồ Thị Bằng Chứng Neuro-Symbolic' : 'Neuro-Symbolic Evidence Graph'}
              </h3>
              <span className="px-1.5 py-0.5 rounded bg-indigo-50 dark:bg-indigo-950/80 border border-indigo-200/70 dark:border-indigo-800 text-[9px] font-mono font-semibold text-indigo-700 dark:text-indigo-300 shrink-0">
                {isVi ? 'TRUY VẾT DAG' : 'DAG TRACE'}
              </span>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
              {isVi
                ? 'Cây quyết định từ truy xuất liên hợp đến phán quyết hiệu chỉnh'
                : 'Decision tree from federated retrieval to calibrated verdict'}
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
            <span>{isVi ? 'Mở rộng' : 'Expand'}</span>
          </button>
          <button
            type="button"
            onClick={collapseAll}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-[10px] sm:text-[11px] font-mono text-slate-600 dark:text-slate-300 hover:border-indigo-400 transition-colors cursor-pointer"
          >
            <ChevronsDownUp className="h-3 w-3 shrink-0" />
            <span>{isVi ? 'Thu gọn' : 'Collapse'}</span>
          </button>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="px-2 py-1 rounded-lg text-xs font-mono text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 cursor-pointer"
            >
              {isVi ? 'Đóng' : 'Close'}
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
              <span className="truncate">{isVi ? '1. Truy xuất' : '1. Retrieval'}</span>
            </div>
            <p className="text-[11px] sm:text-xs font-bold font-mono text-slate-900 dark:text-white mt-0.5 truncate">
              {isLocalOnly
                ? isVi
                  ? 'Khớp FTS5 cục bộ'
                  : 'Local FTS5 Hit'
                : hasCuratedRegistryHit
                  ? isVi
                    ? 'Danh mục Chuẩn hóa'
                    : 'Curated Registry Hit'
                  : isVi
                    ? `${matchedSourcesCount} CSDL khớp`
                    : `${matchedSourcesCount} DB Match(es)`}
            </p>
          </div>
          <ArrowRight className="h-3 w-3 text-slate-300 dark:text-slate-700 hidden sm:block shrink-0" />
        </div>

        <div className="flex items-center justify-between p-2 rounded-lg bg-white dark:bg-slate-950 border border-slate-200/80 dark:border-slate-800 min-w-0">
          <div className="min-w-0">
            <div className="flex items-center gap-1 text-[10px] font-mono uppercase text-slate-400">
              <Brain className="h-3 w-3 text-violet-500 shrink-0" />
              <span className="truncate">{isVi ? '2. Ngữ nghĩa' : '2. Neural'}</span>
            </div>
            <p className="text-[11px] sm:text-xs font-bold font-mono text-slate-900 dark:text-white mt-0.5 truncate">
              {isVi ? 'Tương đồng:' : 'Sim:'} {neuralPct}%
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
              <span className="truncate">{isVi ? '3. Luật logic' : '3. Symbolic'}</span>
            </div>
            <p className="text-[11px] sm:text-xs font-bold font-mono text-slate-900 dark:text-white mt-0.5 truncate">
              {isVi
                ? `${verdict.triggered_rules.length} Luật`
                : `${verdict.triggered_rules.length} Rule(s)`}
            </p>
          </div>
          <ArrowRight className="h-3 w-3 text-slate-300 dark:text-slate-700 hidden sm:block shrink-0" />
        </div>

        <div className={`flex items-center justify-between p-2 rounded-lg border min-w-0 ${verdictConfig.bgColor} ${verdictConfig.borderColor}`}>
          <div className="min-w-0">
            <div className="flex items-center gap-1 text-[10px] font-mono uppercase text-slate-500 dark:text-slate-400">
              <ShieldCheck className={`h-3 w-3 shrink-0 ${verdictConfig.color}`} />
              <span className="truncate">{isVi ? '4. Phán quyết' : '4. Verdict'}</span>
            </div>
            <p className={`text-[11px] sm:text-xs font-bold font-mono mt-0.5 truncate ${verdictConfig.color}`}>
              {verdictTitle} ({Math.round(verdict.confidence * 100)}%)
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
              {verdictTitle}
            </span>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap shrink-0">
            {bannerUrlStatus && (
              <span
                data-testid="evidence-graph-url-status"
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-mono font-semibold border ${
                  isUrlMismatchBanner || bannerUrlStatus === 'archived_alive'
                    ? 'bg-amber-100/90 dark:bg-amber-950/90 text-amber-800 dark:text-amber-300 border-amber-300 dark:border-amber-800'
                    : bannerUrlStatus === 'alive' || bannerUrlStatus === 'restricted_alive'
                      ? 'bg-emerald-100/90 dark:bg-emerald-950/90 text-emerald-800 dark:text-emerald-300 border-emerald-300 dark:border-emerald-800'
                      : 'bg-red-100/90 dark:bg-red-950/90 text-red-800 dark:text-red-300 border-red-300 dark:border-red-800'
                }`}
              >
                <Link2 className="h-3 w-3 shrink-0" />
                {isUrlMismatchBanner
                  ? isVi
                    ? `HTTP ${bannerUrlCode || 200} · Sai trang`
                    : `HTTP ${bannerUrlCode || 200} · Wrong Page`
                  : bannerUrlStatus === 'alive'
                    ? `HTTP ${bannerUrlCode || 200} OK`
                    : bannerUrlStatus === 'restricted_alive'
                      ? `HTTP ${bannerUrlCode || 403} OK`
                      : bannerUrlStatus === 'archived_alive'
                        ? isVi
                          ? 'Bản lưu Wayback'
                          : 'Wayback Archived'
                        : bannerUrlStatus === 'dead_link'
                          ? `HTTP ${bannerUrlCode || 404} Dead`
                          : isVi
                            ? 'URL giả'
                            : 'Fake URL'}
              </span>
            )}
            {hasCrossLingualBanner && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-violet-100 dark:bg-violet-950/90 text-violet-700 dark:text-violet-300 text-[10px] font-mono font-semibold shrink-0">
                <Sparkles className="h-3 w-3 shrink-0" />
                {isVi
                  ? 'Cầu nối ngữ nghĩa ONNX INT8 (Việt ↔ Anh)'
                  : 'VI ↔ EN ONNX INT8 Cross-Lingual Bridge'}
              </span>
            )}
          </div>
        </div>
        <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed break-words [overflow-wrap:anywhere]">
          {getVerdictExplanation(verdict, lang)}
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
            <span>{isVi ? 'Khớp / Đạt' : 'Match / Pass'}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-500 inline-block" />
            <span>{isVi ? 'Cảnh báo / Luật' : 'Warning / Rule'}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-red-500 inline-block" />
            <span>{isVi ? 'Sai lệch / Lỗi' : 'Mismatch / Fail'}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-slate-400 dark:bg-slate-600 inline-block" />
            <span>{isVi ? 'Không tìm thấy' : 'No Hit'}</span>
          </div>
        </div>

        {verdict.mismatched_fields.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-mono text-[10px] uppercase text-red-600 dark:text-red-400 font-semibold">
              {isVi ? 'Trường lệch:' : 'Mismatched:'}
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
