import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useParams, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api, type Verdict, type Citation } from '@/api/client';
import { VerdictBadge } from '@/components/VerdictBadge';
import { MappingStatusBadge } from '@/components/MappingStatusBadge';
import { getVerdictExplanation, isUrlResource } from '@/lib/verdictExplanation';
import { useEssayPolling } from '@/hooks/useEssayPolling';
import { EssayHeader } from './essay/EssayHeader';
import { EssayActionBar } from './essay/EssayActionBar';
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
  Terminal,
  Filter,
  Brain,
  Sparkles,
  Eye,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

/* ============================================================
   SourceLogic — Document Inspector Page (Scholarly Precision v2.0)
   Interactive Citation Debugger IDE — Inline Context Stream
   ============================================================ */

const UNDERLINE_COLORS = {
  verified: 'border-emerald-500 dark:border-emerald-400',
  metadata_error: 'border-amber-500 dark:border-amber-400',
  suspected_hallucination: 'border-red-500 dark:border-red-400',
  unresolved: 'border-slate-400 dark:border-slate-500',
};

interface InlineCitation {
  id: string;
  raw: string;
  refNum: number;
  label: string;
  mapping_status: string;
  page: number;
  line: string;
  context?: string;
  alignmentScore?: number;
  citationIntent?: string;
  stanceLabel?: string;
  evidenceSentence?: string;
  contextSource?: string;
}

