import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useParams, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  api,
  type AnalysisReport,
  type Verdict,
  type Citation,
  type CitationMappingStatus,
} from '@/api/client';
import { useModalA11y } from '@/hooks/useModalA11y';
import { VerdictBadge } from '@/components/VerdictBadge';
import { MappingStatusBadge } from '@/components/MappingStatusBadge';
import { DecisionSupportBanner } from '@/components/DecisionSupportBanner';
import {
  getCitationMarkerLabel,
  getFieldDisplayName,
  getVerdictExplanation,
  isUrlResource,
} from '@/lib/verdictExplanation';
import {
  formatIntentLabel,
  formatStanceLabel,
  formatUserError,
  getVerdictDisplay,
  normalizeVerdictKey,
} from '@/lib/academicTaxonomy';
import { isDocxFilename } from '@/lib/fileKind';
import { useEssayPolling } from '@/hooks/useEssayPolling';
import { EssayHeader } from './essay/EssayHeader';
import { EssayActionBar } from './essay/EssayActionBar';
import { DirectionalStageSlide, useSlidingPill } from '@/components/ui/transitions';
import {
  Loader2,
  AlertCircle,
  FileText,
  Quote,
  AlertTriangle,
  ExternalLink,
  BookOpen,
  CheckCircle,
  XCircle,
  Link2,
  Filter,
  Brain,
  Sparkles,
  Eye,
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  Maximize2,
  X,
  ArrowLeft,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';

/* ============================================================
   SourceLogic — Document Inspector Page (L4)
   Inline Context Stream & Page Preview
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

const _UNDERLINE_COLORS = {
  verified: 'border-emerald-500 dark:border-emerald-400',
  metadata_error: 'border-amber-500 dark:border-amber-400',
  suspected_hallucination: 'border-red-500 dark:border-red-400',
  unresolved: 'border-slate-400 dark:border-slate-500',
};

interface InlineCitation {
  id: string;
  raw: string;
  refNum: number;
  subIndex?: string;
  markerLabel: string;
  label: string;
  mapping_status: CitationMappingStatus;
  page: number;
  line: string;
  context?: string;
  alignmentScore?: number;
  citationIntent?: string;
  stanceLabel?: string;
  evidenceSentence?: string;
  contextSource?: string;
  isCrossLingual?: boolean;
  crossLingualSim?: number;
}

function ContextWithHighlight({
  context,
  marker,
  markerLabel,
  label,
}: {
  context: string;
  marker: string;
  markerLabel?: string;
  label?: string;
}) {
  if (!context) return null;
  const lowerContext = context.toLowerCase();
  const isFlaggedRed =
    label === 'suspected_hallucination' || label === 'metadata_error';
  const markClass = isFlaggedRed
    ? 'bg-transparent text-red-600 dark:text-red-400 font-bold'
    : 'bg-amber-200/80 dark:bg-amber-900/60 text-inherit rounded px-1 py-0.5 font-medium';

  let idx = lowerContext.indexOf(marker.toLowerCase());
  let matchLen = marker.length;

  if (idx === -1 && markerLabel && markerLabel !== '[?]') {
    idx = lowerContext.indexOf(markerLabel.toLowerCase());
    if (idx !== -1) {
      matchLen = markerLabel.length;
    }
  }
  if (idx === -1) {
    // Try bracket number [N] or [14a] from marker
    const numMatch = marker.match(/^\s*(\[\s*\d+[a-z]?\s*\])/i);
    if (numMatch) {
      idx = lowerContext.indexOf(numMatch[1].toLowerCase());
      matchLen = numMatch[1].length;
    }
  }
  if (idx === -1) {
    // Try first author surname (>= 4 letters)
    const cleanMarker = marker.replace(/^\s*(?:\[\d+\]|\d+[.)])\s*/, '');
    const tokMatch = cleanMarker.match(/[A-Za-zÀ-ỹ]{4,}/);
    if (tokMatch) {
      idx = lowerContext.indexOf(tokMatch[0].toLowerCase());
      matchLen = tokMatch[0].length;
    }
  }

  if (idx === -1) {
    return (
      <span className={isFlaggedRed ? 'text-red-600 dark:text-red-400 font-medium' : undefined}>
        {context}
      </span>
    );
  }
  const before = context.slice(0, idx);
  const match = context.slice(idx, idx + matchLen);
  const after = context.slice(idx + matchLen);
  return (
    <>
      {before}
      <mark className={markClass}>{match}</mark>
      {after}
    </>
  );
}

function buildInlineCitations(
  verdicts: Verdict[],
  extractedCitations?: Citation[],
  references?: Citation[],
): InlineCitation[] {
  const pageByRaw = new Map<string, number>();
  for (const c of extractedCitations ?? []) {
    if (c.raw_text && c.page_num && c.page_num > 0 && !pageByRaw.has(c.raw_text.trim())) {
      pageByRaw.set(c.raw_text.trim(), c.page_num);
    }
  }
  const refs = references ?? [];
  const inTextList = extractedCitations ?? [];

  const items = verdicts.map((v, vIdx) => {
    const refId =
      v.citation_link?.reference_id ?? v.citation_links?.[0]?.reference_id;
    const markerLabel = getCitationMarkerLabel(v, vIdx);
    const markerDigitsMatch = markerLabel.match(/^\[(\d+)([a-z]?)\]$/i);
    const resolvedRefNum =
      v.numeric_index ??
      v.features?.numeric_index ??
      (markerDigitsMatch ? parseInt(markerDigitsMatch[1], 10) : vIdx + 1);
    const resolvedSubIndex =
      (v.sub_index || v.features?.sub_index || markerDigitsMatch?.[2] || '').trim();
    let matchedRef: Citation | undefined;
    if (refId) {
      matchedRef = refs.find((r) => r.reference_id === refId);
      if (!matchedRef) {
        const idxNum = parseInt(refId.replace(/^ref-/, ''), 10);
        if (!Number.isNaN(idxNum) && idxNum >= 1 && idxNum <= refs.length) {
          matchedRef = refs[idxNum - 1];
        }
      }
    }
    if (!matchedRef) {
      matchedRef = refs.find(
        (r) =>
          r.raw_text.trim() === v.citation_raw.trim() ||
          (r.title &&
            v.citation_raw.toLowerCase().includes(r.title.toLowerCase().slice(0, 35))),
      );
    }

    const matchedInText = inTextList.find(
      (c) =>
        (refId &&
          (c.citation_link?.reference_id === refId ||
            c.citation_links?.some((l) => l.reference_id === refId))) ||
        c.raw_text.trim() === v.citation_raw.trim() ||
        (v.context && c.context && c.context.trim() === v.context.trim()) ||
        (matchedRef?.authors?.[0] &&
          c.raw_text
            .toLowerCase()
            .includes(matchedRef.authors[0].split(',')[0].toLowerCase())),
    );

    const resolvedPage =
      pageByRaw.get(v.citation_raw.trim()) ||
      matchedInText?.page_num ||
      matchedRef?.cited_on_pages?.[0] ||
      v.features?.occurrence_alignments?.[0]?.page ||
      matchedRef?.page_num ||
      1;

    return {
      id: v.citation_id,
      raw: v.citation_raw,
      refNum: resolvedRefNum,
      subIndex: resolvedSubIndex || undefined,
      markerLabel,
      label: isUrlResource(v) ? 'resource' : normalizeVerdictKey(v.label),
      mapping_status: v.mapping_status,
      page: resolvedPage,
      line: v.citation_raw,
      context:
        v.features?.best_cited_sentence ||
        v.context ||
        matchedInText?.context ||
        undefined,
      alignmentScore: v.features?.content_alignment_score,
      citationIntent: v.features?.citation_intent || undefined,
      stanceLabel: v.features?.stance_label || undefined,
      evidenceSentence: v.features?.best_evidence_sentence || undefined,
      contextSource: v.features?.context_source || undefined,
      isCrossLingual:
        Boolean(v.features?.cross_lingual_detected) ||
        Boolean(v.features?.cross_lingual_title_detected) ||
        (v.features?.cross_lingual_title_sim ?? 0) >= 0.5 ||
        (v.triggered_rules ?? []).some(
          (r) => r === 'R-CROSS-LINGUAL-ALIGNMENT' || r === 'R-CROSS-LINGUAL-TITLE-MATCH',
        ),
      crossLingualSim:
        v.features &&
        (v.features.title_sim_fuzzy !== undefined ||
          v.features.title_sim_semantic !== undefined ||
          v.features.cross_lingual_title_sim !== undefined)
          ? Math.max(
              v.features.title_sim_fuzzy ?? 0,
              v.features.title_sim_semantic ?? 0,
              v.features.cross_lingual_title_sim ?? 0,
            )
          : undefined,
    };
  });

  return items.sort((a, b) => {
    const aIsResource = a.label === 'resource' ? 1 : 0;
    const bIsResource = b.label === 'resource' ? 1 : 0;
    if (aIsResource !== bIsResource) return aIsResource - bIsResource;
    if (a.refNum !== b.refNum) return a.refNum - b.refNum;
    return (a.subIndex || '').localeCompare(b.subIndex || '');
  });
}

