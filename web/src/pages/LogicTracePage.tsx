import { useState, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { type Verdict } from '@/api/client';
import { RuleInspector } from '@/components/RuleInspector';
import { EvidenceGraph } from '@/components/CitationGraph';
import { VerdictBadge } from '@/components/VerdictBadge';
import { DecisionSupportBanner } from '@/components/DecisionSupportBanner';
import { UpgradeModal } from '@/components/UpgradeModal';
import {
  getCitationMarkerLabel,
  getSearchStepDescription,
  getVerdictExplanation,
  isUrlResource,
} from '@/lib/verdictExplanation';
import {
  formatCitationStyleLabel,
  formatIntentLabel as formatTaxonomyIntent,
  formatStanceLabel as formatTaxonomyStance,
  formatUserError,
  getVerdictDisplay,
  sanitizeReasoningForDisplay,
} from '@/lib/academicTaxonomy';
import { useEssayPolling } from '@/hooks/useEssayPolling';
import { EssayHeader } from './essay/EssayHeader';
import {
  ReportSummaryAndNavBar,
  computeReportBucketCounts,
  getEffectiveVerdictKey,
} from './EssayPage';
import {
  Loader2,
  AlertCircle,
  CheckCircle,
  XCircle,
  HelpCircle,
  ChevronRight,
  GitBranch,
  BookOpen,
  Sparkles,
  Languages,
  ArrowLeft,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

/* ============================================================
   SourceLogic — Verification Reasoning Page (L3)
   Shows step-by-step verification trace for each citation
   ============================================================ */

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

type TraceStepStatus = 'pending' | 'active' | 'completed' | 'error';

interface TraceStep {
  id: string;
  label: string;
  description?: string;
  status: TraceStepStatus;
  detail?: string;
  collapsibleDetail?: boolean;
  tag: string;
}

function getStepStatusColor(status: TraceStepStatus): {
  bg: string;
  border: string;
  icon: React.ReactNode;
  text: string;
} {
  switch (status) {
    case 'completed':
      return {
        bg: 'bg-emerald-50/70 dark:bg-emerald-950/30',
        border: 'border-emerald-200 dark:border-emerald-800',
        icon: <CheckCircle className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />,
        text: 'text-emerald-700 dark:text-emerald-300',
      };
    case 'active':
      return {
        bg: 'bg-amber-50/70 dark:bg-amber-950/30',
        border: 'border-amber-200 dark:border-amber-800',
        icon: <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-400" />,
        text: 'text-amber-700 dark:text-amber-300',
      };
    case 'error':
      return {
        bg: 'bg-red-50/70 dark:bg-red-950/30',
        border: 'border-red-200 dark:border-red-800',
        icon: <XCircle className="h-4 w-4 text-red-600 dark:text-red-400" />,
        text: 'text-red-700 dark:text-red-300',
      };
    default:
      return {
        bg: 'bg-slate-50 dark:bg-slate-900',
        border: 'border-slate-200 dark:border-slate-800',
        icon: <HelpCircle className="h-4 w-4 text-slate-400" />,
        text: 'text-slate-600 dark:text-slate-300',
      };
  }
}

function cleanTraceText(text: string, lang: 'vi' | 'en'): string {
  let out = sanitizeReasoningForDisplay(text, lang);
  out = out
    .replace(/\s*\(\s*HTTP\s+\d{3}(?:\s+OK)?\s*\)/gi, '')
    .replace(/\bHTTP\s+\d{3}(?:\s+OK)?\b/gi, '');
  if (lang === 'vi') {
    out = out
      .replace(/ứng viên bài báo/gi, 'tài liệu gần giống')
      .replace(/(\d+)\s+đặc trưng/gi, '$1 tiêu chí');
  } else {
    out = out.replace(/(\d+)\s+observed features/gi, '$1 checks');
  }
  return out.replace(/\s{2,}/g, ' ').trim();
}

function buildTraceSteps(verdict: Verdict, lang: 'vi' | 'en'): TraceStep[] {
  const sources = verdict.matched_sources ?? [];
  const f = verdict.features;
  const urlStatus = verdict.url_status ?? f?.url_status;

  const featureParts: string[] = [];
  if (f?.title_sim_fuzzy !== undefined) {
    const pct = Math.round(f.title_sim_fuzzy * 100);
    featureParts.push(
      lang === 'vi' ? `Khớp mặt chữ tiêu đề: ${pct}%` : `Title wording match: ${pct}%`,
    );
  }
  if (f?.title_sim_semantic !== undefined && f.title_sim_semantic > 0) {
    const pct = Math.round(f.title_sim_semantic * 100);
    featureParts.push(
      lang === 'vi' ? `Khớp ý nghĩa tiêu đề: ${pct}%` : `Title meaning match: ${pct}%`,
    );
  }
  if (f?.author_jaccard !== undefined) {
    const pct = Math.round(f.author_jaccard * 100);
    featureParts.push(
      lang === 'vi' ? `Độ khớp tác giả: ${pct}%` : `Author match: ${pct}%`,
    );
  }
  if (
    f?.year_distance !== undefined &&
    f.year_distance < 900 &&
    f.has_scholarly_candidate !== false
  ) {
    featureParts.push(
      lang === 'vi'
        ? f.year_distance === 0
          ? 'Năm xuất bản: Khớp'
          : `Lệch năm xuất bản: ${f.year_distance} năm`
        : f.year_distance === 0
          ? 'Publication year: Matches'
          : `Year difference: ${f.year_distance} ${f.year_distance === 1 ? 'yr' : 'yrs'}`,
    );
  }
  if (f?.venue_sim !== undefined && f.venue_sim > 0) {
    const pct = Math.round(f.venue_sim * 100);
    featureParts.push(
      lang === 'vi' ? `Độ khớp nơi công bố: ${pct}%` : `Venue match: ${pct}%`,
    );
  }
  if (f?.doi_exact_match !== undefined) {
    featureParts.push(
      lang === 'vi'
        ? `Khớp mã DOI: ${f.doi_exact_match ? 'Có' : 'Không'}`
        : `DOI matched: ${f.doi_exact_match ? 'Yes' : 'No'}`,
    );
  }
  if (f?.content_alignment_score !== undefined && f.content_alignment_score > 0) {
    const pct = Math.round(f.content_alignment_score * 100);
    featureParts.push(
      lang === 'vi'
        ? `Mức độ liên quan ngữ cảnh: ${pct}%`
        : `Context relevance: ${pct}%`,
    );
  }
  if (
    f?.best_evidence_score !== undefined &&
    f?.best_evidence_score !== null &&
    f.best_evidence_score > 0
  ) {
    const pct = Math.round(f.best_evidence_score * 100);
    featureParts.push(
      lang === 'vi' ? `Độ khớp đoạn tóm tắt: ${pct}%` : `Abstract match: ${pct}%`,
    );
  }
  if (f?.citation_intent) {
    featureParts.push(
      lang === 'vi'
        ? `Vai trò trích dẫn: ${formatTaxonomyIntent(f.citation_intent, lang)}`
        : `Citation role: ${formatTaxonomyIntent(f.citation_intent, lang)}`,
    );
  }
  if (f?.stance_label) {
    featureParts.push(
      lang === 'vi'
        ? `Mức độ phù hợp: ${formatTaxonomyStance(f.stance_label, lang)}`
        : `Support check: ${formatTaxonomyStance(f.stance_label, lang)}`,
    );
  }
  if (f?.html_meta_title_sim !== undefined && f.html_meta_title_sim !== null) {
    const pct = Math.round(f.html_meta_title_sim * 100);
    featureParts.push(
      lang === 'vi' ? `Khớp tiêu đề trang web: ${pct}%` : `Web page title match: ${pct}%`,
    );
  }
  const extF = f as
    | (NonNullable<Verdict['features']> & {
        cross_lingual_bridged_concepts?: string[];
        cross_lingual_alignment?: boolean | number;
      })
    | undefined;
  const hasCrossLingualRuleInTrace = (verdict.triggered_rules ?? []).some(
    (r) => r === 'R-CROSS-LINGUAL-ALIGNMENT' || r === 'R-CROSS-LINGUAL-TITLE-MATCH',
  );
  if (
    f?.cross_lingual_detected ||
    extF?.cross_lingual_alignment ||
    f?.cross_lingual_title_detected ||
    hasCrossLingualRuleInTrace
  ) {
    const bridged = filterValidBridgedConcepts(
      extF?.cross_lingual_bridged_concepts?.length
        ? extF.cross_lingual_bridged_concepts
        : f?.bridged_concepts,
    );
    featureParts.push(
      lang === 'vi'
        ? bridged.length > 0
          ? `Đối chiếu Việt ↔ Anh (${bridged.slice(0, 2).join(', ')})`
          : 'Đối chiếu song ngữ Việt ↔ Anh'
        : bridged.length > 0
          ? `Bilingual VI ↔ EN (${bridged.slice(0, 2).join(', ')})`
          : 'Bilingual VI ↔ EN match',
    );
  }
  if (
    f?.cross_lingual_title_detected ||
    (f?.cross_lingual_title_sim !== undefined && f.cross_lingual_title_sim > 0)
  ) {
    const pct = Math.round((f.cross_lingual_title_sim ?? 0) * 100);
    featureParts.push(
      lang === 'vi'
        ? `Khớp tiêu đề dịch Việt ↔ Anh: ${pct}%`
        : `VI ↔ EN title match: ${pct}%`,
    );
  }
  if (urlStatus) {
    const humanLinkStatus =
      urlStatus === 'alive'
        ? lang === 'vi'
          ? 'Liên kết web: Đang hoạt động'
          : 'Web link: Active'
        : urlStatus === 'restricted_alive'
          ? lang === 'vi'
            ? 'Liên kết web: Yêu cầu đăng nhập / trả phí'
            : 'Web link: Paywalled / login required'
          : urlStatus === 'archived_alive'
            ? lang === 'vi'
              ? 'Liên kết web: Xác minh qua bản lưu Wayback'
              : 'Web link: Verified via Wayback'
            : urlStatus === 'dead_link'
              ? lang === 'vi'
                ? 'Liên kết web: Không mở được'
                : 'Web link: Broken'
              : lang === 'vi'
                ? 'Liên kết web: Tên miền không tồn tại'
                : 'Web link: Unreachable domain';
    featureParts.push(humanLinkStatus);
  }

  const hasSourceHit = sources.length > 0;
  const hasComparableEvidence =
    hasSourceHit ||
    Boolean(urlStatus) ||
    verdict.label === 'verified' ||
    verdict.label === 'resource';

  const step2Status: TraceStepStatus = hasSourceHit
    ? verdict.label === 'suspected_hallucination'
      ? 'active'
      : 'completed'
    : verdict.label === 'suspected_hallucination'
      ? 'error'
      : 'pending';

  const step3Status: TraceStepStatus = !hasComparableEvidence
    ? verdict.label === 'suspected_hallucination'
      ? 'error'
      : 'pending'
    : verdict.label === 'suspected_hallucination'
      ? 'error'
      : verdict.label === 'metadata_error' || (verdict.mismatched_fields?.length ?? 0) > 0
        ? 'active'
        : 'completed';

  const step4Status: TraceStepStatus =
    verdict.label === 'suspected_hallucination'
      ? 'error'
      : verdict.label === 'metadata_error'
        ? 'active'
        : verdict.label === 'verified' || verdict.label === 'resource'
          ? 'completed'
          : 'pending';

  return [
    {
      id: 'parse',
      label: lang === 'vi' ? '1. Đọc & ghép trích dẫn' : '1. Read & link citation',
      description:
        lang === 'vi'
          ? 'Đọc nội dung trích dẫn và nối với mục tương ứng trong danh mục tài liệu tham khảo.'
          : 'Read the citation details and connect it to your reference list entry.',
      status: 'completed',
      detail: verdict.citation_raw,
      tag: lang === 'vi' ? 'BƯỚC 1 · ĐỌC TRÍCH DẪN' : 'STEP 1 · READ CITATION',
    },
    {
      id: 'search',
      label:
        lang === 'vi'
          ? '2. Tìm nguồn trên thư viện học thuật'
          : '2. Search academic libraries',
      description: cleanTraceText(getSearchStepDescription(verdict, lang), lang),
      status: step2Status,
      tag: lang === 'vi' ? 'BƯỚC 2 · TRA CỨU THƯ VIỆN' : 'STEP 2 · LIBRARY SEARCH',
    },
    {
      id: 'compare',
      label:
        lang === 'vi'
          ? '3. So sánh thông tin & kiểm tra liên kết'
          : '3. Compare details & link status',
      description: hasComparableEvidence
        ? lang === 'vi'
          ? 'Đối chiếu tiêu đề, tác giả, năm xuất bản, mức độ liên quan ngữ cảnh và trạng thái đường dẫn.'
          : 'Compare title, authors, publication year, context relevance, and link status.'
        : lang === 'vi'
          ? 'Chưa tìm thấy bản gốc tương ứng để đối chiếu chi tiết từng thông tin.'
          : 'No matching publication was found to compare details.',
      status: step3Status,
      detail: featureParts.length > 0 ? featureParts.join(' · ') : undefined,
      collapsibleDetail: true,
      tag: lang === 'vi' ? 'BƯỚC 3 · SO SÁNH' : 'STEP 3 · COMPARISON',
    },
    {
      id: 'rules',
      label:
        lang === 'vi'
          ? '4. Đối chiếu tiêu chí kiểm tra'
          : '4. Apply verification checks',
      description:
        verdict.triggered_rules.length > 0
          ? lang === 'vi'
            ? `Đã đối chiếu ${verdict.triggered_rules.length} tiêu chí kiểm tra.`
            : `Evaluated ${verdict.triggered_rules.length} verification ${verdict.triggered_rules.length === 1 ? 'check' : 'checks'}.`
          : lang === 'vi'
            ? 'Không có lưu ý bổ sung nào được phát hiện.'
            : 'No additional flags were raised.',
      status: step4Status,
      tag: lang === 'vi' ? 'BƯỚC 4 · ĐÁNH GIÁ' : 'STEP 4 · CHECKS',
    },
    {
      id: 'verdict',
      label: lang === 'vi' ? '5. Kết quả kiểm tra' : '5. Final Result',
      description: cleanTraceText(getVerdictExplanation(verdict, lang), lang),
      status:
        verdict.label === 'verified'
          ? 'completed'
          : verdict.label === 'suspected_hallucination'
            ? 'error'
            : verdict.label === 'metadata_error'
              ? 'active'
              : 'pending',
      tag:
        verdict.label === 'suspected_hallucination' || verdict.label === 'unresolved'
          ? getVerdictDisplay(verdict.label, lang).shortLabel.toUpperCase()
          : lang === 'vi'
            ? `ĐỘ KHỚP ${Math.round(verdict.confidence * 100)}%`
            : `MATCH ${Math.round(verdict.confidence * 100)}%`,
    },
  ];
}

function TraceStepCard({
  step,
  isLast,
  lang,
}: {
  step: TraceStep;
  isLast: boolean;
  lang: 'vi' | 'en';
}) {
  const colors = getStepStatusColor(step.status);

  return (
    <div className="flex gap-3.5">
      <div className="flex flex-col items-center">
        <div
          className={`w-8 h-8 rounded-xl flex items-center justify-center border ${colors.bg} ${colors.border} shrink-0`}
        >
          {colors.icon}
        </div>
        {!isLast && (
          <div
            className={`w-0.5 flex-1 min-h-[36px] ${
              step.status === 'completed' || step.status === 'active'
                ? 'bg-indigo-300 dark:bg-indigo-800'
                : 'bg-slate-200 dark:bg-slate-800'
            }`}
          />
        )}
      </div>

      <div className="flex-1 pb-4 min-w-0">
        <div className={`rounded-xl border p-3.5 ${colors.bg} ${colors.border}`}>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h4 className={`text-xs sm:text-sm font-bold ${colors.text}`}>
              {step.label}
            </h4>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-white/80 dark:bg-slate-900/80 border border-slate-200/70 dark:border-slate-700 text-slate-600 dark:text-slate-300">
              {step.tag}
            </span>
          </div>
          {step.description && (
            <p className="text-xs text-slate-600 dark:text-slate-300 mt-1 leading-relaxed">
              {step.description}
            </p>
          )}
          {step.detail &&
            (step.collapsibleDetail ? (
              <details className="mt-2 rounded-lg bg-white/80 dark:bg-slate-900/80 border border-slate-200/70 dark:border-slate-800 px-2.5 py-1.5">
                <summary className="cursor-pointer select-none text-[11px] font-medium text-slate-600 dark:text-slate-300">
                  {lang === 'vi' ? 'Chi tiết so sánh' : 'Comparison Details'}
                </summary>
                <p className="mt-1.5 text-xs text-slate-700 dark:text-slate-300 break-words leading-relaxed">
                  {step.detail}
                </p>
              </details>
            ) : (
              <p className="text-xs text-slate-700 dark:text-slate-300 mt-2 font-serif bg-white/80 dark:bg-slate-900/80 p-2.5 rounded-lg border border-slate-200/70 dark:border-slate-800 break-words">
                {step.detail}
              </p>
            ))}
        </div>
      </div>
    </div>
  );
}

function NeuralAlignmentPanel({
  verdict,
  lang,
}: {
  verdict: Verdict;
  lang: 'vi' | 'en';
}) {
  const f = verdict.features;
  if (!f || isUrlResource(verdict) || verdict.label === 'resource') return null;

  const extF = f as NonNullable<Verdict['features']> & {
    cross_lingual_bridged_concepts?: string[];
    cross_lingual_alignment?: boolean | number;
    semantic_similarity?: number;
  };
  const bridgedConcepts = filterValidBridgedConcepts(
    extF.cross_lingual_bridged_concepts?.length
      ? extF.cross_lingual_bridged_concepts
      : f.bridged_concepts,
  );
  const hasCrossLingual =
    bridgedConcepts.length > 0 ||
    Boolean(f.cross_lingual_detected) ||
    Boolean(extF.cross_lingual_alignment) ||
    Boolean(f.cross_lingual_title_detected) ||
    (f.cross_lingual_title_sim ?? 0) >= 0.5 ||
    (verdict.triggered_rules ?? []).some(
      (r) => r === 'R-CROSS-LINGUAL-ALIGNMENT' || r === 'R-CROSS-LINGUAL-TITLE-MATCH',
    );

  const alignScore = f.content_alignment_score ?? 0;
  const crossTitleSim = f.cross_lingual_title_sim ?? 0;
  const titleSim = Math.max(
    f.title_sim_semantic ?? 0,
    f.title_context_sim ?? 0,
    f.title_sim_fuzzy ?? 0,
    crossTitleSim,
    extF.semantic_similarity ?? 0,
  );
  const abstractSim = f.abstract_context_sim ?? 0;
  const evidenceSim = f.best_evidence_score ?? 0;
  const citedSentence = f.best_cited_sentence || verdict.context || '';
  const evidenceSentence = f.best_evidence_sentence || '';
  const intent = f.citation_intent || '';
  const stance = f.stance_label || '';
  const contextSource = f.context_source || '';
  const occAlignments = f.occurrence_alignments ?? [];

  if (alignScore <= 0 && titleSim <= 0 && !evidenceSentence && !hasCrossLingual) {
    return null;
  }

  const intentBadgeStyle =
    intent === 'methodology'
      ? 'bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950/70 dark:text-indigo-300 dark:border-indigo-800'
      : intent === 'result_comparison'
        ? 'bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950/70 dark:text-violet-300 dark:border-violet-800'
        : 'bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/70 dark:text-sky-300 dark:border-sky-800';

  const stanceBadgeStyle =
    stance === 'supported'
      ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/70 dark:text-emerald-300 dark:border-emerald-800'
      : stance === 'partially_supported'
        ? 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/70 dark:text-amber-300 dark:border-amber-800'
        : stance === 'contradiction_risk'
          ? 'bg-red-50 text-red-700 border-red-200 dark:bg-red-950/70 dark:text-red-300 dark:border-red-800'
          : 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700';

  const formatIntentLabel = (val: string) => formatTaxonomyIntent(val, lang);

  const formatStanceLabel = (val: string) => formatTaxonomyStance(val, lang);

  const formatSourceLabel = (val: string) => {
    if (val === 'multi_occurrence')
      return lang === 'vi' ? `Đa vị trí trích dẫn (${occAlignments.length || 2}+ vị trí)` : `Multi-Occurrence (${occAlignments.length || 2}+ sites)`;
    if (val === 'implicit_body_discovery')
      return lang === 'vi' ? 'Đoạn văn liên quan (chưa trích dẫn trực tiếp)' : 'Related body passage (not explicitly cited)';
    if (val === 'in_text_citation')
      return lang === 'vi' ? 'Trích dẫn trực tiếp trong bài' : 'In-Text Citation';
    return '';
  };
  const sourceLabel = formatSourceLabel(contextSource);
  const isUncitedOrImplicit =
    verdict.mapping_status === 'uncited_reference' ||
    contextSource === 'implicit_body_discovery';

  return (
    <div
      data-testid="neural-alignment-panel"
      className="rounded-xl border border-indigo-200/80 dark:border-indigo-900/70 bg-gradient-to-br from-indigo-50/40 via-white to-violet-50/30 dark:from-indigo-950/25 dark:via-slate-900 dark:to-violet-950/20 p-4 space-y-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-indigo-100 dark:bg-indigo-950 flex items-center justify-center border border-indigo-200 dark:border-indigo-800">
            <BookOpen className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
          </div>
          <div>
            <h5 className="text-xs font-bold text-indigo-950 dark:text-indigo-200 tracking-wide">
              {lang === 'vi'
                ? 'Đối chiếu nội dung trích dẫn với bài gốc'
                : 'Citation Context & Source Content Match'}
            </h5>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              {lang === 'vi'
                ? 'So sánh câu trích dẫn trong bài với tóm tắt bài báo gốc, vai trò trích dẫn và mức độ phù hợp.'
                : 'Compares your cited sentence against the source abstract, citation role, and support level.'}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {intent && (
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold border ${intentBadgeStyle}`}>
              <Sparkles className="h-3 w-3" />
              {formatIntentLabel(intent)}
            </span>
          )}
          {stance && (
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold border ${stanceBadgeStyle}`}>
              {formatStanceLabel(stance)}
            </span>
          )}
          {hasCrossLingual && (
            <span
              data-testid="trace-onnx-multilingual-badge"
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold border bg-teal-50 text-teal-700 border-teal-200 dark:bg-teal-950/70 dark:text-teal-300 dark:border-teal-800"
            >
              <Languages className="h-3 w-3" />
              {crossTitleSim > 0
                ? lang === 'vi'
                  ? `Đối chiếu Việt ↔ Anh · ${Math.round(crossTitleSim * 100)}%`
                  : `VI ↔ EN Match · ${Math.round(crossTitleSim * 100)}%`
                : lang === 'vi'
                  ? 'Đối chiếu Việt ↔ Anh'
                  : 'VI ↔ EN Cross-Lingual'}
            </span>
          )}
          {sourceLabel && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] border bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700">
              {sourceLabel}
            </span>
          )}
        </div>
      </div>

      {/* 3 Sub-Score Bars */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {[
          {
            label: lang === 'vi' ? 'Độ khớp tiêu đề' : 'Title Match',
            val: titleSim,
          },
          {
            label: lang === 'vi' ? 'Độ khớp tóm tắt' : 'Abstract Alignment',
            val: abstractSim,
          },
          {
            label: lang === 'vi' ? 'Độ khớp câu bằng chứng' : 'Best Supporting Passage',
            val: evidenceSim || alignScore,
          },
        ].map((metric) => {
          const pct = Math.round(Math.max(0, Math.min(1, metric.val)) * 100);
          return (
            <div
              key={metric.label}
              className="rounded-lg border border-slate-200/80 dark:border-slate-800 bg-white/80 dark:bg-slate-900/80 p-2.5"
            >
              <div className="flex items-center justify-between text-[11px] font-medium mb-1.5">
                <span className="text-slate-600 dark:text-slate-400 truncate">{metric.label}</span>
                <span className="font-bold font-mono text-slate-900 dark:text-slate-100">{pct}%</span>
              </div>
              <div className="w-full h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                <div
                  className={`h-full rounded-full ${
                    pct >= 65
                      ? 'bg-emerald-500'
                      : pct >= 40
                        ? 'bg-indigo-500'
                        : 'bg-amber-500'
                  }`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* Cross-Lingual Concept Bridge (Model ID & raw telemetry tucked under Technical Details) */}
      {hasCrossLingual && (
        <div
          data-testid="bridged-concepts-bar"
          className="rounded-lg border border-teal-200/80 dark:border-teal-900/60 bg-teal-50/50 dark:bg-teal-950/25 p-2.5 space-y-2"
        >
          <div className="flex flex-wrap items-center justify-between gap-1.5 text-[11px] font-bold text-teal-800 dark:text-teal-300">
            <div className="flex items-center gap-1.5">
              <Languages className="h-3.5 w-3.5 shrink-0" />
              <span>
                {lang === 'vi'
                  ? 'Đối chiếu đa ngôn ngữ Việt ↔ Anh'
                  : 'VI ↔ EN Cross-Lingual Alignment'}
              </span>
            </div>
            {crossTitleSim > 0 && (
              <span className="px-2 py-0.5 rounded bg-teal-100/90 dark:bg-teal-900/80 text-teal-900 dark:text-teal-200 border border-teal-300/70 dark:border-teal-700 font-mono text-[10px]">
                {lang === 'vi'
                  ? `Độ khớp tiêu đề VI↔EN: ${Math.round(crossTitleSim * 100)}%`
                  : `VI↔EN Title Match: ${Math.round(crossTitleSim * 100)}%`}
              </span>
            )}
          </div>
          {bridgedConcepts.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {bridgedConcepts.map((concept, cIdx) => (
                <span
                  key={`${concept}-${cIdx}`}
                  className="inline-flex items-center px-2 py-0.5 rounded bg-white/90 dark:bg-slate-900/90 border border-teal-200 dark:border-teal-800 text-[11px] font-mono text-teal-900 dark:text-teal-200"
                >
                  {concept}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-[11px] text-teal-900 dark:text-teal-200">
              {lang === 'vi'
                ? `Đã xác nhận độ tương đồng nội dung giữa bài viết tiếng Việt và bản gốc tiếng Anh${crossTitleSim > 0 ? ` (${Math.round(crossTitleSim * 100)}%)` : ''}.`
                : `Confirmed bilingual content match between Vietnamese text and English source${crossTitleSim > 0 ? ` (${Math.round(crossTitleSim * 100)}%)` : ''}.`}
            </p>
          )}
        </div>
      )}

      {(citedSentence || evidenceSentence) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {citedSentence && (
            <div className="rounded-lg border border-slate-200/80 dark:border-slate-800 bg-white/90 dark:bg-slate-900/90 p-3">
              <div className="flex items-center justify-between gap-2 mb-1 flex-wrap">
                <span
                  data-testid="trace-manuscript-passage-label"
                  className="text-[11px] font-semibold text-slate-600 dark:text-slate-300"
                >
                  {lang === 'vi'
                    ? alignScore > 0
                      ? `Câu trong bài viết · Khớp ${Math.round(alignScore * 100)}%`
                      : 'Câu trong bài viết'
                    : alignScore > 0
                      ? `Manuscript passage · ${Math.round(alignScore * 100)}% match`
                      : 'Manuscript passage'}
                </span>
              </div>
              {isUncitedOrImplicit && (
                <p className="text-[10px] font-medium text-amber-700 dark:text-amber-300 mb-1">
                  {lang === 'vi'
                    ? 'Đoạn văn liên quan trong bài (chưa trích dẫn trực tiếp)'
                    : 'Related body passage (not explicitly cited)'}
                </p>
              )}
              <p className="text-xs font-serif text-slate-800 dark:text-slate-200 leading-relaxed break-words">
                “{citedSentence}”
              </p>
            </div>
          )}

          {evidenceSentence && (
            <div className="rounded-lg border border-emerald-200/80 dark:border-emerald-900/60 bg-emerald-50/40 dark:bg-emerald-950/20 p-3">
              <div className="flex items-center justify-between gap-2 mb-1 flex-wrap">
                <span
                  data-testid="trace-source-passage-label"
                  className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400"
                >
                  {lang === 'vi'
                    ? evidenceSim > 0
                      ? `Đoạn gốc từ tài liệu · Khớp ${Math.round(evidenceSim * 100)}%`
                      : 'Đoạn gốc từ tài liệu'
                    : evidenceSim > 0
                      ? `Source passage · ${Math.round(evidenceSim * 100)}% match`
                      : 'Source passage'}
                </span>
              </div>
              <p className="text-xs font-serif text-slate-800 dark:text-slate-200 leading-relaxed break-words">
                “{evidenceSentence}”
              </p>
            </div>
          )}
        </div>
      )}

      {/* Multi-occurrence table when cited multiple times */}
      {occAlignments.length > 1 && (
        <div className="pt-1">
          <div className="text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1.5">
            {lang === 'vi'
              ? `Độ khớp tại từng vị trí trích dẫn trong bài (${occAlignments.length} vị trí)`
              : `Context Match at Each Citation Location (${occAlignments.length} locations)`}
          </div>
          <div className="space-y-1.5">
            {occAlignments.map((occ, idx) => (
              <div
                key={`${occ.page}-${idx}`}
                className="flex flex-wrap items-center justify-between gap-2 text-xs rounded-lg border border-slate-200/70 dark:border-slate-800 bg-white/75 dark:bg-slate-900/75 px-3 py-2"
              >
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 shrink-0">
                    {lang === 'vi' ? `tr. ${occ.page || 1}` : `p. ${occ.page || 1}`}
                  </span>
                  <span className="font-serif text-slate-700 dark:text-slate-300 truncate">
                    {occ.focal_sentence}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0 font-mono text-[10px]">
                  {occ.intent && (
                    <span className="px-1.5 py-0.5 rounded bg-indigo-50 dark:bg-indigo-950/80 text-indigo-700 dark:text-indigo-300">
                      {formatIntentLabel(occ.intent)}
                    </span>
                  )}
                  <span className="font-bold text-slate-800 dark:text-slate-200">
                    {Math.round((occ.score || 0) * 100)}%
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function VerdictTrace({
  verdict,
  index,
  markerIndex,
  lang,
  defaultExpanded = false,
}: {
  verdict: Verdict;
  index: number;
  markerIndex: number;
  lang: 'vi' | 'en';
  defaultExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [traceViewMode, setTraceViewMode] = useState<'linear' | 'dag'>('linear');
  const steps = buildTraceSteps(verdict, lang);
  const rawUrlStatus = verdict.url_status ?? verdict.features?.url_status;
  const archiveUrl = verdict.archive_url ?? verdict.features?.archive_url;
  const isWrongPage = (verdict.triggered_rules ?? []).includes('R-URL-CONTENT-MISMATCH');
  const isWayback =
    rawUrlStatus === 'archived_alive' ||
    Boolean(archiveUrl) ||
    (verdict.triggered_rules ?? []).includes('R-WAYBACK-ARCHIVED');
  const urlStatus =
    isWayback && rawUrlStatus !== 'alive' && rawUrlStatus !== 'restricted_alive'
      ? 'archived_alive'
      : rawUrlStatus === 'alive' ||
          rawUrlStatus === 'restricted_alive' ||
          rawUrlStatus === 'dead_link' ||
          rawUrlStatus === 'fake_domain'
        ? rawUrlStatus
        : null;
  const cleanCitationTitle = verdict.citation_raw.replace(/^\[\d+[a-z]?\]\s*/i, '');

  return (
    <Card className="p-0 overflow-hidden rounded-xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3.5 p-4 bg-white dark:bg-slate-900 hover:bg-slate-50/80 dark:hover:bg-slate-800/50 transition-colors text-left"
      >
        <span className="font-mono text-xs font-bold px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 shrink-0">
          {getCitationMarkerLabel(verdict, markerIndex)}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate font-serif">
            {cleanCitationTitle}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {(urlStatus || isWrongPage) && (
            <span
              className={`hidden md:inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold border ${
                isWrongPage || urlStatus === 'archived_alive'
                  ? 'bg-amber-50 text-amber-800 border-amber-300 dark:bg-amber-950/70 dark:text-amber-300 dark:border-amber-800'
                  : urlStatus === 'alive' || urlStatus === 'restricted_alive'
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/70 dark:text-emerald-300 dark:border-emerald-800'
                    : 'bg-red-50 text-red-700 border-red-200 dark:bg-red-950/70 dark:text-red-300 dark:border-red-800'
              }`}
            >
              {isWrongPage
                ? lang === 'vi'
                  ? '⚠ Sai nội dung trang'
                  : '⚠ Wrong page'
                : urlStatus === 'alive'
                  ? lang === 'vi'
                    ? '✓ Liên kết hoạt động'
                    : '✓ Link active'
                  : urlStatus === 'restricted_alive'
                    ? lang === 'vi'
                      ? '🔒 Yêu cầu đăng nhập / trả phí'
                      : '🔒 Paywalled / login required'
                    : urlStatus === 'archived_alive'
                      ? lang === 'vi'
                        ? '🏛️ Bản lưu Wayback'
                        : '🏛️ Wayback archived'
                      : urlStatus === 'dead_link'
                        ? lang === 'vi'
                          ? '✕ Đường dẫn không mở được'
                          : '✕ Broken link'
                        : lang === 'vi'
                          ? '✕ Đường dẫn không hợp lệ'
                          : '✕ Invalid URL'}
            </span>
          )}
          {verdict.features?.content_alignment_score !== undefined &&
            verdict.features.content_alignment_score > 0 && (
              <span className="hidden lg:inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold border bg-indigo-50/90 text-indigo-700 border-indigo-200 dark:bg-indigo-950/70 dark:text-indigo-300 dark:border-indigo-800">
                <Sparkles className="h-3 w-3" />
                {lang === 'vi' ? 'Liên quan ngữ cảnh:' : 'Context match:'}{' '}
                {Math.round(verdict.features.content_alignment_score * 100)}%
                {verdict.features.citation_intent
                  ? ` · ${formatTaxonomyIntent(verdict.features.citation_intent, lang)}`
                  : ''}
              </span>
            )}
          <Badge variant="outline" className="hidden sm:inline-flex text-[10px]">
            {lang === 'vi'
              ? `${verdict.triggered_rules.length} tiêu chí`
              : `${verdict.triggered_rules.length} ${verdict.triggered_rules.length === 1 ? 'check' : 'checks'}`}
          </Badge>
          <VerdictBadge
            verdict={isUrlResource(verdict) ? 'resource' : verdict.label}
            triggeredRules={verdict.triggered_rules}
            size="sm"
          />
          <ChevronRight
            className={`h-4 w-4 text-slate-400 transition-transform ${
              expanded ? 'rotate-90 text-indigo-600 dark:text-indigo-400' : ''
            }`}
          />
        </div>
      </button>

      {expanded && (
        <div className="border-t border-slate-200/80 dark:border-slate-800 p-4 sm:p-5 bg-slate-50/60 dark:bg-slate-950/60 space-y-5">
          <NeuralAlignmentPanel verdict={verdict} lang={lang} />

          <div>
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <h5 className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                {lang === 'vi'
                  ? 'Các bước kiểm tra & Sơ đồ đối chiếu'
                  : 'How this result was reached (5-Step Breakdown & Check Flow)'}
              </h5>
              <div className="inline-flex items-center p-0.5 rounded-lg bg-slate-200/70 dark:bg-slate-900 border border-slate-300/70 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setTraceViewMode('linear')}
                  className={`px-2.5 py-1 rounded-md text-[10px] font-semibold transition-all cursor-pointer ${
                    traceViewMode === 'linear'
                      ? 'bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 shadow-sm'
                      : 'text-slate-600 dark:text-slate-400'
                  }`}
                >
                  {lang === 'vi' ? 'Quy trình 5 bước' : '5-Step Breakdown'}
                </button>
                <button
                  type="button"
                  data-testid={`trace-dag-btn-${index}`}
                  onClick={() => setTraceViewMode('dag')}
                  className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-semibold transition-all cursor-pointer ${
                    traceViewMode === 'dag'
                      ? 'bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 shadow-sm'
                      : 'text-slate-600 dark:text-slate-400'
                  }`}
                >
                  <GitBranch className="h-3 w-3 text-violet-500" />
                  <span>{lang === 'vi' ? 'Sơ đồ đối chiếu' : 'Check Flow'}</span>
                </button>
              </div>
            </div>

            {traceViewMode === 'dag' ? (
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 p-4">
                <EvidenceGraph verdict={verdict} />
              </div>
            ) : (
              <div>
                {steps.map((step, idx) => (
                  <TraceStepCard
                    key={step.id}
                    step={step}
                    isLast={idx === steps.length - 1}
                    lang={lang}
                  />
                ))}
              </div>
            )}
          </div>

          {verdict.triggered_rules.length > 0 && traceViewMode === 'linear' && (
            <div>
              <h5 className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">
                {lang === 'vi' ? 'Tiêu chí kiểm tra' : 'Verification Checks'}
              </h5>
              <RuleInspector
                triggeredRules={verdict.triggered_rules}
                verdictLabel={verdict.label}
                features={verdict.features}
              />
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

export function LogicTracePage() {
  const { id } = useParams<{ id: string }>();
  const { i18n } = useTranslation();
  const lang: 'vi' | 'en' = i18n.language?.startsWith('vi') ? 'vi' : 'en';
  const [filterMode, setFilterMode] = useState<'all' | 'flagged' | 'verified' | 'resource'>('all');
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [lockedFeatureName, setLockedFeatureName] = useState('');

  const traceLoadFallback =
    lang === 'vi'
      ? 'Không thể tải chi tiết quá trình kiểm tra. Vui lòng thử lại.'
      : 'Could not load the verification details. Please try again.';

  const numericId = id ? parseInt(id, 10) : null;
  const { report, error } = useEssayPolling(
    numericId !== null && !Number.isNaN(numericId) && numericId > 0 ? numericId : null,
    { errorMessage: traceLoadFallback }
  );

  // Single-definition buckets: NEVER merge resource into verified (BUG-02)
  const sortedVerdicts = useMemo(() => {
    if (!report?.verdicts) return [];
    const rankLabel = (v: Verdict) => {
      const k = getEffectiveVerdictKey(v);
      if (k === 'resource') return 3;
      if (k !== 'verified') return 0; // genuine flagged items first
      return 1; // verified academic papers before web resources
    };
    const base = [...report.verdicts].sort((a, b) => {
      const rA = rankLabel(a);
      const rB = rankLabel(b);
      if (rA !== rB) return rA - rB;
      if (rA === 0) return a.confidence - b.confidence;
      const alignA = a.features?.content_alignment_score ?? 0;
      const alignB = b.features?.content_alignment_score ?? 0;
      if (Math.abs(alignB - alignA) > 0.05) return alignB - alignA;
      return b.confidence - a.confidence;
    });
    if (filterMode === 'flagged') {
      return base.filter((v) => {
        const k = getEffectiveVerdictKey(v);
        return k !== 'verified' && k !== 'resource';
      });
    }
    if (filterMode === 'verified') {
      return base.filter((v) => getEffectiveVerdictKey(v) === 'verified');
    }
    if (filterMode === 'resource') {
      return base.filter((v) => getEffectiveVerdictKey(v) === 'resource');
    }
    return base;
  }, [report, filterMode]);

  if (error) {
    return (
      <div
        data-testid="trace-error-card"
        className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 sm:p-8 shadow-sm max-w-2xl mx-auto my-8"
      >
        <div className="flex items-start gap-4">
          <div className="h-12 w-12 rounded-2xl bg-amber-50 dark:bg-amber-950/70 border border-amber-200 dark:border-amber-800 flex items-center justify-center shrink-0">
            <AlertCircle className="h-6 w-6 text-amber-600 dark:text-amber-400" />
          </div>
          <div className="space-y-3 flex-1 min-w-0">
            <h2 className="font-display text-lg font-bold text-slate-900 dark:text-slate-100">
              {lang === 'vi'
                ? 'Không thể tải chi tiết kiểm chứng'
                : 'Unable to Load Verification Details'}
            </h2>
            <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed break-words">
              {formatUserError(error, lang, traceLoadFallback)}
            </p>
            <div className="pt-1">
              <Link
                to="/history"
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white transition-colors"
              >
                <ArrowLeft className="h-4 w-4" />
                {lang === 'vi' ? 'Về lịch sử báo cáo' : 'Back to History'}
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!report) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-8 w-8 text-indigo-600 dark:text-indigo-400 animate-spin" />
        <span className="ml-3 text-slate-600 dark:text-slate-400 text-sm">
          {lang === 'vi' ? 'Đang tải dữ liệu kiểm chứng...' : 'Loading verification data...'}
        </span>
      </div>
    );
  }

  const bucketCounts = computeReportBucketCounts(report.verdicts ?? []);
  const totalCount = bucketCounts.all;
  const verifiedCount = bucketCounts.verified;
  const resourceCount = bucketCounts.resource;
  const unresolvedCount = bucketCounts.unresolved;
  const flaggedCount = bucketCounts.attentionCount;
  const metaErrCount = bucketCounts.metadata_error;
  const hallucinationCount = bucketCounts.suspected_hallucination;
  const otherBreakdownCount = unresolvedCount + resourceCount;
  const kpiColClass =
    unresolvedCount > 0 && resourceCount > 0
      ? 'sm:grid-cols-3 lg:grid-cols-6'
      : otherBreakdownCount > 0
        ? 'sm:grid-cols-5'
        : 'sm:grid-cols-4';
  const bibIndexByCitationId = new Map<string, number>();
  (report.verdicts ?? []).forEach((v, idx) => {
    if (!bibIndexByCitationId.has(v.citation_id)) {
      bibIndexByCitationId.set(v.citation_id, idx);
    }
  });

  return (
    <div className="space-y-4 pb-10">
      {/* Shared Report Header */}
      <EssayHeader
        essayId={report.essay_id}
        filename={report.filename}
        numPages={report.num_pages}
        numCitations={report.num_citations}
        numReferences={report.verdicts.length}
        styleName={formatCitationStyleLabel(report.style_profile?.style, lang)}
      />

      {/* Unified Persistent 5-Layer Score Summary & Navigation Bar (BUG-19) */}
      <ReportSummaryAndNavBar
        essayId={id ?? String(report.essay_id)}
        report={report}
        activeLayer="trace"
        onOpenLockedFeature={(featureName) => {
          setLockedFeatureName(featureName);
          setUpgradeOpen(true);
        }}
      />

      {/* Non-Accusatory Academic Decision-Support Disclaimer (BUG-03) */}
      <DecisionSupportBanner variant="compact" lang={lang} />

      {/* Summary Metric Cards (Verified NEVER merges Web/Legal Resource — BUG-02; sums to 100% of Total) */}
      <div
        data-testid="trace-kpi-grid"
        className={`grid grid-cols-2 ${kpiColClass} gap-3.5`}
      >
        <Card className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 shadow-sm">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
              {lang === 'vi' ? 'Tổng số' : 'Total'}
            </span>
          </div>
          <p className="text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
            {totalCount}
          </p>
        </Card>

        <Card className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-emerald-200/80 dark:border-emerald-900/70 shadow-sm">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
              {getVerdictDisplay('verified', lang).label}
            </span>
          </div>
          <p className="text-2xl font-bold font-mono tabular-nums text-emerald-600 dark:text-emerald-400">
            {verifiedCount}
          </p>
        </Card>

        <Card className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-amber-200/80 dark:border-amber-900/70 shadow-sm">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-medium text-amber-600 dark:text-amber-400">
              {getVerdictDisplay('metadata_error', lang).label}
            </span>
          </div>
          <p className="text-2xl font-bold font-mono tabular-nums text-amber-600 dark:text-amber-400">
            {metaErrCount}
          </p>
        </Card>

        <Card className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-red-200/80 dark:border-red-900/70 shadow-sm">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-medium text-red-600 dark:text-red-400">
              {getVerdictDisplay('suspected_hallucination', lang).label}
            </span>
          </div>
          <p className="text-2xl font-bold font-mono tabular-nums text-red-600 dark:text-red-400">
            {hallucinationCount}
          </p>
        </Card>

        {unresolvedCount > 0 && (
          <Card
            data-testid="trace-kpi-unresolved"
            className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-300/80 dark:border-slate-700 shadow-sm"
          >
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
                {getVerdictDisplay('unresolved', lang).label}
              </span>
            </div>
            <p className="text-2xl font-bold font-mono tabular-nums text-slate-700 dark:text-slate-200">
              {unresolvedCount}
            </p>
          </Card>
        )}

        {resourceCount > 0 && (
          <Card
            data-testid="trace-kpi-resource"
            className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-violet-200/80 dark:border-violet-900/70 shadow-sm"
          >
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-medium text-violet-600 dark:text-violet-400">
                {getVerdictDisplay('resource', lang).label}
              </span>
            </div>
            <p className="text-2xl font-bold font-mono tabular-nums text-violet-600 dark:text-violet-400">
              {resourceCount}
            </p>
          </Card>
        )}
      </div>

      {/* Clean Container for Verification Reasoning */}
      <Card className="p-0 overflow-hidden rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm">
        <div className="px-4 sm:px-6 py-3.5 bg-slate-50/80 dark:bg-slate-900/90 border-b border-slate-200/80 dark:border-slate-800 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-xs sm:text-sm font-bold text-slate-800 dark:text-slate-200">
            <GitBranch className="h-4 w-4 text-violet-500 shrink-0" />
            <span>
              {lang === 'vi'
                ? `Chi tiết cách hệ thống kiểm chứng (${sortedVerdicts.length})`
                : `Verification Reasoning (${sortedVerdicts.length})`}
            </span>
          </div>

          <div className="flex gap-1.5 flex-wrap">
            {(
              [
                ['all', lang === 'vi' ? `Tất cả (${totalCount})` : `All (${totalCount})`],
                ['flagged', lang === 'vi' ? `Cần kiểm tra (${flaggedCount})` : `Needs Review (${flaggedCount})`],
                ['verified', `${getVerdictDisplay('verified', lang).label} (${verifiedCount})`],
                ...(resourceCount > 0
                  ? [
                      [
                        'resource',
                        `${getVerdictDisplay('resource', lang).label} (${resourceCount})`,
                      ] as const,
                    ]
                  : []),
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setFilterMode(key)}
                className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all border cursor-pointer ${
                  filterMode === key
                    ? 'bg-indigo-600 text-white border-indigo-600'
                    : 'bg-white dark:bg-slate-950 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-800 hover:border-slate-300'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="p-4 sm:p-6 space-y-3">
          {sortedVerdicts.map((verdict, index) => (
            <VerdictTrace
              key={verdict.citation_id}
              verdict={verdict}
              index={index}
              markerIndex={bibIndexByCitationId.get(verdict.citation_id) ?? index}
              lang={lang}
              defaultExpanded={index === 0}
            />
          ))}
        </div>
      </Card>

      <UpgradeModal
        open={upgradeOpen}
        onOpenChange={setUpgradeOpen}
        featureName={lockedFeatureName}
      />
    </div>
  );
}
