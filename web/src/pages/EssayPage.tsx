import { useState, useMemo, useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useParams, Link, useLocation, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  api,
  type AnalysisReport,
  type Verdict,
  type Citation,
  type ValidationLabel,
  type RevisionDiffData,
} from '@/api/client';
import { EssayHeader } from './essay/EssayHeader';
import { type ReportWorkspaceMode } from './essay/EssayActionBar';
import { DocumentInspectorWorkspace } from './DocumentInspectorPage';
import { OrphanConsistencyWorkspace } from './OrphanDetectionPage';
import { OverrideControls } from '@/components/OverrideControls';
import { CitationGraphView, EvidenceGraph } from '@/components/CitationGraph';
import { UpgradeModal } from '@/components/UpgradeModal';
import { BibliographyRemediationModal } from '@/components/BibliographyRemediationModal';
import {
  NeuralAlignmentPanel,
  VerificationTraceTimeline,
  hasNeuralAlignmentData,
} from '@/components/VerificationTracePanels';
import { RULE_DEFINITIONS } from '@/components/RuleInspector';
import { DecisionSupportBanner } from '@/components/DecisionSupportBanner';
import { useEssayReport, useOverrideVerdict } from '@/hooks/useEssayReport';
import { useToast } from '@/contexts/ToastContext';
import { copyTextToClipboard } from '@/lib/clipboard';
import { isDocxFilename } from '@/lib/fileKind';
import { toSafeDoiHref, toSafeExternalHref } from '@/lib/utils';
import {
  extractObservedWebMeta,
  getCitationMarkerLabel,
  getSourceDisplayName,
  isLegalStatuteVerdict,
  isUrlResource,
} from '@/lib/verdictExplanation';
import {
  normalizeVerdictKey,
  getVerdictDisplay,
  getMappingStatusDisplay,
  getCisBand,
  formatCisScore,
  formatCitationStyleLabel,
  formatAcademicAuthorShort,
  isInstitutionalAuthor,
  looksLikeTitleSentence,
  normalizeAcademicAuthorDisplay,
  resolveDisplayAuthors,
  splitRawAuthorString,
  sanitizeReasoningForDisplay,
  formatUserError,
  getScannedPdfNotice,
} from '@/lib/academicTaxonomy';
import { SYMBOLIC_RULES_COUNT } from '@/lib/productFacts';
import { useRole } from '@/hooks/useRole';
import {
  Loader2,
  AlertCircle,
  Info,
  Check,
  AlertTriangle,
  XCircle,
  Shield,
  ArrowUpRight,
  Search,
  ExternalLink,
  GitBranch,
  Sparkles,
  FileText,
  Copy,
  Microscope,
  Lock,
  ListChecks,
  X,
  ArrowLeft,
  ArrowUpDown,
} from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  AccordionExpand,
  SymmetricChevron,
  SoftTextSwap,
  SubtleNumber,
  ScoreRing,
  DirectionalStageSlide,
  useSlidingPill,
} from '@/components/ui/transitions';

/* ============================================================
   Shared Single-Definition Bucket Counters & Persistent Report Nav (BUG-02, BUG-19, BUG-21)
   ============================================================ */

export type ReportNavLayer =
  | 'debugger'
  | 'issues'
  | 'document'
  | 'consistency'
  | 'graph'
  | 'trace';

export function getEffectiveVerdictKey(v: Verdict): ValidationLabel {
  if (isUrlResource(v)) return 'resource';
  return normalizeVerdictKey(v.label) as ValidationLabel;
}

export function isActionableIssueVerdict(v: Verdict): boolean {
  const key = getEffectiveVerdictKey(v);
  const rules = v.triggered_rules ?? [];
  const urlSt = v.url_status ?? v.features?.url_status ?? null;
  const hasUrlError =
    urlSt === 'dead_link' ||
    urlSt === 'fake_domain' ||
    rules.includes('R-URL-CONTENT-MISMATCH') ||
    rules.includes('R-DEAD-URL') ||
    rules.includes('R-BROKEN-LINK') ||
    rules.includes('R-FAKE-URL');
  const hasMappingIssue =
    Boolean(v.mapping_status) && v.mapping_status !== 'matched';

  if (key === 'resource') {
    return hasUrlError || hasMappingIssue;
  }
  if (key === 'verified') {
    return hasUrlError || hasMappingIssue;
  }
  // suspected_hallucination, metadata_error, unresolved
  return true;
}

export function computeReportBucketCounts(verdicts: Verdict[]) {
  let verified = 0;
  let metadata_error = 0;
  let suspected_hallucination = 0;
  let unresolved = 0;
  let resource = 0;
  let actionableIssues = 0;

  for (const v of verdicts) {
    const key = getEffectiveVerdictKey(v);
    if (key === 'verified') verified += 1;
    else if (key === 'metadata_error') metadata_error += 1;
    else if (key === 'suspected_hallucination') suspected_hallucination += 1;
    else if (key === 'resource') resource += 1;
    else unresolved += 1;

    if (isActionableIssueVerdict(v)) {
      actionableIssues += 1;
    }
  }

  return {
    all: verdicts.length,
    verified,
    metadata_error,
    suspected_hallucination,
    unresolved,
    resource,
    attentionCount: metadata_error + suspected_hallucination + unresolved,
    actionableIssues,
  };
}

export function isReportUnscannable(report: AnalysisReport): boolean {
  const diag = report.document_diagnostics;
  return Boolean(
    report.cis?.is_unscannable ||
      (diag?.is_scanned_pdf && report.verdicts.length === 0) ||
      (!report.filename.toLowerCase().endsWith('.docx') &&
        report.num_pages > 0 &&
        report.verdicts.length === 0 &&
        (report.extracted_citations?.length ?? 0) === 0),
  );
}

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

function useIsBelowLg(): boolean {
  const [below, setBelow] = useState<boolean>(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return false;
    }
    return window.matchMedia('(max-width: 1023px)').matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }
    const mql = window.matchMedia('(max-width: 1023px)');
    const onChange = (ev: MediaQueryListEvent) => setBelow(ev.matches);
    setBelow(mql.matches);
    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    }
    return undefined;
  }, []);

  return below;
}

export interface ReportSummaryAndNavBarProps {
  essayId: string;
  report: AnalysisReport;
  activeLayer: ReportNavLayer;
  onChangeWorkspaceMode?: (mode: ReportWorkspaceMode) => void;
  onOpenLockedFeature?: (featureName: string) => void;
  quietRevisionSlot?: ReactNode;
}