function getInlineStatusBadge(
  label: string,
  lang: 'vi' | 'en',
): {
  bg: string;
  text: string;
  label: string;
  icon: React.ReactNode;
} {
  const norm = normalizeVerdictKey(label);
  const display = getVerdictDisplay(norm, lang);
  switch (norm) {
    case 'verified':
      return {
        bg: 'bg-emerald-100/90 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-300 border border-emerald-200/80 dark:border-emerald-800/80',
        text: 'text-emerald-700 dark:text-emerald-300',
        label: display.label,
        icon: <CheckCircle className="h-3 w-3" />,
      };
    case 'metadata_error':
      return {
        bg: 'bg-amber-100/90 dark:bg-amber-950/80 text-amber-700 dark:text-amber-300 border border-amber-200/80 dark:border-amber-800/80',
        text: 'text-amber-700 dark:text-amber-300',
        label: display.label,
        icon: <AlertTriangle className="h-3 w-3" />,
      };
    case 'suspected_hallucination':
      return {
        bg: 'bg-red-100/90 dark:bg-red-950/80 text-red-700 dark:text-red-300 border border-red-200/80 dark:border-red-800/80',
        text: 'text-red-700 dark:text-red-300',
        label: display.label,
        icon: <XCircle className="h-3 w-3" />,
      };
    case 'resource':
      return {
        bg: 'bg-violet-100/90 dark:bg-violet-950/80 text-violet-700 dark:text-violet-300 border border-violet-200/80 dark:border-violet-800/80',
        text: 'text-violet-700 dark:text-violet-300',
        label: display.label,
        icon: <Link2 className="h-3 w-3" />,
      };
    default:
      return {
        bg: 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700',
        text: 'text-slate-700 dark:text-slate-300',
        label: display.label,
        icon: <AlertTriangle className="h-3 w-3" />,
      };
  }
}

