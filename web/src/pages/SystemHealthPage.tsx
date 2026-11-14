import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Activity,
  Database,
  FileCheck,
  Users,
  AlertCircle,
  ShieldCheck,
  Terminal,
  Loader2,
  UserCheck,
  GraduationCap,
  Trash2,
  Clock,
} from 'lucide-react';
import { useToast } from '@/contexts/ToastContext';
import { ConfirmationModal } from '@/components/ConfirmationModal';
import { Button } from '@/components/ui/button';
import { api, type CircuitBreakerState, type SystemHealth, type UpstreamSourceHealth } from '@/api/client';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { Alert, AlertDescription } from '@/components/ui/alert';

type HealthLevel = 'healthy' | 'degraded' | 'down';

const HEALTHY_WORDS = new Set(['ok', 'healthy', 'up', 'alive', 'ready', 'pass']);

const CACHE_STAT_LABELS: Record<string, { en: string; vi: string }> = {
  total: { en: 'Total Cached Entries', vi: 'Tổng mục lưu đệm' },
  total_hits: { en: 'Total Cache Hits', vi: 'Tổng lượt trúng đệm' },
  avg_hit_count: { en: 'Avg Hits / Entry', vi: 'Trung bình trúng / mục' },
  local_papers_count: { en: 'Local Corpus Papers', vi: 'Bài báo kho cục bộ' },
  local_queries_count: { en: 'Local Corpus Queries', vi: 'Truy vấn kho cục bộ' },
  local_hit_rate_percent: { en: 'Local Hit Rate (%)', vi: 'Tỷ lệ trúng cục bộ (%)' },
  persistent_entries: { en: 'Persistent SQLite Entries', vi: 'Mục lưu đệm SQLite bền vững' },
  persistent_hits: { en: 'Persistent SQLite Hits', vi: 'Lượt trúng đệm SQLite bền vững' },
  hit_rate_percent: { en: 'Cache Hit Rate (%)', vi: 'Tỷ lệ trúng đệm (%)' },
};

const UPSTREAM_PROVIDER_LABELS: Record<string, string> = {
  openalex: 'OpenAlex',
  crossref: 'Crossref',
  semanticscholar: 'Semantic Scholar',
  semantic_scholar: 'Semantic Scholar',
  arxiv: 'arXiv',
  europepmc: 'Europe PMC',
  europe_pmc: 'Europe PMC',
  dblp: 'DBLP',
  openlibrary: 'Open Library',
  open_library: 'Open Library',
  pubmed: 'PubMed',
  datacite: 'DataCite',
  doi_ra: 'DOI Registration Agency',
  doaj: 'DOAJ',
  openaire_hal: 'OpenAIRE / HAL',
  ncbi_biorxiv: 'NCBI / bioRxiv',
  huggingface: 'Hugging Face',
  tech_standard: 'Tech Standards',
  wikidata_opencitations: 'Wikidata / OpenCitations',
  serpapi: 'SerpAPI (Google Scholar)',
  vn_registry: 'VN Academic Registry',
  html_head: 'HTML Meta Verifier',
  local_db: 'Local Corpus DB',
  known_papers: 'Curated Known Papers',
};