function ContextWithHighlight({
  context,
  marker,
  label,
}: {
  context: string;
  marker: string;
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

  if (idx === -1) {
    // Try bracket number [N] from marker
    const numMatch = marker.match(/^\s*(\[\d+\])/);
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
    const rawNumMatch = (v.citation_raw ?? '').match(/^\s*\[(\d+)\]/);
    const refIdNumMatch = refId?.match(/^ref-0*(\d+)$/);
    const resolvedRefNum = rawNumMatch
      ? parseInt(rawNumMatch[1], 10)
      : refIdNumMatch
        ? parseInt(refIdNumMatch[1], 10)
        : vIdx + 1;
    let matchedRef: Citation | undefined;
    if (refId) {
      const idxNum = parseInt(refId.replace(/^ref-/, ''), 10);
      if (!Number.isNaN(idxNum) && idxNum >= 1 && idxNum <= refs.length) {
        matchedRef = refs[idxNum - 1];
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
      label: isUrlResource(v) ? 'resource' : v.label,
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
    };
  });

  return items.sort((a, b) => {
    const aIsResource = a.label === 'resource' ? 1 : 0;
    const bIsResource = b.label === 'resource' ? 1 : 0;
    if (aIsResource !== bIsResource) return aIsResource - bIsResource;
    return a.refNum - b.refNum;
  });
}

function getInlineStatusBadge(
  label: string,
  t: (key: string) => string,
): {
  bg: string;
  text: string;
  label: string;
  icon: React.ReactNode;
} {
  switch (label) {
    case 'verified':
      return {
        bg: 'bg-emerald-100/90 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-300 border border-emerald-200/80 dark:border-emerald-800/80',
        text: 'text-emerald-700 dark:text-emerald-300',
        label: t('inspector.verified'),
        icon: <CheckCircle className="h-3 w-3" />,
      };
    case 'metadata_error':
      return {
        bg: 'bg-amber-100/90 dark:bg-amber-950/80 text-amber-700 dark:text-amber-300 border border-amber-200/80 dark:border-amber-800/80',
        text: 'text-amber-700 dark:text-amber-300',
        label: t('inspector.metaError'),
        icon: <AlertTriangle className="h-3 w-3" />,
      };
    case 'suspected_hallucination':
      return {
        bg: 'bg-red-100/90 dark:bg-red-950/80 text-red-700 dark:text-red-300 border border-red-200/80 dark:border-red-800/80',
        text: 'text-red-700 dark:text-red-300',
        label: t('inspector.suspected'),
        icon: <XCircle className="h-3 w-3" />,
      };
    case 'resource':
      return {
        bg: 'bg-violet-100/90 dark:bg-violet-950/80 text-violet-700 dark:text-violet-300 border border-violet-200/80 dark:border-violet-800/80',
        text: 'text-violet-700 dark:text-violet-300',
        label: t('inspector.urlResource'),
        icon: <Link2 className="h-3 w-3" />,
      };
    default:
      return {
        bg: 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700',
        text: 'text-slate-700 dark:text-slate-300',
        label: t('inspector.unverifiable'),
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
  const { t } = useTranslation();
  const status = getInlineStatusBadge(citation.label, t);
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
      title={`[${citation.label}] ${citation.raw}`}
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
  onClose,
}: {
  essayId: string;
  citation: InlineCitation;
  verdict: Verdict | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const status = getInlineStatusBadge(citation.label, t);

  return createPortal(
    <div
      className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs z-[100] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg max-h-[90dvh] flex flex-col bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3.5 bg-slate-50/90 dark:bg-slate-900/90 border-b border-slate-200/80 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-red-400/80" />
              <span className="w-2.5 h-2.5 rounded-full bg-amber-400/80" />
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400/80" />
            </div>
            <Separator orientation="vertical" className="h-4" />
            <Quote className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />
            <span className="text-xs font-mono font-semibold text-slate-700 dark:text-slate-200">
              citation_inspector.modal
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            aria-label={t('inspector.closeModalAria')}
          >
            <XCircle className="h-4 w-4" />
          </button>
        </div>

        <div className={`px-6 py-3.5 border-b border-slate-200/60 dark:border-slate-800 ${status.bg}`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              {status.icon}
              <div>
                <h3 className={`text-sm font-semibold ${status.text}`}>
                  {t('inspector.citationDetail')}
                </h3>
                <p className={`text-xs font-mono ${status.text} opacity-85`}>{status.label}</p>
              </div>
            </div>
            <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-white/60 dark:bg-slate-900/60 text-slate-700 dark:text-slate-300">
              ID: {citation.id}
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
                <VerdictBadge verdict={citation.label} size="sm" />
              </div>
            </div>
            <div>
              <label className="text-[11px] font-mono font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                {t('inspector.mapping')}
              </label>
              <div className="mt-1.5">
                <MappingStatusBadge status={citation.mapping_status as any} size="sm" />
              </div>
            </div>
            {(verdict?.url_status ?? verdict?.features?.url_status) && (
              <div>
                <label className="text-[11px] font-mono font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                  {t('inspector.linkStatus')}
                </label>
                <div className="mt-1.5">
                  {(() => {
                    const st = verdict?.url_status ?? verdict?.features?.url_status;
                    const code = verdict?.url_status_code ?? verdict?.features?.url_status_code;
                    const isOk = st === 'alive' || st === 'restricted_alive';
                    const isArchived = st === 'archived_alive';
                    return (
                      <span
                        className={`inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-mono font-semibold border ${
                          isOk
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/70 dark:text-emerald-300 dark:border-emerald-800'
                            : isArchived
                              ? 'bg-amber-50 text-amber-800 border-amber-300 dark:bg-amber-950/70 dark:text-amber-300 dark:border-amber-800'
                              : 'bg-red-50 text-red-700 border-red-200 dark:bg-red-950/70 dark:text-red-300 dark:border-red-800'
                        }`}
                      >
                        {st === 'alive'
                          ? `✓ HTTP ${code || 200} OK`
                          : st === 'restricted_alive'
                            ? `🔒 HTTP ${code || 403} OK`
                            : st === 'archived_alive'
                              ? '🏛️ WAYBACK ARCHIVED'
                              : st === 'dead_link'
                                ? `✕ HTTP ${code || 404} DEAD`
                                : '✕ FAKE URL'}
                      </span>
                    );
                  })()}
                </div>
              </div>
            )}
          </div>

          {verdict && (
            <>
              <div>
                <label className="text-[11px] font-mono font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                  {t('inspector.whatWeFound')}
                </label>
                <p className="mt-1 text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
                  {getVerdictExplanation(verdict)}
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

              {verdict.features &&
                ((verdict.features.content_alignment_score ?? 0) > 0 ||
                  Boolean(verdict.features.best_evidence_sentence)) && (
                  <div className="rounded-xl border border-indigo-200/80 dark:border-indigo-900/70 bg-indigo-50/40 dark:bg-indigo-950/25 p-3.5 space-y-2.5">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <span className="inline-flex items-center gap-1.5 text-[11px] font-mono font-bold text-indigo-900 dark:text-indigo-200 uppercase tracking-wider">
                        <Brain className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />
                        {t('inspector.neuralSemanticMatch')}
                      </span>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {verdict.features.citation_intent && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-indigo-100/90 text-indigo-700 dark:bg-indigo-900/80 dark:text-indigo-300">
                            <Sparkles className="h-2.5 w-2.5" />
                            {verdict.features.citation_intent}
                          </span>
                        )}
                        {verdict.features.stance_label && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-emerald-100/80 text-emerald-700 dark:bg-emerald-900/70 dark:text-emerald-300">
                            {verdict.features.stance_label}
                          </span>
                        )}
                        {verdict.features.cross_lingual_detected && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-teal-100/80 text-teal-800 dark:bg-teal-900/70 dark:text-teal-300">
                            VI↔EN Bridge
                          </span>
                        )}
                        {(verdict.features.content_alignment_score ?? 0) > 0 && (
                          <span className="text-[11px] font-mono font-bold text-indigo-700 dark:text-indigo-300">
                            {Math.round((verdict.features.content_alignment_score ?? 0) * 100)}%
                          </span>
                        )}
                      </div>
                    </div>

                    {verdict.features.bridged_concepts &&
                      verdict.features.bridged_concepts.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {verdict.features.bridged_concepts.slice(0, 5).map((bc, bIdx) => (
                            <span
                              key={`${bc}-${bIdx}`}
                              className="inline-flex items-center px-1.5 py-0.5 rounded bg-teal-50 dark:bg-teal-950/60 border border-teal-200/80 dark:border-teal-800 text-[10px] font-mono text-teal-800 dark:text-teal-300"
                            >
                              {bc}
                            </span>
                          ))}
                        </div>
                      )}

                    {verdict.features.best_evidence_sentence && (
                      <div className="rounded-lg bg-white/90 dark:bg-slate-900/90 border border-slate-200/80 dark:border-slate-800 p-2.5">
                        <span className="block text-[10px] font-mono font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-400 mb-1">
                          {t('inspector.matchedAbstractEvidence')}
                        </span>
                        <p className="text-xs font-serif text-slate-700 dark:text-slate-300 leading-relaxed">
                          “{verdict.features.best_evidence_sentence}”
                        </p>
                      </div>
                    )}
                  </div>
                )}

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
                        className="px-2 py-0.5 rounded text-xs font-mono"
                      >
                        {field}
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
            <Link
              to={`/verification/report/${essayId}`}
              className="inline-flex items-center gap-1.5 text-xs font-mono font-semibold text-indigo-600 dark:text-indigo-400 hover:underline"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              {t('inspector.viewFullReport')}
            </Link>
            <button
              onClick={onClose}
              className="px-3 py-1.5 rounded-lg text-xs font-mono font-semibold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
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

export function DocumentInspectorPage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation();
  const [selectedCitation, setSelectedCitation] = useState<InlineCitation | null>(null);
  const [selectedVerdict, setSelectedVerdict] = useState<Verdict | null>(null);
  const [filterLabel, setFilterLabel] = useState<string>('all');
  const [docViewMode, setDocViewMode] = useState<'stream' | 'pdf'>('stream');
  const [previewPage, setPreviewPage] = useState<number>(1);
  const [previewHighlight, setPreviewHighlight] = useState<string>('');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState<boolean>(false);

  const numericId = id ? parseInt(id, 10) : null;
  const { report, error } = useEssayPolling(
    numericId !== null && !Number.isNaN(numericId) && numericId > 0 ? numericId : null,
    { errorMessage: t('inspector.loadError') },
  );

  const inlineCitations = report
    ? buildInlineCitations(
        report.verdicts,
        report.extracted_citations,
        report.references,
      )
    : [];

  const filteredCitations =
    filterLabel === 'all'
      ? inlineCitations
      : inlineCitations.filter((c) =>
          filterLabel === 'verified'
            ? c.label === 'verified' || c.label === 'resource'
            : c.label === filterLabel
        );

  useEffect(() => {
    if (selectedCitation && report) {
      const verdict = report.verdicts.find(
        (v) => v.citation_id === selectedCitation.id
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
    verified: inlineCitations.filter((c) => c.label === 'verified' || c.label === 'resource').length,
    metadata_error: inlineCitations.filter((c) => c.label === 'metadata_error').length,
    suspected_hallucination: inlineCitations.filter((c) => c.label === 'suspected_hallucination').length,
    unresolved: inlineCitations.filter((c) => c.label === 'unresolved').length,
  };

  const statusLabelByKey: Record<string, string> = {
    verified: t('inspector.verified'),
    metadata_error: t('inspector.metaError'),
    suspected_hallucination: t('inspector.suspected'),
    unresolved: t('inspector.unverifiable'),
  };

  if (error) {
    return (
      <Alert variant="destructive" className="card p-6 rounded-2xl">
        <AlertCircle className="h-5 w-5" />
        <AlertTitle className="font-medium">
          {t('common.error')}: {error}
        </AlertTitle>
        <AlertDescription>
          <Link
            to="/history"
            className="text-indigo-600 dark:text-indigo-400 hover:underline mt-2 inline-block"
          >
            {t('inspector.backToReports')}
          </Link>
        </AlertDescription>
      </Alert>
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

  return (
    <div className="space-y-6 pb-10">
      {/* Shared Report Header */}
      <EssayHeader
        essayId={report.essay_id}
        filename={report.filename}
        numPages={report.num_pages}
        numCitations={report.num_citations}
        styleName={report.style_profile?.style}
      />

      {/* Shared Multi-Tab Diagnostic Navigation */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <EssayActionBar essayId={id ?? ''} />
        <div className="flex items-center gap-2 text-xs font-mono text-slate-500 dark:text-slate-400">
          <BookOpen className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
          <span>
            {t('inspector.summaryBar', {
              pages: report.num_pages,
              citations: inlineCitations.length,
            })}
          </span>
        </div>
      </div>

      {/* Architectural Inline Status Legend & Metric Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 shadow-2xs">
          <div className="flex items-center justify-between mb-1.5">
            <div className="flex items-center gap-2">
              <div className="w-3 h-1 rounded-full bg-emerald-500" />
              <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
                {t('inspector.verified')} ({statusCounts.verified})
              </span>
            </div>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/80 text-emerald-600 dark:text-emerald-400">
              01
            </span>
          </div>
          <p className="text-2xl font-bold font-mono tabular-nums text-emerald-600 dark:text-emerald-400">
            {statusCounts.verified}
          </p>
        </Card>

        <Card className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 shadow-2xs">
          <div className="flex items-center justify-between mb-1.5">
            <div className="flex items-center gap-2">
              <div className="w-3 h-1 rounded-full bg-amber-500" />
              <span className="text-xs font-medium text-amber-600 dark:text-amber-400">
                {t('inspector.metaError')} ({statusCounts.metadata_error})
              </span>
            </div>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-50 dark:bg-amber-950/80 text-amber-600 dark:text-amber-400">
              02
            </span>
          </div>
          <p className="text-2xl font-bold font-mono tabular-nums text-amber-600 dark:text-amber-400">
            {statusCounts.metadata_error}
          </p>
        </Card>

        <Card className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 shadow-2xs">
          <div className="flex items-center justify-between mb-1.5">
            <div className="flex items-center gap-2">
              <div className="w-3 h-1 rounded-full bg-red-500" />
              <span className="text-xs font-medium text-red-600 dark:text-red-400">
                {t('inspector.suspected')} ({statusCounts.suspected_hallucination})
              </span>
            </div>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-red-50 dark:bg-red-950/80 text-red-600 dark:text-red-400">
              03
            </span>
          </div>
          <p className="text-2xl font-bold font-mono tabular-nums text-red-600 dark:text-red-400">
            {statusCounts.suspected_hallucination}
          </p>
        </Card>

        <Card className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 shadow-2xs">
          <div className="flex items-center justify-between mb-1.5">
            <div className="flex items-center gap-2">
              <div className="w-3 h-1 rounded-full bg-slate-400" />
              <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
                {t('inspector.unverifiable')} ({statusCounts.unresolved})
              </span>
            </div>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
              04
            </span>
          </div>
          <p className="text-2xl font-bold font-mono tabular-nums text-slate-700 dark:text-slate-200">
            {statusCounts.unresolved}
          </p>
        </Card>
      </div>

      {/* Main IDE Container */}
      <div className="rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm overflow-hidden">
        {/* IDE Top Chrome & Filter Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 bg-slate-50/90 dark:bg-slate-900/90 border-b border-slate-200/80 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-red-400/80" />
              <span className="w-2.5 h-2.5 rounded-full bg-amber-400/80" />
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400/80" />
            </div>
            <Separator orientation="vertical" className="h-4" />
            <Terminal className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />
            <span className="text-xs font-mono font-semibold text-slate-700 dark:text-slate-200">
              document_inspector.tei
            </span>
          </div>

          {/* Filter controls */}
          <div className="flex flex-wrap items-center gap-1.5">
            <Filter className="h-3.5 w-3.5 text-slate-400 mr-1" />
            <button
              onClick={() => setFilterLabel('all')}
              className={`px-2.5 py-1 rounded-lg text-xs font-mono font-medium transition-all ${
                filterLabel === 'all'
                  ? 'bg-indigo-600 text-white shadow-2xs'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
              }`}
            >
              {t('inspector.filterAll')} ({inlineCitations.length})
            </button>
            {Object.entries(statusCounts).map(([label, count]) => (
              <button
                key={label}
                onClick={() => setFilterLabel(label)}
                className={`px-2.5 py-1 rounded-lg text-xs font-mono font-medium transition-all ${
                  filterLabel === label
                    ? 'bg-indigo-600 text-white shadow-2xs'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
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
          <div className="lg:col-span-7 min-w-0 p-4 sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-4 pb-3 border-b border-slate-100 dark:border-slate-800/80">
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                <h3 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
                  {t('inspector.documentView')}
                </h3>
              </div>

              <div className="flex items-center gap-2">
                <div
                  role="group"
                  aria-label={t('inspector.previewModeAria')}
                  className="inline-flex items-center p-0.5 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700"
                >
                  <button
                    type="button"
                    data-testid="toggle-stream-view"
                    onClick={() => setDocViewMode('stream')}
                    className={`px-2.5 py-1 rounded-md text-[11px] font-mono font-semibold transition-all ${
                      docViewMode === 'stream'
                        ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-2xs'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    {t('inspector.contextStream')}
                  </button>
                  <button
                    type="button"
                    data-testid="toggle-pdf-page-preview"
                    onClick={() => setDocViewMode('pdf')}
                    className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-mono font-semibold transition-all ${
                      docViewMode === 'pdf'
                        ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-2xs'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    <Eye className="h-3 w-3 text-indigo-500" />
                    <span>{t('inspector.pdfPagePreview')}</span>
                  </button>
                </div>
              </div>
            </div>

            {docViewMode === 'pdf' ? (
              <div className="space-y-3" data-testid="pdf-page-preview-pane">
                {/* Page Switcher & Active Highlight Banner */}
                <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-800">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={previewPage <= 1}
                      onClick={() => setPreviewPage((p) => Math.max(1, p - 1))}
                      className="p-1 rounded-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 disabled:opacity-40 hover:border-indigo-400 transition-colors"
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
                          Math.min(Math.max(1, report.num_pages || 1), p + 1)
                        )
                      }
                      className="p-1 rounded-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 disabled:opacity-40 hover:border-indigo-400 transition-colors"
                      aria-label={t('inspector.nextPageAria')}
                    >
                      <ChevronRight className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  {previewHighlight ? (
                    <div className="flex items-center gap-1.5 text-[11px] font-mono text-indigo-700 dark:text-indigo-300 bg-indigo-50/90 dark:bg-indigo-950/70 px-2.5 py-1 rounded-lg border border-indigo-200/80 dark:border-indigo-800 max-w-xs truncate">
                      <Sparkles className="h-3 w-3 shrink-0 text-amber-500" />
                      <span className="truncate">
                        {t('inspector.highlightPrefix', { text: previewHighlight })}
                      </span>
                    </div>
                  ) : (
                    <span className="text-[11px] font-mono text-slate-400">
                      {t('inspector.clickCitationToHighlight')}
                    </span>
                  )}
                </div>

                {/* Rendered Page Image */}
                <div className="relative rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-100/70 dark:bg-slate-950 min-h-[480px] max-h-[560px] overflow-y-auto flex items-start justify-center p-3">
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
                      className="w-full h-auto rounded-lg shadow-md border border-slate-200/90 dark:border-slate-800 bg-white"
                    />
                  ) : (
                    <div className="py-20 text-center text-xs font-mono text-slate-500">
                      {t('inspector.unableToRenderPreview')}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="prose prose-slate dark:prose-invert max-w-none">
                <div className="space-y-4 text-sm leading-relaxed max-h-[540px] overflow-y-auto pr-2">
                  {filteredCitations.length === 0 ? (
                    <p className="text-slate-500 dark:text-slate-400 italic py-8 text-center font-mono text-xs">
                      {t('inspector.noCitationsMatchFilter')}
                    </p>
                  ) : (
                    filteredCitations.map((citation, idx) => {
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
                              title={t('inspector.inspectBboxTooltip')}
                              className={`text-[11px] font-mono hover:underline shrink-0 pt-0.5 select-none font-bold ${
                                isFlaggedRed
                                  ? 'text-red-600 dark:text-red-400'
                                  : 'text-indigo-600 dark:text-indigo-400'
                              }`}
                            >
                              p{citation.page}:{String(citation.refNum || idx + 1).padStart(2, '0')}
                            </button>
                            <p className="flex-1 min-w-0 text-slate-700 dark:text-slate-300 font-serif leading-relaxed break-words [overflow-wrap:anywhere]">
                              {citation.context ? (
                                <>
                                  <ContextWithHighlight
                                    context={citation.context}
                                    marker={citation.raw}
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
          </div>

          {/* Citation list panel */}
          <div className="lg:col-span-5 min-w-0 p-4 sm:p-6 bg-slate-50/30 dark:bg-slate-900/40">
            <div className="flex items-center justify-between mb-4 pb-3 border-b border-slate-100 dark:border-slate-800/80">
              <div className="flex items-center gap-2">
                <Quote className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                <h3 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
                  {t('inspector.citationList')}
                </h3>
              </div>
              <span className="text-xs font-mono text-slate-500 dark:text-slate-400">
                {t('inspector.citationsCount', { count: filteredCitations.length })}
              </span>
            </div>

            <div className="space-y-2.5 max-h-[540px] overflow-y-auto pr-1">
              {filteredCitations.map((citation, index) => {
                const status = getInlineStatusBadge(citation.label, t);
                const isFlaggedRed =
                  citation.label === 'suspected_hallucination' ||
                  citation.label === 'metadata_error';
                const isSelected =
                  selectedCitation?.id === citation.id ||
                  (docViewMode === 'pdf' && previewHighlight === citation.raw);
                return (
                  <button
                    key={citation.id}
                    data-testid={`page-citation-item-${index}`}
                    data-verdict-label={citation.label}
                    onClick={() => {
                      setPreviewPage(citation.page || 1);
                      setPreviewHighlight(citation.raw || '');
                      if (docViewMode !== 'pdf') {
                        setSelectedCitation(citation);
                      }
                    }}
                    className={`w-full text-left p-3.5 rounded-xl border transition-all ${
                      isSelected
                        ? 'bg-indigo-50/90 dark:bg-indigo-950/60 border-indigo-300 dark:border-indigo-700 shadow-2xs'
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
                        [{String(citation.refNum || index + 1).padStart(2, '0')}]
                      </span>
                      <div className="flex-1 min-w-0">
                        <p
                          className={`text-sm font-serif line-clamp-2 break-words [overflow-wrap:anywhere] ${
                            isFlaggedRed
                              ? 'text-red-600 dark:text-red-400 font-medium'
                              : 'text-slate-800 dark:text-slate-200'
                          }`}
                        >
                          {citation.raw.replace(/^\[\d+\]\s*/, '')}
                        </p>
                        <div className="flex items-center gap-2 mt-2 flex-wrap">
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-mono font-medium ${status.bg}`}
                          >
                            {status.icon}
                            {status.label}
                          </span>
                          <MappingStatusBadge
                            status={citation.mapping_status as any}
                            size="sm"
                          />
                          {citation.alignmentScore !== undefined &&
                            citation.alignmentScore > 0 && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-mono font-semibold bg-indigo-50 dark:bg-indigo-950/70 text-indigo-700 dark:text-indigo-300 border border-indigo-200/80 dark:border-indigo-800">
                                <Brain className="h-2.5 w-2.5" />
                                {Math.round(citation.alignmentScore * 100)}%
                                {citation.citationIntent
                                  ? ` · ${citation.citationIntent}`
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
          essayId={id ?? ''}
          citation={selectedCitation}
          verdict={selectedVerdict}
          onClose={() => {
            setSelectedCitation(null);
            setSelectedVerdict(null);
          }}
        />
      )}
    </div>
  );
}