function InlineCitationMarker({
  citation,
  onClick,
}: {
  citation: InlineCitation;
  onClick?: () => void;
}) {
  const { i18n } = useTranslation();
  const lang: 'vi' | 'en' = i18n.language?.startsWith('vi') ? 'vi' : 'en';
  const status = getInlineStatusBadge(citation.label, lang);
  const isFlaggedRed =
    citation.label === 'suspected_hallucination' ||
    citation.label === 'metadata_error';

  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1 hover:opacity-85 transition-all text-xs font-mono font-semibold ${
        isFlaggedRed
          ? 'text-red-600 dark:text-red-400 underline decoration-red-500/70'
          : `${status.text} underline`
      }`}
      title={`${status.label}: ${citation.raw}`}
    >
      <span className="max-w-[160px] truncate">{citation.raw}</span>
      <span className="shrink-0">{status.icon}</span>
    </button>
  );
}

function CitationPopup({
  essayId,
  citation,
  verdict,
  onSelectVerdictInCitations,
  onClose,
}: {
  essayId: string;
  citation: InlineCitation;
  verdict: Verdict | null;
  onSelectVerdictInCitations?: (citationId: string) => void;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const lang: 'vi' | 'en' = i18n.language?.startsWith('vi') ? 'vi' : 'en';
  const status = getInlineStatusBadge(citation.label, lang);
  const { dialogProps, titleId } = useModalA11y<HTMLDivElement>(true, onClose);

  return createPortal(
    <div
      className="fixed inset-0 bg-slate-950/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        {...dialogProps}
        className="w-full max-w-lg max-h-[90dvh] flex flex-col bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150 outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3.5 bg-slate-50/90 dark:bg-slate-900/90 border-b border-slate-200/80 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <Quote className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />
            <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">
              {lang === 'vi' ? 'Trình xem trích dẫn' : 'Citation Inspector'}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
            aria-label={t('inspector.closeModalAria')}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className={`px-6 py-3.5 border-b border-slate-200/60 dark:border-slate-800 ${status.bg}`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              {status.icon}
              <div>
                <h3 id={titleId} className={`text-sm font-semibold ${status.text}`}>
                  {t('inspector.citationDetail')}
                </h3>
                <p className={`text-xs font-mono ${status.text} opacity-85`}>{status.label}</p>
              </div>
            </div>
            <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-white/60 dark:bg-slate-900/60 text-slate-700 dark:text-slate-300">
              {citation.markerLabel}
            </span>
          </div>
        </div>

        <div className="p-4 sm:p-6 space-y-4 overflow-y-auto">
          <div className="min-w-0 flex-1">
            <label className="text-[11px] font-mono font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              {t('inspector.inTextCitation')}
            </label>
            <p className="mt-1.5 text-sm text-slate-900 dark:text-slate-100 font-medium font-serif p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700/70">
              {citation.raw}
            </p>
          </div>

          <div className="flex flex-wrap gap-4">
            <div>
              <label className="text-[11px] font-mono font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                {t('inspector.verification')}
              </label>
              <div className="mt-1.5">
                <VerdictBadge
                  verdict={citation.label}
                  triggeredRules={verdict?.triggered_rules}
                  size="sm"
                />
              </div>
            </div>
            <div>
              <label className="text-[11px] font-mono font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                {t('inspector.mapping')}
              </label>
              <div className="mt-1.5">
                <MappingStatusBadge status={citation.mapping_status} size="sm" />
              </div>
            </div>
            {(() => {
              const rawSt = verdict?.url_status ?? verdict?.features?.url_status;
              const archiveUrl = verdict?.archive_url ?? verdict?.features?.archive_url;
              const isWrongPage = (verdict?.triggered_rules ?? []).includes(
                'R-URL-CONTENT-MISMATCH',
              );
              const isWayback =
                rawSt === 'archived_alive' ||
                Boolean(archiveUrl) ||
                (verdict?.triggered_rules ?? []).includes('R-WAYBACK-ARCHIVED');
              const st =
                isWayback && rawSt !== 'alive' && rawSt !== 'restricted_alive'
                  ? 'archived_alive'
                  : rawSt === 'alive' ||
                      rawSt === 'restricted_alive' ||
                      rawSt === 'dead_link' ||
                      rawSt === 'fake_domain'
                    ? rawSt
                    : null;
              if (!st && !isWrongPage) return null;
              const code = verdict?.url_status_code ?? verdict?.features?.url_status_code;
              const isOk = !isWrongPage && (st === 'alive' || st === 'restricted_alive');
              const isArchived = isWrongPage || st === 'archived_alive';
              return (
                <div>
                  <label className="text-[11px] font-mono font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    {t('inspector.linkStatus')}
                  </label>
                  <div className="mt-1.5">
                    <span
                      className={`inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-mono font-semibold border ${
                        isOk
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/70 dark:text-emerald-300 dark:border-emerald-800'
                          : isArchived
                            ? 'bg-amber-50 text-amber-800 border-amber-300 dark:bg-amber-950/70 dark:text-amber-300 dark:border-amber-800'
                            : 'bg-red-50 text-red-700 border-red-200 dark:bg-red-950/70 dark:text-red-300 dark:border-red-800'
                      }`}
                    >
                      {isWrongPage
                        ? lang === 'vi'
                          ? `⚠ HTTP ${code || 200} · Sai nội dung trang`
                          : `⚠ HTTP ${code || 200} · Wrong Page`
                        : st === 'alive'
                          ? `✓ HTTP ${code || 200} OK`
                          : st === 'restricted_alive'
                            ? lang === 'vi'
                              ? `🔒 Truy cập hạn chế (HTTP ${code || 403})`
                              : `🔒 Restricted Access (HTTP ${code || 403})`
                            : st === 'archived_alive'
                              ? lang === 'vi'
                                ? '🏛️ Lưu trữ Wayback'
                                : '🏛️ Wayback Archived'
                              : st === 'dead_link'
                                ? lang === 'vi'
                                  ? `✕ Liên kết lỗi (HTTP ${code || 404})`
                                  : `✕ Broken Link (HTTP ${code || 404})`
                                : lang === 'vi'
                                  ? '✕ URL không hợp lệ'
                                  : '✕ Invalid URL'}
                    </span>
                  </div>
                </div>
              );
            })()}
          </div>

          {verdict && (
            <>
              <div>
                <label className="text-[11px] font-mono font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                  {t('inspector.whatWeFound')}
                </label>
                <p className="mt-1 text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
                  {getVerdictExplanation(verdict, lang)}
                </p>
              </div>

              <div>
                <label className="text-[11px] font-mono font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                  {t('inspector.confidence')}
                </label>
                <div className="mt-2 flex items-center gap-3">
                  <Progress
                    value={verdict.confidence * 100}
                    className="flex-1 h-2"
                    indicatorClassName={
                      verdict.confidence >= 0.8
                        ? 'bg-emerald-500'
                        : verdict.confidence >= 0.5
                        ? 'bg-amber-500'
                        : 'bg-red-500'
                    }
                  />
                  <span className="text-xs font-mono font-semibold text-slate-700 dark:text-slate-300">
                    {(verdict.confidence * 100).toFixed(0)}%
                  </span>
                </div>
              </div>

              {(() => {
                const f = verdict.features as
                  | (NonNullable<Verdict['features']> & {
                      cross_lingual_bridged_concepts?: string[];
                      cross_lingual_alignment?: boolean | number;
                    })
                  | undefined;
                if (!f) return null;
                const hasAnyTitleSim =
                  f.title_sim_fuzzy !== undefined ||
                  f.title_sim_semantic !== undefined ||
                  f.cross_lingual_title_sim !== undefined;
                const bestTitleSim = hasAnyTitleSim
                  ? Math.max(
                      f.title_sim_fuzzy ?? 0,
                      f.title_sim_semantic ?? 0,
                      f.cross_lingual_title_sim ?? 0,
                    )
                  : 0;
                const bridgedConcepts = filterValidBridgedConcepts(
                  f.cross_lingual_bridged_concepts?.length
                    ? f.cross_lingual_bridged_concepts
                    : f.bridged_concepts,
                );
                const isCrossLingual =
                  bridgedConcepts.length > 0 ||
                  Boolean(f.cross_lingual_detected) ||
                  Boolean(f.cross_lingual_alignment) ||
                  Boolean(f.cross_lingual_title_detected) ||
                  (f.cross_lingual_title_sim ?? 0) >= 0.5 ||
                  (verdict.triggered_rules ?? []).some(
                    (r) =>
                      r === 'R-CROSS-LINGUAL-ALIGNMENT' ||
                      r === 'R-CROSS-LINGUAL-TITLE-MATCH',
                  );
                const alignScore = f.content_alignment_score ?? 0;
                if (
                  alignScore <= 0 &&
                  !f.best_evidence_sentence &&
                  !isCrossLingual
                ) {
                  return null;
                }
                const displayScore =
                  alignScore > 0 ? alignScore : bestTitleSim;
                return (
                  <div className="rounded-xl border border-indigo-200/80 dark:border-indigo-900/70 bg-indigo-50/40 dark:bg-indigo-950/25 p-3.5 space-y-2.5">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-indigo-900 dark:text-indigo-200 uppercase tracking-wider">
                        <Brain className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />
                        {t('inspector.neuralSemanticMatch')}
                      </span>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {f.citation_intent && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-indigo-100/90 text-indigo-700 dark:bg-indigo-900/80 dark:text-indigo-300">
                            <Sparkles className="h-2.5 w-2.5" />
                            {formatIntentLabel(f.citation_intent, lang)}
                          </span>
                        )}
                        {f.stance_label && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-100/80 text-emerald-700 dark:bg-emerald-900/70 dark:text-emerald-300">
                            {formatStanceLabel(f.stance_label, lang)}
                          </span>
                        )}
                        {isCrossLingual && (
                          <span
                            data-testid="inspector-cross-lingual-pill"
                            className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-teal-100/80 text-teal-800 dark:bg-teal-900/70 dark:text-teal-300"
                          >
                            {lang === 'vi' ? 'Đối chiếu Việt ↔ Anh' : 'VI ↔ EN Match'}
                            {bestTitleSim > 0 ? ` · ${Math.round(bestTitleSim * 100)}%` : ''}
                          </span>
                        )}
                        {displayScore > 0 && (
                          <span className="text-[11px] font-mono font-bold text-indigo-700 dark:text-indigo-300">
                            {Math.round(displayScore * 100)}%
                          </span>
                        )}
                      </div>
                    </div>

                    {bridgedConcepts.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {bridgedConcepts.slice(0, 5).map((bc, bIdx) => (
                          <span
                            key={`${bc}-${bIdx}`}
                            className="inline-flex items-center px-1.5 py-0.5 rounded bg-teal-50 dark:bg-teal-950/60 border border-teal-200/80 dark:border-teal-800 text-[10px] font-mono text-teal-800 dark:text-teal-300"
                          >
                            {bc}
                          </span>
                        ))}
                      </div>
                    )}

                    {f.best_evidence_sentence && (
                      <div className="rounded-lg bg-white/90 dark:bg-slate-900/90 border border-slate-200/80 dark:border-slate-800 p-2.5">
                        <span className="block text-[10px] font-mono font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-400 mb-1">
                          {t('inspector.matchedAbstractEvidence')}
                        </span>
                        <p className="text-xs font-serif text-slate-700 dark:text-slate-300 leading-relaxed">
                          “{f.best_evidence_sentence}”
                        </p>
                      </div>
                    )}
                  </div>
                );
              })()}

              {verdict.mismatched_fields.length > 0 && (
                <div>
                  <label className="text-[11px] font-mono font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    {t('inspector.mismatchedFields')}
                  </label>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {verdict.mismatched_fields.map((field) => (
                      <Badge
                        key={field}
                        variant="metadata_error"
                        className="px-2 py-0.5 rounded text-xs"
                      >
                        {getFieldDisplayName(field, lang).replace(/^the\s+/i, '')}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {verdict.triggered_rules.length > 0 && (
                <div>
                  <label className="text-[11px] font-mono font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    {t('inspector.triggeredRules')}
                  </label>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {verdict.triggered_rules.map((rule) => (
                      <Badge
                        key={rule}
                        variant="outline"
                        className="px-2 py-0.5 bg-indigo-50 dark:bg-indigo-950/80 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800 rounded text-xs font-mono"
                      >
                        {rule}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          <div className="pt-4 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between">
            {onSelectVerdictInCitations ? (
              <button
                type="button"
                onClick={() => {
                  onSelectVerdictInCitations(citation.id);
                  onClose();
                }}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                {t('inspector.viewFullReport')}
              </button>
            ) : (
              <Link
                to={`/verification/report/${essayId}?citation=${encodeURIComponent(citation.id)}`}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                {t('inspector.viewFullReport')}
              </Link>
            )}
            <button
              onClick={onClose}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors cursor-pointer"
            >
              {t('inspector.close')}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

export function DocumentInspectorWorkspace({
  essayId,
  report,
  embedded = false,
  onSelectVerdictInCitations,
}: {
  essayId: string;
  report: AnalysisReport;
  embedded?: boolean;
  onSelectVerdictInCitations?: (citationId: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const lang: 'vi' | 'en' = i18n.language?.startsWith('vi') ? 'vi' : 'en';
  const isDocx = isDocxFilename(report.filename);
  const [selectedCitation, setSelectedCitation] = useState<InlineCitation | null>(null);
  const [selectedVerdict, setSelectedVerdict] = useState<Verdict | null>(null);
  const [filterLabel, setFilterLabel] = useState<string>('all');
  const [docViewMode, setDocViewMode] = useState<'stream' | 'pdf'>('stream');
  const [previewPage, setPreviewPage] = useState<number>(1);
  const [previewHighlight, setPreviewHighlight] = useState<string>('');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState<boolean>(false);
  const [previewZoom, setPreviewZoom] = useState<100 | 150>(100);
  const [lightboxOpen, setLightboxOpen] = useState<boolean>(false);

  const numericId = essayId ? parseInt(essayId, 10) : report.essay_id;
  const { containerRef: viewModePillRef, pillStyle: viewModePill } =
    useSlidingPill<HTMLDivElement>(`${docViewMode}-${i18n.language}`);

  const inlineCitations = buildInlineCitations(
    report.verdicts,
    report.extracted_citations,
    report.references,
  );

  // Single-definition buckets: NEVER merge resource into verified (BUG-02)
  const filteredCitations =
    filterLabel === 'all'
      ? inlineCitations
      : inlineCitations.filter((c) => c.label === filterLabel);

  useEffect(() => {
    if (selectedCitation) {
      const verdict = report.verdicts.find(
        (v) => v.citation_id === selectedCitation.id,
      );
      setSelectedVerdict(verdict || null);
      if (selectedCitation.page && selectedCitation.page > 0) {
        setPreviewPage(selectedCitation.page);
      }
      setPreviewHighlight(selectedCitation.raw || '');
    }
  }, [selectedCitation, report]);

  useEffect(() => {
    if (docViewMode !== 'pdf' || !numericId || Number.isNaN(numericId)) return;
    let active = true;
    let currentObjUrl: string | null = null;
    setPreviewLoading(true);
    api
      .fetchEssayPagePreviewUrl(numericId, previewPage, previewHighlight || undefined)
      .then((url) => {
        if (active) {
          currentObjUrl = url;
          setPreviewUrl(url);
        } else {
          window.URL.revokeObjectURL(url);
        }
      })
      .catch(() => {
        if (active) setPreviewUrl(null);
      })
      .finally(() => {
        if (active) setPreviewLoading(false);
      });
    return () => {
      active = false;
      if (currentObjUrl) {
        window.URL.revokeObjectURL(currentObjUrl);
      }
    };
  }, [docViewMode, numericId, previewPage, previewHighlight]);

  const statusCounts = {
    verified: inlineCitations.filter((c) => c.label === 'verified').length,
    metadata_error: inlineCitations.filter((c) => c.label === 'metadata_error').length,
    suspected_hallucination: inlineCitations.filter((c) => c.label === 'suspected_hallucination').length,
    unresolved: inlineCitations.filter((c) => c.label === 'unresolved').length,
    ...(inlineCitations.some((c) => c.label === 'resource')
      ? { resource: inlineCitations.filter((c) => c.label === 'resource').length }
      : {}),
  };

  const statusLabelByKey: Record<string, string> = {
    verified: getVerdictDisplay('verified', lang).label,
    metadata_error: getVerdictDisplay('metadata_error', lang).label,
    suspected_hallucination: getVerdictDisplay('suspected_hallucination', lang).label,
    unresolved: getVerdictDisplay('unresolved', lang).label,
    resource: getVerdictDisplay('resource', lang).label,
  };

  return (
    <div className={embedded ? 'space-y-4' : 'space-y-6'}>
      {!embedded && (
        <div className={`grid grid-cols-2 ${'resource' in statusCounts ? 'sm:grid-cols-5' : 'sm:grid-cols-4'} gap-4`}>
          <Card className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 shadow-sm">
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-2">
                <div className="w-3 h-1 rounded-full bg-emerald-500" />
                <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
                  {statusLabelByKey.verified} ({statusCounts.verified})
                </span>
              </div>
            </div>
            <p className="text-2xl font-bold font-mono tabular-nums text-emerald-600 dark:text-emerald-400">
              {statusCounts.verified}
            </p>
          </Card>

          <Card className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 shadow-sm">
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-2">
                <div className="w-3 h-1 rounded-full bg-amber-500" />
                <span className="text-xs font-medium text-amber-600 dark:text-amber-400">
                  {statusLabelByKey.metadata_error} ({statusCounts.metadata_error})
                </span>
              </div>
            </div>
            <p className="text-2xl font-bold font-mono tabular-nums text-amber-600 dark:text-amber-400">
              {statusCounts.metadata_error}
            </p>
          </Card>

          <Card className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 shadow-sm">
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-2">
                <div className="w-3 h-1 rounded-full bg-red-500" />
                <span className="text-xs font-medium text-red-600 dark:text-red-400">
                  {statusLabelByKey.suspected_hallucination} ({statusCounts.suspected_hallucination})
                </span>
              </div>
            </div>
            <p className="text-2xl font-bold font-mono tabular-nums text-red-600 dark:text-red-400">
              {statusCounts.suspected_hallucination}
            </p>
          </Card>

          <Card className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 shadow-sm">
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-2">
                <div className="w-3 h-1 rounded-full bg-slate-400" />
                <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
                  {statusLabelByKey.unresolved} ({statusCounts.unresolved})
                </span>
              </div>
            </div>
            <p className="text-2xl font-bold font-mono tabular-nums text-slate-700 dark:text-slate-200">
              {statusCounts.unresolved}
            </p>
          </Card>

          {'resource' in statusCounts && (
            <Card className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 shadow-sm">
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-1 rounded-full bg-violet-500" />
                  <span className="text-xs font-medium text-violet-600 dark:text-violet-400">
                    {statusLabelByKey.resource} ({statusCounts.resource})
                  </span>
                </div>
              </div>
              <p className="text-2xl font-bold font-mono tabular-nums text-violet-600 dark:text-violet-400">
                {statusCounts.resource}
              </p>
            </Card>
          )}
        </div>
      )}

      {/* Main Document Context Container */}
      <div className="rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm overflow-hidden">
        {/* Top Filter Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 bg-slate-50/90 dark:bg-slate-900/90 border-b border-slate-200/80 dark:border-slate-800">
          <div className="flex items-center gap-2 text-xs font-medium text-slate-600 dark:text-slate-300">
            <BookOpen className="h-4 w-4 text-indigo-600 dark:text-indigo-400 shrink-0" />
            <span>
              {embedded
                ? t('inspector.summaryBar', {
                    pages: report.num_pages,
                    citations: inlineCitations.length,
                  })
                : lang === 'vi'
                  ? 'Trích dẫn trong ngữ cảnh văn bản'
                  : 'Inline Citations in Context'}
            </span>
          </div>

          {/* Filter controls */}
          <div className="flex flex-wrap items-center gap-1.5">
            <Filter className="h-3.5 w-3.5 text-slate-400 mr-1" />
            <button
              type="button"
              onClick={() => setFilterLabel('all')}
              className={`px-2.5 py-1 rounded-full text-xs font-semibold transition-colors cursor-pointer ${
                filterLabel === 'all'
                  ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900 shadow-sm'
                  : 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-slate-300'
              }`}
            >
              {t('inspector.filterAll')} ({inlineCitations.length})
            </button>
            {Object.entries(statusCounts).map(([label, count]) => (
              <button
                key={label}
                type="button"
                onClick={() => setFilterLabel(label)}
                className={`px-2.5 py-1 rounded-full text-xs font-semibold transition-colors cursor-pointer ${
                  filterLabel === label
                    ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900 shadow-sm'
                    : 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-slate-300'
                }`}
              >
                {statusLabelByKey[label] ?? label.replace(/_/g, ' ')} ({count})
              </button>
            ))}
          </div>
        </div>

        {/* Dual-Pane Document & Citation List View */}
        <div className="grid grid-cols-1 lg:grid-cols-12 divide-y lg:divide-y-0 lg:divide-x divide-slate-200/80 dark:divide-slate-800">
          {/* Document panel */}
          <div className="citra-cq-doc-left lg:col-span-7 min-w-0 p-4 sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3 pb-3 border-b border-slate-100 dark:border-slate-800/80">
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                <h3 className="font-sans text-base font-semibold text-slate-900 dark:text-slate-100">
                  {t('inspector.documentView')}
                </h3>
              </div>

              <div className="flex items-center gap-2">
                <div
                  ref={viewModePillRef}
                  role="group"
                  aria-label={t('inspector.previewModeAria')}
                  className="t-tabs relative inline-flex items-center p-0.5 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700"
                >
                  <span
                    aria-hidden="true"
                    style={{
                      width: `${viewModePill.width}px`,
                      height: `${viewModePill.height}px`,
                      transform: `translate3d(${viewModePill.left}px, ${viewModePill.top}px, 0)`,
                      opacity: viewModePill.ready ? 1 : 0,
                      transition: viewModePill.animate ? undefined : 'none',
                    }}
                    className="t-tabs-pill rounded-md bg-white dark:bg-slate-900 shadow-sm"
                  />
                  <button
                    type="button"
                    data-testid="toggle-stream-view"
                    data-pill-active={docViewMode === 'stream' ? 'true' : 'false'}
                    onClick={() => setDocViewMode('stream')}
                    className={`t-tab px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors cursor-pointer ${
                      docViewMode === 'stream'
                        ? viewModePill.ready
                          ? 'text-indigo-600 dark:text-indigo-400'
                          : 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-sm'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    {t('inspector.contextStream')}
                  </button>
                  <button
                    type="button"
                    data-testid="toggle-pdf-page-preview"
                    data-pill-active={docViewMode === 'pdf' ? 'true' : 'false'}
                    onClick={() => setDocViewMode('pdf')}
                    className={`t-tab inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors cursor-pointer ${
                      docViewMode === 'pdf'
                        ? viewModePill.ready
                          ? 'text-indigo-600 dark:text-indigo-400'
                          : 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-sm'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    <Eye className="h-3 w-3 text-indigo-500" />
                    <span>
                      {isDocx
                        ? lang === 'vi'
                          ? 'Xem trước trang tài liệu'
                          : 'Document Page Preview'
                        : t('inspector.pdfPagePreview')}
                    </span>
                  </button>
                </div>
              </div>
            </div>

            {/* Color-Coded Highlight Legend (BUG-45) */}
            <div
              data-testid="inspector-highlight-legend"
              className="flex flex-wrap items-center gap-x-3.5 gap-y-1 text-[11px] text-slate-600 dark:text-slate-400 mb-3 px-1"
            >
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-500 inline-block" />
                {statusLabelByKey.verified}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-amber-500 inline-block" />
                {statusLabelByKey.metadata_error}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-red-500 inline-block" />
                {statusLabelByKey.suspected_hallucination}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-violet-500 inline-block" />
                {statusLabelByKey.resource}
              </span>
            </div>

            <DirectionalStageSlide
              stageKey={docViewMode === 'stream' ? 0 : 1}
              distancePx={12}
            >
              {docViewMode === 'pdf' ? (
                <div className="space-y-3" data-testid="pdf-page-preview-pane">
                  {/* Page Switcher, Zoom & Lightbox Controls + Responsive Highlight Hint */}
                  <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-800">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={previewPage <= 1}
                        onClick={() => setPreviewPage((p) => Math.max(1, p - 1))}
                        className="p-1 rounded-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 disabled:opacity-40 hover:border-indigo-400 transition-colors cursor-pointer"
                        aria-label={t('inspector.prevPageAria')}
                      >
                        <ChevronLeft className="h-3.5 w-3.5" />
                      </button>
                      <span className="text-xs font-mono font-semibold text-slate-700 dark:text-slate-200">
                        {t('inspector.pageOf', {
                          current: previewPage,
                          total: Math.max(1, report.num_pages || 1),
                        })}
                      </span>
                      <button
                        type="button"
                        disabled={previewPage >= Math.max(1, report.num_pages || 1)}
                        onClick={() =>
                          setPreviewPage((p) =>
                            Math.min(Math.max(1, report.num_pages || 1), p + 1),
                          )
                        }
                        className="p-1 rounded-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 disabled:opacity-40 hover:border-indigo-400 transition-colors cursor-pointer"
                        aria-label={t('inspector.nextPageAria')}
                      >
                        <ChevronRight className="h-3.5 w-3.5" />
                      </button>

                      {/* Zoom Toggle 100% / 150% + Lightbox Fullscreen (BUG-45) */}
                      <button
                        type="button"
                        data-testid="pdf-zoom-toggle"
                        onClick={() => setPreviewZoom((z) => (z === 100 ? 150 : 100))}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-mono font-semibold bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:border-indigo-400 transition-colors cursor-pointer"
                        title={lang === 'vi' ? 'Thu phóng trang xem trước' : 'Toggle preview zoom'}
                      >
                        {previewZoom === 100 ? (
                          <ZoomIn className="h-3 w-3" />
                        ) : (
                          <ZoomOut className="h-3 w-3" />
                        )}
                        <span>{previewZoom}%</span>
                      </button>
                      {previewUrl && (
                        <button
                          type="button"
                          data-testid="pdf-lightbox-btn"
                          onClick={() => setLightboxOpen(true)}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:border-indigo-400 transition-colors cursor-pointer"
                          aria-label={lang === 'vi' ? 'Xem toàn màn hình' : 'Open fullscreen preview'}
                        >
                          <Maximize2 className="h-3 w-3" />
                          <span className="hidden sm:inline">
                            {lang === 'vi' ? 'Phóng to' : 'Expand'}
                          </span>
                        </button>
                      )}
                    </div>

                    {previewHighlight ? (
                      <div className="flex items-center gap-1.5 text-[11px] font-mono text-indigo-700 dark:text-indigo-300 bg-indigo-50/90 dark:bg-indigo-950/70 px-2.5 py-1 rounded-lg border border-indigo-200/80 dark:border-indigo-800 max-w-xs truncate">
                        <Sparkles className="h-3 w-3 shrink-0 text-amber-500" />
                        <span className="truncate">
                          {t('inspector.highlightPrefix', { text: previewHighlight })}
                        </span>
                      </div>
                    ) : (
                      <span className="text-[11px] text-slate-500 dark:text-slate-400">
                        <span className="lg:hidden">
                          {lang === 'vi'
                            ? 'Chọn trích dẫn bên dưới để đánh dấu trên trang'
                            : 'Select a citation below to highlight on page'}
                        </span>
                        <span className="hidden lg:inline">
                          {lang === 'vi'
                            ? 'Chọn trích dẫn bên phải để đánh dấu trên trang'
                            : 'Select a citation on the right to highlight on page'}
                        </span>
                      </span>
                    )}
                  </div>

                  {/* Rendered Page Image */}
                  <div className="relative rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-100/70 dark:bg-slate-950 min-h-[480px] max-h-[560px] overflow-auto flex items-start justify-center p-3">
                    {previewLoading ? (
                      <div className="flex flex-col items-center justify-center py-24 gap-2">
                        <Loader2 className="h-7 w-7 animate-spin text-indigo-600 dark:text-indigo-400" />
                        <span className="text-xs font-mono text-slate-500">
                          {t('inspector.renderingPage', { page: previewPage })}
                        </span>
                      </div>
                    ) : previewUrl ? (
                      <img
                        src={previewUrl}
                        alt={t('inspector.pageOf', {
                          current: previewPage,
                          total: Math.max(1, report.num_pages || 1),
                        })}
                        data-testid="pdf-page-preview-img"
                        style={{
                          width: previewZoom === 150 ? '150%' : '100%',
                          maxWidth: previewZoom === 150 ? 'none' : '100%',
                        }}
                        className="h-auto rounded-lg shadow-md border border-slate-200/90 dark:border-slate-800 bg-white transition-all"
                      />
                    ) : (
                      <div className="py-20 text-center text-xs font-mono text-slate-500">
                        {t('inspector.unableToRenderPreview')}
                      </div>
                    )}
                  </div>

                  {lightboxOpen && previewUrl && createPortal(
                    <div
                      data-testid="pdf-lightbox-modal"
                      role="dialog"
                      aria-modal="true"
                      className="fixed inset-0 z-[110] bg-slate-950/85 backdrop-blur-sm flex flex-col p-4"
                      onClick={() => setLightboxOpen(false)}
                    >
                      <div
                        className="flex items-center justify-between text-white pb-3"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <span className="text-sm font-semibold">
                          {t('inspector.pageOf', {
                            current: previewPage,
                            total: Math.max(1, report.num_pages || 1),
                          })}
                        </span>
                        <button
                          type="button"
                          onClick={() => setLightboxOpen(false)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-xs font-semibold cursor-pointer"
                        >
                          <X className="h-4 w-4" />
                          <span>{lang === 'vi' ? 'Đóng' : 'Close'}</span>
                        </button>
                      </div>
                      <div
                        className="flex-1 overflow-auto flex items-start justify-center"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <img
                          src={previewUrl}
                          alt={t('inspector.pageOf', {
                            current: previewPage,
                            total: Math.max(1, report.num_pages || 1),
                          })}
                          className="max-w-4xl w-full h-auto rounded-xl bg-white shadow-2xl"
                        />
                      </div>
                    </div>,
                    document.body,
                  )}
                </div>
              ) : (
                <div className="prose prose-slate dark:prose-invert max-w-none">
                  <div className="space-y-4 text-sm leading-relaxed max-h-[540px] overflow-y-auto pr-2">
                    {filteredCitations.length === 0 ? (
                      <p className="text-slate-500 dark:text-slate-400 italic py-8 text-center font-mono text-xs">
                        {t('inspector.noCitationsMatchFilter')}
                      </p>
                    ) : (
                      filteredCitations.map((citation) => {
                        const isFlaggedRed =
                          citation.label === 'suspected_hallucination' ||
                          citation.label === 'metadata_error';
                        return (
                          <div
                            key={citation.id}
                            data-verdict-label={citation.label}
                            className={`group relative rounded-xl p-3.5 border transition-colors ${
                              selectedCitation?.id === citation.id
                                ? 'bg-indigo-50/60 dark:bg-indigo-950/30 border-indigo-300 dark:border-indigo-700'
                                : 'bg-slate-50/60 dark:bg-slate-800/30 border-slate-200/70 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                            }`}
                          >
                            <div className="flex items-start gap-3">
                              <button
                                type="button"
                                onClick={() => {
                                  setPreviewPage(citation.page || 1);
                                  setPreviewHighlight(citation.raw || '');
                                  setDocViewMode('pdf');
                                }}
                                aria-label={t('inspector.inspectBboxTooltip')}
                                title={embedded ? undefined : t('inspector.inspectBboxTooltip')}
                                className={`text-[11px] font-mono hover:underline shrink-0 pt-0.5 select-none font-bold cursor-pointer ${
                                  isFlaggedRed
                                    ? 'text-red-600 dark:text-red-400'
                                    : 'text-indigo-600 dark:text-indigo-400'
                                }`}
                              >
                                {(() => {
                                  const inner = citation.markerLabel.replace(/^\[|\]$/g, '');
                                  return `p${citation.page}:${/^\d+$/.test(inner) ? inner.padStart(2, '0') : inner}`;
                                })()}
                              </button>
                              <p className="flex-1 min-w-0 text-slate-700 dark:text-slate-300 font-serif leading-relaxed break-words [overflow-wrap:anywhere]">
                                {citation.context ? (
                                  <>
                                    <ContextWithHighlight
                                      context={citation.context}
                                      marker={citation.raw}
                                      markerLabel={citation.markerLabel}
                                      label={citation.label}
                                    />{' '}
                                    <InlineCitationMarker
                                      citation={citation}
                                      onClick={() => setSelectedCitation(citation)}
                                    />
                                  </>
                                ) : (
                                  <>
                                    <span className="text-slate-500 dark:text-slate-400 italic font-sans text-xs">
                                      {t('inspector.noSurroundingText')}
                                    </span>{' '}
                                    <InlineCitationMarker
                                      citation={citation}
                                      onClick={() => setSelectedCitation(citation)}
                                    />
                                  </>
                                )}
                              </p>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              )}
            </DirectionalStageSlide>
          </div>

          {/* Citation list panel */}
          <div className="citra-cq-doc-right lg:col-span-5 min-w-0 p-4 sm:p-6 bg-slate-50/30 dark:bg-slate-900/40">
            <div className="flex items-center justify-between mb-4 pb-3 border-b border-slate-100 dark:border-slate-800/80">
              <div className="flex items-center gap-2">
                <Quote className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                <h3 className="font-sans text-base font-semibold text-slate-900 dark:text-slate-100">
                  {t('inspector.citationList')}
                </h3>
              </div>
              <span className="text-xs font-mono text-slate-500 dark:text-slate-400">
                {t('inspector.citationsCount', { count: filteredCitations.length })}
              </span>
            </div>

            <div className="space-y-2.5 max-h-[540px] overflow-y-auto pr-1">
              {filteredCitations.map((citation, index) => {
                const status = getInlineStatusBadge(citation.label, lang);
                const isFlaggedRed =
                  citation.label === 'suspected_hallucination' ||
                  citation.label === 'metadata_error';
                const isSelected =
                  selectedCitation?.id === citation.id ||
                  (docViewMode === 'pdf' && previewHighlight === citation.raw);
                return (
                  <button
                    key={citation.id}
                    type="button"
                    data-testid={`page-citation-item-${index}`}
                    data-verdict-label={citation.label}
                    onClick={() => {
                      setPreviewPage(citation.page || 1);
                      setPreviewHighlight(citation.raw || '');
                      if (docViewMode !== 'pdf') {
                        setSelectedCitation(citation);
                      }
                    }}
                    className={`w-full text-left p-3.5 rounded-xl border transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-indigo-50/90 dark:bg-indigo-950/60 border-indigo-300 dark:border-indigo-700 shadow-sm'
                        : 'bg-white dark:bg-slate-900 border-slate-200/80 dark:border-slate-800 hover:border-indigo-300 dark:hover:border-indigo-700'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <span
                        className={`text-xs font-mono font-bold shrink-0 pt-0.5 ${
                          isFlaggedRed
                            ? 'text-red-600 dark:text-red-400'
                            : 'text-slate-400 dark:text-slate-500'
                        }`}
                      >
                        {citation.markerLabel}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p
                          className={`text-sm font-serif line-clamp-2 break-words [overflow-wrap:anywhere] ${
                            isFlaggedRed
                              ? 'text-red-600 dark:text-red-400 font-medium'
                              : 'text-slate-800 dark:text-slate-200'
                          }`}
                        >
                          {citation.raw
                            .replace(/^\s*\[\s*\d+[a-z]?\s*\]\s*/i, '')
                            .replace(/^\s*\([a-z]\)\s*/i, '')}
                        </p>
                        <div className="flex items-center gap-2 mt-2 flex-wrap">
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium ${status.bg}`}
                          >
                            {status.icon}
                            {status.label}
                          </span>
                          <MappingStatusBadge
                            status={citation.mapping_status}
                            size="sm"
                          />
                          {citation.isCrossLingual && (
                            <span
                              data-testid={`inspector-list-cross-lingual-${index}`}
                              className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold bg-teal-50 dark:bg-teal-950/70 text-teal-800 dark:text-teal-300 border border-teal-200/80 dark:border-teal-800"
                            >
                              {lang === 'vi' ? 'Đối chiếu Việt ↔ Anh' : 'VI ↔ EN Match'}
                              {citation.crossLingualSim && citation.crossLingualSim > 0
                                ? ` · ${Math.round(citation.crossLingualSim * 100)}%`
                                : ''}
                            </span>
                          )}
                          {citation.alignmentScore !== undefined &&
                            citation.alignmentScore > 0 && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold bg-indigo-50 dark:bg-indigo-950/70 text-indigo-700 dark:text-indigo-300 border border-indigo-200/80 dark:border-indigo-800">
                                <Brain className="h-2.5 w-2.5" />
                                {Math.round(citation.alignmentScore * 100)}%
                                {citation.citationIntent
                                  ? ` · ${formatIntentLabel(citation.citationIntent, lang)}`
                                  : ''}
                              </span>
                            )}
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {selectedCitation && (
        <CitationPopup
          essayId={essayId}
          citation={selectedCitation}
          verdict={selectedVerdict}
          onSelectVerdictInCitations={onSelectVerdictInCitations}
          onClose={() => {
            setSelectedCitation(null);
            setSelectedVerdict(null);
          }}
        />
      )}
    </div>
  );
}

/**
 * @internal Retained for standalone `DocumentInspectorPage` unit test coverage;
 * production route `/verification/report/:id/document` renders `EssayPage` + `DocumentInspectorWorkspace`.
 */
export function DocumentInspectorPage() {
  const { id } = useParams<{ id: string }>();
  const { t, i18n } = useTranslation();
  const isVi = Boolean(i18n.language?.startsWith('vi'));
  const lang: 'vi' | 'en' = isVi ? 'vi' : 'en';

  const numericId = id ? parseInt(id, 10) : null;
  const { report, error } = useEssayPolling(
    numericId !== null && !Number.isNaN(numericId) && numericId > 0 ? numericId : null,
    { errorMessage: t('inspector.loadError') },
  );

  if (error) {
    return (
      <div
        data-testid="inspector-error-card"
        className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 sm:p-8 shadow-sm max-w-2xl mx-auto my-8"
      >
        <div className="flex items-start gap-4">
          <div className="h-12 w-12 rounded-2xl bg-amber-50 dark:bg-amber-950/70 border border-amber-200 dark:border-amber-800 flex items-center justify-center shrink-0">
            <AlertCircle className="h-6 w-6 text-amber-600 dark:text-amber-400" />
          </div>
          <div className="space-y-3 flex-1 min-w-0">
            <h2 className="font-display text-lg font-bold text-slate-900 dark:text-slate-100">
              {isVi ? 'Không thể mở trình xem tài liệu' : 'Unable to Open Document Inspector'}
            </h2>
            <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed break-words">
              {formatUserError(error, lang)}
            </p>
            <div className="pt-1">
              <Link
                to="/history"
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white transition-colors"
              >
                <ArrowLeft className="h-4 w-4" />
                {isVi ? 'Về lịch sử báo cáo' : 'Back to History'}
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
        <span className="ml-3 text-slate-600 dark:text-slate-300 font-mono text-sm">
          {t('common.loading')}
        </span>
      </div>
    );
  }

  const inlineCitationsCount = buildInlineCitations(
    report.verdicts,
    report.extracted_citations,
    report.references,
  ).length;

  return (
    <div className="space-y-4 pb-10">
      {/* Shared Report Header */}
      <EssayHeader
        essayId={report.essay_id}
        filename={report.filename}
        numPages={report.num_pages}
        numCitations={report.num_citations}
        numReferences={report.verdicts.length}
        styleName={report.style_profile?.style}
      />

      {/* Legacy Vietnamese Encoding (TCVN3/VNI) & Page-Selective OCR Recovery Diagnostics */}
      {(Boolean(report.document_diagnostics?.legacy_encoding_detected) ||
        (report.document_diagnostics?.ocr_pages_recovered?.length ?? 0) > 0) && (
        <div
          data-testid="inspector-doc-diagnostics-banner"
          className="flex flex-wrap items-center gap-2.5"
        >
          {report.document_diagnostics?.legacy_encoding_detected && (
            <div
              data-testid="legacy-encoding-diagnostic-pill"
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-mono bg-indigo-50/90 dark:bg-indigo-950/60 border border-indigo-200 dark:border-indigo-800 text-indigo-800 dark:text-indigo-200"
            >
              <Sparkles className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400 shrink-0" />
              <span>
                {isVi
                  ? `Đã tự động chuyển mã bảng mã tiếng Việt cũ (${String(report.document_diagnostics.legacy_encoding_detected).toUpperCase()} → Unicode NFC)`
                  : `Auto-transcoded legacy Vietnamese encoding (${String(report.document_diagnostics.legacy_encoding_detected).toUpperCase()} → Unicode NFC)`}
              </span>
            </div>
          )}
          {(report.document_diagnostics?.ocr_pages_recovered?.length ?? 0) > 0 && (
            <div
              data-testid="ocr-recovery-diagnostic-pill"
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-mono bg-emerald-50/90 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200"
            >
              <CheckCircle className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <span>
                {isVi
                  ? `Đã khôi phục văn bản bằng OCR (Tesseract vie+eng) tại trang: ${report.document_diagnostics!.ocr_pages_recovered!.join(', ')}`
                  : `Recovered text via Tesseract OCR (vie+eng) on page(s): ${report.document_diagnostics!.ocr_pages_recovered!.join(', ')}`}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Shared Multi-Tab Diagnostic Navigation + Compact CIS Score (BUG-19) */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <EssayActionBar essayId={id ?? ''} filename={report.filename} />
        <div className="flex flex-wrap items-center gap-2.5 text-xs font-mono text-slate-500 dark:text-slate-400">
          {report.cis && (
            <span
              data-testid="inspector-cis-pill"
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200/80 dark:border-indigo-800/80 font-semibold"
            >
              <span>CIS:</span>
              <span>
                {report.cis.is_unscannable
                  ? isVi
                    ? 'N/A · Không thể quét'
                    : 'N/A · Not Scannable'
                  : `${Number(report.cis.score ?? 0).toFixed(1)} / 100`}
              </span>
            </span>
          )}
          <div className="flex items-center gap-2">
            <BookOpen className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
            <span>
              {t('inspector.summaryBar', {
                pages: report.num_pages,
                citations: inlineCitationsCount,
              })}
            </span>
          </div>
        </div>
      </div>

      {/* Non-Accusatory Academic Decision-Support Disclaimer (BUG-03) */}
      <DecisionSupportBanner variant="compact" lang={lang} />

      <DocumentInspectorWorkspace
        essayId={id ?? ''}
        report={report}
        embedded={false}
      />
    </div>
  );
}
