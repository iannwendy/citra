import { useState, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { type Verdict, type ValidationLabel } from '@/api/client';
import { VerdictBadge } from '@/components/VerdictBadge';
import {
  getSourceDisplayName,
  getVerdictExplanation,
  isUrlResource,
} from '@/lib/verdictExplanation';
import { useEssayPolling } from '@/hooks/useEssayPolling';
import { useRole } from '@/hooks/useRole';
import { EssayHeader } from './essay/EssayHeader';
import { EssayActionBar } from './essay/EssayActionBar';
import {
  AlertTriangle,
  AlertCircle,
  Info,
  Loader2,
  ChevronDown,
  ChevronUp,
  Database,
  XCircle,
  CheckCircle,
  Scale,
  Lock,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

/* ============================================================
   SourceLogic — Issues Page Component (Scholarly Precision v2.0)
   Shows all verification issues grouped by severity
   ============================================================ */

type Severity = 'critical' | 'warning' | 'info';

function getSeverity(label: ValidationLabel): Severity {
  switch (label) {
    case 'suspected_hallucination':
      return 'critical';
    case 'metadata_error':
      return 'warning';
    case 'unresolved':
      return 'info';
    case 'resource':
      return 'info';
    default:
      return 'info';
  }
}

const severityConfig = {
  critical: {
    labelEn: 'Critical (Suspected Hallucination)',
    labelVi: 'Nghiêm trọng (Nghi ngờ Bịa đặt)',
    shortLabel: 'Critical',
    bgClass: 'bg-red-50 dark:bg-red-950/70',
    borderClass: 'border-red-200 dark:border-red-800/80',
    icon: <XCircle className="h-4 w-4" />,
    iconColor: 'text-red-600 dark:text-red-400',
    textColor: 'text-red-700 dark:text-red-300',
    bgCard: 'bg-red-50/40 dark:bg-red-950/25',
    borderCard: 'border-red-200/80 dark:border-red-900/70',
  },
  warning: {
    labelEn: 'Warning (Metadata Drift)',
    labelVi: 'Cảnh báo (Sai lệch Metadata)',
    shortLabel: 'Warning',
    bgClass: 'bg-amber-50 dark:bg-amber-950/70',
    borderClass: 'border-amber-200 dark:border-amber-800/80',
    icon: <AlertTriangle className="h-4 w-4" />,
    iconColor: 'text-amber-600 dark:text-amber-400',
    textColor: 'text-amber-700 dark:text-amber-300',
    bgCard: 'bg-amber-50/40 dark:bg-amber-950/25',
    borderCard: 'border-amber-200/80 dark:border-amber-900/70',
  },
  info: {
    labelEn: 'Info (Unresolved / Web Resource)',
    labelVi: 'Thông tin (Chưa xác định / Liên kết Web)',
    shortLabel: 'Info',
    bgClass: 'bg-slate-100 dark:bg-slate-800',
    borderClass: 'border-slate-200 dark:border-slate-700',
    icon: <Info className="h-4 w-4" />,
    iconColor: 'text-slate-600 dark:text-slate-300',
    textColor: 'text-slate-700 dark:text-slate-300',
    bgCard: 'bg-slate-50/60 dark:bg-slate-900/60',
    borderCard: 'border-slate-200/80 dark:border-slate-800',
  },
};

function SourceIcon({ source }: { source: string }) {
  const lower = source.toLowerCase();
  if (lower.includes('crossref')) return <span className="text-[11px] font-mono font-bold">CR</span>;
  if (lower.includes('openalex')) return <span className="text-[11px] font-mono font-bold">OA</span>;
  if (lower.includes('datacite')) return <span className="text-[11px] font-mono font-bold">DC</span>;
  if (lower.includes('doaj')) return <span className="text-[11px] font-mono font-bold">DJ</span>;
  if (lower.includes('openaire') || lower.includes('hal')) return <span className="text-[11px] font-mono font-bold">HL</span>;
  if (lower.includes('ncbi') || lower.includes('biorxiv')) return <span className="text-[11px] font-mono font-bold">NC</span>;
  if (lower.includes('dblp')) return <span className="text-[11px] font-mono font-bold">DB</span>;
  if (lower.includes('arxiv')) return <span className="text-[11px] font-mono font-bold">AX</span>;
  if (lower.includes('openlibrary')) return <span className="text-[11px] font-mono font-bold">OL</span>;
  if (lower.includes('europepmc')) return <span className="text-[11px] font-mono font-bold">PM</span>;
  if (lower.includes('huggingface')) return <span className="text-[11px] font-mono font-bold">HF</span>;
  if (lower.includes('tech_standard') || lower.includes('rfc') || lower.includes('github') || lower.includes('npm')) return <span className="text-[11px] font-mono font-bold">TS</span>;
  if (lower.includes('wikidata') || lower.includes('opencitations')) return <span className="text-[11px] font-mono font-bold">WD</span>;
  if (lower.includes('doi_ra')) return <span className="text-[11px] font-mono font-bold">RA</span>;
  return <Database className="h-3.5 w-3.5" />;
}

function IssueCard({
  verdict,
  lang,
  canViewDeep,
}: {
  verdict: Verdict;
  lang: 'vi' | 'en';
  /** Pro/Ultra plans, teachers and admins (`view_logic_trace` capability). */
  canViewDeep: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const severity = getSeverity(verdict.label);
  const config = severityConfig[severity];

  const rawPrefixMatch = verdict.citation_raw.match(/^\[(\d+)\]\s*/);
  const refIdMatch = verdict.citation_link?.reference_id?.match(/^ref-0*(\d+)$/);
  const citationNum =
    rawPrefixMatch?.[1] ||
    refIdMatch?.[1] ||
    verdict.citation_id.replace(/[^0-9]/g, '') ||
    verdict.citation_id;
  const displayCitationRaw = rawPrefixMatch
    ? verdict.citation_raw.slice(rawPrefixMatch[0].length)
    : verdict.citation_raw;

  function getIssueDescription(v: Verdict): string {
    if (isUrlResource(v)) {
      return lang === 'vi'
        ? `Tài nguyên URL: ${v.citation_raw}. Không tính vào điểm CIS.`
        : `URL resource: ${v.citation_raw}. Excluded from CIS scoring.`;
    }
    if (v.label === 'suspected_hallucination') {
      return lang === 'vi'
        ? 'Không tìm thấy ấn phẩm khớp trong bất kỳ cơ sở dữ liệu học thuật nào.'
        : 'No matching publication was found in any scholarly database.';
    }
    if (v.label === 'metadata_error') {
      if (v.mismatched_fields.length > 0) {
        const fieldViMap: Record<string, string> = {
          author: 'tác giả',
          authors: 'tác giả',
          year: 'năm xuất bản',
          title: 'tiêu đề',
          venue: 'nơi công bố',
          doi: 'DOI',
        };
        const localizedFields =
          lang === 'vi'
            ? v.mismatched_fields.map((f) => fieldViMap[f.toLowerCase()] || f)
            : v.mismatched_fields;
        return lang === 'vi'
          ? `Sai lệch trường: ${localizedFields.join(', ')}`
          : `${v.mismatched_fields.join(', ')} mismatch`;
      }
      return lang === 'vi'
        ? 'Phát hiện không nhất quán trong metadata tài liệu tham khảo.'
        : 'Metadata inconsistency detected.';
    }
    if (v.label === 'unresolved') {
      return lang === 'vi'
        ? 'Không đủ dữ liệu định danh (DOI/Tác giả/Tiêu đề) để xác minh tự động.'
        : 'Unable to verify due to insufficient data.';
    }
    return getVerdictExplanation(v);
  }

  const sourceResults = verdict.matched_sources || [];

  return (
    <Card
      className={`p-4 rounded-xl border transition-all ${config.bgCard} ${config.borderCard}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <span className="font-mono text-xs font-bold px-2 py-0.5 rounded bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200">
              [{citationNum}]
            </span>
            <VerdictBadge
              verdict={isUrlResource(verdict) ? 'resource' : verdict.label}
              size="sm"
            />
            {canViewDeep && (
              <span className="text-xs font-mono text-slate-500 dark:text-slate-400">
                Conf: <strong>{Math.round(verdict.confidence * 100)}%</strong>
              </span>
            )}
          </div>
          <p className="text-sm text-slate-900 dark:text-slate-100 mb-1.5 font-serif break-words [overflow-wrap:anywhere]">
            {displayCitationRaw}
          </p>
          <p className={`text-xs font-medium break-words [overflow-wrap:anywhere] ${config.textColor}`}>
            {getIssueDescription(verdict)}
          </p>
        </div>
        <button
          onClick={() => setExpanded(!expanded)}
          className={`p-2 rounded-xl bg-white/80 dark:bg-slate-900/80 border border-slate-200/80 dark:border-slate-800 hover:bg-white dark:hover:bg-slate-800 transition-colors ${config.iconColor}`}
          aria-label={expanded ? 'Collapse details' : 'Expand details'}
        >
          {expanded ? (
            <ChevronUp className="h-4 w-4" />
          ) : (
            <ChevronDown className="h-4 w-4" />
          )}
        </button>
      </div>

      {expanded && (
        <div className="mt-4 pt-4 border-t border-slate-200/80 dark:border-slate-800 space-y-4">
          {!canViewDeep && (
            <div
              data-testid="issues-upgrade-hint"
              className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200/80 dark:border-amber-800/70 flex flex-wrap items-center justify-between gap-2 text-xs text-amber-800 dark:text-amber-200"
            >
              <span className="flex items-center gap-2">
                <Lock className="h-3.5 w-3.5 shrink-0" />
                {lang === 'vi'
                  ? 'Giải thích suy diễn, luật kích hoạt, độ tin cậy và nguồn đối chiếu có trong gói Pro / Ultra.'
                  : 'Reasoning explanations, triggered rules, confidence and source lookups are available on Pro / Ultra.'}
              </span>
              <Link
                to="/pricing"
                className="font-semibold text-indigo-600 dark:text-indigo-400 hover:underline"
              >
                {lang === 'vi' ? 'Nâng cấp' : 'Upgrade'}
              </Link>
            </div>
          )}
          {canViewDeep && (
            <div className="p-3 rounded-xl bg-white/90 dark:bg-slate-900/90 border border-slate-200/80 dark:border-slate-800 flex items-start gap-2.5">
              <Scale className="h-4 w-4 text-indigo-600 dark:text-indigo-400 shrink-0 mt-0.5" />
              <div>
                <h4 className="text-[11px] font-mono font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-0.5">
                  {lang === 'vi' ? 'Giải thích Suy diễn' : 'What this means'}
                </h4>
                <p className="text-xs sm:text-sm text-slate-700 dark:text-slate-300">
                  {getVerdictExplanation(verdict)}
                </p>
              </div>
            </div>
          )}

          <div className="grid sm:grid-cols-2 gap-4">
            {verdict.mismatched_fields.length > 0 && (
              <div>
                <h4 className="text-[11px] font-mono font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">
                  {lang === 'vi' ? 'Trường Không Khớp' : 'Mismatched Fields'}
                </h4>
                <div className="flex flex-wrap gap-1.5">
                  {verdict.mismatched_fields.map((field) => (
                    <Badge
                      key={field}
                      variant="metadata_error"
                      className="px-2 py-0.5 rounded-md text-xs font-mono"
                    >
                      {field}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {canViewDeep && verdict.triggered_rules.length > 0 && (
              <div>
                <h4 className="text-[11px] font-mono font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">
                  {lang === 'vi' ? 'Luật Kích Hoạt' : 'Triggered Rules'}
                </h4>
                <div className="flex flex-wrap gap-1.5">
                  {verdict.triggered_rules.map((rule) => (
                    <Badge
                      key={rule}
                      variant="outline"
                      className="px-2 py-0.5 rounded text-xs font-mono bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300"
                    >
                      {rule}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </div>

          {canViewDeep && sourceResults.length > 0 && (
            <div>
              <h4 className="text-[11px] font-mono font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">
                {lang === 'vi' ? 'Nguồn Đối Chiếu' : 'Source Lookup'}
              </h4>
              <div className="grid sm:grid-cols-2 gap-2">
                {sourceResults.map((source, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between px-3 py-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 text-xs"
                  >
                    <span className="flex items-center gap-2 font-medium text-slate-700 dark:text-slate-300">
                      <SourceIcon source={source.source} />
                      <span>{getSourceDisplayName(source.source)}</span>
                    </span>
                    <span className="font-mono text-[11px] text-emerald-600 dark:text-emerald-400 font-semibold">
                      MATCH
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {canViewDeep && verdict.confidence > 0 && (
            <div>
              <h4 className="text-[11px] font-mono font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">
                {lang === 'vi' ? 'Độ tin cậy' : 'Confidence'}
              </h4>
              <div className="flex items-center gap-2">
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
                <span className="text-xs font-mono font-semibold text-slate-600 dark:text-slate-300">
                  {Math.round(verdict.confidence * 100)}%
                </span>
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function SeveritySection({
  severity,
  verdicts,
  lang,
  canViewDeep,
}: {
  severity: Severity;
  verdicts: Verdict[];
  lang: 'vi' | 'en';
  canViewDeep: boolean;
}) {
  const config = severityConfig[severity];
  const [isOpen, setIsOpen] = useState(true);

  if (verdicts.length === 0) return null;

  return (
    <div className="space-y-3">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`w-full flex items-center justify-between px-4 py-3 rounded-xl border ${config.bgCard} ${config.borderCard} transition-all hover:opacity-95`}
      >
        <div className="flex items-center gap-3">
          <div
            className={`flex items-center justify-center w-8 h-8 rounded-lg ${config.bgClass} ${config.borderClass} border`}
          >
            <span className={config.iconColor}>{config.icon}</span>
          </div>
          <div className="text-left">
            <span className={`font-display font-bold text-sm ${config.textColor}`}>
              {lang === 'vi' ? config.labelVi : config.labelEn}
            </span>
            <span className="ml-2 text-xs font-mono text-slate-500 dark:text-slate-400">
              ({verdicts.length} {verdicts.length === 1 ? 'issue' : 'issues'})
            </span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className={`text-sm font-mono font-bold ${config.textColor}`}>
            {verdicts.length}
          </span>
          {isOpen ? (
            <ChevronUp className={`h-4 w-4 ${config.iconColor}`} />
          ) : (
            <ChevronDown className={`h-4 w-4 ${config.iconColor}`} />
          )}
        </div>
      </button>

      {isOpen && (
        <div className="space-y-2.5 pl-1">
          {verdicts.map((verdict) => (
            <IssueCard key={verdict.citation_id} verdict={verdict} lang={lang} canViewDeep={canViewDeep} />
          ))}
        </div>
      )}
    </div>
  );
}

export function IssuesPage() {
  const { id } = useParams<{ id: string }>();
  const { i18n } = useTranslation();
  const { has } = useRole();
  const canViewDeep = has('view_logic_trace');
  const lang: 'vi' | 'en' = i18n.language?.startsWith('vi') ? 'vi' : 'en';
  const [filter, setFilter] = useState<'all' | 'critical' | 'warning' | 'info'>('all');

  const numericId = id ? parseInt(id, 10) : null;
  const { report, error } = useEssayPolling(
    numericId !== null && !Number.isNaN(numericId) && numericId > 0 ? numericId : null
  );

  const issuesBySeverity = useMemo(() => {
    if (!report) return { critical: [], warning: [], info: [] };
    const issues = report.verdicts.filter((v) => v.label !== 'verified');
    return {
      critical: issues.filter((v) => getSeverity(v.label) === 'critical'),
      warning: issues.filter((v) => getSeverity(v.label) === 'warning'),
      info: issues.filter((v) => getSeverity(v.label) === 'info'),
    };
  }, [report]);

  const totalIssues = Object.values(issuesBySeverity).reduce(
    (sum, arr) => sum + arr.length,
    0
  );

  const displaySections = useMemo(() => {
    if (filter === 'all') {
      return [
        { severity: 'critical' as Severity, data: issuesBySeverity.critical },
        { severity: 'warning' as Severity, data: issuesBySeverity.warning },
        { severity: 'info' as Severity, data: issuesBySeverity.info },
      ];
    }
    return [
      {
        severity: filter as Severity,
        data: issuesBySeverity[filter as keyof typeof issuesBySeverity],
      },
    ];
  }, [filter, issuesBySeverity]);

  if (error) {
    return (
      <Alert variant="destructive" className="card p-6 rounded-2xl">
        <AlertCircle className="h-5 w-5" />
        <AlertTitle className="font-medium">Error loading issues</AlertTitle>
        <AlertDescription>
          <p className="text-sm mt-1">{error}</p>
          <Link
            to="/history"
            className="text-indigo-600 dark:text-indigo-400 hover:underline mt-2 inline-block"
          >
            ← Back to Reports
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
          Loading issues...
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
        <div className="text-xs font-mono text-slate-500 dark:text-slate-400">
          {lang === 'vi' ? 'Tổng vấn đề phát hiện:' : 'Total Flagged Issues:'}{' '}
          <strong className="text-amber-600 dark:text-amber-400">{totalIssues}</strong> /{' '}
          {report.verdicts.length} citations
        </div>
      </div>

      {/* 4 Summary Metric Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 shadow-2xs">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
              {lang === 'vi' ? 'Tổng vấn đề' : 'Total Issues'}
            </span>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
              01
            </span>
          </div>
          <p className="text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
            {totalIssues}
          </p>
        </Card>

        <Card className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-red-200/80 dark:border-red-900/70 shadow-2xs">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-medium text-red-600 dark:text-red-400">
              Critical
            </span>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-300">
              02
            </span>
          </div>
          <p className="text-2xl font-bold font-mono tabular-nums text-red-600 dark:text-red-400">
            {issuesBySeverity.critical.length}
          </p>
        </Card>

        <Card className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-amber-200/80 dark:border-amber-900/70 shadow-2xs">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-medium text-amber-600 dark:text-amber-400">
              Warning
            </span>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-300">
              03
            </span>
          </div>
          <p className="text-2xl font-bold font-mono tabular-nums text-amber-600 dark:text-amber-400">
            {issuesBySeverity.warning.length}
          </p>
        </Card>

        <Card className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 shadow-2xs">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
              Info
            </span>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
              04
            </span>
          </div>
          <p className="text-2xl font-bold font-mono tabular-nums text-slate-700 dark:text-slate-200">
            {issuesBySeverity.info.length}
          </p>
        </Card>
      </div>

      {/* IDE Window Container for Issues List */}
      <Card className="p-0 overflow-hidden rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm">
        {/* Top Window Chrome */}
        <div className="px-4 sm:px-6 py-3.5 bg-slate-50/80 dark:bg-slate-900/90 border-b border-slate-200/80 dark:border-slate-800 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-red-400/80 inline-block" />
              <span className="w-2.5 h-2.5 rounded-full bg-amber-400/80 inline-block" />
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400/80 inline-block" />
            </div>
            <Separator orientation="vertical" className="h-4" />
            <span className="font-mono text-xs font-semibold text-slate-700 dark:text-slate-300">
              {!canViewDeep
                ? lang === 'vi'
                  ? 'Danh mục Vấn đề'
                  : 'Issues List'
                : `anomaly_inspector.py · ${lang === 'vi' ? 'Danh mục Vấn đề' : 'Diagnostic Issues'}`}
            </span>
          </div>

          {/* Filter tabs inside Chrome Bar */}
          <div
            role="group"
            aria-label="Filter issues by severity"
            className="flex gap-1.5 flex-wrap"
          >
            {(['all', 'critical', 'warning', 'info'] as const).map((f) => {
              const isActive = filter === f;
              return (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  aria-pressed={isActive}
                  className={`px-3 py-1 rounded-lg text-xs font-mono font-semibold transition-all border ${
                    isActive
                      ? 'bg-indigo-600 text-white border-indigo-600'
                      : 'bg-white dark:bg-slate-950 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-800 hover:border-slate-300'
                  }`}
                >
                  {f.charAt(0).toUpperCase() + f.slice(1)}
                  {f !== 'all' && (
                    <span className="ml-1.5 opacity-80">
                      ({issuesBySeverity[f as keyof typeof issuesBySeverity].length})
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        <div className="p-5 sm:p-6">
          {totalIssues === 0 ? (
            <div className="p-10 text-center">
              <div className="flex justify-center mb-4">
                <div className="w-14 h-14 rounded-2xl bg-emerald-100 dark:bg-emerald-900/50 flex items-center justify-center">
                  <CheckCircle className="h-7 w-7 text-emerald-600 dark:text-emerald-400" />
                </div>
              </div>
              <h3 className="font-display text-lg font-bold text-slate-900 dark:text-slate-100 mb-1.5">
                {lang === 'vi' ? 'Không phát hiện vấn đề nào' : 'No Issues Found'}
              </h3>
              <p className="text-sm text-slate-600 dark:text-slate-400 max-w-md mx-auto">
                {lang === 'vi'
                  ? 'Tất cả trích dẫn và tài liệu tham khảo đã được xác minh hợp lệ qua cơ sở dữ liệu học thuật.'
                  : 'All citations and references have been verified successfully. No critical, warning, or info issues detected.'}
              </p>
            </div>
          ) : (
            <div className="space-y-5">
              {displaySections.map(({ severity, data }) => (
                <SeveritySection
                  key={severity}
                  severity={severity}
                  verdicts={data}
                  lang={lang}
                  canViewDeep={canViewDeep}
                />
              ))}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