export function ReportSummaryAndNavBar({
  essayId,
  report,
  activeLayer,
  onChangeWorkspaceMode,
  onOpenLockedFeature,
  quietRevisionSlot,
}: ReportSummaryAndNavBarProps) {
  const { i18n } = useTranslation();
  const { has } = useRole();
  const lang: 'vi' | 'en' = i18n.language?.startsWith('vi') ? 'vi' : 'en';

  const canDocument = has('view_document_inspector');
  const canConsistency = has('view_orphan_detection');
  const canTrace = has('view_logic_trace');

  const counts = useMemo(
    () => computeReportBucketCounts(report.verdicts ?? []),
    [report.verdicts],
  );
  const unscannable = isReportUnscannable(report);
  const cisScore = report.cis?.score ?? 0;

  const hasCriticalIssue = useMemo(() => {
    if (counts.suspected_hallucination > 0) return true;
    return (report.verdicts ?? []).some((v) => {
      const urlSt = v.url_status ?? v.features?.url_status;
      const rules = v.triggered_rules ?? [];
      return (
        urlSt === 'dead_link' ||
        urlSt === 'fake_domain' ||
        rules.includes('R-DEAD-URL') ||
        rules.includes('R-BROKEN-LINK') ||
        rules.includes('R-FAKE-URL')
      );
    });
  }, [counts.suspected_hallucination, report.verdicts]);

  const linkingIssueCount = useMemo(() => {
    const ls = report.linking_summary;
    if (ls) {
      return (
        (ls.missing_reference ?? 0) +
        (ls.uncited_reference ?? 0) +
        (ls.in_text_mismatch ?? 0) +
        (ls.ambiguous_mapping ?? 0) +
        (ls.duplicate_reference ?? 0) +
        (ls.style_inconsistent ?? 0)
      );
    }
    return (report.verdicts ?? []).filter(
      (v) => Boolean(v.mapping_status) && v.mapping_status !== 'matched',
    ).length;
  }, [report.linking_summary, report.verdicts]);

  const consistencyAllMatched = linkingIssueCount === 0;
  const effectiveLayer: ReportWorkspaceMode =
    activeLayer === 'issues' || activeLayer === 'trace' ? 'debugger' : activeLayer;

  const cisBand = getCisBand(cisScore, lang);
  const cisHealthPill = unscannable
    ? {
        text: lang === 'vi' ? 'N/A · Không thể quét' : 'N/A · Not Scannable',
        className:
          'bg-slate-100 text-slate-700 border-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700',
      }
    : {
        text: cisBand.label,
        className: cisBand.badgeClass,
      };

  const cisRingColor = unscannable
    ? '#94a3b8'
    : cisBand.key === 'excellent'
      ? '#10b981'
      : cisBand.key === 'good'
        ? '#6366f1'
        : cisBand.key === 'review'
          ? '#f59e0b'
          : '#ef4444';

  const { containerRef: tabListRef, pillStyle } = useSlidingPill<HTMLDivElement>(
    `${effectiveLayer}-${lang}-${canDocument}-${canConsistency}-${canTrace}`,
  );

  const tabBase =
    't-tab relative z-10 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs sm:text-[13px] font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0';
  const activeTabCls = pillStyle.ready
    ? 'text-slate-950 dark:text-white'
    : 'bg-white dark:bg-slate-900 text-slate-950 dark:text-white shadow-sm';
  const inactiveTabCls =
    'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200';

  const handleLockedClick = (featureVi: string, featureEn: string) => {
    if (onOpenLockedFeature) {
      onOpenLockedFeature(lang === 'vi' ? featureVi : featureEn);
    }
  };

  return (
    <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 px-4 py-3 sm:px-5 shadow-sm flex flex-wrap items-center justify-between gap-3.5">
      <div
        data-testid="report-health-summary"
        className="flex flex-wrap items-center gap-3.5 min-w-0"
      >
        <ScoreRing
          data-testid="cis-score-ring"
          value={unscannable ? 0 : cisScore}
          size={40}
          thickness={4.2}
          color={cisRingColor}
        />
        <div className="flex flex-col justify-center">
          <div className="flex items-center gap-2 flex-wrap leading-none">
            <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
              {lang === 'vi' ? 'Điểm trích dẫn' : 'Citation Score'}
            </span>
            <span
              data-testid="report-cis-score-value"
              className="text-lg sm:text-[19px] font-extrabold tracking-tight tabular-nums text-slate-900 dark:text-white leading-none"
            >
              {unscannable ? (
                'N/A'
              ) : (
                <SubtleNumber value={formatCisScore(cisScore)} />
              )}
            </span>
            <span
              data-testid="cis-qualitative-pill"
              className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border ${cisHealthPill.className}`}
            >
              {cisHealthPill.text}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400 mt-1 leading-tight">
            <span>
              <strong className="text-slate-900 dark:text-slate-200">
                {counts.verified}
              </strong>{' '}
              {lang === 'vi' ? 'đã xác minh' : 'verified'}
            </span>
            {counts.attentionCount > 0 && (
              <>
                <span>•</span>
                <span className="font-semibold text-amber-700 dark:text-amber-400">
                  {counts.attentionCount}{' '}
                  {lang === 'vi'
                    ? 'cần kiểm tra'
                    : counts.attentionCount === 1
                      ? 'needs review'
                      : 'need review'}
                </span>
              </>
            )}
            {counts.resource > 0 && (
              <>
                <span>•</span>
                <span className="text-violet-700 dark:text-violet-300 font-medium">
                  {counts.resource}{' '}
                  {lang === 'vi' ? 'nguồn web / văn bản' : 'web / legal'}
                </span>
              </>
            )}
          </div>
        </div>

        {quietRevisionSlot}
      </div>

      {/* Unified 4-Tab Horizontally Scrollable Task Navigation Bar */}
      <div
        ref={tabListRef}
        data-testid="report-view-tablist"
        role="tablist"
        aria-label={lang === 'vi' ? 'Chế độ xem báo cáo' : 'Report views'}
        className="t-tabs relative flex items-center gap-1 p-1 rounded-xl bg-slate-100/90 dark:bg-slate-800/80 border border-slate-200/80 dark:border-slate-700/80 overflow-x-auto max-w-full flex-nowrap"
      >
        <span
          aria-hidden="true"
          data-testid="report-tabs-sliding-pill"
          style={{
            width: `${pillStyle.width}px`,
            height: `${pillStyle.height}px`,
            transform: `translate3d(${pillStyle.left}px, ${pillStyle.top}px, 0)`,
            opacity: pillStyle.ready ? 1 : 0,
            transition: pillStyle.animate ? undefined : 'none',
          }}
          className="t-tabs-pill rounded-lg bg-white dark:bg-slate-900 shadow-sm ring-1 ring-slate-200/80 dark:ring-slate-700/80"
        />

        {/* Tab 1: Citations (includes unified Issues filter & Verification Details drawer) */}
        {onChangeWorkspaceMode ? (
          <button
            type="button"
            role="tab"
            aria-selected={effectiveLayer === 'debugger'}
            data-pill-active={effectiveLayer === 'debugger' ? 'true' : 'false'}
            data-testid="mode-citations-btn"
            onClick={() => onChangeWorkspaceMode('debugger')}
            className={`${tabBase} ${
              effectiveLayer === 'debugger' ? activeTabCls : inactiveTabCls
            }`}
          >
            <FileText className="h-3.5 w-3.5 shrink-0" />
            <span>{lang === 'vi' ? 'Trích dẫn' : 'Citations'}</span>
            {counts.actionableIssues > 0 && (
              <span
                data-testid="citations-issue-badge"
                data-severity={hasCriticalIssue ? 'critical' : 'warning'}
                className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                  hasCriticalIssue
                    ? 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300'
                    : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                }`}
              >
                {counts.actionableIssues}
              </span>
            )}
          </button>
        ) : (
          <Link
            to={`/verification/report/${essayId}`}
            role="tab"
            aria-selected={effectiveLayer === 'debugger'}
            data-pill-active={effectiveLayer === 'debugger' ? 'true' : 'false'}
            data-testid="mode-citations-btn"
            className={`${tabBase} ${
              effectiveLayer === 'debugger' ? activeTabCls : inactiveTabCls
            }`}
          >
            <FileText className="h-3.5 w-3.5 shrink-0" />
            <span>{lang === 'vi' ? 'Trích dẫn' : 'Citations'}</span>
            {counts.actionableIssues > 0 && (
              <span
                data-testid="citations-issue-badge"
                data-severity={hasCriticalIssue ? 'critical' : 'warning'}
                className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                  hasCriticalIssue
                    ? 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300'
                    : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                }`}
              >
                {counts.actionableIssues}
              </span>
            )}
          </Link>
        )}

        {/* Tab 2: In Document */}
        {canDocument ? (
          onChangeWorkspaceMode ? (
            <button
              type="button"
              role="tab"
              aria-selected={effectiveLayer === 'document'}
              data-pill-active={effectiveLayer === 'document' ? 'true' : 'false'}
              data-testid="mode-document-btn"
              onClick={() => onChangeWorkspaceMode('document')}
              className={`${tabBase} ${
                effectiveLayer === 'document' ? activeTabCls : inactiveTabCls
              }`}
            >
              <Microscope className="h-3.5 w-3.5 shrink-0" />
              <span>{lang === 'vi' ? 'Trong bài' : 'In Document'}</span>
            </button>
          ) : (
            <Link
              to={`/verification/report/${essayId}?view=document`}
              role="tab"
              aria-selected={effectiveLayer === 'document'}
              data-pill-active={effectiveLayer === 'document' ? 'true' : 'false'}
              data-testid="mode-document-btn"
              className={`${tabBase} ${
                effectiveLayer === 'document' ? activeTabCls : inactiveTabCls
              }`}
            >
              <Microscope className="h-3.5 w-3.5 shrink-0" />
              <span>{lang === 'vi' ? 'Trong bài' : 'In Document'}</span>
            </Link>
          )
        ) : (
          <button
            type="button"
            role="tab"
            aria-selected={false}
            data-testid="locked-document-inspector-btn"
            onClick={() =>
              handleLockedClick(
                'Xem trong bài viết (Gói Pro)',
                'In-Document Inspector (Pro)',
              )
            }
            className={`${tabBase} text-slate-400 dark:text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-400`}
          >
            <Lock className="h-3 w-3 shrink-0" />
            <span>{lang === 'vi' ? 'Trong bài' : 'In Document'}</span>
          </button>
        )}

        {/* Tab 3: Citation Link Check */}
        {canConsistency ? (
          onChangeWorkspaceMode ? (
            <button
              type="button"
              role="tab"
              aria-selected={effectiveLayer === 'consistency'}
              data-pill-active={effectiveLayer === 'consistency' ? 'true' : 'false'}
              data-testid="mode-consistency-btn"
              onClick={() => onChangeWorkspaceMode('consistency')}
              className={`${tabBase} ${
                effectiveLayer === 'consistency' ? activeTabCls : inactiveTabCls
              }`}
            >
              <ListChecks className="h-3.5 w-3.5 shrink-0" />
              <span>{lang === 'vi' ? 'Khớp trích dẫn' : 'Link Check'}</span>
              {consistencyAllMatched ? (
                <span
                  data-testid="consistency-matched-dot"
                  className="h-2 w-2 rounded-full bg-emerald-500 shrink-0"
                />
              ) : (
                <span
                  data-testid="consistency-issue-badge"
                  className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
                >
                  {linkingIssueCount}
                </span>
              )}
            </button>
          ) : (
            <Link
              to={`/verification/report/${essayId}?view=consistency`}
              role="tab"
              aria-selected={effectiveLayer === 'consistency'}
              data-pill-active={effectiveLayer === 'consistency' ? 'true' : 'false'}
              data-testid="mode-consistency-btn"
              className={`${tabBase} ${
                effectiveLayer === 'consistency' ? activeTabCls : inactiveTabCls
              }`}
            >
              <ListChecks className="h-3.5 w-3.5 shrink-0" />
              <span>{lang === 'vi' ? 'Khớp trích dẫn' : 'Link Check'}</span>
              {consistencyAllMatched ? (
                <span
                  data-testid="consistency-matched-dot"
                  className="h-2 w-2 rounded-full bg-emerald-500 shrink-0"
                />
              ) : (
                <span
                  data-testid="consistency-issue-badge"
                  className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
                >
                  {linkingIssueCount}
                </span>
              )}
            </Link>
          )
        ) : (
          <button
            type="button"
            role="tab"
            aria-selected={false}
            data-testid="locked-consistency-btn"
            onClick={() =>
              handleLockedClick(
                'Kiểm tra khớp trích dẫn (Gói Pro)',
                'Citation Link Check (Pro)',
              )
            }
            className={`${tabBase} text-slate-400 dark:text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-400`}
          >
            <Lock className="h-3 w-3 shrink-0" />
            <span>{lang === 'vi' ? 'Khớp trích dẫn' : 'Link Check'}</span>
          </button>
        )}

        {/* Tab 4: Network Flow (Sơ đồ) */}
        {canTrace ? (
          onChangeWorkspaceMode ? (
            <button
              type="button"
              role="tab"
              aria-selected={effectiveLayer === 'graph'}
              data-pill-active={effectiveLayer === 'graph' ? 'true' : 'false'}
              data-testid="mode-graph-btn"
              onClick={() => onChangeWorkspaceMode('graph')}
              className={`${tabBase} ${
                effectiveLayer === 'graph' ? activeTabCls : inactiveTabCls
              }`}
            >
              <GitBranch className="h-3.5 w-3.5 shrink-0" />
              <span>{lang === 'vi' ? 'Sơ đồ' : 'Network'}</span>
            </button>
          ) : (
            <Link
              to={`/verification/report/${essayId}?view=graph`}
              role="tab"
              aria-selected={effectiveLayer === 'graph'}
              data-pill-active={effectiveLayer === 'graph' ? 'true' : 'false'}
              data-testid="mode-graph-btn"
              className={`${tabBase} ${
                effectiveLayer === 'graph' ? activeTabCls : inactiveTabCls
              }`}
            >
              <GitBranch className="h-3.5 w-3.5 shrink-0" />
              <span>{lang === 'vi' ? 'Sơ đồ' : 'Network'}</span>
            </Link>
          )
        ) : (
          <button
            type="button"
            role="tab"
            aria-selected={false}
            data-testid="locked-graph-btn"
            onClick={() =>
              handleLockedClick(
                'Sơ đồ liên kết trích dẫn (Gói Pro)',
                'Citation Network Map (Pro)',
              )
            }
            className={`${tabBase} text-slate-400 dark:text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-400`}
          >
            <Lock className="h-3 w-3 shrink-0" />
            <span>{lang === 'vi' ? 'Sơ đồ' : 'Network'}</span>
          </button>
        )}
      </div>
    </div>
  );
}

/* ============================================================
   Helper Types & Functions for the Real Citation Debugger IDE
   ============================================================ */

type FieldStatus = 'match' | 'partial' | 'mismatch' | 'missing';

interface MetadataFields {
  title: string;
  authors: string;
  year: string;
  venue: string;
  doi: string;
  url: string;
}

interface SymbolicRuleDisplay {
  code: string;
  name: string;
  explanation: string;
  status: 'passed' | 'warning' | 'failed';
}

interface SourceRetrievalItem {
  name: string;
  status: 'matched' | 'partial' | 'candidate_insufficient' | 'not_found';
  score: string;
  matchedFields: string[];
  url?: string;
  doi?: string;
  notRouted?: boolean;
}

type CrossLingualFeaturesExt = NonNullable<Verdict['features']> & {
  cross_lingual_bridged_concepts?: string[];
  cross_lingual_alignment?: boolean | number;
  semantic_similarity?: number;
  cross_lingual_direction?: string;
};

function formatRevisionVerdictLabel(
  rawLabel: string | null | undefined,
  lang: 'vi' | 'en',
): string {
  const norm = (rawLabel || '').trim().toLowerCase();
  switch (norm) {
    case 'verified':
    case 'likely_verified':
      return getVerdictDisplay('verified', lang).label;
    case 'metadata_error':
      return getVerdictDisplay('metadata_error', lang).label;
    case 'suspected_hallucination':
      return getVerdictDisplay('suspected_hallucination', lang).label;
    case 'unresolved':
      return getVerdictDisplay('unresolved', lang).label;
    case 'resource':
    case 'url_resource':
    case 'web_resource':
    case 'legal_resource':
      return getVerdictDisplay('resource', lang).label;
    case 'removed':
    case 'deleted':
      return lang === 'vi' ? 'Đã gỡ bỏ' : 'Removed';
    case 'added':
    case 'new':
      return lang === 'vi' ? 'Mới thêm' : 'Added';
    case '':
    case 'none':
      return '—';
    default:
      return norm
        .split('_')
        .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : ''))
        .join(' ');
  }
}

interface LinkBadgeInfo {
  text: string;
  badgeClass: string;
  title: string;
  status: 'alive' | 'restricted_alive' | 'archived_alive' | 'dead_link' | 'fake_domain';
}

interface EnrichedCitationItem {
  verdict: Verdict;
  index: number;
  marker: string;
  inText: string;
  pageLabel: string;
  verdictText: string;
  verdictBadgeClass: string;
  mappingText: string;
  mappingBadgeClass: string;
  linkBadge: LinkBadgeInfo | null;
  confidencePct: number;
  citedMeta: MetadataFields;
  retrievedMeta: MetadataFields | null;
  fieldStatus: Record<keyof MetadataFields, { status: FieldStatus; label?: string }>;
  contextBefore: string;
  contextHighlight: string;
  contextAfter: string;
  explanationText: string;
  rules: SymbolicRuleDisplay[];
  sources: SourceRetrievalItem[];
}

const RULE_CATALOG: Record<
  string,
  {
    nameVi: string;
    nameEn: string;
    explanationVi: string;
    explanationEn: string;
    status: 'passed' | 'warning' | 'failed';
  }
> = {
  'R-DOI-TITLE-AUTHOR': {
    nameVi: 'Khớp mã DOI, tiêu đề và tác giả',
    nameEn: 'DOI, Title, and Authors Match',
    explanationVi: 'Mã DOI khớp chính xác với bản gốc, đồng thời tiêu đề và danh sách tác giả đều trùng khớp.',
    explanationEn: 'The cited DOI matches the published record, and both the title and authors align closely.',
    status: 'passed',
  },
  'R-WELL-LINKED': {
    nameVi: 'Khớp chặt chẽ tiêu đề, tác giả và năm xuất bản',
    nameEn: 'Strong Match Across Citation Details',
    explanationVi: 'Trích dẫn khớp chặt chẽ với tài liệu gốc về tiêu đề, tác giả và năm xuất bản.',
    explanationEn: 'The citation matches a published record closely across title, authors, and publication year.',
    status: 'passed',
  },
  'R-WELL-LINKED-MODERATE': {
    nameVi: 'Khớp tốt tiêu đề và tác giả',
    nameEn: 'Good Title & Author Match',
    explanationVi: 'Trích dẫn khớp với tài liệu gốc về tác giả, năm và tiêu đề ở mức tốt.',
    explanationEn: 'The citation matches a published work by author and year with close title wording.',
    status: 'passed',
  },
  'R-LOCAL_DB_VERIFIED': {
    nameVi: 'Khớp chính xác trong Thư viện học thuật CITRA',
    nameEn: 'Verified in CITRA Scholarly Library',
    explanationVi: 'Tiêu đề, tác giả và năm xuất bản khớp chính xác với bản ghi trong Thư viện học thuật CITRA.',
    explanationEn: 'Title, authors, and publication year match a verified record in the CITRA Scholarly Library.',
    status: 'passed',
  },
  'R-LOCAL_DB_GOOD_MATCH': {
    nameVi: 'Khớp độ chính xác cao trong Thư viện học thuật CITRA',
    nameEn: 'Strong Match in CITRA Scholarly Library',
    explanationVi: 'Xác nhận tiêu đề và tác giả khớp ở mức cao trong Thư viện học thuật CITRA.',
    explanationEn: 'High title and author agreement confirmed in the CITRA Scholarly Library.',
    status: 'passed',
  },
  'R-LOCAL_DB': {
    nameVi: 'Tìm thấy trong Thư viện học thuật CITRA',
    nameEn: 'Matched in CITRA Scholarly Library',
    explanationVi: 'Đã tìm thấy bản ghi công trình trong Thư viện học thuật CITRA.',
    explanationEn: 'Publication record retrieved from the CITRA Scholarly Library.',
    status: 'passed',
  },
  'R-LOCAL_DB_ONLY': {
    nameVi: 'Xác nhận qua Thư viện học thuật CITRA',
    nameEn: 'Verified via CITRA Scholarly Library',
    explanationVi: 'Đã xác nhận trực tiếp trên Thư viện học thuật CITRA khi các thư viện trực tuyến bên ngoài tạm bận.',
    explanationEn: 'Verified in the CITRA Scholarly Library while external online libraries were temporarily unavailable.',
    status: 'passed',
  },
  'R-KNOWN-PAPER': {
    nameEn: 'Widely Cited Published Work Verified',
    nameVi: 'Khớp công trình học thuật chuẩn',
    explanationVi: 'Khớp với công trình nghiên cứu đã được lưu chuẩn trong Thư viện học thuật CITRA.',
    explanationEn: 'Matches a widely cited published work in the CITRA Scholarly Library.',
    status: 'passed',
  },
  'R-KNOWN-PAPER-NO-TITLE': {
    nameEn: 'Matched Published Work by Author & Year',
    nameVi: 'Khớp công trình học thuật theo tác giả và năm',
    explanationVi: 'Trích dẫn trong bài khớp với công trình trong Thư viện học thuật CITRA theo tên tác giả và năm xuất bản.',
    explanationEn: 'In-text citation matches a published work in the CITRA Scholarly Library by author and year.',
    status: 'passed',
  },
  'R-SINGLE-SOURCE-VERIFIED': {
    nameEn: 'High-Confidence Library Match',
    nameVi: 'Khớp độ chính xác cao từ thư viện học thuật',
    explanationVi: 'Đã xác nhận trên thư viện học thuật trực tuyến với tiêu đề, tác giả và năm xuất bản khớp ở mức cao.',
    explanationEn: 'Verified in an online academic library with strong agreement on title, authors, and publication year.',
    status: 'passed',
  },
  'R-SINGLE-SOURCE-PARTIAL': {
    nameEn: 'Library Match with Details Discrepancy',
    nameVi: 'Tìm thấy trong thư viện nhưng thông tin chưa khớp',
    explanationVi: 'Tìm thấy hồ sơ công trình trên thư viện học thuật nhưng năm xuất bản, tác giả hoặc tiêu đề chưa khớp hoàn toàn.',
    explanationEn: 'Found the published record in an academic library, but the author, year, or title differs slightly.',
    status: 'warning',
  },
  'R-VN-LEGAL-FORMAT': {
    nameEn: 'Legal / Statutory Document Format',
    nameVi: 'Định dạng văn bản quy phạm pháp luật',
    explanationVi: 'Khớp định dạng trích dẫn văn bản quy phạm pháp luật chính thức.',
    explanationEn: 'Matches official statutory or government legal document citation format.',
    status: 'passed',
  },
  'R-LEGAL-DOCUMENT': {
    nameEn: 'Vietnamese Statutory Legal Document',
    nameVi: 'Văn bản quy phạm pháp luật Việt Nam',
    explanationVi: 'Nhận diện văn bản quy phạm pháp luật Việt Nam (Luật, Bộ luật, Nghị định, Thông tư, Nghị quyết, Quyết định).',
    explanationEn: 'Recognized Vietnamese statutory instrument (Law, Code, Decree, Circular, Resolution, or Decision).',
    status: 'passed',
  },
  'R-VN-LEGAL-VERIFIED': {
    nameEn: 'Verified in Vietnamese Legal Registry',
    nameVi: 'Xác nhận trên Thư viện văn bản pháp luật Việt Nam',
    explanationVi: 'Đã xác nhận số hiệu, năm ban hành và cơ quan ban hành đối chiếu với Thư viện văn bản pháp luật Việt Nam.',
    explanationEn: 'Verified document number, promulgation year, and issuing authority against the Vietnamese Legal Registry.',
    status: 'passed',
  },
  'R-VN-LEGAL-SUPERSEDED': {
    nameEn: 'Superseded Vietnamese Legal Document',
    nameVi: 'Văn bản pháp luật đã hết hiệu lực hoặc bị thay thế',
    explanationVi: 'Luật hoặc Nghị định được trích dẫn đã hết hiệu lực hoặc được thay thế bởi văn bản pháp luật mới hơn.',
    explanationEn: 'The cited Vietnamese law or decree has been superseded or replaced by a newer legal document.',
    status: 'warning',
  },
  'R-VN-LEGAL-MISMATCH': {
    nameEn: 'Vietnamese Legal Document Details Mismatch',
    nameVi: 'Sai lệch thông tin văn bản pháp luật Việt Nam',
    explanationVi: 'Tìm thấy văn bản pháp luật tương ứng nhưng năm ban hành, số hiệu hoặc cơ quan ban hành chưa khớp.',
    explanationEn: 'Found the matching Vietnamese legal document, but the promulgation year, number, or issuing agency differs.',
    status: 'failed',
  },
  'R-BOOK-EDITION-VERIFIED': {
    nameEn: 'Book or Textbook Edition Verified',
    nameVi: 'Xác nhận ấn bản sách hoặc giáo trình',
    explanationVi: 'Đã xác nhận ấn bản giáo trình hoặc sách chuyên khảo đối chiếu với OpenLibrary và Google Books.',
    explanationEn: 'Verified book or textbook edition against OpenLibrary and Google Books.',
    status: 'passed',
  },
  'R-GLOBAL-DOI-RA-VERIFIED': {
    nameEn: 'Verified via Global DOI Registry',
    nameVi: 'Xác nhận qua Hệ thống đăng ký DOI quốc tế',
    explanationVi: 'Đã xác nhận mã DOI và thông tin công trình qua Hệ thống đăng ký DOI quốc tế.',
    explanationEn: 'Verified through the Global DOI Registry (DataCite, JaLC, mEDRA, KISTI, CNKI) with matching details.',
    status: 'passed',
  },
  'R-HF-VERIFIED': {
    nameEn: 'Verified on Hugging Face',
    nameVi: 'Xác nhận tài nguyên trên Hugging Face',
    explanationVi: 'Đã xác nhận mô hình, bộ dữ liệu hoặc bài nghiên cứu tương ứng trên Hugging Face.',
    explanationEn: 'Verified AI model, dataset, or research paper record on Hugging Face.',
    status: 'passed',
  },
  'R-RFC-VERIFIED': {
    nameEn: 'Verified Technical Standard or Repository',
    nameVi: 'Xác nhận tiêu chuẩn kỹ thuật hoặc mã nguồn',
    explanationVi: 'Đã xác nhận tiêu chuẩn kỹ thuật (IETF RFC), thư viện phần mềm (PyPI / NPM) hoặc kho mã nguồn GitHub.',
    explanationEn: 'Verified technical standard (IETF RFC), software package (PyPI / NPM), or public GitHub repository.',
    status: 'passed',
  },
  'R-GITHUB-VERIFIED': {
    nameEn: 'Verified GitHub Repository',
    nameVi: 'Xác nhận kho mã nguồn GitHub',
    explanationVi: 'Đã xác nhận kho mã nguồn GitHub công khai và thông tin trích dẫn tương ứng.',
    explanationEn: 'Verified public GitHub repository and citation metadata.',
    status: 'passed',
  },
  'R-PACKAGE-VERIFIED': {
    nameEn: 'Verified Software Package (PyPI / NPM)',
    nameVi: 'Xác nhận gói phần mềm (PyPI / NPM)',
    explanationVi: 'Đã xác nhận thông tin phát hành gói phần mềm và tác giả trên PyPI hoặc NPM.',
    explanationEn: 'Verified software package release details and authors on PyPI or NPM.',
    status: 'passed',
  },
  'R-WIKIDATA-VERIFIED': {
    nameEn: 'Verified via Wikidata / OpenCitations',
    nameVi: 'Xác nhận qua Wikidata / OpenCitations',
    explanationVi: 'Đã xác nhận tiêu chuẩn quốc tế (ISO/IEC, NIST, IEEE, OWASP, WCAG), tài liệu hướng dẫn hoặc mã DOI qua Wikidata và OpenCitations.',
    explanationEn: 'Verified international standard, reference manual, or DOI via Wikidata and OpenCitations.',
    status: 'passed',
  },
  'R-WAYBACK-ARCHIVED': {
    nameEn: 'Web Archive Copy Found',
    nameVi: 'Tìm thấy bản lưu trữ web dự phòng',
    explanationVi: 'Trang web gốc hiện không còn mở được, nhưng đã tìm thấy bản lưu trữ hợp lệ trên Internet Archive.',
    explanationEn: 'The original web page is no longer reachable, but a saved historical copy was found on Internet Archive.',
    status: 'warning',
  },
  'R-RETRACTED-PAPER': {
    nameEn: 'Retracted Publication Notice',
    nameVi: 'Cảnh báo: Bài báo đã bị rút bài',
    explanationVi: 'Ấn phẩm này đã chính thức bị rút bài theo ghi nhận từ nhà xuất bản và thư viện học thuật. Bạn nên cân nhắc thay bằng nguồn khác.',
    explanationEn: 'This publication has been officially retracted by its publisher or scholarly registry. Consider replacing it.',
    status: 'failed',
  },
  'R-CONSENSUS-FULL': {
    nameVi: 'Được xác nhận đồng thời trên nhiều thư viện học thuật',
    nameEn: 'Confirmed by Multiple Academic Libraries',
    explanationVi: 'Nhiều thư viện học thuật cùng xác nhận trùng khớp về tiêu đề, tác giả và năm xuất bản.',
    explanationEn: 'Multiple academic libraries agree on the title, authors, and publication year.',
    status: 'passed',
  },
  'R-CONSENSUS-PARTIAL': {
    nameVi: 'Tìm thấy trên thư viện nhưng một vài chi tiết chưa khớp',
    nameEn: 'Matched in Libraries with Some Details Differing',
    explanationVi: 'Các thư viện học thuật đã tìm thấy công trình này nhưng một vài thông tin (như năm hoặc tác giả) chưa khớp.',
    explanationEn: 'Academic libraries found this publication, but some citation details differ from the published record.',
    status: 'warning',
  },
  'R-DOI-TITLE-MISMATCH': {
    nameVi: 'Khớp mã DOI nhưng tiêu đề chưa khớp',
    nameEn: 'DOI Matched, Title Differs',
    explanationVi: 'Mã DOI dẫn đến bài báo có thật, nhưng tiêu đề bạn ghi trong bài khác với bản gốc.',
    explanationEn: 'The DOI points to a real publication, but the title in your citation differs from the published record.',
    status: 'warning',
  },
  'R-KNOWN-AUTHOR-TITLE-MISMATCH': {
    nameVi: 'Tác giả khớp nhưng thông tin bài báo có sai lệch',
    nameEn: 'Author Recognized, Details Differ',
    explanationVi: 'Đã tìm thấy tác giả trong thư viện học thuật nhưng năm xuất bản hoặc tiêu đề có khác biệt so với bản gốc.',
    explanationEn: 'The author was found in academic libraries, but the cited year or title differs from the published record.',
    status: 'warning',
  },
  'R-KNOWN-AUTHOR-WEAK-EVIDENCE': {
    nameVi: 'Tác giả khớp nhưng thông tin công trình chưa đủ rõ',
    nameEn: 'Author Recognized, Source Details Uncertain',
    explanationVi: 'Tìm thấy tên tác giả nhưng thông tin bài báo trong thư viện còn khác nhiều so với trích dẫn của bạn.',
    explanationEn: 'The author was found, but the matching record differs noticeably from your citation details.',
    status: 'warning',
  },
  'R-WEAK-EVIDENCE': {
    nameVi: 'Thông tin đối chiếu chưa đủ khớp',
    nameEn: 'Partial Match Only — Manual Check Suggested',
    explanationVi: 'Tìm thấy vài tài liệu gần giống nhưng độ khớp còn thấp nên chưa thể tự động xác nhận.',
    explanationEn: 'Some similar titles were found, but the details are too different to confirm automatically.',
    status: 'warning',
  },
  'R-CONTENT-ALIGNMENT': {
    nameVi: 'Ngữ cảnh trích dẫn phù hợp với nội dung nguồn',
    nameEn: 'Context Matches Source Summary',
    explanationVi: 'Đoạn văn trích dẫn trong bài phù hợp về nội dung với tóm tắt của tài liệu gốc.',
    explanationEn: 'The sentence where this source is cited aligns well with the summary of the published work.',
    status: 'passed',
  },
  'R-CROSS-LINGUAL-ALIGNMENT': {
    nameVi: 'Khớp nội dung song ngữ Việt ↔ Anh',
    nameEn: 'Cross-Language Meaning Match (VI ↔ EN)',
    explanationVi: 'Đoạn văn tiếng Việt trong bài phù hợp về nội dung với tóm tắt tiếng Anh của bài báo gốc.',
    explanationEn: 'The Vietnamese sentence in your essay aligns in meaning with the English summary of the cited paper.',
    status: 'passed',
  },
  'R-CROSS-LINGUAL-TITLE-MATCH': {
    nameVi: 'Tiêu đề bài báo nước ngoài đang bị dịch sang tiếng Việt',
    nameEn: 'Foreign-Language Title Was Translated',
    explanationVi: 'Tiêu đề dịch tiếng Việt khớp nội dung với bài báo gốc tiếng Anh. Theo thông lệ học thuật, hãy giữ nguyên tiêu đề gốc bằng tiếng nước ngoài (có thể ghi thêm bản dịch trong ngoặc vuông).',
    explanationEn: 'The translated title matches an English published work. Academic citation guidelines recommend keeping the original title (optionally adding a translation in brackets).',
    status: 'warning',
  },
  'R-CONTENT-MISMATCH': {
    nameVi: 'Ngữ cảnh trích dẫn có thể khác chủ đề bài gốc',
    nameEn: 'Context May Differ from Source Topic',
    explanationVi: 'Tiêu đề khớp nhưng đoạn văn trích dẫn trong bài có nội dung khá khác với tóm tắt tài liệu gốc — hãy kiểm tra lại.',
    explanationEn: 'The title matches, but the surrounding sentence in your essay appears unrelated to the source summary. Please confirm this is the intended source.',
    status: 'warning',
  },
  'R-STYLE-INCONSISTENT': {
    nameVi: 'Chưa thống nhất kiểu định dạng trích dẫn',
    nameEn: 'Mixed Citation Formatting Style',
    explanationVi: 'Cách trình bày trích dẫn này khác với chuẩn chung của toàn bài viết.',
    explanationEn: 'This citation uses a different formatting style from the rest of your document.',
    status: 'warning',
  },
  'R-WEB-RESOURCE': {
    nameVi: 'Tài nguyên web hoặc tài liệu kỹ thuật',
    nameEn: 'Web or Technical Documentation',
    explanationVi: 'Nhận diện là trang hướng dẫn trực tuyến, tài liệu kỹ thuật hoặc trang web tham khảo.',
    explanationEn: 'Recognized as an online guide, official web page, or technical specification.',
    status: 'passed',
  },
  'R-URL-RESOURCE': {
    nameVi: 'Trích dẫn đường dẫn web trực tiếp',
    nameEn: 'Direct Web Link Reference',
    explanationVi: 'Nhận diện là đường dẫn trang web hoặc kho mã nguồn trực tiếp.',
    explanationEn: 'Recognized as a direct web page or software repository link.',
    status: 'passed',
  },
  'R-FAKE-URL': {
    nameVi: 'Liên kết web là địa chỉ mẫu hoặc không hợp lệ',
    nameEn: 'Unrecognized or Placeholder Web Link',
    explanationVi: 'Đường dẫn sử dụng tên miền mẫu (như example.com, test.com) hoặc không thuộc nguồn tài liệu thực tế.',
    explanationEn: 'The web address uses a placeholder domain (such as example.com or test.com) rather than a live publication source.',
    status: 'failed',
  },
  'R-FABRICATED-DOI': {
    nameVi: 'Mã DOI chưa được đăng ký',
    nameEn: 'Unregistered DOI Format',
    explanationVi: 'Mã DOI sử dụng tiền tố thử nghiệm hoặc chưa được đăng ký trên các hệ thống DOI chính thức.',
    explanationEn: 'The cited DOI uses an unrecognized or test prefix not found in official DOI registries.',
    status: 'failed',
  },
  'R-FAKE-AUTHOR': {
    nameVi: 'Tên tác giả có dạng mẫu thử hoặc chưa khớp nguồn',
    nameEn: 'Placeholder or Unmatched Author Name',
    explanationVi: 'Tên tác giả có dạng ví dụ minh họa hoặc chưa khớp với tác giả nào trong thư viện học thuật.',
    explanationEn: 'The author name looks like a placeholder or does not match a published author in academic libraries.',
    status: 'failed',
  },
  'R-FUTURE-YEAR': {
    nameVi: 'Năm xuất bản ở tương lai',
    nameEn: 'Future Publication Year',
    explanationVi: 'Năm xuất bản lớn hơn năm hiện tại — vui lòng kiểm tra lại xem có lỗi gõ năm không.',
    explanationEn: 'The listed publication year is in the future — please check for a year typo.',
    status: 'failed',
  },
  'R-FUTURE-YEAR-KNOWN-AUTHOR': {
    nameEn: 'Future Year for Known Author',
    nameVi: 'Năm xuất bản ở tương lai (đã tìm thấy tác giả)',
    explanationVi: 'Năm xuất bản lớn hơn năm hiện tại nhưng tác giả có trong thư viện — có thể là lỗi gõ nhầm năm.',
    explanationEn: 'The publication year is in the future, though the author is recognized — likely a year typo.',
    status: 'warning',
  },
  'R-AMBIGUOUS-MAPPING': {
    nameEn: 'Matches Multiple Reference Entries',
    nameVi: 'Trích dẫn có thể trùng nhiều mục tham khảo',
    explanationVi: 'Không thể xác định chắc chắn trích dẫn trong bài đang nối tới mục nào trong danh mục tài liệu tham khảo.',
    explanationEn: 'This in-text citation could match more than one entry in your reference list.',
    status: 'warning',
  },
  'R-ABSTENTION-BORDER': {
    nameEn: 'Uncertain Match — Manual Check Needed',
    nameVi: 'Độ khớp trung bình — cần bạn tự kiểm tra',
    explanationVi: 'Tìm thấy một tài liệu có nét tương đồng nhưng chưa đủ chắc chắn để tự động xác nhận.',
    explanationEn: 'Found a somewhat similar publication, but not close enough to confirm automatically.',
    status: 'warning',
  },
  'R-DOMAIN-EXCEPTION': {
    nameEn: 'DOI Matched, Title or Link Needs Review',
    nameVi: 'Mã DOI khớp nhưng tiêu đề hoặc liên kết cần xem lại',
    explanationVi: 'Mã DOI khớp với bài báo có thật, nhưng tiêu đề có sai lệch hoặc đường dẫn đính kèm không mở được.',
    explanationEn: 'The DOI resolves to a real publication, though the title differs or the attached link could not be opened.',
    status: 'warning',
  },
  'R-INCOMPLETE-METADATA': {
    nameEn: 'Incomplete Citation Details',
    nameVi: 'Thiếu thông tin trích dẫn',
    explanationVi: 'Mục tài liệu tham khảo còn thiếu thông tin quan trọng (tác giả, năm xuất bản, nơi công bố hoặc mã định danh) — hãy bổ sung cho đầy đủ.',
    explanationEn: 'This reference entry is missing required details such as author, publication year, venue, or identifier — please complete it.',
    status: 'warning',
  },
  'R-URL-CONTENT-MISMATCH': {
    nameEn: 'Web Page Title Does Not Match Citation',
    nameVi: 'Tiêu đề trang web không khớp với trích dẫn',
    explanationVi: 'Đường dẫn vẫn mở được nhưng tiêu đề trang web đích không khớp với tiêu đề bạn ghi trong bài.',
    explanationEn: 'The web link opens, but the page title at that address does not match the title in your citation.',
    status: 'warning',
  },
  'R-BROKEN-LINK': {
    nameEn: 'Attached Link Unreachable on Verified Paper',
    nameVi: 'Đường dẫn đính kèm không mở được (bài báo có thật)',
    explanationVi: 'Công trình học thuật có thật nhưng đường dẫn đính kèm trong trích dẫn hiện không thể truy cập.',
    explanationEn: 'The publication itself exists, but the web link included in your citation currently cannot be opened.',
    status: 'warning',
  },
  'R-DEAD-URL': {
    nameEn: 'Link Unreachable & No Matching Publication',
    nameVi: 'Đường dẫn không mở được và chưa tìm thấy bài gốc',
    explanationVi: 'Đường dẫn trích dẫn hiện không mở được và chưa tìm thấy công trình học thuật nào khớp.',
    explanationEn: 'The cited web link could not be opened and no matching publication was found across academic libraries.',
    status: 'failed',
  },
  'R-NONEXISTENT-DOI': {
    nameEn: 'DOI Not Found in Official Registries',
    nameVi: 'Mã DOI không tìm thấy trên hệ thống đăng ký',
    explanationVi: 'Mã DOI bạn ghi không tìm thấy bản ghi công trình nào trên các hệ thống đăng ký học thuật.',
    explanationEn: 'The cited DOI could not be resolved to any published record across academic registries.',
    status: 'failed',
  },
  'R-NO-SCHOLARLY-RECORD': {
    nameEn: 'No Record Found Across Academic Libraries',
    nameVi: 'Không tìm thấy bản ghi trên các thư viện học thuật',
    explanationVi: 'Đã tra cứu trên nhiều thư viện học thuật trực tuyến nhưng không tìm thấy bản ghi nào khớp.',
    explanationEn: 'Multiple online academic libraries were searched cleanly and returned no matching publication.',
    status: 'failed',
  },
  'R-HALLUCINATED-SOURCE': {
    nameEn: 'No Matching Publication Found',
    nameVi: 'Không tìm thấy tài liệu khớp trong thư viện học thuật',
    explanationVi: 'Chưa tìm thấy tài liệu nào trên các thư viện học thuật khớp với tiêu đề, tác giả hoặc mã DOI trong bài.',
    explanationEn: 'No candidate found across checked academic libraries closely matched the cited title, authors, or DOI.',
    status: 'failed',
  },
  'R-NO-CANDIDATE': {
    nameEn: 'No Matching Record Found',
    nameVi: 'Không tìm thấy tài liệu tương ứng',
    explanationVi: 'Không tìm thấy công trình nào khớp trên các thư viện học thuật đã tra cứu.',
    explanationEn: 'No matching publication was found across checked academic libraries.',
    status: 'failed',
  },
  'R-FAIL-ALL': {
    nameEn: 'Online Libraries Temporarily Unavailable',
    nameVi: 'Các thư viện trực tuyến tạm thời không phản hồi',
    explanationVi: 'Các thư viện học thuật trực tuyến gặp lỗi kết nối trong lúc kiểm tra — vui lòng đối chiếu thủ công hoặc thử lại sau.',
    explanationEn: 'External academic libraries could not be reached during this check — please verify manually or retry shortly.',
    status: 'warning',
  },
  'R-VN-STANDARD-VERIFIED': {
    nameEn: 'Vietnamese National Standard Verified (TCVN / QCVN)',
    nameVi: 'Xác nhận Tiêu chuẩn / Quy chuẩn Quốc gia (TCVN / QCVN)',
    explanationVi: 'Đã xác nhận Tiêu chuẩn hoặc Quy chuẩn Kỹ thuật Quốc gia đối chiếu với danh mục TCVN / QCVN.',
    explanationEn: 'Verified Vietnamese national technical standard or regulation against the TCVN / QCVN catalog.',
    status: 'passed',
  },
  'R-VN-TEXTBOOK-VERIFIED': {
    nameEn: 'Vietnamese University Textbook Verified',
    nameVi: 'Xác nhận Giáo trình Đại học Việt Nam',
    explanationVi: 'Đã xác nhận giáo trình đại học hoặc sách chuyên khảo tiếng Việt đối chiếu với danh mục chuẩn.',
    explanationEn: 'Verified Vietnamese university textbook or monograph against the curated textbook catalog.',
    status: 'passed',
  },
  'R-VN-LEGAL-FABRICATED': {
    nameEn: 'Legal Document Number Not Found',
    nameVi: 'Không tìm thấy số hiệu văn bản pháp luật này',
    explanationVi: 'Số hiệu, năm ban hành hoặc cơ quan ban hành văn bản pháp luật này chưa được tìm thấy trên hệ thống văn bản pháp luật chính thức.',
    explanationEn: 'The cited legal document number, promulgation year, or issuing authority could not be confirmed in the official legal registry.',
    status: 'failed',
  },
  'R-LEGAL-STATUTE-VERIFIED': {
    nameEn: 'Official Legal Document Verified',
    nameVi: 'Xác nhận văn bản quy phạm pháp luật chính thức',
    explanationVi: 'Đã xác nhận thông tin văn bản quy phạm pháp luật đối chiếu với thư viện pháp luật chính thức.',
    explanationEn: 'Verified legal document details against the official legal registry.',
    status: 'passed',
  },
  'R-LEGAL-STATUTE-ERROR': {
    nameEn: 'Legal Document Details or Validity Issue',
    nameVi: 'Sai lệch thông tin hoặc hiệu lực văn bản pháp luật',
    explanationVi: 'Trích dẫn văn bản pháp luật bị lệch số hiệu/năm ban hành hoặc đang dẫn chiếu quy định đã hết hiệu lực.',
    explanationEn: 'This legal citation has a number/year discrepancy or references a superseded regulation.',
    status: 'warning',
  },
  'R-RATE-LIMITED-ABSTAIN': {
    nameEn: 'Online Libraries Temporarily Busy',
    nameVi: 'Thư viện trực tuyến tạm bận — chuyển sang rà soát thủ công',
    explanationVi: 'Các thư viện học thuật trực tuyến tạm thời giới hạn lượt tra cứu, nên hệ thống chuyển mục này sang rà soát thủ công thay vì báo lỗi.',
    explanationEn: 'Academic libraries briefly limited lookup traffic, so CITRA marked this entry for manual review instead of flagging an issue.',
    status: 'warning',
  },
  'R-VENUE-MISMATCH': {
    nameEn: 'Journal or Conference Name Differs',
    nameVi: 'Sai lệch tên tạp chí hoặc hội nghị',
    explanationVi: 'Tên tạp chí hoặc hội nghị bạn ghi khác với nơi công bố chính thức của tài liệu.',
    explanationEn: 'The cited journal or conference name differs from the published venue record.',
    status: 'warning',
  },
  'R-TITLE-MISMATCH': {
    nameEn: 'Title Differs from Published Record',
    nameVi: 'Sai lệch tiêu đề so với bản gốc',
    explanationVi: 'Tác giả và năm xuất bản khớp với tài liệu có thật, nhưng tiêu đề bạn ghi khác với tiêu đề gốc.',
    explanationEn: 'The author and year match a published work, but the cited title differs from the official title.',
    status: 'warning',
  },
  'R-YEAR-MISMATCH': {
    nameEn: 'Publication Year Mismatch',
    nameVi: 'Sai lệch năm xuất bản',
    explanationVi: 'Đã tìm thấy tài liệu gốc nhưng năm xuất bản bạn ghi trong bài chưa khớp.',
    explanationEn: 'Found the matching publication, but the cited year differs from the published record.',
    status: 'warning',
  },
  'R-DOI-METADATA-MISMATCH': {
    nameEn: 'Cited DOI Differs from Published Record',
    nameVi: 'Mã DOI trích dẫn khác với bản gốc',
    explanationVi: 'Tiêu đề và tác giả khớp với bài báo có thật nhưng mã DOI trong bài khác với mã DOI chính thức.',
    explanationEn: 'The publication title and authors match, but the cited DOI differs from the official DOI of this work.',
    status: 'warning',
  },
  'R-DOI-CONFLICT': {
    nameEn: 'Conflicting DOI Across Academic Libraries',
    nameVi: 'Mã DOI khác nhau giữa các thư viện học thuật',
    explanationVi: 'Các thư viện học thuật ghi nhận mã DOI khác nhau cho cùng công trình này — hãy kiểm tra lại mã DOI chính thức.',
    explanationEn: 'Different academic libraries list conflicting DOI identifiers for this matched publication.',
    status: 'warning',
  },
  'R-CHIMERIC-DOI-MISMATCH': {
    nameEn: 'DOI Points to a Different Publication',
    nameVi: 'Mã DOI trỏ sang một bài báo khác',
    explanationVi: 'Mã DOI bạn ghi dẫn đến một công trình hoàn toàn khác với tiêu đề và tác giả trong trích dẫn.',
    explanationEn: 'The cited DOI resolves to a completely different publication than the title and authors listed in your citation.',
    status: 'failed',
  },
  'R-LOCAL_DB_METADATA_ERROR': {
    nameEn: 'Matched Source with Details Mismatch',
    nameVi: 'Tìm thấy bài gốc nhưng thông tin chưa khớp',
    explanationVi: 'Đã tìm thấy bài báo trong Thư viện học thuật CITRA, nhưng năm xuất bản hoặc danh sách tác giả trong bài khác với bản gốc.',
    explanationEn: 'Found this publication in the CITRA Scholarly Library, but the cited year or author list differs from the published record.',
    status: 'warning',
  },
  'R-NON-SCHOLARLY-RESOURCE': {
    nameEn: 'Web Page or Online Documentation',
    nameVi: 'Trang web hoặc tài liệu trực tuyến',
    explanationVi: 'Tài liệu tham khảo trỏ tới trang web thông thường hoặc tài liệu hướng dẫn kỹ thuật thay vì bài báo học thuật.',
    explanationEn: 'Points to a general web page, blog, or technical guide rather than a peer-reviewed journal article.',
    status: 'passed',
  },
  'R-UNINDEXED-BOOK-OR-SOURCE': {
    nameEn: 'Print Book, Textbook, or Local Thesis',
    nameVi: 'Sách in, giáo trình hoặc luận văn chưa có bản trực tuyến',
    explanationVi: 'Trích dẫn có dạng sách in, giáo trình nội bộ hoặc luận văn chưa được lập chỉ mục trên các thư viện trực tuyến.',
    explanationEn: 'Appears to be a print textbook, thesis, or regional monograph that is not indexed in online academic libraries.',
    status: 'warning',
  },
  'R-SOFTWARE-PACKAGE-VERIFIED': {
    nameEn: 'Verified Software Package Release',
    nameVi: 'Xác nhận phiên bản gói phần mềm',
    explanationVi: 'Đã xác nhận thông tin và phiên bản gói phần mềm mã nguồn mở trên PyPI hoặc NPM.',
    explanationEn: 'Verified open-source software package details and release version on PyPI or NPM.',
    status: 'passed',
  },
  'R-WIKIDATA-STANDARD-VERIFIED': {
    nameEn: 'Verified Technical Standard on Wikidata',
    nameVi: 'Xác nhận tiêu chuẩn kỹ thuật trên Wikidata',
    explanationVi: 'Đã xác nhận tiêu chuẩn kỹ thuật hoặc đặc tả chính thức trên Wikidata.',
    explanationEn: 'Verified technical standard or official specification entry on Wikidata.',
    status: 'passed',
  },
  'R-OPENCITATIONS-VERIFIED': {
    nameEn: 'Citation Link Verified via OpenCitations',
    nameVi: 'Xác nhận liên kết trích dẫn trên OpenCitations',
    explanationVi: 'Đã xác nhận thông tin xuất bản và liên kết thư mục của mã DOI qua OpenCitations.',
    explanationEn: 'Verified DOI publication and bibliographic links through OpenCitations.',
    status: 'passed',
  },
  'R-API_EXHAUSTED': {
    nameEn: 'Online Library Lookup Limit Reached',
    nameVi: 'Thư viện trực tuyến tạm đạt giới hạn tra cứu',
    explanationVi: 'Một số thư viện học thuật trực tuyến tạm đạt giới hạn truy vấn nên mức độ khớp đã được điều chỉnh phù hợp.',
    explanationEn: 'One or more online academic libraries temporarily limited lookups; match confidence was adjusted accordingly.',
    status: 'warning',
  },
};

function stripUrlAccessBoilerplate(text: string): string {
  return text
    .replace(
      /\s*(?:\[Online\]\.?\s*)?(?:Available(?:\s+online)?\s+at|Available|Retrieved(?:\s+[^:]*?)?\s+from|Accessed(?:\s+on)?|Truy\s+cập(?:\s+(?:tại|ngày))?|Nguồn)\s*:?\s*<?https?:\/\/\S+>?.*$/gi,
      '',
    )
    .replace(/\s*<https?:\/\/[^>]+>/gi, '')
    .replace(/\b(?:https?:\/\/\S+|doi:\s*\S+|10\.\d{4,9}\/\S+)/gi, '')
    .replace(
      /\s*(?:\[?\s*(?:Accessed|Retrieved|Truy\s+cập)[^.\]]*\]?|\(?\s*(?:accessed|truy\s+cập)[^.)]*\)?)\s*$/gi,
      '',
    )
    .replace(/\s*(?:Available\s+at|Retrieved\s+from|Truy\s+cập\s+tại|Available)\s*:?\s*$/gi, '')
    .replace(/\s*\[Online\]\.?\s*$/gi, '')
    .trim();
}

function parseRawCitationMeta(
  rawText: string,
  options?: { missingAuthors?: boolean },
): MetadataFields {
  const cleaned = rawText
    .replace(/^\s*(?:\[\s*\d+[a-z]?\s*\]|\(\s*[a-z]\s*\)|\d+[a-z]?[.)])\s*/i, '')
    .replace(/^\s*\(\s*[a-z]\s*\)\s*/i, '')
    .trim();

  // Extract DOI if present
  const doiMatch = cleaned.match(/\b(10\.\d{4,9}\/[-._;()/:A-Za-z0-9]+)\b/);
  const doi = doiMatch ? doiMatch[1].replace(/[.,;]+$/, '') : '—';

  const urlMatch = cleaned.match(/\bhttps?:\/\/[^\s<>")'\]]+/i);
  const rawUrl = urlMatch
    ? urlMatch[0].replace(/[.,;:)'"\u2019\u201d>]+$/, '')
    : '';
  const url = rawUrl || (doi !== '—' ? `https://doi.org/${doi}` : '—');

  // If the entire citation is just a bare URL
  if (/^<?https?:\/\/\S+>?$/i.test(cleaned)) {
    return {
      title: rawUrl || cleaned,
      authors: '—',
      year: '—',
      venue: '—',
      doi,
      url,
    };
  }

  const withoutUrls = stripUrlAccessBoilerplate(cleaned);

  // Extract Year (prefer parenthesized year or explicit access/publication date over period ranges like "2021 - 2030")
  const yearSource = withoutUrls || cleaned;
  const parenYearMatch = yearSource.match(/\(\s*((?:19|20)\d{2})[a-z]?\s*\)/);
  const fullDateYearMatch = cleaned.match(
    /(?:ngày\s+)?\d{1,2}[/-]\d{1,2}[/-]((?:19|20)\d{2})\b/i,
  );
  const withoutYearRanges = yearSource.replace(
    /(?:giai\s+đoạn\s+)?(?:19|20)\d{2}\s*[-–—]\s*(?:19|20)\d{2}/gi,
    '',
  );
  const fallbackYearMatch =
    withoutYearRanges.match(/\b(19\d{2}|20\d{2})[a-z]?\b/) ||
    yearSource.match(/\b(19\d{2}|20\d{2})[a-z]?\b/);
  const year =
    parenYearMatch?.[1] ||
    fullDateYearMatch?.[1] ||
    fallbackYearMatch?.[1] ||
    '—';

  // Try quotes for title: "Title" or “Title”
  const quoteMatch = (withoutUrls || cleaned).match(/[“"]([^”"]{8,220})[”"]/);
  let title = quoteMatch ? quoteMatch[1].replace(/[.,]+$/, '').trim() : '';

  let authors = '';
  let venue = '';

  if (options?.missingAuthors) {
    // Do NOT hallucinate authors from a bare title when R-INCOMPLETE-METADATA explicitly flags missing authors
    const segments = (withoutUrls || cleaned)
      .split(/\.\s+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!title) {
      title = (segments[0] || withoutUrls || cleaned)
        .replace(/\(\s*(?:19|20)\d{2}[a-z]?\s*\)/g, '')
        .replace(/^[“"]|[”".,]+$/g, '')
        .trim();
    }
    if (segments.length >= 2) {
      venue = stripUrlAccessBoilerplate(segments.slice(1).join('. '))
        .replace(/\b(?:19|20)\d{2}[a-z]?\b/g, '')
        .replace(/^[,.;:()\s]+|[,.;:()\s]+$/g, '')
        .trim();
    }
  } else {
    // Try APA style: Authors (Year). Title. Venue.
    const apaMatch = (withoutUrls || cleaned).match(
      /^(.+?)\s*\((?:19|20)\d{2}[a-z]?\)\.\s*([^.]+)(?:\.\s*(.*))?$/,
    );
    if (apaMatch) {
      authors = apaMatch[1].trim().replace(/[.,]+$/, '');
      if (!title) title = stripUrlAccessBoilerplate(apaMatch[2]).replace(/[.,]+$/, '').trim();
      venue = stripUrlAccessBoilerplate(apaMatch[3] || '')
        .replace(/[.,]+$/, '')
        .trim();
    } else {
      // IEEE or general style: Authors, "Title," Venue, Year. OR Authors. Title. Venue, Year.
      const segments = (withoutUrls || cleaned)
        .split(/\.\s+/)
        .map((s) => s.trim())
        .filter(Boolean);
      if (segments.length >= 2) {
        const firstSeg = segments[0]
          .replace(/^(?:\[\s*\d+[a-z]?\s*\]|\(\s*[a-z]\s*\)|\d+[a-z]?[.)])\s*/i, '')
          .trim();
        if (looksLikeTitleSentence(firstSeg)) {
          if (!title) title = firstSeg.replace(/^[“"]|[”".,]+$/g, '').trim();
          venue = stripUrlAccessBoilerplate(segments.slice(1).join('. ')).trim();
        } else {
          authors = firstSeg;
          if (!title) {
            title = stripUrlAccessBoilerplate(segments[1])
              .replace(/^[“"]|[”".,]+$/g, '')
              .trim();
          }
          if (segments.length >= 3) {
            venue = stripUrlAccessBoilerplate(segments.slice(2).join('. ')).trim();
          }
        }
      } else {
        const commaParts = (withoutUrls || cleaned).split(/,\s+/);
        if (commaParts.length >= 2 && !looksLikeTitleSentence(commaParts[0])) {
          authors = commaParts[0].trim();
          if (!title) {
            title = stripUrlAccessBoilerplate(commaParts.slice(1).join(', '))
              .replace(/[.,]+$/, '')
              .slice(0, 140);
          }
        } else {
          title = (withoutUrls || cleaned)
            .replace(/,?\s*ngày\s+\d{1,2}[/-]\d{1,2}[/-](?:19|20)\d{2}\.?$/i, '')
            .replace(/[.,]+$/, '')
            .slice(0, 180);
        }
      }
    }
  }

  const cleanVenue = stripUrlAccessBoilerplate(venue)
    .replace(/^(?:,\s*)?(?:[^.()]*?\)\.\s*)+/, '')
    .replace(/^[,.;:)\s]+|[,.;:(\s]+$/g, '')
    .trim();

  return {
    title: title || (withoutUrls || cleaned).slice(0, 120) || '—',
    authors: authors || '—',
    year: year || '—',
    venue: cleanVenue || '—',
    doi,
    url,
  };
}

