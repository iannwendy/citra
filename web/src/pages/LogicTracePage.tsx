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
  isUrlResource,
} from '@/lib/verdictExplanation';
import {
  formatCitationStyleLabel,
  formatIntentLabel as formatTaxonomyIntent,
  formatUserError,
  getVerdictDisplay,
} from '@/lib/academicTaxonomy';
import {
  NeuralAlignmentPanel,
  VerificationTraceTimeline,
  hasNeuralAlignmentData,
} from '@/components/VerificationTracePanels';
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
  ChevronRight,
  GitBranch,
  Sparkles,
  ArrowLeft,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

export { NeuralAlignmentPanel, VerificationTraceTimeline, hasNeuralAlignmentData };

/* ============================================================
   SourceLogic — Verification Reasoning Page (L3)
   Shows step-by-step verification trace for each citation
   ============================================================ */

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
              <VerificationTraceTimeline verdict={verdict} lang={lang} />
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
