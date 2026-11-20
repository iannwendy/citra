import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Activity,
  Database,
  FileCheck,
  Users,
  AlertCircle,
  ShieldCheck,
  Loader2,
  UserCheck,
  GraduationCap,
  Trash2,
  Clock,
  HardDrive,
  RotateCcw,
  Globe,
  Zap,
  SlidersHorizontal,
} from 'lucide-react';
import { useToast } from '@/contexts/ToastContext';
import { ConfirmationModal } from '@/components/ConfirmationModal';
import { Button } from '@/components/ui/button';
import {
  api,
  type CircuitBreakerState,
  type SystemHealth,
  type UpstreamSourceHealth,
} from '@/api/client';
import { getHumanVerdictMeta } from '@/lib/teacherGuidance';
import { Card } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  StudioWindowHeader,
  ProportionalBarRow,
  PipelineStageFlow,
} from '@/components/ui/studio-visuals';
import {
  AccordionExpand,
  DonutChart,
  NumberPopIn,
  ScoreRing,
  SymmetricChevron,
} from '@/components/ui/transitions';

type HealthLevel = 'healthy' | 'degraded' | 'down';

const HEALTHY_WORDS = new Set(['ok', 'healthy', 'up', 'alive', 'ready', 'pass']);

const CACHE_STAT_LABELS: Record<string, { en: string; vi: string }> = {
  total: { en: 'Total Cached Entries', vi: 'Tổng mục lưu đệm' },
  total_hits: { en: 'Total Cache Hits', vi: 'Tổng lượt trúng đệm' },
  avg_hit_count: { en: 'Avg Hits / Entry', vi: 'Trung bình trúng / mục' },
  local_papers_count: { en: 'Local Corpus Papers', vi: 'Bài báo kho cục bộ' },
  local_queries_count: { en: 'Local Corpus Queries', vi: 'Truy vấn kho cục bộ' },
  local_hits_count: { en: 'Local Corpus Hits', vi: 'Lượt trúng kho cục bộ' },
  local_hit_rate_percent: { en: 'Local Hit Rate (%)', vi: 'Tỷ lệ trúng cục bộ (%)' },
  persistent_entries: {
    en: 'Persistent SQLite Entries',
    vi: 'Mục lưu đệm SQLite bền vững',
  },
  expired_entries: { en: 'Expired Cache Entries', vi: 'Mục lưu đệm đã hết hạn' },
  persistent_hits: {
    en: 'Persistent SQLite Hits',
    vi: 'Lượt trúng đệm SQLite bền vững',
  },
  hit_rate_percent: { en: 'Cache Hit Rate (%)', vi: 'Tỷ lệ trúng đệm (%)' },
  session_hits: { en: 'Session Cache Hits (B1)', vi: 'Lượt trúng phiên RAM (B1)' },
  session_misses: {
    en: 'Session Cache Misses (B1)',
    vi: 'Lượt trượt phiên RAM (B1)',
  },
  session_hit_rate_percent: {
    en: 'Session Hit Rate (%)',
    vi: 'Tỷ lệ trúng phiên RAM (%)',
  },
  wave0_entries: { en: 'Wave-0 Prefetch Entries', vi: 'Mục tiền nạp Wave-0' },
  negative_cache_entries: {
    en: 'Negative Cache Entries',
    vi: 'Mục đệm âm (Không tồn tại)',
  },
  singleflight_coalesced: {
    en: 'Singleflight Coalesced',
    vi: 'Truy vấn gộp Singleflight',
  },
};

const UPSTREAM_PROVIDER_LABELS: Record<
  string,
  string | { en: string; vi: string }
> = {
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
  vn_tech_standard: {
    en: 'VN Tech Standards (TCVN/QCVN)',
    vi: 'Tiêu chuẩn Kỹ thuật VN (TCVN/QCVN)',
  },
  vn_textbook_registry: {
    en: 'VN Textbook Registry',
    vi: 'Danh mục Giáo trình ĐH VN',
  },
  vn_legal_registry: {
    en: 'VN Legal Registry (VBQPPL)',
    vi: 'Cơ sở dữ liệu Pháp luật VN',
  },
  web_html_meta: { en: 'Web HTML Metadata', vi: 'Siêu dữ liệu HTML Web' },
  wayback_html_meta: {
    en: 'Wayback Machine Archive',
    vi: 'Lưu trữ Wayback Machine',
  },
  wikidata_opencitations: 'Wikidata / OpenCitations',
  wikidata_opencitatio: 'Wikidata / OpenCitations',
  url_check: { en: 'URL Check', vi: 'Kiểm chứng URL' },
  clean_miss: {
    en: 'Verified Clean Miss',
    vi: 'Không có bản ghi (Đã xác thực)',
  },
  serpapi: 'SerpAPI (Google Scholar)',
  acl: 'ACL Anthology',
  coreapi: 'CORE',
  vn_registry: 'VN Academic Registry',
  html_head: 'HTML Meta Verifier',
  local_db: 'Local Corpus DB',
  known_papers: 'Curated Known Papers',
};