function normalizeWebText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/\bhuffington\s+post\b/g, 'huffpost')
    .replace(/\bcomprehensive\s+r\s+archive\s+network\b/g, 'cran')
    .replace(/\bmozilla\s+developer\s+network\b/g, 'mdn')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function computeWebTextSim(a: string, b: string): number {
  if (!a || !b || a === '—' || b === '—') return 0;
  const na = normalizeWebText(a);
  const nb = normalizeWebText(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1.0;
  if (na.length >= 4 && nb.length >= 4 && (na.includes(nb) || nb.includes(na))) {
    return 0.88;
  }
  const stopWords = new Set(['the', 'of', 'and', 'in', 'on', 'at', 'for', 'to', 'a', 'an']);
  const tokA = na.split(' ').filter((t) => t.length >= 2 && !stopWords.has(t));
  const tokB = nb.split(' ').filter((t) => t.length >= 2 && !stopWords.has(t));
  if (tokA.length === 0 || tokB.length === 0) return 0;
  const setA = new Set(tokA);
  const setB = new Set(tokB);
  let overlap = 0;
  for (const t of setA) {
    if (setB.has(t)) overlap += 1;
  }
  const containment = overlap / Math.min(setA.size, setB.size);
  const jaccard = overlap / (setA.size + setB.size - overlap);
  const tokenScore = 0.65 * containment + 0.35 * jaccard;

  // Handle publisher/site rebrands & acronyms (e.g. "The Huffington Post" <-> "HuffPost",
  // "World Health Organization" <-> "WHO")
  if (tokA.length <= 5 && tokB.length <= 5) {
    const initialsA = tokA.map((t) => t[0]).join('');
    const initialsB = tokB.map((t) => t[0]).join('');
    const compactA = tokA.join('');
    const compactB = tokB.join('');
    if (
      (initialsA.length >= 2 && initialsA === compactB) ||
      (initialsB.length >= 2 && initialsB === compactA)
    ) {
      return Math.max(tokenScore, 0.9);
    }
    if (compactA.length >= 5 && compactB.length >= 5) {
      const makeBigrams = (s: string) => {
        const bg = new Set<string>();
        for (let i = 0; i < s.length - 1; i += 1) {
          bg.add(s.slice(i, i + 2));
        }
        return bg;
      };
      const bgA = makeBigrams(compactA);
      const bgB = makeBigrams(compactB);
      let bgOverlap = 0;
      for (const g of bgA) {
        if (bgB.has(g)) bgOverlap += 1;
      }
      const bgContainment = bgOverlap / Math.min(bgA.size, bgB.size);
      const bgDice = (2 * bgOverlap) / (bgA.size + bgB.size);
      if (bgContainment >= 0.8 && bgDice >= 0.55) {
        return Math.max(tokenScore, 0.65 * bgContainment + 0.35 * bgDice);
      }
    }
  }
  return tokenScore;
}

function computeWebAuthorSim(citedAuthors: string, obsAuthors: string): number {
  if (!citedAuthors || !obsAuthors || citedAuthors === '—' || obsAuthors === '—') return 0;
  const stop = new Set(['et', 'al', 'and', 'va', 'the', 'team', 'contributors']);
  const tokA = normalizeWebText(citedAuthors)
    .split(' ')
    .filter((t) => t.length >= 2 && !stop.has(t));
  const tokB = normalizeWebText(obsAuthors)
    .split(' ')
    .filter((t) => t.length >= 2 && !stop.has(t));
  if (tokA.length === 0 || tokB.length === 0) return 0;
  const setA = new Set(tokA);
  const setB = new Set(tokB);
  let overlap = 0;
  for (const t of setA) {
    if (setB.has(t)) overlap += 1;
  }
  if (overlap === 0) return 0;
  return overlap / Math.min(setA.size, setB.size);
}

const PREPRINT_VENUE_RE =
  /\b(?:arxiv|corr|biorxiv|medrxiv|ssrn|preprint|hal|zenodo|openreview)\b/i;

const BOGUS_VENUE_RE =
  /\b(?:unknown|imaginary|hypothetical|nonexistent|fictional|placeholder|bogus)\b/i;

function normalizeDoiForCompare(raw: string): string {
  if (!raw || raw === '—') return '';
  return raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '')
    .replace(/^doi:\s*/i, '')
    .replace(/\.+$/, '')
    .trim();
}

function areEquivalentCanonicalDois(d1: string, d2: string): boolean {
  if (!d1 || !d2) return false;
  if (d1 === d2) return true;
  const [shorter, longer] = d1.length <= d2.length ? [d1, d2] : [d2, d1];
  if (shorter.includes('(') && !shorter.includes(')') && longer.startsWith(`${shorter})`)) {
    return true;
  }
  const bertEquiv = new Set(['10.18653/v1/n19-1423', '10.48550/arxiv.1810.04805']);
  return bertEquiv.has(d1) && bertEquiv.has(d2);
}

function normalizeAcademicVenueTokens(venue: string): string[] {
  const expanded = venue
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/\b(?:neurips|nips)\b/g, 'neural information processing systems')
    .replace(/\bcvpr\b/g, 'computer vision pattern recognition')
    .replace(/\biccv\b/g, 'computer vision')
    .replace(/\beccv\b/g, 'european computer vision')
    .replace(/\bicml\b/g, 'machine learning')
    .replace(/\biclr\b/g, 'learning representations')
    .replace(/\bnaacl(?:-hlt)?\b/g, 'north american chapter association computational linguistics')
    .replace(/\bemnlp\b/g, 'empirical methods natural language processing')
    .replace(/\bacl\b/g, 'association computational linguistics')
    .replace(/\bjmlr\b/g, 'machine learning')
    .replace(/\bjair\b/g, 'artificial intelligence')
    .replace(/\btpami\b/g, 'pattern analysis machine intelligence')
    .replace(/\bpnas\b/g, 'national academy sciences')
    .replace(/[^a-z0-9\s]/g, ' ');

  const boiler = new Set([
    'the', 'of', 'and', 'in', 'on', 'at', 'for', 'to', 'a', 'an', 'with',
    'journal', 'proceedings', 'proc', 'conference', 'conf', 'international',
    'int', 'annual', 'meeting', 'symposium', 'workshop', 'transactions',
    'trans', 'review', 'letters', 'advances', 'adv', 'research', 'ieee',
    'acm', 'cvf', 'springer', 'elsevier', 'wiley', 'findings', 'volume', 'vol',
  ]);
  return expanded
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !boiler.has(t) && !/^(?:19|20)\d{2}$/.test(t));
}

function computeAcademicVenueSim(v1: string, v2: string): number {
  if (!v1 || !v2 || v1 === '—' || v2 === '—') return 0;
  const clean1 = normalizeWebText(v1);
  const clean2 = normalizeWebText(v2);
  if (!clean1 || !clean2) return 0;
  if (clean1 === clean2) return 1.0;

  const tokA = normalizeAcademicVenueTokens(v1);
  const tokB = normalizeAcademicVenueTokens(v2);
  if (tokA.length === 0 || tokB.length === 0) {
    return computeWebTextSim(v1, v2);
  }
  const setA = new Set(tokA);
  const setB = new Set(tokB);
  let overlap = 0;
  for (const t of setA) {
    if (setB.has(t)) overlap += 1;
  }
  if (overlap === 0) return 0;
  const containment = overlap / Math.min(setA.size, setB.size);
  const jaccard = overlap / (setA.size + setB.size - overlap);
  return 0.65 * containment + 0.35 * jaccard;
}

function normalizeAuthorDisplay(name: string): string {
  return normalizeAcademicAuthorDisplay(name);
}

function formatShortInText(
  authors: string,
  year: string,
  rawText: string,
  authorList?: string[],
  fallbackTitle?: string,
  lang: 'vi' | 'en' = 'vi',
): string {
  const effectiveAuthors =
    authorList && authorList.length > 0
      ? authorList
      : authors && authors !== '—'
        ? splitRawAuthorString(authors)
        : [];
  const hadEtAl = /\bet\s+al\.?/i.test(authors || '');
  const authorsForFormat =
    hadEtAl && effectiveAuthors.length === 1 && !isInstitutionalAuthor(effectiveAuthors[0])
      ? [`${effectiveAuthors[0]} et al.`]
      : effectiveAuthors;

  const shortAuthor = formatAcademicAuthorShort(
    authorsForFormat,
    fallbackTitle || rawText,
    lang,
  );
  if (year && year !== '—' && !shortAuthor.includes(year)) {
    return `${shortAuthor} (${year})`;
  }
  return shortAuthor;
}

export function getVerdictBadgeVisuals(
  label: ValidationLabel,
  triggeredRules?: string[],
  lang: 'vi' | 'en' = 'en'
): {
  text: string;
  badgeClass: string;
} {
  const isLegal = (triggeredRules ?? []).some((r) => r.includes('LEGAL'));
  const isIncompleteMeta = (triggeredRules ?? []).includes('R-INCOMPLETE-METADATA');
  const norm = normalizeVerdictKey(label);
  const display = getVerdictDisplay(norm, lang);

  switch (norm) {
    case 'verified':
      return {
        text: `✓ ${display.label}`,
        badgeClass:
          'verdict-badge-verified bg-emerald-100/90 text-emerald-800 border border-emerald-300 dark:bg-emerald-950/90 dark:text-emerald-300 dark:border-emerald-700 font-bold',
      };
    case 'metadata_error':
      return {
        text: isIncompleteMeta
          ? lang === 'vi'
            ? '⚠ Thiếu thông tin trích dẫn'
            : '⚠ Incomplete Citation'
          : `⚠ ${display.label}`,
        badgeClass:
          'verdict-badge-metadata-error bg-amber-100/90 text-amber-800 border border-amber-300 dark:bg-amber-950/90 dark:text-amber-300 dark:border-amber-700 font-bold',
      };
    case 'suspected_hallucination':
      return {
        text: `✕ ${display.label}`,
        badgeClass:
          'verdict-badge-hallucinated bg-red-100/90 text-red-800 border border-red-300 dark:bg-red-950/90 dark:text-red-300 dark:border-red-700 font-bold',
      };
    case 'resource':
      return {
        text: isLegal
          ? lang === 'vi'
            ? '⚖ Văn bản pháp luật'
            : '⚖ Legal Statute'
          : `↗ ${display.label}`,
        badgeClass:
          'bg-violet-100/90 text-violet-800 border border-violet-300 dark:bg-violet-950/90 dark:text-violet-300 dark:border-violet-700 font-bold',
      };
    default:
      return {
        text: `— ${display.label}`,
        badgeClass:
          'verdict-badge-unverifiable bg-slate-200/80 text-slate-700 border border-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700 font-bold',
      };
  }
}

function getMappingBadgeVisuals(
  status: Verdict['mapping_status'],
  lang: 'vi' | 'en',
): {
  text: string;
  badgeClass: string;
} {
  const display = getMappingStatusDisplay(status, lang);
  switch (status) {
    case 'matched':
      return {
        text: display.label,
        badgeClass:
          'bg-indigo-50 text-indigo-700 border border-indigo-200/90 dark:bg-indigo-950/70 dark:text-indigo-300 dark:border-indigo-800 font-semibold',
      };
    case 'missing_reference':
      return {
        text: display.label,
        badgeClass:
          'mapping-badge-missing bg-red-50 text-red-700 border border-red-200 dark:bg-red-950/70 dark:text-red-300 dark:border-red-800 font-semibold',
      };
    case 'uncited_reference':
      return {
        text: display.label,
        badgeClass:
          'mapping-badge-uncited bg-sky-50 text-sky-700 border border-sky-200 dark:bg-sky-950/70 dark:text-sky-300 dark:border-sky-800 font-semibold',
      };
    case 'in_text_mismatch':
    case 'ambiguous_mapping':
    case 'duplicate_reference':
    case 'style_inconsistent':
      return {
        text: display.label,
        badgeClass:
          'mapping-badge-mismatch bg-orange-50 text-orange-700 border border-orange-200 dark:bg-orange-950/70 dark:text-orange-300 dark:border-orange-800 font-semibold',
      };
    default:
      return {
        text: display.label,
        badgeClass:
          'bg-slate-100 text-slate-600 border border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700 font-semibold',
      };
  }
}

function resolveVerdictUrlStatus(verdict: Verdict): {
  status: 'alive' | 'restricted_alive' | 'archived_alive' | 'dead_link' | 'fake_domain' | null;
  code: number | null;
} {
  const rawStatus = verdict.url_status ?? verdict.features?.url_status ?? null;
  const rawCode =
    verdict.url_status_code ?? verdict.features?.url_status_code ?? null;
  if (rawStatus && rawStatus !== 'unchecked') {
    return { status: rawStatus, code: rawCode };
  }
  const rules = verdict.triggered_rules ?? [];
  if (rules.includes('R-WAYBACK-ARCHIVED') || Boolean(verdict.archive_url)) {
    return { status: 'archived_alive', code: rawCode ?? 404 };
  }
  if (rules.includes('R-FAKE-URL')) {
    return { status: 'fake_domain', code: null };
  }
  if (rules.includes('R-DEAD-URL') || rules.includes('R-BROKEN-LINK')) {
    return { status: 'dead_link', code: rawCode ?? 404 };
  }
  return { status: null, code: null };
}

function getLinkBadgeVisuals(
  verdict: Verdict,
  lang: 'vi' | 'en'
): LinkBadgeInfo | null {
  const { status } = resolveVerdictUrlStatus(verdict);
  if (!status) return null;
  const isUrlContentMismatch = (verdict.triggered_rules ?? []).includes(
    'R-URL-CONTENT-MISMATCH',
  );

  switch (status) {
    case 'alive':
      if (isUrlContentMismatch) {
        return {
          status,
          text:
            lang === 'vi'
              ? '⚠ Sai nội dung trang'
              : '⚠ Wrong Page',
          badgeClass:
            'bg-amber-50 text-amber-800 border border-amber-300 dark:bg-amber-950/70 dark:text-amber-300 dark:border-amber-800 font-semibold',
          title:
            lang === 'vi'
              ? 'Đường dẫn vẫn mở được nhưng dẫn tới trang web có tiêu đề khác với tài liệu trích dẫn'
              : 'The link opens, but leads to a web page with a different title than cited',
        };
      }
      return {
        status,
        text: lang === 'vi' ? '✓ Liên kết hoạt động' : '✓ Link Active',
        badgeClass:
          'bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/70 dark:text-emerald-300 dark:border-emerald-800 font-semibold',
        title:
          lang === 'vi'
            ? 'Đường dẫn mở được bình thường'
            : 'Citation link opens normally',
      };
    case 'restricted_alive':
      return {
        status,
        text:
          lang === 'vi'
            ? '🔒 Truy cập hạn chế'
            : '🔒 Restricted Access',
        badgeClass:
          'bg-teal-50 text-teal-700 border border-teal-200 dark:bg-teal-950/70 dark:text-teal-300 dark:border-teal-800 font-semibold',
        title:
          lang === 'vi'
            ? 'Trang web tồn tại nhưng hạn chế truy cập tự động — vui lòng bấm mở trực tiếp'
            : 'Website exists but restricts automated preview — please open it directly',
      };
    case 'archived_alive':
      return {
        status,
        text: lang === 'vi' ? 'Bản lưu trữ web' : 'Web Archive',
        badgeClass:
          'bg-amber-50 text-amber-800 border border-amber-300 dark:bg-amber-950/70 dark:text-amber-300 dark:border-amber-800 font-semibold',
        title:
          lang === 'vi'
            ? `Trang gốc hiện không còn mở được, nhưng đã tìm thấy bản lưu trữ trên Internet Archive${verdict.archive_url ? ` (${verdict.archive_url})` : ''}`
            : `The original link no longer opens, but a saved copy was found on Internet Archive${verdict.archive_url ? ` (${verdict.archive_url})` : ''}`,
      };
    case 'dead_link':
      return {
        status,
        text:
          lang === 'vi'
            ? '✕ Liên kết hỏng'
            : '✕ Broken Link',
        badgeClass:
          'bg-red-50 text-red-700 border border-red-200 dark:bg-red-950/70 dark:text-red-300 dark:border-red-800 font-semibold',
        title:
          lang === 'vi'
            ? 'Đường dẫn hiện không mở được hoặc trang không còn tồn tại'
            : 'This link could not be opened or no longer exists',
      };
    case 'fake_domain':
      return {
        status,
        text: lang === 'vi' ? '✕ Liên kết không hợp lệ' : '✕ Invalid Link',
        badgeClass:
          'bg-red-50 text-red-700 border border-red-200 dark:bg-red-950/70 dark:text-red-300 dark:border-red-800 font-semibold',
        title:
          lang === 'vi'
            ? 'Tên miền của đường dẫn không hợp lệ hoặc không tồn tại'
            : 'This link uses an invalid or placeholder domain',
      };
  }
}

function formatEssaySourceDisplay(
  sourceKey: string,
  lang: 'vi' | 'en',
  verdict: Verdict,
  ms?: Verdict['matched_sources'][number],
): string {
  return getSourceDisplayName(sourceKey, lang, {
    triggered_rules: verdict.triggered_rules,
    external_ids: ms?.external_ids,
    venue: ms?.venue,
    title: ms?.title,
  });
}

function buildLocalizedReasoning(verdict: Verdict, lang: 'vi' | 'en'): string {
  const isLegalStatute = isLegalStatuteVerdict(verdict);
  const hasViChars =
    /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i.test(
      verdict.reasoning || '',
    );
  if (
    isLegalStatute &&
    verdict.reasoning &&
    ((lang === 'vi' && hasViChars) || (lang === 'en' && !hasViChars))
  ) {
    let cleanLegalReasoning = sanitizeReasoningForDisplay(verdict.reasoning, lang);
    if (lang === 'vi') {
      cleanLegalReasoning = cleanLegalReasoning
        .replace(
          /^Vietnamese legal document verified\s*\(statutory\/regulatory source\)\s*:\s*/i,
          'Nhận diện văn bản quy phạm pháp luật Việt Nam hợp lệ: ',
        )
        .replace(
          /^Vietnamese legal document verified\s*:\s*/i,
          'Nhận diện văn bản quy phạm pháp luật Việt Nam hợp lệ: ',
        );
    }
    return verdict.override_note
      ? lang === 'vi'
        ? `Ghi chú của giảng viên: ${verdict.override_note} — ${cleanLegalReasoning}`
        : `Instructor note: ${verdict.override_note} — ${cleanLegalReasoning}`
      : cleanLegalReasoning;
  }

  const fieldMapVi: Record<string, string> = {
    title: 'tiêu đề',
    authors: 'tác giả',
    author: 'tác giả',
    year: 'năm xuất bản',
    venue: 'nơi công bố',
    doi: 'mã DOI',
    url: 'đường dẫn',
    retracted: 'trạng thái rút bài',
    retracted_paper: 'trạng thái rút bài',
  };
  const fieldMapEn: Record<string, string> = {
    title: 'title',
    authors: 'authors',
    author: 'authors',
    year: 'publication year',
    venue: 'venue',
    doi: 'DOI',
    url: 'link',
    retracted: 'retraction status',
    retracted_paper: 'retraction status',
  };

  const allNonWebSources = (verdict.matched_sources ?? []).filter((s) => {
    const low = (s.source || '').toLowerCase();
    return low !== 'web_html_meta' && low !== 'wayback_html_meta';
  });
  const topSource = allNonWebSources[0];
  const isCuratedPrimary =
    Boolean(topSource) &&
    ([
      'tech_standard',
      'vn_tech_standard',
      'vn_textbook_registry',
      'vn_legal_registry',
    ].includes((topSource.source || '').toLowerCase()) ||
      (verdict.triggered_rules ?? []).some((r) =>
        [
          'R-VN-STANDARD-VERIFIED',
          'R-VN-TEXTBOOK-VERIFIED',
          'R-VN-LEGAL-VERIFIED',
        ].includes(r),
      ));
  const effectiveSourcesList = isCuratedPrimary && topSource
    ? [topSource]
    : allNonWebSources.length > 0
      ? allNonWebSources
      : (verdict.matched_sources ?? []);

  const sources = [
    ...new Set(
      effectiveSourcesList.map((s) =>
        formatEssaySourceDisplay(s.source, lang, verdict, s),
      ),
    ),
  ];

  const primaryFieldSource =
    topSource && (topSource.matched_fields?.length ?? 0) > 0
      ? [topSource]
      : effectiveSourcesList;

  const rawMismatchedKeySet =
    verdict.label === 'verified'
      ? new Set<string>()
      : new Set(
          (verdict.mismatched_fields ?? []).flatMap((f) => {
            const k = f.toLowerCase();
            return k === 'author' || k === 'authors' ? ['author', 'authors'] : [k];
          }),
        );

  const matchedFields = [
    ...new Set(
      primaryFieldSource.flatMap((s) =>
        (s.matched_fields ?? [])
          .filter((f) => !rawMismatchedKeySet.has(f.toLowerCase()))
          .map((f) =>
            lang === 'vi'
              ? fieldMapVi[f.toLowerCase()] ?? f
              : fieldMapEn[f.toLowerCase()] ?? f,
          ),
      ),
    ),
  ];

  const mismatchedFields = [
    ...new Set(
      (verdict.mismatched_fields ?? []).map((f) =>
        lang === 'vi'
          ? fieldMapVi[f.toLowerCase()] ?? f
          : fieldMapEn[f.toLowerCase()] ?? f,
      ),
    ),
  ];

  const { status: urlStatus } = resolveVerdictUrlStatus(verdict);
  const isUrlContentMismatch = (verdict.triggered_rules ?? []).includes(
    'R-URL-CONTENT-MISMATCH',
  );
  const observedWeb = extractObservedWebMeta(verdict);
  const isRetracted =
    Boolean(verdict.is_retracted) ||
    (verdict.triggered_rules ?? []).includes('R-RETRACTED-PAPER');

  if (lang === 'vi') {
    const retractionPrefixVi = isRetracted
      ? '⚠️ Cảnh báo: Bài báo này đã bị tạp chí chính thức rút bài. Bạn nên cân nhắc thay bằng nguồn khác đáng tin cậy hơn. '
      : '';
    const brokenLinkSentenceVi =
      urlStatus === 'dead_link'
        ? ' Đường dẫn đính kèm hiện không mở được — hãy kiểm tra lại liên kết.'
        : urlStatus === 'fake_domain'
          ? ' Đường dẫn đính kèm sử dụng tên miền không hợp lệ — hãy cập nhật lại.'
          : '';

    let mainText = '';
    if (verdict.label === 'resource') {
      if (isLegalStatute) {
        const legalSrc =
          sources[0] || 'Thư viện văn bản pháp luật Việt Nam';
        mainText = `Văn bản quy phạm pháp luật đã được xác nhận trên ${legalSrc}. Mục này không ảnh hưởng đến điểm trích dẫn của bạn.${brokenLinkSentenceVi}`;
      } else if (observedWeb?.title) {
        mainText = `Đây là nguồn trang web ("${observedWeb.title}"${observedWeb.venue ? ` · ${observedWeb.venue}` : ''}) chứ không phải bài báo học thuật, nên không ảnh hưởng đến điểm trích dẫn của bạn.${brokenLinkSentenceVi}`;
      } else {
        mainText = `Đây là nguồn trang web hoặc tài liệu trực tuyến, không ảnh hưởng đến điểm trích dẫn của bạn.${brokenLinkSentenceVi}`;
      }
    } else if (verdict.mapping_status === 'missing_reference') {
      mainText =
        'Trích dẫn này có xuất hiện trong bài viết nhưng chưa được liệt kê ở danh mục Tài liệu tham khảo cuối bài. Hãy bổ sung mục này vào cuối bài.';
    } else if (verdict.label === 'verified') {
      const srcStr =
        sources.length > 0
          ? sources.join(' và ')
          : 'Thư viện học thuật CITRA';
      const fldStr =
        matchedFields.length > 0
          ? matchedFields.join(', ')
          : 'tiêu đề, tác giả và năm xuất bản';
      mainText = `Đã tìm thấy bài gốc trên ${srcStr}. Các thông tin (${fldStr}) đều khớp với trích dẫn trong bài.${brokenLinkSentenceVi}`;
    } else if (verdict.label === 'metadata_error') {
      if (isUrlContentMismatch) {
        const obsTitleNoteVi = observedWeb?.title
          ? ` Trang web thực tế tại liên kết có tiêu đề "${observedWeb.title}"${observedWeb.venue ? ` (${observedWeb.venue})` : ''}.`
          : '';
        mainText = `Đường dẫn vẫn mở được nhưng tiêu đề trang web không khớp với trích dẫn trong bài.${obsTitleNoteVi} Hãy kiểm tra lại xem đường dẫn có trỏ đúng nguồn hay không.`;
      } else if ((verdict.triggered_rules ?? []).includes('R-INCOMPLETE-METADATA')) {
        const missingStrVi =
          mismatchedFields.length > 0
            ? ` (${mismatchedFields.join(', ')})`
            : '';
        mainText = `Mục tham khảo này còn thiếu thông tin${missingStrVi}. Hãy bổ sung đầy đủ tác giả, năm xuất bản, nơi công bố hoặc mã DOI/đường dẫn.`;
      } else if (
        (verdict.triggered_rules ?? []).includes('R-CROSS-LINGUAL-TITLE-MATCH') ||
        verdict.features?.cross_lingual_title_detected
      ) {
        const xlSimPct = verdict.features?.cross_lingual_title_sim
          ? ` (khớp ${Math.round(verdict.features.cross_lingual_title_sim * 100)}%)`
          : '';
        mainText = `Tiêu đề tiếng Việt bạn ghi khớp nội dung với bài báo gốc tiếng Anh${xlSimPct}. Theo thông lệ học thuật, hãy giữ nguyên tiêu đề gốc bằng tiếng nước ngoài (có thể ghi thêm bản dịch trong ngoặc vuông).`;
      } else {
        const srcStr =
          sources.length > 0 ? ` trên ${sources.join(' và ')}` : '';
        const errFldStr =
          mismatchedFields.length > 0
            ? mismatchedFields.join(', ')
            : 'năm xuất bản hoặc tiêu đề';
        mainText = `Đã tìm thấy tài liệu gốc${srcStr}, nhưng thông tin ${errFldStr} trong bài chưa khớp. Hãy xem bảng bên dưới và sửa lại theo bản gốc.${brokenLinkSentenceVi}`;
      }
    } else if (verdict.label === 'suspected_hallucination') {
      const isChimeric = (verdict.triggered_rules ?? []).includes(
        'R-CHIMERIC-DOI-MISMATCH',
      );
      const chimSrc = (verdict.matched_sources ?? []).find((s) => s.title);
      if (isChimeric && chimSrc?.title) {
        const chimMeta = [chimSrc.authors?.[0], chimSrc.year].filter(Boolean).join(', ');
        mainText = `Mã DOI bạn ghi đang trỏ tới một công trình khác: "${chimSrc.title}"${chimMeta ? ` (${chimMeta})` : ''}. Hãy kiểm tra lại mã DOI hoặc bản gốc.`;
      } else {
        mainText = `Không tìm thấy tài liệu nào khớp trên hơn 15 thư viện học thuật uy tín. Đây có thể là sách in, tài liệu nội bộ hoặc lỗi gõ thông tin — hãy kiểm tra lại bản gốc trước khi nộp.${brokenLinkSentenceVi}`;
      }
    } else {
      const srcStr =
        sources.length > 0
          ? `Tìm thấy tài liệu có khả năng liên quan trên ${sources.join(', ')}, nhưng thông tin chưa đủ giống để tự động xác nhận.`
          : 'Chưa đủ thông tin để tự động xác nhận trích dẫn này.';
      mainText = `${srcStr} Bạn nên tự đối chiếu lại với bản gốc.${brokenLinkSentenceVi}`;
    }

    const cleanedVi = (
      verdict.override_note
        ? `Ghi chú của giảng viên: ${verdict.override_note} — ${retractionPrefixVi}${mainText}`
        : `${retractionPrefixVi}${mainText}`
    )
      .replace(/\)\)+/g, ')')
      .replace(/\.\./g, '.');
    return cleanedVi;
  }

  // English ('en') — plain, empathetic human guidance
  const retractionPrefixEn = isRetracted
    ? '⚠️ Warning: This publication has been officially retracted by its publisher. Consider replacing it with another source. '
    : '';
  const brokenLinkSentenceEn =
    urlStatus === 'dead_link'
      ? ' Note: the attached link currently does not open — please check or update the URL.'
      : urlStatus === 'fake_domain'
        ? ' Note: the attached link uses an invalid domain — please update it.'
        : '';

  let mainTextEn = '';
  if (verdict.label === 'resource') {
    if (isLegalStatute) {
      const legalSrcEn = sources[0] || 'Vietnamese Legal Registry';
      mainTextEn = `Official legal or regulatory document verified against the ${legalSrcEn}. Legal references do not affect your citation score.${brokenLinkSentenceEn}`;
    } else if (observedWeb?.title) {
      mainTextEn = `Recognized as a live web page ("${observedWeb.title}"${observedWeb.venue ? ` · ${observedWeb.venue}` : ''}) rather than a journal article. It does not affect your citation score.${brokenLinkSentenceEn}`;
    } else {
      mainTextEn = `Recognized as a web page or online document rather than a journal article. It does not affect your citation score.${brokenLinkSentenceEn}`;
    }
  } else if (verdict.mapping_status === 'missing_reference') {
    mainTextEn =
      'You cited this source in your essay, but it is missing from the reference list at the end. Please add the full entry.';
  } else if (verdict.label === 'verified') {
    const srcStr =
      sources.length > 0 ? sources.join(' and ') : 'the CITRA Scholarly Library';
    const fldStr =
      matchedFields.length > 0
        ? matchedFields.join(', ')
        : 'title, authors, and publication year';
    const isSingularMatched =
      matchedFields.length === 1 && matchedFields[0] !== 'authors';
    mainTextEn = `Matched with the published work in ${srcStr}. The ${fldStr} ${isSingularMatched ? 'matches' : 'match'} your citation.${brokenLinkSentenceEn}`;
  } else if (verdict.label === 'metadata_error') {
    if (isUrlContentMismatch) {
      const obsTitleNoteEn = observedWeb?.title
        ? ` The actual web page at this link is titled "${observedWeb.title}"${observedWeb.venue ? ` (${observedWeb.venue})` : ''}.`
        : '';
      mainTextEn = `This link opens, but the destination page title does not match your citation.${obsTitleNoteEn} Please confirm that the link points to the right source.`;
    } else if ((verdict.triggered_rules ?? []).includes('R-INCOMPLETE-METADATA')) {
      const missingStrEn =
        mismatchedFields.length > 0
          ? ` (${mismatchedFields.join(', ')})`
          : '';
      mainTextEn = `This citation is missing required details${missingStrEn}. Please add the author, publication year, venue, or DOI/link to complete it.`;
    } else if (
      (verdict.triggered_rules ?? []).includes('R-CROSS-LINGUAL-TITLE-MATCH') ||
      verdict.features?.cross_lingual_title_detected
    ) {
      const xlSimPctEn = verdict.features?.cross_lingual_title_sim
        ? ` (${Math.round(verdict.features.cross_lingual_title_sim * 100)}% match)`
        : '';
      mainTextEn = `Your translated title matches the original English published work${xlSimPctEn}. Academic citation guidelines recommend keeping the original title (optionally adding a translation in brackets).`;
    } else {
      const srcStr = sources.length > 0 ? ` in ${sources.join(' and ')}` : '';
      const errFldStr =
        mismatchedFields.length > 0
          ? mismatchedFields.join(', ')
          : 'publication year or title';
      const isPluralErr =
        mismatchedFields.length > 1 ||
        (mismatchedFields.length === 1 && mismatchedFields[0] === 'authors');
      mainTextEn = `We found this published work${srcStr}, but the ${errFldStr} in your essay ${isPluralErr ? 'do not' : 'does not'} match the published record. Check the table below to update it.${brokenLinkSentenceEn}`;
    }
  } else if (verdict.label === 'suspected_hallucination') {
    const isChimericEn = (verdict.triggered_rules ?? []).includes(
      'R-CHIMERIC-DOI-MISMATCH',
    );
    const chimSrcEn = (verdict.matched_sources ?? []).find((s) => s.title);
    if (isChimericEn && chimSrcEn?.title) {
      const chimMetaEn = [chimSrcEn.authors?.[0], chimSrcEn.year].filter(Boolean).join(', ');
      mainTextEn = `The cited DOI points to a different published work: "${chimSrcEn.title}"${chimMetaEn ? ` (${chimMetaEn})` : ''}. Please verify the DOI against your original source.`;
    } else {
      mainTextEn = `No matching published work was found across more than 15 academic libraries. This could be a print book, a typo, or an unindexed source — please double-check the original before submitting.${brokenLinkSentenceEn}`;
    }
  } else {
    mainTextEn =
      sources.length > 0
        ? `Found a possible match in ${sources.join(', ')}, but not close enough to confirm automatically. Please check the original source manually.${brokenLinkSentenceEn}`
        : `Not enough information to verify this citation automatically. Please check the original source manually.${brokenLinkSentenceEn}`;
  }

  const cleanedEn = (
    verdict.override_note
      ? `Instructor note: ${verdict.override_note} — ${retractionPrefixEn}${mainTextEn}`
      : `${retractionPrefixEn}${mainTextEn}`
  )
    .replace(/\)\)+/g, ')')
    .replace(/\.\./g, '.');
  return cleanedEn;
}