function formatProviderName(key: string): string {
  const normalized = key.trim().toLowerCase();
  if (UPSTREAM_PROVIDER_LABELS[normalized]) {
    return UPSTREAM_PROVIDER_LABELS[normalized];
  }
  return key
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function formatMetricNumber(val: number): string {
  if (!Number.isFinite(val)) return '0';
  return String(Number(val.toFixed(1)));
}

function getCircuitVisuals(
  state: CircuitBreakerState,
  lang: 'en' | 'vi',
): {
  canonical: 'CLOSED' | 'HALF_OPEN' | 'OPEN';
  caption: string;
  tooltip: string;
  pillClass: string;
  dotClass: string;
} {
  if (state === 'open') {
    return {
      canonical: 'OPEN',
      caption: lang === 'vi' ? 'Ngắt mạch' : 'Tripped',
      tooltip:
        lang === 'vi'
          ? 'Mạch đang mở do lỗi hạ tầng liên tiếp — tạm ngưng gọi API cho tới khi hết thời gian chờ'
          : 'Circuit open after consecutive infrastructure failures — fast-failing until cooldown expires',
      pillClass:
        'bg-rose-50 dark:bg-rose-950/70 border-rose-200/80 dark:border-rose-800/70 text-rose-700 dark:text-rose-300',
      dotClass: 'bg-rose-500 animate-pulse',
    };
  }
  if (state === 'half_open') {
    return {
      canonical: 'HALF_OPEN',
      caption: lang === 'vi' ? 'Thăm dò' : 'Probing',
      tooltip:
        lang === 'vi'
          ? 'Mạch bán mở — cho phép 1 yêu cầu thăm dò để kiểm tra khả năng phục hồi của nguồn'
          : 'Half-open recovery state — allowing a single probe request to verify upstream health',
      pillClass:
        'bg-amber-50 dark:bg-amber-950/70 border-amber-200/80 dark:border-amber-800/70 text-amber-700 dark:text-amber-300',
      dotClass: 'bg-amber-500 animate-pulse',
    };
  }
  return {
    canonical: 'CLOSED',
    caption: lang === 'vi' ? 'Ổn định' : 'Healthy',
    tooltip:
      lang === 'vi'
        ? 'Mạch đóng — nguồn học thuật phản hồi bình thường'
        : 'Circuit closed — upstream scholarly API operating normally',
    pillClass:
      'bg-emerald-50 dark:bg-emerald-950/70 border-emerald-200/80 dark:border-emerald-800/70 text-emerald-700 dark:text-emerald-300',
    dotClass: 'bg-emerald-500',
  };
}

function formatCacheStatLabel(key: string, lang: 'en' | 'vi'): string {
  const mapped = CACHE_STAT_LABELS[key];
  if (mapped) return mapped[lang];
  return key
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function normalizeLevel(raw: unknown): HealthLevel {
  const value = String(raw ?? '').trim().toLowerCase();
  if (HEALTHY_WORDS.has(value)) return 'healthy';
  if (value === 'degraded' || value === 'partial' || value === 'warn' || value === 'warning') {
    return 'degraded';
  }
  return 'down';
}

/** Derive overall status + list of non-healthy services from the health payload. */
export function summarizeHealth(data: Pick<SystemHealth, 'status' | 'services'>): {
  level: HealthLevel;
  degradedServices: string[];
} {
  const degradedServices = Object.entries(data.services ?? {})
    .filter(([, v]) => normalizeLevel(typeof v === 'string' ? v : v?.status) !== 'healthy')
    .map(([name]) => name);
  let level = normalizeLevel(data.status);
  if (level === 'healthy' && degradedServices.length > 0) level = 'degraded';
  return { level, degradedServices };
}

export function SystemHealthPage() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language?.startsWith('vi') ? 'vi' : 'en';
  const toast = useToast();
  const [data, setData] = useState<SystemHealth | null>(null);
  const [error, setError] = useState('');
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);
  const [clearing, setClearing] = useState(false);

  const load = useCallback(() => {
    api
      .getSystemHealth()
      .then(setData)
      .catch((e) => setError(String(e)));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleClearCache = async () => {
    setConfirmClearOpen(false);
    setClearing(true);
    try {
      const res = await api.clearCache();
      toast.success(
        lang === 'vi' ? 'Đã xóa bộ nhớ đệm' : 'Cache cleared',
        lang === 'vi'
          ? `Đã xóa ${res.deleted_count} mục khỏi bộ nhớ đệm tra cứu.`
          : `Removed ${res.deleted_count} cached lookup entries.`,
      );
      load();
    } catch (e) {
      toast.error(
        lang === 'vi' ? 'Không thể xóa bộ nhớ đệm' : 'Failed to clear cache',
        e instanceof Error ? e.message : String(e),
      );
    } finally {
      setClearing(false);
    }
  };

  if (error) {
    return (
      <Alert variant="destructive" className="rounded-2xl">
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>
          {t('common.error')}: {error}
        </AlertDescription>
      </Alert>
    );
  }
  if (!data) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 text-indigo-600 dark:text-indigo-400 animate-spin" />
        <span className="ml-3 text-slate-500 font-mono text-sm">
          {t('common.loading')}
        </span>
      </div>
    );
  }

  const totalVerdicts = Math.max(data.totals.verdicts, 1);
  const health = summarizeHealth(data);
  const pillTone =
    health.level === 'healthy'
      ? 'bg-emerald-50 dark:bg-emerald-950/70 border-emerald-200/70 dark:border-emerald-800/70 text-emerald-700 dark:text-emerald-300'
      : health.level === 'degraded'
        ? 'bg-amber-50 dark:bg-amber-950/70 border-amber-200/70 dark:border-amber-800/70 text-amber-700 dark:text-amber-300'
        : 'bg-red-50 dark:bg-red-950/70 border-red-200/70 dark:border-red-800/70 text-red-700 dark:text-red-300';
  const dotTone =
    health.level === 'healthy'
      ? 'bg-emerald-500'
      : health.level === 'degraded'
        ? 'bg-amber-500'
        : 'bg-red-500';
  const degradedList = health.degradedServices.join(', ');
  const pillText =
    health.level === 'healthy'
      ? lang === 'vi'
        ? 'TẤT CẢ DỊCH VỤ ỔN ĐỊNH'
        : 'ALL SERVICES HEALTHY'
      : health.level === 'degraded'
        ? lang === 'vi'
          ? `SUY GIẢM${degradedList ? `: ${degradedList}` : ''}`
          : `DEGRADED${degradedList ? `: ${degradedList}` : ''}`
        : lang === 'vi'
          ? `SỰ CỐ (${String(data.status).toUpperCase()})${degradedList ? `: ${degradedList}` : ''}`
          : `OUTAGE (${String(data.status).toUpperCase()})${degradedList ? `: ${degradedList}` : ''}`;
  const rawCacheStats = data.cache_stats ?? {};
  const cacheEntries: Array<[string, unknown]> = Object.entries(rawCacheStats).filter(
    ([, v]) => v === null || ['string', 'number', 'boolean'].includes(typeof v),
  );
  if (
    typeof rawCacheStats.total === 'number' &&
    typeof rawCacheStats.local_papers_count === 'number' &&
    !('persistent_entries' in rawCacheStats)
  ) {
    cacheEntries.push([
      'persistent_entries',
      Math.max(0, rawCacheStats.total - rawCacheStats.local_papers_count),
    ]);
  }
  if (
    typeof rawCacheStats.total_hits === 'number' &&
    typeof rawCacheStats.local_queries_count === 'number' &&
    !('persistent_hits' in rawCacheStats)
  ) {
    cacheEntries.push([
      'persistent_hits',
      Math.max(0, rawCacheStats.total_hits - rawCacheStats.local_queries_count),
    ]);
  }
  const cacheBySourceEntries: Array<[string, number]> =
    rawCacheStats.by_source &&
    typeof rawCacheStats.by_source === 'object' &&
    !Array.isArray(rawCacheStats.by_source)
      ? Object.entries(rawCacheStats.by_source as Record<string, unknown>)
          .filter((entry): entry is [string, number] => typeof entry[1] === 'number' && entry[1] > 0)
          .sort((a, b) => b[1] - a[1])
      : [];

  const upstreamEntries: Array<[string, UpstreamSourceHealth]> = Object.entries(
    data.upstream_sources ?? {},
  )
    .filter((entry): entry is [string, UpstreamSourceHealth] =>
      Boolean(entry[1] && typeof entry[1] === 'object'),
    )
    .sort(([a], [b]) => a.localeCompare(b));
  const openCircuitsCount = upstreamEntries.filter(
    ([, s]) => String(s.state ?? '').toLowerCase() === 'open',
  ).length;
  const halfOpenCircuitsCount = upstreamEntries.filter(
    ([, s]) => String(s.state ?? '').toLowerCase() === 'half_open',
  ).length;
  const closedCircuitsCount =
    upstreamEntries.length - openCircuitsCount - halfOpenCircuitsCount;

  return (
    <div className="space-y-6 pb-10">
      {/* Executive Header Card */}
      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 p-5 sm:p-6 shadow-xs">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2.5 flex-wrap mb-2.5">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-violet-50 dark:bg-violet-950/80 border border-violet-200/70 dark:border-violet-800/70 text-[11px] font-mono font-semibold text-violet-700 dark:text-violet-300">
                <ShieldCheck className="h-3.5 w-3.5" />
                {lang === 'vi' ? 'GIÁM SÁT HẠ TẦNG HỆ THỐNG' : 'PLATFORM TELEMETRY MONITOR'}
              </span>
              <span
                data-testid="health-status-pill"
                data-level={health.level}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[11px] font-mono ${pillTone}`}
              >
                <span className={`w-1.5 h-1.5 rounded-full animate-pulse ${dotTone}`} />
                {pillText}
              </span>
            </div>

            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-violet-50 dark:bg-violet-950/80 border border-violet-200/70 dark:border-violet-800/70 flex items-center justify-center shrink-0">
                <Activity className="h-5 w-5 text-violet-600 dark:text-violet-400" />
              </div>
              <div>
                <h1 className="font-display text-2xl sm:text-3xl font-bold text-slate-900 dark:text-white tracking-tight">
                  {t('admin.systemHealth')}
                </h1>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
                  {t('admin.systemHealthSubtitle')}
                </p>
              </div>
            </div>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={clearing}
            onClick={() => setConfirmClearOpen(true)}
            data-testid="clear-cache-btn"
            className="rounded-xl text-xs shrink-0"
          >
            {clearing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Trash2 className="h-3.5 w-3.5" />
            )}
            {lang === 'vi' ? 'Xóa bộ nhớ đệm' : 'Clear cache'}
          </Button>
        </div>
      </div>

      {/* 6 Architectural Metric Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <Card className="p-4 sm:p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 shadow-2xs">
          <div className="flex items-center justify-between mb-2">
            <div className="p-2 rounded-xl bg-indigo-50 dark:bg-indigo-950/80 border border-indigo-200/60 dark:border-indigo-800/60">
              <Users className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
            </div>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-indigo-50 dark:bg-indigo-950/80 text-indigo-600 dark:text-indigo-400">
              01
            </span>
          </div>
          <p className="text-2xl sm:text-3xl font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
            {data.totals.users}
          </p>
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mt-1">
            {t('admin.totalUsers')}
          </p>
        </Card>

        <Card className="p-4 sm:p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 shadow-2xs">
          <div className="flex items-center justify-between mb-2">
            <div className="p-2 rounded-xl bg-violet-50 dark:bg-violet-950/80 border border-violet-200/60 dark:border-violet-800/60">
              <ShieldCheck className="h-4 w-4 text-violet-600 dark:text-violet-400" />
            </div>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-violet-50 dark:bg-violet-950/80 text-violet-600 dark:text-violet-400">
              02
            </span>
          </div>
          <p className="text-2xl sm:text-3xl font-bold font-mono tabular-nums text-violet-600 dark:text-violet-400">
            {data.totals.admins}
          </p>
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mt-1">
            {t('admin.admins')}
          </p>
        </Card>

        <Card className="p-4 sm:p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 shadow-2xs">
          <div className="flex items-center justify-between mb-2">
            <div className="p-2 rounded-xl bg-emerald-50 dark:bg-emerald-950/80 border border-emerald-200/60 dark:border-emerald-800/60">
              <GraduationCap className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            </div>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/80 text-emerald-600 dark:text-emerald-400">
              03
            </span>
          </div>
          <p className="text-2xl sm:text-3xl font-bold font-mono tabular-nums text-emerald-600 dark:text-emerald-400">
            {data.totals.teachers}
          </p>
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mt-1">
            {t('admin.teachers')}
          </p>
        </Card>

        <Card className="p-4 sm:p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 shadow-2xs">
          <div className="flex items-center justify-between mb-2">
            <div className="p-2 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
              <UserCheck className="h-4 w-4 text-slate-600 dark:text-slate-300" />
            </div>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
              04
            </span>
          </div>
          <p className="text-2xl sm:text-3xl font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
            {data.totals.students}
          </p>
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mt-1">
            {t('admin.students')}
          </p>
        </Card>

        <Card className="p-4 sm:p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 shadow-2xs">
          <div className="flex items-center justify-between mb-2">
            <div className="p-2 rounded-xl bg-indigo-50 dark:bg-indigo-950/80 border border-indigo-200/60 dark:border-indigo-800/60">
              <FileCheck className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
            </div>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-indigo-50 dark:bg-indigo-950/80 text-indigo-600 dark:text-indigo-400">
              05
            </span>
          </div>
          <p className="text-2xl sm:text-3xl font-bold font-mono tabular-nums text-indigo-600 dark:text-indigo-400">
            {data.totals.essays}
          </p>
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mt-1">
            {t('admin.essays')}
          </p>
        </Card>

        <Card className="p-4 sm:p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 shadow-2xs">
          <div className="flex items-center justify-between mb-2">
            <div className="p-2 rounded-xl bg-amber-50 dark:bg-amber-950/80 border border-amber-200/60 dark:border-amber-800/60">
              <Database className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            </div>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-50 dark:bg-amber-950/80 text-amber-600 dark:text-amber-400">
              06
            </span>
          </div>
          <p className="text-2xl sm:text-3xl font-bold font-mono tabular-nums text-amber-600 dark:text-amber-400">
            {data.totals.verdicts}
          </p>
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mt-1">
            {t('admin.verdicts')}
          </p>
        </Card>
      </div>

      {/* IDE Container for Verdict Label Distribution */}
      <div className="rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 bg-slate-50/90 dark:bg-slate-900/90 border-b border-slate-200/80 dark:border-slate-800">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex items-center gap-1.5 shrink-0">
              <span className="w-2.5 h-2.5 rounded-full bg-red-400/80" />
              <span className="w-2.5 h-2.5 rounded-full bg-amber-400/80" />
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400/80" />
            </div>
            <Separator orientation="vertical" className="h-4" />
            <Terminal className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400 shrink-0" />
            <span className="text-xs font-mono font-semibold text-slate-700 dark:text-slate-200 truncate">
              telemetry_verdict_distribution.json
            </span>
          </div>
          <span className="text-[11px] font-mono text-slate-400">
            {lang === 'vi'
              ? `${data.totals.verdicts} bản ghi tổng cộng`
              : `${data.totals.verdicts} total records`}
          </span>
        </div>

        <div className="p-4 sm:p-6">
          <h2 className="text-sm font-display font-semibold text-slate-900 dark:text-white mb-4">
            {t('admin.verdictsByLabel')}
          </h2>
          <div className="space-y-3.5">
            {Object.entries(data.verdict_label_counts).map(([label, count]) => {
              const pct = Math.round((count / totalVerdicts) * 100);
              const barColor =
                label === 'verified'
                  ? 'bg-emerald-500'
                  : label === 'metadata_error'
                  ? 'bg-amber-500'
                  : label === 'suspected_hallucination'
                  ? 'bg-rose-500'
                  : 'bg-indigo-500';
              return (
                <div
                  key={label}
                  className="p-3.5 rounded-xl bg-slate-50/70 dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-800"
                >
                  <div className="flex items-center justify-between text-sm mb-2">
                    <span className="text-slate-700 dark:text-slate-300 font-mono text-xs font-semibold">
                      {label}
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono text-slate-400">{pct}%</span>
                      <Badge variant="secondary" className="font-mono font-semibold">
                        {count}
                      </Badge>
                    </div>
                  </div>
                  <Progress
                    value={pct}
                    className="h-1.5"
                    indicatorClassName={barColor}
                  />
                </div>
              );
            })}
          </div>
        </div>
      </div>
      {/* Scholarly Upstream Providers & Circuit Breakers (Subsystem B4) */}
      <div
        data-testid="upstream-sources-panel"
        className="rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm overflow-hidden"
      >
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 bg-slate-50/90 dark:bg-slate-900/90 border-b border-slate-200/80 dark:border-slate-800">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex items-center gap-1.5 shrink-0">
              <span className="w-2.5 h-2.5 rounded-full bg-red-400/80" />
              <span className="w-2.5 h-2.5 rounded-full bg-amber-400/80" />
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400/80" />
            </div>
            <Separator orientation="vertical" className="h-4" />
            <Terminal className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400 shrink-0" />
            <span className="text-xs font-mono font-semibold text-slate-700 dark:text-slate-200 truncate">
              telemetry_upstream_circuits.json
            </span>
          </div>
          <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
            {upstreamEntries.length === 0
              ? lang === 'vi'
                ? '0 mạch ghi nhận'
                : '0 active circuits'
              : lang === 'vi'
                ? `${closedCircuitsCount} đóng · ${halfOpenCircuitsCount} thăm dò · ${openCircuitsCount} ngắt`
                : `${closedCircuitsCount} closed · ${halfOpenCircuitsCount} half-open · ${openCircuitsCount} open`}
          </span>
        </div>

        <div className="p-4 sm:p-6">
          <h2 className="text-sm font-display font-semibold text-slate-900 dark:text-white">
            {lang === 'vi'
              ? 'Nguồn Học Thuật & Ngắt Mạch Tự Động'
              : 'Scholarly Upstream Providers & Circuit Breakers'}
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 mb-4">
            {lang === 'vi'
              ? 'Trạng thái ngắt mạch 3 pha theo thời gian thực, độ trễ trung bình trượt (EMA) và thống kê giới hạn tốc độ từng nguồn học thuật.'
              : 'Real-time 3-state circuit breaker status, exponential moving average (EMA) latency, and rate-limit telemetry per scholarly API.'}
          </p>

          {upstreamEntries.length === 0 ? (
            <div
              data-testid="upstream-sources-empty"
              className="p-4 rounded-xl bg-slate-50/70 dark:bg-slate-800/40 border border-dashed border-slate-200 dark:border-slate-700 text-xs text-slate-500 dark:text-slate-400"
            >
              {lang === 'vi'
                ? 'Chưa ghi nhận lượt gọi API học thuật nào trên tiến trình hiện tại. Độ trễ và trạng thái ngắt mạch từng nguồn sẽ tự động hiển thị ngay khi có truy vấn.'
                : 'No upstream scholarly API calls recorded in this worker process yet. Per-provider latency and circuit states appear automatically once lookups run.'}
            </div>
          ) : (
            <div className="w-full overflow-x-auto rounded-xl border border-slate-200/80 dark:border-slate-800">
              <table
                data-testid="upstream-circuit-table"
                className="w-full min-w-[640px] text-left border-collapse text-xs"
              >
                <thead>
                  <tr className="bg-slate-50/90 dark:bg-slate-800/60 border-b border-slate-200/80 dark:border-slate-800 text-[11px] font-mono uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    <th className="py-2.5 px-3.5 font-semibold">
                      {lang === 'vi' ? 'Nguồn học thuật' : 'Provider'}
                    </th>
                    <th className="py-2.5 px-3.5 font-semibold">
                      {lang === 'vi' ? 'Trạng thái mạch' : 'Circuit State'}
                    </th>
                    <th className="py-2.5 px-3.5 font-semibold">
                      {lang === 'vi' ? 'Độ trễ EMA' : 'EMA Latency'}
                    </th>
                    <th className="py-2.5 px-3.5 font-semibold">
                      {lang === 'vi' ? 'Thành công / Gọi' : 'Success / Calls'}
                    </th>
                    <th className="py-2.5 px-3.5 font-semibold">
                      {lang === 'vi' ? 'Lỗi 429' : 'HTTP 429'}
                    </th>
                    <th className="py-2.5 px-3.5 font-semibold">
                      {lang === 'vi' ? 'Quá hạn & 5xx' : 'Timeouts & 5xx'}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200/70 dark:divide-slate-800">
                  {upstreamEntries.map(([sourceKey, info]) => {
                    const rawState = String(info.state ?? 'closed').toLowerCase();
                    const normalizedState: CircuitBreakerState =
                      rawState === 'open' || rawState === 'half_open' ? rawState : 'closed';
                    const visuals = getCircuitVisuals(normalizedState, lang);
                    const totalCalls = Number(info.total_calls ?? 0);
                    const successCount = Number(info.success_count ?? 0);
                    const http429Count = Number(info.http_429_count ?? 0);
                    const timeoutCount = Number(info.timeout_count ?? 0);
                    const http5xxCount = Number(info.http_5xx_count ?? 0);
                    const consecutiveFailures = Number(info.consecutive_failures ?? 0);
                    const emaLatencyMs = Number(info.ema_latency_ms ?? 0);
                    const openRemainingSeconds = Number(info.open_remaining_seconds ?? 0);
                    const successRatePct =
                      totalCalls > 0 ? Math.round((successCount / totalCalls) * 100) : null;
                    return (
                      <tr
                        key={sourceKey}
                        data-testid={`upstream-row-${sourceKey}`}
                        className="hover:bg-slate-50/60 dark:hover:bg-slate-800/30 transition-colors"
                      >
                        <td className="py-3 px-3.5 align-middle">
                          <div className="flex flex-col gap-0.5">
                            <span className="font-semibold text-slate-900 dark:text-slate-100">
                              {formatProviderName(sourceKey)}
                            </span>
                            <span className="text-[10px] font-mono text-slate-400 dark:text-slate-500">
                              {sourceKey}
                            </span>
                          </div>
                        </td>
                        <td className="py-3 px-3.5 align-middle">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span
                              data-testid={`circuit-badge-${sourceKey}`}
                              data-state={normalizedState}
                              title={visuals.tooltip}
                              className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border text-[11px] font-mono font-semibold ${visuals.pillClass}`}
                            >
                              <span className={`w-1.5 h-1.5 rounded-full ${visuals.dotClass}`} />
                              {visuals.canonical}
                            </span>
                            <span className="text-[11px] text-slate-500 dark:text-slate-400">
                              {visuals.caption}
                            </span>
                            {normalizedState === 'open' && openRemainingSeconds > 0 && (
                              <span
                                data-testid={`circuit-cooldown-${sourceKey}`}
                                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-rose-50 dark:bg-rose-950/60 border border-rose-200/70 dark:border-rose-800/70 text-[10px] font-mono text-rose-700 dark:text-rose-300"
                              >
                                <Clock className="h-3 w-3" />
                                {lang === 'vi'
                                  ? `Thử lại sau ${formatMetricNumber(openRemainingSeconds)}s`
                                  : `Retry in ${formatMetricNumber(openRemainingSeconds)}s`}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="py-3 px-3.5 align-middle font-mono tabular-nums text-slate-800 dark:text-slate-200">
                          {`${formatMetricNumber(emaLatencyMs)} ms`}
                        </td>
                        <td className="py-3 px-3.5 align-middle font-mono tabular-nums text-slate-800 dark:text-slate-200">
                          <span>{`${successCount} / ${totalCalls}`}</span>
                          {successRatePct !== null && (
                            <span className="ml-1.5 text-[11px] text-slate-400">
                              {`(${successRatePct}%)`}
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-3.5 align-middle">
                          <span
                            data-testid={`upstream-429-${sourceKey}`}
                            className={`inline-flex items-center px-2 py-0.5 rounded font-mono tabular-nums font-semibold ${
                              http429Count > 0
                                ? 'bg-amber-50 dark:bg-amber-950/70 text-amber-700 dark:text-amber-300 border border-amber-200/70 dark:border-amber-800/70'
                                : 'text-slate-500 dark:text-slate-400'
                            }`}
                          >
                            {http429Count}
                          </span>
                        </td>
                        <td className="py-3 px-3.5 align-middle font-mono tabular-nums text-slate-700 dark:text-slate-300">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span>
                              {lang === 'vi'
                                ? `Quá hạn: ${timeoutCount} · 5xx: ${http5xxCount}`
                                : `Timeouts: ${timeoutCount} · 5xx: ${http5xxCount}`}
                            </span>
                            {consecutiveFailures > 0 && (
                              <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-[10px] text-rose-600 dark:text-rose-400">
                                {lang === 'vi'
                                  ? `Liên tiếp: ${consecutiveFailures}`
                                  : `Streak: ${consecutiveFailures}`}
                              </span>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {cacheEntries.length > 0 && (
        <div
          data-testid="cache-stats"
          className="rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm p-4 sm:p-6"
        >
          <h2 className="text-sm font-display font-semibold text-slate-900 dark:text-white mb-3">
            {lang === 'vi' ? 'Thống kê bộ nhớ đệm' : 'Cache statistics'}
          </h2>
          <dl className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {cacheEntries.map(([key, value]) => (
              <div
                key={key}
                className="p-3 rounded-xl bg-slate-50/70 dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-800"
              >
                <dt className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                  {formatCacheStatLabel(key, lang)}
                </dt>
                <dd className="text-lg font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
                  {String(value)}
                </dd>
              </div>
            ))}
          </dl>
          {cacheBySourceEntries.length > 0 && (
            <div className="mt-4 pt-3.5 border-t border-slate-200/80 dark:border-slate-800">
              <p className="text-[11px] font-mono text-slate-500 dark:text-slate-400 mb-2">
                {lang === 'vi' ? 'Phân bổ lưu đệm theo nguồn' : 'Cached Entries by Source'}
              </p>
              <div className="flex flex-wrap gap-2">
                {cacheBySourceEntries.map(([sourceKey, count]) => (
                  <span
                    key={sourceKey}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700 text-xs font-mono text-slate-700 dark:text-slate-200"
                  >
                    <span className="font-semibold">{formatProviderName(sourceKey)}</span>
                    <span className="text-indigo-600 dark:text-indigo-400 font-bold tabular-nums">
                      {count}
                    </span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <ConfirmationModal
        isOpen={confirmClearOpen}
        variant="danger"
        title={lang === 'vi' ? 'Xóa toàn bộ bộ nhớ đệm?' : 'Clear the lookup cache?'}
        message={
          lang === 'vi'
            ? 'Mọi kết quả tra cứu học thuật đã lưu sẽ bị xóa; các lần phân tích tiếp theo sẽ gọi lại API nguồn và có thể chậm hơn.'
            : 'All cached scholarly lookups will be deleted; upcoming analyses will re-query source APIs and may be slower.'
        }
        confirmLabel={lang === 'vi' ? 'Xóa bộ nhớ đệm' : 'Clear cache'}
        cancelLabel={lang === 'vi' ? 'Hủy' : 'Cancel'}
        onConfirm={handleClearCache}
        onCancel={() => setConfirmClearOpen(false)}
      />
    </div>
  );
}