function formatProviderName(key: string, lang: 'en' | 'vi' = 'en'): string {
  const normalized = key.trim().toLowerCase();
  const mapped = UPSTREAM_PROVIDER_LABELS[normalized];
  if (mapped) {
    return typeof mapped === 'string' ? mapped : mapped[lang];
  }
  return key
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function formatMetricNumber(val: number): string {
  if (!Number.isFinite(val)) return '0';
  return String(Number(val.toFixed(1)));
}

function formatSqliteSyncMode(raw: unknown): string {
  if (raw === 0 || raw === '0') return 'OFF';
  if (raw === 1 || raw === '1') return 'NORMAL';
  if (raw === 2 || raw === '2') return 'FULL';
  if (raw === 3 || raw === '3') return 'EXTRA';
  if (typeof raw === 'string' && raw.trim()) return raw.trim().toUpperCase();
  return 'NORMAL';
}

function formatLocalPapersDbMode(
  localDb: Record<string, unknown> | null | undefined,
): string {
  if (!localDb || typeof localDb !== 'object') return 'N/A';
  if (localDb.available === false) return 'UNAVAILABLE';
  if (typeof localDb.mode === 'string' && localDb.mode.trim()) {
    return localDb.mode.trim().toUpperCase();
  }
  if (
    localDb.read_only === true ||
    localDb.query_only === true ||
    localDb.query_only === 1
  ) {
    const jm =
      typeof localDb.journal_mode === 'string' && localDb.journal_mode.trim()
        ? ` · ${localDb.journal_mode.trim().toUpperCase()}`
        : '';
    return `READ-ONLY${jm}`;
  }
  if (typeof localDb.journal_mode === 'string' && localDb.journal_mode.trim()) {
    return localDb.journal_mode.trim().toUpperCase();
  }
  return 'CONNECTED';
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
  if (
    value === 'degraded' ||
    value === 'partial' ||
    value === 'warn' ||
    value === 'warning'
  ) {
    return 'degraded';
  }
  return 'down';
}

/** Derive overall status + list of non-healthy services from the health payload. */
export function summarizeHealth(
  data: Pick<SystemHealth, 'status' | 'services'>,
): {
  level: HealthLevel;
  degradedServices: string[];
} {
  const degradedServices = Object.entries(data.services ?? {})
    .filter(
      ([, v]) =>
        normalizeLevel(typeof v === 'string' ? v : v?.status) !== 'healthy',
    )
    .map(([name]) => name);
  let level = normalizeLevel(data.status);
  if (level === 'healthy' && degradedServices.length > 0) level = 'degraded';
  return { level, degradedServices };
}

export function SystemHealthPage() {
  const { t, i18n } = useTranslation();
  const lang: 'en' | 'vi' = i18n.language?.startsWith('vi') ? 'vi' : 'en';
  const toast = useToast();
  const [data, setData] = useState<SystemHealth | null>(null);
  const [error, setError] = useState('');
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [resettingBreaker, setResettingBreaker] = useState<string | null>(null);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);

  const load = useCallback(() => {
    api
      .getSystemHealth()
      .then(setData)
      .catch((e) => setError(String(e)));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleResetBreaker = async (source?: string) => {
    const key = source ?? '__all__';
    setResettingBreaker(key);
    try {
      if (typeof api.resetCircuitBreaker === 'function') {
        await api.resetCircuitBreaker(source);
      }
      toast.success(
        lang === 'vi' ? 'Đã đặt lại ngắt mạch' : 'Circuit breaker reset',
        source
          ? lang === 'vi'
            ? `Đã khôi phục mạch cho ${formatProviderName(source, lang)}.`
            : `Reset circuit breaker for ${formatProviderName(source, lang)}.`
          : lang === 'vi'
            ? 'Đã khôi phục tất cả các mạch đang mở.'
            : 'All tripped circuit breakers have been reset.',
      );
      load();
    } catch (e) {
      toast.error(
        lang === 'vi'
          ? 'Không thể đặt lại ngắt mạch'
          : 'Failed to reset circuit breaker',
        e instanceof Error ? e.message : String(e),
      );
    } finally {
      setResettingBreaker(null);
    }
  };

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
        <span className="ml-3 text-slate-500 text-sm">{t('common.loading')}</span>
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
  const hasSeparatedCorpusMetrics =
    'persistent_entries' in rawCacheStats ||
    'local_papers_count' in rawCacheStats;
  const dynamicCacheEntries = Number(
    rawCacheStats.persistent_entries ??
      (typeof rawCacheStats.total === 'number' &&
      typeof rawCacheStats.local_papers_count === 'number'
        ? Math.max(0, rawCacheStats.total - rawCacheStats.local_papers_count)
        : (rawCacheStats.total ?? 0)),
  );
  const localCorpusPapers = Number(rawCacheStats.local_papers_count ?? 0);
  const persistentHits =
    rawCacheStats.persistent_hits != null
      ? Number(rawCacheStats.persistent_hits)
      : typeof rawCacheStats.total_hits === 'number' &&
          typeof rawCacheStats.local_queries_count === 'number'
        ? Math.max(
            0,
            rawCacheStats.total_hits - rawCacheStats.local_queries_count,
          )
        : Number(rawCacheStats.total_hits ?? 0);

  const cacheHitRatePct = Number(
    rawCacheStats.hit_rate_percent ??
      rawCacheStats.local_hit_rate_percent ??
      rawCacheStats.session_hit_rate_percent ??
      0,
  );

  const hasB1SessionTelemetry =
    rawCacheStats.session_hit_rate_percent != null ||
    rawCacheStats.wave0_entries != null ||
    rawCacheStats.singleflight_coalesced != null ||
    rawCacheStats.negative_cache_entries != null ||
    rawCacheStats.session_hits != null ||
    rawCacheStats.session_misses != null;

  const cacheEntries: Array<[string, unknown]> = Object.entries(
    rawCacheStats,
  ).filter(
    ([k, v]) =>
      (k !== 'total' || !hasSeparatedCorpusMetrics) &&
      (v === null || ['string', 'number', 'boolean'].includes(typeof v)),
  );
  if (
    typeof rawCacheStats.total === 'number' &&
    typeof rawCacheStats.local_papers_count === 'number' &&
    !('persistent_entries' in rawCacheStats)
  ) {
    cacheEntries.push(['persistent_entries', dynamicCacheEntries]);
  }
  if (
    typeof rawCacheStats.total_hits === 'number' &&
    typeof rawCacheStats.local_queries_count === 'number' &&
    !('persistent_hits' in rawCacheStats)
  ) {
    cacheEntries.push(['persistent_hits', persistentHits]);
  }

  const hasBySourceObject = Boolean(
    rawCacheStats.by_source &&
      typeof rawCacheStats.by_source === 'object' &&
      !Array.isArray(rawCacheStats.by_source),
  );
  const cacheBySourceEntries: Array<[string, number]> = hasBySourceObject
    ? Object.entries(rawCacheStats.by_source as Record<string, unknown>)
        .filter(
          (entry): entry is [string, number] =>
            typeof entry[1] === 'number' && entry[1] > 0,
        )
        .sort((a, b) => b[1] - a[1])
    : [];

  const localCorpusBySourceEntries: Array<[string, number]> =
    rawCacheStats.local_corpus_by_source &&
    typeof rawCacheStats.local_corpus_by_source === 'object' &&
    !Array.isArray(rawCacheStats.local_corpus_by_source)
      ? Object.entries(
          rawCacheStats.local_corpus_by_source as Record<string, unknown>,
        )
          .filter(
            (entry): entry is [string, number] =>
              typeof entry[1] === 'number' && entry[1] > 0,
          )
          .sort((a, b) => b[1] - a[1])
      : [];

  const appSqliteWal =
    data.sqlite_wal?.app_db && typeof data.sqlite_wal.app_db === 'object'
      ? data.sqlite_wal.app_db
      : null;
  const localPapersSqliteWal =
    data.sqlite_wal?.local_papers_db &&
    typeof data.sqlite_wal.local_papers_db === 'object'
      ? data.sqlite_wal.local_papers_db
      : null;

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

  const verdictEntries = Object.entries(data.verdict_label_counts ?? {});
  const rawVerdictSum = verdictEntries.reduce((acc, [, c]) => acc + c, 0);

  return (
    <div className="space-y-5 pb-10">
      {/* Live System Pulse Header + 3-Stage Architecture Flow Diagram */}
      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 p-5 sm:p-6 shadow-sm space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3.5 min-w-0">
            <div className="w-11 h-11 rounded-2xl bg-violet-50 dark:bg-violet-950/80 border border-violet-200/70 dark:border-violet-800/70 flex items-center justify-center shrink-0">
              <Activity className="h-5 w-5 text-violet-600 dark:text-violet-400" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2.5 flex-wrap">
                <h1 className="font-display text-2xl sm:text-3xl font-bold text-slate-900 dark:text-white tracking-tight">
                  {t('admin.systemHealth')}
                </h1>
                <span
                  data-testid="health-status-pill"
                  data-level={health.level}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full border text-[11px] font-semibold ${pillTone}`}
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full animate-pulse ${dotTone}`}
                  />
                  {pillText}
                </span>
              </div>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
                {lang === 'vi'
                  ? 'Theo dõi trực quan luồng xử lý tài liệu, tốc độ kết nối nguồn học thuật và bộ nhớ tăng tốc.'
                  : 'Visual overview of document processing, scholarly data connections, and lookup speed.'}
              </p>
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

        {/* Visual 3-Stage Pipeline Flow Diagram */}
        <PipelineStageFlow
          data-testid="system-pipeline-flow"
          stages={[
            {
              id: 'parser-db',
              stepLabel: lang === 'vi' ? 'CHẶNG 1' : 'STAGE 1',
              title:
                lang === 'vi' ? 'Đọc & Lưu trữ Tài liệu' : 'Document Engine & DB',
              level: health.level,
              statusText:
                health.level === 'healthy'
                  ? lang === 'vi'
                    ? 'Sẵn sàng'
                    : 'Ready'
                  : lang === 'vi'
                    ? 'Cần kiểm tra'
                    : 'Attention',
              icon: (
                <FileCheck className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
              ),
              metric: (
                <p className="text-xs text-slate-600 dark:text-slate-300">
                  <span className="text-base font-bold font-mono text-slate-900 dark:text-white mr-1.5">
                    {data.totals.essays}
                  </span>
                  {lang === 'vi' ? 'tài liệu đã xử lý' : 'documents analyzed'}
                </p>
              ),
            },
            {
              id: 'scholarly-network',
              stepLabel: lang === 'vi' ? 'CHẶNG 2' : 'STAGE 2',
              title:
                lang === 'vi'
                  ? '15+ Nguồn Học thuật'
                  : 'Scholarly API Network',
              level:
                openCircuitsCount > 0
                  ? 'degraded'
                  : halfOpenCircuitsCount > 0
                    ? 'degraded'
                    : 'healthy',
              statusText:
                openCircuitsCount > 0
                  ? lang === 'vi'
                    ? `${openCircuitsCount} tạm ngắt`
                    : `${openCircuitsCount} paused`
                  : lang === 'vi'
                    ? 'Thông suốt'
                    : 'Connected',
              icon: (
                <Globe className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              ),
              metric: (
                <p className="text-xs text-slate-600 dark:text-slate-300">
                  {upstreamEntries.length > 0 ? (
                    <>
                      <span className="text-base font-bold font-mono text-emerald-600 dark:text-emerald-400 mr-1.5">
                        {closedCircuitsCount}/{upstreamEntries.length}
                      </span>
                      {lang === 'vi' ? 'nguồn ổn định' : 'sources healthy'}
                    </>
                  ) : lang === 'vi' ? (
                    'Chờ truy vấn mới'
                  ) : (
                    'Standby for queries'
                  )}
                </p>
              ),
            },
            {
              id: 'lookup-cache',
              stepLabel: lang === 'vi' ? 'CHẶNG 3' : 'STAGE 3',
              title:
                lang === 'vi' ? 'Bộ nhớ Tăng tốc' : 'Smart Lookup Cache',
              level: 'healthy',
              statusText: lang === 'vi' ? 'Tối ưu' : 'Accelerated',
              icon: (
                <Zap className="h-4 w-4 text-amber-500 dark:text-amber-400" />
              ),
              metric: (
                <p className="text-xs text-slate-600 dark:text-slate-300">
                  <span className="text-base font-bold font-mono text-indigo-600 dark:text-indigo-400 mr-1.5">
                    {localCorpusPapers > 0
                      ? localCorpusPapers.toLocaleString('en-US')
                      : dynamicCacheEntries.toLocaleString('en-US')}
                  </span>
                  {localCorpusPapers > 0
                    ? lang === 'vi'
                      ? 'bài báo tích hợp sẵn'
                      : 'built-in papers'
                    : lang === 'vi'
                      ? 'mục lưu tạm'
                      : 'cached lookups'}
                </p>
              ),
              actionSlot:
                cacheHitRatePct > 0 ? (
                  <ScoreRing
                    value={cacheHitRatePct}
                    size={36}
                    thickness={3.8}
                    color="#10b981"
                  />
                ) : undefined,
            },
          ]}
        />
      </div>

      {/* Compact Platform Scale Strip (Zero numbered corner tags) */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          {
            label: t('admin.totalUsers'),
            value: data.totals.users,
            icon: Users,
            tone: 'text-slate-900 dark:text-slate-100',
            box: 'bg-indigo-50 dark:bg-indigo-950/80 text-indigo-600 dark:text-indigo-400',
          },
          {
            label: t('admin.admins'),
            value: data.totals.admins,
            icon: ShieldCheck,
            tone: 'text-violet-600 dark:text-violet-400',
            box: 'bg-violet-50 dark:bg-violet-950/80 text-violet-600 dark:text-violet-400',
          },
          {
            label: t('admin.teachers'),
            value: data.totals.teachers ?? 0,
            icon: GraduationCap,
            tone: 'text-emerald-600 dark:text-emerald-400',
            box: 'bg-emerald-50 dark:bg-emerald-950/80 text-emerald-600 dark:text-emerald-400',
          },
          {
            label: t('admin.students'),
            value: data.totals.students,
            icon: UserCheck,
            tone: 'text-slate-900 dark:text-slate-100',
            box: 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300',
          },
          {
            label: t('admin.essays'),
            value: data.totals.essays,
            icon: FileCheck,
            tone: 'text-indigo-600 dark:text-indigo-400',
            box: 'bg-indigo-50 dark:bg-indigo-950/80 text-indigo-600 dark:text-indigo-400',
          },
          {
            label: t('admin.verdicts'),
            value: data.totals.verdicts,
            icon: Database,
            tone: 'text-amber-600 dark:text-amber-400',
            box: 'bg-amber-50 dark:bg-amber-950/80 text-amber-600 dark:text-amber-400',
          },
        ].map((item) => {
          const Icon = item.icon;
          return (
            <Card
              key={item.label}
              className="p-3.5 sm:p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 shadow-sm"
            >
              <div className="flex items-center gap-2 mb-2">
                <div className={`p-1.5 rounded-lg ${item.box}`}>
                  <Icon className="h-3.5 w-3.5" />
                </div>
                <span className="text-xs font-medium text-slate-500 dark:text-slate-400 truncate">
                  {item.label}
                </span>
              </div>
              <p className={`text-2xl font-bold font-mono tabular-nums ${item.tone}`}>
                <NumberPopIn value={item.value} />
              </p>
            </Card>
          );
        })}
      </div>

      {/* Verdict Distribution Visual Studio */}
      <div className="rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm overflow-hidden">
        <StudioWindowHeader
          title={
            lang === 'vi'
              ? 'PHÂN BỔ KẾT QUẢ KIỂM CHỨNG'
              : 'VERDICT DISTRIBUTION'
          }
          rightSlot={
            <span className="text-xs font-mono text-slate-500 dark:text-slate-400">
              {lang === 'vi'
                ? `${data.totals.verdicts} bản ghi tổng cộng`
                : `${data.totals.verdicts} total records`}
            </span>
          }
        />

        <div className="p-4 sm:p-6 flex flex-col md:flex-row md:items-center gap-6">
          <div className="flex items-center justify-center shrink-0">
            <DonutChart
              size={112}
              thickness={13}
              segments={
                rawVerdictSum > 0
                  ? verdictEntries.map(([label, count]) => ({
                      value: count,
                      color: getHumanVerdictMeta(label, lang).colorHex,
                    }))
                  : [{ value: 1, color: '#cbd5e1' }]
              }
              centerContent={
                <div className="text-center">
                  <span className="text-lg font-bold font-mono tabular-nums text-slate-900 dark:text-white block leading-none">
                    {data.totals.verdicts}
                  </span>
                  <span className="text-[10px] text-slate-400">
                    {lang === 'vi' ? 'kết quả' : 'verdicts'}
                  </span>
                </div>
              }
            />
          </div>

          <div className="flex-1 min-w-0 space-y-2.5">
            <h2 className="text-sm font-display font-semibold text-slate-900 dark:text-white">
              {t('admin.verdictsByLabel')}
            </h2>
            {verdictEntries.length === 0 ? (
              <p className="text-xs text-slate-400">
                {lang === 'vi'
                  ? 'Chưa có dữ liệu kết quả kiểm chứng.'
                  : 'No verdict records yet.'}
              </p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {verdictEntries.map(([label, count]) => {
                  const pct = Math.round((count / totalVerdicts) * 100);
                  const meta = getHumanVerdictMeta(label, lang);
                  return (
                    <ProportionalBarRow
                      key={label}
                      label={meta.label}
                      count={count}
                      sublabel={`${pct}%`}
                      value={count}
                      max={totalVerdicts}
                      barClass={meta.barClass}
                    />
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Scholarly Upstream Providers & Circuit Breakers */}
      <div
        data-testid="upstream-sources-panel"
        className="rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm overflow-hidden"
      >
        <StudioWindowHeader
          title={
            lang === 'vi'
              ? 'KẾT NỐI NGUỒN HỌC THUẬT'
              : 'SCHOLARLY DATA SOURCES'
          }
          rightSlot={
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="text-xs text-slate-500 dark:text-slate-400">
                {upstreamEntries.length === 0
                  ? lang === 'vi'
                    ? '0 nguồn đang chạy'
                    : '0 active sources'
                  : lang === 'vi'
                    ? `${closedCircuitsCount} ổn định · ${halfOpenCircuitsCount} thăm dò · ${openCircuitsCount} tạm ngắt`
                    : `${closedCircuitsCount} healthy · ${halfOpenCircuitsCount} probing · ${openCircuitsCount} paused`}
              </span>
              {openCircuitsCount + halfOpenCircuitsCount > 0 && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  data-testid="reset-all-breakers-btn"
                  disabled={resettingBreaker !== null}
                  onClick={() => void handleResetBreaker()}
                  className="h-7 px-2.5 rounded-lg text-xs font-semibold border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/60"
                >
                  {resettingBreaker === '__all__' ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <RotateCcw className="h-3 w-3" />
                  )}
                  <span>
                    {lang === 'vi' ? 'Khôi phục tất cả' : 'Reset All Breakers'}
                  </span>
                </Button>
              )}
            </div>
          }
        />

        <div className="p-4 sm:p-6">
          <h2 className="text-sm font-display font-semibold text-slate-900 dark:text-white">
            {lang === 'vi'
              ? 'Nguồn Học Thuật & Ngắt Mạch Tự Động'
              : 'Scholarly Upstream Providers & Circuit Breakers'}
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 mb-4">
            {lang === 'vi'
              ? 'Trạng thái kết nối và tốc độ phản hồi thực tế của từng kho dữ liệu khoa học.'
              : 'Live connection health and response speed across integrated scholarly registries.'}
          </p>

          {upstreamEntries.length === 0 ? (
            <div
              data-testid="upstream-sources-empty"
              className="p-6 rounded-xl bg-slate-50/70 dark:bg-slate-800/40 border border-dashed border-slate-200 dark:border-slate-700 text-xs text-slate-500 dark:text-slate-400 text-center"
            >
              {lang === 'vi'
                ? 'Chưa có truy vấn nguồn ngoài nào trong phiên này. Trạng thái và tốc độ từng nguồn sẽ tự động hiển thị ngay khi hệ thống tra cứu bài báo.'
                : 'No external scholarly lookups recorded in this session yet. Source speed and status appear automatically once checks run.'}
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
                      {lang === 'vi' ? 'Trạng thái' : 'Status'}
                    </th>
                    <th className="py-2.5 px-3.5 font-semibold">
                      {lang === 'vi' ? 'Tốc độ phản hồi' : 'Response Speed'}
                    </th>
                    <th className="py-2.5 px-3.5 font-semibold">
                      {lang === 'vi' ? 'Tỷ lệ thành công' : 'Success Rate'}
                    </th>
                    <th className="py-2.5 px-3.5 font-semibold">
                      {lang === 'vi' ? 'Giới hạn (429)' : 'Rate Limit'}
                    </th>
                    <th className="py-2.5 px-3.5 font-semibold">
                      {lang === 'vi' ? 'Lỗi mạng' : 'Errors'}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200/70 dark:divide-slate-800">
                  {upstreamEntries.map(([sourceKey, info]) => {
                    const rawState = String(info.state ?? 'closed').toLowerCase();
                    const normalizedState: CircuitBreakerState =
                      rawState === 'open' || rawState === 'half_open'
                        ? rawState
                        : 'closed';
                    const visuals = getCircuitVisuals(normalizedState, lang);
                    const totalCalls = Number(info.total_calls ?? 0);
                    const successCount = Number(info.success_count ?? 0);
                    const http429Count = Number(info.http_429_count ?? 0);
                    const timeoutCount = Number(info.timeout_count ?? 0);
                    const http5xxCount = Number(info.http_5xx_count ?? 0);
                    const consecutiveFailures = Number(
                      info.consecutive_failures ?? 0,
                    );
                    const hasLatencySample =
                      totalCalls > 0 && info.has_latency_sample !== false;
                    const primaryLatencyMs = Number(
                      info.avg_latency_ms ?? info.ema_latency_ms ?? 0,
                    );
                    const p95LatencyMs =
                      info.p95_latency_ms != null &&
                      Number.isFinite(Number(info.p95_latency_ms))
                        ? Number(info.p95_latency_ms)
                        : null;
                    const openRemainingSeconds = Number(
                      info.open_remaining_seconds ?? info.cooldown_remaining_s ?? 0,
                    );
                    const successRatePct =
                      totalCalls > 0
                        ? Math.round((successCount / totalCalls) * 100)
                        : null;
                    const lastErrorText =
                      typeof info.last_error === 'string' &&
                      info.last_error.trim().length > 0
                        ? info.last_error.trim()
                        : null;
                    const showLastError =
                      lastErrorText !== null &&
                      (normalizedState !== 'closed' ||
                        consecutiveFailures > 0 ||
                        totalCalls > successCount ||
                        (info.failure_count ?? 0) > 0 ||
                        (info.total_failures ?? 0) > 0);

                    const latencyBarPct = hasLatencySample
                      ? Math.min(100, Math.max(10, Math.round((primaryLatencyMs / 1000) * 100)))
                      : 0;
                    const latencyBarColor =
                      primaryLatencyMs <= 300
                        ? 'bg-emerald-500'
                        : primaryLatencyMs <= 700
                          ? 'bg-amber-500'
                          : 'bg-rose-500';

                    return (
                      <tr
                        key={sourceKey}
                        data-testid={`upstream-row-${sourceKey}`}
                        className="hover:bg-slate-50/60 dark:hover:bg-slate-800/30 transition-colors"
                      >
                        <td className="py-3 px-3.5 align-middle">
                          <span className="font-semibold text-slate-900 dark:text-slate-100">
                            {formatProviderName(sourceKey, lang)}
                          </span>
                        </td>
                        <td className="py-3 px-3.5 align-middle">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span
                              data-testid={`circuit-badge-${sourceKey}`}
                              data-state={normalizedState}
                              title={visuals.tooltip}
                              className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border text-[11px] font-mono font-semibold ${visuals.pillClass}`}
                            >
                              <span
                                className={`w-1.5 h-1.5 rounded-full ${visuals.dotClass}`}
                              />
                              {visuals.canonical}
                            </span>
                            <span className="text-[11px] text-slate-500 dark:text-slate-400">
                              {visuals.caption}
                            </span>
                            {normalizedState === 'open' &&
                              openRemainingSeconds >= 0.05 && (
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
                            {(normalizedState === 'open' ||
                              normalizedState === 'half_open') && (
                              <button
                                type="button"
                                data-testid={`reset-breaker-${sourceKey}`}
                                disabled={resettingBreaker !== null}
                                onClick={() => void handleResetBreaker(sourceKey)}
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 text-[10px] font-semibold text-slate-700 dark:text-slate-200 transition-colors disabled:opacity-50 cursor-pointer"
                              >
                                {resettingBreaker === sourceKey ? (
                                  <Loader2 className="h-2.5 w-2.5 animate-spin" />
                                ) : (
                                  <RotateCcw className="h-2.5 w-2.5" />
                                )}
                                <span>{lang === 'vi' ? 'Đặt lại' : 'Reset'}</span>
                              </button>
                            )}
                          </div>
                          {showLastError && lastErrorText && (
                            <p
                              data-testid={`upstream-last-error-${sourceKey}`}
                              title={lastErrorText}
                              className="mt-1 max-w-[260px] truncate text-[10px] font-mono text-rose-600 dark:text-rose-400"
                            >
                              {lastErrorText}
                            </p>
                          )}
                        </td>
                        <td
                          data-testid={`upstream-latency-${sourceKey}`}
                          className="py-3 px-3.5 align-middle font-mono tabular-nums text-slate-800 dark:text-slate-200"
                        >
                          {hasLatencySample ? (
                            <div className="space-y-1 min-w-[100px]">
                              <div className="flex items-baseline justify-between gap-2">
                                <span>{`${formatMetricNumber(primaryLatencyMs)} ms`}</span>
                                {p95LatencyMs !== null && (
                                  <span className="text-[10px] text-slate-400 dark:text-slate-500">
                                    {`p95: ${formatMetricNumber(p95LatencyMs)} ms`}
                                  </span>
                                )}
                              </div>
                              <div className="h-1 w-24 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                                <div
                                  style={{ width: `${latencyBarPct}%` }}
                                  className={`h-full rounded-full ${latencyBarColor}`}
                                />
                              </div>
                            </div>
                          ) : (
                            <span className="text-slate-400 dark:text-slate-500">
                              —
                            </span>
                          )}
                        </td>
                        <td
                          data-testid={`upstream-success-${sourceKey}`}
                          className="py-3 px-3.5 align-middle font-mono tabular-nums text-slate-800 dark:text-slate-200"
                        >
                          {totalCalls === 0 ? (
                            <span className="text-slate-400 dark:text-slate-500">
                              —
                            </span>
                          ) : (
                            <div className="space-y-1 min-w-[96px]">
                              <div>
                                <span>{`${successCount} / ${totalCalls}`}</span>
                                {successRatePct !== null && (
                                  <span className="ml-1.5 text-[11px] text-slate-400">
                                    {`(${successRatePct}%)`}
                                  </span>
                                )}
                              </div>
                              {successRatePct !== null && (
                                <div className="h-1 w-20 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                                  <div
                                    style={{ width: `${successRatePct}%` }}
                                    className={`h-full rounded-full ${
                                      successRatePct >= 90
                                        ? 'bg-emerald-500'
                                        : successRatePct >= 70
                                          ? 'bg-amber-500'
                                          : 'bg-rose-500'
                                    }`}
                                  />
                                </div>
                              )}
                            </div>
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

      {/* Cache & Knowledge Corpus Visual Studio */}
      {cacheEntries.length > 0 && (
        <div
          data-testid="cache-stats"
          className="rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm overflow-hidden"
        >
          <StudioWindowHeader
            title={
              lang === 'vi'
                ? 'BỘ NHỚ ĐỆM & KHO TRI THỨC'
                : 'CACHE & KNOWLEDGE LIBRARY'
            }
          />

          <div className="p-4 sm:p-6 space-y-4">
            {hasSeparatedCorpusMetrics && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div
                  data-testid="dynamic-citation-cache-card"
                  className="p-4 rounded-2xl bg-emerald-50/60 dark:bg-emerald-950/30 border border-emerald-200/80 dark:border-emerald-800/70"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-emerald-900 dark:text-emerald-200">
                      {lang === 'vi'
                        ? 'Bộ nhớ đệm Trích dẫn Động'
                        : 'Dynamic Citation Cache'}
                    </span>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/70 text-emerald-800 dark:text-emerald-200">
                      {lang === 'vi' ? 'Lưu tạm' : 'Live Cache'}
                    </span>
                  </div>
                  <p
                    data-testid="dynamic-cache-entries-value"
                    className="mt-1.5 text-2xl font-bold font-mono tabular-nums text-emerald-700 dark:text-emerald-300"
                  >
                    {dynamicCacheEntries.toLocaleString('en-US')}
                  </p>
                  <p className="mt-0.5 text-xs text-emerald-800/80 dark:text-emerald-300/80">
                    {lang === 'vi'
                      ? `${persistentHits.toLocaleString('en-US')} lượt trúng bền vững`
                      : `${persistentHits.toLocaleString('en-US')} persistent hits`}
                  </p>
                </div>

                <div
                  data-testid="static-local-corpus-card"
                  className="p-4 rounded-2xl bg-indigo-50/60 dark:bg-indigo-950/30 border border-indigo-200/80 dark:border-indigo-800/70"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-indigo-900 dark:text-indigo-200">
                      {lang === 'vi'
                        ? 'Kho Học thuật Cục bộ Tĩnh'
                        : 'Static Local Corpus'}
                    </span>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-900/70 text-indigo-800 dark:text-indigo-200">
                      {lang === 'vi' ? 'Cố định' : 'Built-in'}
                    </span>
                  </div>
                  <p
                    data-testid="static-local-corpus-value"
                    className="mt-1.5 text-2xl font-bold font-mono tabular-nums text-indigo-700 dark:text-indigo-300"
                  >
                    {localCorpusPapers.toLocaleString('en-US')}
                  </p>
                  <p className="mt-0.5 text-xs text-indigo-800/80 dark:text-indigo-300/80">
                    {lang === 'vi'
                      ? 'Không bị xóa khi dọn bộ nhớ đệm'
                      : 'Preserved across cache clears'}
                  </p>
                </div>
              </div>
            )}

            {hasBySourceObject && (
              <div
                data-testid="cache-by-source-section"
                className="pt-2"
              >
                <p className="text-xs font-semibold text-slate-700 dark:text-slate-200 mb-2">
                  {lang === 'vi'
                    ? 'Phân bổ lưu đệm theo nguồn'
                    : 'Cached Entries by Source'}
                </p>
                {cacheBySourceEntries.length > 0 ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                    {(() => {
                      const maxSrc = Math.max(
                        1,
                        ...cacheBySourceEntries.map(([, c]) => c),
                      );
                      return cacheBySourceEntries.map(([sourceKey, count]) => (
                        <ProportionalBarRow
                          key={sourceKey}
                          label={formatProviderName(sourceKey, lang)}
                          count={count}
                          value={count}
                          max={maxSrc}
                          barClass="bg-emerald-500"
                        />
                      ));
                    })()}
                  </div>
                ) : (
                  <span
                    data-testid="cache-by-source-zero"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-dashed border-slate-200 dark:border-slate-700 text-xs text-slate-500 dark:text-slate-400"
                  >
                    <span className="font-bold font-mono tabular-nums">0</span>
                    <span>
                      {lang === 'vi'
                        ? 'mục lưu đệm tra cứu động'
                        : 'dynamic cached entries'}
                    </span>
                  </span>
                )}
              </div>
            )}

            {localCorpusBySourceEntries.length > 0 && (
              <div
                data-testid="local-corpus-by-source-section"
                className="pt-3 border-t border-slate-200/80 dark:border-slate-800"
              >
                <p className="text-xs font-semibold text-slate-700 dark:text-slate-200 mb-2">
                  {lang === 'vi'
                    ? 'Kho tri thức học thuật tích hợp sẵn'
                    : 'Built-in Local Scholarly Corpus'}
                </p>
                <div className="flex flex-wrap gap-2">
                  {localCorpusBySourceEntries.map(([sourceKey, count]) => (
                    <span
                      key={sourceKey}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-indigo-50/50 dark:bg-indigo-950/30 border border-indigo-200/60 dark:border-indigo-800/60 text-xs text-slate-700 dark:text-slate-200"
                    >
                      <span className="font-medium">
                        {formatProviderName(sourceKey, lang)}
                      </span>
                      <span className="text-indigo-600 dark:text-indigo-400 font-mono font-bold tabular-nums">
                        {count}
                      </span>
                    </span>
                  ))}
                </div>
              </div>
            )}

          </div>

          {/* Progressive Disclosure Footer for Granular Cache Counters & SQLite Engine Telemetry */}
          <div className="border-t border-slate-200/80 dark:border-slate-800 bg-slate-50/30 dark:bg-slate-900/50">
            <button
              type="button"
              data-testid="toggle-advanced-diagnostics-btn"
              aria-expanded={diagnosticsOpen}
              onClick={() => setDiagnosticsOpen((prev) => !prev)}
              className="w-full px-4 sm:px-6 py-3 flex items-center justify-between gap-3 text-left hover:bg-slate-50/90 dark:hover:bg-slate-800/40 transition-colors cursor-pointer"
            >
              <span className="inline-flex items-center gap-2 text-xs font-medium text-slate-600 dark:text-slate-300">
                <SlidersHorizontal className="h-3.5 w-3.5 text-slate-400" />
                {lang === 'vi'
                  ? 'Thông số kỹ thuật nâng cao (Dành cho quản trị hạ tầng)'
                  : 'Advanced Engine Diagnostics (Infrastructure Details)'}
              </span>
              <SymmetricChevron open={diagnosticsOpen} size={15} className="text-slate-400" />
            </button>

            <div
              data-testid="advanced-diagnostics-panel"
              data-open={diagnosticsOpen ? 'true' : 'false'}
            >
              <AccordionExpand open={diagnosticsOpen}>
                <div className="px-4 sm:px-6 pb-5 pt-3 border-t border-slate-100 dark:border-slate-800 space-y-3">
                  {hasB1SessionTelemetry && (
                    <div
                      data-testid="b1-session-cache-panel"
                      className="p-3 rounded-xl bg-violet-50/60 dark:bg-violet-950/25 border border-violet-200/80 dark:border-violet-800/70 flex flex-wrap items-center justify-between gap-2 text-xs font-mono"
                    >
                      <span className="font-semibold text-violet-900 dark:text-violet-200">
                        {lang === 'vi'
                          ? 'Bộ nhớ đệm phiên RAM (B1 Singleflight)'
                          : 'B1 In-Memory Session Cache'}
                      </span>
                      <div className="flex flex-wrap items-center gap-2 text-[11px] text-violet-800 dark:text-violet-300">
                        {rawCacheStats.session_hit_rate_percent != null && (
                          <span data-testid="b1-session-hit-rate">
                            {lang === 'vi' ? 'Tỷ lệ trúng' : 'Hit Rate'}:{' '}
                            <strong>
                              {formatMetricNumber(
                                Number(rawCacheStats.session_hit_rate_percent),
                              )}
                              %
                            </strong>
                          </span>
                        )}
                        {rawCacheStats.wave0_entries != null && (
                          <span data-testid="b1-wave0-entries">
                            Wave-0:{' '}
                            <strong>{Number(rawCacheStats.wave0_entries)}</strong>
                          </span>
                        )}
                        {rawCacheStats.singleflight_coalesced != null && (
                          <span data-testid="b1-singleflight-coalesced">
                            Singleflight:{' '}
                            <strong>
                              {Number(rawCacheStats.singleflight_coalesced)}
                            </strong>
                          </span>
                        )}
                        {rawCacheStats.negative_cache_entries != null && (
                          <span data-testid="b1-negative-entries">
                            {lang === 'vi' ? 'Đệm âm' : 'Neg Cache'}:{' '}
                            <strong>
                              {Number(rawCacheStats.negative_cache_entries)}
                            </strong>
                          </span>
                        )}
                      </div>
                    </div>
                  )}

                  <dl className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {cacheEntries.map(([key, value]) => (
                      <div
                        key={key}
                        data-testid={`cache-stat-${key}`}
                        className="p-3 rounded-xl bg-slate-50/70 dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-800"
                      >
                        <dt className="text-[11px] text-slate-500 dark:text-slate-400">
                          {formatCacheStatLabel(key, lang)}
                        </dt>
                        <dd className="text-lg font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
                          {String(value)}
                        </dd>
                      </div>
                    ))}
                  </dl>

                  {appSqliteWal && (
                    <div
                      data-testid="sqlite-wal-telemetry"
                      className="flex flex-wrap items-center gap-2 text-[11px] font-mono pt-1"
                    >
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-semibold">
                        <HardDrive className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />
                        SQLite Engine
                      </span>
                      <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-emerald-50/80 dark:bg-emerald-950/60 border border-emerald-200/70 dark:border-emerald-800/70 text-emerald-800 dark:text-emerald-200">
                        <span className="text-slate-500 dark:text-slate-400">
                          journal_mode:
                        </span>
                        <span className="font-bold">
                          {String(appSqliteWal.journal_mode ?? 'WAL').toUpperCase()}
                        </span>
                      </span>
                      <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700 text-slate-700 dark:text-slate-200">
                        <span className="text-slate-500 dark:text-slate-400">
                          synchronous:
                        </span>
                        <span className="font-bold">
                          {formatSqliteSyncMode(appSqliteWal.synchronous)}
                        </span>
                      </span>
                      {(appSqliteWal.busy_timeout_ms != null ||
                        appSqliteWal.busy_timeout != null) && (
                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700 text-slate-700 dark:text-slate-200">
                          <span className="text-slate-500 dark:text-slate-400">
                            busy_timeout:
                          </span>
                          <span className="font-bold tabular-nums">
                            {`${String(appSqliteWal.busy_timeout_ms ?? appSqliteWal.busy_timeout)} ms`}
                          </span>
                        </span>
                      )}
                      <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-indigo-50/70 dark:bg-indigo-950/50 border border-indigo-200/70 dark:border-indigo-800/70 text-indigo-800 dark:text-indigo-200">
                        <span className="text-slate-500 dark:text-slate-400">
                          local_papers.db:
                        </span>
                        <span className="font-bold">
                          {formatLocalPapersDbMode(localPapersSqliteWal)}
                        </span>
                      </span>
                    </div>
                  )}
                </div>
              </AccordionExpand>
            </div>
          </div>
        </div>
      )}

      {/* Standalone Progressive Disclosure Drawer when SQLite WAL exists without Cache Stats */}
      {cacheEntries.length === 0 && appSqliteWal && (
        <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
          <button
            type="button"
            data-testid="toggle-advanced-diagnostics-btn"
            aria-expanded={diagnosticsOpen}
            onClick={() => setDiagnosticsOpen((prev) => !prev)}
            className="w-full px-4 sm:px-5 py-3 flex items-center justify-between gap-3 text-left hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors cursor-pointer"
          >
            <span className="inline-flex items-center gap-2 text-xs font-medium text-slate-600 dark:text-slate-300">
              <SlidersHorizontal className="h-3.5 w-3.5 text-slate-400" />
              {lang === 'vi'
                ? 'Thông số kỹ thuật nâng cao (Dành cho quản trị hạ tầng)'
                : 'Advanced Engine Diagnostics (Infrastructure Details)'}
            </span>
            <SymmetricChevron open={diagnosticsOpen} size={15} className="text-slate-400" />
          </button>

          <div
            data-testid="advanced-diagnostics-panel"
            data-open={diagnosticsOpen ? 'true' : 'false'}
          >
            <AccordionExpand open={diagnosticsOpen}>
              <div className="px-4 sm:px-5 pb-4 pt-1 border-t border-slate-100 dark:border-slate-800">
                <div
                  data-testid="sqlite-wal-telemetry"
                  className="flex flex-wrap items-center gap-2 text-[11px] font-mono pt-2"
                >
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-semibold">
                    <HardDrive className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />
                    SQLite Engine
                  </span>
                  <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-emerald-50/80 dark:bg-emerald-950/60 border border-emerald-200/70 dark:border-emerald-800/70 text-emerald-800 dark:text-emerald-200">
                    <span className="text-slate-500 dark:text-slate-400">
                      journal_mode:
                    </span>
                    <span className="font-bold">
                      {String(appSqliteWal.journal_mode ?? 'WAL').toUpperCase()}
                    </span>
                  </span>
                  <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700 text-slate-700 dark:text-slate-200">
                    <span className="text-slate-500 dark:text-slate-400">
                      synchronous:
                    </span>
                    <span className="font-bold">
                      {formatSqliteSyncMode(appSqliteWal.synchronous)}
                    </span>
                  </span>
                  {(appSqliteWal.busy_timeout_ms != null ||
                    appSqliteWal.busy_timeout != null) && (
                    <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700 text-slate-700 dark:text-slate-200">
                      <span className="text-slate-500 dark:text-slate-400">
                        busy_timeout:
                      </span>
                      <span className="font-bold tabular-nums">
                        {`${String(appSqliteWal.busy_timeout_ms ?? appSqliteWal.busy_timeout)} ms`}
                      </span>
                    </span>
                  )}
                  <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-indigo-50/70 dark:bg-indigo-950/50 border border-indigo-200/70 dark:border-indigo-800/70 text-indigo-800 dark:text-indigo-200">
                    <span className="text-slate-500 dark:text-slate-400">
                      local_papers.db:
                    </span>
                    <span className="font-bold">
                      {formatLocalPapersDbMode(localPapersSqliteWal)}
                    </span>
                  </span>
                </div>
              </div>
            </AccordionExpand>
          </div>
        </div>
      )}

      <ConfirmationModal
        isOpen={confirmClearOpen}
        variant="danger"
        title={
          lang === 'vi' ? 'Xóa toàn bộ bộ nhớ đệm?' : 'Clear the lookup cache?'
        }
        message={
          lang === 'vi'
            ? 'Mọi kết quả tra cứu học thuật đã lưu tạm sẽ bị xóa; các lần phân tích tiếp theo sẽ gọi lại nguồn dữ liệu và có thể chậm hơn.'
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