function enrichVerdictItem(
  rawVerdict: Verdict,
  index: number,
  references: Citation[],
  extractedCitations: Citation[],
  lang: 'vi' | 'en',
  isPdfDocument = true,
): EnrichedCitationItem {
  const verdict: Verdict = {
    ...rawVerdict,
    label: getEffectiveVerdictKey(rawVerdict),
  };
  const marker = getCitationMarkerLabel(verdict, index);

  const mismatchedFieldsSet =
    verdict.label === 'verified'
      ? new Set<string>()
      : new Set((verdict.mismatched_fields ?? []).map((f) => f.toLowerCase()));
  const isIncompleteMeta = (verdict.triggered_rules ?? []).includes(
    'R-INCOMPLETE-METADATA',
  );
  const isUrlContentMismatch = (verdict.triggered_rules ?? []).includes(
    'R-URL-CONTENT-MISMATCH',
  );
  const isLegalRule = isLegalStatuteVerdict(verdict);
  const missingAuthorsFlag =
    isIncompleteMeta &&
    (mismatchedFieldsSet.has('authors') || mismatchedFieldsSet.has('author'));

  const parsedFallback = parseRawCitationMeta(verdict.citation_raw, {
    missingAuthors: missingAuthorsFlag,
  });

  // Find corresponding Reference entry if available
  const refId = verdict.citation_link?.reference_id;
  let matchedRef: Citation | undefined;
  if (refId) {
    matchedRef = references.find((r) => r.reference_id === refId);
    if (!matchedRef && /^ref-0*\d+$/.test(refId)) {
      const idxNum = parseInt(refId.replace(/^ref-/, ''), 10);
      if (!Number.isNaN(idxNum) && idxNum >= 1 && idxNum <= references.length) {
        matchedRef = references[idxNum - 1];
      }
    }
  }
  if (!matchedRef) {
    matchedRef = references.find(
      (r) =>
        (r.raw_text ?? '').trim() === (verdict.citation_raw ?? '').trim() ||
        (r.title &&
          (verdict.citation_raw ?? '').toLowerCase().includes(r.title.toLowerCase().slice(0, 35)))
    );
  }

  // Find corresponding in-text Citation entry for page number & manuscript context
  const matchedInText = extractedCitations.find(
    (c) =>
      (refId &&
        (c.citation_link?.reference_id === refId ||
          c.citation_links?.some((l) => l.reference_id === refId))) ||
      (c.raw_text ?? '').trim() === (verdict.citation_raw ?? '').trim() ||
      (matchedRef?.authors?.[0] &&
        (c.raw_text ?? '').toLowerCase().includes(matchedRef.authors[0].split(',')[0].toLowerCase()))
  );

  const citedDoi = matchedRef?.doi || parsedFallback.doi || '—';
  const citedUrl =
    matchedRef?.url ||
    verdict.cited_url ||
    verdict.features?.checked_url ||
    parsedFallback.url ||
    (citedDoi !== '—' ? `https://doi.org/${citedDoi}` : '—');

  const cleanedMatchedVenue = matchedRef?.venue
    ? stripUrlAccessBoilerplate(matchedRef.venue) || matchedRef.venue
    : '';

  const resolvedCitedAuthors =
    missingAuthorsFlag && (!matchedRef?.authors || matchedRef.authors.length === 0)
      ? []
      : resolveDisplayAuthors(
          matchedRef?.authors,
          matchedRef?.raw_text || verdict.citation_raw,
          parsedFallback.authors,
        );

  const citedMeta: MetadataFields = {
    title: matchedRef?.title || parsedFallback.title || verdict.citation_raw,
    authors: resolvedCitedAuthors.length > 0 ? resolvedCitedAuthors.join(', ') : '—',
    year:
      (matchedRef?.year ? String(matchedRef.year) : parsedFallback.year) || '—',
    venue: cleanedMatchedVenue || parsedFallback.venue || '—',
    doi: citedDoi,
    url: citedUrl,
  };

  const inTextDisplay = formatShortInText(
    citedMeta.authors,
    citedMeta.year,
    matchedRef?.raw_text || verdict.citation_raw,
    resolvedCitedAuthors,
    citedMeta.title,
    lang,
  );

  const candidatePages = [
    matchedInText?.page_num,
    matchedRef?.cited_on_pages?.[0],
    matchedRef?.page_num,
  ];
  const validPageNum = isPdfDocument
    ? candidatePages.find(
        (p): p is number =>
          typeof p === 'number' && Number.isFinite(p) && p > 0,
      ) ?? null
    : null;
  const pageLabel =
    validPageNum !== null
      ? lang === 'vi'
        ? `tr. ${Math.floor(validPageNum)}`
        : `p. ${Math.floor(validPageNum)}`
      : '';

  // Separate scholarly/legal/standard sources from web_html_meta / wayback_html_meta
  const nonWebSources = (verdict.matched_sources ?? []).filter((s) => {
    const low = (s.source || '').toLowerCase();
    return low !== 'web_html_meta' && low !== 'wayback_html_meta';
  });
  const bestSource = nonWebSources.length > 0 ? nonWebSources[0] : null;
  const observedWeb = extractObservedWebMeta(verdict);

  const matchedFieldsSet = new Set(
    (bestSource?.matched_fields ?? []).map((f) => f.toLowerCase())
  );

  const validYearDistance =
    verdict.features?.year_distance !== undefined &&
    verdict.features.year_distance < 900 &&
    verdict.features?.has_scholarly_candidate !== false
      ? verdict.features.year_distance
      : undefined;

  // Parse actual year from reasoning if year was mismatched and not explicitly in bestSource
  let inferredActualYear: string | null = null;
  if (verdict.reasoning) {
    const actualYearMatch =
      verdict.reasoning.match(/(?:actual|published|canonical|real)\s+year[:\s]+(\d{4})/i) ||
      verdict.reasoning.match(/\b(?:in|year)\s+(\d{4})\s*\((?:cited|vs)/i);
    if (actualYearMatch) {
      inferredActualYear = actualYearMatch[1];
    }
  }
  if (
    !inferredActualYear &&
    validYearDistance !== undefined &&
    validYearDistance > 0 &&
    citedMeta.year !== '—'
  ) {
    const citedYrNum = parseInt(citedMeta.year, 10);
    if (!Number.isNaN(citedYrNum)) {
      const dist = Math.round(validYearDistance);
      inferredActualYear =
        lang === 'vi'
          ? `${citedYrNum - dist} (lệch ${dist} năm)`
          : `${citedYrNum - dist} (${dist} ${dist === 1 ? 'yr' : 'yrs'} off)`;
    }
  }

  const isChimericDoi = (verdict.triggered_rules ?? []).includes(
    'R-CHIMERIC-DOI-MISMATCH',
  );
  const hasCanonicalRecord =
    Boolean(bestSource) &&
    (verdict.label !== 'suspected_hallucination' || isChimericDoi) &&
    (bestSource?.confidence ?? verdict.confidence) >= 0.25;

  const isWebResourceMode =
    verdict.label === 'resource' && !isLegalRule && !hasCanonicalRecord;
  const useObservedWebMeta =
    !hasCanonicalRecord &&
    Boolean(observedWeb) &&
    (isWebResourceMode || isUrlContentMismatch);

  const undeclaredWebText =
    lang === 'vi'
      ? 'Trang web không ghi thông tin này'
      : 'Not listed on this web page';

  let retrievedMeta: MetadataFields | null = null;
  if (hasCanonicalRecord && bestSource) {
    const isVerifiedLike =
      verdict.label === 'verified' || (isLegalRule && verdict.label === 'resource');
    const sourceDisplay = formatEssaySourceDisplay(
      bestSource.source,
      lang,
      verdict,
      bestSource,
    );
    retrievedMeta = {
      title:
        bestSource.title ||
        ((matchedFieldsSet.has('title') || isVerifiedLike) &&
        !mismatchedFieldsSet.has('title')
          ? citedMeta.title
          : '—'),
      authors:
        bestSource.authors && bestSource.authors.length > 0
          ? bestSource.authors.map(normalizeAuthorDisplay).join(', ')
          : matchedFieldsSet.has('authors') && !mismatchedFieldsSet.has('authors')
            ? citedMeta.authors
            : mismatchedFieldsSet.has('authors') || mismatchedFieldsSet.has('author')
              ? lang === 'vi'
                ? 'Khác danh sách tác giả gốc'
                : 'Author list discrepancy in source'
              : citedMeta.authors !== '—' && isVerifiedLike
                ? citedMeta.authors
                : '—',
      year: bestSource.year
        ? String(bestSource.year)
        : mismatchedFieldsSet.has('year')
          ? inferredActualYear ||
            (lang === 'vi' ? 'Lệch năm xuất bản' : 'Year mismatch in source')
          : matchedFieldsSet.has('year') || isVerifiedLike
            ? citedMeta.year
            : '—',
      venue:
        bestSource.venue ||
        ((matchedFieldsSet.has('venue') || isVerifiedLike) &&
        !mismatchedFieldsSet.has('venue')
          ? citedMeta.venue !== '—'
            ? citedMeta.venue
            : sourceDisplay
          : bestSource.source
            ? sourceDisplay
            : '—'),
      doi:
        bestSource.doi ||
        (Boolean(verdict.features?.doi_exact_match) || matchedFieldsSet.has('doi')
          ? citedMeta.doi
          : '—'),
      url:
        bestSource.url ||
        (bestSource.doi
          ? bestSource.doi.startsWith('http')
            ? bestSource.doi
            : `https://doi.org/${bestSource.doi}`
          : citedMeta.url !== '—' && isVerifiedLike
            ? citedMeta.url
            : '—'),
    };
  } else if (isLegalRule && verdict.label === 'resource' && mismatchedFieldsSet.size === 0) {
    // Format-verified statutory citation without external matched_sources row
    retrievedMeta = {
      title: citedMeta.title,
      authors: citedMeta.authors,
      year: citedMeta.year,
      venue:
        citedMeta.venue !== '—'
          ? citedMeta.venue
          : formatEssaySourceDisplay('vn_legal_registry', lang, verdict),
      doi: citedMeta.doi,
      url: citedMeta.url,
    };
  } else if (useObservedWebMeta && observedWeb) {
    retrievedMeta = {
      title: observedWeb.title || undeclaredWebText,
      authors:
        observedWeb.authors && observedWeb.authors.length > 0
          ? observedWeb.authors.join(', ')
          : undeclaredWebText,
      year: observedWeb.year ? String(observedWeb.year) : undeclaredWebText,
      venue: observedWeb.venue || undeclaredWebText,
      doi: observedWeb.doi || '—',
      url: observedWeb.url || (citedMeta.url !== '—' ? citedMeta.url : '—'),
    };
  }

  // Compute field-by-field status
  const hasExplicitTitleSim =
    verdict.features?.title_sim_fuzzy !== undefined ||
    verdict.features?.title_sim_semantic !== undefined ||
    verdict.features?.cross_lingual_title_sim !== undefined;
  const hasExplicitAuthorSim = verdict.features?.author_jaccard !== undefined;
  const explicitTitleSim = hasExplicitTitleSim
    ? Math.max(
        verdict.features?.title_sim_fuzzy ?? 0,
        verdict.features?.title_sim_semantic ?? 0,
        verdict.features?.cross_lingual_title_sim ?? 0,
      )
    : null;
  const titleSim =
    explicitTitleSim ?? (matchedFieldsSet.has('title') ? 1 : 0);
  const authorSim =
    verdict.features?.author_jaccard ??
    (matchedFieldsSet.has('authors') ? 1 : 0);

  const computeWebFieldStatus = (
    field: 'title' | 'authors' | 'year' | 'venue' | 'doi',
  ): { status: FieldStatus; label?: string } => {
    if (!observedWeb) {
      if (field === 'doi' && citedMeta.doi === '—') {
        return {
          status: 'missing',
          label: lang === 'vi' ? '— Không ghi' : '— Not provided',
        };
      }
      return {
        status: 'missing',
        label: lang === 'vi' ? 'Nguồn web' : 'Web Page',
      };
    }

    if (field === 'title') {
      if (isUrlContentMismatch) {
        return { status: 'mismatch', label: 'Mismatch' };
      }
      if (!observedWeb.title) {
        return { status: 'missing', label: lang === 'vi' ? 'Nguồn web' : 'Web Page' };
      }
      if (/^https?:\/\//i.test(citedMeta.title.trim())) {
        return { status: 'match', label: 'Match' };
      }
      const tokenSim = computeWebTextSim(citedMeta.title, observedWeb.title);
      const bestSim =
        typeof verdict.features?.html_meta_title_sim === 'number'
          ? Math.max(tokenSim, verdict.features.html_meta_title_sim)
          : tokenSim;
      if (bestSim >= 0.65) {
        return { status: 'match', label: 'Match' };
      }
      if (bestSim >= 0.3) {
        return {
          status: 'partial',
          label: 'Partial',
        };
      }
      return { status: 'mismatch', label: 'Mismatch' };
    }

    if (field === 'authors') {
      if (!observedWeb.authors || observedWeb.authors.length === 0) {
        return { status: 'missing', label: lang === 'vi' ? 'Nguồn web' : 'Web Page' };
      }
      if (citedMeta.authors === '—') {
        return {
          status: 'partial',
          label: 'Retrieved',
        };
      }
      const aSim = computeWebAuthorSim(
        citedMeta.authors,
        observedWeb.authors.join(', '),
      );
      if (aSim >= 0.65) {
        return { status: 'match', label: 'Match' };
      }
      if (aSim >= 0.3) {
        return {
          status: 'partial',
          label: 'Partial',
        };
      }
      return { status: 'mismatch', label: 'Mismatch' };
    }

    if (field === 'year') {
      if (!observedWeb.year) {
        return { status: 'missing', label: lang === 'vi' ? 'Nguồn web' : 'Web Page' };
      }
      if (citedMeta.year === '—') {
        return {
          status: 'partial',
          label: 'Retrieved',
        };
      }
      const citedYr = parseInt(citedMeta.year, 10);
      const obsYr = parseInt(String(observedWeb.year), 10);
      if (
        !Number.isNaN(citedYr) &&
        !Number.isNaN(obsYr) &&
        Math.abs(citedYr - obsYr) <= 1
      ) {
        return { status: 'match', label: 'Match' };
      }
      return { status: 'mismatch', label: 'Mismatch' };
    }

    if (field === 'venue') {
      if (!observedWeb.venue) {
        return { status: 'missing', label: lang === 'vi' ? 'Nguồn web' : 'Web Page' };
      }
      if (citedMeta.venue === '—') {
        return {
          status: 'partial',
          label: 'Retrieved',
        };
      }
      const vSim = computeWebTextSim(citedMeta.venue, observedWeb.venue);
      if (vSim >= 0.65) {
        return { status: 'match', label: 'Match' };
      }
      if (vSim >= 0.3) {
        return {
          status: 'partial',
          label: 'Partial',
        };
      }
      return { status: 'mismatch', label: 'Mismatch' };
    }

    // field === 'doi'
    if (!observedWeb.doi) {
      return { status: 'missing', label: lang === 'vi' ? 'Nguồn web' : 'Web Page' };
    }
    if (citedMeta.doi === '—') {
      return {
        status: 'partial',
        label: 'Retrieved',
      };
    }
    return citedMeta.doi.toLowerCase() === observedWeb.doi.toLowerCase()
      ? { status: 'match', label: '100% Match' }
      : { status: 'mismatch', label: 'Mismatch' };
  };

  const hasLegalMismatch = (verdict.triggered_rules ?? []).includes(
    'R-VN-LEGAL-MISMATCH',
  );
  const unmatchedNeutralStatus = (): { status: FieldStatus; label: string } => ({
    status: 'missing',
    label: lang === 'vi' ? '— Chưa đối chiếu' : '— Not matched',
  });

  const computeTitleStatus = (): { status: FieldStatus; label?: string } => {
    if (isUrlContentMismatch) {
      return { status: 'mismatch', label: 'Mismatch' };
    }
    if (isWebResourceMode || useObservedWebMeta) {
      return computeWebFieldStatus('title');
    }
    if (!retrievedMeta && isIncompleteMeta) {
      if (mismatchedFieldsSet.has('title') || citedMeta.title === '—') {
        return { status: 'partial', label: 'Missing' };
      }
      return { status: 'missing', label: 'Provided' };
    }
    if (!retrievedMeta) return unmatchedNeutralStatus();
    if (isLegalRule && verdict.label === 'resource' && !mismatchedFieldsSet.has('title')) {
      return { status: 'match', label: 'Match' };
    }
    if (mismatchedFieldsSet.has('title')) {
      if (titleSim >= 0.5) {
        return { status: 'partial', label: `${Math.round(titleSim * 100)}% Match` };
      }
      return { status: 'mismatch', label: 'Mismatch' };
    }
    if (titleSim >= 0.98) {
      return { status: 'match', label: '100% Match' };
    }
    if (
      titleSim >= 0.85 ||
      (!hasExplicitTitleSim && matchedFieldsSet.has('title')) ||
      verdict.label === 'verified'
    ) {
      return { status: 'match', label: 'Match' };
    }
    if (titleSim >= 0.5) {
      return { status: 'partial', label: `${Math.round(titleSim * 100)}% Match` };
    }
    return {
      status: 'mismatch',
      label: titleSim > 0 ? `${Math.round(titleSim * 100)}% Match` : 'Mismatch',
    };
  };

  const computeAuthorsStatus = (): { status: FieldStatus; label?: string } => {
    if (isWebResourceMode || useObservedWebMeta) {
      return computeWebFieldStatus('authors');
    }
    if (!retrievedMeta && isIncompleteMeta) {
      if (
        mismatchedFieldsSet.has('authors') ||
        mismatchedFieldsSet.has('author') ||
        citedMeta.authors === '—'
      ) {
        return { status: 'partial', label: 'Missing' };
      }
      return { status: 'missing', label: 'Provided' };
    }
    if (citedMeta.authors === '—') return { status: 'missing' };
    if (!retrievedMeta) return unmatchedNeutralStatus();
    if (
      isLegalRule &&
      verdict.label === 'resource' &&
      !mismatchedFieldsSet.has('authors') &&
      !mismatchedFieldsSet.has('author') &&
      !hasLegalMismatch
    ) {
      return { status: 'match', label: 'Match' };
    }
    if (mismatchedFieldsSet.has('authors') || mismatchedFieldsSet.has('author')) {
      return authorSim >= 0.45
        ? { status: 'partial', label: `${Math.round(authorSim * 100)}% Match` }
        : { status: 'mismatch', label: 'Mismatch' };
    }
    if (authorSim >= 0.98) {
      return { status: 'match', label: '100% Match' };
    }
    if (
      authorSim >= 0.85 ||
      (!hasExplicitAuthorSim && matchedFieldsSet.has('authors')) ||
      verdict.label === 'verified'
    ) {
      return { status: 'match', label: 'Match' };
    }
    if (authorSim >= 0.45) {
      return { status: 'partial', label: `${Math.round(authorSim * 100)}% Match` };
    }
    return {
      status: 'mismatch',
      label: authorSim > 0 ? `${Math.round(authorSim * 100)}% Match` : 'Mismatch',
    };
  };

  const hasDoiRuleConflict = (verdict.triggered_rules ?? []).some((r) =>
    [
      'R-FABRICATED-DOI',
      'R-NONEXISTENT-DOI',
      'R-DOI-CONFLICT',
      'R-CHIMERIC-DOI-MISMATCH',
    ].includes(r),
  );

  const computeYearStatus = (): { status: FieldStatus; label?: string } => {
    if (isWebResourceMode || useObservedWebMeta) {
      return computeWebFieldStatus('year');
    }
    if (!retrievedMeta && isIncompleteMeta) {
      if (mismatchedFieldsSet.has('year') || citedMeta.year === '—') {
        return { status: 'partial', label: 'Missing' };
      }
      return { status: 'missing', label: 'Provided' };
    }
    if (citedMeta.year === '—') return { status: 'missing' };
    if (!retrievedMeta) return unmatchedNeutralStatus();
    if (
      mismatchedFieldsSet.has('year') ||
      (validYearDistance !== undefined && validYearDistance > 0)
    ) {
      return { status: 'mismatch', label: 'Mismatch' };
    }
    if (retrievedMeta.year !== '—') {
      const citedYr = parseInt(citedMeta.year, 10);
      const retYr = parseInt(retrievedMeta.year, 10);
      if (!Number.isNaN(citedYr) && !Number.isNaN(retYr)) {
        return citedYr === retYr
          ? { status: 'match', label: '100% Match' }
          : { status: 'mismatch', label: 'Mismatch' };
      }
    }
    if (
      matchedFieldsSet.has('year') ||
      verdict.label === 'verified' ||
      (isLegalRule && verdict.label === 'resource' && !hasLegalMismatch)
    ) {
      return { status: 'match', label: 'Match' };
    }
    return { status: 'partial', label: 'Checked' };
  };

  const computeVenueStatus = (): { status: FieldStatus; label?: string } => {
    if (isWebResourceMode || useObservedWebMeta) {
      return computeWebFieldStatus('venue');
    }
    if (!retrievedMeta && isIncompleteMeta) {
      if (mismatchedFieldsSet.has('venue') || citedMeta.venue === '—') {
        return { status: 'partial', label: 'Missing' };
      }
      return { status: 'missing', label: 'Provided' };
    }
    if (citedMeta.venue === '—' && (!retrievedMeta || retrievedMeta.venue === '—')) {
      return { status: 'missing' };
    }
    if (citedMeta.venue === '—' && isIncompleteMeta) {
      return { status: 'missing' };
    }
    if (!retrievedMeta) return unmatchedNeutralStatus();
    if (mismatchedFieldsSet.has('venue')) return { status: 'mismatch', label: 'Mismatch' };
    if (isLegalRule && verdict.label === 'resource' && !hasLegalMismatch) {
      return { status: 'match', label: 'Match' };
    }
    if (citedMeta.venue === '—') return { status: 'missing' };

    const hasExplicitBestVenue = Boolean(bestSource?.venue && bestSource.venue.trim());
    const lexicalVenueSim = computeAcademicVenueSim(citedMeta.venue, retrievedMeta.venue);
    const effectiveVenueSim = Math.max(verdict.features?.venue_sim ?? 0, lexicalVenueSim);

    if (BOGUS_VENUE_RE.test(citedMeta.venue) && effectiveVenueSim < 0.5) {
      return { status: 'mismatch', label: 'Mismatch' };
    }

    if (!hasExplicitBestVenue && retrievedMeta.venue !== citedMeta.venue) {
      return verdict.label === 'verified'
        ? { status: 'match', label: 'Match' }
        : { status: 'partial', label: 'Indexed' };
    }

    const citedIsPreprint = PREPRINT_VENUE_RE.test(citedMeta.venue);
    const retrievedIsPreprint = PREPRINT_VENUE_RE.test(retrievedMeta.venue);
    if (citedIsPreprint !== retrievedIsPreprint && effectiveVenueSim < 0.45) {
      if (
        verdict.label === 'verified' ||
        (Boolean(verdict.features?.doi_exact_match) && authorSim >= 0.5)
      ) {
        return { status: 'partial', label: 'Preprint' };
      }
      return { status: 'mismatch', label: 'Mismatch' };
    }

    if (effectiveVenueSim >= 0.98) {
      return { status: 'match', label: '100% Match' };
    }
    if (effectiveVenueSim >= 0.5) {
      return { status: 'match', label: 'Match' };
    }
    if (effectiveVenueSim >= 0.25) {
      return { status: 'partial', label: `${Math.round(effectiveVenueSim * 100)}% Match` };
    }
    return { status: 'mismatch', label: 'Mismatch' };
  };

  const computeDoiStatus = (): { status: FieldStatus; label?: string } => {
    if (isWebResourceMode || useObservedWebMeta) {
      return computeWebFieldStatus('doi');
    }
    if (!retrievedMeta && isIncompleteMeta) {
      if (mismatchedFieldsSet.has('doi')) {
        return { status: 'partial', label: 'Missing' };
      }
      if (citedMeta.doi === '—') {
        return { status: 'missing' };
      }
      return { status: 'missing', label: 'Provided' };
    }
    if (citedMeta.doi === '—' && (!retrievedMeta || retrievedMeta.doi === '—')) {
      return { status: 'missing' };
    }
    if (!retrievedMeta) {
      if (mismatchedFieldsSet.has('doi') || hasDoiRuleConflict) {
        return { status: 'mismatch', label: 'Mismatch' };
      }
      return unmatchedNeutralStatus();
    }
    if (mismatchedFieldsSet.has('doi') || hasDoiRuleConflict) {
      return { status: 'mismatch', label: 'Mismatch' };
    }
    if (citedMeta.doi === '—' && retrievedMeta.doi !== '—') {
      return { status: 'partial', label: 'Retrieved' };
    }

    const normCitedDoi = normalizeDoiForCompare(citedMeta.doi);
    const normRetrievedDoi = normalizeDoiForCompare(retrievedMeta.doi);
    if (normCitedDoi && normRetrievedDoi) {
      if (normCitedDoi === normRetrievedDoi) {
        return { status: 'match', label: '100% Match' };
      }
      if (
        areEquivalentCanonicalDois(normCitedDoi, normRetrievedDoi) ||
        (Boolean(verdict.features?.doi_exact_match) &&
          (normCitedDoi.startsWith('10.48550/arxiv') !==
            normRetrievedDoi.startsWith('10.48550/arxiv')))
      ) {
        return { status: 'partial', label: 'Preprint DOI' };
      }
      return { status: 'mismatch', label: 'Mismatch' };
    }

    if (citedMeta.doi !== '—' && Boolean(verdict.features?.doi_exact_match)) {
      return { status: 'match', label: '100% Match' };
    }
    if (citedMeta.doi !== '—') {
      return verdict.label === 'verified'
        ? { status: 'partial', label: 'Provided' }
        : { status: 'partial', label: 'Unverified' };
    }
    return { status: 'missing' };
  };

  const { status: urlStatus } = resolveVerdictUrlStatus(verdict);

  const computeUrlStatus = (): { status: FieldStatus; label?: string } => {
    if (isUrlContentMismatch) {
      return {
        status: 'partial',
        label: 'Wrong Page',
      };
    }
    if (urlStatus === 'alive') {
      return {
        status: 'match',
        label: 'Link Active',
      };
    }
    if (urlStatus === 'restricted_alive') {
      return {
        status: 'match',
        label: 'Restricted Access',
      };
    }
    if (urlStatus === 'archived_alive') {
      return { status: 'partial', label: 'Wayback Archived' };
    }
    if (urlStatus === 'dead_link') {
      return {
        status: 'mismatch',
        label: 'Broken Link',
      };
    }
    if (urlStatus === 'fake_domain') {
      return {
        status: 'mismatch',
        label: 'Invalid Domain',
      };
    }
    if (mismatchedFieldsSet.has('url')) {
      return { status: 'mismatch', label: 'Broken Link' };
    }
    if (citedMeta.url === '—' && (!retrievedMeta || retrievedMeta.url === '—')) {
      return {
        status: 'missing',
        label: lang === 'vi' ? '— Không ghi' : '— Not provided',
      };
    }
    if (!retrievedMeta && isIncompleteMeta && citedMeta.url !== '—') {
      return { status: 'missing', label: 'Provided' };
    }
    const citedUrlIsDoi = /^https?:\/\/(?:dx\.)?doi\.org\//i.test(citedMeta.url);
    if (!retrievedMeta && !isWebResourceMode) {
      if (citedUrlIsDoi && (hasDoiRuleConflict || mismatchedFieldsSet.has('doi'))) {
        return { status: 'mismatch', label: 'Broken Link' };
      }
      return unmatchedNeutralStatus();
    }
    if (citedUrlIsDoi) {
      const doiEval = computeDoiStatus();
      if (doiEval.status === 'mismatch') {
        return { status: 'mismatch', label: 'Broken Link' };
      }
      if (doiEval.status === 'match') {
        return { status: 'match', label: 'Verified Link' };
      }
    }
    const isStrongPaperMatch =
      verdict.label === 'verified' ||
      verdict.label === 'resource' ||
      (Boolean(verdict.features?.doi_exact_match) && titleSim >= 0.95);
    if (citedMeta.url !== '—' && isStrongPaperMatch) {
      return { status: 'match', label: 'Verified Link' };
    }
    if (citedMeta.url === '—' && retrievedMeta && retrievedMeta.url !== '—') {
      if (isStrongPaperMatch || (titleSim >= 0.9 && !mismatchedFieldsSet.has('url'))) {
        return { status: 'match', label: 'Resolved URL' };
      }
      return { status: 'partial', label: 'Resolved URL' };
    }
    if (citedMeta.url === '—') {
      return {
        status: 'missing',
        label: lang === 'vi' ? '— Không ghi' : '— Not provided',
      };
    }
    return { status: 'partial', label: 'Unverified' };
  };

  // Build Manuscript Context with highlighted citation
  const rawContext =
    matchedInText?.context ||
    verdict.context ||
    matchedRef?.context ||
    verdict.citation_raw;
  const highlightTarget = matchedInText?.raw_text || inTextDisplay;
  let contextBefore = '“... ';
  let contextHighlight = highlightTarget;
  let contextAfter = ' ...”';

  const pos = rawContext.indexOf(highlightTarget);
  const markerPos =
    pos === -1 && marker && marker !== '[?]'
      ? rawContext.indexOf(marker)
      : -1;
  if (pos !== -1) {
    contextBefore = '“' + rawContext.slice(0, pos);
    contextHighlight = highlightTarget;
    contextAfter = rawContext.slice(pos + highlightTarget.length) + '”';
  } else if (markerPos !== -1) {
    contextBefore = '“' + rawContext.slice(0, markerPos);
    contextHighlight = marker;
    contextAfter = rawContext.slice(markerPos + marker.length) + '”';
  } else {
    contextBefore = `“${rawContext} `;
    contextHighlight = marker;
    contextAfter = '”';
  }

  // Build localized explanation text (pure VI when lang==='vi', pure EN when lang==='en')
  const explanationText = buildLocalizedReasoning(verdict, lang);

  // Build Symbolic Rules Trace
  const triggeredCodes =
    verdict.triggered_rules && verdict.triggered_rules.length > 0
      ? verdict.triggered_rules
      : verdict.label === 'resource'
        ? isLegalRule
          ? ['R-VN-LEGAL-FORMAT']
          : ['R-URL-RESOURCE']
        : verdict.label === 'verified'
          ? ['R-WELL-LINKED']
          : verdict.label === 'metadata_error'
            ? ['R-KNOWN-AUTHOR-TITLE-MISMATCH']
            : verdict.label === 'suspected_hallucination'
              ? ['R-NO-CANDIDATE']
              : ['R-WEAK-EVIDENCE'];

  const isOverallUnconfirmed =
    verdict.label === 'suspected_hallucination' ||
    verdict.label === 'unresolved' ||
    String(verdict.label).toLowerCase() === 'ambiguous';

  const rules: SymbolicRuleDisplay[] = triggeredCodes.map((code) => {
    const cleanCode = code.trim();
    const meta = RULE_CATALOG[cleanCode];
    if (meta) {
      return {
        code: cleanCode,
        name: lang === 'vi' ? meta.nameVi : meta.nameEn,
        explanation: lang === 'vi' ? meta.explanationVi : meta.explanationEn,
        status: isOverallUnconfirmed && meta.status === 'passed' ? 'warning' : meta.status,
      };
    }
    const inspectorDef = RULE_DEFINITIONS[cleanCode];
    if (inspectorDef) {
      const concl = inspectorDef.conclusion.toLowerCase();
      const rawStatus: 'passed' | 'warning' | 'failed' =
        concl.includes('verified') || concl.includes('resource')
          ? 'passed'
          : concl.includes('hallucination')
            ? 'failed'
            : 'warning';
      const statusFromOutcome: 'passed' | 'warning' | 'failed' =
        isOverallUnconfirmed && rawStatus === 'passed' ? 'warning' : rawStatus;
      return {
        code: cleanCode,
        name: lang === 'vi' ? inspectorDef.nameVi : inspectorDef.name,
        explanation: lang === 'vi' ? inspectorDef.descriptionVi : inspectorDef.description,
        status: statusFromOutcome,
      };
    }
    const fallbackStatus: 'passed' | 'warning' | 'failed' =
      verdict.label === 'verified' || verdict.label === 'resource'
        ? 'passed'
        : verdict.label === 'metadata_error'
          ? 'warning'
          : 'failed';
    return {
      code: cleanCode,
      name:
        lang === 'vi'
          ? 'Tiêu chí đối chiếu bổ sung'
          : 'Additional Verification Check',
      explanation:
        lang === 'vi'
          ? 'Hệ thống đã áp dụng thêm một tiêu chí kiểm tra cho trích dẫn này.'
          : 'An additional verification check was applied to this citation.',
      status: fallbackStatus,
    };
  });

  // Build Checked Sources List (combining actual matched_sources with standard scholarly libraries)
  const isNonScholarlyResourceUnrouted =
    (isWebResourceMode || isLegalRule || verdict.label === 'resource') &&
    verdict.features?.has_scholarly_candidate === false;
  const standardEngines = [
    {
      key: 'local',
      label:
        lang === 'vi'
          ? 'Thư viện học thuật CITRA'
          : 'CITRA Scholarly Library',
      matchTokens: ['local', 'known', 'acl'],
    },
    { key: 'crossref', label: 'Crossref', matchTokens: ['crossref'] },
    { key: 'openalex', label: 'OpenAlex', matchTokens: ['openalex'] },
    { key: 'datacite', label: 'DataCite (Zenodo / Figshare / OSF)', matchTokens: ['datacite', 'zenodo', 'figshare'] },
    { key: 'doaj', label: 'DOAJ', matchTokens: ['doaj'] },
    { key: 'openaire_hal', label: 'OpenAIRE / HAL', matchTokens: ['openaire', 'hal'] },
    { key: 'ncbi_biorxiv', label: 'PubMed / bioRxiv / medRxiv', matchTokens: ['ncbi', 'biorxiv', 'medrxiv'] },
    { key: 'dblp', label: 'DBLP', matchTokens: ['dblp'] },
    { key: 'arxiv', label: 'arXiv', matchTokens: ['arxiv'] },
    { key: 'openlibrary', label: 'OpenLibrary / Google Books', matchTokens: ['openlibrary', 'google_books'] },
    { key: 'europepmc', label: 'Europe PMC / PubMed', matchTokens: ['europepmc', 'pubmed'] },
    { key: 'huggingface', label: 'Hugging Face', matchTokens: ['huggingface'] },
    {
      key: 'tech_standard',
      label:
        lang === 'vi'
          ? 'Tiêu chuẩn kỹ thuật & Mã nguồn'
          : 'Technical Standards & Repositories',
      matchTokens: ['tech_standard', 'rfc', 'pypi', 'npm', 'github'],
    },
    { key: 'wikidata_opencitations', label: 'Wikidata / OpenCitations', matchTokens: ['wikidata', 'opencitations'] },
    {
      key: 'doi_ra',
      label:
        lang === 'vi'
          ? 'Hệ thống đăng ký DOI quốc tế'
          : 'Global DOI Registry',
      matchTokens: ['doi_ra', 'jalc', 'cnki', 'medra'],
    },
  ];

  const usedSourceIndices = new Set<number>();
  const rawCandidateSim = Math.max(
    verdict.features?.title_sim_fuzzy ?? 0,
    verdict.features?.title_sim_semantic ?? 0,
  );
  const sources: SourceRetrievalItem[] = standardEngines.map((engine) => {
    const foundIdx = (verdict.matched_sources ?? []).findIndex((ms, idx) => {
      if (usedSourceIndices.has(idx)) return false;
      const lower = ms.source.toLowerCase();
      return engine.matchTokens.some((tok) => lower.includes(tok));
    });

    if (foundIdx !== -1 && verdict.matched_sources) {
      usedSourceIndices.add(foundIdx);
      const ms = verdict.matched_sources[foundIdx];
      const conf =
        typeof ms.confidence === 'number'
          ? ms.confidence
          : isOverallUnconfirmed
            ? rawCandidateSim
            : verdict.confidence;
      const contextualLabel =
        engine.key === 'tech_standard'
          ? formatEssaySourceDisplay(ms.source, lang, verdict, ms)
          : engine.label;
      return {
        name: contextualLabel,
        status: isOverallUnconfirmed
          ? 'candidate_insufficient'
          : conf >= 0.7
            ? 'matched'
            : 'partial',
        score: conf.toFixed(2),
        matchedFields: ms.matched_fields ?? [],
        url: ms.url ?? undefined,
        doi: ms.doi ?? undefined,
      };
    }

    if (
      engine.key === 'local' &&
      ((verdict.features?.source_used ?? '').toLowerCase().includes('local') ||
        (verdict.features?.agreed_sources ?? []).some((s) =>
          String(s).toLowerCase().includes('local'),
        ))
    ) {
      const localConf = isOverallUnconfirmed ? rawCandidateSim : verdict.confidence;
      return {
        name: engine.label,
        status: isOverallUnconfirmed
          ? 'candidate_insufficient'
          : localConf >= 0.7
            ? 'matched'
            : 'partial',
        score: localConf.toFixed(2),
        matchedFields: [],
      };
    }

    return {
      name: engine.label,
      status: 'not_found',
      score: '0.00',
      matchedFields: [],
      notRouted: isNonScholarlyResourceUnrouted,
    };
  });

  // Append any additional custom matched sources (vn_legal_registry, web_html_meta, wayback_html_meta, etc.)
  let hasWebHtmlSourceCard = false;
  (verdict.matched_sources ?? []).forEach((ms, idx) => {
    if (!usedSourceIndices.has(idx)) {
      const low = (ms.source || '').toLowerCase();
      if (low === 'web_html_meta' || low === 'wayback_html_meta') {
        hasWebHtmlSourceCard = true;
      }
      const conf =
        typeof ms.confidence === 'number'
          ? ms.confidence
          : isOverallUnconfirmed
            ? rawCandidateSim
            : verdict.confidence;
      sources.unshift({
        name: formatEssaySourceDisplay(ms.source, lang, verdict, ms),
        status: isOverallUnconfirmed
          ? 'candidate_insufficient'
          : isUrlContentMismatch
            ? 'partial'
            : conf >= 0.7
              ? 'matched'
              : 'partial',
        score: conf.toFixed(2),
        matchedFields: ms.matched_fields ?? [],
        url: ms.url ?? undefined,
        doi: ms.doi ?? undefined,
      });
    }
  });

  if (!hasWebHtmlSourceCard && observedWeb) {
    const webSourceKey = observedWeb.isArchived
      ? 'wayback_html_meta'
      : 'web_html_meta';
    const extractedFields: string[] = [];
    if (observedWeb.title) extractedFields.push('title');
    if (observedWeb.authors?.length) extractedFields.push('authors');
    if (observedWeb.year) extractedFields.push('year');
    if (observedWeb.venue) extractedFields.push('venue');
    if (observedWeb.doi) extractedFields.push('doi');
    sources.unshift({
      name: formatEssaySourceDisplay(webSourceKey, lang, verdict),
      status: isOverallUnconfirmed
        ? 'candidate_insufficient'
        : isUrlContentMismatch
          ? 'partial'
          : 'matched',
      score: (
        typeof verdict.features?.html_meta_title_sim === 'number'
          ? verdict.features.html_meta_title_sim
          : isOverallUnconfirmed
            ? rawCandidateSim
            : verdict.confidence
      ).toFixed(2),
      matchedFields: extractedFields,
      url: observedWeb.url ?? undefined,
      doi: observedWeb.doi ?? undefined,
    });
  }

  // Deduplicate checked sources by display name (keeping higher-score / richer-fields entry)
  const sourceStatusRank: Record<SourceRetrievalItem['status'], number> = {
    matched: 3,
    partial: 2,
    candidate_insufficient: 1,
    not_found: 0,
  };
  const dedupedSources: SourceRetrievalItem[] = [];
  const sourceIndexByName = new Map<string, number>();
  for (const item of sources) {
    const normName = item.name.trim().toLowerCase();
    const existingIdx = sourceIndexByName.get(normName);
    if (existingIdx === undefined) {
      sourceIndexByName.set(normName, dedupedSources.length);
      dedupedSources.push(item);
    } else {
      const existing = dedupedSources[existingIdx];
      const itemRank = sourceStatusRank[item.status];
      const existingRank = sourceStatusRank[existing.status];
      const itemScore = Number(item.score) || 0;
      const existingScore = Number(existing.score) || 0;
      const itemHasLink = (item.url ? 1 : 0) + (item.doi ? 1 : 0);
      const existingHasLink = (existing.url ? 1 : 0) + (existing.doi ? 1 : 0);
      const itemIsBetter =
        itemRank > existingRank ||
        (itemRank === existingRank &&
          (itemScore > existingScore ||
            (itemScore === existingScore &&
              (item.matchedFields.length > existing.matchedFields.length ||
                (item.matchedFields.length === existing.matchedFields.length &&
                  itemHasLink > existingHasLink)))));
      const winner = itemIsBetter ? item : existing;
      const loser = itemIsBetter ? existing : item;
      const mergedFields =
        winner.status !== 'not_found' && loser.status !== 'not_found'
          ? Array.from(new Set([...winner.matchedFields, ...loser.matchedFields]))
          : winner.matchedFields;
      dedupedSources[existingIdx] = {
        ...winner,
        matchedFields: mergedFields,
        url: winner.url ?? (loser.status !== 'not_found' ? loser.url : undefined),
        doi: winner.doi ?? (loser.status !== 'not_found' ? loser.doi : undefined),
      };
    }
  }

  const verdictVisual = getVerdictBadgeVisuals(
    verdict.label,
    verdict.triggered_rules,
    lang
  );
  const mappingVisual = getMappingBadgeVisuals(verdict.mapping_status, lang);
  const linkBadge = getLinkBadgeVisuals(verdict, lang);

  return {
    verdict,
    index,
    marker,
    inText: inTextDisplay,
    pageLabel,
    verdictText: verdictVisual.text,
    verdictBadgeClass: verdictVisual.badgeClass,
    mappingText: mappingVisual.text,
    mappingBadgeClass: mappingVisual.badgeClass,
    linkBadge,
    confidencePct: Math.round((verdict.confidence ?? 0) * 100),
    citedMeta,
    retrievedMeta,
    fieldStatus: {
      title: computeTitleStatus(),
      authors: computeAuthorsStatus(),
      year: computeYearStatus(),
      venue: computeVenueStatus(),
      doi: computeDoiStatus(),
      url: computeUrlStatus(),
    },
    contextBefore,
    contextHighlight,
    contextAfter,
    explanationText,
    rules,
    sources: dedupedSources,
  };
}

/* ============================================================
   SourceLogic — Real Interactive Citation Debugger IDE Page
   ============================================================ */

/**
 * Resolve a `?citation=` deep-link value against report verdicts. Accepts the
 * report citation id (`v123`) or the raw DB verdict id (`123`) that teacher
 * endpoints such as pending-reviews return.
 */
export function findVerdictByCitationParam(
  verdicts: Verdict[],
  param: string | null | undefined,
): Verdict | undefined {
  if (!param) return undefined;
  const raw = param.trim();
  if (!raw) return undefined;
  const bare = raw.replace(/^v/i, '');
  return (
    verdicts.find((v) => v.citation_id === raw) ||
    verdicts.find((v) => v.citation_id === `v${bare}`) ||
    verdicts.find((v) => v.citation_id.replace(/^v/i, '') === bare)
  );
}

export function EssayPage() {
  const { t, i18n } = useTranslation();
  const { has } = useRole();
  const canViewDeepTrace = has('view_logic_trace');
  const canOverride = has('override_verdict');
  const lang: 'vi' | 'en' = i18n.language?.startsWith('vi') ? 'vi' : 'en';

  const { id } = useParams<{ id: string }>();
  const numericId = id ? parseInt(id, 10) : null;
  const essayId =
    numericId !== null && !Number.isNaN(numericId) && numericId > 0
      ? numericId
      : null;

  const { data: report, isLoading, error } = useEssayReport(essayId);
  const overrideMutation = useOverrideVerdict();
  const toast = useToast();

  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();

  const resolveInitialMode = (): ReportWorkspaceMode => {
    if (location.pathname.endsWith('/document') && has('view_document_inspector')) {
      return 'document';
    }
    if (location.pathname.endsWith('/consistency') && has('view_orphan_detection')) {
      return 'consistency';
    }
    const viewParam = searchParams.get('view');
    if (viewParam === 'document' && has('view_document_inspector')) return 'document';
    if (viewParam === 'consistency' && has('view_orphan_detection')) return 'consistency';
    if (viewParam === 'graph' && canViewDeepTrace) return 'graph';
    return 'debugger';
  };

  const resolveInitialFilter = (): string =>
    location.pathname.endsWith('/issues') || searchParams.get('filter') === 'issues'
      ? 'issues'
      : 'all';

  const resolveInitialTraceFocus = (): boolean =>
    Boolean(
      canViewDeepTrace &&
        (location.pathname.endsWith('/trace') || searchParams.get('drawer') === 'trace'),
    );

  const [selectedCitationId, setSelectedCitationId] = useState<string | null>(null);
  const [filterLabel, setFilterLabel] = useState<string>(resolveInitialFilter);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [sortBy, setSortBy] = useState<'priority' | 'index_asc' | 'index_desc' | 'author_asc'>('priority');
  const [workspaceMode, setWorkspaceMode] = useState<ReportWorkspaceMode>(resolveInitialMode);
  const handleChangeWorkspaceMode = (nextMode: ReportWorkspaceMode) => {
    setWorkspaceMode(nextMode);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (nextMode === 'debugger') {
          next.delete('view');
        } else {
          next.set('view', nextMode);
        }
        return next;
      },
      { replace: true },
    );
  };
  const handleChangeFilterLabel = (nextFilter: string) => {
    setFilterLabel(nextFilter);
    if (nextFilter !== 'issues' && searchParams.has('filter')) {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.delete('filter');
          return next;
        },
        { replace: true },
      );
    }
  };
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [lockedFeatureName, setLockedFeatureName] = useState<string>('');
  const [remediationOpen, setRemediationOpen] = useState(false);
  const [deepDrawerOpen, setDeepDrawerOpen] = useState<boolean>(resolveInitialTraceFocus);
  const [deepTab, setDeepTab] = useState<'sources' | 'content' | 'steps' | 'graph'>(() =>
    resolveInitialTraceFocus() ? 'steps' : 'sources',
  );
  const [customRevisionDiff, setCustomRevisionDiff] = useState<RevisionDiffData | null>(null);
  const [revisionExpanded, setRevisionExpanded] = useState(false);
  const [mobileRevisionOpen, setMobileRevisionOpen] = useState(false);
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const [loadingRevisionDiff, setLoadingRevisionDiff] = useState(false);
  const isBelowLg = useIsBelowLg();
  const prevEssayIdRef = useRef<number | null>(essayId);
  const { containerRef: queueFilterPillRef, pillStyle: queueFilterPill } =
    useSlidingPill<HTMLDivElement>(
      `${filterLabel}-${lang}-${workspaceMode}-${report?.verdicts?.length ?? 0}`,
    );

  useEffect(() => {
    if (prevEssayIdRef.current === essayId) return;
    prevEssayIdRef.current = essayId;
    const nextTraceFocus = resolveInitialTraceFocus();
    setWorkspaceMode(resolveInitialMode());
    setFilterLabel(resolveInitialFilter());
    setSelectedCitationId(null);
    setSearchQuery('');
    setCustomRevisionDiff(null);
    setRevisionExpanded(false);
    setMobileRevisionOpen(false);
    setMobileDetailOpen(false);
    setDeepDrawerOpen(nextTraceFocus);
    setDeepTab(nextTraceFocus ? 'steps' : 'sources');
  }, [essayId]);

  const handleCompareRevisionChange = async (targetPrevId: number) => {
    if (!essayId || !targetPrevId) return;
    setLoadingRevisionDiff(true);
    try {
      const diff = await api.getRevisionDiff(essayId, targetPrevId);
      setCustomRevisionDiff(diff);
    } catch {
      // keep existing diff
    } finally {
      setLoadingRevisionDiff(false);
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (mobileDetailOpen) {
        setMobileDetailOpen(false);
        return;
      }
      if (
        upgradeOpen ||
        remediationOpen ||
        Boolean(
          document.querySelector(
            '[role="dialog"]:not([aria-hidden="true"]), [data-testid="bibliography-remediation-modal"], [data-testid="upgrade-modal"]',
          ),
        )
      ) {
        return;
      }
      setSelectedCitationId(null);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [upgradeOpen, remediationOpen, mobileDetailOpen]);

  // Deep link: /verification/report/:id?citation=<verdict id> (e.g. from the
  // teacher Pending Reviews queue) selects and scrolls to that citation once.
  const citationParam = searchParams.get('citation');
  const appliedCitationParamRef = useRef<string | null>(null);
  useEffect(() => {
    if (!report || !citationParam) return;
    const key = `${report.essay_id}:${citationParam}`;
    if (appliedCitationParamRef.current === key) return;
    const target = findVerdictByCitationParam(report.verdicts, citationParam);
    if (!target) return;
    appliedCitationParamRef.current = key;
    if (searchParams.get('filter') !== 'issues' || !isActionableIssueVerdict(target)) {
      setFilterLabel('all');
    }
    setSearchQuery('');
    setSelectedCitationId(target.citation_id);
    if (!searchParams.get('view')) {
      setWorkspaceMode('debugger');
      const scroll = () => {
        const el = Array.from(
          document.querySelectorAll<HTMLElement>('[data-citation-id]'),
        ).find((node) => node.dataset.citationId === target.citation_id);
        if (el && typeof el.scrollIntoView === 'function') {
          el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }
        el?.focus?.({ preventScroll: true });
      };
      requestAnimationFrame(() => requestAnimationFrame(scroll));
    }
  }, [report, citationParam, searchParams]);

  const rawErrorMessage =
    essayId === null
      ? t('essay.invalidEssayId')
      : error
        ? error instanceof Error
          ? error.message
          : t('essay.failedLoadReport')
        : null;

  const friendlyErrorMessage =
    essayId === null
      ? t('essay.invalidEssayId')
      : error
        ? formatUserError(error, lang)
        : null;

  const enrichedItems = useMemo(() => {
    if (!report) return [];
    const isPdfDocument = /\.pdf$/i.test(report.filename ?? '');
    return (report.verdicts ?? []).map((v, idx) =>
      enrichVerdictItem(
        v,
        idx,
        report.references ?? [],
        report.extracted_citations ?? [],
        lang,
        isPdfDocument,
      )
    );
  }, [report, lang]);

  const filteredItems = useMemo(() => {
    const verdictPriority = (label: ValidationLabel): number => {
      if (label === 'suspected_hallucination') return 0;
      if (label === 'metadata_error') return 1;
      if (label === 'unresolved') return 2;
      if (label === 'verified') return 3;
      return 4;
    };

    return enrichedItems
      .filter((item) => {
        if (filterLabel === 'issues') {
          if (!isActionableIssueVerdict(item.verdict)) {
            return false;
          }
        } else if (filterLabel !== 'all') {
          if (getEffectiveVerdictKey(item.verdict) !== filterLabel) {
            return false;
          }
        }
        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase();
          return (
            item.citedMeta.title.toLowerCase().includes(q) ||
            item.citedMeta.authors.toLowerCase().includes(q) ||
            item.inText.toLowerCase().includes(q) ||
            item.verdict.citation_raw.toLowerCase().includes(q) ||
            item.marker.toLowerCase().includes(q)
          );
        }
        return true;
      })
      .sort((a, b) => {
        if (sortBy === 'index_asc') return a.index - b.index;
        if (sortBy === 'index_desc') return b.index - a.index;
        if (sortBy === 'author_asc') {
          return a.inText.localeCompare(b.inText) || a.index - b.index;
        }
        return (
          verdictPriority(a.verdict.label) - verdictPriority(b.verdict.label) ||
          a.index - b.index
        );
      });
  }, [enrichedItems, filterLabel, searchQuery, sortBy]);

  async function handleOverride(
    verdict: Verdict,
    req: Parameters<typeof api.overrideVerdict>[1]
  ) {
    const targetEssayId = report?.essay_id ?? essayId ?? 0;
    await overrideMutation.mutateAsync({
      essayId: targetEssayId,
      verdictId: verdict.citation_id,
      req,
    });
  }

  const localizeFieldBadgeLabel = (rawLabel?: string, fallbackEn = ''): string => {
    const label = rawLabel || fallbackEn;
    const simMatch = label.match(/^(\d+)%\s*(?:Sim|Match)$/i);
    if (simMatch) {
      return lang === 'vi' ? `Khớp ${simMatch[1]}%` : `${simMatch[1]}% Match`;
    }
    if (lang !== 'vi') {
      const mapEn: Record<string, string> = {
        '100% Match': 'Exact Match',
        Match: 'Match',
        Partial: 'Partial',
        Diff: 'Mismatch',
        Mismatch: 'Mismatch',
        Missing: 'Missing',
        '— Missing': '— Missing',
        Provided: 'Provided',
        'Web Resource': 'Web Page',
        'Web Page': 'Web Page',
        'Wrong Page': 'Wrong Page',
        Checked: 'Checked',
        Indexed: 'Found',
        Retrieved: 'Found',
        'Wayback Archived': 'Web Archive',
        'Fake Domain': 'Invalid Link',
        'Invalid Domain': 'Invalid Link',
        'Link Active': 'Link Active',
        'Restricted Access': 'Restricted Access',
        'Broken Link': 'Broken Link',
        'Verified Link': 'Verified Link',
        'Resolved URL': 'Found Link',
        Preprint: 'Preprint',
        'Preprint DOI': 'Preprint',
        Unverified: 'Unverified',
      };
      return mapEn[label] ?? label;
    }
    const mapVi: Record<string, string> = {
      '100% Match': 'Khớp 100%',
      Match: 'Khớp',
      Partial: 'Khớp một phần',
      Diff: 'Sai lệch',
      Mismatch: 'Sai lệch',
      Missing: 'Thiếu',
      '— Missing': '— Thiếu',
      Provided: 'Đã ghi',
      'Web Resource': 'Nguồn web',
      'Web Page': 'Nguồn web',
      'Wrong Page': 'Sai nội dung trang',
      Checked: 'Đã kiểm tra',
      Indexed: 'Đã tìm thấy',
      Retrieved: 'Đã tìm thấy',
      'Đã trích xuất': 'Đã tìm thấy',
      'Wayback Archived': 'Bản lưu trữ web',
      'Fake Domain': 'Liên kết không hợp lệ',
      'Invalid Domain': 'Liên kết không hợp lệ',
      'Link Active': 'Liên kết hoạt động',
      'Restricted Access': 'Truy cập hạn chế',
      'Broken Link': 'Liên kết hỏng',
      'Verified Link': 'Liên kết hợp lệ',
      'Resolved URL': 'Liên kết tìm được',
      Preprint: 'Bản thảo chưa xuất bản',
      'Preprint DOI': 'Bản thảo chưa xuất bản',
      Unverified: 'Chưa xác minh',
    };
    return mapVi[label] ?? label;
  };

  const renderFieldStatusBadge = (fieldInfo: {
    status: FieldStatus;
    label?: string;
  }) => {
    switch (fieldInfo.status) {
      case 'match':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-sans font-semibold whitespace-nowrap shrink-0 bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
            <Check className="h-3 w-3 shrink-0" />{' '}
            {localizeFieldBadgeLabel(fieldInfo.label, 'Match')}
          </span>
        );
      case 'partial':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-sans font-semibold whitespace-nowrap shrink-0 bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
            <AlertTriangle className="h-3 w-3 shrink-0" />{' '}
            {localizeFieldBadgeLabel(fieldInfo.label, 'Partial')}
          </span>
        );
      case 'mismatch':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-sans font-semibold whitespace-nowrap shrink-0 bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300 border border-red-200 dark:border-red-800">
            <XCircle className="h-3 w-3 shrink-0" />{' '}
            {localizeFieldBadgeLabel(fieldInfo.label, 'Mismatch')}
          </span>
        );
      case 'missing': {
        const displayMissing = fieldInfo.label
          ? localizeFieldBadgeLabel(fieldInfo.label)
          : lang === 'vi'
            ? '— Thiếu'
            : '— Missing';
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-sans font-semibold whitespace-nowrap shrink-0 bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400 border border-slate-200 dark:border-slate-700">
            {displayMissing}
          </span>
        );
      }
    }
  };

  if (rawErrorMessage) {
    const statusCode = (error as { status?: number } | null)?.status;
    const isPipelineJobFailed =
      essayId !== null &&
      (statusCode === 409 ||
        /409|failed|thất bại|analysis failed|pipeline/i.test(rawErrorMessage));

    if (isPipelineJobFailed) {
      return (
        <div
          data-testid="essay-failed-analysis-card"
          className="rounded-2xl border border-red-200 dark:border-red-900/70 bg-white dark:bg-slate-900 p-6 sm:p-8 shadow-sm max-w-2xl mx-auto my-8"
        >
          <div className="flex items-start gap-4">
            <div className="h-12 w-12 rounded-2xl bg-red-50 dark:bg-red-950/70 border border-red-200 dark:border-red-800 flex items-center justify-center shrink-0">
              <AlertCircle className="h-6 w-6 text-red-600 dark:text-red-400" />
            </div>
            <div className="space-y-3 flex-1 min-w-0">
              <h2 className="font-display text-lg sm:text-xl font-bold text-slate-900 dark:text-slate-100">
                {lang === 'vi'
                  ? 'Phân tích tài liệu không thành công'
                  : 'Document Analysis Failed'}
              </h2>
              <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed break-words">
                {friendlyErrorMessage || rawErrorMessage}
              </p>
              <div className="flex flex-wrap items-center gap-3 pt-2">
                <Link
                  to="/upload"
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-sans font-semibold bg-indigo-600 hover:bg-indigo-700 text-white transition-colors"
                >
                  <ArrowUpRight className="h-4 w-4" />
                  {lang === 'vi' ? 'Tải lên lại' : 'Upload Again'}
                </Link>
                <Link
                  to="/history"
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-sans font-semibold bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 transition-colors"
                >
                  {lang === 'vi' ? 'Quay lại Lịch sử' : 'Back to History'}
                </Link>
              </div>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div
        data-testid="essay-error-card"
        className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 sm:p-8 shadow-sm max-w-2xl mx-auto my-8"
      >
        <div className="flex items-start gap-4">
          <div className="h-12 w-12 rounded-2xl bg-amber-50 dark:bg-amber-950/70 border border-amber-200 dark:border-amber-800 flex items-center justify-center shrink-0">
            <AlertCircle className="h-6 w-6 text-amber-600 dark:text-amber-400" />
          </div>
          <div className="space-y-3 flex-1 min-w-0">
            <h2 className="font-display text-lg sm:text-xl font-bold text-slate-900 dark:text-slate-100">
              {lang === 'vi' ? 'Không thể mở báo cáo' : 'Unable to Open Report'}
            </h2>
            <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed break-words">
              {friendlyErrorMessage}
            </p>
            <div className="flex flex-wrap items-center gap-3 pt-2">
              <Link
                to="/history"
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white transition-colors"
              >
                <ArrowLeft className="h-4 w-4" />
                {lang === 'vi' ? 'Về lịch sử báo cáo' : 'Back to History'}
              </Link>
              <Link
                to="/upload"
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 transition-colors"
              >
                {lang === 'vi' ? 'Tải lên tài liệu mới' : 'Upload New Document'}
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
        <span className="ml-3 text-slate-600 dark:text-slate-400">
          {isLoading ? t('essay.loadingReport') : t('essay.waitingForAnalysis')}
        </span>
      </div>
    );
  }

  // Pick active citation item (defaulting to first academic issue or [1])
  const defaultItem =
    filteredItems.find(
      (i) =>
        i.verdict.label === 'metadata_error' ||
        i.verdict.label === 'suspected_hallucination'
    ) ||
    filteredItems[0] ||
    enrichedItems[0];

  const activeItem =
    filteredItems.find((i) => i.verdict.citation_id === selectedCitationId) ||
    enrichedItems.find((i) => i.verdict.citation_id === selectedCitationId) ||
    defaultItem;

  const counts = computeReportBucketCounts(report.verdicts ?? []);

  const activeRevisionDiff = customRevisionDiff ?? report.revision_diff ?? null;
  const isSandboxManuscript = Boolean(
    report.filename &&
      (/^citra_acl_sandbox/i.test(report.filename) || /acl_sandbox/i.test(report.filename)),
  );
  const shouldShowRevisionDiff = Boolean(
    !isSandboxManuscript &&
      (activeRevisionDiff?.has_previous_revision ||
        Boolean((activeRevisionDiff as { has_previous?: boolean } | null)?.has_previous)) &&
      (customRevisionDiff !== null || activeRevisionDiff?.is_same_manuscript_family !== false),
  );
  const sameFamilyRevisions = (activeRevisionDiff?.available_revisions ?? []).filter(
    (rev) => rev.is_same_stem !== false && !/acl_sandbox/i.test(rev.filename),
  );
  const normalizeRevisionChangeKey = (raw?: string | null): string => {
    const cleaned = (raw || '').trim().toLowerCase();
    if (!cleaned || cleaned === 'none') return '';
    if (cleaned === 'removed' || cleaned === 'deleted') return 'removed';
    if (cleaned === 'added' || cleaned === 'new') return 'added';
    return normalizeVerdictKey(cleaned);
  };
  const isUnchangedRevisionEntry = (chg: {
    before_label?: string | null;
    after_label?: string | null;
  }): boolean => {
    const beforeKey = normalizeRevisionChangeKey(chg.before_label);
    const afterKey = normalizeRevisionChangeKey(chg.after_label);
    if (beforeKey && afterKey && beforeKey === afterKey) return true;
    const beforeLbl = formatRevisionVerdictLabel(chg.before_label, lang);
    const afterLbl = formatRevisionVerdictLabel(chg.after_label, lang);
    return Boolean(beforeLbl && beforeLbl !== '—' && beforeLbl === afterLbl);
  };
  const allRevisionChanges = activeRevisionDiff?.citation_changes ?? [];
  const actualRevisionChanges = allRevisionChanges.filter(
    (chg) => !isUnchangedRevisionEntry(chg),
  );
  const hasRevisionCountChanges = Boolean(
    activeRevisionDiff?.counts_before &&
      activeRevisionDiff?.counts_after &&
      ((activeRevisionDiff.counts_before.verified ?? 0) !==
        (activeRevisionDiff.counts_after.verified ?? 0) ||
        (activeRevisionDiff.counts_before.metadata_error ?? 0) !==
          (activeRevisionDiff.counts_after.metadata_error ?? 0) ||
        (activeRevisionDiff.counts_before.suspected_hallucination ?? 0) !==
          (activeRevisionDiff.counts_after.suspected_hallucination ?? 0) ||
        (activeRevisionDiff.counts_before.unresolved ?? 0) !==
          (activeRevisionDiff.counts_after.unresolved ?? 0)),
  );
  const isZeroChangeRevision = Boolean(
    activeRevisionDiff &&
      Math.abs(activeRevisionDiff.cis_delta ?? 0) < 0.05 &&
      (activeRevisionDiff.resolved_issues_count ?? 0) === 0 &&
      actualRevisionChanges.length === 0 &&
      (allRevisionChanges.length > 0 || (activeRevisionDiff.new_issues_count ?? 0) === 0) &&
      !hasRevisionCountChanges,
  );

  const isAbnormalMapping = (status?: string | null) =>
    Boolean(status && status !== 'matched');

  const getPrimarySourceExternalUrl = (item: EnrichedCitationItem): string | null => {
    const rawDoi =
      (item.retrievedMeta?.doi && item.retrievedMeta.doi !== '—'
        ? item.retrievedMeta.doi
        : '') ||
      item.verdict.matched_sources?.[0]?.doi ||
      '';
    const safeDoi = toSafeDoiHref(rawDoi);
    if (safeDoi) {
      return safeDoi;
    }
    return (
      toSafeExternalHref(item.retrievedMeta?.url) ??
      toSafeExternalHref(item.verdict.matched_sources?.[0]?.url) ??
      toSafeExternalHref(item.citedMeta.url)
    );
  };

  const handleCopyFormattedCitation = async (item: EnrichedCitationItem) => {
    const cleanField = (val?: string | null) =>
      val &&
      val !== '—' &&
      val !== 'Trang web không ghi thông tin này' &&
      val !== 'Not listed on this web page' &&
      val !== 'Trang web không khai báo thẻ này' &&
      val !== 'Not declared in page metadata'
        ? val.trim()
        : '';
    const authors =
      cleanField(item.retrievedMeta?.authors) || cleanField(item.citedMeta.authors);
    const year = cleanField(item.retrievedMeta?.year) || cleanField(item.citedMeta.year);
    const title = cleanField(item.retrievedMeta?.title) || cleanField(item.citedMeta.title);
    const venue = cleanField(item.retrievedMeta?.venue) || cleanField(item.citedMeta.venue);
    const doi = cleanField(item.retrievedMeta?.doi) || cleanField(item.citedMeta.doi);

    const parts: string[] = [item.marker];
    if (authors) parts.push(year ? `${authors} (${year}).` : `${authors}.`);
    else if (year) parts.push(`(${year}).`);
    if (title) parts.push(`${title.replace(/\.+$/, '')}.`);
    if (venue) parts.push(`${venue.replace(/\.+$/, '')}.`);
    if (doi) {
      parts.push(
        doi.startsWith('http') ? doi : `https://doi.org/${doi.replace(/^doi:\s*/i, '')}`,
      );
    }
    const formatted = parts.join(' ').trim() || item.verdict.citation_raw;
    await copyTextToClipboard(formatted);
    toast.success(
      lang === 'vi' ? 'Đã sao chép trích dẫn chuẩn' : 'Copied formatted citation',
      formatted,
    );
  };

  const docDiag = report.document_diagnostics;
  const isScannedPdfDetected = isReportUnscannable(report);
  const scannedPdfNoticeObj = getScannedPdfNotice(
    lang,
    docDiag?.scanned_pages_count ?? report.num_pages,
    report.num_pages,
  );
  const scannedPdfNotice =
    lang === 'en'
      ? (docDiag as { warning_message_en?: string } | undefined)?.warning_message_en ||
        scannedPdfNoticeObj.description
      : (docDiag as { warning_message_vi?: string } | undefined)?.warning_message_vi ||
        scannedPdfNoticeObj.description;

  return (
    <div className="space-y-3.5 pb-10">
      {/* Zone 1: Compact Document Topbar */}
      <EssayHeader
        essayId={report.essay_id}
        filename={report.filename}
        numPages={report.num_pages}
        numCitations={report.num_citations}
        numReferences={report.verdicts.length}
        styleName={formatCitationStyleLabel(report.style_profile?.style, lang)}
        onOpenRemediation={() => setRemediationOpen(true)}
      />

      {/* Legacy Vietnamese Font & Scanned-Page Text Recovery Notices */}
      {(Boolean(docDiag?.legacy_encoding_detected) ||
        (docDiag?.ocr_pages_recovered?.length ?? 0) > 0) && (
        <div
          data-testid="essay-doc-diagnostics-banner"
          className="flex flex-wrap items-center gap-2.5"
        >
          {docDiag?.legacy_encoding_detected && (
            <div
              data-testid="legacy-encoding-diagnostic-pill"
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs bg-indigo-50/90 dark:bg-indigo-950/60 border border-indigo-200 dark:border-indigo-800 text-indigo-800 dark:text-indigo-200"
            >
              <Sparkles className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400 shrink-0" />
              <span>
                {lang === 'vi'
                  ? 'Đã tự động chuyển đổi phông chữ tiếng Việt cũ sang chuẩn hiện đại để đọc chính xác hơn.'
                  : 'Automatically converted legacy Vietnamese fonts so citations could be read accurately.'}
              </span>
            </div>
          )}
          {(docDiag?.ocr_pages_recovered?.length ?? 0) > 0 && (
            <div
              data-testid="ocr-recovery-diagnostic-pill"
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs bg-emerald-50/90 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200"
            >
              <FileText className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <span>
                {lang === 'vi'
                  ? `Đã tự động nhận dạng chữ từ các trang dạng ảnh (trang ${docDiag!.ocr_pages_recovered!.join(', ')}).`
                  : `Automatically extracted text from scanned pages (pages ${docDiag!.ocr_pages_recovered!.join(', ')}).`}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Scanned / Image-Only PDF Diagnostic Guardrail Banner */}
      {isScannedPdfDetected && (
        <div
          data-testid="scanned-pdf-guardrail-banner"
          className="rounded-2xl border-2 border-amber-400/80 dark:border-amber-600/80 bg-gradient-to-r from-amber-50 via-orange-50/70 to-amber-50 dark:from-amber-950/70 dark:via-slate-900 dark:to-amber-950/60 p-5 shadow-md"
        >
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-start gap-3.5">
              <div className="h-11 w-11 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center shrink-0 mt-0.5">
                <AlertTriangle className="h-6 w-6 text-amber-600 dark:text-amber-400" />
              </div>
              <div className="space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="px-2.5 py-0.5 rounded-md text-[11px] font-bold bg-amber-600 text-white uppercase tracking-wider">
                    {lang === 'vi' ? 'PDF dạng ảnh quét' : 'Scanned PDF'}
                  </span>
                  <h3 className="text-sm sm:text-base font-bold text-amber-950 dark:text-amber-100">
                    {lang === 'vi'
                      ? 'Không thể đọc chữ trong tệp PDF này (dạng ảnh quét)'
                      : 'This PDF appears to be scanned images and cannot be read'}
                  </h3>
                </div>
                <p className="text-xs sm:text-sm text-amber-900/90 dark:text-amber-200/90 leading-relaxed max-w-3xl">
                  {scannedPdfNotice}
                </p>
                <div className="flex flex-wrap items-center gap-3 pt-1 text-xs text-amber-800 dark:text-amber-300">
                  <span>
                    • {lang === 'vi' ? 'Số trang dạng ảnh quét' : 'Scanned pages'}:{' '}
                    <strong>
                      {docDiag?.scanned_pages_count ?? report.num_pages}/{report.num_pages}
                    </strong>
                  </span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Link
                to="/upload"
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-amber-600 hover:bg-amber-700 text-white shadow-sm transition-colors"
              >
                <ArrowUpRight className="h-4 w-4" />
                {lang === 'vi'
                  ? 'Tải lên tệp Word (.docx) hoặc PDF gốc'
                  : 'Upload Word (.docx) or Text PDF'}
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* Slim Revision Progress Banner (Collapsed to 1-line pill by default on Mobile < md) */}
      {shouldShowRevisionDiff && activeRevisionDiff && !isZeroChangeRevision && (
        <div
          data-testid="revision-diff-banner"
          data-quiet-unchanged="false"
          className="rounded-2xl border border-indigo-200/90 dark:border-indigo-800/80 bg-gradient-to-r from-emerald-50/80 via-white to-indigo-50/70 dark:from-emerald-950/30 dark:via-slate-900 dark:to-indigo-950/40 px-4 py-2.5 md:py-3 shadow-sm overflow-hidden"
        >
          {/* Compact 1-Line Mobile Summary Pill (< md) */}
          <button
            type="button"
            data-testid="mobile-revision-diff-toggle"
            aria-expanded={mobileRevisionOpen}
            onClick={() => setMobileRevisionOpen((v) => !v)}
            className="md:hidden w-full flex items-center justify-between gap-2 text-left text-xs cursor-pointer"
          >
            <span className="inline-flex items-center gap-2 min-w-0">
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-600 text-white shrink-0">
                <GitBranch className="h-3 w-3" />
                {lang === 'vi' ? 'Bản trước → Bản này' : 'Previous draft → Current draft'}
              </span>
              <span className="font-semibold text-slate-800 dark:text-slate-200 truncate">
                {formatCisScore(activeRevisionDiff.cis_before ?? 0)} →{' '}
                {formatCisScore(activeRevisionDiff.cis_after ?? report.cis.score)} (
                {(activeRevisionDiff.cis_delta ?? 0) >= 0
                  ? `+${(activeRevisionDiff.cis_delta ?? 0).toFixed(1)}`
                  : `${(activeRevisionDiff.cis_delta ?? 0).toFixed(1)}`}
                )
              </span>
            </span>
            <span className="inline-flex items-center gap-1 text-indigo-600 dark:text-indigo-400 font-semibold shrink-0">
              <span>{mobileRevisionOpen ? (lang === 'vi' ? 'Ẩn' : 'Hide') : (lang === 'vi' ? 'Xem' : 'View')}</span>
              <SymmetricChevron open={mobileRevisionOpen} size={13} />
            </span>
          </button>

          <div
            className={`${
              mobileRevisionOpen ? 'flex mt-2.5 pt-2.5 border-t border-indigo-200/60 dark:border-indigo-800/60' : 'hidden'
            } md:flex flex-col lg:flex-row lg:items-center justify-between gap-3 min-w-0`}
          >
            <div className="flex flex-wrap items-center gap-2.5 min-w-0 text-xs sm:text-[13px]">
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-indigo-600 text-white">
                <GitBranch className="h-3 w-3 shrink-0" />
                {lang === 'vi' ? 'Bản trước → Bản này' : 'Previous draft → Current draft'}
              </span>
              <span className="text-slate-700 dark:text-slate-300">
                {lang === 'vi' ? 'So sánh với bản trước:' : 'Compared with previous draft:'}{' '}
                <strong className="text-slate-900 dark:text-white">
                  {activeRevisionDiff.previous_filename}
                </strong>
              </span>

              {sameFamilyRevisions.length > 1 && (
                <select
                  data-testid="revision-compare-select"
                  aria-label={
                    lang === 'vi'
                      ? 'Chọn bản trước để so sánh'
                      : 'Select previous draft to compare'
                  }
                  value={activeRevisionDiff.previous_essay_id ?? ''}
                  disabled={loadingRevisionDiff}
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    if (val) void handleCompareRevisionChange(val);
                  }}
                  className="max-w-[240px] truncate text-xs px-2 py-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200"
                >
                  {sameFamilyRevisions.map((rev) => (
                    <option key={rev.essay_id} value={rev.essay_id}>
                      {rev.filename.length > 22 ? `${rev.filename.slice(0, 20)}...` : rev.filename}{' '}
                      ({formatCisScore(rev.cis_score)})
                    </option>
                  ))}
                </select>
              )}

              {/* Compact CIS Delta */}
              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs">
                <span className="text-slate-600 dark:text-slate-300">
                  {formatCisScore(activeRevisionDiff.cis_before ?? 0)} →{' '}
                  <strong className="text-indigo-600 dark:text-indigo-400">
                    {formatCisScore(activeRevisionDiff.cis_after ?? report.cis.score)}
                  </strong>
                </span>
                <span
                  data-testid="revision-cis-delta-badge"
                  className={`px-1.5 py-0.5 rounded font-bold text-[11px] ${
                    (activeRevisionDiff.cis_delta ?? 0) > 0
                      ? 'text-emerald-700 bg-emerald-500/10 dark:text-emerald-300 dark:bg-emerald-950'
                      : (activeRevisionDiff.cis_delta ?? 0) < 0
                        ? 'text-rose-700 bg-rose-500/10 dark:text-rose-300 dark:bg-rose-950'
                        : 'text-slate-600 bg-slate-500/10 dark:text-slate-300 dark:bg-slate-800'
                  }`}
                >
                  {(activeRevisionDiff.cis_delta ?? 0) >= 0
                    ? `+${(activeRevisionDiff.cis_delta ?? 0).toFixed(1)}`
                    : `${(activeRevisionDiff.cis_delta ?? 0).toFixed(1)}`}
                </span>
              </div>

              {(activeRevisionDiff.resolved_issues_count ?? 0) > 0 && (
                <div className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-50/90 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 text-xs text-emerald-800 dark:text-emerald-300">
                  <Check className="h-3.5 w-3.5 text-emerald-600" />
                  <span>
                    {lang === 'vi' ? 'Đã khắc phục:' : 'Resolved:'}{' '}
                    <strong>{activeRevisionDiff.resolved_issues_count}</strong>
                  </span>
                </div>
              )}

              {activeRevisionDiff.counts_before &&
                activeRevisionDiff.counts_after &&
                (() => {
                  const beforeVerified = activeRevisionDiff.counts_before.verified ?? 0;
                  const afterVerified = activeRevisionDiff.counts_after.verified ?? 0;
                  const deltaVerified = afterVerified - beforeVerified;
                  const beforeMeta = activeRevisionDiff.counts_before.metadata_error ?? 0;
                  const afterMeta = activeRevisionDiff.counts_after.metadata_error ?? 0;
                  const deltaMeta = afterMeta - beforeMeta;
                  const beforeHallu =
                    activeRevisionDiff.counts_before.suspected_hallucination ?? 0;
                  const afterHallu =
                    activeRevisionDiff.counts_after.suspected_hallucination ?? 0;
                  const deltaHallu = afterHallu - beforeHallu;
                  const beforeUnres = activeRevisionDiff.counts_before.unresolved ?? 0;
                  const afterUnres = activeRevisionDiff.counts_after.unresolved ?? 0;
                  const deltaUnres = afterUnres - beforeUnres;

                  const getErrorDeltaBadgeClass = (delta: number) =>
                    delta < 0
                      ? 'text-emerald-700 bg-emerald-500/10 dark:text-emerald-300'
                      : delta > 0
                        ? 'text-rose-700 bg-rose-500/10 dark:text-rose-300'
                        : 'text-slate-600 bg-slate-500/10 dark:text-slate-400';

                  const getVerifiedDeltaBadgeClass = (delta: number) =>
                    delta > 0
                      ? 'text-emerald-700 bg-emerald-500/10 dark:text-emerald-300'
                      : delta < 0
                        ? 'text-rose-700 bg-rose-500/10 dark:text-rose-300'
                        : 'text-slate-600 bg-slate-500/10 dark:text-slate-400';

                  const formatSignedDelta = (delta: number) =>
                    delta > 0 ? `+${delta}` : `${delta}`;

                  return (
                    <>
                      {deltaVerified !== 0 && (
                        <div className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-700 dark:text-slate-300">
                          <span>{lang === 'vi' ? 'Đã xác minh:' : 'Verified:'}</span>
                          <strong>{afterVerified}</strong>
                          <span
                            data-testid="revision-delta-verified"
                            className={`px-1.5 py-0.5 rounded font-bold text-[11px] ${getVerifiedDeltaBadgeClass(deltaVerified)}`}
                          >
                            {formatSignedDelta(deltaVerified)}
                          </span>
                        </div>
                      )}
                      {deltaMeta !== 0 && (
                        <div className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-700 dark:text-slate-300">
                          <span>{lang === 'vi' ? 'Sai lệch thông tin:' : 'Details Mismatch:'}</span>
                          <strong>{afterMeta}</strong>
                          <span
                            data-testid="revision-delta-metadata_error"
                            className={`px-1.5 py-0.5 rounded font-bold text-[11px] ${getErrorDeltaBadgeClass(deltaMeta)}`}
                          >
                            {formatSignedDelta(deltaMeta)}
                          </span>
                        </div>
                      )}
                      {deltaHallu !== 0 && (
                        <div className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-700 dark:text-slate-300">
                          <span>{lang === 'vi' ? 'Không thấy nguồn:' : 'Not Found:'}</span>
                          <strong>{afterHallu}</strong>
                          <span
                            data-testid="revision-delta-suspected_hallucination"
                            className={`px-1.5 py-0.5 rounded font-bold text-[11px] ${getErrorDeltaBadgeClass(deltaHallu)}`}
                          >
                            {formatSignedDelta(deltaHallu)}
                          </span>
                        </div>
                      )}
                      {deltaUnres !== 0 && (
                        <div className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-700 dark:text-slate-300">
                          <span>{lang === 'vi' ? 'Chưa đủ dữ liệu:' : 'Unverified:'}</span>
                          <strong>{afterUnres}</strong>
                          <span
                            data-testid="revision-delta-unresolved"
                            className={`px-1.5 py-0.5 rounded font-bold text-[11px] ${getErrorDeltaBadgeClass(deltaUnres)}`}
                          >
                            {formatSignedDelta(deltaUnres)}
                          </span>
                        </div>
                      )}
                    </>
                  );
                })()}
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                data-testid="revision-diff-details-btn"
                aria-expanded={revisionExpanded}
                onClick={() => setRevisionExpanded((v) => !v)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-white dark:bg-slate-800 border border-indigo-200 dark:border-indigo-700 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50 transition-colors cursor-pointer"
              >
                <span>
                  {revisionExpanded
                    ? lang === 'vi'
                      ? 'Thu gọn chi tiết'
                      : 'Hide Changes'
                    : lang === 'vi'
                      ? 'Xem chi tiết thay đổi'
                      : 'View Changes'}
                </span>
                <SymmetricChevron open={revisionExpanded} size={14} />
              </button>
              <Link
                to={`/verification/report/${activeRevisionDiff.previous_essay_id}`}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-medium bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:text-indigo-600 transition-colors"
              >
                {lang === 'vi' ? 'Mở bản trước' : 'Open previous draft'}
                <ArrowUpRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          </div>

          <AccordionExpand open={revisionExpanded}>
            <div
              data-testid="revision-diff-details-panel"
              className="mt-3 pt-3 border-t border-indigo-200/70 dark:border-indigo-800/60 space-y-2.5"
            >
              {actualRevisionChanges.length === 0 && (
                <p className="text-xs font-medium text-emerald-700 dark:text-emerald-300">
                  {lang === 'vi'
                    ? 'Không phát sinh lỗi mới so với bản trước.'
                    : 'No new issues compared to the previous draft.'}
                </p>
              )}
              {allRevisionChanges.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 max-h-60 overflow-y-auto pr-1">
                  {allRevisionChanges.map((chg, idx) => {
                    const extChg = chg as typeof chg & {
                      composite_label?: string | null;
                    };
                    const rawComposite = (extChg.composite_label || '').trim();
                    const compositeBadge = rawComposite
                      ? rawComposite.startsWith('[')
                        ? rawComposite
                        : `[${rawComposite}]`
                      : null;
                    const isUnchanged = isUnchangedRevisionEntry(chg);
                    const isGood =
                      !isUnchanged &&
                      (chg.transition === 'fixed' ||
                        chg.transition === 'removed_hallucination' ||
                        chg.transition === 'fixed_and_reformatted' ||
                        (chg.after_label === 'verified' && chg.before_label !== 'verified'));
                    const isRegression =
                      !isUnchanged &&
                      !isGood &&
                      (chg.after_label === 'suspected_hallucination' ||
                        chg.transition === 'regressed' ||
                        chg.transition === 'new_hallucination');
                    return (
                      <div
                        key={idx}
                        data-testid={`revision-change-item-${idx}`}
                        className={`p-3 rounded-xl border text-xs flex flex-col gap-1 ${
                          isUnchanged
                            ? 'bg-slate-50/80 dark:bg-slate-900/60 border-slate-200 dark:border-slate-700/70'
                            : isGood
                              ? 'bg-emerald-50/70 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800/70'
                              : isRegression
                                ? 'bg-rose-50/70 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800/70'
                                : 'bg-amber-50/70 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800/70'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2 font-semibold flex-wrap">
                          <span
                            className={
                              isUnchanged
                                ? 'text-slate-600 dark:text-slate-400'
                                : isGood
                                  ? 'text-emerald-700 dark:text-emerald-300'
                                  : isRegression
                                    ? 'text-rose-700 dark:text-rose-300'
                                    : 'text-amber-700 dark:text-amber-300'
                            }
                          >
                            {isUnchanged
                              ? lang === 'vi'
                                ? 'Chưa thay đổi'
                                : 'Unchanged'
                              : chg.transition === 'removed_hallucination'
                                ? lang === 'vi'
                                  ? '✓ Đã gỡ nguồn chưa xác minh'
                                  : '✓ Removed Unverified Source'
                                : isGood
                                  ? lang === 'vi'
                                    ? '✓ Đã sửa & xác minh'
                                    : '✓ Fixed & Verified'
                                  : isRegression
                                    ? lang === 'vi'
                                      ? '✕ Phát sinh lỗi mới'
                                      : '✕ New Issue Detected'
                                    : lang === 'vi'
                                      ? '⚠ Cần kiểm tra thêm'
                                      : '⚠ Needs Attention'}
                          </span>
                          <span className="text-[10px] px-2 py-0.5 rounded bg-white/80 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                            {(() => {
                              const rawBefore = (chg.before_label ?? '').trim();
                              const beforeLabelText = formatRevisionVerdictLabel(
                                chg.before_label,
                                lang,
                              );
                              const displayBefore =
                                !rawBefore ||
                                rawBefore === '—' ||
                                beforeLabelText === '—'
                                  ? lang === 'vi'
                                    ? 'Mới'
                                    : 'New'
                                  : beforeLabelText;
                              return `${displayBefore} → ${formatRevisionVerdictLabel(chg.after_label, lang)}`;
                            })()}
                          </span>
                        </div>
                        <p className="text-slate-700 dark:text-slate-300 line-clamp-2 text-[11.5px]">
                          {compositeBadge && (
                            <span
                              data-testid="revision-change-composite-marker"
                              className="inline-block font-mono font-bold text-indigo-700 dark:text-indigo-300 mr-1.5"
                            >
                              {compositeBadge}
                            </span>
                          )}
                          {compositeBadge &&
                          chg.citation_raw.trim().startsWith(compositeBadge)
                            ? chg.citation_raw.trim().slice(compositeBadge.length).trim()
                            : chg.citation_raw}
                        </p>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  {lang === 'vi'
                    ? `Không phát sinh lỗi mới so với bản trước (${activeRevisionDiff.previous_filename}).`
                    : `No new issues compared to the previous draft (${activeRevisionDiff.previous_filename}).`}
                </p>
              )}
            </div>
          </AccordionExpand>
        </div>
      )}

      {/* Zone 2: Unified Summary Health & Single-Purpose 4-Tab Navigation Bar */}
      <ReportSummaryAndNavBar
        essayId={id ?? String(report.essay_id)}
        report={report}
        activeLayer={workspaceMode}
        onChangeWorkspaceMode={handleChangeWorkspaceMode}
        onOpenLockedFeature={(featureName) => {
          setLockedFeatureName(featureName);
          setUpgradeOpen(true);
        }}
        quietRevisionSlot={
          shouldShowRevisionDiff && activeRevisionDiff && isZeroChangeRevision ? (
            <div
              data-testid="revision-diff-banner"
              data-quiet-unchanged="true"
              className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 sm:pl-3 sm:border-l border-slate-200 dark:border-slate-800"
            >
              <span>
                {lang === 'vi'
                  ? `Không phát sinh lỗi mới so với bản trước (${activeRevisionDiff.previous_filename})`
                  : `No new issues compared to the previous draft (${activeRevisionDiff.previous_filename})`}
              </span>
              {sameFamilyRevisions.length > 1 && (
                <select
                  data-testid="revision-compare-select"
                  aria-label={
                    lang === 'vi'
                      ? 'Chọn bản trước để so sánh'
                      : 'Select previous draft to compare'
                  }
                  value={activeRevisionDiff.previous_essay_id ?? ''}
                  disabled={loadingRevisionDiff}
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    if (val) void handleCompareRevisionChange(val);
                  }}
                  className="max-w-[180px] truncate text-xs px-1.5 py-0.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200"
                >
                  {sameFamilyRevisions.map((rev) => (
                    <option key={rev.essay_id} value={rev.essay_id}>
                      {rev.filename.length > 20 ? `${rev.filename.slice(0, 18)}...` : rev.filename}
                    </option>
                  ))}
                </select>
              )}
              <Link
                to={`/verification/report/${activeRevisionDiff.previous_essay_id}`}
                className="inline-flex items-center gap-0.5 font-medium text-indigo-600 dark:text-indigo-400 hover:underline"
              >
                <span>{lang === 'vi' ? 'Mở bản trước' : 'Open previous draft'}</span>
                <ArrowUpRight className="h-3 w-3" />
              </Link>
            </div>
          ) : null
        }
      />

      {/* Non-Accusatory Academic Decision-Support Disclaimer (BUG-03) */}
      <DecisionSupportBanner variant="compact" lang={lang} />

      {/* ============================================================
          Zone 3: Unified 4-View Stage (120fps Causal Directional Slide)
          ============================================================ */}
      <section>
        <DirectionalStageSlide
          stageKey={
            workspaceMode === 'debugger'
              ? 0
              : workspaceMode === 'document'
                ? 1
                : workspaceMode === 'consistency'
                  ? 2
                  : 3
          }
          distancePx={16}
          data-testid="report-view-stage"
        >
          {workspaceMode === 'document' && has('view_document_inspector') ? (
            <DocumentInspectorWorkspace
              essayId={id ?? String(report.essay_id)}
              report={report}
              embedded={true}
              onSelectVerdictInCitations={(cid) => {
                setSelectedCitationId(cid);
                handleChangeWorkspaceMode('debugger');
              }}
            />
          ) : workspaceMode === 'consistency' && has('view_orphan_detection') ? (
            <OrphanConsistencyWorkspace
              report={report}
              embedded={true}
              onSelectVerdictInCitations={(cid) => {
                setSelectedCitationId(cid);
                handleChangeWorkspaceMode('debugger');
              }}
            />
          ) : (
            <div className="rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-950 shadow-sm overflow-hidden">
              {enrichedItems.length === 0 ? (
                <div className="p-12 text-center bg-white dark:bg-slate-950">
                  <p className="text-sm font-medium text-slate-600 dark:text-slate-400">
                    {lang === 'vi'
                      ? 'Không phát hiện trích dẫn nào trong tài liệu này.'
                      : 'No citations were extracted from this document.'}
                  </p>
                </div>
              ) : workspaceMode === 'graph' && canViewDeepTrace ? (
                <CitationGraphView
                  verdicts={report.verdicts}
                  references={report.references}
                  linkingSummary={report.linking_summary}
                  selectedCitationId={selectedCitationId}
                  onSelect={(v) => {
                    setSelectedCitationId(v.citation_id);
                  }}
                  onInspectDetails={(v) => {
                    setSelectedCitationId(v.citation_id);
                    handleChangeWorkspaceMode('debugger');
                  }}
                  onOverride={canOverride ? handleOverride : undefined}
                />
              ) : (
                <div className="grid lg:grid-cols-12">
                  {/* Left Pane: Exception-First Citation Queue (5 cols) */}
                  <div className="citra-cq-citations-left lg:col-span-5 min-w-0 lg:relative lg:min-h-[680px] border-b lg:border-b-0 lg:border-r border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/40">
                    <div className="lg:absolute lg:inset-0 flex flex-col min-w-0">
                      {/* Sticky Search, Sort & Filter Header */}
                      <div className="p-3.5 sm:px-4 sm:py-3.5 border-b border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-2.5 shrink-0">
                        <div className="flex items-center gap-2">
                          <div className="relative flex-1">
                            <Search className="h-3.5 w-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                            <input
                              type="text"
                              value={searchQuery}
                              onChange={(e) => setSearchQuery(e.target.value)}
                              placeholder={
                                lang === 'vi'
                                  ? 'Tìm tên bài, tác giả, số [7]...'
                                  : 'Search by title, author, [#]...'
                              }
                              className="w-full pl-8 pr-3 py-1.5 text-xs sm:text-[13px] rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-200 placeholder:text-slate-400 focus:bg-white dark:focus:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                            />
                          </div>
                          {enrichedItems.length > 20 && (
                            <label className="inline-flex items-center gap-1 shrink-0">
                              <ArrowUpDown className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                              <select
                                data-testid="citation-queue-sort-select"
                                aria-label={lang === 'vi' ? 'Sắp xếp trích dẫn' : 'Sort citations'}
                                value={sortBy}
                                onChange={(e) =>
                                  setSortBy(
                                    e.target.value as
                                      | 'priority'
                                      | 'index_asc'
                                      | 'index_desc'
                                      | 'author_asc',
                                  )
                                }
                                className="text-[11px] font-medium px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                              >
                                <option value="priority">
                                  {lang === 'vi' ? 'Ưu tiên lỗi' : 'Priority'}
                                </option>
                                <option value="index_asc">
                                  {lang === 'vi' ? 'Thứ tự [1→N]' : 'Order [1→N]'}
                                </option>
                                <option value="index_desc">
                                  {lang === 'vi' ? 'Thứ tự [N→1]' : 'Order [N→1]'}
                                </option>
                                <option value="author_asc">
                                  {lang === 'vi' ? 'Tác giả A→Z' : 'Author A→Z'}
                                </option>
                              </select>
                            </label>
                          )}
                          <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 shrink-0 tabular-nums">
                            {lang === 'vi'
                              ? `${filteredItems.length} / ${enrichedItems.length} mục`
                              : `${filteredItems.length} of ${enrichedItems.length}`}
                          </span>
                        </div>

                        <div
                          ref={queueFilterPillRef}
                          className="t-tabs relative flex flex-wrap gap-1.5"
                        >
                          <span
                            aria-hidden="true"
                            style={{
                              width: `${queueFilterPill.width}px`,
                              height: `${queueFilterPill.height}px`,
                              transform: `translate3d(${queueFilterPill.left}px, ${queueFilterPill.top}px, 0)`,
                              opacity: queueFilterPill.ready ? 1 : 0,
                              transition: queueFilterPill.animate ? undefined : 'none',
                            }}
                            className="t-tabs-pill rounded-full bg-slate-900 dark:bg-white shadow-sm"
                          />
                          {(
                            [
                              [
                                'all',
                                lang === 'vi'
                                  ? `Tất cả (${counts.all})`
                                  : `All (${counts.all})`,
                              ],
                              ...(counts.actionableIssues > 0
                                ? [
                                    [
                                      'issues',
                                      lang === 'vi'
                                        ? `⚠ Cần xử lý (${counts.actionableIssues})`
                                        : `⚠ Issues (${counts.actionableIssues})`,
                                    ] as const,
                                  ]
                                : []),
                              ...(counts.suspected_hallucination > 0
                                ? [
                                    [
                                      'suspected_hallucination',
                                      `✕ ${getVerdictDisplay('suspected_hallucination', lang).label} (${counts.suspected_hallucination})`,
                                    ] as const,
                                  ]
                                : []),
                              ...(counts.metadata_error > 0
                                ? [
                                    [
                                      'metadata_error',
                                      `⚠ ${getVerdictDisplay('metadata_error', lang).label} (${counts.metadata_error})`,
                                    ] as const,
                                  ]
                                : []),
                              ...(counts.unresolved > 0
                                ? [
                                    [
                                      'unresolved',
                                      `— ${getVerdictDisplay('unresolved', lang).label} (${counts.unresolved})`,
                                    ] as const,
                                  ]
                                : []),
                              ...(counts.verified > 0
                                ? [
                                    [
                                      'verified',
                                      `✓ ${getVerdictDisplay('verified', lang).label} (${counts.verified})`,
                                    ] as const,
                                  ]
                                : []),
                              ...(counts.resource > 0
                                ? [
                                    [
                                      'resource',
                                      `↗ ${getVerdictDisplay('resource', lang).label} (${counts.resource})`,
                                    ] as const,
                                  ]
                                : []),
                            ] as const
                          ).map(([key, labelText]) => {
                            const isActive = filterLabel === key;
                            return (
                              <button
                                key={key}
                                type="button"
                                data-testid={`queue-filter-${key}`}
                                data-pill-active={isActive ? 'true' : 'false'}
                                onClick={() => handleChangeFilterLabel(key)}
                                className={`t-tab px-2.5 py-1 rounded-full text-[11px] font-semibold transition-colors border cursor-pointer ${
                                  isActive
                                    ? queueFilterPill.ready
                                      ? 'text-white dark:text-slate-900 border-transparent'
                                      : 'bg-slate-900 text-white border-slate-900 dark:bg-white dark:text-slate-900 dark:border-white'
                                    : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-800 hover:border-slate-300'
                                }`}
                              >
                                {labelText}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                  {/* Full-Height Citation Queue List */}
                  <div
                    className="flex-1 p-3 sm:p-3.5 space-y-2 min-h-0 max-h-[520px] lg:max-h-none overflow-y-auto"
                    role="listbox"
                    aria-label={lang === 'vi' ? 'Danh sách trích dẫn' : 'Citation list'}
                  >
                    {(() => {
                      const isAttentionItem = (it: EnrichedCitationItem) =>
                        it.verdict.label === 'suspected_hallucination' ||
                        it.verdict.label === 'metadata_error' ||
                        it.verdict.label === 'unresolved';
                      const attentionItems = filteredItems.filter(isAttentionItem);
                      const verifiedItems = filteredItems.filter(
                        (it) => it.verdict.label === 'verified',
                      );
                      const resourceItems = filteredItems.filter(
                        (it) => it.verdict.label === 'resource',
                      );
                      const activeGroupsCount =
                        (attentionItems.length > 0 ? 1 : 0) +
                        (verifiedItems.length > 0 ? 1 : 0) +
                        (resourceItems.length > 0 ? 1 : 0);
                      const showGroupHeaders =
                        filterLabel === 'all' &&
                        sortBy === 'priority' &&
                        activeGroupsCount > 1;

                      const renderQueueCard = (cit: EnrichedCitationItem) => {
                        const isSelected =
                          activeItem?.verdict.citation_id === cit.verdict.citation_id;
                        const isHallucination =
                          cit.verdict.label === 'suspected_hallucination';
                        const isMetadataError = cit.verdict.label === 'metadata_error';

                        return (
                          <button
                            key={cit.verdict.citation_id}
                            type="button"
                            role="option"
                            aria-selected={isSelected}
                            data-verdict-label={cit.verdict.label}
                            data-citation-id={cit.verdict.citation_id}
                            onClick={() => {
                              setSelectedCitationId(cit.verdict.citation_id);
                              if (isBelowLg) {
                                setMobileDetailOpen(true);
                              }
                            }}
                            className={`w-full text-left px-3.5 py-3 rounded-xl border transition-all duration-150 cursor-pointer ${
                              isSelected
                                ? 'bg-slate-50/95 dark:bg-slate-800/75 border-slate-300 dark:border-slate-600 shadow-[0_2px_10px_-3px_rgba(15,23,42,0.08)]'
                                : 'bg-white dark:bg-slate-900 border-slate-200/80 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 hover:bg-slate-50/40 dark:hover:bg-slate-800/40'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2 mb-1">
                              <div className="flex items-center gap-2 min-w-0">
                                <span
                                  className={`font-mono text-[11px] font-bold px-1.5 py-0.5 rounded-md shrink-0 transition-colors ${
                                    isHallucination
                                      ? 'bg-red-50 dark:bg-red-950/60 text-red-600 dark:text-red-400'
                                      : isMetadataError
                                        ? 'bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-400'
                                        : isSelected
                                          ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900 shadow-sm'
                                          : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200'
                                  }`}
                                >
                                  {cit.marker}
                                </span>
                                <span className="font-semibold text-[13px] text-slate-900 dark:text-white truncate">
                                  {cit.inText}
                                </span>
                              </div>
                              {cit.pageLabel && (
                                <span className="text-[11px] text-slate-400 shrink-0">
                                  {cit.pageLabel}
                                </span>
                              )}
                            </div>

                            <p className="text-xs text-slate-600 dark:text-slate-400 line-clamp-1 mb-2 break-words [overflow-wrap:anywhere]">
                              {cit.citedMeta.title}
                            </p>

                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span
                                className={`verdict-badge ${cit.verdictBadgeClass} text-[11px] px-2 py-0.5 font-semibold`}
                              >
                                {cit.verdictText}
                              </span>
                              {canViewDeepTrace &&
                                isAbnormalMapping(cit.verdict.mapping_status) && (
                                  <span
                                    className={`mapping-badge ${cit.mappingBadgeClass} text-[11px] px-2 py-0.5 font-medium`}
                                  >
                                    {cit.mappingText}
                                  </span>
                                )}
                              {cit.linkBadge && (
                                <span
                                  className={`rounded-md ${cit.linkBadge.badgeClass} text-[11px] px-2 py-0.5 font-medium`}
                                  title={cit.linkBadge.title}
                                >
                                  {cit.linkBadge.text}
                                </span>
                              )}
                            </div>
                          </button>
                        );
                      };

                      if (filteredItems.length === 0) {
                        const isIssuesEmpty =
                          filterLabel === 'issues' && !searchQuery.trim();
                        return (
                          <div
                            data-testid={
                              isIssuesEmpty ? 'queue-empty-issues' : 'queue-empty-filtered'
                            }
                            className="p-6 text-center rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-2.5"
                          >
                            <div className="mx-auto w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200/80 dark:border-emerald-800/70 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
                              <Check className="h-5 w-5" />
                            </div>
                            <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                              {isIssuesEmpty
                                ? lang === 'vi'
                                  ? 'Không phát hiện vấn đề nào cần xử lý'
                                  : 'No actionable issues found'
                                : lang === 'vi'
                                  ? 'Không tìm thấy trích dẫn phù hợp'
                                  : 'No matching citations'}
                            </p>
                            <p className="text-xs text-slate-500 dark:text-slate-400">
                              {isIssuesEmpty
                                ? lang === 'vi'
                                  ? 'Tất cả trích dẫn và liên kết trong báo cáo đều đang ở trạng thái tốt.'
                                  : 'All citations and links in this report look clean.'
                                : lang === 'vi'
                                  ? 'Thử xóa từ khóa tìm kiếm hoặc xem toàn bộ danh sách trích dẫn.'
                                  : 'Try clearing your search or viewing all citations.'}
                            </p>
                            <button
                              type="button"
                              data-testid="queue-reset-filter-btn"
                              onClick={() => {
                                handleChangeFilterLabel('all');
                                setSearchQuery('');
                              }}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white transition-colors cursor-pointer"
                            >
                              {lang === 'vi'
                                ? 'Xem tất cả trích dẫn'
                                : 'Show all citations'}
                            </button>
                          </div>
                        );
                      }

                      if (!showGroupHeaders) {
                        return filteredItems.map(renderQueueCard);
                      }

                      return (
                        <>
                          {attentionItems.length > 0 && (
                            <>
                              <div className="px-1 pt-1 pb-0.5 flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                                <span>
                                  {lang === 'vi'
                                    ? `Cần kiểm tra trước (${attentionItems.length})`
                                    : `Needs Review First (${attentionItems.length})`}
                                </span>
                                <span className="text-amber-700 dark:text-amber-400 font-semibold normal-case">
                                  {lang === 'vi' ? 'Ưu tiên xử lý' : 'Action required'}
                                </span>
                              </div>
                              {attentionItems.map(renderQueueCard)}
                            </>
                          )}

                          {verifiedItems.length > 0 && (
                            <>
                              <div className="px-1 pt-3 pb-0.5 flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                                <span>
                                  {`${getVerdictDisplay('verified', lang).label} (${verifiedItems.length})`}
                                </span>
                              </div>
                              {verifiedItems.map(renderQueueCard)}
                            </>
                          )}

                          {resourceItems.length > 0 && (
                            <>
                              <div className="px-1 pt-3 pb-0.5 flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-violet-600 dark:text-violet-400">
                                <span>
                                  {`${getVerdictDisplay('resource', lang).label} (${resourceItems.length})`}
                                </span>
                              </div>
                              {resourceItems.map(renderQueueCard)}
                            </>
                          )}
                        </>
                      );
                    })()}
                  </div>
                </div>
              </div>

              {/* Right Pane (Desktop >= lg) OR Responsive Mobile Detail Sheet (< lg) */}
              {activeItem && (() => {
                const detailInner = (
                  <div className="p-4 sm:p-6 flex flex-col gap-5">
                    {/* TIER 1: Clean Identity Header + Plain-Language Diagnosis + Quick Actions */}
                  <div className="flex flex-wrap items-start justify-between gap-3 pb-3.5 border-b border-slate-200 dark:border-slate-800">
                    <div className="min-w-[200px] flex-1">
                      <div className="flex items-center gap-2 text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">
                        <span>
                          {lang === 'vi' ? 'Tài liệu' : 'Reference'}{' '}
                          <code className="font-mono font-bold text-indigo-600 dark:text-indigo-400">
                            {activeItem.marker}
                          </code>
                        </span>
                        {activeItem.pageLabel && (
                          <>
                            <span>•</span>
                            <span>{activeItem.pageLabel}</span>
                          </>
                        )}
                      </div>
                      <h3 className="font-sans text-lg sm:text-xl font-bold leading-snug text-slate-900 dark:text-white break-words [overflow-wrap:anywhere]">
                        <SoftTextSwap text={activeItem.citedMeta.title} />
                      </h3>
                    </div>

                    <div className="flex items-center gap-1.5 flex-wrap shrink-0">
                      <span
                        className={`verdict-badge ${activeItem.verdictBadgeClass} text-xs px-3 py-1 font-semibold`}
                      >
                        {activeItem.verdictText}
                      </span>
                      {canViewDeepTrace &&
                        isAbnormalMapping(activeItem.verdict.mapping_status) && (
                          <span
                            className={`mapping-badge ${activeItem.mappingBadgeClass} text-xs px-2.5 py-1 font-medium`}
                          >
                            {activeItem.mappingText}
                          </span>
                        )}
                      {activeItem.linkBadge && (
                        <span
                          className={`rounded-md ${activeItem.linkBadge.badgeClass} text-xs px-2.5 py-1 font-medium`}
                          title={activeItem.linkBadge.title}
                        >
                          {activeItem.linkBadge.text}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Plain-Language Summary & Quick Fix Actions */}
                  <div
                    className={`p-4 rounded-xl border space-y-3 ${
                      activeItem.verdict.label === 'suspected_hallucination'
                        ? 'bg-red-50/40 dark:bg-red-950/20 border-red-200/80 dark:border-red-900/60'
                        : activeItem.verdict.label === 'metadata_error'
                          ? 'bg-amber-50/50 dark:bg-amber-950/20 border-amber-200/80 dark:border-amber-900/60'
                          : activeItem.verdict.label === 'verified'
                            ? 'bg-emerald-50/40 dark:bg-emerald-950/20 border-emerald-200/80 dark:border-emerald-900/60'
                            : 'bg-slate-50 dark:bg-slate-900 border-slate-200/80 dark:border-slate-800'
                    }`}
                  >
                    <div className="flex items-start gap-2.5">
                      <Info
                        className={`h-4 w-4 shrink-0 mt-0.5 ${
                          activeItem.verdict.label === 'suspected_hallucination'
                            ? 'text-red-600 dark:text-red-400'
                            : activeItem.verdict.label === 'metadata_error'
                              ? 'text-amber-600 dark:text-amber-400'
                              : 'text-emerald-600 dark:text-emerald-400'
                        }`}
                      />
                      <div className="text-xs sm:text-sm leading-relaxed text-slate-800 dark:text-slate-200 flex-1 min-w-0">
                        <span className="font-semibold text-slate-900 dark:text-white mr-1.5">
                          {lang === 'vi' ? 'Tóm tắt:' : 'Summary:'}
                        </span>{' '}
                        <span>{activeItem.explanationText}</span>

                        {canViewDeepTrace &&
                          (() => {
                            const f = activeItem.verdict.features as
                              | CrossLingualFeaturesExt
                              | undefined;
                            const rawBridged =
                              Array.isArray(f?.cross_lingual_bridged_concepts) &&
                              f.cross_lingual_bridged_concepts.length > 0
                                ? f.cross_lingual_bridged_concepts
                                : Array.isArray(f?.bridged_concepts)
                                  ? f.bridged_concepts
                                  : [];
                            const bridgedConcepts = filterValidBridgedConcepts(rawBridged);
                            const hasCrossLingualRule = (
                              activeItem.verdict.triggered_rules ?? []
                            ).some(
                              (r) =>
                                r === 'R-CROSS-LINGUAL-ALIGNMENT' ||
                                r === 'R-CROSS-LINGUAL-TITLE-MATCH',
                            );
                            const shouldRenderCrossLingual =
                              bridgedConcepts.length > 0 ||
                              Boolean(f?.cross_lingual_detected) ||
                              Boolean(f?.cross_lingual_alignment) ||
                              Boolean(f?.cross_lingual_title_detected) ||
                              (f?.cross_lingual_title_sim ?? 0) >= 0.5 ||
                              hasCrossLingualRule;
                            if (!shouldRenderCrossLingual) return null;

                            const onnxSim = Math.max(
                              f?.cross_lingual_title_sim ?? 0,
                              f?.title_sim_semantic ?? 0,
                              f?.semantic_similarity ?? 0,
                              f?.content_alignment_score ?? 0,
                            );
                            const onnxPct = onnxSim > 0 ? Math.round(onnxSim * 100) : null;

                            return (
                              <div
                                data-testid="essay-bridged-concepts"
                                className="mt-2 pt-2 border-t border-slate-200/70 dark:border-slate-800 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-600 dark:text-slate-400"
                              >
                                {bridgedConcepts.length > 0 ? (
                                  <>
                                    <span className="font-medium text-slate-600 dark:text-slate-300">
                                      {lang === 'vi'
                                        ? 'Khớp nội dung Việt–Anh:'
                                        : 'Cross-language match:'}
                                    </span>
                                    {bridgedConcepts.slice(0, 5).map((pair, idx) => (
                                      <span
                                        key={idx}
                                        className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] bg-indigo-50/80 text-indigo-700 border border-indigo-200/70 dark:bg-indigo-950/50 dark:text-indigo-300 dark:border-indigo-800/60"
                                      >
                                        {pair}
                                      </span>
                                    ))}
                                    {onnxPct !== null && (
                                      <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                                        ({onnxPct}%)
                                      </span>
                                    )}
                                  </>
                                ) : (
                                  <span
                                    data-testid="essay-onnx-cross-lingual-badge"
                                    className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-600 dark:text-slate-300"
                                  >
                                    {lang === 'vi'
                                      ? `Khớp nội dung Việt–Anh${onnxPct !== null ? ` (${onnxPct}%)` : ''}`
                                      : `Cross-language match${onnxPct !== null ? ` (${onnxPct}%)` : ''}`}
                                  </span>
                                )}
                              </div>
                            );
                          })()}
                      </div>
                    </div>

                    {(() => {
                      const primarySourceUrl = getPrimarySourceExternalUrl(activeItem);
                      const isUnmatchedCitation =
                        activeItem.verdict.label === 'suspected_hallucination' ||
                        activeItem.verdict.label === 'unresolved' ||
                        (!activeItem.retrievedMeta &&
                          activeItem.verdict.label !== 'resource');
                      const canCopyClean =
                        Boolean(activeItem.retrievedMeta) &&
                        activeItem.verdict.label !== 'suspected_hallucination' &&
                        activeItem.verdict.label !== 'unresolved';
                      const scholarQuery =
                        activeItem.citedMeta.title && activeItem.citedMeta.title !== '—'
                          ? activeItem.citedMeta.title
                          : activeItem.verdict.citation_raw;
                      const scholarUrl = `https://scholar.google.com/scholar?q=${encodeURIComponent(
                        scholarQuery,
                      )}`;

                      return (
                        <div className="flex flex-wrap items-center gap-2 pl-6">
                          <button
                            type="button"
                            data-testid="copy-formatted-citation-btn"
                            disabled={!canCopyClean}
                            title={
                              canCopyClean
                                ? undefined
                                : lang === 'vi'
                                  ? 'Chưa tìm thấy nguồn gốc khớp để sao chép trích dẫn chuẩn'
                                  : 'No verified source found to copy a formatted citation'
                            }
                            onClick={() => {
                              if (canCopyClean) {
                                void handleCopyFormattedCitation(activeItem);
                              }
                            }}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm transition-colors cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed disabled:hover:bg-indigo-600"
                          >
                            <Copy className="h-3.5 w-3.5" />
                            <span>
                              {lang === 'vi'
                                ? 'Chép trích dẫn chuẩn'
                                : 'Copy Formatted Citation'}
                            </span>
                          </button>

                          {isUnmatchedCitation ? (
                            <a
                              data-testid="google-scholar-search-btn"
                              href={scholarUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                            >
                              <Search className="h-3.5 w-3.5" />
                              <span>
                                {lang === 'vi'
                                  ? 'Tìm thử trên Google Scholar'
                                  : 'Search on Google Scholar'}
                              </span>
                              <ExternalLink className="h-3.5 w-3.5" />
                            </a>
                          ) : primarySourceUrl ? (
                            <a
                              data-testid="open-source-paper-btn"
                              href={primarySourceUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                            >
                              <span>
                                {lang === 'vi' ? 'Mở nguồn gốc' : 'Open Original Source'}
                              </span>
                              <ExternalLink className="h-3.5 w-3.5" />
                            </a>
                          ) : null}
                        </div>
                      );
                    })()}
                  </div>

                  {/* TIER 2: Focused Comparison Table (Mismatches First, Empty Rows Hidden) + Manuscript Quote */}
                  <div>
                    <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">
                      {lang === 'vi'
                        ? 'Đối chiếu thông tin chi tiết'
                        : 'Detailed Field Comparison'}
                    </div>
                    <div className="rounded-xl border border-slate-200 dark:border-slate-800 overflow-x-auto">
                      <table className="w-full block sm:table sm:table-fixed lg:block xl:table xl:table-fixed text-left border-collapse">
                        <thead className="hidden sm:table-header-group lg:hidden xl:table-header-group">
                          <tr className="bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 text-[11px] font-semibold uppercase text-slate-500 dark:text-slate-400">
                            <th className="py-2.5 px-3 w-[96px]">
                              {lang === 'vi' ? 'Thông tin' : 'Field'}
                            </th>
                            <th className="py-2.5 px-3">
                              {lang === 'vi' ? 'Trích dẫn trong bài' : 'Cited in Essay'}
                            </th>
                            <th className="py-2.5 px-3">
                              {lang === 'vi'
                                ? 'Dữ liệu gốc tìm được'
                                : 'Published Record'}
                            </th>
                            <th className="py-2.5 px-3 w-[176px] min-w-[164px] whitespace-nowrap text-right">
                              {lang === 'vi' ? 'Kết quả' : 'Status'}
                            </th>
                          </tr>
                        </thead>
                        <tbody className="block sm:table-row-group lg:block xl:table-row-group divide-y divide-slate-200/70 dark:divide-slate-800 text-xs">
                          {(() => {
                            const baseFields: ReadonlyArray<
                              readonly [string, keyof MetadataFields]
                            > = [
                              [lang === 'vi' ? 'Tiêu đề' : 'Title', 'title'],
                              [lang === 'vi' ? 'Tác giả' : 'Authors', 'authors'],
                              [lang === 'vi' ? 'Năm XB' : 'Year', 'year'],
                              [lang === 'vi' ? 'Nơi công bố' : 'Venue', 'venue'],
                              ['DOI', 'doi'],
                              ['URL / Link', 'url'],
                            ];

                            const rowPriority = (status: FieldStatus): number => {
                              if (status === 'mismatch') return 0;
                              if (status === 'partial') return 1;
                              return 2;
                            };

                            const visibleFields = baseFields
                              .filter(([, key]) => {
                                if (key !== 'doi' && key !== 'url') return true;
                                const st = activeItem.fieldStatus[key].status;
                                if (st === 'mismatch') return true;
                                const citedVal = activeItem.citedMeta[key];
                                const canonVal = activeItem.retrievedMeta?.[key] ?? '—';
                                if (key === 'url') {
                                  if (activeItem.linkBadge) return true;
                                  const toDoiHref = (d?: string | null) =>
                                    d && d !== '—'
                                      ? d.startsWith('http')
                                        ? d
                                        : `https://doi.org/${d}`
                                      : '';
                                  const citedIsRedundant =
                                    citedVal === '—' ||
                                    citedVal === toDoiHref(activeItem.citedMeta.doi);
                                  const canonIsRedundant =
                                    canonVal === '—' ||
                                    canonVal === toDoiHref(activeItem.retrievedMeta?.doi);
                                  if (citedIsRedundant && canonIsRedundant) {
                                    return false;
                                  }
                                }
                                if (st === 'partial') return true;
                                return !(citedVal === '—' && canonVal === '—');
                              })
                              .map((entry, idx) => ({ entry, idx }))
                              .sort(
                                (a, b) =>
                                  rowPriority(activeItem.fieldStatus[a.entry[1]].status) -
                                    rowPriority(activeItem.fieldStatus[b.entry[1]].status) ||
                                  a.idx - b.idx,
                              )
                              .map((w) => w.entry);

                            return visibleFields.map(([label, key]) => {
                              const st = activeItem.fieldStatus[key].status;
                              const rowHighlight =
                                st === 'mismatch'
                                  ? activeItem.verdict.label === 'suspected_hallucination'
                                    ? 'bg-red-50/50 dark:bg-red-950/20'
                                    : 'bg-amber-50/60 dark:bg-amber-950/20'
                                  : st === 'partial'
                                    ? 'bg-amber-50/40 dark:bg-amber-950/15'
                                    : 'hover:bg-slate-50/70 dark:hover:bg-slate-900/40';

                              return (
                                <tr
                                  key={key}
                                  className={`flex flex-col sm:table-row lg:flex lg:flex-col xl:table-row p-3 sm:p-0 lg:p-3 xl:p-0 gap-1.5 sm:gap-0 lg:gap-1.5 xl:gap-0 ${rowHighlight}`}
                                >
                                  <td className="py-0.5 sm:py-2.5 lg:py-0.5 xl:py-2.5 px-0 sm:px-3 lg:px-0 xl:px-3 font-semibold text-slate-600 dark:text-slate-400 align-top flex items-center justify-between sm:table-cell lg:flex xl:table-cell">
                                    <span>{label}</span>
                                    <span className="sm:hidden lg:inline-flex xl:hidden">
                                      {renderFieldStatusBadge(activeItem.fieldStatus[key])}
                                    </span>
                                  </td>
                                  <td className="py-0.5 sm:py-2.5 lg:py-0.5 xl:py-2.5 px-0 sm:px-3 lg:px-0 xl:px-3 text-slate-900 dark:text-slate-100 font-medium align-top break-words [overflow-wrap:anywhere] sm:table-cell lg:block xl:table-cell">
                                    <span className="sm:hidden lg:block xl:hidden block text-[10px] uppercase text-slate-400 mb-0.5">
                                      {lang === 'vi' ? 'Trích dẫn trong bài' : 'Cited in Essay'}
                                    </span>
                                    {(() => {
                                      const safeCitedUrl =
                                        key === 'url' && activeItem.citedMeta.url !== '—'
                                          ? toSafeExternalHref(activeItem.citedMeta.url)
                                          : null;
                                      return safeCitedUrl ? (
                                        <a
                                          href={safeCitedUrl}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="inline-flex items-center gap-1 font-mono text-indigo-600 dark:text-indigo-400 hover:underline break-all"
                                        >
                                          <span>{activeItem.citedMeta.url}</span>
                                          <ExternalLink className="h-3 w-3 shrink-0" />
                                        </a>
                                      ) : (
                                        <SoftTextSwap text={activeItem.citedMeta[key]} />
                                      );
                                    })()}
                                  </td>
                                  <td className="py-0.5 sm:py-2.5 lg:py-0.5 xl:py-2.5 px-0 sm:px-3 lg:px-0 xl:px-3 text-slate-700 dark:text-slate-300 align-top break-words [overflow-wrap:anywhere] sm:table-cell lg:block xl:table-cell">
                                    <span className="sm:hidden lg:block xl:hidden block text-[10px] uppercase text-slate-400 mb-0.5">
                                      {lang === 'vi'
                                        ? 'Dữ liệu gốc tìm được'
                                        : 'Published Record'}
                                    </span>
                                    {activeItem.retrievedMeta ? (
                                      (() => {
                                        const safeRetrievedDoi =
                                          key === 'doi' && activeItem.retrievedMeta.doi !== '—'
                                            ? toSafeDoiHref(activeItem.retrievedMeta.doi)
                                            : null;
                                        const safeRetrievedUrl =
                                          key === 'url' && activeItem.retrievedMeta.url !== '—'
                                            ? toSafeExternalHref(activeItem.retrievedMeta.url)
                                            : null;
                                        if (safeRetrievedDoi) {
                                          return (
                                            <a
                                              href={safeRetrievedDoi}
                                              target="_blank"
                                              rel="noopener noreferrer"
                                              className="inline-flex items-center gap-1 font-mono text-indigo-600 dark:text-indigo-400 hover:underline break-all"
                                            >
                                              <span>{activeItem.retrievedMeta.doi}</span>
                                              <ExternalLink className="h-3 w-3 shrink-0" />
                                            </a>
                                          );
                                        }
                                        if (safeRetrievedUrl) {
                                          return (
                                            <div className="space-y-1">
                                              <a
                                                href={safeRetrievedUrl}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="inline-flex items-center gap-1 font-mono text-indigo-600 dark:text-indigo-400 hover:underline break-all"
                                              >
                                                <span>{activeItem.retrievedMeta.url}</span>
                                                <ExternalLink className="h-3 w-3 shrink-0" />
                                              </a>
                                              {(activeItem.verdict.triggered_rules ?? []).includes(
                                                'R-URL-CONTENT-MISMATCH',
                                              ) && (
                                                <span className="block text-[11px] font-sans text-amber-700 dark:text-amber-400 font-medium">
                                                  {lang === 'vi'
                                                    ? 'Đường dẫn vẫn mở được nhưng dẫn tới trang có tiêu đề khác'
                                                    : 'Link opens, but leads to a page with a different title'}
                                                </span>
                                              )}
                                            </div>
                                          );
                                        }
                                        if (
                                          activeItem.retrievedMeta[key] ===
                                            'Trang web không ghi thông tin này' ||
                                          activeItem.retrievedMeta[key] ===
                                            'Not listed on this web page'
                                        ) {
                                          return (
                                            <span className="text-slate-500 dark:text-slate-400 italic">
                                              <SoftTextSwap text={activeItem.retrievedMeta[key]} />
                                            </span>
                                          );
                                        }
                                        return <SoftTextSwap text={activeItem.retrievedMeta[key]} />;
                                      })()
                                    ) : key === 'url' && activeItem.linkBadge ? (
                                      <span
                                        className={
                                          (activeItem.verdict.triggered_rules ?? []).includes(
                                            'R-URL-CONTENT-MISMATCH',
                                          )
                                            ? 'text-amber-700 dark:text-amber-400 font-semibold'
                                            : activeItem.linkBadge.status === 'alive' ||
                                                activeItem.linkBadge.status === 'restricted_alive'
                                              ? 'text-emerald-600 dark:text-emerald-400 font-semibold'
                                              : 'text-red-500 dark:text-red-400 font-semibold'
                                        }
                                      >
                                        {activeItem.linkBadge.title}
                                      </span>
                                    ) : activeItem.verdict.label === 'resource' &&
                                      !isLegalStatuteVerdict(activeItem.verdict) ? (
                                      key === 'doi' && activeItem.citedMeta.doi === '—' ? (
                                        <span className="text-slate-500 dark:text-slate-400">—</span>
                                      ) : (activeItem.verdict.url_status ??
                                          activeItem.verdict.features?.url_status) ===
                                        'restricted_alive' ? (
                                        <span className="text-slate-600 dark:text-slate-300">
                                          {lang === 'vi'
                                            ? 'Trang web hạn chế truy cập tự động — vui lòng bấm mở trực tiếp'
                                            : 'This website restricts automated preview — please open it directly'}
                                        </span>
                                      ) : (
                                        <span className="text-slate-600 dark:text-slate-300">
                                          {lang === 'vi'
                                            ? 'Trang web hợp lệ (không có thông tin mô tả sẵn)'
                                            : 'Live web page (no summary details listed)'}
                                        </span>
                                      )
                                    ) : (activeItem.verdict.triggered_rules ?? []).includes(
                                        'R-INCOMPLETE-METADATA',
                                      ) ? (
                                      <span className="text-amber-700 dark:text-amber-400 italic">
                                        {lang === 'vi'
                                          ? 'Thiếu thông tin (tác giả/năm/tiêu đề) để tìm nguồn gốc'
                                          : 'Not enough citation details to look up this source'}
                                      </span>
                                    ) : (
                                      <span className="text-slate-500 dark:text-slate-400 italic">
                                        {lang === 'vi'
                                          ? 'Không tìm thấy dữ liệu gốc'
                                          : 'No published record found'}
                                      </span>
                                    )}
                                  </td>
                                  <td className="hidden sm:table-cell lg:hidden xl:table-cell py-2.5 px-3 text-right whitespace-nowrap align-top">
                                    {renderFieldStatusBadge(activeItem.fieldStatus[key])}
                                  </td>
                                </tr>
                              );
                            });
                          })()}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Manuscript Context Quote Box (Moved cleanly from Left Queue bottom into Right Detail flow) */}
                  {(() => {
                    const isImplicitOrUncitedContext =
                      activeItem.verdict.mapping_status === 'uncited_reference' ||
                      activeItem.verdict.features?.context_source === 'implicit_body_discovery';
                    return (
                      <div
                        data-testid="manuscript-context-card"
                        className="p-3.5 sm:p-4 rounded-xl border bg-slate-50/90 dark:bg-slate-900 border-slate-200/80 dark:border-slate-800"
                      >
                        <div className="flex items-center justify-between gap-2 text-[11px] font-bold tracking-wider text-slate-500 dark:text-slate-400 mb-1.5 flex-wrap">
                          <span className={isImplicitOrUncitedContext ? 'normal-case text-amber-700 dark:text-amber-300' : 'uppercase'}>
                            {isImplicitOrUncitedContext
                              ? lang === 'vi'
                                ? 'Đoạn văn liên quan trong bài (chưa trích dẫn trực tiếp)'
                                : 'Related body passage (not explicitly cited)'
                              : lang === 'vi'
                                ? 'Đoạn trích dẫn trong bài của bạn'
                                : 'In-Text Context'}
                            {activeItem.pageLabel && (
                              <>
                                {' '}
                                <span className="normal-case font-semibold">
                                  ({activeItem.pageLabel})
                                </span>
                              </>
                            )}
                          </span>
                          {isDocxFilename(report.filename) && (
                            <span className="text-[10px] font-medium px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400">
                              Word (.docx)
                            </span>
                          )}
                        </div>
                        <p className="document-content text-xs sm:text-sm text-slate-700 dark:text-slate-300 leading-relaxed line-clamp-4 break-words [overflow-wrap:anywhere]">
                          {activeItem.contextBefore}
                          <mark
                            className={`rounded px-1 py-0.5 font-mono font-bold ${
                              activeItem.verdict.label === 'suspected_hallucination'
                                ? 'bg-red-100/80 dark:bg-red-950/70 text-red-700 dark:text-red-300'
                                : activeItem.verdict.label === 'metadata_error'
                                  ? 'bg-amber-100/80 dark:bg-amber-950/70 text-amber-800 dark:text-amber-300'
                                  : 'bg-indigo-100/80 dark:bg-indigo-950/70 text-indigo-700 dark:text-indigo-300'
                            }`}
                          >
                            {activeItem.contextHighlight}
                          </mark>
                          {activeItem.contextAfter}
                        </p>
                      </div>
                    );
                  })()}

                  {/* Instructor Review Bar (Directly accessible for Teachers & Admins) */}
                  {canOverride && (
                    <div className="p-3.5 rounded-xl bg-indigo-50/70 dark:bg-indigo-950/40 border border-indigo-200/80 dark:border-indigo-800/70 flex flex-wrap items-center justify-between gap-3 text-xs">
                      <div className="flex items-center gap-2 text-indigo-900 dark:text-indigo-200">
                        <Shield className="h-4 w-4 text-indigo-600 dark:text-indigo-400 shrink-0" />
                        <span className="font-medium">
                          {lang === 'vi'
                            ? 'Dành cho Giảng viên: Bạn có thể điều chỉnh kết quả đánh giá và để lại ghi chú.'
                            : 'Instructor Review: Adjust this result and leave a short review note.'}
                        </span>
                      </div>
                      <OverrideControls
                        verdict={activeItem.verdict}
                        onOverride={(req) => handleOverride(activeItem.verdict, req)}
                      />
                    </div>
                  )}

                  {/* TIER 3: Progressive Disclosure Drawer — Checked Sources, Verification Checks & Decision Flow (Closed by Default!) */}
                  <div
                    data-testid="deep-verification-drawer"
                    data-open={deepDrawerOpen ? 'true' : 'false'}
                    className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/50 overflow-hidden"
                  >
                    <button
                      type="button"
                      data-testid="deep-verification-drawer-toggle"
                      aria-expanded={deepDrawerOpen}
                      onClick={() => {
                        const nextOpen = !deepDrawerOpen;
                        setDeepDrawerOpen(nextOpen);
                        if (!nextOpen && searchParams.has('drawer')) {
                          setSearchParams(
                            (prev) => {
                              const next = new URLSearchParams(prev);
                              next.delete('drawer');
                              return next;
                            },
                            { replace: true },
                          );
                        }
                      }}
                      className="w-full px-4 py-3 flex items-center justify-between gap-3 text-left text-xs sm:text-[13px] font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100/80 dark:hover:bg-slate-800/70 transition-colors cursor-pointer"
                    >
                      <span className="flex items-center gap-2 min-w-0">
                        <Microscope className="h-4 w-4 text-indigo-600 dark:text-indigo-400 shrink-0" />
                        <span className="truncate">
                          {lang === 'vi'
                            ? 'Xem chi tiết đối chiếu nguồn & tiêu chí kiểm tra'
                            : 'View Verification Details (Sources & Checks)'}
                        </span>
                      </span>
                      <span className="inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400 shrink-0">
                        <span>
                          {deepDrawerOpen
                            ? lang === 'vi'
                              ? 'Thu gọn'
                              : 'Collapse'
                            : lang === 'vi'
                              ? 'Mở rộng'
                              : 'Expand'}
                        </span>
                        <SymmetricChevron open={deepDrawerOpen} size={14} />
                      </span>
                    </button>

                    <div
                      className={`grid transition-all duration-200 ${
                        deepDrawerOpen
                          ? 'grid-rows-[1fr] opacity-100 border-t border-slate-200 dark:border-slate-800'
                          : 'grid-rows-[0fr] opacity-0 pointer-events-none'
                      }`}
                    >
                      <div className="overflow-hidden min-h-0">
                        <div className="p-4 bg-white dark:bg-slate-950 space-y-4">
                          {canViewDeepTrace ? (
                            <>
                              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600 dark:text-slate-400">
                                {activeItem.verdict.label === 'suspected_hallucination' ||
                                activeItem.verdict.label === 'unresolved' ? (
                                  <span
                                    data-testid="deep-manual-check-hint"
                                    className="font-medium text-slate-600 dark:text-slate-300"
                                  >
                                    {lang === 'vi'
                                      ? 'Cần kiểm tra thủ công'
                                      : 'Manual check recommended'}
                                  </span>
                                ) : (
                                  <span>
                                    {lang === 'vi' ? 'Mức độ khớp:' : 'Match Confidence:'}{' '}
                                    <strong className="font-sans font-bold text-slate-900 dark:text-white">
                                      {activeItem.confidencePct}%
                                    </strong>
                                  </span>
                                )}
                                <span className="text-[11px] text-slate-500 dark:text-slate-400">
                                  {lang === 'vi'
                                    ? `${activeItem.rules.length} tiêu chí đánh giá`
                                    : `${activeItem.rules.length} verification ${activeItem.rules.length === 1 ? 'check' : 'checks'}`}
                                </span>
                              </div>

                              <Tabs
                                value={deepTab}
                                onValueChange={(v) =>
                                  setDeepTab(
                                    v as 'sources' | 'content' | 'steps' | 'graph',
                                  )
                                }
                                className="w-full"
                              >
                                <TabsList className="grid grid-cols-2 sm:grid-cols-4 w-full bg-slate-100 dark:bg-slate-900 p-1 rounded-xl h-auto gap-1">
                                  <TabsTrigger
                                    value="sources"
                                    data-testid="inspector-tab-sources"
                                    className="w-full text-xs font-semibold py-1.5 px-2 truncate"
                                  >
                                    {lang === 'vi' ? '1. Nguồn đối chiếu' : '1. Checked Sources'}
                                  </TabsTrigger>
                                  <TabsTrigger
                                    value="steps"
                                    data-testid="inspector-tab-steps"
                                    className="w-full text-xs font-semibold py-1.5 px-2 truncate"
                                  >
                                    {lang === 'vi'
                                      ? `2. Các bước & Tiêu chí (${activeItem.rules.length})`
                                      : `2. Verification Checks (${activeItem.rules.length})`}
                                  </TabsTrigger>
                                  <TabsTrigger
                                    value="content"
                                    data-testid="inspector-tab-content"
                                    className="w-full text-xs font-semibold py-1.5 px-2 truncate"
                                  >
                                    {lang === 'vi'
                                      ? '3. Đối chiếu nội dung'
                                      : '3. Content Match'}
                                  </TabsTrigger>
                                  <TabsTrigger
                                    value="graph"
                                    data-testid="inspector-tab-graph"
                                    className="w-full text-xs font-semibold py-1.5 px-2 gap-1 truncate"
                                  >
                                    <GitBranch className="h-3 w-3 shrink-0 text-violet-500" />
                                    <span className="truncate">
                                      {lang === 'vi' ? '4. Sơ đồ kiểm tra' : '4. Decision Flow'}
                                    </span>
                                  </TabsTrigger>
                                </TabsList>

                                {/* Multi-Source Lookup Results (Matched first; unmatched collapsed by default) */}
                                <TabsContent value="sources" className="mt-3 space-y-2.5">
                                  {(() => {
                                    const matchedOrPartialSources = activeItem.sources.filter(
                                      (s) => s.status !== 'not_found',
                                    );
                                    const emptySources = activeItem.sources.filter(
                                      (s) => s.status === 'not_found',
                                    );

                                    const renderSourceCard = (src: SourceRetrievalItem) => {
                                      const localizeFieldToken = (f: string) => {
                                        const low = f.toLowerCase();
                                        if (lang === 'vi') {
                                          if (low === 'title') return 'tiêu đề';
                                          if (low === 'authors' || low === 'author') return 'tác giả';
                                          if (low === 'year') return 'năm xuất bản';
                                          if (low === 'venue') return 'nơi công bố';
                                          if (low === 'doi') return 'mã DOI';
                                          if (low === 'url') return 'đường dẫn';
                                          return f;
                                        }
                                        if (low === 'doi') return 'DOI';
                                        if (low === 'url') return 'URL';
                                        return f;
                                      };
                                      const joinedFields = src.matchedFields
                                        .map(localizeFieldToken)
                                        .join(', ');
                                      const scorePct = `${Math.round(Number(src.score) * 100)}%`;
                                      const subtitleText =
                                        src.status === 'matched'
                                          ? lang === 'vi'
                                            ? `Đã khớp · Độ khớp: ${scorePct}${joinedFields ? ` · Khớp: ${joinedFields}` : ''}`
                                            : `Matched · Match: ${scorePct}${joinedFields ? ` · Matched: ${joinedFields}` : ''}`
                                          : src.status === 'candidate_insufficient'
                                            ? lang === 'vi'
                                              ? `Ứng viên tham khảo · Độ khớp: ${scorePct}${joinedFields ? ` · Thông tin đối chiếu: ${joinedFields}` : ''}`
                                              : `Candidate · Match: ${scorePct}${joinedFields ? ` · Record fields: ${joinedFields}` : ''}`
                                            : src.status === 'partial'
                                              ? lang === 'vi'
                                                ? `Khớp một phần · Độ khớp: ${scorePct}${joinedFields ? ` · Thông tin đối chiếu: ${joinedFields}` : ''}`
                                                : `Partial match · Match: ${scorePct}${joinedFields ? ` · Record fields: ${joinedFields}` : ''}`
                                              : src.notRouted
                                                ? lang === 'vi'
                                                  ? 'Không cần dò (nguồn web / văn bản pháp luật)'
                                                  : 'Skipped — web or legal source'
                                                : lang === 'vi'
                                                  ? 'Đã tra cứu · Không có bản ghi trùng'
                                                  : 'Checked · No matching record';
                                      const isFullWidthCandidate =
                                        src.status !== 'not_found' &&
                                        (matchedOrPartialSources.length === 1 ||
                                          src.status === 'candidate_insufficient');
                                      return (
                                        <div
                                          key={src.name}
                                          data-testid="deep-source-card"
                                          data-source-status={src.status}
                                          className={`p-3 rounded-xl border flex flex-col gap-1.5 min-w-0 ${
                                            isFullWidthCandidate ? 'sm:col-span-2 ' : ''
                                          }${
                                            src.status === 'matched'
                                              ? 'bg-emerald-50/40 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800/70'
                                              : src.status === 'partial' ||
                                                  src.status === 'candidate_insufficient'
                                                ? 'bg-amber-50/40 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800/70'
                                                : 'bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800'
                                          }`}
                                        >
                                          <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 min-w-0">
                                            <p className="text-xs font-semibold text-slate-900 dark:text-white break-words min-w-0">
                                              {src.name}
                                            </p>
                                            <span
                                              className={`text-[10.5px] font-semibold px-2 py-0.5 rounded max-w-full whitespace-normal sm:whitespace-nowrap shrink-0 ${
                                                src.status === 'matched'
                                                  ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200'
                                                  : src.status === 'candidate_insufficient' ||
                                                      src.status === 'partial'
                                                    ? 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200'
                                                    : 'bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                                              }`}
                                            >
                                              {src.status === 'matched'
                                                ? lang === 'vi'
                                                  ? 'Khớp nguồn'
                                                  : 'Matched'
                                                : src.status === 'candidate_insufficient'
                                                  ? lang === 'vi'
                                                    ? 'Ứng viên tham khảo (chưa đủ khớp)'
                                                    : 'Candidate (insufficient match)'
                                                  : src.status === 'partial'
                                                    ? lang === 'vi'
                                                      ? 'Ứng viên'
                                                      : 'Candidate'
                                                    : src.notRouted
                                                      ? lang === 'vi'
                                                        ? 'Không áp dụng'
                                                        : 'N/A'
                                                      : lang === 'vi'
                                                        ? 'Không khớp'
                                                        : 'Not Found'}
                                            </span>
                                          </div>
                                          <p className="text-[11px] text-slate-500 dark:text-slate-400 break-words">
                                            {subtitleText}
                                          </p>
                                          {(() => {
                                            const safeUrl =
                                              toSafeExternalHref(src.url) ??
                                              toSafeDoiHref(src.doi);
                                            if (!safeUrl) return null;
                                            return (
                                              <a
                                                href={safeUrl}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="inline-flex items-center gap-1 text-[11px] font-medium text-indigo-600 dark:text-indigo-400 hover:underline w-fit"
                                              >
                                                <span>
                                                  {lang === 'vi'
                                                    ? 'Mở bản ghi nguồn'
                                                    : 'Open Source Record'}
                                                </span>
                                                <ExternalLink className="h-3 w-3" />
                                              </a>
                                            );
                                          })()}
                                        </div>
                                      );
                                    };

                                    return (
                                      <>
                                        {matchedOrPartialSources.length > 0 ? (
                                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 min-w-0">
                                            {matchedOrPartialSources.map(renderSourceCard)}
                                          </div>
                                        ) : (
                                          <p className="text-xs text-slate-500 dark:text-slate-400 italic">
                                            {lang === 'vi'
                                              ? 'Không có thư viện học thuật nào trả về bản ghi khớp.'
                                              : 'No academic library returned a matching record.'}
                                          </p>
                                        )}

                                        {emptySources.length > 0 && (
                                          <details className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50 p-2.5">
                                            <summary className="cursor-pointer select-none text-xs font-medium text-slate-600 dark:text-slate-300">
                                              {lang === 'vi'
                                                ? `Xem thêm ${emptySources.length} thư viện học thuật khác đã tra cứu`
                                                : `Show ${emptySources.length} other checked academic libraries`}
                                            </summary>
                                            <div className="mt-2.5 grid grid-cols-1 sm:grid-cols-2 gap-2 min-w-0">
                                              {emptySources.map(renderSourceCard)}
                                            </div>
                                          </details>
                                        )}
                                      </>
                                    );
                                  })()}
                                </TabsContent>

                                {/* Semantic Content & Cross-Lingual Alignment (folded from Verification / L3) */}
                                <TabsContent value="content" className="mt-3">
                                  {hasNeuralAlignmentData(activeItem.verdict) ? (
                                    <NeuralAlignmentPanel
                                      verdict={activeItem.verdict}
                                      lang={lang}
                                    />
                                  ) : (
                                    <div
                                      data-testid="content-match-empty"
                                      className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50 p-4 text-xs text-slate-600 dark:text-slate-400 leading-relaxed"
                                    >
                                      {lang === 'vi'
                                        ? 'Chưa có dữ liệu tóm tắt bài gốc hoặc ngữ cảnh đối chiếu song ngữ cho mục này (ví dụ: liên kết web tham khảo hoặc tài liệu chưa tìm thấy bản gốc).'
                                        : 'No source abstract or semantic context alignment data is available for this citation (e.g. a web resource or an unmatched reference).'}
                                    </div>
                                  )}
                                </TabsContent>

                                {/* 5-Step Verification Trace + Plain-Language Verification Checks */}
                                <TabsContent value="steps" className="mt-3 space-y-4">
                                  <VerificationTraceTimeline
                                    verdict={activeItem.verdict}
                                    lang={lang}
                                  />
                                  {activeItem.rules.length > 0 && (
                                    <div>
                                      <h5 className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">
                                        {lang === 'vi'
                                          ? `Tiêu chí kiểm tra chi tiết (${activeItem.rules.length})`
                                          : `Detailed Verification Checks (${activeItem.rules.length})`}
                                      </h5>
                                      <div className="space-y-2.5">
                                        {activeItem.rules.map((rule) => (
                                          <div
                                            key={rule.code}
                                            className={`p-3 rounded-xl border text-xs ${
                                              rule.status === 'passed'
                                                ? 'bg-emerald-50/50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800/70'
                                                : rule.status === 'warning'
                                                  ? 'bg-amber-50/50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800/70'
                                                  : 'bg-red-50/50 dark:bg-red-950/30 border-red-200 dark:border-red-800/70'
                                            }`}
                                          >
                                            <div className="flex items-start justify-between gap-2 mb-1">
                                              <span className="font-semibold text-slate-900 dark:text-white leading-snug">
                                                {rule.name}
                                              </span>
                                              <span
                                                className={`text-[11px] font-bold shrink-0 ${
                                                  rule.status === 'passed'
                                                    ? 'text-emerald-700 dark:text-emerald-400'
                                                    : rule.status === 'warning'
                                                      ? 'text-amber-700 dark:text-amber-400'
                                                      : 'text-red-700 dark:text-red-400'
                                                }`}
                                              >
                                                {rule.status === 'passed'
                                                  ? lang === 'vi'
                                                    ? '✓ Đạt'
                                                    : '✓ Pass'
                                                  : rule.status === 'warning'
                                                    ? lang === 'vi'
                                                      ? '⚠ Lưu ý'
                                                      : '⚠ Notice'
                                                    : lang === 'vi'
                                                      ? '✕ Chưa khớp'
                                                      : '✕ Unmatched'}
                                              </span>
                                            </div>
                                            <p className="text-[11.5px] text-slate-600 dark:text-slate-300 leading-relaxed">
                                              {rule.explanation}
                                            </p>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                </TabsContent>

                                {/* Evidence Graph */}
                                <TabsContent value="graph" className="mt-3">
                                  <EvidenceGraph verdict={activeItem.verdict} />
                                </TabsContent>
                              </Tabs>

                              {/* Original Reference in Essay */}
                              <div className="p-3 rounded-xl bg-slate-50/80 dark:bg-slate-900/60 border border-slate-200/70 dark:border-slate-800 text-xs">
                                <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 block mb-1">
                                  {lang === 'vi'
                                    ? 'Nội dung trích dẫn trích từ bài'
                                    : 'Original Reference in Essay'}
                                </span>
                                <p className="text-slate-700 dark:text-slate-300 break-words leading-relaxed">
                                  {activeItem.verdict.citation_raw}
                                </p>
                              </div>
                            </>
                          ) : (
                            <div
                              data-testid="deep-drawer-basic-upgrade"
                              className="p-3.5 rounded-xl bg-indigo-50/70 dark:bg-indigo-950/40 border border-indigo-200/80 dark:border-indigo-800/70 flex flex-wrap items-center justify-between gap-3"
                            >
                              <div className="text-xs sm:text-[13px] text-slate-800 dark:text-slate-200 flex-1 min-w-[200px]">
                                <strong className="text-slate-900 dark:text-white">
                                  {lang === 'vi'
                                    ? 'Mở khóa Chi tiết kiểm tra (Gói Pro): '
                                    : 'Unlock Detailed Check Breakdown (Pro Plan): '}
                                </strong>
                                <span>
                                  {lang === 'vi'
                                    ? `Xem toàn bộ kết quả đối chiếu từ hơn 15 thư viện học thuật uy tín, ${SYMBOLIC_RULES_COUNT} tiêu chí kiểm tra và sơ đồ giải thích từng bước.`
                                    : `View lookup results across 15+ academic libraries, ${SYMBOLIC_RULES_COUNT} verification checks, and a step-by-step decision flow.`}
                                </span>
                              </div>
                              <button
                                type="button"
                                data-testid="locked-evidence-graph-tab"
                                onClick={() => {
                                  setLockedFeatureName(
                                    lang === 'vi'
                                      ? 'Chi tiết kiểm tra & Sơ đồ giải thích (Gói Pro)'
                                      : 'Detailed Check Breakdown & Decision Flow',
                                  );
                                  setUpgradeOpen(true);
                                }}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold cursor-pointer shrink-0"
                              >
                                <Sparkles className="h-3.5 w-3.5 text-amber-300" />
                                <span>{lang === 'vi' ? 'Xem gói Pro' : 'Explore Pro'}</span>
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                  </div>
                );

                if (isBelowLg) {
                  if (!mobileDetailOpen) return null;
                  return createPortal(
                    <div
                      data-testid="mobile-citation-detail-sheet"
                      role="dialog"
                      aria-modal="true"
                      aria-label={
                        lang === 'vi'
                          ? `Chi tiết trích dẫn ${activeItem.marker}`
                          : `Citation details ${activeItem.marker}`
                      }
                      className="fixed inset-0 z-[95] flex flex-col bg-slate-950/60 backdrop-blur-sm"
                      onClick={() => setMobileDetailOpen(false)}
                    >
                      <div
                        className="mt-auto w-full max-h-[92dvh] flex flex-col rounded-t-2xl bg-white dark:bg-slate-950 border-t border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="sticky top-0 z-10 px-4 py-3 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
                          <button
                            type="button"
                            data-testid="mobile-detail-back-btn"
                            onClick={() => setMobileDetailOpen(false)}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/60 hover:bg-indigo-100 transition-colors cursor-pointer"
                          >
                            <ArrowLeft className="h-3.5 w-3.5" />
                            <span>
                              {lang === 'vi' ? 'Quay lại danh sách' : 'Back to List'}
                            </span>
                          </button>
                          <span className="font-mono text-xs font-bold text-slate-600 dark:text-slate-300 truncate">
                            {activeItem.marker} · {activeItem.inText}
                          </span>
                          <button
                            type="button"
                            data-testid="mobile-detail-close-btn"
                            onClick={() => setMobileDetailOpen(false)}
                            aria-label={lang === 'vi' ? 'Đóng chi tiết' : 'Close details'}
                            className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                        <div
                          data-testid="citation-detail-stage"
                          className="flex-1 overflow-y-auto min-h-0"
                        >
                          {detailInner}
                        </div>
                      </div>
                    </div>,
                    document.body,
                  );
                }

                return (
                  <DirectionalStageSlide
                    stageKey={Math.max(
                      0,
                      enrichedItems.findIndex(
                        (it) => it.verdict.citation_id === activeItem.verdict.citation_id,
                      ),
                    )}
                    distancePx={10}
                    data-testid="citation-detail-stage"
                    className="citra-cq-citations-right lg:col-span-7 min-w-0 bg-white dark:bg-slate-950"
                  >
                    {detailInner}
                  </DirectionalStageSlide>
                );
              })()}
                </div>
              )}
            </div>
          )}
        </DirectionalStageSlide>
      </section>

      <UpgradeModal
        open={upgradeOpen}
        onOpenChange={setUpgradeOpen}
        featureName={lockedFeatureName}
      />

      <BibliographyRemediationModal
        open={remediationOpen}
        essayId={report.essay_id}
        filename={report.filename}
        lang={lang}
        onClose={() => setRemediationOpen(false)}
      />
    </div>
  );
}
