import { useState, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { type Verdict, type ValidationLabel } from '@/api/client';
import { VerdictBadge } from '@/components/VerdictBadge';
import { DecisionSupportBanner } from '@/components/DecisionSupportBanner';
import { UpgradeModal } from '@/components/UpgradeModal';
import {
  extractObservedWebMeta,
  getCitationMarkerLabel,
  getFieldDisplayName,
  getSourceDisplayName,
  getVerdictExplanation,
  isUrlResource,
} from '@/lib/verdictExplanation';
import {
  formatUserError,
  getMappingStatusDisplay,
  getVerdictDisplay,
} from '@/lib/academicTaxonomy';
import { useEssayPolling } from '@/hooks/useEssayPolling';
import { useRole } from '@/hooks/useRole';
import { EssayHeader } from './essay/EssayHeader';
import {
  ReportSummaryAndNavBar,
  getEffectiveVerdictKey,
  isActionableIssueVerdict,
} from './EssayPage';
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
  Globe,
  ArrowRight,
  ArrowLeft,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';

/* ============================================================
   SourceLogic — Issues Page Component
   Shows all actionable verification issues grouped by severity
   ============================================================ */

type Severity = 'critical' | 'warning' | 'info';

function getSeverity(v: Verdict): Severity {
  const effective: ValidationLabel = getEffectiveVerdictKey(v);
  switch (effective) {
    case 'suspected_hallucination':
      return 'critical';
    case 'metadata_error':
      return 'warning';
    case 'resource': {
      const urlSt = v.url_status ?? v.features?.url_status;
      if (urlSt === 'dead_link' || urlSt === 'fake_domain') return 'warning';
      if ((v.triggered_rules ?? []).includes('R-URL-CONTENT-MISMATCH')) return 'warning';
      return 'info';
    }
    case 'verified':
      return 'info';
    default:
      return 'info';
  }
}

const severityConfig = {
  critical: {
    labelEn: 'High Priority (Source Not Found)',
    labelVi: 'Cần ưu tiên kiểm tra (Không tìm thấy nguồn)',
    shortLabel: 'High Priority',
    bgClass: 'bg-red-50 dark:bg-red-950/70',
    borderClass: 'border-red-200 dark:border-red-800/80',
    icon: <XCircle className="h-4 w-4" />,
    iconColor: 'text-red-600 dark:text-red-400',
    textColor: 'text-red-700 dark:text-red-300',
    bgCard: 'bg-red-50/40 dark:bg-red-950/25',
    borderCard: 'border-red-200/80 dark:border-red-900/70',
  },
  warning: {
    labelEn: 'Warning (Details Mismatch)',
    labelVi: 'Cảnh báo (Sai lệch thông tin)',
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
    labelEn: 'Info (Unverified & Linking)',
    labelVi: 'Thông tin (Chưa đủ dữ liệu & Liên kết)',
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
  if (lower.includes('vn_legal')) return <span className="text-[11px] font-mono font-bold">VL</span>;
  if (lower.includes('web_html') || lower.includes('wayback_html')) return <Globe className="h-3.5 w-3.5" />;
  return <Database className="h-3.5 w-3.5" />;
}

function IssueCard({
  verdict,
  essayId,
  index,
  lang,
  canViewDeep,
}: {
  verdict: Verdict;
  essayId: number;
  index?: number;
  lang: 'vi' | 'en';
  /** Pro/Ultra plans, teachers and admins (`view_logic_trace` capability). */
  canViewDeep: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const severity = getSeverity(verdict);
  const config = severityConfig[severity];

  const resolvedMarker = getCitationMarkerLabel(verdict);
  const citationMarker =
    resolvedMarker !== '[?]'
      ? resolvedMarker
      : `[${verdict.citation_id.replace(/^v/i, '') || (index !== undefined ? index + 1 : '?')}]`;
  const displayCitationRaw =
    verdict.citation_raw.replace(/^\s*\[\s*\d+[a-z]?\s*\]\s*/i, '') ||
    verdict.citation_raw;

  const observedWeb = extractObservedWebMeta(verdict);
  const rawUrlStatus = verdict.url_status ?? verdict.features?.url_status;
  const hasArchiveFallback =
    Boolean(verdict.archive_url || verdict.features?.archive_url) ||
    (verdict.triggered_rules ?? []).includes('R-WAYBACK-ARCHIVED');
  const urlStatus =
    rawUrlStatus === 'archived_alive' ||
    (hasArchiveFallback &&
      rawUrlStatus !== 'alive' &&
      rawUrlStatus !== 'restricted_alive')
      ? 'archived_alive'
      : rawUrlStatus === 'alive' ||
          rawUrlStatus === 'restricted_alive' ||
          rawUrlStatus === 'dead_link' ||
          rawUrlStatus === 'fake_domain'
        ? rawUrlStatus
        : undefined;
  const urlStatusCode =
    verdict.url_status_code ?? verdict.features?.url_status_code;
  const isUrlContentMismatch = (verdict.triggered_rules ?? []).includes(
    'R-URL-CONTENT-MISMATCH',
  );

  function getIssueDescription(v: Verdict): string {
    if ((v.triggered_rules ?? []).includes('R-URL-CONTENT-MISMATCH')) {
      if (observedWeb?.title) {
        return lang === 'vi'
          ? `Nội dung trang web thực tế («${observedWeb.title}») không khớp với tiêu đề tài liệu trích dẫn.`
          : `Observed web page title (“${observedWeb.title}”) does not match the claimed citation title.`;
      }
      return lang === 'vi'
        ? 'Nội dung/tiêu đề trang web tại đường dẫn URL không khớp với tài liệu được trích dẫn.'
        : 'Cited web page title/metadata does not match the claimed citation title.';
    }
    if (isUrlResource(v)) {
      if (observedWeb?.title) {
        return lang === 'vi'
          ? `Tài nguyên Web trực tuyến: «${observedWeb.title}»${observedWeb.venue ? ` (${observedWeb.venue})` : ''}. Không tính vào điểm CIS.`
          : `Web resource: “${observedWeb.title}”${observedWeb.venue ? ` (${observedWeb.venue})` : ''}. Excluded from CIS scoring.`;
      }
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
      if ((v.triggered_rules ?? []).includes('R-INCOMPLETE-METADATA')) {
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
            ? `Thiếu quy cách trích dẫn (thiếu ${localizedFields.join(', ')})`
            : `Incomplete bibliographic reference (missing ${v.mismatched_fields.join(', ')})`;
        }
        return lang === 'vi'
          ? 'Thiếu quy cách trích dẫn (thiếu tác giả, năm xuất bản hoặc nơi công bố).'
          : 'Incomplete bibliographic reference (missing author, year, or venue).';
      }
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
    return getVerdictExplanation(v, lang);
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
              {citationMarker}
            </span>
            <VerdictBadge
              verdict={isUrlResource(verdict) ? 'resource' : verdict.label}
              triggeredRules={verdict.triggered_rules}
              size="sm"
            />
            {urlStatus && (
              <span
                data-testid="issue-url-status-badge"
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-mono font-semibold border ${
                  isUrlContentMismatch
                    ? 'bg-amber-50 dark:bg-amber-950/70 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800'
                    : urlStatus === 'alive'
                      ? 'bg-emerald-50 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800'
                      : urlStatus === 'restricted_alive'
                        ? 'bg-sky-50 dark:bg-sky-950/70 text-sky-700 dark:text-sky-300 border-sky-200 dark:border-sky-800'
                        : urlStatus === 'archived_alive'
                          ? 'bg-indigo-50 dark:bg-indigo-950/70 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800'
                          : 'bg-red-50 dark:bg-red-950/70 text-red-700 dark:text-red-300 border-red-200 dark:border-red-800'
                }`}
              >
                {isUrlContentMismatch
                  ? `⚠ HTTP ${urlStatusCode ?? 200} · ${lang === 'vi' ? 'Sai nội dung trang' : 'Wrong Page'}`
                  : urlStatus === 'alive'
                    ? `✓ HTTP ${urlStatusCode ?? 200} OK`
                    : urlStatus === 'restricted_alive'
                      ? lang === 'vi'
                        ? `🔒 Truy cập hạn chế (HTTP ${urlStatusCode ?? 403})`
                        : `🔒 Restricted Access (HTTP ${urlStatusCode ?? 403})`
                      : urlStatus === 'archived_alive'
                        ? lang === 'vi'
                          ? '🏛️ Bản lưu Wayback'
                          : '🏛️ Wayback Archived'
                        : urlStatus === 'dead_link'
                          ? lang === 'vi'
                            ? `✕ Liên kết lỗi (HTTP ${urlStatusCode ?? 404})`
                            : `✕ Broken Link (HTTP ${urlStatusCode ?? 404})`
                          : lang === 'vi'
                            ? '✕ URL không hợp lệ'
                            : '✕ Invalid URL'}
              </span>
            )}
            {verdict.mapping_status && verdict.mapping_status !== 'matched' && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium bg-orange-50 dark:bg-orange-950/60 text-orange-700 dark:text-orange-300 border border-orange-200 dark:border-orange-800">
                {getMappingStatusDisplay(verdict.mapping_status, lang).label}
              </span>
            )}
            {canViewDeep && (
              <span className="text-xs font-mono text-slate-500 dark:text-slate-400">
                {lang === 'vi' ? 'Độ tin cậy:' : 'Confidence:'}{' '}
                <strong>{Math.round(verdict.confidence * 100)}%</strong>
              </span>
            )}
          </div>
          <p className="text-sm text-slate-900 dark:text-slate-100 mb-1.5 font-serif break-words [overflow-wrap:anywhere]">
            {displayCitationRaw}
          </p>
          <p className={`text-xs font-medium break-words [overflow-wrap:anywhere] ${config.textColor}`}>
            {getIssueDescription(verdict)}
          </p>
          {observedWeb &&
            (observedWeb.title ||
              observedWeb.venue ||
              observedWeb.authors?.length ||
              observedWeb.year) && (
              <div
                data-testid="issue-observed-web-meta"
                className="mt-2 px-3 py-2 rounded-lg bg-white/80 dark:bg-slate-900/80 border border-slate-200/80 dark:border-slate-800 text-xs space-y-0.5"
              >
                <div className="font-mono text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  {observedWeb.isArchived
                    ? lang === 'vi'
                      ? 'Metadata Bản lưu Wayback Machine'
                      : 'Wayback Machine Archived Metadata'
                    : lang === 'vi'
                      ? 'Metadata Trang Web Trực tiếp (HTML)'
                      : 'Live Web Page Metadata (HTML)'}
                </div>
                {observedWeb.title && (
                  <div className="font-medium text-slate-800 dark:text-slate-200 break-words">
                    {observedWeb.title}
                  </div>
                )}
                {(observedWeb.authors?.length ||
                  observedWeb.year ||
                  observedWeb.venue) && (
                  <div className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                    {[
                      observedWeb.authors?.join(', '),
                      observedWeb.year,
                      observedWeb.venue,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </div>
                )}
              </div>
            )}
        </div>
        <button
          onClick={() => setExpanded(!expanded)}
          className={`p-2 rounded-xl bg-white/80 dark:bg-slate-900/80 border border-slate-200/80 dark:border-slate-800 hover:bg-white dark:hover:bg-slate-800 transition-colors ${config.iconColor}`}
          aria-label={
            lang === 'vi'
              ? expanded
                ? 'Thu gọn chi tiết'
                : 'Mở rộng chi tiết'
              : expanded
                ? 'Collapse details'
                : 'Expand details'
          }
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
                  ? 'Giải thích suy diễn, tiêu chí kiểm tra, độ tin cậy và nguồn đối chiếu có trong gói Pro / Ultra.'
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
                  {lang === 'vi' ? 'Giải thích kiểm tra' : 'What this means'}
                </h4>
                <p className="text-xs sm:text-sm text-slate-700 dark:text-slate-300">
                  {getVerdictExplanation(verdict, lang)}
                </p>
              </div>
            </div>
          )}

          <div className="grid sm:grid-cols-2 gap-4">
            {verdict.mismatched_fields.length > 0 && (
              <div>
                <h4 className="text-[11px] font-mono font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">
                  {lang === 'vi' ? 'Trường sai lệch' : 'Mismatched Fields'}
                </h4>
                <div className="flex flex-wrap gap-1.5">
                  {verdict.mismatched_fields.map((field) => (
                    <Badge
                      key={field}
                      variant="metadata_error"
                      className="px-2 py-0.5 rounded-md text-xs"
                    >
                      {getFieldDisplayName(field, lang).replace(/^the\s+/i, '')}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {canViewDeep && verdict.triggered_rules.length > 0 && (
              <div>
                <h4 className="text-[11px] font-mono font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">
                  {lang === 'vi' ? 'Tiêu chí kích hoạt' : 'Triggered Rules'}
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
                {lang === 'vi' ? 'Nguồn đối chiếu' : 'Source Lookup'}
              </h4>
              <div className="grid sm:grid-cols-2 gap-2">
                {sourceResults.map((source, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between px-3 py-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 text-xs"
                  >
                    <span className="flex items-center gap-2 font-medium text-slate-700 dark:text-slate-300">
                      <SourceIcon source={source.source} />
                      <span>
                        {source.source?.toLowerCase() === 'vn_legal_registry' &&
                        lang === 'en'
                          ? 'VN Legal Registry'
                          : getSourceDisplayName(source.source, lang, {
                              triggered_rules: verdict.triggered_rules,
                              external_ids: source.external_ids,
                              venue: source.venue,
                              title: source.title,
                            })}
                      </span>
                    </span>
                    {(() => {
                      const conf =
                        typeof source.confidence === 'number' ? source.confidence : null;
                      const isHighMatch =
                        verdict.label === 'verified' ||
                        (verdict.label !== 'suspected_hallucination' &&
                          (conf === null || conf >= 0.8) &&
                          (source.matched_fields?.length ?? 0) >= 2);
                      const isLowCandidate =
                        verdict.label === 'suspected_hallucination' ||
                        (conf !== null && conf < 0.6);
                      if (isHighMatch) {
                        return (
                          <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-semibold">
                            {lang === 'vi' ? 'Khớp nguồn' : 'Matched'}
                          </span>
                        );
                      }
                      return (
                        <span
                          data-testid="issue-source-candidate-badge"
                          className={`text-[11px] font-semibold px-1.5 py-0.5 rounded ${
                            isLowCandidate
                              ? 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                              : 'bg-amber-50 dark:bg-amber-950/70 text-amber-700 dark:text-amber-300'
                          }`}
                        >
                          {isLowCandidate
                            ? conf !== null
                              ? lang === 'vi'
                                ? `Độ tin cậy thấp (${Math.round(conf * 100)}%)`
                                : `Low Confidence (${Math.round(conf * 100)}%)`
                              : lang === 'vi'
                                ? 'Ứng viên'
                                : 'Candidate'
                            : lang === 'vi'
                              ? 'Khớp một phần'
                              : 'Partial Match'}
                        </span>
                      );
                    })()}
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

          {/* Direct Action Link back into L1 Citation Inspector (BUG-29) */}
          <div className="flex justify-end pt-1">
            <Link
              data-testid="issue-inspect-citation-link"
              to={`/verification/report/${essayId}?citation=${encodeURIComponent(
                verdict.citation_id,
              )}`}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm transition-colors"
            >
              <span>
                {lang === 'vi' ? 'Xem chi tiết trích dẫn' : 'Inspect Citation'}
              </span>
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      )}
    </Card>
  );
}

function SeveritySection({
  severity,
  essayId,
  verdicts,
  lang,
  canViewDeep,
}: {
  severity: Severity;
  essayId: number;
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
              ({verdicts.length}{' '}
              {lang === 'vi'
                ? 'vấn đề'
                : verdicts.length === 1
                  ? 'issue'
                  : 'issues'}
              )
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
          {verdicts.map((verdict, idx) => (
            <IssueCard
              key={verdict.citation_id}
              verdict={verdict}
              essayId={essayId}
              index={idx}
              lang={lang}
              canViewDeep={canViewDeep}
            />
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
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [lockedFeatureName, setLockedFeatureName] = useState('');

  const numericId = id ? parseInt(id, 10) : null;
  const { report, error } = useEssayPolling(
    numericId !== null && !Number.isNaN(numericId) && numericId > 0 ? numericId : null
  );

  // Exclude valid web/legal resources (no broken URL or mapping error) from actionable issues (BUG-02)
  const issuesBySeverity = useMemo(() => {
    if (!report) return { critical: [], warning: [], info: [] };
    const issues = report.verdicts.filter(isActionableIssueVerdict);
    return {
      critical: issues.filter((v) => getSeverity(v) === 'critical'),
      warning: issues.filter((v) => getSeverity(v) === 'warning'),
      info: issues.filter((v) => getSeverity(v) === 'info'),
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
      <div
        data-testid="issues-error-card"
        className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 sm:p-8 shadow-sm max-w-2xl mx-auto my-8"
      >
        <div className="flex items-start gap-4">
          <div className="h-12 w-12 rounded-2xl bg-amber-50 dark:bg-amber-950/70 border border-amber-200 dark:border-amber-800 flex items-center justify-center shrink-0">
            <AlertCircle className="h-6 w-6 text-amber-600 dark:text-amber-400" />
          </div>
          <div className="space-y-3 flex-1 min-w-0">
            <h2 className="font-display text-lg font-bold text-slate-900 dark:text-slate-100">
              {lang === 'vi'
                ? 'Không thể tải danh mục vấn đề'
                : 'Unable to Load Issues'}
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
        <span className="ml-3 text-slate-600 dark:text-slate-300 font-mono text-sm">
          {lang === 'vi' ? 'Đang tải danh mục vấn đề...' : 'Loading issues...'}
        </span>
      </div>
    );
  }

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

      {/* Unified Persistent 5-Layer Score Summary & Navigation Bar (BUG-19) */}
      <ReportSummaryAndNavBar
        essayId={id ?? String(report.essay_id)}
        report={report}
        activeLayer="issues"
        onOpenLockedFeature={(featureName) => {
          setLockedFeatureName(featureName);
          setUpgradeOpen(true);
        }}
      />

      {/* Non-Accusatory Academic Decision-Support Disclaimer (BUG-03) */}
      <DecisionSupportBanner variant="compact" lang={lang} />

      {/* 4 Summary Metric Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 shadow-sm">
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

        <Card className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-red-200/80 dark:border-red-900/70 shadow-sm">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-medium text-red-600 dark:text-red-400">
              {getVerdictDisplay('suspected_hallucination', lang).label}
            </span>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-300">
              02
            </span>
          </div>
          <p className="text-2xl font-bold font-mono tabular-nums text-red-600 dark:text-red-400">
            {issuesBySeverity.critical.length}
          </p>
        </Card>

        <Card className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-amber-200/80 dark:border-amber-900/70 shadow-sm">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-medium text-amber-600 dark:text-amber-400">
              {getVerdictDisplay('metadata_error', lang).label}
            </span>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-300">
              03
            </span>
          </div>
          <p className="text-2xl font-bold font-mono tabular-nums text-amber-600 dark:text-amber-400">
            {issuesBySeverity.warning.length}
          </p>
        </Card>

        <Card className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 shadow-sm">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
              {lang === 'vi' ? 'Chưa đủ dữ liệu & Liên kết' : 'Unverified & Linking'}
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

      {/* Clean Container for Issues List */}
      <Card className="p-0 overflow-hidden rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm">
        <div className="px-4 sm:px-6 py-3.5 bg-slate-50/80 dark:bg-slate-900/90 border-b border-slate-200/80 dark:border-slate-800 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
            <span className="text-xs sm:text-sm font-bold text-slate-800 dark:text-slate-200">
              {lang === 'vi'
                ? `Danh mục vấn đề cần rà soát (${totalIssues})`
                : `Issues Requiring Review (${totalIssues})`}
            </span>
          </div>

          <div
            role="group"
            aria-label={
              lang === 'vi'
                ? 'Lọc vấn đề theo mức độ ưu tiên'
                : 'Filter issues by priority'
            }
            className="flex gap-1.5 flex-wrap"
          >
            {(['all', 'critical', 'warning', 'info'] as const).map((f) => {
              const isActive = filter === f;
              const filterLabels: Record<typeof f, { en: string; vi: string }> = {
                all: { en: 'All', vi: 'Tất cả' },
                critical: { en: 'Source Not Found', vi: 'Không tìm thấy nguồn' },
                warning: { en: 'Details Mismatch', vi: 'Sai lệch thông tin' },
                info: { en: 'Unverified / Linking', vi: 'Chưa đủ dữ liệu' },
              };
              return (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFilter(f)}
                  aria-pressed={isActive}
                  className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all border cursor-pointer ${
                    isActive
                      ? 'bg-indigo-600 text-white border-indigo-600'
                      : 'bg-white dark:bg-slate-950 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-800 hover:border-slate-300'
                  }`}
                >
                  {filterLabels[f][lang]}
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
                  : 'All citations and references have been verified successfully. No issues detected.'}
              </p>
            </div>
          ) : (
            <div className="space-y-5">
              {displaySections.map(({ severity, data }) => (
                <SeveritySection
                  key={severity}
                  severity={severity}
                  essayId={report.essay_id}
                  verdicts={data}
                  lang={lang}
                  canViewDeep={canViewDeep}
                />
              ))}
            </div>
          )}
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
