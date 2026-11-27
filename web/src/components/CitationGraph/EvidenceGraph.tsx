import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from '@/i18n';
import {
  Layers,
  ListChecks,
  Database,
  FileSearch,
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
import {
  formatIntentLabel,
  formatStanceLabel,
} from '@/lib/academicTaxonomy';
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
  confidence?: number;
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

function filterValidBridgedConcepts(concepts?: string[] | null): string[] {
  if (!concepts || concepts.length === 0) return [];
  return concepts.filter((item) => {
    const trimmed = item.trim();
    if (!trimmed) return false;
    const parts = trimmed.split(/\s*(?:↔|<->|->|→|=)\s*/);
    if (parts.length === 2) {
      const left = parts[0].trim().toLowerCase();
      const right = parts[1].trim().toLowerCase();
      if (left && right && left === right) return false;
    }
    return true;
  });
}

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
      confidence: typeof source.confidence === 'number' ? source.confidence : undefined,
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
  const bridgedConcepts = filterValidBridgedConcepts(
    f?.bridged_concepts && f.bridged_concepts.length > 0
      ? f.bridged_concepts
      : f?.cross_lingual_bridged_concepts,
  );
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

  const isSourceNotFound = verdict.label === 'suspected_hallucination';

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
      const titleStatus: GraphNode['status'] = isSourceNotFound
        ? bestTitle >= 0.55
          ? 'warning'
          : 'error'
        : bestTitle >= 0.85
          ? 'success'
          : bestTitle >= 0.55
            ? 'warning'
            : 'error';
      similarityChildren.push({
        id: 'sim-title',
        label: isVi ? 'So sánh tên tài liệu' : 'Title Comparison',
        type: 'similarity',
        status: titleStatus,
        detail: isVi
          ? `Khớp mặt chữ: ${fuzzyPct}% · Khớp ý nghĩa: ${semPct}%${xlTitlePct !== null ? ` · Khớp Việt ↔ Anh: ${xlTitlePct}%` : ''}`
          : `Wording match: ${fuzzyPct}% · Meaning match: ${semPct}%${xlTitlePct !== null ? ` · VI ↔ EN match: ${xlTitlePct}%` : ''}`,
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
      const yearPart =
        validYearDist !== null
          ? isVi
            ? validYearDist === 0
              ? 'Khớp năm xuất bản'
              : `Lệch ${validYearDist} năm`
            : validYearDist === 0
              ? 'Year matches'
              : validYearDist === 1
                ? '1 yr off'
                : `${validYearDist} yrs off`
          : null;
      const metaRawPass =
        (f.author_jaccard ?? 0) >= 0.65 && (validYearDist === null || validYearDist <= 1);
      const isVerifiedAbbreviatedAuthors =
        verdict.label === 'verified' &&
        !metaRawPass &&
        (validYearDist === null || validYearDist <= 1);
      const metaStatus: GraphNode['status'] = isSourceNotFound
        ? (f.author_jaccard ?? 0) >= 0.4
          ? 'warning'
          : 'error'
        : isVerifiedAbbreviatedAuthors
          ? 'neutral'
          : metaRawPass
            ? 'success'
            : (f.author_jaccard ?? 0) >= 0.4
              ? 'warning'
              : 'error';
      const authorDetailPart = isVerifiedAbbreviatedAuthors
        ? isVi
          ? 'Danh sách tác giả rút gọn trong bản ghi'
          : 'Abbreviated author list in record'
        : isVi
          ? `Độ khớp tác giả: ${authPct}%`
          : `Author match: ${authPct}%`;
      similarityChildren.push({
        id: 'sim-meta',
        label: isVi
          ? validYearDist !== null
            ? 'So sánh tác giả & năm xuất bản'
            : 'So sánh tác giả'
          : validYearDist !== null
            ? 'Author & Publication Year Check'
            : 'Author Check',
        type: 'similarity',
        status: metaStatus,
        detail:
          yearPart !== null
            ? `${authorDetailPart} · ${yearPart}`
            : authorDetailPart,
      });
    }
    if (f.html_meta_title_sim !== undefined && f.html_meta_title_sim !== null) {
      const htmlSimPct = Math.round(f.html_meta_title_sim * 100);
      const htmlStatus: GraphNode['status'] = isSourceNotFound
        ? f.html_meta_title_sim >= 0.25
          ? 'warning'
          : 'error'
        : f.html_meta_title_sim >= 0.65
          ? 'success'
          : f.html_meta_title_sim >= 0.25
            ? 'warning'
            : 'error';
      similarityChildren.push({
        id: 'sim-html-meta-title',
        label: isVi
          ? `So sánh tiêu đề trang web (${htmlSimPct}%)`
          : `Web Page Title Match (${htmlSimPct}%)`,
        type: 'similarity',
        status: htmlStatus,
        detail: isVi
          ? `Độ khớp với tiêu đề thực tế của trang gốc: ${htmlSimPct}%`
          : `Match with actual web page title: ${htmlSimPct}%`,
      });
    }
    if (
      (f.content_alignment_score !== undefined && f.content_alignment_score > 0) ||
      f.best_evidence_sentence
    ) {
      const alignPct = Math.round((f.content_alignment_score ?? 0) * 100);
      const evStatus: GraphNode['status'] = isSourceNotFound
        ? (f.content_alignment_score ?? 0) >= 0.35
          ? 'warning'
          : 'error'
        : (f.content_alignment_score ?? 0) >= 0.5
          ? 'success'
          : (f.content_alignment_score ?? 0) >= 0.35
            ? 'warning'
            : 'error';
      similarityChildren.push({
        id: 'sim-evidence',
        label: isVi
          ? `Đoạn tóm tắt khớp từ bài gốc (${alignPct}%)`
          : `Matching Passage in Source Abstract (${alignPct}%)`,
        type: 'similarity',
        status: evStatus,
        detail: f.best_evidence_sentence
          ? isVi
            ? `Đoạn tóm tắt khớp: "${f.best_evidence_sentence.slice(0, 140)}${f.best_evidence_sentence.length > 140 ? '…' : ''}"`
            : `Matching excerpt: "${f.best_evidence_sentence.slice(0, 140)}${f.best_evidence_sentence.length > 140 ? '…' : ''}"`
          : isVi
            ? `Mức độ liên quan ngữ cảnh với bài gốc: ${alignPct}%`
            : `Context relevance to source: ${alignPct}%`,
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
          ? `Tiêu đề dịch sang tiếng Việt khớp công trình tiếng Anh (${crossTitlePct}%). Theo chuẩn trích dẫn học thuật phổ biến, nên giữ nguyên tiêu đề gốc bằng tiếng nước ngoài.`
          : `Translated Vietnamese title matches the English publication (${crossTitlePct}%). Standard academic citation guidelines recommend preserving the original publication title.`,
      });
    }
    if (bridgedConcepts.length > 0) {
      similarityChildren.push({
        id: 'sim-cross-lingual-bridge',
        label: isVi
          ? `Thuật ngữ tương đương Việt ↔ Anh (${bridgedConcepts.length} cặp)`
          : `VI ↔ EN Academic Concepts (${bridgedConcepts.length} pairs)`,
        type: 'similarity',
        status: isSourceNotFound ? 'warning' : 'success',
        detail: isVi
          ? `Cặp khái niệm: ${bridgedConcepts.slice(0, 5).join('; ')}`
          : `Matched concepts: ${bridgedConcepts.slice(0, 5).join('; ')}`,
      });
    } else if (hasCrossLingual) {
      const crossScore =
        f.cross_lingual_title_sim ??
        f.semantic_similarity ??
        f.content_alignment_score ??
        f.title_sim_semantic ??
        (typeof f.cross_lingual_alignment === 'number'
          ? f.cross_lingual_alignment
          : undefined);
      const crossPct =
        typeof crossScore === 'number' && crossScore > 0
          ? Math.round(crossScore * 100)
          : null;
      similarityChildren.push({
        id: 'sim-cross-lingual-bridge',
        label: isVi
          ? 'Đối chiếu song ngữ Việt ↔ Anh'
          : 'Bilingual Comparison (VI ↔ EN)',
        type: 'similarity',
        status: isSourceNotFound ? 'warning' : 'success',
        detail: isVi
          ? `Đối chiếu trích dẫn tiếng Việt với ấn phẩm tiếng Anh${crossPct !== null ? ` · Độ khớp nội dung: ${crossPct}%` : ''}`
          : `Matched Vietnamese citation text against the English publication${crossPct !== null ? ` · Content match: ${crossPct}%` : ''}`,
      });
    }
    if (f.citation_intent || f.stance_label || hasCrossLingual) {
      const stance = f.stance_label || 'supported';
      const isUnconfirmedStance = isSourceNotFound || verdict.label === 'unresolved';
      const stanceStatus: GraphNode['status'] =
        stance === 'contradiction_risk'
          ? 'error'
          : stance === 'partially_supported' || isUnconfirmedStance
            ? 'warning'
            : 'success';
      similarityChildren.push({
        id: 'sim-intent-stance',
        label: isVi ? 'Mức độ liên quan ngữ cảnh' : 'Context relevance',
        type: 'similarity',
        status: stanceStatus,
        detail: [
          f.citation_intent
            ? `${isVi ? 'Vai trò trích dẫn' : 'Citation role'}: ${formatIntentLabel(f.citation_intent, resolvedLang)}`
            : null,
          isUnconfirmedStance
            ? isVi
              ? 'Chưa thể đối chiếu (chưa có nguồn khớp xác nhận)'
              : 'Not evaluated (no confirmed source match)'
            : `${isVi ? 'Mức độ phù hợp' : 'Support check'}: ${formatStanceLabel(stance, resolvedLang)}`,
          hasCrossLingual
            ? bridgedConcepts.length > 0
              ? `${isVi ? 'Thuật ngữ Việt ↔ Anh' : 'VI ↔ EN terms'}: ${bridgedConcepts.slice(0, 3).join('; ')}`
              : isVi
                ? 'Đối chiếu song ngữ Việt ↔ Anh'
                : 'Bilingual VI ↔ EN comparison'
            : null,
        ]
          .filter(Boolean)
          .join(' · '),
      });
    }
  }

  // Append compact URL Link Check child node when url_status is present
  const { status: effectiveUrlStatus } = resolveGraphUrlStatus(verdict);
  if (effectiveUrlStatus) {
    const linkStatus: GraphNode['status'] =
      isUrlContentMismatch || effectiveUrlStatus === 'archived_alive'
        ? 'warning'
        : effectiveUrlStatus === 'alive' || effectiveUrlStatus === 'restricted_alive'
          ? isSourceNotFound
            ? 'warning'
            : 'success'
          : 'error';
    const linkLabel = isUrlContentMismatch
      ? isVi
        ? 'Kiểm tra đường dẫn: Trang web không khớp tiêu đề'
        : 'Link Check: Wrong Page'
      : effectiveUrlStatus === 'alive'
        ? isVi
          ? 'Kiểm tra đường dẫn: Đang hoạt động'
          : 'Link Check: Active'
        : effectiveUrlStatus === 'restricted_alive'
          ? isVi
            ? 'Kiểm tra đường dẫn: Yêu cầu đăng nhập / trả phí (link còn hoạt động)'
            : 'Link Check: Paywalled / Login Required (link active)'
          : effectiveUrlStatus === 'archived_alive'
            ? isVi
              ? 'Kiểm tra đường dẫn: Xác minh qua bản lưu Wayback'
              : 'Link Check: Verified via Wayback Archive'
            : effectiveUrlStatus === 'dead_link'
              ? isVi
                ? 'Kiểm tra đường dẫn: Không mở được'
                : 'Link Check: Broken Link'
              : isVi
                ? 'Kiểm tra đường dẫn: Tên miền không tồn tại'
                : 'Link Check: Unreachable Domain';
    const linkDetail =
      isUrlContentMismatch && observedWeb?.title
        ? isVi
          ? `Tiêu đề thực tế của trang web: «${observedWeb.title}»`
          : `Actual web page title: “${observedWeb.title}”`
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

  const isUnconfirmedVerdict =
    isSourceNotFound || verdict.label === 'unresolved';

  interface RankedCandidateNode {
    node: GraphNode;
    confidence: number;
    fieldsCount: number;
    hasLink: boolean;
  }

  const rawCandidateEntries: RankedCandidateNode[] = [
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
            ? 'Vietnamese Legal Registry'
            : db === 'tech_standard' ||
                db === 'vn_tech_standard' ||
                db === 'vn_textbook_registry' ||
                db === 'web_html_meta' ||
                db === 'wayback_html_meta' ||
                db === 'local_db' ||
                db === 'known_papers' ||
                isVi
              ? contextualName
              : config.label;

        const isWebMetaMismatch =
          isUrlContentMismatch &&
          (db === 'web_html_meta' || db === 'wayback_html_meta');
        const isHallucinationCandidate = isUnconfirmedVerdict && c.matched;
        const obsPageTitle = c.title || observedWeb?.title || null;

        const candidateStatus: GraphNode['status'] =
          isWebMetaMismatch || isHallucinationCandidate
            ? 'warning'
            : c.matched
              ? 'success'
              : 'no_match';

        const candidateDetail = isWebMetaMismatch
          ? obsPageTitle
            ? isVi
              ? `Tiêu đề thực tế của trang web: «${obsPageTitle}» — khác với tên tài liệu bạn trích dẫn.`
              : `Actual web page title: “${obsPageTitle}” — does not match the cited title.`
            : isVi
              ? 'Thông tin trang web không khớp với tiêu đề trích dẫn.'
              : 'Web page details do not match the cited title.'
          : isHallucinationCandidate
            ? isVi
              ? `Tài liệu gần giống nhất (Thông tin bản ghi: ${cleanedFields || 'một phần'}) — chưa đủ để xác nhận nguồn trích dẫn.`
              : `Closest similar work (Record fields: ${cleanedFields || 'partial'}) — does not verify cited work.`
            : c.matched
              ? isVi
                ? `Thông tin khớp: ${cleanedFields || 'thông tin sẵn có'}.`
                : `Matched fields: ${cleanedFields || 'available details'}.`
              : isVi
                ? 'Không tìm thấy bản ghi khớp'
                : 'No match found';

        const node: GraphNode = {
          id: `${db}-${idx}`,
          label: candidateLabel,
          type: 'candidate' as const,
          sourceKey: db,
          status: candidateStatus,
          statusText: isWebMetaMismatch
            ? isVi
              ? 'LỆCH NỘI DUNG'
              : 'MISMATCH'
            : isHallucinationCandidate
              ? isVi
                ? 'CHƯA KHỚP'
                : 'UNCONFIRMED'
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
                    label: isVi ? 'Xem tài liệu gốc' : 'View Publication',
                    type: 'candidate' as const,
                    status: (
                      isWebMetaMismatch || isHallucinationCandidate
                        ? 'warning'
                        : 'success'
                    ) as GraphNode['status'],
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

        return {
          node,
          confidence: c.confidence ?? 0,
          fieldsCount: (c.fields || []).length,
          hasLink: Boolean(c.matched && c.url),
        };
      });
    }),
    ...databasesWithoutResults.map(([db]) => {
      const config = SOURCE_CONFIG[db] ?? SOURCE_CONFIG.crossref;
      return {
        node: {
          id: `no-${db}`,
          label: config.label,
          type: 'candidate' as const,
          sourceKey: db,
          status: 'no_match' as GraphNode['status'],
          detail: isVi ? 'Không có kết quả' : 'No results',
        },
        confidence: 0,
        fieldsCount: 0,
        hasLink: false,
      };
    }),
  ];

  // Deduplicate child nodes with identical display label, keeping the stronger match
  const statusRank: Record<GraphNode['status'], number> = {
    success: 4,
    warning: 3,
    neutral: 2,
    error: 1,
    no_match: 0,
  };
  const dedupedCandidateEntries: RankedCandidateNode[] = [];
  const candidateIdxByLabel = new Map<string, number>();
  for (const entry of rawCandidateEntries) {
    const labelKey = entry.node.label.trim().toLowerCase();
    const existingIdx = candidateIdxByLabel.get(labelKey);
    if (existingIdx === undefined) {
      candidateIdxByLabel.set(labelKey, dedupedCandidateEntries.length);
      dedupedCandidateEntries.push(entry);
    } else {
      const existing = dedupedCandidateEntries[existingIdx];
      const entryStatusRank = statusRank[entry.node.status];
      const existingStatusRank = statusRank[existing.node.status];
      const entryIsStronger =
        entryStatusRank > existingStatusRank ||
        (entryStatusRank === existingStatusRank &&
          (entry.confidence > existing.confidence ||
            (entry.confidence === existing.confidence &&
              (entry.fieldsCount > existing.fieldsCount ||
                (entry.fieldsCount === existing.fieldsCount &&
                  Number(entry.hasLink) > Number(existing.hasLink))))));
      const winner = entryIsStronger ? entry : existing;
      const loser = entryIsStronger ? existing : entry;
      dedupedCandidateEntries[existingIdx] = {
        ...winner,
        node: {
          ...winner.node,
          children:
            winner.node.children ??
            (loser.node.status !== 'no_match' ? loser.node.children : undefined),
        },
      };
    }
  }
  const candidateNodes: GraphNode[] = dedupedCandidateEntries.map((e) => e.node);
  const uniqueMatchedSourcesCount = candidateNodes.filter(
    (n) => n.status !== 'no_match',
  ).length;

  const hasPassingCandidate =
    !isUnconfirmedVerdict && candidateNodes.some((n) => n.status === 'success');
  const hasWarningCandidate = candidateNodes.some((n) => n.status === 'warning');
  const sourcesNodeStatus: GraphNode['status'] = hasPassingCandidate
    ? 'success'
    : hasWarningCandidate
      ? 'warning'
      : 'no_match';

  // Differentiate positive verification checks from warning / error / neutral checks
  const mismatchedCount = (verdict.mismatched_fields ?? []).length;
  const hasWarningRule = triggeredRules.some((r) => WARNING_SYMBOLIC_RULES.has(r));
  const rulesNodeStatus: GraphNode['status'] =
    triggeredRules.length === 0 && mismatchedCount === 0
      ? isSourceNotFound
        ? 'error'
        : 'success'
      : isSourceNotFound
        ? 'error'
        : verdict.label === 'metadata_error' || mismatchedCount > 0 || hasWarningRule
          ? 'warning'
          : verdict.label === 'unresolved'
            ? 'neutral'
            : 'success';

  const rawFeatureMatch = Math.max(
    f?.content_alignment_score ?? 0,
    f?.title_sim_semantic ?? 0,
    f?.title_sim_fuzzy ?? 0,
    f?.cross_lingual_title_sim ?? 0,
  );
  const effectiveSimScore = isSourceNotFound
    ? rawFeatureMatch
    : rawFeatureMatch > 0
      ? rawFeatureMatch
      : verdict.confidence;

  const similarityNodeStatus: GraphNode['status'] = isSourceNotFound
    ? databasesWithResults.length === 0 || effectiveSimScore < 0.4
      ? 'error'
      : 'warning'
    : effectiveSimScore >= 0.7
      ? 'success'
      : effectiveSimScore >= 0.4
        ? 'warning'
        : 'error';

  const similarityNodeDetail = isSourceNotFound
    ? effectiveSimScore > 0
      ? isVi
        ? `Độ khớp gần nhất: ${Math.round(effectiveSimScore * 100)}% (chưa đủ để xác nhận nguồn)`
        : `Closest match: ${Math.round(effectiveSimScore * 100)}% (insufficient to confirm source)`
      : isVi
        ? 'Chưa tìm thấy bản gốc để so sánh nội dung'
        : 'No matching publication found to compare'
    : isVi
      ? `Độ khớp cao nhất: ${Math.round(effectiveSimScore * 100)}%`
      : `Best match: ${Math.round(effectiveSimScore * 100)}%`;

  const rootDetail =
    isSourceNotFound || verdict.label === 'unresolved'
      ? isVi
        ? 'Cần kiểm tra lại nguồn gốc trích dẫn này'
        : 'Manual source review recommended'
      : isVi
        ? `Độ khớp xác minh: ${(verdict.confidence * 100).toFixed(0)}%`
        : `Match confidence: ${(verdict.confidence * 100).toFixed(0)}%`;

  const graph: GraphNode = {
    id: 'reference',
    label: verdict.citation_raw || (isVi ? 'Trích dẫn không rõ' : 'Unknown Citation'),
    type: 'reference',
    status: 'neutral',
    detail: rootDetail,
    children: [
      {
        id: 'sources',
        label: isVi ? 'Thư viện học thuật' : 'Academic Libraries',
        type: 'source',
        status: sourcesNodeStatus,
        detail: isLocalOnly
          ? isVi
            ? 'Đã tìm thấy ngay trong Thư viện học thuật CITRA'
            : 'Matched instantly in CITRA Scholarly Library'
          : isCuratedOnly
            ? isVi
              ? 'Đã đối chiếu từ danh mục chính thức'
              : 'Verified against official registry'
            : databasesWithResults.length === 0
              ? isVi
                ? `Đã tra cứu ${databasesWithoutResults.length} thư viện — không tìm thấy bản ghi khớp`
                : `Checked ${databasesWithoutResults.length} academic libraries — no matching record`
              : isVi
                ? `${uniqueMatchedSourcesCount} thư viện có dữ liệu đối chiếu`
                : `${uniqueMatchedSourcesCount} ${uniqueMatchedSourcesCount === 1 ? 'source checked' : 'sources checked'}`,
        children: candidateNodes,
      },
      {
        id: 'similarity',
        label: isVi ? 'So sánh nội dung' : 'Content Comparison',
        type: 'similarity',
        status: similarityNodeStatus,
        detail: similarityNodeDetail,
        children: similarityChildren.length > 0 ? similarityChildren : undefined,
      },
      {
        id: 'rules',
        label: isVi ? 'Tiêu chí kiểm tra' : 'Verification Checks',
        type: 'rules',
        status: rulesNodeStatus,
        detail:
          triggeredRules.length > 0
            ? triggeredRules.map((r) => getRuleDisplayName(r, resolvedLang)).join('. ')
            : isVi
              ? 'Không có lưu ý bổ sung nào.'
              : 'No additional flags were raised.',
        children:
          triggeredRules.length > 0
            ? [
                {
                  id: 'rules-list',
                  label: isVi
                    ? `${triggeredRules.length} tiêu chí đã đối chiếu`
                    : `${triggeredRules.length} ${triggeredRules.length === 1 ? 'check applied' : 'checks applied'}`,
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
                    ? 'Thông tin này khác với ấn phẩm gốc mà hệ thống tìm thấy.'
                    : 'This detail differs from the published record we found.',
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
  const isNotFoundVerdict = verdict.label === 'suspected_hallucination';
  const sourcesChildNodes =
    graphData.children?.find((c) => c.id === 'sources')?.children ?? [];
  const matchedSourcesCount = isNotFoundVerdict
    ? 0
    : sourcesChildNodes.filter(
        (n) => n.status === 'success' || n.status === 'warning',
      ).length;
  const fExt = verdict.features as CrossLingualFeaturesExt | undefined;
  const featureMatchPct = Math.round(
    Math.max(
      verdict.features?.content_alignment_score ?? 0,
      verdict.features?.title_sim_semantic ?? 0,
      verdict.features?.title_sim_fuzzy ?? 0,
      verdict.features?.cross_lingual_title_sim ?? 0,
    ) * 100,
  );
  const contentMatchPct = isNotFoundVerdict
    ? featureMatchPct
    : featureMatchPct > 0
      ? featureMatchPct
      : Math.round((verdict.confidence || 0) * 100);
  const hasCrossLingualBanner =
    Boolean(fExt?.cross_lingual_detected) ||
    Boolean(fExt?.cross_lingual_alignment) ||
    Boolean(fExt?.cross_lingual_title_detected) ||
    (fExt?.cross_lingual_title_sim ?? 0) >= 0.5 ||
    filterValidBridgedConcepts(
      fExt?.bridged_concepts?.length
        ? fExt.bridged_concepts
        : fExt?.cross_lingual_bridged_concepts,
    ).length > 0 ||
    (verdict.triggered_rules ?? []).some(
      (r) =>
        r === 'R-CROSS-LINGUAL-ALIGNMENT' || r === 'R-CROSS-LINGUAL-TITLE-MATCH',
    );
  const { status: bannerUrlStatus } = resolveGraphUrlStatus(verdict);
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
              <h3 className="text-xs sm:text-sm font-bold text-slate-900 dark:text-slate-100 leading-snug">
                {isVi ? 'Các bước đối chiếu trích dẫn' : 'Step-by-Step Verification'}
              </h3>
              <span className="px-2 py-0.5 rounded-md bg-indigo-50 dark:bg-indigo-950/80 border border-indigo-200/70 dark:border-indigo-800 text-[10px] font-semibold tracking-wide text-indigo-700 dark:text-indigo-300 shrink-0">
                {isVi ? 'QUY TRÌNH KIỂM TRA' : 'CHECK FLOW'}
              </span>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-snug mt-0.5">
              {isVi
                ? 'Tóm tắt quá trình tìm kiếm, so sánh và đưa ra kết quả'
                : 'How CITRA searched libraries, compared details, and reached this result'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={expandAll}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-[11px] font-medium text-slate-600 dark:text-slate-300 hover:border-indigo-400 transition-colors cursor-pointer"
          >
            <ChevronsUpDown className="h-3 w-3 shrink-0" />
            <span>{isVi ? 'Mở rộng' : 'Expand'}</span>
          </button>
          <button
            type="button"
            onClick={collapseAll}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-[11px] font-medium text-slate-600 dark:text-slate-300 hover:border-indigo-400 transition-colors cursor-pointer"
          >
            <ChevronsDownUp className="h-3 w-3 shrink-0" />
            <span>{isVi ? 'Thu gọn' : 'Collapse'}</span>
          </button>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="px-2 py-1 rounded-lg text-xs font-medium text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 cursor-pointer"
            >
              {isVi ? 'Đóng' : 'Close'}
            </button>
          )}
        </div>
      </div>

      {/* 4-Stage Visual Flow Strip (wraps cleanly without mid-word clipping) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 p-2.5 rounded-xl bg-slate-100/80 dark:bg-slate-900/90 border border-slate-200/80 dark:border-slate-800">
        <div className="flex items-start justify-between gap-1.5 p-2.5 rounded-lg bg-white dark:bg-slate-950 border border-slate-200/80 dark:border-slate-800 min-w-0">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              <Database className="h-3 w-3 text-blue-500 shrink-0" />
              <span className="leading-tight">{isVi ? '1. Tìm nguồn' : '1. Library Search'}</span>
            </div>
            <p className="text-xs font-semibold text-slate-900 dark:text-white mt-1 leading-snug break-words">
              {isNotFoundVerdict
                ? isVi
                  ? 'Chưa tìm thấy nguồn'
                  : 'No source found'
                : isLocalOnly
                  ? isVi
                    ? 'Thư viện CITRA'
                    : 'CITRA Library'
                  : hasCuratedRegistryHit
                    ? isVi
                      ? 'Danh mục chính thức'
                      : 'Official Registry'
                    : matchedSourcesCount === 0
                      ? isVi
                        ? 'Chưa có kết quả'
                        : 'No match found'
                      : isVi
                        ? `${matchedSourcesCount} thư viện khớp`
                        : matchedSourcesCount === 1
                          ? '1 library match'
                          : `${matchedSourcesCount} library matches`}
            </p>
          </div>
          <ArrowRight className="h-3.5 w-3.5 text-slate-300 dark:text-slate-700 hidden lg:block shrink-0 mt-0.5" />
        </div>

        <div className="flex items-start justify-between gap-1.5 p-2.5 rounded-lg bg-white dark:bg-slate-950 border border-slate-200/80 dark:border-slate-800 min-w-0">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              <FileSearch className="h-3 w-3 text-violet-500 shrink-0" />
              <span className="leading-tight">{isVi ? '2. So sánh nội dung' : '2. Content Match'}</span>
            </div>
            <p className="text-xs font-semibold text-slate-900 dark:text-white mt-1 leading-snug break-words tabular-nums">
              {isNotFoundVerdict && contentMatchPct === 0
                ? isVi
                  ? 'Chưa có bản gốc'
                  : 'No match'
                : isVi
                  ? `Khớp ${contentMatchPct}%`
                  : `${contentMatchPct}% match`}
            </p>
          </div>
          <ArrowRight className="h-3.5 w-3.5 text-slate-300 dark:text-slate-700 hidden lg:block shrink-0 mt-0.5" />
        </div>

        <div className="flex items-start justify-between gap-1.5 p-2.5 rounded-lg bg-white dark:bg-slate-950 border border-slate-200/80 dark:border-slate-800 min-w-0">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              <Scale className="h-3 w-3 text-amber-500 shrink-0" />
              <span className="leading-tight">{isVi ? '3. Đối chiếu tiêu chí' : '3. Detail Checks'}</span>
            </div>
            <p className="text-xs font-semibold text-slate-900 dark:text-white mt-1 leading-snug break-words tabular-nums">
              {isVi
                ? `${verdict.triggered_rules.length} tiêu chí`
                : `${verdict.triggered_rules.length} ${verdict.triggered_rules.length === 1 ? 'check' : 'checks'}`}
            </p>
          </div>
          <ArrowRight className="h-3.5 w-3.5 text-slate-300 dark:text-slate-700 hidden lg:block shrink-0 mt-0.5" />
        </div>

        <div className={`flex items-start justify-between gap-1.5 p-2.5 rounded-lg border min-w-0 ${verdictConfig.bgColor} ${verdictConfig.borderColor}`}>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              <ShieldCheck className={`h-3 w-3 shrink-0 ${verdictConfig.color}`} />
              <span className="leading-tight">{isVi ? '4. Kết quả' : '4. Result'}</span>
            </div>
            <p className={`text-xs font-bold mt-1 leading-snug break-words ${verdictConfig.color}`}>
              {verdictTitle}
            </p>
          </div>
        </div>
      </div>

      {/* Result Summary Banner */}
      <div
        className={`p-3 rounded-xl border w-full min-w-0 overflow-hidden ${verdictConfig.bgColor} ${verdictConfig.borderColor}`}
      >
        <div className="flex items-center justify-between gap-2 mb-1 flex-wrap">
          <div className="flex items-center gap-1.5 min-w-0">
            <Icon className={`h-4 w-4 shrink-0 ${verdictConfig.color}`} />
            <span className={`font-bold text-xs sm:text-[13px] ${verdictConfig.color}`}>
              {verdictTitle}
            </span>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap shrink-0">
            {bannerUrlStatus && (
              <span
                data-testid="evidence-graph-url-status"
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold border ${
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
                    ? 'Trang web không khớp tiêu đề'
                    : 'Page title mismatch'
                  : bannerUrlStatus === 'alive'
                    ? isVi
                      ? 'Liên kết hoạt động'
                      : 'Link active'
                    : bannerUrlStatus === 'restricted_alive'
                      ? isVi
                        ? 'Trang yêu cầu đăng nhập / trả phí'
                        : 'Paywalled / login required'
                      : bannerUrlStatus === 'archived_alive'
                        ? isVi
                          ? 'Bản lưu Wayback'
                          : 'Wayback archived'
                        : bannerUrlStatus === 'dead_link'
                          ? isVi
                            ? 'Đường dẫn không mở được'
                            : 'Broken link'
                          : isVi
                            ? 'Đường dẫn không hợp lệ'
                            : 'Invalid URL'}
              </span>
            )}
            {hasCrossLingualBanner && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-violet-100 dark:bg-violet-950/90 text-violet-700 dark:text-violet-300 text-[11px] font-semibold shrink-0">
                <Sparkles className="h-3 w-3 shrink-0" />
                {isVi
                  ? 'Đối chiếu song ngữ Việt ↔ Anh'
                  : 'Bilingual VI ↔ EN Match'}
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
                className="inline-flex items-center gap-1.5 px-2.5 py-0.5 bg-white/85 dark:bg-slate-900/85 border border-slate-200/90 dark:border-slate-700 text-slate-700 dark:text-slate-200 rounded-md text-[11px] font-medium break-words"
              >
                <ListChecks className={`h-3 w-3 shrink-0 ${verdictConfig.color}`} />
                {getRuleDisplayName(rule, lang)}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Interactive Hierarchical Verification Tree (never overflows horizontally) */}
      <div className="border border-slate-200 dark:border-slate-800 rounded-xl p-3 sm:p-4 bg-white dark:bg-slate-950 w-full min-w-0 max-w-full overflow-hidden shadow-sm">
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
            <span>{isVi ? 'Cần lưu ý' : 'Caution'}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-red-500 inline-block" />
            <span>{isVi ? 'Sai lệch / Chưa khớp' : 'Mismatch / Issue'}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-slate-400 dark:bg-slate-600 inline-block" />
            <span>{isVi ? 'Không có kết quả' : 'Not found'}</span>
          </div>
        </div>

        {verdict.mismatched_fields.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[11px] text-red-600 dark:text-red-400 font-semibold">
              {isVi ? 'Thông tin lệch:' : 'Mismatched:'}
            </span>
            {verdict.mismatched_fields.map((field) => (
              <span
                key={field}
                className="px-2 py-0.5 bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-300 rounded text-[11px] font-medium border border-red-200 dark:border-red-800"
              >
                {getFieldDisplayName(field, lang).replace(/^the\s+/i, '')}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
